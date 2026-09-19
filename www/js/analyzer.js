/* ============================================================================
 * analyzer.js  —  내용 정리/분석 모듈 (AnalysisModule)
 * ----------------------------------------------------------------------------
 * [통합 대비 설계]
 *  - 이 파일은 "글자 뭉치를 받아서 구조화된 정리본을 만드는 일"만 담당합니다.
 *  - 입력:  원문 전사 문자열 하나
 *  - 출력:  { summary[], todos[], decisions[], keywords[], sentences[] }
 *  - 지금은 "규칙 기반"(키워드·문장 점수)으로 무료·오프라인 동작합니다.
 *  - 나중에 통합 시, 이 함수 내부를 Claude API 호출로 바꾸면
 *    (같은 입력→같은 모양의 출력) 정리 품질만 올라가고 바깥은 그대로입니다.
 *      예)  AnalysisModule.analyze = async (text) => callClaude(text)
 *
 * [현재 규칙]
 *  - 문장 분리: 한국어 종결(다./요./죠./까?/…)·마침표·물음표·줄바꿈 기준
 *  - 할 일(todos): 지시/요청/예정 어미·동사 키워드 감지
 *  - 결정사항(decisions): '하기로 했다/정했다/확정' 등 합의 표현 감지
 *  - 핵심 요약(summary): 키워드 빈도로 문장 점수를 매겨 상위 문장 추출
 *  - 키워드: 조사·불용어 제거 후 명사성 단어 빈도 상위
 * ==========================================================================*/

(function (global) {
  'use strict';

  // --- 불용어(요약·키워드에서 제외할 흔한 말) ---
  const STOPWORDS = new Set([
    '그리고','그래서','하지만','그런데','그러면','그러니까','근데','일단','좀','약간',
    '이거','저거','그거','이것','저것','그것','여기','저기','거기','우리','저희','제가',
    '너무','정말','진짜','아주','매우','조금','거의','그냥','또한','또','및','등','등등',
    '이제','지금','오늘','내일','어제','다음','이번','저번','부분','경우','때문','통해',
    '위해','대해','관련','생각','같아요','있어요','없어요','합니다','했습니다','입니다',
    '거예요','인데','에서','으로','에게','한테','까지','부터','보다','처럼','만큼','하고'
  ]);

  // --- 할 일 신호(어미/동사) ---
  const TODO_PATTERNS = [
    /해야\s*(?:한다|합니다|해요|됩니다|겠)/,
    /하기로/, /하도록/, /하자\b/, /합시다/, /해\s*주세요/, /해줘/, /부탁/,
    /준비/, /확인/, /점검/, /처리/, /정리/, /작성/, /제출/, /보고/, /공유/,
    /예약/, /신청/, /접수/, /연락/, /전화/, /문의/, /메일/, /이메일/, /발송/, /보내/,
    /등록/, /수정/, /반영/, /검토/, /완료해/, /마무리/, /챙겨/, /알아보/, /조사/,
    /필요(?:하다|합니다|해요|하니|한)/, /예정/, /할\s*것/, /할게/, /하겠/
  ];

  // --- 결정/합의 신호 ---
  const DECISION_PATTERNS = [
    /하기로\s*(?:했|함|정|결정|하)/, /로\s*정했/, /으로\s*정했/, /정하기로/,
    /결정(?:했|됐|하)/, /확정(?:했|됐|하|입니다|이다)/, /합의(?:했|됐|하)/,
    /채택/, /승인(?:했|됐|하)/, /통과(?:됐|했)/, /최종적으로/, /결론(?:은|적으로)/,
    /하기로\s*함/, /가기로/, /쓰기로/, /만들기로/, /하는\s*걸로/, /하는\s*것으로/
  ];

  /** 문장 단위로 분리 */
  function splitSentences(text) {
    if (!text) return [];
    // 종결어미·문장부호 뒤에서 자름. 줄바꿈도 경계로.
    // 종결어미 분리는 오분할이 적은 '다/요/죠/까'만 사용한다.
    // (음/함/임은 다음·마음·처음·이름 등에서 잘못 잘라 제외)
    // 음성 전사는 마침표가 없는 경우가 많아 이 종결어미 분리가 핵심이다.
    const rough = text
      .replace(/\n+/g, ' ')
      .replace(/([.!?。])\s*/g, '$1')
      .replace(/(다|요|죠|까)\s+/g, '$1')
      .split('');
    return rough
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length >= 2; });
  }

  /** 어떤 패턴 목록에 하나라도 걸리는지 */
  function matchesAny(sentence, patterns) {
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(sentence)) return true;
    }
    return false;
  }

  /** 단어 빈도(간단 토큰화 + 조사 꼬리 제거) */
  function wordFrequencies(sentences) {
    const freq = {};
    const josa = /(은|는|이|가|을|를|에|의|와|과|도|만|로|으로|에서|에게|한테|까지|부터|보다|처럼|이나|나|든지|라도)$/;
    sentences.forEach(function (s) {
      const tokens = s
        .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ') // 한글/영문/숫자만
        .split(/\s+/);
      tokens.forEach(function (raw) {
        let w = raw.trim();
        if (w.length < 2) return;
        // 조사 꼬리 한 번 제거
        w = w.replace(josa, '');
        if (w.length < 2) return;
        if (STOPWORDS.has(w)) return;
        if (/^\d+$/.test(w)) return;
        freq[w] = (freq[w] || 0) + 1;
      });
    });
    return freq;
  }

  /** 핵심 요약: 키워드 빈도 기반 문장 점수 상위 추출 */
  function extractSummary(sentences, freq, maxCount) {
    if (sentences.length === 0) return [];
    const scored = sentences.map(function (s, idx) {
      let score = 0;
      const tokens = s.split(/\s+/);
      tokens.forEach(function (t) {
        const key = t.replace(/[^가-힣a-zA-Z0-9]/g, '');
        if (freq[key]) score += freq[key];
      });
      // 문장이 너무 짧거나 너무 길면 감점(핵심 문장은 대개 중간 길이)
      const len = s.length;
      if (len < 6) score *= 0.5;
      if (len > 80) score *= 0.7;
      // 앞부분 문장에 약간 가산(도입에 주제가 잘 나옴)
      score += (sentences.length - idx) * 0.01;
      return { idx: idx, sentence: s, score: score };
    });

    const top = scored
      .slice()
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, Math.min(maxCount, sentences.length))
      .filter(function (x) { return x.score > 0; });

    // 원래 말한 순서대로 다시 정렬(읽기 자연스럽게)
    top.sort(function (a, b) { return a.idx - b.idx; });
    return top.map(function (x) { return x.sentence; });
  }

  /**
   * 메인 분석 함수
   * @param {string} text  원문 전사
   * @returns {{summary:string[], todos:string[], decisions:string[],
   *            keywords:{word:string,count:number}[], sentences:string[]}}
   */
  function analyze(text) {
    const clean = (text || '').trim();
    const sentences = splitSentences(clean);

    if (sentences.length === 0) {
      return { summary: [], todos: [], decisions: [], keywords: [], sentences: [] };
    }

    const freq = wordFrequencies(sentences);

    const decisions = sentences.filter(function (s) {
      return matchesAny(s, DECISION_PATTERNS);
    });

    // 할 일: todo 패턴에 걸리되, 이미 결정문으로 분류된 건 중복 제외
    const decisionSet = new Set(decisions);
    const todos = sentences.filter(function (s) {
      return matchesAny(s, TODO_PATTERNS) && !decisionSet.has(s);
    });

    // 요약 문장 개수: 전체 문장 수에 비례(3~6개)
    const maxSummary = Math.max(2, Math.min(6, Math.round(sentences.length / 3)));
    const summary = extractSummary(sentences, freq, maxSummary);

    // 키워드 상위 8개
    const keywords = Object.keys(freq)
      .map(function (w) { return { word: w, count: freq[w] }; })
      .filter(function (k) { return k.count >= 1; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 8);

    return {
      summary: summary,
      todos: todos,
      decisions: decisions,
      keywords: keywords,
      sentences: sentences
    };
  }

  global.AnalysisModule = { analyze: analyze };
})(window);

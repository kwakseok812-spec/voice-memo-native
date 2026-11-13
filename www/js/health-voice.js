/* ============================================================================
 * health-voice.js — 건강 탭 「🎤 말로 기록」 (O-0693, v9.64)
 * ----------------------------------------------------------------------------
 * 마이크를 누르고 "공복혈당 98, 체중 71.2, 아침은 양배추랑 계란 먹었어, 오늘은 운동 안 했어"처럼 말하면
 * 항목을 갈라 확인 카드로 보여 주고, [저장]을 누르면 기존 건강 탭 저장 길(setField → 저장 → 서버)로 적는다.
 *
 * 구성 (이 파일 하나)
 *   1. 순수 해석기  — DOM 이 없어도 돈다(node 로 시험). parse(말) → 항목들 · 읽지 못한 말(unread)
 *                    buildRows/evalRow(항목, 그날 기록) → 카드 행(새 칸 / 이미 같음 / 다른 값 있음 / 범위 밖)
 *   2. 화면          — 건강 탭 오른쪽 아래 알약 「🎤 말로 기록」 · 듣는 시트 · 확인 카드 · 8초 되돌리기
 *                    받아쓰기는 채팅·문서 뷰어 수정 요청과 같은 폰 인식기(KSpeech)를 쓴다(새 권한 없음 · 소리 파일을 만들지 않음).
 *
 * 원칙 (설계안 v2 · _jobs_output\20261101_health_voice\DESIGN.md)
 *   · 서버·PC 변경 0. 저장은 health.js 의 기존 길 하나(HealthTab.voice.apply). 말 원문·소리는 어디에도 저장하지 않는다.
 *   · 쓰이지 않은 말은 조용히 사라지지 않고 「읽지 못한 말」로 카드에 남긴다.
 *   · 이미 적힌 칸은 덮어쓰지 않는다(체크가 꺼진 채 「지금 기록」을 보여 줌). 식단은 덧붙임이 기본.
 *   · 의료 자문·판단 문구 없음 — 숫자 범위 경고는 받아쓰기 오류 방어일 뿐이다.
 *   · 스위치 VOICE_ENTRY_ON — false 면 알약·시트가 아예 만들어지지 않아 v9.63 화면과 같다(이 앱은 화면 파일이 APK 안에 있어 바꾸려면 새 빌드).
 * ==========================================================================*/
(function (root) {
  'use strict';

  var VOICE_ENTRY_ON = true;       // 스위치 (false 면 이 기능 전체가 꺼진다)
  var CONFIRM_MODE = 'card';       // 'card' = 확인 카드를 보고 [저장] (추천 · 기본). 다른 값은 아직 없음(대표님이 번거롭다 하시면 그때 추가)
  var VERSION = 'o0693-1';

  /* ===========================================================================
   * 1. 순수 해석기
   * =========================================================================*/
  var CHIPS = ['양배추', '현미밥', '계란', '두부', '닭가슴살', '김치', '나물', '생선', '샐러드', '사과', '견과류', '우유', '블랙커피'];   // health.js BASE_FOODS 와 같은 목록(health.js 가 ctx.chips 로 덮어쓴다)
  var COMMON = ('오이 포도 바나나 빵 라면 치킨 삼겹살 마늘 맥주 소주 아몬드 카레 칼국수 만두 불고기 불고기덮밥 김밥 떡볶이 짜장면 짬뽕 국수 비빔밥 된장찌개 김치찌개 ' +
    '참치 햄 소시지 토마토 고구마 감자 콩 두유 요거트 치즈 커피 주스 과자 초콜릿 케이크 피자 햄버거 샌드위치 족발 보쌈 곰탕 설렁탕 순두부 오징어 새우 굴 회 초밥 ' +
    '우동 파스타 스테이크 소고기 돼지고기 닭고기 오리 밥 국 반찬 뷔페 귤 오렌지 딸기 수박 참외 복숭아 배 감 키위 쌀밥 잡곡밥 죽 미역국 삼계탕 갈비 갈비탕 냉면 막국수 ' +
    '찜닭 닭볶음탕 제육 제육볶음 순대 어묵 계란말이 두부조림 참치마요덮밥 참치마요').split(' ');
  // 말한 낱말 → 기본 칩 이름 (설계안 5-2: 달걀→계란, 밥→현미밥, 커피→블랙커피 …)
  var ALIAS = { '달걀': '계란', '현미': '현미밥', '밥': '현미밥', '커피': '블랙커피', '닭가슴': '닭가슴살', '견과': '견과류' };
  var EX_ALIAS = { '러닝머신': '런닝머신', '슬로우 러닝': '슬로우러닝' };
  var NUMCH = '일이삼사오육칠팔구';
  // 값이 없는 때·상황 낱말 — 조용히 걷어내는 두 목록 가운데 하나(나머지 하나는 「끼니 낱말이 때만 가리키는 경우」, 아래 breakfast 처리에 표시)
  var CTX = /(어젯밤에?|간밤에|지난밤에|아까|방금|일어나자마자|일어나서|눈\s*뜨자마자|출근해서|새벽에|(?:오늘\s*)?(?:건강\s*)?기록\s*(?:할게요?|할께요?|시작할게요?|시작)|어제\s*(?=수면|잠(?:(?![가-힣])|[은을도이](?![가-힣])))|어제\s*밤(?:에는|에|엔)?(?=\s*(?:\d+|[가-힣]{1,3})\s*시간))/g;
  // 정정·번복 낱말 — 코드에 명시한 목록(조용히 걷어내는 낱말): 「아니」「어 아니」「아 잠깐」「그게 아니라」「정정」「A 말고 B」. 있던 자리에는 ¶ 표시를 남겨 앞 말과 뒤 말을 나눈다.
  var CORR = /(?:^|[\s,])(?:(?:어|아|음|그|저|에이)\s+)*(?:(?:그게\s*)?아니(?:야|요|다|고|라)?(?:\s+(?:그게\s*)?아니(?:야|요|다|고|라)?)*|아\s*잠깐|잠깐만?|정정(?:할게요?|하면|합니다)?|말고)(?=[\s,.?]|$)/g;

  // ---- 한자어 숫자: 엄격한 문법 [N백][N십][N] (구십팔=98, 백이십=120, 팔십구=89). 띄어 말해도 허용 ----
  var SINO_RE = /^(?:([일이삼사오육칠팔구])?백)?(?:([일이삼사오육칠팔구])?십)?([일이삼사오육칠팔구])?$/;
  function sinoVal(s) {
    if (!s || !SINO_RE.test(s)) return null;
    var m = s.match(SINO_RE), d = function (c) { return c ? NUMCH.indexOf(c) + 1 : 0; };
    var hasH = s.indexOf('백') >= 0, hasT = s.indexOf('십') >= 0;
    var v = (hasH ? (d(m[1]) || 1) * 100 : 0) + (hasT ? (d(m[2]) || 1) * 10 : 0) + d(m[3]);
    if (!hasH && !hasT) return null;           // 「구」「오」처럼 한 글자 숫자는 혈당·체중 값으로 보지 않는다
    return v;
  }
  var NUM_SUFFIX = /^(이고요|이구요|이야|이고|이에요|이다|입니다|인데|이네|이라고|이었|이었어|이니까|였|야|예요|이요|고(?![가-힣])|구요)/;
  // seg 맨 앞에서 숫자 하나를 읽는다. 반환 {v, len} 또는 null.  숫자 변환은 혈당·체중 낱말 바로 뒤에서만 한다(음식 이름이 숫자로 깨지지 않게).
  function readNum(s) {
    var m = s.match(/^(\d{1,3})(?:\s*(?:\.|점)\s*(\d{1,2}))?(?![\d])/);
    if (m) return { v: parseFloat(m[1] + (m[2] ? '.' + m[2] : '')), len: m[0].length };
    var i = 0, chars = '', pos = [];
    while (i < s.length) { var c = s[i]; if (/\s/.test(c)) { i++; continue; } if ((NUMCH + '십백').indexOf(c) < 0) break; chars += c; pos.push(i + 1); i++; }
    for (var n = chars.length; n >= 1; n--) {
      var v = sinoVal(chars.slice(0, n)); if (v === null) continue;
      var rest = s.slice(pos[n - 1]);
      var dec = rest.match(/^\s*점\s*([영공일이삼사오육칠팔구]{1,2}|\d{1,2})/);
      if (!(rest === '' || /^[\s,.?]/.test(rest) || NUM_SUFFIX.test(rest) || dec || /^(으로|도|은|는|이|가)\b/.test(rest))) continue;
      var len = pos[n - 1];
      if (dec) {
        var ds = dec[1], dd = /^\d/.test(ds) ? ds : ds.split('').map(function (ch) { return ch === '영' || ch === '공' ? 0 : NUMCH.indexOf(ch) + 1; }).join('');
        return { v: parseFloat(v + '.' + dd), len: len + dec[0].length };
      }
      return { v: v, len: len };
    }
    return null;
  }
  var UNIT = /^\s*(mg\/?dl|mg|킬로그램|킬로|키로|kg|밀리)/i;
  var FILL = /(^|\s)(은|는|이|가|도|을|를|에|에는|엔|으로|로|이야|이에요|예요|입니다|이고요|이구요|이고|인데|이었어|였어|이다|야|요|나왔어요|나왔어|나왔고요|나왔구요|나왔는데요|나왔네요|나왔습니다|도요|은요|는요|나옴|나왔다|정도|쯤|이네|네(?!\s*(?:시간|분|개|잔|번|공기|그릇))|나왔고|나왔는데|나왔네|나오네|그리고|그런데|근데|음|어|저기|인가|했어요|했어|했음|했고|했다|하고|랑|이랑|와|과|밖에|동안|입니다만|다|전부|모두|꼭|잘|같이|함께|또|아직|이미|벌써|둘|양쪽)(?=\s|$|,|\.|\?)/g;
  function leftover(s) {
    var r = String(s || '').replace(/[,.!?~¶]/g, ' ');
    for (var k = 0; k < 3; k++) r = r.replace(FILL, ' ');
    r = r.replace(/\s+/g, ' ').trim();
    return /[가-힣a-zA-Z0-9]/.test(r) ? r : '';
  }
  // ---- 수치 범위 방어 (설계안 6-4). 건강 판단이 아니라 받아쓰기 오류 방어 ----
  function rangeOf(k, v, ctx) {
    if (k === 'fasting_glucose') { if (v !== Math.round(v) || v < 40 || v > 500) return 'block'; if (v < 50 || v > 300) return 'warn'; return 'ok'; }
    if (k === 'weight') { if (v < 30 || v > 300) return 'block'; if (v > 200) return 'warn'; if (ctx && ctx.lastWeight && Math.abs(v - ctx.lastWeight) > 5) return 'warn'; return 'ok'; }
    if (k === 'sleep_hours') { if (v <= 0 || v > 16) return 'block'; if (v > 14 || v < 0.5) return 'warn'; return 'ok'; }
    return 'ok';
  }
  // 막힌 값에 흔한 받아쓰기 오류 후보 (9.8 → 98 · 980 → 98 …). 소수점 혈당은 정수 칸과 맞지 않아 자동으로 반올림하지 않고 후보로만 보인다.
  function fixCands(k, v) {
    var c = [], r1 = function (x) { return Math.round(x * 10) / 10; };
    if (k === 'fasting_glucose') {
      if (v !== Math.round(v)) c.push(Math.round(v * 10));
      if (v > 500) c.push(Math.round(v / 10));
      if (v < 40 && v === Math.round(v)) c.push(v * 10);
    } else if (k === 'weight') {
      if (v > 300) c.push(r1(v / 10));
      if (v < 30) c.push(r1(v * 10));
    } else if (k === 'sleep_hours') {
      if (v > 16) c.push(r1(v / 10));
    }
    return c.filter(function (x, i) { return c.indexOf(x) === i && rangeOf(k, x) !== 'block'; });
  }

  // ---- 식단 쪼개기: 이름 사전(칩+배운 음식+자주 쓰는 이름)으로 먼저 통째로 맞춘다 ----
  var EAT = /(먹었고요|먹었구요|먹었는데요|먹었네요|먹었어요|먹었어|먹었습니다|먹었음|먹었고|먹었는데|먹었다|먹음|먹고|드셨어요|드셨어|드셨음|마셨어요|마셨어|마셨고|마셨음|마심|마시고|식사했어)/g;
  // 음식 이름으로 인정하지 않고 조용히 빼는 낱말 — 코드에 명시한 군말·접속·정도·때 낱말 목록(이 목록 밖의 말은 사라지지 않고 「읽지 못한 말」로 남는다)
  var FOOD_DROP = { '어': 1, '음': 1, '그': 1, '저': 1, '뭐': 1, '아': 1, '응': 1, '다': 1, '전부': 1, '모두': 1, '그냥': 1, '좀': 1, '조금': 1, '약간': 1, '많이': 1,
                    '같이': 1, '함께': 1, '또': 1, '정도': 1, '쯤': 1, '먹고': 1, '하고': 1, '그럼': 1, '그래서': 1, '오늘': 1, '어제': 1, '그제': 1, '지금': 1, '아까': 1,
                    '이따': 1, '나중': 1, '먼저': 1, '또는': 1, '이랑': 1, '에서': 1, '으로': 1, '까지': 1, '밖에': 1, '이나': 1 };
  var VERB_END = /(었어|았어|했어|겠어|였어|이야|이에요|예요|입니다|네요|인데|는데|은데|니까|해서|하고|다|요|게|히|았고|었고|했고|않고|어서|아서|으면|이면|려고|으니|해야|라서)$/;      // 사전에 없는 낱말이 이렇게 끝나면 음식이 아니라 서술어로 본다
  var REJ_WORD = /^(시간|분|개|잔|번|명|동안|때|중|후|전|뒤|것|거|게|건|걸|아직|이미|벌써|둘|양쪽)$/;
  // 사전에 없는 낱말 끝의 주격 조사(받침 있으면 「이」, 없으면 「가」: 「회의가」) — 음식 이름이 아니라 말 속 주어로 본다(「팟타이」는 받침 없는 「팟타」+「이」라 해당 없음)
  function isSubj(w) { var m = w.match(/^(.{2,})(이|가)$/); if (!m) return false; var jong = (m[1].charCodeAt(m[1].length - 1) - 0xAC00) % 28 !== 0; return (m[2] === '이') === jong; }
  function looksFood(w) { return w.length >= 2 && /^[가-힣A-Za-z0-9]+$/.test(w) && !/^\d+$/.test(w) && !VERB_END.test(w) && !REJ_WORD.test(w); }
  function foodTokens(s, KN) {
    var desire = [];                           // 「커피 마시고 싶다」「샐러드 먹을래」「먹어야지」 — 먹은 것이 아니라 바람·계획이라 기록하지 않고 읽지 못한 말로 남긴다
    s = s.replace(/(?:[가-힣]+\s+)?(?:먹|마시)(?:고\s*싶|을\s*(?:거|래|까)|어야|려고|겠)[가-힣]*/g, function (mt) { desire.push(mt.trim()); return ' , '; });
    var hadEat = /(먹|드셨|마셨|마심|마시|식사)/.test(s);
    s = s.replace(EAT, ',').replace(/[.!?]/g, ',').replace(/^\s*(에서는|에서|에는|엔|에|은|는|도|으로|로)(?=\s|$)/, '');
    var toks = [], run = [], rej = desire.slice();
    var flush = function () { if (run.length) { toks.push({ t: run.join(' '), known: false }); run = []; } };
    var isKn = function (w) { return !!KN[w] || !!ALIAS[w]; };
    s.split(',').forEach(function (piece) {
      var words = piece.trim().split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) {
        var w = words[i], brk = false;
        if (w === '그리고' || w === '및' || w === '그런데' || w === '근데') { flush(); continue; }
        var multi = null;                       // 배운 음식에 띄어 쓴 이름(「삼겹 구이」)이 있으면 낱말 둘·셋을 묶어서 먼저 맞춘다
        for (var ml = 3; ml >= 2 && !multi; ml--) { if (i + ml <= words.length && KN[words.slice(i, i + ml).join(' ')]) multi = words.slice(i, i + ml).join(' '); }
        if (multi) { flush(); toks.push({ t: multi, known: true }); i += multi.split(' ').length - 1; continue; }
        if (FOOD_DROP[w]) continue;
        if (!isKn(w)) {
          var best = null;
          ['이랑', '랑', '하고', '와', '과'].forEach(function (c) {
            if (w.length > c.length && w.slice(-c.length) === c) {
              var b = w.slice(0, -c.length), sc = isKn(b) ? 2 : (b.length >= 2 ? 1 : 0);
              if (sc === 1 && c !== '하고') { var jong = (b.charCodeAt(b.length - 1) - 0xAC00) % 28 !== 0; if ((c === '이랑' || c === '과') !== jong) return; }      // 받침 있으면 「이랑·과」, 없으면 「랑·와」 — 「팟타이랑」을 「팟타」+「이랑」으로 자르지 않게
              if (sc > 0 && (!best || sc > best.sc || (sc === best.sc && c.length > best.cl))) best = { b: b, sc: sc, cl: c.length };
            }
          });
          if (best) { w = best.b; brk = true; }
          else {
            var m0 = w.match(/^(.{2,}?)(이고요|이고|이구요|이구)$/);            // 「김밥이고요」「라면이고」: 음식 이름 뒤 서술 끝말은 뗀다(O-0736)
            if (m0) w = m0[1];
            var m = w.match(/^(.+?)(을|를|도|만|은|는)$/);
            if (m && (isKn(m[1]) || m[1].length >= 2)) w = m[1];
            else {
              var m2 = w.match(/^(.+?)(으로|에서|에|까지|이나|이|가|로)$/);           // 「현미밥에」「간식으로」: 조사를 떼고 이름만 — 떼고 남은 것이 사전 낱말이거나(「에」「으로」「에서」「까지」는) 두 글자 이상일 때
              if (m2 && isKn(m2[1])) w = m2[1];
              else if (m2 && /^(으로|에서|까지)$/.test(m2[2]) && m2[1].length >= 2) { flush(); rej.push(w); continue; }      // 「에」는 음식 붙임(「구이에 샐러드」)일 수도 있어 아래에서 조사만 뗀다
              else if (m2 && m2[2] === '에' && m2[1].length >= 2) w = m2[1];      // 「회사에서」「집에」: 사전에 없는 낱말 + 장소·방향 조사 = 음식이 아니라 장소·때 말
            }
          }
        }
        if (FOOD_DROP[w]) continue;
        var q = (words[i + 1] || '');
        if (/^(한|두|세|네|다섯|여섯|\d+)$/.test(w) && /^(공기|그릇|개|접시|잔|조각|숟갈|컵|줄|병|캔|알|장|입)/.test(q)) {   // 「한 공기」는 앞 음식에 붙인다
          var tail = w + ' ' + q.replace(/(을|를|도|만|은|는|이랑|랑|하고)$/, '');
          if (run.length) run[run.length - 1] += ' ' + tail; else if (toks.length) toks[toks.length - 1].t += ' ' + tail; else run.push(tail);
          i++; if (/(이랑|랑|하고)$/.test(q)) brk = true; if (brk) flush(); continue;
        }
        w = ALIAS[w] || w;
        if (isKn(w) || KN[w]) { flush(); toks.push({ t: w, known: true }); }
        else if (looksFood(w) && !isSubj(w)) run.push(w);
        else { flush(); rej.push(w); }                          // 음식으로 보기 어려운 낱말(서술어·한 글자·단위)은 저장하지 않고 「읽지 못한 말」로
        if (brk) flush();
      }
      flush();
    });
    var seen = {}; toks = toks.filter(function (x) { if (seen[x.t]) return false; seen[x.t] = 1; return !!x.t; });
    return { toks: toks, hadEat: hadEat, rej: rej };
  }

  // 수면 말: 시간(아라비아·고유어·한자어) + 분(아라비아·한자어) — 「네 시간」「칠 시간」「일곱 시간 반」「사십 분」
  var HW = '(?:\\d{1,2}(?:\\.\\d)?|열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|[일이삼사오육칠팔구십]{1,3})';
  var MW = '(?:\\d{1,2}|[일이삼사오육칠팔구십]{1,3})';
  var NATH = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
  function sinoAny(s) { return /^[일이삼사오육칠팔구]$/.test(s) ? NUMCH.indexOf(s) + 1 : sinoVal(s); }
  function hwVal(w) { return /^\d/.test(w) ? parseFloat(w) : (NATH[w] !== undefined ? NATH[w] : sinoAny(w)); }
  function mwVal(w) { return /^\d/.test(w) ? parseInt(w, 10) : sinoAny(w); }
  var HRE = new RegExp('(' + HW + ')\\s*시간\\s*(반|(' + MW + ')\\s*분)?');
  var MRE = new RegExp('(' + MW + ')\\s*분');
  function hoursFrom(t) {            // 「일곱 시간 반」「7시간 30분」「6시간」「사십 분」 → {v: 소수 시간, text}
    var m = t.match(HRE);
    if (m) {
      var h = hwVal(m[1]); if (h === null || isNaN(h)) return null;
      if (m[2]) { if (m[2] === '반') h += 0.5; else { var mv = mwVal(m[3]); if (mv === null || isNaN(mv)) return null; h += mv / 60; } }
      return { v: Math.round(h * 1000) / 1000, text: m[0] };
    }
    var m2 = t.match(MRE);
    if (m2) { var mm = mwVal(m2[1]); if (mm !== null && !isNaN(mm)) return { v: Math.round(mm / 60 * 1000) / 1000, text: m2[0] }; }
    return null;
  }

  var BADDATE = '\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|\\d+\\s*일\\s*전|며칠\\s*전|엊그제|그끄저께|그끄제|사흘\\s*전|(?:지난|저번|이번)\\s*주(?:\\s*[월화수목금토일]요일)?|지난\\s*[월화수목금토일]요일|[월화수목금토일]요일|내일|모레';
  var BADDATE_RE = new RegExp('^(?:' + BADDATE + ')$');
  var ANCH = [
    ['when', new RegExp(BADDATE + '|그제|그저께|어제|오늘', 'g')],
    ['fasting_glucose', /공복\s*혈당|혈당|공복\s*당/g],
    ['weight', /체중|몸무게/g],
    ['sleep_hours', new RegExp('수면\\s*시간|수면|잠(?=[은을도이]?(?:\\s|$|,|\\.))|' + HW + '\\s*시간\\s*(?:반|' + MW + '\\s*분)?(?:밖에|정도|쯤|가량|이나)?\\s*(?:못\\s*|안\\s*)?(?:잤|잠|수면|자고|잔)|' + MW + '\\s*분\\s*(?:밖에|정도|쯤)?\\s*(?:못\\s*)?(?:잤|잠|자고|잔)', 'g')],
    ['supplement', /영양제|비타민\s*[A-Za-z]?\d*|오메가\s*\d*|루테인|마그네슘/g],
    ['med', /당뇨\s*약|약(?!간|과|밥|수|초|속)/g],
    ['breakfast', /아침/g], ['lunch', /점심/g], ['dinner', /저녁/g], ['snack', /간식/g]
  ];
  // 운동 말: 이름(사전) + 분량(분·시간·개·세트·회 — 아라비아·한자어·한/두/세) — 사전에 없는 이름은 「새 운동」 확인 행으로
  var EXNAMES = '런닝머신|러닝머신|슬로우\\s*러닝|러닝|걷기|산책|조깅|등산|수영|자전거|사이클|헬스|요가|필라테스|스트레칭|줄넘기|웨이트|배드민턴|테니스|탁구|축구|농구|골프|복싱|크로스핏|플랭크|푸시업|팔굽혀펴기|스쿼트|풀업|턱걸이|런지|데드리프트|벤치프레스|[가-힣]{1,4}운동|운동';
  var QTY = '(?:\\d+|[일이삼사오육칠팔구십백]+|한|두|세|네|반)\\s*(?:분|시간|개|세트|회|번|바퀴|km|킬로)(?:\\s*반)?(?:\\s*(?:씩|만|정도|쯤))?';
  var EX_RE = new RegExp('(' + EXNAMES + ')(?:\\s*(' + QTY + '))?', 'g');
  var NEWEX_RE = new RegExp('(?<![가-힣])([가-힣]{2,6})\\s*(' + QTY + ')\\s*(?=했|함|하고)', 'g');
  var NEWEX_NOT = /^(수면|혈당|체중|영양제|아침|점심|저녁|간식|공복|오늘|어제|그제|비타민|오메가|루테인|마그네슘|당뇨약|몸무게|공부|일|근무|회의|수업|업무)/;
  function normQty(q) {          // 분량을 읽기 좋게: 「삼십 분만」→「30분」 · 「한 시간」→「1시간」 · 「오십 개」→「50개」 (만·씩·정도는 군말로 뺀다 — 이 목록)
    var s = String(q).replace(/\s*(씩|만|정도|쯤)$/, '').trim();
    var m = s.match(/^(\d+|[일이삼사오육칠팔구십백]+|한|두|세|네|반)\s*(분|시간|개|세트|회|번|바퀴|km|킬로)(\s*반)?$/);
    if (!m) return s.replace(/\s+/g, ' ');
    var n = /^\d+$/.test(m[1]) ? m[1] : ({ 한: 1, 두: 2, 세: 3, 네: 4 }[m[1]] || (m[1] === '반' ? null : sinoAny(m[1])));
    if (n === null || n === undefined || isNaN(n)) return s.replace(/\s+/g, ' ');
    return n + m[2] + (m[3] ? ' 반' : '');
  }
  var SRC_RE = /(손가락\s*채혈|채혈|손가락|리브레\s*2?|센서)(?:\s*(?:으로|로))?(?:\s*(?:쟀어요|쟀어|쟀음|쟀다|쟀는데|측정(?:했어)?|잰))?/g;
  var QUESTION_RE = /(\?|야\s*돼|돼\s*$|될까|할까|일까|인가요|나요|까요|되나|괜찮|늘려야|줄여야|끊어야|바꿔야|해야)/;      // 질문·상담 말에는 「먹었는지 모름」 같은 꼬리를 붙이지 않는다
  var NEG_VERB = /(?<![가-힣])(?:안|못)\s*(?:먹|챙|드)[가-힣]*|먹지\s*(?:않|못)[가-힣]*|깜빡[가-힣]*|빼먹[가-힣]*|걸렀[가-힣]*/g;

  // ---- 혈당·체중 「측정 안 함」 말 (O-0736) ----
  //   「안 쟀어」「못 재서」「안 잰」「안 재었어」「재지 않았어」「측정 안 했어」「측정을 못 했어」「측정하지 않았어」「패스」「건너뛰었어」… 낱말 하나를 통째로 걷어낸다(「쟀고」「쟀지만」 같은 꼬리가 읽지 못한 말로 남지 않게).
  //   받아쓰기가 「쟀」을 「잤」으로 적는 일이 있어 혈당·체중 낱말 바로 뒤의 「안 잤어」도 같은 뜻으로 본다(이 두 칸 안에서만 쓰는 규칙).
  var NEG_MEAS_ANY = /(?<![가-힣])(?:안|못)\s*(?:쟀|재|잰|잼|잴|잤|잠)[가-힣]*|(?:재|측정\s*하|체크\s*하|확인\s*하)지\s*(?:않|못)[가-힣]*|(?:측정|체크|확인)\s*(?:이|을|를|은|는|도)?\s*(?:안|못)\s*[가-힣]*|(?<![가-힣])(?:안|못)\s*나(?:왔|와|오|옴)[가-힣]*|(?<![가-힣])(?:패스|건너뛰|건너뛴|생략|깜빡|빼먹|걸렀)[가-힣]*/;
  var NEG_MEAS_LEAD = /^\s*(?:(?:안|못)\s*(?:했|함|해|하|됐|돼|되)|없(?:어|음|고|었|네|다))[가-힣]*/;
  function negMeasOf(s) {            // 말 조각이 「측정 안 함」인가 → {neg, rest(그 말을 걷어낸 나머지)}
    var x = String(s || '');
    if (NEG_MEAS_ANY.test(x) || NEG_MEAS_LEAD.test(x)) {
      var g = new RegExp(NEG_MEAS_ANY.source, 'g'), l = new RegExp(NEG_MEAS_LEAD.source);
      return { neg: true, rest: x.replace(g, ' ').replace(l, ' ') };
    }
    return { neg: false, rest: x };
  }
  var SKIP_TOK = '측정 안 함';        // 값 고르기 행에서 「측정 안 함」을 나타내는 후보 이름
  function numLoop(s2) {              // 말 조각 맨 앞에서 숫자를 차례로 읽는다(정정·군말 건너뜀) → {vals, rest}
    var vals = [], safety = 0;
    while (s2 && safety++ < 8) {
      s2 = s2.replace(/^[\s,]+/, '');
      if (s2.charAt(0) === '¶') { s2 = s2.slice(1); continue; }
      var fm = s2.match(/^(?:그리고|그런데|근데|어|음|저기|아|응)(?=\s|¶)\s*/);          // 정정 앞뒤의 군말(「그리고 어 아니 구십이」)
      if (fm) { s2 = s2.slice(fm[0].length); continue; }
      var mm2 = s2.match(/^(다시|정정)\s*/);
      if (mm2) { s2 = s2.slice(mm2[0].length); continue; }
      var r = readNum(s2);
      if (!r) break;
      vals.push(r.v); s2 = s2.slice(r.len).replace(UNIT, '').replace(/^\s*(?:이라고|라고|이고요|이구요|이고|이요|구요|고)(?![가-힣])/, '').replace(/^\s*(?:으로|로)?\s*(?:쟀|재었|잰|측정\s*(?:했|함))[가-힣]*/, '');
    }
    return { vals: vals, rest: s2 };
  }
  /* parse(말, ctx) → { items: [...], unread: [...] }
   *   ctx = { hour: 0~23(한국 시각), learned: [배운 음식], chips: [기본 칩], lastWeight }
   *   item = { k, v, when:'today'|'yesterday'|'dayBefore'|'bad', wx: 날짜 낱말을 말했나, checked, flags[], cands[], skip, glu, newFoods[] }
   *   원칙: 입력의 모든 조각은 「값으로 쓰임」 또는 「읽지 못한 말(unread)」 또는 「코드에 명시한 군말·때·정정 낱말」 셋 중 하나다 — 조용히 사라지는 말은 없다(test_nolose.js 가 고정). */
  function parse(raw, ctx) {
    ctx = ctx || {};
    var hour = ctx.hour === undefined ? 8 : ctx.hour;
    var KN = {}; (ctx.chips || CHIPS).concat(COMMON, ctx.learned || []).forEach(function (f) { KN[f] = 1; });
    var t = String(raw || '').replace(/？/g, '?').replace(CTX, ' ').replace(CORR, ' ¶ ').replace(/\s+/g, ' ').trim();
    var out = { items: [], unread: [] };
    // 0) 혈당 잰 방식 말(채혈·리브레·센서)은 어디에 있든 먼저 떼어 두었다가 가장 가까운 혈당 행에 붙인다(자리는 그대로 두려고 같은 길이의 빈칸으로 바꾼다)
    var srcMarks = [];
    t = t.replace(SRC_RE, function (mt, w1, off) { srcMarks.push({ i: off, v: /채혈|손가락/.test(w1) ? 'blood' : 'cgm', s: mt.replace(/\s+/g, ' ').trim() }); return new Array(mt.length + 1).join(' '); });
    // 1) 운동 낱말을 먼저 찾아 자리를 잡는다(가슴운동 안의 「운동」이 새 항목 시작으로 오인되지 않게)
    var hits = [], m;
    var exRe = new RegExp(EX_RE.source, 'g');
    while ((m = exRe.exec(t))) {
      var nm = m[1].replace(/\s+/g, ' '), bare = nm === '운동';
      var after = t.slice(m.index + m[0].length, m.index + m[0].length + 3);
      if (!bare && /운동$/.test(nm) && nm.length > 2 && /^[가-힣]/.test(after) && !/^(은|는|도|을|를|이|가|\s)/.test(after) && !(after === '')) { continue; }   // 뒤가 낱말로 이어지면 운동 이름 아님
      nm = EX_ALIAS[nm] || nm;
      var q = m[2] ? normQty(m[2]) : '';
      hits.push({ k: 'exercise', i: m.index, e: m.index + m[0].length, s: m[0], name: bare ? (q ? '운동 ' + q : null) : (nm + (q ? ' ' + q : '')) });
    }
    var nxRe = new RegExp(NEWEX_RE.source, 'g');           // 사전에 없는 운동 이름(「스쿼트 오십 개 했어」꼴) — 「새 운동」 확인 행으로
    while ((m = nxRe.exec(t))) {
      if (NEWEX_NOT.test(m[1]) || KN[m[1]] || ALIAS[m[1]]) continue;
      var ov = hits.some(function (h) { return m.index < h.e && m.index + m[0].length > h.i; });
      if (ov) continue;
      hits.push({ k: 'exercise', i: m.index, e: m.index + m[0].length, s: m[0], name: m[1] + ' ' + normQty(m[2]), isNew: true });
    }
    var overlap = function (a) { return hits.some(function (h) { return h.k === 'exercise' && a.i < h.e && a.e > h.i; }); };
    ANCH.forEach(function (a) { var re = new RegExp(a[1].source, 'g'), mm; while ((mm = re.exec(t))) { var h = { k: a[0], i: mm.index, e: mm.index + mm[0].length, s: mm[0] }; if (!overlap(h)) hits.push(h); } });
    hits.sort(function (a, b) { return a.i - b.i || b.e - a.e; });
    var clean = []; hits.forEach(function (h) { if (!clean.length || h.i >= clean[clean.length - 1].e) clean.push(h); }); hits = clean;   // 겹치는 것 제거(앞의 것 우선)
    var mg = [];                                                        // 「수면 7시간 잤어」: 수면 낱말과 시간 말이 따로 잡히면 한 덩어리로
    hits.forEach(function (h) {
      var p = mg[mg.length - 1];
      if (p && p.k === 'sleep_hours' && h.k === 'sleep_hours' && /^\s*(은|는|이|가|도|을|를)?\s*$/.test(t.slice(p.e, h.i))) { p.e = h.e; p.s = t.slice(p.i, h.e); return; }
      mg.push(h);
    });
    hits = mg;
    var pre = leftover(t.slice(0, hits.length ? hits[0].i : t.length));
    if (pre) out.unread.push(pre);

    // 2) 약의 때 낱말 묶기: 「아침 저녁 약 먹었어」(앞) · 「당뇨약 아침 저녁 다 먹었어」(뒤) — 때 낱말은 약의 때로 쓰고 따로 끼니로 읽지 않는다
    var GAP = /^\s*(?:,|및|와|과|랑|이랑|하고|도|은|는|에)?\s*$/, MEALK = /^(breakfast|lunch|dinner)$/;
    var VSTART = /^\s*(?:은|는|도|에)?\s*(?:다\s*|모두\s*|전부\s*|꼭\s*|잘\s*)?(?:안\s*|못\s*)?(?:먹|챙|복용|깜빡|빼먹|걸렀|드셨)/;
    hits.forEach(function (h, idx) {
      h.s0 = h.e; h.s1 = hits[idx + 1] ? hits[idx + 1].i : t.length;
    });
    hits.forEach(function (h, idx) {
      if (h.k !== 'med') return;
      var times = [], j = idx - 1, prevStart = h.i;
      while (j >= 0 && MEALK.test(hits[j].k) && !hits[j].skipMe && GAP.test(t.slice(hits[j].e, prevStart))) { times.unshift(hits[j]); prevStart = hits[j].i; j--; }
      if (!times.length) {
        var k2 = idx + 1, endPos = h.e, fw = [];
        while (k2 < hits.length && MEALK.test(hits[k2].k) && GAP.test(t.slice(endPos, hits[k2].i))) { fw.push(hits[k2]); endPos = hits[k2].e; k2++; }
        if (fw.length && VSTART.test(t.slice(endPos, hits[k2] ? hits[k2].i : t.length))) { times = fw; h.s0 = endPos; h.s1 = hits[k2] ? hits[k2].i : t.length; }
      }
      if (times.length) { h.times = times.map(function (x) { return x.k; }); times.forEach(function (x) { x.skipMe = true; }); }
    });
    var all = hits;
    hits = all.filter(function (h) { return !h.skipMe; });

    var when = 'today', whenX = false, ex = {}, prevNum = null, gluItems = [], pendMeals = [], pendMeas = null, skipAt = -9;
    var push = function (it) { it.when = it.when || when; if (it.wx === undefined) it.wx = whenX; if (it.checked === undefined) it.checked = true; if (it.when === 'bad') { it.checked = false; (it.flags = it.flags || []).push('baddate'); } out.items.push(it); return it; };
    var polarity = function (sg) {            // 약·영양제 먹음/안 먹음 — 정정(¶)이 있으면 나중 말을 따른다
      var parts = sg.split('¶'), found = [];
      parts.forEach(function (p) { var neg = /(?<![가-힣])(?:안|못)\s*(?:먹|챙)|먹지\s*(?:않|못)|깜빡|빼먹|걸렀/.test(p), pos = /먹었|먹음|복용|챙겼|챙겨|드셨|먹고|먹어/.test(p); if (neg || pos) found.push(neg ? 'neg' : 'pos'); });
      if (!found.length) return { neg: false, pos: false, corr: false };
      var last = found[found.length - 1];
      return { neg: last === 'neg', pos: last === 'pos', corr: found.length > 1 && found[0] !== last };
    };
    var verbOf = function (idx) {            // 약·영양제 묶음(「약이랑 영양제 먹었어」)은 마지막 동사를 함께 쓴다
      for (var j = idx; j < hits.length; j++) {
        var sg = t.slice(hits[j].s0, hits[j].s1);
        var pl = polarity(sg);
        if (pl.neg || pl.pos) return pl;
        if (leftover(sg) || !hits[j + 1] || !/^(med|supplement)$/.test(hits[j + 1].k)) return { neg: false, pos: false, corr: false };
      }
      return { neg: false, pos: false, corr: false };
    };
    var medUnread = function (a, seg, noVerbNote) {
      var txt = (a.s + ' ' + seg).trim();
      out.unread.push(QUESTION_RE.test(txt) ? txt : txt + noVerbNote);
    };
    for (var n = 0; n < hits.length; n++) {
      var a = hits[n], seg = t.slice(a.s0, a.s1), k = a.k;
      if (k === 'when') {
        var isBad = BADDATE_RE.test(a.s.replace(/\s+/g, ' '));
        when = isBad ? 'bad' : /어제/.test(a.s) ? 'yesterday' : /그제|그저께/.test(a.s) ? 'dayBefore' : 'today'; whenX = true;
        if (isBad) out.unread.push(a.s.replace(/\s+/g, ' ') + ' (날짜는 오늘·어제·그제까지 말씀해 주십시오)');
        var rest = seg.replace(/^\s*(은|는|엔|에는|에|도|부터)(?=\s|$)/, '').replace(/¶/g, ' ').trim();
        if (pendMeas && pendMeas.idx === n - 1) {                       // 바로 앞이 값 없는 혈당·체중 낱말: 「체중은 오늘 안 쟀고」「혈당은 어제 95」
          var pm = pendMeas; pendMeas = null;
          var rest2 = rest.replace(/^\s*(은|는|이|가|도|을|를|만)(?=\s)/, '').trim(), ngp = negMeasOf(rest2), rnp = readNum(rest2);
          if (ngp.neg && !rnp) { skipAt = n; var lop = leftover(ngp.rest); if (lop) out.unread.push(pm.a.s + ' ' + a.s + ' ' + lop); push({ k: pm.k, skip: true, src: pm.a.s + ' ' + a.s + ' ' + rest2 }); continue; }
          if (rnp && !ngp.neg) {
            var lop2 = leftover(rest2.slice(rnp.len).replace(UNIT, '')); if (lop2) out.unread.push(lop2);
            prevNum = pm.k; var pu = push({ k: pm.k, v: rnp.v, src: pm.a.s, pos: pm.a.i }); if (pm.k === 'fasting_glucose') gluItems.push(pu); continue;
          }
          out.unread.push(pm.a.s);
        }
        var rn = rest ? readNum(rest) : null;
        if (rn && prevNum && !leftover(rest.slice(rn.len).replace(UNIT, ''))) {       // 「어제는 혈당 95 오늘은 98」: 항목 이름이 빠진 숫자는 추측 행으로(기본 체크 해제)
          push({ k: prevNum, v: rn.v, flags: ['guess'], checked: false, src: a.s + ' ' + rest });
        } else { var lo = leftover(rest); if (lo) out.unread.push(a.s + ' ' + lo); }
        continue;
      }
      if (k === 'exercise') {
        var e = ex[when] || (ex[when] = { names: [], neg: false, bare: false, src: [], wx: whenX, newNames: [] }), negHere = false;
        if (whenX) e.wx = true;
        var lo2 = seg.replace(/(?<![가-힣])(안\s*(했|함|하)|못\s*(했|함))[가-힣]*/, function () { negHere = true; return ' '; });
        if (a.name) {
          if (!negHere) { e.names.push(a.name); if (a.isNew) e.newNames.push(a.name); } else e.negNames = (e.negNames || []).concat(a.name);
        } else e.bare = true;
        if (negHere && !a.name) e.neg = true;
        if (negHere && a.name) e.neg = e.neg || false;
        if (/¶/.test(seg) && hits[n + 1] && hits[n + 1].k === 'exercise' && e.names.length) { e.prev = (e.prev || []).concat(e.names.join(', ')); e.names = []; }   // 「가슴운동 아니 등운동」: 앞 이름은 확인 필요 행의 다른 후보로
        var l3 = leftover(lo2.replace(/(?<![가-힣])(?:했|함|하|탔|탄|탈|뛰었|뛰고|뛰어|걸었|걷고|갔|다녀왔|왔)[가-힣]*|한\s*거/g, ' '));
        if (l3) out.unread.push(l3);
        continue;
      }
      if (k === 'fasting_glucose' || k === 'weight') {
        var s2 = seg.replace(/^\s*(은|는|이|가|도|을|를|만)(?=\s)/, '').trim(), vals = [];
        var negFull = negMeasOf(s2);                                  // 「측정 안 함」 말인가 — 숫자와 함께 있으면 고르기 행(값 또는 측정 안 함) · 부정만 있으면 측정 안 함 행(O-0736)
        for (var pg = 0; pg < 4; pg++) {                              // 앞머리 군말: 「쟀더니」「쟀는데」「재니까」「쟀어」 …
          var s2b = s2.replace(/^\s*(?:이야기\s*하면|이야기\s*하자면|말하면|말하자면|보면|수치(?:는|가)?|결과(?:는|가)?|측정(?:값|치)?(?:은|는)?|(?:다|둘\s*다|모두|전부)\s*(?=재|쟀)|공복(?:\s*혈당)?|쟀더니|재보니까?|재\s*보니|재니까|재니|쟀는데|쟀어서|쟀어요|쟀어|쟀고|쟀음|재었[가-힣]*|재서|잰|확인\s*(?:했더니|해보니|하니)|봤더니|보니까|보니)(?=[\s,.\d]|$|[일이삼사오육칠팔구십백])\s*/, '');
          if (s2b === s2) break; s2 = s2b;
        }
        var NL = numLoop(s2); vals = NL.vals; s2 = NL.rest;
        var negHere = null, nOrder = '';
        if (vals.length) { var ng1 = negMeasOf(s2); if (ng1.neg) { negHere = ng1; nOrder = 's'; } }      // 「체중 71.5 아니 안 쟀어」: 값 다음에 부정
        else {
          var ng2 = negFull.neg ? negFull : negMeasOf(s2);
          if (ng2.neg) {
            var NL2 = numLoop(ng2.rest);
            if (NL2.vals.length) { vals = NL2.vals; s2 = NL2.rest; negHere = ng2; nOrder = 'v'; }          // 「혈당 안 쟀어 아니 98」: 부정 다음에 값
            else {                                                    // 「체중 안 쟀어」: 측정 안 함 행(숫자를 지어내지 않는다)
              var lo4 = leftover(ng2.rest);
              if (lo4) out.unread.push(a.s + ' ' + lo4);
              prevNum = k; skipAt = n; push({ k: k, skip: true, src: a.s + ' ' + seg.trim() }); continue;
            }
          } else if (!leftover(s2) || /^\s*도(?:요)?\s*$/.test(s2)) {
            if (skipAt === n - 1 && /^\s*도(?:요)?\s*$/.test(s2)) { skipAt = n; push({ k: k, skip: true, src: a.s + ' (앞 말과 같이)' }); continue; }       // 「체중 안 쟀어요 혈당도요」
            if (hits[n + 1] && hits[n + 1].k === 'when' && !BADDATE_RE.test(hits[n + 1].s.replace(/\s+/g, ' '))) { pendMeas = { k: k, a: a, idx: n }; continue; }     // 「체중은 오늘 안 쟀고」: 뒤의 날짜 낱말 처리에서 이어 본다
            var sh = false;                                           // 「체중도 혈당도 안 쟀어」「혈당 체중 둘 다 안 쟀어」: 낱말만 있고 뒤 항목이 안 쟀다고 하면 같이 안 쟀다는 뜻
            for (var jj = n + 1; jj < hits.length && (hits[jj].k === 'fasting_glucose' || hits[jj].k === 'weight'); jj++) {
              var sg2 = t.slice(hits[jj].s0, hits[jj].s1).replace(/^\s*(은|는|이|가|도|을|를|만)(?=\s)/, '').trim();
              if (negMeasOf(sg2).neg) { sh = true; break; }
              if (leftover(sg2)) break;
            }
            if (sh) { skipAt = n; push({ k: k, skip: true, src: a.s + ' (뒤 말과 함께)' }); continue; }
          }
        }
        if (negHere) {                                                // 값과 「안 쟀어」가 함께: 어느 쪽이 맞는지 고르게 한다(마지막 말이 기본 선택 · 고르기 전에는 체크 꺼짐)
          var restM = nOrder === 's' ? negHere.rest : s2, loM = leftover(restM);
          if (loM) out.unread.push(loM);
          var uv = vals.filter(function (x, i) { return vals.indexOf(x) === i; });
          var cs = nOrder === 's' ? uv.concat(SKIP_TOK) : [SKIP_TOK].concat(uv);
          prevNum = k;
          var pm2 = push({ k: k, v: cs[cs.length - 1], cands: cs, flags: ['confirm', 'mixed'], checked: false, src: a.s, pos: a.i });
          if (k === 'fasting_glucose') gluItems.push(pm2);
          continue;
        }
        var lo5 = leftover(s2);
        if (!vals.length) { out.unread.push((a.s + (lo5 ? ' ' + lo5 : '')).trim()); continue; }     // 값 없는 항목 낱말도 뒷말과 함께 남긴다
        if (lo5) out.unread.push(lo5);
        var it = { k: k, v: vals[vals.length - 1], src: a.s, pos: a.i };
        if (vals.length > 1) { it.cands = vals.filter(function (x, i) { return vals.indexOf(x) === i; }); if (it.cands.length > 1) it.flags = ['confirm']; else it.cands = null; }
        prevNum = k;
        var pushed = push(it);
        if (k === 'fasting_glucose') gluItems.push(pushed);
        continue;
      }
      if (k === 'sleep_hours') {
        var full = t.slice(a.i, a.s1), parts = full.split('¶'), vs = [], restAll = '';
        parts.forEach(function (p) { var hv = hoursFrom(p); if (hv) { vs.push(hv.v); restAll += ' ' + p.replace(hv.text, ' '); } else restAll += ' ' + p; });
        if (!vs.length) { out.unread.push(full.replace(/¶/g, ' ').replace(/\s+/g, ' ').trim()); continue; }
        var lo6 = leftover(restAll.replace(/(?<![가-힣])(?:것\s*같(?:아요|아|은데요|은데|다|네요|네)|수면\s*시간|수면|잤[가-힣]*|잠|자고|잔|동안|정도|쯤|밖에|가량|이나|못|안)(?=\s|$|,|\.|은|는|을|을|도|이)/g, ' '));
        if (lo6) out.unread.push(lo6);
        var sit = { k: k, v: vs[vs.length - 1], src: a.s };
        var su = vs.filter(function (x, i) { return vs.indexOf(x) === i; });
        if (su.length > 1) { sit.cands = su; sit.flags = ['confirm']; }
        push(sit);
        continue;
      }
      if (k === 'med' || k === 'supplement') {
        if (QUESTION_RE.test(seg)) { out.unread.push((a.s + ' ' + seg).replace(/¶/g, ' ')); continue; }      // 「약 먹어도 되나요?」 같은 질문·상담 말은 기록하지 않고 그대로 남긴다(판단·조언 없음)
        var vb = verbOf(n), lo7 = leftover(seg.replace(/(?<![가-힣])(?:안|못)\s*(?:먹|챙|드)[가-힣]*|먹지\s*(?:않|못)[가-힣]*|깜빡[가-힣]*|빼먹[가-힣]*|걸렀[가-힣]*|먹었[가-힣]*|먹음|먹어[가-힣]*|복용[가-힣]*|챙[겼겨][가-힣]*|드셨[가-힣]*|먹고|했어|해서/g, ' '));
        if (!vb.neg && !vb.pos) { medUnread(a, seg.replace(/¶/g, ' '), ' (먹었는지 모름)'); continue; }
        var item = { v: !vb.neg, src: a.s };
        if (vb.neg) { item.flags = ['neg']; item.checked = false; }
        if (vb.corr) { (item.flags = item.flags || []).push('corr'); item.checked = false; }
        if (lo7) out.unread.push(a.s + ' ' + lo7);
        if (k === 'supplement') { item.k = 'supplement'; push(item); continue; }
        if (a.times) {
          a.times.forEach(function (tk, ti) {
            if (tk === 'lunch') { out.unread.push('점심 약 ' + (vb.neg ? '안 먹음' : '먹음') + ' (점심 약 칸은 없음)'); return; }
            var cp = { v: item.v, src: a.s, flags: (item.flags || []).slice(), k: tk === 'dinner' ? 'med_evening' : 'med_morning' };
            if (item.checked === false) cp.checked = false;
            push(cp);
          });
          continue;
        }
        var tm = null, how = 'said';
        for (var q2 = n - 1; q2 >= 0; q2--) if (MEALK.test(hits[q2].k)) { tm = hits[q2].k; how = 'near'; break; }
        if (tm === 'lunch') { out.unread.push('점심 약 ' + (vb.neg ? '안 먹음' : '먹음') + ' (점심 약 칸은 없음)'); continue; }
        if (tm) { item.k = tm === 'dinner' ? 'med_evening' : 'med_morning'; if (how === 'near') (item.flags = item.flags || []).push('time-guess'); push(item); continue; }
        if (hour < 14) { item.k = 'med_morning'; (item.flags = item.flags || []).push('time-guess'); push(item); continue; }   // 새벽(4시 전)에 말한 약도 아침약이 기본
        if (hour >= 17) { item.k = 'med_evening'; (item.flags = item.flags || []).push('time-guess'); push(item); continue; }
        item.k = 'med_morning'; item.cands = ['med_morning', 'med_evening']; item.flags = (item.flags || []).concat('confirm'); item.checked = false; push(item);
        continue;
      }
      if (k === 'breakfast' || k === 'lunch' || k === 'dinner' || k === 'snack') {
        if (!seg.replace(/¶/g, ' ').replace(/^\s*(에서는|에서|에는|엔|에|은|는|도|으로|로)(?=\s|$)/, '').trim() && hits[n + 1] && MEALK.test(hits[n + 1].k) && k !== 'snack') { pendMeals.push(a); continue; }      // 「아침 점심은 샐러드」: 끼니 낱말이 이어지면 뒤 끼니의 말을 함께 쓴다
        var pw = pendMeals.map(function (x) { return x.s; }).join(' '), pend = pendMeals; pendMeals = [];
        var mparts = seg.split('¶'), vals2 = [], lastFt = null, rejAll = [], noneSeen = false, bare = [];
        mparts.forEach(function (pt) {
          var s3 = pt.replace(/^\s*(에서는|에서|에는|엔|에|은|는|도|으로|로)(?=\s|$)/, '').trim();
          if (!s3) return;
          if (k !== 'snack' && /(?<![가-힣])(?:안\s*먹|못\s*먹)|먹지\s*(?:않|못)|걸렀|굶|거르/.test(s3)) { var lo8 = leftover(s3.replace(/(?<![가-힣])(?:안|못)\s*먹[가-힣]*|먹지\s*(?:않|못)[가-힣]*|걸렀[가-힣]*|굶[가-힣]*|거르[가-힣]*/g, ' ')); if (lo8) out.unread.push(a.s + ' ' + lo8); vals2.push({ v: '안 먹음' }); lastFt = null; return; }
          if (k === 'snack' && /^없/.test(s3)) { vals2.push({ v: '없음' }); lastFt = null; return; }
          var ft = foodTokens(s3, KN);
          if (!ft.toks.length) { bare.push(((pw ? pw + ' ' : '') + a.s + ' ' + s3).trim()); return; }
          rejAll = rejAll.concat(ft.rej);
          vals2.push({ v: ft.toks.map(function (x) { return x.t; }).join(', '), ft: ft }); lastFt = ft;
        });
        if (!vals2.length) { bare.forEach(function (b) { out.unread.push(b); }); continue; }        // (값이 없는데 끼니 낱말만 있는 「아침에 일어나서 혈당…」은 위에서 s3 가 비어 조용히 지나가는 두 번째 목록)
        bare.forEach(function (b) { out.unread.push(b); });
        if (rejAll.length) out.unread.push(a.s + ' ' + rejAll.join(' '));
        var lastV = vals2[vals2.length - 1], it2 = { k: k, v: lastV.v, src: a.s };
        var vu = vals2.map(function (x) { return x.v; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
        if (vu.length > 1) { it2.cands = vu; it2.flags = ['confirm']; }
        if (lastV.ft) {
          var unk = lastV.ft.toks.filter(function (x) { return !x.known; });
          if (unk.length) { it2.flags = (it2.flags || []).concat('new'); it2.newFoods = unk.map(function (x) { return x.t; }); if (!lastV.ft.hadEat) it2.checked = false; }   // 낯선 음식 + 먹었다는 말 없음 → 기본 체크 해제
        }
        push(it2);
        pend.forEach(function (pm) { var cp = JSON.parse(JSON.stringify(it2)); cp.k = pm.k; cp.src = pm.s; push(cp); });
      }
    }
    Object.keys(ex).forEach(function (w) {
      var e = ex[w], it = { when: w, k: 'exercise', src: '운동', wx: !!e.wx };
      if (e.names.length) {
        it.v = e.names.join(', ');
        if (e.neg || e.prev) {
          it.cands = (e.prev || []).concat(e.neg ? ['안 함'] : []).concat(it.v);
          it.cands = it.cands.filter(function (x, i, arr) { return arr.indexOf(x) === i; });
          if (e.neg) { it.cands = [it.v, '안 함']; }
          if (it.cands.length > 1) it.flags = ['confirm']; else it.cands = null;
        }
        if (e.newNames.length) { it.flags = (it.flags || []).concat('newex'); it.newEx = e.newNames; it.checked = false; }
      } else if (e.neg || (e.negNames && e.negNames.length)) it.v = '안 함';
      else { out.unread.push('운동 (무슨 운동인지 모름)'); return; }
      push(it);
    });
    // 혈당 잰 방식 말: 가장 가까운 혈당 행에 붙인다 — 붙일 곳이 없으면 읽지 못한 말로
    srcMarks.forEach(function (sm) {
      var best = null;
      gluItems.forEach(function (g) { if (!g.glu && (best === null || Math.abs(g.pos - sm.i) < Math.abs(best.pos - sm.i))) best = g; });
      if (best) best.glu = sm.v;
      else if (gluItems.some(function (g) { return g.glu === sm.v; })) return;          // 같은 방식을 두 번 말함(「리브레 센서로」) — 같은 뜻이라 합친다
      else out.unread.push(sm.s);
    });
    // 같은 날 같은 칸을 두 번 말함 → 하나의 「확인 필요」 행(기본은 나중 말)
    var by = {}, merged = [];
    out.items.forEach(function (it) {
      var key = it.when + '|' + it.k, p = by[key];
      if (!p) { by[key] = it; merged.push(it); return; }
      var cOf = function (x) { return x.skip ? SKIP_TOK : x.v; };       // 「측정 안 함」도 하나의 후보
      var c = (p.cands || [cOf(p)]).concat(it.cands || [cOf(it)]), uniq = c.filter(function (x, i) { return c.indexOf(x) === i; });
      p.wx = p.wx || it.wx;
      if (it.glu && !p.glu) p.glu = it.glu;
      if (uniq.length > 1) {
        var hasSkip = uniq.indexOf(SKIP_TOK) >= 0;
        p.cands = uniq; p.v = it.cands ? it.v : cOf(it); p.skip = false; p.flags = (p.flags || []).filter(function (f) { return f !== 'confirm'; }).concat('confirm');
        if (hasSkip) { p.flags.push('mixed'); p.checked = false; }          // 값과 측정 안 함이 섞이면 직접 고르기 전에는 체크하지 않는다
        else p.checked = it.checked !== false;
      }
    });
    out.items = merged;
    var seenU = {};
    out.unread = out.unread.map(function (u) { return String(u).replace(/¶/g, ' ').replace(/\s+/g, ' ').trim(); }).filter(function (u) { if (!u || seenU[u]) return false; seenU[u] = 1; return true; });
    return out;
  }

  /* ---- 시험·화면이 같이 쓰는 한 줄 표기 (시제품과 같은 모양) ----
   *   range 는 evalRow 가 다시 계산하므로 parse 결과에는 없다 → 여기서 따로 붙여 단위 시험이 시제품 기대값과 맞게 한다. */
  function fmtItem(it, ctx) {
    var fl = (it.flags || []).slice(); if (it.checked === false) fl.push('unchk');
    var v = it.skip || it.v === SKIP_TOK ? 'skip' : it.v;
    if (!it.skip && it.v !== SKIP_TOK && (it.k === 'fasting_glucose' || it.k === 'weight' || it.k === 'sleep_hours')) {
      var rg = rangeOf(it.k, it.v, ctx);
      if (rg === 'block' || rg === 'warn') { fl.push(rg); if (rg === 'block' && fl.indexOf('unchk') < 0) fl.push('unchk'); }
    }
    if (it.cands && it.cands.length > 1) fl = fl.filter(function (f) { return f !== 'confirm'; }).concat('confirm:' + it.cands.map(function (c) { return c === SKIP_TOK ? 'skip' : c; }).join('/'));
    return (it.when || 'today') + '|' + it.k + '=' + v + (fl.length ? '{' + fl.sort().join(',') + '}' : '');
  }

  /* ===========================================================================
   * 1-b. 카드 행 만들기 (그날 기록과 견주기) — 순수
   * =========================================================================*/
  var LABEL = { fasting_glucose: '공복혈당', weight: '체중', sleep_hours: '수면', med_morning: '당뇨약(아침)', med_evening: '당뇨약(저녁)', supplement: '영양제',
                breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식', exercise: '운동' };
  var UNITS = { fasting_glucose: 'mg/dL', weight: 'kg' };
  var TYPE = { fasting_glucose: 'num', weight: 'num', sleep_hours: 'sleep', med_morning: 'bool', med_evening: 'bool', supplement: 'bool',
               breakfast: 'meal', lunch: 'meal', dinner: 'meal', snack: 'meal', exercise: 'meal' };
  var KORDER = ['fasting_glucose', 'weight', 'sleep_hours', 'med_morning', 'med_evening', 'supplement', 'breakfast', 'lunch', 'dinner', 'snack', 'exercise'];
  var WHEN_OFF = { today: 0, yesterday: -1, dayBefore: -2 };
  var GLU_NAME = { cgm: '리브레2', blood: '채혈' };
  var SKIP_WORDS = { '안먹음': 1, '안먹었음': 1, '안드심': 1, '결식': 1, '굶음': 1, '거름': 1 };   // health.js SKIP_WORDS 와 같은 목록(한쪽만 고치지 말 것)
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function shiftDate(ds, n) {
    var p = ds.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function dayNum(s) { var p = (s || '').split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fmtMD(s) { var p = (s || '').split('-'); return p.length === 3 ? (+p[1]) + '월 ' + (+p[2]) + '일' : s; }
  function dateTag(date, env) {                    // 화면 날짜와 다른 행에 붙는 꼬리표
    if (date === env.screen) return '';
    var d = dayNum(env.today) - dayNum(date);
    return (d === 0 ? '오늘' : d === 1 ? '어제' : d === 2 ? '그제' : '') + (d >= 0 && d <= 2 ? '(' + fmtMD(date) + ')' : fmtMD(date));
  }
  function isSet(v) { return !(v === null || v === undefined || v === ''); }
  function noneWordOf(k) { return k === 'snack' ? '없음' : k === 'exercise' ? '안 함' : '안 먹음'; }
  function sq(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }
  function isNoneVal(k, v) {
    if (typeof v !== 'string') return false;
    if (k === 'snack') return sq(v) === '없음';
    if (k === 'exercise') return sq(v) === '안함';
    return SKIP_WORDS[sq(v)] === 1;
  }
  function tokensOf(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function fmtSleep(v) {
    var h = Math.floor(+v + 1e-9), m = Math.round((+v - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    if (h === 0 && m === 0) return '0분';
    return m === 0 ? h + '시간' : h === 0 ? m + '분' : h + '시간 ' + m + '분';
  }
  function numText(k, v) { return (k === 'fasting_glucose' ? String(+v) : String(Math.round(+v * 10) / 10)); }
  function saveNum(k, v) { return k === 'fasting_glucose' ? Math.round(+v) : Math.round(+v * 10) / 10; }          // 실제로 저장될 값(health.js voiceOne 과 같은 반올림)
  function boolText(v) { return v === true ? '복용함' : v === false ? '안 먹음(미복용)' : ''; }

  /* buildRows(parsed, env, ustate) → 행 배열
   *   env = { screen:'YYYY-MM-DD'(지금 화면 날짜), today:'YYYY-MM-DD'(실제 오늘),
   *           base(date) → undefined(아직 못 읽음) | {ok, vals:{칸:값}, meas:{fasting_glucose,weight: 측정 안 함 여부}, note},
   *           lastWeight(date) → 숫자|null }
   *   ustate = 대표님이 카드에서 만진 것(체크·고른 값·덧붙임/바꾸기·뺀 낱말) — 다시 계산해도 이어진다 */
  function buildRows(parsed, env, ustate) {
    ustate = ustate || {};
    var rows = [], byId = {};
    parsed.items.forEach(function (it) {
      var isBad = it.when === 'bad';                              // 오늘·어제·그제가 아닌 날짜 말(「10월 28일」 등) — 적지 않고 보여만 준다
      var date = (it.wx && !isBad) ? shiftDate(env.today, WHEN_OFF[it.when] || 0) : env.screen;
      var k = it.k, type = TYPE[k];
      var row = { id: (isBad ? 'bad|' : '') + date + '|' + k, baddate: isBad, date: date, k0: k, k: k, type: type, label: LABEL[k], skip0: !!it.skip, skip: !!it.skip, glu: it.glu || null,
                  v0: it.skip ? null : it.v, cands: it.cands ? it.cands.slice() : null, kcands: null,
                  flags: (it.flags || []).filter(function (f) { return f !== 'warn' && f !== 'block'; }), newFoods: (it.newFoods || []).slice(),
                  pchecked: it.checked !== false, srcText: it.src || '', newEx: (it.newEx || []).slice() };
      if (k === 'med_morning' && row.cands && row.cands.length === 2 && row.cands[0] === 'med_morning' && row.cands[1] === 'med_evening') { row.kcands = row.cands; row.cands = null; }
      var p = byId[row.id];
      if (p) {                                                  // 화면 날짜와 말한 날짜가 겹쳐 같은 칸이 두 번 → 「확인 필요」 하나로
        var rc = function (x) { return x.skip0 ? SKIP_TOK : x.v0; };
        var c = (p.cands || [rc(p)]).concat(row.cands || [rc(row)]), uniq = c.filter(function (x, i) { return c.indexOf(x) === i; });
        if (uniq.length > 1) { p.cands = uniq; p.v0 = row.cands ? row.v0 : rc(row); p.skip0 = false; if (p.flags.indexOf('confirm') < 0) p.flags.push('confirm'); if (uniq.indexOf(SKIP_TOK) >= 0) { if (p.flags.indexOf('mixed') < 0) p.flags.push('mixed'); p.pchecked = false; } }
        return;
      }
      byId[row.id] = row; rows.push(row);
    });
    rows.sort(function (a, b) {
      var da = a.date === env.screen ? 0 : 1, db = b.date === env.screen ? 0 : 1;
      if (da !== db) return da - db;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return KORDER.indexOf(a.k0) - KORDER.indexOf(b.k0);
    });
    rows.forEach(function (r) { evalRow(r, env, ustate); });
    return rows;
  }

  // 한 행을 그날 기록과 견주어 다시 계산한다(체크 기본값 · 지금 기록 · 범위 · 안내 글)
  function evalRow(row, env, ustate) {
    var u = (ustate && ustate[row.id]) || {};
    var t = row.type, k = u.k && row.kcands && row.kcands.indexOf(u.k) >= 0 ? u.k : row.k0;
    row.k = k; row.label = LABEL[k];
    // 값 고르기: 두 번 말한 값(cands) · 막힌 값 고쳐 보기(fix)
    var v = row.v0;
    if (row.cands && u.v !== undefined && row.cands.indexOf(u.v) >= 0) v = u.v;
    if (t === 'num' || t === 'sleep') { if (u.fix !== undefined && !row.skip0 && v !== SKIP_TOK) v = u.fix; }
    row.v = v;
    row.skip = !!row.skip0 || (t === 'num' && v === SKIP_TOK);       // 값 고르기 행에서 「측정 안 함」을 고른 경우
    var b = env.base ? env.base(row.date) : undefined;
    row.notes = []; row.fixes = []; row.modes = null; row.mode = null; row.range = 'ok'; row.locked = false; row.lockWhy = ''; row.status = 'empty'; row.baseText = ''; row.pending = false;
    // 식단 낱말(뺀 것 반영)
    if (t === 'meal') {
      row.none = isNoneVal(k, v) || (typeof v === 'string' && sq(v) === sq(noneWordOf(k)));
      row.tokens = row.none ? [] : tokensOf(v).filter(function (x) { return !(u.rm && u.rm.indexOf(x) >= 0); });
    }
    if (row.baddate) { row.locked = true; row.lockWhy = '날짜는 오늘·어제·그제까지 말씀해 주십시오'; row.checked = false; row.status = 'unknown'; row.display = displayOf(row); return row; }
    if (b === undefined) { row.pending = true; row.checked = false; row.display = displayOf(row); return row; }
    if (!b || b.ok === false) {
      row.locked = true; row.lockWhy = '못 불러와서 저장하지 못했습니다'; row.checked = false; row.status = 'unknown'; row.display = displayOf(row); return row;
    }
    var vals = b.vals || {}, cur = vals[k], meas = b.meas || {}, st = 'empty', bt = '';
    if (t === 'num') {
      var ms = !!meas[k];
      if (row.skip) {
        if (isSet(cur)) { st = 'diff'; bt = numText(k, cur); } else if (ms) st = 'same';
      } else if (isSet(cur)) {
        st = (Math.abs(+cur - saveNum(k, v)) < 1e-6) ? 'same' : 'diff'; bt = numText(k, cur);
      } else if (ms) { st = 'diff'; bt = '측정 안 함'; }
    } else if (t === 'sleep') {
      if (isSet(cur)) { st = Math.abs(+cur - +v) < 1 / 120 ? 'same' : 'diff'; bt = fmtSleep(cur); }
    } else if (t === 'bool') {
      if (cur === true || cur === false) { st = cur === v ? 'same' : 'diff'; bt = boolText(cur); }
    } else if (t === 'meal') {
      if (isSet(cur) && String(cur).trim()) {
        var curNone = isNoneVal(k, cur);
        bt = String(cur);
        if (row.none) { st = curNone ? 'same' : 'diff'; if (st === 'diff') row.modes = ['replace']; }
        else if (curNone) { st = 'diff'; row.modes = ['replace']; }
        else {
          var ct = tokensOf(cur), add = row.tokens.filter(function (x) { return ct.indexOf(x) < 0; });
          if (!add.length) st = 'same'; else { st = 'diff'; row.modes = ['append', 'replace']; }
        }
        if (row.modes) row.mode = (u.mode && row.modes.indexOf(u.mode) >= 0) ? u.mode : row.modes[0];
      }
    }
    row.status = st; row.baseText = bt;
    // 범위 방어 (받아쓰기 오류 방어 — 건강 판단이 아님)
    if ((t === 'num' || t === 'sleep') && !row.skip) {
      row.range = rangeOf(k, +v, { lastWeight: env.lastWeight ? env.lastWeight(row.date) : null });
      if (row.range === 'block') row.fixes = fixCands(k, +v);
    }
    // 체크 기본값
    var auto = row.pchecked;
    if (st === 'same') auto = false;
    else if (st === 'diff' && !(t === 'meal' && row.modes && row.modes.indexOf('append') >= 0)) auto = false;
    if (row.range === 'warn' || row.range === 'block') auto = false;
    if (t === 'meal' && row.tokens.length === 0 && !row.none) auto = false;          // 낱말을 다 뺐다
    if (row.kcands && row.flags.indexOf('confirm') >= 0) auto = u.k !== undefined && row.flags.indexOf('neg') < 0;          // 아침약/저녁약을 골라야 켜진다(안 먹음은 골라도 꺼진 채)
    var chk = u.checked !== undefined ? u.checked : auto;
    if (row.range === 'block' || (t === 'meal' && row.tokens.length === 0 && !row.none)) chk = false;
    if (st === 'same' && u.checked === undefined) chk = false;
    row.checked = !!chk;
    // 안내 글 (합니다체 · 판단어 없음)
    var N = row.notes, fl = row.flags;
    if (st === 'same') N.push('이미 같은 값이 적혀 있습니다');
    if (st === 'diff') {
      if (row.mode === 'append') N.push('지금 기록: ' + bt + ' — 뒤에 덧붙입니다');
      else if (row.mode === 'replace') N.push('지금 기록: ' + bt + ' — 체크하면 바꿉니다');
      else N.push('지금 기록: ' + bt + ' — 바꾸려면 체크해 주십시오');
    }
    if (fl.indexOf('new') >= 0) N.push('새 음식: ' + row.newFoods.join(', ') + (row.pchecked ? '' : ' — 맞게 들었는지 확인해 주십시오'));
    if (fl.indexOf('newex') >= 0) N.push('새 운동: ' + row.newEx.join(', ') + ' — 맞게 들었는지 확인해 주십시오');
    if (fl.indexOf('corr') >= 0) N.push('고쳐 말씀하신 것으로 봤습니다 — 맞는지 확인해 주십시오');
    if (fl.indexOf('neg') >= 0) N.push('안 먹었다고 말씀하셨습니다 — 기록하려면 체크해 주십시오');
    if (fl.indexOf('time-guess') >= 0) N.push('때를 말씀하지 않아 ' + (k === 'med_evening' ? '저녁약' : '아침약') + '으로 봤습니다');
    if (row.kcands && fl.indexOf('confirm') >= 0) N.push('아침약인지 저녁약인지 골라 주십시오');
    if (fl.indexOf('guess') >= 0) N.push('항목 이름이 없는 숫자입니다. ' + LABEL[row.k0] + '으로 적을까요?');
    if (fl.indexOf('confirm') >= 0 && row.cands) N.push(fl.indexOf('mixed') >= 0 ? '값과 「측정 안 함」을 함께 말씀하셨습니다. 맞는 쪽을 골라 주십시오' : '두 가지로 말씀하셨습니다. 맞는 값을 골라 주십시오');
    if (row.range === 'warn') N.push(k === 'weight' && row.v <= 200 ? '지난 기록과 5kg 넘게 다릅니다. 숫자를 확인해 주십시오' : '숫자를 확인해 주십시오');
    if (row.range === 'block') N.push('숫자를 확인해 주십시오. 이 값으로는 저장할 수 없습니다');
    if (b.note) N.push(b.note);
    row.display = displayOf(row);
    return row;
  }
  function displayOf(row) {
    var k = row.k, t = row.type;
    if (row.skip) return '측정 안 함';
    if (t === 'num') return numText(k, row.v) + ' ' + UNITS[k] + (row.glu ? ' · ' + GLU_NAME[row.glu] : '');
    if (t === 'sleep') return fmtSleep(row.v);
    if (t === 'bool') return boolText(row.v);
    if (t === 'meal') return row.none ? noneWordOf(k) : row.tokens.join(', ');
    return String(row.v);
  }

  // 칩으로 배워도 되는 낱말인가: 두 글자 이상 12자 이하, 조사·서술어·군말 꼴이 아닌 것(「으로」「다」 같은 조각이 칩에 쌓이지 않게)
  function learnable(x) {
    x = String(x || '').trim();
    return x.length >= 2 && x.length <= 12 && /^[가-힣A-Za-z0-9 ]+$/.test(x) && !/^\d+$/.test(x) && !FOOD_DROP[x] && !VERB_END.test(x) && !REJ_WORD.test(x) && !/(으로|에서|에|까지)$/.test(x) && !isSubj(x) && x.split(' ').every(function (w) { return !FOOD_DROP[w]; });
  }
  // 체크된 행 → 적을 일 목록 (health.js 의 HealthTab.voice.apply 가 받는 모양)
  function opsOf(rows) {
    var ops = [];
    rows.forEach(function (r) {
      if (!r.checked || r.locked || r.pending) return;
      var o = { date: r.date, k: r.k, type: r.type };
      if (r.skip) o.skip = true;
      else if (r.type === 'meal') {
        o.none = !!r.none; o.tokens = r.tokens.slice(); o.mode = r.mode || (r.status === 'diff' ? 'replace' : 'append');
        o.learn = (!r.none && r.k !== 'exercise') ? r.tokens.filter(function (x) { return r.newFoods.indexOf(x) >= 0 && learnable(x); }) : [];   // 새 음식은 저장하면 칩으로 학습 — 12자 넘는 낱말은 제외
      } else o.v = r.v;
      if (r.glu) o.glu = r.glu;
      ops.push(o);
    });
    return ops;
  }

  var API = { VERSION: VERSION, learnable: learnable, parse: parse, readNum: readNum, rangeOf: rangeOf, fixCands: fixCands, fmtItem: fmtItem,
              buildRows: buildRows, evalRow: evalRow, opsOf: opsOf, shiftDate: shiftDate, dateTag: dateTag, fmtSleep: fmtSleep,
              LABEL: LABEL, UNITS: UNITS, KORDER: KORDER };

  /* ===========================================================================
   * 2. 화면 (브라우저에서만)
   * =========================================================================*/
  var doc = root.document;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (!doc || !VOICE_ENTRY_ON) { root.HealthVoice = API; return; }

  var H = null;                                  // HealthTab.voice (health.js 가 건네는 작은 문)
  var host = {};                                 // 앱이 건네는 것: toast · sttBusy · sfx
  var $ = function (id) { return doc.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(m, ms) { try { if (host.toast) host.toast(m, ms); } catch (e) {} }
  function isNative() { try { var C = root.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } }
  function calm() { try { if (root.KMotion && root.KMotion.calm) return !!root.KMotion.calm(); return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return true; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var HINT_KEY = 'smart_health_voice_hint';
  // O-0736: 대표님 「녹음 듣는 시간이 너무 짧다」 — 말 사이 쉼 2초에 끊던 것을 7초로(「다 말했어요」를 누르면 바로 끝), 처음 말을 시작하기까지 12초, 한 번에 최대 5분.
  //   값을 바꿀 곳은 이 한 줄이다(받아쓰기 플러그인 KSpeech 자체는 쉼에서 스스로 끝나도 곧바로 다시 듣는 이어 듣기라 따로 고칠 것이 없다).
  var MIC_QUIET_MS = 7000, MIC_NOSPEECH_MS = 12000, MIC_MAX_MS = 300000, MIC_COUNT_MS = 3000, MIC_FINAL_WAIT_MS = 2500, MIC_READY_MS = 10000, UNDO_MS = 8000;
  var MIC_WHY = { permission: '마이크 권한이 없습니다. 폰 설정 → 애플리케이션 → 스마트비서 → 권한에서 마이크를 허용해 주십시오',
                  nospeech: '말씀이 들리지 않아 멈췄습니다', nomatch: '잘 알아듣지 못했습니다',
                  busy: '다른 곳에서 마이크를 쓰고 있습니다. 잠시 뒤 다시 눌러 주십시오', network: '인터넷 연결이 불안정해 받아쓰기가 멈췄습니다',
                  lang: '이 폰에서 한국어 받아쓰기를 쓸 수 없습니다', recording: '회의 녹음 중에는 받아쓰기를 쓸 수 없습니다' };

  var S = { open: false, phase: '', raw: '', rows: [], unread: [], ustate: {}, bases: {}, loading: {}, ctx: null, env: null, note: '', gen: 0, ignored: {} };
  var mic = null, built = false, undoTimer = null, parseTimer = null, onTabNow = 'today', kbd = false;

  function K(text) { try { if (H) H.say(text); } catch (e) {} }
  function Kback() { try { if (H) H.unsay(); } catch (e) {} }

  /* ---------- 틀 만들기 ---------- */
  function build() {
    if (built) return true;
    var view = $('healthView'); if (!view) return false;
    H = (root.HealthTab && root.HealthTab.voice) || H;
    if (!H) return false;
    built = true;
    var pill = doc.createElement('button');
    pill.type = 'button'; pill.id = 'hvPill'; pill.className = 'hv-pill'; pill.hidden = true;
    pill.setAttribute('aria-label', isNative() ? '말로 기록' : '글로 기록');
    pill.innerHTML = '<span class="hv-pill-ic" aria-hidden="true">' + (isNative() ? '🎤' : '✍') + '</span><span class="hv-pill-tx">' + (isNative() ? '말로 기록' : '글로 기록') + '</span>';
    view.appendChild(pill);
    var sheet = doc.createElement('div');
    sheet.id = 'hvSheet'; sheet.className = 'hv-sheet'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', '말로 기록');
    sheet.innerHTML =
      '<div class="hv-back" id="hvBack"></div>' +
      '<div class="hv-panel" id="hvPanel">' +
        '<div class="hv-grab" aria-hidden="true"></div>' +
        '<div class="hv-head"><b id="hvTitle"></b><button type="button" class="hv-x" id="hvX" aria-label="닫기">닫기</button></div>' +
        '<div class="hv-body" id="hvBody">' +
          '<div class="hv-listen" id="hvListen" hidden>' +
            '<div class="hv-bars" id="hvBars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>' +
            '<div class="hv-clock" id="hvClock" aria-hidden="true"></div>' +
            '<div class="hv-live" id="hvLive" aria-live="polite"></div>' +
            '<div class="hv-hint" id="hvHint"></div>' +
            '<div class="hv-acts"><button type="button" class="hv-btn pri" id="hvDone">다 말했습니다</button><button type="button" class="hv-btn" id="hvCancel">취소</button></div>' +
          '</div>' +
          '<div class="hv-msg" id="hvMsg" hidden></div>' +
          '<div class="hv-card" id="hvCard" hidden>' +
            '<label class="hv-lab" for="hvHeard">들은 말 <small>(틀리게 적혔으면 고쳐 주십시오 — 아래가 바로 다시 계산됩니다)</small></label>' +
            '<textarea id="hvHeard" class="hv-heard" rows="3" inputmode="text" autocomplete="off" placeholder="예: 공복혈당 98, 체중 71.2, 아침은 계란"></textarea>' +
            '<div class="hv-rows" id="hvRows"></div>' +
            '<div class="hv-unread" id="hvUnread"></div>' +
            '<div class="hv-acts"><button type="button" class="hv-btn pri" id="hvSave">저장</button><button type="button" class="hv-btn" id="hvAgain">다시 말하기</button></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    view.appendChild(sheet);
    var bar = doc.createElement('div');
    bar.id = 'hvUndo'; bar.className = 'hv-undo'; bar.hidden = true; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span id="hvUndoTx"></span><button type="button" id="hvUndoBtn">되돌리기</button>';
    view.appendChild(bar);
    view.classList.add('hv-on');
    pill.addEventListener('click', openSheet);
    $('hvX').addEventListener('click', function () { closeSheet(true); });
    $('hvBack').addEventListener('click', function () { if (S.phase === 'card' || S.phase === 'msg') closeSheet(true); });
    $('hvCancel').addEventListener('click', function () { stopMic(true); closeSheet(true); });
    $('hvDone').addEventListener('click', function () { stopMic(false, 'tap'); });
    $('hvAgain').addEventListener('click', function () { startListen(); });
    $('hvSave').addEventListener('click', doSave);
    $('hvHeard').addEventListener('input', function () {
      S.raw = $('hvHeard').value;
      if (parseTimer) clearTimeout(parseTimer);
      parseTimer = setTimeout(recompute, 350);
    });
    // 키보드가 올라와 입력칸에 글자를 칠 때는 알약이 키보드 위에서 칸을 가리지 않게 숨긴다
    view.addEventListener('focusin', function (e) { if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && !(sheet.contains(e.target))) { kbd = true; syncPill(); } });
    view.addEventListener('focusout', function (e) { if (!(e.target && sheet.contains(e.target))) setTimeout(function () { var a = doc.activeElement; kbd = !!(a && view.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && !sheet.contains(a)); syncPill(); }, 120); });
    // 건강 화면을 떠나면(홈 등) 듣던 것을 멈추고 시트를 닫는다
    try {
      new MutationObserver(function () { if (view.style.display === 'none') { stopMic(true); if (S.open) closeSheet(false); } }).observe(view, { attributes: true, attributeFilter: ['style'] });
    } catch (e) {}
    doc.addEventListener('visibilitychange', function () { if (doc.hidden && mic) stopMic(false, 'hidden'); });
    return true;
  }

  function syncPill() {
    var p = $('hvPill'); if (!p) return;
    var today = $('hToday'), ok = !!(today && today.style.display !== 'none') && onTabNow !== 'history';
    p.hidden = !(ok && !S.open && !kbd);
  }
  function onTab(which) { onTabNow = which; build(); syncPill(); }

  /* ---------- 시트 열고 닫기 ---------- */
  function setPhase(ph) {
    S.phase = ph;
    var sh = $('hvSheet'); if (!sh) return;
    $('hvListen').hidden = ph !== 'listen';
    $('hvMsg').hidden = ph !== 'msg';
    $('hvCard').hidden = ph !== 'card';
    sh.setAttribute('data-phase', ph);
  }
  function openSheet() {
    if (!build() || !H) return;
    var ctx = H.ctx(); if (!ctx) return;
    S.ctx = ctx; S.open = true; S.raw = ''; S.rows = []; S.unread = []; S.ustate = {}; S.ignored = {}; S.lastIds = ''; S.bases = {}; S.loading = {}; S.note = ''; S.gen++;
    S.env = { screen: ctx.screen, today: ctx.today, base: function (d) { return S.bases[d]; }, lastWeight: function (d) { return H.lastWeight(d); } };
    var sh = $('hvSheet');
    sh.hidden = false; sh.classList.toggle('hv-calm', calm());
    void sh.offsetWidth; sh.classList.add('on');
    syncPill();
    if (isNative()) startListen(); else openType('글로 적으셔도 같은 카드로 정리해 드립니다');
  }
  function closeSheet(restore) {
    stopMic(true);
    var sh = $('hvSheet'); if (!sh) return;
    S.gen++; S.open = false;
    sh.classList.remove('on');
    var fin = function () { sh.hidden = true; };
    if (calm()) fin(); else setTimeout(fin, 200);
    if (restore !== false) Kback();
    try { var a = doc.activeElement; if (a && sh.contains(a)) a.blur(); } catch (e) {}
    syncPill();
  }
  function setTitle(t) { var e = $('hvTitle'); if (e) e.textContent = t; }

  /* ---------- 듣기 ---------- */
  function showMsg(title, html, withAgain) {
    setPhase('msg'); setTitle(title);
    $('hvMsg').innerHTML = '<div class="hv-msg-tx">' + html + '</div><div class="hv-acts">' +
      (withAgain ? '<button type="button" class="hv-btn pri" id="hvMsgAgain">다시 말하기</button>' : '') +
      '<button type="button" class="hv-btn" id="hvMsgType">글로 적기</button><button type="button" class="hv-btn" id="hvMsgClose">닫기</button></div>';
    var a = $('hvMsgAgain'); if (a) a.addEventListener('click', startListen);
    $('hvMsgType').addEventListener('click', function () { openType(); });
    $('hvMsgClose').addEventListener('click', function () { closeSheet(true); });
  }
  function openType(note) {
    S.raw = ''; S.note = note || '';
    setPhase('card'); setTitle('말씀하신 내용');
    $('hvHeard').value = '';
    K('이렇게 적을까요? 말씀하신 내용을 적어 주십시오.');
    recompute();
    setTimeout(function () { try { if (S.open && S.phase === 'card' && !isNative()) $('hvHeard').focus({ preventScroll: true }); } catch (e) {} }, 260);
  }
  function startListen() {
    stopMic(true);
    if (!S.open) return;
    var KS = null; try { if (isNative() && root.Capacitor && root.Capacitor.Plugins) KS = root.Capacitor.Plugins.KSpeech || null; } catch (e) {}
    if (!KS) { openType('이 기기에서는 받아쓰기를 쓸 수 없어 글로 적어 주십시오'); return; }
    if (host.sttBusy && host.sttBusy()) { toast('음성 대화 중이라 받아쓰기를 켤 수 없습니다. 글로 적어 주십시오', 3500); openType('음성 대화 중이라 받아쓰기를 켤 수 없습니다. 글로 적어 주십시오'); return; }
    S.ustate = {}; S.ignored = {}; S.lastIds = '';                      // 새로 말하면 이전 카드에서 만진 것은 이어 가지 않는다
    setPhase('listen'); setTitle('듣고 있습니다');
    $('hvLive').textContent = '준비 중입니다…';
    var first = lsGet(HINT_KEY) !== '1';
    $('hvHint').innerHTML = first
      ? '이렇게 말씀해 보십시오<br><b>「혈당 98, 체중은 안 쟀어, 아침은 양배추랑 계란 먹었어, 오늘은 운동 안 했어」</b><br>한 번에 여러 가지를 쭉 말씀하셔도 됩니다. 쉬었다 말씀하셔도 계속 듣습니다. 다 끝나면 「다 말했습니다」를 눌러 주십시오.'
      : '예: 「혈당 98, 체중은 안 쟀어, 아침은 계란」 — 쉬었다 말씀하셔도 계속 듣습니다. 다 끝나면 「다 말했습니다」';
    lsSet(HINT_KEY, '1');
    K('듣고 있습니다. 편하게 말씀하십시오.');
    var m = mic = { KS: KS, hs: [], acc: '', cur: '', heard: false, quietT: null, noSpT: null, finT: null, readyT: null, clockT: null, t0: Date.now(), lastAct: Date.now(), endNote: '', ready: false, stopping: false, ended: false };
    screenHold(true);
    function text() { return (m.acc + (m.acc && m.cur ? ' ' : '') + m.cur).trim(); }
    function show() {
      var t = text(); if (t) m.heard = true; var lv = $('hvLive');
      if (lv && S.phase === 'listen') { lv.textContent = t || (m.ready ? '듣는 중… 편하게 말씀하십시오' : '준비 중입니다…'); lv.scrollTop = lv.scrollHeight; }      // 길게 말하면 칸 안에서 스크롤 — 단추가 밀려 내려가지 않게
    }
    function quiet() { m.lastAct = Date.now(); clearTimeout(m.quietT); m.quietT = setTimeout(function () { m.quietT = null; if (mic === m) stopMic(false, 'quiet'); }, MIC_QUIET_MS); }
    function tick() {                                      // 듣는 시간(0:00)과 곧 마무리된다는 안내 — 0.5초마다
      if (mic !== m || m.ended || S.phase !== 'listen') return;
      var now = Date.now(), el = Math.floor((now - m.t0) / 1000), ck = $('hvClock'); if (!ck) return;
      var tx = '듣는 시간 ' + Math.floor(el / 60) + ':' + (el % 60 < 10 ? '0' : '') + (el % 60);
      if (!m.stopping && m.heard) { var left = MIC_QUIET_MS - (now - m.lastAct); if (left <= MIC_COUNT_MS && left > 0) tx += ' · ' + Math.ceil(left / 1000) + '초 뒤 마무리합니다 — 계속 말씀하셔도 됩니다'; }
      ck.textContent = tx;
      if (!m.stopping && now - m.t0 >= MIC_MAX_MS) { m.endNote = '5분이 되어 여기까지 들은 말로 정리했습니다'; stopMic(false, 'max'); }
    }
    m.clockT = setInterval(tick, 500); tick();
    function on(ev, fn) { try { var h = KS.addListener(ev, function (e) { if (!m.ended && (mic === m || m.stopping)) fn(e || {}); }); if (h && h.then) h.then(function (x) { if (m.ended) { try { x.remove(); } catch (e) {} } else m.hs.push(x); }); else if (h) m.hs.push(h); } catch (e) {} }
    on('ready', function () {
      m.ready = true; clearTimeout(m.readyT);
      if (m.stopping) return;
      show();
      if (!m.heard) { clearTimeout(m.noSpT); m.noSpT = setTimeout(function () { if (mic === m && !m.heard) stopMic(false, 'nospeech'); }, MIC_NOSPEECH_MS); }
    });
    on('speech', function () { clearTimeout(m.noSpT); if (!m.stopping) quiet(); });
    on('rms', function (e) { var lv = Math.max(0, Math.min(1, ((+e.db || 0) + 2) / 12)); var b = $('hvBars'); if (b && !calm()) b.style.setProperty('--lv', lv.toFixed(2)); });
    on('partial', function (e) { m.cur = e.text || ''; show(); clearTimeout(m.noSpT); if (!m.stopping) quiet(); });
    on('segment', function (e) {       // 인식기가 쉼에서 스스로 한 토막을 끝냄(곧바로 다시 듣는 중). 빈 토막(말 없음 시간 초과)이나 쉼 뒤에 오는 결과로 조용한 시간을 다시 세지 않는다 — 아니면 말이 없어도 끝나지 않는다(O-0736)
      if (e.text) { m.acc = (m.acc ? m.acc + ' ' : '') + e.text; m.cur = ''; } show();          // 빈 토막은 지금까지 보이던 부분 결과를 지우지 않는다(말이 조용히 사라지지 않게)
      if (!m.stopping && m.heard && e.text && !m.quietT) quiet();            // 부분 결과를 못 주는 인식기를 위한 안전장치: 아직 조용한 시간 세기가 시작되지 않았을 때만
    });
    on('final', function (e) { if (e.text) { m.cur = e.text; } show(); m.acc = (m.acc + ' ' + m.cur).trim(); m.cur = ''; micEnd(m, null, null, false, text()); });
    on('error', function (e) { micEnd(m, m.stopping && /nospeech|nomatch|client/.test(e.reason || '') ? null : (e.reason || 'other'), null, false, text()); });
    try {
      var opt = { lang: 'ko-KR', partial: true, continuous: true, muteRestart: false, sfx: (host.sfx && host.sfx()) || 'soft' };
      var pr = KS.start(opt);
      if (pr && pr.then) pr.then(function () { if (!m.ended && !m.ready) m.readyT = setTimeout(function () { if (mic === m && !m.ready) micEnd(m, 'start', '인식기가 준비되지 않음', false, text()); }, MIC_READY_MS); }, function () {});
      if (pr && pr.catch) pr.catch(function (err) {
        var code = (err && (err.code || err.errorCode)) || '';
        micEnd(m, code === 'recording' ? 'recording' : (code === 'permission' || /권한|permission/i.test(String(err && err.message)) ? 'permission' : 'start'), err && err.message, false, text());
      });
    } catch (e) { micEnd(m, 'start', e && e.message, false, text()); }
    m.text = text;
  }
  // 듣는 동안 화면이 꺼지지 않게(폰 화면 꺼짐 시간이 30초쯤이면 길게 말하는 도중 앱이 가려져 받아쓰기가 끊긴다 — visibilitychange 가 멈춤으로 처리). 앱이 건넨 host.screen 이 다른 기능(음성 대화·긴 올리기)의 화면 켜 두기를 풀지 않게 처리한다.
  var heldLock = null;
  function screenHold(on) {
    try { if (host.screen) host.screen(!!on); } catch (e) {}
    try {
      if (on) { if (root.navigator && navigator.wakeLock && !heldLock && !doc.hidden) navigator.wakeLock.request('screen').then(function (l) { if (!mic) { try { l.release(); } catch (e) {} return; } heldLock = l; try { l.addEventListener('release', function () { if (heldLock === l) heldLock = null; }); } catch (e) {} }, function () {}); }
      else if (heldLock) { try { heldLock.release(); } catch (e) {} heldLock = null; }
    } catch (e) {}
  }
  function stopMic(hard, why) {
    var m = mic; if (!m) return;
    if (hard || m.stopping) { micEnd(m, null, null, true); return; }
    m.stopping = true; clearTimeout(m.quietT); clearTimeout(m.noSpT); clearTimeout(m.readyT);
    var ck0 = $('hvClock'); if (ck0 && S.phase === 'listen') ck0.textContent = '';
    var lv = $('hvLive'); if (lv && S.phase === 'listen') lv.textContent = '정리하는 중…';
    try { m.KS.stop(); } catch (e) {}
    m.finT = setTimeout(function () { micEnd(m, why === 'nospeech' && !m.heard ? 'nospeech' : null, null, false, m.text ? m.text() : ''); }, MIC_FINAL_WAIT_MS);
    if (why === 'nospeech' && !m.heard) { clearTimeout(m.finT); micEnd(m, 'nospeech', null, false, ''); }
  }
  function micEnd(m, reason, detail, cancel, heardText) {
    if (m.ended) return; m.ended = true;
    clearTimeout(m.quietT); clearTimeout(m.noSpT); clearTimeout(m.finT); clearTimeout(m.readyT); clearInterval(m.clockT);
    screenHold(false);
    var ck1 = $('hvClock'); if (ck1) ck1.textContent = '';
    if (cancel || reason) { try { m.KS.cancel(); } catch (e) {} }
    setTimeout(function () { m.hs.forEach(function (h) { try { h.remove(); } catch (e) {} }); }, 300);
    if (mic === m) mic = null;
    var bars = $('hvBars'); if (bars) bars.style.setProperty('--lv', '0');
    if (cancel || !S.open) return;
    var text = String(heardText || '').trim();
    var why = reason ? (MIC_WHY[reason] || ('받아쓰기가 멈췄습니다' + (detail ? '(' + String(detail).slice(0, 40) + ')' : ''))) : '';
    if (text) { S.raw = text; S.note = why ? why + ' — 여기까지 들은 말로 정리했습니다' : (m.endNote || ''); toCard(); return; }
    if (reason) showMsg('받아쓰기를 하지 못했습니다', esc(why) + '.', reason !== 'permission' && reason !== 'recording');
    else showMsg('들은 말이 없습니다', '받아 적은 말이 없습니다. 이렇게 말씀해 보십시오 — 「공복혈당 98, 체중 71.2, 아침은 계란」', true);
    K(reason ? '받아쓰기를 하지 못했습니다.' : '잘 들리지 않았습니다. 다시 말씀해 주십시오.');
  }

  /* ---------- 확인 카드 ---------- */
  function toCard() {
    setPhase('card'); setTitle('말씀하신 내용');
    $('hvHeard').value = S.raw;
    K('이렇게 적을까요?');
    recompute();
  }
  function recompute() {
    if (!S.open || S.phase !== 'card') return;
    var parsed = parse(S.raw, { hour: S.ctx.hour, learned: S.ctx.learned, chips: S.ctx.chips });
    S.unread = parsed.unread.filter(function (x) { return !S.ignored[x]; });
    S.rows = buildRows(parsed, S.env, S.ustate);
    // 읽어 온 적 없는 날짜의 서버 값 읽기
    var gen = S.gen;
    S.rows.forEach(function (r) {
      var d = r.date;
      if (S.bases[d] !== undefined || S.loading[d]) return;
      S.loading[d] = true;
      H.peek(d).then(function (b) { return b; }, function () { return { ok: false }; }).then(function (b) {
        if (gen !== S.gen) return;
        S.bases[d] = b; delete S.loading[d];
        S.rows.forEach(function (rr) { evalRow(rr, S.env, S.ustate); });
        render();
      });
    });
    render();
  }
  function rowsPending() { return S.rows.some(function (r) { return r.pending; }); }
  function render() {
    if (!S.open || S.phase !== 'card') return;
    var host2 = $('hvRows'), html = '', lastDate = null, shown = S.rows.length;
    var wait = rowsPending();
    if (S.note) html += '<div class="hv-note warn">' + esc(S.note) + '</div>';
    S.rows.forEach(function (r, i) {
      if (r.date !== lastDate) {
        lastDate = r.date;
        var tag = dateTag(r.date, S.env);
        if (tag) html += '<div class="hv-date">' + esc(tag) + '에 적습니다</div>';
      }
      html += rowHtml(r, i);
    });
    if (!shown) {
      html += '<div class="hv-empty"><b>기록할 내용을 찾지 못했습니다.</b><br>이렇게 말씀해 보십시오 — 「공복혈당 98, 체중 71.2, 아침은 계란」<br>위의 들은 말을 고쳐도 됩니다.</div>';
    }
    if (wait) html += '<div class="hv-wait">그날 기록을 확인하고 있습니다…</div>';
    var ids = S.rows.map(function (r) { return r.id; }).join(',');
    host2.className = 'hv-rows' + (ids !== S.lastIds && !calm() ? ' anim' : '');       // 체크를 눌러 다시 그릴 때마다 흔들리지 않게 — 행 구성이 바뀐 때만 등장 움직임
    S.lastIds = ids;
    host2.innerHTML = html;
    var un = '';
    S.unread.forEach(function (u, i) { un += '<div class="hv-un"><span>읽지 못한 말: 「' + esc(u) + '」</span><button type="button" data-ig="' + i + '">무시</button></div>'; });
    $('hvUnread').innerHTML = un;
    var n = S.rows.filter(function (r) { return r.checked && !r.locked && !r.pending; }).length;
    var sv = $('hvSave');
    sv.textContent = n ? '저장 (' + n + '칸)' : '저장';
    sv.disabled = !n || wait;
    bindRows();
  }
  function rowHtml(r, i) {
    var cls = 'hv-row' + (r.status === 'same' ? ' same' : '') + (r.status === 'diff' ? ' diff' : '') + (r.range === 'warn' ? ' warn' : '') + (r.range === 'block' ? ' block' : '') + (r.locked ? ' locked' : '') + (r.checked ? ' on' : '');
    var h = '<div class="' + cls + '" data-id="' + esc(r.id) + '" style="--i:' + Math.min(i, 6) + '">';
    h += '<button type="button" class="hv-ck" data-ck="' + esc(r.id) + '" role="checkbox" aria-checked="' + (r.checked ? 'true' : 'false') + '" aria-label="' + esc(r.label) + ' 적기"' + ((r.locked || r.range === 'block' || r.pending) ? ' disabled' : '') + '><svg><use href="#i-check"/></svg></button>';
    h += '<div class="hv-main"><div class="hv-l1"><b>' + esc(r.label) + '</b>';
    if (r.type === 'meal' && !r.none && r.tokens.length) {
      h += '<span class="hv-tks">' + r.tokens.map(function (x) { return '<span class="hv-tk">' + esc(x) + '<button type="button" data-rm="' + esc(r.id) + '" data-w="' + esc(x) + '" aria-label="' + esc(x) + ' 빼기">×</button></span>'; }).join('') + '</span>';
    } else h += '<span class="hv-val">' + esc(r.display) + '</span>';
    h += '</div>';
    r.notes.forEach(function (t) { h += '<div class="hv-nt">' + esc(t) + '</div>'; });
    if (r.locked && r.lockWhy) h += '<div class="hv-nt bad">' + esc(r.lockWhy) + '</div>';
    var ch = '';
    if (r.cands && r.cands.length > 1) ch += r.cands.map(function (c) { return '<button type="button" class="hv-c' + (c === r.v ? ' on' : '') + '" data-pick="' + esc(r.id) + '" data-c="' + esc(c) + '">' + esc(c === SKIP_TOK ? SKIP_TOK : r.type === 'num' ? numText(r.k, c) : r.type === 'sleep' ? fmtSleep(c) : c) + '</button>'; }).join('');
    if (r.kcands) ch += r.kcands.map(function (c) { return '<button type="button" class="hv-c' + (c === r.k ? ' on' : '') + '" data-kpick="' + esc(r.id) + '" data-c="' + esc(c) + '">' + (c === 'med_evening' ? '저녁약' : '아침약') + '</button>'; }).join('');
    if (r.modes && r.modes.length > 1) ch += r.modes.map(function (m) { return '<button type="button" class="hv-c' + (m === r.mode ? ' on' : '') + '" data-mode="' + esc(r.id) + '" data-m="' + m + '">' + (m === 'append' ? '덧붙이기' : '바꾸기') + '</button>'; }).join('');
    if (r.fixes && r.fixes.length) ch += r.fixes.map(function (f) { return '<button type="button" class="hv-c fix" data-fix="' + esc(r.id) + '" data-f="' + f + '">' + esc(String(r.v) + ' → ' + numText(r.k, f) + '?') + '</button>'; }).join('');
    if (ch) h += '<div class="hv-cs">' + ch + '</div>';
    h += '</div></div>';
    return h;
  }
  function rowById(id) { for (var i = 0; i < S.rows.length; i++) if (S.rows[i].id === id) return S.rows[i]; return null; }
  function touch(id, patch) {
    var u = S.ustate[id] || (S.ustate[id] = {});
    for (var k in patch) u[k] = patch[k];
    var r = rowById(id); if (r) evalRow(r, S.env, S.ustate);
    render();
  }
  function bindRows() {
    var root2 = $('hvRows');
    Array.prototype.forEach.call(root2.querySelectorAll('[data-ck]'), function (b) { b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-ck')); if (r) touch(r.id, { checked: !r.checked }); }); });
    Array.prototype.forEach.call(root2.querySelectorAll('[data-pick]'), function (b) {
      b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-pick')); if (!r) return; var c = b.getAttribute('data-c'); touch(r.id, { v: (r.type === 'num' || r.type === 'sleep') && c !== SKIP_TOK ? parseFloat(c) : c, checked: true }); });
    });
    Array.prototype.forEach.call(root2.querySelectorAll('[data-kpick]'), function (b) { b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-kpick')); if (r) touch(r.id, { k: b.getAttribute('data-c'), checked: true }); }); });
    Array.prototype.forEach.call(root2.querySelectorAll('[data-mode]'), function (b) { b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-mode')); if (r) touch(r.id, { mode: b.getAttribute('data-m'), checked: true }); }); });
    Array.prototype.forEach.call(root2.querySelectorAll('[data-fix]'), function (b) { b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-fix')); if (r) touch(r.id, { fix: parseFloat(b.getAttribute('data-f')), checked: true }); }); });
    Array.prototype.forEach.call(root2.querySelectorAll('[data-rm]'), function (b) {
      b.addEventListener('click', function () { var r = rowById(b.getAttribute('data-rm')); if (!r) return; var u = S.ustate[r.id] || (S.ustate[r.id] = {}); u.rm = (u.rm || []).concat(b.getAttribute('data-w')); touch(r.id, {}); });
    });
    Array.prototype.forEach.call($('hvUnread').querySelectorAll('[data-ig]'), function (b) {
      b.addEventListener('click', function () { var i = +b.getAttribute('data-ig'); var t = S.unread[i]; if (t === undefined) return; S.ignored[t] = 1; S.unread.splice(i, 1); render(); });
    });
  }

  /* ---------- 저장 ---------- */
  function doSave() {
    if (!S.open || S.phase !== 'card' || !H) return;
    var ops = opsOf(S.rows);
    if (!ops.length) { toast('적을 칸을 체크해 주십시오'); return; }
    var res;
    try { res = H.apply(ops); } catch (e) { toast('적지 못했습니다. 다시 눌러 주십시오'); return; }
    var n = res.n;
    closeSheet(false);
    showUndo('적고 있습니다… (' + n + '칸)', res, false);
    res.saved.then(function (st) {
      var left = res.left(), dw = (S.ctx && S.ctx.mode === 'today') ? '오늘 ' : '';
      var msg, tail = left > 0 ? ' ' + dw + left + '칸 남았습니다.' : left === 0 ? ' ' + dw + '9칸이 다 찼습니다.' : '';
      if (st === 'ok') msg = '적어 두었습니다 (' + n + '칸).' + tail;
      else if (st === 'nopass') msg = '연동 암호가 없어 폰에만 적어 두었습니다. 암호를 넣어 주시면 올려 두겠습니다';
      else msg = '폰에는 적어 두었습니다. 연결되면 올려 두겠습니다';
      showUndo(msg, res, true);
      K(st === 'ok' ? '적어 두었습니다.' + tail : '폰에 적어 두었습니다. 연결되면 올려 두겠습니다.');
      setTimeout(function () { if (!S.open) Kback(); }, 5000);
    });
  }
  function showUndo(text, res, done) {
    var bar = $('hvUndo'); if (!bar) return;
    $('hvUndoTx').textContent = text;
    bar.hidden = false; bar.classList.add('on');
    var btn = $('hvUndoBtn');
    btn.hidden = !res.undo;
    btn.onclick = function () {
      clearTimeout(undoTimer); hideUndo();
      var p = res.undo(); res.undo = null;
      if (p && p.then) p.then(function () { toast('되돌렸습니다'); }); else toast('되돌렸습니다');
    };
    clearTimeout(undoTimer);
    if (done) undoTimer = setTimeout(hideUndo, UNDO_MS);
    else undoTimer = setTimeout(hideUndo, 25000);          // 아직 올리는 중이면 길게 두고, 결과가 오면 위에서 다시 8초
  }
  function hideUndo() { var bar = $('hvUndo'); if (!bar) return; bar.classList.remove('on'); setTimeout(function () { if (!bar.classList.contains('on')) bar.hidden = true; }, 200); }

  /* ---------- 바깥에서 부르는 것 ---------- */
  function setHealth(h) { H = h; }
  function back() {                         // 폰 뒤로가기: 열린 시트부터 닫는다
    if (S.open) { if (mic) stopMic(true); closeSheet(true); return true; }
    return false;
  }
  root.HealthVoice = (function () {
    var o = {}; for (var k in API) o[k] = API[k];
    o.onTab = onTab; o.back = back; o.setHealth = setHealth;
    o.setHost = function (h) { host = h || {}; };
    o.micOn = function () { return !!mic; };
    o.isOpen = function () { return S.open; };
    return o;
  })();
})(typeof window !== 'undefined' ? window : globalThis);

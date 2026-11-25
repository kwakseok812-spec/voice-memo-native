/* ============================================================================
 * manga.js — 「만화」 (v10.27, O-0950 · v10.28, O-0954)  PC 의 만화를 폰 앱 안에서 읽는다 + 웹툰 찾기·담기(스위치 MANGA_WEB)
 * ----------------------------------------------------------------------------
 * 화면: 서재(겉그림 격자 · 맨 위 「이어 읽기」 띠) → 회차 목록(읽음 표시) → 읽기(세로 스크롤 / 좌→우 넘김 / 우→좌 넘김)
 * 서버: 서버 함수 manga_state_get · manga_req · manga_req_get · manga_files_list · manga_cursor_set 과 서명 함수 manga-file.
 *       모든 호출은 연동 암호 게이트(틀리면 BAD_PASSCODE). 계약 전문은 약속 문서(API_CONTRACT.md) — 이 파일은 그 문서를 그대로 따른다.
 * 읽는 방향(요청 11/25 「웹툰은 세로이고, 왼쪽에서 오른쪽으로 보이도록」):
 *   · 세로로 아주 긴 그림(높이/폭 > 2.2)이 첫 쪽이면 「세로」, 아니면 「좌→우」가 기본값. 읽는 중 위쪽 알약을 한 번 누르면
 *     세로 → 좌→우 → 우→좌 순으로 바뀌고, 만화별로 기억한다(설정 화면 없음).
 * 사실대로 말하기: 못 불러온 것을 「0건」으로 꾸미지 않는다. 상태 문구는 서버가 알려 준 시각으로만 판정한다
 *   (PC 꺼짐 / 중계 멈춤 / 만화 프로그램 쉬는 중 / 서재 비어 있음 / 못 불러옴 / 암호 불일치 / 서버 준비 중 / 인터넷 불안정).
 * 쪽 받기: 중계가 현재 쪽 기준 앞 6쪽·뒤 2쪽만 서버에 올려 두므로(그림은 3시간짜리 서명 주소), 앱은 보기 직전에 주소를 받아
 *   그림을 이 기기 메모리(blob)에 담아 둔다. 이미 본 쪽은 서버에서 지워져도 다시 볼 수 있다(최대 36쪽, 넘으면 먼 쪽부터 비움).
 *   폰에 파일을 저장하지 않는다(메모리뿐 · 화면을 닫으면 비움).
 * 스위치: app.js 의 MANGA_UI('on' | 'off' — off 면 홈 칸이 없어 v10.26 과 같다). 새 권한·새 네이티브 코드 없음.
 *   v10.28: MANGA_WEB('on' | 'off' — off 면 「웹툰 찾기」 칸과 웹툰 표시가 없어 v10.27 과 같다). 웹툰은 서재에 PC 만화와 한 목록, 세로 이어 읽기가 기본,
 *   볼 수 없는 화는 「이 화는 앱에서 볼 수 없어요」 안내 + 「네이버웹툰에서 보기」(바깥 브라우저·앱으로 열기, 앱이 직접 받지 않음).
 *   v10.29(O-0961·O-0960): 스위치 MANGA_BROWSE('on' | 'off' — off 면 v10.28 화면 그대로). 서재 | 웹툰 탭, 웹툰 탭은 요일별·완결 전체 목록을 표지 격자로(3열/크게 보기 2열),
 *   표지를 누르면 서재에 담지 않고 바로 회차 목록 → 읽기(서재에 담기는 선택), 회차 「1화부터 / 최신 화부터」 정렬(작품별 기억), PC 만화도 서재에서 뺄 수 있다(PC의 보관 폴더로 옮김, 삭제 아님).
 *   PC 중계가 0.4 미만이면 v10.28 방식(+ 웹툰 찾기 칸)으로 보인다.
 * 시험: MangaPure · MangaApiFactory 는 화면 없이 밖에서 시험할 수 있게 내놓았다(node 에서도 require 가능).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 순수 함수
   * ===================================================================*/
  var K = {
    RELAY_LIVE: 20,        // 중계 하트비트가 이 초 안이면 살아 있음(계약 1-1)
    PC_STALE: 120,         // PC 일꾼이 이 초 넘게 조용하면 꺼진 것(기존 PC 상태 화면과 같은 기준)
    STATE_POLL: 20000,     // 화면이 열려 있는 동안 상태 확인 간격(watch=true, 중계가 1초 간격으로 빨라진다)
    REQ_POLL: 400,         // 요청 결과 확인 간격(0.3~0.5초)
    REQ_MAX: 90000,        // 요청 하나를 기다리는 최대
    AHEAD: 6, BEHIND: 2,   // 중계의 쪽 보관 창과 같은 값
    WEBTOON: 2.2,          // 높이/폭이 이보다 크면 웹툰형(서버와 같은 기준)
    BLOB_MAX: 36,          // 한 번에 기기 메모리에 담아 두는 쪽 수 상한
    SIGN_MAX: 12,          // 서명 함수 한 번에 받는 id 수(서버 상한)
    BARS_MS: 3200,         // 읽기 화면 위·아래 줄이 저절로 숨는 시간
    COV_BATCH: 18,         // 표지를 한 번에 요청하는 수(중계 상한 24)
    COV_PAR: 2,            // 동시에 보내는 표지 요청 수(서버 대기 한도 때문에 한두 개씩)
    CV_KEEP_MS: 14 * 86400000, CV_MAX: 700,    // 폰에 기억하는 표지: 14일·700장까지
    BL_KEEP_MS: 3 * 86400000,                  // 폰에 기억하는 마지막 목록(글자)
    BL_FRESH_MS: 300000,   // 뒤로 돌아왔을 때 이 시간 안이면 목록을 다시 받지 않는다
    NEED_VER: '0.4'        // 웹툰 목록 기능이 있는 중계 버전
  };
  var DAY_NAME = ['월', '화', '수', '목', '금', '토', '일'];
  var MODES = ['v', 'ltr', 'rtl'];
  var MODE_NAME = { v: '세로', ltr: '좌→우', rtl: '우→좌' };
  var MODE_SAY = { v: '세로로 읽어요', ltr: '왼쪽에서 오른쪽으로 읽어요', rtl: '오른쪽에서 왼쪽으로 읽어요' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ts(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function isWebtoon(w, h) { w = num(w); h = num(h); return w > 0 && h / w > K.WEBTOON; }
  function autoMode(file) { return file && isWebtoon(file.w, file.h) ? 'v' : 'ltr'; }
  function nextMode(m) { var i = MODES.indexOf(m); return MODES[(i + 1) % MODES.length]; }
  function okMode(m) { return MODES.indexOf(m) >= 0 ? m : ''; }

  /* 서버가 알려 준 시각만으로 판정(계약 1-1). 중계가 살아 있으면 PC 도 켜져 있는 것이라 PC 일꾼 시각보다 먼저 본다. */
  function judgeState(st) {
    if (!st || typeof st !== 'object') return { k: 'unknown' };
    var now = ts(st.server_now), rs = ts(st.relay_seen_at), ps = ts(st.pc_seen_at);
    if (now === null) return { k: 'unknown' };
    var relayAge = rs === null ? null : (now - rs) / 1000;
    var pcAge = ps === null ? null : (now - ps) / 1000;
    var info = (st.relay_info && typeof st.relay_info === 'object') ? st.relay_info : {};
    if (relayAge !== null && relayAge < K.RELAY_LIVE) {
      if (info.suwayomi === false) return { k: 'sw', relayAge: relayAge, pcAge: pcAge, web: info.web || '', ver: info.v || '', browse: info.browse || '', plat: info.plat || '', pf: info.pf || null };
      return { k: 'ok', relayAge: relayAge, pcAge: pcAge, web: info.web || '', ver: info.v || '', browse: info.browse || '', plat: info.plat || '', pf: info.pf || null };
    }
    if (pcAge === null || pcAge > K.PC_STALE) return { k: 'pcoff', relayAge: relayAge, pcAge: pcAge };
    return { k: 'relay', relayAge: relayAge, pcAge: pcAge };
  }

  /* 화면에 말할 문장(케이 말투, 기술 용어 없음). pose 는 케이가 취할 자세. */
  var SAY = {
    pcoff: { say: 'PC가 꺼져 있어요.', sub: '켜지면 다시 볼 수 있어요.', pose: 'sorry', retry: true },
    relay: { say: 'PC의 만화 연결이 멈춰 있어요.', sub: 'PC는 켜져 있는데 만화를 가져오는 부분만 쉬고 있어요. 케이에게 다시 켜 달라고 말씀해 주세요.', pose: 'sorry', retry: true },
    sw: { say: 'PC의 만화 프로그램이 쉬고 있어요.', sub: '조금 있다가 다시 확인해 볼게요.', pose: 'sorry', retry: true },
    empty: { say: '서재가 비어 있어요.', sub: 'PC에 만화를 넣거나 아래 +로 웹툰을 담아 보세요.', pose: 'guide', retry: true },
    fail: { say: '못 불러왔어요.', sub: '잠깐 뒤에 다시 해 볼까요?', pose: 'sorry', retry: true },
    net: { say: '인터넷이 불안정한 것 같아요.', sub: '연결을 확인하고 다시 해 볼까요?', pose: 'sorry', retry: true },
    badpass: { say: '연동 암호가 맞지 않아요.', sub: '암호를 다시 확인해 주세요.', pose: 'sorry', pass: true },
    nopass: { say: '연동 암호를 넣으면 PC의 만화를 볼 수 있어요.', sub: '', pose: 'guide', pass: true },
    notready: { say: 'PC의 만화 프로그램이 아직 준비되지 않았어요.', sub: '준비가 끝나면 이 화면에서 바로 보여요.', pose: 'sorry', retry: true },
    load: { say: 'PC에서 서재를 가져오고 있어요.', sub: '', pose: 'desk' },
    slow: { say: '조금 걸리고 있어요.', sub: 'PC가 바쁜 것 같아요. 조금만 기다려 주세요.', pose: 'desk' },
    nopages: { say: '이 화에는 볼 쪽이 없어요.', sub: '', pose: 'sorry' },
    nofile: { say: '그림을 만들지 못했어요.', sub: '다시 해 보시거나 다른 화를 골라 주세요.', pose: 'sorry', retry: true },
    timeout: { say: 'PC가 너무 오래 걸려서 멈췄어요.', sub: '잠깐 뒤에 다시 해 볼까요?', pose: 'sorry', retry: true },
    /* v10.28(O-0954) 웹툰 — 쉬운 말만(「중계」·「확장」·「소스」·「로컬」 없음) */
    locked: { say: '이 화는 앱에서 볼 수 없어요.', sub: '네이버웹툰에서는 볼 수 있을지도 몰라요.', pose: 'sorry' },
    blocked: { say: '네이버가 지금 답하지 않아요.', sub: '한 시간쯤 뒤에 다시 해 보세요. PC에 넣어 둔 만화는 그대로 볼 수 있어요.', pose: 'sorry' },
    weboff: { say: '웹툰 기능이 꺼져 있어요.', sub: 'PC에 넣어 둔 만화는 그대로 볼 수 있어요.', pose: 'sorry' },
    agebad: { say: '이 작품은 담을 수 없어요.', sub: '연령 제한이 있는 작품이에요.', pose: 'sorry' },
    ageunk: { say: '지금은 담을 수 없어요.', sub: '잠시 뒤에 다시 해 보세요.', pose: 'sorry' },
    full: { say: '웹툰 서재가 가득 찼어요.', sub: '안 보는 웹툰을 빼고 다시 담아 주세요.', pose: 'sorry' },
    findload: { say: '케이가 웹툰을 찾고 있어요.', sub: '', pose: 'desk' },
    noresult: { say: '찾는 웹툰이 없어요.', sub: '다른 말로 다시 찾아 보세요.', pose: 'guide' },
    /* v10.29(O-0961·O-0960) */
    budget: { say: '오늘은 많이 봤어요.', sub: '내일 다시 열어 드릴게요. 서재에 있는 만화는 그대로 볼 수 있어요.', pose: 'sorry' },
    notopen: { say: '지금은 열 수 없는 작품이에요.', sub: '다른 작품을 골라 주세요.', pose: 'sorry' },
    localbusy: { say: '지금 읽고 있나 봐요.', sub: '잠시 뒤에 다시 해 주세요.', pose: 'sorry' },
    removeoff: { say: '지금은 PC 만화 빼기가 꺼져 있어요.', sub: '', pose: 'sorry' },
    lfail: { say: '서재에서 빼지 못했어요.', sub: '잠깐 뒤에 다시 해 볼까요?', pose: 'sorry' },
    openload: { say: '케이가 작품을 열고 있어요.', sub: '', pose: 'desk' },
    listload: { say: '케이가 웹툰 목록을 가져오고 있어요.', sub: '', pose: 'desk' },
    listempty: { say: '이 요일에 올라온 작품이 없어요.', sub: '', pose: 'guide' },
    agebado: { say: '이 작품은 열 수 없어요.', sub: '연령 제한이 있는 작품이에요.', pose: 'sorry' },
    ageunko: { say: '지금은 열 수 없어요.', sub: '잠시 뒤에 다시 해 보세요.', pose: 'sorry' },
    wtempty: { say: '서재가 비어 있어요.', sub: 'PC에 만화를 넣거나 웹툰 탭에서 담아 보세요.', pose: 'guide' }
  };
  /* 요청 오류 → 말할 문장 종류 */
  function errKind(e, st) {
    if (!e) return 'fail';
    var k = e.kind;
    if (k === 'badpass' || k === 'nopass' || k === 'notready' || k === 'net') return k;
    if (k === 'expired') {                    // 아무도 안 가져감 = 원인을 상태로 구분
      var j = judgeState(st);
      return (j.k === 'pcoff' || j.k === 'relay' || j.k === 'sw') ? j.k : 'relay';
    }
    if (k === 'failed') {
      var c = e.code || '';
      if (c === 'suwayomi_down') return 'sw';
      if (c === 'no_pages') return 'nopages';
      if (c === 'no_page_file') return 'nofile';
      if (c === 'relay_timeout') return 'timeout';
      if (c === 'locked_or_empty') return 'locked';
      if (c === 'source_blocked') return 'blocked';
      if (c === 'web_off') return 'weboff';
      if (c === 'age_blocked') return 'agebad';
      if (c === 'age_unknown') return 'ageunk';
      if (c === 'shelf_full') return 'full';
      if (c === 'budget_exhausted') return 'budget';
      if (c === 'not_openable') return 'notopen';
      if (c === 'local_busy') return 'localbusy';
      if (c === 'remove_off') return 'removeoff';
      if (c === 'bad_path' || c === 'local_fail') return 'lfail';
      return 'fail';
    }
    if (k === 'timeout') return 'timeout';
    return 'fail';
  }

  /* 네이버웹툰에서 열 주소 — 중계가 준 경로(/webtoon/detail?titleId=숫자&no=숫자)일 때만 만든다(그 밖은 열지 않는다) */
  function naverUrl(u) { return /^\/webtoon\/detail\?titleId=\d{1,10}&no=\d{1,6}$/.test(u || '') ? 'https://comic.naver.com' + u : ''; }
  /* 웹툰 회차 목록은 오래된 화 → 새 화 순으로 놓고(「다음 화」 계산) 화면에는 거꾸로(새 화 먼저) 보인다 */
  function webItems(chs) { var a = (chs || []).map(function (c) { var o = {}; for (var k in c) o[k] = c[k]; o.order = num(c.number, num(c.order)); return o; }); a.sort(function (x, y) { return x.order - y.order; }); return a; }
  function fmtMB(bytes) {
    var m = num(bytes) / 1048576;
    if (m < 0.1) return '0.1MB 안쪽';
    if (m < 10) return '약 ' + m.toFixed(1) + 'MB';
    return '약 ' + Math.round(m) + 'MB';
  }
  /* 이 회차 전체 크기 어림 = 지금까지 본 쪽 평균 × 쪽 수(쪽당 평균은 files[].bytes) */
  function chapterBytes(files, total) {
    var sum = 0, n = 0;
    (files || []).forEach(function (f) { var b = num(f && f.bytes); if (b > 0) { sum += b; n++; } });
    return n ? Math.round(sum / n * num(total)) : 0;
  }
  function avgRatio(dims) {            // 지금까지 알려진 쪽들의 평균 높이/폭(모르면 3:4 만화 쪽)
    var s = 0, n = 0, k;
    for (k in dims) if (dims.hasOwnProperty(k)) { var d = dims[k]; if (d && d.w > 0) { s += d.h / d.w; n++; } }
    return n ? s / n : 1.42;
  }
  /* 넘김 가로줄의 칸 번호 ↔ 쪽 번호. 칸은 total+1 개(마지막은 「다 읽었어요」 카드). 우→좌는 칸을 거꾸로 놓는다. */
  function pageToIdx(p, total, rtl) { var n = total + 1; p = Math.max(0, Math.min(total, p)); return rtl ? n - 1 - p : p; }
  function idxToPage(i, total, rtl) { var n = total + 1; i = Math.max(0, Math.min(n - 1, i)); return rtl ? n - 1 - i : i; }

  /* 이 기기에 적어 둔 읽은 위치와 서버 회차 정보를 합친다 */
  function mergeChapter(ch, loc) {
    loc = loc || {};
    var srv = Math.max(0, num(ch.last_page));
    var read = !!ch.is_read || !!loc.r;
    var page = Math.max(srv, num(loc.p));
    var st = read ? 'read' : (page > 0 ? 'prog' : 'new');
    return { id: ch.id, name: ch.name, order: ch.order, number: num(ch.number, 0), locked: !!ch.locked, u: ch.u || '', pages: num(ch.pages, -1), state: st, page: page, total: num(loc.t) || (ch.pages > 0 ? ch.pages : 0) };
  }
  /* 「이어 읽기」가 가리킬 회차 — 읽던 회차(가장 뒤) → 없으면 읽은 회차 다음 → 없으면 처음 → 다 읽었으면 처음부터 */
  function resumeTarget(items) {
    var i, best = -1;
    for (i = 0; i < items.length; i++) if (items[i].state === 'prog') best = i;
    if (best >= 0) return { idx: best, page: items[best].page, label: '이어 읽기' };
    var lastRead = -1;
    for (i = 0; i < items.length; i++) if (items[i].state === 'read') lastRead = i;
    if (lastRead >= 0 && lastRead < items.length - 1) return { idx: lastRead + 1, page: 0, label: '다음 화 읽기' };
    if (lastRead >= 0) return { idx: 0, page: 0, label: '처음부터 다시 읽기' };
    return items.length ? { idx: 0, page: 0, label: '처음부터 읽기' } : null;
  }
  function nextChapterIdx(items, cid) {
    for (var i = 0; i < items.length; i++) if (items[i].id === cid) return i + 1 < items.length ? i + 1 : -1;
    return -1;
  }
  /* 지금 쪽 기준 받아 둘 쪽(현재 → 앞 → 뒤) */
  function wantedPages(page, total) {
    var out = [], p;
    if (total > 0 && page > total - 1) page = total - 1;      // 끝 카드까지 내려가도 마지막 쪽 기준으로 받아 둔다(세로에서 휙 내렸을 때 빈칸이 남지 않게)
    for (p = page; p <= Math.min(total - 1, page + K.AHEAD); p++) out.push(p);
    for (p = page - 1; p >= Math.max(0, page - K.BEHIND); p--) out.push(p);
    return out;
  }

  /* ---- v10.29 순수 함수 ---- */
  /* "0.4" 같은 버전 문자열을 숫자 마디로 비교(0.10 > 0.4). 모르면 false */
  function verAtLeast(v, min) {
    var a = String(v || '').split('.'), b = String(min || '').split('.'), i;
    if (!/^\d+(\.\d+)*$/.test(String(v || ''))) return false;
    for (i = 0; i < Math.max(a.length, b.length); i++) { var x = parseInt(a[i] || '0', 10), y = parseInt(b[i] || '0', 10); if (x !== y) return x > y; }
    return true;
  }
  /* 한국시간 날짜·요일(월=0 … 일=6). 폰 시계가 어느 나라든 한국 기준으로 */
  function kstInfo(ms) {
    var d = new Date((ms === undefined ? Date.now() : ms) + 9 * 3600000);
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return { date: y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd, wd: (d.getUTCDay() + 6) % 7 };
  }
  var VIEWS = ['day', 'done'], SORTS_DAY = ['pop', 'upd', 'star'], SORTS_DONE = ['upd', 'star'];
  /* 저장해 둔 보기 상태를 믿을 수 있는 값으로 고친다. 같은 날이면 그대로, 날짜가 바뀌면 요일만 오늘로. */
  function normBrowse(o, nowMs) {
    o = (o && typeof o === 'object') ? o : {};
    var k = kstInfo(nowMs), out = {};
    out.tab = o.tab === 'lib' || o.tab === 'wt' ? o.tab : '';
    out.view = VIEWS.indexOf(o.view) >= 0 ? o.view : 'day';
    out.sort = SORTS_DAY.indexOf(o.sort) >= 0 ? o.sort : 'pop';
    out.sortDone = SORTS_DONE.indexOf(o.sortDone) >= 0 ? o.sortDone : 'upd';
    out.cols = o.cols === 2 ? 2 : 3;
    out.date = k.date;
    out.day = (o.date === k.date && o.day >= 0 && o.day <= 6 && o.day === (o.day | 0)) ? o.day : k.wd;
    return out;
  }
  function isSample(title) { return /^샘플(\s|$)/.test(String(title || '')); }
  /* 서재가 비었거나 샘플뿐이면 true — 「웹툰」 탭을 기본으로 보일지 정할 때 쓴다 */
  function libIsThin(mangas) { var a = mangas || []; return a.length === 0 || a.every(function (m) { return isSample(m.title); }); }
  function clockHM(ms) { var d = new Date(ms); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); }
  function fmtStar(s) { var n = Number(s); return isFinite(n) && n > 0 ? '★' + n.toFixed(2) : ''; }
  function listTitle(view, day, total) { return (view === 'done' ? '완결 웹툰' : DAY_NAME[day] + '요 웹툰') + ' · ' + total + '편'; }
  function listKey(view, day, sort) { return view === 'done' ? 'done:' + sort : 'day:' + day + ':' + sort; }
  /* 회차를 보이는 순서로: asc = 1화부터, desc = 최신 화부터. chapItems 자체는 늘 번호 오름차순이라 「다음 화」 계산이 틀어지지 않는다. */
  function chapterOrder(items, dir) { var a = (items || []).slice(); return dir === 'desc' ? a.reverse() : a; }
  function okDir(d) { return d === 'asc' || d === 'desc' ? d : ''; }
  /* 이어 읽던 화 — 읽은 흔적이 있을 때만(처음 읽기 전에는 강조하지 않는다) */
  function resumeHighlight(items) {
    var t = resumeTarget(items || []);
    if (!t) return -1;
    var started = (items || []).some(function (c) { return c.state === 'read' || c.state === 'prog'; });
    return started ? t.idx : -1;
  }
  /* 표지 요청 묶음 만들기 — 이미 있는·이미 요청 중인 것은 빼고, 앞에서부터 max 개 */
  function takeCoverBatch(queue, have, pending, max) {
    var out = [], rest = [];
    for (var i = 0; i < queue.length; i++) {
      var t = queue[i];
      if (have[t] || pending[t]) continue;
      if (out.length < max && out.indexOf(t) < 0) out.push(t); else if (rest.indexOf(t) < 0) rest.push(t);
    }
    return { batch: out, rest: rest };
  }

  /* 이 기기 저장소(localStorage)에 적는 읽은 위치·방향·마지막 읽은 곳. 저장소가 막혀 있어도(시험·사생활 보호 창) 앱은 그대로 돈다. */
  function makeStore(ls) {
    var POS = 'smart_manga_pos', LAST = 'smart_manga_last', MODE = 'smart_manga_mode_', SEEN = 'smart_manga_seen_', SORT = 'smart_manga_sort_', BROWSE = 'smart_manga_browse', HINT = 'smart_manga_libhint', PFK = 'smart_manga_pf', PFI = 'smart_manga_pfinfo';
    function rd(k) { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } }
    function wr(k, v) { try { if (ls) ls.setItem(k, v); } catch (e) {} }
    function pos() { try { var o = JSON.parse(rd(POS) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    return {
      getPos: function (cid) { return pos()[cid] || null; },
      setPos: function (cid, p, t, r) {
        var o = pos(), ks;
        o[cid] = { p: Math.max(0, p | 0), t: Math.max(0, t | 0), r: r ? 1 : 0, at: Date.now() };
        ks = Object.keys(o);
        if (ks.length > 300) { ks.sort(function (a, b) { return o[a].at - o[b].at; }); ks.slice(0, ks.length - 300).forEach(function (k) { delete o[k]; }); }
        wr(POS, JSON.stringify(o));
      },
      getLast: function () { try { var o = JSON.parse(rd(LAST) || 'null'); return (o && o.cid) ? o : null; } catch (e) { return null; } },
      setLast: function (o) { wr(LAST, JSON.stringify(o)); },
      getMode: function (mid) { return okMode(rd(MODE + mid) || ''); },
      setMode: function (mid, m) { if (okMode(m)) wr(MODE + mid, m); },
      getSeen: function (mid) { var v = rd(SEEN + mid); if (v === null || v === '') return null; var n = Number(v); return isFinite(n) ? n : null; },   // 웹툰 — 마지막으로 회차 목록을 본 때의 가장 새 화 번호(없으면 처음 본 것)
      setSeen: function (mid, n) { wr(SEEN + mid, String(n)); },
      /* v10.29: 회차 정렬(작품별만 — 새 작품의 기본은 늘 1화부터) · 웹툰 보기 상태 · 서재에 만화가 있었는지 */
      getSort: function (mid) { return okDir(rd(SORT + mid) || ''); },
      setSort: function (mid, d) { if (okDir(d)) wr(SORT + mid, d); },
      getBrowse: function () { try { return JSON.parse(rd(BROWSE) || 'null'); } catch (e) { return null; } },
      setBrowse: function (o) { wr(BROWSE, JSON.stringify(o)); },
      getPf: function () { try { return JSON.parse(rd(PFK) || 'null'); } catch (e) { return null; } },
      setPf: function (o) { wr(PFK, JSON.stringify(o)); },
      getPfInfo: function () { try { return JSON.parse(rd(PFI) || 'null'); } catch (e) { return null; } },
      setPfInfo: function (o) { wr(PFI, JSON.stringify(o)); },
      getHint: function () { return rd(HINT) || ''; },
      setHint: function (v) { wr(HINT, v); }
    };
  }

  /* ---------------------------------------------------------------------
   * v10.31(O-0967) 플랫폼 고르기 — 순수 함수. 표(MangaPlatforms.rows) 항목 = [pf, 이름, 그룹, 언어, 방식, 사유, 주소]
   * 방식: r 앱에서 읽기(네이버웹툰만) · c 확인 중(PC가 알려 주기 전) · l 정식 사이트 열기만 / 사유 L·P·A·N
   * ------------------------------------------------------------------- */
  var PF_WHY = { L: '로그인이 필요해요', P: '사 보는 곳이에요', A: '성인 작품이 많은 곳이에요', N: '앱 안에서 읽는 길이 아직 없어요' };
  var PF_WHYK = { login: 'L', paid: 'P', adult: 'A', none: 'N' };
  var PF_GROUPS = [['kr', '국내'], ['en', '영어'], ['ja', '일본어'], ['zh', '중국어'], ['br', '게임·브랜드'], ['au', '작가 직영']];
  var PF_LANG = { 'ko': '한국어', 'ko-KR': '한국어', 'en': '영어', 'ja': '일본어', 'zh': '중국어', 'zh-Hans': '중국어', 'zh-Hant': '중국어', 'es': '스페인어', 'fr': '프랑스어', 'de': '독일어', 'pt-BR': '포르투갈어', 'id': '인도네시아어', 'th': '태국어', 'vi': '베트남어', 'ru': '러시아어', 'all': '여러 언어' };
  function pfRows(tbl) {
    var rs = (tbl && tbl.rows) || [];
    return rs.map(function (r) { return { pf: r[0], n: r[1], g: r[2], lang: r[3], m: r[4], w: r[5], url: r[6] || '' }; });
  }
  /* 한 플랫폼의 지금 상태: {s:'read'|'chk'|'link', w:사유 글자}. info = PC가 알려 준 그 플랫폼 칸({r:'on'|'test'|'off', w?}) 또는 없음.
   * 시험 전에는 네이버웹툰만 읽기, 나머지는 확인 중. 시험 통과 = 읽기, 탈락 = 정식 사이트 열기 + 사유. */
  function pfStatus(row, info) {
    if (row.m === 'r') return { s: 'read', w: '' };
    if (info && info.r === 'on') return { s: 'read', w: '' };
    if (info && info.r === 'off') return { s: 'link', w: PF_WHYK[info.w] || 'N' };
    if (row.m === 'l') return { s: 'link', w: row.w || 'N' };
    return { s: 'chk', w: '' };
  }
  function pfReason(w) { return PF_WHY[w] || PF_WHY.N; }
  function pfLangRank(lang) { return /^한국어/.test(lang || '') ? 0 : (lang === '영어' ? 1 : 2); }
  /* 기본 순서: 앱에서 읽기 → 한국어 → 영어 → 나머지(작가 직영은 맨 뒤), 같은 무리 안에서는 이름순 */
  function pfDefaultOrder(rows, infos) {
    return rows.slice().sort(function (a, b) {
      var ra = pfStatus(a, infos && infos[a.pf]).s === 'read' ? 0 : 1, rb = pfStatus(b, infos && infos[b.pf]).s === 'read' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      var ua = a.g === 'au' ? 1 : 0, ub = b.g === 'au' ? 1 : 0; if (ua !== ub) return ua - ub;      // 작가 직영은 맨 뒤
      var la = pfLangRank(a.lang), lb = pfLangRank(b.lang); if (la !== lb) return la - lb;
      var ha = /^[가-힣]/.test(a.n) ? 0 : 1, hb = /^[가-힣]/.test(b.n) ? 0 : 1; if (ha !== hb) return ha - hb;      // 이름순: 한글 이름이 먼저
      var na = String(a.n).toLowerCase(), nb = String(b.n).toLowerCase();
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });
  }
  /* 저장해 둔 설정을 믿을 수 있는 값으로. favs 가 없으면 네이버웹툰만 ★(처음 화면은 지금과 같게). */
  function pfNormPrefs(o, rows) {
    o = (o && typeof o === 'object') ? o : {};
    var ok = {}; rows.forEach(function (r) { ok[r.pf] = 1; });
    var favs = Array.isArray(o.favs) ? o.favs.filter(function (p, i, a) { return ok[p] && a.indexOf(p) === i; }) : ['naver'];
    var hid = Array.isArray(o.hid) ? o.hid.filter(function (p, i, a) { return ok[p] && a.indexOf(p) === i; }) : [];
    var mode = {}, k; if (o.mode && typeof o.mode === 'object') for (k in o.mode) if (ok[k] && o.mode[k] && typeof o.mode[k] === 'object') mode[k] = { m: o.mode[k].m === 'new' ? 'new' : 'pop', l: typeof o.mode[k].l === 'string' && /^[A-Za-z-]{1,12}$/.test(o.mode[k].l) ? o.mode[k].l : '' };
    return { cur: ok[o.cur] ? o.cur : 'naver', favs: favs.filter(function (p) { return hid.indexOf(p) < 0; }), hid: hid, mode: mode };
  }
  /* 시트에 보이는 순서: ★ 붙인 곳(고른 순서) → 나머지(기본 순서). 숨긴 곳은 showHid 일 때만 맨 뒤에. */
  function pfSheetOrder(rows, infos, prefs, showHid) {
    var by = {}; rows.forEach(function (r) { by[r.pf] = r; });
    var out = prefs.favs.map(function (p) { return by[p]; }).filter(function (r) { return !!r; });
    var rest = pfDefaultOrder(rows.filter(function (r) { return prefs.favs.indexOf(r.pf) < 0 && prefs.hid.indexOf(r.pf) < 0; }), infos);
    out = out.concat(rest);
    if (showHid) out = out.concat(pfDefaultOrder(rows.filter(function (r) { return prefs.hid.indexOf(r.pf) >= 0; }), infos));
    return out;
  }
  /* 웹툰 탭 칩 줄: ★ 붙인 곳(고른 순서) → 앱에서 읽을 수 있는 곳(기본 순서, 숨긴 곳 제외) — 지금 보는 곳은 항상 들어 있다 */
  function pfChipList(rows, infos, prefs, max) {
    max = max || 14;
    var by = {}; rows.forEach(function (r) { by[r.pf] = r; });
    var out = prefs.favs.map(function (p) { return by[p]; }).filter(function (r) { return !!r; });
    pfDefaultOrder(rows.filter(function (r) { return prefs.favs.indexOf(r.pf) < 0 && prefs.hid.indexOf(r.pf) < 0 && pfStatus(r, infos && infos[r.pf]).s === 'read'; }), infos).forEach(function (r) { if (out.length < max) out.push(r); });
    if (prefs.cur && !out.some(function (r) { return r.pf === prefs.cur; }) && by[prefs.cur]) out.splice(Math.min(1, out.length), 0, by[prefs.cur]);
    return out;
  }
  function pfFilter(list, group, q) {
    q = String(q || '').trim().toLowerCase();
    return list.filter(function (r) { return (!group || group === 'all' || r.g === group) && (!q || String(r.n).toLowerCase().indexOf(q) >= 0 || String(r.lang).indexOf(q) >= 0); });
  }
  /* 그룹 칩 숫자 — 지금 시트에 보이는 곳(숨긴 곳은 「숨긴 곳 보기」를 켰을 때만) 기준이라 그룹 합이 「전체」와 맞는다 */
  function pfGroupCounts(rows, prefs, showHid) {
    var shown = rows.filter(function (r) { return showHid || prefs.hid.indexOf(r.pf) < 0; });
    var c = { all: shown.length }; PF_GROUPS.forEach(function (g) { c[g[0]] = 0; });
    shown.forEach(function (r) { c[r.g] = (c[r.g] || 0) + 1; });
    return c;
  }
  function pfToggleFav(prefs, pf) {
    var i = prefs.favs.indexOf(pf), o = { cur: prefs.cur, favs: prefs.favs.slice(), hid: prefs.hid.slice(), mode: prefs.mode };
    if (i >= 0) o.favs.splice(i, 1); else { o.favs.push(pf); o.hid = o.hid.filter(function (p) { return p !== pf; }); }
    return o;
  }
  /* ▲▼ 는 ★ 붙인 곳들 사이에서만 */
  function pfMoveFav(prefs, pf, dir) {
    var i = prefs.favs.indexOf(pf), j = i + (dir < 0 ? -1 : 1), o = { cur: prefs.cur, favs: prefs.favs.slice(), hid: prefs.hid.slice(), mode: prefs.mode };
    if (i < 0 || j < 0 || j >= o.favs.length) return o;
    o.favs.splice(i, 1); o.favs.splice(j, 0, pf); return o;
  }
  function pfToggleHide(prefs, pf) {
    var i = prefs.hid.indexOf(pf), o = { cur: prefs.cur, favs: prefs.favs.slice(), hid: prefs.hid.slice(), mode: prefs.mode };
    if (i >= 0) o.hid.splice(i, 1); else { o.hid.push(pf); o.favs = o.favs.filter(function (p) { return p !== pf; }); if (o.cur === pf) o.cur = 'naver'; }
    return o;
  }
  /* 표가 서로 어긋나지 않는지(시험용): 같은 pf 두 번 · 이름 없음 · 알 수 없는 그룹·방식 · 주소가 https 아님 */
  function pfCheckTable(rows) {
    var seen = {}, bad = [], gs = {}; PF_GROUPS.forEach(function (g) { gs[g[0]] = 1; });
    rows.forEach(function (r) {
      if (!/^[a-z0-9_]{1,24}$/.test(r.pf) || seen[r.pf]) bad.push('pf:' + r.pf); seen[r.pf] = 1;
      if (!r.n) bad.push('name:' + r.pf);
      if (!gs[r.g]) bad.push('group:' + r.pf);
      if (['r', 'c', 'l'].indexOf(r.m) < 0) bad.push('mode:' + r.pf);
      if (r.url && !/^https:\/\/[A-Za-z0-9.-]+(\/|$)/.test(r.url)) bad.push('url:' + r.pf);
      if (r.m === 'l' && ['L', 'P', 'A', 'N'].indexOf(r.w) < 0) bad.push('why:' + r.pf);
    });
    return bad;
  }
  /* 정식 사이트로 열어도 되는 주소인가 — 표에 있는 https 주소 그대로만 */
  function pfSiteUrl(rows, pf) { var i; for (i = 0; i < rows.length; i++) if (rows[i].pf === pf) return /^https:\/\//.test(rows[i].url) ? rows[i].url : ''; return ''; }
  /* 서버 상태에서 온 플랫폼 칸을 믿을 수 있는 값으로(모르는 글자·너무 큰 값 버림) */
  function pfCleanInfo(o) {
    var out = {}, k, v, c;
    if (!o || typeof o !== 'object') return out;
    for (k in o) {
      if (!/^[a-z0-9_]{1,24}$/.test(k) || !o.hasOwnProperty(k)) continue;
      v = o[k]; if (!v || typeof v !== 'object') continue;
      c = { r: v.r === 'on' || v.r === 'off' ? v.r : 'test' };
      if (typeof v.w === 'string' && PF_WHYK[v.w]) c.w = v.w;
      if (num(v.b) > 0) c.b = Math.min(7200, num(v.b));
      if (v.c && typeof v.c === 'object') c.c = { pop: v.c.pop === 0 ? 0 : 1, 'new': v.c['new'] === 0 ? 0 : 1, search: v.c.search === 0 ? 0 : 1 };
      if (Array.isArray(v.l)) c.l = v.l.filter(function (x) { return typeof x === 'string' && /^[A-Za-z-]{1,12}$/.test(x); }).slice(0, 12);
      out[k] = c;
    }
    return out;
  }

  var MangaPure = {
    K: K, MODES: MODES, MODE_NAME: MODE_NAME, MODE_SAY: MODE_SAY, SAY: SAY, esc: esc, isWebtoon: isWebtoon, autoMode: autoMode, nextMode: nextMode,
    judgeState: judgeState, errKind: errKind, fmtMB: fmtMB, chapterBytes: chapterBytes, avgRatio: avgRatio, pageToIdx: pageToIdx, idxToPage: idxToPage,
    naverUrl: naverUrl, webItems: webItems, mergeChapter: mergeChapter, resumeTarget: resumeTarget, nextChapterIdx: nextChapterIdx, wantedPages: wantedPages, makeStore: makeStore,
    verAtLeast: verAtLeast, kstInfo: kstInfo, normBrowse: normBrowse, isSample: isSample, libIsThin: libIsThin, clockHM: clockHM, fmtStar: fmtStar, listTitle: listTitle, listKey: listKey,
    chapterOrder: chapterOrder, resumeHighlight: resumeHighlight, takeCoverBatch: takeCoverBatch, DAY_NAME: DAY_NAME,
    PF_WHY: PF_WHY, PF_GROUPS: PF_GROUPS, PF_LANG: PF_LANG, pfRows: pfRows, pfStatus: pfStatus, pfReason: pfReason, pfDefaultOrder: pfDefaultOrder, pfNormPrefs: pfNormPrefs, pfSheetOrder: pfSheetOrder, pfChipList: pfChipList,
    pfFilter: pfFilter, pfGroupCounts: pfGroupCounts, pfToggleFav: pfToggleFav, pfMoveFav: pfMoveFav, pfToggleHide: pfToggleHide, pfCheckTable: pfCheckTable, pfSiteUrl: pfSiteUrl, pfCleanInfo: pfCleanInfo
  };
  global.MangaPure = MangaPure;

  /* =====================================================================
   * 2. 서버 길(약속 문서 그대로) — 화면과 분리해 밖에서도 시험할 수 있다
   * ===================================================================*/
  function mkErr(kind, extra) {
    var e = new Error('manga:' + kind + (extra && extra.code ? ':' + extra.code : ''));
    e.mg = true; e.kind = kind;
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) e[k] = extra[k];
    return e;
  }
  /* dep = { cfg(): {url,key}, pass(): 연동 암호, fetch: fetch 함수 } */
  function makeApi(dep) {
    var f = function () { return (dep.fetch || global.fetch).apply(global, arguments); };
    function post(path, body, timeout) {
      var c = dep.cfg();
      if (!c) return Promise.reject(mkErr('config'));
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, timeout || 15000) : null;
      return f(c.url + path, {
        method: 'POST',
        headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ac ? ac.signal : undefined
      }).then(function (r) { if (to) clearTimeout(to); return r; }, function () { if (to) clearTimeout(to); throw mkErr('net'); });
    }
    function rpc(name, args, timeout) {
      var pass = dep.pass();
      if (!pass) return Promise.reject(mkErr('nopass'));
      args = args || {}; args.p_pass = pass;
      return post('/rest/v1/rpc/' + name, args, timeout).then(function (r) {
        if (r.status === 404) throw mkErr('notready');
        if (r.status >= 400) {
          return r.text().then(function (t) {
            if (r.status === 400 && /BAD_PASSCODE|28000/.test(t || '')) throw mkErr('badpass');
            if (r.status === 401 || r.status === 403) throw mkErr('badpass');
            throw mkErr('http', { status: r.status });
          });
        }
        return r.json().then(function (j) { return j; }, function () { throw mkErr('http', { status: r.status }); });
      });
    }
    function wait(id, o) {
      o = o || {};
      var t0 = Date.now(), max = o.max || K.REQ_MAX, errs = 0;
      return new Promise(function (res, rej) {
        (function tick() {
          if (o.cancelled && o.cancelled()) return rej(mkErr('cancel'));
          rpc('manga_req_get', { p_id: id }, 12000).then(function (j) {
            errs = 0;
            if (!j || j.ok === false) return rej(mkErr('gone'));
            if (j.status === 'done') return res(j.result || {});
            if (j.status === 'failed') return rej(mkErr('failed', { code: j.error || '' }));
            if (j.status === 'expired') return rej(mkErr('expired'));
            if (Date.now() - t0 > max) return rej(mkErr('timeout'));
            setTimeout(tick, o.interval || K.REQ_POLL);
          }, function (e) {
            if (e.kind === 'net' && ++errs < 4) return setTimeout(tick, 1200);   // 잠깐 끊긴 것은 세 번까지 다시 본다
            rej(e);
          });
        })();
      });
    }
    return {
      state: function (watch) { return rpc('manga_state_get', { p_watch: !!watch }, 12000); },
      submit: function (kind, params) {
        return rpc('manga_req', { p_kind: kind, p_params: params || {}, p_client: 'app' }, 15000).then(function (j) {
          if (j && j.ok && j.id) return j.id;
          throw mkErr('failed', { code: (j && j.error) || 'submit' });
        });
      },
      wait: wait,
      request: function (kind, params, o) { var self = this; return self.submit(kind, params).then(function (id) { return wait(id, o); }); },
      filesList: function (key) { return rpc('manga_files_list', { p_chapter_key: key }, 12000).then(function (j) { return (j && j.files) || []; }); },
      cursor: function (key, page, total) { return rpc('manga_cursor_set', { p_chapter_key: key, p_page: page, p_total: total || 0 }, 12000); },
      sign: function (ids) {
        var pass = dep.pass();
        if (!pass) return Promise.reject(mkErr('nopass'));
        return post('/functions/v1/manga-file', { a: 'sign', pass: pass, ids: ids.slice(0, K.SIGN_MAX) }, 20000).then(function (r) {
          if (r.status >= 400 && r.status !== 200) throw mkErr('http', { status: r.status });
          return r.json().then(function (j) {
            if (j && j.ok) return { urls: j.urls || {}, missing: j.missing || [] };
            if (j && j.error === 'bad_pass') throw mkErr('badpass');
            throw mkErr('http', { code: j && j.error });
          }, function () { throw mkErr('http'); });
        });
      },
      fetchBlob: function (url) {
        return f(url).then(function (r) { if (!r.ok) throw mkErr('http', { status: r.status }); return r.blob(); });
      }
    };
  }
  global.MangaApiFactory = makeApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = { MangaPure: MangaPure, makeApi: makeApi };
  if (typeof document === 'undefined') return;

  /* =====================================================================
   * 3. 화면
   * ===================================================================*/
  var host = { toast: function () {}, getPass: function () { return ''; }, askPass: null, openScreen: function () {}, cfg: function () { return null; }, web: true, browse: true, platforms: true, openUrl: function (u) { try { global.open(u, '_blank'); } catch (e) {} } };
  var $ = function (id) { return document.getElementById(id); };
  var api = null, store = null, inited = false, built = false;
  var view = 'lib';                  // lib | chap | find
  var lib = null;                    // {mangas, at, cov:{mangaId: blobUrl}}
  var curManga = null, chapItems = null;
  var stateTimer = null, lastJudge = null, loadTok = 0, libLoading = false;
  var rd = null;                     // 읽기 화면 한 번의 상태
  var pendingNext = 0;               // 「이어 읽기」 띠가 다 읽은 회차를 가리킬 때: 회차 목록을 받은 뒤 그 다음 화를 바로 연다
  var finder = { pop: null, res: null, q: '' };    // 웹툰 찾기 화면의 마지막 결과(화면을 다시 열 때 쓴다)
  var fcov = {};                     // 찾기 화면 표지(그림 id → 기기 메모리 주소)
  var lpTimer = 0, lpFired = 0;
  function webOn() { return host.web !== false && !(lastJudge && lastJudge.web === 'off'); }
  /* v10.29: 서재 | 웹툰 탭 화면. 앱 스위치(MANGA_BROWSE)가 꺼졌거나 PC 중계가 0.4 미만(또는 목록 기능을 끔)이면 v10.28 화면(+ 웹툰 찾기 칸)으로 보인다. */
  function browseOn() { return webOn() && host.browse !== false && !(lastJudge && lastJudge.ver !== undefined && (lastJudge.browse === 'off' || !verAtLeast(lastJudge.ver, K.NEED_VER))); }
  var LOCK_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  var PLUS_SVG = '<svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function motionOn() { try { if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {} try { if (global.KChar && KChar.motionOn && !KChar.motionOn()) return false; } catch (e2) {} return true; }
  function isShown() { var v = $('mangaView'); return !!(v && v.style.display !== 'none' && getComputedStyle(v).display !== 'none'); }
  function toast(m, ms) { try { host.toast(m, ms); } catch (e) {} }

  /* 케이 그림: 일하는 자세 그림이 있으면 그것을(배경 없음), 없으면 표정 사진을 둥글게. 새 그림·새 서버 조회 없음. */
  function kfig(pose, cls) {
    var f = { src: '', cut: false };
    try { if (global.KScene && KScene.fig) f = KScene.fig(pose); } catch (e) {}
    if (!f.src) f = { src: 'assets/k/burgundy_suit/pose_' + ({ sorry: 'apology', desk: 'desk', guide: 'guide', report: 'report' }[pose] || 'idle') + '.webp', cut: true };
    return '<span class="mg-kfig ' + (f.cut ? 'cut' : 'photo') + (cls ? ' ' + cls : '') + '" aria-hidden="true"><img alt="" src="' + esc(f.src) + '"></span>';
  }
  function sayCard(key, opt) {
    var s = SAY[key] || SAY.fail; opt = opt || {};
    var pn = pfCtxName();
    if (pn && GEN_SAY[key]) { var gs = GEN_SAY[key](pn); opt = { say: gs.say, sub: opt.sub != null ? opt.sub : gs.sub, extra: opt.extra }; }
    var acts = '';
    if (s.retry) acts += '<button type="button" class="mg-btn" data-act="retry">다시 확인하기</button>';
    if (s.pass) acts += '<button type="button" class="mg-btn" data-act="pass">연동 암호 ' + (key === 'badpass' ? '확인' : '넣기') + '</button>';
    if (opt.extra) acts += opt.extra;
    return '<div class="mg-say" role="status" data-say="' + key + '"><div class="mg-sayt"><b>' + esc(opt.say || s.say) + '</b>' + ((opt.sub != null ? opt.sub : s.sub) ? '<p>' + esc(opt.sub != null ? opt.sub : s.sub) + '</p>' : '') +
      (acts ? '<div class="mg-acts">' + acts + '</div>' : '') + '</div>' + kfig(s.pose) + '</div>';
  }

  /* ---------------------------------------------------------------- 짧은 도구 */
  function setTitle(t) { var el = $('mangaTitle'); if (el) el.textContent = t || '만화'; }
  function body() { return $('mangaBody'); }

  function build() {
    if (built) return;
    built = true;
    var b = body();
    b.addEventListener('click', onBodyClick);
    var lx = 0, ly = 0;      // 웹툰 칸을 길게 누르면 「서재에서 빼기」 시트(PC 에서는 오른쪽 단추)
    function lpClear() { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } }
    function lpSel() { return browseOn() ? '#mgGrid .mg-card[data-m]' : '.mg-card[data-o="web"]'; }       // v10.29: PC 만화도 길게 눌러 뺄 수 있다
    function lpStart(card) { lpClear(); lpTimer = setTimeout(function () { lpTimer = 0; var mid = Number(card.getAttribute('data-m')), m = null; if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.id === mid) m = x; }); if (m && view === 'lib') { lpFired = Date.now(); showRemoveSheet(m); } }, 600); }
    b.addEventListener('pointerdown', function (ev) { var c = ev.target.closest ? ev.target.closest(lpSel()) : null; if (c && view === 'lib') { lx = ev.clientX; ly = ev.clientY; lpStart(c); } });
    b.addEventListener('pointermove', function (ev) { if (lpTimer && (Math.abs(ev.clientX - lx) > 10 || Math.abs(ev.clientY - ly) > 10)) lpClear(); });
    b.addEventListener('pointerup', lpClear); b.addEventListener('pointercancel', lpClear);
    b.addEventListener('contextmenu', function (ev) { var c = ev.target.closest ? ev.target.closest(lpSel()) : null; if (c && view === 'lib') { ev.preventDefault(); lpClear(); var mid = Number(c.getAttribute('data-m')), m = null; if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.id === mid) m = x; }); if (m) { lpFired = Date.now(); showRemoveSheet(m); } } });
    var rf = $('mangaRefresh');
    if (rf) rf.addEventListener('click', function () { refresh(true); });
    buildReader();
  }

  /* ---------------------------------------------------------------- 상태 확인 */
  function pollState() {
    if (!api) return Promise.resolve(null);
    return api.state(true).then(function (st) {
      var j = judgeState(st), was = lastJudge; lastJudge = j; pfSync(j);
      if (rd) readerState(j);
      if (view === 'lib' && !rd && shellKind && shellKind !== (browseOn() ? 'browse' : 'old') && isShown()) { renderShell(); if (browseOn()) { markTab(); if (tab === 'wt') paintWtShell(); } if (lib && lib.mangas) paintLibrary(); }
      // 멈춰 있던 PC·중계가 되살아났고 서재를 아직 못 받았으면 저절로 다시 받는다
      if (was && was.k !== 'ok' && j.k === 'ok' && isShown() && !rd && view === 'lib' && (!lib || libFailed) && !libLoading) refresh(false, !!lib);
      return { st: st, j: j };
    });
  }
  var libFailed = false;
  function startStateTimer() {
    stopStateTimer();
    stateTimer = setInterval(function () {
      if (document.hidden || !isShown()) return;
      pollState(false).then(function (r) { if (r && view === 'lib' && !rd && r.j.k !== 'ok' && lib && lib.mangas && !libLoading) { libFailed = true; renderLibraryStatus(r.j.k); } }, function () {});
    }, K.STATE_POLL);
  }
  function stopStateTimer() { if (stateTimer) { clearInterval(stateTimer); stateTimer = null; } }

  /* ---------------------------------------------------------------- 서재 */
  function open() {
    build();
    view = 'lib'; curManga = null; chapItems = null;
    if (host.openScreen) host.openScreen();
    setTitle('만화');
    startStateTimer();
    initBrowseState();
    if (!host.getPass()) { renderShell(); var tp0 = body().querySelector('#mgTop') || body().querySelector('#mgWTop'); if (tp0) tp0.innerHTML = sayCard('nopass'); setRefresh(false); return; }
    renderShell();
    IDB.prune();
    if (browseOn()) {
      markTab();
      if (tab === 'wt') {
        paintWtShell(); wtLoad({}); if (lib && lib.mangas) paintLibrary();
        // 서재는 웹툰 목록·첫 표지가 먼저 오도록 잠깐 뒤에 조용히 확인한다(PC가 서재 갱신으로 바쁠 때 목록이 늦어지지 않게)
        setTimeout(function () { if (view === 'lib' && tab === 'wt' && isShown() && !libLoading && !rd) refreshLib(false, true); }, 3000);
        return;
      }
    }
    if (lib && lib.mangas) { paintLibrary(); refreshLib(false, true); } else refreshLib(false);
  }
  function setRefresh(on) { var rf = $('mangaRefresh'); if (rf) rf.style.visibility = on ? '' : 'hidden'; }
  function renderShell() {
    if (browseOn()) {
      shellKind = 'browse';
      body().innerHTML = '<div class="mg-wrap"><div class="mg-tabs" role="tablist" id="mgTabs"><button type="button" role="tab" data-tab="lib">서재</button><button type="button" role="tab" data-tab="wt">웹툰</button></div>' +
        '<div id="mgPaneLib"><div id="mgTop"></div><div id="mgResume"></div><div id="mgGrid" class="mg-grid" role="list"></div></div><div id="mgPaneWt"></div></div>';
      markTab();
    } else {
      shellKind = 'old';
      body().innerHTML = '<div class="mg-wrap"><div id="mgTop"></div><div id="mgResume"></div><div id="mgGrid" class="mg-grid" role="list"></div></div>';
    }
    setRefresh(true);
  }

  /* 서재를 새로 받는다. quiet=true 면 이미 보이는 서재를 그대로 두고 뒤에서 확인만 한다. */
  function refresh(force, quiet) {
    if (!api) return;
    if (view === 'chap') return loadChapters(curManga, true, true);
    if (view === 'find') return;
    if (browseOn() && tab === 'wt') { if (sres.on) return; wtLoad({ manual: !!force, force: true }); return; }
    refreshLib(force, quiet);
  }
  function refreshLib(force, quiet) {
    if (!api) return;
    var tok = ++loadTok;
    libLoading = true; libFailed = false;
    var top = body().querySelector('#mgTop');
    if (!quiet && top) top.innerHTML = sayCard('load');
    pollState(true).then(function (r) {
      if (tok !== loadTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { libLoading = false; libFailed = true; if (!(lib && lib.mangas)) { libStatus(r.j.k); } else renderLibraryStatus(r.j.k); return; }
      return api.request('library', {}, { cancelled: function () { return tok !== loadTok; } }).then(function (res) {
        if (tok !== loadTok) return;
        libLoading = false;
        lib = { mangas: res.mangas || [], at: Date.now(), cov: (lib && lib.cov) || {} };
        store.setHint(libIsThin(lib.mangas) ? 'thin' : 'real');
        if (browseOn() && !userTab && !tabAutoDone) { tabAutoDone = true; if (!libIsThin(lib.mangas) && tab === 'wt') { tab = 'lib'; markTab(); } }
        paintLibrary();
        loadCovers(tok);
      });
    }).then(null, function (e) {
      if (tok !== loadTok || (e && e.kind === 'cancel')) return;
      libLoading = false; libFailed = true;
      pollState(false).then(function (r) { fail(e, r && r.st); }, function () { fail(e, null); });
    });
    function fail(e, st) {
      var k = errKind(e, st);
      if (lib && lib.mangas) { renderLibraryStatus(k); toast(SAY[k].say, 2500); } else libStatus(k);
    }
  }
  function libStatus(k) { var top = body().querySelector('#mgTop'); if (top) top.innerHTML = sayCard(k); var g = body().querySelector('#mgGrid'); if (g) g.innerHTML = ''; var r = body().querySelector('#mgResume'); if (r) r.innerHTML = ''; }
  function renderLibraryStatus(k) { var top = body().querySelector('#mgTop'); if (top && view === 'lib') top.innerHTML = sayCard(k, { sub: (SAY[k].sub ? SAY[k].sub + ' ' : '') + '(마지막으로 받은 서재를 보여 드리고 있어요.)' }); }

  function plusTile() {
    return '<button type="button" class="mg-pcard mg-plus" data-act="find" aria-label="웹툰 찾아서 담기"><span class="mg-cov">' + PLUS_SVG + '</span><b class="mg-t">웹툰 찾기</b><small>찾아서 서재에 담아요</small></button>';
  }
  function paintLibrary() {
    if (view !== 'lib' || !body().querySelector('#mgGrid')) return;
    var ms = ((lib && lib.mangas) || []).filter(function (m) { return m.origin !== 'web' || webOn(); });
    var top = body().querySelector('#mgTop'), g = body().querySelector('#mgGrid');
    var plus = (webOn() && !browseOn()) ? plusTile() : '';       // v10.29: 탭이 「+ 웹툰 찾기」 칸을 대신한다
    if (!ms.length) {
      top.innerHTML = browseOn() ? sayCard('wtempty', { extra: '<button type="button" class="mg-btn pri" data-act="gowt">웹툰 보러 가기</button>' }) : sayCard('empty');
      g.innerHTML = plus; body().querySelector('#mgResume').innerHTML = ''; return;
    }
    top.innerHTML = '<div class="mg-hello" role="status"><b>만화가 ' + ms.length + '개 있어요.<br>뭘 볼까요?</b>' + kfig('guide', 'hi') + '</div>';
    var html = '', i;
    for (i = 0; i < ms.length; i++) {
      var m = ms[i], mid = num(m.id), unread = num(m.unread), total = num(m.total), url = lib.cov[m.id] || '', web = m.origin === 'web', done = m.status === 'done';
      var sub, badge = '';
      if (web) {
        sub = '총 ' + total + '화' + (done ? ' · 완결' : '');
        var seen = store.getSeen(mid);
        if (seen !== null && total > 0 && total > seen) badge = '<em class="mg-badge new">새 화</em>';
      } else {
        sub = total > 0 ? ('총 ' + total + '화' + (unread > 0 ? ' · 안 읽은 ' + unread : ' · 다 읽음')) : '회차 없음';
        if (unread > 0 && total > 0) badge = '<em class="mg-badge">안 읽은 ' + unread + '</em>';
      }
      html += '<button type="button" class="mg-card' + (motionOn() ? ' in' : '') + '" role="listitem" data-m="' + mid + '"' + (web ? ' data-o="web"' : '') + ' style="--i:' + Math.min(i, 12) + '">' +
        '<span class="mg-cov"' + (url ? '' : ' data-wait="1"') + '>' + (url ? '<img alt="" src="' + esc(url) + '">' : '<i></i>') + badge +
        (web ? '<em class="mg-pill">' + esc((m.pf && pfNameOf(m.pf)) || '웹툰') + '</em>' : '') + '</span>' +
        '<b class="mg-t">' + esc(m.title) + '</b><small>' + esc(sub) + '</small>' + (web && done ? '<small class="mg-free">앞부분만 무료예요</small>' : '') + '</button>';
    }
    g.innerHTML = plus + html;      // 「+ 웹툰 찾기」 칸은 맨 앞 — 눈에 바로 띄게
    paintResume();
  }
  function paintResume() {
    var box = body().querySelector('#mgResume'); if (!box) return;
    var last = store.getLast(), m = null, i;
    if (last && lib && lib.mangas) for (i = 0; i < lib.mangas.length; i++) if (lib.mangas[i].id === last.mid) m = lib.mangas[i];
    if (!last || !m) {      // 이 기기에 읽은 기록이 없으면 서버가 알려 준 가장 앞선 읽은 흔적(다른 기기에서 읽은 것)
      var srv = null;
      if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.last_read && !srv) srv = x; });
      if (srv) { m = srv; last = { mid: srv.id, mtitle: srv.title, cid: srv.last_read.id, cname: srv.last_read.name, p: srv.last_read.last_page || 0, t: 0, r: !!srv.last_read.is_read }; }
      else { box.innerHTML = ''; return; }
    }
    var url = lib.cov[m.id] || '';
    var lab = last.r ? '다 읽었어요 — 다음 화 보기' : ((last.p > 0 ? (last.p + 1) + '쪽' + (last.t ? ' / ' + last.t : '') : '처음') + '부터');
    box.innerHTML = '<button type="button" class="mg-resume" data-resume="1" aria-label="이어 읽기, ' + esc(m.title) + ' ' + esc(last.cname) + '">' +
      '<span class="mg-rc">' + (url ? '<img alt="" src="' + esc(url) + '">' : '') + '</span>' +
      '<span class="mg-rt"><small>이어 읽기</small><b>' + esc(m.title) + '</b><span>' + esc(last.cname) + ' · ' + esc(lab) + '</span></span><i aria-hidden="true">›</i></button>';
  }

  /* 겉그림: 서명 주소를 받아 기기 메모리에 담고 격자에 끼워 넣는다 */
  function loadCovers(tok) {
    if (!lib || !lib.mangas) return;
    var need = lib.mangas.filter(function (m) { return m.cover && m.cover.id && !lib.cov[m.id]; });
    for (var i = 0; i < need.length; i += K.SIGN_MAX) (function (grp) {
      api.sign(grp.map(function (m) { return m.cover.id; })).then(function (s) {
        grp.forEach(function (m) {
          var u = s.urls[m.cover.id]; if (!u) return;
          api.fetchBlob(u).then(function (b) { return URL.createObjectURL(b); }, function () { return u; }).then(function (src) {
            if (lib.cov[m.id]) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
            lib.cov[m.id] = src;
            if (tok === loadTok && view === 'lib') placeCover(m.id, src);
          });
        });
      }, function () { /* 겉그림이 안 와도 제목 칸은 보인다 */ });
    })(need.slice(i, i + K.SIGN_MAX));
  }
  function placeCover(mid, src) {
    var c = body().querySelector('.mg-card[data-m="' + mid + '"] .mg-cov');
    if (c) { var i = c.querySelector('i'); if (i) { var im = document.createElement('img'); im.alt = ''; im.src = src; c.insertBefore(im, c.firstChild); i.parentNode.removeChild(i); c.removeAttribute('data-wait'); } }
    var rc = body().querySelector('.mg-resume .mg-rc'); if (rc && !rc.firstChild) paintResume();
  }

  /* ---------------------------------------------------------------- 회차 목록 */
  function openManga(mid) {
    var m = null; if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.id === mid) m = x; });
    if (!m) return;
    curManga = m; view = 'chap'; chapItems = null; m.from = 'lib'; m.shelf = true; m.scrolled = false;
    wtScrollY = window.pageYOffset || 0;
    setTitle(m.title);
    body().innerHTML = '<div class="mg-wrap"><div id="mgChHead"></div><div id="mgTop"></div><div id="mgSortRow" class="mg-sortrow"></div><div id="mgList" class="mg-list"></div></div>';
    paintChapHead();
    window.scrollTo(0, 0);
    loadChapters(m, false);
  }
  function isWebManga(m) { return !!(m && m.origin === 'web'); }
  function paintChapHead() {
    var m = curManga, el = body().querySelector('#mgChHead'); if (!el || !m) return;
    var url = coverOf(m);
    el.innerHTML = '<div class="mg-chhead"><span class="mg-chcov">' + (url ? '<img alt="" src="' + esc(url) + '">' : '') + (isWebManga(m) ? '<em class="mg-pill">' + esc((m.pf && pfNameOf(m.pf)) || '웹툰') + '</em>' : '') + '</span><div class="mg-chinfo"><b>' + esc(m.title) + '</b><small id="mgChSub">' + (chapItems ? chapSub() : '회차를 가져오는 중…') + '</small><small id="mgChFree" class="mg-free"' + (isWebManga(m) && m.status === 'done' ? '' : ' hidden') + '>앞부분만 무료예요</small><div id="mgChBtn" class="mg-btnrow"></div></div></div>';
    if (chapItems) paintChapBtn();
    else if (browseOn() && isWebManga(m) && m.id && !isShelf(m)) { var bb = body().querySelector('#mgChBtn'); if (bb) bb.innerHTML = '<button type="button" class="mg-btn" data-act="addcur">서재에 담기</button>'; }
  }
  function chapSub() {
    var n = chapItems.length, un = chapItems.filter(function (c) { return c.state !== 'read'; }).length;
    if (isWebManga(curManga)) return '총 ' + n + '화 · ' + (curManga.status === 'done' ? '완결' : (curManga.status === 'ongoing' ? '연재 중' : '웹툰'));
    return '총 ' + n + '화 · ' + (un ? '안 읽은 ' + un + '화' : '다 읽었어요');
  }
  function paintChapBtn() {
    var t = resumeTarget(chapItems || []), el = body().querySelector('#mgChBtn'); if (!el) return;
    var h = t ? '<button type="button" class="mg-btn pri" data-act="go" data-c="' + num(chapItems[t.idx].id) + '" data-p="' + num(t.page) + '"' + (chapItems[t.idx].locked ? ' data-lock="1"' : '') + '>' + esc(t.label) + (t.page > 0 && !isWebManga(curManga) ? ' · ' + (t.page + 1) + '쪽' : '') + '</button>' : '';
    if (t && isWebManga(curManga) && chapItems.length && (t.idx > 0 || t.page > 0)) {      // 웹툰: 「이어 읽기」 옆에 「처음부터」
      var f = chapItems[0];
      h += '<button type="button" class="mg-btn" data-act="go" data-c="' + num(f.id) + '" data-p="0"' + (f.locked ? ' data-lock="1"' : '') + '>처음부터</button>';
    }
    if (browseOn() && isWebManga(curManga) && curManga.id && !isShelf(curManga)) h += '<button type="button" class="mg-btn" data-act="addcur">서재에 담기</button>';      // 서재에 담지 않고 읽는 작품 — 담기는 선택
    el.innerHTML = h;
  }
  function loadChapters(m, quiet, refresh) {
    if (!m) return;
    var tok = ++loadTok, top = body().querySelector('#mgTop'), web = isWebManga(m);
    if (!quiet && top) top.innerHTML = sayCard('load', { say: '회차를 가져오고 있어요.' });
    pollState(true).then(function (r) {
      if (tok !== loadTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { if (top && !chapItems) top.innerHTML = sayCard(r.j.k); return; }
      var prm = { manga_id: m.id }; if (web && refresh) prm.refresh = true;
      return api.request('chapters', prm, { cancelled: function () { return tok !== loadTok; }, max: web ? 120000 : undefined }).then(function (res) {
        if (tok !== loadTok) return;
        var prevNew = {}; (chapItems || []).forEach(function (c) { if (c.isnew) prevNew[c.id] = 1; });
        if (web) {
          chapItems = webItems(res.chapters).map(function (c) { return mergeChapter(c, store.getPos(c.id)); });
          var seen = store.getSeen(m.id), mx = 0;
          chapItems.forEach(function (c) { if (c.number > mx) mx = c.number; });
          chapItems.forEach(function (c) { c.isnew = !!prevNew[c.id] || (seen !== null && c.number > seen); });
          if (mx > 0) store.setSeen(m.id, mx);
          if (res.status) m.status = res.status;
          var fr = body().querySelector('#mgChFree'); if (fr) fr.hidden = !(m.status === 'done');
          if (res.refresh_limited && refresh) toast('방금 확인했어요. 삼십 분쯤 뒤에 다시 눌러 주세요.', 2600);
          else if (refresh) toast('새 화를 확인했어요.', 1800);
        } else {
          chapItems = (res.chapters || []).map(function (c) { return mergeChapter(c, store.getPos(c.id)); });
          chapItems.sort(function (a, b) { return a.order - b.order; });
        }
        if (top) top.innerHTML = chapItems.length ? '' : sayCard('empty', { say: '이 만화에는 아직 회차가 없어요.', sub: web ? '새 화가 올라오면 여기에 나타나요.' : 'PC에 넣어 둔 이 만화 폴더에 회차를 넣어 주세요.' });
        paintChapters();
        if (pendingNext) {
          var pn = pendingNext; pendingNext = 0;
          var ni = nextChapterIdx(chapItems, pn);
          if (ni >= 0) startReading(m, chapItems[ni].id, 0); else toast('마지막 화까지 다 읽으셨어요.', 2200);
        }
      });
    }).then(null, function (e) {
      if (tok !== loadTok || (e && e.kind === 'cancel')) return;
      pollState(false).then(function (r) { failChap(e, r && r.st); }, function () { failChap(e, null); });
    });
    function failChap(e, st) { if (top && !chapItems) top.innerHTML = sayCard(errKind(e, st)); else toast(SAY[errKind(e, st)].say, 2500); }
  }
  function chapDir() { return (curManga && store.getSort(curManga.id)) || 'asc'; }       // 새 작품의 기본은 늘 1화부터(기억은 작품별로만)
  function paintSortRow() {
    var el = body().querySelector('#mgSortRow'); if (!el) return;
    if (!browseOn() || !chapItems || chapItems.length < 2) { el.innerHTML = ''; return; }
    var d = chapDir();
    el.innerHTML = '<span class="mg-clab">회차 순서</span><div class="mg-chips"><button type="button" class="mg-c' + (d === 'asc' ? ' on' : '') + '" data-csort="asc" aria-pressed="' + (d === 'asc' ? 'true' : 'false') + '">1화부터</button>' +
      '<button type="button" class="mg-c' + (d === 'desc' ? ' on' : '') + '" data-csort="desc" aria-pressed="' + (d === 'desc' ? 'true' : 'false') + '">최신 화부터</button></div>';
  }
  function paintChapters() {
    var list = body().querySelector('#mgList'); if (!list || !chapItems) return;
    var html = '', web = isWebManga(curManga), dir = browseOn() ? chapDir() : (web ? 'desc' : 'asc'), arr = chapterOrder(chapItems, dir);      // v10.29: 기본은 1화부터(이전 판 웹툰은 새 화가 위)
    var hi = (browseOn() && dir === 'asc') ? resumeHighlight(chapItems) : -1, hiId = hi >= 0 ? chapItems[hi].id : -1;
    arr.forEach(function (c) {
      var st;
      if (c.locked) st = '<span class="mg-st lock">' + LOCK_SVG + '앱에서 볼 수 없어요</span>';
      else if (c.state === 'read') st = '<span class="mg-st read">읽음 ✓</span>';
      else if (c.state === 'prog') st = '<span class="mg-st prog">' + (web ? '읽는 중' : '읽는 중 · ' + (c.page + 1) + '쪽' + (c.total ? ' / ' + c.total : '')) + '</span>';
      else if (web) st = c.isnew ? '<span class="mg-st new">새 화</span>' : '';
      else st = '<span class="mg-st new">새 화</span>';
      html += '<button type="button" class="mg-ch ' + c.state + (c.locked ? ' lock' : '') + (web && c.isnew ? ' isnew' : '') + (c.id === hiId ? ' cur' : '') + '" data-c="' + num(c.id) + '" data-p="' + (c.state === 'prog' ? num(c.page) : 0) + '"' + (c.locked ? ' data-lock="1"' : '') + '><span class="mg-chn">' + esc(c.name) + (!web && c.pages > 0 ? '<small>' + c.pages + '쪽</small>' : '') + '</span>' + st + '</button>';
    });
    var canRm = browseOn() ? isShelf(curManga) : web;
    list.innerHTML = html + (canRm ? '<div class="mg-foot"><button type="button" class="mg-linkbtn" data-act="rmcur">서재에서 빼기</button></div>' : '');
    var sub = $('mgChSub'); if (sub) sub.textContent = chapSub();
    paintChapBtn(); paintSortRow();
    if (hiId !== -1 && curManga && !curManga.scrolled) {          // 1화부터 보기: 이어 읽던 화로 스크롤해 강조(긴 목록을 위에서부터 내려가지 않게)
      curManga.scrolled = true;
      var he = list.querySelector('.mg-ch.cur'); if (he && he.scrollIntoView) { try { he.scrollIntoView({ block: 'center' }); } catch (e) { he.scrollIntoView(); } }
    }
  }
  function sortChapters(d) {
    if (!curManga || !okDirLocal(d) || !chapItems) return;
    store.setSort(curManga.id, d); curManga.scrolled = true;
    var list = body().querySelector('#mgList');
    if (list && motionOn()) { list.classList.remove('fade'); void list.offsetWidth; list.classList.add('fade'); }
    paintChapters();
    var row = body().querySelector('#mgSortRow'); if (row && row.scrollIntoView) { try { row.scrollIntoView({ block: 'start' }); } catch (e) {} }
  }
  function okDirLocal(d) { return d === 'asc' || d === 'desc'; }

  /* ---------------------------------------------------------------- 웹툰 찾기 (v10.28, O-0954) */
  var findTok = 0;
  function openFind() {
    if (!webOn() || !api) return;
    view = 'find'; loadTok++; findTok++;
    setTitle('웹툰 찾기'); setRefresh(false);
    body().innerHTML = '<div class="mg-wrap"><form class="mg-search" id="mgSearch" role="search"><input id="mgQ" type="search" maxlength="40" placeholder="웹툰 이름" enterkeyhint="search" autocomplete="off" aria-label="웹툰 이름"><button type="submit" class="mg-btn pri">찾기</button></form><div id="mgTop"></div><div id="mgFRes"></div><div id="mgPopBox"></div></div>';
    $('mgQ').value = finder.q || '';
    $('mgSearch').addEventListener('submit', function (ev) { ev.preventDefault(); doSearch(); });
    if (!host.getPass()) { body().querySelector('#mgTop').innerHTML = sayCard('nopass'); return; }
    if (lastJudge && lastJudge.web === 'blocked') body().querySelector('#mgTop').innerHTML = sayCard('blocked');
    paintFind();
    if (!finder.pop) loadPopular();
  }
  function findAll() { return ((finder.pop && finder.pop.items) || []).concat((finder.res && finder.res.items) || []); }
  function findItem(id) { var a = findAll(), i; for (i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function findCard(it) {
    var url = fcov[it.id] || '', pill = it.in_shelf ? '<em class="mg-pill on">담았어요</em>' : (it.status === 'done' ? '<em class="mg-pill">완결</em>' : '');
    return '<button type="button" class="mg-card fi" data-f="' + num(it.id) + '"><span class="mg-cov"' + (url ? '' : ' data-wait="1"') + '>' + (url ? '<img alt="" src="' + esc(url) + '">' : '<i></i>') + pill + '</span><b class="mg-t">' + esc(it.title) + '</b></button>';
  }
  function paintFind() {
    if (view !== 'find') return;
    var rb = body().querySelector('#mgFRes'), pb = body().querySelector('#mgPopBox'); if (!rb || !pb) return;
    if (finder.res) rb.innerHTML = '<div class="mg-sec"><b>찾은 웹툰</b></div>' + (finder.res.items.length ? '<div class="mg-grid fg">' + finder.res.items.map(findCard).join('') + '</div>' : sayCard('noresult'));
    else rb.innerHTML = '';
    if (finder.pop) pb.innerHTML = finder.pop.items.length ? '<div class="mg-sec"><b>연재 중인 웹툰</b></div><div class="mg-prow">' + finder.pop.items.map(findCard).join('') + '</div>' : '';
  }
  function findFail(e, where) {
    pollState(false).then(function (r) { show(r && r.st); }, function () { show(null); });
    function show(st) {
      if (view !== 'find') return;
      var k = errKind(e, st), el = body().querySelector(where);
      if (el) el.innerHTML = sayCard(k, { sub: (SAY[k] && SAY[k].sub) || '' });
    }
  }
  function loadPopular() {
    var tok = findTok, box = body().querySelector('#mgPopBox'); if (!box) return;
    box.innerHTML = sayCard('findload');
    pollState(true).then(function (r) {
      if (tok !== findTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { box.innerHTML = sayCard(r.j.k); return; }
      if (r.j.web === 'blocked' || r.j.web === 'off') { var tp = body().querySelector('#mgTop'); box.innerHTML = ''; if (tp) tp.innerHTML = sayCard(r.j.web === 'off' ? 'weboff' : 'blocked'); return; }      // 막힘·꺼짐 표시 중에는 요청을 보내지 않는다
      return api.request('source_popular', {}, { max: 120000, cancelled: function () { return tok !== findTok; } }).then(function (res) {
        if (tok !== findTok) return;
        finder.pop = { items: res.items || [] }; paintFind(); loadFindCovers(finder.pop.items, tok);
      });
    }).then(null, function (e) { if (tok !== findTok || (e && e.kind === 'cancel')) return; findFail(e, '#mgPopBox'); });
  }
  function doSearch() {
    var q = ($('mgQ').value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    if (!q) { toast('찾을 웹툰 이름을 적어 주세요.', 2000); return; }
    finder.q = q;
    var tok = ++findTok, rb = body().querySelector('#mgFRes');
    if (lastJudge && (lastJudge.web === 'blocked' || lastJudge.web === 'off')) { rb.innerHTML = sayCard(lastJudge.web === 'off' ? 'weboff' : 'blocked'); return; }
    rb.innerHTML = sayCard('findload');
    api.request('source_search', { q: q, page: 1 }, { max: 120000, cancelled: function () { return tok !== findTok; } }).then(function (res) {
      if (tok !== findTok) return;
      finder.res = { q: q, items: res.items || [] }; paintFind(); loadFindCovers(finder.res.items, tok);
      if (!finder.pop) loadPopular();
    }, function (e) { if (tok !== findTok || (e && e.kind === 'cancel')) return; findFail(e, '#mgFRes'); });
  }
  function loadFindCovers(items, tok) {
    var need = items.filter(function (it) { return it.cover && it.cover.id && !fcov[it.id]; });
    for (var i = 0; i < need.length; i += K.SIGN_MAX) (function (grp) {
      api.sign(grp.map(function (it) { return it.cover.id; })).then(function (sg) {
        grp.forEach(function (it) {
          var u = sg.urls[it.cover.id]; if (!u) return;
          api.fetchBlob(u).then(function (b) { return URL.createObjectURL(b); }, function () { return u; }).then(function (src) {
            if (fcov[it.id]) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
            fcov[it.id] = src;
            if (view !== 'find') return;
            var cs = body().querySelectorAll('.mg-card.fi[data-f="' + it.id + '"] .mg-cov');
            for (var j = 0; j < cs.length; j++) { var c = cs[j], ic = c.querySelector('i'); if (ic) { var im = document.createElement('img'); im.alt = ''; im.src = src; c.insertBefore(im, c.firstChild); ic.parentNode.removeChild(ic); c.removeAttribute('data-wait'); } }
          });
        });
      }, function () {});
    })(need.slice(i, i + K.SIGN_MAX));
  }

  /* ---------------------------------------------------------------- 웹툰 탭 (v10.29, O-0961) — 요일별·완결 전체 목록을 표지 격자로 */
  /* 폰에 기억하는 것: 마지막 목록(글자)·표지 그림. IndexedDB 를 쓰고, 막혀 있으면 이번 실행 동안 메모리만(앱은 그대로 돈다). */
  var IDB = (function () {
    var dbp = null, mem = { cv: {}, bl: {} };
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        try {
          var r = global.indexedDB.open('smart_manga', 1);
          r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('cv')) d.createObjectStore('cv'); if (!d.objectStoreNames.contains('bl')) d.createObjectStore('bl'); };
          r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; r.onblocked = function () { res(null); };
        } catch (e) { res(null); }
      });
      return dbp;
    }
    function get(st, k) {
      return db().then(function (d) {
        if (!d) return mem[st][k] || null;
        return new Promise(function (res) { try { var q = d.transaction(st, 'readonly').objectStore(st).get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); } });
      });
    }
    function put(st, k, v) {
      return db().then(function (d) {
        if (!d) { mem[st][k] = v; return; }
        return new Promise(function (res) { try { var tx = d.transaction(st, 'readwrite'); tx.objectStore(st).put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { mem[st][k] = v; res(); }; } catch (e) { mem[st][k] = v; res(); } });
      });
    }
    /* 오래된 표지·목록 정리(열 때 한 번) */
    function prune() {
      db().then(function (d) {
        if (!d) return;
        try {
          ['cv', 'bl'].forEach(function (st) {
            var keep = st === 'cv' ? K.CV_KEEP_MS : K.BL_KEEP_MS, all = [];
            var tx = d.transaction(st, 'readwrite'), os = tx.objectStore(st), cur = os.openCursor();
            cur.onsuccess = function () {
              var c = cur.result;
              if (c) { var at = (c.value && c.value.at) || 0; if (Date.now() - at > keep) c.delete(); else all.push({ k: c.key, at: at }); c.continue(); return; }
              if (st === 'cv' && all.length > K.CV_MAX) { all.sort(function (a, b) { return a.at - b.at; }); all.slice(0, all.length - K.CV_MAX).forEach(function (x) { os.delete(x.k); }); }
            };
          });
        } catch (e) {}
      });
    }
    return { get: get, put: put, prune: prune };
  })();

  var tab = 'lib', userTab = false, tabAutoDone = false, bs = null, shellKind = '';
  var bl = { key: '', items: [], total: 0, at: 0, updated: 0, stale: false, limited: false, page: 1, pages: 1, hasNext: false, hidden: 0, loaded: false, loading: false, err: '' };
  var wtTok = 0, bcov = {}, bq = { queue: [], need: [], pending: {}, inflight: 0, timer: 0, io: null }, wtScrollY = 0, sres = { open: false, on: false, q: '', items: null };
  var SEARCH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function curSort() { return bs.view === 'done' ? bs.sortDone : bs.sort; }
  function curKey() { return listKey(bs.view, bs.day, curSort()); }
  function saveBs() { var o = {}, k; for (k in bs) if (bs.hasOwnProperty(k)) o[k] = bs[k]; o.tab = userTab ? tab : ''; store.setBrowse(o); }
  function initBrowseState() {
    var raw = store.getBrowse(); bs = normBrowse(raw);
    userTab = !!bs.tab; tab = bs.tab || (store.getHint() === 'real' ? 'lib' : 'wt');
    pfInit();
  }
  function markTab() {
    var tb = $('mgTabs'); if (!tb) return;
    var bt = tb.querySelectorAll('[data-tab]'), i;
    for (i = 0; i < bt.length; i++) { var on = bt[i].getAttribute('data-tab') === tab; bt[i].classList.toggle('on', on); bt[i].setAttribute('aria-selected', on ? 'true' : 'false'); }
    var pl = $('mgPaneLib'), pw = $('mgPaneWt'); if (pl) pl.hidden = tab !== 'lib'; if (pw) pw.hidden = tab !== 'wt';
  }
  function selectTab(t, user) {
    if (!browseOn() || (t !== 'lib' && t !== 'wt')) return;
    if (user) userTab = true;
    var changed = t !== tab; tab = t; saveBs(); markTab();
    if (view !== 'lib') return;
    if (t === 'wt') { if (!$('mgWList')) paintWtShell(); wtLoad({}); }
    else { if (lib && lib.mangas) { paintLibrary(); if (!libLoading) refreshLib(false, true); } else if (!libLoading) refreshLib(false); }
    if (changed) window.scrollTo(0, 0);
  }

  function chipRow(label, opts, cur, attr) {
    var h = '<div class="mg-crow"><span class="mg-clab">' + label + '</span><div class="mg-chips">';
    opts.forEach(function (o) { h += '<button type="button" class="mg-c' + (o[0] === cur ? ' on' : '') + '" data-' + attr + '="' + o[0] + '" aria-pressed="' + (o[0] === cur ? 'true' : 'false') + '">' + o[1] + '</button>'; });
    return h + '</div></div>';
  }
  function dayRow() {
    var today = kstInfo().wd, h = '<div class="mg-crow"><span class="mg-clab">요일</span><div class="mg-days" role="group" aria-label="요일">';
    for (var i = 0; i < 7; i++) h += '<button type="button" class="mg-d' + (i === bs.day ? ' on' : '') + '" data-bd="' + i + '" aria-pressed="' + (i === bs.day ? 'true' : 'false') + '" aria-label="' + DAY_NAME[i] + '요일' + (i === today ? ' (오늘)' : '') + '">' + DAY_NAME[i] + (i === today ? '<i class="mg-dot" aria-hidden="true"></i>' : '') + '</button>';
    return h + '</div></div>';
  }
  function paintChips() {
    var el = $('mgWChips'); if (!el) return;
    el.hidden = !!sres.on;
    if (!isNaverCur()) { el.innerHTML = gChips(); return; }
    el.innerHTML = chipRow('보기', [['day', '요일별'], ['done', '완결']], bs.view, 'bv') + (bs.view === 'day' ? dayRow() : '') +
      chipRow('정렬', bs.view === 'day' ? [['pop', '인기'], ['upd', '업데이트'], ['star', '별점']] : [['upd', '최신 완결'], ['star', '별점']], curSort(), 'bs');
  }
  function wtTitleText() {
    if (!isNaverCur()) return gTitleText();
    if (sres.on) return '검색 결과 · ' + ((sres.items || []).length) + '편';
    var same = bl.key === curKey() && bl.loaded;
    if (!same) return bs.view === 'done' ? '완결 웹툰' : DAY_NAME[bs.day] + '요 웹툰';
    return listTitle(bs.view, bs.day, bs.view === 'done' ? bl.items.length : bl.total);
  }
  function paintWHead() {
    var el = $('mgWHead'); if (!el) return;
    var note = '', gen = !isNaverCur(), L = gen ? gl : bl;
    if (!sres.on && L.loaded && L.key === (gen ? gKey() : curKey())) {
      if (L.limited && L.updated) note = '방금 불러왔어요 ' + clockHM(L.updated);
      else if (L.stale && L.updated) note = '저장해 둔 목록이에요 ' + clockHM(L.updated);
    }
    el.innerHTML = '<div class="mg-whrow"><b id="mgBTitle">' + esc(wtTitleText()) + '</b><span class="mg-whbtn">' +
      (sres.on ? '<button type="button" class="mg-c" data-act="bsearchclose">목록으로</button>' :
        '<button type="button" class="mg-ibt' + (sres.open ? ' on' : '') + '" data-act="bsearch" aria-label="이름으로 찾기">' + SEARCH_SVG + '</button>') +
      '<button type="button" class="mg-c" data-act="bcols" aria-pressed="' + (bs.cols === 2 ? 'true' : 'false') + '">' + (bs.cols === 2 ? '작게 보기' : '크게 보기') + '</button></span></div>' +
      (note ? '<small class="mg-wnote" id="mgWNote" role="status">' + esc(note) + '</small>' : '') +
      (!sres.on && !gen && bs.view === 'done' ? '<small class="mg-wnote free">앞부분만 무료인 작품이 많아요</small>' : '');
  }
  function bcard(it) {
    var t = num(it.t), url = bcov[t] || '', pills = '';
    if (it.u) pills += '<em class="mg-up">UP</em>';
    if (it.r) pills += '<em class="mg-rest">휴재</em>';
    if (it.mark) pills += '<em class="mg-fin' + (it.mark === '담았어요' ? ' on' : '') + '">' + esc(it.mark) + '</em>';
    var star = fmtStar(it.s);
    var sub = bs && bs.cols === 2 ? [String(it.a || '').trim(), star].filter(function (x) { return x; }).join(' · ') : star;      // 크게 보기일 때만 「작가 · ★9.87」(작가 값이 없는 옛 저장 목록은 ★만)
    return '<button type="button" class="mg-bcard" data-t="' + t + '"><span class="mg-bcov"' + (url ? '' : ' data-wait="1"') + '>' + (url ? '<img alt="" src="' + esc(url) + '">' : '<i></i>') + pills + '</span>' +
      '<b class="mg-bt">' + esc(it.n) + '</b>' + (sub ? '<small class="mg-bsub">' + esc(sub) + '</small>' : '') + '</button>';
  }
  function searchCard(it) { return { t: it.t, n: it.title, a: it.author, mark: it.in_shelf ? '담았어요' : (it.status === 'done' ? '완결' : '') }; }
  function paintWList() {
    if (!isNaverCur()) return paintGList();
    var box = $('mgWList'); if (!box) return;
    var items, html = '';
    if (sres.on) {
      items = (sres.items || []).map(searchCard);
      if (!items.length) { box.innerHTML = sayCard('noresult'); return; }
    } else {
      items = bl.items;
      if (!items.length) {
        if (bl.err) { box.innerHTML = ''; return; }
        box.innerHTML = (bl.loaded && bl.key === curKey()) ? sayCard('listempty') : sayCard('listload');
        return;
      }
    }
    var cls = 'mg-bgrid c' + bs.cols, i;
    for (i = 0; i < items.length; i++) html += bcard(items[i]);
    var more = '';
    if (!sres.on) {
      if (bs.view === 'done') more = bl.hasNext ? '<div class="mg-more"><button type="button" class="mg-btn" data-act="bmore">더 보기</button></div>' : '<p class="mg-wtend">더 찾으려면 위의 돋보기로 이름을 찾아 보세요.</p>';
    }
    box.innerHTML = '<div class="' + cls + (motionOn() ? ' fadein' : '') + '" id="mgBGrid" role="list">' + html + '</div>' + more;
    watchCovers();
  }
  function paintWtShell() {
    var pane = $('mgPaneWt'); if (!pane) return;
    pane.innerHTML = '<div id="mgWPlat"></div><div id="mgWTop"></div><div id="mgWChips" class="mg-wchips"></div><div id="mgWHead" class="mg-whead"></div><div id="mgWSearch"></div><div id="mgWList"></div>';
    paintPfBar(); paintChips(); paintWHead(); paintSearch(); paintWList();
  }
  function wtStatus(k, extra) { var t = $('mgWTop'); if (t) t.innerHTML = k ? sayCard(k, extra) : ''; }

  /* 목록 받기 — 폰에 저장된 마지막 목록을 먼저 그린 뒤 새로 받는다. o.manual = 새로고침 단추 */
  function wtLoad(o) {
    if (!isNaverCur()) return gLoad(o);
    o = o || {};
    if (!api || !host.getPass() || !bs) return;
    var tok = ++wtTok, key = curKey(), page = o.page || 1;
    var same = bl.key === key && bl.loaded;
    if (!o.manual && page === 1 && same && Date.now() - bl.at < K.BL_FRESH_MS && !o.force) { paintWHead(); paintWList(); return; }
    bl.loading = true; bl.err = ''; wtStatus('');
    if (page === 1 && !same) {
      bl.key = key; bl.items = []; bl.total = 0; bl.loaded = false; bl.page = 1; bl.hasNext = false; paintWHead(); paintWList();
      IDB.get('bl', key).then(function (rec) { if (tok !== wtTok || bl.loaded || !rec || !rec.data) return; applyList(rec.data, key, 1, true); });
    }
    pollState(true).then(function (r) {
      if (tok !== wtTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { bl.loading = false; bl.err = r.j.k; wtStatus(r.j.k, bl.loaded ? { sub: (SAY[r.j.k].sub ? SAY[r.j.k].sub + ' ' : '') + '(마지막으로 받은 목록을 보여 드리고 있어요.)' } : null); paintWList(); return; }
      return api.request('browse_list', { v: bs.view, d: bs.day, s: curSort(), p: page, r: !!o.manual }, { max: 90000, cancelled: function () { return tok !== wtTok; } }).then(function (res) {
        if (tok !== wtTok) return;
        bl.loading = false; bl.err = '';
        applyList(res, key, page, false);
        if (o.manual) { if (res.limited) toast('방금 불러왔어요. 삼십 분쯤 뒤에 다시 눌러 주세요.', 2600); else toast('새로 불러왔어요.', 1800); }
      });
    }).then(null, function (e) {
      if (tok !== wtTok || (e && e.kind === 'cancel')) return;
      bl.loading = false;
      pollState(false).then(function (r) { wtFail(e, r && r.st); }, function () { wtFail(e, null); });
    });
    function wtFail(e, st) {
      if (tok !== wtTok) return;
      var k = errKind(e, st); bl.err = k;
      if (bl.loaded) { wtStatus(k, { sub: (SAY[k].sub ? SAY[k].sub + ' ' : '') + '(마지막으로 받은 목록을 보여 드리고 있어요.)' }); toast(SAY[k].say, 2200); }
      else wtStatus(k);
      paintWList();
    }
  }
  function applyList(res, key, page, fromCache) {
    var items = res.items || [];
    if (page > 1 && !fromCache) bl.items = bl.items.concat(items); else bl.items = items;
    bl.key = key; bl.total = num(res.total, items.length); bl.page = num(res.page, page); bl.pages = num(res.pages, 1); bl.hasNext = !!res.has_next;
    bl.updated = num(res.updated); bl.stale = !!res.stale || !!fromCache; bl.limited = !!res.limited; bl.hidden = num(res.hidden); bl.at = Date.now(); bl.loaded = true;
    if (!fromCache && page === 1) IDB.put('bl', key, { at: Date.now(), data: res });
    if (!fromCache) wtStatus('');
    paintChips(); paintWHead(); paintWList();
  }

  /* 표지 — 화면에 보이는 것(+한 화면 앞)부터 18장씩 묶어 요청, 폰에 기억해 둔 것은 다시 받지 않는다 */
  function watchCovers() {
    var cards = body().querySelectorAll('#mgWList .mg-bcard');
    if (bq.io) { try { bq.io.disconnect(); } catch (e) {} bq.io = null; }
    var i, t;
    if (typeof IntersectionObserver === 'undefined') { for (i = 0; i < cards.length; i++) coverWant(num(cards[i].getAttribute('data-t'))); return; }
    bq.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { var t2 = num(e.target.getAttribute('data-t')); bq.io.unobserve(e.target); coverWant(t2); } });
    }, { rootMargin: '900px 0px' });
    for (i = 0; i < cards.length; i++) { t = num(cards[i].getAttribute('data-t')); if (bcov[t]) continue; bq.io.observe(cards[i]); }
  }
  function coverWant(t) {
    if (!t || bcov[t] || bq.pending[t] || bq.queue.indexOf(t) >= 0) return;
    if (searchCov[t]) return;
    bq.queue.push(t); clearTimeout(bq.timer); bq.timer = setTimeout(pumpCovers, 30);
  }
  var searchCov = {};      // 검색 결과 표지는 목록 표지와 다른 사본이라 따로 받는다(loadSearchCovers)
  function setBcov(t, src) {
    if (bcov[t]) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
    bcov[t] = src;
    var cs = body().querySelectorAll('.mg-bcard[data-t="' + t + '"] .mg-bcov'), j;
    for (j = 0; j < cs.length; j++) { var c = cs[j], ic = c.querySelector('i'); if (ic) { var im = document.createElement('img'); im.alt = ''; im.src = src; c.insertBefore(im, c.firstChild); ic.parentNode.removeChild(ic); c.removeAttribute('data-wait'); } }
    if (curManga && curManga.t === t) { var h = body().querySelector('.mg-chcov'); if (h && !h.querySelector('img')) { var im2 = document.createElement('img'); im2.alt = ''; im2.src = src; h.insertBefore(im2, h.firstChild); } }
  }
  function pumpCovers() {
    var ts = bq.queue.splice(0, bq.queue.length).filter(function (t) { return !bcov[t] && !bq.pending[t]; });
    if (!ts.length) return;
    ts.forEach(function (t) { bq.pending[t] = 1; });
    Promise.all(ts.map(function (t) { return IDB.get('cv', t).then(function (rec) { return { t: t, rec: rec }; }); })).then(function (rs) {
      rs.forEach(function (x) {
        if (x.rec && x.rec.b && Date.now() - (x.rec.at || 0) < K.CV_KEEP_MS) { var u = ''; try { u = URL.createObjectURL(x.rec.b); } catch (e) {} if (u) { setBcov(x.t, u); delete bq.pending[x.t]; return; } }
        if (bq.budget) delete bq.pending[x.t]; else bq.need.push(x.t);      // 예산이 찼으면 폰에 저장된 표지만 쓰고 서버에는 더 묻지 않는다
      });
      pumpNet();
    });
  }
  function pumpNet() {
    while (bq.inflight < K.COV_PAR && bq.need.length && api) {
      var batch = bq.need.splice(0, K.COV_BATCH); bq.inflight++;
      fetchCoverBatch(batch).then(function () { bq.inflight--; pumpNet(); }, function () { bq.inflight--; pumpNet(); });
    }
  }
  function fetchCoverBatch(ts) {
    return api.request('browse_covers', { ts: ts }, { max: 90000 }).then(function (res) {
      var files = res.files || {}, ids = [], byId = {}, jobs = [], i;
      if (res.budget) bq.budget = true;       // 오늘 표지 예산이 다 찼다 — 오류 창 없이 표지 자리를 비워 두고(제목은 보임) 더 요청하지 않는다
      ts.forEach(function (t) { var f = files[String(t)]; if (f && f.id) { ids.push(f.id); byId[f.id] = t; } });
      for (i = 0; i < ids.length; i += K.SIGN_MAX) (function (grp) {
        jobs.push(api.sign(grp).then(function (s) {
          return Promise.all(grp.map(function (id) {
            var u = s.urls[id]; if (!u) return null;
            return api.fetchBlob(u).then(function (b) { var t = byId[id]; var src = ''; try { src = URL.createObjectURL(b); } catch (e) {} if (src) setBcov(t, src); IDB.put('cv', t, { b: b, at: Date.now() }); }, function () {});
          }));
        }));
      })(ids.slice(i, i + K.SIGN_MAX));
      return Promise.all(jobs);
    }).then(null, function () { /* 표지가 안 와도 글자 칸은 보인다 */ }).then(function () { ts.forEach(function (t) { delete bq.pending[t]; }); });
  }

  /* 이름으로 찾기(웹툰 탭 안) — 결과도 목록과 같은 격자, 열 때는 같은 나이 확인·열기 허용을 거친다(browse_open) */
  function paintSearch() {
    var el = $('mgWSearch'); if (!el) return;
    if (!sres.open) { el.innerHTML = ''; return; }
    el.innerHTML = '<form class="mg-search" id="mgWForm" role="search"><input id="mgWQ" type="search" maxlength="40" placeholder="웹툰 이름" enterkeyhint="search" autocomplete="off" aria-label="웹툰 이름"><button type="submit" class="mg-btn pri">찾기</button></form>';
    $('mgWQ').value = sres.q || '';
    $('mgWForm').addEventListener('submit', function (ev) { ev.preventDefault(); doWSearch(); });
  }
  function toggleSearch() {
    if (sres.on) { closeWSearch(); return; }
    sres.open = !sres.open; paintWHead(); paintSearch();
    if (sres.open) { var q = $('mgWQ'); if (q) q.focus(); }
  }
  function closeWSearch() { sres = { open: false, on: false, q: '', items: null }; paintChips(); paintWHead(); paintSearch(); paintWList(); }
  function doWSearch() {
    var q = ($('mgWQ').value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    if (q && !isNaverCur()) return gSearch(q);
    if (!q) { toast('찾을 웹툰 이름을 적어 주세요.', 2000); return; }
    if (lastJudge && (lastJudge.web === 'blocked' || lastJudge.web === 'off')) { wtStatus(lastJudge.web === 'off' ? 'weboff' : 'blocked'); return; }
    sres.q = q; var tok = ++wtTok; wtStatus('findload');
    api.request('source_search', { q: q, page: 1 }, { max: 120000, cancelled: function () { return tok !== wtTok; } }).then(function (res) {
      if (tok !== wtTok) return;
      wtStatus('');
      sres.items = (res.items || []).filter(function (it) { return it && it.t; }); sres.on = true;
      paintChips(); paintWHead(); paintWList(); loadSearchCovers(sres.items);
    }, function (e) {
      if (tok !== wtTok || (e && e.kind === 'cancel')) return;
      pollState(false).then(function (r) { wtStatus(errKind(e, r && r.st)); }, function () { wtStatus(errKind(e, null)); });
    });
  }
  function loadSearchCovers(items) {
    var need = items.filter(function (it) { return it.cover && it.cover.id && !bcov[it.t]; }), i;
    need.forEach(function (it) { searchCov[it.t] = 1; });
    for (i = 0; i < need.length; i += K.SIGN_MAX) (function (grp) {
      api.sign(grp.map(function (it) { return it.cover.id; })).then(function (sg) {
        grp.forEach(function (it) {
          var u = sg.urls[it.cover.id]; if (!u) return;
          api.fetchBlob(u).then(function (b) { return URL.createObjectURL(b); }, function () { return u; }).then(function (src) { delete searchCov[it.t]; setBcov(it.t, src); });
        });
      }, function () {});
    })(need.slice(i, i + K.SIGN_MAX));
  }

  /* 담지 않고 열기: 표지를 누르면 browse_open(나이 확인 + 정식연재 확인) → 회차 목록 */
  function wtItemByT(t) {
    var a = sres.on ? (sres.items || []).map(function (it) { return { t: it.t, n: it.title, f: it.status === 'done' ? 1 : 0 }; }) : bl.items, i;
    for (i = 0; i < a.length; i++) if (a[i].t === t) return a[i];
    return null;
  }
  function openBrowse(t) {
    var it = wtItemByT(t); if (!it || !api) return;
    wtScrollY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    var m = { id: null, t: t, title: it.n, origin: 'web', status: it.f ? 'done' : 'ongoing', shelf: false, from: 'wt' };
    curManga = m; view = 'chap'; chapItems = null; wtTok++;
    setTitle(m.title); setRefresh(true);
    body().innerHTML = '<div class="mg-wrap"><div id="mgChHead"></div><div id="mgTop"></div><div id="mgSortRow" class="mg-sortrow"></div><div id="mgList" class="mg-list"></div></div>';
    paintChapHead();
    var top = body().querySelector('#mgTop'); if (top) top.innerHTML = sayCard('openload');
    window.scrollTo(0, 0);
    var tok = ++loadTok;
    pollState(true).then(function (r) {
      if (tok !== loadTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { if (top) top.innerHTML = sayCard(r.j.k); return; }
      return api.request('browse_open', { t: t }, { max: 120000, cancelled: function () { return tok !== loadTok; } }).then(function (res) {
        if (tok !== loadTok) return;
        var c = res.manga || {};
        if (!c.id) throw mkErr('failed', { code: 'not_openable' });
        m.id = c.id; m.shelf = !!c.shelf; if (c.status) m.status = c.status; if (c.title) m.title = c.title;
        setTitle(m.title); paintChapHead();
        loadChapters(m, false);
      });
    }).then(null, function (e) {
      if (tok !== loadTok || (e && e.kind === 'cancel')) return;
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) { var k = errKind(e, st); if (e && e.kind === 'failed' && e.code === 'not_offered') k = 'notopen'; if (k === 'agebad') k = 'agebado'; else if (k === 'ageunk') k = 'ageunko'; var tp = body().querySelector('#mgTop'); if (tp) tp.innerHTML = sayCard(k); }
    });
  }
  function isShelf(m) { return !!(m && (m.shelf === true || (lib && lib.mangas && lib.mangas.some(function (x) { return x.id === m.id; })))); }
  function coverOf(m) { return (lib && lib.cov[m.id]) || (m.t && bcov[m.t]) || (m.pk && pcov[m.pk]) || ''; }
  function addCurrent() {
    var m = curManga; if (!m || !m.id || !isWebManga(m)) return;
    var btn = body().querySelector('[data-act="addcur"]'); if (!btn || btn.disabled) return;
    btn.disabled = true; btn.textContent = '담는 중…';
    api.request('library_add', { manga_id: m.id }, { max: 120000 }).then(function (res) {
      var card = res && res.manga;
      if (card) {
        lib = lib || { mangas: [], at: Date.now(), cov: {} };
        lib.mangas = lib.mangas.filter(function (x) { return x.id !== card.id; }); lib.mangas.push(card);
        lib.mangas.sort(function (a, b) { return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0); });
        if (m.t && bcov[m.t]) lib.cov[card.id] = bcov[m.t]; else if (m.pk && pcov[m.pk]) lib.cov[card.id] = pcov[m.pk];
      }
      m.shelf = true; toast('서재에 담았어요.', 2200);
      if (view === 'chap' && curManga === m) { paintChapHead(); paintChapters(); }
    }, function (e) {
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) { var k = errKind(e, st), say = SAY[k] || SAY.fail; toast(say.say + (say.sub ? ' ' + say.sub : ''), 3200); if (k === 'agebad') { btn.textContent = '담을 수 없어요'; return; } btn.disabled = false; btn.textContent = '서재에 담기'; }
    });
  }
  function setBs(patch) {
    var k; for (k in patch) if (patch.hasOwnProperty(k)) bs[k] = patch[k];
    if (sres.on || sres.open) { sres = { open: false, on: false, q: '', items: null }; paintSearch(); }
    saveBs(); paintChips(); paintWHead();
    wtLoad({ force: true });
  }

  /* =====================================================================
   * 3-B. v10.31(O-0967) 플랫폼 고르기 — 웹툰 탭 칩 줄 · 전체 플랫폼 시트 · 다른 플랫폼 탐색(인기·최신·검색)
   * 설정(자주 보는 곳 ★·숨김·보는 방식)은 이 폰에만 저장된다. 읽기 가능 여부는 PC가 알려 주는 상태(하트비트 pf 칸)만 믿는다.
   * 스위치 host.platforms(app.js MANGA_PLATFORMS) = false 면 이 블록은 전부 잠자고 v10.30 화면 그대로.
   * ===================================================================*/
  var PFR = [], pfPrefs = null, pfInfo = {};
  var pfUi = { open: false, group: 'all', q: '', reorder: false, showHid: false, sel: '', undo: '', undoTimer: 0 };
  var gl = { key: '', items: [], total: 0, page: 1, pages: 1, hasNext: false, stale: false, limited: false, updated: 0, hidden: 0, loaded: false, loading: false, err: '', at: 0 };
  var pcov = {}, pq = { queue: [], inflight: 0, pending: {}, io: null, budget: {}, timer: 0 };
  var EYE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  var GEN_SAY = {
    blocked: function (n) { return { say: '「' + n + '」 사이트가 지금 답하지 않아요.', sub: '한 시간쯤 뒤에 다시 해 보세요.' }; },
    locked: function () { return { say: '이 화는 앱에서 볼 수 없어요.', sub: '정식 사이트에서는 볼 수 있을지도 몰라요.' }; },
    weboff: function () { return { say: '지금은 이 플랫폼을 앱에서 읽을 수 없어요.', sub: '정식 사이트에서 볼 수 있어요.' }; },
    listload: function (n) { return { say: '케이가 「' + n + '」 작품을 가져오고 있어요.', sub: '' }; },
    listempty: function () { return { say: '불러온 작품이 없어요.', sub: '잠깐 뒤에 다시 해 볼까요?' }; },
    budget: function () { return { say: '오늘은 여기까지 불러왔어요.', sub: '내일 다시 열어 드릴게요. 서재에 있는 만화는 그대로 볼 수 있어요.' }; }
  };

  function platOn() { return host.platforms !== false && browseOn() && !!(global.MangaPlatforms && global.MangaPlatforms.rows); }
  function pfInit() {
    if (!PFR.length && global.MangaPlatforms) PFR = pfRows(global.MangaPlatforms);
    if (!pfPrefs) { pfPrefs = pfNormPrefs(store.getPf(), PFR); pfInfo = pfCleanInfo(store.getPfInfo()); }
  }
  function pfRow(pf) { var i; for (i = 0; i < PFR.length; i++) if (PFR[i].pf === pf) return PFR[i]; return null; }
  function pfNameOf(pf) { var r = pfRow(pf); return r ? r.n : ''; }
  /* PC가 알려 준 상태. 중계가 살아 있고 플랫폼 기능이 꺼져 있으면(옛 중계·스위치) 네이버 말고는 아무것도 읽을 수 없다. PC가 꺼져 있으면 마지막으로 받은 상태를 쓴다. */
  function pfInfoNow() {
    if (lastJudge && lastJudge.k === 'ok') return lastJudge.plat === 'on' ? (lastJudge.pfc || {}) : {};
    return pfInfo;
  }
  function pfSt(pf) { var r = pfRow(pf); return r ? pfStatus(r, pfInfoNow()[pf]) : { s: 'chk', w: '' }; }
  function curPf() { if (!platOn() || !pfPrefs) return 'naver'; var p = pfPrefs.cur; return (p === 'naver' || pfSt(p).s === 'read') ? p : 'naver'; }
  function isNaverCur() { return curPf() === 'naver'; }
  function pfCtxName() { if (!platOn() || !pfPrefs) return ''; if (view === 'chap' && curManga && curManga.pf) return pfNameOf(curManga.pf); if (view === 'lib' && tab === 'wt' && !isNaverCur()) return pfNameOf(curPf()); return ''; }
  function pfSave() { store.setPf({ cur: pfPrefs.cur, favs: pfPrefs.favs, hid: pfPrefs.hid, mode: pfPrefs.mode }); }
  var pfSnap = '';
  function pfSync(j) {
    if (j && j.pf) {
      j.pfc = pfCleanInfo(j.pf);
      if (j.plat === 'on' && JSON.stringify(j.pfc) !== JSON.stringify(pfInfo)) { pfInfo = j.pfc; try { store.setPfInfo(j.pfc); } catch (e) {} }
    }
    var snap = JSON.stringify(pfInfoNow());
    if (snap !== pfSnap) {
      pfSnap = snap;
      if (platOn() && pfPrefs) {
        paintPfBar(); if (pfUi.open) paintPf();
        if (view === 'lib' && tab === 'wt' && pfPrefs.cur !== 'naver' && !isNaverCur()) { /* 그대로 */ }
        else if (view === 'lib' && tab === 'wt' && pfPrefs.cur !== 'naver' && isNaverCur() && $('mgWList')) { paintWtShell(); wtLoad({}); }
      }
    }
  }

  /* ---- 웹툰 탭 위 한 줄: 칩 줄 + 「전체 N곳」 ---- */
  function paintPfBar() {
    var el = $('mgWPlat'); if (!el) return;
    if (!platOn()) { el.innerHTML = ''; return; }
    pfInit();
    var cur = curPf(), infos = pfInfoNow();
    var chips = pfChipList(PFR, infos, pfPrefs).map(function (r) { return '<button type="button" class="mg-pfc' + (r.pf === cur ? ' on' : '') + '" data-pfc="' + r.pf + '" aria-pressed="' + (r.pf === cur ? 'true' : 'false') + '">' + esc(r.n) + '</button>'; }).join('');
    el.innerHTML = '<div class="mg-pfbar"><div class="mg-pfchips" role="group" aria-label="플랫폼">' + chips + '</div><button type="button" class="mg-pfall" data-act="pfall">전체 ' + PFR.length + '곳</button></div>';
    var on = el.querySelector('.mg-pfc.on'); if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
  }
  function pfUse(pf) {
    if (!pfRow(pf) || pfSt(pf).s !== 'read') return;
    pfInit(); pfPrefs.cur = pf; pfSave(); wtTok++;
    sres = { open: false, on: false, q: '', items: null };
    if (pfUi.open) closePf();
    if (view === 'lib' && tab === 'wt') { window.scrollTo(0, 0); paintWtShell(); wtLoad({}); }
    else if (view === 'lib') selectTab('wt', true);
  }

  /* ---- 전체 플랫폼 시트 ---- */
  function ensurePf() {
    var el = $('mgPf'); if (el) return el;
    el = document.createElement('div'); el.id = 'mgPf'; el.className = 'mg-pfbg'; el.style.display = 'none';
    el.innerHTML = '<div class="mg-pfpanel" role="dialog" aria-modal="true" aria-label="만화 플랫폼"><div class="mg-pfhead"><b>만화 플랫폼</b><button type="button" class="mg-pfx" data-pfa="close" aria-label="닫기">✕</button></div>' +
      '<div class="mg-pfscroll"><input class="mg-pfq" id="mgPfQ" type="search" maxlength="30" placeholder="플랫폼 이름 찾기" autocomplete="off" aria-label="플랫폼 이름 찾기"><div class="mg-pfgroups" id="mgPfGroups"></div><div class="mg-pfgroups" id="mgPfTools"></div><div class="mg-pfcards" id="mgPfCards"></div>' +
      '<p class="mg-pfnote">★을 누른 곳이 웹툰 탭 맨 앞에 와요. 순서와 숨김은 이 폰에만 저장돼서, 폰을 바꾸면 처음으로 돌아가요.</p></div>' +
      '<div class="mg-pffoot"><div class="mg-pfundo" id="mgPfUndo" hidden></div><div class="mg-pfdet" id="mgPfDet" hidden></div></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', onPfClick);
    el.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-pfp')) { ev.preventDefault(); onPfClick(ev); } });
    $('mgPfQ').addEventListener('input', function () { pfUi.q = this.value; paintPfCards(); });
    return el;
  }
  function pfIsOpen() { return !!pfUi.open; }
  function openPf(sel) {
    if (!platOn()) return; pfInit();
    var el = ensurePf(); pfUi.open = true; pfUi.sel = sel || ''; pfUi.q = ''; pfUi.group = 'all'; pfUi.reorder = false; $('mgPfQ').value = '';
    paintPf(); el.style.display = 'flex'; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    if (pfUi.sel) { var c = el.querySelector('[data-pfp="' + pfUi.sel + '"]'); if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'center' }); } catch (e) {} } }
  }
  function closePf() {
    var el = $('mgPf'); if (!el || !pfUi.open) return false;
    pfUi.open = false; el.classList.remove('on'); el.style.display = 'none'; clearTimeout(pfUi.undoTimer); pfUi.undo = ''; return true;
  }
  function paintPf() {
    if (!$('mgPf')) return;
    var cnt = pfGroupCounts(PFR, pfPrefs, pfUi.showHid), h = '';
    h += '<button type="button" class="mg-c' + (pfUi.group === 'all' ? ' on' : '') + '" data-pfg="all" aria-pressed="' + (pfUi.group === 'all') + '">전체 ' + cnt.all + '</button>';
    PF_GROUPS.forEach(function (g) { if (cnt[g[0]]) h += '<button type="button" class="mg-c' + (pfUi.group === g[0] ? ' on' : '') + '" data-pfg="' + g[0] + '" aria-pressed="' + (pfUi.group === g[0]) + '">' + g[1] + ' ' + cnt[g[0]] + '</button>'; });
    $('mgPfGroups').innerHTML = h;
    var nh = pfPrefs.hid.length;
    $('mgPfTools').innerHTML = (pfPrefs.favs.length > 1 ? '<button type="button" class="mg-c' + (pfUi.reorder ? ' on' : '') + '" data-pft="reorder" aria-pressed="' + pfUi.reorder + '">' + (pfUi.reorder ? '순서 바꾸기 끝' : '★ 순서 바꾸기') + '</button>' : '') +
      (nh ? '<button type="button" class="mg-c' + (pfUi.showHid ? ' on' : '') + '" data-pft="hid" aria-pressed="' + pfUi.showHid + '">숨긴 곳 ' + nh + '</button>' : '');
    paintPfCards(); paintPfDet(); paintPfUndo();
  }
  function pfBadge(st) { return st.s === 'read' ? '<span class="mg-pfbd rd">앱에서 읽기</span>' : (st.s === 'chk' ? '<span class="mg-pfbd ck">확인 중</span>' : '<span class="mg-pfbd lk">정식 사이트</span>'); }
  function paintPfCards() {
    var box = $('mgPfCards'); if (!box) return;
    var list = pfFilter(pfSheetOrder(PFR, pfInfoNow(), pfPrefs, pfUi.showHid), pfUi.group, pfUi.q), h = '';
    list.forEach(function (r) {
      var st = pfSt(r.pf), fav = pfPrefs.favs.indexOf(r.pf) >= 0, hid = pfPrefs.hid.indexOf(r.pf) >= 0;
      h += '<div class="mg-pc ' + st.s + (hid ? ' hid' : '') + (pfUi.sel === r.pf ? ' sel' : '') + '" role="button" tabindex="0" data-pfp="' + r.pf + '"><b class="nm">' + esc(r.n) + '</b><span class="lg">' + esc(r.lang) + '</span>' + pfBadge(st) +
        '<button type="button" class="mg-pfstar' + (fav ? ' on' : '') + '" data-pfstar="' + r.pf + '" aria-pressed="' + fav + '" aria-label="' + esc(r.n) + (fav ? ' 자주 보는 곳에서 빼기' : ' 자주 보는 곳에 넣기') + '">' + (fav ? '★' : '☆') + '</button>' +
        '<button type="button" class="mg-pfeye" data-pfeye="' + r.pf + '" aria-label="' + esc(r.n) + (hid ? ' 다시 보이기' : ' 숨기기') + '">' + (hid ? EYE_OFF_SVG : EYE_SVG) + '</button>' +
        (pfUi.reorder && fav ? '<span class="mg-pfmv"><button type="button" data-pfmv="' + r.pf + '" data-d="-1" aria-label="앞으로">▲</button><button type="button" data-pfmv="' + r.pf + '" data-d="1" aria-label="뒤로">▼</button></span>' : '') + '</div>';
    });
    box.innerHTML = h || '<p class="mg-pfnone">찾는 플랫폼이 없어요.</p>';
  }
  function paintPfDet() {
    var el = $('mgPfDet'); if (!el) return;
    var r = pfUi.sel ? pfRow(pfUi.sel) : null;
    if (!r) { el.hidden = true; el.innerHTML = ''; return; }
    var st = pfSt(r.pf), h = '<b>' + esc(r.n) + '</b><small>' + esc(r.lang) + '</small>';
    if (st.s === 'read') h += '<div class="mg-acts"><button type="button" class="mg-btn pri" data-pfa="use">이 플랫폼 보기</button></div>';
    else {
      h += '<p class="mg-pfsay">' + (st.s === 'chk' ? '아직 확인 중이에요' : esc(pfReason(st.w))) + '</p>' + (st.s === 'chk' ? '<small class="mg-pfsub">앱 안에서 읽을 수 있는지 살펴보고 있어요.</small>' : '');
      h += r.url ? '<div class="mg-acts"><button type="button" class="mg-btn pri" data-pfa="site">정식 사이트 열기</button></div>' : '<p class="mg-pfnoaddr">주소 확인 중이에요</p>';
    }
    el.innerHTML = h; el.hidden = false;
  }
  function paintPfUndo() {
    var el = $('mgPfUndo'); if (!el) return;
    if (!pfUi.undo) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = '<span>' + esc(pfNameOf(pfUi.undo)) + ' 숨겼어요</span><button type="button" data-pfa="undo">되돌리기</button>'; el.hidden = false;
  }
  function onPfClick(ev) {
    var t = ev.target, el = t.closest ? t.closest('[data-pfp],[data-pfstar],[data-pfeye],[data-pfmv],[data-pfg],[data-pft],[data-pfa]') : null;
    if (!el) { if (t === $('mgPf')) closePf(); return; }
    var pf;
    if (el.hasAttribute('data-pfstar')) { pf = el.getAttribute('data-pfstar'); pfPrefs = pfNormPrefs(pfToggleFav(pfPrefs, pf), PFR); pfSave(); paintPf(); paintPfBar(); return; }
    if (el.hasAttribute('data-pfeye')) {
      pf = el.getAttribute('data-pfeye'); var was = pfPrefs.hid.indexOf(pf) >= 0;
      pfPrefs = pfNormPrefs(pfToggleHide(pfPrefs, pf), PFR); pfSave();
      clearTimeout(pfUi.undoTimer); pfUi.undo = was ? '' : pf;
      if (!was) pfUi.undoTimer = setTimeout(function () { pfUi.undo = ''; paintPfUndo(); }, 3000);
      if (pfUi.sel === pf && !was && !pfUi.showHid) pfUi.sel = '';
      paintPf(); paintPfBar(); if (!was && view === 'lib' && tab === 'wt' && pfPrefs.cur === 'naver' && platOn() && !isNaverCur()) { paintWtShell(); wtLoad({}); } return;
    }
    if (el.hasAttribute('data-pfmv')) { pf = el.getAttribute('data-pfmv'); pfPrefs = pfNormPrefs(pfMoveFav(pfPrefs, pf, num(el.getAttribute('data-d'))), PFR); pfSave(); paintPf(); paintPfBar(); return; }
    if (el.hasAttribute('data-pfg')) { pfUi.group = el.getAttribute('data-pfg'); paintPf(); return; }
    if (el.hasAttribute('data-pft')) { if (el.getAttribute('data-pft') === 'reorder') pfUi.reorder = !pfUi.reorder; else pfUi.showHid = !pfUi.showHid; paintPf(); return; }
    if (el.hasAttribute('data-pfp')) { pf = el.getAttribute('data-pfp'); pfUi.sel = pfUi.sel === pf ? '' : pf; paintPfCards(); paintPfDet(); return; }
    var a = el.getAttribute('data-pfa');
    if (a === 'close') return void closePf();
    if (a === 'use') return pfUse(pfUi.sel);
    if (a === 'site') { var u = pfSiteUrl(PFR, pfUi.sel); if (u) { try { host.openUrl(u); } catch (e) { toast('링크를 열지 못했어요.', 2000); } } return; }
    if (a === 'undo') { var up = pfUi.undo; if (up) { pfPrefs = pfNormPrefs(pfToggleHide(pfPrefs, up), PFR); pfSave(); } clearTimeout(pfUi.undoTimer); pfUi.undo = ''; paintPf(); paintPfBar(); return; }
  }

  /* ---- 다른 플랫폼 탐색(인기·최신·검색) ---- */
  function gModeState() {
    var pf = curPf(), info = pfInfoNow()[pf] || {}, pm = pfPrefs.mode[pf] || { m: 'pop', l: '' }, c = info.c || {};
    var m = (pm.m === 'new' && c['new'] !== 0) ? 'new' : 'pop';
    var l = (info.l && info.l.length) ? (info.l.indexOf(pm.l) >= 0 ? pm.l : info.l[0]) : '';
    return { m: m, l: l };
  }
  function gKey() { var s = gModeState(); return curPf() + ':' + s.m + ':' + s.l; }
  function gItems(raw) { var pf = curPf(); return (raw || []).filter(function (it) { return it && it.k; }).map(function (it) { return { k: num(it.k), pk: pf + ':' + num(it.k), n: String(it.n || ''), a: it.a || '', d: it.m === 'done' }; }); }
  function gItem(pk) { var a = sres.on ? (sres.items || []) : gl.items, i; for (i = 0; i < a.length; i++) if (a[i].pk === pk) return a[i]; return null; }
  function gTitleText() {
    var s = gModeState(), same = gl.key === gKey() && gl.loaded;
    if (sres.on) return '검색 결과 · ' + ((sres.items || []).length) + '편';
    return pfNameOf(curPf()) + ' · ' + (s.m === 'new' ? '최신' : '인기') + (same ? ' · ' + (gl.total || gl.items.length) + '편' : '');
  }
  function gChips() {
    var s = gModeState(), info = pfInfoNow()[curPf()] || {}, c = info.c || {}, modes = [['pop', '인기']];
    if (c['new'] !== 0) modes.push(['new', '최신']);
    var h = chipRow('보기', modes, s.m, 'gm');
    if (info.l && info.l.length > 1) h += chipRow('언어', info.l.map(function (l) { return [l, PF_LANG[l] || l]; }), s.l, 'gl');
    return h;
  }
  function gCard(it) {
    var url = pcov[it.pk] || '', pills = it.d ? '<em class="mg-fin">완결</em>' : '';
    var sub = bs && bs.cols === 2 ? String(it.a || '').trim() : '';
    return '<button type="button" class="mg-bcard" data-pk="' + esc(it.pk) + '"><span class="mg-bcov"' + (url ? '' : ' data-wait="1"') + '>' + (url ? '<img alt="" src="' + esc(url) + '">' : '<i></i>') + pills + '</span><b class="mg-bt">' + esc(it.n) + '</b>' + (sub ? '<small class="mg-bsub">' + esc(sub) + '</small>' : '') + '</button>';
  }
  function paintGList() {
    var box = $('mgWList'); if (!box) return;
    var items = sres.on ? (sres.items || []) : gl.items, html = '', i;
    if (!items.length) {
      if (!sres.on && gl.err) { box.innerHTML = ''; return; }
      box.innerHTML = sres.on ? sayCard('noresult') : ((gl.loaded && gl.key === gKey()) ? sayCard('listempty') : sayCard('listload'));
      return;
    }
    for (i = 0; i < items.length; i++) html += gCard(items[i]);
    var more = (!sres.on && gl.hasNext && gl.page < 5) ? '<div class="mg-more"><button type="button" class="mg-btn" data-act="gmore">더 보기</button></div>' : '';
    box.innerHTML = '<div class="mg-bgrid c' + (bs ? bs.cols : 3) + (motionOn() ? ' fadein' : '') + '" role="list">' + html + '</div>' + more;
    gWatch();
  }
  function gApply(res, key, page, fromCache) {
    var items = gItems(res.items);
    if (page > 1 && !fromCache) gl.items = gl.items.concat(items); else gl.items = items;
    gl.key = key; gl.total = num(res.total, items.length); gl.page = num(res.page, page); gl.pages = num(res.pages, 1); gl.hasNext = !!res.has_next;
    gl.updated = num(res.updated); gl.stale = !!res.stale || !!fromCache; gl.limited = !!res.limited; gl.hidden = num(res.hidden); gl.at = Date.now(); gl.loaded = true;
    if (!fromCache && page === 1) IDB.put('bl', key, { at: Date.now(), data: res });
    if (!fromCache) wtStatus('');
    paintChips(); paintWHead(); paintGList();
  }
  function gLoad(o) {
    o = o || {};
    if (!api || !host.getPass() || !bs) return;
    var pf = curPf(), st = gModeState(), key = gKey(), page = o.page || 1, tok = ++wtTok;
    var same = gl.key === key && gl.loaded;
    if (!o.manual && page === 1 && same && Date.now() - gl.at < K.BL_FRESH_MS && !o.force) { paintChips(); paintWHead(); paintGList(); return; }
    gl.loading = true; gl.err = ''; wtStatus('');
    if (page === 1 && !same) {
      gl.key = key; gl.items = []; gl.total = 0; gl.loaded = false; gl.page = 1; gl.hasNext = false; paintChips(); paintWHead(); paintGList();
      IDB.get('bl', key).then(function (rec) { if (tok !== wtTok || gl.loaded || !rec || !rec.data) return; gApply(rec.data, key, 1, true); });
    }
    pollState(true).then(function (r) {
      if (tok !== wtTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { gl.loading = false; gl.err = r.j.k; wtStatus(r.j.k, gl.loaded ? { sub: (SAY[r.j.k].sub ? SAY[r.j.k].sub + ' ' : '') + '(마지막으로 받은 목록을 보여 드리고 있어요.)' } : null); paintGList(); return; }
      var prm = { pf: pf, mode: st.m, p: page, r: !!o.manual }; if (st.l) prm.lang = st.l;
      return api.request('plat_list', prm, { max: 120000, cancelled: function () { return tok !== wtTok; } }).then(function (res) {
        if (tok !== wtTok) return;
        gl.loading = false; gl.err = '';
        gApply(res, key, page, false);
        if (o.manual) toast(res.limited ? '방금 불러왔어요. 삼십 분쯤 뒤에 다시 눌러 주세요.' : '새로 불러왔어요.', 2200);
      });
    }).then(null, function (e) {
      if (tok !== wtTok || (e && e.kind === 'cancel')) return;
      gl.loading = false;
      pollState(false).then(function (r) { gFail(e, r && r.st); }, function () { gFail(e, null); });
    });
    function gFail(e, st2) {
      if (tok !== wtTok) return;
      var k = errKind(e, st2); gl.err = k;
      if (e && e.kind === 'failed' && e.code === 'out_of_scope') { k = 'weboff'; gl.err = k; }
      if (gl.loaded) { wtStatus(k, { sub: (SAY[k].sub ? SAY[k].sub + ' ' : '') + '(마지막으로 받은 목록을 보여 드리고 있어요.)' }); toast(SAY[k].say, 2200); } else wtStatus(k);
      paintGList();
    }
  }
  function gSearch(q) {
    var pf = curPf(), st = gModeState(), tok = ++wtTok; sres.q = q; wtStatus('listload');
    var prm = { pf: pf, mode: 'search', q: q, p: 1 }; if (st.l) prm.lang = st.l;
    api.request('plat_list', prm, { max: 120000, cancelled: function () { return tok !== wtTok; } }).then(function (res) {
      if (tok !== wtTok) return;
      wtStatus(''); sres.items = gItems(res.items); sres.on = true;
      paintChips(); paintWHead(); paintGList();
    }, function (e) {
      if (tok !== wtTok || (e && e.kind === 'cancel')) return;
      pollState(false).then(function (r) { var k = errKind(e, r && r.st); if (e && e.kind === 'failed' && e.code === 'out_of_scope') k = 'weboff'; wtStatus(k); }, function () { wtStatus(errKind(e, null)); });
    });
  }
  /* 표지 — 화면에 보이는 것부터 묶어서 요청(폰에 기억해 둔 것은 다시 받지 않는다). 키는 「플랫폼:작품번호」 */
  function gWatch() {
    var cards = body().querySelectorAll('#mgWList .mg-bcard[data-pk]'), i;
    if (pq.io) { try { pq.io.disconnect(); } catch (e) {} pq.io = null; }
    if (typeof IntersectionObserver === 'undefined') { for (i = 0; i < cards.length; i++) gCoverWant(cards[i].getAttribute('data-pk')); return; }
    pq.io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { var k = e.target.getAttribute('data-pk'); pq.io.unobserve(e.target); gCoverWant(k); } }); }, { rootMargin: '900px 0px' });
    for (i = 0; i < cards.length; i++) { var pk = cards[i].getAttribute('data-pk'); if (!pcov[pk]) pq.io.observe(cards[i]); }
  }
  function gCoverWant(pk) { if (!pk || pcov[pk] || pq.pending[pk] || pq.queue.indexOf(pk) >= 0) return; pq.queue.push(pk); clearTimeout(pq.timer); pq.timer = setTimeout(gPump, 30); }
  function gSetCov(pk, src) {
    if (pcov[pk]) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
    pcov[pk] = src;
    var cs = body().querySelectorAll('.mg-bcard[data-pk="' + pk + '"] .mg-bcov'), j;
    for (j = 0; j < cs.length; j++) { var c = cs[j], ic = c.querySelector('i'); if (ic) { var im = document.createElement('img'); im.alt = ''; im.src = src; c.insertBefore(im, c.firstChild); ic.parentNode.removeChild(ic); c.removeAttribute('data-wait'); } }
    if (curManga && curManga.pk === pk) { var h = body().querySelector('.mg-chcov'); if (h && !h.querySelector('img')) { var im2 = document.createElement('img'); im2.alt = ''; im2.src = src; h.insertBefore(im2, h.firstChild); } }
  }
  var pqNeed = [];
  function gPump() {
    var ks = pq.queue.splice(0, pq.queue.length).filter(function (k) { return !pcov[k] && !pq.pending[k]; });
    if (!ks.length) return;
    ks.forEach(function (k) { pq.pending[k] = 1; });
    Promise.all(ks.map(function (k) { return IDB.get('cv', k).then(function (rec) { return { k: k, rec: rec }; }); })).then(function (rs) {
      rs.forEach(function (x) {
        if (x.rec && x.rec.b && Date.now() - (x.rec.at || 0) < K.CV_KEEP_MS) { var u = ''; try { u = URL.createObjectURL(x.rec.b); } catch (e) {} if (u) { gSetCov(x.k, u); delete pq.pending[x.k]; return; } }
        if (pq.budget[x.k.split(':')[0]]) delete pq.pending[x.k]; else pqNeed.push(x.k);
      });
      gPumpNet();
    });
  }
  function gPumpNet() {
    while (pq.inflight < K.COV_PAR && pqNeed.length && api) {
      var pf = pqNeed[0].split(':')[0], batch = [], rest = [];
      pqNeed.splice(0, pqNeed.length).forEach(function (k) { if (k.split(':')[0] === pf && batch.length < K.COV_BATCH) batch.push(k); else rest.push(k); });
      pqNeed = rest; pq.inflight++;
      gFetchCovers(pf, batch).then(function () { pq.inflight--; gPumpNet(); }, function () { pq.inflight--; gPumpNet(); });
    }
  }
  function gFetchCovers(pf, pks) {
    var ks = pks.map(function (p) { return num(p.split(':')[1]); });
    return api.request('plat_covers', { pf: pf, ks: ks }, { max: 90000 }).then(function (res) {
      var files = res.files || {}, ids = [], byId = {}, jobs = [], i;
      if (res.budget) pq.budget[pf] = true;
      pks.forEach(function (pk) { var f = files[String(num(pk.split(':')[1]))]; if (f && f.id) { ids.push(f.id); byId[f.id] = pk; } });
      for (i = 0; i < ids.length; i += K.SIGN_MAX) (function (grp) {
        jobs.push(api.sign(grp).then(function (s) {
          return Promise.all(grp.map(function (id) {
            var u = s.urls[id]; if (!u) return null;
            return api.fetchBlob(u).then(function (b) { var pk = byId[id], src = ''; try { src = URL.createObjectURL(b); } catch (e) {} if (src) gSetCov(pk, src); IDB.put('cv', pk, { b: b, at: Date.now() }); }, function () {});
          }));
        }));
      })(ids.slice(i, i + K.SIGN_MAX));
      return Promise.all(jobs);
    }).then(null, function () {}).then(function () { pks.forEach(function (k) { delete pq.pending[k]; }); });
  }
  /* 담지 않고 열기(플랫폼): plat_open(중계가 목록·소스·성인 낱말을 확인) → 회차 목록 */
  function openPk(pk) {
    var it = gItem(pk); if (!it || !api) return;
    var pf = pk.split(':')[0];
    wtScrollY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    var m = { id: null, k: it.k, pf: pf, pk: pk, title: it.n, origin: 'web', status: it.d ? 'done' : 'ongoing', shelf: false, from: 'wt' };
    curManga = m; view = 'chap'; chapItems = null; wtTok++;
    setTitle(m.title); setRefresh(true);
    body().innerHTML = '<div class="mg-wrap"><div id="mgChHead"></div><div id="mgTop"></div><div id="mgSortRow" class="mg-sortrow"></div><div id="mgList" class="mg-list"></div></div>';
    paintChapHead();
    var top = body().querySelector('#mgTop'); if (top) top.innerHTML = sayCard('openload');
    window.scrollTo(0, 0);
    var tok = ++loadTok;
    pollState(true).then(function (r) {
      if (tok !== loadTok) return;
      if (r.j.k === 'pcoff' || r.j.k === 'relay' || r.j.k === 'sw') { if (top) top.innerHTML = sayCard(r.j.k); return; }
      return api.request('plat_open', { pf: pf, k: it.k }, { max: 120000, cancelled: function () { return tok !== loadTok; } }).then(function (res) {
        if (tok !== loadTok) return;
        var c = res.manga || {};
        if (!c.id) throw mkErr('failed', { code: 'not_openable' });
        m.id = c.id; m.shelf = !!c.shelf; if (c.status) m.status = c.status; if (c.title) m.title = c.title;
        setTitle(m.title); paintChapHead();
        loadChapters(m, false);
      });
    }).then(null, function (e) {
      if (tok !== loadTok || (e && e.kind === 'cancel')) return;
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) { var k = errKind(e, st); if (e && e.kind === 'failed' && (e.code === 'not_offered' || e.code === 'out_of_scope')) k = 'notopen'; if (k === 'agebad') k = 'agebado'; else if (k === 'ageunk') k = 'ageunko'; var tp = body().querySelector('#mgTop'); if (tp) tp.innerHTML = sayCard(k); }
    });
  }

  /* ---------------------------------------------------------------- 아래에서 올라오는 시트 */
  var sheetCtx = null;
  function ensureSheet() {
    var el = $('mgSheet'); if (el) return el;
    el = document.createElement('div'); el.id = 'mgSheet'; el.className = 'mg-sheetbg'; el.style.display = 'none';
    el.innerHTML = '<div class="mg-sheet" id="mgSheetBox" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (ev) {
      if (ev.target === el) { closeSheet(); return; }
      var b = ev.target.closest ? ev.target.closest('[data-sh]') : null; if (b) onSheet(b.getAttribute('data-sh'));
    });
    return el;
  }
  function showSheet(ctx, html) {
    var el = ensureSheet(); sheetCtx = ctx; $('mgSheetBox').innerHTML = html;
    el.style.display = 'flex'; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }
  function sheetIsOpen() { var el = $('mgSheet'); return !!(el && el.style.display !== 'none'); }
  function closeSheet() { var el = $('mgSheet'); if (!el || el.style.display === 'none') return false; el.classList.remove('on'); el.style.display = 'none'; sheetCtx = null; return true; }
  function statName(st) { return st === 'done' ? '완결' : (st === 'ongoing' ? '연재 중' : ''); }
  function showItemSheet(it) {
    var url = fcov[it.id] || '', sn = statName(it.status);
    showSheet({ t: 'add', item: it },
      '<div class="mg-sh-head"><span class="mg-sh-cov">' + (url ? '<img alt="" src="' + esc(url) + '">' : '') + '</span><div class="mg-sh-info"><b>' + esc(it.title) + '</b>' + (it.author ? '<small>' + esc(it.author) + '</small>' : '') + (sn ? '<span class="mg-pill inl' + (it.status === 'done' ? '' : ' on') + '">' + sn + '</span>' : '') + '</div></div>' +
      '<p class="mg-sh-note" id="mgShNote" role="status">' + (it.status === 'done' ? '완결작은 앞부분만 무료예요.' : '무료로 열려 있는 화만 볼 수 있어요.') + '</p>' +
      '<div class="mg-acts"><button type="button" class="mg-btn pri" id="mgShAdd" data-sh="add"' + (it.in_shelf ? ' disabled' : '') + '>' + (it.in_shelf ? '이미 담았어요' : '서재에 담기') + '</button><button type="button" class="mg-btn" data-sh="close">닫기</button></div>');
  }
  function showLockedSheet(chap) {
    var gp = curManga && curManga.pf, u = gp ? pfSiteUrl(PFR, gp) : naverUrl(chap && chap.u), lk = gp ? GEN_SAY.locked() : SAY.locked;
    showSheet({ t: 'locked', chap: chap, pf: gp || '' },
      '<div class="mg-sh-lock">' + kfig('sorry') + '<div><b>' + esc(lk.say) + '</b><p>' + esc(lk.sub) + '</p></div></div>' +
      '<div class="mg-acts">' + (u ? '<button type="button" class="mg-btn pri" data-sh="ext">' + (gp ? '정식 사이트 열기' : '네이버웹툰에서 보기') + '</button>' : '') + '<button type="button" class="mg-btn" data-sh="close">닫기</button></div>');
  }
  function showRemoveSheet(m) {
    var local = m.origin !== 'web';
    showSheet({ t: 'rm', m: m },
      '<div class="mg-sh-head"><span class="mg-sh-cov">' + ((lib && lib.cov[m.id]) ? '<img alt="" src="' + esc(lib.cov[m.id]) + '">' : '') + '</span><div class="mg-sh-info"><b>' + esc(m.title) + '</b><small>서재에서 뺄까요?</small></div></div>' +
      (local ? '<p class="mg-sh-note" id="mgShNote">PC의 보관 폴더로 옮겨 둬요. 지워지지 않아요.<br>다시 넣고 싶으면 케이에게 말씀해 주세요.</p>' : '<p class="mg-sh-note" id="mgShNote">다시 담을 수 있어요. 이 폰에 적어 둔 읽은 기록은 그대로 남아요.</p>') +
      '<div class="mg-acts"><button type="button" class="mg-btn pri" data-sh="rm" id="mgShRm">서재에서 빼기</button><button type="button" class="mg-btn" data-sh="close">그만두기</button></div>');
  }
  function sheetNote(t) { var n = $('mgShNote'); if (n) n.textContent = t; }
  function onSheet(act) {
    var c = sheetCtx; if (!c) return;
    if (act === 'close') return closeSheet();
    if (act === 'ext' && c.t === 'locked') { var u = c.pf ? pfSiteUrl(PFR, c.pf) : naverUrl(c.chap && c.chap.u); if (u) { try { host.openUrl(u); } catch (e) { toast('링크를 열지 못했어요.', 2000); } } return; }
    if (act === 'add' && c.t === 'add') return sheetAdd(c.item);
    if (act === 'rm' && c.t === 'rm') return sheetRemove(c.m);
  }
  function sheetAdd(it) {
    var btn = $('mgShAdd'); if (!btn || btn.disabled) return;
    btn.disabled = true; btn.textContent = '담는 중…'; sheetNote('케이가 담고 있어요. 잠깐만요.');
    api.request('library_add', { manga_id: it.id }, { max: 120000 }).then(function (res) {
      it.in_shelf = true;
      var card = res && res.manga;
      if (card) {
        lib = lib || { mangas: [], at: Date.now(), cov: {} };
        lib.mangas = lib.mangas.filter(function (x) { return x.id !== card.id; }); lib.mangas.push(card);
        lib.mangas.sort(function (a, b) { return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0); });
        if (fcov[it.id]) lib.cov[card.id] = fcov[it.id];
        if (card.total > 0) { var nums = card.total; store.setSeen(card.id, nums); }
      }
      closeSheet(); toast('서재에 담았어요.', 2200); paintFind();
    }, function (e) {
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) {
        var k = errKind(e, st), say = SAY[k] || SAY.fail;
        sheetNote(say.say + (say.sub ? ' ' + say.sub : ''));
        if (k === 'agebad') { btn.textContent = '담을 수 없어요'; return; }
        btn.disabled = false; btn.textContent = '다시 담기';
      }
    });
  }
  function sheetRemove(m) {
    var btn = $('mgShRm'); if (!btn || btn.disabled) return;
    btn.disabled = true; btn.textContent = '빼는 중…';
    api.request(m.origin === 'web' ? 'library_remove' : 'local_remove', { manga_id: m.id }, { max: 60000 }).then(function () {
      if (lib && lib.mangas) lib.mangas = lib.mangas.filter(function (x) { return x.id !== m.id; });
      closeSheet(); toast('서재에서 뺐어요.', 2000);
      if (view === 'lib') paintLibrary();
      else if (view === 'chap') { loadTok++; view = 'lib'; curManga = null; chapItems = null; setTitle('만화'); renderShell(); if (browseOn()) { tab = 'lib'; markTab(); } paintLibrary(); }
    }, function (e) {
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) { var k = errKind(e, st), say = SAY[k] || SAY.fail; toast(say.say, 2500); sheetNote(say.say + (say.sub ? ' ' + say.sub : '')); btn.disabled = false; btn.textContent = '서재에서 빼기'; }
    });
  }
  function markLocked(cid) {
    (chapItems || []).forEach(function (c) { if (c.id === cid) c.locked = true; });
    if (view === 'chap' && !rd) paintChapters();
  }
  function chapById(cid) {
    var a = (rd && rd.items) || chapItems || [], i; for (i = 0; i < a.length; i++) if (a[i].id === cid) return a[i];
    return { id: cid, u: '' };
  }

  /* ---------------------------------------------------------------- 눌림 */
  function onBodyClick(ev) {
    var t = ev.target, el = t.closest ? t.closest('[data-m],[data-c],[data-act],[data-resume],[data-f],[data-tab],[data-bv],[data-bd],[data-bs],[data-t],[data-csort],[data-pfc],[data-pk],[data-gm],[data-gl]') : null;
    if (!el) return;
    if (Date.now() - lpFired < 600) { ev.preventDefault(); return; }       // 길게 눌러 시트가 뜬 뒤에 따라오는 눌림은 무시
    if (el.hasAttribute('data-tab')) return selectTab(el.getAttribute('data-tab'), true);
    if (el.hasAttribute('data-pfc')) { var pc = el.getAttribute('data-pfc'); if (pfSt(pc).s === 'read') return pfUse(pc); return openPf(pc); }
    if (el.hasAttribute('data-pk')) return openPk(el.getAttribute('data-pk'));
    if (el.hasAttribute('data-gm')) { var gp1 = curPf(); pfPrefs.mode[gp1] = { m: el.getAttribute('data-gm') === 'new' ? 'new' : 'pop', l: gModeState().l }; pfSave(); sres = { open: false, on: false, q: '', items: null }; paintSearch(); paintChips(); paintWHead(); return gLoad({ force: true }); }
    if (el.hasAttribute('data-gl')) { var gp2 = curPf(); pfPrefs.mode[gp2] = { m: gModeState().m, l: el.getAttribute('data-gl') }; pfSave(); sres = { open: false, on: false, q: '', items: null }; paintSearch(); paintChips(); paintWHead(); return gLoad({ force: true }); }
    if (el.hasAttribute('data-bv')) return setBs({ view: el.getAttribute('data-bv') === 'done' ? 'done' : 'day' });
    if (el.hasAttribute('data-bd')) return setBs({ day: Math.max(0, Math.min(6, num(el.getAttribute('data-bd')))) });
    if (el.hasAttribute('data-bs')) { var sv = el.getAttribute('data-bs'); return setBs(bs.view === 'done' ? { sortDone: sv } : { sort: sv }); }
    if (el.hasAttribute('data-csort')) return sortChapters(el.getAttribute('data-csort'));
    if (el.hasAttribute('data-t')) return openBrowse(num(el.getAttribute('data-t')));
    if (el.hasAttribute('data-f')) { var fi = findItem(Number(el.getAttribute('data-f'))); if (fi) showItemSheet(fi); return; }
    if (el.hasAttribute('data-m')) return openManga(Number(el.getAttribute('data-m')));
    if (el.hasAttribute('data-resume')) return resumeFromBand();
    var act = el.getAttribute('data-act');
    if (act === 'pfall') return openPf('');
    if (act === 'gmore') { gLoad({ page: gl.page + 1, force: true }); return; }
    if (act === 'retry') { if (view === 'chap' && curManga && !curManga.id && curManga.pk) return openPk(curManga.pk); if (view === 'chap' && curManga && !curManga.id && curManga.t) return openBrowse(curManga.t); return view === 'find' ? (finder.pop = null, openFind()) : refresh(true); }
    if (act === 'gowt') return selectTab('wt', true);
    if (act === 'addcur') return addCurrent();
    if (act === 'bsearch') return toggleSearch();
    if (act === 'bsearchclose') return closeWSearch();
    if (act === 'bcols') { bs.cols = bs.cols === 2 ? 3 : 2; saveBs(); paintWHead(); paintWList(); return; }
    if (act === 'bmore') { wtLoad({ page: bl.page + 1, force: true }); return; }
    if (act === 'find') return openFind();
    if (act === 'rmcur') { if (curManga && (browseOn() ? isShelf(curManga) : isWebManga(curManga))) showRemoveSheet(curManga); return; }
    if (act === 'pass') { if (host.askPass) host.askPass(''); return; }
    if (el.hasAttribute('data-c')) {
      var cid = Number(el.getAttribute('data-c')), p = Number(el.getAttribute('data-p') || 0);
      if (el.hasAttribute('data-lock')) return showLockedSheet(chapById(cid));
      return startReading(curManga, cid, p);
    }
  }
  function resumeFromBand() {
    var last = store.getLast(), m = null;
    if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (last && x.id === last.mid) m = x; });
    if (!last || !m) {      // 이 기기에 기록이 없으면 PC 에 적힌 읽은 곳(다른 기기에서 읽은 것)
      var srv = null;
      if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.last_read && !srv) srv = x; });
      if (!srv) return;
      m = srv; last = { cid: srv.last_read.id, cname: srv.last_read.name, p: srv.last_read.last_page || 0, r: !!srv.last_read.is_read };
    }
    curManga = m;
    if (last.r) { pendingNext = last.cid; openManga(m.id); return; }      // 다 읽은 회차면 회차 목록을 받아 그 다음 화로
    openReader({ mid: m.id, mtitle: m.title, cid: last.cid, cname: last.cname || '', page: Math.max(0, last.p | 0), web: isWebManga(m) });
  }

  /* =====================================================================
   * 4. 읽기 화면
   * ===================================================================*/
  var BAR_ICON_BACK = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function buildReader() {
    if ($('mgReader')) return;
    var d = document.createElement('div');
    d.id = 'mgReader'; d.className = 'mg-reader'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', '만화 읽기'); d.style.display = 'none';
    d.innerHTML =
      '<div class="mg-rbody" id="mgRBody"></div>' +
      '<div class="mg-rtop" id="mgRTop"><button type="button" class="mg-ibtn" id="mgRBack" aria-label="회차 목록으로">' + BAR_ICON_BACK + '</button>' +
      '<div class="mg-rtitle"><b id="mgRT"></b><small id="mgRS"></small></div><button type="button" class="mg-chip" id="mgRMode"></button></div>' +
      '<div class="mg-rbot" id="mgRBot"><div class="mg-rrange"><input type="range" id="mgRRange" min="1" max="1" value="1" aria-label="쪽 이동"></div>' +
      '<div class="mg-rinfo"><span id="mgRPage"></span><span id="mgRData"></span></div></div>' +
      '<div class="mg-rbadge" id="mgRBadge" aria-hidden="true"></div><div class="mg-rnote" id="mgRNote" role="status" style="display:none"></div>';
    document.body.appendChild(d);
    $('mgRBack').addEventListener('click', function () { closeReader(); });
    $('mgRMode').addEventListener('click', function () { if (rd) setMode(nextMode(rd.mode), true); });
    var rg = $('mgRRange');
    rg.addEventListener('input', function () { if (rd) $('mgRPage').textContent = rg.value + ' / ' + rd.total; });
    rg.addEventListener('change', function () { if (rd) goPage(Number(rg.value) - 1, { jump: true }); });
    document.addEventListener('keydown', onKey);
  }

  function startReading(m, cid, page) {
    if (!m) return;
    var ch = null;
    if (chapItems) chapItems.forEach(function (c) { if (c.id === cid) ch = c; });
    var name = ch ? ch.name : '';
    if (!ch) { var l = store.getLast(); if (l && l.cid === cid) name = l.cname; }
    if (ch && ch.state === 'read') page = 0;
    openReader({ mid: m.id, mtitle: m.title, cid: cid, cname: name, page: Math.max(0, page | 0), web: isWebManga(m) });
  }

  function openReader(o) {
    buildReader();
    if (rd) teardown(false);
    var mode = store.getMode(o.mid);
    rd = { web: !!o.web, tok: Date.now() + Math.random(), mid: o.mid, mtitle: o.mtitle, cid: o.cid, cname: o.cname, key: 'c:' + o.cid, total: 0, page: o.page, start: o.page,
      mode: mode, auto: !mode, files: {}, dims: {}, blobs: {}, signing: {}, wait: {}, order: [], sentPage: -1, sentRead: false, readNow: false, ready: false,
      timers: {}, lastReopen: 0, curIdx: 0, hint: o.page > 0, items: (chapItems && curManga && curManga.id === o.mid) ? chapItems : null };
    var R = $('mgReader');
    R.style.display = 'flex'; document.documentElement.classList.add('mg-rd-on'); R.classList.toggle('web', !!o.web);
    $('mgRT').textContent = o.mtitle; $('mgRS').textContent = o.cname || '';
    $('mgRMode').style.visibility = 'hidden';
    $('mgRBody').innerHTML = '<div class="mg-rload">' + sayCard('load', { say: '케이가 PC에서 그림을 가져오고 있어요.', sub: '' }) + '</div>';
    showBars(true, true); $('mgRBot').style.visibility = 'hidden'; $('mgRBadge').textContent = '';
    var tok = rd.tok;
    rd.timers.slow = setTimeout(function () { if (rd && rd.tok === tok && !rd.ready) { var s = $('mgRBody').querySelector('.mg-say'); if (s) s.outerHTML = sayCard('slow'); } }, 8000);
    api.request('open', { chapter_id: o.cid, page: o.page }, { cancelled: function () { return !rd || rd.tok !== tok; } }).then(function (res) {
      if (!rd || rd.tok !== tok) return;
      rd.total = num(res.total); rd.page = Math.max(0, Math.min(rd.total - 1, num(res.page, o.page)));
      (res.files || []).forEach(function (f) { rd.files[f.page_no] = f; rd.dims[f.page_no] = { w: f.w, h: f.h }; });
      if (rd.total <= 0) throw mkErr('failed', { code: 'no_pages' });
      if (rd.auto) { var f0 = res.files && res.files[0]; rd.mode = rd.web ? 'v' : autoMode(f0); }      // 웹툰은 첫 쪽 비율과 상관없이 세로 이어 읽기
      rd.ready = true; clearTimeout(rd.timers.slow);
      $('mgRMode').style.visibility = ''; $('mgRBot').style.visibility = '';
      buildPages();
      api.cursor(rd.key, curPage(), rd.total).then(null, function () {});
      sync(); persist(true);
      rd.timers.bars = setTimeout(function () { if (rd && rd.tok === tok) showBars(false); }, K.BARS_MS);
      if (rd.hint && rd.page > 0) badge(rd.web ? '읽던 곳부터 이어서 읽어요' : (rd.page + 1) + '쪽부터 이어서 읽어요', 2200);
      else if (rd.auto) badge(MODE_SAY[rd.mode], 2200);
      // 다음 화로 넘어가려면 회차 목록이 필요하다 — 없으면 뒤에서 받아 둔다
      if (!chapItems || !curManga || curManga.id !== rd.mid) prefetchChapters(rd.mid, tok);
    }).then(null, function (e) {
      if (!rd || rd.tok !== tok || (e && e.kind === 'cancel')) return;
      clearTimeout(rd.timers.slow);
      pollState(false).then(function (r) { readerFail(e, r && r.st); }, function () { readerFail(e, null); });
    });
    function readerFail(e, st) {
      var k = errKind(e, st);
      if (k === 'locked') { markLocked(o.cid); var lc = chapById(o.cid); closeReader(); showLockedSheet(lc); return; }      // 볼 수 없는 화 — 읽기 화면을 닫고 안내 시트(전체를 멈추지 않는다)
      $('mgRBody').innerHTML = '<div class="mg-rload">' + sayCard(k, { extra: '<button type="button" class="mg-btn" data-act="back">목록으로</button>' }) + '</div>';
      var s = $('mgRBody'); s.onclick = function (ev) {
        var a = ev.target.closest ? ev.target.closest('[data-act]') : null; if (!a) return;
        var act = a.getAttribute('data-act');
        if (act === 'retry') { var oo = { mid: o.mid, mtitle: o.mtitle, cid: o.cid, cname: o.cname, page: o.page, web: o.web }; openReader(oo); }
        else if (act === 'pass') { if (host.askPass) host.askPass(''); }
        else if (act === 'back') closeReader();
      };
      $('mgRMode').style.visibility = 'hidden'; $('mgRBot').style.visibility = 'hidden';
    }
  }
  function prefetchChapters(mid, tok) {
    api.request('chapters', { manga_id: mid }, { max: 30000 }).then(function (res) {
      if (!rd || rd.tok !== tok) return;
      var items = (rd.web ? webItems(res.chapters) : (res.chapters || [])).map(function (c) { return mergeChapter(c, store.getPos(c.id)); });
      items.sort(function (a, b) { return a.order - b.order; });
      rd.items = items; refreshEnd();
    }, function () {});
  }

  /* ---- 방향 ---- */
  function isV() { return rd && rd.mode === 'v'; }
  function isRtl() { return rd && rd.mode === 'rtl'; }
  function setMode(m, user) {
    if (!rd || !rd.ready) return;
    rd.mode = m; if (user) { store.setMode(rd.mid, m); rd.auto = false; }
    var p = rd.page;
    buildPages(); goPage(p, { silent: true, instant: true });
    badge(MODE_SAY[m], 1800);
    showBars(true);
  }
  function modeChip() { var c = $('mgRMode'); if (!c || !rd) return; c.innerHTML = '<span aria-hidden="true">' + ({ v: '↕', ltr: '→', rtl: '←' }[rd.mode]) + '</span> ' + MODE_NAME[rd.mode]; c.setAttribute('aria-label', '읽는 방향 바꾸기, 지금은 ' + MODE_SAY[rd.mode]); }

  /* ---- 쪽 칸 만들기 ---- */
  function buildPages() {
    var B = $('mgRBody'), total = rd.total, i;
    modeChip();
    $('mgRRange').max = String(total); $('mgRRange').value = String(rd.page + 1);
    $('mgRRange').style.direction = isRtl() ? 'rtl' : 'ltr';
    var ratio = avgRatio(rd.dims), html = '';
    if (isV()) {
      html = '<div class="mg-vs" id="mgVS" tabindex="-1">';
      for (i = 0; i < total; i++) html += vBlock(i, ratio);
      html += '<div class="mg-vp end" data-p="' + total + '">' + endCard() + '</div></div>';
      B.innerHTML = html; B.className = 'mg-rbody v';
      var vs = $('mgVS');
      vs.addEventListener('scroll', onVScroll, { passive: true });
      bindTap(vs, false);
    } else {
      html = '<div class="mg-stage" id="mgStage"><div class="mg-track" id="mgTrack">';
      for (var idx = 0; idx <= total; idx++) {
        var p = idxToPage(idx, total, isRtl());
        html += '<div class="mg-sl' + (p === total ? ' end' : '') + '" data-p="' + p + '">' + (p === total ? endCard() : slideInner(p)) + '</div>';
      }
      html += '</div></div>';
      B.innerHTML = html; B.className = 'mg-rbody h';
      bindStage($('mgStage'));
      placeTrack(false);
    }
    B.onclick = function (ev) { var a = ev.target.closest ? ev.target.closest('[data-end]') : null; if (a) onEnd(a.getAttribute('data-end')); };
    paintAll();
    if (isV()) { requestAnimationFrame(function () { scrollToPage(rd.page, true); }); }
  }
  function vBlock(p, ratio) {
    var d = rd.dims[p], r = d && d.w > 0 ? (d.w + '/' + d.h) : (1 + '/' + ratio.toFixed(3));
    return '<div class="mg-vp" data-p="' + p + '" style="aspect-ratio:' + r + '"><span class="mg-ph" aria-hidden="true"><i></i><b>' + (p + 1) + '</b></span></div>';
  }
  function slideInner(p) { return '<span class="mg-ph" aria-hidden="true"><i></i><b>' + (p + 1) + '</b></span>'; }
  function endCard() {
    var nextOK = rd.items ? nextChapterIdx(rd.items, rd.cid) >= 0 : null;
    return '<div class="mg-end">' + kfig('report') + '<b>여기까지예요. 다 읽었어요!</b><p>' + esc(rd.mtitle) + ' · ' + esc(rd.cname) + '</p><div class="mg-acts">' +
      '<button type="button" class="mg-btn pri" data-end="next"' + (nextOK === false ? ' disabled' : '') + '>' + (nextOK === false ? '마지막 화예요' : '다음 화 보기') + '</button>' +
      '<button type="button" class="mg-btn" data-end="list">목록으로</button></div></div>';
  }
  function refreshEnd() {
    var B = $('mgRBody'); if (!B || !rd) return;
    var nodes = B.querySelectorAll('.mg-end'); for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.innerHTML = endCard();
  }
  function onEnd(a) {
    if (a === 'list') return closeReader();
    if (a === 'next') {
      var items = rd.items || chapItems; if (!items) { toast('회차 목록을 가져오고 있어요. 잠깐만요.', 2000); return; }
      var i = nextChapterIdx(items, rd.cid); if (i < 0) return;
      var mid = rd.mid, mt = rd.mtitle, c = items[i], wb = rd.web;
      teardown(true);
      if (view === 'chap') { chapItems = items; paintChapters(); }
      if (c.locked) { closeReader(); showLockedSheet(c); return; }
      openReader({ mid: mid, mtitle: mt, cid: c.id, cname: c.name, page: 0, web: wb });
      rd.items = items;
    }
  }

  /* ---- 칸에 그림 끼우기 ---- */
  function pageBlock(p) {
    var B = $('mgRBody'); if (!B) return null;
    return B.querySelector(isV() ? '.mg-vp[data-p="' + p + '"]' : '.mg-sl[data-p="' + p + '"]');
  }
  function paintPage(p) {
    var blk = pageBlock(p); if (!blk || p >= rd.total) return;
    var url = rd.blobs[p], img = blk.querySelector('img'), d = rd.dims[p];
    if (isV() && d && d.w > 0) blk.style.aspectRatio = d.w + '/' + d.h;
    if (!isV()) { blk.classList.toggle('tall', !!(d && isWebtoon(d.w, d.h))); }
    var near = isV() ? (p >= rd.page - K.BEHIND - 1 && p <= rd.page + K.AHEAD + 1) : (Math.abs(p - rd.page) <= 2);
    if (url && near) {
      if (!img) {
        img = document.createElement('img'); img.alt = (p + 1) + '쪽'; img.decoding = 'async'; img.draggable = false;
        img.onerror = function () { if (rd && rd.blobs[p] === url) { /* 그림이 깨졌으면 다시 받는다 */ dropBlob(p); sync(); } };
        blk.appendChild(img);
      }
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
      blk.classList.add('ok');
      var ph = blk.querySelector('.mg-ph'); if (ph) ph.style.display = 'none';
    } else if (img && !near) { img.removeAttribute('src'); img.parentNode.removeChild(img); blk.classList.remove('ok'); var ph2 = blk.querySelector('.mg-ph'); if (ph2) ph2.style.display = ''; }
    else if (!url) { var ph3 = blk.querySelector('.mg-ph'); if (ph3) ph3.style.display = ''; }
  }
  function paintAll() { for (var p = 0; p < rd.total; p++) paintPage(p); updateInfo(); }
  function dropBlob(p) { var u = rd.blobs[p]; if (u) { if (/^blob:/.test(u)) try { URL.revokeObjectURL(u); } catch (e) {} delete rd.blobs[p]; } }
  function evict() {
    var ks = Object.keys(rd.blobs); if (ks.length <= K.BLOB_MAX) return;
    ks.sort(function (a, b) { return Math.abs(b - rd.page) - Math.abs(a - rd.page); });
    for (var i = 0; i < ks.length - K.BLOB_MAX; i++) { var p = Number(ks[i]); dropBlob(p); paintPage(p); }
  }

  /* ---- 서버에서 쪽 받아 오기(목록 → 서명 → 기기 메모리) ---- */
  function sync() {
    if (!rd || !rd.ready || rd.syncing) return;
    var tok = rd.tok, want = wantedPages(rd.page, rd.total);
    rd.syncing = true;
    api.filesList(rd.key).then(function (list) {
      if (!rd || rd.tok !== tok) return;
      var seen = {};
      list.forEach(function (f) { seen[f.page_no] = true; rd.files[f.page_no] = f; rd.dims[f.page_no] = { w: f.w, h: f.h }; });
      Object.keys(rd.files).forEach(function (k) { if (!seen[k]) delete rd.files[k]; });
      var need = want.filter(function (p) { return rd.files[p] && !rd.blobs[p] && !rd.signing[p]; });
      want.forEach(function (p) { if (!rd.blobs[p] && !rd.wait[p]) rd.wait[p] = Date.now(); if (rd.blobs[p]) delete rd.wait[p]; });
      if (need.length) {
        var grp = need.slice(0, K.SIGN_MAX); grp.forEach(function (p) { rd.signing[p] = 1; });
        return api.sign(grp.map(function (p) { return rd.files[p].id; })).then(function (s) {
          if (!rd || rd.tok !== tok) return;
          var jobs = grp.map(function (p) {
            var u = s.urls[rd.files[p] && rd.files[p].id];
            if (!u) { delete rd.signing[p]; if (rd.files[p]) delete rd.files[p]; return Promise.resolve(); }   // 이미 지워진 쪽 — 다음 목록에서 새 id 로
            return api.fetchBlob(u).then(function (b) { return URL.createObjectURL(b); }, function () { return u; }).then(function (src) {
              delete rd.signing[p];
              if (!rd || rd.tok !== tok) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
              if (rd.blobs[p]) { try { if (/^blob:/.test(src)) URL.revokeObjectURL(src); } catch (e) {} return; }
              rd.blobs[p] = src; paintPage(p); evict(); updateInfo();
            });
          });
          return Promise.all(jobs);
        }, function (e) { grp.forEach(function (p) { delete rd.signing[p]; }); if (e && e.kind === 'badpass') toast('연동 암호가 맞지 않아요.', 2500); });
      }
    }).then(null, function () {}).then(function () {
      if (!rd || rd.tok !== tok) return;
      rd.syncing = false;
      checkStall();
      var missing = wantedPages(rd.page, rd.total).some(function (p) { return !rd.blobs[p]; });
      clearTimeout(rd.timers.sync);
      rd.timers.sync = setTimeout(sync, (missing ? 450 : 2500));
    });
  }
  /* 지금 쪽 그림이 한참 안 오면 중계가 창을 닫았을 수 있으니 다시 열어 달라고 한다(한 번에 20초 간격) */
  function checkStall() {
    if (!rd || !rd.ready || rd.blobs[rd.page]) { hideNote(); return; }
    var w = rd.wait[rd.page] || Date.now();
    if (Date.now() - w < 7000) return;
    if (rd.files[rd.page]) return;
    if (Date.now() - rd.lastReopen > 20000) {
      rd.lastReopen = Date.now();
      var tok = rd.tok;
      api.request('open', { chapter_id: rd.cid, page: rd.page }, { max: 30000, cancelled: function () { return !rd || rd.tok !== tok; } }).then(function (res) {
        if (!rd || rd.tok !== tok) return;
        (res.files || []).forEach(function (f) { rd.files[f.page_no] = f; rd.dims[f.page_no] = { w: f.w, h: f.h }; });
        api.cursor(rd.key, curPage(), rd.total).then(null, function () {});
      }, function () {});
    }
    if (Date.now() - w > 12000 && lastJudge && lastJudge.k === 'ok') note('아직 못 가져왔어요. PC가 바쁜 것 같아요.');
  }
  function readerState(j) {
    if (!rd || !rd.ready) return;
    if (j.k === 'pcoff' || j.k === 'relay' || j.k === 'sw') note(SAY[j.k].say + ' 받아 둔 쪽은 계속 볼 수 있어요.'); else if (rd.blobs[rd.page]) hideNote();
  }
  function note(t) { var n = $('mgRNote'); if (!n) return; n.textContent = t; n.style.display = ''; }
  function hideNote() { var n = $('mgRNote'); if (n) n.style.display = 'none'; }

  /* ---- 쪽 옮기기 ---- */
  function goPage(p, o) {
    if (!rd || !rd.ready) return;
    o = o || {};
    p = Math.max(0, Math.min(rd.total, p));
    var changed = p !== rd.page;
    rd.page = p;
    if (isV()) { if (o.jump || o.instant) scrollToPage(p, !!o.instant); }
    else placeTrack(!o.instant && motionOn());
    updateInfo();
    if (changed || o.jump) afterMove();
  }
  function afterMove() {
    if (!rd) return;
    var tok = rd.tok;
    for (var p = Math.max(0, rd.page - 3); p <= Math.min(rd.total - 1, rd.page + K.AHEAD + 1); p++) paintPage(p);
    clearTimeout(rd.timers.cur);
    rd.timers.cur = setTimeout(function () {
      if (!rd || rd.tok !== tok) return;
      api.cursor(rd.key, curPage(), rd.total).then(null, function () {});
      persist(false);
    }, 250);
    clearTimeout(rd.timers.sync); sync();
    evict();
    if (rd.page >= rd.total - 1) markRead();
  }
  /* 중계에 알리는 쪽 — 세로에서는 끝 카드까지 내려가도 마지막 쪽으로(끝으로 알리면 중계가 그림을 모두 지워 아직 못 받은 쪽이 빈칸으로 남는다) */
  function curPage() { return (isV() && rd.total > 0) ? Math.min(rd.page, rd.total - 1) : rd.page; }
  function markRead() { if (!rd || rd.readNow) return; rd.readNow = true; store.setPos(rd.cid, rd.total - 1, rd.total, true); persist(false); sendProgress(); }
  function persist() {
    if (!rd) return;
    var pg = Math.min(rd.page, Math.max(0, rd.total - 1));
    store.setPos(rd.cid, pg, rd.total, rd.readNow);
    store.setLast({ mid: rd.mid, mtitle: rd.mtitle, cid: rd.cid, cname: rd.cname, p: pg, t: rd.total, r: rd.readNow ? 1 : 0, at: Date.now() });
  }
  function sendProgress() {
    if (!rd || rd.total <= 0) return;
    var pg = Math.min(rd.page, rd.total - 1);
    if (rd.sentPage === pg && rd.sentRead === rd.readNow) return;
    rd.sentPage = pg; rd.sentRead = rd.readNow;
    api.submit('progress', { chapter_id: rd.cid, last_page: pg, is_read: !!rd.readNow }).then(null, function () {});
  }
  function updateInfo() {
    if (!rd || !rd.ready) return;
    var shown = Math.min(rd.page + 1, rd.total), end = rd.page >= rd.total;
    var pageTxt = end ? '끝' : shown + ' / ' + rd.total;
    $('mgRPage').textContent = rd.web ? '' : (end ? rd.total + ' / ' + rd.total + ' · 끝' : pageTxt);      // 웹툰은 조각 번호(1/24)·「쪽」 표기를 숨긴다
    $('mgRRange').value = String(Math.min(shown, rd.total));
    var bytes = chapterBytes(Object.keys(rd.files).map(function (k) { return rd.files[k]; }), rd.total);
    $('mgRData').textContent = bytes ? '이 화 ' + fmtMB(bytes) + ' · 데이터망이면 이만큼 써요' : '';
    var bd = $('mgRBadge'); if (bd && !rd.badgeTimer) bd.textContent = rd.web ? '' : (end ? '끝' : pageTxt);
    var bar = $('mgRBadge'); if (bar) bar.classList.toggle('show', !rd.barsOn || bar.classList.contains('msg'));
  }
  function badge(t, ms) {
    var bd = $('mgRBadge'); if (!bd || !rd) return;
    bd.textContent = t; bd.classList.add('show', 'msg');
    clearTimeout(rd.badgeTimer);
    rd.badgeTimer = setTimeout(function () { if (!rd) return; rd.badgeTimer = 0; bd.classList.remove('msg'); updateInfo(); }, ms || 2000);
  }
  function showBars(on, keep) {
    var R = $('mgReader'); if (!R) return;
    if (rd) { rd.barsOn = on; clearTimeout(rd.timers.bars); }
    R.classList.toggle('bars', !!on);
    if (on && !keep && rd) rd.timers.bars = setTimeout(function () { showBars(false); }, K.BARS_MS + 800);
    updateInfo();
  }
  function toggleBars() { showBars(!(rd && rd.barsOn)); }

  /* ---- 세로 ---- */
  function scrollToPage(p, instant) {
    var vs = $('mgVS'), blk = pageBlock(p); if (!vs || !blk) return;
    var top = blk.offsetTop;
    if (instant || !motionOn()) vs.scrollTop = top; else { try { vs.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { vs.scrollTop = top; } }
  }
  var vRaf = 0;
  function onVScroll() {
    if (vRaf) return;
    vRaf = requestAnimationFrame(function () {
      vRaf = 0;
      if (!rd || !isV()) return;
      var vs = $('mgVS'); if (!vs) return;
      var y = vs.scrollTop + vs.clientHeight * 0.35, blks = vs.children, lo = 0, hi = blks.length - 1, p = 0;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (blks[mid].offsetTop <= y) { p = mid; lo = mid + 1; } else hi = mid - 1; }
      if (vs.scrollTop + vs.clientHeight >= vs.scrollHeight - 4) p = rd.total;
      if (p !== rd.page) {
        rd.page = p; updateInfo(); afterMove();
        if (rd.barsOn) showBars(false);
      }
    });
  }

  /* ---- 가로 넘김 ---- */
  function placeTrack(anim, dx) {
    var tr = $('mgTrack'); if (!tr) return;
    var idx = pageToIdx(rd.page, rd.total, isRtl());
    rd.curIdx = idx;
    tr.style.transition = anim ? 'transform .22s ease' : 'none';
    tr.style.transform = 'translate3d(calc(' + (-idx * 100) + '% + ' + (dx || 0) + 'px),0,0)';
  }
  function bindStage(el) {
    var sx = 0, sy = 0, st = 0, lock = '', id = -1, dx = 0;
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; st = Date.now(); lock = ''; id = e.pointerId; dx = 0;
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var mx = e.clientX - sx, my = e.clientY - sy;
      if (!lock) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) { lock = 'h'; try { el.setPointerCapture(id); } catch (er) {} }
        else if (Math.abs(my) > 10) lock = 'v';
      }
      if (lock === 'h') {
        var idx = rd.curIdx, n = rd.total + 1, d = mx;
        if ((idx === 0 && d > 0) || (idx === n - 1 && d < 0)) d = d * 0.3;      // 끝에서는 저항
        dx = d; placeTrack(false, d);
      }
    });
    function end(e) {
      if (e.pointerId !== id) return;
      id = -1;
      var W = el.clientWidth || 1, dt = Math.max(1, Date.now() - st);
      if (lock === 'h') {
        var fast = Math.abs(dx) / dt > 0.45, far = Math.abs(dx) > W * 0.18, idx = rd.curIdx;
        if (e.type !== 'pointercancel' && (fast || far)) idx += dx < 0 ? 1 : -1;
        idx = Math.max(0, Math.min(rd.total, idx));
        goPage(idxToPage(idx, rd.total, isRtl()), {});
        placeTrack(motionOn());
      } else if (!lock && e.type === 'pointerup' && dt < 450) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / W;
        if (x < 0.3) stepIdx(-1); else if (x > 0.7) stepIdx(1); else toggleBars();
      }
    }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      if (!rd || e.ctrlKey) return;
      var now = Date.now(); if (now - (rd.wheelAt || 0) < 260) return;
      if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return;
      var sl = e.target.closest ? e.target.closest('.mg-sl.tall') : null;
      if (sl && sl.scrollHeight > sl.clientHeight + 4) return;      // 세로로 긴 쪽은 그 안에서 스크롤
      rd.wheelAt = now; stepIdx((e.deltaY || e.deltaX) > 0 ? 1 : -1);
    }, { passive: true });
  }
  function stepIdx(d) { if (!rd || !rd.ready || isV()) return; goPage(idxToPage(rd.curIdx + d, rd.total, isRtl()), {}); }
  function bindTap(el) {
    var sx = 0, sy = 0, st = 0, id = -1;
    el.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; st = Date.now(); id = e.pointerId; });
    el.addEventListener('pointerup', function (e) {
      if (e.pointerId !== id) return; id = -1;
      if (Math.abs(e.clientX - sx) < 8 && Math.abs(e.clientY - sy) < 8 && Date.now() - st < 450) { if (e.target.closest && e.target.closest('button')) return; toggleBars(); }
    });
  }
  function onKey(e) {
    if (!rd || !rd.ready || $('mgReader').style.display === 'none') return;
    var k = e.key;
    if (k === 'Escape') { closeReader(); e.preventDefault(); return; }
    if (isV()) return;               // 세로는 기본 스크롤(방향키·스페이스)
    if (k === 'ArrowRight') { stepIdx(1); e.preventDefault(); }
    else if (k === 'ArrowLeft') { stepIdx(-1); e.preventDefault(); }
    else if (k === ' ' || k === 'PageDown') { stepIdx(isRtl() ? -1 : 1); e.preventDefault(); }
    else if (k === 'PageUp') { stepIdx(isRtl() ? 1 : -1); e.preventDefault(); }
  }

  /* ---- 닫기 ---- */
  function teardown(markDone) {
    if (!rd) return;
    var r = rd; rd = null;
    Object.keys(r.timers).forEach(function (k) { clearTimeout(r.timers[k]); });
    clearTimeout(r.badgeTimer);
    // 읽은 위치를 이 기기와 PC(서버)에 한 번씩 적고, 중계에는 「화면 닫힘」을 알려 그 회차 그림을 지우게 한다
    var pg = Math.min(r.page, Math.max(0, r.total - 1));
    if (r.total > 0) {
      store.setPos(r.cid, pg, r.total, r.readNow);
      store.setLast({ mid: r.mid, mtitle: r.mtitle, cid: r.cid, cname: r.cname, p: pg, t: r.total, r: r.readNow ? 1 : 0, at: Date.now() });
      if (r.sentPage !== pg || r.sentRead !== r.readNow) api.submit('progress', { chapter_id: r.cid, last_page: pg, is_read: !!r.readNow }).then(null, function () {});
      api.cursor(r.key, -1, r.total).then(null, function () {});
    } else api.cursor(r.key, -1, 0).then(null, function () {});
    Object.keys(r.blobs).forEach(function (k) { var u = r.blobs[k]; if (/^blob:/.test(u)) try { URL.revokeObjectURL(u); } catch (e) {} });
    var R = $('mgReader'); if (R) { R.style.display = 'none'; R.classList.remove('bars'); }
    $('mgRBody').innerHTML = '';
    document.documentElement.classList.remove('mg-rd-on');
    r.items = r.items || null;
    return r;
  }
  function closeReader() {
    if (!rd) return false;
    var mid = rd.mid;
    teardown(true);
    if (isShown()) {
      if (view === 'chap' && chapItems) {
        chapItems = chapItems.map(function (c) { var o = mergeChapter({ id: c.id, name: c.name, order: c.order, number: c.number, locked: c.locked, u: c.u, pages: c.pages, is_read: c.state === 'read', last_page: c.state === 'prog' ? c.page : 0 }, store.getPos(c.id)); o.isnew = c.isnew; return o; });
        paintChapters();
        setTimeout(function () { if (view === 'chap' && curManga && curManga.id === mid && !rd) loadChapters(curManga, true); }, 1500);   // 서버에 적힌 읽은 표시를 맞춰 본다
      } else if (view === 'lib') paintResume();
    }
    return true;
  }

  /* =====================================================================
   * 5. 앱 연결
   * ===================================================================*/
  function back() {
    if (pfIsOpen()) { closePf(); return true; }
    if (sheetIsOpen()) { closeSheet(); return true; }
    if (rd) { closeReader(); return true; }
    if (view === 'chap' || view === 'find') {
      findTok++;
      var from = curManga && curManga.from;
      loadTok++; view = 'lib'; curManga = null; chapItems = null; setTitle('만화');
      renderShell();
      if (browseOn()) {
        markTab();
        if (from === 'wt') { tab = 'wt'; markTab(); paintWtShell(); wtLoad({}); var y = wtScrollY; setTimeout(function () { window.scrollTo(0, y); }, 0); setTimeout(function () { window.scrollTo(0, y); }, 250); }
        if (lib && lib.mangas) { paintLibrary(); refreshLib(false, true); } else refreshLib(false, true);
        if (from !== 'wt' && tab === 'wt') { paintWtShell(); wtLoad({}); }
        return true;
      }
      if (lib && lib.mangas) { paintLibrary(); refresh(false, true); } else refresh(false);
      return true;
    }
    stopStateTimer(); loadTok++;
    return false;                       // 더 닫을 게 없으면 홈으로(app.js)
  }
  function leave() {
    closePf(); closeSheet(); findTok++; wtTok++;
    if (rd) teardown(true);
    stopStateTimer(); loadTok++;
  }
  function resume() { if (isShown() && !rd) { if (!host.getPass()) return; open(); } }
  function init(h) {
    if (inited) return;
    inited = true;
    for (var k in h) if (h.hasOwnProperty(k)) host[k] = h[k];
    store = makeStore((function () { try { return global.localStorage; } catch (e) { return null; } })());
    api = makeApi({
      cfg: function () { return host.cfg(); },
      pass: function () { return host.getPass(); },
      fetch: function () { return global.fetch.apply(global, arguments); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (isShown() && !stateTimer) startStateTimer();
      if (rd && rd.ready) sync();
    });
  }
  global.MangaTab = {
    init: init, open: open, back: back, leave: leave, resume: resume,
    _test: { bl: function () { return bl; }, bs: function () { return bs; }, tab: function () { return tab; }, bcov: function () { return bcov; }, browseOn: browseOn, openPf: openPf, closePf: closePf, pf: function () { return { prefs: pfPrefs, info: pfInfoNow(), cur: curPf(), rows: PFR, gl: gl, pcov: pcov }; }, openFind: openFind, closeSheet: closeSheet, finder: function () { return finder; }, state: function () { return { view: view, rd: rd, lib: lib, chapItems: chapItems, curManga: curManga }; }, api: function () { return api; }, store: function () { return store; }, startReading: startReading, goPage: goPage, setMode: setMode }
  };
})(typeof window !== 'undefined' ? window : this);

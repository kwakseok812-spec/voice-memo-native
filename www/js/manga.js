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
 *   (PC 꺼짐 / 중계 멈춤 / 만화 서버 쉬는 중 / 서재 비어 있음 / 못 불러옴 / 암호 불일치 / 서버 준비 중 / 인터넷 불안정).
 * 쪽 받기: 중계가 현재 쪽 기준 앞 6쪽·뒤 2쪽만 서버에 올려 두므로(그림은 3시간짜리 서명 주소), 앱은 보기 직전에 주소를 받아
 *   그림을 이 기기 메모리(blob)에 담아 둔다. 이미 본 쪽은 서버에서 지워져도 다시 볼 수 있다(최대 36쪽, 넘으면 먼 쪽부터 비움).
 *   폰에 파일을 저장하지 않는다(메모리뿐 · 화면을 닫으면 비움).
 * 스위치: app.js 의 MANGA_UI('on' | 'off' — off 면 홈 칸이 없어 v10.26 과 같다). 새 권한·새 네이티브 코드 없음.
 *   v10.28: MANGA_WEB('on' | 'off' — off 면 「웹툰 찾기」 칸과 웹툰 표시가 없어 v10.27 과 같다). 웹툰은 서재에 PC 만화와 한 목록, 세로 이어 읽기가 기본,
 *   볼 수 없는 화는 「이 화는 앱에서 볼 수 없어요」 안내 + 「네이버웹툰에서 보기」(바깥 브라우저·앱으로 열기, 앱이 직접 받지 않음).
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
    BARS_MS: 3200          // 읽기 화면 위·아래 줄이 저절로 숨는 시간
  };
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
      if (info.suwayomi === false) return { k: 'sw', relayAge: relayAge, pcAge: pcAge, web: info.web || '' };
      return { k: 'ok', relayAge: relayAge, pcAge: pcAge, web: info.web || '' };
    }
    if (pcAge === null || pcAge > K.PC_STALE) return { k: 'pcoff', relayAge: relayAge, pcAge: pcAge };
    return { k: 'relay', relayAge: relayAge, pcAge: pcAge };
  }

  /* 화면에 말할 문장(케이 말투, 기술 용어 없음). pose 는 케이가 취할 자세. */
  var SAY = {
    pcoff: { say: 'PC가 꺼져 있어요.', sub: '켜지면 다시 볼 수 있어요.', pose: 'sorry', retry: true },
    relay: { say: 'PC의 만화 연결이 멈춰 있어요.', sub: 'PC는 켜져 있는데 만화를 가져오는 부분만 쉬고 있어요. 케이에게 다시 켜 달라고 말씀해 주세요.', pose: 'sorry', retry: true },
    sw: { say: '만화 서버가 쉬고 있어요.', sub: '조금 있다가 다시 확인해 볼게요.', pose: 'sorry', retry: true },
    empty: { say: '서재가 비어 있어요.', sub: 'PC에 만화를 넣어 두시면 바로 여기에 나타나요. 아래 +를 눌러 웹툰을 담을 수도 있어요.', pose: 'guide', retry: true },
    fail: { say: '못 불러왔어요.', sub: '잠깐 뒤에 다시 해 볼까요?', pose: 'sorry', retry: true },
    net: { say: '인터넷이 불안정한 것 같아요.', sub: '연결을 확인하고 다시 해 볼까요?', pose: 'sorry', retry: true },
    badpass: { say: '연동 암호가 맞지 않아요.', sub: '암호를 다시 확인해 주세요.', pose: 'sorry', pass: true },
    nopass: { say: '연동 암호를 넣으면 PC의 만화를 볼 수 있어요.', sub: '', pose: 'guide', pass: true },
    notready: { say: '만화 서버가 아직 준비되지 않았어요.', sub: '준비가 끝나면 이 화면에서 바로 보여요.', pose: 'sorry', retry: true },
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
    noresult: { say: '찾는 웹툰이 없어요.', sub: '다른 말로 다시 찾아 보세요.', pose: 'guide' }
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

  /* 이 기기 저장소(localStorage)에 적는 읽은 위치·방향·마지막 읽은 곳. 저장소가 막혀 있어도(시험·사생활 보호 창) 앱은 그대로 돈다. */
  function makeStore(ls) {
    var POS = 'smart_manga_pos', LAST = 'smart_manga_last', MODE = 'smart_manga_mode_', SEEN = 'smart_manga_seen_';
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
      setSeen: function (mid, n) { wr(SEEN + mid, String(n)); }
    };
  }

  var MangaPure = {
    K: K, MODES: MODES, MODE_NAME: MODE_NAME, MODE_SAY: MODE_SAY, SAY: SAY, esc: esc, isWebtoon: isWebtoon, autoMode: autoMode, nextMode: nextMode,
    judgeState: judgeState, errKind: errKind, fmtMB: fmtMB, chapterBytes: chapterBytes, avgRatio: avgRatio, pageToIdx: pageToIdx, idxToPage: idxToPage,
    naverUrl: naverUrl, webItems: webItems, mergeChapter: mergeChapter, resumeTarget: resumeTarget, nextChapterIdx: nextChapterIdx, wantedPages: wantedPages, makeStore: makeStore
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
  var host = { toast: function () {}, getPass: function () { return ''; }, askPass: null, openScreen: function () {}, cfg: function () { return null; }, web: true, openUrl: function (u) { try { global.open(u, '_blank'); } catch (e) {} } };
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
    function lpStart(card) { lpClear(); lpTimer = setTimeout(function () { lpTimer = 0; var mid = Number(card.getAttribute('data-m')), m = null; if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.id === mid) m = x; }); if (m && view === 'lib') { lpFired = Date.now(); showRemoveSheet(m); } }, 600); }
    b.addEventListener('pointerdown', function (ev) { var c = ev.target.closest ? ev.target.closest('.mg-card[data-o="web"]') : null; if (c && view === 'lib') { lx = ev.clientX; ly = ev.clientY; lpStart(c); } });
    b.addEventListener('pointermove', function (ev) { if (lpTimer && (Math.abs(ev.clientX - lx) > 10 || Math.abs(ev.clientY - ly) > 10)) lpClear(); });
    b.addEventListener('pointerup', lpClear); b.addEventListener('pointercancel', lpClear);
    b.addEventListener('contextmenu', function (ev) { var c = ev.target.closest ? ev.target.closest('.mg-card[data-o="web"]') : null; if (c && view === 'lib') { ev.preventDefault(); lpClear(); var mid = Number(c.getAttribute('data-m')), m = null; if (lib && lib.mangas) lib.mangas.forEach(function (x) { if (x.id === mid) m = x; }); if (m) { lpFired = Date.now(); showRemoveSheet(m); } } });
    var rf = $('mangaRefresh');
    if (rf) rf.addEventListener('click', function () { refresh(true); });
    buildReader();
  }

  /* ---------------------------------------------------------------- 상태 확인 */
  function pollState() {
    if (!api) return Promise.resolve(null);
    return api.state(true).then(function (st) {
      var j = judgeState(st), was = lastJudge; lastJudge = j;
      if (rd) readerState(j);
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
    if (!host.getPass()) { renderShell(); body().querySelector('#mgTop').innerHTML = sayCard('nopass'); setRefresh(false); return; }
    renderShell();
    if (lib && lib.mangas) { paintLibrary(); refresh(false, true); } else refresh(false);
  }
  function setRefresh(on) { var rf = $('mangaRefresh'); if (rf) rf.style.visibility = on ? '' : 'hidden'; }
  function renderShell() {
    body().innerHTML = '<div class="mg-wrap"><div id="mgTop"></div><div id="mgResume"></div><div id="mgGrid" class="mg-grid" role="list"></div></div>';
    setRefresh(true);
  }

  /* 서재를 새로 받는다. quiet=true 면 이미 보이는 서재를 그대로 두고 뒤에서 확인만 한다. */
  function refresh(force, quiet) {
    if (!api) return;
    if (view === 'chap') return loadChapters(curManga, true, true);
    if (view === 'find') return;
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
    var plus = webOn() ? plusTile() : '';
    if (!ms.length) { top.innerHTML = sayCard('empty'); g.innerHTML = plus; body().querySelector('#mgResume').innerHTML = ''; return; }
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
        (web ? '<em class="mg-pill">웹툰</em>' : '') + '</span>' +
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
    curManga = m; view = 'chap'; chapItems = null;
    setTitle(m.title);
    body().innerHTML = '<div class="mg-wrap"><div id="mgChHead"></div><div id="mgTop"></div><div id="mgList" class="mg-list"></div></div>';
    paintChapHead();
    loadChapters(m, false);
  }
  function isWebManga(m) { return !!(m && m.origin === 'web'); }
  function paintChapHead() {
    var m = curManga, el = body().querySelector('#mgChHead'); if (!el || !m) return;
    var url = (lib && lib.cov[m.id]) || '';
    el.innerHTML = '<div class="mg-chhead"><span class="mg-chcov">' + (url ? '<img alt="" src="' + esc(url) + '">' : '') + (isWebManga(m) ? '<em class="mg-pill">웹툰</em>' : '') + '</span><div class="mg-chinfo"><b>' + esc(m.title) + '</b><small id="mgChSub">' + (chapItems ? chapSub() : '회차를 가져오는 중…') + '</small><small id="mgChFree" class="mg-free"' + (isWebManga(m) && m.status === 'done' ? '' : ' hidden') + '>앞부분만 무료예요</small><div id="mgChBtn" class="mg-btnrow"></div></div></div>';
    if (chapItems) paintChapBtn();
  }
  function chapSub() {
    var n = chapItems.length, un = chapItems.filter(function (c) { return c.state !== 'read'; }).length;
    if (isWebManga(curManga)) return '총 ' + n + '화 · ' + (curManga.status === 'done' ? '완결' : (curManga.status === 'ongoing' ? '연재 중' : '웹툰'));
    return '총 ' + n + '화 · ' + (un ? '안 읽은 ' + un + '화' : '다 읽었어요');
  }
  function paintChapBtn() {
    var t = resumeTarget(chapItems), el = body().querySelector('#mgChBtn'); if (!el) return;
    var h = t ? '<button type="button" class="mg-btn pri" data-act="go" data-c="' + num(chapItems[t.idx].id) + '" data-p="' + num(t.page) + '"' + (chapItems[t.idx].locked ? ' data-lock="1"' : '') + '>' + esc(t.label) + (t.page > 0 && !isWebManga(curManga) ? ' · ' + (t.page + 1) + '쪽' : '') + '</button>' : '';
    if (t && isWebManga(curManga) && chapItems.length && (t.idx > 0 || t.page > 0)) {      // 웹툰: 「이어 읽기」 옆에 「처음부터」
      var f = chapItems[0];
      h += '<button type="button" class="mg-btn" data-act="go" data-c="' + num(f.id) + '" data-p="0"' + (f.locked ? ' data-lock="1"' : '') + '>처음부터</button>';
    }
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
  function paintChapters() {
    var list = body().querySelector('#mgList'); if (!list || !chapItems) return;
    var html = '', web = isWebManga(curManga), arr = web ? chapItems.slice().reverse() : chapItems;      // 웹툰은 새 화가 위
    arr.forEach(function (c) {
      var st;
      if (c.locked) st = '<span class="mg-st lock">' + LOCK_SVG + '앱에서 볼 수 없어요</span>';
      else if (c.state === 'read') st = '<span class="mg-st read">읽음 ✓</span>';
      else if (c.state === 'prog') st = '<span class="mg-st prog">' + (web ? '읽는 중' : '읽는 중 · ' + (c.page + 1) + '쪽' + (c.total ? ' / ' + c.total : '')) + '</span>';
      else if (web) st = c.isnew ? '<span class="mg-st new">새 화</span>' : '';
      else st = '<span class="mg-st new">새 화</span>';
      html += '<button type="button" class="mg-ch ' + c.state + (c.locked ? ' lock' : '') + (web && c.isnew ? ' isnew' : '') + '" data-c="' + num(c.id) + '" data-p="' + (c.state === 'prog' ? num(c.page) : 0) + '"' + (c.locked ? ' data-lock="1"' : '') + '><span class="mg-chn">' + esc(c.name) + (!web && c.pages > 0 ? '<small>' + c.pages + '쪽</small>' : '') + '</span>' + st + '</button>';
    });
    list.innerHTML = html + (web ? '<div class="mg-foot"><button type="button" class="mg-linkbtn" data-act="rmcur">서재에서 빼기</button></div>' : '');
    var sub = $('mgChSub'); if (sub) sub.textContent = chapSub();
    paintChapBtn();
  }

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
    var u = naverUrl(chap && chap.u);
    showSheet({ t: 'locked', chap: chap },
      '<div class="mg-sh-lock">' + kfig('sorry') + '<div><b>' + esc(SAY.locked.say) + '</b><p>' + esc(SAY.locked.sub) + '</p></div></div>' +
      '<div class="mg-acts">' + (u ? '<button type="button" class="mg-btn pri" data-sh="ext">네이버웹툰에서 보기</button>' : '') + '<button type="button" class="mg-btn" data-sh="close">닫기</button></div>');
  }
  function showRemoveSheet(m) {
    showSheet({ t: 'rm', m: m },
      '<div class="mg-sh-head"><span class="mg-sh-cov">' + ((lib && lib.cov[m.id]) ? '<img alt="" src="' + esc(lib.cov[m.id]) + '">' : '') + '</span><div class="mg-sh-info"><b>' + esc(m.title) + '</b><small>서재에서 뺄까요?</small></div></div>' +
      '<p class="mg-sh-note">다시 담을 수 있어요. 이 폰에 적어 둔 읽은 기록은 그대로 남아요.</p>' +
      '<div class="mg-acts"><button type="button" class="mg-btn pri" data-sh="rm" id="mgShRm">서재에서 빼기</button><button type="button" class="mg-btn" data-sh="close">그만두기</button></div>');
  }
  function sheetNote(t) { var n = $('mgShNote'); if (n) n.textContent = t; }
  function onSheet(act) {
    var c = sheetCtx; if (!c) return;
    if (act === 'close') return closeSheet();
    if (act === 'ext' && c.t === 'locked') { var u = naverUrl(c.chap && c.chap.u); if (u) { try { host.openUrl(u); } catch (e) { toast('링크를 열지 못했어요.', 2000); } } return; }
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
    api.request('library_remove', { manga_id: m.id }, { max: 60000 }).then(function () {
      if (lib && lib.mangas) lib.mangas = lib.mangas.filter(function (x) { return x.id !== m.id; });
      closeSheet(); toast('서재에서 뺐어요.', 2000);
      if (view === 'lib') paintLibrary();
      else if (view === 'chap') { loadTok++; view = 'lib'; curManga = null; chapItems = null; setTitle('만화'); renderShell(); paintLibrary(); }
    }, function (e) {
      pollState(false).then(function (r) { fail(r && r.st); }, function () { fail(null); });
      function fail(st) { var k = errKind(e, st); toast((SAY[k] || SAY.fail).say, 2500); btn.disabled = false; btn.textContent = '서재에서 빼기'; }
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
    var t = ev.target, el = t.closest ? t.closest('[data-m],[data-c],[data-act],[data-resume],[data-f]') : null;
    if (!el) return;
    if (Date.now() - lpFired < 600) { ev.preventDefault(); return; }       // 길게 눌러 시트가 뜬 뒤에 따라오는 눌림은 무시
    if (el.hasAttribute('data-f')) { var fi = findItem(Number(el.getAttribute('data-f'))); if (fi) showItemSheet(fi); return; }
    if (el.hasAttribute('data-m')) return openManga(Number(el.getAttribute('data-m')));
    if (el.hasAttribute('data-resume')) return resumeFromBand();
    var act = el.getAttribute('data-act');
    if (act === 'retry') return view === 'find' ? (finder.pop = null, openFind()) : refresh(true);
    if (act === 'find') return openFind();
    if (act === 'rmcur') { if (curManga && isWebManga(curManga)) showRemoveSheet(curManga); return; }
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
    if (sheetIsOpen()) { closeSheet(); return true; }
    if (rd) { closeReader(); return true; }
    if (view === 'chap' || view === 'find') {
      findTok++;
      loadTok++; view = 'lib'; curManga = null; chapItems = null; setTitle('만화');
      renderShell(); if (lib && lib.mangas) { paintLibrary(); refresh(false, true); } else refresh(false);
      return true;
    }
    stopStateTimer(); loadTok++;
    return false;                       // 더 닫을 게 없으면 홈으로(app.js)
  }
  function leave() {
    closeSheet(); findTok++;
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
    _test: { openFind: openFind, closeSheet: closeSheet, finder: function () { return finder; }, state: function () { return { view: view, rd: rd, lib: lib, chapItems: chapItems, curManga: curManga }; }, api: function () { return api; }, store: function () { return store; }, startReading: startReading, goPage: goPage, setMode: setMode }
  };
})(typeof window !== 'undefined' ? window : this);

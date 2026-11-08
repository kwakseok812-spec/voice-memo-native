/* ============================================================================
 * games.js — 홈 「게임」 칸 + 「장기·오목」을 스마트비서 안에서 두기 (v9.83, O-0783)
 * ----------------------------------------------------------------------------
 * 무엇: 홈 맨 끝 「게임」 칸(작은 글씨 「장기·오목」) → 「한 판 둘까요?」 목록 시트 → 게임을 고르면 앱 안 고정 층(#gameRoot)에서 게임이 열린다.
 *       게임 파일은 앱에 담아 둔 원본 그대로의 복사본(www/games/<id>/, 복사·대조 도구 deploy/sync_games.sh)이고, 같은 출처라 두던 판(localStorage janggi.*)이 이어진다.
 *       인터넷이 없어도 열린다. 게임 규칙·AI·화면은 한 글자도 고치지 않는다(원본 0바이트 수정).
 * 층: .app 밖 고정 층(#gameRoot, 문서 뷰어 #docRoot 와 같은 방식, z-index 120 — 시트·토스트·녹음 띠보다 아래). 위 얇은 줄 「‹ 홈 · 게임 이름」 아래에 iframe 하나.
 *       열 때마다 새 iframe 을 만들고 닫을 때 지운다(AI 계산 Worker·타이머가 같이 정리되고, 화면 기록이 쌓이지 않는다).
 * 뒤로 가기: app.js goBack 이 GamesTab.back() 을 먼저 부른다 — 게임이 고르기 화면이 아니면 지금 화면의 「‹ 게임 고르기」를 사람이 누른 것과 같은 길로 눌러 주고, 고르기 화면이면 층을 닫는다.
 *       위 줄 「‹ 홈」은 한 번에 나간다(두던 판은 한 수마다 게임이 스스로 저장해 두므로 잃지 않는다).
 * 연타: v9.81 의 PhoneApps.tryLock()(700ms 하나의 잠금)을 시트 줄(과 GAME_LIST='auto' 일 때 곧바로 열리는 홈 칸)이 쓴다 — 층이 두 번 열리지 않는다. 시트만 여는 홈 칸은 잠금을 잡지 않는다(OTT 칸과 같음). 없으면 이 파일의 같은 모양 잠금.
 * 스위치(app.js): GAME_TAB('on'|'off') · GAME_OPEN('app'|'tab' — 'tab' = 크롬 맞춤 탭으로 Pages 주소 열기, 준비해 둔 대체 길) · GAME_LIST('sheet'|'auto' — 'auto' = 게임이 하나뿐이면 시트를 건너뜀).
 * 이 파일이 하지 않는 것: 서버 통신, 저장(게임 저장은 게임 안에서만), 권한, 새 네이티브 방법. 옛 「영상 정리」 첨부 칸의 id·핸들러와 이름이 겹치는 것을 쓰지 않는다(v9.80 사고).
 * 시험: GamesPure(순수 함수·목록)는 화면 없이 시험할 수 있게 밖으로 내놓았다(node 에서도 require 가능).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 목록·순수 함수
   * ===================================================================*/
  /* 게임 목록. 새 게임을 넣을 때: ① www/games/<id>/ 에 파일 복사(sync_games.sh 에 한 줄) ② 여기에 항목 한 줄.
   *  src = 앱 안 경로(www 기준) · icon = 목록 줄에 쓰는 그림(같은 폴더) · url = 인터넷 주소(https, 크롬 탭 대체 길) · ready = 게임이 켜졌음을 알리는 전역 이름(없으면 load 만 본다)
   *  saves = 두던 판 표식에 쓰는 저장 칸(키 + 그 안의 「둔 수」 배열 이름) — 읽기 실패·모양이 다르면 표식만 안 나온다
   *  mode = '' 이면 전체 스위치(GAME_OPEN)를 따름, 'app'|'tab' 이면 이 게임만 그 방식 */
  var GAMES = [
    { id: 'janggi', name: '장기·오목', sub: '장기·오목', desc: 'AI와 두는 한국 장기와 오목',
      src: 'games/janggi/index.html', icon: 'games/janggi/icon-192.png', url: 'https://kwakseok812-spec.github.io/janggi/',
      ready: '__janggi', saves: [{ key: 'janggi.game.v1', arr: 'hist' }, { key: 'janggi.omok.game.v1', arr: 'moves' }], mode: '' }
  ];
  var TXT = {
    head: '한 판 둘까요?', load: '판을 펴는 중이에요…', fail: '게임을 불러오지 못했어요', failTab: '인터넷 주소로 열기', badge: '두던 판이 있어요', close: '닫기',
    tabFail: '주소를 열지 못했어요. 폰의 기본 브라우저가 있는지 확인해 주세요.', listFail: '게임 목록을 열지 못했어요 — 다시 눌러 주세요.', home: '홈'
  };
  var LOAD_HINT_MS = 600, LOAD_FAIL_MS = 3000, POLL_MS = 120, BACKDROP_GUARD_MS = 350;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function byId(id) { for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i]; return null; }
  function safeUrl(u) { return (typeof u === 'string' && /^https:\/\/[^\s\u0000-\u001f]+$/i.test(u.trim()) && u.length <= 2000) ? u.trim() : ''; }
  /* 홈 칸 작은 글씨: 게임이 하나면 그 게임의 짧은 이름, 둘 이상이면 「첫 게임 외 N」 */
  function tileSub(list) {
    list = list || GAMES;
    if (!list.length) return '';
    return list.length === 1 ? list[0].sub : list[0].sub + ' 외 ' + (list.length - 1);
  }
  function tileLabel(list) { list = list || GAMES; return '게임, ' + tileSub(list); }
  /* 열리는 방식: 게임 하나하나의 mode 가 먼저, 없으면 전체 스위치. 알 수 없는 값은 모두 'app'(안 가려진 쪽) */
  function resolveMode(g, globalMode) {
    var m = (g && g.mode) ? g.mode : globalMode;
    return m === 'tab' ? 'tab' : 'app';
  }
  /* 홈 칸을 눌렀을 때: 'auto' 이고 게임이 하나뿐이면 시트를 건너뛴다. 그 밖(기본 'sheet', 게임 둘 이상)은 시트 */
  function listAction(list, listMode) {
    list = list || GAMES;
    return (listMode === 'auto' && list.length === 1) ? 'direct' : 'sheet';
  }
  /* 두던 판이 있나(수가 1개 이상). getItem = localStorage.getItem 과 같은 모양의 함수. 읽기 실패·모양이 다르면 false(무해) */
  function hasSaved(g, getItem) {
    if (!g || !g.saves || typeof getItem !== 'function') return false;
    for (var i = 0; i < g.saves.length; i++) {
      try {
        var raw = getItem(g.saves[i].key); if (!raw) continue;
        var o = JSON.parse(raw);
        if (o && Array.isArray(o[g.saves[i].arr]) && o[g.saves[i].arr].length >= 1) return true;
      } catch (e) {}
    }
    return false;
  }
  /* 목록이 말이 되는가(중복·빠진 칸·경로·주소 모양). 문제 목록을 돌려준다(빈 배열 = 정상). */
  function validate(list) {
    var bad = [], ids = {};
    (list || GAMES).forEach(function (g) {
      if (!g.id || !/^[a-z][a-z0-9_-]*$/.test(g.id) || ids[g.id]) bad.push('id 없음/모양/중복: ' + g.id); ids[g.id] = 1;
      if (!g.name || !g.sub || !g.desc) bad.push('이름/짧은 이름/설명 없음: ' + g.id);
      if (!g.src || !/^games\/[a-z0-9_-]+\/[A-Za-z0-9_.-]+\.html$/.test(g.src)) bad.push('src 모양: ' + g.id);
      if (!g.icon || !/^games\/[a-z0-9_-]+\/[A-Za-z0-9_.-]+\.png$/.test(g.icon)) bad.push('icon 모양: ' + g.id);
      if (!safeUrl(g.url)) bad.push('url(https) 없음: ' + g.id);
      if (g.mode && g.mode !== 'app' && g.mode !== 'tab') bad.push('mode 값: ' + g.id);
      (g.saves || []).forEach(function (s) { if (!s.key || !s.arr) bad.push('saves 모양: ' + g.id); });
    });
    return bad;
  }

  var GamesPure = { GAMES: GAMES, TXT: TXT, byId: byId, safeUrl: safeUrl, tileSub: tileSub, tileLabel: tileLabel, resolveMode: resolveMode, listAction: listAction, hasSaved: hasSaved, validate: validate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = { GamesPure: GamesPure }; }
  if (typeof document === 'undefined') return;   // node 시험: 화면 부분은 건너뜀

  /* =====================================================================
   * 2. 화면
   * ===================================================================*/
  var ctx = null, localLast = 0, cur = null, pollT = 0, hintT = 0, failT = 0, loadSeq = 0;

  function $(id) { return document.getElementById(id); }
  function isNative() { var C = global.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
  /* 하나의 잠금(700ms) — v9.81 의 PhoneApps 잠금을 그대로 함께 쓴다(칸·시트 줄·OTT·업무 앱 카드가 하나). 없으면 같은 모양의 이 파일 잠금 */
  function tryLock() {
    if (global.PhoneApps && typeof global.PhoneApps.tryLock === 'function') return global.PhoneApps.tryLock();
    var n = Date.now(); if (n - localLast < 700) return false; localLast = n; return true;
  }
  function isOpen() { var r = $('gameRoot'); return !!(r && r.classList.contains('on')); }
  function frameEl() { return $('gameFrame'); }
  function frameWin() { var f = frameEl(); try { return f && f.contentWindow; } catch (e) { return null; } }
  function frameDoc() { var w = frameWin(); try { return w && w.document; } catch (e) { return null; } }
  function toast(m, ms) { if (ctx && ctx.toast) { try { ctx.toast(m, ms); } catch (e) {} } }

  /* ---- 목록 시트 — OTT 시트(atm-sheet)와 같은 틀. 뒤로 가기로 닫힘은 app.js goBack 의 .shin-sheet 처리가 맡는다 ---- */
  function openSheet() {
    var old = document.querySelector('.atm-sheet'); if (old) { try { old.remove(); } catch (e) {} }
    var get = function (k) { return global.localStorage.getItem(k); };
    var sh = document.createElement('div');
    sh.className = 'sheet shin-sheet atm-sheet gm-sheet';
    sh.innerHTML = '<div class="sheet-box" role="dialog" aria-label="게임 고르기"><div class="sheet-head">' + esc(TXT.head) + '</div>' +
      GAMES.map(function (g) {
        var saved = false; try { saved = hasSaved(g, get); } catch (e) {}
        return '<button type="button" class="sheet-btn gm-row" data-gm="' + esc(g.id) + '"><img class="gm-ico" src="' + esc(g.icon) + '" alt="" width="36" height="36">' +
          '<span><b>' + esc(g.name) + '</b><small>' + esc(g.desc) + '</small></span>' + (saved ? '<span class="gm-badge">' + esc(TXT.badge) + '</span>' : '') + '</button>';
      }).join('') +
      '<button type="button" class="sheet-btn atm-close" data-gm="close">' + esc(TXT.close) + '</button></div>';
    var openedAt = Date.now();
    sh.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-gm]') : null;
      if (!b) {   // 바깥(어두운 곳)을 누르면 닫힘 — 단, 홈 칸을 두 번 빠르게 눌렀을 때 두 번째 손가락이 바깥으로 떨어져 막 뜬 시트를 닫아 버리지 않게 처음 0.35초는 무시
        if (ev.target === sh && Date.now() - openedAt >= BACKDROP_GUARD_MS) { try { sh.remove(); } catch (e) {} }
        return;
      }
      var k = b.getAttribute('data-gm');
      if (k === 'close') { try { sh.remove(); } catch (e) {} return; }
      var g = byId(k); if (!g) return;
      if (!tryLock()) return;               // 같은 줄 두 번·다른 칸과 겹침 방지
      try { sh.remove(); } catch (e) {}
      openGame(g);
    });
    document.body.appendChild(sh);
    sh.style.display = 'flex';
  }

  /* ---- 홈 칸 ---- */
  function onTile() {
    if (!ctx || isOpen()) return;                       // 층이 이미 열려 있으면 아무것도 하지 않는다
    try {
      if (listAction(GAMES, ctx.list) === 'direct') { if (!tryLock()) return; openGame(GAMES[0]); }   // 곧바로 게임으로 가는 길만 칸에서 잠금을 잡는다
      else openSheet();                                  // 시트 열기는 잠금 없음(기존 시트를 지우고 다시 만들 뿐 — 칸을 누른 직후 0.7초 안에 줄을 눌러도 열린다). 줄을 누를 때 잠금
    } catch (e) { toast(TXT.listFail); }
  }

  /* ---- 크롬 맞춤 탭(준비해 둔 대체 길) — hub-apps.js 의 열기와 같은 길(ExternalApp.openTab, https 만). PC·일반 브라우저는 새 탭 ---- */
  function openByUrl(g) {
    var u = safeUrl(g.url);
    if (!u) { toast(TXT.tabFail, 3600); return false; }
    var EA = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.ExternalApp;
    function viaWindow() {
      var w = null; try { w = global.open(u, '_blank', 'noopener'); } catch (e) {}
      if (!w && isNative()) toast(TXT.tabFail, 3600);
    }
    if (isNative() && EA && EA.openTab) {
      try { EA.openTab({ url: u }).then(function (r) { if (!r || !r.opened) viaWindow(); }, function () { viaWindow(); }); } catch (e) { viaWindow(); }
    } else viaWindow();
    return true;
  }

  /* ---- 게임 층 ---- */
  function clearTimers() { clearInterval(pollT); clearTimeout(hintT); clearTimeout(failT); pollT = hintT = failT = 0; }
  function showFail() {
    var st = $('gameStage'); if (!st || !isOpen()) return;
    var ld = $('gameLoad'); if (ld) ld.style.display = 'none';
    var f = $('gameFail'); if (f) f.style.display = 'flex';
  }
  function watchLoad(g, seq) {
    var t0 = Date.now(), ready = false;
    function check() {
      if (seq !== loadSeq || !isOpen()) { clearTimers(); return; }
      var w = frameWin(), ok = false;
      try { ok = !!(w && (g.ready ? w[g.ready] : (w.document && w.document.readyState === 'complete'))); } catch (e) { ok = false; }
      if (ok) { ready = true; clearTimers(); var ld = $('gameLoad'); if (ld) ld.style.display = 'none'; var f = $('gameFail'); if (f) f.style.display = 'none'; }
    }
    pollT = setInterval(check, POLL_MS);
    hintT = setTimeout(function () { if (seq === loadSeq && !ready && isOpen()) { var ld = $('gameLoad'); if (ld) ld.style.display = ''; } }, LOAD_HINT_MS);
    failT = setTimeout(function () { if (seq === loadSeq && !ready && isOpen()) { clearInterval(pollT); showFail(); } }, LOAD_FAIL_MS);
  }
  function openGame(g) {
    if (!ctx || !g) return false;
    if (resolveMode(g, ctx.open) === 'tab') return openByUrl(g);
    var root = $('gameRoot'), st = $('gameStage');
    if (!root || !st) { toast(TXT.listFail); return false; }
    if (isOpen()) return false;                         // 이미 열려 있음 — 두 번째 층을 만들지 않는다
    clearTimers(); loadSeq++;
    cur = g;
    st.innerHTML = '';
    var ld = document.createElement('div'); ld.id = 'gameLoad'; ld.className = 'gm-load'; ld.style.display = 'none'; ld.textContent = TXT.load; st.appendChild(ld);
    var fl = document.createElement('div'); fl.id = 'gameFail'; fl.className = 'gm-fail'; fl.style.display = 'none';
    fl.innerHTML = '<b>' + esc(TXT.fail) + '</b><button type="button" id="gameFailTab" class="gm-failbtn">' + esc(TXT.failTab) + '</button>';
    st.appendChild(fl);
    fl.querySelector('#gameFailTab').addEventListener('click', function () { if (!tryLock()) return; openByUrl(g); });
    var fr = document.createElement('iframe'); fr.id = 'gameFrame'; fr.title = g.name; fr.setAttribute('loading', 'eager');
    st.insertBefore(fr, ld);
    $('gameTitle').textContent = g.name;
    var calm = false; try { calm = !!(global.KChar && global.KChar.motionOn && !global.KChar.motionOn()); } catch (e) {}
    root.classList.toggle('calm', calm);
    root.classList.add('on'); root.setAttribute('aria-hidden', 'false');
    fr.style.pointerEvents = 'none';                    // 처음 0.4초는 게임이 손가락을 받지 않는다 — 시트 줄을 두 번 빠르게 눌렀을 때 두 번째 손가락이 막 뜬 게임 첫 화면의 카드를 누르지 않게
    setTimeout(function () { try { fr.style.pointerEvents = ''; } catch (e) {} }, 400);
    fr.src = g.src;
    watchLoad(g, loadSeq);
    return true;
  }
  function close() {
    var root = $('gameRoot'); if (!root) return false;
    var was = isOpen();
    clearTimers(); loadSeq++;
    var fr = frameEl();
    if (fr) { try { fr.src = 'about:blank'; } catch (e) {} try { fr.remove(); } catch (e) {} }   // 게임 문서·AI Worker·타이머를 함께 버린다
    var st = $('gameStage'); if (st) st.innerHTML = '';
    root.classList.remove('on'); root.setAttribute('aria-hidden', 'true'); cur = null;
    return was;
  }
  /* 뒤로 가기 한 번 — 처리했으면 true. 게임이 고르기 화면이 아니면 지금 화면의 「‹ 게임 고르기」를 눌러 주고, 고르기 화면이면(또는 아직 못 불러왔으면) 층을 닫는다 */
  function back() {
    if (!isOpen()) return false;
    var w = frameWin(), doc = frameDoc(), J = null;
    try { J = w && w.__janggi; } catch (e) { J = null; }
    var scr = J && J.S && J.S.screen;
    if (doc && scr && scr !== 'home') {
      var b = null; try { b = doc.querySelector('#' + scr + ' .back'); } catch (e) {}
      if (b) { try { b.click(); return true; } catch (e) {} }
      try { if (J.goHome) { J.goHome(); return true; } } catch (e) {}
    }
    close(); return true;
  }

  function init(c) {
    ctx = c || {};
    var root = $('gameRoot');
    if (root && !root.__gmBound) {
      root.__gmBound = true;
      var bk = $('gameBack'); if (bk) bk.addEventListener('click', function () { close(); });   // 위 줄 「‹ 홈」: 한 번에 나감(data-back 을 쓰지 않는다 — 쓰면 앱 goBack 한 단계 뒤로가 된다)
    }
    return true;
  }

  global.GamesTab = {
    init: init, onTile: onTile, openSheet: openSheet, openGame: function (id) { var g = byId(id); return g ? openGame(g) : false; },
    isOpen: isOpen, back: back, close: close, leave: function () { if (isOpen()) close(); },
    tileSub: function () { return tileSub(GAMES); }, tileLabel: function () { return tileLabel(GAMES); }, list: function () { return GAMES.slice(); }
  };
  global.GamesPure = GamesPure;
})(typeof window !== 'undefined' ? window : globalThis);

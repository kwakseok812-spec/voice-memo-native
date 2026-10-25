/* ============================================================================
 * k-clips.js — 일할 때 케이 영상 (O-0616 · v9.39)
 * ----------------------------------------------------------------------------
 * 일하는 케이 장면(녹음 준비 · PC가 받음 · 명함 찾는 중 · 건강 맞이)에서, 서버에서 받아 둔 짧은 영상(3~5초 · 소리 없음 · 정사각)을 장면 그림 위에 한 번 틀고
 * 0.3초 맞섞어 원래 그림으로 돌아간다. 영상은 서버 목록(옷 묶음의 scene_clips = {장면: [파일…]} · scene_clips_len = 길이 초)에 적힌 것이 전부다 — 영상을 늘리려면 서버 목록에 파일만 더하면 된다(앱 판 불필요).
 *
 * 지키는 선
 *   · 어떤 동작도 영상을 기다리지 않는다. 0.8초 안에 준비가 안 되면 영상 없이 지금 그대로. 화면을 누르거나 나가면 바로 멈춘다. 소리 없음.
 *   · 안 틀 때(그대로 지금 화면): 스위치 꺼짐(상수 K_SCENES · 꾸미기 「일할 때 케이 영상」) · 케이 움직임 끔/절전/데이터 절약/배터리 부족/폰 「움직임 줄이기」
 *     · 시작 인사 덮개가 떠 있음 · 그 옷에 이 장면 영상이 없거나 2편 미만 · 영상을 아직 못 받음 · 다른 머리 조합 사진이 보이는 중.
 *   · 같은 장면은 10분 안에 다시 틀지 않는다(CLIP_GAP_MS). 같은 영상이 이어 나오지 않게 직전 영상을 빼고 고른다(후보 4편 이상이면 직전 2편 · 2~3편이면 직전 1편). 3초 영상은 5초 영상보다 자주(가중 3:2).
 *   · 영상은 서버 목록의 실제 파일만. 값은 만들지 않는다 — 말풍선·숫자·상태는 각 화면의 코드가 그대로 낸다.
 * 부르는 곳: app.js(녹음 준비 열 때 · 명함 검색 누를 때 · PC가 받은 뒤) · health.js(건강 화면을 열 때)
 * ==========================================================================*/
(function () {
  'use strict';
  var K_SCENES = 'on';                       // 'on' | 'off' — off 면 이 파일은 아무것도 하지 않는다(되돌리는 한 줄)
  var CLIP_GAP_MS = 10 * 60 * 1000;          // 같은 장면 다시 틀기까지 최소 간격
  var READY_MS = 800;                        // 이 안에 영상이 준비 안 되면 포기
  var START_DELAY = 150;                     // 장면이 보인 뒤 이만큼 있다가 시작
  var SW_KEY = 'smart_k_clips', AT_KEY = 'smart_k_clip_at', HIST_KEY = 'smart_k_clip_hist';
  var SHORT_S = 3.2;                         // 이 이하는 「짧은 영상」(가중 3), 그 위는 가중 2

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJson(k) { try { var o = JSON.parse(lsGet(k) || 'null'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }

  function switchOn() { return K_SCENES === 'on' && lsGet(SW_KEY) !== '0'; }
  function setSwitch(on) { lsSet(SW_KEY, on ? null : '0'); if (!on) stopAll(); }

  /* ---- 고르기(순수 함수 — 시험용으로도 내보낸다) ----
   * list = [{f, len}] 틀 수 있는(받아 둔) 영상 · hist = 그 장면에서 나온 파일 이름들(오래된 것 → 최근) · rnd = 0~1 (없으면 무작위)
   * 2편 미만이면 null(영상 없음). 직전 2편(후보가 3편 이상) 또는 직전 1편(2편)을 빼고, 짧은 영상이 더 자주 나오게 가중해서 고른다. */
  function pickClip(list, hist, rnd) {
    list = (list || []).filter(function (c) { return c && c.f; });
    if (list.length < 2) return null;
    hist = hist || [];
    var ex = list.length >= 4 ? hist.slice(-2) : hist.slice(-1);     // 후보 4편 이상: 직전 2편 제외 · 2~3편: 직전 1편 제외(3편에서 2편을 빼면 순서가 늘 같아져서)
    var pool = list.filter(function (c) { return ex.indexOf(c.f) < 0; });
    if (!pool.length) pool = list;
    var w = pool.map(function (c) { return (c.len && c.len <= SHORT_S) ? 3 : 2; });
    var tot = w.reduce(function (a, b) { return a + b; }, 0), r = (rnd == null ? Math.random() : rnd) * tot, i = 0;
    for (; i < pool.length - 1; i++) { if (r < w[i]) break; r -= w[i]; }
    return pool[i];
  }

  /* ---- 지금 틀어도 되는가 ---- */
  function calm() { try { return window.KScene ? KScene.calm() : false; } catch (e) { return false; } }
  function introOn() { try { return !!(window.KIntro && KIntro.active && KIntro.active()); } catch (e) { return false; } }
  function readyList(scene) { try { return (window.KChar && KChar.clipList) ? KChar.clipList(scene) : []; } catch (e) { return []; } }
  function gapOk(scene) {
    var t = lsJson(AT_KEY)[scene]; var now = Date.now();
    return !(typeof t === 'number' && now - t >= 0 && now - t < CLIP_GAP_MS);
  }
  // 이유(안 틀 이유가 없으면 ''). 시험·점검이 읽는다
  function blockWhy(scene) {
    if (!switchOn()) return '스위치 꺼짐';
    if (calm()) return '움직임 끔';
    if (introOn()) return '시작 인사 중';
    if (document.hidden) return '화면 안 보임';
    if (readyList(scene).length < 2) return '영상 2편 미만';
    if (!gapOk(scene)) return '10분 안에 이미 나옴';
    return '';
  }
  function canPlay(scene) { return !blockWhy(scene); }

  /* ---- 틀기 ---- */
  var active = [];                           // [{host, vid, fig, token, ...}]
  var seq = 0;

  function figOf(host) { return host && host.querySelector ? (host.querySelector('.kfigw') || host) : null; }
  // force 가 아니고 전신 세로 틀(녹음 준비)이면: 영상을 걷지 않고 멈춘 채 그 장면(서 있는 모습 = 영상의 첫·끝 장면)에 그대로 둔다 — 틀이 사라져 화면이 다시 움직이지 않게. 화면을 나가면(force) 그때 걷는다.
  function dropVid(a, fast, force) {
    if (!a || (a.gone && !(force && a.held))) return;
    clearTimeout(a.tReady); clearTimeout(a.tStart); clearTimeout(a.tCap);
    var v = a.vid;
    if (a.hold && a.shown && !force && v && v.classList.contains('on')) {
      a.gone = true; a.held = true; active = active.filter(function (x) { return x !== a; });
      if (a.host) { a.host._kclip = null; a.host._kheld = a; }
      try { v.pause(); if (!v.ended) v.currentTime = 0; } catch (e) {}
      return;
    }
    a.gone = true;
    active = active.filter(function (x) { return x !== a; });
    if (a.host) { a.host._kclip = null; a.host._kheld = null; try { a.host.classList.remove('kclip-on'); if (!a.shown) a.host.classList.remove('kclip-tall'); } catch (e) {} }
    if (!v) return;
    try { v.classList.remove('on'); v.classList.add('out'); } catch (e) {}
    setTimeout(function () { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} try { if (v.parentNode) v.parentNode.removeChild(v); } catch (e) {} }, fast ? 160 : 340);
  }
  function stopHost(host) { if (host && host._kclip) dropVid(host._kclip, true); }
  function heldAll() { return Array.prototype.map.call(document.querySelectorAll('.ksc,.kempty'), function (el) { return el._kheld; }).filter(Boolean); }
  function stopAll(force) { active.slice().forEach(function (a) { dropVid(a, true, force); }); if (force) heldAll().forEach(function (a) { dropVid(a, true, true); }); }
  // 화면 속 이 장면이 지금 안 보이면(다른 화면으로 갔거나 숨겨짐) 멈춘다
  function visible(host) { try { return !!host && host.isConnected && host.getClientRects().length > 0; } catch (e) { return false; } }

  // host = 장면 덩어리(.ksc · .kempty — 안에 .kfigw 가 있다). opt.reveal() = 영상이 준비된 뒤에 장면을 보이게 하는 함수(처음부터 없던 자리용 — 준비 안 되면 부르지 않는다).
  // opt.key = 같은 화면에서 한 번만(같은 키로 이미 틀었으면 안 튼다). 돌려주는 값 = Promise<true|false>(실제로 틀기 시작했나)
  function play(scene, host, opt) {
    opt = opt || {};
    var no = Promise.resolve(false);
    if (!host || !canPlay(scene)) return no;
    if (host._kclip) return no;                                   // 이미 도는 중
    if (opt.key && host._kclipKey === opt.key) return no;
    var list = readyList(scene);
    var hist = lsJson(HIST_KEY)[scene] || [];
    var c = pickClip(list, hist, opt.rnd);
    if (!c) return no;
    var shape = (window.KChar && KChar.clipShape) ? KChar.clipShape(scene) : 'sq';
    var a = { host: host, scene: scene, token: ++seq, clip: c, gone: false, shape: shape, hold: shape === 'tall' };
    if (host._kheld) dropVid(host._kheld, true, true);
    host._kclip = a; if (opt.key) host._kclipKey = opt.key;
    return new Promise(function (res) {
      var v = document.createElement('video');
      v.className = 'kclipv'; v.muted = true; v.defaultMuted = true; v.loop = false; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
      a.vid = v; active.push(a);
      var settled = false;
      function giveUp() { if (settled) return; settled = true; dropVid(a, true); res(false); }
      a.tReady = setTimeout(giveUp, READY_MS);                    // 0.8초 안에 준비 안 되면 영상 없이 지금 그대로
      v.addEventListener('error', giveUp);
      v.addEventListener('canplay', function () {
        if (settled || a.gone) return; settled = true; clearTimeout(a.tReady);
        a.tStart = setTimeout(function () {
          if (a.gone) return;
          if (!host.isConnected && opt.find) { var nh = opt.find(); if (nh && nh !== host) { host._kclip = null; host = nh; a.host = nh; nh._kclip = a; if (opt.key) nh._kclipKey = opt.key; } }   // 그 사이 화면이 다시 그려져 장면 덩어리가 새것이 됐으면 새것으로
          if (!visible(host) && !opt.reveal) { dropVid(a, true); res(false); return; }
          try { host.classList.toggle('kclip-tall', shape === 'tall'); } catch (e) {}      // 틀 모양은 장면이 보이기 전에(그 자리를 처음부터 맞게)
          if (opt.reveal) { try { opt.reveal(); } catch (e) {} }
          var f = figOf(host);
          if (!f || !visible(host)) { dropVid(a, true); res(false); return; }
          if (getComputedStyle(f).position === 'static') f.style.position = 'relative';
          f.appendChild(v); a.fig = f; a.shown = true; host.classList.add('kclip-on');
          var p; try { p = v.play(); } catch (e) { p = null; }
          if (p && p.catch) p.catch(function () { dropVid(a, true); res(false); });
          res(true);
        }, (typeof opt.delay === 'number') ? opt.delay : START_DELAY);
      });
      v.addEventListener('playing', function () {
        if (a.gone) return;
        v.classList.add('on');
        var at = lsJson(AT_KEY); at[scene] = Date.now(); lsSet(AT_KEY, JSON.stringify(at));            // 실제로 보인 순간부터 10분
        var h = lsJson(HIST_KEY); h[scene] = (h[scene] || []).concat([c.f]).slice(-3); lsSet(HIST_KEY, JSON.stringify(h));
        var cap = (v.duration && isFinite(v.duration) ? v.duration * 1000 : 5200) + 1200;               // 끝남 신호를 못 받아도 이 시간 뒤엔 걷는다
        a.tCap = setTimeout(function () { dropVid(a, false); }, cap);
      });
      v.addEventListener('timeupdate', function () { if (!a.gone && !visible(host)) dropVid(a, true, true); });
      v.addEventListener('ended', function () { dropVid(a, false); });                                  // 0.3초 맞섞어 원래 그림으로
      v.src = c.url;
      try { v.load(); } catch (e) {}
    });
  }

  // 화면을 새로 열었다(KScene.reset ← app.js openScreen · showHome): 돌던 영상은 멈추고, 「한 화면에 한 번」 표시도 지운다. 처음부터 없던 자리(녹음 준비 · 명함 찾는 중)는 다시 숨긴다.
  function screenReset() {
    stopAll(true);
    try {
      Array.prototype.forEach.call(document.querySelectorAll('.ksc,.kempty'), function (el) { el._kclipKey = ''; });
      var d = document.getElementById('kscRecPrep'); if (d) d.style.display = 'none';
      var rp = document.getElementById('recPrep'); if (rp) rp.classList.remove('has-clip');       // 녹음 준비의 케이 배치도 화면을 새로 열 때 걷는다(필요하면 app.js recPrepClip 이 다시 잡는다)
    } catch (e) {}
  }
  // 아무 곳이나 누르면 멈춘다(누른 것은 그대로 동작한다 — 막지 않는다)
  document.addEventListener('pointerdown', function () { if (active.length) stopAll(); }, true);
  document.addEventListener('keydown', function () { if (active.length) stopAll(); }, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopAll(); });
  try { if (window.KChar && KChar.onChange) KChar.onChange(function () { stopAll(); }); } catch (e) {}

  window.KClips = {
    play: play, canPlay: canPlay, screenReset: screenReset, blockWhy: blockWhy, stop: stopHost, stopAll: stopAll,
    switchOn: switchOn, setSwitch: setSwitch,
    pickClip: pickClip,                                          // 시험용
    reset: function () { lsSet(AT_KEY, null); lsSet(HIST_KEY, null); },   // 시험용(10분 기록·직전 기록 비우기)
    constants: function () { return { K_SCENES: K_SCENES, CLIP_GAP_MS: CLIP_GAP_MS, READY_MS: READY_MS, START_DELAY: START_DELAY }; },
    active: function () { return active.length; }
  };
})();

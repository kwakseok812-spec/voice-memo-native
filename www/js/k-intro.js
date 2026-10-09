/* ============================================================================
 * k-intro.js — 앱 시작 인사(O-0116 시험판, 2026-09-30)
 * ----------------------------------------------------------------------------
 * 앱을 켜면 케이가 전신으로 서 있다가 정중히 허리 숙여 인사 → 끝나면 앱 홈으로(전체 = 영상 길이 약 4초).
 *   - <body> 맨 앞에서 동기 로드된다(다른 화면이 그려지기 전에 덮개를 먼저 띄워 흰 화면·깜박임 방지).
 *   - 화면을 한 번 누르면(또는 뒤로 버튼) 즉시 건너뛴다.
 *   - 영상을 1.8초 안에 틀지 못하면(파일 오류·기기 문제) 조용히 건너뛴다. 최대 7초 뒤엔 무조건 닫힌다.
 *   - 움직임 끔(케이 꾸미기) · 움직임 줄이기(OS) · 데이터 절약 · 배터리 15% 이하(충전 중 아님)면 틀지 않는다.
 *   - 다른 앱에서 문서를 「열기/공유 → 스마트비서」로 넘겨받으며 켜진 경우엔 바로 닫는다(문서가 먼저).
 *
 * 인사 멘트(대표님 지시 — 목소리 없이 「자막만」):
 *   허리를 숙이기 시작하는 순간(영상 1.0초)에 멘트 한 줄이 화면 아래에 부드럽게 나타난다.
 *   ⭐ 멘트는 아래 GREETINGS 목록 한 곳에만 있다. 추가·삭제는 여기 한 줄씩만 고치면 된다.
 *   고르기: 후보 = 「언제나」 + 지금 시간대(한국시간) + (월·금요일이면) 요일 멘트 → 그중 무작위.
 *           단 직전에 나온 멘트는 빼고 고른다(localStorage 'smart_k_intro_line' = 마지막 멘트 id).
 *
 * 설정(localStorage 'smart_k_intro'):
 *   'daily'  = 하루 첫 실행만(기본값 · 소장 추천)   'always' = 켤 때마다   'off' = 끄기
 *   ※ 「실행」은 앱을 완전히 새로 켤 때만이다. 다른 앱 갔다 돌아오는 것(백그라운드 복귀)은 인사하지 않는다.
 *
 * 인사 영상이 있는 옷: 아래 BOWS 표(v9.4: 버건디 정장 · 네이비 정장 · 니트 · 한복 · 청바지 셔츠 · 맨투맨 6벌). 없는 옷을 입고 있으면 그 옷의 전신 사진 + 자막으로 인사한다(영상 없음).
 *   옷을 늘릴 땐 assets/k/<옷id>/bow.mp4 · bow_poster.jpg 를 넣고 이 표에 한 줄 추가.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------------- 인사 멘트 목록(여기만 고치면 됨) ----------------
   * when: 'any' = 언제나 / 'morning' = 아침 04~11시 / 'day' = 낮 11~17시 / 'evening' = 저녁·밤 17~04시
   * dow : 요일 멘트(1 = 월요일 … 5 = 금요일). 그 요일에만 후보에 들어간다(시간대 무관).
   * id  : 겹치지 않게만(직전 멘트 제외에 쓴다). */
  var GREETINGS = [
    { id: 'g01', when: 'any',     text: '반갑습니다, 대표님.' },
    { id: 'g02', when: 'any',     text: '안녕하세요, 대표님. 케이입니다.' },
    { id: 'g03', when: 'any',     text: '어서 오세요, 대표님.' },
    { id: 'g04', when: 'any',     text: '오늘도 화이팅입니다, 대표님!' },
    { id: 'g05', when: 'any',     text: '대표님, 기다리고 있었어요.' },
    { id: 'g06', when: 'morning', text: '좋은 아침입니다, 대표님.' },
    { id: 'g07', when: 'morning', text: '대표님, 오늘 하루도 힘차게 시작하세요!' },
    { id: 'g08', when: 'day',     text: '점심은 잘 드셨어요, 대표님?' },
    { id: 'g09', when: 'day',     text: '오후도 힘내세요, 대표님!' },
    { id: 'g10', when: 'evening', text: '오늘도 수고 많으셨어요, 대표님.' },
    { id: 'g11', when: 'evening', text: '편안한 저녁 되세요, 대표님.' },
    { id: 'g12', dow: 1,          text: '한 주 힘차게 시작해요, 대표님!' },
    { id: 'g13', dow: 5,          text: '한 주 정말 수고 많으셨어요, 대표님.' }
  ];

  var PREF_KEY = 'smart_k_intro';
  var LAST_KEY = 'smart_k_intro_last';
  var LINE_KEY = 'smart_k_intro_line';      // 직전에 나온 멘트 id
  var DEFAULT_PREF = 'daily';
  // (v9.4) 인사 영상이 있는 옷 6벌. 옷마다 영상 길이(3.25~4.58초)와 숙이는 박자가 다르다.
  //   cue = 그 영상에서 허리를 숙이는 것이 눈에 띄기 시작하는 때(초 — 자막이 나타나는 때). 영상마다 재서 넣은 값이다(고정값 아님).
  //         이 표는 손으로 고치지 않는다 — 영상을 넣는 스크립트(integrate_bows.py)가 재서 wardrobe.json(bow_cue)과 함께 맞춘다.
  //   길이는 적지 않는다 — 재생이 끝나는 것(ended)으로 닫고, 안전 장치(아래 capFor)도 영상의 실제 길이에서 구한다.
  var BOWS = {
    burgundy_suit:  { video: 'assets/k/burgundy_suit/bow.mp4', poster: 'assets/k/burgundy_suit/bow_poster.jpg', cue: 1.04 },
    navy_suit:      { video: 'assets/k/navy_suit/bow.mp4', poster: 'assets/k/navy_suit/bow_poster.jpg', cue: 0.88 },
    knit:           { video: 'assets/k/knit/bow.mp4', poster: 'assets/k/knit/bow_poster.jpg', cue: 1.08 },
    hanbok:         { video: 'assets/k/hanbok/bow.mp4', poster: 'assets/k/hanbok/bow_poster.jpg', cue: 0.88 },
    jeans_shirt:    { video: 'assets/k/jeans_shirt/bow.mp4', poster: 'assets/k/jeans_shirt/bow_poster.jpg', cue: 1.04 },
    sweatshirt:     { video: 'assets/k/sweatshirt/bow.mp4', poster: 'assets/k/sweatshirt/bow_poster.jpg', cue: 1.08 }
  };
  var DEFAULT_OUTFIT = 'burgundy_suit';
  var CUE_AT = 1.0;           // cue 가 없는 영상의 기본값
  var STILL_CUE = 500;        // (v9.4) 인사 영상이 없는 옷: 전신 사진을 띄우고 이만큼 뒤에 자막
  var STILL_HOLD = 2800;      //        그리고 이만큼 보여 준 뒤 닫는다
  var START_TIMEOUT = 1800;   // 이 안에 영상이 시작 안 되면 조용히 건너뜀
  var HARD_CAP = 7000;        // 영상 길이를 아직 모를 때의 안전 장치(이 시간 뒤엔 닫힘). 길이를 알게 되면 capFor(길이)로 바꾼다
  var CAP_SLACK = 2500;       // 영상이 끝나고도 이만큼 지나면(끝남 신호를 못 받은 경우) 닫는다
  function capFor(dur) { return (isFinite(dur) && dur > 0) ? Math.round(dur * 1000) + CAP_SLACK : HARD_CAP; }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 한국시간(UTC+9) — 폰 시간대 설정과 무관하게 같은 결과
  function kst(now) { return new Date((now == null ? Date.now() : +now) + 9 * 3600 * 1000); }
  function today() { var d = kst(); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }

  function pref() { var p = lsGet(PREF_KEY); return (p === 'always' || p === 'off' || p === 'daily') ? p : DEFAULT_PREF; }
  function setPref(p) { lsSet(PREF_KEY, (p === 'always' || p === 'off') ? p : null); }

  /* ---- 멘트 고르기 ---- */
  function bandOf(h) { return (h >= 4 && h < 11) ? 'morning' : (h >= 11 && h < 17) ? 'day' : 'evening'; }
  function candidates(now) {
    var d = kst(now), band = bandOf(d.getUTCHours()), dow = d.getUTCDay();
    return GREETINGS.filter(function (g) {
      if (g.dow != null) return g.dow === dow;
      return g.when === 'any' || g.when === band;
    });
  }
  function pickGreeting(now, lastId, rnd) {
    var c = candidates(now);
    if (lastId != null && c.length > 1) c = c.filter(function (g) { return g.id !== lastId; });
    if (!c.length) return GREETINGS[0];
    var r = rnd == null ? Math.random() : rnd;
    return c[Math.min(c.length - 1, Math.floor(r * c.length))];
  }

  // 움직임을 틀면 안 되는 이유(없으면 '')
  function blockReason() {
    if (lsGet('smart_k_motion') === '0') return '케이 움직임 꺼 둠';
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return '폰 「움직임 줄이기」 켜짐'; } catch (e) {}
    try { if (navigator.connection && navigator.connection.saveData) return '데이터 절약 모드'; } catch (e) {}
    return '';
  }
  // (v9.4) 입은 옷의 인사 영상이 있으면 그것. 없으면 그 옷의 전신 사진 + 자막(still) — 예전엔 버건디 영상이 대신 나와 「옷은 네이비인데 인사는 버건디」였다.
  //   옷 이름은 영문·숫자·밑줄만 받는다(저장값이 이상하면 기본 옷).
  function bowFor() {
    var o = lsGet('smart_k_outfit') || DEFAULT_OUTFIT;
    if (!/^[a-z0-9_]+$/i.test(o)) o = DEFAULT_OUTFIT;
    if (BOWS[o]) return BOWS[o];
    return { still: true, poster: 'assets/k/' + o + '/fullbody.jpg' };
  }

  var root = null, vid = null, cap = null, timers = [], active = false, forced = false, cued = false, raf = 0, line = null, cueAt = CUE_AT;
  function clearTimers() { timers.forEach(function (t) { clearTimeout(t); }); timers = []; if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'kIntro'; root.className = 'kintro';
    root.setAttribute('role', 'presentation');
    root.innerHTML = '<div class="kintro-stage"><img class="kintro-bg" alt="" draggable="false"><img class="kintro-poster" alt="" draggable="false">' +
      '<video class="kintro-vid" muted playsinline webkit-playsinline disablepictureinpicture preload="auto"></video></div>' +
      '<div class="kintro-hint">화면을 누르면 바로 시작해요</div>' +
      '<div class="kintro-cap" aria-live="polite"></div>';
    vid = root.querySelector('video');
    cap = root.querySelector('.kintro-cap');
    vid.muted = true; vid.defaultMuted = true; vid.setAttribute('muted', '');
    (document.body || document.documentElement).appendChild(root);
    // click 만 쓴다(touchstart 로 닫으면 같은 손가락의 click 이 뒤의 앱 단추를 눌러 버릴 수 있다).
    // 사라지는 0.4초 동안에도 덮개가 누름을 받아 두므로, 건너뛰는 손길이 앱 단추로 새지 않는다.
    root.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); finish('tap'); });
    vid.addEventListener('playing', function () {
      if (!active) return;
      root.classList.add('playing');
      if (!forced) lsSet(LAST_KEY, today());          // 실제로 보여 드린 날만 「오늘 인사함」
      watchCue();
    });
    vid.addEventListener('ended', function () { finish('ended'); });
    vid.addEventListener('error', function () { finish('error'); });
  }

  // 영상 시각을 매 화면마다 보고 CUE_AT 에 멘트 자막을 띄운다
  function watchCue() {
    if (raf) return;
    (function tick() {
      raf = 0;
      if (!active) return;
      if (!cued && vid.currentTime >= cueAt) {
        cued = true;
        root.classList.add('cap-on');
      }
      if (!cued) raf = requestAnimationFrame(tick);
    })();
  }

  function play(force) {
    if (active) return false;
    forced = !!force;
    var b = bowFor();
    if (!b) return false;
    build();
    active = true; cued = false;
    line = pickGreeting(null, lsGet(LINE_KEY));
    lsSet(LINE_KEY, line.id);                          // 다음엔 이 멘트를 빼고 고른다(「지금 보기」도 포함)
    cap.textContent = line.text;
    root.__line = line.id;
    root.className = 'kintro show';
    document.documentElement.classList.add('kintro-on');
    var posterEl = root.querySelector('.kintro-poster');
    posterEl.setAttribute('src', b.poster);
    root.querySelector('.kintro-bg').setAttribute('src', b.poster);
    cueAt = b.cue != null ? b.cue : CUE_AT;
    root.__mode = b.still ? 'still' : 'video';
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (active) root.classList.add('in'); }); });
    timers.push(setTimeout(function () { if (active) root.classList.add('hint-on'); }, 900));
    if (b.still) {
      // 인사 영상이 없는 옷: 그 옷 전신 사진 + 자막. 사진을 못 읽으면(서버에서 온 옷 등) 조용히 건너뛴다.
      try { vid.removeAttribute('src'); vid.removeAttribute('poster'); } catch (e) {}
      posterEl.onerror = function () { posterEl.onerror = null; finish('nophoto'); };
      if (!forced) lsSet(LAST_KEY, today());
      timers.push(setTimeout(function () { if (active) { cued = true; root.classList.add('cap-on'); } }, STILL_CUE));
      timers.push(setTimeout(function () { finish('still'); }, STILL_HOLD));
      return true;
    }
    posterEl.onerror = null;
    vid.setAttribute('poster', b.poster);
    vid.setAttribute('src', b.video);
    try { vid.currentTime = 0; } catch (e) {}
    timers.push(setTimeout(function () { if (active && !root.classList.contains('playing')) finish('slow'); }, START_TIMEOUT));
    // 안전 장치: 영상의 실제 길이를 알게 되면 그 길이 + 여유로 다시 건다(옷마다 길이가 달라 고정값을 쓰지 않는다)
    var capT = setTimeout(function () { finish('cap'); }, HARD_CAP);
    timers.push(capT);
    var onMeta = function () {
      vid.removeEventListener('loadedmetadata', onMeta);
      if (!active || root.__mode !== 'video') return;
      clearTimeout(capT);
      capT = setTimeout(function () { finish('cap'); }, capFor(vid.duration));
      timers.push(capT);
      root.__cap = capFor(vid.duration);
    };
    root.__cap = HARD_CAP;
    vid.addEventListener('loadedmetadata', onMeta);
    try {
      var p = vid.play();
      if (p && p.catch) p.catch(function () { finish('blocked'); });
    } catch (e) { finish('blocked'); }
    if (!forced && navigator.getBattery) {
      try { navigator.getBattery().then(function (bt) { if (!bt.charging && bt.level <= 0.15) finish('battery'); }).catch(function () {}); } catch (e) {}
    }
    return true;
  }

  function finish(why) {
    if (!active) return;
    active = false;
    clearTimers();
    root.__why = why;
    root.classList.add('out');                         // 0.38초 동안 스르르 사라짐 → 뒤의 앱 홈이 보임
    setTimeout(function () {
      if (active) return;
      root.className = 'kintro';
      document.documentElement.classList.remove('kintro-on');
      try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) {}
    }, 420);
  }

  // 다른 앱에서 문서가 넘어오면(네이티브 → window.__smartSharedDoc) 인사를 바로 닫는다.
  // app.js 가 나중에 이 함수를 진짜 처리기로 바꿔 끼워도 감싸지도록 속성으로 가로챈다.
  function hookDoc(name) {
    try {
      var cur = window[name];
      var wrap = function (fn) { return typeof fn !== 'function' ? fn : function () { finish('doc'); return fn.apply(this, arguments); }; };
      cur = wrap(cur);
      Object.defineProperty(window, name, { configurable: true, get: function () { return cur; }, set: function (f) { cur = wrap(f); } });
    } catch (e) {}
  }
  hookDoc('__smartSharedDoc'); hookDoc('__smartSharedDocError');
  document.addEventListener('visibilitychange', function () { if (document.hidden) finish('hidden'); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') finish('key'); });

  function shouldAuto() {
    var p = pref();
    if (p === 'off') return false;
    if (blockReason()) return false;
    if (window.__smartSharedDocQueue && window.__smartSharedDocQueue.length) return false;
    if (/[?&#]nointro\b/.test(location.href)) return false;
    if (p === 'always') return true;
    return lsGet(LAST_KEY) !== today();
  }

  window.KIntro = {
    pref: pref, setPref: setPref, blockReason: blockReason,
    greetings: function () { return GREETINGS.slice(); },
    candidates: candidates, pickGreeting: pickGreeting,   // 시험·점검용(시각을 넣으면 그 시각의 후보)
    lastShown: function () { return lsGet(LAST_KEY) || ''; },
    bows: function () { var o = {}; Object.keys(BOWS).forEach(function (k) { o[k] = { video: BOWS[k].video, poster: BOWS[k].poster, cue: BOWS[k].cue }; }); return o; },   // 시험·점검용(wardrobe.json 과 같은지 본다)
    play: function () { return play(true); },          // 「지금 보기」(설정 화면) — 오늘 인사 기록은 안 바꾼다
    skip: function () { finish('api'); },
    active: function () { return active; }
  };

  if (shouldAuto()) play(false);
})();

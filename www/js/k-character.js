/* ============================================================================
 * k-character.js — 소장 「케이」 캐릭터(얼굴·표정·움직임·옷장·목소리) v6.0 1차
 * ----------------------------------------------------------------------------
 * 데이터 기반: 옷 목록은 assets/k/wardrobe.json 한 파일만 읽는다.
 *   옷을 늘리려면 에셋 폴더(assets/k/<옷id>/)와 wardrobe.json 만 바꾸면 되고 코드는 그대로다.
 *   (에셋 생성 도구: Claude Code\apps\k-character\tools\build_app_assets.py)
 *
 * 화면 곳곳의 케이 얼굴은 <span class="kface" data-kface="head|home|profile|wardrobe"> 자리표시.
 *   KChar.mount() 가 안에 [정지 사진 <img>] + [반복 영상 <video muted loop playsinline>] 을 채운다.
 *   - 평소: idle 반복영상(실패·저전력·움직임 끔 → 정지 사진)
 *   - 케이 목소리 재생 중: talk 영상(없으면 사진이 살짝 움직이는 CSS)
 *   - 새 답장 도착: 그 답의 표정 사진을 잠깐(약 7초) 보여 준 뒤 idle 로 복귀
 *
 * ⭐ 표정 규칙은 아래 EXPR_RULES 한 곳에만 있다(위에서부터 먼저 걸리는 것 적용). 고칠 땐 여기만.
 * ==========================================================================*/
(function () {
  'use strict';

  /* ---------------- 표정 규칙(여기만 고치면 됨) ---------------- */
  // 띄어쓰기는 무시하고 비교한다("진행중"=“진행 중”). 위에서부터 첫 번째로 걸린 표정을 쓴다.
  var EXPR_RULES = [
    { expr: 'cheer',    words: ['완료', '끝났', '축하'] },
    { expr: 'concern',  words: ['문제', '실패', '오류', '죄송'] },
    { expr: 'thinking', words: ['진행 중', '작업 중', '확인 중', '맡겼'] },
    { expr: 'smile',    words: ['좋은', '됐습니다', '반갑'] }
  ];
  var DEFAULT_EXPR = 'neutral';
  function exprFor(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (!t) return DEFAULT_EXPR;
    for (var i = 0; i < EXPR_RULES.length; i++) {
      var r = EXPR_RULES[i];
      for (var j = 0; j < r.words.length; j++) {
        if (t.indexOf(r.words[j].replace(/\s+/g, '')) !== -1) return r.expr;
      }
    }
    return DEFAULT_EXPR;
  }

  /* ---------------- 옷장 데이터 ---------------- */
  var BASE = 'assets/k/';
  var OUTFIT_KEY = 'smart_k_outfit';
  var MOTION_KEY = 'smart_k_motion';     // '0' = 움직임 끔(정지 사진만)
  var VOICE_KEY = 'smart_k_voice';       // '' = 케이 기본 목소리(PC 생성 · 선희) / 그 외 = 기기 음성 이름
  // wardrobe.json 을 못 읽어도(오프라인·오류) 앱이 깨지지 않게 최소 기본값
  var FALLBACK = { version: 1, default: 'burgundy_suit', outfits: [{ id: 'burgundy_suit', name: '버건디 정장',
    expr: { neutral: 'expr_neutral.jpg' }, avatar: { neutral: 'av_neutral.jpg' }, thumb: 'thumb.jpg', idle: 'idle.mp4', talk: 'talk.mp4' }] };
  var data = FALLBACK, curId = '', listeners = [];
  var lastExpr = DEFAULT_EXPR, flashTimer = null, flashing = '', talking = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  function normOutfit(o) {
    // wardrobe.json 이 '원본 규격'(base.png·avatar.png·expr_*_1024.png·loop_*_small.mp4)이어도 읽히게 기본 파일명을 채운다
    if (!o || !o.id) return null;
    var n = { id: String(o.id), name: o.name || o.label || o.id, desc: o.desc || '', expr: {}, avatar: {} };
    var ex = o.expr || o.expressions || null;
    if (ex && !Array.isArray(ex)) n.expr = ex;
    else {
      var keys = Array.isArray(ex) ? ex : ['neutral'];
      keys.forEach(function (e) { n.expr[e] = 'expr_' + e + '_1024.png'; });
      if (!n.expr.neutral) n.expr.neutral = o.base || 'base.png';
    }
    n.avatar = o.avatar && typeof o.avatar === 'object' ? o.avatar : {};
    if (typeof o.avatar === 'string') n.avatar = { neutral: o.avatar };
    if (!n.avatar.neutral && !(o.expr && !Array.isArray(o.expr))) n.avatar.neutral = 'avatar.png';
    n.thumb = o.thumb || (o.expr && !Array.isArray(o.expr) ? n.expr.neutral : 'thumb.png');
    n.idle = o.idle === undefined ? (o.expr && !Array.isArray(o.expr) ? '' : 'loop_idle_small.mp4') : (o.idle || '');
    n.talk = o.talk === undefined ? (o.expr && !Array.isArray(o.expr) ? '' : 'loop_talk_small.mp4') : (o.talk || '');
    return n;
  }
  function setData(d) {
    var arr = Array.isArray(d) ? d : (d && d.outfits) || [];
    var outs = arr.map(normOutfit).filter(Boolean);
    if (!outs.length) return;
    data = { default: (d && d.default) || outs[0].id, outfits: outs };
    var saved = lsGet(OUTFIT_KEY);
    curId = findOutfit(saved) ? saved : (findOutfit(data.default) ? data.default : outs[0].id);
  }
  function findOutfit(id) { for (var i = 0; i < data.outfits.length; i++) if (data.outfits[i].id === id) return data.outfits[i]; return null; }
  function outfit() { return findOutfit(curId) || data.outfits[0]; }
  function url(o, file) { return file ? BASE + encodeURIComponent(o.id) + '/' + file : ''; }
  function exprUrl(e, o) { o = o || outfit(); return url(o, o.expr[e] || o.expr.neutral); }
  // 작은 원형 얼굴용: 얼굴 쪽으로 자른 사진(av_*). 없으면 전체 사진(CSS 로 확대)
  function avatarUrl(e, o) {
    o = o || outfit();
    var f = o.avatar[e] || o.avatar.neutral;
    return f ? url(o, f) : exprUrl(e, o);
  }
  function hasCrop(o, e) { o = o || outfit(); return !!(o.avatar[e] || o.avatar.neutral); }
  function thumbUrl(o) { o = o || outfit(); return url(o, o.thumb || o.expr.neutral); }

  var ready = fetch(BASE + 'wardrobe.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) { setData(d); })
    .catch(function (e) { console.warn('[케이] wardrobe.json 읽기 실패 — 기본 옷으로:', e); setData(FALLBACK); })
    .then(function () { refreshAll(); notify(); });

  function setOutfit(id) {
    if (!findOutfit(id) || id === curId) return false;
    curId = id; lsSet(OUTFIT_KEY, id);
    refreshAll(true); notify();
    return true;
  }
  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { try { fn(outfit()); } catch (e) {} }); }

  /* ---------------- 움직임(저전력·실패 시 정지 사진) ---------------- */
  var lowPower = false;
  try {
    if (navigator.connection && navigator.connection.saveData) lowPower = true;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) lowPower = true;
    if (navigator.getBattery) navigator.getBattery().then(function (b) {
      function chk() { var lp = (!b.charging && b.level <= 0.15); if (lp !== batLow) { batLow = lp; refreshAll(); } }
      chk(); b.addEventListener('levelchange', chk); b.addEventListener('chargingchange', chk);
    }).catch(function () {});
  } catch (e) {}
  var batLow = false;
  function motionPref() { return lsGet(MOTION_KEY) !== '0'; }
  function setMotionPref(on) { lsSet(MOTION_KEY, on ? null : '0'); refreshAll(); }
  function motionOn() { return motionPref() && !lowPower && !batLow; }
  function motionBlockReason() {
    if (!motionPref()) return '움직임 꺼 둠';
    if (lowPower) return '절전·데이터 절약 모드';
    if (batLow) return '배터리 부족(15% 이하)';
    return '';
  }

  /* ---------------- 얼굴 자리표시 채우기 ---------------- */
  var io = null;
  try {
    io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { en.target._kVisible = en.isIntersecting; syncVideo(en.target); });
    });
  } catch (e) { io = null; }

  function build(el) {
    if (el._kBuilt) return;
    el._kBuilt = true;
    var img = document.createElement('img');
    img.className = 'kf-img'; img.alt = '케이'; img.decoding = 'async'; img.draggable = false;
    var vid = document.createElement('video');
    vid.className = 'kf-vid'; vid.muted = true; vid.defaultMuted = true; vid.loop = true;
    vid.setAttribute('muted', ''); vid.setAttribute('playsinline', ''); vid.setAttribute('webkit-playsinline', '');
    vid.setAttribute('disablepictureinpicture', ''); vid.preload = 'auto';
    vid.addEventListener('playing', function () { el.classList.add('vid-on'); });
    vid.addEventListener('error', function () { markFail(el, vid.getAttribute('data-kind')); });
    el.appendChild(img); el.appendChild(vid);
    el._kVisible = true;
    if (io) io.observe(el);
  }
  function markFail(el, kind) {
    el._kFail = el._kFail || {};
    if (kind) el._kFail[kind + '|' + curId] = true;
    el.classList.remove('vid-on');
    syncVideo(el);
  }
  function wideFace(el) { return el.getAttribute('data-kface') === 'profile' || el.getAttribute('data-kface') === 'wardrobe'; }
  function paint(el) {
    build(el);
    var o = outfit(), e = flashing || lastExpr;
    if (wideFace(el)) e = flashing || DEFAULT_EXPR;
    var img = el.querySelector('.kf-img'), vid = el.querySelector('.kf-vid');
    var src = wideFace(el) ? exprUrl(e) : avatarUrl(e);
    el.classList.toggle('kf-crop', !wideFace(el) && !hasCrop(o, e));   // 잘린 얼굴사진이 없으면 전체사진을 CSS로 확대
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    var poster = exprUrl(DEFAULT_EXPR);
    if (vid.getAttribute('poster') !== poster) vid.setAttribute('poster', poster);
    syncVideo(el);
  }
  function syncVideo(el) {
    var vid = el.querySelector && el.querySelector('.kf-vid'); if (!vid) return;
    var o = outfit();
    var kind = talking ? 'talk' : 'idle';
    var file = o[kind];
    if (talking && !file) { kind = 'idle'; file = o.idle; }         // talk 영상 없는 옷 → idle + CSS 입 모양 효과
    el.classList.toggle('kf-talk', talking);
    el.classList.toggle('kf-talkstill', talking && !o.talk);
    var failed = el._kFail && el._kFail[kind + '|' + curId];
    var want = !!file && !failed && motionOn() && !flashing && el._kVisible !== false && !document.hidden;
    if (!want) {
      el.classList.remove('vid-on');
      if (!vid.paused) try { vid.pause(); } catch (e) {}
      return;
    }
    var src = url(o, file);
    if (vid.getAttribute('src') !== src) {
      el.classList.remove('vid-on');
      vid.setAttribute('data-kind', kind);
      vid.setAttribute('src', src);
      try { vid.load(); } catch (e) {}
    }
    if (vid.paused) {
      var p; try { p = vid.play(); } catch (e) { markFail(el, kind); return; }
      if (p && p.catch) p.catch(function (err) {
        // 자동재생 거부(제스처 필요 등)면 정지 사진 유지. 네트워크 오류는 error 이벤트에서 처리.
        if (err && err.name === 'NotAllowedError') el.classList.remove('vid-on');
      });
    } else if (vid.readyState >= 2) el.classList.add('vid-on');
  }
  function faces() { return Array.prototype.slice.call(document.querySelectorAll('.kface[data-kface]')); }
  function refreshAll(outfitChanged) {
    faces().forEach(function (el) {
      if (outfitChanged) { el._kFail = null; }
      paint(el);
    });
    if (outfitChanged) {                        // 채팅 말풍선 아바타도 새 옷으로
      Array.prototype.forEach.call(document.querySelectorAll('img.kav[data-kexpr]'), function (im) {
        im.setAttribute('src', avatarUrl(im.getAttribute('data-kexpr')));
      });
    }
  }
  document.addEventListener('visibilitychange', function () { faces().forEach(syncVideo); });

  /* ---------------- 표정·말하기 상태 ---------------- */
  // 마지막 케이 답의 표정. flash=true 면 새 답장 → 표정 사진을 잠깐 보여 준 뒤 idle 영상으로 복귀.
  function setExpr(e, flash) {
    e = e || DEFAULT_EXPR;
    lastExpr = e;
    if (flash && e !== DEFAULT_EXPR && !talking) {
      flashing = e;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(function () { flashing = ''; flashTimer = null; faces().forEach(paint); }, 7000);
    }
    faces().forEach(paint);
  }
  function setTalking(on) {
    on = !!on;
    if (on === talking) return;
    talking = on;
    if (on && flashing) { flashing = ''; if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; } }
    faces().forEach(paint);
  }

  /* ---------------- 목소리(무료) ----------------
   * 기본 = 「케이 기본 목소리」: PC(chat_responder)가 무료 edge-tts 한국어 여성 뉴럴(ko-KR-SunHiNeural)로 mp3 생성.
   * 선택 = 이 기기에 깔린 한국어 음성(브라우저/OS 내장 · 무료). 한국어 여성 음성을 목록 맨 위에 올린다.
   *   ⚠️ 안드로이드 앱(WebView)은 기기 음성(speechSynthesis)을 지원하지 않는 경우가 많다 → 그때는 기본만 보인다. */
  var synth = null; try { synth = window.speechSynthesis || null; } catch (e) { synth = null; }
  var FEMALE_HINTS = /(female|woman|여성|여자|sunhi|sun-hi|seoyeon|yuna|heami|jimin|seohyeon|soonbok|yujin|google 한국의|ko-kr-standard-a|ko-kr-wavenet-a)/i;
  var MALE_HINTS = /(male|man|남성|남자|injoon|hyunsu|bongjin|gookmin)/i;
  function deviceVoices() {
    if (!synth || !synth.getVoices) return [];
    var vs = [];
    try { vs = synth.getVoices() || []; } catch (e) { vs = []; }
    vs = vs.filter(function (v) { return /^ko/i.test(v.lang || '') || /korean|한국/i.test(v.name || ''); });
    function score(v) {
      var n = v.name || '', s = 0;
      if (FEMALE_HINTS.test(n) && !/\bmale\b/i.test(n.replace(/female/ig, ''))) s -= 2;
      if (MALE_HINTS.test(n.replace(/female/ig, '').replace(/woman/ig, ''))) s += 2;
      if (v.localService) s -= 0.5;
      return s;
    }
    return vs.slice().sort(function (a, b) { return score(a) - score(b); });
  }
  function voicePref() { return lsGet(VOICE_KEY) || ''; }
  function setVoicePref(name) { lsSet(VOICE_KEY, name || null); }
  function deviceVoiceByName(name) {
    if (!name) return null;
    var vs = deviceVoices();
    for (var i = 0; i < vs.length; i++) if (vs[i].name === name) return vs[i];
    return null;
  }
  // 기기 음성을 쓸 수 있으면 그 음성 객체, 아니면 null(→ 케이 기본 목소리로)
  function activeDeviceVoice() { return deviceVoiceByName(voicePref()); }
  var curUtter = null;
  function speakDevice(text, voice, cb) {
    cb = cb || {};
    if (!synth || !voice) { if (cb.onerror) cb.onerror(); return false; }
    try {
      synth.cancel();
      var u = new SpeechSynthesisUtterance(String(text || '').replace(/\*\*/g, '').slice(0, 1500));
      u.voice = voice; u.lang = voice.lang || 'ko-KR'; u.rate = 1.0; u.pitch = 1.0;
      u.onstart = function () { setTalking(true); if (cb.onstart) cb.onstart(); };
      u.onend = function () { if (curUtter === u) curUtter = null; setTalking(false); if (cb.onend) cb.onend(); };
      u.onerror = function () { if (curUtter === u) curUtter = null; setTalking(false); if (cb.onerror) cb.onerror(); };
      curUtter = u;
      synth.speak(u);
      return true;
    } catch (e) { setTalking(false); if (cb.onerror) cb.onerror(); return false; }
  }
  function stopDevice() { try { if (synth) synth.cancel(); } catch (e) {} curUtter = null; setTalking(false); }
  function deviceSpeaking() { return !!curUtter; }
  if (synth && synth.addEventListener) { try { synth.addEventListener('voiceschanged', function () { notifyVoices(); }); } catch (e) {} }
  var voiceListeners = [];
  function onVoices(fn) { voiceListeners.push(fn); }
  function notifyVoices() { voiceListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  window.KChar = {
    ready: ready,
    exprFor: exprFor, rules: EXPR_RULES,
    outfit: outfit, outfits: function () { return data.outfits.slice(); }, setOutfit: setOutfit, onChange: onChange,
    avatarUrl: avatarUrl, exprUrl: exprUrl, thumbUrl: thumbUrl,
    mount: function () { faces().forEach(paint); },
    setExpr: setExpr, lastExpr: function () { return lastExpr; },
    setTalking: setTalking, isTalking: function () { return talking; },
    motionOn: motionOn, motionPref: motionPref, setMotionPref: setMotionPref, motionBlockReason: motionBlockReason,
    voice: {
      supported: function () { return !!(synth && window.SpeechSynthesisUtterance); },
      list: deviceVoices, pref: voicePref, setPref: setVoicePref, active: activeDeviceVoice,
      speak: speakDevice, stop: stopDevice, speaking: deviceSpeaking, onVoices: onVoices,
      isFemaleGuess: function (v) { return !!(v && FEMALE_HINTS.test(v.name || '')); }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.KChar.mount(); });
  else window.KChar.mount();
})();

/* ============================================================================
 * k-call.js — 음성 대화 전체 화면의 케이 (v9.6)
 * ----------------------------------------------------------------------------
 * 음성 대화를 켜면 케이가 화면 전체에 「허리 위 상반신」으로 나온다(영상 통화처럼). 이 파일은 그 화면의 케이 모습만 맡는다
 * — 화면 배치는 styles.css(#chatView.convo-full), 상태·자막·펼치기는 app.js 가 맡는다.
 *
 * 무엇을 보이나 (위에서부터 있는 것을 쓴다 — 상반신이 보이는 쪽이 먼저):
 *   ① 그 옷의 세로 영상(720×1280 · 소리 없음): 듣는 모습 listen · 생각하는 모습 think · 말하는 모습 talk(여러 개면 번갈아 · 하나면 그것을 되풀이)
 *      (지금 만드는 영상 = 기준 얼굴 영상의 머리 + 그 옷 그림의 몸 → 몸은 움직이지 않는다. 생각하는 모습은 따로 없어 듣는 모습을 쓴다.)
 *   ② 그 옷의 허리 위 자세 그림(배경 없는 그림): 듣는 중 = 받아 적기 · 생각 중 = 기록판 · 말하는 중 = 안내 손짓
 *   ③ 그 옷 전신 사진의 위쪽 절반
 *   ④ 그 옷의 얼굴 사진(1080) — 마지막 대체
 *   세로 영상이 일부만 있으면 있는 것만 쓴다: think 가 없으면 listen, talk 가 없으면 listen, listen 도 없으면 포스터(정지 사진).
 * 이음매: 영상 요소 두 개를 번갈아 쓰며 0.28초 겹쳐 넘긴다(반복 지점 · 클립 사이 · 상태 전환 모두). 겹치는 0.28초만 두 영상이 함께 돈다.
 * 숨쉬기: 영상이든 정지 그림이든 케이 전체(.kcall-in)가 아주 약하게 숨 쉬듯 움직인다(styles.css kcallBreath — 3.4초 · 1.4% · 축은 얼굴 가운데라 얼굴은 제자리).
 * 영상이 없어 정지 그림(②③④·포스터)이 보일 때: 말하는 중에는 그 그림이 가볍게 끄덕인다(kcallTalk).
 * 움직임 끔 · 절전 · 폰 「움직임 줄이기」: 영상은 틀지 않고 포스터(없으면 ②③④)만 보인다(숨쉬기·끄덕임도 쉰다).
 * 영상은 화면에 보일 때만 돈다(음성 대화가 꺼지거나 앱이 뒤로 가면 멈춘다 — stop()).
 * ==========================================================================*/
(function () {
  'use strict';
  var FADE = 280;                    // 겹쳐 넘기는 시간(ms)
  var POSE = { listen: 'note', think: 'clip', talk: 'guide', idle: 'guide' };   // ② 상태별 허리 위 자세 그림
  var host = null, vids = [], cur = -1, state = 'idle', on = false, lastTalk = '', loopT = null, token = 0, shownKind = '';
  function $(id) { return document.getElementById(id); }
  function calm() { try { return !window.KChar || !KChar.motionOn() || !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return true; } }
  function build() {
    host = $('kCall'); if (!host || host._built) return !!host;
    host._built = true;
    vids = Array.prototype.slice.call(host.querySelectorAll('video'));
    vids.forEach(function (v) { v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.preload = 'auto'; });
    return true;
  }
  // 그 상태에 틀 세로 영상(없으면 '')
  function clipFor(st, set) {
    if (!set) return '';
    if (st === 'talk' && set.talk && set.talk.length) {
      var pool = set.talk.length > 1 ? set.talk.filter(function (u) { return u !== lastTalk; }) : set.talk;
      var u = pool[Math.floor(Math.random() * pool.length)]; lastTalk = u; return u;
    }
    if (st === 'think' && set.think) return set.think;
    return set.listen || '';
  }
  function showStill(kind, src, pose) {
    var im = host.querySelector('.kcall-still'); if (!im) return;
    if (src && im.getAttribute('src') !== src) {
      im.setAttribute('src', src);
      if (!calm() && shownKind === kind) { im.classList.remove('swap'); void im.offsetWidth; im.classList.add('swap'); }
    }
    host.setAttribute('data-kind', kind); host.setAttribute('data-pose', pose || '');
    shownKind = kind;
  }
  // 정지 그림 고르기: 포스터 → 허리 위 자세 그림 → 전신 위쪽 절반 → 얼굴 사진
  function paintStill(st, set) {
    var K = window.KChar; if (!K) return;
    if (set && set.poster) { showStill('poster', set.poster); return; }
    var p = K.poseUrl ? K.poseUrl(POSE[st] || 'guide') : '';
    if (p) { showStill('pose', p, POSE[st] || 'guide'); return; }
    var fb = K.fullbodyUrl ? K.fullbodyUrl() : '';
    if (fb) { showStill('full', fb); return; }
    showStill('face', K.exprUrl('smile', null, false, true));
  }
  function clearLoop() { if (loopT) { clearTimeout(loopT); loopT = null; } }
  // 영상 하나를 겹쳐 넘기며 튼다. 끝나기 0.28초 전에 다음 것(같은 상태의 반복 또는 다른 말하는 클립)을 미리 걸어 이음매를 가린다.
  function playClip(url, my) {
    var next = (cur + 1) % vids.length, v = vids[next], old = cur >= 0 ? vids[cur] : null;
    v.loop = false;
    if (v.getAttribute('src') !== url) { v.setAttribute('src', url); try { v.load(); } catch (e) {} }
    try { v.currentTime = 0; } catch (e) {}
    var started = false;
    function go() {
      if (started || my !== token) return; started = true;
      v.classList.add('on'); host.classList.add('vid');
      if (old && old !== v) { old.classList.remove('on'); setTimeout(function () { if (my === token || !old.classList.contains('on')) { try { old.pause(); } catch (e) {} } }, FADE + 60); }
      cur = next;
      clearLoop();
      var left = (isFinite(v.duration) && v.duration > 0) ? (v.duration - v.currentTime) * 1000 - FADE : 3000;
      loopT = setTimeout(function () { if (my === token && on) startState(state, true); }, Math.max(400, left));
    }
    v.addEventListener('playing', function h() { v.removeEventListener('playing', h); go(); });
    v.addEventListener('error', function h2() { v.removeEventListener('error', h2); if (my === token) { host.classList.remove('vid'); host._fail = (host._fail || 0) + 1; } });
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () { if (my === token) host.classList.remove('vid'); }); } catch (e) {}
  }
  function stopVideos() {
    clearLoop();
    vids.forEach(function (v) { v.classList.remove('on'); try { v.pause(); } catch (e) {} });
    if (host) host.classList.remove('vid');
    cur = -1;
  }
  function startState(st, isLoop) {
    if (!build()) return;
    var K = window.KChar, set = (K && K.callSet) ? K.callSet() : null;
    paintStill(st, set);                                   // 영상 밑에는 늘 정지 그림(영상을 못 틀면 그대로 보인다)
    var my = ++token;
    var url = calm() || (host._fail || 0) >= 3 ? '' : clipFor(st, set);
    host.setAttribute('data-state', st);
    host.classList.toggle('calm', calm());                 // 움직임 끔 · 절전 · 「움직임 줄이기」: 숨쉬기·끄덕임(styles.css kcallBreath·kcallTalk)도 쉰다
    if (!url) { stopVideos(); return; }
    // 같은 상태의 같은 영상을 다시 거는 것(반복)도 다른 요소로 겹쳐 넘긴다
    playClip(url, my);
  }
  // app.js 가 부른다: 상태가 바뀔 때마다(듣는 중 listen · 답하는 중 think · 말하는 중 talk · 그 밖 idle)
  function sync(st) {
    st = st || 'idle';
    if (!on) { state = st; return; }
    if (st === state && cur >= 0) return;                  // 같은 상태 — 지금 도는 것을 그대로
    var prev = state; state = st;
    // 생각하는 모습이 따로 없는 옷(듣는 모습을 같이 쓴다): 듣는 중 ↔ 답하는 중 사이에는 지금 도는 듣는 영상을 끊지 않고 그대로 둔다(처음부터 다시 틀지 않는다)
    if (cur >= 0 && st !== 'talk' && prev !== 'talk' && host && host.classList.contains('vid')) {
      var K = window.KChar, set = (K && K.callSet) ? K.callSet() : null;
      if (set && !set.think && set.listen && vids[cur].getAttribute('src') === set.listen && !calm()) { host.setAttribute('data-state', st); return; }
    }
    startState(st, false);
  }
  function start(st) { on = true; state = st || state || 'idle'; if (host) host._fail = 0; startState(state, false); }
  function stop() { on = false; token++; stopVideos(); }
  // 옷·머리를 바꿨거나 서버 자산을 다 받았을 때: 지금 상태를 새 자산으로 다시
  function refresh() { if (on) startState(state, false); }
  if (window.KChar) { try { KChar.onChange(refresh); } catch (e) {} }
  document.addEventListener('visibilitychange', function () { if (!on) return; if (document.hidden) stopVideos(); else startState(state, false); });
  window.KCall = { start: start, stop: stop, sync: sync, refresh: refresh, active: function () { return on; },
                   kind: function () { return host ? (host.classList.contains('vid') ? 'video' : host.getAttribute('data-kind')) : ''; } };
})();

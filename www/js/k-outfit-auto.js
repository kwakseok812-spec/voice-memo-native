/* ============================================================================
 * k-outfit-auto.js — 케이 옷 매일 자동 바꾸기 (O-0616 건 1) · 날짜 계산 + 시작 전 준비
 * ----------------------------------------------------------------------------
 * 이 파일은 두 가지만 한다.
 *  ① 순수 계산(화면·통신 없음 — 노드에서도 그대로 시험): 오늘이 며칠째인지(한국시간 새벽 4시 기준), 그날 입을 옷.
 *     · 모든 기기가 같은 코드·같은 목록(IDS)·같은 씨앗이라 폰과 PC판이 같은 옷을 낸다.
 *     · 20벌이 한 바퀴. 한 바퀴 안에서는 매일 다른 옷(섞어 놓은 순서대로), 바퀴가 바뀌는 날에도 어제 옷은 안 나온다.
 *  ② 시작 전 준비(early): k-intro.js(시작 인사)보다 먼저 불려, 「오늘 옷」을 이 기기가 이미 입어 본 적이 있으면(인사 계획이 저장돼 있으면)
 *     저장된 옷·인사 계획을 오늘 옷으로 미리 바꿔 둔다 → 시작 인사가 처음부터 오늘 옷으로 나온다. 못 하면 아무것도 건드리지 않는다
 *     (그때는 app.js 가 시작 인사가 끝난 뒤 갈아입힌다 — 시작을 늦추지 않는다).
 * 스위치(이 파일 안): AUTO_EARLY true|false — false 면 ② 를 건너뛴다(① 은 그대로).
 * 서버에 두는 「스위치 값」은 app.js 가 다룬다(동기화). 이 파일은 그 값의 기기 사본(KEY_ON·KEY_SINCE)만 읽는다.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KOutfitAuto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIST_VER = 1;                 // 옷 목록이 늘거나 빠질 때 올린다(그날부터 새 바퀴 순서). 옷 목록(서버 20벌)과 같은 순서로 적는다.
  var IDS = [
    'burgundy_suit', 'navy_suit', 'bow_blouse', 'champagne_satin_blouse', 'floral_dress', 'black_dress', 'offshoulder',
    'red_evening', 'silver_halter', 'emerald_one_shoulder', 'purple_velvet', 'rosegold_sequin', 'sapphire_mandarin',
    'white_bodycon', 'navy_wrap', 'camel_knit_bodycon', 'black_mini', 'cobalt_tube', 'champagne_slit_gown', 'white_vneck_gown'
  ];
  var DAY = 86400000;
  var SHIFT = 5 * 3600000;          // 한국시간(+9시간)에서 새벽 4시를 하루의 시작으로(−4시간) = 세계시 기준 +5시간. 기기 시차 설정과 무관
  var AUTO_EARLY = true;
  var KEY_ON = 'smart_k_auto_outfit';     // '1' = 켜짐 (서버 값의 기기 사본)
  var KEY_SINCE = 'smart_k_auto_since';   // 스위치를 켠 날의 날짜 번호 — 그 날 다음 날부터 자동(켠 날은 그대로)
  var KEY_DAY = 'smart_k_auto_day';       // 이미 오늘 옷으로 맞춘 날짜 번호
  var KEY_PICK = 'smart_k_user_pick_at';  // 이 기기에서 마지막으로 직접 옷을 고른 때(ms)
  var KEY_OUTFIT = 'smart_k_outfit', KEY_PLAN = 'smart_k_intro_plan', KEY_PLANS = 'smart_k_intro_plans', KEY_EARLY = 'smart_k_auto_early';
  var DEFAULT_OUTFIT = 'burgundy_suit';

  function dayNum(ms) { return Math.floor((ms + SHIFT) / DAY); }
  function dayStart(d) { return d * DAY - SHIFT; }          // 그 날짜 번호가 시작되는 때(ms) = 한국시간 새벽 4시
  function hash(n) {                                          // 정수 하나를 잘 섞인 32비트로
    var x = (n ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  function rng(seed) {                                        // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rawPerm(c) {                                       // 바퀴 c 의 섞은 순서(바퀴 경계 보정 전)
    var p = IDS.slice(), r = rng(hash(c * 1000 + LIST_VER));
    for (var i = p.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }
  function perm(c) {                                          // 앞 바퀴의 마지막 옷이 이번 바퀴 첫 옷이면 첫째·둘째 칸을 바꿔 「어제와 같은 옷」을 막는다
    var p = rawPerm(c), prevLast = rawPerm(c - 1)[IDS.length - 1];
    if (p[0] === prevLast) { var t = p[0]; p[0] = p[1]; p[1] = t; }
    return p;
  }
  function outfitFor(d) {
    var n = IDS.length, c = Math.floor(d / n), i = d - c * n;
    return perm(c)[i];
  }

  // ---- ② 시작 전 준비 ----
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function onFor(d) {                                         // 기기 사본 기준: 스위치가 켜져 있고 켠 날 다음 날부터인가
    if (ls(KEY_ON) !== '1') return false;
    var s = parseInt(ls(KEY_SINCE) || '', 10);
    return !isNaN(s) && d > s;
  }
  function early(nowMs) {
    if (!AUTO_EARLY) return null;
    try {
      var now = nowMs == null ? Date.now() : nowMs, d = dayNum(now);
      if (!onFor(d)) return null;
      if (ls(KEY_DAY) === String(d)) return null;                           // 오늘은 이미 맞췄다
      var pick = parseInt(ls(KEY_PICK) || '0', 10) || 0;
      if (pick >= dayStart(d)) return null;                                 // 오늘 직접 고르셨다 → 그대로
      var tg = outfitFor(d), cur = ls(KEY_OUTFIT) || DEFAULT_OUTFIT;
      if (cur === tg) return null;
      var plans = null; try { plans = JSON.parse(ls(KEY_PLANS) || 'null'); } catch (e) { plans = null; }
      var p = plans && plans[tg];
      if (!p || p.outfit !== tg) return null;                               // 이 기기가 입어 본 적 없는 옷 → app.js 가 인사 뒤에 갈아입힌다
      lsSet(KEY_OUTFIT, tg);
      lsSet(KEY_PLAN, JSON.stringify(p));
      lsSet(KEY_EARLY, JSON.stringify({ id: tg, d: d }));
      return tg;
    } catch (e) { return null; }
  }

  var api = {
    LIST_VER: LIST_VER, IDS: IDS.slice(), DAY: DAY, SHIFT: SHIFT,
    dayNum: dayNum, dayStart: dayStart, outfitFor: outfitFor, perm: perm,
    early: early, onFor: onFor,
    K: { ON: KEY_ON, SINCE: KEY_SINCE, DAY: KEY_DAY, PICK: KEY_PICK, EARLY: KEY_EARLY, PLANS: KEY_PLANS }
  };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') { try { api.earlyResult = early(); } catch (e) {} }
  return api;
});

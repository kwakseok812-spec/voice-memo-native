/* ============================================================================
 * health.js — 건강 탭 (당뇨 관리 자가기록)  [덜 귀찮게가 최우선]
 * ----------------------------------------------------------------------------
 * - 오늘 기록: 공복혈당·체중·수면(스텝퍼+숫자) / 당뇨약(아침·저녁)·영양제(원탭 토글) /
 *              식단(프리셋 칩+직접입력)·간식(선택). 한 항목 바꿀 때마다 자동 저장.
 * - 기록 보기: 날짜별 리스트 + 공복혈당·체중 추세 그래프(순수 SVG, 외부 라이브러리 X).
 *              날짜 줄을 누르면 같은 입력 화면이 「그날 것」으로 열려 고칠 수 있다(최근 30일).
 * - 저장: Supabase public.health_logs 에 날짜(log_date) 기준 upsert.
 *         v7.5(O-0130 건강기록 잠그기): 표 직접 접근(anon 정책)을 없애고 연동 암호 게이트 RPC 로만 읽고 쓴다
 *         — health_list(p_from,p_to,p_pass) / health_upsert(p_row,p_pass). 암호가 없거나 틀리면 연동 암호 창을 띄운다.
 *         공개(publishable) 키만으로는 더 이상 건강기록을 읽거나 고칠 수 없다.
 * - 옛 텔레그램 건강 문진(건강일지.md)과는 완전히 별개 경로. 서로 건드리지 않는다.
 *
 * v9.4(O-0344) 에서 바뀐 것
 *   ① ＋/− 시작값 = 그 칸의 가장 최근 기록값(없으면 예전 고정값). 단추를 누르기 전에는 아무것도 기록하지 않는다.
 *   ② 지난 날짜 고치기(기록 보기의 날짜 줄 → 같은 입력 화면, 맨 위에 「○월 ○일 기록을 고치는 중」).
 *   ③ 순서: 숫자 → 약·영양제 → 식단. 이미 적은 끼니는 한 줄로 접는다(누르면 펼쳐 고침).
 *   ④ 저장 실패 처리: 「이 기기에서 고쳤는데 아직 서버에 안 올라간 칸」을 칸 단위로 폰에 표시해 두고(_dirty),
 *      연결이 돌아오면(online·앱 복귀·짧은 간격 재시도) 자동으로 다시 올린다.
 *      서버 함수 health_upsert 는 그날 행을 「통째로」 덮어쓴다 → 올리기 직전에 서버의 그날 행을 다시 읽어
 *      「내가 고친 칸만 내 값, 나머지 칸은 서버 값」으로 합쳐서 올린다(다른 기기가 고친 칸을 옛 값으로 덮지 않게).
 *      같은 칸을 두 기기가 다르게 고쳤으면 더 나중에 고친 쪽이 남는다(내 칸의 고친 시각 vs 서버 행의 updated_at).
 *   ⑤ 진행 표시는 간식을 뺀 9칸 기준(건강 알림 health_reminder.py · 케이의 「안 적은 칸」과 같은 9칸). 간식은 「선택」.
 *
 * v9.5.1(O-0386) 끼니 「안 먹음」
 *   아침·점심·저녁 칸의 칩 줄 맨 앞에 「안 먹음」이 있다. 누르면 그 끼니 글 칸에 「안 먹음」 글자가 그대로 저장된다(서버 표는 그대로 — 새 칸 없음).
 *   「안 먹음」은 「적은 칸」이다: 9칸 세기 · 적은 끼니 접기 · 9칸 완성 반응 · 건강 알림(PC) 모두 적은 것으로 본다. 다시 누르면 풀린다(누르기 전 모습으로 — 비어 있던 끼니는 빈 칸, 같은 화면에서 식단을 「안 먹음」으로 바꿨던 끼니는 그 식단).
 *   음식을 고르거나 적으면 「안 먹음」은 저절로 풀린다(한 칸에 둘이 같이 남지 않는다). 간식은 예전 그대로(「없음」 칩).
 *   판정(isSkip): 칸 전체가(띄어쓰기 무시) SKIP_WORDS 중 하나일 때만 — PC 쪽 health_read.py 의 SKIP_WORDS 와 같은 목록(한쪽만 고치지 말 것).
 *
 * app.js 연결: window 이벤트/버튼으로 화면을 열면 HealthTab.open() 이 렌더한다.
 *   HealthTab.init({toast}) 로 토스트만 주입받는다(결합 최소화). HealthTab.flush() = 밀린 칸 다시 올리기.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function cfg() { return (global.OfficeBridge && OfficeBridge.CONFIG) || null; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var _toast = function () {};

  /* ---------- 날짜 — 「오늘」은 한국 시간(KST, UTC+9) 기준 ----------
   * v9.3 까지는 기기 시간대의 날짜였다(한국에서는 같은 값). 건강 알림·케이(PC, 한국 시간)와 같은 날짜가 되도록
   * 기기 시간대가 달라도 한국 날짜로 센다. DAY_TZ_MIN 을 null 로 두면 예전처럼 기기 시간대를 따른다. */
  var DAY_TZ_MIN = 540;
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function tzMs(ms) { return (DAY_TZ_MIN === null ? -new Date(ms).getTimezoneOffset() : DAY_TZ_MIN) * 60000; }
  function dstrMs(ms) {                          // 그 순간의 날짜 'YYYY-MM-DD'
    var d = new Date(ms + tzMs(ms));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function todayStr() { return dstrMs(Date.now()); }
  function daysAgoStr(n) { return dstrMs(Date.now() - n * 86400000); }
  function msToMidnight() { var now = Date.now(); return 86400000 - ((now + tzMs(now)) % 86400000); }   // 다음 자정까지
  function dayNum(s) { var p = (s || '').split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fmtDayLabel(s) {
    // 'YYYY-MM-DD' → 'M월 D일 (요일)' + 오늘/어제 표시
    var p = (s || '').split('-'); if (p.length !== 3) return s;
    var wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
    var diff = dayNum(todayStr()) - dayNum(s);
    var rel = diff === 0 ? ' · 오늘' : diff === 1 ? ' · 어제' : diff === 2 ? ' · 그제' : '';
    return (+p[1]) + '월 ' + (+p[2]) + '일 (' + wd + ')' + rel;
  }
  function fmtDayShort(s) { return fmtDayLabel(s).replace(/ · .*/, ''); }                 // 'M월 D일 (요일)'
  function fmtMD(s) { var p = (s || '').split('-'); return p.length === 3 ? (+p[1]) + '월 ' + (+p[2]) + '일' : s; }

  /* ---------- 상태 ---------- */
  var FIELDS = ['fasting_glucose', 'weight', 'sleep_hours', 'breakfast', 'lunch', 'dinner', 'snack', 'med_morning', 'med_evening', 'supplement'];
  // 「N / 9 기록됨」에 세는 9칸 — 간식은 선택이라 세지 않는다.
  //   PC 쪽과 같은 9칸: health_reminder.py SLOTS(아침 4 + 저녁 3 + 밤 2) · chat_responder.py _HEALTH_MISS_SKIP=("snack",)
  var REQUIRED = FIELDS.filter(function (k) { return k !== 'snack'; });
  var SHORT = { fasting_glucose: '혈당', weight: '체중', sleep_hours: '수면', breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식',
                med_morning: '아침약', med_evening: '저녁약', supplement: '영양제' };
  // v9.5.1(O-0386) 끼니 「안 먹음」: 끼니 글 칸에 이 글자를 그대로 넣는다. 손으로 「안먹음」·「결식」처럼 적으신 것도 같은 뜻으로 읽는다.
  var SKIP = '안 먹음';
  var SKIP_WORDS = { '안먹음': 1, '안먹었음': 1, '안드심': 1, '결식': 1, '굶음': 1, '거름': 1 };
  var SKIP_MEALS = { breakfast: 1, lunch: 1, dinner: 1 };       // 간식은 해당 없음(선택 칸 — 「없음」 칩이 따로 있다)
  function isSkip(v) { return typeof v === 'string' && SKIP_WORDS[v.replace(/\s+/g, '')] === 1; }
  function skipOn(k, v) { return SKIP_MEALS[k] === 1 && isSkip(v); }
  var HIST_DAYS = 30;         // 「기록 보기」가 불러오는 범위 = 고칠 수 있는 범위(오늘 포함 30일)
  var GAP_DAYS = 7;           // 기록 보기에서 「통째로 빠진 날」도 줄로 보여 주는 범위(최근 7일). 0 이면 끔.
  var rec = null;             // 지금 입력 화면에 떠 있는 날짜의 기록(오늘 또는 고치는 중인 지난 날짜)
  var mode = 'today';         // 'today' | 'past'
  var openMeals = {};         // 이번에 연 화면에서 펼쳐 둔 끼니(다시 그려도 접히지 않게)
  var skipPrev = {};          // v9.5.1: 이번에 연 화면에서 「안 먹음」을 누르기 직전의 식단 글(잘못 눌렀을 때 다시 누르면 그대로 돌아오게)
  var rangeRows = [];         // 서버에서 받은 최근 30일 행(최신순) — 기록 보기 · ＋/− 시작값 · 지난 날짜 열기에 함께 쓴다
  var saveTimer = null, saveTimerDate = null;
  var inited = false;

  function blankRecord(dateStr) {
    var r = { log_date: dateStr, _v: 2, _dirty: {} };
    FIELDS.forEach(function (k) { r[k] = null; });
    return r;
  }
  function isSet(v) { return !(v === null || v === undefined || v === ''); }
  function norm(v) { return isSet(v) ? v : null; }
  // 같은 값인가 — 숫자는 서버가 문자열/소수로 돌려줘도 같게 본다(71.3 vs "71.30").
  function eq(a, b) {
    a = norm(a); b = norm(b);
    if (a === null || b === null) return a === b;
    if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
    var na = +a, nb = +b;
    if (typeof a === 'number' || typeof b === 'number') return !isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 1e-6;
    return String(a) === String(b);
  }
  function recordedCount() {
    var n = 0; REQUIRED.forEach(function (k) { if (isSet(rec[k])) n++; }); return n;
  }
  function dirtyKeys(r, all) {                    // 아직 서버에 안 올라간 칸. all=false 면 화면에 보여 줄 것만(옛 캐시 확인용은 제외)
    var d = (r && r._dirty) || {};
    return FIELDS.filter(function (k) { return d[k] && (all || !d[k].q); });
  }

  /* ---------- localStorage: 날짜별 기록(+안 올라간 칸 표시) · 밀린 날짜 목록 · 음식 프리셋 학습 ---------- */
  function cacheKey(dateStr) { return 'smart_health_day_' + dateStr; }
  // 저장된 그날 기록을 읽는다. v9.3 이하가 쓴 옛 모양(_v 없음)은 「오늘」일 때만 넘겨받는다:
  //   적혀 있는 칸을 '확인 필요'(q)로 표시해 두면 서버와 맞춰 볼 때 — 서버에 없으면 올리고, 서버에 다른 값이 있으면 서버 값을 따른다.
  function loadLocal(dateStr, allowLegacy) {
    var o = null;
    try { var s = localStorage.getItem(cacheKey(dateStr)); o = s ? JSON.parse(s) : null; } catch (e) { o = null; }
    if (!o || o.log_date !== dateStr) return null;
    if (o._v !== 2) {
      if (!allowLegacy) return null;
      o._v = 2; o._dirty = {};
      FIELDS.forEach(function (k) { if (isSet(o[k])) o._dirty[k] = { t: 0, base: null, q: 1 }; });
    }
    if (!o._dirty || typeof o._dirty !== 'object') o._dirty = {};
    FIELDS.forEach(function (k) { if (!(k in o)) o[k] = null; });
    return o;
  }
  var PEND_KEY = 'smart_health_pending';
  function pendList() { try { var a = JSON.parse(localStorage.getItem(PEND_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function pendSet(dateStr, on) {
    var a = pendList(), i = a.indexOf(dateStr);
    if (on && i < 0) a.push(dateStr); else if (!on && i >= 0) a.splice(i, 1); else return;
    try { localStorage.setItem(PEND_KEY, JSON.stringify(a)); } catch (e) {}
  }
  // 기록을 폰에 적어 둔다. 안 올라간 칸이 있으면 「밀린 날짜」 목록에 올리고, 없으면 내린다.
  //   지난 날짜는 다 올라간 뒤엔 폰 사본을 지운다(서버가 기준 — 옛 사본이 남아 다음에 잘못 쓰이지 않게). 오늘 것은 빨리 그리려고 남긴다.
  function persist(r) {
    if (!r) return;
    var dirty = dirtyKeys(r, true).length > 0;
    try {
      if (!dirty && r.log_date !== todayStr()) localStorage.removeItem(cacheKey(r.log_date));
      else localStorage.setItem(cacheKey(r.log_date), JSON.stringify(r));
    } catch (e) {}
    pendSet(r.log_date, dirty);
  }

  var BASE_FOODS = ['양배추', '현미밥', '계란', '두부', '닭가슴살', '김치', '나물', '생선', '샐러드', '사과', '견과류', '우유', '블랙커피'];
  var FOODS_KEY = 'smart_health_foods';
  function foodsGet() { try { return JSON.parse(localStorage.getItem(FOODS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function foodsPut(m) { try { localStorage.setItem(FOODS_KEY, JSON.stringify(m)); } catch (e) {} }
  function foodBump(name) {
    name = (name || '').trim(); if (!name) return;
    var m = foodsGet(); m[name] = (m[name] || 0) + 1; foodsPut(m);
  }
  // 표시용 프리셋: 기본 + 학습분 합쳐 빈도순(자주 고른 게 위). 상한 24개.
  function presetFoods() {
    var counts = foodsGet(), order = {};
    BASE_FOODS.forEach(function (f, i) { order[f] = i; if (!(f in counts)) counts[f] = 0; });
    var arr = Object.keys(counts).filter(function (f) { return !isSkip(f); });   // 「안 먹음」은 음식이 아니다(옛 버전에서 직접 입력으로 배웠어도 칩으로 내놓지 않는다)
    arr.sort(function (a, b) {
      if ((counts[b] || 0) !== (counts[a] || 0)) return (counts[b] || 0) - (counts[a] || 0);
      var oa = (a in order) ? order[a] : 999, ob = (b in order) ? order[b] : 999;
      if (oa !== ob) return oa - ob;
      return a < b ? -1 : 1;
    });
    return arr.slice(0, 24);
  }
  function mealTokens(v) {
    return (v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ---------- ＋/− 시작값: 그 칸의 가장 최근 기록값(편집 중인 날짜보다 앞선 날) ---------- */
  // 서버에서 받은 최근 30일 행에서 찾고, 아직 못 받았으면(끊김·막 열었을 때) 지난번에 적어 둔 값을 쓴다. 없으면 null → 예전 고정값.
  var LAST_KEY = 'smart_health_last';
  function lastGet() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function lastBefore(k, dateStr) {
    for (var i = 0; i < rangeRows.length; i++) {
      var r = rangeRows[i];
      if (r && r.log_date < dateStr && isSet(r[k]) && !isNaN(+r[k])) return { v: +r[k], d: r.log_date };
    }
    var m = lastGet()[k];
    if (m && m.d && m.d < dateStr && isSet(m.v) && !isNaN(+m.v)) return { v: +m.v, d: m.d };
    return null;
  }
  function lastRemember() {                       // 오늘 기준 「지난 기록」을 폰에 적어 둔다(다음에 끊긴 채 열어도 시작값이 맞게)
    var t = todayStr(), m = {};
    ['fasting_glucose', 'weight'].forEach(function (k) {
      for (var i = 0; i < rangeRows.length; i++) {
        var r = rangeRows[i];
        if (r && r.log_date < t && isSet(r[k]) && !isNaN(+r[k])) { m[k] = { v: +r[k], d: r.log_date }; break; }
      }
    });
    if (m.fasting_glucose || m.weight) { try { localStorage.setItem(LAST_KEY, JSON.stringify(m)); } catch (e) {} }
  }
  function defaultFor(k) {                        // 지난 기록이 하나도 없을 때의 시작점(예전 그대로)
    if (k === 'fasting_glucose') return 100;
    if (k === 'weight') return 70;
    return 0;
  }
  function startFor(k, dateStr) { var l = lastBefore(k, dateStr || rec.log_date); return l ? l.v : defaultFor(k); }
  function lastHint(k) {
    var l = lastBefore(k, rec.log_date); if (!l) return '';
    return '지난 기록 ' + (k === 'fasting_glucose' ? Math.round(l.v) : Math.round(l.v * 10) / 10);
  }

  /* ---------- 수면시간: 소수(시간) ↔ 시/분 변환 ---------- */
  // 저장 컬럼(sleep_hours)은 그대로 소수 시간. 7시간30분 → 7.5, 7시간20분 → 7.333.
  // 과거에 소수로 저장된 값도 그대로 시/분으로 풀어서 보여준다(하위호환, 데이터 안 건드림).
  function hoursToHM(v) {
    if (v === null || v === undefined || v === '' || isNaN(+v)) return null;
    var h = Math.floor(+v + 1e-9);
    var m = Math.round((+v - h) * 60);
    if (m >= 60) { h += 1; m -= 60; }
    if (h < 0) h = 0;
    return { h: h, m: m };
  }
  function hmToHours(h, m) {
    h = parseInt(h, 10) || 0; m = parseInt(m, 10) || 0;
    return Math.round((h + m / 60) * 1000) / 1000;   // 소수 3자리 반올림(부동소수 잡음 제거)
  }
  function fmtSleep(v) {
    var hm = hoursToHM(v); if (!hm) return '';
    if (hm.h === 0 && hm.m === 0) return '0분';
    if (hm.m === 0) return hm.h + '시간';
    if (hm.h === 0) return hm.m + '분';
    return hm.h + '시간 ' + hm.m + '분';
  }

  /* ---------- 네트워크(Supabase, 연동 암호 게이트 RPC — v7.5 O-0130) ---------- */
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function healthShown() { var v = $('healthView'); return !!(v && v.style.display !== 'none' && v.offsetParent !== null); }
  var gateShownAt = 0;
  function needPass(msg, force) {                // 암호 없음/틀림 → 앱의 연동 암호 창(너무 자주 띄우지 않게 20초 간격)
    if (!force && Date.now() - gateShownAt < 20000) return;
    gateShownAt = Date.now();
    try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {}
  }
  /* 폰 시계 ↔ 서버 시계 차이(skewMs = 서버 − 폰). 「같은 칸을 두 기기가 고쳤을 때 더 나중 쪽」을 가릴 때
   *   내 고친 시각(폰 시계)을 서버 시계로 옮겨 비교한다 → 폰 시계가 몇 분 틀려도 판정이 어긋나지 않는다.
   *   ① 건강 조회·저장 응답의 Date 머리글(올 때마다 새로 잼) ② 그 머리글을 못 읽는 환경이면 읽음 기준 조회(get_chat_read)의 server_now 로 한 번.
   *   둘 다 안 되면 0(= 예전처럼 폰 시계 그대로). */
  var skewMs = 0, skewKnown = false, skewTried = false;
  function noteServerClock(resp, t0) {
    try {
      var h = resp && resp.headers && resp.headers.get('Date'); if (!h) return;
      var s = Date.parse(h); if (isNaN(s)) return;
      skewMs = (s + 500) - (t0 + Date.now()) / 2;   // Date 머리글은 초 단위(버림)라 0.5초를 더하고, 보낸 때와 받은 때의 가운데와 비교
      skewKnown = true;
    } catch (e) {}
  }
  function clockReady() {
    if (skewKnown || skewTried) return Promise.resolve();
    var OB = global.OfficeBridge, pass = syncPass();
    if (!(OB && OB.getChatRead) || !pass) return Promise.resolve();
    skewTried = true;
    var t0 = Date.now();
    return OB.getChatRead(pass).then(function (d) {
      var s = d && d.server_now ? Date.parse(d.server_now) : NaN;
      if (!isNaN(s)) { skewMs = s - (t0 + Date.now()) / 2; skewKnown = true; }
    }, function (e) { if (!(e && (e.notready || e.badpass))) skewTried = false; });   // 끊김이면 다음에 다시 해 본다
  }
  // quiet=true: 건강 화면 밖에서 밀린 칸을 조용히 다시 올릴 때 — 암호 창을 띄우지 않는다(다른 일 하시는 중에 끼어들지 않게).
  function rpc(name, body, quiet) {
    var c = cfg(); if (!c) return Promise.reject(new Error('NO_CONFIG'));
    var pass = syncPass();
    if (!pass) {
      if (!quiet) needPass('건강 기록을 저장·조회하려면 PC 연동 암호를 입력해 주세요.');
      var e0 = new Error('NO_PASS'); e0.badpass = true; return Promise.reject(e0);
    }
    body.p_pass = pass;
    var t0 = Date.now();
    return fetch(c.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      noteServerClock(r, t0);
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        if (!quiet) needPass('연동 암호가 맞지 않아 건강 기록을 저장·조회하지 못했습니다. 다시 입력해 주세요.');
        var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  // 조회: 실패하면 거절(reject)한다 — 「못 불러옴」과 「기록 없음」을 구분해야 덮어쓰기 사고가 없다.
  function listRange(fromStr, toStr, quiet) {
    return rpc('health_list', { p_from: fromStr, p_to: toStr }, quiet)
      .then(function (rows) { if (!Array.isArray(rows)) throw new Error('BAD_SHAPE'); return rows; })
      .then(function (rows) { return clockReady().then(function () { return rows; }); });   // 서버 값과 맞추기 전에 시계 차이를 알아 둔다
  }
  function listOne(dateStr, quiet) {
    return listRange(dateStr, dateStr, quiet).then(function (rows) { return rows[0] || null; });
  }
  function findRow(dateStr) {
    for (var i = 0; i < rangeRows.length; i++) if (rangeRows[i] && rangeRows[i].log_date === dateStr) return rangeRows[i];
    return null;
  }
  function putRow(row) {                          // 받은 한 날 행을 최근 30일 사본에 끼워 넣는다
    if (!row || !row.log_date) return;
    for (var i = 0; i < rangeRows.length; i++) if (rangeRows[i].log_date === row.log_date) { rangeRows[i] = row; return; }
    rangeRows.push(row);
    rangeRows.sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
  }

  /* ---------- 서버 값과 맞추기(칸 단위) ----------
   * r 의 각 칸을 서버의 그날 행(row, 없으면 null)과 맞춘다.
   *  · 내가 고치지 않은 칸        → 서버 값을 그대로 따른다(다른 기기가 고친 것이 보이고, 내 옛 값으로 덮지 않는다).
   *  · 내가 고친 칸(_dirty)       → ① 서버에 이미 같은 값이면 끝 ② 서버 값이 「내가 고치기 전에 알던 값(base)」 그대로면 내 값을 올린다
   *                                  ③ 서버 값이 그 사이 바뀌었으면(다른 기기가 고침) 더 나중 쪽: 내 고친 시각(t, 서버 시계로 옮긴 값) > 서버 행 updated_at 이면 내 값,
   *                                     아니면 서버 값을 따르고 내 값은 내려놓는다(lost 로 돌려줘 화면에 알린다).
   * 반환 {changed: 화면 값이 바뀜, push: 올릴 칸들, lost: [{k, mine, theirs}]} */
  function applyServer(r, row) {
    var srvT = row && row.updated_at ? Date.parse(row.updated_at) : 0;
    if (isNaN(srvT)) srvT = 0;
    var d = r._dirty || (r._dirty = {}), out = { changed: false, push: [], lost: [] };
    FIELDS.forEach(function (k) {
      var sv = row ? norm(row[k]) : null, e = d[k];
      if (!e) { if (!eq(r[k], sv)) { r[k] = sv; out.changed = true; } return; }
      if (eq(r[k], sv)) { delete d[k]; return; }
      if (eq(e.base, sv) || !(srvT > e.t + (e.q ? 0 : skewMs))) { out.push.push(k); return; }
      if (!e.q) out.lost.push({ k: k, mine: r[k], theirs: sv });
      r[k] = sv; delete d[k]; out.changed = true;
    });
    return out;
  }
  function fmtVal(k, v) {
    if (!isSet(v)) return '비움';
    if (k === 'sleep_hours') return fmtSleep(+v);
    if (typeof v === 'boolean') return v ? '복용함' : '미복용';
    return String(v);
  }
  function tellLost(lost, dateStr) {
    if (!lost || !lost.length) return;
    var s = lost.map(function (x) { return SHORT[x.k] + ' ' + fmtVal(x.k, x.theirs); }).join(' · ');
    _toast('다른 기기에서 더 나중에 고친 값으로 맞췄습니다 (' + (dateStr === todayStr() ? '' : fmtMD(dateStr) + ' ') + s + ')');
  }

  /* ---------- 올리기(읽고 → 합치고 → 통째로 올림). 한 번에 한 날짜씩 차례로 ---------- */
  var chain = Promise.resolve(), queued = {}, busyDate = null;
  var retryTimer = null, retryMs = 0, lastFail = '';   // lastFail: '' | 'net' | 'pass'
  // v9.4: 마지막 실패가 「연결 끊김」이었나(요청이 아예 나가지 못함). 서버가 오류로 답한 경우는 false — 케이가 「연결이 끊겨」라고 말해도 되는지 가리는 데만 쓴다(다시 올리는 규칙과 무관).
  var lastCut = false;
  function isCut(e) { return !(e && (e.badpass || /^(HTTP \d|UPSERT_FALSE|NO_CONFIG)/.test(String(e.message || '')))); }
  function failKind(e) { var bp = !!(e && e.badpass); lastCut = !bp && isCut(e); return bp ? 'pass' : 'net'; }
  function syncDate(dateStr) {
    if (queued[dateStr]) return queued[dateStr];
    var p = chain.then(function () { delete queued[dateStr]; return doSync(dateStr); });
    queued[dateStr] = p;
    chain = p.then(function () {}, function () {});
    return p;
  }
  // 결과: 'ok'(다 올라감) | 'pending'(아직 남음 — 끊김 등) | 'nopass'(연동 암호 필요)
  function doSync(dateStr) {
    var loaded = null;
    // 그 날짜의 「살아 있는」 기록: 화면에 떠 있으면 그것, 아니면 폰에 적어 둔 것(올리는 사이 화면이 그 날짜로 바뀌어도 한 벌만 고친다)
    function pick() {
      if (rec && rec.log_date === dateStr) return rec;
      return loaded || (loaded = loadLocal(dateStr, dateStr === todayStr()));
    }
    var r = pick();
    if (!r) { pendSet(dateStr, false); return Promise.resolve('ok'); }
    if (!dirtyKeys(r, true).length) { persist(r); return Promise.resolve('ok'); }
    var quiet = !(r === rec && healthShown());
    busyDate = dateStr; if (r === rec) paintState();
    return listOne(dateStr, quiet).then(function (row) {
      putRow(row);
      r = pick();
      var res = applyServer(r, row), snap = {};
      res.push.forEach(function (k) { snap[k] = r._dirty[k].t; });
      persist(r);
      if (res.changed && rec === r) softRender();
      tellLost(res.lost, dateStr);
      if (!res.push.length) return 'ok';
      var body = { log_date: dateStr };            // 그날의 10칸을 전부 싣는다(통째 덮어쓰기라 빠뜨린 칸은 비워진다)
      FIELDS.forEach(function (k) { body[k] = isSet(r[k]) ? r[k] : null; });
      return rpc('health_upsert', { p_row: body }, quiet).then(function (ok) {
        if (ok !== true) throw new Error('UPSERT_FALSE');
        r = pick();
        res.push.forEach(function (k) {
          var e = r._dirty && r._dirty[k]; if (!e) return;
          if (e.t === snap[k]) delete r._dirty[k];      // 올리는 사이에 또 고치지 않았으면 끝
          else e.base = body[k];                         // 또 고쳤으면 그 칸은 다음 회차에 다시 올린다
        });
        var up = { log_date: dateStr, updated_at: new Date(Date.now() + skewMs).toISOString() };   // 서버가 방금 매긴 시각(어림)
        FIELDS.forEach(function (k) { up[k] = body[k]; });
        putRow(up);
        persist(r);
        return dirtyKeys(r, true).length ? 'pending' : 'ok';
      });
    }).then(function (st) {
      busyDate = null; if (st === 'ok') lastFail = '';
      if (rec && rec.log_date === dateStr) paintState();
      return st;
    }, function (e) {
      busyDate = null; lastFail = failKind(e);
      if (rec && rec.log_date === dateStr) paintState();
      return (e && e.badpass) ? 'nopass' : 'pending';
    });
  }
  // 밀린 날짜 전부 다시 올리기. 남은 것이 있으면 짧은 간격(5초 → 15초 → 45초 → 60초)으로 다시 해 본다(화면이 보일 때만).
  var flushing = null;
  function flush() {
    if (flushing) return flushing;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    var dates = pendList();
    if (!dates.length) { retryMs = 0; return Promise.resolve(); }
    flushing = Promise.all(dates.map(syncDate)).then(function (sts) {
      flushing = null;
      var left = sts.some(function (s) { return s === 'pending'; });
      if (!left) { retryMs = 0; return; }
      retryMs = retryMs ? Math.min(retryMs * 3, 60000) : 5000;
      if (retryTimer) clearTimeout(retryTimer);
      if (!document.hidden) retryTimer = setTimeout(flush, retryMs);
    }, function () { flushing = null; });
    return flushing;
  }
  function wake() { retryMs = 0; flush(); }      // 연결이 돌아왔거나 앱으로 돌아옴 → 곧바로 다시

  function flushSaveTimer() {                     // 기다리던 저장(0.5초)을 지금 보낸다 — 날짜를 바꾸기 직전 등
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    var d = saveTimerDate; saveTimerDate = null;
    if (d) syncDate(d).then(function (st) { if (st === 'pending') flush(); });
  }
  // r = 값이 바뀐 기록(그 날짜로 저장된다). 화면에 떠 있는 기록이 아닐 수도 있다(화면을 넘기는 순간 확정된 값 — bindToday 참고).
  function scheduleSave(r) {
    persist(r);
    if (r === rec) paintState('saving');
    if (saveTimer && saveTimerDate && saveTimerDate !== r.log_date) flushSaveTimer();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimerDate = r.log_date;
    saveTimer = setTimeout(function () {
      var d = saveTimerDate; saveTimer = null; saveTimerDate = null;
      syncDate(d).then(function (st) { if (st === 'pending') flush(); });
    }, 500);
  }
  // 기록 r 의 한 칸을 바꾼다 = 「이 기기에서 고친 칸」으로 표시(고친 시각 + 고치기 전에 알던 서버 값). 원래 값으로 되돌리면 표시를 뗀다.
  function setField(r, k, v) {
    v = norm(v);
    if (eq(r[k], v)) return false;
    var d = r._dirty || (r._dirty = {}), e = d[k];
    if (e && !e.q && eq(e.base, v)) delete d[k];
    else d[k] = { t: Date.now(), base: (e && !e.q) ? e.base : norm(r[k]) };
    r[k] = v;
    return true;
  }

  /* ---------- v9.4 케이 한마디(머리줄) + 9칸을 다 채운 순간의 반응 ----------
   * 머리줄의 케이는 늘 작게 접힌 모습(머리 + 한 줄)이다 — 화면 길이·약 칸 위치는 예전(「N / 9 기록됨」 줄)과 같다.
   * 한 줄은 이 화면이 가진 값(9칸 중 채워진 수 · 비어 있는 칸 이름)으로만 만든다. 수치의 높고 낮음은 말하지 않는다.
   * 「오늘 기록」에서 대표님이 방금 누른 것으로 9칸이 다 찼을 때만(서버에서 받아 온 값으로 찬 것은 아님) 웃는 케이가 크게 한마디 한다 — 하루 한 번, 4초.
   *   화면 아래쪽에 떠 있기만 한다(누르는 곳 아님 · 뒤 화면 누르기를 막지 않음 · 화면을 밀어내지 않음 — 누르던 칸이 움직이지 않게). */
  var SAY_ORDER = ['fasting_glucose', 'weight', 'sleep_hours', 'med_morning', 'med_evening', 'supplement', 'breakfast', 'lunch', 'dinner'];   // 화면에 놓인 순서
  var CHEER_KEY = 'smart_health_cheer', CHEER_MS = 4000;
  var lastCount = -1, cheerT = null;
  function sayText() {
    var N = REQUIRED.length;
    var miss = SAY_ORDER.filter(function (k) { return REQUIRED.indexOf(k) >= 0 && !isSet(rec[k]); }).map(function (k) { return SHORT[k]; });
    var n = N - miss.length;
    if (mode === 'past') return miss.length ? N + '칸 중 ' + n + '칸 적혀 있습니다' : N + '칸 다 적혀 있습니다';
    if (!miss.length) return '오늘 ' + N + '칸 다 적혀 있습니다';
    return N + '칸 중 ' + n + '칸 · ' + (miss.length === 1 ? miss[0] + '만 남았습니다' : miss[0] + ' 등 ' + miss.length + '칸 남았습니다');
  }
  // user=true: 대표님이 방금 누른 변화(→ 9칸이 막 찼으면 반응). false: 화면을 그리거나 서버 값을 받아 온 것.
  function paintSay(user) {
    var sc = $('kscHealth'); if (!sc || !rec) return;
    var n = recordedCount(), t = sayText();
    if (global.KScene) global.KScene.set(sc, 'clip', t, { quiet: true });      // 빨리 쓰는 화면 — 등장·글자 찍힘 없이 바로
    else { var pp = $('hSay'); if (pp) pp.textContent = t; }
    sc.setAttribute('data-n', String(n));
    // v9.6(O-0387 3번): 대표님이 방금 누른 변화로 칸 수가 바뀌었을 때만 숫자가 굴러 바뀐다(서버 값을 받아 맞출 때는 그대로)
    try { if (user && lastCount >= 0 && n !== lastCount && global.KMotion) global.KMotion.rollNumber(sc.querySelector('.ksp p'), n, n > lastCount); } catch (e) {}
    if (user && mode === 'today' && rec.log_date === todayStr() && n === REQUIRED.length && lastCount >= 0 && lastCount < REQUIRED.length) cheer(rec.log_date);
    lastCount = n;
  }
  function cheer(ds) {
    var done = ''; try { done = localStorage.getItem(CHEER_KEY) || ''; } catch (e) {}
    if (done === ds) return;                                   // 오늘 이미 한 번 했다
    var view = $('healthView'); if (!view || !global.KScene) return;   // 띄울 수 없으면 「했다」고 적지 않는다(다음 기회에 뜨게)
    var old = $('kscHCheer'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var el = document.createElement('div');
    el.id = 'kscHCheer'; el.className = 'ksc hcheer'; el.setAttribute('role', 'status');
    el.innerHTML = '<div class="ksc-l"><div class="ksp"><b>케이</b><p></p></div></div><span class="kfigw"><img class="kfig" alt="케이" draggable="false"></span>';
    view.appendChild(el);
    try { global.KScene.set(el, 'idle', '오늘 기록 다 적으셨습니다.'); }
    catch (e) { if (el.parentNode) el.parentNode.removeChild(el); return; }
    try { localStorage.setItem(CHEER_KEY, ds); } catch (e) {}  // 장면을 실제로 띄운 뒤에 적는다(하루 한 번)
    setTimeout(function () { el.classList.add('on'); try { if (global.KMotion) global.KMotion.cheer(el); } catch (e) {} }, 30);   // v9.6(O-0387 3번): 작은 축하(색종이) — 하루 한 번은 위에서 이미 지킨다
    clearTimeout(cheerT);
    cheerT = setTimeout(function () {
      el.classList.remove('on');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, CHEER_MS);
  }

  /* ---------- 저장 상태 표시 ---------- */
  function isNative() { try { var C = global.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } }
  function hereWord() { return isNative() ? '폰에만' : '이 기기에만'; }
  function paintState(force) {
    var el = $('hSaveState'), box = $('hLocal'), host = $('hToday');
    if (!rec || !host) return;
    var dk = dirtyKeys(rec, false);
    // 칸마다 「폰에만」 표시
    Array.prototype.forEach.call(host.querySelectorAll('[data-k]'), function (it) {
      if (!it.classList.contains('hitem') && !it.classList.contains('htcell')) return;
      it.classList.toggle('pend', dk.indexOf(it.getAttribute('data-k')) >= 0);
    });
    var saving = force === 'saving' || busyDate === rec.log_date || !!(saveTimer && saveTimerDate === rec.log_date);
    if (el) {
      var wasWork = el.className.indexOf('work') >= 0;
      if (saving) { el.textContent = '적고 있습니다…'; el.className = 'hsave work'; }
      else if (dk.length) { el.textContent = hereWord() + ' 적어 둠'; el.className = 'hsave pend'; }
      else { el.textContent = '적어 두었습니다'; el.className = 'hsave ok'; }
      // v9.6(O-0387 3번): 「적고 있습니다…」에서 「적어 두었습니다」로 바뀌는 순간에만 살짝 떠오른다
      try { if (wasWork && el.className === 'hsave ok' && global.KMotion) global.KMotion.saved(el); } catch (e) {}
    }
    if (box) {
      if (dk.length && !saving) {
        var nopass = !syncPass() || lastFail === 'pass';
        // v9.4 케이 말투. 「연결이 끊겨」는 마지막 실패가 실제로 끊김이었을 때만 말한다(lastCut).
        var why = nopass ? '연동 암호가 없어 ' : (lastFail === 'net' && lastCut) ? '연결이 끊겨 ' : '';
        box.innerHTML = '<b>' + esc(why + hereWord()) + ' 적어 두었습니다.</b> ' +
          (nopass ? '암호를 넣어 주시면 올려 두겠습니다.' : '연결되면 제가 올려 두겠습니다.') +
          '<span class="hlocal-k">' + esc(dk.map(function (k) { return SHORT[k]; }).join(' · ')) + '</span>';
        box.className = 'hlocal' + (nopass ? ' tap' : '');
        box.style.display = '';
      } else if (!dk.length) { box.style.display = 'none'; box.innerHTML = ''; }
    }
  }

  /* ============================ 입력 화면 렌더(오늘 또는 고치는 중인 지난 날짜) ============================ */
  function pendTag() { return '<em class="hpend">' + esc(hereWord()) + '</em>'; }
  function numRow(k, label, unit, step) {
    var v = isSet(rec[k]) ? rec[k] : '';
    var hint = lastHint(k);
    return '<div class="hitem hnum" data-k="' + k + '" data-step="' + step + '">' +
      '<div class="hitem-top"><span class="hlab">' + label + ' <small>' + unit + '</small>' + pendTag() + '</span>' +
      '<span class="hitem-r"><span class="hlast">' + esc(hint) + '</span>' + chk(k) + '</span></div>' +
      '<div class="hstep">' +
      '<button type="button" class="hstepbtn" data-d="-1" aria-label="줄이기">−</button>' +
      '<input class="hval" inputmode="decimal" value="' + esc(v) + '" placeholder="—" aria-label="' + label + '">' +
      '<button type="button" class="hstepbtn" data-d="1" aria-label="늘리기">＋</button>' +
      '</div></div>';
  }
  function chk(k) {
    return '<i class="hchk' + (isSet(rec[k]) ? ' on' : '') + '"><svg><use href="#i-check"/></svg></i>';
  }
  // 수면시간: 「시간」 + 「분」 두 드롭다운. 내부 저장은 소수 시간(sleep_hours)으로 그대로.
  function sleepRow() {
    var v = isSet(rec.sleep_hours) ? +rec.sleep_hours : null;
    var hm = hoursToHM(v);
    var curH = hm ? hm.h : '';
    var curM = hm ? hm.m : 0;
    var hopts = '<option value=""' + (curH === '' ? ' selected' : '') + '>—</option>';
    for (var i = 0; i <= 14; i++) {
      hopts += '<option value="' + i + '"' + (curH === i ? ' selected' : '') + '>' + i + '</option>';
    }
    var mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    if (hm && mins.indexOf(curM) < 0) { mins.push(curM); mins.sort(function (a, b) { return a - b; }); }  // 과거값이 5분 배수가 아니어도 표시
    var mopts = mins.map(function (m) {
      return '<option value="' + m + '"' + (curM === m ? ' selected' : '') + '>' + m + '</option>';
    }).join('');
    return '<div class="hitem hsleep" data-k="sleep_hours">' +
      '<div class="hitem-top"><span class="hlab">수면시간' + pendTag() + '</span>' + chk('sleep_hours') + '</div>' +
      '<div class="hsleep-row">' +
      '<select class="hsel hsel-h" aria-label="수면 시간">' + hopts + '</select><span class="hsel-u">시간</span>' +
      '<select class="hsel hsel-m" aria-label="수면 분">' + mopts + '</select><span class="hsel-u">분</span>' +
      '</div></div>';
  }
  // 끼니: 이미 적은 끼니는 한 줄(누르면 펼침). 아직 안 적은 끼니·이번에 펼친 끼니는 칩이 보인다.
  //   v9.5.1: 아침·점심·저녁은 칩 줄 맨 앞에 「안 먹음」(점선 칩). 누르면 그 끼니는 「안 먹음」으로 적히고 한 줄로 접힌다.
  function mealBlock(k, label, withNone) {
    var lab = label + (k === 'snack' ? ' <small>선택</small>' : '') + pendTag();
    var skip = skipOn(k, rec[k]);
    if (isSet(rec[k]) && !openMeals[k]) {
      return '<div class="hitem hmeal fold' + (skip ? ' skip' : '') + '" data-k="' + k + '">' +
        '<button type="button" class="hmeal-sum" aria-expanded="false" aria-label="' + label + ' 고치기">' +
        '<span class="hlab">' + lab + '</span><span class="hmeal-val">' + esc(rec[k]) + '</span>' + chk(k) +
        '<svg class="hmeal-chev"><use href="#i-chev-r"/></svg></button></div>';
    }
    var sel = skip ? [] : mealTokens(rec[k]);      // 「안 먹음」은 음식 낱말이 아니다(직접 입력 칸에도 내놓지 않는다)
    var selSet = {}; sel.forEach(function (t) { selSet[t] = 1; });
    var presets = presetFoods();
    if (withNone) presets = ['없음'].concat(presets.filter(function (f) { return f !== '없음'; }));
    var chips = presets.map(function (f) {
      return '<button type="button" class="chip hchip' + (selSet[f] ? ' on' : '') + '" data-food="' + esc(f) + '">' + esc(f) + '</button>';
    }).join('');
    if (SKIP_MEALS[k]) {
      chips = '<button type="button" class="chip hchip hskip' + (skip ? ' on' : '') + '" data-food="' + esc(SKIP) + '" aria-pressed="' + (skip ? 'true' : 'false') +
        '" aria-label="' + label + ' ' + esc(SKIP) + '">' + esc(SKIP) + '</button>' + chips;
    }
    // 직접입력: 프리셋에 없는 선택 토큰만 표시
    var presetSet = {}; presets.forEach(function (f) { presetSet[f] = 1; });
    var custom = sel.filter(function (t) { return !presetSet[t]; }).join(', ');
    return '<div class="hitem hmeal" data-k="' + k + '">' +
      '<div class="hitem-top"><span class="hlab">' + lab + '</span>' +
      '<span class="hitem-r">' + (isSet(rec[k]) ? '<button type="button" class="hmeal-close">접기</button>' : '') + chk(k) + '</span></div>' +
      '<div class="chips hchips">' + chips + '</div>' +
      '<div class="input filled hcustom"><input class="hcustomin" value="' + esc(custom) + '" placeholder="직접 입력 (쉼표로 여러 개)" aria-label="' + label + ' 직접 입력"></div>' +
      '</div>';
  }
  // 약·영양제: 숫자 칸 바로 아래 한 줄(세 칸 나란히) — 아침에 스크롤 없이 닿게.
  function togCell(k, label) {
    return '<div class="htcell" data-k="' + k + '">' +
      '<span class="htlab">' + label + '</span>' +
      '<button type="button" class="htogbtn ' + togCls(rec[k]) + '" data-k="' + k + '" aria-label="' + label + '">' + togTxt(rec[k]) + '</button>' +
      pendTag() +                                   // 「폰에만」 표시는 단추 아래(칸이 좁아 이름 옆에는 자리가 없다)
      '</div>';
  }
  function togCls(v) { return v === true ? 'on' : v === false ? 'off' : ''; }
  function togTxt(v) { return v === true ? '복용함 ✓' : v === false ? '미복용' : '눌러서 기록'; }

  function renderToday() {
    var host = $('hToday'); if (!host || !rec) return;
    var past = mode === 'past';
    var md = esc(fmtMD(rec.log_date)), full = esc(fmtDayShort(rec.log_date));
    host.className = past ? 'hpastmode' : '';
    host.innerHTML =
      (past
        ? '<div class="hpast" role="status"><span class="hpast-tx"><b>' + full + '</b> 기록을 고치는 중</span>' +
          '<button type="button" class="hpast-btn" data-act="today">오늘로 돌아가기</button></div>'
        : '') +
      // v9.4: 머리줄 = 날짜·저장 상태 + 케이 한 줄(작게 접힌 모습 고정 — 예전 「N / 9 기록됨」 줄 자리, 화면 길이 그대로)
      '<div class="ksc health" id="kscHealth" role="status">' +
        '<div class="ksc-l"><div class="hhead"><div class="hdate">' + esc(fmtDayLabel(rec.log_date)) + '</div>' +
        '<span id="hSaveState" class="hsave"></span></div>' +
        '<div class="ksp"><b>케이</b><p id="hSay"></p></div></div>' +
        '<span class="kfigw"><img class="kfig" alt="케이" draggable="false"></span>' +
      '</div>' +
      '<div id="hLocal" class="hlocal" style="display:none" role="status"></div>' +

      '<div class="hgroup">' +
      numRow('fasting_glucose', '공복혈당', 'mg/dL', 1) +
      numRow('weight', '체중', 'kg', 0.1) +
      sleepRow() +
      '</div>' +

      '<div class="hsec">복약 · 영양제</div>' +
      '<div class="hgroup htogs">' +
      togCell('med_morning', '당뇨약(아침)') +
      togCell('med_evening', '당뇨약(저녁)') +
      togCell('supplement', '영양제') +
      '</div>' +

      '<div class="hsec">식단</div>' +
      '<div class="hgroup">' +
      mealBlock('breakfast', '아침', false) +
      mealBlock('lunch', '점심', false) +
      mealBlock('dinner', '저녁', false) +
      mealBlock('snack', '간식', true) +
      '</div>' +
      (past
        ? '<button type="button" class="hpast-foot" data-act="today"><span>' + md + ' 기록을 고치는 중</span><b>오늘로 돌아가기</b></button>'
        : '');

    paintedDay = todayStr();
    lastCount = -1;                                  // 새로 그린 화면 — 「방금 다 채움」 판정은 여기서부터 다시
    paintSay(false);
    bindToday();
    paintState();
  }
  // 서버 값이 들어와 다시 그릴 때: 글자를 치는 중이면 건드리지 않는다(값은 rec 에 이미 반영 — 다음에 그릴 때 보인다).
  function softRender() {
    var host = $('hToday'), a = document.activeElement;
    if (host && a && host.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      refreshAllChk(); paintState();
      Array.prototype.forEach.call(host.querySelectorAll('.hnum'), function (row) {       // 「지난 기록」 안내만 새로
        var h = row.querySelector('.hlast'); if (h) h.textContent = lastHint(row.getAttribute('data-k'));
      });
      return;
    }
    renderToday();
  }

  // quiet=true: 서버 값을 받아 다시 맞추는 중(대표님이 누른 것이 아님 → 「다 채움」 반응 없음)
  function refreshChk(k, quiet) {
    var host = $('hToday'); if (!host) return;
    var item = host.querySelector('.hitem[data-k="' + k + '"]');
    if (item) {
      var c = item.querySelector('.hchk');
      if (c) {
        var wasOn = c.className.indexOf(' on') >= 0, nowOn = isSet(rec[k]);
        c.className = 'hchk' + (nowOn ? ' on' : '');
        // v9.6(O-0387 3번): 대표님이 방금 눌러 칸이 「처음 채워진」 순간에만 체크를 그린다(＋/− 를 연달아 눌러 값만 바뀔 때·서버 값을 받아 맞출 때는 그대로)
        try { if (quiet !== true && nowOn && !wasOn && global.KMotion) global.KMotion.checkDraw(c); } catch (e) {}
      }
    }
    paintSay(quiet !== true);
  }
  function refreshAllChk() { FIELDS.forEach(function (k) { refreshChk(k, true); }); }

  function bindToday() {
    var host = $('hToday'); if (!host) return;
    // 이 화면이 그려진 기록(날짜)과 모드를 붙들어 둔다 — 화면이 다른 날짜로 넘어가는 순간 확정된 값이 엉뚱한 날짜에 들어가지 않게.
    var R = rec, M = mode;
    // 이 화면의 조작이 들어갈 기록: 같은 날짜가 아직 떠 있으면 그 기록, 화면이 다른 날짜로 넘어갔으면 붙들어 둔 그 날짜의 기록.
    function T() { return (rec && rec.log_date === R.log_date) ? rec : R; }
    // 「오늘 기록」으로 그린 화면인데 자정이 지나 그 날짜가 더는 오늘이 아니면(화면을 켜 둔 채 날짜가 넘어감):
    //   어제 기록에는 손대지 않고, 오늘 화면을 새로 열어 같은 조작을 거기에 한 번 넣는다(replay). 「지난 날짜 고치는 중」 화면은 해당 없음.
    function moved(replay) {
      if (M !== 'today' || R.log_date === todayStr()) return false;
      if (!healthShown() || host.style.display === 'none') return true;       // 보이지 않는 옛 화면의 조작 — 아무 데도 적지 않는다
      if (!(mode === 'today' && rec && rec.log_date === todayStr())) {
        open(); wake();
        _toast('날짜가 바뀌어 오늘(' + fmtMD(todayStr()) + ') 기록으로 새로 열었습니다.');
      }
      try { if (replay) replay($('hToday')); } catch (e) {}
      return true;
    }
    function fire(el, type) { if (el) el.dispatchEvent(new Event(type, { bubbles: true })); }

    // 지난 날짜 고치는 중: [오늘로 돌아가기](위·아래)
    Array.prototype.forEach.call(host.querySelectorAll('[data-act="today"]'), function (b) {
      b.addEventListener('click', function () { open(); try { global.scrollTo(0, 0); } catch (e) {} });
    });
    // 「폰에만 저장됨」 줄: 연동 암호가 없어서 못 올린 경우 누르면 암호 창
    var box = $('hLocal');
    if (box) box.addEventListener('click', function () {
      if (!box.classList.contains('tap')) { wake(); return; }
      needPass('건강 기록을 올리려면 PC 연동 암호를 입력해 주세요.', true);
    });

    // 숫자 스텝퍼 + 직접 입력
    Array.prototype.forEach.call(host.querySelectorAll('.hnum'), function (row) {
      var k = row.getAttribute('data-k');
      var step = parseFloat(row.getAttribute('data-step')) || 1;
      var input = row.querySelector('.hval');
      function fix(num) { return (k === 'fasting_glucose') ? Math.round(num) : Math.round(num * 10) / 10; }
      function commit() {
        var raw = (input.value || '').trim(), nv = null;
        if (raw !== '') { var num = parseFloat(raw); nv = isNaN(num) ? null : fix(num); }
        var typed = !eq(nv, R[k]);                  // 이 화면에서 실제로 고쳐 친 값인가(그대로 둔 옛 값은 옮기지 않는다)
        if (moved(function (h) {
          var i = h.querySelector('.hitem[data-k="' + k + '"] .hval');
          if (i && typed) { i.value = raw; fire(i, 'change'); }
        })) return;
        var t = T(), ch = setField(t, k, nv);
        input.value = isSet(t[k]) ? t[k] : '';
        if (t === rec) refreshChk(k);
        if (ch) scheduleSave(t);
      }
      Array.prototype.forEach.call(row.querySelectorAll('.hstepbtn'), function (b) {
        b.addEventListener('click', function () {
          var d = parseFloat(b.getAttribute('data-d')) || 1;
          if (moved(function (h) { var nb = h.querySelector('.hitem[data-k="' + k + '"] .hstepbtn[data-d="' + b.getAttribute('data-d') + '"]'); if (nb) nb.click(); })) return;
          var t = T();
          // 비어 있으면 「그 칸의 가장 최근 기록값」에서 한 칸 움직인다(없으면 예전 고정값). 누르기 전에는 아무것도 기록되지 않는다.
          var cur = isSet(t[k]) ? parseFloat(t[k]) : startFor(k, t.log_date);
          var nv = cur + d * step;
          if (nv < 0) nv = 0;
          var ch = setField(t, k, fix(nv));
          input.value = t[k];
          if (t === rec) refreshChk(k);
          if (ch) scheduleSave(t);
        });
      });
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
    });

    // 수면시간: 시/분 드롭다운 → 소수 시간으로 저장
    var sleepBlock = host.querySelector('.hsleep');
    if (sleepBlock) {
      var selH = sleepBlock.querySelector('.hsel-h');
      var selM = sleepBlock.querySelector('.hsel-m');
      var commitSleep = function () {
        if (moved(function (h) {
          var nh = h.querySelector('.hsleep .hsel-h'), nm = h.querySelector('.hsleep .hsel-m');
          if (nh && nm) { nh.value = selH.value; nm.value = selM.value; fire(nh, 'change'); }
        })) return;
        var nv = null;
        if (selH.value !== '') { var total = hmToHours(selH.value, selM.value); nv = total > 0 ? total : null; }
        var t = T(), ch = setField(t, 'sleep_hours', nv);
        if (t === rec) refreshChk('sleep_hours');
        if (ch) scheduleSave(t);
      };
      selH.addEventListener('change', commitSleep);
      selM.addEventListener('change', commitSleep);
    }

    // 식단: 접힌 한 줄 → 펼치기 / [접기] / 칩 + 직접입력
    Array.prototype.forEach.call(host.querySelectorAll('.hmeal'), function (block) {
      var k = block.getAttribute('data-k');
      function newBlock(h) { return h.querySelector('.hmeal[data-k="' + k + '"]'); }
      var sum = block.querySelector('.hmeal-sum');
      if (sum) { sum.addEventListener('click', function () { if (moved() || rec !== T()) return; openMeals[k] = 1; renderToday(); }); return; }
      var cl = block.querySelector('.hmeal-close');
      if (cl) cl.addEventListener('click', function () { if (moved() || rec !== T()) return; delete openMeals[k]; renderToday(); });
      Array.prototype.forEach.call(block.querySelectorAll('.hchip'), function (chip) {
        chip.addEventListener('click', function () {
          var food = chip.getAttribute('data-food');
          if (moved(function (h) {
            var nb = newBlock(h);
            Array.prototype.forEach.call(nb ? nb.querySelectorAll('.hchip') : [], function (c) { if (c.getAttribute('data-food') === food) c.click(); });
          })) return;
          if (chip.classList.contains('hskip')) { toggleSkip(k, T()); return; }     // v9.5.1 「안 먹음」: 켜면 그 끼니를 「안 먹음」으로 적고 접는다 · 다시 누르면 푼다
          var skipChip = block.querySelector('.hskip');                             // 음식을 고르면 「안 먹음」은 풀린다
          if (skipChip) { skipChip.classList.remove('on'); skipChip.setAttribute('aria-pressed', 'false'); }
          if (k === 'snack' && food === '없음') {
            // '없음'은 배타 선택
            var turningOn = !chip.classList.contains('on');
            Array.prototype.forEach.call(block.querySelectorAll('.hchip'), function (c) { c.classList.remove('on'); });
            if (turningOn) chip.classList.add('on');
          } else {
            var noneChip = block.querySelector('.hchip[data-food="없음"]');
            if (noneChip) noneChip.classList.remove('on');
            chip.classList.toggle('on');
            if (chip.classList.contains('on')) foodBump(food);
          }
          recombineMeal(block, k, T());
        });
      });
      var ci = block.querySelector('.hcustomin');
      if (ci) {
        var commitCustom = function (learn) {
          if (moved(function (h) {
            var nb = newBlock(h), ni = nb && nb.querySelector('.hcustomin');
            if (ni && ci.value !== ci.defaultValue) { ni.value = ci.value; fire(ni, 'change'); }   // 이 화면에서 새로 친 글만 옮긴다
          })) return;
          if (learn) mealTokens(ci.value).forEach(function (x) { if (!isSkip(x)) foodBump(x); });
          recombineMeal(block, k, T());
        };
        ci.addEventListener('change', function () { commitCustom(true); });
        ci.addEventListener('blur', function () { commitCustom(false); });
      }
    });

    // 복약·영양제 원탭 토글 (null → 복용 → 미복용 → 복용 …)
    Array.prototype.forEach.call(host.querySelectorAll('.htogbtn'), function (btn) {
      var k = btn.getAttribute('data-k');
      btn.addEventListener('click', function () {
        if (moved(function (h) { var nb = h.querySelector('.htogbtn[data-k="' + k + '"]'); if (nb) nb.click(); })) return;
        var t = T(), v = t[k];
        setField(t, k, (v === null || v === undefined) ? true : (v === true ? false : true));
        btn.className = 'htogbtn ' + togCls(t[k]);
        btn.textContent = togTxt(t[k]);
        if (t === rec) refreshChk(k);
        scheduleSave(t);
      });
    });
  }
  function recombineMeal(block, k, t) {
    var chips = block.querySelectorAll('.hchip.on:not(.hskip)');
    var sel = [];
    Array.prototype.forEach.call(chips, function (c) { sel.push(c.getAttribute('data-food')); });
    var ci = block.querySelector('.hcustomin');
    if (ci) mealTokens(ci.value).forEach(function (x) { if (sel.indexOf(x) < 0) sel.push(x); });
    // v9.5.1: 「안 먹음」이 켜진 끼니 — 음식을 고르거나 적었으면 「안 먹음」을 풀고, 아무것도 없으면 「안 먹음」을 그대로 둔다(빈 입력 칸에서 손을 뗀 것만으로 지워지지 않게).
    var sk = block.querySelector('.hskip');
    if (sk && sk.classList.contains('on')) {
      if (sel.length) { sk.classList.remove('on'); sk.setAttribute('aria-pressed', 'false'); }
      else sel = [(t && skipOn(k, t[k])) ? t[k] : SKIP];
    }
    if (t === rec) openMeals[k] = 1;                // 고르는 중인 끼니는 다시 그려도 접지 않는다
    var ch = setField(t, k, sel.join(', ') || null);
    if (t === rec) refreshChk(k);
    if (ch) scheduleSave(t);
  }
  // v9.5.1(O-0386) 「안 먹음」 켜고 끄기. 켜면: 그 끼니 칸 = 「안 먹음」(적혀 있던 식단은 「안 먹음」으로 바뀐다) → 적은 칸으로 세고 한 줄로 접는다.
  //   끄면: 누르기 전 모습으로 돌아간다 — 비어 있던 끼니는 빈 칸, 식단이 적혀 있던 끼니는 그 식단(같은 화면에서 잘못 눌렀을 때 한 번 더 누르면 되돌아오게).
  //         칩이 펼쳐진 채 남아 바로 식단을 고를 수 있다. 9칸이 이 누름으로 막 찼으면 평소처럼 케이가 한마디 한다.
  function toggleSkip(k, t) {
    var on = !skipOn(k, t[k]), pk = t.log_date + '|' + k, nv = null;
    var before = (t === rec) ? recordedCount() : -1;
    if (on) { if (isSet(t[k])) skipPrev[pk] = t[k]; else delete skipPrev[pk]; nv = SKIP; }
    else { nv = isSet(skipPrev[pk]) ? skipPrev[pk] : null; delete skipPrev[pk]; }
    var ch = setField(t, k, nv);
    if (t === rec) {
      if (on) delete openMeals[k]; else openMeals[k] = 1;
      renderToday();
      // v9.6(O-0387 3번): 「안 먹음」을 켜 그 끼니가 한 줄로 접힌 순간 — 다른 칸과 같이 체크를 그린다(화면을 새로 그린 뒤라 접힌 줄의 체크를 찾아서)
      try { if (on && global.KMotion) { var hh = $('hToday'), ci = hh && hh.querySelector('.hmeal[data-k="' + k + '"] .hchk'); if (ci) global.KMotion.checkDraw(ci); } } catch (e) {}
      lastCount = before; paintSay(true);
    }
    if (ch) scheduleSave(t);
  }

  /* ============================ 기록 보기 ============================ */
  // 폰에만 있는(아직 안 올라간) 값을 서버 행 위에 얹어 보여 준다. 반환: {rows: 최신순, pend: {날짜: 1}}
  function overlayLocal(rows) {
    var by = {}, pend = {};
    rows.forEach(function (r) { by[r.log_date] = r; });
    pendList().forEach(function (d) {
      var l = (rec && rec.log_date === d) ? rec : loadLocal(d, d === todayStr());
      var dk = l ? dirtyKeys(l, false) : [];
      if (!dk.length) return;
      var o = {}, src = by[d] || { log_date: d }, k2;
      for (k2 in src) o[k2] = src[k2];
      dk.forEach(function (k) { o[k] = l[k]; });
      by[d] = o; pend[d] = 1;
    });
    var out = Object.keys(by).map(function (d) { return by[d]; });
    out.sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
    return { rows: out, pend: pend };
  }
  function renderHistory() {
    var host = $('hHistory'); if (!host) return;
    host.innerHTML = '<div class="empty-note">기록을 가져오고 있습니다…</div>';
    var to = todayStr(), from = daysAgoStr(HIST_DAYS - 1);
    listRange(from, to, false).then(function (rows) {
      rangeRows = rows.slice().sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
      lastRemember();
      drawHistory(false);
    }, function (e) { drawHistory(true, isCut(e)); });
  }
  // failed=true 면 서버에서 못 읽은 것. cut=true 는 그 까닭이 연결 끊김(요청이 못 나감)일 때만.
  function kEmpty(pose, text) { return global.KScene ? global.KScene.emptyHtml(pose, text) : '<div class="empty-note">' + esc(text) + '</div>'; }
  function drawHistory(failed, cut) {
    var host = $('hHistory'); if (!host) return;
    var ov = overlayLocal(failed ? [] : rangeRows), rows = ov.rows;
    var html = '';
    // v9.4: 못 불러왔을 때는 케이가 사과하고, 빈 화면은 케이가 안내한다. 폰에 적어 둔 것이 있으면(아래 목록이 있으면) 짧은 한 줄만.
    var sorry = '죄송합니다, ' + (cut ? '연결이 끊겨 ' : '') + '기록을 불러오지 못했습니다.';
    if (!rows.length) {
      host.innerHTML = failed ? kEmpty('sorry', sorry + ' 「기록 보기」를 다시 눌러 주세요.')
        : kEmpty('guide', '아직 적으신 기록이 없습니다. 「오늘 기록」에서 몇 가지만 눌러 보세요.');
      return;
    }
    if (failed) html += '<div class="empty-note">' + esc(sorry + ' ' + (isNative() ? '폰' : '이 기기') + '에 적어 둔 것만 보여 드립니다.') + '</div>';
    // rows: 최신순. 그래프는 과거→현재(오름차순)로.
    var asc = rows.slice().sort(function (a, b) { return a.log_date < b.log_date ? -1 : 1; });
    var gluc = asc.filter(function (r) { return isSet(r.fasting_glucose); }).map(function (r) { return { d: r.log_date, v: +r.fasting_glucose }; });
    var wt = asc.filter(function (r) { return isSet(r.weight); }).map(function (r) { return { d: r.log_date, v: +r.weight }; });
    if (!failed) {
      html += chartCard('공복혈당', 'mg/dL', gluc, '#22D3EE', [70, 140]);
      html += chartCard('체중', 'kg', wt, '#8B5CF6', null, 4);   // 최소 y축 폭 4kg: 미세 변동이 절벽처럼 과장되지 않게
    }
    html += '<div class="hsec">날짜별 기록 <small>날짜를 누르면 그날 기록을 고칠 수 있습니다</small></div><div class="list hlist">';
    // 최근 GAP_DAYS 일 안에서 통째로 빠진 날도 줄로 보여 준다(눌러서 적기) — 오늘은 「오늘 기록」 탭이 있으니 제외
    var have = {}, list = rows.slice(), t = todayStr();
    rows.forEach(function (r) { have[r.log_date] = 1; });
    if (!failed) {
      for (var i = 1; i <= GAP_DAYS; i++) { var gd = daysAgoStr(i); if (!have[gd]) list.push({ log_date: gd, _gap: 1 }); }
      list.sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
    }
    list.forEach(function (r) { html += r._gap ? gapRow(r.log_date) : dayRow(r, !!ov.pend[r.log_date], r.log_date === t); });
    html += '</div>';
    host.innerHTML = html;
    Array.prototype.forEach.call(host.querySelectorAll('.hday[data-date]'), function (b) {
      b.addEventListener('click', function () { openDate(b.getAttribute('data-date')); });
    });
  }
  function dayRow(r, pend, isToday) {
    var bits = [];
    if (isSet(r.fasting_glucose)) bits.push('<span class="hb glu">혈당 ' + esc(r.fasting_glucose) + '</span>');
    if (isSet(r.weight)) bits.push('<span class="hb wt">체중 ' + esc(r.weight) + '</span>');
    if (isSet(r.sleep_hours)) bits.push('<span class="hb">수면 ' + esc(fmtSleep(+r.sleep_hours)) + '</span>');
    var med = [];
    if (r.med_morning === true) med.push('아침'); if (r.med_evening === true) med.push('저녁');
    if (med.length) bits.push('<span class="hb ok">약 ' + med.join('·') + '</span>');
    if (r.supplement === true) bits.push('<span class="hb ok">영양제</span>');
    // v9.5.1: 「안 먹음」 끼니는 어느 끼니인지 붙여 적는다(「아침 안 먹음」) — 음식 이름 사이에서 뜻이 헷갈리지 않게
    var meals = [];
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach(function (mk) {
      var m = r[mk]; if (!isSet(m)) return;
      meals.push(skipOn(mk, m) ? SHORT[mk] + ' ' + String(m).replace(/^\s+|\s+$/g, '') : m);
    });
    var mealLine = meals.length ? '<div class="hday-meal">' + esc(meals.join(' / ')) + '</div>' : '';
    return '<button type="button" class="card hday" data-date="' + esc(r.log_date) + '" aria-label="' + esc(fmtDayShort(r.log_date)) + ' 기록 ' + (isToday ? '열기' : '고치기') + '">' +
      '<div class="hday-top"><b>' + esc(fmtDayLabel(r.log_date)) + '</b>' +
      '<span class="hday-r">' + (pend ? '<em class="hpend on">' + esc(hereWord()) + '</em>' : '') + '<svg class="hday-chev"><use href="#i-chev-r"/></svg></span></div>' +
      (bits.length ? '<div class="hbadges">' + bits.join('') + '</div>' : '<div class="hday-meal" style="color:var(--dim)">기록 일부만</div>') +
      mealLine + '</button>';
  }
  function gapRow(dateStr) {
    return '<button type="button" class="card hday hgap" data-date="' + esc(dateStr) + '" aria-label="' + esc(fmtDayShort(dateStr)) + ' 기록 적기">' +
      '<div class="hday-top"><b>' + esc(fmtDayLabel(dateStr)) + '</b>' +
      '<span class="hday-r"><span class="hgap-tx">기록 없음 · 눌러서 적기</span><svg class="hday-chev"><use href="#i-chev-r"/></svg></span></div></button>';
  }
  // 순수 SVG 라인 차트(외부 라이브러리 없음). pts: [{d,v}], fixRange: [min,max] 또는 null(자동).
  function chartCard(title, unit, pts, color, fixRange, minSpan) {
    var head = '<div class="hchart-h"><span>' + title + ' <small>' + unit + '</small></span>';
    if (!pts.length) return '<div class="card hchart">' + head + '</div><div class="hchart-empty">아직 ' + title + ' 기록이 없습니다.</div></div>';
    var last = pts[pts.length - 1];
    head += '<b class="hchart-last">' + last.v + '<small> ' + unit + '</small></b></div>';
    var W = 320, H = 120, PADL = 34, PADR = 8, PADT = 12, PADB = 20;
    var vals = pts.map(function (p) { return p.v; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (fixRange) { mn = Math.min(mn, fixRange[0]); mx = Math.max(mx, fixRange[1]); }
    if (mn === mx) { mn -= 1; mx += 1; }
    // 최소 y축 폭 확보: 데이터 변동이 아주 작아도 절벽처럼 과장돼 보이지 않게(2026-09-20)
    if (minSpan && (mx - mn) < minSpan) { var mid = (mn + mx) / 2; mn = mid - minSpan / 2; mx = mid + minSpan / 2; }
    var pad = (mx - mn) * 0.12; mn -= pad; mx += pad;
    var n = pts.length;
    function X(i) { return PADL + (n === 1 ? (W - PADL - PADR) / 2 : (i * (W - PADL - PADR) / (n - 1))); }
    function Y(v) { return PADT + (mx - v) / (mx - mn) * (H - PADT - PADB); }
    var d = '', dots = '';
    pts.forEach(function (p, i) {
      d += (i === 0 ? 'M' : 'L') + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1) + ' ';
      dots += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.6" fill="' + color + '"/>';
    });
    // y축 눈금 2개(최소/최대 근사)
    var yTop = Math.round(mx), yBot = Math.round(mn);
    var grid =
      '<line x1="' + PADL + '" y1="' + PADT + '" x2="' + (W - PADR) + '" y2="' + PADT + '" class="hgrid"/>' +
      '<line x1="' + PADL + '" y1="' + (H - PADB) + '" x2="' + (W - PADR) + '" y2="' + (H - PADB) + '" class="hgrid"/>' +
      '<text x="4" y="' + (PADT + 4) + '" class="hax">' + yTop + '</text>' +
      '<text x="4" y="' + (H - PADB + 4) + '" class="hax">' + yBot + '</text>';
    var area = 'M' + X(0).toFixed(1) + ' ' + (H - PADB) + ' ' +
      pts.map(function (p, i) { return 'L' + X(i).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ') +
      ' L' + X(n - 1).toFixed(1) + ' ' + (H - PADB) + ' Z';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="hsvg" preserveAspectRatio="none">' +
      grid +
      '<path d="' + area + '" fill="' + color + '" opacity="0.10"/>' +
      '<path d="' + d.trim() + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + '</svg>';
    return '<div class="card hchart">' + head + svg +
      '<div class="hchart-foot">최근 ' + n + '일 · ' + fmtDayLabel(pts[0].d).replace(/ · .*/, '') + ' → ' + fmtDayLabel(last.d).replace(/ · .*/, '') + '</div></div>';
  }

  /* ============================ 탭 전환 / 진입 ============================ */
  // which: 'today'(오늘 입력) | 'history'(기록 보기 목록) | 'past'(지난 날짜 고치는 중 — 입력 화면이지만 「기록 보기」 쪽 불을 켠다)
  function switchTab(which) {
    var tT = $('hTabToday'), tH = $('hTabHistory'), pT = $('hToday'), pH = $('hHistory');
    var histOn = which !== 'today', listOn = which === 'history';
    if (tH) tH.classList.toggle('on', histOn);
    if (tT) tT.classList.toggle('on', !histOn);
    if (pT) pT.style.display = listOn ? 'none' : '';
    if (pH) pH.style.display = listOn ? '' : 'none';
    if (listOn) renderHistory();
  }

  function init(opts) {
    if (opts && opts.toast) _toast = opts.toast;
    if (inited) return;
    inited = true;
    if ($('hTabToday')) $('hTabToday').addEventListener('click', function () { open(); });
    if ($('hTabHistory')) $('hTabHistory').addEventListener('click', function () { flushSaveTimer(); switchTab('history'); });
    // 밀린 칸 자동으로 다시 올리기: 연결이 돌아왔을 때 · 앱으로 돌아왔을 때 · 앱을 켰을 때(조금 뒤)
    //   앱으로 돌아올 때마다 날짜가 넘어갔는지부터 본다(밤새 뒤에 있다가 아침에 다시 연 경우 — 어제 날짜에 오늘 것을 적지 않게).
    global.addEventListener('online', wake);
    var onBack = function () { if (document.hidden) return; dayCheck(); wake(); };
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } return; }
      onBack();
    });
    global.addEventListener('focus', onBack);
    global.addEventListener('pageshow', onBack);
    document.addEventListener('resume', onBack);                                   // 폰 앱(Capacitor)이 앞으로 돌아올 때
    try {
      var CA = global.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
      if (CA && CA.addListener) CA.addListener('appStateChange', function (st) { if (st && st.isActive) onBack(); });
    } catch (e) {}
    armMidnight();
    setTimeout(function () { if (pendList().length) flush(); }, 4000);
  }

  /* ---------- 날짜 넘어감 ----------
   * 화면 맨 위 날짜와 실제 저장 날짜는 늘 같은 값(rec.log_date)이다. 문제는 「오늘 기록」을 켜 둔 채 자정이 지나는 경우 —
   * 그 화면은 어제 날짜의 기록인데 「오늘」처럼 보인다. 그래서 ① 자정에 맞춘 타이머 ② 앱으로 돌아올 때 ③ 건강 탭을 다시 열 때(open)
   * ④ 값을 넣기 직전(bindToday 의 moved)에 확인해, 「오늘 기록」이었으면 안 올라간 것을 먼저 보내고 오늘 날짜로 새로 연다.
   * 「지난 날짜 고치는 중」은 일부러 고른 날짜라 그대로 둔다(「어제·그제」 꼬리표만 새로 그린다). */
  var paintedDay = '', midTimer = null;
  function dayCheck() {
    var t = todayStr();
    if (!rec || paintedDay === t) return false;
    if (!healthShown()) return false;               // 건강 화면 밖 — 다음에 열 때 open() 이 오늘로 연다
    var pT = $('hToday'), listOn = !!(pT && pT.style.display === 'none');
    if (listOn) { paintedDay = t; switchTab('history'); return true; }        // 기록 보기 목록: 「오늘·어제」 꼬리표를 새로
    if (mode === 'today' && rec.log_date !== t) { open(); return true; }      // open() 이 기다리던 저장을 먼저 보내고 오늘로 연다
    softRender();                                                             // 지난 날짜 고치는 중 — 날짜는 그대로
    return false;
  }
  function armMidnight() {
    if (midTimer) clearTimeout(midTimer);
    midTimer = setTimeout(function () { try { dayCheck(); wake(); } catch (e) {} armMidnight(); }, msToMidnight() + 1500);
  }

  // 서버의 최근 30일을 한 번 받아: 지금 날짜의 값 맞추기 + ＋/− 시작값 + 기록 보기 사본
  function refreshFromServer() {
    var r = rec, ds = rec.log_date;
    listRange(daysAgoStr(HIST_DAYS - 1), todayStr(), false).then(function (rows) {
      rangeRows = rows.slice().sort(function (a, b) { return a.log_date < b.log_date ? 1 : -1; });
      lastRemember();
      if (rec !== r) return;
      var res = applyServer(r, findRow(ds));
      persist(r);
      tellLost(res.lost, ds);
      softRender();                                 // 값이 안 바뀌었어도 「지난 기록」 안내는 새로 그린다
      if (res.push.length) syncDate(ds).then(function (st) { if (st === 'pending') flush(); });
    }, function (e) {
      lastFail = failKind(e);
      if (rec === r) paintState();
      if (pendList().length && lastFail === 'net') flush();
    });
  }

  // 화면이 열릴 때 호출: 폰에 적어 둔 값으로 즉시 렌더 → 서버 값과 맞춤
  function open() {
    flushSaveTimer();
    var ds = todayStr();
    rec = loadLocal(ds, true) || blankRecord(ds);
    mode = 'today'; openMeals = {}; skipPrev = {};
    switchTab('today');
    renderToday();
    refreshFromServer();
  }
  // 지난 날짜 고치기: 「기록 보기」의 날짜 줄에서 연다. 최근 30일 안 · 미래 불가. 오늘 날짜면 그냥 「오늘 기록」.
  function openDate(ds) {
    var t = todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || '')) return;
    if (ds === t) { open(); return; }
    if (ds > t) { _toast('아직 오지 않은 날짜는 적을 수 없습니다.'); return; }
    if (ds < daysAgoStr(HIST_DAYS - 1)) { _toast('최근 30일 안의 날짜만 고칠 수 있습니다.'); return; }
    flushSaveTimer();
    var r = loadLocal(ds, false) || blankRecord(ds);
    var row = findRow(ds);
    if (row) applyServer(r, row);                   // 방금 본 목록의 값으로 먼저 그리고
    rec = r; mode = 'past'; openMeals = {}; skipPrev = {};
    switchTab('past');
    renderToday();
    try { global.scrollTo(0, 0); } catch (e) {}
    listOne(ds, false).then(function (fresh) {      // 그날 행을 한 번 더 읽어 맞춘다(다른 기기에서 그 사이 고쳤을 수 있다)
      putRow(fresh);
      if (rec !== r) return;
      var res = applyServer(r, fresh);
      persist(r);
      tellLost(res.lost, ds);
      if (res.changed) softRender(); else paintState();
      if (res.push.length) syncDate(ds).then(function (st) { if (st === 'pending') flush(); });
    }, function (e) { lastFail = failKind(e); if (rec === r) paintState(); });
  }

  // 연동 암호를 막 넣었을 때(app.js): 지난 날짜를 고치던 중이면 그 화면에 머문 채 다시 올리고, 아니면 오늘 기록을 다시 불러온다.
  function resume() {
    if (mode === 'past' && rec) { lastFail = ''; paintState(); wake(); return; }
    open();
  }
  // [뒤로](화면 단추·폰 뒤로가기): 지난 날짜를 고치던 중이면 「기록 보기」 목록으로 한 단계만 돌아간다(true). 그 밖에는 app.js 가 홈으로 보낸다(false).
  function back() {
    var pT = $('hToday');
    if (mode === 'past' && rec && pT && pT.style.display !== 'none') {
      flushSaveTimer(); switchTab('history');
      return true;
    }
    return false;
  }

  global.HealthTab = { init: init, open: open, openDate: openDate, flush: wake, resume: resume, back: back };
})(window);

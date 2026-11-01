/* promotion-calc.js — 「승진」 점수판의 계산 (v9.62, O-0684 후속) · 순수 함수만 (서버·화면·저장소 접근 없음)
 *
 * 규칙 숫자는 코드에 박지 않고 서버 표 promo_rules 에서 받은 rules 객체로 읽는다(개인 실적과 분리 · 규정 개정 때 일부만 갱신).
 * 이 파일에는 「계산 방식」만 있다 — 이름·생년월일·실제 점수·논문 제목은 들어 있지 않다.
 *
 * 계산 방식 두 가지
 *   'official' (화면 기본): 규정 문서 방식 — 점수 끝자리 반올림, 보직은 「재임 개월 비율」을 소수 둘째 자리에서 내림,
 *                           5인 이상 공동실적은 100/n % 를 반올림(소수 둘째 자리), 현 직급 시작일 이후만 인정(부분 인정)
 *   'legacy'  (가져오기 점검·시험 전용): 예전 승진 앱(러버블 scoring.ts)과 한 줄씩 같은 계산(끝자리 버림) — 화면에는 내지 않는다
 *
 * 쓰는 곳: promotion.js(화면) · 시험(node). 브라우저에서는 window.PromoCalc, node 에서는 module.exports.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PromoCalc = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  /* ---------- 숫자·날짜 도우미 ---------- */
  function trunc2(x) { return Math.floor((x + 1e-9) * 100) / 100; }
  function round2(x) { return Math.round((x + 1e-9) * 100) / 100; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function mi(y, m) { return y * 12 + (m - 1); }                       // 월 지수
  function miY(i) { return Math.floor(i / 12); }
  function miM(i) { return (i % 12) + 1; }
  function parseDay(s) {                                                // 'YYYY-MM-DD' → {y,m,d} (잘못되면 null)
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    var o = { y: +m[1], m: +m[2], d: +m[3] };
    if (o.m < 1 || o.m > 12 || o.d < 1 || o.d > 31) return null;
    return o;
  }
  function dayNum(o) { return o.y * 10000 + o.m * 100 + o.d; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function epochDay(o) { return Math.floor(Date.UTC(o.y, o.m - 1, o.d) / 86400000); }
  function fmtDay(o) { return o ? (o.y + '.' + o.m + '.' + o.d) : ''; }
  function hakyeon(y, m) { return m >= 3 ? y : y - 1; }                  // 학년도: 3월 ~ 다음해 2월
  function semStart(ay, sem) { var y = parseInt(ay, 10); return isFinite(y) ? { y: y, m: String(sem) === '1' ? 3 : 9, d: 1 } : null; }
  function addYears(o, n) { return { y: o.y + n, m: o.m, d: Math.min(o.d, daysIn(o.y + n, o.m)) }; }
  function money(n) { return String(Math.round(n * 100) / 100); }

  /* ---------- 규칙 읽기 ---------- */
  function rulesOk(R) {
    return isObj(R) && isObj(R.targets) && isObj(R.pos) && isObj(R.paper) && isObj(R.co_rate) && isObj(R.lecture) && isObj(R.train) && isObj(R.tft) && isObj(R.qual);
  }
  function tgt(R, target) { return (R.targets && (R.targets[target] || R.targets[R.target_default || 'full'])) || {}; }

  function coRate(R, n, mode) {
    n = Math.floor(num(n));
    if (!n || n <= 1) return 1;
    var by = R.co_rate.by_n || {}, from = R.co_rate.inverse_from || 5;
    if (n < from) return by[String(n)] !== undefined ? by[String(n)] : 1;
    if (mode === 'legacy') return 1 / n;
    var d = Math.pow(10, R.co_rate.decimals || 2);
    return Math.round((100 / n + 1e-9) * d) / d / 100;                    // 100/n % 를 소수 둘째 자리까지 반올림
  }

  /* ---------- 항목 이름표 (화면용) ---------- */
  function subName(R, code, sub) { var m = R.sub_names && R.sub_names[code]; return (m && m[sub]) || ''; }
  function rowLabel(it, R) {
    var v = isObj(it.value) ? it.value : {}, c = it.item_code, s;
    if (c === '1-1') return (it.academic_year || '?') + '학년도 ' + (v.semester || '?') + '학기 · 강의 ' + (v.lectureAvg != null ? v.lectureAvg : '-') + ' · 지도 ' + (v.guidanceAvg != null ? v.guidanceAvg : '-');
    if (c === '1-2') return (it.academic_year || '?') + '학년도 ' + (v.semester || '?') + '학기 · ' + (v.courseName || '교수법 프로그램');
    if (c === '1-4') return (v.companyName || '(업체명 없음)') + ' · ' + (v.hours || 0) + '시간 · ' + (v.startYear || '?') + '.' + (v.startMonth || '?') + '.' + (v.startDay || '?') + '~';
    if (c === '1-6') return (it.academic_year || '') + ' PBL ' + (v.courses || 0) + '강좌';
    if (c === '3-1') {
      s = (v.positionName || subName(R, '3-1', it.sub_type) || '보직') + ' · ' + (v.startYear || '?') + '.' + (v.startMonth || '?') + '~' + (v.endYear || '?') + '.' + (v.endMonth || '?');
      return s;
    }
    if (c === '3-2' || c === '3-3') return v.title || '(이름 없음)';
    if (c === '4-1' || c === '4-2') return (v.title || '(제목 없음)') + (v.journal ? ' · ' + v.journal : '') + (v.pubYear ? ' · ' + v.pubYear + '.' + (v.pubMonth || '?') : '');
    return v.title || (R.names && R.names[c]) || c;
  }

  /* ---------- 보직 재임 개월 ---------- */
  function posRanges(rows) {
    return rows.map(function (r) {
      var v = r.v, sy = Math.floor(num(v.startYear)), sm = Math.floor(num(v.startMonth)), ey = Math.floor(num(v.endYear)), em = Math.floor(num(v.endMonth));
      if (sy <= 0 || sm <= 0 || ey <= 0 || em <= 0) return null;
      var a = mi(sy, sm), b = mi(ey, em);
      return b >= a ? { a: a, b: b } : null;
    });
  }
  /* 각 달을 기준점이 가장 높은 보직 한 곳에만 배정(겹치는 달 · 겸직은 높은 점수 하나만). low/high = 인정 월의 아래·위 경계(월 지수, 포함) */
  function positionMonths(rows, R, low, high) {
    var bases = rows.map(function (r) { return R.pos.base[r.sub] || 0; }), rng = posRanges(rows), eff = rows.map(function () { return 0; }), raw = rng.map(function (r) { return r ? r.b - r.a + 1 : 0; }), all = {}, i, m;
    var rc = rng.map(function (r) { if (!r) return null; var a = r.a, b = r.b; if (low !== null && low !== undefined) a = Math.max(a, low); if (high !== null && high !== undefined) b = Math.min(b, high); return b >= a ? { a: a, b: b } : null; });
    rc.forEach(function (r) { if (r) for (m = r.a; m <= r.b; m++) all[m] = 1; });
    Object.keys(all).forEach(function (k) {
      var mm = +k, best = -1, bi = -1;
      for (i = 0; i < rc.length; i++) if (rc[i] && rc[i].a <= mm && mm <= rc[i].b && bases[i] > best) { best = bases[i]; bi = i; }
      if (bi >= 0) eff[bi] += 1;
    });
    return { eff: eff, raw: raw, bases: bases };
  }
  /* 현 직급 시작일(S) 때문에 아래 경계가 되는 달 — 시작일이 달 중간이면 그 달 재임이 15일 이상일 때만 그 달부터 */
  function lowMonth(S, R) {
    if (!S) return null;
    var remain = daysIn(S.y, S.m) - S.d + 1, md = (R.pos && R.pos.min_days) || 15;
    return (S.d === 1 || remain >= md) ? mi(S.y, S.m) : mi(S.y, S.m) + 1;
  }

  /* ---------- 점수 계산 본체 ---------- */
  /* opts: { items, rules, target, mode:'official'|'legacy', cut:[y,m]|null (보직 인정 마지막 달, 포함), rankStart:'YYYY-MM-DD'|null } */
  function score(opts) {
    var R = opts.rules, mode = opts.mode === 'legacy' ? 'legacy' : 'official', T = tgt(R, opts.target), rnd = mode === 'legacy' ? trunc2 : round2;
    var S = mode === 'official' ? parseDay(opts.rankStart) : null;
    var high = opts.cut ? mi(opts.cut[0], opts.cut[1]) : null, low = lowMonth(S, R);
    var rows = [], by = {}, codeTot = {}, i, trainHoursVal = 0;
    (opts.items || []).forEach(function (it) {
      if (!it || it.deleted_at) return;
      var r = { id: it.id, it: it, code: it.item_code, sub: it.sub_type, ay: it.academic_year, n: Math.max(1, Math.floor(num(it.participants)) || 1), v: isObj(it.value) ? it.value : {}, flags: isObj(it.flags) ? it.flags : {},
        score: 0, part: null, status: 'in', reasons: [], months: null, monthsRaw: null };
      if (mode === 'official' && r.flags.excluded_default) { r.status = 'excluded'; r.reasons.push('기본은 점수에서 뺐어요(중복 의심)'); }
      rows.push(r);
      (by[r.code] = by[r.code] || []).push(r);
    });
    function live(code) { return (by[code] || []).filter(function (r) { return r.status !== 'excluded'; }); }
    function before(r, why) { r.status = 'before'; r.reasons.push(why || '현 직급 이전 실적'); r.score = 0; }
    function dayOK(y, m, d) { return !S || dayNum({ y: y, m: m, d: d }) >= dayNum(S); }

    /* 1-1 강의평가·학생지도평가 — 학기 단위 */
    (function () {
      var rs = live('1-1'); if (!rs.length) return;
      var use = rs.filter(function (r) { var st = S ? semStart(r.ay, r.v.semester) : null; if (S && st && dayNum(st) < dayNum(S)) { before(r, '현 직급이 아닌 기간이 든 학기'); return false; } return true; });
      if (!use.length) { codeTot['1-1'] = 0; return; }
      var pm = T.pos_max || 0, f = R.lecture.floor, sp = R.lecture.span, total;
      function side(avg) { return avg > f ? ((avg - f) / sp) * pm : 0; }
      if (mode === 'legacy') {
        var L = use.map(function (r) { return num(r.v.lectureAvg); }).filter(function (x) { return x > 0; }), G = use.map(function (r) { return num(r.v.guidanceAvg); }).filter(function (x) { return x > 0; });
        var la = L.length ? L.reduce(function (a, b) { return a + b; }, 0) / L.length : 0, ga = G.length ? G.reduce(function (a, b) { return a + b; }, 0) / G.length : 0;
        total = trunc2(side(la) * R.lecture.lecture_w + side(ga) * R.lecture.guidance_w);
        use.forEach(function (r) { r.part = null; });
      } else {
        var sum = 0;
        use.forEach(function (r) {
          var l = num(r.v.lectureAvg), g = num(r.v.guidanceAvg), full = (parseInt(r.ay, 10) || 9999) <= R.lecture.full_until_ay;
          var s1 = (full || g <= 0) ? side(l) : side(l) * R.lecture.lecture_w + side(g) * R.lecture.guidance_w;     // 지도평가가 없거나 2021학년도 이전은 강의평가 100%
          r.part = round2(s1); sum += s1;
        });
        total = round2(sum / use.length);
      }
      codeTot['1-1'] = total;
    })();

    /* 1-2 교수법 프로그램 — 학기 단위 */
    live('1-2').forEach(function (r) {
      var st = S ? semStart(r.ay, r.v.semester) : null;
      if (S && st && dayNum(st) < dayNum(S)) { before(r, '현 직급이 아닌 기간이 든 학기'); return; }
      r.score = r.v.ran === 'yes' ? R.programs : 0;
    });
    /* 1-3 저서·콘텐츠 / 1-5 유치금 / 1-6 PBL */
    live('1-3').forEach(function (r) { r.score = Math.min(rnd((R.book[r.sub] || 0) * coRate(R, r.n, mode)), 70); });
    (function () {
      var rs = live('1-5'); if (!rs.length) return;
      var t = 0; rs.forEach(function (r) { r.score = Math.floor(num(r.v.amount) / R.donation.per); t += r.score; });
      codeTot['1-5'] = Math.min(t, R.donation.max);
    })();
    (function () {
      var rs = live('1-6'); if (!rs.length) return;
      if (mode === 'legacy') { rs.forEach(function (r) { r.score = Math.min(num(r.v.courses) * R.pbl.per, R.pbl.max); }); return; }
      var t = 0; rs.forEach(function (r) { r.score = num(r.v.courses) * R.pbl.per; t += r.score; });
      codeTot['1-6'] = Math.min(t, R.pbl.max);
    })();
    /* 1-4 산업체 현장연수 — 연수 시작일이 현 직급 이후, 학년도(공식)/달력연도(예전 앱)별 70시간까지, 합계가 기준 시간 이상이면 50점 */
    (function () {
      var rs = live('1-4'); if (!rs.length) return;
      var use = rs.filter(function (r) { if (!dayOK(num(r.v.startYear), num(r.v.startMonth), num(r.v.startDay) || 1)) { before(r, '현 직급 이전 연수'); return false; } return true; });
      var byY = {}, eff = {}, tot = 0;
      use.forEach(function (r) { var y = mode === 'legacy' ? num(r.v.startYear) : hakyeon(num(r.v.startYear), num(r.v.startMonth)); (byY[y] = byY[y] || []).push(r); });
      Object.keys(byY).forEach(function (y) {
        var rem = R.train.year_cap_hours;
        byY[y].forEach(function (r) { var h = Math.min(Math.max(0, num(r.v.hours)), rem); rem -= h; eff[r.id] = h; tot += h; });
      });
      var meets = tot >= T.train_hours, den = tot > 0 ? tot : 1;
      use.forEach(function (r) { r.score = meets ? rnd(R.train.points * (eff[r.id] || 0) / den) : 0; });
      trainHoursVal = tot;
    })();
    /* 2-1 수탁 연구비 · 2-2 자문 — 학년도별 50점 상한 */
    ['2-1', '2-2'].forEach(function (code) {
      var rs = live(code); if (!rs.length) return;
      var per = (code === '2-1' ? R.grant : R.consult), g = {};
      rs.forEach(function (r) { r.score = Math.floor(num(r.v.amount) / per.per); (g[r.ay || '_'] = g[r.ay || '_'] || []).push(r); });
      Object.keys(g).forEach(function (k) {
        var sum = g[k].reduce(function (a, r) { return a + r.score; }, 0);
        if (sum > per.year_max) g[k].forEach(function (r) { r.score = rnd(r.score * per.year_max / sum); });
      });
    });
    /* 3-1 보직 — 월 단위. 규정 방식: 재임 개월 비율을 소수 둘째 자리에서 내림(80점×0.41). 시작일 이전 달·마감 달 이후 달은 안 셈 */
    (function () {
      var rs = live('3-1'); if (!rs.length) return;
      var pm = positionMonths(rs, R, low, high), pA = positionMonths(rs, R, null, null), pB = positionMonths(rs, R, low, null);
      rs.forEach(function (r, k) {
        var ratio = pm.eff[k] / R.pos.months;
        if (mode === 'official') ratio = Math.floor(ratio * 100 + 1e-9) / 100;
        r.score = rnd(pm.bases[k] * ratio); r.months = pm.eff[k]; r.monthsRaw = pm.raw[k];
        r.startLoss = pA.eff[k] - pB.eff[k]; r.futureLoss = pB.eff[k] - pm.eff[k];      // 현 직급 시작 때문에 빠진 달 / 아직 안 온 달
        if (mode !== 'official') return;
        if (pA.eff[k] === 0 && pm.raw[k] > 0) r.reasons.push('겹치는 달은 점수가 더 높은 보직 한 곳만 인정해요');
        if (r.startLoss > 0) { r.status = 'partial'; r.reasons.push('현 직급 시작 이전 ' + r.startLoss + '개월은 빼고 ' + pB.eff[k] + '개월'); }
        if (r.futureLoss > 0) r.reasons.push('아직 안 온 ' + r.futureLoss + '개월은 아직 안 셌어요(신청 마감 달까지 채우면 올라가요)');
      });
    })();
    /* 3-2 TFT · 3-3 정책연구 */
    live('3-2').forEach(function (r) {
      if (S && !dayOK(num(r.v.endYear) || num(r.v.startYear), num(r.v.endMonth) || num(r.v.startMonth) || 12, 28)) { before(r, '현 직급 이전 실적'); return; }
      r.score = R.tft[r.sub] || 0;
    });
    live('3-3').forEach(function (r) {
      if (S && r.v.endYear && !dayOK(num(r.v.endYear), num(r.v.endMonth) || 12, 28)) { before(r, '최종 완성이 현 직급 이전'); return; }
      if (!r.v.endYear && !r.v.completionYear) r.reasons.push('날짜가 없어요');
      r.score = R.policy_report;
    });
    /* 4부문 논문·지재권·공모 */
    function pubOK(r) { return !S || !r.v.pubYear || r.v.pubYear < 1900 || dayNum({ y: num(r.v.pubYear), m: num(r.v.pubMonth) || 12, d: 28 }) >= dayNum(S); }
    live('4-1').forEach(function (r) { if (!pubOK(r)) { before(r, '현 직급 이전 논문'); return; } r.score = Math.min(rnd(R.paper.sci * coRate(R, r.n, mode)), R.paper.sci); });
    live('4-2').forEach(function (r) { if (!pubOK(r)) { before(r, '현 직급 이전 논문'); return; } r.score = Math.min(rnd((R.paper.kci[r.sub] || 0) * coRate(R, r.n, mode)), 70); });
    live('4-3').forEach(function (r) { r.score = Math.min(rnd((R.ip[r.sub] || 0) * coRate(R, r.n, mode)), 70); });
    live('4-4').forEach(function (r) { r.score = Math.min(rnd((R.exhibit_intl[r.sub] || 0) * coRate(R, r.n, mode)), 70); });
    live('4-5').forEach(function (r) { r.score = Math.min(rnd((R.exhibit_dom[r.sub] || 0) * coRate(R, r.n, mode)), 50); });
    /* 5부문 수상 */
    ['5-1', '5-2', '5-3'].forEach(function (code) {
      live(code).forEach(function (r) {
        var base = R.award[code], cnt = Math.max(1, num(r.v.count) || 1), v = base * cnt;
        if (code !== '5-3') v = v * coRate(R, r.n, mode);
        r.score = Math.min(rnd(v), base);
      });
    });

    /* 항목 합계 → 부문 합계 */
    var sections = {};
    for (i = 1; i <= 5; i++) sections[i] = { raw: 0, used: 0, max: null, capped: false, has: false };
    var codes = Object.keys(by);
    codes.forEach(function (code) {
      var rs = by[code], t;
      if (codeTot[code] !== undefined) t = codeTot[code];
      else { t = 0; rs.forEach(function (r) { t += r.score; }); }
      var s = parseInt(code.charAt(0), 10);
      sections[s].raw += t; sections[s].has = true;
      by[code]._total = rnd(t);
    });
    var cappedSecs = { 2: 1, 4: 1, 5: 1 };
    for (i = 1; i <= 5; i++) {
      var sc = sections[i]; sc.raw = rnd(sc.raw);
      if (cappedSecs[i]) { sc.max = T.sec_cap; sc.used = rnd(Math.min(sc.raw, T.sec_cap)); sc.capped = sc.raw > T.sec_cap; }
      else sc.used = sc.raw;
    }
    var total = rnd(sections[1].used + sections[2].used + sections[3].used + sections[4].used + sections[5].used);
    var itemTotals = {}; codes.forEach(function (c) { itemTotals[c] = by[c]._total; });
    return { rows: rows, sections: sections, total: total, sec3: sections[3].used, itemTotals: itemTotals, trainHours: trainHoursVal, mode: mode };
  }

  /* ---------- 승진 시기 ---------- */
  function tenure(profile, R, today) {
    var S = parseDay(profile && profile.rank_start), td = parseDay(today);
    var o = { state: 'unknown', start: S, eligible: null, daysLeft: null, deadlineYear: null, years: R.tenure_years };
    if (!S) return o;
    var el = addYears(S, R.tenure_years), cand = { y: el.y, m: R.promo_month, d: R.promo_day };
    if (dayNum(cand) < dayNum(el)) cand = { y: el.y + 1, m: R.promo_month, d: R.promo_day };     // 6년을 채운 뒤 첫 9월 1일
    o.eligible = cand; o.deadlineYear = cand.y;
    if (td) o.daysLeft = epochDay(cand) - epochDay(td);
    o.state = (td && dayNum(td) >= dayNum(cand)) ? 'pass' : 'fail';
    return o;
  }

  /* ---------- 교수업적 순위 (부처장 재임 학년도는 평가에서 제외) ---------- */
  function exemptMonths(items, R) {
    var set = {}, subs = R.eval_exempt_sub_types || [];
    (items || []).forEach(function (it) {
      if (!it || it.deleted_at || it.item_code !== '3-1' || subs.indexOf(it.sub_type) < 0) return;
      var rg = posRanges([{ v: isObj(it.value) ? it.value : {} }])[0]; if (!rg) return;
      for (var m = rg.a; m <= rg.b; m++) set[m] = 1;
    });
    return set;
  }
  function yearCover(set, ay) {           // 학년도 ay(3월~다음해 2월)에서 제외 보직이 겹치는 달 수
    var n = 0; for (var k = 0; k < 12; k++) if (set[mi(ay, 3) + k]) n++;
    return n;
  }
  function facultyEval(profile, items, R) {
    var list = Array.isArray(profile && profile.faculty_eval) ? profile.faculty_eval : [], ex = exemptMonths(items, R), used = [], skipped = [], S = parseDay(profile && profile.rank_start);
    list.forEach(function (e) {
      var ay = parseInt(e && (e.ay !== undefined ? e.ay : e.year), 10), pct = Number(e && e.pct);
      if (!isFinite(ay) || !isFinite(pct)) return;
      var c = yearCover(ex, ay);
      if (c > 0) skipped.push({ ay: ay, pct: pct, cover: c, full: c === 12 });
      else used.push({ ay: ay, pct: pct });
    });
    var exYears = [], keys = Object.keys(ex).map(Number);
    if (keys.length) {
      var y0 = hakyeon(miY(Math.min.apply(null, keys)), miM(Math.min.apply(null, keys))), y1 = hakyeon(miY(Math.max.apply(null, keys)), miM(Math.max.apply(null, keys)));
      for (var y = y0; y <= y1; y++) { var cv = yearCover(ex, y); if (cv > 0) exYears.push({ ay: y, cover: cv, full: cv === 12 }); }
    }
    var avg = used.length ? used.reduce(function (a, e) { return a + e.pct; }, 0) / used.length : null;
    var mixed = [];                          // 현 직급 시작 이전 기간이 섞인 학년도(입력된 것만)
    if (S) used.forEach(function (e) { var st = { y: e.ay, m: 3, d: 1 }; if (dayNum(st) < dayNum(S)) mixed.push(e.ay); });
    return { state: avg === null ? 'unknown' : (avg <= R.eval_max_pct ? 'pass' : 'fail'), avg: avg, used: used, skipped: skipped, exYears: exYears, partialYears: exYears.filter(function (e) { return !e.full; }), mixed: mixed, max: R.eval_max_pct };
  }

  /* ---------- 책임저자 논문(필수 연구실적 자격) ---------- */
  function leadPapers(rows, rules) {
    var out = [];
    rows.forEach(function (r) {
      if ((r.code !== '4-1' && !(r.code === '4-2' && r.sub === 'intl_kci')) || r.status !== 'in' || !r.v.isCorresponding) return;
      var ev = isObj(r.it.evidence) ? r.it.evidence : {}, jc = ev.journal_check === 'confirmed' ? 'confirmed' : (ev.journal_check === 'need' ? 'need' : 'asis');
      out.push({ id: r.id, code: r.code, title: r.v.title || '', journal: r.v.journal || '', check: jc, sci: r.code === '4-1', unverified: !!r.flags.unverified });
    });
    return out;
  }

  /* ---------- 점검할 것 ---------- */
  function buildChecks(ctx) {
    var R = ctx.rules, T = tgt(R, ctx.target), list = [], rows = ctx.today.rows, ten = ctx.tenure, fe = ctx.fe, profile = ctx.profile, items = ctx.items;
    /* 1. 현장연수 단위 */
    var tr = rows.filter(function (r) { return r.code === '1-4' && r.status === 'in'; });
    if (tr.length) {
      var hours = ctx.today.trainHours, days = tr.reduce(function (a, r) { return a + num(r.v.hours) / 8; }, 0);
      list.push({ k: 'train_unit', level: 'check', title: '현장연수 기준 단위, 인사팀 확인이 필요해요',
        text: '임용규칙 별표 11은 「일수(' + T.label.replace(' 승진', '') + ' ' + T.train_days + '일)」, 세부 기준은 「시간(' + T.train_hours + '시간)」이라고 적혀 있어요. 입력된 ' + tr.length + '건은 ' + hours + '시간(= ' + money(days) + '일)이라 시간 기준은 ' + (hours >= T.train_hours ? '통과' : '미달') + ', 일수 기준은 ' + (days >= T.train_days ? '통과' : '미달(' + R.train.points + '점이 0점)') + '이에요.' });
    }
    /* 2. 시작일 */
    if (!ten.start) list.push({ k: 'start_missing', level: 'check', title: '현 직급 시작일이 입력 전이에요', text: '시작일이 있어야 현 직급 이전 실적을 거르고 승진임용 가능일을 계산해요. 승진 시기 칸에서 입력해 주세요.' });
    /* 3. 교수업적 순위 */
    if (fe.mixed.length && ten.start) {
      fe.mixed.forEach(function (ay) {
        var beforeMonths = Math.max(0, mi(ten.start.y, ten.start.m) - mi(ay, 3));
        list.push({ k: 'eval_mixed', level: 'check', title: '교수업적 순위: ' + ay + '학년도에 현 직급 이전 기간이 섞여 있어요',
          text: ay + '학년도(' + ay + '.3~' + (ay + 1) + '.2) 안에 현 직급 시작(' + fmtDay(ten.start) + ') 이전 ' + beforeMonths + '개월이 들어 있어요. 규정(세부기준 공통 6)은 현 직급이 아닌 기간이 든 학년도의 평가를 반영하지 않는다고 하는데, 부교수 승진 직후 학년도를 어떻게 보는지 인사팀 확인이 필요해요. 지금은 대표님 말씀대로 ' + ay + '학년도 값을 반영했어요.' });
      });
    }
    if (fe.partialYears.length) list.push({ k: 'eval_partial', level: 'check', title: '부처장 재임이 학년도 일부만 걸치는 학년도가 있어요',
      text: fe.partialYears.map(function (e) { return e.ay + '학년도(' + e.cover + '개월)'; }).join(', ') + ' — 일부만 걸쳐도 그 학년도 평가를 빼는지 인사팀 확인이 필요해요. 지금은 일부만 걸쳐도 뺀다고 봤어요.' });
    /* 4. 중복 의심 */
    var dup = rows.filter(function (r) { return r.flags.dup_suspect; });
    if (dup.length) list.push({ k: 'dup_suspect', level: 'check', title: '중복 의심 논문 ' + dup.length + '건 — 기본은 점수에서 뺐어요', text: dup.map(function (r) { return '「' + (r.v.title || '') + '」 ' + (r.v.pubYear || '') + '.' + (r.v.pubMonth || ''); }).join(' / ') + ' — 실적 탭에는 한 편이에요. 삭제하지 않았고 대표님 확인 뒤 확정해요.' });
    /* 5. 확인 전 */
    var unv = rows.filter(function (r) { return r.flags.unverified && r.status === 'in'; });
    if (unv.length) list.push({ k: 'unverified', level: 'check', title: '확인 전 논문 ' + unv.length + '편(점수에는 포함)', text: unv.map(function (r) { return '「' + (r.v.title || '') + '」'; }).join(' · ') + ' — 게재 여부·증명서를 나중에 확인하면 확정해요.' });
    /* 6. 같은 사업 연차별 중복 */
    var groups = {};
    rows.forEach(function (r) { if (r.flags.series && r.status !== 'excluded') { var k = r.code + '|' + r.flags.series; (groups[k] = groups[k] || []).push(r); } });
    var effect = 0, gtxt = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k]; if (g.length < 2) return;
      var each = g[0].score || 0, loss = each * (g.length - 1); effect += loss; gtxt.push(g[0].flags.series + ' ' + g.length + '건(' + R.names[g[0].code] + ')');
    });
    if (gtxt.length) list.push({ k: 'series_dup', level: 'check', title: '같은 사업의 연차별 실적 중복 의심', text: '규정 공통 13번은 같은 사업의 연차별 실적을 부문별로 1회만 인정한다고 해요. ' + gtxt.join(', ') + '. 엄격히 보면 최대 −' + money(effect) + '점이고 합격에는 영향이 없어요. 자동으로 깎지는 않았고 표시만 해요.', effect: effect });
    /* 7. 임기 확인됨 */
    var conf = rows.filter(function (r) { return r.code === '3-1' && r.flags.term_confirmed; });
    if (conf.length) {
      var ev0 = isObj(conf[0].it.evidence) ? conf[0].it.evidence : {};
      list.push({ k: 'term_confirmed', level: 'ok', title: '보직 임기: 확인됨' + (ev0.term_confirmed_by ? '(' + ev0.term_confirmed_by + ')' : ''), text: conf.map(function (r) { return r.v.positionName || '보직'; }).join('·') + ' 임기' + (ev0.term_note ? ' — ' + ev0.term_note : '') + ' · 입력된 기간을 그대로 인정했어요.' });
    }
    /* 8. 교수법 2건 · 진행 중 학기 */
    var pr = rows.filter(function (r) { return r.code === '1-2' && r.status === 'in'; });
    if (pr.length >= 1) {
      var td = parseDay(ctx.todayStr), ing = pr.filter(function (r) { var st = semStart(r.ay, r.v.semester); if (!st || !td) return false; var en = st.m === 3 ? { y: st.y, m: 8, d: 31 } : { y: st.y + 1, m: 2, d: 28 }; return dayNum(td) >= dayNum(st) && dayNum(td) <= dayNum(en); });
      if (pr.length >= 2 || ing.length) list.push({ k: 'programs', level: 'check', title: '교수법 프로그램 ' + pr.length + '건: ' + (pr.length * R.programs) + '점(최대 ' + R.programs + '점일 수도 있음, ±' + ((pr.length - 1) * R.programs) + ')',
        text: (pr.length >= 2 ? '규정이 「' + R.programs + '점」만 말해서 합산인지 항목 최대인지 인사팀 확인이 필요해요. ' : '') + (ing.length ? '진행 중인 학기(' + ing.map(function (r) { return r.ay + '학년도 ' + r.v.semester + '학기'; }).join(', ') + ') 실적이 학기가 끝나기 전에 인정되는지도 확인이 필요해요.' : '') });
    }
    /* 9. 날짜 없는 정책연구 */
    var nd = rows.filter(function (r) { return r.code === '3-3' && r.status === 'in' && !r.v.endYear && !r.v.completionYear; });
    if (nd.length) list.push({ k: 'dates_missing', level: 'check', title: '날짜가 없는 정책연구 ' + nd.length + '건', text: '최종 완성일이 없으면 현 직급 기간 안인지 확인할 수 없어요. 증빙(보고서 표지·제출문)을 확인해 주세요.' });
    /* 10. 부분 인정 안내 */
    var part = rows.filter(function (r) { return r.status === 'partial' && r.code === '3-1' && r.startLoss > 0; });
    if (part.length) list.push({ k: 'partial', level: 'info', title: '경계 항목은 시작일 이후만 인정했어요', text: part.map(function (r) { return (r.v.positionName || '보직') + ' ' + r.monthsRaw + '개월 중 ' + (r.monthsRaw - r.startLoss) + '개월'; }).join(', ') + ' (재임 개월 비율로 계산).' });
    var bef = rows.filter(function (r) { return r.status === 'before'; });
    if (bef.length) list.push({ k: 'before', level: 'info', title: '현 직급 이전 실적 ' + bef.length + '건은 점수에 안 넣었어요', text: bef.map(function (r) { return rowLabel(r.it, R); }).join(' / ') });
    return list;
  }

  /* ---------- 판정 문장 ---------- */
  var CHECK_NAMES = { total: '총점', sec3: '대학발전', lead: '책임저자', eval: '교수업적 순위', tenure: '재직' };
  function sayText(ch, ten) {
    var fails = [], waits = [], k, order = ['total', 'sec3', 'lead', 'eval', 'tenure'];
    for (var i = 0; i < order.length; i++) { k = order[i]; if (ch[k].s === 'fail') fails.push(k); else if (ch[k].s === 'unknown') waits.push(CHECK_NAMES[k]); }
    var scoreOk = ch.total.s === 'pass' && ch.sec3.s === 'pass', lead = scoreOk ? '점수는 합격선을 넘었어요. ' : '';
    if (fails.length === 1 && fails[0] === 'tenure') return lead + '재직 6년은 아직이에요' + (ten && ten.eligible ? ' (' + fmtDay(ten.eligible) + ' 가능).' : '.') + (waits.length ? ' 아직 확인 전인 것: ' + waits.join(', ') + '.' : '');
    if (fails.length) return '부족한 것: ' + fails.map(function (x) { return CHECK_NAMES[x]; }).join(', ') + '.' + (waits.length ? ' 확인 전인 것: ' + waits.join(', ') + '.' : '');
    if (waits.length) return lead + '아직 확인 전인 것: ' + waits.join(', ') + '.';
    return '모든 요건을 채웠어요.';
  }

  /* ---------- 한 번에 계산 ---------- */
  /* opts: { items, profile, rules, today:'YYYY-MM-DD' } → 화면이 쓰는 모든 값 */
  function computeAll(opts) {
    var R = opts.rules, profile = opts.profile || {}, items = opts.items || [], td = parseDay(opts.today);
    if (!rulesOk(R)) return { error: 'RULES' };
    if (!td) return { error: 'TODAY' };
    var target = profile.target || R.target_default || 'full', T = tgt(R, target), rank = profile.rank_start || null;
    var dl = parseDay(profile.apply_deadline), todayCut = [td.y, td.m];
    if (dl && mi(dl.y, dl.m) < mi(td.y, td.m)) todayCut = [dl.y, dl.m];
    var expCut = dl ? [dl.y, dl.m] : null;
    var today = score({ items: items, rules: R, target: target, mode: 'official', cut: todayCut, rankStart: rank });
    var expected = score({ items: items, rules: R, target: target, mode: 'official', cut: expCut, rankStart: rank });
    /* 「예전 승진 앱보다 N점 적어요」 분해 */
    var L0 = score({ items: items, rules: R, target: target, mode: 'legacy', cut: null, rankStart: null });
    var L1 = score({ items: items, rules: R, target: target, mode: 'legacy', cut: todayCut, rankStart: null });
    var O1 = score({ items: items, rules: R, target: target, mode: 'official', cut: todayCut, rankStart: null });
    var legacyTotal = (profile.options && typeof profile.options.legacy_total === 'number') ? profile.options.legacy_total : L0.total;
    var parts = [{ label: '아직 안 온 보직 달', pts: round2(L0.total - L1.total) }, { label: '반올림·절사', pts: round2(L1.total - O1.total) }, { label: '현 직급 이전 실적', pts: round2(O1.total - today.total) }].filter(function (p) { return Math.abs(p.pts) >= 0.005; });
    var ten = tenure(Object.assign({}, profile, { rank_start: rank }), R, opts.today);
    var fe = facultyEval(profile, items, R);
    var lead = leadPapers(today.rows, R);
    var legacyCorr = 0; L0.rows.forEach(function (r) { if ((r.code === '4-1' || r.code === '4-2') && r.v.isCorresponding) legacyCorr += r.score; });
    var ch = {
      total: { s: today.total >= T.total ? 'pass' : 'fail', value: today.total, need: T.total },
      sec3: { s: today.sec3 >= T.sec3 ? 'pass' : 'fail', value: today.sec3, need: T.sec3 },
      lead: { s: (lead.length >= R.qual.min_lead_papers || profile.qual_manual) ? 'pass' : (today.rows.some(function (r) { return r.code === '4-1' || r.code === '4-2'; }) ? 'fail' : 'unknown'), papers: lead, legacyCorr: round2(legacyCorr) },
      eval: { s: fe.state, avg: fe.avg, used: fe.used, skipped: fe.skipped, exYears: fe.exYears, max: fe.max },
      tenure: { s: ten.state, eligible: ten.eligible, daysLeft: ten.daysLeft, start: ten.start }
    };
    var checks = buildChecks({ rules: R, target: target, today: today, tenure: ten, fe: fe, profile: profile, items: items, todayStr: opts.today });
    return {
      target: target, T: T, today: today, expected: expected, vsLegacy: { legacyTotal: legacyTotal, diff: round2(legacyTotal - today.total), parts: parts, computedLegacy: L0.total },
      checks: ch, tenure: ten, fe: fe, notes: checks, say: sayText(ch, ten), todayCut: todayCut, expCut: expCut,
      pass: { total: T.total, sec3: T.sec3, sec_cap: T.sec_cap }
    };
  }

  return {
    computeAll: computeAll, score: score, tenure: tenure, facultyEval: facultyEval, leadPapers: leadPapers, buildChecks: buildChecks, sayText: sayText, rowLabel: rowLabel, rulesOk: rulesOk,
    coRate: coRate, trunc2: trunc2, round2: round2, hakyeon: hakyeon, parseDay: parseDay, fmtDay: fmtDay, positionMonths: positionMonths, lowMonth: lowMonth, mi: mi, exemptMonths: exemptMonths, yearCover: yearCover, CHECK_NAMES: CHECK_NAMES
  };
});

/* pay.js — 「급여」 탭 (v10.17) · 「성과」 알약의 세 번째 칸
 * 월별 급여 명세서의 지급총액 · 공제총액 · 차인지급액(지급총액 − 공제 = 차인지급액)을 연도별·월별 표와 그래프로 본다.
 * 서버: 읽기 함수 pay_list 하나뿐(연동 암호 smart_sync_pass 확인). 쓰기 함수 없음 — 값은 PC 도구가 서버 비공개 표 pay_slips 에만 넣는다.
 * 🔒 금액은 폰에 저장하지 않는다: localStorage·IndexedDB·캐시에 쓰지 않고, 화면을 떠나면(leave) 메모리에서도 지운다.
 *    저장하는 것은 「금액 가리기」 켬/끔 한 칸뿐(금액이 아님). 이 파일에는 금액·이름·계좌가 없다.
 * 스위치: app.js 의 PAY_TAB('on'|'off') · PAY_CHART_ANIM. 진입점: 「성과」 알약의 「급여」 칸 하나뿐(홈에 칸을 더 만들지 않는다).
 * 앱은 명세서 숫자를 그대로 보여 줄 뿐, 좋고 나쁨을 평가하거나 조언하지 않는다. */
(function (global) {
  'use strict';
  var HIDE_KEY = 'smart_pay_hide_v1';
  var PAY_ORDER = ['봉급', '직무수당', '보직수당', '보직수당(겸무)', '학사지도비(반지도수당)', '가족수당', '가족수당(환수)', '관리업무수당', '직급보조비', '학비보조수당', '육아휴직수당'];
  var DED_ORDER = ['소득세', '지방소득세', '연금부담금', '건강보험료', '교직원공제회', '상조회비', '식대', '대여상환금', '서울교련회비', '국민연금', '고용보험', '경조비', '기타1', '기타2', '기타3'];
  var MASK = '•••••';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }

  var S = { play: false, rows: null, loading: false, err: null, hide: false, mode: 'month', year: '', sheet: null, showZero: false, token: 0, scrub: -1 };
  var _toast = function () {}, anim = true, built = false;
  try { S.hide = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) {}

  /* ---------- 서버 읽기(승진·실적 탭과 같은 방식) ---------- */
  function mkErr(msg, kind) { var e = new Error(msg); e.pay = true; e.kind = kind; return e; }
  function cfg() { return (global.OfficeBridge && global.OfficeBridge.CONFIG) || null; }
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function needPass(msg) { try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {} }
  function rpc(name) {
    var c = cfg(); if (!c) return Promise.reject(mkErr('NO_CONFIG', 'server'));
    var pass = syncPass(); if (!pass) { needPass('급여를 보려면 PC 연동 암호를 입력해 주십시오.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return global.fetch(c.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_pass: pass }), signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (tm) clearTimeout(tm);
      if (r.ok) return r.json();
      return r.text().then(function (t) {
        var kind = (/BAD_PASSCODE/.test(t) || /"code"\s*:\s*"28000"/.test(t)) ? 'badpass' : ((r.status === 404 || /PGRST202/.test(t)) ? 'notready' : 'server');
        if (kind === 'badpass') needPass('연동 암호가 맞지 않아 급여를 불러오지 못했습니다. 다시 입력해 주십시오.');
        throw mkErr(kind === 'badpass' ? 'BAD_PASSCODE' : 'HTTP_' + r.status, kind);
      });
    }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });
  }
  function errText(e) {
    if (!e) return '알 수 없는 오류입니다.';
    if (e.kind === 'badpass') return '연동 암호가 맞지 않습니다.';
    if (e.kind === 'net') return '인터넷에 연결되어야 급여를 볼 수 있습니다. (폰에는 금액을 저장하지 않습니다)';
    if (e.kind === 'notready') return '서버에 급여 기능이 아직 준비되지 않았습니다.';
    return '서버 오류입니다. 잠시 뒤 다시 해 주십시오.';
  }

  /* ---------- 자료 정리 ---------- */
  function num(v) { var n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
  function cleanRows(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var r = list[i]; if (!isObj(r) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(r.ym))) continue;
      out.push({ ym: String(r.ym), y: Number(String(r.ym).slice(0, 4)), m: Number(String(r.ym).slice(5, 7)), day: r.pay_day == null ? null : num(r.pay_day), rank: r.rank || '', gross: num(r.gross), ded: num(r.deduct_total), net: num(r.net),
        pay: isObj(r.pay_items) ? r.pay_items : {}, dedI: isObj(r.ded_items) ? r.ded_items : {}, verified: r.verified !== false });
    }
    out.sort(function (a, b) { return a.ym < b.ym ? -1 : (a.ym > b.ym ? 1 : 0); });
    return out;
  }
  function rowOk(r) { return r.gross - r.ded === r.net; }
  function yearsOf(rows) { var seen = {}, ys = [], i; for (i = 0; i < rows.length; i++) if (!seen[rows[i].y]) { seen[rows[i].y] = 1; ys.push(rows[i].y); } return ys; }   // 오름차순
  function rowsOfYear(rows, y) { return rows.filter(function (r) { return r.y === y; }); }
  function sumRows(rs) { var t = { gross: 0, ded: 0, net: 0, n: rs.length }, i; for (i = 0; i < rs.length; i++) { t.gross += rs[i].gross; t.ded += rs[i].ded; t.net += rs[i].net; } return t; }
  function sumItems(rs, key) { var o = {}, i, k; for (i = 0; i < rs.length; i++) for (k in rs[i][key]) if (Object.prototype.hasOwnProperty.call(rs[i][key], k)) o[k] = (o[k] || 0) + num(rs[i][key][k]); return o; }
  function orderKeys(obj, order) { var ks = Object.keys(obj), known = order.filter(function (k) { return ks.indexOf(k) >= 0; }), rest = ks.filter(function (k) { return order.indexOf(k) < 0; }); return known.concat(rest); }
  function ymLabel(r) { return r.y + '년 ' + r.m + '월'; }

  /* ---------- 글자 모양 ---------- */
  function won(n) { return S.hide ? MASK : (num(n).toLocaleString('ko-KR') + '원'); }
  function wonS(n) { if (S.hide) return MASK; n = num(n); return (n > 0 ? '+' : (n < 0 ? '−' : '')) + Math.abs(n).toLocaleString('ko-KR') + '원'; }
  function man(n) { return Math.round(n / 10000).toLocaleString('ko-KR'); }

  /* ---------- 화면 조각 ---------- */
  var EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12s3.8-7 10.5-7 10.5 7 10.5 7-3.8 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYEOFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19.5C5.3 19.5 1.5 12 1.5 12a19 19 0 0 1 4.6-5.7M9.9 4.6A10 10 0 0 1 12 4.5C18.7 4.5 22.5 12 22.5 12a19 19 0 0 1-2.4 3.4"/><path d="M1 1l22 22"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/></svg>';
  function eyeBtn() { return '<button type="button" class="pyeye" id="pyEye" aria-pressed="' + (S.hide ? 'true' : 'false') + '" aria-label="' + (S.hide ? '금액 보이기' : '금액 가리기') + '" title="' + (S.hide ? '금액 보이기' : '금액 가리기') + '">' + (S.hide ? EYEOFF : EYE) + '</button>'; }
  function check(r) { return rowOk(r) ? '<span class="pyok">✔ 지급총액 − 공제 = 차인지급액 맞음</span>' : '<span class="pybad">⚠ 지급총액 − 공제가 차인지급액과 다릅니다(확인 필요)</span>'; }
  function tag(r) { return r.verified ? '' : ' <span class="pytag">확인 전</span>'; }
  function unverNote(rs) { for (var i = 0; i < rs.length; i++) if (!rs[i].verified) return '<div class="pynote pyunv">‘확인 전’은 이번에 새로 들어온 달이라 명세서 원본과 한 번 더 맞춰 보기 전이라는 뜻입니다. 숫자는 명세서에서 읽은 그대로입니다.</div>'; return ''; }
  function unitLine() { return S.hide ? '' : '<div class="pyunit">단위: 만원</div>'; }
  function dayTxt(r) { return r.day ? ' (' + r.day + '일)' : ''; }

  function heroHtml(r) {
    return '<div class="pycard pyhero"><div class="pyhd"><span class="pyhdt">가장 최근 · ' + esc(ymLabel(r) + dayTxt(r)) + tag(r) + '</span>' + eyeBtn() + '</div>' +
      '<div class="pyl"><span>지급총액</span><b>' + won(r.gross) + '</b></div>' +
      '<div class="pyl"><span>공제</span><b>' + won(r.ded) + '</b></div>' +
      '<div class="pyl big"><span>차인지급액</span><b>' + won(r.net) + '</b></div>' +
      '<div class="pychk">' + check(r) + '</div>' + unverNote([r]) + '</div>';
  }
  function chipsHtml(ys) {
    var h = '<div class="pyctl"><div class="pychips" role="tablist" aria-label="보기 방식">' +
      '<button type="button" class="pychip' + (S.mode === 'month' ? ' on' : '') + '" data-mode="month" role="tab" aria-selected="' + (S.mode === 'month') + '">월별</button>' +
      '<button type="button" class="pychip' + (S.mode === 'year' ? ' on' : '') + '" data-mode="year" role="tab" aria-selected="' + (S.mode === 'year') + '">연도별</button></div>';
    if (S.mode === 'month') {
      h += '<div class="pyyears" role="tablist" aria-label="연도"><button type="button" class="pychip' + (S.year === 'all' ? ' on' : '') + '" data-year="all" role="tab" aria-selected="' + (S.year === 'all') + '">전체</button>';
      for (var i = ys.length - 1; i >= 0; i--) h += '<button type="button" class="pychip' + (String(ys[i]) === S.year ? ' on' : '') + '" data-year="' + ys[i] + '" role="tab" aria-selected="' + (String(ys[i]) === S.year) + '">' + ys[i] + '</button>';
      h += '</div>';
    }
    return h + '</div>';
  }
  function legendHtml(bars) {
    var sw = function (cls, dash) { return '<svg class="pysw" viewBox="0 0 26 10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" class="' + cls + '"' + (dash ? ' stroke-dasharray="6 4"' : '') + '/></svg>'; };
    if (bars) return '<div class="pylg"><span><i class="pyb net"></i>차인지급액</span><span><i class="pyb ded"></i>공제</span><span class="pylgn">두 칸을 합치면 지급총액</span></div>';
    return '<div class="pylg"><span>' + sw('pl-gross') + '지급총액</span><span>' + sw('pl-ded', true) + '공제</span><span>' + sw('pl-net') + '차인지급액</span></div>';
  }

  /* 월별 목록: 한 줄 = 월 + 세 열 (안 들어가면 fit() 이 두 줄 카드로 바꾼다) */
  function monthListHtml(rs) {
    var h = '<div class="pylist" id="payList"><div class="pyrow pyhdr" aria-hidden="true"><span></span><span>지급총액</span><span>공제</span><span>차인지급액</span></div>', i;
    for (i = rs.length - 1; i >= 0; i--) {
      var r = rs[i];
      h += '<button type="button" class="pyrow" data-ym="' + r.ym + '" aria-label="' + esc(ymLabel(r)) + ' 자세히 보기"><span class="pym">' + r.m + '월' + (r.day ? '<small>' + r.day + '일</small>' : '') + (r.verified ? '' : '<small class="pytag">확인 전</small>') + (rowOk(r) ? '' : '<small class="pybad">확인 필요</small>') + '</span>' +
        '<span class="pyc"><em>지급총액</em><b>' + won(r.gross) + '</b></span><span class="pyc"><em>공제</em><b>' + won(r.ded) + '</b></span><span class="pyc net"><em>차인지급액</em><b>' + won(r.net) + '</b></span></button>';
    }
    return h + '</div>';
  }
  function yearBlocks(rows) {
    var ys = yearsOf(rows), out = [], i;
    for (i = 0; i < ys.length; i++) { var rs = rowsOfYear(rows, ys[i]), t = sumRows(rs); out.push({ y: ys[i], rs: rs, t: t, avgNet: t.net / t.n, partial: t.n !== 12 }); }
    return out;
  }
  function yearListHtml(blocks) {
    var h = '<div class="pylist" id="payList"><div class="pyrow pyhdr" aria-hidden="true"><span></span><span>지급총액 합</span><span>공제 합</span><span>차인지급액 합</span></div>', i;
    for (i = blocks.length - 1; i >= 0; i--) {
      var b = blocks[i], prev = i > 0 ? blocks[i - 1] : null;
      h += '<button type="button" class="pyrow year" data-y="' + b.y + '" aria-label="' + b.y + '년 자세히 보기"><span class="pym">' + b.y + '년<small>' + b.t.n + '개월</small>' + (b.partial ? '<small class="pytag">부분 연도</small>' : '') + '</span>' +
        '<span class="pyc"><em>지급총액 합</em><b>' + won(b.t.gross) + '</b></span><span class="pyc"><em>공제 합</em><b>' + won(b.t.ded) + '</b></span><span class="pyc net"><em>차인지급액 합</em><b>' + won(b.t.net) + '</b></span>' +
        '<span class="pyavg">월평균 차인지급액 <b>' + won(b.avgNet) + '</b>' + (prev ? ' · 전년 월평균과의 차이 <b>' + wonS(b.avgNet - prev.avgNet) + '</b>' : '') + '</span></button>';
    }
    return h + '</div>';
  }

  /* ---------- 그래프 (직접 그리는 SVG · 새 라이브러리 없음) ---------- */
  function fontPx() { var p = $('pyProbe'); var f = p ? parseFloat(getComputedStyle(p).fontSize) : 11; return f > 0 ? f : 11; }
  function niceMax(maxV) {
    var raw = maxV / 4, pw = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), c = [1, 2, 2.5, 5, 10], i, step = pw * 10;
    for (i = 0; i < c.length; i++) if (c[i] * pw >= raw) { step = c[i] * pw; break; }
    return { step: step, max: Math.ceil(maxV / step) * step };
  }
  function chartBox() { var b = $('payBody'); var w = b ? b.clientWidth : 320; return Math.max(240, w - 2); }
  function lineChartHtml(rs, all) {
    var n = rs.length, fs = fontPx(), W = chartBox(), H = Math.round(190 + fs * 3), i;
    var L = S.hide ? 10 : Math.round(fs * 3.3 + 10), R = Math.round(fs * 3.6 + 6), T = 12, B = Math.round(fs * 1.5 + 12);
    var mx = 1; for (i = 0; i < n; i++) if (rs[i].gross > mx) mx = rs[i].gross;
    var nm = niceMax(mx), pw = W - L - R, ph = H - T - B;
    function X(k) { return n === 1 ? L + pw / 2 : L + pw * k / (n - 1); }
    function Y(v) { return T + ph - ph * v / nm.max; }
    var g = '', t;
    for (t = 0; t <= nm.max + 1; t += nm.step) { var yy = Y(t); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="pygrid' + (t === 0 ? ' zero' : '') + '"/>' + (S.hide ? '' : '<text x="' + (L - 5) + '" y="' + (yy + fs * 0.35) + '" text-anchor="end" class="pyt">' + man(t) + '</text>'); }
    // x 눈금
    var xl = '';
    if (all) { var py = 0; for (i = 0; i < n; i++) if (rs[i].y !== py) { py = rs[i].y; if ((rs[i].y - rs[0].y) % 1 === 0) xl += '<text x="' + X(i) + '" y="' + (H - B + fs * 1.25) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '" class="pyt">' + String(py).slice(2) + '</text>'; } }
    else for (i = 0; i < n; i++) xl += '<text x="' + X(i) + '" y="' + (H - B + fs * 1.25) + '" text-anchor="middle" class="pyt">' + rs[i].m + '</text>';
    // 직급이 바뀐 달(세로 점선)
    var rk = '';
    for (i = 1; i < n; i++) if (rs[i].rank && rs[i - 1].rank && rs[i].rank !== rs[i - 1].rank) rk += '<line x1="' + X(i) + '" x2="' + X(i) + '" y1="' + T + '" y2="' + (H - B) + '" class="pyrk"/><text x="' + (X(i) + 4) + '" y="' + (T + fs) + '" class="pyt pyrkt">' + esc(rs[i].rank) + '</text>';
    function path(key) { var d = '', k; for (k = 0; k < n; k++) d += (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(rs[k][key]).toFixed(1); return d; }
    // 끝점 이름(겹치지 않게 위아래로 비켜 놓는다)
    var ends = [{ k: 'gross', t: '지급', c: 'pl-gross' }, { k: 'ded', t: '공제', c: 'pl-ded' }, { k: 'net', t: '차인', c: 'pl-net' }].map(function (e) { e.y = Y(rs[n - 1][e.k]); return e; }).sort(function (a, b) { return a.y - b.y; });
    for (i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < fs * 1.2) ends[i].y = ends[i - 1].y + fs * 1.2;
    var el = ends.map(function (e) { return '<text x="' + (X(n - 1) + 5) + '" y="' + (e.y + fs * 0.35) + '" class="pyt pyend ' + e.c + 't">' + e.t + '</text>'; }).join('');
    var sum = (all ? '전체 기간' : rs[0].y + '년') + ' 월별 지급총액·공제·차인지급액 선 그래프' + (S.hide ? '(금액 가림)' : '');
    return unitLine() + '<div class="pychart" id="payChart" data-kind="line"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(sum) + '" id="paySvg">' +
      '<defs><clipPath id="pyClip"><rect id="pyClipR" x="0" y="0" width="' + (S.play && anim && !calm() ? 0 : W) + '" height="' + H + '"/></clipPath></defs>' + g + rk + xl +
      '<g clip-path="url(#pyClip)"><path d="' + path('gross') + '" class="pyln pl-gross"/><path d="' + path('ded') + '" class="pyln pl-ded dash"/><path d="' + path('net') + '" class="pyln pl-net"/></g>' + el +
      '<line id="pyGuide" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" class="pyguide" style="display:none"/><circle id="pyD1" r="4" class="pyd pl-grossf" style="display:none"/><circle id="pyD2" r="4" class="pyd pl-dedf" style="display:none"/><circle id="pyD3" r="4" class="pyd pl-netf" style="display:none"/>' +
      '<rect x="' + L + '" y="0" width="' + pw + '" height="' + H + '" fill="transparent" id="pyHit"/></svg><div class="pytip" id="pyTip" role="status" style="display:none"></div></div>';
  }
  function barChartHtml(blocks) {
    var n = blocks.length, fs = fontPx(), W = chartBox(), H = Math.round(190 + fs * 3), i;
    var L = S.hide ? 10 : Math.round(fs * 3.9 + 10), R = 8, T = 12, B = Math.round(fs * 1.5 + 12);
    var mx = 1; for (i = 0; i < n; i++) if (blocks[i].t.gross > mx) mx = blocks[i].t.gross;
    var nm = niceMax(mx), pw = W - L - R, ph = H - T - B, slot = pw / n, bw = Math.min(40, slot * 0.62), step = slot < fs * 3.6 ? 2 : 1;
    function Y(v) { return T + ph - ph * v / nm.max; }
    var g = '', t, b = '';
    for (t = 0; t <= nm.max + 1; t += nm.step) { var yy = Y(t); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="pygrid' + (t === 0 ? ' zero' : '') + '"/>' + (S.hide ? '' : '<text x="' + (L - 5) + '" y="' + (yy + fs * 0.35) + '" text-anchor="end" class="pyt">' + man(t) + '</text>'); }
    for (i = 0; i < n; i++) {
      var k = blocks[i], cx = L + slot * (i + 0.5), x0 = cx - bw / 2, yNet = Y(k.t.net), yTop = Y(k.t.net + k.t.ded);
      b += '<g' + (k.partial ? ' class="part"' : '') + '><rect x="' + x0 + '" y="' + yNet + '" width="' + bw + '" height="' + Math.max(0, Y(0) - yNet) + '" class="pybar net"/><rect x="' + x0 + '" y="' + yTop + '" width="' + bw + '" height="' + Math.max(0, yNet - yTop) + '" class="pybar ded"/></g>' +
        '<text x="' + cx + '" y="' + (H - B + fs * 1.25) + '" text-anchor="middle" class="pyt">' + (i % step === 0 || i === n - 1 ? String(k.y).slice(2) + '년' + (k.partial ? '*' : '') : '') + '</text>';
    }
    var sum = '연도별 차인지급액과 공제를 쌓은 막대 그래프(합치면 지급총액)' + (S.hide ? '(금액 가림)' : '');
    return unitLine() + '<div class="pychart" data-kind="bar"><svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(sum) + '"><defs><pattern id="pyHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="pyhb"/><line x1="0" y1="0" x2="0" y2="6" class="pyhl"/></pattern></defs>' + g + b + '</svg></div>' +
      '<div class="pynote">* 막대는 그 해 합계입니다. 별표(*)가 붙은 해는 12개월이 아닌 부분 연도입니다.</div>';
  }

  /* ---------- 세부 시트 ---------- */
  function itemRows(items, order) {
    var ks = orderKeys(items, order), h = '', zero = 0;
    for (var i = 0; i < ks.length; i++) { var v = num(items[ks[i]]); if (v === 0 && !S.showZero) { zero++; continue; } h += '<li><span>' + esc(ks[i]) + '</span><b>' + won(v) + '</b></li>'; }
    return { html: h || '<li class="pynone"><span>값이 있는 항목이 없습니다</span></li>', zero: zero };
  }
  function sheetHtml() {
    var sh = S.sheet, rows = S.rows, h = '';
    if (!sh || !rows) return '';
    if (sh.ym) {
      var r = rows.filter(function (x) { return x.ym === sh.ym; })[0]; if (!r) return '';
      var p = itemRows(r.pay, PAY_ORDER), d = itemRows(r.dedI, DED_ORDER), zc = p.zero + d.zero;
      h = '<h4>' + esc(ymLabel(r) + dayTxt(r)) + ' 급여' + tag(r) + '</h4>' + (r.rank ? '<div class="pysub">직급 ' + esc(r.rank) + '</div>' : '') +
        '<div class="pysec">지급 내역</div><ul class="pyitems">' + p.html + '<li class="tot"><span>지급총액</span><b>' + won(r.gross) + '</b></li></ul>' +
        '<div class="pysec">공제 내역</div><ul class="pyitems">' + d.html + '<li class="tot"><span>공제총액</span><b>' + won(r.ded) + '</b></li></ul>' +
        '<ul class="pyitems"><li class="tot big"><span>차인지급액</span><b>' + won(r.net) + '</b></li></ul><div class="pychk">' + check(r) + '</div>' +
        (zc || S.showZero ? '<button type="button" class="pybtn ghost" id="pyZero">' + (S.showZero ? '0원 항목 숨기기' : '0원 항목도 보기 (' + zc + '개)') + '</button>' : '');
    } else {
      var rs = rowsOfYear(rows, sh.y), t = sumRows(rs), di = sumItems(rs, 'dedI'), pi = sumItems(rs, 'pay'), ks = orderKeys(di, DED_ORDER), bars = '', i;
      for (i = 0; i < ks.length; i++) {
        var v = num(di[ks[i]]); if (v === 0) continue;
        var pc = t.ded > 0 ? v * 100 / t.ded : 0;
        bars += '<li class="pybarrow"><div class="pybh"><span>' + esc(ks[i]) + '</span><b>' + won(v) + '</b></div><div class="pybt" aria-hidden="true"><i style="width:' + Math.max(1, Math.round(pc * 10) / 10) + '%"></i></div><div class="pypc">공제의 ' + (Math.round(pc * 10) / 10).toFixed(1) + '%</div></li>';
      }
      var pp = itemRows(pi, PAY_ORDER);
      h = '<h4>' + sh.y + '년 합계 · ' + t.n + '개월' + (t.n !== 12 ? ' <span class="pytag">부분 연도</span>' : '') + '</h4>' +
        '<ul class="pyitems"><li><span>지급총액 합</span><b>' + won(t.gross) + '</b></li><li><span>공제 합</span><b>' + won(t.ded) + '</b></li><li class="tot big"><span>차인지급액 합</span><b>' + won(t.net) + '</b></li><li><span>월평균 차인지급액</span><b>' + won(t.net / t.n) + '</b></li></ul>' +
        '<div class="pysec">공제 항목별 연 합계</div><ul class="pybars">' + (bars || '<li class="pynone"><span>값이 있는 항목이 없습니다</span></li>') + '</ul>' +
        '<div class="pysec">지급 항목별 연 합계</div><ul class="pyitems">' + pp.html + '</ul>';
    }
    return h + '<div class="pyfoot"><button type="button" class="pybtn" id="pyClose">닫기</button></div>';
  }
  function ensureLayer() {
    var L = $('payLayer'); if (L) return L;
    L = document.createElement('div'); L.id = 'payLayer';
    L.innerHTML = '<div class="pyscrim" id="pyScrim"></div><div class="pysheet" role="dialog" aria-modal="true" id="pySheet"></div>';
    document.body.appendChild(L);
    L.addEventListener('click', function (e) { var t = e.target; if (!t) return; if (t.id === 'pyScrim' || t.id === 'pyClose') closeSheet(); else if (t.id === 'pyZero') { S.showZero = !S.showZero; paintSheet(true); } });
    return L;
  }
  function paintSheet(keepScroll) {
    var L = ensureLayer(), sh = $('pySheet'), top = sh ? sh.scrollTop : 0;
    sh.innerHTML = sheetHtml(); L.className = 'show';
    if (keepScroll) sh.scrollTop = top; else sh.scrollTop = 0;
    var b = $('pyClose'); if (b && !keepScroll) { try { b.focus({ preventScroll: true }); } catch (e) {} }
  }
  function openSheet(sh) { S.sheet = sh; S.showZero = false; paintSheet(false); }
  function closeSheet() { S.sheet = null; var L = $('payLayer'); if (L) { L.className = ''; var sh = $('pySheet'); if (sh) sh.innerHTML = ''; } }

  /* ---------- 그리기 ---------- */
  function view() { return $('payBody'); }
  function shown() { var v = $('payView'); return !!v && v.style.display !== 'none'; }
  function banner(txt, retry) { return '<div class="pycard pybanner" role="status"><span>' + esc(txt) + '</span>' + (retry ? '<button type="button" class="pybtn sm" id="pyRetry">다시 시도</button>' : '') + '</div>'; }
  function render() {
    var v = view(); if (!v) return;
    var h = '<span id="pyProbe" class="pyt" aria-hidden="true" style="position:absolute;visibility:hidden;pointer-events:none">0</span>';
    if (S.loading && !S.rows) { v.innerHTML = h + '<div class="pycard pyload">급여 자료를 불러오는 중입니다…</div>'; return; }
    if (S.err && !S.rows) { v.innerHTML = h + banner('급여 자료를 못 불러왔습니다 — ' + errText(S.err), true); return; }
    if (!S.rows) { v.innerHTML = h; return; }
    if (!S.rows.length) { v.innerHTML = h + '<div class="pycard pyload">아직 올라온 급여 자료가 없습니다.</div>'; return; }
    var rows = S.rows, ys = yearsOf(rows), latest = rows[rows.length - 1];
    if (!S.year || (S.year !== 'all' && ys.indexOf(Number(S.year)) < 0)) S.year = String(latest.y);
    h += heroHtml(latest) + chipsHtml(ys);
    if (S.mode === 'month') {
      var rs = S.year === 'all' ? rows : rowsOfYear(rows, Number(S.year));
      h += '<div class="pycard pychartc">' + lineChartHtml(rs, S.year === 'all') + legendHtml(false) + '</div>';
      h += S.year === 'all' ? '<div class="pynote">연도를 고르면 그 해의 월별 표가 나옵니다. 그래프에 손가락을 대고 끌면 그 달의 값이 보입니다.</div>' : monthListHtml(rs) + unverNote(rs) + '<div class="pynote">줄을 누르면 항목별 내역이 나옵니다.</div>';
    } else {
      var bl = yearBlocks(rows);
      h += '<div class="pycard pychartc">' + barChartHtml(bl) + legendHtml(true) + '</div>' + yearListHtml(bl) + '<div class="pynote">줄을 누르면 연도별 항목 합계가 나옵니다. 앱은 명세서의 숫자를 그대로 보여 드릴 뿐 평가하지 않습니다.</div>';
    }
    v.innerHTML = h;
    fit(); bindChart(); runReveal();
  }
  function fit() {
    var l = $('payList'); if (!l) return; l.classList.remove('stack');
    var bad = false, rs = l.querySelectorAll('.pyrow:not(.pyhdr)'), i, cs, j;
    for (i = 0; i < rs.length && !bad; i++) { if (rs[i].scrollWidth > rs[i].clientWidth + 1) bad = true; cs = rs[i].querySelectorAll('b, .pym, .pym small'); for (j = 0; j < cs.length; j++) if (cs[j].scrollWidth > cs[j].clientWidth + 1) { bad = true; break; } }
    if (bad) l.classList.add('stack');
  }
  function runReveal() {
    var r = $('pyClipR'); if (!r) return; var go = S.play && anim && !calm(); S.play = false; if (!go) return;
    var sv = $('paySvg'), W = (sv && Number(sv.getAttribute('width'))) || 320;
    r.style.transition = 'width .4s ease-out';
    requestAnimationFrame(function () { requestAnimationFrame(function () { try { r.setAttribute('width', W); r.style.width = W + 'px'; } catch (e) {} }); });
  }

  /* 그래프에 손가락을 대고 끌면 그 달의 세 값을 말풍선으로 */
  function bindChart() {
    var svg = $('paySvg'), hit = $('pyHit'); if (!svg || !hit || !S.rows) return;
    var rs = S.year === 'all' ? S.rows : rowsOfYear(S.rows, Number(S.year)), n = rs.length, tip = $('pyTip'), box = $('payChart');
    var W = Number(svg.getAttribute('width')), H = Number(svg.getAttribute('height')), fs = fontPx();
    var L = S.hide ? 10 : Math.round(fs * 3.3 + 10), R = Math.round(fs * 3.6 + 6), T = 12, B = Math.round(fs * 1.5 + 12), pw = W - L - R, ph = H - T - B, mx = 1, i;
    for (i = 0; i < n; i++) if (rs[i].gross > mx) mx = rs[i].gross;
    var nm = niceMax(mx), hideTimer = null;
    function X(k) { return n === 1 ? L + pw / 2 : L + pw * k / (n - 1); }
    function Y(v) { return T + ph - ph * v / nm.max; }
    function at(ev) {
      var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * (W / r.width);
      var k = n === 1 ? 0 : Math.round((x - L) / pw * (n - 1)); k = Math.max(0, Math.min(n - 1, k));
      var row = rs[k], gx = X(k), g = $('pyGuide');
      g.setAttribute('x1', gx); g.setAttribute('x2', gx); g.style.display = '';
      [['pyD1', 'gross'], ['pyD2', 'ded'], ['pyD3', 'net']].forEach(function (d) { var c = $(d[0]); c.setAttribute('cx', gx); c.setAttribute('cy', Y(row[d[1]])); c.style.display = ''; });
      tip.innerHTML = '<b>' + esc(ymLabel(row)) + '</b><span class="g">지급총액 ' + won(row.gross) + '</span><span class="d">공제 ' + won(row.ded) + '</span><span class="n">차인지급액 ' + won(row.net) + '</span>';
      tip.style.display = '';
      var tw = tip.offsetWidth, left = gx * (r.width / W) - tw / 2; left = Math.max(0, Math.min(r.width - tw, left)); tip.style.left = left + 'px';
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }
    function off(delay) { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(function () { ['pyGuide', 'pyD1', 'pyD2', 'pyD3', 'pyTip'].forEach(function (id) { var e = $(id); if (e) e.style.display = 'none'; }); }, delay); }
    var down = false;
    hit.addEventListener('pointerdown', function (e) { down = true; try { hit.setPointerCapture(e.pointerId); } catch (x) {} at(e); });
    hit.addEventListener('pointermove', function (e) { if (down || e.pointerType === 'mouse') at(e); });
    hit.addEventListener('pointerup', function () { down = false; off(2200); });
    hit.addEventListener('pointercancel', function () { down = false; off(300); });
    hit.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') off(300); });
    box.setAttribute('data-n', n);
  }

  /* ---------- 읽기 ---------- */
  function load() {
    var tk = ++S.token; S.loading = true; S.err = null; render();
    return rpc('pay_list').then(function (d) {
      if (tk !== S.token) return;
      if (!isObj(d) || !Array.isArray(d.rows)) throw mkErr('BAD_SHAPE', 'server');
      S.rows = cleanRows(d.rows); S.loading = false; S.err = null; S.play = true; render();
    }).catch(function (e) { if (tk !== S.token) return; S.loading = false; S.err = e; S.rows = null; render(); });
  }

  /* ---------- 이벤트(한 번만 연결) ---------- */
  function build() {
    if (built) return; built = true;
    var v = view(); if (!v) return;
    v.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null; if (!t) return;
      var b;
      if ((b = t.closest('#pyEye'))) { S.hide = !S.hide; try { localStorage.setItem(HIDE_KEY, S.hide ? '1' : '0'); } catch (x) {} render(); return; }
      if ((b = t.closest('#pyRetry'))) { load(); return; }
      if ((b = t.closest('[data-mode]'))) { var m = b.getAttribute('data-mode'); if (m !== S.mode) { S.mode = m; render(); } return; }
      if ((b = t.closest('[data-year]'))) { var y = b.getAttribute('data-year'); if (y !== S.year) { S.year = y; render(); } return; }
      if ((b = t.closest('[data-ym]'))) { openSheet({ ym: b.getAttribute('data-ym') }); return; }
      if ((b = t.closest('[data-y]'))) { openSheet({ y: Number(b.getAttribute('data-y')) }); return; }
    });
    var rb = $('payReload'); if (rb) rb.onclick = function () { load(); };
    var rt = null;
    global.addEventListener('resize', function () { if (!shown() || !S.rows) return; if (rt) clearTimeout(rt); rt = setTimeout(function () { var l = $('payList'); if (l) fit(); var c = $('payChart'), svg = $('paySvg'); if (svg && chartBox() !== Number(svg.getAttribute('width'))) render(); }, 150); });
  }

  /* ---------- app.js 와 만나는 곳 ---------- */
  function init(o) { if (o && o.toast) _toast = o.toast; anim = !(o && o.anim === false); build(); }
  function open(o) {
    build();
    S.mode = 'month'; S.year = ''; S.sheet = null; S.rows = null; S.err = null;     // 열 때마다 새로 읽는다(폰에 남아 있는 금액이 없으니 보여 줄 옛 값도 없다)
    load();
  }
  function leave() {      // 화면을 떠나면 메모리의 금액도 비운다
    S.token++; S.rows = null; S.err = null; S.loading = false; S.sheet = null;
    closeSheet(); var v = view(); if (v) v.innerHTML = '';
  }
  function back() { if (S.sheet) { closeSheet(); return true; } return false; }
  global.PayTab = { init: init, open: open, leave: leave, back: back };
})(typeof window !== 'undefined' ? window : globalThis);

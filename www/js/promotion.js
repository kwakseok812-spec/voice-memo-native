/* promotion.js — 「승진」 점수판 (v9.62, O-0684 후속 · 읽기 전용 1단계)
 * 대표님의 정교수 승진 점수·요건을 한눈에 보는 화면. 계산은 promotion-calc.js(순수 함수), 규칙 숫자는 서버 promo_rules 에서 받아 온다.
 * 서버: promo_list(읽기) · promo_save_profile(현 직급 시작일·신청 마감일만 고침). 항목 입력·수정은 2단계.
 * 건강·실적 탭과 같은 연동 암호(localStorage smart_sync_pass)를 모든 호출에 붙인다. 이름·생년월일·점수표는 이 파일에 없다.
 * 스위치: app.js 의 PROMO_TAB ('on' | 'off') — 'off' 면 홈 칸이 보이지 않아 v9.61 과 같다.
 * 진입점: 홈 도구 끝 칸(실적 다음) 하나뿐(실적 탭 안에 두 번째 입구를 만들지 않는다 — 기능 중복 금지).
 */
(function (global) {
  'use strict';
  var PC = global.PromoCalc;
  var CKEY = 'smart_promo_cache_v1';
  var $ = function (id) { return document.getElementById(id); };
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { n = Number(n) || 0; return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtS(n) { n = Number(n) || 0; return Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString('ko-KR') : fmt(n); }
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /* ---------- 서버 호출 (실적 탭과 같은 방식 — 오류 구분: 암호 틀림은 응답에 BAD_PASSCODE/28000 이 있을 때만) ---------- */
  function mkErr(msg, kind) { var e = new Error(msg); e.promo = true; e.kind = kind; return e; }
  function classifyHttp(status, text) {
    var t = String(text || '');
    if (/BAD_PASSCODE/.test(t) || /"code"\s*:\s*"28000"/.test(t)) return 'badpass';
    if (status === 404 || /PGRST202/.test(t) || /Could not find the function/i.test(t)) return 'notready';
    return 'server';
  }
  function makeRpc(dep) {
    return function rpc(name, body) {
      var c = dep.cfg();
      if (!c) return Promise.reject(mkErr('NO_CONFIG', 'server'));
      var pass = dep.pass();
      if (!pass) { dep.needPass('승진 자료를 보려면 PC 연동 암호를 입력해 주세요.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
      body = body || {}; body.p_pass = pass;
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, dep.timeout || 20000) : null;
      var f = dep.fetch || global.fetch;
      return f(c.url + '/rest/v1/rpc/' + name, {
        method: 'POST', headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        if (tm) clearTimeout(tm);
        if (r.ok) return r.json();
        return r.text().then(function (t) {
          var kind = classifyHttp(r.status, t), e = mkErr(kind === 'badpass' ? 'BAD_PASSCODE' : (kind === 'notready' ? 'NOT_READY' : 'HTTP_' + r.status), kind);
          if (kind === 'badpass') dep.needPass('연동 암호가 맞지 않아 승진 자료를 불러오지 못했습니다. 다시 입력해 주세요.');
          throw e;
        });
      }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });
    };
  }
  function cfg() { return (global.OfficeBridge && global.OfficeBridge.CONFIG) || null; }
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function needPass(msg) { try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {} }
  var rpc = makeRpc({ cfg: cfg, pass: syncPass, needPass: needPass, fetch: function () { return global.fetch.apply(global, arguments); } });

  /* ---------- 상태 ---------- */
  var S = { fromCache: false, diffOpen: false, clearOk: false, loaded: false, loading: null, err: null, offline: false, cachedAt: null, profile: null, items: [], rules: null, rulesVer: null, sel: '', sec: 0, sheet: false, saving: false };
  var _toast = function () {}, built = false, animTimer = null;
  function saveCache() { try { localStorage.setItem(CKEY, JSON.stringify({ at: Date.now(), profile: S.profile, items: S.items, rules: S.rules, rulesVer: S.rulesVer })); } catch (e) {} }
  function readCache() { try { var c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (c && Array.isArray(c.items)) return c; } catch (e) {} return null; }
  function view() { return $('promoBody'); }
  function shown() { var v = $('promoView'); return !!v && v.style.display !== 'none'; }
  function errText(e) {
    if (!e) return '알 수 없는 오류예요.';
    if (e.kind === 'badpass') return '연동 암호가 맞지 않아요.';
    if (e.kind === 'net') return '인터넷에 연결되지 않았어요.';
    if (e.kind === 'notready') return '서버에 승진 기능이 아직 준비되지 않았어요.';
    return '서버 오류예요. 잠시 뒤 다시 해 주세요.';
  }

  /* ---------- 불러오기 ---------- */
  function applyData(d) {
    S.profile = isObj(d.profile) ? d.profile : null; S.items = Array.isArray(d.items) ? d.items : [];
    if (isObj(d.rules)) { S.rules = d.rules; S.rulesVer = d.rules_ver || d.rules.ver || null; }
  }
  function load(quiet) {
    if (S.loading) return S.loading;
    var p = rpc('promo_list', {}).then(function (d) {
      if (!isObj(d) || !Array.isArray(d.items)) throw mkErr('BAD_SHAPE', 'server');
      applyData(d); S.loaded = true; S.offline = false; S.fromCache = false; S.err = null; S.cachedAt = null; saveCache();
    }).catch(function (e) {
      S.err = e;
      var c = readCache();
      if (c && (e.kind === 'net' || e.kind === 'server')) { applyData(c); S.loaded = true; S.offline = true; S.cachedAt = c.at; }
      else if (!S.loaded && c && e.kind !== 'badpass' && e.kind !== 'notready') { applyData(c); S.loaded = true; S.offline = true; S.cachedAt = c.at; }
      else if (S.loaded) { S.offline = true; S.cachedAt = S.cachedAt || Date.now(); }          // 이미 보여 주던 자료가 최신이 아닐 수 있으니, 불러오기가 실패했을 때만 배너(성공하면 배너 없음)
      if (!quiet && S.loaded && S.offline) _toast('인터넷이 안 돼서 폰에 저장해 둔 사본을 보여 드려요.', 3200);
    }).then(function () { S.loading = null; if (shown()) render(); });
    S.loading = p; return p;
  }

  /* ---------- 계산 ---------- */
  function compute() {
    if (!S.rules) return { error: 'RULES' };
    return PC.computeAll({ items: S.items, profile: S.profile || {}, rules: S.rules, today: todayStr() });
  }
  var SW = { pass: '통과', fail: '부족', unknown: '확인 전', wait: '기다리는 중' }, SIC = { pass: '✓', fail: '✗', unknown: '?', wait: '⏳' };
  function ymText(cut) { return cut ? (cut[0] + '.' + cut[1]) : ''; }
  function yearsText(list) {
    if (!list.length) return '';
    var ys = list.map(function (e) { return e.ay; }).sort(function (a, b) { return a - b; }), out = [], s = ys[0], p = ys[0], i;
    for (i = 1; i <= ys.length; i++) { if (ys[i] !== p + 1) { out.push(s === p ? s + '학년도' : s + '~' + p + '학년도'); s = ys[i]; } p = ys[i]; }
    return out.join(', ');
  }

  /* ---------- 그림: 케이는 상태에 맞는 표정으로, 그 화면의 일을 하는 모습으로 크게 ---------- */
  function kPhoto(A) {
    var ex = 'smile', c = A.checks;
    if (c.total.s === 'fail' || c.sec3.s === 'fail' || c.lead.s === 'fail' || c.eval.s === 'fail') ex = 'concern';
    else if (c.eval.s === 'unknown' || c.tenure.s === 'unknown') ex = 'thinking';
    else if (c.tenure.s === 'wait') ex = 'smile';
    var u = '';
    try { var K = global.KChar; if (K) u = (K.poseUrl && K.poseUrl('note')) || (K.exprUrl && K.exprUrl(ex)) || ''; } catch (e) {}
    return u;
  }

  /* ---------- 화면 ---------- */
  function detailHtml(k, A) {
    var T = A.T, c = A.checks, h = '', ten = A.tenure;
    if (k === 'total') {
      h = '<b class="ph">총점 ' + fmt(c.total.value) + ' / ' + c.total.need + ' — ' + SW[c.total.s] + '</b>' + (c.total.s === 'pass'
        ? '오늘 기준(바닥값)으로도 합격선보다 ' + fmt(c.total.value - c.total.need) + '점 많아요. 임기 끝까지 예상은 ' + fmt(A.expected.total) + '점이에요.'
        : '합격선까지 ' + fmt(c.total.need - c.total.value) + '점이 모자라요.');
    } else if (k === 'sec3') {
      h = '<b class="ph">대학발전 ' + fmt(c.sec3.value) + ' / ' + c.sec3.need + ' — ' + SW[c.sec3.s] + '</b>보직·TFT·정책연구 점수예요. 오늘 기준은 보직을 지금까지의 재임 개월만 세요(재임 개월 비율). 임기 끝까지 예상은 ' + fmt(A.expected.sec3) + '점이에요.';
    } else if (k === 'lead') {
      h = '<b class="ph">책임저자 논문 — ' + SW[c.lead.s] + '</b>필수 요건은 SCI·등재급 책임저자(제1저자 또는 교신저자) 논문 1편 이상이에요.';
      if (c.lead.papers.length) {
        h += '<ul class="ppl">' + c.lead.papers.map(function (p) {
          var b = p.check === 'confirmed' ? '<span class="pb yes">확인됨</span>' : (p.check === 'need' ? '<span class="pb need">확인 필요</span>' : '<span class="pb asis">입력대로</span>');
          return '<li>' + esc(p.title) + ' <small>' + esc(p.journal) + ' · ' + (p.sci ? 'SCI급' : '등재급') + '</small> ' + b + '</li>';
        }).join('') + '</ul>';
      }
      h += '<div class="psub">「입력대로」는 대표님이 승진 앱에 넣으신 분류예요. 학술지가 SCI·등재지인지는 사무소가 조회해서 확인되면 「확인됨」으로 바꿔요. 예전 승진 앱 기준 책임저자 점수는 ' + fmtS(c.lead.legacyCorr) + '점(' + c.lead.legacyNeed + '점 이상이면 통과)이에요.</div>';
    } else if (k === 'eval') {
      if (c.eval.s === 'pass') {
        h = '<b class="ph">교수업적 순위 — 통과(' + c.eval.used.map(function (e) { return e.ay + '학년도'; }).join('·') + ' 기준, 부처장 재임 학년도는 평가 제외)</b>';
        h += '부처장을 하시는 동안(' + (yearsText(c.eval.exYears) || '재임 학년도') + ')은 교수업적평가에서 빠진다고 하셔서(대표님 말씀), 입력된 ' + c.eval.used.map(function (e) { return e.ay + '학년도 상위 ' + e.pct + '%'; }).join(', ') + '로 판단했어요. 평균 상위 ' + c.eval.max + '% 이내면 통과예요.';
      } else if (c.eval.s === 'fail') {
        h = '<b class="ph">교수업적 순위 — 부족</b>입력된 순위 평균이 상위 ' + fmt(c.eval.avg) + '%로 기준(상위 ' + c.eval.max + '% 이내)보다 낮아요.';
      } else {
        h = '<b class="ph">교수업적 순위 — 확인 전</b>판정할 학년도 값이 없어요' + (c.eval.exYears.length ? '(부처장 재임 학년도 ' + yearsText(c.eval.exYears) + '는 평가에서 빠져요)' : '') + '. 현 직급 학년도 순위를 넣어 주세요.';
      }
    } else if (k === 'tenure') {
      if (ten.state === 'unknown') h = '<b class="ph">재직 6년 — 확인 전</b>현 직급 시작일(부교수 임용일)을 넣으면 승진임용 가능일을 계산해 드려요. 아래 「승진 시기」에서 입력할 수 있어요.';
      else if (ten.state === 'pass') h = '<b class="ph">재직 6년 — 통과</b>승진임용 가능일(' + PC.fmtDay(ten.eligible) + ')이 지났어요. 신청 마감은 인사팀 공고를 확인해 주세요.';
      else h = '<b class="ph">재직 6년 — 기다리는 중(시간이 필요해요)</b>시작일 ' + PC.fmtDay(ten.start) + ' 기준으로 승진임용 가능일은 <b>' + PC.fmtDay(ten.eligible) + '</b>이에요(6년 이상 재직 뒤 첫 9월 1일자). 신청은 그 해 4~5월쯤이고 정확한 날은 인사팀 공고를 확인해야 해요.';
    }
    return h;
  }

  function banner() {            // 오프라인 사본 안내 줄
    if (!S.offline) return '';
    var d = S.cachedAt ? new Date(S.cachedAt) : null;
    var why = (S.err && S.err.kind === 'net') ? '오프라인 사본' : '불러오지 못해 저장해 둔 사본';
    return '<div class="pbanner"><span>' + why + (d ? ' · ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 기준' : '') + ' · 연결되면 새로 불러와요</span><button type="button" class="pbtn sm" id="promoRetry">다시 시도</button></div>';
  }

  function emptyHtml(kind) {
    var msg = { loading: ['불러오는 중이에요…', ''], notready: ['승진 기능이 서버에 아직 준비되지 않았어요', '서버 준비가 끝나면 이 화면에 점수가 나와요.'], badpass: ['연동 암호가 맞지 않아요', 'PC 연동 암호를 다시 입력해 주세요.'], net: ['인터넷에 연결되지 않았어요', '연결된 뒤 다시 시도해 주세요.'], server: ['불러오지 못했어요', '잠시 뒤 다시 시도해 주세요.'], rules: ['규칙을 불러오지 못했어요', '점수 규칙표를 못 받아서 계산하지 않았어요(0점으로 보여 드리지 않아요).'], none: ['아직 가져온 승진 자료가 없어요', 'PC에서 러버블 승진 앱의 자료를 한 번 가져오면 이 화면에 점수가 나와요.'] }[kind] || ['불러오지 못했어요', ''];
    return '<div class="pcard pempty"><b>' + msg[0] + '</b><p>' + msg[1] + '</p>' + (kind === 'loading' ? '' : '<button type="button" class="pbtn" id="promoRetry">다시 시도</button>') + '</div>';
  }

  function render() {
    if (!built) return;
    var v = view(); if (!v) return;
    if (S.sec) { renderSection(); return; }
    if (!S.loaded) {
      var e = S.err;
      v.innerHTML = emptyHtml(!e ? 'loading' : (e.kind === 'notready' ? 'notready' : (e.kind === 'badpass' ? 'badpass' : (e.kind === 'net' ? 'net' : 'server'))));
      wireRetry(); return;
    }
    if (!S.rules) { v.innerHTML = banner() + emptyHtml('rules'); wireRetry(); return; }
    if (!S.profile && !S.items.length) { v.innerHTML = banner() + emptyHtml('none'); wireRetry(); return; }
    var A = compute();
    if (A.error) { v.innerHTML = banner() + emptyHtml('rules'); wireRetry(); return; }
    var T = A.T, ten = A.tenure, c = A.checks, ph = '', i, k;
    var photo = kPhoto(A);
    /* hero */
    ph += banner();
    ph += '<section class="pcard phero"><div class="pkimg">' + (photo ? '<img alt="" src="' + esc(photo) + '">' : '<span class="pkfb">K</span>') + '</div>';
    ph += '<p class="psay" id="promoSay">' + esc(A.say) + '</p>';
    ph += '<div class="ppair"><div><div class="plab">오늘 기준 <span class="pfloor">바닥값</span></div><div class="pbig"><span id="pTotal">0</span><small>/ ' + T.total + '</small></div></div>';
    ph += '<div><div class="plab">' + (A.expCut ? '신청 마감(' + ymText(A.expCut) + ')까지 예상' : '임기 끝까지 예상') + '</div><div class="pmid" id="pExp">0</div></div></div>';
    ph += '<div class="pmeter"><i id="pMeter"></i><u></u></div><div class="pmscale"><span>0</span><span>합격선 ' + T.total + '</span><span>합격선의 ' + Math.round(A.today.total / T.total * 100) + '%</span></div>';
    var PEXP = { future: '보직 점수는 지금까지 재임한 개월만 세요(임기를 채우면 올라가요)', round: '반올림·절사를 규정대로 맞췄어요', before: '현 직급 시작 이전 실적은 빼요' };
    ph += '<div class="pdiff"><button type="button" class="pdiffbtn" id="pDiffBtn" aria-expanded="' + (S.diffOpen ? 'true' : 'false') + '"><span>예전 승진 앱(<b>' + fmt(A.vsLegacy.legacyTotal) + '</b>)보다 <b>' + fmt(A.vsLegacy.diff) + '점</b> 적어요</span>' + (A.vsLegacy.parts.length ? '<i aria-hidden="true">' + (S.diffOpen ? '▴' : '▾') + '</i>' : '') + '</button>'
      + (A.vsLegacy.parts.length ? '<ul class="pdiffl" id="pDiffL"' + (S.diffOpen ? '' : ' style="display:none"') + '>' + A.vsLegacy.parts.map(function (p) { return '<li><span>' + esc(PEXP[p.key] || p.label) + '</span><b>−' + fmt(p.pts) + '</b></li>'; }).join('') + '</ul>' : '') + '</div>';
    ph += '<div class="pnote">오늘 기준은 보직을 지금(' + ymText(A.todayCut) + ')까지 재임한 개월만 센 값이라, 임기를 채우면 올라가는 바닥값이에요.</div></section>';
    /* 타일 */
    ph += '<div class="ptiles" id="pTiles">';
    ['total', 'sec3', 'lead', 'eval', 'tenure'].forEach(function (key) {
      var st = c[key].s;
      ph += '<button type="button" class="ptile ' + st + (S.sel === key ? ' sel' : '') + '" data-k="' + key + '"><span class="pic">' + SIC[st] + '</span><span class="pt">' + esc(PC.CHECK_NAMES[key]) + '</span><span class="ps">' + SW[st] + '</span></button>';
    });
    ph += '</div><div class="pdetail' + (S.sel ? ' show' : '') + '" id="pDetail">' + (S.sel ? detailHtml(S.sel, A) : '') + '</div>';
    /* 점검할 것 — 타일 바로 아래, 접지 않음 */
    ph += '<section class="pcard"><h3>점검할 것 <span class="pcnt">' + A.notes.filter(function (n) { return n.level === 'check'; }).length + '건</span></h3><ul class="pwarn">';
    A.notes.forEach(function (n) {
      var mark = n.level === 'ok' ? '<em class="okm">✓</em>' : (n.level === 'info' ? '<em class="inm">i</em>' : '<em>!</em>');
      ph += '<li class="' + n.level + '"><b>' + mark + esc(n.title) + '</b><span class="psb">' + esc(n.text) + '</span></li>';
    });
    if (!A.notes.length) ph += '<li class="ok"><em class="okm">✓</em><b>점검할 것이 없어요</b></li>';
    ph += '</ul></section>';
    /* 승진 시기 */
    ph += '<section class="pcard ptenure"><h3>승진 시기 <button type="button" class="pbtn sm" id="promoEdit">날짜 고치기</button></h3>';
    ph += '<div class="pl"><span>현 직급 시작일</span><b>' + (ten.start ? PC.fmtDay(ten.start) : '입력 전') + '</b></div>';
    ph += '<div class="pl"><span>승진임용 가능일 <small>(6년 채운 뒤 첫 9월 1일)</small></span><b>' + (ten.eligible ? PC.fmtDay(ten.eligible) + (ten.daysLeft > 0 ? ' · ' + ten.daysLeft.toLocaleString('ko-KR') + '일 남음' : '') : '확인 전') + '</b></div>';
    ph += '<div class="pl"><span>신청 마감 <small>(대략 4~5월)</small></span><b>' + (S.profile && S.profile.apply_deadline ? PC.fmtDay(PC.parseDay(S.profile.apply_deadline)) : (ten.deadlineYear ? ten.deadlineYear + '년 4~5월 · 인사팀 공고 확인' : '인사팀 공고 확인')) + '</b></div></section>';
    /* 부문별 점수 */
    var secs = A.today.sections, maxV = 700, vals = [secs[4].raw];
    for (i = 1; i <= 5; i++) vals.push(secs[i].used);
    maxV = Math.max(700, Math.ceil(Math.max.apply(null, vals) / 100) * 100);
    ph += '<section class="pcard"><h3>부문별 점수</h3><div id="pBars">';
    var NAMES = S.rules.sections || {};
    for (i = 1; i <= 5; i++) {
      var sc = secs[i], nm = i + ' ' + (NAMES[i] || '');
      if (!sc.has) { ph += '<div class="prow na"><span>' + esc(nm) + '</span><div class="pnaTxt">해당 없음 · 안 채워도 돼요</div></div>'; continue; }
      ph += '<button type="button" class="prow" data-sec="' + i + '"><span>' + esc(nm) + '</span><div class="ptrack"><div class="pghost" data-w="' + (sc.capped ? Math.min(100, sc.raw / maxV * 100) : 0) + '"></div><div class="pfill" data-w="' + Math.min(100, sc.used / maxV * 100) + '"></div>'
        + (i === 3 ? '<u style="left:' + (T.sec3 / maxV * 100) + '%"></u>' : '') + (sc.max ? '<u style="left:' + (sc.max / maxV * 100) + '%"></u>' : '') + '</div><b>' + fmtS(sc.used) + '</b></button>';
      if (sc.capped) ph += '<div class="pcap">최대 인정 ' + sc.max + '점 / 실제 쓴 점수 ' + fmtS(sc.raw) + ' — 더 써도 안 올라요</div>';
    }
    ph += '</div><div class="pticks"><span>▏0</span><span>▏' + T.sec3 + ' 대학발전 기준</span><span>▏' + T.sec_cap + ' 최대 인정</span></div></section>';
    ph += '<p class="pfoot">참고 계산이며 공식 판정이 아닙니다 · 규정판 ' + esc(S.rulesVer || '') + ' · 규정 방식(반올림, 보직은 재임 개월 비율을 내림)</p>';
    v.innerHTML = ph;
    /* 이벤트 */
    var tiles = v.querySelectorAll('.ptile');
    for (i = 0; i < tiles.length; i++) tiles[i].onclick = function () { var kk = this.getAttribute('data-k'); S.sel = (S.sel === kk) ? '' : kk; render(); var d = $('pDetail'); if (d && S.sel) d.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); };
    var rows = v.querySelectorAll('.prow[data-sec]');
    for (i = 0; i < rows.length; i++) rows[i].onclick = function () { S.sec = parseInt(this.getAttribute('data-sec'), 10); render(); try { v.scrollTop = 0; window.scrollTo(0, 0); } catch (e) {} };
    var ed = $('promoEdit'); if (ed) ed.onclick = openSheet;
    var db = $('pDiffBtn'); if (db) db.onclick = function () { S.diffOpen = !S.diffOpen; var l = $('pDiffL'); if (l) l.style.display = S.diffOpen ? '' : 'none'; this.setAttribute('aria-expanded', S.diffOpen ? 'true' : 'false'); var ic = this.querySelector('i'); if (ic) ic.textContent = S.diffOpen ? '▴' : '▾'; };
    wireRetry();
    animate(A, v);
  }
  function wireRetry() { var b = $('promoRetry'); if (b) b.onclick = function () { S.err = null; render(); load(false); }; }

  /* 움직임 — 짧게(0.45초·0.35초), 입력을 막지 않음, 「움직임 줄이기」·.calm 이면 바로 최종값 */
  function countTo(el, to) {
    if (!el) return;
    if (calm()) { el.textContent = fmt(to); return; }
    var t0 = null, dur = 450, done = false;
    function step(ts) { if (done) return; if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(to * e); if (p < 1) requestAnimationFrame(step); else { done = true; el.textContent = fmt(to); } }
    requestAnimationFrame(step);
    setTimeout(function () { done = true; el.textContent = fmt(to); }, dur + 160);        // 화면이 가려져 애니메이션이 멈춰도 최종값은 반드시 보이게
  }
  function animate(A, v) {
    var m = $('pMeter'), mw = Math.min(100, A.today.total / (A.T.total * 2) * 100);
    var fills = v.querySelectorAll('.pfill, .pghost'), j;
    var key = A.today.total + '|' + A.expected.total + '|' + S.rev, again = (S.lastAnim === key);       // 같은 값을 다시 그릴 때(타일 누르기 등)는 효과를 되풀이하지 않는다
    S.lastAnim = key;
    if (again) { var tt = $('pTotal'), ee = $('pExp'); if (tt) tt.textContent = fmt(A.today.total); if (ee) ee.textContent = fmt(A.expected.total); if (m) { m.style.transition = 'none'; m.style.width = mw + '%'; } for (j = 0; j < fills.length; j++) { fills[j].style.transition = 'none'; fills[j].style.width = fills[j].getAttribute('data-w') + '%'; } return; }
    countTo($('pTotal'), A.today.total); countTo($('pExp'), A.expected.total);
    if (calm()) { if (m) m.style.width = mw + '%'; for (j = 0; j < fills.length; j++) fills[j].style.width = fills[j].getAttribute('data-w') + '%'; return; }
    if (animTimer) clearTimeout(animTimer);
    animTimer = setTimeout(function () { if (m) m.style.width = mw + '%'; for (j = 0; j < fills.length; j++) (function (f, k) { setTimeout(function () { f.style.width = f.getAttribute('data-w') + '%'; }, k * 25); })(fills[j], j); }, 45);
  }

  /* ---------- 부문 화면(읽기 목록) ---------- */
  var TAGS = { excluded: '기본 점수 제외', before: '현 직급 이전', partial: '부분 인정' };
  function renderSection() {
    var v = view(), A = compute(); if (!v || A.error) { S.sec = 0; render(); return; }
    var s = S.sec, sc = A.today.sections[s], R = S.rules, h = '', codes = [], i;
    A.today.rows.forEach(function (r) { if (parseInt(r.code.charAt(0), 10) === s && codes.indexOf(r.code) < 0) codes.push(r.code); });
    codes.sort();
    h += '<section class="pcard"><h3>부문 ' + s + ' · ' + esc((R.sections || {})[s] || '') + '</h3><div class="pbig sm"><span>' + fmt(sc.used) + '</span>' + (sc.max ? '<small>/ 최대 ' + sc.max + '</small>' : '') + '</div>';
    if (sc.capped) h += '<div class="pcap">최대 인정 ' + sc.max + '점 / 실제 쓴 점수 ' + fmtS(sc.raw) + ' — 더 써도 안 올라요</div>';
    h += '<div class="pnote">오늘 기준(' + ymText(A.todayCut) + ') · 읽기만 되는 화면이에요(입력·수정은 다음 단계).</div></section>';
    codes.forEach(function (code) {
      var rows = A.today.rows.filter(function (r) { return r.code === code; }), tot = A.today.itemTotals[code];
      h += '<section class="pcard"><h3>' + esc(code + ' ' + ((R.names || {})[code] || '')) + ' <span class="pcnt">' + fmtS(tot) + '점 · ' + rows.length + '건</span></h3><ul class="plist">';
      rows.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
      rows.forEach(function (r) {
        var tags = [];
        if (r.status !== 'in' && TAGS[r.status]) tags.push('<span class="ptag t-' + r.status + '">' + TAGS[r.status] + '</span>');
        if (r.flags.unverified) tags.push('<span class="ptag t-unv">확인 전</span>');
        if (r.flags.dup_suspect) tags.push('<span class="ptag t-dup">중복 의심</span>');
        if (r.flags.series) tags.push('<span class="ptag t-ser">같은 사업 연차별</span>');
        if (r.flags.term_confirmed) tags.push('<span class="ptag t-ok">임기 확인됨</span>');
        if (r.flags.corrected) tags.push('<span class="ptag t-cor">정정해 가져옴</span>');
        var sc1 = r.score; if (code === '1-1' && r.part !== null && r.part !== undefined) sc1 = r.part;
        h += '<li><div class="pl1"><span class="plb">' + esc(PC.rowLabel(r.it, R)) + '</span><b class="psc">' + (r.status === 'excluded' || r.status === 'before' ? '0' : fmtS(sc1)) + '</b></div>';
        if (tags.length) h += '<div class="ptags">' + tags.join('') + '</div>';
        if (r.reasons.length && r.status !== 'in') h += '<div class="psb">' + esc(r.reasons.join(' · ')) + '</div>';
        else if (code === '3-1') h += '<div class="psb">재임 ' + r.months + '개월 인정' + (r.monthsRaw !== r.months ? ' (입력 ' + r.monthsRaw + '개월)' : '') + (r.reasons.length ? ' · ' + esc(r.reasons.join(' · ')) : '') + '</div>';
        h += '</li>';
      });
      h += '</ul></section>';
    });
    if (!codes.length) h += '<section class="pcard"><p class="pnote">이 부문에는 입력된 실적이 없어요.</p></section>';
    v.innerHTML = banner() + h;
    wireRetry();
    try { window.scrollTo(0, 0); } catch (e) {}
  }

  /* ---------- 날짜 고치기(현 직급 시작일·신청 마감일) ---------- */
  function openSheet() {
    var L = $('promoLayer'); if (!L) return;
    var p = S.profile || {}, ds = p.rank_start || '', dd = p.apply_deadline || '';
    S.sheet = true; S.clearOk = false;
    L.innerHTML = '<div class="pscrim" id="promoScrim"></div><div class="psheet" role="dialog" aria-label="승진 시기 날짜"><h4>승진 시기 날짜</h4>'
      + '<label>현 직급 시작일 <small>(부교수 승진 발령일)</small><input type="date" id="promoRs" value="' + esc(ds) + '"></label>'
      + '<label>신청 마감일 <small>(인사팀 공고가 나오면 · 모르면 비워 두세요)</small><input type="date" id="promoDl" value="' + esc(dd) + '"></label>'
      + '<div class="psmsg" id="promoMsg"></div><div class="pbtns"><button type="button" class="pbtn ghost" id="promoCancel">닫기</button><button type="button" class="pbtn" id="promoSave">저장</button></div></div>';
    L.classList.add('show');
    $('promoScrim').onclick = closeSheet; $('promoCancel').onclick = closeSheet; $('promoSave').onclick = saveDates;
    $('promoRs').oninput = $('promoRs').onchange = function () { S.clearOk = false; var b = $('promoSave'); if (b) b.textContent = '저장'; var m = $('promoMsg'); if (m && /비우/.test(m.textContent)) m.textContent = ''; };
  }
  function closeSheet() { var L = $('promoLayer'); S.sheet = false; if (L) { L.classList.remove('show'); L.innerHTML = ''; } }
  function saveDates() {
    if (S.saving) return;
    var rs = $('promoRs').value || null, dl = $('promoDl').value || null, msg = $('promoMsg');
    if (rs && !PC.parseDay(rs)) { msg.textContent = '시작일 날짜를 확인해 주세요.'; return; }
    if (dl && !PC.parseDay(dl)) { msg.textContent = '신청 마감일 날짜를 확인해 주세요.'; return; }
    if (rs && dl && dl < rs) { msg.textContent = '신청 마감일이 시작일보다 앞서요.'; return; }
    if (!rs && S.profile && S.profile.rank_start && !S.clearOk) {         // 있던 시작일을 비우는 경우만 한 번 되묻는다
      S.clearOk = true; msg.textContent = '시작일을 비우면 현 직급 이전 실적을 거르지 못하고 승진임용 가능일도 계산하지 못해요. 정말 비울까요?'; $('promoSave').textContent = '네, 비울게요'; return;
    }
    S.saving = true; $('promoSave').disabled = true; msg.textContent = '저장 중…';
    var row = { rank_start: rs, apply_deadline: dl }; if (S.profile && typeof S.profile.rev === 'number') row.base_rev = S.profile.rev;
    rpc('promo_save_profile', { p_row: row }).then(function (res) {
      S.saving = false;
      if (isObj(res) && res.ok === true && isObj(res.row)) {              // 서버 응답으로 저장 성공을 확인한 뒤에만 「저장했어요」(규칙 7)
        S.profile = res.row; saveCache(); closeSheet(); render(); _toast('저장했어요');
      } else if (isObj(res) && res.err === 'CONFLICT' && isObj(res.row) && (res.row.rank_start || null) === rs && (res.row.apply_deadline || null) === dl) {
        S.profile = res.row; saveCache(); closeSheet(); render(); _toast('저장했어요');      // 응답이 끊겨 다시 보낸 경우: 서버에 이미 같은 값이 있는 것을 확인했으니 저장된 것
      } else if (isObj(res) && res.err === 'CONFLICT') {
        closeSheet(); _toast('다른 기기에서 먼저 고쳤어요 — 다시 불러올게요.', 3600); load(true);
      } else {
        $('promoSave').disabled = false; msg.textContent = '저장하지 못했어요 — 날짜를 확인하고 다시 눌러 주세요. 입력한 내용은 그대로 있어요.';
      }
    }).catch(function (e) { S.saving = false; var b = $('promoSave'); if (b) b.disabled = false; var m2 = $('promoMsg'); if (m2) m2.textContent = '저장하지 못했어요 — ' + errText(e) + ' 입력한 내용은 그대로 있어요.'; });
  }

  /* ---------- app.js 와 만나는 곳 ---------- */
  function build() {
    if (built) return;
    built = true;
    var v = $('promoView'); if (!v) return;
    if (!$('promoLayer')) { var L = document.createElement('div'); L.id = 'promoLayer'; v.appendChild(L); }
    var rb = $('promoReload'); if (rb) rb.onclick = function () { S.err = null; load(false); };
  }
  function init(o) { if (o && o.toast) _toast = o.toast; build(); }
  function open() {
    build(); S.sel = ''; S.sec = 0; S.lastAnim = ''; S.rev = (S.rev || 0) + 1; closeSheet();
    var c = readCache();
    if (!S.loaded && c) { applyData(c); S.loaded = true; S.fromCache = true; S.offline = false; S.cachedAt = c.at; }      // 저장본을 먼저 보여 주는 동안은 배너 없음
    render(); load(true);
  }
  /* 뒤로 가기: 창이 열려 있으면 창부터, 부문 화면이면 점수판으로. true = 여기서 처리함 */
  function back() {
    if (S.sheet) { closeSheet(); return true; }
    if (S.sec) { S.sec = 0; render(); return true; }
    return false;
  }
  global.PromoTab = { init: init, open: open, back: back };
})(typeof window !== 'undefined' ? window : globalThis);

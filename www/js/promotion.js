/* promotion.js — 「승진」 점수판 (v9.63 · v9.62 읽기 점수판 + 입력·수정·실적 연결은 promotion-edit.js)
 * 대표님의 정교수 승진 점수·요건을 한눈에 보는 화면. 계산은 promotion-calc.js(순수 함수), 규칙 숫자는 서버 promo_rules 에서 받아 온다.
 * 서버: promo_list(읽기) · promo_save_profile · promo_save_item · promo_trash_item · promo_purge_item (v9.63 입력·수정은 promotion-edit.js) · 곽호석 탭 연결에는 ach_list 를 읽는다.
 * 건강·곽호석 탭과 같은 연동 암호(localStorage smart_sync_pass)를 모든 호출에 붙인다. 이름·생년월일·점수표는 이 파일에 없다.
 * 스위치: app.js 의 PROMO_TAB ('on' | 'off') — 'off' 면 홈 칸이 보이지 않아 v9.61 과 같다. PROMO_EDIT 'off' 면 입력 단추가 없는 v9.62 화면, PROMO_LINK 'off' 면 곽호석 탭을 읽지도 않는다.
 * 진입점: 홈 도구 끝 칸(실적 다음) 하나뿐(곽호석 탭 안에 두 번째 입구를 만들지 않는다 — 기능 중복 금지).
 */
(function (global) {
  'use strict';
  var PC = global.PromoCalc;
  var CKEY = 'smart_promo_cache_v1', AKEY = 'smart_promo_ach_v1';
  var $ = function (id) { return document.getElementById(id); };
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { n = Number(n) || 0; return n.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtS(n) { n = Number(n) || 0; return Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString('ko-KR') : fmt(n); }
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  /* ---------- 서버 호출 (곽호석 탭과 같은 방식 — 오류 구분: 암호 틀림은 응답에 BAD_PASSCODE/28000 이 있을 때만) ---------- */
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
      if (!pass) { dep.needPass('승진 자료를 보려면 PC 연동 암호를 입력해 주십시오.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
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
          if (kind === 'badpass') dep.needPass('연동 암호가 맞지 않아 승진 자료를 불러오지 못했습니다. 다시 입력해 주십시오.');
          throw e;
        });
      }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });
    };
  }
  function cfg() { return (global.OfficeBridge && global.OfficeBridge.CONFIG) || null; }
  /* v10.15: 항목에 붙인 증빙 PDF 주소 받기 — 서버 함수 promo-file(연동 암호 확인 뒤 짧게 유효한 주소). 응답은 항상 HTTP 200 + {ok, error?} */
  function promoFileApi(body) {
    var c = cfg(); if (!c) return Promise.reject(mkErr('NO_CONFIG', 'server'));
    var pass = syncPass(); if (!pass) { needPass('PC 연동 암호를 입력해 주십시오.'); return Promise.reject(mkErr('NO_PASS', 'badpass')); }
    var b = {}, k; for (k in (body || {})) b[k] = body[k]; b.pass = pass;
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return global.fetch(c.url + '/functions/v1/promo-file', { method: 'POST', headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: ctl ? ctl.signal : undefined }).then(function (r) {
      if (tm) clearTimeout(tm);
      if (!r.ok) throw mkErr('HTTP_' + r.status, 'server');
      return r.json().then(function (j) {
        if (j && j.ok === true) return j;
        var kind = j && j.error === 'bad_pass' ? 'badpass' : (j && j.error === 'no_file' ? 'nofile' : 'server');
        if (kind === 'badpass') needPass('연동 암호가 맞지 않습니다. 다시 입력해 주십시오.');
        throw mkErr('FILE_' + (j && j.error), kind);
      }, function () { throw mkErr('BAD_JSON', 'server'); });
    }, function () { if (tm) clearTimeout(tm); throw mkErr('NETWORK', 'net'); });
  }
  function syncPass() { try { return localStorage.getItem('smart_sync_pass') || ''; } catch (e) { return ''; } }
  function needPass(msg) { try { if (global.SmartHome && SmartHome.needPass) SmartHome.needPass(msg); } catch (e) {} }
  var rpcRaw = makeRpc({ cfg: cfg, pass: syncPass, needPass: needPass, fetch: function () { return global.fetch.apply(global, arguments); } });
  function rpc(name, body) { if (!/_list$/.test(name) && global.PerfSeg && PerfSeg.noteWrite) PerfSeg.noteWrite(); return rpcRaw(name, body); }   // O-0782: 서버에 쓴 일(승진 항목·프로필·책임저자 표시)을 알린다 — 알약 전환 때 방금 읽은 자료가 낡았는지 보려고
  function perfEp() { return global.PerfSeg && PerfSeg.epoch ? PerfSeg.epoch() : 0; }
  /* O-0782: 계산 파일(promotion-calc.js)이 만드는 점검 안내 글에 든 옛 이름 「곽호석 탭」을 화면에 그릴 때만 「실적 탭」으로 바꿔 보여 준다(계산 결과 객체는 그대로) */
  /* v10.18: 실적 탭 연결을 끄면(PROMO_LINK='off') 「실적 탭」이라는 말을 화면에 내지 않는다 — 중복 의심 안내의 「곽호석 탭에는 한 편입니다」는 「같은 논문이 2건이라 한 건은 점수에서 뺐습니다」로 바꿔 보여 준다(저장된 글·계산 결과 객체는 그대로) */
  function lbl(t) {
    t = String(t == null ? '' : t);
    if (!S.link) t = t.split(' — 곽호석 탭에는 한 편입니다.').join(' — 같은 논문이 2건이라 한 건은 점수에서 뺐습니다.');
    return t.split('곽호석 탭').join('실적 탭');
  }

  /* ---------- 상태 ---------- */
  var S = { ux: false, open: {}, filter: 'all', more: {}, emptyOpen: false, pxSheet: false, hint: {}, edit: false, link: false, ach: null, achCats: null, achErr: null, refOpen: false, flashId: '', fromCache: false, diffOpen: false, clearOk: false, loaded: false, loading: null, err: null, offline: false, cachedAt: null, lastLoadAt: 0, lastLoadEp: -1, profile: null, items: [], rules: null, rulesVer: null, sel: '', sec: 0, sheet: false, saving: false };
  var _toast = function () {}, _saveFile = null, built = false, animTimer = null;
  function saveCache() { try { localStorage.setItem(CKEY, JSON.stringify({ at: Date.now(), profile: S.profile, items: S.items, rules: S.rules, rulesVer: S.rulesVer })); } catch (e) {} }
  function readCache() { try { var c = JSON.parse(localStorage.getItem(CKEY) || 'null'); if (c && Array.isArray(c.items)) return c; } catch (e) {} return null; }
  function view() { return $('promoBody'); }
  function shown() { var v = $('promoView'); return !!v && v.style.display !== 'none'; }
  function errText(e) {
    if (!e) return '알 수 없는 오류입니다.';
    if (e.kind === 'badpass') return '연동 암호가 맞지 않습니다.';
    if (e.kind === 'net') return '인터넷에 연결되지 않았습니다.';
    if (e.kind === 'notready') return '서버에 승진 기능이 아직 준비되지 않았습니다.';
    return '서버 오류입니다. 잠시 뒤 다시 해 주십시오.';
  }

  /* ---------- 곽호석 탭 자료(연결용) — 저자 이름은 가져오지도, 폰에 저장하지도 않는다 ---------- */
  function slimAch(a) {
    var d = isObj(a.data) ? a.data : {}, keep = {}, k, KS = ['lead', 'author_pos', 'author_total', 'co_first', 'corresponding'];
    for (k = 0; k < KS.length; k++) if (d[KS[k]] !== undefined && d[KS[k]] !== null) keep[KS[k]] = d[KS[k]];
    return { id: a.id, kind_id: a.kind_id, cat_id: a.cat_id, title: a.title, year: a.year, venue: a.venue, np: PC.achPeopleN(a), data: keep, rev: a.rev, deleted_at: a.deleted_at || null };
  }
  function saveAch() { try { localStorage.setItem(AKEY, JSON.stringify({ at: Date.now(), cats: S.achCats, items: S.ach })); } catch (e) {} }
  function readAch() { try { var c = JSON.parse(localStorage.getItem(AKEY) || 'null'); if (c && Array.isArray(c.items)) return c; } catch (e) {} return null; }
  function loadAch(quiet) {
    if (!S.link) return Promise.resolve();
    return rpc('ach_list', {}).then(function (d) {
      if (!isObj(d) || !Array.isArray(d.items)) throw mkErr('BAD_SHAPE', 'server');
      S.ach = d.items.map(slimAch); S.achCats = Array.isArray(d.cats) ? d.cats.map(function (c) { return { id: c.id, parent_id: c.parent_id, kind_type: c.kind_type, name: c.name }; }) : []; S.achErr = null; saveAch();
    }).catch(function (e) {
      S.achErr = e;
      if (!S.ach) { var c = readAch(); if (c) { S.ach = c.items; S.achCats = c.cats || []; } }
    }).then(function () { if (shown()) render(); });
  }

  /* ---------- 불러오기 ---------- */
  function applyData(d) {
    S.profile = isObj(d.profile) ? d.profile : null; S.items = Array.isArray(d.items) ? d.items : [];
    if (isObj(d.rules)) { S.rules = d.rules; S.rulesVer = d.rules_ver || d.rules.ver || null; }
  }
  function load(quiet) {
    if (S.loading) return S.loading;
    var ep = perfEp();
    var p = rpc('promo_list', {}).then(function (d) {
      if (!isObj(d) || !Array.isArray(d.items)) throw mkErr('BAD_SHAPE', 'server');
      applyData(d); S.loaded = true; S.offline = false; S.fromCache = false; S.err = null; S.cachedAt = null; saveCache(); S.lastLoadAt = Date.now(); S.lastLoadEp = ep;
    }).catch(function (e) {
      S.err = e;
      var c = readCache();
      if (c && (e.kind === 'net' || e.kind === 'server')) { applyData(c); S.loaded = true; S.offline = true; S.cachedAt = c.at; }
      else if (!S.loaded && c && e.kind !== 'badpass' && e.kind !== 'notready') { applyData(c); S.loaded = true; S.offline = true; S.cachedAt = c.at; }
      else if (S.loaded) { S.offline = true; S.cachedAt = S.cachedAt || Date.now(); }          // 이미 보여 주던 자료가 최신이 아닐 수 있으니, 불러오기가 실패했을 때만 배너(성공하면 배너 없음)
      if (!quiet && S.loaded && S.offline) _toast('인터넷이 안 돼서 폰에 저장해 둔 사본을 보여 드립니다.', 3200);
    }).then(function () { S.loading = null; if (shown()) render(); if (S.link && S.loaded && !S.err) loadAch(quiet); else if (S.link && !S.ach) { var c = readAch(); if (c) { S.ach = c.items; S.achCats = c.cats || []; if (shown()) render(); } } });
    S.loading = p; return p;
  }

  /* ---------- 계산 ---------- */
  function computeOpts() { return { items: S.items, profile: S.profile || {}, rules: S.rules, today: todayStr(), ach: (S.link && S.ach) ? S.ach : null, link: !!(S.link && S.ach) }; }
  function compute() {
    if (!S.rules) return { error: 'RULES' };
    return PC.computeAll(computeOpts());
  }
  var SW = { pass: '통과', fail: '부족', unknown: '확인 전', wait: '기다리는 중' }, SIC = { pass: '✓', fail: '✗', unknown: '?', wait: '⏳' };
  function rsOf(list) { list = list || []; return S.fc ? list : list.filter(function (t) { return String(t).indexOf('아직 안 온') < 0; }); }      // O-0904 후속: 「아직 안 온 N개월…(채우면 올라갑니다)」 같은 앞날 설명은 스위치가 꺼져 있으면 감춘다
  function ymText(cut) { return cut ? (cut[0] + '.' + cut[1]) : ''; }
  function yearsText(list) {
    if (!list.length) return '';
    var ys = list.map(function (e) { return e.ay; }).sort(function (a, b) { return a - b; }), out = [], s = ys[0], p = ys[0], i;
    for (i = 1; i <= ys.length; i++) { if (ys[i] !== p + 1) { out.push(s === p ? s + '학년도' : s + '~' + p + '학년도'); s = ys[i]; } p = ys[i]; }
    return out.join(', ');
  }

  /* ---------- 화면 ---------- */
  function detailHtml(k, A) {
    var T = A.T, c = A.checks, h = '', ten = A.tenure;
    if (k === 'total') {
      h = '<b class="ph">총점 ' + fmt(c.total.value) + ' / ' + c.total.need + ' — ' + SW[c.total.s] + '</b>' + (c.total.s === 'pass'
        ? '오늘 기준(바닥값)으로도 합격선보다 ' + fmt(c.total.value - c.total.need) + '점 많습니다.' + (S.fc ? ' 임기 끝까지 예상은 ' + fmt(A.expected.total) + '점입니다.' : '')
        : '합격선까지 ' + fmt(c.total.need - c.total.value) + '점이 모자랍니다.');
    } else if (k === 'sec3') {
      h = '<b class="ph">대학발전 ' + fmt(c.sec3.value) + ' / ' + c.sec3.need + ' — ' + SW[c.sec3.s] + '</b>보직·TFT·정책연구 점수입니다. 오늘 기준은 보직을 지금까지의 재임 개월만 셉니다(재임 개월 비율).' + (S.fc ? ' 임기 끝까지 예상은 ' + fmt(A.expected.sec3) + '점입니다.' : '');
    } else if (k === 'lead') {
      h = '<b class="ph">책임저자 논문 — ' + SW[c.lead.s] + '</b>필수 요건은 SCI·등재급 책임저자(제1저자 또는 교신저자) 논문 1편 이상입니다.';
      if (c.lead.papers.length) {
        h += '<ul class="ppl">' + c.lead.papers.map(function (p) {
          var b = p.check === 'confirmed' ? '<span class="pb yes">확인됨</span>' : (p.check === 'need' ? '<span class="pb need">확인 필요</span>' : '<span class="pb asis">입력대로</span>');
          return '<li>' + esc(p.title) + ' <small>' + esc(p.journal) + ' · ' + (p.sci ? 'SCI급' : '등재급') + '</small> ' + b + '</li>';
        }).join('') + '</ul>';
      }
      h += '<div class="psub">「입력대로」는 승진 앱에 넣어 둔 분류 그대로라는 뜻입니다.' + (S.edit ? ' 논문을 눌러 열고 학술지 분류를 「확인됨」으로 바꾸면 표시가 바뀝니다.' : ' 확인이 끝나면 「확인됨」으로 바뀝니다.') + ' 예전 승진 앱 기준 책임저자 점수는 ' + fmtS(c.lead.legacyCorr) + '점(' + c.lead.legacyNeed + '점 이상이면 통과)입니다.</div>';
    } else if (k === 'eval') {
      if (c.eval.s === 'pass') {
        h = '<b class="ph">교수업적 순위 — 통과(' + c.eval.used.map(function (e) { return e.ay + '학년도'; }).join('·') + ' 기준, 부처장 재임 학년도는 평가 제외)</b>';
        h += '부처장을 하시는 동안(' + (yearsText(c.eval.exYears) || '재임 학년도') + ')은 교수업적평가에서 빠진다고 하셔서(대표님 말씀), 입력된 ' + c.eval.used.map(function (e) { return e.ay + '학년도 상위 ' + e.pct + '%'; }).join(', ') + '로 판단했습니다. 평균 상위 ' + c.eval.max + '% 이내면 통과입니다.';
      } else if (c.eval.s === 'fail') {
        h = '<b class="ph">교수업적 순위 — 부족</b>입력된 순위 평균이 상위 ' + fmt(c.eval.avg) + '%로 기준(상위 ' + c.eval.max + '% 이내)보다 낮습니다.';
      } else {
        h = '<b class="ph">교수업적 순위 — 확인 전</b>판정할 학년도 값이 없습니다' + (c.eval.exYears.length ? '(부처장 재임 학년도 ' + yearsText(c.eval.exYears) + '는 평가에서 빠집니다)' : '') + '. 교수업적 순위가 입력되면 판정합니다.' + (S.edit ? ' <button type="button" class="pbtn sm" data-go="profile">순위 넣기</button>' : '');
      }
    } else if (k === 'tenure') {
      if (ten.state === 'unknown') h = '<b class="ph">재직 6년 — 확인 전</b>현 직급 시작일(부교수 임용일)을 넣으면 승진임용 가능일을 계산해 드립니다. 아래 「승진 시기」에서 입력할 수 있습니다.';
      else if (ten.state === 'pass') h = '<b class="ph">재직 6년 — 통과</b>승진임용 가능일(' + PC.fmtDay(ten.eligible) + ')이 지났습니다. 신청 마감일을 알게 되면 아래 「승진 시기」에 넣어 둘 수 있습니다.';
      else h = '<b class="ph">재직 6년 — 기다리는 중(시간이 필요합니다)</b>시작일 ' + PC.fmtDay(ten.start) + ' 기준으로 승진임용 가능일은 <b>' + PC.fmtDay(ten.eligible) + '</b>입니다(6년 이상 재직 뒤 첫 9월 1일자). 신청은 그 해 4~5월쯤입니다. 마감일을 알게 되면 아래 「승진 시기」에 넣어 둘 수 있습니다.';
    }
    return h;
  }

  function banner() {            // 오프라인 사본 안내 줄
    if (!S.offline) return '';
    var d = S.cachedAt ? new Date(S.cachedAt) : null;
    var why = (S.err && S.err.kind === 'net') ? '오프라인 사본' : '불러오지 못해 저장해 둔 사본';
    return '<div class="pbanner"><span>' + why + (d ? ' · ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 기준' : '') + ' · 연결되면 새로 불러옵니다</span><button type="button" class="pbtn sm" id="promoRetry">다시 시도</button></div>';
  }

  function emptyHtml(kind) {
    var msg = { loading: ['불러오는 중입니다…', ''], notready: ['승진 기능이 서버에 아직 준비되지 않았습니다', '서버 준비가 끝나면 이 화면에 점수가 나옵니다.'], badpass: ['연동 암호가 맞지 않습니다', 'PC 연동 암호를 다시 입력해 주십시오.'], net: ['인터넷에 연결되지 않았습니다', '연결된 뒤 다시 시도해 주십시오.'], server: ['불러오지 못했습니다', '잠시 뒤 다시 시도해 주십시오.'], rules: ['규칙을 불러오지 못했습니다', '점수 규칙표를 못 받아서 계산하지 않았습니다(0점으로 보여 드리지 않습니다).'], none: ['아직 가져온 승진 자료가 없습니다', 'PC에서 러버블 승진 앱의 자료를 한 번 가져오면 이 화면에 점수가 나옵니다.'] }[kind] || ['불러오지 못했습니다', ''];
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
    if (S.ux) { renderMain2(A, v); return; }      // v10.19: 개편 B안(스위치 PROMO_UX_V2). 'off' 면 아래 v10.17 모양 그대로
    var T = A.T, ten = A.tenure, c = A.checks, ph = '', i, k;
    /* hero */
    ph += banner();
    ph += '<section class="pcard phero" aria-label="승진 점수 요약">';
    ph += '<p class="psay" id="promoSay">' + esc(A.say) + '</p>';
    ph += '<div class="ppair' + (S.fc ? '' : ' nofc') + '"><div><div class="plab">오늘 기준' + (S.fc ? ' <span class="pfloor">바닥값</span>' : '') + '</div><div class="pbig"><span id="pTotal">0</span><small>/ ' + T.total + '</small></div></div>';
    if (S.fc) ph += '<div><div class="plab">' + (A.expCut ? '신청 마감(' + ymText(A.expCut) + ')까지 예상' : '임기 끝까지 예상') + '</div><div class="pmid" id="pExp">0</div></div></div>';
    else {      // O-0904 후속: 앞날 추정 점수는 보이지 않는다(PROMO_FORECAST_ON='off') — 빈 자리에는 오늘 점수와 합격선의 차이(실제 값)를 둔다
      var gapV = c.total.value - c.total.need;
      ph += '<div class="pgapw"><div class="pgap' + (gapV >= 0 ? ' ok' : '') + '" id="pGap">합격선' + (gapV >= 0 ? '보다 <b>' + fmt(gapV) + '</b>점 많습니다' : '까지 <b>' + fmt(-gapV) + '</b>점 남았습니다') + '</div></div></div>';
    }
    ph += '<div class="pmeter" role="img" aria-label="합격선 대비 오늘 기준 ' + Math.round(A.today.total / T.total * 100) + '퍼센트"><i id="pMeter"></i><u></u></div><div class="pmscale"><span>0</span><span>합격선 ' + T.total + '</span><span>합격선의 ' + Math.round(A.today.total / T.total * 100) + '%</span></div>';
    var PEXP = { future: '보직 점수는 지금까지 재임한 개월만 셉니다(임기를 채우면 올라갑니다)', round: '반올림·절사를 규정대로 맞췄습니다', before: '현 직급 시작 이전 실적은 뺍니다' };
    if (S.fc) ph += '<div class="pdiff"><button type="button" class="pdiffbtn" id="pDiffBtn" aria-expanded="' + (S.diffOpen ? 'true' : 'false') + '"><span>예전 승진 앱(<b>' + fmt(A.vsLegacy.legacyTotal) + '</b>)보다 <b>' + fmt(A.vsLegacy.diff) + '점</b> 적습니다</span>' + (A.vsLegacy.parts.length ? '<i aria-hidden="true">' + (S.diffOpen ? '▴' : '▾') + '</i>' : '') + '</button>'
      + (A.vsLegacy.parts.length ? '<ul class="pdiffl" id="pDiffL"' + (S.diffOpen ? '' : ' style="display:none"') + '>' + A.vsLegacy.parts.map(function (p) { return '<li><span>' + esc(PEXP[p.key] || p.label) + '</span><b>−' + fmt(p.pts) + '</b></li>'; }).join('') + '</ul>' : '') + '</div>';
    ph += '<div class="pnote">지금 입력된 자료 기준입니다.' + (A.bonus ? ' 총장 가점 ' + A.bonus + '점이 들어 있습니다.' : '') + ' 오늘 기준은 보직을 지금(' + ymText(A.todayCut) + ')까지 재임한 개월만 센 값' + (S.fc ? '이라, 임기를 채우면 올라가는 바닥값입니다.' : '입니다.') + '</div></section>';
    /* 타일 */
    ph += '<div class="ptiles" id="pTiles">';
    ['total', 'sec3', 'lead', 'eval', 'tenure'].forEach(function (key) {
      var st = c[key].s;
      ph += '<button type="button" class="ptile ' + st + (S.sel === key ? ' sel' : '') + '" data-k="' + key + '" aria-expanded="' + (S.sel === key ? 'true' : 'false') + '" aria-controls="pDetail"><span class="pic">' + SIC[st] + '</span><span class="pt">' + esc(PC.CHECK_NAMES[key]) + '</span><span class="ps">' + SW[st] + '</span></button>';
    });
    ph += '</div><div class="pdetail' + (S.sel ? ' show' : '') + '" id="pDetail" role="region" aria-live="polite" aria-label="판정 자세히">' + (S.sel ? detailHtml(S.sel, A) : '') + '</div>';
    /* 점검할 것 — 타일 바로 아래, 접지 않음. 규정이 분명하지 않은 부분(참고)은 따로 묶어 둔다(점수에는 이미 기본값으로 넣었고 하실 일은 없다) */
    var chk = A.notes.filter(function (n) { return n.level !== 'ref'; }), refs = A.notes.filter(function (n) { return n.level === 'ref'; });
    ph += '<section class="pcard"><h3>점검할 것 <span class="pcnt">' + A.notes.filter(function (n) { return n.level === 'check'; }).length + '건</span></h3><ul class="pwarn">';
    chk.forEach(function (n) {
      var mark = n.level === 'ok' ? '<em class="okm" aria-hidden="true">✓</em>' : (n.level === 'info' ? '<em class="inm" aria-hidden="true">i</em>' : '<em aria-hidden="true">!</em>');
      ph += '<li class="' + n.level + '"><b>' + mark + esc(lbl(n.title)) + '</b><span class="psb">' + esc(lbl(n.text)) + '</span>' + (n.k === 'link_suggest' && S.edit ? '<button type="button" class="pbtn sm" data-go="suggest">확인하기</button>' : '') + '</li>';
    });
    if (!chk.length) ph += '<li class="ok"><em class="okm" aria-hidden="true">✓</em><b>점검할 것이 없습니다</b></li>';
    ph += '</ul></section>';
    if (refs.length) {
      ph += '<section class="pcard pref"><h3><button type="button" class="prefbtn" id="pRefBtn" aria-expanded="' + (S.refOpen ? 'true' : 'false') + '" aria-controls="pRefL"><span>규정이 분명하지 않은 부분 <small>(참고)</small></span><span class="pcnt">' + refs.length + '건 <i aria-hidden="true">' + (S.refOpen ? '▴' : '▾') + '</i></span></button></h3>'
        + '<p class="psb">점수에는 아래 기본값으로 이미 넣었습니다. 따로 하실 일은 없습니다.</p><ul class="pwarn" id="pRefL"' + (S.refOpen ? '' : ' style="display:none"') + '>';
      refs.forEach(function (n) { ph += '<li class="ref"><b><em class="inm" aria-hidden="true">i</em>' + esc(lbl(n.title)) + '</b><span class="psb">' + esc(lbl(n.text)) + '</span></li>'; });
      ph += '</ul></section>';
    }
    /* 승진 시기 */
    ph += '<section class="pcard ptenure"><h3>승진 시기 <button type="button" class="pbtn sm" id="promoEdit">' + (S.edit ? '승진 설정' : '날짜 고치기') + '</button></h3>';
    ph += '<div class="pl"><span>현 직급 시작일</span><b>' + (ten.start ? PC.fmtDay(ten.start) : '입력 전') + '</b></div>';
    ph += '<div class="pl"><span>승진임용 가능일 <small>(6년 채운 뒤 첫 9월 1일)</small></span><b>' + (ten.eligible ? PC.fmtDay(ten.eligible) + (ten.daysLeft > 0 ? ' · ' + ten.daysLeft.toLocaleString('ko-KR') + '일 남음' : '') : '확인 전') + '</b></div>';
    ph += '<div class="pl"><span>신청 마감 <small>(대략 4~5월)</small></span><b>' + (S.profile && S.profile.apply_deadline ? PC.fmtDay(PC.parseDay(S.profile.apply_deadline)) : (ten.deadlineYear ? ten.deadlineYear + '년 4~5월쯤 · 마감일은 아직 비어 있습니다' : '비어 있습니다')) + '</b></div></section>';
    /* 부문별 점수 */
    var secs = A.today.sections, maxV = 700, vals = [secs[4].raw];
    for (i = 1; i <= 5; i++) vals.push(secs[i].used);
    maxV = Math.max(700, Math.ceil(Math.max.apply(null, vals) / 100) * 100);
    ph += '<section class="pcard"><h3>부문별 점수</h3><div id="pBars">';
    var NAMES = S.rules.sections || {};
    for (i = 1; i <= 5; i++) {
      var sc = secs[i], nm = i + ' ' + (NAMES[i] || '');
      if (!sc.has) {
        if (S.edit) ph += '<button type="button" class="prow na" data-sec="' + i + '" aria-label="부문 ' + esc(nm) + ', 항목 없음, 눌러서 추가"><span>' + esc(nm) + '</span><div class="pnaTxt">해당 없음 · 안 채워도 됩니다 <u class="pnaAdd">＋ 추가</u></div></button>';
        else ph += '<div class="prow na"><span>' + esc(nm) + '</span><div class="pnaTxt">해당 없음 · 안 채워도 됩니다</div></div>';
        continue;
      }
      ph += '<button type="button" class="prow" data-sec="' + i + '" aria-label="부문 ' + esc(nm) + ', ' + fmtS(sc.used) + '점, 항목 보기"><span>' + esc(nm) + '</span><div class="ptrack"><div class="pghost" data-w="' + (sc.capped ? Math.min(100, sc.raw / maxV * 100) : 0) + '"></div><div class="pfill" data-w="' + Math.min(100, sc.used / maxV * 100) + '"></div>'
        + (i === 3 ? '<u style="left:' + (T.sec3 / maxV * 100) + '%"></u>' : '') + (sc.max ? '<u style="left:' + (sc.max / maxV * 100) + '%"></u>' : '') + '</div><b>' + fmtS(sc.used) + '</b></button>';
      if (sc.capped) ph += '<div class="pcap">최대 인정 ' + sc.max + '점 / 실제 쓴 점수 ' + fmtS(sc.raw) + ' — 더 써도 안 오릅니다</div>';
    }
    ph += '</div><div class="pticks"><span>▏0</span><span>▏' + T.sec3 + ' 대학발전 기준</span><span>▏' + T.sec_cap + ' 최대 인정</span></div></section>';
    if (S.edit) {
      var trashN = S.items.filter(function (x) { return x.deleted_at; }).length, sugN = (A.suggestions || []).length, linkedN = A.linkInfo ? A.linkInfo.linked : 0;
      ph += '<section class="pcard pmanage"><h3>관리</h3><div class="pmgrid">'
        + '<button type="button" class="pmbtn" data-go="sim"><b>점수 더하기 해 보기</b><small>저장 없이 점수만 계산합니다</small></button>'
        + '<button type="button" class="pmbtn" data-go="profile"><b>승진 설정</b><small>날짜·가점·교수업적 순위</small></button>'
        + (S.link ? '<button type="button" class="pmbtn" data-go="suggest"' + (sugN ? '' : ' disabled') + '><b>실적 탭 연결 제안' + (sugN ? ' ' + sugN + '건' : '') + '</b><small>' + (S.ach ? '연결된 항목 ' + linkedN + '건' : '실적 탭 자료를 못 불러왔습니다') + '</small></button>' : '')
        + '<button type="button" class="pmbtn" data-go="trash"><b>휴지통' + (trashN ? ' ' + trashN + '건' : '') + '</b><small>지운 항목 복원</small></button>'
        + '<button type="button" class="pmbtn" data-go="backup"><b>백업 내려받기</b><small>' + (S.xlsx ? '엑셀 파일로 저장합니다' : '파일로 저장·공유합니다') + '</small></button></div></section>';
    }
    ph += '<p class="pfoot">참고 계산이며 공식 판정이 아닙니다 · 규정판 ' + esc(S.rulesVer || '') + ' · 규정 방식(반올림, 보직은 재임 개월 비율을 내림)</p>';
    v.innerHTML = ph;
    /* 이벤트 */
    var tiles = v.querySelectorAll('.ptile');
    for (i = 0; i < tiles.length; i++) tiles[i].onclick = function () { var kk = this.getAttribute('data-k'); S.sel = (S.sel === kk) ? '' : kk; render(); var d = $('pDetail'); if (d && S.sel) d.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); };
    var rows = v.querySelectorAll('.prow[data-sec]');
    for (i = 0; i < rows.length; i++) rows[i].onclick = function () { S.sec = parseInt(this.getAttribute('data-sec'), 10); render(); try { v.scrollTop = 0; window.scrollTo(0, 0); } catch (e) {} };
    var ed = $('promoEdit'); if (ed) ed.onclick = function () { if (S.edit) PE().openProfile(); else openSheet(); };
    var rb2 = $('pRefBtn'); if (rb2) rb2.onclick = function () { S.refOpen = !S.refOpen; var l = $('pRefL'); if (l) l.style.display = S.refOpen ? '' : 'none'; this.setAttribute('aria-expanded', S.refOpen ? 'true' : 'false'); var ic = this.querySelector('i'); if (ic) ic.textContent = S.refOpen ? '▴' : '▾'; };
    wireGo(v);
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
    var fills = v.querySelectorAll('.pfill, .pghost, .pxf, .pxg'), j;
    var key = A.today.total + '|' + A.expected.total + '|' + S.rev, again = (S.lastAnim === key);       // 같은 값을 다시 그릴 때(타일 누르기 등)는 효과를 되풀이하지 않는다
    S.lastAnim = key; v.classList.toggle('pxfirst', !again);      // v10.19: 통과 ✓ 팝은 처음 그릴 때만
    if (again) { var tt = $('pTotal'), ee = $('pExp'); if (tt) tt.textContent = fmt(A.today.total); if (ee) ee.textContent = fmt(A.expected.total); if (m) { m.style.transition = 'none'; m.style.width = mw + '%'; } for (j = 0; j < fills.length; j++) { fills[j].style.transition = 'none'; fills[j].style.width = fills[j].getAttribute('data-w') + '%'; } return; }
    countTo($('pTotal'), A.today.total); countTo($('pExp'), A.expected.total);
    if (calm()) { if (m) m.style.width = mw + '%'; for (j = 0; j < fills.length; j++) fills[j].style.width = fills[j].getAttribute('data-w') + '%'; return; }
    if (animTimer) clearTimeout(animTimer);
    animTimer = setTimeout(function () { if (m) m.style.width = mw + '%'; for (j = 0; j < fills.length; j++) (function (f, k) { setTimeout(function () { f.style.width = f.getAttribute('data-w') + '%'; }, k * 25); })(fills[j], j); }, 45);
  }

  /* ---------- v10.19: 승진 화면 개편 B안 「한눈 요약 + 부문 접이식」 (스위치 PROMO_UX_V2 — 'off' 면 위의 render()·아래 renderSection() 그대로, 즉 v10.17 모양) ----------
   * 점수·판정·점검 안내는 PC.computeAll 이 준 것을 그대로 그린다(계산은 바꾸지 않음). 이 블록은 「어떻게 보여 주나」만 다시 짠 것이다. */
  var ICO = {
    unk: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5"/><path d="M7.9 8a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.8-1.1 1.6" stroke-linecap="round"/><circle cx="10" cy="14.2" r=".6" fill="currentColor"/></svg>',
    exc: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5"/><path d="M4.8 15.2 15.2 4.8"/></svg>',
    dup: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="3" y="6" width="9.5" height="9.5" rx="2"/><path d="M7.5 4.5A2 2 0 0 1 9.5 3H15a2 2 0 0 1 2 2v5.5a2 2 0 0 1-1.5 2"/></svg>',
    part: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5"/><path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none"/></svg>',
    clip: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M13.5 7 8 12.6a1.8 1.8 0 0 0 2.6 2.5l6-6.2a3.5 3.5 0 0 0-5-5L5.4 10.2a5.2 5.2 0 0 0 7.4 7.4"/></svg>',
    chev: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 8 5 5 5-5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 12h8m-8 0 3-3m-3 3 3 3M16 7v10m4-10v10"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    bin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>'
  };
  function ico(k) { return '<span class="px-mk m-' + k + '" aria-hidden="true">' + ICO[k] + '</span>'; }
  function catOf(r) {          // 항목 한 줄 앞의 표시 하나(우선순위: 중복 의심 > 확인 전 > 점수 제외 > 일부 인정 > 정상)
    if (r.flags.dup_suspect) return 'dup';
    if (r.flags.unverified) return 'unk';
    if (r.status === 'excluded' || r.status === 'before') return 'exc';
    if (r.status === 'partial') return 'part';
    return 'in';
  }
  var CATTXT = { unk: '확인 전', exc: '점수 제외', dup: '중복 의심', part: '부분 인정', 'in': '' };
  var FILTERS = [['all', '전체'], ['unk', '확인 전'], ['exc', '제외'], ['dup', '중복 의심']];
  function filterHit(f, r) {
    if (f === 'unk') return !!r.flags.unverified;
    if (f === 'exc') return r.status === 'excluded' || r.status === 'before';
    if (f === 'dup') return !!r.flags.dup_suspect;
    return true;
  }
  function dateMeta(it) {      // 제목에 날짜가 안 든 종류만 날짜를 따로 보여 준다(제목에 이미 든 종류는 중복 표시 안 함)
    var c = it.item_code, v = isObj(it.value) ? it.value : {};
    if (/^(1-1|1-2|1-4|1-6|3-1|4-1|4-2)$/.test(c)) return '';
    if (c === '3-3' && !(Number(v.endYear) || Number(v.completionYear))) return '날짜 없음';
    if (it.academic_year) return it.academic_year + '학년도';
    var y = v.endYear || v.completionYear || v.year || v.startYear;
    return y ? String(y) : '';
  }
  function hasPdf(it) { var ev = isObj(it.evidence) ? it.evidence : null; return !!(ev && Array.isArray(ev.files) && ev.files.some(function (f) { return f && f.fid; })); }
  function pxRow(r, code, idx) {
    var R = S.rules, cat = catOf(r), meta = [], words = [], sc1 = r.score, label = PC.rowLabel(r.it, R), rs = rsOf(r.reasons), zero = (r.status === 'excluded' || r.status === 'before');
    if (code === '1-1' && r.part !== null && r.part !== undefined) sc1 = r.part;
    var scTxt = zero ? '0' : fmtS(sc1);
    var dm = dateMeta(r.it); if (dm) meta.push(esc(dm));
    if (r.status === 'partial') words.push('부분 인정');
    if (r.flags.unverified && r.status === 'in') words.push('확인 전');
    if (r.flags.dup_suspect && r.status === 'in') words.push('중복 의심');
    if (r.flags.series) words.push('같은 사업 연차별');
    if (r.flags.term_confirmed) words.push('임기 확인됨');
    if (r.flags.corrected) words.push('정정해 가져옴');
    if (words.length) meta.push('<span class="px-w">' + esc(words.join(' · ')) + '</span>');
    if (rs.length && r.status !== 'in') meta.push(esc(lbl(rs.join(' · '))));
    else if (code === '3-1') meta.push('재임 ' + r.months + '개월 인정' + (r.monthsRaw !== r.months ? ' (입력 ' + r.monthsRaw + '개월)' : '') + (rs.length ? ' · ' + esc(lbl(rs.join(' · '))) : ''));
    var pdf = hasPdf(r.it);
    var inner = '<span class="px-ld">' + (cat === 'in' ? '<i class="px-dot" aria-hidden="true"></i>' : ico(cat)) + '</span><span class="px-tx"><span class="px-t">' + esc(label) + '</span>'
      + ((meta.length || pdf) ? '<span class="px-m">' + meta.join('<span class="px-sep" aria-hidden="true"> · </span>') + (pdf ? '<span class="px-pdf">' + ico('clip') + '<span class="px-sr">증빙 PDF 있음</span></span>' : '') + '</span>' : '')
      + '</span><b class="px-p' + (zero ? ' x' : '') + '">' + scTxt + '<span class="px-sr">점</span></b>';
    var cls = 'px-it' + (zero ? ' x' : ''), st = idx < 6 ? ' style="--i:' + idx + '"' : '';
    if (S.edit) return '<button type="button" class="plrow ' + cls + (S.flashId === r.id ? ' flash' : '') + '"' + st + ' data-id="' + esc(r.id) + '" data-code="' + code + '" aria-label="' + esc(label + (CATTXT[cat] ? ', ' + CATTXT[cat] : '') + ', ' + scTxt + '점 — 고치기') + '">' + inner + '</button>';
    return '<div class="' + cls + '"' + st + '>' + inner + '</div>';
  }
  function pxCodes(s, A) {
    var codes = [], R = S.rules;
    A.today.rows.forEach(function (r) { if (parseInt(r.code.charAt(0), 10) === s && codes.indexOf(r.code) < 0) codes.push(r.code); });
    if (S.edit) Object.keys(R.names || {}).forEach(function (c) { if (parseInt(c.charAt(0), 10) === s && codes.indexOf(c) < 0) codes.push(c); });
    return codes.sort();
  }
  function pxGroupHead(code, tot, n) {
    var R = S.rules;
    return '<div class="px-grp"><span class="px-gn"><b>' + esc(code + ' ' + ((R.names || {})[code] || '')) + '</b><small>' + (n === null ? '' : fmtS(tot) + '점 · ' + n + '건') + '</small></span>'
      + (S.edit ? '<button type="button" class="px-add" data-add="' + code + '" aria-label="' + esc(code + ' 항목 추가') + '">＋ 추가</button>' : '') + '</div>';
  }
  function pxAcc(i, A, maxV, f) {
    var secs = A.today.sections, sc = secs[i], T = A.T, R = S.rules, codes = pxCodes(i, A), body = '', idx = 0, matched = 0, cnt = 0, h;
    codes.forEach(function (code) {
      var all = A.today.rows.filter(function (r) { return r.code === code; }), rows = all.filter(function (r) { return filterHit(f, r); }), tot = A.today.itemTotals[code] || 0, lim = 99, more = 0;
      cnt += all.length;
      if (f !== 'all' && !rows.length) return;
      rows.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
      if (f === 'all' && rows.length > 6 && !S.more[code]) { lim = 5; more = rows.length - 5; }
      body += pxGroupHead(code, tot, all.length);
      if (!rows.length) body += '<div class="px-none">아직 넣은 항목이 없습니다.</div>';
      rows.slice(0, lim).forEach(function (r) { body += pxRow(r, code, idx++); });
      if (more) body += '<button type="button" class="px-more" data-more="' + code + '">나머지 ' + more + '건 보기 ' + ico('chev') + '</button>';
      matched += rows.length;
    });
    if (f !== 'all' && !matched) return '';
    var open = f !== 'all' || !!S.open[i], cap = '';
    if (sc.capped) cap = '<span class="px-cap warn">최대 ' + sc.max + '점까지 인정 · 실제 ' + fmtS(sc.raw) + '점 — 더 써도 안 오릅니다</span>';
    else if (sc.max && i !== 3) cap = '<span class="px-cap">세로선 = 최대 인정 ' + sc.max + '점</span>';
    if (i === 3) cap += '<span class="px-cap">세로선 = 대학발전 기준 ' + T.sec3 + '점</span>';
    var nm = (R.sections || {})[i] || '';
    h = '<section class="px-acc' + (open ? ' open' : '') + '" data-sec="' + i + '" style="--c:var(--sc' + i + ')"><button type="button" class="px-hd" data-sec="' + i + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="pxb' + i + '" aria-label="부문 ' + i + ' ' + esc(nm) + ', ' + fmtS(sc.used) + '점, ' + cnt + '건">'
      + '<span class="px-h1"><span class="px-no" aria-hidden="true">' + i + '</span><span class="px-nm">' + esc(nm) + '<small>' + cnt + '건</small></span><b class="px-sc">' + fmtS(sc.used) + '</b><span class="px-chev" aria-hidden="true">' + ICO.chev + '</span></span>'
      + '<span class="px-tr"><span class="px-track" aria-hidden="true"><span class="pxg" data-w="' + (sc.capped ? Math.min(100, sc.raw / maxV * 100) : 0) + '"></span><span class="pxf" data-w="' + Math.min(100, sc.used / maxV * 100) + '"></span>'
      + (i === 3 ? '<u style="left:' + (T.sec3 / maxV * 100) + '%"></u>' : '') + (sc.max ? '<u style="left:' + (sc.max / maxV * 100) + '%"></u>' : '') + '</span></span>' + cap
      + '</button><div class="px-bd" id="pxb' + i + '"><div>' + body + '</div></div></section>';
    return h;
  }
  function checkLists(A) {
    return { chk: A.notes.filter(function (n) { return n.level === 'check'; }), oth: A.notes.filter(function (n) { return n.level === 'ok' || n.level === 'info'; }), refs: A.notes.filter(function (n) { return n.level === 'ref'; }) };
  }
  function noteLi(n) {
    var mark = n.level === 'ok' ? '<em class="okm" aria-hidden="true">✓</em>' : (n.level === 'info' ? '<em class="inm" aria-hidden="true">i</em>' : '<em aria-hidden="true">!</em>');
    return '<li class="' + n.level + '"><b>' + mark + esc(lbl(n.title)) + '</b><span class="psb">' + esc(lbl(n.text)) + '</span>' + (n.k === 'link_suggest' && S.edit ? '<button type="button" class="pbtn sm" data-go="suggest">확인하기</button>' : '') + '</li>';
  }
  function openChecks() {      // 「확인할 것」 시트 — 하실 일(check) · 안내(ok/info) · 참고(규정이 분명하지 않은 부분, 접이식). 문구는 계산 파일이 준 것 그대로.
    var L = $('promoLayer'), A = compute(); if (!L || A.error) return;
    var ls = checkLists(A), h = '';
    S.pxSheet = true;
    h += '<div class="pscrim" id="promoScrim"></div><div class="psheet pxsheet' + (calm() ? ' pcalm' : '') + '" role="dialog" aria-label="확인할 것"><div class="psh-hd"><h4 id="pxShT" tabindex="-1">확인할 것 ' + ls.chk.length + '건</h4><button type="button" class="psh-x" id="pxShX" aria-label="닫기">✕</button></div>';
    h += ls.chk.length ? '<ul class="pwarn">' + ls.chk.map(noteLi).join('') + '</ul>' : '<p class="psnote">지금 하실 일은 없습니다.</p>';
    if (ls.oth.length) h += '<h5 class="px-sh5">안내</h5><ul class="pwarn">' + ls.oth.map(noteLi).join('') + '</ul>';
    if (ls.refs.length) {
      h += '<h5 class="px-sh5"><button type="button" class="prefbtn" id="pRefBtn" aria-expanded="' + (S.refOpen ? 'true' : 'false') + '" aria-controls="pRefL"><span>규정이 분명하지 않은 부분 <small>(참고)</small></span><span class="pcnt">' + ls.refs.length + '건 <i aria-hidden="true">' + (S.refOpen ? '▴' : '▾') + '</i></span></button></h5>'
        + '<p class="psb">점수에는 아래 기본값으로 이미 넣었습니다. 따로 하실 일은 없습니다.</p><ul class="pwarn" id="pRefL"' + (S.refOpen ? '' : ' style="display:none"') + '>' + ls.refs.map(function (n) { return '<li class="ref"><b><em class="inm" aria-hidden="true">i</em>' + esc(lbl(n.title)) + '</b><span class="psb">' + esc(lbl(n.text)) + '</span></li>'; }).join('') + '</ul>';
    }
    h += '</div>';
    L.innerHTML = h; L.classList.add('show');
    $('promoScrim').onclick = closeSheet; $('pxShX').onclick = closeSheet;
    var rb = $('pRefBtn'); if (rb) rb.onclick = function () { S.refOpen = !S.refOpen; var l = $('pRefL'); if (l) l.style.display = S.refOpen ? '' : 'none'; this.setAttribute('aria-expanded', S.refOpen ? 'true' : 'false'); var ic = this.querySelector('i'); if (ic) ic.textContent = S.refOpen ? '▴' : '▾'; };
    var sg = L.querySelector('[data-go="suggest"]'); if (sg) sg.onclick = function () { closeSheet(); if (PE() && S.edit) PE().openSuggest(); };
    try { $('pxShT').focus({ preventScroll: true }); } catch (e) {}
  }
  function renderMain2(A, v) {
    var T = A.T, ten = A.tenure, c = A.checks, R = S.rules, secs = A.today.sections, ph = '', i, f = S.filter || 'all';
    var gapV = c.total.value - c.total.need, st = c.total.s, pctTot = Math.round(A.today.total / T.total * 100);
    ph += banner();
    /* 맨 위 한 카드 — 오늘 점수 하나만 크게 */
    ph += '<section class="pcard phero px-hero" aria-label="승진 점수 요약"><p class="px-sr" id="promoSay">' + esc(A.say) + '</p>';
    ph += '<div class="px-l1"><span class="plab">오늘 기준 승진 점수</span><button type="button" class="px-chip ' + st + (S.sel === 'total' ? ' sel' : '') + '" data-k="total" aria-expanded="' + (S.sel === 'total' ? 'true' : 'false') + '" aria-controls="pDetail"><span class="px-ci" aria-hidden="true">' + SIC[st] + '</span>합격선 ' + SW[st] + '</button></div>';
    ph += '<div class="pbig"><span id="pTotal">0</span><small>/ ' + T.total + '</small></div>';
    ph += '<div class="pmeter" role="img" aria-label="합격선 대비 오늘 기준 ' + pctTot + '퍼센트"><i id="pMeter"></i><u></u></div>';
    ph += '<div class="px-gaprow"><span class="px-gap' + (gapV >= 0 ? ' ok' : '') + '" id="pGap">합격선' + (gapV >= 0 ? '보다 <b>' + fmt(gapV) + '</b>점 많습니다' : '까지 <b>' + fmt(-gapV) + '</b>점 남았습니다') + '</span><span class="px-gapn">합격선 ' + T.total + ' · ' + pctTot + '%</span></div>';
    ph += '<div class="px-tiles" id="pTiles">';
    ['sec3', 'lead', 'eval', 'tenure'].forEach(function (key) {
      var s2 = c[key].s, nm = key === 'tenure' ? '재직 6년' : PC.CHECK_NAMES[key], stt = (key === 'tenure' && s2 === 'wait' && ten.eligible) ? PC.fmtDay(ten.eligible) : SW[s2];
      ph += '<button type="button" class="px-tile ' + s2 + (S.sel === key ? ' sel' : '') + '" data-k="' + key + '" aria-expanded="' + (S.sel === key ? 'true' : 'false') + '" aria-controls="pDetail" aria-label="' + esc(nm + ', ' + SW[s2] + (stt !== SW[s2] ? ', ' + stt : '')) + '"><span class="px-tn">' + esc(nm) + '</span><span class="px-ts"><i class="px-ti" aria-hidden="true">' + SIC[s2] + '</i>' + esc(stt) + '</span></button>';
    });
    ph += '</div><div class="pdetail' + (S.sel ? ' show' : '') + '" id="pDetail" role="region" aria-live="polite" aria-label="판정 자세히">' + (S.sel ? detailHtml(S.sel, A) : '') + '</div>';
    ph += '<div class="pnote">지금 입력된 자료 기준입니다.' + (A.bonus ? ' 총장 가점 ' + A.bonus + '점이 들어 있습니다.' : '') + ' 오늘 기준은 보직을 지금(' + ymText(A.todayCut) + ')까지 재임한 개월만 센 값입니다.</div></section>';
    /* 확인할 것 — 하실 일만 한 줄 */
    var ls = checkLists(A), nChk = ls.chk.length, nRest = ls.oth.length + ls.refs.length;
    if (nChk) ph += '<button type="button" class="px-alert" id="pxChecks" aria-haspopup="dialog"><i class="px-dot" aria-hidden="true"></i><span class="px-at"><b>확인할 것 ' + nChk + '건</b><small>' + esc(ls.chk.map(function (n) { return lbl(n.title).split(' — ')[0]; }).join(' · ')) + (nRest ? ' · 안내·참고 ' + nRest + '건' : '') + '</small></span><span class="px-ar" aria-hidden="true">›</span></button>';
    else if (nRest) ph += '<button type="button" class="px-alert calmrow" id="pxChecks" aria-haspopup="dialog"><i class="px-dot ok" aria-hidden="true"></i><span class="px-at"><b>지금 하실 일은 없습니다</b><small>안내·참고 ' + nRest + '건 보기</small></span><span class="px-ar" aria-hidden="true">›</span></button>';
    /* 부문별 점수 */
    var vals = [secs[4].raw], maxV;
    for (i = 1; i <= 5; i++) vals.push(secs[i].used);
    maxV = Math.max(700, Math.ceil(Math.max.apply(null, vals) / 100) * 100);
    var nUnk = 0, nExc = 0, nDup = 0;
    A.today.rows.forEach(function (r) { if (filterHit('unk', r)) nUnk++; if (filterHit('exc', r)) nExc++; if (filterHit('dup', r)) nDup++; });
    var cnts = { all: null, unk: nUnk, exc: nExc, dup: nDup };
    ph += '<div class="px-sechd"><h3>부문별 점수</h3></div><div class="px-chips" role="group" aria-label="항목 걸러 보기">' + FILTERS.map(function (x) {
      return '<button type="button" class="px-cp' + (f === x[0] ? ' on' : '') + '" data-f="' + x[0] + '" aria-pressed="' + (f === x[0] ? 'true' : 'false') + '">' + (x[0] === 'all' ? '' : ico(x[0])) + x[1] + (cnts[x[0]] !== null ? ' <em>' + cnts[x[0]] + '</em>' : '') + '</button>';
    }).join('') + '</div>';
    var accs = '', emptyIdx = [];
    for (i = 1; i <= 5; i++) { if (!secs[i].has) { emptyIdx.push(i); continue; } accs += pxAcc(i, A, maxV, f); }
    if (f !== 'all' && !accs) ph += '<div class="px-nores" role="status">해당하는 항목이 없습니다.</div>';
    ph += accs;
    if (f === 'all' && emptyIdx.length) {
      ph += '<div class="px-empty"><i class="px-dot dim" aria-hidden="true"></i><div class="px-tx"><b>' + emptyIdx.map(function (n) { return '부문 ' + n + ' ' + esc((R.sections || {})[n] || ''); }).join(' · ') + '</b><br>비어 있습니다 · 안 채워도 됩니다</div>' + (S.edit ? '<button type="button" class="px-add" id="pxEmptyBtn" aria-expanded="' + (S.emptyOpen ? 'true' : 'false') + '" aria-controls="pxEmptyBody">＋ 추가</button>' : '') + '</div>';
      if (S.edit && S.emptyOpen) {
        ph += '<div class="px-emptybody" id="pxEmptyBody">' + emptyIdx.map(function (n) {
          return '<section class="px-acc open" style="--c:var(--sc' + n + ')"><div class="px-ehd"><span class="px-no" aria-hidden="true">' + n + '</span><b>' + esc((R.sections || {})[n] || '') + '</b></div><div class="px-bd"><div>' + pxCodes(n, A).map(function (code) { return pxGroupHead(code, 0, null); }).join('') + '</div></div></section>';
        }).join('') + '</div>';
      }
    }
    ph += '<p class="px-legend">' + ico('unk') + ' 확인 전 &nbsp;' + ico('exc') + ' 제외 &nbsp;' + ico('dup') + ' 중복 의심 &nbsp;' + ico('part') + ' 일부 인정 &nbsp;' + ico('clip') + ' 증빙 PDF</p>';
    /* 승진 일정 — 표 3줄 */
    var dl = S.profile && S.profile.apply_deadline ? PC.fmtDay(PC.parseDay(S.profile.apply_deadline)) : (ten.deadlineYear ? ten.deadlineYear + '년 4~5월쯤' : '비어 있습니다');
    var kv = [['현 직급 시작일', ten.start ? PC.fmtDay(ten.start) : '입력 전', '부교수 승진 발령일입니다.'],
      ['승진임용 가능일', ten.eligible ? PC.fmtDay(ten.eligible) + (ten.daysLeft > 0 ? ' · ' + ten.daysLeft.toLocaleString('ko-KR') + '일 남음' : '') : '확인 전', '6년을 채운 뒤 첫 9월 1일입니다.'],
      ['신청 마감', dl, '대략 4~5월입니다.' + (S.profile && S.profile.apply_deadline ? '' : ' 마감일은 아직 비어 있습니다 — 알게 되면 「' + (S.edit ? '승진 설정' : '날짜 고치기') + '」에서 넣을 수 있습니다.')]];
    ph += '<section class="pcard ptenure px-sched"><h3>승진 일정 <button type="button" class="pbtn sm" id="promoEdit">' + (S.edit ? '승진 설정' : '날짜 고치기') + '</button></h3>';
    kv.forEach(function (x, k) { ph += '<div class="px-kv"><span>' + x[0] + '<button type="button" class="px-i" data-hint="' + k + '" aria-label="' + x[0] + ' 설명" aria-expanded="' + (S.hint[k] ? 'true' : 'false') + '">ⓘ</button></span><b>' + esc(x[1]) + '</b></div><div class="px-hint" id="pxh' + k + '"' + (S.hint[k] ? '' : ' hidden') + '>' + esc(x[2]) + '</div>'; });
    ph += '</section>';
    /* 도구 */
    if (S.edit) {
      var trashN = S.items.filter(function (x) { return x.deleted_at; }).length, sugN = (A.suggestions || []).length, linkedN = A.linkInfo ? A.linkInfo.linked : 0;
      ph += '<section class="pcard pmanage px-tools"><h3>도구</h3><div class="px-tg">'
        + '<button type="button" class="px-tool" data-go="sim">' + ico('undo') + '<span>점수 더하기 해 보기</span></button>'
        + '<button type="button" class="px-tool" data-go="profile">' + ico('gear') + '<span>승진 설정</span></button>'
        + (S.link ? '<button type="button" class="px-tool" data-go="suggest"' + (sugN ? '' : ' disabled') + '>' + ico('link') + '<span>실적 탭 연결 제안' + (sugN ? ' ' + sugN + '건' : '') + '<small>' + (S.ach ? '연결된 항목 ' + linkedN + '건' : '실적 탭 자료를 못 불러왔습니다') + '</small></span></button>' : '')
        + '<button type="button" class="px-tool" data-go="trash">' + ico('bin') + '<span>휴지통' + (trashN ? '<em>' + trashN + '건</em>' : '') + '</span></button>'
        + '<button type="button" class="px-tool" data-go="backup">' + ico('dl') + '<span>백업 내려받기<small>' + (S.xlsx ? '엑셀 파일로 저장합니다' : '파일로 저장·공유합니다') + '</small></span></button></div></section>';
    }
    ph += '<p class="pfoot">참고 계산이며 공식 판정이 아닙니다 · 규정판 ' + esc(S.rulesVer || '') + ' · 규정 방식(반올림, 보직은 재임 개월 비율을 내림)</p>';
    var se = document.scrollingElement || document.documentElement, y0 = se ? se.scrollTop : 0;
    v.classList.add('px2'); v.classList.toggle('pcalm', calm());
    v.innerHTML = ph;
    try { if (se) se.scrollTop = y0; } catch (e) {}
    /* 이벤트 */
    var els = v.querySelectorAll('.px-tile, .px-chip[data-k]');
    for (i = 0; i < els.length; i++) els[i].onclick = function () { var kk = this.getAttribute('data-k'); S.sel = (S.sel === kk) ? '' : kk; render(); var d = $('pDetail'); if (d && S.sel) d.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); };
    var hds = v.querySelectorAll('.px-hd');
    for (i = 0; i < hds.length; i++) hds[i].onclick = function () {
      var n = parseInt(this.getAttribute('data-sec'), 10), acc = this.parentNode, on = !acc.classList.contains('open');
      S.open[n] = on; acc.classList.toggle('open', on); this.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on && !calm()) { acc.classList.add('rise'); setTimeout(function () { acc.classList.remove('rise'); }, 700); }
    };
    var cps = v.querySelectorAll('.px-cp');
    for (i = 0; i < cps.length; i++) cps[i].onclick = function () { var nf = this.getAttribute('data-f'); S.filter = (S.filter === nf && nf !== 'all') ? 'all' : nf; render(); };
    var mores = v.querySelectorAll('.px-more');
    for (i = 0; i < mores.length; i++) mores[i].onclick = function () { S.more[this.getAttribute('data-more')] = true; render(); };
    var ca = $('pxChecks'); if (ca) ca.onclick = openChecks;
    var eb = $('pxEmptyBtn'); if (eb) eb.onclick = function () { S.emptyOpen = !S.emptyOpen; render(); };
    var hints = v.querySelectorAll('.px-i');
    for (i = 0; i < hints.length; i++) hints[i].onclick = function () { var k = this.getAttribute('data-hint'), box = $('pxh' + k); S.hint[k] = !S.hint[k]; if (box) box.hidden = !S.hint[k]; this.setAttribute('aria-expanded', S.hint[k] ? 'true' : 'false'); };
    var ed = $('promoEdit'); if (ed) ed.onclick = function () { if (S.edit) PE().openProfile(); else openSheet(); };
    wireGo(v); wireRetry();
    animate(A, v);
  }

  /* ---------- 부문 화면(항목 목록 · v9.63 부터 눌러서 고치고 ＋로 추가) ---------- */
  var TAGS = { excluded: '기본 점수 제외', before: '현 직급 이전', partial: '부분 인정' };
  function PE() { return global.PromoEdit; }
  function renderSection() {
    var v = view(), A = compute(); if (!v || A.error) { S.sec = 0; render(); return; }
    var s = S.sec, sc = A.today.sections[s], R = S.rules, h = '', codes = [], i;
    A.today.rows.forEach(function (r) { if (parseInt(r.code.charAt(0), 10) === s && codes.indexOf(r.code) < 0) codes.push(r.code); });
    if (S.edit) Object.keys(R.names || {}).forEach(function (c) { if (parseInt(c.charAt(0), 10) === s && codes.indexOf(c) < 0) codes.push(c); });
    codes.sort();
    var mmIds = {}; if (A.linkInfo) A.linkInfo.mismatch.forEach(function (m) { mmIds[m.id] = m.fields.join('·'); });
    h += '<section class="pcard"><h3>부문 ' + s + ' · ' + esc((R.sections || {})[s] || '') + '</h3><div class="pbig sm"><span>' + fmt(sc.used) + '</span>' + (sc.max ? '<small>/ 최대 ' + sc.max + '</small>' : '') + '</div>';
    if (sc.capped) h += '<div class="pcap">최대 인정 ' + sc.max + '점 / 실제 쓴 점수 ' + fmtS(sc.raw) + ' — 더 써도 안 오릅니다</div>';
    h += '<div class="pnote">오늘 기준(' + ymText(A.todayCut) + ') · ' + (S.edit ? '항목을 누르면 고칠 수 있고, ＋로 새 항목을 넣을 수 있습니다.' : '읽기만 되는 화면입니다.') + '</div></section>';
    codes.forEach(function (code) {
      var rows = A.today.rows.filter(function (r) { return r.code === code; }), tot = A.today.itemTotals[code] || 0;
      h += '<section class="pcard"><h3><span>' + esc(code + ' ' + ((R.names || {})[code] || '')) + ' <span class="pcnt">' + fmtS(tot) + '점 · ' + rows.length + '건</span></span>' + (S.edit ? '<button type="button" class="pbtn sm" data-add="' + code + '" aria-label="' + esc(code + ' 항목 추가') + '">＋ 추가</button>' : '') + '</h3><ul class="plist">';
      rows.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
      if (!rows.length) h += '<li class="psb pnone">아직 넣은 항목이 없습니다.</li>';
      rows.forEach(function (r) {
        var tags = [];
        if (r.status !== 'in' && TAGS[r.status]) tags.push('<span class="ptag t-' + r.status + '">' + TAGS[r.status] + '</span>');
        if (r.flags.unverified) tags.push('<span class="ptag t-unv">확인 전</span>');
        if (r.flags.dup_suspect) tags.push('<span class="ptag t-dup">중복 의심</span>');
        if (r.flags.series) tags.push('<span class="ptag t-ser">같은 사업 연차별</span>');
        if (r.flags.term_confirmed) tags.push('<span class="ptag t-ok">임기 확인됨</span>');
        if (r.flags.corrected) tags.push('<span class="ptag t-cor">정정해 가져옴</span>');
        if (r.it._link) tags.push('<span class="ptag t-link">실적 탭 연결</span>');
        if (mmIds[r.id]) tags.push('<span class="ptag t-dup">실적 탭과 ' + esc(mmIds[r.id]) + ' 다름</span>');
        var sc1 = r.score; if (code === '1-1' && r.part !== null && r.part !== undefined) sc1 = r.part;
        var inner = '<div class="pl1"><span class="plb">' + esc(PC.rowLabel(r.it, R)) + '</span><b class="psc">' + (r.status === 'excluded' || r.status === 'before' ? '0' : fmtS(sc1)) + '</b></div>';
        if (tags.length) inner += '<div class="ptags">' + tags.join('') + '</div>';
        var rs = rsOf(r.reasons);
        if (rs.length && r.status !== 'in') inner += '<div class="psb">' + esc(rs.join(' · ')) + '</div>';
        else if (code === '3-1') inner += '<div class="psb">재임 ' + r.months + '개월 인정' + (r.monthsRaw !== r.months ? ' (입력 ' + r.monthsRaw + '개월)' : '') + (rs.length ? ' · ' + esc(rs.join(' · ')) : '') + '</div>';
        h += '<li' + (S.flashId === r.id ? ' class="flash"' : '') + '>' + (S.edit ? '<button type="button" class="plrow" data-id="' + esc(r.id) + '" data-code="' + code + '" aria-label="' + esc(PC.rowLabel(r.it, R) + ' — 고치기') + '">' + inner + '</button>' : inner) + '</li>';
      });
      h += '</ul></section>';
    });
    if (!codes.length) h += '<section class="pcard"><p class="pnote">이 부문에는 입력된 실적이 없습니다.</p></section>';
    v.innerHTML = banner() + h;
    wireRetry(); wireGo(v);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function wireGo(v) {
    v.onclick = function (ev) {
      var b = ev.target, pe = PE(); while (b && b !== v && !(b.getAttribute && (b.getAttribute('data-go') || b.getAttribute('data-add') || (b.classList && b.classList.contains('plrow'))))) b = b.parentNode;
      if (!b || b === v || !pe || !S.edit || b.disabled) return;
      var go = b.getAttribute('data-go'), add = b.getAttribute('data-add');
      if (go === 'sim') pe.openSimPicker(); else if (go === 'profile') pe.openProfile(); else if (go === 'suggest') pe.openSuggest(); else if (go === 'trash') pe.openTrash(); else if (go === 'backup') pe.openBackup();
      else if (add) pe.openNew(add, { opener: b });
      else if (b.classList.contains('plrow')) pe.openItem(b.getAttribute('data-code'), b.getAttribute('data-id'), { opener: b });
    };
  }

  /* ---------- 날짜 고치기(현 직급 시작일·신청 마감일) ---------- */
  function openSheet() {
    var L = $('promoLayer'); if (!L) return;
    var p = S.profile || {}, ds = p.rank_start || '', dd = p.apply_deadline || '';
    S.sheet = true; S.clearOk = false;
    L.innerHTML = '<div class="pscrim" id="promoScrim"></div><div class="psheet" role="dialog" aria-label="승진 시기 날짜"><h4>승진 시기 날짜</h4>'
      + '<label>현 직급 시작일 <small>(부교수 승진 발령일)</small><input type="date" id="promoRs" value="' + esc(ds) + '"></label>'
      + '<label>신청 마감일 <small>(알게 되면 · 모르면 비워 두십시오)</small><input type="date" id="promoDl" value="' + esc(dd) + '"></label>'
      + '<div class="psmsg" id="promoMsg"></div><div class="pbtns"><button type="button" class="pbtn ghost" id="promoCancel">닫기</button><button type="button" class="pbtn" id="promoSave">저장</button></div></div>';
    L.classList.add('show');
    $('promoScrim').onclick = closeSheet; $('promoCancel').onclick = closeSheet; $('promoSave').onclick = saveDates;
    $('promoRs').oninput = $('promoRs').onchange = function () { S.clearOk = false; var b = $('promoSave'); if (b) b.textContent = '저장'; var m = $('promoMsg'); if (m && /비우/.test(m.textContent)) m.textContent = ''; };
  }
  function closeSheet() { var L = $('promoLayer'); S.sheet = false; S.pxSheet = false; if (L) { L.classList.remove('show'); L.innerHTML = ''; } }
  function saveDates() {
    if (S.saving) return;
    var rs = $('promoRs').value || null, dl = $('promoDl').value || null, msg = $('promoMsg');
    if (rs && !PC.parseDay(rs)) { msg.textContent = '시작일 날짜를 확인해 주십시오.'; return; }
    if (dl && !PC.parseDay(dl)) { msg.textContent = '신청 마감일 날짜를 확인해 주십시오.'; return; }
    if (rs && dl && dl < rs) { msg.textContent = '신청 마감일이 시작일보다 앞섭니다.'; return; }
    if (!rs && S.profile && S.profile.rank_start && !S.clearOk) {         // 있던 시작일을 비우는 경우만 한 번 되묻는다
      S.clearOk = true; msg.textContent = '시작일을 비우면 현 직급 이전 실적을 거르지 못하고 승진임용 가능일도 계산하지 못합니다. 정말 비울까요?'; $('promoSave').textContent = '네, 비우겠습니다'; return;
    }
    S.saving = true; $('promoSave').disabled = true; msg.textContent = '저장 중…';
    var row = { rank_start: rs, apply_deadline: dl }; if (S.profile && typeof S.profile.rev === 'number') row.base_rev = S.profile.rev;
    rpc('promo_save_profile', { p_row: row }).then(function (res) {
      S.saving = false;
      if (isObj(res) && res.ok === true && isObj(res.row)) {              // 서버 응답으로 저장 성공을 확인한 뒤에만 「저장했어요」(규칙 7)
        S.profile = res.row; saveCache(); closeSheet(); render(); _toast('저장했습니다');
      } else if (isObj(res) && res.err === 'CONFLICT' && isObj(res.row) && (res.row.rank_start || null) === rs && (res.row.apply_deadline || null) === dl) {
        S.profile = res.row; saveCache(); closeSheet(); render(); _toast('저장했습니다');      // 응답이 끊겨 다시 보낸 경우: 서버에 이미 같은 값이 있는 것을 확인했으니 저장된 것
      } else if (isObj(res) && res.err === 'CONFLICT') {
        closeSheet(); _toast('다른 기기에서 먼저 고쳤습니다 — 다시 불러오겠습니다.', 3600); load(true);
      } else {
        $('promoSave').disabled = false; msg.textContent = '저장하지 못했습니다 — 날짜를 확인하고 다시 눌러 주십시오. 입력한 내용은 그대로 있습니다.';
      }
    }).catch(function (e) { S.saving = false; var b = $('promoSave'); if (b) b.disabled = false; var m2 = $('promoMsg'); if (m2) m2.textContent = '저장하지 못했습니다 — ' + errText(e) + ' 입력한 내용은 그대로 있습니다.'; });
  }

  /* ---------- app.js 와 만나는 곳 ---------- */
  function build() {
    if (built) return;
    built = true;
    var v = $('promoView'); if (!v) return;
    if (!$('promoLayer')) { var L = document.createElement('div'); L.id = 'promoLayer'; v.appendChild(L); }
    var rb = $('promoReload'); if (rb) rb.onclick = function () { S.err = null; load(false); };
  }
  function makeCtx() {
    return { S: S, PC: PC, slimAch: slimAch, ux: S.ux, forecast: S.fc, rsOf: rsOf, edit: S.edit, link: S.link, xlsx: S.xlsx, files: S.files, fileApi: promoFileApi, rpc: rpc, fmt: fmt, fmtS: fmtS, errText: errText, compute: compute, opts: computeOpts, load: load, saveCache: saveCache, saveAch: saveAch,
      saveFile: function (f) { if (!_saveFile) return Promise.reject(new Error('이 앱 버전에서는 파일 저장을 쓸 수 없습니다')); return _saveFile(f); },
      toast: function (m, ms) { _toast(m, ms); }, render: function () { if (shown()) render(); }, achReload: function () { return loadAch(true); },
      flash: function (id) { S.flashId = id; setTimeout(function () { if (S.flashId === id) { S.flashId = ''; var f = document.querySelector('#promoBody li.flash'); if (f) f.classList.remove('flash'); } }, 2600); } };
  }
  function init(o) {
    if (o && o.toast) _toast = o.toast;
    if (o && typeof o.saveFile === 'function') _saveFile = o.saveFile;         // v9.66: 폰 저장 길(app.js savePhoneFile) — 백업 내려받기가 쓴다
    S.ux = !!(o && o.ux); S.fc = !!(o && o.forecast); S.edit = !!(o && o.edit && global.PromoEdit); S.link = !!(o && o.link); S.xlsx = !!(o && o.xlsx); S.files = (o && o.files && typeof o.files.view === 'function' && typeof o.files.download === 'function') ? o.files : null;      // v10.15: 증빙 PDF 열기·내려받기(app.js PROMO_FILES)      // v9.68: 백업 내려받기의 엑셀 스위치(app.js PROMO_XLSX)
    if (S.edit) global.PromoEdit.init(makeCtx());
    build();
  }
  /* O-0782: 방금(20초 안) 잘 읽었고(승진 자료 + 연결용 실적 자료) 그 뒤 실적·승진에서 서버에 쓴 일이 없고 오프라인·오류 상태도 아니면 true — 알약 전환 때만 서버 읽기를 건너뛰는 데 쓴다 */
  function fresh() { return S.loaded && !S.err && !S.offline && !S.fromCache && !S.achErr && (!S.link || !!S.ach) && S.lastLoadAt > 0 && Date.now() - S.lastLoadAt < 20000 && S.lastLoadEp === perfEp(); }
  function open(o) {   // o.keep === true = 「실적 | 승진」 알약으로 넘어옴: 열어 둔 부문·눌러 둔 판정 칸·참고 펼침을 지우지 않고, 숫자 올라가는 움직임도 되풀이하지 않는다(홈 칸으로 열 때는 예전 그대로 모두 초기화)
    build();
    var keep = !!(o && o.keep === true);
    if (keep) { var sn = $('promoSnack'); if (sn) sn.className = 'psnack'; }      // 방금 지운 항목의 8초 되돌리기 안내는 화면을 떠나면 사라진다(항목은 휴지통에 그대로 있다)
    else { S.sel = ''; S.sec = 0; S.lastAnim = ''; S.open = {}; S.filter = 'all'; S.more = {}; S.emptyOpen = false; S.hint = {};      // v10.19: 처음 들어올 때는 부문이 모두 접힘·걸러 보기 없음
      S.rev = (S.rev || 0) + 1; closeSheet(); if (S.edit) { try { global.PromoEdit.close(); } catch (e) {} } }
    var c = readCache();
    if (!S.loaded && c) { applyData(c); S.loaded = true; S.fromCache = true; S.offline = false; S.cachedAt = c.at; }      // 저장본을 먼저 보여 주는 동안은 배너 없음
    render();
    if (keep && fresh()) return;
    load(true);
  }
  /* 뒤로 가기: 창이 열려 있으면 창부터, 부문 화면이면 점수판으로. true = 여기서 처리함 */
  function back() {
    if (S.pxSheet) { closeSheet(); return true; }      // v10.19: 「확인할 것」 시트
    if (S.edit && S.sheet && global.PromoEdit && global.PromoEdit.back()) return true;
    if (S.sheet) { closeSheet(); return true; }
    if (S.sec) { S.sec = 0; render(); return true; }
    return false;
  }
  global.PromoTab = { init: init, open: open, back: back };
})(typeof window !== 'undefined' ? window : globalThis);

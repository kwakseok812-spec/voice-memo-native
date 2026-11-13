/* promotion-edit.js — 「승진」 입력·수정 (v9.63, O-0684 후속)
 * promotion.js 가 init(ctx) 로 상태(S)·서버 호출(rpc)·계산(PromoCalc)을 넘겨 준다. 이 파일은 그 위에서 아래를 맡는다.
 *   항목 추가·고치기·삭제(휴지통 8초 되돌리기) · 프로필 고치기 · 곽호석 탭 연결(고르기·제안·끊기) · 「점수 더하기 해 보기」 · 백업 내려받기
 * 서버: 기존 promo_save_item · promo_trash_item · promo_purge_item · promo_save_profile 만 쓴다(새 SQL 없음). 책임저자 표시는 실적 항목 data.lead 에 ach_save_item 으로 적는다.
 * 스위치: app.js 의 PROMO_EDIT ('on' | 'off'), PROMO_LINK ('on' | 'off') — 끄면 v9.62 와 같다. 점수표 숫자는 이 파일에 없다(서버 규칙표에서 온다).
 */
(function (global) {
  'use strict';
  var PC = null, X = null, I = null, opener = null, snackTimer = null, previewTimer = null, escBound = false;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }
  function uuid() {
    try { if (global.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function S() { return X.S; }
  function layer() { return $('promoLayer'); }
  function R() { return S().rules || {}; }
  function nameOf(code) { return ((R().names || {})[code]) || code; }
  /* 금액: 「3000000」 「3,000,000」 「300만원」 「1억 2천만」 모두 받는다. 못 읽으면 null */
  function parseMoney(t) {
    var x = String(t == null ? '' : t).replace(/[\s,원]/g, '');
    if (x === '') return null;
    if (/^\d+$/.test(x)) return Number(x);
    var m = /^(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)천만)?(?:(\d+(?:\.\d+)?)만)?(?:(\d+(?:\.\d+)?)천)?$/.exec(x);
    if (!m || m[0] === '') return null;
    var v = (+m[1] || 0) * 1e8 + (+m[2] || 0) * 1e7 + (+m[3] || 0) * 1e4 + (+m[4] || 0) * 1e3;
    return Math.round(v);
  }
  function wonText(n) {
    if (!isFinite(n) || n < 0) return '';
    var eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4), rest = n % 1e4, out = [];
    if (eok) out.push(eok.toLocaleString('ko-KR') + '억');
    if (man) out.push(man.toLocaleString('ko-KR') + '만');
    if (rest || !out.length) out.push(rest.toLocaleString('ko-KR'));
    return out.join(' ') + '원';
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function blank(v) { return v === undefined || v === null || v === ''; }
  function sign(n) { return (n > 0 ? '+' : (n < 0 ? '−' : '')) + X.fmt(Math.abs(n)); }

  /* ---------- 칸 정의: 항목 종류마다 어떤 칸을 받는지 (값은 기존 승진 앱 칸 이름 그대로 저장) ---------- */
  function ay(req, hint) { return { id: 'ay', where: 'col', key: 'academic_year', kind: 'text', label: '학년도', hint: hint || '예: 2025', ph: '2025', req: req, mode: 'numeric', pat: /^\d{4}$/, patMsg: '학년도는 숫자 4자리로 적어 주십시오(예: 2025).' }; }
  function sem() { return { id: 'sem', where: 'val', key: 'semester', kind: 'sel', label: '학기', req: true, opts: [['1', '1학기'], ['2', '2학기']] }; }
  function txt(id, label, o) { return Object.assign({ id: id, where: 'val', key: id, kind: 'text', label: label }, o || {}); }
  function nm(id, label, o) { return Object.assign({ id: id, where: 'val', key: id, kind: 'num', label: label, mode: 'decimal' }, o || {}); }
  function it(id, label, o) { return Object.assign({ id: id, where: 'val', key: id, kind: 'int', label: label, mode: 'numeric' }, o || {}); }
  function dt(id, label, keys, parts, o) { return Object.assign({ id: id, kind: 'date', keys: keys, parts: parts, label: label }, o || {}); }
  function part(label, hint) { return { id: 'part', where: 'part', kind: 'int', label: label, hint: hint, mode: 'numeric', min: 1, max: 200, req: true, def: 1 }; }
  function subF(code, label, opts, req) { return { id: 'sub', where: 'sub', kind: 'sel', label: label, opts: opts, req: req !== false }; }
  var SUB_LOCAL = {
    '1-3': [['book', '저서'], ['kmooc', 'K-MOOC'], ['univ', '대학'], ['personal', '개인']],
    '4-3': [['intl', '국제 특허·지재권'], ['domestic', '국내 특허·지재권']],
    '4-4': [['solo_top', '개인전/본상'], ['group_award', '그룹전/입상'], ['collective', '단체전/입선']],
    '4-5': [['solo_top', '개인전/본상'], ['group_award', '그룹전/입상'], ['collective', '단체전/입선']]
  };
  function subOpts(code) {
    var m = (R().sub_names || {})[code]; if (isObj(m)) return Object.keys(m).map(function (k) { return [k, m[k]]; });
    return SUB_LOCAL[code] || [];
  }
  function fieldsFor(code) {
    var F = [];
    switch (code) {
      case '1-1': F = [ay(true), sem(), nm('lectureAvg', '강의평가 평균', { req: true, min: 0, max: 5, hint: '5점 만점', ph: '4.50' }), nm('guidanceAvg', '학생지도평가 평균', { min: 0, max: 5, hint: '없으면 비워 두십시오', ph: '4.50' })]; break;
      case '1-2': F = [ay(true), sem(), txt('courseName', '운영한 역량 교과목', { ph: '예: 교과목 이름' }), { id: 'ran', where: 'val', key: 'ran', kind: 'sel', label: '1개 학기 이상 운영했습니까?', req: true, opts: [['yes', '운영했습니다'], ['no', '아직 안 했습니다']] }]; break;
      case '1-3': F = [subF(code, '종류', subOpts(code)), txt('title', '이름', { req: true, ph: '저서·콘텐츠 이름', cover: true, max: 200 }), part('함께 쓴 사람 수(나 포함)')]; break;
      case '1-4': F = [txt('companyName', '업체 이름', { req: true, max: 100 }), txt('programName', '연수 내용', { max: 200 }), dt('start', '연수 시작일', ['startYear', 'startMonth', 'startDay'], 'ymd', { req: true }), dt('end', '연수 종료일', ['endYear', 'endMonth', 'endDay'], 'ymd'), it('hours', '연수 시간', { req: true, min: 1, max: 2000, hint: '시간 단위', ph: '40' })]; break;
      case '1-5': F = [txt('title', '기부·유치 내용', { max: 200 }), it('amount', '금액(원)', { req: true, min: 0, max: 100000000000, hint: '예: 3000000 또는 300만원', ph: '300만원', money: true })]; break;
      case '1-6': F = [{ id: 'ay', where: 'col', key: 'academic_year', kind: 'text', label: '학기', hint: '예: 2026-2학기', ph: '2026-2학기', max: 20 }, it('courses', 'PBL 강좌 수', { req: true, min: 0, max: 50, ph: '1' })]; break;
      case '2-1': F = [ay(true), txt('title', '과제 이름', { max: 200 }), it('amount', '수탁 연구비(원)', { req: true, min: 0, max: 100000000000, hint: '예: 10000000 또는 1000만원', ph: '1000만원', money: true })]; break;
      case '2-2': F = [ay(true), txt('title', '자문 내용', { max: 200 }), it('amount', '자문 금액(원)', { req: true, min: 0, max: 100000000000, hint: '예: 1000000 또는 100만원', ph: '100만원', money: true })]; break;
      case '3-1': F = [subF(code, '보직 종류', subOpts(code)), txt('positionName', '보직 이름', { max: 100, ph: '예: 기획혁신부처장' }), dt('start', '시작', ['startYear', 'startMonth'], 'ym', { req: true }), dt('end', '끝(예정 포함)', ['endYear', 'endMonth'], 'ym', { req: true })]; break;
      case '3-2': F = [subF(code, '중요도', subOpts(code)), txt('title', 'TFT 이름', { req: true, max: 200, cover: false }), dt('start', '시작일', ['startYear', 'startMonth', 'startDay'], 'ymd'), dt('end', '종료일', ['endYear', 'endMonth', 'endDay'], 'ymd')]; break;
      case '3-3': F = [txt('title', '연구 이름', { req: true, max: 200 }), dt('completion', '최종 완성일', ['completionYear', 'completionMonth', 'completionDay'], 'ymd')]; break;
      case '4-1':
      case '4-2': F = [(code === '4-2' ? subF(code, '학술지 종류', subOpts(code)) : null), txt('title', '논문 제목', { req: true, max: 400, cover: true }), txt('journal', '학술지', { max: 200, cover: true }),
        it('pubYear', '발행 연도', { req: true, min: 1990, max: 2100, ph: '2025', cover: true }), it('pubMonth', '발행 월', { min: 1, max: 12, hint: '모르면 비워 두십시오', ph: '7' }),
        Object.assign(part('저자 수(나 포함)', '실적 탭에서 고르면 거기 값을 씁니다'), { cover: true }),
        { id: 'isCorresponding', where: 'val', key: 'isCorresponding', kind: 'bool', label: '책임저자입니까?', hint: '제1저자 또는 교신저자', cover: true, lead: true },
        { id: 'jc', where: 'ev', key: 'journal_check', kind: 'sel', label: '학술지 분류 확인', hint: 'SCI·등재지인지', opts: [['', '입력한 그대로'], ['confirmed', '확인됨'], ['need', '확인 필요']] }].filter(Boolean); break;
      case '4-3': F = [subF(code, '종류', subOpts(code)), txt('title', '이름', { req: true, max: 300, cover: true }), part('공동 발명자 수(나 포함)')]; break;
      case '4-4':
      case '4-5': F = [subF(code, '참가 형태', subOpts(code)), txt('title', '전시·공모전 이름', { req: true, max: 300 }), part('함께한 사람 수(나 포함)')]; break;
      case '5-1':
      case '5-2': F = [txt('title', '표창 이름', { req: true, max: 300, cover: true }), it('count', '받은 횟수', { min: 1, max: 20, hint: '기본 1', def: 1 }), part('공동 수상자 수(나 포함)')]; break;
      case '5-3': F = [txt('title', '지도한 수상 내용', { req: true, max: 300, cover: true }), it('count', '받은 횟수', { min: 1, max: 20, hint: '기본 1', def: 1 })]; break;
    }
    return F.concat([{ id: 'memo', where: 'memo', kind: 'area', label: '메모 (선택)', max: 500 }]);
  }
  var CODES = ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '2-1', '2-2', '3-1', '3-2', '3-3', '4-1', '4-2', '4-3', '4-4', '4-5', '5-1', '5-2', '5-3'];
  function sectionOf(code) { return parseInt(code.charAt(0), 10); }
  function managedKeys(code) {
    var ks = [];
    fieldsFor(code).forEach(function (f) { if (f.where === 'val') ks.push(f.key); if (f.kind === 'date') ks = ks.concat(f.keys); });
    return ks;
  }

  /* ---------- 곽호석 탭 연결 종류 ---------- */
  function linkKind(code) {
    if (code === '4-1' || code === '4-2') return { type: 'paper', label: '논문' };
    if (code === '4-3') return { type: 'patent', label: '특허' };
    if (code === '1-3') return { type: 'book', label: '저서' };
    if (/^5-/.test(code)) return { nameHas: '수상', label: '수상' };
    return null;
  }
  function achOf(id) { var a = S().ach || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
  function achCandidates(code) {
    var k = linkKind(code), cats = S().achCats || [], ids = {}, any = false;
    if (!k) return [];
    cats.forEach(function (c) { if (c.parent_id) return; if ((k.type && c.kind_type === k.type) || (k.nameHas && String(c.name || '').indexOf(k.nameHas) >= 0)) { ids[c.id] = 1; any = true; } });
    return (S().ach || []).filter(function (a) { return !a.deleted_at && (!any || ids[a.kind_id]); });
  }
  function linkOn() { return !!(X.link && S().ach); }

  /* ---------- 창 껍데기 ---------- */
  function sheet(html, label) {
    var L = layer(); if (!L) return;
    if (!opener) opener = document.activeElement;
    L.innerHTML = '<div class="pscrim" id="promoScrim"></div><div class="psheet" role="dialog" aria-modal="true" aria-label="' + esc(label) + '" id="promoSheet">' + html + '</div>';
    L.classList.add('show'); S().sheet = true;
    $('promoScrim').onclick = tryClose;
    var h = L.querySelector('.psheet h4'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) {} }
    var xb = $('promoX'); if (xb) xb.onclick = tryClose;
    if (!escBound) { escBound = true; document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S() && S().sheet && X && X.edit) { if (layer() && layer().classList.contains('show')) tryClose(); } }); }
  }
  function hide() {
    var L = layer(); S().sheet = false; I = null;
    if (L) { L.classList.remove('show'); L.innerHTML = ''; }
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    var o = opener; opener = null; try { if (o && o.focus && document.contains(o)) o.focus({ preventScroll: true }); } catch (e) {}
  }
  function msg(t, ok) { var m = $('promoMsg'); if (m) { m.textContent = t || ''; m.className = 'psmsg' + (ok ? ' ok' : ''); } }
  function head(title, sub) { return '<div class="psh-hd"><h4>' + esc(title) + '</h4><button type="button" class="psh-x" id="promoX" aria-label="닫기">✕</button></div>' + (sub ? '<div class="psnote">' + sub + '</div>' : ''); }
  function acts(html) { return '<div class="pbtns" id="promoActs">' + html + '</div>'; }
  function confirmBar(text, yes, no, onYes, onNo) {
    var a = $('promoActs'); if (!a) return;
    a.innerHTML = '<div class="pconf" role="alertdialog" aria-label="' + esc(text) + '"><p>' + esc(text) + '</p><div class="pbtns"><button type="button" class="pbtn ghost" id="promoNo">' + esc(no) + '</button><button type="button" class="pbtn warn" id="promoYes">' + esc(yes) + '</button></div></div>';
    $('promoNo').onclick = onNo; $('promoYes').onclick = onYes;
    try { $('promoNo').focus({ preventScroll: true }); } catch (e) {}
  }
  function tryClose() {
    if (I && I.view === 'suggest' && I.busy) { X.toast('연결 중입니다. 끝나면 닫을 수 있습니다.'); return; }
    if (I && I.view === 'profile') { tryCloseProfile(); return; }
    if (I && I.view === 'pick') { I.view = 'form'; renderForm(); return; }
    if (I && I.view === 'form' && dirty()) {
      confirmBar('저장하지 않은 내용이 있습니다. 닫을까요?', '버리고 닫기', '계속 고치기', hide, function () { renderForm(true); });
      return;
    }
    hide();
  }

  /* ---------- 항목 초안 ---------- */
  function newD(code, base) {
    var f = fieldsFor(code), d = { sub: '', ay: '', part: 1, val: {}, memo: '', jc: '', ach_id: null, lead: 'auto', unv: false, incl: false, flags: {} };
    if (base) {
      d.sub = base.sub_type || ''; d.ay = base.academic_year || ''; d.part = base.participants || 1; d.val = clone(base.value || {}); d.memo = base.memo || '';
      d.jc = (base.evidence && base.evidence.journal_check) || ''; d.ach_id = base.ach_id || null; d.flags = clone(base.flags || {});
    } else {
      f.forEach(function (x) { if (x.def !== undefined && x.where === 'val') d.val[x.key] = x.def; });
    }
    return d;
  }
  function snapshot(d) {
    var v = {}, k; Object.keys(d.val).sort().forEach(function (x) { if (!blank(d.val[x])) v[x] = d.val[x]; });       // 비어 있는 칸은 없는 것과 같게 본다
    return JSON.stringify([d.sub || '', d.ay || '', Number(d.part) || 1, v, d.memo || '', d.jc || '', d.ach_id || null, d.lead, !!d.unv, !!d.incl]);
  }
  function dirty() { return !!I && !I.sim && I.mode !== 'view' && snapshot(I.d) !== I.orig; }          // 「해 보기」는 저장할 게 없으니 닫을 때 묻지 않는다
  function draftItem() {
    var d = I.d, v = {}, k, ev = clone((I.base && I.base.evidence) || {}), fl = clone(d.flags || {});
    for (k in d.val) if (!blank(d.val[k])) v[k] = d.val[k];
    if (d.jc) ev.journal_check = d.jc; else delete ev.journal_check;
    if (d.unv) delete fl.unverified;
    if (d.incl) { delete fl.excluded_default; delete fl.dup_suspect; }
    return { id: I.id, section: sectionOf(I.code), item_code: I.code, sub_type: d.sub || null, academic_year: d.ay || '', participants: Math.max(1, Math.floor(num(d.part)) || 1), value: v, memo: d.memo || null, evidence: ev, flags: fl, ach_id: d.ach_id || null, deleted_at: null };
  }

  /* ---------- 칸 그리기 ---------- */
  function covered(f) { return !!(I && I.d.ach_id && linkOn() && (f.cover === true || (f.cover === undefined && false))); }
  function fieldVal(f) {
    var d = I.d;
    if (f.where === 'col') return d.ay; if (f.where === 'sub') return d.sub; if (f.where === 'part') return d.part; if (f.where === 'memo') return d.memo;
    if (f.where === 'ev') return d.jc; return d.val[f.key];
  }
  function moneyLine(v) { var n = (typeof v === 'number') ? v : parseMoney(v); return (n === null || n === undefined || !isFinite(n)) ? '' : '= ' + wonText(n) + (n >= 10000 ? ' (' + n.toLocaleString('ko-KR') + '원)' : ''); }
  function inp(f, extra) {
    var id = 'pf_' + f.id, v = fieldVal(f), ph = f.ph ? ' placeholder="' + esc(f.ph) + '"' : '';
    return '<input type="text" id="' + id + '" value="' + esc(blank(v) ? '' : v) + '" inputmode="' + (f.mode || 'text') + '" autocomplete="off" enterkeyhint="next"' + ph + (f.max && f.kind === 'text' ? ' maxlength="' + f.max + '"' : '') + ' aria-describedby="pe_' + f.id + '"' + (extra || '') + '>';
  }
  function fieldHtml(f) {
    var h = '', req = f.req ? ' <b class="preq" title="꼭 적어야 합니다">*</b>' : '', hint = f.hint ? ' <small>' + esc(f.hint) + '</small>' : '', i, v;
    if (f.kind === 'date') {
      h = '<div class="pfld" role="group" aria-label="' + esc(f.label) + '"><span class="plab2">' + esc(f.label) + req + '</span><div class="pdate">';
      f.keys.forEach(function (k, ix) {
        var lab = ['연', '월', '일'][ix], val = I.d.val[k];
        h += '<label class="pdc"><input type="text" id="pf_' + f.id + '_' + ix + '" value="' + esc(blank(val) ? '' : val) + '" inputmode="numeric" autocomplete="off" maxlength="' + (ix === 0 ? 4 : 2) + '" aria-label="' + esc(f.label + ' ' + lab) + '" placeholder="' + (ix === 0 ? '2025' : (ix === 1 ? '3' : '1')) + '"><i>' + lab + '</i></label>';
      });
      return h + '</div><div class="perr" id="pe_' + f.id + '" role="alert"></div></div>';
    }
    if (f.kind === 'bool') {
      v = I.d.val[f.key] === true;
      if (f.lead && I.d.ach_id && linkOn()) return '';
      return '<div class="pfld"><span class="plab2" id="pl_' + f.id + '">' + esc(f.label) + hint + '</span><div class="pseg" role="radiogroup" aria-labelledby="pl_' + f.id + '" data-seg="' + f.id + '">'
        + '<button type="button" role="radio" aria-checked="' + (v ? 'true' : 'false') + '" data-v="1" class="' + (v ? 'on' : '') + '">예</button><button type="button" role="radio" aria-checked="' + (v ? 'false' : 'true') + '" data-v="0" class="' + (v ? '' : 'on') + '">아닙니다</button></div></div>';
    }
    if (f.kind === 'sel') {
      v = fieldVal(f); h = '<label class="pfld"><span class="plab2">' + esc(f.label) + req + hint + '</span><select id="pf_' + f.id + '" aria-describedby="pe_' + f.id + '">';
      if (!(f.opts || []).some(function (o) { return o[0] === ''; })) h += '<option value="">고르십시오</option>';
      (f.opts || []).forEach(function (o) { h += '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; });
      return h + '</select><div class="perr" id="pe_' + f.id + '" role="alert"></div></label>';
    }
    if (f.kind === 'area') return '<label class="pfld"><span class="plab2">' + esc(f.label) + '</span><textarea id="pf_' + f.id + '" rows="2" maxlength="' + (f.max || 500) + '">' + esc(I.d.memo || '') + '</textarea></label>';
    return '<label class="pfld"><span class="plab2">' + esc(f.label) + req + hint + '</span>' + inp(f) + (f.money ? '<div class="pmoney" id="pm_' + f.id + '" aria-live="polite">' + moneyLine(fieldVal(f)) + '</div>' : '') + '<div class="perr" id="pe_' + f.id + '" role="alert"></div></label>';
  }

  /* 곽호석 탭 연결 상자 */
  function linkBox() {
    var k = linkKind(I.code); if (!k || !X.link) return '';
    var d = I.d, a = d.ach_id ? achOf(d.ach_id) : null, h = '';
    if (d.ach_id) {
      if (!a) return '<div class="plinkbox"><b>실적 탭에 연결돼 있습니다</b><p class="psb">연결한 실적 탭 항목을 지금은 찾을 수 없습니다(인터넷이 안 되거나 실적 탭에서 지웠을 수 있습니다). 저장된 값으로 계산합니다.</p><button type="button" class="pbtn sm ghost" id="pUnlink">연결 끊기</button></div>';
      var ld = PC.leadOf(a), n = PC.achPeopleN(a), isP = (I.code === '4-1' || I.code === '4-2');
      h += '<div class="plinkbox on"><b>실적 탭 「' + esc(k.label) + '」과 연결됨</b><div class="plt">' + esc(a.title || '(제목 없음)') + '</div><div class="psb">' + [a.year ? a.year + '년' : '', a.venue || '', isP && n ? '저자 ' + n + '명' : ''].filter(Boolean).map(esc).join(' · ') + '</div>';
      h += '<p class="psb">제목·학술지·연도·저자 수는 실적 탭 값을 그대로 씁니다(여기서 고치지 않습니다).</p>';
      if (isP) {
        h += '<div class="pfld"><span class="plab2" id="pl_lead">책임저자입니까? <small>제1저자 또는 교신저자 · 실적 탭 항목에 적힙니다</small></span><div class="pseg three" role="radiogroup" aria-labelledby="pl_lead" data-seg="lead">'
          + [['auto', '제안 따름'], ['yes', '예'], ['no', '아닙니다']].map(function (o) { var on = d.lead === o[0]; return '<button type="button" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" data-v="' + o[0] + '" class="' + (on ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>'
          + '<div class="psb" id="pLeadHint">' + leadHint(a) + '</div></div>';
      }
      h += '<button type="button" class="pbtn sm ghost" id="pUnlink">연결 끊기</button></div>';
    } else {
      h += '<div class="plinkbox"><b>실적 탭에 있는 ' + esc(k.label) + '입니까?</b><p class="psb">연결하면 제목·연도 등을 한 곳에서만 관리합니다.</p><button type="button" class="pbtn sm" id="pPick"' + (S().ach ? '' : ' disabled') + '>실적 탭에서 고르기</button>' + (S().ach ? '' : '<p class="psb">실적 탭 자료를 아직 못 불러왔습니다. 인터넷이 되면 다시 열어 주십시오.</p>') + '</div>';
    }
    return h;
  }
  function leadHint(a) {
    var l = PC.leadOf(a);
    return I.d.lead === 'auto' ? (l === true ? '실적 탭의 순번·교신 표시로는 책임저자로 보입니다.' : (l === false ? '실적 탭의 표시로는 책임저자가 아닙니다.' : '실적 탭에는 순번·교신 표시가 없어 모르는 상태입니다. 아는 대로 골라 주십시오.')) : '고른 값을 실적 탭 항목에 적어 둡니다.';
  }

  function renderForm(keepScroll) {
    var code = I.code, d = I.d, f = fieldsFor(code), h = '', title = (I.sim ? '점수 더하기 해 보기 · ' : (I.mode === 'new' ? '항목 추가 · ' : '항목 고치기 · ')) + code + ' ' + nameOf(code);
    var scr = 0; var sh = $('promoSheet'); if (sh && keepScroll) scr = sh.scrollTop;
    var sub = '';
    if (I.sim) sub = '<b>저장되지 않습니다.</b> 값을 넣어 보면 점수가 얼마나 달라지는지만 보여 드립니다.';
    h += head(title, sub);
    h += '<div id="promoFields">' + linkBox();
    f.forEach(function (x) { if (!covered(x)) h += fieldHtml(x); });
    h += statusBox();
    h += '</div><div id="pDup" class="pwarn2" role="status" aria-live="polite"></div><div class="psprev" id="promoPrev" role="status" aria-live="polite"></div><div class="psmsg" id="promoMsg" role="alert" aria-live="assertive"></div>';
    var btns = '';
    if (I.mode === 'edit' && !I.sim) btns += '<button type="button" class="pbtn ghost danger" id="pDel">휴지통으로</button>';
    btns += '<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>';
    btns += '<button type="button" class="pbtn" id="promoSave">' + (I.sim ? '이 항목으로 저장하기' : '저장') + '</button>';
    h += acts(btns);
    sheet(h, title);
    if (sh = $('promoSheet')) sh.scrollTop = scr;
    wireForm(); previewNow();
  }
  function statusBox() {
    var d = I.d, fl = d.flags || {}, h = '';
    if (I.mode === 'edit' && fl.unverified) h += '<label class="pchk"><input type="checkbox" id="pf_unv"' + (d.unv ? ' checked' : '') + '><span><b>확인했습니다 — 확인됨으로 바꾸기</b><small>지금은 「확인 전」입니다. 원고·증빙을 확인했으면 체크해 주십시오.</small></span></label>';
    if (I.mode === 'edit' && fl.excluded_default) h += '<label class="pchk"><input type="checkbox" id="pf_incl"' + (d.incl ? ' checked' : '') + '><span>점수에서 뺀 항목입니다(중복 의심). <b>중복이 아닙니다 — 점수에 넣기</b></span></label>';
    return h;
  }

  function readForm() {
    var d = I.d;
    fieldsFor(I.code).forEach(function (f) {
      if (covered(f) && f.kind !== 'bool') return;
      var el, v, i;
      if (f.kind === 'date') {
        f.keys.forEach(function (k, ix) { el = $('pf_' + f.id + '_' + ix); if (!el) return; v = el.value.replace(/\s/g, ''); d.val[k] = v === '' ? null : (isFinite(Number(v)) ? Math.floor(Number(v)) : v); });
        return;
      }
      if (f.kind === 'bool') return;       // 단추가 바로 d.val 에 적는다
      el = $('pf_' + f.id); if (!el) return;
      v = el.value;
      if (f.money) { var raw0 = String(v).trim(), pm = parseMoney(raw0); v = raw0 === '' ? null : (pm === null ? raw0 : pm); var me = $('pm_' + f.id); if (me) me.textContent = (typeof v === 'number') ? moneyLine(v) : (raw0 === '' ? '' : '금액을 읽지 못했습니다 — 예: 3000000 또는 300만원'); }
      else if (f.kind === 'num' || f.kind === 'int') { v = String(v).replace(/[,\s]/g, ''); v = v === '' ? null : (isFinite(Number(v)) ? Number(v) : v); if (f.kind === 'int' && typeof v === 'number') v = Math.floor(v); }
      else if (f.kind === 'text' || f.kind === 'area') v = String(v).replace(/^\s+|\s+$/g, '');
      if (f.where === 'col') d.ay = v || ''; else if (f.where === 'sub') d.sub = v || ''; else if (f.where === 'part') d.part = (v === null || v === '') ? '' : v; else if (f.where === 'memo') d.memo = v || ''; else if (f.where === 'ev') d.jc = v || '';
      else d.val[f.key] = (v === '' ? null : v);
    });
  }
  function wireForm() {
    var fe = $('promoFields'); if (!fe) return;
    fe.oninput = fe.onchange = function (ev) {
      var t = ev.target; if (t && t.id && t.id.indexOf('pf_') === 0) { var p = $('pe_' + t.id.slice(3).replace(/_\d$/, '')); if (p) p.textContent = ''; t.removeAttribute('aria-invalid'); }
      if (t && t.id === 'pf_unv') I.d.unv = t.checked; if (t && t.id === 'pf_incl') I.d.incl = t.checked;
      readForm(); msg(''); schedulePreview();
    };
    fe.onclick = function (ev) {
      var b = ev.target; while (b && b !== fe && b.tagName !== 'BUTTON') b = b.parentNode;
      if (!b || b === fe) return;
      var sg = b.parentNode && b.parentNode.getAttribute('data-seg');
      if (sg) {
        var val = b.getAttribute('data-v'), sibs = b.parentNode.querySelectorAll('button'), i;
        for (i = 0; i < sibs.length; i++) { var on = sibs[i] === b; sibs[i].className = on ? 'on' : ''; sibs[i].setAttribute('aria-checked', on ? 'true' : 'false'); }
        if (sg === 'lead') { I.d.lead = val; var hh = $('pLeadHint'); var a = achOf(I.d.ach_id); if (hh && a) hh.textContent = leadHint(a); }
        else I.d.val[sg] = (val === '1');
        schedulePreview(); return;
      }
      if (b.id === 'pPick') { readForm(); I.view = 'pick'; I.q = ''; renderPick(); }
      else if (b.id === 'pUnlink') doUnlink();
    };
    $('promoCancel').onclick = tryClose;
    $('promoSave').onclick = onSave;
    var del = $('pDel'); if (del) del.onclick = onDelete;
  }
  function doUnlink() {
    readForm(); var a = achOf(I.d.ach_id), d = I.d;
    if (a) {     // 끊어도 내용이 사라지지 않게 곽호석 탭 값을 이 항목 칸으로 복사해 둔다
      if (a.title) d.val.title = a.title; if (a.venue && !d.val.journal) d.val.journal = a.venue; if (a.year) d.val.pubYear = a.year;
      var n = PC.achPeopleN(a); if (n > 0) d.part = n;
      if (I.code === '4-1' || I.code === '4-2') { var l = d.lead === 'yes' ? true : (d.lead === 'no' ? false : PC.leadOf(a)); d.val.isCorresponding = l === true; }
    }
    d.ach_id = null; d.lead = 'auto';
    renderForm(true);
  }

  /* ---------- 「+N점」 미리 보기와 비슷한 항목 알림 ---------- */
  function schedulePreview() { if (previewTimer) clearTimeout(previewTimer); previewTimer = setTimeout(previewNow, 140); }
  function previewNow() {
    var el = $('promoPrev'); if (!el || !I || I.view !== 'form') return;
    var sim;
    try { sim = PC.simulate(X.opts(), draftItem(), I.mode === 'edit' ? I.id : null); } catch (e) { sim = null; }
    if (!sim || sim.error) { el.innerHTML = ''; return; }
    var pre = I.sim ? '더해 보면' : (I.mode === 'new' ? '넣으면' : '고치면');
    var h = '<div class="pdl">' + pre + '</div>';
    if (sim.status === 'before') h += '<b class="pdn">현 직급 이전이라 점수에 안 들어갑니다 (+0점)</b>';
    else if (sim.status === 'excluded') h += '<b class="pdn">점수에서 뺀 항목이라 합계는 그대로입니다 (+0점)</b>';
    else if (sim.secCapped && Math.abs(sim.dToday) < 0.005) h += '<b class="pdn">이 부문은 이미 최대 인정(' + X.fmtS(sim.secMax) + '점)이라 합계가 그대로입니다 (+0점)</b>';
    else if (Math.abs(sim.dToday) < 0.005) h += '<b class="pdn">점수는 그대로입니다 (+0점)</b> <span>오늘 기준 ' + X.fmt(sim.before.today) + '</span>';
    else h += '<b class="pdn ' + (sim.dToday > 0 ? 'up' : (sim.dToday < 0 ? 'down' : '')) + '">' + sign(sim.dToday) + '점</b> <span>오늘 기준 ' + X.fmt(sim.before.today) + ' → ' + X.fmt(sim.after.today) + '</span>';
    if (Math.abs(sim.dExpected - sim.dToday) >= 0.005 && sim.status !== 'before') h += '<div class="psb">임기 끝까지 예상은 ' + sign(sim.dExpected) + '점입니다.</div>';
    if (Math.abs(sim.itemAfter - sim.itemBefore) >= 0.005) h += '<div class="psb">이 종류 합계 ' + X.fmtS(sim.itemBefore) + ' → ' + X.fmtS(sim.itemAfter) + '</div>';
    if (sim.reasons && sim.reasons.length && sim.status !== 'before') h += '<div class="psb">' + esc(sim.reasons.join(' · ')) + '</div>';
    el.innerHTML = h;
    dupCheck();
  }
  function keyOf(code, v, ay, sub) {
    var s = function (x) { return String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase(); };
    if (code === '1-1') return s(ay) && s(v.semester) ? [ay, v.semester].join('|') : '';
    if (code === '1-2') return s(ay) && s(v.semester) && s(v.courseName) ? [ay, v.semester, s(v.courseName)].join('|') : '';
    if (code === '1-4') return s(v.companyName) && v.startYear ? [s(v.companyName), v.startYear, v.startMonth, v.startDay].join('|') : '';
    if (code === '1-6') return s(ay) ? s(ay) : '';
    if (code === '1-5' || code === '2-1' || code === '2-2') return s(ay) + '|' + (num(v.amount) > 0 ? num(v.amount) : '') + '|' + s(v.title);
    if (code === '3-1') return s(v.positionName) && v.startYear ? [s(v.positionName), v.startYear, v.startMonth].join('|') : '';
    return '';
  }
  function dupCheck() {
    var el = $('pDup'); if (!el) return;
    var d = I.d, hits = [], mine = keyOf(I.code, d.val, d.ay, d.sub), t = d.val.title, ar = (d.ach_id && achOf(d.ach_id)) ? achOf(d.ach_id).title : t;
    S().items.forEach(function (o) {
      if (o.deleted_at || o.item_code !== I.code || o.id === I.id) return;
      var ov = o.value || {}, same = false;
      if (d.ach_id && o.ach_id === d.ach_id) same = true;
      else if (mine && keyOf(I.code, ov, o.academic_year, o.sub_type) === mine && /^(1-1|1-2|1-4|1-5|1-6|2-1|2-2|3-1)$/.test(I.code)) same = true;
      else if (!/^(1-1|1-2|1-4|1-5|1-6|2-1|2-2|3-1)$/.test(I.code) && ar && ov.title && PC.titleSim(ar, ov.title) >= 0.88) same = true;
      if (same) hits.push(PC.rowLabel(o, R()));
    });
    el.innerHTML = hits.length ? '<b>비슷한 항목이 이미 있습니다</b> ' + hits.slice(0, 2).map(function (x) { return '「' + esc(x) + '」'; }).join(' ') + (hits.length > 2 ? ' 외 ' + (hits.length - 2) + '건' : '') + '. 같은 항목이면 새로 넣지 말고 그 항목을 고쳐 주십시오. 달라도 저장은 할 수 있습니다.' : '';
  }

  /* ---------- 검사 ---------- */
  function validDay(y, m, d) { var dt0 = new Date(y, m - 1, d); return dt0.getFullYear() === y && dt0.getMonth() === m - 1 && dt0.getDate() === d; }
  function validate() {
    var E = {}, d = I.d;
    fieldsFor(I.code).forEach(function (f) {
      if (covered(f)) return;
      var v, label = f.label;
      if (f.kind === 'date') {
        var vs = f.keys.map(function (k) { return d.val[k]; }), any = vs.some(function (x) { return !blank(x); }), need = f.parts === 'ymd' ? 3 : 2;
        if (f.req && !any) { E[f.id] = label + '을(를) 적어 주십시오.'; return; }
        if (!any) return;
        var y = Number(vs[0]), m = Number(vs[1]), dd = vs[2] === undefined || blank(vs[2]) ? 1 : Number(vs[2]);
        if (!(y >= 1990 && y <= 2100) || !Number.isInteger(y)) { E[f.id] = '연도를 4자리로 적어 주십시오(예: 2025).'; return; }
        if (blank(vs[1])) { if (f.req || f.id === 'start' || f.id === 'end') { E[f.id] = '월까지 적어 주십시오.'; return; } }
        if (!(m >= 1 && m <= 12) || !Number.isInteger(m)) { E[f.id] = '월은 1~12 사이로 적어 주십시오.'; return; }
        if (f.parts === 'ymd' && !blank(vs[2]) && !validDay(y, m, dd)) { E[f.id] = '날짜가 맞지 않습니다. 일을 확인해 주십시오.'; return; }
        return;
      }
      if (f.kind === 'bool') return;
      v = fieldVal(f);
      if (f.req && (blank(v) || v === '')) { E[f.id] = (f.kind === 'sel' ? label + '을(를) 골라 주십시오.' : label + '을(를) 적어 주십시오.'); return; }
      if (blank(v) || v === '') return;
      if (f.kind === 'num' || f.kind === 'int') {
        if (typeof v !== 'number') { E[f.id] = f.money ? '금액을 숫자로 적어 주십시오(예: 3000000 또는 300만원).' : '숫자로 적어 주십시오.'; return; }
        if (f.min !== undefined && v < f.min) { E[f.id] = f.min + ' 이상으로 적어 주십시오.'; return; }
        if (f.max !== undefined && v > f.max) { E[f.id] = f.max + ' 이하로 적어 주십시오.'; return; }
      }
      if (f.pat && !f.pat.test(String(v))) E[f.id] = f.patMsg || '형식을 확인해 주십시오.';
      if (f.where === 'part' && (!Number.isInteger(v) || v < 1 || v > 200)) E[f.id] = '사람 수는 1~200 사이 숫자로 적어 주십시오.';
    });
    // 순서 점검: 끝이 시작보다 앞서면 안 됨
    var vv = d.val, ds = [['start', 'startYear', 'startMonth', 'startDay', 'end', 'endYear', 'endMonth', 'endDay']];
    ['start'].forEach(function () {
      if (E.start || E.end || blank(vv.startYear) || blank(vv.endYear)) return;
      var a = [vv.startYear, vv.startMonth || 1, vv.startDay || 1], b = [vv.endYear, vv.endMonth || 1, vv.endDay || 1];
      if (a[0] * 10000 + a[1] * 100 + a[2] > b[0] * 10000 + b[1] * 100 + b[2]) E.end = '끝이 시작보다 앞섭니다. 날짜를 확인해 주십시오.';
    });
    return E;
  }
  function showErrors(E) {
    var first = null;
    Object.keys(E).forEach(function (k) {
      var p = $('pe_' + k); if (p) p.textContent = E[k];
      var el = $('pf_' + k) || $('pf_' + k + '_0'); if (el) { el.setAttribute('aria-invalid', 'true'); if (!first) first = el; }
    });
    if (first) { try { first.focus({ preventScroll: false }); first.scrollIntoView({ block: 'center' }); } catch (e) {} }
    msg('빨간 글씨 칸을 확인해 주십시오. 입력한 내용은 그대로 있습니다.');
  }

  /* ---------- 저장 ---------- */
  function buildRow() {
    var d = I.d, row = { id: I.id, section: sectionOf(I.code), item_code: I.code, sub_type: d.sub || null, academic_year: d.ay || null, participants: Math.max(1, Math.floor(num(d.part)) || 1), ach_id: d.ach_id || null };
    if ((d.memo || '') !== (I.memo0 || '')) row.memo = d.memo || null;           // 메모는 내가 바꿨을 때만 보낸다(다른 기기가 적은 메모를 덮어쓰지 않게)
    var val = {}, base = (I.base && I.base.value) || {};
    managedKeys(I.code).forEach(function (k) {
      if (d.ach_id && linkOn() && /^(title|journal|pubYear|isCorresponding)$/.test(k)) { return; }          // 연결된 항목은 곽호석 탭 값을 쓴다(사본을 만들지 않는다)
      var v = d.val[k]; val[k] = blank(v) ? (Object.prototype.hasOwnProperty.call(base, k) ? null : undefined) : v;
      if (val[k] === undefined) delete val[k];
    });
    if (d.ach_id && linkOn()) { var a = achOf(d.ach_id); if (a) { var n = PC.achPeopleN(a); if (n > 0) row.participants = n; } }
    row.value = val;
    var ev = {}; if (I.code === '4-1' || I.code === '4-2') ev.journal_check = d.jc || (I.base && I.base.evidence && I.base.evidence.journal_check ? null : undefined); if (ev.journal_check === undefined) delete ev.journal_check;
    row.evidence = ev;
    var fl = {}; if (d.unv && d.flags.unverified) fl.unverified = null; if (d.incl && d.flags.excluded_default) { fl.excluded_default = null; fl.dup_suspect = null; }
    row.flags = fl;
    if (I.mode === 'edit' && I.base) row.base_rev = I.base.rev; else row.ext_key = 'app:' + I.id;
    return row;
  }
  function putItem(r) {
    var items = S().items, at = -1; items.forEach(function (x, i) { if (x.id === r.id) at = i; });
    if (at >= 0) items[at] = r; else items.push(r);
  }
  var SAVE_ERR = { BAD_ROW: '저장하지 못했습니다 — 입력한 값이 받아들여지지 않았습니다. 숫자와 날짜를 확인해 주십시오.', BAD_ACH: '저장하지 못했습니다 — 연결한 실적 탭 항목이 사라졌습니다. 연결을 끊고 다시 저장해 주십시오.', TOO_BIG: '저장하지 못했습니다 — 내용이 너무 깁니다. 메모를 줄여 주십시오.' };
  function busy(on) { I.busy = on; var b = $('promoSave'); if (b) { b.disabled = on; if (!I.sim || !on) b.textContent = on ? '저장 중…' : (I.sim ? '이 항목으로 저장하기' : '저장'); } }
  function onSave() {
    if (!I || I.busy) return;
    if (I.sim) { I.sim = false; I.mode = 'new'; I.orig = ''; readForm(); renderForm(true); msg('이제 「저장」을 누르면 실제 항목으로 들어갑니다.', true); return; }
    readForm();
    var E = validate(); if (Object.keys(E).length) { showErrors(E); return; }
    var row = buildRow(), leadWrite = null, a = I.d.ach_id ? achOf(I.d.ach_id) : null;
    if (a && linkOn() && (I.code === '4-1' || I.code === '4-2')) {
      var want = I.d.lead === 'yes' ? true : (I.d.lead === 'no' ? false : null), cur = (a.data && (a.data.lead === true || a.data.lead === false)) ? a.data.lead : null;
      if (want !== cur) leadWrite = { want: want };
    }
    busy(true); msg('');
    var step = leadWrite ? writeLead(a, leadWrite.want) : Promise.resolve({ ok: true });
    step.then(function (r1) {
      if (!r1.ok) { busy(false); msg(r1.text); return; }
      return X.rpc('promo_save_item', { p_row: row }).then(function (res) { afterSave(res, row, !!leadWrite); });
    }).catch(function (e) { busy(false); msg('저장하지 못했습니다 — ' + X.errText(e) + ' 입력한 내용은 그대로 있습니다.'); });
  }
  function writeLead(a, want) {      // 책임저자 표시는 실적 항목의 data.lead 한 곳에만 적는다
    return X.rpc('ach_save_item', { p_row: { id: a.id, base_rev: a.rev, kind_id: a.kind_id, data: { lead: want } } }).then(function (res) {
      if (isObj(res) && res.ok === true) {
        var d = clone(a.data || {}); if (want === null) delete d.lead; else d.lead = want;
        var next = X.slimAch(isObj(res.row) ? res.row : Object.assign({}, a, { data: d, rev: res.rev || (a.rev + 1) }));       // 서버가 돌려준 행에는 저자 이름이 있을 수 있어 반드시 줄여서(people·note 제외) 보관
        var arr = S().ach, i; for (i = 0; i < arr.length; i++) if (arr[i].id === a.id) arr[i] = next;
        X.saveAch(); return { ok: true };
      }
      if (isObj(res) && res.err === 'CONFLICT') { X.achReload(); return { ok: false, text: '실적 탭의 이 항목이 다른 곳에서 먼저 바뀌었습니다. 실적 탭 자료를 다시 불러왔으니 한 번 더 저장해 주십시오.' }; }
      return { ok: false, text: '실적 탭 항목에 책임저자 표시를 적지 못했습니다. 다시 시도해 주십시오. (입력한 내용은 그대로 있습니다)' };
    });
  }
  function managedEqual(row, srv) {
    var sv = srv.value || {}, ok = true;
    Object.keys(row.value || {}).forEach(function (k) { var a = row.value[k], b = sv[k]; if (a === null ? !blank(b) : String(a) !== String(b)) ok = false; });
    return ok && (row.sub_type || null) === (srv.sub_type || null) && (row.academic_year || null) === (srv.academic_year || null) && row.participants === srv.participants && (row.ach_id || null) === (srv.ach_id || null);
  }
  function afterSave(res, row, leadDone) {
    if (isObj(res) && res.ok === true && isObj(res.row)) {         // 서버가 저장했다고 돌려준 뒤에만 「저장했어요」
      putItem(res.row); X.saveCache(); X.flash(res.row.id); var n = I.mode; hide(); X.render(); X.toast(n === 'new' ? '추가했습니다' : '저장했습니다'); return;
    }
    busy(false);
    var err = isObj(res) ? res.err : '';
    if (err === 'CONFLICT' && isObj(res.row)) {
      if (I.mode === 'new' || managedEqual(row, res.row)) { putItem(res.row); X.saveCache(); X.flash(res.row.id); hide(); X.render(); X.toast('이미 저장돼 있습니다'); return; }    // 응답만 못 받은 경우
      I.srv = res.row; I.view = 'conflict'; renderConflict(); return;
    }
    msg(SAVE_ERR[err] || '저장하지 못했습니다 — 받아들여지지 않았습니다. 다시 시도해 주십시오. 입력한 내용은 그대로 있습니다.');
  }
  function dispOf(f, row, d) {      // 칸 하나의 값을 사람이 읽는 글자로 (row=서버 항목, d=지금 입력)
    var v;
    if (row) { v = f.where === 'col' ? row.academic_year : (f.where === 'sub' ? row.sub_type : (f.where === 'part' ? row.participants : (f.where === 'ev' ? (row.evidence || {})[f.key] : (f.kind === 'date' ? f.keys.map(function (k) { return (row.value || {})[k]; }).filter(function (x) { return !blank(x); }).join('.') : (row.value || {})[f.key])))); }
    else { v = f.where === 'col' ? d.ay : (f.where === 'sub' ? d.sub : (f.where === 'part' ? d.part : (f.where === 'ev' ? d.jc : (f.kind === 'date' ? f.keys.map(function (k) { return d.val[k]; }).filter(function (x) { return !blank(x); }).join('.') : d.val[f.key])))); }
    if (blank(v)) return '(비어 있음)';
    if (f.kind === 'sel') { var o = (f.opts || []).filter(function (x) { return x[0] === String(v); })[0]; return o ? o[1] : String(v); }
    if (f.kind === 'bool') return v === true ? '예' : '아닙니다';
    return String(v);
  }
  function diffLines(srv) {
    var out = [];
    fieldsFor(I.code).forEach(function (f) {
      if (f.where === 'memo' || covered(f)) return;
      var a = dispOf(f, srv, null), b = dispOf(f, null, I.d); if (a !== b) out.push({ label: f.label, srv: a, mine: b });
    });
    return out.slice(0, 8);
  }
  function renderConflict() {
    var s = I.srv, h = head('다른 기기에서 먼저 고쳤습니다');
    var diffs = diffLines(s), dh = '';
    diffs.forEach(function (x) { dh += '<li><b>' + esc(x.label) + '</b><span>다른 기기에 저장된 값 「' + esc(x.srv) + '」</span><span>내 입력 「' + esc(x.mine) + '」</span></li>'; });
    h += '<div class="pconfl"><p>이 항목이 다른 곳에서 먼저 바뀌었습니다. 어떻게 할까요?</p>' + (dh ? '<ul class="pdiffs">' + dh + '</ul>' : '<div class="pcmp"><div><small>다른 기기에 저장된 값</small><b>' + esc(PC.rowLabel(s, R())) + '</b></div><div><small>지금 입력한 값</small><b>' + esc(PC.rowLabel(draftItem(), R())) + '</b></div></div>') + '</div>';
    h += acts('<button type="button" class="pbtn ghost" id="pcTheirs">다른 기기 값 보기 (내 입력은 버립니다)</button><button type="button" class="pbtn" id="pcMine">내 입력으로 덮어쓰기</button>');
    sheet(h, '충돌');
    $('pcMine').onclick = function () { I.base = s; putItem(s); I.view = 'form'; renderForm(true); msg('다른 기기에 저장된 최신 값 위에 내 입력을 얹었습니다. 「저장」을 한 번 더 눌러 주십시오.', true); };
    $('pcTheirs').onclick = function () { putItem(s); X.saveCache(); var id = I.id, code = I.code; hide(); X.render(); openItem(code, id); };
  }

  /* ---------- 삭제(휴지통) · 되돌리기 ---------- */
  function onDelete() {
    if (!I || I.busy || !I.base) return;
    var id = I.id; busy(true);
    X.rpc('promo_trash_item', { p_id: id, p_restore: false }).then(function (ok) {
      if (ok === true) {
        var o = S().items.filter(function (x) { return x.id === id; })[0]; if (o) { o.deleted_at = nowIso(); o.rev = (o.rev || 0) + 1; }
        X.saveCache(); var label = o ? PC.rowLabel(o, R()) : ''; hide(); X.render(); snack('휴지통으로 옮겼습니다', function () { return restore(id); });
        return;
      }
      busy(false); msg('이 항목을 찾지 못했습니다. 화면을 닫고 다시 불러와 주십시오.');
    }).catch(function (e) { busy(false); msg('옮기지 못했습니다 — ' + X.errText(e)); });
  }
  function restore(id) {
    return X.rpc('promo_trash_item', { p_id: id, p_restore: true }).then(function (ok) {
      if (ok === true) { var o = S().items.filter(function (x) { return x.id === id; })[0]; if (o) { o.deleted_at = null; o.rev = (o.rev || 0) + 1; } X.saveCache(); X.render(); return true; }
      return false;
    });
  }
  function snack(text, undo) {
    var v = $('promoView'); if (!v) return;
    var el = $('promoSnack'); if (!el) { el = document.createElement('div'); el.id = 'promoSnack'; el.className = 'psnack'; el.setAttribute('role', 'status'); v.appendChild(el); }
    if (snackTimer) clearTimeout(snackTimer);
    el.innerHTML = '<span>' + esc(text) + '</span><button type="button" id="promoUndo">되돌리기</button>'; el.className = 'psnack show';
    $('promoUndo').onclick = function () {
      if (snackTimer) clearTimeout(snackTimer); el.className = 'psnack';
      undo().then(function (ok) { X.toast(ok ? '되돌렸습니다' : '되돌리지 못했습니다. 휴지통에서 복원해 주십시오.'); }).catch(function (e) { X.toast('되돌리지 못했습니다 — ' + X.errText(e) + ' 휴지통에서 복원해 주십시오.', 3600); });
    };
    snackTimer = setTimeout(function () { el.className = 'psnack'; }, 8000);
  }
  function openTrash() {
    var list = S().items.filter(function (x) { return x.deleted_at; }).sort(function (a, b) { return String(b.deleted_at) < String(a.deleted_at) ? -1 : 1; });
    var h = head('휴지통 (' + list.length + '건)', '복원하면 점수에 다시 들어갑니다. 「완전히 지우기」는 되돌릴 수 없습니다.');
    h += '<ul class="ptrash">';
    if (!list.length) h += '<li class="psb">휴지통이 비어 있습니다.</li>';
    list.forEach(function (o) { h += '<li data-id="' + esc(o.id) + '"><div class="ptl"><b>' + esc(o.item_code + ' · ' + PC.rowLabel(o, R())) + '</b><small>' + esc(String(o.deleted_at).slice(0, 10)) + ' 휴지통으로</small></div><div class="ptb"><button type="button" class="pbtn sm" data-act="restore">복원</button><button type="button" class="pbtn sm ghost danger" data-act="purge">완전히 지우기</button></div></li>'; });
    h += '</ul>' + acts('<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>') + '<div class="psmsg" id="promoMsg" role="alert"></div>';
    sheet(h, '휴지통');
    $('promoCancel').onclick = hide;
    $('promoSheet').onclick = function (ev) {
      var b = ev.target; if (!b || b.tagName !== 'BUTTON' || !b.getAttribute('data-act')) return;
      var li = b.parentNode.parentNode, id = li.getAttribute('data-id'), act = b.getAttribute('data-act');
      if (act === 'restore') { b.disabled = true; restore(id).then(function (ok) { if (ok) { X.toast('복원했습니다'); openTrash(); } else { b.disabled = false; msg('복원하지 못했습니다.'); } }).catch(function (e) { b.disabled = false; msg('복원하지 못했습니다 — ' + X.errText(e)); }); }
      else if (!b.getAttribute('data-sure')) { b.setAttribute('data-sure', '1'); b.textContent = '정말 지울까요?'; setTimeout(function () { if (b.parentNode) { b.removeAttribute('data-sure'); b.textContent = '완전히 지우기'; } }, 3500); }
      else { b.disabled = true; X.rpc('promo_purge_item', { p_id: id }).then(function (ok) { if (ok === true) { S().items = S().items.filter(function (x) { return x.id !== id; }); X.saveCache(); X.toast('완전히 지웠습니다'); openTrash(); X.render(); } else { b.disabled = false; msg('지우지 못했습니다.'); } }).catch(function (e) { b.disabled = false; msg('지우지 못했습니다 — ' + X.errText(e)); }); }
    };
  }

  /* ---------- 곽호석 탭에서 고르기 ---------- */
  function renderPick() {
    var k = linkKind(I.code), list = achCandidates(I.code), q = (I.q || '').toLowerCase().replace(/\s+/g, '');
    var linkedTo = {}; S().items.forEach(function (o) { if (o.ach_id && !o.deleted_at && o.id !== I.id) linkedTo[o.ach_id] = o; });
    var h = head('실적 탭에서 고르기 · ' + k.label, '고른 ' + k.label + '의 제목·연도·저자 수를 그대로 씁니다.');
    h += '<label class="pfld"><span class="plab2">찾기</span><input type="search" id="pPickQ" value="' + esc(I.q || '') + '" placeholder="제목·학술지·연도" autocomplete="off"></label><ul class="ppick" id="pPickL" role="listbox" aria-label="실적 탭 목록"></ul>';
    h += acts('<button type="button" class="pbtn ghost" id="pPickBack">‹ 돌아가기</button>');
    sheet(h, '실적 탭에서 고르기');
    function fill() {
      var ul = $('pPickL'), s = '', n = 0; q = ($('pPickQ').value || '').toLowerCase().replace(/\s+/g, ''); I.q = $('pPickQ').value;
      list.slice().sort(function (a, b) { return (b.year || 0) - (a.year || 0) || String(a.title) < String(b.title) ? -1 : 1; }).forEach(function (a) {
        var hay = (String(a.title || '') + String(a.venue || '') + String(a.year || '')).toLowerCase().replace(/\s+/g, ''); if (q && hay.indexOf(q) < 0) return; n++;
        var used = linkedTo[a.id];
        s += '<li><button type="button" role="option" data-id="' + esc(a.id) + '"><span class="plt">' + esc(a.title || '(제목 없음)') + '</span><small>' + [a.year ? a.year + '년' : '', a.venue || '', PC.achPeopleN(a) ? '저자 ' + PC.achPeopleN(a) + '명' : ''].filter(Boolean).map(esc).join(' · ') + (used ? ' · <b class="warnt">이미 다른 항목에 연결됨</b>' : '') + '</small></button></li>';
      });
      ul.innerHTML = s || '<li class="psb">' + (list.length ? '찾는 항목이 없습니다.' : '실적 탭에 이 종류의 항목이 없습니다.') + '</li>';
    }
    fill();
    $('pPickQ').oninput = fill;
    $('pPickL').onclick = function (ev) {
      var b = ev.target; while (b && b.tagName !== 'BUTTON') b = b.parentNode; if (!b || !b.getAttribute('data-id')) return;
      var a = achOf(b.getAttribute('data-id')); if (!a) return;
      I.d.ach_id = a.id; var n = PC.achPeopleN(a); if (n > 0) I.d.part = n; I.d.lead = (a.data && a.data.lead === true) ? 'yes' : ((a.data && a.data.lead === false) ? 'no' : 'auto');
      I.view = 'form'; renderForm(); X.toast('연결했습니다 — 저장하면 반영됩니다');
    };
    $('pPickBack').onclick = function () { I.view = 'form'; renderForm(); };
  }

  /* ---------- 항목 열기 ---------- */
  function openItem(code, id, o) {
    o = o || {}; var base = id ? S().items.filter(function (x) { return x.id === id && !x.deleted_at; })[0] : null;
    if (id && !base) { X.toast('항목을 찾지 못했습니다.'); return; }
    opener = o.opener || document.activeElement;
    I = { mode: base ? 'edit' : 'new', sim: !!o.sim, code: code || (base && base.item_code), id: base ? base.id : uuid(), base: base ? clone(base) : null, view: 'form', busy: false, q: '' };
    I.d = newD(I.code, I.base);
    if (I.base && I.base.ach_id) { var a = achOf(I.base.ach_id); I.d.lead = (a && a.data && a.data.lead === true) ? 'yes' : ((a && a.data && a.data.lead === false) ? 'no' : 'auto'); }
    if (o.preset) { Object.keys(o.preset).forEach(function (k) { I.d.val[k] = o.preset[k]; }); }
    I.orig = snapshot(I.d); I.memo0 = I.d.memo || '';
    renderForm();
  }
  function openSimPicker() {
    var h = head('점수 더하기 해 보기', '어떤 항목을 더해 볼까요? 저장되지 않고 점수만 계산해 보여 드립니다.');
    h += '<div class="psimg">';
    [1, 2, 3, 4, 5].forEach(function (s) {
      var cs = CODES.filter(function (c) { return sectionOf(c) === s; }); if (!cs.length) return;
      h += '<div class="psgrp"><b>' + s + ' ' + esc((R().sections || {})[s] || '') + '</b>' + cs.map(function (c) { return '<button type="button" class="pbtn sm ghost" data-code="' + c + '">' + c + ' ' + esc(nameOf(c)) + '</button>'; }).join('') + '</div>';
    });
    h += '</div>' + acts('<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>');
    sheet(h, '점수 더하기 해 보기');
    $('promoCancel').onclick = hide;
    $('promoSheet').onclick = function (ev) { var b = ev.target; if (b && b.getAttribute && b.getAttribute('data-code')) { var c = b.getAttribute('data-code'), op = opener; openItem(c, null, { sim: true, opener: op }); } };
  }

  /* ---------- 프로필 고치기 ---------- */
  function openProfile() {
    var p = S().profile || {}, rows = clone(Array.isArray(p.faculty_eval) ? p.faculty_eval : []);
    var A = X.compute(), skipped = {}; if (A && !A.error && A.fe) (A.fe.skipped || []).forEach(function (e) { skipped[e.ay] = e; });
    I = { view: 'profile', mode: 'view', rows: rows, busy: false, clearOk: false, skipped: skipped };
    var h = head('승진 설정', '승진 자료를 고치는 곳입니다. 바꾼 칸만 저장합니다.');
    h += '<label class="pfld"><span class="plab2">현 직급 시작일 <small>(부교수 승진 발령일)</small></span><input type="date" id="promoRs" value="' + esc(p.rank_start || '') + '"></label>';
    h += '<label class="pfld"><span class="plab2">신청 마감일 <small>(모르면 비워 두십시오)</small></span><input type="date" id="promoDl" value="' + esc(p.apply_deadline || '') + '"></label>';
    h += '<label class="pfld"><span class="plab2">총장 가점 <small>(0~50점 · 총점에만 더해집니다)</small></span><input type="text" id="promoBonus" inputmode="numeric" autocomplete="off" value="' + esc(blank(p.president_bonus) ? 0 : p.president_bonus) + '" aria-describedby="pe_bonus"><div class="perr" id="pe_bonus" role="alert"></div></label>';
    h += '<label class="pchk"><input type="checkbox" id="promoQual"' + (p.qual_manual ? ' checked' : '') + '><span>필수 자격(책임저자 논문)을 <b>직접 확인했습니다</b> — 점수판이 통과로 봅니다</span></label>';
    h += '<div class="pfld"><span class="plab2" id="pl_fe">교수업적 순위 <small>(학년도별 상위 %)</small></span><div id="pFeRows"></div><button type="button" class="pbtn sm ghost" id="pFeAdd">＋ 학년도 추가</button><div class="psb">부처장을 하신 학년도는 평가에서 빠져서 값이 있어도 판정에 안 씁니다. 값은 지우지 않고 그대로 둡니다.</div><div class="perr" id="pe_fe" role="alert"></div></div>';
    h += '<div class="psmsg" id="promoMsg" role="alert" aria-live="assertive"></div>' + acts('<button type="button" class="pbtn ghost" id="promoCancel">닫기</button><button type="button" class="pbtn" id="promoSave">저장</button>');
    sheet(h, '승진 설정');
    drawFe(); I.snap = profSnap();          // 칸을 그린 뒤에 기준을 잡아야 아무것도 안 고친 채 닫을 때 묻지 않는다
    $('promoCancel').onclick = tryCloseProfile; $('promoX').onclick = tryCloseProfile; $('promoScrim').onclick = tryCloseProfile; $('promoSave').onclick = saveProfile;
    $('pFeAdd').onclick = function () { readFe(); var last = I.rows.length ? Math.max.apply(null, I.rows.map(function (r) { return parseInt(r.ay, 10) || 0; })) : 2022; I.rows.push({ ay: last + 1, pct: '' }); drawFe(); var inps = document.querySelectorAll('#pFeRows input'); if (inps.length) inps[inps.length - 1].focus(); };
    $('promoRs').oninput = $('promoRs').onchange = function () { I.clearOk = false; var b = $('promoSave'); if (b) b.textContent = '저장'; var m = $('promoMsg'); if (m && /비우/.test(m.textContent)) m.textContent = ''; };
  }
  function profSnap() { return JSON.stringify([$('promoRs').value, $('promoDl').value, $('promoBonus').value, $('promoQual').checked, readFe()]); }
  function tryCloseProfile() {
    if (I && I.view === 'profile' && I.snap !== profSnap()) { confirmBar('저장하지 않은 내용이 있습니다. 닫을까요?', '버리고 닫기', '계속 고치기', hide, function () { var a = $('promoActs'); if (a) a.innerHTML = '<button type="button" class="pbtn ghost" id="promoCancel">닫기</button><button type="button" class="pbtn" id="promoSave">저장</button>'; $('promoCancel').onclick = tryCloseProfile; $('promoSave').onclick = saveProfile; }); return; }
    hide();
  }
  function drawFe() {
    var el = $('pFeRows'), h = '';
    I.rows.forEach(function (r, i) {
      var sk = I.skipped[parseInt(r.ay, 10)];
      h += '<div class="pferow"><label><input type="text" inputmode="numeric" maxlength="4" value="' + esc(r.ay) + '" data-i="' + i + '" data-k="ay" aria-label="학년도"><i>학년도</i></label><label><i>상위</i><input type="text" inputmode="decimal" value="' + esc(r.pct) + '" data-i="' + i + '" data-k="pct" aria-label="상위 퍼센트"><i>%</i></label><button type="button" class="pfedel" data-i="' + i + '" aria-label="' + esc(r.ay) + '학년도 줄 지우기">✕</button></div>' + (sk ? '<div class="psb pfenote">' + esc(r.ay) + '학년도는 부처장 재임(' + sk.cover + '개월)이 겹쳐 평가에서 빠집니다.</div>' : '');
    });
    if (!I.rows.length) h = '<div class="psb">아직 넣은 순위가 없습니다.</div>';
    el.innerHTML = h;
    el.oninput = function (ev) { var t = ev.target; if (t.getAttribute('data-k')) { I.rows[+t.getAttribute('data-i')][t.getAttribute('data-k')] = t.value; } };
    el.onclick = function (ev) { var b = ev.target; if (b.classList && b.classList.contains('pfedel')) { readFe(); I.rows.splice(+b.getAttribute('data-i'), 1); drawFe(); } };
  }
  function readFe() { var out = []; var els = document.querySelectorAll('#pFeRows input'); els.forEach && els.forEach(function (e) { I.rows[+e.getAttribute('data-i')][e.getAttribute('data-k')] = e.value; }); I.rows.forEach(function (r) { out.push([r.ay, r.pct]); }); return out; }
  function saveProfile() {
    if (!I || I.view !== 'profile' || I.busy) return;
    var p = S().profile || {}, rs = $('promoRs').value || null, dl = $('promoDl').value || null, bonusRaw = String($('promoBonus').value).replace(/\s/g, ''), qual = $('promoQual').checked, m = $('promoMsg');
    readFe();
    $('pe_bonus').textContent = ''; $('pe_fe').textContent = '';
    if (rs && !PC.parseDay(rs)) { m.textContent = '시작일 날짜를 확인해 주십시오.'; return; }
    if (dl && !PC.parseDay(dl)) { m.textContent = '신청 마감일 날짜를 확인해 주십시오.'; return; }
    if (rs && dl && dl < rs) { m.textContent = '신청 마감일이 시작일보다 앞섭니다.'; return; }
    var bonus = bonusRaw === '' ? 0 : Number(bonusRaw);
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > 50) { $('pe_bonus').textContent = '총장 가점은 0에서 50 사이 정수로 적어 주십시오.'; $('promoBonus').setAttribute('aria-invalid', 'true'); $('promoBonus').focus(); m.textContent = '빨간 글씨 칸을 확인해 주십시오.'; return; }
    var fe = [], seen = {}, bad = '';
    I.rows.forEach(function (r) {
      var a = String(r.ay).trim(), pc = String(r.pct).replace(/[%\s,]/g, '');
      if (a === '' && pc === '') return;
      var ayN = Number(a), pcN = Number(pc);
      if (!/^\d{4}$/.test(a) || ayN < 2000 || ayN > 2100) bad = bad || '학년도는 숫자 4자리로 적어 주십시오(예: 2024).';
      else if (pc === '' || !isFinite(pcN) || pcN <= 0 || pcN > 100) bad = bad || ayN + '학년도 순위는 0보다 크고 100 이하인 숫자로 적어 주십시오.';
      else if (seen[ayN]) bad = bad || ayN + '학년도가 두 줄입니다. 한 줄만 남겨 주십시오.';
      seen[ayN] = 1; fe.push({ ay: ayN, pct: pcN });
    });
    if (bad) { $('pe_fe').textContent = bad; m.textContent = '빨간 글씨 칸을 확인해 주십시오.'; return; }
    if (!rs && p.rank_start && !I.clearOk) { I.clearOk = true; m.textContent = '시작일을 비우면 현 직급 이전 실적을 거르지 못하고 승진임용 가능일도 계산하지 못합니다. 정말 비울까요?'; $('promoSave').textContent = '네, 비우겠습니다'; return; }
    var row = {}, same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    if ((p.rank_start || null) !== rs) row.rank_start = rs;
    if ((p.apply_deadline || null) !== dl) row.apply_deadline = dl;
    if ((blank(p.president_bonus) ? 0 : p.president_bonus) !== bonus) row.president_bonus = bonus;
    if (!!p.qual_manual !== qual) row.qual_manual = qual;
    if (!same((Array.isArray(p.faculty_eval) ? p.faculty_eval : []).map(function (e) { return [e.ay !== undefined ? e.ay : e.year, Number(e.pct)]; }), fe.map(function (e) { return [e.ay, e.pct]; }))) row.faculty_eval = fe;
    if (!Object.keys(row).length) { hide(); X.toast('바뀐 내용이 없습니다'); return; }
    if (typeof p.rev === 'number') row.base_rev = p.rev;
    I.busy = true; $('promoSave').disabled = true; m.textContent = '저장 중…';
    X.rpc('promo_save_profile', { p_row: row }).then(function (res) {
      if (isObj(res) && res.ok === true && isObj(res.row)) { S().profile = res.row; X.saveCache(); hide(); X.render(); X.toast('저장했습니다'); return; }
      if (isObj(res) && res.err === 'CONFLICT' && isObj(res.row)) {
        var okSame = true; Object.keys(row).forEach(function (k) { if (k === 'base_rev') return; if (JSON.stringify(res.row[k] === undefined ? null : res.row[k]) !== JSON.stringify(row[k])) okSame = false; });
        if (okSame) { S().profile = res.row; X.saveCache(); hide(); X.render(); X.toast('저장했습니다'); return; }          // 응답이 끊겨 다시 보낸 경우: 서버에 이미 같은 값이 있는 것을 확인했으니 저장된 것
        hide(); X.toast('다른 기기에서 먼저 고쳤습니다 — 다시 불러오겠습니다.', 3600); X.load(true); return;
      }
      I.busy = false; $('promoSave').disabled = false; m.textContent = SAVE_ERR[isObj(res) ? res.err : ''] ? '저장하지 못했습니다 — 날짜와 숫자를 확인하고 다시 눌러 주십시오. 입력한 내용은 그대로 있습니다.' : '저장하지 못했습니다 — 날짜를 확인하고 다시 눌러 주십시오. 입력한 내용은 그대로 있습니다.';
    }).catch(function (e) { I.busy = false; var b = $('promoSave'); if (b) b.disabled = false; var m2 = $('promoMsg'); if (m2) m2.textContent = '저장하지 못했습니다 — ' + X.errText(e) + ' 입력한 내용은 그대로 있습니다.'; });
  }

  /* ---------- 연결 제안: 한 번에 확인 · 개별 해제 ---------- */
  function openSuggest() {
    var A = X.compute(); if (!A || A.error) return;
    var list = A.suggestions || [], byItem = {}; S().items.forEach(function (o) { byItem[o.id] = o; });
    I = { view: 'suggest', mode: 'view', busy: false, done: [], list: list };
    var h = head('연결할 수 있는 항목 ' + list.length + '건', '승진 항목과 실적 탭 논문이 같아 보입니다. 연결하면 제목·연도·저자 수를 실적 탭 값으로 씁니다. <b>자동으로 연결하지 않았습니다 — 아래에서 확인해 주십시오.</b>');
    h += '<ul class="psug" id="pSugL">';
    list.forEach(function (c, i) {
      var o = byItem[c.itemId], a = achOf(c.achId); if (!o || !a) return;
      var why = [c.yearOk ? '연도 비슷' : '', c.nOk ? '저자 수 같음' : ''].filter(Boolean).join(' · ');
      h += '<li data-i="' + i + '"><label class="pchk"><input type="checkbox" checked data-i="' + i + '"><span><b>' + esc((o.value && o.value.title) || '(제목 없음)') + '</b><small>승진 항목 · ' + esc(o.item_code) + '</small></span></label><div class="psarrow" aria-hidden="true">↕ 연결</div><div class="psa"><b>' + esc(a.title || '') + '</b><small>실적 탭 · ' + [a.year ? a.year + '년' : '', a.venue || '', why].filter(Boolean).map(esc).join(' · ') + '</small></div>'
        + (c.needLead ? '<div class="psb">책임저자 표시(' + (c.leadPromo ? '예' : '아닙니다') + ')를 실적 탭 항목에 적어 둡니다.</div>' : '') + '<div class="psres" aria-live="polite"></div></li>';
    });
    h += '</ul><div class="psmsg" id="promoMsg" role="alert" aria-live="polite"></div>' + acts('<button type="button" class="pbtn ghost" id="promoCancel">닫기</button><button type="button" class="pbtn" id="pSugGo">선택한 항목 연결하기</button>');
    sheet(h, '연결 제안');
    $('promoCancel').onclick = tryClose;
    $('pSugGo').onclick = runSuggest;
  }
  function runSuggest() {
    var my = I; if (!my || my.busy) return; my.busy = true;
    var boxes = document.querySelectorAll('#pSugL input[type=checkbox]'), pick = [], i;
    for (i = 0; i < boxes.length; i++) if (boxes[i].checked && !boxes[i].disabled) pick.push(+boxes[i].getAttribute('data-i'));
    if (!pick.length) { my.busy = false; msg('연결할 항목을 골라 주십시오.'); return; }
    var go = $('pSugGo'), cl = $('promoCancel'); go.disabled = true; if (cl) { cl.disabled = true; cl.textContent = '연결 중…'; }
    msg('연결 중입니다… 잠깐만 기다려 주십시오.', true);
    var ok = 0, fail = 0, seq = Promise.resolve();
    function line(ix) { var li = document.querySelector('#pSugL li[data-i="' + ix + '"]'); return { li: li, res: li && li.querySelector('.psres') }; }
    pick.forEach(function (ix) {
      seq = seq.then(function () {
        var c = my.list[ix], o = S().items.filter(function (x) { return x.id === c.itemId; })[0], a = achOf(c.achId), L = line(ix);
        if (L.res) L.res.textContent = '연결 중…';
        if (!o || !a) { fail++; if (L.res) L.res.textContent = '연결 못 했습니다 — 항목을 찾지 못했습니다. 화면을 닫고 다시 열어 주십시오.'; return; }
        var pre = Promise.resolve({ ok: true });
        if (c.needLead) pre = writeLead(a, c.leadPromo === true);
        return pre.then(function (r1) {
          if (!r1.ok) { fail++; if (L.res) L.res.textContent = '연결 못 했습니다 — 실적 탭 항목이 먼저 바뀌었습니다. 다시 시도해 주십시오.'; return; }
          var n = PC.achPeopleN(a), row = { id: o.id, base_rev: o.rev, ach_id: a.id, participants: n > 0 ? n : o.participants, section: o.section, item_code: o.item_code };
          return X.rpc('promo_save_item', { p_row: row }).then(function (r) {
            if (isObj(r) && r.ok === true && isObj(r.row)) { putItem(r.row); ok++; if (L.li) { L.li.classList.add('done'); if (L.res) { L.res.className = 'psres ok'; L.res.innerHTML = '✓ 연결했습니다 <button type="button" class="pbtn sm ghost" data-un="' + esc(o.id) + '">연결 끊기</button>'; } } }
            else { fail++; if (L.res) L.res.textContent = '연결 못 했습니다' + ((isObj(r) && r.err === 'CONFLICT') ? ' — 다른 기기에서 먼저 바뀌었습니다. 화면을 닫고 다시 열어 주십시오.' : ' — 다시 시도해 주십시오.'); }
          });
        });
      }).catch(function (e) { fail++; var L = line(ix); if (L.res) L.res.textContent = '연결 못 했습니다 — ' + (e && e.kind === 'net' ? '인터넷이 끊겼습니다. 연결되면 아래 「남은 항목 연결하기」를 다시 눌러 주십시오.' : '다시 시도해 주십시오.'); });
    });
    seq.then(function () {
      my.busy = false; X.saveCache(); X.render();
      Array.prototype.forEach.call(document.querySelectorAll('#pSugL .psres'), function (e) { if (/^연결 못/.test(e.textContent)) e.classList.add('fail'); });
      if (I !== my) return;                                   // (닫기를 막아 두었지만) 창이 바뀌었으면 화면 손대지 않음 — 서버·캐시는 위에서 이미 갱신됨
      var g2 = $('pSugGo'), c2 = $('promoCancel'); if (g2) { g2.disabled = false; g2.textContent = '남은 항목 연결하기'; } if (c2) { c2.disabled = false; c2.textContent = '닫기'; }
      msg(ok + '건 연결했습니다' + (fail ? ' · ' + fail + '건은 못 했습니다(줄에 이유가 있습니다)' : '') + '. 연결된 항목은 아래 「연결 끊기」로 바로 풀 수 있습니다.', fail === 0);
      pick.forEach(function (ix) { var cb = document.querySelector('#pSugL li[data-i="' + ix + '"] input[type=checkbox]'); if (cb && cb.closest('li').classList.contains('done')) { cb.checked = false; cb.disabled = true; } });
    });
    $('pSugL').onclick = function (ev) {
      var b = ev.target; var id = b && b.getAttribute && b.getAttribute('data-un'); if (!id) return;
      var o = S().items.filter(function (x) { return x.id === id; })[0]; if (!o) return; b.disabled = true;
      X.rpc('promo_save_item', { p_row: { id: o.id, base_rev: o.rev, ach_id: null, section: o.section, item_code: o.item_code } }).then(function (r) {
        if (isObj(r) && r.ok === true && isObj(r.row)) { putItem(r.row); X.saveCache(); X.render(); b.parentNode.textContent = '연결을 끊었습니다.'; }
        else { b.disabled = false; b.textContent = '끊지 못했습니다 — 다시'; }
      }).catch(function () { b.disabled = false; b.textContent = '끊지 못했습니다 — 다시'; });
    };
  }

  /* ---------- 백업 내려받기 ---------- */
  /* v9.68(O-0696 후속) — 기본 결과물을 엑셀로: 대표님이 JSON 백업을 받아 보시고 「읽을 수도 없는 이상한 파일」이라고 하셨다. JSON 은 컴퓨터용 형식이라 폰에서 열어도 읽을 수 없다
   *   (파일 이름 · 바이트는 서버 원본과 같다 — 진단은 보고서). 그래서 첫 단추는 「엑셀로 내려받기」(점수 요약 · 항목 목록 · 안내, js/promotion-xlsx.js), JSON 은 둘째 단추 「컴퓨터용 백업(JSON)」으로 남겼다(앱에는 JSON 으로 되돌리는 기능이 없으므로 「복원용」이라고 쓰지 않는다).
   *   창을 열자마자 저장하지 않는다 — 어느 파일을 받을지 단추로 고른다.
   * v9.66 고침(그대로) — 왜 안 됐나: v9.63~65 는 `navigator.share({files})` 로 파일을 넘기고 안 되면 클립보드, 그것도 안 되면 「길게 눌러 복사」 상자였다.
   *   폰 앱(안드로이드 웹뷰)에서 blob 파일 만들기가 안 되는 것은 코드 주석이 근거다(FileDownloadPlugin.java 24행 · app.js v6.7). 공유 창(navigator.share)이 웹뷰에 없다는 것은 코드 근거가 없는 추정이며 실기기 확인 전이다.
   *   고친 길: 앱 다른 곳(문서 사본 저장 · 스캔 [폰에 저장])이 쓰는 폰 저장 — 공유함에 올린 주소를 네이티브 FileDownload 로 받아 「다운로드」 폴더에 둔다(app.js savePhoneFile → X.saveFile).
   *   저장 중/성공/실패를 창 안에 보여 주고(실패하면 이유), [다시 해 보기] · [복사해서 붙여 두기]를 남긴다. 개인정보 규칙은 그대로(저자 이름 · 연동 암호 없음). */
  function localDay() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function openBackup() {
    var p = S().profile, items = S().items, count = items.length;
    var payload = JSON.stringify({ meta: { kind: 'promo_backup', exported_at: nowIso(), rules_ver: S().rulesVer || null, items: items.length, trashed: items.filter(function (x) { return x.deleted_at; }).length }, profile: p, items: items }, null, 1);
    var jsonName = 'promo_backup_' + localDay() + '.json';
    var XL_ON = !!X.xlsx;          // 스위치 PROMO_XLSX(app.js) — 꺼지면 v9.67 처럼 창을 열자마자 JSON 백업을 저장한다
    var my = { view: 'backup', busy: false, kind: XL_ON ? 'xlsx' : 'json' };
    function live() { return I === my && layer() && layer().classList.contains('show'); }
    function why(e) {      // 이유는 쉬운 말만: (HTTP 500) · (FAILED_1006) 같은 기술 표기는 빼고, 「다시 보내 주십시오」는 이 창에 맞게 「다시 해 보십시오」로 (v9.97 O-0854 6번: 합니다체를 해요체로 바꾸던 부분은 없앰)
      return String((e && (e.friendly || e.message)) || e || '알 수 없는 오류').replace(/\s+/g, ' ').replace(/\s*[(（][^)）]*(?:HTTP|FAILED|WAITING|[A-Z_]{5,})[^)）]*[)）]/g, '').replace(/다시 보내 주십시오/g, '다시 해 보십시오').replace(/\s+([.,])/g, '$1').slice(0, 160).replace(/[.。\s]+$/, '');
    }
    function showBox() {
      I = my;
      sheet(head('백업 내려받기', '아래 내용을 길게 눌러 복사한 뒤 메모 앱 등에 붙여 두십시오.') + '<textarea class="pbox" rows="10" readonly id="pBackupBox" aria-label="백업 내용">' + esc(payload) + '</textarea>' + acts('<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>'), '백업');
      $('promoCancel').onclick = hide; var t = $('pBackupBox'); if (t) { t.focus(); t.select(); }
    }
    function copyText() {
      try { navigator.clipboard.writeText(payload).then(function () { if (live()) state('ok', '백업 내용을 복사했습니다 (' + count + '건). 메모 앱 등에 붙여 두십시오.', { kind: 'json' }); else X.toast('백업 내용을 복사했습니다 (' + count + '건)'); }, showBox); } catch (e) { showBox(); }
    }
    var JSON_NOTE = '컴퓨터용 파일이라 열어 봐도 읽을 수 없습니다 — 사무소가 자료를 되살려야 할 때만 쓰는 보관용입니다';      // 앱 안에서 되돌리는 기능은 없다 — 「복원」이라고 쓰지 않는다
    function jsonBlock() { return '<div class="pbkjson"><button type="button" class="pbtn ghost" id="pBkJson">컴퓨터용 백업(JSON)</button><p class="pbknote" id="pBkNote">' + JSON_NOTE + '</p></div>'; }
    /* state: kind = idle(처음) | busy | ok | fail.  o.again = [다시 해 보기] 보임 · o.kind = 방금 다룬 파일 종류('xlsx' | 'json') — 엑셀 쪽 창은 JSON 단추를, JSON 쪽 창은 복사 단추를 곁에 둔다 */
    function state(kind, text, o) {
      o = o || {};
      var st = $('pBkSt'), ac = $('promoActs'); if (!st || !ac) return;
      st.textContent = text; st.className = 'psmsg' + (kind === 'ok' ? ' ok' : ((kind === 'busy' || kind === 'idle') ? ' neutral' : '')); st.setAttribute('role', kind === 'fail' ? 'alert' : 'status');
      var h = '';
      if (kind === 'idle') h = '<button type="button" class="pbtn first" id="pBkExcel">엑셀로 내려받기</button>' + jsonBlock() + '<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>';
      else if (kind === 'busy') h = '<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>';
      else h = (o.again ? '<button type="button" class="pbtn first" id="pBkAgain">다시 해 보기</button>' : '') + '<button type="button" class="pbtn ghost" id="promoCancel">닫기</button>' + (o.kind === 'json' ? '<button type="button" class="pbtn ghost" id="pBkCopy">복사해서 붙여 두기</button>' : jsonBlock());
      ac.className = 'pbtns pbk'; ac.innerHTML = h;
      $('promoCancel').onclick = hide;
      var ex = $('pBkExcel'); if (ex) ex.onclick = function () { run('xlsx'); };
      var jb = $('pBkJson'); if (jb) jb.onclick = function () { run('json'); };
      var c = $('pBkCopy'); if (c) c.onclick = copyText;
      var g = $('pBkAgain'); if (g) g.onclick = function () { run(my.kind); };
    }
    function buildExcel() {      // 눌렀을 때의 최신 점수로 만든다(창을 연 뒤 바뀔 수 있으므로 미리 만들어 두지 않는다)
      var P = global.PromoXlsx, XL = global.XLSX;
      if (!P || !XL || !XL.write) throw new Error('이 앱 버전에서는 엑셀 만들기를 쓸 수 없습니다');
      var A = X.compute();
      if (!A || A.error) throw new Error('점수를 계산하지 못했습니다(점수 규칙표를 받지 못했을 수 있습니다)');
      return P.toFile(XL, P.model({ A: A, items: S().items, rules: S().rules, rulesVer: S().rulesVer, now: new Date() }));
    }
    function run(kind) {
      if (my.busy) return;
      my.kind = kind;
      var f = null, xl = kind !== 'json';
      try { f = xl ? buildExcel() : new File([payload], jsonName, { type: 'application/json' }); }
      catch (e) {
        if (xl) { state('fail', '엑셀 파일을 만들지 못했습니다 — ' + why(e) + '.', { kind: 'xlsx' }); return; }
        f = null;
      }
      if (!f || typeof X.saveFile !== 'function') { state('fail', '파일로 저장하지 못했습니다 — 이 기기에서는 파일 만들기를 쓸 수 없습니다.', { kind: kind }); return; }
      my.busy = true; state('busy', '폰에 저장하는 중입니다… 공유함에 한 부 올려 두고 거기서 받습니다. 몇 초 걸립니다.');
      var done;
      try { done = Promise.resolve(X.saveFile(f)); } catch (e) { done = Promise.reject(e); }
      done.then(function (res) {
        my.busy = false;
        var nm = (res && res.name) || f.name, msgOk, again = false;
        if (xl) {
          again = !!(res && res.quiet);
          msgOk = again ? '저장을 요청했습니다 — 다운로드 폴더(폰은 알림창)에서 「' + nm + '」이 보이는지 확인해 주십시오. 안 보이면 「다시 해 보기」를 눌러 주십시오.'
            : '저장했습니다 — 「' + nm + '」. 폰의 내 파일 › 다운로드에 있습니다. 엑셀 앱으로 열 수 있습니다. 열리지 않으면 PC로 옮겨 열거나 구글 시트로 열 수 있습니다.';
        } else {
          msgOk = res && res.quiet ? '저장을 요청했습니다 — 다운로드 폴더(폰은 알림창)에서 「' + nm + '」이 보이는지 확인해 주십시오. 안 보이면 「복사해서 붙여 두기」를 눌러 주십시오.' : '저장했습니다 — 「' + nm + '」 (' + count + '건). 폰의 「내 파일 › 다운로드」에 있습니다.' + (XL_ON ? ' ' + JSON_NOTE + '.' : '');
        }
        if (live()) state('ok', msgOk, { kind: kind, again: again }); else X.toast((xl ? '엑셀을 저장했습니다 — ' : '백업을 저장했습니다 — ') + nm);
      }, function (e) {
        my.busy = false;
        var t = '파일로 저장하지 못했습니다 — ' + why(e) + (xl ? '. 아래 「다시 해 보기」를 눌러 주십시오.' : '. 아래 「다시 해 보기」를 누르거나, 「복사해서 붙여 두기」로 내용을 대신 보관할 수 있습니다.');
        if (live()) state('fail', t, { kind: kind, again: true }); else X.toast((xl ? '엑셀 파일 저장에 실패했습니다 — ' : '백업 파일 저장에 실패했습니다 — ') + why(e));
      });
    }
    I = my;
    sheet(head('백업 내려받기', (XL_ON ? '점수 요약과 승진 항목 ' + count + '건(휴지통 포함)을 엑셀 파일로 저장합니다. 연동 암호와 저자 이름은 들어가지 않습니다.' : '프로필과 승진 항목 ' + count + '건(휴지통 포함)을 파일 하나로 저장합니다. 연동 암호는 들어가지 않습니다.') + ' 같은 파일이 공유함에도 한 부 남습니다. 공유함에서 지워도 파일 자체는 남습니다(주소를 아는 사람만 열 수 있습니다).') + '<div class="psmsg" id="pBkSt" role="status" aria-live="polite"></div>' + acts(''), '백업');
    if (XL_ON) state('idle', ''); else run('json');
  }

  /* ---------- 바깥에서 부르는 곳 ---------- */
  function init(ctx) { X = ctx; PC = ctx.PC; return api; }
  function back() {
    if (!X || !S().sheet) return false;
    if (I && I.view === 'pick') { I.view = 'form'; renderForm(); return true; }
    if (I && I.view === 'profile') { tryCloseProfile(); return true; }
    tryClose(); return true;
  }
  var api = { init: init, openItem: openItem, openNew: function (code, o) { openItem(code, null, o); }, openProfile: openProfile, openTrash: openTrash, openSuggest: openSuggest, openSimPicker: openSimPicker, openBackup: openBackup, back: back, close: hide, SUB_LOCAL: SUB_LOCAL, fieldsFor: fieldsFor, CODES: CODES };
  global.PromoEdit = api;
})(typeof window !== 'undefined' ? window : globalThis);

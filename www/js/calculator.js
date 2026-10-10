/* ============================================================================
 * calculator.js — 스마트비서 「계산기」 화면 (O-0178)
 * ----------------------------------------------------------------------------
 * 홈 「도구 → 계산기」. 기본(사칙·%·±·괄호) + 공학용(삼각·역삼각·log·ln·10ˣ·eˣ·x²·xʸ·√·ˣ√·1/x·n!·π·e·|x|·EXP·메모리·Ans).
 *  · 계산은 js/calc-engine.js(직접 만든 파서, eval 없음)가 한다. 이 파일은 화면·입력만.
 *  · 식은 「칸(토큰)」 배열로 들고 있다 — 'sin(' 같은 함수는 한 칸이라 ◀ ▶ ⌫ 가 한 번에 한 칸씩 움직이고 지운다.
 *    식 글자를 누르면 그 자리로 커서가 간다.
 *  · 폰 세로: 기본 자판 + [공학용 펼치기]. 넓은 화면(가로 700px↑: 폰 가로·펼친 폴드·DeX·PC판): 공학용 자판이 옆에 함께.
 *  · 블루투스·PC 키보드: 숫자 . + - * / ^ ( ) % ! Enter(=) Backspace ←/→ Delete(모두 지움) p(π).
 *  · 계산 기록: 이 기기에만 저장(localStorage, 최대 100줄). 누르면 그 식을 다시 불러온다. 고른 줄을 케이에게 보낼 수 있다.
 *  · [케이에게 묻기]: 지금 식·결과(또는 고른 기록)를 채팅으로 — 「이 계산 맞는지 봐 줘」는 바로 보내고,
 *    「이 값으로 ○○ 구해 줘」·「직접 적기」는 채팅 입력창에 채워만 둔다(기존 채팅 전송 경로 그대로, SmartHome.sendText / draft).
 * ⚠️ confirm() 금지 → SmartHome.sheet. localStorage 는 전부 try/catch(막혀 있어도 계산은 된다). 새 backdrop-filter 없음.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view = $('calcView'); if (!view || !global.CalcEngine) return;
  var CE = global.CalcEngine;
  function H() { return global.SmartHome || {}; }
  function toast(m, ms) { var S = H(); if (S.toast) S.toast(m, ms); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsJson(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }

  var HIST_KEY = 'smart_calc_hist', HIST_MAX = 100;
  var st = {
    tk: [], cur: 0,                     // 식(칸 배열) · 커서(0..tk.length)
    deg: lsGet('smart_calc_deg', '1') !== '0',
    mem: parseFloat(lsGet('smart_calc_mem', '0')) || 0,
    ans: parseFloat(lsGet('smart_calc_ans', '0')) || 0,
    sci: lsGet('smart_calc_sci', '0') === '1',
    hist: lsJson(HIST_KEY, []),
    done: false,                        // 방금 = 을 눌러 결과를 보는 중
    shown: null,                        // = 로 낸 결과 { text, err }
    histOpen: false, picked: {}
  };
  if (!Array.isArray(st.hist)) st.hist = [];

  /* ---------- 자판 ---------- */
  // [보이는 글자, 동작, 모양]  동작: 'i:칸' = 그 칸 넣기(쉼표로 여러 칸) · 그 밖은 이름 있는 동작
  var SCI = [
    ['sin', 'i:sin('], ['cos', 'i:cos('], ['tan', 'i:tan('], ['π', 'i:π'], ['e', 'i:e'],
    ['sin⁻¹', 'i:sin⁻¹('], ['cos⁻¹', 'i:cos⁻¹('], ['tan⁻¹', 'i:tan⁻¹('], ['|x|', 'i:abs('], ['EXP', 'exp'],
    ['log', 'i:log('], ['ln', 'i:ln('], ['10ˣ', 'i:1,0,^,('], ['eˣ', 'i:e,^,('], ['n!', 'post:!'],
    ['x²', 'post:^,2'], ['xʸ', 'post:^'], ['√', 'i:√('], ['ˣ√y', 'post:ˣ√'], ['1/x', 'post:^,(,−,1,)'],
    ['MC', 'mc', 'mem'], ['MR', 'mr', 'mem'], ['M+', 'm+', 'mem'], ['M−', 'm-', 'mem'], ['Ans', 'i:Ans']
  ];
  var BASIC = [
    ['◀', 'left', 'util'], ['▶', 'right', 'util'], ['%', 'post:%', 'util'], ['⌫', 'back', 'util'],
    ['C', 'clear', 'clr'], ['(', 'i:('], [')', 'i:)'], ['÷', 'op:÷', 'op'],
    ['7', 'i:7', 'num'], ['8', 'i:8', 'num'], ['9', 'i:9', 'num'], ['×', 'op:×', 'op'],
    ['4', 'i:4', 'num'], ['5', 'i:5', 'num'], ['6', 'i:6', 'num'], ['−', 'op:−', 'op'],
    ['1', 'i:1', 'num'], ['2', 'i:2', 'num'], ['3', 'i:3', 'num'], ['+', 'op:+', 'op'],
    ['±', 'sign', 'num'], ['0', 'i:0', 'num'], ['.', 'dot', 'num'], ['=', 'eq', 'eq']
  ];
  var ARIA = { '◀': '커서 왼쪽', '▶': '커서 오른쪽', '⌫': '한 칸 지우기', 'C': '모두 지우기', '±': '부호 바꾸기', '=': '계산', '÷': '나누기', '×': '곱하기', '−': '빼기', '+': '더하기',
    'x²': '제곱', 'xʸ': '거듭제곱', '√': '제곱근', 'ˣ√y': 'x 제곱근', '1/x': '역수', 'n!': '팩토리얼', '10ˣ': '10의 거듭제곱', 'eˣ': 'e의 거듭제곱', '|x|': '절댓값',
    'EXP': '10의 지수 표기', 'MC': '메모리 지우기', 'MR': '메모리 불러오기', 'M+': '메모리에 더하기', 'M−': '메모리에서 빼기', 'Ans': '직전 결과' };
  function keysHtml(list) {
    return list.map(function (k) {
      return '<button type="button" class="ck' + (k[2] ? ' ' + k[2] : '') + '" data-k="' + esc(k[1]) + '" aria-label="' + esc(ARIA[k[0]] || k[0]) + '">' + esc(k[0]) + '</button>';
    }).join('');
  }
  $('calcSci').innerHTML = keysHtml(SCI);
  $('calcBasic').innerHTML = keysHtml(BASIC);

  /* ---------- 식 다루기 ---------- */
  var DIG = /^[0-9]$/;
  var BIN = { '+': 1, '−': 1, '×': 1, '÷': 1 };
  function exprText(tk) { return (tk || st.tk).join(''); }
  function opts() { return { deg: st.deg, ans: st.ans }; }
  function isValueEnd(t) { return t != null && (DIG.test(t) || t === '.' || t === ')' || t === 'π' || t === 'e' || t === 'Ans' || t === '!' || t === '%'); }
  function startFresh(continueWithAns) {                          // = 뒤 첫 입력: 숫자·함수면 새 식, 연산자면 Ans 로 이어서
    if (!st.done) return;
    st.done = false; st.shown = null;
    st.tk = continueWithAns ? ['Ans'] : []; st.cur = st.tk.length;
  }
  function ins(arr) { Array.prototype.splice.apply(st.tk, [st.cur, 0].concat(arr)); st.cur += arr.length; }
  function numRunHasDot() {                                        // 커서가 있는 숫자 덩어리에 이미 소수점이 있나
    var i = st.cur - 1;
    while (i >= 0 && (DIG.test(st.tk[i]) || st.tk[i] === '.')) { if (st.tk[i] === '.') return true; i--; }
    i = st.cur;
    while (i < st.tk.length && (DIG.test(st.tk[i]) || st.tk[i] === '.')) { if (st.tk[i] === '.') return true; i++; }
    return false;
  }
  function numTokens(v) {                                          // 숫자 → 칸들(음수는 괄호로 감쌈)
    var s = CE.format(v, false), arr = s.split('');
    return v < 0 ? ['('].concat(arr, [')']) : arr;
  }
  function currentValue() {                                        // 지금 식의 값(= 로 본 결과가 있으면 그것). 안 되면 null
    if (st.done && st.shown && !st.shown.err) return st.ans;
    var r = CE.tryEval(exprText(), opts());
    return r.ok ? r.value : null;
  }

  function act(k) {
    var prev = st.tk[st.cur - 1];
    if (k.indexOf('i:') === 0) {
      var arr = k.slice(2).split(',');
      startFresh(false);
      ins(arr);
    } else if (k.indexOf('op:') === 0) {
      var op = k.slice(3);
      startFresh(true); prev = st.tk[st.cur - 1];
      if (BIN[prev] && !(op === '−' && (prev === '×' || prev === '÷'))) { st.tk[st.cur - 1] = op; }   // 연산자 바꿔 누르기(2+ → 2×), 「×−」는 음수로 허용
      else if (prev == null && op !== '−') { ins(['Ans', op]); }   // 맨 앞에서 연산자 → 직전 결과로 이어서
      else ins([op]);
    } else if (k.indexOf('post:') === 0) {
      var ps = k.slice(5).split(',');
      startFresh(true); prev = st.tk[st.cur - 1];
      if (!isValueEnd(prev)) { toast('숫자나 괄호 뒤에 눌러 주세요.'); return; }
      ins(ps);
    } else if (k === 'dot') {
      startFresh(false);
      if (numRunHasDot()) return;
      prev = st.tk[st.cur - 1];
      ins(DIG.test(prev || '') ? ['.'] : ['0', '.']);
    } else if (k === 'exp') {
      startFresh(false); prev = st.tk[st.cur - 1];
      if (!(prev && (DIG.test(prev) || prev === '.'))) { toast('EXP 는 숫자 뒤에 눌러 주세요 (예: 6.02 EXP 23).'); return; }
      ins(['E']);
    } else if (k === 'sign') {
      if (st.done) { startFresh(true); ins(['×', '(', '−', '1', ')']); render(); return; }   // 결과의 부호 바꾸기
      var i = st.cur;
      while (i > 0 && (DIG.test(st.tk[i - 1]) || st.tk[i - 1] === '.' || st.tk[i - 1] === 'E')) i--;
      if (st.tk[i - 1] === '−' && st.tk[i - 2] === '(') { st.tk.splice(i - 2, 2); st.cur -= 2; }   // (−5 → 5
      else { st.tk.splice(i, 0, '(', '−'); st.cur += 2; }                                           // 5 → (−5
    } else if (k === 'left') { st.done = false; if (st.cur > 0) st.cur--; }
    else if (k === 'right') { st.done = false; if (st.cur < st.tk.length) st.cur++; }
    else if (k === 'back') {
      if (st.done) { st.done = false; st.shown = null; }          // 결과를 보던 중이면 식을 다시 고치는 상태로만
      else if (st.cur > 0) { st.tk.splice(st.cur - 1, 1); st.cur--; }
    } else if (k === 'clear') { st.tk = []; st.cur = 0; st.done = false; st.shown = null; }
    else if (k === 'eq') { equals(); return; }
    else if (k === 'mc') { st.mem = 0; lsSet('smart_calc_mem', '0'); toast('메모리를 비웠습니다.'); }
    else if (k === 'mr') { startFresh(false); ins(numTokens(st.mem)); }
    else if (k === 'm+' || k === 'm-') {
      var v = currentValue();
      if (v == null) { toast('먼저 계산할 수 있는 식을 넣어 주세요.'); return; }
      st.mem = CE.evaluate('Ans' + (k === 'm+' ? '+' : '−') + '(' + CE.format(v, false) + ')', { ans: st.mem });
      lsSet('smart_calc_mem', String(st.mem));
      toast('메모리 ' + (k === 'm+' ? '+' : '−') + ' → M = ' + CE.format(st.mem, true));
    }
    if (k !== 'eq') st.shown = st.done ? st.shown : null;
    render();
  }

  function equals() {
    if (!st.tk.length) return;
    var text = exprText(), r = CE.tryEval(text, opts());
    if (!r.ok) { st.shown = { err: r.error }; st.done = false; render(); return; }
    st.ans = r.value; lsSet('smart_calc_ans', String(r.value));
    st.shown = { text: r.text }; st.done = true;
    var last = st.hist[0];
    if (!(last && last.e === text && last.r === r.text)) {         // 같은 식을 연달아 = 해도 한 줄만
      st.hist.unshift({ e: text, r: r.text, k: st.tk.slice(), d: st.deg ? 1 : 0, t: Date.now() });
      if (st.hist.length > HIST_MAX) st.hist.length = HIST_MAX;
      lsSet(HIST_KEY, JSON.stringify(st.hist));
    }
    render();
  }

  /* ---------- 그리기 ---------- */
  function render() {
    var ex = $('calcExpr'), rs = $('calcRes');
    var h = '';
    for (var i = 0; i <= st.tk.length; i++) {
      if (i === st.cur && !st.done) h += '<i class="calc-cur" aria-hidden="true"></i>';
      if (i < st.tk.length) {
        var t = st.tk[i], cls = BIN[t] || t === '^' || t === 'ˣ√' ? ' op' : (DIG.test(t) || t === '.' ? '' : ' fn');
        h += '<span class="ct' + cls + '" data-i="' + i + '">' + esc(t) + '</span>';
      }
    }
    if (!st.tk.length) h += '<span class="calc-ph">0</span>';
    ex.innerHTML = h;
    ex.className = 'calc-expr' + (st.tk.length > 44 ? ' xs' : st.tk.length > 22 ? ' sm' : '') + (st.done ? ' done' : '');
    if (st.shown && st.shown.err) { rs.className = 'calc-res err'; rs.textContent = st.shown.err; }
    else if (st.done && st.shown) { rs.className = 'calc-res final'; rs.textContent = '= ' + st.shown.text; }
    else {
      var pv = st.tk.length > 1 ? CE.tryEval(exprText(), opts()) : null;   // 미리보기: 계산이 될 때만 흐리게(안 되면 조용히)
      rs.className = 'calc-res';
      rs.textContent = (pv && pv.ok && pv.text !== exprText()) ? '= ' + pv.text : '';
    }
    var c = ex.querySelector('.calc-cur');
    if (c && c.scrollIntoView) { try { c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    else if (st.done) ex.scrollTop = ex.scrollHeight;
    $('calcAngle').textContent = st.deg ? 'DEG' : 'RAD';
    $('calcAngle').setAttribute('aria-label', '각도 단위: ' + (st.deg ? '도(DEG)' : '라디안(RAD)') + ' — 누르면 바꿈');
    var mm = $('calcMem'); mm.style.display = st.mem ? '' : 'none'; mm.textContent = 'M ' + CE.format(st.mem, true);
    view.classList.toggle('sci-open', st.sci);
    $('calcSciToggle').textContent = st.sci ? '공학용 접기 ▴' : '공학용 펼치기 ▾';
    $('calcSciToggle').setAttribute('aria-expanded', st.sci ? 'true' : 'false');
  }

  /* ---------- 계산 기록 ---------- */
  function histSel() { return st.hist.filter(function (x) { return st.picked[x.t]; }); }
  function renderHist() {
    var box = $('calcHist'); if (!box) return;
    view.classList.toggle('hist-open', st.histOpen);
    $('calcHistBtn').classList.toggle('on', st.histOpen);
    if (!st.histOpen) { box.style.display = 'none'; return; }
    var n = histSel().length;
    var h = '<div class="ch-head"><b>계산 기록</b><span>' + (st.hist.length ? st.hist.length + '줄 · 이 기기에만 저장' : '') + '</span></div>';
    if (!st.hist.length) h += '<div class="empty-note">아직 기록이 없습니다. 계산하고 = 을 누르면 여기에 쌓입니다.</div>';
    else {
      h += '<div class="ch-list">' + st.hist.map(function (x, i) {
        return '<div class="ch-row' + (st.picked[x.t] ? ' on' : '') + '">' +
          '<button type="button" class="ch-pick" data-hp="' + i + '" aria-pressed="' + (st.picked[x.t] ? 'true' : 'false') + '" aria-label="이 줄 고르기"><svg><use href="#i-check"/></svg></button>' +
          '<button type="button" class="ch-load" data-hl="' + i + '"><span class="ch-e">' + esc(x.e) + (x.d === 0 ? ' <em>RAD</em>' : '') + '</span><span class="ch-r">= ' + esc(x.r) + '</span></button></div>';
      }).join('') + '</div>';
      h += '<div class="ch-foot"><button type="button" class="btn ghost sm" id="calcHistAsk"><svg><use href="#i-chat"/></svg>' + (n ? '고른 ' + n + '줄 케이에게' : '케이에게 묻기') + '</button>' +
        '<button type="button" class="btn ghost sm danger" id="calcHistClear"><svg><use href="#i-trash"/></svg>' + (n ? '고른 줄 지우기' : '기록 모두 지우기') + '</button></div>';
      h += '<div class="ch-tip">줄을 누르면 그 식을 다시 불러옵니다. 왼쪽 동그라미로 여러 줄을 골라 케이에게 보낼 수 있습니다.</div>';
    }
    box.innerHTML = h; box.style.display = '';
  }
  $('calcHist').addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-hp],[data-hl],#calcHistAsk,#calcHistClear') : null; if (!t) return;
    if (t.hasAttribute('data-hp')) { var x = st.hist[+t.getAttribute('data-hp')]; if (x) { if (st.picked[x.t]) delete st.picked[x.t]; else st.picked[x.t] = 1; } renderHist(); return; }
    if (t.hasAttribute('data-hl')) {
      var y = st.hist[+t.getAttribute('data-hl')]; if (!y) return;
      st.tk = (y.k || []).slice(); st.cur = st.tk.length; st.done = false; st.shown = null;
      if ((y.d === 0) === st.deg) { st.deg = y.d !== 0; lsSet('smart_calc_deg', st.deg ? '1' : '0'); }   // 그때의 각도 단위로
      st.histOpen = false; renderHist(); render(); return;
    }
    if (t.id === 'calcHistAsk') { askK(); return; }
    if (t.id === 'calcHistClear') {
      var sel = histSel(), S = H();
      var doIt = function () {
        st.hist = sel.length ? st.hist.filter(function (z) { return !st.picked[z.t]; }) : [];
        st.picked = {}; lsSet(HIST_KEY, JSON.stringify(st.hist)); renderHist(); toast('기록을 지웠습니다.');
      };
      if (S.sheet) S.sheet(sel.length ? '고른 ' + sel.length + '줄을 지울까요?' : '계산 기록을 모두 지울까요?', '이 기기에 저장된 계산 기록만 지워집니다. 되돌릴 수 없습니다.', '지우기', 'i-trash', doIt);
      else doIt();
    }
  });

  /* ---------- 케이에게 묻기 ---------- */
  function askLines() {
    var sel = histSel();
    if (sel.length) return sel.slice().reverse().map(function (x) { return x.e + ' = ' + x.r + (x.d === 0 ? ' (RAD)' : ''); });
    if (!st.tk.length) return [];
    var text = exprText(), r = CE.tryEval(text, opts());
    var trig = /sin|cos|tan/.test(text) ? (st.deg ? ' (각도 DEG)' : ' (각도 RAD)') : '';
    return [text + (r.ok ? ' = ' + r.text : ' (계산이 안 됨: ' + r.error + ')') + trig];
  }
  function askBody(lines, q) {
    return '[계산기]\n' + lines.map(function (l, i) { return (lines.length > 1 ? (i + 1) + ') ' : '') + l; }).join('\n') + '\n\n' + q;
  }
  function askK() {
    var lines = askLines(), S = H();
    if (!lines.length) { toast('먼저 식을 넣거나, 기록에서 줄을 골라 주세요.'); return; }
    var old = document.querySelector('.calc-ask'); if (old) { try { old.remove(); } catch (e) {} }
    var sh = document.createElement('div');
    sh.className = 'sheet shin-sheet calc-ask';
    sh.innerHTML = '<div class="sheet-box" role="dialog" aria-label="케이에게 묻기"><div class="sheet-head">케이에게 묻기</div>' +
      '<div class="calc-ask-prev">' + lines.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</div>' +
      '<button type="button" class="sheet-btn" data-ca="check"><svg><use href="#i-check"/></svg><span><b>이 계산 맞는지 봐 줘</b><small>바로 케이에게 보냅니다</small></span></button>' +
      '<button type="button" class="sheet-btn" data-ca="use"><svg><use href="#i-spark"/></svg><span><b>이 값으로 ○○ 구해 줘</b><small>채팅 입력창에 채워 둡니다 — ○○만 고쳐 보내세요</small></span></button>' +
      '<button type="button" class="sheet-btn" data-ca="free"><svg><use href="#i-chat"/></svg><span><b>직접 적기</b><small>식만 채팅 입력창에 넣어 둡니다</small></span></button>' +
      '<button type="button" class="sheet-btn calc-ask-close" data-ca="close">닫기</button></div>';
    sh.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-ca]') : null;
      if (!b && ev.target !== sh) return;
      try { sh.remove(); } catch (e) {}
      var k = b && b.getAttribute('data-ca');
      if (k === 'check') { if (S.sendText) S.sendText(askBody(lines, '이 계산 맞는지 봐 줘')); else if (S.draft) S.draft(askBody(lines, '이 계산 맞는지 봐 줘')); }
      else if (k === 'use') { if (S.draft) S.draft(askBody(lines, '이 값으로 ○○ 구해 줘')); }
      else if (k === 'free') { if (S.draft) S.draft(askBody(lines, '')); }
      if (k && k !== 'close') { st.picked = {}; }
    });
    document.body.appendChild(sh);
    sh.style.display = 'flex';
  }

  /* ---------- 누르기 ---------- */
  view.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.ck') : null;
    if (b) { act(b.getAttribute('data-k')); return; }
    var tok = ev.target.closest ? ev.target.closest('#calcExpr .ct') : null;
    if (tok) {                                                     // 식 글자를 누르면 그 자리로 커서(글자의 왼쪽 절반이면 앞, 오른쪽이면 뒤)
      var i = +tok.getAttribute('data-i'), r = tok.getBoundingClientRect();
      st.cur = i + ((ev.clientX - r.left) > r.width / 2 ? 1 : 0); st.done = false; render(); return;
    }
    if (ev.target.closest && ev.target.closest('#calcExpr')) { st.cur = st.tk.length; st.done = false; render(); }
  });
  $('calcAngle').addEventListener('click', function () {
    st.deg = !st.deg; lsSet('smart_calc_deg', st.deg ? '1' : '0');
    if (st.done) { st.done = false; st.shown = null; }
    render(); toast(st.deg ? '각도 단위: 도(DEG)' : '각도 단위: 라디안(RAD)');
  });
  $('calcSciToggle').addEventListener('click', function () { st.sci = !st.sci; lsSet('smart_calc_sci', st.sci ? '1' : '0'); render(); });
  $('calcHistBtn').addEventListener('click', function () { st.histOpen = !st.histOpen; if (!st.histOpen) st.picked = {}; renderHist(); });
  $('calcAskK').addEventListener('click', askK);

  /* ---------- 키보드(블루투스·PC) ---------- */
  var KEYMAP = { '+': 'op:+', '-': 'op:−', '*': 'op:×', 'x': 'op:×', 'X': 'op:×', '/': 'op:÷', '^': 'post:^', '(': 'i:(', ')': 'i:)', '%': 'post:%', '!': 'post:!',
    '.': 'dot', ',': 'dot', 'Enter': 'eq', '=': 'eq', 'Backspace': 'back', 'Delete': 'clear', 'ArrowLeft': 'left', 'ArrowRight': 'right', 'p': 'i:π', 'e': 'i:e' };
  document.addEventListener('keydown', function (ev) {
    if (view.style.display === 'none' || !view.offsetParent) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    var tg = ev.target, tn = tg && tg.tagName;
    if (tn === 'INPUT' || tn === 'TEXTAREA' || (tg && tg.isContentEditable)) return;
    if (document.querySelector('.sheet[style*="flex"], .modal[style*="flex"]')) return;   // 시트·창이 떠 있으면 계산기 입력이 아님
    var k = /^[0-9]$/.test(ev.key) ? 'i:' + ev.key : KEYMAP[ev.key];
    if (!k) return;
    ev.preventDefault();
    if (tn === 'BUTTON' && tg.blur) tg.blur();                     // Enter 가 눌러 둔 자판 버튼을 한 번 더 누르지 않게
    act(k);
  });

  /* ---------- 화면이 보일 때만 넓은 배치(700px↑에서 공학 자판을 옆에) ---------- */
  function syncOpen() { document.body.classList.toggle('calc-open', view.style.display !== 'none'); }
  try { new MutationObserver(syncOpen).observe(view, { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
  syncOpen();

  global.SmartCalc = {
    onOpen: function () { st.histOpen = false; st.picked = {}; renderHist(); render(); },
    closeHistory: function () { if (!st.histOpen) return false; st.histOpen = false; st.picked = {}; renderHist(); return true; },   // 뒤로가기
    _state: st, _act: act, _render: render                           // 캡처·시험용
  };
  render(); renderHist();
})(window);

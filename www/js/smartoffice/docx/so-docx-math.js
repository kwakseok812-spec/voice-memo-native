/* so-docx-math.js — S-Office 워드 수식(O-0861, v10.9): 수식 틀 단추·간단한 식 글(LaTeX 모양)을 진짜 워드 수식(OMML)으로 만들고, 문서 안 수식을 다시 식 글로 읽어 고친다.
 * 폰 화면의 미리 그림은 MathML 로 한다(브라우저 기본 기능). 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용).
 * 지원: 분수 · 위·아래 첨자 · 제곱근(n제곱근) · 합·곱·적분(위·아래 한계) · 극한 · 괄호(크기 자동) · 행렬 · 연립(cases) · 윗줄·밑줄·모자·화살표 · 그리스 문자 · 자주 쓰는 기호 · 글자(\text) · 함수 이름(sin cos log …)
 */
(function (global) {
  'use strict';
  var M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  var TAG_SRC = '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|<(\\/?)([^\\s\\/>]+)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(\\/?)>';
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unesc(s) { return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

  // ---------------------------------------------------------------- 낱말 표
  var GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ɛ', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  var SYM = { times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
    infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', uparrow: '↑', downarrow: '↓',
    ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', degree: '°', prime: '′', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', quad: '\u2003', qquad: '\u2003\u2003', ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '', ' ': ' ' };
  var NARY = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
  var FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'gcd', 'deg', 'arg', 'Pr', 'mod'];
  var ACC = { hat: '\u0302', tilde: '\u0303', dot: '\u0307', ddot: '\u0308', vec: '\u20D7', check: '\u030C', acute: '\u0301', grave: '\u0300', breve: '\u0306' };
  var STYLES = { mathrm: 'p', mathbf: 'b', mathit: 'i', boldsymbol: 'b', mathbb: 'p', mathcal: 'p' };
  var REV_SYM = {}, REV_GREEK = {}, REV_NARY = {}, REV_ACC = {};
  Object.keys(GREEK).forEach(function (k) { REV_GREEK[GREEK[k]] = REV_GREEK[GREEK[k]] || k; });
  ['times', 'div', 'pm', 'mp', 'cdot', 'leq', 'geq', 'neq', 'approx', 'equiv', 'sim', 'propto', 'infty', 'partial', 'nabla', 'forall', 'exists', 'neg', 'in', 'notin', 'subset', 'supset', 'subseteq', 'supseteq', 'cup', 'cap', 'emptyset', 'to', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'ldots', 'cdots', 'degree', 'angle', 'perp', 'parallel', 'therefore', 'because', 'hbar', 'll', 'gg'].forEach(function (k) { REV_SYM[SYM[k]] = k; });
  Object.keys(NARY).forEach(function (k) { REV_NARY[NARY[k]] = REV_NARY[NARY[k]] || k; });
  Object.keys(ACC).forEach(function (k) { REV_ACC[ACC[k]] = k; });

  // ---------------------------------------------------------------- 식 글 → 나무
  function PErr(msg, pos) { var e = new Error(msg); e.pos = pos; e.mathErr = true; return e; }
  function parse(src) {
    var s = String(src == null ? '' : src), i = 0, n = s.length;
    function peek() { return s.charAt(i); }
    function ws() { while (i < n && /\s/.test(s.charAt(i))) i++; }
    function word() { var m = /^[A-Za-z]+/.exec(s.slice(i)); if (m) { i += m[0].length; return m[0]; } var c = s.charAt(i); i++; return c; }      // 낱말: 영문자 묶음 또는 기호 한 글자
    function rawGroup() {                                // { … } 안의 글을 그대로(글자 모드)
      ws(); if (peek() !== '{') throw PErr('「{」가 필요합니다', i);
      var d = 0, st = i + 1;
      for (; i < n; i++) { var c = s.charAt(i); if (c === '\\') { i++; continue; } if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { var t = s.slice(st, i); i++; return t; } } }
      throw PErr('「}」가 모자랍니다', n);
    }
    function arg() {                                     // 인자 하나: {…} 또는 한 글자(숫자·글자)·\명령
      ws();
      if (peek() === '{') { i++; var k = list(function () { return peek() === '}'; }); if (peek() !== '}') throw PErr('「}」가 모자랍니다', i); i++; return k; }
      if (i >= n) throw PErr('식이 중간에 끝났습니다', i);
      var a = atom(); return a ? [a] : [];
    }
    function list(stop) {                                // stop() 이 참이 될 때까지 원소를 읽는다
      var out = [];
      for (;;) {
        ws(); if (i >= n || stop()) break;
        var c = peek();
        if (c === '&' || (c === '\\' && s.charAt(i + 1) === '\\')) break;
        if (c === '}') throw PErr('짝 없는 「}」가 있습니다', i);
        if (c === '\\' && /^\\(right|end)\b/.test(s.slice(i))) break;
        var a = atomScripts(); if (a) out.push(a);
      }
      return out;
    }
    function atomScripts() {
      var a = atom(); if (!a) return null;
      if (a.t === 'nary' || a.t === 'limop') return a;       // 한계는 atom 안에서 처리
      return scripts(a);
    }
    function scripts(base) {
      var sub = null, sup = null;
      for (;;) {
        ws(); var c = peek();
        if (c === '^' && !sup) { i++; sup = arg(); }
        else if (c === '_' && !sub) { i++; sub = arg(); }
        else break;
      }
      if (sub && sup) return { t: 'subsup', b: [base], sub: sub, sup: sup };
      if (sup) return { t: 'sup', b: [base], sup: sup };
      if (sub) return { t: 'sub', b: [base], sub: sub };
      return base;
    }
    function termUntilOp() {                              // 합·적분의 피연산자: 덧셈·등호·쉼표 같은 연산자나 닫는 곳 전까지(괄호 안은 통째로)
      var out = [], depth = 0;
      for (;;) {
        ws(); if (i >= n) break; var c = peek();
        if (c === '}' || c === '&' || (c === '\\' && /^\\(right|end|\\)/.test(s.slice(i)))) break;
        if (depth === 0 && (c === ')' || c === ']')) break;
        if (depth === 0 && /[+\-=<>,;]/.test(c)) { if (!out.length) { out.push({ t: 'r', s: c }); i++; continue; } break; }
        var a = atomScripts(); if (!a) continue;
        if (a.t === 'r') { if (a.s === '(' || a.s === '[') depth++; else if (a.s === ')' || a.s === ']') depth--; }
        out.push(a);
      }
      return out;
    }
    function atom() {
      ws(); if (i >= n) return null; var c = peek();
      if (c === '{') { i++; var k = list(function () { return peek() === '}'; }); if (peek() !== '}') throw PErr('「}」가 모자랍니다', i); i++; return { t: 'grp', k: k }; }
      if (c === '\\') return command();
      if (c === '^' || c === '_') throw PErr('「' + c + '」 앞에 올라갈 것이 없습니다', i);
      i++;
      return { t: 'r', s: c };
    }
    function command() {
      var st = i; i++; var c = peek();
      if (/[A-Za-z]/.test(c)) { /* 낱말 명령 */ }
      else { i++; if (c === '{' || c === '}' || c === '%' || c === '&' || c === '#' || c === '$' || c === '_') return { t: 'r', s: c }; if (c === '|') return { t: 'r', s: '‖' }; if (SYM[c] != null) return SYM[c] === '' ? null : { t: 'r', s: SYM[c] }; if (c === '\\') return null; throw PErr('알 수 없는 기호 \\' + c, st); }
      i = st + 1; var nm = word();
      if (nm === 'frac' || nm === 'dfrac' || nm === 'tfrac') { var a = arg(), b = arg(); return { t: 'f', n: a, d: b }; }
      if (nm === 'sqrt') { ws(); var deg = null; if (peek() === '[') { var e = s.indexOf(']', i); if (e < 0) throw PErr('「]」가 모자랍니다', i); deg = parse(s.slice(i + 1, e)).k; i = e + 1; } return { t: 'rad', deg: deg, e: arg() }; }
      if (nm === 'left') {
        ws(); var o = delim(); var inner = []; var seps = [];
        for (;;) {
          var part = list(function () { return /^\\right\b/.test(s.slice(i)) || (peek() === '|' && false); });
          inner.push(part); ws();
          if (/^\\right\b/.test(s.slice(i))) break;
          if (peek() === '\\' && s.charAt(i + 1) === '\\') { i += 2; continue; }
          if (i >= n) throw PErr('\\right 가 없습니다', i); throw PErr('식을 읽다가 멈췄습니다', i);
        }
        i += 6; ws(); var cl = delim(); return { t: 'd', beg: o, end: cl, e: inner[0] };
      }
      if (nm === 'right') throw PErr('\\left 없이 \\right 가 있습니다', st);
      if (nm === 'begin') {
        var env = rawGroup().trim(), rows = [[[]]];
        for (;;) {
          var cell = list(function () { return false; }); rows[rows.length - 1][rows[rows.length - 1].length - 1] = cell; ws();
          if (peek() === '&') { i++; rows[rows.length - 1].push([]); continue; }
          if (peek() === '\\' && s.charAt(i + 1) === '\\') { i += 2; rows.push([[]]); continue; }
          if (/^\\end\b/.test(s.slice(i))) { i += 4; var en = rawGroup().trim(); if (en !== env) throw PErr('\\begin{' + env + '} 와 \\end{' + en + '} 가 맞지 않습니다', i); break; }
          if (i >= n) throw PErr('\\end{' + env + '} 가 없습니다', i); throw PErr('식을 읽다가 멈췄습니다', i);
        }
        if (rows.length > 1 && rows[rows.length - 1].length === 1 && !rows[rows.length - 1][0].length) rows.pop();
        var nc = 0; rows.forEach(function (r) { nc = Math.max(nc, r.length); }); rows.forEach(function (r) { while (r.length < nc) r.push([]); });
        if (env === 'matrix') return { t: 'm', rows: rows };
        if (env === 'pmatrix') return { t: 'd', beg: '(', end: ')', e: [{ t: 'm', rows: rows }] };
        if (env === 'bmatrix') return { t: 'd', beg: '[', end: ']', e: [{ t: 'm', rows: rows }] };
        if (env === 'vmatrix') return { t: 'd', beg: '|', end: '|', e: [{ t: 'm', rows: rows }] };
        if (env === 'Vmatrix') return { t: 'd', beg: '‖', end: '‖', e: [{ t: 'm', rows: rows }] };
        if (env === 'cases') return { t: 'd', beg: '{', end: '', e: [{ t: 'eqarr', rows: rows.map(function (r) { return r.reduce(function (a, c, ix) { return a.concat(ix ? [{ t: 'r', s: ' ' }] : [], c); }, []); }) }] };
        if (env === 'aligned' || env === 'align' || env === 'eqnarray') return { t: 'eqarr', rows: rows.map(function (r) { return r.reduce(function (a, c) { return a.concat(c); }, []); }) };
        throw PErr('지원하지 않는 \\begin{' + env + '}', st);
      }
      if (nm === 'end') throw PErr('\\begin 없이 \\end 가 있습니다', st);
      if (NARY[nm]) {
        var sub = null, sup = null; ws();
        for (;;) { ws(); var ch = peek(); if (ch === '_' && !sub) { i++; sub = arg(); } else if (ch === '^' && !sup) { i++; sup = arg(); } else break; }
        return { t: 'nary', chr: NARY[nm], sub: sub, sup: sup, e: termUntilOp() };
      }
      if (nm === 'lim' || nm === 'limsup' || nm === 'liminf' || nm === 'max' || nm === 'min' || nm === 'sup' || nm === 'inf') {
        ws(); if (peek() === '_') { i++; var lo = arg(); return { t: 'limlow', name: nm, lim: lo }; }
        return { t: 'fn', s: nm };
      }
      if (FUNCS.indexOf(nm) >= 0) return { t: 'fn', s: nm };
      if (nm === 'overline' || nm === 'bar') return { t: 'bar', pos: 'top', e: arg() };
      if (nm === 'underline') return { t: 'bar', pos: 'bot', e: arg() };
      if (ACC[nm]) return { t: 'acc', chr: ACC[nm], e: arg() };
      if (nm === 'text' || nm === 'mbox' || nm === 'textrm') return { t: 'nor', s: rawGroup() };
      if (STYLES[nm]) { var g = arg(); return { t: 'sty', sty: STYLES[nm], k: g }; }
      if (nm === 'displaystyle' || nm === 'textstyle' || nm === 'limits' || nm === 'nolimits') return null;
      if (nm === 'overbrace' || nm === 'underbrace') return { t: 'bar', pos: nm === 'overbrace' ? 'top' : 'bot', e: arg() };
      if (GREEK[nm]) return { t: 'r', s: GREEK[nm] };
      if (SYM[nm] != null) return { t: 'r', s: SYM[nm] };
      throw PErr('알 수 없는 낱말 \\' + nm, st);
    }
    function delim() {
      ws(); var c = peek();
      if (c === '\\') { i++; var d = peek(); if (/[A-Za-z]/.test(d)) { var w = word(); if (w === 'langle') return '⟨'; if (w === 'rangle') return '⟩'; if (w === 'lfloor') return '⌊'; if (w === 'rfloor') return '⌋'; if (w === 'lceil') return '⌈'; if (w === 'rceil') return '⌉'; throw PErr('알 수 없는 괄호 \\' + w, i); } i++; if (d === '{') return '{'; if (d === '}') return '}'; if (d === '|') return '‖'; throw PErr('알 수 없는 괄호 \\' + d, i); }
      i++; if (c === '.') return ''; return c;
    }
    var k = list(function () { return false; });
    ws(); if (i < n) { var c0 = peek(); throw PErr(c0 === '}' ? '짝 없는 「}」가 있습니다' : '식을 끝까지 읽지 못했습니다', i); }
    return { t: 'math', k: k };
  }

  // ---------------------------------------------------------------- 나무 → OMML
  var RPR = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
  var RPR_NOR = '<w:rPr><w:rFonts w:ascii="맑은 고딕" w:eastAsia="맑은 고딕" w:hAnsi="맑은 고딕"/></w:rPr>';
  function mrun(text, sty, nor) { return '<m:r>' + (nor ? '<m:rPr><m:nor/></m:rPr>' : (sty ? '<m:rPr><m:sty m:val="' + sty + '"/></m:rPr>' : '')) + (nor ? RPR_NOR : RPR) + '<m:t xml:space="preserve">' + esc(text) + '</m:t></m:r>'; }
  function mlist(k, sty) {                                // 원소 목록 → OMML. 이웃한 글자는 한 런으로 묶는다
    var out = '', buf = '';
    function flush() { if (buf) { out += mrun(buf, sty); buf = ''; } }
    (k || []).forEach(function (x) {
      if (x.t === 'r') { buf += x.s; return; }
      flush(); out += mnode(x, sty);
    });
    flush(); return out;
  }
  function me(k, sty) { return '<m:e>' + mlist(k, sty) + '</m:e>'; }
  function mnode(x, sty) {
    switch (x.t) {
      case 'r': return mrun(x.s, sty);
      case 'nor': return mrun(x.s, null, true);
      case 'fn': return mrun(x.s, 'p');
      case 'grp': return mlist(x.k, sty);
      case 'sty': return mlist(x.k, x.sty);
      case 'f': return '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>' + mlist(x.n, sty) + '</m:num><m:den>' + mlist(x.d, sty) + '</m:den></m:f>';
      case 'sup': return '<m:sSup><m:sSupPr/>' + me(x.b, sty) + '<m:sup>' + mlist(x.sup, sty) + '</m:sup></m:sSup>';
      case 'sub': return '<m:sSub><m:sSubPr/>' + me(x.b, sty) + '<m:sub>' + mlist(x.sub, sty) + '</m:sub></m:sSub>';
      case 'subsup': return '<m:sSubSup><m:sSubSupPr/>' + me(x.b, sty) + '<m:sub>' + mlist(x.sub, sty) + '</m:sub><m:sup>' + mlist(x.sup, sty) + '</m:sup></m:sSubSup>';
      case 'rad': return '<m:rad><m:radPr>' + (x.deg && x.deg.length ? '' : '<m:degHide m:val="1"/>') + '</m:radPr><m:deg>' + mlist(x.deg || [], sty) + '</m:deg>' + me(x.e, sty) + '</m:rad>';
      case 'nary': {
        var lim = /[∫∬∭∮]/.test(x.chr) ? 'subSup' : 'undOvr';
        return '<m:nary><m:naryPr><m:chr m:val="' + x.chr + '"/><m:limLoc m:val="' + lim + '"/>' + (x.sub ? '' : '<m:subHide m:val="1"/>') + (x.sup ? '' : '<m:supHide m:val="1"/>') + '</m:naryPr><m:sub>' + mlist(x.sub || [], sty) + '</m:sub><m:sup>' + mlist(x.sup || [], sty) + '</m:sup>' + me(x.e, sty) + '</m:nary>';
      }
      case 'limlow': return '<m:limLow><m:limLowPr/><m:e>' + mrun(x.name, 'p') + '</m:e><m:lim>' + mlist(x.lim, sty) + '</m:lim></m:limLow>';
      case 'd': return '<m:d><m:dPr><m:begChr m:val="' + esc(x.beg) + '"/><m:endChr m:val="' + esc(x.end) + '"/></m:dPr>' + me(x.e, sty) + '</m:d>';
      case 'm': {
        var nc = x.rows[0].length;
        return '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="' + nc + '"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>' + x.rows.map(function (r) { return '<m:mr>' + r.map(function (c) { return me(c, sty); }).join('') + '</m:mr>'; }).join('') + '</m:m>';
      }
      case 'eqarr': return '<m:eqArr><m:eqArrPr/>' + x.rows.map(function (r) { return me(r, sty); }).join('') + '</m:eqArr>';
      case 'bar': return '<m:bar><m:barPr><m:pos m:val="' + x.pos + '"/></m:barPr>' + me(x.e, sty) + '</m:bar>';
      case 'acc': return '<m:acc><m:accPr><m:chr m:val="' + x.chr + '"/></m:accPr>' + me(x.e, sty) + '</m:acc>';
    }
    return '';
  }
  function toOmml(tree, display) {
    var inner = '<m:oMath>' + mlist(tree.k) + '</m:oMath>';
    return display ? '<m:oMathPara>' + inner + '</m:oMathPara>' : inner;
  }

  // ---------------------------------------------------------------- 나무 → MathML(폰 미리 그림)
  function ml(k) { return (k || []).map(mlnode).join(''); }
  function mrow(k) { var s = ml(k); return '<mrow>' + s + '</mrow>'; }
  function mtok(str, sty) {
    var out = '', i = 0, re = /([0-9]+(?:\.[0-9]+)?)|([A-Za-z\u0370-\u03FF])|([\s\S])/gu, m;
    while ((m = re.exec(str))) {
      if (m[1]) out += '<mn>' + esc(m[1]) + '</mn>';
      else if (m[2]) out += '<mi' + (sty === 'p' ? ' mathvariant="normal"' : (sty === 'b' ? ' mathvariant="bold"' : '')) + '>' + esc(m[2]) + '</mi>';
      else if (/\s/.test(m[3])) out += '<mspace width="0.3em"/>';
      else out += '<mo>' + esc(m[3]) + '</mo>';
    }
    return out;
  }
  function mlnode(x) {
    switch (x.t) {
      case 'r': return mtok(x.s);
      case 'nor': return '<mtext>' + esc(x.s) + '</mtext>';
      case 'fn': return '<mi mathvariant="normal">' + esc(x.s) + '</mi><mo>&#x2061;</mo>';
      case 'grp': return mrow(x.k);
      case 'sty': return '<mrow>' + (x.k || []).map(function (y) { return y.t === 'r' ? mtok(y.s, x.sty) : mlnode(y); }).join('') + '</mrow>';
      case 'f': return '<mfrac>' + mrow(x.n) + mrow(x.d) + '</mfrac>';
      case 'sup': return '<msup>' + mrow(x.b) + mrow(x.sup) + '</msup>';
      case 'sub': return '<msub>' + mrow(x.b) + mrow(x.sub) + '</msub>';
      case 'subsup': return '<msubsup>' + mrow(x.b) + mrow(x.sub) + mrow(x.sup) + '</msubsup>';
      case 'rad': return x.deg && x.deg.length ? '<mroot>' + mrow(x.e) + mrow(x.deg) + '</mroot>' : '<msqrt>' + ml(x.e) + '</msqrt>';
      case 'nary': {
        var op = '<mo largeop="true">' + x.chr + '</mo>', lim = /[∫∬∭∮]/.test(x.chr);
        var h = x.sub && x.sup ? (lim ? '<msubsup>' : '<munderover>') + op + mrow(x.sub) + mrow(x.sup) + (lim ? '</msubsup>' : '</munderover>') : x.sub ? (lim ? '<msub>' : '<munder>') + op + mrow(x.sub) + (lim ? '</msub>' : '</munder>') : x.sup ? (lim ? '<msup>' : '<mover>') + op + mrow(x.sup) + (lim ? '</msup>' : '</mover>') : op;
        return h + mrow(x.e);
      }
      case 'limlow': return '<munder><mi mathvariant="normal">' + esc(x.name) + '</mi>' + mrow(x.lim) + '</munder>';
      case 'd': return '<mrow>' + (x.beg ? '<mo fence="true" stretchy="true">' + esc(x.beg) + '</mo>' : '') + ml(x.e) + (x.end ? '<mo fence="true" stretchy="true">' + esc(x.end) + '</mo>' : '') + '</mrow>';
      case 'm': return '<mtable>' + x.rows.map(function (r) { return '<mtr>' + r.map(function (c) { return '<mtd>' + mrow(c) + '</mtd>'; }).join('') + '</mtr>'; }).join('') + '</mtable>';
      case 'eqarr': return '<mtable columnalign="left">' + x.rows.map(function (r) { return '<mtr><mtd>' + mrow(r) + '</mtd></mtr>'; }).join('') + '</mtable>';
      case 'bar': return (x.pos === 'top' ? '<mover accent="true">' : '<munder accentunder="true">') + mrow(x.e) + '<mo>' + (x.pos === 'top' ? '‾' : '_') + '</mo>' + (x.pos === 'top' ? '</mover>' : '</munder>');
      case 'acc': return '<mover accent="true">' + mrow(x.e) + '<mo>' + x.chr + '</mo></mover>';
    }
    return '';
  }
  function toMathML(tree) { return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>' + ml(tree.k) + '</mrow></math>'; }

  // ---------------------------------------------------------------- OMML → 식 글
  function xtree(str) {                                  // 아주 작은 XML 나무: {n, a:{}, k:[], t}
    var re = new RegExp(TAG_SRC, 'g'), m, root = { n: '#', k: [] }, stack = [root], last = 0;
    while ((m = re.exec(str))) {
      var txt = str.slice(last, m.index); if (txt && stack.length) stack[stack.length - 1].k.push({ n: '#t', t: unesc(txt) }); last = re.lastIndex;
      if (!m[2]) continue;
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      var node = { n: m[2], a: {}, k: [] }; (m[3].match(/[\w:\-]+="[^"]*"/g) || []).forEach(function (kv) { var q = kv.indexOf('='); node.a[kv.slice(0, q)] = unesc(kv.slice(q + 2, -1)); });
      stack[stack.length - 1].k.push(node);
      if (!m[4]) stack.push(node);
    }
    return root;
  }
  function kid(x, name) { for (var i = 0; i < x.k.length; i++) if (x.k[i].n === name) return x.k[i]; return null; }
  function val(x, name, dflt) { var c = x && kid(x, name); return c && c.a && c.a['m:val'] != null ? c.a['m:val'] : dflt; }
  function textOf(x) { var o = ''; x.k.forEach(function (c) { if (c.n === '#t') o += c.t; else o += textOf(c); }); return o; }
  function Unsup(msg) { var e = new Error(msg); e.unsupported = true; return e; }
  function braced(s) { return s.length === 1 ? s : '{' + s + '}'; }
  function lx(list) { return (list || []).map(lnode).join(''); }
  function sub1(x, name) { var c = kid(x, name); return c ? lx(c.k) : ''; }
  function escTex(s) {
    var o = '';
    Array.from(s).forEach(function (ch) {
      if (REV_GREEK[ch]) o += '\\' + REV_GREEK[ch] + ' '; else if (REV_SYM[ch]) o += '\\' + REV_SYM[ch] + ' ';
      else if (ch === '{' || ch === '}' || ch === '%' || ch === '&' || ch === '#' || ch === '$' || ch === '_') o += '\\' + ch;
      else if (ch === '\\') o += '\\backslash '; else if (ch === '‖') o += '\\| '; else o += ch;
    });
    return o;
  }
  function lnode(x) {
    switch (x.n) {
      case '#t': return '';
      case 'm:oMath': case 'm:e': case 'm:num': case 'm:den': case 'm:sub': case 'm:sup': case 'm:deg': case 'm:lim': return lx(x.k);
      case 'm:r': {
        var rp = kid(x, 'm:rPr'), t = '', tn = kid(x, 'm:t'); t = tn ? textOf(tn) : '';
        if (rp && kid(rp, 'm:nor')) return '\\text{' + t.replace(/[{}\\]/g, '') + '}';
        var st = val(rp, 'm:sty', '');
        if (st === 'p' && FUNCS.indexOf(t) >= 0) return '\\' + t + ' ';
        if (st === 'p' && /^[A-Za-z]{2,}$/.test(t)) return '\\mathrm{' + t + '}';
        if (st === 'b') return '\\mathbf{' + t + '}';
        return escTex(t);
      }
      case 'm:f': return '\\frac{' + sub1(x, 'm:num') + '}{' + sub1(x, 'm:den') + '}';
      case 'm:sSup': return braced0(sub1(x, 'm:e')) + '^{' + sub1(x, 'm:sup') + '}';
      case 'm:sSub': return braced0(sub1(x, 'm:e')) + '_{' + sub1(x, 'm:sub') + '}';
      case 'm:sSubSup': return braced0(sub1(x, 'm:e')) + '_{' + sub1(x, 'm:sub') + '}^{' + sub1(x, 'm:sup') + '}';
      case 'm:rad': { var hide = val(kid(x, 'm:radPr'), 'm:degHide', '0'), dg = sub1(x, 'm:deg'); return '\\sqrt' + (dg && hide !== '1' && hide !== 'on' && hide !== 'true' ? '[' + dg + ']' : '') + '{' + sub1(x, 'm:e') + '}'; }
      case 'm:nary': {
        var pr = kid(x, 'm:naryPr'), chr = val(pr, 'm:chr', '∫'), nm = REV_NARY[chr]; if (!nm) throw Unsup('지원하지 않는 큰 기호 ' + chr);
        var sh = val(pr, 'm:subHide', '0'), uh = val(pr, 'm:supHide', '0'), isH = function (v) { return v === '1' || v === 'on' || v === 'true'; };
        var o = '\\' + nm; if (!isH(sh)) o += '_{' + sub1(x, 'm:sub') + '}'; if (!isH(uh)) o += '^{' + sub1(x, 'm:sup') + '}';
        return o + ' ' + sub1(x, 'm:e');
      }
      case 'm:limLow': { var base = sub1(x, 'm:e').trim(); if (/^\\?(lim|limsup|liminf|max|min|sup|inf)\s*$/.test(base) || /^\\mathrm\{(lim|max|min)\}$/.test(base)) return '\\' + base.replace(/^\\mathrm\{|\}$|^\\/g, '').trim() + '_{' + sub1(x, 'm:lim') + '}'; throw Unsup('이 모양의 아래쪽 글'); }
      case 'm:d': {
        var dp = kid(x, 'm:dPr'), bg = val(dp, 'm:begChr', '('), ed = val(dp, 'm:endChr', ')'), es = x.k.filter(function (c) { return c.n === 'm:e'; });
        var inner = es.map(function (c) { return lx(c.k); }).join(' | '); if (es.length > 1) throw Unsup('칸이 여럿인 괄호');
        // 행렬 하나만 든 괄호는 pmatrix 등으로
        if (es.length === 1 && es[0].k.length === 1 && es[0].k[0].n === 'm:m') { var mm = lnode(es[0].k[0]); var env = bg === '(' && ed === ')' ? 'pmatrix' : bg === '[' && ed === ']' ? 'bmatrix' : bg === '|' && ed === '|' ? 'vmatrix' : null; if (env) return mm.replace(/matrix/g, env); }
        if (es.length === 1 && es[0].k.length === 1 && es[0].k[0].n === 'm:eqArr' && bg === '{' && ed === '') return lnode(es[0].k[0]).replace(/aligned/g, 'cases');
        function dl(c) { return c === '' ? '.' : (c === '{' ? '\\{' : (c === '}' ? '\\}' : (c === '⟨' ? '\\langle' : (c === '⟩' ? '\\rangle' : (c === '⌊' ? '\\lfloor' : (c === '⌋' ? '\\rfloor' : (c === '⌈' ? '\\lceil' : (c === '⌉' ? '\\rceil' : (c === '‖' ? '\\|' : c))))))))); }
        return '\\left' + dl(bg) + ' ' + inner + ' \\right' + dl(ed);
      }
      case 'm:m': { var rows = x.k.filter(function (c) { return c.n === 'm:mr'; }).map(function (r) { return r.k.filter(function (c) { return c.n === 'm:e'; }).map(function (c) { return lx(c.k); }).join(' & '); }); return '\\begin{matrix} ' + rows.join(' \\\\ ') + ' \\end{matrix}'; }
      case 'm:eqArr': return '\\begin{aligned} ' + x.k.filter(function (c) { return c.n === 'm:e'; }).map(function (c) { return lx(c.k); }).join(' \\\\ ') + ' \\end{aligned}';
      case 'm:bar': return (val(kid(x, 'm:barPr'), 'm:pos', 'top') === 'bot' ? '\\underline' : '\\overline') + '{' + sub1(x, 'm:e') + '}';
      case 'm:acc': { var ch = val(kid(x, 'm:accPr'), 'm:chr', '\u0302'), cm = REV_ACC[ch]; if (!cm) throw Unsup('지원하지 않는 위 기호'); return '\\' + cm + '{' + sub1(x, 'm:e') + '}'; }
      case 'm:func': return lx(kid(x, 'm:fName') ? kid(x, 'm:fName').k : []) + ' ' + sub1(x, 'm:e');
      case 'm:ctrlPr': case 'm:rPr': case 'w:rPr': return '';
      default: throw Unsup('지원하지 않는 수식 요소 ' + x.n);
    }
  }
  function braced0(s) { return s.length === 1 || /^\\[A-Za-z]+\s?$/.test(s) ? s : '{' + s + '}'; }
  function ommlToTex(ommlXml) {                          // <m:oMath>…</m:oMath> 한 개 → 식 글 (못 읽으면 null)
    try { var t = xtree(ommlXml), o = t.k[0]; if (!o) return null; return lx(o.k).replace(/\s+/g, ' ').replace(/ ?\\\\ ?/g, ' \\\\ ').trim(); } catch (e) { if (e.unsupported) return null; throw e; }
  }

  // ---------------------------------------------------------------- 문서에 넣기 · 찾기 · 지우기
  function mathNsFix(xml) {
    var m = /<w:document\b[^>]*>/.exec(xml); if (!m) return xml;
    if (/\sxmlns:m="/.test(m[0])) return xml;
    return xml.slice(0, m.index) + m[0].replace(/>$/, ' xmlns:m="' + M_NS + '">') + xml.slice(m.index + m[0].length);
  }
  function build(src, display) {
    var tree = parse(src);
    if (!tree.k.length) throw PErr('식을 적어 주십시오', 0);
    return { omml: toOmml(tree, display), mathml: toMathML(tree), tree: tree };
  }
  // 문서 안 수식 목록: [{ord, xi?, display, tex|null, s, e}] — ST.paras 와 같은 순서로 문단을 센다(ST = SODocxStruct)
  function listMath(xml, ST) {
    var ps = ST.paras(xml), out = [], ord = 0;
    ps.forEach(function (p, xi) {
      var ps2 = xml.slice(p.s, p.e), re = /<m:oMathPara\b[^>]*>[\s\S]*?<\/m:oMathPara>|<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/g, m;
      while ((m = re.exec(ps2))) {
        var display = /^<m:oMathPara/.test(m[0]), inner = display ? (/<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/.exec(m[0]) || [''])[0] : m[0];
        out.push({ ord: ord++, xi: xi, display: display, tex: ommlToTex(inner), s: p.s + m.index, e: p.s + m.index + m[0].length });
      }
    });
    return out;
  }
  function addMath(xml, ST, xi, src, display) {         // xi 번 문단 아래에 새 문단으로(display) 또는 문단 끝에 이어서(inline)
    var b = build(src, display), ps = ST.paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다' };
    var nx;
    if (display) nx = xml.slice(0, p.e) + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + b.omml + '</w:p>' + xml.slice(p.e);
    else {
      var ps2 = xml.slice(p.s, p.e), head = /^<w:p\b[^>]*?>/.exec(ps2)[0];
      var np = /\/>$/.test(head) ? head.replace(/\s*\/>$/, '>') + b.omml + '</w:p>' : ps2.slice(0, ps2.length - 6) + b.omml + '</w:p>';
      nx = xml.slice(0, p.s) + np + xml.slice(p.e);
    }
    return { xml: mathNsFix(nx), newA: display ? xi + 1 : xi, mathml: b.mathml };
  }
  function setMath(xml, ST, ord, src) {                  // ord 번째 수식을 새 식으로 바꾼다(가운데 줄 수식은 그대로 가운데 줄로)
    var list = listMath(xml, ST), t = list[ord]; if (!t) return { err: '수식을 찾지 못했습니다' };
    var b = build(src, t.display);
    return { xml: mathNsFix(xml.slice(0, t.s) + b.omml + xml.slice(t.e)), mathml: b.mathml };
  }
  function removeMath(xml, ST, ord) {
    var list = listMath(xml, ST), t = list[ord]; if (!t) return { err: '수식을 찾지 못했습니다' };
    var nx = xml.slice(0, t.s) + xml.slice(t.e);
    // 수식만 든 문단은 문단째 지운다(빈 문단이 남지 않게)
    var ps = ST.paras(nx), hit = null; ps.forEach(function (p) { if (p.s <= t.s && t.s <= p.e) hit = p; });
    if (hit) { var inner = nx.slice(hit.s, hit.e).replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, ''); if (!/<w:t[\s>]|<w:drawing|<m:oMath|<w:tbl/.test(inner) && !hit.anc.some(function (n) { return n === 'w:tc'; })) nx = nx.slice(0, hit.s) + nx.slice(hit.e); }
    return { xml: nx };
  }

  // 틀 단추가 넣어 주는 글(커서 자리에 끼워 넣음)
  var TEMPLATES = [
    ['분수', '\\frac{a}{b}', '\\frac{}{}'], ['위 첨자', 'x^{2}', '^{}'], ['아래 첨자', 'x_{i}', '_{}'], ['제곱근', '\\sqrt{x}', '\\sqrt{}'], ['n제곱근', '\\sqrt[3]{x}', '\\sqrt[]{}'],
    ['합', '\\sum_{i=1}^{n} i', '\\sum_{}^{} '], ['곱', '\\prod_{i=1}^{n} i', '\\prod_{}^{} '], ['적분', '\\int_{a}^{b} f(x)\\,dx', '\\int_{}^{} '], ['극한', '\\lim_{x\\to 0} f(x)', '\\lim_{} '],
    ['괄호 ( )', '\\left( x \\right)', '\\left(  \\right)'], ['대괄호 [ ]', '\\left[ x \\right]', '\\left[  \\right]'], ['중괄호 { }', '\\left\\{ x \\right\\}', '\\left\\{  \\right\\}'], ['절댓값', '\\left| x \\right|', '\\left|  \\right|'],
    ['행렬 2×2', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{pmatrix}  &  \\\\  &  \\end{pmatrix}'], ['연립식', '\\begin{cases} x+y=1 \\\\ x-y=0 \\end{cases}', '\\begin{cases}  \\\\  \\end{cases}'],
    ['윗줄', '\\overline{x}', '\\overline{}'], ['밑줄', '\\underline{x}', '\\underline{}'], ['모자', '\\hat{x}', '\\hat{}'], ['벡터 화살표', '\\vec{v}', '\\vec{}'], ['글자(한글)', '\\text{설명}', '\\text{}']
  ];
  var SYMBOLS = [
    ['그리스 소문자', 'α β γ δ ε ζ η θ λ μ ν ξ π ρ σ τ φ χ ψ ω'.split(' '), function (c) { return '\\' + REV_GREEK[c]; }],
    ['그리스 대문자', 'Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'.split(' '), function (c) { return '\\' + REV_GREEK[c]; }],
    ['연산·관계', '× ÷ ± ∓ ⋅ ≤ ≥ ≠ ≈ ≡ ∝ ∞ ∂ ∇ ° ′'.split(' '), function (c) { return '\\' + REV_SYM[c]; }],
    ['집합·논리·화살표', '∈ ∉ ⊂ ⊃ ⊆ ∪ ∩ ∅ ∀ ∃ → ← ↔ ⇒ ⇔ ∴ ∵'.split(' '), function (c) { return '\\' + REV_SYM[c]; }]
  ];

  global.SODocxMath = { parse: parse, build: build, toOmml: toOmml, toMathML: toMathML, ommlToTex: ommlToTex, listMath: listMath, addMath: addMath, setMath: setMath, removeMath: removeMath, mathNsFix: mathNsFix, TEMPLATES: TEMPLATES, SYMBOLS: SYMBOLS, GREEK: GREEK };
})(typeof window !== 'undefined' ? window : globalThis);

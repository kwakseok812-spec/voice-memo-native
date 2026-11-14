/* so-xlsx-calc.js — S-Office 엑셀 「합계 바로 보이기」 자체 계산기(O-0861, v10.4)
 * ----------------------------------------------------------------------------
 * 외부 계산 부품 없이, 허용한 수식만 폰에서 계산해 칸의 저장된 값(<v>)과 화면에 보여 준다.
 *   허용: 사칙(+ − × ÷ ^)·%·글자 잇기(&)·비교·괄호·칸/범위(다른 시트 포함) 와
 *         SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK PRODUCT IF IFERROR AND OR NOT ROUND ROUNDUP ROUNDDOWN INT ABS MOD
 *   v10.8 2회차 추가: SUMIF(S) COUNTIF(S) AVERAGEIF(S) MAXIFS MINIFS SUMPRODUCT RANK LARGE SMALL MEDIAN STDEV VAR VLOOKUP HLOOKUP INDEX MATCH CHOOSE IFS SWITCH IFNA IS* ROW COLUMN
 *         SQRT POWER SIGN TRUNC CEILING FLOOR LEN LEFT RIGHT MID UPPER LOWER TRIM CONCAT(ENATE) TEXTJOIN FIND SEARCH SUBSTITUTE REPT EXACT VALUE TEXT DATE YEAR MONTH DAY WEEKDAY EDATE EOMONTH DAYS DATEDIF TODAY(앱이 오늘 날짜를 줄 때만)
 *   그 밖의 함수는 계산하지 않는다.
 * 켜는 조건: 파일을 열 때 모든 수식을 계산해 파일에 저장돼 있던 값과 대조해 「전부 맞을 때만」 켠다. 하나라도 계산 못 하거나 다르거나, 비교할 저장값이 없으면 파일 전체를 끈다(조용한 오답 방지).
 * 브라우저·Node 모두에서 돈다(시험용).
 */
(function (global) {
  'use strict';

  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function Unsupported(m) { this.msg = m; }
  function ErrV(code) { this.e = code; }
  function isErr(v) { return v instanceof ErrV; }

  // ------------------------------ 글자 → 낱말 ------------------------------
  var TOK = new RegExp("\\s*(?:(\"(?:[^\"]|\"\")*\")|((?:'(?:[^']|'')+'|[A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*)!)?(\\$?[A-Z]{1,3}\\$?\\d+)(?::(\\$?[A-Z]{1,3}\\$?\\d+))?(?![\\w(.])|([A-Za-z_][\\w.]*)\\(|(\\d+\\.?\\d*(?:[eE][+-]?\\d+)?|\\.\\d+(?:[eE][+-]?\\d+)?)|(TRUE|FALSE)(?![\\w(])|([A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*)(?![\\w(!.])|(<>|<=|>=|[-+*/^&=<>(),%])|(#[A-Z0\\/]+[!?]?))", 'y');
  function tokenize(f) {
    var out = [], pos = 0, m;
    while (pos < f.length) {
      TOK.lastIndex = pos; m = TOK.exec(f);
      if (!m) { if (/^\s*$/.test(f.slice(pos))) break; throw new Unsupported('낱말'); }
      pos = TOK.lastIndex;
      if (m[1] != null) out.push({ k: 's', v: m[1].slice(1, -1).replace(/""/g, '"') });
      else if (m[3] != null) out.push({ k: 'ref', sheet: m[2] ? m[2].slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null, a: m[3], b: m[4] || null });
      else if (m[5] != null) out.push({ k: 'fn', v: m[5].toUpperCase() });
      else if (m[6] != null) out.push({ k: 'n', v: parseFloat(m[6]) });
      else if (m[7] != null) out.push({ k: 'b', v: m[7] === 'TRUE' });
      else if (m[8] != null) out.push({ k: 'name', v: m[8] });
      else if (m[9] != null) out.push({ k: 'op', v: m[9] });
      else throw new Unsupported('오류값');
    }
    return out;
  }
  function parseRef(t) { var m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(t); return { c: colNum(m[1]), r: +m[2] }; }

  // ------------------------------ 낱말 → 나무 ------------------------------
  function parse(f) {
    var T = tokenize(f), i = 0;
    function peek() { return T[i]; }
    function isOp(v) { return T[i] && T[i].k === 'op' && T[i].v === v; }
    function cmp() {
      var l = cat();
      while (T[i] && T[i].k === 'op' && /^(=|<>|<=|>=|<|>)$/.test(T[i].v)) { var o = T[i++].v; l = { t: 'bin', o: o, l: l, r: cat() }; }
      return l;
    }
    function cat() { var l = add(); while (isOp('&')) { i++; l = { t: 'bin', o: '&', l: l, r: add() }; } return l; }
    function add() { var l = mul(); while (isOp('+') || isOp('-')) { var o = T[i++].v; l = { t: 'bin', o: o, l: l, r: mul() }; } return l; }
    function mul() { var l = pow(); while (isOp('*') || isOp('/')) { var o = T[i++].v; l = { t: 'bin', o: o, l: l, r: pow() }; } return l; }
    function pow() { var l = unary(); while (isOp('^')) { i++; l = { t: 'bin', o: '^', l: l, r: unary() }; } return l; }
    function unary() {
      if (isOp('-')) { i++; return { t: 'neg', x: unary() }; }
      if (isOp('+')) { i++; return unary(); }
      var p = prim(); while (isOp('%')) { i++; p = { t: 'pct', x: p }; } return p;
    }
    function prim() {
      var k = T[i]; if (!k) throw new Unsupported('끝');
      if (k.k === 'n') { i++; return { t: 'num', v: k.v }; }
      if (k.k === 's') { i++; return { t: 'str', v: k.v }; }
      if (k.k === 'b') { i++; return { t: 'bool', v: k.v }; }
      if (k.k === 'name') { i++; return { t: 'name', v: k.v }; }
      if (k.k === 'ref') { i++; return { t: 'ref', sheet: k.sheet, a: parseRef(k.a), b: k.b ? parseRef(k.b) : null }; }
      if (k.k === 'fn') {
        i++; var args = [];
        if (!isOp(')')) { for (;;) { if (isOp(',') || isOp(')')) args.push({ t: 'empty' }); else args.push(cmp()); if (isOp(',')) { i++; continue; } break; } }
        if (!isOp(')')) throw new Unsupported('괄호'); i++;
        return { t: 'fn', name: k.v, args: args };
      }
      if (isOp('(')) { i++; var e = cmp(); if (!isOp(')')) throw new Unsupported('괄호'); i++; return e; }
      throw new Unsupported('모양');
    }
    var tree = cmp(); if (i < T.length) throw new Unsupported('남은 글자');
    return tree;
  }

  // ------------------------------ 값 도우미 ------------------------------
  function fmtNum(n) { return String(Number(n.toPrecision(15))); }
  function toNum(v) {         // 직접 넣은 값을 숫자로(칸 안 글자·빈 칸 규칙 포함)
    if (isErr(v)) return v; if (v == null) return 0; if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    var s = String(v).trim(); if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
    return new ErrV('#VALUE!');
  }
  function toStr(v) { if (isErr(v)) return v; if (v == null) return ''; if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'; if (typeof v === 'number') return fmtNum(v); return String(v); }
  function toBool(v) { if (isErr(v)) return v; if (v == null) return false; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; var s = String(v).toUpperCase(); if (s === 'TRUE') return true; if (s === 'FALSE') return false; return new ErrV('#VALUE!'); }
  function rank(v) { return v == null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3; }
  function cmpVals(a, b) {
    if (a == null && typeof b === 'string') a = ''; else if (b == null && typeof a === 'string') b = ''; else { if (a == null) a = typeof b === 'boolean' ? false : 0; if (b == null) b = typeof a === 'boolean' ? false : 0; }
    var ra = rank(a), rb = rank(b); if (ra !== rb) return ra < rb ? -1 : 1;
    if (typeof a === 'string') { a = a.toLowerCase(); b = b.toLowerCase(); }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function xround(x, d, mode) {       // mode: 0 반올림(0에서 먼 쪽), 1 올림, -1 버림
    var f = Math.pow(10, d), sg = x < 0 ? -1 : 1, ax = Number(Math.abs(x).toPrecision(15)), y = Number((ax * f).toPrecision(15)), r;
    r = mode === 0 ? Math.round(y) : mode > 0 ? Math.ceil(y) : Math.floor(y);
    return sg * r / f;
  }

  // ------------------------------ 계산 ------------------------------
  // model.cell(sheet, r, c) → { t:'n'|'s'|'b'|'e'|'z', v, f } | undefined  (r, c 는 1부터) · model.has(sheet)
  function Engine(model) { this.m = model; this.memo = {}; this.stack = {}; this.trees = {}; }
  Engine.prototype.cellValue = function (sheet, r, c) {
    var cl = this.m.cell(sheet, r, c); if (!cl) return null;
    if (cl.f != null && cl.f !== '') return this.formulaValue(sheet, r, c, cl);
    if (cl.t === 'n') return cl.v; if (cl.t === 'b') return !!cl.v; if (cl.t === 's') return cl.v == null ? '' : String(cl.v);
    if (cl.t === 'e') return new ErrV(typeof cl.w === 'string' && cl.w.charAt(0) === '#' ? cl.w : '#VALUE!');
    return null;
  };
  Engine.prototype.formulaValue = function (sheet, r, c, cl) {
    var key = sheet + '|' + r + '|' + c;
    if (key in this.memo) { var mv = this.memo[key]; if (mv instanceof Unsupported) throw mv; return mv; }
    if (this.stack[key]) throw new Unsupported('순환');
    this.stack[key] = 1;
    try {
      var tree = this.trees[cl.f] || (this.trees[cl.f] = parse(cl.f)), v = this.ev(tree, sheet);
      if (v && v.range) v = new ErrV('#VALUE!');
      this.memo[key] = v; return v;
    } catch (e) { if (e instanceof Unsupported) this.memo[key] = e; throw e; }
    finally { delete this.stack[key]; }
  };
  Engine.prototype.rangeCells = function (rg, fn) {
    var m = this.m, r0 = Math.min(rg.a.r, rg.b.r), r1 = Math.max(rg.a.r, rg.b.r), c0 = Math.min(rg.a.c, rg.b.c), c1 = Math.max(rg.a.c, rg.b.c);
    for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) { var cl = m.cell(rg.sheet, r, c); if (cl === undefined && !(r === r0 && c === c0)) { fn(null, true); continue; } fn(this.cellValue(rg.sheet, r, c), !cl); }
  };
  Engine.prototype.ev = function (n, sheet) {
    var self = this, v, a, b;
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'empty': return null;
      case 'neg': v = toNum(this.ev(n.x, sheet)); return isErr(v) ? v : -v;
      case 'pct': v = toNum(this.ev(n.x, sheet)); return isErr(v) ? v : v / 100;
      case 'ref':
        var sh = n.sheet || sheet; if (!this.m.has(sh)) return new ErrV('#REF!');
        if (n.b) return { range: { sheet: sh, a: n.a, b: n.b } };
        return this.cellValue(sh, n.a.r, n.a.c);
      case 'bin':
        a = this.ev(n.l, sheet); b = this.ev(n.r, sheet);
        if (a && a.range || b && b.range) return new ErrV('#VALUE!');
        if (isErr(a)) return a; if (isErr(b)) return b;
        if (n.o === '&') return toStr(a) + toStr(b);
        if (/^(=|<>|<|>|<=|>=)$/.test(n.o)) { var c = cmpVals(a, b); return n.o === '=' ? c === 0 : n.o === '<>' ? c !== 0 : n.o === '<' ? c < 0 : n.o === '>' ? c > 0 : n.o === '<=' ? c <= 0 : c >= 0; }
        a = toNum(a); b = toNum(b); if (isErr(a)) return a; if (isErr(b)) return b;
        if (n.o === '+') return a + b; if (n.o === '-') return a - b; if (n.o === '*') return a * b;
        if (n.o === '/') return b === 0 ? new ErrV('#DIV/0!') : a / b;
        if (n.o === '^') { var p = Math.pow(a, b); return isFinite(p) ? p : new ErrV('#NUM!'); }
        throw new Unsupported('연산');
      case 'name':
        var nr = this.m.name ? this.m.name(n.v, sheet) : null; if (!nr) throw new Unsupported('이름');
        var nt = tokenize(nr); if (nt.length !== 1 || nt[0].k !== 'ref') throw new Unsupported('이름');
        var rn = { t: 'ref', sheet: nt[0].sheet, a: parseRef(nt[0].a), b: nt[0].b ? parseRef(nt[0].b) : null };
        return this.ev(rn, sheet);
      case 'fn': return this.fn(n, sheet);
    }
    throw new Unsupported('모양');
  };
  Engine.prototype.fn = function (n, sheet) {
    var self = this, name = n.name, A = n.args;
    function nums(skipText) {           // 범위는 숫자만, 직접 넣은 값은 숫자로 바꿔서 모은다
      var out = [], err = null;
      A.forEach(function (x) {
        if (err) return; var v = self.ev(x, sheet);
        if (v && v.range) { self.rangeCells(v.range, function (cv) { if (err) return; if (isErr(cv)) { err = cv; return; } if (typeof cv === 'number') out.push(cv); }); }
        else { if (isErr(v)) { err = v; return; } if (v == null && x.t === 'empty') return; var nv = toNum(v); if (isErr(nv)) { err = nv; return; } out.push(nv); }
      });
      return err ? err : out;
    }
    switch (name) {
      case 'SUM': { var s = nums(); return isErr(s) ? s : s.reduce(function (p, q) { return p + q; }, 0); }
      case 'PRODUCT': { var pp = nums(); return isErr(pp) ? pp : pp.length ? pp.reduce(function (p, q) { return p * q; }, 1) : 0; }
      case 'AVERAGE': { var av = nums(); if (isErr(av)) return av; return av.length ? av.reduce(function (p, q) { return p + q; }, 0) / av.length : new ErrV('#DIV/0!'); }
      case 'MIN': { var mi = nums(); return isErr(mi) ? mi : mi.length ? Math.min.apply(null, mi) : 0; }
      case 'MAX': { var ma = nums(); return isErr(ma) ? ma : ma.length ? Math.max.apply(null, ma) : 0; }
      case 'COUNT': {
        var cnt = 0, e1 = null;
        A.forEach(function (x) { var v = self.ev(x, sheet); if (v && v.range) self.rangeCells(v.range, function (cv) { if (typeof cv === 'number') cnt++; }); else if (!isErr(v) && typeof toNum(v) === 'number' && !isErr(toNum(v)) && v != null) cnt++; });
        return cnt;
      }
      case 'COUNTA': {
        var ca = 0;
        A.forEach(function (x) { var v = self.ev(x, sheet); if (v && v.range) self.rangeCells(v.range, function (cv) { if (cv !== null) ca++; }); else if (!(x.t === 'empty')) ca++; });
        return ca;
      }
      case 'COUNTBLANK': {
        var cb = 0; if (A.length !== 1) throw new Unsupported('인수');
        var rg = this.ev(A[0], sheet); if (!(rg && rg.range)) throw new Unsupported('인수');
        this.rangeCells(rg.range, function (cv, blank) { if (blank || cv === '' || cv === null) cb++; }); return cb;
      }
      case 'IF': {
        if (A.length < 2 || A.length > 3) throw new Unsupported('인수');
        var cond = toBool(this.ev(A[0], sheet)); if (isErr(cond)) return cond;
        var pick = cond ? A[1] : (A.length === 3 ? A[2] : null);
        if (!pick) return false; var pv = this.ev(pick, sheet); if (pick.t === 'empty') return 0; return pv && pv.range ? new ErrV('#VALUE!') : pv;
      }
      case 'IFERROR': { if (A.length !== 2) throw new Unsupported('인수'); var iv = this.ev(A[0], sheet); return isErr(iv) ? this.ev(A[1], sheet) : iv; }
      case 'AND': case 'OR': {
        var res = name === 'AND', got = false, er = null;
        A.forEach(function (x) { var v = self.ev(x, sheet); var list = []; if (v && v.range) self.rangeCells(v.range, function (cv) { if (typeof cv === 'boolean' || typeof cv === 'number') list.push(cv); else if (isErr(cv)) er = cv; }); else list.push(v);
          list.forEach(function (q) { var b = toBool(q); if (isErr(b)) { er = er || b; return; } got = true; if (name === 'AND') res = res && b; else res = res || b; }); });
        if (er) return er; return got ? res : new ErrV('#VALUE!');
      }
      case 'NOT': { if (A.length !== 1) throw new Unsupported('인수'); var nb = toBool(this.ev(A[0], sheet)); return isErr(nb) ? nb : !nb; }
      case 'ABS': { if (A.length !== 1) throw new Unsupported('인수'); var ab = toNum(this.ev(A[0], sheet)); return isErr(ab) ? ab : Math.abs(ab); }
      case 'INT': { if (A.length !== 1) throw new Unsupported('인수'); var iv2 = toNum(this.ev(A[0], sheet)); return isErr(iv2) ? iv2 : Math.floor(iv2); }
      case 'MOD': {
        if (A.length !== 2) throw new Unsupported('인수'); var x1 = toNum(this.ev(A[0], sheet)), y1 = toNum(this.ev(A[1], sheet)); if (isErr(x1)) return x1; if (isErr(y1)) return y1;
        if (y1 === 0) return new ErrV('#DIV/0!'); return x1 - y1 * Math.floor(x1 / y1);
      }
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
        if (A.length !== 2) throw new Unsupported('인수'); var x2 = toNum(this.ev(A[0], sheet)), d2 = toNum(this.ev(A[1], sheet)); if (isErr(x2)) return x2; if (isErr(d2)) return d2;
        return xround(x2, Math.trunc(d2), name === 'ROUND' ? 0 : name === 'ROUNDUP' ? 1 : -1);
      }
    }
    return this.fn2(n, sheet);
  };

  // ============================== v10.8 2회차: 함수 넓히기 ==============================
  // 조건 합계·개수·평균, 찾아보기(VLOOKUP·HLOOKUP·INDEX·MATCH), 순위·통계, 글자·날짜·TEXT 등. 값이 엑셀과 모두 같을 때만 계산을 켜는 원칙은 그대로다.
  var WILD = /[*?~]/;
  function critOf(c) {          // 조건(숫자·글자·「>=5」 꼴)을 (칸 값 → 맞나) 함수로
    var op = '=', val = c;
    if (typeof c === 'string') { var mm = /^(<>|>=|<=|=|<|>)([\s\S]*)$/.exec(c); if (mm) { op = mm[1]; val = mm[2]; } }
    var numv = null, boolv = null;
    if (typeof val === 'number') numv = val;
    else if (typeof val === 'boolean') boolv = val;
    else if (typeof val === 'string') {
      var t = val.trim();
      if (t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) numv = parseFloat(t);
      else if (/^(TRUE|FALSE)$/i.test(t) && op === '=') boolv = t.toUpperCase() === 'TRUE';
      else if (/^[+-]?[\d.,\/:\- ]*\d[\d.,\/:\- ]*%?$/.test(t)) throw new Unsupported('조건형식');      // 날짜·쉼표·퍼센트 꼴 조건은 엑셀이 숫자로 바꿔 비교한다 — 우리는 계산하지 않는다
    } else if (val == null) val = '';
    if (numv != null) {
      return function (v) {
        if (typeof v === 'string') { var s = v.trim(); if (op === '=' || op === '<>') { var pv = (s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) ? parseFloat(s) : null; if (op === '<>') return true; if (pv == null) return false; return pv === numv; } return false; }
        if (typeof v !== 'number') return op === '<>';
        return op === '=' ? v === numv : op === '<>' ? v !== numv : op === '>' ? v > numv : op === '<' ? v < numv : op === '>=' ? v >= numv : v <= numv;
      };
    }
    if (boolv != null) return function (v) { return typeof v === 'boolean' ? v === boolv : false; };
    var s0 = String(val);
    if (op === '=' || op === '<>') {
      if (s0 === '') return function (v) { var blank = v == null || v === ''; return op === '=' ? blank : !blank; };
      var re = null, low = s0.toLowerCase();
      if (WILD.test(s0)) { var src = ''; for (var i = 0; i < s0.length; i++) { var ch = s0.charAt(i); if (ch === '~' && i + 1 < s0.length && /[*?~]/.test(s0.charAt(i + 1))) { src += '\\' + s0.charAt(++i); } else if (ch === '*') src += '[\\s\\S]*'; else if (ch === '?') src += '[\\s\\S]'; else src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'); } re = new RegExp('^' + src + '$', 'i'); }
      return function (v) {
        var hit = typeof v === 'string' && (re ? re.test(v) : v.toLowerCase() === low);
        return op === '=' ? hit : !hit;
      };
    }
    var low2 = s0.toLowerCase();
    return function (v) { if (typeof v !== 'string') return false; var a = v.toLowerCase(); return op === '>' ? a > low2 : op === '<' ? a < low2 : op === '>=' ? a >= low2 : a <= low2; };
  }
  Engine.prototype.rangeOf = function (node, sheet) {
    var v = this.ev(node, sheet);
    if (v && v.range) return v.range;
    if (node.t === 'ref') { var sh = node.sheet || sheet; return { sheet: sh, a: node.a, b: node.a }; }
    throw new Unsupported('범위');
  };
  Engine.prototype.matrix = function (rg) {
    var m = this.m, r0 = Math.min(rg.a.r, rg.b.r), r1 = Math.max(rg.a.r, rg.b.r), c0 = Math.min(rg.a.c, rg.b.c), c1 = Math.max(rg.a.c, rg.b.c), out = [];
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 400000) throw new Unsupported('큰범위');
    for (var r = r0; r <= r1; r++) { var row = []; for (var c = c0; c <= c1; c++) row.push(m.cell(rg.sheet, r, c) === undefined ? null : this.cellValue(rg.sheet, r, c)); out.push(row); }
    return out;
  };
  function flat(mx) { var o = []; mx.forEach(function (r) { r.forEach(function (v) { o.push(v); }); }); return o; }
  function sameShape(a, b) { return a.length === b.length && a[0].length === b[0].length; }
  // 배열 계산(SUMPRODUCT 용): 칸 범위끼리의 사칙·비교를 칸마다
  Engine.prototype.evArr = function (n, sheet) {
    var self = this;
    function bc(a, b, f) {
      var A = Array.isArray(a), B = Array.isArray(b);
      if (!A && !B) return f(a, b);
      var R = A ? a.length : b.length, C = A ? a[0].length : b[0].length;
      if (A && B && (a.length !== b.length || a[0].length !== b[0].length)) throw new Unsupported('모양');
      var out = []; for (var i = 0; i < R; i++) { var row = []; for (var j = 0; j < C; j++) row.push(f(A ? a[i][j] : a, B ? b[i][j] : b)); out.push(row); }
      return out;
    }
    if (n.t === 'bin' || n.t === 'neg') {
      if (n.t === 'neg') return bc(this.evArr(n.x, sheet), 0, function (x) { var q = toNum(x); return isErr(q) ? q : -q; });
      var l = this.evArr(n.l, sheet), r = this.evArr(n.r, sheet), o = n.o;
      return bc(l, r, function (a, b) {
        if (isErr(a)) return a; if (isErr(b)) return b;
        if (o === '&') return toStr(a) + toStr(b);
        if (/^(=|<>|<|>|<=|>=)$/.test(o)) { var c = cmpVals(a, b); return o === '=' ? c === 0 : o === '<>' ? c !== 0 : o === '<' ? c < 0 : o === '>' ? c > 0 : o === '<=' ? c <= 0 : c >= 0; }
        a = toNum(a); b = toNum(b); if (isErr(a)) return a; if (isErr(b)) return b;
        if (o === '+') return a + b; if (o === '-') return a - b; if (o === '*') return a * b;
        if (o === '/') return b === 0 ? new ErrV('#DIV/0!') : a / b;
        if (o === '^') { var p = Math.pow(a, b); return isFinite(p) ? p : new ErrV('#NUM!'); }
        throw new Unsupported('연산');
      });
    }
    if (n.t === 'ref' || n.t === 'name') { var v = this.ev(n, sheet); if (v && v.range) return this.matrix(v.range); return v; }
    if (n.t === 'pct') return bc(this.evArr(n.x, sheet), 0, function (x) { var q = toNum(x); return isErr(q) ? q : q / 100; });
    return this.ev(n, sheet);
  };

  // ---- 날짜 ----
  var EPOCH = Date.UTC(1899, 11, 30);
  function serialToYmd(n) { if (!(n >= 61)) throw new Unsupported('날짜범위'); var d = new Date(EPOCH + Math.floor(n) * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function ymdToSerial(y, m, d) { var t = Date.UTC(2000, 0, 1); var dt = new Date(t); dt.setUTCFullYear(y, m - 1, d); var n = Math.round((dt.getTime() - EPOCH) / 86400000); if (!(n >= 61)) throw new Unsupported('날짜범위'); return n; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // ---- TEXT(값, 모양) ----
  function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function textFmt(v, f) {
    if (/^general$/i.test(f)) return fmtNum(v);
    var toks = [], i, ch, dateish = false;
    for (i = 0; i < f.length; i++) {
      ch = f.charAt(i);
      if (ch === '"') { var j = f.indexOf('"', i + 1); if (j < 0) throw new Unsupported('모양'); toks.push({ k: 'lit', v: f.slice(i + 1, j) }); i = j; }
      else if (ch === '\\') { if (i + 1 >= f.length) throw new Unsupported('모양'); toks.push({ k: 'lit', v: f.charAt(++i) }); }
      else if (/[\[\];_*@?]/.test(ch)) throw new Unsupported('모양');
      else if (/[yYmMdDhHsS]/.test(ch)) { var k2 = i; while (k2 + 1 < f.length && f.charAt(k2 + 1).toLowerCase() === ch.toLowerCase()) k2++; toks.push({ k: 'd', v: ch.toLowerCase(), n: k2 - i + 1 }); i = k2; dateish = true; }
      else if (/[0#,.%]/.test(ch)) toks.push({ k: 'n', v: ch });
      else if (/[eE]/.test(ch) || /[aApP]/.test(ch) && /^(AM\/PM|A\/P)/i.test(f.slice(i))) throw new Unsupported('모양');
      else toks.push({ k: 'lit', v: ch });
    }
    if (dateish) {
      toks.forEach(function (t) { if (t.k === 'n') { if (t.v === '.' || t.v === ',') { t.k = 'lit'; } else throw new Unsupported('모양'); } });
      if (!(v >= 61)) throw new Unsupported('날짜범위');
      var ymd = serialToYmd(v), fr = v - Math.floor(v), secs = Math.round(fr * 86400), hh = Math.floor(secs / 3600) % 24, mi = Math.floor(secs / 60) % 60, ss = secs % 60, out = '';
      var nonLit = toks.filter(function (t) { return t.k === 'd'; });
      toks.forEach(function (t, idx) {
        if (t.k === 'lit') { out += t.v; return; }
        if (t.k === 'n') { out += t.v; return; }
        if (t.v === 'y') { if (t.n === 4) out += String(ymd.y); else if (t.n === 2) out += String(ymd.y % 100).padStart(2, '0'); else throw new Unsupported('모양'); }
        else if (t.v === 'm') {
          var pi = idx - 1; while (pi >= 0 && toks[pi].k !== 'd') pi--; var ni = idx + 1; while (ni < toks.length && toks[ni].k !== 'd') ni++;
          var minute = (pi >= 0 && toks[pi].v === 'h') || (ni < toks.length && toks[ni].v === 's');
          var val = minute ? mi : ymd.m; if (t.n === 1) out += String(val); else if (t.n === 2) out += String(val).padStart(2, '0'); else throw new Unsupported('모양');
        }
        else if (t.v === 'd') { if (t.n === 1) out += String(ymd.d); else if (t.n === 2) out += String(ymd.d).padStart(2, '0'); else throw new Unsupported('모양'); }
        else if (t.v === 'h') { if (t.n === 1) out += String(hh); else if (t.n === 2) out += String(hh).padStart(2, '0'); else throw new Unsupported('모양'); }
        else if (t.v === 's') { if (t.n === 1) out += String(ss); else if (t.n === 2) out += String(ss).padStart(2, '0'); else throw new Unsupported('모양'); }
      });
      return out;
    }
    // 숫자 모양
    var first = -1, last = -1;
    toks.forEach(function (t, idx) { if (t.k === 'n') { if (first < 0) first = idx; last = idx; } });
    if (first < 0) return toks.map(function (t) { return t.v; }).join('');
    for (i = first; i <= last; i++) if (toks[i].k !== 'n') throw new Unsupported('모양');
    var block = toks.slice(first, last + 1).map(function (t) { return t.v; }).join(''), pct = (block.match(/%/g) || []).length;
    if (/%/.test(block) && !/%$/.test(block)) throw new Unsupported('모양');
    var core = block.replace(/%/g, '');
    if (/,$/.test(core) || /,\./.test(core) || /^,/.test(core)) throw new Unsupported('모양');
    var dot = core.indexOf('.'), ip = dot < 0 ? core : core.slice(0, dot), dp = dot < 0 ? '' : core.slice(dot + 1);
    if (dp.indexOf(',') >= 0 || dp.indexOf('.') >= 0 || /\./.test(ip)) throw new Unsupported('모양');
    if (/#0|0#/.test(dp) && /#0/.test(dp)) throw new Unsupported('모양');
    var thousands = ip.indexOf(',') >= 0, ipd = ip.replace(/,/g, ''), minInt = (ipd.match(/0/g) || []).length;
    if (/0.*#|#.*0/.test(ipd) && !/^#*0*$/.test(ipd)) throw new Unsupported('모양');
    var dec = dp.length, reqDec = (dp.match(/0/g) || []).length;
    var x = v; for (i = 0; i < pct; i++) x = x * 100;
    var neg = x < 0 || (x === 0 && 1 / x < 0), ax = Math.abs(x), r = xround(ax, dec, 0), s = r.toFixed(dec);
    var sp = s.split('.'), ints = sp[0], decs = sp[1] || '';
    if (decs.length > reqDec) { decs = decs.replace(/0+$/, ''); if (decs.length < reqDec) decs = (decs + '0'.repeat(reqDec)).slice(0, reqDec); }
    if (ints === '0' && minInt === 0) ints = '';
    if (ints.length < minInt) ints = '0'.repeat(minInt - ints.length) + ints;
    if (thousands) ints = groupDigits(ints);
    var body = ints; if (dot >= 0) body += '.' + decs;
    var pre = toks.slice(0, first).map(function (t) { return t.v; }).join(''), suf = toks.slice(last + 1).map(function (t) { return t.v; }).join('') + '%'.repeat(pct);
    return (neg && r !== 0 ? '-' : '') + pre + body + suf;
  }

  function sampleVar(a, pop) { var n = a.length; if (pop ? n < 1 : n < 2) return new ErrV('#DIV/0!'); var m = a.reduce(function (p, q) { return p + q; }, 0) / n; var ss = a.reduce(function (p, q) { return p + (q - m) * (q - m); }, 0); return ss / (pop ? n : n - 1); }
  function kth(sorted, k, big) { var i = big ? sorted.length - k : k - 1; return sorted[i]; }

  Engine.prototype.fn2 = function (n, sheet) {
    var self = this, name = n.name, A = n.args;
    function ev(i) { return self.ev(A[i], sheet); }
    function need(lo, hi) { if (A.length < lo || A.length > (hi == null ? lo : hi)) throw new Unsupported('인수'); }
    function numArg(i) { var v = ev(i); if (v && v.range) throw new Unsupported('인수'); return toNum(v); }
    function strArg(i) { var v = ev(i); if (v && v.range) throw new Unsupported('인수'); return toStr(v); }
    function sc(i) { var v = ev(i); if (v && v.range) throw new Unsupported('인수'); return v; }
    function numsOf(skip) {
      var out = [], err = null;
      A.forEach(function (x, ix) { if (err || (skip && skip.indexOf(ix) >= 0)) return; var v = self.ev(x, sheet); if (v && v.range) self.rangeCells(v.range, function (cv) { if (err) return; if (isErr(cv)) { err = cv; return; } if (typeof cv === 'number') out.push(cv); }); else { if (isErr(v)) { err = v; return; } var nv = toNum(v); if (isErr(nv)) { err = nv; return; } out.push(nv); } });
      return err ? err : out;
    }
    function condParts(startAt, withSum) {    // (합칠 범위?), 조건 범위·조건 쌍들
      var pairs = [], i0 = startAt;
      if ((A.length - i0) % 2 !== 0 || A.length - i0 < 2) throw new Unsupported('인수');
      for (var i = i0; i < A.length; i += 2) { var rg = self.rangeOf(A[i], sheet), cv = sc(i + 1); if (isErr(cv)) throw new Unsupported('조건오류'); if (cv == null) throw new Unsupported('빈조건'); pairs.push({ mx: self.matrix(rg), f: critOf(cv) }); }
      for (var k = 1; k < pairs.length; k++) if (!sameShape(pairs[0].mx, pairs[k].mx)) return new ErrV('#VALUE!');
      return pairs;
    }
    function matchIdx(pairs, i, j) { for (var k = 0; k < pairs.length; k++) { var v = pairs[k].mx[i][j]; if (isErr(v) || !pairs[k].f(v)) return false; } return true; }
    var i, j;
    switch (name) {
      case 'COUNTIF': case 'COUNTIFS': {
        if (name === 'COUNTIF') need(2); var pr = condParts(0); if (isErr(pr)) return pr; var cnt = 0;
        for (i = 0; i < pr[0].mx.length; i++) for (j = 0; j < pr[0].mx[0].length; j++) if (matchIdx(pr, i, j)) cnt++;
        return cnt;
      }
      case 'SUMIF': case 'AVERAGEIF': case 'SUMIFS': case 'AVERAGEIFS': case 'MAXIFS': case 'MINIFS': {
        var multi = /S$/.test(name) || name === 'MAXIFS' || name === 'MINIFS', sumMx, pr2, cr, sr;
        if (!multi) {
          need(2, 3); cr = this.rangeOf(A[0], sheet); sr = A.length === 3 ? this.rangeOf(A[2], sheet) : cr;
          var cv0 = sc(1); if (isErr(cv0) || cv0 == null) throw new Unsupported('조건');
          var cmx = this.matrix(cr); pr2 = [{ mx: cmx, f: critOf(cv0) }];
          // 합칠 범위는 조건 범위의 왼쪽 위 칸에서 같은 크기로(엑셀 규칙)
          var rr = { sheet: sr.sheet, a: { r: Math.min(sr.a.r, sr.b.r), c: Math.min(sr.a.c, sr.b.c) } }; rr.b = { r: rr.a.r + cmx.length - 1, c: rr.a.c + cmx[0].length - 1 }; sumMx = this.matrix(rr);
        } else { if (A.length < 3) throw new Unsupported('인수'); sr = this.rangeOf(A[0], sheet); sumMx = this.matrix(sr); pr2 = condParts(1); if (isErr(pr2)) return pr2; if (!sameShape(pr2[0].mx, sumMx)) return new ErrV('#VALUE!'); }
        var tot = 0, c2 = 0, mx2 = null, mn2 = null, er = null;
        for (i = 0; i < sumMx.length; i++) for (j = 0; j < sumMx[0].length; j++) {
          if (!matchIdx(pr2, i, j)) continue; var sv = sumMx[i][j];
          if (isErr(sv)) { er = er || sv; continue; }
          if (typeof sv !== 'number') continue; tot += sv; c2++; mx2 = mx2 == null ? sv : Math.max(mx2, sv); mn2 = mn2 == null ? sv : Math.min(mn2, sv);
        }
        if (er) return er;
        if (name === 'SUMIF' || name === 'SUMIFS') return tot;
        if (name === 'MAXIFS') return mx2 == null ? 0 : mx2; if (name === 'MINIFS') return mn2 == null ? 0 : mn2;
        return c2 ? tot / c2 : new ErrV('#DIV/0!');
      }
      case 'SUMPRODUCT': {
        if (!A.length) throw new Unsupported('인수'); var arrs = A.map(function (x) { var v = self.evArr(x, sheet); return Array.isArray(v) ? v : [[v]]; });
        for (i = 1; i < arrs.length; i++) if (!sameShape(arrs[0], arrs[i])) return new ErrV('#VALUE!');
        var sp2 = 0;
        for (i = 0; i < arrs[0].length; i++) for (j = 0; j < arrs[0][0].length; j++) { var pr3 = 1, bad = null; arrs.forEach(function (a) { var q = a[i][j]; if (isErr(q)) { bad = bad || q; return; } pr3 *= typeof q === 'number' ? q : 0; }); if (bad) return bad; sp2 += pr3; }
        return sp2;
      }
      case 'RANK': case 'RANK.EQ': {
        need(2, 3); var nv = numArg(0); if (isErr(nv)) return nv; var rg3 = this.rangeOf(A[1], sheet), ord = A.length === 3 ? numArg(2) : 0; if (isErr(ord)) return ord;
        var list = flat(this.matrix(rg3)).filter(function (q) { return typeof q === 'number'; }); if (list.indexOf(nv) < 0) return new ErrV('#N/A');
        var rk = 1; list.forEach(function (q) { if (ord ? q < nv : q > nv) rk++; }); return rk;
      }
      case 'LARGE': case 'SMALL': {
        need(2); var rgL = this.rangeOf(A[0], sheet), kk = numArg(1); if (isErr(kk)) return kk; var lst = flat(this.matrix(rgL)).filter(function (q) { return typeof q === 'number'; }).sort(function (a, b) { return a - b; });
        kk = Math.ceil(kk); if (!(kk >= 1 && kk <= lst.length)) return new ErrV('#NUM!'); return kth(lst, kk, name === 'LARGE');
      }
      case 'MEDIAN': { var md = numsOf(); if (isErr(md)) return md; if (!md.length) return new ErrV('#NUM!'); md.sort(function (a, b) { return a - b; }); var h = md.length >> 1; return md.length % 2 ? md[h] : (md[h - 1] + md[h]) / 2; }
      case 'STDEV': case 'STDEV.S': case 'VAR': case 'VAR.S': case 'STDEVP': case 'STDEV.P': case 'VARP': case 'VAR.P': {
        var vs = numsOf(); if (isErr(vs)) return vs; var pop = /P$/.test(name), vv = sampleVar(vs, pop); if (isErr(vv)) return vv; return /^STDEV/.test(name) ? Math.sqrt(vv) : vv;
      }
      case 'VLOOKUP': case 'HLOOKUP': {
        need(3, 4); var lk = sc(0); if (isErr(lk)) return lk; var tb = this.matrix(this.rangeOf(A[1], sheet)), idx = numArg(2); if (isErr(idx)) return idx; idx = Math.floor(idx);
        var approx = true; if (A.length === 4) { var ap = ev(3); if (ap && ap.range) throw new Unsupported('인수'); var ab = toBool(ap); if (isErr(ab)) return ab; approx = ab; }
        var vert = name === 'VLOOKUP', lim = vert ? tb[0].length : tb.length; if (idx < 1) return new ErrV('#VALUE!');
        var keys = vert ? tb.map(function (r) { return r[0]; }) : tb[0].slice(), pos = lookupPos(keys, lk, approx ? 1 : 0); if (pos < 0) return new ErrV('#N/A'); if (idx > lim) return new ErrV('#REF!');
        var cell = vert ? tb[pos][idx - 1] : tb[idx - 1][pos]; return cell == null ? 0 : cell;
      }
      case 'MATCH': {
        need(2, 3); var lk2 = sc(0); if (isErr(lk2)) return lk2; var mxm = this.matrix(this.rangeOf(A[1], sheet)); if (mxm.length > 1 && mxm[0].length > 1) return new ErrV('#N/A');
        var mt = A.length === 3 ? numArg(2) : 1; if (isErr(mt)) return mt; var p2 = lookupPos(flat(mxm), lk2, mt > 0 ? 1 : mt < 0 ? -1 : 0); return p2 < 0 ? new ErrV('#N/A') : p2 + 1;
      }
      case 'INDEX': {
        need(2, 3); var mxi = this.matrix(this.rangeOf(A[0], sheet)), ri = numArg(1), ci = A.length === 3 ? numArg(2) : null; if (isErr(ri)) return ri; if (ci != null && isErr(ci)) return ci;
        ri = Math.trunc(ri); if (ci != null) ci = Math.trunc(ci);
        if (ci == null) { if (mxi.length === 1) { ci = ri; ri = 1; } else if (mxi[0].length === 1) ci = 1; else throw new Unsupported('인수'); }
        if (ri === 0 || ci === 0) throw new Unsupported('배열'); if (ri < 0 || ci < 0 || ri > mxi.length || ci > mxi[0].length) return new ErrV('#REF!');
        var iv = mxi[ri - 1][ci - 1]; return iv == null ? 0 : iv;
      }
      case 'CHOOSE': { if (A.length < 2) throw new Unsupported('인수'); var ix = numArg(0); if (isErr(ix)) return ix; ix = Math.trunc(ix); if (ix < 1 || ix >= A.length) return new ErrV('#VALUE!'); var cv2 = this.ev(A[ix], sheet); if (cv2 && cv2.range) throw new Unsupported('범위'); return A[ix].t === 'empty' ? 0 : cv2; }
      case 'IFS': {
        if (A.length < 2 || A.length % 2) throw new Unsupported('인수');
        for (i = 0; i < A.length; i += 2) { var cd = toBool(ev(i)); if (isErr(cd)) return cd; if (cd) { var rv = this.ev(A[i + 1], sheet); if (rv && rv.range) throw new Unsupported('범위'); return rv; } }
        return new ErrV('#N/A');
      }
      case 'SWITCH': {
        if (A.length < 3) throw new Unsupported('인수'); var sv0 = sc(0); if (isErr(sv0)) return sv0; var rest = A.length - 1, hasDef = rest % 2 === 1;
        for (i = 1; i + 1 < A.length; i += 2) { var cv3 = sc(i); if (isErr(cv3)) continue; if (cmpVals(sv0, cv3) === 0) { var r2 = this.ev(A[i + 1], sheet); if (r2 && r2.range) throw new Unsupported('범위'); return r2; } }
        if (hasDef) return sc(A.length - 1); return new ErrV('#N/A');
      }
      case 'IFNA': { need(2); var nv1 = this.ev(A[0], sheet); if (nv1 && nv1.range) throw new Unsupported('범위'); return isErr(nv1) && nv1.e === '#N/A' ? this.ev(A[1], sheet) : nv1; }
      case 'NA': { need(0); return new ErrV('#N/A'); }
      case 'ISNUMBER': { need(1); var q1 = sc(0); return typeof q1 === 'number'; }
      case 'ISTEXT': { need(1); var q2 = sc(0); return typeof q2 === 'string'; }
      case 'ISBLANK': { need(1); if (A[0].t !== 'ref') throw new Unsupported('인수'); var q3 = sc(0); return q3 === null; }
      case 'ISERROR': { need(1); return isErr(sc(0)); }
      case 'ISNA': { need(1); var q4 = sc(0); return isErr(q4) && q4.e === '#N/A'; }
      case 'ROW': case 'COLUMN': { need(1); if (A[0].t !== 'ref') throw new Unsupported('인수'); return name === 'ROW' ? Math.min(A[0].a.r, (A[0].b || A[0].a).r) : Math.min(A[0].a.c, (A[0].b || A[0].a).c); }
      case 'SQRT': { need(1); var s1 = numArg(0); if (isErr(s1)) return s1; return s1 < 0 ? new ErrV('#NUM!') : Math.sqrt(s1); }
      case 'POWER': { need(2); var p0 = numArg(0), p1 = numArg(1); if (isErr(p0)) return p0; if (isErr(p1)) return p1; var pw = Math.pow(p0, p1); return isFinite(pw) ? pw : new ErrV('#NUM!'); }
      case 'SIGN': { need(1); var g1 = numArg(0); return isErr(g1) ? g1 : (g1 > 0 ? 1 : g1 < 0 ? -1 : 0); }
      case 'TRUNC': { need(1, 2); var t1 = numArg(0), d1 = A.length === 2 ? numArg(1) : 0; if (isErr(t1)) return t1; if (isErr(d1)) return d1; return xround(t1, Math.trunc(d1), -1); }
      case 'CEILING': case 'FLOOR': {
        need(2); var c1 = numArg(0), sg = numArg(1); if (isErr(c1)) return c1; if (isErr(sg)) return sg; if (sg === 0) return 0; if (c1 < 0 || sg < 0) throw new Unsupported('부호');
        var q = Number((c1 / sg).toPrecision(15)); return (name === 'CEILING' ? Math.ceil(q) : Math.floor(q)) * sg;
      }
      case 'LEN': { need(1); var l1 = sc(0); return isErr(l1) ? l1 : toStr(l1).length; }
      case 'LEFT': case 'RIGHT': {
        need(1, 2); var t2 = sc(0); if (isErr(t2)) return t2; var k2 = A.length === 2 ? numArg(1) : 1; if (isErr(k2)) return k2; if (k2 < 0) return new ErrV('#VALUE!'); k2 = Math.floor(k2); var s2 = toStr(t2);
        return name === 'LEFT' ? s2.slice(0, k2) : (k2 === 0 ? '' : s2.slice(-k2));
      }
      case 'MID': { need(3); var t3 = sc(0); if (isErr(t3)) return t3; var st = numArg(1), ln = numArg(2); if (isErr(st)) return st; if (isErr(ln)) return ln; if (st < 1 || ln < 0) return new ErrV('#VALUE!'); return toStr(t3).substr(Math.floor(st) - 1, Math.floor(ln)); }
      case 'UPPER': case 'LOWER': { need(1); var t4 = sc(0); if (isErr(t4)) return t4; return name === 'UPPER' ? toStr(t4).toUpperCase() : toStr(t4).toLowerCase(); }
      case 'TRIM': { need(1); var t5 = sc(0); if (isErr(t5)) return t5; return toStr(t5).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '); }
      case 'CONCAT': case 'CONCATENATE': {
        var o = ''; var er3 = null;
        A.forEach(function (x) { if (er3) return; var v = self.ev(x, sheet); if (v && v.range) { if (name === 'CONCATENATE') throw new Unsupported('범위'); self.rangeCells(v.range, function (cv) { if (isErr(cv)) { er3 = er3 || cv; return; } o += toStr(cv); }); } else { if (isErr(v)) { er3 = v; return; } o += toStr(v); } });
        return er3 || o;
      }
      case 'TEXTJOIN': {
        if (A.length < 3) throw new Unsupported('인수'); var dl = sc(0), ig = toBool(sc(1)); if (isErr(dl)) return dl; if (isErr(ig)) return ig; var parts = [], er4 = null;
        for (i = 2; i < A.length; i++) { var v2 = this.ev(A[i], sheet); var push = function (cv) { if (isErr(cv)) { er4 = er4 || cv; return; } var s = toStr(cv); if (ig && s === '') return; parts.push(s); }; if (v2 && v2.range) this.rangeCells(v2.range, function (cv) { push(cv); }); else push(v2); }
        return er4 || parts.join(toStr(dl));
      }
      case 'FIND': case 'SEARCH': {
        need(2, 3); var fnd = sc(0), tx = sc(1); if (isErr(fnd)) return fnd; if (isErr(tx)) return tx; var st2 = A.length === 3 ? numArg(2) : 1; if (isErr(st2)) return st2; var a1 = toStr(fnd), b1 = toStr(tx);
        if (st2 < 1 || st2 > b1.length + 1) return new ErrV('#VALUE!'); var pos2;
        if (name === 'SEARCH') { if (WILD.test(a1)) throw new Unsupported('와일드카드'); pos2 = b1.toLowerCase().indexOf(a1.toLowerCase(), st2 - 1); } else pos2 = b1.indexOf(a1, st2 - 1);
        return pos2 < 0 ? new ErrV('#VALUE!') : pos2 + 1;
      }
      case 'SUBSTITUTE': {
        need(3, 4); var tx2 = sc(0), o1 = sc(1), n1 = sc(2); if (isErr(tx2)) return tx2; if (isErr(o1)) return o1; if (isErr(n1)) return n1; var s5 = toStr(tx2), os = toStr(o1), ns = toStr(n1);
        if (os === '') return s5; if (A.length === 3) return s5.split(os).join(ns);
        var inst = numArg(3); if (isErr(inst)) return inst; if (inst < 1) return new ErrV('#VALUE!'); inst = Math.floor(inst); var p3 = -1, cnt3 = 0, from = 0;
        while ((p3 = s5.indexOf(os, from)) >= 0) { cnt3++; if (cnt3 === inst) return s5.slice(0, p3) + ns + s5.slice(p3 + os.length); from = p3 + os.length; }
        return s5;
      }
      case 'REPT': { need(2); var t6 = sc(0), k6 = numArg(1); if (isErr(t6)) return t6; if (isErr(k6)) return k6; if (k6 < 0) return new ErrV('#VALUE!'); var rs = toStr(t6).repeat(Math.floor(k6)); if (rs.length > 32767) return new ErrV('#VALUE!'); return rs; }
      case 'EXACT': { need(2); var e1 = sc(0), e2 = sc(1); if (isErr(e1)) return e1; if (isErr(e2)) return e2; return toStr(e1) === toStr(e2); }
      case 'VALUE': { need(1); var v7 = sc(0); if (isErr(v7)) return v7; if (typeof v7 === 'number') return v7; var s7 = toStr(v7).trim(); if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s7)) return parseFloat(s7); throw new Unsupported('값변환'); }
      case 'TEXT': {
        need(2); var tv = sc(0), tf = sc(1); if (isErr(tv)) return tv; if (isErr(tf)) return tf; if (typeof tv === 'string') { var nvx = toNum(tv); if (isErr(nvx)) return toStr(tv); tv = nvx; } else if (typeof tv === 'boolean') return toStr(tv); else if (tv == null) tv = 0;
        return textFmt(tv, toStr(tf));
      }
      case 'TODAY': { need(0); if (typeof this.m.today !== 'number') throw new Unsupported('오늘'); return this.m.today; }
      case 'DATE': {
        need(3); var y = numArg(0), mo = numArg(1), dd = numArg(2); if (isErr(y)) return y; if (isErr(mo)) return mo; if (isErr(dd)) return dd; y = Math.trunc(y); mo = Math.trunc(mo); dd = Math.trunc(dd);
        if (y < 0 || y > 9999) return new ErrV('#NUM!'); if (y < 1900) y += 1900; return ymdToSerial(y, mo, dd);
      }
      case 'YEAR': case 'MONTH': case 'DAY': { need(1); var d0 = numArg(0); if (isErr(d0)) return d0; if (d0 < 0) return new ErrV('#NUM!'); var ymd = serialToYmd(d0); return name === 'YEAR' ? ymd.y : name === 'MONTH' ? ymd.m : ymd.d; }
      case 'WEEKDAY': { need(1, 2); var d2 = numArg(0), ty = A.length === 2 ? numArg(1) : 1; if (isErr(d2)) return d2; if (isErr(ty)) return ty; if (d2 < 61) throw new Unsupported('날짜범위'); var w0 = ((Math.floor(d2) - 61 + 4) % 7 + 7) % 7;   /* 1900-03-01 = 목요일 → 일=0 */ if (ty === 1) return w0 + 1; if (ty === 2) return ((w0 + 6) % 7) + 1; if (ty === 3) return (w0 + 6) % 7; throw new Unsupported('유형'); }
      case 'EDATE': case 'EOMONTH': {
        need(2); var d3 = numArg(0), mm = numArg(1); if (isErr(d3)) return d3; if (isErr(mm)) return mm; var y3 = serialToYmd(d3), tm = y3.m - 1 + Math.trunc(mm), ty3 = y3.y + Math.floor(tm / 12), tmo = ((tm % 12) + 12) % 12 + 1;
        if (name === 'EOMONTH') return ymdToSerial(ty3, tmo, daysInMonth(ty3, tmo)); return ymdToSerial(ty3, tmo, Math.min(y3.d, daysInMonth(ty3, tmo)));
      }
      case 'DAYS': { need(2); var e3 = numArg(0), s3 = numArg(1); if (isErr(e3)) return e3; if (isErr(s3)) return s3; return Math.floor(e3) - Math.floor(s3); }
      case 'DATEDIF': {
        need(3); var s4 = numArg(0), e4 = numArg(1), un = strArg(2); if (isErr(s4)) return s4; if (isErr(e4)) return e4; if (isErr(un)) return un; if (s4 > e4) return new ErrV('#NUM!');
        var a2 = serialToYmd(s4), b2 = serialToYmd(e4), u = un.toUpperCase(), months = (b2.y - a2.y) * 12 + (b2.m - a2.m) - (b2.d < a2.d ? 1 : 0);
        if (u === 'Y') return Math.floor(months / 12); if (u === 'M') return months; if (u === 'D') return Math.floor(e4) - Math.floor(s4); if (u === 'YM') return ((months % 12) + 12) % 12; throw new Unsupported('단위');
      }
    }
    throw new Unsupported('함수 ' + name);
  };
  function lookupPos(keys, lk, mode) {          // mode 0 정확히, 1 이하 중 가장 큰(오름차순 표), -1 이상 중 가장 작은(내림차순 표). 못 찾으면 -1
    var i;
    function eq(a, b) { if (typeof a === 'number' && typeof b === 'number') return a === b; if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase(); if (typeof a === 'boolean' && typeof b === 'boolean') return a === b; return false; }
    if (mode === 0) {
      if (typeof lk === 'string' && WILD.test(lk)) { var f = critOf(lk); for (i = 0; i < keys.length; i++) if (typeof keys[i] === 'string' && f(keys[i])) return i; return -1; }
      for (i = 0; i < keys.length; i++) if (eq(keys[i], lk)) return i; return -1;
    }
    var prev = null, best = -1;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i]; if (k == null || isErr(k)) throw new Unsupported('빈키');
      if (prev != null) { var cc = cmpVals(prev, k); if (mode === 1 ? cc > 0 : cc < 0) throw new Unsupported('정렬안됨'); }
      prev = k;
      if (typeof k !== typeof lk) continue;
      var c = cmpVals(k, lk);
      if (mode === 1 ? c <= 0 : c >= 0) best = i;
    }
    return best;
  }

  // 수식 하나를 계산해 { t, v } 로: t = 'n'|'s'|'b'|'e'  (못 하면 null)
  function run(model, sheet, r, c) {
    var eng = model._eng || (model._eng = new Engine(model));
    try {
      var cl = model.cell(sheet, r, c), v = eng.formulaValue(sheet, r, c, cl);
      if (isErr(v)) return { t: 'e', v: v.e };
      if (typeof v === 'number') return isFinite(v) ? { t: 'n', v: v } : { t: 'e', v: '#NUM!' };
      if (typeof v === 'boolean') return { t: 'b', v: v };
      return { t: 's', v: v == null ? '' : String(v) };
    } catch (e) { if (e instanceof Unsupported) return null; throw e; }
  }
  function same(calc, cl) {
    if (!calc) return false;
    if (calc.t === 'e') return cl.t === 'e' && String(cl.w) === calc.v;
    if (calc.t === 'n') { if (cl.t !== 'n' || typeof cl.v !== 'number') return false; return Math.abs(calc.v - cl.v) <= 1e-9 * Math.max(1, Math.abs(calc.v), Math.abs(cl.v)); }
    if (calc.t === 'b') return cl.t === 'b' && !!cl.v === calc.v;
    return (cl.t === 's' || cl.t === 'z' || cl.t == null) && String(cl.v == null ? '' : cl.v) === calc.v;
  }
  // 파일을 열 때의 대조: 수식 칸 전부를 계산해 저장돼 있던 값과 비교한다. 돌려주는 값: { ok, why, n, at }
  function check(model, list) {          // list = [{ sheet, r, c }] 수식 칸 목록
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i], cl = model.cell(f.sheet, f.r, f.c);
      if (cl.v === undefined) return { ok: false, why: 'nocache', at: f };                // 저장된 값이 없다 → 대조할 근거가 없다
      var calc = run(model, f.sheet, f.r, f.c);
      if (!calc) return { ok: false, why: 'unsupported', at: f };
      if (!same(calc, cl)) return { ok: false, why: 'mismatch', at: f };
      n++;
    }
    return { ok: true, n: n };
  }
  function supported(formula) { try { parse(formula); return true; } catch (e) { return !(e instanceof Unsupported); } }

  var api = { create: function (model) { return model; }, run: run, check: check, supported: supported, parse: parse, same: same };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);

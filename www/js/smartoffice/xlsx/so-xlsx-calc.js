/* so-xlsx-calc.js — S-Office 엑셀 「합계 바로 보이기」 자체 계산기(O-0861, v10.4)
 * ----------------------------------------------------------------------------
 * 외부 계산 부품 없이, 허용한 수식만 폰에서 계산해 칸의 저장된 값(<v>)과 화면에 보여 준다.
 *   허용: 사칙(+ − × ÷ ^)·%·글자 잇기(&)·비교·괄호·칸/범위(다른 시트 포함) 와
 *         SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK PRODUCT IF IFERROR AND OR NOT ROUND ROUNDUP ROUNDDOWN INT ABS MOD
 *   날짜·시간·지역 함수와 허용 목록에 없는 함수는 계산하지 않는다.
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
    throw new Unsupported('함수 ' + name);
  };

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

/* ============================================================================
 * calc-engine.js — 스마트비서 「계산기」 계산 엔진 (O-0178)
 * ----------------------------------------------------------------------------
 * eval / Function 을 쓰지 않는다. 글자를 토큰으로 자르고(tokenize), 내려가며 읽는 파서(recursive descent)로 바로 계산한다.
 *
 * 문법(위가 약하게, 아래가 강하게 묶임)
 *   식     := 항 ( ('+'|'−') 항 )*          ※ 「a + b%」「a − b%」 는 a 의 b 퍼센트만큼 더하고 뺀다(100+10% = 110)
 *   항     := 부호 ( ('×'|'÷') 부호 | 부호없는값 )*   ※ 2π · 2(3+4) · (1+2)(3+4) · 2sin(30) 처럼 붙여 쓰면 곱하기
 *   부호   := ('−'|'+') 부호 | 거듭제곱        ※ −2^2 = −4
 *   거듭제곱 := 뒤붙임 ( ('^'|'ˣ√') 부호 )?     ※ 2^3^2 = 2^(3^2), 2^−3 가능, 3ˣ√8 = 8 의 세제곱근
 *   뒤붙임 := 값 ( '!' | '%' )*
 *   값     := 수 | π | e | Ans | 함수( 식 ) | √ 값 | ( 식 )
 * 수: 123 · 1.5 · .5 · 1.5E3 · 2E−4 (대문자 E = ×10 의 거듭제곱. 소문자 e 는 자연상수)
 * 함수: sin cos tan asin acos atan(각도 DEG/RAD) · log(상용) ln · sqrt(√) · abs
 * 닫는 괄호가 모자라면 끝에서 자동으로 닫는다. 오류는 쉬운 우리말(CalcError.message).
 *
 * 표시: 유효숫자 12자리로 반올림해 부동소수 찌꺼기를 없앤다(0.1+0.2 = 0.3). 아주 크거나(≥1e15) 작은(<1e-6) 수는 「1.2345E20」.
 * 브라우저: window.CalcEngine / 노드(시험): module.exports
 * ==========================================================================*/
(function (root) {
  'use strict';

  function CalcError(msg, code) { this.message = msg; this.code = code || 'error'; }
  CalcError.prototype = Object.create(Error.prototype);

  var FUNCS = { sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1, log: 1, ln: 1, sqrt: 1, abs: 1 };
  // 화면 글자 → 엔진 글자(화면에는 sin⁻¹, √, − 등 보기 좋은 글자를 쓴다)
  var ALIASES = [['sin⁻¹', 'asin'], ['cos⁻¹', 'acos'], ['tan⁻¹', 'atan'], ['−', '-'], ['–', '-'], ['×', '*'], ['·', '*'], ['÷', '/'], ['ˣ√', 'R'], ['√', 'Q'], ['²', '^2'], ['³', '^3'], ['pi', 'π']];

  function normalize(src) {
    var s = String(src == null ? '' : src);
    for (var i = 0; i < ALIASES.length; i++) s = s.split(ALIASES[i][0]).join(ALIASES[i][1]);
    return s.replace(/[\s,]/g, '');
  }

  function tokenize(src) {
    var s = normalize(src), out = [], i = 0, m;
    var numRe = /^(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?/;
    while (i < s.length) {
      var rest = s.slice(i), c = s[i];
      if ((m = numRe.exec(rest))) {
        if (s[i + m[0].length] === 'E') throw new CalcError('EXP 뒤에 지수(숫자)를 넣어 주세요.', 'incomplete');   // 「2E」「2E−」
        out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (c === '.') throw new CalcError('소수점 앞뒤에 숫자를 넣어 주세요.', 'syntax');
      if (rest.slice(0, 3) === 'Ans') { out.push({ t: 'ans' }); i += 3; continue; }
      if ((m = /^[a-z]+/.exec(rest))) {
        var name = m[0], hit = null;
        // 가장 긴 함수 이름부터(asin 이 a+sin 으로 잘리지 않게)
        ['asin', 'acos', 'atan', 'sqrt', 'sin', 'cos', 'tan', 'log', 'abs', 'ln'].some(function (f) { if (name.indexOf(f) === 0) { hit = f; return true; } return false; });
        if (hit) { out.push({ t: 'fn', v: hit }); i += hit.length; continue; }
        if (c === 'e') { out.push({ t: 'const', v: Math.E }); i += 1; continue; }
        throw new CalcError('알 수 없는 글자가 있어요: ' + name, 'syntax');
      }
      if (c === 'π') { out.push({ t: 'const', v: Math.PI }); i += 1; continue; }
      if (c === 'E') throw new CalcError('EXP 앞에 숫자를 넣어 주세요.', 'syntax');
      if ('+-*/^()!%RQ'.indexOf(c) !== -1) { out.push({ t: c }); i += 1; continue; }
      throw new CalcError('알 수 없는 글자가 있어요: ' + c, 'syntax');
    }
    return out;
  }

  function fin(x) {
    if (typeof x !== 'number' || isNaN(x)) throw new CalcError('계산할 수 없는 값이에요.', 'domain');
    if (!isFinite(x)) throw new CalcError('수가 너무 커요.', 'overflow');
    return x;
  }
  function tidy(x) { return Math.abs(x) < 1e-15 ? 0 : x; }          // sin(π) 같은 찌꺼기
  function addClean(a, b) {                                          // 0.1+0.2−0.3 → 0
    var r = a + b, mag = Math.max(Math.abs(a), Math.abs(b));
    return (mag && Math.abs(r) < mag * 1e-13) ? 0 : r;
  }
  function factorial(n) {
    if (n < 0 || Math.round(n) !== n) throw new CalcError('팩토리얼(!)은 0 이상의 정수만 계산할 수 있어요.', 'domain');
    if (n > 170) throw new CalcError('수가 너무 커요(170! 까지 계산할 수 있어요).', 'overflow');
    var r = 1; for (var k = 2; k <= n; k++) r *= k; return r;
  }
  function power(a, b) {
    if (a === 0 && b < 0) throw new CalcError('0은 음수 제곱을 할 수 없어요(0으로 나누기).', 'divzero');
    if (a < 0 && Math.round(b) !== b) {
      // 음수의 홀수 제곱근(예: (−8)^(1/3))은 실수 답이 있다
      var inv = 1 / b;
      if (Math.abs(inv - Math.round(inv)) < 1e-12 && Math.abs(Math.round(inv)) % 2 === 1) return -Math.pow(-a, b);
      throw new CalcError('음수는 정수가 아닌 제곱을 할 수 없어요.', 'domain');
    }
    return fin(Math.pow(a, b));
  }
  function nthRoot(n, x) {
    if (n === 0) throw new CalcError('0제곱근은 없어요.', 'domain');
    if (x < 0) {
      if (Math.round(n) === n && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n);
      throw new CalcError('음수의 짝수 제곱근은 계산할 수 없어요.', 'domain');
    }
    return fin(Math.pow(x, 1 / n));
  }
  function callFn(name, x, deg) {
    var k = deg ? Math.PI / 180 : 1;
    if (deg && (name === 'sin' || name === 'cos' || name === 'tan')) x = x % 360;   // 3600° 같은 큰 각도도 찌꺼기 없이
    switch (name) {
      case 'sin': return tidy(Math.sin(x * k));
      case 'cos': return tidy(Math.cos(x * k));
      case 'tan':
        if (Math.abs(Math.cos(x * k)) < 1e-15) throw new CalcError('tan 값이 정의되지 않는 각도예요(90° 등).', 'domain');
        return tidy(Math.tan(x * k));
      case 'asin': case 'acos':
        if (x < -1 || x > 1) throw new CalcError((name === 'asin' ? 'sin⁻¹' : 'cos⁻¹') + ' 은 −1부터 1 사이 값만 넣을 수 있어요.', 'domain');
        return tidy((name === 'asin' ? Math.asin(x) : Math.acos(x)) / k);
      case 'atan': return tidy(Math.atan(x) / k);
      case 'log':
        if (x <= 0) throw new CalcError('log 는 0보다 큰 수만 넣을 수 있어요.', 'domain');
        return tidy(Math.log(x) / Math.LN10);
      case 'ln':
        if (x <= 0) throw new CalcError('ln 은 0보다 큰 수만 넣을 수 있어요.', 'domain');
        return tidy(Math.log(x));
      case 'sqrt':
        if (x < 0) throw new CalcError('음수의 제곱근(√)은 계산할 수 없어요.', 'domain');
        return Math.sqrt(x);
      case 'abs': return Math.abs(x);
    }
    throw new CalcError('알 수 없는 함수예요: ' + name, 'syntax');
  }

  /* opts: { deg: true(기본)|false, ans: 직전 결과(없으면 0) } → 숫자. 실패하면 CalcError 를 던진다. */
  function evaluate(src, opts) {
    opts = opts || {};
    var deg = opts.deg !== false, ans = (typeof opts.ans === 'number' && isFinite(opts.ans)) ? opts.ans : 0;
    var tk = tokenize(src), p = 0;
    if (!tk.length) throw new CalcError('식을 입력해 주세요.', 'empty');
    function peek() { return tk[p]; }
    function is(t) { return tk[p] && tk[p].t === t; }
    function startsValue() { var x = tk[p]; return !!x && (x.t === 'num' || x.t === 'const' || x.t === 'ans' || x.t === 'fn' || x.t === '(' || x.t === 'Q'); }
    function endErr() { return new CalcError('식이 아직 끝나지 않았어요.', 'incomplete'); }

    function primary() {
      var x = tk[p];
      if (!x) throw endErr();
      if (x.t === 'num' || x.t === 'const') { p++; return x.v; }
      if (x.t === 'ans') { p++; return ans; }
      if (x.t === 'fn') {
        p++;
        if (!is('(')) throw new CalcError(x.v + ' 뒤에 괄호 ( 를 넣어 주세요.', 'syntax');
        p++;
        var a = expr();
        if (is(')')) p++; else if (p < tk.length) throw new CalcError('괄호가 맞지 않아요.', 'syntax');
        return fin(callFn(x.v, a, deg));
      }
      if (x.t === 'Q') {                                             // √9 · √(1+3) · 2√9(=2×3) · √−4(→ 음수 안내)
        p++;
        var neg = false;
        while (is('-') || is('+')) { if (tk[p].t === '-') neg = !neg; p++; }
        var q = postfix();
        return fin(callFn('sqrt', neg ? -q : q, deg));
      }
      if (x.t === '(') {
        p++;
        if (is(')')) throw new CalcError('괄호 안이 비어 있어요.', 'syntax');
        var v = expr();
        if (is(')')) p++; else if (p < tk.length) throw new CalcError('괄호가 맞지 않아요.', 'syntax');
        return v;
      }
      if (x.t === ')') throw new CalcError('여는 괄호 ( 가 없어요.', 'syntax');
      throw new CalcError('연산자 자리가 맞지 않아요.', 'syntax');
    }
    function postfix() {
      var v = primary(), pct = false;
      while (is('!') || is('%')) {
        if (tk[p].t === '!') { v = factorial(v); pct = false; } else { v = v / 100; pct = true; }
        p++;
      }
      postfix.pct = pct;                                           // 바로 앞 값이 「b%」 꼴이었는지(더하기·빼기에서 씀)
      return v;
    }
    function pow() {
      var base = postfix(), pct = postfix.pct;
      if (is('^')) { p++; var ex = unary(); postfix.pct = false; return power(base, ex); }
      if (is('R')) { p++; var rad = unary(); postfix.pct = false; return nthRoot(base, rad); }
      postfix.pct = pct;
      return base;
    }
    function unary() {
      if (is('-')) { p++; var v = unary(); return -v; }              // −2^2 = −(2^2)
      if (is('+')) { p++; return unary(); }
      return pow();
    }
    function term() {
      var v = unary(), only = true;
      for (;;) {
        if (is('*')) { p++; v = fin(v * unary()); only = false; }
        else if (is('/')) {
          p++; var d = unary();
          if (d === 0) throw new CalcError('0으로 나눌 수 없어요.', 'divzero');
          v = fin(v / d); only = false;
        }
        else if (startsValue()) { v = fin(v * pow()); only = false; }   // 붙여 쓴 곱하기
        else break;
      }
      term.pct = only && postfix.pct;                              // 「b%」 하나만으로 된 항인가
      return v;
    }
    function expr() {
      var v = term();
      while (is('+') || is('-')) {
        var op = tk[p].t; p++;
        if (!tk[p]) throw endErr();
        var r = term();
        if (term.pct) r = v * r;                                     // a ± b%  →  a ± a×b/100
        v = fin(op === '+' ? addClean(v, r) : addClean(v, -r));
      }
      term.pct = false; postfix.pct = false;
      return v;
    }

    var out = expr();
    if (p < tk.length) {
      if (tk[p].t === ')') throw new CalcError('여는 괄호 ( 가 없어요.', 'syntax');
      throw new CalcError('연산자 자리가 맞지 않아요.', 'syntax');
    }
    return roundSig(fin(out));
  }

  function roundSig(x) {                                             // 유효숫자 12자리(부동소수 찌꺼기 제거)
    if (x === 0) return 0;
    if (Math.round(x) === x && Math.abs(x) <= 9007199254740991) return x;   // 정수는 그대로(큰 정수 계산이 깎이지 않게)
    return parseFloat(x.toPrecision(12));
  }

  /* 숫자 → 화면 글자. group=true 면 정수부에 세 자리 쉼표. */
  function format(x, group) {
    if (typeof x !== 'number' || !isFinite(x)) return '';
    x = roundSig(x);
    if (x === 0) return '0';
    var a = Math.abs(x), s;
    if (a >= 1e15 || a < 1e-6) {
      var e = x.toExponential(11).split('e');
      var mant = e[0].replace(/\.?0+$/, ''), ex = parseInt(e[1], 10);
      return mant.replace('-', '−') + 'E' + (ex < 0 ? '−' + (-ex) : ex);
    }
    s = x.toPrecision(12);
    if (s.indexOf('e') !== -1) s = x.toFixed(12);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (group) { var q = s.split('.'); q[0] = q[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = q.join('.'); }
    return s.replace('-', '−');
  }

  /* 미리보기용: 오류를 던지지 않고 { ok, value, text, error, code } */
  function tryEval(src, opts) {
    try { var v = evaluate(src, opts); return { ok: true, value: v, text: format(v, true) }; }
    catch (e) { return { ok: false, error: (e && e.message) || '계산할 수 없어요.', code: (e && e.code) || 'error' }; }
  }

  var api = { evaluate: evaluate, tryEval: tryEval, format: format, tokenize: tokenize, CalcError: CalcError };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcEngine = api;
})(typeof window !== 'undefined' ? window : this);

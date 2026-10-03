/* 계산기 엔진 단위 시험 (O-0178) — 실행: node tests/calc_engine_test.js
 * 앱에는 실리지 않는다(www 밖). 실패가 하나라도 있으면 종료 코드 1. */
var E = require('../www/js/calc-engine.js');
var pass = 0, fail = 0, fails = [];

function eq(src, want, opts, note) {
  var r = E.tryEval(src, opts);
  var ok = r.ok && (Math.abs(r.value - want) <= Math.abs(want) * 1e-11 + 1e-14);
  if (ok) pass++; else { fail++; fails.push('값  ' + src + (opts && opts.deg === false ? ' [RAD]' : '') + ' → ' + (r.ok ? r.value : '오류: ' + r.error) + '  (기대 ' + want + ')' + (note ? '  // ' + note : '')); }
}
function txt(src, want, opts) {
  var r = E.tryEval(src, opts);
  if (r.ok && r.text === want) pass++; else { fail++; fails.push('표시 ' + src + ' → ' + (r.ok ? r.text : '오류: ' + r.error) + '  (기대 ' + want + ')'); }
}
function err(src, code, opts) {
  var r = E.tryEval(src, opts);
  if (!r.ok && r.code === code) pass++; else { fail++; fails.push('오류 ' + src + ' → ' + (r.ok ? '값 ' + r.value : r.code + ': ' + r.error) + '  (기대 오류 ' + code + ')'); }
}
function fmt(x, want, group) {
  var s = E.format(x, group);
  if (s === want) pass++; else { fail++; fails.push('format(' + x + ') → ' + s + '  (기대 ' + want + ')'); }
}
var RAD = { deg: false };

// ── 사칙·우선순위 ──
eq('1+2', 3); eq('7−10', -3); eq('6×7', 42); eq('8÷2', 4); eq('2+3×4', 14); eq('(2+3)×4', 20);
eq('10−4−3', 3); eq('100÷10÷2', 5); eq('2×3+4×5', 26); eq('−5+2', -3); eq('−(2+3)', -5); eq('−−2', 2);
eq('1.5+2.25', 3.75); eq('.5+.5', 1); eq('3.', 3); eq('1,000+1', 1001); eq(' 2 + 2 ', 4);
// ── 부동소수 다듬기 ──
txt('0.1+0.2', '0.3'); txt('0.3−0.1', '0.2'); txt('0.1×3', '0.3'); txt('1÷3', '0.333333333333'); txt('2÷3', '0.666666666667');
txt('0.1+0.2−0.3', '0'); txt('1.1×1.1', '1.21'); txt('4.35×100', '435'); txt('1−0.9', '0.1'); txt('9.95+0.05', '10');
// ── 거듭제곱·루트 ──
eq('2^10', 1024); eq('2^3^2', 512, null, '오른쪽부터'); eq('−2^2', -4); eq('(−2)^2', 4); eq('2^−3', 0.125); eq('2^0.5', Math.SQRT2);
eq('3²', 9); eq('2³', 8); eq('5^2+1', 26); eq('√9', 3); eq('√(16+9)', 5); eq('2√9', 6, null, '붙여 쓴 곱하기'); eq('√2×√2', 2);
eq('3ˣ√8', 2); eq('2ˣ√81', 9); eq('3ˣ√−27', -3); eq('4ˣ√16', 2); eq('(−8)^(1÷3)', -2); eq('9^(1÷2)', 3); eq('0^0', 1);
eq('4^(−1)', 0.25); eq('10^3', 1000); eq('e^1', Math.E); eq('e^(2)', Math.E * Math.E);
// ── 괄호 ──
eq('((2+3)×(4−1))^2', 225); eq('(((((7)))))', 7); eq('2×(3+(4×(5−(6÷2))))', 22); eq('(1+2)(3+4)', 21, null, '붙여 쓴 곱하기');
eq('2(3+4)', 14); eq('(2+3)4', 20); eq('(2+3', 5, null, '닫는 괄호 자동'); eq('2×(3+(4', 14); eq('sin(30', 0.5);
// ── 삼각 DEG ──
eq('sin(30)', 0.5); eq('cos(60)', 0.5); eq('tan(45)', 1); eq('sin(90)', 1); eq('cos(90)', 0); eq('sin(180)', 0); eq('cos(180)', -1);
eq('sin(0)', 0); eq('cos(0)', 1); eq('sin(270)', -1); eq('sin(360)', 0); eq('sin(3600)', 0); eq('cos(720)', 1); eq('tan(135)', -1);
eq('sin(−30)', -0.5); eq('sin(45)^2+cos(45)^2', 1); eq('2sin(30)', 1); eq('sin(30)cos(60)', 0.25); eq('tan(60)', Math.sqrt(3));
txt('sin(30)', '0.5'); txt('cos(60)', '0.5'); txt('tan(45)', '1'); txt('sin(180)', '0'); txt('cos(90)', '0');
// ── 역삼각 DEG ──
eq('sin⁻¹(0.5)', 30); eq('cos⁻¹(0.5)', 60); eq('tan⁻¹(1)', 45); eq('sin⁻¹(1)', 90); eq('cos⁻¹(−1)', 180); eq('asin(0)', 0); eq('atan(0)', 0);
txt('sin⁻¹(0.5)', '30'); txt('cos⁻¹(0.5)', '60');
// ── 삼각 RAD ──
eq('sin(π÷2)', 1, RAD); eq('cos(π)', -1, RAD); eq('sin(π)', 0, RAD); eq('tan(π÷4)', 1, RAD); eq('sin(π÷6)', 0.5, RAD); eq('cos(0)', 1, RAD);
eq('sin⁻¹(1)', Math.PI / 2, RAD); eq('tan⁻¹(1)', Math.PI / 4, RAD); eq('cos⁻¹(0)', Math.PI / 2, RAD); eq('sin(1)', Math.sin(1), RAD);
txt('sin(π)', '0', RAD); txt('cos(π÷2)', '0', RAD);
// ── 로그·지수 ──
eq('log(100)', 2); eq('log(1000)', 3); eq('log(1)', 0); eq('log(0.01)', -2); eq('ln(e)', 1); eq('ln(1)', 0); eq('ln(e^3)', 3);
eq('10^log(5)', 5); eq('e^ln(7)', 7); eq('log(2)+log(5)', 1); eq('2log(100)', 4); txt('log(1000)', '3'); txt('ln(e^2)', '2');
// ── 팩토리얼 ──
eq('0!', 1); eq('1!', 1); eq('5!', 120); eq('10!', 3628800); eq('3!!', 720); eq('5!÷3!', 20); eq('(2+3)!', 120); eq('2^3!', 64);
eq('170!', 7.257415615307994e306); txt('20!', '2.43290200818E18');
// ── 상수·Ans·암시적 곱 ──
eq('π', Math.PI); eq('2π', 2 * Math.PI); eq('πe', Math.PI * Math.E); eq('2πe', 2 * Math.PI * Math.E); eq('e', Math.E); eq('pi', Math.PI);
eq('Ans+1', 6, { ans: 5 }); eq('2Ans', 10, { ans: 5 }); eq('Ans^2', 25, { ans: 5 }); eq('Ans', 0); eq('√Ans', 3, { ans: 9 });
eq('3π÷π', 3); eq('2e^0', 2);
// ── 지수 표기(EXP) ──
eq('1.5E3', 1500); eq('2E−3', 0.002); eq('6.02E23×2', 1.204e24); eq('1E3+1', 1001); eq('5E0', 5); eq('1.2E+2', 120); eq('3E2^2', 90000);
// ── 퍼센트 ──
eq('50%', 0.5); eq('200×10%', 20); eq('100+10%', 110); eq('100−10%', 90); eq('50%×200', 100); eq('100+(10%)', 100.1); eq('20%+30%', 0.26, null, '0.2 + 0.2의 30%');
// ── 절댓값·1/x ──
eq('abs(−5)', 5); eq('abs(3−10)', 7); eq('2^(−1)', 0.5); eq('8^(−1)', 0.125); eq('abs(−2)^3', 8);
// ── 표시(쉼표·지수) ──
txt('1000×1000', '1,000,000'); txt('1234567.5+0', '1,234,567.5'); txt('−1500×2', '−3,000'); txt('2^53', '9.00719925474E15'); txt('2^49', '562,949,953,421,312');
txt('999999999999999+0', '999,999,999,999,999'); txt('123456789×987654321', '1.21932631113E17');
fmt(1e15, '1E15'); fmt(1.5e20, '1.5E20'); fmt(-2.5e-10, '−2.5E−10'); fmt(1e-7, '1E−7'); fmt(0.000001, '0.000001'); fmt(0, '0');
fmt(1234.5, '1,234.5', true); fmt(1234.5, '1234.5', false); fmt(-0.5, '−0.5'); fmt(6.02e23, '6.02E23'); fmt(0.1 + 0.2, '0.3');
txt('10^20', '1E20'); txt('1÷10^8', '1E−8'); txt('2^100', '1.26765060023E30');
// ── 오류 ──
err('1÷0', 'divzero'); err('5÷(2−2)', 'divzero'); err('0^−1', 'divzero'); err('√−4', 'domain'); err('√(−4)', 'domain');
err('log(0)', 'domain'); err('log(−1)', 'domain'); err('ln(0)', 'domain'); err('sin⁻¹(2)', 'domain'); err('cos⁻¹(−1.5)', 'domain');
err('tan(90)', 'domain'); err('tan(270)', 'domain'); err('tan(π÷2)', 'domain', RAD); err('(−1)!', 'domain'); err('2.5!', 'domain');
err('171!', 'overflow'); err('10^400', 'overflow'); err('9E307×10', 'overflow'); err('(−4)^0.5', 'domain'); err('2ˣ√−4', 'domain'); err('0ˣ√5', 'domain');
err('', 'empty'); err('2+', 'incomplete'); err('2×', 'incomplete'); err('(', 'incomplete'); err('sin(', 'incomplete'); err('2E', 'incomplete'); err('2E−', 'incomplete');
err('2+×3', 'syntax'); err('()', 'syntax'); err('2)', 'syntax'); err('×2', 'syntax'); err('2..3+', 'incomplete'); err('abc', 'syntax'); err('sin30', 'syntax'); err('E5', 'syntax');
err('5+%', 'syntax'); err('.', 'syntax'); err('2 $ 3', 'syntax');
// ── eval 을 쓰지 않는지(코드처럼 보이는 입력은 전부 오류) ──
err('alert(1)', 'syntax'); err('1;2', 'syntax'); err('window', 'syntax'); err('[1]', 'syntax'); err('"a"', 'syntax');

console.log('계산 엔진 시험: 통과 ' + pass + ' / 실패 ' + fail + ' (전체 ' + (pass + fail) + ')');
if (fail) { fails.forEach(function (f) { console.log('  ✗ ' + f); }); process.exit(1); }

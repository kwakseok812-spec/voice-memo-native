/* so-xlsx-ui.js — S-Office 엑셀 편집 도구줄·시트(O-0861, v10.4)
 * 고치기를 켰을 때 아래에 나오는 도구줄(서식·줄·칸·범위·채우기·합계·시트 + 더보기)과 그 시트들. 실제 문서 고치기는 so-xlsx-struct.js, 화면 갈아 끼우기는 so-xlsx.js(pkgRun).
 * 한 줄 단추 수: 접은 폰 6 + 더보기 · 펼친 화면 10 + 더보기 · DeX 12(더보기 없음). 가로 밀기는 쓰지 않는다.
 */
(function (global) {
  'use strict';
  function J(w, j) { return global.SOffice && global.SOffice.josa ? global.SOffice.josa(w, j) : w + j; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var TXT = [['검정', '#000000'], ['빨강', '#E02020'], ['파랑', '#1C5FD6'], ['초록', '#1B8A3A'], ['주황', '#EE7A00'], ['보라', '#7A3FC4'], ['회색', '#777777'], ['기본', null]];
  var BG = [['없음', null], ['노랑', '#FFF2A8'], ['연두', '#D8F0C0'], ['하늘', '#CFE5FF'], ['분홍', '#FFD6E0'], ['살구', '#FFDDB0'], ['회색', '#E5E7EB'], ['남색', '#BBD4F5']];
  var NF = [['일반', 'General'], ['1,234', '#,##0'], ['소수 2자리', '#,##0.00'], ['퍼센트', '0%'], ['원', '#,##0"원"'], ['날짜', 'yyyy-mm-dd']];
  var FONTS = ['맑은 고딕', '바탕', '돋움', '굴림', 'Arial', 'Times New Roman'];
  var SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28];
  var ALIGN = [['왼쪽', 'left'], ['가운데', 'center'], ['오른쪽', 'right'], ['기본', '']];

  function create(env) {
    var U = { host: null, lab: null, row: null, bucket: 0 };
    var ST = global.SOXlsxStruct;
    function S() { return env.S(); }
    function toast(m, ms) { env.toast(m, ms || 2800); }
    function perRow() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }
    function rg0() { return env.selRange(); }                                   // 0부터
    function rg1() { var r = rg0(); return { r0: r.r0 + 1, c0: r.c0 + 1, r1: r.r1 + 1, c1: r.c1 + 1 }; }   // 1부터(꾸러미 편집용)
    function nameNow() { return S().sh.name; }
    function rangeText() { var r = rg0(); return r.r0 === r.r1 && r.c0 === r.c1 ? env.addr(r.r0, r.c0) : env.addr(r.r0, r.c0) + ':' + env.addr(r.r1, r.c1); }
    function fail(label) {                   // 폰에서 못 하는 고침: 이유를 쉬운 말로 + 「수정 요청」
      return function (r) {
        var msg = (r && r.err) || '할 수 없습니다.';
        if (S().ctx.fixAvail && S().ctx.fixAvail()) S().ctx.confirm('폰에서는 하기 어렵습니다', msg + '\n\n엑셀로 고쳐야 하는 일이면 「수정 요청」으로 맡길 수 있습니다.', '수정 요청', function () { S().ctx.requestFix(); }, { cancelLabel: '닫기' });
        else toast(msg, 5200);
      };
    }
    var curSheet = null;
    function refillSheet() {                  // 열어 둔 채 쓰는 시트(서식): 적용한 뒤·고른 칸이 바뀐 뒤 안의 안내를 다시 그린다
      if (!curSheet) return;
      var b = curSheet.body; if (!b.isConnected) { curSheet = null; return; }
      var sc = [], p = b.parentElement; while (p && p !== document.body) { if (p.scrollTop) sc.push([p, p.scrollTop]); p = p.parentElement; }
      b.innerHTML = ''; try { curSheet.build(b); } catch (e) {}
      sc.forEach(function (q) { q[0].scrollTop = q[1]; });
    }
    function run(label, mut, okMsg, after) { return env.pkgRun(label, mut, function (r) { if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 2800); if (after) after(r); setTimeout(refillSheet, 30); }, fail(label)); }

    // ---------------- 서식 ----------------
    function applyFmt(ch, msg) { run('서식', function (pkg) { return ST.applyStyle(pkg, nameNow(), rg1(), ch); }, msg || '서식을 바꿨습니다'); }
    function isBold() { var s = S(), sh = s.sh, st = null; try { var r = rg0(); st = envStyleAt(sh, r.r0, r.c0); } catch (e) {} return !!(st && st.b); }
    function envStyleAt(sh, r, c) { return env.styleAt ? env.styleAt(sh, r, c) : null; }
    function isFlag(k) { try { var r = rg0(), st = envStyleAt(S().sh, r.r0, r.c0); return !!(st && st[k]); } catch (e) { return false; } }
    function curSize() { try { var r = rg0(), st = envStyleAt(S().sh, r.r0, r.c0); return (st && st.fs) || 11; } catch (e) { return 11; } }
    function stepSize(d) { applyFmt({ fontSize: Math.max(6, Math.min(72, curSize() + d)) }, '글자 크기를 바꿨습니다'); }
    function fmtSheet() {
      var body = el('div', 'sxu'); fmtBuild(body); curSheet = { body: body, build: fmtBuild };
      S().ctx.sheet({ title: '서식', body: body, buttons: [{ label: '닫기' }], wide: true, keep: true });
    }
    function fmtBuild(body) {
      function group(label) { body.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r'); body.appendChild(row); return row; }
      function opt(row, text, fn, cls, color) {
        var b = el('button', 'sxu-b' + (cls ? ' ' + cls : ''), color === undefined ? text : ''); b.type = 'button'; if (color !== undefined) { b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); }
        b.onclick = function () { fn(); }; row.appendChild(b); return b;
      }
      var g1 = group('글자');
      opt(g1, '굵게', function () { applyFmt({ bold: !isBold() }); }, 'bold'); opt(g1, '기울임', function () { applyFmt({ italic: true }); }, 'it'); opt(g1, '굵기·기울임 없음', function () { applyFmt({ bold: false, italic: false }); });
      opt(g1, '밑줄', function () { applyFmt({ underline: !isFlag('u') }, '밑줄을 바꿨습니다'); }, isFlag('u') ? 'on' : ''); opt(g1, '취소선', function () { applyFmt({ strike: !isFlag('st') }, '취소선을 바꿨습니다'); }, isFlag('st') ? 'on' : '');
      var g2 = group('글자 색'); TXT.forEach(function (c) { opt(g2, c[0], function () { applyFmt({ color: c[1] }); }, 'sw', c[1] || ''); });
      var g3 = group('칸 배경색'); BG.forEach(function (c) { opt(g3, c[0], function () { applyFmt({ bg: c[1] }); }, 'sw', c[1] || ''); });
      var g4 = group('정렬'); ALIGN.forEach(function (a) { opt(g4, a[0], function () { applyFmt({ align: a[1] }); }); });
      var g4b = group('줄 바꿈 · 세로 맞춤'); opt(g4b, '칸 안에서 줄 바꿈', function () { applyFmt({ wrap: !isFlag('wrap') }, '줄 바꿈을 바꿨습니다(줄 높이는 「크기」에서 맞춥니다)'); }, isFlag('wrap') ? 'on' : ''); [['위', 'top'], ['가운데', 'center'], ['아래', 'bottom']].forEach(function (a) { opt(g4b, a[0], function () { applyFmt({ valign: a[1] }, '세로 맞춤을 바꿨습니다'); }); });
      var g5 = group('숫자 모양'); NF.forEach(function (n) { opt(g5, n[0], function () { applyFmt({ nf: n[1] }); }); });
      var g6 = group('테두리'); opt(g6, '모두', function () { applyFmt({ borderMode: 'all' }, '테두리를 넣었습니다'); }); opt(g6, '바깥쪽', function () { applyFmt({ borderMode: 'outer' }, '바깥 테두리를 넣었습니다'); }); opt(g6, '없음', function () { applyFmt({ borderMode: 'none' }, '테두리를 없앴습니다'); });
      var g8 = group('글꼴'); FONTS.forEach(function (f) { opt(g8, f, function () { applyFmt({ fontName: f }, '글꼴을 바꿨습니다'); }); });
      var g9 = group('글자 크기'); opt(g9, '작게 −', function () { stepSize(-1); }); opt(g9, '크게 ＋', function () { stepSize(1); }); SIZES.forEach(function (z) { opt(g9, String(z), function () { applyFmt({ fontSize: z }, '글자 크기를 ' + J(String(z), '으로') + ' 바꿨습니다'); }); });
      body.appendChild(el('div', 'so-sheet-note', '칸 합치기는 도구줄의 「칸 합치기」(또는 더보기)에서 합니다.'));
      body.appendChild(el('div', 'so-sheet-note', '고른 곳(' + rangeText() + ')에 적용됩니다. 칸 하나만 골랐으면 그 칸에만, 줄 번호·열 글자나 「범위」로 고르면 그 범위 전체에 적용됩니다.'));
    }
    function mergeCells() {
      var r = rg0(); if (r.r0 === r.r1 && r.c0 === r.c1) { toast('합칠 칸을 먼저 「범위」로 두 칸 이상 골라 주십시오.', 3200); return; }
      run('칸 합치기', function (pkg) { return ST.mergeCellsOp(pkg, nameNow(), rg1(), false); }, function (x) { return x.lost ? '칸을 합쳤습니다(왼쪽 위 칸의 내용만 남기고 ' + x.lost + '칸의 내용은 지웠습니다)' : '칸을 합쳤습니다'; });
    }
    function unmerge() { run('합치기 풀기', function (pkg) { return ST.mergeCellsOp(pkg, nameNow(), rg1(), true); }, '합친 칸을 풀었습니다'); }
    function mergeBtn() { var r = rg0(), sh = S().sh, inM = false; (sh.merges || []).forEach(function (m) { if (!(m.e.r < r.r0 || m.s.r > r.r1 || m.e.c < r.c0 || m.s.c > r.c1)) inM = true; }); if (inM && r.r0 === r.r1 && r.c0 === r.c1) unmerge(); else mergeCells(); }

    // ---------------- 줄·칸 ----------------
    function lineOp(axis, mode, where) {
      var r = rg1(), n = axis === 'row' ? r.r1 - r.r0 + 1 : r.c1 - r.c0 + 1, lo = axis === 'row' ? r.r0 : r.c0, hi = axis === 'row' ? r.r1 : r.c1, at = mode === 'del' ? lo : (where === 'after' ? hi + 1 : lo);
      var unit = axis === 'row' ? '줄' : '칸', label = mode === 'ins' ? unit + ' 넣기' : unit + ' 지우기';
      var go = function () {
        run(label, function (pkg) { return ST.lineEdit(pkg, nameNow(), axis, at, n, mode); }, function () { return mode === 'ins' ? n + unit + '을 넣었습니다' : n + unit + '을 지웠습니다(되돌리려면 ↶)'; });
      };
      if (mode === 'del') S().ctx.confirm((axis === 'row' ? '선택한 줄' : '선택한 칸(열)') + ' ' + n + unit + '을 지우시겠습니까?', '지운 직후에는 ↶ 단추로 되돌릴 수 있습니다. 이 줄·칸을 쓰는 수식이 있으면 지울 수 없습니다.', unit + ' 지우기', go, { danger: true });
      else go();
    }
    function appendRow() { run('맨 끝 줄', function (pkg) { return ST.appendRows(pkg, nameNow(), 1); }, '맨 끝에 줄을 붙였습니다(합계 범위는 그대로입니다)', function (x) { if (x && x.firstRow) { env.select(x.firstRow - 1, S().sel.c, true); env.ensureVisible(); env.render(true); } }); }
    function rcSheet() {
      var r = rg0(), nR = r.r1 - r.r0 + 1, nC = r.c1 - r.c0 + 1, body = el('div', 'sxu'), grid = el('div', 'sxu-g');
      function add(text, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { S().ctx.closeSheet(); setTimeout(fn, 60); }; grid.appendChild(b); }
      add('위에 줄 넣기', function () { lineOp('row', 'ins', 'before'); }); add('아래에 줄 넣기', function () { lineOp('row', 'ins', 'after'); });
      add('줄 지우기', function () { lineOp('row', 'del'); }, 'danger'); add('맨 끝에 줄 붙이기', appendRow);
      add('왼쪽에 칸 넣기', function () { lineOp('col', 'ins', 'before'); }); add('오른쪽에 칸 넣기', function () { lineOp('col', 'ins', 'after'); });
      add('칸(열) 지우기', function () { lineOp('col', 'del'); }, 'danger');
      body.appendChild(el('div', 'so-sheet-note', '지금 고른 곳: ' + rangeText() + ' (' + nR + '줄 × ' + nC + '칸) — 고른 만큼 넣고 뺍니다. 줄 번호나 열 글자를 누르면 그 줄·열 전체를 고를 수 있습니다. 중간에 넣고 빼는 일은 수식이 어긋나지 않는 문서에서만 되며, 안 되면 이유를 알려 드립니다. 그림·차트가 든 시트는 넣기만 되고(차트 범위와 그림 자리가 함께 따라갑니다), 지우기는 하지 않습니다.'));
      body.insertBefore(grid, body.firstChild);
      S().ctx.sheet({ title: '줄·칸 넣고 빼기', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

    // ---------------- 숨기기 · 보이기 ----------------
    function hideSheet() {
      var r = rg1(), body = el('div', 'sxu'), g = el('div', 'sxu-g');
      function add(text, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { S().ctx.closeSheet(); setTimeout(fn, 60); }; g.appendChild(b); }
      add('고른 줄 숨기기', function () { run('줄 숨기기', function (pkg) { return ST.setRowsHidden(pkg, nameNow(), r.r0, r.r1, true); }, (r.r1 - r.r0 + 1) + '줄을 숨겼습니다(보이려면 「숨긴 줄·열 보이기」)'); });
      add('고른 열 숨기기', function () { run('열 숨기기', function (pkg) { return ST.setColsHidden(pkg, nameNow(), r.c0, r.c1, true); }, (r.c1 - r.c0 + 1) + '열을 숨겼습니다(보이려면 「숨긴 줄·열 보이기」)'); });
      add('고른 범위의 숨긴 줄·열 보이기', function () { run('보이기', function (pkg) { return ST.setRowsHidden(pkg, nameNow(), Math.max(1, r.r0 - 1), r.r1 + 1, false).then(function () { return ST.setColsHidden(pkg, nameNow(), Math.max(1, r.c0 - 1), r.c1 + 1, false); }); }, '고른 범위 둘레의 숨긴 줄·열을 보이게 했습니다'); });
      add('시트의 숨긴 줄·열 모두 보이기', function () { run('모두 보이기', function (pkg) { return ST.showAllHidden(pkg, nameNow()); }, '숨긴 줄·열을 모두 보이게 했습니다'); });
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '고른 곳(' + rangeText() + ')의 줄·열이 대상입니다. 숨겨도 내용은 지워지지 않고, 수식 계산에도 그대로 쓰입니다. 숨긴 줄·열 옆의 줄·열을 함께 고른 뒤 「고른 범위의 숨긴 줄·열 보이기」를 누르면 그 사이가 보입니다.'));
      S().ctx.sheet({ title: '숨기기·보이기', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    // ---------------- 자동 필터 ----------------
    function sheetXml() { var s = S(), psh = s.an && s.an.sheets && s.an.sheets[s.sh.name]; return psh ? psh.xml : null; }
    function shown(sh, r, c) { var cl = env.cellOf(sh, r, c); return cl ? (cl.w != null ? String(cl.w) : (cl.v == null ? '' : String(cl.v))) : ''; }
    function numOf(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; }
    function condTest(x, v) {
      if (x.op === 'contains') return String(v).toLowerCase().indexOf(String(x.s).toLowerCase()) >= 0;
      var n = numOf(v); if (n == null) return false;
      return x.op === 'ge' ? n >= x.n : x.op === 'le' ? n <= x.n : x.op === 'gt' ? n > x.n : x.op === 'lt' ? n < x.n : n === x.n;
    }
    function critMatch(c, v) {
      if (Array.isArray(c)) return c.indexOf(v) >= 0;
      if (c && c.cond) { var res = c.cond.map(function (x) { return condTest(x, v); }); return c.and === false ? res.some(Boolean) : res.every(Boolean); }
      return true;
    }
    function condText(c) { return c.cond.map(function (x) { return x.op === 'contains' ? '「' + x.s + '」 포함' : x.n + ({ ge: ' 이상', le: ' 이하', gt: ' 초과', lt: ' 미만', eq: '' }[x.op] || ''); }).join(c.and === false ? ' 또는 ' : ' 그리고 '); }
    function filterSheet(preCol) {
      var s = S(), sh = s.sh, xml = sheetXml(), cur = xml ? ST.readFilter(xml) : null, body = el('div', 'sxu');
      if (typeof preCol !== 'number') preCol = null;
      if (xml == null) { toast('이 문서에서는 필터를 쓸 수 없습니다.', 3000); return; }
      function go(label, rng, crit, hid, msg, after) { return run(label, function (pkg) { return ST.setFilter(pkg, nameNow(), rng, crit, hid); }, msg, after); }
      if (!cur) {
        var r = rg0(), reg = (r.r1 > r.r0 || r.c1 > r.c0) ? r : currentRegion(sh, r.r0, r.c0);
        body.appendChild(el('div', 'sxu-l', '자동 필터 범위: ' + env.addr(reg.r0, reg.c0) + ':' + env.addr(reg.r1, reg.c1) + ' (맨 위 줄이 머리글)'));
        var g0 = el('div', 'sxu-g'), b0 = el('button', 'sxu-b big on', '자동 필터 켜기'); b0.type = 'button'; b0.onclick = function () { s.ctx.closeSheet(); setTimeout(function () { go('필터', { r0: reg.r0 + 1, c0: reg.c0 + 1, r1: reg.r1 + 1, c1: reg.c1 + 1 }, {}, [], '자동 필터를 켰습니다 — 머리줄의 ▽를 누르면 그 열을 거릅니다', function () { setTimeout(function () { filterSheet(); }, 200); }); }, 60); }; g0.appendChild(b0); body.appendChild(g0);
        body.appendChild(el('div', 'so-sheet-note', '켜면 맨 윗줄(머리글)에 ▽ 표시가 생기고, 바로 이어서 거를 열을 고르는 화면이 열립니다. 나중에는 머리줄의 ▽를 누르면 그 열이 바로 열립니다. 범위를 먼저 「범위」로 고르면 그 범위로 켭니다. 숨겨진 줄도 합계 수식에는 그대로 들어갑니다(엑셀과 같습니다).'));
        s.ctx.sheet({ title: '자동 필터', body: body, buttons: [{ label: '닫기' }], wide: true }); return;
      }
      var rg = cur.ref, crit = {}; Object.keys(cur.criteria).forEach(function (k) { crit[k] = cur.criteria[k]; });
      var nOn = Object.keys(crit).length;
      if (Object.keys(crit).some(function (k) { return crit[k] == null; })) { body.appendChild(el('div', 'so-sheet-note', '이 필터에는 폰에서 바꿀 수 없는 조건(상위 N개·색 등)이 든 열이 있습니다. 그 열은 끄기만 할 수 있습니다. 바꾸려면 「수정 요청」으로 맡겨 주십시오.')); }
      body.appendChild(el('div', 'sxu-l', '필터 범위 ' + env.addr(rg.r0 - 1, rg.c0 - 1) + ':' + env.addr(rg.r1 - 1, rg.c1 - 1) + ' · ' + (nOn ? '조건이 걸린 열 ' + nOn + '개(▼ 표시) · ' : '') + '거를 열을 고르십시오'));
      var cols = el('div', 'sxu-r'); body.appendChild(cols);
      var area = el('div', 'sxu-fv'); body.appendChild(area);
      function hiddenFor(c2) {
        var hid = []; for (var r = rg.r0 + 1; r <= rg.r1; r++) { var ok = true; Object.keys(c2).forEach(function (k) { if (c2[k] && !critMatch(c2[k], shown(sh, r - 1, rg.c0 - 1 + (+k)))) ok = false; }); if (!ok) hid.push(r); } return hid;
      }
      function pickCol(k) {
        area.innerHTML = ''; var vals = [], seen = {}; for (var r = rg.r0 + 1; r <= rg.r1 && vals.length < 300; r++) { var v = shown(sh, r - 1, rg.c0 - 1 + k); if (!seen[v]) { seen[v] = 1; vals.push(v); } }
        vals.sort(function (a, b) { var na = parseFloat(a), nb = parseFloat(b); return !isNaN(na) && !isNaN(nb) ? na - nb : String(a).localeCompare(String(b), 'ko'); });
        var curv = Array.isArray(crit[k]) ? crit[k] : null, on = {}; vals.forEach(function (v) { on[v] = curv ? curv.indexOf(v) >= 0 : !(crit[k] && crit[k].cond); });
        area.appendChild(el('div', 'sxu-l', env.colName(rg.c0 - 1 + k) + ' 열(' + shown(sh, rg.r0 - 1, rg.c0 - 1 + k) + ')의 값 — 보고 싶은 값만 체크' + (crit[k] && crit[k].cond ? ' · 지금 조건: ' + condText(crit[k]) : '')));
        var list = el('div', 'sxu-r'); area.appendChild(list);
        vals.forEach(function (v) { var b = el('button', 'sxu-b' + (on[v] ? ' on' : ''), v === '' ? '(빈 칸)' : v); b.type = 'button'; b.onclick = function () { on[v] = !on[v]; b.classList.toggle('on', on[v]); }; list.appendChild(b); });
        var g = el('div', 'sxu-g'); area.appendChild(g);
        var ap = el('button', 'sxu-b big on', '이 열 필터 적용'); ap.type = 'button'; ap.onclick = function () {
          var pick = vals.filter(function (v) { return on[v]; }); if (!pick.length) { toast('보일 값을 하나 이상 체크해 주십시오.', 2800); return; }
          var c2 = Object.assign({}, crit); if (pick.length === vals.length) delete c2[k]; else c2[k] = pick;
          s.ctx.closeSheet(); setTimeout(function () { go('필터', rg, c2, hiddenFor(c2), '필터를 적용했습니다(숨겨진 줄은 내용이 그대로 있습니다)'); }, 60);
        };
        var cl = el('button', 'sxu-b big', '이 열 조건 지우기'); cl.type = 'button'; cl.onclick = function () { var c2 = Object.assign({}, crit); delete c2[k]; s.ctx.closeSheet(); setTimeout(function () { go('필터', rg, c2, hiddenFor(c2), '이 열의 조건을 지웠습니다'); }, 60); };
        g.appendChild(ap); g.appendChild(cl);
        // 조건으로 거르기: 숫자 범위(이상·이하) 또는 글자 포함
        area.appendChild(el('div', 'sxu-l', '또는 조건으로 거르기(숫자 범위·글자 포함)'));
        var rr1 = el('div', 'sxu-r'), geIn = el('input', 'sxu-in'), leIn = el('input', 'sxu-in'), ctIn = el('input', 'sxu-in wide');
        geIn.type = leIn.type = 'number'; geIn.inputMode = leIn.inputMode = 'decimal'; ctIn.type = 'text'; geIn.setAttribute('aria-label', '이 값 이상'); leIn.setAttribute('aria-label', '이 값 이하'); ctIn.setAttribute('aria-label', '이 글자를 포함'); ctIn.placeholder = '포함할 글자';
        var cc = crit[k] && crit[k].cond; if (cc) cc.forEach(function (x) { if (x.op === 'ge') geIn.value = x.n; else if (x.op === 'le') leIn.value = x.n; else if (x.op === 'contains') ctIn.value = x.s; });
        rr1.appendChild(el('span', 'sxu-u', '숫자')); rr1.appendChild(geIn); rr1.appendChild(el('span', 'sxu-u', '이상')); rr1.appendChild(leIn); rr1.appendChild(el('span', 'sxu-u', '이하')); area.appendChild(rr1);
        var rr2 = el('div', 'sxu-r'); rr2.appendChild(el('span', 'sxu-u', '글자')); rr2.appendChild(ctIn); area.appendChild(rr2);
        var g3 = el('div', 'sxu-g'), apc = el('button', 'sxu-b big on', '조건 적용'); apc.type = 'button';
        apc.onclick = function () {
          var cond = [], ge = geIn.value === '' ? null : parseFloat(geIn.value), le = leIn.value === '' ? null : parseFloat(leIn.value), tx = ctIn.value.trim();
          if (ge != null && !isNaN(ge)) cond.push({ op: 'ge', n: ge }); if (le != null && !isNaN(le)) cond.push({ op: 'le', n: le });
          if (!cond.length && tx) cond.push({ op: 'contains', s: tx });
          if (!cond.length) { toast('숫자(이상·이하) 또는 포함할 글자를 적어 주십시오.', 3000); return; }
          if (ge != null && le != null && ge > le) { toast('「이상」 값이 「이하」 값보다 큽니다.', 3000); return; }
          if (tx && cond.length && cond[0].op !== 'contains') toast('숫자 조건이 있어 글자 조건은 쓰지 않았습니다(둘 중 하나만 됩니다).', 3000);
          var c2 = Object.assign({}, crit); c2[k] = { cond: cond, and: true };
          s.ctx.closeSheet(); setTimeout(function () { go('필터', rg, c2, hiddenFor(c2), '조건으로 걸렀습니다(' + condText(c2[k]) + ')'); }, 60);
        };
        g3.appendChild(apc); area.appendChild(g3);
      }
      for (var k = 0; k <= rg.c1 - rg.c0 && k < 40; k++) (function (k) { var b = el('button', 'sxu-b' + (preCol === k ? ' on' : ''), (crit[k] !== undefined ? '▼ ' : '') + env.colName(rg.c0 - 1 + k) + ' ' + shown(sh, rg.r0 - 1, rg.c0 - 1 + k)); b.type = 'button'; b.onclick = function () { [].forEach.call(cols.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); pickCol(k); }; cols.appendChild(b); })(k);
      var g2 = el('div', 'sxu-g'), off = el('button', 'sxu-b big danger', '자동 필터 끄기(숨긴 줄 모두 보이기)'); off.type = 'button'; off.onclick = function () { s.ctx.closeSheet(); setTimeout(function () { go('필터', null, {}, [], '자동 필터를 껐습니다'); }, 60); }; g2.appendChild(off); body.appendChild(g2);
      s.ctx.sheet({ title: '자동 필터', body: body, buttons: [{ label: '닫기' }], wide: true });
      if (preCol != null && preCol <= rg.c1 - rg.c0) pickCol(preCol);
    }
    // ---------------- 줄 높이 · 칸 너비 ----------------
    function sizeSheet() {
      var body = el('div', 'sxu'), r1 = rg1();
      function line(label, def, min, max, unit, fn, resetFn) {
        body.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r'), inp = el('input', 'sxu-in'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.min = min; inp.max = max; inp.value = def; inp.setAttribute('aria-label', label);
        var ap = el('button', 'sxu-b', '적용'), rs = el('button', 'sxu-b', '기본값으로');
        ap.type = rs.type = 'button';
        ap.onclick = function () { var v = parseFloat(inp.value); if (!(v >= min && v <= max)) { toast(J(label, '은') + ' ' + min + '~' + max + ' 사이로 적어 주십시오.', 3000); return; } S().ctx.closeSheet(); setTimeout(function () { fn(v); }, 60); };
        rs.onclick = function () { S().ctx.closeSheet(); setTimeout(resetFn, 60); };
        row.appendChild(inp); row.appendChild(el('span', 'sxu-u', unit)); row.appendChild(ap); row.appendChild(rs); body.appendChild(row);
      }
      line('줄 높이', 24, 8, 120, '포인트', function (v) { run('줄 높이', function (pkg) { return ST.setRowHeight(pkg, nameNow(), r1.r0, r1.r1, v); }, '줄 높이를 바꿨습니다'); }, function () { run('줄 높이', function (pkg) { return ST.setRowHeight(pkg, nameNow(), r1.r0, r1.r1, 0); }, '줄 높이를 기본으로 돌렸습니다'); });
      line('칸 너비', 14, 3, 80, '글자 수', function (v) { run('칸 너비', function (pkg) { return ST.setColWidth(pkg, nameNow(), r1.c0, r1.c1, v); }, '칸 너비를 바꿨습니다'); }, function () { run('칸 너비', function (pkg) { return ST.setColWidth(pkg, nameNow(), r1.c0, r1.c1, 0); }, '칸 너비를 기본으로 돌렸습니다'); });
      body.appendChild(el('div', 'so-sheet-note', '고른 곳(' + rangeText() + ')의 줄·열에 적용됩니다. 여러 줄·열을 한꺼번에 바꾸려면 줄 번호·열 글자나 「범위」로 고르십시오.'));
      S().ctx.sheet({ title: '줄 높이·칸 너비', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

    // ---------------- 복사·붙여넣기(칸·범위) ----------------
    var clip = null;
    function copySel(cut) {
      var r = rg1(); clip = { sheet: nameNow(), rng: r, cut: !!cut, at: rangeText() };
      toast((cut ? '오려 두었습니다(' : '복사했습니다(') + rangeText() + ') — 붙일 칸을 누르고 「붙여넣기」', 3400);
    }
    function pasteClip(mode) {
      if (!clip) { toast('먼저 복사할 칸이나 범위를 고르고 「복사」를 누르십시오.', 3200); return; }
      if (clip.sheet !== nameNow()) { toast('다른 시트로는 붙일 수 없습니다(같은 시트 안에서만 됩니다). 복사한 시트로 돌아가 붙여 주십시오.', 4200); return; }
      var d = rg1(), c = clip;
      run('붙여넣기', function (pkg) { return ST.copyRange(pkg, c.sheet, c.rng, d.r0, d.c0, mode, c.cut); }, function (x) { if (c.cut) clip = null; return (mode === 'values' ? '값만 붙였습니다(' : '붙였습니다(') + x.nr + '줄 × ' + x.nc + '칸, ' + env.addr(d.r0 - 1, d.c0 - 1) + ' 부터)'; });
    }
    function copySheet() {
      var body = el('div', 'sxu'), grid = el('div', 'sxu-g');
      function add(text, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { S().ctx.closeSheet(); setTimeout(fn, 60); }; grid.appendChild(b); }
      add('복사', function () { copySel(false); }); add('오려두기', function () { copySel(true); });
      add('붙여넣기(값·수식·서식)', function () { pasteClip('all'); }); add('값만 붙여넣기', function () { pasteClip('values'); });
      body.appendChild(grid);
      body.appendChild(el('div', 'so-sheet-note', '고른 곳: ' + rangeText() + (clip ? ' · 복사해 둔 곳: ' + clip.at + (clip.cut ? '(오려두기)' : '') : ' · 복사해 둔 것이 없습니다') + '. 붙이려면 붙일 칸(왼쪽 위 칸)을 누르고 「붙여넣기」를 누릅니다. 수식은 붙이는 자리에 맞게 상대 참조가 따라 움직입니다(「$」가 붙은 칸은 그대로). 같은 시트 안에서만 되고, 합쳐진 칸이나 배열 수식이 걸리면 안내하고 하지 않습니다. 오려두기는 다른 칸의 수식이 그 칸을 쓰면 하지 않습니다. 키보드(DeX)는 Ctrl+C·X·V 입니다.'));
      S().ctx.sheet({ title: '복사·붙여넣기', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    U.copySel = copySel; U.pasteClip = pasteClip; U.filterCol = function (k) { filterSheet(k); };
    var keyFn = function (e) {
      var s = S(); if (!s) { document.removeEventListener('keydown', keyFn); return; }
      if (!s.editing || !(e.ctrlKey || e.metaKey)) return;
      var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('.so-sheet-back')) return;
      var kk = String(e.key).toLowerCase();
      if (kk === 'c') { e.preventDefault(); copySel(false); } else if (kk === 'x') { e.preventDefault(); copySel(true); } else if (kk === 'v') { e.preventDefault(); pasteClip(e.shiftKey ? 'values' : 'all'); }
    };
    document.addEventListener('keydown', keyFn);
    // ---------------- 시트 ----------------
    function sheetSheet() {
      var s = S(), body = el('div', 'sxu'), inp = el('input', 'sxu-in wide'); inp.type = 'text'; inp.maxLength = 31; inp.placeholder = '시트 이름'; inp.setAttribute('aria-label', '시트 이름'); inp.value = s.sh.name;
      body.appendChild(el('div', 'sxu-l', '시트 이름(바꾸기·새 시트에 씁니다)')); body.appendChild(inp);
      var grid = el('div', 'sxu-g');
      function add(text, fn, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { var nm = inp.value; S().ctx.closeSheet(); setTimeout(function () { fn(nm); }, 60); }; grid.appendChild(b); }
      add('새 시트 추가', function (nm) {
        var base = nm && nm !== s.sh.name ? nm : '시트', k = 1, cand = base; while (s.names.indexOf(cand) >= 0) { k++; cand = base + k; }
        s.keepSheet = cand; run('시트 추가', function (pkg) { return ST.addSheet(pkg, cand); }, '새 시트를 만들었습니다');
      });
      add('이름 바꾸기', function (nm) { var old = s.sh.name; if (!nm || nm === old) { toast('바꿀 이름을 적어 주십시오.', 2400); return; } s.keepSheet = nm; run('시트 이름', function (pkg) { return ST.renameSheet(pkg, old, nm); }, '시트 이름을 바꿨습니다(이 시트를 쓰던 수식도 함께 고쳤습니다)'); });
      add('앞으로', function () { s.keepSheet = s.sh.name; run('시트 순서', function (pkg) { return ST.moveSheet(pkg, s.sh.name, -1); }, '시트를 앞으로 옮겼습니다'); });
      add('뒤로', function () { s.keepSheet = s.sh.name; run('시트 순서', function (pkg) { return ST.moveSheet(pkg, s.sh.name, 1); }, '시트를 뒤로 옮겼습니다'); });
      add('이 시트 지우기', function () {
        var old = s.sh.name;
        S().ctx.confirm('「' + old + '」 시트를 지우시겠습니까?', '시트 안의 모든 내용이 지워집니다. 지운 직후에는 ↶ 단추로 되돌릴 수 있습니다.', '시트 지우기', function () { run('시트 지우기', function (pkg) { return ST.deleteSheet(pkg, old); }, '시트를 지웠습니다(되돌리려면 ↶)'); }, { danger: true });
      }, 'danger');
      body.appendChild(grid);
      S().ctx.sheet({ title: '시트', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

    // ---------------- 채우기 · 합계 · 정렬 ----------------
    function fillDown() {
      var r = rg0(); if (r.r1 <= r.r0) { toast('채울 범위를 「범위」로 먼저 고르십시오(맨 위 칸이 아래로 복사됩니다).', 3600); return; }
      run('채우기', function (pkg) { return ST.fillDown(pkg, nameNow(), rg1()); }, function (x) { return '맨 위 칸을 아래로 채웠습니다(' + x.n + '칸)'; });
    }
    function numAt(sh, r, c) { var cl = env.cellOf(sh, r, c); return !!(cl && cl.t === 'n' && !cl.f); }
    function autoSum() {
      var s = S(), sh = s.sh, r = rg0(), single = r.r0 === r.r1 && r.c0 === r.c1, targets = [], A = env.addr;
      if (single) {
        var k = r.r0 - 1; while (k >= 0 && numAt(sh, k, r.c0)) k--; k++;
        if (k < r.r0) targets.push({ r: r.r0, c: r.c0, f: 'SUM(' + A(k, r.c0) + ':' + A(r.r0 - 1, r.c0) + ')' });
        else { var j = r.c0 - 1; while (j >= 0 && numAt(sh, r.r0, j)) j--; j++; if (j < r.c0) targets.push({ r: r.r0, c: r.c0, f: 'SUM(' + A(r.r0, j) + ':' + A(r.r0, r.c0 - 1) + ')' }); }
      } else if (r.c0 === r.c1) targets.push({ r: r.r1 + 1, c: r.c0, f: 'SUM(' + A(r.r0, r.c0) + ':' + A(r.r1, r.c0) + ')' });
      else if (r.r0 === r.r1) targets.push({ r: r.r0, c: r.c1 + 1, f: 'SUM(' + A(r.r0, r.c0) + ':' + A(r.r0, r.c1) + ')' });
      else for (var c = r.c0; c <= r.c1; c++) targets.push({ r: r.r1 + 1, c: c, f: 'SUM(' + A(r.r0, c) + ':' + A(r.r1, c) + ')' });
      if (!targets.length) { toast('합계를 낼 숫자 칸을 「범위」로 먼저 고르십시오. 숫자 칸 바로 아래(또는 오른쪽) 칸에 합계가 들어갑니다.', 4200); return; }
      if (s.el.inp.value !== s.barOrig && !env.commit(true)) return;
      var n = 0, errs = '';
      targets.forEach(function (t) { var ap = env.applyRes(sh.name, t.r, t.c, { formula: t.f }); if (ap.err) errs = ap.err; else n++; });
      if (!n) { toast(errs || '합계를 넣지 못했습니다.', 4200); return; }
      env.syncDirty(); var ok = s.calc && s.calc.on ? env.calcRefresh() : false; s.lk = null; env.select(targets[0].r, targets[0].c, true); env.render(true); env.refreshEd();
      toast(ok ? '합계를 넣었습니다(' + n + '칸). 값을 바로 보여 드립니다.' : '합계 수식을 넣었습니다(' + n + '칸). 값은 엑셀에서 열면 계산됩니다.', 3600);
    }
    function currentRegion(sh, r, c) {         // 값이 이어진 덩어리(엑셀의 「현재 영역」)
      function filled(rr, cc) { var cl = env.cellOf(sh, rr, cc); return !!(cl && (cl.v != null && cl.v !== '' || cl.f)); }
      var r0 = r, r1 = r, c0 = c, c1 = c, grow = true;
      while (grow) {
        grow = false; var i;
        for (i = c0 - 1; i <= c1 + 1 && !grow; i++) if (r0 > 0 && i >= 0 && filled(r0 - 1, i)) { r0--; grow = true; }
        for (i = c0 - 1; i <= c1 + 1 && !grow; i++) if (r1 + 1 < sh.nr && i >= 0 && filled(r1 + 1, i)) { r1++; grow = true; }
        for (i = r0 - 1; i <= r1 + 1 && !grow; i++) if (c0 > 0 && i >= 0 && filled(i, c0 - 1)) { c0--; grow = true; }
        for (i = r0 - 1; i <= r1 + 1 && !grow; i++) if (c1 + 1 < sh.nc && i >= 0 && filled(i, c1 + 1)) { c1++; grow = true; }
      }
      return { r0: r0, r1: r1, c0: c0, c1: c1 };
    }
    function sortSheet() {
      var s = S(), sh = s.sh, r = rg0(), reg = (r.r1 > r.r0) ? r : currentRegion(sh, r.r0, r.c0), key = Math.min(Math.max(r.c0, reg.c0), reg.c1);
      if (reg.r1 <= reg.r0) { toast('정렬할 표 안의 칸을 먼저 눌러 주십시오.', 3000); return; }
      var firstText = true, hasNum = false, c;
      for (c = reg.c0; c <= reg.c1; c++) { var h = env.cellOf(sh, reg.r0, c); if (!h || h.t !== 's') firstText = false; var d = env.cellOf(sh, reg.r0 + 1, c); if (d && d.t === 'n') hasNum = true; }
      var hdr = firstText && hasNum, body = el('div', 'sxu'), chk = el('button', 'sxu-b' + (hdr ? ' on' : ''), '첫 줄은 제목(정렬에서 뺌)'); chk.type = 'button'; chk.onclick = function () { hdr = !hdr; chk.classList.toggle('on', hdr); };
      body.appendChild(el('div', 'sxu-l', '정렬할 범위: ' + env.addr(reg.r0, reg.c0) + ':' + env.addr(reg.r1, reg.c1) + ' · 기준 열: ' + env.colName(key)));
      body.appendChild(chk);
      function doSort(asc) {
        var r0 = reg.r0 + (hdr ? 1 : 0), rows = [], i; if (reg.r1 <= r0) { toast('정렬할 줄이 두 줄 이상 있어야 합니다.', 3000); return; }
        for (i = r0; i <= reg.r1; i++) { var cl = env.cellOf(sh, i, key); rows.push({ row: i, t: !cl || cl.v == null || cl.v === '' ? 3 : (cl.t === 'n' ? 0 : 1), v: cl ? cl.v : null }); }
        rows.sort(function (a, b) {
          if (a.t !== b.t) return a.t - b.t;                       // 숫자 → 글자 → 빈 칸(빈 칸은 늘 맨 아래)
          if (a.t === 3) return a.row - b.row;
          var x = a.t === 0 ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'ko');
          if (x === 0) return a.row - b.row; return asc ? x : -x;
        });
        var order = rows.map(function (q) { return q.row + 1; }), rng = { r0: r0 + 1, c0: reg.c0 + 1, r1: reg.r1 + 1, c1: reg.c1 + 1 };
        s.ctx.closeSheet(); setTimeout(function () { run('정렬', function (pkg) { return ST.sortRows(pkg, sh.name, rng, order); }, asc ? '오름차순으로 정렬했습니다' : '내림차순으로 정렬했습니다'); }, 60);
      }
      var grid = el('div', 'sxu-g'), a = el('button', 'sxu-b big', '오름차순(작은 것부터)'), d = el('button', 'sxu-b big', '내림차순(큰 것부터)'); a.type = d.type = 'button'; a.onclick = function () { doSort(true); }; d.onclick = function () { doSort(false); };
      grid.appendChild(a); grid.appendChild(d); body.appendChild(grid);
      body.appendChild(el('div', 'so-sheet-note', '고른 열의 값 순서대로 줄 전체가 자리를 바꿉니다(수식은 옮겨 간 줄에 맞게 따라갑니다). 합쳐진 칸이 있으면 정렬할 수 없습니다. 정렬 뒤에는 ↶ 단추로 되돌릴 수 있습니다.'));
      s.ctx.sheet({ title: '정렬', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    function replaceBtn() { env.toggleFind(); var s = S(); if (s.el.find.style.display !== 'none') toast('찾을 말을 쓰고 Enter, 그 아래에 바꿀 말을 쓰고 「바꾸기」를 누르십시오.', 3600); }
    function rangeBtn() { var s = S(); if (s.rg || s.rangeMode) env.clearRange(); else env.startRange(); }


    // ---------------- 틀 고정 ----------------
    function freezeSheet() {
      var xml = sheetXml(), cur = xml ? ST.readFreeze(xml) : { rows: 0, cols: 0 }, r = rg0(), body = el('div', 'sxu'), g = el('div', 'sxu-g');
      function add(text, rows, cols, cls) { var b = el('button', 'sxu-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { S().ctx.closeSheet(); setTimeout(function () { run('틀 고정', function (pkg) { return ST.freezePanes(pkg, nameNow(), rows, cols); }, rows || cols ? '틀을 고정했습니다(위 ' + rows + '줄·왼쪽 ' + cols + '칸)' : '틀 고정을 풀었습니다'); }, 60); }; g.appendChild(b); }
      add('첫 줄 고정', 1, 0); add('첫 열 고정', 0, 1); add('첫 줄과 첫 열 고정', 1, 1);
      if (r.r0 > 0 || r.c0 > 0) add('고른 칸(' + rangeText().split(':')[0] + ') 위·왼쪽까지 고정', r.r0, r.c0);
      add('틀 고정 풀기', 0, 0, 'danger');
      body.appendChild(el('div', 'sxu-l', '지금: ' + (cur.rows || cur.cols ? '위 ' + cur.rows + '줄 · 왼쪽 ' + cur.cols + '칸 고정됨' : '고정 없음')));
      body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '엑셀·한셀에서 열면 스크롤해도 고정한 줄·칸이 머리에 남습니다. 화면 아래의 「첫 행 고정」·「첫 열 고정」은 이 앱 화면에서만 보는 용도이고 파일에는 저장되지 않습니다. 이 시트는 파일에 저장합니다.'));
      S().ctx.sheet({ title: '틀 고정', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    // ---------------- 조건부 서식 ----------------
    function swatchRow(parent, list, cur, onPick) {
      var row = el('div', 'sxu-r'); parent.appendChild(row);
      list.forEach(function (c) { var b = el('button', 'sxu-b sw' + (c[1] === cur ? ' on' : ''), ''); b.type = 'button'; b.setAttribute('aria-label', c[0]); var d = el('i'); if (c[1]) d.style.background = c[1]; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', c[0])); b.onclick = function () { onPick(c[1]); [].forEach.call(row.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); }; row.appendChild(b); });
    }
    function condSheet() {
      var xml = sheetXml(), rules = xml ? ST.readCond(xml) : [], body = el('div', 'sxu'), r1 = rg1(), st = { op: 'ge', bg: '#FFD6E0', color: null };
      body.appendChild(el('div', 'sxu-l', '이 시트의 조건부 서식 ' + rules.length + '개' + (rules.length ? ': ' + rules.slice(0, 6).map(function (q) { return q.sqref + ' ' + q.text; }).join(' · ') : '')));
      body.appendChild(el('div', 'sxu-l', '고른 곳(' + rangeText() + ')에 새로 걸기'));
      var ops = el('div', 'sxu-r'), inp = el('input', 'sxu-in wide'); body.appendChild(ops);
      inp.type = 'number'; inp.inputMode = 'decimal'; inp.placeholder = '비교할 숫자'; inp.setAttribute('aria-label', '조건 값');
      [['이상', 'ge'], ['이하', 'le'], ['초과', 'gt'], ['미만', 'lt'], ['같음', 'eq'], ['다름', 'ne'], ['글자 포함', 'contains']].forEach(function (o) { var b = el('button', 'sxu-b' + (o[1] === st.op ? ' on' : ''), o[0]); b.type = 'button'; b.onclick = function () { st.op = o[1]; [].forEach.call(ops.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); inp.value = ''; inp.type = o[1] === 'contains' ? 'text' : 'number'; inp.placeholder = o[1] === 'contains' ? '포함할 글자' : '비교할 숫자'; }; ops.appendChild(b); });
      body.appendChild(inp);
      body.appendChild(el('div', 'sxu-l', '칠할 배경색')); swatchRow(body, BG, st.bg, function (v) { st.bg = v; });
      body.appendChild(el('div', 'sxu-l', '글자 색')); swatchRow(body, TXT, st.color, function (v) { st.color = v; });
      var g = el('div', 'sxu-g'), ap = el('button', 'sxu-b big on', '이 조건 걸기'), cl = el('button', 'sxu-b big danger', '고른 곳의 조건 지우기'), cla = el('button', 'sxu-b big danger', '이 시트 조건 모두 지우기'); ap.type = cl.type = cla.type = 'button';
      ap.onclick = function () { var v = inp.value; S().ctx.closeSheet(); setTimeout(function () { run('조건부 서식', function (pkg) { return ST.addCond(pkg, nameNow(), r1, { op: st.op, v: v, bg: st.bg, color: st.color }); }, '조건부 서식을 걸었습니다(' + rangeText() + ')'); }, 60); };
      cl.onclick = function () { S().ctx.closeSheet(); setTimeout(function () { run('조건 지우기', function (pkg) { return ST.clearCond(pkg, nameNow(), r1); }, function (x) { return '조건부 서식 ' + x.n + '개를 지웠습니다'; }); }, 60); };
      cla.onclick = function () { S().ctx.closeSheet(); setTimeout(function () { run('조건 지우기', function (pkg) { return ST.clearCond(pkg, nameNow(), null); }, function (x) { return '조건부 서식 ' + x.n + '개를 지웠습니다'; }); }, 60); };
      g.appendChild(ap); g.appendChild(cl); g.appendChild(cla); body.appendChild(g);
      body.appendChild(el('div', 'so-sheet-note', '값이 조건에 맞는 칸을 엑셀에서 열면 칠해서 보여 줍니다(이 앱의 보기 화면에는 색이 나오지 않을 수 있습니다). 숫자 칸은 숫자 비교, 글자 칸은 「글자 포함」을 씁니다.'));
      S().ctx.sheet({ title: '조건부 서식', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    // ---------------- 입력 목록(데이터 유효성) ----------------
    function validSheet() {
      var xml = sheetXml(), vs = xml ? ST.readValid(xml) : [], body = el('div', 'sxu'), r1 = rg1();
      body.appendChild(el('div', 'sxu-l', '고른 곳(' + rangeText() + ')에 고를 수 있는 목록 넣기 — 항목을 쉼표(,)로 나눠 적습니다'));
      var inp = el('input', 'sxu-in wide'); inp.type = 'text'; inp.placeholder = '예: 예,아니오,보류'; inp.setAttribute('aria-label', '목록 항목'); body.appendChild(inp);
      var g = el('div', 'sxu-g'), ap = el('button', 'sxu-b big on', '목록 걸기'), cl = el('button', 'sxu-b big danger', '고른 곳의 입력 제한 지우기'); ap.type = cl.type = 'button';
      ap.onclick = function () { var items = inp.value.split(','); S().ctx.closeSheet(); setTimeout(function () { run('입력 목록', function (pkg) { return ST.setValid(pkg, nameNow(), r1, items); }, '입력 목록을 걸었습니다(' + rangeText() + ')'); }, 60); };
      cl.onclick = function () { S().ctx.closeSheet(); setTimeout(function () { run('입력 제한', function (pkg) { return ST.setValid(pkg, nameNow(), r1, null); }, '입력 제한을 지웠습니다'); }, 60); };
      g.appendChild(ap); g.appendChild(cl); body.appendChild(g);
      if (vs.length) body.appendChild(el('div', 'so-sheet-note', '이 시트의 입력 제한: ' + vs.slice(0, 6).map(function (q) { return q.sqref + (q.list ? ' [' + q.list.replace(/"/g, '') + ']' : ' (' + (q.type || '기타') + ')'); }).join(' · ')));
      body.appendChild(el('div', 'so-sheet-note', '엑셀·한셀에서 칸을 누르면 ▾ 목록으로 고를 수 있고, 목록에 없는 값은 막힙니다. 항목에는 쉼표와 따옴표를 쓸 수 없습니다.'));
      S().ctx.sheet({ title: '입력 목록', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

    // ---------------- 단추줄 ----------------
    var ITEMS = {
      fmt: { g: 'Aa', l: '서식', run: fmtSheet }, rc: { g: '▤', l: '줄·칸', run: rcSheet }, range: { g: '⬚', l: '범위', run: rangeBtn },
      fill: { g: '⤓', l: '채우기', run: fillDown }, sum: { g: '∑', l: '합계', run: autoSum }, sheet: { g: '▭', l: '시트', run: sheetSheet },
      merge: { g: '⊞', l: '칸 합치기', run: mergeBtn }, size: { g: '↔', l: '크기', run: sizeSheet }, sort: { g: '↕', l: '정렬', run: sortSheet },
      copy: { g: '⧉', l: '복사', run: copySheet }, repl: { g: '⇄', l: '바꾸기', run: replaceBtn }, endrow: { g: '＋줄', l: '맨 끝 줄', run: appendRow }, filter: { g: '▽', l: '필터', run: filterSheet }, hide: { g: '◌', l: '숨기기', run: hideSheet }, freeze: { g: '❄', l: '틀 고정', run: freezeSheet }, cond: { g: '◧', l: '조건 서식', run: condSheet }, valid: { g: '☰', l: '입력 목록', run: validSheet }
    };
    var ORDER = ['fmt', 'rc', 'range', 'copy', 'fill', 'sum', 'sheet', 'merge', 'size', 'sort', 'filter', 'hide', 'repl', 'endrow', 'freeze', 'cond', 'valid'];
    function mkBtn(id, host, inSheet) {
      var it = ITEMS[id], b = el('button', inSheet ? 'sxu-mb' : 'sxu-ob'); b.type = 'button'; b.setAttribute('aria-label', it.l); b.dataset.id = id;
      b.appendChild(el('span', 'g', it.g)); b.appendChild(el('span', 'l', it.l));
      b.addEventListener('pointerdown', function (e) { if (document.activeElement === S().el.inp) e.preventDefault(); });
      b.onclick = function () { if (inSheet) S().ctx.closeSheet(); setTimeout(it.run, inSheet ? 60 : 0); };
      host.appendChild(b); return b;
    }
    function moreSheet(rest) {
      var body = el('div', 'sxu-mg'); rest.forEach(function (id) { mkBtn(id, body, true); });
      S().ctx.sheet({ title: '더보기', body: body, buttons: [{ label: '닫기' }], wide: true });
    }
    function render() {
      var n = perRow(), ids = ORDER, shown = ids.length > n ? ids.slice(0, n) : ids, rest = ids.length > n ? ids.slice(n) : [];
      U.row.innerHTML = '';
      shown.forEach(function (id) { var b = mkBtn(id, U.row, false); if (id === 'range') U.rangeB = b; });
      if (rest.length) { var mb = el('button', 'sxu-ob'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.appendChild(el('span', 'g', '⋯')); mb.appendChild(el('span', 'l', '더보기')); mb.onclick = function () { moreSheet(rest); }; U.row.appendChild(mb); }
      U.bucket = n;
    }
    U.mount = function (host) {
      U.host = host; host.innerHTML = ''; U.lab = el('div', 'sxu-lab'); U.row = el('div', 'sxu-row'); host.appendChild(U.lab); host.appendChild(U.row);
      render(); U.refresh();
      global.addEventListener('resize', function () { if (S() && U.host && U.bucket !== perRow()) { render(); U.refresh(); } });
    };
    U.refresh = function () {
      setTimeout(refillSheet, 0);
      var s = S(); if (!s || !U.host) return;
      U.host.style.display = s.editing ? '' : 'none';
      if (U.bucket !== perRow()) render();
      var r = rg0(), info = (s.rg ? '고른 범위 ' : '고른 칸 ') + rangeText() + (s.rg ? ' (' + (r.r1 - r.r0 + 1) + '줄 × ' + (r.c1 - r.c0 + 1) + '칸)' : '');
      var fx = null; try { var sx0 = sheetXml(); fx = sx0 ? ST.readFilter(sx0) : null; } catch (e) {}
      U.lab.textContent = s.rangeMode ? '범위의 끝 칸을 눌러 주십시오…' : info + (s.rg ? '' : ' · 한 번 더 누르면 입력') + (fx ? ' · 필터 켜짐' : '');
      if (U.rangeB) { U.rangeB.classList.toggle('on', !!(s.rg || s.rangeMode)); U.rangeB.querySelector('.l').textContent = (s.rg || s.rangeMode) ? '범위 풀기' : '범위'; }
    };
    return U;
  }
  global.SOXlsxUI = { create: create };
})(window);

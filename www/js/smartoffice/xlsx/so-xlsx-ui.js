/* so-xlsx-ui.js — S-Office 엑셀 편집 도구줄·시트(O-0861, v10.4)
 * 고치기를 켰을 때 아래에 나오는 도구줄(서식·줄·칸·범위·채우기·합계·시트 + 더보기)과 그 시트들. 실제 문서 고치기는 so-xlsx-struct.js, 화면 갈아 끼우기는 so-xlsx.js(pkgRun).
 * 한 줄 단추 수: 접은 폰 6 + 더보기 · 펼친 화면 10 + 더보기 · DeX 12(더보기 없음). 가로 밀기는 쓰지 않는다.
 */
(function (global) {
  'use strict';
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var TXT = [['검정', '#000000'], ['빨강', '#E02020'], ['파랑', '#1C5FD6'], ['초록', '#1B8A3A'], ['주황', '#EE7A00'], ['보라', '#7A3FC4'], ['회색', '#777777'], ['기본', null]];
  var BG = [['없음', null], ['노랑', '#FFF2A8'], ['연두', '#D8F0C0'], ['하늘', '#CFE5FF'], ['분홍', '#FFD6E0'], ['살구', '#FFDDB0'], ['회색', '#E5E7EB'], ['남색', '#BBD4F5']];
  var NF = [['일반', 'General'], ['1,234', '#,##0'], ['소수 2자리', '#,##0.00'], ['퍼센트', '0%'], ['원', '#,##0"원"'], ['날짜', 'yyyy-mm-dd']];
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
    function run(label, mut, okMsg, after) { return env.pkgRun(label, mut, function (r) { if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 2800); if (after) after(r); }, fail(label)); }

    // ---------------- 서식 ----------------
    function applyFmt(ch, msg) { run('서식', function (pkg) { return ST.applyStyle(pkg, nameNow(), rg1(), ch); }, msg || '서식을 바꿨습니다'); }
    function isBold() { var s = S(), sh = s.sh, st = null; try { var r = rg0(); st = envStyleAt(sh, r.r0, r.c0); } catch (e) {} return !!(st && st.b); }
    function envStyleAt(sh, r, c) { return env.styleAt ? env.styleAt(sh, r, c) : null; }
    function fmtSheet() {
      var body = el('div', 'sxu'), close = function () { S().ctx.closeSheet(); };
      function group(label) { body.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r'); body.appendChild(row); return row; }
      function opt(row, text, fn, cls, color) {
        var b = el('button', 'sxu-b' + (cls ? ' ' + cls : ''), color === undefined ? text : ''); b.type = 'button'; if (color !== undefined) { b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); }
        b.onclick = function () { close(); setTimeout(fn, 60); }; row.appendChild(b); return b;
      }
      var g1 = group('글자');
      opt(g1, '굵게', function () { applyFmt({ bold: !isBold() }); }, 'bold'); opt(g1, '기울임', function () { applyFmt({ italic: true }); }, 'it'); opt(g1, '굵기·기울임 없음', function () { applyFmt({ bold: false, italic: false }); });
      var g2 = group('글자 색'); TXT.forEach(function (c) { opt(g2, c[0], function () { applyFmt({ color: c[1] }); }, 'sw', c[1] || ''); });
      var g3 = group('칸 배경색'); BG.forEach(function (c) { opt(g3, c[0], function () { applyFmt({ bg: c[1] }); }, 'sw', c[1] || ''); });
      var g4 = group('정렬'); ALIGN.forEach(function (a) { opt(g4, a[0], function () { applyFmt({ align: a[1] }); }); });
      var g5 = group('숫자 모양'); NF.forEach(function (n) { opt(g5, n[0], function () { applyFmt({ nf: n[1] }); }); });
      var g6 = group('테두리'); opt(g6, '모두', function () { applyFmt({ borderMode: 'all' }, '테두리를 넣었습니다'); }); opt(g6, '바깥쪽', function () { applyFmt({ borderMode: 'outer' }, '바깥 테두리를 넣었습니다'); }); opt(g6, '없음', function () { applyFmt({ borderMode: 'none' }, '테두리를 없앴습니다'); });
      var g7 = group('칸 합치기'); opt(g7, '합치기', mergeCells); opt(g7, '합치기 풀기', unmerge);
      body.appendChild(el('div', 'so-sheet-note', '고른 곳(' + rangeText() + ')에 적용됩니다. 칸 하나만 골랐으면 그 칸에만, 줄 번호·열 글자나 「범위」로 고르면 그 범위 전체에 적용됩니다.'));
      S().ctx.sheet({ title: '서식', body: body, buttons: [{ label: '닫기' }], wide: true });
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
      body.appendChild(el('div', 'so-sheet-note', '지금 고른 곳: ' + rangeText() + ' (' + nR + '줄 × ' + nC + '칸) — 고른 만큼 넣고 뺍니다. 줄 번호나 열 글자를 누르면 그 줄·열 전체를 고를 수 있습니다. 중간에 넣고 빼는 일은 수식·차트가 어긋나지 않는 문서에서만 되며, 안 되면 이유를 알려 드립니다.'));
      body.insertBefore(grid, body.firstChild);
      S().ctx.sheet({ title: '줄·칸 넣고 빼기', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

    // ---------------- 줄 높이 · 칸 너비 ----------------
    function sizeSheet() {
      var body = el('div', 'sxu'), r1 = rg1();
      function line(label, def, min, max, unit, fn, resetFn) {
        body.appendChild(el('div', 'sxu-l', label)); var row = el('div', 'sxu-r'), inp = el('input', 'sxu-in'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.min = min; inp.max = max; inp.value = def; inp.setAttribute('aria-label', label);
        var ap = el('button', 'sxu-b', '적용'), rs = el('button', 'sxu-b', '기본값으로');
        ap.type = rs.type = 'button';
        ap.onclick = function () { var v = parseFloat(inp.value); if (!(v >= min && v <= max)) { toast(label + '은 ' + min + '~' + max + ' 사이로 적어 주십시오.', 3000); return; } S().ctx.closeSheet(); setTimeout(function () { fn(v); }, 60); };
        rs.onclick = function () { S().ctx.closeSheet(); setTimeout(resetFn, 60); };
        row.appendChild(inp); row.appendChild(el('span', 'sxu-u', unit)); row.appendChild(ap); row.appendChild(rs); body.appendChild(row);
      }
      line('줄 높이', 24, 8, 120, '포인트', function (v) { run('줄 높이', function (pkg) { return ST.setRowHeight(pkg, nameNow(), r1.r0, r1.r1, v); }, '줄 높이를 바꿨습니다'); }, function () { run('줄 높이', function (pkg) { return ST.setRowHeight(pkg, nameNow(), r1.r0, r1.r1, 0); }, '줄 높이를 기본으로 돌렸습니다'); });
      line('칸 너비', 14, 3, 80, '글자 수', function (v) { run('칸 너비', function (pkg) { return ST.setColWidth(pkg, nameNow(), r1.c0, r1.c1, v); }, '칸 너비를 바꿨습니다'); }, function () { run('칸 너비', function (pkg) { return ST.setColWidth(pkg, nameNow(), r1.c0, r1.c1, 0); }, '칸 너비를 기본으로 돌렸습니다'); });
      body.appendChild(el('div', 'so-sheet-note', '고른 곳(' + rangeText() + ')의 줄·열에 적용됩니다. 여러 줄·열을 한꺼번에 바꾸려면 줄 번호·열 글자나 「범위」로 고르십시오.'));
      S().ctx.sheet({ title: '줄 높이·칸 너비', body: body, buttons: [{ label: '닫기' }], wide: true });
    }

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

    // ---------------- 단추줄 ----------------
    var ITEMS = {
      fmt: { g: 'Aa', l: '서식', run: fmtSheet }, rc: { g: '▤', l: '줄·칸', run: rcSheet }, range: { g: '⬚', l: '범위', run: rangeBtn },
      fill: { g: '⤓', l: '채우기', run: fillDown }, sum: { g: '∑', l: '합계', run: autoSum }, sheet: { g: '▭', l: '시트', run: sheetSheet },
      merge: { g: '⊞', l: '칸 합치기', run: mergeBtn }, size: { g: '↔', l: '크기', run: sizeSheet }, sort: { g: '↕', l: '정렬', run: sortSheet },
      repl: { g: '⇄', l: '바꾸기', run: replaceBtn }, endrow: { g: '＋줄', l: '맨 끝 줄', run: appendRow }
    };
    var ORDER = ['fmt', 'rc', 'range', 'fill', 'sum', 'sheet', 'merge', 'size', 'sort', 'repl', 'endrow'];
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
      var s = S(); if (!s || !U.host) return;
      U.host.style.display = s.editing ? '' : 'none';
      if (U.bucket !== perRow()) render();
      var r = rg0(), info = (s.rg ? '고른 범위 ' : '고른 칸 ') + rangeText() + (s.rg ? ' (' + (r.r1 - r.r0 + 1) + '줄 × ' + (r.c1 - r.c0 + 1) + '칸)' : '');
      U.lab.textContent = s.rangeMode ? '범위의 끝 칸을 눌러 주십시오…' : info;
      if (U.rangeB) { U.rangeB.classList.toggle('on', !!(s.rg || s.rangeMode)); U.rangeB.querySelector('.l').textContent = (s.rg || s.rangeMode) ? '범위 풀기' : '범위'; }
    };
    return U;
  }
  global.SOXlsxUI = { create: create };
})(window);

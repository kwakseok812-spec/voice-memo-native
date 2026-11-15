/* so-xlsx-data.js — S-Office 엑셀 데이터 도구(O-0861, v10.9 5회차): 스파크라인(칸 속 작은 그래프) · 부분합(그룹별 소계 줄 끼우기) · 통합(여러 범위를 항목별로 합치기).
 * 파일 안에는 진짜 스파크라인(워크시트 확장 목록의 x14:sparklineGroups)과 진짜 수식(SUBTOTAL)이 들어간다. 원본 .xlsx(zip)의 XML 을 직접 고치며 새 외부 부품이 없다.
 * 브라우저와 Node(시험) 양쪽에서 돈다. pkg = { read, write, remove, list } (so-xlsx-struct.js 와 같다).
 */
(function (global) {
  'use strict';
  function ST() { return global.SOXlsxStruct; }
  function XX() { return ST().x; }
  var X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', XM = 'http://schemas.microsoft.com/office/excel/2006/main', NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var SPK_URI = '{05C60535-1F16-4fd2-B633-F4F36F0B64E0}';
  function esc(s) { return XX().escX(String(s)); }
  function un(s) { return XX().unescX(String(s)); }
  function attr(tag, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function colName(n) { return XX().colName(n); }
  function colNum(s) { return XX().colNum(s); }
  function qs(n) { return XX().quoteSheet(n); }
  function parseRange(t) {
    var m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(String(t || '').trim()); if (!m) return null;
    var r = { c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3] || m[1]), r1: +(m[4] || m[2]) };
    if (r.c1 < r.c0) { var q = r.c0; r.c0 = r.c1; r.c1 = q; } if (r.r1 < r.r0) { var w = r.r0; r.r0 = r.r1; r.r1 = w; } return r;
  }
  function rangeText(r) { return r.c0 === r.c1 && r.r0 === r.r1 ? colName(r.c0) + r.r0 : colName(r.c0) + r.r0 + ':' + colName(r.c1) + r.r1; }
  function readGrid(pkg, sheet, rg) {           // rg: 1부터. 돌려주는 값: { vals:[줄][칸]={k,v,f} } | { err }
    return ST().readSst(pkg).then(function (sst) {
      return XX().withSheet(pkg, sheet, function (xml) {
        var sd = XX().parseSheet(xml); if (!sd) return { err: '시트 구조가 특이해서 읽을 수 없습니다.' };
        var vals = [], r, c; for (r = rg.r0; r <= rg.r1; r++) { var row = XX().getRow(sd, r, false), line = []; for (c = rg.c0; c <= rg.c1; c++) line.push(ST().cellVal(row && XX().getCell(row, c, false), sst)); vals.push(line); }
        return { vals: vals };
      });
    });
  }
  function textOf(cv) { return !cv || cv.k === 'z' || cv.v == null ? '' : cv.k === 'b' ? (cv.v ? 'TRUE' : 'FALSE') : String(cv.v); }

  // ============================== 스파크라인 ==============================
  var SP_COLORS = { series: 'FF376092', negative: 'FFD00000', axis: 'FF000000', markers: 'FFD00000', first: 'FFD00000', last: 'FFD00000', high: 'FFD00000', low: 'FFD00000' };
  function sparkBlock(xml) {              // { ext:{s,e,xml}, groups:[{s,e,xml}] } | null
    var m = /<ext\b[^>]*uri="\{05C60535-1F16-4fd2-B633-F4F36F0B64E0\}"[^>]*>[\s\S]*?<\/ext>/.exec(xml); if (!m) return null;
    var out = { s: m.index, e: m.index + m[0].length, xml: m[0], groups: [] }, re = /<x14:sparklineGroup\b[^>]*?>[\s\S]*?<\/x14:sparklineGroup>/g, g;
    while ((g = re.exec(m[0]))) out.groups.push({ s: g.index, e: g.index + g[0].length, xml: g[0] });
    return out;
  }
  function parseGroup(gx) {
    var head = /<x14:sparklineGroup\b[^>]*>/.exec(gx)[0], o = { type: attr(head, 'type') || 'line', lineWeight: attr(head, 'lineWeight') ? +attr(head, 'lineWeight') : 0.75, markers: attr(head, 'markers') === '1', high: attr(head, 'high') === '1', low: attr(head, 'low') === '1', first: attr(head, 'first') === '1', last: attr(head, 'last') === '1', negative: attr(head, 'negative') === '1', axis: attr(head, 'displayXAxis') === '1', empty: attr(head, 'displayEmptyCellsAs') || 'gap', items: [], colors: {} };
    ['series', 'negative', 'axis', 'markers', 'first', 'last', 'high', 'low'].forEach(function (k) { var m = new RegExp('<x14:color' + k.charAt(0).toUpperCase() + k.slice(1) + '\\b[^>]*\\srgb="([0-9A-Fa-f]{8})"').exec(gx); if (m) o.colors[k] = m[1].toUpperCase(); });
    (gx.match(/<x14:sparkline>[\s\S]*?<\/x14:sparkline>/g) || []).forEach(function (sx) {
      var f = /<xm:f>([^<]*)<\/xm:f>/.exec(sx), q = /<xm:sqref>([^<]*)<\/xm:sqref>/.exec(sx); if (f && q) o.items.push({ f: un(f[1]), sqref: q[1] });
    });
    return o;
  }
  function groupXml(g) {
    var c = Object.assign({}, SP_COLORS, g.colors || {}), a = ' displayEmptyCellsAs="' + (g.empty || 'gap') + '"' + (g.type && g.type !== 'line' ? ' type="' + g.type + '"' : '') + (g.lineWeight && g.type !== 'column' && g.type !== 'stacked' ? ' lineWeight="' + g.lineWeight + '"' : '') +
      (g.markers ? ' markers="1"' : '') + (g.high ? ' high="1"' : '') + (g.low ? ' low="1"' : '') + (g.first ? ' first="1"' : '') + (g.last ? ' last="1"' : '') + (g.negative ? ' negative="1"' : '') + (g.axis ? ' displayXAxis="1"' : '');
    return '<x14:sparklineGroup' + a + '><x14:colorSeries rgb="' + c.series + '"/><x14:colorNegative rgb="' + c.negative + '"/><x14:colorAxis rgb="' + c.axis + '"/><x14:colorMarkers rgb="' + c.markers + '"/><x14:colorFirst rgb="' + c.first + '"/><x14:colorLast rgb="' + c.last + '"/><x14:colorHigh rgb="' + c.high + '"/><x14:colorLow rgb="' + c.low + '"/><x14:sparklines>' +
      g.items.map(function (it) { return '<x14:sparkline><xm:f>' + esc(it.f) + '</xm:f><xm:sqref>' + it.sqref + '</xm:sqref></x14:sparkline>'; }).join('') + '</x14:sparklines></x14:sparklineGroup>';
  }
  function listSparklines(pkg, sheet) {
    return XX().withSheet(pkg, sheet, function (xml) { var b = sparkBlock(xml); return { groups: b ? b.groups.map(function (g) { return parseGroup(g.xml); }) : [] }; });
  }
  function putGroups(xml, groups) {          // 시트 XML 속 스파크라인 묶음 전체를 이 목록으로 바꾼다(빈 목록이면 확장 항목을 걷어 낸다)
    var b = sparkBlock(xml), inner = groups.map(groupXml).join('');
    var ext = '<ext uri="' + SPK_URI + '" xmlns:x14="' + X14 + '"><x14:sparklineGroups xmlns:xm="' + XM + '">' + inner + '</x14:sparklineGroups></ext>';
    if (b) {
      var nx = groups.length ? xml.slice(0, b.s) + ext + xml.slice(b.e) : xml.slice(0, b.s) + xml.slice(b.e);
      return nx.replace(/<extLst>\s*<\/extLst>/, '');
    }
    if (!groups.length) return xml;
    if (/<extLst>/.test(xml)) return xml.replace('<extLst>', '<extLst>' + ext);
    if (!/<worksheet\b[^>]*\sxmlns:r=/.test(xml)) xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="' + NSR + '"');
    return xml.replace('</worksheet>', '<extLst>' + ext + '</extLst></worksheet>');
  }
  function cellsOf(sq) { var r = parseRange(sq); return r ? [r] : []; }
  function overlaps(a, b) { return !(a.r1 < b.r0 || a.r0 > b.r1 || a.c1 < b.c0 || a.c0 > b.c1); }
  // spec: { type:'line'|'column'|'stacked', color, high, low, first, last, negative, markers, axis, items:[{f:'Sheet!A1:E1', sqref:'G1'}] }
  function addSparklines(pkg, sheet, spec) {
    if (!spec.items || !spec.items.length) return Promise.resolve({ err: '스파크라인을 넣을 칸이 없습니다.' });
    return XX().withSheet(pkg, sheet, function (xml, tgt) {
      var b = sparkBlock(xml), groups = b ? b.groups.map(function (g) { return parseGroup(g.xml); }) : [], n = 0;
      // 같은 칸에 이미 있으면 새 것으로 바꾼다
      var newCells = spec.items.map(function (it) { return parseRange(it.sqref); });
      groups.forEach(function (g) { g.items = g.items.filter(function (it) { var r = parseRange(it.sqref); return !r || !newCells.some(function (nc) { return overlaps(nc, r); }); }); });
      groups = groups.filter(function (g) { return g.items.length; });
      var ng = { type: spec.type || 'line', lineWeight: spec.lineWeight || 0.75, markers: !!spec.markers, high: !!spec.high, low: !!spec.low, first: !!spec.first, last: !!spec.last, negative: !!spec.negative, axis: !!spec.axis, empty: 'gap', colors: {}, items: spec.items.slice() };
      if (spec.color) ng.colors.series = 'FF' + spec.color.replace('#', '').toUpperCase();
      var marker = spec.markerColor ? 'FF' + spec.markerColor.replace('#', '').toUpperCase() : null; if (marker) ['markers', 'first', 'last', 'high', 'low'].forEach(function (k) { ng.colors[k] = marker; });
      groups.push(ng); n = ng.items.length;
      pkg.write(tgt.path, putGroups(xml, groups)); return { ok: true, n: n };
    });
  }
  // cells: 칸 주소 목록(「G1」 …)에 있는 스파크라인을 지운다
  function removeSparklines(pkg, sheet, cells) {
    var rgs = cells.map(parseRange).filter(Boolean);
    return XX().withSheet(pkg, sheet, function (xml, tgt) {
      var b = sparkBlock(xml); if (!b) return { err: '이 시트에는 스파크라인이 없습니다.' };
      var groups = b.groups.map(function (g) { return parseGroup(g.xml); }), n = 0;
      groups.forEach(function (g) { var before = g.items.length; g.items = g.items.filter(function (it) { var r = parseRange(it.sqref); return !r || !rgs.some(function (x) { return overlaps(x, r); }); }); n += before - g.items.length; });
      if (!n) return { err: '고른 칸에는 스파크라인이 없습니다.' };
      pkg.write(tgt.path, putGroups(xml, groups.filter(function (g) { return g.items.length; }))); return { ok: true, n: n };
    });
  }
  // 칸 cell 이 든 묶음의 모양(종류·색·표시)을 patch 로 바꾼다
  function setSparkGroup(pkg, sheet, cell, patch) {
    var rg = parseRange(cell);
    return XX().withSheet(pkg, sheet, function (xml, tgt) {
      var b = sparkBlock(xml); if (!b) return { err: '이 시트에는 스파크라인이 없습니다.' };
      var groups = b.groups.map(function (g) { return parseGroup(g.xml); }), hit = 0;
      groups.forEach(function (g) {
        if (!g.items.some(function (it) { var r = parseRange(it.sqref); return r && overlaps(rg, r); })) return;
        ['type', 'lineWeight', 'markers', 'high', 'low', 'first', 'last', 'negative', 'axis'].forEach(function (k) { if (patch[k] !== undefined) g[k] = patch[k]; });
        if (patch.color) g.colors.series = 'FF' + patch.color.replace('#', '').toUpperCase();
        hit++;
      });
      if (!hit) return { err: '고른 칸에는 스파크라인이 없습니다.' };
      pkg.write(tgt.path, putGroups(xml, groups)); return { ok: true };
    });
  }

  // ============================== 부분합 ==============================
  var SUB_CODE = { sum: 9, count: 3, average: 1, max: 4, min: 5 }, SUB_LABEL = { sum: '합계', count: '개수', average: '평균', max: '최대', min: '최소' };
  function calcFn(fn, nums, cnt) { if (fn === 'count') return cnt; if (!nums.length) return fn === 'sum' ? 0 : null; var s = 0, i; for (i = 0; i < nums.length; i++) s += nums[i]; return fn === 'sum' ? s : fn === 'average' ? s / nums.length : fn === 'max' ? Math.max.apply(null, nums) : Math.min.apply(null, nums); }
  function hasSubtotal(xml) { return /<f\b[^>]*>\s*SUBTOTAL\(/i.test(xml); }
  // 이 범위가 어느 피벗 표의 원본이면 부분합 줄을 끼울 수 없다(엑셀이 「원본에 자동 부분합이 있어」 피벗을 못 만든다)
  function pivotSourceHit(pkg, sheet, rg) {
    var cps = pkg.list().filter(function (p) { return /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(p); });
    return Promise.all(cps.map(function (cp) {
      return pkg.read(cp).then(function (cx) {
        var m = cx && /<worksheetSource\b[^>]*>/.exec(cx); if (!m) return false; var sh = attr(m[0], 'sheet'), rf = parseRange(attr(m[0], 'ref'));
        return !!(sh != null && rf && XX().sameName(un(sh), sheet) && !(rf.r1 < rg.r0 || rf.r0 > rg.r1 || rf.c1 < rg.c0 || rf.c0 > rg.c1));
      });
    })).then(function (r) { return r.some(Boolean); });
  }
  // o: { rg:{r0,c0,r1,c1}(1부터, 맨 윗줄=이름 줄), groupCol(1부터), fn, cols:[열 번호…], grand:true }
  function addSubtotals(pkg, sheet, o) {
    return pivotSourceHit(pkg, sheet, o.rg).then(function (hit) { return hit ? { err: '이 표는 피벗 표의 원본 자료입니다. 부분합 줄을 끼우면 피벗 표가 계산하지 못하게 되므로 하지 않습니다. 피벗 표를 지우거나, 표를 다른 시트에 복사해서 부분합을 넣어 주십시오.' } : addSubtotals2(pkg, sheet, o); });
  }
  function addSubtotals2(pkg, sheet, o) {
    var rg = o.rg, fn = o.fn || 'sum', code = SUB_CODE[fn];
    if (!code) return Promise.resolve({ err: '알 수 없는 계산입니다.' });
    if (!o.cols || !o.cols.length) return Promise.resolve({ err: '소계를 낼 열을 하나 이상 골라 주십시오.' });
    if (o.cols.indexOf(o.groupCol) >= 0) return Promise.resolve({ err: '묶는 기준 열은 소계 열로 쓸 수 없습니다.' });
    if (rg.r1 - rg.r0 < 2) return Promise.resolve({ err: '이름 줄 아래에 자료가 두 줄 이상 있어야 합니다.' });
    return readGrid(pkg, sheet, rg).then(function (g) {
      if (g.err) return g;
      var vals = g.vals, groupIdx = o.groupCol - rg.c0, groups = [], i, j, sr;
      for (i = 1; i < vals.length; i++) {
        var key = textOf(vals[i][groupIdx]);
        if (vals[i].some(function (cv) { return cv.f && /^\s*SUBTOTAL/i.test(String(cv.f)); })) { /* 수식 글은 cellVal 에 없다 */ }
        if (groups.length && groups[groups.length - 1].key === key) groups[groups.length - 1].e = rg.r0 + i; else groups.push({ key: key, s: rg.r0 + i, e: rg.r0 + i });
      }
      if (groups.length < 1) return { err: '묶을 그룹이 없습니다.' };
      if (groups.length > 200) return { err: '그룹이 200개를 넘으면 폰에서는 부분합을 만들지 않습니다.' };
      return XX().withSheet(pkg, sheet, function (xml) { return { has: hasSubtotal(xml) }; }).then(function (h) {
        if (h.err) return h; if (h.has) return { err: '이 시트에는 이미 부분합(SUBTOTAL)이 들어 있습니다. 먼저 「부분합 지우기」를 하십시오.' };
        // 소계 값(캐시)
        function stat(ci, s, e) { var nums = [], cnt = 0, q; for (q = s; q <= e; q++) { var cv = vals[q - rg.r0][ci]; if (cv && cv.k !== 'z' && cv.v !== '' && cv.v != null) { cnt++; if (cv.k === 'n') nums.push(cv.v); } } return calcFn(fn, nums, cnt); }
        // 줄 끼우기: 아래에서 위로(앞 줄 번호가 안 흔들리게), 맨 아래는 총합계 줄
        var ins = groups.map(function (gr) { return gr.e + 1; }); if (o.grand !== false) ins.push(rg.r1 + 1);
        ins.sort(function (a, b) { return b - a; });
        var chain = Promise.resolve({ ok: true });
        ins.forEach(function (at) { chain = chain.then(function (r) { if (r.err) return r; return ST().lineEdit(pkg, sheet, 'row', at, 1, 'ins'); }); });
        return chain.then(function (r) {
          if (r.err) return r;
          function nw(row) { var k = 0; groups.forEach(function (gr) { if (gr.e < row) k++; }); return row + k; }
          var nG = groups.length, lastNew = nw(rg.r1), grandRow = lastNew + nG * 0 + 1 + (nG - 0) * 0;
          // 총합계 줄 번호: 마지막 그룹의 소계 줄 바로 다음
          var lastSub = groups[nG - 1].e + nG, gRow = lastSub + 1;
          return XX().withSheet(pkg, sheet, function (xml0, tgt) {
            var sd = XX().parseSheet(xml0); if (!sd) return { err: '시트 구조가 특이합니다.' };
            function putS(row, c, text) { XX().putCell(sd, row, c, function (ref) { return XX().mkCellXml(ref, null, { k: 's', v: text }); }); }
            function putF(row, c, f, v) { XX().putCell(sd, row, c, function (ref) { return '<c r="' + ref + '"><f>' + esc(f) + '</f>' + (v == null ? '' : '<v>' + String(v) + '</v>') + '</c>'; }); }
            groups.forEach(function (gr, k) {
              var srow = gr.e + k + 1, s2 = nw(gr.s), e2 = nw(gr.e);
              putS(srow, o.groupCol, (gr.key === '' ? '(빈 칸)' : gr.key) + ' ' + SUB_LABEL[fn]);
              o.cols.forEach(function (c) { putF(srow, c, 'SUBTOTAL(' + code + ',' + colName(c) + s2 + ':' + colName(c) + e2 + ')', stat(c - rg.c0, gr.s, gr.e)); });
            });
            if (o.grand !== false) {
              putS(gRow, o.groupCol, '총합계');
              o.cols.forEach(function (c) { putF(gRow, c, 'SUBTOTAL(' + code + ',' + colName(c) + nw(rg.r0 + 1) + ':' + colName(c) + (gRow - 1) + ')', stat(c - rg.c0, rg.r0 + 1, rg.r1)); });
            }
            var out = XX().serializeSheet(sd); pkg.write(tgt.path, XX().setDimension(out, XX().dimensionOf(XX().parseSheet(out)))); return { ok: true, groups: nG, rows: nG + (o.grand !== false ? 1 : 0) };
          }).then(function (w) {
            if (w.err) return w;
            // 묶기(개요): 자료 줄을 한 단계로
            var oc = Promise.resolve({ ok: true });
            groups.forEach(function (gr) { oc = oc.then(function (q) { if (q.err) return q; return ST().setOutline(pkg, sheet, 'row', nw(gr.s), nw(gr.e), 'group'); }); });
            return oc.then(function (q) { return q.err ? q : w; });
          });
        });
      });
    });
  }
  // 부분합 지우기: SUBTOTAL 줄(총합계 포함)을 지우고 묶기를 푼다. rg: 1부터
  function removeSubtotals(pkg, sheet, rg) {
    return XX().withSheet(pkg, sheet, function (xml) {
      var sd = XX().parseSheet(xml); if (!sd) return { err: '시트 구조가 특이합니다.' }; var rows = [];
      sd.rows.forEach(function (row) { if (row.r < rg.r0 || row.r > rg.r1) return; if (row.cells.some(function (c) { return /<f\b[^>]*>\s*SUBTOTAL\(/i.test(c.raw); })) rows.push(row.r); });
      return { rows: rows.sort(function (a, b) { return b - a; }) };
    }).then(function (p) {
      if (p.err) return p; if (!p.rows.length) return { err: '고른 범위에는 부분합이 없습니다.' };
      var chain = Promise.resolve({ ok: true }); p.rows.forEach(function (r) { chain = chain.then(function (q) { if (q.err) return q; return ST().lineEdit(pkg, sheet, 'row', r, 1, 'del'); }); });
      return chain.then(function (q) {
        if (q.err) return q;
        var last = rg.r1 - p.rows.length;
        return XX().withSheet(pkg, sheet, function (xml, tgt) {         // 묶기 풀기(범위 안 줄의 outlineLevel)
          var sd = XX().parseSheet(xml), changed = false; sd.rows.forEach(function (row) { if (row.r >= rg.r0 && row.r <= last && /\soutlineLevel="/.test(row.open)) { row.open = XX().setAttr(row.open, 'outlineLevel', '0').replace(/\soutlineLevel="0"/, '').replace(/\s(hidden|collapsed)="[^"]*"/g, ''); changed = true; } });
          if (changed) pkg.write(tgt.path, XX().serializeSheet(sd)); return { ok: true, removed: p.rows.length };
        });
      });
    });
  }

  // ============================== 통합 ==============================
  // o: { sources:[{sheet, ref}], fn, topRow:bool, leftCol:bool, destSheet:'통합' } → 새 시트에 값으로 적는다
  function consolidate(pkg, o) {
    var fn = o.fn || 'sum'; if (!SUB_CODE[fn]) return Promise.resolve({ err: '알 수 없는 계산입니다.' });
    if (!o.sources || o.sources.length < 2) return Promise.resolve({ err: '합칠 범위를 두 개 이상 골라 주십시오.' });
    var chain = Promise.resolve([]);
    o.sources.forEach(function (s) { chain = chain.then(function (acc) { var rg = parseRange(s.ref); if (!rg) return { err: '범위(' + s.ref + ')를 알아볼 수 없습니다.' }; if ((rg.r1 - rg.r0 + 1) * (rg.c1 - rg.c0 + 1) > 50000) return { err: '범위가 너무 큽니다.' }; if (acc.err) return acc; return readGrid(pkg, s.sheet, rg).then(function (g) { if (g.err) return g; acc.push({ vals: g.vals, rg: rg, s: s }); return acc; }); }); });
    return chain.then(function (srcs) {
      if (srcs.err) return srcs;
      var top = !!o.topRow, left = !!o.leftCol, rowKeys = [], colKeys = [], cells = {};
      srcs.forEach(function (sr) {
        var v = sr.vals, nr = v.length, nc = v[0].length, i, j, hdr = top ? v[0] : null;
        for (i = top ? 1 : 0; i < nr; i++) {
          var rk = left ? textOf(v[i][0]) : String(i - (top ? 1 : 0) + 1);
          if (left && rk === '') continue;
          if (rowKeys.indexOf(rk) < 0) rowKeys.push(rk);
          for (j = left ? 1 : 0; j < nc; j++) {
            var ck = top ? textOf(hdr[j]) : String(j - (left ? 1 : 0) + 1); if (top && ck === '') continue;
            if (colKeys.indexOf(ck) < 0) colKeys.push(ck);
            var cv = v[i][j]; if (!cv || cv.k === 'z' || cv.v === '' || cv.v == null) continue;
            var key = rk + '\u0001' + ck, c = cells[key] || (cells[key] = { nums: [], cnt: 0 }); c.cnt++; if (cv.k === 'n') c.nums.push(cv.v);
          }
        }
      });
      if (!rowKeys.length || !colKeys.length) return { err: '합칠 내용을 찾지 못했습니다. 「맨 윗줄」「왼쪽 열」 설정을 확인해 주십시오.' };
      if (rowKeys.length > 3000 || colKeys.length > 60) return { err: '결과가 너무 큽니다.' };
      return ST().addSheet(pkg, o.destSheet || '통합').then(function (r) {
        if (r.err) return r;
        return XX().withSheet(pkg, o.destSheet || '통합', function (xml, tgt) {
          var sd = XX().parseSheet(xml), r0 = 1;
          function S(row, c, t) { XX().putCell(sd, row, c, function (ref) { return XX().mkCellXml(ref, null, { k: 's', v: t }); }); }
          function Nn(row, c, n) { XX().putCell(sd, row, c, function (ref) { return XX().mkCellXml(ref, null, { k: 'n', v: n }); }); }
          if (top) colKeys.forEach(function (k, j) { S(1, 2 + j, k); });
          rowKeys.forEach(function (rk, i) { var row = (top ? 2 : 1) + i; if (left) S(row, 1, rk); colKeys.forEach(function (ck, j) { var c = cells[rk + '\u0001' + ck]; if (!c) return; var v = calcFn(fn, c.nums, c.cnt); if (v != null) Nn(row, (left ? 2 : 1) + j, v); }); });
          var out = XX().serializeSheet(sd); pkg.write(tgt.path, XX().setDimension(out, XX().dimensionOf(XX().parseSheet(out)))); return { ok: true, rows: rowKeys.length, cols: colKeys.length, sheet: o.destSheet || '통합' };
        });
      });
    });
  }

  var api = { parseRange: parseRange, rangeText: rangeText, listSparklines: listSparklines, addSparklines: addSparklines, removeSparklines: removeSparklines, setSparkGroup: setSparkGroup, SP_COLORS: SP_COLORS,
    addSubtotals: addSubtotals, removeSubtotals: removeSubtotals, consolidate: consolidate, SUB_LABEL: SUB_LABEL, SUB_CODE: SUB_CODE, readGrid: readGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxData = api;
})(typeof window !== 'undefined' ? window : globalThis);

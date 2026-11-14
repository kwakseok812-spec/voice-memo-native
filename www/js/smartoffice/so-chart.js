/* so-chart.js — S-Office 차트 공통 부품(O-0861, v10.9): 엑셀·PPT·워드가 함께 쓴다.
 * 하는 일: ① 차트 파일(DrawingML chart XML) 만들기 ② 있는 차트 읽기(고칠 수 있는 차트인지 판정) ③ 폰 화면용 미리 그리기(자체 SVG — 새 부품 없음)
 *          ④ PPT·워드 차트에 딸려 가는 데이터 통합문서(xlsx) 만들기 ⑤ 「차트 넣기·고치기」 시트(종류·제목·범례·축 제목·숫자 표시·색·데이터).
 * 종류: 세로 막대 · 누적 세로 막대 · 가로 막대 · 누적 가로 막대 · 꺾은선 · 원 · 도넛 · 분산형. 3차원·콤보·보조 축·영역형 등은 고치지 않고 보기·복제만(「수정 요청」 안내).
 * 파일 안의 차트는 진짜 차트다(파워포인트·엑셀·워드에서 숫자를 고치면 차트가 따라 바뀐다). 이 파일의 그리기 코드는 폰 화면에서 미리 보여 주는 용도뿐이다.
 * 외부 부품 없음(JSZip 은 앱이 이미 쓰는 것). 스위치는 so-core.js 의 SO_CHART.
 */
(function (global) {
  'use strict';
  var PALETTE = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', 'C00000', '7030A0', '264478', '404040'];
  var TYPES = [['col', '세로 막대'], ['colStacked', '누적 세로 막대'], ['bar', '가로 막대'], ['barStacked', '누적 가로 막대'], ['line', '꺾은선'], ['pie', '원'], ['doughnut', '도넛'], ['scatter', '분산형']];
  var TYPE_NAME = {}; TYPES.forEach(function (t) { TYPE_NAME[t[0]] = t[1]; });
  var MARK = '<!--S-Office chart v1-->';
  var NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  var CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
  var CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function J(w, j) { return global.SOffice && global.SOffice.josa ? global.SOffice.josa(w, j) : w + j; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function colL(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function toNum(t) { if (t == null) return null; if (isNum(t)) return t; var s = String(t).replace(/[,\s]/g, '').replace(/%$/, ''); if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null; var n = parseFloat(s); return isFinite(n) ? n : null; }
  function isPie(t) { return t === 'pie' || t === 'doughnut'; }
  function isBar(t) { return t === 'col' || t === 'colStacked' || t === 'bar' || t === 'barStacked'; }
  function colorOf(sp, i) { var c = sp.series[i] && sp.series[i].color; return c || PALETTE[i % PALETTE.length]; }
  function ptColor(sp, i) { var s0 = sp.series[0] || {}; return (s0.ptColors && s0.ptColors[i]) || PALETTE[i % PALETTE.length]; }

  // ---------------- 기본 모양 ----------------
  function blank(type) {
    return { type: type || 'col', title: '', legend: 'b', catTitle: '', valTitle: '', labels: false, frame: false,
      cats: ['1분기', '2분기', '3분기', '4분기'], series: [{ name: '계열 1', vals: [12, 19, 15, 22] }, { name: '계열 2', vals: [9, 14, 18, 16] }] };
  }
  function sampleFor(type) {
    var sp = blank(type);
    if (isPie(type)) { sp.cats = ['A', 'B', 'C', 'D']; sp.series = [{ name: '비율', vals: [40, 30, 20, 10] }]; sp.legend = 'r'; sp.labels = 'pct'; }
    if (type === 'scatter') { sp.cats = ['1', '2', '3', '4', '5']; sp.series = [{ name: 'Y', vals: [2, 4, 3, 6, 8] }]; sp.legend = ''; }
    return sp;
  }

  // ---------------- 참조(Sheet1!$A$2:$A$5) ----------------
  function quoteSheet(n) { return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : "'" + String(n).replace(/'/g, "''") + "'"; }
  function absRef(sheet, r0, c0, r1, c1) { var a = '$' + colL(c0) + '$' + (r0 + 1); return quoteSheet(sheet) + '!' + (r1 == null || (r0 === r1 && c0 === c1) ? a : a + ':$' + colL(c1) + '$' + (r1 + 1)); }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; }
  function parseRef(f) {
    var m = /^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(String(f || '').trim());
    if (!m) return null;
    var sh = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
    return { sheet: sh, r0: +m[4] - 1, c0: colNum(m[3]), r1: (m[6] ? +m[6] : +m[4]) - 1, c1: m[5] ? colNum(m[5]) : colNum(m[3]) };
  }
  // 통합문서(Sheet1)에 맞는 참조를 계열마다 붙인다(PPT·워드 차트와 새 차트)
  function defaultRefs(sp) {
    var n = sp.cats.length;
    sp.series.forEach(function (s, j) {
      s.refs = { name: absRef('Sheet1', 0, j + 1), val: absRef('Sheet1', 1, j + 1, n, j + 1), cat: absRef('Sheet1', 1, 0, n, 0) };
    });
    return sp;
  }

  // ---------------- 차트 파일 만들기 ----------------
  function strCache(arr) { return '<c:strCache><c:ptCount val="' + arr.length + '"/>' + arr.map(function (v, i) { return '<c:pt idx="' + i + '"><c:v>' + esc(v) + '</c:v></c:pt>'; }).join('') + '</c:strCache>'; }
  function numCache(arr) { return '<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + arr.length + '"/>' + arr.map(function (v, i) { return isNum(v) ? '<c:pt idx="' + i + '"><c:v>' + v + '</c:v></c:pt>' : ''; }).join('') + '</c:numCache>'; }
  function fillX(hex) { return '<a:solidFill><a:srgbClr val="' + hex + '"/></a:solidFill>'; }
  function richTitle(text, rot) {
    return '<c:title><c:tx><c:rich><a:bodyPr' + (rot ? ' rot="-5400000" vert="horz"' : '') + '/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="ko-KR" altLang="en-US"/><a:t>' + esc(text) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>';
  }
  function serXml(sp, j, type) {
    var s = sp.series[j], rf = s.refs || {}, n = sp.cats.length, col = colOf(sp, j, type), x = '<c:ser><c:idx val="' + j + '"/><c:order val="' + j + '"/>';
    x += rf.name ? '<c:tx><c:strRef><c:f>' + esc(rf.name) + '</c:f>' + strCache([s.name == null ? '' : String(s.name)]) + '</c:strRef></c:tx>' : '<c:tx><c:v>' + esc(s.name == null ? '' : s.name) + '</c:v></c:tx>';
    if (type === 'line') x += '<c:spPr><a:ln w="28575" cap="rnd">' + fillX(col) + '<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>' + fillX(col) + '<a:ln w="9525">' + fillX(col) + '</a:ln></c:spPr></c:marker>';
    else if (type === 'scatter') x += '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr>' + fillX(col) + '<a:ln w="9525">' + fillX(col) + '</a:ln></c:spPr></c:marker>';
    else if (isPie(type)) x += '<c:spPr><a:ln w="19050">' + fillX('FFFFFF') + '</a:ln></c:spPr>';
    else x += '<c:spPr>' + fillX(col) + '</c:spPr><c:invertIfNegative val="0"/>';
    if (isPie(type)) for (var i = 0; i < n; i++) x += '<c:dPt><c:idx val="' + i + '"/><c:bubble3D val="0"/><c:spPr>' + fillX(ptColor(sp, i)) + '<a:ln w="19050">' + fillX('FFFFFF') + '</a:ln></c:spPr></c:dPt>';
    var cats = sp.cats.map(String);
    if (type === 'scatter') {
      x += (rf.cat ? '<c:xVal><c:numRef><c:f>' + esc(rf.cat) + '</c:f>' + numCache(sp.cats.map(toNum)) + '</c:numRef></c:xVal>' : '') + '<c:yVal><c:numRef><c:f>' + esc(rf.val) + '</c:f>' + numCache(s.vals) + '</c:numRef></c:yVal><c:smooth val="0"/>';
    } else {
      x += (rf.cat ? '<c:cat><c:strRef><c:f>' + esc(rf.cat) + '</c:f>' + strCache(cats) + '</c:strRef></c:cat>' : '') + '<c:val><c:numRef><c:f>' + esc(rf.val) + '</c:f>' + numCache(s.vals) + '</c:numRef></c:val>';
      if (type === 'line') x += '<c:smooth val="0"/>';
    }
    return x + '</c:ser>';
  }
  function colOf(sp, j) { return colorOf(sp, j); }
  function dLblsXml(sp) {
    if (!sp.labels) return '';
    var pct = sp.labels === 'pct' && isPie(sp.type);
    return '<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="' + (pct ? 0 : 1) + '"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="' + (pct ? 1 : 0) + '"/><c:showBubbleSize val="0"/>' + (isPie(sp.type) ? '<c:showLeaderLines val="1"/>' : '') + '</c:dLbls>';
  }
  function axesXml(sp) {
    var t = sp.type, hb = (t === 'bar' || t === 'barStacked'), grid = '<c:majorGridlines><c:spPr><a:ln w="9525">' + fillX('D9D9D9') + '</a:ln></c:spPr></c:majorGridlines>';
    var tick = '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>';
    if (t === 'scatter') {
      return '<c:valAx><c:axId val="111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' + (sp.catTitle ? richTitle(sp.catTitle, false) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/>' + tick + '<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>' +
        '<c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>' + grid + (sp.valTitle ? richTitle(sp.valTitle, true) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/>' + tick + '<c:crossAx val="111111"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>';
    }
    return '<c:catAx><c:axId val="111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + (hb ? 'l' : 'b') + '"/>' + (sp.catTitle ? richTitle(sp.catTitle, hb) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/>' + tick + '<c:crossAx val="222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + (hb ? 'b' : 'l') + '"/>' + grid + (sp.valTitle ? richTitle(sp.valTitle, !hb) : '') + '<c:numFmt formatCode="General" sourceLinked="1"/>' + tick + '<c:crossAx val="111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  }
  // spec → 차트 XML. o.embed = '(rId)' 이면 딸린 통합문서를 가리키는 externalData 를 넣는다
  function chartXml(sp, o) {
    o = o || {};
    var t = sp.type, ser = '', j;
    for (j = 0; j < sp.series.length; j++) { if (isPie(t) && j > 0) break; ser += serXml(sp, j, t); }
    var plot, ax = '<c:axId val="111111"/><c:axId val="222222"/>', lb = dLblsXml(sp);
    if (isBar(t)) plot = '<c:barChart><c:barDir val="' + ((t === 'bar' || t === 'barStacked') ? 'bar' : 'col') + '"/><c:grouping val="' + ((t === 'colStacked' || t === 'barStacked') ? 'stacked' : 'clustered') + '"/><c:varyColors val="0"/>' + ser + lb + '<c:gapWidth val="80"/>' + ((t === 'colStacked' || t === 'barStacked') ? '<c:overlap val="100"/>' : '') + ax + '</c:barChart>';
    else if (t === 'line') plot = '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + ser + lb + '<c:marker val="1"/>' + ax + '</c:lineChart>';
    else if (t === 'pie') plot = '<c:pieChart><c:varyColors val="1"/>' + ser + lb + '<c:firstSliceAng val="0"/></c:pieChart>';
    else if (t === 'doughnut') plot = '<c:doughnutChart><c:varyColors val="1"/>' + ser + lb + '<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>';
    else if (t === 'scatter') plot = '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' + ser + lb + ax + '</c:scatterChart>';
    else throw new Error('지원하지 않는 차트 종류');
    var legend = sp.legend ? '<c:legend><c:legendPos val="' + sp.legend + '"/><c:overlay val="0"/></c:legend>' : '';
    var frame = sp.frame ? '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525">' + fillX('D9D9D9') + '</a:ln></c:spPr>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + MARK + '<c:chartSpace ' + NS + '><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>' +
      (sp.title ? richTitle(sp.title, false) : '') + '<c:autoTitleDeleted val="' + (sp.title ? 0 : 1) + '"/><c:plotArea><c:layout/>' + plot + (isPie(t) ? '' : axesXml(sp)) + '</c:plotArea>' + legend + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' + frame +
      (o.embed ? '<c:externalData r:id="' + o.embed + '"><c:autoUpdate val="0"/></c:externalData>' : '') + '</c:chartSpace>';
  }

  // ---------------- 딸린 통합문서(PPT·워드 차트용) ----------------
  function workbookBytes(sp, JSZip) {
    var n = sp.cats.length, rows = [], j, i;
    function cs(ref, v) { return v == null || v === '' ? '' : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>'; }
    function cn(ref, v) { return isNum(v) ? '<c r="' + ref + '"><v>' + v + '</v></c>' : ''; }
    var head = ''; for (j = 0; j < sp.series.length; j++) head += cs(colL(j + 1) + '1', sp.series[j].name);
    rows.push('<row r="1">' + head + '</row>');
    for (i = 0; i < n; i++) {
      var r = i + 2, cells = sp.type === 'scatter' ? cn('A' + r, toNum(sp.cats[i])) : cs('A' + r, sp.cats[i]);
      for (j = 0; j < sp.series.length; j++) cells += cn(colL(j + 1) + r, sp.series[j].vals[i]);
      rows.push('<row r="' + r + '">' + cells + '</row>');
    }
    var last = colL(sp.series.length) + (n + 1);
    var z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>');
    z.file('xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:' + last + '"/><sheetData>' + rows.join('') + '</sheetData></worksheet>');
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  // ---------------- 있는 차트 읽기 ----------------
  function kids(n, name) { var o = []; if (!n) return o; for (var c = n.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) o.push(c); return o; }
  function one(n, name) { return kids(n, name)[0] || null; }
  function path(n, names) { for (var i = 0; i < names.length && n; i++) n = one(n, names[i]); return n; }
  function val(n) { return n ? n.getAttribute('val') : null; }
  function cacheOf(ref, num) {                  // strRef/numRef 안의 캐시 → 배열
    if (!ref) return { f: null, vals: [] };
    var f = one(ref, 'f'), cache = one(ref, num ? 'numCache' : 'strCache') || one(ref, num ? 'strCache' : 'numCache'), vals = [];
    if (cache) { var pc = one(cache, 'ptCount'), cnt = pc ? +val(pc) : 0; kids(cache, 'pt').forEach(function (p) { cnt = Math.max(cnt, +p.getAttribute('idx') + 1); }); for (var i = 0; i < cnt; i++) vals.push(null); kids(cache, 'pt').forEach(function (p) { var v = one(p, 'v'); vals[+p.getAttribute('idx')] = v ? v.textContent : null; }); }
    return { f: f ? f.textContent : null, vals: num ? vals.map(toNum) : vals.map(function (v) { return v == null ? '' : v; }) };
  }
  function clrOf(spPr, line) {
    var n = spPr; if (!n) return null;
    if (line) { n = one(n, 'ln'); if (!n) return null; }
    var sf = one(n, 'solidFill'); if (!sf) return null; var c = one(sf, 'srgbClr'); return c ? (val(c) || '').toUpperCase() : null;
  }
  function textOf(t) { var r = path(t, ['tx', 'rich']); if (!r) return ''; var s = '', ts = r.getElementsByTagNameNS('*', 't'); for (var i = 0; i < ts.length; i++) s += ts[i].textContent; return s; }
  function parse(xml) {
    var d = new DOMParser().parseFromString(xml, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) return { ok: false, why: '차트 파일을 읽지 못했습니다' };
    var root = d.documentElement, chart = one(root, 'chart');
    if (!chart) return { ok: false, why: '차트 구조를 알아볼 수 없습니다' };
    var mine = xml.indexOf(MARK) >= 0, bad = null;
    if (one(root, 'userShapes')) bad = '차트 위에 그림·글 상자가 얹힌';
    if (one(chart, 'view3D')) bad = '3차원';
    var pa = one(chart, 'plotArea'); if (!pa) return { ok: false, why: '차트 구조를 알아볼 수 없습니다' };
    var plots = kids(pa).filter(function (c) { return /Chart$/.test(c.localName); });
    if (plots.length !== 1 && !bad) bad = plots.length > 1 ? '종류가 섞인(콤보)' : '비어 있는';
    var info = { ok: !bad, why: bad ? bad + ' 차트는 폰에서 고칠 수 없습니다.' : '', mine: mine };
    if (bad) { info.kind = bad; return info; }
    var pl = plots[0], ln = pl.localName, type = null, grouping = val(one(pl, 'grouping'));
    if (ln === 'barChart') { var dir = val(one(pl, 'barDir')); type = (dir === 'bar' ? 'bar' : 'col'); if (grouping === 'stacked') type += 'Stacked'; else if (grouping === 'percentStacked') bad = '100% 누적'; }
    else if (ln === 'lineChart') { if (grouping && grouping !== 'standard') bad = '누적 꺾은선'; type = 'line'; }
    else if (ln === 'pieChart') type = 'pie';
    else if (ln === 'doughnutChart') type = 'doughnut';
    else if (ln === 'scatterChart') type = 'scatter';
    else bad = (/area/i.test(ln) ? '영역형' : /bubble/i.test(ln) ? '거품형' : /radar/i.test(ln) ? '방사형' : /3D/.test(ln) ? '3차원' : '이 종류(' + ln.replace(/Chart$/, '') + ')의');
    var vAx = kids(pa, 'valAx').length, cAx = kids(pa, 'catAx').length + kids(pa, 'dateAx').length;
    if (!bad && !isPie(type) && (vAx > (type === 'scatter' ? 2 : 1) || cAx > 1)) bad = '보조 축이 있는';
    if (!bad && kids(pa, 'dateAx').length) bad = '날짜 축이 있는';
    var sers = kids(pl, 'ser');
    if (!bad && (!sers.length)) bad = '비어 있는';
    if (!bad && sers.some(function (s) { return one(s, 'trendline') || one(s, 'errBars'); })) bad = '추세선·오차 막대가 있는';
    if (!bad && sers.some(function (s) { var c = one(s, 'cat'); return c && one(c, 'multiLvlStrRef'); })) bad = '항목이 여러 단계인';
    if (bad) { info.ok = false; info.why = bad + ' 차트는 폰에서 고칠 수 없습니다.'; info.kind = bad; return info; }
    var sp = { type: type, title: '', legend: '', catTitle: '', valTitle: '', labels: false, frame: !!path(root, ['spPr', 'solidFill']), cats: [], series: [] };
    var ti = one(chart, 'title'); if (ti && val(one(chart, 'autoTitleDeleted')) !== '1') sp.title = textOf(ti);
    var lg = one(chart, 'legend'); if (lg) sp.legend = (val(one(lg, 'legendPos')) || 'r');
    if (!isPie(type)) {
      var cAxN = kids(pa, 'catAx')[0] || kids(pa, 'valAx')[0], vAxN = kids(pa, 'valAx')[type === 'scatter' ? 1 : 0];
      if (cAxN && one(cAxN, 'title')) sp.catTitle = textOf(one(cAxN, 'title'));
      if (vAxN && one(vAxN, 'title')) sp.valTitle = textOf(one(vAxN, 'title'));
    }
    var dl = [one(pl, 'dLbls')].concat(sers.map(function (s) { return one(s, 'dLbls'); })).filter(Boolean);
    dl.forEach(function (x) { if (val(one(x, 'showVal')) === '1') sp.labels = sp.labels || 'val'; if (val(one(x, 'showPercent')) === '1') sp.labels = 'pct'; });
    if (sp.labels === 'pct' && !isPie(type)) sp.labels = 'val';
    sers.forEach(function (s, j) {
      var tx = one(s, 'tx'), nm = tx ? cacheOf(one(tx, 'strRef'), false) : { f: null, vals: [] }, name = nm.vals.length ? nm.vals[0] : (tx && one(tx, 'v') ? one(tx, 'v').textContent : '계열 ' + (j + 1));
      var refs = { name: nm.f }, sv, cats = null, line = type === 'line';
      if (type === 'scatter') {
        var xv = one(s, 'xVal'), xr = xv ? (one(xv, 'numRef') || one(xv, 'strRef')) : null, xc = cacheOf(xr, true), yv = one(s, 'yVal'), yc = cacheOf(yv ? one(yv, 'numRef') : null, true);
        sv = yc.vals; cats = xc.vals.map(function (v) { return v == null ? '' : String(v); }); refs.cat = xc.f; refs.val = yc.f;
      } else {
        var ct = one(s, 'cat'), cr = ct ? (one(ct, 'strRef') || one(ct, 'numRef')) : null, cc = cacheOf(cr, false), vl = one(s, 'val'), vc = cacheOf(vl ? one(vl, 'numRef') : null, true);
        sv = vc.vals; cats = cc.vals.map(String); refs.cat = cc.f; refs.val = vc.f;
      }
      if (!sp.cats.length) sp.cats = cats; else if (cats.length > sp.cats.length) sp.cats = cats;
      var spPr = one(s, 'spPr'), col = (type === 'line') ? (clrOf(spPr, true) || clrOf(one(one(s, 'marker'), 'spPr'), false)) : (type === 'scatter' ? clrOf(one(one(s, 'marker'), 'spPr'), false) : clrOf(spPr, false));
      var ser = { name: name, vals: sv, color: col || null, refs: refs };
      if (isPie(type)) { ser.ptColors = []; kids(s, 'dPt').forEach(function (p) { ser.ptColors[+val(one(p, 'idx'))] = clrOf(one(p, 'spPr'), false); }); }
      sp.series.push(ser);
    });
    var n = sp.cats.length; sp.series.forEach(function (s) { while (s.vals.length < n) s.vals.push(null); });
    if (n > 60 || sp.series.length > 12) { info.ok = false; info.why = '항목이 아주 많은 차트는 폰에서 고칠 수 없습니다.'; info.kind = '항목이 많은'; }
    info.spec = sp; return info;
  }

  // ---------------- 폰 화면 미리 그리기(SVG) ----------------
  function fmt(v) { if (!isNum(v)) return ''; var a = Math.abs(v); if (a >= 1e6 || (a < 1e-3 && a > 0)) return String(+v.toPrecision(4)); return String(Math.round(v * 1000) / 1000); }
  function nice(min, max, n) {
    if (!(max > min)) { if (max === 0) max = 1; else if (max > 0) min = 0; else max = 0; }
    var step0 = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10)), r = step0 / mag, step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step, t = [];
    for (var v = lo; v <= hi + step * 1e-6; v += step) t.push(Math.round(v / step) * step);
    return { lo: lo, hi: hi, ticks: t };
  }
  function short(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }
  function svg(sp, W, H, o) {
    o = o || {}; W = Math.max(60, Math.round(W)); H = Math.max(50, Math.round(H));
    var fs = Math.max(9, Math.min(18, Math.round(Math.min(W, H) * 0.05))), pad = Math.round(fs * 0.7), t = sp.type, out = [];
    var FONT = 'font-family="Malgun Gothic,Noto Sans KR,Apple SD Gothic Neo,sans-serif"', TXT = '#404040';
    function text(x, y, s, size, anchor, extra) { out.push('<text x="' + Math.round(x * 10) / 10 + '" y="' + Math.round(y * 10) / 10 + '" font-size="' + (size || fs) + '" fill="' + TXT + '" text-anchor="' + (anchor || 'middle') + '" ' + FONT + (extra || '') + '>' + esc(s) + '</text>'); }
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc((sp.title || TYPE_NAME[t] || '차트') + ' 차트') + '">');
    if (sp.frame || o.bg) out.push('<rect x="0.5" y="0.5" width="' + (W - 1) + '" height="' + (H - 1) + '" fill="#fff"' + (sp.frame ? ' stroke="#d9d9d9"' : '') + '/>');
    var L = pad, R = W - pad, T = pad, B = H - pad, i, j, n = sp.cats.length, ns = isPie(t) ? Math.min(1, sp.series.length) : sp.series.length;
    if (sp.title) { text(W / 2, T + fs * 1.15, short(sp.title, Math.floor(W / (fs * 1.0))), Math.round(fs * 1.3), 'middle', ' font-weight="700"'); T += fs * 2.2; }
    var legItems = isPie(t) ? sp.cats.map(function (c, k) { return { n: String(c), c: ptColor(sp, k) }; }) : sp.series.map(function (s, k) { return { n: String(s.name == null ? '' : s.name), c: colorOf(sp, k) }; });
    if (sp.legend && legItems.length) {
      var lp = sp.legend;
      if (lp === 'b' || lp === 't') {
        var avail = W - 2 * pad, per = Math.min(avail / legItems.length, fs * 9), ch = Math.max(2, Math.floor((per - fs * 1.8) / (fs * 0.62))), x0 = W / 2 - per * legItems.length / 2, ly = lp === 'b' ? B - fs * 0.5 : T + fs * 0.9;
        legItems.forEach(function (it, k) { var x = x0 + per * k; out.push('<rect x="' + Math.round(x) + '" y="' + Math.round(ly - fs * 0.75) + '" width="' + Math.round(fs * 0.9) + '" height="' + Math.round(fs * 0.9) + '" fill="#' + it.c + '"/>'); text(x + fs * 1.2, ly, short(it.n, ch), fs, 'start'); });
        if (lp === 'b') B -= fs * 1.9; else T += fs * 1.9;
      } else {
        var mw = 0; legItems.forEach(function (it) { mw = Math.max(mw, Math.min(it.n.length, 10)); });
        var lw = Math.min(W * 0.3, mw * fs * 0.62 + fs * 2.2), lx = lp === 'r' ? R - lw : L, ly0 = (T + B) / 2 - legItems.length * fs * 0.85;
        legItems.forEach(function (it, k) { var y = ly0 + k * fs * 1.7 + fs; out.push('<rect x="' + Math.round(lx) + '" y="' + Math.round(y - fs * 0.75) + '" width="' + Math.round(fs * 0.9) + '" height="' + Math.round(fs * 0.9) + '" fill="#' + it.c + '"/>'); text(lx + fs * 1.2, y, short(it.n, 10), fs, 'start'); });
        if (lp === 'r') R -= lw + pad; else L += lw + pad;
      }
    }
    function lbl(x, y, v, anchor) { text(x, y, v, Math.max(8, fs - 1), anchor || 'middle'); }
    if (isPie(t)) {
      var s0 = sp.series[0], vals = (s0 ? s0.vals : []).map(function (v) { return isNum(v) && v > 0 ? v : 0; }), tot = vals.reduce(function (a, b) { return a + b; }, 0);
      var cx = (L + R) / 2, cy = (T + B) / 2, rad = Math.max(10, Math.min(R - L, B - T) / 2 - (sp.labels ? fs * 1.2 : fs * 0.4));
      if (!(tot > 0)) text(cx, cy, '값이 없습니다', fs);
      else {
        var ang = -Math.PI / 2, hole = t === 'doughnut' ? 0.55 : 0, k0 = vals.filter(function (v) { return v > 0; }).length;
        vals.forEach(function (v, k) {
          if (!(v > 0)) return; var a2 = ang + (v / tot) * Math.PI * 2, col = '#' + ptColor(sp, k);
          if (k0 === 1) { out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + rad + '" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>'); if (hole) out.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + rad * hole + '" fill="' + (sp.frame || o.bg ? '#fff' : '#fff') + '"/>'); }
          else {
            var x1 = cx + rad * Math.cos(ang), y1 = cy + rad * Math.sin(ang), x2 = cx + rad * Math.cos(a2), y2 = cy + rad * Math.sin(a2), lg = (a2 - ang) > Math.PI ? 1 : 0;
            if (hole) { var r2 = rad * hole, x3 = cx + r2 * Math.cos(a2), y3 = cy + r2 * Math.sin(a2), x4 = cx + r2 * Math.cos(ang), y4 = cy + r2 * Math.sin(ang); out.push('<path d="M' + x1 + ' ' + y1 + 'A' + rad + ' ' + rad + ' 0 ' + lg + ' 1 ' + x2 + ' ' + y2 + 'L' + x3 + ' ' + y3 + 'A' + r2 + ' ' + r2 + ' 0 ' + lg + ' 0 ' + x4 + ' ' + y4 + 'Z" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>'); }
            else out.push('<path d="M' + cx + ' ' + cy + 'L' + x1 + ' ' + y1 + 'A' + rad + ' ' + rad + ' 0 ' + lg + ' 1 ' + x2 + ' ' + y2 + 'Z" fill="' + col + '" stroke="#fff" stroke-width="1.5"/>');
          }
          if (sp.labels) { var mid = (ang + a2) / 2, rr = hole ? rad * (1 + hole) / 2 : rad * 0.68; text(cx + rr * Math.cos(mid), cy + rr * Math.sin(mid) + fs * 0.35, sp.labels === 'pct' ? Math.round(v / tot * 100) + '%' : fmt(v), Math.max(8, fs - 1), 'middle', ' fill-opacity="1" style="paint-order:stroke;stroke:#fff;stroke-width:2.5px"'); }
          ang = a2;
        });
      }
      out.push('</svg>'); return out.join('');
    }
    // ---- 축이 있는 차트 ----
    var hb = (t === 'bar' || t === 'barStacked'), stacked = (t === 'colStacked' || t === 'barStacked'), sc = t === 'scatter', xs = sc ? sp.cats.map(toNum) : null;
    var mn = Infinity, mx = -Infinity;
    if (stacked) { for (i = 0; i < n; i++) { var pos = 0, neg = 0; sp.series.forEach(function (s) { var v = s.vals[i]; if (isNum(v)) { if (v >= 0) pos += v; else neg += v; } }); mn = Math.min(mn, neg); mx = Math.max(mx, pos); } }
    else sp.series.forEach(function (s) { s.vals.forEach(function (v) { if (isNum(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }); });
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (!sc) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
    var sy = nice(mn, mx, 5), sx = null;
    if (sc) { var xmn = Infinity, xmx = -Infinity; xs.forEach(function (v) { if (isNum(v)) { xmn = Math.min(xmn, v); xmx = Math.max(xmx, v); } }); if (!isFinite(xmn)) { xmn = 0; xmx = 1; } sx = nice(xmn, xmx, 5); }
    var vtk = sy.ticks.map(fmt), lw2 = Math.max.apply(null, vtk.map(function (s) { return s.length; }).concat([1])) * fs * 0.6;
    var leftT = hb ? sp.catTitle : sp.valTitle, botT = hb ? sp.valTitle : sp.catTitle;      // 가로 막대는 항목 축이 왼쪽, 값 축이 아래
    if (leftT) { text(L + fs * 0.6, (T + B) / 2, leftT, fs, 'middle', ' transform="rotate(-90 ' + (L + fs * 0.6) + ' ' + (T + B) / 2 + ')"'); L += fs * 1.6; }
    if (botT) { text((L + R) / 2, B - fs * 0.2, botT, fs); B -= fs * 1.6; }
    var maxCat = 1; if (!sc) sp.cats.forEach(function (c) { maxCat = Math.max(maxCat, Math.min(String(c).length, 8)); });
    var left, bottom;
    if (hb) { left = L + maxCat * fs * 0.62 + fs * 0.6; bottom = B - fs * 1.7; }
    else { left = L + lw2 + fs * 0.7; bottom = B - fs * 1.7; }
    var right = R - fs * 0.6, top = T + fs * 0.6, pw = right - left, ph = bottom - top;
    if (pw < 20 || ph < 20) { out.push('</svg>'); return out.join(''); }
    function vpx(v) { return hb ? left + (v - sy.lo) / (sy.hi - sy.lo) * pw : bottom - (v - sy.lo) / (sy.hi - sy.lo) * ph; }
    // 눈금선·눈금 글자
    sy.ticks.forEach(function (v, k) {
      var p = vpx(v);
      if (hb) { out.push('<line x1="' + p + '" y1="' + top + '" x2="' + p + '" y2="' + bottom + '" stroke="#d9d9d9"/>'); text(p, bottom + fs * 1.2, vtk[k], fs); }
      else if (sc) { out.push('<line x1="' + left + '" y1="' + p + '" x2="' + right + '" y2="' + p + '" stroke="#d9d9d9"/>'); text(left - fs * 0.4, p + fs * 0.35, vtk[k], fs, 'end'); }
      else { out.push('<line x1="' + left + '" y1="' + p + '" x2="' + right + '" y2="' + p + '" stroke="#d9d9d9"/>'); text(left - fs * 0.4, p + fs * 0.35, vtk[k], fs, 'end'); }
    });
    if (sc) {
      sx.ticks.forEach(function (v) { var px = left + (v - sx.lo) / (sx.hi - sx.lo) * pw; text(px, bottom + fs * 1.2, fmt(v), fs); });
      sp.series.forEach(function (s, k) { var col = '#' + colorOf(sp, k); xs.forEach(function (xv, q) { var v = s.vals[q]; if (!isNum(xv) || !isNum(v)) return; var px = left + (xv - sx.lo) / (sx.hi - sx.lo) * pw, py = vpx(v); out.push('<circle cx="' + px + '" cy="' + py + '" r="' + Math.max(3, fs * 0.4) + '" fill="' + col + '"/>'); if (sp.labels) lbl(px, py - fs * 0.6, fmt(v)); }); });
      out.push('<line x1="' + left + '" y1="' + bottom + '" x2="' + right + '" y2="' + bottom + '" stroke="#999"/><line x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + bottom + '" stroke="#999"/>');
      out.push('</svg>'); return out.join('');
    }
    var band = (hb ? ph : pw) / Math.max(1, n), zero = vpx(0);
    sp.cats.forEach(function (c, q) {
      var ctr = (hb ? bottom - band * (q + 0.5) : left + band * (q + 0.5)), s = String(c);
      if (hb) text(left - fs * 0.4, ctr + fs * 0.35, short(s, 8), fs, 'end'); else text(ctr, bottom + fs * 1.2, short(s, Math.max(2, Math.floor(band / (fs * 0.6)))), fs);
    });
    if (t === 'line') {
      sp.series.forEach(function (s, k) {
        var col = '#' + colorOf(sp, k), pts = [], d = '';
        s.vals.forEach(function (v, q) { if (!isNum(v)) { pts.push(null); return; } pts.push([left + band * (q + 0.5), vpx(v)]); });
        var pen = false; pts.forEach(function (p) { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0] + ' ' + p[1]; pen = true; });
        out.push('<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + Math.max(2, fs * 0.2) + '" stroke-linejoin="round"/>');
        pts.forEach(function (p, q) { if (!p) return; out.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + Math.max(2.5, fs * 0.28) + '" fill="' + col + '"/>'); if (sp.labels) lbl(p[0], p[1] - fs * 0.6, fmt(s.vals[q])); });
      });
    } else {
      var grp = band / 1.8, bw = stacked ? grp : grp / Math.max(1, ns);
      for (i = 0; i < n; i++) {
        var posAcc = 0, negAcc = 0;
        sp.series.forEach(function (s, k) {
          var v = s.vals[i]; if (!isNum(v)) return;
          var a, b; if (stacked) { if (v >= 0) { a = posAcc; b = posAcc + v; posAcc = b; } else { a = negAcc; b = negAcc + v; negAcc = b; } } else { a = 0; b = v; }
          var pa = vpx(a), pb = vpx(b), ctr = hb ? bottom - band * (i + 0.5) : left + band * (i + 0.5), off = stacked ? -grp / 2 : -grp / 2 + bw * k, col = '#' + colorOf(sp, k), rx, ry, rw, rh;
          if (hb) { rx = Math.min(pa, pb); rw = Math.abs(pb - pa); rh = bw; ry = stacked ? ctr - grp / 2 : ctr + grp / 2 - bw * (k + 1); }
          else { rx = ctr + off; rw = bw; ry = Math.min(pa, pb); rh = Math.abs(pb - pa); }
          out.push('<rect x="' + Math.round(rx * 10) / 10 + '" y="' + Math.round(ry * 10) / 10 + '" width="' + Math.max(0.5, Math.round(rw * 10) / 10) + '" height="' + Math.max(0.5, Math.round(rh * 10) / 10) + '" fill="' + col + '"/>');
          if (sp.labels) { if (hb) lbl(stacked ? rx + rw / 2 : (v >= 0 ? rx + rw + fs * 0.3 : rx - fs * 0.3), ry + rh / 2 + fs * 0.35, fmt(v), stacked ? 'middle' : (v >= 0 ? 'start' : 'end')); else lbl(rx + rw / 2, stacked ? ry + rh / 2 + fs * 0.35 : (v >= 0 ? ry - fs * 0.3 : ry + rh + fs), fmt(v)); }
        });
      }
    }
    // 축 선
    if (hb) out.push('<line x1="' + zero + '" y1="' + top + '" x2="' + zero + '" y2="' + bottom + '" stroke="#999"/>'); else out.push('<line x1="' + left + '" y1="' + zero + '" x2="' + right + '" y2="' + zero + '" stroke="#999"/>');
    out.push('</svg>'); return out.join('');
  }

  // ---------------- 「차트 넣기·고치기」 시트 ----------------
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // o: { ctx, title, spec, mode:'table'|'range', applyLabel, note, onApply(spec)→false 면 시트 유지, onDelete(), range:{ text, resolve(opts)→{err}|{cats,series,text}, fromSelection()→같은 값, locked } }
  function openEditor(o) {
    var ctx = o.ctx, sp = clone(o.spec), table = o.mode !== 'range', dirtyData = false, W = 6;
    var body = el('div', 'soc'), prev = el('div', 'soc-prev'), colors = el('div', 'soc-colors'), rangeBox = el('div', 'soc-range'), tblBox = el('div', 'soc-tblbox');
    function ensureSeries() { while (sp.series.length < 1) sp.series.push({ name: '계열 1', vals: sp.cats.map(function () { return null; }) }); sp.series.forEach(function (s) { while (s.vals.length < sp.cats.length) s.vals.push(null); s.vals.length = sp.cats.length; }); }
    function drawPrev() { var w = Math.min(520, Math.max(240, (prev.clientWidth || 340))); prev.innerHTML = svg(sp, w, Math.round(w * 0.62), { bg: true }); }
    function label(t) { body.appendChild(el('div', 'soc-l', t)); }
    function chips(list, cur, fn, cls) { var r = el('div', 'soc-r' + (cls ? ' ' + cls : '')); list.forEach(function (it) { var b = el('button', 'soc-b' + (it[0] === cur ? ' on' : ''), it[1]); b.type = 'button'; b.onclick = function () { fn(it[0]); }; r.appendChild(b); }); return r; }
    function field(ph, v, fn, max) { var i = el('input', 'soc-in'); i.type = 'text'; i.placeholder = ph; i.value = v || ''; i.maxLength = max || 60; i.setAttribute('aria-label', ph); i.addEventListener('input', function () { fn(i.value); drawPrev(); }); return i; }
    var typeBox = el('div'), lgBox = el('div'), lbBox = el('div'), axBox = el('div');
    function paintChips() {
      typeBox.innerHTML = ''; typeBox.appendChild(chips(TYPES, sp.type, function (k) { setType(k); }, 'g2'));
      lgBox.innerHTML = ''; lgBox.appendChild(chips([['', '없음'], ['b', '아래'], ['r', '오른쪽'], ['t', '위'], ['l', '왼쪽']], sp.legend || '', function (k) { sp.legend = k; paintChips(); drawPrev(); }));
      lbBox.innerHTML = ''; lbBox.appendChild(chips(isPie(sp.type) ? [['', '없음'], ['val', '값'], ['pct', '비율(%)']] : [['', '없음'], ['val', '값']], sp.labels || '', function (k) { sp.labels = k || false; paintChips(); drawPrev(); }));
      axBox.style.display = isPie(sp.type) ? 'none' : '';
    }
    function setType(k) {
      var was = sp.type; sp.type = k;
      if (isPie(k) && sp.labels === 'val' && !isPie(was)) { /* 값 그대로 */ }
      if (!isPie(k) && sp.labels === 'pct') sp.labels = 'val';
      if (table) buildTable();
      paintChips(); paintColors(); drawPrev();
    }
    function paintColors() {
      colors.innerHTML = '';
      var targets = isPie(sp.type) ? sp.cats.slice(0, 12).map(function (c, k) { return { n: String(c) || ('항목 ' + (k + 1)), cur: ptColor(sp, k), set: function (h) { var s0 = sp.series[0]; s0.ptColors = s0.ptColors || []; s0.ptColors[k] = h; } }; })
        : sp.series.map(function (s, k) { return { n: String(s.name) || ('계열 ' + (k + 1)), cur: colorOf(sp, k), set: function (h) { s.color = h; } }; });
      targets.forEach(function (tg) {
        var row = el('div', 'soc-crow'); row.appendChild(el('span', 'soc-cn', tg.n));
        PALETTE.forEach(function (h) { var b = el('button', 'soc-sw' + (h === tg.cur ? ' on' : '')); b.type = 'button'; b.style.background = '#' + h; b.setAttribute('aria-label', tg.n + ' 색 ' + h); b.onclick = function () { tg.set(h); paintColors(); drawPrev(); }; row.appendChild(b); });
        colors.appendChild(row);
      });
    }
    // ---- 작은 표(PPT·워드) ----
    function buildTable() {
      tblBox.innerHTML = '';
      var sc = el('div', 'soc-tsc'), tb = el('table', 'soc-tbl'), n = sp.cats.length, ns = isPie(sp.type) ? 1 : sp.series.length, i, j;
      function cellIn(v, fn, num, ph) { var t = el('input', 'soc-ti'); t.type = 'text'; t.value = v == null ? '' : v; if (num) t.setAttribute('inputmode', 'decimal'); t.setAttribute('aria-label', ph || ''); t.addEventListener('input', function () { fn(t.value); drawPrev(); }); return t; }
      var hr = el('tr'), h0 = el('th'); h0.appendChild(document.createTextNode(sp.type === 'scatter' ? 'X 값' : '항목')); hr.appendChild(h0);
      for (j = 0; j < ns; j++) { (function (jj) { var th = el('th'); th.appendChild(cellIn(sp.series[jj].name, function (v) { sp.series[jj].name = v; paintColors(); }, false, '이름')); hr.appendChild(th); })(j); }
      tb.appendChild(hr);
      for (i = 0; i < n; i++) {
        (function (ii) {
          var tr = el('tr'), td = el('td'); td.appendChild(cellIn(sp.cats[ii], function (v) { sp.cats[ii] = v; if (isPie(sp.type)) paintColors(); }, sp.type === 'scatter', sp.type === 'scatter' ? 'X 값' : '항목 이름')); tr.appendChild(td);
          for (var jj = 0; jj < ns; jj++) (function (j2) { var d = el('td'); d.appendChild(cellIn(sp.series[j2].vals[ii], function (v) { var x = toNum(v); sp.series[j2].vals[ii] = (v.trim() === '' ? null : x); }, true, '값')); tr.appendChild(d); })(jj);
          tb.appendChild(tr);
        })(i);
      }
      sc.appendChild(tb); tblBox.appendChild(sc);
      var g = el('div', 'soc-r');
      function mini(t, fn, dis) { var b = el('button', 'soc-b', t); b.type = 'button'; if (dis) b.disabled = true; b.onclick = function () { fn(); buildTable(); paintColors(); drawPrev(); }; g.appendChild(b); }
      mini('줄 −', function () { if (sp.cats.length > 1) { sp.cats.pop(); sp.series.forEach(function (s) { s.vals.pop(); }); } }, n <= 1);
      mini('줄 ＋', function () { sp.cats.push(''); sp.series.forEach(function (s) { s.vals.push(null); }); }, n >= 12);
      if (!isPie(sp.type)) { mini('칸 −', function () { if (sp.series.length > 1) sp.series.pop(); }, sp.series.length <= 1); mini('칸 ＋', function () { sp.series.push({ name: '계열 ' + (sp.series.length + 1), vals: sp.cats.map(function () { return null; }) }); }, sp.series.length >= 5); }
      tblBox.appendChild(g);
      tblBox.appendChild(el('div', 'soc-note', isPie(sp.type) ? '원·도넛은 첫 번째 열의 값만 그립니다. 줄은 최대 12개.' : sp.type === 'scatter' ? '분산형은 첫 열(X 값)과 각 열(Y 값)의 짝을 점으로 찍습니다. 숫자만 적습니다.' : '줄은 항목(가로 칸), 열은 계열(막대 묶음)입니다. 줄 최대 12개·열 최대 5개. 빈 칸은 비워 둡니다.'));
    }
    // ---- 고른 범위(엑셀) ----
    var rgOpt = { hdrRow: true, hdrCol: true, swap: false }; if (o.range && o.range.opts) { rgOpt.hdrRow = !!o.range.opts.hdrRow; rgOpt.hdrCol = !!o.range.opts.hdrCol; rgOpt.swap = !!o.range.opts.swap; }
    function buildRange() {
      rangeBox.innerHTML = ''; var R = o.range || {};
      rangeBox.appendChild(el('div', 'soc-rt', R.text ? '데이터 범위: ' + R.text : '데이터 범위: 지금 차트가 가리키는 칸 그대로'));
      var list = el('div', 'soc-note'); list.textContent = sp.series.map(function (s, k) { return (k + 1) + '. ' + (s.name || '(이름 없음)'); }).join(' · ') + ' · 항목 ' + sp.cats.length + '개'; rangeBox.appendChild(list);
      if (R.locked) return;
      var g = el('div', 'soc-r');
      function tg(t, key) { var b = el('button', 'soc-b' + (rgOpt[key] ? ' on' : ''), t); b.type = 'button'; b.onclick = function () { rgOpt[key] = !rgOpt[key]; buildRange(); if (R.text) redo(false); }; g.appendChild(b); }
      tg('첫 줄이 이름', 'hdrRow'); tg('첫 열이 항목', 'hdrCol'); tg('줄·열 바꾸기', 'swap'); rangeBox.appendChild(g);
      var g2 = el('div', 'soc-r'), pb = el('button', 'soc-b big', '고른 칸으로 데이터 다시 잡기'); pb.type = 'button'; pb.onclick = function () { redo(true); }; g2.appendChild(pb); rangeBox.appendChild(g2);
      rangeBox.appendChild(el('div', 'soc-note', '시트에서 칸 범위를 고른 채 이 시트를 열고 누르면, 그 범위로 항목·계열을 다시 만듭니다.'));
    }
    function redo(fresh) {
      var R = o.range; if (!R || !R.resolve) return;
      var r = R.resolve({ hdrRow: rgOpt.hdrRow, hdrCol: rgOpt.hdrCol, swap: rgOpt.swap, fresh: !!fresh, type: sp.type });
      if (r && r.err) { ctx.toast(r.err, 4200); return; }
      if (!r) return;
      sp.cats = r.cats; var old = sp.series; sp.series = r.series.map(function (s, k) { var q = old[k]; if (q && q.color && fresh !== 'reset') s.color = q.color; return s; }); R.text = r.text; dirtyData = true;
      buildRange(); paintColors(); drawPrev();
    }
    // ---- 조립 ----
    ensureSeries();
    body.appendChild(prev);
    if (o.note) body.appendChild(el('div', 'soc-note', o.note));
    label('종류'); body.appendChild(typeBox);
    label('제목'); body.appendChild(field('차트 제목(없어도 됩니다)', sp.title, function (v) { sp.title = v; }));
    label('범례(어느 것이 무엇인지 알려 주는 표시)'); body.appendChild(lgBox);
    label('숫자 표시'); body.appendChild(lbBox);
    body.appendChild(axBox); axBox.appendChild(el('div', 'soc-l', '축 제목')); axBox.appendChild(field('가로 축 제목(예: 학기)', sp.catTitle, function (v) { sp.catTitle = v; })); axBox.appendChild(field('세로 축 제목(예: 점수)', sp.valTitle, function (v) { sp.valTitle = v; }));
    label(table ? '데이터' : '데이터(시트의 칸)'); if (table) { body.appendChild(tblBox); buildTable(); } else { body.appendChild(rangeBox); buildRange(); }
    label('색'); body.appendChild(colors);
    paintChips(); paintColors();
    var btns = [{ label: '닫기' }];
    if (o.onDelete) btns.push({ label: '차트 지우기', danger: true, onClick: function () { var r = o.onDelete(); return r; } });
    btns.push({ label: o.applyLabel || '적용', primary: true, onClick: function () {
      ensureSeries();
      if (table) { for (var q = 0; q < sp.cats.length; q++) if (sp.cats[q] == null) sp.cats[q] = ''; var any = sp.series.some(function (s, k) { return (!isPie(sp.type) || k === 0) && s.vals.some(isNum); }); if (!any) { ctx.toast('숫자를 한 칸 이상 적어 주십시오.', 3000); return false; } if (sp.type === 'scatter' && !sp.cats.some(function (c) { return toNum(c) != null; })) { ctx.toast('분산형은 X 값 열에 숫자를 적어 주십시오.', 3200); return false; } }
      var res = o.onApply(sp, { dataChanged: table || dirtyData }); return res;
    } });
    ctx.sheet({ title: o.title || '차트', body: body, wide: true, buttons: btns });
    setTimeout(drawPrev, 60); setTimeout(drawPrev, 400);
  }

  // ---------------- 라이선스·고지용 정보 ----------------
  global.SOChart = {
    PALETTE: PALETTE, TYPES: TYPES, TYPE_NAME: TYPE_NAME, MARK: MARK, CT_CHART: CT_CHART, CT_XLSX: CT_XLSX,
    blank: blank, sampleFor: sampleFor, chartXml: chartXml, parse: parse, svg: svg, workbookBytes: workbookBytes, defaultRefs: defaultRefs,
    parseRef: parseRef, absRef: absRef, colL: colL, toNum: toNum, isNum: isNum, isPie: isPie, openEditor: openEditor, clone: clone
  };
})(window);

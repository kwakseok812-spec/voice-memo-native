/* so-xlsx-struct.js — S-Office 엑셀 편집 보강(O-0861, v10.4): 줄·칸 넣고 빼기 · 칸 서식 · 칸 합치기 · 줄 높이·칸 너비 · 시트 추가/이름/삭제/순서 · 정렬 · 채우기 · 새 엑셀 문서
 * ----------------------------------------------------------------------------
 * 원본 .xlsx(zip)의 XML 을 직접 고친다(SheetJS 로 다시 쓰지 않는다). 고치는 부분만 바뀌고, 그림·차트·피벗·매크로 같은 나머지는 그대로 둔다.
 * 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용). pkg = { read(path)→Promise<string|null>, write(path,str), remove(path), list()→[path] }.
 * 중간에 줄·칸을 넣고 빼는 일은 「안전 검사」를 통과한 문서에서만 한다 — 수식·병합·이름·차트가 가리키는 칸을 옮겨야 하는데, 옮길 수 없는 구조(공유 수식은 풀어서 처리,
 * 그림·차트·엑셀 표·메모가 든 시트, INDIRECT 같은 글자로 만든 참조 등)가 있으면 이유를 쉬운 말로 돌려주고 하지 않는다.
 */
(function (global) {
  'use strict';

  // ============================== 기본 도우미 ==============================
  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unescX(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function attrOf(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function setAttr(tag, name, val) {
    var re = new RegExp('(\\s' + name + '=")[^"]*(")');
    if (re.test(tag)) return tag.replace(re, function (m, a, b) { return a + val + b; });
    return tag.replace(/\s*(\/?>)$/, ' ' + name + '="' + val + '"$1');
  }
  function delAttr(tag, name) { return tag.replace(new RegExp('\\s' + name + '="[^"]*"'), ''); }
  function sameName(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  function quoteSheet(n) { return /^[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^R\d*C\d*$/i.test(n) ? n : "'" + n.replace(/'/g, "''") + "'"; }
  var MAXR = 1048576, MAXC = 16384;

  // ============================== 수식 속 참조 옮기기 ==============================
  // 글자(") 안은 건너뛰고, 「시트!A1」「A1:B5」 꼴 참조만 찾는다. 열만(A:A)·줄만(3:3) 참조는 따로 찾아 막는다.
  var REF_SRC = "\"(?:[^\"]|\"\")*\"|(?<![\\w.$'])(?:(?:'((?:[^']|'')+)'|([A-Za-z_\\u00C0-\\uFFFF][\\w.\\u00C0-\\uFFFF]*))!)?(\\$?)([A-Z]{1,3})(\\$?)(\\d+)(?::(\\$?)([A-Z]{1,3})(\\$?)(\\d+))?(?![\\w(.])";
  function mapRefs(f, ownSheet, cb) {          // cb({sheet, a:{ca,c,ra,r}, b:{...}|null}) → 새 {a,b} 또는 null(그대로) 또는 {err}
    var re = new RegExp(REF_SRC, 'g'), out = '', last = 0, m, err = null;
    while ((m = re.exec(f))) {
      if (m[0].charAt(0) === '"') continue;
      var sheet = m[1] != null ? m[1].replace(/''/g, "'") : (m[2] != null ? m[2] : ownSheet);
      var A = { ca: m[3], c: colNum(m[4]), ra: m[5], r: +m[6] }, B = m[10] != null ? { ca: m[7], c: colNum(m[8]), ra: m[9], r: +m[10] } : null;
      var res = cb({ sheet: sheet, a: A, b: B, q: m[1] != null || m[2] != null });
      if (res && res.err) { err = res.err; break; }
      if (!res) continue;
      var pre = m[0].slice(0, m[0].length - (m[3] + m[4] + m[5] + m[6] + (m[10] != null ? ':' + m[7] + m[8] + m[9] + m[10] : '')).length);
      function one(p) { return p.ca + colName(p.c) + p.ra + p.r; }
      out += f.slice(last, m.index) + pre + one(res.a) + (res.b ? ':' + one(res.b) : '');
      last = m.index + m[0].length;
    }
    if (err) return { err: err };
    return { f: out + f.slice(last) };
  }
  function hasDynamic(f) { return /\b(INDIRECT|OFFSET|ADDRESS)\s*\(/i.test(f.replace(/"(?:[^"]|"")*"/g, '""')); }
  function hasWholeLine(f, axis) {
    var t = f.replace(/"(?:[^"]|"")*"/g, '""');
    return axis === 'row' ? /(?<![\w.$])\$?\d+:\$?\d+(?![\w(.])/.test(t) : /(?<![\w.$])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?![\w(.$\d])/.test(t);
  }
  // 한 줄/칸 번호 v 를 넣기·지우기에 맞춰 옮긴다. 돌려주는 값: 새 번호 | 0(지워짐)
  function shiftN(v, at, n, mode) {
    if (mode === 'ins') return v >= at ? v + n : v;
    if (v < at) return v; if (v >= at + n) return v - n; return 0;
  }
  // 범위(s..e)를 옮긴다 → [s2,e2] | null(통째로 지워짐)
  function shiftSpan(s, e, at, n, mode) {
    if (mode === 'ins') return [s >= at ? s + n : s, e >= at ? e + n : e];
    if (e < at) return [s, e];
    if (s >= at + n) return [s - n, e - n];
    if (s >= at && e <= at + n - 1) return null;
    return [s < at ? s : at, e >= at + n ? e - n : at - 1];
  }
  function shiftRefsInFormula(f, ownSheet, tgt, axis, at, n, mode) {
    if (hasDynamic(f)) return { err: 'dyn' };
    if (hasWholeLine(f, axis)) return { err: 'wholeline' };
    return mapRefs(f, ownSheet, function (r) {
      if (!sameName(r.sheet, tgt)) return null;
      var a = r.a, b = r.b || r.a, key = axis === 'row' ? 'r' : 'c';
      var sp = shiftSpan(Math.min(a[key], b[key]), Math.max(a[key], b[key]), at, n, mode);
      if (!sp) return { err: 'deleted' };
      if (!r.b && mode === 'del' && sp[0] > sp[1]) return { err: 'deleted' };
      if (sp[0] > sp[1]) return { err: 'deleted' };
      var na = Object.assign({}, a), nb = r.b ? Object.assign({}, r.b) : null;
      if (nb) { var lo = a[key] <= b[key]; na[key] = lo ? sp[0] : sp[1]; nb[key] = lo ? sp[1] : sp[0]; } else na[key] = sp[0];
      return { a: na, b: nb };
    });
  }
  // 채우기·공유 수식 풀기: 「$」가 없는 참조만 (dr,dc) 만큼 옮긴다
  function translateFormula(f, ownSheet, dr, dc) {
    return mapRefs(f, ownSheet, function (r) {
      function mv(p) { return { ca: p.ca, c: p.ca ? p.c : p.c + dc, ra: p.ra, r: p.ra ? p.r : p.r + dr }; }
      var na = mv(r.a), nb = r.b ? mv(r.b) : null;
      if (na.r < 1 || na.c < 1 || na.r > MAXR || na.c > MAXC || (nb && (nb.r < 1 || nb.c < 1 || nb.r > MAXR || nb.c > MAXC))) return { err: 'range' };
      return { a: na, b: nb };
    });
  }
  function renameInFormula(f, ownSheet, oldN, newN) {         // 시트 이름을 바꿀 때 「옛이름!」 → 「새이름!」
    var re = new RegExp(REF_SRC, 'g'), out = '', last = 0, m;
    while ((m = re.exec(f))) {
      if (m[0].charAt(0) === '"') continue;
      if (m[1] == null && m[2] == null) continue;
      var sh = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
      if (!sameName(sh, oldN)) continue;
      var qLen = (m[1] != null ? m[1].length + 2 : m[2].length) + 1;
      out += f.slice(last, m.index) + quoteSheet(newN) + '!' + m[0].slice(qLen); last = m.index + m[0].length;
    }
    return out + f.slice(last);
  }
  function refsSheet(f, ownSheet, tgt) { var hit = false; mapRefs(f, ownSheet, function (r) { if (sameName(r.sheet, tgt)) hit = true; return null; }); return hit; }

  // 범위 글자(「A1」「A1:C3」)·여러 범위(공백으로 구분)를 옮긴다 → 글자 | null(전부 지워짐)
  function shiftRangeText(txt, axis, at, n, mode) {
    var parts = String(txt).split(/\s+/).filter(Boolean), outp = [];
    parts.forEach(function (p) {
      var m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(p); if (!m) { outp.push(p); return; }
      var c0 = colNum(m[1]), r0 = +m[2], c1 = m[3] ? colNum(m[3]) : c0, r1 = m[4] ? +m[4] : r0;
      var sp = axis === 'row' ? shiftSpan(r0, r1, at, n, mode) : shiftSpan(c0, c1, at, n, mode);
      if (!sp || sp[0] > sp[1]) return;
      if (axis === 'row') { r0 = sp[0]; r1 = sp[1]; } else { c0 = sp[0]; c1 = sp[1]; }
      outp.push(colName(c0) + r0 + (c0 === c1 && r0 === r1 ? '' : ':' + colName(c1) + r1));
    });
    return outp.length ? outp.join(' ') : null;
  }

  // ============================== 시트 XML 읽기·쓰기(줄·칸 단위) ==============================
  function parseSheet(xml) {
    var m = /<sheetData\b[^>]*?(\/?)>/.exec(xml); if (!m) return null;
    var self = m[1] === '/', bodyStart = m.index + m[0].length, end = self ? bodyStart : xml.indexOf('</sheetData>', bodyStart); if (end < 0) return null;
    var sd = { head: xml.slice(0, m.index), open: self ? m[0].replace(/\/>$/, '>') : m[0], tail: xml.slice(self ? bodyStart : end + 12), rows: [] };
    var body = self ? '' : xml.slice(bodyStart, end), rr = /<row\b[^>]*?(\/?)>/g, rm;
    while ((rm = rr.exec(body))) {
      var open = rm[0], rowSelf = rm[1] === '/', inner = '';
      if (rowSelf) open = open.replace(/\s*\/>$/, '>');
      else { var ce = body.indexOf('</row>', rm.index + rm[0].length); if (ce < 0) return null; inner = body.slice(rm.index + rm[0].length, ce); rr.lastIndex = ce + 6; }
      var row = { r: +attrOf(open, 'r'), open: open, cells: [] };
      if (!row.r) return null;
      var cr = /<c\b[^>]*?(\/?)>/g, cm;
      while ((cm = cr.exec(inner))) {
        var raw = cm[0];
        if (cm[1] !== '/') { var e = inner.indexOf('</c>', cm.index + cm[0].length); if (e < 0) return null; raw = inner.slice(cm.index, e + 4); cr.lastIndex = e + 4; }
        var ref = /\sr="([A-Z]+)(\d+)"/.exec(raw); if (!ref) return null;
        row.cells.push({ c: colNum(ref[1]), raw: raw });
      }
      sd.rows.push(row);
    }
    return sd;
  }
  function serializeSheet(sd) {
    var out = [sd.head, sd.open];
    sd.rows.forEach(function (row) { out.push(row.open, row.cells.map(function (c) { return c.raw; }).join(''), '</row>'); });
    out.push('</sheetData>', sd.tail); return out.join('');
  }
  function getRow(sd, r, create) {
    var lo = 0, hi = sd.rows.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (sd.rows[mid].r < r) lo = mid + 1; else hi = mid; }
    if (lo < sd.rows.length && sd.rows[lo].r === r) return sd.rows[lo];
    if (!create) return null;
    var row = { r: r, open: '<row r="' + r + '">', cells: [] }; sd.rows.splice(lo, 0, row); return row;
  }
  function openTagOfCell(raw) { return /^<c\b[^>]*>/.exec(raw)[0]; }
  function cellStyleOf(raw) { var s = attrOf(openTagOfCell(raw), 's'); return s == null ? 0 : +s; }
  function setCellAttr(cell, name, val) { var ot = openTagOfCell(cell.raw); cell.raw = setAttr(ot, name, val) + cell.raw.slice(ot.length); }
  function getCell(row, c, create, ref) {
    var lo = 0, hi = row.cells.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (row.cells[mid].c < c) lo = mid + 1; else hi = mid; }
    if (lo < row.cells.length && row.cells[lo].c === c) return row.cells[lo];
    if (!create) return null;
    var cell = { c: c, raw: '<c r="' + colName(c) + row.r + '"/>' }; row.cells.splice(lo, 0, cell); return cell;
  }
  function renumberCell(cell, newRow, newCol) {
    cell.raw = cell.raw.replace(/^(<c\b[^>]*?\sr=")([A-Z]+)(\d+)(")/, function (m, a, col, row, d) { return a + (newCol ? colName(newCol) : col) + (newRow || row) + d; });
    if (newCol) cell.c = newCol;
  }
  function renumberRow(row, newR) {
    row.r = newR; row.open = setAttr(row.open, 'r', String(newR));
    row.cells.forEach(function (c) { renumberCell(c, newR, 0); });
  }
  function dimensionOf(sd) {
    var r0 = 0, r1 = 0, c0 = 0, c1 = 0;
    sd.rows.forEach(function (row) { row.cells.forEach(function (c) { if (!r0 || row.r < r0) r0 = row.r; if (row.r > r1) r1 = row.r; if (!c0 || c.c < c0) c0 = c.c; if (c.c > c1) c1 = c.c; }); });
    if (!r1) return 'A1';
    var s = colName(c0) + r0, e = colName(c1) + r1; return s === e ? s : s + ':' + e;
  }
  function setDimension(xml, dim) {
    if (/<dimension\b/.test(xml)) return xml.replace(/<dimension\s+ref="[^"]*"\s*\/>/, '<dimension ref="' + dim + '"/>');
    return xml.replace(/(<worksheet\b[^>]*>(?:<sheetPr\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetPr>))?)/, '$1<dimension ref="' + dim + '"/>');
  }
  // 워크시트 자식 순서표 — 새 요소를 끼워 넣을 자리를 정한다
  var WS_ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
  function elemEnd(xml, name, from) {
    var re = new RegExp('<' + name + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + name + '>)', 'g'), last = null, m; re.lastIndex = from || 0;
    while ((m = re.exec(xml))) last = m; return last;
  }
  function insertWsElement(xml, name, elemXml) {
    var idx = WS_ORDER.indexOf(name), pos = -1, i;
    for (i = idx - 1; i >= 0 && pos < 0; i--) { var m = elemEnd(xml, WS_ORDER[i]); if (m) pos = m.index + m[0].length; }
    if (pos < 0) { var wm = /<worksheet\b[^>]*>/.exec(xml); pos = wm.index + wm[0].length; }
    return xml.slice(0, pos) + elemXml + xml.slice(pos);
  }

  // ============================== 꾸러미(pkg) 도우미 ==============================
  function wbInfo(pkg) {
    return Promise.all([pkg.read('xl/workbook.xml'), pkg.read('xl/_rels/workbook.xml.rels'), pkg.read('[Content_Types].xml')]).then(function (a) {
      var wb = a[0], rels = a[1], ct = a[2]; if (!wb || !rels) return null;
      var rel = {};
      (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) {
        var id = attrOf(t, 'Id'), tg = attrOf(t, 'Target'); if (!id || tg == null) return;
        var p = tg.charAt(0) === '/' ? tg.slice(1) : 'xl/' + tg, parts = [];
        p.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x); });
        rel[id] = { path: parts.join('/'), type: attrOf(t, 'Type') || '' };
      });
      var sheets = [];
      (wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t, i) {
        var rid = (/\s(?:\w+:)id="([^"]+)"/.exec(t) || [])[1], rr = rid && rel[rid];
        sheets.push({ name: unescX(attrOf(t, 'name') || ''), tag: t, rid: rid, path: rr && /\/worksheet$/.test(rr.type) ? rr.path : null, idx: i, state: attrOf(t, 'state') });
      });
      return { wb: wb, rels: rels, ct: ct, rel: rel, sheets: sheets };
    });
  }
  function readSheets(pkg, info) {     // 모든 워크시트 XML 을 읽어 info.sheets[i].xml 에 둔다
    return Promise.all(info.sheets.map(function (s) { return s.path ? pkg.read(s.path).then(function (x) { s.xml = x; }) : null; }));
  }
  function relTypesOf(pkg, path) {
    var rp = path.replace(/([^\/]+)$/, '_rels/$1.rels');
    return pkg.read(rp).then(function (x) { return x ? (x.match(/<Relationship\b[^>]*>/g) || []).map(function (t) { return (attrOf(t, 'Type') || '').replace(/^.*\//, ''); }) : []; });
  }
  // 수식 글자들을 모두 훑는다: cb(text, ownSheetName) → 새 글자 | {err} | undefined(그대로)
  function eachFormula(xml, ownSheet, cb) {
    var err = null, out = xml.replace(/<f\b([^>]*)>([^<]*)<\/f>/g, function (all, at, txt) {
      if (err) return all;
      var r = cb(unescX(txt), ownSheet, at); if (r == null) return all;
      if (typeof r === 'object') { err = r.err; return all; }
      return '<f' + at + '>' + escX(r) + '</f>';
    });
    return err ? { err: err } : { xml: out };
  }
  function expandShared(xml, ownSheet) {            // 공유 수식을 칸마다 적은 수식으로 푼다
    if (!/t="shared"/.test(xml)) return { xml: xml };
    var masters = {}, re = /<c\b[^>]*\sr="([A-Z]+)(\d+)"[^>]*>(?:(?!<\/c>)[\s\S])*?<f\b[^>]*?t="shared"[^>]*?>([^<]+)<\/f>/g, m;
    while ((m = re.exec(xml))) { var ft = /<f\b[^>]*>/.exec(m[0])[0], si = attrOf(ft, 'si'); if (si != null) masters[si] = { col: colNum(m[1]), row: +m[2], f: unescX(m[3]) }; }
    var err = null;
    var out = xml.replace(/<c\b([^>]*?)\sr="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g, function (all, a1, col, row, a2, inner) {
      if (err || inner.indexOf('t="shared"') < 0) return all;
      var fm = /<f\b([^>]*?)(\/?)>(?:([^<]*)<\/f>)?/.exec(inner); if (!fm || attrOf(' ' + fm[1], 't') !== 'shared') return all;
      var si = attrOf(' ' + fm[1], 'si'), ms = masters[si]; if (!ms) { err = 'shared'; return all; }
      var tr = translateFormula(ms.f, ownSheet, +row - ms.row, colNum(col) - ms.col);
      if (tr.err) { err = 'shared'; return all; }
      var nf = '<f>' + escX(tr.f) + '</f>';
      return '<c' + a1 + ' r="' + col + row + '"' + a2 + '>' + inner.replace(fm[0], nf) + '</c>';
    });
    return err ? { err: err } : { xml: out };
  }

  // ============================== 줄·칸 넣고 빼기 ==============================
  var WHY = {
    obj: '이 시트에는 그림·차트·엑셀 표·메모 같은 개체가 있어서, 중간에 줄이나 칸을 넣고 빼면 그 개체가 어긋날 수 있습니다.',
    objdel: '이 시트에는 그림·차트가 있어서, 줄이나 칸을 지우면 그림·차트가 어긋날 수 있습니다. 넣기만 할 수 있습니다.',
    chart: '차트가 이 시트의 칸을 가리키고 있어서, 중간에 줄이나 칸을 넣고 빼면 차트가 어긋날 수 있습니다.',
    dyn: '칸 주소를 글자로 조합해서 찾아가는 수식(주소를 문자로 만들어 쓰는 함수)이 있어서, 중간에 줄이나 칸을 넣고 빼면 숫자가 어긋날 수 있습니다.',
    wholeline: '줄 전체나 칸 전체를 가리키는 수식이 있어서 중간에 넣고 빼기가 어렵습니다.',
    deleted: '수식이 지우려는 칸을 직접 쓰고 있어서, 지우면 계산이 깨집니다. 수식을 먼저 고쳐 주십시오.',
    shared: '수식 구조가 특이해서 중간에 줄이나 칸을 넣고 빼기가 어렵습니다.',
    cf: '조건 색칠이나 입력 제한이 칸 주소를 쓰고 있어서, 중간에 줄이나 칸을 넣고 빼면 어긋날 수 있습니다.',
    breaks: '쪽 나누기 표시가 있어서 중간에 줄이나 칸을 넣고 빼기가 어렵습니다.',
    sheet: '이 시트를 찾지 못했습니다.',
    range: '수식 계산 중 범위를 벗어나는 칸이 생겨서 할 수 없습니다.'
  };
  // 줄·칸을 넣고 뺄 때 스파크라인(xm:f 데이터 범위 · xm:sqref 놓인 칸)을 같이 옮긴다. 지워지는 칸의 스파크라인은 함께 없앤다
  function shiftSparkXml(xml, isTgt, tgtName, axis, at, n, mode) {
    if (xml.indexOf('x14:sparkline>') < 0) return { xml: xml };
    var err = null, out = xml.replace(/<x14:sparkline>([\s\S]*?)<\/x14:sparkline>/g, function (all, inner) {
      if (err) return all;
      var f = /<xm:f>([^<]*)<\/xm:f>/.exec(inner), q = /<xm:sqref>([^<]*)<\/xm:sqref>/.exec(inner); if (!f || !q) return all;
      var ns = q[1];
      if (isTgt) { var r = shiftRangeText(q[1], axis, at, n, mode); if (!r) return ''; ns = r; }
      var sr = shiftRefsInFormula(unescX(f[1]), '', tgtName, axis, at, n, mode);
      if (sr.err) { if (sr.err === 'deleted') return ''; err = sr.err; return all; }
      return '<x14:sparkline><xm:f>' + escX(sr.f) + '</xm:f><xm:sqref>' + ns + '</xm:sqref></x14:sparkline>';
    });
    if (err) return { err: err };
    out = out.replace(/<x14:sparklineGroup\b[^>]*>[\s\S]*?<\/x14:sparklineGroup>/g, function (g) { return g.indexOf('<x14:sparkline>') < 0 ? '' : g; });
    if (out.indexOf('<x14:sparklineGroup') < 0) out = out.replace(/<ext\b[^>]*uri="\{05C60535-1F16-4fd2-B633-F4F36F0B64E0\}"[^>]*>[\s\S]*?<\/ext>/, '').replace(/<extLst>\s*<\/extLst>/, '');
    return { xml: out };
  }
  // 피벗 표의 원본 범위(캐시 정의의 worksheetSource)도 줄·칸에 맞춰 옮긴다. 원본이 통째로 지워지면 멈춘다. 돌려주는 값: Promise<오류 글자|null>
  function shiftPivotSources(pkg, tgtName, axis, at, n, mode, apply) {
    var cps = pkg.list().filter(function (p) { return /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(p); });
    return Promise.all(cps.map(function (cp) {
      return pkg.read(cp).then(function (cx) {
        if (!cx) return null; var m = /<worksheetSource\b[^>]*>/.exec(cx); if (!m) return null;
        var sh = attrOf(m[0], 'sheet'), rf = attrOf(m[0], 'ref'); if (sh == null || rf == null || !sameName(unescX(sh), tgtName)) return null;
        var r = shiftRangeText(rf, axis, at, n, mode), om = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(rf), nm2 = r && /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r);
        var gone = !r || !nm2 || (nm2 && (+nm2[4] - +nm2[2] < 1)) || (om && mode === 'del' && axis === 'row' && at <= +om[2] && at + n - 1 >= +om[2]);      // 원본이 지워지거나 이름 줄이 사라지거나 자료 줄이 안 남으면
        if (gone) return '피벗 표의 원본 자료(이름 줄 포함)가 지워지게 됩니다. 피벗 표를 먼저 지워 주십시오.';
        if (apply && r !== rf) pkg.write(cp, cx.replace(m[0], setAttr(m[0], 'ref', r)));
        return null;
      });
    })).then(function (res) { var e = null; res.forEach(function (x) { if (x && !e) e = x; }); return e; });
  }
  function lineEdit(pkg, sheetName, axis, at, n, mode) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var tgt = null; info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      var cplan = [], dpath = null;
      return readSheets(pkg, info).then(function () { return relTypesOf(pkg, tgt.path); }).then(function (rt) {
        if (rt.some(function (t) { return t !== 'hyperlink' && t !== 'printerSettings' && t !== 'drawing'; })) return { err: WHY.obj, why: 'obj' };
        if (rt.indexOf('drawing') >= 0 && mode !== 'ins') return { err: WHY.objdel, why: 'obj' };
        // 이 시트의 칸을 가리키는 차트가 있으면 막는다
        var chartP = pkg.list().filter(function (p) { return /^xl\/charts\/chart[^\/]*\.xml$/.test(p); });
        return Promise.all(chartP.map(function (p) { return pkg.read(p); })).then(function (cs) {
          for (var i = 0; i < cs.length; i++) {
            var fs = (cs[i] || '').match(/<c:f>[^<]*<\/c:f>/g) || [];
            if (!fs.some(function (t) { return refsSheet(unescX(t.replace(/<\/?c:f>/g, '')), '', tgt.name); })) continue;
            if (mode !== 'ins') return { err: WHY.chart, why: 'chart' };
            var cerr = null, cx = cs[i].replace(/<c:f>([^<]*)<\/c:f>/g, function (all, tx) {
              if (cerr) return all; var r = shiftRefsInFormula(unescX(tx), '', tgt.name, axis, at, n, mode); if (r.err) { cerr = r.err; return all; } return '<c:f>' + escX(r.f) + '</c:f>';
            });
            if (cerr) return { err: WHY[cerr] || WHY.chart, why: cerr };
            cplan.push({ p: chartP[i], xml: cx });
          }
          return rt.indexOf('drawing') >= 0 ? drawingPathOf(pkg, tgt.path).then(function (dp) { dpath = dp; return null; }) : null;
        });
      }).then(function (blk) {
        if (blk) return blk;
        // 수식 풀기·옮기기(모든 시트)
        var plan = [], i, s;
        for (i = 0; i < info.sheets.length; i++) {
          s = info.sheets[i]; if (!s.path || s.xml == null) continue;
          var ex = expandShared(s.xml, s.name); if (ex.err) return { err: WHY.shared, why: 'shared' };
          if (s === tgt && mode === 'del') {        // 지워질 줄·칸 안의 수식은 어차피 사라지므로, 먼저 걷어 낸 뒤 남는 수식만 검사한다
            var d0 = parseSheet(ex.xml); if (!d0) return { err: WHY.sheet };
            if (axis === 'row') d0.rows = d0.rows.filter(function (row) { return row.r < at || row.r >= at + n; });
            else d0.rows.forEach(function (row) { row.cells = row.cells.filter(function (c) { return c.c < at || c.c >= at + n; }); });
            ex = { xml: serializeSheet(d0) };
          }
          if (/t="(array|dataTable)"/.test(ex.xml)) return { err: WHY.shared, why: 'shared' };
          var ed = eachFormula(ex.xml, s.name, function (t, own) { var r = shiftRefsInFormula(t, own, tgt.name, axis, at, n, mode); return r.err ? { err: r.err } : (r.f === t ? null : r.f); });
          if (ed.err) return { err: WHY[ed.err] || WHY.shared, why: ed.err };
          plan.push({ s: s, xml: ed.xml });
        }
        // 이름 정의(범위 이름 · 인쇄 영역)
        var wbx = info.wb, nerr = null;
        wbx = wbx.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, function (all, o, txt, c) {
          if (nerr) return all;
          var r = shiftRefsInFormula(unescX(txt), '', tgt.name, axis, at, n, mode); if (r.err) { nerr = r.err; return all; }
          return o + escX(r.f) + c;
        });
        if (nerr) return { err: WHY[nerr] || WHY.shared, why: nerr };
        // 대상 시트 본문
        var tp = null; plan.forEach(function (p) { if (p.s === tgt) tp = p; });
        var xml = tp.xml, sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        if (new RegExp('<' + (axis === 'row' ? 'rowBreaks' : 'colBreaks') + '\\b').test(xml)) return { err: WHY.breaks, why: 'breaks' };
        var cfok = true;
        (xml.match(/<(?:formula|formula1|formula2)>[^<]*<\/(?:formula|formula1|formula2)>/g) || []).forEach(function (t) { var tx = unescX(t.replace(/<\/?formula\d?>/g, '')); if (mapRefsHit(tx)) cfok = false; });
        if (!cfok) return { err: WHY.cf, why: 'cf' };
        // 줄·칸 옮기기
        var k;
        if (axis === 'row') {
          var rows = [];
          sd.rows.forEach(function (row) {
            if (mode === 'ins') { if (row.r >= at) renumberRow(row, row.r + n); rows.push(row); }
            else if (row.r < at) rows.push(row); else if (row.r >= at + n) { renumberRow(row, row.r - n); rows.push(row); }
          });
          if (mode === 'ins') {
            // 넣은 줄은 위 줄의 칸 서식을 이어받는다(값은 비움)
            var above = null; rows.forEach(function (r) { if (r.r === at - 1) above = r; });
            for (k = 0; k < n; k++) {
              var nr = { r: at + k, open: '<row r="' + (at + k) + '"' + (above ? above.open.replace(/^<row\b/, '').replace(/\sr="\d+"/, '').replace(/\sspans="[^"]*"/, '').replace(/>$/, '') : '') + '>', cells: [] };
              if (above) above.cells.forEach(function (c) { var s0 = cellStyleOf(c.raw); if (s0) nr.cells.push({ c: c.c, raw: '<c r="' + colName(c.c) + (at + k) + '" s="' + s0 + '"/>' }); });
              rows.push(nr);
            }
            rows.sort(function (a, b) { return a.r - b.r; });
          }
          sd.rows = rows;
        } else {
          sd.rows.forEach(function (row) {
            var cells = [];
            row.cells.forEach(function (c) {
              if (mode === 'ins') { if (c.c >= at) renumberCell(c, 0, c.c + n); cells.push(c); }
              else if (c.c < at) cells.push(c); else if (c.c >= at + n) { renumberCell(c, 0, c.c - n); cells.push(c); }
            });
            row.cells = cells; row.open = delAttr(row.open, 'spans');
          });
        }
        xml = serializeSheet(sd);
        // 병합·하이퍼링크·자동 필터·조건 색칠 범위·입력 제한 범위·칸 너비 정의
        xml = xml.replace(/<mergeCell\b[^>]*?\sref="([^"]*)"[^>]*\/>/g, function (all, ref) { var r = shiftRangeText(ref, axis, at, n, mode); return r && r.indexOf(':') > 0 ? all.replace(ref, r) : ''; });
        xml = xml.replace(/<mergeCells\b[^>]*>\s*<\/mergeCells>/, '').replace(/<mergeCells\b([^>]*?)\scount="\d+"/, function (all, a) { var c = (xml.match(/<mergeCell\b/g) || []).length; return '<mergeCells' + a + ' count="' + c + '"'; });
        xml = xml.replace(/(<(?:hyperlink|autoFilter)\b[^>]*?\sref=")([^"]*)(")/g, function (all, a, ref, c) { var r = shiftRangeText(ref, axis, at, n, mode); return r ? a + r + c : a + ref + c; });
        xml = xml.replace(/(<(?:conditionalFormatting|dataValidation)\b[^>]*?\ssqref=")([^"]*)(")/g, function (all, a, ref, c) { var r = shiftRangeText(ref, axis, at, n, mode); return r ? a + r + c : a + ref + c; });
        if (axis === 'col' && /<cols\b/.test(xml)) {
          xml = xml.replace(/<col\b[^>]*\/>/g, function (t) {
            var mn = +attrOf(t, 'min'), mx = +attrOf(t, 'max'), sp = shiftSpan(mn, mx, at, n, mode);
            if (!sp || sp[0] > sp[1]) return '';
            return setAttr(setAttr(t, 'min', String(sp[0])), 'max', String(sp[1]));
          });
          xml = xml.replace(/<cols\b[^>]*>\s*<\/cols>/, '');
        }
        xml = setDimension(xml, dimensionOf(parseSheet(xml)));
        tp.xml = xml;
        // v10.9 5회차: 스파크라인(칸 주소)과 피벗 표 원본 범위도 같이 옮긴다
        var spErr = null;
        plan.forEach(function (p) { if (spErr) return; var r = shiftSparkXml(p.xml, p.s === tgt, tgt.name, axis, at, n, mode); if (r.err) spErr = r.err; else p.xml = r.xml; });
        if (spErr) return { err: WHY[spErr] || WHY.shared, why: spErr };
        return shiftPivotSources(pkg, tgt.name, axis, at, n, mode, false).then(function (pe0) {         // 먼저 검사만(하나라도 막히면 아무것도 쓰지 않는다)
          if (pe0) return { err: pe0, why: 'pivotsrc' };
          plan.forEach(function (p) { pkg.write(p.s.path, p.xml); });
          cplan.forEach(function (c) { pkg.write(c.p, c.xml); });
          return shiftPivotSources(pkg, tgt.name, axis, at, n, mode, true).then(function () {
            if (dpath) return pkg.read(dpath).then(function (dx) { if (dx) pkg.write(dpath, shiftAnchors(dx, axis, at, n)); pkg.write('xl/workbook.xml', wbx); return { ok: true }; });
            pkg.write('xl/workbook.xml', wbx);
            return { ok: true };
          });
        });
      });
    });
    function mapRefsHit(t) { return new RegExp(REF_SRC).test(t.replace(/"(?:[^"]|"")*"/g, '""')); }
  }
  // 맨 끝에 줄 붙이기: 참조를 옮길 일이 없어 언제나 된다. 마지막 줄의 칸 서식을 이어받는다.
  function appendRows(pkg, sheetName, n) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var last = sd.rows.length ? sd.rows[sd.rows.length - 1] : null, base = last ? last.r : 0;
        if (base + n > MAXR) return { err: '더 이상 줄을 넣을 수 없습니다.' };
        for (var k = 1; k <= n; k++) {
          var nr = { r: base + k, open: '<row r="' + (base + k) + '"' + (last ? last.open.replace(/^<row\b/, '').replace(/\sr="\d+"/, '').replace(/\sspans="[^"]*"/, '').replace(/>$/, '') : '') + '>', cells: [] };
          if (last) last.cells.forEach(function (c) { var s0 = cellStyleOf(c.raw); if (s0) nr.cells.push({ c: c.c, raw: '<c r="' + colName(c.c) + (base + k) + '" s="' + s0 + '"/>' }); });
          sd.rows.push(nr);
        }
        var out = serializeSheet(sd); out = setDimension(out, dimensionOf(parseSheet(out))); pkg.write(tgt.path, out);
        return { ok: true, firstRow: base + 1 };
      });
    });
  }

  // ============================== 칸 서식(styles.xml) ==============================
  function Styles(xml) {
    this.xml = xml; this.cache = {};
    function sect(name) { var m = new RegExp('<' + name + '\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + name + '>)').exec(xml); return m ? { whole: m[0], inner: m[1] || '' } : null; }
    function items(inner, tag) { var re = new RegExp('<' + tag + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + tag + '>)', 'g'); return inner.match(re) || []; }
    var f = sect('fonts'), fl = sect('fills'), b = sect('borders'), cx = sect('cellXfs'), nf = sect('numFmts');
    this.hasAll = !!(f && fl && b && cx);
    if (!this.hasAll) return;
    this.sec = { fonts: f, fills: fl, borders: b, cellXfs: cx, numFmts: nf };
    this.fonts = items(f.inner, 'font'); this.fills = items(fl.inner, 'fill'); this.borders = items(b.inner, 'border'); this.xfs = items(cx.inner, 'xf');
    this.nfs = nf ? items(nf.inner, 'numFmt') : [];
    this.base = { fonts: this.fonts.length, fills: this.fills.length, borders: this.borders.length, xfs: this.xfs.length, nfs: this.nfs.length };
  }
  Styles.prototype.add = function (listName, s) { var l = this[listName], i = l.indexOf(s); if (i < 0) { l.push(s); i = l.length - 1; } return i; };
  Styles.prototype.nfId = function (code) {
    var B = { 'General': 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 };
    if (B[code] != null) return B[code];
    for (var i = 0; i < this.nfs.length; i++) if (unescX(attrOf(this.nfs[i], 'formatCode') || '') === code) return +attrOf(this.nfs[i], 'numFmtId');
    var mx = 163; this.nfs.forEach(function (t) { mx = Math.max(mx, +attrOf(t, 'numFmtId')); });
    this.nfs.push('<numFmt numFmtId="' + (mx + 1) + '" formatCode="' + escX(code) + '"/>'); return mx + 1;
  };
  function fontKids(f) { var inner = /^<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)$/.exec(f), kids = {}; if (inner && inner[1]) (inner[1].match(/<(\w+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g) || []).forEach(function (k) { kids[/^<(\w+)/.exec(k)[1]] = k; }); return kids; }
  var FONT_ORDER = ['b', 'i', 'strike', 'condense', 'extend', 'outline', 'shadow', 'u', 'vertAlign', 'sz', 'color', 'name', 'family', 'charset', 'scheme'];
  function buildFont(kids) { var s = '<font>'; FONT_ORDER.forEach(function (k) { if (kids[k]) s += kids[k]; }); Object.keys(kids).forEach(function (k) { if (FONT_ORDER.indexOf(k) < 0) s += kids[k]; }); return s + '</font>'; }
  function argb(hex) { return 'FF' + hex.replace('#', '').toUpperCase(); }
  function borderFor(sides) {      // sides: {l,r,t,b} 참/거짓
    function s(n, on) { return on ? '<' + n + ' style="thin"><color auto="1"/></' + n + '>' : '<' + n + '/>'; }
    return '<border>' + s('left', sides.l) + s('right', sides.r) + s('top', sides.t) + s('bottom', sides.b) + '<diagonal/></border>';
  }
  // 칸 서식 번호 s 에 바꿈(ch)을 얹은 새 서식 번호. ch = {bold, italic, color, bg, align, nf, wrap, border:{l,r,t,b}}
  Styles.prototype.derive = function (s, ch) {
    var key = s + '|' + JSON.stringify(ch); if (this.cache[key] != null) return this.cache[key];
    var xf = this.xfs[s] || this.xfs[0], open = /^<xf\b[^>]*>/.exec(xf)[0].replace(/\/>$/, '>'), body = /^<xf\b[^>]*?(?:\/>|>([\s\S]*?)<\/xf>)$/.exec(xf)[1] || '';
    var fontId = +(attrOf(open, 'fontId') || 0), fillId = +(attrOf(open, 'fillId') || 0), borderId = +(attrOf(open, 'borderId') || 0), nfId = +(attrOf(open, 'numFmtId') || 0);
    if (ch.bold != null || ch.italic != null || ch.underline != null || ch.strike != null || ch.color !== undefined || ch.fontName || ch.fontSize) {
      var kids = fontKids(this.fonts[fontId] || '<font/>');
      if (ch.bold != null) { if (ch.bold) kids.b = '<b/>'; else delete kids.b; }
      if (ch.italic != null) { if (ch.italic) kids.i = '<i/>'; else delete kids.i; }
      if (ch.underline != null) { if (ch.underline) kids.u = '<u/>'; else delete kids.u; }
      if (ch.strike != null) { if (ch.strike) kids.strike = '<strike/>'; else delete kids.strike; }
      if (ch.color !== undefined) { if (ch.color) kids.color = '<color rgb="' + argb(ch.color) + '"/>'; else delete kids.color; }
      if (ch.fontName) { kids.name = '<name val="' + escX(ch.fontName) + '"/>'; delete kids.scheme; delete kids.charset; }
      if (ch.fontSize) kids.sz = '<sz val="' + ch.fontSize + '"/>';
      fontId = this.add('fonts', buildFont(kids)); open = setAttr(open, 'applyFont', '1');
    }
    if (ch.bg !== undefined) {
      fillId = ch.bg ? this.add('fills', '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(ch.bg) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
      open = setAttr(open, 'applyFill', '1');
    }
    if (ch.border) { borderId = this.add('borders', borderFor(ch.border)); open = setAttr(open, 'applyBorder', '1'); }
    if (ch.nf != null) { nfId = this.nfId(ch.nf); open = setAttr(open, 'applyNumberFormat', '1'); }
    if (ch.align !== undefined || ch.wrap != null || ch.valign !== undefined) {
      var am = /<alignment\b[^>]*?\/>/.exec(body) || /<alignment\b[^>]*>[\s\S]*?<\/alignment>/.exec(body), al = am ? /^<alignment\b[^>]*?>/.exec(am[0])[0].replace(/\/>$/, '/>') : '<alignment/>';
      if (ch.align !== undefined) al = ch.align ? setAttr(al, 'horizontal', ch.align) : delAttr(al, 'horizontal');
      if (ch.wrap != null) al = ch.wrap ? setAttr(al, 'wrapText', '1') : delAttr(al, 'wrapText');
      if (ch.valign !== undefined) al = ch.valign ? setAttr(al, 'vertical', ch.valign) : delAttr(al, 'vertical');
      body = am ? body.replace(am[0], al) : al + body; open = setAttr(open, 'applyAlignment', '1');
    }
    if (ch.locked !== undefined) { body = body.replace(/<protection\b[^>]*?\/>/, ''); if (ch.locked === false) body += '<protection locked="0"/>'; open = setAttr(open, 'applyProtection', '1'); }
    open = setAttr(setAttr(setAttr(setAttr(open, 'fontId', String(fontId)), 'fillId', String(fillId)), 'borderId', String(borderId)), 'numFmtId', String(nfId));
    var nx = body ? open + body + '</xf>' : open.replace(/>$/, '/>');
    var idx = this.add('xfs', nx); this.cache[key] = idx; return idx;
  };
  Styles.prototype.serialize = function () {
    if (!this.hasAll) return this.xml;
    var x = this.xml, S = this.sec, B = this.base, self = this;
    function rep(name, list, o) { var m = S[name]; if (!m) return; x = x.replace(m.whole, '<' + name + ' count="' + list.length + '"' + (/^<\w+\b([^>]*?)>/.exec(m.whole)[1].replace(/\scount="\d+"/, '').replace(/\/$/, '')) + '>' + list.join('') + '</' + name + '>'); }
    rep('fonts', this.fonts); rep('fills', this.fills); rep('borders', this.borders); rep('cellXfs', this.xfs);
    if (S.numFmts) rep('numFmts', this.nfs);
    else if (this.nfs.length) x = x.replace(/(<styleSheet\b[^>]*>)/, '$1<numFmts count="' + this.nfs.length + '">' + this.nfs.join('') + '</numFmts>');
    return x;
  };
  // 서식 읽기(그리기용): 칸 서식 번호 → { b, i, color, bg, h, wrap, bl, br, bt, bb }
  // rich(스위치 SO_XLSX_FIDELITY): 테마색·색 번호·밝기(tint) 색, 세로 맞춤(v), 들여쓰기(ind), 선 굵기·색(bd)까지 읽는다. 끄면 예전 읽기 그대로.
  var IDX = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
  function tintHex(hex, tint) {            // 엑셀 tint: 밝기(L)만 바꾼다
    var r = parseInt(hex.substr(0, 2), 16) / 255, g = parseInt(hex.substr(2, 2), 16) / 255, b = parseInt(hex.substr(4, 2), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint; l = Math.max(0, Math.min(1, l));
    function f(p, q, t2) { if (t2 < 0) t2 += 1; if (t2 > 1) t2 -= 1; return t2 < 1 / 6 ? p + (q - p) * 6 * t2 : t2 < 0.5 ? q : t2 < 2 / 3 ? p + (q - p) * (2 / 3 - t2) * 6 : p; }
    var R, G, B; if (!s) { R = G = B = l; } else { var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; R = f(p, q, h + 1 / 3); G = f(p, q, h); B = f(p, q, h - 1 / 3); }
    function x(v) { var n = Math.round(v * 255).toString(16); return n.length < 2 ? '0' + n : n; }
    return x(R) + x(G) + x(B);
  }
  Styles.prototype.setTheme = function (xml) {   // theme1.xml → 엑셀 테마 번호 순서(0=밝은1 1=어두운1 2=밝은2 3=어두운2 4~9=강조1~6 10·11=하이퍼링크)
    this.theme = null; this.rc = null; if (!xml) return;
    var sc = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml); if (!sc) return;
    var names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'], out = [];
    for (var i = 0; i < names.length; i++) {
      var m = new RegExp('<a:' + names[i] + '\\b[^>]*>([\\s\\S]*?)</a:' + names[i] + '>').exec(sc[0]), c = null;
      if (m) { var v = /<a:srgbClr\b[^>]*\sval="([0-9A-Fa-f]{6})"/.exec(m[1]) || /<a:sysClr\b[^>]*\slastClr="([0-9A-Fa-f]{6})"/.exec(m[1]); c = v ? v[1].toUpperCase() : null; }
      out.push(c);
    }
    this.theme = out;
  };
  Styles.prototype.colorOf = function (tag) {      // <color …/> · <fgColor …/> 한 개 → '#rrggbb' 또는 ''(자동·모름)
    if (!tag) return '';
    var rgb = /\srgb="([0-9A-Fa-f]{8})"/.exec(tag), hex = '';
    if (rgb) hex = rgb[1].slice(2);
    else {
      var th = attrOf(tag, 'theme'), ix = attrOf(tag, 'indexed');
      if (th != null) hex = (this.theme && this.theme[+th]) || '';
      else if (ix != null) hex = IDX[+ix] || '';
    }
    if (!hex) return '';
    var tn = attrOf(tag, 'tint'); if (tn != null && !isNaN(+tn) && +tn) hex = tintHex(hex, +tn);
    return '#' + hex.toLowerCase();
  };
  var BD_W = { thin: '1px solid', hair: '1px solid', medium: '2px solid', thick: '3px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed', double: '3px double' };
  Styles.prototype.resolve = function (s, rich) {
    if (!this.hasAll) return null;
    var ck = rich ? 'r' : 'p'; if (!this.rc) this.rc = { r: {}, p: {} };
    if (Object.prototype.hasOwnProperty.call(this.rc[ck], s)) return this.rc[ck][s];
    var xf = this.xfs[s]; if (!xf) return null;
    var open = /^<xf\b[^>]*>/.exec(xf)[0], o = {}, self = this;
    var kids = fontKids(this.fonts[+(attrOf(open, 'fontId') || 0)] || '<font/>');
    if (kids.b) o.b = true; if (kids.i) o.i = true; if (kids.u) o.u = true; if (kids.strike) o.st = true;
    var szm = kids.sz && /\sval="([\d.]+)"/.exec(kids.sz); if (szm) o.fs = +szm[1]; var fnm = kids.name && /\sval="([^"]*)"/.exec(kids.name); if (fnm) o.fn = unescX(fnm[1]);
    var fill = this.fills[+(attrOf(open, 'fillId') || 0)] || '';
    if (rich) {
      var cc = this.colorOf(kids.color); if (cc) o.color = cc;
      var fgm = /<patternFill\b[^>]*patternType="solid"[^>]*>\s*(<fgColor\b[^>]*?\/?>)/.exec(fill), fc = fgm ? this.colorOf(fgm[1]) : ''; if (fc) o.bg = fc;
    } else {
      var cm = kids.color && /\srgb="([0-9A-Fa-f]{8})"/.exec(kids.color); if (cm) o.color = '#' + cm[1].slice(2);
      var fm = /<patternFill\b[^>]*patternType="solid"[^>]*>\s*<fgColor\b[^>]*rgb="([0-9A-Fa-f]{8})"/.exec(fill); if (fm) o.bg = '#' + fm[1].slice(2);
    }
    if (/<protection\b[^>]*\slocked="(0|false)"/.test(xf)) o.unlocked = true;
    var am = /<alignment\b[^>]*>/.exec(xf); if (am) {
      var h = attrOf(am[0], 'horizontal'); if (h === 'center' || h === 'left' || h === 'right' || h === 'centerContinuous') o.h = h === 'centerContinuous' ? 'center' : h; if (/wrapText="(1|true)"/.test(am[0])) o.wrap = true;
      if (rich) {
        var vv = attrOf(am[0], 'vertical'); if (vv === 'top' || vv === 'center' || vv === 'bottom') o.v = vv; else if (vv === 'justify' || vv === 'distributed') o.v = 'center';
        var ind = attrOf(am[0], 'indent'); if (ind && +ind > 0 && (o.h === 'left' || !o.h)) o.ind = Math.min(+ind, 10);
      }
    }
    var bd = this.borders[+(attrOf(open, 'borderId') || 0)] || '';
    ['left', 'right', 'top', 'bottom'].forEach(function (side, i) {
      var k = 'lrtb'.charAt(i);
      if (new RegExp('<' + side + '\\b[^>]*\\sstyle="(?!none)').test(bd)) o['b' + k] = true;
      if (rich && o['b' + k]) {
        var sm = new RegExp('<' + side + '\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + side + '>)').exec(bd), sty = attrOf(sm[0], 'style') || 'thin';
        var ct = sm[1] ? /<color\b[^>]*?\/?>/.exec(sm[1]) : null, cl = ct ? self.colorOf(ct[0]) : '';
        o.bd = o.bd || {}; o.bd[k] = (BD_W[sty] || '1px solid') + ' ' + (sty === 'hair' ? '#9a9a9a' : (cl || '#333'));
      }
    });
    this.rc[ck][s] = o; return o;
  };

  // 범위 안 모든 칸에 서식 바꿈을 적용한다. rng = {r0,c0,r1,c1}(1부터)
  function applyStyle(pkg, sheetName, rng, ch) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return Promise.all([pkg.read(tgt.path), pkg.read('xl/styles.xml')]).then(function (a) {
        var sd = parseSheet(a[0]); if (!sd) return { err: WHY.sheet };
        if (!a[1]) return { err: '서식 정보를 찾지 못했습니다.' };
        var st = new Styles(a[1]); if (!st.hasAll) return { err: '이 문서의 서식 정보가 특이해서 폰에서는 서식을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        var area = (rng.r1 - rng.r0 + 1) * (rng.c1 - rng.c0 + 1); if (area > 200000) return { err: '한 번에 서식을 바꿀 수 있는 칸은 20만 칸까지입니다.' };
        for (var r = rng.r0; r <= rng.r1; r++) {
          var row = getRow(sd, r, true);
          for (var c = rng.c0; c <= rng.c1; c++) {
            var cell = getCell(row, c, true), c2 = ch;
            if (ch.borderMode) {
              var m = ch.borderMode, all = m === 'all', outer = m === 'outer';
              c2 = Object.assign({}, ch); delete c2.borderMode;
              c2.border = m === 'none' ? { l: 0, r: 0, t: 0, b: 0 } : { l: all || (outer && c === rng.c0), r: all || (outer && c === rng.c1), t: all || (outer && r === rng.r0), b: all || (outer && r === rng.r1) };
              if (outer) { var cur = st.resolve(cellStyleOf(cell.raw)); if (cur) { c2.border = { l: c2.border.l || !!cur.bl, r: c2.border.r || !!cur.br, t: c2.border.t || !!cur.bt, b: c2.border.b || !!cur.bb }; } }
            }
            setCellAttr(cell, 's', String(st.derive(cellStyleOf(cell.raw), c2)));
          }
        }
        var out = serializeSheet(sd); out = setDimension(out, dimensionOf(parseSheet(out)));
        pkg.write(tgt.path, out); pkg.write('xl/styles.xml', st.serialize());
        return { ok: true };
      });
    });
  }

  // ============================== 칸 합치기 · 줄 높이 · 칸 너비 ==============================
  function mergeCellsOp(pkg, sheetName, rng, unmerge) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var list = (xml.match(/<mergeCell\b[^>]*?\sref="[^"]*"[^>]*\/>/g) || []).map(function (t) { return attrOf(t, 'ref'); }), keep = [], removed = 0;
        function parse(ref) { var m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref); return { c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3]), r1: +m[4] }; }
        list.forEach(function (ref) {
          var m = parse(ref), hit = !(m.r1 < rng.r0 || m.r0 > rng.r1 || m.c1 < rng.c0 || m.c0 > rng.c1);
          if (hit) removed++; else keep.push(ref);
        });
        if (unmerge) { if (!removed) return { err: '합쳐진 칸이 아닙니다.' }; }
        else {
          if (rng.r0 === rng.r1 && rng.c0 === rng.c1) return { err: '합칠 칸을 두 칸 이상 골라 주십시오.' };
          keep.push(colName(rng.c0) + rng.r0 + ':' + colName(rng.c1) + rng.r1);
        }
        xml = xml.replace(/<mergeCells\b[^>]*?(?:\/>|>[\s\S]*?<\/mergeCells>)/, '');
        if (keep.length) xml = insertWsElement(xml, 'mergeCells', '<mergeCells count="' + keep.length + '">' + keep.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') + '</mergeCells>');
        if (!unmerge) {       // 왼쪽 위 칸 값만 남긴다(나머지 칸의 값은 지우고 서식만 둔다)
          var sd = parseSheet(xml), lost = 0;
          for (var r = rng.r0; r <= rng.r1; r++) { var row = getRow(sd, r, false); if (!row) continue; row.cells.forEach(function (c) {
            if (c.c < rng.c0 || c.c > rng.c1 || (r === rng.r0 && c.c === rng.c0)) return;
            if (!/\/>$/.test(c.raw)) { lost++; var s0 = cellStyleOf(c.raw); c.raw = '<c r="' + colName(c.c) + r + '"' + (s0 ? ' s="' + s0 + '"' : '') + '/>'; }
          }); }
          xml = serializeSheet(sd);
          pkg.write(tgt.path, xml); return { ok: true, lost: lost };
        }
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  function setRowHeight(pkg, sheetName, r0, r1, pt) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        for (var r = r0; r <= r1; r++) { var row = getRow(sd, r, true); row.open = pt ? setAttr(setAttr(row.open, 'ht', String(pt)), 'customHeight', '1') : delAttr(delAttr(row.open, 'ht'), 'customHeight'); }
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true };
      });
    });
  }
  function setColWidth(pkg, sheetName, c0, c1, ch) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var cols = (xml.match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attrOf(t, 'min'), max: +attrOf(t, 'max'), tag: t }; }), out = [];
        cols.forEach(function (cl) {            // 겹치는 정의를 잘라 낸다
          if (cl.max < c0 || cl.min > c1) { out.push(cl); return; }
          if (cl.min < c0) out.push({ min: cl.min, max: c0 - 1, tag: setAttr(setAttr(cl.tag, 'min', String(cl.min)), 'max', String(c0 - 1)) });
          if (cl.max > c1) out.push({ min: c1 + 1, max: cl.max, tag: setAttr(setAttr(cl.tag, 'min', String(c1 + 1)), 'max', String(cl.max)) });
        });
        if (ch) out.push({ min: c0, max: c1, tag: '<col min="' + c0 + '" max="' + c1 + '" width="' + ch + '" customWidth="1"/>' });
        out.sort(function (a, b) { return a.min - b.min; });
        xml = xml.replace(/<cols\b[^>]*?(?:\/>|>[\s\S]*?<\/cols>)/, '');
        if (out.length) xml = insertWsElement(xml, 'cols', '<cols>' + out.map(function (x) { return x.tag; }).join('') + '</cols>');
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }

  // ============================== 정렬 · 채우기 ==============================
  // order = 새 위치 순서대로 늘어놓은 옛 줄 번호들(rng.r0.. 순서). 줄이 옮겨 가면 수식 속 상대 참조도 따라간다. 합쳐진 칸이 든 범위는 하지 않는다.
  function sortRows(pkg, sheetName, rng, order) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var xml = ex.xml, sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var i, j, row, ferr = false;
        if ((xml.match(/<mergeCell\b[^>]*?\sref="[^"]*"/g) || []).some(function (t) { var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(attrOf(t, 'ref')); var c0 = colNum(m[1]), r0 = +m[2], c1 = m[3] ? colNum(m[3]) : c0, r1 = m[4] ? +m[4] : r0; return !(r1 < rng.r0 || r0 > rng.r1 || c1 < rng.c0 || c0 > rng.c1); })) return { err: '정렬할 범위에 합쳐진 칸이 있어서 정렬할 수 없습니다. 도구줄 「칸 합치기」의 「합치기 풀기」로 먼저 푼 뒤 정렬하십시오. 합친 채로 정렬해야 하면 「수정 요청」으로 맡겨 주십시오.' };
        var moved = {};
        for (i = rng.r0; i <= rng.r1; i++) {
          row = getRow(sd, i, false); moved[i] = [];
          if (row) { var keep = []; row.cells.forEach(function (c) { if (c.c >= rng.c0 && c.c <= rng.c1) moved[i].push(c); else keep.push(c); }); row.cells = keep; }
        }
        for (i = 0; i < order.length; i++) {
          var nr = rng.r0 + i, tr = getRow(sd, nr, true), src = moved[order[i]] || [];
          src.forEach(function (c) {
            if (/<f\b/.test(c.raw)) c.raw = c.raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at0, txt) {      // 줄이 옮겨 간 만큼 수식 속 상대 참조도 따라간다(엑셀과 같은 방식)
              var tr2 = translateFormula(unescX(txt), tgt.name, nr - order[i], 0); if (tr2.err) { ferr = true; return all; } return '<f' + at0 + '>' + escX(tr2.f) + '</f>';
            });
            renumberCell(c, nr, 0); var at = 0; while (at < tr.cells.length && tr.cells[at].c < c.c) at++; tr.cells.splice(at, 0, c);
          });
        }
        if (ferr) return { err: WHY.range };
        pkg.write(tgt.path, serializeSheet(sd)); return { ok: true };
      });
    });
  }
  // 범위의 첫 줄을 아래 줄들에 채운다(수식은 참조를 줄 수만큼 옮김). 서식도 함께 옮긴다.
  function fillDown(pkg, sheetName, rng) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var srow = getRow(sd, rng.r0, false), err = null, n = 0;
        for (var r = rng.r0 + 1; r <= rng.r1 && !err; r++) {
          var row = getRow(sd, r, true), dr = r - rng.r0;
          for (var c = rng.c0; c <= rng.c1 && !err; c++) {
            var src = srow && getCell(srow, c, false), cell = getCell(row, c, false);
            if (!src) { if (cell) { var i0 = row.cells.indexOf(cell); row.cells.splice(i0, 1); } continue; }
            var raw = src.raw;
            raw = raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at, txt) {
              var tr = translateFormula(unescX(txt), tgt.name, dr, 0); if (tr.err) { err = WHY.range; return all; }
              return '<f' + at + '>' + escX(tr.f) + '</f>';
            }).replace(/<v>[^<]*<\/v>/, function (v) { return /<f\b/.test(raw) ? '' : v; });
            if (/<f\b/.test(raw)) raw = raw.replace(/\st="[^"]*"/, '');
            var nc = { c: c, raw: raw }; renumberCell(nc, r, 0);
            if (cell) row.cells[row.cells.indexOf(cell)] = nc; else { var at2 = 0; while (at2 < row.cells.length && row.cells[at2].c < c) at2++; row.cells.splice(at2, 0, nc); }
            n++;
          }
        }
        if (err) return { err: err };
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n };
      });
    });
  }

  // ============================== 시트 추가 · 이름 · 삭제 · 순서 ==============================
  function checkSheetName(info, name, except) {
    if (!name || !name.trim()) return '시트 이름을 적어 주십시오.';
    if (name.length > 31) return '시트 이름은 31자까지입니다.';
    if (/[\[\]:*?\/\\]/.test(name)) return '시트 이름에는 [ ] : * ? / \\ 글자를 쓸 수 없습니다.';
    if (/^'|'$/.test(name)) return '시트 이름은 작은따옴표(\')로 시작하거나 끝날 수 없습니다.';
    for (var i = 0; i < info.sheets.length; i++) if (info.sheets[i] !== except && sameName(info.sheets[i].name, name)) return '같은 이름의 시트가 이미 있습니다.';
    return '';
  }
  function addSheet(pkg, name) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var bad = checkSheetName(info, name, null); if (bad) return { err: bad };
      var mx = 0; pkg.list().forEach(function (p) { var m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p); if (m) mx = Math.max(mx, +m[1]); });
      var path = 'xl/worksheets/sheet' + (mx + 1) + '.xml', rid = 'rId' + (Object.keys(info.rel).length + 100), sid = 0;
      (info.wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t) { sid = Math.max(sid, +(attrOf(t, 'sheetId') || 0)); });
      var rattr = /\s((?:\w+:)?id)="/.exec((info.sheets[0] && info.sheets[0].tag) || '') ; var ra = rattr ? rattr[1] : 'r:id';
      pkg.write(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
      pkg.write('xl/_rels/workbook.xml.rels', info.rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (mx + 1) + '.xml"/></Relationships>'));
      pkg.write('[Content_Types].xml', info.ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
      var wbNew = info.wb.replace('</sheets>', '<sheet name="' + escX(name) + '" sheetId="' + (sid + 1) + '" ' + ra + '="' + rid + '"/></sheets>');
      if (/^r:/.test(ra) && !/<workbook\b[^>]*\sxmlns:r="/.test(wbNew)) wbNew = wbNew.replace(/<workbook\b/, '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');      // 통합 문서 머리에 r 이름공간이 없는 파일에서 새 시트가 깨지던 것
      pkg.write('xl/workbook.xml', wbNew);
      return { ok: true };
    });
  }
  function renameSheet(pkg, oldN, newN) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, oldN)) tgt = s; });
      if (!tgt) return { err: WHY.sheet };
      var bad = checkSheetName(info, newN, tgt); if (bad) return { err: bad };
      return readSheets(pkg, info).then(function () {
        info.sheets.forEach(function (s) {
          if (!s.path || s.xml == null) return;
          var ed = eachFormula(s.xml, s.name, function (t, own) { var r = renameInFormula(t, own, oldN, newN); return r === t ? null : r; });
          pkg.write(s.path, ed.xml);
        });
        var wbx = info.wb.replace(/(<definedName\b[^>]*>)([^<]*)(<\/definedName>)/g, function (all, o, t, c) { return o + escX(renameInFormula(unescX(t), '', oldN, newN)) + c; });
        wbx = wbx.replace(tgt.tag, setAttr(tgt.tag, 'name', escX(newN)));
        pkg.write('xl/workbook.xml', wbx);
        var cp = pkg.list().filter(function (p) { return /^xl\/charts\/chart[^\/]*\.xml$/.test(p); });
        return Promise.all(cp.map(function (p) { return pkg.read(p).then(function (x) { if (x) pkg.write(p, x.replace(/(<c:f>)([^<]*)(<\/c:f>)/g, function (a, o, t, c) { return o + escX(renameInFormula(unescX(t), '', oldN, newN)) + c; })); }); })).then(function () { return { ok: true }; });
      });
    });
  }
  function deleteSheet(pkg, name) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, name)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      if (info.sheets.filter(function (s) { return s.state !== 'hidden' && s.state !== 'veryHidden'; }).length <= 1) return { err: '시트는 하나 이상 있어야 합니다.' };
      return Promise.all([readSheets(pkg, info), relTypesOf(pkg, tgt.path)]).then(function (a) {
        if (a[1].some(function (t) { return t !== 'printerSettings'; })) return { err: '이 시트에는 그림·차트·표·메모·링크 같은 개체가 있어서 폰에서는 지울 수 없습니다.' };
        var used = false;
        info.sheets.forEach(function (s) { if (s === tgt || !s.xml) return; var ed = eachFormula(s.xml, s.name, function (t, own) { if (refsSheet(t, own, tgt.name)) used = true; return null; }); });
        (info.wb.match(/<definedName\b[^>]*>[^<]*<\/definedName>/g) || []).forEach(function (t) { var tx = unescX(t.replace(/<[^>]*>/g, '')); if (refsSheet(tx, '', tgt.name) && !new RegExp('localSheetId="' + tgt.idx + '"').test(t)) used = true; });
        if (used) return { err: '다른 시트의 수식이나 이름이 이 시트를 쓰고 있어서 지울 수 없습니다.' };
        var wbx = info.wb.replace(tgt.tag, '');
        wbx = wbx.replace(/<definedName\b[^>]*?\slocalSheetId="(\d+)"[^>]*>[^<]*<\/definedName>/g, function (all, id) { return +id === tgt.idx ? '' : all.replace('localSheetId="' + id + '"', 'localSheetId="' + (+id > tgt.idx ? +id - 1 : +id) + '"'); });
        wbx = wbx.replace(/\sactiveTab="(\d+)"/, function (m, v) { var n = +v > tgt.idx ? +v - 1 : (+v === tgt.idx ? 0 : +v); return n ? ' activeTab="' + n + '"' : ''; }).replace(/\sfirstSheet="\d+"/, '');
        pkg.write('xl/workbook.xml', wbx);
        pkg.write('xl/_rels/workbook.xml.rels', info.rels.replace(new RegExp('<Relationship\\b[^>]*\\sId="' + tgt.rid + '"[^>]*/>'), ''));
        pkg.write('[Content_Types].xml', info.ct.replace(new RegExp('<Override\\b[^>]*PartName="/' + tgt.path.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''));
        pkg.remove(tgt.path); var rp = tgt.path.replace(/([^\/]+)$/, '_rels/$1.rels'); pkg.remove(rp);
        return { ok: true };
      });
    });
  }
  function moveSheet(pkg, name, dir) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, name)) tgt = s; });
      if (!tgt) return { err: WHY.sheet };
      var to = tgt.idx + dir; if (to < 0 || to >= info.sheets.length) return { err: dir < 0 ? '이미 맨 앞입니다.' : '이미 맨 뒤입니다.' };
      var tags = info.sheets.map(function (s) { return s.tag; }), t = tags[tgt.idx]; tags.splice(tgt.idx, 1); tags.splice(to, 0, t);
      var perm = {}; info.sheets.forEach(function (s, i) { perm[i] = i; }); // 옛 번호 → 새 번호
      var order = info.sheets.map(function (s, i) { return i; }); order.splice(tgt.idx, 1); order.splice(to, 0, tgt.idx); order.forEach(function (oldI, newI) { perm[oldI] = newI; });
      var wbx = info.wb.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets>' + tags.join('') + '</sheets>');
      wbx = wbx.replace(/(<definedName\b[^>]*?\slocalSheetId=")(\d+)(")/g, function (m, a, id, c) { return a + (perm[+id] != null ? perm[+id] : id) + c; });
      wbx = wbx.replace(/(\sactiveTab=")(\d+)(")/, function (m, a, id, c) { return a + (perm[+id] != null ? perm[+id] : id) + c; });
      pkg.write('xl/workbook.xml', wbx); return { ok: true };
    });
  }

  // ============================== 안전 검사(중간 넣기·빼기를 해도 되나?) ==============================
  function checkMiddle(pkg, sheetName, axis, at, n, mode) {      // 실제로 하지 않고 같은 검사를 돌려 본다
    var tmp = { read: function (p) { return pkg.read(p); }, write: function () {}, remove: function () {}, list: function () { return pkg.list(); } };
    return lineEdit(tmp, sheetName, axis, at, n, mode).then(function (r) { return r.ok ? { ok: true } : { ok: false, err: r.err, why: r.why }; });
  }

  // ============================== 새 엑셀 문서 ==============================
  function newWorkbookFiles(sheetName) {
    var hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    var f = {};
    f['[Content_Types].xml'] = hdr + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    f['_rels/.rels'] = hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    f['xl/workbook.xml'] = hdr + '<workbook xmlns="' + NS + '" xmlns:r="' + RN + '"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="10000"/></bookViews><sheets><sheet name="' + escX(sheetName) + '" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>';
    f['xl/_rels/workbook.xml.rels'] = hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    f['xl/worksheets/sheet1.xml'] = hdr + '<worksheet xmlns="' + NS + '"><dimension ref="A1"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16.5"/><cols><col min="1" max="12" width="12" customWidth="1"/></cols><sheetData/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    f['xl/styles.xml'] = hdr + '<styleSheet xmlns="' + NS + '"><fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>';
    return f;
  }

  // 수식 칸의 저장된 값(<v>)만 바꾼다(계산기가 낸 값을 파일에 적어 두는 용도). updates = { 'B7': { t:'n'|'s'|'b', v } } → { xml, n }
  function setCachedValues(xml, updates) {
    var sd = parseSheet(xml); if (!sd) return { xml: xml, n: 0 };
    var n = 0;
    sd.rows.forEach(function (row) {
      row.cells.forEach(function (c) {
        var ref = /\sr="([A-Z]+\d+)"/.exec(c.raw)[1], u = updates[ref]; if (!u || !/<f\b/.test(c.raw)) return;
        var ot = openTagOfCell(c.raw), body = c.raw.slice(ot.length), self = /\/>$/.test(ot);
        if (self) return;
        body = body.replace(/<v>[^<]*<\/v>|<v\/>/, '').replace(/<\/c>$/, '');
        var tt = delAttr(ot, 't'); if (u.t === 's') tt = setAttr(tt, 't', 'str'); else if (u.t === 'b') tt = setAttr(tt, 't', 'b');
        var vs = u.t === 'b' ? (u.v ? '1' : '0') : u.t === 's' ? escX(u.v) : String(u.v);
        c.raw = tt + body + '<v>' + vs + '</v></c>'; n++;
      });
    });
    return { xml: serializeSheet(sd), n: n };
  }

  // ============================== 줄·열 숨기기 · 자동 필터 ==============================
  function sheetTarget(pkg, sheetName) {
    return wbInfo(pkg).then(function (info) { var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; }); return tgt && tgt.path ? tgt : null; });
  }
  function setRowsHidden(pkg, sheetName, r0, r1, hide) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        for (var r = r0; r <= r1; r++) { var row = getRow(sd, r, !!hide); if (!row) continue; row.open = hide ? setAttr(row.open, 'hidden', '1') : delAttr(row.open, 'hidden'); }
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true };
      });
    });
  }
  function setColsHidden(pkg, sheetName, c0, c1, hide) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var cols = (xml.match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attrOf(t, 'min'), max: +attrOf(t, 'max'), tag: t }; }), out = [], covered = {};
        cols.forEach(function (cl) {
          var lo = Math.max(cl.min, c0), hi = Math.min(cl.max, c1);
          if (hi < lo) { out.push(cl); return; }
          if (cl.min < lo) out.push({ min: cl.min, max: lo - 1, tag: setAttr(setAttr(cl.tag, 'min', String(cl.min)), 'max', String(lo - 1)) });
          var mid = setAttr(setAttr(cl.tag, 'min', String(lo)), 'max', String(hi)); mid = hide ? setAttr(mid, 'hidden', '1') : delAttr(mid, 'hidden');
          out.push({ min: lo, max: hi, tag: mid }); for (var k = lo; k <= hi; k++) covered[k] = 1;
          if (cl.max > hi) out.push({ min: hi + 1, max: cl.max, tag: setAttr(setAttr(cl.tag, 'min', String(hi + 1)), 'max', String(cl.max)) });
        });
        if (hide) { var k = c0; while (k <= c1) { if (covered[k]) { k++; continue; } var e = k; while (e + 1 <= c1 && !covered[e + 1]) e++; out.push({ min: k, max: e, tag: '<col min="' + k + '" max="' + e + '" width="9.140625" hidden="1" customWidth="1"/>' }); k = e + 1; } }
        out.sort(function (a, b) { return a.min - b.min; });
        xml = xml.replace(/<cols\b[^>]*?(?:\/>|>[\s\S]*?<\/cols>)/, '');
        if (out.length) xml = insertWsElement(xml, 'cols', '<cols>' + out.map(function (x) { return x.tag; }).join('') + '</cols>');
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  function showAllHidden(pkg, sheetName) {            // 시트의 숨긴 줄·열을 모두 보이게
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        xml = xml.replace(/<col\b[^>]*\/>/g, function (t) { return delAttr(t, 'hidden'); }).replace(/<row\b[^>]*>/g, function (t) { return delAttr(t, 'hidden'); });
        pkg.write(tgt.path, xml); return { ok: true };
      });
    });
  }
  // 자동 필터: rng = {r0,c0,r1,c1}(1부터)|null(끄기). criteria = { 열번호(rng.c0 기준 0부터): [표시 글자…] }, hiddenRows = 필터로 숨길 줄 번호 목록(1부터)
  function setFilter(pkg, sheetName, rng, criteria, hiddenRows) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var old = /<autoFilter\b([^>]*?)(?:\/>|>[\s\S]*?<\/autoFilter>)/.exec(xml), oref = old ? attrOf(old[0].match(/^<autoFilter\b[^>]*>/)[0], 'ref') : null;
        if (/<tableParts\b/.test(xml)) return { err: '이 시트에는 엑셀 표(자동 필터가 따로 달린 표)가 있어서 폰에서는 필터를 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        xml = xml.replace(/<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/, '');
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        var m = oref && /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(oref);
        if (m) for (var r = +m[2] + 1; r <= +m[4]; r++) { var row = getRow(sd, r, false); if (row) row.open = delAttr(row.open, 'hidden'); }     // 옛 필터가 숨긴 줄은 먼저 모두 보이게
        var out = serializeSheet(sd);
        if (rng) {
          var OPN = { ge: 'greaterThanOrEqual', le: 'lessThanOrEqual', gt: 'greaterThan', lt: 'lessThan', eq: '' };
          var cs = Object.keys(criteria || {}).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
            var c = criteria[k];
            if (c && c.cond) {                           // 조건 필터: 숫자 비교·글자 포함
              return '<filterColumn colId="' + k + '"><customFilters' + (c.cond.length > 1 && c.and !== false ? ' and="1"' : '') + '>' + c.cond.map(function (x) {
                if (x.op === 'contains') return '<customFilter val="*' + escX(x.s) + '*"/>';
                return '<customFilter' + (OPN[x.op] ? ' operator="' + OPN[x.op] + '"' : '') + ' val="' + escX(String(x.n)) + '"/>';
              }).join('') + '</customFilters></filterColumn>';
            }
            return '<filterColumn colId="' + k + '"><filters>' + c.map(function (v) { return '<filter val="' + escX(v) + '"/>'; }).join('') + '</filters></filterColumn>';
          }).join('');
          var ref = colName(rng.c0) + rng.r0 + ':' + colName(rng.c1) + rng.r1;
          out = insertWsElement(out, 'autoFilter', '<autoFilter ref="' + ref + '"' + (cs ? '>' + cs + '</autoFilter>' : '/>'));
          var sd2 = parseSheet(out); (hiddenRows || []).forEach(function (r) { var row = getRow(sd2, r, false); if (row) row.open = setAttr(row.open, 'hidden', '1'); }); out = serializeSheet(sd2);
        }
        pkg.write(tgt.path, out); return { ok: true };
      });
    });
  }
  function readFilter(xml) {                          // 시트 XML 에서 지금 걸린 자동 필터: {ref:{r0,c0,r1,c1}, criteria:{열:[글자]}}|null
    var m = /<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/.exec(xml || ''); if (!m) return null;
    var open = m[0].match(/^<autoFilter\b[^>]*>/)[0], rm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(attrOf(open, 'ref') || ''); if (!rm) return null;
    var crit = {}; (m[0].match(/<filterColumn\b[\s\S]*?<\/filterColumn>/g) || []).forEach(function (fc) {
      var id = +attrOf(fc.match(/^<filterColumn\b[^>]*>/)[0], 'colId');
      if (/<customFilters\b/.test(fc) && !/<(top10|dynamicFilter|colorFilter|iconFilter|filters)\b/.test(fc)) {
        var cf = fc.match(/<customFilter\b[^>]*\/?>/g) || [], conds = [], okc = cf.length > 0 && cf.length <= 2, andv = /<customFilters\b[^>]*\sand="(?:1|true)"/.test(fc);
        var OPR = { greaterThanOrEqual: 'ge', lessThanOrEqual: 'le', greaterThan: 'gt', lessThan: 'lt' };
        cf.forEach(function (t) {
          var op = attrOf(t, 'operator') || 'equal', v = unescX(attrOf(t, 'val') || '');
          if (op === 'equal' && /^\*[^*?]+\*$/.test(v)) conds.push({ op: 'contains', s: v.slice(1, -1) });
          else if (OPR[op] && v !== '' && !isNaN(parseFloat(v))) conds.push({ op: OPR[op], n: parseFloat(v) });
          else if (op === 'equal' && v !== '' && !isNaN(parseFloat(v)) && /^-?[\d.]+$/.test(v)) conds.push({ op: 'eq', n: parseFloat(v) });
          else okc = false;
        });
        crit[id] = okc ? { cond: conds, and: andv } : null; return;
      }
      if (/<(customFilters|top10|dynamicFilter|colorFilter|iconFilter)\b/.test(fc)) crit[id] = null; else crit[id] = (fc.match(/<filter\b[^>]*\sval="[^"]*"/g) || []).map(function (t) { return unescX(attrOf(t, 'val')); });
    });
    return { ref: { c0: colNum(rm[1]), r0: +rm[2], c1: colNum(rm[3]), r1: +rm[4] }, criteria: crit };
  }
  // ============================== 칸·범위 복사 붙여넣기 (v10.7) ==============================
  // src = {r0,c0,r1,c1}(1부터) → 붙일 왼쪽 위 (dstR0,dstC0)(1부터). mode: 'all'(값·수식·서식) | 'values'(값만, 붙는 자리의 서식은 그대로). cut=true 면 원래 칸은 비운다(다른 칸의 수식이 원래 칸을 쓰면 하지 않는다)
  function mergesOf(xml) { var out = [], m, re = /<mergeCell\b[^>]*\sref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g; while ((m = re.exec(xml))) out.push({ c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3]), r1: +m[4] }); return out; }
  function hitMerge(ms, r0, c0, r1, c1) { return ms.some(function (m) { return !(m.r1 < r0 || m.r0 > r1 || m.c1 < c0 || m.c0 > c1); }); }
  function copyRange(pkg, sheetName, src, dstR0, dstC0, mode, cut) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml0) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var nr = src.r1 - src.r0 + 1, nc = src.c1 - src.c0 + 1, dr = dstR0 - src.r0, dc = dstC0 - src.c0;
        if (dstR0 + nr - 1 > MAXR || dstC0 + nc - 1 > MAXC) return { err: '붙일 자리가 시트의 끝을 넘습니다.' };
        var ms = mergesOf(ex.xml);
        if (hitMerge(ms, src.r0, src.c0, src.r1, src.c1) || hitMerge(ms, dstR0, dstC0, dstR0 + nr - 1, dstC0 + nc - 1)) return { err: '합쳐진 칸이 걸려 있어 폰에서는 복사·붙여넣기를 할 수 없습니다. 먼저 합치기를 풀거나 「수정 요청」으로 맡겨 주십시오.' };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var snap = [], i, j, err = null;
        for (i = 0; i < nr; i++) { var srow = getRow(sd, src.r0 + i, false); snap.push([]); for (j = 0; j < nc; j++) { var sc = srow && getCell(srow, src.c0 + j, false); snap[i].push(sc ? sc.raw : null); } }
        for (i = 0; i < nr && !err; i++) for (j = 0; j < nc; j++) if (snap[i][j] && /<f\b[^>]*\st="(?:array|dataTable)"|\scm="|\svm="/.test(snap[i][j])) { err = '배열 수식이나 특수한 칸이 들어 있어 복사할 수 없습니다. 엑셀에서 해 주십시오.'; break; }
        if (err) return { err: err };
        if (cut && snap.some(function (rw) { return rw.some(function (q) { return q && /<f\b/.test(q); }); })) return { err: '수식이 든 칸은 오려두기를 할 수 없습니다(엑셀은 수식이 가리키는 곳을 따로 계산해 옮깁니다). 「복사」로 붙인 뒤 원래 칸을 지워 주십시오.' };
        if (cut) {                                   // 다른 칸의 수식이 원래 칸을 쓰면 오려두기를 막는다
          var bad = false, sheets = info.sheets.filter(function (s) { return s.path; });
          return Promise.all(sheets.map(function (s) { return pkg.read(s.path).then(function (x) { return { s: s, x: x || '' }; }); })).then(function (all) {
            all.forEach(function (a) {
              (a.x.match(/<f\b[^>]*>[^<]*<\/f>/g) || []).forEach(function (ft) {
                var txt = unescX(ft.replace(/<[^>]+>/g, ''));
                mapRefs(txt, a.s.name, function (r) {
                  if (!sameName(r.sheet, tgt.name)) return null;
                  var b = r.b || r.a, rr0 = Math.min(r.a.r, b.r), rr1 = Math.max(r.a.r, b.r), cc0 = Math.min(r.a.c, b.c), cc1 = Math.max(r.a.c, b.c);
                  if (!(rr1 < src.r0 || rr0 > src.r1 || cc1 < src.c0 || cc0 > src.c1)) bad = true; return null;
                });
              });
            });
            if (bad) return { err: '다른 칸의 수식이 옮기려는 칸을 쓰고 있어 오려두기는 할 수 없습니다(수식이 어긋납니다). 「복사」로 붙인 뒤 원래 칸을 지워 주십시오.' };
            return doPaste();
          });
        }
        return doPaste();
        function doPaste() {
          var n = 0;
          for (i = 0; i < nr && !err; i++) {
            var row = getRow(sd, dstR0 + i, true);
            for (j = 0; j < nc && !err; j++) {
              var raw = snap[i][j], dcol = dstC0 + j, old = getCell(row, dcol, false), oldS = old ? attrOf(openTagOfCell(old.raw), 's') : null;
              if (!raw) {                               // 빈 칸을 붙이면 붙는 자리를 비운다
                if (old) { var k0 = row.cells.indexOf(old); if (mode === 'values' && oldS != null) row.cells[k0] = { c: dcol, raw: '<c r="' + colName(dcol) + row.r + '" s="' + oldS + '"/>' }; else row.cells.splice(k0, 1); }
                continue;
              }
              var f = /<f\b([^>]*)>([^<]*)<\/f>/.exec(raw), nraw = raw;
              if (mode === 'values') {
                nraw = nraw.replace(/<f\b[^>]*>[^<]*<\/f>|<f\b[^>]*\/>/g, '');
                if (/\st="str"/.test(nraw)) nraw = nraw.replace(/\st="str"/, ' t="inlineStr"').replace(/<v>([^<]*)<\/v>/, '<is><t xml:space="preserve">$1</t></is>');
                var ot = openTagOfCell(nraw), ot2 = oldS != null ? setAttr(ot, 's', oldS) : delAttr(ot, 's'); nraw = ot2 + nraw.slice(ot.length);
              } else if (f) {
                var tr = translateFormula(unescX(f[2]), tgt.name, dr, dc); if (tr.err) { err = '붙일 자리가 시트 밖으로 나가는 수식이 있습니다.'; break; }
                nraw = nraw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at) { return '<f' + at + '>' + escX(tr.f) + '</f>'; }).replace(/<v>[^<]*<\/v>/, '').replace(/\st="[^"]*"/, '');
              }
              var nc2 = { c: dcol, raw: nraw }; renumberCell(nc2, row.r, dcol);
              if (old) row.cells[row.cells.indexOf(old)] = nc2; else { var at2 = 0; while (at2 < row.cells.length && row.cells[at2].c < dcol) at2++; row.cells.splice(at2, 0, nc2); }
              n++;
            }
          }
          if (err) return { err: err };
          if (cut) {
            for (i = 0; i < nr; i++) { var srow2 = getRow(sd, src.r0 + i, false); if (!srow2) continue; for (j = 0; j < nc; j++) { var rr = src.r0 + i, cc = src.c0 + j; if (rr >= dstR0 && rr < dstR0 + nr && cc >= dstC0 && cc < dstC0 + nc) continue; var sc2 = getCell(srow2, cc, false); if (sc2) srow2.cells.splice(srow2.cells.indexOf(sc2), 1); } }
          }
          var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n, nr: nr, nc: nc };
        }
      });
    });
  }

  // ============================== v10.8: 틀 고정 · 조건 색칠 · 입력 제한(목록) · 차트·그림 든 시트의 줄·칸 넣기 ==============================
  function rangeParts(ref) { var m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref); if (!m) return null; return { c0: colNum(m[1]), r0: +m[2], c1: colNum(m[3] || m[1]), r1: +(m[4] || m[2]) }; }
  function sqrefHits(sq, rng) {                 // 공백으로 나뉜 범위들 가운데 rng({r0,c0,r1,c1} 1부터)와 겹치는 것이 있나
    return String(sq || '').split(/\s+/).some(function (t) { var p = rangeParts(t); return p && !(p.r1 < rng.r0 || p.r0 > rng.r1 || p.c1 < rng.c0 || p.c0 > rng.c1); });
  }
  function rangeText(rng) { return colName(rng.c0) + rng.r0 + (rng.c1 > rng.c0 || rng.r1 > rng.r0 ? ':' + colName(rng.c1) + rng.r1 : ''); }
  // 틀 고정 읽기 → { rows, cols }
  function readFreeze(xml) {
    var m = /<pane\b[^>]*?\/?>/.exec(xml || ''); if (!m || attrOf(m[0], 'state') !== 'frozen' && attrOf(m[0], 'state') !== 'frozenSplit') return { rows: 0, cols: 0 };
    return { rows: +(attrOf(m[0], 'ySplit') || 0) | 0, cols: +(attrOf(m[0], 'xSplit') || 0) | 0 };
  }
  // 틀 고정: rows = 위에서부터 고정할 줄 수, cols = 왼쪽에서부터 고정할 칸 수(0 이면 그쪽은 고정 안 함). 둘 다 0 이면 풀기.
  function freezePanes(pkg, sheetName, rows, cols) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      rows = Math.max(0, rows | 0); cols = Math.max(0, cols | 0);
      if (rows > 200 || cols > 50) return { err: '고정할 줄은 200줄, 칸은 50칸까지입니다.' };
      return pkg.read(tgt.path).then(function (xml) {
        var vm = /<sheetViews\b[^>]*?(?:\/>|>[\s\S]*?<\/sheetViews>)/.exec(xml);
        if (!vm) return { err: '이 시트의 보기 정보를 찾지 못했습니다.' };
        var views = vm[0], svm = /<sheetView\b([^>]*?)(\/?)>/.exec(views);
        if (!svm) return { err: '이 시트의 보기 정보를 찾지 못했습니다.' };
        if ((views.match(/<sheetView\b/g) || []).length > 1) return { err: '이 시트는 보기가 여러 개라 폰에서 틀 고정을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        var open = '<sheetView' + svm[1].replace(/\s+$/, '') + '>', inner = '';
        if (svm[2] !== '/') { var s0 = svm.index + svm[0].length, e0 = views.indexOf('</sheetView>', s0); inner = views.slice(s0, e0); }
        inner = inner.replace(/<pane\b[^>]*?\/>/g, '').replace(/<selection\b[^>]*?(?:\/>|>[\s\S]*?<\/selection>)/g, '');
        var rest = inner;                               // pivotSelection · extLst 등은 그대로 뒤에 둔다
        var pane = '', sel = '';
        if (rows || cols) {
          var tl = colName(cols + 1) + (rows + 1), ap = rows && cols ? 'bottomRight' : (rows ? 'bottomLeft' : 'topRight');
          pane = '<pane' + (cols ? ' xSplit="' + cols + '"' : '') + (rows ? ' ySplit="' + rows + '"' : '') + ' topLeftCell="' + tl + '" activePane="' + ap + '" state="frozen"/>';
          sel = rows && cols ? '<selection pane="topRight" activeCell="' + colName(cols + 1) + '1" sqref="' + colName(cols + 1) + '1"/><selection pane="bottomLeft" activeCell="A' + (rows + 1) + '" sqref="A' + (rows + 1) + '"/><selection pane="bottomRight" activeCell="' + tl + '" sqref="' + tl + '"/>'
            : '<selection pane="' + ap + '" activeCell="' + tl + '" sqref="' + tl + '"/>';
        } else sel = '<selection activeCell="A1" sqref="A1"/>';
        open = open.replace(/\s(?:topLeftCell)="[^"]*"/, '');
        var nv = '<sheetViews>' + open + pane + sel + rest + '</sheetView></sheetViews>';
        pkg.write(tgt.path, xml.replace(vm[0], nv)); return { ok: true };
      });
    });
  }

  // ---- 조건 색칠 ----
  var CF_OP = { gt: 'greaterThan', lt: 'lessThan', ge: 'greaterThanOrEqual', le: 'lessThanOrEqual', eq: 'equal', ne: 'notEqual' };
  // 이 시트의 규칙 목록(보기용): [{ sqref, text, n }]
  function readCond(xml) {
    var out = [];
    (xml.match(/<conditionalFormatting\b[^>]*?(?:\/>|>[\s\S]*?<\/conditionalFormatting>)/g) || []).forEach(function (blk) {
      var sq = attrOf(blk.match(/^<conditionalFormatting\b[^>]*>/)[0], 'sqref') || '';
      (blk.match(/<cfRule\b[^>]*?(?:\/>|>[\s\S]*?<\/cfRule>)/g) || []).forEach(function (rule) {
        var t = attrOf(rule.match(/^<cfRule\b[^>]*>/)[0], 'type'), op = attrOf(rule.match(/^<cfRule\b[^>]*>/)[0], 'operator'), f = /<formula>([^<]*)<\/formula>/.exec(rule), tx = attrOf(rule.match(/^<cfRule\b[^>]*>/)[0], 'text');
        var txt;
        if (t === 'cellIs') { var k = Object.keys(CF_OP).filter(function (q) { return CF_OP[q] === op; })[0]; txt = ({ gt: '보다 큼', lt: '보다 작음', ge: ' 이상', le: ' 이하', eq: '와 같음', ne: '와 다름' }[k] || '조건') + ' ' + (f ? unescX(f[1]) : ''); txt = (f ? unescX(f[1]) : '') + ({ gt: ' 초과', lt: ' 미만', ge: ' 이상', le: ' 이하', eq: ' 같음', ne: ' 다름' }[k] || ''); }
        else if (t === 'containsText') txt = '「' + unescX(tx || '') + '」 포함';
        else txt = '다른 조건(' + (t || '?') + ')';
        out.push({ sqref: sq, text: txt, own: t === 'cellIs' || t === 'containsText' });
      });
    });
    return out;
  }
  function dxfAdd(stylesXml, bg, color) {
    var fill = bg ? '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(bg) + '"/><bgColor rgb="' + argb(bg) + '"/></patternFill></fill>' : '';
    var dxf = '<dxf>' + (color ? '<font><color rgb="' + argb(color) + '"/></font>' : '') + fill + '</dxf>', id;
    var m = /<dxfs\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dxfs>)/.exec(stylesXml);
    if (m) {
      var items = (m[2] || '').match(/<dxf\b[^>]*?(?:\/>|>[\s\S]*?<\/dxf>)/g) || []; id = items.indexOf(dxf); if (id < 0) { items.push(dxf); id = items.length - 1; }
      return { xml: stylesXml.replace(m[0], '<dxfs count="' + items.length + '">' + items.join('') + '</dxfs>'), id: id };
    }
    var ne = '<dxfs count="1">' + dxf + '</dxfs>', pos = -1, mm;
    if ((mm = /<tableStyles\b/.exec(stylesXml)) || (mm = /<colors\b/.exec(stylesXml)) || (mm = /<extLst\b/.exec(stylesXml)) || (mm = /<\/styleSheet>/.exec(stylesXml))) pos = mm.index;
    if (pos < 0) return null;
    return { xml: stylesXml.slice(0, pos) + ne + stylesXml.slice(pos), id: 0 };
  }
  // 규칙 하나 추가. rule = { op:'gt'|'lt'|'ge'|'le'|'eq'|'ne'|'contains', v:(숫자 또는 글자), bg:'#RRGGBB'|null, color:'#RRGGBB'|null }
  function addCond(pkg, sheetName, rng, rule) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      if (!rule.bg && !rule.color) return { err: '칠할 색(배경 또는 글자색)을 하나 골라 주십시오.' };
      var isText = rule.op === 'contains';
      if (isText ? !String(rule.v || '').trim() : !(isFinite(parseFloat(rule.v)))) return { err: isText ? '포함할 글자를 적어 주십시오.' : '비교할 숫자를 적어 주십시오.' };
      return Promise.all([pkg.read(tgt.path), pkg.read('xl/styles.xml')]).then(function (a) {
        var xml = a[0], sx = a[1]; if (!sx) return { err: '서식 정보를 찾지 못했습니다.' };
        var dx = dxfAdd(sx, rule.bg, rule.color); if (!dx) return { err: '이 문서의 서식 정보가 특이해서 폰에서는 조건 색칠을 넣을 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        var pr = 0; (xml.match(/<cfRule\b[^>]*?\spriority="(\d+)"/g) || []).forEach(function (t) { pr = Math.max(pr, +/priority="(\d+)"/.exec(t)[1]); });
        var tl = colName(rng.c0) + rng.r0, body;
        if (isText) { var tx = String(rule.v).trim(); body = '<cfRule type="containsText" dxfId="' + dx.id + '" priority="' + (pr + 1) + '" operator="containsText" text="' + escX(tx) + '"><formula>NOT(ISERROR(SEARCH("' + escX(tx.replace(/"/g, '""')) + '",' + tl + ')))</formula></cfRule>'; }
        else body = '<cfRule type="cellIs" dxfId="' + dx.id + '" priority="' + (pr + 1) + '" operator="' + CF_OP[rule.op] + '"><formula>' + escX(String(parseFloat(rule.v))) + '</formula></cfRule>';
        var el = '<conditionalFormatting sqref="' + rangeText(rng) + '">' + body + '</conditionalFormatting>';
        xml = insertWsElement(xml, 'conditionalFormatting', el);
        pkg.write(tgt.path, xml); pkg.write('xl/styles.xml', dx.xml); return { ok: true };
      });
    });
  }
  // rng 와 겹치는 조건 색칠(전체 규칙 묶음)을 지운다. rng 가 null 이면 이 시트 전체
  function clearCond(pkg, sheetName, rng) {
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var n = 0;
        xml = xml.replace(/<conditionalFormatting\b[^>]*?(?:\/>|>[\s\S]*?<\/conditionalFormatting>)/g, function (blk) {
          var sq = attrOf(blk.match(/^<conditionalFormatting\b[^>]*>/)[0], 'sqref') || '';
          if (!rng || sqrefHits(sq, rng)) { n += (blk.match(/<cfRule\b/g) || []).length || 1; return ''; } return blk;
        });
        if (!n) return { err: '지울 조건 색칠이 없습니다.' };
        pkg.write(tgt.path, xml); return { ok: true, n: n };
      });
    });
  }

  // ---- 입력 제한(드롭다운 목록) ----
  function readValid(xml) {
    var out = [];
    (xml.match(/<dataValidation\b[^>]*?(?:\/>|>[\s\S]*?<\/dataValidation>)/g) || []).forEach(function (t) { var o = t.match(/^<dataValidation\b[^>]*>/)[0], f = /<formula1>([^<]*)<\/formula1>/.exec(t); out.push({ sqref: attrOf(o, 'sqref') || '', type: attrOf(o, 'type') || '', list: attrOf(o, 'type') === 'list' && f ? unescX(f[1]) : null }); });
    return out;
  }
  function setValid(pkg, sheetName, rng, items) {     // items = ['예','아니오'] (null/빈 목록이면 이 범위의 입력 제한을 지움)
    return sheetTarget(pkg, sheetName).then(function (tgt) {
      if (!tgt) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) {
        var list = (items || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
        if (list.some(function (s) { return s.indexOf(',') >= 0 || s.indexOf('"') >= 0; })) return { err: '목록의 항목에는 쉼표(,)와 따옴표(")를 쓸 수 없습니다.' };
        var txt = list.join(','); if (list.length && txt.length > 250) return { err: '목록이 너무 깁니다(쉼표 포함 250자까지).' };
        var m = /<dataValidations\b[^>]*?(?:\/>|>([\s\S]*?)<\/dataValidations>)/.exec(xml), all = m && m[1] ? (m[1].match(/<dataValidation\b[^>]*?(?:\/>|>[\s\S]*?<\/dataValidation>)/g) || []) : [];
        var kept = all.filter(function (t) { return !sqrefHits(attrOf(t.match(/^<dataValidation\b[^>]*>/)[0], 'sqref'), rng); }), removed = all.length - kept.length;
        if (!list.length && !removed) return { err: '이 범위에는 지울 입력 제한이 없습니다.' };
        if (list.length) kept.push('<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="' + rangeText(rng) + '"><formula1>"' + escX(txt) + '"</formula1></dataValidation>');
        if (m) xml = xml.replace(m[0], '');
        if (kept.length) xml = insertWsElement(xml, 'dataValidations', '<dataValidations count="' + kept.length + '">' + kept.join('') + '</dataValidations>');
        pkg.write(tgt.path, xml); return { ok: true, removed: removed };
      });
    });
  }

  // ---- 차트·그림이 든 시트의 줄·칸 넣기 (넣기만 — 지우기는 개체가 어긋날 수 있어 막음) ----
  function drawingPathOf(pkg, sheetPath) {
    var rp = sheetPath.replace(/([^\/]+)$/, '_rels/$1.rels');
    return pkg.read(rp).then(function (x) {
      if (!x) return null; var t = (x.match(/<Relationship\b[^>]*>/g) || []).filter(function (r) { return /\/drawing$/.test(attrOf(r, 'Type') || ''); })[0];
      if (!t) return null; var tg = attrOf(t, 'Target') || ''; if (/^[A-Za-z]+:/.test(tg) || attrOf(t, 'TargetMode') === 'External') return null;
      var parts = (tg.charAt(0) === '/' ? tg.slice(1) : sheetPath.replace(/[^\/]+$/, '') + tg).split('/'), out = [];
      parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }); return out.join('/');
    });
  }
  function shiftAnchors(xml, axis, at, n) {         // 그림·차트 자리(0부터)를 넣은 줄·칸만큼 민다
    var tag = axis === 'row' ? 'xdr:row' : 'xdr:col';
    return xml.replace(/<xdr:(from|to)>[\s\S]*?<\/xdr:\1>/g, function (blk) {
      return blk.replace(new RegExp('<' + tag + '>(\\d+)</' + tag + '>'), function (all, v) { v = +v; return v + 1 >= at ? '<' + tag + '>' + (v + n) + '</' + tag + '>' : all; });
    });
  }

  // ============================== v10.8 2회차 ①: 채우기 · 중복 제거 · 텍스트 나누기 ==============================
  function withSheet(pkg, sheetName, fn) {
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      return pkg.read(tgt.path).then(function (xml) { return fn(xml, tgt, info); });
    });
  }
  function readSst(pkg) {
    return pkg.read('xl/sharedStrings.xml').then(function (x) {
      if (!x) return [];
      return (x.match(/<si\b[^>]*?(?:\/>|>[\s\S]*?<\/si>)/g) || []).map(function (si) {
        return (si.match(/<t\b[^>]*?(?:\/>|>[\s\S]*?<\/t>)/g) || []).map(function (t) { return unescX(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')); }).join('');
      });
    });
  }
  // 칸 하나의 값: { k: 'n'|'s'|'b'|'e'|'z'(빈), v, f(수식 있음) }
  function cellVal(cell, sst) {
    if (!cell) return { k: 'z', v: null, f: false };
    var raw = cell.raw, ot = openTagOfCell(raw), t = attrOf(ot, 't'), f = /<f\b/.test(raw), vm = /<v>([^<]*)<\/v>/.exec(raw);
    if (t === 'inlineStr') return { k: 's', v: (raw.match(/<t\b[^>]*>([^<]*)<\/t>/g) || []).map(function (x) { return unescX(x.replace(/<[^>]*>/g, '')); }).join(''), f: f };
    if (!vm) return { k: 'z', v: null, f: f };
    if (t === 's') return { k: 's', v: sst[+vm[1]] == null ? '' : sst[+vm[1]], f: f };
    if (t === 'str') return { k: 's', v: unescX(vm[1]), f: f };
    if (t === 'b') return { k: 'b', v: vm[1] === '1', f: f };
    if (t === 'e') return { k: 'e', v: vm[1], f: f };
    var n = parseFloat(vm[1]); return isNaN(n) ? { k: 'z', v: null, f: f } : { k: 'n', v: n, f: f };
  }
  function mkCellXml(ref, s, val) {         // val: { k, v }
    var sa = s != null ? ' s="' + s + '"' : '';
    if (val.k === 'n') return '<c r="' + ref + '"' + sa + '><v>' + String(val.v) + '</v></c>';
    if (val.k === 's') return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + escX(val.v) + '</t></is></c>';
    return '<c r="' + ref + '"' + sa + '/>';
  }
  function putCell(sd, r, c, xmlFn) {         // 줄·칸 자리에 새 칸을 넣는다(있으면 바꾼다). xmlFn(ref, 옛 칸|null) → raw
    var row = getRow(sd, r, true), old = getCell(row, c, false), ref = colName(c) + r, raw = xmlFn(ref, old), nc = { c: c, raw: raw };
    if (old) row.cells[row.cells.indexOf(old)] = nc; else { var at = 0; while (at < row.cells.length && row.cells[at].c < c) at++; row.cells.splice(at, 0, nc); }
  }
  var LISTS = [['월', '화', '수', '목', '금', '토', '일'], ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일']];
  function nextSeq(seed, k, step) {          // 시작 값(seed)에서 k번째(1부터) 뒤 값. 못 만들면 null
    if (seed.k === 'n') return { k: 'n', v: Number((seed.v + step * k).toPrecision(15)) };
    if (seed.k !== 's') return null;
    var i, v = seed.v;
    for (i = 0; i < LISTS.length; i++) { var p = LISTS[i].indexOf(v); if (p >= 0) return { k: 's', v: LISTS[i][(((p + k * step) % 7) + 7) % 7] }; }
    var mm = /^(\d{1,2})월$/.exec(v); if (mm) return { k: 's', v: ((((+mm[1] - 1 + k * step) % 12) + 12) % 12 + 1) + '월' };
    var m = /^([\s\S]*?)(\d+)(\D*)$/.exec(v); if (!m) return null;
    var num = +m[2] + step * k; if (num < 0) return null;
    var w = m[2].length, ns = String(num); if (m[2].charAt(0) === '0' && ns.length < w) ns = '0'.repeat(w - ns.length) + ns;
    return { k: 's', v: m[1] + ns + m[3] };
  }
  // 범위 맨 앞 칸(들)을 따라 오른쪽·아래로 이어 채운다. axis 'down'|'right'. 수식이 든 칸은 복사(참조 이동)로 채운다
  function fillSeries(pkg, sheetName, rng, axis) {
    return readSst(pkg).then(function (sst) {
      return withSheet(pkg, sheetName, function (xml0, tgt) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var down = axis === 'down', n = 0, err = null, lanes = down ? rng.c1 - rng.c0 + 1 : rng.r1 - rng.r0 + 1, len = down ? rng.r1 - rng.r0 + 1 : rng.c1 - rng.c0 + 1;
        if (len < 2) return { err: '채울 범위를 두 칸 이상 골라 주십시오.' };
        if (len * lanes > 200000) return { err: '한 번에 20만 칸까지 채울 수 있습니다.' };
        for (var L = 0; L < lanes && !err; L++) {
          var pos = function (i) { return down ? { r: rng.r0 + i, c: rng.c0 + L } : { r: rng.r0 + L, c: rng.c0 + i }; };
          var p0 = pos(0), row0 = getRow(sd, p0.r, false), c0 = row0 && getCell(row0, p0.c, false), v0 = cellVal(c0, sst), st0 = c0 ? attrOf(openTagOfCell(c0.raw), 's') : null;
          var p1 = pos(1), row1 = getRow(sd, p1.r, false), c1 = row1 && getCell(row1, p1.c, false), v1 = cellVal(c1, sst);
          var useTwo = len > 2 && v0.k === 'n' && v1.k === 'n' && !v0.f && !v1.f, step = useTwo ? v1.v - v0.v : 1, from = useTwo ? 2 : 1;
          if (!useTwo && v0.k === 's' && !v0.f && v1.k === 's' && !v1.f && len > 2) {      // 「1회」「2회」처럼 두 칸이 숫자 꼴이면 그 간격
            var a = /(\d+)\D*$/.exec(v0.v), b = /(\d+)\D*$/.exec(v1.v); if (a && b && v0.v.replace(/\d+\D*$/, '') === v1.v.replace(/\d+\D*$/, '')) { step = +b[1] - +a[1]; from = 2; }
          }
          for (var i = from; i < len && !err; i++) {
            var p = pos(i), stl = st0;
            if (v0.f) {                                                    // 수식은 복사(상대 참조 이동)
              if (!c0) continue;
              var raw = c0.raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at, txt) {
                var tr = translateFormula(unescX(txt), tgt.name, down ? p.r - p0.r : 0, down ? 0 : p.c - p0.c); if (tr.err) { err = WHY.range; return all; }
                return '<f' + at + '>' + escX(tr.f) + '</f>';
              }).replace(/<v>[^<]*<\/v>/, '').replace(/\st="[^"]*"/, '');
              var nc = { c: p.c, raw: raw }; renumberCell(nc, p.r, p.c);
              putCell(sd, p.r, p.c, function () { return nc.raw; }); n++; continue;
            }
            var nv;
            if (v0.k === 'z') nv = null;
            else if (v0.k === 'n') nv = { k: 'n', v: Number((v0.v + step * i).toPrecision(15)) };
            else if (v0.k === 's') nv = nextSeq(v0, i, step) || v0;      // 이어 갈 규칙이 없는 글자는 그대로 복사
            else nv = v0;
            var orow = getRow(sd, p.r, false), oc = orow && getCell(orow, p.c, false), ov = oc ? cellVal(oc, sst) : null;
            if (nv && ov && !ov.f && ov.k === nv.k && ov.v === nv.v) continue;      // 이미 같은 값이면 채운 칸으로 세지 않는다(안내 숫자가 실제와 맞도록)
            if (!nv) { putCell(sd, p.r, p.c, function (ref) { return '<c r="' + ref + '"' + (stl != null ? ' s="' + stl + '"' : '') + '/>'; }); continue; }
            if (nv.k === 'b' || nv.k === 'e') { putCell(sd, p.r, p.c, function (ref) { return c0.raw.replace(/\sr="[A-Z]+\d+"/, ' r="' + ref + '"'); }); n++; continue; }
            putCell(sd, p.r, p.c, function (ref) { return mkCellXml(ref, stl, nv); }); n++;
          }
        }
        if (err) return { err: err };
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n };
      });
    });
  }
  // 옆(오른쪽)으로 복사해 채우기: 범위 맨 왼쪽 칸을 오른쪽 칸들에 복사(수식은 참조 이동)
  function fillRight(pkg, sheetName, rng) {
    return withSheet(pkg, sheetName, function (xml0, tgt) {
      var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
      var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
      var err = null, n = 0;
      if (rng.c1 <= rng.c0) return { err: '채울 범위를 두 칸 이상 골라 주십시오.' };
      for (var r = rng.r0; r <= rng.r1 && !err; r++) {
        var row = getRow(sd, r, true), src = getCell(row, rng.c0, false);
        for (var c = rng.c0 + 1; c <= rng.c1 && !err; c++) {
          var cell = getCell(row, c, false);
          if (!src) { if (cell) row.cells.splice(row.cells.indexOf(cell), 1); continue; }
          var raw = src.raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at, txt) {
            var tr = translateFormula(unescX(txt), tgt.name, 0, c - rng.c0); if (tr.err) { err = WHY.range; return all; }
            return '<f' + at + '>' + escX(tr.f) + '</f>';
          }).replace(/<v>[^<]*<\/v>/, function (v) { return /<f\b/.test(src.raw) ? '' : v; });
          if (/<f\b/.test(raw)) raw = raw.replace(/\st="[^"]*"/, '');
          var nc = { c: c, raw: raw }; renumberCell(nc, r, c);
          if (cell) row.cells[row.cells.indexOf(cell)] = nc; else { var at2 = 0; while (at2 < row.cells.length && row.cells[at2].c < c) at2++; row.cells.splice(at2, 0, nc); }
          n++;
        }
      }
      if (err) return { err: err };
      var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, n: n };
    });
  }
  // 중복 제거: keys = 기준 열 번호들(1부터), hasHeader 면 첫 줄은 그대로 둔다. 중복 줄은 지워지고 아래 줄들이 위로 올라온다(범위 맨 아래가 비는 것은 엑셀과 같다)
  function removeDuplicates(pkg, sheetName, rng, keys, hasHeader) {
    return readSst(pkg).then(function (sst) {
      return withSheet(pkg, sheetName, function (xml0, tgt) {
        var sd = parseSheet(xml0); if (!sd) return { err: WHY.sheet };
        var r0 = rng.r0 + (hasHeader ? 1 : 0); if (r0 >= rng.r1) return { err: '비교할 줄이 두 줄 이상 있어야 합니다.' };
        var seen = {}, keep = [], dup = [], r;
        for (r = r0; r <= rng.r1; r++) {
          var row = getRow(sd, r, false), parts = keys.map(function (c) { var v = cellVal(row && getCell(row, c, false), sst); return v.k === 'z' ? 'z:' : v.k === 's' ? 's:' + String(v.v).toLowerCase() : v.k + ':' + v.v; }), key = parts.join('\u0001');
          if (parts.every(function (p) { return p === 'z:'; })) { keep.push(r); continue; }
          if (seen[key]) dup.push(r); else { seen[key] = 1; keep.push(r); }
        }
        if (!dup.length) return { ok: true, removed: 0 };
        var order = keep.concat(dup), rr = { r0: r0, r1: rng.r1, c0: rng.c0, c1: rng.c1 };
        return sortRows(pkg, sheetName, rr, order).then(function (res) {
          if (res.err) return res;
          return pkg.read(tgt.path).then(function (x2) {
            var sd2 = parseSheet(x2), from = rng.r1 - dup.length + 1;
            for (var rw = from; rw <= rng.r1; rw++) {
              var row2 = getRow(sd2, rw, false); if (!row2) continue;
              row2.cells = row2.cells.map(function (cl) {
                if (cl.c < rng.c0 || cl.c > rng.c1) return cl;
                var st = attrOf(openTagOfCell(cl.raw), 's'); return { c: cl.c, raw: '<c r="' + colName(cl.c) + rw + '"' + (st != null ? ' s="' + st + '"' : '') + '/>' };
              });
            }
            pkg.write(tgt.path, serializeSheet(sd2)); return { ok: true, removed: dup.length };
          });
        });
      });
    });
  }
  // 텍스트 나누기: col 열의 r0~r1 글을 구분 글자(delim)로 나눠 오른쪽 칸들에 적는다. 오른쪽 칸에 내용이 있으면 하지 않는다
  function textToColumns(pkg, sheetName, col, r0, r1, delim) {
    return readSst(pkg).then(function (sst) {
      return withSheet(pkg, sheetName, function (xml0, tgt) {
        var ex = expandShared(xml0, tgt.name); if (ex.err) return { err: WHY.shared };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        if (!delim) return { err: '나눌 구분 글자를 정해 주십시오.' };
        var plan = [], maxp = 1, r;
        for (r = r0; r <= r1; r++) {
          var row = getRow(sd, r, false), cell = row && getCell(row, col, false), v = cellVal(cell, sst);
          if (v.k === 'z') continue; if (v.f) return { err: '수식이 든 칸은 나눌 수 없습니다.' };
          var txt = v.k === 's' ? v.v : String(v.v), parts = txt.split(delim); if (parts.length > 60) return { err: '한 칸을 60조각을 넘게 나눌 수 없습니다.' };
          plan.push({ r: r, parts: parts, st: cell ? attrOf(openTagOfCell(cell.raw), 's') : null }); maxp = Math.max(maxp, parts.length);
        }
        if (!plan.length) return { err: '나눌 글이 든 칸이 없습니다.' };
        if (maxp < 2) return { err: '구분 글자가 들어 있는 칸이 없습니다.' };
        for (var i = 0; i < plan.length; i++) for (var k = 1; k < plan[i].parts.length; k++) {
          var rw = getRow(sd, plan[i].r, false), ce = rw && getCell(rw, col + k, false);
          if (ce && cellVal(ce, sst).k !== 'z') return { err: '오른쪽 칸(' + colName(col + k) + plan[i].r + ')에 이미 내용이 있어 덮어쓰게 됩니다. 비어 있는 열에서 해 주십시오.' };
        }
        plan.forEach(function (p) {
          p.parts.forEach(function (s, k) {
            var t = s.trim(), val = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t) ? { k: 'n', v: parseFloat(t) } : { k: 's', v: s };
            if (k === 0 && val.k === 's') val = { k: 's', v: s };
            putCell(sd, p.r, col + k, function (ref) { return mkCellXml(ref, p.st, val); });
          });
        });
        var out = serializeSheet(sd); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true, rows: plan.length, cols: maxp };
      });
    });
  }

  // ============================== v10.8 2회차 ②: 이름 · 인쇄 · 시트 복사 · 탭 색 · 시트 보호 · 링크 · 묶기 ==============================
  function absRef(sheet, rng) {
    function a(c, r) { return '$' + colName(c) + '$' + r; }
    return quoteSheet(sheet) + '!' + (rng.r0 === rng.r1 && rng.c0 === rng.c1 ? a(rng.c0, rng.r0) : a(rng.c0, rng.r0) + ':' + a(rng.c1, rng.r1));
  }
  var NM_AFTER = ['calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'];
  function nameItems(wb) {
    var m = /<definedNames\b[^>]*?(?:\/>|>([\s\S]*?)<\/definedNames>)/.exec(wb), items = m && m[1] ? (m[1].match(/<definedName\b[^>]*?(?:\/>|>[\s\S]*?<\/definedName>)/g) || []) : [];
    return { m: m, items: items };
  }
  function parseNameItem(t) {
    var ot = /^<definedName\b[^>]*>/.exec(t)[0], loc = attrOf(ot, 'localSheetId');
    return { name: unescX(attrOf(ot, 'name') || ''), local: loc == null ? null : +loc, text: unescX(t.replace(/^<definedName\b[^>]*>/, '').replace(/<\/definedName>$/, '')), hidden: attrOf(ot, 'hidden') === '1', raw: t };
  }
  function putNameItems(wb, items) {
    var cur = nameItems(wb), block = items.length ? '<definedNames>' + items.join('') + '</definedNames>' : '';
    if (cur.m) return wb.replace(cur.m[0], block);
    if (!block) return wb;
    for (var i = 0; i < NM_AFTER.length; i++) { var k = wb.search(new RegExp('<' + NM_AFTER[i] + '\\b')); if (k >= 0) return wb.slice(0, k) + block + wb.slice(k); }
    return wb.replace('</workbook>', block + '</workbook>');
  }
  function listNames(pkg) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return [];
      return nameItems(info.wb).items.map(parseNameItem).filter(function (n) { return !n.hidden && !/^_xlnm\./.test(n.name); }).map(function (n) { return { name: n.name, ref: n.text, local: n.local, sheet: n.local == null ? null : (info.sheets[n.local] || {}).name || null }; });
    });
  }
  function nameOk(n) {
    if (!n || !n.trim()) return '이름을 적어 주십시오.';
    if (n.length > 200) return '이름은 200자까지입니다.';
    if (!/^[A-Za-z_\u00C0-\uFFFF][\w.\u00C0-\uFFFF]*$/.test(n)) return '이름은 글자나 밑줄(_)로 시작하고, 글자·숫자·점·밑줄만 쓸 수 있습니다(띄어쓰기 불가).';
    if (/^[A-Za-z]{1,3}\d+$/.test(n) || /^[Rr]\d*[Cc]\d*$/.test(n) || /^[RrCc]$/.test(n)) return '칸 주소처럼 보이는 이름은 쓸 수 없습니다.';
    if (/^_xlnm\./i.test(n)) return '이 이름은 쓸 수 없습니다.';
    return '';
  }
  // 이름 붙이기: refText 는 「'시트'!$A$1:$B$5」 꼴. scopeSheet 가 있으면 그 시트에서만 쓰는 이름
  function setName(pkg, name, refText, scopeSheet) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var bad = nameOk(name); if (bad) return { err: bad };
      var local = null; if (scopeSheet) { info.sheets.forEach(function (s) { if (sameName(s.name, scopeSheet)) local = s.idx; }); if (local == null) return { err: WHY.sheet }; }
      var items = nameItems(info.wb).items, found = false;
      items = items.map(function (t) { var p = parseNameItem(t); if (sameName(p.name, name) && p.local === local) { found = true; return '<definedName name="' + escX(name) + '"' + (local != null ? ' localSheetId="' + local + '"' : '') + '>' + escX(refText) + '</definedName>'; } return t; });
      if (!found) items.push('<definedName name="' + escX(name) + '"' + (local != null ? ' localSheetId="' + local + '"' : '') + '>' + escX(refText) + '</definedName>');
      pkg.write('xl/workbook.xml', putNameItems(info.wb, items)); return { ok: true, replaced: found };
    });
  }
  function removeName(pkg, name, local) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var n0 = 0, items = nameItems(info.wb).items.filter(function (t) { var p = parseNameItem(t); if (sameName(p.name, name) && p.local === (local == null ? null : local)) { n0++; return false; } return true; });
      if (!n0) return { err: '지울 이름을 찾지 못했습니다.' };
      pkg.write('xl/workbook.xml', putNameItems(info.wb, items)); return { ok: true };
    });
  }
  function setSpecialName(info, local, special, text) {      // 인쇄 영역·인쇄 제목: text 가 없으면 지운다
    var items = nameItems(info.wb).items.filter(function (t) { var p = parseNameItem(t); return !(p.name === special && p.local === local); });
    if (text) items.push('<definedName name="' + special + '" localSheetId="' + local + '">' + escX(text) + '</definedName>');
    return putNameItems(info.wb, items);
  }
  function readPrintNames(info, idx) {
    var o = { area: '', titles: '' };
    nameItems(info.wb).items.map(parseNameItem).forEach(function (p) { if (p.local === idx) { if (p.name === '_xlnm.Print_Area') o.area = p.text; if (p.name === '_xlnm.Print_Titles') o.titles = p.text; } });
    return o;
  }
  function setPrintArea(pkg, sheetName, rng) {
    return wbInfo(pkg).then(function (info) {
      var s = null; info && info.sheets.forEach(function (x) { if (sameName(x.name, sheetName)) s = x; }); if (!s) return { err: WHY.sheet };
      pkg.write('xl/workbook.xml', setSpecialName(info, s.idx, '_xlnm.Print_Area', rng ? absRef(s.name, rng) : null)); return { ok: true };
    });
  }
  // 반복해서 인쇄할 제목: rows = {r0,r1}|null, cols = {c0,c1}|null (둘 다 없으면 지움)
  function setPrintTitles(pkg, sheetName, rows, cols) {
    return wbInfo(pkg).then(function (info) {
      var s = null; info && info.sheets.forEach(function (x) { if (sameName(x.name, sheetName)) s = x; }); if (!s) return { err: WHY.sheet };
      var q = quoteSheet(s.name), parts = [];
      if (cols) parts.push(q + '!$' + colName(cols.c0) + ':$' + colName(cols.c1));
      if (rows) parts.push(q + '!$' + rows.r0 + ':$' + rows.r1);
      pkg.write('xl/workbook.xml', setSpecialName(info, s.idx, '_xlnm.Print_Titles', parts.length ? parts.join(',') : null)); return { ok: true };
    });
  }
  // sheetPr 의 자식(tabColor · outlinePr · pageSetUpPr)을 바꾼다. edit(kids) 가 kids 를 고친다.
  function editSheetPr(xml, edit) {
    var m = /<sheetPr\b([^>]*?)(\/?)>/.exec(xml), kids = { tabColor: '', outlinePr: '', pageSetUpPr: '' }, attrs = '', whole = null;
    if (m) {
      attrs = m[1].replace(/\s+$/, ''); whole = m[0];
      if (m[2] !== '/') { var e = xml.indexOf('</sheetPr>', m.index); if (e < 0) return null; whole = xml.slice(m.index, e + 10); var inner = xml.slice(m.index + m[0].length, e); Object.keys(kids).forEach(function (k) { var km = new RegExp('<' + k + '\\b[^>]*?/>').exec(inner); if (km) kids[k] = km[0]; }); }
    }
    edit(kids);
    var body = kids.tabColor + kids.outlinePr + kids.pageSetUpPr, nt = '<sheetPr' + attrs + (body ? '>' + body + '</sheetPr>' : '/>');
    if (whole) return xml.replace(whole, nt);
    return body ? insertWsElement(xml, 'sheetPr', nt) : xml;
  }
  var PAPER = { A4: 9, A3: 8, A5: 11, B5: 13, Letter: 1, Legal: 5 }, PAPER_R = { 9: 'A4', 8: 'A3', 11: 'A5', 13: 'B5', 1: 'Letter', 5: 'Legal' };
  var MARGINS = { normal: [0.7, 0.7, 0.75, 0.75, 0.3, 0.3], narrow: [0.25, 0.25, 0.75, 0.75, 0.3, 0.3], wide: [1, 1, 1, 1, 0.5, 0.5] };
  function readPageSetup(xml) {
    var ps = /<pageSetup\b[^>]*?\/>/.exec(xml), o = { orient: 'portrait', paper: 'A4', fit: false, center: false, pageNum: false };
    if (ps) { var pt = attrOf(ps[0], 'paperSize'); o.paper = PAPER_R[+pt] || (pt ? '기타' : 'A4'); if (attrOf(ps[0], 'orientation') === 'landscape') o.orient = 'landscape'; }
    var sp = /<pageSetUpPr\b[^>]*?\/>/.exec(xml); o.fit = !!(sp && /fitToPage="(1|true)"/.test(sp[0]) && ps && attrOf(ps[0], 'fitToWidth') !== '0');
    o.center = /<printOptions\b[^>]*horizontalCentered="(1|true)"/.test(xml);
    o.pageNum = /<oddFooter>[\s\S]*&amp;P/.test(xml);
    return o;
  }
  // o = { orient, paper, margin, fitWidth(true/false/undefined), center, pageNum } — 정하지 않은 것은 그대로 둔다
  function setPageSetup(pkg, sheetName, o) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var ps = /<pageSetup\b[^>]*?\/>/.exec(xml), tag = ps ? ps[0] : '<pageSetup/>';
      if (/\sr:id="/.test(tag) && (o.paper || o.orient)) { /* 프린터 설정 연결은 그대로 둔다 */ }
      if (o.paper) tag = setAttr(tag, 'paperSize', String(PAPER[o.paper] || 9));
      if (o.orient) tag = setAttr(tag, 'orientation', o.orient === 'landscape' ? 'landscape' : 'portrait');
      if (o.fitWidth === true) { tag = setAttr(setAttr(tag, 'fitToWidth', '1'), 'fitToHeight', '0'); tag = delAttr(tag, 'scale'); }
      else if (o.fitWidth === false) { tag = delAttr(delAttr(tag, 'fitToWidth'), 'fitToHeight'); }
      xml = ps ? xml.replace(ps[0], tag) : insertWsElement(xml, 'pageSetup', tag);
      if (o.fitWidth != null) {
        xml = editSheetPr(xml, function (k) { k.pageSetUpPr = o.fitWidth ? '<pageSetUpPr fitToPage="1"/>' : ''; });
        if (xml == null) return { err: '이 시트의 인쇄 정보가 특이해서 바꿀 수 없습니다.' };
      }
      if (o.margin && MARGINS[o.margin]) {
        var mg = MARGINS[o.margin], nm = '<pageMargins left="' + mg[0] + '" right="' + mg[1] + '" top="' + mg[2] + '" bottom="' + mg[3] + '" header="' + mg[4] + '" footer="' + mg[5] + '"/>', pm = /<pageMargins\b[^>]*?\/>/.exec(xml);
        xml = pm ? xml.replace(pm[0], nm) : insertWsElement(xml, 'pageMargins', nm);
      }
      if (o.center != null) {
        var po = /<printOptions\b[^>]*?\/>/.exec(xml), pt2 = po ? po[0] : '<printOptions/>';
        pt2 = o.center ? setAttr(pt2, 'horizontalCentered', '1') : delAttr(pt2, 'horizontalCentered');
        if (po) xml = xml.replace(po[0], pt2); else if (o.center) xml = insertWsElement(xml, 'printOptions', pt2);
      }
      if (o.pageNum != null) {
        var hf = /<headerFooter\b[^>]*?(?:\/>|>[\s\S]*?<\/headerFooter>)/.exec(xml);
        if (o.pageNum) {
          var foot = '<oddFooter>&amp;C&amp;P / &amp;N</oddFooter>';
          if (!hf) xml = insertWsElement(xml, 'headerFooter', '<headerFooter>' + foot + '</headerFooter>');
          else if (/<oddFooter>/.test(hf[0])) xml = xml.replace(hf[0], hf[0].replace(/<oddFooter>[\s\S]*?<\/oddFooter>/, foot));
          else if (/<(evenHeader|evenFooter|firstHeader|firstFooter)>/.test(hf[0])) return { err: '이 시트에는 홀짝·첫 쪽을 따로 정한 머리글·바닥글이 있어 폰에서는 쪽 번호를 넣을 수 없습니다.' };
          else xml = xml.replace(hf[0], /\/>$/.test(hf[0]) ? hf[0].replace(/\/>$/, '>' + foot + '</headerFooter>') : hf[0].replace('</headerFooter>', foot + '</headerFooter>'));
        } else if (hf) xml = xml.replace(hf[0], hf[0].replace(/<oddFooter>[\s\S]*?<\/oddFooter>/, ''));
      }
      pkg.write(tgt.path, xml); return { ok: true };
    });
  }
  function setTabColor(pkg, sheetName, hex) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var nx = editSheetPr(xml, function (k) { k.tabColor = hex ? '<tabColor rgb="' + argb(hex) + '"/>' : ''; });
      if (nx == null) return { err: '이 시트의 정보가 특이해서 탭 색을 바꿀 수 없습니다.' };
      pkg.write(tgt.path, nx); return { ok: true };
    });
  }
  function readTabColor(xml) { var m = /<tabColor\b[^>]*?\srgb="([0-9A-Fa-f]{8})"/.exec(xml); return m ? '#' + m[1].slice(2) : null; }
  // 시트 보호(암호 없이). on=false 로 풀 때 암호가 걸려 있으면 하지 않는다
  function readProtect(xml) { var m = /<sheetProtection\b[^>]*?\/>/.exec(xml); if (!m) return { on: false, pw: false }; var t = m[0]; return { on: attrOf(t, 'sheet') === '1' || attrOf(t, 'sheet') === 'true', pw: !!(attrOf(t, 'password') || attrOf(t, 'hashValue') || attrOf(t, 'algorithmName')) }; }
  function setProtect(pkg, sheetName, on) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var cur = readProtect(xml), m = /<sheetProtection\b[^>]*?\/>/.exec(xml);
      if (on) {
        if (cur.on) return { err: '이미 보호된 시트입니다.' };
        var tag = '<sheetProtection sheet="1" objects="1" scenarios="1"/>';
        xml = m ? xml.replace(m[0], tag) : insertWsElement(xml, 'sheetProtection', tag);
      } else {
        if (!m || !cur.on) return { err: '보호되어 있지 않은 시트입니다.' };
        if (cur.pw) return { err: '암호가 걸린 보호입니다. 암호를 모르면 풀 수 없고, 암호를 입력하는 일은 이 앱에서 하지 않습니다. 엑셀에서 풀어 주십시오.' };
        xml = xml.replace(m[0], '');
      }
      pkg.write(tgt.path, xml); return { ok: true };
    });
  }
  // 시트 복사: 맨 뒤에 만든다. 그림·차트·메모·표 같은 개체가 있는 시트는 하지 않는다
  function copySheet(pkg, srcName, newName) {
    return wbInfo(pkg).then(function (info) {
      if (!info) return { err: WHY.sheet };
      var src = null; info.sheets.forEach(function (s) { if (sameName(s.name, srcName)) src = s; }); if (!src || !src.path) return { err: WHY.sheet };
      var bad = checkSheetName(info, newName, null); if (bad) return { err: bad };
      var rp = src.path.replace(/([^\/]+)$/, '_rels/$1.rels');
      return Promise.all([pkg.read(src.path), pkg.read(rp)]).then(function (a) {
        var xml = a[0], rels = a[1], keepRels = '';
        if (rels) {
          var tags = rels.match(/<Relationship\b[^>]*>/g) || [], other = tags.filter(function (t) { return !/\/(hyperlink|printerSettings)$/.test(attrOf(t, 'Type') || ''); });
          if (other.length) return { err: '이 시트에는 그림·차트·메모·표 같은 개체가 있어서 폰에서는 복사할 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
          var hl = tags.filter(function (t) { return /\/hyperlink$/.test(attrOf(t, 'Type') || ''); }); if (hl.length) keepRels = hl.join('');
        }
        xml = xml.replace(/(<pageSetup\b[^>]*?)\sr:id="[^"]*"/, '$1').replace(/\stabSelected="[^"]*"/, '');
        if (!keepRels) xml = xml.replace(/<hyperlinks\b[^>]*?(?:\/>|>[\s\S]*?<\/hyperlinks>)/, '');
        var mx = 0; pkg.list().forEach(function (p) { var m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p); if (m) mx = Math.max(mx, +m[1]); });
        var path = 'xl/worksheets/sheet' + (mx + 1) + '.xml', rid = 'rId' + (Object.keys(info.rel).length + 100), sid = 0;
        (info.wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t) { sid = Math.max(sid, +(attrOf(t, 'sheetId') || 0)); });
        var rattr = /\s((?:\w+:)?id)="/.exec(src.tag || ''), ra = rattr ? rattr[1] : 'r:id';
        pkg.write(path, xml);
        if (keepRels) pkg.write(path.replace(/([^\/]+)$/, '_rels/$1.rels'), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + keepRels + '</Relationships>');
        pkg.write('xl/_rels/workbook.xml.rels', info.rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (mx + 1) + '.xml"/></Relationships>'));
        pkg.write('[Content_Types].xml', info.ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
        pkg.write('xl/workbook.xml', info.wb.replace('</sheets>', '<sheet name="' + escX(newName) + '" sheetId="' + (sid + 1) + '" ' + ra + '="' + rid + '"/></sheets>'));
        return { ok: true };
      });
    });
  }
  // ---- 링크(하이퍼링크) ----
  function readLinks(xml) {
    var m = /<hyperlinks\b[^>]*?(?:\/>|>([\s\S]*?)<\/hyperlinks>)/.exec(xml); if (!m || !m[1]) return [];
    return (m[1].match(/<hyperlink\b[^>]*?\/>/g) || []).map(function (t) { return { ref: attrOf(t, 'ref'), rid: attrOf(t, 'r:id'), loc: attrOf(t, 'location') ? unescX(attrOf(t, 'location')) : null, raw: t }; });
  }
  // target = { url } | { loc: "시트!A1" } | null(범위 안의 링크를 지움)
  function setLink(pkg, sheetName, rng, target) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var rp = tgt.path.replace(/([^\/]+)$/, '_rels/$1.rels');
      return pkg.read(rp).then(function (rels) {
        var links = readLinks(xml), hit = [], keep = [];
        links.forEach(function (l) { var p = l.ref && rangeParts(l.ref); if (p && !(p.r1 < rng.r0 || p.r0 > rng.r1 || p.c1 < rng.c0 || p.c0 > rng.c1)) hit.push(l); else keep.push(l); });
        if (!target && !hit.length) return { err: '이 범위에는 지울 링크가 없습니다.' };
        var rtxt = rels || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
        hit.forEach(function (l) { if (l.rid) { var re = new RegExp('<Relationship\\b[^>]*\\sId="' + l.rid + '"[^>]*?/>'); rtxt = rtxt.replace(re, ''); } });
        var newTag = null;
        if (target) {
          if (target.loc) newTag = '<hyperlink ref="' + rangeText(rng) + '" location="' + escX(target.loc) + '" display="' + escX(target.display || '') + '"/>';
          else {
            var u = String(target.url || '').trim();
            if (!/^(https?:\/\/|mailto:)/i.test(u)) u = 'https://' + u;
            if (!/^(https?:\/\/[^\s\\]+|mailto:[^\s\\]+)$/i.test(u) || u.length > 2000) return { err: '주소는 http:// · https:// · mailto: 로 시작하는 올바른 주소여야 합니다.' };
            var mx = 0; (rtxt.match(/\sId="rId(\d+)"/g) || []).forEach(function (t) { mx = Math.max(mx, +/(\d+)/.exec(t)[1]); });
            var rid = 'rId' + (mx + 1);
            rtxt = rtxt.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + escX(u) + '" TargetMode="External"/></Relationships>');
            newTag = '<hyperlink ref="' + rangeText(rng) + '" r:id="' + rid + '"/>';
          }
          if (!/<worksheet\b[^>]*\sxmlns:r="/.test(xml)) xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
        }
        var all = keep.map(function (l) { return l.raw; }); if (newTag) all.push(newTag);
        xml = xml.replace(/<hyperlinks\b[^>]*?(?:\/>|>[\s\S]*?<\/hyperlinks>)/, '');
        if (all.length) xml = insertWsElement(xml, 'hyperlinks', '<hyperlinks>' + all.join('') + '</hyperlinks>');
        pkg.write(tgt.path, xml);
        if ((rtxt.match(/<Relationship\b/g) || []).length) pkg.write(rp, rtxt); else if (rels) pkg.remove(rp);
        return { ok: true, removed: hit.length };
      });
    });
  }
  // ---- 줄·열 묶기(그룹) ----
  function modCols(xml, c0, c1, fn) {          // c0~c1 칸 정의를 낱칸 단위로 잘라 fn(tag)→tag 로 고친다
    var m = /<cols\b[^>]*?>([\s\S]*?)<\/cols>/.exec(xml), defs = m ? (m[1].match(/<col\b[^>]*\/>/g) || []).map(function (t) { return { min: +attrOf(t, 'min'), max: +attrOf(t, 'max'), tag: t }; }) : [], out = [], covered = {}, c;
    defs.forEach(function (d) {
      if (d.max < c0 || d.min > c1) { out.push(d); return; }
      if (d.min < c0) out.push({ min: d.min, max: c0 - 1, tag: setAttr(setAttr(d.tag, 'min', String(d.min)), 'max', String(c0 - 1)) });
      for (c = Math.max(d.min, c0); c <= Math.min(d.max, c1); c++) { covered[c] = 1; out.push({ min: c, max: c, tag: fn(setAttr(setAttr(d.tag, 'min', String(c)), 'max', String(c))) }); }
      if (d.max > c1) out.push({ min: c1 + 1, max: d.max, tag: setAttr(setAttr(d.tag, 'min', String(c1 + 1)), 'max', String(d.max)) });
    });
    for (c = c0; c <= c1; c++) if (!covered[c]) out.push({ min: c, max: c, tag: fn('<col min="' + c + '" max="' + c + '" width="9.140625"/>') });
    out.sort(function (a, b) { return a.min - b.min; });
    xml = xml.replace(/<cols\b[^>]*?(?:\/>|>[\s\S]*?<\/cols>)/, '');
    return out.length ? insertWsElement(xml, 'cols', '<cols>' + out.map(function (x) { return x.tag; }).join('') + '</cols>') : xml;
  }
  function setSheetFormatOutline(xml, rowLv, colLv) {
    var m = /<sheetFormatPr\b[^>]*?\/>/.exec(xml); if (!m) return insertWsElement(xml, 'sheetFormatPr', '<sheetFormatPr defaultRowHeight="15"' + (rowLv ? ' outlineLevelRow="' + rowLv + '"' : '') + (colLv ? ' outlineLevelCol="' + colLv + '"' : '') + '/>');
    var t = m[0];
    if (rowLv != null) t = rowLv ? setAttr(t, 'outlineLevelRow', String(rowLv)) : delAttr(t, 'outlineLevelRow');
    if (colLv != null) t = colLv ? setAttr(t, 'outlineLevelCol', String(colLv)) : delAttr(t, 'outlineLevelCol');
    return xml.replace(m[0], t);
  }
  // axis 'row'|'col', op 'group'|'ungroup'|'collapse'|'expand', [i0,i1] 1부터
  function setOutline(pkg, sheetName, axis, i0, i1, op) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var i;
      if (axis === 'row') {
        var sd = parseSheet(xml); if (!sd) return { err: WHY.sheet };
        for (i = i0; i <= i1; i++) {
          var row = getRow(sd, i, true), lv = +(attrOf(row.open, 'outlineLevel') || 0);
          if (op === 'group') { if (lv >= 7) return { err: '묶음은 7단계까지입니다.' }; row.open = setAttr(row.open, 'outlineLevel', String(lv + 1)); }
          else if (op === 'ungroup') { row.open = lv > 1 ? setAttr(row.open, 'outlineLevel', String(lv - 1)) : delAttr(delAttr(delAttr(row.open, 'outlineLevel'), 'hidden'), 'collapsed'); }
          else if (op === 'collapse') { if (lv > 0) row.open = setAttr(row.open, 'hidden', '1'); }
          else if (op === 'expand') { row.open = delAttr(row.open, 'hidden'); }
        }
        var sr = getRow(sd, i1 + 1, true);
        if (op === 'collapse') sr.open = setAttr(sr.open, 'collapsed', '1'); else if (op === 'expand') sr.open = delAttr(sr.open, 'collapsed');
        var mxl = 0; sd.rows.forEach(function (r) { mxl = Math.max(mxl, +(attrOf(r.open, 'outlineLevel') || 0)); });
        var out = serializeSheet(sd); out = setSheetFormatOutline(out, mxl, null); pkg.write(tgt.path, setDimension(out, dimensionOf(parseSheet(out)))); return { ok: true };
      }
      var changed = false;
      xml = modCols(xml, i0, i1, function (tag) {
        var lv = +(attrOf(tag, 'outlineLevel') || 0);
        if (op === 'group') { changed = true; return setAttr(tag, 'outlineLevel', String(Math.min(7, lv + 1))); }
        if (op === 'ungroup') return lv > 1 ? setAttr(tag, 'outlineLevel', String(lv - 1)) : delAttr(delAttr(delAttr(tag, 'outlineLevel'), 'hidden'), 'collapsed');
        if (op === 'collapse') return lv > 0 ? setAttr(tag, 'hidden', '1') : tag;
        return delAttr(tag, 'hidden');
      });
      var after = /<cols\b[^>]*?>([\s\S]*?)<\/cols>/.exec(xml), mxc = 0; if (after) (after[1].match(/<col\b[^>]*\/>/g) || []).forEach(function (t) { mxc = Math.max(mxc, +(attrOf(t, 'outlineLevel') || 0)); });
      xml = setSheetFormatOutline(xml, null, mxc);
      var oc = i1 + 1; if (op === 'collapse' || op === 'expand') xml = modCols(xml, oc, oc, function (tag) { return op === 'collapse' ? setAttr(tag, 'collapsed', '1') : delAttr(tag, 'collapsed'); });
      pkg.write(tgt.path, xml); return { ok: true };
    });
  }
  function readOutline(xml) {
    var rows = {}, cols = {};
    (xml.match(/<row\b[^>]*>/g) || []).forEach(function (t) { var lv = +(attrOf(t, 'outlineLevel') || 0); if (lv) rows[attrOf(t, 'r')] = lv; });
    return { rowLevels: Object.keys(rows).length, any: Object.keys(rows).length > 0 || /<col\b[^>]*outlineLevel=/.test(xml) };
  }

  // ============================== v10.8 2회차 ③: 메모(셀 메모) ==============================
  // 엑셀은 메모를 그리는 VML 그림 파일이 없으면 메모를 조용히 무시한다 — 그래서 메모 글(comments)과 VML 그림을 항상 함께 넣고 뺀다.
  function relsOf(pkg, path) {
    var rp = path.replace(/([^\/]+)$/, '_rels/$1.rels');
    return pkg.read(rp).then(function (x) {
      var tags = x ? (x.match(/<Relationship\b[^>]*>/g) || []) : [];
      return { path: rp, xml: x, tags: tags.map(function (t) { return { id: attrOf(t, 'Id'), type: (attrOf(t, 'Type') || '').replace(/^.*\//, ''), target: attrOf(t, 'Target'), raw: t }; }) };
    });
  }
  function resolvePath(from, target) {
    var parts = (target.charAt(0) === '/' ? target.slice(1) : from.replace(/[^\/]+$/, '') + target).split('/'), out = [];
    parts.forEach(function (p) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }); return out.join('/');
  }
  function memoParts(xml) {
    var items = (xml.match(/<comment\b[^>]*?(?:\/>|>[\s\S]*?<\/comment>)/g) || []).map(function (t) {
      var ref = attrOf(/^<comment\b[^>]*>/.exec(t)[0], 'ref'), txt = (t.match(/<t\b[^>]*>([^<]*)<\/t>/g) || []).map(function (x) { return unescX(x.replace(/<[^>]*>/g, '')); }).join('');
      return { ref: ref, text: txt, raw: t };
    });
    return items;
  }
  function readMemos(pkg, sheetName) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      return relsOf(pkg, tgt.path).then(function (rl) {
        var cr = rl.tags.filter(function (t) { return t.type === 'comments'; })[0]; if (!cr) return { ok: true, list: [] };
        return pkg.read(resolvePath(tgt.path, cr.target)).then(function (cx) { return { ok: true, list: cx ? memoParts(cx).map(function (m) { return { ref: m.ref, text: m.text }; }) : [] }; });
      });
    });
  }
  function vmlShape(id, row0, col0) {
    return '<v:shape id="_x0000_s' + id + '" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:5pt;width:140pt;height:60pt;z-index:' + (id % 1000) + ';visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>' + (col0 + 1) + ', 15, ' + row0 + ', 2, ' + (col0 + 3) + ', 15, ' + (row0 + 4) + ', 4</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>' + row0 + '</x:Row><x:Column>' + col0 + '</x:Column></x:ClientData></v:shape>';
  }
  var VML_HEAD = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
  // 메모 달기·고치기(text 가 있으면) · 지우기(text 가 비면). ref = 'B3' 한 칸
  function setMemo(pkg, sheetName, ref, text) {
    return withSheet(pkg, sheetName, function (xml, tgt) {
      var rm = /^([A-Z]+)(\d+)$/.exec(ref); if (!rm) return { err: '칸 하나를 골라 주십시오.' };
      var col0 = colNum(rm[1]) - 1, row0 = +rm[2] - 1, clean = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
      if (clean.length > 3000) return { err: '메모는 3,000자까지입니다.' };
      return relsOf(pkg, tgt.path).then(function (rl) {
        var cr = rl.tags.filter(function (t) { return t.type === 'comments'; })[0], vr = rl.tags.filter(function (t) { return t.type === 'vmlDrawing'; })[0];
        if (!cr && vr) return { err: '이 시트에는 메모가 아닌 다른 양식 개체(단추·선택 상자 등)가 있어서 폰에서는 메모를 달 수 없습니다.' };
        if (cr && !vr) return { err: '이 시트의 메모 구조가 특이해서 폰에서는 메모를 바꿀 수 없습니다.' };
        var mx = 0; pkg.list().forEach(function (p) { var m = /^xl\/comments(\d+)\.xml$/.exec(p); if (m) mx = Math.max(mx, +m[1]); });
        var cPath = cr ? resolvePath(tgt.path, cr.target) : 'xl/comments' + (mx + 1) + '.xml', vPath = null;
        if (vr) vPath = resolvePath(tgt.path, vr.target); else { var mv = 0; pkg.list().forEach(function (p) { var m = /^xl\/drawings\/vmlDrawing(\d+)\.vml$/.exec(p); if (m) mv = Math.max(mv, +m[1]); }); vPath = 'xl/drawings/vmlDrawing' + (mv + 1) + '.vml'; }
        return Promise.all([cr ? pkg.read(cPath) : Promise.resolve(null), vr ? pkg.read(vPath) : Promise.resolve(null)]).then(function (a) {
          var cx = a[0], vx = a[1], hadAny = !!cx;
          if (cr && (!cx || !vx)) return { err: '이 시트의 메모 파일을 읽지 못했습니다.' };
          if (!cx) cx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>메모</author></authors><commentList></commentList></comments>';
          if (!vx) vx = VML_HEAD + '</xml>';
          var items = memoParts(cx), had = items.filter(function (m) { return m.ref === ref; })[0];
          if (!clean.trim()) {
            if (!had) return { err: '이 칸에는 지울 메모가 없습니다.' };
            items = items.filter(function (m) { return m.ref !== ref; });
            vx = vx.replace(new RegExp('<v:shape\\b[^>]*>(?:(?!</v:shape>)[\\s\\S])*?<x:Row>' + row0 + '</x:Row>\\s*<x:Column>' + col0 + '</x:Column>[\\s\\S]*?</v:shape>'), '');
          } else {
            var item = '<comment ref="' + ref + '" authorId="0"><text><r><t xml:space="preserve">' + escX(clean) + '</t></r></text></comment>';
            if (had) items = items.map(function (m) { return m.ref === ref ? { ref: ref, raw: item } : m; });
            else {
              items.push({ ref: ref, raw: item });
              var mid = 1024; (vx.match(/_x0000_s(\d+)/g) || []).forEach(function (t) { mid = Math.max(mid, +/(\d+)$/.exec(t)[1]); });
              vx = vx.replace('</xml>', vmlShape(mid + 1, row0, col0) + '</xml>');
            }
          }
          items.sort(function (p, q) { var pm = /^([A-Z]+)(\d+)$/.exec(p.ref), qm = /^([A-Z]+)(\d+)$/.exec(q.ref); return (+pm[2] - +qm[2]) || (colNum(pm[1]) - colNum(qm[1])); });
          var rootOpen = /<comments\b[^>]*>/.exec(cx)[0], authors = (/<authors>[\s\S]*?<\/authors>/.exec(cx) || ['<authors><author>메모</author></authors>'])[0];
          var ncx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + rootOpen + authors + '<commentList>' + items.map(function (m) { return m.raw; }).join('') + '</commentList></comments>';
          if (!items.length && hadAny && !/<x:ClientData ObjectType="(?!Note)/.test(vx)) {      // 마지막 메모를 지우면 메모 파일 일체를 걷어 낸다
            pkg.remove(cPath); pkg.remove(vPath);
            var nr = rl.xml; [cr, vr].forEach(function (t) { nr = nr.replace(t.raw, ''); });
            if (!/<Relationship\b/.test(nr)) pkg.remove(rl.path); else pkg.write(rl.path, nr);
            return pkg.read('[Content_Types].xml').then(function (ct) { pkg.write('[Content_Types].xml', ct.replace(new RegExp('<Override\\b[^>]*PartName="/' + cPath.replace(/[.\\\/]/g, '\\$&') + '"[^>]*/>'), '')); xml = xml.replace(/<legacyDrawing\b[^>]*?\/>/, ''); pkg.write(tgt.path, xml); return { ok: true, removed: true }; });
          }
          pkg.write(cPath, ncx); pkg.write(vPath, vx);
          if (cr) return { ok: true };
          var rtxt = rl.xml || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>', mxid = 0;
          (rtxt.match(/\sId="rId(\d+)"/g) || []).forEach(function (t) { mxid = Math.max(mxid, +/(\d+)/.exec(t)[1]); });
          var cid = 'rId' + (mxid + 1), vid = 'rId' + (mxid + 2);
          rtxt = rtxt.replace('</Relationships>', '<Relationship Id="' + cid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../' + cPath.replace(/^xl\//, '') + '"/><Relationship Id="' + vid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../' + vPath.replace(/^xl\//, '') + '"/></Relationships>');
          pkg.write(rl.path, rtxt);
          if (!/<worksheet\b[^>]*\sxmlns:r="/.test(xml)) xml = xml.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
          xml = insertWsElement(xml, 'legacyDrawing', '<legacyDrawing r:id="' + vid + '"/>'); pkg.write(tgt.path, xml);
          return pkg.read('[Content_Types].xml').then(function (ct) {
            var add = '<Override PartName="/' + cPath + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>';
            if (!/Extension="vml"/i.test(ct)) add += '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>';
            pkg.write('[Content_Types].xml', ct.replace('</Types>', add + '</Types>')); return { ok: true, created: true };
          });
        });
      });
    });
  }

  // ============================== v10.9 2회차: 선택하여 붙여넣기(서식만·행열 바꿔·다른 시트로) · 표로 서식 · 통합 문서 보호 ==============================
  // mode: 'all'(수식·값·서식, 다른 시트로도) · 'values'(값만, 받는 칸 서식 유지) · 'format'(서식만) · 'transpose'(행과 열을 바꿔 — 값과 서식, 수식은 계산된 값으로)
  function pasteSpecial(pkg, srcName, src, dstName, dstR0, dstC0, mode) {
    return wbInfo(pkg).then(function (info) {
      var S0 = null, T0 = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, srcName)) S0 = s; if (sameName(s.name, dstName)) T0 = s; });
      if (!S0 || !S0.path || !T0 || !T0.path) return { err: WHY.sheet };
      var same = S0.path === T0.path;
      return Promise.all([pkg.read(S0.path), same ? Promise.resolve(null) : pkg.read(T0.path)]).then(function (xs) {
        var sx = expandShared(xs[0], S0.name), tx = same ? sx : expandShared(xs[1], T0.name);
        if (sx.err || tx.err) return { err: WHY.shared };
        var nr = src.r1 - src.r0 + 1, nc = src.c1 - src.c0 + 1, tr = mode === 'transpose' ? nc : nr, tc = mode === 'transpose' ? nr : nc;
        if (dstR0 + tr - 1 > MAXR || dstC0 + tc - 1 > MAXC) return { err: '붙일 자리가 시트의 끝을 넘습니다.' };
        if (hitMerge(mergesOf(sx.xml), src.r0, src.c0, src.r1, src.c1) || hitMerge(mergesOf(tx.xml), dstR0, dstC0, dstR0 + tr - 1, dstC0 + tc - 1)) return { err: '합친 칸이 걸려 있어 이 방식으로는 붙일 수 없습니다. 칸 합치기를 풀거나 「수정 요청」으로 맡겨 주십시오.' };
        var sd = parseSheet(sx.xml), td = same ? sd : parseSheet(tx.xml); if (!sd || !td) return { err: WHY.sheet };
        var snap = [], i, j, err = null;
        for (i = 0; i < nr; i++) { var srow = getRow(sd, src.r0 + i, false); snap.push([]); for (j = 0; j < nc; j++) { var sc = srow && getCell(srow, src.c0 + j, false); snap[i].push(sc ? sc.raw : null); } }
        for (i = 0; i < nr && !err; i++) for (j = 0; j < nc; j++) if (snap[i][j] && /<f\b[^>]*\st="(?:array|dataTable)"|\scm="|\svm="/.test(snap[i][j])) { err = '배열 수식이나 특수한 칸이 들어 있어 붙일 수 없습니다. 「수정 요청」으로 맡겨 주십시오.'; break; }
        if (err) return { err: err };
        var n = 0;
        function dropAt(r, c) { var row = getRow(td, r, false); if (!row) return; var o = getCell(row, c, false); if (o) row.cells.splice(row.cells.indexOf(o), 1); }
        function toValue(raw) {
          var o = raw.replace(/<f\b[^>]*>[^<]*<\/f>|<f\b[^>]*\/>/g, '');
          if (/\st="str"/.test(o)) o = o.replace(/\st="str"/, ' t="inlineStr"').replace(/<v>([^<]*)<\/v>/, '<is><t xml:space="preserve">$1</t></is>');
          return o;
        }
        for (i = 0; i < nr && !err; i++) for (j = 0; j < nc && !err; j++) {
          var raw = snap[i][j], r = mode === 'transpose' ? dstR0 + j : dstR0 + i, c = mode === 'transpose' ? dstC0 + i : dstC0 + j;
          var drow = getRow(td, r, true), old = getCell(drow, c, false), oldS = old ? attrOf(openTagOfCell(old.raw), 's') : null;
          if (mode === 'format') {
            var s = raw ? attrOf(openTagOfCell(raw), 's') : null;
            if (old) { var ot = openTagOfCell(old.raw); old.raw = (s != null ? setAttr(ot, 's', s) : delAttr(ot, 's')) + old.raw.slice(ot.length); n++; }
            else if (s != null) { putCell(td, r, c, function (ref) { return '<c r="' + ref + '" s="' + s + '"/>'; }); n++; }
            continue;
          }
          if (!raw) { if (old) { if (mode === 'values' && oldS != null) old.raw = '<c r="' + colName(c) + r + '" s="' + oldS + '"/>'; else dropAt(r, c); } continue; }
          var nraw = raw;
          if (mode === 'values') { nraw = toValue(raw); var ot2 = openTagOfCell(nraw); nraw = (oldS != null ? setAttr(ot2, 's', oldS) : delAttr(ot2, 's')) + nraw.slice(ot2.length); }
          else if (mode === 'transpose') nraw = toValue(raw);
          else {
            var f = /<f\b([^>]*)>([^<]*)<\/f>/.exec(raw);
            if (f) {
              var trf = translateFormula(unescX(f[2]), S0.name, dstR0 - src.r0, dstC0 - src.c0); if (trf.err) { err = '붙일 자리가 시트 범위를 벗어나는 수식이 있습니다.'; break; }
              nraw = raw.replace(/<f\b([^>]*)>([^<]*)<\/f>/, function (all, at) { return '<f' + at + '>' + escX(trf.f) + '</f>'; }).replace(/<v>[^<]*<\/v>/, '').replace(/\st="[^"]*"/, '');
            }
          }
          var keep = nraw; putCell(td, r, c, function (ref) { return keep.replace(/^(<c\b[^>]*?\sr=")[A-Z]+\d+(")/, function (m, x, y) { return x + ref + y; }); }); n++;
        }
        if (err) return { err: err };
        var out = serializeSheet(td); pkg.write(T0.path, setDimension(out, dimensionOf(parseSheet(out))));
        return { ok: true, n: n, nr: tr, nc: tc };
      });
    });
  }

  // ---- 표로 서식: 진짜 엑셀 표(줄무늬 표 스타일 + 머리 줄 필터) + 앱 화면에서도 보이도록 같은 색을 칸 서식으로 함께 넣는다 ----
  var TBL_PRESETS = {
    blue: { name: '파랑', style: 'TableStyleMedium2', hdr: '#4472C4', band: '#D9E1F2' }, orange: { name: '주황', style: 'TableStyleMedium3', hdr: '#ED7D31', band: '#FBE5D6' },
    gray: { name: '회색', style: 'TableStyleMedium4', hdr: '#7F7F7F', band: '#EDEDED' }, gold: { name: '노랑', style: 'TableStyleMedium5', hdr: '#BF9000', band: '#FFF2CC' },
    sky: { name: '하늘', style: 'TableStyleMedium6', hdr: '#5B9BD5', band: '#DDEBF7' }, green: { name: '초록', style: 'TableStyleMedium7', hdr: '#548235', band: '#E2EFDA' }
  };
  function tableFormat(pkg, sheetName, rng, key) {
    var pre = TBL_PRESETS[key]; if (!pre) return Promise.resolve({ err: '알 수 없는 표 스타일입니다.' });
    return wbInfo(pkg).then(function (info) {
      var tgt = null; info && info.sheets.forEach(function (s) { if (sameName(s.name, sheetName)) tgt = s; });
      if (!tgt || !tgt.path) return { err: WHY.sheet };
      if (rng.r1 <= rng.r0) return { err: '머리 줄과 자료 줄이 적어도 한 줄씩 있어야 합니다. 「범위」로 표 전체를 고르십시오.' };
      if (rng.c1 - rng.c0 + 1 > 64 || (rng.r1 - rng.r0 + 1) * (rng.c1 - rng.c0 + 1) > 200000) return { err: '너무 큰 범위입니다(64열·20만 칸 이하).' };
      return Promise.all([pkg.read(tgt.path), readSst(pkg), relsOf(pkg, tgt.path), pkg.read('xl/styles.xml'), pkg.read('[Content_Types].xml')]).then(function (a) {
        var xml = a[0], sst = a[1], rl = a[2], stx = a[3], ct = a[4];
        if (!stx || !ct) return { err: '서식 정보를 찾지 못했습니다.' };
        if (/<autoFilter\b/.test(xml)) return { err: '이 시트에는 이미 필터가 걸려 있어 표로 만들 수 없습니다. 먼저 필터를 지워 주십시오.' };
        if (hitMerge(mergesOf(xml), rng.r0, rng.c0, rng.r1, rng.c1)) return { err: '합친 칸이 걸려 있어 표로 만들 수 없습니다.' };
        var ex = expandShared(xml, tgt.name); if (ex.err) return { err: WHY.shared };
        var sd = parseSheet(ex.xml); if (!sd) return { err: WHY.sheet };
        var st = new Styles(stx); if (!st.hasAll) return { err: '이 문서의 서식 구조가 특이해서 표로 만들 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
        var ref = colName(rng.c0) + rng.r0 + ':' + colName(rng.c1) + rng.r1;
        var existing = pkg.list().filter(function (p) { return /^xl\/tables\/table\d+\.xml$/.test(p); });
        return Promise.all(existing.map(function (p) { return pkg.read(p); })).then(function (tx) {
          var mxId = 0, names = {}, mine = rl.tags.filter(function (t) { return t.type === 'table'; }).map(function (t) { return resolvePath(tgt.path, t.target); }), clash = false;
          tx.forEach(function (t, k) {
            var id = +(attrOf(/<table\b[^>]*>/.exec(t)[0], 'id') || 0); mxId = Math.max(mxId, id); names[(attrOf(/<table\b[^>]*>/.exec(t)[0], 'displayName') || '').toLowerCase()] = 1;
            if (mine.indexOf(existing[k]) >= 0) { var rf = rangeParts(attrOf(/<table\b[^>]*>/.exec(t)[0], 'ref') || ''); if (rf && !(rf.r1 < rng.r0 || rf.r0 > rng.r1 || rf.c1 < rng.c0 || rf.c0 > rng.c1)) clash = true; }
          });
          if (clash) return { err: '고른 범위에 이미 표가 있습니다.' };
          var mxF = 0; existing.forEach(function (p) { mxF = Math.max(mxF, +/(\d+)\.xml$/.exec(p)[1]); });
          var num = Math.max(mxId, mxF) + 1, tname = 'Table' + num; while (names[tname.toLowerCase()]) { num++; tname = 'Table' + num; }
          // 머리 줄: 칸마다 글자여야 하고 서로 달라야 한다
          var hrow = getRow(sd, rng.r0, true), cols = [], seen = {};
          for (var c = rng.c0; c <= rng.c1; c++) {
            var hc = getCell(hrow, c, false), v = cellVal(hc, sst), txt = v.k === 'z' || v.v == null ? '' : String(v.v);
            if (!txt.trim()) txt = '열' + (c - rng.c0 + 1);
            var base = txt, k2 = 2; while (seen[txt.toLowerCase()]) { txt = base + k2; k2++; }
            seen[txt.toLowerCase()] = 1; cols.push(txt);
            var isText = hc && v.k === 's' && !v.f && txt === base && (attrOf(openTagOfCell(hc.raw), 't') === 's' || attrOf(openTagOfCell(hc.raw), 't') === 'inlineStr');
            if (!isText) { var s0 = hc ? attrOf(openTagOfCell(hc.raw), 's') : null; putCell(sd, rng.r0, c, function (rf2) { return '<c r="' + rf2 + '"' + (s0 != null ? ' s="' + s0 + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + escX(txt) + '</t></is></c>'; }); }
          }
          // 칸 서식(머리 줄 색·글자, 홀수 자료 줄 색)
          for (var r = rng.r0; r <= rng.r1; r++) {
            var row = getRow(sd, r, true), ch = r === rng.r0 ? { bg: pre.hdr, color: '#FFFFFF', bold: true } : ((r - rng.r0) % 2 === 1 ? { bg: pre.band } : null);
            if (!ch) continue;
            for (var cc = rng.c0; cc <= rng.c1; cc++) { var cell = getCell(row, cc, true); setCellAttr(cell, 's', String(st.derive(cellStyleOf(cell.raw), ch))); }
          }
          var out = serializeSheet(sd); out = setDimension(out, dimensionOf(parseSheet(out)));
          if (!/<worksheet\b[^>]*\sxmlns:r="/.test(out)) out = out.replace(/<worksheet\b/, '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
          var rtxt = rl.xml || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>', mxid = 0;
          (rtxt.match(/\sId="rId(\d+)"/g) || []).forEach(function (t) { mxid = Math.max(mxid, +/(\d+)/.exec(t)[1]); });
          var rid = 'rId' + (mxid + 1), tpath = 'xl/tables/table' + (mxF + 1) + '.xml';
          while (pkg.list().indexOf(tpath) >= 0) tpath = 'xl/tables/table' + (+/(\d+)\.xml$/.exec(tpath)[1] + 1) + '.xml';
          rtxt = rtxt.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/' + tpath.replace(/^xl\/tables\//, '') + '"/></Relationships>');
          var tp = /<tableParts\b[^>]*?count="(\d+)"[^>]*>/.exec(out);
          if (tp) out = out.replace(tp[0], tp[0].replace(/count="\d+"/, 'count="' + (+tp[1] + 1) + '"')).replace('</tableParts>', '<tablePart r:id="' + rid + '"/></tableParts>');
          else out = insertWsElement(out, 'tableParts', '<tableParts count="1"><tablePart r:id="' + rid + '"/></tableParts>');
          var tbl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="' + num + '" name="' + tname + '" displayName="' + tname + '" ref="' + ref + '" totalsRowShown="0"><autoFilter ref="' + ref + '"/><tableColumns count="' + cols.length + '">' +
            cols.map(function (t, i) { return '<tableColumn id="' + (i + 1) + '" name="' + escX(t) + '"/>'; }).join('') + '</tableColumns><tableStyleInfo name="' + pre.style + '" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>';
          pkg.write(tgt.path, out); pkg.write('xl/styles.xml', st.serialize()); pkg.write(rl.path, rtxt); pkg.write(tpath, tbl);
          pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/' + tpath + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>'));
          return { ok: true, ref: ref, name: tname };
        });
      });
    });
  }

  // ---- 통합 문서 구조 보호(암호 없이): 시트 추가·삭제·이름 바꾸기·옮기기를 막는다 ----
  function readWbProtect(wbxml) {
    var m = /<workbookProtection\b[^>]*?\/>/.exec(wbxml || ''); if (!m) return { on: false, pw: false };
    return { on: /\slockStructure="(?:1|true)"/.test(m[0]), pw: /\s(?:workbookPassword|workbookHashValue|workbookAlgorithmName|workbookSaltValue)=/.test(m[0]) };
  }
  function setWbProtect(pkg, on) {
    return pkg.read('xl/workbook.xml').then(function (wb) {
      if (!wb) return { err: '통합 문서 정보를 읽지 못했습니다.' };
      var cur = readWbProtect(wb), m = /<workbookProtection\b[^>]*?\/>/.exec(wb);
      if (on) {
        if (cur.on) return { err: '이미 구조가 보호된 문서입니다.' };
        if (m) wb = wb.replace(m[0], setAttr(m[0], 'lockStructure', '1'));
        else { var tag = '<workbookProtection lockStructure="1"/>', bv = /<bookViews\b/.exec(wb), sh = /<sheets\b/.exec(wb); var at = bv ? bv.index : (sh ? sh.index : -1); if (at < 0) return { err: '통합 문서 구조가 특이해서 보호할 수 없습니다.' }; wb = wb.slice(0, at) + tag + wb.slice(at); }
      } else {
        if (!m || !cur.on) return { err: '구조가 보호되어 있지 않은 문서입니다.' };
        if (cur.pw) return { err: '암호가 걸린 보호입니다. 암호를 모르면 풀 수 없고, 암호를 입력하는 일은 이 앱에서 하지 않습니다. 엑셀에서 풀어 주십시오.' };
        var nt = delAttr(m[0], 'lockStructure'); wb = wb.replace(m[0], /\s[A-Za-z]+="/.test(nt) ? nt : '');
      }
      pkg.write('xl/workbook.xml', wb); return { ok: true };
    });
  }
  // 구조 보호 중에는 시트를 더하거나 지우거나 이름·순서를 바꾸지 못하게 한다(엑셀과 같은 규칙)
  var wbGuard = {};
  [['addSheet', addSheet], ['renameSheet', renameSheet], ['deleteSheet', deleteSheet], ['moveSheet', moveSheet], ['copySheet', copySheet]].forEach(function (p) {
    var fn = p[1];
    wbGuard[p[0]] = function (pkg) { var a = arguments; return pkg.read('xl/workbook.xml').then(function (wb) { if (readWbProtect(wb).on) return { err: '통합 문서 구조가 보호되어 있어 시트를 더하거나 지우거나 바꿀 수 없습니다. 「시트」 → 「복사·탭 색·보호」에서 보호를 풀어 주십시오.' }; return fn.apply(null, a); }); };
  });

  var api = {
    pasteSpecial: pasteSpecial, tableFormat: tableFormat, TBL_PRESETS: TBL_PRESETS, readWbProtect: readWbProtect, setWbProtect: setWbProtect,
    setRowsHidden: setRowsHidden, setColsHidden: setColsHidden, showAllHidden: showAllHidden, setFilter: setFilter, readFilter: readFilter, copyRange: copyRange,
    setCachedValues: setCachedValues, freezePanes: freezePanes, readFreeze: readFreeze, addCond: addCond, clearCond: clearCond, readCond: readCond, setValid: setValid, readValid: readValid,
    colNum: colNum, colName: colName, escX: escX, unescX: unescX, WHY: WHY,
    parseSheet: parseSheet, serializeSheet: serializeSheet, getRow: getRow, getCell: getCell, setDimension: setDimension, dimensionOf: dimensionOf,
    shiftRefsInFormula: shiftRefsInFormula, translateFormula: translateFormula, expandShared: expandShared, shiftRangeText: shiftRangeText, mapRefs: mapRefs,
    lineEdit: lineEdit, appendRows: appendRows, checkMiddle: checkMiddle, Styles: Styles, applyStyle: applyStyle,
    mergeCellsOp: mergeCellsOp, setRowHeight: setRowHeight, setColWidth: setColWidth, sortRows: sortRows, fillDown: fillDown,
    fillSeries: fillSeries, fillRight: fillRight, removeDuplicates: removeDuplicates, textToColumns: textToColumns, listNames: listNames, setName: setName, removeName: removeName, nameOk: nameOk, absRef: absRef,
    setPrintArea: setPrintArea, setPrintTitles: setPrintTitles, setPageSetup: setPageSetup, readPageSetup: readPageSetup, readPrintNames: readPrintNames, setTabColor: setTabColor, readTabColor: readTabColor, readProtect: readProtect, setProtect: setProtect,
    setMemo: setMemo, readMemos: readMemos,
    copySheet: copySheet, setLink: setLink, readLinks: readLinks, setOutline: setOutline, readOutline: readOutline, readSst: readSst, cellVal: cellVal,
    insertWsElement: insertWsElement, addSheet: addSheet, renameSheet: renameSheet, deleteSheet: deleteSheet, moveSheet: moveSheet, checkSheetName: checkSheetName, wbInfo: wbInfo, newWorkbookFiles: newWorkbookFiles
  };
  api.x = { parseSheet: parseSheet, serializeSheet: serializeSheet, getRow: getRow, getCell: getCell, putCell: putCell, mkCellXml: mkCellXml, setDimension: setDimension, dimensionOf: dimensionOf, withSheet: withSheet,
    openTagOfCell: openTagOfCell, attrOf: attrOf, setAttr: setAttr, escX: escX, unescX: unescX, colNum: colNum, colName: colName, sameName: sameName, quoteSheet: quoteSheet, readSheets: readSheets, relTypesOf: relTypesOf, WHY: WHY };     // v10.9 5회차: 새 데이터 도구(so-xlsx-data.js)가 같은 도우미를 쓴다
  api.addSheet = wbGuard.addSheet; api.renameSheet = wbGuard.renameSheet; api.deleteSheet = wbGuard.deleteSheet; api.moveSheet = wbGuard.moveSheet; api.copySheet = wbGuard.copySheet;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxStruct = api;
})(typeof window !== 'undefined' ? window : globalThis);

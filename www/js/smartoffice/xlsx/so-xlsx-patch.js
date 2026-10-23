/* so-xlsx-patch.js — S-Office 엑셀 모듈의 「고친 셀만 원본에 끼워 넣는」 저장 도구
 * 원본 .xlsx(zip)를 JSZip 으로 열어, 고친 셀만 해당 시트 XML 의 <c> 에 반영한다.
 * 스타일·차트·그림·피벗·정의된 이름·조건부 서식 등 나머지 파일은 한 글자도 바꾸지 않는다(내용 그대로 다시 묶는다).
 * 라이선스 의존: JSZip(MIT/GPLv3 중 MIT 선택, 앱 vendor/so/docx/jszip.min.js). 새 외부 라이브러리 없음.
 * 시험: Node 에서 require 해서 쓸 수 있다(module.exports).
 */
(function (global) {
  'use strict';

  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unescX(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function cleanText(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/\r\n?/g, '\n'); }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n; }
  function colName(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }

  // ---------------- 열기·분석 ----------------
  // zip 을 살펴 패치 가능한지 판단한다. 돌려주는 값: { ok, reason, sheets:{ 시트이름:{path, xml, readOnly, why} } }
  function analyze(zip) {
    var files = Object.keys(zip.files);
    function has(re) { return files.some(function (k) { return re.test(k); }); }
    if (has(/^xl\/vbaProject/)) return Promise.resolve({ ok: false, reason: '매크로가 들어 있는 파일이에요.' });
    if (has(/^xl\/pivot(Tables|Cache)\//) || has(/^xl\/(slicers|slicerCaches|timelines|timelineCaches)\//)) return Promise.resolve({ ok: false, reason: '피벗표(또는 슬라이서)가 들어 있는 파일이에요.' });
    if (has(/^xl\/workbook\.bin$/)) return Promise.resolve({ ok: false, reason: '이진 형식(xlsb)이에요.' });
    if (!zip.file('xl/workbook.xml') || !zip.file('xl/_rels/workbook.xml.rels')) return Promise.resolve({ ok: false, reason: '파일 구조를 알아볼 수 없어요.' });
    return Promise.all([zip.file('xl/workbook.xml').async('string'), zip.file('xl/_rels/workbook.xml.rels').async('string'),
      zip.file('[Content_Types].xml') ? zip.file('[Content_Types].xml').async('string') : Promise.resolve('')]).then(function (a) {
      var wb = a[0], rels = a[1], ct = a[2];
      if (/macroEnabled/i.test(ct)) return { ok: false, reason: '매크로가 허용된 형식 파일이에요.' };
      if (/<workbook\b[^>]*>/.test(wb) === false || /<[A-Za-z0-9_]+:workbook\b/.test(wb)) return { ok: false, reason: '파일 구조가 특이해요.' };
      var relMap = {};
      (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(function (t) {
        var id = attr(t, 'Id'), tg = attr(t, 'Target'), ty = attr(t, 'Type') || '';
        if (id == null || tg == null) return;
        var path = tg.charAt(0) === '/' ? tg.slice(1) : ('xl/' + tg);
        var parts = [], seg = path.split('/');
        seg.forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
        relMap[id] = { path: parts.join('/'), ws: /\/worksheet$/.test(ty) };
      });
      var sheets = {}, order = [];
      (wb.match(/<sheet\b[^>]*>/g) || []).forEach(function (t) {
        var nm = attr(t, 'name'), rid = (/\s(?:\w+:)id="([^"]+)"/.exec(t) || [])[1];
        if (nm == null) return; nm = unescX(nm);
        var rel = rid && relMap[rid];
        sheets[nm] = { path: rel && rel.ws ? rel.path : null };
        order.push(nm);
      });
      return Promise.all(order.map(function (nm) {
        var sh = sheets[nm];
        if (!sh.path || !zip.file(sh.path)) { sh.path = null; sh.readOnly = true; sh.why = '이 시트는 표가 아니라서(차트 시트 등) 고칠 수 없어요.'; return null; }
        var relPath = sh.path.replace(/([^\/]+)$/, '_rels/$1.rels');
        var relP = zip.file(relPath) ? zip.file(relPath).async('string') : Promise.resolve('');
        return Promise.all([zip.file(sh.path).async('string'), relP]).then(function (pair) {
          var xml = pair[0];
          sh.xml = xml; sh.orig = xml; sh.hdr = []; sh.arr = [];
          // 엑셀 표(ListObject)의 머리글 행 — 머리글 글자는 표 정의와 맞아야 해서 고치지 않는다
          var tabs = (pair[1].match(/<Relationship\b[^>]*>/g) || []).filter(function (t) { return /\/table$/.test(attr(t, 'Type') || ''); });
          sh.tablePromises = tabs.map(function (t) {
            var tg = attr(t, 'Target') || '', p = tg.charAt(0) === '/' ? tg.slice(1) : sh.path.replace(/[^\/]+$/, '') + tg, parts = [];
            p.split('/').forEach(function (x) { if (x === '..') parts.pop(); else if (x !== '.') parts.push(x); });
            p = parts.join('/');
            return zip.file(p) ? zip.file(p).async('string').then(function (tx) {
              var head = (/<table\b[^>]*>/.exec(tx) || [''])[0], rf = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(attr(head, 'ref') || ''), hc = attr(head, 'headerRowCount');
              if (rf && hc !== '0') sh.hdr.push({ r: +rf[2], c0: colNum(rf[1]), c1: colNum(rf[3]) });
            }) : null;
          });
          (xml.match(/<f\b[^>]*>/g) || []).forEach(function (ft) {
            if (attr(ft, 't') !== 'array') return;
            var ar = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(attr(ft, 'ref') || '');
            if (ar) sh.arr.push({ r0: +ar[2], c0: colNum(ar[1]), r1: +(ar[4] || ar[2]), c1: colNum(ar[3] || ar[1]) });
          });
          var dec = /^\s*(?:﻿)?<\?xml[^>]*encoding="([^"]+)"/i.exec(xml);
          if (dec && !/^utf-?8$/i.test(dec[1])) { sh.readOnly = true; sh.why = '이 시트의 글자 인코딩이 특이해서 고칠 수 없어요.'; }
          else if (!/<sheetData[\s>\/]/.test(xml)) { sh.readOnly = true; sh.why = '이 시트의 구조가 특이해서 고칠 수 없어요.'; }
          else if (/<sheetProtection\b/.test(xml)) { sh.readOnly = true; sh.why = '보호된 시트라서 고칠 수 없어요. (엑셀에서 보호를 풀어 주세요)'; }
          return Promise.all(sh.tablePromises);
        });
      })).then(function () { return { ok: true, sheets: sheets, order: order }; });
    });
  }

  // ---------------- 셀 패치 ----------------
  // 새로 만드는 칸에 줄 서식 번호: 행 전체 서식(customFormat) → 열 서식(<col style>)
  function defaultStyle(xml, rowTag, colN) {
    if (rowTag && /\scustomFormat="(1|true)"/.test(rowTag)) { var rs = attr(rowTag, 's'); if (rs != null) return rs; }
    var sd = xml.search(/<sheetData[\s>\/]/), head = sd >= 0 ? xml.slice(0, sd) : xml, cols = head.match(/<col\b[^>]*>/g) || [];
    for (var i = 0; i < cols.length; i++) {
      var mn = +attr(cols[i], 'min'), mx = +attr(cols[i], 'max'), st = attr(cols[i], 'style');
      if (st != null && colN >= mn && colN <= mx) return st;
    }
    return null;
  }
  function numStr(v) { if (typeof v !== 'number' || !isFinite(v)) return null; return String(v); }
  function cellXml(attrs, spec) {
    // attrs: ' r="B3" s="5"' (t 는 이미 빠진 상태)
    switch (spec.kind) {
      case 'n': var ns = numStr(spec.v); if (ns == null) return null; return '<c' + attrs + '><v>' + ns + '</v></c>';
      case 'b': return '<c' + attrs + ' t="b"><v>' + (spec.v ? 1 : 0) + '</v></c>';
      case 's': return '<c' + attrs + ' t="inlineStr"><is><t xml:space="preserve">' + escX(cleanText(spec.v)) + '</t></is></c>';
      case 'f': return '<c' + attrs + '><f>' + escX(cleanText(spec.f)) + '</f></c>';
      case 'empty': return '<c' + attrs + '/>';
    }
    return null;
  }
  // 반환: { xml } 또는 { err }. info.hadFormula 로 기존 수식이 값으로 바뀐 것을 알린다.
  function patchCell(xml, ref, spec) {
    var rm = /^([A-Z]+)(\d+)$/.exec(ref); if (!rm) return { err: '셀 주소를 알 수 없어요.' };
    var cn = colNum(rm[1]), rn = +rm[2];
    if (spec.kind === 's' && String(spec.v).length > 32767) return { err: '한 칸에는 32,767자까지만 넣을 수 있어요.' };
    var sdm = /<sheetData\b[^>]*?(\/?)>/.exec(xml);
    if (!sdm) return { err: '시트 구조가 특이해서 고칠 수 없어요.' };
    if (sdm[1] === '/') xml = xml.slice(0, sdm.index) + '<sheetData></sheetData>' + xml.slice(sdm.index + sdm[0].length);
    var bodyStart = sdm.index + (sdm[1] === '/' ? '<sheetData>'.length : sdm[0].length);
    var sdEnd = xml.indexOf('</sheetData>', bodyStart);
    if (sdEnd < 0) return { err: '시트 구조가 특이해서 고칠 수 없어요.' };

    // 행 찾기
    var rowRe = /<row\b[^>]*>/g, rowTag = null, rowIdx = -1, insertAt = sdEnd, m;
    rowRe.lastIndex = bodyStart;
    while ((m = rowRe.exec(xml)) && m.index < sdEnd) {
      var r = +attr(m[0], 'r');
      if (!r) return { err: '행 번호가 없는 시트라서 고칠 수 없어요.' };
      if (r === rn) { rowTag = m[0]; rowIdx = m.index; break; }
      if (r > rn) { insertAt = m.index; break; }
    }
    var info = { hadFormula: false };
    if (rowIdx < 0) {
      var st0 = defaultStyle(xml, null, cn), at0 = ' r="' + ref + '"' + (st0 != null ? ' s="' + st0 + '"' : '');
      var nc = cellXml(at0, spec); if (nc == null) return { err: '숫자를 넣을 수 없어요.' };
      if (spec.kind === 'empty') return { xml: xml, info: info, noop: true };
      xml = xml.slice(0, insertAt) + '<row r="' + rn + '">' + nc + '</row>' + xml.slice(insertAt);
      return { xml: widenDimension(xml, rn, cn), info: info };
    }
    // 행 범위
    var selfClosed = /\/>$/.test(rowTag), rowEnd, inner, openTag = rowTag;
    if (selfClosed) {
      openTag = rowTag.replace(/\s*\/>$/, '>');
      rowEnd = rowIdx + rowTag.length; inner = '';
    } else {
      var ce = xml.indexOf('</row>', rowIdx + rowTag.length); if (ce < 0) return { err: '시트 구조가 특이해서 고칠 수 없어요.' };
      rowEnd = ce + 6; inner = xml.slice(rowIdx + rowTag.length, ce);
    }
    // 셀 찾기
    var cellRe = /<c\b[^>]*>/g, pos = -1, cTag = null, cEnd = -1, ins = inner.length;
    while ((m = cellRe.exec(inner))) {
      var rr = /\sr="([A-Z]+)(\d+)"/.exec(m[0]);
      if (!rr) return { err: '주소가 없는 칸이 있는 시트라서 고칠 수 없어요.' };
      var c = colNum(rr[1]);
      if (c === cn) {
        pos = m.index; cTag = m[0];
        if (/\/>$/.test(cTag)) cEnd = pos + cTag.length;
        else { var e = inner.indexOf('</c>', pos + cTag.length); if (e < 0) return { err: '시트 구조가 특이해서 고칠 수 없어요.' }; cEnd = e + 4; }
        break;
      }
      if (c > cn) { ins = m.index; break; }
      // 지나가는 셀의 끝으로 lastIndex 를 옮겨 내용 속 '<c' 흉내를 피한다
      if (!/\/>$/.test(m[0])) { var e2 = inner.indexOf('</c>', m.index + m[0].length); if (e2 > 0) cellRe.lastIndex = e2 + 4; }
    }
    var newInner;
    if (pos >= 0) {
      var body = inner.slice(pos + cTag.length, cEnd);
      if (/\scm="/.test(cTag) || /\svm="/.test(cTag)) return { err: '이 칸은 특수한 칸(동적 배열 등)이라 고칠 수 없어요.' };
      var fm = /<f\b([^>]*?)(\/?)>/.exec(body);
      if (fm) {
        var ft = attr(' ' + fm[1], 't');
        if (ft === 'shared') return { err: '여러 칸이 함께 쓰는 수식(공유 수식)이라 고칠 수 없어요. 엑셀에서 고쳐 주세요.' };
        if (ft === 'array') return { err: '배열 수식 칸이라 고칠 수 없어요. 엑셀에서 고쳐 주세요.' };
        if (ft === 'dataTable') return { err: '데이터 표 칸이라 고칠 수 없어요.' };
        info.hadFormula = true;
      }
      var attrs = cTag.replace(/^<c/, '').replace(/\s*\/?>$/, '').replace(/\st="[^"]*"/, '');
      var nx = cellXml(attrs, spec); if (nx == null) return { err: '숫자를 넣을 수 없어요.' };
      newInner = inner.slice(0, pos) + nx + inner.slice(cEnd);
    } else {
      var st1 = defaultStyle(xml, rowTag, cn), at1 = ' r="' + ref + '"' + (st1 != null ? ' s="' + st1 + '"' : '');
      var nx2 = cellXml(at1, spec); if (nx2 == null) return { err: '숫자를 넣을 수 없어요.' };
      if (spec.kind === 'empty') return { xml: xml, info: info, noop: true };
      newInner = inner.slice(0, ins) + nx2 + inner.slice(ins);
      openTag = openTag.replace(/\sspans="[^"]*"/, '');     // 칸이 늘면 spans 힌트는 낡는다
    }
    xml = xml.slice(0, rowIdx) + openTag + newInner + '</row>' + xml.slice(rowEnd);
    return { xml: pos >= 0 ? xml : widenDimension(xml, rn, cn), info: info };
  }
  function widenDimension(xml, r, c) {
    return xml.replace(/<dimension\s+ref="([^"]+)"\s*\/>/, function (all, ref) {
      var p = ref.split(':'), a = /^([A-Z]+)(\d+)$/.exec(p[0]), b = /^([A-Z]+)(\d+)$/.exec(p[p.length - 1]);
      if (!a || !b) return all;
      var c0 = Math.min(colNum(a[1]), c), r0 = Math.min(+a[2], r), c1 = Math.max(colNum(b[1]), c), r1 = Math.max(+b[2], r);
      var s = colName(c0) + r0, e = colName(c1) + r1;
      return '<dimension ref="' + (s === e ? s : s + ':' + e) + '"/>';
    });
  }

  // ---------------- 저장 준비 ----------------
  // 고친 시트 XML 을 zip 에 넣고, 낡은 계산 순서표를 지우고, 열 때 전부 다시 계산하게 한다.
  function finalize(zip, an, changedNames) {
    changedNames.forEach(function (nm) { var sh = an.sheets[nm]; if (sh && sh.path) zip.file(sh.path, sh.xml, { createFolders: false }); });
    var jobs = [];
    if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml');
    if (zip.file('[Content_Types].xml')) jobs.push(zip.file('[Content_Types].xml').async('string').then(function (t) {
      var n = t.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''); if (n !== t) zip.file('[Content_Types].xml', n, { createFolders: false });
    }));
    if (zip.file('xl/_rels/workbook.xml.rels')) jobs.push(zip.file('xl/_rels/workbook.xml.rels').async('string').then(function (t) {
      var n = t.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''); if (n !== t) zip.file('xl/_rels/workbook.xml.rels', n, { createFolders: false });
    }));
    jobs.push(zip.file('xl/workbook.xml').async('string').then(function (t) {
      var n;
      if (/<calcPr\b/.test(t)) n = t.replace(/<calcPr\b([^>]*?)(\/?)>/, function (m, a, sl) { return '<calcPr' + a.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"' + sl + '>'; });
      else {
        var nxt = /<(oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b/.exec(t);
        var at = nxt ? nxt.index : t.lastIndexOf('</workbook>');
        n = t.slice(0, at) + '<calcPr fullCalcOnLoad="1"/>' + t.slice(at);
      }
      zip.file('xl/workbook.xml', n, { createFolders: false });
    }));
    return Promise.all(jobs);
  }

  // 이 칸을 고치면 안 되는 이유(없으면 ''): 표 머리글, 배열 수식이 차지한 칸
  function cellBlock(sh, ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m || !sh) return '';
    var c = colNum(m[1]), r = +m[2], i;
    for (i = 0; i < (sh.hdr || []).length; i++) { var h = sh.hdr[i]; if (r === h.r && c >= h.c0 && c <= h.c1) return '엑셀 표의 머리글(맨 윗줄 이름)은 표 정의와 맞아야 해서 여기서 고칠 수 없어요. 엑셀에서 고쳐 주세요.'; }
    for (i = 0; i < (sh.arr || []).length; i++) { var a = sh.arr[i]; if (r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1) return '배열 수식이 차지한 칸이라 고칠 수 없어요. 엑셀에서 고쳐 주세요.'; }
    return '';
  }

  var api = { analyze: analyze, patchCell: patchCell, finalize: finalize, cellBlock: cellBlock, _unescX: unescX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SOXlsxPatch = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* so-docx-struct.js — S-Office 워드 편집 보강(O-0861, v10.6): 문단 넣기·지우기·옮기기 · 제목 스타일 · 글자·문단 서식 · 목록 · 표 · 그림 · 쪽 나누기 · 머리글·바닥글·쪽 번호 · 새 워드 문서
 * ----------------------------------------------------------------------------
 * 원본 .docx(zip)의 word/document.xml 등을 문자열로 직접 고친다(다시 쓰지 않음). 고친 파트만 바뀌고 나머지는 그대로다.
 * 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용). 문단 번호(xi)는 so-docx.js 의 analyzeDoc 과 같은 순서(맨 바깥 <w:p>, 문서 순서)다.
 * pkg = { read(path)→Promise<string|null>, write(path,str), writeBin(path,Uint8Array), remove(path), list()→[path] }
 */
(function (global) {
  'use strict';
  var TAG_SRC = '<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<\\?[\\s\\S]*?\\?>|<(\\/?)([^\\s\\/>]+)((?:"[^"]*"|\'[^\']*\'|[^>"\'])*?)(\\/?)>';
  function tagRe() { return new RegExp(TAG_SRC, 'g'); }
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function unesc(s) {
    return String(s).replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); }).replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function attrOf(tag, name) { var m = new RegExp('[\\s:]' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; }
  function relsPathOf(p) { var i = p.lastIndexOf('/'); return p.slice(0, i + 1) + '_rels/' + p.slice(i + 1) + '.rels'; }
  async function must(pkg, p) { var s = await pkg.read(p); if (s == null) throw new Error('문서 안에 ' + p + ' 이(가) 없습니다'); return s; }
  var RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var CT_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

  // ============================== 요소 위치 ==============================
  function elemEnd(xml, s) {
    var re = tagRe(), m, depth = 0; re.lastIndex = s;
    while ((m = re.exec(xml))) { if (!m[2]) continue; if (m[1]) { depth--; if (depth === 0) return re.lastIndex; } else if (m[4]) { if (depth === 0) return re.lastIndex; } else depth++; }
    return -1;
  }
  function kidsOf(xml, from, to) {
    var re = tagRe(), m, depth = 0, out = [], cur = null; re.lastIndex = from;
    while ((m = re.exec(xml)) && m.index < to) {
      if (!m[2]) continue;
      if (m[1]) { depth--; if (depth === 0 && cur) { cur.e = re.lastIndex; out.push(cur); cur = null; } }
      else if (m[4]) { if (depth === 0) out.push({ name: m[2], s: m.index, e: re.lastIndex }); }
      else { if (depth === 0) cur = { name: m[2], s: m.index, e: -1 }; depth++; }
    }
    return out;
  }
  // 맨 바깥 <w:p> 목록(so-docx.js 의 scanParagraphs 와 같은 순서) — {s,e,anc:[조상 이름]}
  function paras(xml) {
    var re = tagRe(), m, stack = [], out = [];
    while ((m = re.exec(xml))) {
      if (!m[2]) continue;
      var name = m[2], isClose = !!m[1], isSelf = !!m[4];
      if (isClose) { var top = stack.pop(); if (top && top.para) top.para.e = re.lastIndex; continue; }
      var node = { name: name };
      if (name === 'w:p') {
        var outer = false; for (var i = 0; i < stack.length; i++) if (stack[i].name === 'w:p') { outer = true; break; }
        if (!outer) { var para = { s: m.index, e: isSelf ? re.lastIndex : null, anc: stack.map(function (n) { return n.name; }) }; out.push(para); if (!isSelf) node.para = para; }
      }
      if (!isSelf) stack.push(node);
    }
    return out.filter(function (p) { return p.e != null; });
  }
  function ranges(xml, tag) {                     // 맨 바깥이 아니라 모든 같은 이름 요소의 범위(중첩 포함)
    var out = [], stack = [], re = tagRe(), m;
    while ((m = re.exec(xml))) {
      if (!m[2] || m[2] !== tag) continue;
      if (m[4]) { out.push({ s: m.index, e: re.lastIndex }); continue; }
      if (!m[1]) stack.push(m.index); else if (stack.length) out.push({ s: stack.pop(), e: re.lastIndex });
    }
    return out;
  }
  function innermost(rs, at) { var best = null; rs.forEach(function (r) { if (r.s <= at && at < r.e && (!best || r.s > best.s)) best = r; }); return best; }
  function sameParent(xml, p, q) { var tcs = ranges(xml, 'w:tc'), a = innermost(tcs, p.s), b = innermost(tcs, q.s); return (a ? a.s : -1) === (b ? b.s : -1); }
  function P(xml, xi) { var ps = paras(xml); if (!ps[xi]) throw new Error('문단을 찾지 못했습니다'); return ps[xi]; }
  function pText(pxml) { var o = ''; (pxml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>/g) || []).forEach(function (t) { o += /^<w:t[\s>]/.test(t) ? unesc(t.replace(/<[^>]+>/g, '')) : (/^<w:tab/.test(t) ? '\t' : '\n'); }); return o; }

  // ============================== 문단 속성(pPr) ==============================
  var PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
  var RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
  // 속성 묶음 문자열(<w:pPr>…</w:pPr> 또는 <w:rPr>…</w:rPr>)에서 자식 하나를 바꾸거나(xml) 지운다(null)
  function setProp(box, boxTag, order, name, childXml) {
    var m = new RegExp('^<' + boxTag + '\\b([^>]*?)(\\/?)>').exec(box || ''), open, inner = '';
    if (m) { open = '<' + boxTag + m[1] + '>'; if (m[2] !== '/') inner = box.slice(m[0].length, box.length - ('</' + boxTag + '>').length); } else open = '<' + boxTag + '>';
    var kids = kidsOf(inner, 0, inner.length), idx = order.indexOf(name), out = '', placed = false, last = 0;
    kids.forEach(function (k) {
      var nm = k.name.replace(/^w:/, ''); out += inner.slice(last, k.s); last = k.e;
      if (nm === name) { if (childXml && !placed) { out += childXml; placed = true; } return; }
      if (!placed && childXml && order.indexOf(nm) > idx && idx >= 0) { out += childXml; placed = true; }
      out += inner.slice(k.s, k.e);
    });
    out += inner.slice(last);
    if (!placed && childXml) out += childXml;
    return out ? open + out + '</' + boxTag + '>' : '';
  }
  function pPrOf(pStr) {                           // 문단 안 첫 pPr 의 범위
    var m = /^<w:p\b[^>]*?>/.exec(pStr); if (!m) return null;
    var rest = pStr.slice(m[0].length), pm = /^\s*<w:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:pPr>)/.exec(rest);
    return pm ? { s: m[0].length + pm[0].indexOf('<'), e: m[0].length + pm[0].length, xml: pm[0].trim(), head: m[0] } : { s: m[0].length, e: m[0].length, xml: '', head: m[0] };
  }
  function withPPr(pStr, fn) {
    if (/^<w:p\b[^>]*\/>$/.test(pStr)) pStr = pStr.replace(/\s*\/>$/, '></w:p>');
    var pp = pPrOf(pStr), nx = fn(pp.xml); return pStr.slice(0, pp.s) + nx + pStr.slice(pp.e);
  }
  function mapParas(xml, a, b, fn) {                // a..b 번 문단 각각에 fn(문단 문자열, 번호) 적용
    var ps = paras(xml), out = xml;
    for (var i = Math.min(b, ps.length - 1); i >= a; i--) { var p = ps[i]; out = out.slice(0, p.s) + fn(out.slice(p.s, p.e), i) + out.slice(p.e); }
    return out;
  }

  // ============================== 문단 넣기·지우기·옮기기 ==============================
  function newPara(text, srcP, keepStyle) {
    var pp = srcP ? pPrOf(srcP) : null, ppr = '';
    if (pp && pp.xml && keepStyle !== false) { ppr = pp.xml.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/, '').replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, '').replace(/<w:pageBreakBefore\b[^>]*\/>/, ''); if (/^<w:pPr[^>]*\/>$/.test(ppr)) ppr = ''; }
    var rpr = '', rm = srcP ? /<w:r>(<w:rPr\b[\s\S]*?<\/w:rPr>)/.exec(srcP) : null; if (rm) rpr = rm[1];
    var runs = text ? text.split(/\r?\n/).map(function (ln, i) { return '<w:r>' + rpr + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r>'; }).join('') : '';
    return '<w:p>' + ppr + runs + '</w:p>';
  }
  function insertPara(xml, xi, text, after) {
    var p = P(xml, xi), src = xml.slice(p.s, p.e), np = newPara(text, src);
    if (/<w:sectPr\b/.test(src)) np = newPara(text, null);       // 구역 끝 문단 뒤에는 구역 속성을 이어받지 않는다
    return after === false ? xml.slice(0, p.s) + np + xml.slice(p.s) : xml.slice(0, p.e) + np + xml.slice(p.e);
  }
  function deleteParas(xml, a, b) {
    var ps = paras(xml); if (!ps[a] || !ps[b]) throw new Error('문단을 찾지 못했습니다');
    for (var i = a; i <= b; i++) {
      if (/<w:sectPr\b/.test(xml.slice(ps[i].s, ps[i].e))) return { err: '구역(쪽 모양)이 나뉘는 자리의 문단은 폰에서 지울 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
      if (ps[i].anc.join('/') !== ps[a].anc.join('/') || !sameParent(xml, ps[a], ps[i])) return { err: '표 안팎에 걸쳐 한꺼번에 지울 수 없습니다. 표 안 문단과 표 밖 문단을 따로 지워 주십시오.' };
    }
    // 같은 부모 아래 문단만 연속으로 지운다. 부모(칸·본문) 안의 문단을 다 지우면 안 되므로 마지막 하나는 비운다
    var inTc = ps[a].anc[ps[a].anc.length - 1] === 'w:tc';
    var out = xml, empty = false;
    if (inTc) {
      var tc = innermost(ranges(xml, 'w:tc'), ps[a].s), tcPs = ps.filter(function (p) { return p.s >= tc.s && p.e <= tc.e && p.anc.join('/') === ps[a].anc.join('/'); });
      if (b - a + 1 >= tcPs.length) empty = true;
    }
    var bodyKids = null;
    if (!inTc) {                                    // 표 바로 뒤에 오는 문단이 마지막이면(표 뒤에는 문단이 꼭 있어야 함) 비우기만
      var after = xml.slice(ps[b].e).replace(/^\s+/, ''), before = xml.slice(0, ps[a].s).replace(/\s+$/, '');
      if (/^(<w:sectPr\b|<\/w:body>)/.test(after) && /<\/w:tbl>$/.test(before)) empty = true;
    }
    if (empty) { for (var k = b; k >= a; k--) { var p = ps[k]; var src = out.slice(p.s, p.e); out = out.slice(0, p.s) + (k === a ? newPara('', src).replace(/<w:r>[\s\S]*<\/w:r>/, '') : '') + out.slice(p.e); } return { xml: out, blanked: true }; }
    out = out.slice(0, ps[a].s) + out.slice(ps[b].e);
    return { xml: out };
  }
  function moveParas(xml, a, b, dir) {
    var ps = paras(xml), n = dir < 0 ? a - 1 : b + 1; if (!ps[a] || !ps[b] || n < 0 || n >= ps.length) return { err: dir < 0 ? '맨 앞입니다.' : '맨 뒤입니다.' };
    for (var i = a; i <= b; i++) if (/<w:sectPr\b/.test(xml.slice(ps[i].s, ps[i].e)) || ps[i].anc.join('/') !== ps[a].anc.join('/') || !sameParent(xml, ps[a], ps[i])) return { err: '이 문단은 폰에서 옮길 수 없습니다(구역 끝이거나 표 안팎에 걸쳐 있습니다).' };
    var nb = ps[n]; if (nb.anc.join('/') !== ps[a].anc.join('/') || !sameParent(xml, ps[a], nb) || /<w:sectPr\b/.test(xml.slice(nb.s, nb.e))) return { err: '옆이 표·구역이라 폰에서는 옮길 수 없습니다. 표 앞뒤의 문단끼리만 서로 자리를 바꿀 수 있습니다.' };
    var between = dir < 0 ? xml.slice(nb.e, ps[a].s) : xml.slice(ps[b].e, nb.s);
    if (/<w:tbl\b|<w:sectPr\b|<w:sdt\b/.test(between)) return { err: '사이에 표가 있어 폰에서는 건너뛰어 옮길 수 없습니다.' };
    var blk = xml.slice(ps[a].s, ps[b].e), nbx = xml.slice(nb.s, nb.e), out;
    if (dir < 0) out = xml.slice(0, nb.s) + blk + between + nbx + xml.slice(ps[b].e);
    else out = xml.slice(0, ps[a].s) + nbx + between + blk + xml.slice(nb.e);
    return { xml: out, newA: dir < 0 ? a - 1 : a + 1, newB: dir < 0 ? b - 1 : b + 1 };
  }
  function pageBreakAfter(xml, xi) { var p = P(xml, xi); return xml.slice(0, p.e) + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + xml.slice(p.e); }

  // ============================== 스타일 · 서식 ==============================
  var STYLE_NAMES = { heading1: ['heading 1', '제목 1'], heading2: ['heading 2', '제목 2'], heading3: ['heading 3', '제목 3'], normal: ['normal', '표준', '바탕글'], title: ['title', '제목'], listparagraph: ['list paragraph', '목록 단락'], tablegrid: ['table grid', '표 구분선'] };
  var STYLE_DEF = {
    heading1: '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>',
    heading2: '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>',
    heading3: '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>',
    title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>',
    listparagraph: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>',
    tablegrid: '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>'
  };
  // 문서에 그 스타일이 있으면 id 를, 없으면 정의를 덧붙여 id 를 돌려준다
  async function ensureStyle(pkg, kind) {
    var sx = await pkg.read('word/styles.xml');
    if (sx == null) return null;
    var names = STYLE_NAMES[kind] || [], re = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, m;
    while ((m = re.exec(sx))) {
      var nm = /<w:name\s+w:val="([^"]*)"/.exec(m[0]); if (nm && names.indexOf(nm[1].toLowerCase()) >= 0 && /w:type="(paragraph|table)"/.test(m[0])) return attrOf(m[0].match(/^<w:style\b[^>]*>/)[0], 'styleId');
    }
    if (!STYLE_DEF[kind]) return null;
    var id = attrOf(STYLE_DEF[kind].match(/^<w:style\b[^>]*>/)[0], 'styleId');
    if (new RegExp('w:styleId="' + id + '"').test(sx)) id = id + 'S';
    var def = STYLE_DEF[kind].replace(/w:styleId="[^"]*"/, 'w:styleId="' + id + '"');
    pkg.write('word/styles.xml', sx.replace('</w:styles>', def + '</w:styles>')); return id;
  }
  function setStyle(xml, a, b, styleId) {
    return mapParas(xml, a, b, function (p) { return withPPr(p, function (ppr) { return setProp(ppr, 'w:pPr', PPR_ORDER, 'pStyle', styleId ? '<w:pStyle w:val="' + styleId + '"/>' : null) || '<w:pPr/>'; }); }).replace(/<w:pPr\/>/g, '');
  }
  // f = { align:'left|center|right|both', line:1.0|1.5|2.0, indent:+1|-1|0(초기화), keepStyle }
  function setParaFmt(xml, a, b, f) {
    return mapParas(xml, a, b, function (p) {
      return withPPr(p, function (ppr) {
        var x = ppr;
        if (f.align) x = setProp(x, 'w:pPr', PPR_ORDER, 'jc', '<w:jc w:val="' + f.align + '"/>');
        if (f.line) { var sp = /<w:spacing\b[^>]*\/>/.exec(x); var t = sp ? sp[0] : '<w:spacing/>'; t = t.replace(/\sw:line="[^"]*"/, '').replace(/\sw:lineRule="[^"]*"/, '').replace(/\s*\/>$/, ' w:line="' + Math.round(240 * f.line) + '" w:lineRule="auto"/>'); x = setProp(x, 'w:pPr', PPR_ORDER, 'spacing', t); }
        if (f.spBefore != null || f.spAfter != null) {
          var sp2 = /<w:spacing\b[^>]*\/>/.exec(x), t3 = sp2 ? sp2[0] : '<w:spacing/>';
          if (f.spBefore != null) t3 = t3.replace(/\sw:before(Lines|Autospacing)?="[^"]*"/g, '').replace(/\s*\/>$/, ' w:before="' + Math.round(f.spBefore * 20) + '"/>');
          if (f.spAfter != null) t3 = t3.replace(/\sw:after(Lines|Autospacing)?="[^"]*"/g, '').replace(/\s*\/>$/, ' w:after="' + Math.round(f.spAfter * 20) + '"/>');
          x = setProp(x, 'w:pPr', PPR_ORDER, 'spacing', t3);
        }
        if (f.shade !== undefined) x = setProp(x, 'w:pPr', PPR_ORDER, 'shd', f.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + f.shade + '"/>' : null);
        if (f.box !== undefined) x = setProp(x, 'w:pPr', PPR_ORDER, 'pBdr', f.box ? '<w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="808080"/><w:left w:val="single" w:sz="6" w:space="4" w:color="808080"/><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/><w:right w:val="single" w:sz="6" w:space="4" w:color="808080"/></w:pBdr>' : null);
        if (f.indent != null) {
          var im = /<w:ind\b[^>]*\/>/.exec(x), cur = im ? +(attrOf(im[0], 'left') || attrOf(im[0], 'start') || 0) : 0, nv = f.indent === 0 ? 0 : Math.max(0, cur + f.indent * 440);
          var t2 = im ? im[0].replace(/\sw:(left|start)="[^"]*"/, '') : '<w:ind/>'; t2 = nv ? t2.replace(/\s*\/>$/, ' w:left="' + nv + '"/>') : t2;
          x = setProp(x, 'w:pPr', PPR_ORDER, 'ind', nv || (im && /w:(hanging|firstLine|right)=/.test(im[0])) ? t2 : null);
        }
        return x || '<w:pPr/>';
      });
    }).replace(/<w:pPr\/>/g, '');
  }
  function rprFmt(rpr, f) {                         // 런 속성 묶음 하나(<w:rPr>…</w:rPr> 또는 '')에 글자 서식 적용
    var x = rpr || '';
    if (f.bold != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'b', f.bold ? '<w:b/>' : '<w:b w:val="0"/>');
    if (f.bold != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'bCs', f.bold ? '<w:bCs/>' : '<w:bCs w:val="0"/>');
    if (f.italic != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'i', f.italic ? '<w:i/>' : '<w:i w:val="0"/>');
    if (f.underline != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'u', f.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>');
    if (f.strike != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'strike', f.strike ? '<w:strike/>' : '<w:strike w:val="0"/>');
    if (f.vert !== undefined) x = setProp(x, 'w:rPr', RPR_ORDER, 'vertAlign', f.vert ? '<w:vertAlign w:val="' + f.vert + '"/>' : null);
    if (f.track != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'spacing', f.track ? '<w:spacing w:val="' + Math.round(f.track * 20) + '"/>' : null);
    if (f.size != null) { var h = Math.round(Math.max(4, Math.min(200, f.size)) * 2); x = setProp(x, 'w:rPr', RPR_ORDER, 'sz', '<w:sz w:val="' + h + '"/>'); x = setProp(x, 'w:rPr', RPR_ORDER, 'szCs', '<w:szCs w:val="' + h + '"/>'); }
    if (f.color !== undefined) x = setProp(x, 'w:rPr', RPR_ORDER, 'color', f.color ? '<w:color w:val="' + f.color + '"/>' : null);
    if (f.highlight !== undefined) x = setProp(x, 'w:rPr', RPR_ORDER, 'highlight', f.highlight ? '<w:highlight w:val="' + f.highlight + '"/>' : null);
    if (f.font) x = setProp(x, 'w:rPr', RPR_ORDER, 'rFonts', '<w:rFonts w:ascii="' + esc(f.font) + '" w:hAnsi="' + esc(f.font) + '" w:eastAsia="' + esc(f.font) + '" w:cs="' + esc(f.font) + '"/>');
    return x;
  }
  function fmtRunTags(pStr, f) {                    // 문단 안 모든 런(<w:r>)의 글자 속성 고치기
    return pStr.replace(/<w:r(\s[^>]*)?>(<w:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:rPr>))?/g, function (all, at, rpr) {
      return '<w:r' + (at || '') + '>' + rprFmt(rpr || '', f);
    });
  }
  function setRunFmt(xml, a, b, f) { return mapParas(xml, a, b, function (p) { return fmtRunTags(p, f); }); }
  // 첫 글자 조각의 서식(표시용)
  function readFmt(xml, xi) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e), rm = /<w:r(?:\s[^>]*)?>(<w:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:rPr>))/.exec(s), r = rm ? rm[1] : '', pp = pPrOf(s), pxml = pp ? pp.xml : '';
    var sz = /<w:sz\s+w:val="(\d+)"/.exec(r), col = /<w:color\s+w:val="([0-9A-Fa-f]{6})"/.exec(r), jc = /<w:jc\s+w:val="(\w+)"/.exec(pxml), st = /<w:pStyle\s+w:val="([^"]*)"/.exec(pxml);
    return { bold: /<w:b(?:\s+w:val="(?!0|false)[^"]*"|\s*\/)?>?/.test(r) && !/<w:b\s+w:val="(0|false)"/.test(r) && /<w:b[\s\/>]/.test(r), italic: /<w:i[\s\/>]/.test(r) && !/<w:i\s+w:val="(0|false)"/.test(r), underline: /<w:u\s+w:val="(?!none)/.test(r), size: sz ? +sz[1] / 2 : null, color: col ? col[1].toUpperCase() : null, align: jc ? jc[1] : null, style: st ? st[1] : null, num: /<w:numPr>/.test(pxml) };
  }

  // ============================== 목록(글머리·번호) ==============================
  async function ensureNumbering(pkg) {
    var nx = await pkg.read('word/numbering.xml');
    if (nx != null) return nx;
    nx = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>';
    pkg.write('word/numbering.xml', nx);
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), id = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + id + '" Type="' + RT + 'numbering" Target="numbering.xml"/></Relationships>'));
    var ct = await must(pkg, '[Content_Types].xml');
    if (ct.indexOf('/word/numbering.xml') < 0) pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'));
    return nx;
  }
  function nextRid(rx) { var mx = 0; (rx.match(/Id="rId(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return 'rId' + (mx + 1); }
  // kind = 'bullet' | 'decimal'. reuseNumId 가 있으면(앞 문단이 같은 종류) 같은 번호 흐름을 이어 간다. 반환 numId
  async function ensureList(pkg, kind, reuseNumId) {
    var nx = await ensureNumbering(pkg);
    function absOfNum(id) { var m = new RegExp('<w:num\\b[^>]*w:numId="' + id + '"[^>]*>[\\s\\S]*?<w:abstractNumId\\s+w:val="(\\d+)"').exec(nx); return m ? m[1] : null; }
    function fmtOfAbs(aid) { var m = new RegExp('<w:abstractNum\\b[^>]*w:abstractNumId="' + aid + '"[^>]*>[\\s\\S]*?<w:lvl\\b[^>]*w:ilvl="0"[\\s\\S]*?<w:numFmt\\s+w:val="(\\w+)"').exec(nx); return m ? m[1] : null; }
    if (reuseNumId) { var ab = absOfNum(reuseNumId); if (ab != null && (fmtOfAbs(ab) === 'bullet') === (kind === 'bullet')) return reuseNumId; }
    if (kind === 'bullet') {                           // 글머리표는 문서 안에 이미 있는 것을 쓴다
      var nm, nre = /<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId\s+w:val="(\d+)"/g;
      while ((nm = nre.exec(nx))) if (fmtOfAbs(nm[2]) === 'bullet') return nm[1];
    }
    var aid = 0, nid = 0; (nx.match(/w:abstractNumId="(\d+)"/g) || []).forEach(function (s) { aid = Math.max(aid, +/(\d+)/.exec(s)[1] + 1); }); (nx.match(/<w:num\b[^>]*w:numId="(\d+)"/g) || []).forEach(function (s) { nid = Math.max(nid, +/(\d+)"/.exec(s)[1]); }); nid++;
    var lvls = '', i;
    for (i = 0; i < 9; i++) lvls += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (kind === 'bullet' ? 'bullet' : (i % 3 === 0 ? 'decimal' : (i % 3 === 1 ? 'lowerLetter' : 'lowerRoman'))) + '"/><w:lvlText w:val="' + (kind === 'bullet' ? (i % 2 ? 'o' : '\u2022') : '%' + (i + 1) + (i % 3 === 0 ? '.' : ')')) + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * i) + '" w:hanging="360"/></w:pPr>' + (kind === 'bullet' ? '<w:rPr><w:rFonts w:ascii="' + (i % 2 ? 'Courier New' : 'Symbol') + '" w:hAnsi="' + (i % 2 ? 'Courier New' : 'Symbol') + '" w:hint="default"/></w:rPr>' : '') + '</w:lvl>';
    var abs = '<w:abstractNum w:abstractNumId="' + aid + '"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls + '</w:abstractNum>', num = '<w:num w:numId="' + nid + '"><w:abstractNumId w:val="' + aid + '"/></w:num>';
    var firstNum = nx.search(/<w:num\b/);
    nx = firstNum >= 0 ? nx.slice(0, firstNum) + abs + nx.slice(firstNum) : nx.replace('</w:numbering>', abs + '</w:numbering>');
    nx = nx.replace('</w:numbering>', num + '</w:numbering>');
    pkg.write('word/numbering.xml', nx); return String(nid);
  }
  function numIdOf(xml, xi) { var p = P(xml, xi), m = /<w:numPr>[\s\S]*?<w:numId\s+w:val="(\d+)"/.exec(xml.slice(p.s, p.e)); return m ? m[1] : null; }
  function setList(xml, a, b, numId, lvl) {         // numId = null 이면 목록 해제
    return mapParas(xml, a, b, function (p) {
      return withPPr(p, function (ppr) {
        var np = numId ? '<w:numPr><w:ilvl w:val="' + (lvl || 0) + '"/><w:numId w:val="' + numId + '"/></w:numPr>' : null;
        var x = setProp(ppr, 'w:pPr', PPR_ORDER, 'numPr', np);
        if (numId && !/<w:pStyle\b/.test(x)) { /* 스타일은 그대로 둔다(문단 모양 유지) */ }
        if (numId) x = setProp(x, 'w:pPr', PPR_ORDER, 'ind', null);
        return x || '<w:pPr/>';
      });
    }).replace(/<w:pPr\/>/g, '');
  }

  // ============================== 표 ==============================
  function textWidth(xml) {                          // 본문 폭(twips): 마지막 구역 속성의 종이 폭 − 좌우 여백
    var sp = xml.lastIndexOf('<w:sectPr'), s = sp >= 0 ? xml.slice(sp) : '', pg = /<w:pgSz\b[^>]*>/.exec(s), mg = /<w:pgMar\b[^>]*>/.exec(s);
    var w = pg ? +attrOf(pg[0], 'w') : 11906, l = mg ? +attrOf(mg[0], 'left') : 1440, r = mg ? +attrOf(mg[0], 'right') : 1440;
    var tw = w - l - r; return tw > 1800 ? tw : 9000;
  }
  function insertTable(xml, xi, rows, cols, tableStyleId) {
    var ps = paras(xml), p = ps[xi]; if (!p) throw new Error('문단을 찾지 못했습니다');
    if (p.anc.indexOf('w:tc') >= 0) return { err: '표 안에는 표를 넣을 수 없습니다. 표 밖 문단을 고르고 넣어 주십시오.' };
    var tw = textWidth(xml), cw = Math.floor(tw / cols), grid = '', trs = '', i, j;
    for (j = 0; j < cols; j++) grid += '<w:gridCol w:w="' + cw + '"/>';
    for (i = 0; i < rows; i++) { var tcs = ''; for (j = 0; j < cols; j++) tcs += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>'; trs += '<w:tr>' + tcs + '</w:tr>'; }
    var borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders>';
    var tbl = '<w:tbl><w:tblPr>' + (tableStyleId ? '<w:tblStyle w:val="' + tableStyleId + '"/>' : '') + '<w:tblW w:w="' + (cw * cols) + '" w:type="dxa"/>' + (tableStyleId ? '' : borders) + '<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + trs + '</w:tbl>';
    return { xml: xml.slice(0, p.e) + tbl + '<w:p/>' + xml.slice(p.e) };
  }
  function tblBlock(xml, xi) {
    var ps = paras(xml), p = ps[xi]; if (!p) throw new Error('문단을 찾지 못했습니다');
    var tc = innermost(ranges(xml, 'w:tc'), p.s); if (!tc) return { err: '표 안의 문단(칸)을 먼저 골라 주십시오.' };
    var tr = innermost(ranges(xml, 'w:tr'), p.s), tbl = innermost(ranges(xml, 'w:tbl'), p.s);
    return { tc: tc, tr: tr, tbl: tbl, xml: xml.slice(tbl.s, tbl.e) };
  }
  function cellsOfRow(rowXml) { var re = tagRe(), m, depth = 0, out = [], st = 0, first = true; re.lastIndex = 0; var inner0 = rowXml.indexOf('>') + 1; return kidsOf(rowXml, inner0, rowXml.length).filter(function (k) { return k.name === 'w:tc'; }); }
  function rowsOfTbl(tblXml) { var inner0 = tblXml.indexOf('>') + 1; return kidsOf(tblXml, inner0, tblXml.length).filter(function (k) { return k.name === 'w:tr'; }); }
  function blankCell(tcXml) { var pr = /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(tcXml); return '<w:tc>' + (pr ? pr[0].replace(/<w:gridSpan\b[^>]*\/>|<w:vMerge\b[^>]*\/>/g, '') : '') + '<w:p/></w:tc>'; }
  function tableEdit(xml, xi, op) {                  // op: rowAbove|rowBelow|rowDel|colLeft|colRight|colDel|mergeRight|mergeDown|unmerge
    var b = tblBlock(xml, xi); if (b.err) return b;
    var t = b.xml, rows = rowsOfTbl(t), rowIdx = -1, colIdx = -1, i;
    var rowS = b.tr.s - b.tbl.s;
    for (i = 0; i < rows.length; i++) if (rows[i].s === rowS) rowIdx = i;
    var cells = cellsOfRow(t.slice(rows[rowIdx].s, rows[rowIdx].e)), cellS = b.tc.s - b.tbl.s - rows[rowIdx].s;
    for (i = 0; i < cells.length; i++) if (cells[i].s === cellS) colIdx = i;
    var anyMerge = /<w:gridSpan\b|<w:vMerge\b|<w:hMerge\b/.test(t);
    var nested = (t.slice(1).match(/<w:tbl>/g) || []).length > 0;
    if (nested) return { err: '표 안에 또 표가 있어서 폰에서는 줄·칸을 바꾸기 어렵습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var out;
    if (op === 'mergeRight') {
      if (colIdx < 0 || colIdx >= cells.length - 1) return { err: '오른쪽에 합칠 칸이 없습니다.' };
      var rs = rows[rowIdx], rx = t.slice(rs.s, rs.e), c1 = cells[colIdx], c2 = cells[colIdx + 1], x1 = rx.slice(c1.s, c1.e), x2 = rx.slice(c2.s, c2.e);
      if (/<w:vMerge\b/.test(x1) || /<w:vMerge\b/.test(x2)) return { err: '세로로 합쳐진 칸이 걸려 있어 폰에서는 가로로 합칠 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
      var span1 = +(attrOf((/<w:gridSpan\b[^>]*>/.exec(x1) || [''])[0], 'val') || 1), span2 = +(attrOf((/<w:gridSpan\b[^>]*>/.exec(x2) || [''])[0], 'val') || 1);
      var w1 = +(attrOf((/<w:tcW\b[^>]*>/.exec(x1) || [''])[0], 'w') || 0), w2 = +(attrOf((/<w:tcW\b[^>]*>/.exec(x2) || [''])[0], 'w') || 0);
      var paras2 = (x2.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\/>/g) || []).filter(function (q) { return pText(q).trim() || /<w:drawing/.test(q); });
      var nx1 = x1;
      if (/<w:gridSpan\b/.test(nx1)) nx1 = nx1.replace(/<w:gridSpan\b[^>]*\/>/, '<w:gridSpan w:val="' + (span1 + span2) + '"/>'); else nx1 = /<w:tcPr\b[^>]*>/.test(nx1) ? setTcPr(nx1, 'gridSpan', '<w:gridSpan w:val="' + (span1 + span2) + '"/>') : nx1.replace(/^<w:tc(\s[^>]*)?>/, function (m) { return m + '<w:tcPr><w:gridSpan w:val="' + (span1 + span2) + '"/></w:tcPr>'; });
      if (w1 && w2) nx1 = nx1.replace(/(<w:tcW\b[^>]*\sw:w=")\d+(")/, '$1' + (w1 + w2) + '$2');
      if (paras2.length) nx1 = nx1.replace(/<\/w:tc>$/, function () { return paras2.join('') + '</w:tc>'; });
      var nrx = rx.slice(0, c1.s) + nx1 + rx.slice(c2.e);
      return { xml: xml.slice(0, b.tbl.s) + t.slice(0, rs.s) + nrx + t.slice(rs.e) + xml.slice(b.tbl.e) };
    }
    if (op === 'mergeDown') {
      if (rowIdx >= rows.length - 1) return { err: '아래에 합칠 칸이 없습니다.' };
      var rs2 = rows[rowIdx + 1], rxb = t.slice(rs2.s, rs2.e), cb = cellsOfRow(rxb);
      var rsa = rows[rowIdx], rxa = t.slice(rsa.s, rsa.e), ca = cells[colIdx];
      if (/<w:gridSpan\b/.test(rxa.slice(ca.s, ca.e)) || cb.length !== cells.length || /<w:vMerge\b/.test(rxb.slice(cb[colIdx].s, cb[colIdx].e)) && !/w:val="restart"/.test(rxb.slice(cb[colIdx].s, cb[colIdx].e)) && false) return { err: '가로로 합쳐진 칸이 있어 폰에서는 세로로 합칠 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
      var xa = rxa.slice(ca.s, ca.e), xb = rxb.slice(cb[colIdx].s, cb[colIdx].e);
      if (/<w:gridSpan\b/.test(xb)) return { err: '가로로 합쳐진 칸이 있어 폰에서는 세로로 합칠 수 없습니다.' };
      var xa2 = /<w:vMerge\b/.test(xa) ? xa : setTcPr(xa, 'vMerge', '<w:vMerge w:val="restart"/>');
      var moved = (xb.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\/>/g) || []).filter(function (q) { return pText(q).trim(); });
      if (moved.length && !/<w:vMerge\b/.test(xb)) xa2 = xa2.replace(/<\/w:tc>$/, moved.join('') + '</w:tc>');
      var xb2 = '<w:tc>' + ((/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(xb) || [''])[0] ? setTcPr((/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(xb))[0], 'vMerge', '<w:vMerge/>') : '<w:tcPr><w:vMerge/></w:tcPr>') + '<w:p/></w:tc>';
      if (/<w:tcPr\b/.test(xb)) xb2 = '<w:tc>' + setTcPrBox((/<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(xb))[0], '<w:vMerge/>') + '<w:p/></w:tc>';
      var nra = rxa.slice(0, ca.s) + xa2 + rxa.slice(ca.e), nrb = rxb.slice(0, cb[colIdx].s) + xb2 + rxb.slice(cb[colIdx].e);
      return { xml: xml.slice(0, b.tbl.s) + t.slice(0, rsa.s) + nra + t.slice(rsa.e, rs2.s) + nrb + t.slice(rs2.e) + xml.slice(b.tbl.e) };
    }
    if (op === 'unmerge') {
      var rsu = rows[rowIdx], rxu = t.slice(rsu.s, rsu.e), cu = cells[colIdx], xu = rxu.slice(cu.s, cu.e);
      if (!/<w:gridSpan\b/.test(xu)) return { err: '가로로 합쳐진 칸이 아닙니다.' };
      var sp = +attrOf(/<w:gridSpan\b[^>]*>/.exec(xu)[0], 'val'), wu = +(attrOf((/<w:tcW\b[^>]*>/.exec(xu) || [''])[0], 'w') || 0), each = wu ? Math.floor(wu / sp) : 0, parts = '';
      var first = xu.replace(/<w:gridSpan\b[^>]*\/>/, ''); if (each) first = first.replace(/(<w:tcW\b[^>]*\sw:w=")\d+(")/, '$1' + each + '$2');
      for (i = 1; i < sp; i++) parts += blankCell(xu).replace(/<w:tcW\b[^>]*\/>/, each ? '<w:tcW w:w="' + each + '" w:type="dxa"/>' : '');
      return { xml: xml.slice(0, b.tbl.s) + t.slice(0, rsu.s) + rxu.slice(0, cu.s) + first + parts + rxu.slice(cu.e) + t.slice(rsu.e) + xml.slice(b.tbl.e) };
    }
    if (anyMerge) return { err: '이 표에는 합쳐진 칸이 있어서 폰에서는 줄·칸을 넣거나 지우기 어렵습니다(칸 합치기·풀기만 가능). 「수정 요청」으로 맡겨 주십시오.' };
    if (op === 'rowAbove' || op === 'rowBelow') {
      var rsr = rows[rowIdx], rxr = t.slice(rsr.s, rsr.e), cs = cellsOfRow(rxr), body = cs.map(function (c) { return blankCell(rxr.slice(c.s, c.e)); }).join('');
      var nr = rxr.slice(0, cs[0].s) + body + rxr.slice(cs[cs.length - 1].e);
      nr = nr.replace(/<w:trPr>[\s\S]*?<\/w:trPr>/, function (m) { return m.replace(/<w:tblHeader\b[^>]*\/>/, ''); });
      var at = op === 'rowAbove' ? rsr.s : rsr.e;
      return { xml: xml.slice(0, b.tbl.s) + t.slice(0, at) + nr + t.slice(at) + xml.slice(b.tbl.e) };
    }
    if (op === 'rowDel') {
      if (rows.length <= 1) return { err: '마지막 줄은 지울 수 없습니다. 표 전체를 지우려면 「수정 요청」으로 맡겨 주십시오.' };
      return { xml: xml.slice(0, b.tbl.s) + t.slice(0, rows[rowIdx].s) + t.slice(rows[rowIdx].e) + xml.slice(b.tbl.e) };
    }
    // 칸(열): 모든 줄에 같은 자리로, 폭은 표 전체 폭을 그대로 두고 나눈다(종이 밖으로 나가지 않게)
    var gm = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(t), gcols = gm[1].match(/<w:gridCol\b[^>]*\/>/g) || [], widths = gcols.map(function (g) { return +attrOf(g, 'w'); }), total = widths.reduce(function (a2, c) { return a2 + c; }, 0), n = widths.length;
    if (op === 'colDel' && n <= 1) return { err: '마지막 칸(열)은 지울 수 없습니다.' };
    var pos = op === 'colRight' ? colIdx + 1 : colIdx, nw;
    if (op === 'colDel') { widths.splice(colIdx, 1); var sum = widths.reduce(function (a3, c) { return a3 + c; }, 0); nw = widths.map(function (w) { return Math.round(w * total / sum); }); }
    else { nw = widths.map(function (w) { return Math.round(w * n / (n + 1)); }); nw.splice(pos, 0, Math.round(total / (n + 1))); }
    var newRows = rows.map(function (rw) {
      var rxx = t.slice(rw.s, rw.e), cc = cellsOfRow(rxx); if (cc.length !== n) return null;
      var list = cc.map(function (c, k) { return rxx.slice(c.s, c.e); });
      if (op === 'colDel') list.splice(colIdx, 1); else list.splice(pos, 0, blankCell(list[Math.min(colIdx, list.length - 1)]));
      list = list.map(function (cx, k) { return /<w:tcW\b/.test(cx) ? cx.replace(/<w:tcW\b[^>]*\/>/, '<w:tcW w:w="' + nw[k] + '" w:type="dxa"/>') : cx; });
      return rxx.slice(0, cc[0].s) + list.join('') + rxx.slice(cc[cc.length - 1].e);
    });
    if (newRows.some(function (r) { return r == null; })) return { err: '줄마다 칸 수가 달라서 폰에서는 칸을 바꾸기 어렵습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var out2 = '', last = 0;
    rows.forEach(function (rw, k) { out2 += t.slice(last, rw.s) + newRows[k]; last = rw.e; }); out2 += t.slice(last);
    out2 = out2.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, '<w:tblGrid>' + nw.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>');
    return { xml: xml.slice(0, b.tbl.s) + out2 + xml.slice(b.tbl.e) };
  }
  var TCPR_ORDER = ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark'];
  function setTcPrBox(box, child) { var nm = /^<w:(\w+)/.exec(child)[1]; return setProp(box, 'w:tcPr', TCPR_ORDER, nm, child); }
  function setTcPr(tcXml, name, child) {
    var m = /<w:tcPr\b[\s\S]*?<\/w:tcPr>|<w:tcPr\s*\/>/.exec(tcXml);
    if (!m) return tcXml.replace(/^<w:tc(\s[^>]*)?>/, function (h) { return h + '<w:tcPr>' + child + '</w:tcPr>'; });
    return tcXml.slice(0, m.index) + setProp(m[0], 'w:tcPr', TCPR_ORDER, name, child) + tcXml.slice(m.index + m[0].length);
  }
  function tableInfo(xml, xi) {
    var b = tblBlock(xml, xi); if (b.err) return null;
    var rows = rowsOfTbl(b.xml); return { rows: rows.length, cols: ((/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(b.xml) || ['', ''])[1].match(/<w:gridCol\b/g) || []).length, merged: /<w:gridSpan\b|<w:vMerge\b/.test(b.xml) };
  }

  // ============================== 그림 ==============================
  async function addPicture(pkg, xi, bytes, ext, pxW, pxH) {
    ext = String(ext || 'png').toLowerCase().replace('jpeg', 'jpg');
    var mime = ext === 'jpg' ? 'image/jpeg' : (ext === 'gif' ? 'image/gif' : 'image/png');
    var xml = await must(pkg, 'word/document.xml'), ps = paras(xml), p = ps[xi]; if (!p) throw new Error('문단을 찾지 못했습니다');
    var mx = 0; pkg.list().forEach(function (q) { var m = /^word\/media\/image(\d+)\./.exec(q); if (m) mx = Math.max(mx, +m[1]); });
    var mp = 'word/media/image' + (mx + 1) + '.' + ext; pkg.writeBin(mp, bytes);
    var ct = await must(pkg, '[Content_Types].xml'); if (!new RegExp('<Default\\b[^>]*Extension="' + ext + '"', 'i').test(ct)) pkg.write('[Content_Types].xml', ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="' + ext + '" ContentType="' + mime + '"/>'));
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), rid = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT + 'image" Target="media/image' + (mx + 1) + '.' + ext + '"/></Relationships>'));
    var tw = textWidth(xml) * 635, cx = Math.min(tw * 0.8, 5400000), k = cx / (pxW || 1), cy = Math.round((pxH || 1) * k); cx = Math.round(cx);
    var ids = (xml.match(/<wp:docPr\b[^>]*\sid="(\d+)"/g) || []).map(function (s) { return +/id="(\d+)"/.exec(s)[1]; }), did = Math.max.apply(null, ids.concat([0])) + 1;
    var dr = '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + did + '" name="그림 ' + did + '" descr=""/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + did + '" name="그림 ' + did + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
    var np = '<w:p><w:r>' + dr + '</w:r></w:p>';
    pkg.write('word/document.xml', xml.slice(0, p.e) + np + xml.slice(p.e)); return { ok: true };
  }
  function scalePicture(xml, xi, factor) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e);
    if (!/<wp:(?:inline|anchor)\b/.test(s)) return { err: '이 문단에는 크기를 바꿀 그림이 없습니다.' };
    var ns = s.replace(/(<wp:extent\b[^>]*\scx=")(\d+)("[^>]*\scy=")(\d+)(")/g, function (m, a, x, b, y, c) { return a + Math.round(x * factor) + b + Math.round(y * factor) + c; })
      .replace(/(<a:ext\b[^>]*\scx=")(\d+)("[^>]*\scy=")(\d+)(")/g, function (m, a, x, b, y, c) { return a + Math.round(x * factor) + b + Math.round(y * factor) + c; });
    return { xml: xml.slice(0, p.s) + ns + xml.slice(p.e) };
  }
  function removePicture(xml, xi) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e);
    if (!/<w:drawing>/.test(s)) return { err: '이 문단에는 지울 그림이 없습니다.' };
    var ns = s.replace(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, '');
    return { xml: xml.slice(0, p.s) + ns + xml.slice(p.e) };
  }

  // ============================== 머리글·바닥글·쪽 번호 ==============================
  async function hfParts(pkg) {                    // 문서 첫 구역이 쓰는(기본) 머리글·바닥글 파트
    var xml = await must(pkg, 'word/document.xml'), rx = await must(pkg, 'word/_rels/document.xml.rels'), out = { header: [], footer: [] };
    var rels = {}; (rx.match(/<Relationship\b[^>]*>/g) || []).forEach(function (r) { rels[attrOf(r, 'Id')] = attrOf(r, 'Target'); });
    (xml.match(/<w:(header|footer)Reference\b[^>]*>/g) || []).forEach(function (t) {
      var kind = /header/.test(t) ? 'header' : 'footer', ty = attrOf(t, 'type') || 'default', id = attrOf(t, 'id'), tg = rels[id]; if (!tg || ty !== 'default') return;
      var path = 'word/' + tg.replace(/^\.?\//, ''); if (out[kind].indexOf(path) < 0) out[kind].push(path);
    });
    return out;
  }
  function hfText(x) { return (x.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\/>/g) || []).map(function (p) { return { text: pText(p), hasField: /<w:fldChar|<w:fldSimple|<w:instrText/.test(p), hasPic: /<w:drawing|<w:pict/.test(p) }; }); }
  async function readHF(pkg, kind) {
    var parts = await hfParts(pkg); if (!parts[kind].length) return { has: false, paras: [] };
    var x = await must(pkg, parts[kind][0]); return { has: true, path: parts[kind][0], paras: hfText(x), page: /\bPAGE\b/.test(x) };
  }
  async function setHF(pkg, kind, lines) {          // lines: 문단별 글. 필드·그림이 있는 문단은 그대로 두고, 글만 있는 문단만 바꾼다
    var parts = await hfParts(pkg), tag = kind === 'header' ? 'hdr' : 'ftr', W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    if (!parts[kind].length) {
      var n = 1; while (pkg.list().indexOf('word/' + kind + n + '.xml') >= 0) n++;
      var path = 'word/' + kind + n + '.xml', body = lines.map(function (t) { return newPara(t, null); }).join('') || '<w:p/>';
      pkg.write(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:' + tag + ' xmlns:w="' + W + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + body + '</w:' + tag + '>');
      var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), rid = nextRid(rx);
      pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT + kind + '" Target="' + kind + n + '.xml"/></Relationships>'));
      var ct = await must(pkg, '[Content_Types].xml'); pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml"/></Types>'));
      var dx = await must(pkg, 'word/document.xml'), sm = /<w:sectPr\b[^>]*?>/.exec(dx);
      if (!sm) throw new Error('쪽 설정(sectPr)을 찾지 못했습니다');
      var ref = '<w:' + kind + 'Reference w:type="default" r:id="' + rid + '"/>';
      pkg.write('word/document.xml', dx.slice(0, sm.index + sm[0].length) + ref + dx.slice(sm.index + sm[0].length)); return { ok: true, created: true };
    }
    var p0 = parts[kind][0], hx = await must(pkg, p0), i = 0;
    hx = hx.replace(/<w:p\b[\s\S]*?<\/w:p>|<w:p\/>/g, function (p) {
      var k = i++; if (k >= lines.length || /<w:fldChar|<w:fldSimple|<w:instrText|<w:drawing|<w:pict/.test(p)) return p;
      return rebuildText(p, lines[k]);
    });
    pkg.write(p0, hx); return { ok: true };
  }
  function rebuildText(p, text) {                    // 글만 있는 문단의 글 바꾸기: 첫 런의 서식으로 한 런에 담는다
    var rm = /<w:r(?:\s[^>]*)?>(<w:rPr\b[\s\S]*?<\/w:rPr>)?/.exec(p), rpr = rm && rm[1] ? rm[1] : '', ppr = (/<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(p) || [''])[0];
    var head = /^<w:p\b[^>]*?>/.exec(p); head = head ? head[0] : '<w:p>'; if (/\/>$/.test(head)) head = '<w:p>';
    var runs = text ? text.split(/\r?\n/).map(function (ln, i) { return '<w:r>' + rpr + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(ln) + '</w:t></w:r>'; }).join('') : '';
    return head + ppr + runs + '</w:p>';
  }
  async function addPageNumber(pkg) {
    var cur = await readHF(pkg, 'footer'); if (cur.has && cur.page) return { err: '바닥글에 이미 쪽 번호가 있습니다.' };
    var fld = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    if (!cur.has) { await setHF(pkg, 'footer', ['']); var parts = await hfParts(pkg), fx = await must(pkg, parts.footer[0]); pkg.write(parts.footer[0], fx.replace(/<w:p\b[\s\S]*<\/w:p>|<w:p\/>/, fld)); return { ok: true }; }
    var fx2 = await must(pkg, cur.path); pkg.write(cur.path, fx2.replace(/<\/w:ftr>\s*$/, fld + '</w:ftr>')); return { ok: true };
  }

  // ============================== 찾아 바꾸기(글만 있는 문단) ==============================
  function findHits(xml, q, caseSens) {            // 문단 글에서 q 를 찾는다 → [{xi, text}]
    var ps = paras(xml), out = [], needle = caseSens ? q : q.toLowerCase();
    ps.forEach(function (p, i) { var t = pText(xml.slice(p.s, p.e)); if (needle && (caseSens ? t : t.toLowerCase()).indexOf(needle) >= 0) out.push({ xi: i, text: t }); });
    return out;
  }

  // ============================== 새 워드 문서 ==============================
  function newDocxFiles() {
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', f = {};
    f['[Content_Types].xml'] = H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>';
    f['_rels/.rels'] = H + '<Relationships xmlns="' + CT_RELS + '"><Relationship Id="rId1" Type="' + RT + 'officeDocument" Target="word/document.xml"/></Relationships>';
    f['word/_rels/document.xml.rels'] = H + '<Relationships xmlns="' + CT_RELS + '"><Relationship Id="rId1" Type="' + RT + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + RT + 'settings" Target="settings.xml"/></Relationships>';
    f['word/document.xml'] = H + '<w:document xmlns:w="' + W + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>제목</w:t></w:r></w:p><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>';
    f['word/settings.xml'] = H + '<w:settings xmlns:w="' + W + '"><w:zoom w:percent="100"/><w:defaultTabStop w:val="800"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
    f['word/styles.xml'] = H + '<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      STYLE_DEF.title + STYLE_DEF.heading1 + STYLE_DEF.heading2 + STYLE_DEF.heading3 + STYLE_DEF.listparagraph + STYLE_DEF.tablegrid + '</w:styles>';
    return f;
  }

  // ============================== 글자 일부만 서식 · 복사·복제 · 표 서식 (v10.7) ==============================
  // [from,to) = 문단 글(탭·줄바꿈도 한 글자)의 글자 번호. 런을 앞·가운데·뒤로 쪼개 가운데에만 서식을 준다 — 나머지 속성·링크·번호는 그대로
  function fmtPartial(xml, xi, from, to, f) {
    var p = P(xml, xi), ps = xml.slice(p.s, p.e);
    if (!(to > from)) return { err: '먼저 꾸밀 글자를 고르십시오.' };
    if (/<w:txbxContent|<w:fldChar|<w:fldSimple|<w:instrText|<w:sdt\b|<w:ins\b|<w:del\b|<w:moveFrom|<w:moveTo|<w:footnoteReference|<w:endnoteReference/.test(ps)) return { err: '이 문단에는 필드·변경 추적·각주 등이 있어 일부 글자만 꾸밀 수 없습니다. 문단 전체 서식을 쓰거나 「수정 요청」으로 맡겨 주십시오.' };
    var pos = 0, out = '', last = 0, re = /<w:r(\s[^>]*)?>([\s\S]*?)<\/w:r>/g, m, hit = false;
    while ((m = re.exec(ps))) {
      var attrs = m[1] || '', inner = m[2], rm = /^<w:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:rPr>)/.exec(inner), rpr = rm ? rm[0] : '', body = rm ? inner.slice(rm[0].length) : inner;
      var toks = [], tre = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:cr\s*\/>|<[^>]+>/g, tm, len = 0;
      while ((tm = tre.exec(body))) {
        var raw = tm[0];
        if (/^<w:t[\s>\/]/.test(raw) && !/^<w:tab/.test(raw)) { var tx = raw.slice(-2) === '/>' && raw.indexOf('</w:t>') < 0 ? '' : unesc(tm[1] || ''); toks.push({ k: 't', text: tx }); len += tx.length; }
        else if (/^<w:tab\s*\/>/.test(raw)) { toks.push({ k: 'tab' }); len += 1; }
        else if (/^<w:br\b/.test(raw) || /^<w:cr\s*\/>/.test(raw)) { toks.push({ k: 'br', raw: raw }); len += 1; }
        else toks.push({ k: 'x', raw: raw });
      }
      var a = pos, b = pos + len; pos = b;
      if (len === 0 || b <= from || a >= to) continue;
      // 세 덩어리로 나눈다
      var groups = [[], [], []], at = a;
      toks.forEach(function (tk) {
        if (tk.k === 't') {
          var s1 = Math.max(0, Math.min(tk.text.length, from - at)), s2 = Math.max(s1, Math.min(tk.text.length, to - at));
          if (s1 > 0) groups[0].push({ k: 't', text: tk.text.slice(0, s1) });
          if (s2 > s1) groups[1].push({ k: 't', text: tk.text.slice(s1, s2) });
          if (s2 < tk.text.length) groups[2].push({ k: 't', text: tk.text.slice(s2) });
          at += tk.text.length;
        } else if (tk.k === 'x') groups[at < from ? 0 : (at < to ? 1 : 2)].push(tk);
        else { groups[at < from ? 0 : (at < to ? 1 : 2)].push(tk); at += 1; }
      });
      var emit = groups.map(function (g, gi) {
        if (!g.length) return '';
        var r2 = gi === 1 ? rprFmt(rpr, f) : rpr;
        return '<w:r' + attrs + '>' + r2 + g.map(function (tk) { return tk.k === 't' ? '<w:t xml:space="preserve">' + esc(tk.text) + '</w:t>' : (tk.k === 'tab' ? '<w:tab/>' : tk.raw); }).join('') + '</w:r>';
      }).join('');
      out += ps.slice(last, m.index) + emit; last = m.index + m[0].length; hit = true;
    }
    if (!hit) return { err: '고른 글자를 찾지 못했습니다. 글을 다시 열어 고른 뒤 눌러 보십시오.' };
    out += ps.slice(last);
    return { xml: xml.slice(0, p.s) + out + xml.slice(p.e) };
  }

  // ---- 복사·붙여넣기·복제(문단·표). 같은 문서 안에서만 — 그림·번호·스타일 관계가 그대로 유효하다 ----
  function cleanClone(frag, fullXml) {                // 책갈피는 빼고, 그림 번호(docPr id)는 새로 매긴다
    var ids = (fullXml.match(/<wp:docPr\b[^>]*\sid="(\d+)"/g) || []).map(function (s) { return +/id="(\d+)"/.exec(s)[1]; }), mx = Math.max.apply(null, ids.concat([0]));
    return frag.replace(/<w:bookmarkStart\b[^>]*\/>|<w:bookmarkEnd\b[^>]*\/>/g, '').replace(/(<wp:docPr\b[^>]*\sid=")(\d+)(")/g, function (m, a, v, b) { mx++; return a + mx + b; });
  }
  function copyParas(xml, a, b) {
    var ps = paras(xml); if (!ps[a] || !ps[b]) throw new Error('문단을 찾지 못했습니다');
    for (var i = a; i <= b; i++) if (/<w:sectPr\b/.test(xml.slice(ps[i].s, ps[i].e)) || ps[i].anc.join('/') !== ps[a].anc.join('/') || !sameParent(xml, ps[a], ps[i])) return { err: '구역 끝이거나 표 안팎에 걸친 문단은 폰에서 복사할 수 없습니다.' };
    var s = ps[a].s, e = ps[b].e;
    if (/<w:tbl\b/.test(xml.slice(s, e))) return { err: '표가 끼어 있는 범위는 문단으로 복사할 수 없습니다. 표는 「표」 시트의 「표 복사」를 쓰십시오.' };
    return { kind: 'paras', xml: xml.slice(s, e), n: b - a + 1 };
  }
  function pasteBlock(xml, xi, clip) {                 // xi 번 문단(또는 표 밖 문단) 바로 아래에
    var p = P(xml, xi), frag = cleanClone(clip.xml, xml), cnt;
    if (clip.kind === 'table') {
      if (p.anc.indexOf('w:tc') >= 0) return { err: '표 안에는 표를 붙일 수 없습니다. 표 밖 문단을 고르고 붙여 주십시오.' };
      cnt = paras(frag).length + 1;
      return { xml: xml.slice(0, p.e) + frag + '<w:p/>' + xml.slice(p.e), newA: xi + 1, newB: xi + cnt };
    }
    cnt = paras(frag).length;
    return { xml: xml.slice(0, p.e) + frag + xml.slice(p.e), newA: xi + 1, newB: xi + cnt };
  }
  function dupParas(xml, a, b) { var c = copyParas(xml, a, b); if (c.err) return c; return pasteBlock(xml, b, c); }
  function copyTable(xml, xi) {
    var b = tblBlock(xml, xi); if (b.err) return b;
    return { kind: 'table', xml: b.xml, tblEnd: b.tbl.e };
  }
  function dupTable(xml, xi) {
    var b = tblBlock(xml, xi); if (b.err) return b;
    var outer = innermost(ranges(xml, 'w:tc'), b.tbl.s);
    if (outer) return { err: '표 안의 표는 폰에서 복제할 수 없습니다.' };
    var frag = cleanClone(b.xml, xml), n = paras(frag).length, before = paras(xml.slice(0, b.tbl.e)).length;
    return { xml: xml.slice(0, b.tbl.e) + '<w:p/>' + frag + xml.slice(b.tbl.e), newA: before + 1, newB: before + n };
  }

  // ---- 표 서식: 칸 배경색(칸·줄·표 전체) · 테두리(켜기·끄기·굵기) · 첫 줄을 제목 줄로 ----
  var TBLPR_ORDER = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'];
  function cellRangesIn(xml, from, to) { return ranges(xml, 'w:tc').filter(function (r) { return r.s >= from && r.e <= to; }).sort(function (x, y) { return y.s - x.s; }); }
  function setCellShade(xml, xi, hex, scope) {         // hex = 'RRGGBB' | null(배경 없음), scope = 'cell' | 'row' | 'table'
    var b = tblBlock(xml, xi); if (b.err) return b;
    var shd = hex ? '<w:shd w:val="clear" w:color="auto" w:fill="' + hex + '"/>' : null, cells;
    if (scope === 'cell') cells = [b.tc];
    else {
      if ((b.xml.slice(1).match(/<w:tbl>/g) || []).length) return { err: '표 안에 또 표가 있어 줄·표 전체에는 한 번에 적용할 수 없습니다. 칸마다 적용하십시오.' };
      cells = scope === 'row' ? cellRangesIn(xml, b.tr.s, b.tr.e) : cellRangesIn(xml, b.tbl.s, b.tbl.e);
    }
    cells.sort(function (x, y) { return y.s - x.s; });
    var out = xml;
    cells.forEach(function (c) {
      var tc = out.slice(c.s, c.e), nx = shd ? setTcPr(tc, 'shd', shd) : (/<w:tcPr\b/.test(tc) ? setTcPr(tc, 'shd', null).replace(/<w:tcPr\s*\/>/, '') : tc);
      out = out.slice(0, c.s) + nx + out.slice(c.e);
    });
    return { xml: out };
  }
  function setTableBorders(xml, xi, o) {               // o = { on:true|false, sz:2~24(1/8pt), color:'RRGGBB' }
    var b = tblBlock(xml, xi); if (b.err) return b;
    var t = b.xml, sz = o.sz || 4, col = o.color || '808080', ln = function (n) { return o.on ? '<w:' + n + ' w:val="single" w:sz="' + sz + '" w:space="0" w:color="' + col + '"/>' : '<w:' + n + ' w:val="nil"/>'; };
    var tb = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(ln).join('') + '</w:tblBorders>';
    var pm = /<w:tblPr\b[\s\S]*?<\/w:tblPr>|<w:tblPr\s*\/>/.exec(t);
    if (!pm) return { err: '이 표는 속성이 없어 테두리를 바꿀 수 없습니다.' };
    var npr = setProp(pm[0], 'w:tblPr', TBLPR_ORDER, 'tblBorders', tb);
    var nt = t.slice(0, pm.index) + npr + t.slice(pm.index + pm[0].length);
    nt = nt.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g, '');
    return { xml: xml.slice(0, b.tbl.s) + nt + xml.slice(b.tbl.e) };
  }
  function headerRow(xml, xi) {                        // 표 첫 줄: 굵게 + 연한 회색 배경
    var b = tblBlock(xml, xi); if (b.err) return b;
    var rows = rowsOfTbl(b.xml); if (!rows.length) return { err: '표에 줄이 없습니다.' };
    var r0 = rows[0], row = b.xml.slice(r0.s, r0.e);
    row = fmtRunTags(row, { bold: true });
    row = row.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, function (tc) { return setTcPr(tc, 'shd', '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>'); });
    var nt = b.xml.slice(0, r0.s) + row + b.xml.slice(r0.e);
    return { xml: xml.slice(0, b.tbl.s) + nt + xml.slice(b.tbl.e) };
  }

  // ============================== v10.8: 쪽 설정 · 쪽 배경색 · 구역 나누기 · 하이퍼링크 · 각주·미주 · 문단 간격·테두리·음영 ==============================
  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var PAPER = { A4: [11906, 16838], A3: [16838, 23811], A5: [8391, 11906], B5: [10319, 14570], Letter: [12240, 15840], Legal: [12240, 20160] };
  var MARGIN = { normal: [1440, 1440, 1440, 1440], narrow: [720, 720, 720, 720], wide: [1440, 1440, 2160, 2160], moderate: [1440, 1440, 1080, 1080] };   // 위·아래·왼·오(twip)
  // 쪽 설정: o = { size:'A4'|…, orient:'portrait'|'landscape', margin:'normal'|'narrow'|'wide'|'moderate' } — 문서의 모든 구역에 적용. 바뀌는 것만 건드린다
  async function pageSetup(pkg, o) {
    var x = await must(pkg, 'word/document.xml'), n = 0;
    x = x.replace(/<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g, function (sp) {
      if (/\/>$/.test(sp)) return sp;
      n++;
      var pg = /<w:pgSz\b[^>]*\/>/.exec(sp), cw = pg ? +(attrOf(pg[0], 'w') || 11906) : 11906, ch = pg ? +(attrOf(pg[0], 'h') || 16838) : 16838, land = pg ? attrOf(pg[0], 'orient') === 'landscape' || cw > ch : false;
      var w = cw, h = ch;
      if (o.size && PAPER[o.size]) { var q = PAPER[o.size]; w = q[0]; h = q[1]; if (land) { var t = w; w = h; h = t; } }
      else if (!land) { var a = Math.min(w, h), b = Math.max(w, h); w = a; h = b; } else { var a2 = Math.min(w, h), b2 = Math.max(w, h); w = b2; h = a2; }
      var wantLand = o.orient ? o.orient === 'landscape' : land;
      if (wantLand !== (w > h)) { var t2 = w; w = h; h = t2; }
      var np = '<w:pgSz w:w="' + w + '" w:h="' + h + '"' + (wantLand ? ' w:orient="landscape"' : '') + '/>';
      sp = pg ? sp.replace(pg[0], np) : sp.replace(/(<w:sectPr\b[^>]*>)/, '$1' + np);
      if (o.margin && MARGIN[o.margin]) {
        var m = MARGIN[o.margin], pm = /<w:pgMar\b[^>]*\/>/.exec(sp), keep = pm ? pm[0].replace(/\sw:(top|bottom|left|right)="[^"]*"/g, '') : '<w:pgMar/>';
        var np2 = keep.replace(/^<w:pgMar/, '<w:pgMar w:top="' + m[0] + '" w:right="' + m[3] + '" w:bottom="' + m[1] + '" w:left="' + m[2] + '"').replace(/\s*\/>$/, '/>');
        if (!/w:header=/.test(np2)) np2 = np2.replace(/\/>$/, ' w:header="720" w:footer="720" w:gutter="0"/>');
        sp = pm ? sp.replace(pm[0], np2) : sp.replace(/(<w:pgSz\b[^>]*\/>)/, '$1' + np2);
      }
      return sp;
    });
    if (!n) return { err: '이 문서에서 쪽 설정을 찾지 못했습니다.' };
    pkg.write('word/document.xml', x); return { ok: true, sections: n };
  }
  function readPage(xml) {                       // 첫 구역의 쪽 모양(표시용)
    var sp = /<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/.exec(xml), pg = sp && /<w:pgSz\b[^>]*\/>/.exec(sp[0]); if (!pg) return null;
    var w = +(attrOf(pg[0], 'w') || 0), h = +(attrOf(pg[0], 'h') || 0), name = null;
    Object.keys(PAPER).forEach(function (k) { var q = PAPER[k]; if ((Math.abs(q[0] - w) < 30 && Math.abs(q[1] - h) < 30) || (Math.abs(q[1] - w) < 30 && Math.abs(q[0] - h) < 30)) name = k; });
    return { w: w, h: h, land: attrOf(pg[0], 'orient') === 'landscape' || w > h, name: name };
  }
  // 쪽 배경색(hex 6자리, null 이면 없앰)
  async function pageColor(pkg, hex) {
    var x = await must(pkg, 'word/document.xml'), sx = await pkg.read('word/settings.xml');
    x = x.replace(/<w:background\b[^>]*?\/>/, '');
    if (hex) {
      var m = /<w:document\b[^>]*>/.exec(x); if (!m) return { err: '문서 시작 부분을 찾지 못했습니다.' };
      x = x.slice(0, m.index + m[0].length) + '<w:background w:color="' + hex + '"/>' + x.slice(m.index + m[0].length);
      if (sx != null && !/<w:displayBackgroundShape\b/.test(sx)) {
        var ins = '<w:displayBackgroundShape/>', pos = sx.search(/<w:(?:view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|writeProtection)\b[\s\S]*?(?:\/>|<\/w:\w+>)/);
        var zm = /<w:zoom\b[^>]*?\/>/.exec(sx), wm = /<w:writeProtection\b[^>]*?\/>/.exec(sx), at = zm ? zm.index + zm[0].length : (wm ? wm.index + wm[0].length : -1);
        if (at < 0) { var sm = /<w:settings\b[^>]*>/.exec(sx); at = sm ? sm.index + sm[0].length : -1; }
        if (at >= 0) sx = sx.slice(0, at) + ins + sx.slice(at); pkg.write('word/settings.xml', sx);
      }
    }
    pkg.write('word/document.xml', x); return { ok: true };
  }
  // 고른 문단 뒤에서 구역 나누기(다음 쪽부터): 지금 구역의 쪽 모양을 그대로 이어받은 빈 문단을 넣는다
  function sectionBreakAfter(xml, xi) {
    var ps = paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    if (p.anc.join('/') !== 'w:document/w:body') return { err: '표 안에서는 구역을 나눌 수 없습니다.' };
    var last = /<w:sectPr\b[^>]*?>[\s\S]*?<\/w:sectPr>\s*<\/w:body>/.exec(xml); if (!last) return { err: '문서의 쪽 설정을 찾지 못했습니다.' };
    var sp = last[0].replace(/\s*<\/w:body>$/, '').replace(/<w:(?:headerReference|footerReference|titlePg)\b[^>]*\/>/g, '');
    if (/<w:sectPr\b/.test(xml.slice(p.s, p.e))) return { err: '이 문단은 이미 구역의 끝입니다.' };
    return { xml: xml.slice(0, p.e) + '<w:p><w:pPr>' + sp + '</w:pPr></w:p>' + xml.slice(p.e) };
  }
  // 하이퍼링크: 고른 문단 맨 끝에 「글(링크)」를 붙인다
  async function addLink(pkg, xi, text, url) {
    text = String(text || '').trim(); url = String(url || '').trim();
    if (!text) return { err: '링크로 보일 글을 적어 주십시오.' };
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) { if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url; else return { err: '주소는 https:// 로 시작하게 적어 주십시오.' }; }
    var x = await must(pkg, 'word/document.xml'), p = P(x, xi), ps = x.slice(p.s, p.e);
    if (/\/>\s*$/.test(ps.slice(0, ps.indexOf('>') + 1))) return { err: '빈 문단에는 먼저 글을 한 글자라도 쓴 뒤 넣어 주십시오.' };
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), id = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + id + '" Type="' + RT + 'hyperlink" Target="' + esc(url) + '" TargetMode="External"/></Relationships>'));
    var run = '<w:hyperlink r:id="' + id + '" w:history="1"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:hyperlink>';
    x = x.slice(0, p.e - 6) + run + x.slice(p.e - 6);
    if (!/<w:document\b[^>]*xmlns:r=/.test(x)) x = x.replace(/<w:document\b/, '<w:document xmlns:r="' + R_NS + '"');
    pkg.write('word/document.xml', x); return { ok: true };
  }

  // ---- 각주·미주 ----
  var NOTE_KIND = {
    footnote: { part: 'word/footnotes.xml', root: 'w:footnotes', el: 'w:footnote', ref: 'w:footnoteReference', mark: 'w:footnoteRef', rel: 'footnotes', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml', style: 'FootnoteText', rstyle: 'FootnoteReference', set: 'w:footnotePr' },
    endnote: { part: 'word/endnotes.xml', root: 'w:endnotes', el: 'w:endnote', ref: 'w:endnoteReference', mark: 'w:endnoteRef', rel: 'endnotes', ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml', style: 'EndnoteText', rstyle: 'EndnoteReference', set: 'w:endnotePr' }
  };
  function noteBase(k) {
    var sep = function (t, id, mk) { return '<' + k.el + ' w:type="' + t + '" w:id="' + id + '"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:' + mk + '/></w:r></w:p></' + k.el + '>'; };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<' + k.root + ' xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '">' + sep('separator', -1, 'separator') + sep('continuationSeparator', 0, 'continuationSeparator') + '</' + k.root + '>';
  }
  function noteBody(k, id, text, hasStyle) {
    return '<' + k.el + ' w:id="' + id + '"><w:p><w:pPr>' + (hasStyle ? '<w:pStyle w:val="' + k.style + '"/>' : '') + '</w:pPr><w:r><w:rPr>' + (hasStyle ? '<w:rStyle w:val="' + k.rstyle + '"/>' : '<w:vertAlign w:val="superscript"/>') + '</w:rPr><w:' + k.mark.slice(2) + '/></w:r><w:r><w:t xml:space="preserve"> ' + esc(text) + '</w:t></w:r></w:p></' + k.el + '>';
  }
  async function ensureNotePart(pkg, kind) {
    var k = NOTE_KIND[kind], cur = await pkg.read(k.part);
    if (cur != null) return cur;
    pkg.write(k.part, noteBase(k));
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), id = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + id + '" Type="' + RT + k.rel + '" Target="' + k.rel + '.xml"/></Relationships>'));
    var ct = await must(pkg, '[Content_Types].xml');
    if (ct.indexOf('/' + k.part) < 0) pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/' + k.part + '" ContentType="' + k.ct + '"/></Types>'));
    var sx = await pkg.read('word/settings.xml');
    if (sx != null && !new RegExp('<' + k.set + '\\b').test(sx)) {
      var ins = '<' + k.set + '><' + k.el + ' w:id="-1"/><' + k.el + ' w:id="0"/></' + k.set + '>', m = /<w:(?:endnotePr|compat|docVars|rsids|mathPr|themeFontLang|clrSchemeMapping|shapeDefaults|decimalSymbol|listSeparator)\b/.exec(sx);
      if (kind === 'footnote') { var em = /<w:endnotePr\b/.exec(sx); if (em) m = em; }
      if (m) pkg.write('word/settings.xml', sx.slice(0, m.index) + ins + sx.slice(m.index));
    }
    return noteBase(k);
  }
  // 고른 문단 맨 끝에 각주(또는 미주) 표시를 넣고 내용을 쓴다
  async function insertNote(pkg, xi, text, kind) {
    kind = kind || 'footnote'; var k = NOTE_KIND[kind]; text = String(text || '').trim();
    if (!text) return { err: (kind === 'footnote' ? '각주' : '미주') + ' 내용을 적어 주십시오.' };
    var x = await must(pkg, 'word/document.xml'), p = P(x, xi), ps = x.slice(p.s, p.e);
    if (/\/>\s*$/.test(ps.slice(0, ps.indexOf('>') + 1))) return { err: '빈 문단에는 넣을 수 없습니다. 먼저 글을 쓴 뒤 넣어 주십시오.' };
    if (p.anc.some(function (n) { return n === 'w:txbxContent'; })) return { err: '텍스트 상자 안에는 넣을 수 없습니다.' };
    var nx = await ensureNotePart(pkg, kind), mx = 0; (nx.match(/w:id="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); });
    var id = mx + 1, sx = await pkg.read('word/styles.xml'), hasStyle = !!(sx && new RegExp('w:styleId="' + k.style + '"').test(sx) && new RegExp('w:styleId="' + k.rstyle + '"').test(sx));
    var ref = '<w:r><w:rPr>' + (hasStyle ? '<w:rStyle w:val="' + k.rstyle + '"/>' : '<w:vertAlign w:val="superscript"/>') + '</w:rPr><' + k.ref + ' w:id="' + id + '"/></w:r>';
    x = x.slice(0, p.e - 6) + ref + x.slice(p.e - 6);
    pkg.write('word/document.xml', x);
    pkg.write(k.part, nx.replace('</' + k.root + '>', noteBody(k, id, text, hasStyle) + '</' + k.root + '>'));
    return { ok: true, id: id };
  }
  // 문서에 있는 각주(또는 미주) 목록: [{id, text, para}] (문서 속 순서)
  async function readNotes(pkg, kind) {
    kind = kind || 'footnote'; var k = NOTE_KIND[kind], nx = await pkg.read(k.part), out = [];
    if (nx == null) return out;
    var x = await must(pkg, 'word/document.xml'), bodies = {};
    (nx.match(new RegExp('<' + k.el + '\\b[^>]*?>[\\s\\S]*?<\\/' + k.el + '>', 'g')) || []).forEach(function (b) { var id = attrOf(b.match(/^<[^>]+>/)[0], 'id'); if (!/w:type=/.test(b.match(/^<[^>]+>/)[0])) bodies[id] = pText(b).replace(/^\s+/, ''); });
    var ps = paras(x);
    ps.forEach(function (p, i) { (x.slice(p.s, p.e).match(new RegExp('<' + k.ref + '\\b[^>]*\\/>', 'g')) || []).forEach(function (t) { var id = attrOf(t, 'id'); out.push({ id: id, text: bodies[id] != null ? bodies[id] : '', para: i }); }); });
    return out;
  }
  async function editNote(pkg, id, text, kind) {
    kind = kind || 'footnote'; var k = NOTE_KIND[kind], nx = await pkg.read(k.part); text = String(text || '').trim();
    if (nx == null) return { err: '각주를 찾지 못했습니다.' };
    var re = new RegExp('(<' + k.el + '\\b[^>]*w:id="' + id + '"[^>]*>)([\\s\\S]*?)(</' + k.el + '>)'), m = re.exec(nx);
    if (!m) return { err: '각주를 찾지 못했습니다.' };
    if (!text) return { err: '내용을 적어 주십시오.' };
    var body = m[2], pm = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/.exec(body); if (!pm) return { err: '각주 안의 문단을 찾지 못했습니다.' };
    if ((body.match(/<w:p\b/g) || []).length > 1 || /<w:(drawing|pict|fldChar|hyperlink)\b/.test(body)) return { err: '이 각주에는 여러 문단·그림·링크가 있어 폰에서는 고칠 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var para = pm[0], open = /^<w:p\b[^>]*>/.exec(para)[0], ppr = (/<w:pPr\b[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/.exec(para) || [''])[0];
    var mark = (/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:(?:footnoteRef|endnoteRef)\s*\/>[\s\S]*?<\/w:r>/.exec(para) || [''])[0];
    var np = open + ppr + mark + '<w:r><w:t xml:space="preserve"> ' + esc(text) + '</w:t></w:r></w:p>';
    pkg.write(k.part, nx.replace(re, function (all, a, b, c) { return a + body.replace(pm[0], np) + c; })); return { ok: true };
  }
  async function deleteNote(pkg, id, kind) {
    kind = kind || 'footnote'; var k = NOTE_KIND[kind], nx = await pkg.read(k.part), x = await must(pkg, 'word/document.xml');
    var rr = new RegExp('<w:r\\b[^>]*>(?:<w:rPr\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/w:rPr>))?<' + k.ref + '\\b[^>]*w:id="' + id + '"[^>]*\\/></w:r>');
    if (!rr.test(x)) return { err: '문서에서 이 표시를 찾지 못했습니다.' };
    pkg.write('word/document.xml', x.replace(rr, ''));
    if (nx != null) pkg.write(k.part, nx.replace(new RegExp('<' + k.el + '\\b[^>]*w:id="' + id + '"[^>]*>[\\s\\S]*?<\\/' + k.el + '>'), ''));
    return { ok: true };
  }

  // ============================== v10.8 (3회차): 표 열 너비·행 높이·맞춤·표 모양 · 기호·날짜 · 첫 쪽 다르게 · 배경 글자 · 책갈피 · 그림·표 이름 · 목차 ==============================
  function gridOf(tblXml) { var m = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(tblXml); return m ? (m[1].match(/<w:gridCol\b[^>]*>/g) || []).map(function (g) { return +(attrOf(g, 'w') || 0); }) : null; }
  function spanOf(tcXml) { return +(attrOf((/<w:gridSpan\b[^>]*>/.exec(tcXml.slice(0, 600)) || [''])[0], 'val') || 1); }
  // 고른 칸이 든 표의 모양 읽기: {cols, rows, colIdx, rowIdx, widths(twip), total, rowH:{val,rule}|null}
  function tableGeom(xml, xi) {
    var b = tblBlock(xml, xi); if (b.err) return b;
    var t = b.xml, rows = rowsOfTbl(t), grid = gridOf(t);
    if (!grid || !grid.length) return { err: '이 표는 칸 폭 정보가 없어 폰에서는 폭을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    if (/<w:gridBefore\b|<w:gridAfter\b/.test(t)) return { err: '줄 앞뒤가 비어 있는 특수한 표라 폰에서는 폭을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var rowS = b.tr.s - b.tbl.s, rowIdx = -1, i; for (i = 0; i < rows.length; i++) if (rows[i].s === rowS) rowIdx = i;
    if (rowIdx < 0) return { err: '표 줄을 찾지 못했습니다.' };
    var cells = cellsOfRow(t.slice(rows[rowIdx].s, rows[rowIdx].e)), cellS = b.tc.s - b.tbl.s - rows[rowIdx].s, colIdx = -1, pos = 0;
    for (i = 0; i < cells.length; i++) { if (cells[i].s === cellS) { colIdx = pos; break; } pos += spanOf(t.slice(rows[rowIdx].s + cells[i].s, rows[rowIdx].s + cells[i].e)); }
    if (colIdx < 0) return { err: '표 칸을 찾지 못했습니다.' };
    var rx = t.slice(rows[rowIdx].s, rows[rowIdx].e), th = /<w:trHeight\b[^>]*>/.exec(rx.replace(/<w:tc\b[\s\S]*$/, ''));
    return { b: b, t: t, rows: rows, grid: grid, colIdx: colIdx, rowIdx: rowIdx, rowH: th ? { val: +(attrOf(th[0], 'val') || 0), rule: attrOf(th[0], 'hRule') || 'atLeast' } : null, total: grid.reduce(function (a, c) { return a + c; }, 0) };
  }
  function tableGeomInfo(xml, xi) { var g = tableGeom(xml, xi); if (g.err) return null; return { cols: g.grid.length, rows: g.rows.length, colIdx: g.colIdx, rowIdx: g.rowIdx, widths: g.grid, total: g.total, rowH: g.rowH }; }
  // 표 전체의 칸 폭을 새 값(grid)으로 쓴다: tblGrid · 모든 칸 tcW · tblW · 고정 배치
  function writeGrid(xml, g, grid) {
    var t = g.t, tot = grid.reduce(function (a, c) { return a + c; }, 0), rows = rowsOfTbl(t), out = '', last = 0;
    rows.forEach(function (rs) {
      var rx = t.slice(rs.s, rs.e), cells = cellsOfRow(rx), nr = '', lc = 0, pos = 0;
      cells.forEach(function (c) {
        var cx = rx.slice(c.s, c.e), sp = spanOf(cx), w = 0, k; for (k = pos; k < pos + sp; k++) w += grid[k] || 0; pos += sp;
        nr += rx.slice(lc, c.s) + setTcPr(cx, 'tcW', '<w:tcW w:w="' + w + '" w:type="dxa"/>'); lc = c.e;
      });
      nr += rx.slice(lc);
      out += t.slice(last, rs.s) + nr; last = rs.e;
    });
    out += t.slice(last);
    out = out.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, '<w:tblGrid>' + grid.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') + '</w:tblGrid>');
    var pm = /<w:tblPr\b[\s\S]*?<\/w:tblPr>|<w:tblPr\s*\/>/.exec(out);
    if (pm) { var np = setProp(pm[0], 'w:tblPr', TBLPR_ORDER, 'tblW', '<w:tblW w:w="' + tot + '" w:type="dxa"/>'); np = setProp(np, 'w:tblPr', TBLPR_ORDER, 'tblLayout', '<w:tblLayout w:type="fixed"/>'); out = out.slice(0, pm.index) + np + out.slice(pm.index + pm[0].length); }
    return xml.slice(0, g.b.tbl.s) + out + xml.slice(g.b.tbl.e);
  }
  // 열 너비: o = {delta:twip} 고른 칸의 열을 넓히거나 좁힘(옆 열이 대신 줄고 늘어 표 전체 폭은 그대로) · {equal:true} 모든 열을 같게 · {fit:true} 표 폭을 본문 폭에 맞춤
  function setColWidth(xml, xi, o) {
    var g = tableGeom(xml, xi); if (g.err) return g;
    if ((g.t.slice(1).match(/<w:tbl>/g) || []).length) return { err: '표 안에 또 표가 있어 폰에서는 폭을 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    var grid = g.grid.slice(), n = grid.length, MIN = 500, i;
    if (o.equal) { var each = Math.floor(g.total / n); for (i = 0; i < n; i++) grid[i] = each; grid[n - 1] += g.total - each * n; }
    else if (o.fit) { var tw = textWidth(xml), k = tw / g.total, s = 0; for (i = 0; i < n; i++) { grid[i] = Math.round(grid[i] * k); s += grid[i]; } grid[n - 1] += tw - s; }
    else {
      if (n < 2) return { err: '열이 하나뿐인 표는 폭을 나눌 수 없습니다.' };
      var ci = g.colIdx, ni = ci + 1 < n ? ci + 1 : ci - 1, d = Math.round(o.delta || 0);
      if (grid[ci] + d < MIN) d = MIN - grid[ci];
      if (grid[ni] - d < MIN) d = grid[ni] - MIN;
      if (!d) return { err: '더 이상 ' + (o.delta > 0 ? '넓힐' : '좁힐') + ' 수 없습니다(옆 열이 너무 좁아집니다).' };
      grid[ci] += d; grid[ni] -= d;
    }
    return { xml: writeGrid(xml, g, grid), colIdx: g.colIdx };
  }
  // 행 높이: o = {twip:number|null(자동), rule:'atLeast'|'exact', all:true(표 전체 줄)}
  function setRowHeight(xml, xi, o) {
    var g = tableGeom(xml, xi); if (g.err) return g;
    var t = g.t, out = '', last = 0;
    g.rows.forEach(function (rs, idx) {
      if (!o.all && idx !== g.rowIdx) return;
      var rx = t.slice(rs.s, rs.e), head = /^<w:tr\b[^>]*>/.exec(rx)[0], rest = rx.slice(head.length), pex = /^\s*<w:tblPrEx\b[\s\S]*?<\/w:tblPrEx>/.exec(rest), pexs = pex ? pex[0] : '';
      rest = rest.slice(pexs.length);
      var pm = /^\s*<w:trPr\b[\s\S]*?<\/w:trPr>|^\s*<w:trPr\s*\/>/.exec(rest), box = pm ? pm[0].trim() : '', after = pm ? rest.slice(pm[0].length) : rest, inner = '';
      if (box && !/\/>$/.test(box.slice(0, box.indexOf('>') + 1))) inner = box.slice(box.indexOf('>') + 1, box.lastIndexOf('</w:trPr>'));
      inner = inner.replace(/<w:trHeight\b[^>]*\/>/g, '');
      if (o.twip) inner += '<w:trHeight w:val="' + Math.round(o.twip) + '"' + (o.rule === 'exact' ? ' w:hRule="exact"' : ' w:hRule="atLeast"') + '/>';
      var nbox = inner ? '<w:trPr>' + inner + '</w:trPr>' : '';
      out += t.slice(last, rs.s) + head + pexs + nbox + after; last = rs.e;
    });
    out += t.slice(last);
    return { xml: xml.slice(0, g.b.tbl.s) + out + xml.slice(g.b.tbl.e) };
  }
  function setTableAlign(xml, xi, al) {
    var b = tblBlock(xml, xi); if (b.err) return b;
    var pm = /<w:tblPr\b[\s\S]*?<\/w:tblPr>|<w:tblPr\s*\/>/.exec(b.xml); if (!pm) return { err: '이 표는 속성이 없어 맞춤을 바꿀 수 없습니다.' };
    var np = setProp(pm[0], 'w:tblPr', TBLPR_ORDER, 'jc', al === 'left' ? null : '<w:jc w:val="' + al + '"/>');
    var nt = b.xml.slice(0, pm.index) + np + b.xml.slice(pm.index + pm[0].length);
    return { xml: xml.slice(0, b.tbl.s) + nt + xml.slice(b.tbl.e) };
  }
  // 표 모양 본보기: kind = grid(격자) | headgrid(제목 줄 강조 + 격자) | band(줄무늬) | bandoff(줄무늬 없애기) | hlines(가로선만)
  function tableLook(xml, xi, kind) {
    var b = tblBlock(xml, xi); if (b.err) return b;
    if ((b.xml.slice(1).match(/<w:tbl>/g) || []).length) return { err: '표 안에 또 표가 있어 폰에서는 모양을 한 번에 바꿀 수 없습니다.' };
    var r;
    if (kind === 'grid') return setTableBorders(xml, xi, { on: true, sz: 4, color: '808080' });
    if (kind === 'headgrid') { r = setTableBorders(xml, xi, { on: true, sz: 4, color: '808080' }); if (r.err) return r; return headerRow(r.xml, xi); }
    if (kind === 'hlines') {
      var pm = /<w:tblPr\b[\s\S]*?<\/w:tblPr>|<w:tblPr\s*\/>/.exec(b.xml); if (!pm) return { err: '이 표는 속성이 없어 모양을 바꿀 수 없습니다.' };
      var ln = function (n) { return '<w:' + n + ' w:val="single" w:sz="6" w:space="0" w:color="808080"/>'; }, nl = function (n) { return '<w:' + n + ' w:val="nil"/>'; };
      var tb = '<w:tblBorders>' + ln('top') + nl('left') + ln('bottom') + nl('right') + ln('insideH') + nl('insideV') + '</w:tblBorders>';
      var np = setProp(pm[0], 'w:tblPr', TBLPR_ORDER, 'tblBorders', tb), nt = b.xml.slice(0, pm.index) + np + b.xml.slice(pm.index + pm[0].length);
      nt = nt.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g, '');
      return { xml: xml.slice(0, b.tbl.s) + nt + xml.slice(b.tbl.e) };
    }
    if (kind === 'band' || kind === 'bandoff') {
      var rows = rowsOfTbl(b.xml), t = b.xml, out = '', last = 0;
      rows.forEach(function (rs, idx) {
        if (kind === 'band' && (idx === 0 || idx % 2 === 0)) return;           // 둘째·넷째… 줄만 연하게 칠한다(첫 줄은 제목 줄이라 건드리지 않음)
        var rx = t.slice(rs.s, rs.e);
        if (kind === 'band') rx = rx.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, function (tc) { return /<w:shd\b[^>]*w:fill="(?!auto)[0-9A-Fa-f]{6}"/.test(tc) ? tc : setTcPr(tc, 'shd', '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>'); });
        else rx = rx.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, function (tc) { return /<w:shd\b[^>]*w:fill="F2F2F2"/.test(tc) ? setTcPr(tc, 'shd', null).replace(/<w:tcPr\s*\/>/, '') : tc; });
        out += t.slice(last, rs.s) + rx; last = rs.e;
      });
      out += t.slice(last);
      return { xml: xml.slice(0, b.tbl.s) + out + xml.slice(b.tbl.e) };
    }
    return { err: '알 수 없는 표 모양입니다.' };
  }

  // ---- 기호 · 날짜: 고른 문단 맨 끝에 글을 붙인다(마지막 글 조각의 서식을 이어받음) ----
  function appendText(xml, xi, text) {
    var p = P(xml, xi), ps = xml.slice(p.s, p.e); text = String(text == null ? '' : text); if (!text) return { err: '넣을 글이 없습니다.' };
    var rs = ps.match(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t\b[\s\S]*?<\/w:r>/g), rpr = '';
    if (rs) { var m = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(rs[rs.length - 1]); if (m) rpr = m[0].replace(/<w:(?:rStyle|vertAlign)\b[^>]*\/>/g, ''); }
    var run = '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>', head = /^<w:p\b[^>]*?>/.exec(ps)[0];
    if (/\/>$/.test(head)) { var np = head.replace(/\s*\/>$/, '>') + run + '</w:p>'; return { xml: xml.slice(0, p.s) + np + xml.slice(p.e) }; }
    return { xml: xml.slice(0, p.e - 6) + run + xml.slice(p.e - 6) };
  }

  // ---- 첫 쪽 다르게(머리글·바닥글) / 배경 글자(워터마크) ----
  var SECT_AFTER_TITLEPG = ['textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'];
  function firstSect(xml) { return /<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/.exec(xml); }
  function readTitlePg(xml) { var m = firstSect(xml); return !!(m && /<w:titlePg\b/.test(m[0])); }
  async function setTitlePg(pkg, on) {
    var x = await must(pkg, 'word/document.xml'), m = firstSect(x); if (!m || /\/>$/.test(m[0])) return { err: '이 문서에서 쪽 설정을 찾지 못했습니다.' };
    var sp = m[0].replace(/<w:titlePg\b[^>]*\/>/g, '');
    if (on) {
      var re = new RegExp('<w:(?:' + SECT_AFTER_TITLEPG.join('|') + ')\\b'), at = re.exec(sp);
      sp = at ? sp.slice(0, at.index) + '<w:titlePg/>' + sp.slice(at.index) : sp.replace(/<\/w:sectPr>$/, '<w:titlePg/></w:sectPr>');
    }
    pkg.write('word/document.xml', x.slice(0, m.index) + sp + x.slice(m.index + m[0].length)); return { ok: true, on: !!on };
  }
  var VML_NS = { v: 'xmlns:v="urn:schemas-microsoft-com:vml"', o: 'xmlns:o="urn:schemas-microsoft-com:office:office"', w10: 'xmlns:w10="urn:schemas-microsoft-com:office:word"' };
  function wmRuns(text, color) {
    var len = Math.max(4, text.length), w = Math.min(470, 66 * len), h = Math.round(w / len * 1.05);
    return '<w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>' +
      '<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:' + w + 'pt;height:' + h + 'pt;rotation:315;z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#' + color + '" stroked="f"><v:fill opacity=".5"/><v:textpath style="font-family:&quot;맑은 고딕&quot;;font-size:1pt" string="' + esc(text) + '"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>';
  }
  var WM_RE = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?PowerPlusWaterMarkObject[\s\S]*?<\/w:r>/g;
  // 문서 안 모든 머리글 파트(기본·첫 쪽·짝수 쪽) [{type, path}]
  async function allHeaderParts(pkg) {
    var xml = await must(pkg, 'word/document.xml'), rx = await must(pkg, 'word/_rels/document.xml.rels'), rels = {}, out = [], seen = {};
    (rx.match(/<Relationship\b[^>]*>/g) || []).forEach(function (r) { rels[attrOf(r, 'Id')] = attrOf(r, 'Target'); });
    (xml.match(/<w:headerReference\b[^>]*>/g) || []).forEach(function (t) {
      var tg = rels[attrOf(t, 'id')]; if (!tg) return; var path = 'word/' + tg.replace(/^\.?\//, ''); if (seen[path]) return; seen[path] = 1; out.push({ type: attrOf(t, 'type') || 'default', path: path });
    });
    return out;
  }
  async function ensureFirstHeader(pkg) {            // 「첫 쪽 다르게」가 켜져 있고 첫 쪽 머리글이 없으면 빈 첫 쪽 머리글을 만든다
    var parts = await allHeaderParts(pkg); if (parts.some(function (p) { return p.type === 'first'; })) return;
    var n = 1; while (pkg.list().indexOf('word/header' + n + '.xml') >= 0) n++;
    var path = 'word/header' + n + '.xml';
    pkg.write(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '"><w:p/></w:hdr>');
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), rid = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT + 'header" Target="header' + n + '.xml"/></Relationships>'));
    var ct = await must(pkg, '[Content_Types].xml'); pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/' + path + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'));
    var dx = await must(pkg, 'word/document.xml'), sm = firstSect(dx); if (!sm) return;
    var open = /^<w:sectPr\b[^>]*>/.exec(sm[0])[0];
    pkg.write('word/document.xml', dx.slice(0, sm.index) + open + '<w:headerReference w:type="first" r:id="' + rid + '"/>' + sm[0].slice(open.length) + dx.slice(sm.index + sm[0].length));
  }
  async function readWatermark(pkg) {
    var parts = await allHeaderParts(pkg);
    for (var i = 0; i < parts.length; i++) { var hx = await pkg.read(parts[i].path); if (hx) { var m = /PowerPlusWaterMarkObject[\s\S]*?<v:textpath\b[^>]*\sstring="([^"]*)"/.exec(hx); if (m) return unesc(m[1]); } }
    return null;
  }
  // text 가 비면 배경 글자를 없앤다. 모든 머리글(기본·첫 쪽·짝수 쪽)에 넣는다
  async function setWatermark(pkg, text, color) {
    text = String(text || '').trim(); color = color || 'BFBFBF';
    var parts = await allHeaderParts(pkg), i, hx;
    for (i = 0; i < parts.length; i++) { hx = await pkg.read(parts[i].path); if (hx && /PowerPlusWaterMarkObject/.test(hx)) pkg.write(parts[i].path, hx.replace(WM_RE, '')); }
    if (!text) return { ok: true, removed: true };
    if (!parts.length) { var r = await setHF(pkg, 'header', ['']); if (r && r.err) return r; }
    var dxx = await must(pkg, 'word/document.xml'); if (readTitlePg(dxx)) await ensureFirstHeader(pkg);
    parts = await allHeaderParts(pkg);
    for (i = 0; i < parts.length; i++) {
      var path = parts[i].path; hx = await must(pkg, path);
      var root = /<w:hdr\b[^>]*>/.exec(hx); if (!root) return { err: '머리글 파트를 읽지 못했습니다.' };
      var open = root[0]; Object.keys(VML_NS).forEach(function (pfx) { if (!new RegExp('xmlns:' + pfx + '=').test(open)) open = open.replace(/>$/, ' ' + VML_NS[pfx] + '>'); });
      hx = open + hx.slice(root[0].length);
      var pm = /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/.exec(hx.slice(open.length)); if (!pm) { hx = hx.replace(/<\/w:hdr>\s*$/, '<w:p/></w:hdr>'); pm = /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/.exec(hx.slice(open.length)); }
      var ps = open.length + pm.index, pe = ps + pm[0].length, para = pm[0];
      if (/\/>$/.test(para.slice(0, para.indexOf('>') + 1))) para = para.replace(/\s*\/>$/, '></w:p>');
      para = para.replace(/<\/w:p>$/, wmRuns(text, color).replace('PowerPlusWaterMarkObject1', 'PowerPlusWaterMarkObject' + (i + 1)).replace('_x0000_s2049', '_x0000_s' + (2049 + i)) + '</w:p>');
      pkg.write(path, hx.slice(0, ps) + para + hx.slice(pe));
    }
    return { ok: true };
  }

  // ---- 책갈피 ----
  function listBookmarks(xml) {
    var out = [], ps = paras(xml);
    ps.forEach(function (p, i) { (xml.slice(p.s, p.e).match(/<w:bookmarkStart\b[^>]*>/g) || []).forEach(function (t) { var nm = unesc(attrOf(t, 'name') || ''); if (nm && nm.charAt(0) !== '_') out.push({ name: nm, id: attrOf(t, 'id'), para: i }); }); });
    return out;
  }
  function addBookmark(xml, xi, name) {
    name = String(name || '').trim().replace(/\s+/g, '_');
    if (!name) return { err: '책갈피 이름을 적어 주십시오.' };
    if (!/^[A-Za-z가-힣][A-Za-z0-9가-힣_]{0,39}$/.test(name)) return { err: '책갈피 이름은 글자로 시작하고 글자·숫자·밑줄(_)만 쓸 수 있으며 40자까지입니다.' };
    if (listBookmarks(xml).some(function (b) { return b.name === name; })) return { err: '이미 있는 이름입니다. 다른 이름을 적어 주십시오.' };
    var p = P(xml, xi), ps = xml.slice(p.s, p.e), mx = 0; (xml.match(/<w:bookmarkStart\b[^>]*\sw:id="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); });
    var id = mx + 1, st = '<w:bookmarkStart w:id="' + id + '" w:name="' + esc(name) + '"/>', en = '<w:bookmarkEnd w:id="' + id + '"/>', head = /^<w:p\b[^>]*?>/.exec(ps)[0], np;
    if (/\/>$/.test(head)) np = head.replace(/\s*\/>$/, '>') + st + en + '</w:p>';
    else { var pp = pPrOf(ps); np = ps.slice(0, pp.e) + st + ps.slice(pp.e, ps.length - 6) + en + '</w:p>'; }
    return { xml: xml.slice(0, p.s) + np + xml.slice(p.e), name: name };
  }
  function deleteBookmark(xml, name) {
    var re = new RegExp('<w:bookmarkStart\\b[^>]*w:name="' + String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*/>'), m = re.exec(xml); if (!m) return { err: '책갈피를 찾지 못했습니다.' };
    var id = attrOf(m[0], 'id'), x = xml.replace(m[0], '').replace(new RegExp('<w:bookmarkEnd\\b[^>]*w:id="' + id + '"[^>]*/>'), ''); return { xml: x };
  }
  // 문서 안 책갈피로 가는 링크: 고른 문단 맨 끝에 글(링크)을 붙인다
  function addAnchorLink(xml, xi, text, bm) {
    text = String(text || '').trim(); if (!text) return { err: '링크로 보일 글을 적어 주십시오.' };
    if (!listBookmarks(xml).some(function (b) { return b.name === bm; })) return { err: '그 책갈피를 찾지 못했습니다.' };
    var p = P(xml, xi), ps = xml.slice(p.s, p.e), run = '<w:hyperlink w:anchor="' + esc(bm) + '" w:history="1"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:hyperlink>', head = /^<w:p\b[^>]*?>/.exec(ps)[0];
    if (/\/>$/.test(head)) return { xml: xml.slice(0, p.s) + head.replace(/\s*\/>$/, '>') + run + '</w:p>' + xml.slice(p.e) };
    return { xml: xml.slice(0, p.e - 6) + run + xml.slice(p.e - 6) };
  }

  // ---- 그림·표 이름(캡션): 「그림 1」 + 글. 같은 이름표의 번호는 문서 순서대로 다시 매긴다 ----
  STYLE_NAMES.caption = ['caption', '캡션', '그림 설명'];
  STYLE_DEF.caption = '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>';
  function renumberSeq(xml, label) {                 // 같은 이름표의 번호(간단한 필드·복잡한 필드 모두)를 문서 순서대로 다시 매긴다
    var n = 0, esl = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rpr = '(?:<w:rPr>(?:(?!<\\/w:rPr>)[\\s\\S])*<\\/w:rPr>)?';
    var simple = '<w:fldSimple\\b[^>]*w:instr="\\s*SEQ\\s+' + esl + '(?![A-Za-z0-9_])[^"]*"[^>]*>(?:(?!<\\/w:fldSimple>)[\\s\\S])*?<\\/w:fldSimple>';
    var cplx = '<w:instrText\\b[^>]*>\\s*SEQ\\s+' + esl + '(?![A-Za-z0-9_])[^<]*<\\/w:instrText><\\/w:r>\\s*<w:r\\b[^>]*>' + rpr + '<w:fldChar\\b[^>]*w:fldCharType="separate"[^>]*\\/><\\/w:r>\\s*<w:r\\b[^>]*>' + rpr + '<w:t\\b[^>]*>\\d+<\\/w:t>';
    var re = new RegExp(simple + '|' + cplx, 'g');
    return xml.replace(re, function (f) { n++; return f.replace(/(<w:t\b[^>]*>)\d+(<\/w:t>)(?![\s\S]*<w:t\b)/, '$1' + n + '$2'); });
  }
  // above=true 면 고른 문단 위에, 아니면 아래에 넣는다(그림은 보통 아래, 표는 위)
  async function addCaption(pkg, xi, label, text, above) {
    label = String(label || '그림').trim() || '그림'; text = String(text || '').trim();
    if (!/^[A-Za-z가-힣]{1,10}$/.test(label)) return { err: '이름표는 글자 10자까지(예: 그림, 표)만 쓸 수 있습니다.' };
    var sid = await ensureStyle(pkg, 'caption'), x = await must(pkg, 'word/document.xml'), p = P(x, xi);
    if (p.anc.indexOf('w:txbxContent') >= 0) return { err: '텍스트 상자 안에는 넣을 수 없습니다.' };
    var kn = above ? '<w:keepNext/>' : '';
    var par = '<w:p><w:pPr>' + (sid ? '<w:pStyle w:val="' + sid + '"/>' : '') + kn + (sid ? '' : '<w:spacing w:after="200"/>') + '</w:pPr><w:r>' + (sid ? '' : '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr>') + '<w:t xml:space="preserve">' + esc(label) + ' </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ ' + esc(label) + ' \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:noProof/></w:rPr><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' + (text ? '<w:r><w:t xml:space="preserve"> ' + esc(text) + '</w:t></w:r>' : '') + '</w:p>';
    var at = above ? p.s : p.e;
    if (p.anc.indexOf('w:tc') >= 0) {                               // 표 칸 안의 문단 → 표 전체의 위 또는 아래
      var tbs = ranges(x, 'w:tbl').filter(function (r) { return r.s <= p.s && p.s < r.e; }).sort(function (u, v) { return u.s - v.s; });
      if (tbs.length) at = above ? tbs[0].s : tbs[0].e;
    }
    x = x.slice(0, at) + par + x.slice(at);
    pkg.write('word/document.xml', renumberSeq(x, label)); return { ok: true, newXi: above ? xi : xi + 1 };
  }

  // ---- 목차 ----
  function headingLevels(sx) {                       // styleId → 1~9
    var map = {}; if (!sx) return map;
    (sx.match(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g) || []).forEach(function (s) {
      var id = attrOf(s.match(/^<w:style\b[^>]*>/)[0], 'styleId'), nm = /<w:name\s+w:val="([^"]*)"/.exec(s), m = nm && /^(?:heading|제목)\s*(\d)$/i.exec(nm[1]);
      if (m) map[id] = +m[1];
    });
    return map;
  }
  function headingList(xml, sx, maxLv) {
    var map = headingLevels(sx), out = [], ps = paras(xml);
    ps.forEach(function (p, i) {
      if (p.anc.indexOf('w:tc') >= 0 || p.anc.indexOf('w:txbxContent') >= 0) return;
      var s = xml.slice(p.s, p.e), st = /<w:pStyle\s+w:val="([^"]*)"/.exec(s), lv = st && map[st[1]] ? map[st[1]] : 0;
      if (!lv) { var ol = /<w:outlineLvl\s+w:val="(\d)"/.exec(s); if (ol) lv = +ol[1] + 1; }
      if (!lv || lv > maxLv) return;
      var t = pText(s.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')).replace(/\s+/g, ' ').trim(); if (t) out.push({ xi: i, lv: lv, text: t });
    });
    return out;
  }
  function tocField(xml) {                            // 첫 목차 필드의 문단 범위 {a,b,endAt,tail,entries:[{text,page}]} (없으면 null). 워드는 필드 끝을 다음 글 문단 앞머리에 두기도 한다 → tail
    var ps = paras(xml), a = -1, i, j;
    for (i = 0; i < ps.length && a < 0; i++) { var s0 = xml.slice(ps[i].s, ps[i].e); if (/<w:instrText\b[^>]*>\s*TOC\b/.test(s0) || /<w:fldSimple\b[^>]*w:instr="\s*TOC\b/.test(s0)) a = i; }
    if (a < 0) return null;
    var b = a, simple = /<w:fldSimple\b[^>]*w:instr="\s*TOC\b/.test(xml.slice(ps[a].s, ps[a].e)), endAt = ps[a].e;
    if (!simple) {
      var depth = 0, done = false;
      for (i = a; i < ps.length && !done; i++) {
        var s = xml.slice(ps[i].s, ps[i].e), re = /<w:fldChar\b[^>]*w:fldCharType="(begin|end)"/g, m;
        while ((m = re.exec(s))) {
          depth += m[1] === 'begin' ? 1 : -1;
          if (depth === 0) { done = true; b = i; var rs = s.lastIndexOf('<w:r', m.index), re2 = s.indexOf('</w:r>', m.index); endAt = ps[i].s + (re2 >= 0 ? re2 + 6 : m.index + m[0].length); break; }
        }
      }
      if (!done) return null;
    }
    var entries = [];
    for (j = a; j <= b; j++) { var q = pText(xml.slice(ps[j].s, j === b ? endAt : ps[j].e)).replace(/\r?\n/g, ''), parts = q.split('\t'); if (parts[0].trim()) entries.push({ text: parts[0].trim(), page: parts.length > 1 ? parts[parts.length - 1].trim() : '' }); }
    var tail = xml.slice(endAt, ps[b].e), hasTail = /<w:(?:t|drawing|pict|hyperlink|fldChar|fldSimple|br|tab|bookmarkStart)\b/.test(tail);
    return { a: a, b: b, endAt: endAt, hasTail: hasTail, entries: entries };
  }
  function tocParas(heads, oldEntries, tocStyles, tw) {
    var used = {}, pageOf = function (t) { for (var k = 0; k < oldEntries.length; k++) if (!used[k] && oldEntries[k].text.replace(/\s+/g, ' ') === t && /^\d+$/.test(oldEntries[k].page)) { used[k] = 1; return oldEntries[k].page; } return ''; };
    var instr = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>', out = [];
    if (!heads.length) return '<w:p>' + instr + '<w:r><w:t>(제목 스타일을 쓴 글이 없어 목차가 비어 있습니다)</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    heads.forEach(function (h, i) {
      var pg = pageOf(h.text), sid = tocStyles[h.lv] || null, ind = (h.lv - 1) * 220;
      var ppr = '<w:pPr>' + (sid ? '<w:pStyle w:val="' + sid + '"/>' : '') + '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + tw + '"/></w:tabs>' + (!sid && ind ? '<w:ind w:left="' + ind + '"/>' : '') + '</w:pPr>';
      out.push('<w:p>' + ppr + (i === 0 ? instr : '') + '<w:r><w:t xml:space="preserve">' + esc(h.text) + '</w:t></w:r>' + (pg ? '<w:r><w:tab/></w:r><w:r><w:t>' + pg + '</w:t></w:r>' : '') + '</w:p>');
    });
    out.push('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
    return out.join('');
  }
  function tocStyleIds(sx) { var o = {}; (sx || '').replace(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, function (s) { var nm = /<w:name\s+w:val="([^"]*)"/.exec(s), m = nm && /^toc (\d)$/i.exec(nm[1]); if (m) o[+m[1]] = attrOf(s.match(/^<w:style\b[^>]*>/)[0], 'styleId'); return s; }); return o; }
  // 고른 문단 아래에 목차를 넣는다(제목 스타일 1~3단계). 쪽 번호는 워드에서 필드를 갱신하면 채워진다
  async function insertToc(pkg, xi) {
    var x = await must(pkg, 'word/document.xml'), sx = await pkg.read('word/styles.xml');
    if (tocField(x)) return { err: '이 문서에는 이미 목차가 있습니다. 「목차 갱신」을 눌러 주십시오.' };
    var ps = paras(x), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    if (p.anc.indexOf('w:tc') >= 0) return { err: '표 안에는 목차를 넣을 수 없습니다.' };
    var heads = headingList(x, sx, 3), xml = tocParas(heads, [], tocStyleIds(sx), textWidth(x));
    pkg.write('word/document.xml', x.slice(0, p.e) + xml + x.slice(p.e)); return { ok: true, n: heads.length, newXi: xi + 1 };
  }
  async function updateToc(pkg) {
    var x = await must(pkg, 'word/document.xml'), sx = await pkg.read('word/styles.xml'), f = tocField(x);
    if (!f) return { err: '이 문서에는 목차가 없습니다. 먼저 「목차 넣기」를 눌러 주십시오.' };
    var ps = paras(x);
    if (ps[f.a].anc.join('/') !== 'w:document/w:body') return { err: '표나 상자 안에 있는 목차는 폰에서 갱신할 수 없습니다.' };
    var lastKept = f.hasTail ? f.b - 1 : f.b;
    var heads = headingList(x, sx, 3).filter(function (h) { return h.xi < f.a || h.xi > lastKept; }), xml = tocParas(heads, f.entries, tocStyleIds(sx), textWidth(x));
    var rest = '', to = ps[f.b].e;
    if (f.hasTail) {                                  // 필드 끝 뒤에 남은 글(워드가 같은 문단에 둔 제목)은 그대로 둔다
      var pstr = x.slice(ps[f.b].s, ps[f.b].e), pp = pPrOf(pstr), head = /^<w:p\b[^>]*?>/.exec(pstr)[0];
      rest = head + (pp ? pp.xml : '') + x.slice(f.endAt, ps[f.b].e);
    }
    pkg.write('word/document.xml', x.slice(0, ps[f.a].s) + xml + rest + x.slice(to)); return { ok: true, n: heads.length };
  }

  // ============================== v10.8 (3회차): 메모 · 변경 내용(수락·거절) · 서식 따라 하기 · 단 나누기 · 그림 배치·크기 ==============================
  // ---- 메모(주석) ----
  var CM_PART = 'word/comments.xml', CM_AUTHOR = '메모';
  async function ensureCommentsPart(pkg) {
    var cur = await pkg.read(CM_PART); if (cur != null) return cur;
    var base = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="' + W_NS + '" xmlns:r="' + R_NS + '"></w:comments>';
    pkg.write(CM_PART, base);
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), id = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + id + '" Type="' + RT + 'comments" Target="comments.xml"/></Relationships>'));
    var ct = await must(pkg, '[Content_Types].xml');
    if (ct.indexOf('/' + CM_PART) < 0) pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/' + CM_PART + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
    return base;
  }
  function commentBodies(cx) {
    var out = [];
    (cx.match(/<w:comment\b[^>]*?>[\s\S]*?<\/w:comment>/g) || []).forEach(function (c) {
      var open = c.match(/^<w:comment\b[^>]*>/)[0];
      out.push({ id: attrOf(open, 'id'), author: unesc(attrOf(open, 'author') || ''), date: attrOf(open, 'date') || '', text: (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(function (p) { return pText(p); }).join('\n').trim(), xml: c });
    });
    return out;
  }
  // 문서의 메모 목록 [{id, author, date, text, para}] (붙은 문단 순서)
  async function readComments(pkg) {
    var cx = await pkg.read(CM_PART); if (cx == null) return [];
    var x = await must(pkg, 'word/document.xml'), bodies = commentBodies(cx), at = {};
    paras(x).forEach(function (p, i) { (x.slice(p.s, p.e).match(/<w:commentReference\b[^>]*>/g) || []).forEach(function (t) { at[attrOf(t, 'id')] = i; }); });
    return bodies.map(function (b) { return { id: b.id, author: b.author, date: b.date, text: b.text, para: at[b.id] != null ? at[b.id] : -1 }; }).sort(function (a, b) { return (a.para < 0 ? 1e9 : a.para) - (b.para < 0 ? 1e9 : b.para); });
  }
  async function addComment(pkg, xi, text) {
    text = String(text || '').trim(); if (!text) return { err: '메모 내용을 적어 주십시오.' };
    var cx = await ensureCommentsPart(pkg), x = await must(pkg, 'word/document.xml'), p = P(x, xi), ps = x.slice(p.s, p.e);
    if (p.anc.some(function (n) { return n === 'w:txbxContent'; })) return { err: '텍스트 상자 안에는 메모를 달 수 없습니다.' };
    var mx = -1; (cx.match(/<w:comment\b[^>]*\sw:id="(\d+)"/g) || []).concat(x.match(/<w:comment(?:RangeStart|RangeEnd|Reference)\b[^>]*\sw:id="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); });
    var id = mx + 1, head = /^<w:p\b[^>]*?>/.exec(ps)[0], st = '<w:commentRangeStart w:id="' + id + '"/>', en = '<w:commentRangeEnd w:id="' + id + '"/><w:r><w:commentReference w:id="' + id + '"/></w:r>', np;
    if (/\/>$/.test(head)) np = head.replace(/\s*\/>$/, '>') + st + en + '</w:p>';
    else { var pp = pPrOf(ps); np = ps.slice(0, pp.e) + st + ps.slice(pp.e, ps.length - 6) + en + '</w:p>'; }
    pkg.write('word/document.xml', x.slice(0, p.s) + np + x.slice(p.e));
    var d = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var body = '<w:comment w:id="' + id + '" w:author="' + CM_AUTHOR + '" w:date="' + d + '" w:initials="메"><w:p><w:r><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">' + esc(text).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">') + '</w:t></w:r></w:p></w:comment>';
    pkg.write(CM_PART, cx.replace(/<\/w:comments>\s*$/, body + '</w:comments>')); return { ok: true, id: String(id) };
  }
  async function editComment(pkg, id, text) {
    text = String(text || '').trim(); if (!text) return { err: '메모 내용을 적어 주십시오.' };
    var cx = await pkg.read(CM_PART); if (cx == null) return { err: '메모를 찾지 못했습니다.' };
    var re = new RegExp('<w:comment\\b[^>]*\\sw:id="' + id + '"[^>]*>[\\s\\S]*?<\\/w:comment>'), m = re.exec(cx); if (!m) return { err: '메모를 찾지 못했습니다.' };
    if ((m[0].match(/<w:p\b/g) || []).length > 1 || /<w:(drawing|pict|fldChar|hyperlink)\b/.test(m[0])) return { err: '이 메모에는 여러 문단·그림·링크가 있어 폰에서는 고칠 수 없습니다. 지우고 새로 달아 주십시오.' };
    var open = m[0].match(/^<w:comment\b[^>]*>/)[0], pm = /<w:p\b[^>]*?>(?:<w:pPr\b[\s\S]*?<\/w:pPr>)?/.exec(m[0]), phead = pm ? pm[0] : '<w:p>';
    var ar = /<w:r\b[^>]*>(?:<w:rPr\b[\s\S]*?<\/w:rPr>)?<w:annotationRef\s*\/><\/w:r>/.exec(m[0]);
    var nb = open + phead + (ar ? ar[0] : '<w:r><w:annotationRef/></w:r>') + '<w:r><w:t xml:space="preserve">' + esc(text).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">') + '</w:t></w:r></w:p></w:comment>';
    pkg.write(CM_PART, cx.replace(m[0], function () { return nb; })); return { ok: true };
  }
  async function deleteComment(pkg, id) {
    var cx = await pkg.read(CM_PART), x = await must(pkg, 'word/document.xml');
    x = x.replace(new RegExp('<w:commentRangeStart\\b[^>]*\\sw:id="' + id + '"[^>]*\\/>'), '').replace(new RegExp('<w:commentRangeEnd\\b[^>]*\\sw:id="' + id + '"[^>]*\\/>'), '')
      .replace(new RegExp('<w:r\\b[^>]*>(?:<w:rPr\\b[\\s\\S]*?<\\/w:rPr>)?<w:commentReference\\b[^>]*\\sw:id="' + id + '"[^>]*\\/><\\/w:r>'), '');
    pkg.write('word/document.xml', x);
    if (cx != null) {
      var m = new RegExp('<w:comment\\b[^>]*\\sw:id="' + id + '"[^>]*>[\\s\\S]*?<\\/w:comment>').exec(cx);
      if (m) {
        var pid = (m[0].match(/w14:paraId="([0-9A-Fa-f]+)"/g) || []).map(function (s) { return /"([^"]+)"/.exec(s)[1]; });
        pkg.write(CM_PART, cx.replace(m[0], ''));
        for (var f of ['word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml']) {
          var ex = await pkg.read(f); if (ex == null) continue;
          pid.forEach(function (q) { ex = ex.replace(new RegExp('<w1[0-9]:(?:commentEx|commentId|commentExtensible)\\b[^>]*paraId="' + q + '"[^>]*\\/>', 'g'), ''); });
          pkg.write(f, ex);
        }
      }
    }
    return { ok: true };
  }

  // ---- 변경 내용(변경 추적) 수락·거절 ----
  var REV_RE = /<w:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|tblPrExChange|tcPrChange|trPrChange|numberingChange|tblGridChange)\b[^>]*?(\/?)>/g;
  function revText(kind, inner) {
    var t;
    if (kind === 'del' || kind === 'moveFrom') t = (inner.match(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g) || []).map(function (s) { return unesc(s.replace(/<[^>]+>/g, '')); }).join('');
    else t = pText(inner);
    return t.replace(/\s+/g, ' ').trim();
  }
  // 문서의 변경 목록 [{ord, kind:'ins'|'del'|'move'|'fmt'|'other', author, date, text, para, mark}] — 문서 순서
  function listChanges(xml) {
    var out = [], re = new RegExp(REV_RE.source, 'g'), m, ord = 0, ps = paras(xml), pi = 0;
    while ((m = re.exec(xml))) {
      var name = m[1], self = m[2] === '/', open = m[0], inner = '';
      if (!self) { var e = elemEnd(xml, m.index); if (e > 0) inner = xml.slice(m.index + open.length, e - ('</w:' + name + '>').length); }
      while (pi < ps.length - 1 && ps[pi].e <= m.index) pi++;
      var kind = name === 'ins' ? 'ins' : name === 'del' ? 'del' : /^move/.test(name) ? 'move' : /^(rPr|pPr)Change$/.test(name) ? 'fmt' : 'other';
      var tx = (kind === 'fmt' || kind === 'other') ? '' : revText(name, inner);
      out.push({ ord: ord++, kind: kind, name: name, author: unesc(attrOf(open, 'author') || ''), date: attrOf(open, 'date') || '', text: tx, para: ps.length && ps[pi].s <= m.index && m.index < ps[pi].e ? pi : -1, mark: self });
    }
    return out;
  }
  // 변경 처리: accept 면 수락, 아니면 거절. only 가 숫자(ord)면 그 하나만. 돌려주는 값 {xml, done, skipped}
  function resolveChanges(xml, accept, only) {
    var ord = 0, done = 0, skipped = 0, tg = (only == null) ? null : +only;
    var fixDel = function (s) { return s.replace(/<w:delText\b/g, '<w:t').replace(/<\/w:delText>/g, '</w:t>').replace(/<w:delInstrText\b/g, '<w:instrText').replace(/<\/w:delInstrText>/g, '</w:instrText>'); };
    function proc(str) {
      var re = new RegExp(REV_RE.source, 'g'), out = '', pos = 0, m;
      while ((m = re.exec(str))) {
        var name = m[1], self = m[2] === '/', open = m[0], my = ord++, hit = tg == null || tg === my;
        out += str.slice(pos, m.index);
        if (self) {
          pos = re.lastIndex;
          if (hit && ((name === 'ins' && accept) || (name === 'del' && !accept))) { out += ''; done++; }
          else if (hit) { out += open; skipped++; }
          else out += open;
          continue;
        }
        var e = elemEnd(str, m.index); if (e < 0) { out += str.slice(m.index); pos = str.length; break; }
        var close = '</w:' + name + '>', inner = str.slice(m.index + open.length, e - close.length), pin = proc(inner), rep;
        if (!hit) rep = open + pin + close;
        else if (name === 'ins' || name === 'moveTo') { rep = accept ? pin : ''; done++; }
        else if (name === 'del' || name === 'moveFrom') { rep = accept ? '' : fixDel(pin); done++; }
        else if (accept) { rep = ''; done++; }
        else { rep = open + pin + close; skipped++; }                      // 서식 변경 거절은 아래 「서식 되돌리기」에서 따로 한다
        out += rep; pos = e; re.lastIndex = e;
      }
      return out + str.slice(pos);
    }
    var nx = proc(xml);
    if (!/<w:move(?:From|To)\b/.test(nx)) nx = nx.replace(/<w:move(?:From|To)Range(?:Start|End)\b[^>]*\/>/g, '');
    return { xml: nx, done: done, skipped: skipped };
  }
  // 서식 변경 모두 거절: 바뀌기 전 서식(rPrChange·pPrChange 안에 저장됨)으로 되돌린다
  function revertFormatChanges(xml) {
    var n = 0;
    xml = xml.replace(/<w:rPr>((?:(?!<\/w:rPr>)[\s\S])*?)<w:rPrChange\b[^>]*>\s*(<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>)?\s*<\/w:rPrChange>\s*<\/w:rPr>/g, function (a, cur, old) { n++; return old && !/\/>$/.test(old) ? old : ''; });
    xml = xml.replace(/<w:pPr>((?:(?!<\/w:pPr>)[\s\S])*?)<w:pPrChange\b[^>]*>\s*<w:pPr\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:pPr>)\s*<\/w:pPrChange>\s*<\/w:pPr>/g, function (a, cur, old) {
      n++; var rp = (/<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(cur) || [''])[0], sp = (/<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(cur) || [''])[0], inner = (old || '') + rp + sp; return inner ? '<w:pPr>' + inner + '</w:pPr>' : '';
    });
    return { xml: xml, n: n };
  }
  async function readTrack(pkg) { var sx = await pkg.read('word/settings.xml'); return !!(sx && /<w:trackRevisions\b(?![^>]*w:val="(?:0|false|off)")/.test(sx)); }
  var SETTINGS_AFTER_TRACK = ['doNotTrackMoves', 'doNotTrackFormatting', 'documentProtection', 'autoFormatOverride', 'styleLockTheme', 'styleLockQFSet', 'defaultTabStop', 'autoHyphenation', 'consecutiveHyphenLimit', 'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength', 'clickAndTypeStyle', 'defaultTableStyle', 'evenAndOddHeaders', 'bookFoldRevPrinting', 'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing', 'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery', 'displayVerticalDrawingGridEvery', 'doNotUseMarginsForDrawingGridOrigin', 'drawingGridHorizontalOrigin', 'drawingGridVerticalOrigin', 'doNotShadeFormData', 'noPunctuationKerning', 'characterSpacingControl', 'printTwoOnOne', 'strictFirstAndLastChars', 'noLineBreaksAfter', 'noLineBreaksBefore', 'savePreviewPicture', 'doNotValidateAgainstSchema', 'saveInvalidXml', 'ignoreMixedContent', 'alwaysShowPlaceholderText', 'doNotDemarcateInvalidXml', 'saveXmlDataOnly', 'useXSLTWhenSaving', 'saveThroughXslt', 'showXMLTags', 'alwaysMergeEmptyNamespace', 'updateFields', 'hdrShapeDefaults', 'footnotePr', 'endnotePr', 'compat', 'docVars', 'rsids', 'mathPr', 'attachedSchema', 'themeFontLang', 'clrSchemeMapping', 'doNotIncludeSubdocsInStats', 'doNotAutoCompressPictures', 'forceUpgrade', 'captions', 'readModeInkLockDown', 'smartTagType', 'schemaLibrary', 'shapeDefaults', 'doNotEmbedSmartTags', 'decimalSymbol', 'listSeparator'];
  async function setTrack(pkg, on) {
    var sx = await pkg.read('word/settings.xml'); if (sx == null) return { err: '문서 설정 파일(settings.xml)이 없어 바꿀 수 없습니다.' };
    sx = sx.replace(/<w:trackRevisions\b[^>]*\/>/g, '');
    if (on) {
      var m = new RegExp('<w:(?:' + SETTINGS_AFTER_TRACK.join('|') + ')\\b').exec(sx);
      sx = m ? sx.slice(0, m.index) + '<w:trackRevisions/>' + sx.slice(m.index) : sx.replace(/<\/w:settings>\s*$/, '<w:trackRevisions/></w:settings>');
    }
    pkg.write('word/settings.xml', sx); return { ok: true, on: !!on };
  }

  // ---- 서식 따라 하기: 한 문단의 문단·글자 서식을 담아 다른 문단에 입힌다 ----
  function copyFormat(xml, xi) {
    var p = P(xml, xi), ps = xml.slice(p.s, p.e), pp = pPrOf(ps), inner = '';
    if (pp && pp.xml && !/\/>$/.test(pp.xml.slice(0, pp.xml.indexOf('>') + 1))) inner = pp.xml.slice(pp.xml.indexOf('>') + 1, pp.xml.lastIndexOf('</w:pPr>'));
    var kids = kidsOf(inner, 0, inner.length).filter(function (k) { return ['w:rPr', 'w:sectPr', 'w:pPrChange', 'w:numPr'].indexOf(k.name) < 0; }).map(function (k) { return { name: k.name.replace(/^w:/, ''), xml: inner.slice(k.s, k.e) }; });
    var rs = ps.match(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t\b[\s\S]*?<\/w:r>/g), rpr = '';
    if (rs) { var m = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(rs[0]); if (m) rpr = m[0].replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, ''); }
    return { kids: kids, rpr: rpr, text: pText(ps).slice(0, 14) };
  }
  function pasteFormat(xml, a, b, clip) {
    if (!clip) return { err: '먼저 따라 할 문단을 골라 「이 문단 서식 담기」를 눌러 주십시오.' };
    return { xml: mapParas(xml, a, b, function (p) {
      var out = withPPr(p, function (old) {
        var inner = '', keep = [];
        if (old && !/\/>$/.test(old.slice(0, old.indexOf('>') + 1))) inner = old.slice(old.indexOf('>') + 1, old.lastIndexOf('</w:pPr>'));
        kidsOf(inner, 0, inner.length).forEach(function (k) { var nm = k.name.replace(/^w:/, ''); if (['numPr', 'rPr', 'sectPr', 'pPrChange'].indexOf(nm) >= 0) keep.push({ name: nm, xml: inner.slice(k.s, k.e) }); });
        var all = clip.kids.concat(keep).sort(function (x, y) { return PPR_ORDER.indexOf(x.name) - PPR_ORDER.indexOf(y.name); });
        return all.length ? '<w:pPr>' + all.map(function (k) { return k.xml; }).join('') + '</w:pPr>' : '<w:pPr/>';
      }).replace(/<w:pPr\/>/g, '');
      return out.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, function (r) {
        if (!/<w:t\b/.test(r) || /<w:(?:footnoteReference|endnoteReference|drawing|pict|fldChar)\b/.test(r)) return r;
        var body = r.replace(/<w:rPr\b[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/, '');
        return body.replace(/^(<w:r\b[^>]*>)/, '$1' + clip.rpr);
      });
    }) };
  }

  // ---- 글을 신문처럼 칸 나누기(다단) ----
  var SECT_COLS_AFTER = ['pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType'];
  function sectWithCols(sp, n) {
    var cols = n > 1 ? '<w:cols w:num="' + n + '" w:space="720"/>' : '<w:cols w:space="720"/>';
    sp = sp.replace(/<w:cols\b[^>]*?(?:\/>|>[\s\S]*?<\/w:cols>)/, '');
    var at = -1; SECT_COLS_AFTER.forEach(function (nm) { var m = new RegExp('<w:' + nm + '\\b[^>]*?\\/>|<w:' + nm + '\\b[^>]*>[\\s\\S]*?<\\/w:' + nm + '>').exec(sp); if (m) at = Math.max(at, m.index + m[0].length); });
    if (at < 0) { var d = /<w:(?:formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings)\b/.exec(sp); at = d ? d.index : sp.lastIndexOf('</w:sectPr>'); }
    return sp.slice(0, at) + cols + sp.slice(at);
  }
  function readCols(xml) { var m = firstSect(xml); if (!m) return 1; var c = /<w:cols\b[^>]*>/.exec(m[0]); return c ? +(attrOf(c[0], 'num') || 1) : 1; }
  async function setColumnsWhole(pkg, n) {
    var x = await must(pkg, 'word/document.xml'), k = 0;
    x = x.replace(/<w:sectPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:sectPr>)/g, function (sp) { if (/\/>$/.test(sp)) return sp; k++; return sectWithCols(sp, n); });
    if (!k) return { err: '이 문서에서 쪽 설정을 찾지 못했습니다.' };
    pkg.write('word/document.xml', x); return { ok: true, sections: k };
  }
  function addSectToPara(pStr, sect) { return withPPr(pStr, function (ppr) { return setProp(ppr, 'w:pPr', PPR_ORDER, 'sectPr', sect) || '<w:pPr/>'; }).replace(/<w:pPr\/>/g, ''); }
  // 고른 문단 a..b 만 n 단으로: 앞뒤를 「이어서」 구역으로 나눈다. 구역이 하나뿐인 문서·표 밖 문단만
  function setColumnsRange(xml, a, b, n) {
    var ps = paras(xml), last = /<w:sectPr\b[^>]*?>[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/.exec(xml), i;
    if (!ps[a] || !ps[b]) return { err: '문단을 찾지 못했습니다.' };
    if (!last || (xml.match(/<w:sectPr\b/g) || []).length !== 1) return { err: '구역이 여러 개인 문서는 폰에서 일부만 칸을 나눌 수 없습니다. 「문서 전체」를 쓰거나 「수정 요청」으로 맡겨 주십시오.' };
    for (i = a; i <= b; i++) if (ps[i].anc.join('/') !== 'w:document/w:body') return { err: '표 안의 문단은 칸을 나눌 수 없습니다. 표 밖 문단을 고르십시오.' };
    var base = last[0], noTP = base.replace(/<w:titlePg\b[^>]*\/>/g, ''), oc = readColsOf(base);
    var cont = function (sp) { sp = sp.replace(/<w:type\b[^>]*\/>/, ''); var at = /<w:pgSz\b/.exec(sp); return at ? sp.slice(0, at.index) + '<w:type w:val="continuous"/>' + sp.slice(at.index) : sp; };
    var noRef = function (sp) { return sp.replace(/<w:(?:headerReference|footerReference|titlePg)\b[^>]*\/>/g, ''); };
    var atEnd = /^(?:\s|<w:bookmarkEnd\b[^>]*\/>)*$/.test(xml.slice(ps[b].e, last.index)), out = xml;
    if (atEnd) out = out.slice(0, last.index) + sectWithCols(a > 0 ? cont(noTP) : base, n) + out.slice(last.index + last[0].length);
    else {
      out = out.slice(0, last.index) + cont(noTP) + out.slice(last.index + last[0].length);
      var pb = ps[b], bs = sectWithCols(a > 0 ? cont(noRef(base)) : base, n);
      out = out.slice(0, pb.s) + addSectToPara(out.slice(pb.s, pb.e), bs) + out.slice(pb.e);
    }
    if (a > 0) {
      var pa = ps[a - 1], orig = sectWithCols(base, oc);
      if (pa.anc.join('/') === 'w:document/w:body') out = out.slice(0, pa.s) + addSectToPara(out.slice(pa.s, pa.e), orig) + out.slice(pa.e);
      else out = out.slice(0, ps[a].s) + '<w:p><w:pPr>' + orig + '</w:pPr></w:p>' + out.slice(ps[a].s);
    }
    return { xml: out };
  }
  function readColsOf(sp) { var c = /<w:cols\b[^>]*>/.exec(sp); return c ? +(attrOf(c[0], 'num') || 1) : 1; }

  // ---- 그림 배치(글자처럼 / 글 옆 / 가운데 / 글 뒤)와 크기 ----
  function pickDrawing(s) {
    var m = /<wp:(inline|anchor)\b[^>]*>[\s\S]*?<\/wp:\1>/.exec(s); if (!m) return null;
    var open = /^<wp:(?:inline|anchor)\b[^>]*>/.exec(m[0])[0], inner = m[0].slice(open.length, m[0].length - ('</wp:' + m[1] + '>').length);
    var ext = /<wp:extent\b[^>]*\/>/.exec(inner), eff = /<wp:effectExtent\b[^>]*\/>/.exec(inner), dp = /<wp:docPr\b[^>]*\/>|<wp:docPr\b[\s\S]*?<\/wp:docPr>/.exec(inner), cn = /<wp:cNvGraphicFramePr\b[^>]*\/>|<wp:cNvGraphicFramePr\b[\s\S]*?<\/wp:cNvGraphicFramePr>/.exec(inner), gr = /<a:graphic\b[\s\S]*<\/a:graphic>/.exec(inner);
    if (!ext || !dp || !gr) return null;
    return { kind: m[1], s: m.index, e: m.index + m[0].length, ns: (open.match(/\sxmlns:\w+="[^"]*"/g) || []).join(''), ext: ext[0], eff: eff ? eff[0] : '<wp:effectExtent l="0" t="0" r="0" b="0"/>', dp: dp[0], cn: cn ? cn[0] : '<wp:cNvGraphicFramePr/>', gr: gr[0] };
  }
  function readPicLayout(xml, xi) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e), d = pickDrawing(s); if (!d) return null;
    var cx = +(attrOf(d.ext, 'cx') || 0), tw = textWidth(xml) * 635, mode = 'inline';
    if (d.kind === 'anchor') { var a = /<wp:anchor\b[^>]*>/.exec(s)[0], al = /<wp:positionH\b[^>]*>\s*<wp:align>(\w+)<\/wp:align>/.exec(s); mode = attrOf(a, 'behindDoc') === '1' ? 'behind' : (/<wp:wrapTopAndBottom\b/.test(s) ? 'center' : (/<wp:wrapSquare\b|<wp:wrapTight\b|<wp:wrapThrough\b/.test(s) ? (al && al[1] === 'right' ? 'right' : 'left') : 'other')); }
    return { mode: mode, cx: cx, pct: tw ? Math.round(cx / tw * 100) : 0 };
  }
  function setPicLayout(xml, xi, mode) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e), d = pickDrawing(s); if (!d) return { err: '이 문단에는 그림이 없습니다. 그림이 든 문단을 먼저 고르십시오.' };
    var rep, dpid = +(/\sid="(\d+)"/.exec(d.dp) || [0, 1])[1];
    if (mode === 'inline') rep = '<wp:inline distT="0" distB="0" distL="0" distR="0"' + d.ns + '>' + d.ext + d.eff + d.dp + d.cn + d.gr + '</wp:inline>';
    else {
      var al = mode === 'right' ? 'right' : (mode === 'left' ? 'left' : 'center'), wrap = mode === 'center' ? '<wp:wrapTopAndBottom/>' : (mode === 'behind' ? '<wp:wrapNone/>' : '<wp:wrapSquare wrapText="bothSides"/>');
      rep = '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="' + (251658240 + dpid) + '" behindDoc="' + (mode === 'behind' ? '1' : '0') + '" locked="0" layoutInCell="1" allowOverlap="0"' + d.ns + '><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>' + al + '</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' + d.ext + d.eff + wrap + d.dp + d.cn + d.gr + '</wp:anchor>';
    }
    return { xml: xml.slice(0, p.s) + s.slice(0, d.s) + rep + s.slice(d.e) + xml.slice(p.e) };
  }
  // 그림을 본문 폭의 pct % 로
  function setPicWidth(xml, xi, pct) {
    var p = P(xml, xi), s = xml.slice(p.s, p.e), d = pickDrawing(s); if (!d) return { err: '이 문단에는 그림이 없습니다. 그림이 든 문단을 먼저 고르십시오.' };
    var cx = +attrOf(d.ext, 'cx'), target = Math.round(textWidth(xml) * 635 * pct / 100); if (!cx) return { err: '그림 크기를 읽지 못했습니다.' };
    return scalePicture(xml, xi, target / cx);
  }

  // ---- 기호 · 날짜 목록(화면의 「기호·날짜」 시트와 글 고치기 시트가 함께 쓴다) ----
  var SYMBOLS = [
    ['문서 기호', ['※', '○', '●', '◦', '▪', '▫', '■', '□', '◆', '◇', '★', '☆', '▶', '▷', '◀', '◁', '▲', '△', '▼', '▽']],
    ['번호', ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '㉠', '㉡', '㉢', '㉣', '㉤', 'Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ']],
    ['화살표·줄임', ['→', '←', '↑', '↓', '↔', '⇒', '⇐', '～', '·', '…', '‥', '—', '–', '∼']],
    ['괄호', ['「', '」', '『', '』', '〈', '〉', '《', '》', '【', '】', '〔', '〕', '（', '）']],
    ['단위·수학', ['℃', '㎡', '㎏', '㎖', '㎎', '㎝', '㎜', '㎞', '₩', '±', '×', '÷', '≤', '≥', '≠', '≒', '°', '‰', '∴', '∵']]
  ];
  function dateChoices(d) {
    d = d || new Date(); var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(), wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()], h = d.getHours(), mi = d.getMinutes(), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return [y + '. ' + m + '. ' + dd + '.', y + '년 ' + m + '월 ' + dd + '일', y + '-' + p2(m) + '-' + p2(dd), m + '월 ' + dd + '일(' + wk + ')', y + '년 ' + m + '월 ' + dd + '일(' + wk + ')', (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + p2(mi), p2(h) + ':' + p2(mi)];
  }


  // ============================== v10.9: 차트 넣기·고치기·지우기 (진짜 차트 + 딸린 통합문서) ==============================
  function chartRidIn(s) { var m = /<c:chart\b[^>]*?\sr:id="([^"]+)"/.exec(s); return m ? m[1] : null; }
  function wordPath(target) { if (/^[A-Za-z]+:/.test(target)) return null; var parts = (target.charAt(0) === '/' ? '' : 'word/').concat(target.replace(/^\//, '')).split('/'), out = []; parts.forEach(function (q) { if (q === '..') out.pop(); else if (q && q !== '.') out.push(q); }); return out.join('/'); }
  function relsOfPart(p) { return p.replace(/([^\/]+)$/, '_rels/$1.rels'); }
  function relList(x) { return (x || '').match(/<Relationship\b[^>]*?\/?>/g) || []; }
  function relAttr(t, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(t); return m ? m[1] : null; }
  function relFromChart(from, target) { var a = from.replace(/[^\/]+$/, '').split('/').filter(Boolean), b = target.split('/'), i = 0; while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++; var o = []; for (var k = a.length - i; k > 0; k--) o.push('..'); return o.concat(b.slice(i)).join('/'); }
  async function chartAt(pkg, xi) {
    var xml = await must(pkg, 'word/document.xml'), p = paras(xml)[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    var rid = chartRidIn(xml.slice(p.s, p.e)); if (!rid) return { err: '이 문단에는 차트가 없습니다.' };
    var rx = await must(pkg, 'word/_rels/document.xml.rels'), rl = relList(rx).filter(function (t) { return relAttr(t, 'Id') === rid; })[0];
    if (!rl) return { err: '차트 연결 정보를 찾지 못했습니다.' };
    var path = wordPath(relAttr(rl, 'Target') || ''); if (!path || (await pkg.read(path)) == null) return { err: '차트 파일을 찾지 못했습니다.' };
    var cr = relList(await pkg.read(relsOfPart(path))), em = cr.filter(function (t) { return /\/package$/.test(relAttr(t, 'Type') || '') && relAttr(t, 'TargetMode') !== 'External'; })[0];
    return { xml: xml, p: p, rid: rid, rel: rl, rx: rx, path: path, embed: em ? { rel: em, path: wordPath2(path, relAttr(em, 'Target') || '') } : null };
  }
  function wordPath2(base, target) { if (/^[A-Za-z]+:/.test(target)) return null; var parts = target.charAt(0) === '/' ? target.slice(1).split('/') : base.replace(/[^\/]+$/, '').split('/').filter(Boolean).concat(target.split('/')), out = []; parts.forEach(function (q) { if (q === '..') out.pop(); else if (q && q !== '.') out.push(q); }); return out.join('/'); }
  // 문서 속 차트가 든 문단 목록 → [{xi, rid, path}]  (미리 그리기용)
  async function listCharts(pkg) {
    var xml = await must(pkg, 'word/document.xml'), ps = paras(xml), out = [], rx = await pkg.read('word/_rels/document.xml.rels') || '', rls = relList(rx);
    for (var i = 0; i < ps.length; i++) {
      var s = xml.slice(ps[i].s, ps[i].e), rid = chartRidIn(s); if (!rid) continue;
      var rl = rls.filter(function (t) { return relAttr(t, 'Id') === rid; })[0], path = rl ? wordPath(relAttr(rl, 'Target') || '') : null; if (!path) continue;
      out.push({ xi: i, rid: rid, path: path });
    }
    return out;
  }
  async function readChart(pkg, xi) {
    var c = await chartAt(pkg, xi); if (c.err) return c;
    var info = global.SOChart.parse(await pkg.read(c.path));
    return { info: info, path: c.path, mine: info.mine };
  }
  async function writeChartParts(pkg, cpath, sp, epath) {
    var C = global.SOChart, ct = await must(pkg, '[Content_Types].xml');
    pkg.write(cpath, C.chartXml(sp, { embed: 'rId1' }));
    pkg.write(relsOfPart(cpath), '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + RT + 'package" Target="' + relFromChart(cpath, epath) + '"/></Relationships>');
    if (ct.indexOf('PartName="/' + cpath + '"') < 0) ct = ct.replace('</Types>', '<Override PartName="/' + cpath + '" ContentType="' + C.CT_CHART + '"/></Types>');
    if (!/<Default\b[^>]*Extension="xlsx"/i.test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="xlsx" ContentType="' + C.CT_XLSX + '"/>');
    pkg.write('[Content_Types].xml', ct);
  }
  function nextIn(pkg, dir, base, ext) { var mx = 0, re = new RegExp('^' + dir.replace(/[.\/]/g, '\\$&') + base + '(\\d+)\\.' + ext + '$'); pkg.list().forEach(function (q) { var m = re.exec(q); if (m) mx = Math.max(mx, +m[1]); }); return mx + 1; }
  async function addChart(pkg, xi, spec) {
    var C = global.SOChart, sp = C.defaultRefs(C.clone(spec)); sp.frame = false;
    var xml = await must(pkg, 'word/document.xml'), ps = paras(xml), p = ps[xi]; if (!p) throw new Error('문단을 찾지 못했습니다');
    var cn = nextIn(pkg, 'word/charts/', 'chart', 'xml'), cpath = 'word/charts/chart' + cn + '.xml', en = nextIn(pkg, 'word/embeddings/', 'Microsoft_Excel_Sheet', 'xlsx'), epath = 'word/embeddings/Microsoft_Excel_Sheet' + en + '.xlsx';
    pkg.writeBin(epath, await C.workbookBytes(sp, global.JSZip)); await writeChartParts(pkg, cpath, sp, epath);
    var rp = 'word/_rels/document.xml.rels', rx = await must(pkg, rp), rid = nextRid(rx);
    pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + RT + 'chart" Target="charts/chart' + cn + '.xml"/></Relationships>'));
    var tw = textWidth(xml) * 635, cx = Math.round(Math.min(tw * 0.92, 5760000)), cy = Math.round(cx * 0.6);
    var ids = (xml.match(/<wp:docPr\b[^>]*\sid="(\d+)"/g) || []).map(function (s) { return +/id="(\d+)"/.exec(s)[1]; }), did = Math.max.apply(null, ids.concat([0])) + 1;
    var dr = '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="' + did + '" name="차트 ' + did + '"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="' + rid + '"/></a:graphicData></a:graphic></wp:inline></w:drawing>';
    pkg.write('word/document.xml', xml.slice(0, p.e) + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>' + dr + '</w:r></w:p>' + xml.slice(p.e));
    return { ok: true, xi: xi + 1 };
  }
  async function updateChart(pkg, xi, spec) {
    var C = global.SOChart, c = await chartAt(pkg, xi); if (c.err) return c;
    var old = C.parse(await pkg.read(c.path)); if (!old.ok) return { err: old.why };
    var sp = C.defaultRefs(C.clone(spec)), epath = c.embed ? c.embed.path : null; sp.frame = false;
    if (!epath) epath = 'word/embeddings/Microsoft_Excel_Sheet' + nextIn(pkg, 'word/embeddings/', 'Microsoft_Excel_Sheet', 'xlsx') + '.xlsx';
    pkg.writeBin(epath, await C.workbookBytes(sp, global.JSZip)); await writeChartParts(pkg, c.path, sp, epath);
    return { ok: true };
  }
  async function removeChart(pkg, xi) {
    var c = await chartAt(pkg, xi); if (c.err) return c;
    var s = c.xml.slice(c.p.s, c.p.e), ns = s.replace(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>(?:(?!<\/w:drawing>)[\s\S])*?<c:chart\b[\s\S]*?<\/w:drawing>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/, '');
    if (ns === s) return { err: '차트를 지우지 못했습니다.' };
    var nx = c.xml.slice(0, c.p.s) + ns + c.xml.slice(c.p.e); pkg.write('word/document.xml', nx);
    if (!new RegExp('<c:chart\\b[^>]*?\\sr:id="' + c.rid + '"').test(nx)) {
      pkg.write('word/_rels/document.xml.rels', c.rx.replace(c.rel, ''));
      var ct = await must(pkg, '[Content_Types].xml'); ct = ct.replace(new RegExp('<Override\\b[^>]*PartName="/' + c.path.replace(/[.\/]/g, '\\$&') + '"[^>]*/>'), ''); pkg.write('[Content_Types].xml', ct);
      pkg.remove(c.path); pkg.remove(relsOfPart(c.path)); if (c.embed && c.embed.path) pkg.remove(c.embed.path);
    }
    return { ok: true };
  }

  // ============================== v10.9 2회차(O-0861): 상호 참조 · 문서 통계 · 읽기 전용·편집 제한 ==============================
  // ---- 상호 참조: 제목·그림/표 이름·책갈피를 가리키는 REF 필드를 고른 문단 끝에 넣는다 ----
  function refTargets(xml, sx) {
    var out = [], ps = paras(xml);
    headingList(xml, sx, 9).forEach(function (h) { out.push({ xi: h.xi, kind: 'heading', label: '제목 · ' + (h.text.length > 26 ? h.text.slice(0, 26) + '…' : h.text) }); });
    ps.forEach(function (p, i) {
      if (p.anc.indexOf('w:txbxContent') >= 0) return;
      var s = xml.slice(p.s, p.e); if (!/SEQ\s+[A-Za-z가-힣]/.test(s)) return;
      var t = pText(s.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')).replace(/\s+/g, ' ').trim(); if (t) out.push({ xi: i, kind: 'caption', label: '이름 · ' + (t.length > 26 ? t.slice(0, 26) + '…' : t) });
    });
    listBookmarks(xml).forEach(function (b) { out.push({ xi: b.para, kind: 'bookmark', bm: b.name, label: '책갈피 · ' + b.name }); });
    return out;
  }
  // tgt: { xi, kind, bm? }  mode: 'all'(글 전체) | 'num'(이름표와 번호만 — 그림·표 이름에서만)
  function addCrossRef(xml, fromXi, tgt, mode, pageNo) {      // mode 'page' = 쪽 번호 참조(PAGEREF)
    var ps = paras(xml); if (!ps[fromXi] || !ps[tgt.xi]) return { err: '문단을 찾지 못했습니다.' };
    if (ps[fromXi].anc.indexOf('w:txbxContent') >= 0) return { err: '텍스트 상자 안에는 넣을 수 없습니다.' };
    var name = tgt.bm, shown;
    if (!name) {
      var used = {}; (xml.match(/<w:bookmarkStart\b[^>]*>/g) || []).forEach(function (t) { used[attrOf(t, 'name')] = 1; });
      var k = 100000000 + Math.floor(Math.random() * 899999999); name = '_Ref' + k; while (used[name]) { k++; name = '_Ref' + k; }
      var tp = ps[tgt.xi], tps = xml.slice(tp.s, tp.e), mx = 0; (xml.match(/<w:bookmarkStart\b[^>]*\sw:id="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); });
      var id = mx + 1, st = '<w:bookmarkStart w:id="' + id + '" w:name="' + name + '"/>', en = '<w:bookmarkEnd w:id="' + id + '"/>', head = /^<w:p\b[^>]*?>/.exec(tps)[0], np;
      if (/\/>$/.test(head)) return { err: '빈 문단은 가리킬 수 없습니다.' };
      var pp = pPrOf(tps), bodyStart = pp ? pp.e : head.length, bodyEnd = tps.length - 6, endAt = bodyEnd;
      if (mode === 'num') {
        var seqAt = tps.search(/SEQ\s+[A-Za-z가-힣]/), cut = -1;
        if (seqAt >= 0) {
          var fs = tps.lastIndexOf('<w:fldSimple', seqAt);
          if (fs >= 0 && tps.slice(fs, seqAt).indexOf('</w:fldSimple>') < 0 && tps.indexOf('</w:fldSimple>', seqAt) >= 0) { cut = tps.indexOf('</w:fldSimple>', seqAt) + '</w:fldSimple>'.length; }
          else { var fe = /<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>\s*<\/w:r>/g; fe.lastIndex = seqAt; var mm = fe.exec(tps); if (mm) cut = mm.index + mm[0].length; }
        }
        if (cut < 0) return { err: '이 문단에서 이름표와 번호를 찾지 못했습니다. 「글 전체」로 넣어 주십시오.' };
        endAt = cut;
      }
      np = tps.slice(0, bodyStart) + st + tps.slice(bodyStart, endAt) + en + tps.slice(endAt);
      shown = pText(tps.slice(bodyStart, endAt).replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')).replace(/\s+/g, ' ').trim();
      xml = xml.slice(0, tp.s) + np + xml.slice(tp.e); ps = paras(xml);
    } else {
      var bp = ps[tgt.xi]; shown = pText(xml.slice(bp.s, bp.e).replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')).replace(/\s+/g, ' ').trim();
    }
    if (!shown) return { err: '가리킬 글이 비어 있습니다.' };
    var isPage = mode === 'page'; if (isPage) shown = String(pageNo || 1);
    var fp = ps[fromXi], fps = xml.slice(fp.s, fp.e), fhead = /^<w:p\b[^>]*?>/.exec(fps)[0];
    var fld = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + (isPage ? 'PAGEREF' : 'REF') + ' ' + name + ' \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t xml:space="preserve">' + esc(shown.length > 200 ? shown.slice(0, 200) : shown) + '</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    if (/\/>$/.test(fhead)) return { xml: xml.slice(0, fp.s) + fhead.replace(/\s*\/>$/, '>') + fld + '</w:p>' + xml.slice(fp.e), shown: shown };
    return { xml: xml.slice(0, fp.e - 6) + fld + xml.slice(fp.e - 6), shown: shown };
  }

  // ---- 문서 통계(본문·표 안의 글. 지운 것으로 표시된 글은 뺀다) ----
  function docStats(xml) {
    var ps = paras(xml), chars = 0, noSp = 0, words = 0, np = 0;
    ps.forEach(function (p) {
      var t = pText(xml.slice(p.s, p.e).replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')); if (!t.trim()) return;
      np++; chars += t.length; noSp += t.replace(/\s+/g, '').length; words += t.trim().split(/\s+/).length;
    });
    return { chars: chars, noSpace: noSp, words: words, paras: np, tables: (xml.match(/<w:tbl>|<w:tbl\s/g) || []).length, pics: (xml.match(/<w:drawing>/g) || []).length };
  }

  // ---- 읽기 전용 권장 · 편집 제한(암호 없이) ----
  async function readProt(pkg) {
    var sx = await pkg.read('word/settings.xml') || '', dp = /<w:documentProtection\b[^>]*\/>/.exec(sx);
    return { recommend: /<w:writeProtection\b[^>]*w:recommended="(?:1|true)"/.test(sx), edit: !!(dp && /w:enforcement="(?:1|true)"/.test(dp[0])), pw: !!(dp && /w:(?:hash|cryptProviderType|algorithmName|salt)/.test(dp[0])), has: !!sx };
  }
  async function setProt(pkg, kind, on) {
    var sx = await pkg.read('word/settings.xml'); if (sx == null) return { err: '문서 설정 파일(settings.xml)이 없어 바꿀 수 없습니다.' };
    if (kind === 'recommend') {
      sx = sx.replace(/<w:writeProtection\b[^>]*\/>/g, '');
      if (on) { var o = /<w:settings\b[^>]*>/.exec(sx); if (!o) return { err: '문서 설정 구조가 특이해서 바꿀 수 없습니다.' }; sx = sx.slice(0, o.index + o[0].length) + '<w:writeProtection w:recommended="1"/>' + sx.slice(o.index + o[0].length); }
    } else {
      var cur = /<w:documentProtection\b[^>]*\/>/.exec(sx);
      if (!on && cur && /w:(?:hash|cryptProviderType|algorithmName|salt)/.test(cur[0])) return { err: '암호가 걸린 편집 제한입니다. 암호를 모르면 풀 수 없고, 암호를 입력하는 일은 이 앱에서 하지 않습니다. 워드에서 풀어 주십시오.' };
      if (on && cur && /w:enforcement="(?:1|true)"/.test(cur[0])) return { err: '이미 편집이 제한된 문서입니다.' };
      sx = sx.replace(/<w:documentProtection\b[^>]*\/>/g, '');
      if (on) {
        var m = new RegExp('<w:(?:' + SETTINGS_AFTER_TRACK.slice(3).join('|') + ')\\b').exec(sx), tag = '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>';
        sx = m ? sx.slice(0, m.index) + tag + sx.slice(m.index) : sx.replace(/<\/w:settings>\s*$/, tag + '</w:settings>');
      }
    }
    pkg.write('word/settings.xml', sx); return { ok: true };
  }


  global.SODocxStruct = {
    SYMBOLS: SYMBOLS, dateChoices: dateChoices,
    tableGeomInfo: tableGeomInfo, setColWidth: setColWidth, setRowHeight: setRowHeight, setTableAlign: setTableAlign, tableLook: tableLook, appendText: appendText,
    readTitlePg: readTitlePg, setTitlePg: setTitlePg, readWatermark: readWatermark, setWatermark: setWatermark, listBookmarks: listBookmarks, addBookmark: addBookmark, deleteBookmark: deleteBookmark, addAnchorLink: addAnchorLink,
    refTargets: refTargets, addCrossRef: addCrossRef, docStats: docStats, readProt: readProt, setProt: setProt,
    addCaption: addCaption, insertToc: insertToc, updateToc: updateToc, tocField: tocField, headingList: headingList,
    readComments: readComments, addComment: addComment, editComment: editComment, deleteComment: deleteComment, listChanges: listChanges, resolveChanges: resolveChanges, revertFormatChanges: revertFormatChanges, readTrack: readTrack, setTrack: setTrack,
    copyFormat: copyFormat, pasteFormat: pasteFormat, readCols: readCols, setColumnsWhole: setColumnsWhole, setColumnsRange: setColumnsRange, readPicLayout: readPicLayout, setPicLayout: setPicLayout, setPicWidth: setPicWidth,
    H: { esc: esc, unesc: unesc, attrOf: attrOf, nextRid: nextRid, pPrOf: pPrOf, tagRe: tagRe, ranges: ranges, kidsOf: kidsOf, must: must, setProp: setProp, PPR_ORDER: PPR_ORDER, RPR_ORDER: RPR_ORDER, elemEnd: elemEnd, RT: RT, pText: pText, paras: paras },
    pageSetup: pageSetup, readPage: readPage, pageColor: pageColor, sectionBreakAfter: sectionBreakAfter, addLink: addLink, insertNote: insertNote, readNotes: readNotes, editNote: editNote, deleteNote: deleteNote,
    fmtPartial: fmtPartial, copyParas: copyParas, pasteBlock: pasteBlock, dupParas: dupParas, copyTable: copyTable, dupTable: dupTable, setCellShade: setCellShade, setTableBorders: setTableBorders, headerRow: headerRow,
    paras: paras, newPara: newPara, insertPara: insertPara, deleteParas: deleteParas, moveParas: moveParas, pageBreakAfter: pageBreakAfter, ensureStyle: ensureStyle, setStyle: setStyle,
    setParaFmt: setParaFmt, setRunFmt: setRunFmt, readFmt: readFmt, ensureList: ensureList, setList: setList, numIdOf: numIdOf, insertTable: insertTable, tableEdit: tableEdit, tableInfo: tableInfo,
    addChart: addChart, updateChart: updateChart, removeChart: removeChart, readChart: readChart, listCharts: listCharts,
    addPicture: addPicture, scalePicture: scalePicture, removePicture: removePicture, readHF: readHF, setHF: setHF, addPageNumber: addPageNumber, findHits: findHits, newDocxFiles: newDocxFiles, pText: pText, textWidth: textWidth
  };
})(typeof window !== 'undefined' ? window : globalThis);

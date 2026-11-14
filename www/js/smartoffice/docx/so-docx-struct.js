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
  function pText(pxml) { var o = ''; (pxml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>/g) || []).forEach(function (t) { o += /^<w:t/.test(t) ? unesc(t.replace(/<[^>]+>/g, '')) : (/^<w:tab/.test(t) ? '\t' : '\n'); }); return o; }

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
        if (f.indent != null) {
          var im = /<w:ind\b[^>]*\/>/.exec(x), cur = im ? +(attrOf(im[0], 'left') || attrOf(im[0], 'start') || 0) : 0, nv = f.indent === 0 ? 0 : Math.max(0, cur + f.indent * 440);
          var t2 = im ? im[0].replace(/\sw:(left|start)="[^"]*"/, '') : '<w:ind/>'; t2 = nv ? t2.replace(/\s*\/>$/, ' w:left="' + nv + '"/>') : t2;
          x = setProp(x, 'w:pPr', PPR_ORDER, 'ind', nv || (im && /w:(hanging|firstLine|right)=/.test(im[0])) ? t2 : null);
        }
        return x || '<w:pPr/>';
      });
    }).replace(/<w:pPr\/>/g, '');
  }
  function fmtRunTags(pStr, f) {                    // 문단 안 모든 런(<w:r>)의 글자 속성 고치기
    return pStr.replace(/<w:r(\s[^>]*)?>(<w:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:rPr>))?/g, function (all, at, rpr) {
      var x = rpr || '';
      if (f.bold != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'b', f.bold ? '<w:b/>' : '<w:b w:val="0"/>');
      if (f.bold != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'bCs', f.bold ? '<w:bCs/>' : '<w:bCs w:val="0"/>');
      if (f.italic != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'i', f.italic ? '<w:i/>' : '<w:i w:val="0"/>');
      if (f.underline != null) x = setProp(x, 'w:rPr', RPR_ORDER, 'u', f.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>');
      if (f.size != null) { var h = Math.round(Math.max(4, Math.min(200, f.size)) * 2); x = setProp(x, 'w:rPr', RPR_ORDER, 'sz', '<w:sz w:val="' + h + '"/>'); x = setProp(x, 'w:rPr', RPR_ORDER, 'szCs', '<w:szCs w:val="' + h + '"/>'); }
      if (f.color !== undefined) x = setProp(x, 'w:rPr', RPR_ORDER, 'color', f.color ? '<w:color w:val="' + f.color + '"/>' : null);
      if (f.highlight !== undefined) x = setProp(x, 'w:rPr', RPR_ORDER, 'highlight', f.highlight ? '<w:highlight w:val="' + f.highlight + '"/>' : null);
      if (f.font) x = setProp(x, 'w:rPr', RPR_ORDER, 'rFonts', '<w:rFonts w:ascii="' + esc(f.font) + '" w:hAnsi="' + esc(f.font) + '" w:eastAsia="' + esc(f.font) + '" w:cs="' + esc(f.font) + '"/>');
      return '<w:r' + (at || '') + '>' + x;
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
    if (/<wp:anchor\b/.test(s)) return { err: '글 위에 떠 있는 그림(글 뒤·앞 배치)은 폰에서 크기를 바꿀 수 없습니다. 「수정 요청」으로 맡겨 주십시오.' };
    if (!/<wp:inline\b/.test(s)) return { err: '이 문단에는 글자처럼 놓인 그림이 없습니다.' };
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

  global.SODocxStruct = {
    paras: paras, newPara: newPara, insertPara: insertPara, deleteParas: deleteParas, moveParas: moveParas, pageBreakAfter: pageBreakAfter, ensureStyle: ensureStyle, setStyle: setStyle,
    setParaFmt: setParaFmt, setRunFmt: setRunFmt, readFmt: readFmt, ensureList: ensureList, setList: setList, numIdOf: numIdOf, insertTable: insertTable, tableEdit: tableEdit, tableInfo: tableInfo,
    addPicture: addPicture, scalePicture: scalePicture, removePicture: removePicture, readHF: readHF, setHF: setHF, addPageNumber: addPageNumber, findHits: findHits, newDocxFiles: newDocxFiles, pText: pText, textWidth: textWidth
  };
})(typeof window !== 'undefined' ? window : globalThis);

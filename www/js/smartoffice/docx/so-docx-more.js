/* so-docx-more.js — S-Office 워드 편집 보강 4회차(O-0861, v10.9): 스타일 만들기·고치기 · 도형 그리기 · 입력 칸(콘텐츠 컨트롤) · 인용·참고문헌 · 색인
 * 모두 진짜 워드 요소로 만든다(스타일 정의·DrawingML 도형·구조화 문서 태그·서지 원본+CITATION 필드·XE/INDEX 필드). 외부 부품 없음. 브라우저와 Node 양쪽에서 돈다(시험용).
 * SODocxStruct(so-docx-struct.js)가 먼저 불러와져 있어야 한다. pkg = { read(path)→Promise<string|null>, write(path,str), list() }
 */
(function (global) {
  'use strict';
  function ST() { return global.SODocxStruct; }
  function H() { return ST().H; }
  function esc(s) { return H().esc(s); }
  function unesc(s) { return H().unesc(s); }
  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', NS_WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape', NS_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  var NS_B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
  function guid() { var h = '0123456789ABCDEF', s = ''; for (var i = 0; i < 32; i++) s += h.charAt(Math.floor(Math.random() * 16)); return '{' + s.slice(0, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16) + '-' + s.slice(16, 20) + '-' + s.slice(20) + '}'; }
  function appendToPara(xml, xi, inner) {                 // xi 번 문단 끝에 이어 붙인다
    var ps = ST().paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    if (p.anc.indexOf('w:txbxContent') >= 0) return { err: '텍스트 상자 안에는 넣을 수 없습니다.' };
    var s = xml.slice(p.s, p.e), head = /^<w:p\b[^>]*?>/.exec(s)[0], np = /\/>$/.test(head) ? head.replace(/\s*\/>$/, '>') + inner + '</w:p>' : s.slice(0, s.length - 6) + inner + '</w:p>';
    return { xml: xml.slice(0, p.s) + np + xml.slice(p.e) };
  }
  function prependToPara(xml, xi, inner) {                // 문단 맨 앞(문단 속성 다음)에 붙인다
    var ps = ST().paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    var s = xml.slice(p.s, p.e), head = /^<w:p\b[^>]*?>/.exec(s)[0], np;
    if (/\/>$/.test(head)) np = head.replace(/\s*\/>$/, '>') + inner + '</w:p>';
    else { var pp = H().pPrOf(s); np = s.slice(0, pp.e) + inner + s.slice(pp.e); }
    return { xml: xml.slice(0, p.s) + np + xml.slice(p.e) };
  }

  // ============================================================ 스타일
  var ALIGNS = { left: 'left', center: 'center', right: 'right', both: 'both' };
  function styleBlocks(sx) { var out = [], re = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g, m; while ((m = re.exec(sx))) out.push({ s: m.index, e: m.index + m[0].length, x: m[0] }); return out; }
  function styleFmt(x) {
    var f = {}, rp = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(x), pp = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(x), r = rp ? rp[0] : '', p = pp ? pp[0] : '', m;
    if ((m = /<w:rFonts\b[^>]*>/.exec(r))) f.font = H().attrOf(m[0], 'eastAsia') || H().attrOf(m[0], 'ascii') || null;
    if ((m = /<w:sz\s+w:val="(\d+)"/.exec(r))) f.size = +m[1] / 2;
    if (/<w:b(?:\s*\/>|\s+w:val="(?:1|true|on)"\s*\/>)/.test(r)) f.bold = true;
    if (/<w:i(?:\s*\/>|\s+w:val="(?:1|true|on)"\s*\/>)/.test(r)) f.italic = true;
    if ((m = /<w:color\s+w:val="([0-9A-Fa-f]{6})"/.exec(r))) f.color = m[1].toUpperCase();
    if ((m = /<w:jc\s+w:val="(\w+)"/.exec(p))) f.align = m[1] === 'start' ? 'left' : (m[1] === 'end' ? 'right' : m[1]);
    if ((m = /<w:spacing\b[^>]*>/.exec(p))) { var sb = H().attrOf(m[0], 'before'), sa = H().attrOf(m[0], 'after'), ln = H().attrOf(m[0], 'line'), lr = H().attrOf(m[0], 'lineRule'); if (sb != null) f.spBefore = Math.round(+sb / 20 * 10) / 10; if (sa != null) f.spAfter = Math.round(+sa / 20 * 10) / 10; if (ln != null && (!lr || lr === 'auto')) f.line = Math.round(+ln / 240 * 100) / 100; }
    return f;
  }
  // 문서의 스타일 목록(문단·글자). 갤러리에 나오는(qFormat) 것·직접 만든 것·문서에서 쓰는 것만
  async function listStyles(pkg) {
    var sx = await pkg.read('word/styles.xml'), dx = await pkg.read('word/document.xml') || ''; if (sx == null) return [];
    var used = {}; (dx.match(/<w:(?:pStyle|rStyle)\s+w:val="[^"]*"/g) || []).forEach(function (t) { used[/"([^"]*)"/.exec(t)[1]] = 1; });
    var out = [];
    styleBlocks(sx).forEach(function (b) {
      var head = /^<w:style\b[^>]*>/.exec(b.x)[0], type = H().attrOf(head, 'type'); if (type !== 'paragraph' && type !== 'character') return;
      var id = H().attrOf(head, 'styleId'), nm = (/<w:name\s+w:val="([^"]*)"/.exec(b.x) || [])[1]; if (!id || !nm) return;
      var custom = H().attrOf(head, 'customStyle') === '1', def = H().attrOf(head, 'default') === '1', q = /<w:qFormat\b/.test(b.x), hid = /<w:(?:semiHidden|hidden)\b(?![^>]*w:val="(?:0|false)")/.test(b.x);
      if (hid && !used[id]) return; if (!(q || custom || used[id] || def)) return;
      out.push({ id: id, name: unesc(nm), type: type, custom: custom, def: def, used: !!used[id], based: ((/<w:basedOn\s+w:val="([^"]*)"/.exec(b.x)) || [])[1] || null, fmt: styleFmt(b.x) });
    });
    return out;
  }
  function newStyleId(sx, base) {
    var id = base || 'SOStyle', n = 1; while (new RegExp('w:styleId="' + id + (n > 1 ? n : '') + '"').test(sx)) n++; return id + (n > 1 ? n : '');
  }
  function rprChildren(f) {
    var ch = {};
    if (f.font) ch.rFonts = '<w:rFonts w:ascii="' + esc(f.font) + '" w:eastAsia="' + esc(f.font) + '" w:hAnsi="' + esc(f.font) + '" w:cs="' + esc(f.font) + '"/>';
    if ('bold' in f) { ch.b = f.bold ? '<w:b/>' : null; ch.bCs = f.bold ? '<w:bCs/>' : null; }
    if ('italic' in f) { ch.i = f.italic ? '<w:i/>' : null; ch.iCs = f.italic ? '<w:iCs/>' : null; }
    if (f.color != null) ch.color = f.color ? '<w:color w:val="' + f.color + '"/>' : null;
    if (f.size) { ch.sz = '<w:sz w:val="' + Math.round(f.size * 2) + '"/>'; ch.szCs = '<w:szCs w:val="' + Math.round(f.size * 2) + '"/>'; }
    return ch;
  }
  // 스타일 정의 블록 하나에 값을 입힌다(없던 속성은 넣고, 있던 속성은 바꾼다)
  function applyFmt(block, f) {
    var head = /^<w:style\b[^>]*>/.exec(block)[0], tail = '</w:style>', inner = block.slice(head.length, block.length - tail.length);
    var rp = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(inner), pp = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(inner), r = rp ? rp[0] : '', p = pp ? pp[0] : '', ch = rprChildren(f), k;
    for (k in ch) r = H().setProp(r || '<w:rPr></w:rPr>', 'w:rPr', H().RPR_ORDER, k, ch[k]);
    var pc = {};
    if (f.align) pc.jc = '<w:jc w:val="' + (ALIGNS[f.align] || 'left') + '"/>';
    if (f.spBefore != null || f.spAfter != null || f.line != null) {
      var cur = (/<w:spacing\b[^>]*\/>/.exec(p) || [''])[0], at = {};
      (cur.match(/w:\w+="[^"]*"/g) || []).forEach(function (a) { var q = a.indexOf('='); at[a.slice(0, q)] = a.slice(q + 2, -1); });
      if (f.spBefore != null) at['w:before'] = String(Math.round(f.spBefore * 20)); if (f.spAfter != null) at['w:after'] = String(Math.round(f.spAfter * 20));
      if (f.line != null) { at['w:line'] = String(Math.round(f.line * 240)); at['w:lineRule'] = 'auto'; }
      pc.spacing = '<w:spacing' + Object.keys(at).map(function (a) { return ' ' + a + '="' + at[a] + '"'; }).join('') + '/>';
    }
    for (k in pc) p = H().setProp(p || '<w:pPr></w:pPr>', 'w:pPr', H().PPR_ORDER, k, pc[k]);
    var rest = inner.replace(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:pPr>[\s\S]*?<\/w:pPr>/g, '');
    // 스타일 안 순서: name … qFormat … pPr → rPr → (tblPr 등)
    var tblAt = rest.search(/<w:(tblPr|trPr|tcPr|tblStylePr)\b/), a = tblAt < 0 ? rest : rest.slice(0, tblAt), z = tblAt < 0 ? '' : rest.slice(tblAt);
    return head + a + p + r + z + tail;
  }
  // spec: { id?(고치기), name, type:'paragraph'|'character', font, size, bold, italic, color, align, spBefore, spAfter, line, basedOn? }
  async function saveStyle(pkg, spec) {
    var sx = await pkg.read('word/styles.xml'); if (sx == null) return { err: '문서에 스타일 파일(styles.xml)이 없어 폰에서는 만들 수 없습니다.' };
    var name = String(spec.name || '').trim();
    var f = { font: spec.font || null, size: spec.size || null, align: spec.align || null, spBefore: spec.spBefore, spAfter: spec.spAfter, line: spec.line };
    if (spec.bold !== undefined) f.bold = !!spec.bold; if (spec.italic !== undefined) f.italic = !!spec.italic; if (spec.color !== undefined) f.color = spec.color;
    if (spec.id) {                                                    // 고치기
      var bs = styleBlocks(sx).filter(function (b) { return H().attrOf(/^<w:style\b[^>]*>/.exec(b.x)[0], 'styleId') === spec.id; })[0];
      if (!bs) return { err: '고칠 스타일을 찾지 못했습니다.' };
      var nb = applyFmt(bs.x, f);
      if (name && H().attrOf(/^<w:style\b[^>]*>/.exec(bs.x)[0], 'customStyle') === '1') nb = nb.replace(/<w:name\s+w:val="[^"]*"/, '<w:name w:val="' + esc(name) + '"');
      pkg.write('word/styles.xml', sx.slice(0, bs.s) + nb + sx.slice(bs.e)); return { id: spec.id, edited: true };
    }
    if (!name) return { err: '스타일 이름을 적어 주십시오.' };
    if (/[<>&"]/.test(name) || name.length > 60) return { err: '스타일 이름에 쓸 수 없는 글자(< > & ")가 있거나 너무 깁니다.' };
    var exist = styleBlocks(sx).some(function (b) { return unesc((/<w:name\s+w:val="([^"]*)"/.exec(b.x) || [])[1] || '').toLowerCase() === name.toLowerCase(); });
    if (exist) return { err: '같은 이름의 스타일이 이미 있습니다. 다른 이름을 쓰거나 목록에서 그 스타일을 골라 고쳐 주십시오.' };
    var type = spec.type === 'character' ? 'character' : 'paragraph', id = newStyleId(sx, 'SOStyle');
    var defP = styleBlocks(sx).filter(function (b) { var h = /^<w:style\b[^>]*>/.exec(b.x)[0]; return H().attrOf(h, 'type') === 'paragraph' && H().attrOf(h, 'default') === '1'; })[0];
    var baseId = spec.basedOn || (defP ? H().attrOf(/^<w:style\b[^>]*>/.exec(defP.x)[0], 'styleId') : 'Normal');
    var blk = '<w:style w:type="' + type + '" w:customStyle="1" w:styleId="' + id + '"><w:name w:val="' + esc(name) + '"/>' + (type === 'paragraph' ? '<w:basedOn w:val="' + baseId + '"/><w:next w:val="' + id + '"/>' : '<w:basedOn w:val="DefaultParagraphFont"/>') + '<w:uiPriority w:val="1"/><w:qFormat/></w:style>';
    blk = applyFmt(blk, type === 'character' ? { font: f.font, size: f.size, bold: f.bold, italic: f.italic, color: f.color } : f);
    pkg.write('word/styles.xml', sx.replace('</w:styles>', blk + '</w:styles>')); return { id: id, created: true };
  }
  async function deleteStyle(pkg, id) {
    var sx = await pkg.read('word/styles.xml'); if (sx == null) return { err: '스타일 파일이 없습니다.' };
    var bs = styleBlocks(sx).filter(function (b) { return H().attrOf(/^<w:style\b[^>]*>/.exec(b.x)[0], 'styleId') === id; })[0];
    if (!bs) return { err: '스타일을 찾지 못했습니다.' };
    if (H().attrOf(/^<w:style\b[^>]*>/.exec(bs.x)[0], 'customStyle') !== '1') return { err: '직접 만든 스타일만 지울 수 있습니다.' };
    var dx = await pkg.read('word/document.xml') || '';
    if (new RegExp('w:(?:pStyle|rStyle)\\s+w:val="' + id + '"').test(dx)) return { err: '문서에서 쓰고 있는 스타일입니다. 먼저 다른 스타일로 바꾼 뒤 지워 주십시오.' };
    pkg.write('word/styles.xml', sx.slice(0, bs.s) + sx.slice(bs.e)); return { ok: true };
  }
  function applyCharStyle(xml, a, b, id) {               // 고른 문단 안 모든 글(런)에 글자 스타일을 입힌다(null = 풀기)
    return ST().paras(xml).reduceRight(function (out, p, i) {
      if (i < a || i > b) return out;
      var s = out.slice(p.s, p.e).replace(/<w:r\b([^>]*)>(<w:rPr>[\s\S]*?<\/w:rPr>)?/g, function (m0, at, rpr) {
        var box = H().setProp(rpr || '<w:rPr></w:rPr>', 'w:rPr', H().RPR_ORDER, 'rStyle', id ? '<w:rStyle w:val="' + id + '"/>' : null); return '<w:r' + at + '>' + (box || '');
      });
      return out.slice(0, p.s) + s + out.slice(p.e);
    }, xml);
  }

  // ============================================================ 도형
  var EMU_MM = 36000;
  var SHAPES = [
    { k: 'rect', l: '사각형', prst: 'rect', w: 40, h: 22, fill: '4472C4', line: '2F528F' },
    { k: 'round', l: '둥근 사각형', prst: 'roundRect', w: 40, h: 22, fill: '70AD47', line: '507E32' },
    { k: 'ellipse', l: '타원', prst: 'ellipse', w: 36, h: 24, fill: 'ED7D31', line: 'AE5A21' },
    { k: 'tri', l: '삼각형', prst: 'triangle', w: 38, h: 32, fill: 'FFC000', line: 'BF9000' },
    { k: 'diamond', l: '마름모', prst: 'diamond', w: 40, h: 30, fill: '5B9BD5', line: '41719C' },
    { k: 'star', l: '별', prst: 'star5', w: 34, h: 34, fill: 'FFD966', line: 'BF9000' },
    { k: 'rarrow', l: '화살표 블록', prst: 'rightArrow', w: 44, h: 20, fill: '4472C4', line: '2F528F' },
    { k: 'callout', l: '말풍선', prst: 'wedgeRoundRectCallout', w: 46, h: 24, fill: 'FFF2CC', line: 'BF9000' },
    { k: 'line', l: '선', prst: 'line', w: 50, h: 0, fill: null, line: '404040', lineW: 1.5 },
    { k: 'arrow', l: '화살표 선', prst: 'straightConnector1', w: 50, h: 0, fill: null, line: '404040', lineW: 1.5, tail: true },
    { k: 'textbox', l: '글상자', prst: 'rect', w: 50, h: 18, fill: null, line: null, textbox: true }
  ];
  var LAYOUTS = { inline: '글자처럼', left: '글 옆(왼쪽)', right: '글 옆(오른쪽)', center: '위아래(가운데)', behind: '글 뒤로', front: '글 앞으로' };
  function nextDocPrId(xml) { var mx = 0; (xml.match(/<wp:docPr\b[^>]*\sid="(\d+)"/g) || []).forEach(function (s) { mx = Math.max(mx, +/(\d+)/.exec(s)[1]); }); return mx + 1; }
  function hex6(c) { return /^[0-9A-Fa-f]{6}$/.test(c || '') ? c.toUpperCase() : null; }
  function shapeXml(sp, id, name) {
    var wE = Math.round(sp.w * EMU_MM), hE = Math.round((sp.h || 0) * EMU_MM), line = hex6(sp.line), fill = hex6(sp.fill), lw = Math.round((sp.lineW || 1) * 12700), ly = sp.layout || 'inline';
    var geom = '<a:prstGeom prst="' + esc(sp.prst) + '"><a:avLst/></a:prstGeom>';
    var fl = fill ? '<a:solidFill><a:srgbClr val="' + fill + '"/></a:solidFill>' : '<a:noFill/>';
    var ln = line ? '<a:ln w="' + lw + '"><a:solidFill><a:srgbClr val="' + line + '"/></a:solidFill>' + (sp.tail ? '<a:tailEnd type="triangle"/>' : '') + '</a:ln>' : '<a:ln><a:noFill/></a:ln>';
    var lines = String(sp.text == null ? '' : sp.text).split(/\r?\n/), hasText = lines.join('').length > 0, tc = hex6(sp.textColor) || (fill && /^(4472C4|70AD47|ED7D31|5B9BD5|2F528F|507E32|AE5A21|41719C)$/.test(fill) ? 'FFFFFF' : '000000'), sz = Math.round((sp.fontSize || 11) * 2);
    var txbx = '', cnv = sp.k === 'line' || sp.k === 'arrow' || sp.prst === 'line' || sp.prst === 'straightConnector1' ? '<wps:cNvCnPr/>' : '<wps:cNvSpPr' + (sp.textbox ? ' txBox="1"' : '') + '/>';
    if (hasText) txbx = '<wps:txbx><w:txbxContent>' + lines.map(function (t) { return '<w:p><w:pPr><w:jc w:val="' + (sp.textbox ? 'left' : 'center') + '"/></w:pPr><w:r><w:rPr><w:color w:val="' + tc + '"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r></w:p>'; }).join('') + '</w:txbxContent></wps:txbx>';
    var body = '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="' + (sp.textbox ? 't' : 'ctr') + '" anchorCtr="0"><a:noAutofit/></wps:bodyPr>';
    var wsp = '<wps:wsp xmlns:wps="' + NS_WPS + '">' + cnv + '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + wE + '" cy="' + hE + '"/></a:xfrm>' + geom + fl + ln + '</wps:spPr>' + txbx + body + '</wps:wsp>';
    var graphic = '<a:graphic xmlns:a="' + NS_A + '"><a:graphicData uri="' + NS_WPS + '">' + wsp + '</a:graphicData></a:graphic>';
    var doc = '<wp:docPr id="' + id + '" name="' + esc(name) + '"/><wp:cNvGraphicFramePr/>';
    if (ly === 'inline') return '<w:drawing><wp:inline xmlns:wp="' + NS_WP + '" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + wE + '" cy="' + hE + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' + doc + graphic + '</wp:inline></w:drawing>';
    var al = sp.align || (ly === 'left' ? 'left' : (ly === 'right' ? 'right' : 'center')), wrap = ly === 'center' ? '<wp:wrapTopAndBottom/>' : (ly === 'behind' || ly === 'front' ? '<wp:wrapNone/>' : '<wp:wrapSquare wrapText="bothSides"/>');
    return '<w:drawing><wp:anchor xmlns:wp="' + NS_WP + '" distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="' + (251658240 + id) + '" behindDoc="' + (ly === 'behind' ? 1 : 0) + '" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>' + al + '</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="' + wE + '" cy="' + hE + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' + wrap + doc + graphic + '</wp:anchor></w:drawing>';
  }
  // 폰 화면용 모양 그림(HTML+SVG). k = 1mm 가 몇 px 인지
  function shapeHtml(sp, k) {
    k = k || 3.78; var isLine = sp.prst === 'line' || sp.prst === 'straightConnector1', w = Math.min(700, Math.max(8, (sp.w || 30) * k)), hh = Math.min(900, Math.max(0, (sp.h || 0) * k)); if (isLine) hh = Math.max(hh, 12); else hh = Math.max(hh, 8);
    var sw = (sp.line ? (sp.lineW || 1) : 0) * 1.333, fill = hex6(sp.fill) ? '#' + sp.fill.toUpperCase() : 'none', stroke = hex6(sp.line) ? '#' + sp.line.toUpperCase() : 'none', W = w, H = hh, o = sw / 2, body = '';
    var pts = function (a) { return a.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' '); };
    var attr = ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw.toFixed(2) + '" stroke-linejoin="round"';
    switch (sp.prst) {
      case 'ellipse': body = '<ellipse cx="' + W / 2 + '" cy="' + H / 2 + '" rx="' + Math.max(1, W / 2 - o) + '" ry="' + Math.max(1, H / 2 - o) + '"' + attr + '/>'; break;
      case 'roundRect': body = '<rect x="' + o + '" y="' + o + '" width="' + Math.max(1, W - sw) + '" height="' + Math.max(1, H - sw) + '" rx="' + (Math.min(W, H) * 0.1667).toFixed(1) + '"' + attr + '/>'; break;
      case 'triangle': body = '<polygon points="' + pts([[W / 2, o], [W - o, H - o], [o, H - o]]) + '"' + attr + '/>'; break;
      case 'diamond': body = '<polygon points="' + pts([[W / 2, o], [W - o, H / 2], [W / 2, H - o], [o, H / 2]]) + '"' + attr + '/>'; break;
      case 'star5': { var c = [], i; for (i = 0; i < 10; i++) { var r0 = i % 2 ? 0.2 : 0.5, an = -Math.PI / 2 + i * Math.PI / 5; c.push([W / 2 + Math.cos(an) * r0 * W, H / 2 + Math.sin(an) * r0 * H]); } body = '<polygon points="' + pts(c) + '"' + attr + '/>'; break; }
      case 'rightArrow': body = '<polygon points="' + pts([[o, H * .25], [W * .6, H * .25], [W * .6, o], [W - o, H / 2], [W * .6, H - o], [W * .6, H * .75], [o, H * .75]]) + '"' + attr + '/>'; break;
      case 'wedgeRoundRectCallout': body = '<rect x="' + o + '" y="' + o + '" width="' + Math.max(1, W - sw) + '" height="' + (H * 0.8).toFixed(1) + '" rx="' + (Math.min(W, H) * 0.12).toFixed(1) + '"' + attr + '/><polygon points="' + pts([[W * .2, H * .8], [W * .12, H - o], [W * .38, H * .8]]) + '"' + attr + '/>'; break;
      case 'line': body = '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" stroke="' + (stroke === 'none' ? '#404040' : stroke) + '" stroke-width="' + Math.max(1, sw).toFixed(2) + '"/>'; break;
      case 'straightConnector1': { var st = stroke === 'none' ? '#404040' : stroke; body = '<line x1="0" y1="' + H / 2 + '" x2="' + (W - 9) + '" y2="' + H / 2 + '" stroke="' + st + '" stroke-width="' + Math.max(1, sw).toFixed(2) + '"/>' + (sp.tail ? '<polygon points="' + pts([[W, H / 2], [W - 11, H / 2 - 5], [W - 11, H / 2 + 5]]) + '" fill="' + st + '"/>' : ''); break; }
      default: body = '<rect x="' + o + '" y="' + o + '" width="' + Math.max(1, W - sw) + '" height="' + Math.max(1, H - sw) + '"' + attr + '/>';
    }
    var tc = hex6(sp.textColor) || (hex6(sp.fill) && /^(4472C4|70AD47|ED7D31|5B9BD5|2F528F|507E32|AE5A21|41719C)$/i.test(sp.fill) ? 'FFFFFF' : '000000'), fs = ((sp.fontSize || 11) * 1.333 * Math.min(1, k / 3.7795)).toFixed(1);
    var txt = sp.text ? '<div style="position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:' + (sp.textbox ? 'flex-start' : 'center') + ';justify-content:' + (sp.textbox ? 'flex-start' : 'center') + ';text-align:' + (sp.textbox ? 'left' : 'center') + ';padding:3px 6px;box-sizing:border-box;overflow:hidden;font-size:' + fs + 'px;line-height:1.25;color:#' + tc + ';white-space:pre-wrap;word-break:keep-all">' + esc(sp.text) + '</div>' : '';
    return '<span class="so-docx-shape-box" style="display:inline-block;position:relative;vertical-align:top;max-width:100%;width:' + W.toFixed(0) + 'px;height:' + H.toFixed(0) + 'px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W.toFixed(0) + ' ' + H.toFixed(0) + '" width="100%" height="100%" preserveAspectRatio="none" style="display:block;overflow:visible">' + body + '</svg>' + txt + '</span>';
  }
  function shapeSpecOf(k) { var d = SHAPES.filter(function (s) { return s.k === k; })[0]; return d ? JSON.parse(JSON.stringify(d)) : null; }
  function addShape(xml, xi, sp) {
    if (!sp || !sp.prst) return { err: '도형 종류를 고르십시오.' };
    var id = nextDocPrId(xml), dr = shapeXml(sp, id, '도형 ' + id), run = '<w:r>' + dr + '</w:r>';
    var r = (sp.layout && sp.layout !== 'inline') ? prependToPara(xml, xi, run) : appendToPara(xml, xi, run); if (r.err) return r;
    return { xml: r.xml, id: id };
  }
  // 문서 안 도형 목록
  function drawingRanges(xml) {
    return H().ranges(xml, 'w:drawing').filter(function (r) { return /wordprocessingShape/.test(xml.slice(r.s, r.e)); }).filter(function (r, i, all) { return !all.some(function (o) { return o !== r && o.s < r.s && o.e > r.e; }); }).sort(function (a, b) { return a.s - b.s; });
  }
  function parseShape(drs) {
    var sp = { prst: ((/<a:prstGeom\s+prst="([^"]*)"/.exec(drs)) || [])[1] || null, layout: 'inline' };
    var ext = /<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/.exec(drs); sp.w = ext ? Math.round(+ext[1] / EMU_MM * 10) / 10 : 40; sp.h = ext ? Math.round(+ext[2] / EMU_MM * 10) / 10 : 20;
    var spPr = (/<wps:spPr\b[\s\S]*?<\/wps:spPr>/.exec(drs) || [''])[0], f = /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(spPr.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, ''));
    sp.fill = f ? f[1].toUpperCase() : null;
    var ln = /<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/.exec(spPr); if (ln && !/<a:noFill\/>/.test(ln[2])) { var lc = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(ln[2]); sp.line = lc ? lc[1].toUpperCase() : '000000'; var lw = /\sw="(\d+)"/.exec(ln[1]); sp.lineW = lw ? Math.round(+lw[1] / 12700 * 10) / 10 : 1; sp.tail = /<a:tailEnd\b[^>]*type="(?!none)/.test(ln[2]); } else sp.line = null;
    var txt = (drs.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/) || [''])[0]; sp.text = (txt.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(function (p) { return ST().pText(p); }).join('\n');
    var tc = /<w:color\s+w:val="([0-9A-Fa-f]{6})"/.exec(txt); if (tc) sp.textColor = tc[1].toUpperCase(); var sz = /<w:sz\s+w:val="(\d+)"/.exec(txt); if (sz) sp.fontSize = +sz[1] / 2;
    sp.textbox = /txBox="1"/.test(drs);
    if (/<wp:anchor\b/.test(drs)) {
      var beh = /behindDoc="(1|true)"/.test(drs), al = (/<wp:align>(\w+)<\/wp:align>/.exec(drs) || [])[1];
      sp.align = al || 'center';
      sp.layout = /<wp:wrapTopAndBottom/.test(drs) ? 'center' : (beh ? 'behind' : (/<wp:wrapNone/.test(drs) ? 'front' : (al === 'right' ? 'right' : 'left')));
    }
    return sp;
  }
  function listShapes(xml) {
    var ps = ST().paras(xml), out = [];
    drawingRanges(xml).forEach(function (r, ord) {
      var xi = -1; ps.forEach(function (p, i) { if (p.s <= r.s && r.e <= p.e) xi = i; });
      var drs = xml.slice(r.s, r.e), nm = (/<wp:docPr\b[^>]*\sname="([^"]*)"/.exec(drs) || [])[1] || '', sp = parseShape(drs);
      out.push({ ord: ord, xi: xi, name: unesc(nm), spec: sp, s: r.s, e: r.e });
    });
    return out;
  }
  function enclosing(xml, r) {                           // 도형을 감싼 AlternateContent 와 런 범위(있으면 그것까지)
    var s = r.s, e = r.e, a = xml.lastIndexOf('<mc:AlternateContent', s);
    if (a >= 0) { var ae = xml.indexOf('</mc:AlternateContent>', e); if (ae >= 0 && xml.slice(a, s).indexOf('</mc:AlternateContent>') < 0) { s = a; e = ae + '</mc:AlternateContent>'.length; } }
    return { s: s, e: e };
  }
  function setShape(xml, ord, patch) {
    var list = listShapes(xml), t = list[ord]; if (!t) return { err: '도형을 찾지 못했습니다.' };
    var sp = Object.assign({}, t.spec, patch || {}), idm = /<wp:docPr\b[^>]*\sid="(\d+)"/.exec(xml.slice(t.s, t.e)), id = idm ? +idm[1] : nextDocPrId(xml);
    if (patch && patch.k) { var d = shapeSpecOf(patch.k); if (d) { sp.prst = d.prst; sp.tail = !!d.tail; sp.textbox = !!d.textbox; } }
    if (sp.w < 3) sp.w = 3; if (sp.h < 0) sp.h = 0;
    var nm = (/<wp:docPr\b[^>]*\sname="([^"]*)"/.exec(xml.slice(t.s, t.e)) || [])[1] || '도형 ' + id, nd = shapeXml(sp, id, unesc(nm)), enc = enclosing(xml, t);
    return { xml: xml.slice(0, enc.s) + nd + xml.slice(enc.e) };
  }
  function removeShape(xml, ord) {
    var list = listShapes(xml), t = list[ord]; if (!t) return { err: '도형을 찾지 못했습니다.' };
    var enc = enclosing(xml, t), rs = xml.lastIndexOf('<w:r>', enc.s), rs2 = xml.lastIndexOf('<w:r ', enc.s); rs = Math.max(rs, rs2);
    var re = xml.indexOf('</w:r>', enc.e); if (rs < 0 || re < 0) return { err: '도형 자리를 확인하지 못했습니다.' };
    var runStr = xml.slice(rs, re + 6), inner = runStr.replace(xml.slice(enc.s, enc.e), '');
    if (/<w:t[\s>]/.test(inner)) return { xml: xml.slice(0, enc.s) + xml.slice(enc.e) };
    return { xml: xml.slice(0, rs) + xml.slice(re + 6) };
  }

  // ============================================================ 입력 칸(콘텐츠 컨트롤) — 체크 칸 · 목록 고르기 · 날짜 · 글 입력
  var CHK_ON = '\u2612', CHK_OFF = '\u2610';
  function sdtRun(text, rprExtra) { return '<w:r>' + (rprExtra ? '<w:rPr>' + rprExtra + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>'; }
  function addControl(xml, xi, kind, o) {
    o = o || {}; var id = Math.floor(100000000 + Math.random() * 800000000), alias = esc(o.label || ''), pr = '<w:sdtPr>' + (alias ? '<w:alias w:val="' + alias + '"/><w:tag w:val="' + alias + '"/>' : '') + '<w:id w:val="' + id + '"/>', content, ns = '';
    if (kind === 'check') {
      ns = ' xmlns:w14="' + NS_W14 + '"'; pr += '<w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>';
      content = sdtRun(CHK_OFF, '<w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/>');
    } else if (kind === 'drop') {
      var items = (o.items || []).map(function (s) { return String(s).trim(); }).filter(Boolean); if (items.length < 1) return { err: '고를 항목을 한 줄에 하나씩 적어 주십시오.' };
      pr += '<w:dropDownList>' + items.map(function (s) { return '<w:listItem w:displayText="' + esc(s) + '" w:value="' + esc(s) + '"/>'; }).join('') + '</w:dropDownList>'; content = sdtRun(items[0]);
    } else if (kind === 'date') {
      var fmt = o.format || 'yyyy-MM-dd'; pr += '<w:date><w:dateFormat w:val="' + esc(fmt) + '"/><w:lid w:val="ko-KR"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>'; content = sdtRun(fmtDate(new Date(), fmt));
    } else if (kind === 'text') { pr += '<w:text/>'; content = sdtRun(o.value || '내용을 적으세요'); }
    else return { err: '알 수 없는 종류입니다.' };
    var sdt = '<w:sdt' + ns + '>' + pr + '</w:sdtPr><w:sdtContent>' + content + '</w:sdtContent></w:sdt>';
    var r = appendToPara(xml, xi, sdt); if (r.err) return r; return { xml: r.xml, id: id };
  }
  function fmtDate(d, fmt) {
    var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(fmt).replace(/yyyy/g, y).replace(/yy/g, String(y).slice(2)).replace(/MM/g, z(m)).replace(/M/g, m).replace(/dd/g, z(dd)).replace(/d/g, dd);
  }
  function listControls(xml) {
    var out = [], ord = 0;
    H().ranges(xml, 'w:sdt').sort(function (a, b) { return a.s - b.s; }).forEach(function (r) {
      var x = xml.slice(r.s, r.e), pr = (/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/.exec(x) || [''])[0], ct = (/<w:sdtContent>([\s\S]*)<\/w:sdtContent>/.exec(x) || [])[1] || '';
      if (!pr) return;
      var al = (/<w:alias\s+w:val="([^"]*)"/.exec(pr) || [])[1] || '', type = /<w14:checkbox\b/.test(pr) ? 'check' : (/<w:dropDownList\b/.test(pr) ? 'drop' : (/<w:comboBox\b/.test(pr) ? 'combo' : (/<w:date\b/.test(pr) ? 'date' : (/<w:text\b/.test(pr) ? 'text' : 'other'))));
      var block = /<w:p\b/.test(ct), val = ST().pText(ct);
      var o = { ord: ord++, type: type, alias: unesc(al), s: r.s, e: r.e, block: block, value: val };
      if (type === 'check') o.checked = /<w14:checked\s+w14:val="(?:1|true|on)"/.test(pr);
      if (type === 'drop' || type === 'combo') o.items = (pr.match(/<w:listItem\b[^>]*>/g) || []).map(function (t) { return unesc(H().attrOf(t, 'displayText') || H().attrOf(t, 'value') || ''); });
      if (type === 'date') o.format = unesc((/<w:dateFormat\s+w:val="([^"]*)"/.exec(pr) || [])[1] || 'yyyy-MM-dd');
      out.push(o);
    });
    return out;
  }
  function setControl(xml, ord, value) {
    var list = listControls(xml), t = list[ord]; if (!t) return { err: '입력 칸을 찾지 못했습니다.' };
    if (t.block || t.type === 'other') return { err: '이 입력 칸은 폰에서 채울 수 없습니다(워드에서 채워 주십시오).' };
    var x = xml.slice(t.s, t.e), pr = /<w:sdtPr>[\s\S]*?<\/w:sdtPr>/.exec(x)[0], nx;
    var ct = /<w:sdtContent>([\s\S]*)<\/w:sdtContent>/.exec(x)[1], rpr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(ct) || [''])[0], shown;
    if (t.type === 'check') {
      var on = !!value, chOn = (/<w14:checkedState\s+w14:val="([0-9A-Fa-f]+)"/.exec(pr) || [])[1], chOff = (/<w14:uncheckedState\s+w14:val="([0-9A-Fa-f]+)"/.exec(pr) || [])[1];
      shown = String.fromCodePoint(parseInt(on ? (chOn || '2612') : (chOff || '2610'), 16));
      pr = pr.replace(/<w14:checked\s+w14:val="[^"]*"\s*\/>/, '<w14:checked w14:val="' + (on ? 1 : 0) + '"/>');
    } else if (t.type === 'date') {
      var d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value)); if (!d) return { err: '날짜는 2026-11-15 처럼 적어 주십시오.' };
      var dt = new Date(+d[1], +d[2] - 1, +d[3]); if (dt.getMonth() !== +d[2] - 1) return { err: '없는 날짜입니다.' };
      shown = fmtDate(dt, t.format); var full = d[1] + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2) + 'T00:00:00Z';
      pr = /<w:date\b[^>]*>/.test(pr) ? pr.replace(/<w:date\b[^>]*>/, '<w:date w:fullDate="' + full + '">') : pr;
    } else if (t.type === 'drop') {
      if ((t.items || []).indexOf(String(value)) < 0) return { err: '목록에 없는 항목입니다.' }; shown = String(value);
    } else shown = String(value);
    pr = pr.replace(/<w:showingPlcHdr\s*\/>/, '');
    nx = x.replace(/<w:sdtPr>[\s\S]*?<\/w:sdtPr>/, pr).replace(/<w:sdtContent>[\s\S]*<\/w:sdtContent>/, '<w:sdtContent><w:r>' + rpr + '<w:t xml:space="preserve">' + esc(shown) + '</w:t></w:r></w:sdtContent>');
    return { xml: xml.slice(0, t.s) + nx + xml.slice(t.e), shown: shown };
  }
  function removeControl(xml, ord, keepText) {
    var list = listControls(xml), t = list[ord]; if (!t) return { err: '입력 칸을 찾지 못했습니다.' };
    if (t.block) return { err: '이 입력 칸은 폰에서 지울 수 없습니다.' };
    var x = xml.slice(t.s, t.e), ct = (/<w:sdtContent>([\s\S]*)<\/w:sdtContent>/.exec(x) || [])[1] || '';
    return { xml: xml.slice(0, t.s) + (keepText ? ct : '') + xml.slice(t.e) };
  }

  // ============================================================ 인용·참고문헌(서지 원본 + CITATION · BIBLIOGRAPHY 필드)
  async function bibPart(pkg) {                          // 문서의 서지 원본 파트 경로(없으면 null)
    var list = pkg.list().filter(function (q) { return /^customXml\/item\d+\.xml$/.test(q); });
    for (var i = 0; i < list.length; i++) { var x = await pkg.read(list[i]); if (x && /<(?:b:)?Sources\b[^>]*bibliography/.test(x)) return list[i]; }
    return null;
  }
  function tx(x, tag) { var m = new RegExp('<b:' + tag + '>([\\s\\S]*?)</b:' + tag + '>').exec(x); return m ? unesc(m[1]) : ''; }
  function parseSources(x) {
    return (x.match(/<b:Source>[\s\S]*?<\/b:Source>/g) || []).map(function (s) {
      var last = tx(s, 'Last'), first = tx(s, 'First'), corp = tx(s, 'Corporate');
      return { tag: tx(s, 'Tag'), type: tx(s, 'SourceType'), author: corp || ((last + ' ' + first).trim()), title: tx(s, 'Title') || tx(s, 'InternetSiteTitle'), year: tx(s, 'Year'), pub: tx(s, 'Publisher') || tx(s, 'JournalName') || tx(s, 'URL'), url: tx(s, 'URL') };
    });
  }
  async function listSources(pkg) { var p = await bibPart(pkg); if (!p) return []; return parseSources(await pkg.read(p)); }
  function srcXml(sp, tag, order) {
    var type = sp.type === 'JournalArticle' ? 'JournalArticle' : (sp.type === 'InternetSite' ? 'InternetSite' : 'Book');
    var o = '<b:Source><b:Tag>' + esc(tag) + '</b:Tag><b:SourceType>' + type + '</b:SourceType><b:Author><b:Author><b:NameList><b:Person><b:Last>' + esc(sp.author) + '</b:Last><b:First></b:First></b:Person></b:NameList></b:Author></b:Author>';
    if (type === 'InternetSite') o += '<b:InternetSiteTitle>' + esc(sp.title) + '</b:InternetSiteTitle>' + (sp.year ? '<b:Year>' + esc(sp.year) + '</b:Year>' : '') + (sp.pub ? '<b:URL>' + esc(sp.pub) + '</b:URL>' : '');
    else if (type === 'JournalArticle') o += '<b:Title>' + esc(sp.title) + '</b:Title>' + (sp.pub ? '<b:JournalName>' + esc(sp.pub) + '</b:JournalName>' : '') + (sp.year ? '<b:Year>' + esc(sp.year) + '</b:Year>' : '');
    else o += '<b:Title>' + esc(sp.title) + '</b:Title>' + (sp.year ? '<b:Year>' + esc(sp.year) + '</b:Year>' : '') + (sp.pub ? '<b:Publisher>' + esc(sp.pub) + '</b:Publisher>' : '');
    return o + '<b:RefOrder>' + order + '</b:RefOrder></b:Source>';
  }
  async function addSource(pkg, sp) {
    sp = sp || {}; if (!String(sp.author || '').trim() || !String(sp.title || '').trim()) return { err: '저자와 제목은 꼭 적어 주십시오.' };
    var part = await bibPart(pkg), x, tag;
    if (!part) {
      var n = 1; while (pkg.list().indexOf('customXml/item' + n + '.xml') >= 0) n++;
      part = 'customXml/item' + n + '.xml';
      x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources SelectedStyle="\\APA.XSL" StyleName="APA" xmlns:b="' + NS_B + '" xmlns="' + NS_B + '"></b:Sources>';
      pkg.write('customXml/itemProps' + n + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="' + guid() + '" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="' + NS_B + '"/></ds:schemaRefs></ds:datastoreItem>');
      pkg.write('customXml/_rels/item' + n + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + H().RT + 'customXmlProps" Target="itemProps' + n + '.xml"/></Relationships>');
      var rp = 'word/_rels/document.xml.rels', rx = await H().must(pkg, rp);
      pkg.write(rp, rx.replace('</Relationships>', '<Relationship Id="' + H().nextRid(rx) + '" Type="' + H().RT + 'customXml" Target="../customXml/item' + n + '.xml"/></Relationships>'));
      var ct = await H().must(pkg, '[Content_Types].xml');
      if (ct.indexOf('/customXml/itemProps' + n + '.xml') < 0) pkg.write('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/customXml/itemProps' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));
      ct = await pkg.read('[Content_Types].xml'); if (!/Extension="xml"/i.test(ct)) pkg.write('[Content_Types].xml', ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="xml" ContentType="application/xml"/>'));
    } else x = await pkg.read(part);
    var cur = parseSources(x), used = {}; cur.forEach(function (s) { used[s.tag] = 1; });
    var base = (sp.author.replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 8) || 'Src') + (sp.year || ''); tag = base; var k = 2; while (used[tag]) tag = base + '_' + k++;
    var nx = x.replace('</b:Sources>', srcXml(sp, tag, cur.length + 1) + '</b:Sources>');
    pkg.write(part, nx); return { tag: tag };
  }
  async function removeSource(pkg, tag) {
    var part = await bibPart(pkg); if (!part) return { err: '참고 자료가 없습니다.' };
    var x = await pkg.read(part), re = new RegExp('<b:Source>(?:(?!</b:Source>)[\\s\\S])*?<b:Tag>' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</b:Tag>[\\s\\S]*?</b:Source>'), m = re.exec(x);
    if (!m) return { err: '그 참고 자료를 찾지 못했습니다.' };
    var dx = await pkg.read('word/document.xml') || ''; if (new RegExp('CITATION\\s+' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(dx)) return { err: '본문에서 인용하고 있는 자료입니다. 먼저 그 인용을 지워 주십시오.' };
    pkg.write(part, x.replace(m[0], '')); return { ok: true };
  }
  function citeText(s) { return '(' + s.author + (s.year ? ', ' + s.year : '') + ')'; }
  function fieldRuns(instr, resultXml) {
    return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + instr + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + resultXml + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  }
  async function addCitation(pkg, xi, tag) {
    var srcs = await listSources(pkg), s = srcs.filter(function (q) { return q.tag === tag; })[0]; if (!s) return { err: '참고 자료를 찾지 못했습니다.' };
    var x = await H().must(pkg, 'word/document.xml'), r = appendToPara(x, xi, fieldRuns('CITATION ' + tag + ' \\l 1042', sdtRun(citeText(s)))); if (r.err) return r;
    pkg.write('word/document.xml', r.xml); return { shown: citeText(s) };
  }
  function bibEntry(s) { return s.author + (s.year ? ' (' + s.year + '). ' : '. ') + s.title + (s.pub ? '. ' + s.pub : '') + '.'; }
  // 필드를 문단 여러 개로: 첫 문단에 시작·코드·구분, 마지막 문단에 끝(워드가 직접 만드는 목차·색인 모양 — 한 문단에 줄바꿈으로 넣으면 워드의 색인 갱신이 안 먹는다)
  function fieldParas(instr, entries) {
    var out = '';
    entries.forEach(function (t, i) {
      var pre = i === 0 ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ' + instr + ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' : '';
      var post = i === entries.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : '';
      out += '<w:p>' + pre + sdtRun(t) + post + '</w:p>';
    });
    return out;
  }
  function fieldBlock(xml, kw) {                           // 이름이 kw 인 필드가 걸친 문단 범위 {a, b}(없으면 null)
    var ps = ST().paras(xml), re = new RegExp('<w:instrText[^>]*>\\s*' + kw + '\\b'), a = -1, i;
    for (i = 0; i < ps.length; i++) if (re.test(xml.slice(ps[i].s, ps[i].e))) { a = i; break; }
    if (a < 0) return null;
    for (i = a; i < ps.length; i++) {
      var t = xml.slice(ps[i].s, ps[i].e);
      if (i === a) { var at = t.search(re); if (t.indexOf('fldCharType="end"', at) >= 0) return { a: a, b: a }; } else if (/fldCharType="end"/.test(t)) return { a: a, b: i };
    }
    return { a: a, b: a };
  }
  function putField(xml, kw, instr, entries, afterXi) {
    var blk = fieldBlock(xml, kw), ps = ST().paras(xml), body = fieldParas(instr, entries);
    if (blk) return { xml: xml.slice(0, ps[blk.a].s) + body + xml.slice(ps[blk.b].e), updated: true, xi: blk.a };
    var q = ps[afterXi]; if (!q) return { err: '문단을 찾지 못했습니다.' };
    if (q.anc.indexOf('w:tc') >= 0 || q.anc.indexOf('w:txbxContent') >= 0) return { err: '표 안이나 글상자 안에는 목록을 넣을 수 없습니다. 표 밖 문단을 골라 주십시오.' };
    return { xml: xml.slice(0, q.e) + body + xml.slice(q.e), xi: afterXi + 1 };
  }
  async function putBibliography(pkg, xi) {               // 참고문헌 목록 넣기(이미 있으면 갱신)
    var srcs = await listSources(pkg); if (!srcs.length) return { err: '참고 자료가 없습니다. 먼저 「참고 자료 추가」를 해 주십시오.' };
    var x = await H().must(pkg, 'word/document.xml'), sorted = srcs.slice().sort(function (a, b) { return a.author < b.author ? -1 : (a.author > b.author ? 1 : 0); });
    var r = putField(x, 'BIBLIOGRAPHY', 'BIBLIOGRAPHY \\l 1042', sorted.map(bibEntry), xi); if (r.err) return r;
    pkg.write('word/document.xml', r.xml); return { updated: !!r.updated, n: srcs.length, xi: r.xi };
  }

  // ============================================================ 색인(XE 표시 · INDEX 목록)
  function xeRuns(term) { var r = ''; return '<w:r>' + r + '<w:fldChar w:fldCharType="begin"/></w:r><w:r>' + r + '<w:instrText xml:space="preserve"> XE "' + esc(term).replace(/&quot;/g, '') + '" </w:instrText></w:r><w:r>' + r + '<w:fldChar w:fldCharType="end"/></w:r>'; }
  function addIndexEntry(xml, xi, term) {
    term = String(term || '').trim(); if (!term) return { err: '색인에 올릴 낱말을 적어 주십시오.' }; if (/["<>]/.test(term)) return { err: '낱말에 쓸 수 없는 글자(" < >)가 있습니다.' };
    var r = appendToPara(xml, xi, xeRuns(term)); return r.err ? r : { xml: r.xml };
  }
  function listIndexEntries(xml) {
    var out = [], ps = ST().paras(xml);
    ps.forEach(function (p, i) { (xml.slice(p.s, p.e).match(/<w:instrText[^>]*>\s*XE\s+"[^"]*"/g) || []).forEach(function (t) { out.push({ xi: i, term: unesc(/XE\s+"([^"]*)"/.exec(t)[1]) }); }); });
    return out;
  }
  function removeIndexEntry(xml, xi, term) {
    var ps = ST().paras(xml), p = ps[xi]; if (!p) return { err: '문단을 찾지 못했습니다.' };
    var s = xml.slice(p.s, p.e), re = /<w:r><w:fldChar w:fldCharType="begin"\/><\/w:r><w:r><w:instrText[^>]*>\s*XE\s+"([^"]*)"\s*<\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="end"\/><\/w:r>/g, done = false;
    var ns = s.replace(re, function (m0, t) { if (!done && unesc(t) === term) { done = true; return ''; } return m0; });
    if (!done) return { err: '이 문단에서 그 색인 표시를 찾지 못했습니다(워드에서 넣은 복잡한 표시는 워드에서 지워 주십시오).' };
    return { xml: xml.slice(0, p.s) + ns + xml.slice(p.e) };
  }
  // pageOf(xi) → 쪽 번호(화면 기준, 없으면 생략)
  function putIndex(xml, xi, pageOf) {
    var ent = listIndexEntries(xml); if (!ent.length) return { err: '색인 표시가 하나도 없습니다. 먼저 문단을 고르고 「색인에 올리기」로 낱말을 표시해 주십시오.' };
    var map = {}; ent.forEach(function (e) { (map[e.term] = map[e.term] || []); var pg = pageOf ? pageOf(e.xi) : 0; if (pg && map[e.term].indexOf(pg) < 0) map[e.term].push(pg); });
    var terms = Object.keys(map).sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    var lines = terms.map(function (t) { return t + (map[t].length ? ', ' + map[t].sort(function (a, b) { return a - b; }).join(', ') : ''); });
    var r = putField(xml, 'INDEX', 'INDEX \\c "1" \\z "1042"', lines, xi); if (r.err) return r;
    return { xml: r.xml, n: terms.length, updated: !!r.updated, xi: r.xi };
  }

  global.SODocxMore = {
    SHAPES: SHAPES, LAYOUTS: LAYOUTS, shapeSpecOf: shapeSpecOf, shapeXml: shapeXml, shapeHtml: shapeHtml, addShape: addShape, listShapes: listShapes, setShape: setShape, removeShape: removeShape,
    listStyles: listStyles, saveStyle: saveStyle, deleteStyle: deleteStyle, applyCharStyle: applyCharStyle,
    addControl: addControl, listControls: listControls, setControl: setControl, removeControl: removeControl, fmtDate: fmtDate,
    listSources: listSources, addSource: addSource, removeSource: removeSource, addCitation: addCitation, putBibliography: putBibliography,
    addIndexEntry: addIndexEntry, listIndexEntries: listIndexEntries, removeIndexEntry: removeIndexEntry, putIndex: putIndex
  };
})(typeof window !== 'undefined' ? window : globalThis);

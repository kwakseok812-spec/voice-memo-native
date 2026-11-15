/* so-pdf-docx.js — S-Office PDF → 워드(.docx) 사본 만들기 (O-0861, v10.9 5회차)
 * PDF.js 로 쪽의 글자 조각을 읽어 줄·문단·제목으로 묶고, 쪽마다 쪽 나누기를 넣어 가장 단순한 .docx 를 만든다.
 * 문서 안 그림은 그 쪽 글 뒤에 넣고, 글이 없는 쪽(스캔)은 쪽 전체 그림으로 넣는다. 표·칸 나누기·글자 위치는 따라가지 않는다.
 * 새 외부 부품 없음(JSZip·PDF.js 는 앱에 이미 있음).
 */
(function (global) {
  'use strict';
  function esc(s) { return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function canvasBlob(cv, type, q) { return new Promise(function (res, rej) { cv.toBlob(function (b) { if (b) res(b); else rej(new Error('그림을 만들지 못했습니다')); }, type, q); }); }

  // 쪽 글 → 줄 → 문단 [{t, size, head, x}] (쪽 위에서 아래)
  function linesOf(tc) {
    var rows = [];
    tc.items.forEach(function (it) {
      var s = it.str; if (s == null || it.transform == null) return;
      var size = Math.abs(it.height || it.transform[3] || 0) || Math.sqrt(it.transform[0] * it.transform[0] + it.transform[1] * it.transform[1]), x = it.transform[4], y = it.transform[5];
      if (!String(s).length && !it.hasEOL) return;
      var row = null;
      for (var i = rows.length - 1; i >= 0 && i >= rows.length - 6; i--) { if (Math.abs(rows[i].y - y) < Math.max(2, size * 0.45)) { row = rows[i]; break; } }
      if (!row) { row = { y: y, parts: [], size: 0 }; rows.push(row); }
      row.parts.push({ s: String(s), x: x, w: it.width || 0, size: size }); if (size > row.size) row.size = size;
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var txt = '', end = null;
      r.parts.forEach(function (p) { if (end != null && p.x - end > r.size * 0.25 && !/\s$/.test(txt) && !/^\s/.test(p.s)) txt += ' '; txt += p.s; end = p.x + p.w; });
      return { t: txt.replace(/\s+$/, ''), size: r.size, y: r.y, x: r.parts.length ? r.parts[0].x : 0 };
    }).filter(function (r) { return r.t; });
  }

  function imagesOf(pdfjs, page) {
    var OPS = pdfjs.OPS, out = [];
    return page.getOperatorList().then(function (ol) {
      var stack = [], ctm = [1, 0, 0, 1, 0, 0], jobs = [];
      function mul(a, b) { return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]; }
      for (var i = 0; i < ol.fnArray.length; i++) {
        var fn = ol.fnArray[i], a = ol.argsArray[i];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
        else if (fn === OPS.transform) ctm = mul(a, ctm);
        else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) jobs.push({ id: a[0], ctm: ctm.slice() });
        else if (fn === OPS.paintInlineImageXObject) jobs.push({ inline: a[0], ctm: ctm.slice() });
      }
      var chain = Promise.resolve();
      jobs.slice(0, 40).forEach(function (j) {
        chain = chain.then(function () {
          return new Promise(function (res) {
            if (j.inline) return res(j.inline);
            var done = false, t = setTimeout(function () { if (!done) { done = true; res(null); } }, 1500);
            try { page.objs.get(j.id, function (o) { if (!done) { done = true; clearTimeout(t); res(o); } }); } catch (e) { if (!done) { done = true; clearTimeout(t); res(null); } }
          });
        }).then(function (img) {
          if (!img) return; var w = img.width, h = img.height; if (!w || !h || w < 24 || h < 24) return;
          var cv = document.createElement('canvas'), k = Math.min(1, 1600 / Math.max(w, h)); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k)); var g = cv.getContext('2d');
          var draw = Promise.resolve();
          if (img.bitmap) g.drawImage(img.bitmap, 0, 0, cv.width, cv.height);
          else if (img.data) {
            var rgba = new Uint8ClampedArray(w * h * 4), d = img.data, kind = img.kind, p, q;
            if (kind === 3 || (d.length === w * h * 4)) rgba.set(d.subarray ? d.subarray(0, rgba.length) : d);
            else if (kind === 2 || d.length === w * h * 3) { for (p = 0, q = 0; p < w * h; p++, q += 3) { rgba[p * 4] = d[q]; rgba[p * 4 + 1] = d[q + 1]; rgba[p * 4 + 2] = d[q + 2]; rgba[p * 4 + 3] = 255; } }
            else { var rb = Math.ceil(w / 8); for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) { var bit = (d[yy * rb + (xx >> 3)] >> (7 - (xx & 7))) & 1, v = bit ? 255 : 0, pi = (yy * w + xx) * 4; rgba[pi] = rgba[pi + 1] = rgba[pi + 2] = v; rgba[pi + 3] = 255; } }
            var c0 = document.createElement('canvas'); c0.width = w; c0.height = h; c0.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0); g.drawImage(c0, 0, 0, cv.width, cv.height); c0.width = 0;
          } else return;
          var wpt = Math.sqrt(j.ctm[0] * j.ctm[0] + j.ctm[1] * j.ctm[1]), hpt = Math.sqrt(j.ctm[2] * j.ctm[2] + j.ctm[3] * j.ctm[3]);
          return canvasBlob(cv, 'image/png').then(function (b) { cv.width = 0; return b.arrayBuffer(); }).then(function (buf) { out.push({ bytes: new Uint8Array(buf), wpt: wpt || w * 0.75, hpt: hpt || h * 0.75, ext: 'png' }); });
        }).catch(function () {});
      });
      return chain;
    }).then(function () { return out; }, function () { return out; });
  }

  function convert(pdf, opts) {
    var pdfjs = global.pdfjsLib, JSZip = opts.JSZip, n = pdf.numPages, body = '', rels = [], media = [], mid = 0, stats = { paras: 0, images: 0, scanPages: 0 };
    var pgW = 595, pgH = 842, sizes = {};
    function para(text, o) {
      o = o || {};
      var rpr = (o.bold ? '<w:b/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
      return '<w:p><w:pPr>' + (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + '</w:pPr><w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
    }
    function imgPara(im, maxWpt) {
      var w = Math.min(im.wpt, maxWpt), h = im.hpt * (w / im.wpt); if (h > pgH * 0.8) { h = pgH * 0.8; w = im.wpt * (h / im.hpt); }
      mid++; var rid = 'rIdImg' + mid, name = 'image' + mid + '.' + im.ext; media.push({ name: name, bytes: im.bytes });
      rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + name + '"/>');
      var cx = Math.round(w * 12700), cy = Math.round(h * 12700);
      stats.images++;
      return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + mid + '" name="Picture ' + mid + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + mid + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }
    function pageBreak() { return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
    var chain = Promise.resolve(), allSizes = {};
    // 본문 글자 크기(가장 많이 쓰인 크기)
    var counts = {};
    var texts = [];
    for (var pn = 1; pn <= n; pn++) (function (pn) {
      chain = chain.then(function () { if (opts.onProgress) opts.onProgress(pn, n); return pdf.getPage(pn); }).then(function (pg) {
        var vp = pg.getViewport({ scale: 1 }); if (pn === 1) { pgW = vp.width; pgH = vp.height; }
        return pg.getTextContent().then(function (tc) {
          var lines = linesOf(tc); lines.forEach(function (l) { var k = Math.round(l.size); counts[k] = (counts[k] || 0) + l.t.length; });
          texts[pn] = { lines: lines, pg: pg, vp: vp };
        });
      });
    })(pn);
    return chain.then(function () {
      var bodySz = 12, best = 0; Object.keys(counts).forEach(function (k) { if (counts[k] > best) { best = counts[k]; bodySz = +k; } });
      var seq = Promise.resolve();
      for (var p2 = 1; p2 <= n; p2++) (function (p2) {
        seq = seq.then(function () {
          if (opts.onProgress) opts.onProgress(p2, n);
          var rec = texts[p2], lines = rec.lines, total = lines.reduce(function (a, l) { return a + l.t.length; }, 0), pg = rec.pg;
          var out = '';
          if (total < 3) {            // 글이 없는 쪽 → 쪽 그림
            var vp1 = rec.vp, k = Math.min(2, 1600 / Math.max(vp1.width, vp1.height)), cv = document.createElement('canvas'); cv.width = Math.round(vp1.width * k); cv.height = Math.round(vp1.height * k);
            var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
            return pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: k }) }).promise.then(function () { return canvasBlob(cv, 'image/jpeg', 0.82); }).then(function (b) { cv.width = 0; return b.arrayBuffer(); }).then(function (buf) {
              stats.scanPages++; body += imgPara({ bytes: new Uint8Array(buf), wpt: vp1.width, hpt: vp1.height, ext: 'jpeg' }, pgW - 144) + (p2 < n ? pageBreak() : '');
            });
          }
          var prev = null, buf2 = [];
          function flush() { if (buf2.length) { out += para(buf2.join(' ')); stats.paras++; buf2 = []; } }
          lines.forEach(function (l) {
            var head = l.size >= bodySz * 1.5 ? 'Heading1' : (l.size >= bodySz * 1.22 ? 'Heading2' : '');
            var gap = prev ? prev.y - l.y : 0;
            if (head) { flush(); out += para(l.t, { style: head }); stats.paras++; prev = l; return; }
            if (prev && gap > Math.max(l.size, prev.size) * 1.9) flush();
            else if (prev && buf2.length && /[.?!。”」)]$/.test(buf2[buf2.length - 1]) && l.x < prev.x - 2) flush();
            buf2.push(l.t); prev = l;
          });
          flush();
          return imagesOf(pdfjs, pg).then(function (imgs) { imgs.forEach(function (im) { out += imgPara(im, pgW - 144); }); body += out + (p2 < n ? pageBreak() : ''); try { pg.cleanup(); } catch (e) {} });
        });
      })(p2);
      return seq;
    }).then(function () {
      var W = Math.round(pgW * 20), H = Math.round(pgH * 20);
      var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
      var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + '<w:sectPr><w:pgSz w:w="' + W + '" w:h="' + H + '"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
      var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>';
      var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
      var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>';
      var zip = new JSZip();
      zip.file('[Content_Types].xml', ct); zip.file('_rels/.rels', rootRels); zip.file('word/document.xml', doc); zip.file('word/styles.xml', styles); zip.file('word/_rels/document.xml.rels', docRels);
      media.forEach(function (m) { zip.file('word/media/' + m.name, m.bytes); });
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
    }).then(function (blob) { return { blob: blob, paras: stats.paras, images: stats.images, scanPages: stats.scanPages }; });
  }

  global.SOPdfDocx = { convert: convert, linesOf: linesOf };
})(typeof window !== 'undefined' ? window : globalThis);

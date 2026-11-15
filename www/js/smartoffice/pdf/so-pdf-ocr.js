/* so-pdf-ocr.js — S-Office PDF 「글자 인식(OCR)」 (O-0861, v10.9 6회차, 스위치 SO_PDF_OCR)
 * 스캔한 PDF(글자가 그림인 쪽)를 폰 안에서 글자로 읽어, 쪽 위에 «보이지 않는 글 층»을 얹는다 → 검색·복사·글만 뽑아 보기가 된다.
 * - 글자 읽기는 안드로이드 쪽 플러그인 TextOcr(ML Kit 한국어 번들 모형, 인터넷 요청 없음). 문서 그림은 앱 밖으로 나가지 않는다.
 * - 웹(PC 브라우저)에는 플러그인이 없어 「폰 앱에서 됩니다」 안내만 한다(글만 뽑아 보기는 웹에서도 된다).
 * - 글 층: 글꼴을 파일에 넣지 않는다. 보이지 않는 글(Tr 3) + 글자 번호표(ToUnicode)로만 적는다 → 어떤 읽개도 글을 뽑을 수 있고 쪽 모양은 그대로다.
 * 저장은 사본으로만(↶ 가능). 새 외부 부품 없음(pdf-lib·PDF.js 는 이미 있음. 글자 읽기 모형만 안드로이드 쪽 새 부품).
 */
(function (global) {
  'use strict';

  var MAX_SIDE_PX = 2200, MAX_PAGES_PER_RUN = 60, SCAN_CHARS = 20;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function plugin() { var C = global.Capacitor; if (!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform())) return null; return (C.Plugins && C.Plugins.TextOcr) || null; }
  function hex4(n) { var s = n.toString(16).toUpperCase(); while (s.length < 4) s = '0' + s; return s; }
  function utf16hex(ch) {        // 글자 하나(코드 포인트) → UTF-16BE 16진수
    var cp = ch.codePointAt(0);
    if (cp < 0x10000) return hex4(cp);
    cp -= 0x10000; return hex4(0xD800 + (cp >> 10)) + hex4(0xDC00 + (cp & 0x3FF));
  }

  // ---------------------------------------------------------------- 글 층 만들기 (순수 함수: Node 에서도 시험함)
  // pages: [{ index(0부터), lines:[{ t, x0, y0, x1, y1, h }] }]   좌표는 모두 PDF 좌표(pt). (x0,y0)=줄 바닥 왼쪽, (x1,y1)=줄 바닥 오른쪽, h = 줄 높이
  function addTextLayer(L, doc, pages) {
    var tab = {}, order = [];            // 글자 → 번호(1부터)
    pages.forEach(function (p) { p.lines.forEach(function (ln) { Array.from(ln.t).forEach(function (ch) { if (!tab[ch]) { order.push(ch); tab[ch] = order.length; } }); }); });
    if (!order.length) return { chars: 0, lines: 0, pages: 0 };
    if (order.length > 65000) throw new Error('인식된 글자 종류가 너무 많습니다');
    var ctxo = doc.context, N = L.PDFName.of;
    // 글자 번호표(ToUnicode) — 100개씩 끊어 적는다
    var cm = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (var i = 0; i < order.length; i += 100) {
      var part = order.slice(i, i + 100);
      cm += part.length + ' beginbfchar\n' + part.map(function (ch, k) { return '<' + hex4(i + k + 1) + '> <' + utf16hex(ch) + '>'; }).join('\n') + '\nendbfchar\n';
    }
    cm += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    var tuRef = ctxo.register(ctxo.flateStream(cm));
    var fdRef = ctxo.register(ctxo.obj({ Type: 'FontDescriptor', FontName: 'SOcrHidden', Flags: 4, FontBBox: [0, -200, 1000, 900], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 700, StemV: 80 }));
    var cidRef = ctxo.register(ctxo.obj({ Type: 'Font', Subtype: 'CIDFontType0', BaseFont: 'SOcrHidden', CIDSystemInfo: { Registry: L.PDFString.of('Adobe'), Ordering: L.PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: fdRef, DW: 1000 }));
    var fontRef = ctxo.register(ctxo.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'SOcrHidden', Encoding: 'Identity-H', DescendantFonts: [cidRef], ToUnicode: tuRef }));
    var Op = L.PDFOperatorNames, O = L.PDFOperator, num = L.PDFNumber.of, nTotal = 0, pTotal = 0;
    pages.forEach(function (p) {
      if (!p.lines.length) return;
      var page = doc.getPage(p.index), tag = 'SOcr' + Date.now().toString(36) + p.index, ops = [];
      var fkey = page.node.newFontDictionary(tag, fontRef);    // 같은 이름이 있으면 뒤에 번호를 붙여 돌려준다
      ops.push(O.of(Op.PushGraphicsState)); ops.push(O.of(Op.BeginText)); ops.push(O.of(Op.SetTextRenderingMode, [num(3)]));
      p.lines.forEach(function (ln) {
        var chars = Array.from(ln.t); if (!chars.length) return;
        var dx = ln.x1 - ln.x0, dy = ln.y1 - ln.y0, len = Math.sqrt(dx * dx + dy * dy); if (!(len > 0.5)) return;
        var c = dx / len, s = dy / len, fs = Math.max(1, ln.h * 0.85);
        var tz = Math.min(1000, Math.max(5, 100 * len / (chars.length * fs)));      // 글자 폭이 1000 이므로 줄 폭에 맞게 가로 비율을 조절
        ops.push(O.of(Op.SetFontAndSize, [fkey, num(Math.round(fs * 100) / 100)]));
        ops.push(O.of('Tz', [num(Math.round(tz * 100) / 100)]));
        ops.push(O.of(Op.SetTextMatrix, [num(c), num(s), num(-s), num(c), num(Math.round(ln.x0 * 100) / 100), num(Math.round(ln.y0 * 100) / 100)]));
        ops.push(O.of(Op.ShowText, [L.PDFHexString.of(chars.map(function (ch) { return hex4(tab[ch]); }).join(''))]));
        nTotal += chars.length;
      });
      ops.push(O.of(Op.EndText)); ops.push(O.of(Op.PopGraphicsState));
      page.pushOperators.apply(page, ops); pTotal++;
    });
    return { chars: nTotal, lines: pages.reduce(function (a, p) { return a + p.lines.length; }, 0), pages: pTotal, kinds: order.length };
  }

  function norm(s) { return String(s || '').replace(/\s+/g, ''); }
  function pageChars(pdfDoc, n) {
    return pdfDoc.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { try { pg.cleanup(); } catch (e) {} return tc.items.map(function (i) { return i.str || ''; }).join(''); }); });
  }

  // ---------------------------------------------------------------- 쪽 그림 만들기 → 플러그인 → 줄 목록(PDF 좌표)
  function recognizePage(api, plug, n) {
    return api.pdfDoc().getPage(n).then(function (pg) {
      var v1 = pg.getViewport({ scale: 1 }), sc = Math.max(1, Math.min(3, MAX_SIDE_PX / Math.max(v1.width, v1.height)));
      var vp = pg.getViewport({ scale: sc }), cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: g, viewport: vp }).promise.then(function () {
        var url = cv.toDataURL('image/jpeg', 0.88); cv.width = cv.height = 1; try { pg.cleanup(); } catch (e) {}
        return plug.recognize({ image: url.split(',')[1] });
      }).then(function (r) {
        var out = [];
        (r.lines || []).forEach(function (ln) {
          var t = String(ln.t || '').replace(/\s+/g, ' ').trim(); if (!t || !(ln.h >= 4) || !(ln.w >= 4)) return;
          var by = ln.y + ln.h * 0.82, a = vp.convertToPdfPoint(ln.x, by), b = vp.convertToPdfPoint(ln.x + ln.w, by);
          out.push({ t: t, x0: a[0], y0: a[1], x1: b[0], y1: b[1], h: ln.h / sc });
        });
        return out;
      });
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------------------------------------------------------------- 인식 시작
  function run(api) {
    var ctx = api.ctx, plug = plugin();
    if (!plug) { ctx.toast('글자 인식은 폰 앱에서 됩니다. 이 화면(웹)에서는 할 수 없습니다.', 4200); return; }
    var N = api.pageCount(), pdf = api.pdfDoc(), todo = [], i = 0;
    ctx.busy('글자가 없는 쪽을 찾는 중…');
    function scan() {
      if (i >= N) return Promise.resolve();
      i++; return pageChars(pdf, i).then(function (t) { if (norm(t).length < SCAN_CHARS) todo.push(i); }).then(function () { if (i % 8 === 0) return sleep(0); }).then(scan);
    }
    scan().then(function () {
      ctx.busy(null);
      if (!todo.length) { ctx.toast('글자가 그림으로만 들어 있는 쪽이 없습니다. 모든 쪽에 이미 글이 있습니다.', 4200); return; }
      var batch = todo.slice(0, MAX_PAGES_PER_RUN), more = todo.length - batch.length;
      ctx.confirm('글자 인식을 시작할까요?', '글자가 그림으로만 들어 있는 ' + todo.length + '쪽 가운데 ' + batch.length + '쪽을 읽습니다' + (more ? '(한 번에 ' + MAX_PAGES_PER_RUN + '쪽까지, 나머지 ' + more + '쪽은 한 번 더 누르십시오)' : '') + '.\n\n· 폰 안에서만 읽습니다. 문서 그림이 밖으로 나가지 않습니다.\n· 한 쪽에 몇 초 걸립니다. 읽는 동안 화면을 켜 두십시오.\n· 읽은 글은 쪽 위에 보이지 않게 얹혀 검색·복사가 됩니다. 쪽 모양은 그대로이고, 글자를 잘못 읽을 수 있습니다.\n· 사본으로만 저장하고 ↶ 로 되돌릴 수 있습니다.', '인식 시작', function () { go(batch); }, { cancelLabel: '취소' });
    }).catch(function (e) { ctx.busy(null); ctx.toast('쪽을 살피지 못했습니다 — ' + ((e && e.message) || e), 4200); });

    function go(batch) {
      var res = [], k = 0, L, doc, got = 0, empty = 0;
      function step() {
        if (k >= batch.length) return Promise.resolve();
        var n = batch[k++]; ctx.busy('글자를 읽는 중… (' + k + '/' + batch.length + '쪽)');
        return recognizePage(api, plug, n).then(function (lines) { if (lines.length) { res.push({ index: n - 1, lines: lines }); got += lines.length; } else empty++; }).then(function () { return sleep(0); }).then(step);
      }
      step().then(function () {
        if (!res.length) { ctx.busy(null); ctx.toast('읽어 낸 글자가 없습니다(그림이 흐리거나 글이 없는 쪽일 수 있습니다).', 4200); return; }
        ctx.busy('글 층을 넣는 중…');
        return Promise.all([api.loadLib(), api.getBytes()]).then(function (r) { L = r[0]; return L.PDFDocument.load(r[1], { updateMetadata: false }); }).then(function (d) {
          doc = d; var st = addTextLayer(L, doc, res); return doc.save({ useObjectStreams: false }).then(function (out) { return { out: out, st: st }; });
        }).then(function (o) {
          // 저장 전 자체 점검: 쪽 수 같음 + 넣은 글이 다시 읽힘
          return api.pdfjs.getDocument({ data: o.out.slice(), isEvalSupported: false }).promise.then(function (pd) {
            if (pd.numPages !== N) { try { pd.destroy(); } catch (e) {} throw new Error('쪽 수 점검에 실패했습니다'); }
            var bad = 0, ch = Promise.resolve();
            res.forEach(function (p) { ch = ch.then(function () { return pageChars(pd, p.index + 1); }).then(function (t) { var want = norm(p.lines.map(function (l) { return l.t; }).join('')), have = norm(t); if (have.indexOf(want) < 0) bad++; }); });
            return ch.then(function () { try { pd.destroy(); } catch (e) {} if (bad) throw new Error('넣은 글이 다시 읽히지 않는 쪽이 ' + bad + '쪽 있습니다(문서는 바뀌지 않았습니다)'); return o; });
          });
        }).then(function (o) {
          ctx.busy(null);
          return api.applyBytes(o.out, '글자 인식').then(function () { ctx.toast('글자 인식을 마쳤습니다 — ' + o.st.pages + '쪽 · ' + o.st.lines + '줄 · ' + o.st.chars + '자' + (empty ? ' (글을 못 읽은 쪽 ' + empty + '쪽)' : '') + '. 이제 글 찾기·복사가 됩니다. 사본으로 저장하십시오.', 7000); });
        });
      }).catch(function (e) { ctx.busy(null); ctx.toast('글자 인식에 실패했습니다 — ' + ((e && e.message) || e) + ' (문서는 그대로입니다)', 5200); });
    }
  }

  // ---------------------------------------------------------------- 글만 뽑아 보기 (웹에서도 됨)
  function showText(api) {
    var ctx = api.ctx, N = api.pageCount(), pdf = api.pdfDoc(), parts = [], i = 0;
    ctx.busy('글을 뽑는 중…');
    function step() {
      if (i >= N) return Promise.resolve(); i++; var n = i;
      return pdf.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { try { pg.cleanup(); } catch (e) {} var s = ''; tc.items.forEach(function (it) { s += (it.str || '') + (it.hasEOL ? '\n' : ''); }); parts.push('— ' + n + '쪽 —\n' + s.trim()); }); }).then(function () { if (i % 8 === 0) return sleep(0); }).then(step);
    }
    step().then(function () {
      ctx.busy(null);
      var all = parts.join('\n\n'), have = norm(all.replace(/— \d+쪽 —/g, '')).length;
      if (!have) { ctx.toast('뽑을 글이 없습니다. 스캔한 그림 PDF라면 「글자 인식」을 먼저 하십시오.', 4600); return; }
      var body = el('div'), ta = el('textarea'); ta.readOnly = true; ta.value = all; ta.style.cssText = 'width:100%;min-height:46vh;box-sizing:border-box;font:14px/1.6 sans-serif;padding:10px;border:1px solid var(--so-line,#ccc);border-radius:10px;background:var(--so-bg,#fff);color:inherit';
      body.appendChild(el('div', 'so-sheet-note', '글자 ' + have + '자(공백 빼고). 글을 길게 눌러 고르거나 아래 단추로 복사·저장하십시오.')); body.appendChild(ta);
      ctx.sheet({ title: '뽑은 글', body: body, wide: true, buttons: [
        { label: '닫기', onClick: function () {} },
        { label: '복사', onClick: function () { var ok = false; try { ta.select(); ok = document.execCommand('copy'); } catch (e) {} if (!ok && navigator.clipboard) { navigator.clipboard.writeText(all).then(function () { ctx.toast('복사했습니다.', 2000); }, function () { ctx.toast('복사하지 못했습니다.', 2600); }); } else ctx.toast(ok ? '복사했습니다.' : '복사하지 못했습니다.', 2000); return false; } },
        { label: '.txt로 저장', primary: true, onClick: function () { var base = (ctx.name || 'document').replace(/\.pdf$/i, '').replace(/_수정(\(\d+\))?$/, ''); Promise.resolve(ctx.saveCopy(new Blob(['﻿' + all], { type: 'text/plain;charset=utf-8' }), base + '_글.txt', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('글을 저장했습니다.', 2600); }); return false; } }
      ] });
    }).catch(function (e) { ctx.busy(null); ctx.toast('글을 뽑지 못했습니다 — ' + ((e && e.message) || e), 4200); });
  }

  // ---------------------------------------------------------------- 꾸미기 시트 구역
  function extend(api, c, act) {
    var native = !!plugin();
    c.appendChild(el('div', 'so-sheet-note', native
      ? '스캔한 그림 PDF의 글자를 폰 안에서 읽어, 쪽 위에 보이지 않는 글로 얹습니다. 그러면 글 찾기·복사가 되고 아래 「글만 뽑아 보기」로 한꺼번에 볼 수 있습니다. 문서 그림은 밖으로 나가지 않습니다. 글자를 잘못 읽을 수 있습니다.'
      : '글자 인식은 폰 앱에서 됩니다(이 화면에서는 할 수 없습니다). 폰 앱에서 이 문서를 열어 같은 자리에서 누르십시오. 아래 「글만 뽑아 보기」는 여기서도 됩니다.'));
    act(c, '글자 인식 시작', function () { run(api); }, native ? 'on' : '');
    act(c, '글만 뽑아 보기', function () { showText(api); }, '');
  }

  global.SOPdfOcr = { extend: extend, run: run, showText: showText, addTextLayer: addTextLayer, available: function () { return !!plugin(); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SOPdfOcr;
})(typeof window !== 'undefined' ? window : globalThis);

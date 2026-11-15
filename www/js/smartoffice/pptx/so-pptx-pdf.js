/* ============================================================================
 * so-pptx-pdf.js — S-Office 파워포인트 → PDF 내보내기 (O-0861, v10.9 2회차)
 * ----------------------------------------------------------------------------
 * 워드·엑셀 PDF 내보내기와 같은 「그림 방식」: 화면에 그려진 슬라이드를 슬라이드마다 한 장의 그림으로 찍어 PDF 에 담는다.
 *   · 슬라이드 — 슬라이드 한 장이 한 쪽(슬라이드 크기 그대로, 가로)
 *   · 유인물 2·4·6장 — A4 세로 한 쪽에 슬라이드 2·4·6장을 줄지어 놓음(슬라이드 번호를 아래에 적음)
 * 새 부품 없음 — 이미 들어 있는 pdf-lib 만 쓴다. 글자가 그림이라 PDF 에서 글자를 고르거나 검색할 수 없다.
 * 차트·애니메이션·동영상은 그려지는 만큼만 담긴다(차트는 폰 화면의 자체 그림이 슬라이드 편집 화면에서만 보여 PDF 에는 비어 있을 수 있음).
 * ==========================================================================*/
(function (global) {
  'use strict';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function blobToDataUrl(url) {
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); }); });
  }

  // 슬라이드 한 장 → { bytes(JPEG), W, H }  (W·H 는 슬라이드의 화면 크기 px)
  function slideToJpeg(slide, css) {
    var cs = global.getComputedStyle(slide), W = Math.round(parseFloat(cs.width)) || slide.offsetWidth || 960, H = Math.round(parseFloat(cs.height)) || slide.offsetHeight || 540;
    var c = slide.cloneNode(true); c.style.zoom = '1'; c.style.margin = '0'; c.style.boxShadow = 'none'; c.style.transform = 'none'; c.style.width = W + 'px'; c.style.height = H + 'px';
    // 캔버스는 복제되지 않으므로 그림으로 바꿔 넣는다
    var oc = [].slice.call(slide.querySelectorAll('canvas')), cc = [].slice.call(c.querySelectorAll('canvas'));
    oc.forEach(function (cv, i) { try { var im = document.createElement('img'); im.setAttribute('src', cv.toDataURL('image/png')); im.setAttribute('style', cv.getAttribute('style') || ''); im.setAttribute('width', cv.width); im.setAttribute('height', cv.height); if (cc[i] && cc[i].parentNode) cc[i].parentNode.replaceChild(im, cc[i]); } catch (e) {} });
    [].slice.call(c.querySelectorAll('.so-pptx-sel, .so-pptx-edit, [class*=so-pptx-]')).forEach(function (e) { [].slice.call(e.classList).forEach(function (k) { if (/^so-pptx-/.test(k)) e.classList.remove(k); }); });
    var imgs = [].slice.call(c.querySelectorAll('img')), jobs = imgs.map(function (im) { var s = im.getAttribute('src') || ''; return /^blob:/.test(s) ? blobToDataUrl(s).then(function (d) { im.setAttribute('src', d); }, function () {}) : Promise.resolve(); });
    return Promise.all(jobs).then(function () {
      var html = new XMLSerializer().serializeToString(c);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="' + W + '" height="' + H + '"><div xmlns="http://www.w3.org/1999/xhtml" style="width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff"><style>' + css.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>' + html + '</div></foreignObject></svg>';
      return new Promise(function (res, rej) {
        var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('슬라이드를 그림으로 만들지 못했습니다')); };
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
    }).then(function (im) {
      var k = Math.min(2, 1800 / W), cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      return new Promise(function (res, rej) { cv.toBlob(function (b) { if (!b) { rej(new Error('슬라이드 그림을 저장하지 못했습니다')); return; } b.arrayBuffer().then(function (ab) { cv.width = cv.height = 0; res({ bytes: new Uint8Array(ab), W: W, H: H }); }, rej); }, 'image/jpeg', 0.88); });
    });
  }

  var LAYOUTS = { slides: { name: '슬라이드(한 쪽에 한 장)', cols: 1, rows: 1 }, h2: { name: '유인물 2장', cols: 1, rows: 2 }, h4: { name: '유인물 4장', cols: 2, rows: 2 }, h6: { name: '유인물 6장', cols: 2, rows: 3 } };

  function run(env) {
    var ctx = env.ctx, slides = env.slides || [], n = slides.length;
    if (!n) { ctx.toast('내보낼 슬라이드가 없습니다.', 2800); return; }
    if (n > 120) { ctx.toast('슬라이드가 너무 많아(' + n + '장) 폰에서는 내보내지 못합니다(120장까지).', 4600); return; }
    var kind = 'slides', body = el('div', 'spx'), row = el('div', 'spx-r'), note = el('div', 'so-sheet-note'), btns = {};
    Object.keys(LAYOUTS).forEach(function (k) {
      var b = el('button', 'spx-b', LAYOUTS[k].name); b.type = 'button'; b.onclick = function () { kind = k; paint(); }; row.appendChild(b); btns[k] = b;
    });
    function paint() {
      Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('on', kind === k); });
      var L = LAYOUTS[kind], per = L.cols * L.rows, pages = Math.ceil(n / per);
      note.textContent = kind === 'slides' ? '슬라이드 ' + n + '장을 슬라이드 크기 그대로 ' + n + '쪽짜리 PDF로 만듭니다.' : 'A4 세로 한 쪽에 슬라이드 ' + per + '장씩, 모두 ' + pages + '쪽짜리 PDF로 만듭니다(슬라이드 번호가 아래에 적힙니다).';
    }
    body.appendChild(el('div', 'so-sheet-note', '지금 화면에 보이는 슬라이드 모양 그대로 PDF 사본을 만듭니다(원본 문서는 바뀌지 않습니다). 글자가 그림으로 담겨 PDF에서 글자를 고르거나 검색할 수 없고, 차트·애니메이션·동영상은 그려지는 만큼만 담깁니다.'));
    body.appendChild(row); body.appendChild(note); paint();
    ctx.sheet({ title: 'PDF로 내보내기', body: body, buttons: [{ label: '닫기' }, { label: '만들기', primary: true, onClick: function () { setTimeout(function () { build(env, kind); }, 80); } }] });
  }

  function build(env, kind) {
    var ctx = env.ctx, slides = env.slides, n = slides.length, L = LAYOUTS[kind], imgs = [], chain = Promise.resolve();
    var css = [].slice.call((env.stage || document).querySelectorAll('style')).map(function (x) { return x.textContent; }).join('\n');
    ctx.busy('PDF 만드는 중… (0/' + n + ')');
    return ctx.loadScript('vendor/so/pdf/pdf-lib.min.js').then(function () {
      slides.forEach(function (sl, i) {
        chain = chain.then(function () { return sleep(0); }).then(function () { ctx.busy('PDF 만드는 중… (' + (i + 1) + '/' + n + ')'); return slideToJpeg(sl, css).then(function (r) { imgs.push(r); }); });
      });
      return chain;
    }).then(function () {
      var PL = global.PDFLib; return PL.PDFDocument.create().then(function (doc) {
        return doc.embedFont(PL.StandardFonts.Helvetica).then(function (font) {
          var seq = Promise.resolve();
          if (kind === 'slides') {
            imgs.forEach(function (p) { seq = seq.then(function () { return doc.embedJpg(p.bytes).then(function (im) { var w = 720, h = Math.round(720 * p.H / p.W * 100) / 100, pg = doc.addPage([w, h]); pg.drawImage(im, { x: 0, y: 0, width: w, height: h }); }); }); });
          } else {
            var per = L.cols * L.rows, PW = 595.28, PH = 841.89, M = 40, G = 18, LAB = 14, cw = (PW - 2 * M - G * (L.cols - 1)) / L.cols, ch = (PH - 2 * M - G * (L.rows - 1)) / L.rows;
            for (var base = 0; base < imgs.length; base += per) (function (base) {
              seq = seq.then(function () {
                var pg = doc.addPage([PW, PH]), jobs = [];
                for (var k = 0; k < per && base + k < imgs.length; k++) (function (k) {
                  var p = imgs[base + k], col = k % L.cols, rowi = Math.floor(k / L.cols);
                  jobs.push(doc.embedJpg(p.bytes).then(function (im) {
                    var bw = cw, bh = ch - LAB, sc = Math.min(bw / p.W, bh / p.H), w = p.W * sc, h = p.H * sc, x = M + col * (cw + G) + (bw - w) / 2, yTop = PH - M - rowi * (ch + G), y = yTop - h;
                    pg.drawImage(im, { x: x, y: y, width: w, height: h });
                    pg.drawRectangle({ x: x, y: y, width: w, height: h, borderWidth: 0.6, borderColor: PL.rgb(0.6, 0.6, 0.6) });
                    pg.drawText(String(base + k + 1), { x: x, y: y - 11, size: 8.5, font: font, color: PL.rgb(0.35, 0.35, 0.35) });
                  }));
                })(k);
                return Promise.all(jobs);
              });
            })(base);
          }
          return seq.then(function () { return doc.save(); });
        });
      });
    }).then(function (u8) {
      ctx.busy(null);
      var base = String(ctx.name || 'slides').replace(/\.[^.]+$/, '') + (kind === 'slides' ? '' : '_handout' + (L.cols * L.rows));
      return Promise.resolve(ctx.saveCopy(new Blob([u8], { type: 'application/pdf' }), base + '.pdf', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('PDF 사본을 저장했습니다(슬라이드 ' + n + '장). 원래 문서는 그대로입니다.', 3800); });
    }).catch(function (e) { ctx.busy(null); ctx.explainFail('PDF를 만들지 못했습니다(원본은 그대로입니다)', e, 5200); });
  }

  global.SOPptxPdf = { run: run, _t: { slideToJpeg: slideToJpeg } };
})(window);

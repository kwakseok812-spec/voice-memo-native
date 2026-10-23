/* so-docx.js — S-Office 워드(.docx) 보기. 출처: docx-preview 0.4.1 (Apache-2.0, https://github.com/VolodymyrBaydalka/docxjs, Volodymyr Baydalka)
 *   + JSZip 3.10.2 (MIT 선택, https://github.com/Stuk/jszip). 이음오피스 docx-engine 은 쓰지 않았다(보기 전용이라 가벼운 브라우저용 부품이 낫다).
 * 보기 전용. 고치기 없음. .doc(옛 형식)는 열 수 없어 ①로 보낸다. */
(function () {
  'use strict';
  var wrap = null, scale = 1, fit = 1, pageW = 794, ctxRef = null, cleanup = [];

  function applyScale(host) {
    scale = Math.max(0.3, Math.min(4, scale));
    if (wrap) wrap.style.zoom = String(scale);
    var lab = document.getElementById('soDocxZoomLab'); if (lab) lab.textContent = Math.round(scale * 100) + '%';
  }
  function measure(host) {
    var pg = wrap && wrap.querySelector('section.docx');
    pageW = pg ? pg.getBoundingClientRect().width / (wrap.style.zoom ? Number(wrap.style.zoom) || 1 : 1) : 794;
    if (!pageW || pageW < 100) pageW = 794;
    fit = Math.max(0.3, (host.clientWidth - 8) / pageW);
  }
  function setupPinch(host) {
    var d0 = 0, s0 = 1;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    function ts(e) { if (e.touches.length === 2) { d0 = dist(e.touches); s0 = scale; } }
    function tm(e) { if (e.touches.length === 2 && d0) { e.preventDefault(); scale = s0 * dist(e.touches) / d0; applyScale(host); } }
    function te(e) { if (e.touches.length < 2) d0 = 0; }
    host.addEventListener('touchstart', ts, { passive: true });
    host.addEventListener('touchmove', tm, { passive: false });
    host.addEventListener('touchend', te, { passive: true });
    cleanup.push(function () { host.removeEventListener('touchstart', ts); host.removeEventListener('touchmove', tm); host.removeEventListener('touchend', te); });
  }

  SOffice.register({
    id: 'docx', label: '워드', editable: false,
    credits: [
      { name: 'docx-preview', license: 'Apache-2.0', note: '워드 보기 (Volodymyr Baydalka)' },
      { name: 'JSZip', license: 'MIT', note: '압축 풀기' }
    ],
    canOpen: function (ext) { return ext === 'docx'; },
    open: function (ctx) {
      ctxRef = ctx;
      ctx.loadCss('js/smartoffice/docx/so-docx.css');
      return Promise.all([ctx.loadScript('vendor/so/docx/jszip.min.js')]).then(function () {
        return ctx.loadScript('vendor/so/docx/docx-preview.min.js');
      }).then(function () {
        if (!window.docx || !window.docx.renderAsync) throw new Error('워드 부품을 찾지 못함');
        var host = ctx.body;
        host.classList.add('so-docx-host');
        var box = document.createElement('div'); box.className = 'so-docx-box';
        var styleBox = document.createElement('div'); styleBox.style.display = 'none';
        host.appendChild(styleBox); host.appendChild(box);
        wrap = box;
        return window.docx.renderAsync(ctx.file, box, styleBox, {
          className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
          breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true,
          renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false
        }).then(function () {
          var pages = box.querySelectorAll('section.docx').length;
          if (!pages) throw new Error('쪽을 그리지 못함');
          measure(host); scale = Math.min(1, fit); applyScale(host);
          setupPinch(host);
          ctx.setActions([
            { label: '−', onClick: function () { scale *= 0.8; applyScale(host); } },
            { label: '맞춤', onClick: function () { scale = fit; applyScale(host); host.scrollLeft = 0; } },
            { label: '＋', onClick: function () { scale *= 1.25; applyScale(host); } }
          ]);
          var tip = document.createElement('div'); tip.className = 'so-docx-tip';
          tip.innerHTML = '<span id="soDocxZoomLab"></span> · ' + pages + '쪽 · 보기 전용 (두 손가락으로 확대)';
          host.appendChild(tip); applyScale(host);
          setTimeout(function () { if (tip.parentNode) tip.classList.add('hide'); }, 4000);
          var onR = function () { measure(host); };
          window.addEventListener('resize', onR); cleanup.push(function () { window.removeEventListener('resize', onR); });
        });
      });
    },
    close: function () { cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = []; wrap = null; ctxRef = null; }
  });
})();

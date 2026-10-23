/* so-pptx.js — S-Office 파워포인트(.pptx) 보기. 출처: pptx-preview 1.0.7 (npm 표기 라이선스 ISC, https://www.npmjs.com/package/pptx-preview)
 *   + JSZip(MIT)·lodash(MIT)·uuid(MIT)·tslib(0BSD)를 한 파일로 묶음(차트 부품 ECharts 는 뺌 → 차트는 안 그려짐).
 * 보기 전용. 애니메이션·전환·차트·SmartArt 등은 그리지 않는다. .ppt(옛 형식)는 열 수 없어 ①로 보낸다. */
(function () {
  'use strict';
  var cleanup = [], state = null;

  function setup(ctx, buf) {
    var host = ctx.body;
    host.classList.add('so-pptx-host');
    var stage = document.createElement('div'); stage.className = 'so-pptx-stage'; host.appendChild(stage);
    var W = Math.max(240, Math.min(host.clientWidth - 12, 1100));
    var prev = window.pptxPreview.init(stage, { width: W, mode: 'list' });
    return prev.preview(buf).then(function () {
      var wrapper = stage.querySelector('.pptx-preview-wrapper');
      var slides = wrapper ? [].slice.call(wrapper.querySelectorAll('.pptx-preview-slide-wrapper')) : [];
      if (!slides.length) throw new Error('슬라이드를 그리지 못함');
      wrapper.style.background = 'transparent';
      var s = state = { prev: prev, mode: 'list', idx: 0, slides: slides, wrapper: wrapper, scale: 1 };
      var nav = document.createElement('div'); nav.className = 'so-pptx-nav'; host.appendChild(nav);
      nav.innerHTML = '<button type="button" data-d="-1" aria-label="이전">‹</button><span class="so-pptx-pos"></span><button type="button" data-d="1" aria-label="다음">›</button>';
      var pos = nav.querySelector('.so-pptx-pos');
      function render() {
        slides.forEach(function (el, i) { el.style.display = (s.mode === 'list' || i === s.idx) ? '' : 'none'; });
        nav.style.display = s.mode === 'one' ? '' : 'none';
        pos.textContent = (s.idx + 1) + ' / ' + slides.length;
        wrapper.style.zoom = String(s.scale);
        if (s.mode === 'one') host.scrollTop = 0;
        ctx.setActions([
          { label: s.mode === 'list' ? '한 장씩' : '목록', onClick: function () { s.mode = s.mode === 'list' ? 'one' : 'list'; s.scale = 1; render(); } },
          { label: '−', onClick: function () { s.scale = Math.max(0.5, s.scale * 0.8); render(); } },
          { label: '＋', onClick: function () { s.scale = Math.min(3, s.scale * 1.25); render(); } }
        ]);
      }
      function go(d) { s.idx = Math.max(0, Math.min(slides.length - 1, s.idx + d)); render(); }
      nav.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(Number(b.getAttribute('data-d'))); });
      // 한 장씩 모드: 좌우 쓸기
      var x0 = null, y0 = 0;
      function ts(e) { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } else x0 = null; }
      function te(e) { if (x0 == null || s.mode !== 'one' || s.scale > 1.05) return; var t = e.changedTouches[0]; var dx = t.clientX - x0, dy = t.clientY - y0; x0 = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); }
      host.addEventListener('touchstart', ts, { passive: true }); host.addEventListener('touchend', te, { passive: true });
      // 두 손가락 확대
      var d0 = 0, s0 = 1;
      function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
      function ps(e) { if (e.touches.length === 2) { d0 = dist(e.touches); s0 = s.scale; } }
      function pm(e) { if (e.touches.length === 2 && d0) { e.preventDefault(); s.scale = Math.max(0.5, Math.min(3, s0 * dist(e.touches) / d0)); wrapper.style.zoom = String(s.scale); } }
      function pe(e) { if (e.touches.length < 2) d0 = 0; }
      host.addEventListener('touchstart', ps, { passive: true }); host.addEventListener('touchmove', pm, { passive: false }); host.addEventListener('touchend', pe, { passive: true });
      cleanup.push(function () { host.removeEventListener('touchstart', ts); host.removeEventListener('touchend', te); host.removeEventListener('touchstart', ps); host.removeEventListener('touchmove', pm); host.removeEventListener('touchend', pe); });
      var key = function (e) { if (s.mode === 'one') { if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); } };
      document.addEventListener('keydown', key); cleanup.push(function () { document.removeEventListener('keydown', key); });
      var tip = document.createElement('div'); tip.className = 'so-pptx-tip'; tip.textContent = slides.length + '장 · 보기 전용 · 애니메이션·차트는 표시되지 않아요';
      host.appendChild(tip); setTimeout(function () { tip.classList.add('hide'); }, 4500);
      render();
    });
  }

  SOffice.register({
    id: 'pptx', label: '파워포인트', editable: false,
    credits: [
      { name: 'pptx-preview', license: 'ISC', note: '파워포인트 보기' },
      { name: 'JSZip · lodash · uuid', license: 'MIT', note: 'pptx-preview 와 함께 묶음' }
    ],
    canOpen: function (ext) { return ext === 'pptx'; },
    open: function (ctx) {
      ctx.loadCss('js/smartoffice/pptx/so-pptx.css');
      return ctx.loadScript('vendor/so/pptx/pptx-preview.bundle.min.js').then(function () {
        if (!window.pptxPreview || !window.pptxPreview.init) throw new Error('파워포인트 부품을 찾지 못함');
        return ctx.file.arrayBuffer();
      }).then(function (buf) { return setup(ctx, buf); });
    },
    close: function () {
      cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = [];
      try { if (state && state.prev && state.prev.destroy) state.prev.destroy(); } catch (e) {} state = null;
    }
  });
})();

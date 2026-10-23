/* so-pptx.js — S-Office 파워포인트(.pptx) 보기·글자 고치기. 출처: pptx-preview 1.0.7 (npm 표기 라이선스 ISC, https://www.npmjs.com/package/pptx-preview)
 *   + JSZip(MIT)·lodash(MIT)·uuid(MIT)·tslib(0BSD)를 한 파일로 묶음(차트 부품 ECharts 는 뺌 → 차트는 안 그려짐).
 * 글자 고치기는 so-pptx-edit.js(슬라이드 XML 의 글자만 바꿈, 이 앱에서 직접 작성)가 맡는다. 애니메이션·전환·차트·SmartArt 등은 그리지 않는다.
 * .ppt(옛 형식)는 열 수 없어 ①로 보낸다. */
(function () {
  'use strict';
  var cleanup = [], state = null, composing = false;
  var MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function anyEdit(s) { return s.edits.some(function (e) { return Object.keys(e).length > 0; }); }

  // 그림판 다시 그리기(원본 또는 고친 파일). 슬라이드 목록을 s 에 새로 채운다
  function drawDeck(host, s, buf) {
    try { if (s.prev && s.prev.destroy) s.prev.destroy(); } catch (e) {}
    s.stage.innerHTML = '';
    var W = Math.max(240, Math.min(host.clientWidth - 12, 1100));
    s.prev = window.pptxPreview.init(s.stage, { width: W, mode: 'list' });
    return s.prev.preview(buf.slice(0)).then(function () {
      var wrapper = s.stage.querySelector('.pptx-preview-wrapper');
      var slides = wrapper ? [].slice.call(wrapper.querySelectorAll('.pptx-preview-slide-wrapper')) : [];
      if (!slides.length) throw new Error('슬라이드를 그리지 못함');
      wrapper.style.background = 'transparent';
      s.wrapper = wrapper; s.slides = slides; s.idx = Math.min(s.idx, slides.length - 1);
      s.sh = slides[0].offsetHeight || 540; s.drawW = W;
    });
  }

  function setup(ctx, buf) {
    var host = ctx.body;
    host.classList.add('so-pptx-host');
    var stage = document.createElement('div'); stage.className = 'so-pptx-stage'; host.appendChild(stage);
    var s = state = { prev: null, mode: 'list', idx: 0, slides: [], wrapper: null, scale: 1, stage: stage, orig: buf, info: null, edits: [], editing: false, drawnKey: '', panel: null, JSZip: null, sh: 540, drawW: 0, dir: 0 };
    return drawDeck(host, s, buf).then(function () {
      var slides = function () { return s.slides; };
      var hudb = document.createElement('div'); hudb.className = 'so-pptx-hudb'; host.insertBefore(hudb, stage);   // 높이 0 의 떠 있는 줄(문서 자리를 차지하지 않는다). 위쪽에 두고 --soh(화면 높이)로 아래로 내려 그린다
      var nav = document.createElement('div'); nav.className = 'so-pptx-nav'; hudb.appendChild(nav);
      nav.innerHTML = '<button type="button" data-d="-1" aria-label="이전">‹</button><span class="so-pptx-pos"></span><button type="button" data-d="1" aria-label="다음">›</button>';
      var pos = nav.querySelector('.so-pptx-pos');
      var tip = document.createElement('div'); tip.className = 'so-pptx-tip';
      hudb.appendChild(tip);
      function showTip(t, ms) { tip.textContent = t; tip.classList.remove('hide'); clearTimeout(showTip._t); showTip._t = setTimeout(function () { tip.classList.add('hide'); }, ms || 4500); }

      // 한 장씩 볼 때는 슬라이드 한 장이 화면 높이에 다 들어오게(밑의 ‹ › 줄 자리를 뺀다) 기본 크기를 줄인다. 목록은 폭에 맞춰 이미 그렸다
      function baseZoom() {
        if (s.mode !== 'one' || !s.sh) return 1;
        return Math.max(0.3, Math.min(1, (host.clientHeight - 84) / s.sh));
      }
      function applyZoom() {
        host.style.setProperty('--soh', host.clientHeight + 'px');
        var z = baseZoom() * s.scale; s.wrapper.style.zoom = String(z);
        // 한 장씩 볼 때 슬라이드가 화면 높이보다 작으면 위아래 가운데쯤에 놓는다
        stage.style.paddingTop = (s.mode === 'one' && s.scale <= 1.05) ? Math.max(6, Math.round((host.clientHeight - 84 - s.sh * z) / 2)) + 'px' : '';
      }
      // 목록 ↔ 한 장, 이전·다음 장 바뀔 때 0.16초 안의 짧은 전환(움직임 줄이기 설정이면 CSS 에서 꺼진다)
      function playIn() {
        var cls = s.dir > 0 ? 'so-pptx-in-r' : (s.dir < 0 ? 'so-pptx-in-l' : 'so-pptx-in-f');
        s.dir = 0;
        stage.classList.remove('so-pptx-in-r', 'so-pptx-in-l', 'so-pptx-in-f');
        void stage.offsetWidth; stage.classList.add(cls);
        clearTimeout(playIn._t); playIn._t = setTimeout(function () { stage.classList.remove(cls); }, 220);
      }
      function render() {
        s.editing = false;
        if (s.panel) s.panel.style.display = 'none';
        stage.style.display = '';
        slides().forEach(function (el, i) { el.style.display = (s.mode === 'list' || i === s.idx) ? '' : 'none'; });
        nav.style.display = s.mode === 'one' ? '' : 'none';
        pos.textContent = (s.idx + 1) + ' / ' + slides().length;
        applyZoom();
        if (s.mode === 'one') host.scrollTop = 0;
        playIn();
        var acts = [
          { label: s.mode === 'list' ? '한 장' : '목록', onClick: function () { s.mode = s.mode === 'list' ? 'one' : 'list'; s.scale = 1; render(); } },
          { label: '−', onClick: function () { s.scale = Math.max(0.5, s.scale * 0.8); render(); } },
          { label: '＋', onClick: function () { s.scale = Math.min(3, s.scale * 1.25); render(); } },
          { label: '고치기', primary: !anyEdit(s), onClick: enterEdit }
        ];
        if (anyEdit(s)) acts.push({ label: '사본 저장', primary: true, onClick: saveCopy });
        ctx.setActions(acts);
      }
      function go(d) { var n = Math.max(0, Math.min(slides().length - 1, s.idx + d)); if (n === s.idx) return; s.dir = d; s.idx = n; render(); }
      nav.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) go(Number(b.getAttribute('data-d'))); });
      // 한 장씩 모드: 좌우 쓸기
      var x0 = null, y0 = 0;
      function ts(e) { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } else x0 = null; }
      function te(e) { if (x0 == null || s.editing || s.mode !== 'one' || s.scale > 1.05) return; var t = e.changedTouches[0]; var dx = t.clientX - x0, dy = t.clientY - y0; x0 = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1); }
      host.addEventListener('touchstart', ts, { passive: true }); host.addEventListener('touchend', te, { passive: true });
      // 두 손가락 확대
      var d0 = 0, s0 = 1;
      function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
      function ps(e) { if (!s.editing && e.touches.length === 2) { d0 = dist(e.touches); s0 = s.scale; } }
      function pm(e) {
        if (!s.editing && e.touches.length === 2 && d0) {
          e.preventDefault();
          var old = s.scale, r = host.getBoundingClientRect();
          var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
          s.scale = Math.max(0.5, Math.min(3, s0 * dist(e.touches) / d0)); applyZoom();
          var k = s.scale / old; host.scrollLeft = (host.scrollLeft + cx) * k - cx; host.scrollTop = (host.scrollTop + cy) * k - cy;
        }
      }
      function pe(e) { if (e.touches.length < 2) d0 = 0; }
      host.addEventListener('touchstart', ps, { passive: true }); host.addEventListener('touchmove', pm, { passive: false }); host.addEventListener('touchend', pe, { passive: true });
      host.style.touchAction = 'pan-x pan-y';   // 브라우저 자체 확대는 막고 두 손가락 확대는 위 코드가 맡는다 (한 손가락 스크롤과 충돌 없음)
      cleanup.push(function () { host.removeEventListener('touchstart', ts); host.removeEventListener('touchend', te); host.removeEventListener('touchstart', ps); host.removeEventListener('touchmove', pm); host.removeEventListener('touchend', pe); });
      // 폭이 바뀌면(접기·펼치기·가로 돌리기) 슬라이드를 새 폭에 맞춰 다시 그린다. 키보드로 높이만 바뀔 때는 하지 않는다
      var lastW = host.clientWidth, rt = 0;
      function onResize() {
        var w = host.clientWidth;
        if (Math.abs(w - lastW) < 24 || !w) { if (s.mode === 'one' && !s.editing) applyZoom(); return; }
        clearTimeout(rt); rt = setTimeout(function () {
          lastW = host.clientWidth; if (s.editing) { s.stale = true; return; }
          var k = JSON.stringify(s.edits), edited = anyEdit(s) && s.info;
          var p = edited ? window.SOPptxEdit.build(s.info, s.edits).then(function (r) { return r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength); }) : Promise.resolve(s.orig);
          p.then(function (buf) { return drawDeck(host, s, buf); }).then(function () { render(); }, function () {});
        }, 250);
      }
      window.addEventListener('resize', onResize); cleanup.push(function () { window.removeEventListener('resize', onResize); clearTimeout(rt); });
      var key = function (e) { if (!s.editing && s.mode === 'one') { if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); } };
      document.addEventListener('keydown', key); cleanup.push(function () { document.removeEventListener('keydown', key); });

      // ---------------- 글자 고치기 ----------------
      function loadEditor() {
        if (s.info) return Promise.resolve();
        return ctx.loadScript('vendor/so/docx/jszip.min.js').then(function () {
          return ctx.loadScript('js/smartoffice/pptx/so-pptx-edit.js');
        }).then(function () {
          if (!window.JSZip || !window.SOPptxEdit) throw new Error('고치기 부품을 찾지 못함');
          s.JSZip = window.JSZip;
          return window.SOPptxEdit.load(s.orig.slice(0), s.JSZip);
        }).then(function (info) {
          s.info = info; s.edits = info.slides.map(function () { return {}; });
          if (info.slides.length !== s.slides.length) showTip('슬라이드 수가 화면과 달라 일부 미리보기가 어긋날 수 있어요', 6000);
        });
      }
      function enterEdit() {
        ctx.busy('고칠 글자를 찾는 중…');
        loadEditor().then(function () { ctx.busy(null); showEdit(); }, function (e) { ctx.busy(null); ctx.toast('고치기를 열지 못했습니다: ' + ((e && e.message) || e), 4200); });
      }
      function slideTitle(i) {
        var sl = s.info.slides[i], p = sl.paras[0];
        var t = p ? p.text.replace(/\s+/g, ' ').trim() : '(글자 없음)';
        return (i + 1) + '. ' + (t.length > 24 ? t.slice(0, 24) + '…' : t);
      }
      function showEdit() {
        s.editing = true;
        stage.style.display = 'none'; nav.style.display = 'none'; tip.classList.add('hide'); clearTimeout(showTip._t);
        if (!s.panel) { s.panel = document.createElement('div'); s.panel.className = 'so-pe'; host.appendChild(s.panel); }
        s.panel.style.display = '';
        host.scrollTop = 0;
        ctx.onBack(function () { if (s.editing) { leaveEdit(); return true; } return false; });
        if (window.visualViewport && !s.vvOn) {            // 키보드가 올라와 가려지는 높이만큼 아래 여백을 줘서 맨 아래 칸도 키보드 위로 올릴 수 있게
          s.vvOn = true;
          var vf = function () { var vv = window.visualViewport; s.panel.style.paddingBottom = (Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 40) + 'px'; };
          window.visualViewport.addEventListener('resize', vf); window.visualViewport.addEventListener('scroll', vf);
          cleanup.push(function () { window.visualViewport.removeEventListener('resize', vf); window.visualViewport.removeEventListener('scroll', vf); });
        }
        ctx.setActions([
          { label: '보기', onClick: leaveEdit },
          { label: '사본 저장', primary: true, id: 'soPeSave', onClick: saveCopy }
        ]);
        renderEdit();
      }
      function renderEdit() {
        var i = s.idx, sl = s.info.slides[i], ed = s.edits[i], P = s.panel;
        var n = s.info.slides.length;
        var opts = s.info.slides.map(function (x, k) {
          return '<option value="' + k + '"' + (k === i ? ' selected' : '') + '>' + (Object.keys(s.edits[k]).length ? '● ' : '') + esc(slideTitle(k)) + '</option>';
        }).join('');
        var notes = [];
        if (sl.charts) notes.push('차트 ' + sl.charts + '개');
        if (sl.smart) notes.push('SmartArt ' + sl.smart + '개');
        if (sl.pics) notes.push('그림 ' + sl.pics + '개(그림 속 글자 포함)');
        var lockedN = sl.paras.filter(function (p) { return p.locked; }).length;
        var html =
          '<div class="so-pe-top"><button type="button" class="so-pe-nb" data-d="-1" aria-label="이전 장">‹</button>' +
          '<select class="so-pe-sel" aria-label="슬라이드 고르기">' + opts + '</select>' +
          '<button type="button" class="so-pe-nb" data-d="1" aria-label="다음 장">›</button></div>' +
          '<div class="so-pe-prev"></div>' +
          '<div class="so-pe-hint">글자만 고쳐요. 글꼴·색·크기와 그림·도형은 그대로 두고, 한 문단 안에서 바뀐 부분만 반영해요. 줄바꿈은 줄바꿈으로 들어가요.' +
          (notes.length ? '<br>이 장의 ' + esc(notes.join(' · ')) + '는 고칠 수 없어요.' : '') +
          (lockedN ? '<br>자동 숫자(쪽 번호·날짜 등)나 수식이 든 문단 ' + lockedN + '개는 보기만 돼요.' : '') + '</div>' +
          '<div class="so-pe-list"></div>' +
          '<div class="so-pe-foot">' + (i + 1) + ' / ' + n + '장 · 표 안 글자는 고칠 수 있지만 표의 줄·칸은 바꿀 수 없어요 · 슬라이드 추가·삭제·순서 바꾸기는 지원하지 않아요</div>';
        P.innerHTML = html;
        // 미리보기: 지금 화면에 그려진 장을 복사해서 폭에 맞춘다(고친 뒤 「보기」를 누르면 새로 그려짐)
        var pv = P.querySelector('.so-pe-prev'), src = s.slides[i];
        if (src) {
          var clone = src.cloneNode(true); clone.style.display = ''; clone.style.margin = '0';
          pv.appendChild(clone);
          var sw = src.offsetWidth || parseFloat(src.style.width) || 960, cw = Math.max(200, P.clientWidth - 16);
          pv.style.height = 'auto'; clone.style.zoom = String(Math.min(1, cw / sw));
          if (s.drawnKey !== JSON.stringify(s.edits) && anyEdit(s)) pv.insertAdjacentHTML('beforeend', '<div class="so-pe-stale">미리보기는 고치기 전 모습이에요. 「보기」를 누르면 고친 모습으로 다시 그려요.</div>');
        }
        var list = P.querySelector('.so-pe-list');
        if (!sl.paras.length) list.innerHTML = '<div class="so-pe-empty">이 장에는 고칠 수 있는 글자가 없어요.</div>';
        sl.paras.forEach(function (p) {
          var card = document.createElement('div'); card.className = 'so-pe-card';
          var cur = Object.prototype.hasOwnProperty.call(ed, p.ord) ? ed[p.ord] : p.text;
          card.innerHTML = '<div class="so-pe-lab"><span class="so-pe-kind">' + esc(p.kind) + '</span> <span class="so-pe-shape">' + esc(p.shape) + '</span><span class="so-pe-mark">고침</span><button type="button" class="so-pe-undo">되돌리기</button></div>';
          var ta = document.createElement('textarea'); ta.className = 'so-pe-ta'; ta.value = cur; ta.rows = 1; ta.spellcheck = false;
          if (p.locked) { ta.readOnly = true; ta.classList.add('lock'); }
          card.appendChild(ta);
          if (p.locked) card.insertAdjacentHTML('beforeend', '<div class="so-pe-lockmsg">자동 숫자·수식이 들어 있어 보기만 돼요</div>');
          function fit() {
            var vv = window.visualViewport, cap = Math.max(120, Math.round((vv ? vv.height : window.innerHeight) * 0.42));   // 키보드가 올라와도 한 칸이 화면을 다 채우지 않게
            ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 44), cap) + 'px';
          }
          var comp = false;
          ta.addEventListener('compositionstart', function () { comp = true; composing = true; });
          ta.addEventListener('compositionend', function () { comp = false; composing = false; sync(); });
          function sync() { if (ta.value === p.text) delete ed[p.ord]; else ed[p.ord] = ta.value; mark(); fit(); }
          ta.addEventListener('focus', function () { setTimeout(function () { try { card.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {} }, 320); });
          function mark() {
            var ch = Object.prototype.hasOwnProperty.call(ed, p.ord);
            card.classList.toggle('changed', ch);
            ctx.setDirty(anyEdit(s));
          }
          ta.addEventListener('input', sync);
          card.querySelector('.so-pe-undo').addEventListener('click', function () { delete ed[p.ord]; ta.value = p.text; mark(); fit(); });
          list.appendChild(card); mark(); setTimeout(fit, 0);
        });
        ctx.setDirty(anyEdit(s));
        function jump(k) {
          if (composing) { try { document.activeElement.blur(); } catch (e) {} setTimeout(function () { composing = false; jump(k); }, 80); return; }   // 한글 조합 중이면 확정된 뒤에 넘어간다
          s.idx = Math.max(0, Math.min(n - 1, k)); renderEdit(); host.scrollTop = 0;
        }
        P.querySelector('.so-pe-sel').addEventListener('change', function (e) { jump(Number(e.target.value)); });
        [].forEach.call(P.querySelectorAll('.so-pe-nb'), function (b) { b.addEventListener('click', function () { jump(s.idx + Number(b.getAttribute('data-d'))); }); });
      }
      function leaveEdit() {
        var k = JSON.stringify(s.edits);
        if (s.stale && !anyEdit(s)) { s.stale = false; drawDeck(host, s, s.orig).then(function () { render(); }, function () { render(); }); return; }
        if (!s.stale && (!anyEdit(s) || k === s.drawnKey)) { render(); return; }
        s.stale = false;
        ctx.busy('고친 모습으로 다시 그리는 중…');
        window.SOPptxEdit.build(s.info, s.edits).then(function (r) {
          return drawDeck(host, s, r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength));
        }).then(function () { s.drawnKey = k; ctx.busy(null); s.mode = 'one'; render(); }, function (e) {
          ctx.busy(null); ctx.toast('다시 그리지 못했습니다: ' + ((e && e.message) || e), 4200);
          drawDeck(host, s, s.orig).then(function () { render(); }, function () { render(); });
        });
      }
      function saveCopy() {
        if (!s.info || !anyEdit(s)) { ctx.toast('아직 고친 곳이 없어요.'); return; }
        var name = (ctx.name || 'slides.pptx').replace(/\.pptx$/i, '') + '_수정.pptx';
        ctx.confirmCopy('사본으로 저장', '고친 글자를 담아 「' + name + '」로 저장합니다.\n글꼴·그림·도형·애니메이션은 그대로 두고 글자만 바꿉니다. 원본은 바꾸지 않습니다.', '저장하기', function () {
          ctx.busy('사본을 만드는 중…');
          window.SOPptxEdit.build(s.info, s.edits).then(function (r) {
            return window.SOPptxEdit.verify(s.orig, r.bytes, r.changed, s.JSZip).then(function (v) {
              if (!v.ok) throw new Error('검사에서 걸렸어요 (' + v.why + ') — 저장하지 않았습니다');
              ctx.busy(null);
              ctx.saveCopy(new Blob([r.bytes], { type: MIME }), name);
              ctx.toast('사본을 만들었어요 (고친 슬라이드 ' + r.changed.length + '장, 나머지 ' + v.untouched + '개 파일은 원본과 같음)', 4200);
            });
          }).catch(function (e) { ctx.busy(null); ctx.toast('저장하지 못했습니다: ' + ((e && e.message) || e), 5000); });
        });
      }

      showTip(slides().length + '장 · 「고치기」로 글자를 고칠 수 있어요 · 애니메이션·차트는 화면에 표시되지 않아요');
      render();
    });
  }

  SOffice.register({
    id: 'pptx', label: '파워포인트', editable: true,
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

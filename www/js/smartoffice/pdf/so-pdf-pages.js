/* ============================================================================
 * so-pdf-pages.js — S-Office PDF 편집 보강(O-0861, v10.3): 쪽 정리(순서·삭제·회전) · 합치기 · 나누기 · 양식 칸 채우기
 * ----------------------------------------------------------------------------
 * so-pdf.js 가 스위치(SO_PDF_PAGES)가 켜졌을 때만 불러온다. 새 부품 없음 — 이미 들어 있는 pdf-lib(MIT)와 PDF.js(보기)만 쓴다.
 *   · 쪽 순서·삭제·회전은 「원본 문서 안에서 쪽을 빼고 같은 쪽을 다시 끼우는」 방식이다(새 문서에 복사하지 않는다) —
 *     그래야 입력 칸(양식)·목차·링크가 그대로 산다(0단계 시험). 지운 쪽의 내용은 파일에서 비우고 안 쓰는 부분은 정리해, 지운 쪽이 파일 속에 남지 않게 한다.
 *   · 합치기(다른 PDF의 쪽을 붙임) · 나누기(고른 쪽만 새 PDF)는 새로 복사하므로 붙인/나눈 쪽의 입력 칸·목차는 사라진다 → 저장 전 안내.
 *   · 양식 칸 채우기: PDF의 입력 칸 사각형을 읽어, 쓴 글(한글 포함)을 그림으로 그려 그 자리에 박는다(칸 자체는 비워 둠). 글꼴을 들이지 않는다.
 *   · 전자서명이 든 PDF는 다시 쓰면 서명이 무효가 되므로 쪽 정리·양식 채우기를 막고 「수정 요청」으로 안내한다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FAMILY = 'Helvetica, Arial, "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cols() { var w = global.innerWidth; return w >= 900 ? 6 : (w >= 640 ? 5 : 3); }
  function perRow() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }

  // ---- 문서 정보(입력 칸 · 목차 · 전자서명) — 구현 첫 단계에서 pdf-lib 로 읽는다 ----
  function readInfo(api) {
    return Promise.all([api.loadLib(), api.getBytes()]).then(function (r) {
      var L = r[0];
      return L.PDFDocument.load(r[1], { updateMetadata: false, ignoreEncryption: false }).then(function (doc) {
        var info = { hasForm: false, hasOutline: false, signed: false };
        try { info.hasOutline = doc.catalog.has(L.PDFName.of('Outlines')); } catch (e) {}
        try {
          var form = doc.getForm(), fs = form.getFields();
          info.hasForm = fs.length > 0;
          fs.forEach(function (f) { if (f instanceof L.PDFSignature) { try { if (f.acroField.dict.has(L.PDFName.of('V'))) info.signed = true; } catch (e) {} } });
        } catch (e) {}
        try { var perms = doc.catalog.get(L.PDFName.of('Perms')); if (perms) info.signed = true; } catch (e) {}
        return info;
      });
    });
  }
  function signedBlock(api) {
    var body = el('div'); body.appendChild(el('div', '', '이 PDF에는 전자서명이 들어 있어서 고치면 서명이 무효가 됩니다. 폰에서는 고치지 않고 「수정 요청」으로 보내 주십시오.'));
    api.ctx.sheet({ title: '전자서명이 든 PDF입니다', body: body, buttons: [{ label: '닫기' }].concat(api.ctx.fixAvail() ? [{ label: '수정 요청', primary: true, onClick: function () { setTimeout(function () { api.ctx.requestFix(); }, 80); return true; } }] : []) });
  }
  // 입력 칸·목차를 잃을 때(합치기·나누기) 저장 전 안내 — 문서 안에 있을 때만 보인다
  function lossNote(info, what) {
    var parts = []; if (info.hasForm) parts.push('입력 칸'); if (info.hasOutline) parts.push('목차(차례)');
    var josa = info.hasOutline ? '가' : '이';
    return parts.length ? ('이 PDF에는 ' + parts.join('과 ') + josa + ' 있습니다. ' + what + '입력 칸과 목차는 사라집니다.') : '';
  }

  // ============================== 쪽 정리 화면 ==============================
  function openPages(api) {
    var ctx = api.ctx, root = api.root;
    if (root.querySelector('.spp')) return;
    function start() {
      ctx.busy('문서를 확인하는 중…');
      readInfo(api).catch(function () { return { hasForm: false, hasOutline: false, signed: false, unknown: true }; }).then(function (info) {
        if (info.signed) { ctx.busy(null); signedBlock(api); return; }
        var flat = api.hasAnns() ? (ctx.busy('넣은 것을 문서에 합치는 중…'), api.flattenAnns()) : Promise.resolve(false);
        return flat.then(function () { ctx.busy(null); build(api, info); });
      }).catch(function (e) { ctx.busy(null); ctx.toast('쪽 정리를 열지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    }
    if (api.hasAnns()) ctx.confirm('넣은 것이 있습니다', '넣은 형광펜·글·서명을 먼저 문서에 합친 뒤 쪽 정리를 합니다. 합친 뒤에도 「되돌리기」로 취소할 수 있습니다.', '문서에 합치고 쪽 정리', start, { cancelLabel: '취소' });
    else start();
  }

  function build(api, info) {
    var ctx = api.ctx, pdfjs = api.pdfjs, N = api.pageCount();
    var items = [], hist = [], sel = {}, exts = [], thumbs = {}, destroyed = false, drag = null, io = null;
    for (var i = 0; i < N; i++) items.push({ k: 'm', i: i, rot: 0 });
    var back = el('div', 'spp'), bar = el('div', 'spp-bar'), grid = el('div', 'spp-grid'), foot = el('div', 'spp-foot');
    var tt = el('div', 'spp-t'), btnC = el('button', 'spp-hb', '취소'), btnU = el('button', 'spp-hb', '↶'), btnOk = el('button', 'spp-hb ok', '적용');
    [btnC, btnU, btnOk].forEach(function (b) { b.type = 'button'; });
    btnU.setAttribute('aria-label', '되돌리기');
    bar.appendChild(btnC); bar.appendChild(tt); bar.appendChild(btnU); bar.appendChild(btnOk);
    var hint = el('div', 'spp-hint', '쪽을 눌러 고르고, 꾹 눌러 끌면 순서가 바뀝니다');
    back.appendChild(bar); back.appendChild(hint); back.appendChild(grid); back.appendChild(foot);
    api.root.appendChild(back);

    function snap() { return JSON.stringify(items); }
    function push() { hist.push(snap()); if (hist.length > 40) hist.shift(); btnU.disabled = false; }
    function changed() { return snap() !== JSON.stringify(items0()); }
    function items0() { var a = []; for (var i = 0; i < N; i++) a.push({ k: 'm', i: i, rot: 0 }); return a; }
    function selIdx() { var a = []; items.forEach(function (it, idx) { if (sel[idx]) a.push(idx); }); return a; }

    // ---- 그리기 ----
    function docOf(it) { return it.k === 'm' ? api.pdfDoc() : exts[it.d].pdf; }
    function drawThumb(cell, it) {
      var host = cell.querySelector('.spp-th');
      var token = it.k + (it.d == null ? '' : it.d) + ':' + it.i;
      if (host.getAttribute('data-t') === token) return;
      host.setAttribute('data-t', token);
      docOf(it).getPage(it.i + 1).then(function (pg) {
        if (destroyed) return;
        var vp0 = pg.getViewport({ scale: 1 }), w = Math.max(80, Math.min(240, cell.clientWidth || 110)) * Math.min(2, global.devicePixelRatio || 1);
        var vp = pg.getViewport({ scale: w / vp0.width });
        var cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () {
          if (destroyed || host.getAttribute('data-t') !== token) { cv.width = 0; return; }
          host.innerHTML = ''; host.appendChild(cv); try { pg.cleanup(); } catch (e) {}
          host._ratio = vp.width / vp.height; applyRot(cell, it);
        });
      }).catch(function () {});
    }
    function applyRot(cell, it) {
      var host = cell.querySelector('.spp-th'), cv = host.firstChild; if (!cv || cv.tagName !== 'CANVAS') return;
      var base = it.rot % 360, r = host._ratio || 0.7, w = Math.max(40, cell.clientWidth - 8), ch = w / r, turned = base % 180 !== 0;
      host.style.height = Math.round(turned ? w * r : ch) + 'px';
      cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(ch) + 'px';
      cv.style.marginTop = (-Math.round(ch / 2)) + 'px';
      cv.style.transform = 'rotate(' + base + 'deg)' + (turned ? ' scale(' + r + ')' : '');
    }
    function render() {
      grid.innerHTML = ''; grid.style.gridTemplateColumns = 'repeat(' + cols() + ',1fr)';
      items.forEach(function (it, idx) {
        var c = el('div', 'spp-cell' + (sel[idx] ? ' sel' : '') + (it.k === 'x' ? ' ext' : '')); c.setAttribute('data-i', idx); c.setAttribute('role', 'button');
        c.setAttribute('aria-label', (idx + 1) + '쪽' + (sel[idx] ? ' 선택됨' : ''));
        var th = el('div', 'spp-th'); th.appendChild(el('i', 'spp-ph', '…')); c.appendChild(th);
        c.appendChild(el('b', 'spp-n', String(idx + 1)));
        var ck = el('span', 'spp-ck', '✓'); c.appendChild(ck);
        if (it.rot) c.appendChild(el('span', 'spp-rot', '↻' + it.rot));
        grid.appendChild(c); bindCell(c, idx);
      });
      tt.textContent = '쪽 정리 · ' + items.length + '쪽' + (selIdx().length ? ' · ' + selIdx().length + '쪽 고름' : '');
      btnOk.disabled = !changed() || !items.length; btnU.disabled = !hist.length;
      if (io) io.disconnect();
      io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { var i = +en.target.getAttribute('data-i'); drawThumb(en.target, items[i]); } }); }, { root: grid, rootMargin: '200px' });
      [].slice.call(grid.children).forEach(function (c) { io.observe(c); });
      renderFoot();
    }
    function renderFoot() {
      foot.innerHTML = '';
      var any = selIdx().length > 0;
      [['↻', '회전', rotate, any], ['🗑', '쪽 지우기', del, any], ['◀', '앞으로', function () { move(-1); }, any], ['▶', '뒤로', function () { move(1); }, any], ['＋', '합치기', merge, true], ['✂', '나누기', split, any]].forEach(function (d) {
        var b = el('button', 'spp-fb'); b.type = 'button'; b.disabled = !d[3]; b.appendChild(el('span', 't-g', d[0])); b.appendChild(el('span', 't-l', d[1])); b.onclick = d[2]; foot.appendChild(b);
      });
    }

    // ---- 고르기 · 끌어서 순서 바꾸기(꾹 눌러 집기) ----
    function bindCell(c, idx) {
      var timer = 0, startX = 0, startY = 0, moved = false, lifted = false, pid = null;
      c.addEventListener('pointerdown', function (e) {
        if (!e.isPrimary || (e.button != null && e.button > 0)) return;
        startX = e.clientX; startY = e.clientY; moved = false; lifted = false; pid = e.pointerId;
        clearTimeout(timer);
        timer = setTimeout(function () { lifted = true; drag = { from: idx, to: idx, cell: c }; c.classList.add('lift'); try { c.setPointerCapture(pid); } catch (x) {} if (global.navigator.vibrate) { try { global.navigator.vibrate(12); } catch (x) {} } }, 380);
      });
      c.addEventListener('pointermove', function (e) {
        if (!e.isPrimary) return;
        if (!lifted) { if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 8) { moved = true; clearTimeout(timer); } return; }
        e.preventDefault(); moved = true;
        c.style.transform = 'translate(' + (e.clientX - startX) + 'px,' + (e.clientY - startY) + 'px) scale(1.06)';
        c.style.pointerEvents = 'none';
        var t = document.elementFromPoint(e.clientX, e.clientY); c.style.pointerEvents = '';
        var tc = t && t.closest ? t.closest('.spp-cell') : null; if (tc) { drag.to = +tc.getAttribute('data-i'); [].slice.call(grid.children).forEach(function (g) { g.classList.toggle('drop', g === tc && g !== c); }); }
        var gr = grid.getBoundingClientRect(); if (e.clientY < gr.top + 50) grid.scrollTop -= 14; else if (e.clientY > gr.bottom - 50) grid.scrollTop += 14;   // 가장자리에서 자동으로 넘김
      });
      function end(e) {
        clearTimeout(timer);
        if (lifted && drag) {
          var from = drag.from, to = drag.to; drag = null; c.classList.remove('lift'); c.style.transform = '';
          if (to !== from) { push(); var it = items.splice(from, 1)[0]; items.splice(to, 0, it); var ns = {}; ns[to] = true; sel = ns; }
          render(); return;
        }
        if (e.type === 'pointerup' && !moved) { sel[idx] = !sel[idx]; if (!sel[idx]) delete sel[idx]; c.classList.toggle('sel', !!sel[idx]); tt.textContent = '쪽 정리 · ' + items.length + '쪽' + (selIdx().length ? ' · ' + selIdx().length + '쪽 고름' : ''); renderFoot(); }
      }
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    grid.addEventListener('touchmove', function (e) { if (drag) e.preventDefault(); }, { passive: false });

    // ---- 동작 ----
    function need() { if (!selIdx().length) { ctx.toast('먼저 쪽을 눌러 고르십시오.', 2200); return false; } return true; }
    function rotate() { if (!need()) return; push(); selIdx().forEach(function (i) { items[i].rot = (items[i].rot + 90) % 360; }); render(); ctx.toast('오른쪽으로 돌렸습니다', 1600); }
    function del() {
      if (!need()) return; var s = selIdx();
      if (s.length >= items.length) { ctx.toast('모든 쪽을 지울 수는 없습니다.', 2600); return; }
      push(); items = items.filter(function (_, i) { return !sel[i]; }); sel = {}; render(); ctx.toast(s.length + '쪽을 지웠습니다(적용 전에는 되돌릴 수 있습니다)', 2600);
    }
    function move(d) {
      if (!need()) return; var s = selIdx(); if (d < 0 ? s[0] === 0 : s[s.length - 1] === items.length - 1) { ctx.toast('더 갈 곳이 없습니다.', 1600); return; }
      push(); var ns = {};
      if (d < 0) { s.forEach(function (i) { var it = items.splice(i, 1)[0]; items.splice(i - 1, 0, it); ns[i - 1] = true; }); }
      else { s.slice().reverse().forEach(function (i) { var it = items.splice(i, 1)[0]; items.splice(i + 1, 0, it); ns[i + 1] = true; }); }
      sel = ns; render();
      var c0 = grid.children[Object.keys(ns)[0]]; if (c0 && c0.scrollIntoView) { try { c0.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    }
    btnU.onclick = function () { if (!hist.length) return; items = JSON.parse(hist.pop()); sel = {}; render(); };
    // 합치기: 다른 PDF 의 쪽을 고른 쪽 뒤(없으면 맨 끝)에 붙인다
    function merge() {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.style.display = 'none';
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (inp.parentNode) inp.parentNode.removeChild(inp); if (!f) return;
        ctx.busy('붙일 PDF를 읽는 중…');
        f.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise.then(function (pd) {
            return api.loadLib().then(function (L) { return L.PDFDocument.load(bytes.slice(), { updateMetadata: false }); }).then(function (ld) {
              var inf = { hasForm: false, hasOutline: false };
              try { inf.hasOutline = ld.catalog.has(api.PDFName('Outlines')); } catch (e) {} try { inf.hasForm = ld.getForm().getFields().length > 0; } catch (e) {}
              return { pd: pd, bytes: bytes, inf: inf, name: f.name };
            });
          });
        }).then(function (x) {
          ctx.busy(null);
          var note = lossNote(x.inf, '붙이는 쪽의 ');
          var go = function () {
            var d = exts.push({ pdf: x.pd, bytes: x.bytes, name: x.name }) - 1, s = selIdx(), at = s.length ? s[s.length - 1] + 1 : items.length;
            push(); var add = []; for (var i = 0; i < x.pd.numPages; i++) add.push({ k: 'x', d: d, i: i, rot: 0 });
            items.splice.apply(items, [at, 0].concat(add)); sel = {}; add.forEach(function (_, j) { sel[at + j] = true; }); render();
            ctx.toast(x.pd.numPages + '쪽을 붙였습니다', 2200);
          };
          if (note) ctx.confirm('붙이기 전에 알려 드립니다', note, '그래도 붙이기', go, { cancelLabel: '취소' }); else go();
        }).catch(function (e) { ctx.busy(null); ctx.toast('PDF를 붙이지 못했습니다 — ' + ((e && e.message) || '읽을 수 없는 파일'), 4200); });
      };
      document.body.appendChild(inp); inp.click();
    }
    // 나누기: 고른 쪽만 새 PDF 로 저장(지금 화면의 쪽 정리 결과 기준, 원래 문서는 그대로)
    function split() {
      if (!need()) return; var s = selIdx();
      var note = lossNote(info, '새 파일에는 ');
      var go = function () {
        ctx.busy('고른 쪽으로 새 파일을 만드는 중…');
        build_(s).then(function (out) {
          ctx.busy(null);
          var name = ctx.name.replace(/\.pdf$/i, '') + '_쪽' + (s.length === 1 ? (s[0] + 1) : (s[0] + 1) + '-' + (s[s.length - 1] + 1)) + '.pdf';
          return ctx.saveCopy(new Blob([out], { type: 'application/pdf' }), name, { exact: true }).then(function (ok) { if (ok !== false) ctx.toast('고른 ' + s.length + '쪽을 새 파일로 저장했습니다(지금 화면은 그대로)', 3200); });
        }).catch(function (e) { ctx.busy(null); ctx.toast('나누지 못했습니다 — ' + ((e && e.message) || e), 4200); });
      };
      ctx.noticeThen(function () { if (note) ctx.confirm('나누기 전에 알려 드립니다', note, '그래도 나누기', go, { cancelLabel: '취소' }); else go(); });
    }
    function build_(idxs) {      // 고른 쪽(회전 포함)만으로 새 문서
      return api.loadLib().then(function (L) {
        return api.getBytes().then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (src) {
          var out, extDocs = {};
          return L.PDFDocument.create().then(function (o) {
            out = o; var chain = Promise.resolve();
            idxs.forEach(function (ix) {
              var it = items[ix];
              chain = chain.then(function () {
                if (it.k === 'm') return out.copyPages(src, [it.i]);
                return (extDocs[it.d] ? Promise.resolve(extDocs[it.d]) : L.PDFDocument.load(exts[it.d].bytes, { updateMetadata: false }).then(function (d) { extDocs[it.d] = d; return d; })).then(function (d) { return out.copyPages(d, [it.i]); });
              }).then(function (cp) { var pg = cp[0]; if (it.rot) pg.setRotation(L.degrees(((pg.getRotation().angle || 0) + it.rot) % 360)); out.addPage(pg); });
            });
            return chain;
          }).then(function () { return out.save(); });
        });
      });
    }

    // ---- 적용: 원본 문서 안에서 쪽을 빼고 같은 쪽을 다시 끼운다 ----
    function applyAll() {
      ctx.busy('쪽을 정리하는 중…');
      var L;
      return api.loadLib().then(function (l) { L = l; return api.getBytes(); }).then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (src) {
        var pages = src.getPages(), n = pages.length, used = {}, extLoaded = {}, chain = Promise.resolve(), pick = new Array(items.length);
        items.forEach(function (it, pos) { if (it.k === 'm') { used[it.i] = true; pick[pos] = pages[it.i]; } });
        var extWant = {}; items.forEach(function (it, pos) { if (it.k === 'x') (extWant[it.d] = extWant[it.d] || []).push([pos, it.i]); });
        Object.keys(extWant).forEach(function (d) {
          chain = chain.then(function () { return L.PDFDocument.load(exts[d].bytes, { updateMetadata: false }); }).then(function (ed) { return src.copyPages(ed, extWant[d].map(function (x) { return x[1]; })); }).then(function (cp) { extWant[d].forEach(function (x, j) { pick[x[0]] = cp[j]; }); });
        });
        return chain.then(function () {
          var removed = []; pages.forEach(function (pg, i) { if (!used[i]) removed.push(pg); });
          for (var i = n - 1; i >= 0; i--) src.removePage(i);
          items.forEach(function (it, pos) { var pg = pick[pos]; if (it.rot) pg.setRotation(L.degrees(((pg.getRotation().angle || 0) + it.rot) % 360)); src.insertPage(pos, pg); });
          return { src: src, removed: removed, L: L };
        });
      }).then(function (r) {
        purge(r.L, r.src, r.removed);
        return r.src.save().then(function (out1) {
          // 안 쓰는 부분 정리(GC)는 점검에 통과할 때만 쓴다 — 지운 쪽의 그림·글이 파일에 남지 않게
          var tried = Promise.resolve(out1);
          return Promise.all([L.PDFDocument.load(out1, { updateMetadata: false })]).then(function (x) {
            var d2 = x[0]; gc(L, d2);
            return d2.save().then(function (out2) { return verify(out2, items.length).then(function (ok) { return ok ? out2 : out1; }, function () { return out1; }); });
          }).catch(function () { return out1; }).then(function (best) { return verify(best, items.length).then(function () { return best; }); });
        });
      }).then(function (out) { return api.applyBytes(out, '쪽 정리'); });
    }
    function verify(bytes, expect) {
      return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise.then(function (d) { var ok = d.numPages === expect; try { d.destroy(); } catch (e) {} if (!ok) throw new Error('쪽 수 점검 실패'); return true; });
    }
    function purge(L, doc, removed) {          // 지운 쪽의 내용·자원·주석을 비운다(목차·링크가 가리키는 빈 쪽만 남을 수 있다)
      var ctxx = doc.context, N = L.PDFName;
      removed.forEach(function (pg) {
        try {
          var d = pg.node; d.set(N.of('Contents'), ctxx.register(ctxx.stream(new Uint8Array(0))));
          ['Resources', 'Annots', 'Thumb', 'Metadata', 'PieceInfo'].forEach(function (k) { try { d.delete(N.of(k)); } catch (e) {} });
        } catch (e) {}
      });
    }
    function gc(L, doc) {                      // 문서 뿌리에서 닿지 않는 개체를 지운다(반복문 — 목차가 길어도 안전)
      var c = doc.context, seen = {}, stack = [];
      ['Root', 'Info', 'Encrypt'].forEach(function (k) { var v = c.trailerInfo[k]; if (v) stack.push(v); });
      while (stack.length) {
        var o = stack.pop(); if (!o) continue;
        if (o instanceof L.PDFRef) { var key = o.toString(); if (seen[key]) continue; seen[key] = 1; var t = c.lookup(o); if (t) stack.push(t); }
        else if (o instanceof L.PDFDict) { o.entries().forEach(function (e) { stack.push(e[1]); }); }
        else if (o instanceof L.PDFArray) { for (var i = 0; i < o.size(); i++) stack.push(o.get(i)); }
        else if (o instanceof L.PDFStream) { stack.push(o.dict); }
      }
      c.enumerateIndirectObjects().forEach(function (e) { if (!seen[e[0].toString()]) c.delete(e[0]); });
    }

    function close() {
      destroyed = true; if (io) io.disconnect();
      exts.forEach(function (x) { try { x.pdf.destroy(); } catch (e) {} });
      if (back.parentNode) back.parentNode.removeChild(back);
      api.pagesClosed();
    }
    btnC.onclick = function () { if (changed()) ctx.confirm('정리한 내용을 버리시겠습니까?', '적용하지 않고 닫으면 지금까지 정리한 것이 사라집니다.', '버리고 닫기', close, { danger: true, cancelLabel: '계속 정리' }); else close(); };
    btnOk.onclick = function () {
      if (btnOk.disabled) return;
      var s = items.filter(function (it) { return it.k === 'x'; });
      var go = function () {
        applyAll().then(function () { ctx.busy(null); close(); ctx.toast('쪽을 정리했습니다(' + items.length + '쪽). 저장은 「사본 저장」으로 하십시오.', 3600); }).catch(function (e) { ctx.busy(null); ctx.toast('쪽 정리를 적용하지 못했습니다 — ' + ((e && e.message) || e), 5200); });
      };
      go();
    };
    api.onPagesBack(function () { btnC.onclick(); return true; });
    render();
  }

  // ============================== 양식 칸 채우기 ==============================
  // PDF.js 가 읽어 주는 입력 칸(Widget)의 사각형을 쪽 위에 표시하고, 누르면 글을 적게 한다. 적은 글은 그림으로 그 자리에 박는다.
  function fillPng(text, w, h) {
    var k = 3, size = Math.max(7, Math.min(16, h * 0.7)), cv = document.createElement('canvas'), g;
    function lay() { g = cv.getContext('2d'); g.font = size + 'px ' + FAMILY; return g.measureText(text).width; }
    cv.width = 4; cv.height = 4; var tw = lay();
    while (tw > w - 4 && size > 6) { size -= 0.5; tw = lay(); }
    cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k); g = cv.getContext('2d'); g.scale(k, k);
    g.font = size + 'px ' + FAMILY; g.fillStyle = '#111'; g.textBaseline = 'middle'; g.fillText(text, 2, h / 2 + 0.5);
    return cv.toDataURL('image/png');
  }
  function checkPng(w, h) {
    var k = 3, cv = document.createElement('canvas'); cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k);
    var g = cv.getContext('2d'); g.scale(k, k); g.strokeStyle = '#111'; g.lineWidth = Math.max(1.4, Math.min(w, h) * 0.12); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(w * 0.2, h * 0.55); g.lineTo(w * 0.42, h * 0.78); g.lineTo(w * 0.82, h * 0.24); g.stroke();
    return cv.toDataURL('image/png');
  }
  function formMode(api) {
    var ctx = api.ctx;
    if (api.formOn()) { api.formStop(); return; }
    ctx.busy('입력 칸을 찾는 중…');
    readInfo(api).catch(function () { return { signed: false }; }).then(function (info) {
      ctx.busy(null);
      if (info.signed) { signedBlock(api); return; }
      return collectWidgets(api).then(function (list) {
        if (!list.length) { ctx.toast('이 PDF에는 채울 입력 칸이 없습니다. 「글」 도구로 원하는 자리에 글을 넣을 수 있습니다.', 4200); return; }
        api.formStart(list, function (w, a) { onWidget(api, w, a); });
        ctx.toast('칸을 눌러 글을 적어 보십시오(' + list.length + '칸)', 3000);
      });
    }).catch(function (e) { ctx.busy(null); ctx.toast('입력 칸을 읽지 못했습니다 — ' + ((e && e.message) || e), 4200); });
  }
  function collectWidgets(api) {
    var pdf = api.pdfDoc(), n = api.pageCount(), out = [], chain = Promise.resolve();
    for (var p = 1; p <= n; p++) (function (p) {
      chain = chain.then(function () { return pdf.getPage(p); }).then(function (pg) {
        var vp = pg.getViewport({ scale: 1 });
        return pg.getAnnotations({ intent: 'display' }).then(function (an) {
          an.forEach(function (a) {
            if (a.subtype !== 'Widget' || !a.rect || a.readOnly) return;
            var r = vp.convertToViewportRectangle(a.rect), x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
            if (w < 4 || h < 4) return;
            var kind = a.fieldType === 'Tx' ? 'text' : (a.fieldType === 'Btn' && !a.pushButton ? 'check' : (a.fieldType === 'Sig' ? 'sig' : (a.fieldType === 'Ch' ? 'text' : '')));
            if (!kind) return;
            out.push({ page: p, x: x, y: y, w: w, h: h, kind: kind, name: a.fieldName || '', id: p + ':' + (a.id || out.length) });
          });
          try { pg.cleanup(); } catch (e) {}
        });
      });
    })(p);
    return chain.then(function () { return out; });
  }
  function onWidget(api, w, existing) {
    var ctx = api.ctx;
    if (w.kind === 'sig') { ctx.toast('서명 칸은 폰에서 채울 수 없습니다. 「서명」 도구로 그림 서명을 원하는 자리에 넣을 수 있습니다.', 4200); return; }
    if (w.kind === 'check') {
      if (existing) { api.removeFill(existing); ctx.toast('체크를 지웠습니다', 1600); } else { api.addFill(w, checkPng(w.w, w.h), { check: true }); ctx.toast('체크했습니다', 1600); }
      return;
    }
    var body = el('div'), ta = el(w.h > 28 ? 'textarea' : 'input', 'sp-ta'); if (w.h <= 28) ta.type = 'text'; else ta.rows = 3;
    ta.value = existing && existing.fill ? existing.fill.text : ''; ta.placeholder = '이 칸에 넣을 글';
    body.appendChild(ta); body.appendChild(el('div', 'so-sheet-note', '채운 뒤에는 칸에서 다시 고칠 수 없고 글 검색·복사가 안 됩니다(저장 전에는 되돌릴 수 있습니다).'));
    ctx.sheet({
      title: '칸에 글 넣기', body: body, keep: function () { return ta.value !== (existing && existing.fill ? existing.fill.text : ''); },
      buttons: [{ label: '취소' }].concat(existing ? [{ label: '지우기', danger: true, onClick: function () { api.removeFill(existing); return true; } }] : []).concat([{
        label: '넣기', primary: true, onClick: function () {
          var t = ta.value.replace(/\s+$/, '').replace(/\n/g, ' ');
          if (!t) { ctx.toast('넣을 글을 먼저 적어 주십시오.', 1800); return false; }
          if (existing) api.removeFill(existing, true);
          api.addFill(w, fillPng(t, w.w, w.h), { text: t });
          return true;
        } }])
    });
    setTimeout(function () { try { ta.focus({ preventScroll: true }); } catch (e) {} }, 220);
  }


  // ============================== v10.8: 꾸미기 — 쪽 번호 · 글자 도장(워터마크) · 잘라내기 · 빈 쪽 ==============================
  // 한글·긴 글은 글꼴을 들이지 않고 「그림」으로 그려 넣는다(양식 칸 채우기와 같은 방식). 쪽 번호는 숫자뿐이라 PDF 기본 글꼴(Helvetica)로 쓴다.
  function stampPng(text, size, color) {
    var cv = document.createElement('canvas'), S = 1400; cv.width = S; cv.height = S;
    var g = cv.getContext('2d'); g.translate(S / 2, S / 2); g.rotate(-Math.PI / 4);
    var fs = 220; g.font = '800 ' + fs + 'px ' + FAMILY; var w = g.measureText(text).width; while (w > S * 0.95 && fs > 30) { fs -= 10; g.font = '800 ' + fs + 'px ' + FAMILY; w = g.measureText(text).width; }
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 0);
    return cv.toDataURL('image/png');
  }
  function dataToBytes(url) { var b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var MMPT = 72 / 25.4;
  // 보이는 모양(돌려 놓은 쪽 포함) 기준 좌표 → 쪽 안 좌표. rot = 쪽을 돌려 놓은 각도(시계 방향 0·90·180·270). 보이는 쪽의 왼쪽 아래가 (0,0)
  function toPage(rot, W, H, vx, vy) {
    if (rot === 90) return { x: W - vy, y: vx, a: 90 };
    if (rot === 180) return { x: W - vx, y: H - vy, a: 180 };
    if (rot === 270) return { x: vy, y: H - vx, a: 270 };
    return { x: vx, y: vy, a: 0 };
  }
  function visSize(rot, W, H) { return rot === 90 || rot === 270 ? { w: H, h: W } : { w: W, h: H }; }
  function pageRot(pg) { var a = (pg.getRotation().angle || 0) % 360; return a < 0 ? a + 360 : a; }
  function decorate(api) {
    var ctx = api.ctx;
    ctx.busy('문서를 확인하는 중…');
    readInfo(api).catch(function () { return { signed: false }; }).then(function (info) {
      ctx.busy(null);
      if (info.signed) { signedBlock(api); return; }
      var go = function () { buildDeco(api, info); };
      if (api.hasAnns()) ctx.confirm('넣은 것이 있습니다', '넣은 형광펜·글·서명을 먼저 문서에 합친 뒤 꾸밉니다. 합친 뒤에도 「되돌리기」로 취소할 수 있습니다.', '문서에 합치고 꾸미기', function () { ctx.busy('넣은 것을 문서에 합치는 중…'); api.flattenAnns().then(function () { ctx.busy(null); go(); }, function (e) { ctx.busy(null); ctx.toast('합치지 못했습니다 — ' + ((e && e.message) || e), 4200); }); }, { cancelLabel: '취소' });
      else go();
    });
  }
  function buildDeco(api, info) {
    var ctx = api.ctx, body = el('div', 'spd'), st = { pos: 'c', fmt: 'n', start: 1, skip: false, wm: '', wmC: '#888888', top: 0, bottom: 0, left: 0, right: 0, blank: 1 };
    function lab(t) { body.appendChild(el('div', 'spd-l', t)); }
    function chips(list, key, cur) { var row = el('div', 'spd-r'); list.forEach(function (o) { var b = el('button', 'spd-b' + (o[0] === cur ? ' on' : ''), o[1]); b.type = 'button'; b.onclick = function () { st[key] = o[0]; [].forEach.call(row.children, function (x) { x.classList.toggle('on', x === b); }); }; row.appendChild(b); }); body.appendChild(row); }
    function num(label, key, min, max, unit) { var row = el('div', 'spd-r'), i = el('input', 'spd-in'); i.type = 'number'; i.inputMode = 'decimal'; i.min = min; i.max = max; i.value = st[key]; i.setAttribute('aria-label', label); i.oninput = function () { st[key] = parseFloat(i.value) || 0; }; row.appendChild(el('span', 'spd-u', label)); row.appendChild(i); row.appendChild(el('span', 'spd-u', unit)); body.appendChild(row); }
    function act(text, fn, cls) { var b = el('button', 'spd-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { ctx.closeSheet(); setTimeout(fn, 60); }; body.appendChild(b); }
    function run(label, mut, okMsg) {
      ctx.busy(label + ' 중…'); var L, doc;
      return api.loadLib().then(function (l) { L = l; return api.getBytes(); }).then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (d) { doc = d; return mut(L, d); }).then(function (note) {
        return doc.save().then(function (out) {
          return api.pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise.then(function (pd) { var n = pd.numPages; try { pd.destroy(); } catch (e) {} if (n !== doc.getPageCount()) throw new Error('쪽 수 점검 실패'); return api.applyBytes(out, label); });
        }).then(function () { ctx.busy(null); ctx.toast(okMsg + (note ? ' ' + note : '') + ' (되돌리려면 ↶)', 3600); });
      }).catch(function (e) { ctx.busy(null); ctx.toast('하지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    }
    lab('쪽 번호'); chips([['l', '아래 왼쪽'], ['c', '아래 가운데'], ['r', '아래 오른쪽']], 'pos', st.pos);
    chips([['n', '1'], ['of', '1 / 전체'], ['dash', '- 1 -']], 'fmt', st.fmt); num('시작 번호', 'start', 1, 9999, '');
    var sk = el('button', 'spd-b', '첫 쪽에는 번호 안 넣기'); sk.type = 'button'; sk.onclick = function () { st.skip = !st.skip; sk.classList.toggle('on', st.skip); }; body.appendChild(sk);
    act('쪽 번호 넣기', function () {
      run('쪽 번호', function (L, doc) {
        return doc.embedFont(L.StandardFonts.Helvetica).then(function (font) {
          var pages = doc.getPages(), n = pages.length, skipped = 0;
          pages.forEach(function (pg, i) {
            if (st.skip && i === 0) return;
            var no = (st.start || 1) + i - (st.skip ? 1 : 0), t = st.fmt === 'of' ? no + ' / ' + (n + (st.start || 1) - 1 - (st.skip ? 1 : 0)) : (st.fmt === 'dash' ? '- ' + no + ' -' : String(no));
            var sz = 10, w = font.widthOfTextAtSize(t, sz), box = pg.getSize(), rot = pageRot(pg), vs = visSize(rot, box.width, box.height), vx = st.pos === 'l' ? 36 : (st.pos === 'r' ? vs.w - 36 - w : (vs.w - w) / 2), q = toPage(rot, box.width, box.height, vx, 22);
            pg.drawText(t, { x: q.x, y: q.y, size: sz, font: font, color: L.rgb(0.2, 0.2, 0.2), rotate: L.degrees(q.a) });
          });
          return skipped ? '(돌려 놓은 ' + skipped + '쪽은 번호를 넣지 않았습니다)' : '';
        });
      }, '쪽 번호를 넣었습니다.');
    }, 'on');
    lab('글자 도장(워터마크) — 한글도 됩니다. 글을 그림으로 대각선에 옅게 넣습니다');
    var wi = el('input', 'spd-in wide'); wi.type = 'text'; wi.maxLength = 20; wi.placeholder = '예: 초안 · 대외비 · DRAFT'; wi.setAttribute('aria-label', '도장 글'); wi.oninput = function () { st.wm = wi.value; }; body.appendChild(wi);
    chips([['#888888', '회색'], ['#d33', '빨강'], ['#1c5fd6', '파랑']], 'wmC', st.wmC);
    act('모든 쪽에 도장 넣기', function () {
      var t = st.wm.trim(); if (!t) { ctx.toast('도장에 쓸 글을 적어 주십시오.', 2600); return; }
      run('글자 도장', function (L, doc) {
        return doc.embedPng(dataToBytes(stampPng(t, 0, st.wmC))).then(function (img) {
          doc.getPages().forEach(function (pg) { var b = pg.getSize(), rot = pageRot(pg), vs = visSize(rot, b.width, b.height), s = Math.min(vs.w, vs.h) * 0.95, c = toPage(rot, b.width, b.height, vs.w / 2, vs.h / 2), th = c.a * Math.PI / 180, hx = s / 2, hy = s / 2; pg.drawImage(img, { x: c.x - (hx * Math.cos(th) - hy * Math.sin(th)), y: c.y - (hx * Math.sin(th) + hy * Math.cos(th)), width: s, height: s, rotate: L.degrees(c.a), opacity: 0.28 }); });
          return '';
        });
      }, '글자 도장을 넣었습니다.');
    }, 'on');
    lab('잘라내기 — 가장자리를 줄여 보이는 영역만 작게(mm)'); num('위', 'top', 0, 100, 'mm'); num('아래', 'bottom', 0, 100, 'mm'); num('왼쪽', 'left', 0, 100, 'mm'); num('오른쪽', 'right', 0, 100, 'mm');
    act('모든 쪽 잘라내기', function () {
      if (!(st.top || st.bottom || st.left || st.right)) { ctx.toast('줄일 가장자리(mm)를 하나 이상 적어 주십시오.', 2800); return; }
      run('잘라내기', function (L, doc) {
        var bad = 0;
        doc.getPages().forEach(function (pg) {
          var mb = pg.getMediaBox(), cb = pg.getCropBox ? pg.getCropBox() : mb, rot = pageRot(pg), m = { left: st.left, right: st.right, top: st.top, bottom: st.bottom }, pl, pr, pt, pb;
          if (rot === 90) { pl = m.top; pr = m.bottom; pb = m.left; pt = m.right; } else if (rot === 180) { pl = m.right; pr = m.left; pb = m.top; pt = m.bottom; } else if (rot === 270) { pl = m.bottom; pr = m.top; pb = m.right; pt = m.left; } else { pl = m.left; pr = m.right; pb = m.bottom; pt = m.top; }
          var x = cb.x + pl * MMPT, y = cb.y + pb * MMPT, w = cb.width - (pl + pr) * MMPT, h = cb.height - (pt + pb) * MMPT;
          if (w < 50 || h < 50) { bad++; return; }
          pg.setCropBox(x, y, w, h);
        });
        if (bad === doc.getPageCount()) throw new Error('너무 많이 잘라 남는 영역이 없습니다');
        return bad ? '(너무 작아지는 ' + bad + '쪽은 그대로 두었습니다)' : '';
      }, '잘라냈습니다(내용은 지워지지 않고 보이는 영역만 줄었습니다).');
    }, 'on');
    lab('빈 쪽 넣기(맨 끝에)'); num('쪽 수', 'blank', 1, 20, '쪽');
    act('빈 쪽 넣기', function () {
      run('빈 쪽', function (L, doc) { var last = doc.getPages()[doc.getPageCount() - 1], b = last.getSize(); for (var i = 0; i < Math.max(1, Math.min(20, Math.round(st.blank || 1))); i++) doc.addPage([b.width, b.height]); return ''; }, '빈 쪽을 넣었습니다.');
    });
    body.appendChild(el('div', 'so-sheet-note', '모든 쪽에 적용됩니다. 문서는 그대로 두고 이 화면에서 바꾼 뒤 「사본 저장」으로 새 파일에 저장합니다. 특정 쪽에만 넣으려면 먼저 「쪽 정리」에서 나누기로 따로 만드십시오.'));
    ctx.sheet({ title: '꾸미기', body: body, buttons: [{ label: '닫기' }], wide: true });
  }

  global.SOPdfPages = { openPages: openPages, formMode: formMode, perRow: perRow, decorate: decorate };
})(window);

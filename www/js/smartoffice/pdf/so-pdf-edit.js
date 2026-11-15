/* so-pdf-edit.js — S-Office PDF 「글 고치기 · 도형·손그림 · 첨부 파일 · 정밀 보기 · 편집 제한 · 워드로 열기」 화면 (O-0861, v10.9 5회차)
 * 꾸미기 시트(so-pdf-tools.js 의 extend)에서 불러온다. 새 도구줄 단추 없음. 스위치 SO_PDF_EDIT(so-core.js).
 * 글 고치기 엔진은 so-pdf-textedit.js, 워드 변환 엔진은 so-pdf-docx.js. 모든 고침은 workStack(↶)으로 되돌린다. 저장은 사본으로만.
 * 외부 부품 추가 없음(pdf-lib·PDF.js·qpdf.wasm·JSZip 은 앱에 이미 있음).
 */
(function (global) {
  'use strict';

  var FAMILY = 'Helvetica, Arial, "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function dataToBytes(url) { var b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function loadTextEdit(ctx) { return global.SOPdfTextEdit ? Promise.resolve(global.SOPdfTextEdit) : ctx.loadScript('js/smartoffice/pdf/so-pdf-textedit.js').then(function () { if (!global.SOPdfTextEdit) throw new Error('글 고치기 부품을 불러오지 못했습니다'); return global.SOPdfTextEdit; }); }

  // 글을 그림으로(한글 가능). 1pt = 4픽셀. base = 그림 아래 끝에서 글줄 바닥까지(pt)
  function textImage(text, sizePt, color) {
    var px = Math.max(8, Math.round(sizePt * 4)), cv = document.createElement('canvas'), g = cv.getContext('2d');
    g.font = px + 'px ' + FAMILY; var w = Math.ceil(g.measureText(text).width) + 8; cv.width = Math.min(w, 8000); cv.height = Math.ceil(px * 1.4);
    g = cv.getContext('2d'); g.font = px + 'px ' + FAMILY; g.fillStyle = color || '#111'; g.textBaseline = 'middle'; g.fillText(text, 4, cv.height / 2);
    var hpt = cv.height / 4, url = cv.toDataURL('image/png');
    return { bytes: dataToBytes(url), wpt: cv.width / 4, hpt: hpt, base: hpt / 2 - 0.32 * sizePt, url: url };
  }

  // ======================================================================== 공통: 쪽 한 장 보여 주는 전체 화면(글 고치기·도형이 같이 쓴다)
  // cfg: { title, okLabel, hint, onShow(ctl), onApply(), onCancel(), footExtra(fb, ctl), count() }
  function openStage(api, cfg) {
    var ctx = api.ctx, root = api.root, pdf = api.pdfDoc(), N = api.pageCount();
    if (root.querySelector('.spp')) return null;
    var ctl = { cur: Math.min(Math.max(1, api.curPage()), N), zoom: 1, tok: 0, task: null, vp: null, S: 1, destroyed: false, N: N, pdf: pdf, ctx: ctx };
    var back = el('div', 'spp spr spe'), bar = el('div', 'spp-bar'), stage = el('div', 'spr-stage'), host = el('div', 'spr-host'), cv = el('canvas', 'spr-cv'), ov = el('div', 'spr-ov'), foot = el('div', 'spp-foot spr-foot');
    var btnC = el('button', 'spp-hb', '취소'), tt = el('div', 'spp-t', ''), btnOk = el('button', 'spp-hb ok', cfg.okLabel || '적용');
    [btnC, btnOk].forEach(function (b) { b.type = 'button'; });
    bar.appendChild(btnC); bar.appendChild(tt); bar.appendChild(btnOk);
    var hint = el('div', 'spp-hint', cfg.hint || '');
    host.appendChild(cv); host.appendChild(ov); stage.appendChild(host);
    back.appendChild(bar); back.appendChild(hint); back.appendChild(stage); back.appendChild(foot); root.appendChild(back);
    ctl.back = back; ctl.stage = stage; ctl.host = host; ctl.cv = cv; ctl.ov = ov; ctl.foot = foot; ctl.hint = hint; ctl.btnOk = btnOk; ctl.btnC = btnC; ctl.tt = tt;
    ctl.fb = function (g, l, fn, extraCls) { var b = el('button', 'spp-fb' + (extraCls ? ' ' + extraCls : '')); b.type = 'button'; b.innerHTML = '<span class="t-g"></span><span class="t-l"></span>'; b.firstChild.textContent = g; b.lastChild.textContent = l; b.onclick = fn; foot.appendChild(b); return b; };
    ctl.bPrev = ctl.fb('◀', '이전 쪽', function () { ctl.go(ctl.cur - 1); });
    ctl.bNext = ctl.fb('▶', '다음 쪽', function () { ctl.go(ctl.cur + 1); });
    if (cfg.footExtra) cfg.footExtra(ctl);
    ctl.bZm = ctl.fb('－', '줄이기', function () { ctl.setZoom(ctl.zoom / 1.5); });
    ctl.bZp = ctl.fb('＋', '키우기', function () { ctl.setZoom(ctl.zoom * 1.5); });
    ctl.upd = function () { tt.textContent = ctl.cur + ' / ' + N + '쪽' + (cfg.count ? ' · ' + cfg.count() : ''); ctl.bPrev.disabled = ctl.cur <= 1; ctl.bNext.disabled = ctl.cur >= N; btnOk.disabled = cfg.okDisabled ? cfg.okDisabled() : false; if (cfg.onUpd) cfg.onUpd(ctl); };
    ctl.setZoom = function (z) { ctl.zoom = clamp(z, 1, 4); ctl.showPage(true); };
    ctl.go = function (n) { if (n < 1 || n > N) return; ctl.cur = n; ctl.zoom = 1; stage.scrollLeft = 0; stage.scrollTop = 0; ctl.showPage(); };
    ctl.showPage = function (keep) {
      var my = ++ctl.tok; if (ctl.task) { try { ctl.task.cancel(); } catch (e) {} ctl.task = null; }
      pdf.getPage(ctl.cur).then(function (pg) {
        if (ctl.destroyed || my !== ctl.tok) return;
        ctl.vp = pg.getViewport({ scale: 1 }); ctl.pg = pg;
        var aw = Math.max(120, stage.clientWidth - 16), ah = Math.max(120, stage.clientHeight - 16);
        ctl.fit = Math.min(aw / ctl.vp.width, ah / ctl.vp.height); ctl.S = ctl.fit * ctl.zoom;
        var S = ctl.S, cssW = ctl.vp.width * S, cssH = ctl.vp.height * S, dpr = Math.min(global.devicePixelRatio || 1, 2.5), k = Math.min(dpr, Math.sqrt(5e6 / (cssW * cssH)));
        cv.width = Math.max(1, Math.round(cssW * k)); cv.height = Math.max(1, Math.round(cssH * k));
        host.style.width = cssW + 'px'; host.style.height = cssH + 'px'; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; ov.style.width = cssW + 'px'; ov.style.height = cssH + 'px';
        var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        ctl.task = pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: S * k }) });
        if (cfg.onShow) cfg.onShow(ctl); ctl.upd();
        return ctl.task.promise.then(function () { ctl.task = null; try { pg.cleanup(); } catch (e) {} }, function () {});
      }).catch(function (e) { ctx.toast('쪽을 그리지 못했습니다 — ' + ((e && e.message) || e), 3600); });
    };
    ctl.close = function () { ctl.destroyed = true; ctl.tok++; if (ctl.task) { try { ctl.task.cancel(); } catch (e) {} } if (back.parentNode) back.parentNode.removeChild(back); api.pagesClosed(); };
    btnC.onclick = function () { if (cfg.dirty && cfg.dirty()) ctx.confirm(cfg.discardTitle || '고친 내용을 버리시겠습니까?', cfg.discardMsg || '적용하지 않고 닫으면 지금까지 고른 것이 사라집니다.', '버리고 닫기', ctl.close, { danger: true, cancelLabel: '계속하기' }); else ctl.close(); };
    btnOk.onclick = function () { cfg.onApply(ctl); };
    api.onPagesBack(function () { btnC.onclick(); return true; });
    setTimeout(function () { ctl.showPage(); }, 30);
    return ctl;
  }

  // 새 문서로 바꾸기 전에 쪽 수를 확인하고 문서에 적용(↶ 가능)
  function finishBytes(api, out, expectPages, label) {
    return api.pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise.then(function (pd) {
      var n = pd.numPages; try { pd.destroy(); } catch (e) {}
      if (n !== expectPages) throw new Error('쪽 수 점검에 실패했습니다');
      return api.applyBytes(out, label);
    });
  }
  function pageTextOf(pdfDoc, n) {
    return pdfDoc.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { try { pg.cleanup(); } catch (e) {} return tc.items.map(function (i) { return i.str || ''; }).join(''); }); });
  }
  function chCount(s) { var m = {}; String(s).replace(/\s+/g, '').split('').forEach(function (c) { m[c] = (m[c] || 0) + 1; }); return m; }

  // ======================================================================== 글 고치기
  function textEditScreen(api) {
    var ctx = api.ctx, T, L, doc, fontCache = {}, pageRuns = {}, pend = {}, sel = {}, ctl, busyScan = false;
    function pendList(n) { return pend[n] || (pend[n] = []); }
    function totalPend() { var c = 0; Object.keys(pend).forEach(function (k) { c += pend[k].length; }); return c; }
    function totalPages() { var c = 0; Object.keys(pend).forEach(function (k) { if (pend[k].length) c++; }); return c; }
    ctx.busy('글 고치기를 준비하는 중…');
    loadTextEdit(ctx).then(function (t) { T = t; return Promise.all([api.loadLib(), api.getBytes()]); }).then(function (r) {
      L = r[0]; return L.PDFDocument.load(r[1], { updateMetadata: false });
    }).then(function (d) {
      doc = d;
      // 같은 글꼴로 이미 쓴 글자표를 모든 쪽에서 모은다(제자리 교체 가능 여부 판정용). 쪽이 너무 많으면 앞 120쪽만.
      var n = Math.min(doc.getPageCount(), 120), i = 0;
      function step() {
        if (i >= n) return Promise.resolve();
        ctx.busy('글꼴의 글자를 모으는 중… (' + (i + 1) + '/' + n + ')');
        try { pageRuns[i] = T.readRuns(L, doc, i, { fontCache: fontCache }); } catch (e) { pageRuns[i] = { runs: [], error: e }; }
        i++; return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      }
      return step();
    }).then(function () { ctx.busy(null); start(); }).catch(function (e) { ctx.busy(null); ctx.toast('글 고치기를 열지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });

    function runsOf(n) {
      var r = pageRuns[n - 1];
      if (!r) { try { r = pageRuns[n - 1] = T.readRuns(L, doc, n - 1, { fontCache: fontCache }); } catch (e) { r = pageRuns[n - 1] = { runs: [], error: e }; } }
      return r;
    }
    function selIds() { return Object.keys(sel).map(Number).sort(function (a, b) { return a - b; }); }
    function start() {
      var info = el('div', 'spe-info');
      function draw(c) {
        c.ov.innerHTML = ''; info.textContent = '';
        var rr = runsOf(c.cur), S = c.S, vp = c.vp;
        if (rr.error) { info.textContent = '이 쪽은 글 구조를 읽지 못했습니다 — ' + rr.error.message; }
        var pe = pendList(c.cur), done = {};
        pe.forEach(function (ed) { ed.ids.forEach(function (id) { done[id] = ed; }); });
        function boxOf(r) { var rect = vp.convertToViewportRectangle([r.bbox.x, r.bbox.y, r.bbox.x + r.bbox.w, r.bbox.y + r.bbox.h]); return { x: Math.min(rect[0], rect[2]) * S, y: Math.min(rect[1], rect[3]) * S, w: Math.abs(rect[2] - rect[0]) * S, h: Math.abs(rect[3] - rect[1]) * S }; }
        var nEdit = 0, nBlock = 0;
        rr.runs.forEach(function (r) {
          if (r.blank) return;
          var b = boxOf(r), d = el('div', 'spe-run'); d.style.left = b.x + 'px'; d.style.top = b.y + 'px'; d.style.width = Math.max(10, b.w) + 'px'; d.style.height = Math.max(10, b.h) + 'px';
          if (done[r.id]) {
            d.classList.add(done[r.id].text ? 'chg' : 'del');
            if (done[r.id].ids[0] === r.id && done[r.id].text) { var pv = el('div', 'spe-pv', done[r.id].text); pv.style.fontSize = Math.max(8, r.fsize * r.scale * S * 0.95) + 'px'; d.appendChild(pv); }
          } else if (!r.editable) { d.classList.add('no'); d.title = r.why; nBlock++; } else { nEdit++; }
          if (sel[r.id]) d.classList.add('on');
          d.onclick = function (ev) {
            ev.stopPropagation();
            if (!r.editable && !done[r.id]) { ctx.toast('이 글은 고칠 수 없습니다 — ' + r.why, 3200); return; }
            if (done[r.id]) { ctx.confirm('이 고침을 취소할까요?', '「' + done[r.id].old + '」 → ' + (done[r.id].text ? '「' + done[r.id].text + '」' : '(지움)'), '고침 취소', function () { pend[c.cur] = pendList(c.cur).filter(function (x) { return x !== done[r.id]; }); draw(c); c.upd(); }, { cancelLabel: '그대로 두기' }); return; }
            if (sel[r.id]) delete sel[r.id]; else sel[r.id] = c.cur;
            // 다른 쪽 선택은 비운다
            Object.keys(sel).forEach(function (k) { if (sel[k] !== c.cur) delete sel[k]; });
            draw(c); c.upd();
          };
          c.ov.appendChild(d);
        });
        if (!rr.runs.length && !rr.error) info.textContent = '이 쪽에는 고칠 수 있는 글이 없습니다(그림으로 된 글일 수 있습니다).';
        else if (!nEdit && nBlock && !pe.length) info.textContent = '이 쪽의 글은 모두 고칠 수 없는 방식입니다(회색 점선 칸을 누르면 이유가 나옵니다).';
        refreshBtns(c);
      }
      function refreshBtns(c) {
        var n = selIds().length; if (c.bEdit) c.bEdit.disabled = !n; if (c.bDel) c.bDel.disabled = !n;
        if (c.bUndo) c.bUndo.disabled = !pendList(c.cur).length;
        c.hint.textContent = n ? '고른 글 ' + n + '개 — 아래 「바꾸기」로 새 글을 적거나 「지우기」를 누르십시오.' : '고칠 글을 누르십시오(여러 개를 눌러 한 줄로 묶어 고칠 수 있습니다). 초록은 바꿀 글, 빨강은 지울 글입니다.';
      }
      ctl = openStage(api, {
        title: '글 고치기', okLabel: '적용', hint: '', count: function () { var t = totalPend(); return t ? '고침 ' + t + '곳' : '고침 없음'; },
        okDisabled: function () { return totalPend() === 0; }, dirty: function () { return totalPend() > 0; },
        discardTitle: '고른 고침을 버리시겠습니까?', discardMsg: '적용하지 않고 닫으면 지금까지 정한 고침이 사라집니다.',
        footExtra: function (c) {
          c.bEdit = c.fb('✎', '바꾸기', function () { editDialog(c); });
          c.bDel = c.fb('🗑', '지우기', function () { addEdit(c, ''); });
          c.bUndo = c.fb('↶', '고침 취소', function () { var pe = pendList(c.cur); if (pe.length) { pe.pop(); draw(c); c.upd(); } });
        },
        onShow: function (c) { c.stage.appendChild(info); draw(c); },
        onUpd: function (c) { refreshBtns(c); },
        onApply: function (c) { apply(c); }
      });
      if (!ctl) return;
      ctl.stage.addEventListener('click', function (e) { if (e.target === ctl.stage || e.target === ctl.host) { sel = {}; draw(ctl); } });
    }
    function editDialog(c) {
      var ids = selIds(); if (!ids.length) return;
      var rr = runsOf(c.cur), byId = {}; rr.runs.forEach(function (r) { byId[r.id] = r; });
      var group = ids.map(function (i) { return byId[i]; }).filter(Boolean);
      // 한 줄(바닥선이 비슷한 것)을 x 순서대로
      group.sort(function (a, b) { return Math.abs(a.bbox.y - b.bbox.y) > a.fsize * 0.6 ? b.bbox.y - a.bbox.y : a.bbox.x - b.bbox.x; });
      var joined = ''; group.forEach(function (r, i) { var t = r.text; joined += (i && !/^\s/.test(t) && !/\s$/.test(joined) && group[i - 1].bbox.x + group[i - 1].bbox.w < r.bbox.x - 0.5 ? ' ' : '') + t; });
      var wrap = el('div'), ta = el('textarea', 'sp-ta'); ta.rows = 3; ta.value = joined.replace(/^\s+|\s+$/g, ''); wrap.appendChild(ta);
      var note = el('div', 'sp-note'); wrap.appendChild(note);
      function upd() {
        var t = ta.value.replace(/\s+$/, '');
        if (!t) { note.textContent = '비우면 이 글이 지워집니다(「지우기」와 같습니다).'; return; }
        var enc = group.length === 1 ? T.encodeWith(group[0].font, t) : null;
        if (enc != null) note.textContent = '같은 글꼴로 그 자리에서 바뀝니다(글자 선택·검색도 그대로).';
        else if (/^[\x20-\x7E]*$/.test(t)) note.textContent = '옛 글을 파일에서 지우고, 같은 자리에 영문·숫자 글자로 새로 넣습니다(글꼴은 기본 글꼴로 바뀝니다).';
        else note.textContent = '옛 글을 파일에서 지우고, 같은 자리에 글을 「그림」으로 새로 넣습니다(한글 등은 그림이라 선택·검색이 안 됩니다).';
        // 새 글이 원래 자리보다 많이 길면 옆 글을 덮을 수 있다고 알린다
        var g0 = group[0], sz = g0.fsize * g0.scale, mc = document.createElement('canvas').getContext('2d'); mc.font = sz + 'px ' + FAMILY;
        var x0 = Math.min.apply(null, group.map(function (r) { return r.bbox.x; })), x1 = Math.max.apply(null, group.map(function (r) { return r.bbox.x + r.bbox.w; }));
        if (mc.measureText(t).width > (x1 - x0) * 1.12 + 2) note.textContent += ' ※ 새 글이 원래 자리보다 길어 오른쪽 글을 덮을 수 있습니다. 옆 글도 함께 골라 한 줄로 고치면 자리가 맞습니다.';
      }
      ta.oninput = upd; upd();
      S0.dlg(ctx, c, '글 바꾸기', wrap, function () {
        var t = ta.value.replace(/\s+$/, '');
        addEdit(c, t, joined); return true;
      });
      setTimeout(function () { try { ta.focus(); } catch (e) {} }, 80);
    }
    function addEdit(c, text, oldText) {
      var ids = selIds(); if (!ids.length) return;
      var rr = runsOf(c.cur), byId = {}; rr.runs.forEach(function (r) { byId[r.id] = r; });
      var group = ids.map(function (i) { return byId[i]; }).filter(Boolean);
      group.sort(function (a, b) { return Math.abs(a.bbox.y - b.bbox.y) > a.fsize * 0.6 ? b.bbox.y - a.bbox.y : a.bbox.x - b.bbox.x; });
      var old = oldText != null ? oldText : group.map(function (r) { return r.text; }).join(' ');
      var run = function () {
        pendList(c.cur).push({ ids: group.map(function (r) { return r.id; }), text: text, old: old.replace(/^\s+|\s+$/g, '') });
        sel = {};
        // 같은 글 위를 또 고치지 않게 앞쪽(머리) 번호가 맨 앞이 되도록 정렬은 이미 했다. 화면 갱신
        c.showPage(true);
      };
      if (!text) ctx.confirm('고른 글을 지울까요?', '「' + old.slice(0, 60) + '」을(를) 쪽 내용에서 지웁니다. 「적용」을 눌러야 문서가 바뀌고, 그 뒤에도 ↶ 로 되돌릴 수 있습니다.', '지우기', run, { cancelLabel: '취소' });
      else run();
    }
    function apply(c) {
      var pages = Object.keys(pend).filter(function (k) { return pend[k].length; }).map(Number).sort(function (a, b) { return a - b; });
      if (!pages.length) return;
      var n = totalPend();
      ctx.confirm('글 ' + n + '곳(' + pages.length + '쪽)을 고칠까요?', '바꾼 글은 파일에서 옛 글이 지워지고 새 글이 들어갑니다. 고친 뒤 글이 정말 바뀌었는지 다시 읽어 점검하고, 맞지 않으면 문서는 그대로 둡니다. 적용한 뒤에도 ↶ 로 되돌릴 수 있고, 저장은 「사본 저장」으로 합니다.', '고치기', function () { bake(c, pages); }, { cancelLabel: '취소' });
    }
    function bake(c, pages) {
      ctx.busy('글을 고치는 중…');
      var before = {}, expectAdd = {}, expectDel = {}, oldTexts = [], rep = { inplace: 0, redrawn: 0, deleted: 0, gc: 0 }, out, nPages;
      var chain = Promise.resolve();
      // 점검용: 고치기 전 쪽 글(PDF.js)
      pages.forEach(function (pn) { chain = chain.then(function () { return pageTextOf(c.pdf, pn); }).then(function (t) { before[pn] = t; }); });
      pages.forEach(function (pn) {
        chain = chain.then(function () {
          ctx.busy('글을 고치는 중… (' + pn + '쪽)');
          var edits = pend[pn].map(function (e) { return { ids: e.ids, text: e.text }; });
          return T.applyEdits(L, doc, pn - 1, edits, { fontCache: fontCache, textImage: textImage }).then(function (r) {
            rep.inplace += r.inplace; rep.redrawn += r.redrawn; rep.deleted += r.deleted; rep.gc += r.gcRemoved || 0;
            oldTexts = oldTexts.concat(r.oldTexts);
            // 기대값(글자 개수): 지운 글자는 빠지고, 제자리·글자로 넣은 새 글자는 늘고, 그림으로 넣은 글은 읽히지 않는다
            expectDel[pn] = {}; expectAdd[pn] = {};
            r.plans.forEach(function (p) {
              p.old.forEach(function (o) { var m = chCount(o); Object.keys(m).forEach(function (k) { expectDel[pn][k] = (expectDel[pn][k] || 0) + m[k]; }); });
              if (p.mode === 'inplace' || (p.mode === 'redraw' && /^[\x20-\x7E]*$/.test(p.text))) { var m2 = chCount(p.text); Object.keys(m2).forEach(function (k) { expectAdd[pn][k] = (expectAdd[pn][k] || 0) + m2[k]; }); }
            });
          });
        });
      });
      chain.then(function () { return doc.save(); }).then(function (bytes) {
        out = bytes; nPages = doc.getPageCount();
        return api.pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise;
      }).then(function (pd) {
        var ch = Promise.resolve(), bad = null;
        pages.forEach(function (pn) {
          ch = ch.then(function () { return pageTextOf(pd, pn); }).then(function (after) {
            var b = chCount(before[pn]), a = chCount(after), keys = {};
            Object.keys(b).concat(Object.keys(a)).forEach(function (k) { keys[k] = 1; });
            Object.keys(keys).forEach(function (k) { var want = (b[k] || 0) - (expectDel[pn][k] || 0) + (expectAdd[pn][k] || 0), got = a[k] || 0; if (want !== got && !bad) bad = pn + '쪽의 글자 「' + k + '」가 ' + want + '개여야 하는데 ' + got + '개입니다'; });
          });
        });
        return ch.then(function () { try { pd.destroy(); } catch (e) {} if (bad) throw new Error('고친 결과를 다시 읽어 점검했더니 맞지 않았습니다(' + bad + ')'); });
      }).then(function () {
        return L.PDFDocument.load(out, { updateMetadata: false });
      }).then(function (d2) {
        var leaks = T.scanLeaks(L, d2, oldTexts);
        rep.leaks = leaks;
        return finishBytes(api, out, nPages, '글 고치기');
      }).then(function () {
        ctx.busy(null); c.close();
        var parts = []; if (rep.inplace) parts.push('제자리 ' + rep.inplace); if (rep.redrawn) parts.push('다시 그림 ' + rep.redrawn); if (rep.deleted) parts.push('지움 ' + rep.deleted);
        var m = '글을 고쳤습니다(' + parts.join(' · ') + ').';
        if (rep.leaks && rep.leaks.length) m += ' 다만 문서 안 다른 곳(' + rep.leaks.slice(0, 3).map(function (x) { return x.where; }).join(', ') + ')에 옛 글이 남아 있습니다 — 「문서 정보」·「책갈피」에서 따로 지우십시오.';
        else m += ' 옛 글이 남은 곳이 없는지 파일 전체를 훑어 확인했습니다.';
        ctx.toast(m + ' 되돌리려면 ↶ , 저장은 「사본 저장」으로 하십시오.', 7000);
      }).catch(function (e) {
        ctx.busy(null);
        // 문서 객체는 이미 바뀌었으므로 화면을 닫고 다시 열게 한다
        ctx.toast('고치지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 6200);
        c.close();
      });
    }
  }
  var S0 = {
    // 화면 안 작은 대화상자(그 화면의 root 안)
    dlg: function (ctx, c, title, content, onOk) {
      var back = el('div', 'sp-dlg'), box = el('div', 'sp-dbox');
      box.appendChild(el('div', 'sp-dt', title)); box.appendChild(content);
      var bs = el('div', 'sp-db');
      [{ label: '취소' }, { label: '확인', primary: true, ok: true }].forEach(function (b) {
        var x = el('button', 'sp-dbtn' + (b.primary ? ' primary' : ''), b.label); x.type = 'button';
        x.onclick = function () { if (b.ok) { var r = onOk(); if (r === false) return; } if (back.parentNode) back.parentNode.removeChild(back); };
        bs.appendChild(x);
      });
      box.appendChild(bs); back.appendChild(box); c.back.appendChild(back);
      back.style.zIndex = 30;
      return back;
    }
  };

  // ======================================================================== 도형·손그림
  var SH_COL = ['#d32f2f', '#1565c0', '#2e7d32', '#111111', '#f9a825'];
  function shapesScreen(api) {
    var ctx = api.ctx, tool = 'rect', color = SH_COL[0], width = 2, fill = false, items = {}, ctl;
    var TOOLS = [['rect', '네모'], ['ellipse', '동그라미'], ['line', '선'], ['arrow', '화살표'], ['ink', '손그림']];
    function total() { var c = 0, p = 0; Object.keys(items).forEach(function (k) { if (items[k].length) { c += items[k].length; p++; } }); return { n: c, p: p }; }
    var opt = el('div', 'spe-opt');
    function renderOpt() {
      opt.innerHTML = '';
      var r1 = el('div', 'spe-r'); TOOLS.forEach(function (t) { var b = el('button', 'spe-b' + (tool === t[0] ? ' on' : ''), t[1]); b.type = 'button'; b.onclick = function () { tool = t[0]; renderOpt(); }; r1.appendChild(b); }); opt.appendChild(r1);
      var r2 = el('div', 'spe-r'); SH_COL.forEach(function (c) { var b = el('button', 'sp-chip' + (c === color ? ' on' : '')); b.type = 'button'; b.style.backgroundColor = c; b.setAttribute('aria-label', '색'); b.onclick = function () { color = c; renderOpt(); }; r2.appendChild(b); });
      [[1.2, '가늘게'], [2.5, '보통'], [5, '굵게']].forEach(function (w) { var b = el('button', 'spe-b' + (width === w[0] ? ' on' : ''), w[1]); b.type = 'button'; b.onclick = function () { width = w[0]; renderOpt(); }; r2.appendChild(b); });
      if (tool === 'rect' || tool === 'ellipse') { var fb = el('button', 'spe-b' + (fill ? ' on' : ''), fill ? '색 채움' : '속 비움'); fb.type = 'button'; fb.onclick = function () { fill = !fill; renderOpt(); }; r2.appendChild(fb); }
      opt.appendChild(r2);
    }
    renderOpt();
    function svgFor(it, S) {
      var ns = 'http://www.w3.org/2000/svg', g;
      function mk(n, a) { var e = document.createElementNS(ns, n); Object.keys(a).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
      var common = { stroke: it.color, 'stroke-width': it.w * S, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      if (it.t === 'rect') { g = mk('rect', Object.assign({ x: Math.min(it.x0, it.x1) * S, y: Math.min(it.y0, it.y1) * S, width: Math.abs(it.x1 - it.x0) * S, height: Math.abs(it.y1 - it.y0) * S }, common)); if (it.fill) { g.setAttribute('fill', it.color); g.setAttribute('fill-opacity', '0.28'); } }
      else if (it.t === 'ellipse') { g = mk('ellipse', Object.assign({ cx: (it.x0 + it.x1) / 2 * S, cy: (it.y0 + it.y1) / 2 * S, rx: Math.abs(it.x1 - it.x0) / 2 * S, ry: Math.abs(it.y1 - it.y0) / 2 * S }, common)); if (it.fill) { g.setAttribute('fill', it.color); g.setAttribute('fill-opacity', '0.28'); } }
      else if (it.t === 'line' || it.t === 'arrow') {
        g = mk('g', {}); g.appendChild(mk('line', Object.assign({ x1: it.x0 * S, y1: it.y0 * S, x2: it.x1 * S, y2: it.y1 * S }, common)));
        if (it.t === 'arrow') { var h = arrowHead(it); h.forEach(function (p) { g.appendChild(mk('line', Object.assign({ x1: it.x1 * S, y1: it.y1 * S, x2: p[0] * S, y2: p[1] * S }, common))); }); }
      } else { g = mk('polyline', Object.assign({ points: it.pts.map(function (p) { return p[0] * S + ',' + p[1] * S; }).join(' ') }, common)); }
      return g;
    }
    function arrowHead(it) {
      var dx = it.x1 - it.x0, dy = it.y1 - it.y0, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len, hl = Math.max(8, it.w * 4), a = Math.PI / 7;
      function rot(x, y, t) { return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]; }
      var l = rot(-ux, -uy, a), r = rot(-ux, -uy, -a);
      return [[it.x1 + l[0] * hl, it.y1 + l[1] * hl], [it.x1 + r[0] * hl, it.y1 + r[1] * hl]];
    }
    var svg = null;
    function draw(c) {
      c.ov.innerHTML = ''; var ns = 'http://www.w3.org/2000/svg';
      svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'spe-svg'); svg.setAttribute('width', c.vp.width * c.S); svg.setAttribute('height', c.vp.height * c.S);
      (items[c.cur] || []).forEach(function (it) { svg.appendChild(svgFor(it, c.S)); });
      c.ov.appendChild(svg);
    }
    ctl = openStage(api, {
      title: '도형·손그림', okLabel: '넣기', hint: '손가락으로 끌어 그립니다. 확대한 뒤 그리려면 ＋를 누르고 화면을 밀어 옮기십시오. 넣기를 누르면 문서에 벡터로 그려 넣습니다.',
      count: function () { var t = total(); return t.n ? '그림 ' + t.n + '개' : '그림 없음'; }, okDisabled: function () { return total().n === 0; }, dirty: function () { return total().n > 0; },
      discardTitle: '그린 것을 버리시겠습니까?', discardMsg: '적용하지 않고 닫으면 그린 도형이 사라집니다.',
      footExtra: function (c) {
        c.bUndo = c.fb('↶', '되돌리기', function () { var a = items[c.cur]; if (a && a.length) { a.pop(); draw(c); c.upd(); } });
        c.bClr = c.fb('🗑', '쪽 비우기', function () { items[c.cur] = []; draw(c); c.upd(); });
        c.hint.parentNode.insertBefore(opt, c.hint.nextSibling);
      },
      onShow: function (c) { draw(c); bindDraw(c); },
      onUpd: function (c) { if (c.bUndo) { c.bUndo.disabled = !(items[c.cur] && items[c.cur].length); c.bClr.disabled = c.bUndo.disabled; } },
      onApply: function (c) { var t = total(); ctx.confirm('그린 도형 ' + t.n + '개(' + t.p + '쪽)를 문서에 넣을까요?', '쪽 위에 선으로 그려 넣습니다(글·그림은 그대로). 넣은 뒤에도 ↶ 로 되돌릴 수 있고, 저장은 「사본 저장」으로 합니다.', '넣기', function () { bake(c); }, { cancelLabel: '취소' }); }
    });
    var bound = false;
    function bindDraw(c) {
      if (bound) return; bound = true;
      var drag = null;
      c.ov.style.touchAction = 'none';
      c.ov.addEventListener('pointerdown', function (e) {
        if (!c.vp || !e.isPrimary) return; e.preventDefault();
        var r = c.ov.getBoundingClientRect(), x = (e.clientX - r.left) / c.S, y = (e.clientY - r.top) / c.S;
        drag = { it: { t: tool, color: color, w: width, fill: fill, x0: x, y0: y, x1: x, y1: y, pts: [[x, y]] }, tmp: null };
        try { c.ov.setPointerCapture(e.pointerId); } catch (x2) {}
      });
      c.ov.addEventListener('pointermove', function (e) {
        if (!drag) return; var r = c.ov.getBoundingClientRect(), x = clamp((e.clientX - r.left) / c.S, 0, c.vp.width), y = clamp((e.clientY - r.top) / c.S, 0, c.vp.height), it = drag.it;
        it.x1 = x; it.y1 = y; if (it.t === 'ink') it.pts.push([x, y]);
        if (drag.tmp && drag.tmp.parentNode) drag.tmp.parentNode.removeChild(drag.tmp);
        drag.tmp = svgFor(it, c.S); svg.appendChild(drag.tmp);
      });
      function end(e, ok) {
        if (!drag) return; var it = drag.it; if (drag.tmp && drag.tmp.parentNode) drag.tmp.parentNode.removeChild(drag.tmp); drag = null;
        if (!ok) return;
        var size = Math.max(Math.abs(it.x1 - it.x0), Math.abs(it.y1 - it.y0));
        if (it.t === 'ink') { if (it.pts.length < 2) return; if (it.pts.length > 600) { var k = Math.ceil(it.pts.length / 600); it.pts = it.pts.filter(function (_, i) { return i % k === 0 || i === it.pts.length - 1; }); } }
        else if (size * c.S < 8) return;
        (items[c.cur] = items[c.cur] || []).push(it); draw(c); c.upd();
      }
      c.ov.addEventListener('pointerup', function (e) { end(e, true); });
      c.ov.addEventListener('pointercancel', function (e) { end(e, false); });
    }
    function hexRgb(L, hex) { var n = parseInt(hex.slice(1), 16); return L.rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }
    function bake(c) {
      ctx.busy('도형을 넣는 중…');
      var L, doc, pages = Object.keys(items).filter(function (k) { return items[k].length; }).map(Number).sort(function (a, b) { return a - b; });
      api.loadLib().then(function (l) { L = l; return api.getBytes(); }).then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (d) {
        doc = d; var chain = Promise.resolve();
        pages.forEach(function (pn) {
          chain = chain.then(function () { return c.pdf.getPage(pn); }).then(function (pg) {
            var vp = pg.getViewport({ scale: 1 }), page = doc.getPage(pn - 1);
            function P(x, y) { var p = vp.convertToPdfPoint(x, y); return { x: p[0], y: p[1] }; }
            items[pn].forEach(function (it) {
              var col = hexRgb(L, it.color), line = { color: col, thickness: it.w, lineCap: L.LineCapStyle.Round };
              if (it.t === 'rect' || it.t === 'ellipse') {
                var p0 = P(it.x0, it.y0), p1 = P(it.x1, it.y1);
                if (Math.abs((vp.rotation || 0) % 180) === 90) { /* 돌린 쪽: 아래 사각형 근사 */ }
                var x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
                if (it.t === 'rect') page.drawRectangle({ x: x, y: y, width: w, height: h, borderColor: col, borderWidth: it.w, color: it.fill ? col : undefined, opacity: it.fill ? 0.28 : undefined, borderOpacity: 1 });
                else page.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, borderColor: col, borderWidth: it.w, color: it.fill ? col : undefined, opacity: it.fill ? 0.28 : undefined, borderOpacity: 1 });
              } else if (it.t === 'line' || it.t === 'arrow') {
                var a = P(it.x0, it.y0), b = P(it.x1, it.y1); page.drawLine({ start: a, end: b, color: col, thickness: it.w, lineCap: L.LineCapStyle.Round });
                if (it.t === 'arrow') arrowHead(it).forEach(function (h) { var q = P(h[0], h[1]); page.drawLine({ start: b, end: q, color: col, thickness: it.w, lineCap: L.LineCapStyle.Round }); });
              } else {
                for (var i = 1; i < it.pts.length; i++) { var s = P(it.pts[i - 1][0], it.pts[i - 1][1]), e = P(it.pts[i][0], it.pts[i][1]); page.drawLine({ start: s, end: e, color: col, thickness: it.w, lineCap: L.LineCapStyle.Round }); }
              }
            });
          });
        });
        return chain;
      }).then(function () { return doc.save(); }).then(function (out) { return finishBytes(api, out, doc.getPageCount(), '도형·손그림'); }).then(function () {
        var t = total(); ctx.busy(null); c.close(); ctx.toast('도형 ' + t.n + '개를 넣었습니다. 되돌리려면 ↶ , 저장은 「사본 저장」으로 하십시오.', 4200);
      }).catch(function (e) { ctx.busy(null); ctx.toast('도형을 넣지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    }
  }

  // ======================================================================== 첨부 파일
  function nameTreePairs(L, ctx, node, out, path) {      // 이름 트리를 걸어 [이름, 파일 설명 참조, 부모 배열, 인덱스]
    var N = L.PDFName.of;
    node = node instanceof L.PDFRef ? ctx.lookup(node) : node; if (!node || !node.get) return;
    var names = node.get(N('Names')); names = names instanceof L.PDFRef ? ctx.lookup(names) : names;
    if (names && names.size) for (var i = 0; i + 1 < names.size(); i += 2) { var nm = ctx.lookup(names.get(i)); out.push({ name: nm && nm.decodeText ? nm.decodeText() : '', ref: names.get(i + 1), arr: names, idx: i }); }
    var kids = node.get(N('Kids')); kids = kids instanceof L.PDFRef ? ctx.lookup(kids) : kids;
    if (kids && kids.size && path.length < 6) for (var k = 0; k < kids.size(); k++) nameTreePairs(L, ctx, kids.get(k), out, path.concat(k));
  }
  function listAttachments(L, doc) {
    var ctx = doc.context, N = L.PDFName.of, out = [], names = doc.catalog.get(N('Names')); names = names instanceof L.PDFRef ? ctx.lookup(names) : names;
    if (names && names.get) { var ef = names.get(N('EmbeddedFiles')); if (ef) nameTreePairs(L, ctx, ef, out, []); }
    out.forEach(function (a) {
      var fs = a.ref instanceof L.PDFRef ? ctx.lookup(a.ref) : a.ref; a.fs = fs; a.size = 0; a.kind = 'tree';
      try { var efd = fs.get(N('EF')); efd = efd instanceof L.PDFRef ? ctx.lookup(efd) : efd; var f = efd.get(N('UF')) || efd.get(N('F')); a.stream = f instanceof L.PDFRef ? ctx.lookup(f) : f; var fnm = fs.get(N('UF')) || fs.get(N('F')); if (fnm && fnm.decodeText) a.fname = fnm.decodeText(); } catch (e) {}
      if (!a.fname) a.fname = a.name;
      try { a.bytes = a.stream ? L.decodePDFRawStream(a.stream).decode() : null; a.size = a.bytes ? a.bytes.length : 0; } catch (e) { a.bytes = null; }
    });
    // 쪽의 「파일 첨부」 주석
    doc.getPages().forEach(function (pg, pi) {
      var an = pg.node.Annots && pg.node.Annots(); if (!an) return;
      for (var i = 0; i < an.size(); i++) {
        var a = ctx.lookup(an.get(i)); if (!a || !a.get) continue;
        if (a.get(N('Subtype')) !== N('FileAttachment')) continue;
        var fs = a.get(N('FS')); fs = fs instanceof L.PDFRef ? ctx.lookup(fs) : fs, item = { kind: 'annot', page: pi, annots: an, idx: i, annotRef: an.get(i), fs: fs, name: '', size: 0 };
        try { var efd = fs.get(N('EF')); efd = efd instanceof L.PDFRef ? ctx.lookup(efd) : efd; var f = efd.get(N('UF')) || efd.get(N('F')); item.stream = f instanceof L.PDFRef ? ctx.lookup(f) : f; var fnm = fs.get(N('UF')) || fs.get(N('F')); item.fname = fnm && fnm.decodeText ? fnm.decodeText() : '첨부'; item.bytes = L.decodePDFRawStream(item.stream).decode(); item.size = item.bytes.length; } catch (e) { item.fname = item.fname || '첨부'; }
        out.push(item);
      }
    });
    return out;
  }
  function attachmentsGroup(api, H, grp, act) {
    var ctx = api.ctx, box = el('div'); grp.appendChild(box);
    function render(list) {
      box.innerHTML = '';
      if (!list.length) box.appendChild(el('div', 'so-sheet-note', '이 문서에는 첨부된 파일이 없습니다.'));
      list.forEach(function (a, i) {
        var row = el('div', 'spe-att'); row.appendChild(el('div', 'spe-att-n', a.fname + ' (' + kb(a.size) + (a.kind === 'annot' ? ', ' + (a.page + 1) + '쪽 클립' : '') + ')'));
        var b1 = el('button', 'spd-b', '꺼내기'); b1.type = 'button'; b1.disabled = !a.bytes;
        b1.onclick = function () { ctx.closeSheet(); setTimeout(function () { Promise.resolve(ctx.saveCopy(new Blob([a.bytes], { type: 'application/octet-stream' }), a.fname.replace(/[\\\/:*?"<>|]/g, '_'), { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('첨부 파일을 저장했습니다.', 3000); }); }, 60); };
        var b2 = el('button', 'spd-b', '지우기'); b2.type = 'button';
        b2.onclick = function () {
          ctx.closeSheet();
          setTimeout(function () {
            ctx.confirm('첨부 「' + a.fname + '」을(를) 지울까요?', '문서에서 이 파일을 지웁니다(파일 속에서도 비웁니다). 지운 뒤에도 ↶ 로 되돌릴 수 있습니다.', '지우기', function () {
              H.run('첨부 지우기', function (L, doc) {
                var cur = listAttachments(L, doc).filter(function (x) { return x.fname === a.fname && x.size === a.size && x.kind === a.kind && (a.kind !== 'annot' || x.page === a.page); })[0];
                if (!cur) throw new Error('지울 첨부를 찾지 못했습니다');
                if (cur.kind === 'tree') { cur.arr.remove(cur.idx + 1); cur.arr.remove(cur.idx); }
                else { cur.annots.remove(cur.idx); }
                try { var N = L.PDFName.of, af = doc.catalog.get(N('AF')); af = af instanceof L.PDFRef ? doc.context.lookup(af) : af; if (af && af.size) { for (var q = af.size() - 1; q >= 0; q--) { if (af.get(q) === cur.ref || (cur.fs && doc.context.lookup(af.get(q)) === cur.fs)) af.remove(q); } } } catch (e) {}
                return loadTextEdit(ctx).then(function (T) { T.gcUnreferenced(L, doc); return ''; });      // 지운 첨부가 파일 속에 남지 않게 안 쓰는 개체를 뺀다
              }, '첨부를 지웠습니다.');
            }, { cancelLabel: '취소', danger: true });
          }, 60);
        };
        var r2 = el('div', 'spd-r'); r2.appendChild(b1); r2.appendChild(b2); row.appendChild(r2); box.appendChild(row);
      });
      var add = el('button', 'spd-b big on', '파일 넣기'); add.type = 'button';
      add.onclick = function () {
        var inp = document.createElement('input'); inp.type = 'file'; inp.style.display = 'none';
        inp.onchange = function () {
          var f = inp.files && inp.files[0]; if (inp.parentNode) inp.parentNode.removeChild(inp); if (!f) return;
          if (f.size > 30 * 1024 * 1024) { ctx.toast('파일이 너무 큽니다(30MB까지).', 3200); return; }
          ctx.closeSheet();
          f.arrayBuffer().then(function (buf) {
            return H.run('첨부 넣기', function (L, doc) { return doc.attach(new Uint8Array(buf), f.name, { mimeType: f.type || 'application/octet-stream', description: f.name, creationDate: new Date(f.lastModified || Date.now()), modificationDate: new Date() }).then(function () { return doc.flush ? doc.flush() : null; }).then(function () { return ''; }); }, '「' + f.name + '」을(를) 첨부했습니다.');
          });
        };
        document.body.appendChild(inp); inp.click();
      };
      box.appendChild(add);
    }
    var loaded = false;
    grp.parentNode.addEventListener('toggle', function () {
      if (!grp.parentNode.open || loaded) return; loaded = true;
      box.appendChild(el('div', 'so-sheet-note', '첨부 목록을 읽는 중…'));
      Promise.all([api.loadLib(), api.getBytes()]).then(function (r) { return r[0].PDFDocument.load(r[1], { updateMetadata: false }).then(function (d) { return listAttachments(r[0], d); }); }).then(render).catch(function (e) { box.innerHTML = ''; box.appendChild(el('div', 'so-sheet-note', '첨부를 읽지 못했습니다 — ' + ((e && e.message) || e))); });
    });
  }

  // ======================================================================== 편집 제한(권한 암호)
  function permsGroup(api, H, grp, act, pwInput, qpdfRun) {
    var ctx = api.ctx, st = { print: true, copy: true, edit: false, note: false };
    grp.appendChild(el('div', 'so-sheet-note', '열 때는 암호를 묻지 않지만, 「소유자 암호」를 모르면 인쇄·글 복사·고치기·메모 입력을 막은 사본으로 저장합니다(원래이름_편집제한.pdf). 이 제한은 PDF 프로그램이 지키는 약속이라 모든 프로그램이 막아 주는 것은 아닙니다. 소유자 암호를 잊으면 제한을 풀 수 없습니다.'));
    [['print', '인쇄'], ['copy', '글 복사'], ['edit', '고치기·쪽 정리'], ['note', '메모·양식 입력']].forEach(function (d) {
      var row = el('div', 'spd-r'); row.appendChild(el('span', 'spd-u', d[1] + ' —'));
      var a = el('button', 'spd-b' + (st[d[0]] ? ' on' : ''), '허용'), b = el('button', 'spd-b' + (!st[d[0]] ? ' on' : ''), '막기'); a.type = b.type = 'button';
      a.onclick = function () { st[d[0]] = true; a.classList.add('on'); b.classList.remove('on'); }; b.onclick = function () { st[d[0]] = false; b.classList.add('on'); a.classList.remove('on'); };
      row.appendChild(a); row.appendChild(b); grp.appendChild(row);
    });
    var p1 = pwInput(grp, '소유자 암호'), p2 = pwInput(grp, '소유자 암호 한 번 더');
    act(grp, '편집 제한을 걸어 사본 저장', function () {
      var a = p1.value, b = p2.value; p1.value = p2.value = '';
      if (!a || a.length < 4) { ctx.toast('소유자 암호는 4자 이상으로 입력해 주십시오.', 2800); return; }
      if (a !== b) { ctx.toast('두 번 입력한 암호가 다릅니다.', 3000); return; }
      if (st.print && st.copy && st.edit && st.note) { ctx.toast('모두 「허용」이면 제한이 걸리지 않습니다. 하나 이상 「막기」로 바꾸십시오.', 3600); return; }
      ctx.busy('편집 제한을 거는 중…');
      api.getBytes().then(function (bytes) {
        return qpdfRun(ctx, function (i, o) {
          return ['--encrypt', '--user-password=', '--owner-password=' + a, '--bits=256', '--print=' + (st.print ? 'full' : 'none'), '--extract=' + (st.copy ? 'y' : 'n'), '--assemble=' + (st.edit ? 'y' : 'n'), '--modify-other=' + (st.edit ? 'y' : 'n'), '--annotate=' + (st.note ? 'y' : 'n'), '--form=' + (st.note ? 'y' : 'n'), '--accessibility=y', '--', i, o];
        }, bytes);
      }).then(function (r) {
        if (!r.out) throw new Error('제한을 걸지 못했습니다');
        ctx.busy(null); var base = (ctx.name || 'document').replace(/\.pdf$/i, '').replace(/_수정(\(\d+\))?$/, '');
        return Promise.resolve(ctx.saveCopy(new Blob([r.out], { type: 'application/pdf' }), base + '_편집제한.pdf', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('편집 제한을 건 사본을 저장했습니다. 소유자 암호를 잊지 마십시오.', 4800); });
      }).catch(function (e) { ctx.busy(null); ctx.toast('편집 제한을 걸지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    }, 'on');
  }

  // ======================================================================== 정밀 보기 (최대 20배 · 보이는 곳만 또렷하게 · 글 찾기 · 글 선택·복사)
  function preciseView(api) {
    var ctx = api.ctx, root = api.root, pdf = api.pdfDoc(), N = api.pageCount();
    if (root.querySelector('.spp')) return;
    var cur = Math.min(Math.max(1, api.curPage()), N), zoom = 1, tok = 0, task = null, vp0 = null, fit = 1, destroyed = false, textTask = null, hits = [], hitIdx = -1, tcache = {}, renderT = 0, tdivs = [], tstrs = [], rtok = 0;
    var back = el('div', 'spp spv'), bar = el('div', 'spp-bar'), stage = el('div', 'spv-stage'), host = el('div', 'spv-host'), cv = el('canvas', 'spv-cv'), tl = el('div', 'textLayer spv-tl'), hl = el('div', 'spv-hl'), foot = el('div', 'spp-foot spr-foot');
    var btnC = el('button', 'spp-hb', '닫기'), tt = el('div', 'spp-t', ''), btnCopy = el('button', 'spp-hb ok', '글 복사');
    [btnC, btnCopy].forEach(function (b) { b.type = 'button'; });
    bar.appendChild(btnC); bar.appendChild(tt); bar.appendChild(btnCopy);
    var sb = el('div', 'spv-search'), q = el('input', 'spd-in wide'); q.type = 'search'; q.placeholder = '문서에서 찾을 글'; q.setAttribute('aria-label', '찾을 글');
    var bf = el('button', 'spd-b', '찾기'), bp = el('button', 'spd-b', '◀'), bn = el('button', 'spd-b', '▶'), cnt = el('span', 'spv-cnt', '');
    [bf, bp, bn].forEach(function (b) { b.type = 'button'; });
    sb.appendChild(q); sb.appendChild(bf); sb.appendChild(bp); sb.appendChild(bn); sb.appendChild(cnt);
    var hint = el('div', 'spp-hint', '크게 확대해도 보이는 곳이 또렷하게 다시 그려집니다(최대 20배). 글을 길게 눌러 고르면 「글 복사」로 복사합니다.');
    host.appendChild(cv); host.appendChild(tl); host.appendChild(hl); stage.appendChild(host);
    back.appendChild(bar); back.appendChild(sb); back.appendChild(hint); back.appendChild(stage); back.appendChild(foot); root.appendChild(back);
    function fb(g, l, fn) { var b = el('button', 'spp-fb'); b.type = 'button'; b.innerHTML = '<span class="t-g"></span><span class="t-l"></span>'; b.firstChild.textContent = g; b.lastChild.textContent = l; b.onclick = fn; foot.appendChild(b); return b; }
    var bPrev = fb('◀', '이전 쪽', function () { go(cur - 1); }), bNext = fb('▶', '다음 쪽', function () { go(cur + 1); });
    fb('－', '줄이기', function () { setZoom(zoom / 1.6); }); var bz = fb('＋', '키우기', function () { setZoom(zoom * 1.6); });
    fb('1×', '맞추기', function () { setZoom(1); });
    function upd() { tt.textContent = cur + ' / ' + N + '쪽 · ' + (Math.round(zoom * 10) / 10) + '배'; bPrev.disabled = cur <= 1; bNext.disabled = cur >= N; bz.disabled = zoom >= 20; }
    function setZoom(z, cx, cy) {
      z = clamp(z, 1, 20); if (Math.abs(z - zoom) < 0.01) return;
      var r = stage.getBoundingClientRect(); if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
      var fx = stage.scrollLeft + cx - r.left, fy = stage.scrollTop + cy - r.top, ratio = z / zoom; zoom = z; layout(); stage.scrollLeft = fx * ratio - (cx - r.left); stage.scrollTop = fy * ratio - (cy - r.top); schedule(); upd();
    }
    function go(n) { if (n < 1 || n > N) return; cur = n; zoom = 1; stage.scrollLeft = stage.scrollTop = 0; load(); }
    var S = 1, cssW = 0, cssH = 0, pgObj = null;
    function layout() {
      if (!vp0) return; var aw = Math.max(120, stage.clientWidth - 16), ah = Math.max(120, stage.clientHeight - 16);
      fit = Math.min(aw / vp0.width, ah / vp0.height); S = fit * zoom; cssW = vp0.width * S; cssH = vp0.height * S;
      host.style.width = cssW + 'px'; host.style.height = cssH + 'px'; hl.style.width = cssW + 'px'; hl.style.height = cssH + 'px';
      tl.style.setProperty('--scale-factor', S); tl.style.width = cssW + 'px'; tl.style.height = cssH + 'px';
      tl.style.transform = ''; drawHits();
      upd();
    }
    function load() {
      var my = ++tok; ++rtok; if (task) { try { task.cancel(); } catch (e) {} task = null; }
      pdf.getPage(cur).then(function (pg) {
        if (destroyed || my !== tok) return;
        pgObj = pg; vp0 = pg.getViewport({ scale: 1 }); layout();
        // 글 칸(선택·복사용): 쪽 전체를 한 번 만든다
        tl.innerHTML = '';
        pg.getTextContent().then(function (tc) {
          if (destroyed || my !== tok) return;
          tcache[cur] = tc;
          try { if (textTask) textTask.cancel(); } catch (e) {}
          tdivs = []; tstrs = [];
          textTask = global.pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: pg.getViewport({ scale: S }), textDivs: tdivs, textContentItemsStr: tstrs });
          textTask.promise.then(function () { drawHits(); }, function () {});
          drawHits();
        });
        render();
      }).catch(function (e) { ctx.toast('쪽을 그리지 못했습니다 — ' + ((e && e.message) || e), 3600); });
    }
    function schedule() { clearTimeout(renderT); renderT = setTimeout(function () { render(); }, 130); }
    // 보이는 곳 + 여백만 화면 해상도로 그린다
    function render() {
      if (!pgObj || destroyed) return; var my = ++rtok; if (task) { try { task.cancel(); } catch (e) {} task = null; }
      var dpr = Math.min(global.devicePixelRatio || 1, 3), vw = stage.clientWidth, vh = stage.clientHeight, mx = vw * 0.25, my2 = vh * 0.25;
      var x0 = clamp(stage.scrollLeft - 8 - mx, 0, cssW), y0 = clamp(stage.scrollTop - 8 - my2, 0, cssH), x1 = clamp(stage.scrollLeft - 8 + vw + mx, 0, cssW), y1 = clamp(stage.scrollTop - 8 + vh + my2, 0, cssH);
      var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), k = Math.min(dpr, Math.sqrt(8e6 / (w * h)));
      var c2 = document.createElement('canvas'); c2.width = Math.max(1, Math.round(w * k)); c2.height = Math.max(1, Math.round(h * k)); c2.className = 'spv-cv';
      c2.style.left = x0 + 'px'; c2.style.top = y0 + 'px'; c2.style.width = w + 'px'; c2.style.height = h + 'px';
      var g = c2.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c2.width, c2.height);
      var vp = pgObj.getViewport({ scale: S * k, offsetX: -x0 * k, offsetY: -y0 * k });
      task = pgObj.render({ canvasContext: g, viewport: vp });
      task.promise.then(function () {
        task = null; if (destroyed || my !== rtok) return;
        if (cv.parentNode === host) host.replaceChild(c2, cv); else host.insertBefore(c2, tl); cv = c2;
      }, function () {});
    }
    stage.addEventListener('scroll', schedule, { passive: true });
    stage.addEventListener('wheel', function (e) { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); } }, { passive: false });
    // 두 손가락 확대
    var pinch = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    stage.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoom, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 }; }, { passive: true });
    stage.addEventListener('touchmove', function (e) { if (pinch && e.touches.length === 2) { e.preventDefault(); setZoom(pinch.z * dist(e.touches) / pinch.d, pinch.cx, pinch.cy); } }, { passive: false });
    stage.addEventListener('touchend', function (e) { if (e.touches.length < 2) pinch = null; }, { passive: true });
    // 글 찾기
    function allText(n) { if (tcache[n]) return Promise.resolve(tcache[n]); return pdf.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { try { pg.cleanup(); } catch (e) {} tcache[n] = tc; return tc; }); }); }
    function find() {
      var key = q.value.trim().toLowerCase(); hits = []; hitIdx = -1; cnt.textContent = '';
      if (!key) { drawHits(); return; }
      var chain = Promise.resolve(); ctx.busy('찾는 중…');
      for (var n = 1; n <= N; n++) (function (n) { chain = chain.then(function () { return allText(n); }).then(function (tc) { tc.items.forEach(function (it, i) { var s = String(it.str || '').toLowerCase(), p = 0, at; while ((at = s.indexOf(key, p)) >= 0 && hits.length < 500) { hits.push({ page: n, item: it, ii: i, at: at, len: key.length }); p = at + key.length; } }); }); })(n);
      chain.then(function () { ctx.busy(null); cnt.textContent = hits.length + '건'; if (hits.length) { hitIdx = 0; for (var i = 0; i < hits.length; i++) if (hits[i].page >= cur) { hitIdx = i; break; } showHit(); } else ctx.toast('찾는 글이 없습니다.', 2400); }).catch(function (e) { ctx.busy(null); ctx.toast('찾지 못했습니다 — ' + ((e && e.message) || e), 3600); });
    }
    function showHit() {
      if (hitIdx < 0 || !hits.length) return; var h = hits[hitIdx]; cnt.textContent = (hitIdx + 1) + ' / ' + hits.length + '건';
      if (h.page !== cur) { cur = h.page; load(); setTimeout(focusHit, 400); } else { drawHits(); focusHit(); }
    }
    function focusHit() {
      var r = hl.querySelector('.cur'); if (!r) return; var x = parseFloat(r.style.left), y = parseFloat(r.style.top);
      stage.scrollLeft = Math.max(0, x - stage.clientWidth / 2); stage.scrollTop = Math.max(0, y - stage.clientHeight / 2); schedule();
    }
    function drawHits() {
      hl.innerHTML = ''; if (!vp0) return;
      var hr = host.getBoundingClientRect();
      hits.forEach(function (h, i) {
        if (h.page !== cur) return;
        var d = el('div', 'spv-h' + (i === hitIdx ? ' cur' : '')), done = false, node = tdivs[h.ii];
        if (node && node.firstChild && node.firstChild.nodeType === 3 && node.firstChild.length >= h.at + h.len) {    // 글 칸 안 글을 그대로 재서 칠한다(정확)
          try { var rg = document.createRange(); rg.setStart(node.firstChild, h.at); rg.setEnd(node.firstChild, h.at + h.len); var rc = rg.getBoundingClientRect(); if (rc.width > 0) { d.style.left = (rc.left - hr.left) + 'px'; d.style.top = (rc.top - hr.top) + 'px'; d.style.width = rc.width + 'px'; d.style.height = rc.height + 'px'; done = true; } } catch (e) {}
        }
        if (!done) {
          var it = h.item, tr = it.transform, w = it.width || 0, Lc = String(it.str).length || 1;
          var x = tr[4] + w * h.at / Lc, y = tr[5], ww = w * h.len / Lc, hh = Math.abs(it.height || tr[3] || 10);
          var rect = vp0.convertToViewportRectangle([x, y - hh * 0.2, x + ww, y + hh * 0.85]);
          d.style.left = Math.min(rect[0], rect[2]) * S + 'px'; d.style.top = Math.min(rect[1], rect[3]) * S + 'px'; d.style.width = Math.abs(rect[2] - rect[0]) * S + 'px'; d.style.height = Math.abs(rect[3] - rect[1]) * S + 'px';
        }
        hl.appendChild(d);
      });
    }
    bf.onclick = find; q.onkeydown = function (e) { if (e.key === 'Enter') find(); };
    bn.onclick = function () { if (hits.length) { hitIdx = (hitIdx + 1) % hits.length; showHit(); } }; bp.onclick = function () { if (hits.length) { hitIdx = (hitIdx - 1 + hits.length) % hits.length; showHit(); } };
    // 글 복사: 고른 글 / 없으면 이 쪽 글 전체
    btnCopy.onclick = function () {
      var s = String(global.getSelection ? global.getSelection().toString() : ''), all = false;
      function done(t) { var ok = false; try { var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.parentNode.removeChild(ta); } catch (e) {} if (!ok && navigator.clipboard) { navigator.clipboard.writeText(t).then(function () { ctx.toast((all ? '이 쪽 글 전체 ' : '고른 글 ') + t.length + '자를 복사했습니다.', 2600); }, function () { ctx.toast('복사하지 못했습니다.', 2600); }); return; } ctx.toast(ok ? (all ? '이 쪽 글 전체 ' : '고른 글 ') + t.length + '자를 복사했습니다.' : '복사하지 못했습니다.', 2600); }
      if (s.trim()) done(s); else { all = true; allText(cur).then(function (tc) { var t = tc.items.map(function (i) { return i.str + (i.hasEOL ? '\n' : ''); }).join(''); if (!t.trim()) ctx.toast('이 쪽에는 복사할 글이 없습니다(그림일 수 있습니다).', 3000); else done(t); }); }
    };
    function close() { destroyed = true; tok++; clearTimeout(renderT); if (task) { try { task.cancel(); } catch (e) {} } try { if (textTask) textTask.cancel(); } catch (e) {} if (back.parentNode) back.parentNode.removeChild(back); api.pagesClosed(); }
    btnC.onclick = close; api.onPagesBack(function () { close(); return true; });
    if (global.ResizeObserver) { var ro = new ResizeObserver(function () { if (!destroyed && vp0) { layout(); schedule(); } }); ro.observe(stage); }
    setTimeout(load, 30);
  }

  // ======================================================================== 워드로 열기
  function toWord(api) {
    var ctx = api.ctx;
    ctx.confirm('PDF를 워드(.docx) 사본으로 바꿀까요?', 'PDF 속의 글을 쪽·문단 모양으로 뽑아 .docx 사본을 만듭니다. 글자 크기가 큰 줄은 제목으로, 문서 안 그림은 쪽 끝에 넣고, 글이 없는 쪽(스캔)은 쪽 그림으로 넣습니다. 표·칸 나누기·정확한 배치는 따라가지 못합니다. 원래 문서는 그대로입니다.', '바꾸기', function () {
      ctx.busy('워드 사본을 만드는 중…');
      Promise.all([ctx.loadScript('js/smartoffice/pdf/so-pdf-docx.js'), ctx.loadScript('vendor/so/docx/jszip.min.js')]).then(function () {
        if (!global.SOPdfDocx || !global.JSZip) throw new Error('변환 부품을 불러오지 못했습니다');
        return global.SOPdfDocx.convert(api.pdfDoc(), { JSZip: global.JSZip, onProgress: function (i, n) { ctx.busy('워드 사본을 만드는 중… (' + i + '/' + n + '쪽)'); } });
      }).then(function (r) {
        ctx.busy(null); var base = (ctx.name || 'document').replace(/\.pdf$/i, '').replace(/_수정(\(\d+\))?$/, '');
        return Promise.resolve(ctx.saveCopy(r.blob, base + '.docx', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('워드 사본을 저장했습니다(' + r.paras + '문단 · 그림 ' + Math.max(0, r.images - r.scanPages) + '개' + (r.scanPages ? ' · 쪽 그림 ' + r.scanPages + '쪽' : '') + '). 저장한 파일을 열면 S-Office 워드로 고칠 수 있습니다.', 6000); });
      }).catch(function (e) { ctx.busy(null); ctx.toast('워드로 바꾸지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    }, { cancelLabel: '취소' });
  }

  // ======================================================================== 꾸미기 시트에 붙는 구역
  function extend(api, H, slot, helpers) {
    var ctx = api.ctx, body = H.body;
    function grp(title) { var parts = title.split(' — '), d = el('details', 'spd-d'); d.appendChild(el('summary', '', parts[0])); var c = el('div', 'spd-dc'); d.appendChild(c); if (parts[1]) c.appendChild(el('div', 'so-sheet-note', parts[1])); slot.appendChild(d); return c; }
    function act(c, text, fn, cls) { var b = el('button', 'spd-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { ctx.closeSheet(); setTimeout(fn, 60); }; c.appendChild(b); return b; }
    ctx.loadCss('js/smartoffice/pdf/so-pdf-edit.css');
    var g1 = grp('글 고치기 — PDF 속 글을 바꾸거나 지우기');
    g1.appendChild(el('div', 'so-sheet-note', '고칠 글을 눌러 새 글로 바꾸거나 지웁니다. 같은 글꼴에 있는 글자는 그 자리에서 바뀌고, 없는 글자는 옛 글을 파일에서 지운 뒤 같은 자리에 새로 넣습니다. 고친 뒤 글을 다시 읽어 점검합니다.'));
    act(g1, '고칠 글 고르러 가기', function () { textEditScreen(api); }, 'on');
    var g2 = grp('도형·손그림 — 네모·동그라미·선·화살표·손으로 그리기');
    act(g2, '그리러 가기', function () { shapesScreen(api); }, 'on');
    var g3 = grp('첨부 파일 — 파일 넣기·꺼내기·지우기');
    attachmentsGroup(api, H, g3, act);
    var g4 = grp('정밀 보기 — 크게 확대(20배)·글 찾기·글 복사');
    act(g4, '정밀 보기 열기', function () { preciseView(api); }, 'on');
    var g5 = grp('워드로 열기 — PDF 글을 .docx 사본으로');
    act(g5, '워드 사본 만들기', function () { toWord(api); }, 'on');
    if (helpers && helpers.qpdfOn) {
      var g6 = grp('편집 제한 — 암호 없이 열리지만 인쇄·복사·고치기를 막기');
      permsGroup(api, H, g6, act, helpers.pwInput, helpers.qpdfRun);
    }
    var g7 = grp('글자 인식(OCR) — 스캔 PDF의 글자 읽기·글만 뽑아 보기');
    if (ctx.flag && ctx.flag('pdfocr')) {
      ctx.loadScript('js/smartoffice/pdf/so-pdf-ocr.js').then(function () { if (global.SOPdfOcr) global.SOPdfOcr.extend(api, g7, act); }).catch(function (e) { g7.appendChild(el('div', 'so-sheet-note', '글자 인식을 불러오지 못했습니다.')); try { console.warn('[S-Office PDF] 글자 인식', e); } catch (x) {} });
    } else g7.appendChild(el('div', 'so-sheet-note', '이 버전에서는 글자 인식을 쓸 수 없습니다. 필요하면 「수정 요청」을 쓰십시오.'));
  }

  global.SOPdfEdit = { extend: extend, textEditScreen: textEditScreen, shapesScreen: shapesScreen, preciseView: preciseView, toWord: toWord, listAttachments: listAttachments, textImage: textImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SOPdfEdit;
})(typeof window !== 'undefined' ? window : globalThis);

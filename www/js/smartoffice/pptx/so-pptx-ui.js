/* so-pptx-ui.js — S-Office 파워포인트 편집 화면(O-0861, v10.5)
 * 위: 슬라이드 줄 · 가운데: 고르는 슬라이드(도형을 눌러 고르고 끌어 옮기고 모서리로 크기 조절) · 아래: 도구줄(슬라이드·넣기·글·서식·위치·색·표·노트·쇼·삭제).
 * 실제 문서 고치기는 so-pptx-struct.js, 화면 갈아 끼우기·되돌리기는 so-pptx.js(run). 한 줄 단추 수: 접은 폰 6 + 더보기 · 펼친 화면 10 · DeX 전부.
 */
(function (global) {
  'use strict';
  var ST = global.SOPptxStruct;
  function J(w, j) { return global.SOffice && global.SOffice.josa ? global.SOffice.josa(w, j) : w + j; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var TXT = [['검정', '000000'], ['빨강', 'E02020'], ['파랑', '1C5FD6'], ['초록', '1B8A3A'], ['주황', 'EE7A00'], ['보라', '7A3FC4'], ['회색', '777777'], ['흰색', 'FFFFFF']];
  var FILLS = [['없음', null], ['노랑', 'FFE066'], ['연두', 'B7E4A0'], ['하늘', '9CC9FF'], ['분홍', 'FFB3C7'], ['살구', 'FFC98A'], ['회색', 'D0D5DD'], ['파랑', '4472C4'], ['초록', '70AD47'], ['주황', 'ED7D31'], ['검정', '000000']];
  var SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66];
  var FONTS = ['맑은 고딕', '바탕', '돋움', '굴림', '궁서', 'Arial', 'Times New Roman'];
  var KIND = { text: '글 상자', ph: '글 상자', shape: '도형', pic: '그림', table: '표', line: '선', group: '그룹', chart: '차트', smart: 'SmartArt', ole: '삽입 개체', other: '개체' };
  var STEP = 180000;                                           // 0.5cm

  function create(env) {
    var U = {}, s = env.s, ctx = env.ctx, host = env.host;
    var root = null, st = { shapes: [], xml: '', path: '', sel: null, cell: null, W: 9144000, H: 6858000, meta: [], k: 1 }, up = true, bucket = 0, keyFn = null;
    function toast(m, ms) { env.toast(m, ms || 2800); }
    function nameOf(sh) { var k = KIND[sh.kind] || '도형', lab = sh.label || sh.name || ''; return !lab ? k : (lab.indexOf(k) === 0 ? lab : k + ' · ' + lab); }
    function sel() { for (var i = 0; i < st.shapes.length; i++) if (st.shapes[i].id === st.sel) return st.shapes[i]; return null; }
    function fail(msg) {
      if (ctx.fixAvail && ctx.fixAvail()) ctx.confirm('폰에서는 하기 어렵습니다', msg + '\n\n파워포인트로 고쳐야 하는 일이면 「수정 요청」으로 맡길 수 있습니다.', '수정 요청', function () { ctx.requestFix(); }, { cancelLabel: '닫기' });
      else toast(msg, 5200);
    }
    function srcW(src) { return parseFloat(src.style.width) || src.offsetWidth || s.drawW || 960; }
    function srcH(src) { return parseFloat(src.style.height) || src.offsetHeight || s.sh || 540; }
    function perRow() { var w = global.innerWidth; return w >= 900 ? 12 : (w >= 640 ? 10 : 6); }

    // ---------------- 화면 틀 ----------------
    function build() {
      root = el('div', 'spx-ed');
      root.innerHTML = '<div class="spx-strip" role="list"></div><div class="spx-sw"><div class="spx-stage"></div></div><div class="spx-ctx so-clear"><span class="spx-ctxt"></span><span class="spx-ctxb"></span></div><div class="spx-tools"></div>';
      host.appendChild(root);
      root.querySelector('.spx-sw').addEventListener('pointerdown', function (e) { if (e.target === e.currentTarget || e.target.classList.contains('spx-stage') || e.target.classList.contains('spx-ov')) { if (st.sel != null) { st.sel = null; st.cell = null; paintSel(); renderCtx(); } } });
    }
    U.shown = function () { return !!root && up; };
    U.show = function () {
      if (!root) build();
      up = true; root.style.display = ''; host.classList.add('spx-host'); host.scrollTop = 0;
      header(); bindKeys(); renderTools(); U.refreshAll();
    };
    U.hide = function () { up = false; if (root) root.style.display = 'none'; host.classList.remove('spx-host'); unbindKeys(); };
    U.back = function () { if (st.sel != null) { st.sel = null; paintSel(); renderCtx(); } else env.exit(); };
    function header() {
      ctx.setActions([{ label: '보기', onClick: function () { env.exit(); } }, { label: '↶', onClick: function () { env.undo(); } }, { label: '↷', onClick: function () { env.redo(); } }, { label: '사본 저장', primary: true, onClick: function () { saveBtn(); } }]);
      ctx.onBack(function () { if (!up) return false; U.back(); return true; });
      ctx.onSave && ctx.onSave(saveBtn);
    }
    function saveBtn() { env.save(); }
    U.refreshAll = function () {
      if (!up || !root) return Promise.resolve();
      return Promise.all([ST.readDeck(env.roPkg(s.info.zip)), ST.listSlides(env.roPkg(s.info.zip))]).then(function (r) {
        st.W = r[0].W; st.H = r[0].H; st.meta = r[1].slides;
        if (s.idx >= st.meta.length) s.idx = st.meta.length - 1;
        st.path = st.meta[s.idx].path;
        return ST.readSlide(env.roPkg(s.info.zip), st.path);
      }).then(function (r) {
        st.xml = r.xml; st.shapes = r.shapes;
        if (st.sel != null && !sel()) { st.sel = null; st.cell = null; }
        renderStrip(); renderStage(); renderCtx();
        refillSheet();
      }).catch(function (e) { toast('화면을 그리지 못했습니다: ' + ((e && e.message) || e), 4200); });
    };

    // ---------------- 슬라이드 줄 ----------------
    function goSlide(i) { if (i === s.idx || i < 0 || i >= s.slides.length) return; s.idx = i; st.sel = null; st.cell = null; U.refreshAll(); }
    function renderStrip() {
      var box = root.querySelector('.spx-strip'); box.innerHTML = '';
      var n = s.slides.length, tw = 84, ratio = st.H / st.W;
      for (var i = 0; i < n; i++) {
        (function (i) {
          var b = el('button', 'spx-th' + (i === s.idx ? ' on' : '') + (st.meta[i] && st.meta[i].hidden ? ' hid' : '')); b.type = 'button'; b.setAttribute('aria-label', (i + 1) + '번 슬라이드'); b.setAttribute('role', 'listitem');
          var v = el('div', 'spx-thv'); v.style.width = tw + 'px'; v.style.height = Math.round(tw * ratio) + 'px';
          var src = s.slides[i];
          if (src && n <= 80) { var c = src.cloneNode(true); c.style.display = ''; c.style.margin = '0'; c.style.zoom = String(tw / srcW(src)); c.style.pointerEvents = 'none'; v.appendChild(c); }
          b.appendChild(v); b.appendChild(el('span', 'spx-thn', (i + 1) + (st.meta[i] && st.meta[i].hidden ? ' 숨김' : '')));
          b.onclick = function () { goSlide(i); }; box.appendChild(b);
          if (i === s.idx) setTimeout(function () { try { b.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }, 0);
        })(i);
      }
    }
    // ---------------- 고르는 슬라이드 ----------------
    function renderStage() {
      var sw = root.querySelector('.spx-sw'), stg = root.querySelector('.spx-stage'); stg.innerHTML = '';
      var aw = Math.max(120, sw.clientWidth - 12), ah = Math.max(80, sw.clientHeight - 12), ratio = st.H / st.W;
      var w = Math.min(aw, ah / ratio), h = w * ratio; stg.style.width = Math.round(w) + 'px'; stg.style.height = Math.round(h) + 'px';
      st.k = w / st.W;
      var src = s.slides[s.idx];
      if (src) { var c = src.cloneNode(true); c.style.display = ''; c.style.margin = '0'; c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0'; c.style.zoom = String(w / srcW(src)); c.style.pointerEvents = 'none'; stg.appendChild(c); }
      var ov = el('div', 'spx-ov'); stg.appendChild(ov);
      st.shapes.forEach(function (sh) {
        if (!sh.g) return;
        var b = el('div', 'spx-box' + (sh.canMove ? '' : ' fixed')); b.dataset.id = sh.id; b.setAttribute('aria-label', nameOf(sh));
        ov.appendChild(b); place(b, sh.g);
        b.addEventListener('pointerdown', function (e) { boxDown(e, sh, b); });
      });
      paintSel();
    }
    function place(b, g) { b.style.left = (g.x * st.k) + 'px'; b.style.top = (g.y * st.k) + 'px'; b.style.width = Math.max(14, g.w * st.k) + 'px'; b.style.height = Math.max(14, g.h * st.k) + 'px'; }
    function paintSel() {
      [].forEach.call(root.querySelectorAll('.spx-box'), function (b) {
        var on = Number(b.dataset.id) === st.sel; b.classList.toggle('sel', on);
        var h = b.querySelector('.spx-hd'); if (h) h.remove();
        if (on && sel() && sel().canMove) { var hd = el('div', 'spx-hd'); hd.setAttribute('aria-label', '크기 조절'); b.appendChild(hd); hd.addEventListener('pointerdown', function (e) { boxDown(e, sel(), b, true); }); }
      });
    }
    function boxDown(e, sh, b, resize) {
      e.stopPropagation();
      if (env.s.busyRun) return;
      if (st.sel !== sh.id) { st.sel = sh.id; st.cell = null; paintSel(); renderCtx(); if (!resize && !(sh.canMove)) { toast('이 개체는 폰에서 옮기거나 크기를 바꿀 수 없습니다. 지우기는 할 수 있습니다.', 3600); } }
      if (!sh.canMove) return;
      e.preventDefault();
      var x0 = e.clientX, y0 = e.clientY, g0 = { x: sh.g.x, y: sh.g.y, w: sh.g.w, h: sh.g.h }, moved = false, keepAsp = sh.kind === 'pic';
      try { (resize ? e.currentTarget : b).setPointerCapture(e.pointerId); } catch (x) {}
      var tgt = resize ? e.currentTarget : b;
      function mv(ev) {
        var dx = (ev.clientX - x0) / st.k, dy = (ev.clientY - y0) / st.k;
        if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 5) return; moved = true;
        var g = { x: g0.x, y: g0.y, w: g0.w, h: g0.h };
        if (resize) { g.w = Math.max(91440, g0.w + dx); g.h = keepAsp ? g.w * g0.h / g0.w : Math.max(91440, g0.h + dy); } else { g.x = g0.x + dx; g.y = g0.y + dy; }
        sh._live = g; place(b, g);
      }
      function upf() {
        tgt.removeEventListener('pointermove', mv); tgt.removeEventListener('pointerup', upf); tgt.removeEventListener('pointercancel', upf);
        if (moved && sh._live) { var g = ST.clampGeom(sh._live, st.W, st.H); sh._live = null; setGeom(sh.id, g, resize ? '크기를 바꿨습니다' : '옮겼습니다'); }
      }
      tgt.addEventListener('pointermove', mv); tgt.addEventListener('pointerup', upf); tgt.addEventListener('pointercancel', upf);
    }

    // ---------------- 한 가지 고침 ----------------
    // fn(xml, pkg) → 새 xml 또는 {xml,id}|{err}. keep=true 면 고른 도형을 그대로 둔다
    function op(label, fn, okMsg, keep) {
      var p = st.path;
      return env.run(label, function (pkg) {
        return pkg.read(p).then(function (x) { return Promise.resolve(fn(x, pkg)).then(function (res) { if (res && res.err) return res; var nx = typeof res === 'string' ? res : res.xml; pkg.write(p, nx); return { sel: res && res.id != null ? res.id : null }; }); });
      }, function (r) {
        if (r && r.err) { fail(r.err); return; }
        if (okMsg) toast(okMsg, 2400);
        if (!keep) { st.sel = r && r.sel != null ? r.sel : null; st.cell = null; }
        U.refreshAll();
      });
    }
    function setGeom(id, g, msg) { return op('위치·크기', function (x) { return ST.setGeom(x, id, g); }, msg, true); }
    function need(kindOk) {
      var sh = sel(); if (!sh) { toast('먼저 슬라이드 위의 도형을 눌러 고르십시오.', 3000); return null; }
      if (kindOk && !sh[kindOk]) { toast('이 개체에는 쓸 수 없는 기능입니다.', 3000); return null; }
      return sh;
    }
    function mid(w, h) { return { x: Math.round((st.W - w) / 2), y: Math.round((st.H - h) / 2), w: Math.round(w), h: Math.round(h) }; }
    function delShape() {
      var sh = need(); if (!sh) return;
      op('도형 지우기', function (x) { return ST.removeShape(x, sh.id); }, J(KIND[sh.kind] || '도형', '을') + ' 지웠습니다(되돌리려면 ↶)');
    }

    // ---------------- 복사·붙여넣기·복제 ----------------
    var clip = null;
    function copySel(cut) {
      var sh = need(); if (!sh) return;
      ST.copyShape(env.roPkg(s.info.zip), st.path, sh.id, sh.g).then(function (c) {
        if (c.err) { fail(c.err); return; }
        clip = c; c.fromIdx = s.idx;
        if (cut) { op('오려두기', function (x) { return ST.removeShape(x, sh.id); }, J(c.name, '을') + ' 오려 두었습니다 — 붙일 장에서 「붙여넣기」'); }
        else { toast(J(c.name, '을') + ' 복사했습니다 — 같은 장이나 다른 장에서 「붙여넣기」', 3200); renderCtx(); }
      }, function (e) { toast('복사하지 못했습니다: ' + ((e && e.message) || e), 4200); });
    }
    function pasteClip() {
      if (!clip) { toast('먼저 복사할 개체를 골라 「복사」를 누르십시오.', 3000); return; }
      var c = clip, same = c.slide === st.path, off = same ? { dx: STEP, dy: STEP } : { dx: 0, dy: 0 };
      env.run('붙여넣기', function (pkg) { return ST.pasteShape(pkg, st.path, c, off).then(function (r) { return { sel: r.id }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = r.sel; st.cell = null; toast(J(c.name, '을') + ' 붙였습니다', 2400); U.refreshAll(); });
    }
    function dupShape() {
      var sh = need(); if (!sh) return;
      ST.copyShape(env.roPkg(s.info.zip), st.path, sh.id, sh.g).then(function (c) {
        if (c.err) { fail(c.err); return; }
        env.run('복제', function (pkg) { return ST.pasteShape(pkg, st.path, c, { dx: STEP, dy: STEP }).then(function (r) { return { sel: r.id }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = r.sel; st.cell = null; toast(J(c.name, '을') + ' 복제했습니다(조금 옆에 놓였습니다)', 2600); U.refreshAll(); });
      }, function (e) { toast('복제하지 못했습니다: ' + ((e && e.message) || e), 4200); });
    }
    function copySheet() {
      sheet('복사·붙여넣기', function (body) {
        var g = grid(body), sh = sel();
        btn(g, '복사', function () { copySel(false); }, 'big', undefined, false); btn(g, '오려두기', function () { copySel(true); }, 'big', undefined, false);
        btn(g, '붙여넣기', pasteClip, 'big', undefined, false); btn(g, '복제', dupShape, 'big', undefined, false);
        body.appendChild(el('div', 'so-sheet-note', (sh ? '고른 개체: ' + nameOf(sh) + '. ' : '먼저 슬라이드 위의 개체를 눌러 고르십시오. ') + (clip ? '복사해 둔 개체: ' + clip.name + '(' + (clip.fromIdx + 1) + '번 장). 다른 장으로 가서 「붙여넣기」를 누르면 그 장에 들어갑니다.' : '복사해 둔 개체가 없습니다.') + ' 복제는 같은 장에 바로 하나 더 만듭니다. 차트·SmartArt·동영상·삽입 개체는 복사할 수 없습니다. 키보드(DeX)는 Ctrl+C·X·V·D 입니다.'));
      });
    }

    // ---------------- 시트 도우미 ----------------
    var curSheet = null, keepMode = false;
    function sheet(title, build2, noBtn, keep) {            // keep=true 면 항목을 눌러도 시트가 닫히지 않는다(「닫기」로 닫는다) — 적용 뒤에는 화면 상태에 맞게 시트 안을 다시 그린다
      var body = el('div', 'spx'); keepMode = !!keep; build2(body); keepMode = false;
      curSheet = keep ? { body: body, build: build2 } : null;
      ctx.sheet({ title: title, body: body, buttons: noBtn ? [] : [{ label: '닫기' }], wide: true, keep: !!keep });
      return body;
    }
    function refillSheet() {
      if (!curSheet) return;
      var b = curSheet.body; if (!b.isConnected) { curSheet = null; return; }
      var sc = [], p = b.parentElement; while (p && p !== document.body) { if (p.scrollTop) sc.push([p, p.scrollTop]); p = p.parentElement; }
      keepMode = true; b.innerHTML = ''; try { curSheet.build(b); } catch (e) {} keepMode = false;
      sc.forEach(function (q) { q[0].scrollTop = q[1]; });
    }
    function group(body, label) { body.appendChild(el('div', 'spx-l', label)); var r = el('div', 'spx-r'); body.appendChild(r); return r; }
    function btn(row, text, fn, cls, color, keepOpen) {
      var b = el('button', 'spx-b' + (cls ? ' ' + cls : ''), color === undefined ? text : ''); b.type = 'button';
      if (color !== undefined) { b.setAttribute('aria-label', text); var d = el('i'); if (color) d.style.background = '#' + color; else d.className = 'none'; b.appendChild(d); b.appendChild(el('span', '', text)); }
      var keep = keepOpen === undefined ? keepMode : keepOpen;
      b.onclick = function () { if (keep) { fn(); return; } ctx.closeSheet(); setTimeout(fn, 60); }; row.appendChild(b); return b;
    }
    function grid(body) { var g = el('div', 'spx-g'); body.appendChild(g); return g; }

    // ---------------- 슬라이드 ----------------
    function slideSheet() {
      var n = s.slides.length, i = s.idx, hid = st.meta[i] && st.meta[i].hidden;
      sheet('슬라이드 ' + (i + 1) + ' / ' + n, function (body) {
        var g = grid(body);
        btn(g, '새 슬라이드(뒤에)', function () { addSlide(null); }, 'big'); btn(g, '배치 골라 새로', layoutSheet, 'big');
        btn(g, '복제', dup, 'big'); btn(g, '슬라이드 지우기', delSlide, 'big danger');
        btn(g, '앞으로 옮기기', function () { moveSlide(-1); }, 'big'); btn(g, '뒤로 옮기기', function () { moveSlide(1); }, 'big');
        btn(g, hid ? '숨김 풀기' : '숨기기', function () { env.run('숨기기', function (pkg) { return ST.hideSlide(pkg, i, !hid).then(function () { return { slide: i }; }); }, function () { toast(hid ? '다시 보이게 했습니다' : '쇼에서 건너뛰도록 숨겼습니다', 2400); U.refreshAll(); }); }, 'big');
        btn(g, '쇼 보기', function () { env.slideshow(i); }, 'big');
        btn(g, '이 슬라이드 배치 바꾸기', changeLayoutSheet, 'big');
        var gb = group(body, '이 슬라이드 배경색'); BGC.forEach(function (c) { btn(gb, c[0], function () { op('배경색', function (x) { return ST.setSlideBg(x, c[1]); }, c[1] ? '배경색을 바꿨습니다' : '배경을 배치의 것으로 되돌렸습니다', true); }, 'sw', c[1] || ''); });
        body.appendChild(el('div', 'so-sheet-note', '새 슬라이드·복제는 지금 장 바로 뒤에 들어갑니다. 차트·SmartArt·삽입 개체·동영상이 든 장은 복제할 수 없고(이유를 알려 드립니다), 순서 바꾸기·지우기는 됩니다. 지운 직후에는 ↶ 로 되돌릴 수 있습니다.'));
      });
    }
    var BGC = [['배치 그대로', null], ['흰색', 'FFFFFF'], ['연한 회색', 'F2F2F2'], ['연한 노랑', 'FFF8D6'], ['연한 하늘', 'E3F0FF'], ['연한 연두', 'E6F5DC'], ['연한 분홍', 'FDE6EC'], ['남색', '1F3864'], ['검정', '000000']];
    function changeLayoutSheet() {
      var p = st.path;
      ST.readDeck(env.roPkg(s.info.zip)).then(function () { return ST.listLayouts(env.roPkg(s.info.zip)); }).then(function (ls) {
        sheet('배치 바꾸기', function (body) {
          var g = grid(body);
          ls.forEach(function (l) { btn(g, l.name, function () { env.run('배치 바꾸기', function (pkg) { return ST.changeLayout(pkg, p, l.path).then(function (r) { return r.err ? r : { slide: s.idx }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = null; toast('이 슬라이드의 배치를 「' + l.name + '」로 바꿨습니다(안의 내용은 그대로입니다)', 3000); U.refreshAll(); }); }, 'big'); });
          body.appendChild(el('div', 'so-sheet-note', '제목·본문 자리는 새 배치의 위치·서식을 따라갑니다. 마음에 안 들면 ↶ 로 되돌립니다.'));
        });
      });
    }
    function addSlide(layout) { var i = s.idx; env.run('새 슬라이드', function (pkg) { return ST.addSlide(pkg, i + 1, layout).then(function () { return { slide: i + 1 }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = null; toast('새 슬라이드를 넣었습니다', 2400); U.refreshAll(); }); }
    function layoutSheet() {
      ST.readDeck(env.roPkg(s.info.zip)).then(function () { return ST.listLayouts(env.roPkg(s.info.zip)); }).then(function (ls) {
        sheet('배치 고르기', function (body) { var g = grid(body); ls.forEach(function (l) { btn(g, l.name, function () { addSlide(l.path); }, 'big'); }); });
      });
    }
    function dup() { var i = s.idx; env.run('복제', function (pkg) { return ST.duplicateSlide(pkg, i).then(function (r) { return r.err ? r : { slide: r.index }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = null; toast('슬라이드를 복제했습니다', 2400); U.refreshAll(); }); }
    function delSlide() {
      var i = s.idx, n = s.slides.length;
      if (n <= 1) { toast('슬라이드가 하나뿐이라 지울 수 없습니다.', 3000); return; }
      ctx.confirm(J('슬라이드 ' + (i + 1), '을') + ' 지우시겠습니까?', '이 장의 모든 내용과 발표자 노트가 지워집니다. 지운 직후에는 ↶ 로 되돌릴 수 있습니다.', '슬라이드 지우기', function () {
        env.run('슬라이드 지우기', function (pkg) { return ST.deleteSlide(pkg, i).then(function (r) { return r.err ? r : { slide: Math.min(i, n - 2) }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = null; toast('슬라이드를 지웠습니다(되돌리려면 ↶)', 3000); U.refreshAll(); });
      }, { danger: true });
    }
    function moveSlide(d) {
      var i = s.idx, j = i + d; if (j < 0 || j >= s.slides.length) { toast(d < 0 ? '맨 앞입니다.' : '맨 뒤입니다.', 2000); return; }
      env.run('순서 바꾸기', function (pkg) { return ST.moveSlide(pkg, i, j).then(function () { return { slide: j }; }); }, function () { st.sel = null; toast('슬라이드를 ' + (j + 1) + '번 자리로 옮겼습니다', 2400); U.refreshAll(); });
    }

    // ---------------- 넣기 ----------------
    function insertSheet() {
      sheet('넣기', function (body) {
        var g = grid(body);
        btn(g, '글 상자', textBoxSheet, 'big'); btn(g, '그림(사진)', pickPicture, 'big'); btn(g, '표', tableNewSheet, 'big');
        Object.keys(ST.SHAPES).forEach(function (k) { btn(g, ST.SHAPES[k], function () { addShape(k); }, 'big'); });
        btn(g, '선', function () { addLn(false); }, 'big'); btn(g, '화살표 선', function () { addLn(true); }, 'big');
        body.appendChild(el('div', 'so-sheet-note', '넣은 도형은 슬라이드 가운데에 놓이고 바로 선택됩니다. 끌어서 옮기고, 모서리 점으로 크기를 바꾸고, 「서식」「색」으로 꾸밉니다. 도형 안에 글을 넣으려면 「글」을 누르십시오.'));
      });
    }
    function textBoxSheet() {
      var body = el('div', 'spx'), t = el('textarea', 'spx-in'); t.rows = 3; t.placeholder = '글 상자에 넣을 글'; t.setAttribute('aria-label', '글 상자의 글'); body.appendChild(t);
      ctx.sheet({ title: '글 상자', body: body, wide: true, buttons: [{ label: '취소' }, { label: '넣기', primary: true, onClick: function () {
        var g = mid(st.W * 0.5, st.H * 0.14); op('글 상자', function (x) { return ST.addTextBox(x, g, t.value || '여기에 글을 씁니다'); }, '글 상자를 넣었습니다'); } }] });
      setTimeout(function () { try { t.focus(); } catch (e) {} }, 300);
    }
    function addShape(k) { var d = Math.min(st.W, st.H) * 0.3, g = mid(k === 'rightArrow' ? d * 1.4 : d, d); op('도형', function (x) { return ST.addAutoShape(x, k, g, null, ''); }, '도형을 넣었습니다'); }
    function addLn(arrow) { var w = st.W * 0.3, g = { x: Math.round((st.W - w) / 2), y: Math.round(st.H / 2), w: Math.round(w), h: 0 }; op('선', function (x) { return ST.addLine(x, g, arrow); }, arrow ? '화살표를 넣었습니다' : '선을 넣었습니다'); }
    function tableNewSheet() {
      var r = 3, c = 3, body = el('div', 'spx'), lab = el('div', 'spx-l');
      function paint() { lab.textContent = '줄 ' + r + ' × 칸 ' + c; }
      function step(row, text, fn) { var b = el('button', 'spx-b', text); b.type = 'button'; b.onclick = function () { fn(); paint(); }; row.appendChild(b); }
      body.appendChild(lab); var r1 = el('div', 'spx-r'), r2 = el('div', 'spx-r'); body.appendChild(r1); body.appendChild(r2);
      step(r1, '줄 −', function () { r = Math.max(1, r - 1); }); step(r1, '줄 ＋', function () { r = Math.min(15, r + 1); }); step(r2, '칸 −', function () { c = Math.max(1, c - 1); }); step(r2, '칸 ＋', function () { c = Math.min(8, c + 1); });
      paint();
      ctx.sheet({ title: '표 넣기', body: body, wide: true, buttons: [{ label: '취소' }, { label: '표 넣기', primary: true, onClick: function () {
        var g = { x: Math.round(st.W * 0.1), y: Math.round(st.H * 0.3), w: Math.round(st.W * 0.8), h: 1 }; op('표', function (x) { return ST.addTable(x, r, c, g); }, '표를 넣었습니다(' + r + '×' + c + ') — 칸의 글은 「글」로 고칩니다'); } }] });
    }
    function pickPicture() {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = function () { var f = inp.files && inp.files[0]; if (!f) return; prepImage(f).then(function (im) {
        env.run('그림', function (pkg) { return ST.addPicture(pkg, st.path, im.bytes, im.ext, im.w, im.h).then(function (r) { return { sel: r.id }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } st.sel = r.sel; toast('그림을 넣었습니다', 2400); U.refreshAll(); });
      }, function (e) { toast('그림을 읽지 못했습니다: ' + ((e && e.message) || e), 4200); }); };
      inp.click();
    }
    function prepImage(f) {         // 큰 사진은 가로 1600px·JPEG 85로 줄이고, png/jpg/gif 가 아닌 것은 JPEG 로 바꾼다
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight, ty = (f.type || '').toLowerCase(), keep = /^image\/(png|jpeg|gif)$/.test(ty) && w <= 1600 && f.size < 3000000;
          if (keep) { f.arrayBuffer().then(function (ab) { URL.revokeObjectURL(url); res({ bytes: new Uint8Array(ab), ext: ty === 'image/png' ? 'png' : (ty === 'image/gif' ? 'gif' : 'jpg'), w: w, h: h }); }, rej); return; }
          var k = Math.min(1, 1600 / w), cw = Math.round(w * k), ch = Math.round(h * k), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(img, 0, 0, cw, ch);
          cv.toBlob(function (b) { URL.revokeObjectURL(url); if (!b) { rej(new Error('그림을 줄이지 못함')); return; } b.arrayBuffer().then(function (ab) { res({ bytes: new Uint8Array(ab), ext: 'jpg', w: cw, h: ch }); }, rej); }, 'image/jpeg', 0.85);
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('이 그림 형식은 열 수 없습니다')); };
        img.src = url;
      });
    }

    // ---------------- 글 · 서식 ----------------
    function textBtn() {
      var sh = sel();
      if (!sh) { env.openText(null); return; }
      if (!sh.canText) { toast('이 개체에는 글을 넣을 수 없습니다. 도형·글 상자·표를 골라 주십시오.', 3200); return; }
      var rg = ST.paraRange(st.xml, sh.id, st.cell);
      env.openText({ slide: s.idx, from: rg ? rg.from : 0, count: rg ? rg.count : 0, shapeId: sh.id, cell: st.cell });
    }
    function fmtNow() { var sh = sel(); return sh ? (ST.readFormat(st.xml, sh.id, st.cell) || {}) : {}; }
    function applyFmt(f, msg) { var sh = need('canText'); if (!sh) return; op('서식', function (x) { return ST.formatText(x, sh.id, f, st.cell); }, msg || '서식을 바꿨습니다', true); }
    function fmtSheet() {
      var sh = need('canText'); if (!sh) return; var cur = fmtNow();
      sheet('글자 서식', function (body) {
        cur = fmtNow(); sh = sel() || sh;
        var tgt = sh.kind === 'table' ? (st.cell ? '표의 ' + (st.cell.r + 1) + '줄 ' + (st.cell.c + 1) + '칸' : '표 전체') : (KIND[sh.kind] || '도형');
        body.appendChild(el('div', 'so-sheet-note', '적용 대상: ' + tgt + (sh.kind === 'table' ? ' (칸은 「표」에서 고릅니다)' : '') + ' — 안의 글 전체에 적용됩니다. 글자 일부만 꾸미려면 「글」 화면에서 글자를 끌어 고른 뒤 「고른 글자 꾸미기」를 누릅니다.'));
        var g1 = group(body, '글자');
        btn(g1, '굵게', function () { applyFmt({ bold: !cur.bold }); }, 'bold' + (cur.bold ? ' on' : '')); btn(g1, '기울임', function () { applyFmt({ italic: !cur.italic }); }, 'it' + (cur.italic ? ' on' : '')); btn(g1, '밑줄', function () { applyFmt({ underline: !cur.underline }); }, 'ul' + (cur.underline ? ' on' : ''));
        var g2 = group(body, '글자 크기(' + (cur.size ? cur.size + 'pt' : '기본') + ')');
        btn(g2, '작게 −', function () { applyFmt({ size: Math.max(8, (cur.size || 18) - 2) }); }); btn(g2, '크게 ＋', function () { applyFmt({ size: Math.min(120, (cur.size || 18) + 2) }); });
        SIZES.forEach(function (z) { btn(g2, String(z), function () { applyFmt({ size: z }); }, cur.size === z ? 'on' : ''); });
        var g3 = group(body, '글자 색'); TXT.forEach(function (c) { btn(g3, c[0], function () { applyFmt({ color: c[1] }, '글자 색을 바꿨습니다'); }, 'sw', c[1]); });
        var g4 = group(body, '정렬'); [['왼쪽', 'l'], ['가운데', 'ctr'], ['오른쪽', 'r'], ['양쪽', 'just']].forEach(function (a) { btn(g4, a[0], function () { applyFmt({ align: a[1] }); }, cur.align === a[1] ? 'on' : ''); });
        var g5 = group(body, '글머리표'); btn(g5, '글머리표 켜기', function () { applyFmt({ bullet: true }); }, cur.bullet ? 'on' : ''); btn(g5, '끄기', function () { applyFmt({ bullet: false }); });
        var gF = group(body, '글꼴' + (cur.font ? '(' + cur.font + ')' : '')); FONTS.forEach(function (fn) { btn(gF, fn, function () { applyFmt({ font: fn }, '글꼴을 바꿨습니다'); }, cur.font === fn ? 'on' : ''); });
        var gV = group(body, '글 세로 자리'); [['위', 't'], ['가운데', 'ctr'], ['아래', 'b']].forEach(function (a) { btn(gV, a[0], function () { op('글 세로 자리', function (x) { return ST.setAnchor(x, sh.id, a[1], st.cell); }, '글 자리를 바꿨습니다', true); }); });
        var g6 = group(body, '줄 추가'); btn(g6, '이 도형에 줄 추가', function () { var rg = ST.paraRange(st.xml, sh.id, st.cell); ctx.closeSheet(); setTimeout(function () { env.openText({ slide: s.idx, from: rg ? rg.from : 0, count: rg ? rg.count : 0, shapeId: sh.id, cell: st.cell }); }, 60); }, 'wide');
      }, false, true);
    }
    function colorSheet() {
      var sh = need(); if (!sh) return;
      if (!sh.canFill && !sh.canLine) { toast('이 개체에는 색·테두리를 줄 수 없습니다.', 3000); return; }
      sheet('색·테두리', function (body) {
        sh = sel() || sh;
        if (sh.canFill) { var g1 = group(body, '채우기'); FILLS.forEach(function (c) { btn(g1, c[0], function () { op('채우기', function (x) { return ST.setFill(x, sh.id, c[1]); }, '채우기 색을 바꿨습니다', true); }, 'sw', c[1] || ''); }); }
        var g2 = group(body, sh.kind === 'line' ? '선 색' : '테두리 색'); FILLS.forEach(function (c) { btn(g2, c[0], function () { op('선 색', function (x) { return ST.setLineColor(x, sh.id, c[1]); }, '선 색을 바꿨습니다', true); }, 'sw', c[1] || ''); });
        var g3 = group(body, sh.kind === 'line' ? '선 굵기' : '테두리 굵기'); [[0.5, '0.5pt'], [1, '1pt'], [2, '2pt'], [3, '3pt'], [4.5, '4.5pt'], [6, '6pt']].forEach(function (w) { btn(g3, w[1], function () { op('선 굵기', function (x) { return ST.setLineStyle(x, sh.id, { w: w[0] }); }, '굵기를 바꿨습니다', true); }); });
        var g4 = group(body, sh.kind === 'line' ? '선 모양' : '테두리 모양'); [['실선', 'solid'], ['긴 점선', 'dash'], ['점선', 'sysDot'], ['점·선', 'dashDot']].forEach(function (d) { btn(g4, d[0], function () { op('선 모양', function (x) { return ST.setLineStyle(x, sh.id, { dash: d[1] }); }, '모양을 바꿨습니다', true); }); });
        body.appendChild(el('div', 'so-sheet-note', '테두리가 없던 도형에 굵기·모양을 주면 짙은 회색 선이 생깁니다. 색은 위에서 바꿉니다.'));
      }, false, true);
    }
    // ---------------- 위치·크기 ----------------
    function nudge(dx, dy) { var sh = sel(); if (!sh || !sh.g || !sh.canMove) return; setGeom(sh.id, ST.clampGeom({ x: sh.g.x + dx, y: sh.g.y + dy, w: sh.g.w, h: sh.g.h }, st.W, st.H)); }
    function scaleBy(f) { var sh = sel(); if (!sh || !sh.g || !sh.canMove) return; var cx = sh.g.x + sh.g.w / 2, cy = sh.g.y + sh.g.h / 2, w = sh.g.w * f, h = sh.g.h * f; setGeom(sh.id, ST.clampGeom({ x: cx - w / 2, y: cy - h / 2, w: w, h: h }, st.W, st.H), '크기를 바꿨습니다'); }
    function geoSheet() {
      var sh = need(); if (!sh) return;
      if (!sh.canMove) { toast('이 개체는 폰에서 옮기거나 크기를 바꿀 수 없습니다.', 3400); return; }
      sheet('위치·크기', function (body) {
        sh = sel() || sh;
        body.appendChild(el('div', 'so-sheet-note', '끌어서 옮기고 모서리 점으로 크기를 바꿀 수도 있습니다. 아래 단추는 한 번에 0.5cm씩입니다.'));
        var g = el('div', 'spx-pad'); body.appendChild(g);
        [['↑', 0, -STEP], ['←', -STEP, 0], ['→', STEP, 0], ['↓', 0, STEP]].forEach(function (a) { var b = el('button', 'spx-b big', a[0]); b.type = 'button'; b.setAttribute('aria-label', '옮기기 ' + a[0]); b.onclick = function () { nudge(a[1], a[2]); }; g.appendChild(b); });
        var al = group(body, '슬라이드 기준 맞춤');
        [['왼쪽', function (q) { return { x: 0, y: q.g.y }; }], ['가로 가운데', function (q) { return { x: Math.round((st.W - q.g.w) / 2), y: q.g.y }; }], ['오른쪽', function (q) { return { x: Math.round(st.W - q.g.w), y: q.g.y }; }],
          ['위', function (q) { return { x: q.g.x, y: 0 }; }], ['세로 가운데', function (q) { return { x: q.g.x, y: Math.round((st.H - q.g.h) / 2) }; }], ['아래', function (q) { return { x: q.g.x, y: Math.round(st.H - q.g.h) }; }]].forEach(function (a) {
          btn(al, a[0], function () { var q = sel(); if (!q || !q.g) return; var p = a[1](q); setGeom(q.id, { x: p.x, y: p.y, w: q.g.w, h: q.g.h }, '맞췄습니다'); }, '', undefined, true);
        });
        btn(al, '정가운데', function () { var q = sel(); if (!q || !q.g) return; setGeom(q.id, { x: Math.round((st.W - q.g.w) / 2), y: Math.round((st.H - q.g.h) / 2), w: q.g.w, h: q.g.h }, '정가운데로 맞췄습니다'); }, '', undefined, true);
        var rt = group(body, '회전(지금 ' + (function () { try { return ST.readRotation(st.xml, sh.id); } catch (e) { return 0; } })() + '°)');
        function rot(d, abs) { var q = sel(); if (!q) return; op('회전', function (x) { var cur = ST.readRotation(x, q.id); return ST.setRotation(x, q.id, abs ? d : cur + d); }, '돌렸습니다', true); }
        [['↺ −90°', -90], ['↻ +90°', 90], ['−15°', -15], ['+15°', 15], ['180°', 180]].forEach(function (a) { btn(rt, a[0], function () { rot(a[1], a[0] === '180°'); }, '', undefined, true); }); btn(rt, '똑바로(0°)', function () { rot(0, true); }, '', undefined, true);
        var r = group(body, '크기·순서');
        btn(r, '크게 ×1.1', function () { scaleBy(1.1); }, '', undefined, true); btn(r, '작게 ×0.9', function () { scaleBy(0.9); }, '', undefined, true);
        btn(r, '맨 앞으로', function () { op('맨 앞으로', function (x) { return ST.reorderShape(x, sh.id, true); }, '맨 앞으로 옮겼습니다', true); }, '', undefined, true);
        btn(r, '맨 뒤로', function () { op('맨 뒤로', function (x) { return ST.reorderShape(x, sh.id, false); }, '맨 뒤로 옮겼습니다', true); }, '', undefined, true);
      }, false, true);
    }
    // ---------------- 표 ----------------
    function tableDims() { var sh = sel(); if (!sh) return { r: 0, c: 0 }; var f = ST._topShapes(st.xml).filter(function (t) { return /<p:cNvPr\b[^>]*?\sid="(\d+)"/.exec(t.xml) && +/<p:cNvPr\b[^>]*?\sid="(\d+)"/.exec(t.xml)[1] === sh.id; })[0]; if (!f) return { r: 0, c: 0 }; return { r: (f.xml.match(/<a:tr\b/g) || []).length, c: (f.xml.match(/<a:gridCol\b/g) || []).length }; }
    function tableSheet() {
      var sh = sel(); if (!sh || sh.kind !== 'table') { toast('먼저 슬라이드 위의 표를 눌러 고르십시오. (표가 없으면 「넣기」→「표」)', 3600); return; }
      sheet('표 줄·칸', function (body) {
        sh = sel() || sh;
        var d = tableDims(), cell = st.cell || { r: 0, c: 0 }; cell = { r: Math.min(cell.r, Math.max(0, d.r - 1)), c: Math.min(cell.c, Math.max(0, d.c - 1)) };
        var sp = ST.cellSpans(st.xml, sh.id), me = sp && sp[cell.r] && sp[cell.r][cell.c];
        var lab = el('div', 'spx-l'); body.appendChild(lab);
        function paint() { lab.textContent = '고른 칸: ' + (cell.r + 1) + '줄 ' + (cell.c + 1) + '칸 (표는 ' + d.r + '줄 × ' + d.c + '칸)' + (me && (me.gs > 1 || me.rs > 1) ? ' · 합쳐진 칸' : (me && me.cov ? ' · 다른 칸에 합쳐진 자리' : '')); }
        var r1 = el('div', 'spx-r'); body.appendChild(r1);
        [['줄 ↑', function () { cell.r = Math.max(0, cell.r - 1); }], ['줄 ↓', function () { cell.r = Math.min(d.r - 1, cell.r + 1); }], ['칸 ←', function () { cell.c = Math.max(0, cell.c - 1); }], ['칸 →', function () { cell.c = Math.min(d.c - 1, cell.c + 1); }]].forEach(function (a) { var b = el('button', 'spx-b', a[0]); b.type = 'button'; b.onclick = function () { a[1](); st.cell = { r: cell.r, c: cell.c }; paint(); renderCtx(); }; r1.appendChild(b); });
        paint(); st.cell = { r: cell.r, c: cell.c };
        var g = grid(body);
        function te(opn, msg) { return function () { var c0 = { r: cell.r, c: cell.c }; op('표 고치기', function (x) { var r = ST.tableEdit(x, sh.id, opn, c0.r, c0.c); return r.err ? r : r.xml; }, msg, true).then(function () { st.cell = null; }); }; }
        function tm(opn, msg) { return function () { var c0 = { r: cell.r, c: cell.c }; op('표 칸 합치기', function (x) { var r = ST.tableMerge(x, sh.id, opn, c0.r, c0.c); return r.err ? r : r.xml; }, msg, true); }; }
        btn(g, '위에 줄 추가', te('rowBefore', '줄을 넣었습니다'), 'big'); btn(g, '아래에 줄 추가', te('rowAfter', '줄을 넣었습니다'), 'big');
        btn(g, '줄 지우기', te('rowDel', '줄을 지웠습니다(되돌리려면 ↶)'), 'big danger'); btn(g, '칸 지우기(열)', te('colDel', '칸을 지웠습니다(되돌리려면 ↶)'), 'big danger');
        btn(g, '왼쪽에 칸 추가', te('colBefore', '칸을 넣었습니다'), 'big'); btn(g, '오른쪽에 칸 추가', te('colAfter', '칸을 넣었습니다'), 'big');
        btn(g, '오른쪽 칸과 합치기', tm('right', '칸을 합쳤습니다'), 'big'); btn(g, '아래 칸과 합치기', tm('down', '칸을 합쳤습니다'), 'big');
        btn(g, '가로 합치기 풀기', tm('splitH', '합친 칸을 풀었습니다'), 'big'); btn(g, '세로 합치기 풀기', tm('splitV', '합친 칸을 풀었습니다'), 'big');
        btn(g, '이 칸 글 고치기', function () { var rg = ST.paraRange(st.xml, sh.id, cell); ctx.closeSheet(); env.openText({ slide: s.idx, from: rg ? rg.from : 0, count: rg ? rg.count : 0, shapeId: sh.id, cell: { r: cell.r, c: cell.c } }); }, 'big');
        btn(g, '칸 고르기 풀기', function () { st.cell = null; renderCtx(); toast('표 전체가 대상입니다', 2000); }, 'big');
        body.appendChild(el('div', 'so-sheet-note', '합친 칸의 글은 왼쪽 위 칸으로 모입니다. 합쳐진 칸이 있는 표는 줄·칸 넣고 빼기를 막고 「수정 요청」을 안내합니다(먼저 합치기를 풀면 됩니다). 서식은 고른 칸(없으면 표 전체)에 적용됩니다.'));
      }, false, true);
    }
    // ---------------- 노트 ----------------
    function notesSheet() {
      ST.slideNotes(env.roPkg(s.info.zip), st.path).then(function (n) {
        var body = el('div', 'spx'), t = el('textarea', 'spx-in'); t.rows = 7; t.value = n.text || ''; t.placeholder = '이 슬라이드의 발표자 노트'; t.setAttribute('aria-label', '발표자 노트'); body.appendChild(t);
        body.appendChild(el('div', 'so-sheet-note', '발표자 노트는 발표할 때 발표자만 보는 메모입니다.'));
        ctx.sheet({ title: '발표자 노트 — 슬라이드 ' + (s.idx + 1), body: body, wide: true, buttons: [{ label: '취소' }, { label: '저장', primary: true, onClick: function () {
          var i = s.idx, p = st.path, txt = t.value;
          env.run('노트', function (pkg) { return ST.setNotes(pkg, p, txt).then(function (r) { return r.err ? r : { slide: i }; }); }, function (r) { if (r && r.err) { fail(r.err); return; } toast('노트를 저장했습니다', 2400); U.refreshAll(); });
        } }] });
      });
    }

    // ---------------- 맥락 줄 · 도구줄 ----------------
    function renderCtx() {
      setTimeout(refillSheet, 0);
      var t = root.querySelector('.spx-ctxt'), b = root.querySelector('.spx-ctxb'); b.innerHTML = '';
      var sh = sel();
      if (!sh) {
        t.textContent = '슬라이드 ' + (s.idx + 1) + ' / ' + s.slides.length + (clip ? ' · 복사해 둔 ' + clip.name : ' · 도형을 누르면 고를 수 있습니다');
        if (clip) { var pb = el('button', 'spx-cb', '붙여넣기'); pb.type = 'button'; pb.onclick = function () { pasteClip(); }; b.appendChild(pb); }
        return;
      }
      t.textContent = nameOf(sh) + (sh.kind === 'table' && st.cell ? ' · ' + (st.cell.r + 1) + '줄 ' + (st.cell.c + 1) + '칸' : '') + (sh.canMove ? ' · 끌어서 옮기기' : ' · 옮길 수 없는 개체');
      var dp = el('button', 'spx-cb', '복제'); dp.type = 'button'; dp.onclick = dupShape; b.appendChild(dp);
      var d = el('button', 'spx-cb danger', '지우기'); d.type = 'button'; d.onclick = delShape; b.appendChild(d);
    }
    var ITEMS = {
      slide: { g: '▭', l: '슬라이드', run: slideSheet }, ins: { g: '＋', l: '넣기', run: insertSheet }, text: { g: '가', l: '글', run: textBtn }, fmt: { g: 'Aa', l: '서식', run: fmtSheet },
      geo: { g: '⤢', l: '위치·크기', run: geoSheet }, color: { g: '◐', l: '색·선', run: colorSheet }, table: { g: '▦', l: '표', run: tableSheet }, notes: { g: '✎', l: '노트', run: notesSheet },
      copy: { g: '⧉', l: '복사', run: copySheet },
      show: { g: '▶', l: '쇼', run: function () { env.slideshow(s.idx); } }
    };
    var ORDER = ['slide', 'ins', 'text', 'fmt', 'geo', 'color', 'copy', 'table', 'notes', 'show'];
    function mk(id, hostEl, inSheet) {
      var it = ITEMS[id], b = el('button', inSheet ? 'spx-mb' : 'spx-ob'); b.type = 'button'; b.setAttribute('aria-label', it.l);
      b.appendChild(el('span', 'g', it.g)); b.appendChild(el('span', 'l', it.l));
      b.onclick = function () { if (inSheet) ctx.closeSheet(); setTimeout(it.run, inSheet ? 60 : 0); }; hostEl.appendChild(b); return b;
    }
    function renderTools() {
      var row = root.querySelector('.spx-tools'), n = perRow(), shown = ORDER.length > n ? ORDER.slice(0, n) : ORDER, rest = ORDER.length > n ? ORDER.slice(n) : [];
      row.innerHTML = ''; shown.forEach(function (id) { mk(id, row, false); });
      if (rest.length) { var mb = el('button', 'spx-ob'); mb.type = 'button'; mb.setAttribute('aria-label', '더보기'); mb.appendChild(el('span', 'g', '⋯')); mb.appendChild(el('span', 'l', '더보기')); mb.onclick = function () { sheet('더보기', function (body) { var g = el('div', 'spx-mg'); body.appendChild(g); rest.forEach(function (id) { mk(id, g, true); }); }); }; row.appendChild(mb); }
      bucket = n;
    }
    global.addEventListener('resize', function () { if (up && root && bucket !== perRow()) renderTools(); if (up && root && root.style.display !== 'none') { clearTimeout(U._rt); U._rt = setTimeout(function () { if (up && sel !== undefined && root) renderStage(); }, 150); } });
    // ---------------- 키보드(DeX) ----------------
    function typing(e) { var t = e.target; return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)); }
    function bindKeys() {
      if (keyFn) return;
      keyFn = function (e) {
        if (!up || typing(e) || !root || root.style.display === 'none') return;
        if (document.querySelector('.so-sheet-back')) return;
        var k = e.key, c = e.ctrlKey || e.metaKey, sh = sel();
        if (c) {
          var kk = String(k).toLowerCase();
          if (kk === 'z' && !e.shiftKey) { e.preventDefault(); env.undo(); } else if (kk === 'y' || (kk === 'z' && e.shiftKey)) { e.preventDefault(); env.redo(); }
          else if (kk === 'b' && sh && sh.canText) { e.preventDefault(); applyFmt({ bold: !fmtNow().bold }); } else if (kk === 'i' && sh && sh.canText) { e.preventDefault(); applyFmt({ italic: !fmtNow().italic }); } else if (kk === 'u' && sh && sh.canText) { e.preventDefault(); applyFmt({ underline: !fmtNow().underline }); }
          else if (kk === 'c' && sh) { e.preventDefault(); copySel(false); } else if (kk === 'x' && sh) { e.preventDefault(); copySel(true); } else if (kk === 'v') { e.preventDefault(); pasteClip(); }
          else if (kk === 'd') { e.preventDefault(); if (sh) dupShape(); else dup(); }
          return;
        }
        if ((k === 'Delete' || k === 'Backspace') && sh) { e.preventDefault(); delShape(); }
        else if (k === 'Escape') { U.back(); }
        else if (sh && sh.canMove && /^Arrow/.test(k)) { e.preventDefault(); var m = e.shiftKey ? STEP * 5 : STEP / 5; nudge(k === 'ArrowLeft' ? -m : k === 'ArrowRight' ? m : 0, k === 'ArrowUp' ? -m : k === 'ArrowDown' ? m : 0); }
        else if (!sh && (k === 'ArrowRight' || k === 'PageDown')) goSlide(s.idx + 1); else if (!sh && (k === 'ArrowLeft' || k === 'PageUp')) goSlide(s.idx - 1);
        else if (k === 'PageDown') goSlide(s.idx + 1); else if (k === 'PageUp') goSlide(s.idx - 1);
      };
      document.addEventListener('keydown', keyFn);
    }
    function unbindKeys() { if (keyFn) { document.removeEventListener('keydown', keyFn); keyFn = null; } }
    return U;
  }

  // ============================== 슬라이드 쇼(전체 화면 발표) ==============================
  function slideshow(o) {
    var s = o.s, ctx = o.ctx, list = [], pos = 0, ov = el('div', 'spx-show'), stg = el('div', 'spx-show-s'), cnt = el('div', 'spx-show-c'), hint = el('div', 'spx-show-h', '탭·→ 다음 · ← 이전 · Esc 끝내기');
    ov.appendChild(stg); ov.appendChild(cnt); ov.appendChild(hint); document.body.appendChild(ov);
    var hid = {};
    var p = s.info && global.SOPptxStruct ? global.SOPptxStruct.listSlides({ read: function (q) { var f = s.info.zip.file(q); return f ? f.async('string') : Promise.resolve(null); }, list: function () { return Object.keys(s.info.zip.files); } }).then(function (r) { r.slides.forEach(function (x, i) { hid[i] = x.hidden; }); }, function () {}) : Promise.resolve();
    function draw() {
      stg.innerHTML = ''; var i = list[pos], src = s.slides[i]; if (!src) return;
      var w = parseFloat(src.style.width) || src.offsetWidth || s.drawW || 960, h = parseFloat(src.style.height) || src.offsetHeight || s.sh || 540;
      var k = Math.min(global.innerWidth / w, global.innerHeight / h), c = src.cloneNode(true); c.style.display = ''; c.style.margin = '0'; c.style.zoom = String(k); stg.appendChild(c);
      cnt.textContent = (pos + 1) + ' / ' + list.length; hint.classList.add('hide');
    }
    function go(d) { var n = pos + d; if (n < 0) return; if (n >= list.length) { end(); return; } pos = n; draw(); }
    function end() {
      document.removeEventListener('keydown', key, true); global.removeEventListener('resize', draw);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
      if (ov.parentNode) ov.parentNode.removeChild(ov); ctx.onBack(null); if (o.done) o.done();
    }
    function key(e) {
      var k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } else if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') { e.preventDefault(); e.stopPropagation(); go(1); } else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); go(-1); }
    }
    ov.addEventListener('click', function (e) { var r = ov.getBoundingClientRect(); go(e.clientX - r.left < r.width * 0.3 ? -1 : 1); });
    var x0 = null; ov.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) { e.preventDefault(); go(dx < 0 ? 1 : -1); } });
    p.then(function () {
      s.slides.forEach(function (x, i) { if (!hid[i]) list.push(i); }); if (!list.length) s.slides.forEach(function (x, i) { list.push(i); });
      pos = Math.max(0, list.indexOf(o.start)); if (pos < 0) pos = 0;
      document.addEventListener('keydown', key, true); global.addEventListener('resize', draw);
      ctx.onBack(function () { end(); return true; });
      try { if (ov.requestFullscreen) ov.requestFullscreen().catch(function () {}); } catch (e) {}
      draw(); hint.classList.remove('hide'); setTimeout(function () { hint.classList.add('hide'); }, 3200);
    });
  }
  global.SOPptxUI = { create: create, slideshow: slideshow };
})(window);

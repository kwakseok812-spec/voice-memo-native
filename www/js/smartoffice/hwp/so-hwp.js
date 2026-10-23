/* ============================================================================
 * so-hwp.js — S-Office 한글(HWP·HWPX) 모듈
 * ----------------------------------------------------------------------------
 * 부품 파일은 www/vendor/so/hwp/ 에 있다(앱 포함).
 *   vendor/so/hwp/studio/   rhwp-studio 편집 화면(오픈소스 이음오피스 설치본에서 가져온 빌드: 패치한 rhwp WASM 포함, AI 플러그인 뺌)
 *   vendor/so/hwp/sdk/      @rhwp/editor 0.8.7 (index.js · transport.js · document-agent-contract.js) — MIT
 *   vendor/so/hwp/studio/fonts/  폰에 없는 PC 글꼴의 대체 글꼴(Pretendard·Noto Serif KR 일부 글자, OFL)
 *
 * 출처: rhwp(MIT, Copyright (c) 2025-2026 Edward Kim) / 이음오피스(IeumOffice, Apache-2.0)와 GenOffice(Apache-2.0)의
 *       일부 빌드를 사용했다. 정보 화면과 NOTICE.txt 참고. AI 플러그인은 넣지 않았다.
 *
 * 동작
 *   · 열면 「보기 상태」: 화면을 읽기만 한다(글자 칸이 키보드를 띄우지 않게 막음). 한글 입력 실기기 확인 전까지의 안전장치.
 *   · 머리줄 [고치기]를 눌러야 편집이 켜지고, 아래에 폰용 간단 도구줄(실행 취소·굵게·기울임·밑줄·글자 크기·정렬·확대)이 나온다.
 *   · PC용 메뉴·도구줄·상태줄은 숨기고(요소 id 로 CSS 숨김), 쪽 위치는 「3 / 12」 알약으로 보여 준다(누르면 쪽 이동).
 *   · 두 손가락 벌리기·오므리기 = 확대·축소. 키보드가 올라오면 visualViewport 로 화면 높이를 맞춘다.
 *   · 고친 내용 복구: 공통 틀이 snapshot()으로 고친 문서 전체를 바이트로 받아 두고, 같은 파일을 다시 열면 restore()로 편집 상태를 되살린다.
 *   · 도구줄은 자주 쓰는 것 한 줄 + 「⋯」 더보기 줄(정렬·확대·찾기). 넓은 화면(펼침)은 한 줄에 모두.
 *   · 저장은 언제나 「사본 저장」(원본은 건드리지 않는다). 저장 전에 한 번 확인(공유함 업로드 안내) → 사본 이름에 무작위 꼬리표.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global.SOffice) return;

  var SO_HWP = 'on';                       // 이 모듈 스위치 — 'off' 면 한글은 ①(변환해서 보기)로만 열린다
  var STUDIO_URL = 'vendor/so/hwp/studio/index.html?chrome=embed&lang=ko';
  var SDK_URL = 'vendor/so/hwp/sdk/index.js';
  var TB_H = 54;                           // 아래 도구줄 높이(px)

  var st = null;      // { editor, iframe, editing, wrap, frame, tb, pill, timers, pages, ... }

  function baseOf(name) { return String(name || '문서').replace(/\.[^.]+$/, ''); }
  function readBytes(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = function () { rej(new Error('파일을 읽지 못했습니다.')); }; fr.readAsArrayBuffer(file);
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function doc() { try { return st && st.iframe && st.iframe.contentDocument; } catch (e) { return null; } }

  // ---- 보기 상태 보호: 같은 출처의 편집 화면 안에서 글자 입력 길을 막는다 ----
  var GUARD_EVENTS = ['beforeinput', 'keydown', 'keypress', 'compositionstart', 'paste', 'cut', 'drop'];
  function guardHandler(e) {
    if (e.type === 'keydown' && !e.ctrlKey && !e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(e.key) >= 0) return;
    e.preventDefault(); e.stopPropagation();
  }
  function setReadOnly(on) {
    var d = doc(); if (!d) return false;
    GUARD_EVENTS.forEach(function (n) { d.removeEventListener(n, guardHandler, true); if (on) d.addEventListener(n, guardHandler, true); });
    // 글자 입력 칸(숨은 textarea·input)이 키보드를 띄우지 않게
    Array.prototype.forEach.call(d.querySelectorAll('textarea,input,[contenteditable]'), function (e) {
      if (on) { e.setAttribute('data-so-ro', '1'); if (e.tagName !== 'DIV') e.readOnly = true; e.setAttribute('inputmode', 'none'); }
      else if (e.getAttribute('data-so-ro')) { e.removeAttribute('data-so-ro'); if (e.tagName !== 'DIV') e.readOnly = false; e.removeAttribute('inputmode'); }
    });
    return true;
  }

  // ---- 폰 화면: PC용 메뉴·도구줄·상태줄을 숨기고(아래 간단 도구줄로 대신), 눈금자는 자리만 남긴다(숨기면 쪽 그림이 틀어짐) ----
  function injectStudioCss(d) {
    if (d.getElementById('so-hwp-phone-css')) return;
    var s = d.createElement('style'); s.id = 'so-hwp-phone-css';
    s.textContent = '#menu-bar,#icon-toolbar,#style-bar,#studio-header,#status-bar{display:none !important}' +
      '#h-ruler,#v-ruler,#ruler-corner{visibility:hidden !important}' +
      'html,body,#scroll-container{touch-action:pan-x pan-y !important;overscroll-behavior:contain}';
    d.head.appendChild(s);
  }
  function kickResize() {
    if (!st || st.kick) return;
    st.kick = setTimeout(function () { if (!st) return; st.kick = null; try { st.iframe.contentWindow.dispatchEvent(new Event('resize')); } catch (e) {} }, 60);
  }
  function layout() {
    if (!st || !st.wrap) return;
    var b = st.ctx.body.getBoundingClientRect(), vv = global.visualViewport;
    var bottomEdge = vv ? (vv.height + vv.offsetTop) : global.innerHeight;   // 키보드가 올라오면 보이는 높이만큼만 쓴다
    var h = Math.max(160, Math.round(bottomEdge - b.top));
    st.wrap.style.top = Math.round(b.top) + 'px'; st.wrap.style.height = h + 'px';
    arrangeExtra(global.innerWidth >= 640);
    var rows = st.editing ? (1 + ((!st.wide && st.moreOpen) ? 1 : 0)) : 0, tb = rows * TB_H;
    st.wrap.classList.toggle('more', !!(st.editing && !st.wide && st.moreOpen));
    st.frame.style.height = (h - tb) + 'px';
    st.pill.style.bottom = (tb + 12) + 'px';
    kickResize();
  }

  // ---- 아래 간단 도구줄(누르면 편집 화면의 같은 단추를 대신 누른다) ----
  function clickIn(sel) {      // 편집 화면의 단추는 click 만 듣는 것(메뉴 항목)과 mousedown 을 듣는 것(작은 단추)이 섞여 있어 눌림 순서를 모두 보낸다
    var d = doc(); if (!d) return false; var e = d.querySelector(sel); if (!e) return false;
    if (/^\[data-cmd/.test(sel)) { e.click(); return true; }
    ['mousedown', 'mouseup', 'click'].forEach(function (t) { e.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: d.defaultView })); });
    return true;
  }
  var TB_MAIN = [
    { t: '↶', sel: '[data-cmd="edit:undo"]', label: '실행 취소' }, { t: '↷', sel: '[data-cmd="edit:redo"]', label: '다시 실행' },
    { t: 'B', sel: '#btn-bold', label: '굵게', state: true }, { t: 'I', cls: 'it', sel: '#btn-italic', label: '기울임', state: true }, { t: 'U', cls: 'ul', sel: '#btn-underline', label: '밑줄', state: true },
    { t: '가－', sel: '[data-cmd="format:font-size-decrease"]', label: '글자 작게' }, { t: '가＋', sel: '[data-cmd="format:font-size-increase"]', label: '글자 크게' }
  ];
  var TB_EXTRA = [
    { t: '좌', sel: '[data-cmd="format:align-left"]', ss: '#btn-align-left', label: '왼쪽 정렬', state: true }, { t: '중', sel: '[data-cmd="format:align-center"]', ss: '#btn-align-center', label: '가운데 정렬', state: true },
    { t: '우', sel: '[data-cmd="format:align-right"]', ss: '#btn-align-right', label: '오른쪽 정렬', state: true }, { t: '양', sel: '[data-cmd="format:align-justify"]', ss: '#btn-align-justify', label: '양쪽 정렬', state: true },
    { t: '－', sel: '#sb-zoom-out', label: '축소' }, { t: '＋', sel: '#sb-zoom-in', label: '확대' }, { t: '폭', sel: '#sb-zoom-fit-width', label: '폭에 맞추기' },
    { t: '찾기', sel: '[data-cmd="edit:find"]', label: '찾기' }
  ];
  function mkBtn(d0, host) {
    var b = el('button', d0.cls || '', d0.t); b.type = 'button'; b.setAttribute('aria-label', d0.label); b.title = d0.label;
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });       // 글자 칸의 포커스(키보드)를 빼앗지 않는다
    b.addEventListener('click', function () { if (!clickIn(d0.sel)) st.ctx.toast('지금은 쓸 수 없어요.', 1800); else if (d0.state || /edit:undo|edit:redo|font-size/.test(d0.sel)) markDirty(); });
    host.appendChild(b); if (d0.state) st.tbBtns.push({ b: b, sel: d0.ss || d0.sel });
    return b;
  }
  function buildToolbar() {
    var tb = el('div', 'so-hwp-tb'); tb.setAttribute('role', 'toolbar'); tb.setAttribute('aria-label', '한글 고치기 도구');
    var tb2 = el('div', 'so-hwp-tb so-hwp-tb2'); tb2.setAttribute('role', 'toolbar'); tb2.setAttribute('aria-label', '한글 고치기 도구 더보기');
    st.tbBtns = []; st.tb2 = tb2; st.extraBtns = [];
    TB_MAIN.forEach(function (d0) { mkBtn(d0, tb); });
    st.moreBtn = el('button', 'more', '⋯'); st.moreBtn.type = 'button'; st.moreBtn.setAttribute('aria-label', '더보기'); st.moreBtn.setAttribute('aria-expanded', 'false');
    st.moreBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); });
    st.moreBtn.addEventListener('click', function () { st.moreOpen = !st.moreOpen; st.moreBtn.classList.toggle('on', st.moreOpen); st.moreBtn.setAttribute('aria-expanded', String(st.moreOpen)); layout(); });
    tb.appendChild(st.moreBtn);
    TB_EXTRA.forEach(function (d0) { st.extraBtns.push(mkBtn(d0, tb2)); });
    return tb;
  }
  // 좁은 화면(폰)은 정렬·확대·찾기를 「더보기」 줄로, 넓은 화면(펼침)은 한 줄에 모두
  function arrangeExtra(wide) {
    if (st.wide === wide) return; st.wide = wide;
    st.extraBtns.forEach(function (b) { (wide ? st.tb : st.tb2).appendChild(b); });
    st.moreBtn.style.display = wide ? 'none' : '';
    if (wide) st.moreOpen = false;
  }
  function syncState() {
    var d = doc(); if (!d || !st) return;
    if (st.editing) st.tbBtns.forEach(function (x) {
      var e = d.querySelector(x.sel);
      var on = !!(e && (e.classList.contains('active') || e.classList.contains('on') || e.classList.contains('pressed') || e.getAttribute('aria-pressed') === 'true'));
      x.b.classList.toggle('on', on);
    });
    var p = d.getElementById('sb-page'), m = p && /(\d+)\s*\/\s*(\d+)/.exec(p.textContent || '');      // 쪽 알약(3 / 12)
    if (m && !st.pillEditing) { st.pages = +m[2]; st.pill.textContent = m[1] + ' / ' + m[2]; }
  }
  function goPage(n) {
    var d = doc(); if (!d || !st.pages) return;
    var sc = d.getElementById('scroll-container'); if (!sc) return;
    n = Math.max(1, Math.min(st.pages, n | 0));
    sc.scrollTop = Math.round((n - 1) / st.pages * sc.scrollHeight);            // 쪽 높이가 거의 같다고 보고 어림으로 간다(알약이 바로 맞춰 바뀐다)
  }
  function buildPill() {
    var p = el('button', 'so-hwp-pill', '… / …'); p.type = 'button'; p.setAttribute('aria-label', '쪽 이동');
    p.addEventListener('click', function () {
      if (st.pillEditing) return;
      st.pillEditing = true; p.textContent = '';
      var i = el('input'); i.type = 'number'; i.min = 1; i.max = st.pages || 999; i.inputMode = 'numeric'; i.setAttribute('aria-label', '이동할 쪽'); p.appendChild(i);
      var done = function (go) { if (!st || !st.pillEditing) return; var v = parseInt(i.value, 10); st.pillEditing = false; if (go && v) goPage(v); syncState(); };
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
      i.addEventListener('blur', function () { done(true); });
      i.focus();
    });
    return p;
  }
  // ---- 두 손가락 벌리기·오므리기 = 확대·축소(편집 화면의 확대 단추를 단계별로 누른다) ----
  function bindPinch(d) {
    var pz = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.hypot(dx, dy); }
    d.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pz = { d0: dist(e.touches) }; }, { passive: true, capture: true });
    d.addEventListener('touchmove', function (e) {
      if (!pz || e.touches.length !== 2) return;
      e.preventDefault();
      var r = dist(e.touches) / pz.d0;
      if (r > 1.15) { clickIn('#sb-zoom-in'); pz.d0 = dist(e.touches); } else if (r < 0.87) { clickIn('#sb-zoom-out'); pz.d0 = dist(e.touches); }
    }, { passive: false, capture: true });
    d.addEventListener('touchend', function (e) { if (e.touches.length < 2) pz = null; }, true);
  }

  // 고친 내용이 있는지: 편집 화면의 변경 알림(onDocumentChanged)은 쓸 수 없는 경우가 있어, 편집 중 글자 입력·지우기·붙이기·도구줄 조작을 직접 본다
  function markDirty() { if (!st || !st.editing) return; st.dirty = true; try { st.ctx.setDirty(true); } catch (e) {} }
  var NAV_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
  function bindDirty(d) {
    ['beforeinput', 'compositionend', 'paste', 'cut', 'drop'].forEach(function (n) { d.addEventListener(n, function (e) { if (!e.defaultPrevented) markDirty(); }, false); });
    d.addEventListener('keydown', function (e) {
      if (!st || !st.editing || NAV_KEYS.indexOf(e.key) >= 0) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y', 'v', 'x', 'b', 'i', 'u'].indexOf(String(e.key).toLowerCase()) < 0) return;
      markDirty();
    }, false);
  }

  function setActions(ctx) {
    if (!st) return;
    if (!st.editing) ctx.setActions([{ label: '고치기', primary: true, onClick: function () { startEdit(ctx); } }]);
    else ctx.setActions([{ label: '사본 저장', primary: true, onClick: function () { saveCopy(ctx); } }, { label: '보기', onClick: function () { stopEdit(ctx); } }]);
  }
  function applyMode(ctx) {
    st.wrap.classList.toggle('editing', st.editing);
    setReadOnly(!st.editing); setActions(ctx); layout();
  }
  function startEdit(ctx) {
    if (!st) return;
    st.editing = true; applyMode(ctx);
    ctx.toast('고치는 중입니다. 저장은 「사본 저장」으로 새 파일이 만들어집니다(원본은 그대로).', 4200);
  }
  function stopEdit(ctx) {
    if (!st) return;
    var go = function () { st.editing = false; applyMode(ctx); ctx.setDirty(false); };
    if (st.dirty) ctx.confirm('고친 내용이 저장되지 않았어요', '보기로 돌아가도 고친 내용은 화면에 남지만, 닫으면 사라집니다.', '보기로', go); else go();
  }

  // 고친 문서 전체를 엔진의 내보내기로 바이트로 뽑는다(hwp 는 다시 읽어 쪽 수가 같은지 점검한 뒤)
  function exportBytes() {
    var ext = (st.ctx.ext === 'hwpx') ? 'hwpx' : 'hwp', ed = st.editor;
    if (ext === 'hwpx') return ed.exportHwpx();
    return ed.exportHwpVerify().then(function (v) {
      if (!v || !v.recovered || v.pageCountBefore !== v.pageCountAfter) throw new Error('저장 전 점검에서 문서를 다시 읽지 못해 저장을 멈췄습니다.');
      return ed.exportHwp();
    });
  }
  // ---- 고친 내용 복구(공통 틀이 고치는 동안 15초마다·앱이 내려갈 때 snapshot(), 같은 파일을 다시 열면 restore()) ----
  var SNAP_MAX_FILE = 30 * 1024 * 1024, SNAP_SLOW_MS = 4000;
  function snapshot() {
    var s = st;
    if (!s || !s.editor || !s.dirty || s.exporting || s.composing || s.snapOff) return Promise.resolve(null);     // 글자 조합 중에는 건드리지 않는다
    if (s.ctx.file && s.ctx.file.size > SNAP_MAX_FILE) { s.snapOff = true; s.ctx.toast('문서가 커서 고친 내용 자동 보관은 건너뜁니다. 중간에 「사본 저장」을 눌러 주세요.', 5200); return Promise.resolve(null); }
    s.exporting = true; var t0 = Date.now();
    return exportBytes().then(function (bytes) {
      s.exporting = false;
      if (Date.now() - t0 > SNAP_SLOW_MS && !s.snapOff) { s.snapOff = true; s.ctx.toast('문서가 커서 화면이 멈출 수 있어 고친 내용 자동 보관을 멈춥니다. 중간에 「사본 저장」을 눌러 주세요.', 5200); }
      if (!bytes || bytes.length < 512) return null;
      return { blob: new Blob([bytes], { type: 'application/octet-stream' }), name: s.ctx.name, ext: s.ctx.ext };
    }, function () { s.exporting = false; return null; });
  }
  function restore(data) {
    var s = st; if (!s || !s.editor) return Promise.resolve(false);
    var b = data && (data.blob || data), p;
    if (b instanceof Blob) p = readBytes(b); else if (b instanceof ArrayBuffer) p = Promise.resolve(new Uint8Array(b)); else p = Promise.resolve(b);
    return p.then(function (bytes) {
      if (!bytes || !bytes.length) throw new Error('보관된 내용이 비어 있습니다.');
      s.ctx.busy('고치던 내용을 불러오는 중…');
      return s.editor.loadFile(bytes, s.ctx.name, { skipUnsavedGuard: true });
    }).then(function () {
      if (st !== s) return false;
      s.ctx.busy(null); s.dirty = true; s.ctx.setDirty(true); s.editing = true; applyMode(s.ctx);
      s.ctx.toast('이전에 고치던 내용을 이어서 열었어요. 저장은 「사본 저장」으로 하세요.', 4600);
      return true;
    }).catch(function () { if (st === s) { s.ctx.busy(null); s.ctx.toast('고치던 내용을 불러오지 못해 원본을 열었어요.', 4600); } return false; });
  }

  function saveCopy(ctx) {
    if (!st || !st.editor) return;
    var ext = (ctx.ext === 'hwpx') ? 'hwpx' : 'hwp';
    var name = baseOf(ctx.name) + '_수정.' + ext;      // 같은 이름 중복 처리는 공통 틀이 한다
    ctx.confirmCopy('사본을 저장할까요?',
      '고친 문서를 새 파일로 저장합니다.\n저장 이름: ' + name,
      '저장하기', function () {
        ctx.busy('사본을 만드는 중…');
        exportBytes().then(function (bytes) {
          ctx.busy(null);
          if (!bytes || bytes.length < 512) throw new Error('저장할 내용이 비어 있습니다.');
          return Promise.resolve(ctx.saveCopy(new Blob([bytes], { type: ext === 'hwpx' ? 'application/haansofthwpx' : 'application/x-hwp' }), name)).then(function (ok) {
            if (ok === false) return;   // 저장 실패는 틀이 안내한다 — 성공이 확인된 뒤에만 고침 해제
            ctx.setDirty(false); if (st) st.dirty = false;
            try { st.editor.notifySaved(name); } catch (e) {}
          });
        }).catch(function (e) { ctx.busy(null); ctx.toast('저장하지 못했습니다 — ' + ((e && e.message) || e), 6000); });
      });
  }

  function open(ctx) {
    st = { editor: null, iframe: null, editing: false, ctx: ctx, dirty: false, timers: [], pages: 0, pillEditing: false };
    ctx.loadCss('js/smartoffice/hwp/so-hwp.css');
    ctx.body.style.overflow = 'hidden';
    var wrap = el('div', 'so-hwp-wrap'), frame = el('div', 'so-hwp-frame');
    wrap.appendChild(frame); st.wrap = wrap; st.frame = frame;
    st.tb = buildToolbar(); wrap.appendChild(st.tb2); wrap.appendChild(st.tb);
    st.pill = buildPill(); wrap.appendChild(st.pill);
    ctx.body.appendChild(wrap);
    st.onVV = function () { layout(); };
    if (global.visualViewport) { global.visualViewport.addEventListener('resize', st.onVV); global.visualViewport.addEventListener('scroll', st.onVV); }
    global.addEventListener('resize', st.onVV); global.addEventListener('orientationchange', st.onVV);
    layout();

    // 처음 열기는 번들이 커서(약 23MB) 몇 초 걸린다 — 단계 문구와 지난 시간을 보여 준다
    var t0 = Date.now(), stage = '한글 화면을 준비하는 중… (처음 열 때는 조금 걸려요)';
    var tick = setInterval(function () { if (!st) return; var sec = Math.round((Date.now() - t0) / 1000); ctx.busy(stage + (sec >= 2 ? '  ' + sec + '초' : '')); }, 1000);
    st.timers.push(tick); ctx.busy(stage);

    // 한글 편집 화면이 OS 테마가 아니라 앱의 밝음/어두움을 따르게, 열기 전에 편집 화면 설정(같은 출처 localStorage)에 적어 둔다
    try {
      var appTheme = document.documentElement.getAttribute('data-style') === 'light' ? 'light' : 'dark';
      var rs = JSON.parse(localStorage.getItem('rhwp-settings') || '{}') || {}; rs.theme = rs.theme || {}; rs.theme.mode = appTheme;
      localStorage.setItem('rhwp-settings', JSON.stringify(rs));
    } catch (e) {}
    return Promise.all([import('../../../' + SDK_URL), readBytes(ctx.file)]).then(function (r) {
      var sdk = r[0], bytes = r[1];
      return sdk.createEditor(frame, { studioUrl: STUDIO_URL, requestTimeoutMs: 60000 }).then(function (ed) {
        st.editor = ed; st.iframe = frame.querySelector('iframe');
        stage = '문서를 읽어 쪽을 그리는 중…';
        return ed.loadFile(bytes, ctx.name, { skipUnsavedGuard: true });
      });
    }).then(function () {
      clearInterval(tick);
      var d = doc(); if (d) { injectStudioCss(d); bindPinch(d); bindDirty(d); d.addEventListener('compositionstart', function () { if (st) st.composing = true; }, true); d.addEventListener('compositionend', function () { if (st) st.composing = false; }, true); }
      applyMode(ctx); ctx.busy(null);
      st.timers.push(setInterval(syncState, 400)); syncState();
      try { if (st.editor.onDocumentChanged) st.editor.onDocumentChanged(function () { markDirty(); }); } catch (e) {}
    }, function (e) { clearInterval(tick); throw e; });
  }
  function close() {
    if (!st) return;
    var s0 = st; st = null;
    s0.timers.forEach(function (t) { clearInterval(t); }); if (s0.kick) clearTimeout(s0.kick);
    if (global.visualViewport && s0.onVV) { global.visualViewport.removeEventListener('resize', s0.onVV); global.visualViewport.removeEventListener('scroll', s0.onVV); }
    if (s0.onVV) { global.removeEventListener('resize', s0.onVV); global.removeEventListener('orientationchange', s0.onVV); }
    try { if (s0.editor && s0.editor.destroy) s0.editor.destroy(); } catch (e) {}
    try { if (s0.iframe) s0.iframe.src = 'about:blank'; } catch (e) {}          // 한글 엔진이 쓰던 메모리를 바로 풀어 준다
    try { if (s0.wrap && s0.wrap.parentNode) s0.wrap.parentNode.removeChild(s0.wrap); } catch (e) {}
  }

  SOffice.register({
    id: 'hwp', label: '한글', editable: true,
    credits: [
      { name: 'rhwp (Edward Kim)', license: 'MIT', note: '한글 문서 해석·그리기·편집 엔진(이음오피스가 한컴 문서 모양에 맞게 고친 빌드)' },
      { name: '이음오피스 / GenOffice 의 일부 빌드', license: 'Apache-2.0', note: '한글 편집 화면 번들(수정해서 사용)' },
      { name: 'CanvasKit (Skia)', license: 'BSD-3-Clause', note: '한글 화면 그리기' },
      { name: 'Pretendard (고딕 대체) · Noto Serif KR (명조 대체) 일부 글자', license: 'SIL OFL 1.1', note: '폰에 없는 PC 글꼴의 대체 글꼴(이름을 바꾼 파생본 · 라이선스 vendor/so/hwp/studio/fonts/*-OFL.txt)' }
    ],
    canOpen: function () { return SO_HWP === 'on'; },
    open: open, close: close, snapshot: snapshot, restore: restore,
    _state: function () { return st; }                  // 점검용(시험에서 상태를 들여다본다)
  });
})(window);

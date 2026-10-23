/* ============================================================================
 * so-core.js — S-Office 공통 틀 (스마트비서 안 문서 열기 방식 ②「S-Office로 열기」)
 * ----------------------------------------------------------------------------
 * 하는 일
 *   · 문서 뷰어 열기 흐름(docviewer.js handleLocalFile)에 「열기 방식」 2갈래를 붙인다.
 *       ①「변환해서 보기」 = 기존 PC 변환 PDF(수정 요청 그대로)   ②「S-Office로 열기」 = 폰 안 뷰어·편집기
 *     마지막 선택을 기억하고(기본 ①), ②를 골랐는데 아직 못 여는 형식이면 자동으로 ①로 보낸다(임시 안전장치).
 *   · 형식 모듈(www/js/smartoffice/<형식>/so-<형식>.js)을 처음 필요할 때 불러와 연결한다.
 *   · 모듈이 그릴 전체 화면 틀(머리줄·본문·바쁨 표시·정보 화면)을 준다.
 * AI 기능은 없다.
 *
 * 스위치(앱 포함 · 켠 채로 배포, 이 값 하나로 전부 끈다)
 *   SO_ON = 'off' → 열기 방식 줄이 사라지고 handleLocalFile 은 예전과 똑같이 움직인다.
 *
 * ── 형식 모듈 만들기 (병렬 작업자용) ───────────────────────────────────────
 *   파일: www/js/smartoffice/<fmt>/so-<fmt>.js   (<fmt> = hwp | pdf | xlsx | docx | pptx | md | html)
 *   이 파일 하나만 고치면 된다(so-core.js · index.html · docviewer.js · app.js 는 건드리지 않는다).
 *   라이브러리는 www/vendor/so/<fmt>/ 에 둔다. 모듈 스타일은 www/js/smartoffice/<fmt>/so-<fmt>.css 를
 *   ctx.loadCss('js/smartoffice/<fmt>/so-<fmt>.css') 로 부른다.
 *
 *   SOffice.register({
 *     id: 'xlsx',                       // <fmt> 와 같게
 *     label: '엑셀',                     // 화면에 보일 이름
 *     editable: false,                  // 직접 고치기 지원 여부(정보용)
 *     credits: [ { name:'SheetJS', license:'Apache-2.0', note:'' } ],   // 정보 화면에 보일 출처(선택)
 *     canOpen: function (ext) { return true; },   // false 면 이 형식은 자동으로 ①(선택)
 *     open: function (ctx) { ... return Promise|undefined; },   // 문서를 연다
 *     close: function () { ... }        // 닫을 때 메모리 풀기(선택)
 *   });
 *
 *   ctx (모듈이 받는 것)
 *     ctx.file        File    열 문서
 *     ctx.name, ctx.ext
 *     ctx.body        HTMLElement  모듈이 그릴 자리(position:relative, 꽉 찬 영역). 닫을 때 비워진다.
 *     ctx.setTitle(s)                 머리줄 제목(기본: 파일 이름)
 *     ctx.setActions([{label, onClick, primary, disabled, id}])   머리줄 오른쪽 단추(교체식)
 *     ctx.busy(msg|null)              바쁨 표시(문구) 켜기/끄기
 *     ctx.toast(msg, ms)              앱 토스트
 *     ctx.error(msg, sub)             열기 실패 화면(뒤로 가면 닫힘)
 *     ctx.fallback(reason)            이 형식은 ①로 보낸다(변환해서 보기). S-Office 화면은 닫힌다.
 *     ctx.loadScript(path)  → Promise  www 기준 경로 스크립트를 한 번만 불러옴(예: 'vendor/so/hwp/x.js')
 *     ctx.loadCss(path)
 *     ctx.saveCopy(fileOrBlob, name)  → 폰/PC 에 사본 저장(원본은 덮어쓰지 않는다)
 *     ctx.setDirty(bool)              고친 내용이 있는지(닫을 때 확인에 쓴다)
 *     ctx.onBack(fn)                  뒤로가기가 눌렸을 때 먼저 불릴 함수. true 를 돌려주면 모듈이 처리한 것
 *     ctx.confirm(title, msg, label, fn, opts)   앱 확인 시트(없으면 곧바로 fn). opts = { danger:true(빨간 단추) | extra:{label,action} | cancelLabel }
 *     ctx.saveCopy(fileOrBlob, name)  → Promise(true=저장 성공 · false=실패, 실패 안내는 틀이 한다)  이름을 안 주면 「원래이름_수정.확장자」(같은 이름이 있으면 _수정(2)). 저장 뒤 「저장했어요」 시트까지 틀이 맡는다
 *
 *   ── 고친 내용 복구(자동 저장) 규약 — 모듈이 register 에 선택으로 낸다 ──
 *     snapshot()      고친 게 없으면 null, 있으면 JSON 으로 직렬화되는 객체(또는 Blob 을 담은 객체). 틀이 dirty 인 동안 15초마다·화면이 가려질 때 부른다
 *     restore(data)   open 직후, 같은 파일(이름|크기|수정일)의 임시 저장이 있고 사용자가 「이어서 고치기」를 고르면 부른다(Promise 가능)
 *     저장소 IndexedDB 'so_recover'(기록 20개·50MB·7일). 사본 저장이 끝나면 그 기록은 지운다. 둘 중 하나라도 없으면 아무것도 하지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var SOFFICE_NAME = 'S-Office';            // 이름 표기는 여기 한 곳 (홈 칸·열기 화면·설정·채팅 단추의 이름은 mount() 가 data-so-name / data-so-sub 자리에 채운다)
  var SOFFICE_SUB = '문서 보기·고치기';       // 홈 도구 칸의 작은 글씨
  var SOFFICE_LONG = '스마트오피스';          // 풀이(정보 화면에서만)
  var SO_ON = 'on';                         // 스위치 — 'off' 면 통째로 꺼진 것과 같다
  var SO_HWP_READY = 'on';                  // 한글 부품(vendor/so/hwp)이 앱에 들어온 뒤에만 'on' — 'off' 면 ②에서 한글을 고르면 곧바로 ①로 간다
  var MODE_KEY = 'so_open_mode_v1';
  var usedNames = {};                        // 이번에 저장한 사본 이름(같은 이름이 또 나오면 _수정(2))

  // 확장자 → 형식 모듈. (모듈 파일이 없거나 canOpen 이 false 면 ①로 자동 연결)
  var EXT_MAP = {
    hwp: 'hwp', hwpx: 'hwp',
    pdf: 'pdf',
    xls: 'xlsx', xlsx: 'xlsx', csv: 'xlsx',
    doc: 'docx', docx: 'docx',
    ppt: 'pptx', pptx: 'pptx',
    md: 'md', markdown: 'md', txt: 'md',
    html: 'html', htm: 'html'
  };
  var MODULES = {};                          // id → 등록된 모듈
  var modLoading = {};                       // id → Promise
  var scriptLoaded = {};                     // path → Promise
  var cfg = { toast: function () {}, save: null, confirm: null };
  var bypassFile = null;                     // ①로 되돌리는 파일(다시 가로채지 않게)

  var $ = function (id) { return document.getElementById(id); };
  var extOf = function (n) { return (String(n || '').split('.').pop() || '').toLowerCase(); };
  function toast(m, ms) { try { cfg.toast(m, ms); } catch (e) {} }

  // ============ 열기 방식(기억) ============
  function mode() { try { return localStorage.getItem(MODE_KEY) === 'soffice' ? 'soffice' : 'convert'; } catch (e) { return 'convert'; } }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m === 'soffice' ? 'soffice' : 'convert'); } catch (e) {} renderRow(); }
  function enabled() { return SO_ON === 'on'; }

  // ============ 스크립트·스타일 불러오기 ============
  function loadScript(path) {
    if (scriptLoaded[path]) return scriptLoaded[path];
    scriptLoaded[path] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = path; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { delete scriptLoaded[path]; rej(new Error('불러오지 못함: ' + path)); };
      document.head.appendChild(s);
    });
    return scriptLoaded[path];
  }
  function loadCss(path) {
    if (document.querySelector('link[data-so-css="' + path + '"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = path; l.setAttribute('data-so-css', path); document.head.appendChild(l);
  }
  function moduleFor(id) {
    if (MODULES[id]) return Promise.resolve(MODULES[id]);
    if (modLoading[id]) return modLoading[id];
    modLoading[id] = loadScript('js/smartoffice/' + id + '/so-' + id + '.js').then(function () {
      if (!MODULES[id]) throw new Error('모듈이 등록되지 않음: ' + id);
      return MODULES[id];
    }).catch(function (e) { delete modLoading[id]; throw e; });
    return modLoading[id];
  }
  function register(mod) {
    if (!mod || !mod.id || typeof mod.open !== 'function') { try { console.warn('[S-Office] 잘못된 모듈', mod); } catch (e) {} return; }
    MODULES[mod.id] = mod;
  }

  // ============ 열기 방식 줄 (문서 뷰어 고르기 화면 #soModeRow) ============
  function renderRow() {
    var row = $('soModeRow'); if (!row) return;
    if (!enabled()) { row.style.display = 'none'; row.innerHTML = ''; return; }
    var m = mode();
    row.style.display = '';
    row.innerHTML =
      '<div class="so-row-title">열기 방식</div>' +
      '<div class="so-seg" role="radiogroup" aria-label="열기 방식">' +
        '<button type="button" class="so-opt' + (m === 'convert' ? ' on' : '') + '" role="radio" aria-checked="' + (m === 'convert') + '" data-som="convert">' +
          '<b>변환해서 보기</b><span>PC가 PDF로 바꿔 보여 줘요 · 원본 모양 그대로 · 수정 요청</span></button>' +
        '<button type="button" class="so-opt' + (m === 'soffice' ? ' on' : '') + '" role="radio" aria-checked="' + (m === 'soffice') + '" data-som="soffice">' +
          '<b>' + SOFFICE_NAME + '로 열기</b><span>폰에서 바로 열고 · 간단히 고쳐요</span></button>' +
      '</div>' +
      '<div class="so-row-hint">' + (m === 'soffice'
        ? SOFFICE_NAME + '가 열지 못하는 문서는 저절로 「변환해서 보기」로 열려요.'
        : '고른 문서를 PC가 PDF로 바꿔 보여 줘요(PC가 켜져 있어야 해요). 마지막에 고른 방식은 기억해 둬요.') +
        ' <button type="button" class="so-link" data-sinfo="1">' + SOFFICE_NAME + ' 정보</button></div>';
  }
  function onRowClick(e) {
    var b = e.target.closest ? e.target.closest('[data-som],[data-sinfo]') : null; if (!b) return;
    if (b.getAttribute('data-sinfo')) { showInfo(); return; }
    setMode(b.getAttribute('data-som'));
  }

  // ============ 열기 가로채기 (docviewer.js handleLocalFile 첫 줄에서 부른다) ============
  //   true  = S-Office 가 맡았다(기존 변환 흐름은 타지 않는다)
  //   false = 기존 그대로(①)
  function intercept(file, force) {
    if (!enabled() || !file) return false;
    if (bypassFile === file) { bypassFile = null; return false; }
    if (!force && mode() !== 'soffice') return false;
    var id = EXT_MAP[extOf(file.name)];
    if (id === 'hwp' && SO_HWP_READY !== 'on') { toast('한글 문서는 아직 준비 중이라 변환해서 보여 드려요.', 3600); return false; }   // 모듈 로딩을 시도하지 않는다
    if (!id) { toast('이 형식은 ' + SOFFICE_NAME + '로 열 수 없어 변환해서 보여 드려요.', 3200); return false; }
    openWith(id, file);
    return true;
  }
  function openFile(file) { return intercept(file, true); }   // 최근 연 문서에서 다시 열 때(열기 방식과 상관없이 S-Office 로)
  function toConvert(file, reason) {
    closeHost(true);
    if (reason) toast(reason, 4200);
    bypassFile = file;
    var ok = false;
    try { if (global.SmartDocs && SmartDocs.handleLocalFile) { SmartDocs.handleLocalFile(file); ok = true; } } catch (e) {}
    if (!ok) bypassFile = null;
  }

  // ============ 전체 화면 틀 ============
  var host = null, cur = null;   // cur = { id, mod, file, ctx, dirty, backFn, token }
  var seq = 0;
  function buildHost() {
    if (host) return host;
    host = document.createElement('div'); host.id = 'soRoot';
    host.innerHTML =
      '<div class="so-bar">' +
        '<div class="so-bar-row">' +
          '<button type="button" class="so-bar-btn" id="soBack" aria-label="뒤로">←</button>' +
          '<div class="so-title" id="soTitle"></div>' +
          '<button type="button" class="so-bar-btn" id="soMoreBtn" aria-label="더보기" aria-haspopup="true">⋯</button>' +
          '<button type="button" class="so-bar-btn" id="soInfoBtn" aria-label="' + SOFFICE_NAME + ' 정보">ⓘ</button>' +
        '</div>' +
        '<div class="so-actions" id="soActions"></div>' +
      '</div>' +
      '<div class="so-menu" id="soMenu" style="display:none" role="menu"></div>' +
      '<div class="so-main">' +
        '<div class="so-body" id="soBody"></div>' +
        '<div class="so-busy" id="soBusy" style="display:none"><div class="so-spin"></div><div class="so-busy-t" id="soBusyT"></div></div>' +
        '<div class="so-err" id="soErr" style="display:none"></div>' +
      '</div>';
    document.body.appendChild(host);
    host.querySelector('#soBack').onclick = function () { back(); };
    host.querySelector('#soInfoBtn').onclick = function () { closeMenu(); showInfo(); };
    host.querySelector('#soMoreBtn').onclick = function (e) { e.stopPropagation(); toggleMenu(); };
    host.addEventListener('click', function (e) { if (menuOpen() && !(e.target.closest && e.target.closest('#soMenu'))) closeMenu(); });
    host.querySelector('#soMenu').addEventListener('click', onMenuClick);
    return host;
  }
  function openWith(id, file) {
    closeHost(true);
    var token = ++seq;
    buildHost(); host.classList.add('on');
    var body = host.querySelector('#soBody'); body.innerHTML = '';
    host.querySelector('#soErr').style.display = 'none';
    host.querySelector('#soTitle').textContent = file.name || '문서';
    host.querySelector('#soActions').innerHTML = '';
    var c = { id: id, mod: null, file: file, dirty: false, backFn: null, token: token, recKey: recKey(file), recReady: false, timer: 0 };
    closeMenu();
    cur = c;
    var ctx = makeCtx(c, body);
    c.ctx = ctx;
    ctx.busy(SOFFICE_NAME + ' 준비하는 중…');
    moduleFor(id).then(function (mod) {
      if (c !== cur) return;
      c.mod = mod;
      if (typeof mod.canOpen === 'function' && mod.canOpen(ctx.ext) === false) { toConvert(file, SOFFICE_NAME + '가 이 형식은 아직 열지 못해 변환해서 보여 드려요.'); return; }
      ctx.busy((mod.label || '문서') + ' 여는 중…');
      var r;
      try { r = mod.open(ctx); } catch (e) { return failOpen(c, e); }
      if (r && typeof r.then === 'function') r.then(function () { if (c === cur) { ctx.busy(null); afterOpen(c); } }, function (e) { failOpen(c, e); });
      else { ctx.busy(null); afterOpen(c); }
    }).catch(function () {
      if (c !== cur) return;
      toConvert(file, SOFFICE_NAME + '가 아직 이 형식을 열 수 없어 변환해서 보여 드려요.');   // 모듈 파일 없음/불러오기 실패 = 임시 안전장치
    });
  }
  function failOpen(c, e) {
    if (c !== cur) return;
    try { console.warn('[S-Office] 열기 실패', e); } catch (x) {}
    toConvert(c.file, SOFFICE_NAME + '로 열지 못해 변환해서 보여 드려요. (' + ((e && e.message) || '알 수 없는 오류') + ')');
  }
  function makeCtx(c, body) {
    var h = host;
    var ctx = {
      file: c.file, name: c.file.name || '문서', ext: extOf(c.file.name), body: body,
      setTitle: function (s) { if (c === cur) h.querySelector('#soTitle').textContent = s || ''; },
      setActions: function (list) {
        if (c !== cur) return;
        var box = h.querySelector('#soActions'); box.innerHTML = '';
        (list || []).forEach(function (a) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'so-act' + (a.primary ? ' primary' : '');
          b.textContent = a.label; if (a.id) b.id = a.id; if (a.disabled) b.disabled = true;
          b.onclick = function () { try { a.onClick && a.onClick(); } catch (e) { toast('실행하지 못했습니다: ' + ((e && e.message) || e)); } };
          box.appendChild(b);
        });
      },
      busy: function (msg) {
        if (c !== cur) return;
        var bz = h.querySelector('#soBusy');
        if (msg) { h.querySelector('#soBusyT').textContent = msg; bz.style.display = ''; } else bz.style.display = 'none';
      },
      toast: toast,
      error: function (msg, sub) {
        if (c !== cur) return;
        ctx.busy(null);
        var er = h.querySelector('#soErr');
        er.innerHTML = '<div class="so-err-t"></div><div class="so-err-s"></div>';
        er.firstChild.textContent = msg || '열지 못했습니다.'; er.lastChild.textContent = sub || '';
        er.style.display = '';
      },
      fallback: function (reason) { if (c === cur) toConvert(c.file, reason || (SOFFICE_NAME + '가 이 문서는 아직 열지 못해 변환해서 보여 드려요.')); },
      loadScript: loadScript, loadCss: loadCss,
      saveCopy: function (f, name) { return saveCopy(f, name, c); },
      setDirty: function (v) { c.dirty = !!v; if (c.dirty) startAuto(c); else stopAuto(c); },
      onBack: function (fn) { c.backFn = (typeof fn === 'function') ? fn : null; },
      confirm: function (t, m, label, fn, o) { if (typeof cfg.confirm === 'function') cfg.confirm(t, m, label, fn, o); else fn(); },
      // 사본 저장 확인창: 모듈의 확인 문구 뒤에 공유함 업로드 안내를 붙인다(PC 브라우저에서는 붙이지 않음)
      confirmCopy: function (t, m, label, fn) { var n = noticeText(); ctx.confirm(t, n ? (m + '\n\n' + n) : m, '사본 저장', fn); },   // 저장 단추 이름은 모든 형식 「사본 저장」으로 통일
      // 확인창이 없는 저장(예: PDF)용: 처음 한 번만 안내 확인
      noticeThen: noticeThen,
      saveNotice: noticeText()
    };
    return ctx;
  }
  // ---- 사본 저장 사전 안내(형식 공통) — 폰 앱은 사본을 내 공유함(개인 서버)에 올린 뒤 받는다 ----
  var SAVE_NOTICE = '이 문서의 사본이 내 공유함(개인 서버)에 올라간 뒤 폰으로 받습니다. 다른 사람에게 공개되지는 않습니다. 원본은 바꾸지 않습니다.';
  var NOTICE_KEY = 'so_save_notice_ok_v1';
  function isNative() { var C = global.Capacitor; return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()); }
  function noticeText() { return (isNative() && typeof cfg.save === 'function') ? SAVE_NOTICE : ''; }
  function noticeThen(fn) {          // 처음 한 번만 묻고 기억한다(이후엔 저장하면서 한 줄 알림)
    var t = noticeText();
    if (!t) { fn(); return; }
    var ok = false; try { ok = localStorage.getItem(NOTICE_KEY) === '1'; } catch (e) {}
    if (ok) { toast(t, 4200); fn(); return; }
    if (typeof cfg.confirm !== 'function') { fn(); return; }
    cfg.confirm('사본 저장 안내', t, '사본 저장', function () { try { localStorage.setItem(NOTICE_KEY, '1'); } catch (e) {} fn(); });
  }
  // ============ 사본 이름 ============
  //   모듈이 이름을 주면 그대로 존중한다. 안 주면 「원래이름_수정.확장자」, 이번에 같은 이름을 이미 저장했으면 「_수정(2)」.
  function copyName(orig, ext) {
    var n = String(orig || 'document'), dot = n.lastIndexOf('.');
    var base = dot > 0 ? n.slice(0, dot) : n;
    var e = ext ? ('.' + String(ext).replace(/^\./, '')) : (dot > 0 ? n.slice(dot) : '');
    var cand = base + '_수정' + e, i = 1;
    while (usedNames[cand]) { i++; cand = base + '_수정(' + i + ')' + e; }
    return cand;
  }

  // ============ 고친 내용 임시 저장(복구) — IndexedDB 'so_recover' ============
  var REC_DB = 'so_recover', REC_TTL = 7 * 86400000, REC_MAX = 20, REC_BYTES = 50 * 1048576, REC_EVERY = 15000, PEND_MAX = 5;
  var recDbP = null, recWarned = {};
  function recKey(f) { return ((f && f.name) || '') + '|' + ((f && f.size) || 0) + '|' + ((f && f.lastModified) || 0); }
  function recOpen() {
    if (recDbP) return recDbP;
    recDbP = new Promise(function (res, rej) {
      if (!global.indexedDB) { rej(new Error('no indexedDB')); return; }
      var rq; try { rq = indexedDB.open(REC_DB, 1); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'key' });     // 고치던 내용 전체
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });       // 목록·정리용 가벼운 정보
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });  // 저장하지 못한 사본
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { recDbP = null; rej(rq.error); };
    });
    return recDbP;
  }
  function r2p(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error('abort')); }; }); }
  function sizeOf(v, seen) {            // 대략의 크기(Blob 은 실제 크기, 나머지는 글자 수)
    if (v == null) return 0;
    if (typeof Blob !== 'undefined' && v instanceof Blob) return v.size;
    if (v instanceof ArrayBuffer) return v.byteLength;
    if (ArrayBuffer.isView && ArrayBuffer.isView(v)) return v.byteLength;
    if (typeof v === 'string') return v.length * 2;
    if (typeof v !== 'object') return 8;
    seen = seen || []; if (seen.indexOf(v) >= 0) return 0; seen.push(v);
    var n = 0; Object.keys(v).forEach(function (k) { n += k.length * 2 + sizeOf(v[k], seen); }); return n;
  }
  function recGet(key) { return recOpen().then(function (db) { return r2p(db.transaction('snaps', 'readonly').objectStore('snaps').get(key)); }).then(function (r) { return r || null; }).catch(function () { return null; }); }
  function recDel(key) {
    if (!key) return Promise.resolve();
    return recOpen().then(function (db) { var tx = db.transaction(['snaps', 'meta'], 'readwrite'); tx.objectStore('snaps').delete(key); tx.objectStore('meta').delete(key); return txDone(tx); }).catch(function () {});
  }
  // 오래된 것(7일)·넘치는 것(20개·50MB)을 오래된 순으로 지운다. keep = 방금 쓴 키
  function recPrune(keep) {
    return recOpen().then(function (db) { return r2p(db.transaction('meta', 'readonly').objectStore('meta').getAll()); }).then(function (all) {
      var now = Date.now(), dels = [], live = [], total = 0;
      all.sort(function (a, b) { return a.savedAt - b.savedAt; });
      all.forEach(function (m) { if (now - m.savedAt > REC_TTL && m.key !== keep) dels.push(m.key); else { live.push(m); total += m.bytes || 0; } });
      while (live.length > REC_MAX || total > REC_BYTES) {
        var idx = -1; for (var i = 0; i < live.length; i++) { if (live[i].key !== keep) { idx = i; break; } }
        if (idx < 0) break;
        var m = live.splice(idx, 1)[0]; dels.push(m.key); total -= m.bytes || 0;
      }
      return Promise.all(dels.map(recDel));
    }).catch(function () {});
  }
  function recPut(key, fmt, data) {
    var bytes = sizeOf(data);
    if (bytes > REC_BYTES) return Promise.reject({ reason: 'too_big' });
    return recOpen().then(function (db) {
      var tx = db.transaction(['snaps', 'meta'], 'readwrite'), now = Date.now();
      tx.objectStore('snaps').put({ key: key, savedAt: now, fmt: fmt, data: data, bytes: bytes });
      tx.objectStore('meta').put({ key: key, savedAt: now, bytes: bytes, fmt: fmt });
      return txDone(tx);
    }).then(function () { return recPrune(key); }, function (e) { throw { reason: 'quota', err: e }; });
  }
  function recWarn(c, e) {
    if (!c || recWarned[c.recKey]) return;
    recWarned[c.recKey] = 1;
    if (e && e.reason === 'snap') { toast('고친 내용을 임시 저장용으로 만들지 못했어요' + (e.err && e.err.message ? ' (' + e.err.message + ')' : '') + '. 「사본 저장」으로 꼭 저장해 주세요.', 5200); return; }
    toast(e && e.reason === 'too_big' ? '고친 내용이 커서(50MB 초과) 자동 임시 저장을 하지 못했어요. 「사본 저장」으로 꼭 저장해 주세요.' : '고친 내용을 임시 저장하지 못했어요(저장 공간이 부족할 수 있어요). 「사본 저장」으로 꼭 저장해 주세요.', 5200);
  }
  // 지금 고친 내용을 한 번 임시 저장한다. snapshot() 은 바로 값을 주든 Promise 를 주든 받는다. 이미 진행 중이면 건너뛴다.
  function flush(c) {
    if (!c || !c.mod || typeof c.mod.snapshot !== 'function' || !c.recReady || c.flushing) return Promise.resolve();
    c.flushing = true;
    return new Promise(function (res) { res(c.mod.snapshot()); }).then(function (d) {
      if (d == null) { if (!c.dirty && !c.noRec) recDel(c.recKey); return; }
      if (c.noRec) return;
      return recPut(c.recKey, c.id, d).then(function () { c.lastSaved = Date.now(); }, function (e) { recWarn(c, e); });
    }, function (e) { recWarn(c, { reason: 'snap', err: e }); }).then(function () { c.flushing = false; }, function () { c.flushing = false; });
  }
  function startAuto(c) {
    if (c.timer || !c.mod || typeof c.mod.snapshot !== 'function') return;
    c.timer = setInterval(function () { if (c === cur && c.dirty) flush(c); }, REC_EVERY);
  }
  function stopAuto(c) { if (c && c.timer) { clearInterval(c.timer); c.timer = 0; } }
  function onHide() { if (cur && cur.dirty) flush(cur); }   // 화면이 가려질 때 먼저 저장(앱이 내려가면 비동기 작업이 끝나기 전에 멈출 수 있어, 15초 주기도 함께 둔다)
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onHide(); });
  global.addEventListener('pagehide', onHide);
  function fmtWhen(t) { var d = new Date(t); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // 문서가 열린 직후: 최근 연 문서에 넣고, 같은 문서의 임시 저장이 있으면 이어서 고칠지 묻는다
  function afterOpen(c) {
    try { if (global.SmartDocs && typeof SmartDocs.recordSOffice === 'function') SmartDocs.recordSOffice(c.file); } catch (e) {}
    var m = c.mod;
    if (!m || typeof m.snapshot !== 'function' || typeof m.restore !== 'function') { c.recReady = !!(m && typeof m.snapshot === 'function'); checkPending(); return; }
    recGet(c.recKey).then(function (rec) {
      if (c !== cur) return;
      if (rec && Date.now() - rec.savedAt > REC_TTL) { recDel(c.recKey); rec = null; }   // 7일 지난 기록은 지우고 건너뜀
      if (!rec || rec.fmt !== c.id) { c.recReady = true; return; }
      var ask = (typeof cfg.confirm === 'function');
      if (!ask) { c.recReady = true; return; }
      cfg.confirm('이어서 고칠까요?', '저장된 시각: ' + fmtWhen(rec.savedAt) + '\n이 문서를 고치다가 닫기 전에 임시로 저장해 둔 내용이 있어요.', '이어서 고치기', function () {
        c.recSheet = false;
        if (c !== cur) return;
        c.ctx.busy('고치던 내용을 불러오는 중…');
        Promise.resolve().then(function () { return m.restore(rec.data); }).then(function (res) {
          if (c !== cur) return; c.ctx.busy(null); c.recReady = true;
          if (res === false || (res && typeof res.applied === 'number' && res.applied === 0)) return;   // 적용된 것이 없으면(구조가 달라졌거나 되살릴 칸이 없음) 모듈이 안내한 대로 두고 고친 상태로 만들지 않는다
          c.ctx.setDirty(true);
          if (!res || typeof res !== 'object') toast('고치던 내용을 불러왔어요.', 2600);
        }, function (e) { if (c !== cur) return; c.ctx.busy(null); c.recReady = true; toast('고치던 내용을 불러오지 못했어요.' + (e && e.message ? ' (' + e.message + ')' : ''), 4200); });
      }, { extra: { label: '지우고 처음부터', action: function () { c.recSheet = false; recDel(c.recKey); if (c === cur) c.recReady = true; } }, cancelLabel: '나중에' });
      c.recSheet = true;
      // 「나중에」(시트 닫기)를 고르면 recReady 가 false 로 남아, 이번에는 새 임시 저장을 하지 않고 옛 기록을 그대로 둔다
    });
    checkPending();
  }

  // ============ 저장하지 못한 사본(오프라인 등) — 앱 안에 보관했다가 다시 저장 ============
  function pendPut(file) {
    return recOpen().then(function (db) {
      var id = file.name + '|' + file.size;
      var tx = db.transaction('pending', 'readwrite'); tx.objectStore('pending').put({ id: id, name: file.name, type: file.type || '', savedAt: Date.now(), blob: file });
      return txDone(tx).then(function () { return db.transaction('pending', 'readonly').objectStore('pending').getAll(); }).then(function (rq) { return r2p(rq); }).then(function (all) {
        all.sort(function (a, b) { return a.savedAt - b.savedAt; });
        var extra = all.slice(0, Math.max(0, all.length - PEND_MAX));
        if (!extra.length) return true;
        var tx2 = db.transaction('pending', 'readwrite'); extra.forEach(function (x) { tx2.objectStore('pending').delete(x.id); }); return txDone(tx2).then(function () { return true; });
      });
    }).catch(function () { return false; });
  }
  function pendDel(id) { return recOpen().then(function (db) { var tx = db.transaction('pending', 'readwrite'); tx.objectStore('pending').delete(id); return txDone(tx); }).catch(function () {}); }
  function pendList() { return recOpen().then(function (db) { return r2p(db.transaction('pending', 'readonly').objectStore('pending').getAll()); }).catch(function () { return []; }); }
  var pendAsked = false;
  function checkPending() {
    if (pendAsked || typeof cfg.confirm !== 'function') return;
    pendAsked = true;
    pendList().then(function (all) {
      if (!all.length) return;
      var p = all[0], more = all.length > 1 ? ' (외 ' + (all.length - 1) + '개)' : '';
      cfg.confirm('저장하지 못한 사본이 있어요', '「' + p.name + '」' + more + ' 사본을 전에 저장하지 못해 이 앱 안에 보관해 두었어요. 지금 다시 저장할까요?', '지금 저장', function () {
        saveCopy(new File([p.blob], p.name, { type: p.type }), p.name, null);
      }, { extra: { label: '보관본 지우기', action: function () { pendDel(p.id); } }, cancelLabel: '나중에' });
    });
  }

  // ============ 사본 저장 + 저장 직후 안내 ============
  function canShareFile(file) { try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; } }
  function shareFile(file) {
    try { navigator.share({ files: [file], title: file.name }).catch(function (e) { if (e && e.name !== 'AbortError') toast('공유하지 못했어요.', 3000); }); } catch (e) { toast('공유하지 못했어요.', 3000); }
  }
  function uniqName(n) {
    var dot = n.lastIndexOf('.'), base = dot > 0 ? n.slice(0, dot) : n, e = dot > 0 ? n.slice(dot) : '', i = 1, cand = n;
    base = base.replace(/\(\d+\)$/, '');
    while (usedNames[cand]) { i++; cand = base + '(' + i + ')' + e; }
    return cand;
  }
  // 반환: Promise — 저장이 끝났으면 true, 실패했으면 false(실패 안내 시트는 틀이 띄운다). 모듈은 true 일 때만 성공 안내·setDirty(false) 를 한다.
  function saveCopy(f, name, c) {
    var file = (f instanceof File) ? f : new File([f], name || 'document', { type: (f && f.type) || 'application/octet-stream' });
    var want = name;
    if (!want && c && (!file.name || file.name === 'document' || file.name === c.file.name)) want = copyName(c.file.name, (file.name.indexOf('.') > 0 ? extOf(file.name) : '') || extOf(c.file.name));   // 이름을 안 준 경우만 「원래이름_수정」
    if (want && usedNames[want]) want = uniqName(want);   // 같은 이름을 한 번 더 저장할 때만 _수정(2)
    if (want && file.name !== want) file = new File([file], want, { type: file.type });
    var p;
    if (typeof cfg.save === 'function') { try { p = Promise.resolve(cfg.save(file)); } catch (e) { p = Promise.reject(e); } }
    else {
      var u = URL.createObjectURL(file), a = document.createElement('a');
      a.href = u; a.download = file.name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 5000);
      p = Promise.resolve({ ok: true, quiet: true });
    }
    return p.then(function (res) {
      usedNames[file.name] = 1;
      if (c) recDel(c.recKey);
      pendDel(file.name + '|' + file.size);
      afterSave(res, file);
      return true;
    }, function (err) { saveFailed(err, file, c); return false; });
  }
  function afterSave(res, file) {
    if (!res || res.quiet || typeof cfg.confirm !== 'function') return;
    var share = canShareFile(file);
    cfg.confirm('저장했어요', (res.name || file.name) + '\n다운로드 폴더에 저장했어요.', res.open ? '열기' : '확인', function () {
      if (res.open) { try { Promise.resolve(res.open()).catch(function () { toast('「내 파일 › 다운로드」에서 열어 주세요.', 4200); }); } catch (e) { toast('「내 파일 › 다운로드」에서 열어 주세요.', 4200); } }
    }, { extra: share ? { label: '공유', action: function () { shareFile(file); } } : null, cancelLabel: '닫기' });
  }
  function saveFailed(err, file, c) {
    var why = (err && (err.friendly || err.message)) || '알 수 없는 오류';
    pendPut(file).then(function (kept) {
      var share = canShareFile(file);
      var msg = '「' + file.name + '」을 저장하지 못했어요. (' + why + ')\n' +
        (kept ? '사본은 이 앱 안에 보관해 두었어요. 연결이 되면 [다시 시도]를 누르거나, 다음에 S-Office를 열 때 다시 저장할 수 있어요.' : '사본을 앱 안에 보관하지도 못했어요. 지금 [다시 시도]를 누르거나 [공유]로 다른 앱에 보내 두세요.');
      if (typeof cfg.confirm !== 'function') { toast('저장하지 못했어요. (' + why + ')', 5000); return; }
      cfg.confirm('저장하지 못했어요', msg, '다시 시도', function () { saveCopy(file, file.name, c); },
        { extra: share ? { label: '공유', action: function () { shareFile(file); } } : null, cancelLabel: '닫기' });
    });
  }

  // ============ 머리줄 더보기 메뉴 ============
  function menuOpen() { var m = host && host.querySelector('#soMenu'); return !!(m && m.style.display !== 'none'); }
  function closeMenu() { var m = host && host.querySelector('#soMenu'); if (m) m.style.display = 'none'; }
  function toggleMenu() {
    if (menuOpen()) { closeMenu(); return; }
    var m = host.querySelector('#soMenu'), c = cur, items = [];
    var canConv = !!c && !(global.SmartDocs && typeof SmartDocs.isViewable === 'function' && !SmartDocs.isViewable(c.file.name, c.file.type));
    if (canConv) items.push('<button type="button" role="menuitem" data-m="convert"><b>변환해서 보기</b><span>PC가 PDF로 바꿔 보여 줘요 · 폰 화면과 모양이 다를 때</span></button>');
    items.push('<button type="button" role="menuitem" data-m="info"><b>' + SOFFICE_NAME + ' 정보</b><span>출처와 라이선스</span></button>');
    m.innerHTML = items.join(''); m.style.display = '';
  }
  function onMenuClick(e) {
    var b = e.target.closest ? e.target.closest('[data-m]') : null; if (!b) return;
    var k = b.getAttribute('data-m'); closeMenu();
    if (k === 'info') { showInfo(); return; }
    if (k === 'convert') {
      var c = cur; if (!c) return;
      var go = function () { toConvert(c.file, null); };
      if (c.dirty) c.ctx.confirm('고친 내용이 저장되지 않았어요', '변환해서 보기로 열면 지금 화면의 고친 내용은 보이지 않아요. 먼저 「사본 저장」을 하셨나요?', '그래도 열기', go, { danger: true });
      else go();
    }
  }
  function closeHost(silent, discard) {
    var c = cur; cur = null;
    if (c) {
      stopAuto(c);
      // 이어서 고칠지 묻는 시트에 아직 답하지 않았다면(나중에·무응답) 옛 임시 저장을 지우지 않는다
      if (c.recReady && (discard || !c.dirty)) { c.noRec = true; recDel(c.recKey); }
      if (c.recSheet) { c.recSheet = false; try { if (typeof cfg.dismiss === 'function') cfg.dismiss(); } catch (e) {} }   // 떠 있는 시트도 함께 닫는다
    }
    closeMenu();
    if (c && c.mod && typeof c.mod.close === 'function') { try { c.mod.close(); } catch (e) {} }
    if (host) { host.classList.remove('on'); var b = host.querySelector('#soBody'); if (b) b.innerHTML = ''; var a = host.querySelector('#soActions'); if (a) a.innerHTML = ''; var bz = host.querySelector('#soBusy'); if (bz) bz.style.display = 'none'; }
    closeInfo();
  }
  // 뒤로: 정보 → 모듈 → (고친 내용 있으면 확인) → 닫기
  function back() {
    if (menuOpen()) { closeMenu(); return true; }
    if (infoEl && infoEl.classList.contains('on')) { closeInfo(); return true; }
    if (!cur) return false;
    var c = cur;
    if (c.backFn) { var handled = false; try { handled = c.backFn() === true; } catch (e) {} if (handled) return true; }
    if (c.dirty) {
      c.ctx.confirm('고친 내용이 저장되지 않았어요', '닫으면 고친 내용이 사라집니다. 먼저 「사본 저장」을 하셨나요?', '그래도 닫기', function () { closeHost(false, true); }, { danger: true });
      return true;
    }
    closeHost(); return true;
  }

  // ============ 정보 화면 (출처 · 한컴 고지 · 제휴 아님 · 변경 표시) ============
  var infoEl = null;
  var BASE_CREDITS = [
    { name: 'PDF.js (Mozilla)', license: 'Apache-2.0', note: 'PDF 보기' },
    { name: 'tslib', license: '0BSD', note: '파워포인트 보기 부품에 함께 묶임' }     // pptx-preview 번들 안(차트 그리기용 ECharts 는 들어 있지 않음)
  ];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function showInfo() {
    buildHost();
    if (!infoEl) { infoEl = document.createElement('div'); infoEl.id = 'soInfo'; host.appendChild(infoEl); }
    // 부품 목록은 형식 모듈이 스스로 적는다 — 한 번도 안 연 형식도 목록에 나오게 모듈 파일을 먼저 불러 둔다(한글은 부품이 들어온 뒤에만)
    var ids = ['pdf', 'xlsx', 'docx', 'pptx', 'md', 'html']; if (SO_HWP_READY === 'on') ids.unshift('hwp');
    Promise.all(ids.map(function (id) { return moduleFor(id).catch(function () { return null; }); })).then(function () { renderInfo(); });
    renderInfo();
    infoEl.classList.add('on'); host.classList.add('on');
  }
  function renderInfo() {
    if (!infoEl) return;
    var credits = BASE_CREDITS.slice();
    Object.keys(MODULES).forEach(function (k) { if (k === 'hwp' && SO_HWP_READY !== 'on') return; (MODULES[k].credits || []).forEach(function (c) { credits.push(c); }); });
    var seen = {}; credits = credits.filter(function (c) { var key = c.name + '|' + c.license; if (seen[key]) return false; seen[key] = 1; return true; });
    var hwpReady = SO_HWP_READY === 'on';
    infoEl.innerHTML =
      '<div class="so-info-bar"><button type="button" class="so-bar-btn" id="soInfoClose" aria-label="닫기">←</button><div class="so-title">' + SOFFICE_NAME + ' 정보</div></div>' +
      '<div class="so-info-body">' +
      '<h3>' + SOFFICE_NAME + ' (' + SOFFICE_LONG + ')</h3>' +
      '<p>스마트비서 안에서 한글·워드·엑셀·파워포인트·PDF·마크다운·HTML 문서를 폰에서 바로 열고, 간단히 고치는 기능입니다. AI 기능은 들어 있지 않습니다.' +
        (hwpReady ? '' : ' 한글(HWP·HWPX) 문서는 아직 준비 중이라 「변환해서 보기」로 열립니다.') + '</p>' +
      (hwpReady ?
        '<h3>바탕으로 한 오픈소스</h3>' +
        '<p>한글 문서 부분은 오픈소스 프로젝트 <b>이음오피스(IeumOffice)</b>(Apache License 2.0)와 그 바탕인 <b>GenOffice</b>(Genspark / Mainfunc, Inc., Apache License 2.0)의 일부 빌드를 <b>수정해서</b> 사용했습니다. 원래의 저작권·라이선스 고지는 유지합니다. 수정한 부분은 폰 화면에 맞추고 AI 기능을 뺀 것입니다.</p>' +
        '<p>한글(HWP·HWPX) 해석·편집은 <b>rhwp</b>(MIT License, Copyright (c) 2025-2026 Edward Kim)를 바탕으로 합니다.</p>' +
        '<h3>한글 문서 고지</h3>' +
        '<p>본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.</p>' : '') +
      '<h3>제휴 아님</h3>' +
      '<p>' + SOFFICE_NAME + '는 Microsoft, 주식회사 한글과컴퓨터, Adobe, Google, Artifex Software(SmartOffice) 등과 제휴하거나 후원·보증을 받은 관계가 아닙니다. 「Office」는 Microsoft Office를 뜻하는 말이 아니며, 「한글」·「HWP」·「Word」·「Excel」·「PowerPoint」·「PDF」 등 제품 이름은 각 소유자의 상표입니다. 여기서는 열 수 있는 문서 형식을 알리기 위해서만 적었습니다.</p>' +
      '<h3>사용한 부품과 라이선스</h3>' +
      '<ul>' + credits.map(function (c) { return '<li><b>' + esc(c.name) + '</b> — ' + esc(c.license) + (c.note ? ' · ' + esc(c.note) : '') + '</li>'; }).join('') + '</ul>' +
      '<p class="so-info-small">라이선스 전문과 고지는 앱 안 <code>js/smartoffice/NOTICE.txt</code>와 <code>vendor/so/&lt;형식&gt;/</code>의 라이선스 파일에 있습니다.</p>' +
      '</div>';
    infoEl.querySelector('#soInfoClose').onclick = closeInfo;
  }
  function closeInfo() {
    if (infoEl) infoEl.classList.remove('on');
    if (host && !cur) host.classList.remove('on');     // 열린 문서가 없을 때(고르기 화면에서 정보만 본 경우)는 틀도 닫는다
  }

  // ============ 설치(문서 뷰어 고르기 화면에 열기 방식 줄 연결) ============
  function fillNames() {        // 화면 곳곳의 이름 자리를 상수로 채운다(이름을 바꿀 때 이 파일만 고치도록)
    var i, a = document.querySelectorAll('[data-so-name]'), b = document.querySelectorAll('[data-so-sub]');
    for (i = 0; i < a.length; i++) a[i].textContent = SOFFICE_NAME;
    for (i = 0; i < b.length; i++) b[i].textContent = SOFFICE_SUB;
  }
  function mount() {
    fillNames();
    var row = $('soModeRow'); if (!row || row._soBound) { renderRow(); return; }
    row._soBound = true; row.addEventListener('click', onRowClick); renderRow();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  global.SOffice = {
    NAME: SOFFICE_NAME,
    SUB: SOFFICE_SUB,
    register: register,
    configure: function (o) { o = o || {}; if (o.dismiss) cfg.dismiss = o.dismiss; if (o.toast) cfg.toast = o.toast; if (o.save) cfg.save = o.save; if (o.confirm) cfg.confirm = o.confirm; },
    intercept: intercept,
    mode: mode, setMode: setMode,
    enabled: enabled,
    openFile: openFile,
    copyName: copyName,
    isOpen: function () { return !!(host && host.classList.contains('on') && (cur || (infoEl && infoEl.classList.contains('on')))); },
    back: back,
    close: function () { closeHost(true); },
    showInfo: showInfo,
    extMap: EXT_MAP,
    _modules: MODULES                       // 점검용
  };
})(window);

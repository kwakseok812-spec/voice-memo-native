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
 *     ctx.confirm(title, msg, label, fn)   앱 확인 시트(없으면 곧바로 fn)
 * ==========================================================================*/
(function (global) {
  'use strict';

  var SOFFICE_NAME = 'S-Office';            // 이름 표기는 여기 한 곳 (홈 칸·열기 화면·설정·채팅 단추의 이름은 mount() 가 data-so-name / data-so-sub 자리에 채운다)
  var SOFFICE_SUB = '문서 보기·고치기';       // 홈 도구 칸의 작은 글씨
  var SOFFICE_LONG = '스마트오피스';          // 풀이(정보 화면에서만)
  var SO_ON = 'on';                         // 스위치 — 'off' 면 통째로 꺼진 것과 같다
  var SO_HWP_READY = 'on';                  // 한글 부품(vendor/so/hwp)이 앱에 들어온 뒤에만 'on' — 'off' 면 ②에서 한글을 고르면 곧바로 ①로 간다
  var MODE_KEY = 'so_open_mode_v1';

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
  function intercept(file) {
    if (!enabled() || !file) return false;
    if (bypassFile === file) { bypassFile = null; return false; }
    if (mode() !== 'soffice') return false;
    var id = EXT_MAP[extOf(file.name)];
    if (id === 'hwp' && SO_HWP_READY !== 'on') { toast('한글 문서는 아직 준비 중이라 변환해서 보여 드려요.', 3600); return false; }   // 모듈 로딩을 시도하지 않는다
    if (!id) { toast('이 형식은 ' + SOFFICE_NAME + '로 열 수 없어 변환해서 보여 드려요.', 3200); return false; }
    openWith(id, file);
    return true;
  }
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
        '<button type="button" class="so-bar-btn" id="soBack" aria-label="뒤로">←</button>' +
        '<div class="so-title" id="soTitle"></div>' +
        '<div class="so-actions" id="soActions"></div>' +
        '<button type="button" class="so-bar-btn" id="soInfoBtn" aria-label="' + SOFFICE_NAME + ' 정보">ⓘ</button>' +
      '</div>' +
      '<div class="so-body" id="soBody"></div>' +
      '<div class="so-busy" id="soBusy" style="display:none"><div class="so-spin"></div><div class="so-busy-t" id="soBusyT"></div></div>' +
      '<div class="so-err" id="soErr" style="display:none"></div>';
    document.body.appendChild(host);
    host.querySelector('#soBack').onclick = function () { back(); };
    host.querySelector('#soInfoBtn').onclick = function () { showInfo(); };
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
    var c = { id: id, mod: null, file: file, dirty: false, backFn: null, token: token };
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
      if (r && typeof r.then === 'function') r.then(function () { if (c === cur) ctx.busy(null); }, function (e) { failOpen(c, e); });
      else ctx.busy(null);
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
      saveCopy: function (f, name) { return saveCopy(f, name); },
      setDirty: function (v) { c.dirty = !!v; },
      onBack: function (fn) { c.backFn = (typeof fn === 'function') ? fn : null; },
      confirm: function (t, m, label, fn) { if (typeof cfg.confirm === 'function') cfg.confirm(t, m, label, fn); else fn(); },
      // 사본 저장 확인창: 모듈의 확인 문구 뒤에 공유함 업로드 안내를 붙인다(PC 브라우저에서는 붙이지 않음)
      confirmCopy: function (t, m, label, fn) { var n = noticeText(); ctx.confirm(t, n ? (m + '\n\n' + n) : m, label, fn); },
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
    cfg.confirm('사본 저장 안내', t, '저장하기', function () { try { localStorage.setItem(NOTICE_KEY, '1'); } catch (e) {} fn(); });
  }
  function saveCopy(f, name) {
    var file = (f instanceof File) ? f : new File([f], name || 'document', { type: (f && f.type) || 'application/octet-stream' });
    if (name && file.name !== name) file = new File([file], name, { type: file.type });
    if (typeof cfg.save === 'function') { try { cfg.save(file); } catch (e) { toast('저장하지 못했습니다.'); } return; }
    var u = URL.createObjectURL(file), a = document.createElement('a');
    a.href = u; a.download = file.name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(u); } catch (e) {} }, 5000);
  }
  function closeHost(silent) {
    var c = cur; cur = null;
    if (c && c.mod && typeof c.mod.close === 'function') { try { c.mod.close(); } catch (e) {} }
    if (host) { host.classList.remove('on'); var b = host.querySelector('#soBody'); if (b) b.innerHTML = ''; var a = host.querySelector('#soActions'); if (a) a.innerHTML = ''; var bz = host.querySelector('#soBusy'); if (bz) bz.style.display = 'none'; }
    closeInfo();
  }
  // 뒤로: 정보 → 모듈 → (고친 내용 있으면 확인) → 닫기
  function back() {
    if (infoEl && infoEl.classList.contains('on')) { closeInfo(); return true; }
    if (!cur) return false;
    var c = cur;
    if (c.backFn) { var handled = false; try { handled = c.backFn() === true; } catch (e) {} if (handled) return true; }
    if (c.dirty) {
      c.ctx.confirm('고친 내용이 저장되지 않았어요', '닫으면 고친 내용이 사라집니다. 먼저 「사본 저장」을 하셨나요?', '그래도 닫기', function () { closeHost(); });
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
    configure: function (o) { o = o || {}; if (o.toast) cfg.toast = o.toast; if (o.save) cfg.save = o.save; if (o.confirm) cfg.confirm = o.confirm; },
    intercept: intercept,
    mode: mode, setMode: setMode,
    enabled: enabled,
    isOpen: function () { return !!(host && host.classList.contains('on') && (cur || (infoEl && infoEl.classList.contains('on')))); },
    back: back,
    close: function () { closeHost(true); },
    showInfo: showInfo,
    extMap: EXT_MAP,
    _modules: MODULES                       // 점검용
  };
})(window);

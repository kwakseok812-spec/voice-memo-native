/* ============================================================================
 * so-hwp.js — S-Office 한글(HWP·HWPX) 모듈
 * ----------------------------------------------------------------------------
 * 부품 파일은 www/vendor/so/hwp/ 에 있다(앱 포함).
 *   vendor/so/hwp/studio/   rhwp-studio 편집 화면(오픈소스 이음오피스 설치본에서 가져온 빌드: 패치한 rhwp WASM 포함)
 *   vendor/so/hwp/sdk/      @rhwp/editor 0.8.7 (index.js · transport.js · document-agent-contract.js) — MIT
 *
 * 출처: rhwp(MIT, Copyright (c) 2025-2026 Edward Kim) / 이음오피스(IeumOffice, Apache-2.0)와 GenOffice(Apache-2.0)의
 *       일부 빌드를 사용했다. 정보 화면과 NOTICE.txt 참고. AI 플러그인은 넣지 않았다.
 *
 * 동작
 *   · 열면 「보기 상태」: 화면을 읽기만 한다(글자 칸이 키보드를 띄우지 않게 막음). 폴드8 한글 입력 시험 전까지의 안전장치.
 *   · 머리줄 [고치기]를 눌러야 편집 도구가 켜진다.
 *   · 저장은 언제나 「사본 저장」(원본은 건드리지 않는다). 저장 전에 한 번 확인(공유함 업로드 안내) → 사본 이름에 무작위 꼬리표.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global.SOffice) return;

  var SO_HWP = 'on';                       // 이 모듈 스위치 — 'off' 면 한글은 ①(변환해서 보기)로만 열린다
  var STUDIO_URL = 'vendor/so/hwp/studio/index.html?chrome=embed&lang=ko';
  var SDK_URL = 'vendor/so/hwp/sdk/index.js';

  var st = null;      // { editor, iframe, editing, bytes, ctx }

  function rand8() { var a = new Uint8Array(4); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 4; i++) a[i] = Math.floor(Math.random() * 256); } return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function baseOf(name) { return String(name || '문서').replace(/\.[^.]+$/, ''); }
  function readBytes(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(new Uint8Array(fr.result)); }; fr.onerror = function () { rej(new Error('파일을 읽지 못했습니다.')); }; fr.readAsArrayBuffer(file);
    });
  }

  // ---- 보기 상태 보호: 같은 출처의 studio 안에서 글자 입력 길을 막는다 ----
  var GUARD_EVENTS = ['beforeinput', 'keydown', 'keypress', 'compositionstart', 'paste', 'cut', 'drop'];
  function guardHandler(e) {
    if (e.type === 'keydown' && !e.ctrlKey && !e.metaKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(e.key) >= 0) return;
    e.preventDefault(); e.stopPropagation();
  }
  function setReadOnly(on) {
    var d; try { d = st.iframe.contentDocument; } catch (e) { return false; }
    if (!d) return false;
    GUARD_EVENTS.forEach(function (n) { d.removeEventListener(n, guardHandler, true); if (on) d.addEventListener(n, guardHandler, true); });
    // 글자 입력 칸(숨은 textarea·input)이 키보드를 띄우지 않게
    Array.prototype.forEach.call(d.querySelectorAll('textarea,input,[contenteditable]'), function (el) {
      if (on) { el.setAttribute('data-so-ro', '1'); if (el.tagName !== 'DIV') el.readOnly = true; el.setAttribute('inputmode', 'none'); }
      else if (el.getAttribute('data-so-ro')) { el.removeAttribute('data-so-ro'); if (el.tagName !== 'DIV') el.readOnly = false; el.removeAttribute('inputmode'); }
    });
    var id = 'so-hwp-view-css', old = d.getElementById(id);
    if (old) old.remove();
    if (on) {      // 보기 상태: 메뉴·도구줄을 숨기고 눈금자는 자리만 남겨 두어(숨기면 쪽 그림이 틀어짐) 문서만 크게(rhwp-studio 요소 id — PC 브라우저 시험으로 확인함)
      var s = d.createElement('style'); s.id = id;
      s.textContent = '#menu-bar,#icon-toolbar,#style-bar,#studio-header{display:none !important}#h-ruler,#v-ruler,#ruler-corner{visibility:hidden !important}';
      d.head.appendChild(s);
    }
    return true;
  }

  function setActions(ctx) {
    if (!st) return;
    if (!st.editing) {
      ctx.setActions([{ label: '고치기', primary: true, onClick: function () { startEdit(ctx); } }]);
    } else {
      ctx.setActions([
        { label: '사본 저장', primary: true, onClick: function () { saveCopy(ctx); } },
        { label: '보기로', onClick: function () { stopEdit(ctx); } }
      ]);
    }
  }
  function startEdit(ctx) {
    if (!st) return;
    st.editing = true; setReadOnly(false); setActions(ctx);
    ctx.toast('고치는 중입니다. 저장은 「사본 저장」으로 새 파일이 만들어집니다(원본은 그대로).', 4200);
  }
  function stopEdit(ctx) {
    if (!st) return;
    var go = function () { st.editing = false; setReadOnly(true); setActions(ctx); ctx.setDirty(false); };
    if (st.ctx && st.dirty) ctx.confirm('고친 내용이 저장되지 않았어요', '보기로 돌아가도 고친 내용은 화면에 남지만, 닫으면 사라집니다.', '보기로', go); else go();
  }

  function saveCopy(ctx) {
    if (!st || !st.editor) return;
    var ext = (ctx.ext === 'hwpx') ? 'hwpx' : 'hwp';
    var name = baseOf(ctx.name) + '_S-Office_' + rand8() + '.' + ext;
    ctx.confirmCopy('사본을 저장할까요?',
      '고친 문서를 새 파일로 저장합니다.\n저장 이름: ' + name,
      '저장하기', function () {
        ctx.busy('사본을 만드는 중…');
        var p;
        if (ext === 'hwp') {
          p = st.editor.exportHwpVerify().then(function (v) {
            if (!v || !v.recovered || v.pageCountBefore !== v.pageCountAfter) throw new Error('저장 전 점검에서 문서를 다시 읽지 못해 저장을 멈췄습니다.');
            return st.editor.exportHwp();
          });
        } else p = st.editor.exportHwpx();
        p.then(function (bytes) {
          ctx.busy(null);
          if (!bytes || bytes.length < 512) throw new Error('저장할 내용이 비어 있습니다.');
          ctx.saveCopy(new Blob([bytes], { type: ext === 'hwpx' ? 'application/haansofthwpx' : 'application/x-hwp' }), name);
          ctx.setDirty(false);
          try { st.editor.notifySaved(name); } catch (e) {}
        }).catch(function (e) { ctx.busy(null); ctx.toast('저장하지 못했습니다 — ' + ((e && e.message) || e), 6000); });
      });
  }

  function open(ctx) {
    st = { editor: null, iframe: null, editing: false, ctx: ctx, dirty: false };
    ctx.body.style.overflow = 'hidden';
    var holder = document.createElement('div'); holder.style.cssText = 'position:absolute;inset:0;'; ctx.body.appendChild(holder);
    return Promise.all([import('../../../' + SDK_URL), readBytes(ctx.file)]).then(function (r) {
      var sdk = r[0], bytes = r[1];
      return sdk.createEditor(holder, { studioUrl: STUDIO_URL, requestTimeoutMs: 60000 }).then(function (ed) {
        st.editor = ed; st.iframe = holder.querySelector('iframe');
        ctx.busy('문서를 여는 중…');
        return ed.loadFile(bytes, ctx.name, { skipUnsavedGuard: true });
      });
    }).then(function () {
      setReadOnly(true); setActions(ctx); ctx.busy(null);
      try { if (st.editor.onDocumentChanged) st.editor.onDocumentChanged(function () { if (st && st.editing) { st.dirty = true; ctx.setDirty(true); } }); } catch (e) {}
      // 쪽 수 등 점검 정보(시험용)
      try { st.editor.pageCount().then(function (n) { st && (st.pages = n); }); } catch (e) {}
    });
  }
  function close() {
    if (!st) return;
    try { if (st.editor && st.editor.destroy) st.editor.destroy(); } catch (e) {}
    st = null;
  }

  SOffice.register({
    id: 'hwp', label: '한글', editable: true,
    credits: [
      { name: 'rhwp (Edward Kim)', license: 'MIT', note: '한글 문서 해석·그리기·편집 엔진(이음오피스가 한컴 문서 모양에 맞게 고친 빌드)' },
      { name: '이음오피스 / GenOffice 의 일부 빌드', license: 'Apache-2.0', note: '한글 편집 화면 번들(수정해서 사용)' },
      { name: 'CanvasKit (Skia)', license: 'BSD-3-Clause', note: '한글 화면 그리기' }
    ],
    canOpen: function () { return SO_HWP === 'on'; },
    open: open, close: close
  });
})(window);

/* so-md.js — S-Office 마크다운·텍스트(md·markdown·txt) 보기. 출처: marked 18.1.1 (MIT, https://github.com/markedjs/marked)
 *   + DOMPurify 3.4.17 (Apache-2.0 선택, https://github.com/cure53/DOMPurify, Cure53). 보기 전용.
 * 안전: 마크다운을 HTML 로 바꾼 뒤 DOMPurify 로 스크립트·이벤트·위험 주소를 제거한다. 바깥 그림은 기본으로 막고(눌러서 불러오기),
 *       링크는 확인 후에만 연다. .txt 는 마크다운으로 해석하지 않고 글자 그대로(textContent) 보여 준다. */
(function () {
  'use strict';
  var cleanup = [];
  var FS_KEY = 'so_md_fs_v1', LH_KEY = 'so_md_lh_v1';
  var LH_STEPS = [1.55, 1.75, 2.0];
  function lsGet(k, d) { try { var v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? v : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  function decode(buf) {
    var u8 = new Uint8Array(buf), s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { try { s = new TextDecoder('euc-kr').decode(u8); } catch (e2) { s = new TextDecoder('utf-8').decode(u8); } }
    return s.replace(/^﻿/, '');
  }

  function sanitize(html) {
    var P = window.DOMPurify;
    return P.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
      FORBID_ATTR: ['style', 'srcset'],
      ALLOW_DATA_ATTR: false
    });
  }

  function open(ctx) {
    var isTxt = ctx.ext === 'txt';
    ctx.loadCss('js/smartoffice/md/so-md.css');
    return ctx.file.arrayBuffer().then(function (buf) {
      var text = decode(buf);
      if (isTxt) return { text: text };
      return Promise.all([ctx.loadScript('vendor/so/md/marked.umd.js'), ctx.loadScript('vendor/so/md/purify.min.js')]).then(function () {
        if (!window.marked || !window.DOMPurify) throw new Error('마크다운 부품을 찾지 못함');
        return { text: text };
      });
    }).then(function (r) {
      var host = ctx.body; host.classList.add('so-md-host');
      var page = document.createElement('div'); page.className = 'so-md-page'; host.appendChild(page);
      // 글자 크기·줄 간격: 눈에 맞게 바꾸고 기억한다
      var fs = Math.min(26, Math.max(13, lsGet(FS_KEY, 17))), lhI = Math.min(2, Math.max(0, Math.round(lsGet(LH_KEY, 1))));
      function applyType() { host.style.setProperty('--md-fs', fs + 'px'); host.style.setProperty('--md-lh', LH_STEPS[lhI]); }
      applyType();
      var fab = document.createElement('div'); fab.className = 'so-md-fab';
      fab.innerHTML = '<div class="so-md-fab-in"><button type="button" data-k="fs-" aria-label="글자 작게">가<small>−</small></button><button type="button" data-k="fs+" aria-label="글자 크게">가<small>＋</small></button><button type="button" data-k="lh" aria-label="줄 간격 바꾸기">줄 간격</button></div>';
      var fabT = 0;
      function fabWake() { fab.classList.remove('dim'); clearTimeout(fabT); fabT = setTimeout(function () { fab.classList.add('dim'); }, 2800); }
      fab.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return; var k = b.getAttribute('data-k');
        if (k === 'fs-') fs = Math.max(13, fs - 1); else if (k === 'fs+') fs = Math.min(26, fs + 1); else lhI = (lhI + 1) % LH_STEPS.length;
        lsSet(FS_KEY, fs); lsSet(LH_KEY, lhI); applyType(); fabWake();
        if (k === 'lh') ctx.toast(['줄 간격: 좁게', '줄 간격: 보통', '줄 간격: 넓게'][lhI], 1200);
      });
      fab.addEventListener('pointerdown', fabWake);
      host.addEventListener('scroll', fabWake, { passive: true });
      host.appendChild(fab); fabWake();
      cleanup.push(function () { clearTimeout(fabT); host.classList.remove('so-md-host'); host.style.removeProperty('--md-fs'); host.style.removeProperty('--md-lh'); });
      var showSrc = isTxt, blockedImgs = 0, extImgOk = false;

      function draw() {
        page.innerHTML = '';
        if (showSrc) {
          var pre = document.createElement('pre'); pre.className = 'so-md-src'; pre.textContent = r.text; page.appendChild(pre); return;
        }
        var html = window.marked.parse(r.text, { gfm: true, breaks: false, async: false });
        var clean = sanitize(html);
        // 화면에 붙이기 전에, 요청이 나가지 않는 비활성 문서(DOMParser)에서 바깥 주소를 먼저 걷어낸다
        var doc = document.createElement('div'); doc.className = 'so-md-doc';
        var inert = new DOMParser().parseFromString('<!doctype html><body>' + clean, 'text/html').body;
        var isExt = function (u) { return /^\s*(?:https?:)?\/\//i.test(u || ''); };
        [].forEach.call(inert.querySelectorAll('*'), function (el) {
          ['srcset', 'poster', 'background'].forEach(function (n) { if (el.hasAttribute(n) && (n !== 'srcset' || /https?:|\/\//i.test(el.getAttribute(n)))) el.removeAttribute(n); });
          var st = el.getAttribute('style'); if (st && /url\s*\(|@import/i.test(st)) el.removeAttribute('style');
          if (el.tagName === 'SOURCE' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO' || el.tagName === 'IFRAME' || el.tagName === 'EMBED' || el.tagName === 'OBJECT') { if (isExt(el.getAttribute('src'))) el.removeAttribute('src'); }
        });
        blockedImgs = 0;
        [].forEach.call(inert.querySelectorAll('img'), function (im) {
          var src = im.getAttribute('src') || '';
          if (/^data:image\//i.test(src)) return;
          if (/^https?:/i.test(src) && extImgOk) return;
          if (/^https?:/i.test(src)) { blockedImgs++; }
          var ph = document.createElement('span'); ph.className = 'so-md-img'; ph.textContent = '🖼 ' + (im.getAttribute('alt') || '그림') + (/^https?:/i.test(src) ? ' (바깥 그림 · 막음)' : ' (폰에 없는 그림)');
          im.replaceWith(ph);
        });
        [].forEach.call(inert.querySelectorAll('a'), function (a) { a.setAttribute('rel', 'noopener noreferrer'); a.removeAttribute('target'); });
        while (inert.firstChild) doc.appendChild(document.adoptNode(inert.firstChild));
        page.appendChild(doc);
        if (blockedImgs) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'so-md-extimg'; b.textContent = '바깥 그림 ' + blockedImgs + '개 불러오기';
          b.onclick = function () { extImgOk = true; draw(); }; page.insertBefore(b, page.firstChild);
        }
      }
      function setActs() {
        var acts = [];
        if (!isTxt) acts.push({ label: showSrc ? '보기' : '원문', onClick: function () { showSrc = !showSrc; draw(); setActs(); } });
        ctx.setActions(acts);
      }
      var onClick = function (e) {
        var a = e.target.closest && e.target.closest('a'); if (!a) return;
        e.preventDefault();
        var href = a.getAttribute('href') || '';
        if (/^https?:\/\//i.test(href)) {
          ctx.confirm('링크 열기', href, '열기', function () { try { window.open(href, '_blank', 'noopener,noreferrer'); } catch (x) {} });
        } else if (href.charAt(0) === '#') {
          var t = null; try { t = page.querySelector('[id="' + href.slice(1).replace(/"/g, '') + '"]'); } catch (x) {}
          if (t) t.scrollIntoView();
        } else ctx.toast('이 링크는 열 수 없어요.');
      };
      page.addEventListener('click', onClick);
      draw(); setActs();
    });
  }

  SOffice.register({
    id: 'md', label: '마크다운·텍스트', editable: false,
    credits: [
      { name: 'marked', license: 'MIT', note: '마크다운 보기' },
      { name: 'DOMPurify (Cure53)', license: 'Apache-2.0', note: '스크립트 제거' }
    ],
    canOpen: function () { return true; },
    open: open,
    close: function () { cleanup.forEach(function (f) { try { f(); } catch (e) {} }); cleanup = []; }
  });
})();

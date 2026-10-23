/* so-html.js — S-Office HTML(.html·.htm) 보기. 외부 부품 없음(브라우저 기본 기능만 사용). 보기 전용.
 * 안전: <iframe sandbox="">(스크립트·폼·팝업·같은 출처 전부 막음) + 문서 맨 앞에 CSP(default-src 'none')를 넣어
 *       바깥 주소로 나가는 요청(그림·글꼴·스타일·프레임)을 막는다. 문서의 모양(CSS)만 그리고 동작(스크립트)은 하지 않는다.
 *       링크는 눌러도 열리지 않는다. 폰에 없는 그림·글꼴은 보이지 않는다. */
(function () {
  'use strict';

  function decode(buf) {
    var u8 = new Uint8Array(buf), s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { try { s = new TextDecoder('euc-kr').decode(u8); } catch (e2) { s = new TextDecoder('utf-8').decode(u8); } }
    return s.replace(/^﻿/, '');
  }
  var CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; form-action 'none'; frame-src 'none'; base-uri 'none'";

  SOffice.register({
    id: 'html', label: 'HTML', editable: false,
    credits: [{ name: '브라우저 기본 기능', license: '브라우저 내장', note: 'sandbox iframe 으로 안전하게 표시' }],
    canOpen: function () { return true; },
    open: function (ctx) {
      ctx.loadCss('js/smartoffice/html/so-html.css');
      return ctx.file.arrayBuffer().then(function (buf) {
        var src = decode(buf), host = ctx.body; host.classList.add('so-html-host');
        var showSrc = false;
        var frame = document.createElement('iframe');
        frame.className = 'so-html-frame';
        frame.setAttribute('sandbox', '');                 // 전부 막음(스크립트·같은 출처·팝업·폼 없음)
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('csp', CSP);
        frame.setAttribute('title', ctx.name);
        // CSP 메타를 맨 앞에 둔다(문서 안의 어떤 태그보다 먼저 적용)
        frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:#fff;color:#000}</style>' + src;
        var pre = document.createElement('pre'); pre.className = 'so-html-src'; pre.textContent = src; pre.style.display = 'none';
        var tip = document.createElement('div'); tip.className = 'so-html-tip';
        tip.textContent = '보기 전용 · 스크립트와 바깥 주소 요청은 막았어요';
        host.appendChild(frame); host.appendChild(pre); host.appendChild(tip);
        setTimeout(function () { tip.classList.add('hide'); }, 4500);
        function acts() {
          ctx.setActions([{ label: showSrc ? '보기' : '원문', onClick: function () {
            showSrc = !showSrc; frame.style.display = showSrc ? 'none' : ''; pre.style.display = showSrc ? '' : 'none'; acts();
          } }]);
        }
        acts();
      });
    },
    close: function () {}
  });
})();

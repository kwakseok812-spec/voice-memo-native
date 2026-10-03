/* ============================================================================
 * share-in.js — v8.2(O-0157) 어디서든 [공유] → 케이
 * ----------------------------------------------------------------------------
 * 다른 앱(카톡 글·인터넷 링크·갤러리 사진 여러 장·파일)에서 [공유] → 스마트비서 를 고르면
 *   네이티브(MainActivity.handleShare)가 글과 파일(앱 캐시 사본 경로)을 KBridge 'shareIn' 으로 넘긴다.
 *   1) 문서 1개만 왔으면(글 없음) → [문서 뷰어로 열기] / [케이에게 보내기] / [취소] 고르기
 *   1-2) v8.4(O-0162) 녹음 파일 1개(m4a·mp3·wav·통화 녹음 등)만 왔으면 → [회의록으로 정리] / [케이에게 보내기] / [취소]
 *        「회의록으로 정리」= 앱 녹음과 같은 「녹음 완료」 화면(제목·회의자료 붙이기·PC로 보내 정리하기·임시 저장, 40MB 넘으면 조각 전송)
 *   2) 그 밖 → 케이 채팅을 열고 사진·파일은 첨부 대기줄, 글·링크는 입력창에 채운다(보내지 않음)
 *      + 입력창 위 빠른 칩 「요약해 줘」「답장 써 줘」「일정 잡아 줘」(누르면 맨 앞에 부탁 한 줄이 들어감)
 *      → 대표님이 입력창을 눌러 고치거나 그대로 [보내기]. 보내는 길은 평소 채팅과 완전히 같다.
 * 「열기(VIEW) → 스마트비서」 로 온 문서는 예전처럼 곧장 문서 뷰어(app.js openSharedDoc, 60MB) — 이 파일과 무관.
 * 폰(APK v8.2+)에서만 동작. PC판·옛 APK 는 아무것도 하지 않는다.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Cap = global.Capacitor;
  if (!Cap || typeof Cap.isNativePlatform !== 'function' || !Cap.isNativePlatform()) return;
  var KB = Cap.Plugins && Cap.Plugins.KBridge;
  if (!KB) return;

  var DOC_EXT = /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|ppt|pptx)$/i;
  var DOC_MIME = /pdf|msword|officedocument|ms-excel|ms-powerpoint|hwp|hancom/i;
  var IMG_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;
  var AUD_EXT = /\.(m4a|mp3|wav|aac|amr|3gp|3ga|ogg|oga|opus|flac|wma)$/i;   // v8.4: 녹음 파일(통화 녹음은 보통 m4a)
  var MAX_IMAGES = 6;                              // 채팅 사진 대기줄 한도(app.js onChatCamPicked 와 같음)
  var REASON = { too_big: '300MB가 넘어요', unreadable: '읽지 못했어요', too_many: '한 번에 20개까지예요' };
  // 빠른 칩 → 입력창 맨 앞에 들어가는 부탁 한 줄
  var CHIPS = [
    { id: 'sum',   label: '요약해 줘',   text: '이 내용을 요약해 줘.' },
    { id: 'reply', label: '답장 써 줘',  text: '이 메시지에 보낼 답장을 써 줘.' },
    { id: 'sched', label: '일정 잡아 줘', text: '이 내용으로 일정을 잡아 줘.' }
  ];

  function $(id) { return document.getElementById(id); }
  function toast(m, ms) { try { if (global.SmartHome && SmartHome.toast) SmartHome.toast(m, ms); } catch (e) {} }
  function skipIntro() { try { if (global.KIntro && KIntro.active && KIntro.active()) KIntro.skip(); } catch (e) {} }
  function isDoc(f) { return DOC_EXT.test(f.name || '') || DOC_MIME.test(f.type || ''); }
  function isImg(f) { return /^image\//i.test(f.type || '') || IMG_EXT.test(f.name || ''); }
  function isAudio(f) { if (/^video\//i.test(f.type || '')) return false; return /^audio\//i.test(f.type || '') || AUD_EXT.test(f.name || ''); }
  function sizeLabel(b) {
    if (!b) return '';
    if (b < 1024 * 1024) return Math.max(1, Math.round(b / 1024)) + 'KB';
    return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // 네이티브가 앱 캐시에 복사해 둔 사본(path) → 웹 File (native-input.js 와 같은 방식)
  function toFile(f) {
    var url = (typeof Cap.convertFileSrc === 'function') ? Cap.convertFileSrc(f.path) : f.path;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (b) {
      return new File([b], f.name || '파일', { type: f.mime || b.type || '', lastModified: Date.now() });
    }).catch(function () { return null; });
  }

  // 링크 공유는 보통 제목(subject)+주소(text)로 온다 → 「제목\n주소」 한 덩어리로
  function sharedText(subject, text) {
    subject = String(subject || '').trim(); text = String(text || '').trim();
    if (subject && text && text.indexOf(subject) === -1) return subject + '\n' + text;
    return text || subject;
  }

  KB.addListener('shareBusy', function (ev) {
    skipIntro();
    var n = (ev && ev.count) || 0;
    if (n) toast('받은 파일 ' + n + '개를 준비하고 있어요…', 2500);
  });
  KB.addListener('shareIn', function (p) { skipIntro(); handle(p || {}); });

  function handle(p) {
    if (p.error) { toast(p.error); return; }
    var metas = p.files || [];
    Promise.all(metas.map(toFile)).then(function (files) {
      var ok = [], bad = (p.skipped || []).slice();
      files.forEach(function (f, i) { if (f) ok.push(f); else bad.push({ name: metas[i] && metas[i].name, reason: 'unreadable' }); });
      if (bad.length) {
        var b0 = bad[0];
        toast('「' + (b0.name || '파일') + '」' + (bad.length > 1 ? ' 외 ' + (bad.length - 1) + '개' : '') + '는 붙이지 못했어요(' + (REASON[b0.reason] || '읽지 못했어요') + '). 큰 파일은 채팅의 ＋로 직접 고르면 5GB까지 보낼 수 있어요.', 6000);
      }
      var text = sharedText(p.subject, p.text);
      if (!ok.length && !text) return;
      if (ok.length === 1 && !text && isDoc(ok[0])) { askDoc(ok[0]); return; }
      // v8.4: 녹음 파일 1개(글은 없거나 앱이 붙인 파일 이름 정도) → 회의록/케이 고르기
      if (ok.length === 1 && isAudio(ok[0]) && (!text || text.length <= 120)) { askAudio(ok[0], text); return; }
      toChat(text, ok);
    });
  }

  /* ---- 문서 1개: 뷰어로 볼지 케이에게 보낼지 고르기 ---- */
  var sheet = null;
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
  function askDoc(file) {
    closeSheet();
    sheet = document.createElement('div');
    sheet.className = 'sheet shin-sheet';
    sheet.innerHTML =
      '<div class="sheet-box" role="dialog" aria-label="공유받은 문서">' +
        '<div class="sheet-head">이 문서를 어떻게 할까요?</div>' +
        '<div class="shin-file"><svg><use href="#i-doc"/></svg><span class="nm">' + esc(file.name) + '</span><small>' + esc(sizeLabel(file.size)) + '</small></div>' +
        '<button type="button" class="sheet-btn primary" data-act="view"><svg><use href="#i-doc"/></svg><span>문서 뷰어로 열기</span></button>' +
        '<button type="button" class="sheet-btn" data-act="chat"><svg><use href="#i-chat"/></svg><span>케이에게 보내기</span></button>' +
        '<button type="button" class="sheet-btn" data-act="cancel">취소</button>' +
      '</div>';
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) { if (ev.target === sheet) closeSheet(); return; }
      var act = b.getAttribute('data-act');
      closeSheet();
      if (act === 'view') { if (global.SmartHome && SmartHome.openDocFile) SmartHome.openDocFile(file); }
      else if (act === 'chat') toChat('', [file]);
    });
    document.body.appendChild(sheet);
  }

  /* ---- v8.4(O-0162) 녹음 파일 1개: 회의록으로 정리할지 케이에게 보낼지 고르기 ---- */
  function askAudio(file, text) {
    closeSheet();
    sheet = document.createElement('div');
    sheet.className = 'sheet shin-sheet';
    sheet.innerHTML =
      '<div class="sheet-box" role="dialog" aria-label="공유받은 녹음 파일">' +
        '<div class="sheet-head">이 녹음을 어떻게 할까요?</div>' +
        '<div class="shin-file"><svg><use href="#i-mic"/></svg><span class="nm">' + esc(file.name) + '</span><small>' + esc(sizeLabel(file.size)) + '</small></div>' +
        '<button type="button" class="sheet-btn primary" data-act="meet"><svg><use href="#i-note"/></svg><span>회의록으로 정리</span></button>' +
        '<div class="shin-hint">앱에서 녹음한 것처럼 PC가 받아 적고 요약해 「회의 요약」에 올려요. 회의자료도 붙일 수 있어요.</div>' +
        '<button type="button" class="sheet-btn" data-act="chat"><svg><use href="#i-chat"/></svg><span>케이에게 보내기</span></button>' +
        '<button type="button" class="sheet-btn" data-act="cancel">취소</button>' +
      '</div>';
    sheet.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!b) { if (ev.target === sheet) closeSheet(); return; }
      var act = b.getAttribute('data-act');
      closeSheet();
      if (act === 'meet') {
        if (global.SmartHome && SmartHome.audioToMeeting) SmartHome.audioToMeeting(file);
        else toast('회의록 화면을 준비하지 못했어요.');
      } else if (act === 'chat') toChat(text || '', [file]);
    });
    document.body.appendChild(sheet);
  }

  /* ---- 채팅으로: 첨부 대기줄 + 입력창 채우기 + 빠른 칩 ---- */
  var base = '';                                   // 공유받은 글(입력창 본문)
  function toChat(text, files) {
    if (!global.SmartHome || !SmartHome.shareToChat) { toast('채팅을 준비하지 못했어요.'); return; }
    var imgs = [], others = [];
    files.forEach(function (f) { if (isImg(f) && imgs.length < MAX_IMAGES) imgs.push(f); else others.push(f); });
    SmartHome.shareToChat({ images: imgs, files: others });
    base = text ? '[공유받은 내용]\n' + text : '';
    setInput(base);
    showChips(files.length, !!text);
    setTimeout(function () { toast('공유한 내용을 붙였어요. 할 일을 고르거나 직접 적은 뒤 [보내기]를 누르세요.', 4000); }, 50);
  }
  function setInput(v) {
    var ta = $('chatInput'); if (!ta) return;
    ta.value = v;
    try { ta.dispatchEvent(new Event('input')); } catch (e) {}
  }
  // 입력창 맨 앞의 부탁 한 줄만 바꾼다(대표님이 고친 본문은 그대로)
  function stripInstr(v) {
    for (var i = 0; i < CHIPS.length; i++) {
      var t = CHIPS[i].text;
      if (v.indexOf(t) === 0) return v.slice(t.length).replace(/^\n+/, '');
    }
    return v;
  }
  function chipRow() {
    var row = $('shareChips');
    if (row) return row;
    var strip = $('chatPendingStrip'); if (!strip || !strip.parentNode) return null;
    row = document.createElement('div');
    row.id = 'shareChips'; row.className = 'sharebar'; row.style.display = 'none';
    var html = '<div class="sb-head"><svg><use href="#i-spark"/></svg><b>공유받은 내용 — 무엇을 할까요?</b>' +
               '<button type="button" class="sb-x" aria-label="칩 닫기"><svg><use href="#i-x"/></svg></button></div><div class="chips">';
    CHIPS.forEach(function (c) { html += '<button type="button" class="chip hchip" data-chip="' + c.id + '">' + c.label + '</button>'; });
    html += '</div><small class="sb-hint">고치려면 입력창을 누르세요 · [보내기]를 눌러야 전송돼요</small>';
    row.innerHTML = html;
    row.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('.sb-x')) { hideChips(); return; }
      var b = ev.target.closest ? ev.target.closest('[data-chip]') : null; if (!b) return;
      var id = b.getAttribute('data-chip'), on = b.classList.contains('on');
      var ta = $('chatInput'); var body = stripInstr(ta ? ta.value : base);
      Array.prototype.forEach.call(row.querySelectorAll('[data-chip]'), function (x) { x.classList.remove('on'); });
      if (on) { setInput(body); return; }          // 다시 누르면 부탁 한 줄 빼기
      b.classList.add('on');
      var c = CHIPS.filter(function (x) { return x.id === id; })[0];
      setInput(c.text + (body ? '\n\n' + body : ''));
    });
    strip.parentNode.insertBefore(row, strip);
    // 보내면(웹 [보내기] 또는 네이티브 입력 바 보내기 → 같은 버튼) 칩 줄을 닫는다
    var send = $('chatSend');
    if (send) send.addEventListener('click', function () { setTimeout(hideChips, 0); });
    return row;
  }
  function showChips() {
    var row = chipRow(); if (!row) return;
    Array.prototype.forEach.call(row.querySelectorAll('[data-chip]'), function (x) { x.classList.remove('on'); });
    row.style.display = '';
  }
  function hideChips() { var row = $('shareChips'); if (row) row.style.display = 'none'; base = ''; }

  // 점검용(웹 화면에서 흐름 재현) — 실제 공유와 같은 처리로 들어간다
  global.SmartShareIn = { _test: function (p) { handle(p || {}); }, _askDoc: askDoc, _askAudio: askAudio, _toChat: toChat };
})(window);

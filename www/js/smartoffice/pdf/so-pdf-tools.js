/* ============================================================================
 * so-pdf-tools.js — S-Office PDF 편집 보강(O-0861, v10.8 4회차)
 *   영역 가리기(실제로 지움) · 머리글/바닥글 · 문서 정보 · 쪽 크기 맞추기 · 용량 줄이기 · 암호 걸기·풀기 · 책갈피(목차) 보기
 * ----------------------------------------------------------------------------
 * so-pdf-pages.js 의 「꾸미기」 시트 끝에 이어 붙고(새 단추 없음), 암호 풀기는 문서를 열 때, 책갈피 보기는 「쪽 이동」 창에서 부른다.
 * 새 부품: qpdf.wasm(암호 걸기·풀기·구조 압축) — vendor/so/pdf/qpdf/ (스위치 SO_PDF_QPDF). 나머지는 이미 들어 있는 pdf-lib·PDF.js 로 한다.
 * 글꼴을 들이지 않는다: 한글 글은 그림으로 그려 넣는다(쪽 번호·도장과 같은 방식 — 영문·숫자만이면 PDF 기본 글꼴 글자로 들어간다).
 * 이 파일의 코드는 자체 작성이다(다른 프로그램의 소스를 복사하지 않음). 가져온 것은 qpdf.wasm 파일과 그 연결부(qpdf.js)뿐이며 출처·고지는 vendor/so/pdf/qpdf/NOTICE-qpdf.txt 와 js/smartoffice/NOTICE.txt 에 있다.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FAMILY = 'Helvetica, Arial, "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
  var MMPT = 72 / 25.4;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isAscii(t) { return /^[\x20-\x7E]*$/.test(t); }
  function dataToBytes(url) { var b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function canvasBlob(cv, type, q) { return new Promise(function (res, rej) { cv.toBlob(function (b) { if (!b) { rej(new Error('그림을 만들지 못했습니다')); return; } b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, type, q); }); }

  // 쪽을 돌려 놓은 경우의 좌표(so-pdf-pages.js 와 같은 계산) — 보이는 쪽의 왼쪽 아래가 (0,0)
  function toPage(rot, W, H, vx, vy) {
    if (rot === 90) return { x: W - vy, y: vx, a: 90 };
    if (rot === 180) return { x: W - vx, y: H - vy, a: 180 };
    if (rot === 270) return { x: vy, y: H - vx, a: 270 };
    return { x: vx, y: vy, a: 0 };
  }
  function visSize(rot, W, H) { return rot === 90 || rot === 270 ? { w: H, h: W } : { w: W, h: H }; }
  function pageRot(pg) { var a = (pg.getRotation().angle || 0) % 360; return a < 0 ? a + 360 : a; }

  // ======================================================================== qpdf (암호 · 구조 압축)
  var qpdfLoad = null;
  function qpdfOn(ctx) { return !!(ctx && ctx.flag && ctx.flag('pdfqpdf')); }
  function qpdfRun(ctx, buildArgs, bytes) {
    if (!qpdfLoad) qpdfLoad = ctx.loadScript('vendor/so/pdf/qpdf/qpdf.js').then(function () { if (!global.SOQpdfFactory) throw new Error('암호 부품을 불러오지 못했습니다'); });
    return qpdfLoad.catch(function (e) { qpdfLoad = null; throw e; }).then(function () {
      var err = [];
      return global.SOQpdfFactory({ locateFile: function (n) { return 'vendor/so/pdf/qpdf/' + n; }, print: function () {}, printErr: function (m) { err.push(String(m)); } }).then(function (q) {
        q.FS.writeFile('/in.pdf', bytes);
        var code;
        try { code = q.callMain(buildArgs('/in.pdf', '/out.pdf')); } catch (e) { code = 2; }
        var out = null;
        if (code === 0 || code === 3) { try { out = Uint8Array.from(q.FS.readFile('/out.pdf')); } catch (e) { out = null; } }
        return { code: code, out: out, err: err.join('\n') };
      });
    });
  }
  function encryptBytes(ctx, bytes, pw) {
    var owner = 'o' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);   // 쓰기 제한 없이 「열 때 암호」만 건다 — 주인 암호는 무작위
    return qpdfRun(ctx, function (i, o) { return ['--encrypt', '--user-password=' + pw, '--owner-password=' + owner, '--bits=256', '--', i, o]; }, bytes).then(function (r) { if (!r.out) throw new Error('암호를 걸지 못했습니다'); return r.out; });
  }
  // 암호가 맞는지는 PDF.js 로 먼저 확인한다(qpdf 의 오류 글은 쓰지 않는다 — 환경마다 나오는 곳이 다르다)
  function pwOk(bytes, pw) {
    return global.pdfjsLib.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false }).promise.then(function (d) { try { d.destroy(); } catch (e) {} return true; }, function (e) {
      if (e && e.name === 'PasswordException') return false; throw e;
    });
  }
  function decryptBytes(ctx, bytes, pw) {
    return pwOk(bytes, pw).then(function (ok) {
      if (!ok) { var w = new Error('wrong-password'); w.wrong = true; throw w; }
      return qpdfRun(ctx, function (i, o) { return ['--password=' + pw, '--decrypt', i, o]; }, bytes);
    }).then(function (r) {
      if (r.out) return r.out;
      throw new Error('암호를 풀지 못했습니다');
    });
  }
  // 문서를 열 때 암호가 걸려 있으면: 암호를 받아 암호 없는 사본 바이트로 연다(원본은 그대로). 취소하면 null.
  function openWithPassword(ctx, buf) {
    return new Promise(function (resolve) {
      var tries = 0, done = false, bytes = new Uint8Array(buf);
      function ask(msg) {
        var body = el('div', 'spd'), inp = el('input', 'spd-in wide'); inp.type = 'password'; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('aria-label', '문서 암호');
        var note = el('div', 'so-sheet-note', msg || '이 PDF에는 열 때 암호가 걸려 있습니다. 암호를 입력하면 암호 없는 사본으로 열어 고칠 수 있습니다. 원래 파일은 바뀌지 않고, 입력한 암호는 저장되지 않습니다.');
        body.appendChild(note); body.appendChild(inp);
        ctx.sheet({ title: '암호가 걸린 PDF', body: body, buttons: [
          { label: '취소', onClick: function () { if (!done) { done = true; resolve(null); } return true; } },
          { label: '열기', primary: true, onClick: function () {
            var pw = inp.value; if (!pw) { note.textContent = '암호를 입력해 주십시오.'; return false; }
            inp.disabled = true; note.textContent = '확인하는 중…';
            decryptBytes(ctx, bytes, pw).then(function (out) { inp.value = ''; done = true; ctx.closeSheet(); resolve(out); }, function (e) {
              inp.value = ''; inp.disabled = false; tries++;
              if (e && e.wrong) { if (tries >= 5) { done = true; ctx.closeSheet(); ctx.toast('암호가 맞지 않아 열지 못했습니다.', 3600); resolve(null); } else { note.textContent = '암호가 맞지 않습니다. 다시 입력해 주십시오(' + tries + '/5).'; try { inp.focus(); } catch (x) {} } }
              else { done = true; ctx.closeSheet(); ctx.toast('암호를 풀지 못했습니다 — ' + ((e && e.message) || e), 4200); resolve(null); }
            });
            return false;
          } }
        ], keep: function () { return !done; } });
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 120);
      }
      ask();
    });
  }

  // ======================================================================== 공통 도우미
  // 문서 뿌리에서 닿지 않는 개체를 지운다(쪽 정리와 같은 방식)
  function gcDoc(L, doc) {
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
  function textPng(text, pt, color) {            // 글을 그림으로(한글 가능): 1pt = 4픽셀
    var px = Math.max(8, Math.round(pt * 4)), cv = document.createElement('canvas'), g = cv.getContext('2d');
    g.font = px + 'px ' + FAMILY; var w = Math.ceil(g.measureText(text).width) + 8; cv.width = Math.min(w, 8000); cv.height = Math.ceil(px * 1.4);
    g = cv.getContext('2d'); g.font = px + 'px ' + FAMILY; g.fillStyle = color || '#222'; g.textBaseline = 'middle'; g.fillText(text, 4, cv.height / 2);
    return { url: cv.toDataURL('image/png'), wpt: cv.width / 4, hpt: cv.height / 4 };
  }

  // ======================================================================== 영역 가리기 (가린 쪽을 그림으로 굳혀 글을 파일에서도 지운다)
  function redact(api) {
    var ctx = api.ctx, root = api.root, pdf = api.pdfDoc(), N = api.pageCount(), L0 = null;
    if (root.querySelector('.spp')) return;
    var rects = {}, cur = 1, zoom = 1, mode = 'draw', tok = 0, task = null, vp = null, fit = 1, S = 1, destroyed = false;
    var back = el('div', 'spp spr'), bar = el('div', 'spp-bar'), stage = el('div', 'spr-stage'), host = el('div', 'spr-host'), cv = el('canvas', 'spr-cv'), ov = el('div', 'spr-ov'), foot = el('div', 'spp-foot spr-foot');
    var btnC = el('button', 'spp-hb', '취소'), tt = el('div', 'spp-t', ''), btnOk = el('button', 'spp-hb ok', '가리기');
    [btnC, btnOk].forEach(function (b) { b.type = 'button'; });
    bar.appendChild(btnC); bar.appendChild(tt); bar.appendChild(btnOk);
    var hint = el('div', 'spp-hint', '가릴 곳을 손가락으로 끌어 네모로 그리십시오. 가린 쪽은 「그림」이 되어 글이 파일에서도 지워집니다.');
    host.appendChild(cv); host.appendChild(ov); stage.appendChild(host);
    back.appendChild(bar); back.appendChild(hint); back.appendChild(stage); back.appendChild(foot); root.appendChild(back);
    function fb(g, l, fn) { var b = el('button', 'spp-fb'); b.type = 'button'; b.innerHTML = '<span class="t-g"></span><span class="t-l"></span>'; b.firstChild.textContent = g; b.lastChild.textContent = l; b.onclick = fn; foot.appendChild(b); return b; }
    var bPrev = fb('◀', '이전 쪽', function () { go(cur - 1); }), bNext = fb('▶', '다음 쪽', function () { go(cur + 1); });
    var bUndo = fb('↶', '되돌리기', function () { var a = rects[cur]; if (a && a.length) { a.pop(); drawRects(); upd(); } });
    var bClr = fb('🗑', '쪽 비우기', function () { rects[cur] = []; drawRects(); upd(); });
    var bZm = fb('－', '줄이기', function () { setZoom(zoom / 1.5); }), bZp = fb('＋', '키우기', function () { setZoom(zoom * 1.5); });
    var bMode = fb('✋', '움직이기', function () { mode = mode === 'draw' ? 'move' : 'draw'; modeUi(); });
    function modeUi() { stage.setAttribute('data-mode', mode); bMode.lastChild.textContent = mode === 'draw' ? '움직이기' : '그리기'; bMode.firstChild.textContent = mode === 'draw' ? '✋' : '✎'; }
    function total() { var n = 0, p = 0; Object.keys(rects).forEach(function (k) { if (rects[k].length) { n += rects[k].length; p++; } }); return { n: n, p: p }; }
    function upd() { var t = total(); tt.textContent = cur + ' / ' + N + '쪽 · 가림 ' + t.n + '곳(' + t.p + '쪽)'; bPrev.disabled = cur <= 1; bNext.disabled = cur >= N; btnOk.disabled = !t.n; bUndo.disabled = !(rects[cur] && rects[cur].length); bClr.disabled = bUndo.disabled; }
    function setZoom(z) { zoom = Math.max(1, Math.min(4, z)); showPage(true); }
    function go(n) { if (n < 1 || n > N) return; cur = n; zoom = 1; stage.scrollLeft = 0; stage.scrollTop = 0; showPage(); }
    function drawRects() {
      ov.innerHTML = '';
      (rects[cur] || []).forEach(function (r) { var d = el('div', 'spr-r'); d.style.left = r.x * S + 'px'; d.style.top = r.y * S + 'px'; d.style.width = r.w * S + 'px'; d.style.height = r.h * S + 'px'; ov.appendChild(d); });
    }
    function showPage(keepScroll) {
      var my = ++tok; if (task) { try { task.cancel(); } catch (e) {} task = null; }
      pdf.getPage(cur).then(function (pg) {
        if (destroyed || my !== tok) return;
        vp = pg.getViewport({ scale: 1 });
        var aw = Math.max(120, stage.clientWidth - 16), ah = Math.max(120, stage.clientHeight - 16);
        fit = Math.min(aw / vp.width, ah / vp.height); S = fit * zoom;
        var cssW = vp.width * S, cssH = vp.height * S, dpr = Math.min(global.devicePixelRatio || 1, 2.5), k = Math.min(dpr, Math.sqrt(5e6 / (cssW * cssH)));
        cv.width = Math.max(1, Math.round(cssW * k)); cv.height = Math.max(1, Math.round(cssH * k));
        host.style.width = cssW + 'px'; host.style.height = cssH + 'px'; cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px'; ov.style.width = cssW + 'px'; ov.style.height = cssH + 'px';
        var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        task = pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: S * k }) });
        drawRects(); upd();
        return task.promise.then(function () { task = null; try { pg.cleanup(); } catch (e) {} }, function () {});
      }).catch(function (e) { ctx.toast('쪽을 그리지 못했습니다 — ' + ((e && e.message) || e), 3600); });
    }
    // 끌어서 네모 그리기
    var drag = null;
    ov.addEventListener('pointerdown', function (e) {
      if (mode !== 'draw' || !vp) return; e.preventDefault();
      var r = ov.getBoundingClientRect(), x = (e.clientX - r.left) / S, y = (e.clientY - r.top) / S;
      var d = el('div', 'spr-r tmp'); ov.appendChild(d); drag = { x: x, y: y, d: d, id: e.pointerId }; try { ov.setPointerCapture(e.pointerId); } catch (x2) {}
    });
    ov.addEventListener('pointermove', function (e) {
      if (!drag) return; var r = ov.getBoundingClientRect(), x = Math.max(0, Math.min(vp.width, (e.clientX - r.left) / S)), y = Math.max(0, Math.min(vp.height, (e.clientY - r.top) / S));
      drag.c = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
      var d = drag.d; d.style.left = drag.c.x * S + 'px'; d.style.top = drag.c.y * S + 'px'; d.style.width = drag.c.w * S + 'px'; d.style.height = drag.c.h * S + 'px';
    });
    function endDrag(e, ok) {
      if (!drag) return; var c = drag.c; if (drag.d.parentNode) drag.d.parentNode.removeChild(drag.d); drag = null;
      if (ok && c && c.w * S >= 8 && c.h * S >= 8) { (rects[cur] = rects[cur] || []).push(c); }
      drawRects(); upd();
    }
    ov.addEventListener('pointerup', function (e) { endDrag(e, true); });
    ov.addEventListener('pointercancel', function (e) { endDrag(e, false); });
    function close() { destroyed = true; tok++; if (task) { try { task.cancel(); } catch (e) {} } if (back.parentNode) back.parentNode.removeChild(back); api.pagesClosed(); }
    btnC.onclick = function () { if (total().n) ctx.confirm('가린 곳을 버리시겠습니까?', '적용하지 않고 닫으면 그린 네모가 사라집니다.', '버리고 닫기', close, { danger: true, cancelLabel: '계속 가리기' }); else close(); };
    btnOk.onclick = function () {
      var t = total(); if (!t.n) return;
      ctx.confirm('가린 ' + t.p + '쪽을 그림으로 굳힐까요?', '가린 곳은 완전히 검게 되고, 그 쪽의 글은 「그림」으로 바뀌어 글자를 고르거나 검색할 수 없게 됩니다. 가린 곳 아래의 글자는 파일에서도 지워집니다(다른 쪽은 그대로). 되돌리려면 ↶ 를 쓰십시오.', '가리기', function () { bake(t); }, { cancelLabel: '취소' });
    };
    api.onPagesBack(function () { btnC.onclick(); return true; });

    function bake(t) {
      ctx.busy('가린 곳을 굳히는 중…');
      var L, doc, nums = Object.keys(rects).filter(function (k) { return rects[k].length; }).map(Number).sort(function (a, b) { return a - b; }), oldNodes = [], seqP = Promise.resolve();
      return api.loadLib().then(function (l) { L = l; return api.getBytes(); }).then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (d) {
        doc = d;
        nums.forEach(function (n, idx) {
          seqP = seqP.then(function () {
            ctx.busy('가린 곳을 굳히는 중… (' + (idx + 1) + '/' + nums.length + ')');
            return pdf.getPage(n).then(function (pg) {
              var v1 = pg.getViewport({ scale: 1 }), k = Math.min(200 / 72, Math.sqrt(9e6 / (v1.width * v1.height))), c = document.createElement('canvas');
              c.width = Math.ceil(v1.width * k); c.height = Math.ceil(v1.height * k);
              var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
              return pg.render({ canvasContext: g, viewport: pg.getViewport({ scale: k }) }).promise.then(function () {
                g.fillStyle = '#000'; rects[n].forEach(function (r) { g.fillRect(Math.floor(r.x * k) - 1, Math.floor(r.y * k) - 1, Math.ceil(r.w * k) + 2, Math.ceil(r.h * k) + 2); });
                try { pg.cleanup(); } catch (e) {}
                return canvasBlob(c, 'image/jpeg', 0.9).then(function (jb) { c.width = c.height = 0; return doc.embedJpg(jb).then(function (img) { return { img: img, w: v1.width, h: v1.height }; }); });
              });
            }).then(function (r) {
              var old = doc.getPage(n - 1), np = doc.insertPage(n - 1, [r.w, r.h]); np.drawImage(r.img, { x: 0, y: 0, width: r.w, height: r.h });
              oldNodes.push(doc.getPage(n)); doc.removePage(n);
            });
          });
        });
        return seqP;
      }).then(function () {
        var Nm = L.PDFName.of, c = doc.context;
        // 지운 쪽의 옛 내용·자원·주석·섬네일을 비우고, 글이 남을 수 있는 구조(태그 트리·입력 칸 값)를 정리한다
        oldNodes.forEach(function (pg) { try { var d = pg.node; d.set(Nm('Contents'), c.register(c.stream(new Uint8Array(0)))); ['Resources', 'Annots', 'Thumb', 'Metadata', 'PieceInfo', 'StructParents'].forEach(function (k) { try { d.delete(Nm(k)); } catch (e) {} }); } catch (e) {} });
        try { var form = doc.getForm(); form.getFields().forEach(function (f) { var onOld = false; f.acroField.getWidgets().forEach(function (w) { var P = w.P(); oldNodes.forEach(function (o) { if (P && o.ref && P.toString() === o.ref.toString()) onOld = true; }); }); if (onOld) { try { form.removeField(f); } catch (e) {} } }); } catch (e) {}
        try { doc.catalog.delete(Nm('StructTreeRoot')); doc.catalog.delete(Nm('MarkInfo')); } catch (e) {}
        gcDoc(L, doc);
        return doc.save();
      }).then(function (out) {
        return api.pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise.then(function (pd) {
          var ok = pd.numPages === N, chain = Promise.resolve(), leak = 0;
          nums.forEach(function (n) { chain = chain.then(function () { return pd.getPage(n).then(function (pg) { return pg.getTextContent().then(function (tc) { leak += tc.items.filter(function (i) { return String(i.str || '').trim(); }).length; try { pg.cleanup(); } catch (e) {} }); }); }); });
          return chain.then(function () { try { pd.destroy(); } catch (e) {} if (!ok) throw new Error('쪽 수 점검 실패'); if (leak) throw new Error('가린 쪽에 글이 남아 있어 중단했습니다'); return out; });
        });
      }).then(function (out) { return api.applyBytes(out, '영역 가리기'); }).then(function () {
        ctx.busy(null); close(); ctx.toast('가린 곳을 굳혔습니다(' + t.p + '쪽, ' + t.n + '곳). 되돌리려면 ↶ , 저장은 「사본 저장」으로 하십시오.', 4200);
      }).catch(function (e) { ctx.busy(null); ctx.toast('가리지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    }
    modeUi(); setTimeout(function () { showPage(); }, 30);
  }

  // ======================================================================== 꾸미기 시트에 이어 붙는 구역들
  // H = { ctx, st, run(label, mut, okMsg), body } — so-pdf-pages.js 의 buildDeco 가 넘긴다. 구역은 접었다 펼 수 있게 묶는다.
  function extend(api, H) {
    var ctx = api.ctx, body = H.body, st = H.st;
    function grp(title, open) { var parts = title.split(' — '), d = el('details', 'spd-d'); if (open) d.open = true; d.appendChild(el('summary', '', parts[0])); var c = el('div', 'spd-dc'); d.appendChild(c); if (parts[1]) c.appendChild(el('div', 'so-sheet-note', parts[1])); body.appendChild(d); return c; }
    function lab(c, t) { c.appendChild(el('div', 'spd-l', t)); }
    function txt(c, label, key, ph) { var w = el('div', 'spd-f'), i = el('input', 'spd-in wide'); i.type = 'text'; i.maxLength = 80; i.placeholder = ph || ''; i.value = st[key] || ''; i.setAttribute('aria-label', label); i.oninput = function () { st[key] = i.value; }; w.appendChild(el('div', 'spd-u', label)); w.appendChild(i); c.appendChild(w); return i; }
    function chips(c, list, key, cur) { var row = el('div', 'spd-r'); list.forEach(function (o) { var b = el('button', 'spd-b' + (o[0] === cur ? ' on' : ''), o[1]); b.type = 'button'; b.onclick = function () { st[key] = o[0]; [].forEach.call(row.children, function (x) { x.classList.toggle('on', x === b); }); }; row.appendChild(b); }); c.appendChild(row); }
    function act(c, text, fn, cls) { var b = el('button', 'spd-b big' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = function () { ctx.closeSheet(); setTimeout(fn, 60); }; c.appendChild(b); return b; }
    function pwInput(c, label) { var i = el('input', 'spd-in wide'); i.type = 'password'; i.autocomplete = 'new-password'; i.setAttribute('aria-label', label); i.placeholder = label; c.appendChild(i); return i; }
    // 이미 있던 구역(쪽 번호·글자 도장·잘라내기·빈 쪽)도 같은 접이식으로 묶어 시트를 짧게 만든다(.spd-l 글줄이 구역의 시작)
    (function regroup() {
      var kids = [].slice.call(body.children), curBox = null;
      kids.forEach(function (k) {
        if (k.classList && k.classList.contains('spd-l')) {
          var parts = k.textContent.split(' — '), d = el('details', 'spd-d'); d.appendChild(el('summary', '', parts[0]));
          curBox = el('div', 'spd-dc'); d.appendChild(curBox); body.insertBefore(d, k); body.removeChild(k);
          if (parts[1]) curBox.appendChild(el('div', 'so-sheet-note', parts.slice(1).join(' — ')));
          return;
        }
        if (curBox) curBox.appendChild(k);
      });
    })();
    st.hf = st.hf || { hl: '', hc: '', hr: '', fl: '', fc: '', fr: '', size: 9, margin: 12 };
    st.info = st.info || null; st.fit = st.fit || 'a4';

    // ---- 가리기 ----
    var g1 = grp('영역 가리기 — 주민번호·연락처 등을 검게');
    g1.appendChild(el('div', 'so-sheet-note', '가릴 곳을 손가락으로 끌어 그립니다. 가린 쪽은 그림으로 굳어 아래 글이 파일에서도 지워집니다(그 쪽의 글자는 선택·검색이 안 됩니다).'));
    act(g1, '가릴 곳 고르러 가기', function () { redact(api); }, 'on');

    // ---- 머리글·바닥글 ----
    var g2 = grp('머리글·바닥글 — 모든 쪽 위·아래에 글');
    var hf = st.hf;
    var gh = el('div', 'spd-g3'), gf = el('div', 'spd-g3'); g2.appendChild(gh); g2.appendChild(gf);
    txt(gh, '머리글 왼쪽', 'hl_', ''); txt(gh, '머리글 가운데', 'hc_', ''); txt(gh, '머리글 오른쪽', 'hr_', '');
    txt(gf, '바닥글 왼쪽', 'fl_', ''); txt(gf, '바닥글 가운데', 'fc_', '예: {쪽} / {전체}쪽'); txt(gf, '바닥글 오른쪽', 'fr_', '예: {날짜}');
    g2.appendChild(el('div', 'so-sheet-note', '{쪽}은 쪽 번호, {전체}는 전체 쪽 수, {날짜}는 오늘 날짜로 바뀝니다. 한글도 됩니다(영문·숫자만이면 글자로, 한글이 있으면 그림으로 들어갑니다).'));
    chips(g2, [[9, '작게'], [11, '보통'], [14, '크게']], 'hfSize', 9);
    act(g2, '머리글·바닥글 넣기', function () {
      var T = { hl: st.hl_, hc: st.hc_, hr: st.hr_, fl: st.fl_, fc: st.fc_, fr: st.fr_ }, any = Object.keys(T).some(function (k) { return (T[k] || '').trim(); });
      if (!any) { ctx.toast('넣을 글을 하나 이상 적어 주십시오.', 2600); return; }
      var size = st.hfSize || 9, today = new Date(), ds = today.getFullYear() + '. ' + (today.getMonth() + 1) + '. ' + today.getDate() + '.';
      H.run('머리글·바닥글', function (L, doc) {
        return doc.embedFont(L.StandardFonts.Helvetica).then(function (font) {
          var pages = doc.getPages(), n = pages.length, cache = {}, seq = Promise.resolve();
          pages.forEach(function (pg, i) {
            seq = seq.then(function () {
              var box = pg.getSize(), rot = pageRot(pg), vs = visSize(rot, box.width, box.height), m = 12 * MMPT, jobs = [];
              Object.keys(T).forEach(function (k) {
                var s = (T[k] || '').trim(); if (!s) return;
                s = s.replace(/\{쪽\}/g, String(i + 1)).replace(/\{전체\}/g, String(n)).replace(/\{날짜\}/g, ds);
                jobs.push([k, s]);
              });
              var chain = Promise.resolve();
              jobs.forEach(function (j) {
                chain = chain.then(function () {
                  var k = j[0], s = j[1], head = k.charAt(0) === 'h', side = k.charAt(1), w, hh, vy;
                  if (isAscii(s)) {
                    w = font.widthOfTextAtSize(s, size); hh = size;
                    var vx = side === 'l' ? m : (side === 'r' ? vs.w - m - w : (vs.w - w) / 2); vy = head ? vs.h - m - size * 0.8 : m;
                    var q = toPage(rot, box.width, box.height, vx, vy); pg.drawText(s, { x: q.x, y: q.y, size: size, font: font, color: L.rgb(0.15, 0.15, 0.15), rotate: L.degrees(q.a) });
                    return;
                  }
                  var key = s + '|' + size, rec = cache[key]; if (!rec) { var p = textPng(s, size, '#222222'); rec = cache[key] = { p: p, img: null }; }
                  return (rec.img ? Promise.resolve(rec.img) : doc.embedPng(dataToBytes(rec.p.url)).then(function (im) { rec.img = im; return im; })).then(function (im) {
                    w = rec.p.wpt; hh = rec.p.hpt;
                    var vx = side === 'l' ? m : (side === 'r' ? vs.w - m - w : (vs.w - w) / 2); vy = head ? vs.h - m - hh : m - hh * 0.2;
                    var q = toPage(rot, box.width, box.height, vx, vy); pg.drawImage(im, { x: q.x, y: q.y, width: w, height: hh, rotate: L.degrees(q.a) });
                  });
                });
              });
              return chain;
            });
          });
          return seq.then(function () { return ''; });
        });
      }, '머리글·바닥글을 넣었습니다.');
    }, 'on');

    // ---- 쪽 크기 맞추기 ----
    var g3 = grp('쪽 크기 맞추기 — 모든 쪽을 같은 종이 크기로');
    chips(g3, [['a4', 'A4'], ['a3', 'A3'], ['b5', 'B5'], ['letter', 'Letter']], 'fit', st.fit);
    g3.appendChild(el('div', 'so-sheet-note', '쪽의 가로·세로 방향은 그대로 두고, 내용을 비율대로 키우거나 줄여 가운데에 놓습니다. 이 과정에서 쪽 안의 링크와 입력 칸은 사라질 수 있습니다.'));
    act(g3, '모든 쪽 크기 맞추기', function () {
      var SZ = { a4: [595.28, 841.89], a3: [841.89, 1190.55], b5: [498.9, 708.66], letter: [612, 792] }[st.fit] || [595.28, 841.89];
      var go = function () {
        H.run('쪽 크기 맞추기', function (L, doc) {
          var pages = doc.getPages(), embedP = [];
          pages.forEach(function (pg) { var cb = pg.getCropBox ? pg.getCropBox() : pg.getMediaBox(); embedP.push({ left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height }); });
          return Promise.all(pages.map(function (pg, i) { return doc.embedPage(pg, embedP[i]); })).then(function (eps) {
            var oldNodes = pages.slice();
            pages.forEach(function (pg, i) {
              var cb = embedP[i], cw = cb.right - cb.left, ch = cb.top - cb.bottom, rot = pageRot(pg), vs = visSize(rot, cw, ch), land = vs.w > vs.h;
              var Tw = land ? SZ[1] : SZ[0], Th = land ? SZ[0] : SZ[1], k = Math.min(Tw / vs.w, Th / vs.h);
              var nw = rot === 90 || rot === 270 ? Th : Tw, nh = rot === 90 || rot === 270 ? Tw : Th;
              var np = doc.insertPage(i, [nw, nh]); if (rot) np.setRotation(L.degrees(rot));
              np.drawPage(eps[i], { x: (nw - cw * k) / 2, y: (nh - ch * k) / 2, xScale: k, yScale: k });
            });
            for (var i = oldNodes.length - 1; i >= 0; i--) doc.removePage(oldNodes.length + i);
            try { var Nm = L.PDFName.of; doc.catalog.delete(Nm('StructTreeRoot')); } catch (e) {}
            return doc.flush().then(function () { gcDoc(L, doc); return ''; });      // 끼워 넣은 쪽을 먼저 실제 개체로 만든 뒤에 안 쓰는 개체를 지운다(안 그러면 옛 쪽 내용이 먼저 지워져 오류)
          });
        }, '쪽 크기를 맞췄습니다.');
      };
      ctx.confirm('모든 쪽을 ' + st.fit.toUpperCase().replace('LETTER', 'Letter') + ' 크기로 맞출까요?', '내용은 비율대로 가운데에 놓입니다. 쪽 안의 링크·입력 칸은 사라질 수 있습니다. 되돌리려면 ↶ 를 쓰십시오.', '맞추기', go, { cancelLabel: '취소' });
    });

    // ---- 문서 정보 ----
    var g4 = grp('문서 정보 — 제목·작성자 고치기·지우기');
    var infoBox = el('div'); g4.appendChild(infoBox);
    infoBox.appendChild(el('div', 'so-sheet-note', '이 구역을 펼치면 지금 들어 있는 정보를 읽어 옵니다.'));
    g4.parentNode.addEventListener('toggle', function () {
      if (!g4.parentNode.open || st.info) return; st.info = { loading: true };
      Promise.all([api.loadLib(), api.getBytes()]).then(function (r) { return r[0].PDFDocument.load(r[1], { updateMetadata: false }).then(function (d) { return { t: d.getTitle() || '', a: d.getAuthor() || '', s: d.getSubject() || '', k: d.getKeywords() || '', p: d.getProducer() || '', c: d.getCreator() || '' }; }); }).then(function (inf) {
        st.info = inf; infoBox.innerHTML = '';
        txt_(infoBox, '제목', 't'); txt_(infoBox, '작성자', 'a'); txt_(infoBox, '주제', 's'); txt_(infoBox, '키워드', 'k');
        infoBox.appendChild(el('div', 'so-sheet-note', '만든 프로그램: ' + (inf.c || '(없음)') + ' / ' + (inf.p || '(없음)')));
        var b1 = act(infoBox, '위 내용으로 고치기', function () { H.run('문서 정보', function (L, doc) { doc.setTitle(st.info.t || ''); doc.setAuthor(st.info.a || ''); doc.setSubject(st.info.s || ''); doc.setKeywords((st.info.k || '').split(/[,;]\s*/).filter(Boolean)); return ''; }, '문서 정보를 고쳤습니다.'); }, 'on');
        act(infoBox, '정보 모두 지우기', function () {
          H.run('문서 정보 지우기', function (L, doc) {
            var Nm = L.PDFName.of, ref = doc.context.trailerInfo.Info, d = ref ? doc.context.lookup(ref) : null;
            if (d && d.keys) { d.keys().slice().forEach(function (k) { d.delete(k); }); }
            try { doc.catalog.delete(Nm('Metadata')); } catch (e) {}
            return '(제목·작성자·주제·키워드·만든 프로그램·날짜를 비웠습니다)';
          }, '문서 정보를 지웠습니다.');
        });
      }).catch(function (e) { st.info = null; infoBox.innerHTML = ''; infoBox.appendChild(el('div', 'so-sheet-note', '정보를 읽지 못했습니다 — ' + ((e && e.message) || e))); });
    });
    function txt_(c, label, key) { var i = el('input', 'spd-in wide'); i.type = 'text'; i.value = st.info[key] || ''; i.setAttribute('aria-label', label); i.oninput = function () { st.info[key] = i.value; }; c.appendChild(el('div', 'spd-u', label)); c.appendChild(i); }

    // ---- 용량 줄이기 ----
    var g5 = grp('용량 줄이기 — 큰 그림을 줄여 파일을 작게');
    g5.appendChild(el('div', 'so-sheet-note', '쪽 안의 큰 그림(사진·스캔)을 다시 줄여 저장합니다. 글자·쪽 모양은 그대로이고 그림 화질만 낮아집니다. 줄인 결과를 보고 쓸지 정합니다.'));
    [['low', '조금 줄이기(화질 우선)'], ['mid', '보통 줄이기'], ['high', '많이 줄이기(화질 낮음)']].forEach(function (o) { act(g5, o[1], function () { compress(api, o[0]); }, o[0] === 'mid' ? 'on' : ''); });

    // ---- 암호 걸기 ----
    if (qpdfOn(ctx)) {
      var g6 = grp('암호 걸기 — 열 때 암호를 묻는 사본으로 저장');
      g6.appendChild(el('div', 'so-sheet-note', '암호를 직접 입력하시면 그 암호가 걸린 새 사본(원래이름_암호.pdf)으로 저장합니다. 암호를 잊으면 아무도 열 수 없으니 꼭 적어 두십시오. 입력한 암호는 저장되지 않습니다. 이 화면의 문서는 그대로입니다.'));
      var p1 = pwInput(g6, '암호'), p2 = pwInput(g6, '암호 한 번 더');
      act(g6, '암호 걸어 사본 저장', function () {
        var a = p1.value, b = p2.value; p1.value = p2.value = '';
        if (!a || a.length < 4) { ctx.toast('암호는 4자 이상으로 입력해 주십시오.', 2800); return; }
        if (a !== b) { ctx.toast('두 번 입력한 암호가 다릅니다. 다시 입력해 주십시오.', 3000); return; }
        ctx.busy('암호를 거는 중…');
        api.getBytes().then(function (bytes) { return encryptBytes(ctx, bytes, a); }).then(function (out) {
          ctx.busy(null); var base = (ctx.name || 'document').replace(/\.pdf$/i, '').replace(/_수정(\(\d+\))?$/, '');
          return Promise.resolve(ctx.saveCopy(new Blob([out], { type: 'application/pdf' }), base + '_암호.pdf', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('암호를 건 사본을 저장했습니다. 암호를 잊지 마십시오.', 4200); });
        }).catch(function (e) { ctx.busy(null); ctx.toast('암호를 걸지 못했습니다 — ' + ((e && e.message) || e), 4200); });
      }, 'on');
    }
  }

  // ======================================================================== 용량 줄이기 (큰 그림을 캔버스로 다시 줄이고, qpdf 로 구조를 압축)
  var LEVELS = { low: { name: '조금 줄이기', side: 2600, q: 0.86 }, mid: { name: '보통 줄이기', side: 1700, q: 0.74 }, high: { name: '많이 줄이기', side: 1100, q: 0.58 } };
  function compressBytes(api, bytes, level, onProg) {
    var ctx = api.ctx, lv = LEVELS[level] || LEVELS.mid, L, doc, stat = { imgs: 0, done: 0, before: bytes.length, mid: 0, after: 0, imgBefore: 0, imgAfter: 0, qpdf: false };
    return api.loadLib().then(function (l) { L = l; return L.PDFDocument.load(bytes, { updateMetadata: false }); }).then(function (d) {
      doc = d; var N = L.PDFName.of, list = [];
      doc.context.enumerateIndirectObjects().forEach(function (e) { var o = e[1]; if (o instanceof L.PDFRawStream && o.dict.get(N('Subtype')) === N('Image')) list.push([e[0], o]); });
      stat.imgs = list.length; var chain = Promise.resolve();
      list.forEach(function (it, idx) {
        chain = chain.then(function () { if (onProg) onProg(idx + 1, list.length); return sleep(0); }).then(function () { return shrinkImage(L, doc, it[0], it[1], lv, stat); }).catch(function () {});
      });
      return chain;
    }).then(function () { gcDoc(L, doc); return doc.save({ useObjectStreams: true }); }).then(function (out) {
      stat.mid = out.length;
      if (!qpdfOn(ctx)) { stat.after = out.length; return { out: out, stat: stat }; }
      return qpdfRun(ctx, function (i, o) { return ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', i, o]; }, out).then(function (r) {
        if (r.out && r.out.length < out.length) { stat.qpdf = true; stat.after = r.out.length; return { out: r.out, stat: stat }; }
        stat.after = out.length; return { out: out, stat: stat };
      }, function () { stat.after = out.length; return { out: out, stat: stat }; });
    });
  }
  function shrinkImage(L, doc, ref, obj, lv, stat) {
    var N = L.PDFName.of, d = obj.dict, g = function (k) { return d.get(N(k)); };
    var w = g('Width') && g('Width').asNumber && g('Width').asNumber(), h = g('Height') && g('Height').asNumber && g('Height').asNumber();
    if (!w || !h) return;
    if (g('ImageMask') && String(g('ImageMask')) === 'true') return;
    if (g('Decode') || g('Mask')) return;
    var f = g('Filter'); if (f instanceof L.PDFArray) { if (f.size() !== 1) return; f = f.get(0); }
    var fname = f ? String(f) : ''; if (fname !== '/DCTDecode' && fname !== '/FlateDecode') return;
    var cs = g('ColorSpace'), csn = cs instanceof L.PDFName ? String(cs) : '';
    var oldLen = obj.contents.length; if (oldLen < 40000) return;                      // 작은 그림은 건드리지 않는다
    var bpc = g('BitsPerComponent') && g('BitsPerComponent').asNumber();
    var getBmp;
    if (fname === '/DCTDecode') {
      if (csn === '/DeviceCMYK') return;
      getBmp = function () { return createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' })); };
    } else {
      if ((csn !== '/DeviceRGB' && csn !== '/DeviceGray') || bpc !== 8) return;
      getBmp = function () {
        var raw = L.decodePDFRawStream(obj).decode(), comps = csn === '/DeviceRGB' ? 3 : 1;
        if (raw.length !== w * h * comps) throw new Error('skip');
        var id = new ImageData(w, h), px = id.data;
        for (var i = 0, j = 0, n = w * h; i < n; i++) { if (comps === 3) { px[j++] = raw[i * 3]; px[j++] = raw[i * 3 + 1]; px[j++] = raw[i * 3 + 2]; } else { var v = raw[i]; px[j++] = v; px[j++] = v; px[j++] = v; } px[j++] = 255; }
        return createImageBitmap(id);
      };
    }
    stat.imgBefore += oldLen;
    return getBmp().then(function (bm) {
      var k = Math.min(1, lv.side / Math.max(bm.width, bm.height)), w2 = Math.max(1, Math.round(bm.width * k)), h2 = Math.max(1, Math.round(bm.height * k));
      var cv = document.createElement('canvas'); cv.width = w2; cv.height = h2; var c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, w2, h2); c2.imageSmoothingQuality = 'high'; c2.drawImage(bm, 0, 0, w2, h2); try { bm.close(); } catch (e) {}
      return canvasBlob(cv, 'image/jpeg', lv.q).then(function (nb) {
        cv.width = cv.height = 0;
        if (nb.length >= oldLen * 0.9) { stat.imgAfter += oldLen; return; }
        var nd = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: w2, Height: h2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', Length: nb.length });
        var sm = g('SMask'); if (sm) nd.set(N('SMask'), sm);
        doc.context.assign(ref, L.PDFRawStream.of(nd, nb)); stat.done++; stat.imgAfter += nb.length;
      });
    }, function () { stat.imgBefore -= oldLen; });
  }
  function compress(api, level) {
    var ctx = api.ctx, run = function () {
      ctx.busy('큰 그림을 줄이는 중…');
      api.getBytes().then(function (bytes) {
        return compressBytes(api, bytes, level, function (i, n) { ctx.busy('큰 그림을 줄이는 중… (' + i + '/' + n + ')'); }).then(function (r) { r.before = bytes.length; return r; });
      }).then(function (r) {
        return api.pdfjs.getDocument({ data: r.out.slice(), isEvalSupported: false }).promise.then(function (pd) { var n = pd.numPages; try { pd.destroy(); } catch (e) {} if (n !== api.pageCount()) throw new Error('쪽 수 점검 실패'); return r; });
      }).then(function (r) {
        ctx.busy(null); var s = r.stat, lv = LEVELS[level];
        if (r.out.length >= r.before * 0.97) { ctx.toast('더 줄일 곳이 거의 없습니다(' + kb(r.before) + ' → ' + kb(r.out.length) + '). 문서는 그대로입니다.', 4200); return; }
        var pct = Math.round((1 - r.out.length / r.before) * 100);
        ctx.confirm('용량을 ' + pct + '% 줄였습니다', kb(r.before) + ' → ' + kb(r.out.length) + '\n단계: ' + lv.name + '(긴 변 ' + lv.side + '픽셀 이하, JPEG 화질 ' + Math.round(lv.q * 100) + '%)\n줄인 그림 ' + s.done + '개 / 전체 큰 그림 ' + s.imgs + '개' + (s.qpdf ? '\n구조 압축도 함께 했습니다.' : '') + '\n\n이 결과를 문서에 적용할까요? 적용 뒤에도 ↶ 로 되돌릴 수 있습니다.', '적용', function () {
          ctx.busy('적용하는 중…'); api.applyBytes(r.out, '용량 줄이기').then(function () { ctx.busy(null); ctx.toast('적용했습니다. 저장은 「사본 저장」으로 하십시오.', 3200); }).catch(function (e) { ctx.busy(null); ctx.toast('적용하지 못했습니다 — ' + ((e && e.message) || e), 4200); });
        }, { cancelLabel: '적용 안 함' });
      }).catch(function (e) { ctx.busy(null); ctx.toast('용량을 줄이지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    };
    if (api.hasAnns()) { ctx.confirm('넣은 것이 있습니다', '넣은 형광펜·글·서명을 먼저 문서에 합친 뒤 줄입니다. 합친 뒤에도 「되돌리기」로 취소할 수 있습니다.', '합치고 줄이기', function () { ctx.busy('합치는 중…'); api.flattenAnns().then(function () { ctx.busy(null); run(); }, function (e) { ctx.busy(null); ctx.toast('합치지 못했습니다 — ' + ((e && e.message) || e), 3600); }); }, { cancelLabel: '취소' }); }
    else run();
  }

  // ======================================================================== 책갈피(목차) 보기
  function outlineSheet(api, goPage) {
    var ctx = api.ctx, pdf = api.pdfDoc();
    return pdf.getOutline().then(function (ol) {
      if (!ol || !ol.length) { ctx.toast('이 PDF에는 책갈피(목차)가 없습니다.', 2800); return; }
      var body = el('div', 'spd'), count = 0;
      function walk(items, depth) {
        items.forEach(function (it) {
          if (count > 600) return; count++;
          var b = el('button', 'spd-b big sp-ol', ''); b.type = 'button'; b.style.textAlign = 'left'; b.style.paddingLeft = (12 + depth * 18) + 'px'; b.textContent = (it.title || '(제목 없음)').trim() || '(제목 없음)';
          b.onclick = function () {
            resolvePage(pdf, it.dest).then(function (n) { if (n) { ctx.closeSheet(); setTimeout(function () { goPage(n); }, 80); } else ctx.toast('이 책갈피가 가리키는 쪽을 찾지 못했습니다.', 2800); });
          };
          body.appendChild(b);
          if (it.items && it.items.length) walk(it.items, depth + 1);
        });
      }
      walk(ol, 0);
      ctx.sheet({ title: '책갈피(목차)', body: body, buttons: [{ label: '닫기' }], wide: true });
    }).catch(function (e) { ctx.toast('책갈피를 읽지 못했습니다 — ' + ((e && e.message) || e), 3600); });
  }
  function resolvePage(pdf, dest) {
    var p = typeof dest === 'string' ? pdf.getDestination(dest) : Promise.resolve(dest);
    return p.then(function (d) { if (!d || !d[0]) return 0; var r = d[0]; if (typeof r === 'object') return pdf.getPageIndex(r).then(function (i) { return i + 1; }); if (typeof r === 'number') return r + 1; return 0; }).catch(function () { return 0; });
  }
  function hasOutline(pdf) { return pdf.getOutline().then(function (o) { return !!(o && o.length); }, function () { return false; }); }

  global.SOPdfTools = { extend: extend, redact: redact, openWithPassword: openWithPassword, outlineSheet: outlineSheet, hasOutline: hasOutline,
    _t: { compressBytes: compressBytes, encryptBytes: encryptBytes, decryptBytes: decryptBytes, gcDoc: gcDoc, qpdfRun: qpdfRun } };
})(window);

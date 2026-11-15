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

  // v10.9 5회차: 열 때 암호는 없지만 암호화된(권한이 걸린) PDF. 편집이 제한됐으면 소유자 암호를 물어 푼 사본으로 열고, 모르면 보기만 한다.
  // 돌려주는 것: { bytes: 푼 사본 | null, view: 보기만 하는지, restricted }
  function unlockOpen(ctx, buf, perms) {
    var bytes = new Uint8Array(buf), P = perms || [];
    var restricted = P.indexOf(8) < 0 || P.indexOf(32) < 0 || P.indexOf(1024) < 0;
    function plain() { return qpdfRun(ctx, function (i, o) { return ['--decrypt', i, o]; }, bytes).then(function (r) { return r.out || null; }); }
    if (!restricted) return plain().then(function (out) { return { bytes: out, view: !out, restricted: false }; });
    return new Promise(function (resolve) {
      var tries = 0, done = false;
      function ask(msg) {
        var body = el('div', 'spd'), inp = el('input', 'spd-in wide'); inp.type = 'password'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', '소유자 암호');
        var note = el('div', 'so-sheet-note', msg || '이 문서는 만든 사람이 고치기·쪽 정리·메모를 막아 두었습니다. 「소유자 암호」를 아시면 입력해 제한을 푼 사본으로 열 수 있습니다. 모르면 「보기만」을 누르십시오. 원래 파일은 바뀌지 않고, 입력한 암호는 저장되지 않습니다.');
        body.appendChild(note); body.appendChild(inp);
        ctx.sheet({ title: '편집이 제한된 PDF', body: body, buttons: [
          { label: '보기만', onClick: function () { if (!done) { done = true; resolve({ bytes: null, view: true, restricted: true }); } return true; } },
          { label: '제한 풀고 열기', primary: true, onClick: function () {
            var pw = inp.value; if (!pw) { note.textContent = '소유자 암호를 입력해 주십시오.'; return false; }
            inp.disabled = true; note.textContent = '확인하는 중…';
            decryptBytes(ctx, bytes, pw).then(function (out) { inp.value = ''; done = true; ctx.closeSheet(); resolve({ bytes: out, view: false, restricted: true }); }, function (e) {
              inp.value = ''; inp.disabled = false; tries++;
              if (e && e.wrong) { if (tries >= 5) { done = true; ctx.closeSheet(); ctx.toast('소유자 암호가 맞지 않아 보기만 합니다.', 3600); resolve({ bytes: null, view: true, restricted: true }); } else { note.textContent = '소유자 암호가 맞지 않습니다. 다시 입력해 주십시오(' + tries + '/5).'; try { inp.focus(); } catch (x) {} } }
              else { done = true; ctx.closeSheet(); ctx.toast('제한을 풀지 못해 보기만 합니다 — ' + ((e && e.message) || e), 4200); resolve({ bytes: null, view: true, restricted: true }); }
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
  // 쪽을 새로 그려 바꾼 뒤(쪽 크기 맞추기·영역 가리기) 책갈피·링크·이름 있는 도착지가 옛 쪽을 가리키지 않게 새 쪽으로 이어 준다.
  // map: { '옛 쪽 개체 번호': 새 쪽 PDFRef } — 고친 도착지 수를 돌려준다.
  function remapDests(L, doc, map) {
    var c = doc.context, N = L.PDFName.of, fixed = 0, seen = {};
    function lk(o) { return o instanceof L.PDFRef ? c.lookup(o) : o; }
    function fixArr(a) {
      a = lk(a); if (!(a instanceof L.PDFArray) || !a.size()) return;
      var f = a.get(0); if (f instanceof L.PDFRef) { var nr = map[f.toString()]; if (nr) { a.set(0, nr); fixed++; } }
    }
    function fixDest(d) { d = lk(d); if (d instanceof L.PDFArray) fixArr(d); else if (d instanceof L.PDFDict) { var dd = d.get(N('D')); if (dd) fixArr(dd); } }
    function fixHolder(h) {
      h = lk(h); if (!(h instanceof L.PDFDict)) return;
      var d = h.get(N('Dest')); if (d) fixDest(d);
      var a = lk(h.get(N('A')));
      if (a instanceof L.PDFDict) { var s = a.get(N('S')); if (s && String(s) === '/GoTo') { var dd = a.get(N('D')); if (dd) fixDest(dd); } }
    }
    try {
      var ol = lk(doc.catalog.get(N('Outlines')));
      if (ol instanceof L.PDFDict) {
        var stack = [ol.get(N('First'))];
        while (stack.length) {
          var r = stack.pop(); if (!r) continue; var key = r.toString(); if (seen[key]) continue; seen[key] = 1;
          var it = lk(r); if (!(it instanceof L.PDFDict)) continue;
          fixHolder(it); stack.push(it.get(N('First'))); stack.push(it.get(N('Next')));
        }
      }
    } catch (e) {}
    try { doc.getPages().forEach(function (pg) { var an = pg.node.Annots && pg.node.Annots(); if (!an) return; for (var i = 0; i < an.size(); i++) { var a = lk(an.get(i)); if (a instanceof L.PDFDict && String(a.get(N('Subtype'))) === '/Link') fixHolder(a); } }); } catch (e) {}
    try {
      var oa = doc.catalog.get(N('OpenAction')); if (oa) fixDest(oa);
      var dests = lk(doc.catalog.get(N('Dests'))); if (dests instanceof L.PDFDict) dests.entries().forEach(function (e) { fixDest(e[1]); });
      var nm = lk(doc.catalog.get(N('Names'))), nd = nm instanceof L.PDFDict ? lk(nm.get(N('Dests'))) : null;
      if (nd instanceof L.PDFDict) {
        var st2 = [nd], guard = 0;
        while (st2.length && guard++ < 5000) {
          var t = lk(st2.pop()); if (!(t instanceof L.PDFDict)) continue;
          var ks = lk(t.get(N('Kids'))); if (ks instanceof L.PDFArray) for (var k = 0; k < ks.size(); k++) st2.push(ks.get(k));
          var ns = lk(t.get(N('Names'))); if (ns instanceof L.PDFArray) for (var m = 1; m < ns.size(); m += 2) fixDest(ns.get(m));
        }
      }
    } catch (e) {}
    return fixed;
  }
  // 옛 쪽의 주석(링크·입력 칸·메모·표시 등)을 새 쪽으로 옮기고 위치를 f(x,y) 로 바꾼다. 팝업은 옮기지 않는다
  function moveAnnots(L, doc, oldPg, newPg, f) {
    var c = doc.context, N = L.PDFName.of, an = oldPg.node.Annots && oldPg.node.Annots(), out = [];
    if (!an) return 0;
    function nums(a) { var r = []; if (a instanceof L.PDFArray) for (var i = 0; i < a.size(); i++) { var v = c.lookup(a.get(i)); r.push(v && v.asNumber ? v.asNumber() : 0); } return r; }
    for (var i = 0; i < an.size(); i++) {
      var ref = an.get(i), a = c.lookup(ref); if (!(a instanceof L.PDFDict)) continue;
      var st = String(a.get(N('Subtype'))); if (st === '/Popup') continue;
      var rc = nums(c.lookup(a.get(N('Rect')))); if (rc.length !== 4) continue;
      var p1 = f(rc[0], rc[1]), p2 = f(rc[2], rc[3]);
      a.set(N('Rect'), c.obj([Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])]));
      var qp = a.get(N('QuadPoints')); if (qp) { var q = nums(c.lookup(qp)), nq = []; for (var k = 0; k + 1 < q.length; k += 2) { var pp = f(q[k], q[k + 1]); nq.push(pp[0], pp[1]); } a.set(N('QuadPoints'), c.obj(nq)); }
      try { a.delete(N('Popup')); } catch (e) {}
      if (a.has(N('P'))) a.set(N('P'), newPg.ref);
      out.push(ref);
    }
    if (out.length) newPg.node.set(N('Annots'), c.obj(out));
    return out.length;
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
      var L, doc, nums = Object.keys(rects).filter(function (k) { return rects[k].length; }).map(Number).sort(function (a, b) { return a - b; }), oldNodes = [], destMap = {}, seqP = Promise.resolve();
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
              destMap[old.ref.toString()] = np.ref;
              oldNodes.push(doc.getPage(n)); doc.removePage(n);
            });
          });
        });
        return seqP;
      }).then(function () {
        var Nm = L.PDFName.of, c = doc.context;
        remapDests(L, doc, destMap);      // 책갈피·링크가 새로 그린 쪽을 가리키게 이어 준다
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
    g3.appendChild(el('div', 'so-sheet-note', '쪽의 가로·세로 방향은 그대로 두고, 내용을 비율대로 키우거나 줄여 가운데에 놓습니다. 링크·입력 칸·주석과 책갈피(목차)는 새 쪽으로 옮겨 이어집니다.'));
    act(g3, '모든 쪽 크기 맞추기', function () {
      var SZ = { a4: [595.28, 841.89], a3: [841.89, 1190.55], b5: [498.9, 708.66], letter: [612, 792] }[st.fit] || [595.28, 841.89];
      var go = function () {
        H.run('쪽 크기 맞추기', function (L, doc) {
          var pages = doc.getPages(), embedP = [], destMap = {};
          pages.forEach(function (pg) { var cb = pg.getCropBox ? pg.getCropBox() : pg.getMediaBox(); embedP.push({ left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height }); });
          return Promise.all(pages.map(function (pg, i) { return doc.embedPage(pg, embedP[i]); })).then(function (eps) {
            var oldNodes = pages.slice();
            pages.forEach(function (pg, i) {
              var cb = embedP[i], cw = cb.right - cb.left, ch = cb.top - cb.bottom, rot = pageRot(pg), vs = visSize(rot, cw, ch), land = vs.w > vs.h;
              var Tw = land ? SZ[1] : SZ[0], Th = land ? SZ[0] : SZ[1], k = Math.min(Tw / vs.w, Th / vs.h);
              var nw = rot === 90 || rot === 270 ? Th : Tw, nh = rot === 90 || rot === 270 ? Tw : Th;
              var np = doc.insertPage(i, [nw, nh]); if (rot) np.setRotation(L.degrees(rot));
              var ox = (nw - cw * k) / 2, oy = (nh - ch * k) / 2;
              np.drawPage(eps[i], { x: ox, y: oy, xScale: k, yScale: k });
              destMap[pg.ref.toString()] = np.ref;
              moveAnnots(L, doc, pg, np, function (x, y) { return [ox + (x - cb.left) * k, oy + (y - cb.bottom) * k]; });     // 링크·입력 칸·주석을 새 쪽으로 옮긴다
            });
            for (var i = oldNodes.length - 1; i >= 0; i--) doc.removePage(oldNodes.length + i);
            remapDests(L, doc, destMap);            // 책갈피·링크 도착지를 새 쪽으로 이어 준다
            try { var Nm = L.PDFName.of; doc.catalog.delete(Nm('StructTreeRoot')); } catch (e) {}
            return doc.flush().then(function () { gcDoc(L, doc); return ''; });      // 끼워 넣은 쪽을 먼저 실제 개체로 만든 뒤에 안 쓰는 개체를 지운다(안 그러면 옛 쪽 내용이 먼저 지워져 오류)
          });
        }, '쪽 크기를 맞췄습니다.');
      };
      ctx.confirm('모든 쪽을 ' + st.fit.toUpperCase().replace('LETTER', 'Letter') + ' 크기로 맞출까요?', '내용은 비율대로 가운데에 놓입니다. 쪽 안의 링크·입력 칸·주석과 책갈피(목차)는 새 쪽으로 옮겨 이어집니다(일부 특수한 주석은 사라질 수 있습니다). 되돌리려면 ↶ 를 쓰십시오.', '맞추기', go, { cancelLabel: '취소' });
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
    // v10.9 5회차: 글 고치기·도형·첨부·정밀 보기·워드로 열기·편집 제한·글자 인식 안내(so-pdf-edit.js, 스위치 SO_PDF_EDIT)
    if (ctx.flag && ctx.flag('pdfedit')) {
      var slot = el('div'); body.appendChild(slot);
      ctx.loadScript('js/smartoffice/pdf/so-pdf-edit.js').then(function () { if (global.SOPdfEdit) global.SOPdfEdit.extend(api, H, slot, { qpdfOn: qpdfOn(ctx), pwInput: pwInput, qpdfRun: qpdfRun }); }).catch(function (e) { try { console.warn('[S-Office PDF] 고치기 구역', e); } catch (x) {} });
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
        ctx.confirm('용량을 ' + pct + '% 줄였습니다', kb(r.before) + ' → ' + kb(r.out.length) + '\n줄이는 정도: ' + lv.name + '\n줄인 그림 ' + s.done + '개 / 전체 큰 그림 ' + s.imgs + '개' + (s.qpdf ? '\n구조 압축도 함께 했습니다.' : '') + '\n\n이 결과를 문서에 적용할까요? 적용 뒤에도 ↶ 로 되돌릴 수 있습니다.', '적용', function () {
          ctx.busy('적용하는 중…'); api.applyBytes(r.out, '용량 줄이기').then(function () { ctx.busy(null); ctx.toast('적용했습니다. 저장은 「사본 저장」으로 하십시오.', 3200); }).catch(function (e) { ctx.busy(null); ctx.toast('적용하지 못했습니다 — ' + ((e && e.message) || e), 4200); });
        }, { cancelLabel: '적용 안 함' });
      }).catch(function (e) { ctx.busy(null); ctx.toast('용량을 줄이지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    };
    if (api.hasAnns()) { ctx.confirm('넣은 것이 있습니다', '넣은 형광펜·글·서명을 먼저 문서에 합친 뒤 줄입니다. 합친 뒤에도 「되돌리기」로 취소할 수 있습니다.', '합치고 줄이기', function () { ctx.busy('합치는 중…'); api.flattenAnns().then(function () { ctx.busy(null); run(); }, function (e) { ctx.busy(null); ctx.toast('합치지 못했습니다 — ' + ((e && e.message) || e), 3600); }); }, { cancelLabel: '취소' }); }
    else run();
  }

  // ======================================================================== 책갈피(목차) 보기 · 만들기 · 이름 바꾸기 · 지우기
  // pdf.js 가 읽은 목차를 { title, page, items } 나무로 바꾼다(쪽 번호를 못 찾으면 page=0 → 끊긴 책갈피)
  function readTree(pdf, ol) {
    var count = 0;
    function conv(items) {
      return Promise.all(items.map(function (it) {
        if (count++ > 600) return Promise.resolve(null);
        return resolvePage(pdf, it.dest).then(function (n) {
          return (it.items && it.items.length ? conv(it.items) : Promise.resolve([])).then(function (kids) { return { title: (it.title || '').trim() || '(제목 없음)', page: n, items: kids.filter(Boolean) }; });
        });
      }));
    }
    return conv(ol || []).then(function (a) { return a.filter(Boolean); });
  }
  // 나무를 새 목차로 써 넣는다(옛 목차는 지우고 같은 모양으로 다시 만든다 — 글자색·굵기 같은 꾸밈은 기본으로 돌아간다)
  function writeOutline(L, doc, tree) {
    var c = doc.context, N = L.PDFName.of, pages = doc.getPages();
    try { doc.catalog.delete(N('Outlines')); } catch (e) {}
    if (!tree.length) return;
    var rootRef = c.nextRef();
    function total(nodes) { var t = 0; nodes.forEach(function (n) { t += 1 + total(n.items || []); }); return t; }
    function build(nodes, parentRef) {
      var refs = nodes.map(function () { return c.nextRef(); });
      nodes.forEach(function (n, i) {
        var pg = pages[Math.max(0, Math.min(pages.length - 1, (n.page || 1) - 1))];
        var d = c.obj({ Parent: parentRef });
        d.set(N('Title'), L.PDFHexString.fromText(n.title));
        d.set(N('Dest'), c.obj([pg.ref, 'Fit']));
        if (i > 0) d.set(N('Prev'), refs[i - 1]);
        if (i < nodes.length - 1) d.set(N('Next'), refs[i + 1]);
        if (n.items && n.items.length) { var kr = build(n.items, refs[i]); d.set(N('First'), kr[0]); d.set(N('Last'), kr[kr.length - 1]); d.set(N('Count'), c.obj(total(n.items))); }
        c.assign(refs[i], d);
      });
      return refs;
    }
    var top = build(tree, rootRef), root = c.obj({ Type: 'Outlines' });
    root.set(N('First'), top[0]); root.set(N('Last'), top[top.length - 1]); root.set(N('Count'), c.obj(total(tree)));
    c.assign(rootRef, root); doc.catalog.set(N('Outlines'), rootRef);
  }
  function editOutline(api, goPage, label, mut, okMsg) {
    var ctx = api.ctx;
    var go = function () {
      ctx.busy(label + ' 중…'); var L, doc;
      return api.pdfDoc().getOutline().then(function (ol) { return readTree(api.pdfDoc(), ol); }).then(function (tree) {
        return api.loadLib().then(function (l) { L = l; return api.getBytes(); }).then(function (b) { return L.PDFDocument.load(b, { updateMetadata: false }); }).then(function (d) {
          doc = d; var err = mut(tree); if (err) throw new Error(err); writeOutline(L, doc, tree); return doc.save();
        });
      }).then(function (out) {
        return api.pdfjs.getDocument({ data: out.slice(), isEvalSupported: false }).promise.then(function (pd) { var n = pd.numPages; try { pd.destroy(); } catch (e) {} if (n !== doc.getPageCount()) throw new Error('쪽 수 점검 실패'); return api.applyBytes(out, label); });
      }).then(function () { ctx.busy(null); ctx.toast(okMsg + ' (되돌리려면 ↶)', 3200); setTimeout(function () { outlineSheet(api, goPage); }, 250); })
        .catch(function (e) { ctx.busy(null); ctx.toast('하지 못했습니다 — ' + ((e && e.message) || e) + ' 문서는 그대로입니다.', 5200); });
    };
    if (api.hasAnns && api.hasAnns()) ctx.confirm('넣은 것이 있습니다', '넣은 형광펜·글·서명을 먼저 문서에 합친 뒤 책갈피를 고칩니다. 합친 뒤에도 「되돌리기」로 취소할 수 있습니다.', '합치고 고치기', function () { ctx.busy('합치는 중…'); api.flattenAnns().then(function () { ctx.busy(null); go(); }, function (e) { ctx.busy(null); ctx.toast('합치지 못했습니다 — ' + ((e && e.message) || e), 4200); }); }, { cancelLabel: '취소' });
    else go();
  }
  function nodeAt(tree, path) { var n = null, list = tree; for (var i = 0; i < path.length; i++) { n = list[path[i]]; if (!n) return null; list = n.items || []; } return n; }
  function outlineSheet(api, goPage) {
    var ctx = api.ctx, pdf = api.pdfDoc(), canEdit = !!(api.loadLib && api.applyBytes);
    return pdf.getOutline().then(function (ol) { return readTree(pdf, ol); }).then(function (tree) {
      var body = el('div', 'spd'), nm = el('input', 'spd-in wide'), cur = api.curPage ? api.curPage() : 1;
      if (canEdit) {
        nm.type = 'text'; nm.maxLength = 120; nm.placeholder = '책갈피 이름'; nm.setAttribute('aria-label', '책갈피 이름'); nm.value = '';
        body.appendChild(nm);
        var add = el('button', 'spd-b big', cur + '쪽에 책갈피 추가'); add.type = 'button';
        add.onclick = function () { var t = nm.value.trim() || (cur + '쪽'); ctx.closeSheet(); setTimeout(function () { editOutline(api, goPage, '책갈피 추가', function (tr) { tr.push({ title: t, page: cur, items: [] }); }, '책갈피를 추가했습니다.'); }, 60); };
        body.appendChild(add);
      }
      var count = 0;
      if (!tree.length) body.appendChild(el('div', 'so-sheet-note', '이 PDF에는 책갈피(목차)가 없습니다.' + (canEdit ? ' 위에 이름을 쓰고 「책갈피 추가」를 누르면 지금 보는 쪽에 만듭니다.' : '')));
      function walk(items, depth, path) {
        items.forEach(function (it, idx) {
          if (count > 600) return; count++;
          var row = el('div', 'spd-r'), my = path.concat(idx);
          var b = el('button', 'spd-b big sp-ol' + (it.page ? '' : ' off'), ''); b.type = 'button'; b.style.textAlign = 'left'; b.style.flex = '1'; b.style.paddingLeft = (12 + depth * 18) + 'px';
          b.textContent = it.title + (it.page ? '  · ' + it.page + '쪽' : '  · (끊김)');
          b.onclick = function () { if (it.page) { ctx.closeSheet(); setTimeout(function () { goPage(it.page); }, 80); } else ctx.toast('이 책갈피가 가리키는 쪽을 찾지 못했습니다.', 2800); };
          row.appendChild(b);
          if (canEdit) {
            var rn = el('button', 'spd-b', '이름'); rn.type = 'button'; rn.setAttribute('aria-label', '책갈피 이름 바꾸기');
            rn.onclick = function () { var t = nm.value.trim(); if (!t) { ctx.toast('위 칸에 새 이름을 쓴 뒤 「이름」을 누르십시오.', 2800); return; } ctx.closeSheet(); setTimeout(function () { editOutline(api, goPage, '책갈피 이름', function (tr) { var n = nodeAt(tr, my); if (!n) return '책갈피를 찾지 못했습니다'; n.title = t; }, '책갈피 이름을 바꿨습니다.'); }, 60); };
            var mv = el('button', 'spd-b', cur + '쪽으로'); mv.type = 'button'; mv.setAttribute('aria-label', '이 책갈피를 지금 쪽으로');
            mv.onclick = function () { ctx.closeSheet(); setTimeout(function () { editOutline(api, goPage, '책갈피 쪽 바꾸기', function (tr) { var n = nodeAt(tr, my); if (!n) return '책갈피를 찾지 못했습니다'; n.page = cur; }, '책갈피가 ' + cur + '쪽을 가리킵니다.'); }, 60); };
            var rm = el('button', 'spd-b', '지우기'); rm.type = 'button'; rm.setAttribute('aria-label', '책갈피 지우기');
            rm.onclick = function () { ctx.closeSheet(); setTimeout(function () { editOutline(api, goPage, '책갈피 지우기', function (tr) { var par = my.length > 1 ? nodeAt(tr, my.slice(0, -1)).items : tr; par.splice(my[my.length - 1], 1); }, '책갈피를 지웠습니다(딸린 하위 책갈피도 함께 지워집니다).'); }, 60); };
            row.appendChild(rn); row.appendChild(mv); row.appendChild(rm);
          }
          body.appendChild(row);
          if (it.items && it.items.length) walk(it.items, depth + 1, my);
        });
      }
      walk(tree, 0, []);
      if (canEdit) body.appendChild(el('div', 'so-sheet-note', '책갈피를 고치면 목차를 같은 모양으로 다시 만들어 넣으며, 글자색 같은 꾸밈은 기본으로 돌아갑니다. 이름을 바꾸려면 위 칸에 새 이름을 쓰고 그 줄의 「이름」을 누르십시오. 저장은 「사본 저장」으로 합니다.'));
      ctx.sheet({ title: '책갈피(목차)', body: body, buttons: [{ label: '닫기' }], wide: true });
    }).catch(function (e) { ctx.toast('책갈피를 읽지 못했습니다 — ' + ((e && e.message) || e), 3600); });
  }

  // ======================================================================== 글 뽑기 → 마크다운
  function pdfToMarkdown(pdf, onProgress) {
    var n = pdf.numPages, pagesLines = [], sizes = {}, chain = Promise.resolve();
    for (var i = 1; i <= n; i++) (function (i) {
      chain = chain.then(function () {
        if (onProgress) onProgress(i, n);
        return pdf.getPage(i).then(function (pg) { return pg.getTextContent().then(function (tc) {
          var rows = [];
          tc.items.forEach(function (it) {
            var t = String(it.str || ''); if (!t.trim()) return;
            var h = Math.abs(it.transform[3]) || it.height || 10, y = it.transform[5], x = it.transform[4], row = null;
            for (var k = rows.length - 1; k >= 0 && k >= rows.length - 4; k--) if (Math.abs(rows[k].y - y) < h * 0.45) { row = rows[k]; break; }
            if (!row) { row = { y: y, x: x, h: h, parts: [] }; rows.push(row); }
            row.parts.push({ x: x, s: t, w: it.width || 0 }); if (h > row.h) row.h = h;
            var key = Math.round(h * 2) / 2; sizes[key] = (sizes[key] || 0) + t.length;
          });
          rows.sort(function (a, b) { return b.y - a.y; });
          pagesLines.push(rows.map(function (r) {
            r.parts.sort(function (a, b) { return a.x - b.x; });
            var txt = '', end = null;
            r.parts.forEach(function (p) { if (end != null && p.x - end > r.h * 0.25 && !/\s$/.test(txt) && !/^\s/.test(p.s)) txt += ' '; txt += p.s; end = p.x + p.w; });
            return { t: txt.replace(/\s+/g, ' ').trim(), y: r.y, h: r.h, x: r.parts[0].x };
          }).filter(function (r) { return r.t; }));
          try { pg.cleanup(); } catch (e) {}
        }); });
      });
    })(i);
    return chain.then(function () {
      var body = 12, best = 0; Object.keys(sizes).forEach(function (k) { if (sizes[k] > best) { best = sizes[k]; body = +k; } });
      var out = [], chars = 0, bulletRe = /^[•·○●▪■◦\-–—]\s+/;
      pagesLines.forEach(function (lines, pi) {
        var par = [], prev = null, inList = false;
        function flush() { if (par.length) { out.push(par.join(' ')); par = []; } }
        lines.forEach(function (ln) {
          var ratio = ln.h / body, head = ratio >= 1.25 && ln.t.length <= 90, bullet = bulletRe.test(ln.t), num = /^\d{1,2}[.)]\s+\S/.test(ln.t);
          var gap = prev ? (prev.y - ln.y) : 0;
          if (!bullet) inList = false;
          if (head) { flush(); out.push((ratio >= 1.7 ? '# ' : ratio >= 1.4 ? '## ' : '### ') + ln.t); }
          else if (bullet) { flush(); var li = '- ' + ln.t.replace(bulletRe, ''); if (inList && out.length) out[out.length - 1] += '\n' + li; else out.push(li); inList = true; prev = ln; chars += ln.t.length; return; }
          else if (num) { flush(); par.push(ln.t); }
          else { if (prev && gap > body * 2.2) flush(); par.push(ln.t); }
          prev = ln; chars += ln.t.length;
        });
        flush(); if (pi < n - 1) out.push('---');
      });
      var md = out.join('\n\n');
      return { md: md, chars: chars, pages: n };
    });
  }
  function exportMarkdown(api, baseName) {
    var ctx = api.ctx;
    ctx.confirm('글을 마크다운으로 뽑을까요?', 'PDF 속의 글자를 뽑아 제목·문단·목록 모양으로 정리한 .md 사본을 만듭니다(원본 PDF는 바뀌지 않습니다).\n\n· 글자가 들어 있는 PDF만 됩니다. 스캔한 그림 PDF는 글을 뽑을 수 없습니다.\n· 제목은 글자 크기로 짐작하므로 틀릴 수 있고, 표·그림은 담기지 않습니다.', '뽑아서 저장', function () {
      ctx.busy('글을 뽑는 중…');
      pdfToMarkdown(api.pdfDoc(), function (i, n) { ctx.busy('글을 뽑는 중… (' + i + '/' + n + ')'); }).then(function (r) {
        ctx.busy(null);
        if (r.chars < 5) { ctx.toast('뽑을 글이 거의 없습니다. 스캔한 그림 PDF는 글을 뽑을 수 없습니다.', 4200); return; }
        return Promise.resolve(ctx.saveCopy(new Blob([r.md + '\n'], { type: 'text/markdown' }), String(baseName || 'document').replace(/\.pdf$/i, '') + '.md', { exact: true })).then(function (ok) { if (ok !== false) ctx.toast('마크다운 사본을 저장했습니다(' + r.pages + '쪽, 글자 ' + r.chars + '자). 파일 열기에서 열어 볼 수 있습니다.', 4200); });
      }).catch(function (e) { ctx.busy(null); ctx.toast('글을 뽑지 못했습니다 — ' + ((e && e.message) || e), 4200); });
    }, { cancelLabel: '취소' });
  }
  function resolvePage(pdf, dest) {
    var p = typeof dest === 'string' ? pdf.getDestination(dest) : Promise.resolve(dest);
    return p.then(function (d) { if (!d || !d[0]) return 0; var r = d[0]; if (typeof r === 'object') return pdf.getPageIndex(r).then(function (i) { return i + 1; }); if (typeof r === 'number') return r + 1; return 0; }).catch(function () { return 0; });
  }
  function hasOutline(pdf) { return pdf.getOutline().then(function (o) { return !!(o && o.length); }, function () { return false; }); }

  global.SOPdfTools = { unlockOpen: unlockOpen, extend: extend, redact: redact, openWithPassword: openWithPassword, outlineSheet: outlineSheet, exportMarkdown: exportMarkdown, hasOutline: hasOutline,
    _t: { pdfToMarkdown: pdfToMarkdown, writeOutline: writeOutline, readTree: readTree, remapDests: remapDests, compressBytes: compressBytes, encryptBytes: encryptBytes, decryptBytes: decryptBytes, gcDoc: gcDoc, qpdfRun: qpdfRun } };
})(window);

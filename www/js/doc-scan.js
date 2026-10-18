/* doc-scan.js — 문서 스캔(사진 → PDF) 자립형 모듈. window.DocScan 하나만 노출한다.
 * 순수 기능: buildPdf / shrink / 쪽 저장소(IndexedDB docscan_tmp). 화면: open().
 * 스위치(켜고 끄기)는 이 파일에 없다 — 2단계에서 app.js 가 결정한다. */
(function (global) {
  'use strict';
  var DSC_KEEP_DAYS = 3, DSC_MAX_PAGES = 100, DSC_SLOW_PAGES = 40;
  var DSC_DB = 'docscan_tmp';

  /* ───────── A. 최소 PDF 작성기 ─────────
   * 메모리 방침: 쪽 JPEG Blob 은 읽지 않고 «참조»만 new Blob([...]) 조각으로 넣는다(브라우저가 디스크/내부 저장소에서 합친다).
   * 읽는 것은 SOF 마커를 찾는 앞부분(256KB 이하, 쪽마다 하나씩 읽고 바로 버림)뿐이다. 그래서 100쪽이어도 JS 힙에 쪽 전체가 올라오지 않는다. */
  var enc = new TextEncoder();
  function u8(s) { return enc.encode(s); }

  function sofInfo(buf) {                       // → {comps, w, h} | null
    var d = new Uint8Array(buf), i = 2, n = d.length;
    if (n < 4 || d[0] !== 0xFF || d[1] !== 0xD8) return { err: 'notjpeg' };
    while (i + 4 < n) {
      if (d[i] !== 0xFF) { i++; continue; }
      var m = d[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      var len = (d[i + 2] << 8) | d[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        if (i + 10 > n) return null;
        return { comps: d[i + 9], h: (d[i + 5] << 8) | d[i + 6], w: (d[i + 7] << 8) | d[i + 8] };
      }
      i += 2 + len;
    }
    return null;
  }
  function readSof(blob) {
    return blob.slice(0, 262144).arrayBuffer().then(function (b) {
      var r = sofInfo(b);
      if (r && !r.err) return r;
      if (r && r.err) throw new Error('JPEG 사진이 아닌 쪽이 있습니다.');
      if (blob.size <= 262144) throw new Error('사진 정보를 읽지 못했습니다.');
      return blob.arrayBuffer().then(function (all) {
        var r2 = sofInfo(all);
        if (!r2 || r2.err) throw new Error('사진 정보를 읽지 못했습니다.');
        return r2;
      });
    });
  }
  function num(x) { return String(Math.round(x * 100) / 100); }

  function buildPdf(pages, onProgress) {
    var parts = [], offsets = [], pos = 0, N = pages.length;
    function push(p, size) { parts.push(p); pos += size; }
    function pushStr(s) { var b = u8(s); push(b, b.length); }
    function beginObj(n) { offsets[n] = pos; pushStr(n + ' 0 obj\n'); }
    if (!N) return Promise.reject(new Error('만들 쪽이 없습니다.'));
    pushStr('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]), 6);
    var kids = [];
    for (var k = 0; k < N; k++) kids.push((3 + k * 3) + ' 0 R');
    beginObj(1); pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    beginObj(2); pushStr('<< /Type /Pages /Count ' + N + ' /Kids [' + kids.join(' ') + '] >>\nendobj\n');
    var chain = Promise.resolve();
    pages.forEach(function (pg, idx) {
      chain = chain.then(function () {
        return readSof(pg.blob).then(function (sof) {
          var W = 595, w = pg.w || sof.w, h = pg.h || sof.h, H = W * h / w;
          var pn = 3 + idx * 3, cn = pn + 1, inn = pn + 2;
          var cs = sof.comps === 1 ? '/DeviceGray' : '/DeviceRGB';
          var content = 'q ' + W + ' 0 0 ' + num(H) + ' 0 0 cm /Im0 Do Q';
          beginObj(pn);
          pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + num(H) + '] /Resources << /XObject << /Im0 ' + inn + ' 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ' + cn + ' 0 R >>\nendobj\n');
          beginObj(cn);
          pushStr('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
          beginObj(inn);
          pushStr('<< /Type /XObject /Subtype /Image /Width ' + sof.w + ' /Height ' + sof.h + ' /ColorSpace ' + cs +
            ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.blob.size + ' >>\nstream\n');
          push(pg.blob, pg.blob.size);               // 참조만(재압축·복사 없음)
          pushStr('\nendstream\nendobj\n');
          if (onProgress) { try { onProgress(idx + 1, N); } catch (e) {} }
          return new Promise(function (r) { setTimeout(r, 0); });
        });
      });
    });
    return chain.then(function () {
      var total = 3 * N + 3, xpos = pos, x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
      for (var i = 1; i < total; i++) x += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
      x += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xpos + '\n%%EOF\n';
      pushStr(x);
      return new Blob(parts, { type: 'application/pdf' });
    });
  }

  /* ───────── B. 이미지 줄이기·세우기 ───────── */
  var BAD = '사진을 읽지 못했습니다. 사진 파일(JPG·PNG 등)인지 확인해 주세요.';
  function loadSource(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (b) {
        return { src: b, w: b.width, h: b.height, free: function () { try { b.close(); } catch (e) {} } };
      }, viaImg);
    }
    return viaImg();
    function viaImg() {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), im = new Image();
        im.onload = function () {                  // <img> 는 EXIF 회전을 브라우저가 반영한다(현행 Chrome/WebView)
          res({ src: im, w: im.naturalWidth, h: im.naturalHeight, free: function () { try { URL.revokeObjectURL(url); } catch (e) {} im.src = ''; } });
        };
        im.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} rej(new Error(BAD)); };
        im.src = url;
      });
    }
  }
  function canvasToJpeg(cv, q) {
    return new Promise(function (res, rej) {
      function viaUrl() {
        try {
          var s = atob(cv.toDataURL('image/jpeg', q).split(',')[1]), a = new Uint8Array(s.length);
          for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
          res(new Blob([a], { type: 'image/jpeg' }));
        } catch (e) { rej(new Error(BAD)); }
      }
      if (cv.toBlob) cv.toBlob(function (b) { b ? res(b) : viaUrl(); }, 'image/jpeg', q); else viaUrl();
    });
  }
  function draw(srcObj, dw, dh, rot, q) {         // rot: 0/90/180/270 시계방향. dw,dh = 결과 크기
    var cv = document.createElement('canvas'), swap = rot === 90 || rot === 270;
    cv.width = dw; cv.height = dh;
    var c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, dw, dh);   // 투명 PNG → 흰 바탕
    c.imageSmoothingQuality = 'high';
    c.translate(dw / 2, dh / 2); c.rotate(rot * Math.PI / 180);
    var iw = swap ? dh : dw, ih = swap ? dw : dh;
    c.drawImage(srcObj.src, -iw / 2, -ih / 2, iw, ih);
    return canvasToJpeg(cv, q).then(function (b) { cv.width = 0; return b; }, function (e) { cv.width = 0; throw e; });
  }
  function shrink(file, o) {
    o = o || {};
    var L = o.longSide || 2000, q = o.quality || 0.80, rot = (((o.rotate || 0) % 360) + 360) % 360;
    return loadSource(file).then(function (s) {
      var sc = Math.min(1, L / Math.max(s.w, s.h)), w = Math.max(1, Math.round(s.w * sc)), h = Math.max(1, Math.round(s.h * sc));
      return draw(s, w, h, 0, q).then(function (b) { s.free(); return { blob: b, w: w, h: h }; }, function (e) { s.free(); throw new Error(BAD); });
    }, function () { throw new Error(BAD); }).then(function (r) {
      if (!rot) return r;
      return loadSource(r.blob).then(function (s) {
        var sw = rot === 90 || rot === 270, dw = sw ? r.h : r.w, dh = sw ? r.w : r.h;
        return draw(s, dw, dh, rot, q).then(function (b) { s.free(); return { blob: b, w: dw, h: dh }; }, function (e) { s.free(); throw e; });
      });
    });
  }

  /* ───────── C. 쪽 임시 보관 (IndexedDB docscan_tmp) ─────────
   * pages 저장소: 쪽 하나 = 레코드 하나({id, blob, w, h}). meta 저장소: 'session' = {order:[id], created, modified, kind}. */
  var db = null, dbTried = false, mem = null, usingMem = false, lastRemoved = null;
  function memInit() { if (!mem) mem = { pages: {}, meta: null, seq: 1 }; usingMem = true; }
  function openDb() {
    if (db) return Promise.resolve(db);
    if (dbTried) return Promise.resolve(null);
    dbTried = true;
    return new Promise(function (res) {
      var req;
      try { req = global.indexedDB.open(DSC_DB, 1); } catch (e) { return res(null); }
      req.onupgradeneeded = function () {
        var d = req.result;
        d.createObjectStore('pages', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('meta');
      };
      req.onsuccess = function () { db = req.result; res(db); };
      req.onerror = req.onblocked = function () { res(null); };
      setTimeout(function () { res(db); }, 4000);
    }).then(function (d) {
      if (!d) return null;
      // 시험 쓰기(시크릿 등에서 열려도 쓰기가 막히는 경우 대비)
      return new Promise(function (res) {
        try {
          var t = d.transaction('meta', 'readwrite'); t.objectStore('meta').put(1, 'probe');
          t.oncomplete = function () { res(d); }; t.onerror = t.onabort = function () { db = null; res(null); };
        } catch (e) { db = null; res(null); }
      });
    }).then(function (d) { if (!d) memInit(); return d; });
  }
  function tx(store, mode, fn) {                   // fn(objectStore) → IDBRequest ; 값 반환
    return openDb().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), r = fn(t.objectStore(store)), out;
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error || new Error('저장 실패')); };
      });
    });
  }
  function getMeta() {
    return openDb().then(function (d) { return d ? tx('meta', 'readonly', function (s) { return s.get('session'); }) : mem.meta; });
  }
  function putMeta(m) {
    m.modified = Date.now();
    return openDb().then(function (d) { if (!d) { mem.meta = m; return; } return tx('meta', 'readwrite', function (s) { return s.put(m, 'session'); }); });
  }
  function getPage(id) {
    return openDb().then(function (d) { return d ? tx('pages', 'readonly', function (s) { return s.get(id); }) : mem.pages[id]; });
  }
  function putPage(rec) {                           // rec.id 없으면 새 id
    return openDb().then(function (d) {
      if (!d) { if (rec.id == null) rec.id = mem.seq++; mem.pages[rec.id] = rec; return rec.id; }
      return tx('pages', 'readwrite', function (s) { return s.put(rec); });
    });
  }
  function delPage(id) {
    return openDb().then(function (d) { if (!d) { delete mem.pages[id]; return; } return tx('pages', 'readwrite', function (s) { return s.delete(id); }); });
  }
  function allPageKeys() {
    return openDb().then(function (d) { return d ? tx('pages', 'readonly', function (s) { return s.getAllKeys(); }) : Object.keys(mem.pages).map(Number); });
  }
  function clearAll() {
    lastRemoved = null;
    return openDb().then(function (d) {
      if (!d) { mem.pages = {}; mem.meta = null; return; }
      return tx('pages', 'readwrite', function (s) { return s.clear(); }).then(function () {
        return tx('meta', 'readwrite', function (s) { return s.delete('session'); });
      });
    });
  }

  var store = {
    usingMemory: function () { return openDb().then(function () { return usingMem; }); },
    /* 열 때 검사: 3일 지난 세션은 지운다. → {pages:[{id,w,h}], created, modified, kind, expired} */
    listSession: function () {
      return getMeta().then(function (m) {
        if (!m) return { pages: [], created: 0, modified: 0, kind: '' };
        if (Date.now() - m.modified > DSC_KEEP_DAYS * 86400000) {
          return clearAll().then(function () { return { pages: [], created: 0, modified: 0, kind: '', expired: true }; });
        }
        var out = [];
        return m.order.reduce(function (p, id) {
          return p.then(function () { return getPage(id).then(function (r) { if (r) out.push({ id: id, w: r.w, h: r.h, size: r.blob.size }); }); });
        }, Promise.resolve()).then(function () {
          return allPageKeys().then(function (keys) {     // 목록에 없는 쪽(되돌리기 대기 중 닫힘 등)은 정리
            var held = lastRemoved ? lastRemoved.id : -1;
            return keys.filter(function (k) { return m.order.indexOf(k) < 0 && k !== held; }).reduce(function (p, k) { return p.then(function () { return delPage(k); }); }, Promise.resolve());
          });
        }).then(function () { return { pages: out, created: m.created, modified: m.modified, kind: m.kind }; });
      });
    },
    addPage: function (pg, kind) {                    // pg={blob,w,h} → Promise<id>
      return getMeta().then(function (m) {
        m = m || { order: [], created: Date.now(), kind: kind || '' };
        if (m.order.length >= DSC_MAX_PAGES) throw new Error('최대 ' + DSC_MAX_PAGES + '쪽까지 담을 수 있습니다.');
        return putPage({ blob: pg.blob, w: pg.w, h: pg.h }).then(function (id) { m.order.push(id); return putMeta(m).then(function () { return id; }); });
      });
    },
    movePage: function (id, d) {
      return getMeta().then(function (m) {
        var i = m.order.indexOf(id), j = i + d;
        if (i < 0 || j < 0 || j >= m.order.length) return false;
        m.order.splice(i, 1); m.order.splice(j, 0, id);
        return putMeta(m).then(function () { return true; });
      });
    },
    /* 빼도 DB 레코드는 남겨 두고 메모리에 «방금 뺀 쪽»만 기억 → restoreRemoved() 로 되돌림. 다음 쪽을 빼면 앞의 것은 확정 삭제. */
    removePage: function (id) {
      var prev = lastRemoved;
      return getMeta().then(function (m) {
        var i = m.order.indexOf(id); if (i < 0) return null;
        m.order.splice(i, 1); lastRemoved = { id: id, index: i };
        return putMeta(m).then(function () { return prev ? delPage(prev.id) : null; }).then(function () { return lastRemoved; });
      });
    },
    hasRemoved: function () { return !!lastRemoved; },
    commitRemoved: function () { var r = lastRemoved; lastRemoved = null; return r ? delPage(r.id) : Promise.resolve(); },
    restoreRemoved: function () {
      var r = lastRemoved; if (!r) return Promise.resolve(false);
      return getMeta().then(function (m) {
        m.order.splice(Math.min(r.index, m.order.length), 0, r.id); lastRemoved = null;
        return putMeta(m).then(function () { return true; });
      });
    },
    getPageBlob: function (id) { return getPage(id).then(function (r) { return r ? r.blob : null; }); },
    replacePage: function (id, pg) {                  // 다시 찍기: pg={blob,w,h}
      return putPage({ id: id, blob: pg.blob, w: pg.w, h: pg.h }).then(function () { return getMeta().then(putMeta); });
    },
    rotatePage: function (id) {                       // 시계방향 90°
      return getPage(id).then(function (r) {
        return shrink(r.blob, { longSide: 100000, quality: 0.85, rotate: 90 }).then(function (n) { return store.replacePage(id, n); });
      });
    },
    clearSession: clearAll
  };

  /* ───────── E. 쪽 공급 (문서 스캐너 SDK 로 바꿀 때 «이 함수만» 바꾼다) ─────────
   * pageSource(kind) → Promise<File[]> ; kind: 'camera'(한 장씩 폰 기본 카메라) | 'gallery'(여러 장, 고른 순서).
   * 취소하면 빈 배열. SDK 로 바꾸면 여기서 스캔 결과 이미지(Blob/File)들을 돌려주면 된다.
   * 참고: 기존 SmartNativePick 은 채팅 첨부 훅(chatCam 등)으로만 결과를 돌려줘 여기서는 쓸 수 없다 → 파일 입력 사용. */
  function pageSource(kind) {
    return new Promise(function (res) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.className = 'dsc-hidden-input';
      if (kind === 'camera') inp.setAttribute('capture', 'environment'); else inp.multiple = true;
      inp.setAttribute('data-dsc-input', kind);
      inp.addEventListener('change', function () { var a = Array.prototype.slice.call(inp.files || []); inp.remove(); res(a); });
      inp.addEventListener('cancel', function () { inp.remove(); res([]); });
      (document.getElementById('dsc-root') || document.body).appendChild(inp);
      inp.click();
    });
  }

  /* ───────── D. 화면 ───────── */
  var CSS = [
    '.dsc-root{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;background:var(--page-bg,#EEF1FA);color:var(--text,#0F172A);font-family:"Pretendard",-apple-system,"Segoe UI","Malgun Gothic","맑은 고딕",sans-serif;font-size:17px;line-height:1.45}',
    '.dsc-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
    '.dsc-hidden-input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}',
    '.dsc-top{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;border-bottom:1px solid var(--glass-b2,#cbd2e6);background:var(--bg1,#fff)}',
    '.dsc-top b{flex:1;font-size:19px;font-weight:800}',
    '.dsc-body{flex:1;overflow:auto;padding:16px 14px 24px;-webkit-overflow-scrolling:touch}',
    '.dsc-col{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px}',
    '.dsc-btn{min-height:48px;min-width:48px;padding:10px 16px;border-radius:14px;border:1.5px solid var(--glass-b2,#b9c2dc);background:var(--bg1,#fff);color:var(--text,#0F172A);font:inherit;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
    '.dsc-btn:active{filter:brightness(.92)}',
    '.dsc-btn[disabled]{opacity:.45;cursor:default}',
    '.dsc-pri{background:linear-gradient(135deg,var(--p1,#3B82F6),var(--p2,#8B5CF6));color:#fff;border-color:transparent}',
    '.dsc-big{min-height:64px;font-size:19px;width:100%}',
    '.dsc-card{background:var(--bg1,#fff);border:1px solid var(--glass-b2,#cbd2e6);border-radius:16px;padding:14px}',
    '.dsc-sub{color:var(--muted,#55627D);font-size:15px}',
    '.dsc-warn{color:var(--warn-t,#B45309);font-size:15px;font-weight:600}',
    '.dsc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.dsc-item{display:flex;flex-direction:column;gap:8px}',
    '.dsc-item-h{display:flex;gap:12px;align-items:center}',
    '.dsc-thumb{width:64px;height:64px;border-radius:8px;object-fit:cover;background:var(--glass2,#ddd);flex:none;border:1px solid var(--glass-b2,#bbb)}',
    '.dsc-thumb-ph{display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:var(--muted,#55627D);background:#d4d8e0}',
    '.dsc-rec{flex:none;padding:6px 14px;background:#fee2e2;color:#b91c1c;font-size:15px;font-weight:700;text-align:center;white-space:nowrap;pointer-events:none}',
    '.dsc-num{font-weight:800;font-size:18px}',
    '.dsc-tools .dsc-btn{flex:1 1 auto;padding:8px 10px;font-size:15px}',
    '.dsc-foot{display:flex;gap:10px;padding:10px 14px calc(env(safe-area-inset-bottom,0px) + 10px);border-top:1px solid var(--glass-b2,#cbd2e6);background:var(--bg1,#fff)}',
    '.dsc-foot .dsc-btn{flex:1}',
    '.dsc-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 86px);transform:translateX(-50%);max-width:min(520px,92vw);background:#1e2540;color:#fff;border-radius:14px;padding:10px 12px 10px 16px;display:flex;gap:10px;align-items:center;font-size:16px;z-index:9100;box-shadow:0 6px 20px rgba(0,0,0,.35)}',
    '.dsc-toast .dsc-btn{min-height:44px;background:#fff;color:#1e2540;padding:6px 12px}',
    '.dsc-in{width:100%;min-height:52px;padding:10px 12px;border-radius:12px;border:1.5px solid var(--glass-b2,#b9c2dc);background:var(--bg0,#fff);color:var(--text,#0F172A);font:inherit}',
    '.dsc-bar{height:12px;border-radius:6px;background:var(--glass2,#dde2f0);overflow:hidden}',
    '.dsc-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--p1,#3B82F6),var(--p2,#8B5CF6));transition:width .15s}',
    '.dsc-ok{color:var(--ok,#16a34a);font-weight:800;font-size:20px}',
    '@media (prefers-reduced-motion:reduce){.dsc-root *{transition:none!important;animation:none!important}}'
  ].join('\n');
  function ensureStyle() {
    if (document.getElementById('dsc-style')) return;
    var s = document.createElement('style'); s.id = 'dsc-style'; s.textContent = CSS; document.head.appendChild(s);
  }
  function h(tag, cls, text, ev) {
    var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text;
    if (ev) e.addEventListener('click', ev); return e;
  }
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function kstDate() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, ''); }
  function pickName(base) {                       // 같은 날 같은 이름이면 _2, _3 …
    var key = 'dsc_names_' + kstDate(), used = [];
    try { used = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    var n = base, i = 2; while (used.indexOf(n) >= 0) n = base + '_' + (i++);
    return n;
  }
  function rememberName(n) {
    var key = 'dsc_names_' + kstDate(), used = [];
    try { used = JSON.parse(localStorage.getItem(key) || '[]'); used.push(n); localStorage.setItem(key, JSON.stringify(used)); } catch (e) {}
  }

  var S = null, ignorePop = 0, toastEl = null, toastTimer = 0;

  function toast(msg, label, fn, ms) {
    if (!S) return;
    if (toastEl) { toastEl.remove(); clearTimeout(toastTimer); }
    toastEl = h('div', 'dsc-toast'); toastEl.setAttribute('role', 'status');
    toastEl.appendChild(h('span', '', msg));
    if (label) toastEl.appendChild(h('button', 'dsc-btn', label, function () { hideToast(); fn && fn(); }));
    S.root.appendChild(toastEl);
    toastTimer = setTimeout(hideToast, ms || 5000);
  }
  function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } clearTimeout(toastTimer); }

  var pendingSave = Promise.resolve();            // O-0576: 저장 중인 쪽이 있으면 새 화면이 열릴 때 그것이 끝나길 기다린다
  function refresh() { var m = S; return store.listSession().then(function (r) { if (S && S === m) { S.pages = r.pages; } return r; }); }   // O-0576: 세션이 바뀌었으면 버린다
  function totalBytes() { return S.pages.reduce(function (a, p) { return a + (p.size || 0); }, 0); }

  function addFiles(files, kind) {                // 한 장씩 순서대로 줄여 저장
    if (!S || !files || !files.length) return Promise.resolve();     // O-0576: 닫힌 뒤 change 가 와도 예외 없음
    var mine = S;                                 // O-0576: 이 정리를 시작한 세션 — 바뀌면 즉시 멈춘다
    var room = DSC_MAX_PAGES - S.pages.length;
    if (room <= 0) { toast('이미 ' + DSC_MAX_PAGES + '쪽입니다. 더 담을 수 없습니다.'); return Promise.resolve(); }
    if (files.length > room) { toast(DSC_MAX_PAGES + '쪽까지만 담을 수 있어 앞의 ' + room + '장만 담습니다.', null, null, 6000); files = files.slice(0, room); }
    S.busy = true; var bad = 0, i = 0, n = files.length;
    function step() {
      if (i >= n || S !== mine) return Promise.resolve();
      S.prog = { i: i + 1, n: n, label: '사진 정리 중' }; paintProgress();
      return shrink(files[i]).then(function (r) {
        if (S !== mine) return;                   // 줄이는 사이 취소 — 저장하지 않는다
        var pr = store.addPage(r, kind); pendingSave = pr.then(function () {}, function () {}); return pr;
      })
        .catch(function (e) { bad++; if (S === mine) toast(e && e.message || '이 사진은 넣지 못했습니다.'); })
        .then(function () { i++; return step(); });
    }
    return step().then(function () { if (S === mine) return refresh(); }).then(function () {
      if (S !== mine) return;
      S.busy = false; S.prog = null; S.screen = 'list'; render();
      if (bad && bad === n) toast('사진을 읽지 못했습니다. 사진 파일인지 확인해 주세요.');
    });
  }
  function paintProgress() {
    if (!S) return;
    var el = S.body.querySelector('.dsc-prog');
    if (!el) { render(); el = S.body.querySelector('.dsc-prog'); }
    if (!el || !S.prog) return;
    el.querySelector('span').textContent = S.prog.label + ' ' + S.prog.i + ' / ' + S.prog.n;
    el.querySelector('i').style.width = Math.round(S.prog.i / S.prog.n * 100) + '%';
  }
  function progCard() {
    var c = h('div', 'dsc-card dsc-prog'), b = h('div', 'dsc-bar');
    c.appendChild(h('span', '', '')); b.appendChild(h('i')); c.appendChild(b);
    c.setAttribute('role', 'progressbar'); return c;
  }
  function shoot() {                              // 한 장 더 찍기
    if (!S || S.busy) return;
    var mine = S;
    if (S.pages.length >= DSC_MAX_PAGES) return toast('최대 ' + DSC_MAX_PAGES + '쪽까지입니다. 더 찍을 수 없습니다.');
    pageSource('camera').then(function (f) { if (S === mine) return addFiles(f, 'camera'); }).catch(function () {});
  }
  function gallery() {
    if (!S || S.busy) return;
    var mine = S;
    if (S.pages.length >= DSC_MAX_PAGES) return toast('최대 ' + DSC_MAX_PAGES + '쪽까지입니다.');
    pageSource('gallery').then(function (f) { if (S === mine) return addFiles(f, 'gallery'); }).catch(function () {});
  }
  function act(fn) {                              // 목록 조작 한 번: 끝나면 다시 그림
    if (!S || S.busy) return Promise.resolve(false);
    var mine = S; S.busy = true;                  // O-0576
    return Promise.resolve().then(fn).catch(function (e) { if (S === mine) toast(e && e.message || '처리하지 못했습니다.'); })
      .then(function () { if (S === mine) return refresh(); }).then(function () { if (S === mine) { S.busy = false; render(); return true; } return false; });
  }
  function retake(id) {
    if (!S || S.busy) return;
    var mine = S;
    pageSource('camera').then(function (fs) {
      if (S !== mine || !fs.length) return;
      return act(function () { return shrink(fs[0]).then(function (r) { if (S !== mine) return; return store.replacePage(id, r); }); });
    }).catch(function () {});
  }

  /* 썸네일(64px 표시용 128px) — 한 장씩 만들어 objectURL 로 캐시 */
  function thumbKey(p) { return p.id + ':' + p.size + ':' + p.w + 'x' + p.h; }
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';   // O-0576: 투명 1px
  function loadThumbs(imgs, token) {
    var mine = S;
    return imgs.reduce(function (pr, o) {
      return pr.then(function () {
        if (!S || S !== mine || S.token !== token) return;
        var k = thumbKey(o.p);
        if (S.thumbs[k]) { o.img.src = S.thumbs[k]; return; }
        function make() {
          return store.getPageBlob(o.p.id).then(function (b) { if (!b) throw new Error('x'); return shrink(b, { longSide: 128, quality: 0.6 }); })
            .then(function (t) { if (S === mine) { S.thumbs[k] = URL.createObjectURL(t.blob); o.img.src = S.thumbs[k]; } });
        }
        return make().catch(function () { if (S === mine) return make(); }).catch(function () {   // 한 번 재시도, 그래도 안 되면 쪽 번호 칸
          if (S !== mine) return;
          var ph = h('div', 'dsc-thumb dsc-thumb-ph', String(o.no)); ph.setAttribute('aria-label', o.no + '쪽');
          if (o.img.parentNode) o.img.parentNode.replaceChild(ph, o.img);
        });
      });
    }, Promise.resolve());
  }

  function setTop(title, backFn) {
    S.top.textContent = '';
    S.top.appendChild(h('button', 'dsc-btn', backFn ? '←' : '✕', function () { backFn ? backFn() : closeUi(false, true); }));
    S.top.lastChild.setAttribute('aria-label', backFn ? '이전' : '닫기');
    S.top.appendChild(h('b', '', title));
  }
  function clearFoot() { S.foot.textContent = ''; S.foot.style.display = 'none'; }
  function foot(btns) { S.foot.textContent = ''; S.foot.style.display = 'flex'; btns.forEach(function (b) { S.foot.appendChild(b); }); }

  function updRec() {                             // O-0576: 녹음 중 안내 한 줄(스캔 화면이 녹음 띠를 가리므로)
    if (!S || !S.recEl) return;
    var on = false; try { on = !!(S.opts.isRecording && S.opts.isRecording()); } catch (e) {}
    S.recEl.style.display = on ? 'block' : 'none';
  }
  function render() {
    if (!S) return;
    updRec();
    S.token = (S.token || 0) + 1;
    S.body.textContent = ''; clearFoot();
    var col = h('div', 'dsc-col'); S.body.appendChild(col);
    if (S.prog) { setTop('사진 정리'); col.appendChild(progCard()); paintProgress(); return; }
    ({ start: rStart, list: rList, name: rName, result: rResult }[S.screen] || rStart)(col);
  }
  function memNote(col) { if (S.mem) col.appendChild(h('div', 'dsc-warn', '이 기기에서는 임시 저장을 쓸 수 없어, 앱을 닫으면 사라집니다.')); }

  function rStart(col) {
    setTop(S.opts.purpose === 'meeting' ? '회의 자료 찍기' : '문서 스캔');
    if (S.pages.length) {
      var c = h('div', 'dsc-card dsc-item');
      c.appendChild(h('div', 'dsc-num', '작업 중이던 ' + S.pages.length + '쪽이 있습니다'));
      var r = h('div', 'dsc-row');
      r.appendChild(h('button', 'dsc-btn dsc-pri', '이어서', function () { S.screen = 'list'; render(); }));
      r.appendChild(h('button', 'dsc-btn', '버리기', function () { act(function () { return store.clearSession(); }); }));
      c.appendChild(r); col.appendChild(c);
    }
    col.appendChild(h('div', 'dsc-sub', '종이 문서를 한 쪽씩 사진으로 찍어 PDF 한 파일로 만듭니다. 최대 ' + DSC_MAX_PAGES + '쪽.'));
    col.appendChild(h('button', 'dsc-btn dsc-pri dsc-big', '📷 카메라로 찍기', shoot));
    col.appendChild(h('button', 'dsc-btn dsc-big', '🖼 사진 여러 장 고르기', gallery));
    col.appendChild(h('div', 'dsc-sub', '찍은 사진은 폰 사진첩에도 남을 수 있습니다.'));   // O-0576
    memNote(col);
  }

  function rList(col) {
    var n = S.pages.length;
    setTop('쪽 목록 · ' + n + '쪽', function () { closeUi(false, true); });
    if (!n) { col.appendChild(h('div', 'dsc-card', '아직 쪽이 없습니다.')); }
    if (n > DSC_SLOW_PAGES) col.appendChild(h('div', 'dsc-warn', '쪽이 많아 정리에 시간이 더 걸립니다.'));
    memNote(col);
    var imgs = [];
    S.pages.forEach(function (p, i) {
      var it = h('div', 'dsc-card dsc-item'), hd = h('div', 'dsc-item-h'), im = h('img', 'dsc-thumb');
      im.alt = ''; im.src = BLANK; imgs.push({ img: im, p: p, no: i + 1 });   // O-0576
      hd.appendChild(im);
      var t = h('div'); t.appendChild(h('div', 'dsc-num', (i + 1) + '쪽')); t.appendChild(h('div', 'dsc-sub', mb(p.size || 0)));
      hd.appendChild(t); it.appendChild(hd);
      var tl = h('div', 'dsc-row dsc-tools');
      var up = h('button', 'dsc-btn', '▲', function () { act(function () { return store.movePage(p.id, -1); }); });
      var dn = h('button', 'dsc-btn', '▼', function () { act(function () { return store.movePage(p.id, 1); }); });
      up.setAttribute('aria-label', '위로'); dn.setAttribute('aria-label', '아래로');
      if (i === 0) up.disabled = true; if (i === n - 1) dn.disabled = true;
      var del = h('button', 'dsc-btn', '🗑', function () {
        act(function () { return store.removePage(p.id); }).then(function (ran) {
          if (ran) toast((i + 1) + '쪽을 뺐습니다.', '되돌리기', function () { act(function () { return store.restoreRemoved(); }); }, 7000);
        });
      });
      del.setAttribute('aria-label', '이 쪽 빼기');
      tl.appendChild(up); tl.appendChild(dn);
      tl.appendChild(h('button', 'dsc-btn', '↻ 돌리기', function () { act(function () { return store.rotatePage(p.id); }); }));
      tl.appendChild(h('button', 'dsc-btn', '다시 찍기', function () { retake(p.id); }));
      tl.appendChild(del); it.appendChild(tl); col.appendChild(it);
    });
    var more = h('div', 'dsc-row');
    more.appendChild(h('button', 'dsc-btn', '📷 한 장 더', shoot));
    more.appendChild(h('button', 'dsc-btn', '🖼 사진 여러 장 고르기', gallery));
    col.appendChild(more);
    var done = h('button', 'dsc-btn dsc-pri', '완료', function () { if (S.pages.length) { S.screen = 'name'; render(); } });
    if (!n) done.disabled = true;
    foot([done]);
    loadThumbs(imgs, S.token);
  }

  function rName(col) {
    setTop('이름 정하기', function () { S.screen = 'list'; render(); });
    var base = S.opts.defaultName || (S.opts.purpose === 'meeting' ? '회의자료' : '문서');
    if (S.fname == null) S.fname = pickName(kstDate() + '_' + base);
    var c = h('div', 'dsc-card dsc-item');
    c.appendChild(h('label', 'dsc-num', '파일 이름'));
    var inp = h('input', 'dsc-in'); inp.type = 'text'; inp.value = S.fname; inp.id = 'dsc-name';
    inp.addEventListener('input', function () { S.fname = inp.value; });
    c.appendChild(inp);
    c.appendChild(h('div', 'dsc-sub', '쪽 수 ' + S.pages.length + '쪽 · 예상 용량 약 ' + mb(Math.round(totalBytes() * 1.02)) + ' · 끝에 .pdf 가 붙습니다'));
    col.appendChild(c);
    if (S.pages.length > DSC_SLOW_PAGES) col.appendChild(h('div', 'dsc-warn', '쪽이 많아 정리에 시간이 더 걸립니다.'));
    if (S.making) {
      var pc = progCard(); col.appendChild(pc);
      pc.querySelector('span').textContent = 'PDF 만드는 중 ' + S.making.i + ' / ' + S.making.n;
      pc.querySelector('i').style.width = Math.round(S.making.i / S.making.n * 100) + '%';
    }
    var mk = h('button', 'dsc-btn dsc-pri', 'PDF 만들기', makePdf);
    if (S.making) mk.disabled = true;
    foot([mk]);
  }

  function cleanName(s) {
    s = String(s || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return (s || (kstDate() + '_문서')) + '.pdf';
  }
  function makePdf() {
    if (!S || S.busy) return;
    var mine = S;                                 // O-0576: 세션이 바뀌면(닫고 다시 열면) 결과를 버리고 새 세션의 보관은 건드리지 않는다
    S.busy = true; S.making = { i: 0, n: S.pages.length }; render();
    var list = [], t0 = Date.now(), pages = S.pages.slice();
    function gone() { return S !== mine; }
    pages.reduce(function (p, pg) {
      return p.then(function () { if (gone()) throw new Error('cancel'); return store.getPageBlob(pg.id).then(function (b) { list.push({ blob: b, w: pg.w, h: pg.h }); }); });
    }, Promise.resolve()).then(function () {
      return buildPdf(list, function (i, n) {
        if (gone()) return;
        S.making = { i: i, n: n };
        var pc = S.body.querySelector('.dsc-prog');
        if (pc) { pc.querySelector('span').textContent = 'PDF 만드는 중 ' + i + ' / ' + n; pc.querySelector('i').style.width = Math.round(i / n * 100) + '%'; }
      });
    }).then(function (blob) {
      if (gone()) throw new Error('cancel');
      var name = cleanName(S.fname), file = new File([blob], name, { type: 'application/pdf', lastModified: Date.now() });
      var info = { pages: list.length, bytes: blob.size, ms: Date.now() - t0 };
      rememberName(name.replace(/\.pdf$/i, ''));
      return store.clearSession().then(function () {
        if (gone()) return;
        S.busy = false; S.making = null; S.pages = [];
        if (S.opts.purpose === 'meeting') {
          var cb = S.opts.onDone; S.doneCalled = true; closeUi(false, false);
          if (cb) cb(file, info);
        } else { S.file = file; S.info = info; S.screen = 'result'; render(); }
      });
    }).catch(function (e) {
      if (gone()) return;
      S.busy = false; S.making = null; render(); toast('PDF 를 만들지 못했습니다. ' + (e && e.message || ''));
    });
  }

  function rResult(col) {
    setTop('PDF 완성');
    var a = (S.opts.actions || {}), f = S.file;
    var c = h('div', 'dsc-card dsc-item');
    c.appendChild(h('div', 'dsc-ok', '✔ PDF 를 만들었습니다'));
    c.appendChild(h('div', 'dsc-num', f.name));
    c.appendChild(h('div', 'dsc-sub', S.info.pages + '쪽 · ' + mb(S.info.bytes)));
    col.appendChild(c);
    function call(k) { return function () { try { a[k] && a[k](f); } catch (e) { toast('실행하지 못했습니다.'); } }; }
    if (a.share) col.appendChild(h('button', 'dsc-btn dsc-pri dsc-big', '공유함에 넣기', call('share')));
    if (a.view) col.appendChild(h('button', 'dsc-btn dsc-big', '문서 뷰어로 열기', call('view')));
    if (a.save) col.appendChild(h('button', 'dsc-btn dsc-big', '폰에 저장', call('save')));
    foot([h('button', 'dsc-btn', '닫기', function () { closeUi(false, false); })]);
  }

  /* 뒤로가기: 모듈 안 popstate. open() 때 history 한 칸을 쌓고, 닫을 때 우리가 쌓은 칸이면 되돌린다. */
  var popHooked = false;   // O-0576
  function onPop() {
    if (ignorePop > 0) { ignorePop--; return; }
    if (!S) return;
    if (S.making) { history.pushState({ dsc: 1 }, ''); toast('작업 중입니다. 잠시만 기다려 주세요.'); return; }   // O-0576: PDF 작성 중만 막는다
    if (S.busy) { S.pushed = false; closeUi(true, true); return; }          // O-0576: 사진 정리 중 뒤로가기 = ✕ 와 같이 정리를 멈추고 닫는다
    if (S.screen === 'name') { history.pushState({ dsc: 1 }, ''); S.screen = 'list'; render(); return; }
    S.pushed = false; closeUi(true, S.screen !== 'result');
  }
  function closeUi(fromPop, cancel) {
    if (!S) return;
    var s = S, cb = s.opts.onCancel; S = null; hideToast(); clearInterval(s.recTimer);
    // O-0576: 리스너는 떼지 않는다(떼면 아래 history.back() 의 popstate 를 못 받아 ignorePop 이 1 남아, 다음에 연 화면의 첫 뒤로가기가 먹히지 않았다)
    Object.keys(s.thumbs).forEach(function (k) { try { URL.revokeObjectURL(s.thumbs[k]); } catch (e) {} });
    store.commitRemoved();
    s.root.remove();
    if (!fromPop && s.pushed) { ignorePop++; try { history.back(); } catch (e) { ignorePop--; } }
    if (cancel && !s.doneCalled && cb) { try { cb(); } catch (e) {} }
  }

  function open(opts) {
    opts = opts || {};
    if (S) return false;
    ensureStyle();
    var root = h('div', 'dsc-root'); root.id = 'dsc-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '문서 스캔');
    var top = h('div', 'dsc-top'), body = h('div', 'dsc-body'), ft = h('div', 'dsc-foot');
    var recEl = h('div', 'dsc-rec', '● 녹음은 계속되고 있습니다'); recEl.style.display = 'none'; recEl.setAttribute('role', 'status');   // O-0576
    root.appendChild(top); root.appendChild(recEl); root.appendChild(body); root.appendChild(ft);
    document.body.appendChild(root);
    S = { opts: opts, recEl: recEl, root: root, top: top, body: body, foot: ft, screen: 'start', pages: [], thumbs: {}, busy: false, token: 0, pushed: false, fname: null };
    try { history.pushState({ dsc: 1 }, ''); S.pushed = true; if (!popHooked) { popHooked = true; window.addEventListener('popstate', onPop); } } catch (e) {}
    S.busy = true; render();
    var first = S;
    if (opts.isRecording) first.recTimer = setInterval(function () { if (S === first) updRec(); }, 3000);   // O-0576
    pendingSave.then(function () { return store.listSession(); }).then(function (r) {
      if (S !== first) return;
      S.pages = r.pages; S.busy = false;
      return store.usingMemory().then(function (m) {
        if (!S) return;
        S.mem = m; render();
        if (r.expired) toast('3일이 지난 작업 중 사진은 지웠습니다.');
      });
    }).catch(function () {                        // O-0576: 저장소 예외 → 메모리 모드 폴백으로 시작 화면
      if (S !== first) return;
      db = null; dbTried = true; memInit();
      S.pages = []; S.busy = false; S.mem = true; render();
    });
    return true;
  }

  /* O-0576: 앱 시작 때 부르는 가벼운 정리 — 마지막 수정 3일 지난 임시 세션을 지운다(열기 없이). 실패는 삼킨다. */
  function sweep() {
    try {
      if (S) return Promise.resolve(false);
      return openDb().then(function (d) {
        if (!d || S) return false;
        return getMeta().then(function (m) {
          if (!m || S || Date.now() - m.modified <= DSC_KEEP_DAYS * 86400000) return false;
          return clearAll().then(function () { return true; });
        });
      }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  global.DocScan = {
    sweep: sweep, open: open, buildPdf: buildPdf, shrink: shrink, pageSource: pageSource,
    listSession: store.listSession, addPage: store.addPage, movePage: store.movePage, removePage: store.removePage,
    restoreRemoved: store.restoreRemoved, replacePage: store.replacePage, rotatePage: store.rotatePage,
    clearSession: store.clearSession, getPageBlob: store.getPageBlob,
    isOpen: function () { return !!S; },
    back: function () { if (!S) return false; try { history.back(); } catch (e) { closeUi(true, true); } return true; },   // app.js goBack() 에서 호출 가능
    KEEP_DAYS: DSC_KEEP_DAYS, MAX_PAGES: DSC_MAX_PAGES
  };
})(window);

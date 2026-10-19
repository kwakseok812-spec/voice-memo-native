/* doc-scan.js — 문서 스캔(사진 → PDF) 자립형 모듈. window.DocScan 하나만 노출한다.
 * 순수 기능: buildPdf / shrink / 쪽 저장소(IndexedDB docscan_tmp). 화면: open().
 * 스위치(켜고 끄기)는 이 파일에 없다 — app.js 가 결정한다(DOC_SCAN, DOC_SCAN_AUTO → open 옵션 auto).
 * O-0583: 자동 테두리·펴기·보정·두 쪽 나누기는 DocScanCV(doc-scan-cv.js) 를 쓰고, open 옵션 auto:true 일 때만 켜진다. */
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

  /* ───────── B2. 자동 보정 도우미 (O-0583) ─────────
   * 쪽 하나 = 원본(orig, 긴 변 2400·JPEG 0.85) + 처리 결과(out, 긴 변 2000·0.80). 처리는 DocScanCV(vendor/opencv.js) 가 한다.
   * 이 구역은 «원본 그림(canvas) → 결과 그림» 순수 함수와 흑백·회색용 1채널 JPEG 만들기. 화면과 저장소는 모른다. */
  var DSC_ORIG_SIDE = 2400, DSC_OUT_SIDE = 2000, DSC_SPREAD_SIDE = 2400;
  var DSC_QUALITY = {                              // PDF 화질: side=긴 변, q=JPEG 품질. 예상 용량은 estBytes 가 쪽 크기로 어림한다
    normal: { side: 2000, q: 0.80, label: '보통(권장)' },
    high: { side: 2400, q: 0.88, label: '높음' },
    small: { side: 1400, q: 0.70, label: '작게' }
  };
  var DSC_MODES = [['doc', '문서'], ['bw', '흑백'], ['gray', '회색'], ['orig', '원본']];
  function modeLabel(m) { for (var i = 0; i < DSC_MODES.length; i++) if (DSC_MODES[i][0] === m) return DSC_MODES[i][1]; return '원본'; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }   // 화면이 얼어붙지 않게 한 박자 양보
  function mkCv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function freeCv(c) { try { if (c) { c.width = 0; c.height = 0; } } catch (e) {} }
  function cvLib() { return global.DocScanCV || null; }
  function cvReady() { var L = cvLib(); return !!(L && L.isReady()); }

  /* 사진 파일/Blob → 그림(canvas). 긴 변이 side 보다 크면 줄인다(키우지 않음). EXIF 방향 반영(loadSource). */
  function prepCanvas(file, side) {
    return loadSource(file).then(function (s) {
      var sc = Math.min(1, side / Math.max(s.w, s.h)), w = Math.max(1, Math.round(s.w * sc)), h = Math.max(1, Math.round(s.h * sc));
      var c = mkCv(w, h), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(s.src, 0, 0, w, h);
      s.free(); return c;
    }, function () { throw new Error(BAD); });
  }
  function copyCv(c) { var o = mkCv(c.width, c.height); o.getContext('2d').drawImage(c, 0, 0); return o; }
  function fitSide(c, side) {                       // 긴 변이 side 보다 크면 줄인 새 그림(원본 c 는 닫음), 아니면 그대로
    var m = Math.max(c.width, c.height); if (m <= side) return c;
    var sc = side / m, w = Math.max(1, Math.round(c.width * sc)), h = Math.max(1, Math.round(c.height * sc)), o = mkCv(w, h), x = o.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); freeCv(c); return o;
  }
  function rotCv(c, rot) {                          // 시계방향 rot(90 배수)로 돌린 새 그림(c 는 닫음)
    rot = ((rot % 360) + 360) % 360; if (!rot) return c;
    var sw = rot === 90 || rot === 270, o = mkCv(sw ? c.height : c.width, sw ? c.width : c.height), x = o.getContext('2d');
    x.translate(o.width / 2, o.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
    freeCv(c); return o;
  }
  function isFullQuad(c, w, h) {                    // 네 점이 사진 모서리 근처(1.2%)면 «전체»
    if (!c || c.length !== 4) return true;
    var t = 0.012 * Math.max(w, h), ex = [[0, 0], [w, 0], [w, h], [0, h]];
    for (var i = 0; i < 4; i++) if (Math.abs(c[i].x - ex[i][0]) > t || Math.abs(c[i].y - ex[i][1]) > t) return false;
    return true;
  }
  function quadValid(c) {                           // 손으로 맞춘 네 점이 볼록 사각형인지(꼬이지 않았는지)
    if (!c || c.length !== 4) return false;
    var sg = 0, i;
    for (i = 0; i < 4; i++) {
      var a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4], z = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      if (!isFinite(z) || Math.abs(z) < 1) return false;
      if (sg === 0) sg = z > 0 ? 1 : -1; else if ((z > 0 ? 1 : -1) !== sg) return false;
    }
    return true;
  }
  /* 1단계: 원본 → 편 그림(flat). spec.corners(null 이면 안 폄). → {flat, warped, failed} (flat 이 src 와 같으면 새로 만든 것이 아님) */
  function flatOf(src, spec, maxSide) {
    var L = cvLib(), cr = spec.corners;
    if (cr && !isFullQuad(cr, src.width, src.height) && L) {
      var w = L.warp(src, cr, { maxSide: maxSide });
      if (w !== src) return { flat: w, warped: true, failed: false };
      return { flat: src, warped: false, failed: true };
    }
    return { flat: src, warped: false, failed: false };
  }
  /* 2단계: 편 그림 → 결과. spec.split={side,pos}|null, spec.rot. flat 은 닫지 않는다(두 쪽이 같이 쓰므로). 항상 새 그림을 돌려준다. */
  function finishOut(flat, spec, mode, side) {
    var L = cvLib(), cur = flat, made = false, sp = spec.split;
    if (sp) {
      var x0 = sp.side === 'L' ? 0 : Math.round(flat.width * sp.pos), x1 = sp.side === 'L' ? Math.round(flat.width * sp.pos) : flat.width;
      x0 = Math.max(0, Math.min(flat.width - 8, x0)); x1 = Math.max(x0 + 8, Math.min(flat.width, x1));
      cur = mkCv(x1 - x0, flat.height); cur.getContext('2d').drawImage(flat, x0, 0, x1 - x0, flat.height, 0, 0, x1 - x0, flat.height); made = true;
    }
    if (spec.rot) { cur = rotCv(made ? cur : copyCv(cur), spec.rot); made = true; }
    if (!made) cur = copyCv(cur);
    cur = fitSide(cur, side);
    if (mode && mode !== 'orig' && L) { var e = L.enhance(cur, mode); if (e !== cur) { freeCv(cur); cur = e; } }
    return cur;
  }
  function renderOut(src, spec, maxSide, mode) {    // 한 번에: flatOf + finishOut. → {canvas, failed}
    var f = flatOf(src, spec, spec.split ? DSC_SPREAD_SIDE : maxSide);
    var out = finishOut(f.flat, spec, mode, maxSide);
    if (f.flat !== src) freeCv(f.flat);
    return { canvas: out, failed: f.failed };
  }

  /* 흑백·회색 결과는 JPEG 도 1채널(DeviceGray)로 만든다 — 브라우저 toBlob 은 항상 3채널이라 직접 인코딩(베이스라인 JPEG).
   * 표준 밝기 표·허프만 표(JPEG 규격 부록 K). 블록 줄 24개마다 한 박자 양보. */
  var JQ = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  var JZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
  var JDC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], JDC_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  var JAC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  var JAC_VAL = [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a,
    0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a,
    0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6,
    0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];
  var jTab = null;
  function jInit() {
    if (jTab) return jTab;
    function codes(bits, vals) {                    // 규격의 정규 허프만 부호 만들기 → {기호:[부호,길이]}
      var out = {}, code = 0, k = 0, len, i;
      for (len = 1; len <= 16; len++) { for (i = 0; i < bits[len - 1]; i++) { out[vals[k++]] = [code, len]; code++; } code <<= 1; }
      return out;
    }
    var C = new Float64Array(64), u, x;
    for (u = 0; u < 8; u++) for (x = 0; x < 8; x++) C[u * 8 + x] = Math.cos((2 * x + 1) * u * Math.PI / 16) * (u === 0 ? Math.SQRT1_2 / 2 : 0.5);
    jTab = { dc: codes(JDC_BITS, JDC_VAL), ac: codes(JAC_BITS, JAC_VAL), C: C };
    return jTab;
  }
  function encodeGrayJpeg(canvas, quality) {        // → Promise<Blob(image/jpeg, 1채널)>
    var W = canvas.width, H = canvas.height, T = jInit(), q = Math.max(0.05, Math.min(1, quality || 0.8)) * 100;
    var sc = q < 50 ? 5000 / q : 200 - 2 * q, Q = [], i;
    for (i = 0; i < 64; i++) Q.push(Math.max(1, Math.min(255, Math.floor((JQ[i] * sc + 50) / 100))));
    var px = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    var buf = new Uint8Array(Math.max(4096, Math.ceil(W * H / 3))), n = 0;
    function put(b) { if (n >= buf.length) { var nb = new Uint8Array(buf.length * 2); nb.set(buf); buf = nb; } buf[n++] = b; }
    function put16(v) { put(v >> 8); put(v & 255); }
    put16(0xFFD8);
    put16(0xFFE0); put16(16); put(0x4A); put(0x46); put(0x49); put(0x46); put(0); put(1); put(1); put(0); put16(1); put16(1); put(0); put(0);   // JFIF
    put16(0xFFDB); put16(67); put(0); for (i = 0; i < 64; i++) put(Q[JZZ[i]]);
    put16(0xFFC0); put16(11); put(8); put16(H); put16(W); put(1); put(1); put(0x11); put(0);
    function dht(cls, bl, vals) { put16(0xFFC4); put16(2 + 1 + 16 + vals.length); put(cls << 4); var k; for (k = 0; k < 16; k++) put(bl[k]); for (k = 0; k < vals.length; k++) put(vals[k]); }
    dht(0, JDC_BITS, JDC_VAL); dht(1, JAC_BITS, JAC_VAL);
    put16(0xFFDA); put16(8); put(1); put(1); put(0x00); put(0); put(63); put(0);
    var bitBuf = 0, bitCnt = 0;
    function bits(code, len) {
      bitBuf = (bitBuf << len) | code; bitCnt += len;
      while (bitCnt >= 8) { var b = (bitBuf >> (bitCnt - 8)) & 255; put(b); if (b === 255) put(0); bitCnt -= 8; }
      bitBuf &= (1 << bitCnt) - 1;
    }
    var BW = Math.ceil(W / 8), BH = Math.ceil(H / 8), prevDC = 0, blk = new Float64Array(64), tmp = new Float64Array(64), co = new Int32Array(64), C = T.C;
    function cat(v) { v = v < 0 ? -v : v; var c = 0; while (v) { c++; v >>= 1; } return c; }
    function block(bx, by) {
      var x, y, u, k, s;
      for (y = 0; y < 8; y++) { var yy = Math.min(H - 1, by * 8 + y); for (x = 0; x < 8; x++) { var xx = Math.min(W - 1, bx * 8 + x); blk[y * 8 + x] = px[(yy * W + xx) * 4] - 128; } }
      for (y = 0; y < 8; y++) for (u = 0; u < 8; u++) { s = 0; for (x = 0; x < 8; x++) s += C[u * 8 + x] * blk[y * 8 + x]; tmp[y * 8 + u] = s; }
      for (u = 0; u < 8; u++) for (x = 0; x < 8; x++) { s = 0; for (y = 0; y < 8; y++) s += C[x * 8 + y] * tmp[y * 8 + u]; blk[x * 8 + u] = s; }
      for (k = 0; k < 64; k++) co[k] = Math.round(blk[JZZ[k]] / Q[JZZ[k]]);
      var d = co[0] - prevDC; prevDC = co[0];
      var ct = cat(d), dc = T.dc[ct]; bits(dc[0], dc[1]);
      if (ct) bits(d < 0 ? (d - 1) & ((1 << ct) - 1) : d, ct);
      var run = 0, ac;
      for (k = 1; k < 64; k++) {
        var a = co[k];
        if (a === 0) { run++; continue; }
        while (run > 15) { ac = T.ac[0xF0]; bits(ac[0], ac[1]); run -= 16; }
        var cc = cat(a); ac = T.ac[(run << 4) | cc]; bits(ac[0], ac[1]);
        bits(a < 0 ? (a - 1) & ((1 << cc) - 1) : a, cc); run = 0;
      }
      if (run) { ac = T.ac[0x00]; bits(ac[0], ac[1]); }
    }
    return new Promise(function (res, rej) {
      var by = 0;
      function step() {
        try {
          var end = Math.min(BH, by + 24), bx;
          for (; by < end; by++) for (bx = 0; bx < BW; bx++) block(bx, by);
          if (by < BH) return setTimeout(step, 0);
          if (bitCnt) bits((1 << (8 - bitCnt)) - 1, 8 - bitCnt);
          put16(0xFFD9);
          res(new Blob([buf.subarray(0, n)], { type: 'image/jpeg' }));
        } catch (e) { rej(e); }
      }
      step();
    });
  }
  function encodeOut(canvas, mode, q) {             // 결과 그림 → JPEG. bw·gray 는 1채널, 실패하면 보통 JPEG.
    if (mode === 'bw' || mode === 'gray') return encodeGrayJpeg(canvas, q).catch(function () { return canvasToJpeg(canvas, q); });
    return canvasToJpeg(canvas, q);
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

  /* 쪽 레코드(O-0583): {id, out(처리 결과 JPEG), orig(줄인 원본 JPEG, 없을 수 있음), w, h(out 크기), ow, oh(orig 크기), corners(orig 좌표 4점|null), cand(아쉬운 후보 4점|null),
   *   mode('orig'|'doc'|'bw'|'gray'), score, how('edge'|'paper'|'none'|'manual'|'off'|'skip'), split({g,side:'L'|'R',pos}|null), rot(0~270), v(고친 횟수)}.
   * v9.23 레코드는 {id, blob, w, h} — blob 이 곧 out 이고 orig 는 없다(그대로 열린다). */
  function outOf(r) { return r.out || r.blob; }
  function mkRec(pg, id) {
    var r = { out: pg.out || pg.blob, w: pg.w, h: pg.h, v: pg.v || 0 };
    if (id != null) r.id = id;
    ['orig', 'ow', 'oh', 'corners', 'cand', 'mode', 'score', 'how', 'split', 'rot'].forEach(function (k) { if (pg[k] != null) r[k] = pg[k]; });
    return r;
  }
  function pageInfo(id, r) {                        // 목록용 요약(Blob 본체는 담지 않는다)
    var o = outOf(r);
    return { id: id, w: r.w, h: r.h, size: o.size, osize: r.orig ? r.orig.size : 0, hasOrig: !!r.orig, mode: r.mode || 'orig', how: r.how || '', score: r.score || 0,
      corners: r.corners || null, split: r.split || null, rot: r.rot || 0, v: r.v || 0 };
  }
  var store = {
    usingMemory: function () { return openDb().then(function () { return usingMem; }); },
    /* 열 때 검사: 3일 지난 세션은 지운다. → {pages:[pageInfo], created, modified, kind, expired} */
    listSession: function () {
      return getMeta().then(function (m) {
        if (!m) return { pages: [], created: 0, modified: 0, kind: '' };
        if (Date.now() - m.modified > DSC_KEEP_DAYS * 86400000) {
          return clearAll().then(function () { return { pages: [], created: 0, modified: 0, kind: '', expired: true }; });
        }
        var out = [];
        return m.order.reduce(function (p, id) {
          return p.then(function () { return getPage(id).then(function (r) { if (r) out.push(pageInfo(id, r)); }); });
        }, Promise.resolve()).then(function () {
          return allPageKeys().then(function (keys) {     // 목록에 없는 쪽(되돌리기 대기 중 닫힘 등)은 정리
            var held = lastRemoved ? lastRemoved.id : -1;
            return keys.filter(function (k) { return m.order.indexOf(k) < 0 && k !== held; }).reduce(function (p, k) { return p.then(function () { return delPage(k); }); }, Promise.resolve());
          });
        }).then(function () { return { pages: out, created: m.created, modified: m.modified, kind: m.kind }; });
      });
    },
    addPage: function (pg, kind, afterId) {           // pg={blob|out,w,h[,orig…]} → Promise<id>. afterId 가 있으면 그 쪽 바로 뒤에 넣는다
      return getMeta().then(function (m) {
        m = m || { order: [], created: Date.now(), kind: kind || '' };
        if (m.order.length >= DSC_MAX_PAGES) throw new Error('최대 ' + DSC_MAX_PAGES + '쪽까지 담을 수 있습니다.');
        return putPage(mkRec(pg)).then(function (id) {
          var at = afterId == null ? -1 : m.order.indexOf(afterId);
          if (at < 0) m.order.push(id); else m.order.splice(at + 1, 0, id);
          return putMeta(m).then(function () { return id; });
        });
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
    getRec: function (id) { return getPage(id); },                                  // 전체 레코드(Blob 참조 포함)
    getPageBlob: function (id) { return getPage(id).then(function (r) { return r ? outOf(r) : null; }); },   // PDF 에 쓰는 결과 JPEG
    getOrigBlob: function (id) { return getPage(id).then(function (r) { return r ? (r.orig || outOf(r)) : null; }); },
    /* 쪽 하나를 새 내용으로 통째로 바꿈(다시 찍기). pg 는 addPage 와 같은 모양. 순서·id 는 그대로. */
    replacePage: function (id, pg) {
      return getPage(id).then(function (old) {
        pg.v = ((old && old.v) || 0) + 1;
        return putPage(mkRec(pg, id)).then(function () { return getMeta().then(putMeta); });
      });
    },
    /* 일부 칸만 고침(자르기·보정). patch 의 키가 null 이면 그 칸을 지운다. v 를 올려 썸네일을 다시 만들게 한다. */
    updatePage: function (id, patch) {
      return getPage(id).then(function (r) {
        if (!r) throw new Error('쪽을 찾지 못했습니다.');
        var n = {}, k; for (k in r) if (k !== 'blob') n[k] = r[k];
        if (!n.out) n.out = r.blob;
        for (k in patch) { if (patch[k] == null) delete n[k]; else n[k] = patch[k]; }
        n.v = (r.v || 0) + 1;
        return putPage(n).then(function () { return getMeta().then(putMeta); });
      });
    },
    rotatePage: function (id) {                       // 시계방향 90°. 원본이 있으면 결과만 돌리고 rot 를 올린다(원본·모서리는 그대로). 없으면 v9.23 처럼 그림을 돌린다.
      return getPage(id).then(function (r) {
        return prepCanvas(outOf(r), 100000).then(function (c) {
          var rc = rotCv(c, 90), w = rc.width, h = rc.height;
          return encodeOut(rc, r.mode, 0.85).then(function (blob) { freeCv(rc); return { blob: blob, w: w, h: h }; }, function (e) { freeCv(rc); throw e; });
        }).then(function (n) {
          if (!r.orig) return store.replacePage(id, { out: n.blob, w: n.w, h: n.h, mode: r.mode, how: r.how, score: r.score, corners: r.corners, cand: r.cand, split: r.split, rot: r.rot });
          return store.updatePage(id, { out: n.blob, w: n.w, h: n.h, rot: ((r.rot || 0) + 90) % 360 });
        });
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
    '.dsc-rcpt-img{display:block;max-width:100%;max-height:50vh;margin:0 auto;border-radius:8px;object-fit:contain}',
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
    '.dsc-set{display:flex;flex-direction:column;gap:8px;padding:10px 12px}',
    '.dsc-chiprow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.dsc-chiplab{min-width:48px;font-size:14px;font-weight:800;color:var(--muted,#55627D)}',
    '.dsc-seg{display:flex;gap:6px;flex-wrap:wrap;flex:1}',
    '.dsc-chip{min-height:44px;min-width:44px;padding:6px 12px;border-radius:22px;border:1.5px solid var(--glass-b2,#b9c2dc);background:var(--bg1,#fff);color:var(--text,#0F172A);font:inherit;font-size:15px;font-weight:700;cursor:pointer}',
    '.dsc-chip.dsc-on{background:linear-gradient(135deg,var(--p1,#3B82F6),var(--p2,#8B5CF6));color:#fff;border-color:transparent}',
    '.dsc-info{min-width:0;flex:1}',
    '.dsc-line{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;white-space:nowrap;overflow:hidden}',
    '.dsc-line .dsc-num{font-size:16px}',
    '.dsc-st{font-size:13px;color:var(--muted,#55627D)}',
    '.dsc-stw{color:var(--warn-t,#B45309);font-weight:700}',
    '.dsc-badge{min-height:30px;padding:2px 8px;border-radius:12px;border:1.5px solid var(--warn-t,#B45309);background:transparent;color:var(--warn-t,#B45309);font:inherit;font-size:13px;font-weight:800;cursor:pointer}',
    '.dsc-tools2{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}',
    '.dsc-ib{flex-direction:column;gap:0;min-height:56px;padding:4px 2px;border-radius:12px;line-height:1.15}',
    '.dsc-ic{font-size:20px}',
    '.dsc-it{font-size:12px;font-weight:700}',
    '.dsc-skip{margin-top:10px;width:100%}',
    '.dsc-qrow{margin-top:6px}',
    '.dsc-stage{position:relative;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none;background:#222;border-radius:6px}',
    '.dsc-stage-img{display:block;border-radius:6px}',
    '.dsc-svg{position:absolute;left:0;top:0;pointer-events:none}',
    '.dsc-hd{position:absolute;width:48px;height:48px;margin:-24px 0 0 -24px;touch-action:none;cursor:grab;display:flex;align-items:center;justify-content:center}',
    '.dsc-hd i{display:block;width:24px;height:24px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 0 0 1.5px #1e3a8a,0 2px 6px rgba(0,0,0,.45)}',
    '.dsc-sph i{background:#F59E0B;border-radius:8px;width:20px;height:34px}',
    '.dsc-loupe{position:absolute;width:96px;height:96px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.55);pointer-events:none;z-index:5;background:#fff}',
    '.dsc-foot4 .dsc-btn{padding:8px 4px;font-size:15px}',
    '.dsc-spbtn{align-self:flex-start}',
    '.dsc-sheet{position:absolute;left:0;right:0;bottom:0;z-index:20;background:var(--bg1,#fff);border-top:1px solid var(--glass-b2,#cbd2e6);border-radius:18px 18px 0 0;padding:14px 14px calc(env(safe-area-inset-bottom,0px) + 14px);display:flex;flex-direction:column;gap:10px;box-shadow:0 -8px 28px rgba(0,0,0,.3);max-height:80%;overflow:auto}',
    '.dsc-sheet-t{font-size:18px}',
    '.dsc-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '.dsc-tile{display:flex;flex-direction:column;gap:4px;align-items:stretch;padding:4px;border-radius:12px;border:2px solid var(--glass-b2,#b9c2dc);background:var(--bg0,#fff);color:var(--text,#0F172A);font:inherit;cursor:pointer;min-height:44px}',
    '.dsc-tile.dsc-on{border-color:var(--p1,#3B82F6);box-shadow:0 0 0 2px var(--p1,#3B82F6)}',
    '.dsc-tile-img{display:block;border-radius:6px;background:#eee}',
    '.dsc-tile-l{font-size:14px;font-weight:800;text-align:center}',
    '.dsc-swrow{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:700;cursor:pointer}',
    '.dsc-swrow input{width:26px;height:26px}',
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

  /* ── O-0583 설정(칩)·자동 처리 ── */
  var SET_KEY = 'dsc_settings_v1';
  function loadSet() {
    var o = {}; try { o = JSON.parse(localStorage.getItem(SET_KEY) || '{}') || {}; } catch (e) { o = {}; }
    return { mode: ['doc', 'bw', 'gray', 'orig'].indexOf(o.mode) >= 0 ? o.mode : 'doc', auto: o.auto !== false, two: !!o.two, rtl: !!o.rtl, q: DSC_QUALITY[o.q] ? o.q : 'normal' };
  }
  function saveSet() { try { if (S && S.set) localStorage.setItem(SET_KEY, JSON.stringify(S.set)); } catch (e) {} }
  function autoOn() { return !!(S && S.opts.auto && S.cvOk !== false && S.set); }      // 칩·자동 처리를 쓰는 화면인가
  function cvUsable() { return !!(S && S.opts.auto && cvReady()); }                       // 자르기·보정을 실제로 할 수 있는가
  function isQuota(e) { return !!e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message || ''))); }
  var QUOTA_MSG = '저장 공간이 부족합니다. 불필요한 파일을 지운 뒤 다시 시도해 주세요.';
  function storageMsg(e, fb) { return isQuota(e) ? QUOTA_MSG : ((e && e.message) || fb || '처리하지 못했습니다.'); }   // O-0586: 영문 시스템 문구를 화면에 내지 않는다
  function ensureCv(retry) {                                                                    // opencv 불러오기(한 번). 실패하면 칩을 숨기고 한 번 안내
    var m = S;
    if (!m || !m.opts.auto) return Promise.resolve(false);
    if (!cvLib()) { m.cvOk = false; return Promise.resolve(false); }
    return cvLib().load(!!retry).then(function (ok) {
      if (S !== m) return ok;
      m.cvOk = !!ok;
      if (!ok && !m.cvNoticed) { m.cvNoticed = true; toast('자동 보정을 쓸 수 없어 원본으로 만듭니다.', null, null, 6000); }
      return !!ok;
    });
  }
  function plainPage(file, how) {                  // v9.23 방식: 줄이기만(원본 모드)
    return shrink(file).then(function (r) { if (how) { r.mode = 'orig'; r.how = how; } return [r]; });
  }
  /* 자동 처리 한 장: 줄이기(2400) → 원본 보관 → 테두리 찾기 → 펴기 → (두 쪽이면 가운데 선 찾아 나누기) → 보정. → pg 배열(1~2개) 또는 null(취소) */
  async function autoPage(file, cfg, mine) {
    var cvs = await prepCanvas(file, DSC_ORIG_SIDE), ow = cvs.width, oh = cvs.height, outs = [];
    try {
      if (S !== mine) return null;
      var corners = null, how = cfg.auto ? 'none' : 'off', score = 0, cand = null;
      await tick();
      if (cfg.auto) {
        var d = await DocScanCV.detect(cvs); await tick();
        score = d.score || 0; how = d.how || 'none';
        if (d.ok && score >= DocScanCV.DSCV_MIN_SCORE && how !== 'none') corners = isFullQuad(d.corners, ow, oh) ? null : d.corners;
        else { how = 'none'; if (d.candidate && d.candidate.corners) cand = d.candidate.corners; }
        if (!d.ok) how = 'off';
      }
      if (S !== mine) return null;
      var base = { ow: ow, oh: oh, corners: corners, cand: cand, mode: cfg.mode, score: score, how: how, rot: 0 };
      var needOrig = !!corners || cfg.two || cfg.mode !== 'orig';
      var origBlob = needOrig ? await canvasToJpeg(cvs, 0.85) : null; await tick();
      if (S !== mine) return null;
      var flat = flatOf(cvs, { corners: corners }, cfg.two ? DSC_SPREAD_SIDE : DSC_OUT_SIDE), asp = flat.flat.width / flat.flat.height, two = cfg.two && asp >= 1.05;
      if (cfg.two && corners && asp < 1.05) {      // 두 쪽 모드인데 세로 모양 한 장만 찾았다 = 펼친 책의 한쪽만 잡았을 가능성 → 자르지 않고 사진 전체에서 가운데 선을 찾는다
        if (flat.flat !== cvs) freeCv(flat.flat);
        corners = null; how = 'none'; base.corners = null; base.how = 'none';
        flat = flatOf(cvs, { corners: null }, DSC_SPREAD_SIDE); asp = flat.flat.width / flat.flat.height; two = asp >= 1.05;
      }
      if (cfg.two && !two && S === mine && !S.noSplitNote) { S.noSplitNote = true; toast('세로로 찍힌 사진은 두 쪽으로 나누지 않았습니다. 필요하면 ✂ 자르기에서 나눌 수 있습니다.', null, null, 6000); }
      var specs;
      if (two) {
        var sp = DocScanCV.findSpine(flat.flat), g = Date.now() + '_' + Math.floor(Math.random() * 1e6), sides = cfg.rtl ? ['R', 'L'] : ['L', 'R'];
        specs = sides.map(function (sd) { return { split: { g: g, side: sd, pos: sp.pos }, spine: sp.how }; });
      } else specs = [{ split: null }];
      for (var i = 0; i < specs.length; i++) {
        var oc = finishOut(flat.flat, { split: specs[i].split, rot: 0 }, cfg.mode, DSC_OUT_SIDE); await tick();
        var w = oc.width, h = oc.height, blob = await encodeOut(oc, cfg.mode, 0.80); freeCv(oc); await tick();
        var pg = { out: blob, w: w, h: h, orig: origBlob, split: specs[i].split };
        for (var k in base) pg[k] = base[k];
        if (!origBlob) pg.orig = null;
        outs.push(pg);
      }
      if (flat.flat !== cvs) freeCv(flat.flat);
      return outs;
    } finally { freeCv(cvs); }
  }

  function addFiles(files, kind, replaceId) {     // 한 장씩 순서대로 줄이고(자동이면 펴고·보정하고) 저장
    if (!S || !files || !files.length) return Promise.resolve();     // O-0576: 닫힌 뒤 change 가 와도 예외 없음
    var mine = S;                                 // O-0576: 이 정리를 시작한 세션 — 바뀌면 즉시 멈춘다
    var room = DSC_MAX_PAGES - S.pages.length;
    if (replaceId == null) {
      if (room <= 0) { toast('이미 ' + DSC_MAX_PAGES + '쪽입니다. 더 담을 수 없습니다.'); return Promise.resolve(); }
      if (files.length > room) { toast(DSC_MAX_PAGES + '쪽까지만 담을 수 있어 앞의 ' + room + '장만 담습니다.', null, null, 6000); files = files.slice(0, room); }
    }
    S.busy = true; S.skipAuto = false;
    var bad = 0, i = 0, n = files.length, added = 0, useAuto = false, quota = false, okFiles = 0, lastErr = null;
    var pre;
    if (S.opts.auto && !cvReady() && cvLib()) {     // O-0586: 불러오는 동안 진행 카드 + [건너뛰기]
      S.prog = { i: 0, n: n, label: '자동 보정 준비', auto: false, loading: true, text: '자동 보정을 준비하는 중입니다… (처음 한 번 몇 초 걸립니다)' }; paintProgress();
      pre = new Promise(function (res) { mine.skipCv = function () { mine.skipCv = null; res(false); }; ensureCv().then(function (ok) { mine.skipCv = null; res(ok); }); });
    } else pre = S.opts.auto ? ensureCv() : Promise.resolve(false);
    return pre.then(function (ok) {
      if (S !== mine) return;
      useAuto = !!ok && !!S.set; var cfg = useAuto ? JSON.parse(JSON.stringify(S.set)) : null;
      if (replaceId != null && cfg) cfg.two = false;                       // 다시 찍은 한 장은 나누지 않는다
      function step() {
        if (i >= n || S !== mine || quota) return Promise.resolve();
        var auto = useAuto && !S.skipAuto;
        S.prog = { i: i + 1, n: n, label: '사진 정리 중', auto: useAuto, text: useAuto ? n + '장 중 ' + (i + 1) + '장 정리 중' : null }; paintProgress();
        var f = files[i], job;
        if (auto && !(cfg.mode === 'orig' && !cfg.auto && !cfg.two)) job = autoPage(f, cfg, mine).catch(function (e) { if (e && e.message === BAD) throw e; return plainPage(f, 'skip'); });
        else job = plainPage(f, useAuto ? (auto ? 'off' : 'skip') : null);
        return job.then(function (pgs) {
          if (S !== mine || !pgs) return;
          okFiles++;
          if (replaceId == null && pgs.length > 1 && S.pages.length + added + pgs.length > DSC_MAX_PAGES) { okFiles--; bad++; toast('두 쪽을 담을 자리가 모자랍니다. 이 사진은 건너뜁니다.', null, null, 6000); return; }
          if (replaceId != null) { var pr0 = store.replacePage(replaceId, pgs[0]); pendingSave = pr0.then(function () {}, function () {}); return pr0; }
          var chain = Promise.resolve();
          pgs.forEach(function (pg) {
            chain = chain.then(function () {
              if (S !== mine) return;
              if (S.pages.length + added >= DSC_MAX_PAGES) { if (!S.capNote) { S.capNote = true; toast('최대 ' + DSC_MAX_PAGES + '쪽까지만 담을 수 있어 나머지는 담지 않았습니다.', null, null, 6000); } return; }
              added++; var pr = store.addPage(pg, kind); pendingSave = pr.then(function () {}, function () {}); return pr;
            });
          });
          return chain;
        }).catch(function (e) { bad++; okFiles--; lastErr = e; if (isQuota(e)) quota = true; })
          .then(function () { i++; return tick().then(step); });
      }
      return step();
    }).then(function () { if (S === mine) return refresh(); }).then(function () {
      if (S !== mine) return;
      S.busy = false; S.prog = null; S.screen = 'list'; render();
      if (quota) toast(replaceId != null ? QUOTA_MSG : '저장 공간이 부족해 ' + n + '장 중 ' + okFiles + '장만 담았습니다. 불필요한 파일을 지운 뒤 다시 시도해 주세요.', null, null, 8000);
      else if (bad && bad === n) toast(n > 1 || !lastErr || !lastErr.message ? '사진을 읽지 못했습니다. 사진 파일인지 확인해 주세요.' : storageMsg(lastErr, '사진을 읽지 못했습니다. 사진 파일인지 확인해 주세요.'));
      else if (bad) toast(bad + '장은 넣지 못했습니다.', null, null, 6000);
    });
  }
  function paintProgress() {
    if (!S) return;
    var el = S.body.querySelector('.dsc-prog');
    if (!el) { render(); el = S.body.querySelector('.dsc-prog'); }
    if (!el || !S.prog) return;
    el.querySelector('span').textContent = S.prog.text || (S.prog.label + ' ' + S.prog.i + ' / ' + S.prog.n);
    el.querySelector('i').style.width = Math.round(S.prog.i / S.prog.n * 100) + '%';
    var sk = el.querySelector('.dsc-skip');
    if (sk) { sk.style.display = (S.prog.auto && !S.skipAuto) || S.prog.loading ? '' : 'none'; }
  }
  function progCard() {
    var c = h('div', 'dsc-card dsc-prog'), b = h('div', 'dsc-bar');
    c.appendChild(h('span', '', '')); b.appendChild(h('i')); c.appendChild(b);
    var sk = h('button', 'dsc-btn dsc-skip', '자동 처리 건너뛰기', function () {
      if (!S) return;
      if (S.prog && S.prog.loading) { if (S.skipCv) S.skipCv(); toast('자동 보정 없이 원본으로 진행합니다.', null, null, 4000); return; }   // O-0586
      S.skipAuto = true; paintProgress(); toast('남은 쪽은 원본으로 처리합니다.', null, null, 4000);
    });
    sk.style.display = 'none'; sk.setAttribute('aria-label', '자동 처리 건너뛰기: 남은 쪽을 원본으로 처리'); c.appendChild(sk);
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
    return Promise.resolve().then(fn).catch(function (e) { if (S === mine) toast(storageMsg(e, '처리하지 못했습니다.')); })
      .then(function () { if (S === mine) return refresh(); }).then(function () { if (S === mine) { S.busy = false; render(); return true; } return false; });
  }
  function retake(id) {
    if (!S || S.busy) return;
    var mine = S;
    pageSource('camera').then(function (fs) {
      if (S !== mine || !fs.length) return;
      return addFiles([fs[0]], 'camera', id);      // O-0583: 한 장 처리(자동 보정 포함) 후 그 쪽을 통째로 바꾼다
    }).catch(function () {});
  }

  /* 썸네일(64px 표시용 128px) — 한 장씩 만들어 objectURL 로 캐시 */
  function thumbKey(p) { return p.id + ':' + p.size + ':' + p.w + 'x' + p.h + ':' + (p.v || 0); }
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
  function clearFoot() { S.foot.className = 'dsc-foot'; S.foot.textContent = ''; S.foot.style.display = 'none'; }
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
    if (S.prog) { setTop(RCP() ? '영수증 스캔' : '사진 정리'); col.appendChild(progCard()); paintProgress(); return; }
    if (RCP()) { (S.screen === 'rcptprev' && S.rcpt ? rRcptPrev : rRcptStart)(col); return; }   // v9.26: 영수증 한 장(쪽 저장소를 쓰지 않는다)
    ({ start: rStart, list: rList, name: rName, result: rResult, edit: S.ed ? rEdit : rList }[S.screen] || rStart)(col);
  }
  function memNote(col) { if (S.mem) col.appendChild(h('div', 'dsc-warn', '이 기기에서는 임시 저장을 쓸 수 없어, 앱을 닫으면 사라집니다.')); }

  /* ───────── v9.26 영수증 한 장 (purpose:'receipt') ─────────
   * 쪽 저장소(문서 세션)를 건드리지 않는다: 한 장을 같은 자동 처리(autoPage)로 펴고 → 미리보기 → [이 사진 사용] 이면 보정된 JPEG 한 장을 onDone(file, info) 로 넘기고 닫는다.
   * 문서·회의 동작은 그대로(purpose 가 receipt 일 때만 이 길). 펴기·보정 본체는 문서 스캔과 같은 autoPage/finishOut 하나. */
  function RCP() { return !!(S && S.opts.purpose === 'receipt'); }
  function rcptFile(blob) { var d = new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14); return new File([blob], 'receipt_' + d + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }); }
  function rcptFree() { if (S && S.rcpt && S.rcpt.url) { try { URL.revokeObjectURL(S.rcpt.url); } catch (e) {} } }
  function rcptShoot(kind) {                       // kind: 'camera' | 'gallery'(앱이 onGallery 를 안 주었을 때만 쓰는 대체)
    if (!S || S.busy) return;
    var mine = S;
    pageSource(kind).then(function (fs) { if (S === mine && fs && fs.length) return rcptProcess(fs[0], fs.length > 1); }).catch(function () {});
  }
  function rcptProcess(file, extra) {
    var mine = S; S.busy = true; S.skipAuto = false;
    S.prog = { i: 1, n: 1, label: '영수증 정리 중', auto: false, text: '영수증을 정리하는 중입니다…' }; paintProgress();
    var pre = S.opts.auto ? ensureCv() : Promise.resolve(false);
    return pre.then(function (ok) {
      if (S !== mine) return null;
      if (ok) { S.prog.auto = true; S.prog.text = '테두리를 찾아 반듯하게 펴는 중입니다…'; paintProgress(); }
      var job = ok ? autoPage(file, { mode: 'doc', auto: true, two: false, rtl: false, q: 'normal' }, mine).catch(function (e) { if (e && e.message === BAD) throw e; return shrink(file).then(function (r) { r.how = 'skip'; return [r]; }); })
                   : shrink(file).then(function (r) { r.how = 'skip'; return [r]; });
      return job;
    }).then(function (pgs) {
      if (S !== mine || !pgs || !pgs.length) return;
      var pg = pgs[0], blob = pg.out || pg.blob;
      rcptFree();
      S.rcpt = { blob: blob, w: pg.w, h: pg.h, how: pg.how, corners: !!pg.corners, url: URL.createObjectURL(blob), extra: !!extra };
      S.busy = false; S.prog = null; S.screen = 'rcptprev'; render();
      if (extra) toast('고르신 사진 중 첫 장만 씁니다.', null, null, 4000);
    }).catch(function (e) {
      if (S !== mine) return;
      S.busy = false; S.prog = null; S.screen = 'start'; render();
      toast(storageMsg(e, '사진을 읽지 못했습니다. 사진 파일인지 확인해 주세요.'));
    });
  }
  function rcptGallery() {
    if (!S || S.busy) return;
    var cb = S.opts.onGallery;
    if (!cb) return rcptShoot('gallery');
    var s = S; s.doneCalled = true; closeUi(false, false);   // 닫은 뒤 앱의 기존 「사진 고르기」(#photoInput)를 같은 눌림 안에서 연다
    try { cb(); } catch (e) {}
  }
  function rcptUse() {
    if (!S || S.busy || !S.rcpt) return;
    var r = S.rcpt, cb = S.opts.onDone, file = rcptFile(r.blob), info = { pages: 1, bytes: r.blob.size, w: r.w, h: r.h, how: r.how, corners: r.corners };
    S.doneCalled = true; closeUi(false, false);
    if (cb) cb(file, info);
  }
  function rRcptStart(col) {
    setTop('영수증 스캔');
    col.appendChild(h('div', 'dsc-sub', '영수증을 평평한 곳에 놓고 한 장 찍으면 테두리를 찾아 반듯하게 펴 드립니다. 한 번에 한 장입니다.'));
    col.appendChild(h('button', 'dsc-btn dsc-pri dsc-big', '📷 영수증 찍기', function () { rcptShoot('camera'); }));
    col.appendChild(h('button', 'dsc-btn dsc-big', '🖼 사진 불러오기', rcptGallery));
    col.appendChild(h('div', 'dsc-sub', '미리 찍어 둔 사진은 [사진 불러오기]로 고르실 수 있습니다.'));
    if (S.opts.auto && S.cvOk === false) col.appendChild(h('div', 'dsc-warn', '자동 보정을 쓸 수 없어 찍은 그대로 줄여서 씁니다.'));
  }
  function rRcptPrev(col) {
    setTop('영수증 스캔', function () { rcptFree(); S.rcpt = null; S.screen = 'start'; render(); });
    var r = S.rcpt, c = h('div', 'dsc-card dsc-item');
    var im = h('img', 'dsc-rcpt-img'); im.src = r.url; im.alt = '정리된 영수증 사진'; c.appendChild(im);
    c.appendChild(h('div', 'dsc-sub', (r.corners ? '테두리를 찾아 펴고 보정했습니다' : (r.how === 'skip' || r.how === 'off' ? '찍은 그대로 줄였습니다' : '테두리를 찾지 못해 전체를 보정했습니다')) + ' · ' + mb(r.blob.size)));
    col.appendChild(c);
    col.appendChild(h('button', 'dsc-btn dsc-big', '📷 다시 찍기', function () { rcptShoot('camera'); }));
    col.appendChild(h('button', 'dsc-btn dsc-big', '🖼 사진 불러오기', rcptGallery));
    foot([h('button', 'dsc-btn dsc-pri', '이 사진 사용', rcptUse)]);
  }

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
    chips(col);
    col.appendChild(h('div', 'dsc-sub', '종이 문서를 한 쪽씩 사진으로 찍어 PDF 한 파일로 만듭니다. 최대 ' + DSC_MAX_PAGES + '쪽.'));
    col.appendChild(h('button', 'dsc-btn dsc-pri dsc-big', '📷 카메라로 찍기', shoot));
    col.appendChild(h('button', 'dsc-btn dsc-big', '🖼 사진 여러 장 고르기', gallery));
    col.appendChild(h('div', 'dsc-sub', '찍은 사진은 폰 사진첩에도 남을 수 있습니다.'));   // O-0576
    memNote(col);
  }

  /* ── O-0583 설정 칩(시작·목록 화면 위쪽) ── */
  function seg(label, items, cur, onPick, name) {   // 라벨 + 선택 단추들(라디오처럼). items=[[값,글]]
    var row = h('div', 'dsc-chiprow'), g = h('div', 'dsc-seg'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', name || label);
    row.appendChild(h('span', 'dsc-chiplab', label));
    items.forEach(function (it) {
      var b = h('button', 'dsc-chip' + (it[0] === cur ? ' dsc-on' : ''), it[1], function () { onPick(it[0]); });
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', it[0] === cur ? 'true' : 'false'); g.appendChild(b);
    });
    row.appendChild(g); return row;
  }
  function chipsBox() {
    var box = h('div', 'dsc-card dsc-set'); box.setAttribute('aria-label', '자동 보정 설정');
    function redo() { var nb = chipsBox(); if (box.parentNode) box.parentNode.replaceChild(nb, box); }
    function pick(k, v) { S.set[k] = v; saveSet(); redo(); }
    box.appendChild(seg('보정', DSC_MODES, S.set.mode, function (v) { pick('mode', v); }, '보정 모드'));
    var r2 = h('div', 'dsc-chiprow'), tg = h('button', 'dsc-chip dsc-tog' + (S.set.auto ? ' dsc-on' : ''), S.set.auto ? '자동 테두리 켜짐' : '자동 테두리 꺼짐', function () { pick('auto', !S.set.auto); });
    tg.setAttribute('role', 'switch'); tg.setAttribute('aria-checked', S.set.auto ? 'true' : 'false'); r2.appendChild(h('span', 'dsc-chiplab', '테두리')); r2.appendChild(tg); box.appendChild(r2);
    box.appendChild(seg('쪽', [['one', '한 쪽'], ['two', '두 쪽(펼친 책)']], S.set.two ? 'two' : 'one', function (v) { pick('two', v === 'two'); }, '한 쪽 또는 두 쪽'));
    if (S.set.two) box.appendChild(seg('순서', [['ltr', '왼쪽부터'], ['rtl', '오른쪽부터']], S.set.rtl ? 'rtl' : 'ltr', function (v) { pick('rtl', v === 'rtl'); }, '읽는 순서'));
    return box;
  }
  function chips(col) { if (autoOn()) col.appendChild(chipsBox()); }

  /* ── 쪽 상태 글 ── */
  function statusText(p) {
    if (p.how === 'manual') return '직접 자름';
    if (p.corners) return '자동으로 잘랐습니다';
    if (p.how === 'none') return '테두리 확인';
    if (p.how === 'edge' || p.how === 'paper') return '전체 사용';
    return '원본';
  }
  function ibtn(icon, txt, label, fn, dis) {         // 아이콘 단추: 위에 아이콘, 아래 짧은 글(터치 영역 44px 이상)
    var b = h('button', 'dsc-btn dsc-ib'); b.appendChild(h('span', 'dsc-ic', icon)); b.appendChild(h('span', 'dsc-it', txt));
    b.setAttribute('aria-label', label); b.addEventListener('click', fn); if (dis) b.disabled = true; return b;
  }
  function estBytes() {                              // 선택한 화질의 예상 용량 — 쪽 크기로 어림한다(시험값 기준, REPORT_B2)
    var qk = (S.opts.auto && S.set) ? S.set.q : 'normal', t = 0;
    S.pages.forEach(function (p) {
      var side = Math.max(p.w || 0, p.h || 0), f = 1;
      if (qk === 'high') f = !p.hasOrig ? 1 : (side >= 1950 ? 1.8 : 1.25);
      else if (qk === 'small') f = side <= 1400 ? 0.9 : Math.pow(1400 / side, 2) * 0.85;
      t += (p.size || 0) * f;
    });
    return Math.round(t * 1.02);
  }

  function rList(col) {
    var n = S.pages.length;
    setTop('쪽 목록 · ' + n + '쪽', function () { closeUi(false, true); });
    chips(col);
    if (!n) { col.appendChild(h('div', 'dsc-card', '아직 쪽이 없습니다.')); }
    if (n > DSC_SLOW_PAGES) col.appendChild(h('div', 'dsc-warn', '쪽이 많아 정리에 시간이 더 걸립니다.'));
    memNote(col);
    var imgs = [], cvOk = cvUsable();
    S.pages.forEach(function (p, i) {
      var it = h('div', 'dsc-card dsc-item'), hd = h('div', 'dsc-item-h'), im = h('img', 'dsc-thumb');
      im.alt = ''; im.src = BLANK; imgs.push({ img: im, p: p, no: i + 1 });   // O-0576
      hd.appendChild(im);
      var t = h('div', 'dsc-info'), ln = h('div', 'dsc-line');
      ln.appendChild(h('span', 'dsc-num', (i + 1) + '쪽'));
      if (S.opts.auto) {
        var st = statusText(p);
        if (st === '테두리 확인' && cvOk) { var wb = h('button', 'dsc-badge', st, function () { openEdit(p); }); wb.setAttribute('aria-label', '테두리 확인: 자르기 화면 열기'); ln.appendChild(wb); }
        else ln.appendChild(h('span', 'dsc-st' + (st === '테두리 확인' ? ' dsc-stw' : ''), st));
        ln.appendChild(h('span', 'dsc-st', modeLabel(p.mode)));
      }
      t.appendChild(ln); t.appendChild(h('div', 'dsc-sub', mb(p.size || 0)));
      hd.appendChild(t); it.appendChild(hd);
      var tl = h('div', 'dsc-tools2');
      var up = ibtn('▲', '위로', '위로', function () { act(function () { return store.movePage(p.id, -1); }); }, i === 0);
      var dn = ibtn('▼', '아래로', '아래로', function () { act(function () { return store.movePage(p.id, 1); }); }, i === n - 1);
      tl.appendChild(up); tl.appendChild(dn);
      if (S.opts.auto && cvOk) {
        tl.appendChild(ibtn('✂', '자르기', '자르기', function () { openEdit(p); }));
        tl.appendChild(ibtn('🎨', '보정', '보정', function () { openLook(p); }));
      }
      tl.appendChild(ibtn('↻', '돌리기', '시계 방향으로 돌리기', function () { act(function () { return store.rotatePage(p.id); }); }));
      tl.appendChild(ibtn('📷', '다시 찍기', '다시 찍기', function () { retake(p.id); }));
      tl.appendChild(ibtn('🗑', '삭제', '이 쪽 빼기', function () {
        act(function () { return store.removePage(p.id); }).then(function (ran) {
          if (ran) toast((i + 1) + '쪽을 뺐습니다.', '되돌리기', function () { act(function () { return store.restoreRemoved(); }); }, 7000);
        });
      }));
      it.appendChild(tl); col.appendChild(it);
    });
    var more = h('div', 'dsc-row');
    more.appendChild(h('button', 'dsc-btn', '📷 한 장 더', shoot));
    more.appendChild(h('button', 'dsc-btn', '🖼 사진 여러 장 고르기', gallery));
    col.appendChild(more);
    if (S.opts.auto && cvOk && n) col.appendChild(h('div', 'dsc-sub', '원본으로 되돌리려면 🎨 보정에서 [원본]을 고른 뒤, ✂ 자르기에서 [전체]를 눌러 적용하세요.'));
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
    var est = h('div', 'dsc-sub dsc-est', '');
    function paintEst() { est.textContent = '쪽 수 ' + S.pages.length + '쪽 · 예상 용량 약 ' + mb(estBytes()) + ' · 끝에 .pdf 가 붙습니다'; }
    paintEst();
    if (S.opts.auto && S.set) {                    // O-0583: PDF 화질
      var qrow = seg('PDF 화질', [['normal', '보통(권장)'], ['high', '높음'], ['small', '작게']], S.set.q, function (v) { S.set.q = v; saveSet(); render(); }, 'PDF 화질');
      qrow.className += ' dsc-qrow'; c.appendChild(qrow);
      c.appendChild(h('div', 'dsc-sub', S.set.q === 'high' ? '긴 변 2400 · 화질 0.88 — 용량이 커집니다(원본이 있는 쪽만).' : S.set.q === 'small' ? '긴 변 1400 · 화질 0.70 — 용량이 작아집니다.' : '긴 변 2000 · 화질 0.80'));
    }
    c.appendChild(est);
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

  /* ───────── ✂ 자르기 편집 화면 (O-0583) ───────── */
  var HANDLE_NAMES = ['왼쪽 위 모서리', '오른쪽 위 모서리', '오른쪽 아래 모서리', '왼쪽 아래 모서리'];
  function cp(p) { return { x: p.x, y: p.y }; }
  function fullQuad(w, h) { return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; }
  function leaveEdit() {
    if (!S) return;
    if (S.ed) { freeCv(S.ed.cvs); S.ed = null; }
    S.screen = 'list'; S.busy = false; render();
  }
  function openEdit(p) {
    if (!S || S.busy || !cvUsable()) return;
    var mine = S; S.busy = true;
    store.getRec(p.id).then(function (r) {
      if (!r) throw new Error('쪽을 찾지 못했습니다.');
      return prepCanvas(r.orig || outOf(r), 100000).then(function (cvs) {
        if (S !== mine) { freeCv(cvs); return; }
        var ow = cvs.width, oh = cvs.height;
        var cr = (r.orig && r.corners) ? r.corners.map(cp) : ((r.orig && r.cand) ? r.cand.map(cp) : fullQuad(ow, oh));
        S.ed = { id: p.id, rec: r, cvs: cvs, ow: ow, oh: oh, corners: cr, hasSplit: !!r.split, newSplit: false, pos: r.split ? r.split.pos : 0.5, side: r.split ? r.split.side : null };
        S.busy = false; S.screen = 'edit'; render();
      });
    }).catch(function (e) { if (S === mine) { S.busy = false; toast(e && e.message || '자르기 화면을 열지 못했습니다.'); } });
  }
  function rEdit(col) {
    var ed = S.ed;
    setTop('자르기 · ' + (S.pages.map(function (q) { return q.id; }).indexOf(ed.id) + 1) + '쪽', function () { if (S.busy) return; leaveEdit(); });
    var availW = Math.min(S.body.clientWidth - 28 || 340, 560), availH = Math.max(240, (window.innerHeight || 700) - 330);
    var sc = Math.min(availW / ed.ow, availH / ed.oh), dw = Math.round(ed.ow * sc), dh = Math.round(ed.oh * sc);
    if (ed.rec && ed.rec.rot) col.appendChild(h('div', 'dsc-sub', '돌리기 전 원본 방향으로 보여 드립니다.'));   // O-0586
    col.appendChild(h('div', 'dsc-sub', '네 모서리의 둥근 점을 손가락으로 끌어 문서 테두리에 맞춘 뒤 [적용]을 누르세요.'));
    var stage = h('div', 'dsc-stage'); stage.style.width = dw + 'px'; stage.style.height = dh + 'px';
    ed.cvs.style.width = dw + 'px'; ed.cvs.style.height = dh + 'px'; ed.cvs.className = 'dsc-stage-img'; stage.appendChild(ed.cvs);
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'dsc-svg'); svg.setAttribute('width', dw); svg.setAttribute('height', dh); svg.setAttribute('viewBox', '0 0 ' + dw + ' ' + dh);
    var shade = document.createElementNS(NS, 'path'), poly = document.createElementNS(NS, 'polygon'), sline = document.createElementNS(NS, 'line');
    shade.setAttribute('fill', 'rgba(15,23,42,0.45)'); shade.setAttribute('fill-rule', 'evenodd');
    poly.setAttribute('fill', 'rgba(59,130,246,0.14)'); poly.setAttribute('stroke', '#3B82F6'); poly.setAttribute('stroke-width', '2.5');
    sline.setAttribute('stroke', '#F59E0B'); sline.setAttribute('stroke-width', '3'); sline.setAttribute('stroke-dasharray', '8 5');
    svg.appendChild(shade); svg.appendChild(poly); svg.appendChild(sline); stage.appendChild(svg);
    var hds = [], sph = null, loupe = h('canvas', 'dsc-loupe'); loupe.width = 96; loupe.height = 96; loupe.style.display = 'none';
    function lineAt(t) {                           // 나누는 선의 윗점·아랫점(화면 좌표) — 위 변·아래 변 위의 같은 비율 지점
      var c = ed.corners, top = { x: c[0].x + (c[1].x - c[0].x) * t, y: c[0].y + (c[1].y - c[0].y) * t }, bot = { x: c[3].x + (c[2].x - c[3].x) * t, y: c[3].y + (c[2].y - c[3].y) * t };
      return [top, bot];
    }
    function place() {
      var c = ed.corners, pts = c.map(function (q) { return (q.x * sc) + ',' + (q.y * sc); }).join(' ');
      poly.setAttribute('points', pts);
      shade.setAttribute('d', 'M0,0H' + dw + 'V' + dh + 'H0Z M' + c.map(function (q) { return (q.x * sc) + ',' + (q.y * sc); }).join(' L') + 'Z');
      hds.forEach(function (e, i) { e.style.left = (c[i].x * sc) + 'px'; e.style.top = (c[i].y * sc) + 'px'; });
      if (sph) {
        var l = lineAt(ed.pos), m = { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2 };
        sline.setAttribute('x1', l[0].x * sc); sline.setAttribute('y1', l[0].y * sc); sline.setAttribute('x2', l[1].x * sc); sline.setAttribute('y2', l[1].y * sc);
        sph.style.left = (m.x * sc) + 'px'; sph.style.top = (m.y * sc) + 'px';
      }
      sline.style.display = sph ? '' : 'none';
    }
    function showLoupe(pt) {                        // 점 위쪽 확대경(3배)
      var px = pt.x * sc, py = pt.y * sc, sz = 96 / (3 * sc), x = loupe.getContext('2d');
      x.clearRect(0, 0, 96, 96); x.fillStyle = '#fff'; x.fillRect(0, 0, 96, 96);
      try { x.drawImage(ed.cvs, pt.x - sz / 2, pt.y - sz / 2, sz, sz, 0, 0, 96, 96); } catch (e) {}
      x.strokeStyle = '#ef4444'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(48, 36); x.lineTo(48, 60); x.moveTo(36, 48); x.lineTo(60, 48); x.stroke();
      var left = Math.max(0, Math.min(dw - 96, px - 48)), top = py - 44 - 96 - 8; if (top < 0) top = py + 44 + 8;
      loupe.style.left = left + 'px'; loupe.style.top = top + 'px'; loupe.style.display = 'block';
    }
    function bind(el, onMove, getPt) {
      var gx = 0, gy = 0, on = false;
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault(); on = true; try { el.setPointerCapture(e.pointerId); } catch (x) {}
        var r = stage.getBoundingClientRect(), pt = getPt(); gx = (e.clientX - r.left) / sc - pt.x; gy = (e.clientY - r.top) / sc - pt.y; showLoupe(pt);
      });
      el.addEventListener('pointermove', function (e) {
        if (!on) return; e.preventDefault();
        var r = stage.getBoundingClientRect(); onMove((e.clientX - r.left) / sc - gx, (e.clientY - r.top) / sc - gy); place(); showLoupe(getPt());
      });
      function end() { on = false; loupe.style.display = 'none'; }
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    }
    ed.corners.forEach(function (q, i) {
      var e = h('div', 'dsc-hd'); e.setAttribute('role', 'slider'); e.setAttribute('aria-label', HANDLE_NAMES[i]); e.appendChild(h('i'));
      bind(e, function (x, y) { ed.corners[i] = { x: Math.max(0, Math.min(ed.ow, x)), y: Math.max(0, Math.min(ed.oh, y)) }; }, function () { return ed.corners[i]; });
      stage.appendChild(e); hds.push(e);
    });
    function makeSplitHandle() {
      if (sph) return;
      sph = h('div', 'dsc-hd dsc-sph'); sph.setAttribute('role', 'slider'); sph.setAttribute('aria-label', '두 쪽으로 나누는 선'); sph.appendChild(h('i'));
      bind(sph, function (x, y) {
        var c = ed.corners, a = { x: (c[0].x + c[3].x) / 2, y: (c[0].y + c[3].y) / 2 }, b = { x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2 };
        var dx = b.x - a.x, dy = b.y - a.y, t = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1);
        ed.pos = Math.max(0.1, Math.min(0.9, t));
      }, function () { var l = lineAt(ed.pos); return { x: (l[0].x + l[1].x) / 2, y: (l[0].y + l[1].y) / 2 }; });
      stage.appendChild(sph);
    }
    stage.appendChild(loupe);
    if (ed.hasSplit) makeSplitHandle();
    col.appendChild(stage);
    var info = h('div', 'dsc-sub dsc-spinfo');
    function paintInfo() { info.textContent = ed.hasSplit ? '주황 점선이 두 쪽으로 나누는 선입니다. 가운데 점을 좌우로 끌어 맞추세요. 적용하면 두 쪽이 됩니다.' : ''; info.style.display = ed.hasSplit ? '' : 'none'; }
    paintInfo(); col.appendChild(info);
    var spBtn = h('button', 'dsc-btn dsc-spbtn', '📖 두 쪽으로 나누기', function () {
      if (S.pages.length >= DSC_MAX_PAGES) return toast('최대 ' + DSC_MAX_PAGES + '쪽까지입니다. 나눌 수 없습니다.');
      var f = flatOf(ed.cvs, { corners: isFullQuad(ed.corners, ed.ow, ed.oh) ? null : ed.corners }, 800);
      ed.pos = DocScanCV.findSpine(f.flat).pos; if (f.flat !== ed.cvs) freeCv(f.flat);
      ed.hasSplit = true; ed.newSplit = true; ed.side = S.set && S.set.rtl ? 'R' : 'L'; makeSplitHandle(); place(); paintInfo(); spBtn.style.display = 'none';
    });
    if (ed.hasSplit) spBtn.style.display = 'none';
    col.appendChild(spBtn);
    place();
    foot([
      h('button', 'dsc-btn', '자동 찾기', function () { editAuto(place); }),
      h('button', 'dsc-btn', '전체', function () { ed.corners = fullQuad(ed.ow, ed.oh); place(); }),
      h('button', 'dsc-btn dsc-pri', '적용', applyEdit),
      h('button', 'dsc-btn', '취소', function () { if (S.busy) return; leaveEdit(); })
    ]);
    S.foot.className = 'dsc-foot dsc-foot4';
  }
  function editAuto(place) {                       // 재감지
    var ed = S.ed, mine = S; if (!ed || S.busy) return;
    S.busy = true; toast('테두리를 찾는 중입니다…', null, null, 3000);
    DocScanCV.detect(ed.cvs).then(function (d) {
      if (S !== mine || S.ed !== ed) return;
      S.busy = false;
      if (d.ok && d.score >= DocScanCV.DSCV_MIN_SCORE && d.how !== 'none') { ed.corners = d.corners.map(cp); place(); toast('테두리를 찾았습니다. 점을 확인해 주세요.'); }
      else if (d.candidate && d.candidate.corners) { ed.corners = d.candidate.corners.map(cp); place(); toast('확실하지 않은 후보입니다. 점을 확인해 주세요.'); }
      else toast('테두리를 찾지 못했습니다. 점을 끌어 맞춰 주세요.');
    }, function () { if (S === mine) { S.busy = false; toast('테두리를 찾지 못했습니다.'); } });
  }
  function applyEdit() {
    var ed = S && S.ed, mine = S; if (!ed || S.busy) return;
    var cr = ed.corners.map(function (q) { return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }; });
    if (!quadValid(cr)) return toast('네 점이 꼬여 있습니다. 점을 다시 맞춰 주세요.');
    if (ed.newSplit && S.pages.length >= DSC_MAX_PAGES) return toast('최대 ' + DSC_MAX_PAGES + '쪽까지입니다.');
    S.busy = true; toast('적용하는 중입니다…', null, null, 20000);
    (async function () {
      var rec = ed.rec, corners = isFullQuad(cr, ed.ow, ed.oh) ? null : cr, flat = flatOf(ed.cvs, { corners: corners }, ed.hasSplit ? DSC_SPREAD_SIDE : DSC_OUT_SIDE);
      try {
        if (flat.failed) throw new Error('이 모양으로는 펴지지 않습니다. 점을 다시 맞춰 주세요.');
        var origB = rec.orig || outOf(rec), g = rec.split ? rec.split.g : 'm' + Date.now(), targets = [{ id: ed.id, rec: rec, side: ed.side }];
        if (ed.hasSplit && rec.split) {
          var sib = S.pages.filter(function (q) { return q.id !== ed.id && q.split && q.split.g === rec.split.g; })[0];
          if (sib) targets.push({ id: sib.id, rec: await store.getRec(sib.id), side: rec.split.side === 'L' ? 'R' : 'L' });
        }
        for (var i = 0; i < targets.length; i++) {
          if (S !== mine) return;
          var t = targets[i], mode = t.rec.mode || 'orig', rot = t.rec.rot || 0;
          var oc = finishOut(flat.flat, { split: ed.hasSplit ? { side: t.side, pos: ed.pos } : null, rot: rot }, mode, DSC_OUT_SIDE); await tick();
          var w = oc.width, h2 = oc.height, blob = await encodeOut(oc, mode, 0.80); freeCv(oc);
          if (S !== mine) return;
          await store.updatePage(t.id, { out: blob, w: w, h: h2, orig: t.rec.orig || outOf(t.rec), ow: ed.ow, oh: ed.oh, corners: corners, mode: mode, score: 1, how: 'manual', split: ed.hasSplit ? { g: g, side: t.side, pos: ed.pos } : null, rot: rot });
        }
        if (ed.newSplit) {
          var ns = ed.side === 'L' ? 'R' : 'L', mode2 = rec.mode || 'orig', oc2 = finishOut(flat.flat, { split: { side: ns, pos: ed.pos }, rot: 0 }, mode2, DSC_OUT_SIDE); await tick();
          var w2 = oc2.width, h3 = oc2.height, b2 = await encodeOut(oc2, mode2, 0.80); freeCv(oc2);
          if (S !== mine) return;
          await store.addPage({ out: b2, w: w2, h: h3, orig: origB, ow: ed.ow, oh: ed.oh, corners: corners, mode: mode2, score: 1, how: 'manual', split: { g: g, side: ns, pos: ed.pos }, rot: 0 }, S.kind, ed.id);
        }
        if (S !== mine) return;
        await refresh();
        if (S !== mine) return;
        hideToast(); leaveEdit(); toast(ed.hasSplit ? '두 쪽으로 나누어 적용했습니다.' : '적용했습니다.');
      } catch (e) {
        if (S === mine) { S.busy = false; toast(storageMsg(e, '적용하지 못했습니다.')); }
      } finally { if (flat.flat !== ed.cvs) freeCv(flat.flat); }
    })();
  }


  /* ───────── 🎨 보정 선택 시트 (O-0583) ───────── */
  function closeLook() { if (S && S.sheet) { S.sheet.remove(); S.sheet = null; } }
  function specOf(r, sc) {                          // 레코드 → 처리 설명(모서리는 sc 배율)
    var cr = r.corners ? r.corners.map(function (q) { return { x: q.x * sc, y: q.y * sc }; }) : null;
    return { corners: cr, split: r.split ? { side: r.split.side, pos: r.split.pos } : null, rot: r.rot || 0 };
  }
  /* 한 쪽을 새 모드로 다시 만든다(원본이 없으면 지금 결과를 원본으로 보관) */
  async function reMode(id, mode, mine) {
    var r = await store.getRec(id); if (!r || S !== mine) return;
    var origB = r.orig || outOf(r), src = await prepCanvas(origB, 100000), oc = null;
    try {
      var res = renderOut(src, specOf(r, 1), r.split ? DSC_SPREAD_SIDE : DSC_OUT_SIDE, mode); oc = res.canvas; await tick();
      var w = oc.width, h2 = oc.height, blob = await encodeOut(oc, mode, 0.80);
      if (S !== mine) return;
      var patch = { out: blob, w: w, h: h2, mode: mode };
      if (!r.orig) { patch.orig = origB; patch.ow = src.width; patch.oh = src.height; }
      await store.updatePage(id, patch);
    } finally { freeCv(src); freeCv(oc); }
  }
  function openLook(p) {
    if (!S || S.busy || !cvUsable()) return;
    var mine = S; closeLook(); S.busy = true;
    store.getRec(p.id).then(function (r) {
      if (!r) throw new Error('쪽을 찾지 못했습니다.');
      return prepCanvas(r.orig || outOf(r), 700).then(function (small) {
        if (S !== mine) { freeCv(small); return; }
        var ow = r.ow || small.width, sc = small.width / ow, tiles = [], all = false, cur = r.mode || 'orig';
        var sh = h('div', 'dsc-sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', '보정 선택');
        sh.appendChild(h('b', 'dsc-sheet-t', '보정 선택 · ' + (S.pages.indexOf(p) + 1) + '쪽'));
        var grid = h('div', 'dsc-tiles');
        DSC_MODES.slice().sort(function (a, b) { return (a[0] === 'orig' ? -1 : b[0] === 'orig' ? 1 : 0); }).forEach(function (m) {   // 원본·문서·흑백·회색 순서
          var spec = specOf(r, sc), out = null;
          try { out = renderOut(small, spec, 360, m[0]).canvas; } catch (e) { out = null; }
          var tb = h('button', 'dsc-tile' + (m[0] === cur ? ' dsc-on' : '')); tb.setAttribute('aria-label', m[1] + ' 모드로 바꾸기');
          if (out) { out.className = 'dsc-tile-img'; out.style.width = '100%'; out.style.height = 'auto'; tb.appendChild(out); tiles.push(out); }
          tb.appendChild(h('span', 'dsc-tile-l', m[1]));
          tb.addEventListener('click', function () { doLook(m[0]); });
          grid.appendChild(tb);
        });
        freeCv(small);
        sh.appendChild(grid);
        var sw = h('label', 'dsc-swrow'), cb = h('input'); cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.id = 'dsc-all';
        cb.addEventListener('change', function () { all = cb.checked; });
        sw.appendChild(cb); sw.appendChild(h('span', '', '모든 쪽에 적용')); sh.appendChild(sw);
        sh.appendChild(h('div', 'dsc-sub', '원본으로 되돌리려면 [원본]을 고른 뒤, ✂ 자르기에서 [전체]를 눌러 적용하세요.'));
        sh.appendChild(h('button', 'dsc-btn', '닫기', function () { closeLook(); }));
        S.root.appendChild(sh); S.sheet = sh; S.busy = false;
        function doLook(mode) {
          if (!S || S !== mine || S.busy) return;
          var ids = all ? S.pages.map(function (q) { return q.id; }) : [p.id];
          closeLook(); S.busy = true;
          (async function () {
            var done = 0, fail = 0;
            for (var i = 0; i < ids.length; i++) {
              if (S !== mine) return;
              if (ids.length > 1) { S.prog = { i: i + 1, n: ids.length, label: '보정 중', auto: false, text: ids.length + '장 중 ' + (i + 1) + '장 보정 중' }; paintProgress(); }
              try { await reMode(ids[i], mode, mine); done++; } catch (e) { fail++; }
              await tick();
            }
            if (S !== mine) return;
            await refresh(); if (S !== mine) return;
            S.busy = false; S.prog = null; render();
            toast(fail ? done + '쪽을 바꿨고 ' + fail + '쪽은 바꾸지 못했습니다.' : (all ? '모든 쪽을 ' : '이 쪽을 ') + modeLabel(mode) + ' 모드로 바꿨습니다.');
          })();
        }
      });
    }).catch(function (e) { if (S === mine) { S.busy = false; toast(e && e.message || '보정 화면을 열지 못했습니다.'); } });
  }

  function cleanName(s) {
    s = String(s || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    return (s || (kstDate() + '_문서')) + '.pdf';
  }
  /* O-0583: PDF 에 넣을 그림 한 장. 보통=저장된 결과 그대로, 높음=원본에서 2400·0.88 로 다시 만듦(원본 있는 쪽만), 작게=결과를 1400·0.70 으로 다시 압축 */
  async function pdfPage(id, qk) {
    var rec = await store.getRec(id), out = outOf(rec), Q = DSC_QUALITY[qk] || DSC_QUALITY.normal, same = { blob: out, w: rec.w, h: rec.h };
    if (!rec || qk === 'normal' || !DSC_QUALITY[qk]) return same;
    var c = null, o = null;
    try {
      if (qk === 'high') {
        if (!rec.orig || !cvReady()) return same;
        c = await prepCanvas(rec.orig, 100000);
        o = renderOut(c, { corners: rec.corners || null, split: rec.split ? { side: rec.split.side, pos: rec.split.pos } : null, rot: rec.rot || 0 }, Q.side, rec.mode).canvas;
      } else {
        c = await prepCanvas(out, Q.side); o = c; c = null;
      }
      await tick();
      var w = o.width, h = o.height, b = await encodeOut(o, rec.mode, Q.q);
      if (qk === 'small' && b.size >= out.size) return same;
      return { blob: b, w: w, h: h };
    } finally { freeCv(c); freeCv(o); }
  }
  function makePdf() {
    if (!S || S.busy) return;
    var mine = S;                                 // O-0576: 세션이 바뀌면(닫고 다시 열면) 결과를 버리고 새 세션의 보관은 건드리지 않는다
    S.busy = true; S.making = { i: 0, n: S.pages.length }; render();
    var list = [], t0 = Date.now(), pages = S.pages.slice(), qk = (S.opts.auto && S.set) ? S.set.q : 'normal';
    function gone() { return S !== mine; }
    function paintMaking(i, n) {
      var pc = S.body.querySelector('.dsc-prog');
      if (pc) { pc.querySelector('span').textContent = 'PDF 만드는 중 ' + i + ' / ' + n; pc.querySelector('i').style.width = Math.round(i / n * 100) + '%'; }
    }
    pages.reduce(function (p, pg, idx) {
      return p.then(function () {
        if (gone()) throw new Error('cancel');
        return pdfPage(pg.id, qk).then(function (r) { list.push(r); if (qk !== 'normal' && !gone()) { S.making = { i: idx + 1, n: pages.length }; paintMaking(idx + 1, pages.length); } return tick(); });
      });
    }, Promise.resolve()).then(function () {
      return buildPdf(list, function (i, n) {
        if (gone()) return;
        S.making = { i: i, n: n }; paintMaking(i, n);
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
    if (S.sheet) { history.pushState({ dsc: 1 }, ''); closeLook(); return; }   // O-0583: 보정 시트만 닫는다
    if (S.screen === 'edit' && !S.busy) { history.pushState({ dsc: 1 }, ''); leaveEdit(); return; }   // O-0583: 자르기 화면 → 목록
    if (S.busy) { S.pushed = false; closeUi(true, true); return; }          // O-0576: 사진 정리 중 뒤로가기 = ✕ 와 같이 정리를 멈추고 닫는다
    if (RCP() && S.screen === 'rcptprev') { history.pushState({ dsc: 1 }, ''); rcptFree(); S.rcpt = null; S.screen = 'start'; render(); return; }
    if (S.screen === 'name') { history.pushState({ dsc: 1 }, ''); S.screen = 'list'; render(); return; }
    S.pushed = false; closeUi(true, S.screen !== 'result');
  }
  function closeUi(fromPop, cancel) {
    if (!S) return;
    var s = S, cb = s.opts.onCancel; S = null; hideToast(); clearInterval(s.recTimer);
    // O-0576: 리스너는 떼지 않는다(떼면 아래 history.back() 의 popstate 를 못 받아 ignorePop 이 1 남아, 다음에 연 화면의 첫 뒤로가기가 먹히지 않았다)
    Object.keys(s.thumbs).forEach(function (k) { try { URL.revokeObjectURL(s.thumbs[k]); } catch (e) {} });
    if (s.ed) freeCv(s.ed.cvs);
    if (s.rcpt && s.rcpt.url) { try { URL.revokeObjectURL(s.rcpt.url); } catch (e) {} }
    store.commitRemoved();
    s.root.remove();
    if (!fromPop && s.pushed) { ignorePop++; try { history.back(); } catch (e) { ignorePop--; } }
    if (cancel && !s.doneCalled && cb) { try { cb(); } catch (e) {} }
  }

  function open(opts) {
    opts = opts || {};
    if (S) return false;
    ensureStyle();
    var root = h('div', 'dsc-root'); root.id = 'dsc-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', opts.purpose === 'receipt' ? '영수증 스캔' : '문서 스캔');
    var top = h('div', 'dsc-top'), body = h('div', 'dsc-body'), ft = h('div', 'dsc-foot');
    var recEl = h('div', 'dsc-rec', '● 녹음은 계속되고 있습니다'); recEl.style.display = 'none'; recEl.setAttribute('role', 'status');   // O-0576
    root.appendChild(top); root.appendChild(recEl); root.appendChild(body); root.appendChild(ft);
    document.body.appendChild(root);
    S = { opts: opts, recEl: recEl, root: root, top: top, body: body, foot: ft, screen: 'start', pages: [], thumbs: {}, busy: false, token: 0, pushed: false, fname: null, set: opts.auto && opts.purpose !== 'receipt' ? loadSet() : null, cvOk: undefined, ed: null, sheet: null };
    try { history.pushState({ dsc: 1 }, ''); S.pushed = true; if (!popHooked) { popHooked = true; window.addEventListener('popstate', onPop); } } catch (e) {}
    S.busy = true; render();
    var first = S;
    if (opts.auto) ensureCv(!!(cvLib() && cvLib().hasFailed && cvLib().hasFailed())).then(function () { if (S === first && !S.busy && !S.prog && (S.screen === 'start' || S.screen === 'list')) render(); });   // O-0583
    if (opts.isRecording) first.recTimer = setInterval(function () { if (S === first) updRec(); }, 3000);   // O-0576
    if (opts.purpose === 'receipt') { S.pages = []; S.busy = false; S.mem = false; render(); return true; }   // v9.26: 영수증은 쪽 저장소를 건드리지 않는다
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
    clearSession: store.clearSession, getPageBlob: store.getPageBlob, getRec: store.getRec, updatePage: store.updatePage, encodeGrayJpeg: encodeGrayJpeg, QUALITY: DSC_QUALITY,
    isOpen: function () { return !!S; },
    back: function () { if (!S) return false; try { history.back(); } catch (e) { closeUi(true, true); } return true; },   // app.js goBack() 에서 호출 가능
    RECEIPT: 1, KEEP_DAYS: DSC_KEEP_DAYS, MAX_PAGES: DSC_MAX_PAGES
  };
})(window);

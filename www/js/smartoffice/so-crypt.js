/* so-crypt.js — S-Office 문서 암호(O-0861, v10.9): 워드·엑셀·파워포인트 파일에 암호 걸기·풀기
 * 표준 「Agile 암호화」(AES-256-CBC, SHA-512, 반복 100000회)를 브라우저 기본 암호 기능(WebCrypto)으로 직접 구현했다.
 * 암호가 걸린 파일은 복합 문서(CFB) 껍데기 안에 EncryptionInfo·EncryptedPackage 두 줄기로 들어 있다(원래 문서 zip 은 EncryptedPackage 안).
 * 새 외부 부품 없음. 암호는 이 기기 안에서만 쓰고 어디에도 보내거나 저장하지 않는다.
 */
(function (global) {
  'use strict';
  var subtle = (global.crypto && global.crypto.subtle) || null;
  var TE = new TextEncoder(), TD = new TextDecoder('utf-8');
  var SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  var ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD, DIFSECT = 0xFFFFFFFC;
  var NS_ENC = 'http://schemas.microsoft.com/office/2006/encryption', NS_PW = 'http://schemas.microsoft.com/office/2006/keyEncryptor/password', NS_CERT = 'http://schemas.microsoft.com/office/2006/keyEncryptor/certificate';
  var BK_VERIN = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79], BK_VERVAL = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e], BK_KEY = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6];
  var BK_HMACKEY = [0x5f, 0xb2, 0xad, 0x01, 0x0c, 0xb9, 0xe1, 0xf6], BK_HMACVAL = [0xa0, 0x67, 0x7f, 0x02, 0xb2, 0x2c, 0x84, 0x33];

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function u32(v, o) { return (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0; }
  function u16(v, o) { return v[o] | (v[o + 1] << 8); }
  function cat() { var n = 0, a = arguments, i; for (i = 0; i < a.length; i++) n += a[i].length; var o = new Uint8Array(n), p = 0; for (i = 0; i < a.length; i++) { o.set(a[i], p); p += a[i].length; } return o; }
  function le32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
  function rand(n) { var o = new Uint8Array(n); global.crypto.getRandomValues(o); return o; }
  function b64(u8) { var s = '', i, CH = 0x8000; for (i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { var b = atob(s), o = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
  function utf16(s) { var o = new Uint8Array(s.length * 2), i; for (i = 0; i < s.length; i++) { var c = s.charCodeAt(i); o[i * 2] = c & 255; o[i * 2 + 1] = c >> 8; } return o; }
  function fromUtf16(u8, a, n) { var s = '', i; for (i = 0; i + 1 < n; i += 2) s += String.fromCharCode(u8[a + i] | (u8[a + i + 1] << 8)); return s; }
  async function sha512(u8) { return new Uint8Array(await subtle.digest('SHA-512', u8)); }

  // ============================================================ 복합 문서(CFB) 읽기
  function readCfb(u8) {
    if (u8.length < 512) throw fail('cfb', '복합 문서가 아닙니다');
    for (var i = 0; i < 8; i++) if (u8[i] !== SIG[i]) throw fail('cfb', '복합 문서가 아닙니다');
    var ssh = u16(u8, 0x1E), sz = 1 << ssh, mss = 1 << u16(u8, 0x20), cut = u32(u8, 0x38);
    if (sz !== 512 && sz !== 4096) throw fail('cfb', '지원하지 않는 복합 문서입니다');
    function sec(id) { var o = (id + 1) * sz; if (o + sz > u8.length + sz) throw fail('cfb', '복합 문서가 잘렸습니다'); return u8.subarray(o, Math.min(o + sz, u8.length)); }
    var nFat = u32(u8, 0x2C), difat = [], k;
    for (k = 0; k < 109; k++) { var d = u32(u8, 0x4C + k * 4); if (d !== FREESECT) difat.push(d); }
    var dn = u32(u8, 0x48), dp = u32(u8, 0x44);
    while (dn-- > 0 && dp !== ENDOFCHAIN && dp !== FREESECT) { var ds = sec(dp), per = sz / 4 - 1; for (k = 0; k < per; k++) { var x = u32(ds, k * 4); if (x !== FREESECT) difat.push(x); } dp = u32(ds, per * 4); }
    var fat = [];
    difat.slice(0, nFat || difat.length).forEach(function (id) { var s = sec(id); for (var j = 0; j < sz / 4; j++) fat.push(u32(s, j * 4)); });
    function chain(start, tbl) { var out = [], c = start, guard = 0; while (c !== ENDOFCHAIN && c !== FREESECT && c < tbl.length) { out.push(c); c = tbl[c]; if (++guard > 4e6) throw fail('cfb', '복합 문서가 깨졌습니다'); } return out; }
    function readChain(start, size) {
      var ids = chain(start, fat), o = new Uint8Array(ids.length * sz);
      ids.forEach(function (id, i) { var s = sec(id); o.set(s, i * sz); });
      return size == null ? o : o.subarray(0, size);
    }
    var dirBytes = readChain(u32(u8, 0x30), null), ents = [];
    for (k = 0; k + 128 <= dirBytes.length; k += 128) {
      var nl = u16(dirBytes, k + 0x40), e = {
        name: nl >= 2 ? fromUtf16(dirBytes, k, nl - 2) : '', type: dirBytes[k + 0x42], left: u32(dirBytes, k + 0x44), right: u32(dirBytes, k + 0x48), child: u32(dirBytes, k + 0x4C),
        start: u32(dirBytes, k + 0x74), size: u32(dirBytes, k + 0x78)
      };
      ents.push(e);
    }
    var mfat = [];
    if (u32(u8, 0x40) > 0) { var mb = readChain(u32(u8, 0x3C), null); for (k = 0; k + 4 <= mb.length; k += 4) mfat.push(u32(mb, k)); }
    var miniStream = ents[0] && ents[0].size ? readChain(ents[0].start, ents[0].size) : new Uint8Array(0);
    function readEnt(e) {
      if (e.size < cut) { var ids = chain(e.start, mfat), o = new Uint8Array(ids.length * mss); ids.forEach(function (id, i) { o.set(miniStream.subarray(id * mss, id * mss + mss), i * mss); }); return o.subarray(0, e.size); }
      return readChain(e.start, e.size);
    }
    var streams = {};
    (function walk(idx, prefix) {
      if (idx === FREESECT || idx >= ents.length) return;
      var e = ents[idx]; walk(e.left, prefix);
      var path = prefix + e.name;
      if (e.type === 2) streams[path] = readEnt(e); else if (e.type === 1) walk(e.child, path + '/');
      walk(e.right, prefix);
    })(ents[0].child, '');
    return { streams: streams };
  }

  // ============================================================ 복합 문서(CFB) 쓰기 (512바이트 쪽, 작은 줄기는 미니 스트림)
  function writeCfb(list) {                          // list: [{ path:'a/b', data:Uint8Array }]
    var SZ = 512, MSZ = 64, CUT = 4096, i;
    // 디렉터리 트리 만들기
    var root = { name: 'Root Entry', type: 5, kids: {} };
    list.forEach(function (it) {
      var parts = it.path.split('/'), n = root;
      parts.forEach(function (p, idx) {
        if (idx === parts.length - 1) n.kids[p] = { name: p, type: 2, data: it.data, kids: {} };
        else { if (!n.kids[p]) n.kids[p] = { name: p, type: 1, kids: {} }; n = n.kids[p]; }
      });
    });
    var all = [];
    function cmp(a, b) { var x = a.name.toUpperCase(), y = b.name.toUpperCase(); return x.length !== y.length ? x.length - y.length : (x < y ? -1 : (x > y ? 1 : 0)); }
    function assign(n) { n.id = all.length; all.push(n); Object.keys(n.kids).map(function (k) { return n.kids[k]; }).sort(cmp).forEach(function (k) { n._k = n._k || []; n._k.push(k); }); (n._k || []).forEach(assign); }
    assign(root);
    function bst(arr, lo, hi, depth, info) {          // 균형 이진 트리(왼쪽 작은 것)
      if (lo > hi) return -1; var mid = (lo + hi) >> 1, n = arr[mid]; n.depth = depth; info.max = Math.max(info.max, depth);
      n.leftId = bst(arr, lo, mid - 1, depth + 1, info); n.rightId = bst(arr, mid + 1, hi, depth + 1, info); return n.id;
    }
    all.forEach(function (n) {
      if (n._k && n._k.length) { var info = { max: 0 }, c = n._k.length; n.childId = bst(n._k, 0, c - 1, 0, info); var perfect = (c & (c + 1)) === 0; n._k.forEach(function (k) { k.red = !perfect && k.depth === info.max; }); } else n.childId = -1;
    });
    // 줄기 내용 배치
    var miniFat = [], bigs = [];
    all.forEach(function (n) {
      if (n.type !== 2) return; var len = n.data.length;
      if (len < CUT) { n.mini = true; if (len) { var cnt = Math.ceil(len / MSZ), buf = new Uint8Array(cnt * MSZ); buf.set(n.data); n._mb = buf; } }
      else { n.mini = false; bigs.push(n); }
    });
    // 미니 스트림을 바이트로
    var miniParts = [], miniCount = 0;
    all.forEach(function (n) { if (n.type === 2 && n.mini && n._mb) { n.start = miniCount; miniParts.push(n._mb); miniCount += n._mb.length / MSZ; } });
    miniFat = []; var cur = 0;
    all.forEach(function (n) { if (n.type === 2 && n.mini && n._mb) { var c = n._mb.length / MSZ; for (i = 0; i < c; i++) miniFat.push(i === c - 1 ? ENDOFCHAIN : cur + i + 1); cur += c; } });
    var miniBytes = cat.apply(null, miniParts.length ? miniParts : [new Uint8Array(0)]);
    // 쪽 수 계산
    var nDir = Math.ceil(all.length * 128 / SZ), nMiniFat = Math.ceil(miniFat.length * 4 / SZ), nMiniData = Math.ceil(miniBytes.length / SZ);
    var nBig = 0; bigs.forEach(function (n) { n.nsec = Math.ceil(n.data.length / SZ); nBig += n.nsec; });
    var dataSecs = nDir + nMiniFat + nMiniData + nBig, nFat = 1, nDif = 0;
    for (;;) { var total = dataSecs + nFat + nDif, needFat = Math.ceil(total / 128), needDif = needFat > 109 ? Math.ceil((needFat - 109) / 127) : 0; if (needFat === nFat && needDif === nDif) break; nFat = needFat; nDif = needDif; }
    var totalSecs = dataSecs + nFat + nDif, fat = new Array(nFat * 128).fill(FREESECT), pos = 0;
    function mkChain(count) { var s = pos; for (var j = 0; j < count; j++) { fat[pos] = j === count - 1 ? ENDOFCHAIN : pos + 1; pos++; } return s; }
    var dirStart = mkChain(nDir), mfStart = nMiniFat ? mkChain(nMiniFat) : ENDOFCHAIN, msStart = nMiniData ? mkChain(nMiniData) : ENDOFCHAIN;
    bigs.forEach(function (n) { n.start = mkChain(n.nsec); });
    var fatStart = pos; for (i = 0; i < nFat; i++) fat[pos++] = FATSECT;
    var difStart = nDif ? pos : ENDOFCHAIN; for (i = 0; i < nDif; i++) fat[pos++] = DIFSECT;
    // 바이트 쓰기
    var out = new Uint8Array(SZ + totalSecs * SZ), dv = new DataView(out.buffer);
    SIG.forEach(function (b, j) { out[j] = b; });
    dv.setUint16(0x18, 0x3E, true); dv.setUint16(0x1A, 3, true); dv.setUint16(0x1C, 0xFFFE, true); dv.setUint16(0x1E, 9, true); dv.setUint16(0x20, 6, true);
    dv.setUint32(0x28, 0, true); dv.setUint32(0x2C, nFat, true); dv.setUint32(0x30, dirStart, true); dv.setUint32(0x34, 0, true); dv.setUint32(0x38, CUT, true);
    dv.setUint32(0x3C, mfStart, true); dv.setUint32(0x40, nMiniFat, true); dv.setUint32(0x44, difStart, true); dv.setUint32(0x48, nDif, true);
    for (i = 0; i < 109; i++) dv.setUint32(0x4C + i * 4, i < nFat ? fatStart + i : FREESECT, true);
    function put(sector, bytes) { out.set(bytes, SZ + sector * SZ); }
    // 디렉터리
    var dir = new Uint8Array(nDir * SZ), dd = new DataView(dir.buffer), q0;
    for (q0 = 0; q0 < nDir * 4; q0++) { dd.setUint32(q0 * 128 + 0x44, FREESECT, true); dd.setUint32(q0 * 128 + 0x48, FREESECT, true); dd.setUint32(q0 * 128 + 0x4C, FREESECT, true); }   // 안 쓰는 칸은 「가리키는 곳 없음」
    all.forEach(function (n) {
      var o = n.id * 128, nm = utf16(n.name);
      dir.set(nm, o); dd.setUint16(o + 0x40, nm.length + 2, true); dir[o + 0x42] = n.type; dir[o + 0x43] = n.red ? 0 : 1;
      dd.setUint32(o + 0x44, n.leftId == null || n.leftId < 0 ? FREESECT : n.leftId, true); dd.setUint32(o + 0x48, n.rightId == null || n.rightId < 0 ? FREESECT : n.rightId, true);
      dd.setUint32(o + 0x4C, n.childId == null || n.childId < 0 ? FREESECT : n.childId, true);
      var st = 0, size = 0;
      if (n.type === 5) { st = nMiniData ? msStart : ENDOFCHAIN; size = miniBytes.length; }
      else if (n.type === 2) { st = n.mini ? (n._mb ? n.start : ENDOFCHAIN) : n.start; size = n.data.length; if (!size) st = ENDOFCHAIN; }
      dd.setUint32(o + 0x74, st, true); dd.setUint32(o + 0x78, size, true);
    });
    put(dirStart, dir);
    if (nMiniFat) { var mf = new Uint8Array(nMiniFat * SZ).fill(0xFF), md = new DataView(mf.buffer); miniFat.forEach(function (v, j) { md.setUint32(j * 4, v, true); }); put(mfStart, mf); }
    if (nMiniData) { var mb2 = new Uint8Array(nMiniData * SZ); mb2.set(miniBytes); put(msStart, mb2); }
    bigs.forEach(function (n) { var b = new Uint8Array(n.nsec * SZ); b.set(n.data); put(n.start, b); });
    var fb = new Uint8Array(nFat * SZ), fd = new DataView(fb.buffer); fat.forEach(function (v, j) { fd.setUint32(j * 4, v, true); }); put(fatStart, fb);
    for (i = 0; i < nDif; i++) {                       // 109개를 넘는 FAT 쪽 목록
      var db = new Uint8Array(SZ).fill(0xFF), ddv = new DataView(db.buffer);
      for (var j = 0; j < 127; j++) { var fi = 109 + i * 127 + j; if (fi < nFat) ddv.setUint32(j * 4, fatStart + fi, true); }
      ddv.setUint32(127 * 4, i === nDif - 1 ? ENDOFCHAIN : difStart + i + 1, true); put(difStart + i, db);
    }
    return out;
  }

  // ============================================================ AES (WebCrypto 의 PKCS7 를 피해 「패딩 없는 CBC」)
  async function aesKey(raw, usage) { return subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, [usage]); }
  async function aesEnc(key, iv, data) {               // data 는 16의 배수
    var c = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: iv }, key, data)); return c.subarray(0, data.length);
  }
  async function aesDec(encKey, decKey, iv, ct) {      // ct 는 16의 배수. 뒤에 「패딩 블록」을 하나 이어 붙여 풀고 패딩을 떼지 않는다
    var last = ct.subarray(ct.length - 16), pad = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: last }, encKey, new Uint8Array(0))).subarray(0, 16);
    var r = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: iv }, decKey, cat(ct, pad))); return r;
  }
  function pad16(u8) { var n = Math.ceil(u8.length / 16) * 16; if (n === u8.length) return u8; var o = new Uint8Array(n); o.set(u8); return o; }
  async function hashIv(salt, block) { return (await sha512(cat(salt, block))).subarray(0, 16); }
  async function spinHash(salt, pw, spin) {
    var h = await sha512(cat(salt, utf16(pw))), i;
    for (i = 0; i < spin; i++) h = await sha512(cat(le32(i), h));
    return h;
  }
  async function deriveKey(h, block, bits) { var f = await sha512(cat(h, block)), n = bits / 8; if (f.length >= n) return f.subarray(0, n); var o = new Uint8Array(n).fill(0x36); o.set(f); return o; }

  // ============================================================ 암호 걸기
  async function encrypt(pkg, password, opt) {
    if (!subtle) throw fail('nocrypto', '이 기기에서는 암호 기능을 쓸 수 없습니다(보안 연결에서만 동작합니다).');
    password = String(password == null ? '' : password); if (!password) throw fail('empty', '암호를 적어 주십시오.');
    var spin = (opt && opt.spin) || 100000, secret = rand(32), keySalt = rand(16), pwSalt = rand(16), i;
    // 1) 문서 암호화(4096 바이트씩, 줄마다 다른 IV)
    var key = await aesKey(secret, 'encrypt'), segs = [], n = pkg.length;
    for (i = 0; i * 4096 < n; i++) {
      var seg = pad16(pkg.subarray(i * 4096, Math.min(n, (i + 1) * 4096)));
      segs.push(await aesEnc(key, await hashIv(keySalt, le32(i)), seg));
    }
    var size8 = new Uint8Array(8); new DataView(size8.buffer).setUint32(0, n >>> 0, true); new DataView(size8.buffer).setUint32(4, Math.floor(n / 4294967296), true);
    var encPkg = cat.apply(null, [size8].concat(segs));
    // 2) 무결성 값
    var hmacSalt = rand(64), hk = await subtle.importKey('raw', hmacSalt, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    var hmac = new Uint8Array(await subtle.sign('HMAC', hk, encPkg));
    var encHmacKey = await aesEnc(key, await hashIv(keySalt, new Uint8Array(BK_HMACKEY)), hmacSalt);
    var encHmacVal = await aesEnc(key, await hashIv(keySalt, new Uint8Array(BK_HMACVAL)), hmac);
    // 3) 암호로 비밀 열쇠 감싸기
    var h = await spinHash(pwSalt, password, spin), verIn = rand(16), verHash = await sha512(verIn);
    var k1 = await aesKey(await deriveKey(h, new Uint8Array(BK_VERIN), 256), 'encrypt'), k2 = await aesKey(await deriveKey(h, new Uint8Array(BK_VERVAL), 256), 'encrypt'), k3 = await aesKey(await deriveKey(h, new Uint8Array(BK_KEY), 256), 'encrypt');
    var eVerIn = await aesEnc(k1, pwSalt, verIn), eVerVal = await aesEnc(k2, pwSalt, verHash), eKey = await aesEnc(k3, pwSalt, secret);
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<encryption xmlns="' + NS_ENC + '" xmlns:p="' + NS_PW + '" xmlns:c="' + NS_CERT + '">' +
      '<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(keySalt) + '"/>' +
      '<dataIntegrity encryptedHmacKey="' + b64(encHmacKey) + '" encryptedHmacValue="' + b64(encHmacVal) + '"/>' +
      '<keyEncryptors><keyEncryptor uri="' + NS_PW + '"><p:encryptedKey spinCount="' + spin + '" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' + b64(pwSalt) +
      '" encryptedVerifierHashInput="' + b64(eVerIn) + '" encryptedVerifierHashValue="' + b64(eVerVal) + '" encryptedKeyValue="' + b64(eKey) + '"/></keyEncryptor></keyEncryptors></encryption>';
    var info = cat(new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0]), TE.encode(xml));
    return writeCfb([
      { path: '\u0006DataSpaces/Version', data: dsVersion() }, { path: '\u0006DataSpaces/DataSpaceMap', data: dsMap() },
      { path: '\u0006DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace', data: dsInfo() }, { path: '\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary', data: dsPrimary() },
      { path: 'EncryptionInfo', data: info }, { path: 'EncryptedPackage', data: encPkg }
    ]);
  }
  function lp(s) { var u = utf16(s), pad = (4 - (u.length % 4)) % 4, o = new Uint8Array(4 + u.length + pad); new DataView(o.buffer).setUint32(0, u.length, true); o.set(u, 4); return o; }
  function w32(v) { return le32(v); }
  function ver() { return new Uint8Array([1, 0, 0, 0]); }
  function dsVersion() { return cat(lp('Microsoft.Container.DataSpaces'), ver(), ver(), ver()); }
  function dsMap() { var ent = cat(w32(1), w32(0), lp('EncryptedPackage'), lp('StrongEncryptionDataSpace')); return cat(w32(8), w32(1), w32(ent.length + 4), ent); }
  function dsInfo() { return cat(w32(8), w32(1), lp('StrongEncryptionTransform')); }
  function dsPrimary() {
    var tid = lp('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}');           // 머리 길이 = 길이칸(4) + 종류(4) + 변환 ID 까지만
    return cat(w32(8 + tid.length), w32(1), tid, lp('Microsoft.Container.EncryptionTransform'), ver(), ver(), ver(), w32(0), w32(0), w32(0), w32(4));
  }

  // ============================================================ 암호 풀기
  function looksEncrypted(u8) { if (!u8 || u8.length < 512) return false; for (var i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return false; return true; }
  function attr(xml, tag, name) { var m = new RegExp('<' + tag + '\\b[^>]*?\\s' + name + '="([^"]*)"').exec(xml); return m ? m[1] : null; }
  async function decrypt(u8, password) {
    if (!subtle) throw fail('nocrypto', '이 기기에서는 암호 기능을 쓸 수 없습니다(보안 연결에서만 동작합니다).');
    var cf; try { cf = readCfb(u8); } catch (e) { throw fail('format', '암호 문서의 구조를 읽지 못했습니다.'); }
    var infoB = cf.streams['EncryptionInfo'], pkgB = cf.streams['EncryptedPackage'];
    if (!infoB || !pkgB) throw fail('notenc', '암호가 걸린 문서가 아닙니다.');
    var vmaj = u16(infoB, 0), vmin = u16(infoB, 2);
    if (!(vmaj === 4 && vmin === 4)) throw fail('oldenc', '오래된 방식(워드 2007 이전·표준 암호)으로 암호가 걸린 문서입니다. 이 앱은 지금 방식(AES-256)만 풀 수 있습니다. 워드·엑셀·파워포인트에서 열어 다시 저장해 주십시오.');
    var xml = TD.decode(infoB.subarray(8)).replace(/^﻿/, '');
    var kd = /<keyData\b[^>]*>/.exec(xml), ek = /<p:encryptedKey\b[^>]*>|<encryptedKey\b[^>]*>/.exec(xml);
    if (!kd || !ek) throw fail('format', '암호 방식(암호 대신 인증서 등)을 이 앱이 알아보지 못합니다.');
    function A(s, n) { var m = new RegExp('\\s' + n + '="([^"]*)"').exec(s); return m ? m[1] : null; }
    if (A(kd[0], 'cipherAlgorithm') !== 'AES' || A(kd[0], 'hashAlgorithm') !== 'SHA512' || A(kd[0], 'cipherChaining') !== 'ChainingModeCBC') throw fail('oldenc', '이 앱이 지원하지 않는 암호 방식입니다(AES-256·SHA-512 만 지원).');
    var spin = +A(ek[0], 'spinCount'), pwSalt = unb64(A(ek[0], 'saltValue')), keySalt = unb64(A(kd[0], 'saltValue')), keyBits = +A(ek[0], 'keyBits') || 256;
    var h = await spinHash(pwSalt, String(password), spin);
    var dk1 = await deriveKey(h, new Uint8Array(BK_VERIN), keyBits), dk2 = await deriveKey(h, new Uint8Array(BK_VERVAL), keyBits), dk3 = await deriveKey(h, new Uint8Array(BK_KEY), keyBits);
    var e1 = await aesKey(dk1, 'encrypt'), d1 = await aesKey(dk1, 'decrypt'), e2 = await aesKey(dk2, 'encrypt'), d2 = await aesKey(dk2, 'decrypt'), e3 = await aesKey(dk3, 'encrypt'), d3 = await aesKey(dk3, 'decrypt');
    var verIn = await aesDec(e1, d1, pwSalt, unb64(A(ek[0], 'encryptedVerifierHashInput'))), verVal = await aesDec(e2, d2, pwSalt, unb64(A(ek[0], 'encryptedVerifierHashValue')));
    var want = await sha512(verIn.subarray(0, 16)), ok = verVal.length >= 64;
    for (var i = 0; ok && i < 64; i++) if (verVal[i] !== want[i]) ok = false;
    if (!ok) throw fail('badpw', '암호가 맞지 않습니다.');
    var secret = (await aesDec(e3, d3, pwSalt, unb64(A(ek[0], 'encryptedKeyValue')))).subarray(0, keyBits / 8);
    var ke = await aesKey(secret, 'encrypt'), kdd = await aesKey(secret, 'decrypt');
    // 무결성(HMAC) 확인 — 어긋나면 파일이 망가졌거나 바뀐 것
    var di = /<dataIntegrity\b[^>]*>/.exec(xml);
    if (di) {
      try {
        var hs = (await aesDec(ke, kdd, await hashIv(keySalt, new Uint8Array(BK_HMACKEY)), unb64(A(di[0], 'encryptedHmacKey')))).subarray(0, 64);
        var hv = (await aesDec(ke, kdd, await hashIv(keySalt, new Uint8Array(BK_HMACVAL)), unb64(A(di[0], 'encryptedHmacValue')))).subarray(0, 64);
        var hk = await subtle.importKey('raw', hs, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']), calc = new Uint8Array(await subtle.sign('HMAC', hk, pkgB));
        for (i = 0; i < 64; i++) if (calc[i] !== hv[i]) throw fail('integrity', '암호 문서가 손상됐거나 바뀐 것 같습니다(무결성 검사 실패).');
      } catch (e) { if (global.__SO_STRICT || (e && e.code === 'integrity')) throw e; }
    }
    var size = u32(pkgB, 0) + u32(pkgB, 4) * 4294967296, outParts = [], total = pkgB.length - 8;
    for (i = 0; i * 4096 < total; i++) {
      var a = 8 + i * 4096, ct = pkgB.subarray(a, Math.min(pkgB.length, a + 4096)); if (ct.length % 16) ct = pad16(ct);
      outParts.push(await aesDec(ke, kdd, await hashIv(keySalt, le32(i)), ct));
    }
    return cat.apply(null, outParts).subarray(0, size);
  }

  global.SOCrypt = { looksEncrypted: looksEncrypted, encrypt: encrypt, decrypt: decrypt, readCfb: readCfb, writeCfb: writeCfb, supported: function () { return !!subtle; } };
})(typeof window !== 'undefined' ? window : globalThis);

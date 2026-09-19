/* ============================================================================
 * office-bridge.js  —  PC 우편함 클라이언트 (OfficeBridge)  [PC-중심 개편판]
 * ----------------------------------------------------------------------------
 * 폰의 역할: 오디오를 우편함(Supabase Storage)에 올리고, 결과를 되읽는다.
 *   - send(memo, blob) : 오디오 업로드 + 메모 row 생성(status=pending)
 *   - poll(id, token)  : PC가 처리한 결과(RPC) 조회 (status/transcript/문서URL)
 *   - 오프라인 안전망: 업로드 실패 시 오디오를 IndexedDB에 보관 → 나중에 재시도.
 *
 * 여기 들어가는 키는 **공개(publishable) 키뿐**. anon 은 "오디오 업로드"와
 * "pending row 생성"만 가능하고, 남의 것을 읽거나 결과를 조작할 수 없다(RLS).
 * ⛔ service_role(비밀) 키는 절대 앱에 넣지 않는다(PC 도우미만).
 * ==========================================================================*/

(function (global) {
  'use strict';

  var CONFIG = {
    url: 'https://nasizwclypmaojvwfxnn.supabase.co',
    key: 'sb_publishable_H92J8-9eQB-bE4DQEUnHvw_jku33h7S',
    table: 'voice_memos',
    bucket: 'voice-audio'
  };

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function token() {
    var a = new Uint8Array(16);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256 | 0; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function extFromBlob(blob) {
    var t = (blob && blob.type) || '';
    if (/webm/.test(t)) return 'webm';
    if (/mp4|m4a|aac/.test(t)) return 'mp4';
    if (/ogg/.test(t)) return 'ogg';
    if (/wav/.test(t)) return 'wav';
    return 'webm';
  }

  /* ---------- IndexedDB: 업로드 못한 오디오 임시 보관 ---------- */
  var DB_NAME = 'voice_memo_audio', STORE = 'pending';
  function _db() {
    return new Promise(function (resolve, reject) {
      try {
        var rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      } catch (e) { reject(e); }
    });
  }
  function idbPut(rec) {
    return _db().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { return false; });
  }
  function idbAll() {
    return _db().then(function (db) {
      return new Promise(function (res) {
        var out = [], tx = db.transaction(STORE, 'readonly'), cur = tx.objectStore(STORE).openCursor();
        cur.onsuccess = function () { var c = cur.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
        cur.onerror = function () { res(out); };
      });
    }).catch(function () { return []; });
  }
  function idbDel(id) {
    return _db().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  /* ---------- 네트워크 ---------- */
  function uploadAudio(id, ext, blob) {
    var path = id + '.' + ext;
    return fetch(CONFIG.url + '/storage/v1/object/' + CONFIG.bucket + '/' + path, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
        'Content-Type': (blob && blob.type) || 'audio/webm'
        // ※ x-upsert 안 씀: 경로가 UUID라 고유 → 순수 INSERT(anon 업로드 정책과 일치).
        //    upsert 를 켜면 UPDATE 정책까지 필요해 RLS 로 막힌다.
      },
      body: blob
    }).then(function (r) { if (!r.ok) throw new Error('오디오 업로드 실패(HTTP ' + r.status + ')'); return path; });
  }
  function _insertRow(body) {
    return fetch(CONFIG.url + '/rest/v1/' + CONFIG.table, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error('메모 등록 실패(HTTP ' + r.status + ')'); return true; });
  }
  function createMemo(memo, audioPath) {
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending',
      kind: memo.kind || 'audio', note: memo.note || null,
      audio_path: audioPath, client_token: memo.token,
      meta: { app: 'voice-memo-test', ext: memo.ext }
    });
  }
  // 파일 없이 등록하는 메모(명함 검색 / 사진 온디맨드). kind='search'.
  function createSearch(memo) {
    return _insertRow({
      id: memo.id, title: memo.title || '검색', status: 'pending',
      kind: 'search', note: memo.note || '', client_token: memo.token,
      meta: { app: 'voice-memo-test' }
    });
  }

  // 오디오 업로드 + 메모 등록. 실패하면 IndexedDB에 오디오를 넣고 throw.
  function send(memo, blob) {
    return uploadAudio(memo.id, memo.ext, blob)
      .then(function (path) { return createMemo(memo, path); })
      .then(function () { return idbDel(memo.id); })   // 성공 시 대기분 제거
      .catch(function (e) {
        return idbPut({ id: memo.id, title: memo.title, token: memo.token, ext: memo.ext, blob: blob, date: memo.date, time: memo.time })
          .then(function () { throw e; });
      });
  }

  function extForFile(file, kind) {
    var e = ((file.name || '').split('.').pop() || '').toLowerCase();
    if (!e || e.length > 5) e = (kind === 'video' ? 'mp4' : 'jpg');
    return e;
  }
  function uploadObject(key, blob) {
    return fetch(CONFIG.url + '/storage/v1/object/' + CONFIG.bucket + '/' + key, {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
                 'Content-Type': (blob && blob.type) || 'application/octet-stream' },
      body: blob
    }).then(function (r) { if (!r.ok) throw new Error('파일 업로드 실패(HTTP ' + r.status + ')'); return key; });
  }
  function _insertBatchRow(memo, filesMeta) {
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending', kind: memo.kind, note: memo.note || null,
      client_token: memo.token, meta: { app: 'voice-memo-test', files: filesMeta }
    });
  }
  // memo.kind photo/video, files: [File] (1장 이상). onProgress(done,total) 선택.
  function sendBatch(memo, files, onProgress) {
    var filesMeta = [], idx = 0;
    function step() {
      if (idx >= files.length) {
        return _insertBatchRow(memo, filesMeta).then(function () { return idbDel(memo.id); });
      }
      var file = files[idx];
      var ext = extForFile(file, memo.kind);
      var key = memo.id + '/' + idx + '.' + ext;
      return uploadObject(key, file).then(function () {
        filesMeta.push({ key: key, ext: ext });
        idx++; onProgress && onProgress(idx, files.length);
        return step();
      });
    }
    return step().catch(function (e) {
      return idbPut({ id: memo.id, kind: memo.kind, note: memo.note, title: memo.title,
                      token: memo.token, files: files, date: memo.date, time: memo.time })
        .then(function () { throw e; });
    });
  }

  /* ---------- 긴 영상: 조각 업로드 + 핸드셰이크(무료 50MB/1GB 한도 우회) ---------- */
  var CHUNK_SIZE = 40 * 1024 * 1024;   // 40MB 조각(단일 50MB 한도 안전선)
  var MAX_INFLIGHT = 2;                // PC가 소비하기 전 최대 2조각만 앞서 올림 → 저장소 최고점 ~80MB

  function _insertChunkedVideoRow(memo, total, ext) {
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending', kind: 'video', note: memo.note || null,
      client_token: memo.token,
      meta: { app: 'voice-memo-test', chunked: true, ext: ext, total: total }
    });
  }
  function uploadPart(id, k, ext, blob) {
    return uploadObject(id + '/part_' + k + '.' + ext, blob);
  }
  function uploadPartWithRetry(id, k, ext, blob, tries) {
    return uploadPart(id, k, ext, blob).catch(function (e) {
      if (tries <= 1) throw e;
      return new Promise(function (res) { setTimeout(res, 3000); }).then(function () {
        return uploadPartWithRetry(id, k, ext, blob, tries - 1);
      });
    });
  }
  // progress(=PC가 소비한 조각 수) >= need 될 때까지 대기(최대 30분).
  function waitConsumed(id, tok, need) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function loop() {
        poll(id, tok).then(function (r) {
          var consumed = (r && r.progress) || 0;
          if (consumed >= need) return resolve();
          if (Date.now() - start > 30 * 60 * 1000) return reject(new Error('PC가 조각을 받지 못했어요(PC가 꺼져 있나요?).'));
          setTimeout(loop, 2500);
        }).catch(function () { setTimeout(loop, 3000); });
      })();
    });
  }
  // 큰 영상 1개를 조각으로 나눠 페이싱하며 업로드. onProgress('upload', done, total).
  function sendVideoChunked(memo, file, onProgress) {
    var ext = extForFile(file, 'video');
    var total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    return _insertChunkedVideoRow(memo, total, ext).then(function () {
      var k = 0;
      function step() {
        if (k >= total) return Promise.resolve();
        var pacing = (k >= MAX_INFLIGHT)
          ? waitConsumed(memo.id, memo.token, k - MAX_INFLIGHT + 1)
          : Promise.resolve();
        return pacing.then(function () {
          var blob = file.slice(k * CHUNK_SIZE, Math.min(file.size, (k + 1) * CHUNK_SIZE));
          return uploadPartWithRetry(memo.id, k, ext, blob, 3);
        }).then(function () {
          k++; onProgress && onProgress('upload', k, total);
          return step();
        });
      }
      return step();
    });
  }

  // 결과 조회(RPC). 결과 객체 또는 null. (progress/progress_total/progress_msg 포함)
  function poll(id, tok) {
    return fetch(CONFIG.url + '/rest/v1/rpc/get_voice_memo', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_token: tok })
    }).then(function (r) { if (!r.ok) throw new Error('결과 조회 실패(HTTP ' + r.status + ')'); return r.json(); })
      .then(function (arr) { return (arr && arr[0]) || null; });
  }

  // 오프라인으로 밀렸던 오디오 재업로드. onEach(memo) 성공 콜백.
  function flush(onEach) {
    return idbAll().then(function (list) {
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve();
        var rec = list[i++];
        var memo = { id: rec.id, kind: rec.kind, note: rec.note, title: rec.title, token: rec.token, ext: rec.ext, date: rec.date, time: rec.time };
        var p = rec.files
          ? sendBatch(memo, rec.files)                 // 사진/영상 묶음 재업로드
          : uploadAudio(memo.id, memo.ext, rec.blob).then(function (k) { return createMemo(memo, k); }).then(function () { return idbDel(memo.id); });
        return p
          .then(function () { onEach && onEach(memo); })
          .catch(function () { /* 다음 기회 */ })
          .then(next);
      }
      return next();
    });
  }
  function pendingCount() { return idbAll().then(function (l) { return l.length; }); }

  global.OfficeBridge = {
    CONFIG: CONFIG, uuid: uuid, token: token, extFromBlob: extFromBlob,
    send: send, sendBatch: sendBatch, sendVideoChunked: sendVideoChunked,
    createSearch: createSearch, poll: poll, flush: flush, pendingCount: pendingCount,
    CHUNK_SIZE: CHUNK_SIZE
  };
  global.addEventListener('online', function () { flush(); });
})(window);

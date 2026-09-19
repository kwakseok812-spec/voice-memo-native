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

  // 결과 조회(RPC). 결과 객체 또는 null.
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
        var memo = { id: rec.id, title: rec.title, token: rec.token, ext: rec.ext, date: rec.date, time: rec.time };
        return uploadAudio(memo.id, memo.ext, rec.blob)
          .then(function (p) { return createMemo(memo, p); })
          .then(function () { return idbDel(memo.id); })
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
    send: send, createSearch: createSearch, poll: poll, flush: flush, pendingCount: pendingCount
  };
  global.addEventListener('online', function () { flush(); });
})(window);

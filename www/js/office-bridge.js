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

  /* v6.6(2026-09-29, O-0086) 파일 크기 상한 5GB 통일 — 대표님 "용량 제한이 너무 작아" · "5기가로 다 올려".
   *   서버: 전역 업로드 한도 500GB, 버킷 voice-audio·voice-docs·locker 5GB(소장 설정 완료).
   *   앱의 모든 '사용자 파일 보내기'(녹음 회의자료·사진·영상·채팅 첨부·문서 뷰어·공유함)는 이 상수 하나로 막는다.
   *   ▶ 폰 메모리: 큰 파일은 전부 Blob 그대로 스트리밍(fetch/XHR body) 또는 40MB 조각(slice)으로 보낸다
   *     — 파일 전체를 메모리로 읽는 경로는 40MB 이하(녹음 단일·녹음 조각)에서만 쓴다. */
  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;   // 5GB (= 버킷 한도)
  var MAX_UPLOAD_LABEL = '5GB';
  function tooBigErr(file, maker) {
    return (maker || voiceErr)('too_big', { name: (file && file.name) || '', size: (file && file.size) || 0 });
  }
  // files 중 5GB 초과가 있으면 그 파일로 만든 오류, 없으면 null.
  function firstTooBig(files, maker) {
    for (var i = 0; i < (files || []).length; i++) {
      if (((files[i] && files[i].size) || 0) > MAX_UPLOAD_BYTES) return tooBigErr(files[i], maker);
    }
    return null;
  }

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
  var DB_NAME = 'voice_memo_audio', STORE = 'pending', DRAFT_STORE = 'drafts';
  function _db() {
    return new Promise(function (resolve, reject) {
      try {
        // v3.8: 버전 2로 올려 'drafts'(임시 저장) 스토어를 추가한다.
        //  ⚠️ 'drafts'는 flush()가 훑는 'pending'과 분리돼 있어 절대 자동 발송되지 않는다
        //     (대표님이 [PC 보내기]를 누를 때만 발송). 기존 pending 데이터는 그대로 보존.
        var rq = indexedDB.open(DB_NAME, 2);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        };
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      } catch (e) { reject(e); }
    });
  }
  // ---- 임시 저장(draft) 전용 스토어 헬퍼 (pending 과 물리적으로 분리 → flush 대상 아님) ----
  function draftPut(rec) {
    return _db().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(DRAFT_STORE, 'readwrite'); tx.objectStore(DRAFT_STORE).put(rec);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { return false; });
  }
  function draftGet(id) {
    return _db().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(DRAFT_STORE, 'readonly'); var rq = tx.objectStore(DRAFT_STORE).get(id);
        rq.onsuccess = function () { res(rq.result || null); }; rq.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function draftDel(id) {
    return _db().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(DRAFT_STORE, 'readwrite'); tx.objectStore(DRAFT_STORE).delete(id);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
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
  // 안전 업로드(2026-09-22, v5.1): pending 원본의 'sent' 표시를 내려 flush 가 다시 보내게 한다.
  //   (원본 blob 은 그대로 보존 — 자동복구/[다시 보내기] 시 재전송 대상으로 되돌리는 용도)
  function markResendable(id) {
    return _db().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction(STORE, 'readwrite'); var st = tx.objectStore(STORE); var rq = st.get(id);
        rq.onsuccess = function () { var r = rq.result; if (r) { r.sent = false; st.put(r); } res(!!r); };
        rq.onerror = function () { res(false); };
      });
    }).catch(function () { return false; });
  }

  /* ---------- 네트워크 ---------- */
  /* v6.4(2026-09-29) 녹음·회의자료 업로드 공통 — 「임시저장 → 자료 붙여 PC 보내기」 오류(O-0085) 수정.
   *  ▶ 원인(서버 로그 실측): Supabase Storage 는 "이미 있음(중복)"을 HTTP 409 가 아니라
   *    **HTTP 400 + 본문 {"statusCode":"409","code":"KeyAlreadyExists","error":"Duplicate",...}** 로 준다
   *    (9/29 12:25·12:49 재전송 응답 106바이트 = 이 본문 길이와 정확히 일치). 그래서 v5.1~v6.3 의
   *    `r.status === 409` 통과 규칙은 한 번도 작동하지 않았고, 재전송은 이미 올라간 mat_0 에서 400 으로 죽었다.
   *  ▶ 고침: 본문까지 읽어 중복이면 "이미 올라감=성공". 그 밖의 실패는 이유(용량/인터넷/파일 읽기/서버)를
   *    쉬운 말(err.friendly)로 돌려준다. ⚠️ 안 올라간 객체는 서버가 200 을 주므로 중복 통과가 유실을 감추지 않는다. */
  function isDuplicateStorage(status, bodyText) {
    if (status === 409) return true;
    var j = null; try { j = JSON.parse(bodyText || ''); } catch (x) {}
    var sc = String((j && j.statusCode) || ''), code = String((j && j.code) || ''), er = String((j && j.error) || '');
    return sc === '409' || code === 'KeyAlreadyExists' || code === 'ResourceAlreadyExists' ||
           er === 'Duplicate' || /already exists/i.test(bodyText || '');
  }
  // 녹음·자료 업로드 실패 → 대표님이 읽을 쉬운 문장(err.friendly) + 분류(err.reason).
  //   reason: too_big_server | network | unreadable | bad_key | auth | server | unknown
  function voiceErr(reason, info) {
    info = info || {};
    var nm = info.name ? '「' + info.name + '」 ' : '';
    var table = {
      too_big: nm + '파일이 너무 커요(' + fmtSize(info.size) + '). ' + MAX_UPLOAD_LABEL + '까지 보낼 수 있어요.',
      too_big_server: nm + '파일이 서버가 한 번에 받는 크기를 넘었어요(' + fmtSize(info.size) + '). ' + MAX_UPLOAD_LABEL + '까지 보낼 수 있어요.',
      network: '인터넷 연결이 끊겨 보내지 못했어요. 와이파이·데이터를 확인하고 다시 보내 주세요.',
      unreadable: nm + '폰에 저장된 파일을 읽지 못했어요.',
      bad_key: nm + '서버가 저장 경로를 거절했어요(파일 이름 문제). 소장에게 알려 주세요.',
      auth: '서버가 권한 문제로 거절했어요(HTTP ' + (info.status || '?') + '). 소장에게 알려 주세요.',
      server: '서버가 잠시 응답하지 않아요(HTTP ' + (info.status || '?') + '). 잠시 뒤 다시 보내 주세요.',
      // v6.9 문서 뷰어 업로드(sendDoc)용
      stalled: nm + '올리는 중에 전송이 멈췄어요(인터넷이 느리거나 끊김, 또는 앱이 잠시 화면 뒤로 감). 여러 번 다시 올려 봤지만 되지 않았어요.',
      parts_missing: nm + '일부 조각이 서버에 올라갔는지 확인되지 않아 PC에 넘기지 않았어요. 다시 시도해 주세요.',
      cancelled: '올리기를 취소했어요.',
      row_net: '문서는 올라갔지만 인터넷이 끊겨 PC에 변환 요청을 넣지 못했어요.',
      row_server: '문서는 올라갔지만 서버가 잠시 응답하지 않아 PC에 변환 요청을 넣지 못했어요(HTTP ' + (info.status || '?') + ').',
      row_fail: '문서는 올라갔지만 서버가 변환 요청을 거절했어요(HTTP ' + (info.status || '?') + '). 소장에게 알려 주세요.',
      unknown: nm + '올리지 못했어요' + (info.status ? '(HTTP ' + info.status + ')' : '') + '. 다시 보내 주세요.'
    };
    var msg = table[reason] || table.unknown;
    var e = new Error(msg);
    e.reason = reason; e.friendly = msg; e.status = info.status || 0; e.serverCode = info.code || '';
    return e;
  }
  // Storage 에 한 객체 POST. body 는 Blob 또는 ArrayBuffer. 성공·중복=key, 실패=voiceErr.
  //   ※ x-upsert 안 씀: 경로가 UUID라 고유 → 순수 INSERT(anon 업로드 정책과 일치). upsert 는 UPDATE 정책이 필요해 RLS 로 막힌다.
  function _storagePost(key, body, contentType, info) {
    info = info || {};
    return fetch(CONFIG.url + '/storage/v1/object/' + CONFIG.bucket + '/' + key, {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
                 'Content-Type': contentType || 'application/octet-stream' },
      body: body
    }).then(function (r) {
      if (r.ok) return key;
      return r.text().catch(function () { return ''; }).then(function (txt) {
        if (isDuplicateStorage(r.status, txt)) return key;          // 이전 시도에 이미 올라감 = 성공
        var c = classifyStorageFail(r.status, txt);
        throw voiceErr(c.reason, { name: info.name, size: info.size, status: r.status, code: c.code });
      });
    }, function () {
      // 요청이 서버에 닿지 못함(status 0): 인터넷 끊김 또는 폰 파일을 못 읽음 — 파일을 직접 읽어 구분.
      if (!(body && typeof body.slice === 'function' && typeof Blob !== 'undefined' && body instanceof Blob)) {
        throw voiceErr('network', info);
      }
      return probeReadable(body).then(function (ok) { throw voiceErr(ok ? 'network' : 'unreadable', info); });
    });
  }
  // Blob 전체를 메모리로 읽는다(ArrayBuffer). 폰에 저장된(IndexedDB) 녹음을 올리기 '전에' 먼저 읽어 두면
  //   ① 업로드 도중 저장 파일 읽기 실패가 '인터넷 끊김'처럼 보이는 일을 막고(원인이 바로 드러남),
  //   ② 파일 기반 Blob 을 그대로 스트리밍하다 끊기는 WebView 문제를 비껴간다(조각 40MB 이하라 메모리 부담 작음).
  function readAllBytes(blob, info) {
    return new Promise(function (resolve, reject) {
      try {
        if (blob && typeof blob.arrayBuffer === 'function') {
          blob.arrayBuffer().then(resolve, function () { reject(voiceErr('unreadable', info)); });
          return;
        }
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = function () { reject(voiceErr('unreadable', info)); };
        fr.readAsArrayBuffer(blob);
      } catch (x) { reject(voiceErr('unreadable', info)); }
    });
  }
  function uploadAudio(id, ext, blob) {
    var path = id + '.' + ext;
    // 같은 경로가 이미 있으면(이전 시도에 올라감) 중복=성공으로 통과 — _storagePost 참고.
    return readAllBytes(blob, { name: '녹음' }).then(function (buf) {
      return _storagePost(path, buf, (blob && blob.type) || 'audio/webm', { name: '녹음', size: blob && blob.size });
    });
  }
  function _insertRow(body) {
    return fetch(CONFIG.url + '/rest/v1/' + CONFIG.table, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal'
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      // 409 = 같은 기본키(id) 행이 이미 있음(이전 시도에 등록됨). 재시도가 여기서 죽으면 조각(part) 공급
      //   단계로 못 넘어가 긴 녹음 복구가 막힌다 → 중복 키는 "이미 등록됨=성공"으로 취급(멱등).
      //   ⚠️ id 는 client 생성 UUID라 409는 오직 "같은 메모 재시도"에서만 발생 → 유실을 감추지 않는다.
      if (r.ok || r.status === 409) return true;
      throw new Error('메모 등록 실패(HTTP ' + r.status + ')');
    });
  }
  function createMemo(memo, audioPath) {
    var meta = { app: 'voice-memo-test', ext: memo.ext };
    if (memo.materialsMeta && memo.materialsMeta.length) meta.materials = memo.materialsMeta;   // 회의자료(2026-09-21)
    if (memo.materialsSkipped && memo.materialsSkipped.length) meta.materials_skipped = memo.materialsSkipped;   // v6.4: 못 붙인 자료(이름·이유)
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending',
      kind: memo.kind || 'audio', note: memo.note || null,
      audio_path: audioPath, client_token: memo.token,
      meta: meta
    });
  }

  /* ---------- 회의자료 첨부(녹음과 함께) — 2026-09-21 ----------
   * 녹음(음성메모)에 회의자료(PPT/워드/PDF/한글 등)를 함께 보낸다. 자료는 voice-audio 버킷
   * `{id}/mat_{i}.{ext}` 로 올리고, meta.materials=[{key,ext,name,size,mime}] 로 행에 싣는다.
   * PC(collect.py) 가 이 목록을 내려받아 텍스트를 추출하고, 전사문과 함께 통합 회의록으로 정리한다.
   * 반환: 업로드된 자료 메타 배열(없으면 []). */
  //   v6.4: 자료 하나가 「너무 큼 / 폰에서 못 읽음 / 이름 거절」처럼 다시 보내도 똑같이 실패할 이유로 막히면,
  //   그 자료만 빼고(out.skipped 에 기록) 녹음은 계속 보낸다 — 녹음이 자료 때문에 못 가는 일이 없게.
  //   인터넷·서버 문제(다시 보내면 될 수 있는 것)는 지금처럼 전체 실패로 돌려 원본을 보존한다.
  //   재전송 때 이미 올라간 mat_i 는 중복=성공으로 통과한다(_storagePost).
  var MAT_SKIP_REASONS = { too_big: 1, too_big_server: 1, unreadable: 1, bad_key: 1 };
  function uploadMaterials(id, materials, onProgress) {
    materials = materials || [];
    var out = [], skipped = [], i = 0;
    out.skipped = skipped;
    function step() {
      if (i >= materials.length) return Promise.resolve(out);
      var f = materials[i];
      var ext = extForMaterial(f);
      var key = id + '/mat_' + i + '.' + ext;
      var nm = f.name || ('mat' + i + '.' + ext);
      // v6.6: 5GB 초과 자료는 올리지 않고 건너뜀(녹음은 계속). 5GB 이하는 File(Blob) 그대로 스트리밍 — 메모리로 읽지 않음.
      var up = ((f.size || 0) > MAX_UPLOAD_BYTES)
        ? Promise.reject(voiceErr('too_big', { name: nm, size: f.size || 0 }))
        : _storagePost(key, f, f.type || 'application/octet-stream', { name: nm, size: f.size || 0 });
      return up.then(function () {
        out.push({ key: key, ext: ext, name: nm, size: f.size || 0, mime: f.type || '' });
      }, function (e) {
        if (!(e && MAT_SKIP_REASONS[e.reason])) throw e;
        skipped.push({ name: nm, size: f.size || 0, reason: e.reason, msg: e.friendly || String(e.message || e) });
      }).then(function () {
        i++; onProgress && onProgress(i, materials.length);
        return step();
      });
    }
    return step();
  }
  // 회의자료 저장 키 확장자: 이름의 확장자가 영문·숫자면 그대로, 아니면 파일 종류(mime)로 추정, 그래도 모르면 'bin'.
  //   (예전 기본값 'jpg' 는 문서를 사진으로 오인시킬 수 있었다. PC collect.py 는 모르는 확장자도 PDF 변환 경로로 처리.)
  var MAT_MIME_EXT = {
    'application/pdf': 'pdf', 'application/x-hwp': 'hwp', 'application/haansofthwp': 'hwp', 'application/vnd.hancom.hwp': 'hwp',
    'application/hwp+zip': 'hwpx', 'application/vnd.hancom.hwpx': 'hwpx', 'application/haansofthwpx': 'hwpx',
    'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'image/jpeg': 'jpg', 'image/png': 'png'
  };
  function extForMaterial(f) {
    var e = (((f && f.name) || '').split('.').pop() || '').toLowerCase();
    if (/^[a-z0-9_-]{1,5}$/.test(e) && ((f && f.name) || '').indexOf('.') > 0) return e;
    return MAT_MIME_EXT[((f && f.type) || '').toLowerCase()] || 'bin';
  }
  // 파일 없이 등록하는 메모(명함 검색 / 사진 온디맨드). kind='search'.
  function createSearch(memo) {
    return _insertRow({
      id: memo.id, title: memo.title || '검색', status: 'pending',
      kind: 'search', note: memo.note || '', client_token: memo.token,
      meta: { app: 'voice-memo-test' }
    });
  }

  // 회의자료(있으면) + 오디오 업로드 + 메모 등록. 실패하면 IndexedDB에 오디오·자료를 넣고 throw.
  function send(memo, blob) {
    // 안전 업로드(2026-09-22, v5.1): 전송 '전에' 원본을 먼저 영속(idbPut)하고, 업로드가 끝나도
    //   지우지 않는다(sent:true 표시만). 실제 원본 삭제는 PC 정리(done) 확인 뒤에만(app.js dropPending).
    //   ⚠️ 예전엔 r.ok/409(HTTP 성공)만 보고 idbDel 했다 — 서버에 실제로 안 남았는데도 원본을 지워
    //      녹음이 유실될 수 있었다(2026-09-22 CCUBIO 사고). 그 결합을 끊는다.
    var rec = { id: memo.id, title: memo.title, token: memo.token, ext: memo.ext, blob: blob,
                materials: memo.materials || [], date: memo.date, time: memo.time, kind: memo.kind || 'audio', sent: false };
    return idbPut(rec)                                            // (1) 전송 전 원본 영속 — 인메모리만 믿지 않음
      .then(function () { return uploadMaterials(memo.id, memo.materials || []); })
      .then(function (matMeta) { memo.materialsMeta = matMeta; memo.materialsSkipped = (matMeta && matMeta.skipped) || []; return uploadAudio(memo.id, memo.ext, blob); })
      .then(function (path) { return createMemo(memo, path); })
      .then(function () { rec.sent = true; return idbPut(rec); }) // (2) 업로드 완료 표시(원본은 done 확인까지 보존)
      .catch(function (e) {
        rec.sent = false;
        return idbPut(rec).then(function () { throw e; });        // 실패: 원본 보존(재전송 가능)
      });
  }

  // 저장 키용 확장자. ⚠️ 저장 키(Storage 경로)에는 원래 파일명을 절대 넣지 않는다 — 키는 `{uuid}/{번호}.{ext}`.
  //   원래 이름(한글·공백·대괄호·괄호·이모지·아주 긴 이름)은 meta.files[].name 에만 두고 화면·다운로드에 쓴다.
  //   v6.3(2026-09-27): 확장자 자체가 한글/특수문자이거나(예: '보고서'처럼 점 없는 한글 이름 → 이름 전체가 ext 로
  //   잡힘, '파일.최종') 영문·숫자가 아니면 Supabase 가 'InvalidKey'(400)로 거절했다 → 영문 소문자·숫자·_- 1~5자만 통과,
  //   아니면 기본값으로. 기존에 통과하던 보통 확장자(영문·숫자 ≤5자)는 결과가 그대로라 워커 규약은 바뀌지 않는다.
  function extForFile(file, kind) {
    var e = ((file.name || '').split('.').pop() || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,5}$/.test(e)) e = (kind === 'video' ? 'mp4' : (kind === 'locker' ? 'bin' : 'jpg'));
    return e;
  }
  function uploadObject(key, blob) {
    // 이 키(자료 mat_i / 조각 part_k / 사진 등)가 이미 서버에 있으면(이전 시도에 업로드 성공) "이미 올라감=성공".
    //   (교무위 9/21·기획혁신처 9/29 사고 근본원인: 서버는 중복을 409 가 아니라 400+본문 statusCode "409" 로 준다
    //    → v6.3 까지는 재전송이 mat_0 에서 죽었다. v6.4: 본문까지 보고 판정 — _storagePost 참고.)
    //   실패 메시지는 예전처럼 '(HTTP 400)' 등 상태코드가 들어가고, err.friendly 에 쉬운 설명이 붙는다.
    return _storagePost(key, blob, (blob && blob.type) || 'application/octet-stream', { size: blob && blob.size });
  }
  function _insertBatchRow(memo, filesMeta) {
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending', kind: memo.kind, note: memo.note || null,
      client_token: memo.token, meta: { app: 'voice-memo-test', files: filesMeta }
    });
  }
  // memo.kind photo/video, files: [File] (1장 이상). onProgress(done,total) 선택.
  function sendBatch(memo, files, onProgress) {
    var big = firstTooBig(files);                     // v6.6: 5GB 초과는 올리기 전에 거절(보관·재시도 안 함)
    if (big) return Promise.reject(big);
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
  // v6.4: 녹음 조각 전용 — 폰에 저장된(IndexedDB) 녹음 조각을 '먼저 메모리로 읽고' 올린다(readAllBytes 참고).
  //   읽기 실패(unreadable)는 다시 해도 같으므로 즉시 실패, 인터넷·서버 실패만 3초 간격으로 재시도.
  //   이미 올라간 조각은 중복=성공(_storagePost).
  function uploadAudioPartWithRetry(id, k, total, ext, part, tries) {
    var info = { name: '녹음 조각 ' + (k + 1) + '/' + total, size: part.size };
    return readAllBytes(part, info).then(function (buf) {
      function attempt(n) {
        return _storagePost(id + '/part_' + k + '.' + ext, buf, 'application/octet-stream', info).catch(function (e) {
          if (n <= 1 || (e && e.reason === 'too_big_server') || (e && e.reason === 'bad_key')) throw e;
          return new Promise(function (res) { setTimeout(res, 3000); }).then(function () { return attempt(n - 1); });
        });
      }
      return attempt(tries || 3);
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
    if (((file && file.size) || 0) > MAX_UPLOAD_BYTES) return Promise.reject(tooBigErr(file));   // v6.6
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

  /* ---------- 긴 음성(2시간 등): 조각 업로드(영상과 동일 규약) ----------
   * 녹음이 길어 blob 이 단일 업로드 한도(50MB)를 넘으면 이 경로로 보낸다.
   *   - kind='audio', meta.chunked=true, meta.ext, meta.total (audio_path 는 넣지 않음).
   *   - 조각 경로/페이싱/재시도는 영상 청크(sendVideoChunked)와 완전히 동일한 인프라 재사용.
   *   - PC: video_worker.py 가 조각을 이어붙여 collect.py 의 전사·요약·문서 로직으로 처리.
   * ▶ 행 INSERT 는 영상 청크(_insertChunkedVideoRow)와 동일하게 순수 INSERT.
   *   (anon 키는 테이블 UPDATE 정책이 없어 upsert 를 못 쓴다 — uploadAudio 주석 참고.
   *    흔한 오프라인 실패는 애초에 이 INSERT 전에 나므로 flush() 재시도가 새 행으로 정상 동작한다.) */
  function _insertChunkedAudioRow(memo, total, ext) {
    var meta = { app: 'voice-memo-test', chunked: true, ext: ext, total: total };
    if (memo.materialsMeta && memo.materialsMeta.length) meta.materials = memo.materialsMeta;   // 회의자료(2026-09-21)
    if (memo.materialsSkipped && memo.materialsSkipped.length) meta.materials_skipped = memo.materialsSkipped;   // v6.4
    return _insertRow({
      id: memo.id, title: memo.title, status: 'pending', kind: 'audio', note: memo.note || null,
      client_token: memo.token,
      meta: meta
    });
  }
  // 큰 오디오 blob 1개를 조각으로 나눠 페이싱하며 업로드. onProgress('upload', done, total).
  // 실패하면 blob 을 IndexedDB 에 넣고 throw → flush() 가 나중에 다시 시도.
  function sendAudioChunked(memo, blob, onProgress) {
    var ext = memo.ext || extFromBlob(blob);
    var total = Math.max(1, Math.ceil(blob.size / CHUNK_SIZE));
    // 안전 업로드(2026-09-22, v5.1): 전송 '전에' 원본을 먼저 영속하고, 전 청크 업로드가 끝나도
    //   지우지 않는다(sent:true 표시만). 실제 삭제는 PC 정리(done) 확인 뒤에만(app.js dropPending).
    var rec = { id: memo.id, title: memo.title, token: memo.token, ext: ext, blob: blob,
                materials: memo.materials || [], date: memo.date, time: memo.time, kind: 'audio', sent: false };
    return idbPut(rec)                                       // (1) 전송 전 원본 영속
      .then(function () { return uploadMaterials(memo.id, memo.materials || []); })   // 회의자료 먼저(있으면) — 2026-09-21
      .then(function (matMeta) { memo.materialsMeta = matMeta; memo.materialsSkipped = (matMeta && matMeta.skipped) || []; return _insertChunkedAudioRow(memo, total, ext); })
      // v6.4 재전송 이어받기: 행이 이미 있으면(409=등록됨) PC가 이미 받아 간 조각 수(progress)부터 올린다.
      //   (이미 붙여 지운 조각을 또 올리면 서버에 쓰레기 조각이 남는다.) 이미 끝난(done) 메모면 조각을 건너뛴다.
      .then(function () { return poll(memo.id, memo.token).catch(function () { return null; }); })
      .then(function (row) {
      var k = 0;
      if (row && row.status === 'done') k = total;
      else if (row && row.progress > 0) k = Math.min(total, row.progress | 0);
      function step() {
        if (k >= total) return Promise.resolve();
        var pacing = (k >= MAX_INFLIGHT)
          ? waitConsumed(memo.id, memo.token, k - MAX_INFLIGHT + 1)
          : Promise.resolve();
        return pacing.then(function () {
          var part = blob.slice(k * CHUNK_SIZE, Math.min(blob.size, (k + 1) * CHUNK_SIZE));
          return uploadAudioPartWithRetry(memo.id, k, total, ext, part, 3);
        }).then(function () {
          k++; onProgress && onProgress('upload', k, total);
          return step();
        });
      }
      return step();
    }).then(function () { rec.sent = true; return idbPut(rec); })   // (2) 전 청크 업로드 완료 표시(원본 보존)
      .catch(function (e) {
        rec.sent = false;
        return idbPut(rec).then(function () { throw e; });          // 실패: 원본 보존(재전송 가능)
      });
  }

  // 케이와 대화: 채팅 메시지 1건 등록(kind='chat'). 응답은 poll()의 content_md 로 온다.
  //   opts.speak=true 면 케이 답을 목소리(mp3)로도 만들게 요청(meta.speak).
  //   v5.8: opts.modelPref='opus' 면 meta.model_pref='opus' → PC 케이가 이 1건을 오퍼스 5.5로 처리.
  function sendChat(id, token, thread, text, opts) {
    opts = opts || {};
    var meta = { app: 'voice-memo-test', thread: thread, speak: !!opts.speak };
    if (opts.modelPref) meta.model_pref = opts.modelPref;
    return _insertRow({
      id: id, title: '채팅', status: 'pending', kind: 'chat',
      note: text, client_token: token,
      meta: meta
    });
  }

  /* ---------- 온디맨드 TTS 요청(답변별 [듣기]) ----------
   * 특정 답의 텍스트만 케이 목소리 mp3 로 만들어 달라는 요청. chat_responder 가 meta.tts_only 를 보면
   * 케이(LLM)를 호출하지 않고 곧장 edge-tts 로만 생성 → summary_json.voice_url 회신(빠름·낭비 없음).
   * ⚠️ meta.thread 를 넣지 않는다 → 대화 기억(load_history)에 이 행이 섞이지 않게(맥락 오염 방지). */
  function requestTts(id, token, text) {
    return _insertRow({
      id: id, title: '읽기', status: 'pending', kind: 'chat',
      note: text, client_token: token,
      meta: { app: 'voice-memo-test', tts_only: true }
    });
  }

  /* ---------- 음성/사진 대화 한 턴(통합) ----------
   * (선택) 음성 오디오 + (선택) 사진 여러 장 + 텍스트를 **한 chat 행**으로 보낸다.
   * chat_responder.py 가:
   *   - meta.voice 면 오디오를 whisper 로 전사해 질문으로 삼고(transcript 회신),
   *   - meta.files(사진)면 로컬로 내려받아 케이가 이미지를 직접 보고 답하며(기존 채팅 첨부 통로 재사용),
   *   - meta.speak 면 답을 1번 목소리(ko-KR-SunHiNeural) mp3 로 만들어 summary_json.voice_url 에 첨부.
   * ▶ 규약(상향):
   *   - 음성: voice-audio 버킷 `{id}/voice.{ext}`, meta.audio={key,ext}, meta.voice=true.
   *   - 사진: voice-audio 버킷 `{id}/img_{i}.{ext}`, meta.files=[{key,ext,name,size,mime,kind:'image'}].
   *   - 사진/음성 워커·명함 등록(collect.py)과는 kind='chat' 로 완전히 분리 — 충돌 없음. */
  function sendChatTurn(memo, opts) {
    opts = opts || {};
    var files = opts.files || [];
    var audioBlob = opts.audioBlob || null;
    var big = firstTooBig(files);                     // v6.6: 채팅 사진 5GB 초과 거절
    if (big) return Promise.reject(big);
    var meta = { app: 'voice-memo-test', thread: memo.thread, from: 'phone', speak: !!opts.speak };
    if (opts.modelPref) meta.model_pref = opts.modelPref;   // v5.8: 오퍼스 5.5 1회 지정
    var imgMeta = [];
    function uploadImages(i) {
      if (i >= files.length) return Promise.resolve();
      var f = files[i];
      var ext = extForFile(f, 'photo');
      var key = memo.id + '/img_' + i + '.' + ext;
      return uploadObject(key, f).then(function () {
        imgMeta.push({ key: key, ext: ext, name: f.name || ('img' + i + '.' + ext),
                       size: f.size || 0, mime: f.type || '', kind: 'image' });
        opts.onProgress && opts.onProgress(i + 1, files.length);
        return uploadImages(i + 1);
      });
    }
    function uploadVoice() {
      if (!audioBlob) return Promise.resolve();
      var ext = extFromBlob(audioBlob);
      var key = memo.id + '/voice.' + ext;
      return uploadObject(key, audioBlob).then(function () {
        meta.voice = true; meta.audio = { key: key, ext: ext };
      });
    }
    return uploadImages(0).then(uploadVoice).then(function () {
      if (imgMeta.length) meta.files = imgMeta;
      return _insertRow({
        id: memo.id, title: memo.title || '음성대화', status: 'pending', kind: 'chat',
        note: memo.note || null, client_token: memo.token, meta: meta
      });
    });
  }

  /* ---------- 채팅 파일 첨부(대표님 → 케이, 상향) ----------
   * 사진/영상 파이프라인과 같은 방식으로 파일을 voice-audio 버킷에 올리고,
   * kind='chat' 행을 만들어 chat_responder.py 가 채팅 맥락(thread)과 함께 집어가게 한다.
   *
   * ▶ 앱→워커 규약(상향):
   *   - 파일 실체: 버킷 voice-audio, 경로 `{id}/{idx}.{ext}`(묶음) 또는 `{id}/part_{k}.{ext}`(청크).
   *   - 행: kind='chat', note=케이에게 보일 안내문(파일 목록 포함), client_token, status='pending'.
   *   - meta: { app, thread, from:'phone', files:[{key,ext,name,size,mime}], (청크면 chunked:true,total,ext) }.
   *   - chat_responder.py 는 note 로 오늘도 케이에게 전달되므로 텍스트 답은 즉시 동작하고,
   *     meta.files 를 내려받아 케이가 실제로 파일을 쓰게 하려면 워커에 다운로드 단계 추가 필요(보고 참조).
   */
  function _insertChatFileRow(memo, filesMeta, extra) {
    var meta = { app: 'voice-memo-test', thread: memo.thread, from: 'phone', files: filesMeta };
    if (memo.modelPref) meta.model_pref = memo.modelPref;   // v5.8: 오퍼스 5.5 1회 지정
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) meta[k] = extra[k];
    return _insertRow({
      id: memo.id, title: memo.title || '파일', status: 'pending', kind: 'chat',
      note: memo.note || null, client_token: memo.token, meta: meta
    });
  }
  // 여러 파일(각 ≤ 단일 업로드 한도)을 한 채팅 행으로. onProgress(done,total).
  function sendChatBatch(memo, files, onProgress) {
    var big = firstTooBig(files);                     // v6.6
    if (big) return Promise.reject(big);
    var filesMeta = [], idx = 0;
    function step() {
      if (idx >= files.length) { return _insertChatFileRow(memo, filesMeta); }
      var file = files[idx];
      var ext = extForFile(file, 'file');
      var key = memo.id + '/' + idx + '.' + ext;
      return uploadObject(key, file).then(function () {
        filesMeta.push({ key: key, ext: ext, name: file.name || ('file' + idx + '.' + ext),
                         size: file.size || 0, mime: file.type || '' });
        idx++; onProgress && onProgress(idx, files.length);
        return step();
      });
    }
    return step();
  }
  // 큰 파일 1개: 청크로 나눠 페이싱 업로드(영상 청크와 동일 규약). onProgress('upload',done,total).
  function sendChatChunked(memo, file, onProgress) {
    if (((file && file.size) || 0) > MAX_UPLOAD_BYTES) return Promise.reject(tooBigErr(file));   // v6.6
    var ext = extForFile(file, 'file');
    var total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    var fileMeta = { name: file.name || ('file.' + ext), size: file.size || 0, mime: file.type || '', ext: ext };
    return _insertChatFileRow(memo, [fileMeta], { chunked: true, ext: ext, total: total }).then(function () {
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

  /* ---------- 문서 뷰어: 폰 문서 → PC 변환(PDF) → 폰 표시 ----------
   * 사진/영상/채팅파일과 완전히 분리된 kind='doc' 통로. 전용 상주 워커(doc_worker.py)가 처리한다.
   * ▶ 앱→워커 규약(상향):
   *   (A) 폰에서 고른 파일: voice-audio 버킷 `{id}/src.{ext}`(작은 파일) 또는
   *       `{id}/part_{k}.{ext}`(큰 파일, 청크·페이싱). row.kind='doc',
   *       meta={app,from:'phone', file:{key?,ext,name,size,mime}, (청크면 chunked:true,ext,total)}.
   *   (B) 이미 케이가 보낸 문서(채팅 첨부)를 뷰어로: 업로드 없이 그 서명URL만 넘긴다.
   *       meta={app,from:'phone', source_url:<voice-docs 서명URL>, name, ext}.
   * ▶ 워커→앱 규약(하향): 결과 PDF 를 voice-docs `{id}/view.pdf` 로 올리고 7일 서명URL(inline) 을
   *   summary_json.doc={pdf_url,name,pages?} 에 기록. 실패 시 summary_json.doc={error:"..."}.
   *   앱은 poll() → docResultFrom() 로 읽어 PDF.js 로 표시. (PDF 원본이면 변환 없이 그대로 전달.) */
  // v6.9 검토 반영: 문서 요청 행 등록에도 시간 제한(30초)과 재시도(3번)를 둔다 — 조각 전송과 같은 이유
  //   (fetch 는 시간 제한이 없어 망이 멈추면 영영 안 끝남). 같은 id 재등록은 409=이미 등록=성공이라 안전하다.
  //   ⚠️ 다른 종류(채팅 등)의 _insertRow 는 그대로 둔다(시간 초과 뒤 실제로는 등록된 경우 새 id 로 다시 보내 중복될 수 있어서).
  var DOC_ROW_TIMEOUT_MS = 30000, DOC_ROW_TRIES = 3;
  function _insertRowTimed(body) {
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, DOC_ROW_TIMEOUT_MS) : null;
    return fetch(CONFIG.url + '/rest/v1/' + CONFIG.table, {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
                 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(body),
      signal: ac ? ac.signal : undefined
    }).then(function (r) {
      if (to) clearTimeout(to);
      if (r.ok || r.status === 409) return true;
      var e = voiceErr(r.status >= 500 ? 'row_server' : 'row_fail', { status: r.status }); e.retry = r.status >= 500; throw e;
    }, function () {
      if (to) clearTimeout(to);
      var e = voiceErr('row_net', {}); e.retry = true; throw e;
    });
  }
  function _insertDocRow(memo, meta) {
    var m = { app: 'voice-memo-test', from: 'phone' };
    for (var k in meta) if (meta.hasOwnProperty(k)) m[k] = meta[k];
    var body = { id: memo.id, title: memo.title || '문서', status: 'pending', kind: 'doc',
                 note: memo.note || null, client_token: memo.token, meta: m };
    function attempt(n) {
      return _insertRowTimed(body).catch(function (e) {
        if (!e.retry || n >= DOC_ROW_TRIES) throw e;
        return new Promise(function (res) { setTimeout(res, n * 2000); })
          .then(function () { return _waitOnline(60000); })
          .then(function () { return attempt(n + 1); });
      });
    }
    return attempt(1);
  }
  /* ---------- v6.9(2026-09-29, O-0097) 문서 뷰어 업로드 — 조각이 빠지지 않게 ----------
   * ▶ 사고(9/29 19:08): 56MB 한글을 두 조각(40MB+15.7MB)으로 올리는데 둘째 조각이 폰에서 끝내 안 올라갔다.
   *   옛 방식은 ① 행(kind='doc')을 '먼저' 만들고 조각을 뒤에 올렸고 ② 조각 전송이 fetch(시간 제한 없음)라
   *   앱이 화면 뒤로 가거나 망이 바뀌어 소켓이 멈추면 약속(promise)이 영영 끝나지 않았다(재시도도 안 돎).
   *   PC 워커는 이미 생긴 행의 둘째 조각을 최대 10분 기다리느라 뒤 요청까지 막혔다.
   * ▶ 고침:
   *   1) 조각을 '전부' 올리고 서버가 조각마다 받았다고 답한(2xx 또는 "이미 있음") 것을 확인한 '뒤에만' 행을 만든다.
   *      → PC 워커는 행을 보는 순간 조각이 다 있으므로 조각을 기다리며 막히는 일이 없다.
   *      (앱의 공개 키는 voice-audio 에 '올리기'만 허용되고 목록 보기는 막혀 있어, 서버 목록 대조 대신
   *       조각별 서버 응답을 장부(opts.done)에 적고 마지막에 빠진 번호가 없는지 확인한다.)
   *   2) 조각마다 XHR(진행률 %) + 멈춤 감시(45초 동안 한 바이트도 안 가면 끊고 다시) + 최대 5번 재시도
   *      (2·4·8·15초 쉬고, 인터넷이 끊겨 있으면 다시 연결될 때까지 최대 1분 기다렸다가).
   *   3) 조각은 먼저 메모리로 읽고 올린다(녹음 조각과 같은 방식 — 폰 파일 읽기 실패가 '인터넷 끊김'으로 둔갑하지 않게).
   *   4) 이어 올리기: 이미 올라간 조각 번호(opts.done)는 건너뛴다 → [다시 시도] 때 처음부터 다시 올리지 않는다.
   *   ⚠️ 워커 규약은 그대로(작은 파일 `{id}/src.{ext}`, 큰 파일 `{id}/part_{k}.{ext}` + meta.chunked/total) — PC 수정 불필요.
   *   ⚠️ 페이싱(PC가 받아 간 만큼만 앞서 올리기)은 문서 뷰어에서 뺐다: 행이 없으면 PC가 받아 가지 않으므로.
   *      서버에는 한때 파일 크기만큼 조각이 쌓인다(5GB 한도·Pro 요금제 안). */
  var DOC_STALL_MS = 45000;                          // 45초 동안 한 바이트도 안 올라가면 끊긴 것으로 보고 다시 올림
  var DOC_PART_TRIES = 5;                            // 조각 하나당 최대 시도 횟수
  var DOC_RETRY_WAIT = [2000, 4000, 8000, 15000];    // 재시도 사이 쉬는 시간
  var DOC_NO_RETRY = { too_big: 1, too_big_server: 1, bad_key: 1, auth: 1, unreadable: 1, cancelled: 1 };

  // 한 조각 POST(XHR). 성공·중복=key. ctl.cancelled 면 즉시 중단. onBytes(보낸 바이트).
  function _docXhrPost(key, body, onBytes, ctl, info) {
    var size = (body && (body.byteLength || body.size)) || 0;
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest(), lastTick = Date.now(), done = false, stalled = false, timer = null;
      function onVis() { if (!document.hidden) lastTick = Date.now(); }   // 화면 복귀 직후 오판 방지(유예)
      function finish(err) {
        if (done) return; done = true;
        if (timer) clearInterval(timer);
        try { document.removeEventListener('visibilitychange', onVis); } catch (x) {}
        if (ctl && ctl.xhr === xhr) ctl.xhr = null;
        if (err) reject(err); else resolve(key);
      }
      if (ctl) ctl.xhr = xhr;
      try { document.addEventListener('visibilitychange', onVis); } catch (x) {}
      xhr.open('POST', CONFIG.url + '/storage/v1/object/' + CONFIG.bucket + '/' + key, true);
      xhr.setRequestHeader('apikey', CONFIG.key);
      xhr.setRequestHeader('Authorization', 'Bearer ' + CONFIG.key);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (xhr.upload) xhr.upload.onprogress = function (ev) { lastTick = Date.now(); if (onBytes) onBytes(ev.loaded || 0); };
      xhr.onload = function () {
        if ((xhr.status >= 200 && xhr.status < 300) || isDuplicateStorage(xhr.status, xhr.responseText)) {
          if (onBytes) onBytes(size); return finish(null);
        }
        var c = classifyStorageFail(xhr.status, xhr.responseText);
        finish(voiceErr(c.reason, { name: info.name, size: info.size, status: xhr.status, code: c.code }));
      };
      xhr.onerror = function () { finish(voiceErr('network', info)); };
      xhr.onabort = function () { finish(voiceErr((ctl && ctl.cancelled) ? 'cancelled' : (stalled ? 'stalled' : 'network'), info)); };
      timer = setInterval(function () {
        if (ctl && ctl.cancelled) { try { xhr.abort(); } catch (x) {} return; }
        if (Date.now() - lastTick > DOC_STALL_MS) { stalled = true; try { xhr.abort(); } catch (x) {} }
      }, 2000);
      try { xhr.send(body); } catch (x) { finish(voiceErr('unreadable', info)); }
    });
  }
  function _waitOnline(maxMs) {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve();
    return new Promise(function (res) {
      var t = setTimeout(done, maxMs);
      function done() { clearTimeout(t); global.removeEventListener('online', done); res(); }
      global.addEventListener('online', done);
    });
  }
  // 조각 하나: 메모리로 읽기 → 올리기(재시도). onRetry(시도번호, 오류) 선택.
  function _uploadDocPart(key, blob, info, onBytes, ctl, onRetry) {
    return readAllBytes(blob, info).then(function (buf) {
      function attempt(n) {
        if (ctl && ctl.cancelled) return Promise.reject(voiceErr('cancelled', info));
        return _docXhrPost(key, buf, onBytes, ctl, info).catch(function (e) {
          if ((e && DOC_NO_RETRY[e.reason]) || n >= DOC_PART_TRIES) throw e;
          if (onRetry) { try { onRetry(n, e); } catch (x) {} }
          if (onBytes) onBytes(0);
          var wait = DOC_RETRY_WAIT[Math.min(n - 1, DOC_RETRY_WAIT.length - 1)];
          return new Promise(function (res) { setTimeout(res, wait); })
            .then(function () { return _waitOnline(60000); })
            .then(function () { return attempt(n + 1); });
        });
      }
      return attempt(1);
    });
  }
  // (A) 폰에서 고른 문서 1개 업로드 + kind='doc' 행.
  //   onProgress('upload', 끝난조각수, 전체조각수) — 옛 호출 호환.
  //   opts(선택, v6.9):
  //     done      : { k: true } 이미 서버가 받았다고 답한 조각 번호(이어 올리기 장부) — 건너뜀
  //     onPartOk  : function(k, total) 조각 k 확인됨(장부 저장용)
  //     onBytes   : function(보낸바이트, 전체바이트) 진행률
  //     onRetry   : function(k, 시도번호, 오류) 다시 올리는 중 안내
  //     onRowSent : function() 행 등록까지 끝남
  //     ctl       : { cancelled:false } 밖에서 cancelled=true 로 바꾸면 올리던 것을 멈춤
  //   반환: { total, chunked }
  function sendDoc(memo, file, onProgress, opts) {
    opts = opts || {};
    if (((file && file.size) || 0) > MAX_UPLOAD_BYTES) return Promise.reject(tooBigErr(file));   // v6.6
    var ext = extForFile(file, 'file');
    var size = file.size || 0;
    var fileMeta = { ext: ext, name: file.name || ('doc.' + ext), size: size, mime: file.type || '' };
    var chunked = size > CHUNK_SIZE;
    var total = chunked ? Math.max(1, Math.ceil(size / CHUNK_SIZE)) : 1;
    var done = opts.done || {};
    var ctl = opts.ctl || { cancelled: false };
    function keyOf(k) { return chunked ? (memo.id + '/part_' + k + '.' + ext) : (memo.id + '/src.' + ext); }
    function bytesDone() {
      var s = 0;
      for (var i = 0; i < total; i++) if (done[i]) s += Math.min(size, (i + 1) * CHUNK_SIZE) - i * CHUNK_SIZE;
      return s;
    }
    var k = 0;
    function step() {
      if (ctl.cancelled) return Promise.reject(voiceErr('cancelled', {}));
      if (k >= total) return Promise.resolve();
      if (done[k]) { k++; return step(); }                                    // 이미 올라간 조각은 건너뜀
      var start = k * CHUNK_SIZE, end = Math.min(size, (k + 1) * CHUNK_SIZE);
      var base = bytesDone();
      var info = { name: fileMeta.name + (chunked ? ' (조각 ' + (k + 1) + '/' + total + ')' : ''), size: end - start };
      var kk = k;
      return _uploadDocPart(keyOf(kk), file.slice(start, end), info, function (sent) {
        if (opts.onBytes) opts.onBytes(Math.min(size, base + sent), size);
      }, ctl, function (n, e) { if (opts.onRetry) opts.onRetry(kk, n, e); }).then(function () {
        done[kk] = true;
        if (opts.onPartOk) { try { opts.onPartOk(kk, total); } catch (x) {} }
        if (onProgress) onProgress('upload', kk + 1, total);
        k++;
        return step();
      });
    }
    return step().then(function () {
      // 마지막 확인: 모든 조각을 서버가 받았다고 답했는지(장부에 빠진 번호 없음) — 하나라도 없으면 행을 만들지 않는다.
      for (var i = 0; i < total; i++) if (!done[i]) throw voiceErr('parts_missing', { name: fileMeta.name });
      if (ctl.cancelled) throw voiceErr('cancelled', {});
      if (!chunked) fileMeta.key = keyOf(0);
      var meta = chunked ? { file: fileMeta, chunked: true, ext: ext, total: total } : { file: fileMeta };
      return _insertDocRow(memo, meta);                                      // 409(이미 등록)=성공
    }).then(function () {
      if (opts.onRowSent) { try { opts.onRowSent(); } catch (x) {} }
      return { total: total, chunked: chunked };
    });
  }
  // (B) 이미 우편함(voice-docs)에 있는 문서(케이가 보낸 첨부)를 업로드 없이 변환 요청.
  function convertDoc(memo, sourceUrl, name, ext) {
    return _insertDocRow(memo, { source_url: sourceUrl, name: name || '문서', ext: (ext || '').toLowerCase() });
  }
  // poll() 결과에서 문서 변환 결과를 정규화. {pdf_url, name, pages, error} 또는 null.
  function docResultFrom(res) {
    var d = res && res.summary_json && res.summary_json.doc;
    if (!d) return null;
    return { pdf_url: d.pdf_url || null, name: d.name || '', pages: d.pages || 0, error: d.error || null };
  }

  /* ---------- 케이 답장의 첨부(케이 → 대표님, 하향) ----------
   * ▶ 워커→앱 규약(하향): 케이(chat_responder/워커)가 산출물을 voice-docs 버킷에 올리고
   *   7일 서명URL 을 만든 뒤, 채팅 답장 행에 아래 중 하나로 기록하면 앱이 첨부로 렌더링한다.
   *     (1) summary_json.attachments = [{ name, url, mime, size, kind }]   ← 권장(여러 개·임의 형식)
   *     (2) 기존 top-level 필드 pdf_url / docx_url / pptx_url               ← 기존 문서 생성기 그대로 호환
   *   앱은 poll() 결과에서 이 둘을 모두 읽어 말풍선 아래 파일 칩으로 보여주고,
   *   탭하면 서명URL 을 연다(문서는 다운로드, PDF/이미지는 열람). 물리적 한계: 서명URL 7일 만료.
   * 아래 헬퍼는 poll() 결과 한 건에서 첨부 목록을 정규화한다. */
  function attachmentsFrom(res) {
    var out = [];
    var sj = res && res.summary_json;
    if (sj && sj.attachments && sj.attachments.length) {
      sj.attachments.forEach(function (a) {
        if (a && a.url) out.push({ name: a.name || '파일', url: a.url, mime: a.mime || '', size: a.size || 0, kind: a.kind || '' });
      });
    }
    // 기존 문서 생성 필드도 첨부로 흡수(있을 때만)
    [['pdf_url', 'PDF', 'application/pdf'], ['docx_url', 'Word 문서', ''], ['pptx_url', 'PPT', '']].forEach(function (d) {
      var u = res && res[d[0]];
      if (u && !out.some(function (x) { return x.url === u; })) out.push({ name: d[1], url: u, mime: d[2], size: 0, kind: 'document' });
    });
    return out;
  }

  /* ---------- 사무소 정보발송(케이가 먼저 보낸 방송) 되읽기 ----------
   * 케이(PC)가 notify_app.py 로 넣은 kind='chat', meta.thread='office_broadcast' 행들을
   * 전용 RPC(list_office_pushes)로 되읽는다. 이 RPC 는 broadcast 행의 필요한 필드만
   * (id, content_md, summary_json, ts) 시간순으로 돌려준다 — voice_memos 전체를 열지 않으므로
   * 다른 채팅·음성·건강 데이터는 새지 않는다. 토큰 불필요(대표님 1인 앱, broadcast 전용).
   *   since : ISO 문자열(그 시각 '이후'에 처리된 방송만). 반환: [{id, content_md, summary_json, ts}] */
  function listOfficePushes(since) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_office_pushes', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_since: since || null })
    }).then(function (r) { if (!r.ok) throw new Error('방송 조회 실패(HTTP ' + r.status + ')'); return r.json(); })
      .then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  /* ---------- PC↔폰 채팅 동기화(1단계) 되읽기 ----------
   * 이 사용자의 채팅 대화 줄(kind='chat')을 시간순으로 되읽는다. 전용 RPC(list_chat_history)가
   * 필요한 칸만(id, note=질문, content_md=답, summary_json=첨부, ts) 돌려준다 —
   * transcript/client_token 등 개인·보안 필드는 서버에서 제외한다.
   *   since : ISO 문자열(그 시각 '이후'에 처리된 대화만).  pass : 연동 암호(서버 대조).
   *   반환: [{id, note, content_md, summary_json, ts}]
   * 암호가 틀리면 서버가 예외(BAD_PASSCODE)→여기서 err.badpass=true 로 표시해 앱이 재입력하게 한다. */
  function listChatHistory(since, pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_chat_history', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_since: since || null, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e;   // 암호 불일치(또는 미설정)
      }
      if (!r.ok) throw new Error('대화 동기화 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  /* ---------- v7.0(O-0102) 채팅 「개수 상한 없애기」: 대화+방송 한 쪽씩 되읽기 ----------
   * 전용 RPC(list_chat_page)가 대화 줄(src='chat')과 케이 방송(src='push')을 한 시간표로 합쳐
   *   최신부터 limit 건씩 돌려준다(숨김 행 제외). 커서(beforeTs + beforeId)보다 옛것만 → 끝까지 넘길 수 있다.
   *   ⚠️ beforeTs 는 서버가 준 ts 문자열을 그대로 넘긴다(Date 로 바꾸면 마이크로초가 잘려 경계 행이 샌다).
   * 🔒 연동 암호 게이트(list_chat_history 와 동일): 불일치면 err.badpass.
   *   RPC 가 아직 서버에 없으면(404) err.missing=true → 앱이 예전 방식(최신 300/1000)으로 자동 폴백.
   *   반환: [{src, id, note, content_md, summary_json, ts}] (최신→옛 순) */
  function listChatPage(beforeTs, beforeId, limit, pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_chat_page', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_before_ts: beforeTs || null, p_before_id: beforeId || null, p_limit: limit || 150, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 404) { var m = new Error('PAGE_RPC_MISSING'); m.missing = true; throw m; }   // 서버 SQL 미적용
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e;   // 암호 불일치(또는 미설정)
      }
      if (!r.ok) throw new Error('이전 대화 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  /* ---------- 회의 요약 탭(v5.2): 서버의 done 녹음/영상 요약본 목록 ----------
   * 전용 RPC(list_recent_memos)가 done 인 audio/video 행만, 요약 열람에 필요한 칸
   *   (id, kind, title, created_at, summary_json, content_md, transcript)만 최근순으로 돌려준다.
   *   client_token·audio_path 등 보안 필드와 타 kind(채팅·사진·공유함 등 개인정보)는 서버에서 제외.
   * 재설치로 로컬 히스토리가 비어도 이 탭은 서버를 직접 보여주므로 항상 최신. 읽기 전용.
   * 🔒 연동 암호 게이트(채팅·공유함과 동일): pass 를 함께 넘긴다. 암호 불일치/미설정이면 서버가
   *   BAD_PASSCODE → 여기서 err.badpass=true 로 표시해 앱이 암호 입력창을 띄우게 한다(민감정보 보호).
   *   반환: [{id, kind, title, created_at, summary_json, content_md, transcript}]. */
  function listRecentMemos(limit, pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_recent_memos', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: limit || 100, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) {
        var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e;   // 암호 불일치(또는 미설정)
      }
      if (!r.ok) throw new Error('회의 요약 목록 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  /* ---------- 작업 현황(v5.8): PC 지시 대장의 서버 사본(office_orders) ----------
   * 원본은 PC 파일(office-orders\orders.json)이고, orders_log.py 가 쓸 때마다 서버 표로 사본을 올린다.
   * 조회는 연동 암호 게이트 RPC 2개(채팅·회의 요약과 동일 패턴 — 불일치면 err.badpass):
   *   listOfficeOrders(limit, pass)         → 「작업 현황」 화면(미완료 먼저, 그다음 최근 끝난 것)
   *   listOfficeOrdersBySource(ids, pass)   → 채팅 말풍선 아래 「작업 카드」(내 메시지 행 id → 대장 항목)
   * 반환 행: {id(O-0012), seq, channel, summary, source_id, status, result, model, job_seq, job_status,
   *           received_at, updated_at, closed_at} */
  function _ordersRpc(name, body, what) {
    return fetch(CONFIG.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error(what + ' 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }
  /* (O-0129) 홈 「오늘 한눈에」: PC 가 만든 오늘 요약(home_digest) 한 줄 — 연동 암호 게이트 RPC get_home_digest.
   *   반환 {date:'YYYY-MM-DD', generated_at, cal_ok, mail_ok, events:[{start,end,all_day,title,place}], mails:[{from,subject,why,received_at}]}
   *   서버에 RPC 가 아직 없으면(SQL 미적용) err.notready=true → 카드는 일정·메일 칸을 숨기고 「챙길 일」만 보인다. */
  function getHomeDigest(pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/get_home_digest', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 404) { var n = new Error('NOT_READY'); n.notready = true; throw n; }
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('오늘 요약 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (d) { return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null; });
  }
  function listOfficeOrders(limit, pass) {
    return _ordersRpc('list_office_orders', { p_limit: limit || 60, p_pass: pass || '' }, '작업 현황');
  }
  function listOfficeOrdersBySource(ids, pass) {
    ids = (ids || []).filter(function (x) { return !!x; }).slice(0, 100);
    if (!ids.length) return Promise.resolve([]);
    return _ordersRpc('list_office_orders_by_source', { p_ids: ids, p_pass: pass || '' }, '작업 카드');
  }
  /* v5.9 작업 현황 「지우기」 = 숨김(서버 hidden_at 표시만, 행·PC 대장 원본은 그대로 → 되살리기 가능).
   *   hideOfficeOrders(ids, pass)  → 숨긴 건수. 서버가 끝난 상태(완료·취소·실패·보류)만 받아준다.
   *   restoreOfficeOrders(pass)    → 숨긴 것 전부 되살린 건수.
   *   서버에 RPC 가 아직 없으면(SQL 미적용) err.notready=true. 암호 불일치면 err.badpass=true. */
  function _ordersWriteRpc(body) {
    return fetch(CONFIG.url + '/rest/v1/rpc/hide_office_orders', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 404) { var n = new Error('NOT_READY'); n.notready = true; throw n; }   // 함수 없음(SQL 미적용)
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('작업 현황 정리 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (n) { return (typeof n === 'number') ? n : (parseInt(n, 10) || 0); });
  }
  function hideOfficeOrders(ids, pass) {
    ids = (ids || []).filter(function (x) { return !!x; }).slice(0, 200);
    if (!ids.length) return Promise.resolve(0);
    return _ordersWriteRpc({ p_ids: ids, p_pass: pass || '', p_hide: true });
  }
  function restoreOfficeOrders(pass) {
    return _ordersWriteRpc({ p_ids: null, p_pass: pass || '', p_hide: false });
  }

  /* 회의 요약 항목 이름 변경(v5.3): 서버 title 만 바꾼다(PC 원본 .md·collect.py 무관).
   *   연동 암호 게이트(불일치/미설정이면 badpass). 반환: true(수정 1건) / false(대상 없음).
   *   ⚠️ 삭제는 별도 함수가 아니라 기존 hideMemo(소프트삭제) 재사용 — list_recent_memos 가 숨김 제외. */
  function renameMemo(id, title, pass) {
    if (!id) return Promise.resolve(false);
    return fetch(CONFIG.url + '/rest/v1/rpc/rename_memo', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_title: title || '', p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('이름 변경 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (n) { return (typeof n === 'number') ? n > 0 : !!n; });   // 수정 행 수>0 → true
  }

  /* ---------- 💡 아이디어 수첩(v5.5, 2026-09-24) ----------
   * 음성 아이디어: 기존 안전 업로드 send(memo, blob) 를 그대로 쓰되 memo.kind='idea' 로 보낸다
   *   (원본 idbPut 선영속 → 업로드 → 행 INSERT, 폰 원본 삭제는 PC 정리(done) 확인 뒤 — v5.1 규약 동일).
   * 글 아이디어: 파일 없이 kind='idea' 행만(note=글). 서버 PC 워커(idea_worker.py)가 활용 제안서를 만든다.
   * 조회·결정은 연동 암호 게이트 RPC(list_ideas / set_idea_decision). 삭제는 기존 hideMemo 재사용. */
  function sendIdeaText(memo) {
    return _insertRow({
      id: memo.id, title: '아이디어', status: 'pending', kind: 'idea',
      note: memo.note || '', client_token: memo.token,
      meta: { app: 'voice-memo-test', from: 'phone', input: 'text' }
    });
  }
  function listIdeas(limit, pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_ideas', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: limit || 100, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('아이디어 목록 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }
  // decision: 'go' | 'hold' | 'none', choice: 진행할 활용 방향 번호(0부터, go 일 때만 의미). 반환 true=저장됨
  function setIdeaDecision(id, decision, choice, pass) {
    if (!id) return Promise.resolve(false);
    return fetch(CONFIG.url + '/rest/v1/rpc/set_idea_decision', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_decision: decision || 'none', p_choice: (choice == null ? null : choice), p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('결정 저장 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (n) { return (typeof n === 'number') ? n > 0 : !!n; });
  }

  /* v4.0: 멀티기기 삭제 — 서버에 "숨김(소프트삭제)" 표시. 조회 RPC들이 숨김 행을 제외한다.
   *   물리 삭제가 아니라 hidden_memos 에 id 만 넣는 것(원본 유지·복구 가능). 연동 암호로 잠금.
   *   반환: true(숨김 처리/이미 숨김) — 실패해도 로컬 tombstone 이 있어 이 기기엔 즉시 사라진다. */
  function hideMemo(id, pass) {
    if (!id) return Promise.resolve(false);
    return fetch(CONFIG.url + '/rest/v1/rpc/hide_memo', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('삭제 반영 실패(HTTP ' + r.status + ')');
      return true;
    });
  }

  /* ---------- PC↔폰 공유함(locker): 케이 없이 두 기기끼리 글·파일 보관 ----------
   * 케이(chat_responder)·어떤 워커도 이 종류(kind='locker')를 처리하지 않는다(순수 보관).
   * 파일은 "공개 버킷 locker"에 올려 공개 URL 로 상대 기기에서 다운로드한다(service_role 서명 불필요).
   *   - 경로가 무작위 UUID 라 링크를 모르면 접근 불가(개인 보관함 수준). 만료 없음(보관함 성격에 맞음).
   *   - 조회는 list_locker(since, pass) — list_chat_history 와 같은 암호 잠금 패턴. */
  var LOCKER_BUCKET = 'locker';
  /* v6.3(2026-09-27) 공유함 용량·파일명·실패안내 개선 (대표님 "용량제한 없애" · "파일명도 거절하지 않게").
   *   ▶ 원인(확정): 55.8MB hwp → Supabase 가 400 {"statusCode":"413","code":"EntityTooLarge"} 로 거절.
   *     locker 버킷 한도는 비어 있어(null) 프로젝트 「전역 업로드 한도」(50MB)가 그대로 적용됐다.
   *     파일명은 원인 아님 — 저장 키는 원래부터 `{uuid}/{번호}.{ext}`(원래 이름은 meta 에만).
   *   ▶ 해결: 서버 전역 한도를 올리고(요금제 Pro, 대시보드 설정) 버킷별 한도를 명시(SQL 별도 파일).
   *     앱은 조각 없이 한 번에 올리되(받는 쪽·뷰어·다운로드·옛 파일 전부 그대로 = 폰 APK 재설치 없이 호환),
   *       · XHR 로 올려 진행률(%)을 보여 주고,
   *       · 실패하면 이유(용량/인터넷/파일 읽기/서버/권한)를 쉬운 말로 돌려준다(err.reason, err.friendly).
   *   ⚠️ LOCKER_MAX_BYTES 는 서버 전역 한도와 같게 맞춘다(서버가 더 낮으면 서버 413 → 'too_big_server' 안내). */
  var LOCKER_MAX_BYTES = MAX_UPLOAD_BYTES;           // v6.6: 공용 상한(5GB = locker 버킷 한도)과 하나로
  var LOCKER_STALL_MS = 120000;                      // 2분 동안 한 바이트도 안 올라가면 끊긴 것으로 보고 중단
  function lockerPublicUrl(key) { return CONFIG.url + '/storage/v1/object/public/' + LOCKER_BUCKET + '/' + key; }
  function fmtSize(n) {
    n = n || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + 'GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
  }
  // 실패 이유 → 대표님이 읽을 쉬운 문장.
  //   reason: too_big | too_big_server | network | stalled | unreadable | bad_key | auth | server | row | unknown
  function lockerErr(reason, info) {
    info = info || {};
    var nm = info.name ? '「' + info.name + '」 ' : '';
    var table = {
      too_big: nm + '파일이 너무 커요(' + fmtSize(info.size) + '). ' + MAX_UPLOAD_LABEL + '까지 보낼 수 있어요.',
      too_big_server: nm + '파일이 서버가 받는 최대 크기를 넘었어요(' + fmtSize(info.size) + '). ' + MAX_UPLOAD_LABEL + '까지 보낼 수 있어요. 5GB 이하인데도 이렇게 나오면 소장에게 알려 주세요.',
      network: '인터넷 연결이 끊겨 ' + nm + '전송하지 못했어요. 연결을 확인하고 다시 보내 주세요.',
      stalled: '전송이 2분 넘게 멈춰 ' + nm + '중단했어요(인터넷이 느리거나 끊김). 다시 보내 주세요.',
      unreadable: nm + '파일을 읽지 못했어요. 폴더이거나, 옮겨졌거나 지워진 파일일 수 있어요. 파일을 다시 골라 주세요.',
      bad_key: nm + '서버가 저장 경로를 거절했어요(파일 이름 문제). 소장에게 알려 주세요.',
      auth: '서버가 권한 문제로 거절했어요(HTTP ' + (info.status || '?') + '). 소장에게 알려 주세요.',
      server: '서버가 잠시 응답하지 않아요(HTTP ' + (info.status || '?') + '). 잠시 뒤 다시 보내 주세요.',
      row: '파일은 올라갔지만 공유함 목록에 등록하지 못했어요(HTTP ' + (info.status || '?') + '). 다시 보내 주세요.',
      unknown: nm + '올리지 못했어요' + (info.status ? '(HTTP ' + info.status + ')' : '') + '. 다시 보내 주세요.'
    };
    var msg = table[reason] || '올리지 못했어요. 다시 보내 주세요.';
    var e = new Error(msg);
    e.reason = reason; e.friendly = msg; e.status = info.status || 0; e.serverCode = info.code || '';
    return e;
  }
  // 서버 응답(JSON) → 이유 분류. Supabase Storage 는 용량 초과도 HTTP 400 + body.statusCode "413" 로 준다(2026-09-27 실측).
  function classifyStorageFail(status, bodyText) {
    var j = null; try { j = JSON.parse(bodyText || ''); } catch (x) {}
    var code = (j && (j.code || j.error)) || '', sc = String((j && j.statusCode) || '');
    if (status === 413 || sc === '413' || code === 'EntityTooLarge' || /too large|maximum allowed size/i.test(bodyText || '')) return { reason: 'too_big_server', code: code };
    if (code === 'InvalidKey' || /invalid key/i.test(bodyText || '')) return { reason: 'bad_key', code: code };
    if (status === 401 || status === 403 || sc === '403' || sc === '401') return { reason: 'auth', code: code };
    if (status >= 500) return { reason: 'server', code: code };
    return { reason: 'unknown', code: code };
  }
  // 파일 앞부분 1바이트를 실제로 읽어 본다(폴더·사라진 파일이면 실패). true=읽힘.
  function probeReadable(blob) {
    return new Promise(function (resolve) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(true); };
        fr.onerror = function () { resolve(false); };
        fr.readAsArrayBuffer(blob.slice(0, 1));
      } catch (x) { resolve(false); }
    });
  }
  // 한 파일 업로드(XHR — fetch 는 업로드 진행률을 못 준다). onProgress(loadedBytes).
  function uploadLockerObject(key, blob, onProgress, name) {
    var size = (blob && blob.size) || 0;
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest(), lastTick = Date.now(), done = false, stallTimer = null, stalled = false;
      function finish(err) {
        if (done) return; done = true;
        if (stallTimer) clearInterval(stallTimer);
        if (err) reject(err); else resolve(key);
      }
      xhr.open('POST', CONFIG.url + '/storage/v1/object/' + LOCKER_BUCKET + '/' + key, true);
      xhr.setRequestHeader('apikey', CONFIG.key);
      xhr.setRequestHeader('Authorization', 'Bearer ' + CONFIG.key);
      xhr.setRequestHeader('Content-Type', (blob && blob.type) || 'application/octet-stream');
      if (xhr.upload) xhr.upload.onprogress = function (ev) { lastTick = Date.now(); if (onProgress) onProgress(ev.loaded || 0); };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { if (onProgress) onProgress(size); return finish(null); }
        var c = classifyStorageFail(xhr.status, xhr.responseText);
        finish(lockerErr(c.reason, { name: name, size: size, status: xhr.status, code: c.code }));
      };
      // status 0 = 요청 자체가 못 나감: 인터넷 끊김 또는 로컬 파일을 못 읽음(폴더·지워진 파일). 파일을 직접 읽어 구분한다.
      xhr.onerror = function () {
        probeReadable(blob).then(function (ok) {
          finish(lockerErr(ok ? 'network' : 'unreadable', { name: name, size: size }));
        });
      };
      xhr.onabort = function () { finish(lockerErr(stalled ? 'stalled' : 'network', { name: name, size: size })); };
      stallTimer = setInterval(function () {
        if (Date.now() - lastTick > LOCKER_STALL_MS) { stalled = true; try { xhr.abort(); } catch (x) {} }
      }, 5000);
      try { xhr.send(blob); } catch (x) { finish(lockerErr('unreadable', { name: name, size: size })); }
    });
  }
  // memo:{id,token,text}, files:[File]. 파일을 공개 버킷에 올리고 kind='locker' 행을 만든다.
  // onProgress(sentBytes, totalBytes, fileIndex, fileCount) — 선택.
  // 반환: files 메타(공개 url 포함) — 앱이 내 기기 화면에도 다운로드칩을 표시하게.
  // 실패: Error{reason, friendly, status} (lockerErr 참고).
  // 표시명(meta.files[].name)은 원래 이름 그대로(한글·공백·괄호·이모지·긴 이름 OK), 저장 키는 `{uuid}/{번호}.{ext}`(영문·숫자).
  function sendLocker(memo, files, onProgress) {
    files = files || [];
    var filesMeta = [], idx = 0;
    var totalBytes = files.reduce(function (a, f) { return a + ((f && f.size) || 0); }, 0), doneBytes = 0;
    for (var i = 0; i < files.length; i++) {             // 보내기 전에 한도 확인(다 올린 뒤 거절당하지 않게)
      if ((files[i].size || 0) > LOCKER_MAX_BYTES) return Promise.reject(lockerErr('too_big', { name: files[i].name, size: files[i].size }));
    }
    function step() {
      if (idx >= files.length) {
        return _insertRow({
          id: memo.id, title: '공유함', status: 'pending', kind: 'locker',
          note: memo.text || null, client_token: memo.token,
          meta: { app: 'voice-memo-test', from: 'device', files: filesMeta }
        }).then(function () { return filesMeta; }, function (e) {
          var m = /HTTP (\d+)/.exec((e && e.message) || '');
          throw (m ? lockerErr('row', { status: +m[1] }) : lockerErr('network', {}));
        });
      }
      var f = files[idx];
      var ext = extForFile(f, 'locker');
      var key = memo.id + '/' + idx + '.' + ext;
      var nm = f.name || ('file' + idx + '.' + ext);
      return uploadLockerObject(key, f, function (loaded) {
        if (onProgress) onProgress(Math.min(totalBytes, doneBytes + loaded), totalBytes, idx, files.length);
      }, nm).then(function () {
        doneBytes += (f.size || 0);
        filesMeta.push({ key: key, ext: ext, name: nm,
                         size: f.size || 0, mime: f.type || '', url: lockerPublicUrl(key) });
        idx++;
        return step();
      });
    }
    return step();
  }
  function listLocker(since, pass) {
    return fetch(CONFIG.url + '/rest/v1/rpc/list_locker', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_since: since || null, p_pass: pass || '' })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { var e = new Error('BAD_PASSCODE'); e.badpass = true; throw e; }
      if (!r.ok) throw new Error('공유함 조회 실패(HTTP ' + r.status + ')');
      return r.json();
    }).then(function (arr) { return Array.isArray(arr) ? arr : []; });
  }

  // 결과 조회(RPC). 결과 객체 또는 null. (progress/progress_total/progress_msg 포함)
  // ⏱️ 하드 타임아웃(2026-09-22): 폰이 네트워크 전환(WiFi↔LTE)·정체로 소켓이 멈추면 fetch 가 영영
  //   끝나지 않을 수 있다. 그러면 reconcileChat 의 per-메시지 _polling 플래그가 true 로 굳어 더는
  //   폴링도 안 되고, .then 안에 있던 6분 안전망도 돌지 않아 입력창이 영구 잠긴다("한 번 보내면
  //   다음 전송 안 됨"). AbortController 로 15초 안에 강제로 reject 시켜 _polling 이 반드시 풀리게 한다.
  function poll(id, tok) {
    var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = ac ? setTimeout(function () { try { ac.abort(); } catch (e) {} }, 15000) : null;
    function _clr(v) { if (to) clearTimeout(to); return v; }
    function _clrThrow(e) { if (to) clearTimeout(to); throw e; }
    return fetch(CONFIG.url + '/rest/v1/rpc/get_voice_memo', {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_token: tok }),
      signal: ac ? ac.signal : undefined
    }).then(function (r) { if (!r.ok) throw new Error('결과 조회 실패(HTTP ' + r.status + ')'); return r.json(); })
      .then(function (arr) { return (arr && arr[0]) || null; })
      .then(_clr, _clrThrow);
  }

  // 오프라인으로 밀렸던 오디오 재업로드. onEach(memo) 성공 콜백. onFail(memo, err) 실패 콜백(v6.4, 선택 — 이유 안내용).
  function flush(onEach, onFail) {
    return idbAll().then(function (list) {
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.resolve();
        var rec = list[i++];
        // 안전 업로드(2026-09-22, v5.1): 이미 서버로 전송을 마친(=PC 정리 대기 중) 원본은 재전송하지 않는다.
        //   (중복 업로드 방지 — done 확인 후 삭제는 폴링이 담당. 원본은 그대로 보존.)
        //   자동복구/[다시 보내기]가 markResendable 로 sent 를 내리면 그때 이 흐름을 다시 탄다.
        if (rec.sent) { return next(); }
        var memo = { id: rec.id, kind: rec.kind, note: rec.note, title: rec.title, token: rec.token, ext: rec.ext,
                     materials: rec.materials || [], date: rec.date, time: rec.time };   // 회의자료도 함께 재시도
        var p;
        if (rec.files) {
          p = sendBatch(memo, rec.files);              // 사진/영상 묶음 재업로드
        } else if (rec.blob && rec.blob.size > CHUNK_SIZE) {
          p = sendAudioChunked(memo, rec.blob);        // 큰 음성(2시간 등): 조각으로 재업로드(성공해도 done 확인까지 원본 보존)
        } else {
          p = send(memo, rec.blob);                    // 일반 음성 + 회의자료 재업로드(성공해도 done 확인까지 원본 보존)
        }
        return p
          .then(function () { onEach && onEach(memo); })
          .catch(function (e) { try { onFail && onFail(memo, e); } catch (x) {} /* 다음 기회 */ })
          .then(next);
      }
      return next();
    });
  }
  function pendingCount() { return idbAll().then(function (l) { return l.filter(function (r) { return !r.sent; }).length; }); }

  global.OfficeBridge = {
    CONFIG: CONFIG, uuid: uuid, token: token, extFromBlob: extFromBlob,
    send: send, sendBatch: sendBatch, sendVideoChunked: sendVideoChunked, sendAudioChunked: sendAudioChunked,
    createSearch: createSearch, sendChat: sendChat, sendChatTurn: sendChatTurn, requestTts: requestTts, poll: poll, flush: flush, pendingCount: pendingCount,
    sendChatBatch: sendChatBatch, sendChatChunked: sendChatChunked, attachmentsFrom: attachmentsFrom,
    sendDoc: sendDoc, convertDoc: convertDoc, docResultFrom: docResultFrom,
    fmtSize: fmtSize,                   // v6.9: 문서 뷰어 진행 안내(○MB / ○MB)
    listOfficePushes: listOfficePushes, listChatHistory: listChatHistory, hideMemo: hideMemo,
    listChatPage: listChatPage,         // v7.0: 대화+방송 한 쪽씩(개수 상한 없음, 이전 대화 더 보기)
    listRecentMemos: listRecentMemos,   // v5.2: 회의 요약 탭 — 서버 done 요약본 목록
    renameMemo: renameMemo,             // v5.3: 회의 요약 항목 이름 변경(title만)
    sendIdeaText: sendIdeaText, listIdeas: listIdeas, setIdeaDecision: setIdeaDecision,   // v5.5: 💡 아이디어 수첩
    getHomeDigest: getHomeDigest,   // (O-0129) 홈 「오늘 한눈에」
    listOfficeOrders: listOfficeOrders, listOfficeOrdersBySource: listOfficeOrdersBySource,   // v5.8: 작업 현황·작업 카드
    hideOfficeOrders: hideOfficeOrders, restoreOfficeOrders: restoreOfficeOrders,             // v5.9: 작업 현황 끝난 일 지우기(숨김)·되살리기

    sendLocker: sendLocker, listLocker: listLocker, lockerPublicUrl: lockerPublicUrl,
    LOCKER_MAX_BYTES: LOCKER_MAX_BYTES,   // v6.3: 공유함 한 파일 최대(서버 전역 한도와 같게)
    MAX_UPLOAD_BYTES: MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL: MAX_UPLOAD_LABEL,   // v6.6: 모든 파일 보내기 공용 상한(5GB)
    // v3.8 임시 저장: draft 스토어 저장/조회/삭제 + 발송 실패 시 pending 잔재 제거(dropPending)
    saveDraft: draftPut, getDraft: draftGet, delDraft: draftDel, dropPending: idbDel,
    markResendable: markResendable,   // v5.1: 보존 원본을 재전송 대상으로(자동복구/[다시 보내기])
    CHUNK_SIZE: CHUNK_SIZE
  };
  global.addEventListener('online', function () { flush(); });
})(window);

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
    var meta = { app: 'voice-memo-test', ext: memo.ext };
    if (memo.materialsMeta && memo.materialsMeta.length) meta.materials = memo.materialsMeta;   // 회의자료(2026-09-21)
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
  function uploadMaterials(id, materials, onProgress) {
    materials = materials || [];
    var out = [], i = 0;
    function step() {
      if (i >= materials.length) return Promise.resolve(out);
      var f = materials[i];
      var ext = extForFile(f, 'file');
      var key = id + '/mat_' + i + '.' + ext;
      return uploadObject(key, f).then(function () {
        out.push({ key: key, ext: ext, name: f.name || ('mat' + i + '.' + ext),
                   size: f.size || 0, mime: f.type || '' });
        i++; onProgress && onProgress(i, materials.length);
        return step();
      });
    }
    return step();
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
    return uploadMaterials(memo.id, memo.materials || [])
      .then(function (matMeta) { memo.materialsMeta = matMeta; return uploadAudio(memo.id, memo.ext, blob); })
      .then(function (path) { return createMemo(memo, path); })
      .then(function () { return idbDel(memo.id); })   // 성공 시 대기분 제거
      .catch(function (e) {
        return idbPut({ id: memo.id, title: memo.title, token: memo.token, ext: memo.ext, blob: blob,
                        materials: memo.materials || [], date: memo.date, time: memo.time })
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
    return uploadMaterials(memo.id, memo.materials || [])   // 회의자료 먼저(있으면) — 2026-09-21
      .then(function (matMeta) { memo.materialsMeta = matMeta; return _insertChunkedAudioRow(memo, total, ext); })
      .then(function () {
      var k = 0;
      function step() {
        if (k >= total) return Promise.resolve();
        var pacing = (k >= MAX_INFLIGHT)
          ? waitConsumed(memo.id, memo.token, k - MAX_INFLIGHT + 1)
          : Promise.resolve();
        return pacing.then(function () {
          var part = blob.slice(k * CHUNK_SIZE, Math.min(blob.size, (k + 1) * CHUNK_SIZE));
          return uploadPartWithRetry(memo.id, k, ext, part, 3);
        }).then(function () {
          k++; onProgress && onProgress('upload', k, total);
          return step();
        });
      }
      return step();
    }).then(function () { return idbDel(memo.id); })   // 성공 시 대기분 제거
      .catch(function (e) {
        return idbPut({ id: memo.id, title: memo.title, token: memo.token, ext: ext, blob: blob,
                        materials: memo.materials || [], date: memo.date, time: memo.time })
          .then(function () { throw e; });
      });
  }

  // 케이와 대화: 채팅 메시지 1건 등록(kind='chat'). 응답은 poll()의 content_md 로 온다.
  //   opts.speak=true 면 케이 답을 목소리(mp3)로도 만들게 요청(meta.speak).
  function sendChat(id, token, thread, text, opts) {
    opts = opts || {};
    return _insertRow({
      id: id, title: '채팅', status: 'pending', kind: 'chat',
      note: text, client_token: token,
      meta: { app: 'voice-memo-test', thread: thread, speak: !!opts.speak }
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
    var meta = { app: 'voice-memo-test', thread: memo.thread, from: 'phone', speak: !!opts.speak };
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
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) meta[k] = extra[k];
    return _insertRow({
      id: memo.id, title: memo.title || '파일', status: 'pending', kind: 'chat',
      note: memo.note || null, client_token: memo.token, meta: meta
    });
  }
  // 여러 파일(각 ≤ 단일 업로드 한도)을 한 채팅 행으로. onProgress(done,total).
  function sendChatBatch(memo, files, onProgress) {
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
  function _insertDocRow(memo, meta) {
    var m = { app: 'voice-memo-test', from: 'phone' };
    for (var k in meta) if (meta.hasOwnProperty(k)) m[k] = meta[k];
    return _insertRow({
      id: memo.id, title: memo.title || '문서', status: 'pending', kind: 'doc',
      note: memo.note || null, client_token: memo.token, meta: m
    });
  }
  // (A) 폰에서 고른 문서 1개 업로드 + kind='doc' 행. 큰 파일은 청크·페이싱. onProgress('upload',done,total).
  function sendDoc(memo, file, onProgress) {
    var ext = extForFile(file, 'file');
    var fileMeta = { ext: ext, name: file.name || ('doc.' + ext), size: file.size || 0, mime: file.type || '' };
    if ((file.size || 0) <= CHUNK_SIZE) {
      var key = memo.id + '/src.' + ext;
      return uploadObject(key, file).then(function () {
        fileMeta.key = key;
        return _insertDocRow(memo, { file: fileMeta });
      });
    }
    // 큰 파일: 청크로 나눠 올리고 워커가 소비하는 속도에 맞춰 페이싱(영상/채팅 청크와 동일 규약)
    var total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    return _insertDocRow(memo, { file: fileMeta, chunked: true, ext: ext, total: total }).then(function () {
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

  /* ---------- PC↔폰 공유함(locker): 케이 없이 두 기기끼리 글·파일 보관 ----------
   * 케이(chat_responder)·어떤 워커도 이 종류(kind='locker')를 처리하지 않는다(순수 보관).
   * 파일은 "공개 버킷 locker"에 올려 공개 URL 로 상대 기기에서 다운로드한다(service_role 서명 불필요).
   *   - 경로가 무작위 UUID 라 링크를 모르면 접근 불가(개인 보관함 수준). 만료 없음(보관함 성격에 맞음).
   *   - 조회는 list_locker(since, pass) — list_chat_history 와 같은 암호 잠금 패턴. */
  var LOCKER_BUCKET = 'locker';
  function lockerPublicUrl(key) { return CONFIG.url + '/storage/v1/object/public/' + LOCKER_BUCKET + '/' + key; }
  function uploadLockerObject(key, blob) {
    return fetch(CONFIG.url + '/storage/v1/object/' + LOCKER_BUCKET + '/' + key, {
      method: 'POST',
      headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key,
                 'Content-Type': (blob && blob.type) || 'application/octet-stream' },
      body: blob
    }).then(function (r) { if (!r.ok) throw new Error('파일 올리기 실패(HTTP ' + r.status + ')'); return key; });
  }
  // memo:{id,token,text}, files:[File]. 파일을 공개 버킷에 올리고 kind='locker' 행을 만든다.
  // 반환: files 메타(공개 url 포함) — 앱이 내 기기 화면에도 다운로드칩을 표시하게.
  function sendLocker(memo, files) {
    files = files || [];
    var filesMeta = [], idx = 0;
    function step() {
      if (idx >= files.length) {
        return _insertRow({
          id: memo.id, title: '공유함', status: 'pending', kind: 'locker',
          note: memo.text || null, client_token: memo.token,
          meta: { app: 'voice-memo-test', from: 'device', files: filesMeta }
        }).then(function () { return filesMeta; });
      }
      var f = files[idx];
      var ext = extForFile(f, 'file');
      var key = memo.id + '/' + idx + '.' + ext;
      return uploadLockerObject(key, f).then(function () {
        filesMeta.push({ key: key, ext: ext, name: f.name || ('file' + idx + '.' + ext),
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
        var memo = { id: rec.id, kind: rec.kind, note: rec.note, title: rec.title, token: rec.token, ext: rec.ext,
                     materials: rec.materials || [], date: rec.date, time: rec.time };   // 회의자료도 함께 재시도
        var p;
        if (rec.files) {
          p = sendBatch(memo, rec.files);              // 사진/영상 묶음 재업로드
        } else if (rec.blob && rec.blob.size > CHUNK_SIZE) {
          p = sendAudioChunked(memo, rec.blob);        // 큰 음성(2시간 등): 조각으로 재업로드(성공 시 내부에서 idbDel)
        } else {
          p = send(memo, rec.blob);                    // 일반 음성 + 회의자료 재업로드(성공 시 내부에서 idbDel)
        }
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
    send: send, sendBatch: sendBatch, sendVideoChunked: sendVideoChunked, sendAudioChunked: sendAudioChunked,
    createSearch: createSearch, sendChat: sendChat, sendChatTurn: sendChatTurn, requestTts: requestTts, poll: poll, flush: flush, pendingCount: pendingCount,
    sendChatBatch: sendChatBatch, sendChatChunked: sendChatChunked, attachmentsFrom: attachmentsFrom,
    sendDoc: sendDoc, convertDoc: convertDoc, docResultFrom: docResultFrom,
    listOfficePushes: listOfficePushes, listChatHistory: listChatHistory,
    sendLocker: sendLocker, listLocker: listLocker, lockerPublicUrl: lockerPublicUrl,
    CHUNK_SIZE: CHUNK_SIZE
  };
  global.addEventListener('online', function () { flush(); });
})(window);

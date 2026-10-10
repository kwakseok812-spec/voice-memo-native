/* ============================================================================
 * k-store.js — 케이 자산 기기 저장소 (v9.5)
 * ----------------------------------------------------------------------------
 * 서버에서 받은 케이 그림·영상을 폰(브라우저)의 IndexedDB 에 넣어 두고, 다음부터는 인터넷 없이 쓴다.
 *   · 이름 = 서버 파일 이름(내용이 바뀌면 이름도 바뀐다 → 같은 이름은 다시 받지 않는다)
 *   · url(name)  : 화면에 걸 수 있는 주소(blob:) — load() 로 미리 읽어 둔 것만 바로 돌려준다(아니면 '').
 *   · IndexedDB 를 못 쓰는 환경이면 조용히 「저장 없음」으로 동작한다(받은 파일은 이번 실행 동안만 메모리에).
 * k-intro.js(시작 인사)가 가장 먼저 쓰므로 그보다 앞에서 읽는다. 다른 파일에 기대지 않는다.
 * ==========================================================================*/
(function () {
  'use strict';
  var DB = 'smart_kassets', STORE = 'files';
  var db = null, urls = {}, have = {}, mem = {};
  var opened = new Promise(function (res) {
    try {
      if (!window.indexedDB) { res(false); return; }
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { try { rq.result.createObjectStore(STORE); } catch (e) {} };
      rq.onerror = function () { res(false); };
      rq.onblocked = function () { res(false); };
      rq.onsuccess = function () {
        db = rq.result;
        try {
          var k = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
          k.onsuccess = function () { (k.result || []).forEach(function (n) { have[n] = 1; }); res(true); };
          k.onerror = function () { res(true); };
        } catch (e) { res(true); }
      };
    } catch (e) { res(false); }
  });
  function tx(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
  function getBlob(name) {
    return opened.then(function () {
      if (mem[name]) return mem[name];
      if (!db || !have[name]) return null;
      return new Promise(function (res) {
        try { var g = tx('readonly').get(name); g.onsuccess = function () { res(g.result || null); }; g.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    });
  }
  function makeUrl(name, blob) {
    if (urls[name]) return urls[name];
    try { urls[name] = URL.createObjectURL(blob); } catch (e) { return ''; }
    return urls[name];
  }
  // 그 이름들을 저장소에서 읽어 화면에 걸 주소를 만들어 둔다. 돌려주는 값 = 실제로 준비된 이름들
  function load(names) {
    var list = (names || []).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
    return Promise.all(list.map(function (n) {
      if (urls[n]) return n;
      return getBlob(n).then(function (b) { return (b && makeUrl(n, b)) ? n : null; });
    })).then(function (r) { return r.filter(Boolean); });
  }
  function put(name, blob) {
    return opened.then(function () {
      have[name] = 1; makeUrl(name, blob);
      if (!db) { mem[name] = blob; return true; }
      return new Promise(function (res) {
        try {
          var t = db.transaction(STORE, 'readwrite');
          t.objectStore(STORE).put(blob, name);
          t.oncomplete = function () { res(true); };
          t.onerror = t.onabort = function () { mem[name] = blob; res(false); };      // 저장 한도 등 — 이번 실행 동안은 메모리로
        } catch (e) { mem[name] = blob; res(false); }
      });
    });
  }
  function del(names) {
    return opened.then(function () {
      (names || []).forEach(function (n) {
        delete have[n]; delete mem[n];
        if (urls[n]) { try { URL.revokeObjectURL(urls[n]); } catch (e) {} delete urls[n]; }
      });
      if (!db || !(names || []).length) return true;
      return new Promise(function (res) {
        try { var t = db.transaction(STORE, 'readwrite'); names.forEach(function (n) { t.objectStore(STORE).delete(n); }); t.oncomplete = function () { res(true); }; t.onerror = t.onabort = function () { res(false); }; }
        catch (e) { res(false); }
      });
    });
  }
  window.KStore = {
    ready: opened,
    has: function (n) { return !!have[n]; },
    url: function (n) { return urls[n] || ''; },
    names: function () { return Object.keys(have); },
    load: load, put: put, del: del, blob: getBlob,
    persistent: function () { return !!db; }
  };
})();

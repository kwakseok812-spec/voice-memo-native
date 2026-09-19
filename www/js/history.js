/* ============================================================================
 * history.js  —  메모 기록 모듈 (HistoryModule)  [PC-중심 개편판]
 * ----------------------------------------------------------------------------
 * 폰 안(localStorage)에 메모 목록을 보관한다. 각 메모는 PC 처리 상태를 가진다.
 *   entry = { id, token, title, date, time,
 *             status: 'pending'|'processing'|'done'|'failed',
 *             transcript, summary_json, pdf_url, docx_url, pptx_url, error }
 *  - 오디오 자체는 저장하지 않는다(전사 뒤 삭제 원칙 ⓐ). 결과 텍스트·문서링크만.
 * ==========================================================================*/

(function (global) {
  'use strict';
  var KEY = 'voice_memo_history_v2';

  function _read() {
    try { var r = localStorage.getItem(KEY); return r ? JSON.parse(r) : []; }
    catch (e) { return []; }
  }
  function _write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  function add(entry) {
    var list = _read();
    list.unshift(entry);
    if (list.length > 200) list.length = 200;
    return _write(list) ? entry : null;
  }
  function update(id, fields) {
    var list = _read();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        for (var k in fields) if (fields.hasOwnProperty(k)) list[i][k] = fields[k];
        _write(list);
        return list[i];
      }
    }
    return null;
  }
  function get(id) { return _read().filter(function (e) { return e.id === id; })[0] || null; }
  function list() { return _read(); }
  function remove(id) { return _write(_read().filter(function (e) { return e.id !== id; })); }
  function clearAll() { return _write([]); }

  global.HistoryModule = {
    add: add, update: update, get: get, list: list, remove: remove, clearAll: clearAll
  };
})(window);

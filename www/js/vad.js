/* ============================================================================
 * vad.js — 음성 대화 「말 끝 기다림」 판정(O-0177 ③, 2026-10-03)
 * ----------------------------------------------------------------------------
 * 녹음→PC 전사 경로(폰 받아쓰기 미지원·실패, PC판)에서 마이크 진폭(0~1)을 일정 간격으로 받아
 * 「말이 시작됐나 / 말이 끝났나」를 정한다. app.js pollAmp 가 쓰고, 시험(vad_sim_test.js)은 node 에서 이 파일을 그대로 불러 쓴다.
 *   · 소음 적응: 시작 CALIB_MS(0.5초) 동안 잡음 진폭을 모아 상위 80% 값을 잡음으로 보고
 *               말 판정선 = max(THRESH, 잡음×NOISE_MUL + NOISE_ADD), 상한 THRESH_MAX.
 *               측정하는 동안에는 THRESH×4 이상인 「확실한 말」만 말로 센다(잡음이 측정 중 말로 세져 바로 끝나는 일 방지).
 *   · 말 끝: 말이 시작된(MIN_SPEECH_MS 이상 소리) 뒤 SILENCE_MS 동안 조용하면 끝.
 *            말한 시간이 LONG_AFTER_MS 를 넘으면 SILENCE_LONG_MS 로(긴 말 중간에 잠깐 생각하며 쉬어도 덜 끊기게).
 *   · cfg 에 CALIB_MS·SILENCE_LONG_MS 가 없으면(옛 설정) 예전 판정과 똑같다(고정 판정선·고정 무음 시간).
 * ==========================================================================*/
(function (g) {
  'use strict';
  function create(cfg, t0) {
    return { cfg: cfg, t0: t0, last: t0, speechMs: 0, spoke: false, calib: [], thr: cfg.THRESH,
             calibDone: !cfg.CALIB_MS, noise: null };
  }
  // 진폭 1개 반영. 반환: null(계속) | 'silence'(말 끝) | 'nospeech'(말 없음) | 'max'(최대 길이)
  function step(s, level, now) {
    var c = s.cfg, el = now - s.t0, loud;
    if (!s.calibDone && el >= c.CALIB_MS) {
      s.calibDone = true;
      if (s.calib.length) {
        var a = s.calib.slice().sort(function (x, y) { return x - y; });
        var nz = a[Math.floor(0.8 * (a.length - 1))];
        s.noise = nz;
        s.thr = Math.min(c.THRESH_MAX || 1, Math.max(c.THRESH, nz * (c.NOISE_MUL || 1) + (c.NOISE_ADD || 0)));
      }
    }
    if (!s.calibDone) {
      if (level < c.THRESH * 4) s.calib.push(level);
      loud = level >= c.THRESH * 4;              // 측정 중엔 확실한 말만
    } else {
      loud = level >= s.thr;
    }
    if (loud) { s.last = now; s.speechMs += c.POLL; if (s.speechMs >= c.MIN_SPEECH_MS) s.spoke = true; }
    var need = (c.SILENCE_LONG_MS && s.speechMs >= c.LONG_AFTER_MS) ? c.SILENCE_LONG_MS : c.SILENCE_MS;
    if (s.spoke && (now - s.last) >= need) return 'silence';
    if (!s.spoke && el >= c.NOSPEECH_MS) return 'nospeech';
    if (el >= c.MAX_TURN_MS) return s.spoke ? 'max' : 'nospeech';
    return null;
  }
  /* ---------- O-0189(v8.9) 폰 받아쓰기 「말 끝」 판정 — 이어 듣기 ----------
   * v8.8 문제: 「부분 결과(글자)가 0.9초 안 바뀌면 끝」 + 「인식기가 스스로 끝내면 곧바로 전송」 → 생각하며 잠깐 쉬면 잘려 나갔다.
   * 이제: 인식기가 스스로 끝낸 토막(segment)은 이어 붙이기만 하고, 「실제로 조용한 시간」이 기준(endMs)을 넘을 때만 끝.
   *   조용함 = 새 글자도 없고(lastAct) 큰 소리도 없음(lastLoud). 큰 소리만으로 미루는 것은 endMs 한 번까지만
   *   (시끄러운 곳에서 영영 안 끝나는 일 방지 — 그래도 안 끝나면 [다 말했어요]).
   *   소리 크기(rms dB)는 기기마다 눈금이 달라 그 자리의 바닥값(가장 조용했던 값, 천천히 올라감)보다 LOUD_DB 이상 클 때만 「큰 소리」.
   * 반환: sttCheck → null(계속) | 'quiet'(말 끝) | 'nospeech'(말 없음) | 'max'(최대 길이) */
  function sttNew(now) {
    return { t0: now, acc: '', cur: '', first: 0, lastAct: now, lastLoud: 0, segs: 0, floor: null };
  }
  function sttText(s) { return (s.acc + (s.acc && s.cur ? ' ' : '') + s.cur).trim(); }
  function sttPartial(s, text, now) {
    text = String(text || '').trim();
    if (!text || text === s.cur) return false;
    s.cur = text; s.lastAct = now; if (!s.first) s.first = now;
    return true;
  }
  function sttSegment(s, text, now) {              // 인식기가 스스로 끝낸 토막: 확정 글자(없으면 마지막 부분 결과)를 이어 붙임
    text = String(text || '').trim() || s.cur;
    if (text) {
      if (!s.cur) s.lastAct = now;                 // 부분 결과를 안 주는 인식기: 토막이 온 때를 「방금 말함」으로(글자만 다듬어진 것은 말이 아님)
      s.acc = (s.acc + ' ' + text).trim(); if (!s.first) s.first = now;
    }
    s.cur = ''; s.segs++;
  }
  function sttRms(s, db, now, loudDb) {
    if (typeof db !== 'number' || isNaN(db)) return false;
    if (s.floor === null || db < s.floor) s.floor = db; else s.floor += 0.02;   // 바닥값은 아주 천천히 따라 올라감
    if (db >= s.floor + (loudDb || 5)) { s.lastLoud = now; return true; }
    return false;
  }
  function sttQuietFor(s, now, endMs) {
    var eff = Math.max(s.lastAct, Math.min(s.lastLoud, s.lastAct + endMs));
    return now - eff;
  }
  function sttCheck(s, now, cfg) {
    var has = !!sttText(s);
    if (has && sttQuietFor(s, now, cfg.endMs) >= cfg.endMs) return 'quiet';
    if (!has && now - s.t0 >= cfg.noSpeechMs) return 'nospeech';
    if (now - s.t0 >= cfg.maxMs) return has ? 'max' : 'nospeech';
    return null;
  }
  var KVad = { create: create, step: step, sttNew: sttNew, sttText: sttText, sttPartial: sttPartial, sttSegment: sttSegment,
               sttRms: sttRms, sttQuietFor: sttQuietFor, sttCheck: sttCheck };
  g.KVad = KVad;
  if (typeof module !== 'undefined' && module.exports) module.exports = KVad;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
 * pc-status.js — 「PC 상태」 (v9.75, O-0755)  이 PC의 CPU·메모리를 폰에서 보고, 클로드 앱·PC를 다시 시작한다
 * ----------------------------------------------------------------------------
 * 화면: 상태(CPU·메모리 큰 숫자+막대+최근 선 그래프 · 그래픽카드 · 바쁜 프로그램 3개 · 케이 한 줄) · 접힌 「PC 관리」 ·
 *       확인 창([취소] / [다시 시작]) · 요청 카드(접수 → 실행 중 → 확인 중 → 결과)
 * 서버: get_pc_status / pc_power_request / pc_power_cancel (연동 암호 게이트 RPC, 표 직접 접근 불가). 계약은 설계안 v3 · CONTRACT.md.
 *       함수가 아직 서버에 없으면(404) 「서버 준비 중입니다」 — 홈은 그대로 동작한다.
 * 규칙: · 「0%」를 지어 보이지 않는다. 못 읽은 값은 「확인 못 함」, 오래된 값은 흐리게 + 「마지막 확인 N분 전」.
 *       · 생존은 seen_at(서버 시계), 수치 신선도는 updated_at — 평소 모드(15초 확인·1분 올림)에서 수치가 1분 묵어도 정상으로 본다.
 *       · 결과 문구는 서버 상태가 done 일 때만 「성공」. 마감까지 결과가 없으면 서버가 unknown, 2분 안에 PC가 못 가져가면 expired 로 돌려준다.
 *       · 확인은 「단추 → 확인 창([취소]/[다시 시작]) 두 번 누르기」. 작업 중이면 확인 창에 경고 한 줄 + 「그래도 다시 시작」(force). 재시작 암호·길게 누르기는 없다(대표님 결정).
 * 스위치: app.js 의 PC_MON_UI('on'|'off' — off 면 홈 줄이 보이지 않아 v9.74 와 같다) · PC_POWER_UI('on'|'off' — off 면 「PC 관리」가 없다) ·
 *       PC_DISK_UI('on'|'off' — v9.84(O-0784): off 면 메모리 아래 「저장공간」 칸이 없어 v9.83 과 같다. PC 쪽 스위치(pc_agent_switch.json "disk")로도 숨겨진다).
 * v9.84 저장공간 칸: PC 프로그램이 payload.disk(C: 용량 숫자만)를 올릴 때만 보인다. 칸 없음·off → 줄 숨김 · pending → 「읽는 중입니다」 · err → 「확인 못 함」 ·
 *       10분 넘게 묵은 값 → 「N분 전 값」(흐리게). 사용률 80% 이상 노랑 · 90% 이상 빨강. 홈 글씨·케이 한 줄 문구는 바꾸지 않는다.
 * v9.86 외장하드 줄(O-0787): PC 프로그램(v1.2)이 payload.disk.ext(외장하드 목록 — 볼륨 이름·용량 숫자만)를 올릴 때만, C: 칸 바로 아래에 줄이 하나씩 생기고 뽑으면 사라진다.
 *       없으면(평소·옛 PC 프로그램) 줄 없음 — v9.85 와 화면이 같다. 색 기준은 C: 와 같다(80% 노랑·90% 빨강). 스위치 PC_DISK_EXT_UI('on'|'off') — off 면 외장 줄만 없다(PC 쪽 스위치 disk_ext 로도 숨겨진다).
 *       pending → 「읽는 중입니다」 · err → 「확인 못 함」 · 3분 넘게 묵은 값 → 화면 연 뒤 40초는 「확인 중」, 그 뒤에도 묵었으면 흐리게 + 「N분 전 값」. 이름은 PC 가 정리해 보내지만 앱도 esc() 로 한 번 더 막는다.
 * app.js 연결: PcStatus.init({toast, getPass, openScreen, kstat, power, disk, diskExt}) · PcStatus.open() · PcStatus.back() · PcStatus.homeDot()
 * 시험: PcPure(순수 함수 묶음)는 화면 없이 시험할 수 있게 밖으로 내놓았다(node 에서도 require 가능).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 순수 함수
   * ===================================================================*/
  var K = {
    FAST_LIVE: 12, FAST_SLOW: 40,          // 빠른 모드(4초): 12초 안이면 실시간 · 40초 안이면 느림 · 넘으면 응답 없음
    IDLE_LIVE: 45, IDLE_SLOW: 120,         // 평소 모드(15초 확인): 45초 · 120초
    FAST_VAL: 12, IDLE_VAL: 75,            // 수치가 이보다 묵으면 흐리게
    CONNECT_WAIT: 25,                      // 화면을 연 직후 평소 모드 → 빠른 모드로 바뀌길 기다리는 시간
    PENDING_HINT: 20,                      // 요청을 보낸 지 이 시간이 지나도 PC가 안 가져가면 안내
    SECS_START: { claude_restart: 10, pc_reboot: 60 },
    DISK_WARN: 80, DISK_HOT: 90,           // 저장공간 사용률 이상이면 노랑 · 빨강(v9.84)
    DISK_OLD: 600,                         // 읽은 지(읽기 나이 + 값 나이) 이 초를 넘으면 「N분 전 값」으로 흐리게
    DISK_NOTE: '디스크 상자의 2TB는 컴퓨터 계산으로 1.82TB입니다',    // 항상 보이는 작은 안내 한 줄(표기 단위를 바꾸면 이 문구도 함께)
    EXT_OLD: 180,                          // 외장 값이 (읽기 나이 + 값 나이) 이 초를 넘게 묵으면 「확인 중」/「N분 전 값」(v9.86)
    EXT_WAIT: 40,                          // 화면을 연 뒤 이 초 동안은 묵은 외장 값을 흐리게 하지 않고 「확인 중」 으로 둔다(PC 가 화면이 열린 것을 알고 새로 읽는 시간)
    EXT_MAX: 3,                            // 한 번에 그리는 외장 줄 수(넘치면 「외 N개 연결됨」)
    EXT_NAME_MAX: 24
  };
  /* 시안(합니다체)에서 가져온 안내 문구 — 대표님이 느린 PC를 재시작으로 풀려 하시는 일을 막는 설명 포함 */
  var HINT_PC_GONE = '카운트다운이 끝나면 앱이 PC에 닿지 않게 됩니다. 다시 켜지면 알려 드립니다.';
  var HINT_CLOSE_PC = '앱을 닫으셔도 됩니다. 다시 켜지면 알림으로 알려 드립니다.';
  var HINT_CLOSE_CLAUDE = '앱을 닫으셔도 됩니다. 결과 알림이 올 때까지는 끝난 것이 아닙니다.';
  var FINAL = { done: 1, partial: 1, failed: 1, refused: 1, expired: 1, unknown: 1 };
  var ACTIVE = { pending: 1, accepted: 1, running: 1, verifying: 1 };
  var KIND_NAME = { claude_restart: '클로드 앱 다시 시작', pc_reboot: 'PC 전체 다시 시작' };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function num(v) { if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null; var n = Number(v); return isFinite(n) ? n : null; }
  function ms(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? null : t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* 초 → 「3초」「5분」「1시간 20분」 */
  function fmtAgo(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 60) return sec + '초';
    var m = Math.floor(sec / 60);
    if (m < 60) return m + '분';
    var h = Math.floor(m / 60), mm = m % 60;
    return h + '시간' + (mm ? ' ' + mm + '분' : '');
  }
  /* 걸린 시간 → 「48초」「3분 12초」 */
  // 받침에 따라 「이/가」: 「클로드 앱」→「클로드 앱이」, 「리스너」→「리스너가」. 한글로 끝나지 않으면 「항목이」(「이(가)」를 화면에 내지 않는다)
  function iga(word) {
    var w = String(word == null ? '' : word), c = w.length ? w.charCodeAt(w.length - 1) : 0;
    if (c >= 0xAC00 && c <= 0xD7A3) return w + ((c - 0xAC00) % 28 ? '이' : '가');
    return w + ' 항목이';
  }
  /* 일꾼 영어 내부 이름이 서버 결과에 섞여 와도 화면에는 한글 이름만 보인다(PC가 처음부터 한글 이름을 보내지만, 마지막 방어선) */
  var WORKER_KO = { chat_responder: '케이 채팅 응답기', doc_worker: '문서 변환 일꾼', edit_worker: '문서 편집 일꾼', job_worker: '작업실 일꾼', meeting_out_worker: '회의록 출력 일꾼', search_poller: '명함 검색 일꾼', video_worker: '영상 처리 일꾼' };
  function koItem(x) {
    var w = String(x == null ? '' : x);
    if (/[가-힣]/.test(w)) return w;
    return Object.prototype.hasOwnProperty.call(WORKER_KO, w) ? WORKER_KO[w] : '알 수 없는 일꾼';
  }

  function fmtTook(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 60) return sec + '초';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + '분' + (s ? ' ' + s + '초' : '');
  }
  function fmtClock(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  /* 받은 값 한 벌(d)에 「받은 뒤 지난 시간」을 더해 지금 기준의 나이(초)를 구한다. 서버 시계끼리만 빼므로 폰 시계가 틀려도 맞다. */
  function ages(d, nowMs) {
    if (!isObj(d)) return null;
    var sn = ms(d.server_now), seen = ms(d.seen_at), upd = ms(d.updated_at);
    var extra = (d._at && nowMs) ? Math.max(0, (nowMs - d._at) / 1000) : 0;
    var seenAge = (seen !== null && sn !== null) ? Math.max(0, (sn - seen) / 1000) + extra : null;
    var valAge = (upd !== null && sn !== null) ? Math.max(0, (sn - upd) / 1000) + extra : null;
    if (seenAge === null && valAge !== null) seenAge = valAge;   // seen_at 이 아직 없는 옛 줄 — 수치 시각으로 대신
    return { seenAge: seenAge, valAge: valAge };
  }

  /* 상태 판정. 반환 state:
   *   none(PC 소식 없음) · off(측정 꺼짐) · live(실시간/연결됨) · connecting(방금 열어 빠른 모드로 바뀌는 중) · slow(느림) · down(응답 없음) · restarting(다시 시작하는 중)
   *   mode: 'fast'(4초) | 'idle'(평소 15초) · dim: 수치를 흐리게 · seenAge/valAge(초)
   *   opt: { now, openedAt, tracking(요청이 접수~확인 중) } */
  function judge(d, opt) {
    opt = opt || {};
    var now = opt.now || Date.now();
    if (!isObj(d) || !isObj(d.payload)) return { state: 'none', mode: 'idle', dim: true, seenAge: null, valAge: null };
    var p = d.payload;
    var a = ages(d, now) || { seenAge: null, valAge: null };
    var mode = (num(p.iv) !== null && num(p.iv) <= 4) ? 'fast' : 'idle';
    if (p.monitor === 'off') return { state: 'off', mode: mode, dim: true, seenAge: a.seenAge, valAge: a.valAge };
    var live = mode === 'fast' ? K.FAST_LIVE : K.IDLE_LIVE, slow = mode === 'fast' ? K.FAST_SLOW : K.IDLE_SLOW;
    var sa = a.seenAge;
    var st = (sa === null) ? 'down' : (sa <= live ? 'live' : (sa <= slow ? 'slow' : 'down'));
    var valLim = mode === 'fast' ? K.FAST_VAL : K.IDLE_VAL;
    var dim = (a.valAge === null) || a.valAge > valLim || st === 'down';
    if (opt.tracking && st !== 'live') st = 'restarting';
    else if (st === 'live' && mode === 'idle' && opt.openedAt && (now - opt.openedAt) / 1000 < K.CONNECT_WAIT) { st = 'connecting'; dim = true; }
    return { state: st, mode: mode, dim: dim, seenAge: sa, valAge: a.valAge };
  }

  /* 단계(색) */
  function level(v, kind) {
    v = num(v);
    if (v === null) return 'na';
    if (kind === 'mem') return v >= 93 ? 'hot' : (v >= 85 ? 'warn' : 'ok');
    return v >= 85 ? 'hot' : (v >= 60 ? 'warn' : 'ok');
  }
  var LEVEL_WORD = { ok: '여유', warn: '바쁨', hot: '매우 바쁨', na: '확인 못 함' };
  /* 큰 숫자로 보이는 CPU — 빠른 모드는 최근 3개 평균(10초 안팎), 평소 모드는 지금 값. 값이 없으면 null(0 으로 지어내지 않는다). */
  function cpuNow(p) {
    if (!isObj(p) || !isObj(p.cpu)) return null;
    var cur = num(p.cpu.pct);
    var iv = num(p.iv);
    var h = Array.isArray(p.cpu.hist) ? p.cpu.hist.map(num).filter(function (x) { return x !== null; }) : [];
    if (iv !== null && iv <= 4 && h.length >= 3) { var t = h.slice(-3); return Math.round(t.reduce(function (s, x) { return s + x; }, 0) / t.length); }
    return cur === null ? null : Math.round(cur);
  }
  function memInfo(p) {
    if (!isObj(p) || !isObj(p.mem)) return null;
    var pct = num(p.mem.pct), u = num(p.mem.used_gb), t = num(p.mem.total_gb);
    if (pct === null && u !== null && t) pct = Math.round(100 * u / t);
    if (pct === null && u === null) return null;
    return { pct: pct, used: u, total: t };
  }
  function gb1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* ---- 저장공간(v9.84, O-0784) — PC가 올리는 payload.disk(용량 숫자만). 1 TB = 1024 GB(메모리 칸과 같은 계산 · 윈도 탐색기와 같은 계산) ---- */
  /* 용량(GB) → { num: '481', unit: 'GB' } / { num: '1.82', unit: 'TB' }. 반올림한 값이 1024 GB 미만이면 GB(정수), 이상이면 TB(소수 둘째). 못 읽으면 null. */
  function capParts(gb) {
    if (typeof gb !== 'number' && typeof gb !== 'string') return null;     // 배열·객체·참거짓은 숫자로 읽지 않는다
    var v = num(gb);
    if (v === null || v < 0) return null;
    var r = Math.round(v);
    if (r < 1024) return { num: String(r), unit: 'GB' };
    return { num: (Math.round(v / 1024 * 100) / 100).toFixed(2), unit: 'TB' };
  }
  function fmtCap(gb) { var c = capParts(gb); return c ? c.num + ' ' + c.unit : ''; }
  /* 사용률(%) → 단계. 값이 없거나 음수면 na(지어내지 않는다) */
  function diskLevel(pct) {
    var v = num(pct);
    if (v === null || v < 0) return 'na';
    return v >= K.DISK_HOT ? 'hot' : (v >= K.DISK_WARN ? 'warn' : 'ok');
  }
  var DISK_WORD = { ok: '여유', warn: '많이 참', hot: '거의 참', na: '확인 못 함' };
  /* payload → 저장공간 칸에 그릴 것.
   *   { show:false, kind:'none'|'off' }                    칸 없음(옛 PC 프로그램·측정 꺼짐) · PC 스위치로 끔 → 줄 전체를 숨긴다
   *   { show:true, kind:'pending' }                         PC가 막 시작해 첫 읽기가 아직 → 「읽는 중입니다」
   *   { show:true, kind:'err' }                             읽기 실패·값 이상 → 「확인 못 함」
   *   { show:true, kind:'ok', letter, used, total, free, pct, readAgo } 정상(드라이브가 여럿이어도 첫 번째만) */
  function diskInfo(p) {
    if (!isObj(p) || !isObj(p.disk)) return { show: false, kind: 'none' };
    var d = p.disk;
    if (d.off === true) return { show: false, kind: 'off' };
    if (d.pending === true) return { show: true, kind: 'pending' };
    if (d.err === true) return { show: true, kind: 'err' };
    var dr = Array.isArray(d.drives) ? d.drives.filter(isObj)[0] : null;
    if (!dr) return { show: true, kind: 'err' };
    var total = num(dr.total_gb), used = num(dr.used_gb), free = num(dr.free_gb), pct = num(dr.pct);
    if (total === null || total <= 0 || used === null || used < 0 || used > total * 1.01) return { show: true, kind: 'err' };
    if (free === null || free < 0) free = Math.max(0, total - used);
    if (pct === null) pct = 100 * used / total;
    pct = clamp(Math.round(pct), 0, 100);
    var ra = num(d.read_ago_s);
    return { show: true, kind: 'ok', letter: String(dr.d || 'C').charAt(0).toUpperCase(), used: used, total: total, free: free, pct: pct, readAgo: ra === null ? 0 : Math.max(0, ra) };
  }
  /* 읽은 지 얼마나 묵은 값인가(초). 읽기 나이(PC 시계)와 payload 나이(서버 시계)를 더한다. K.DISK_OLD 를 넘으면 그 초, 아니면 0. */
  function diskOld(readAgo, valAge) {
    var t = (num(readAgo) || 0) + (num(valAge) || 0);
    return t > K.DISK_OLD ? t : 0;
  }
  /* ---- 외장하드(v9.86, O-0787) — payload.disk.ext[]: 정상 {d,n?,total_gb,used_gb,free_gb,pct,ago} · 읽는 중 {d,n?,pending:true} · 확인 못 함 {d,n?,err:true}
   * 반환 { show, items:[{kind:'ok'|'pending'|'err', letter, name, used,total,free,pct, old(초, 0=정상), checking}], more }
   *   ext 가 없거나(평소·옛 PC 프로그램) 빈 목록·측정 꺼짐(disk.off)이면 show:false. 문자(A~Z)가 없거나 모양이 이상한 항목은 건너뛴다(지어 그리지 않는다).
   *   opt: { valAge(payload 나이, 초), openedAt, now } — 묵은 값(K.EXT_OLD 초 초과)은 화면을 연 지 K.EXT_WAIT 초 안이면 checking(「확인 중」), 그 뒤면 old(「N분 전 값」). */
  function extName(n) { return typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, K.EXT_NAME_MAX) : ''; }
  function nn(v) { return (typeof v === 'number' || typeof v === 'string') ? num(v) : null; }      // 배열·객체·참거짓은 숫자로 읽지 않는다
  function extOld(ago, valAge) {
    var t = (num(ago) || 0) + (num(valAge) || 0);
    return t > K.EXT_OLD ? t : 0;
  }
  function diskExtList(p, opt) {
    opt = opt || {};
    var none = { show: false, items: [], more: 0 };
    if (!isObj(p) || !isObj(p.disk) || p.disk.off === true || !Array.isArray(p.disk.ext)) return none;
    var items = [];
    p.disk.ext.forEach(function (e) {
      if (!isObj(e)) return;
      var L = (typeof e.d === 'string' && /^[A-Za-z]$/.test(e.d)) ? e.d.toUpperCase() : '';
      if (!L) return;
      var it = { kind: 'err', letter: L, name: extName(e.n), used: 0, total: 0, free: 0, pct: 0, old: 0, checking: false };
      if (e.pending === true) { it.kind = 'pending'; items.push(it); return; }
      if (e.err === true) { items.push(it); return; }
      var total = nn(e.total_gb), used = nn(e.used_gb), free = nn(e.free_gb), pct = nn(e.pct);
      if (total === null || total <= 0 || used === null || used < 0 || used > total * 1.01) { items.push(it); return; }
      if (free === null || free < 0) free = Math.max(0, total - used);
      if (pct === null) pct = 100 * used / total;
      it.kind = 'ok'; it.used = used; it.total = total; it.free = free; it.pct = clamp(Math.round(pct), 0, 100);
      var old = extOld(e.ago, opt.valAge);
      if (old) {
        var fresh = opt.openedAt && opt.now && (opt.now - opt.openedAt) / 1000 < K.EXT_WAIT;
        if (fresh) it.checking = true; else it.old = old;
      }
      items.push(it);
    });
    var em = num(p.disk.ext_more);
    var more = (items.length > K.EXT_MAX ? items.length - K.EXT_MAX : 0) + (em !== null && em > 0 ? Math.floor(em) : 0);
    return { show: items.length > 0, items: items.slice(0, K.EXT_MAX), more: items.length ? more : 0 };
  }
  function topList(p) {
    if (!isObj(p) || !Array.isArray(p.top)) return [];
    return p.top.filter(function (x) { return isObj(x) && x.n; }).slice(0, 3).map(function (x) { return { n: String(x.n), pct: num(x.pct) }; });
  }
  function workInfo(p) {
    var w = (isObj(p) && isObj(p.work)) ? p.work : {};
    var items = Array.isArray(w.items) ? w.items.filter(function (x) { return isObj(x) && x.n; }).map(function (x) { return { n: String(x.n), c: Math.max(1, num(x.c) || 1) }; }) : [];
    var unsure = Array.isArray(w.unsure) ? w.unsure.map(String).filter(Boolean) : [];
    return { items: items, unsure: unsure };
  }
  function workText(w) { return w.items.map(function (x) { return x.n + ' ' + x.c + (/작업실|건/.test(x.n) ? '건' : ''); }).join(', '); }

  /* 케이 한 줄 — 숫자가 문장을 정한다(합니다체). 값이 없으면 지어내지 않는다. */
  function sayLine(d, j) {
    var p = d && d.payload;
    if (!j || j.state === 'none') return '아직 PC의 소식이 없습니다.';
    if (j.state === 'off') return '측정이 꺼져 있습니다.';
    if (j.state === 'restarting') return '다시 시작하는 중입니다.';
    if (j.state === 'down') return 'PC가 답이 없습니다. 마지막으로 ' + (j.seenAge === null ? '언제인지 알 수 없지만' : fmtAgo(j.seenAge) + ' 전에') + ' 소식이 있었습니다.';
    if (j.state === 'slow') return 'PC가 매우 느립니다. 응답이 늦어지고 있습니다.';
    if (j.state === 'connecting') return 'PC에 연결하는 중입니다.';
    var cpu = cpuNow(p), mem = memInfo(p), top = topList(p);
    var lc = level(cpu, 'cpu'), lm = level(mem && mem.pct, 'mem');
    var big = (top.length && top[0].pct !== null && top[0].pct >= 10) ? ' 가장 큰 몫은 ' + top[0].n + '입니다.' : '';
    if (lc === 'hot') return 'PC가 많이 바쁩니다.' + big;
    if (lc === 'warn') return 'PC가 조금 바쁩니다.' + big;
    if (lm === 'hot') return '메모리가 거의 찼습니다.';
    if (lm === 'warn') return '메모리를 많이 쓰고 있습니다.';
    if (lc === 'na' && lm === 'na') return '수치를 읽어 오지 못했습니다.';
    var w = workInfo(p);
    return w.items.length ? '지금 PC는 여유롭습니다. 일은 돌고 있습니다.' : '지금 PC는 여유롭습니다.';
  }
  /* 위쪽 상태 줄 */
  function statusLine(j) {
    if (!j) return '';
    switch (j.state) {
      case 'none': return 'PC의 소식을 기다리는 중';
      case 'off': return '측정이 꺼져 있습니다';
      case 'connecting': return '연결하는 중… · 마지막 확인 ' + fmtAgo(j.seenAge || 0) + ' 전';
      case 'live': return j.mode === 'fast' ? '실시간 · ' + fmtAgo(j.valAge === null ? (j.seenAge || 0) : j.valAge) + ' 전 확인' : '연결됨 · 수치는 ' + fmtAgo(j.valAge === null ? 0 : j.valAge) + ' 전 것(평소 1분 간격)';
      case 'slow': return '느림 · ' + fmtAgo(j.seenAge || 0) + ' 전 확인';
      case 'down': return '응답 없음 · 마지막 확인 ' + (j.seenAge === null ? '알 수 없음' : fmtAgo(j.seenAge) + ' 전');
      case 'restarting': return '다시 시작하는 중 · 마지막 확인 ' + fmtAgo(j.seenAge || 0) + ' 전';
    }
    return '';
  }
  var DOWN_NOTE = 'PC가 꺼졌거나, 인터넷이 끊겼거나, 프로그램이 멈춘 것일 수 있습니다. 이 셋은 구분하지 못합니다.';

  /* 오류 코드(pc_power_request 의 code) → 화면 문구 */
  function errText(code, info) {
    info = info || {};
    switch (code) {
      case 'BUSY': return '이미 처리 중인 요청이 있습니다';
      case 'TOO_SOON': return '방금 다시 시작했습니다. ' + (info.retry_s ? fmtAgo(info.retry_s) : '15분') + ' 뒤에 다시 눌러 주십시오';
      case 'LIMIT': return '오늘 횟수를 모두 썼습니다';
      case 'DISABLED': return '이 기능은 지금 꺼져 있습니다';
      case 'BAD_KIND': return '알 수 없는 요청입니다';
      case 'BAD_PASSCODE': return '연동 암호가 맞지 않습니다';
    }
    return UNKNOWN_ERR;      // 영어 코드·서버 문구는 화면에 보이지 않는다(코드는 콘솔 로그에만)
  }
  var UNKNOWN_ERR = '알 수 없는 오류입니다(코드는 로그에 있습니다)';
  var KNOWN_CODES = { BUSY: 1, TOO_SOON: 1, LIMIT: 1, DISABLED: 1, BAD_KIND: 1, BAD_PASSCODE: 1 };
  function knownCode(code) { return !!KNOWN_CODES[code]; }
  var NET_UNSURE = '요청을 보냈는지 확인하지 못했습니다. 서버에 이미 갔을 수 있으니 상태를 확인한 뒤 다시 눌러 주십시오';
  var CANCEL_UNSURE = '취소 요청을 보냈는지 확인하지 못했습니다. 상태를 확인한 뒤 다시 눌러 주십시오';

  /* 요청 카드 4칸: 요청 접수 → 실행 중 → 확인 중 → 결과 */
  var STEP_NAMES = ['요청 접수', '실행 중', '확인 중', '결과'];
  function stepStates(status) {
    switch (status) {
      case 'pending': return ['doing', 'todo', 'todo', 'todo'];
      case 'accepted': return ['done', 'todo', 'todo', 'todo'];
      case 'running': return ['done', 'doing', 'todo', 'todo'];
      case 'verifying': return ['done', 'done', 'doing', 'todo'];
      case 'done': return ['done', 'done', 'done', 'done'];
      case 'partial': return ['done', 'done', 'done', 'warn'];
      case 'failed': return ['done', 'done', 'done', 'bad'];
      case 'unknown': return ['done', 'done', 'unk', 'unk'];
      case 'refused': return ['neu', 'todo', 'todo', 'todo'];
      case 'expired': return ['bad', 'todo', 'todo', 'todo'];
    }
    return ['todo', 'todo', 'todo', 'todo'];
  }
  /* 요청 한 건을 화면 문구로. o: { nowServer(ms, 서버 시계 기준 지금) }
   * 반환 { status, final, tone(ok|warn|bad|unk|neu|run), tag(끝난 요청의 꼬리표), hint(카드 아래 안내 한 줄, 없으면 ''), title, lines[], steps[4], countdown(초|null), cancel(bool), dry } */
  function cmdView(cmd, o) {
    if (!isObj(cmd)) return null;
    o = o || {};
    var st = String(cmd.status || 'pending'), kind = cmd.kind, kn = KIND_NAME[kind] || '다시 시작';
    var r = isObj(cmd.result) ? cmd.result : {};
    var claude = kind === 'claude_restart';
    var nowS = o.nowServer || Date.now();
    var req = ms(cmd.requested_at), acc = ms(cmd.accepted_at);
    var out = { status: st, final: !!FINAL[st], tone: 'run', title: '', lines: [], steps: stepStates(st), countdown: null, cancel: false, dry: !!r.dry, kindName: kn, elapsed: null, alert: '', tag: '', hint: '' };
    var detail = r.text ? String(r.text) : '';
    var took = num(r.took_s);
    var bad = Array.isArray(r.bad_items) ? r.bad_items.map(koItem) : [], okI = Array.isArray(r.ok_items) ? r.ok_items.map(koItem) : [];
    if (out.dry) out.lines.push('시험 중입니다 — 실제로는 실행하지 않았습니다.');
    switch (st) {
      case 'pending':
        out.title = 'PC에 요청을 보냈습니다…';
        if (req !== null && (nowS - req) / 1000 > K.PENDING_HINT) out.title = 'PC가 아직 요청을 가져가지 않았습니다';
        out.lines.push('2분 안에 가져가지 않으면 요청은 저절로 사라지고 아무것도 실행되지 않습니다.');
        break;
      case 'accepted': {
        out.title = '요청을 받았습니다';
        var start = ms(r.start_at); if (start === null && acc !== null) start = acc + (K.SECS_START[kind] || 10) * 1000;
        if (start !== null) { var left = Math.ceil((start - nowS) / 1000); out.countdown = left > 0 ? left : 0; out.cancel = left > 0; }
        out.lines.push(kn + ' — ' + (out.countdown ? out.countdown + '초 뒤 시작합니다. 지금은 취소할 수 있습니다.' : '곧 시작합니다.'));
        out.lines.push('결과 알림이 올 때까지는 끝난 것이 아닙니다.');
        if (r.cancel_failed === true) {                          // 취소가 안 먹혔다(PC가 알려 줌) — [취소]를 숨기고 빨간 안내
          out.cancel = false;
          out.alert = r.text ? String(r.text) : '취소하지 못했습니다 · PC 앞에서 확인해 주십시오';
        }
        if (!claude && !out.dry) out.hint = HINT_PC_GONE;           // 시안: 카운트다운 화면 안내
        break; }
      case 'running':
        out.title = claude ? '클로드 앱이 다시 시작되는 중입니다' : 'PC가 다시 시작되는 중입니다';
        out.lines.push(claude ? '앱을 닫고 다시 켜는 중입니다.' : '재부팅하는 중입니다. 이 동안 PC 응답이 끊기는 것은 정상입니다. 보통 3~6분 걸립니다.');
        out.hint = claude ? HINT_CLOSE_CLAUDE : HINT_CLOSE_PC;     // 시안: 재시작 중 화면 안내
        break;
      case 'verifying':
        out.title = '제대로 켜졌는지 확인하는 중입니다';
        out.lines.push(claude ? '이전 앱이 끝났는지, 새 앱과 창이 떴는지 PC가 직접 확인합니다.' : '부팅 시각이 바뀌었는지, 클로드·리스너·일꾼이 켜졌는지 PC가 직접 확인합니다.');
        out.hint = claude ? HINT_CLOSE_CLAUDE : HINT_CLOSE_PC;
        break;
      case 'done':
        out.tone = 'ok'; out.tag = '성공';
        out.title = (claude ? '클로드 앱이 다시 켜졌습니다' : 'PC가 다시 정상 작동합니다') + (took !== null ? ' · ' + fmtTook(took) + ' 걸림' : '');
        if (detail && detail.indexOf(claude ? '클로드 앱이 다시 켜졌습니다' : 'PC가 다시 정상 작동합니다') < 0) out.lines.push(detail);   // PC가 보낸 한 줄이 제목과 같으면 되풀이하지 않는다
        break;
      case 'partial':
        out.tone = 'warn'; out.tag = '일부 실패';
        out.title = bad.length ? iga(bad.join(', ')) + ' 아직 안 켜졌습니다' : '일부가 아직 안 켜졌습니다';
        if (okI.length) out.lines.push('켜진 것: ' + okI.join(', '));
        if (detail) out.lines.push(detail);
        break;
      case 'failed':
        out.tone = 'bad'; out.tag = '실패';
        out.title = claude ? '클로드 앱이 다시 켜지지 않았습니다' : 'PC가 다시 시작되지 않았습니다';
        if (r.reason) out.lines.push(String(r.reason)); else if (detail) out.lines.push(detail);
        if (claude && r.code === 'not_launched') out.lines.push('이전 앱은 종료되었습니다. 지금 클로드가 꺼져 있을 수 있습니다.');   // 푸시 알림과 같은 안내
        out.lines.push('PC 앞에서 확인이 필요할 수 있습니다.');
        break;
      case 'refused':
        out.tone = 'neu';                                         // 실패가 아니다 — 취소했거나 조건이 맞지 않아 실행하지 않은 것(회색)
        if (r.code === 'cancelled') {
          out.tag = '취소됨'; out.title = '취소했습니다';
          out.lines.push('아무것도 바뀌지 않았습니다.');
        } else {
          out.tag = '거절됨'; out.title = '실행하지 않았습니다';
          out.lines.push('이유: ' + (r.reason ? String(r.reason) : (detail || '알 수 없습니다')));
        }
        break;
      case 'expired':
        out.tone = 'unk'; out.tag = '실행 안 됨';
        out.title = '요청이 PC에 닿지 않았습니다';
        out.lines.push('아무것도 실행되지 않았습니다. PC가 꺼졌거나 응답하지 않을 수 있습니다.');
        break;
      case 'unknown':
        out.tone = 'unk'; out.tag = '확인 못 함';
        out.title = '결과를 확인하지 못했습니다';
        out.lines.push('실행되었는지 알 수 없습니다. PC 앞 확인이 필요합니다.');
        if (r.late) out.lines.push('뒤늦게 소식이 오면 이 카드가 바뀝니다.');
        break;
      default:
        out.title = String(st);
    }
    if ((st === 'running' || st === 'verifying') && acc !== null) out.elapsed = Math.max(0, Math.round((nowS - acc) / 1000));
    return out;
  }
  function isFinalStatus(s) { return !!FINAL[s]; }
  function isActiveStatus(s) { return !!ACTIVE[s]; }

  /* 단추 잠금 이유(없으면 ''). which: 'claude_restart' | 'pc_reboot' */
  function lockReason(d, j, which, o) {
    o = o || {};
    if (o.notready) return '서버 준비 중입니다';
    if (!isObj(d) || !isObj(d.payload)) return 'PC의 소식이 없어 신호를 보낼 수 없습니다';
    if (j && (j.state === 'down' || j.state === 'none')) return 'PC가 응답하지 않아 신호를 보낼 수 없습니다';
    if (o.tracking) return '이미 처리 중인 요청이 있습니다';
    var pw = isObj(d.payload.power) ? d.payload.power : null;
    if (!pw || pw.mode === 'off') return '재시작 기능이 지금 꺼져 있습니다';
    if (which === 'claude_restart') return pw.claude_btn === true ? '' : '이 단추는 지금 꺼져 있습니다';
    return pw.pc_btn === true ? '' : '시험 뒤 열립니다';
  }

  var PcPure = {
    K: K, esc: esc, iga: iga, koItem: koItem, fmtAgo: fmtAgo, fmtTook: fmtTook, fmtClock: fmtClock, ages: ages, judge: judge, level: level, LEVEL_WORD: LEVEL_WORD,
    cpuNow: cpuNow, memInfo: memInfo, topList: topList, workInfo: workInfo, workText: workText, sayLine: sayLine,
    statusLine: statusLine, DOWN_NOTE: DOWN_NOTE, errText: errText, stepStates: stepStates, STEP_NAMES: STEP_NAMES, cmdView: cmdView,
    isFinalStatus: isFinalStatus, isActiveStatus: isActiveStatus, knownCode: knownCode, UNKNOWN_ERR: UNKNOWN_ERR, NET_UNSURE: NET_UNSURE, CANCEL_UNSURE: CANCEL_UNSURE, lockReason: lockReason, KIND_NAME: KIND_NAME, gb1: gb1,
    capParts: capParts, fmtCap: fmtCap, diskLevel: diskLevel, diskInfo: diskInfo, diskOld: diskOld, DISK_WORD: DISK_WORD,
    diskExtList: diskExtList, extOld: extOld, extName: extName
  };
  global.PcPure = PcPure;
  if (typeof module !== 'undefined' && module.exports) module.exports = PcPure;
  if (typeof document === 'undefined') return;

  /* =====================================================================
   * 2. 화면
   * ===================================================================*/
  var host = { toast: function () {}, getPass: function () { return ''; }, openScreen: function () {}, kstat: function () { return null; }, power: true, disk: true, diskExt: true };
  var $ = function (id) { return document.getElementById(id); };
  var built = false, inited = false;
  var data = null;                // 마지막으로 받은 get_pc_status 결과(+_at: 받은 폰 시각)
  var openedAt = 0, timer = null, polling = false, notready = false, badpass = false, netErr = false, noPass = false;
  var trackId = '', foldOpen = false;
  var sheet = { kind: '', open: false, sending: false, force: false };
  var lastState = '', lastCmdSig = '';

  function bridge() { return global.OfficeBridge; }
  function isShown() { var v = $('pcView'); return !!(v && v.style.display !== 'none' && getComputedStyle(v).display !== 'none'); }
  function motionOn() { try { if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {} try { if (global.KChar && KChar.motionOn && !KChar.motionOn()) return false; } catch (e2) {} return true; }
  function nowServer() { var sn = data && ms(data.server_now); return sn === null || sn === undefined ? Date.now() : sn + (Date.now() - (data._at || Date.now())); }
  function curCmd() { return data && isObj(data.cmd) ? data.cmd : null; }
  function tracking() { var c = curCmd(); return !!(c && isActiveStatus(c.status)); }

  var HTML =
    '<div class="pcs-status"><i class="pcs-dot" id="pcDot"></i><span id="pcStatTx"></span><button type="button" class="pcs-again" id="pcAgain" style="display:none;">다시 확인</button></div>' +
    '<div class="card pcs-card" id="pcCard">' +
      '<div class="pcs-say"><span class="kface sm pcs-kf" data-kface="head" aria-hidden="true" id="pcFace"></span><b id="pcSay"></b></div>' +
      '<div class="pcs-note" id="pcNote" style="display:none;"></div>' +
      '<div class="pcs-m" id="pcCpuBox"><div class="pcs-mh"><span>CPU</span><span id="pcCpuSpan">최근 1분</span></div>' +
        '<div class="pcs-mb"><div class="pcs-num"><b id="pcCpu">-</b><i id="pcCpuU">%</i></div><svg class="pcs-spark" viewBox="0 0 120 36" preserveAspectRatio="none" aria-hidden="true"><polyline id="pcSpark" points="" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg></div>' +
        '<div class="pcs-bar"><u id="pcCpuBar"></u></div><div class="pcs-mf"><span id="pcCpuWord"></span><span id="pcCpuAvg">10초 평균 기준</span></div></div>' +
      '<div class="pcs-m" id="pcMemBox"><div class="pcs-mh"><span>메모리</span><span></span></div>' +
        '<div class="pcs-mb"><div class="pcs-num"><b id="pcMem">-</b><i id="pcMemU"></i></div></div>' +
        '<div class="pcs-bar"><u id="pcMemBar"></u></div><div class="pcs-mf"><span id="pcMemWord"></span><span></span></div></div>' +
      '<div class="pcs-m" id="pcDiskBox" style="display:none;"><div class="pcs-mh"><span id="pcDiskName">저장공간 (C 드라이브)</span><span id="pcDiskSpan">1분마다 확인</span></div>' +
        '<div class="pcs-mb"><div class="pcs-num"><b id="pcDisk">-</b><i id="pcDiskU"></i></div></div>' +
        '<div class="pcs-bar"><u id="pcDiskBar"></u></div><div class="pcs-mf"><span id="pcDiskWord"></span><span id="pcDiskFree"></span></div>' +
        '<div class="pcs-dnote" id="pcDiskNote"></div></div>' +
      '<div id="pcExtBox"></div>' +
      '<div class="pcs-misc" id="pcGpuRow"><span>그래픽카드</span><span id="pcGpu"></span></div>' +
      '<div class="pcs-misc" id="pcStateRow"><span>클로드 앱 · 일꾼</span><span id="pcState"></span></div>' +
      '<div class="pcs-top" id="pcTop"><div class="pcs-t">지금 가장 바쁜 프로그램</div><div id="pcTopRows"></div></div>' +
      '<div class="pcs-work" id="pcWorkRow" style="display:none;"></div>' +
      '<div class="pcs-upd" id="pcUpd"></div>' +
    '</div>' +
    '<div class="pcs-cmd" id="pcCmd" style="display:none;"></div>' +
    '<div class="pcs-fold" id="pcFold"><button type="button" class="pcs-foldbtn" id="pcFoldBtn" aria-expanded="false"><span class="pcs-ic"><svg><use href="#i-monitor"/></svg></span><b>PC 관리 (다시 시작)</b><span class="pcs-op" id="pcFoldOp">눌러 펼침</span></button>' +
      '<div class="pcs-foldbody" id="pcFoldBody" style="display:none;">' +
        '<p class="pcs-fp">누르면 바로 시작되지 않고 한 번 더 확인합니다. 아래쪽이 영향이 더 큽니다.</p>' +
        '<button type="button" class="pcs-pow claude" id="pcBtnClaude"><b>클로드 앱 다시 시작</b><small>클로드 앱을 닫았다 다시 켭니다. 앱 안에서 도는 대화가 중단됩니다. 1~3분</small><small class="w">언제 쓰나 · 클로드 앱이 멈췄을 때</small><em id="pcLockClaude"></em></button>' +
        '<button type="button" class="pcs-pow pc" id="pcBtnPc"><b>PC 전체 다시 시작</b><small>60초 뒤 재부팅합니다. 켜진 뒤 클로드·리스너·일꾼 상태까지 확인합니다. 3~6분</small><small class="w">언제 쓰나 · 클로드 앱 재시작으로 안 풀릴 때 마지막으로</small><em id="pcLockPc"></em></button>' +
        '<p class="pcs-honest">※ 두 버튼 모두 PC가 느린 원인(무거운 작업)을 직접 풀어 주지는 못합니다. 무엇이 CPU를 쓰는지는 위 화면에서 보십시오.</p>' +
      '</div></div>' +
    '<div class="pcs-foot" id="pcFoot"></div>' +
    '<div class="pcs-sheet" id="pcSheet" style="display:none;" role="dialog" aria-modal="true"><div class="pcs-sbox">' +
      '<div class="pcs-sh" id="pcShTitle"></div>' +
      '<div class="pcs-sbody" id="pcShBody"></div>' +
      '<div class="pcs-warn" id="pcShWarn" style="display:none;"></div>' +
      '<div class="pcs-err" id="pcShErr" role="alert"></div>' +
      '<div class="pcs-sact"><button type="button" class="pcs-sbtn" id="pcShCancel">취소</button><button type="button" class="pcs-sbtn go" id="pcShGo">다시 시작</button></div>' +
    '</div></div>';

  function build() {
    if (built) return;
    var b = $('pcBody'); if (!b) return;
    b.innerHTML = HTML;
    built = true;
    $('pcFoldBtn').addEventListener('click', function () { foldOpen = !foldOpen; renderFold(); });
    $('pcBtnClaude').addEventListener('click', function () { onPow('claude_restart'); });
    $('pcBtnPc').addEventListener('click', function () { onPow('pc_reboot'); });
    $('pcAgain').addEventListener('click', function () { poll(true); });
    $('pcShCancel').addEventListener('click', closeSheet);
    $('pcShGo').addEventListener('click', sendRequest);
    $('pcSheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  }

  /* ---- 그리기 ---- */
  function setText(id, t) { var el = $(id); if (el && el.textContent !== t) el.textContent = t; }
  function tweenNum(el, to, dec) {
    if (!el) return;
    var from = parseFloat(el.getAttribute('data-v'));
    el.setAttribute('data-v', String(to));
    var fin = dec ? to.toFixed(1) : String(Math.round(to));
    if (!motionOn() || isNaN(from) || from === to) { el.textContent = fin; return; }
    var t0 = Date.now(), dur = 300;
    (function step() {
      var k = Math.min(1, (Date.now() - t0) / dur), v = from + (to - from) * k;
      el.textContent = dec ? v.toFixed(1) : String(Math.round(v));
      if (k < 1 && el.getAttribute('data-v') === String(to)) setTimeout(step, 40); else el.textContent = fin;
    })();
  }
  function sparkPoints(p) {
    var h = (isObj(p) && isObj(p.cpu) && Array.isArray(p.cpu.hist)) ? p.cpu.hist.map(num).filter(function (x) { return x !== null; }).slice(-15) : [];
    if (h.length < 2) return '';
    var n = h.length;
    return h.map(function (v, i) { return (i * 120 / (n - 1)).toFixed(1) + ',' + (34 - clamp(v, 0, 100) * 0.32).toFixed(1); }).join(' ');
  }
  function setBar(id, pct, lv) {
    var el = $(id); if (!el) return;
    el.style.width = (pct === null ? 0 : clamp(pct, 0, 100)) + '%';
    el.className = 'lv-' + lv;
  }

  function render() {
    if (!built) return;
    var v = $('pcView'); if (v) v.classList.toggle('calm', !motionOn());
    var j = judge(data, { openedAt: openedAt, tracking: tracking() });
    var p = data && data.payload;
    var st = notready ? 'notready' : (badpass ? 'badpass' : (noPass ? 'nopass' : j.state));
    // 위쪽 줄·점
    var dotCls = { live: 'ok', connecting: 'wait', slow: 'slow', down: 'down', restarting: 'wait', none: 'na', off: 'na', notready: 'na', badpass: 'na', nopass: 'na' }[st] || 'na';
    $('pcDot').className = 'pcs-dot ' + dotCls; $('pcSdot').className = 'pcs-sdot ' + dotCls;
    var stx;
    if (notready) stx = '서버 준비 중입니다';
    else if (badpass) stx = '연동 암호가 맞지 않습니다';
    else if (noPass) stx = '연동 암호가 필요합니다';
    else stx = statusLine(j);
    if (netErr && !notready && !badpass && !noPass && data) stx += ' · 서버에 연결하지 못했습니다';
    setText('pcStatTx', stx);
    $('pcAgain').style.display = (st === 'down' || st === 'none' || netErr || notready) ? '' : 'none';
    // 케이 한 줄·표정
    var say;
    if (notready) say = '서버에 PC 상태 기능이 아직 켜지지 않았습니다. 준비가 끝나면 이 화면에서 바로 보입니다.';
    else if (badpass) say = '연동 암호가 맞지 않아 PC 상태를 읽지 못했습니다.';
    else if (noPass) say = '연동 암호를 넣으면 PC 상태가 보입니다. 케이 채팅 화면에서 먼저 연동해 주십시오.';
    else say = sayLine(data, j);
    setText('pcSay', say);
    var face = $('pcFace');
    if (face && lastState !== st) {
      lastState = st;
      try {
        if (global.KChar && KChar.faceFlash) {
          var ex = (st === 'down' || st === 'slow' || st === 'badpass') ? 'concern' : ((st === 'live' && (level(cpuNow(p), 'cpu') === 'hot')) ? 'thinking' : '');
          if (ex) KChar.faceFlash(face, ex, 30000); else { face._kTemp = ''; }
        }
      } catch (e) {}
    }
    var note = $('pcNote');
    if (st === 'down') { note.textContent = DOWN_NOTE; note.style.display = ''; } else note.style.display = 'none';
    // 수치
    var card = $('pcCard');
    var stale = (st === 'down' || st === 'none' || st === 'off' || st === 'notready' || st === 'badpass' || st === 'nopass');
    card.classList.toggle('stale', stale);
    card.classList.toggle('dim', !!j.dim && !stale);
    var cpu = cpuNow(p), mem = memInfo(p);
    var hasP = !!(p && isObj(p));
    if (cpu === null) { setText('pcCpu', hasP ? '확인 못 함' : '-'); $('pcCpuU').textContent = ''; $('pcCpu').setAttribute('data-v', ''); }
    else { $('pcCpuU').textContent = '%'; tweenNum($('pcCpu'), cpu, false); }
    var lc = level(cpu, 'cpu');
    setBar('pcCpuBar', cpu, lc);
    $('pcCpuBox').className = 'pcs-m lv-' + lc;
    setText('pcCpuWord', LEVEL_WORD[lc] || '');
    setText('pcCpuSpan', (p && num(p.iv) !== null && num(p.iv) <= 4) ? '최근 1분' : '최근 15분');
    var sp = sparkPoints(p); $('pcSpark').setAttribute('points', sp); $('pcSpark').parentNode.style.visibility = sp ? 'visible' : 'hidden';
    setText('pcCpuAvg', (p && num(p.iv) !== null && num(p.iv) <= 4) ? '10초 평균 기준' : '지금 값');
    if (!mem || mem.used === null || mem.total === null) {
      if (mem && mem.pct !== null) { tweenNum($('pcMem'), mem.pct, false); setText('pcMemU', ' %'); } else { setText('pcMem', hasP ? '확인 못 함' : '-'); setText('pcMemU', ''); $('pcMem').setAttribute('data-v', ''); }
    } else { tweenNum($('pcMem'), mem.used, true); setText('pcMemU', ' / ' + Math.round(mem.total) + ' GB'); }
    var lm = level(mem && mem.pct, 'mem');
    setBar('pcMemBar', mem ? mem.pct : null, lm);
    $('pcMemBox').className = 'pcs-m lv-' + lm;
    setText('pcMemWord', mem && mem.pct !== null ? '사용 ' + Math.round(mem.pct) + ' % · ' + LEVEL_WORD[lm] : '확인 못 함');
    renderDisk(p, j);
    renderExt(p, j);
    // 그래픽·상태·상위 프로그램
    var g = p && isObj(p.gpu) ? p.gpu : null;
    $('pcGpuRow').style.display = g ? '' : 'none';
    if (g) setText('pcGpu', (num(g.pct) === null ? '확인 못 함' : Math.round(g.pct) + ' %') + (num(g.used_mb) !== null && num(g.total_mb) ? '  ·  ' + gb1(g.used_mb / 1024) + ' / ' + gb1(g.total_mb / 1024) + ' GB' : ''));
    var cl = p && isObj(p.claude) ? p.claude : null, wk = p && isObj(p.workers) ? p.workers : null;
    $('pcStateRow').style.display = (cl || wk) ? '' : 'none';
    setText('pcState', (cl ? (cl.up ? (cl.window === false ? '켜짐(창 확인 못 함)' : '켜짐') : '꺼짐') : '확인 못 함') + ' · ' + (wk && num(wk.total) ? '일꾼 ' + wk.total + '개 중 ' + wk.ok + '개 정상' : '일꾼 확인 못 함'));
    var tops = topList(p), rows = '';
    tops.forEach(function (t, i) { rows += '<div class="pcs-row"><span class="rk">' + (i + 1) + '</span><span class="nm">' + esc(t.n) + '</span><span class="pc2">' + (t.pct === null ? '-' : Math.round(t.pct) + '%') + '</span><div class="pcs-bar sm"><u class="lv-' + lc + '" style="width:' + (t.pct === null ? 0 : clamp(t.pct, 0, 100)) + '%"></u></div></div>'; });
    if ($('pcTopRows').getAttribute('data-sig') !== rows) { $('pcTopRows').innerHTML = rows || '<div class="pcs-none">' + (hasP ? '확인 못 함' : '-') + '</div>'; $('pcTopRows').setAttribute('data-sig', rows); }
    var w = workInfo(p), wr = $('pcWorkRow');
    if (w.items.length) { wr.textContent = '지금 도는 일: ' + workText(w); wr.style.display = ''; } else wr.style.display = 'none';
    setText('pcUpd', (!hasP || stale) ? '' : '마지막 확인 ' + fmtAgo(j.seenAge || 0) + ' 전 · ' + (j.mode === 'fast' ? '4초마다 갱신' : '화면을 열면 4초마다 갱신'));
    setText('pcFoot', '');
    renderCmd(j);
    renderFold(j, st);
  }

  /* 저장공간 칸(v9.84). 스위치 PC_DISK_UI='off'(host.disk === false)면 칸을 그리지 않는다 — v9.83 화면과 같다.
   * 숫자가 굴러가는 효과는 쓰지 않는다(천천히 변하는 값). 칸 없음·PC 스위치 off 는 줄 전체를 숨긴다(「확인 못 함」으로 겁주지 않는다). */
  function renderDisk(p, j) {
    var box = $('pcDiskBox'); if (!box) return;
    var dk = host.disk === false ? { show: false, kind: 'off' } : diskInfo(p);
    box.style.display = dk.show ? '' : 'none';
    if (!dk.show) return;
    var lv = 'na', old = 0;
    setText('pcDiskName', '저장공간 (' + (dk.letter || 'C') + ' 드라이브)');
    setText('pcDiskNote', K.DISK_NOTE);
    if (dk.kind === 'ok') {
      var u = capParts(dk.used);
      lv = diskLevel(dk.pct);
      old = diskOld(dk.readAgo, j && j.valAge);
      setText('pcDisk', u ? u.num : '확인 못 함');
      setText('pcDiskU', u ? ' ' + u.unit + ' / ' + fmtCap(dk.total) : '');
      setText('pcDiskWord', '사용 ' + dk.pct + ' % · ' + DISK_WORD[lv]);
      setText('pcDiskFree', '남은 공간 ' + fmtCap(dk.free));
      setBar('pcDiskBar', dk.pct, lv);
    } else {
      setText('pcDisk', dk.kind === 'pending' ? '-' : '확인 못 함');
      setText('pcDiskU', '');
      setText('pcDiskWord', dk.kind === 'pending' ? '읽는 중입니다' : '확인 못 함');
      setText('pcDiskFree', '');
      setBar('pcDiskBar', null, 'na');
    }
    setText('pcDiskSpan', old ? fmtAgo(old) + ' 전 값' : '1분마다 확인');
    box.className = 'pcs-m lv-' + lv + (old ? ' old' : '');
  }

  /* 외장하드 줄(v9.86). 스위치 PC_DISK_EXT_UI='off'(host.diskExt === false)나 저장공간 칸 전체 off(host.disk === false)면 줄이 없다 — v9.85 화면과 같다.
   * 줄 HTML 은 전부 esc() 를 거치고, 직전과 같으면 다시 그리지 않는다. 새 단추·누름 반응·알림·정리 기능은 없다(표시용). */
  function extRow(it) {
    var title = '외장하드' + (it.name ? ' · ' + it.name : '') + ' (' + it.letter + ' 드라이브)';
    var lv = 'na', cls = 'pcs-m pcs-ex', tag = '', num2, word, free = '', w = 0;
    if (it.kind === 'ok') {
      var u = capParts(it.used);
      lv = diskLevel(it.pct); w = it.pct;
      num2 = '<b>' + esc(u ? u.num : '확인 못 함') + '</b><i>' + (u ? esc(' ' + u.unit + ' / ' + fmtCap(it.total)) : '') + '</i>';
      word = '사용 ' + it.pct + ' % · ' + DISK_WORD[lv]; free = '남은 공간 ' + fmtCap(it.free);
      if (it.checking) tag = '확인 중'; else if (it.old) { tag = fmtAgo(it.old) + ' 전 값'; cls += ' old'; }
    } else {
      num2 = '<b>' + (it.kind === 'pending' ? '-' : '확인 못 함') + '</b>';
      word = it.kind === 'pending' ? '읽는 중입니다' : '확인 못 함';
    }
    return '<div class="' + cls + ' lv-' + lv + '"><div class="pcs-exh"><span class="pcs-exn">' + esc(title) + '</span><span class="pcs-exs">' + esc(tag) + '</span></div>' +
      '<div class="pcs-mb"><div class="pcs-num">' + num2 + '</div></div>' +
      '<div class="pcs-bar"><u class="lv-' + lv + '" style="width:' + clamp(w, 0, 100) + '%"></u></div>' +
      '<div class="pcs-mf"><span>' + esc(word) + '</span><span>' + esc(free) + '</span></div></div>';
  }
  function renderExt(p, j) {
    var box = $('pcExtBox'); if (!box) return;
    var ex = (host.disk === false || host.diskExt === false) ? { show: false, items: [], more: 0 } : diskExtList(p, { valAge: j && j.valAge, openedAt: openedAt, now: Date.now() });
    var h = '';
    if (ex.show) {
      h = ex.items.map(extRow).join('');
      if (ex.more) h += '<div class="pcs-exmore">' + esc('외 ' + ex.more + '개 연결됨') + '</div>';
    }
    if (box.getAttribute('data-sig') !== h) { box.innerHTML = h; box.setAttribute('data-sig', h); }
  }

  function renderCmd(j) {
    var box = $('pcCmd'), c = curCmd();
    if (!c) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var cv = cmdView(c, { nowServer: nowServer() });
    // 끝난 요청은 30분 동안만 보인다(그 뒤엔 접어 둔다)
    var req = ms(c.requested_at);
    if (cv.final && req !== null && (nowServer() - req) > 30 * 60 * 1000 && c.id !== trackId) { box.style.display = 'none'; return; }
    var sig = [c.id, c.status, cv.countdown, cv.elapsed === null ? '' : Math.floor(cv.elapsed / 1), cv.title, cv.lines.join('|'), cv.alert].join('~');
    if (sig === lastCmdSig && box.style.display !== 'none') return;
    lastCmdSig = sig;
    var steps = cv.steps.map(function (s, i) { return '<li class="' + s + '"><i></i><span>' + esc(STEP_NAMES[i]) + '</span></li>'; }).join('');
    var h = '<div class="pcs-ch"><b>' + esc(cv.kindName) + '</b><span class="pcs-tag t-' + cv.tone + '">' + (cv.final ? (cv.tag || '끝') : '진행 중') + '</span></div>';
    h += '<div class="pcs-ct t-' + cv.tone + '">' + esc(cv.title) + '</div>';
    if (cv.countdown !== null) h += '<div class="pcs-cd">' + (cv.countdown > 0 ? '<b>' + cv.countdown + '</b> 초 남음' : '곧 시작합니다') + '</div>';
    else if (cv.elapsed !== null) h += '<div class="pcs-cd"><b>' + fmtClock(cv.elapsed) + '</b> 경과</div>';
    h += '<ol class="pcs-steps">' + steps + '</ol>';
    cv.lines.forEach(function (l) { h += '<p class="pcs-cl">' + esc(l) + '</p>'; });
    if (cv.alert) h += '<p class="pcs-cl pcs-alert" role="alert">' + esc(cv.alert) + '</p>';
    if (cv.cancel) h += '<button type="button" class="pcs-cancel" id="pcCancel">재시작 취소</button>';
    if (cv.hint) h += '<p class="pcs-hint">' + esc(cv.hint) + '</p>';
    if (cv.final && (cv.tone === 'unk' || cv.tone === 'bad')) h += '<button type="button" class="pcs-cancel" id="pcAgain2">다시 확인</button>';
    box.innerHTML = h; box.className = 'pcs-cmd c-' + cv.tone; box.style.display = '';
    var cb = $('pcCancel'); if (cb) cb.addEventListener('click', onCancel);
    var ag = $('pcAgain2'); if (ag) ag.addEventListener('click', function () { poll(true); });
  }

  function renderFold(j, st) {
    if (!built) return;
    var fold = $('pcFold');
    if (host.power === false) { fold.style.display = 'none'; return; }
    fold.style.display = '';
    $('pcFoldBody').style.display = foldOpen ? '' : 'none';
    $('pcFoldBtn').setAttribute('aria-expanded', foldOpen ? 'true' : 'false');
    setText('pcFoldOp', foldOpen ? '접기' : '눌러 펼침');
    j = j || judge(data, { openedAt: openedAt, tracking: tracking() });
    var o = { notready: notready || badpass || noPass, tracking: tracking() };
    [['claude_restart', 'pcBtnClaude', 'pcLockClaude'], ['pc_reboot', 'pcBtnPc', 'pcLockPc']].forEach(function (x) {
      var why = lockReason(data, j, x[0], o), b = $(x[1]);
      b.classList.toggle('locked', !!why); b.setAttribute('aria-disabled', why ? 'true' : 'false');
      setText(x[2], why ? '잠김 — ' + why : '');
    });
  }

  /* ---- 확인 시트 ---- */
  function openSheet(kind) {
    var d = data, w = workInfo(d && d.payload);
    sheet.kind = kind; sheet.open = true; sheet.sending = false; sheet.force = w.items.length > 0;
    var pcK = kind === 'pc_reboot';
    $('pcShTitle').textContent = pcK ? '정말 PC를 다시 시작할까요?' : '정말 클로드 앱을 다시 시작할까요?';
    var lines = pcK
      ? ['PC에서 저장 안 한 작업은 사라질 수 있습니다.', '60초 뒤 재부팅합니다. 그 사이 앱에서 취소할 수 있습니다.', '켜진 뒤 클로드·리스너·일꾼 상태를 PC가 직접 확인해 알려 드립니다. 보통 3~6분 걸립니다.']
      : ['클로드 앱을 닫았다 다시 켭니다. 앱 안에서 돌던 대화·작업이 중단됩니다(PC 케이 대화방 포함).', '10초 뒤 시작합니다. 그 사이 앱에서 취소할 수 있습니다.', '새 앱과 창이 뜬 것을 PC가 확인한 뒤에 결과를 알려 드립니다.'];
    $('pcShBody').innerHTML = lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
    var wb = $('pcShWarn');
    if (w.items.length) { wb.innerHTML = '이 작업이 도는 중입니다 — ' + esc(workText(w)) + '. 그래도 다시 시작할까요?' + (w.unsure.length ? '<br>확인하지 못한 항목: ' + esc(w.unsure.join(', ')) : ''); wb.style.display = ''; }
    else if (w.unsure.length) { wb.innerHTML = '확인하지 못한 항목이 있습니다: ' + esc(w.unsure.join(', ')); wb.style.display = ''; }
    else wb.style.display = 'none';
    $('pcShErr').textContent = '';
    var go = $('pcShGo'); go.disabled = false; go.textContent = w.items.length ? '그래도 다시 시작' : '다시 시작';
    $('pcSheet').style.display = '';
    setTimeout(function () { try { $('pcShGo').focus(); } catch (e) {} }, 60);
  }
  function closeSheet() {
    sheet.open = false; sheet.sending = false;
    $('pcSheet').style.display = 'none';
  }
  function onPow(kind) {
    var j = judge(data, { openedAt: openedAt, tracking: tracking() });
    var why = lockReason(data, j, kind, { notready: notready || badpass || noPass, tracking: tracking() });
    if (why) { host.toast(why + '.', 2600); return; }
    openSheet(kind);
  }
  /* [다시 시작]을 누르면 요청을 한 번 보낸다. 보내는 동안(sheet.sending)과 시트가 닫힌 뒤에는 연타해도 다시 보내지 않는다. */
  function sendRequest() {
    if (!sheet.open || sheet.sending) return;
    var kind = sheet.kind, pass = host.getPass(), go = $('pcShGo');
    if (!pass) { $('pcShErr').textContent = '연동 암호가 없습니다. 케이 채팅에서 먼저 연동해 주십시오'; return; }
    var B = bridge(); if (!B || !B.pcPowerRequest) { $('pcShErr').textContent = '이 앱 버전은 지원하지 않습니다'; return; }
    sheet.sending = true; go.disabled = true; var goTx = go.textContent; go.textContent = '보내는 중…'; $('pcShErr').textContent = '';
    var sentAt = nowServer();
    B.pcPowerRequest(pass, kind, !!sheet.force, 'app').then(function (r) {
      if (!sheet.open) return;                                  // 그 사이 시트가 닫혔다
      sheet.sending = false;
      if (r && r.ok) {
        trackId = String(r.id || '');
        closeSheet(); foldOpen = false;
        data = data || {}; data.cmd = { id: trackId, kind: kind, status: 'pending', requested_at: new Date(nowServer()).toISOString(), expires_at: r.expires_at || null, result: {} };
        lastCmdSig = ''; render(); schedule(300);
        host.toast('요청을 보냈습니다. 결과는 PC가 확인한 뒤에 알려 드립니다.', 2800);
        return;
      }
      go.disabled = false; go.textContent = goTx;
      var code = r && r.code;
      if (!knownCode(code)) { try { console.warn('[pc-status] 알 수 없는 응답 코드:', code, r); } catch (e0) {} }
      $('pcShErr').textContent = errText(code, r || {});
    }, function (e) {
      if (!sheet.open) return;
      sheet.sending = false; go.disabled = false; go.textContent = goTx;
      if (e && e.notready) { $('pcShErr').textContent = '서버 준비 중입니다. 요청은 보내지 않았습니다'; return; }
      if (e && e.badpass) { $('pcShErr').textContent = '연동 암호가 맞지 않습니다. 요청은 보내지 않았습니다'; return; }
      // 연결이 끊기거나 시간이 지난 경우: 서버에는 이미 갔을 수 있다 — 「실패」라고 단정하지 않고 바로 상태를 읽어 확인한다
      try { console.warn('[pc-status] 요청 응답을 받지 못함:', e && e.message); } catch (e1) {}
      $('pcShErr').textContent = NET_UNSURE;
      verifyAfterUncertain(kind, sentAt, pass, B);
    });
  }
  /* 요청 응답을 못 받았을 때: get_pc_status 로 최근 요청 1건을 한 번 읽는다. 방금 보낸 것과 같은 요청이 있으면 카드로 이어 간다. */
  function verifyAfterUncertain(kind, sentAt, pass, B) {
    if (!B || !B.getPcStatus) return;
    B.getPcStatus(pass, true).then(function (d) {
      if (!isObj(d)) return;
      d._at = Date.now(); data = d; netErr = false;
      var c = d.cmd, rq = c ? ms(c.requested_at) : null;
      if (c && c.kind === kind && rq !== null && rq >= sentAt - 15000 && (isActiveStatus(c.status) || isFinalStatus(c.status))) {
        trackId = String(c.id || '');
        if (sheet.open) closeSheet();
        foldOpen = false; lastCmdSig = ''; render(); schedule(300);
        host.toast('요청은 서버에 이미 도착해 있었습니다. 진행 상황을 이어서 보여 드립니다.', 3200);
      } else if (sheet.open) {
        $('pcShErr').textContent = NET_UNSURE + ' (방금 읽어 본 때는 서버에 새 요청이 없었습니다)';
        render();
      }
    }, function () { /* 상태도 못 읽었다 — 위의 「확인하지 못했습니다」 안내를 그대로 둔다 */ });
  }
  function onCancel() {
    var c = curCmd(), B = bridge();
    if (!c || !B || !B.pcPowerCancel) return;
    var b = $('pcCancel'); if (b) { b.disabled = true; b.textContent = '취소하는 중…'; }
    B.pcPowerCancel(host.getPass(), c.id).then(function (r) {
      if (r && r.ok) host.toast('취소를 요청했습니다. 취소됐는지 PC가 알려 드립니다.', 2600);
      else host.toast('이미 늦었습니다. 시작된 요청은 취소할 수 없습니다.', 2800);
      poll(true);
    }, function () { host.toast(CANCEL_UNSURE, 3200); if (b) { b.disabled = false; b.textContent = '재시작 취소'; } poll(true); });
  }

  /* ---- 서버 읽기(화면이 보이는 동안만) ---- */
  function interval() {
    if (tracking() || (curCmd() && curCmd().id === trackId && !isFinalStatus(curCmd().status))) return 2000;
    var j = judge(data, { openedAt: openedAt });
    if (notready) return 60000;
    if (j.state === 'down' || netErr) return 10000;       // 오래 소식이 없으면 두드리는 간격을 늘린다
    return 4000;
  }
  function schedule(ms2) { if (timer) clearTimeout(timer); timer = setTimeout(tick, ms2 === undefined ? interval() : ms2); }
  function tick() {
    timer = null;
    if (!isShown() || (typeof document !== 'undefined' && document.hidden)) return;        // 보이지 않으면 멈춘다(다시 열면 다시 시작)
    poll(false);
  }
  function poll(force) {
    if (polling && !force) return;
    var B = bridge(), pass = host.getPass();
    noPass = !pass;
    if (noPass) { render(); return; }
    if (!B || !B.getPcStatus) { notready = true; render(); return; }
    polling = true;
    B.getPcStatus(pass, true).then(function (d) {
      polling = false; netErr = false; badpass = false; notready = false; noPass = false;
      if (isObj(d)) { d._at = Date.now(); data = d; }
      var c = curCmd(); if (c && c.id !== trackId && isActiveStatus(c.status)) trackId = c.id;   // 다른 기기에서 보낸 진행 중 요청도 따라간다
      render(); schedule();
    }, function (e) {
      polling = false;
      if (e && e.notready) { notready = true; badpass = false; netErr = false; }
      else if (e && e.badpass) { badpass = true; netErr = false; }
      else netErr = true;
      render(); schedule();
    });
  }

  /* ---- 홈 줄 ---- */
  function homeDot() {
    var dot = $('pcHomeDot'), sub = $('pcHomeSub'); if (!dot || !sub) return;
    var ks = null; try { ks = host.kstat(); } catch (e) {}
    dot.className = 'pcs-hd ' + (ks === 'ok' ? 'ok' : (ks === 'busy' ? 'slow' : ((ks === 'down' || ks === 'login') ? 'down' : 'na')));
    sub.textContent = ks === 'ok' ? 'CPU·메모리 보기 · 다시 시작' : (ks === 'busy' ? '지금 케이가 일하는 중입니다' : ((ks === 'down' || ks === 'login') ? 'PC 응답 없음 · 눌러서 확인' : 'CPU·메모리 보기 · 다시 시작'));
  }

  function init(h) {
    if (inited) return;
    inited = true;
    for (var k in h) if (h.hasOwnProperty(k)) host[k] = h[k];
    build(); homeDot();
    document.addEventListener('visibilitychange', function () { if (!document.hidden && isShown()) { schedule(0); } });
  }
  function open() {
    build();
    openedAt = Date.now(); lastState = ''; lastCmdSig = ''; foldOpen = false; netErr = false; badpass = false; notready = false;
    if (host.openScreen) host.openScreen();
    render(); poll(true);
  }
  function back() {
    if (sheet.open) { closeSheet(); return true; }
    if (timer) { clearTimeout(timer); timer = null; }
    return false;                    // 더 닫을 게 없으면 홈으로(app.js)
  }

  global.PcStatus = {
    init: init, open: open, back: back, homeDot: homeDot,
    _test: { render: render, setData: function (d) { data = d; if (d) d._at = d._at || Date.now(); render(); }, openSheet: openSheet, state: function () { return { data: data, sheet: sheet, notready: notready, trackId: trackId, foldOpen: foldOpen }; }, setOpenedAt: function (t) { openedAt = t; }, poll: poll, setFold: function (b) { foldOpen = !!b; render(); } }
  };
})(typeof window !== 'undefined' ? window : this);

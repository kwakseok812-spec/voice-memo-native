/* ============================================================================
 * hub-apps.js — 「업무 앱」 목록 + 「규정 도우미」 칸 (v9.76, 업무 허브를 스마트비서 안으로)
 * ----------------------------------------------------------------------------
 * 화면: 홈 「업무 앱」 칸 → 분류별 카드 목록(카드를 누르면 크롬 맞춤 탭으로 열림 · 뒤로/✕ = 이 목록으로 돌아옴)
 *       홈 「규정 도우미」 칸(독립 칸) → 같은 맞춤 탭으로 규정 챗봇(서버를 깨우는 신호 + 「처음 열 땐 30~60초」 안내)
 * 목록의 원본: PC 의 apps\office-hub\apps_data.json 하나. 허브 PWA 와 이 앱이 같은 파일에서 나온다.
 *   서버 get_hub_apps(연동 암호) 한 줄(분류·카드 이름·아이콘·desc·주소 + 규정 도우미 칸)을 받아 폰에 저장해 둔다 → 주소는 APK 안에 없다.
 *   카드를 더하고 빼는 일은 PC 의 hub_update.py 한 번이면 끝(앱 업데이트 불필요).
 * 규칙: · 목록을 못 받으면 「0개」가 아니라 「못 불러왔어요」(저장해 둔 목록이 있으면 그것을 날짜와 함께 보여 준다).
 *       · https 주소만 연다. 주소에 lovable 이 든 것은 목록에 있어도 열지 않는다(방어선 — PC 도구도 이미 거른다).
 *       · 카드가 0개인 분류는 화면에서 숨긴다. 이름·설명은 서버 목록의 글자 그대로(앱이 다시 짓지 않는다).
 *       · 규정 도우미가 「깨어났는지」는 앱이 알 수 없다(무료 서버, 응답을 읽을 수 없는 방식) — 안내 문구와 선행 신호만 한다. 신호(/health)는 AI 를 부르지 않아 무과금.
 * 스위치(app.js): HUB_APPS('on'|'off') · HUB_REG('on'|'off') · HUB_OPEN('tab'|'browser') — off 면 칸이 보이지 않아 v9.75 와 같다.
 * v9.80(O-0781): 화면 맨 위에 「포인트 앱 바로 열기」 묶음(phone-apps.js 의 앱 코드 고정 목록 7장) — 서버 목록·로딩·실패와 무관하게 항상 첫 줄에 있고 움직이지 않는다.
 *       카드를 누르면 폰의 그 앱이 열린다(PhoneApps.openApp). 스위치 POINT_APPS(app.js) = ctx.points. 서버 목록의 웹 「걷기 포인트」 카드(기록 앱)는 그대로 아래 목록에 있다.
 * app.js 연결: HubApps.init({toast,getPass,openScreen,showGate,mode}) · HubApps.open() · HubApps.openReg() · HubApps.back()
 * 시험: HubPure(순수 함수)는 화면 없이 시험할 수 있게 밖으로 내놓았다(node 에서도 require 가능).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* =====================================================================
   * 1. 순수 함수
   * ===================================================================*/
  var KEY = 'smart_hub_apps_v1';
  var DEFAULT_WAIT = '처음 열 땐 30~60초 기다려 주십시오';
  var DEFAULT_COST = '질문을 보낼 때마다 약 15원이 듭니다(누르기만 해서는 안 나갑니다)';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, max) { return (typeof v === 'string' ? v : '').slice(0, max || 200); }

  /* 열어도 되는 주소만 돌려준다(아니면 ''): https 만, 러버블 편집기 미리보기 주소 거부, 공백·제어문자 거부 */
  function safeUrl(u) {
    var s = typeof u === 'string' ? u.trim() : '';
    if (!/^https:\/\/[^\s\u0000-\u001f]+$/i.test(s)) return '';
    var host = s.replace(/^https:\/\//i, '').split(/[\/?#]/)[0].toLowerCase();
    if (!host || host.indexOf('.') < 0) return '';
    if (/lovable/i.test(s)) return '';
    return s;
  }

  /* 서버가 준 목록 → 화면용 {enabled, cats:[{id,title,emoji,apps:[...]}] (카드가 있는 분류만), reg, count}. 쓸 수 없는 모양이면 null.
   *   · 카드가 하나도 없고 규정 칸도 없으면 null(빈 목록으로 저장해 둔 목록을 덮지 않게 — 「못 불러옴」으로 본다) */
  function normalize(m) {
    if (!isObj(m) || !Array.isArray(m.apps) || !Array.isArray(m.cats)) return null;
    var cats = [], byId = {};
    m.cats.forEach(function (c) {
      if (!isObj(c) || typeof c.id !== 'string' || !c.id || byId[c.id]) return;
      var o = { id: c.id, title: str(c.title, 40), emoji: str(c.emoji, 8), apps: [] };
      if (!o.title) return;
      byId[c.id] = o; cats.push(o);
    });
    var count = 0, seen = {};
    m.apps.forEach(function (a) {
      if (!isObj(a)) return;
      var url = safeUrl(a.url), name = str(a.name, 60), c = byId[a.cat];
      if (!url || !name || !c) return;
      var id = str(a.id, 40) || ('app' + count); if (seen[id]) id = id + '-' + count; seen[id] = 1;
      c.apps.push({ id: id, name: name, icon: str(a.icon, 8), desc: str(a.desc, 80), url: url }); count++;
    });
    var reg = null;
    if (isObj(m.reg)) {
      var ru = safeUrl(m.reg.url);
      if (ru) reg = { url: ru, name: str(m.reg.name, 40) || '규정 도우미', title: str(m.reg.title, 40) || '동그래 규정 도우미', desc: str(m.reg.desc, 80), cost: str(m.reg.cost, 120) || DEFAULT_COST, wait: str(m.reg.wait, 80) || DEFAULT_WAIT };
    }
    if (!count && !reg) return null;
    return { enabled: m.enabled !== false, cats: cats.filter(function (c) { return c.apps.length > 0; }), reg: reg, count: count };
  }

  function fmtDay(ts) {
    var d = new Date(ts || 0); if (isNaN(d.getTime()) || !ts) return '';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  /* 케이 한마디(실제 상태와 맞게). st: ok|cached|loading|refreshing */
  function sayFor(st, at, n) {
    if (st === 'ok') return '목록을 최신으로 받았습니다 (' + n + '개)';
    if (st === 'refreshing') return '저장해 둔 목록입니다 — 최신으로 받는 중입니다';
    if (st === 'cached') return '저장해 둔 목록입니다' + (fmtDay(at) ? ' (' + fmtDay(at) + ')' : '') + ' — 지금은 새로 못 받았습니다';
    return '목록을 가져오는 중입니다';
  }

  var HubPure = { safeUrl: safeUrl, normalize: normalize, fmtDay: fmtDay, sayFor: sayFor, esc: esc, KEY: KEY, DEFAULT_WAIT: DEFAULT_WAIT, DEFAULT_COST: DEFAULT_COST };
  if (typeof module !== 'undefined' && module.exports) { module.exports = { HubPure: HubPure }; }
  if (typeof document === 'undefined') return;   // node 시험: 화면 부분은 건너뜀

  /* =====================================================================
   * 2. 화면·서버 연결
   * ===================================================================*/
  function $(id) { return document.getElementById(id); }
  var ctx = null, S = { m: null, at: 0, status: 'idle', fetching: null, lastOk: 0, lastOpen: 0 };

  function bridge() { return global.OfficeBridge; }
  function calm() { try { if (global.KScene && KScene.calm) return !!KScene.calm(); return !!(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function isShown() { var v = $('hubView'); return !!(v && v.style.display !== 'none' && getComputedStyle(v).display !== 'none'); }

  function loadSaved() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && isObj(o.m)) { var n = normalize(o.m); if (n) { S.m = n; S.at = o.at || 0; return; } }
    } catch (e) {}
  }
  function saveRaw(raw) { try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), m: raw })); } catch (e) {} }

  /* ---- 목록 받기 ---- */
  function load(force) {
    if (S.fetching) return S.fetching;
    var pass = ctx && ctx.getPass ? ctx.getPass() : '';
    if (!pass) { S.status = 'nopass'; render(); return Promise.resolve(false); }
    if (!force && S.m && S.status === 'ok' && Date.now() - S.lastOk < 60000) return Promise.resolve(true);   // 60초 안에는 다시 묻지 않는다
    S.status = S.m ? 'refreshing' : 'loading'; render();
    S.fetching = bridge().getHubApps(pass).then(function (raw) {
      S.fetching = null;
      if (raw === null || raw === undefined) { S.status = S.m ? 'cached' : 'empty'; render(); return false; }          // 서버에 아직 목록이 없다
      var n = normalize(raw);
      if (!n) { S.status = S.m ? 'cached' : 'badshape'; render(); return false; }                                    // 모양이 이상한 목록은 받아들이지 않는다(저장본 유지)
      S.m = n; S.at = Date.now(); S.lastOk = S.at; S.status = 'ok'; saveRaw(raw); render(); return true;
    }, function (e) {
      S.fetching = null;
      var st = (e && e.badpass) ? 'badpass' : (e && e.notready) ? 'notready' : 'offline';
      S.status = (S.m && st !== 'badpass') ? 'cached' : st;   // 저장해 둔 목록이 있으면 그것을 날짜와 함께 보여 준다. 암호가 틀린 것만 먼저 알린다
      render(); return false;
    });
    return S.fetching;
  }

  /* ---- 열기 ---- */
  var lastGo = 0;
  function openUrl(url) {
    var u = safeUrl(url);
    if (!u) { ctx.toast('열 수 없는 주소입니다. 목록을 새로 받아 보십시오.', 3200); return false; }
    if (Date.now() - lastGo < 700) return false;      // 두 번 눌러도 한 번만
    lastGo = Date.now();
    var EA = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.ExternalApp;
    var native = !!(global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform());
    function viaWindow() {
      var w = null; try { w = global.open(u, '_blank', 'noopener'); } catch (e) {}
      if (!w && native) ctx.toast('주소를 열지 못했습니다. 폰의 기본 브라우저가 있는지 확인해 주십시오.', 3600);
    }
    if (native && ctx.mode !== 'browser' && EA && EA.openTab) {
      EA.openTab({ url: u }).then(function (r) { if (!r || !r.opened) viaWindow(); }, function () { viaWindow(); });
    } else viaWindow();
    return true;
  }
  /* 무료 서버를 미리 깨우는 신호 — 응답은 읽지 않는다(이 서버는 다른 주소에서 읽는 것을 허용하지 않음). AI 를 부르지 않아 과금 없음. */
  function warm(url) {
    try { var o = new URL(url).origin; fetch(o + '/health', { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) {}
  }

  function goReg(reg) {
    warm(reg.url);
    ctx.toast(reg.wait + ' · ' + reg.cost, 6000, true);
    openUrl(reg.url);
  }
  function openReg() {
    if (!ctx) return;
    var pass = ctx.getPass ? ctx.getPass() : '';
    if (S.m && S.m.reg) { goReg(S.m.reg); if (pass) load(false); return; }          // 저장해 둔 주소로 바로(주소는 서버 목록에서 받아 폰에 저장해 둔 것)
    if (!pass) { ctx.toast('연동 암호를 넣으면 규정 도우미를 열 수 있습니다.', 3600); if (ctx.showGate) ctx.showGate(true); return; }
    ctx.toast('규정 도우미 주소를 확인하는 중입니다…', 2200);
    load(true).then(function () {
      if (S.m && S.m.reg) goReg(S.m.reg);
      else ctx.toast('규정 도우미 주소를 불러오지 못했습니다. 연결을 확인한 뒤 다시 눌러 주십시오.', 4200);
    });
  }

  /* ---- 그리기 ---- */
  var HTML_BUILT = false;
  function build() {
    if (HTML_BUILT || !$('hubBody')) return;
    HTML_BUILT = true;
    $('hubBody').innerHTML = '<div id="hubPoint"></div><div class="hub-say"><span class="kface sm hub-kf" data-kface="head" aria-hidden="true"></span><b id="hubSay"></b></div><div id="hubList"></div>';
    renderPoints();
    $('hubBody').addEventListener('click', function (ev) {
      var pt = ev.target.closest && ev.target.closest('[data-pt]');
      if (pt) { if (global.PhoneApps && PhoneApps.openApp) PhoneApps.openApp(pt.getAttribute('data-pt')); return; }   // v9.80: 폰 앱 열기(잠금·미설치 시트·PC 안내는 phone-apps.js)
      var b = ev.target.closest && ev.target.closest('[data-hub]');
      if (b) {
        var id = b.getAttribute('data-hub'), found = null;
        if (S.m) S.m.cats.forEach(function (c) { c.apps.forEach(function (a) { if (a.id === id) found = a; }); });
        if (found) openUrl(found.url);
        return;
      }
      var r = ev.target.closest && ev.target.closest('[data-hubact]');
      if (!r) return;
      var act = r.getAttribute('data-hubact');
      if (act === 'retry') load(true);
      else if (act === 'gate' && ctx.showGate) ctx.showGate(true);
    });
    var rf = $('hubRefresh'); if (rf) rf.addEventListener('click', function () { load(true).then(function (ok) { if (ok) ctx.toast('목록을 새로 받았습니다.', 1600); }); });
  }

  /* v9.80 「포인트 앱 바로 열기」 — 서버 목록과 독립(render 가 지우지 않는다). 카드 등장 움직임 없음(움직이지 않는 자리).
   * v9.81: 세로 긴 카드 목록 → 같은 크기의 2열 칸(아이콘 + 앱 이름만). 설명어구·「폰에서만 열립니다」 표시 없음(PC 에서는 눌렀을 때 안내 토스트만 — phone-apps.js). 접근성 라벨은 이름만. */
  function renderPoints() {
    var box = $('hubPoint'); if (!box) return;
    var P = global.PhoneApps;
    if (!(ctx && ctx.points !== false && P && P.POINTS && P.POINTS.length)) { box.innerHTML = ''; return; }
    var html = '<div class="hub-cat">포인트 앱 바로 열기</div><div class="hub-ptgrid">';
    P.POINTS.forEach(function (a) {
      html += '<button type="button" class="hub-card hub-pt" data-pt="' + esc(a.id) + '" aria-label="' + esc(a.name) + '">' +
        '<span class="hub-ic" aria-hidden="true">' + esc(a.icon || '•') + '</span>' +
        '<b>' + esc(a.name) + '</b></button>';
    });
    box.innerHTML = html + '</div>';
  }

  function errBlock(title, body, actions) {
    return '<div class="hub-err"><b>' + esc(title) + '</b><p>' + esc(body) + '</p>' + (actions || '') + '</div>';
  }
  function render() {
    if (!ctx || !HTML_BUILT || !$('hubList')) return;
    var st = S.status, list = $('hubList'), say = $('hubSay'), html = '';
    var hasM = !!(S.m && S.m.cats.length);
    $('hubView').classList.toggle('calm', calm());
    if (st === 'nopass') {
      say.textContent = '연동 암호를 넣으면 목록이 보입니다';
      html = errBlock('연동 암호가 필요합니다', '이 폰에 연동 암호가 아직 없습니다. 한 번만 넣으면 됩니다.', '<button type="button" class="hub-btn" data-hubact="gate">연동 암호 넣기</button>');
    } else if (st === 'badpass') {
      say.textContent = '연동 암호가 맞지 않습니다';
      html = errBlock('목록을 받지 못했습니다', '연동 암호가 맞지 않는다고 서버가 답했습니다. 암호를 다시 넣어 주십시오.', '<button type="button" class="hub-btn" data-hubact="gate">연동 암호 다시 넣기</button>') + (hasM ? '' : '');
    } else if (!hasM) {
      if (st === 'loading' || st === 'idle') { say.textContent = sayFor('loading'); html = '<div class="hub-wait"><span class="hub-spin" aria-hidden="true"></span>목록을 가져오는 중…</div>'; }
      else if (st === 'notready') { say.textContent = '서버 준비 중입니다'; html = errBlock('서버 준비 중입니다', '업무 앱 목록을 담을 서버 칸이 아직 열리지 않았습니다.', '<button type="button" class="hub-btn ghost" data-hubact="retry">다시 시도</button>'); }
      else if (st === 'empty') { say.textContent = '목록이 아직 올라오지 않았습니다'; html = errBlock('목록이 아직 없습니다', '서버에 업무 앱 목록이 아직 올라오지 않았습니다.', '<button type="button" class="hub-btn ghost" data-hubact="retry">다시 시도</button>'); }
      else { say.textContent = '목록을 못 불러왔습니다'; html = errBlock('목록을 못 불러왔습니다', st === 'badshape' ? '서버가 준 목록의 모양이 이상해서 쓰지 않았습니다.' : '인터넷 연결이나 서버 상태를 확인하고 다시 시도해 주십시오.', '<button type="button" class="hub-btn" data-hubact="retry">다시 시도</button>'); }
    } else if (!S.m.enabled) {
      say.textContent = '업무 앱은 지금 준비 중입니다';
      html = errBlock('업무 앱은 지금 준비 중입니다', '목록이 잠시 꺼져 있습니다. 다시 켜지면 이 화면에 나타납니다.', '<button type="button" class="hub-btn ghost" data-hubact="retry">다시 확인</button>');
    } else {
      if (st !== 'badpass') say.textContent = sayFor(st === 'ok' ? 'ok' : (st === 'refreshing' ? 'refreshing' : 'cached'), S.at, S.m.count);
      var i = 0;
      S.m.cats.forEach(function (c) {
        html += '<div class="hub-cat">' + (c.emoji ? '<span aria-hidden="true">' + esc(c.emoji) + '</span> ' : '') + esc(c.title) + '</div>';
        c.apps.forEach(function (a) {
          html += '<button type="button" class="hub-card" data-hub="' + esc(a.id) + '" style="animation-delay:' + Math.min(i, 8) * 30 + 'ms">' +
            '<span class="hub-ic" aria-hidden="true">' + esc(a.icon || '•') + '</span>' +
            '<span class="hub-tx"><b>' + esc(a.name) + '</b>' + (a.desc ? '<small>' + esc(a.desc) + '</small>' : '') + '</span>' +
            '<svg class="hub-go" aria-hidden="true"><use href="#i-chev-r"/></svg></button>';
          i++;
        });
      });
      if (st === 'cached' || st === 'offline') html += '<div class="hub-note">새로 받으려면 오른쪽 위 ⟳ 단추를 눌러 주십시오.</div>';
    }
    list.innerHTML = html;
  }

  function open() {
    if (!ctx) return;
    build(); renderPoints(); ctx.openScreen();
    S.lastOpen = Date.now();
    if (!S.m) loadSaved();
    var recent = !!(S.m && S.status === 'ok' && Date.now() - S.lastOk < 60000);     // 방금 받았으면 다시 묻지 않는다
    if (!recent && !S.fetching) S.status = S.m ? 'cached' : 'idle';
    render(); load(false);
  }
  function back() { return false; }   // 목록 화면은 열린 창이 없다 — 홈으로 가는 것은 app.js

  function init(c) {
    ctx = c; loadSaved(); build();
    if (!S.m) S.status = 'idle';
    return true;
  }

  global.HubApps = {
    init: init, open: open, openReg: openReg, back: back,
    _test: { state: function () { return { status: S.status, count: S.m ? S.m.count : 0, hasReg: !!(S.m && S.m.reg), shown: isShown() }; }, load: load, openUrl: openUrl, KEY: KEY }
  };
  global.HubPure = HubPure;
})(typeof window !== 'undefined' ? window : globalThis);

/* silent-cam.js — 스마트비서 «소리 없는 카메라» 웹 쪽 창구 (v9.29, 지시대장 O-0607). window.SilentCam 하나만 노출한다.
 * 하는 일: 네이티브 플러그인(Capacitor.Plugins.SilentCamera) 호출 · 카메라 허락 안내(케이 말투) · 거절됐을 때 대체 길 안내 ·
 *          찍은 사진(앱 안 임시 JPEG)을 웹 File 로 한 장씩 읽기 · 담기가 끝난 사진을 지우기 · 앱이 정리됐다 돌아왔을 때 «찍어 둔 사진» 되찾기 · 3일 청소.
 * 안 하는 일: 사진 처리(테두리·펴기·보정·PDF)는 하지 않는다 — 그건 doc-scan.js 가 그대로 한다. 스위치(켜고 끄기)는 app.js 가 config() 로 넘긴다.
 * 플러그인이 없거나(PC판·옛 앱) 스위치가 꺼졌거나 카메라를 못 열면 kind:'fallback' 을 돌려주고, 부른 쪽이 예전 길(폰 기본 카메라/사진 고르기)로 간다. */
(function (global) {
  'use strict';
  var CFG = { on: false, engine: 'auto' };
  var busy = false;                       // 카메라 화면이 열려 있거나 열리는 중
  var CSS_ID = 'silentcam-css';

  function Cap() { return global.Capacitor; }
  function P() { if (global.__silentCamTestPlugin) return global.__silentCamTestPlugin; try { var c = Cap();   // (앞 줄: PC 시험용 가짜 플러그인 자리 — 폰에서는 쓰이지 않는다)
    return (c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.SilentCamera) || null; } catch (e) { return null; } }
  function usable() { return !!CFG.on && !!P(); }
  function engine() {
    try { var o = localStorage.getItem('silentcam_engine'); if (o === 'quality' || o === 'fast' || o === 'frame') return o; } catch (e) {}   // 현장 시험용 덮어쓰기(콘솔에서만)
    return CFG.engine || 'auto';
  }

  /* ───────── 안내 시트(케이 말투) ───────── */
  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID;
    st.textContent = [
      '.sc-scrim{position:fixed;inset:0;z-index:9300;display:flex;align-items:flex-end;justify-content:center;background:rgba(7,11,29,.55);padding:0 0 env(safe-area-inset-bottom,0px)}',
      '.sc-box{width:100%;max-width:520px;background:var(--bg1,#fff);color:var(--text,#0F172A);border-radius:22px 22px 0 0;padding:20px 18px 18px;font-family:"Pretendard",-apple-system,"Malgun Gothic","맑은 고딕",sans-serif;box-shadow:0 -8px 30px rgba(0,0,0,.25)}',
      '.sc-box h3{margin:0 0 8px;font-size:19px;font-weight:800;line-height:1.35}',
      '.sc-box p{margin:0 0 14px;font-size:16px;line-height:1.5;color:var(--muted,#55627D)}',
      '.sc-btns{display:flex;flex-direction:column;gap:8px}',
      '.sc-btn{min-height:52px;padding:10px 16px;border-radius:14px;border:1.5px solid var(--glass-b2,#b9c2dc);background:var(--bg1,#fff);color:var(--text,#0F172A);font:inherit;font-weight:700;font-size:16px;cursor:pointer}',
      '.sc-btn.sc-pri{background:linear-gradient(135deg,var(--p1,#3B82F6),var(--p2,#8B5CF6));color:#fff;border-color:transparent}',
      '.sc-btn:active{filter:brightness(.92)}'
    ].join('');
    document.head.appendChild(st);
  }
  function sheet(title, body, buttons) {      // buttons: [{label, value, primary}] → Promise<value>
    css();
    return new Promise(function (res) {
      var sc = document.createElement('div'); sc.className = 'sc-scrim'; sc.setAttribute('role', 'dialog'); sc.setAttribute('aria-label', title);
      var bx = document.createElement('div'); bx.className = 'sc-box';
      var h = document.createElement('h3'); h.textContent = title; bx.appendChild(h);
      if (body) { var p = document.createElement('p'); p.textContent = body; bx.appendChild(p); }
      var bs = document.createElement('div'); bs.className = 'sc-btns';
      buttons.forEach(function (b) {
        var el = document.createElement('button'); el.type = 'button'; el.className = 'sc-btn' + (b.primary ? ' sc-pri' : ''); el.textContent = b.label;
        el.addEventListener('click', function () { try { sc.remove(); } catch (e) {} res(b.value); });
        bs.appendChild(el);
      });
      bx.appendChild(bs); sc.appendChild(bx); document.body.appendChild(sc);
    });
  }

  /* ───────── 허락 ───────── */
  function deniedFlow(mode) {
    if (mode === 'photo') {
      return sheet('카메라를 지금은 쓸 수 없어요', '일반 사진 찍기는 카메라 허락이 있어야 해요. 폰 설정에서 허락해 주시면 이 화면에서 바로 이어져요.', [
        { label: '폰 설정에서 허락하기', value: 'settings', primary: true }, { label: '닫기', value: 'close' }
      ]).then(function (v) { if (v === 'settings') { try { P().openAppSettings(); } catch (e) {} } return { kind: 'cancel' }; });
    }
    return sheet('카메라를 지금은 쓸 수 없어요', '카메라 허락이 꺼져 있어요. 그래도 문서와 영수증은 사진을 골라 주시면 똑같이 펴 드려요.', [
      { label: '사진 골라서 계속하기', value: 'gallery', primary: true }, { label: '폰 설정에서 허락하기', value: 'settings' }
    ]).then(function (v) {
      if (v === 'settings') { try { P().openAppSettings(); } catch (e) {} return { kind: 'cancel' }; }
      return { kind: 'gallery' };
    });
  }
  function ensurePerm(mode, st) {             // → Promise<'ok' | result(= denied 안내 뒤 결과)>
    if (st.perm === 'granted') return Promise.resolve('ok');
    if (st.perm === 'denied') return deniedFlow(mode);
    return sheet('카메라를 써도 될까요?', '문서와 영수증을 바로 찍어서 반듯하게 펴 드리려고요. 찍은 사진은 이 폰 안에서만 쓰고, 제가 보낸다고 하기 전에는 밖으로 안 나가요.', [
      { label: '허용하기', value: 'ask', primary: true }, { label: '나중에', value: 'later' }
    ]).then(function (v) {
      if (v !== 'ask') return { kind: 'cancel' };
      return P().requestPermission().then(function (r) { return r && r.granted ? 'ok' : deniedFlow(mode); }, function () { return deniedFlow(mode); });
    });
  }

  /* ───────── 읽기·정리 ───────── */
  function url(path) { var c = Cap(); return (c && typeof c.convertFileSrc === 'function') ? c.convertFileSrc(path) : path; }
  function readOne(pg, n) {
    return fetch(url(pg.path)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function (b) {
      var f = new File([b], 'scan_' + (n + 1) + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      f._q = pg.q || 'sharp'; f._p = pg.path; f._shake = !!pg.shake;       // 흐림·어두움 표시, 담은 뒤 지울 경로
      return f;
    });
  }
  function readAll(pages) {                    // 한 장씩 차례로(기존 처리와 같은 메모리 패턴)
    var out = [], i = 0;
    function step() {
      if (i >= pages.length) return Promise.resolve(out);
      return readOne(pages[i], i).then(function (f) { out.push(f); i++; return step(); });
    }
    return step();
  }
  function release(f) {                        // 담기에 성공한(또는 읽을 수 없는) 사진을 앱 안에서 지운다. 못 지워도 3일 청소가 한다
    try { var p = P(); if (p && f && f._p) { var path = f._p; f._p = null; return Promise.resolve(p.release({ path: path })).catch(function () {}); } } catch (e) {}
    return Promise.resolve();
  }
  function releasePath(path) { try { var p = P(); if (p && path) return Promise.resolve(p.release({ path: path })).catch(function () {}); } catch (e) {} return Promise.resolve(); }

  /* ───────── 찍기 ───────── */
  // opt: {mode:'doc'|'receipt'|'photo', from:'tab'|'scan', multi, left, title}
  // → {kind:'files', files, mode, action} | {kind:'cancel', mode} | {kind:'gallery'} | {kind:'fallback', why}
  function shoot(opt) {
    opt = opt || {};
    if (!usable()) return Promise.resolve({ kind: 'fallback', why: CFG.on ? 'noplugin' : 'off' });
    if (busy) return Promise.resolve({ kind: 'cancel', mode: opt.mode });
    var p = P(), mode = opt.mode || 'doc';
    busy = true;
    function done(r) { busy = false; return r; }
    return p.status().then(function (st) {
      if (!st || !st.available) return done({ kind: 'fallback', why: 'nocamera' });
      return ensurePerm(mode, st).then(function (g) {
        if (g !== 'ok') return done(g);
        return p.open({ mode: mode, from: opt.from || 'tab', multi: !!opt.multi, left: opt.left == null ? 100 : opt.left, title: opt.title || null, engine: engine(), resume: !!opt.resume }).then(function (r) {
          r = r || {};
          if (r.action === 'denied') return deniedFlow(mode).then(done);
          if (r.action === 'error') return done({ kind: 'fallback', why: r.reason || 'error' });
          if ((r.action === 'done' || r.action === 'send') && r.pages && r.pages.length) {
            return readAll(r.pages).then(function (files) {
              return done({ kind: 'files', files: files, mode: r.mode || mode, action: r.action });
            }, function () {
              // 사진은 앱 안에 남아 있다(복구 목록). 다음에 앱을 열면 «찍어 둔 사진이 있어요»로 이어서 쓸 수 있다.
              return sheet('사진을 불러오지 못했어요', '찍은 사진은 지워지지 않았어요. 앱을 다시 열면 이어서 쓸 수 있어요.', [{ label: '알겠어요', value: 'ok', primary: true }]).then(function () { return done({ kind: 'cancel', mode: r.mode || mode }); });
            });
          }
          return done({ kind: 'cancel', mode: r.mode || mode });
        });
      });
    }).catch(function () { return done({ kind: 'fallback', why: 'error' }); });
  }

  /* ───────── 앱이 정리됐다 돌아왔을 때 · 3일 청소 ───────── */
  // handlers: { doc(files), receipt(file), photo(file) } — app.js 가 «이어서 쓰기»를 어디로 이을지 정한다.
  var recovering = false;
  function recover(handlers) {
    var p = P();
    if (!usable() || !p || recovering || busy) return Promise.resolve(false);
    recovering = true;
    return Promise.resolve(p.pending()).then(function (r) {
      if (!r || !r.has || r.cameraOpen || !r.pages || !r.pages.length) return false;
      var n = r.pages.length, mode = r.mode === 'receipt' ? 'receipt' : (r.mode === 'photo' ? 'photo' : 'doc');
      var what = mode === 'photo' ? '찍어 둔 사진이 있어요' : '찍어 둔 ' + n + '쪽이 있어요';
      var body = mode === 'photo' ? '아직 어디에도 저장하거나 보내지 않은 사진이에요. 채팅에 붙일까요?' : '앱이 잠깐 닫히는 바람에 이어서 쓰지 못한 사진이에요. 이어서 쓸까요?';
      return sheet(what, body, [{ label: mode === 'photo' ? '채팅에 붙이기' : '이어서 쓰기', value: 'use', primary: true }, { label: '버리기', value: 'drop' }]).then(function (v) {
        if (v !== 'use') return Promise.resolve(p.discardAll()).then(function () { return true; });
        return readAll(r.pages).then(function (files) {
          var h = handlers || {};
          if (mode === 'doc' && h.doc) { h.doc(files); return true; }
          if (mode === 'receipt' && h.receipt) { h.receipt(files[0]); for (var i = 1; i < files.length; i++) release(files[i]); return true; }
          if (mode === 'photo' && h.photo) { h.photo(files[0]); return true; }
          return false;
        }, function () { return false; });
      });
    }).catch(function () { return false; }).then(function (x) { recovering = false; return x; });
  }
  function sweep() {
    var p = P();
    if (!usable() || !p) return Promise.resolve(0);
    return Promise.resolve(p.sweep()).then(function (r) { return (r && r.removed) || 0; }, function () { return 0; });
  }

  global.SilentCam = {
    config: function (c) { if (c) { if (c.on != null) CFG.on = !!c.on; if (c.engine) CFG.engine = c.engine; } },
    usable: usable, shoot: shoot, release: release, releasePath: releasePath, recover: recover, sweep: sweep,
    isBusy: function () { return busy; }
  };
})(window);

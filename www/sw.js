/* ============================================================================
 * sw.js — 최소 서비스워커 (PWA "설치" 요건 충족용)
 * ----------------------------------------------------------------------------
 * 목적: PC 크롬에서 이 웹앱을 "설치"(바탕화면 아이콘)할 수 있게 한다.
 *   크롬이 PWA를 설치 가능으로 판정하려면 (1) manifest.json (2) HTTPS
 *   (3) fetch 이벤트 핸들러가 있는 서비스워커 — 이 세 가지가 필요하다.
 *
 * ⚠️ 일부러 "공격적 캐시"를 하지 않는다.
 *   - 앱 껍데기를 캐시에 굳혀 두면 다음 배포/APK 업데이트 때 옛 화면이 남아
 *     "고쳤는데 안 바뀐다" 혼란이 난다(폰·PC 공용 소스라 더 위험).
 *   - 그래서 fetch 는 그냥 네트워크로 통과시킨다(항상 최신을 받음).
 *   - 오프라인 완전 지원(문서 캐시 등)은 필요해지면 그때 추가한다.
 * ==========================================================================*/
'use strict';

self.addEventListener('install', function () {
  self.skipWaiting();            // 새 SW 를 즉시 활성화(옛 SW 대기 없이 교체)
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());   // 열려 있는 탭들을 즉시 이 SW 가 제어
});

// fetch 핸들러는 "존재" 자체가 설치 요건. 캐시하지 않고 네트워크로 그대로 통과.
self.addEventListener('fetch', function (event) {
  event.respondWith(fetch(event.request).catch(function () {
    // 네트워크 실패(오프라인) 시 브라우저 기본 오류로 — 별도 오프라인 페이지는 두지 않는다.
    return new Response('', { status: 504, statusText: 'offline' });
  }));
});

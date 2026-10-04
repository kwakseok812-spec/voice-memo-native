package com.kwak.voicememo;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * v8.2(O-0157) FCM 수신 — Capacitor 푸시 플러그인의 MessagingService 를 이어받아(기존 동작 그대로) 한 가지를 더한다.
 *
 *  · super.onMessageReceived() → 지금까지처럼 웹(push.js)에 'pushNotificationReceived' 를 넘긴다(앱이 떠 있으면 답 당겨오기).
 *  · 서버가 「데이터 전용」 케이 답장(data.k_native=1)을 보낸 경우에만:
 *      - 바탕화면 위젯 갱신(알림 notice 는 제외 — 홈 말풍선과 같은 규칙)
 *      - 앱이 화면에 떠 있지 않으면 [답장] 버튼이 달린 알림을 직접 띄운다(KNotify).
 *  · 예전 모양(notification 푸시)은 손대지 않는다 → 서버가 아직 안 바뀌어도 지금과 똑같이 동작.
 *  · AndroidManifest 에서 플러그인 원래 서비스는 빼고(tools:node="remove") 이 서비스를 등록한다(FCM 수신 서비스는 하나만 동작).
 *
 * v9.1(O-0209) 「다른 기기에서 읽음」 조용한 푸시(data.k_clear=1 — k_native 는 붙지 않는다):
 *      - 화면에 아무것도 띄우지 않고, 읽은 것까지의 알림·위젯 수만 내린다(KClear). 앱이 떠 있으면 웹도 읽음 기준을 곧 받아 온다(push.js).
 *      - 옛 APK(v9.0 이하)는 k_clear 를 모른다 → k_native 가 아니므로 아래에서 그냥 돌아간다(알림 없음). 서버도 이 표시(rclr)가 없는 기기에는 보내지 않는다.
 *      - 케이 답장 푸시에 붙은 보낸 시각 표(data.ts)를 알림 줄·위젯에 함께 적어 둔다 → 나중에 「그 시각까지 읽음」과 견준다.
 */
public class KMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        try {
            if (remoteMessage.getNotification() != null) return;      // 예전 모양 → OS/플러그인이 처리(그대로)
            Map<String, String> d = remoteMessage.getData();
            if (d == null) return;
            if ("1".equals(d.get("k_clear"))) {                       // v9.1(O-0209) 다른 기기에서 읽음 → 읽은 것까지만 조용히 내림
                KClear.apply(getApplicationContext(), d, remoteMessage.getSentTime());
                return;
            }
            if (!"1".equals(d.get("k_native"))) return;                // 우리 형식이 아니면 손대지 않음
            String type = nz(d.get("type"));
            String title = nz(d.get("title"));
            String body = nz(d.get("body"));
            String thread = nz(d.get("thread"));
            String screen = d.get("screen");
            if (screen == null || screen.length() == 0) screen = "chat";
            boolean notice = "1".equals(d.get("notice")) || !"chat".equals(type);
            boolean replyable = "1".equals(d.get("reply")) && !notice;

            long sts = KClear.num(d.get("ts"));                       // v9.1(O-0209) 서버가 붙인 보낸 시각 표(없으면 0 = 예전 서버)
            // 늦게 도착한 푸시: 이미 다른 기기에서 읽은 것으로 확인된 답이면 알림·위젯 수를 올리지 않는다(표가 없으면 예전 그대로)
            if (KClear.alreadyRead(getApplicationContext(), sts)) return;

            if (!notice) KWidgetProvider.onIncoming(getApplicationContext(), title, body, sts);
            if (MainActivity.isInForeground()) return;               // 앱을 보고 계시면 앱 화면이 바로 보여 줌(알림 안 띄움)
            KNotify.showIncoming(getApplicationContext(), title.length() > 0 ? title : "케이 답장", body, thread, screen, replyable, sts);
        } catch (Throwable ignored) {
            // 수신 처리 실패가 앱을 죽이지 않게
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }
}

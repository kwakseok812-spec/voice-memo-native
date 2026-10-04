package com.kwak.voicememo;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.service.notification.StatusBarNotification;

import java.util.Map;

/**
 * v9.1(O-0209) 다른 기기(PC판)에서 채팅을 읽었을 때 — 폰 앱을 열지 않아도 알림 서랍·아이콘 숫자·바탕화면 위젯을 내린다.
 *
 *  ▶ 어떻게 아나: PC 워커(read_clear.py)가 서버의 읽음 기준(k_read_state)이 앞으로 간 것을 보고
 *     「조용한 푸시」(데이터 전용, data.k_clear=1 — 화면에 아무것도 띄우지 않는 푸시)를 보낸다. KMessagingService 가 받아 여기로 넘긴다.
 *  ▶ 무엇을 지우나(읽은 것만):
 *     ① 케이 답장 알림(KNotify, 우리가 만든 알림) 안의 줄 중 「보낸 시각 표(ts) ≤ pupto」인 것. 다 지워지면 알림 자체를 내린다.
 *     ② 안드로이드가 직접 띄운 알림 중 꼬리표(tag)가 「kc|chat|보낸시각」이고 그 시각 ≤ pupto 인 것
 *        (= 누르면 채팅이 열리는 사무소 알림: 브리핑·보고·매시간 확인 등 — 그 글이 채팅에 그대로 있어 PC에서 읽은 것).
 *     ③ 바탕화면 위젯의 안읽음 수(내려가기만 함).
 *     앱 아이콘의 숫자는 폰이 「남아 있는 알림 수」로 스스로 그리므로 ①②가 지워지면 함께 내려간다(따로 숫자를 쓰지 않는다).
 *  ▶ 지우지 않는 것: 꼬리표가 없는 알림(건강 기록 알림 → 건강 탭, 아이디어 알림, 서버가 바뀌기 전에 온 옛 알림),
 *     녹음 중 알림, 다운로드 알림, 그리고 pupto 보다 「뒤에」 보낸 모든 알림(아직 안 읽은 것).
 *  ▶ pupto 는 PC 워커가 서버 기록을 확인해 정한다: 읽음 기준 뒤에 온 글이 하나도 없으면 「확인한 그 순간」,
 *     있으면 「가장 이른 안 읽은 글 직전」. 알림마다 붙은 보낸 시각 표도 같은 PC 시계라 폰 시계와 무관하게 비교된다.
 *  ▶ 늦게 도착한 푸시: 이미 읽은 것으로 확인된(표 ≤ 마지막 pupto) 케이 답장 푸시가 뒤늦게 오면 알림·위젯 수를 올리지 않는다(alreadyRead).
 *     PC 시계가 앞서 있었을 때를 대비해 pupto 는 「이 조용한 푸시를 구글이 받은 시각 + 60초」를 넘지 못한다.
 *  본문·토큰은 로그에 남기지 않는다.
 */
final class KClear {

    static final String TAG_CHAT = "kc|chat|";          // 서버(push_sender.py)가 채팅 화면 알림에 붙이는 꼬리표 앞머리
    private static final String K_UPTO = "clr_pupto";    // 마지막으로 받은 pupto(ms, PC 시계)
    private static final long SENT_SLACK_MS = 60_000L;

    private KClear() {}

    static long num(String s) {
        try { return s == null ? 0L : Long.parseLong(s.trim()); } catch (Exception e) { return 0L; }
    }

    static long lastUpto(Context c) {
        try { return KBridgePlugin.prefs(c).getLong(K_UPTO, 0L); } catch (Exception e) { return 0L; }
    }

    /** 보낸 시각 표가 붙은 케이 답장 푸시가, 이미 다른 기기에서 읽은 범위 안의 것인가(늦게 도착한 푸시). 표가 없으면 false. */
    static boolean alreadyRead(Context c, long sts) {
        return sts > 0 && sts <= lastUpto(c);
    }

    /** 꼬리표 「kc|chat|보낸시각」 → 보낸시각(ms). 우리 꼬리표가 아니면 0. */
    static long tagStamp(String tag) {
        if (tag == null || !tag.startsWith(TAG_CHAT)) return 0L;
        return num(tag.substring(TAG_CHAT.length()));
    }

    /** 조용한 푸시(k_clear=1) 처리. sentTime = 구글이 이 푸시를 받은 시각(RemoteMessage.getSentTime). */
    static void apply(Context c, Map<String, String> d, long sentTime) {
        long pupto = num(d.get("pupto"));
        if (pupto <= 0) return;
        if (sentTime > 0 && pupto > sentTime + SENT_SLACK_MS) pupto = sentTime + SENT_SLACK_MS;   // PC 시계가 앞서 있어도 미래까지 지우지 않게
        long upto = num(d.get("upto"));                  // 읽음 기준(서버가 메시지에 매긴 시각, ms) — 위젯 계산용
        int left = -1;                                   // 읽음 기준 뒤에 남은 안읽음 수(서버 기준). 없으면 -1
        try { String l = d.get("left"); if (l != null) left = Integer.parseInt(l.trim()); } catch (Exception ignored) {}

        try {
            SharedPreferences sp = KBridgePlugin.prefs(c);
            if (pupto > sp.getLong(K_UPTO, 0L)) sp.edit().putLong(K_UPTO, pupto).apply();   // 앞으로만
        } catch (Exception ignored) {}

        try { KNotify.clearUpTo(c, pupto); } catch (Exception ignored) {}                    // ① 케이 답장 알림
        if (!"0".equals(d.get("notes"))) {                                                   // ② 채팅 화면 알림(서버가 끄면 notes=0)
            try { clearTagged(c, pupto); } catch (Exception ignored) {}
        }
        try { KWidgetProvider.onRemoteRead(c, upto, pupto, left); } catch (Exception ignored) {}   // ③ 위젯
    }

    /** 안드로이드가 직접 띄운 알림 중 「kc|chat|시각」 꼬리표가 붙고 시각 ≤ pupto 인 것만 내린다. 반환: 내린 수. */
    static int clearTagged(Context c, long pupto) {
        int n = 0;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return 0;
        StatusBarNotification[] act = nm.getActiveNotifications();
        if (act == null) return 0;
        for (StatusBarNotification sbn : act) {
            String tag = sbn.getTag();
            long ts = tagStamp(tag);
            if (ts > 0 && ts <= pupto) {
                try { nm.cancel(tag, sbn.getId()); n++; } catch (Exception ignored) {}
            }
        }
        return n;
    }
}

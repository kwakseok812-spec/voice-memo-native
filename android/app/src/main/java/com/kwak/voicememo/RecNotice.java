package com.kwak.voicememo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * v9.10(O-0449) 「녹음이 끊겼습니다」 알림 — 앱이 살아 있는 채로 녹음기가 멈춘 것을 알아챈 때 한 번.
 *
 *  - 같은 녹음에는 한 번만 띄운다(시작 시각으로 가린다).
 *  - 진동은 알림 통로(채널)의 진동으로 낸다 → 진동 권한을 새로 받지 않는다.
 *    폰이 무음 · 방해 금지면 폰 설정을 그대로 따른다(앱이 직접 진동기를 울리지 않는다). 소리는 내지 않는다.
 *  - 알림을 띄울 수 없으면(알림 꺼짐 등) false — 화면 쪽이 띠와 케이 한마디로 알린다(v9.8 그대로).
 *  - 앱이 통째로 죽은 순간에는 이 코드도 돌지 못한다. 그 경우는 앱을 다시 열 때 찾아서 알린다.
 */
final class RecNotice {

    private static final String CHANNEL_ID = "voice_memo_rec_lost";
    private static final int NOTIF_ID = 4322;
    private static volatile long noticedFor = 0;     // 이미 알린 녹음의 시작 시각

    private RecNotice() {}

    static boolean post(Context c, long startedAt) {
        try {
            if (startedAt > 0 && noticedFor == startedAt) return true;      // 같은 녹음 — 되풀이하지 않는다
            if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "녹음 끊김 알림", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("회의 녹음이 도중에 멈춘 것 같을 때 한 번 알립니다");
                ch.setSound(null, null);
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{ 0, 300, 150, 300 });
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(c, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.setAction("com.kwak.voicememo.action.OPEN_REC");
            open.putExtra("k_rec", "1");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi = PendingIntent.getActivity(c, NOTIF_ID, open, flags);
            Notification n = new NotificationCompat.Builder(c, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_mic)
                    .setContentTitle("녹음이 끊겼습니다")
                    .setContentText("눌러서 앱을 열고 확인해 주십시오.")
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_ERROR)
                    .setOnlyAlertOnce(true)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build();
            nm.notify(NOTIF_ID, n);
            noticedFor = startedAt;
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    /** 녹음을 정지했거나 새로 시작했다 — 떠 있는 끊김 알림을 거둔다. */
    static void clear(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Throwable ignored) {}
    }
}

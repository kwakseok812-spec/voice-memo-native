package com.kwak.voicememo;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * v8.2(O-0157) 케이 답장 알림 — 앱을 열지 않고 [답장].
 *
 *  · 서버가 「데이터 전용」 푸시(k_native=1)를 보낼 때만 이 알림을 우리가 직접 만든다(KMessagingService).
 *    예전 방식(notification 푸시)은 안드로이드가 직접 띄우므로 버튼을 붙일 수 없다 → 서버 쪽 바꿈 필요(보고서 참조).
 *  · 메신저 모양(MessagingStyle): 케이 말 + 내가 알림에서 보낸 말이 한 알림에 이어 붙는다(최근 6줄).
 *  · [답장] 은 잠금 해제 후에만(setAuthenticationRequired) — 폰을 주운 사람이 잠금화면에서 케이에게 일을 시킬 수 없게.
 *  · 잠금화면에는 내용 없이 「케이 답장이 왔어요」만(VISIBILITY_PRIVATE + 공개용 사본).
 *  · 본문·토큰은 로그에 남기지 않는다.
 */
final class KNotify {

    static final String CHANNEL_ID = "k_chat";
    static final int NOTIF_ID = 7101;
    static final String KEY_REPLY = "k_reply_text";
    private static final int MAX_HIST = 6;

    private KNotify() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "케이 답장", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("케이(소장)가 보낸 답장 — 알림에서 바로 답장할 수 있어요");
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    static boolean canPost(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    // ---------------- 알림 안의 짧은 대화 기록(앱 저장소, 최근 6줄) ----------------
    private static SharedPreferences sp(Context c) { return KBridgePlugin.prefs(c); }

    static synchronized void addHist(Context c, String who, String text) { addHist(c, who, text, 0L); }

    /** sts = 서버가 푸시에 붙인 보낸 시각 표(ms, 없으면 0). v9.1(O-0209): 「그 시각까지 읽음」과 견줄 때 쓴다. */
    static synchronized void addHist(Context c, String who, String text, long sts) {
        try {
            JSONArray a = new JSONArray(sp(c).getString("notif_hist", "[]"));
            JSONObject o = new JSONObject();
            o.put("w", who); o.put("t", clip(text, 400)); o.put("at", System.currentTimeMillis());
            if (sts > 0) o.put("s", sts);
            a.put(o);
            while (a.length() > MAX_HIST) a.remove(0);
            sp(c).edit().putString("notif_hist", a.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** 앱을 열면(대화를 본 것) 알림 속 기록을 비운다. */
    static synchronized void resetHist(Context c) {
        sp(c).edit().remove("notif_hist").apply();
    }

    private static String clip(String s, int n) {
        if (s == null) return "";
        return s.length() > n ? s.substring(0, n) + "…" : s;
    }

    /** 케이 답장(또는 알림)이 왔을 때. replyable=false 면 [답장] 버튼 없이. */
    static void showIncoming(Context c, String title, String body, String thread, String screen, boolean replyable, long sts) {
        if (body == null || body.length() == 0) body = "답장이 도착했어요.";
        addHist(c, "k", body, sts);
        sp(c).edit()
            .putString("n_title", title == null ? "" : title)
            .putString("n_thread", thread == null ? "" : thread)
            .putString("n_screen", screen == null ? "chat" : screen)
            .putBoolean("n_reply", replyable)
            .apply();
        post(c, null, false);
    }

    static void markSent(Context c, String myText) {
        addHist(c, "me", myText);
        post(c, "보냈어요 ✓ 케이가 확인하고 있어요", true);
    }

    static void markFailed(Context c, String myText, String why) {
        addHist(c, "me", myText + "  (못 보냄)");
        String msg;
        if (KChatSender.ERR_NOPASS.equals(why) || KChatSender.ERR_BADPASS.equals(why)) {
            msg = "못 보냈어요 — 앱을 열어 연동 암호를 확인해 주세요";   // O-0158: 알림 답장도 연동 암호가 있어야 보냄
        } else {
            msg = "못 보냈어요 — 인터넷을 확인하고 다시 [답장]을 눌러 주세요";
        }
        post(c, msg, true);
    }

    /** 빈 답장 등으로 입력 표시(빙글빙글)만 지울 때 — 소리 없이 다시 그린다. */
    static void refreshSilently(Context c) { post(c, null, true); }

    static void cancel(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {}
    }

    /* ---------------- v9.1(O-0209) 다른 기기에서 읽음 → 읽은 줄만 내리기 ----------------
     * 알림 속 케이 줄 중 보낸 시각 표(s)가 pupto 이하인 것 = 이미 PC판에서 읽은 것 → 뺀다.
     *  · 케이 줄이 하나도 안 남으면 알림을 내리고 기록도 비운다(앱을 열었을 때와 같은 정리).
     *  · 아직 안 읽은 케이 줄이 남으면 그 줄만 남겨 소리 없이 다시 그린다(알림이 지금 떠 있을 때만 — 손으로 밀어 지운 알림을 되살리지 않는다).
     *  · 표가 없는 줄(서버가 바뀌기 전에 온 것)은 건드리지 않는다. 반환: 뺀 케이 줄 수. */
    static synchronized int clearUpTo(Context c, long pupto) {
        if (pupto <= 0) return 0;
        try {
            SharedPreferences p = sp(c);
            JSONArray a = new JSONArray(p.getString("notif_hist", "[]"));
            if (a.length() == 0) return 0;
            JSONArray keep = new JSONArray();
            int removed = 0, kLeft = 0;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                boolean isK = "k".equals(o.optString("w"));
                long s = o.optLong("s", 0L);
                if (isK && s > 0 && s <= pupto) { removed++; continue; }
                if (isK) kLeft++;
                else if (kLeft == 0) continue;          // 남은 첫 케이 줄보다 앞선 「내 답장」은 지워진 줄에 딸린 것 → 함께 뺀다
                keep.put(o);
            }
            if (removed == 0) return 0;
            if (kLeft == 0) { cancel(c); resetHist(c); return removed; }
            p.edit().putString("notif_hist", keep.toString()).apply();
            if (isShowing(c)) post(c, null, true);
            return removed;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static boolean isShowing(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return false;
            StatusBarNotification[] act = nm.getActiveNotifications();
            if (act == null) return false;
            for (StatusBarNotification sbn : act) {
                if (sbn.getId() == NOTIF_ID && sbn.getTag() == null) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static void post(Context c, String status, boolean silent) {
        if (!canPost(c)) return;
        ensureChannel(c);
        SharedPreferences p = sp(c);
        String title = p.getString("n_title", "");
        String thread = p.getString("n_thread", "");
        String screen = p.getString("n_screen", "chat");
        boolean replyable = p.getBoolean("n_reply", true);

        IconCompat kIcon = IconCompat.createWithResource(c, R.drawable.k_face_round);
        Person me = new Person.Builder().setName("나").build();
        Person k = new Person.Builder().setName("케이").setIcon(kIcon).setKey("k").build();
        NotificationCompat.MessagingStyle st = new NotificationCompat.MessagingStyle(me);
        if (title != null && title.length() > 0 && !"케이 답장".equals(title)) st.setConversationTitle(title);
        String lastK = "";
        try {
            JSONArray a = new JSONArray(p.getString("notif_hist", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                boolean isK = "k".equals(o.optString("w"));
                if (isK) lastK = o.optString("t");
                st.addMessage(o.optString("t"), o.optLong("at"), isK ? k : null);
            }
        } catch (Exception ignored) {}

        Intent open = new Intent(c, MainActivity.class);
        open.setAction("com.kwak.voicememo.action.OPEN");
        open.putExtra("k_open", screen);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(c, NOTIF_ID, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // 잠금화면용 공개 사본: 내용 없이
        NotificationCompat.Builder pub = new NotificationCompat.Builder(c, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_k)
                .setContentTitle("케이")
                .setContentText("케이 답장이 왔어요");

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_k)
                .setColor(0xFF8B5CF6)
                .setContentTitle("케이")
                .setContentText(lastK)
                .setStyle(st)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(pub.build())
                .setContentIntent(contentPi)
                .setAutoCancel(true)
                .setOnlyAlertOnce(silent);
        try {
            Bitmap face = BitmapFactory.decodeResource(c.getResources(), R.drawable.k_face_round);
            if (face != null) b.setLargeIcon(face);
        } catch (Exception ignored) {}
        if (status != null) b.setSubText(status);

        if (replyable) {
            RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("케이에게 답장").build();
            Intent ri2 = new Intent(c, KReplyReceiver.class);
            ri2.setAction("com.kwak.voicememo.action.K_REPLY");
            ri2.putExtra("thread", thread);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent replyPi = PendingIntent.getBroadcast(c, NOTIF_ID + 1, ri2, fl);
            NotificationCompat.Action act = new NotificationCompat.Action.Builder(R.drawable.ic_ni_send, "답장", replyPi)
                    .addRemoteInput(ri)
                    .setAllowGeneratedReplies(false)              // 폰이 지어 주는 「네/감사합니다」 자동 답장 끔(실수 전송 방지)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .setAuthenticationRequired(true)              // 잠금 해제한 사람만 보낼 수 있게(Android 12+)
                    .build();
            b.addAction(act);
        }
        b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_k, "앱에서 보기", contentPi).build());

        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {}
    }
}

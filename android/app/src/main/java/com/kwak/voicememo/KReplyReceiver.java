package com.kwak.voicememo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

/**
 * v8.2(O-0157) 알림 [답장] 에서 입력한 글을 받는 곳(앱을 열지 않음).
 *  1) 글을 꺼낸다 → 2) 백그라운드에서 서버로 보낸다(KChatSender) → 3) 알림을 「보냈어요 ✓」(또는 「못 보냈어요」)로 바꾼다.
 *  보낸 기록은 앱 저장소 outbox 에 남겨, 앱을 열면 채팅 목록에 내 말풍선으로 들어가고 케이 답을 평소처럼 기다린다.
 *  exported=false(우리 앱 알림만 부를 수 있음). 본문은 로그에 남기지 않는다.
 */
public class KReplyReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(final Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence cs = results != null ? results.getCharSequence(KNotify.KEY_REPLY) : null;
        final String text = cs == null ? "" : cs.toString().trim();
        final String thread = intent.getStringExtra("thread");
        final Context app = context.getApplicationContext();
        if (text.length() == 0) { KNotify.refreshSilently(app); return; }   // 빈 답장 → 입력 표시만 지움

        final PendingResult pr = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject item = KChatSender.send(app, text, thread);
                    String why = item == null ? KChatSender.ERR_NET : item.optString("error", "");
                    if (why.length() == 0) {
                        KBridgePlugin.addOutbox(app, item);
                        KNotify.markSent(app, text);
                        KWidgetProvider.markReplied(app);
                        KBridgePlugin.emit("replySent", new JSObject());
                    } else {
                        try {
                            JSONObject failed = new JSONObject();
                            failed.put("failed", true);
                            failed.put("text", text);
                            failed.put("ts", System.currentTimeMillis());
                            failed.put("why", why);
                            KBridgePlugin.addOutbox(app, failed);
                        } catch (Exception ignored) {}
                        KNotify.markFailed(app, text, why);
                    }
                } finally {
                    pr.finish();
                }
            }
        }).start();
    }
}

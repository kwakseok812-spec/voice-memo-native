package com.kwak.voicememo;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;

/**
 * v8.2(O-0157·O-0158) 알림 [답장] 글을 「평소 채팅 메시지」로 보낸다.
 *
 * 앱(office-bridge.js _insertRow → submit_memo)과 같은 서버 경로·같은 모양:
 *   POST {url}/rest/v1/rpc/submit_memo  { p_row:{ id, title:'채팅', kind:'chat', note, client_token,
 *                                                 meta:{app:'voice-memo-test', thread, speak:false, from:'phone', via:'notif_reply'} },
 *                                          p_pass:<연동 암호> }
 *   → 서버가 연동 암호를 확인한 뒤에만 행을 만들고 「확인됨」 표시를 남긴다(O-0158). PC 케이는 앱에서 보낸 것과 똑같이 처리.
 * 연동 암호는 KSecret(Keystore 암호화)에서 꺼낸다. 없으면 보내지 않는다(전환기간용 공개 키 직접 등록 폴백도 하지 않음 —
 *   마지막 단계 뒤엔 그런 행이 처리되지 않아 「보냈어요」인데 답이 안 오는 일이 생기므로).
 * 본문·암호·토큰은 로그에 남기지 않는다.
 */
final class KChatSender {

    // office-bridge.js 의 CONFIG 와 같은 값(공개 키 — 저장소에도 이미 공개). 웹이 setContext 로 넘긴 값이 있으면 그걸 쓴다.
    private static final String DEF_URL = "https://nasizwclypmaojvwfxnn.supabase.co";
    private static final String DEF_KEY = "sb_publishable_H92J8-9eQB-bE4DQEUnHvw_jku33h7S";

    static final String ERR_NOPASS = "nopass", ERR_BADPASS = "badpass", ERR_NET = "net";

    private KChatSender() {}

    /** 성공: {id, token, text, ts}. 실패: {error: nopass|badpass|net}. 네트워크 — 백그라운드 스레드에서만. */
    static JSONObject send(Context c, String text, String threadHint) {
        SharedPreferences p = KBridgePlugin.prefs(c);
        String base = p.getString("url", DEF_URL);
        String key = p.getString("key", DEF_KEY);
        String thread = (threadHint != null && threadHint.length() > 0) ? threadHint : p.getString("thread", "");
        if (thread == null || thread.length() == 0) thread = "th_notifreply";
        String pass = KSecret.getPass(c);
        if (pass.length() == 0) return err(ERR_NOPASS);

        String id = UUID.randomUUID().toString();
        String token = randomHex(16);
        HttpURLConnection con = null;
        try {
            JSONObject meta = new JSONObject();
            meta.put("app", "voice-memo-test");
            meta.put("thread", thread);
            meta.put("speak", false);
            meta.put("from", "phone");
            meta.put("via", "notif_reply");
            JSONObject row = new JSONObject();
            row.put("id", id);
            row.put("title", "채팅");
            row.put("status", "pending");
            row.put("kind", "chat");
            row.put("note", text);
            row.put("client_token", token);
            row.put("meta", meta);
            JSONObject body = new JSONObject();
            body.put("p_row", row);
            body.put("p_pass", pass);

            con = (HttpURLConnection) new URL(base + "/rest/v1/rpc/submit_memo").openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(10000);
            con.setReadTimeout(15000);
            con.setDoOutput(true);
            con.setRequestProperty("apikey", key);
            con.setRequestProperty("Authorization", "Bearer " + key);
            con.setRequestProperty("Content-Type", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = con.getOutputStream();
            os.write(bytes);
            os.close();
            int code = con.getResponseCode();
            if (code >= 200 && code < 300) {          // "ok" 또는 "exists"(같은 id 재시도) — 둘 다 등록됨
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("token", token);
                item.put("text", text);
                item.put("ts", System.currentTimeMillis());
                return item;
            }
            String errBody = "";
            try {
                InputStream es = con.getErrorStream();
                if (es != null) {
                    byte[] buf = new byte[2048]; int n = es.read(buf); es.close();
                    if (n > 0) errBody = new String(buf, 0, n, StandardCharsets.UTF_8);
                }
            } catch (Exception ignored) {}
            if (code == 401 || code == 403 || errBody.contains("BAD_PASSCODE")) return err(ERR_BADPASS);
            return err(ERR_NET);
        } catch (Exception e) {
            return err(ERR_NET);
        } finally {
            if (con != null) try { con.disconnect(); } catch (Exception ignored) {}
        }
    }

    private static JSONObject err(String why) {
        JSONObject o = new JSONObject();
        try { o.put("error", why); } catch (Exception ignored) {}
        return o;
    }

    private static String randomHex(int nBytes) {
        byte[] b = new byte[nBytes];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }
}

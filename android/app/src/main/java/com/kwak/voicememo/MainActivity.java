package com.kwak.voicememo;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    // 공유/열기로 받은 문서를 뷰어로 넘길 수 있는 최대 크기(그 이상은 base64 주입이 무거워 안내만 한다)
    private static final long MAX_DOC_BYTES = 60L * 1024 * 1024; // 60MB

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 네이티브 녹음 플러그인 등록(포그라운드 서비스 기반 백그라운드 녹음)
        registerPlugin(NativeRecorderPlugin.class);
        super.onCreate(savedInstanceState);
        // 앱이 꺼진 상태에서 "열기/공유 → 스마트비서"로 시작된 경우
        handleIncomingDoc(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 앱이 이미 떠 있는 상태에서 문서가 넘어온 경우(launchMode=singleTask)
        handleIncomingDoc(intent);
    }

    // 다른 앱에서 넘어온 문서 인텐트(ACTION_VIEW / ACTION_SEND / ACTION_SEND_MULTIPLE)를 골라낸다.
    private void handleIncomingDoc(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        Uri uri = null;
        try {
            if (Intent.ACTION_VIEW.equals(action)) {
                uri = intent.getData();
            } else if (Intent.ACTION_SEND.equals(action)) {
                uri = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null && !list.isEmpty()) uri = list.get(0); // 뷰어는 한 번에 하나만 연다
            }
        } catch (Exception e) {
            return;
        }
        if (uri == null) return;
        deliverToWeb(uri);
    }

    // 백그라운드 스레드에서 content:// / file:// URI의 바이트를 읽어 base64로 웹에 주입한다.
    private void deliverToWeb(final Uri uri) {
        new Thread(new Runnable() {
            public void run() {
                String name = "document";
                try {
                    ContentResolver cr = getContentResolver();
                    name = queryName(cr, uri);
                    String mime = cr.getType(uri);
                    if (mime == null || mime.length() == 0) mime = "application/octet-stream";
                    InputStream is = cr.openInputStream(uri);
                    if (is == null) { postError("문서를 읽을 수 없어요.", name); return; }
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n; long total = 0;
                    while ((n = is.read(buf)) != -1) {
                        total += n;
                        if (total > MAX_DOC_BYTES) { try { is.close(); } catch (Exception ig) {} postError("파일이 너무 커서 이 방식으로는 열 수 없어요(60MB 초과).", name); return; }
                        bos.write(buf, 0, n);
                    }
                    try { is.close(); } catch (Exception ig) {}
                    String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                    postToWeb(name, mime, b64);
                } catch (Exception e) {
                    postError("문서를 여는 데 실패했어요.", name);
                }
            }
        }).start();
    }

    // content:// URI에서 사람이 읽는 파일명을 얻는다(없으면 마지막 경로 조각).
    private String queryName(ContentResolver cr, Uri uri) {
        String name = null;
        try {
            if ("content".equals(uri.getScheme())) {
                Cursor c = cr.query(uri, null, null, null, null);
                if (c != null) {
                    try {
                        int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (idx >= 0 && c.moveToFirst()) name = c.getString(idx);
                    } finally {
                        c.close();
                    }
                }
            }
        } catch (Exception e) {}
        if (name == null || name.length() == 0) {
            String p = uri.getLastPathSegment();
            name = (p != null && p.length() > 0) ? p : "document";
        }
        return name;
    }

    // 웹(app.js)의 window.__smartSharedDoc(name, mime, b64)로 넘긴다.
    // 콜드 스타트 시 웹 로드 전일 수 있어 함수가 준비될 때까지 재시도한다.
    private void postToWeb(final String name, final String mime, final String b64) {
        deliverWithRetry("window.__smartSharedDoc(" + jsStr(name) + "," + jsStr(mime) + "," + jsStr(b64) + ");", 0);
    }

    private void postError(final String msg, final String name) {
        deliverWithRetry("window.__smartSharedDocError(" + jsStr(msg) + "," + jsStr(name) + ");", 0);
    }

    private void deliverWithRetry(final String innerCall, final int attempt) {
        final WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
        if (wv == null) {
            if (attempt < 60) new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { public void run() { deliverWithRetry(innerCall, attempt + 1); } }, 400);
            return;
        }
        wv.post(new Runnable() {
            public void run() {
                // 웹의 훅(큐 스텁 포함)이 준비됐는지 확인하고, 준비됐을 때만 호출한다.
                String probe = "(function(){ if(typeof window.__smartSharedDoc==='function'){ try{" + innerCall + "}catch(e){} return 'ok'; } return 'wait'; })();";
                wv.evaluateJavascript(probe, new android.webkit.ValueCallback<String>() {
                    public void onReceiveValue(String value) {
                        boolean ok = value != null && value.indexOf("ok") >= 0;
                        if (!ok && attempt < 60) {
                            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() { public void run() { deliverWithRetry(innerCall, attempt + 1); } }, 400);
                        }
                    }
                });
            }
        });
    }

    // 자바 문자열을 JS 문자열 리터럴로 안전하게 변환(따옴표/역슬래시/개행 이스케이프).
    private String jsStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case ' ': sb.append("\\u2028"); break;
                case ' ': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }
}

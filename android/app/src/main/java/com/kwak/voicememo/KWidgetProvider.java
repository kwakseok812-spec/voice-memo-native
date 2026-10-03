package com.kwak.voicememo;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * v8.2(O-0157) 바탕화면 「케이」 위젯.
 *
 *  내용: 케이 얼굴 + 가장 최근 안읽은 소식 한 줄(홈 말풍선과 같은 규칙 — 자동 알림 notice 제외) + 안읽은 수.
 *  누르면: 케이 채팅(첫 안읽음 위치)으로.
 *
 *  ▶ 갱신 방식(배터리): 위젯이 스스로 주기적으로 깨어나지 않는다(updatePeriodMillis=0, 알람·작업 예약 없음).
 *     ① 앱이 화면에 떠 있는 동안 안읽음 수·말풍선이 바뀔 때(app.js → KBridge.updateWidget, 같은 값이면 안 보냄)
 *     ② 케이 답장 푸시가 올 때(KMessagingService — 서버가 데이터 전용 푸시를 보낼 때만, 이미 깨어난 김에)
 *     ③ 알림에서 [답장]을 보냈을 때(읽은 것으로 보고 수를 0으로)
 *     → 위젯 때문에 추가로 깨어나는 일이 0회. 시각은 「몇 분 전」 대신 「오후 3:12」처럼 고정 시각으로 써서 시간이 지나도 다시 그릴 필요가 없다.
 *  ▶ 개인정보: 잠금화면 위젯으로는 올릴 수 없게 home_screen 전용(widgetCategory). 앱 설정에서 「위젯에 내용 숨기기」를 켜면
 *     「새 소식 N건」만 보이고 글 내용은 안 보인다(hide).
 *
 *  크기: 반응형 레이아웃 3종 — 얼굴(작게)·한 줄(가로 4칸×1)·카드(4×2). 폴드 펼침 화면처럼 칸이 넓어지면 자동으로 더 큰 모양.
 *  위젯 목록에는 3개 항목(얼굴/한 줄/카드)으로 보이지만 그림 그리는 코드는 이 클래스 하나다(하위 클래스는 기본 크기만 다름).
 */
public class KWidgetProvider extends AppWidgetProvider {

    private static final String P = "w_";

    // ---------------- 상태 저장(앱 저장소) ----------------
    static void saveState(Context c, int count, String title, String line, long at, boolean hide) {
        KBridgePlugin.prefs(c).edit()
                .putInt(P + "count", Math.max(0, count))
                .putString(P + "title", title == null ? "" : title)
                .putString(P + "line", line == null ? "" : line)
                .putLong(P + "at", at)
                .putBoolean(P + "hide", hide)
                .apply();
    }

    /** 케이 답장 푸시 수신(앱 꺼져 있을 수 있음): 수 +1, 한 줄 = 미리보기. */
    static void onIncoming(Context c, String title, String body) {
        SharedPreferences sp = KBridgePlugin.prefs(c);
        int n = sp.getInt(P + "count", 0) + 1;
        String t = n > 1 ? "대표님, 새 메시지 " + (n > 99 ? "99+" : String.valueOf(n)) + "건이 와 있어요" : "대표님, 케이 답장이 왔어요";
        saveState(c, n, t, firstLine(body), System.currentTimeMillis(), sp.getBoolean(P + "hide", false));
        refreshAll(c);
    }

    /** 알림에서 답장을 보냈다 = 읽은 것. */
    static void markReplied(Context c) {
        SharedPreferences sp = KBridgePlugin.prefs(c);
        saveState(c, 0, "", "방금 케이에게 답장을 보냈어요", System.currentTimeMillis(), sp.getBoolean(P + "hide", false));
        refreshAll(c);
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        String[] lines = s.split("\n");
        for (String l : lines) {
            String t = l.replace("**", "").replaceAll("^\\s*(#{1,6}\\s+|[-*•·]\\s+|>\\s*)", "").replaceAll("\\s+", " ").trim();
            if (t.length() > 0) return t.length() > 80 ? t.substring(0, 80) + "…" : t;
        }
        return "";
    }

    static void refreshAll(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            Class<?>[] all = { KWidgetProvider.class, KWidgetFaceProvider.class, KWidgetCardProvider.class };
            for (Class<?> cls : all) {
                int[] ids = m.getAppWidgetIds(new ComponentName(c, cls));
                if (ids == null) continue;
                for (int id : ids) render(c, m, id);
            }
        } catch (Exception ignored) {}
    }

    // ---------------- 위젯 수명주기 ----------------
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(c, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle newOptions) {
        render(c, m, id);   // 크기를 바꾸거나 폴드를 펼쳐 칸이 달라지면 알맞은 모양으로
    }

    // ---------------- 그리기 ----------------
    static void render(Context c, AppWidgetManager m, int id) {
        RemoteViews rv;
        if (Build.VERSION.SDK_INT >= 31) {
            Map<SizeF, RemoteViews> map = new HashMap<>();
            map.put(new SizeF(40f, 40f), build(c, R.layout.widget_k_face));
            map.put(new SizeF(100f, 100f), build(c, R.layout.widget_k_face_lg));
            map.put(new SizeF(180f, 48f), build(c, R.layout.widget_k_line));
            map.put(new SizeF(180f, 110f), build(c, R.layout.widget_k_card));
            rv = new RemoteViews(map);
        } else {
            Bundle o = m.getAppWidgetOptions(id);
            int w = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250) : 250;
            int h = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 60) : 60;
            int layout = (w >= 180 && h >= 110) ? R.layout.widget_k_card
                    : (w >= 180 ? R.layout.widget_k_line
                    : (w >= 100 && h >= 100 ? R.layout.widget_k_face_lg : R.layout.widget_k_face));
            rv = build(c, layout);
        }
        try { m.updateAppWidget(id, rv); } catch (Exception ignored) {}
    }

    private static RemoteViews build(Context c, int layout) {
        SharedPreferences sp = KBridgePlugin.prefs(c);
        int n = sp.getInt(P + "count", 0);
        String title = sp.getString(P + "title", "");
        String line = sp.getString(P + "line", "");
        long at = sp.getLong(P + "at", 0L);
        boolean hide = sp.getBoolean(P + "hide", false);

        String head, sub;
        if (n > 0) {
            head = (title != null && title.length() > 0) ? title
                    : (n > 1 ? "대표님, 새 메시지 " + n + "건이 와 있어요" : "대표님, 새 소식이 있어요");
            sub = hide ? "내용은 앱에서 볼 수 있어요 · 눌러서 열기" : (line == null || line.length() == 0 ? "눌러서 확인하기" : line);
        } else {
            head = "케이";
            sub = (line != null && line.length() > 0 && !hide && at > 0 && System.currentTimeMillis() - at < 6 * 3600 * 1000L)
                    ? line : "새 소식 없어요 · 눌러서 케이와 대화";
        }

        if (layout == R.layout.widget_k_face) {
            head = n > 0 ? "새 소식 " + (n > 99 ? "99+" : String.valueOf(n)) : "케이";   // 작은 칸엔 짧게
        } else if (layout == R.layout.widget_k_face_lg) {
            head = n > 0 ? "새 소식 " + (n > 99 ? "99+" : String.valueOf(n)) + "건" : "케이";
        }
        RemoteViews rv = new RemoteViews(c.getPackageName(), layout);
        rv.setTextViewText(R.id.wk_title, head);
        rv.setTextViewText(R.id.wk_line, sub);
        if (n > 0) {
            rv.setViewVisibility(R.id.wk_badge, View.VISIBLE);
            rv.setTextViewText(R.id.wk_badge, n > 99 ? "99+" : String.valueOf(n));
        } else {
            rv.setViewVisibility(R.id.wk_badge, View.GONE);
        }
        if (layout == R.layout.widget_k_card) {
            rv.setTextViewText(R.id.wk_time, at > 0 && n > 0 ? fmtTime(at) : "");
        }
        rv.setContentDescription(R.id.wk_root, "케이 위젯 — " + head + (n > 0 && !hide ? ", " + sub : "") + ". 눌러서 대화 열기");

        Intent open = new Intent(c, MainActivity.class);
        open.setAction("com.kwak.voicememo.action.OPEN_WIDGET");
        open.putExtra("k_open", "chat");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 7201, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        rv.setOnClickPendingIntent(R.id.wk_root, pi);
        return rv;
    }

    private static String fmtTime(long at) {
        Calendar now = Calendar.getInstance(), t = Calendar.getInstance();
        t.setTimeInMillis(at);
        boolean sameDay = now.get(Calendar.YEAR) == t.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == t.get(Calendar.DAY_OF_YEAR);
        return new SimpleDateFormat(sameDay ? "a h:mm" : "M월 d일 a h:mm", Locale.KOREAN).format(new Date(at));
    }
}

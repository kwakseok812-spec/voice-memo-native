package com.kwak.voicememo;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 네이티브 채팅 입력 플러그인.
 *  - 목적: 안드로이드 WebView 의 textarea 한글(IME) 조합이 "한 글자씩 씹히고 마지막 글자가 늦게 보이는"
 *    고질 문제를 근본 회피한다. 웹 입력창을 탭하면 이 플러그인이 화면 하단에 "네이티브 입력 바"를 올려
 *    키보드를 붙인다 → 한글 조합이 OS(네이티브 텍스트 위젯) 수준에서 매끄럽게 이뤄진다.
 *  - JS(WebView)는 open() 으로 입력 바를 띄우고, "보내기/＋/카메라"를 누르면 이벤트로 알려
 *    기존 웹 로직(#chatSend/#chatAttach/#chatCam 클릭)을 그대로 실행한다 → 전송·첨부·동기화는 웹 그대로.
 *  - ⭐ 색은 하드코딩하지 않는다. JS 가 "현재 화면에 실제 적용된 색"(라이트/다크 어느 쪽이든)을 읽어
 *    open({colors:{...}}) 로 넘겨주고, 이 바는 그 색을 그대로 쓴다 → 평소 웹 입력 바와 톤이 일치한다.
 *  - 입력 바는 "보내기" 후에도 닫히지 않고(연속 대화) 텍스트만 비운다. 바깥(위쪽 대화)을 탭하거나
 *    뒤로가기를 누르면 닫히며, 안 보낸 초안은 'close' 이벤트로 웹 입력창에 되돌려 저장한다.
 */
@CapacitorPlugin(name = "NativeInput")
public class NativeInputPlugin extends Plugin {

    private Dialog dialog;
    private EditText edit;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics()));
    }

    /** JS 가 넘긴 색(#RRGGBB / #AARRGGBB)을 파싱. 없거나 잘못되면 fallback. */
    private int col(JSObject c, String key, int fallback) {
        try {
            if (c == null) return fallback;
            String v = c.getString(key, null);
            if (v == null || v.length() == 0) return fallback;
            return Color.parseColor(v.trim());
        } catch (Exception e) {
            return fallback;
        }
    }

    @PluginMethod
    public void open(final PluginCall call) {
        final String text = call.getString("text", "");
        final String hint = call.getString("hint", "메시지 입력");
        final JSObject colors = call.getObject("colors");
        final boolean hasAttach = call.getBoolean("hasAttach", false);
        final boolean hasCamera = call.getBoolean("hasCamera", false);
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    showBar(text == null ? "" : text, hint == null ? "메시지 입력" : hint,
                            colors, hasAttach, hasCamera);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("입력창을 여는 데 실패했어요: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void close(final PluginCall call) {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (dialog != null && dialog.isShowing()) dialog.dismiss();
                call.resolve();
            }
        });
    }

    /** 아이콘 버튼(＋·카메라) 만들기 — 웹 .iconbtn(둥근모서리·연한 배경·컬러 아이콘) 과 같은 모양. */
    private ImageView makeIconButton(int iconRes, int bg, int tint, View.OnClickListener onClick) {
        ImageView b = new ImageView(getContext());
        b.setImageResource(iconRes);
        b.setColorFilter(tint, PorterDuff.Mode.SRC_IN);
        b.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        b.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable bgD = new GradientDrawable();
        bgD.setColor(bg);
        bgD.setCornerRadius(dp(15));
        b.setBackground(bgD);
        b.setClickable(true);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(48), dp(48));
        b.setLayoutParams(lp);
        return b;
    }

    /** 입력 바(하단 도킹 다이얼로그)를 만들거나, 이미 떠 있으면 텍스트만 갱신한다. */
    private void showBar(String text, String hint, JSObject colors, boolean hasAttach, boolean hasCamera) {
        if (dialog != null && dialog.isShowing() && edit != null) {
            edit.setText(text);
            edit.setSelection(edit.getText().length());
            edit.setHint(hint);
            focusAndShowKeyboard();
            return;
        }

        // ── 색: JS 가 넘긴 "화면에 실제 적용된 색"을 그대로 사용(라이트/다크 자동 대응) ──
        //   fallback 은 라이트 톤(대표님 현재 화면 기준).
        int barBg      = col(colors, "bar",         Color.parseColor("#EDF0FC")); // 하단 바 배경(웹 --bg1)
        int fieldBg    = col(colors, "field",       Color.parseColor("#FFFFFF")); // 입력칸 배경(웹 .chatinput)
        int fieldBorder= col(colors, "fieldBorder", Color.parseColor("#29296366")); // 입력칸 테두리(웹 --glass-b)
        int fg         = col(colors, "text",        Color.parseColor("#0F172A")); // 글자(웹 --text)
        int hintCol    = col(colors, "hint",        Color.parseColor("#8A95AC")); // 안내문(웹 --dim)
        int iconBg     = col(colors, "iconBg",      Color.parseColor("#EBFFFFFF")); // ＋·카메라 배경(웹 .chatattach)
        int iconTint   = col(colors, "iconColor",   Color.parseColor("#2563EB")); // ＋·카메라 아이콘색(웹 --p1)
        int send1      = col(colors, "send1",       Color.parseColor("#2563EB")); // 전송 그라디언트 시작(웹 --p1)
        int send2      = col(colors, "send2",       Color.parseColor("#7C3AED")); // 전송 그라디언트 끝(웹 --p2)
        int hairline   = col(colors, "hairline",    Color.parseColor("#22636399")); // 위 대화와 구분하는 얇은 경계선

        // ── 바깥 컨테이너(가로 한 줄) — 웹 .chatbar 자리를 그대로 대체 ──
        final LinearLayout bar = new LinearLayout(getContext());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable barBgD = new GradientDrawable();
        barBgD.setColor(barBg);
        barBgD.setStroke(dp(1), hairline);
        bar.setBackground(barBgD);
        bar.setPadding(dp(8), dp(8), dp(8), dp(8));

        // ── ＋ 첨부 버튼(왼쪽) ──
        if (hasAttach) {
            ImageView plus = makeIconButton(R.drawable.ic_ni_plus, iconBg, iconTint, new View.OnClickListener() {
                @Override public void onClick(View v) { notifyListeners("attach", new JSObject()); }
            });
            ((LinearLayout.LayoutParams) plus.getLayoutParams()).rightMargin = dp(6);
            bar.addView(plus);
        }

        // ── 입력칸(EditText) ──
        edit = new EditText(getContext());
        GradientDrawable fieldBgD = new GradientDrawable();
        fieldBgD.setColor(fieldBg);
        fieldBgD.setCornerRadius(dp(18));            // 웹 .input radius 18px 와 일치
        fieldBgD.setStroke(dp(1), fieldBorder);
        edit.setBackground(fieldBgD);
        edit.setPadding(dp(16), dp(10), dp(16), dp(10));
        edit.setTextColor(fg);
        edit.setHintTextColor(hintCol);
        edit.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        edit.setHint(hint);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        edit.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        edit.setMaxLines(5);
        edit.setText(text);
        edit.setSelection(edit.getText().length());
        LinearLayout.LayoutParams eLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        eLp.rightMargin = dp(6);
        edit.setLayoutParams(eLp);
        edit.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, android.view.KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEND) { doSend(); return true; }
                return false;
            }
        });
        bar.addView(edit);

        // ── 카메라 버튼(입력칸 오른쪽) — 웹 배치와 동일. 공유함(locker)엔 없음 ──
        if (hasCamera) {
            ImageView cam = makeIconButton(R.drawable.ic_ni_camera, iconBg, iconTint, new View.OnClickListener() {
                @Override public void onClick(View v) { notifyListeners("camera", new JSObject()); }
            });
            ((LinearLayout.LayoutParams) cam.getLayoutParams()).rightMargin = dp(6);
            bar.addView(cam);
        }

        // ── 보내기 버튼(종이비행기 아이콘 + 웹과 같은 파랑→보라 그라디언트) ──
        ImageView send = new ImageView(getContext());
        send.setImageResource(R.drawable.ic_ni_send);
        send.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        send.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        send.setPadding(dp(12), dp(12), dp(12), dp(12));
        GradientDrawable sendBgD = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR, new int[]{ send1, send2 }); // 웹 linear-gradient(135deg,--p1,--p2)
        sendBgD.setCornerRadius(dp(15));             // 웹 .chatsend radius 15px 와 일치
        send.setBackground(sendBgD);
        send.setClickable(true);
        send.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { doSend(); }
        });
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(dp(48), dp(48));
        send.setLayoutParams(sLp);
        bar.addView(send);

        // 엣지투엣지(안드로이드 15+) 대비: 키보드가 없을 때 하단 제스처/네비게이션 바 위로 띄운다.
        applyBottomInset(bar);

        // ── 다이얼로그(하단 도킹) ──
        dialog = new Dialog(getActivity());
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        dialog.setContentView(bar);
        dialog.setCanceledOnTouchOutside(true);   // 위쪽 대화를 탭하면 닫힘(자연스러운 채팅 UX)
        dialog.setOnDismissListener(new android.content.DialogInterface.OnDismissListener() {
            @Override
            public void onDismiss(android.content.DialogInterface d) {
                JSObject o = new JSObject();
                o.put("text", edit != null ? edit.getText().toString() : "");
                notifyListeners("close", o);
            }
        });

        android.view.Window w = dialog.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.gravity = Gravity.BOTTOM;
            lp.width = WindowManager.LayoutParams.MATCH_PARENT;
            lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
            lp.dimAmount = 0.15f;   // 딤을 옅게 → '모달'이 아니라 '입력창이 활성화된' 느낌(뒤 대화 잘 보임)
            w.setAttributes(lp);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                    | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        }

        dialog.show();
        focusAndShowKeyboard();
    }

    /** 하단(네비게이션/제스처 바) 인셋만큼 아래 여백을 준다. 키보드가 뜨면 ADJUST_RESIZE 가 알아서 처리. */
    private void applyBottomInset(final LinearLayout bar) {
        try {
            bar.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    int bottom;
                    if (Build.VERSION.SDK_INT >= 30) {
                        bottom = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                    } else {
                        bottom = insets.getSystemWindowInsetBottom();
                    }
                    v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(), dp(8) + bottom);
                    return insets;
                }
            });
        } catch (Exception ignored) {}
    }

    private void focusAndShowKeyboard() {
        if (edit == null) return;
        edit.requestFocus();
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    InputMethodManager imm = (InputMethodManager) getContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
                    if (imm != null && edit != null) imm.showSoftInput(edit, InputMethodManager.SHOW_IMPLICIT);
                } catch (Exception ignored) {}
            }
        }, 120);
    }

    /** 현재 입력을 JS 로 넘긴다(빈 값은 무시). 입력 바는 열어둔 채 텍스트만 비워 연속 대화를 돕는다. */
    private void doSend() {
        if (edit == null) return;
        String t = edit.getText().toString();
        if (t.trim().length() == 0) return;
        JSObject o = new JSObject();
        o.put("text", t);
        notifyListeners("send", o);
        edit.setText("");
    }
}

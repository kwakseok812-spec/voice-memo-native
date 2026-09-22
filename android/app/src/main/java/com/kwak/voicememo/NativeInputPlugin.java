package com.kwak.voicememo;

import android.app.Dialog;
import android.graphics.Color;
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
 *    고질 문제를 근본 회피한다. 웹 입력창을 탭하면 이 플러그인이 화면 하단에 "네이티브 EditText 입력 바"를
 *    올려 키보드를 붙인다 → 한글 조합이 OS(네이티브 텍스트 위젯) 수준에서 매끄럽게 이뤄진다.
 *  - JS(WebView)는 open() 으로 입력 바를 띄우고, 사용자가 "보내기"를 누르면 'send' 이벤트로 텍스트만
 *    돌려받아 기존 웹 전송 로직(#chatSend/#lockerSend 클릭 = sendChatMsg/sendLockerMsg)에 그대로 넘긴다.
 *    → 채팅 화면·전송·멀티기기 동기화 등 나머지는 전부 기존 웹 그대로 유지된다.
 *  - 입력 바는 "보내기" 후에도 닫히지 않고(연속 대화) 텍스트만 비운다. 화면 바깥(위쪽 대화)을 탭하거나
 *    뒤로가기를 누르면 닫히며, 아직 안 보낸 초안은 'close' 이벤트로 웹 입력창에 되돌려 저장한다.
 *
 * 구현은 android.app.Dialog(하단 도킹, 창 소프트키보드 ADJUST_RESIZE)로, 키보드/인셋 처리를 안드로이드
 * 윈도우 매니저에 위임한다 → WebView 위에 네이티브 뷰를 픽셀 단위로 얹어 좌표·인셋을 직접 맞추는 방식보다
 * 기기 편차에 훨씬 안전하다(엣지투엣지·제스처바 대응 포함).
 */
@CapacitorPlugin(name = "NativeInput")
public class NativeInputPlugin extends Plugin {

    private Dialog dialog;
    private EditText edit;
    private TextView sendBtn;

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics()));
    }

    @PluginMethod
    public void open(final PluginCall call) {
        final String text = call.getString("text", "");
        final String hint = call.getString("hint", "메시지 입력");
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    showBar(text == null ? "" : text, hint == null ? "메시지 입력" : hint);
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

    /** 입력 바(하단 도킹 다이얼로그)를 만들거나, 이미 떠 있으면 텍스트만 갱신한다. */
    private void showBar(String text, String hint) {
        // 이미 떠 있으면 새로 만들지 않고 내용만 바꾼다(탭 중복 방지).
        if (dialog != null && dialog.isShowing() && edit != null) {
            edit.setText(text);
            edit.setSelection(edit.getText().length());
            edit.setHint(hint);
            focusAndShowKeyboard();
            return;
        }

        // ── 색상(앱 다크 테마와 결) ──
        int bgBar = Color.parseColor("#101534");   // 입력 바 배경(진한 남색)
        int bgField = Color.parseColor("#1B2145");  // 입력칸 배경
        int fg = Color.parseColor("#FFFFFF");       // 글자
        int hintCol = Color.parseColor("#7E88AD");  // 안내문
        int accent = Color.parseColor("#3B6EF6");   // 보내기 버튼

        // ── 바깥 컨테이너(가로 한 줄: [입력칸][보내기]) ──
        final LinearLayout bar = new LinearLayout(getContext());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(bgBar);
        bar.setPadding(dp(10), dp(8), dp(10), dp(8));

        // ── 입력칸(EditText) ──
        edit = new EditText(getContext());
        GradientDrawable fieldBg = new GradientDrawable();
        fieldBg.setColor(bgField);
        fieldBg.setCornerRadius(dp(20));
        edit.setBackground(fieldBg);
        edit.setPadding(dp(16), dp(10), dp(16), dp(10));
        edit.setTextColor(fg);
        edit.setHintTextColor(hintCol);
        edit.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        edit.setHint(hint);
        // 여러 줄 입력 + 한글 조합. 최대 5줄까지 늘어나고 그 뒤엔 내부 스크롤.
        edit.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        edit.setImeOptions(EditorInfo.IME_ACTION_SEND | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        edit.setMaxLines(5);
        edit.setText(text);
        edit.setSelection(edit.getText().length());
        LinearLayout.LayoutParams eLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        eLp.rightMargin = dp(8);
        edit.setLayoutParams(eLp);

        // 일부 IME 는 멀티라인이어도 액션(Send)을 노출한다 → 그 경우 전송 처리.
        edit.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, android.view.KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_SEND) { doSend(); return true; }
                return false;
            }
        });

        // ── 보내기 버튼 ──
        sendBtn = new TextView(getContext());
        sendBtn.setText("보내기");
        sendBtn.setTextColor(Color.WHITE);
        sendBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        sendBtn.setGravity(Gravity.CENTER);
        sendBtn.setPadding(dp(16), dp(10), dp(16), dp(10));
        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setColor(accent);
        btnBg.setCornerRadius(dp(20));
        sendBtn.setBackground(btnBg);
        sendBtn.setClickable(true);
        sendBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { doSend(); }
        });

        bar.addView(edit);
        bar.addView(sendBtn);

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
                // 안 보낸 초안을 웹 입력창으로 되돌려 저장.
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
            lp.dimAmount = 0.35f;   // 뒤 대화가 살짝 비치게(완전 가리지 않음)
            w.setAttributes(lp);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            // ADJUST_RESIZE + 하단정렬 → 창이 키보드 위로 줄어들며 입력 바가 키보드 바로 위에 붙는다.
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
        edit.setText("");   // 보낸 뒤 비움(다이얼로그·키보드는 유지)
    }
}

package com.kwak.voicememo;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

/**
 * PDF 글자 인식(OCR) 플러그인 (v10.9 6회차, 2026-11-15, 지시대장 O-0861).
 *  - 무엇: 웹이 보내 준 쪽 그림(JPEG/PNG, base64) 한 장을 «폰 안에서» 글자로 읽어 줄 단위 글과 자리를 돌려준다.
 *  - 모형: ML Kit 「한국어 글자 인식」 번들 모형(com.google.mlkit:text-recognition-korean) — 모형이 앱 안에 들어 있어
 *    문서가 기기 밖으로 나가지 않는다(인터넷 요청 없음). 한국어 모형은 영문·숫자·기호도 함께 읽는다.
 *  - 권한: 새 권한 없음(알림 접근·접근성·문자 권한도 없음).
 *  - JS: Capacitor.Plugins.TextOcr
 *      status()                  → {available:true, engine:'mlkit-korean'}
 *      recognize({image:base64}) → {width, height, lines:[{t, x, y, w, h, a}]}   (픽셀, 왼쪽 위 기준. a = 기울기(도), 없으면 0)
 */
@CapacitorPlugin(name = "TextOcr")
public class TextOcrPlugin extends Plugin {

    private TextRecognizer recognizer;

    private synchronized TextRecognizer rec() {
        if (recognizer == null) recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        return recognizer;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("engine", "mlkit-korean");
        call.resolve(r);
    }

    @PluginMethod
    public void recognize(final PluginCall call) {
        String b64 = call.getString("image");
        if (b64 == null || b64.isEmpty()) { call.reject("그림이 비어 있습니다"); return; }
        final Bitmap bmp;
        try {
            int comma = b64.indexOf(',');
            if (b64.startsWith("data:") && comma > 0) b64 = b64.substring(comma + 1);
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
        } catch (Throwable e) { call.reject("그림을 읽지 못했습니다"); return; }
        if (bmp == null) { call.reject("그림을 읽지 못했습니다"); return; }
        final int w = bmp.getWidth(), h = bmp.getHeight();
        try {
            rec().process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener(new com.google.android.gms.tasks.OnSuccessListener<Text>() {
                    @Override public void onSuccess(Text t) {
                        try {
                            JSArray lines = new JSArray();
                            for (Text.TextBlock b : t.getTextBlocks()) {
                                for (Text.Line ln : b.getLines()) {
                                    Rect r = ln.getBoundingBox();
                                    String s = ln.getText();
                                    if (r == null || s == null || s.trim().isEmpty()) continue;
                                    JSObject o = new JSObject();
                                    o.put("t", s);
                                    o.put("x", r.left); o.put("y", r.top); o.put("w", r.width()); o.put("h", r.height());
                                    o.put("a", (double) ln.getAngle());
                                    lines.put(o);
                                }
                            }
                            JSObject res = new JSObject();
                            res.put("width", w); res.put("height", h); res.put("lines", lines);
                            bmp.recycle();
                            call.resolve(res);
                        } catch (Throwable e) { bmp.recycle(); call.reject("인식 결과를 정리하지 못했습니다"); }
                    }
                })
                .addOnFailureListener(new com.google.android.gms.tasks.OnFailureListener() {
                    @Override public void onFailure(Exception e) { bmp.recycle(); call.reject("글자 인식에 실패했습니다"); }
                });
        } catch (Throwable e) { bmp.recycle(); call.reject("글자 인식을 시작하지 못했습니다"); }
    }

    @Override
    protected void handleOnDestroy() {
        try { if (recognizer != null) recognizer.close(); } catch (Throwable e) { }
        super.handleOnDestroy();
    }
}

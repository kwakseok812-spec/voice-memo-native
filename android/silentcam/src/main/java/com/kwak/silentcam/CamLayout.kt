package com.kwak.silentcam

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 카메라 화면 «크게 보기 / 단추만 작게 / 예전 화면 그대로» 의 치수와 규칙(설계안 v2, v9.74).
 * 안드로이드 부품을 하나도 쓰지 않는 순수 계산이라 폰 없이 JVM 단위 시험으로 확인한다(CamLayoutTest).
 * 화면(SilentCameraActivity)은 여기 있는 숫자와 규칙을 그대로 가져다 쓴다 — 시안(camera_layout_mockup_v2.html)과 같은 값이다.
 */
object CamLayout {
    const val CLASSIC = "classic"      // 예전 화면 그대로(v9.72 와 똑같이)
    const val SMALL = "small"          // 단추만 작게(비추는 범위는 그대로)
    const val BIG = "big"              // 크게 보기(영수증·일반 사진만 길쭉하게, 문서는 그대로)

    /** 저장된 값이 이상하면 처음 설정(크게 보기)으로. */
    fun normalize(v: String?): String = when (v) {
        CLASSIC -> CLASSIC
        SMALL -> SMALL
        else -> BIG
    }

    // ───────── 치수(dp) ─────────
    const val TOUCH_DP = 48            // 모든 단추의 누르는 칸 최소
    const val BAR_DP = 48              // 윗줄(✕ · 모드 알약 · ⚡ · ⚙)
    const val SEG_VISIBLE_DP = 34      // 모드 알약 덩어리의 보이는 높이
    const val CHIP_ROW_DP = 34         // 이어 찍기 줄이 실제로 차지하는 높이(누르는 칸 48 은 위아래로 겹쳐 둠)
    const val NOTICE_DP = 30           // 알림 띠(일반 사진 안내 · 100쪽 도달 · 저장 공간) — 사라지지 않음
    const val BOTTOM_BAR_DP = 82       // 촬영 줄(셔터 72 + 위아래 5)
    const val STRIP_DP = 72            // 썸네일 줄(그대로)
    const val ZOOM_ROW_DP = 48         // 확대 알약 줄(누르는 칸)
    const val ZOOM_PILL_DP = 32        // 확대 알약의 보이는 높이
    const val ZOOM_PILL_W_DP = 48      // 확대 알약의 누르는 칸 가로(세로 48 과 같게)
    const val ZOOM_LABEL_DP = 58       // 「×1.0 ▾」 칸의 가로
    const val ZOOM_SIDE_DP = 8         // 확대 줄 좌우 여유 합계
    const val SEEK_DP = 32             // 펴지는 확대 막대
    const val HINT_DP = 30             // 안내 알약
    const val HINT_FADE_MS = 6000L     // 안내 알약이 사라지기까지
    const val SEEK_HIDE_MS = 4000L     // 확대 막대가 저절로 접히기까지

    /**
     * 확대 알약 한 개의 가로(dp): 6개(0.5·1·2·3·5·10)와 「×1.0 ▾」 칸이 한 줄에 들어가도록 한다.
     * 화면 폭 360dp 에서도 48(= 58 + 2 + 6×48 = 348 ≤ 352)이라 그대로 들어가고, 더 좁은 화면에서만 48 밑으로 줄어든다.
     */
    fun zoomPillWidthDp(screenWidthDp: Int, count: Int): Int {
        if (count <= 0) return ZOOM_PILL_W_DP
        val fit = (screenWidthDp - ZOOM_SIDE_DP - ZOOM_LABEL_DP - 2) / count
        return min(ZOOM_PILL_W_DP, fit)
    }

    /** 위 묶음 높이(상태바 제외). tab = 홈에서 열림(모드 알약 있음), doc = 문서 모드, notice = 알림 띠가 떠 있음. */
    fun topDp(tab: Boolean, doc: Boolean, notice: Boolean): Int =
        BAR_DP + (if (tab && doc) CHIP_ROW_DP else 0) + (if (notice) NOTICE_DP else 0)

    /** 아래 묶음 높이(제스처 띠 제외). strip = 썸네일 줄이 보임(문서 이어 찍기 1쪽 이상). */
    fun bottomDp(strip: Boolean): Int = BOTTOM_BAR_DP + (if (strip) STRIP_DP else 0)

    // ───────── 미리보기·사진 비율 ─────────
    const val BASE_ASPECT = 3f / 4f    // 센서 그대로(지금 비율). 세로로 든 기준의 폭÷높이
    const val LONG_ASPECT = 9f / 16f   // 길쭉한 비율
    const val TALL_RATIO = 1.8f        // 화면 긴 변÷짧은 변이 이 값 이상이면 «긴 화면»

    /**
     * 지금 화면 모양·모드·화면 크기에서 원하는 비율(세로 기준 폭÷높이).
     * 길쭉한 비율은 «크게 보기» + 영수증·일반 사진 + 긴 화면일 때만. 문서는 언제나 지금 비율(시야 그대로).
     */
    fun aspect(variant: String, mode: String, longSide: Float, shortSide: Float): Float {
        if (variant != BIG || mode == "doc" || shortSide <= 0f) return BASE_ASPECT
        return if (longSide / shortSide >= TALL_RATIO) LONG_ASPECT else BASE_ASPECT
    }

    /** 기기가 알려 준 실제 크기(짧은 변÷긴 변)가 원하는 비율과 같으면 true. 아직 모르면(null) 맞다고 본다. */
    fun agrees(wanted: Float, shortOverLong: Float?): Boolean = shortOverLong == null || abs(shortOverLong - wanted) < 0.02f

    /** 크기 → 짧은 변÷긴 변. 크기를 모르면 null. */
    fun shortOverLong(w: Int, h: Int): Float? = if (w <= 0 || h <= 0) null else min(w, h).toFloat() / max(w, h).toFloat()

    /**
     * 후퇴 규칙: 길쭉한 비율을 원했는데 미리보기나 사진 중 하나라도 그 비율이 아니면 지금 비율로 물러난다
     * (보이는 범위와 찍히는 범위가 다른 채로 두지 않는다). 지금 비율을 원했던 경우는 물러날 곳이 없다.
     */
    fun mustRetreat(wanted: Float, previewShortOverLong: Float?, captureShortOverLong: Float?): Boolean =
        wanted < BASE_ASPECT - 0.01f && !(agrees(wanted, previewShortOverLong) && agrees(wanted, captureShortOverLong))

    const val V_OK = 0          // 보이는 범위 = 찍히는 범위가 확인됨(또는 원래 지금 비율)
    const val V_RETREAT = 1     // 지금 비율로 물러나야 함
    const val V_WAIT = 2        // 아직 기기가 크기를 안 알려 줌 — 잠시 뒤 다시 확인

    /**
     * 길쭉한 비율을 연결한 뒤의 판정. 하나라도 다른 비율로 알려 오면 후퇴. 둘 다 알려 와 같으면 OK.
     * 아직 모르면(null) 맞다고 단정하지 않고 기다리며(WAIT), 마지막 확인(lastTry)에서도 모르면 안전하게 지금 비율로 후퇴한다.
     */
    fun verdict(wanted: Float, previewShortOverLong: Float?, captureShortOverLong: Float?, lastTry: Boolean): Int {
        if (wanted >= BASE_ASPECT - 0.01f) return V_OK
        val pBad = previewShortOverLong != null && !agrees(wanted, previewShortOverLong)
        val cBad = captureShortOverLong != null && !agrees(wanted, captureShortOverLong)
        if (pBad || cBad) return V_RETREAT
        if (previewShortOverLong != null && captureShortOverLong != null) return V_OK
        return if (lastTry) V_RETREAT else V_WAIT
    }

    // ───────── 미리보기 칸 · 안내선 ─────────
    class Box(val x: Float, val y: Float, val w: Float, val h: Float)

    /** 화면(w×h)에 비율 asp(세로 기준 폭÷높이)의 그림을 가운데 맞춤(FIT_CENTER)으로 놓은 칸. 가로로 돌린 화면이면 비율을 뒤집는다. */
    fun fit(w: Float, h: Float, asp: Float): Box {
        val a = if (w > h) 1f / asp else asp
        val pw: Float
        val ph: Float
        if (w / h < a) { pw = w; ph = w / a } else { ph = h; pw = h * a }
        return Box((w - pw) / 2f, (h - ph) / 2f, pw, ph)
    }

    /**
     * 문서 안내선(점선 사각형): 미리보기 칸 안쪽 6%·위아래 4% 안에서 위 단추 줄과 아래 단추 줄(확대 줄 포함)을 피한다.
     * 남는 높이가 미리보기의 25%도 안 되면 null(화면이 너무 낮을 때는 예전 규칙으로).
     */
    fun guide(pv: Box, topEdge: Float, bottomEdge: Float, gap: Float): Box? {
        val t = max(pv.y + pv.h * 0.04f, topEdge + gap)
        val b = min(pv.y + pv.h * 0.96f, bottomEdge - gap)
        if (b - t <= pv.h * 0.25f) return null
        return Box(pv.x + pv.w * 0.06f, t, pv.w * 0.88f, b - t)
    }
}

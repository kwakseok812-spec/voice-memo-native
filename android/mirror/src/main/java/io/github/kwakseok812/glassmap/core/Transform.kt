package io.github.kwakseok812.glassmap.core

import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Turns the chosen part of the phone screen into what the one-colour lens can show:
 * one byte per pixel, 0 = black (= see-through on the lens), 255 = brightest.
 *
 * Two views, nothing else:
 *   MODE_PLAIN (default) : as on the phone. Nothing is picked out, nothing inverted;
 *                          colours become brightness, with a contrast correction so
 *                          that neighbouring shades stay apart.
 *   MODE_DARK            : dark background. A light screen is inverted and the contrast
 *                          raised, so that only letters and lines light up.
 */
object Transform {
    const val MODE_DARK = 4
    const val MODE_PLAIN = 5

    /** The views in the order a key press on the glasses walks through them. First = default. */
    val VIEWS: IntArray = intArrayOf(MODE_PLAIN, MODE_DARK)

    fun nextView(mode: Int): Int = if (mode == MODE_PLAIN) MODE_DARK else MODE_PLAIN

    /** Anything that is not the dark view counts as the default view (values kept by older versions). */
    fun normalize(mode: Int): Int = if (mode == MODE_DARK) MODE_DARK else MODE_PLAIN

    class Result(
        val gray: ByteArray,
        /** true = the picture was judged to be a light screen (the dark view inverted it) */
        val light: Boolean
    )

    /**
     * Brightness stretch between two percentiles (optionally inverted first), gamma, then
     * reduced to a few levels (fewer levels = much smaller pictures to send).
     *
     * equalize (0..1) mixes in "how much of the picture is darker than this shade". Large
     * flat areas of nearly the same shade (on a light map: ground, roofs and roads differ
     * by only a few steps of 255) are pulled apart by it, which is what keeps them
     * distinguishable on a one-colour lens. It is weighted by the brightness itself, so it
     * never lifts dark parts: a mostly black screen stays black instead of glowing.
     *
     * maxBlack / minWhite keep the stretch honest on screens that are nearly one shade
     * (an almost empty white page, an almost black screen): black is never placed above
     * maxBlack and white never below minWhite, so such a page keeps its real brightness.
     */
    private fun stretch(
        lum: ByteArray, n: Int, invert: Boolean,
        loPct: Double, hiPct: Double, gamma: Double, levelCount: Int, dim: Double, equalize: Double,
        maxBlack: Int = 255, minWhite: Int = 0
    ): ByteArray {
        val hist = IntArray(256)
        for (i in 0 until n) {
            val l = lum[i].toInt() and 255
            hist[if (invert) 255 - l else l]++
        }
        fun pct(p: Double): Int {
            val target = (n * p / 100.0)
            var acc = 0L
            for (v in 0..255) {
                acc += hist[v]
                if (acc >= target) return v
            }
            return 255
        }
        var a = pct(loPct)
        var b = pct(hiPct)
        if (a > maxBlack) a = maxBlack
        if (b < minWhite) b = minWhite
        if (b <= a) b = a + 1
        val levels = levelCount.coerceAtLeast(2)
        val lut = ByteArray(256)
        var below = 0L
        for (v in 0..255) {
            var t = (v - a).toDouble() / (b - a).toDouble()
            if (t < 0.0) t = 0.0
            if (t > 1.0) t = 1.0
            t = t.pow(gamma)
            below += hist[v]
            if (equalize > 0.0) t += equalize * (below.toDouble() / n - t) * t
            val q = (t * (levels - 1)).roundToInt().toDouble() / (levels - 1)
            lut[v] = (q * dim * 255.0).roundToInt().coerceIn(0, 255).toByte()
        }
        val out = ByteArray(n)
        for (i in 0 until n) {
            val l = lum[i].toInt() and 255
            out[i] = lut[if (invert) 255 - l else l]
        }
        return out
    }

    /**
     * @param rgb 0xAARRGGBB pixels, w x h (already cut to the chosen area and scaled)
     */
    fun render(rgb: IntArray, w: Int, h: Int, mode: Int, cfg: ViewConfig): Result {
        val n = w * h
        val lum = ByteArray(n)
        var sum = 0L
        for (i in 0 until n) {
            val p = rgb[i]
            val l = (((p shr 16) and 255) * 77 + ((p shr 8) and 255) * 150 + (p and 255) * 29) shr 8
            lum[i] = l.toByte()
            sum += l
        }
        val light = when (cfg.theme) {
            "light" -> true
            "dark" -> false
            else -> n > 0 && (sum / n) >= cfg.autoLightThreshold
        }
        val out = if (mode == MODE_DARK) {
            stretch(lum, n, light, cfg.darkLoPct, cfg.darkHiPct, cfg.darkGamma, cfg.darkLevels, 1.0, 0.0)
        } else {
            stretch(
                lum, n, false, cfg.plainLoPct, cfg.plainHiPct, cfg.plainGamma, cfg.plainLevels, cfg.plainDim, cfg.plainEqualize,
                cfg.plainMaxBlack, cfg.plainMinWhite
            )
        }
        return Result(out, light)
    }
}

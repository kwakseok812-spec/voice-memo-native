package io.github.kwakseok812.glassmap.core

/**
 * Builds the one 480 x 640 picture that goes to the glasses from the chosen part of the
 * phone screen.
 *
 *   FIT_CONTAIN ("show all") : the area keeps its shape, is made as large as fits, and the
 *                              rest stays black (= see-through on the lens). Nothing is cut.
 *   FIT_COVER   ("fill")     : the lens is filled completely. An area whose shape differs
 *                              from the lens is trimmed equally on both sides - never stretched.
 */
object FrameBuilder {
    const val FIT_COVER = 0
    const val FIT_CONTAIN = 1

    class Built(
        val gray: ByteArray,
        /** the picture was judged to be a light screen */
        val light: Boolean,
        /** size of the drawn area inside the 480 x 640 picture, and where it sits */
        val drawnW: Int,
        val drawnH: Int,
        val drawnX: Int,
        val drawnY: Int
    )

    /** Size of a sw x sh picture made as large as fits into bw x bh, shape kept. */
    fun containSize(sw: Int, sh: Int, bw: Int, bh: Int): IntArray {
        // compare sw/sh with bw/bh without floating point
        return if (sw.toLong() * bh >= sh.toLong() * bw) {
            val h = ((sh.toLong() * bw + sw / 2) / sw).toInt().coerceIn(1, bh)
            intArrayOf(bw, h)
        } else {
            val w = ((sw.toLong() * bh + sh / 2) / sh).toInt().coerceIn(1, bw)
            intArrayOf(w, bh)
        }
    }

    /** Largest centred part of a sw x sh picture that has the shape aw : ah. Returns x, y, w, h. */
    fun coverCrop(sw: Int, sh: Int, aw: Int, ah: Int): IntArray {
        return if (sw.toLong() * ah > sh.toLong() * aw) {
            val w = (sh.toLong() * aw / ah).toInt().coerceIn(1, sw)
            intArrayOf((sw - w) / 2, 0, w, sh)
        } else {
            val h = (sw.toLong() * ah / aw).toInt().coerceIn(1, sh)
            intArrayOf(0, (sh - h) / 2, sw, h)
        }
    }

    /**
     * @param px pixels of the chosen screen area (any size, any shape), 0xAARRGGBB
     */
    fun build(px: IntArray, pw: Int, ph: Int, mode: Int, cfg: ViewConfig, fit: Int): Built {
        var src = px
        var sw = pw
        var sh = ph
        val dw: Int
        val dh: Int
        if (fit == FIT_CONTAIN) {
            val s = containSize(sw, sh, Layout.W, Layout.H)
            dw = s[0]
            dh = s[1]
        } else {
            // same shape (within one pixel of rounding)? then use the area as it is
            val c = coverCrop(sw, sh, Layout.W, Layout.H)
            if (sw - c[2] > 1 || sh - c[3] > 1) {
                src = Scaler.crop(src, sw, c)
                sw = c[2]
                sh = c[3]
            }
            dw = Layout.W
            dh = Layout.H
        }
        val rgb = IntArray(dw * dh)
        Scaler.scale(src, sw, sh, rgb, dw, dh)
        // Converted at its own size, then placed: the black border never takes part in the
        // conversion (an inverted light screen must not get a bright frame around it).
        val res = Transform.render(rgb, dw, dh, mode, cfg)

        val gray = ByteArray(Layout.W * Layout.H)
        val x0 = (Layout.W - dw) / 2
        val y0 = (Layout.H - dh) / 2
        for (y in 0 until dh) {
            System.arraycopy(res.gray, y * dw, gray, (y0 + y) * Layout.W + x0, dw)
        }
        return Built(gray, res.light, dw, dh, x0, y0)
    }

    /** Convenience for whole screenshots (PC tool, tests). */
    fun buildFromScreen(screen: IntArray, sw: Int, sh: Int, area: IntArray, mode: Int, cfg: ViewConfig, fit: Int): Built {
        val c = Scaler.clampCrop(area, sw, sh)
        return build(Scaler.crop(screen, sw, c), c[2], c[3], mode, cfg, fit)
    }
}

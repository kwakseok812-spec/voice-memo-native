package io.github.kwakseok812.glassmap.phone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Small helpers so the screens can be built in code with one look.
 * Colours follow the dark look of the assistant app this screen now lives in
 * (page #070B1D, light text, blue accent). Sizes and layout are those of the stand-alone app.
 */
object Ui {
    const val BG = 0xFF070B1D.toInt()
    const val ACCENT = 0xFF3B82F6.toInt()
    /** accent as text on the dark page (lighter, easier to read) */
    const val ACCENT_TEXT = 0xFF8AB4FF.toInt()
    const val ACCENT_SOFT = 0xFF16264D.toInt()
    const val TEXT = 0xFFF3F6FF.toInt()
    const val SUB = 0xFFA7B3D1.toInt()
    const val LINE = 0xFF2A3150.toInt()
    const val FILL = 0xFF121833.toInt()
    const val CARD = 0xFF0F1530.toInt()
    const val WARN = 0xFFFBBF24.toInt()

    fun dp(c: Context, v: Int): Int = (v * c.resources.displayMetrics.density + 0.5f).toInt()

    fun text(c: Context, s: String, sizeSp: Float = 15f, color: Int = TEXT, bold: Boolean = false): TextView {
        val t = TextView(c)
        t.text = s
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        t.setTextColor(color)
        if (bold) t.typeface = Typeface.DEFAULT_BOLD
        t.setLineSpacing(0f, 1.15f)
        return t
    }

    private fun round(c: Context, fill: Int, stroke: Int): GradientDrawable {
        val g = GradientDrawable()
        g.cornerRadius = dp(c, 10).toFloat()
        g.setColor(fill)
        if (stroke != 0) g.setStroke(dp(c, 1), stroke)
        return g
    }

    /** Big filled button (main action). */
    fun primary(c: Context, s: String): Button {
        val b = Button(c)
        b.text = s
        b.isAllCaps = false
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        b.typeface = Typeface.DEFAULT_BOLD
        b.setTextColor(Color.WHITE)
        b.background = round(c, ACCENT, 0)
        b.stateListAnimator = null
        b.minHeight = dp(c, 52)
        b.minimumHeight = dp(c, 52)
        return b
    }

    /** Outlined button (secondary action). selected = filled with the soft accent. */
    fun secondary(c: Context, s: String): Button {
        val b = Button(c)
        b.text = s
        b.isAllCaps = false
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        b.setTextColor(TEXT)
        b.background = round(c, FILL, LINE)
        b.stateListAnimator = null
        b.minHeight = dp(c, 46)
        b.minimumHeight = dp(c, 46)
        b.setPadding(dp(c, 8), 0, dp(c, 8), 0)
        return b
    }

    fun setSelected(c: Context, b: Button, selected: Boolean) {
        b.background = if (selected) round(c, ACCENT_SOFT, ACCENT) else round(c, FILL, LINE)
        b.setTextColor(if (selected) ACCENT_TEXT else TEXT)
        b.typeface = if (selected) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
    }

    fun setDanger(c: Context, b: Button, danger: Boolean) {
        b.background = round(c, if (danger) 0xFFB3261E.toInt() else ACCENT, 0)
    }

    fun row(c: Context): LinearLayout {
        val l = LinearLayout(c)
        l.orientation = LinearLayout.HORIZONTAL
        l.gravity = Gravity.CENTER_VERTICAL
        return l
    }

    fun column(c: Context): LinearLayout {
        val l = LinearLayout(c)
        l.orientation = LinearLayout.VERTICAL
        return l
    }

    fun lp(w: Int, h: Int, weight: Float = 0f, top: Int = 0, left: Int = 0, right: Int = 0, bottom: Int = 0): LinearLayout.LayoutParams {
        val p = LinearLayout.LayoutParams(w, h, weight)
        p.setMargins(left, top, right, bottom)
        return p
    }

    fun card(c: Context): LinearLayout {
        val l = column(c)
        l.background = round(c, CARD, LINE)
        val p = dp(c, 12)
        l.setPadding(p, p, p, p)
        return l
    }

    fun divider(c: Context): View {
        val v = View(c)
        v.setBackgroundColor(LINE)
        return v
    }

    /** Black box with a thin outline: the lens preview must not melt into the dark page. */
    fun lensFrame(c: Context): GradientDrawable {
        val g = GradientDrawable()
        g.setColor(Color.BLACK)
        g.setStroke(dp(c, 1), LINE)
        return g
    }

    /** Picture as the glasses will show it, tinted green for the phone preview. */
    fun grayToBitmap(gray: ByteArray, w: Int, h: Int, reuse: Bitmap?): Bitmap {
        val px = IntArray(w * h)
        for (i in px.indices) {
            val v = gray[i].toInt() and 255
            px[i] = (0xFF shl 24) or ((v * 40 / 255) shl 16) or (v shl 8) or (v * 90 / 255)
        }
        val b = if (reuse != null && reuse.width == w && reuse.height == h && reuse.isMutable) reuse
        else Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        b.setPixels(px, 0, w, 0, 0, w, h)
        return b
    }
}

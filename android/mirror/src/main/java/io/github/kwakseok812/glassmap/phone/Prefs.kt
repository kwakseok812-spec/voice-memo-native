package io.github.kwakseok812.glassmap.phone

import android.content.Context
import android.content.SharedPreferences
import io.github.kwakseok812.glassmap.core.FrameBuilder
import io.github.kwakseok812.glassmap.core.Scaler
import io.github.kwakseok812.glassmap.core.Transform
import io.github.kwakseok812.glassmap.core.ViewConfig

/**
 * Everything the app remembers. Stored only inside the app's private storage. No pictures are stored.
 *
 * Since v0.4 there is one way of working only (no "directions" / "any screen" uses, no
 * direction band). Values written by v0.2 / v0.3 are read once in a compatible way:
 * a saved area becomes the area of "the part I set"; a saved view becomes one of the two views.
 */
object Prefs {
    private fun sp(c: Context): SharedPreferences =
        c.applicationContext.getSharedPreferences("glassmap", Context.MODE_PRIVATE)

    // ---- view: as on the phone (default) / dark background
    fun mode(c: Context): Int {
        val p = sp(c)
        if (p.contains("view")) return Transform.normalize(p.getInt("view", Transform.MODE_PLAIN))
        // v0.3 kept one view per use: 5 = as on the phone, 4 / 2 = dark, 3 = roads only (gone)
        val old = if (p.getInt("use", 0) == 1) p.getInt("view_scr", Transform.MODE_PLAIN) else p.getInt("view_nav", Transform.MODE_PLAIN)
        return if (old == 4 || old == 2) Transform.MODE_DARK else Transform.MODE_PLAIN
    }

    fun setMode(c: Context, m: Int) { sp(c).edit().putInt("view", Transform.normalize(m)).apply() }

    // ---- what part of the screen goes to the glasses, one tap to change
    const val SCOPE_FILL = 0     // the whole screen, lens filled (top and bottom are cut)
    const val SCOPE_ALL = 1      // the whole screen, nothing cut (made smaller, black at the sides)
    const val SCOPE_REGION = 2   // the box set in "set the area"

    fun scope(c: Context): Int {
        val p = sp(c)
        val s = if (p.contains("scope")) p.getInt("scope", SCOPE_ALL) else p.getInt("scope_scr", SCOPE_ALL)
        return if (s == SCOPE_FILL || s == SCOPE_REGION) s else SCOPE_ALL
    }

    fun setScope(c: Context, s: Int) { sp(c).edit().putInt("scope", s).apply() }

    // ---- the box of "the part I set", remembered per screen size (folded / unfolded)
    private fun parse(s: String?, w: Int, h: Int): IntArray? {
        if (s == null) return null
        val p = s.split(",").mapNotNull { it.toIntOrNull() }
        if (p.size != 4) return null
        return Scaler.clampCrop(intArrayOf(p[0], p[1], p[2], p[3]), w, h)
    }

    /** Saved box for this screen size, or null when none was ever set (also looks at boxes saved by v0.2 / v0.3). */
    fun savedRegion(c: Context, w: Int, h: Int): IntArray? {
        val p = sp(c)
        for (kind in arrayOf("region", "scr", "map0", "map1")) {
            val r = parse(p.getString("crop_${kind}_${w}x$h", null), w, h)
            if (r != null) return r
        }
        return null
    }

    /** Saved box, or the whole screen. */
    fun region(c: Context, w: Int, h: Int): IntArray = savedRegion(c, w, h) ?: Scaler.wholeScreen(w, h)

    fun setRegion(c: Context, w: Int, h: Int, r: IntArray) {
        sp(c).edit().putString("crop_region_${w}x$h", "${r[0]},${r[1]},${r[2]},${r[3]}").apply()
    }

    /** How the box of "the part I set" is fitted: show all (default) or fill. */
    fun regionFit(c: Context): Int {
        val p = sp(c)
        val v = when {
            p.contains("fit") -> p.getInt("fit", FrameBuilder.FIT_CONTAIN)
            p.contains("fit_scr") -> p.getInt("fit_scr", FrameBuilder.FIT_CONTAIN)
            // only an area from the old "directions" use exists: it was shown filled
            p.contains("fit_nav") || p.all.keys.any { it.startsWith("crop_map") } -> p.getInt("fit_nav", FrameBuilder.FIT_COVER)
            else -> FrameBuilder.FIT_CONTAIN
        }
        return if (v == FrameBuilder.FIT_COVER) FrameBuilder.FIT_COVER else FrameBuilder.FIT_CONTAIN
    }

    fun setRegionFit(c: Context, f: Int) { sp(c).edit().putInt("fit", f).apply() }

    /** The fit that is applied right now. */
    fun effectiveFit(c: Context): Int = when (scope(c)) {
        SCOPE_FILL -> FrameBuilder.FIT_COVER
        SCOPE_ALL -> FrameBuilder.FIT_CONTAIN
        else -> regionFit(c)
    }

    /** The screen area that is sent right now. */
    fun effectiveArea(c: Context, w: Int, h: Int): IntArray =
        if (scope(c) == SCOPE_REGION) region(c, w, h) else Scaler.wholeScreen(w, h)

    // ---- brightness of the "as on the phone" view
    val DIM = doubleArrayOf(1.0, 0.6, 0.35)

    fun brightness(c: Context): Int = sp(c).getInt("bright", 0).coerceIn(0, DIM.size - 1)
    fun setBrightness(c: Context, i: Int) { sp(c).edit().putInt("bright", i).apply() }

    // ---- the rest
    fun keepScreenOn(c: Context): Boolean = sp(c).getBoolean("keepScreenOn", true)
    fun setKeepScreenOn(c: Context, b: Boolean) { sp(c).edit().putBoolean("keepScreenOn", b).apply() }

    fun moreOpen(c: Context): Boolean = sp(c).getBoolean("moreOpen", false)
    fun setMoreOpen(c: Context, b: Boolean) { sp(c).edit().putBoolean("moreOpen", b).apply() }

    fun showKeys(c: Context): Boolean = sp(c).getBoolean("showKeys", true)
    fun setShowKeys(c: Context, b: Boolean) { sp(c).edit().putBoolean("showKeys", b).apply() }

    fun trustedId(c: Context): Int = sp(c).getInt("trustedId", 0)
    fun setTrustedId(c: Context, id: Int) { sp(c).edit().putInt("trustedId", id).apply() }

    fun manualHost(c: Context): String = sp(c).getString("manualHost", "") ?: ""
    fun setManualHost(c: Context, h: String) { sp(c).edit().putString("manualHost", h).apply() }

    /** Bluetooth address of the paired device that turned out to be the glasses */
    fun btAddress(c: Context): String = sp(c).getString("btAddress", "") ?: ""
    fun setBtAddress(c: Context, a: String) { if (a != btAddress(c)) sp(c).edit().putString("btAddress", a).apply() }

    fun lastHost(c: Context): String = sp(c).getString("lastHost", "") ?: ""
    fun setLastHost(c: Context, h: String) { sp(c).edit().putString("lastHost", h).apply() }

    /** Load what is remembered into the live state. */
    fun loadInto(c: Context) {
        AppState.mode = mode(c)
        val cfg = ViewConfig()
        cfg.plainDim = DIM[brightness(c)]
        AppState.config = cfg
    }
}

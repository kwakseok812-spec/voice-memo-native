package io.github.kwakseok812.glassmap.phone

import android.os.Handler
import android.os.Looper
import io.github.kwakseok812.glassmap.core.FrameBuilder
import io.github.kwakseok812.glassmap.core.PhoneLink
import io.github.kwakseok812.glassmap.core.Transform
import io.github.kwakseok812.glassmap.core.ViewConfig
import java.util.concurrent.CopyOnWriteArrayList

/** Live state shared between the capture service and the screens (memory only). */
object AppState {
    @Volatile var service: CaptureService? = null
    @Volatile var running = false

    @Volatile var linkState = PhoneLink.ST_IDLE
    @Volatile var linkDetail = ""

    /** Channel.KIND_* of the live connection (0 = none) */
    @Volatile var linkKind = 0

    /** what the link is trying right now, for the status line */
    @Volatile var trying = ""
    @Volatile var pendingTrustId = 0
    @Volatile var pendingTrustHost = ""

    /** Transform.MODE_PLAIN (as on the phone) or MODE_DARK */
    @Volatile var mode = Transform.MODE_PLAIN
    @Volatile var config = ViewConfig()

    /** how much detail is being sent right now (Quality level 0..3, 0 = full) */
    @Volatile var quality = 0

    /** size and travel time of the last picture the glasses confirmed, e.g. "38KB · 0.4초" */
    @Volatile var lastDelivery = ""

    /** the phone screen is off right now: nothing new can be captured */
    @Volatile var screenOff = false

    /** the last run was ended by the system (e.g. the phone was locked), not by the stop button */
    @Volatile var endedBySystem = false

    /** newest picture as built for the glasses (480 x 640, one byte per pixel) */
    @Volatile var built: FrameBuilder.Built? = null
    @Volatile var frameW = 0
    @Volatile var frameH = 0

    /** "the part I set" is chosen but no box was ever saved for this screen size */
    @Volatile var regionMissing = false

    /** true while one of this app's own screens is in front: the picture stays frozen on the last frame of the other app */
    @Volatile var activityFront = false
    @Volatile private var frontReleasedAt = 0L
    private const val GRACE_MS = 500L
    private var shown = 0
    private var multiWindow = false

    /**
     * Every screen of this app calls onShown from onStart and onHidden from onStop.
     * Started / stopped (not resumed / paused) on purpose: when one of our screens opens
     * another, the first is stopped only after the second is on screen, so there is no
     * moment in between in which our own screen would count as "another app" and be sent.
     */
    @Synchronized
    fun onShown() {
        shown++
        update()
    }

    @Synchronized
    fun onHidden() {
        if (shown > 0) shown--
        update()
    }

    /** Split screen: our screen and the other app are visible together, so sending goes on. */
    @Synchronized
    fun setMultiWindow(on: Boolean) {
        multiWindow = on
        update()
    }

    private fun update() {
        val front = shown > 0 && !multiWindow
        if (!front && activityFront) frontReleasedAt = android.os.SystemClock.elapsedRealtime()
        activityFront = front
    }

    /**
     * Milliseconds to keep ignoring screen frames after our last screen left the front
     * (covers the closing animation).
     */
    fun graceLeft(): Long {
        val left = frontReleasedAt + GRACE_MS - android.os.SystemClock.elapsedRealtime()
        return if (left > 0) left else 0
    }

    @Volatile var lastInput = ""

    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArrayList<Runnable>()
    @Volatile private var posted = false

    fun addListener(r: Runnable) { listeners.addIfAbsent(r) }
    fun removeListener(r: Runnable) { listeners.remove(r) }

    /** Tell the screens that something changed (coalesced, always on the main thread). */
    fun changed() {
        if (posted) return
        posted = true
        main.post {
            posted = false
            for (l in listeners) l.run()
        }
    }
}

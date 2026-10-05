package io.github.kwakseok812.glassmap.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.Display
import io.github.kwakseok812.glassmap.core.Channel
import io.github.kwakseok812.glassmap.core.Endpoint
import io.github.kwakseok812.glassmap.core.FrameBuilder
import io.github.kwakseok812.glassmap.core.Layout
import io.github.kwakseok812.glassmap.core.NetUtil
import io.github.kwakseok812.glassmap.core.PhoneLink
import io.github.kwakseok812.glassmap.core.Protocol
import io.github.kwakseok812.glassmap.core.Quality
import io.github.kwakseok812.glassmap.core.QualityGovernor
import io.github.kwakseok812.glassmap.core.Scaler
import io.github.kwakseok812.glassmap.core.Transform
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Holds the screen share, cuts the chosen part out of each screen frame, converts it and
 * hands it to the link. Pictures live in memory only: nothing is saved or recorded.
 */
class CaptureService : Service(), PhoneLink.Listener {

    companion object {
        const val ACTION_START = "io.github.kwakseok812.glassmap.phone.START"
        const val ACTION_STOP = "io.github.kwakseok812.glassmap.phone.STOP"

        /** debug builds only: write the number of screen frames taken in so far to the log */
        const val ACTION_DEBUG_COUNT = "io.github.kwakseok812.glassmap.phone.DEBUG_COUNT"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
        private const val TAG = "GlassMap"
        // numbers and channel of their own inside the assistant app (it has other notifications: 4321, 7101)
        private const val NOTIF_ID = 7201
        private const val NOTIF_ENDED_ID = 7202
        const val TEXT_SCREEN_OFF = "폰 화면이 꺼져 멈춤 — 화면을 켜면 이어집니다"
        const val TEXT_ENDED = "화면 공유가 끝났습니다(폰이 잠기면 안드로이드가 끝냅니다). 미러링 화면에서 「시작」을 다시 눌러 주세요."
        private const val CHANNEL = "mirror_sending"
        private const val MIN_FRAME_GAP_MS = 120L
    }

    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var projection: MediaProjection? = null
    private var vdisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var capW = 0
    private var capH = 0
    private var frameBmp: Bitmap? = null
    private var frameW = 0
    private var frameH = 0
    private var hasFrame = false
    private var spare: ByteBuffer? = null
    private var areaBuf: IntArray? = null
    private var drainScheduled = false
    private var lastProcess = 0L
    private var link: PhoneLink? = null
    private var discovery: Discovery? = null
    @Volatile private var stopped = false
    private var wake: PowerManager.WakeLock? = null
    private val governor = QualityGovernor()
    private var receiverOn = false
    private var sentCount = 0
    @Volatile private var freshCount = 0

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {}
        override fun onDisplayRemoved(displayId: Int) {}
        override fun onDisplayChanged(displayId: Int) {
            if (displayId == Display.DEFAULT_DISPLAY) checkSize()
        }
    }

    private val drain = Runnable { drainNow() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                goForeground()
                if (projection != null) return START_NOT_STICKY
                val code = intent.getIntExtra(EXTRA_CODE, 0)
                @Suppress("DEPRECATION")
                val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
                } else {
                    intent.getParcelableExtra(EXTRA_DATA)
                }
                if (data == null) {
                    shutdown()
                } else {
                    try {
                        startCapture(code, data)
                    } catch (e: Exception) {
                        Log.e(TAG, "capture start failed", e)
                        shutdown()
                    }
                }
            }
            ACTION_DEBUG_COUNT -> {
                if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0 && projection != null) {
                    Log.i(TAG, "screen frames taken in so far=$freshCount")
                } else if (projection == null) {
                    shutdown()
                }
            }
            else -> shutdown()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- start / stop

    private fun channel(): NotificationManager {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "안경으로 보내는 중", NotificationManager.IMPORTANCE_LOW)
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        return nm
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MirrorActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun sendingNotification(screenOff: Boolean): Notification {
        val stop = PendingIntent.getService(
            this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("미러링")
            .setContentText(if (screenOff) TEXT_SCREEN_OFF else "폰 화면을 안경으로 보내는 중입니다")
            .setOngoing(true)
            .setContentIntent(openApp())
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "정지", stop).build())
            .build()
    }

    private fun goForeground() {
        channel()
        startForeground(NOTIF_ID, sendingNotification(false), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    }

    /** Left behind after the system ended the share, so the reason is visible once the phone is unlocked. */
    private fun notifyEnded() {
        try {
            val n = Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("미러링")
                .setContentText(TEXT_ENDED)
                .setStyle(Notification.BigTextStyle().bigText(TEXT_ENDED))
                .setAutoCancel(true)
                .setContentIntent(openApp())
                .build()
            channel().notify(NOTIF_ENDED_ID, n)
        } catch (e: Exception) {
        }
    }

    // ---------------------------------------------------------------- phone screen on / off

    private fun isScreenOn(): Boolean = try {
        getSystemService(PowerManager::class.java).isInteractive
    } catch (e: Exception) {
        true
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_OFF -> onScreen(false)
                Intent.ACTION_SCREEN_ON -> onScreen(true)
            }
        }
    }

    /**
     * A switched-off screen draws nothing, so there is nothing to mirror. Say so on the
     * phone (notification) and on the glasses instead of leaving a frozen picture, and
     * carry on by itself when the screen is on again (if the share survived the lock).
     */
    private fun onScreen(on: Boolean) {
        if (stopped) return
        AppState.screenOff = !on
        Log.i(TAG, if (on) "phone screen on" else "phone screen off")
        link?.setNotice(if (on) Protocol.NOTICE_NONE else Protocol.NOTICE_SCREEN_OFF)
        try {
            channel().notify(NOTIF_ID, sendingNotification(!on))
        } catch (e: Exception) {
        }
        if (on) requestRerender()
        AppState.changed()
    }

    /**
     * "Keep the screen on while sending": stops the screen from switching off by itself
     * (the timeout), also while another app is in front. It cannot stop the power button.
     * The screen may dim; what is captured is not affected by the backlight.
     */
    fun applyKeepScreenOn() {
        val want = !stopped && Prefs.keepScreenOn(this)
        if (want && wake == null) {
            try {
                val pm = getSystemService(PowerManager::class.java)
                @Suppress("DEPRECATION")
                val w = pm.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK, "phonemirror:sending")
                w.setReferenceCounted(false)
                w.acquire()
                wake = w
                Log.i(TAG, "keep screen on: on")
            } catch (e: Exception) {
                Log.w(TAG, "keep screen on failed: $e")
            }
        } else if (!want) {
            releaseWake()
        }
    }

    private fun releaseWake() {
        val w = wake ?: return
        wake = null
        try {
            if (w.isHeld) w.release()
        } catch (e: Exception) {
        }
        Log.i(TAG, "keep screen on: off")
    }

    private fun realSize(): Point {
        val d = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val p = Point()
        @Suppress("DEPRECATION")
        d.getRealSize(p)
        return p
    }

    private fun startCapture(code: Int, data: Intent) {
        val t = HandlerThread("gm-capture")
        t.start()
        thread = t
        val h = Handler(t.looper)
        handler = h

        Prefs.loadInto(this)
        AppState.endedBySystem = false
        try {
            channel().cancel(NOTIF_ENDED_ID)
        } catch (e: Exception) {
        }
        AppState.screenOff = !isScreenOn()

        val mpm = getSystemService(MediaProjectionManager::class.java)
        val p = mpm.getMediaProjection(code, data) ?: throw IllegalStateException("no projection")
        projection = p
        p.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (stopped) return
                // Not our stop button: Android ended the share (it does when the phone is locked).
                Log.i(TAG, "screen share ended by the system")
                AppState.endedBySystem = true
                link?.setNotice(Protocol.NOTICE_SHARE_ENDED)
                notifyEnded()
                // give the notice a moment to reach the glasses before the link is closed
                h.postDelayed({ shutdown() }, 500)
            }
        }, h)

        val size = realSize()
        capW = size.x
        capH = size.y
        val r = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 2)
        r.setOnImageAvailableListener({ scheduleDrain() }, h)
        reader = r
        vdisplay = p.createVirtualDisplay(
            "GlassMapCapture", capW, capH, resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, h
        )
        getSystemService(DisplayManager::class.java).registerDisplayListener(displayListener, h)

        val d = Discovery(this) {
            AppState.linkState == PhoneLink.ST_SEARCHING && Prefs.manualHost(this).isEmpty()
        }
        discovery = d
        d.start()
        val l = PhoneLink(this)
        link = l
        l.setShowKeys(Prefs.showKeys(this))
        if (AppState.screenOff) l.setNotice(Protocol.NOTICE_SCREEN_OFF)
        l.start()

        val f = IntentFilter()
        f.addAction(Intent.ACTION_SCREEN_OFF)
        f.addAction(Intent.ACTION_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, f, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, f)
        }
        receiverOn = true
        applyKeepScreenOn()

        NetUtil.logger = { m -> Log.i(TAG, m) }
        AppState.service = this
        AppState.running = true
        AppState.changed()
        Log.i(TAG, "capture started ${capW}x$capH")
    }

    /** Stops everything. Safe to call more than once and from any thread. */
    fun shutdown() {
        synchronized(this) {
            if (stopped) return
            stopped = true
        }
        Log.i(TAG, "capture stopping")
        if (receiverOn) {
            receiverOn = false
            try {
                unregisterReceiver(screenReceiver)
            } catch (e: Exception) {
            }
        }
        releaseWake()
        AppState.screenOff = false
        try {
            getSystemService(DisplayManager::class.java).unregisterDisplayListener(displayListener)
        } catch (e: Exception) {
        }
        try {
            link?.stop()
        } catch (e: Exception) {
        }
        try {
            discovery?.stop()
        } catch (e: Exception) {
        }
        try {
            vdisplay?.release()
        } catch (e: Exception) {
        }
        try {
            reader?.close()
        } catch (e: Exception) {
        }
        try {
            projection?.stop()
        } catch (e: Exception) {
        }
        vdisplay = null
        reader = null
        projection = null
        try {
            thread?.quitSafely()
        } catch (e: Exception) {
        }
        AppState.service = null
        AppState.running = false
        AppState.linkState = PhoneLink.ST_IDLE
        AppState.linkDetail = ""
        AppState.linkKind = 0
        AppState.trying = ""
        AppState.pendingTrustId = 0
        AppState.built = null
        AppState.changed()
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
        }
        stopSelf()
    }

    // ---------------------------------------------------------------- screen size (fold / unfold / rotate)

    private fun checkSize() {
        if (stopped) return
        val size = realSize()
        if (size.x == capW && size.y == capH) return
        Log.i(TAG, "screen size changed ${capW}x$capH -> ${size.x}x${size.y}")
        val h = handler ?: return
        val old = reader
        capW = size.x
        capH = size.y
        try {
            val r = ImageReader.newInstance(capW, capH, PixelFormat.RGBA_8888, 2)
            r.setOnImageAvailableListener({ scheduleDrain() }, h)
            reader = r
            vdisplay?.resize(capW, capH, resources.displayMetrics.densityDpi)
            vdisplay?.surface = r.surface
            old?.close()
            hasFrame = false
        } catch (e: Exception) {
            Log.e(TAG, "resize failed", e)
        }
    }

    // ---------------------------------------------------------------- frames

    private fun scheduleDrain() {
        if (drainScheduled || stopped) return
        drainScheduled = true
        val wait = lastProcess + MIN_FRAME_GAP_MS - SystemClock.elapsedRealtime()
        handler?.postDelayed(drain, if (wait > 0) wait else 0)
    }

    private fun drainNow() {
        drainScheduled = false
        if (stopped) return
        // just after one of our screens closed: wait a moment, then take the newest frame
        val grace = if (AppState.activityFront) 0L else AppState.graceLeft()
        if (grace > 0) {
            drainScheduled = true
            handler?.postDelayed(drain, grace + 20)
            return
        }
        val r = reader ?: return
        val img = (try {
            r.acquireLatestImage()
        } catch (e: Exception) {
            null
        }) ?: return
        var fresh = false
        try {
            lastProcess = SystemClock.elapsedRealtime()
            // While one of this app's own screens is in front, keep the last map frame:
            // our own buttons are never sent to the glasses.
            val frozen = AppState.activityFront
            if (!frozen) {
                val plane = img.planes[0]
                val stridePx = plane.rowStride / plane.pixelStride
                var b = frameBmp
                if (b == null || b.width != stridePx || b.height != img.height) {
                    b = Bitmap.createBitmap(stridePx, img.height, Bitmap.Config.ARGB_8888)
                    frameBmp = b
                }
                val buf = plane.buffer
                buf.rewind()
                val need = b!!.byteCount
                if (buf.remaining() >= need) {
                    b.copyPixelsFromBuffer(buf)
                } else {
                    // some devices leave the padding of the last row out
                    var sp = spare
                    if (sp == null || sp.capacity() != need) {
                        sp = ByteBuffer.allocate(need)
                        spare = sp
                    }
                    sp!!.clear()
                    sp.put(buf)
                    sp.position(0)
                    sp.limit(need)
                    b.copyPixelsFromBuffer(sp)
                }
                frameW = img.width
                frameH = img.height
                hasFrame = true
                fresh = true
                freshCount++
            }
        } catch (e: Exception) {
            Log.e(TAG, "frame copy failed", e)
        } finally {
            img.close()
        }
        if (fresh) renderAndSend()
    }

    private fun cut(b: Bitmap, c: IntArray, reuse: IntArray?): IntArray {
        val need = c[2] * c[3]
        val out = if (reuse != null && reuse.size == need) reuse else IntArray(need)
        b.getPixels(out, 0, c[2], c[0], c[1], c[2], c[3])
        return out
    }

    private fun renderAndSend() {
        if (stopped || !hasFrame) return
        val b = frameBmp ?: return
        try {
            val fit = Prefs.effectiveFit(this)
            AppState.regionMissing = Prefs.scope(this) == Prefs.SCOPE_REGION && Prefs.savedRegion(this, frameW, frameH) == null
            val area = Scaler.clampCrop(Prefs.effectiveArea(this, frameW, frameH), frameW, frameH)
            val px = cut(b, area, areaBuf)
            areaBuf = px
            val built = FrameBuilder.build(px, area[2], area[3], AppState.mode, AppState.config, fit)
            AppState.built = built
            AppState.frameW = frameW
            AppState.frameH = frameH
            // less detail by itself when pictures take long to arrive (slow Bluetooth, busy picture)
            val q = Quality.apply(built.gray, Layout.W, Layout.H, governor.level)
            link?.submitFrame(AppState.mode, q.gray, q.w, q.h)
            sentCount++
            if (sentCount == 1 || sentCount % 100 == 0) Log.i(TAG, "picture built count=$sentCount mode=${AppState.mode}")
            AppState.changed()
        } catch (e: Exception) {
            Log.e(TAG, "convert failed", e)
        }
    }

    /**
     * "Stop and close the glasses app too": ask the glasses app to close itself (over the
     * link that is open right now), then stop sending. Without a connection only the
     * stopping happens - the glasses app then closes by itself after its idle time.
     */
    fun quitGlassesAndStop() {
        val l = link
        Thread({
            val sent = try {
                l?.sendQuit(1500) ?: false
            } catch (e: Exception) {
                false
            }
            Log.i(TAG, "close request sent to the glasses app=$sent")
            try {
                Thread.sleep(300)
            } catch (e: InterruptedException) {
            }
            shutdown()
        }, "gm-quit").start()
    }

    /** Settings, mode or areas changed: convert the current frame again. */
    fun requestRerender() {
        handler?.post { renderAndSend() }
    }

    /** Copy of the last map-side screen frame, for the "set the areas" screen. Memory only. */
    fun snapshot(): Bitmap? {
        val h = handler ?: return null
        var out: Bitmap? = null
        val latch = CountDownLatch(1)
        h.post {
            try {
                val b = frameBmp
                if (b != null && hasFrame) out = Bitmap.createBitmap(b, 0, 0, frameW, frameH)
            } catch (e: Throwable) {
            }
            latch.countDown()
        }
        try {
            latch.await(2000, TimeUnit.MILLISECONDS)
        } catch (e: InterruptedException) {
        }
        return out
    }

    fun setShowKeys(show: Boolean) {
        link?.setShowKeys(show)
    }

    fun reconnect() {
        link?.reconnect()
    }

    // ---------------------------------------------------------------- PhoneLink.Listener (link threads)

    override fun onState(state: Int, detail: String, kind: Int) {
        AppState.linkState = state
        AppState.linkDetail = detail
        AppState.linkKind = kind
        if (state == PhoneLink.ST_CONNECTED) {
            governor.reset()
            AppState.quality = 0
            AppState.lastDelivery = ""
            AppState.pendingTrustId = 0
            AppState.trying = ""
            Log.i(TAG, "connected to glasses at " + (if (kind == Channel.KIND_BLUETOOTH) "bluetooth" else detail))
        }
        AppState.changed()
    }

    override fun onFrameDelivered(bytes: Int, ms: Long) {
        val before = governor.level
        val now = governor.onDelivered(ms)
        AppState.quality = now
        AppState.lastDelivery = ((bytes + 512) / 1024).toString() + "KB · " + (ms / 100 / 10.0).toString() + "초"
        if (now != before) {
            Log.i(TAG, "picture detail level $before -> $now (last picture: $bytes bytes in $ms ms)")
            requestRerender()
        }
    }

    override fun onTrying(ep: Endpoint) {
        AppState.trying = (if (ep.kind == Channel.KIND_BLUETOOTH) "블루투스 " else "와이파이 ") + ep.label
        AppState.changed()
    }

    override fun onGlasses(id: Int, ep: Endpoint): Boolean {
        // A device the user already paired with this phone needs no second confirmation.
        if (ep.paired) {
            Prefs.setBtAddress(this, ep.key)
            return true
        }
        val ok = id == Prefs.trustedId(this) || ep.key == Prefs.manualHost(this)
        if (ok) {
            // An address typed in by hand is the user's own confirmation.
            Prefs.setTrustedId(this, id)
            Prefs.setLastHost(this, ep.key)
            return true
        }
        AppState.pendingTrustId = id
        AppState.pendingTrustHost = ep.key
        AppState.changed()
        return false
    }

    override fun onInput(input: Protocol.Input) {
        val what = when (input.kind) {
            Protocol.KIND_KEY -> android.view.KeyEvent.keyCodeToString(input.code) + " (" + input.code + ")"
            Protocol.KIND_TOUCH -> "터치/클릭"
            else -> "움직임 (" + input.code + ")"
        }
        AppState.lastInput = what
        Log.i(TAG, "glasses input $what toggle=${input.toggle}")
        if (input.toggle) {
            // a key on the glasses goes back and forth between the two views
            val m = Transform.nextView(AppState.mode)
            AppState.mode = m
            Prefs.setMode(this, m)
            requestRerender()
        }
        AppState.changed()
    }

    /**
     * Where to look for the glasses app, best first:
     * an address typed by hand, glasses seen on the Wi-Fi, then the paired Bluetooth devices
     * (the normal case: the glasses keep their Wi-Fi off), then the last Wi-Fi address that worked.
     */
    override fun endpoints(): List<Endpoint> {
        val out = ArrayList<Endpoint>()
        val seen = HashSet<String>()
        fun wifi(h: String) {
            if (h.isNotEmpty() && seen.add(h) && NetUtil.isLocalHostString(h)) out.add(NetUtil.tcpEndpoint(h, NetUtil.PORT))
        }
        wifi(Prefs.manualHost(this))
        discovery?.found()?.forEach { wifi(it) }
        try {
            out.addAll(BtDialer.endpoints(this))
        } catch (e: Exception) {
            Log.w(TAG, "bluetooth endpoints: $e")
        }
        wifi(Prefs.lastHost(this))
        return out
    }
}

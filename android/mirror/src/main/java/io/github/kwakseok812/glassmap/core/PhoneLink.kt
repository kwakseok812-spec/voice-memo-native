package io.github.kwakseok812.glassmap.core

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * Phone side: keeps one connection to the glasses app alive (reconnects by itself),
 * sends the newest picture only (older unsent ones are dropped), receives key presses.
 * Works over any Channel (Wi-Fi socket or Bluetooth serial link).
 *
 * Pacing: one picture is on its way at a time. The next one is sent when the glasses
 * confirm the previous one, so nothing piles up inside the radio link and the lens is
 * never more than one picture behind. The time until that confirmation is reported to
 * the listener, which uses it to pick how detailed the pictures can be.
 */
class PhoneLink(private val listener: Listener) {

    interface Listener {
        /** state = ST_*; detail = label for CONNECTED, glasses number for WAIT_TRUST; kind = Channel.KIND_* (0 when not connected) */
        fun onState(state: Int, detail: String, kind: Int)

        /** About to try this endpoint (for "checking: <name>" on screen). */
        fun onTrying(ep: Endpoint)

        /** A glasses app answered. Return true to use it, false to refuse (not confirmed by the user yet). */
        fun onGlasses(id: Int, ep: Endpoint): Boolean

        fun onInput(input: Protocol.Input)

        /** Places to try, best first. Called before every connection round. */
        fun endpoints(): List<Endpoint>

        /** A picture of this many bytes reached the glasses after this many milliseconds. */
        fun onFrameDelivered(bytes: Int, ms: Long) {}
    }

    companion object {
        const val ST_IDLE = 0
        const val ST_SEARCHING = 1
        const val ST_CONNECTED = 2
        const val ST_WAIT_TRUST = 3

        const val PING_INTERVAL_MS = 1500L

        /** nothing at all received for this long = the link is dead */
        const val RX_TIMEOUT_MS = 8000L

        /** a picture not confirmed after this long no longer holds back the next one */
        const val ACK_TIMEOUT_MS = 3000L
    }

    private val lock = Object()
    private var pending: Protocol.Frame? = null
    private var last: Protocol.Frame? = null
    private var settingsDirty = true
    private var showKeys = true
    private var notice = Protocol.NOTICE_NONE
    private var quitLatch: java.util.concurrent.CountDownLatch? = null
    private var seq = 0
    @Volatile private var running = false
    @Volatile private var current: Channel? = null
    private var worker: Thread? = null

    // one picture on its way (guarded by lock)
    private var flightSeq = 0
    private var flightAt = 0L
    private var flightBytes = 0
    private var inFlight = false
    private var acksSeen = 0
    private var ackMisses = 0
    /** the other side never confirms (an older glasses app): do not wait for confirmations */
    private var noAcks = false

    fun start() {
        if (running) return
        running = true
        worker = thread(name = "gm-link", isDaemon = true) { run() }
    }

    fun stop() {
        running = false
        current?.close()
        synchronized(lock) { lock.notifyAll() }
        worker?.interrupt()
    }

    /** Newest picture wins. */
    fun submitFrame(mode: Int, gray: ByteArray, w: Int, h: Int) {
        synchronized(lock) {
            seq++
            pending = Protocol.Frame(mode, seq, w, h, gray)
            lock.notifyAll()
        }
    }

    fun setShowKeys(show: Boolean) {
        synchronized(lock) {
            showKeys = show
            settingsDirty = true
            lock.notifyAll()
        }
    }

    /** Tell the glasses why no picture is coming (Protocol.NOTICE_*). Kept and sent again after a reconnect. */
    fun setNotice(code: Int) {
        synchronized(lock) {
            if (notice == code) return
            notice = code
            settingsDirty = true
            lock.notifyAll()
        }
    }

    /**
     * Ask the glasses app to close itself. Blocks until the request has been written to the
     * link or the time is up. Returns false when there is no connection to send it over.
     * Do not call on the UI thread.
     */
    fun sendQuit(timeoutMs: Long): Boolean {
        if (current == null) return false
        val l = java.util.concurrent.CountDownLatch(1)
        synchronized(lock) {
            quitLatch = l
            lock.notifyAll()
        }
        val ok = try {
            l.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (e: InterruptedException) {
            false
        }
        synchronized(lock) { if (quitLatch === l) quitLatch = null }
        return ok
    }

    /** Drop the current connection (e.g. the user typed another address); it reconnects by itself. */
    fun reconnect() {
        current?.close()
        synchronized(lock) { lock.notifyAll() }
    }

    private fun run() {
        while (running) {
            var waitingTrust = false
            var hadSession = false
            val eps = try {
                listener.endpoints()
            } catch (e: Exception) {
                emptyList()
            }
            for (ep in eps) {
                if (!running) break
                val r = attempt(ep)
                if (r == 1) {
                    hadSession = true
                    break
                }
                if (r == 2) waitingTrust = true
            }
            if (!running) break
            if (!hadSession && !waitingTrust) listener.onState(ST_SEARCHING, "", 0)
            sleepQuiet(if (hadSession) 300 else 1000)
        }
        listener.onState(ST_IDLE, "", 0)
    }

    private fun onAck(ackSeq: Int) {
        var bytes = 0
        var ms = -1L
        synchronized(lock) {
            acksSeen++
            if (inFlight && ackSeq == flightSeq) {
                inFlight = false
                ackMisses = 0
                bytes = flightBytes
                ms = System.currentTimeMillis() - flightAt
                lock.notifyAll()
            }
        }
        if (ms >= 0) {
            try {
                listener.onFrameDelivered(bytes, ms)
            } catch (e: Exception) {
            }
        }
    }

    /** @return 0 = could not connect, 1 = had a session (now ended), 2 = glasses not confirmed yet */
    private fun attempt(ep: Endpoint): Int {
        var ch: Channel? = null
        var session = false
        val closed = AtomicBoolean(false)
        val lastRx = AtomicLong(System.currentTimeMillis())
        try {
            listener.onTrying(ep)
            val c = ep.open()
            ch = c
            current = c
            if (!running) return 0
            lastRx.set(System.currentTimeMillis())

            // Watchdog on its own thread: a stuck read OR a stuck write is ended by closing the pipe.
            thread(name = "gm-link-watch", isDaemon = true) {
                while (!closed.get()) {
                    sleepQuiet(1000)
                    if (closed.get()) break
                    if (System.currentTimeMillis() - lastRx.get() > RX_TIMEOUT_MS) {
                        NetUtil.log("link to ${ep.label}: silent for ${RX_TIMEOUT_MS} ms, closing")
                        closed.set(true)
                        c.close()
                        synchronized(lock) { lock.notifyAll() }
                        break
                    }
                }
            }

            val din = DataInputStream(BufferedInputStream(WatchedInput(c.input) { lastRx.set(System.currentTimeMillis()) }, 8192))
            val dout = DataOutputStream(BufferedOutputStream(c.output, 65536))
            val hello = Protocol.readHello(din)
            if (hello.role != Protocol.ROLE_GLASSES) return 0
            if (!listener.onGlasses(hello.id, ep)) {
                listener.onState(ST_WAIT_TRUST, hello.id.toString(), 0)
                return 2
            }
            Protocol.writeHello(dout, Protocol.ROLE_PHONE, 0)
            session = true
            listener.onState(ST_CONNECTED, ep.label, ep.kind)

            val reader = thread(name = "gm-link-read", isDaemon = true) {
                try {
                    while (running && !closed.get()) {
                        val msg = Protocol.readMessage(din)
                        when (msg.first) {
                            Protocol.T_INPUT -> listener.onInput(Protocol.decodeInput(msg.second))
                            Protocol.T_ACK -> onAck(Protocol.decodeInt(msg.second))
                        }
                    }
                } catch (e: Exception) {
                    if (running && !closed.get()) NetUtil.log("link read ended: ${e.javaClass.simpleName} ${e.message ?: ""}")
                } finally {
                    closed.set(true)
                    c.close()
                    synchronized(lock) { lock.notifyAll() }
                }
            }

            var lastSentGray: ByteArray? = null
            var lastSentMode = -1
            synchronized(lock) {
                settingsDirty = true
                inFlight = false
                acksSeen = 0
                ackMisses = 0
                noAcks = false
                if (pending == null) pending = last   // show the current picture again after a reconnect
            }
            var lastPing = 0L
            while (running && !closed.get()) {
                var frame: Protocol.Frame? = null
                var sendSettings = false
                var show = true
                var note = Protocol.NOTICE_NONE
                synchronized(lock) {
                    var now = System.currentTimeMillis()
                    // a picture that was never confirmed stops holding back the next one
                    if (inFlight && now - flightAt >= ACK_TIMEOUT_MS) {
                        inFlight = false
                        ackMisses++
                        if (acksSeen == 0 && ackMisses >= 2) noAcks = true
                    }
                    val held = inFlight && !noAcks
                    if ((pending == null || held) && !settingsDirty && quitLatch == null) {
                        var wait = PING_INTERVAL_MS
                        if (held) {
                            val left = flightAt + ACK_TIMEOUT_MS - now
                            if (left < wait) wait = left
                        }
                        try {
                            lock.wait(if (wait < 1) 1 else wait)
                        } catch (e: InterruptedException) {
                        }
                        now = System.currentTimeMillis()
                        if (inFlight && now - flightAt >= ACK_TIMEOUT_MS) {
                            inFlight = false
                            ackMisses++
                            if (acksSeen == 0 && ackMisses >= 2) noAcks = true
                        }
                    }
                    if (!(inFlight && !noAcks)) {
                        frame = pending
                        pending = null
                    }
                    if (settingsDirty) {
                        sendSettings = true
                        settingsDirty = false
                        show = showKeys
                        note = notice
                    }
                }
                if (closed.get()) break
                val now = System.currentTimeMillis()
                val quit = synchronized(lock) {
                    val q = quitLatch
                    quitLatch = null
                    q
                }
                if (quit != null) {
                    Protocol.writeMessage(dout, Protocol.T_QUIT, Protocol.EMPTY)
                    quit.countDown()
                }
                if (sendSettings) {
                    Protocol.writeMessage(dout, Protocol.T_SETTINGS, byteArrayOf((if (show) 1 else 0).toByte()))
                    Protocol.writeMessage(dout, Protocol.T_NOTICE, byteArrayOf(note.toByte()))
                }
                val f = frame
                if (f != null) {
                    synchronized(lock) { last = f }
                    val same = lastSentMode == f.mode && lastSentGray != null && lastSentGray.contentEquals(f.gray)
                    if (!same) {
                        val payload = Protocol.encodeFrame(f)
                        synchronized(lock) {
                            inFlight = true
                            flightSeq = f.seq
                            flightAt = System.currentTimeMillis()
                            flightBytes = payload.size
                        }
                        Protocol.writeMessage(dout, Protocol.T_FRAME, payload)
                        lastSentGray = f.gray
                        lastSentMode = f.mode
                    }
                }
                // Ping on a clock of its own, also while pictures flow without a pause.
                if (now - lastPing >= PING_INTERVAL_MS) {
                    Protocol.writeMessage(dout, Protocol.T_PING, Protocol.EMPTY)
                    lastPing = now
                }
            }
            try {
                reader.join(500)
            } catch (e: InterruptedException) {
            }
            return 1
        } catch (e: Exception) {
            if (session) NetUtil.log("link to ${ep.label} ended: ${e.javaClass.simpleName} ${e.message ?: ""}")
            return if (session) 1 else 0
        } finally {
            closed.set(true)
            ch?.close()
            if (current === ch) current = null
            if (session && running) listener.onState(ST_SEARCHING, "", 0)
        }
    }

    private fun sleepQuiet(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (e: InterruptedException) {
        }
    }
}

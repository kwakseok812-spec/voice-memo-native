package io.github.kwakseok812.glassmap.core

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * Glasses side: waits for the phone app, receives pictures, reports key presses back.
 * One phone at a time; a newer connection replaces the older one.
 *
 * Pipes come from two places: the built-in TCP listener (local network only) and
 * whatever the app hands to serve() - on the glasses that is the Bluetooth serial link.
 */
class GlassServer(
    private val port: Int,
    private val glassesId: Int,
    private val listener: Listener,
    private val beacon: Boolean = true,
    private val tcp: Boolean = true
) {
    interface Listener {
        fun onConnected(peer: String, kind: Int)
        fun onDisconnected()
        fun onFrame(frame: Protocol.Frame)
        fun onSettings(showKeys: Boolean)

        /** Protocol.NOTICE_* : why no picture is coming */
        fun onNotice(code: Int)

        /** The user asked on the phone to close the glasses app. */
        fun onQuit()
    }

    companion object {
        const val RX_TIMEOUT_MS = 8000L
        const val HEARTBEAT_MS = 1500L
        const val BEACON_INTERVAL_MS = 1500L
    }

    @Volatile private var running = false
    @Volatile private var serverSocket: ServerSocket? = null
    private val lock = Any()
    private var client: Channel? = null
    private var out: DataOutputStream? = null
    private val bound = CountDownLatch(1)

    val boundPort: Int get() = serverSocket?.localPort ?: -1

    val isConnected: Boolean get() = synchronized(lock) { client != null }

    val isRunning: Boolean get() = running

    fun start() {
        if (running) return
        running = true
        if (tcp) {
            thread(name = "gm-accept", isDaemon = true) { acceptLoop() }
            if (beacon) thread(name = "gm-beacon", isDaemon = true) { beaconLoop() }
        }
    }

    /** Waits until the TCP listening socket is open (for tests). */
    fun awaitBound(timeoutMs: Long): Boolean = bound.await(timeoutMs, TimeUnit.MILLISECONDS)

    fun stop() {
        running = false
        try {
            serverSocket?.close()
        } catch (e: Exception) {
        }
        val c = synchronized(lock) { client }
        c?.close()
    }

    /** Tell the phone that a key / tap happened. Do not call on the UI thread. */
    fun sendInput(code: Int, kind: Int, toggle: Boolean): Boolean {
        return send(Protocol.T_INPUT, Protocol.encodeInput(Protocol.Input(code, kind, toggle)), null)
    }

    /** @param only when not null, send only if this pipe is still the current one */
    private fun send(type: Int, payload: ByteArray, only: Channel?): Boolean {
        synchronized(lock) {
            val o = out ?: return false
            if (only != null && client !== only) return false
            return try {
                Protocol.writeMessage(o, type, payload)
                true
            } catch (e: IOException) {
                client?.close()
                false
            }
        }
    }

    private fun acceptLoop() {
        var ss: ServerSocket? = null
        while (running && ss == null) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress(port))
                ss = s
            } catch (e: IOException) {
                sleepQuiet(1000)
            }
        }
        if (ss == null) return
        serverSocket = ss
        bound.countDown()
        if (!running) {
            try {
                ss.close()
            } catch (e: Exception) {
            }
            return
        }
        while (running) {
            val s = try {
                ss.accept()
            } catch (e: IOException) {
                if (!running) break
                sleepQuiet(200)
                continue
            }
            if (!NetUtil.isLocalAddress(s.inetAddress)) {
                try {
                    s.close()
                } catch (e: Exception) {
                }
                continue
            }
            thread(name = "gm-serve", isDaemon = true) {
                val ch = try {
                    SocketChannel(s, s.inetAddress?.hostAddress ?: "?")
                } catch (e: Exception) {
                    null
                }
                if (ch != null) serve(ch)
            }
        }
        try {
            ss.close()
        } catch (e: Exception) {
        }
    }

    /**
     * Run one phone session on this pipe. Blocks until the session ends; always closes the pipe.
     * Call from a worker thread (the Bluetooth accept loop does).
     */
    fun serve(ch: Channel) {
        var registered = false
        val done = AtomicBoolean(false)
        val lastRx = AtomicLong(System.currentTimeMillis())
        // Watchdog: a phone that went silent (walked away, Bluetooth dropped without notice) is let go.
        thread(name = "gm-serve-watch", isDaemon = true) {
            while (!done.get()) {
                sleepQuiet(1000)
                if (done.get()) break
                if (System.currentTimeMillis() - lastRx.get() > RX_TIMEOUT_MS) {
                    NetUtil.log("phone link ${ch.label}: silent for ${RX_TIMEOUT_MS} ms, closing")
                    ch.close()
                    break
                }
            }
        }
        try {
            val din = DataInputStream(BufferedInputStream(WatchedInput(ch.input) { lastRx.set(System.currentTimeMillis()) }, 65536))
            val dout = DataOutputStream(BufferedOutputStream(ch.output, 8192))
            Protocol.writeHello(dout, Protocol.ROLE_GLASSES, glassesId)
            val hello = Protocol.readHello(din)
            if (hello.role != Protocol.ROLE_PHONE) return
            val old: Channel? = synchronized(lock) {
                val prev = client
                client = ch
                out = dout
                prev
            }
            registered = true
            old?.close()
            listener.onConnected(ch.label, ch.kind)
            // Heartbeat of our own, so the phone hears from us even while it is busy sending a big picture.
            thread(name = "gm-serve-beat", isDaemon = true) {
                while (!done.get()) {
                    sleepQuiet(HEARTBEAT_MS)
                    if (done.get()) break
                    if (!send(Protocol.T_PONG, Protocol.EMPTY, ch)) break
                }
            }
            while (running) {
                val msg = Protocol.readMessage(din)
                when (msg.first) {
                    Protocol.T_FRAME -> {
                        val f = Protocol.decodeFrame(msg.second)
                        listener.onFrame(f)
                        // tell the phone it arrived: the phone sends the next picture only then
                        send(Protocol.T_ACK, Protocol.encodeInt(f.seq), ch)
                    }
                    Protocol.T_PING -> {
                    }
                    Protocol.T_SETTINGS -> listener.onSettings(msg.second.isNotEmpty() && msg.second[0].toInt() != 0)
                    Protocol.T_NOTICE -> listener.onNotice(if (msg.second.isNotEmpty()) msg.second[0].toInt() and 255 else 0)
                    Protocol.T_QUIT -> listener.onQuit()
                }
            }
        } catch (e: Exception) {
            if (registered && running) NetUtil.log("phone link ended: ${e.javaClass.simpleName} ${e.message ?: ""}")
        } finally {
            done.set(true)
            var wasCurrent = false
            synchronized(lock) {
                if (client === ch) {
                    client = null
                    out = null
                    wasCurrent = true
                }
            }
            ch.close()
            if (registered && wasCurrent) listener.onDisconnected()
        }
    }

    private fun beaconLoop() {
        while (running) {
            if (!isConnected) {
                val p = boundPort
                if (p > 0) NetUtil.sendBeacon(glassesId, p)
            }
            sleepQuiet(BEACON_INTERVAL_MS)
        }
    }

    private fun sleepQuiet(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (e: InterruptedException) {
        }
    }
}

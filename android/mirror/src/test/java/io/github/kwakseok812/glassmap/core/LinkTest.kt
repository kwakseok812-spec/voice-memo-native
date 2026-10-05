package io.github.kwakseok812.glassmap.core

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LinkTest {

    private fun waitUntil(ms: Long, cond: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (cond()) return true
            Thread.sleep(20)
        }
        return cond()
    }

    private class GlassSide : GlassServer.Listener {
        val frames = CopyOnWriteArrayList<Protocol.Frame>()
        @Volatile var connected = false
        @Volatile var connects = 0
        @Volatile var kind = 0
        @Volatile var showKeys: Boolean? = null
        val notices = CopyOnWriteArrayList<Int>()
        override fun onNotice(code: Int) { notices.add(code) }
        @Volatile var quits = 0
        override fun onQuit() { quits++ }
        override fun onConnected(peer: String, kind: Int) { connected = true; connects++; this.kind = kind }
        override fun onDisconnected() { connected = false }
        override fun onFrame(frame: Protocol.Frame) { frames.add(frame) }
        override fun onSettings(showKeys: Boolean) { this.showKeys = showKeys }
    }

    private class PhoneSide(@Volatile var eps: List<Endpoint>, @Volatile var trust: Boolean) : PhoneLink.Listener {
        val states = CopyOnWriteArrayList<Int>()
        val inputs = CopyOnWriteArrayList<Protocol.Input>()
        val tried = CopyOnWriteArrayList<String>()
        @Volatile var state = -1
        @Volatile var kind = 0
        @Volatile var seenId = 0
        override fun onState(state: Int, detail: String, kind: Int) { this.state = state; this.kind = kind; states.add(state) }
        override fun onTrying(ep: Endpoint) { tried.add(ep.label) }
        override fun onGlasses(id: Int, ep: Endpoint): Boolean { seenId = id; return trust || ep.paired }
        override fun onInput(input: Protocol.Input) { inputs.add(input) }
        override fun endpoints(): List<Endpoint> = eps
        val delivered = CopyOnWriteArrayList<Long>()
        override fun onFrameDelivered(bytes: Int, ms: Long) { delivered.add(ms) }
    }

    private fun picture(seed: Int): ByteArray {
        val g = ByteArray(Layout.W * Layout.H)
        for (i in g.indices) g[i] = if ((i / 97 + seed) % 5 == 0) (-1).toByte() else if (i % 211 == seed) 77 else 0
        return g
    }

    private fun tcp(port: Int): Endpoint = Endpoint("127.0.0.1", "127.0.0.1", Channel.KIND_WIFI, false) {
        SocketChannel(java.net.Socket("127.0.0.1", port), "127.0.0.1")
    }

    /** In-memory two-way pipe: behaves like a Bluetooth serial link (plain streams, no socket timeouts). */
    private class PipeChannel(
        override val input: InputStream,
        override val output: OutputStream,
        override val label: String,
        /** the far end's writer into our input: closing it too makes a blocked read here return, like closing a real socket does */
        private val feeder: OutputStream
    ) : Channel {
        override val kind: Int = Channel.KIND_BLUETOOTH
        @Volatile var closed = false
        override fun close() {
            closed = true
            try { output.close() } catch (e: Exception) {}
            try { feeder.close() } catch (e: Exception) {}
            try { input.close() } catch (e: Exception) {}
        }
    }

    /** Output that lets only so many bytes per second through (to imitate a slow radio link). */
    private class SlowOutput(private val inner: OutputStream, private val bytesPerSecond: Int) : OutputStream() {
        override fun write(b: Int) { inner.write(b) }
        override fun write(b: ByteArray, off: Int, len: Int) {
            var o = off
            var left = len
            while (left > 0) {
                val n = minOf(left, bytesPerSecond / 20)
                inner.write(b, o, n)
                inner.flush()
                o += n
                left -= n
                try { Thread.sleep(50) } catch (e: InterruptedException) { throw IOException("interrupted") }
            }
        }
        override fun flush() { inner.flush() }
        override fun close() { inner.close() }
    }

    private fun pipePair(phoneBytesPerSecond: Int = 0): Pair<PipeChannel, PipeChannel> {
        val p2gIn = PipedInputStream(1 shl 16)
        val p2gOut = PipedOutputStream(p2gIn)
        val g2pIn = PipedInputStream(1 shl 16)
        val g2pOut = PipedOutputStream(g2pIn)
        val phoneOut: OutputStream = if (phoneBytesPerSecond > 0) SlowOutput(p2gOut, phoneBytesPerSecond) else p2gOut
        return Pair(PipeChannel(g2pIn, phoneOut, "pipe-phone", g2pOut), PipeChannel(p2gIn, g2pOut, "pipe-glasses", p2gOut))
    }

    @Test
    fun frameCodec_roundTrip() {
        val g = picture(3)
        val enc = Protocol.encodeFrame(Protocol.Frame(Transform.MODE_PLAIN, 42, Layout.W, Layout.H, g))
        assertTrue(enc.size < g.size / 4, "a mostly black picture must compress well, got ${enc.size}")
        val f = Protocol.decodeFrame(enc)
        assertEquals(42, f.seq)
        assertEquals(Transform.MODE_PLAIN, f.mode)
        assertEquals(Layout.W, f.w)
        assertEquals(Layout.H, f.h)
        assertTrue(g.contentEquals(f.gray))
        val i = Protocol.decodeInput(Protocol.encodeInput(Protocol.Input(-2, Protocol.KIND_MOTION, true)))
        assertEquals(-2, i.code)
        assertEquals(Protocol.KIND_MOTION, i.kind)
        assertTrue(i.toggle)
    }

    @Test
    fun localAddressRules() {
        assertTrue(NetUtil.isLocalHostString("192.168.43.1"))
        assertTrue(NetUtil.isLocalHostString("10.0.0.7"))
        assertTrue(NetUtil.isLocalHostString("172.20.1.2"))
        assertTrue(NetUtil.isLocalHostString("127.0.0.1"))
        assertFalse(NetUtil.isLocalHostString("8.8.8.8"))
        assertFalse(NetUtil.isLocalHostString("172.32.0.1"))
        assertFalse(NetUtil.isLocalHostString("example.com"))
        assertFalse(NetUtil.isLocalHostString("192.168.1"))
        assertEquals("GMAP1|1234|47800", NetUtil.beaconText(1234, 47800))
        val b = NetUtil.parseBeacon("GMAP1|1234|47800")
        assertEquals(1234, b!![0])
        assertEquals(47800, b[1])
        assertEquals(null, NetUtil.parseBeacon("hello"))
        // the Wi-Fi endpoint itself refuses non-local addresses before any connection is made
        var refused = false
        try {
            NetUtil.tcpEndpoint("8.8.8.8", 47800).open()
        } catch (e: IOException) {
            refused = true
        }
        assertTrue(refused)
    }

    @Test
    fun wifi_roundTrip_frame_input_reconnect() {
        val glass = GlassSide()
        val server = GlassServer(0, 4321, glass, beacon = false)
        server.start()
        assertTrue(server.awaitBound(5000), "server did not open its port")
        val port = server.boundPort
        assertTrue(port > 0)

        val phone = PhoneSide(listOf(NetUtil.tcpEndpoint("8.8.8.8", port), tcp(port)), trust = true)
        val link = PhoneLink(phone)
        link.setShowKeys(false)
        link.start()
        try {
            assertTrue(waitUntil(5000) { phone.state == PhoneLink.ST_CONNECTED && glass.connected }, "no connection")
            assertEquals(4321, phone.seenId)
            assertEquals(Channel.KIND_WIFI, phone.kind)
            assertTrue(waitUntil(3000) { glass.showKeys == false }, "settings not delivered")

            // 1) picture phone -> glasses, byte for byte
            val p1 = picture(1)
            link.submitFrame(Transform.MODE_PLAIN, p1, Layout.W, Layout.H)
            assertTrue(waitUntil(5000) { glass.frames.size == 1 }, "frame not received")
            assertTrue(p1.contentEquals(glass.frames[0].gray))
            assertEquals(Transform.MODE_PLAIN, glass.frames[0].mode)
            assertTrue(waitUntil(3000) { phone.delivered.size == 1 }, "the glasses must confirm each picture")

            // 2) the same picture again is not resent, a mode change is
            link.submitFrame(Transform.MODE_PLAIN, p1.copyOf(), Layout.W, Layout.H)
            Thread.sleep(400)
            assertEquals(1, glass.frames.size)
            link.submitFrame(Transform.MODE_DARK, p1, Layout.W, Layout.H)
            assertTrue(waitUntil(5000) { glass.frames.size == 2 })
            assertEquals(Transform.MODE_DARK, glass.frames[1].mode)

            // 2b) "phone screen is off" reaches the glasses, and so does the all-clear
            link.setNotice(Protocol.NOTICE_SCREEN_OFF)
            assertTrue(waitUntil(3000) { glass.notices.lastOrNull() == Protocol.NOTICE_SCREEN_OFF }, "notice not delivered")
            link.setNotice(Protocol.NOTICE_NONE)
            assertTrue(waitUntil(3000) { glass.notices.lastOrNull() == Protocol.NOTICE_NONE }, "all-clear not delivered")
            link.setNotice(Protocol.NOTICE_SCREEN_OFF)
            assertTrue(waitUntil(3000) { glass.notices.lastOrNull() == Protocol.NOTICE_SCREEN_OFF })

            // 2c) "close the glasses app", asked on the phone, arrives (and the link itself stays as it is:
            //     it is the glasses app that closes, and with it the link)
            assertTrue(link.sendQuit(3000), "quit request was not written")
            assertTrue(waitUntil(3000) { glass.quits == 1 }, "quit request did not arrive")

            // 3) key press glasses -> phone
            assertTrue(server.sendInput(23, Protocol.KIND_KEY, true))
            assertTrue(waitUntil(5000) { phone.inputs.size == 1 }, "input not received")
            assertEquals(23, phone.inputs[0].code)
            assertTrue(phone.inputs[0].toggle)

            // 4) nothing to send for longer than the silence limit: heartbeats keep it up
            Thread.sleep(GlassServer.RX_TIMEOUT_MS + 1500L)
            assertTrue(glass.connected && phone.state == PhoneLink.ST_CONNECTED, "connection dropped while idle")

            // 4b) pictures flowing without any pause for longer than the silence limit: still the same connection
            val before = glass.frames.size
            val busyUntil = System.currentTimeMillis() + GlassServer.RX_TIMEOUT_MS + 2000L
            var k = 10
            while (System.currentTimeMillis() < busyUntil) {
                link.submitFrame(Transform.MODE_DARK, picture(k++ % 200), Layout.W, Layout.H)
                Thread.sleep(60)
            }
            assertTrue(glass.connected && phone.state == PhoneLink.ST_CONNECTED, "connection dropped while pictures were flowing")
            assertEquals(1, glass.connects, "must be the same connection all along")
            assertTrue(glass.frames.size - before > 20, "pictures should keep arriving")
            link.submitFrame(Transform.MODE_DARK, p1, Layout.W, Layout.H)
            Thread.sleep(500)

            // 5) glasses app goes away -> phone notices -> comes back -> phone reconnects and shows the last picture again
            server.stop()
            assertTrue(waitUntil(8000) { phone.state == PhoneLink.ST_SEARCHING }, "phone did not notice the loss")
            val glass2 = GlassSide()
            val server2 = GlassServer(port, 4321, glass2, beacon = false)
            server2.start()
            try {
                assertTrue(server2.awaitBound(8000), "second server did not open its port")
                assertTrue(waitUntil(10000) { phone.state == PhoneLink.ST_CONNECTED && glass2.connected }, "no reconnect")
                assertTrue(waitUntil(5000) { glass2.frames.size >= 1 }, "last picture not resent after reconnect")
                assertTrue(p1.contentEquals(glass2.frames[0].gray))
                assertEquals(Transform.MODE_DARK, glass2.frames[0].mode)
                // the notice that was in force is told again to the glasses app that just came back
                assertTrue(waitUntil(3000) { glass2.notices.lastOrNull() == Protocol.NOTICE_SCREEN_OFF }, "notice not repeated after reconnect")
            } finally {
                server2.stop()
            }
        } finally {
            link.stop()
            server.stop()
        }
    }

    @Test
    fun wifi_untrustedGlasses_getNoPicture() {
        val glass = GlassSide()
        val server = GlassServer(0, 9999, glass, beacon = false)
        server.start()
        assertTrue(server.awaitBound(5000))
        val phone = PhoneSide(listOf(tcp(server.boundPort)), trust = false)
        val link = PhoneLink(phone)
        link.start()
        try {
            link.submitFrame(Transform.MODE_PLAIN, picture(2), Layout.W, Layout.H)
            assertTrue(waitUntil(5000) { phone.state == PhoneLink.ST_WAIT_TRUST }, "phone should wait for confirmation")
            assertEquals(9999, phone.seenId)
            Thread.sleep(1500)
            assertEquals(0, glass.frames.size)
            assertFalse(glass.connected)
            // user confirms -> picture flows
            phone.trust = true
            assertTrue(waitUntil(6000) { glass.frames.size == 1 }, "picture should arrive after confirmation")
        } finally {
            link.stop()
            server.stop()
        }
    }

    @Test
    fun wifi_probeDoesNotKickTheRealPhone() {
        val glass = GlassSide()
        val server = GlassServer(0, 1111, glass, beacon = false)
        server.start()
        assertTrue(server.awaitBound(5000))
        val phone = PhoneSide(listOf(tcp(server.boundPort)), trust = true)
        val link = PhoneLink(phone)
        link.start()
        try {
            assertTrue(waitUntil(5000) { glass.connected })
            val done = CountDownLatch(1)
            Thread {
                try {
                    java.net.Socket("127.0.0.1", server.boundPort).use { s ->
                        val h = Protocol.readHello(java.io.DataInputStream(s.getInputStream()))
                        assertEquals(Protocol.ROLE_GLASSES, h.role)
                    }
                } finally {
                    done.countDown()
                }
            }.start()
            assertTrue(done.await(5, TimeUnit.SECONDS))
            Thread.sleep(500)
            assertTrue(glass.connected, "a probe must not kick the real phone out")
            assertEquals(1, glass.connects)
        } finally {
            link.stop()
            server.stop()
        }
    }

    /**
     * The Bluetooth path, minus the radio: the same sender/receiver over plain streams without
     * any socket behind them, paired = no confirmation step, no TCP listener on the glasses side.
     */
    @Test
    fun serialPipe_roundTrip_pairedDeviceNeedsNoConfirmation() {
        val glass = GlassSide()
        val server = GlassServer(0, 2468, glass, beacon = false, tcp = false)
        server.start()
        val opens = AtomicInteger(0)
        val ep = Endpoint("Glasses (test)", "AA:BB", Channel.KIND_BLUETOOTH, true) {
            opens.incrementAndGet()
            val (phoneEnd, glassEnd) = pipePair()
            thread(isDaemon = true) { server.serve(glassEnd) }
            phoneEnd
        }
        val phone = PhoneSide(listOf(ep), trust = false)
        val link = PhoneLink(phone)
        link.start()
        try {
            assertTrue(waitUntil(5000) { phone.state == PhoneLink.ST_CONNECTED && glass.connected }, "no connection over the pipe")
            assertEquals(Channel.KIND_BLUETOOTH, phone.kind)
            assertEquals(Channel.KIND_BLUETOOTH, glass.kind)
            assertFalse(phone.states.contains(PhoneLink.ST_WAIT_TRUST), "a paired device must not ask for confirmation")
            val p = picture(7)
            link.submitFrame(Transform.MODE_PLAIN, p, Layout.W, Layout.H)
            assertTrue(waitUntil(5000) { glass.frames.size == 1 })
            assertTrue(p.contentEquals(glass.frames[0].gray))
            assertTrue(server.sendInput(66, Protocol.KIND_KEY, true))
            assertTrue(waitUntil(5000) { phone.inputs.size == 1 })
            // idle longer than the silence limit: heartbeats in both directions keep the pipe open
            Thread.sleep(GlassServer.RX_TIMEOUT_MS + 1500L)
            assertTrue(glass.connected && phone.state == PhoneLink.ST_CONNECTED, "pipe dropped while idle")
            assertEquals(1, opens.get())
        } finally {
            link.stop()
            server.stop()
        }
    }

    /** A slow link (about 20 KB/s): pictures still arrive whole, newer ones replace waiting ones, the link stays up. */
    @Test
    fun serialPipe_slowLink_keepsNewestPicture_andStaysConnected() {
        val glass = GlassSide()
        val server = GlassServer(0, 1357, glass, beacon = false, tcp = false)
        server.start()
        val ep = Endpoint("Glasses (slow)", "AA:CC", Channel.KIND_BLUETOOTH, true) {
            val (phoneEnd, glassEnd) = pipePair(phoneBytesPerSecond = 20000)
            thread(isDaemon = true) { server.serve(glassEnd) }
            phoneEnd
        }
        val phone = PhoneSide(listOf(ep), trust = false)
        val link = PhoneLink(phone)
        link.start()
        try {
            assertTrue(waitUntil(5000) { phone.state == PhoneLink.ST_CONNECTED && glass.connected })
            // a "map view" sized picture: noisy enough to compress to roughly 20 KB, i.e. about one second on this link
            val rnd = java.util.Random(5)
            fun noisy(): ByteArray {
                val g = ByteArray(Layout.W * Layout.H)
                var i = 0
                while (i < g.size) {
                    g[i] = ((rnd.nextInt(16)) * 17).toByte()
                    i += 10
                }
                return g
            }
            val size = Protocol.encodeFrame(Protocol.Frame(Transform.MODE_DARK, 1, Layout.W, Layout.H, noisy())).size
            assertTrue(size in 10000..40000, "test picture should be map-view sized, got $size bytes")
            var lastSent: ByteArray? = null
            val until = System.currentTimeMillis() + 12000
            var submitted = 0
            while (System.currentTimeMillis() < until) {
                val g = noisy()
                lastSent = g
                link.submitFrame(Transform.MODE_DARK, g, Layout.W, Layout.H)
                submitted++
                Thread.sleep(125)
            }
            assertTrue(glass.connected && phone.state == PhoneLink.ST_CONNECTED, "slow link was dropped")
            assertEquals(1, glass.connects)
            assertTrue(waitUntil(15000) { glass.frames.isNotEmpty() && glass.frames.last().gray.contentEquals(lastSent!!) }, "the newest picture must arrive in the end")
            val arrived = glass.frames.size
            assertTrue(arrived in 1 until submitted, "older waiting pictures are skipped on a slow link (submitted=$submitted arrived=$arrived)")
            // every picture was confirmed, and the measured times are those of a slow link:
            // this is what lets the app send less detail by itself
            assertTrue(waitUntil(3000) { phone.delivered.size == arrived }, "confirmed=${phone.delivered.size} arrived=$arrived")
            val typical = phone.delivered.sorted()[phone.delivered.size / 2]
            assertTrue(typical > 300, "a ~20 KB picture on a 20 KB/s link takes around a second, measured $typical ms")
            val gov = QualityGovernor()
            for (ms in phone.delivered) gov.onDelivered(ms)
            assertTrue(gov.level >= 1, "the governor must ask for less detail on this link")
            for (f in glass.frames) assertEquals(Layout.W * Layout.H, f.gray.size)
        } finally {
            link.stop()
            server.stop()
        }
    }

    /** The other end stops answering without closing (radio out of range): both sides let go and the phone tries again. */
    @Test
    fun serialPipe_silentPeer_isDropped_andPhoneRetries() {
        val opens = AtomicInteger(0)
        val handed = CopyOnWriteArrayList<PipeChannel>()
        val ep = Endpoint("Silent", "AA:DD", Channel.KIND_BLUETOOTH, true) {
            opens.incrementAndGet()
            val (phoneEnd, _) = pipePair()   // nobody serves the other end
            handed.add(phoneEnd)
            phoneEnd
        }
        val phone = PhoneSide(listOf(ep), trust = false)
        val link = PhoneLink(phone)
        link.start()
        try {
            assertTrue(waitUntil(PhoneLink.RX_TIMEOUT_MS + 4000) { handed.isNotEmpty() && handed[0].closed }, "silent pipe was not closed")
            assertTrue(waitUntil(6000) { opens.get() >= 2 }, "phone should try again")
            assertFalse(phone.states.contains(PhoneLink.ST_CONNECTED))
        } finally {
            link.stop()
        }

        // glasses side: a phone that connects and then goes silent is let go
        val glass = GlassSide()
        val server = GlassServer(0, 1, glass, beacon = false, tcp = false)
        server.start()
        val (phoneEnd, glassEnd) = pipePair()
        val served = CountDownLatch(1)
        thread(isDaemon = true) {
            server.serve(glassEnd)
            served.countDown()
        }
        try {
            val dout = java.io.DataOutputStream(phoneEnd.output)
            val din = java.io.DataInputStream(phoneEnd.input)
            assertEquals(Protocol.ROLE_GLASSES, Protocol.readHello(din).role)
            Protocol.writeHello(dout, Protocol.ROLE_PHONE, 0)
            assertTrue(waitUntil(3000) { glass.connected })
            // ... and now say nothing
            assertTrue(served.await(GlassServer.RX_TIMEOUT_MS + 4000, TimeUnit.MILLISECONDS), "glasses side kept a silent phone")
            assertFalse(glass.connected)
        } finally {
            phoneEnd.close()
            server.stop()
        }
    }

    /** A glasses app from before v0.3 does not confirm pictures. Sending must go on regardless. */
    @Test
    fun peerWithoutConfirmations_stillGetsPictures() {
        val (phoneEnd, glassEnd) = pipePair()
        val got = AtomicInteger(0)
        val t = thread(isDaemon = true) {
            try {
                val din = java.io.DataInputStream(glassEnd.input)
                val dout = java.io.DataOutputStream(glassEnd.output)
                Protocol.writeHello(dout, Protocol.ROLE_GLASSES, 77)
                Protocol.readHello(din)
                var lastBeat = 0L
                while (true) {
                    val msg = Protocol.readMessage(din)
                    if (msg.first == Protocol.T_FRAME) got.incrementAndGet()
                    val now = System.currentTimeMillis()
                    if (now - lastBeat > 1000) {
                        Protocol.writeMessage(dout, Protocol.T_PONG, Protocol.EMPTY)   // heartbeat only, never T_ACK
                        lastBeat = now
                    }
                }
            } catch (e: Exception) {
            }
        }
        val opened = AtomicInteger(0)
        val ep = Endpoint("old glasses app", "AA:EE", Channel.KIND_BLUETOOTH, true) {
            if (opened.incrementAndGet() > 1) throw IOException("only once")
            phoneEnd
        }
        val phone = PhoneSide(listOf(ep), trust = false)
        val link = PhoneLink(phone)
        link.start()
        try {
            assertTrue(waitUntil(5000) { phone.state == PhoneLink.ST_CONNECTED })
            val until = System.currentTimeMillis() + 2 * PhoneLink.ACK_TIMEOUT_MS + 5000
            var k = 0
            while (System.currentTimeMillis() < until) {
                link.submitFrame(Transform.MODE_PLAIN, picture(k++ % 200), Layout.W, Layout.H)
                Thread.sleep(100)
            }
            // the first two wait out the confirmation time, after that pictures flow freely
            assertTrue(got.get() > 20, "pictures must keep flowing to a peer that never confirms, got ${got.get()}")
            assertEquals(0, phone.delivered.size)
            assertEquals(PhoneLink.ST_CONNECTED, phone.state)
        } finally {
            link.stop()
            phoneEnd.close()
            glassEnd.close()
        }
    }

    /** Without a connection there is nothing to send the quit request over: say so quickly, do not hang. */
    @Test
    fun quitWithoutConnection_returnsFalse() {
        val phone = PhoneSide(emptyList(), trust = true)
        val link = PhoneLink(phone)
        link.start()
        try {
            val t0 = System.currentTimeMillis()
            assertFalse(link.sendQuit(800))
            assertTrue(System.currentTimeMillis() - t0 < 3000)
        } finally {
            link.stop()
        }
    }
}

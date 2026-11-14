/* qpdf-wasm 연결부(자바스크립트) — @neslinesli93/qpdf-wasm v0.3.0 의 dist/qpdf.js 를 「수정 없이」 그대로 옮기고
 * 바깥에서 쓸 이름(window.SOQpdfFactory)만 붙인 파일입니다. 같이 있는 qpdf.wasm 을 불러 돌립니다.
 * 라이선스: qpdf = Apache-2.0, 웹어셈블리 빌드·연결부 = ISC (NOTICE-qpdf.txt, LICENSE-qpdf-wasm-ISC.txt 참고).
 * 이 파일을 고친 곳: 맨 위·맨 아래의 이 설명과 이름 붙이는 두 줄뿐(코드는 그대로). */
(function (global) {
    var Module = (() => {
      var _scriptName = typeof document != "undefined" ? document.currentScript?.src : void 0;
      if (typeof __filename != "undefined") _scriptName = _scriptName || __filename;
      return (function(moduleArg = {}) {
        var moduleRtn;
        var f = moduleArg, aa, ba, ca = new Promise((a, b2) => {
          aa = a;
          ba = b2;
        }), da = "object" == typeof window, ea = "undefined" != typeof WorkerGlobalScope, fa = "object" == typeof process && "object" == typeof process.versions && "string" == typeof process.versions.node && "renderer" != process.type;
        f.noInitialRun = true;
        var ha = Object.assign({}, f), ia = [], ja5 = "./this.program", ka = (a, b2) => {
          throw b2;
        }, p = "", la, ma;
        if (fa) {
          var fs = require("fs");
          require("path");
          p = __dirname + "/";
          ma = (a) => {
            a = na(a) ? new URL(a) : a;
            return fs.readFileSync(a);
          };
          la = async (a) => {
            a = na(a) ? new URL(a) : a;
            return fs.readFileSync(a, void 0);
          };
          !f.thisProgram && 1 < process.argv.length && (ja5 = process.argv[1].replace(/\\/g, "/"));
          ia = process.argv.slice(2);
          ka = (a, b2) => {
            process.exitCode = a;
            throw b2;
          };
        } else if (da || ea) ea ? p = self.location.href : "undefined" != typeof document && document.currentScript && (p = document.currentScript.src), _scriptName && (p = _scriptName), p.startsWith("blob:") ? p = "" : p = p.substr(0, p.replace(/[?#].*/, "").lastIndexOf("/") + 1), ea && (ma = (a) => {
          var b2 = new XMLHttpRequest();
          b2.open("GET", a, false);
          b2.responseType = "arraybuffer";
          b2.send(null);
          return new Uint8Array(b2.response);
        }), la = async (a) => {
          if (na(a)) return new Promise((c, d) => {
            var e = new XMLHttpRequest();
            e.open("GET", a, true);
            e.responseType = "arraybuffer";
            e.onload = () => {
              200 == e.status || 0 == e.status && e.response ? c(e.response) : d(e.status);
            };
            e.onerror = d;
            e.send(null);
          });
          var b2 = await fetch(a, { credentials: "same-origin" });
          if (b2.ok) return b2.arrayBuffer();
          throw Error(b2.status + " : " + b2.url);
        };
        var oa = console.log.bind(console), r = console.error.bind(console);
        Object.assign(f, ha);
        ha = null;
        var pa, qa = false, ra, u3, w2, sa, x2, y2, z3;
        function ta() {
          var a = pa.buffer;
          f.HEAP8 = u3 = new Int8Array(a);
          f.HEAP16 = sa = new Int16Array(a);
          f.HEAPU8 = w2 = new Uint8Array(a);
          f.HEAPU16 = new Uint16Array(a);
          f.HEAP32 = x2 = new Int32Array(a);
          f.HEAPU32 = y2 = new Uint32Array(a);
          f.HEAPF32 = new Float32Array(a);
          f.HEAPF64 = new Float64Array(a);
          f.HEAP64 = z3 = new BigInt64Array(a);
          f.HEAPU64 = new BigUint64Array(a);
        }
        var ua = [], va = [], wa = [], xa = [], ya = 0, za = null;
        function Aa() {
          ya--;
          if (0 == ya && za) {
            var a = za;
            za = null;
            a();
          }
        }
        function A(a) {
          a = "Aborted(" + a + ")";
          r(a);
          qa = true;
          a = new WebAssembly.RuntimeError(a + ". Build with -sASSERTIONS for more info.");
          ba(a);
          throw a;
        }
        var Ba = (a) => a.startsWith("data:application/octet-stream;base64,"), na = (a) => a.startsWith("file://"), Ca;
        async function Da(a) {
          try {
            var b2 = await la(a);
            return new Uint8Array(b2);
          } catch {
          }
          if (ma) a = ma(a);
          else throw "both async and sync fetching of the wasm failed";
          return a;
        }
        async function Ea(a, b2) {
          try {
            var c = await Da(a);
            return await WebAssembly.instantiate(c, b2);
          } catch (d) {
            r(`failed to asynchronously prepare wasm: ${d}`), A(d);
          }
        }
        async function Fa(a) {
          var b2 = Ca;
          if (!("function" != typeof WebAssembly.instantiateStreaming || Ba(b2) || na(b2) || fa) && "function" == typeof fetch) try {
            var c = fetch(b2, { credentials: "same-origin" });
            return await WebAssembly.instantiateStreaming(c, a);
          } catch (d) {
            r(`wasm streaming compile failed: ${d}`), r("falling back to ArrayBuffer instantiation");
          }
          return Ea(b2, a);
        }
        class Ga {
          name = "ExitStatus";
          constructor(a) {
            this.message = `Program terminated with exit(${a})`;
            this.status = a;
          }
        }
        var Ha = (a) => {
          for (; 0 < a.length; ) a.shift()(f);
        }, Ia = "undefined" != typeof TextDecoder ? new TextDecoder() : void 0, B2 = (a, b2 = 0) => {
          for (var c = b2 + NaN, d = b2; a[d] && !(d >= c); ) ++d;
          if (16 < d - b2 && a.buffer && Ia) return Ia.decode(a.subarray(b2, d));
          for (c = ""; b2 < d; ) {
            var e = a[b2++];
            if (e & 128) {
              var g2 = a[b2++] & 63;
              if (192 == (e & 224)) c += String.fromCharCode((e & 31) << 6 | g2);
              else {
                var h3 = a[b2++] & 63;
                e = 224 == (e & 240) ? (e & 15) << 12 | g2 << 6 | h3 : (e & 7) << 18 | g2 << 12 | h3 << 6 | a[b2++] & 63;
                65536 > e ? c += String.fromCharCode(e) : (e -= 65536, c += String.fromCharCode(55296 | e >> 10, 56320 | e & 1023));
              }
            } else c += String.fromCharCode(e);
          }
          return c;
        }, Ja = [], Ka = 0, D4 = 0;
        class La {
          constructor(a) {
            this.nb = a;
            this.wa = a - 24;
          }
          Pa(a, b2) {
            y2[this.wa + 16 >> 2] = 0;
            y2[this.wa + 4 >> 2] = a;
            y2[this.wa + 8 >> 2] = b2;
          }
        }
        var Oa = (a) => {
          var b2 = D4;
          if (!b2) return Ma(0), 0;
          var c = new La(b2);
          y2[c.wa + 16 >> 2] = b2;
          var d = y2[c.wa + 4 >> 2];
          if (!d) return Ma(0), b2;
          for (var e of a) {
            if (0 === e || e === d) break;
            if (Na(e, d, c.wa + 16)) return Ma(e), b2;
          }
          Ma(d);
          return b2;
        }, E2 = () => {
          var a = x2[+Pa >> 2];
          Pa += 4;
          return a;
        }, Qa = (a, b2) => {
          for (var c = 0, d = a.length - 1; 0 <= d; d--) {
            var e = a[d];
            "." === e ? a.splice(d, 1) : ".." === e ? (a.splice(d, 1), c++) : c && (a.splice(d, 1), c--);
          }
          if (b2) for (; c; c--) a.unshift("..");
          return a;
        }, F2 = (a) => {
          var b2 = "/" === a.charAt(0), c = "/" === a.substr(-1);
          (a = Qa(a.split("/").filter((d) => !!d), !b2).join("/")) || b2 || (a = ".");
          a && c && (a += "/");
          return (b2 ? "/" : "") + a;
        }, Ra = (a) => {
          var b2 = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(a).slice(1);
          a = b2[0];
          b2 = b2[1];
          if (!a && !b2) return ".";
          b2 &&= b2.substr(0, b2.length - 1);
          return a + b2;
        }, Sa = (a) => {
          if ("/" === a) return "/";
          a = F2(a);
          a = a.replace(/\/$/, "");
          var b2 = a.lastIndexOf("/");
          return -1 === b2 ? a : a.substr(b2 + 1);
        }, Ua = (...a) => F2(a.join("/")), Va = (a, b2) => F2(a + "/" + b2), Wa = () => {
          if ("object" == typeof crypto && "function" == typeof crypto.getRandomValues) return (c) => crypto.getRandomValues(c);
          if (fa) try {
            var a = require("crypto");
            if (a.randomFillSync) return (c) => a.randomFillSync(c);
            var b2 = a.randomBytes;
            return (c) => (c.set(b2(c.byteLength)), c);
          } catch (c) {
          }
          A("initRandomDevice");
        }, Xa = (a) => (Xa = Wa())(a), Ya = (...a) => {
          for (var b2 = "", c = false, d = a.length - 1; -1 <= d && !c; d--) {
            c = 0 <= d ? a[d] : G2.cwd();
            if ("string" != typeof c) throw new TypeError("Arguments to path.resolve must be strings");
            if (!c) return "";
            b2 = c + "/" + b2;
            c = "/" === c.charAt(0);
          }
          b2 = Qa(b2.split("/").filter((e) => !!e), !c).join("/");
          return (c ? "/" : "") + b2 || ".";
        }, Za = (a, b2) => {
          function c(h3) {
            for (var k2 = 0; k2 < h3.length && "" === h3[k2]; k2++) ;
            for (var m2 = h3.length - 1; 0 <= m2 && "" === h3[m2]; m2--) ;
            return k2 > m2 ? [] : h3.slice(k2, m2 - k2 + 1);
          }
          a = Ya(a).substr(1);
          b2 = Ya(b2).substr(1);
          a = c(a.split("/"));
          b2 = c(b2.split("/"));
          for (var d = Math.min(a.length, b2.length), e = d, g2 = 0; g2 < d; g2++) if (a[g2] !== b2[g2]) {
            e = g2;
            break;
          }
          d = [];
          for (g2 = e; g2 < a.length; g2++) d.push("..");
          d = d.concat(b2.slice(e));
          return d.join("/");
        }, $a = [], ab = (a) => {
          for (var b2 = 0, c = 0; c < a.length; ++c) {
            var d = a.charCodeAt(c);
            127 >= d ? b2++ : 2047 >= d ? b2 += 2 : 55296 <= d && 57343 >= d ? (b2 += 4, ++c) : b2 += 3;
          }
          return b2;
        }, bb = (a, b2, c, d) => {
          if (!(0 < d)) return 0;
          var e = c;
          d = c + d - 1;
          for (var g2 = 0; g2 < a.length; ++g2) {
            var h3 = a.charCodeAt(g2);
            if (55296 <= h3 && 57343 >= h3) {
              var k2 = a.charCodeAt(++g2);
              h3 = 65536 + ((h3 & 1023) << 10) | k2 & 1023;
            }
            if (127 >= h3) {
              if (c >= d) break;
              b2[c++] = h3;
            } else {
              if (2047 >= h3) {
                if (c + 1 >= d) break;
                b2[c++] = 192 | h3 >> 6;
              } else {
                if (65535 >= h3) {
                  if (c + 2 >= d) break;
                  b2[c++] = 224 | h3 >> 12;
                } else {
                  if (c + 3 >= d) break;
                  b2[c++] = 240 | h3 >> 18;
                  b2[c++] = 128 | h3 >> 12 & 63;
                }
                b2[c++] = 128 | h3 >> 6 & 63;
              }
              b2[c++] = 128 | h3 & 63;
            }
          }
          b2[c] = 0;
          return c - e;
        };
        function cb(a) {
          var b2 = Array(ab(a) + 1);
          a = bb(a, b2, 0, b2.length);
          b2.length = a;
          return b2;
        }
        var db = [];
        function eb(a, b2) {
          db[a] = { input: [], output: [], Ea: b2 };
          fb(a, gb);
        }
        var gb = { open(a) {
          var b2 = db[a.node.rdev];
          if (!b2) throw new G2.oa(43);
          a.tty = b2;
          a.seekable = false;
        }, close(a) {
          a.tty.Ea.fsync(a.tty);
        }, fsync(a) {
          a.tty.Ea.fsync(a.tty);
        }, read(a, b2, c, d) {
          if (!a.tty || !a.tty.Ea.pb) throw new G2.oa(60);
          for (var e = 0, g2 = 0; g2 < d; g2++) {
            try {
              var h3 = a.tty.Ea.pb(a.tty);
            } catch (k2) {
              throw new G2.oa(29);
            }
            if (void 0 === h3 && 0 === e) throw new G2.oa(6);
            if (null === h3 || void 0 === h3) break;
            e++;
            b2[c + g2] = h3;
          }
          e && (a.node.atime = Date.now());
          return e;
        }, write(a, b2, c, d) {
          if (!a.tty || !a.tty.Ea.eb) throw new G2.oa(60);
          try {
            for (var e = 0; e < d; e++) a.tty.Ea.eb(
              a.tty,
              b2[c + e]
            );
          } catch (g2) {
            throw new G2.oa(29);
          }
          d && (a.node.mtime = a.node.ctime = Date.now());
          return e;
        } }, hb = { pb() {
          a: {
            if (!$a.length) {
              var a = null;
              if (fa) {
                var b2 = Buffer.alloc(256), c = 0, d = process.stdin.fd;
                try {
                  c = fs.readSync(d, b2, 0, 256);
                } catch (e) {
                  if (e.toString().includes("EOF")) c = 0;
                  else throw e;
                }
                0 < c && (a = b2.slice(0, c).toString("utf-8"));
              } else "undefined" != typeof window && "function" == typeof window.prompt && (a = window.prompt("Input: "), null !== a && (a += "\n"));
              if (!a) {
                a = null;
                break a;
              }
              $a = cb(a);
            }
            a = $a.shift();
          }
          return a;
        }, eb(a, b2) {
          null === b2 || 10 === b2 ? (oa(B2(a.output)), a.output = []) : 0 != b2 && a.output.push(b2);
        }, fsync(a) {
          a.output && 0 < a.output.length && (oa(B2(a.output)), a.output = []);
        }, Lb() {
          return { Yb: 25856, $b: 5, Xb: 191, Zb: 35387, Wb: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        }, Mb() {
          return 0;
        }, Nb() {
          return [24, 80];
        } }, ib = { eb(a, b2) {
          null === b2 || 10 === b2 ? (r(B2(a.output)), a.output = []) : 0 != b2 && a.output.push(b2);
        }, fsync(a) {
          a.output && 0 < a.output.length && (r(B2(a.output)), a.output = []);
        } };
        function jb(a, b2) {
          var c = a.ra ? a.ra.length : 0;
          c >= b2 || (b2 = Math.max(b2, c * (1048576 > c ? 2 : 1.125) >>> 0), 0 != c && (b2 = Math.max(b2, 256)), c = a.ra, a.ra = new Uint8Array(b2), 0 < a.ta && a.ra.set(c.subarray(0, a.ta), 0));
        }
        var H2 = { Da: null, sa() {
          return H2.createNode(null, "/", 16895, 0);
        }, createNode(a, b2, c, d) {
          if (24576 === (c & 61440) || G2.isFIFO(c)) throw new G2.oa(63);
          H2.Da || (H2.Da = { dir: { node: { ya: H2.pa.ya, ua: H2.pa.ua, lookup: H2.pa.lookup, Aa: H2.pa.Aa, rename: H2.pa.rename, unlink: H2.pa.unlink, rmdir: H2.pa.rmdir, readdir: H2.pa.readdir, symlink: H2.pa.symlink }, stream: { va: H2.qa.va } }, file: { node: { ya: H2.pa.ya, ua: H2.pa.ua }, stream: { va: H2.qa.va, read: H2.qa.read, write: H2.qa.write, Oa: H2.qa.Oa, Ia: H2.qa.Ia, La: H2.qa.La } }, link: {
            node: { ya: H2.pa.ya, ua: H2.pa.ua, readlink: H2.pa.readlink },
            stream: {}
          }, jb: { node: { ya: H2.pa.ya, ua: H2.pa.ua }, stream: G2.Db } });
          c = G2.createNode(a, b2, c, d);
          J2(c.mode) ? (c.pa = H2.Da.dir.node, c.qa = H2.Da.dir.stream, c.ra = {}) : G2.isFile(c.mode) ? (c.pa = H2.Da.file.node, c.qa = H2.Da.file.stream, c.ta = 0, c.ra = null) : 40960 === (c.mode & 61440) ? (c.pa = H2.Da.link.node, c.qa = H2.Da.link.stream) : 8192 === (c.mode & 61440) && (c.pa = H2.Da.jb.node, c.qa = H2.Da.jb.stream);
          c.atime = c.mtime = c.ctime = Date.now();
          a && (a.ra[b2] = c, a.atime = a.mtime = a.ctime = c.atime);
          return c;
        }, hc(a) {
          return a.ra ? a.ra.subarray ? a.ra.subarray(0, a.ta) : new Uint8Array(a.ra) : new Uint8Array(0);
        }, pa: { ya(a) {
          var b2 = {};
          b2.dev = 8192 === (a.mode & 61440) ? a.id : 1;
          b2.ino = a.id;
          b2.mode = a.mode;
          b2.nlink = 1;
          b2.uid = 0;
          b2.gid = 0;
          b2.rdev = a.rdev;
          J2(a.mode) ? b2.size = 4096 : G2.isFile(a.mode) ? b2.size = a.ta : 40960 === (a.mode & 61440) ? b2.size = a.link.length : b2.size = 0;
          b2.atime = new Date(a.atime);
          b2.mtime = new Date(a.mtime);
          b2.ctime = new Date(a.ctime);
          b2.Fa = 4096;
          b2.blocks = Math.ceil(b2.size / b2.Fa);
          return b2;
        }, ua(a, b2) {
          for (var c of ["mode", "atime", "mtime", "ctime"]) b2[c] && (a[c] = b2[c]);
          void 0 !== b2.size && (b2 = b2.size, a.ta != b2 && (0 == b2 ? (a.ra = null, a.ta = 0) : (c = a.ra, a.ra = new Uint8Array(b2), c && a.ra.set(c.subarray(0, Math.min(b2, a.ta))), a.ta = b2)));
        }, lookup() {
          throw H2.mb;
        }, Aa(a, b2, c, d) {
          return H2.createNode(a, b2, c, d);
        }, rename(a, b2, c) {
          try {
            var d = M3(b2, c);
          } catch (g2) {
          }
          if (d) {
            if (J2(a.mode)) for (var e in d.ra) throw new G2.oa(55);
            kb(d);
          }
          delete a.parent.ra[a.name];
          b2.ra[c] = a;
          a.name = c;
          b2.ctime = b2.mtime = a.parent.ctime = a.parent.mtime = Date.now();
        }, unlink(a, b2) {
          delete a.ra[b2];
          a.ctime = a.mtime = Date.now();
        }, rmdir(a, b2) {
          var c = M3(a, b2), d;
          for (d in c.ra) throw new G2.oa(55);
          delete a.ra[b2];
          a.ctime = a.mtime = Date.now();
        }, readdir(a) {
          return [".", "..", ...Object.keys(a.ra)];
        }, symlink(a, b2, c) {
          a = H2.createNode(a, b2, 41471, 0);
          a.link = c;
          return a;
        }, readlink(a) {
          if (40960 !== (a.mode & 61440)) throw new G2.oa(28);
          return a.link;
        } }, qa: { read(a, b2, c, d, e) {
          var g2 = a.node.ra;
          if (e >= a.node.ta) return 0;
          a = Math.min(a.node.ta - e, d);
          if (8 < a && g2.subarray) b2.set(g2.subarray(e, e + a), c);
          else for (d = 0; d < a; d++) b2[c + d] = g2[e + d];
          return a;
        }, write(a, b2, c, d, e, g2) {
          b2.buffer === u3.buffer && (g2 = false);
          if (!d) return 0;
          a = a.node;
          a.mtime = a.ctime = Date.now();
          if (b2.subarray && (!a.ra || a.ra.subarray)) {
            if (g2) return a.ra = b2.subarray(c, c + d), a.ta = d;
            if (0 === a.ta && 0 === e) return a.ra = b2.slice(c, c + d), a.ta = d;
            if (e + d <= a.ta) return a.ra.set(b2.subarray(c, c + d), e), d;
          }
          jb(a, e + d);
          if (a.ra.subarray && b2.subarray) a.ra.set(b2.subarray(c, c + d), e);
          else for (g2 = 0; g2 < d; g2++) a.ra[e + g2] = b2[c + g2];
          a.ta = Math.max(a.ta, e + d);
          return d;
        }, va(a, b2, c) {
          1 === c ? b2 += a.position : 2 === c && G2.isFile(a.node.mode) && (b2 += a.node.ta);
          if (0 > b2) throw new G2.oa(28);
          return b2;
        }, Oa(a, b2, c) {
          jb(a.node, b2 + c);
          a.node.ta = Math.max(a.node.ta, b2 + c);
        }, Ia(a, b2, c, d, e) {
          if (!G2.isFile(a.node.mode)) throw new G2.oa(43);
          a = a.node.ra;
          if (e & 2 || !a || a.buffer !== u3.buffer) {
            d = true;
            A();
            e = void 0;
            if (!e) throw new G2.oa(48);
            if (a) {
              if (0 < c || c + b2 < a.length) a.subarray ? a = a.subarray(c, c + b2) : a = Array.prototype.slice.call(a, c, c + b2);
              u3.set(a, e);
            }
          } else d = false, e = a.byteOffset;
          return { wa: e, Ab: d };
        }, La(a, b2, c, d) {
          H2.qa.write(a, b2, 0, d, c, false);
          return 0;
        } } }, lb = async (a) => {
          a = await la(a);
          return new Uint8Array(a);
        }, mb = [], nb = (a, b2, c, d) => {
          "undefined" != typeof Browser && Browser.Pa();
          var e = false;
          mb.forEach((g2) => {
            !e && g2.canHandle(b2) && (g2.handle(a, b2, c, d), e = true);
          });
          return e;
        }, ob = (a, b2) => {
          var c = 0;
          a && (c |= 365);
          b2 && (c |= 146);
          return c;
        }, pb = {
          EPERM: 63,
          ENOENT: 44,
          ESRCH: 71,
          EINTR: 27,
          EIO: 29,
          ENXIO: 60,
          E2BIG: 1,
          ENOEXEC: 45,
          EBADF: 8,
          ECHILD: 12,
          EAGAIN: 6,
          EWOULDBLOCK: 6,
          ENOMEM: 48,
          EACCES: 2,
          EFAULT: 21,
          ENOTBLK: 105,
          EBUSY: 10,
          EEXIST: 20,
          EXDEV: 75,
          ENODEV: 43,
          ENOTDIR: 54,
          EISDIR: 31,
          EINVAL: 28,
          ENFILE: 41,
          EMFILE: 33,
          ENOTTY: 59,
          ETXTBSY: 74,
          EFBIG: 22,
          ENOSPC: 51,
          ESPIPE: 70,
          EROFS: 69,
          EMLINK: 34,
          EPIPE: 64,
          EDOM: 18,
          ERANGE: 68,
          ENOMSG: 49,
          EIDRM: 24,
          ECHRNG: 106,
          EL2NSYNC: 156,
          EL3HLT: 107,
          EL3RST: 108,
          ELNRNG: 109,
          EUNATCH: 110,
          ENOCSI: 111,
          EL2HLT: 112,
          EDEADLK: 16,
          ENOLCK: 46,
          EBADE: 113,
          EBADR: 114,
          EXFULL: 115,
          ENOANO: 104,
          EBADRQC: 103,
          EBADSLT: 102,
          EDEADLOCK: 16,
          EBFONT: 101,
          ENOSTR: 100,
          ENODATA: 116,
          ETIME: 117,
          ENOSR: 118,
          ENONET: 119,
          ENOPKG: 120,
          EREMOTE: 121,
          ENOLINK: 47,
          EADV: 122,
          ESRMNT: 123,
          ECOMM: 124,
          EPROTO: 65,
          EMULTIHOP: 36,
          EDOTDOT: 125,
          EBADMSG: 9,
          ENOTUNIQ: 126,
          EBADFD: 127,
          EREMCHG: 128,
          ELIBACC: 129,
          ELIBBAD: 130,
          ELIBSCN: 131,
          ELIBMAX: 132,
          ELIBEXEC: 133,
          ENOSYS: 52,
          ENOTEMPTY: 55,
          ENAMETOOLONG: 37,
          ELOOP: 32,
          EOPNOTSUPP: 138,
          EPFNOSUPPORT: 139,
          ECONNRESET: 15,
          ENOBUFS: 42,
          EAFNOSUPPORT: 5,
          EPROTOTYPE: 67,
          ENOTSOCK: 57,
          ENOPROTOOPT: 50,
          ESHUTDOWN: 140,
          ECONNREFUSED: 14,
          EADDRINUSE: 3,
          ECONNABORTED: 13,
          ENETUNREACH: 40,
          ENETDOWN: 38,
          ETIMEDOUT: 73,
          EHOSTDOWN: 142,
          EHOSTUNREACH: 23,
          EINPROGRESS: 26,
          EALREADY: 7,
          EDESTADDRREQ: 17,
          EMSGSIZE: 35,
          EPROTONOSUPPORT: 66,
          ESOCKTNOSUPPORT: 137,
          EADDRNOTAVAIL: 4,
          ENETRESET: 39,
          EISCONN: 30,
          ENOTCONN: 53,
          ETOOMANYREFS: 141,
          EUSERS: 136,
          EDQUOT: 19,
          ESTALE: 72,
          ENOTSUP: 138,
          ENOMEDIUM: 148,
          EILSEQ: 25,
          EOVERFLOW: 61,
          ECANCELED: 11,
          ENOTRECOVERABLE: 56,
          EOWNERDEAD: 62,
          ESTRPIPE: 135
        };
        function N2(a) {
          try {
            return a();
          } catch (b2) {
            if (!b2.code) throw b2;
            if ("UNKNOWN" === b2.code) throw new G2.oa(28);
            throw new G2.oa(pb[b2.code]);
          }
        }
        function qb(a) {
          return N2(() => {
            var b2 = fs.lstatSync(a).mode;
            P2.Ta && (b2 |= (b2 & 292) >> 2);
            return b2;
          });
        }
        function Q2(a) {
          for (var b2 = []; a.parent !== a; ) b2.push(a.name), a = a.parent;
          b2.push(a.sa.Ma.root);
          b2.reverse();
          return Ua(...b2);
        }
        var P2 = { Ta: false, ib() {
          P2.Ta = !!process.platform.match(/^win/);
          var a = process.binding("constants");
          a.fs && (a = a.fs);
          P2.ob = { 1024: a.O_APPEND, 64: a.O_CREAT, 128: a.O_EXCL, 256: a.O_NOCTTY, 0: a.O_RDONLY, 2: a.O_RDWR, 4096: a.O_SYNC, 512: a.O_TRUNC, 1: a.O_WRONLY, 131072: a.O_NOFOLLOW };
        }, sa(a) {
          return P2.createNode(null, "/", qb(a.Ma.root), 0);
        }, createNode(a, b2, c) {
          if (!J2(c) && !G2.isFile(c) && 40960 !== (c & 61440)) throw new G2.oa(28);
          a = G2.createNode(a, b2, c);
          a.pa = P2.pa;
          a.qa = P2.qa;
          return a;
        }, pa: { ya(a) {
          var b2 = Q2(a), c;
          N2(() => c = fs.lstatSync(b2));
          P2.Ta && (c.Fa || (c.Fa = 4096), c.blocks || (c.blocks = (c.size + c.Fa - 1) / c.Fa | 0), c.mode |= (c.mode & 292) >> 2);
          return { dev: c.dev, ino: c.ino, mode: c.mode, nlink: c.nlink, uid: c.uid, gid: c.gid, rdev: c.rdev, size: c.size, atime: c.atime, mtime: c.mtime, ctime: c.ctime, Fa: c.Fa, blocks: c.blocks };
        }, ua(a, b2) {
          var c = Q2(a);
          N2(() => {
            if (void 0 !== b2.mode) {
              var d = b2.mode;
              P2.Ta && (d &= 384);
              fs.chmodSync(c, d);
              a.mode = b2.mode;
            }
            void 0 !== b2.size && fs.truncateSync(c, b2.size);
          });
        }, lookup(a, b2) {
          var c = Q2(a);
          c = F2(c + "/" + b2);
          c = qb(c);
          return P2.createNode(a, b2, c);
        }, Aa(a, b2, c, d) {
          var e = P2.createNode(
            a,
            b2,
            c,
            d
          ), g2 = Q2(e);
          N2(() => {
            J2(e.mode) ? fs.mkdirSync(g2, e.mode) : fs.writeFileSync(g2, "", { mode: e.mode });
          });
          return e;
        }, rename(a, b2, c) {
          var d = Q2(a), e = Va(Q2(b2), c);
          try {
            G2.unlink(e);
          } catch (g2) {
          }
          N2(() => fs.renameSync(d, e));
          a.name = c;
        }, unlink(a, b2) {
          var c = Va(Q2(a), b2);
          N2(() => fs.unlinkSync(c));
        }, rmdir(a, b2) {
          var c = Va(Q2(a), b2);
          N2(() => fs.rmdirSync(c));
        }, readdir(a) {
          var b2 = Q2(a);
          return N2(() => fs.readdirSync(b2));
        }, symlink(a, b2, c) {
          var d = Va(Q2(a), b2);
          N2(() => fs.symlinkSync(c, d));
        }, readlink(a) {
          var b2 = Q2(a);
          return N2(() => fs.readlinkSync(b2));
        }, hb(a) {
          var b2 = N2(() => fs.mc(a));
          b2.Ib = b2.Bb;
          return b2;
        } }, qa: {
          open(a) {
            var b2 = Q2(a.node);
            N2(() => {
              if (G2.isFile(a.node.mode)) {
                a.Ka.tb = 1;
                var c = fs, d = c.openSync, e = a.flags;
                e &= -2721793;
                var g2 = 0, h3;
                for (h3 in P2.ob) e & h3 && (g2 |= P2.ob[h3], e ^= h3);
                if (e) throw new G2.oa(28);
                a.Ra = d.call(c, b2, g2);
              }
            });
          },
          close(a) {
            N2(() => {
              G2.isFile(a.node.mode) && a.Ra && 0 === --a.Ka.tb && fs.closeSync(a.Ra);
            });
          },
          Fb(a) {
            a.Ka.tb++;
          },
          read(a, b2, c, d, e) {
            return 0 === d ? 0 : N2(() => fs.readSync(a.Ra, new Int8Array(b2.buffer, c, d), 0, d, e));
          },
          write(a, b2, c, d, e) {
            return N2(() => fs.writeSync(a.Ra, new Int8Array(b2.buffer, c, d), 0, d, e));
          },
          va(a, b2, c) {
            var d = b2;
            1 === c ? d += a.position : 2 === c && G2.isFile(a.node.mode) && N2(() => {
              d += fs.fstatSync(a.Ra).size;
            });
            if (0 > d) throw new G2.oa(28);
            return d;
          },
          Ia(a, b2, c) {
            if (!G2.isFile(a.node.mode)) throw new G2.oa(43);
            A();
            P2.qa.read(a, u3, void 0, b2, c);
            return { wa: void 0, Ab: true };
          },
          La(a, b2, c, d) {
            P2.qa.write(a, b2, 0, d, c, false);
            return 0;
          }
        } }, R3 = { Wa: 16895, Na: 33279, gb: null, sa(a) {
          function b2(g2) {
            g2 = g2.split("/");
            for (var h3 = d, k2 = 0; k2 < g2.length - 1; k2++) {
              var m2 = g2.slice(0, k2 + 1).join("/");
              let n, l;
              (n = e)[l = m2] || (n[l] = R3.createNode(h3, g2[k2], R3.Wa, 0));
              h3 = e[m2];
            }
            return h3;
          }
          function c(g2) {
            g2 = g2.split("/");
            return g2[g2.length - 1];
          }
          ea || A();
          R3.gb ?? (R3.gb = new FileReaderSync());
          var d = R3.createNode(null, "/", R3.Wa, 0), e = {};
          Array.prototype.forEach.call(a.Ma.files || [], function(g2) {
            R3.createNode(b2(g2.name), c(g2.name), R3.Na, 0, g2, g2.lastModifiedDate);
          });
          (a.Ma.blobs || []).forEach((g2) => {
            R3.createNode(b2(g2.name), c(g2.name), R3.Na, 0, g2.data);
          });
          (a.Ma.packages || []).forEach((g2) => {
            g2.metadata.files.forEach((h3) => {
              var k2 = h3.filename.substr(1);
              R3.createNode(b2(k2), c(k2), R3.Na, 0, g2.blob.slice(h3.start, h3.end));
            });
          });
          return d;
        }, createNode(a, b2, c, d, e, g2) {
          d = G2.createNode(a, b2, c);
          d.mode = c;
          d.pa = R3.pa;
          d.qa = R3.qa;
          d.atime = d.mtime = d.ctime = (g2 || /* @__PURE__ */ new Date()).getTime();
          R3.Na !== R3.Wa || A();
          c === R3.Na ? (d.size = e.size, d.ra = e) : (d.size = 4096, d.ra = {});
          a && (a.ra[b2] = d);
          return d;
        }, pa: { ya(a) {
          return { dev: 1, ino: a.id, mode: a.mode, nlink: 1, uid: 0, gid: 0, rdev: 0, size: a.size, atime: new Date(a.atime), mtime: new Date(a.mtime), ctime: new Date(a.ctime), Fa: 4096, blocks: Math.ceil(a.size / 4096) };
        }, ua(a, b2) {
          for (const c of ["mode", "atime", "mtime", "ctime"]) b2[c] && (a[c] = b2[c]);
        }, lookup() {
          throw new G2.oa(44);
        }, Aa() {
          throw new G2.oa(63);
        }, rename() {
          throw new G2.oa(63);
        }, unlink() {
          throw new G2.oa(63);
        }, rmdir() {
          throw new G2.oa(63);
        }, readdir(a) {
          var b2 = [".", ".."], c;
          for (c of Object.keys(a.ra)) b2.push(c);
          return b2;
        }, symlink() {
          throw new G2.oa(63);
        } }, qa: { read(a, b2, c, d, e) {
          if (e >= a.node.size) return 0;
          a = a.node.ra.slice(e, e + d);
          d = R3.gb.readAsArrayBuffer(a);
          b2.set(new Uint8Array(d), c);
          return a.size;
        }, write() {
          throw new G2.oa(29);
        }, va(a, b2, c) {
          1 === c ? b2 += a.position : 2 === c && G2.isFile(a.node.mode) && (b2 += a.node.size);
          if (0 > b2) throw new G2.oa(28);
          return b2;
        } } };
        function fb(a, b2) {
          G2.lb[a] = { qa: b2 };
        }
        function J2(a) {
          return 16384 === (a & 61440);
        }
        function M3(a, b2) {
          var c = J2(a.mode) ? (c = rb(a, "x")) ? c : a.pa.lookup ? 0 : 2 : 54;
          if (c) throw new G2.oa(c);
          for (c = G2.Ca[sb(a.id, b2)]; c; c = c.Ja) {
            var d = c.name;
            if (c.parent.id === a.id && d === b2) return c;
          }
          return G2.lookup(a, b2);
        }
        function kb(a) {
          var b2 = sb(a.parent.id, a.name);
          if (G2.Ca[b2] === a) G2.Ca[b2] = a.Ja;
          else for (b2 = G2.Ca[b2]; b2; ) {
            if (b2.Ja === a) {
              b2.Ja = a.Ja;
              break;
            }
            b2 = b2.Ja;
          }
        }
        function S3(a, b2 = {}) {
          if (!a) return { path: "", node: null };
          b2.Sa ?? (b2.Sa = true);
          "/" === a.charAt(0) || (a = G2.cwd() + "/" + a);
          var c = 0;
          a: for (; 40 > c; c++) {
            a = a.split("/").filter((k2) => !!k2 && "." !== k2);
            for (var d = G2.root, e = "/", g2 = 0; g2 < a.length; g2++) {
              var h3 = g2 === a.length - 1;
              if (h3 && b2.parent) break;
              if (".." === a[g2]) e = Ra(e), d = d.parent;
              else {
                e = F2(e + "/" + a[g2]);
                try {
                  d = M3(d, a[g2]);
                } catch (k2) {
                  if (44 === k2?.xa && h3 && b2.Qb) return { path: e };
                  throw k2;
                }
                !d.Ba || h3 && !b2.Sa || (d = d.Ba.root);
                if (40960 === (d.mode & 61440) && (!h3 || b2.za)) {
                  if (!d.pa.readlink) throw new G2.oa(52);
                  d = d.pa.readlink(d);
                  "/" === d.charAt(0) || (d = Ra(e) + "/" + d);
                  a = d + "/" + a.slice(g2 + 1).join("/");
                  continue a;
                }
              }
            }
            return { path: e, node: d };
          }
          throw new G2.oa(32);
        }
        function tb(a) {
          for (var b2; ; ) {
            if (G2.qb(a)) return a = a.sa.rb, b2 ? "/" !== a[a.length - 1] ? `${a}/${b2}` : a + b2 : a;
            b2 = b2 ? `${a.name}/${b2}` : a.name;
            a = a.parent;
          }
        }
        function sb(a, b2) {
          for (var c = 0, d = 0; d < b2.length; d++) c = (c << 5) - c + b2.charCodeAt(d) | 0;
          return (a + c >>> 0) % G2.Ca.length;
        }
        function ub(a) {
          var b2 = sb(a.parent.id, a.name);
          a.Ja = G2.Ca[b2];
          G2.Ca[b2] = a;
        }
        function vb(a) {
          var b2 = ["r", "w", "rw"][a & 3];
          a & 512 && (b2 += "w");
          return b2;
        }
        function rb(a, b2) {
          if (G2.Ya) return 0;
          if (!b2.includes("r") || a.mode & 292) {
            if (b2.includes("w") && !(a.mode & 146) || b2.includes("x") && !(a.mode & 73)) return 2;
          } else return 2;
          return 0;
        }
        function wb(a, b2) {
          if (!J2(a.mode)) return 54;
          try {
            return M3(a, b2), 20;
          } catch (c) {
          }
          return rb(a, "wx");
        }
        function xb(a, b2, c) {
          try {
            var d = M3(a, b2);
          } catch (e) {
            return e.xa;
          }
          if (a = rb(a, "wx")) return a;
          if (c) {
            if (!J2(d.mode)) return 54;
            if (G2.qb(d) || tb(d) === G2.cwd()) return 10;
          } else if (J2(d.mode)) return 31;
          return 0;
        }
        function U2(a) {
          a = G2.Kb(a);
          if (!a) throw new G2.oa(8);
          return a;
        }
        function yb(a, b2 = -1) {
          a = Object.assign(new G2.yb(), a);
          if (-1 == b2) a: {
            for (b2 = 0; b2 <= G2.zb; b2++) if (!G2.streams[b2]) break a;
            throw new G2.oa(33);
          }
          a.fd = b2;
          return G2.streams[b2] = a;
        }
        function zb(a, b2 = -1) {
          a = yb(a, b2);
          a.qa?.Fb?.(a);
          return a;
        }
        function Ab(a) {
          var b2 = [];
          for (a = [a]; a.length; ) {
            var c = a.pop();
            b2.push(c);
            a.push(...c.Qa);
          }
          return b2;
        }
        function Bb(a, b2, c) {
          "undefined" == typeof c && (c = b2, b2 = 438);
          return G2.Aa(a, b2 | 8192, c);
        }
        function Cb() {
          G2.mkdir("/dev");
          fb(G2.Ha(1, 3), { read: () => 0, write: (d, e, g2, h3) => h3, va: () => 0 });
          Bb("/dev/null", G2.Ha(1, 3));
          eb(G2.Ha(5, 0), hb);
          eb(G2.Ha(6, 0), ib);
          Bb("/dev/tty", G2.Ha(5, 0));
          Bb("/dev/tty1", G2.Ha(6, 0));
          var a = new Uint8Array(1024), b2 = 0, c = () => {
            0 === b2 && (b2 = Xa(a).byteLength);
            return a[--b2];
          };
          G2.Ga("/dev", "random", c);
          G2.Ga("/dev", "urandom", c);
          G2.mkdir("/dev/shm");
          G2.mkdir("/dev/shm/tmp");
        }
        function Db() {
          G2.mkdir("/proc");
          var a = G2.mkdir("/proc/self");
          G2.mkdir("/proc/self/fd");
          G2.sa({ sa() {
            var b2 = G2.createNode(a, "fd", 16895, 73);
            b2.qa = { va: H2.qa.va };
            b2.pa = { lookup(c, d) {
              c = +d;
              var e = U2(c);
              c = { parent: null, sa: { rb: "fake" }, pa: { readlink: () => e.path }, id: c + 1 };
              return c.parent = c;
            }, readdir() {
              return Array.from(G2.streams.entries()).filter(([, c]) => c).map(([c]) => c.toString());
            } };
            return b2;
          } }, {}, "/proc/self/fd");
        }
        function Eb(a, b2, c, d) {
          a = "string" == typeof a ? a : tb(a);
          b2 = F2(a + "/" + b2);
          return G2.create(b2, ob(c, d));
        }
        function Fb(a) {
          if (!(a.Ob || a.Pb || a.link || a.ra)) {
            if ("undefined" != typeof XMLHttpRequest) throw Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
            try {
              a.ra = ma(a.url), a.ta = a.ra.length;
            } catch (b2) {
              throw new G2.oa(29);
            }
          }
        }
        var G2 = {
          root: null,
          Qa: [],
          lb: {},
          streams: [],
          bb: 1,
          Ca: null,
          kb: "/",
          Za: false,
          Ya: true,
          oa: class {
            name = "ErrnoError";
            constructor(a) {
              this.xa = a;
            }
          },
          Hb: null,
          Va: 0,
          yb: class {
            Ka = {};
            node = null;
            get object() {
              return this.node;
            }
            set object(a) {
              this.node = a;
            }
            get flags() {
              return this.Ka.flags;
            }
            set flags(a) {
              this.Ka.flags = a;
            }
            get position() {
              return this.Ka.position;
            }
            set position(a) {
              this.Ka.position = a;
            }
          },
          xb: class {
            pa = {};
            qa = {};
            Ba = null;
            constructor(a, b2, c, d) {
              a ||= this;
              this.parent = a;
              this.sa = a.sa;
              this.id = G2.bb++;
              this.name = b2;
              this.mode = c;
              this.rdev = d;
              this.atime = this.mtime = this.ctime = Date.now();
            }
            get read() {
              return 365 === (this.mode & 365);
            }
            set read(a) {
              a ? this.mode |= 365 : this.mode &= -366;
            }
            get write() {
              return 146 === (this.mode & 146);
            }
            set write(a) {
              a ? this.mode |= 146 : this.mode &= -147;
            }
            get Pb() {
              return J2(this.mode);
            }
            get Ob() {
              return 8192 === (this.mode & 61440);
            }
          },
          createNode(a, b2, c, d) {
            a = new G2.xb(a, b2, c, d);
            ub(a);
            return a;
          },
          qb(a) {
            return a === a.parent;
          },
          isFile(a) {
            return 32768 === (a & 61440);
          },
          isFIFO(a) {
            return 4096 === (a & 61440);
          },
          isSocket(a) {
            return 49152 === (a & 49152);
          },
          zb: 4096,
          Kb: (a) => G2.streams[a],
          Db: { open(a) {
            a.qa = G2.Jb(a.node.rdev).qa;
            a.qa.open?.(a);
          }, va() {
            throw new G2.oa(70);
          } },
          ab: (a) => a >> 8,
          ic: (a) => a & 255,
          Ha: (a, b2) => a << 8 | b2,
          Jb: (a) => G2.lb[a],
          vb(a, b2) {
            function c(h3) {
              G2.Va--;
              return b2(h3);
            }
            function d(h3) {
              if (h3) {
                if (!d.Gb) return d.Gb = true, c(h3);
              } else ++g2 >= e.length && c(null);
            }
            "function" == typeof a && (b2 = a, a = false);
            G2.Va++;
            1 < G2.Va && r(`warning: ${G2.Va} FS.syncfs operations in flight at once, probably just doing extra work`);
            var e = Ab(G2.root.sa), g2 = 0;
            e.forEach((h3) => {
              if (!h3.type.vb) return d(null);
              h3.type.vb(h3, a, d);
            });
          },
          sa(a, b2, c) {
            var d = "/" === c;
            if (d && G2.root) throw new G2.oa(10);
            if (!d && c) {
              var e = S3(c, { Sa: false });
              c = e.path;
              e = e.node;
              if (e.Ba) throw new G2.oa(10);
              if (!J2(e.mode)) throw new G2.oa(54);
            }
            b2 = { type: a, Ma: b2, rb: c, Qa: [] };
            a = a.sa(b2);
            a.sa = b2;
            b2.root = a;
            d ? G2.root = a : e && (e.Ba = b2, e.sa && e.sa.Qa.push(b2));
            return a;
          },
          Tb(a) {
            a = S3(a, { Sa: false });
            if (!a.node.Ba) throw new G2.oa(28);
            a = a.node;
            var b2 = a.Ba, c = Ab(b2);
            Object.keys(G2.Ca).forEach((d) => {
              for (d = G2.Ca[d]; d; ) {
                var e = d.Ja;
                c.includes(d.sa) && kb(d);
                d = e;
              }
            });
            a.Ba = null;
            a.sa.Qa.splice(a.sa.Qa.indexOf(b2), 1);
          },
          lookup(a, b2) {
            return a.pa.lookup(a, b2);
          },
          Aa(a, b2, c) {
            var d = S3(a, { parent: true }).node;
            a = Sa(a);
            if (!a || "." === a || ".." === a) throw new G2.oa(28);
            var e = wb(d, a);
            if (e) throw new G2.oa(e);
            if (!d.pa.Aa) throw new G2.oa(63);
            return d.pa.Aa(d, a, b2, c);
          },
          hb(a) {
            var b2 = { Bb: 4096, Ib: 4096, blocks: 1e6, Vb: 5e5, Ub: 5e5, files: G2.bb, cc: G2.bb - 1, ec: 42, flags: 2, kc: 255 };
            a = S3(a, { za: true }).node;
            a?.pa.hb && Object.assign(b2, a.pa.hb(a.sa.Ma.root));
            return b2;
          },
          create(a, b2 = 438) {
            return G2.Aa(a, b2 & 4095 | 32768, 0);
          },
          mkdir(a, b2 = 511) {
            return G2.Aa(a, b2 & 1023 | 16384, 0);
          },
          jc(a, b2) {
            a = a.split("/");
            for (var c = "", d = 0; d < a.length; ++d) if (a[d]) {
              c += "/" + a[d];
              try {
                G2.mkdir(
                  c,
                  b2
                );
              } catch (e) {
                if (20 != e.xa) throw e;
              }
            }
          },
          symlink(a, b2) {
            if (!Ya(a)) throw new G2.oa(44);
            var c = S3(b2, { parent: true }).node;
            if (!c) throw new G2.oa(44);
            b2 = Sa(b2);
            var d = wb(c, b2);
            if (d) throw new G2.oa(d);
            if (!c.pa.symlink) throw new G2.oa(63);
            return c.pa.symlink(c, b2, a);
          },
          rename(a, b2) {
            var c = Ra(a), d = Ra(b2), e = Sa(a), g2 = Sa(b2);
            var h3 = S3(a, { parent: true });
            var k2 = h3.node;
            h3 = S3(b2, { parent: true });
            h3 = h3.node;
            if (!k2 || !h3) throw new G2.oa(44);
            if (k2.sa !== h3.sa) throw new G2.oa(75);
            var m2 = M3(k2, e);
            a = Za(a, d);
            if ("." !== a.charAt(0)) throw new G2.oa(28);
            a = Za(b2, c);
            if ("." !== a.charAt(0)) throw new G2.oa(55);
            try {
              var n = M3(h3, g2);
            } catch (l) {
            }
            if (m2 !== n) {
              b2 = J2(m2.mode);
              if (e = xb(k2, e, b2)) throw new G2.oa(e);
              if (e = n ? xb(h3, g2, b2) : wb(h3, g2)) throw new G2.oa(e);
              if (!k2.pa.rename) throw new G2.oa(63);
              if (m2.Ba || n && n.Ba) throw new G2.oa(10);
              if (h3 !== k2 && (e = rb(k2, "w"))) throw new G2.oa(e);
              kb(m2);
              try {
                k2.pa.rename(m2, h3, g2), m2.parent = h3;
              } catch (l) {
                throw l;
              } finally {
                ub(m2);
              }
            }
          },
          rmdir(a) {
            var b2 = S3(a, { parent: true }).node;
            a = Sa(a);
            var c = M3(b2, a), d = xb(b2, a, true);
            if (d) throw new G2.oa(d);
            if (!b2.pa.rmdir) throw new G2.oa(63);
            if (c.Ba) throw new G2.oa(10);
            b2.pa.rmdir(b2, a);
            kb(c);
          },
          readdir(a) {
            a = S3(a, { za: true }).node;
            if (!a.pa.readdir) throw new G2.oa(54);
            return a.pa.readdir(a);
          },
          unlink(a) {
            var b2 = S3(a, { parent: true }).node;
            if (!b2) throw new G2.oa(44);
            a = Sa(a);
            var c = M3(b2, a), d = xb(b2, a, false);
            if (d) throw new G2.oa(d);
            if (!b2.pa.unlink) throw new G2.oa(63);
            if (c.Ba) throw new G2.oa(10);
            b2.pa.unlink(b2, a);
            kb(c);
          },
          readlink(a) {
            a = S3(a).node;
            if (!a) throw new G2.oa(44);
            if (!a.pa.readlink) throw new G2.oa(28);
            return a.pa.readlink(a);
          },
          stat(a, b2) {
            a = S3(a, { za: !b2 }).node;
            if (!a) throw new G2.oa(44);
            if (!a.pa.ya) throw new G2.oa(63);
            return a.pa.ya(a);
          },
          lstat(a) {
            return G2.stat(
              a,
              true
            );
          },
          chmod(a, b2, c) {
            a = "string" == typeof a ? S3(a, { za: !c }).node : a;
            if (!a.pa.ua) throw new G2.oa(63);
            a.pa.ua(a, { mode: b2 & 4095 | a.mode & -4096, ctime: Date.now() });
          },
          lchmod(a, b2) {
            G2.chmod(a, b2, true);
          },
          fchmod(a, b2) {
            a = U2(a);
            G2.chmod(a.node, b2);
          },
          chown(a, b2, c, d) {
            a = "string" == typeof a ? S3(a, { za: !d }).node : a;
            if (!a.pa.ua) throw new G2.oa(63);
            a.pa.ua(a, { timestamp: Date.now() });
          },
          lchown(a, b2, c) {
            G2.chown(a, b2, c, true);
          },
          fchown(a, b2, c) {
            a = U2(a);
            G2.chown(a.node, b2, c);
          },
          truncate(a, b2) {
            if (0 > b2) throw new G2.oa(28);
            a = "string" == typeof a ? S3(a, { za: true }).node : a;
            if (!a.pa.ua) throw new G2.oa(63);
            if (J2(a.mode)) throw new G2.oa(31);
            if (!G2.isFile(a.mode)) throw new G2.oa(28);
            var c = rb(a, "w");
            if (c) throw new G2.oa(c);
            a.pa.ua(a, { size: b2, timestamp: Date.now() });
          },
          fc(a, b2) {
            a = U2(a);
            if (0 === (a.flags & 2097155)) throw new G2.oa(28);
            G2.truncate(a.node, b2);
          },
          oc(a, b2, c) {
            a = S3(a, { za: true }).node;
            a.pa.ua(a, { atime: b2, mtime: c });
          },
          open(a, b2, c = 438) {
            if ("" === a) throw new G2.oa(44);
            if ("string" == typeof b2) {
              var d = { r: 0, "r+": 2, w: 577, "w+": 578, a: 1089, "a+": 1090 }[b2];
              if ("undefined" == typeof d) throw Error(`Unknown file open mode: ${b2}`);
              b2 = d;
            }
            c = b2 & 64 ? c & 4095 | 32768 : 0;
            "object" == typeof a ? d = a : (a = S3(a, { za: !(b2 & 131072), Qb: true }), d = a.node, a = a.path);
            var e = false;
            if (b2 & 64) if (d) {
              if (b2 & 128) throw new G2.oa(20);
            } else d = G2.Aa(a, c, 0), e = true;
            if (!d) throw new G2.oa(44);
            8192 === (d.mode & 61440) && (b2 &= -513);
            if (b2 & 65536 && !J2(d.mode)) throw new G2.oa(54);
            if (!e && (c = d ? 40960 === (d.mode & 61440) ? 32 : J2(d.mode) && ("r" !== vb(b2) || b2 & 512) ? 31 : rb(d, vb(b2)) : 44)) throw new G2.oa(c);
            b2 & 512 && !e && G2.truncate(d, 0);
            b2 &= -131713;
            b2 = yb({ node: d, path: tb(d), flags: b2, seekable: true, position: 0, qa: d.qa, Sb: [], error: false });
            b2.qa.open && b2.qa.open(b2);
            return b2;
          },
          close(a) {
            if (null === a.fd) throw new G2.oa(8);
            a.Xa && (a.Xa = null);
            try {
              a.qa.close && a.qa.close(a);
            } catch (b2) {
              throw b2;
            } finally {
              G2.streams[a.fd] = null;
            }
            a.fd = null;
          },
          va(a, b2, c) {
            if (null === a.fd) throw new G2.oa(8);
            if (!a.seekable || !a.qa.va) throw new G2.oa(70);
            if (0 != c && 1 != c && 2 != c) throw new G2.oa(28);
            a.position = a.qa.va(a, b2, c);
            a.Sb = [];
            return a.position;
          },
          read(a, b2, c, d, e) {
            if (0 > d || 0 > e) throw new G2.oa(28);
            if (null === a.fd) throw new G2.oa(8);
            if (1 === (a.flags & 2097155)) throw new G2.oa(8);
            if (J2(a.node.mode)) throw new G2.oa(31);
            if (!a.qa.read) throw new G2.oa(28);
            var g2 = "undefined" != typeof e;
            if (!g2) e = a.position;
            else if (!a.seekable) throw new G2.oa(70);
            b2 = a.qa.read(a, b2, c, d, e);
            g2 || (a.position += b2);
            return b2;
          },
          write(a, b2, c, d, e, g2) {
            if (0 > d || 0 > e) throw new G2.oa(28);
            if (null === a.fd) throw new G2.oa(8);
            if (0 === (a.flags & 2097155)) throw new G2.oa(8);
            if (J2(a.node.mode)) throw new G2.oa(31);
            if (!a.qa.write) throw new G2.oa(28);
            a.seekable && a.flags & 1024 && G2.va(a, 0, 2);
            var h3 = "undefined" != typeof e;
            if (!h3) e = a.position;
            else if (!a.seekable) throw new G2.oa(70);
            b2 = a.qa.write(a, b2, c, d, e, g2);
            h3 || (a.position += b2);
            return b2;
          },
          Oa(a, b2, c) {
            if (null === a.fd) throw new G2.oa(8);
            if (0 > b2 || 0 >= c) throw new G2.oa(28);
            if (0 === (a.flags & 2097155)) throw new G2.oa(8);
            if (!G2.isFile(a.node.mode) && !J2(a.node.mode)) throw new G2.oa(43);
            if (!a.qa.Oa) throw new G2.oa(138);
            a.qa.Oa(a, b2, c);
          },
          Ia(a, b2, c, d, e) {
            if (0 !== (d & 2) && 0 === (e & 2) && 2 !== (a.flags & 2097155)) throw new G2.oa(2);
            if (1 === (a.flags & 2097155)) throw new G2.oa(2);
            if (!a.qa.Ia) throw new G2.oa(43);
            if (!b2) throw new G2.oa(28);
            return a.qa.Ia(a, b2, c, d, e);
          },
          La(a, b2, c, d, e) {
            return a.qa.La ? a.qa.La(a, b2, c, d, e) : 0;
          },
          $a(a, b2, c) {
            if (!a.qa.$a) throw new G2.oa(59);
            return a.qa.$a(a, b2, c);
          },
          readFile(a, b2 = {}) {
            b2.flags = b2.flags || 0;
            b2.encoding = b2.encoding || "binary";
            if ("utf8" !== b2.encoding && "binary" !== b2.encoding) throw Error(`Invalid encoding type "${b2.encoding}"`);
            var c, d = G2.open(a, b2.flags);
            a = G2.stat(a).size;
            var e = new Uint8Array(a);
            G2.read(d, e, 0, a, 0);
            "utf8" === b2.encoding ? c = B2(e) : "binary" === b2.encoding && (c = e);
            G2.close(d);
            return c;
          },
          writeFile(a, b2, c = {}) {
            c.flags = c.flags || 577;
            a = G2.open(a, c.flags, c.mode);
            if ("string" == typeof b2) {
              var d = new Uint8Array(ab(b2) + 1);
              b2 = bb(b2, d, 0, d.length);
              G2.write(a, d, 0, b2, void 0, c.Cb);
            } else if (ArrayBuffer.isView(b2)) G2.write(a, b2, 0, b2.byteLength, void 0, c.Cb);
            else throw Error("Unsupported data type");
            G2.close(a);
          },
          cwd: () => G2.kb,
          chdir(a) {
            a = S3(a, { za: true });
            if (null === a.node) throw new G2.oa(44);
            if (!J2(a.node.mode)) throw new G2.oa(54);
            var b2 = rb(a.node, "x");
            if (b2) throw new G2.oa(b2);
            G2.kb = a.path;
          },
          ib() {
            G2.Ca = Array(4096);
            G2.sa(H2, {}, "/");
            G2.mkdir("/tmp");
            G2.mkdir("/home");
            G2.mkdir("/home/web_user");
            Cb();
            Db();
            G2.Hb = { MEMFS: H2, NODEFS: P2, WORKERFS: R3 };
          },
          Pa(a, b2, c) {
            G2.Za = true;
            a ? G2.Ga("/dev", "stdin", a) : G2.symlink("/dev/tty", "/dev/stdin");
            b2 ? G2.Ga("/dev", "stdout", null, b2) : G2.symlink("/dev/tty", "/dev/stdout");
            c ? G2.Ga("/dev", "stderr", null, c) : G2.symlink("/dev/tty1", "/dev/stderr");
            G2.open("/dev/stdin", 0);
            G2.open("/dev/stdout", 1);
            G2.open("/dev/stderr", 1);
          },
          lc() {
            G2.Za = false;
            for (var a = 0; a < G2.streams.length; a++) {
              var b2 = G2.streams[a];
              b2 && G2.close(b2);
            }
          },
          dc(a, b2) {
            try {
              var c = S3(a, { za: !b2 });
              a = c.path;
            } catch (g2) {
            }
            var d = false, e = null;
            try {
              c = S3(a, { parent: true }), Sa(a), c = S3(a, { za: !b2 }), d = true, e = c.node;
            } catch (g2) {
            }
            return d ? e : null;
          },
          ac(a, b2) {
            a = "string" == typeof a ? a : tb(a);
            for (b2 = b2.split("/").reverse(); b2.length; ) {
              var c = b2.pop();
              if (c) {
                var d = F2(a + "/" + c);
                try {
                  G2.mkdir(d);
                } catch (e) {
                }
                a = d;
              }
            }
            return d;
          },
          Ga(a, b2, c, d) {
            a = Va("string" == typeof a ? a : tb(a), b2);
            b2 = ob(!!c, !!d);
            var e;
            (e = G2.Ga).ab ?? (e.ab = 64);
            e = G2.Ha(G2.Ga.ab++, 0);
            fb(e, { open(g2) {
              g2.seekable = false;
            }, close() {
              d?.buffer?.length && d(10);
            }, read(g2, h3, k2, m2) {
              for (var n = 0, l = 0; l < m2; l++) {
                try {
                  var q2 = c();
                } catch (C2) {
                  throw new G2.oa(29);
                }
                if (void 0 === q2 && 0 === n) throw new G2.oa(6);
                if (null === q2 || void 0 === q2) break;
                n++;
                h3[k2 + l] = q2;
              }
              n && (g2.node.atime = Date.now());
              return n;
            }, write(g2, h3, k2, m2) {
              for (var n = 0; n < m2; n++) try {
                d(h3[k2 + n]);
              } catch (l) {
                throw new G2.oa(29);
              }
              m2 && (g2.node.mtime = g2.node.ctime = Date.now());
              return n;
            } });
            return Bb(a, b2, e);
          },
          Eb(a, b2, c, d, e) {
            class g2 {
              fb = false;
              Ua = [];
              cb = void 0;
              ub = 0;
              sb = 0;
              get(l) {
                if (!(l > this.length - 1 || 0 > l)) {
                  var q2 = l % this.chunkSize;
                  return this.cb(l / this.chunkSize | 0)[q2];
                }
              }
              Rb(l) {
                this.cb = l;
              }
              wb() {
                var l = new XMLHttpRequest();
                l.open("HEAD", c, false);
                l.send(null);
                if (!(200 <= l.status && 300 > l.status || 304 === l.status)) throw Error("Couldn't load " + c + ". Status: " + l.status);
                var q2 = Number(l.getResponseHeader("Content-length")), C2, I2 = (C2 = l.getResponseHeader("Accept-Ranges")) && "bytes" === C2;
                l = (C2 = l.getResponseHeader("Content-Encoding")) && "gzip" === C2;
                var v2 = 1048576;
                I2 || (v2 = q2);
                var t3 = this;
                t3.Rb((K3) => {
                  var L3 = K3 * v2, T4 = (K3 + 1) * v2 - 1;
                  T4 = Math.min(T4, q2 - 1);
                  if ("undefined" == typeof t3.Ua[K3]) {
                    var Ta = t3.Ua;
                    if (L3 > T4) throw Error("invalid range (" + L3 + ", " + T4 + ") or no bytes requested!");
                    if (T4 > q2 - 1) throw Error("only " + q2 + " bytes available! programmer error!");
                    var O2 = new XMLHttpRequest();
                    O2.open("GET", c, false);
                    q2 !== v2 && O2.setRequestHeader(
                      "Range",
                      "bytes=" + L3 + "-" + T4
                    );
                    O2.responseType = "arraybuffer";
                    O2.overrideMimeType && O2.overrideMimeType("text/plain; charset=x-user-defined");
                    O2.send(null);
                    if (!(200 <= O2.status && 300 > O2.status || 304 === O2.status)) throw Error("Couldn't load " + c + ". Status: " + O2.status);
                    L3 = void 0 !== O2.response ? new Uint8Array(O2.response || []) : cb(O2.responseText || "");
                    Ta[K3] = L3;
                  }
                  if ("undefined" == typeof t3.Ua[K3]) throw Error("doXHR failed!");
                  return t3.Ua[K3];
                });
                if (l || !q2) v2 = q2 = 1, v2 = q2 = this.cb(0).length, oa("LazyFiles on gzip forces download of the whole file when length is accessed");
                this.ub = q2;
                this.sb = v2;
                this.fb = true;
              }
              get length() {
                this.fb || this.wb();
                return this.ub;
              }
              get chunkSize() {
                this.fb || this.wb();
                return this.sb;
              }
            }
            if ("undefined" != typeof XMLHttpRequest) {
              if (!ea) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
              var h3 = new g2();
              var k2 = void 0;
            } else k2 = c, h3 = void 0;
            var m2 = Eb(a, b2, d, e);
            h3 ? m2.ra = h3 : k2 && (m2.ra = null, m2.url = k2);
            Object.defineProperties(m2, { ta: { get: function() {
              return this.ra.length;
            } } });
            var n = {};
            Object.keys(m2.qa).forEach((l) => {
              var q2 = m2.qa[l];
              n[l] = (...C2) => {
                Fb(m2);
                return q2(...C2);
              };
            });
            n.read = (l, q2, C2, I2, v2) => {
              Fb(m2);
              l = l.node.ra;
              if (v2 >= l.length) q2 = 0;
              else {
                I2 = Math.min(l.length - v2, I2);
                if (l.slice) for (var t3 = 0; t3 < I2; t3++) q2[C2 + t3] = l[v2 + t3];
                else for (t3 = 0; t3 < I2; t3++) q2[C2 + t3] = l.get(v2 + t3);
                q2 = I2;
              }
              return q2;
            };
            n.Ia = () => {
              Fb(m2);
              A();
              throw new G2.oa(48);
            };
            m2.qa = n;
            return m2;
          }
        };
        function Gb(a, b2) {
          if ("/" === b2.charAt(0)) return b2;
          a = -100 === a ? G2.cwd() : U2(a).path;
          if (0 == b2.length) throw new G2.oa(44);
          return a + "/" + b2;
        }
        var Pa = void 0, Hb = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Ib = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], Jb = {}, Kb = (a) => {
          if (a instanceof Ga || "unwind" == a) return ra;
          ka(1, a);
        }, Lb = (a) => {
          ra = a;
          ka(a, new Ga(a));
        }, Mb = (a) => {
          ra = a;
          Lb(a);
        }, Nb = (a) => {
          if (!qa) try {
            a();
          } catch (b2) {
            Kb(b2);
          }
        }, Ob = {}, Qb = () => {
          if (!Pb) {
            var a = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: ("object" == typeof navigator && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", _: ja5 || "./this.program" }, b2;
            for (b2 in Ob) void 0 === Ob[b2] ? delete a[b2] : a[b2] = Ob[b2];
            var c = [];
            for (b2 in a) c.push(`${b2}=${a[b2]}`);
            Pb = c;
          }
          return Pb;
        }, Pb, V2;
        G2.bc = (a, b2, c, d, e, g2, h3, k2, m2, n) => {
          function l(C2) {
            function I2(v2) {
              n?.();
              if (!k2) {
                var t3 = a, K3 = b2;
                t3 && (t3 = "string" == typeof t3 ? t3 : tb(t3), K3 = b2 ? F2(t3 + "/" + b2) : t3);
                t3 = ob(d, e);
                K3 = G2.create(K3, t3);
                if (v2) {
                  if ("string" == typeof v2) {
                    for (var L3 = Array(v2.length), T4 = 0, Ta = v2.length; T4 < Ta; ++T4) L3[T4] = v2.charCodeAt(T4);
                    v2 = L3;
                  }
                  G2.chmod(K3, t3 | 146);
                  L3 = G2.open(K3, 577);
                  G2.write(L3, v2, 0, v2.length, 0, m2);
                  G2.close(L3);
                  G2.chmod(K3, t3);
                }
              }
              g2?.();
              Aa();
            }
            nb(C2, q2, I2, () => {
              h3?.();
              Aa();
            }) || I2(C2);
          }
          var q2 = b2 ? Ya(F2(a + "/" + b2)) : a;
          ya++;
          "string" == typeof c ? lb(c).then(l, h3) : l(c);
        };
        G2.ib();
        H2.mb = new G2.oa(44);
        H2.mb.stack = "<generic error, no stack>";
        fa && P2.ib();
        var pc = {
          o: (a, b2, c, d) => A(`Assertion failed: ${a ? B2(w2, a) : ""}, at: ` + [b2 ? b2 ? B2(w2, b2) : "" : "unknown filename", c, d ? d ? B2(w2, d) : "" : "unknown function"]),
          n: (a) => {
            var b2 = new La(a);
            0 == u3[b2.wa + 12] && (u3[b2.wa + 12] = 1, Ka--);
            u3[b2.wa + 13] = 0;
            Ja.push(b2);
            Rb(a);
            return Sb(a);
          },
          q: () => {
            W2(0, 0);
            var a = Ja.pop();
            Tb(a.nb);
            D4 = 0;
          },
          d: () => Oa([]),
          j: (a) => Oa([a]),
          K: (a, b2) => Oa([a, b2]),
          B: () => {
            var a = Ja.pop();
            a || A("no exception to throw");
            var b2 = a.nb;
            0 == u3[a.wa + 13] && (Ja.push(a), u3[a.wa + 13] = 1, u3[a.wa + 12] = 0, Ka++);
            D4 = b2;
            throw D4;
          },
          a: (a, b2, c) => {
            new La(a).Pa(b2, c);
            D4 = a;
            Ka++;
            throw D4;
          },
          R: () => Ka,
          g: (a) => {
            D4 ||= a;
            throw D4;
          },
          w: function(a, b2, c) {
            Pa = c;
            try {
              var d = U2(a);
              switch (b2) {
                case 0:
                  var e = E2();
                  if (0 > e) break;
                  for (; G2.streams[e]; ) e++;
                  return zb(d, e).fd;
                case 1:
                case 2:
                  return 0;
                case 3:
                  return d.flags;
                case 4:
                  return e = E2(), d.flags |= e, 0;
                case 12:
                  return e = E2(), sa[e + 0 >> 1] = 2, 0;
                case 13:
                case 14:
                  return 0;
              }
              return -28;
            } catch (g2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== g2.name) throw g2;
              return -g2.xa;
            }
          },
          D: function(a, b2, c) {
            Pa = c;
            try {
              var d = U2(a);
              switch (b2) {
                case 21509:
                  return d.tty ? 0 : -59;
                case 21505:
                  if (!d.tty) return -59;
                  if (d.tty.Ea.Lb) {
                    a = [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
                    var e = E2();
                    x2[e >> 2] = 25856;
                    x2[e + 4 >> 2] = 5;
                    x2[e + 8 >> 2] = 191;
                    x2[e + 12 >> 2] = 35387;
                    for (var g2 = 0; 32 > g2; g2++) u3[e + g2 + 17] = a[g2] || 0;
                  }
                  return 0;
                case 21510:
                case 21511:
                case 21512:
                  return d.tty ? 0 : -59;
                case 21506:
                case 21507:
                case 21508:
                  if (!d.tty) return -59;
                  if (d.tty.Ea.Mb) for (e = E2(), a = [], g2 = 0; 32 > g2; g2++) a.push(u3[e + g2 + 17]);
                  return 0;
                case 21519:
                  if (!d.tty) return -59;
                  e = E2();
                  return x2[e >> 2] = 0;
                case 21520:
                  return d.tty ? -28 : -59;
                case 21531:
                  return e = E2(), G2.$a(d, b2, e);
                case 21523:
                  if (!d.tty) return -59;
                  d.tty.Ea.Nb && (g2 = [24, 80], e = E2(), sa[e >> 1] = g2[0], sa[e + 2 >> 1] = g2[1]);
                  return 0;
                case 21524:
                  return d.tty ? 0 : -59;
                case 21515:
                  return d.tty ? 0 : -59;
                default:
                  return -28;
              }
            } catch (h3) {
              if ("undefined" == typeof G2 || "ErrnoError" !== h3.name) throw h3;
              return -h3.xa;
            }
          },
          E: function(a, b2, c, d) {
            Pa = d;
            try {
              b2 = b2 ? B2(w2, b2) : "";
              b2 = Gb(a, b2);
              var e = d ? E2() : 0;
              return G2.open(b2, c, e).fd;
            } catch (g2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== g2.name) throw g2;
              return -g2.xa;
            }
          },
          V: function(a, b2, c, d) {
            try {
              return b2 = b2 ? B2(w2, b2) : "", d = d ? B2(w2, d) : "", b2 = Gb(a, b2), d = Gb(c, d), G2.rename(b2, d), 0;
            } catch (e) {
              if ("undefined" == typeof G2 || "ErrnoError" !== e.name) throw e;
              return -e.xa;
            }
          },
          U: function(a, b2) {
            try {
              a = a ? B2(w2, a) : "";
              var c = G2.stat, d = c(a);
              x2[b2 >> 2] = d.dev;
              x2[b2 + 4 >> 2] = d.mode;
              y2[b2 + 8 >> 2] = d.nlink;
              x2[b2 + 12 >> 2] = d.uid;
              x2[b2 + 16 >> 2] = d.gid;
              x2[b2 + 20 >> 2] = d.rdev;
              z3[b2 + 24 >> 3] = BigInt(d.size);
              x2[b2 + 32 >> 2] = 4096;
              x2[b2 + 36 >> 2] = d.blocks;
              var e = d.atime.getTime(), g2 = d.mtime.getTime(), h3 = d.ctime.getTime();
              z3[b2 + 40 >> 3] = BigInt(Math.floor(e / 1e3));
              y2[b2 + 48 >> 2] = e % 1e3 * 1e6;
              z3[b2 + 56 >> 3] = BigInt(Math.floor(g2 / 1e3));
              y2[b2 + 64 >> 2] = g2 % 1e3 * 1e6;
              z3[b2 + 72 >> 3] = BigInt(Math.floor(h3 / 1e3));
              y2[b2 + 80 >> 2] = h3 % 1e3 * 1e6;
              z3[b2 + 88 >> 3] = BigInt(d.ino);
              return 0;
            } catch (k2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== k2.name) throw k2;
              return -k2.xa;
            }
          },
          T: function(a, b2, c) {
            try {
              return b2 = b2 ? B2(w2, b2) : "", b2 = Gb(a, b2), 0 === c ? G2.unlink(b2) : 512 === c ? G2.rmdir(b2) : A("Invalid flags passed to unlinkat"), 0;
            } catch (d) {
              if ("undefined" == typeof G2 || "ErrnoError" !== d.name) throw d;
              return -d.xa;
            }
          },
          Q: () => A(""),
          O: () => {
          },
          M: () => {
            throw Infinity;
          },
          W: function(a, b2) {
            a = -9007199254740992 > a || 9007199254740992 < a ? NaN : Number(a);
            a = new Date(1e3 * a);
            x2[b2 >> 2] = a.getSeconds();
            x2[b2 + 4 >> 2] = a.getMinutes();
            x2[b2 + 8 >> 2] = a.getHours();
            x2[b2 + 12 >> 2] = a.getDate();
            x2[b2 + 16 >> 2] = a.getMonth();
            x2[b2 + 20 >> 2] = a.getFullYear() - 1900;
            x2[b2 + 24 >> 2] = a.getDay();
            var c = a.getFullYear();
            x2[b2 + 28 >> 2] = (0 !== c % 4 || 0 === c % 100 && 0 !== c % 400 ? Ib : Hb)[a.getMonth()] + a.getDate() - 1 | 0;
            x2[b2 + 36 >> 2] = -(60 * a.getTimezoneOffset());
            c = new Date(a.getFullYear(), 6, 1).getTimezoneOffset();
            var d = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
            x2[b2 + 32 >> 2] = (c != d && a.getTimezoneOffset() == Math.min(d, c)) | 0;
          },
          P: (a, b2) => {
            Jb[a] && (clearTimeout(Jb[a].id), delete Jb[a]);
            if (!b2) return 0;
            var c = setTimeout(() => {
              delete Jb[a];
              Nb(() => Ub(a, performance.now()));
            }, b2);
            Jb[a] = { id: c, nc: b2 };
            return 0;
          },
          H: (a, b2, c, d) => {
            var e = (/* @__PURE__ */ new Date()).getFullYear(), g2 = new Date(e, 0, 1).getTimezoneOffset();
            e = new Date(e, 6, 1).getTimezoneOffset();
            y2[a >> 2] = 60 * Math.max(g2, e);
            x2[b2 >> 2] = Number(g2 != e);
            b2 = (h3) => {
              var k2 = Math.abs(h3);
              return `UTC${0 <= h3 ? "-" : "+"}${String(Math.floor(k2 / 60)).padStart(2, "0")}${String(k2 % 60).padStart(2, "0")}`;
            };
            a = b2(g2);
            b2 = b2(e);
            e < g2 ? (bb(a, w2, c, 17), bb(b2, w2, d, 17)) : (bb(a, w2, d, 17), bb(b2, w2, c, 17));
          },
          F: () => Date.now(),
          S: (a) => {
            var b2 = w2.length;
            a >>>= 0;
            if (2147483648 < a) return false;
            for (var c = 1; 4 >= c; c *= 2) {
              var d = b2 * (1 + 0.2 / c);
              d = Math.min(d, a + 100663296);
              a: {
                d = (Math.min(2147483648, 65536 * Math.ceil(Math.max(a, d) / 65536)) - pa.buffer.byteLength + 65535) / 65536 | 0;
                try {
                  pa.grow(d);
                  ta();
                  var e = 1;
                  break a;
                } catch (g2) {
                }
                e = void 0;
              }
              if (e) return true;
            }
            return false;
          },
          Y: (a, b2) => {
            var c = 0;
            Qb().forEach((d, e) => {
              var g2 = b2 + c;
              e = y2[a + 4 * e >> 2] = g2;
              for (g2 = 0; g2 < d.length; ++g2) u3[e++] = d.charCodeAt(g2);
              u3[e] = 0;
              c += d.length + 1;
            });
            return 0;
          },
          Z: (a, b2) => {
            var c = Qb();
            y2[a >> 2] = c.length;
            var d = 0;
            c.forEach((e) => d += e.length + 1);
            y2[b2 >> 2] = d;
            return 0;
          },
          t: Mb,
          C: function(a) {
            try {
              var b2 = U2(a);
              G2.close(b2);
              return 0;
            } catch (c) {
              if ("undefined" == typeof G2 || "ErrnoError" !== c.name) throw c;
              return c.xa;
            }
          },
          $: function(a, b2, c, d) {
            try {
              a: {
                var e = U2(a);
                a = b2;
                for (var g2, h3 = b2 = 0; h3 < c; h3++) {
                  var k2 = y2[a >> 2], m2 = y2[a + 4 >> 2];
                  a += 8;
                  var n = G2.read(e, u3, k2, m2, g2);
                  if (0 > n) {
                    var l = -1;
                    break a;
                  }
                  b2 += n;
                  if (n < m2) break;
                  "undefined" != typeof g2 && (g2 += n);
                }
                l = b2;
              }
              y2[d >> 2] = l;
              return 0;
            } catch (q2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== q2.name) throw q2;
              return q2.xa;
            }
          },
          X: function(a, b2, c, d) {
            b2 = -9007199254740992 > b2 || 9007199254740992 < b2 ? NaN : Number(b2);
            try {
              if (isNaN(b2)) return 61;
              var e = U2(a);
              G2.va(e, b2, c);
              z3[d >> 3] = BigInt(e.position);
              e.Xa && 0 === b2 && 0 === c && (e.Xa = null);
              return 0;
            } catch (g2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== g2.name) throw g2;
              return g2.xa;
            }
          },
          _: function(a, b2, c, d) {
            try {
              a: {
                var e = U2(a);
                a = b2;
                for (var g2, h3 = b2 = 0; h3 < c; h3++) {
                  var k2 = y2[a >> 2], m2 = y2[a + 4 >> 2];
                  a += 8;
                  var n = G2.write(e, u3, k2, m2, g2);
                  if (0 > n) {
                    var l = -1;
                    break a;
                  }
                  b2 += n;
                  if (n < m2) break;
                  "undefined" != typeof g2 && (g2 += n);
                }
                l = b2;
              }
              y2[d >> 2] = l;
              return 0;
            } catch (q2) {
              if ("undefined" == typeof G2 || "ErrnoError" !== q2.name) throw q2;
              return q2.xa;
            }
          },
          G: Vb,
          b: Wb,
          c: Xb,
          h: Yb,
          m: Zb,
          J: $b,
          z: ac,
          p: bc,
          x: cc,
          v: dc,
          y: ec,
          I: fc,
          i: gc,
          e: hc,
          f: ic,
          k: jc,
          l: kc,
          L: lc,
          r: mc,
          s: nc,
          u: oc,
          A: (a) => a,
          N: Lb
        }, X2;
        (async function() {
          ya++;
          var a = { a: pc };
          Ca ??= Ba("qpdf.wasm") ? "qpdf.wasm" : f.locateFile ? f.locateFile("qpdf.wasm", p) : p + "qpdf.wasm";
          try {
            var b2 = await Fa(a);
            X2 = b2.instance.exports;
            pa = X2.aa;
            ta();
            V2 = X2.da;
            va.unshift(X2.ba);
            Aa();
            return b2;
          } catch (c) {
            ba(c);
          }
        })();
        var qc = f._main = (a, b2) => (qc = f._main = X2.ca)(a, b2), Ub = (a, b2) => (Ub = X2.ea)(a, b2), W2 = (a, b2) => (W2 = X2.fa)(a, b2), Ma = (a) => (Ma = X2.ga)(a), Y = (a) => (Y = X2.ha)(a), rc = (a) => (rc = X2.ia)(a), Z = () => (Z = X2.ja)(), Tb = (a) => (Tb = X2.ka)(a), Rb = (a) => (Rb = X2.la)(a), Na = (a, b2, c) => (Na = X2.ma)(a, b2, c), Sb = (a) => (Sb = X2.na)(a);
        function Xb(a, b2, c) {
          var d = Z();
          try {
            return V2.get(a)(b2, c);
          } catch (e) {
            Y(d);
            if (e !== e + 0) throw e;
            W2(1, 0);
          }
        }
        function Wb(a, b2) {
          var c = Z();
          try {
            return V2.get(a)(b2);
          } catch (d) {
            Y(c);
            if (d !== d + 0) throw d;
            W2(1, 0);
          }
        }
        function bc(a, b2, c, d, e, g2, h3) {
          var k2 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2, h3);
          } catch (m2) {
            Y(k2);
            if (m2 !== m2 + 0) throw m2;
            W2(1, 0);
          }
        }
        function ic(a, b2, c) {
          var d = Z();
          try {
            V2.get(a)(b2, c);
          } catch (e) {
            Y(d);
            if (e !== e + 0) throw e;
            W2(1, 0);
          }
        }
        function hc(a, b2) {
          var c = Z();
          try {
            V2.get(a)(b2);
          } catch (d) {
            Y(c);
            if (d !== d + 0) throw d;
            W2(1, 0);
          }
        }
        function gc(a) {
          var b2 = Z();
          try {
            V2.get(a)();
          } catch (c) {
            Y(b2);
            if (c !== c + 0) throw c;
            W2(1, 0);
          }
        }
        function Yb(a, b2, c, d) {
          var e = Z();
          try {
            return V2.get(a)(b2, c, d);
          } catch (g2) {
            Y(e);
            if (g2 !== g2 + 0) throw g2;
            W2(1, 0);
          }
        }
        function lc(a, b2, c, d, e, g2) {
          var h3 = Z();
          try {
            V2.get(a)(b2, c, d, e, g2);
          } catch (k2) {
            Y(h3);
            if (k2 !== k2 + 0) throw k2;
            W2(1, 0);
          }
        }
        function jc(a, b2, c, d) {
          var e = Z();
          try {
            V2.get(a)(b2, c, d);
          } catch (g2) {
            Y(e);
            if (g2 !== g2 + 0) throw g2;
            W2(1, 0);
          }
        }
        function Zb(a, b2, c, d, e) {
          var g2 = Z();
          try {
            return V2.get(a)(b2, c, d, e);
          } catch (h3) {
            Y(g2);
            if (h3 !== h3 + 0) throw h3;
            W2(1, 0);
          }
        }
        function kc(a, b2, c, d, e) {
          var g2 = Z();
          try {
            V2.get(a)(b2, c, d, e);
          } catch (h3) {
            Y(g2);
            if (h3 !== h3 + 0) throw h3;
            W2(1, 0);
          }
        }
        function ac(a, b2, c, d, e, g2) {
          var h3 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2);
          } catch (k2) {
            Y(h3);
            if (k2 !== k2 + 0) throw k2;
            W2(1, 0);
          }
        }
        function ec(a, b2, c, d, e, g2) {
          var h3 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2);
          } catch (k2) {
            Y(h3);
            if (k2 !== k2 + 0) throw k2;
            W2(1, 0);
          }
        }
        function $b(a, b2, c, d, e, g2) {
          var h3 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2);
          } catch (k2) {
            Y(h3);
            if (k2 !== k2 + 0) throw k2;
            W2(1, 0);
          }
        }
        function fc(a, b2, c) {
          var d = Z();
          try {
            return V2.get(a)(b2, c);
          } catch (e) {
            Y(d);
            if (e !== e + 0) throw e;
            W2(1, 0);
          }
        }
        function cc(a, b2, c, d, e, g2, h3, k2) {
          var m2 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2, h3, k2);
          } catch (n) {
            Y(m2);
            if (n !== n + 0) throw n;
            W2(1, 0);
          }
        }
        function mc(a, b2, c, d, e, g2, h3, k2) {
          var m2 = Z();
          try {
            V2.get(a)(b2, c, d, e, g2, h3, k2);
          } catch (n) {
            Y(m2);
            if (n !== n + 0) throw n;
            W2(1, 0);
          }
        }
        function dc(a, b2, c, d, e, g2, h3, k2, m2, n, l, q2) {
          var C2 = Z();
          try {
            return V2.get(a)(b2, c, d, e, g2, h3, k2, m2, n, l, q2);
          } catch (I2) {
            Y(C2);
            if (I2 !== I2 + 0) throw I2;
            W2(1, 0);
          }
        }
        function nc(a, b2, c, d, e, g2, h3, k2, m2, n, l) {
          var q2 = Z();
          try {
            V2.get(a)(b2, c, d, e, g2, h3, k2, m2, n, l);
          } catch (C2) {
            Y(q2);
            if (C2 !== C2 + 0) throw C2;
            W2(1, 0);
          }
        }
        function oc(a, b2, c, d, e, g2, h3, k2, m2, n, l, q2, C2, I2, v2, t3) {
          var K3 = Z();
          try {
            V2.get(a)(b2, c, d, e, g2, h3, k2, m2, n, l, q2, C2, I2, v2, t3);
          } catch (L3) {
            Y(K3);
            if (L3 !== L3 + 0) throw L3;
            W2(1, 0);
          }
        }
        function Vb(a, b2, c) {
          var d = Z();
          try {
            return V2.get(a)(b2, c);
          } catch (e) {
            Y(d);
            if (e !== e + 0) throw e;
            W2(1, 0);
          }
        }
        f.callMain = sc;
        f.ENV = Ob;
        f.FS = G2;
        f.NODEFS = P2;
        f.WORKERFS = R3;
        var tc;
        za = function uc() {
          tc || vc();
          tc || (za = uc);
        };
        function sc(a = []) {
          var b2 = qc;
          a.unshift(ja5);
          var c = a.length, d = rc(4 * (c + 1)), e = d;
          a.forEach((h3) => {
            var k2 = y2, m2 = e >> 2, n = ab(h3) + 1, l = rc(n);
            bb(h3, w2, l, n);
            k2[m2] = l;
            e += 4;
          });
          y2[e >> 2] = 0;
          try {
            var g2 = b2(c, d);
            Mb(g2, true);
            return g2;
          } catch (h3) {
            return Kb(h3);
          }
        }
        function vc() {
          var a = ia;
          if (!(0 < ya)) {
            if (f.preRun) for ("function" == typeof f.preRun && (f.preRun = [f.preRun]); f.preRun.length; ) {
              var b2 = f.preRun.shift();
              ua.unshift(b2);
            }
            Ha(ua);
            0 < ya || tc || (tc = true, f.calledRun = true, qa || (f.noFSInit || G2.Za || G2.Pa(), G2.Ya = false, Ha(va), Ha(wa), aa(f), wc && sc(a), Ha(xa)));
          }
        }
        var wc = true;
        f.noInitialRun && (wc = false);
        vc();
        Object.assign(G2, { init: G2.Pa, mkdir: G2.mkdir, mount: G2.sa, unlink: G2.unlink, unmount: G2.Tb, chdir: G2.chdir, writeFile: G2.writeFile, readFile: G2.readFile, createLazyFile: G2.Eb, setIgnorePermissions: function(a) {
          G2.Ya = a;
        } });
        moduleRtn = ca;
        return moduleRtn;
      });
    })();
global.SOQpdfFactory = Module;
})(window);

/* Base64 Kit — everything runs locally with TextEncoder/btoa/atob. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var MAX_FILE = 50 * 1024 * 1024; // shortcut: whole file held in memory as one string; stream if users need >50 MB

  // ---------- core ----------
  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function toUrlSafe(b64) { return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function wrap76(s) { return s.replace(/(.{76})(?=.)/g, "$1\n"); }

  // Accepts standard, URL-safe, missing padding, whitespace/newlines and "data:…;base64," prefixes.
  function b64ToBytes(input) {
    var s = String(input).trim(), mime = "";
    var m = /^data:([^;,]*)(?:;[^,]*)?;base64,/i.exec(s);
    if (m) { mime = m[1]; s = s.slice(m[0].length); }
    s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error("Contains characters that are not Base64");
    s = s.replace(/=+$/, "");
    if (s.length % 4 === 1) throw new Error("Wrong length — a character is missing or extra");
    s += "===".slice(0, (4 - s.length % 4) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, mime: mime };
  }
  function encodeText(text, urlSafe) {
    var b = bytesToB64(new TextEncoder().encode(text));
    return urlSafe ? toUrlSafe(b) : b;
  }
  function decodeText(b64) {
    var r = b64ToBytes(b64);
    return new TextDecoder("utf-8", { fatal: true }).decode(r.bytes);
  }

  var MAGIC = [
    { sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], type: "PNG image", mime: "image/png", ext: "png" },
    { sig: [0xFF, 0xD8, 0xFF], type: "JPEG image", mime: "image/jpeg", ext: "jpg" },
    { sig: [0x47, 0x49, 0x46, 0x38], type: "GIF image", mime: "image/gif", ext: "gif" },
    { sig: [0x52, 0x49, 0x46, 0x46, -1, -1, -1, -1, 0x57, 0x45, 0x42, 0x50], type: "WebP image", mime: "image/webp", ext: "webp" },
    { sig: [0x42, 0x4D], type: "BMP image", mime: "image/bmp", ext: "bmp" },
    { sig: [0x25, 0x50, 0x44, 0x46, 0x2D], type: "PDF document", mime: "application/pdf", ext: "pdf" },
    { sig: [0x50, 0x4B, 0x03, 0x04], type: "ZIP archive (also docx/xlsx/apk)", mime: "application/zip", ext: "zip" },
    { sig: [0x1F, 0x8B], type: "Gzip archive", mime: "application/gzip", ext: "gz" },
    { sig: [0x49, 0x44, 0x33], type: "MP3 audio", mime: "audio/mpeg", ext: "mp3" },
    { sig: [0x4F, 0x67, 0x67, 0x53], type: "Ogg media", mime: "audio/ogg", ext: "ogg" },
    { sig: [0x00, 0x00, 0x00, -1, 0x66, 0x74, 0x79, 0x70], type: "MP4 / MOV video", mime: "video/mp4", ext: "mp4" },
    { sig: [0x77, 0x4F, 0x46, 0x32], type: "WOFF2 font", mime: "font/woff2", ext: "woff2" }
  ];
  function detect(bytes) {
    for (var i = 0; i < MAGIC.length; i++) {
      var s = MAGIC[i].sig, ok = bytes.length >= s.length;
      for (var j = 0; ok && j < s.length; j++) if (s[j] !== -1 && bytes[j] !== s[j]) ok = false;
      if (ok) return MAGIC[i];
    }
    try {
      var t = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 4096));
      if (/^\s*<svg[\s>]|^\s*<\?xml[^>]*>\s*<svg/i.test(t)) return { type: "SVG image", mime: "image/svg+xml", ext: "svg" };
      if (/^\s*[{[]/.test(t)) return { type: "JSON / text", mime: "application/json", ext: "json" };
      return { type: "Text", mime: "text/plain", ext: "txt" };
    } catch (e) { return { type: "Binary data", mime: "application/octet-stream", ext: "bin" }; }
  }
  var PREVIEW = /^image\/(png|jpeg|gif|webp|bmp)$/; // raster only: never render user SVG

  // ---------- text panel ----------
  var plain = $("#plain"), code = $("#code"), status = $("#codeStatus");
  var urlsafe = $("#urlsafe"), wrap = $("#wrap");
  urlsafe.checked = !!S3.store("b64.urlsafe"); wrap.checked = !!S3.store("b64.wrap");

  function setStatus(cls, msg) { status.className = "chip " + cls; status.textContent = msg; }
  function encodeNow() {
    var t = plain.value, b = encodeText(t, urlsafe.checked);
    code.value = wrap.checked ? wrap76(b) : b;
    $("#plainInfo").textContent = new TextEncoder().encode(t).length.toLocaleString() + " bytes · " + [...t].length.toLocaleString() + " characters";
    setStatus(t ? "ok" : "", t ? "Encoded · " + b.length.toLocaleString() + " chars" : "Waiting");
  }
  function decodeNow() {
    var v = code.value;
    if (!v.trim()) { plain.value = ""; $("#plainInfo").textContent = "0 bytes"; setStatus("", "Waiting"); return; }
    try {
      var r = b64ToBytes(v);
      try {
        plain.value = new TextDecoder("utf-8", { fatal: true }).decode(r.bytes);
        $("#plainInfo").textContent = r.bytes.length.toLocaleString() + " bytes decoded";
        setStatus("ok", "Valid Base64 · UTF-8 text");
      } catch (e) {
        var d = detect(r.bytes);
        plain.value = "";
        $("#plainInfo").textContent = r.bytes.length.toLocaleString() + " bytes of binary data";
        setStatus("warn", "Not text — looks like " + d.type + ". Use Base64 → File below");
        $("#binIn").value = v; renderBin();
      }
    } catch (e) { setStatus("bad", e.message); }
  }
  plain.addEventListener("input", S3.debounce(encodeNow, 120));
  code.addEventListener("input", S3.debounce(decodeNow, 150));
  [urlsafe, wrap].forEach(function (c) {
    c.addEventListener("change", function () { S3.store("b64.urlsafe", urlsafe.checked); S3.store("b64.wrap", wrap.checked); if (plain.value) encodeNow(); });
  });
  $("#clear").addEventListener("click", function () { plain.value = ""; code.value = ""; encodeNow(); plain.focus(); });
  $("#copyPlain").addEventListener("click", function () { if (plain.value) { S3.copy(plain.value); S3.done(); } else S3.toast("Nothing to copy yet", "error"); });
  $("#copyCode").addEventListener("click", function () { if (code.value) { S3.copy(code.value); S3.done(); } else S3.toast("Nothing to copy yet", "error"); });

  // ---------- file -> base64 ----------
  var file = { name: "", b64: "", mime: "", mode: S3.store("b64.fileMode") || "b64" };
  function fileText() { return file.mode === "uri" ? "data:" + file.mime + ";base64," + file.b64 : file.b64; }
  function showFile() {
    var t = fileText();
    $("#fileOut").value = t;
    $("#fileLen").textContent = t.length.toLocaleString() + " characters";
  }
  $$("#fileMode button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.v === file.mode));
    b.addEventListener("click", function () {
      $$("#fileMode button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      file.mode = b.dataset.v; S3.store("b64.fileMode", file.mode); showFile();
    });
  });
  function loadFile(f) {
    if (f.size > MAX_FILE) { S3.toast("That file is over 50 MB — too big to Base64 in a browser tab", "error"); return; }
    S3.readFile(f).then(function (buf) {
      var bytes = new Uint8Array(buf), d = detect(bytes);
      file.name = f.name; file.b64 = bytesToB64(bytes); file.mime = f.type || d.mime;
      $("#fileBox").hidden = false;
      $("#fileType").textContent = d.type;
      $("#fileMeta").textContent = f.name + " · " + S3.fmtBytes(f.size);
      var prev = $("#filePrev");
      if (PREVIEW.test(d.mime)) { prev.src = "data:" + d.mime + ";base64," + file.b64; prev.hidden = false; } else { prev.hidden = true; prev.removeAttribute("src"); }
      showFile(); S3.done();
    });
  }
  S3.drop($("#drop"), function (files) { if (files[0]) loadFile(files[0]); });
  $("#fileCopy").addEventListener("click", function () { S3.copy(fileText()); S3.done(); });
  $("#fileSave").addEventListener("click", function () { S3.download(fileText(), (file.name || "file") + ".b64.txt", "text/plain"); S3.done(); });

  // ---------- base64 -> file ----------
  var bin = { bytes: null, mime: "" };
  function renderBin() {
    var v = $("#binIn").value, chip = $("#binType"), prev = $("#binPrev");
    bin.bytes = null; $("#binSave").disabled = true; prev.hidden = true; $("#binMeta").textContent = "";
    if (!v.trim()) { chip.className = "chip"; chip.textContent = "Paste Base64 to detect the file type"; return; }
    try {
      var r = b64ToBytes(v), d = detect(r.bytes);
      bin.bytes = r.bytes; bin.mime = d.mime === "application/octet-stream" && r.mime ? r.mime : d.mime;
      chip.className = "chip ok"; chip.textContent = d.type;
      $("#binMeta").textContent = S3.fmtBytes(r.bytes.length) + (r.mime && r.mime !== d.mime ? " · data URI says " + r.mime : "");
      var name = $("#binName");
      name.value = name.value.replace(/\.[A-Za-z0-9]+$/, "") + "." + d.ext;
      if (PREVIEW.test(d.mime)) { prev.src = URL.createObjectURL(new Blob([r.bytes], { type: d.mime })); prev.hidden = false; }
      $("#binSave").disabled = false;
    } catch (e) { chip.className = "chip bad"; chip.textContent = e.message; }
  }
  $("#binIn").addEventListener("input", S3.debounce(renderBin, 200));
  $("#binPrev").addEventListener("load", function () { if (this.src.indexOf("blob:") === 0) URL.revokeObjectURL(this.src); });
  $("#binSave").addEventListener("click", function () {
    if (!bin.bytes) return;
    S3.download(new Blob([bin.bytes], { type: bin.mime }), $("#binName").value.trim() || "decoded.bin");
    S3.done();
  });

  encodeNow();

  // 1x1 transparent PNG, used by the demo and the self-test.
  var PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  window.S3_DEMO = function () {
    plain.value = "Hello, world! 👋 مرحبا بالعالم";
    encodeNow();
    var c = document.createElement("canvas"); c.width = 320; c.height = 120;
    var g = c.getContext("2d"), grad = g.createLinearGradient(0, 0, 320, 120);
    grad.addColorStop(0, "#3dd6d0"); grad.addColorStop(1, "#6366f1");
    g.fillStyle = grad; g.fillRect(0, 0, 320, 120);
    g.fillStyle = "#fff"; g.font = "bold 44px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("Base64 ✓", 160, 62);
    $("#binIn").value = c.toDataURL("image/png");
    renderBin();
  };

  window.S3_SELFTEST = function () {
    // RFC 4648 §10 test vectors
    var v = { "": "", f: "Zg==", fo: "Zm8=", foo: "Zm9v", foob: "Zm9vYg==", fooba: "Zm9vYmE=", foobar: "Zm9vYmFy" };
    for (var k in v) { if (encodeText(k) !== v[k] || decodeText(v[k]) !== k) return "rfc4648 " + k; }
    if (encodeText("✓") !== "4pyT") return "utf8 enc";
    var ar = "مرحبا 👋";
    if (decodeText(encodeText(ar)) !== ar || decodeText(encodeText(ar, true)) !== ar) return "utf8 roundtrip";
    if (bytesToB64(new Uint8Array([0xfb, 0xff])) !== "+/8=" || toUrlSafe("+/8=") !== "-_8") return "urlsafe";
    if (b64ToBytes("-_8").bytes[1] !== 0xff || decodeText("Zm9v\nYmFy") !== "foobar") return "lenient decode";
    try { b64ToBytes("Zm9v!"); return "bad char accepted"; } catch (e) { /* expected */ }
    if (detect(b64ToBytes(PNG1).bytes).ext !== "png") return "magic png";
    if (detect(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31])).ext !== "pdf") return "magic pdf";
    if (detect(new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0])).ext !== "zip") return "magic zip";
    if (b64ToBytes("data:text/plain;base64,aGk=").mime !== "text/plain") return "data uri";
    if (wrap76("A".repeat(80)) !== "A".repeat(76) + "\nAAAA") return "wrap";
    return true;
  };
})();

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { spawnSync } = require("node:child_process");
const { pdfFixture } = require("./fixture.cjs");
const { pdfToText, extractPageText, getTotalPages, DrivePdfError } = require("gdrive-pdftotext");

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const link = "https://drive.google.com/file/d/test_file-123/view";
const upload = "https://drive.google.com/viewerng/upload?ds=example";
const json = value => new Response(")]}'\n" + JSON.stringify(value));
const errorCode = code => error => error instanceof DrivePdfError && error.code === code;

test("CJS and native ESM package entry points work", async () => {
    const esm = await import("gdrive-pdftotext");
    assert.equal(typeof esm.default.pdfToText, "function");
    assert.equal(typeof esm.pdfToText, "function");
    const run = spawnSync(process.execPath, [
        "--input-type=module", "-e",
        "import pdf, {pdfToText} from 'gdrive-pdftotext'; if(typeof pdf.pdfToText !== 'function' || typeof pdfToText !== 'function') process.exit(1)",
    ], { cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
});

test("downloads and parses a PDF, preserves page breaks and resource keys", async () => {
    global.fetch = async input => {
        const url = new URL(input);
        assert.equal(url.hostname, "drive.usercontent.google.com");
        assert.equal(url.searchParams.get("id"), "test_file-123");
        assert.equal(url.searchParams.get("resourcekey"), "key");
        return new Response(pdfFixture());
    };
    assert.equal(await pdfToText(`${link}?resourcekey=key`), "Hello PDF\n\nSecond page");
});

test("ESM entry can also dynamically load the PDF parser", async () => {
    global.fetch = async () => new Response(pdfFixture(["ESM PDF"]));
    const { pdfToText: esmExtract } = await import("gdrive-pdftotext");
    assert.equal(await esmExtract(link), "ESM PDF");
});

test("empty text pages return strings, not undefined", async () => {
    global.fetch = async () => new Response(pdfFixture([""]));
    assert.equal(await pdfToText(link), "");
    assert.equal(await extractPageText("id", 0), "");
});

test("validates file links before any fetch", async () => {
    global.fetch = async () => assert.fail("must not fetch");
    for (const url of [
        "not a URL", "http://drive.google.com/file/d/test/view",
        "https://evil.test/file/d/test/view", "https://drive.google.com.evil.test/file/d/test/view",
        "https://user:password@drive.google.com/file/d/test/view",
        "https://drive.google.com:8443/file/d/test/view",
        "https://drive.google.com/open?id=../../evil",
        "https://drive.google.com/",
    ]) await assert.rejects(pdfToText(url), errorCode("INVALID_URL"));
});

test("supports open and uc link formats", async () => {
    global.fetch = async () => new Response(pdfFixture(["Supported"]));
    for (const path of ["/open?id=abc", "/uc?id=abc", "/file/d/abc/preview", "/file/d/abc"]) {
        assert.equal(await pdfToText(`https://drive.google.com${path}`), "Supported");
    }
});

test("HTTP errors are explicit, permanent failures are not retried", async () => {
    for (const [status, code] of [[401, "ACCESS_DENIED"], [403, "ACCESS_DENIED"], [404, "FILE_NOT_FOUND"]]) {
        let calls = 0;
        global.fetch = async () => { calls++; return new Response("error", { status }); };
        await assert.rejects(pdfToText(link), error => errorCode(code)(error) && error.status === status);
        assert.equal(calls, 1);
    }
    global.fetch = async () => new Response("Forbidden", { status: 403 });
    await assert.rejects(extractPageText("id", 2), errorCode("ACCESS_DENIED"));
});

test("non-PDF responses do not trigger viewer fallback", async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return new Response("<html>Download unavailable</html>"); };
    await assert.rejects(pdfToText(link), errorCode("DOWNLOAD_UNAVAILABLE"));
    assert.equal(calls, 1);
});

test("malformed PDFs fail explicitly", async () => {
    global.fetch = async () => new Response("%PDF-1.7\nbroken");
    await assert.rejects(pdfToText(link), errorCode("INVALID_PDF"));
});

test("encrypted PDFs accept correct passwords and reject missing/wrong passwords", async () => {
    global.fetch = async () => new Response(pdfFixture(["Password protected"], "secret"));
    await assert.rejects(pdfToText(link), errorCode("PASSWORD_REQUIRED"));
    await assert.rejects(pdfToText(link, "incorrect"), errorCode("PASSWORD_REQUIRED"));
    assert.equal(await pdfToText(link, "secret"), "Password protected");
});

test("blocks unsafe redirects without following them", async () => {
    for (const target of ["http://127.0.0.1/", "https://evil.test/", "https://drive.google.com/other"]) {
        let calls = 0;
        global.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }); };
        await assert.rejects(pdfToText(link), error => ["INVALID_URL", "UNSAFE_URL"].includes(error.code));
        assert.equal(calls, 1);
    }
});

test("follows allowed redirects with a finite limit", async () => {
    let calls = 0;
    global.fetch = async () => ++calls === 1
        ? new Response(null, { status: 302, headers: { location: "https://drive.usercontent.google.com/download?id=abc" } })
        : new Response(pdfFixture(["Redirect"]));
    assert.equal(await pdfToText(link), "Redirect");
    global.fetch = async () => new Response(null, { status: 302, headers: { location: "/download?id=abc" } });
    await assert.rejects(pdfToText(link), errorCode("REDIRECT_ERROR"));
});

test("retries transient HTTP and network failures, but not forever", async () => {
    let calls = 0;
    global.fetch = async () => ++calls < 3 ? new Response(null, { status: 503 }) : new Response(pdfFixture(["Retried"]));
    assert.equal(await pdfToText(link, undefined, { retryDelayMs: 0 }), "Retried");
    assert.equal(calls, 3);
    calls = 0;
    global.fetch = async () => { calls++; throw new TypeError("network unavailable"); };
    await assert.rejects(pdfToText(link, undefined, { retryDelayMs: 0, retries: 1 }), errorCode("NETWORK_ERROR"));
    assert.equal(calls, 2);
});

test("respects Retry-After and refuses excessive waits", async () => {
    let calls = 0;
    const started = Date.now();
    global.fetch = async () => ++calls === 1
        ? new Response(null, { status: 429, headers: { "retry-after": "1" } })
        : new Response(pdfFixture(["Waited"]));
    assert.equal(await pdfToText(link, undefined, { retryDelayMs: 0 }), "Waited");
    assert.ok(Date.now() - started >= 950);
    calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { "retry-after": "300" } }); };
    await assert.rejects(pdfToText(link), errorCode("RATE_LIMITED"));
    assert.equal(calls, 1);
});

test("timeouts include stalled response bodies", async () => {
    global.fetch = async (_, { signal }) => new Response(new ReadableStream({
        start(controller) {
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
        },
    }));
    // Keep Node alive while AbortSignal.timeout's unref'ed timer runs.
    const keepAlive = setTimeout(() => {}, 500);
    try {
        await assert.rejects(pdfToText(link, undefined, { timeoutMs: 20 }), errorCode("TIMEOUT"));
    } finally { clearTimeout(keepAlive); }
});

test("cancellation stops active requests and retry waits", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    global.fetch = async () => assert.fail("must not fetch");
    await assert.rejects(pdfToText(link, undefined, { signal: preAborted.signal }), { name: "AbortError" });
    await assert.rejects(extractPageText("id", 0, undefined, { signal: preAborted.signal }), { name: "AbortError" });
    const controller = new AbortController();
    let calls = 0;
    global.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
    const job = pdfToText(link, undefined, { signal: controller.signal, retryDelayMs: 1000 });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(job, { name: "AbortError" });
    assert.equal(calls, 1);
});

test("cancellation interrupts response-body consumption", async () => {
    const controller = new AbortController();
    let cancelled = false;
    global.fetch = async (_, { signal }) => new Response(new ReadableStream({
        start(stream) {
            signal.addEventListener("abort", () => {
                cancelled = true;
                stream.error(signal.reason);
            }, { once: true });
        },
    }));
    const job = pdfToText(link, undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(job, { name: "AbortError" });
    assert.equal(cancelled, true);
});

test("enforces byte limits with and without Content-Length", async () => {
    global.fetch = async () => new Response("too large", { headers: { "content-length": "999" } });
    await assert.rejects(pdfToText(link, undefined, { maxBytes: 8 }), errorCode("SIZE_LIMIT"));
    global.fetch = async () => new Response("too large");
    await assert.rejects(pdfToText(link, undefined, { maxBytes: 8 }), errorCode("SIZE_LIMIT"));
});

test("enforces PDF page limits and validates options", async () => {
    global.fetch = async () => new Response(pdfFixture());
    await assert.rejects(pdfToText(link, undefined, { maxPages: 1 }), errorCode("PAGE_LIMIT"));
    for (const options of [{ concurrency: 0 }, { concurrency: 33 }, { retries: -1 }, { retries: 11 }, { timeoutMs: NaN }, { timeoutMs: 2 ** 31 }, { retryDelayMs: 2 ** 31 }, { maxBytes: 1.5 }, { method: "other" }]) {
        await assert.rejects(pdfToText(link, undefined, options), errorCode("INVALID_OPTIONS"));
    }
});

test("legacy viewer fails clearly on modern Drive HTML", async () => {
    global.fetch = async () => new Response("<html>Modern viewer</html>");
    await assert.rejects(pdfToText(link, undefined, { method: "viewer" }), errorCode("UNSUPPORTED_VIEWER"));
});

test("legacy adapter decodes URLs and text, bounds concurrency, preserves order", async () => {
    let active = 0;
    let peak = 0;
    const password = 'p&"word';
    const runs = ['He said "hello"', "back\\slash", "line\nbreak", "café 日本語"];
    global.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.pathname.startsWith("/file/")) {
            return new Response('<script>var u="https://drive.google.com/viewerng/upload?ds=token%26value\\u0026other=1"</script>');
        }
        if (url.pathname === "/viewerng/upload") {
            assert.equal(init.body.get("pw"), password);
            return json({ meta: "meta?ds=token" });
        }
        if (url.pathname === "/viewerng/meta") return json({ pages: 4 });
        assert.equal(url.searchParams.get("ds"), "token&value");
        assert.equal(url.searchParams.has("other"), false);
        assert.equal(init.body.get("pw"), password);
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
        return json([[0, 1, 2, runs[Number(url.searchParams.get("page"))]]]);
    };
    assert.equal(await pdfToText(link, password, { method: "viewer", concurrency: 2 }), runs.join("\n\n"));
    assert.equal(peak, 2);
});

test("metadata schema, page counts, and targets are validated", async () => {
    for (const pages of [-1, 1.5, "2", null]) {
        global.fetch = async input => new URL(input).pathname.endsWith("/upload")
            ? json({ meta: "meta" }) : json({ pages });
        await assert.rejects(getTotalPages(upload), errorCode("INVALID_RESPONSE"));
    }
    global.fetch = async input => new URL(input).pathname.endsWith("/upload")
        ? json({ meta: "meta" }) : json({ pages: 1001 });
    await assert.rejects(getTotalPages(upload), errorCode("PAGE_LIMIT"));
    global.fetch = async () => json({ meta: "https://evil.test/meta" });
    await assert.rejects(getTotalPages(upload), errorCode("UNSAFE_URL"));
    await assert.rejects(extractPageText("id", -1), errorCode("INVALID_RESPONSE"));
});

test("malformed JSON and non-array page payloads fail explicitly", async () => {
    global.fetch = async () => new Response("not JSON");
    await assert.rejects(getTotalPages(upload), errorCode("INVALID_RESPONSE"));
    await assert.rejects(extractPageText("id", 1), errorCode("INVALID_RESPONSE"));
    global.fetch = async () => json({ error: "not a page" });
    await assert.rejects(extractPageText("id", 1), errorCode("INVALID_RESPONSE"));
    global.fetch = async () => json([["unexpected", "schema"]]);
    await assert.rejects(extractPageText("id", 1), errorCode("INVALID_RESPONSE"));
    global.fetch = async () => json({ meta: "https://[" });
    await assert.rejects(getTotalPages(upload), errorCode("INVALID_RESPONSE"));
});

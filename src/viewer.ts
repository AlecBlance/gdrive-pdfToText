import {
    DrivePdfError, ExtractionOptions, parseJson, requestText, settings, Settings,
    validatePages, validateRequestUrl,
} from "./http";

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new DrivePdfError("INVALID_RESPONSE", "Expected a Google Drive metadata object.");
    }
    return value as Record<string, unknown>;
}

function passwordBody(pw?: string): RequestInit {
    return { method: "POST", body: pw ? new URLSearchParams({ pw }) : undefined };
}

export async function extractInfo(link: string, config: Settings): Promise<{ url: string; id: string }> {
    const html = await requestText(link, config);
    const match = html.match(/https:(?:\\\/|\/){2}drive\.google\.com(?:\\\/|\/)viewerng(?:\\\/|\/)upload\?[^"<\s]+/i)?.[0];
    if (!match) {
        throw new DrivePdfError("UNSUPPORTED_VIEWER",
            "This file does not expose the legacy Drive viewer. Use download mode if downloading is permitted.");
    }
    let decoded: string;
    try { decoded = JSON.parse(`"${match}"`).replace(/&amp;/g, "&"); } catch (cause) {
        throw new DrivePdfError("INVALID_RESPONSE", "Invalid viewer URL encoding.", undefined, { cause });
    }
    const url = validateRequestUrl(decoded);
    const id = url.searchParams.get("ds");
    if (url.pathname !== "/viewerng/upload" || !id) {
        throw new DrivePdfError("INVALID_RESPONSE", "Missing legacy viewer document identifier.");
    }
    return { url: url.href, id };
}

export async function getTotalPages(url: string, pw?: string, options: ExtractionOptions = {}): Promise<number> {
    const config = settings(options);
    const upload = validateRequestUrl(url);
    if (upload.pathname !== "/viewerng/upload") throw new DrivePdfError("INVALID_URL", "Expected a viewerng/upload URL.");
    const data = record(parseJson(await requestText(upload.href, config, passwordBody(pw))));
    if (typeof data.meta !== "string" || !data.meta) {
        throw new DrivePdfError("INVALID_RESPONSE", "Missing viewer metadata URL.");
    }
    let metaUrl: URL;
    try { metaUrl = new URL(data.meta, "https://drive.google.com/viewerng/"); } catch (cause) {
        throw new DrivePdfError("INVALID_RESPONSE", "Invalid metadata URL.", undefined, { cause });
    }
    const meta = validateRequestUrl(metaUrl.href);
    if (!meta.pathname.startsWith("/viewerng/")) throw new DrivePdfError("INVALID_RESPONSE", "Invalid metadata URL.");
    const metadata = record(parseJson(await requestText(meta.href, config)));
    return validatePages(metadata.pages, config);
}

/** Legacy presspage text runs are arrays of numeric fields ending in text. */
export function parsePageText(text: string): string {
    const data = parseJson(text);
    if (!Array.isArray(data)) throw new DrivePdfError("INVALID_RESPONSE", "Expected a viewer page array.");
    const pieces: string[] = [];
    const stack: unknown[] = [data];
    let unrecognizedText = false;
    while (stack.length) {
        const node = stack.pop();
        if (!Array.isArray(node)) continue;
        const last = node[node.length - 1];
        if (node.length >= 2 && typeof last === "string" && node.slice(0, -1).every(value => typeof value === "number")) {
            pieces.push(last);
        } else {
            if (node.some(value => typeof value === "string")) unrecognizedText = true;
            for (let i = node.length - 1; i >= 0; i--) if (Array.isArray(node[i])) stack.push(node[i]);
        }
    }
    if (!pieces.length && unrecognizedText) {
        throw new DrivePdfError("INVALID_RESPONSE", "Unsupported viewer text-run schema.");
    }
    return pieces.join(" ");
}

export async function extractPageText(id: string, totalPages: number, pw?: string, options: ExtractionOptions = {}): Promise<string> {
    const config = settings(options);
    config.signal?.throwIfAborted();
    validatePages(totalPages, config);
    if (!id || typeof id !== "string") throw new DrivePdfError("INVALID_URL", "Missing viewer identifier.");
    const results = new Array<string>(totalPages);
    const controller = new AbortController();
    const signal = config.signal ? AbortSignal.any([config.signal, controller.signal]) : controller.signal;
    let nextPage = 0;
    async function worker() {
        while (nextPage < totalPages) {
            signal.throwIfAborted();
            const page = nextPage++;
            const url = new URL("https://drive.google.com/viewer2/prod-01/presspage");
            url.search = new URLSearchParams({ ck: "drive", ds: id, authuser: "0", page: String(page) }).toString();
            results[page] = parsePageText(await requestText(url.href, { ...config, signal }, passwordBody(pw)));
        }
    }
    const workers = Array.from({ length: Math.min(config.concurrency, totalPages) }, worker);
    try {
        await Promise.all(workers);
    } catch (error) {
        controller.abort();
        await Promise.allSettled(workers);
        throw error;
    }
    return results.join("\n\n");
}

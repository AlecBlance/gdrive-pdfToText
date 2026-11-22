import { setTimeout as delay } from "node:timers/promises";

export class DrivePdfError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly status?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "DrivePdfError";
    }
}

export interface ExtractionOptions {
    /** Default: download. Viewer endpoints are undocumented and best-effort. */
    method?: "download" | "viewer";
    concurrency?: number;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    maxPages?: number;
    maxBytes?: number;
    signal?: AbortSignal;
}

export type Settings = Required<Omit<ExtractionOptions, "signal">> & Pick<ExtractionOptions, "signal">;

export function settings(options: ExtractionOptions = {}): Settings {
    const config: Settings = {
        method: "download", concurrency: 4, timeoutMs: 30_000, retries: 2,
        retryDelayMs: 500, maxPages: 1000, maxBytes: 50 * 1024 * 1024,
        ...options,
    };
    if (config.method !== "download" && config.method !== "viewer") {
        throw new DrivePdfError("INVALID_OPTIONS", "method must be download or viewer.");
    }
    for (const key of ["concurrency", "timeoutMs", "maxPages", "maxBytes", "retries", "retryDelayMs"] as const) {
        if (!Number.isSafeInteger(config[key]) || config[key] < (key === "retries" || key === "retryDelayMs" ? 0 : 1)) {
            throw new DrivePdfError("INVALID_OPTIONS", `${key} must be a valid integer.`);
        }
    }
    if (config.concurrency > 32 || config.retries > 10) {
        throw new DrivePdfError("INVALID_OPTIONS", "concurrency must be <= 32 and retries <= 10.");
    }
    if (config.timeoutMs > 2 ** 31 - 1 || config.retryDelayMs * 2 ** config.retries > 2 ** 31 - 1) {
        throw new DrivePdfError("INVALID_OPTIONS", "Timeout and retry delays exceed the supported timer range.");
    }
    return config;
}

function safeUrl(input: string): URL {
    let url: URL;
    try { url = new URL(input); } catch {
        throw new DrivePdfError("INVALID_URL", "Expected an absolute HTTPS Google Drive URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
        throw new DrivePdfError("INVALID_URL", "Expected an HTTPS URL without credentials or a custom port.");
    }
    return url;
}

export function validateDriveLink(input: string): URL {
    const url = safeUrl(input);
    const id = url.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)(?:\/(?:view|preview|edit))?\/?$/)?.[1]
        ?? ((url.pathname === "/open" || url.pathname === "/uc") ? url.searchParams.get("id") : null);
    if (url.hostname !== "drive.google.com" || !id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new DrivePdfError("INVALID_URL", "Expected a drive.google.com file link or /open?id= link.");
    }
    return url;
}

export function fileId(url: URL): string {
    return url.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url.searchParams.get("id")!;
}

export function validateRequestUrl(input: string): URL {
    const url = safeUrl(input);
    const drivePath = url.hostname === "drive.google.com"
        && (/^\/file\/d\//.test(url.pathname) || ["/open", "/uc"].includes(url.pathname)
            || url.pathname.startsWith("/viewerng/") || url.pathname.startsWith("/viewer2/"));
    if (!drivePath && !(url.hostname === "drive.usercontent.google.com" && url.pathname === "/download")) {
        throw new DrivePdfError("UNSAFE_URL", "Request or redirect is outside the allowed Google Drive endpoints.");
    }
    return url;
}

const transient = new Set([408, 429, 500, 502, 503, 504]);

function statusError(status: number): DrivePdfError {
    const code = status === 401 || status === 403 ? "ACCESS_DENIED"
        : status === 404 ? "FILE_NOT_FOUND" : status === 429 ? "RATE_LIMITED" : "HTTP_ERROR";
    return new DrivePdfError(code, `Google Drive returned HTTP ${status}.`, status);
}

/** Timeout covers redirects and body consumption, not just response headers. */
export async function request(
    input: string, config: Settings, init: RequestInit = {},
): Promise<Uint8Array> {
    const initialUrl = validateRequestUrl(input);
    for (let attempt = 0; ; attempt++) {
        config.signal?.throwIfAborted();
        const signal = AbortSignal.any([
            AbortSignal.timeout(config.timeoutMs), ...(config.signal ? [config.signal] : []),
        ]);
        let retryAfter = 0;
        try {
            let url = initialUrl;
            let method = init.method ?? "GET";
            let body = init.body;
            let response: Response | undefined;
            for (let redirects = 0; redirects <= 5; redirects++) {
                response = await globalThis.fetch(url.href, { ...init, method, body, redirect: "manual", signal });
                if (![301, 302, 303, 307, 308].includes(response.status)) break;
                const location = response.headers.get("location");
                await response.body?.cancel();
                if (!location || redirects === 5) {
                    throw new DrivePdfError("REDIRECT_ERROR", "Missing redirect target or too many redirects.");
                }
                url = validateRequestUrl(new URL(location, url).href);
                if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
                    method = "GET";
                    body = undefined;
                }
            }
            if (!response!.ok) {
                const value = response!.headers.get("retry-after");
                if (value) {
                    retryAfter = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now());
                    if (!Number.isFinite(retryAfter)) retryAfter = 0;
                }
                await response!.body?.cancel();
                throw statusError(response!.status);
            }
            const length = Number(response!.headers.get("content-length"));
            if (length > config.maxBytes) {
                await response!.body?.cancel();
                throw new DrivePdfError("SIZE_LIMIT", "Response exceeds maxBytes.");
            }
            const reader = response!.body?.getReader();
            if (!reader) return new Uint8Array();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > config.maxBytes) throw new DrivePdfError("SIZE_LIMIT", "Response exceeds maxBytes.");
                    chunks.push(value);
                }
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            return bytes;
        } catch (error) {
            config.signal?.throwIfAborted();
            if (error instanceof DrivePdfError && (!error.status || !transient.has(error.status))) throw error;
            if (signal.aborted) throw new DrivePdfError("TIMEOUT", "Google Drive request timed out.", undefined, { cause: error });
            if (!(error instanceof DrivePdfError) && !(error instanceof TypeError)) throw error;
            if (attempt >= config.retries) {
                if (error instanceof DrivePdfError) throw error;
                throw new DrivePdfError("NETWORK_ERROR", "Google Drive request failed.", undefined, { cause: error });
            }
            // Never retry before Retry-After. If it exceeds the request budget,
            // fail instead of silently retrying earlier than the server allows.
            if (retryAfter > config.timeoutMs) throw error;
            await delay(Math.max(retryAfter, config.retryDelayMs * 2 ** attempt), undefined, { signal: config.signal });
        }
    }
}

export async function requestText(url: string, config: Settings, init?: RequestInit): Promise<string> {
    return new TextDecoder().decode(await request(url, config, init));
}

export function parseJson(text: string): unknown {
    try { return JSON.parse(text.replace(/^\s*\)\]\}'(?:\r?\n)?/, "")); } catch (cause) {
        throw new DrivePdfError("INVALID_RESPONSE", "Google Drive returned malformed JSON.", undefined, { cause });
    }
}

export function validatePages(value: unknown, config: Settings): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new DrivePdfError("INVALID_RESPONSE", "Expected a nonnegative integer page count.");
    }
    if (value > config.maxPages) throw new DrivePdfError("PAGE_LIMIT", "Document exceeds maxPages.");
    return value;
}

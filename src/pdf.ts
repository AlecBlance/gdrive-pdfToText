import { DrivePdfError, fileId, request, Settings, validatePages } from "./http";

export async function extractDownloadedPdf(url: URL, password: string | undefined, config: Settings): Promise<string> {
    const download = new URL("https://drive.usercontent.google.com/download");
    download.searchParams.set("id", fileId(url));
    download.searchParams.set("export", "download");
    const resourceKey = url.searchParams.get("resourcekey");
    if (resourceKey) download.searchParams.set("resourcekey", resourceKey);
    const data = await request(download.href, config);
    if (!new TextDecoder("ascii").decode(data.subarray(0, 1024)).includes("%PDF-")) {
        throw new DrivePdfError("DOWNLOAD_UNAVAILABLE",
            "Drive did not return a PDF. Check sharing, download permission, quota, or download confirmation requirements.");
    }
    config.signal?.throwIfAborted();
    // Keep the parser external and load it lazily for both CommonJS and ESM.
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data, password, useSystemFonts: true });
    const abort = () => { void task.destroy().catch(() => {}); };
    config.signal?.addEventListener("abort", abort, { once: true });
    try {
        config.signal?.throwIfAborted();
        const document = await task.promise;
        const count = validatePages(document.numPages, config);
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
            config.signal?.throwIfAborted();
            const page = await document.getPage(pageNumber);
            try {
                const content = await page.getTextContent();
                let text = "";
                for (const item of content.items) {
                    if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
                }
                pages.push(text.trim());
            } finally { page.cleanup(); }
        }
        return pages.join("\n\n");
    } catch (cause) {
        config.signal?.throwIfAborted();
        if (cause instanceof DrivePdfError) throw cause;
        if (cause instanceof Error && cause.name === "PasswordException") {
            throw new DrivePdfError("PASSWORD_REQUIRED", "The PDF requires a password or the supplied password is incorrect.", undefined, { cause });
        }
        throw new DrivePdfError("INVALID_PDF", "Unable to parse the downloaded PDF.", undefined, { cause });
    } finally {
        config.signal?.removeEventListener("abort", abort);
        await task.destroy();
    }
}

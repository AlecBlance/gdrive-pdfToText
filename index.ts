import { extractDownloadedPdf } from "./src/pdf";
import { extractInfo, extractPageText, getTotalPages } from "./src/viewer";
import { DrivePdfError, ExtractionOptions, settings, validateDriveLink } from "./src/http";

export { DrivePdfError, extractPageText, getTotalPages };
export type { ExtractionOptions };

/**
 * Extract a publicly accessible Drive PDF. Only process files you are authorized
 * to access. The undocumented viewer adapter is available as an explicit opt-in.
 */
export async function pdfToText(
    link: string,
    pw?: string,
    options: ExtractionOptions = {},
): Promise<string> {
    const config = settings(options);
    const url = validateDriveLink(link);
    if (config.method === "download") {
        return extractDownloadedPdf(url, pw, config);
    }
    const info = await extractInfo(url.href, config);
    const pages = await getTotalPages(info.url, pw, config);
    return extractPageText(info.id, pages, pw, config);
}

export default { pdfToText, getTotalPages, extractPageText };

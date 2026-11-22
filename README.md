# 📄 gdrive-pdfToText

Extract text from publicly accessible Google Drive PDFs in Node.js **22.13 or newer**.
The default path downloads a permitted PDF and parses it locally with PDF.js.
No Google Drive API credentials are required. Only process files you are authorized to access.

## Usage

```sh
npm install gdrive-pdftotext
```

```js
import gdrivePdf, { pdfToText, DrivePdfError } from "gdrive-pdftotext";

const link = "https://drive.google.com/file/d/FILE_ID/view";
const text = await pdfToText(link);
// Also supported: gdrivePdf.pdfToText(link)
// Encrypted PDF: await pdfToText(link, "password")
```

CommonJS:

```js
const { pdfToText } = require("gdrive-pdftotext");
```

Supported links: `/file/d/ID/view`, `/file/d/ID/preview`, `/file/d/ID`,
`/open?id=ID`, and `/uc?id=ID` on `https://drive.google.com`.
The `resourcekey` query parameter is preserved when downloading.

### Options

```js
const controller = new AbortController();
const text = await pdfToText(link, undefined, {
  method: "download",
  timeoutMs: 30_000,
  retries: 2,
  retryDelayMs: 500,
  maxBytes: 50 * 1024 * 1024,
  maxPages: 1000,
  concurrency: 4,
  signal: controller.signal,
});
```

These values are the defaults. `concurrency` applies to the legacy viewer adapter
and must be between 1 and 32; retries must be between 0 and 10. Limits must be
positive integers. `timeoutMs` covers each HTTP attempt, including redirects and
body consumption; it is not a total extraction/CPU deadline.

Network failures and HTTP 408, 429, 500, 502, 503, and 504 are retried with
exponential backoff. `Retry-After` is respected; if it exceeds `timeoutMs`, the
request fails rather than retrying early. Access-denied responses are not retried.
Aborting cancels requests, retry waits, and active PDF parsing.

### Output and errors

Returns a string, with pages separated by two newlines. Empty pages are preserved.
An image-only PDF can return an empty string: **OCR is not included**. Tables,
columns, mathematical notation, and reading order are best-effort, not a
layout-preserving conversion.

Failures throw `DrivePdfError` with a `code`, and `status` for HTTP failures:

| Code | Meaning |
| --- | --- |
| `INVALID_URL`, `UNSAFE_URL`, `INVALID_OPTIONS` | Invalid input or blocked endpoint/redirect |
| `ACCESS_DENIED`, `FILE_NOT_FOUND`, `RATE_LIMITED`, `HTTP_ERROR` | Drive HTTP error |
| `DOWNLOAD_UNAVAILABLE` | Drive returned something other than PDF bytes |
| `PASSWORD_REQUIRED` | Missing or incorrect PDF password |
| `INVALID_PDF` | Downloaded PDF could not be parsed |
| `UNSUPPORTED_VIEWER`, `INVALID_RESPONSE` | Unsupported legacy viewer or response schema |
| `PAGE_LIMIT`, `SIZE_LIMIT` | Configured document/response limit exceeded |
| `TIMEOUT`, `NETWORK_ERROR`, `REDIRECT_ERROR` | Request failure |

User cancellation throws the signal's abort reason. Do not log PDF passwords,
full viewer identifiers, or private document contents in production.

## Legacy viewer adapter

```js
const text = await pdfToText(link, undefined, { method: "viewer", concurrency: 4 });
```

This explicit opt-in uses undocumented `viewerng` and `presspage` endpoints.
It is **best-effort**: modern Drive viewers may not expose them at all.
There is no automatic fallback that attempts to work around download restrictions,
and no guarantee that view-only, copy-disabled, private, or sign-in-required files
can be extracted. This library does not import browser sessions or cookies.

The existing low-level helpers remain available:

```js
const { getTotalPages, extractPageText } = gdrivePdf;
// getTotalPages(viewerUploadUrl, password?, options?)
// extractPageText(viewerDocumentId, totalPages, password?, options?)
```

Unlike `pdfToText`, these accept internal viewer identifiers/URLs, not file links.
The adapter parses numeric text-run arrays structurally rather than matching
arbitrary strings. Changes to Google's undocumented schema require new fixtures
and adapter updates.

## Security and limitations

- Requests and every redirect are restricted to specific HTTPS Drive endpoints.
- Response sizes and page counts are bounded. The byte limit is per response;
  concurrent viewer requests can use more memory in aggregate.
- PDF parsing runs in-process. For untrusted documents, use a resource-limited
  worker process/container and enforce an overall job deadline.
- Download confirmation pages, quotas, authentication, and disabled downloads
  produce explicit errors; they are not bypassed.
- For private files, use an authorized Drive API client to download them and a
  local PDF parser instead.

## Development

```sh
npm ci
npm run lint
npm test
npm run dev-sample -- "https://drive.google.com/file/d/FILE_ID/view"
```

Tests use mocked HTTP responses and generated PDF fixtures, not live Drive files.
The sample command makes a live request and accepts `PDF_PASSWORD` via the environment.
CI tests Node 22.13 and 24, including both package entry points.

### Migration from 1.x

- Requires Node 22.13+.
- Downloads and parses permitted PDFs by default; use `method: "viewer"` explicitly
  for the old endpoint adapter.
- Returns `string` (including `""` for no text), never `undefined`.
- Failures are explicit; page separators are preserved.
- Both default ESM imports and named CJS/ESM imports are supported.

## License

[MIT](LICENSE) — original author: [Alec Blance](https://github.com/AlecBlance).

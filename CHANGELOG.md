# gdrive-pdftotext

## 2.0.0

### Major Changes

- 9393ba9: Prefer permitted PDF downloads with local PDF.js extraction. Require Node 22.13+,
  provide working CJS/ESM exports, explicit errors, request and document limits,
  cancellation, bounded viewer concurrency, and structured legacy response parsing.
  Legacy viewer extraction is now an explicit opt-in. Preserve page boundaries and
  return strings instead of undefined. Add offline regression tests and refresh dependencies.

## 1.1.0

### Minor Changes

- cfdbe02: Add support for password protected file / change docs / fix rate limitting issue

## 1.0.2

### Patch Changes

- Add retries to avoid ETIMEDOUT

## 1.0.1

### Patch Changes

- 5e84165: remove logging and empty return

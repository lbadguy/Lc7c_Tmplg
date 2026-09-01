# Implementation Plan

1. Bootstrap a minimal Node build with `esbuild`, `jsqr`, and the worker-based `qr-scanner`; add scripts for build, lint-style syntax checks, and tests.
2. Implement capture and decode modules with cancellation, URL classification, and explicit cross-origin/empty-selection errors.
3. Implement the isolated overlay UI and pointer-based rectangular selection workflow.
4. Wire userscript lifecycle, current-page scan, selection scan, copy, open, cancel, and status transitions.
5. Produce `dist/qr-scanner.user.js` and a short README with installation and known browser limitations.
6. Add focused unit tests for URL classification, selection normalization, and scan-result state transitions; run build and test commands.
7. Manually verify the generated userscript in a Chromium page containing a known QR image at desktop and narrow viewport sizes, including no-result and cancel paths.

## Validation Commands

- `npm install`
- `npm run build`
- `npm test`
- `node --check scripts/build.mjs`

## Risk and Review Gates

- Keep generated `dist/` output reproducible from source; rerun build after any source change.
- Ensure no `@require`, fetch, XHR, or analytics call remains in the generated artifact.
- Verify pointer coordinates account for page scroll and device pixel ratio.
- Verify URL opening is restricted to HTTP(S) and that popup blocking is reported.

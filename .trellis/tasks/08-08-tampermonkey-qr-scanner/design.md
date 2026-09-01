# Technical Design

## Architecture

- `src/main.js` is the userscript entry point and owns lifecycle, DOM event wiring, and scan state.
- `src/ui.js` builds one fixed overlay root containing the launcher, selection mask, progress/result panel, and transient status messages. All selectors are prefixed to avoid host-page collisions.
- `src/capture.js` ranks visible `img`, `canvas`, and `svg` elements that intersect the scan rectangle and yields one `ImageData` candidate at a time. Cross-origin images use `GM_xmlhttpRequest`; the caller can stop immediately after a successful decode.
- `src/decode.js` uses the bundled `qr-scanner` worker engine first. A single `jsqr` attempt is allowed only for images below the main-thread pixel limit. It returns `{ text, isUrl, url }` and never performs network requests.
- `scripts/build.mjs` uses `esbuild` to bundle the source and prepend Tampermonkey metadata into `dist/qr-scanner.user.js`.

## Data Flow

1. The launcher starts either current-page mode or selection mode.
2. Selection mode captures pointer coordinates without mutating page content. Current-page mode uses the viewport as the implicit rectangle.
3. Capture produces a canvas; decode receives only pixel data and returns a string.
4. UI renders the result. URL classification distinguishes normal web URLs, WeChat follow QR tokens, and allowlisted WeChat mini-program schemes. Unknown custom schemes remain inert text.
5. Copy uses `navigator.clipboard.writeText` with a temporary textarea fallback. Web links use a new tab; allowlisted WeChat actions are handed to the installed client with an explicit best-effort notice.

## Compatibility and Safety

- Run at `document_idle`; mount only after `document.body` exists.
- Shadow DOM is used when available to isolate styles; a prefixed fallback container is used otherwise.
- No storage, analytics, or remote script loading. `GM_xmlhttpRequest` is limited to GET requests for image URLs already present on the page.
- Scan jobs are cancellable through an `AbortController` and always restore the overlay state in `finally`.
- `GM_registerMenuCommand` is the only launcher. `GM_xmlhttpRequest` may retrieve an image from the URL the page already displays; screenshots and decoded contents are never uploaded or retained.

## Trade-offs

- Source-resolution media capture avoids the repeated browser sharing prompt and improves dense-code fidelity. It cannot read pure CSS backgrounds or pixels painted exclusively inside a cross-origin iframe.
- Removing DOM screenshots and main-thread enhancement passes keeps the host page responsive. Bundled decoding avoids third-party runtime dependencies.
- A single userscript artifact is the primary deliverable; source and build metadata remain in the repo for repeatable updates.

## Rollback

Delete or disable the userscript in Tampermonkey to remove all behavior. The script has no persistent page mutations or server-side state.

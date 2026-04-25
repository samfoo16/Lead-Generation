# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

No build step, no server required. Open `index.html` directly in Chrome (`file://` is sufficient — Apify's API supports CORS from file origins). The app requires a valid [Apify](https://apify.com) API token entered in the config bar.

## Architecture

Three files, no framework, no modules. All JS runs in the global scope loaded by a single `<script src="app.js">` at the bottom of `index.html`.

**Apify integration flow** (the core of the app):
1. `startRun()` — POSTs to `POST /v2/acts/{ACTOR_ID}/runs?token=…`, stores `runId` and `datasetId` from the response
2. `pollStatus()` — GETs `/v2/actor-runs/{runId}` every 5 s via recursive `setTimeout` (not `setInterval`), guarded by the `pollingActive` boolean
3. `fetchResults()` — GETs `/v2/datasets/{datasetId}/items?clean=true` once status is `SUCCEEDED`, stores items in the module-level `results[]` array

The actor ID and API base URL are constants at the top of `app.js`. To switch actors, change `ACTOR_ID` there and update `buildActorInput()` to match the new actor's input schema.

**`buildActorInput()`** intentionally sends redundant field names (`maxItems` and `maxResults`, both `searchUrl` and `searchKeywords`) so the payload works across actor versions that may use different key names. The LinkedIn search URL is constructed from the user's inputs as a fallback for actors that take a raw URL.

**Polling lifecycle**: `stopPolling()` clears both `pollHandle` (the `setTimeout`) and `timerHandle` (the elapsed-time `setInterval`). Always call `stopPolling()` before starting a new run to avoid duplicate polling loops.

## CSS Conventions

All colour and spacing tokens live in `:root` inside `style.css`. Visibility is controlled exclusively via the `.hidden` utility class (`display: none !important`) — never set `display` or `visibility` directly in JS. Status badge variants follow the pattern `.status-badge--{state}` (ready, running, succeeded, failed).

## Security Constraints

- **All** data from the Apify API that is written into `innerHTML` must go through `esc()` — the HTML-escaping utility in `app.js`.
- LinkedIn/profile URLs rendered as `href` attributes must pass `isSafeUrl()` before use, which rejects anything that isn't `http://` or `https://`.
- The API token is passed as a query parameter (`?token=…`) rather than an `Authorization` header. This is intentional: it avoids CORS preflight requests and matches Apify's documented browser-client pattern.

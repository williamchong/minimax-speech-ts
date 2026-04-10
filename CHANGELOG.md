# Changelog

## 0.2.0 (2026-04-10)

### Features

- **Streaming uploads** — `uploadFile()` gains a `ReadableStream<Uint8Array>` overload for uploading large files without buffering the full payload in memory. Uses a pull-based multipart assembly with per-chunk backpressure and propagates cancellation to the upstream reader on abort, so aborting a fetch cleanly releases the source stream.
- **Optional filename for Blob uploads** — the existing `Blob` overload now accepts an optional `{ filename }` option that maps to the `Content-Disposition` filename in the multipart body. Fully backward compatible with existing two-argument callers.
- **Exported `FilePurpose` type** — the `'voice_clone' | 'prompt_audio'` literal union is now exported for reuse in consumer code.

### Internal

- Runtime validation of the `uploadFile` `purpose` argument — prevents header injection from JavaScript callers that bypass TypeScript's type check.
- Added npm Trusted Publishing workflow with OIDC provenance.
- Restructured documentation for developer-centric value clarity.

## 0.1.1 (2026-02-19)

### Bug Fixes

- **Typed HTTP errors** — HTTP failures now throw `MiniMaxHttpError` (with `httpStatus` and `statusText` properties) instead of untyped `Error`, enabling programmatic handling of network-level vs API-level errors

### Internal

- Refactored `synthesizeAsync` to reuse shared `buildRequestBody()`, eliminating duplicated body-construction logic
- Expanded test coverage: HTTP error typing, `pronunciationDict` passthrough, malformed SSE resilience

## 0.1.0 (2026-02-10)

Initial release.

### Features

- **Synchronous synthesis** (`synthesize`) — text-to-speech returning audio as `Buffer` or URL
- **Streaming synthesis** (`synthesizeStream`) — real-time SSE streaming returning `ReadableStream<Buffer>`
- **Async synthesis** (`synthesizeAsync`, `querySynthesizeAsync`) — task-based synthesis for long-form content
- **File upload** (`uploadFile`) — upload audio files for voice cloning via multipart/form-data
- **Voice cloning** (`cloneVoice`) — clone a voice from an uploaded audio file, with optional prompt-based cloning
- **Voice design** (`designVoice`) — generate a new voice from a text description
- **Voice management** (`getVoices`, `deleteVoice`) — list and delete cloned/designed voices

### Developer Experience

- Full TypeScript types for all requests and responses
- Idiomatic camelCase API with automatic snake_case wire format conversion
- Client-side parameter validation with `MiniMaxClientError`:
  - Required field checks
  - Emotion/model compatibility (speech-01-\* has no emotion support; fluent/whisper require speech-2.6-\*)
  - WAV format rejection in streaming and async modes
  - Mutual exclusivity of `text`/`textFileId` in async synthesis
- Typed error hierarchy: `MiniMaxAuthError`, `MiniMaxRateLimitError`, `MiniMaxValidationError`
- ESM and CommonJS dual output with TypeScript declarations
- Supports Node.js 18+

### Models Supported

`speech-2.8-hd`, `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd`, `speech-02-turbo`, `speech-01-hd`, `speech-01-turbo`, `speech-01`

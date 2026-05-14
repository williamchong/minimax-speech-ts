# Changelog

## 0.4.0 (2026-05-14)

### Features

- **File management APIs** — `listFiles`, `retrieveFile`, `retrieveFileContent`, and `deleteFile` cover the remaining MiniMax File Management endpoints (`/v1/files/list`, `/retrieve`, `/retrieve_content`, `/delete`). `retrieveFileContent` returns a `Buffer` and sniffs `Content-Type` to surface JSON-encoded API errors instead of returning bogus binary.
- **`FilePurpose` widened to include `'t2a_async_input'`** — text inputs for `synthesizeAsync` now share the `uploadFile` path. The runtime validator in `uploadFile` accepts the new value.
- **`DeleteFilePurpose` type** — superset of `FilePurpose` that also includes `'t2a_async'` (async synthesis output) and `'video_generation'`, matching the broader set of purposes the delete endpoint accepts.
- **New exported types** — `FileInfo`, `ListFilesRequest`, `ListFilesResult`, `RetrieveFileResult`, `DeleteFileRequest`, `DeleteFileResult`, `DeleteFilePurpose`.
- **New exported constants** — `API_PATH_FILE_LIST`, `API_PATH_FILE_RETRIEVE`, `API_PATH_FILE_RETRIEVE_CONTENT`, `API_PATH_FILE_DELETE`.

### Internal

- Extracted `buildUrl(path, query)` from `getJson` so it can be reused by the new binary-returning `retrieveFileContent`.
- Collapsed the `uploadFile` response shape onto a shared `RawFile` / `FileInfo` pair via a new `mapFileInfo` helper, eliminating the inline anonymous response type.
- Bumped `eventsource-parser` 3.0.6 → 3.0.8 in the lockfile (declared range unchanged).
- README documents the four new file management endpoints.

## 0.3.0 (2026-05-14)

### Breaking Changes

- **`synthesizeStream` now returns `{ audio, subtitle }`** instead of `ReadableStream<Buffer>`. `audio` is the existing chunk stream; `subtitle` is a `Promise<string | undefined>` that resolves to the subtitle file URL emitted in the final aggregated chunk (or `undefined` when subtitles weren't enabled or the stream errored — it never rejects, since the underlying error already surfaces through the audio stream). Update consumers from `const audio = await client.synthesizeStream(req)` to `const { audio, subtitle } = await client.synthesizeStream(req)`.
- **Default `apiHost` changed** from `api.minimaxi.chat` to `api.minimax.io` to match current MiniMax documentation. Callers relying on the default will hit the new host; pass `apiHost` explicitly to pin the old one. The README also mentions `api-uw.minimax.io` for reduced TTFA from US/EU.
- **`AsyncSynthesizeResult.taskId` is now `number`** (was `string`) to match the wire contract and `AsyncSynthesizeQueryResult.taskId`. `querySynthesizeAsync(taskId)` accepts both `string | number` for back-compat with callers that persisted task IDs as strings.
- **Removed deprecated constants** — `'speech-01'` dropped from `MODELS` and `'neutral'` dropped from `EMOTIONS`; neither appears in current MiniMax docs.

### Features

- **PCMU and Opus audio formats** — `pcmu_raw` and `pcmu_wav` (G.711 μ-law) and `opus` added to `AUDIO_FORMATS`.
- **`subtitleType` field** — `'sentence' | 'word' | 'word_streaming'`. Non-streaming `synthesize` rejects `word_streaming` at validation time. `SynthesizeStreamRequest` no longer omits `subtitleEnable`, so both `subtitleEnable` and `subtitleType` can be passed to the streaming API.
- **Stream subtitle access** — alongside the new return shape, `synthesizeStream` consumers can now read the subtitle file URL emitted in the final aggregated SSE chunk without parsing the stream themselves.
- **`InputSensitiveType` type** — `0`–`7` literal union replaces bare `number` on the voice-clone response, with each category documented inline.
- **`cloneVoice` exposes `extraInfo`** — preview-synthesis billing fields (`audioLength`, `wordCount`, `usageCharacters`, `invisibleCharacterRatio`) are now surfaced via `VoiceCloneResult.extraInfo`.
- **`designVoice` validates `previewText`** — rejects strings longer than 500 characters before the request is sent.

### Bug Fixes

- **`synthesizeAsync` field names corrected** — now sends `audio_sample_rate` (was `sample_rate`) and `english_normalization` (was `text_normalization`) per the async schema. Previous calls silently fell back to server defaults for those fields.
- **Stream subtitle promise settles on every path** — `synthesizeStream` was rebuilt on a hand-rolled `ReadableStream` so the subtitle promise resolves on normal end, API error, transport error, and consumer cancel. The previous `pipeThrough` version could leave it pending forever on cancel or network error.
- **Error classification gaps closed** — added codes `2042` (auth), `2056` (rate limit), and `1008` / `1026` / `1027` / `1043` / `1044` (validation) per the MiniMax errorcode docs.
- **`synthesizeAsync` runtime body defense** — `subtitle_enable`, `subtitle_type`, `output_format`, `stream_options`, and `timbre_weights` are now stripped from async bodies at runtime. TypeScript already excludes them, but the shared body builder's permissive cast could let JS callers smuggle them past the type system.
- **`parseExtraInfo` no longer lies about missing fields** — throws when the t2a server omits `audio_format` or `audio_channel`, instead of smuggling `undefined` through string-typed fields via a non-null assertion.
- **`designVoice` tolerates `null` `previewText`** from JS callers — returns the friendly required-field error instead of a `TypeError`.
- **README fixes** — `demoAudio` documented as URL (not hex-encoded audio); stale `taskId // string` comment corrected.

### Internal

- `ExtraInfo` split into a `VoiceCloneExtraInfo` base type (the narrower subset voice-clone preview returns) and the t2a-specific `ExtraInfo` which re-declares `audioFormat` and `audioChannel` as required. New `parseVoiceCloneExtraInfo` helper.
- `SynthesizeRequest.subtitleType` narrowed to exclude `'word_streaming'`; `SynthesizeStreamRequest` re-declares it with the full union. The runtime check for `word_streaming` in non-streaming synthesis is now unreachable from TypeScript and kept only as a defense against JS callers.
- `SystemVoiceInfo.createdTime` made optional — docs don't list it for system voices.
- `buildRequestBody` collapsed to a single `Partial<A & B & C>` cast, dropping ~30 lines of branchy field-passthrough.
- Centralized HTTP handling in a private `requestJson<T>`; `postJson` and new `getJson<T>` are thin wrappers. `querySynthesizeAsync` shrinks from 27 lines to 8.
- `AsyncSynthesizeRequest` now `extends Omit<SynthesizeRequest, ...>` so async stays in sync as the sync request type evolves.
- `toSnakeCase` parameter relaxed to `object`, removing per-call-site casts.
- Test coverage backfilled for `pcmu_raw`, `pcmu_wav`, and `opus` serialization; obsolete `'neutral'` emotion replaced with `'calm'`; stale "URL-encode" test name corrected.
- README adds Text Features (pause control, inline pronunciation, 2.8-only interjection tags) and Rate Limits sections; notes the 9-hour async download URL expiry.

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

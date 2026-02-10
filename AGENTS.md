# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
npm run build        # Build ESM + CJS + .d.ts via tsup
npm run lint         # ESLint with typescript-eslint (strict, no-explicit-any)
npm test             # vitest run (all tests)
npx vitest run test/client.test.ts              # Run single test file
npx vitest run -t "should decode audio chunks"  # Run test by name
npm run test:watch   # vitest in watch mode
npm run docs         # Generate TypeDoc API docs to docs/
```

## Architecture

TypeScript client library for the MiniMax Speech Synthesis API. Single runtime dependency (`eventsource-parser` for SSE streaming). Dual ESM/CJS output via tsup.

### Source files (`src/`)

- **`client.ts`** — `MiniMaxSpeech` class with all API methods. Contains module-level helpers: `toSnakeCase()` for request body conversion, `validate()`/`required()` for declarative client-side validation, `emotionRules()` for model-specific constraints, `buildRequestBody()` shared by sync/stream T2A. The `postJson()` private method handles the common POST-JSON-parse-check-error pattern used by most endpoints. `synthesize` and `synthesizeStream` do their own fetch because they have special response handling (hex decode, SSE transform).
- **`types.ts`** — Public interfaces (`SynthesizeRequest`, `VoiceCloneRequest`, etc.) and internal `Raw*` types for snake_case API responses. The `Raw*` types are not exported from `index.ts`.
- **`errors.ts`** — `MiniMaxClientError` (client-side validation, thrown before request) is separate from `MiniMaxError` hierarchy (API errors). `createMiniMaxError()` maps status codes to `MiniMaxAuthError`, `MiniMaxRateLimitError`, or `MiniMaxValidationError`.
- **`constants.ts`** — API paths, model list, emotion list, format/sample-rate enums. `API_PATH` is deprecated alias for `API_PATH_T2A`.
- **`index.ts`** — Barrel export. All public types, constants, errors, and the client class.

### Key patterns

- **camelCase public API, snake_case wire format**: All request/response types use camelCase. `toSnakeCase()` converts outgoing bodies; response mapping is done manually per-method.
- **Validation runs before fetch**: The `validate()` function takes `[boolean, string]` tuples. If the boolean is true, it throws `MiniMaxClientError`. This catches emotion/model incompatibility, WAV-in-streaming, missing required fields, and mutual exclusivity constraints.
- **Streaming**: `synthesizeStream` returns `ReadableStream<Buffer>`. SSE events are parsed via `EventSourceParserStream`, then a `TransformStream` decodes hex audio chunks (status 1 = intermediate, status 2 = final/aggregated, skipped).
- **Overloads**: `synthesize()` has overloads — `outputFormat: 'url'` returns `SynthesizeUrlResult` (audio as URL string), default returns `SynthesizeResult` (audio as Buffer). The specific overload must come first.

### Tests (`test/client.test.ts`)

All tests mock `globalThis.fetch` via `vi.stubGlobal`. Helper functions: `makeResponse()` for synthesize responses, `makeJsonResponse()` for other endpoints, `makeSSEStream()` for streaming chunks. The `baseExtraInfo` fixture provides shared raw extra_info fields.

### CI/CD (`.github/workflows/`)

- **`ci.yml`** — Runs lint, build, test on Node 18/20/22 for pushes and PRs to main/master.
- **`docs.yml`** — Generates TypeDoc and deploys to GitHub Pages on push to main/master.

### Commit style

Use [gitmoji](https://gitmoji.dev/) prefix in commit messages.

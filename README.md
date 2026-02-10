# MiniMax TTS SDK for JavaScript / TypeScript

[![npm version](https://img.shields.io/npm/v/minimax-speech-ts)](https://www.npmjs.com/package/minimax-speech-ts)
[![CI](https://github.com/williamchong/minimax-speech-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/williamchong/minimax-speech-ts/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/minimax-speech-ts)](https://www.npmjs.com/package/minimax-speech-ts)
[![license](https://img.shields.io/npm/l/minimax-speech-ts)](https://github.com/williamchong/minimax-speech-ts/blob/master/LICENSE)

An unofficial **MiniMax Speech Synthesis (Text-to-Speech / T2A) SDK** for **Node.js**, **JavaScript**, and **TypeScript**. Convert text to natural-sounding speech using [MiniMax's TTS API](https://platform.minimax.io) with full streaming, voice cloning, and voice design support.

[API Reference](https://williamchong.github.io/minimax-speech-ts/) | [npm](https://www.npmjs.com/package/minimax-speech-ts) | [GitHub](https://github.com/williamchong/minimax-speech-ts)

## Features

- **Full MiniMax TTS API coverage** — sync, streaming (SSE), async, voice cloning, voice design, and voice management
- **TypeScript-first** — fully typed requests, responses, and error hierarchy
- **Idiomatic JS/TS interface** — camelCase API with automatic snake_case wire-format conversion
- **Client-side validation** — catches parameter errors before sending requests
- **Real-time streaming** — Server-Sent Events with `ReadableStream<Buffer>` for low-latency audio
- **Dual module output** — works with both ESM (`import`) and CommonJS (`require`)
- **Zero config** — just provide your MiniMax API key and start synthesizing

## Install

```bash
npm install minimax-speech-ts
```

Requires Node.js >= 18.

## Quick Start

```ts
import { MiniMaxSpeech } from 'minimax-speech-ts'

const client = new MiniMaxSpeech({
  apiKey: process.env.MINIMAX_API_KEY!,
  groupId: process.env.MINIMAX_GROUP_ID, // optional
})

// Text to speech
const result = await client.synthesize({
  text: 'Hello, world!',
  model: 'speech-02-hd',
  voiceSetting: { voiceId: 'English_expressive_narrator' },
})

// result.audio is a Buffer containing the audio data
await fs.promises.writeFile('output.mp3', result.audio)
```

## API

### Constructor

```ts
new MiniMaxSpeech({
  apiKey: string        // Required. MiniMax API key.
  groupId?: string      // Optional. MiniMax group ID, appended as ?GroupId= query param.
  apiHost?: string      // Optional. Defaults to 'https://api.minimaxi.chat'.
})
```

### `synthesize(request): Promise<SynthesizeResult>`

Synchronous text-to-speech. Returns decoded audio as a `Buffer`.

```ts
const result = await client.synthesize({
  text: 'Hello!',
  model: 'speech-02-hd',           // optional, defaults to 'speech-02-hd'
  voiceSetting: {
    voiceId: 'English_expressive_narrator',
    speed: 1.0,
    vol: 1.0,
    pitch: 0,
    emotion: 'happy',              // speech-02-*/speech-2.6-*/speech-2.8-* only
  },
  audioSetting: {
    format: 'mp3',                 // 'mp3' | 'pcm' | 'flac' | 'wav'
    sampleRate: 32000,
    bitrate: 128000,
    channel: 1,
  },
  languageBoost: 'English',
  voiceModify: {
    pitch: 0,                      // -100 to 100
    intensity: 0,                  // -100 to 100
    timbre: 0,                     // -100 to 100
    soundEffects: 'robotic',       // optional
  },
  timbreWeights: [                 // mix multiple voices
    { voiceId: 'voice-1', weight: 0.5 },
    { voiceId: 'voice-2', weight: 0.5 },
  ],
  subtitleEnable: false,
  pronunciationDict: { tone: ['处理/(chǔ lǐ)'] },
})

result.audio        // Buffer
result.extraInfo    // { audioLength, audioSampleRate, audioSize, bitrate, wordCount, usageCharacters, ... }
result.traceId      // string
result.subtitleFile // string | undefined
```

Pass `outputFormat: 'url'` to receive a URL string instead of a decoded buffer:

```ts
const result = await client.synthesize({
  text: 'Hello!',
  outputFormat: 'url',
})

result.audio // string (URL)
```

### `synthesizeStream(request): Promise<ReadableStream<Buffer>>`

Streaming text-to-speech via SSE. Returns a `ReadableStream` of audio `Buffer` chunks.

WAV format is not supported in streaming mode.

```ts
const stream = await client.synthesizeStream({
  text: 'Hello, streaming world!',
  voiceSetting: { voiceId: 'English_expressive_narrator' },
  audioSetting: { format: 'mp3' },
  streamOptions: { excludeAggregatedAudio: true },
})

const writer = fs.createWriteStream('output.mp3')
for await (const chunk of stream) {
  writer.write(chunk)
}
writer.end()
```

### `synthesizeAsync(request): Promise<AsyncSynthesizeResult>`

Async text-to-speech for long-form content. Submit a task then poll for completion.

Provide either `text` or `textFileId` (mutually exclusive). WAV format is not supported.

```ts
const task = await client.synthesizeAsync({
  text: 'A very long article...',
  voiceSetting: { voiceId: 'English_expressive_narrator' },
})

task.taskId           // string
task.fileId           // number
task.taskToken        // string
task.usageCharacters  // number
```

### `querySynthesizeAsync(taskId): Promise<AsyncSynthesizeQueryResult>`

Poll the status of an async synthesis task.

```ts
const status = await client.querySynthesizeAsync(task.taskId)

status.status  // 'processing' | 'success' | 'failed' | 'expired'
status.fileId  // number (download file ID when status is 'success')
```

### `uploadFile(file, purpose): Promise<FileUploadResult>`

Upload an audio file for voice cloning.

```ts
const audioBlob = new Blob([await fs.promises.readFile('voice.mp3')], { type: 'audio/mp3' })
const upload = await client.uploadFile(audioBlob, 'voice_clone')

upload.file.fileId    // number
upload.file.bytes     // number
upload.file.filename  // string
```

### `cloneVoice(request): Promise<VoiceCloneResult>`

Clone a voice from an uploaded audio file.

```ts
const result = await client.cloneVoice({
  fileId: upload.file.fileId,
  voiceId: 'my-custom-voice',        // 8-256 chars, must start with a letter
  text: 'Preview text',              // optional preview
  model: 'speech-02-hd',             // required if text is provided
  needNoiseReduction: true,
  needVolumeNormalization: true,
  clonePrompt: {                     // optional prompt-based cloning
    promptAudio: promptFileId,
    promptText: 'Transcript of the prompt audio',
  },
})

result.demoAudio       // hex-encoded preview audio (empty if no text provided)
result.inputSensitive  // { type: number }
```

### `designVoice(request): Promise<VoiceDesignResult>`

Design a new voice from a text description.

```ts
const result = await client.designVoice({
  prompt: 'A warm female voice with a slight British accent',
  previewText: 'Hello, this is a preview of the designed voice.',
  voiceId: 'my-designed-voice',  // optional, auto-generated if omitted
})

result.voiceId     // string
result.trialAudio  // hex-encoded preview audio
```

### `getVoices(request): Promise<GetVoiceResult>`

List available voices.

```ts
const voices = await client.getVoices({
  voiceType: 'all',  // 'system' | 'voice_cloning' | 'voice_generation' | 'all'
})

voices.systemVoice      // SystemVoiceInfo[] — built-in voices
voices.voiceCloning     // VoiceCloningInfo[] — your cloned voices
voices.voiceGeneration  // VoiceGenerationInfo[] — your designed voices
```

### `deleteVoice(request): Promise<DeleteVoiceResult>`

Delete a cloned or designed voice.

```ts
const result = await client.deleteVoice({
  voiceType: 'voice_cloning',  // 'voice_cloning' | 'voice_generation'
  voiceId: 'my-custom-voice',
})
```

## Error Handling

The library provides a typed error hierarchy:

```ts
import {
  MiniMaxClientError,      // Client-side validation (bad params, before request is sent)
  MiniMaxError,            // Base class for all API errors
  MiniMaxAuthError,        // Authentication failures (codes 1004, 2049)
  MiniMaxRateLimitError,   // Rate limiting (codes 1002, 1039, 1041, 2045)
  MiniMaxValidationError,  // Server-side validation (codes 2013, 1042, 2037, 2039, 2048, 20132)
} from 'minimax-speech-ts'
```

```ts
try {
  await client.synthesize({ text: 'Hello' })
} catch (e) {
  if (e instanceof MiniMaxClientError) {
    // Bad parameters — fix your request
    console.error(e.message)
  } else if (e instanceof MiniMaxAuthError) {
    // Invalid API key
  } else if (e instanceof MiniMaxRateLimitError) {
    // Back off and retry
  } else if (e instanceof MiniMaxValidationError) {
    // Server rejected the request parameters
    console.error(e.statusCode, e.statusMsg, e.traceId)
  } else if (e instanceof MiniMaxError) {
    // Other API error
    console.error(e.statusCode, e.statusMsg)
  }
}
```

Client-side validation catches common mistakes before making a request:

- Missing required fields (`text`, `voiceId`, etc.)
- Emotions with unsupported models (`speech-01-*` doesn't support emotions)
- `fluent`/`whisper` emotions with non-`speech-2.6-*` models
- WAV format in streaming or async mode
- `text` and `textFileId` both provided (mutually exclusive)
- `text` provided without `model` in voice cloning

## Models

| Model | Emotions | Notes |
|-------|----------|-------|
| `speech-2.8-hd` | All except fluent, whisper | Latest HD |
| `speech-2.8-turbo` | All except fluent, whisper | Latest Turbo |
| `speech-2.6-hd` | All including fluent, whisper | |
| `speech-2.6-turbo` | All including fluent, whisper | |
| `speech-02-hd` | All except fluent, whisper | Default |
| `speech-02-turbo` | All except fluent, whisper | |
| `speech-01-hd` | None | |
| `speech-01-turbo` | None | |
| `speech-01` | None | Legacy |

## Use Cases

- **Voice-over generation** — generate narration audio from scripts for videos and podcasts
- **Accessibility** — add text-to-speech to web and Node.js applications
- **Voice cloning** — clone a voice from a short audio sample and synthesize new speech
- **Voice design** — create custom AI voices from text descriptions
- **Real-time TTS streaming** — stream audio chunks via SSE for chatbots, virtual assistants, and live applications
- **Batch audio production** — use async synthesis for long-form content like audiobooks and articles

## Compatibility

- **Node.js** >= 18 (uses native `fetch` and `ReadableStream`)
- **TypeScript** >= 5.0
- Works with any MiniMax API key from [platform.minimax.io](https://platform.minimax.io)

## License

MIT

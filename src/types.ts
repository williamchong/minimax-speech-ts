import type { AUDIO_FORMATS, SUBTITLE_TYPES } from './constants.js'

export type AudioFormat = (typeof AUDIO_FORMATS)[number]
export type SubtitleType = (typeof SUBTITLE_TYPES)[number]

export interface MiniMaxSpeechOptions {
  apiKey: string
  groupId?: string
  apiHost?: string
}

export interface VoiceSetting {
  voiceId: string
  speed?: number
  vol?: number
  pitch?: number
  emotion?: string
  textNormalization?: boolean
  latexRead?: boolean
}

export interface AudioSetting {
  sampleRate?: number
  bitrate?: number
  format?: AudioFormat
  channel?: 1 | 2
  forceCbr?: boolean
}

export interface VoiceModify {
  pitch?: number
  intensity?: number
  timbre?: number
  soundEffects?: 'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic'
}

export interface TimbreWeight {
  voiceId: string
  weight: number
}

export interface SynthesizeRequest {
  text: string
  model?: string
  voiceSetting?: VoiceSetting
  audioSetting?: AudioSetting
  languageBoost?: string
  pronunciationDict?: { tone: string[] }
  voiceModify?: VoiceModify
  timbreWeights?: TimbreWeight[]
  subtitleEnable?: boolean
  /** `word_streaming` is only valid in streaming mode — see `SynthesizeStreamRequest`. */
  subtitleType?: Exclude<SubtitleType, 'word_streaming'>
  outputFormat?: 'url' | 'hex'
}

export interface SynthesizeStreamRequest extends Omit<SynthesizeRequest, 'outputFormat' | 'subtitleType'> {
  /** Streaming accepts all subtitle types including `word_streaming`. */
  subtitleType?: SubtitleType
  streamOptions?: { excludeAggregatedAudio?: boolean }
}

/**
 * Subset of extra_info returned by voice-clone preview synthesis.
 * Lacks audioFormat / audioChannel — those are t2a-only (see {@link ExtraInfo}).
 */
export interface VoiceCloneExtraInfo {
  audioLength: number
  audioSampleRate: number
  audioSize: number
  bitrate: number
  wordCount: number
  invisibleCharacterRatio?: number
  usageCharacters: number
}

export interface ExtraInfo extends VoiceCloneExtraInfo {
  audioFormat: string
  audioChannel: number
}

export interface SynthesizeResult {
  audio: Buffer
  subtitleFile?: string
  extraInfo: ExtraInfo
  traceId: string
}

export interface SynthesizeUrlResult {
  audio: string
  subtitleFile?: string
  extraInfo: ExtraInfo
  traceId: string
}

export interface SynthesizeStreamResult {
  audio: ReadableStream<Buffer>
  /**
   * Resolves to the subtitle file URL when subtitles were enabled and a final chunk arrived
   * with one; `undefined` otherwise (subtitles disabled, stream ended early, API error, transport
   * error, or consumer cancellation). Never rejects.
   *
   * **Important:** this promise only settles once the `audio` stream is being consumed. Awaiting
   * `subtitle` before reading or cancelling `audio` will hang because nothing is pumping the
   * underlying SSE source. Drain `audio` first (or in parallel via `Promise.all`).
   */
  subtitle: Promise<string | undefined>
}

// Async T2A types
export interface AsyncSynthesizeRequest
  extends Omit<SynthesizeRequest, 'text' | 'timbreWeights' | 'subtitleEnable' | 'subtitleType' | 'outputFormat'> {
  /** Either `text` or `textFileId` is required (mutually exclusive). */
  text?: string
  textFileId?: number
}

export interface AsyncSynthesizeResult {
  taskId: number
  fileId: number
  taskToken: string
  usageCharacters: number
}

export interface AsyncSynthesizeQueryResult {
  taskId: number
  status: 'success' | 'failed' | 'expired' | 'processing'
  fileId: number
}

// File management types

/** Purposes accepted by file upload and list filtering. */
export type FilePurpose = 'voice_clone' | 'prompt_audio' | 't2a_async_input'

/**
 * Purposes accepted by file delete. Includes upload-side purposes plus
 * `t2a_async` (async synthesis output) and `video_generation`.
 */
export type DeleteFilePurpose = FilePurpose | 't2a_async' | 'video_generation'

export interface FileInfo {
  fileId: number
  bytes: number
  createdAt: number
  filename: string
  purpose: string
}

export interface FileUploadResult {
  file: FileInfo
}

export interface ListFilesRequest {
  purpose: FilePurpose
}

export interface ListFilesResult {
  files: FileInfo[]
}

export interface RetrieveFileResult {
  file: FileInfo
}

export interface DeleteFileRequest {
  fileId: number
  purpose: DeleteFilePurpose
}

export interface DeleteFileResult {
  fileId: number
}

// Voice clone types
export interface VoiceCloneRequest {
  fileId: number
  voiceId: string
  clonePrompt?: {
    promptAudio: number
    promptText: string
  }
  text?: string
  model?: string
  languageBoost?: string
  needNoiseReduction?: boolean
  needVolumeNormalization?: boolean
}

/**
 * Content-safety trigger category from voice clone preview synthesis.
 * 0=normal, 1=severe, 2=pornographic, 3=advertisement, 4=prohibited,
 * 5=abusive, 6=terror/violence, 7=other.
 */
export type InputSensitiveType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface VoiceCloneResult {
  /** URL to preview audio; empty when no `text` was provided. */
  demoAudio: string
  inputSensitive: { type: InputSensitiveType }
  /** Returned only when `text` and `model` are provided (preview synthesis was billed). */
  extraInfo?: VoiceCloneExtraInfo
}

// Voice design types
export interface VoiceDesignRequest {
  prompt: string
  previewText: string
  voiceId?: string
}

export interface VoiceDesignResult {
  voiceId: string
  trialAudio: string
}

// Voice management types
export interface GetVoiceRequest {
  voiceType: 'system' | 'voice_cloning' | 'voice_generation' | 'all'
}

export interface SystemVoiceInfo {
  voiceId: string
  voiceName: string
  description: string[]
  createdTime?: string
}

export interface VoiceCloningInfo {
  voiceId: string
  description: string[]
  createdTime: string
}

export interface VoiceGenerationInfo {
  voiceId: string
  description: string[]
  createdTime: string
}

export interface GetVoiceResult {
  systemVoice: SystemVoiceInfo[]
  voiceCloning: VoiceCloningInfo[]
  voiceGeneration: VoiceGenerationInfo[]
}

export interface DeleteVoiceRequest {
  voiceType: 'voice_cloning' | 'voice_generation'
  voiceId: string
}

export interface DeleteVoiceResult {
  voiceId: string
  createdTime: string
}

// Internal types for raw API responses (snake_case)
export interface RawFile {
  file_id: number
  bytes: number
  created_at: number
  filename: string
  purpose: string
}

export interface RawBaseResp {
  status_code: number
  status_msg: string
}

export interface RawExtraInfo {
  audio_length: number
  audio_sample_rate: number
  audio_size: number
  bitrate: number
  word_count: number
  invisible_character_ratio?: number
  usage_characters: number
  audio_format?: string
  audio_channel?: number
}

export interface RawSynthesizeResponse {
  base_resp: RawBaseResp
  data: {
    audio: string
    subtitle_file?: string
    status: number
  }
  extra_info: RawExtraInfo
  trace_id: string
}

export interface RawStreamChunk {
  base_resp?: RawBaseResp
  data?: {
    audio: string
    status: number
    subtitle_file?: string
  }
  extra_info?: RawExtraInfo
  trace_id?: string
}

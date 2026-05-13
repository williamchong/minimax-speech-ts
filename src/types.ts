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
  /** `word_streaming` is only valid in streaming mode. */
  subtitleType?: SubtitleType
  outputFormat?: 'url' | 'hex'
}

export interface SynthesizeStreamRequest extends Omit<SynthesizeRequest, 'outputFormat'> {
  streamOptions?: { excludeAggregatedAudio?: boolean }
}

export interface ExtraInfo {
  audioLength: number
  audioSampleRate: number
  audioSize: number
  bitrate: number
  wordCount: number
  invisibleCharacterRatio?: number
  usageCharacters: number
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

// Async T2A types
export interface AsyncSynthesizeRequest {
  text?: string
  textFileId?: number
  model?: string
  voiceSetting?: VoiceSetting
  audioSetting?: AudioSetting
  languageBoost?: string
  pronunciationDict?: { tone: string[] }
  voiceModify?: VoiceModify
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

// File upload types
export type FilePurpose = 'voice_clone' | 'prompt_audio'

export interface FileUploadResult {
  file: {
    fileId: number
    bytes: number
    createdAt: number
    filename: string
    purpose: string
  }
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

export interface VoiceCloneResult {
  /** URL to preview audio; empty when no `text` was provided. */
  demoAudio: string
  inputSensitive: { type: number }
  /** Returned only when `text` and `model` are provided (preview synthesis was billed). */
  extraInfo?: ExtraInfo
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
  createdTime: string
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
  audio_format: string
  audio_channel: number
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
  }
  extra_info?: RawExtraInfo
  trace_id?: string
}

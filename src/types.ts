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
  format?: 'mp3' | 'pcm' | 'flac' | 'wav'
  channel?: 1 | 2
  forceCbr?: boolean
}

export interface VoiceModify {
  voiceId: string
  timbreStrength?: number
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
  outputFormat?: 'url' | 'hex'
}

export interface SynthesizeStreamRequest extends Omit<SynthesizeRequest, 'subtitleEnable' | 'outputFormat'> {
  streamOptions?: { excludeAggregatedAudio?: boolean }
}

export interface ExtraInfo {
  audioLength: number
  audioSampleRate: number
  audioSize: number
  bitrate: number
  wordCount: number
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
  data: {
    audio: string
    status: number
  }
  extra_info?: RawExtraInfo
  trace_id?: string
}

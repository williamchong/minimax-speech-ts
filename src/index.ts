export { MiniMaxSpeech } from './client.js'

export {
  MiniMaxError,
  MiniMaxAuthError,
  MiniMaxRateLimitError,
  MiniMaxValidationError,
} from './errors.js'

export {
  DEFAULT_API_HOST,
  DEFAULT_MODEL,
  MODELS,
  EMOTIONS,
  AUDIO_FORMATS,
  SAMPLE_RATES,
} from './constants.js'

export type {
  MiniMaxSpeechOptions,
  SynthesizeRequest,
  SynthesizeStreamRequest,
  SynthesizeResult,
  SynthesizeUrlResult,
  ExtraInfo,
  VoiceSetting,
  AudioSetting,
  VoiceModify,
  TimbreWeight,
} from './types.js'

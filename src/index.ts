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
  API_PATH,
  API_PATH_T2A,
  API_PATH_T2A_ASYNC,
  API_PATH_T2A_ASYNC_QUERY,
  API_PATH_FILE_UPLOAD,
  API_PATH_VOICE_CLONE,
  API_PATH_VOICE_DESIGN,
  API_PATH_GET_VOICE,
  API_PATH_DELETE_VOICE,
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
  AsyncSynthesizeRequest,
  AsyncSynthesizeResult,
  AsyncSynthesizeQueryResult,
  FileUploadResult,
  VoiceCloneRequest,
  VoiceCloneResult,
  VoiceDesignRequest,
  VoiceDesignResult,
  GetVoiceRequest,
  GetVoiceResult,
  SystemVoiceInfo,
  VoiceCloningInfo,
  VoiceGenerationInfo,
  DeleteVoiceRequest,
  DeleteVoiceResult,
} from './types.js'

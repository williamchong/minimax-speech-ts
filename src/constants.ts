export const DEFAULT_API_HOST = 'https://api.minimax.io'
export const DEFAULT_MODEL = 'speech-02-hd'

export const API_PATH_T2A = '/v1/t2a_v2'
export const API_PATH_T2A_ASYNC = '/v1/t2a_async_v2'
export const API_PATH_T2A_ASYNC_QUERY = '/v1/query/t2a_async_query_v2'
export const API_PATH_FILE_UPLOAD = '/v1/files/upload'
export const API_PATH_VOICE_CLONE = '/v1/voice_clone'
export const API_PATH_VOICE_DESIGN = '/v1/voice_design'
export const API_PATH_GET_VOICE = '/v1/get_voice'
export const API_PATH_DELETE_VOICE = '/v1/delete_voice'

/** @deprecated Use API_PATH_T2A instead */
export const API_PATH = API_PATH_T2A

export const MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
  'speech-01',
] as const

export const EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'neutral',
  'calm',
  'fluent',
  'whisper',
] as const

export const AUDIO_FORMATS = ['mp3', 'pcm', 'flac', 'wav', 'pcmu_raw', 'pcmu_wav', 'opus'] as const

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100] as const

export const SUBTITLE_TYPES = ['sentence', 'word', 'word_streaming'] as const

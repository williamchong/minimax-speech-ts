export const DEFAULT_API_HOST = 'https://api.minimaxi.chat'
export const DEFAULT_MODEL = 'speech-02-hd'
export const API_PATH = '/v1/t2a_v2'

export const MODELS = [
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
] as const

export const AUDIO_FORMATS = ['mp3', 'pcm', 'flac', 'wav'] as const

export const SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100] as const

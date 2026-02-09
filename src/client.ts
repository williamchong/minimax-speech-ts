import { EventSourceParserStream } from 'eventsource-parser/stream'

import { DEFAULT_API_HOST, DEFAULT_MODEL, API_PATH } from './constants.js'
import { createMiniMaxError } from './errors.js'
import type {
  MiniMaxSpeechOptions,
  SynthesizeRequest,
  SynthesizeStreamRequest,
  SynthesizeResult,
  SynthesizeUrlResult,
  ExtraInfo,
  RawSynthesizeResponse,
  RawStreamChunk,
  RawExtraInfo,
} from './types.js'

function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = toSnakeCase(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        typeof item === 'object' && item !== null
          ? toSnakeCase(item as Record<string, unknown>)
          : item,
      )
    } else {
      result[snakeKey] = value
    }
  }
  return result
}

function parseExtraInfo(raw: RawExtraInfo): ExtraInfo {
  return {
    audioLength: raw.audio_length,
    audioSampleRate: raw.audio_sample_rate,
    audioSize: raw.audio_size,
    bitrate: raw.bitrate,
    wordCount: raw.word_count,
    usageCharacters: raw.usage_characters,
    audioFormat: raw.audio_format,
    audioChannel: raw.audio_channel,
  }
}

function buildRequestBody(request: SynthesizeRequest | SynthesizeStreamRequest): Record<string, unknown> {
  const { text, model, voiceSetting, audioSetting, languageBoost, pronunciationDict, voiceModify, timbreWeights, ...rest } = request

  const body: Record<string, unknown> = {
    text,
    model: model ?? DEFAULT_MODEL,
  }

  if (voiceSetting) {
    body.voice_setting = toSnakeCase(voiceSetting as unknown as Record<string, unknown>)
    // voiceId -> voice_id mapping
    const vs = body.voice_setting as Record<string, unknown>
    if (vs.voice_id !== undefined) {
      vs.voice_id = vs.voice_id
    }
  }

  if (audioSetting) {
    body.audio_setting = toSnakeCase(audioSetting as unknown as Record<string, unknown>)
  }

  if (languageBoost !== undefined) {
    body.language_boost = languageBoost
  }

  if (pronunciationDict) {
    body.pronunciation_dict = pronunciationDict
  }

  if (voiceModify) {
    body.voice_modify = toSnakeCase(voiceModify as unknown as Record<string, unknown>)
  }

  if (timbreWeights) {
    body.timbre_weights = timbreWeights.map((tw) =>
      toSnakeCase(tw as unknown as Record<string, unknown>),
    )
  }

  // Handle non-streaming specific fields
  if ('subtitleEnable' in rest && (rest as SynthesizeRequest).subtitleEnable !== undefined) {
    body.subtitle_enable = (rest as SynthesizeRequest).subtitleEnable
  }
  if ('outputFormat' in rest && (rest as SynthesizeRequest).outputFormat !== undefined) {
    body.output_format = (rest as SynthesizeRequest).outputFormat
  }

  // Handle streaming specific fields
  if ('streamOptions' in request) {
    const streamReq = request as SynthesizeStreamRequest
    if (streamReq.streamOptions) {
      body.stream_options = toSnakeCase(streamReq.streamOptions as unknown as Record<string, unknown>)
    }
  }

  return body
}

export class MiniMaxSpeech {
  private readonly apiKey: string
  private readonly groupId?: string
  private readonly apiHost: string

  constructor(options: MiniMaxSpeechOptions) {
    this.apiKey = options.apiKey
    this.groupId = options.groupId
    this.apiHost = options.apiHost ?? DEFAULT_API_HOST
  }

  private getUrl(): string {
    const base = `${this.apiHost}${API_PATH}`
    if (this.groupId) {
      return `${base}?GroupId=${this.groupId}`
    }
    return base
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>
  async synthesize(request: SynthesizeRequest & { outputFormat: 'url' }): Promise<SynthesizeUrlResult>
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult | SynthesizeUrlResult> {
    const body = buildRequestBody(request)
    const response = await fetch(this.getUrl(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const json = (await response.json()) as RawSynthesizeResponse
    const { base_resp, data, extra_info, trace_id } = json

    if (base_resp.status_code !== 0) {
      throw createMiniMaxError(base_resp.status_code, base_resp.status_msg, trace_id)
    }

    const extraInfo = parseExtraInfo(extra_info)

    if (request.outputFormat === 'url') {
      return {
        audio: data.audio,
        subtitleFile: data.subtitle_file,
        extraInfo,
        traceId: trace_id,
      } satisfies SynthesizeUrlResult
    }

    return {
      audio: Buffer.from(data.audio, 'hex'),
      subtitleFile: data.subtitle_file,
      extraInfo,
      traceId: trace_id,
    } satisfies SynthesizeResult
  }

  async synthesizeStream(request: SynthesizeStreamRequest): Promise<ReadableStream<Buffer>> {
    const body = buildRequestBody(request)
    body.stream = true

    const response = await fetch(this.getUrl(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const sseStream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())

    const audioTransform = new TransformStream<{ data: string; event?: string; id?: string }, Buffer>({
      transform(event, controller) {
        if (!event.data || event.data === '[DONE]') return

        let chunk: RawStreamChunk
        try {
          chunk = JSON.parse(event.data) as RawStreamChunk
        } catch {
          return
        }

        if (chunk.base_resp && chunk.base_resp.status_code !== 0) {
          controller.error(
            createMiniMaxError(
              chunk.base_resp.status_code,
              chunk.base_resp.status_msg,
              chunk.trace_id,
            ),
          )
          return
        }

        // status 1 = intermediate chunk with audio, status 2 = final chunk (aggregated)
        if (chunk.data?.audio && chunk.data.status === 1) {
          controller.enqueue(Buffer.from(chunk.data.audio, 'hex'))
        }
      },
    })

    return sseStream.pipeThrough(audioTransform)
  }
}

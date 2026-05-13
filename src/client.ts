import { randomUUID } from 'node:crypto'

import { EventSourceParserStream } from 'eventsource-parser/stream'

import {
  DEFAULT_API_HOST,
  DEFAULT_MODEL,
  API_PATH_T2A,
  API_PATH_T2A_ASYNC,
  API_PATH_T2A_ASYNC_QUERY,
  API_PATH_FILE_UPLOAD,
  API_PATH_VOICE_CLONE,
  API_PATH_VOICE_DESIGN,
  API_PATH_GET_VOICE,
  API_PATH_DELETE_VOICE,
} from './constants.js'
import { MiniMaxClientError, MiniMaxHttpError, createMiniMaxError } from './errors.js'
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
  RawBaseResp,
  AsyncSynthesizeRequest,
  AsyncSynthesizeResult,
  AsyncSynthesizeQueryResult,
  FilePurpose,
  FileUploadResult,
  VoiceCloneRequest,
  VoiceCloneResult,
  VoiceDesignRequest,
  VoiceDesignResult,
  GetVoiceRequest,
  GetVoiceResult,
  DeleteVoiceRequest,
  DeleteVoiceResult,
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
    invisibleCharacterRatio: raw.invisible_character_ratio,
    usageCharacters: raw.usage_characters,
    audioFormat: raw.audio_format,
    audioChannel: raw.audio_channel,
  }
}

function validate(rules: Array<[boolean, string]>): void {
  for (const [fails, message] of rules) {
    if (fails) throw new MiniMaxClientError(message)
  }
}

function required(value: unknown, name: string): [boolean, string] {
  return [value === undefined || value === null || value === '', `"${name}" is required`]
}

function supportsEmotion(model: string): boolean {
  return ['speech-2.8-', 'speech-2.6-', 'speech-02-'].some((p) => model.startsWith(p))
}

function is26Model(model: string): boolean {
  return model.startsWith('speech-2.6-')
}

function emotionRules(emotion: string | undefined, model: string): Array<[boolean, string]> {
  if (!emotion) return []
  return [
    [!supportsEmotion(model), `Emotion is not supported with model "${model}"; requires speech-2.8-*, speech-2.6-*, or speech-02-*`],
    [(emotion === 'fluent' || emotion === 'whisper') && !is26Model(model), `Emotion "${emotion}" is only supported with speech-2.6-* models, got "${model}"`],
  ]
}

const textEncoder = new TextEncoder()

function escapeMultipartFilename(filename: string): string {
  return filename.replace(/[\r\n]/g, '').replace(/"/g, '%22')
}

function createMultipartStream(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  contentType: string,
  purpose: FilePurpose,
): { body: ReadableStream<Uint8Array>; contentType: string } {
  const boundary = `----MiniMaxFormBoundary${randomUUID().replace(/-/g, '')}`
  const preamble = textEncoder.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
      `${purpose}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  )
  const trailer = textEncoder.encode(`\r\n--${boundary}--\r\n`)

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let phase: 'preamble' | 'body' | 'trailer' | 'done' = 'preamble'

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === 'preamble') {
        controller.enqueue(preamble)
        reader = stream.getReader()
        phase = 'body'
        return
      }
      if (phase === 'body') {
        const result = await reader!.read()
        // Cancel may have run concurrently and nulled the reader
        if (phase !== 'body' || reader === null) return
        if (result.done) {
          reader.releaseLock()
          reader = null
          controller.enqueue(trailer)
          phase = 'trailer'
          return
        }
        if (result.value) controller.enqueue(result.value)
        return
      }
      if (phase === 'trailer') {
        controller.close()
        phase = 'done'
      }
    },
    async cancel(reason) {
      phase = 'done'
      if (reader) {
        try {
          await reader.cancel(reason)
        } finally {
          reader.releaseLock()
          reader = null
        }
      } else {
        await stream.cancel(reason)
      }
    },
  })

  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function buildRequestBody(request: SynthesizeRequest | SynthesizeStreamRequest | AsyncSynthesizeRequest): Record<string, unknown> {
  const { text, model, voiceSetting, audioSetting, languageBoost, pronunciationDict, voiceModify, ...rest } = request

  const body: Record<string, unknown> = {
    model: model ?? DEFAULT_MODEL,
  }

  if (text !== undefined) body.text = text

  // Handle async-specific textFileId
  if ('textFileId' in rest && (rest as AsyncSynthesizeRequest).textFileId !== undefined) {
    body.text_file_id = (rest as AsyncSynthesizeRequest).textFileId
  }

  if (voiceSetting) {
    body.voice_setting = toSnakeCase(voiceSetting as unknown as Record<string, unknown>)
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

  if ('timbreWeights' in request && (request as SynthesizeRequest).timbreWeights) {
    body.timbre_weights = (request as SynthesizeRequest).timbreWeights!.map((tw) =>
      toSnakeCase(tw as unknown as Record<string, unknown>),
    )
  }

  if ('subtitleEnable' in rest && (rest as SynthesizeRequest).subtitleEnable !== undefined) {
    body.subtitle_enable = (rest as SynthesizeRequest).subtitleEnable
  }
  if ('subtitleType' in rest && (rest as SynthesizeRequest).subtitleType !== undefined) {
    body.subtitle_type = (rest as SynthesizeRequest).subtitleType
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

  private getUrl(path: string): string {
    const base = `${this.apiHost}${path}`
    if (this.groupId) {
      return `${base}?GroupId=${encodeURIComponent(this.groupId)}`
    }
    return base
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T & { baseResp: RawBaseResp; traceId?: string }> {
    const response = await fetch(this.getUrl(path), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
    }

    const json = (await response.json()) as Record<string, unknown> & { base_resp: RawBaseResp; trace_id?: string }

    if (json.base_resp.status_code !== 0) {
      throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg, json.trace_id)
    }

    return { ...json, baseResp: json.base_resp, traceId: json.trace_id } as unknown as T & { baseResp: RawBaseResp; traceId?: string }
  }

  async synthesize(request: SynthesizeRequest & { outputFormat: 'url' }): Promise<SynthesizeUrlResult>
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult | SynthesizeUrlResult> {
    validate([
      required(request.text, 'text'),
      ...emotionRules(request.voiceSetting?.emotion, request.model ?? DEFAULT_MODEL),
      [request.subtitleType === 'word_streaming', '"word_streaming" subtitle type is only valid in streaming mode'],
    ])

    const body = buildRequestBody(request)
    const response = await fetch(this.getUrl(API_PATH_T2A), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
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
    validate([
      required(request.text, 'text'),
      ...emotionRules(request.voiceSetting?.emotion, request.model ?? DEFAULT_MODEL),
      [request.audioSetting?.format === 'wav', 'WAV format is not supported in streaming mode'],
    ])

    const body = buildRequestBody(request)
    body.stream = true

    const response = await fetch(this.getUrl(API_PATH_T2A), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
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

  async synthesizeAsync(request: AsyncSynthesizeRequest): Promise<AsyncSynthesizeResult> {
    validate([
      [request.text === undefined && request.textFileId === undefined, 'Either "text" or "textFileId" is required'],
      [request.text !== undefined && request.textFileId !== undefined, '"text" and "textFileId" are mutually exclusive'],
      ...emotionRules(request.voiceSetting?.emotion, request.model ?? DEFAULT_MODEL),
      [request.audioSetting?.format === 'wav', 'WAV format is not supported in async mode'],
    ])

    const body = buildRequestBody(request)

    const json = await this.postJson<{
      task_id: string
      file_id: number
      task_token: string
      usage_characters: number
    }>(API_PATH_T2A_ASYNC, body)

    return {
      taskId: json.task_id,
      fileId: json.file_id,
      taskToken: json.task_token,
      usageCharacters: json.usage_characters,
    }
  }

  async querySynthesizeAsync(taskId: string): Promise<AsyncSynthesizeQueryResult> {
    const url = this.getUrl(API_PATH_T2A_ASYNC_QUERY)
    const separator = url.includes('?') ? '&' : '?'
    const fullUrl = `${url}${separator}task_id=${encodeURIComponent(taskId)}`

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
    }

    const json = (await response.json()) as {
      task_id: number
      status: 'success' | 'failed' | 'expired' | 'processing'
      file_id: number
      base_resp: RawBaseResp
      trace_id?: string
    }

    if (json.base_resp.status_code !== 0) {
      throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg, json.trace_id)
    }

    return {
      taskId: json.task_id,
      status: json.status,
      fileId: json.file_id,
    }
  }

  async uploadFile(
    file: Blob,
    purpose: FilePurpose,
    options?: { filename?: string },
  ): Promise<FileUploadResult>
  async uploadFile(
    file: ReadableStream<Uint8Array>,
    purpose: FilePurpose,
    options: { filename: string; contentType?: string },
  ): Promise<FileUploadResult>
  async uploadFile(
    file: Blob | ReadableStream<Uint8Array>,
    purpose: FilePurpose,
    options?: { filename?: string; contentType?: string },
  ): Promise<FileUploadResult> {
    const isStream =
      file !== null &&
      typeof file === 'object' &&
      typeof (file as ReadableStream<Uint8Array>).getReader === 'function'

    validate([
      [
        purpose !== 'voice_clone' && purpose !== 'prompt_audio',
        `"purpose" must be "voice_clone" or "prompt_audio", got "${purpose}"`,
      ],
      [
        isStream && !options?.filename,
        '"filename" is required when uploading a ReadableStream',
      ],
    ])

    let body: BodyInit
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    }

    if (isStream) {
      // validate() above guarantees options.filename is set on the stream path
      const multipart = createMultipartStream(
        file as ReadableStream<Uint8Array>,
        options!.filename!,
        options!.contentType ?? 'application/octet-stream',
        purpose,
      )
      body = multipart.body
      headers['Content-Type'] = multipart.contentType
    } else {
      const formData = new FormData()
      formData.append('purpose', purpose)
      formData.append('file', file as Blob, options?.filename)
      body = formData
    }

    const response = await fetch(this.getUrl(API_PATH_FILE_UPLOAD), {
      method: 'POST',
      headers,
      body,
      ...(isStream ? { duplex: 'half' } : {}),
    } as RequestInit & { duplex?: 'half' })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
    }

    const json = (await response.json()) as {
      file: {
        file_id: number
        bytes: number
        created_at: number
        filename: string
        purpose: string
      }
      base_resp: RawBaseResp
    }

    if (json.base_resp.status_code !== 0) {
      throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg)
    }

    return {
      file: {
        fileId: json.file.file_id,
        bytes: json.file.bytes,
        createdAt: json.file.created_at,
        filename: json.file.filename,
        purpose: json.file.purpose,
      },
    }
  }

  async cloneVoice(request: VoiceCloneRequest): Promise<VoiceCloneResult> {
    validate([
      required(request.fileId, 'fileId'),
      required(request.voiceId, 'voiceId'),
      [request.text !== undefined && !request.model, '"model" is required when "text" is provided'],
    ])

    const body: Record<string, unknown> = {
      file_id: request.fileId,
      voice_id: request.voiceId,
    }

    if (request.clonePrompt) {
      body.clone_prompt = {
        prompt_audio: request.clonePrompt.promptAudio,
        prompt_text: request.clonePrompt.promptText,
      }
    }
    if (request.text !== undefined) body.text = request.text
    if (request.model !== undefined) body.model = request.model
    if (request.languageBoost !== undefined) body.language_boost = request.languageBoost
    if (request.needNoiseReduction !== undefined) body.need_noise_reduction = request.needNoiseReduction
    if (request.needVolumeNormalization !== undefined) body.need_volume_normalization = request.needVolumeNormalization

    const json = await this.postJson<{
      demo_audio: string
      input_sensitive: { type: number }
    }>(API_PATH_VOICE_CLONE, body)

    return {
      demoAudio: json.demo_audio,
      inputSensitive: json.input_sensitive,
    }
  }

  async designVoice(request: VoiceDesignRequest): Promise<VoiceDesignResult> {
    validate([
      required(request.prompt, 'prompt'),
      required(request.previewText, 'previewText'),
    ])

    const body: Record<string, unknown> = {
      prompt: request.prompt,
      preview_text: request.previewText,
    }

    if (request.voiceId !== undefined) body.voice_id = request.voiceId

    const json = await this.postJson<{
      voice_id: string
      trial_audio: string
    }>(API_PATH_VOICE_DESIGN, body)

    return {
      voiceId: json.voice_id,
      trialAudio: json.trial_audio,
    }
  }

  async getVoices(request: GetVoiceRequest): Promise<GetVoiceResult> {
    validate([required(request.voiceType, 'voiceType')])

    const json = await this.postJson<{
      system_voice: Array<{
        voice_id: string
        voice_name: string
        description: string[]
        created_time: string
      }>
      voice_cloning: Array<{
        voice_id: string
        description: string[]
        created_time: string
      }>
      voice_generation: Array<{
        voice_id: string
        description: string[]
        created_time: string
      }>
    }>(API_PATH_GET_VOICE, { voice_type: request.voiceType })

    return {
      systemVoice: (json.system_voice ?? []).map((v) => ({
        voiceId: v.voice_id,
        voiceName: v.voice_name,
        description: v.description,
        createdTime: v.created_time,
      })),
      voiceCloning: (json.voice_cloning ?? []).map((v) => ({
        voiceId: v.voice_id,
        description: v.description,
        createdTime: v.created_time,
      })),
      voiceGeneration: (json.voice_generation ?? []).map((v) => ({
        voiceId: v.voice_id,
        description: v.description,
        createdTime: v.created_time,
      })),
    }
  }

  async deleteVoice(request: DeleteVoiceRequest): Promise<DeleteVoiceResult> {
    validate([
      required(request.voiceType, 'voiceType'),
      required(request.voiceId, 'voiceId'),
    ])

    const json = await this.postJson<{
      voice_id: string
      created_time: string
    }>(API_PATH_DELETE_VOICE, {
      voice_type: request.voiceType,
      voice_id: request.voiceId,
    })

    return {
      voiceId: json.voice_id,
      createdTime: json.created_time,
    }
  }
}

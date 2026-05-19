import { randomUUID } from 'node:crypto'

import { EventSourceParserStream } from 'eventsource-parser/stream'

import {
  DEFAULT_API_HOST,
  DEFAULT_MODEL,
  API_PATH_T2A,
  API_PATH_T2A_ASYNC,
  API_PATH_T2A_ASYNC_QUERY,
  API_PATH_FILE_UPLOAD,
  API_PATH_FILE_LIST,
  API_PATH_FILE_RETRIEVE,
  API_PATH_FILE_RETRIEVE_CONTENT,
  API_PATH_FILE_DELETE,
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
  SynthesizeStreamResult,
  SynthesizeUrlResult,
  ExtraInfo,
  VoiceCloneExtraInfo,
  RawSynthesizeResponse,
  RawStreamChunk,
  RawExtraInfo,
  RawBaseResp,
  RawFile,
  AsyncSynthesizeRequest,
  AsyncSynthesizeResult,
  AsyncSynthesizeQueryResult,
  FilePurpose,
  FileInfo,
  FileUploadResult,
  ListFilesRequest,
  ListFilesResult,
  RetrieveFileResult,
  DeleteFileRequest,
  DeleteFileResult,
  VoiceCloneRequest,
  VoiceCloneResult,
  InputSensitiveType,
  VoiceDesignRequest,
  VoiceDesignResult,
  GetVoiceRequest,
  GetVoiceResult,
  DeleteVoiceRequest,
  DeleteVoiceResult,
} from './types.js'

function toSnakeCase(obj: object): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = toSnakeCase(value as object)
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map((item) =>
        typeof item === 'object' && item !== null ? toSnakeCase(item as object) : item,
      )
    } else {
      result[snakeKey] = value
    }
  }
  return result
}

function mapFileInfo(raw: RawFile): FileInfo {
  return {
    fileId: raw.file_id,
    bytes: raw.bytes,
    createdAt: raw.created_at,
    filename: raw.filename,
    purpose: raw.purpose,
  }
}

function parseVoiceCloneExtraInfo(raw: RawExtraInfo): VoiceCloneExtraInfo {
  return {
    audioLength: raw.audio_length,
    audioSampleRate: raw.audio_sample_rate,
    audioSize: raw.audio_size,
    bitrate: raw.bitrate,
    wordCount: raw.word_count,
    invisibleCharacterRatio: raw.invisible_character_ratio,
    usageCharacters: raw.usage_characters,
  }
}

function parseExtraInfo(raw: RawExtraInfo): ExtraInfo {
  // t2a always returns audio_format and audio_channel per the API contract.
  // Crash at parse time rather than smuggling undefined through a `string`-typed field.
  if (raw.audio_format === undefined || raw.audio_channel === undefined) {
    throw new Error('MiniMax t2a response missing audio_format or audio_channel in extra_info')
  }
  return {
    ...parseVoiceCloneExtraInfo(raw),
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

type AnyRequest = Partial<SynthesizeRequest> & Partial<SynthesizeStreamRequest> & Partial<AsyncSynthesizeRequest>

function buildRequestBody(request: SynthesizeRequest | SynthesizeStreamRequest | AsyncSynthesizeRequest): Record<string, unknown> {
  const r = request as AnyRequest
  const body: Record<string, unknown> = {
    model: r.model ?? DEFAULT_MODEL,
  }

  if (r.text !== undefined) body.text = r.text
  if (r.textFileId !== undefined) body.text_file_id = r.textFileId
  if (r.voiceSetting) body.voice_setting = toSnakeCase(r.voiceSetting)
  if (r.audioSetting) body.audio_setting = toSnakeCase(r.audioSetting)
  if (r.languageBoost !== undefined) body.language_boost = r.languageBoost
  // pronunciationDict's shape is already snake-case-safe ({ tone: string[] }); skip toSnakeCase.
  if (r.pronunciationDict) body.pronunciation_dict = r.pronunciationDict
  if (r.voiceModify) body.voice_modify = toSnakeCase(r.voiceModify)
  if (r.timbreWeights) body.timbre_weights = r.timbreWeights.map((tw) => toSnakeCase(tw))
  if (r.subtitleEnable !== undefined) body.subtitle_enable = r.subtitleEnable
  if (r.subtitleType !== undefined) body.subtitle_type = r.subtitleType
  if (r.outputFormat !== undefined) body.output_format = r.outputFormat
  if (r.streamOptions) body.stream_options = toSnakeCase(r.streamOptions)

  return body
}

// Async /v1/t2a_async_v2 differs from sync /v1/t2a_v2 in two ways:
// (1) different field names (audio_sample_rate, english_normalization) and
// (2) doesn't accept subtitle / output_format / stream_options / timbre_weights.
// TS types already exclude (2) on AsyncSynthesizeRequest, but buildRequestBody's
// permissive cast can let JS callers smuggle them in — strip defensively.
function fixupAsyncBody(body: Record<string, unknown>): void {
  const audio = body.audio_setting as Record<string, unknown> | undefined
  if (audio && 'sample_rate' in audio) {
    audio.audio_sample_rate = audio.sample_rate
    delete audio.sample_rate
  }
  const voice = body.voice_setting as Record<string, unknown> | undefined
  if (voice && 'text_normalization' in voice) {
    voice.english_normalization = voice.text_normalization
    delete voice.text_normalization
  }
  delete body.subtitle_enable
  delete body.subtitle_type
  delete body.output_format
  delete body.stream_options
  delete body.timbre_weights
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

  private postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.requestJson(this.getUrl(path), { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(body) })
  }

  private buildUrl(path: string, query?: Record<string, string | number>): string {
    const url = this.getUrl(path)
    if (!query) return url
    const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
    return `${url}${url.includes('?') ? '&' : '?'}${params}`
  }

  private getJson<T>(path: string, query?: Record<string, string | number>): Promise<T> {
    return this.requestJson(this.buildUrl(path, query), {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init)
    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
    }
    const json = (await response.json()) as Record<string, unknown> & { base_resp: RawBaseResp; trace_id?: string }
    if (json.base_resp.status_code !== 0) {
      throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg, json.trace_id)
    }
    return json as unknown as T
  }

  async synthesize(request: SynthesizeRequest & { outputFormat: 'url' }): Promise<SynthesizeUrlResult>
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult>
  async synthesize(request: SynthesizeRequest): Promise<SynthesizeResult | SynthesizeUrlResult> {
    validate([
      required(request.text, 'text'),
      ...emotionRules(request.voiceSetting?.emotion, request.model ?? DEFAULT_MODEL),
      // Belt-and-suspenders for JS callers; TS callers are already blocked by the narrowed type.
      [String(request.subtitleType) === 'word_streaming', '"word_streaming" subtitle type is only valid in streaming mode'],
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

  async synthesizeStream(request: SynthesizeStreamRequest): Promise<SynthesizeStreamResult> {
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

    const sseReader = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader()

    let resolveSubtitle!: (url: string | undefined) => void
    let resolveExtraInfo!: (info: ExtraInfo | undefined) => void
    let resolveTraceId!: (id: string | undefined) => void
    const subtitle = new Promise<string | undefined>((resolve) => {
      resolveSubtitle = resolve
    })
    const extraInfo = new Promise<ExtraInfo | undefined>((resolve) => {
      resolveExtraInfo = resolve
    })
    const traceId = new Promise<string | undefined>((resolve) => {
      resolveTraceId = resolve
    })
    // Settle all three metadata promises together. Promise resolution is idempotent, so the
    // status-2 path can resolve with values and a later end/error/cancel call is a harmless no-op.
    const settleMeta = (subtitleUrl?: string, info?: ExtraInfo, trace?: string): void => {
      resolveSubtitle(subtitleUrl)
      resolveExtraInfo(info)
      resolveTraceId(trace)
    }

    // Build the audio ReadableStream by hand so we can settle the metadata promises on every
    // completion path: status-2 chunk (subtitle URL + extra_info + trace_id), normal end, API
    // error, transport error, and consumer cancel. TransformStream's flush() doesn't run on the
    // last two, which is what made the earlier pipeThrough version leak pending promises.
    const audio = new ReadableStream<Buffer>({
      async pull(controller) {
        try {
          for (;;) {
            const { done, value: event } = await sseReader.read()
            if (done) {
              settleMeta()
              controller.close()
              return
            }
            if (!event.data || event.data === '[DONE]') continue

            let chunk: RawStreamChunk
            try {
              chunk = JSON.parse(event.data) as RawStreamChunk
            } catch {
              continue
            }

            if (chunk.base_resp && chunk.base_resp.status_code !== 0) {
              settleMeta()
              controller.error(createMiniMaxError(chunk.base_resp.status_code, chunk.base_resp.status_msg, chunk.trace_id))
              return
            }

            // Status-2 is the only chunk carrying top-level extra_info/trace_id. Its audio is
            // never enqueued (only status-1 is), so reading metadata here is safe regardless of
            // whether the server included aggregated audio.
            if (chunk.data?.status === 2) {
              let parsed: ExtraInfo | undefined
              if (chunk.extra_info) {
                try {
                  parsed = parseExtraInfo(chunk.extra_info)
                } catch {
                  // Malformed extra_info must not reject — these promises never do.
                  parsed = undefined
                }
              }
              settleMeta(chunk.data.subtitle_file, parsed, chunk.trace_id)
              continue
            }
            if (chunk.data?.audio && chunk.data.status === 1) {
              controller.enqueue(Buffer.from(chunk.data.audio, 'hex'))
              return
            }
          }
        } catch (err) {
          settleMeta()
          controller.error(err)
        }
      },
      async cancel(reason) {
        settleMeta()
        await sseReader.cancel(reason)
      },
    })

    return { audio, subtitle, extraInfo, traceId }
  }

  async synthesizeAsync(request: AsyncSynthesizeRequest): Promise<AsyncSynthesizeResult> {
    validate([
      [request.text === undefined && request.textFileId === undefined, 'Either "text" or "textFileId" is required'],
      [request.text !== undefined && request.textFileId !== undefined, '"text" and "textFileId" are mutually exclusive'],
      ...emotionRules(request.voiceSetting?.emotion, request.model ?? DEFAULT_MODEL),
      [request.audioSetting?.format === 'wav', 'WAV format is not supported in async mode'],
    ])

    const body = buildRequestBody(request)
    fixupAsyncBody(body)

    const json = await this.postJson<{
      task_id: number
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

  async querySynthesizeAsync(taskId: number | string): Promise<AsyncSynthesizeQueryResult> {
    const json = await this.getJson<{
      task_id: number
      status: 'success' | 'failed' | 'expired' | 'processing'
      file_id: number
    }>(API_PATH_T2A_ASYNC_QUERY, { task_id: taskId })

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
        purpose !== 'voice_clone' && purpose !== 'prompt_audio' && purpose !== 't2a_async_input',
        `"purpose" must be "voice_clone", "prompt_audio", or "t2a_async_input", got "${purpose}"`,
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
      file: RawFile
      base_resp: RawBaseResp
    }

    if (json.base_resp.status_code !== 0) {
      throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg)
    }

    return { file: mapFileInfo(json.file) }
  }

  async listFiles(request: ListFilesRequest): Promise<ListFilesResult> {
    validate([required(request.purpose, 'purpose')])

    const json = await this.getJson<{ files: RawFile[] }>(API_PATH_FILE_LIST, {
      purpose: request.purpose,
    })

    return { files: (json.files ?? []).map(mapFileInfo) }
  }

  async retrieveFile(fileId: number): Promise<RetrieveFileResult> {
    validate([required(fileId, 'fileId')])

    const json = await this.getJson<{ file: RawFile }>(API_PATH_FILE_RETRIEVE, {
      file_id: fileId,
    })

    return { file: mapFileInfo(json.file) }
  }

  // Success body is binary; on error the API returns JSON with base_resp — sniff Content-Type to disambiguate.
  async retrieveFileContent(fileId: number): Promise<Buffer> {
    validate([required(fileId, 'fileId')])

    const response = await fetch(this.buildUrl(API_PATH_FILE_RETRIEVE_CONTENT, { file_id: fileId }), {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    if (!response.ok) {
      throw new MiniMaxHttpError(response.status, response.statusText)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const json = (await response.json()) as { base_resp?: RawBaseResp; trace_id?: string }
      if (json.base_resp && json.base_resp.status_code !== 0) {
        throw createMiniMaxError(json.base_resp.status_code, json.base_resp.status_msg, json.trace_id)
      }
      throw new Error('Unexpected JSON response from /v1/files/retrieve_content')
    }

    return Buffer.from(await response.arrayBuffer())
  }

  async deleteFile(request: DeleteFileRequest): Promise<DeleteFileResult> {
    validate([
      required(request.fileId, 'fileId'),
      required(request.purpose, 'purpose'),
    ])

    const json = await this.postJson<{ file_id: number }>(API_PATH_FILE_DELETE, {
      file_id: request.fileId,
      purpose: request.purpose,
    })

    return { fileId: json.file_id }
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
      input_sensitive: { type: InputSensitiveType }
      extra_info?: RawExtraInfo
    }>(API_PATH_VOICE_CLONE, body)

    return {
      demoAudio: json.demo_audio,
      inputSensitive: json.input_sensitive,
      extraInfo: json.extra_info ? parseVoiceCloneExtraInfo(json.extra_info) : undefined,
    }
  }

  async designVoice(request: VoiceDesignRequest): Promise<VoiceDesignResult> {
    validate([
      required(request.prompt, 'prompt'),
      required(request.previewText, 'previewText'),
      [(request.previewText?.length ?? 0) > 500, '"previewText" must be 500 characters or fewer'],
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

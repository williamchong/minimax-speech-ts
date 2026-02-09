import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiniMaxSpeech } from '../src/client.js'
import { MiniMaxClientError, MiniMaxError, MiniMaxAuthError, MiniMaxRateLimitError, MiniMaxValidationError } from '../src/errors.js'
import type { RawSynthesizeResponse, RawStreamChunk } from '../src/types.js'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function createClient(options?: { groupId?: string; apiHost?: string }) {
  return new MiniMaxSpeech({
    apiKey: 'test-api-key',
    ...options,
  })
}

function makeResponse(body: RawSynthesizeResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeSSEStream(chunks: (RawStreamChunk | string)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        if (typeof chunk === 'string') {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`))
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

const baseExtraInfo = {
  audio_length: 1000,
  audio_sample_rate: 32000,
  audio_size: 5000,
  bitrate: 128000,
  word_count: 2,
  usage_characters: 10,
  audio_format: 'mp3',
  audio_channel: 1,
}

describe('MiniMaxSpeech', () => {
  describe('constructor', () => {
    it('should use default API host', () => {
      const client = createClient()
      expect(client).toBeInstanceOf(MiniMaxSpeech)
    })

    it('should accept custom API host', () => {
      const client = createClient({ apiHost: 'https://custom.api.com' })
      expect(client).toBeInstanceOf(MiniMaxSpeech)
    })
  })

  describe('synthesize', () => {
    it('should make a POST request with correct URL and headers', async () => {
      const audioHex = Buffer.from('test audio').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-123',
        }),
      )

      const client = createClient()
      await client.synthesize({ text: 'Hello world' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.minimaxi.chat/v1/t2a_v2',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          },
        }),
      )
    })

    it('should append GroupId when groupId is provided', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-456',
        }),
      )

      const client = createClient({ groupId: 'group-123' })
      await client.synthesize({ text: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.minimaxi.chat/v1/t2a_v2?GroupId=group-123',
        expect.any(Object),
      )
    })

    it('should send snake_case body with default model', async () => {
      const audioHex = Buffer.from('audio').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-789',
        }),
      )

      const client = createClient()
      await client.synthesize({
        text: 'Hello',
        voiceSetting: {
          voiceId: 'male-qn-qingse',
          speed: 1.0,
          emotion: 'neutral',
        },
        audioSetting: {
          sampleRate: 32000,
          format: 'mp3',
        },
        languageBoost: 'Chinese,Yue',
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)

      expect(body.model).toBe('speech-02-hd')
      expect(body.text).toBe('Hello')
      expect(body.voice_setting).toEqual({
        voice_id: 'male-qn-qingse',
        speed: 1.0,
        emotion: 'neutral',
      })
      expect(body.audio_setting).toEqual({
        sample_rate: 32000,
        format: 'mp3',
      })
      expect(body.language_boost).toBe('Chinese,Yue')
    })

    it('should return decoded audio buffer', async () => {
      const originalData = 'test audio data'
      const audioHex = Buffer.from(originalData).toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: {
            ...baseExtraInfo,
            audio_size: 15,
            word_count: 3,
            usage_characters: 15,
          },
          trace_id: 'trace-abc',
        }),
      )

      const client = createClient()
      const result = await client.synthesize({ text: 'test audio data' })

      expect(result.audio).toBeInstanceOf(Buffer)
      expect(result.audio.toString()).toBe(originalData)
      expect(result.traceId).toBe('trace-abc')
      expect(result.extraInfo.audioLength).toBe(1000)
      expect(result.extraInfo.audioSampleRate).toBe(32000)
      expect(result.extraInfo.audioFormat).toBe('mp3')
    })

    it('should return URL when outputFormat is url', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: 'https://example.com/audio.mp3', status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-url',
        }),
      )

      const client = createClient()
      const result = await client.synthesize({ text: 'Hello', outputFormat: 'url' })

      expect(result.audio).toBe('https://example.com/audio.mp3')
    })

    it('should throw MiniMaxError on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 2013, status_msg: 'Invalid parameter' },
          data: { audio: '', status: 0 },
          extra_info: { ...baseExtraInfo, audio_length: 0, audio_sample_rate: 0, audio_size: 0, bitrate: 0, word_count: 0, usage_characters: 0, audio_format: '', audio_channel: 0 },
          trace_id: 'trace-err',
        }),
      )

      const client = createClient()
      await expect(client.synthesize({ text: '' })).rejects.toThrow(MiniMaxValidationError)
    })

    it('should throw MiniMaxAuthError on auth failure', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 1004, status_msg: 'Invalid API key' },
          data: { audio: '', status: 0 },
          extra_info: { ...baseExtraInfo, audio_length: 0, audio_sample_rate: 0, audio_size: 0, bitrate: 0, word_count: 0, usage_characters: 0, audio_format: '', audio_channel: 0 },
          trace_id: 'trace-auth',
        }),
      )

      const client = createClient()
      await expect(client.synthesize({ text: 'test' })).rejects.toThrow(MiniMaxAuthError)
    })

    it('should throw MiniMaxRateLimitError on rate limit', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 1002, status_msg: 'Rate limit exceeded' },
          data: { audio: '', status: 0 },
          extra_info: { ...baseExtraInfo, audio_length: 0, audio_sample_rate: 0, audio_size: 0, bitrate: 0, word_count: 0, usage_characters: 0, audio_format: '', audio_channel: 0 },
          trace_id: 'trace-rl',
        }),
      )

      const client = createClient()
      await expect(client.synthesize({ text: 'test' })).rejects.toThrow(MiniMaxRateLimitError)
    })

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
      )

      const client = createClient()
      await expect(client.synthesize({ text: 'test' })).rejects.toThrow('HTTP 500')
    })

    it('should send subtitleEnable and outputFormat in body', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, subtitle_file: 'https://example.com/subtitle.srt', status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-sub',
        }),
      )

      const client = createClient()
      const result = await client.synthesize({ text: 'Test', subtitleEnable: true })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.subtitle_enable).toBe(true)
      expect(result.subtitleFile).toBe('https://example.com/subtitle.srt')
    })

    it('should handle timbreWeights', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-tw',
        }),
      )

      const client = createClient()
      await client.synthesize({
        text: 'Test',
        timbreWeights: [
          { voiceId: 'voice-1', weight: 0.5 },
          { voiceId: 'voice-2', weight: 0.5 },
        ],
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.timbre_weights).toEqual([
        { voice_id: 'voice-1', weight: 0.5 },
        { voice_id: 'voice-2', weight: 0.5 },
      ])
    })

    it('should send voiceModify with correct fields (pitch/intensity/timbre/soundEffects)', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-vm',
        }),
      )

      const client = createClient()
      await client.synthesize({
        text: 'Test',
        voiceModify: {
          pitch: 50,
          intensity: -30,
          timbre: 20,
          soundEffects: 'robotic',
        },
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.voice_modify).toEqual({
        pitch: 50,
        intensity: -30,
        timbre: 20,
        sound_effects: 'robotic',
      })
    })

    it('should include invisibleCharacterRatio in extraInfo', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo, invisible_character_ratio: 0.05 },
          trace_id: 'trace-icr',
        }),
      )

      const client = createClient()
      const result = await client.synthesize({ text: 'Test' })

      expect(result.extraInfo.invisibleCharacterRatio).toBe(0.05)
    })
  })

  describe('synthesizeStream', () => {
    it('should make a POST request with stream: true', async () => {
      const audioHex1 = Buffer.from('chunk1').toString('hex')
      const audioHex2 = Buffer.from('chunk2').toString('hex')

      const stream = makeSSEStream([
        { data: { audio: audioHex1, status: 1 }, trace_id: 'trace-s1' },
        { data: { audio: audioHex2, status: 1 }, trace_id: 'trace-s2' },
        { data: { audio: '', status: 2 }, trace_id: 'trace-s3' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      await client.synthesizeStream({ text: 'Hello streaming' })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.stream).toBe(true)
    })

    it('should decode audio chunks from SSE stream', async () => {
      const audioHex1 = Buffer.from('chunk1').toString('hex')
      const audioHex2 = Buffer.from('chunk2').toString('hex')

      const stream = makeSSEStream([
        { data: { audio: audioHex1, status: 1 }, trace_id: 'trace-s1' },
        { data: { audio: audioHex2, status: 1 }, trace_id: 'trace-s2' },
        { data: { audio: '', status: 2 }, trace_id: 'trace-s3' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const audioStream = await client.synthesizeStream({ text: 'Hello streaming' })

      const chunks: Buffer[] = []
      const reader = audioStream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      expect(chunks).toHaveLength(2)
      expect(chunks[0]!.toString()).toBe('chunk1')
      expect(chunks[1]!.toString()).toBe('chunk2')
    })

    it('should skip status 2 (aggregated) chunks', async () => {
      const audioHex = Buffer.from('chunk1').toString('hex')
      const aggregatedHex = Buffer.from('all audio combined').toString('hex')

      const stream = makeSSEStream([
        { data: { audio: audioHex, status: 1 }, trace_id: 'trace-1' },
        { data: { audio: aggregatedHex, status: 2 }, trace_id: 'trace-2' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const audioStream = await client.synthesizeStream({ text: 'Test' })

      const chunks: Buffer[] = []
      const reader = audioStream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.toString()).toBe('chunk1')
    })

    it('should handle stream errors from API', async () => {
      const stream = makeSSEStream([
        {
          base_resp: { status_code: 1004, status_msg: 'Unauthorized' },
          data: { audio: '', status: 0 },
          trace_id: 'trace-err',
        },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const audioStream = await client.synthesizeStream({ text: 'Test' })

      const reader = audioStream.getReader()
      await expect(reader.read()).rejects.toThrow(MiniMaxAuthError)
    })

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      )

      const client = createClient()
      await expect(client.synthesizeStream({ text: 'test' })).rejects.toThrow('HTTP 401')
    })

    it('should send streamOptions in body', async () => {
      const stream = makeSSEStream([
        { data: { audio: Buffer.from('c').toString('hex'), status: 1 }, trace_id: 't' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      await client.synthesizeStream({
        text: 'Test',
        streamOptions: { excludeAggregatedAudio: true },
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.stream_options).toEqual({ exclude_aggregated_audio: true })
    })
  })

  describe('synthesizeAsync', () => {
    it('should POST to async endpoint with correct body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 'task-123',
          file_id: 456,
          task_token: 'token-789',
          usage_characters: 100,
        }),
      )

      const client = createClient()
      const result = await client.synthesizeAsync({
        text: 'Hello async',
        voiceSetting: { voiceId: 'English_expressive_narrator' },
      })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/t2a_async_v2')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body as string)
      expect(body.text).toBe('Hello async')
      expect(body.model).toBe('speech-02-hd')
      expect(body.voice_setting.voice_id).toBe('English_expressive_narrator')

      expect(result.taskId).toBe('task-123')
      expect(result.fileId).toBe(456)
      expect(result.taskToken).toBe('token-789')
      expect(result.usageCharacters).toBe(100)
    })

    it('should send textFileId as text_file_id', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 'task-456',
          file_id: 789,
          task_token: 'token-abc',
          usage_characters: 5000,
        }),
      )

      const client = createClient()
      await client.synthesizeAsync({ textFileId: 42 })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.text_file_id).toBe(42)
      expect(body.text).toBeUndefined()
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2049, status_msg: 'Invalid API key' },
        }),
      )

      const client = createClient()
      await expect(client.synthesizeAsync({ text: 'test' })).rejects.toThrow(MiniMaxAuthError)
    })
  })

  describe('querySynthesizeAsync', () => {
    it('should GET with task_id query parameter', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 123,
          status: 'success',
          file_id: 456,
        }),
      )

      const client = createClient()
      const result = await client.querySynthesizeAsync('task-abc')

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/query/t2a_async_query_v2?task_id=task-abc')
      expect(options.method).toBe('GET')

      expect(result.taskId).toBe(123)
      expect(result.status).toBe('success')
      expect(result.fileId).toBe(456)
    })

    it('should append task_id with & when GroupId present', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 123,
          status: 'processing',
          file_id: 0,
        }),
      )

      const client = createClient({ groupId: 'grp-1' })
      await client.querySynthesizeAsync('task-xyz')

      const [url] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/query/t2a_async_query_v2?GroupId=grp-1&task_id=task-xyz')
    })

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      )

      const client = createClient()
      await expect(client.querySynthesizeAsync('bad-id')).rejects.toThrow('HTTP 404')
    })
  })

  describe('uploadFile', () => {
    it('should POST FormData with file and purpose', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          file: {
            file_id: 12345,
            bytes: 5896337,
            created_at: 1700469398,
            filename: 'sample.mp3',
            purpose: 'voice_clone',
          },
        }),
      )

      const client = createClient()
      const blob = new Blob(['fake audio data'], { type: 'audio/mp3' })
      const result = await client.uploadFile(blob, 'voice_clone')

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/files/upload')
      expect(options.method).toBe('POST')
      expect(options.body).toBeInstanceOf(FormData)
      expect(options.headers.Authorization).toBe('Bearer test-api-key')
      // No Content-Type header — fetch sets multipart/form-data automatically
      expect(options.headers['Content-Type']).toBeUndefined()

      expect(result.file.fileId).toBe(12345)
      expect(result.file.bytes).toBe(5896337)
      expect(result.file.createdAt).toBe(1700469398)
      expect(result.file.filename).toBe('sample.mp3')
      expect(result.file.purpose).toBe('voice_clone')
    })

    it('should handle prompt_audio purpose', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          file: {
            file_id: 99,
            bytes: 1000,
            created_at: 1700000000,
            filename: 'prompt.mp3',
            purpose: 'prompt_audio',
          },
        }),
      )

      const client = createClient()
      const blob = new Blob(['short audio'], { type: 'audio/mp3' })
      const result = await client.uploadFile(blob, 'prompt_audio')

      expect(result.file.purpose).toBe('prompt_audio')
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 1004, status_msg: 'Auth failed' },
          file: { file_id: 0, bytes: 0, created_at: 0, filename: '', purpose: '' },
        }),
      )

      const client = createClient()
      const blob = new Blob(['data'])
      await expect(client.uploadFile(blob, 'voice_clone')).rejects.toThrow(MiniMaxAuthError)
    })
  })

  describe('cloneVoice', () => {
    it('should POST with correct snake_case body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          demo_audio: 'abcdef0123456789',
          input_sensitive: { type: 0 },
        }),
      )

      const client = createClient()
      const result = await client.cloneVoice({
        fileId: 12345,
        voiceId: 'my-custom-voice',
        text: 'Preview text',
        model: 'speech-2.8-hd',
        needNoiseReduction: true,
        needVolumeNormalization: false,
        languageBoost: 'English',
      })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/voice_clone')

      const body = JSON.parse(options.body as string)
      expect(body.file_id).toBe(12345)
      expect(body.voice_id).toBe('my-custom-voice')
      expect(body.text).toBe('Preview text')
      expect(body.model).toBe('speech-2.8-hd')
      expect(body.need_noise_reduction).toBe(true)
      expect(body.need_volume_normalization).toBe(false)
      expect(body.language_boost).toBe('English')

      expect(result.demoAudio).toBe('abcdef0123456789')
      expect(result.inputSensitive.type).toBe(0)
    })

    it('should handle clone_prompt', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          demo_audio: '',
          input_sensitive: { type: 0 },
        }),
      )

      const client = createClient()
      await client.cloneVoice({
        fileId: 100,
        voiceId: 'cloned-voice',
        clonePrompt: {
          promptAudio: 200,
          promptText: 'This is a transcript.',
        },
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.clone_prompt).toEqual({
        prompt_audio: 200,
        prompt_text: 'This is a transcript.',
      })
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2039, status_msg: 'voice_id duplicate' },
        }),
      )

      const client = createClient()
      await expect(
        client.cloneVoice({ fileId: 1, voiceId: 'dup-voice' }),
      ).rejects.toThrow(MiniMaxValidationError)
    })
  })

  describe('designVoice', () => {
    it('should POST with correct body and map response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          voice_id: 'ttv-voice-1234-abcd',
          trial_audio: 'deadbeef',
        }),
      )

      const client = createClient()
      const result = await client.designVoice({
        prompt: 'A warm female voice with a slight British accent',
        previewText: 'Hello, this is a preview.',
      })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/voice_design')

      const body = JSON.parse(options.body as string)
      expect(body.prompt).toBe('A warm female voice with a slight British accent')
      expect(body.preview_text).toBe('Hello, this is a preview.')
      expect(body.voice_id).toBeUndefined()

      expect(result.voiceId).toBe('ttv-voice-1234-abcd')
      expect(result.trialAudio).toBe('deadbeef')
    })

    it('should include voice_id when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          voice_id: 'custom-id',
          trial_audio: 'cafe',
        }),
      )

      const client = createClient()
      await client.designVoice({
        prompt: 'Deep male voice',
        previewText: 'Test',
        voiceId: 'custom-id',
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.voice_id).toBe('custom-id')
    })
  })

  describe('getVoices', () => {
    it('should POST with voice_type and map all arrays', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          system_voice: [
            {
              voice_id: 'English_expressive_narrator',
              voice_name: 'Expressive Narrator',
              description: ['English', 'Male'],
              created_time: '2024-01-01',
            },
          ],
          voice_cloning: [
            {
              voice_id: 'my-clone',
              description: ['Custom clone'],
              created_time: '2024-06-15',
            },
          ],
          voice_generation: [
            {
              voice_id: 'ttv-voice-abc',
              description: ['Designed voice'],
              created_time: '2024-07-20',
            },
          ],
        }),
      )

      const client = createClient()
      const result = await client.getVoices({ voiceType: 'all' })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/get_voice')

      const body = JSON.parse(options.body as string)
      expect(body.voice_type).toBe('all')

      expect(result.systemVoice).toHaveLength(1)
      expect(result.systemVoice[0]!.voiceId).toBe('English_expressive_narrator')
      expect(result.systemVoice[0]!.voiceName).toBe('Expressive Narrator')

      expect(result.voiceCloning).toHaveLength(1)
      expect(result.voiceCloning[0]!.voiceId).toBe('my-clone')

      expect(result.voiceGeneration).toHaveLength(1)
      expect(result.voiceGeneration[0]!.voiceId).toBe('ttv-voice-abc')
    })

    it('should handle missing arrays gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      )

      const client = createClient()
      const result = await client.getVoices({ voiceType: 'system' })

      expect(result.systemVoice).toEqual([])
      expect(result.voiceCloning).toEqual([])
      expect(result.voiceGeneration).toEqual([])
    })
  })

  describe('deleteVoice', () => {
    it('should POST with correct body and map response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          voice_id: 'my-clone',
          created_time: '1700469398',
        }),
      )

      const client = createClient()
      const result = await client.deleteVoice({
        voiceType: 'voice_cloning',
        voiceId: 'my-clone',
      })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimaxi.chat/v1/delete_voice')

      const body = JSON.parse(options.body as string)
      expect(body.voice_type).toBe('voice_cloning')
      expect(body.voice_id).toBe('my-clone')

      expect(result.voiceId).toBe('my-clone')
      expect(result.createdTime).toBe('1700469398')
    })

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2013, status_msg: 'Invalid input' },
        }),
      )

      const client = createClient()
      await expect(
        client.deleteVoice({ voiceType: 'voice_generation', voiceId: 'bad' }),
      ).rejects.toThrow(MiniMaxValidationError)
    })
  })

  describe('error code classification', () => {
    it('should classify 2049 as MiniMaxAuthError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2049, status_msg: 'Invalid API key' },
        }),
      )

      const client = createClient()
      await expect(
        client.deleteVoice({ voiceType: 'voice_cloning', voiceId: 'x' }),
      ).rejects.toThrow(MiniMaxAuthError)
    })

    it('should classify 1041 as MiniMaxRateLimitError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 1041, status_msg: 'Connection limit' },
        }),
      )

      const client = createClient()
      await expect(
        client.designVoice({ prompt: 'test', previewText: 'test' }),
      ).rejects.toThrow(MiniMaxRateLimitError)
    })

    it('should classify 2045 as MiniMaxRateLimitError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2045, status_msg: 'Rate growth limit' },
        }),
      )

      const client = createClient()
      await expect(
        client.designVoice({ prompt: 'test', previewText: 'test' }),
      ).rejects.toThrow(MiniMaxRateLimitError)
    })

    it('should classify 2037 as MiniMaxValidationError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2037, status_msg: 'Voice duration too short' },
        }),
      )

      const client = createClient()
      await expect(
        client.cloneVoice({ fileId: 1, voiceId: 'test-voice' }),
      ).rejects.toThrow(MiniMaxValidationError)
    })

    it('should classify 2048 as MiniMaxValidationError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2048, status_msg: 'Prompt audio too long' },
        }),
      )

      const client = createClient()
      await expect(
        client.cloneVoice({ fileId: 1, voiceId: 'test-voice' }),
      ).rejects.toThrow(MiniMaxValidationError)
    })

    it('should classify unknown codes as generic MiniMaxError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 1000, status_msg: 'Unknown error' },
        }),
      )

      const client = createClient()
      await expect(
        client.designVoice({ prompt: 'test', previewText: 'test' }),
      ).rejects.toThrow(MiniMaxError)
    })
  })

  describe('client-side validation', () => {
    it('should throw MiniMaxClientError which is not a MiniMaxError', async () => {
      const client = createClient()
      try {
        await client.synthesize({
          text: 'Test',
          model: 'speech-01-hd',
          voiceSetting: { voiceId: 'v1', emotion: 'happy' },
        })
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxClientError)
        expect(e).not.toBeInstanceOf(MiniMaxError)
      }
    })

    describe('emotion + model compatibility', () => {
      it('should reject any emotion with speech-01-* models', async () => {
        const client = createClient()
        const err = client.synthesize({
          text: 'Test',
          model: 'speech-01-hd',
          voiceSetting: { voiceId: 'v1', emotion: 'happy' },
        })
        await expect(err).rejects.toThrow(MiniMaxClientError)
        await expect(err).rejects.toThrow('Emotion is not supported with model "speech-01-hd"')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should reject any emotion with speech-01-turbo', async () => {
        const client = createClient()
        await expect(
          client.synthesizeAsync({
            text: 'Test',
            model: 'speech-01-turbo',
            voiceSetting: { voiceId: 'v1', emotion: 'calm' },
          }),
        ).rejects.toThrow('Emotion is not supported with model "speech-01-turbo"')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should reject whisper emotion with non-2.6 model in synthesize', async () => {
        const client = createClient()
        await expect(
          client.synthesize({
            text: 'Test',
            model: 'speech-2.8-hd',
            voiceSetting: { voiceId: 'v1', emotion: 'whisper' },
          }),
        ).rejects.toThrow('Emotion "whisper" is only supported with speech-2.6-* models')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should reject fluent emotion with non-2.6 model in synthesize', async () => {
        const client = createClient()
        await expect(
          client.synthesize({
            text: 'Test',
            model: 'speech-02-hd',
            voiceSetting: { voiceId: 'v1', emotion: 'fluent' },
          }),
        ).rejects.toThrow('Emotion "fluent" is only supported with speech-2.6-* models')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should reject whisper emotion with default model in synthesize', async () => {
        const client = createClient()
        await expect(
          client.synthesize({
            text: 'Test',
            voiceSetting: { voiceId: 'v1', emotion: 'whisper' },
          }),
        ).rejects.toThrow('Emotion "whisper" is only supported with speech-2.6-* models, got "speech-02-hd"')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should allow whisper emotion with speech-2.6-hd', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          model: 'speech-2.6-hd',
          voiceSetting: { voiceId: 'v1', emotion: 'whisper' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow fluent emotion with speech-2.6-turbo', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          model: 'speech-2.6-turbo',
          voiceSetting: { voiceId: 'v1', emotion: 'fluent' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should reject whisper emotion in synthesizeStream', async () => {
        const client = createClient()
        await expect(
          client.synthesizeStream({
            text: 'Test',
            model: 'speech-2.8-turbo',
            voiceSetting: { voiceId: 'v1', emotion: 'whisper' },
          }),
        ).rejects.toThrow('Emotion "whisper" is only supported with speech-2.6-* models')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should allow happy emotion with speech-02-hd', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          model: 'speech-02-hd',
          voiceSetting: { voiceId: 'v1', emotion: 'happy' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow calm emotion with speech-2.8-hd', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          model: 'speech-2.8-hd',
          voiceSetting: { voiceId: 'v1', emotion: 'calm' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should skip validation when no emotion is set', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          model: 'speech-01-hd',
          voiceSetting: { voiceId: 'v1' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })
    })

    describe('wav format validation', () => {
      it('should reject wav format in synthesizeStream', async () => {
        const client = createClient()
        const err = client.synthesizeStream({
          text: 'Test',
          audioSetting: { format: 'wav' },
        })
        await expect(err).rejects.toThrow(MiniMaxClientError)
        await expect(err).rejects.toThrow('WAV format is not supported in streaming mode')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should reject wav format in synthesizeAsync', async () => {
        const client = createClient()
        const err = client.synthesizeAsync({
          text: 'Test',
          audioSetting: { format: 'wav' },
        })
        await expect(err).rejects.toThrow(MiniMaxClientError)
        await expect(err).rejects.toThrow('WAV format is not supported in async mode')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should allow pcm format in synthesizeStream', async () => {
        const stream = makeSSEStream([
          { data: { audio: Buffer.from('ok').toString('hex'), status: 1 }, trace_id: 't' },
        ])
        mockFetch.mockResolvedValueOnce(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )

        const client = createClient()
        await client.synthesizeStream({
          text: 'Test',
          audioSetting: { format: 'pcm' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow flac format in synthesizeStream', async () => {
        const stream = makeSSEStream([
          { data: { audio: Buffer.from('ok').toString('hex'), status: 1 }, trace_id: 't' },
        ])
        mockFetch.mockResolvedValueOnce(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )

        const client = createClient()
        await client.synthesizeStream({
          text: 'Test',
          audioSetting: { format: 'flac' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow mp3 format in synthesizeStream', async () => {
        const stream = makeSSEStream([
          { data: { audio: Buffer.from('ok').toString('hex'), status: 1 }, trace_id: 't' },
        ])
        mockFetch.mockResolvedValueOnce(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )

        const client = createClient()
        await client.synthesizeStream({
          text: 'Test',
          audioSetting: { format: 'mp3' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow no format specified in synthesizeStream', async () => {
        const stream = makeSSEStream([
          { data: { audio: Buffer.from('ok').toString('hex'), status: 1 }, trace_id: 't' },
        ])
        mockFetch.mockResolvedValueOnce(
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        )

        const client = createClient()
        await client.synthesizeStream({ text: 'Test' })

        expect(mockFetch).toHaveBeenCalled()
      })

      it('should allow wav format in non-streaming synthesize', async () => {
        const audioHex = Buffer.from('ok').toString('hex')
        mockFetch.mockResolvedValueOnce(
          makeResponse({
            base_resp: { status_code: 0, status_msg: 'success' },
            data: { audio: audioHex, status: 2 },
            extra_info: { ...baseExtraInfo },
            trace_id: 'trace-ok',
          }),
        )

        const client = createClient()
        await client.synthesize({
          text: 'Test',
          audioSetting: { format: 'wav' },
        })

        expect(mockFetch).toHaveBeenCalled()
      })
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiniMaxSpeech } from '../src/client.js'
import { MiniMaxError, MiniMaxAuthError, MiniMaxRateLimitError, MiniMaxValidationError } from '../src/errors.js'
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
          extra_info: {
            audio_length: 1000,
            audio_sample_rate: 32000,
            audio_size: 5000,
            bitrate: 128000,
            word_count: 2,
            usage_characters: 10,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
          extra_info: {
            audio_length: 100,
            audio_sample_rate: 32000,
            audio_size: 500,
            bitrate: 128000,
            word_count: 1,
            usage_characters: 4,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
          extra_info: {
            audio_length: 100,
            audio_sample_rate: 32000,
            audio_size: 500,
            bitrate: 128000,
            word_count: 1,
            usage_characters: 5,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
            audio_length: 1000,
            audio_sample_rate: 32000,
            audio_size: 15,
            bitrate: 128000,
            word_count: 3,
            usage_characters: 15,
            audio_format: 'mp3',
            audio_channel: 1,
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
          extra_info: {
            audio_length: 1000,
            audio_sample_rate: 32000,
            audio_size: 5000,
            bitrate: 128000,
            word_count: 1,
            usage_characters: 5,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
          extra_info: {
            audio_length: 0,
            audio_sample_rate: 0,
            audio_size: 0,
            bitrate: 0,
            word_count: 0,
            usage_characters: 0,
            audio_format: '',
            audio_channel: 0,
          },
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
          extra_info: {
            audio_length: 0,
            audio_sample_rate: 0,
            audio_size: 0,
            bitrate: 0,
            word_count: 0,
            usage_characters: 0,
            audio_format: '',
            audio_channel: 0,
          },
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
          extra_info: {
            audio_length: 0,
            audio_sample_rate: 0,
            audio_size: 0,
            bitrate: 0,
            word_count: 0,
            usage_characters: 0,
            audio_format: '',
            audio_channel: 0,
          },
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
          extra_info: {
            audio_length: 100,
            audio_sample_rate: 32000,
            audio_size: 500,
            bitrate: 128000,
            word_count: 1,
            usage_characters: 4,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
          extra_info: {
            audio_length: 100,
            audio_sample_rate: 32000,
            audio_size: 500,
            bitrate: 128000,
            word_count: 1,
            usage_characters: 4,
            audio_format: 'mp3',
            audio_channel: 1,
          },
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
      const audioStream = await client.synthesizeStream({ text: 'Hello streaming' })

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
})

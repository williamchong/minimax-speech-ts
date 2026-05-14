import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MiniMaxSpeech } from '../src/client.js'
import { MiniMaxClientError, MiniMaxHttpError, MiniMaxError, MiniMaxAuthError, MiniMaxRateLimitError, MiniMaxValidationError } from '../src/errors.js'
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

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(merged)
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
        'https://api.minimax.io/v1/t2a_v2',
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
        'https://api.minimax.io/v1/t2a_v2?GroupId=group-123',
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
      await expect(client.synthesize({ text: 'test' })).rejects.toThrow(MiniMaxValidationError)
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

    it('should throw MiniMaxHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
      )

      const client = createClient()
      try {
        await client.synthesize({ text: 'test' })
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxHttpError)
        expect((e as MiniMaxHttpError).httpStatus).toBe(500)
        expect((e as MiniMaxHttpError).statusText).toBe('Internal Server Error')
      }
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

    it('should send subtitleType as subtitle_type', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-st',
        }),
      )

      const client = createClient()
      await client.synthesize({ text: 'Test', subtitleEnable: true, subtitleType: 'word' })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.subtitle_type).toBe('word')
    })

    it('should reject word_streaming subtitleType in non-streaming synthesize', async () => {
      const client = createClient()
      await expect(
        // @ts-expect-error — TS narrows subtitleType to exclude 'word_streaming' on synthesize; this tests the runtime guard for JS callers.
        client.synthesize({ text: 'Test', subtitleType: 'word_streaming' }),
      ).rejects.toThrow('"word_streaming" subtitle type is only valid in streaming mode')
      expect(mockFetch).not.toHaveBeenCalled()
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

    it('should send pronunciationDict in body', async () => {
      const audioHex = Buffer.from('test').toString('hex')
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: { audio: audioHex, status: 2 },
          extra_info: { ...baseExtraInfo },
          trace_id: 'trace-pd',
        }),
      )

      const client = createClient()
      await client.synthesize({
        text: 'Test',
        pronunciationDict: { tone: ['处理, chǔ lǐ'] },
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.pronunciation_dict).toEqual({ tone: ['处理, chǔ lǐ'] })
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
      const { audio: audioStream } = await client.synthesizeStream({ text: 'Hello streaming' })

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
      const { audio: audioStream } = await client.synthesizeStream({ text: 'Test' })

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
      const { audio: audioStream } = await client.synthesizeStream({ text: 'Test' })

      const reader = audioStream.getReader()
      await expect(reader.read()).rejects.toThrow(MiniMaxAuthError)
    })

    it('should resolve subtitle to undefined when stream errors', async () => {
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
      const { audio, subtitle } = await client.synthesizeStream({
        text: 'Test',
        subtitleEnable: true,
      })

      const reader = audio.getReader()
      await expect(reader.read()).rejects.toThrow(MiniMaxAuthError)
      expect(await subtitle).toBeUndefined()
    })

    it('should throw MiniMaxHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      )

      const client = createClient()
      try {
        await client.synthesizeStream({ text: 'test' })
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxHttpError)
        expect((e as MiniMaxHttpError).httpStatus).toBe(401)
        expect((e as MiniMaxHttpError).statusText).toBe('Unauthorized')
      }
    })

    it('should throw when response body is null', async () => {
      const response = new Response(null, { status: 200 })
      Object.defineProperty(response, 'body', { value: null })
      mockFetch.mockResolvedValueOnce(response)

      const client = createClient()
      await expect(client.synthesizeStream({ text: 'test' })).rejects.toThrow('Response body is null')
    })

    it('should resolve subtitle to undefined when the response stream errors mid-read', async () => {
      const audioHex = Buffer.from('a').toString('hex')
      const encoder = new TextEncoder()
      let pulled = false
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!pulled) {
            pulled = true
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ data: { audio: audioHex, status: 1 }, trace_id: 't' })}\n\n`))
            return
          }
          throw new Error('network failure')
        },
      })

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const { audio, subtitle } = await client.synthesizeStream({
        text: 'Test',
        subtitleEnable: true,
      })

      const reader = audio.getReader()
      await reader.read() // first chunk arrives
      await expect(reader.read()).rejects.toThrow('network failure')
      expect(await subtitle).toBeUndefined()
    })

    it('should allow subtitleEnable and word_streaming subtitleType in streaming', async () => {
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
        subtitleEnable: true,
        subtitleType: 'word_streaming',
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.subtitle_enable).toBe(true)
      expect(body.subtitle_type).toBe('word_streaming')
    })

    it('should resolve subtitle to undefined when consumer cancels the audio stream', async () => {
      const audioHex = Buffer.from('a').toString('hex')
      const stream = makeSSEStream([
        { data: { audio: audioHex, status: 1 }, trace_id: 't' },
        { data: { audio: audioHex, status: 1 }, trace_id: 't' },
        { data: { audio: audioHex, status: 1 }, trace_id: 't' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const { audio, subtitle } = await client.synthesizeStream({
        text: 'Test',
        subtitleEnable: true,
      })

      const reader = audio.getReader()
      await reader.read() // consume one chunk
      await reader.cancel('user cancelled')

      expect(await subtitle).toBeUndefined()
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

    it('should silently skip malformed SSE data', async () => {
      const audioHex = Buffer.from('good').toString('hex')

      const stream = makeSSEStream([
        'not valid json{{{',
        { data: { audio: audioHex, status: 1 }, trace_id: 'trace-ok' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const { audio: audioStream } = await client.synthesizeStream({ text: 'Test' })

      const chunks: Buffer[] = []
      const reader = audioStream.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      expect(chunks).toHaveLength(1)
      expect(chunks[0]!.toString()).toBe('good')
    })

    it('should resolve subtitle URL from final status 2 chunk', async () => {
      const audioHex = Buffer.from('a').toString('hex')
      const stream = makeSSEStream([
        { data: { audio: audioHex, status: 1 }, trace_id: 't' },
        {
          data: { audio: '', status: 2, subtitle_file: 'https://example.com/sub.json' },
          trace_id: 't',
        },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const { audio, subtitle } = await client.synthesizeStream({
        text: 'Test',
        subtitleEnable: true,
      })

      const reader = audio.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      expect(await subtitle).toBe('https://example.com/sub.json')
    })

    it('should resolve subtitle to undefined when no status 2 chunk seen', async () => {
      const audioHex = Buffer.from('a').toString('hex')
      const stream = makeSSEStream([
        { data: { audio: audioHex, status: 1 }, trace_id: 't' },
      ])

      mockFetch.mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      )

      const client = createClient()
      const { audio, subtitle } = await client.synthesizeStream({ text: 'Test' })

      const reader = audio.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      expect(await subtitle).toBeUndefined()
    })
  })

  describe('synthesizeAsync', () => {
    it('should POST to async endpoint with correct body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 95157322514444,
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
      expect(url).toBe('https://api.minimax.io/v1/t2a_async_v2')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body as string)
      expect(body.text).toBe('Hello async')
      expect(body.model).toBe('speech-02-hd')
      expect(body.voice_setting.voice_id).toBe('English_expressive_narrator')

      expect(result.taskId).toBe(95157322514444)
      expect(result.fileId).toBe(456)
      expect(result.taskToken).toBe('token-789')
      expect(result.usageCharacters).toBe(100)
    })

    it('should rename audio_sample_rate and english_normalization for async API', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 1,
          file_id: 1,
          task_token: 't',
          usage_characters: 1,
        }),
      )

      const client = createClient()
      await client.synthesizeAsync({
        text: 'Hello',
        voiceSetting: { voiceId: 'v', textNormalization: true },
        audioSetting: { sampleRate: 32000, bitrate: 128000 },
      })

      const [, options] = mockFetch.mock.calls[0]!
      const body = JSON.parse(options.body as string)
      expect(body.audio_setting.audio_sample_rate).toBe(32000)
      expect(body.audio_setting.sample_rate).toBeUndefined()
      expect(body.audio_setting.bitrate).toBe(128000)
      expect(body.voice_setting.english_normalization).toBe(true)
      expect(body.voice_setting.text_normalization).toBeUndefined()
    })

    it('should send textFileId as text_file_id', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          task_id: 95157322514445,
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

    it('should throw if neither text nor textFileId is provided', async () => {
      const client = createClient()
      await expect(client.synthesizeAsync({})).rejects.toThrow(MiniMaxClientError)
      await expect(client.synthesizeAsync({})).rejects.toThrow('Either "text" or "textFileId" is required')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should throw if both text and textFileId are provided', async () => {
      const client = createClient()
      await expect(
        client.synthesizeAsync({ text: 'Hello', textFileId: 1 }),
      ).rejects.toThrow(MiniMaxClientError)
      await expect(
        client.synthesizeAsync({ text: 'Hello', textFileId: 1 }),
      ).rejects.toThrow('"text" and "textFileId" are mutually exclusive')
      expect(mockFetch).not.toHaveBeenCalled()
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
      const result = await client.querySynthesizeAsync(95157322514444)

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimax.io/v1/query/t2a_async_query_v2?task_id=95157322514444')
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
      await client.querySynthesizeAsync(42)

      const [url] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimax.io/v1/query/t2a_async_query_v2?GroupId=grp-1&task_id=42')
    })

    it('should throw MiniMaxHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404, statusText: 'Not Found' }),
      )

      const client = createClient()
      try {
        await client.querySynthesizeAsync(999)
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxHttpError)
        expect((e as MiniMaxHttpError).httpStatus).toBe(404)
        expect((e as MiniMaxHttpError).statusText).toBe('Not Found')
      }
    })

    it('should throw on API error with trace_id', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 1004, status_msg: 'Unauthorized' },
          trace_id: 'trace-query-err',
        }),
      )

      const client = createClient()
      try {
        await client.querySynthesizeAsync(0)
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxAuthError)
        expect((e as MiniMaxAuthError).traceId).toBe('trace-query-err')
      }
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
      expect(url).toBe('https://api.minimax.io/v1/files/upload')
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

    it('should throw MiniMaxHttpError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }),
      )

      const client = createClient()
      const blob = new Blob(['data'])
      try {
        await client.uploadFile(blob, 'voice_clone')
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxHttpError)
        expect((e as MiniMaxHttpError).httpStatus).toBe(503)
        expect((e as MiniMaxHttpError).statusText).toBe('Service Unavailable')
      }
    })

    it('should use provided filename when uploading a Blob', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          file: {
            file_id: 1,
            bytes: 4,
            created_at: 1,
            filename: 'override.mp3',
            purpose: 'voice_clone',
          },
        }),
      )

      const client = createClient()
      const blob = new Blob(['data'], { type: 'audio/mp3' })
      await client.uploadFile(blob, 'voice_clone', { filename: 'override.mp3' })

      const [, options] = mockFetch.mock.calls[0]!
      const formData = options.body as FormData
      const filePart = formData.get('file') as { name: string }
      expect(filePart.name).toBe('override.mp3')
    })

    it('should POST multipart stream with correct headers and body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          file: {
            file_id: 77,
            bytes: 11,
            created_at: 1700000000,
            filename: 'voice.wav',
            purpose: 'voice_clone',
          },
        }),
      )

      const payload = new TextEncoder().encode('hello world')
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload)
          controller.close()
        },
      })

      const client = createClient()
      const result = await client.uploadFile(stream, 'voice_clone', {
        filename: 'voice.wav',
        contentType: 'audio/wav',
      })

      const [url, options] = mockFetch.mock.calls[0]!
      expect(url).toBe('https://api.minimax.io/v1/files/upload')
      expect(options.method).toBe('POST')
      expect(options.duplex).toBe('half')
      expect(options.headers.Authorization).toBe('Bearer test-api-key')

      const contentType = options.headers['Content-Type'] as string
      const boundaryMatch = contentType.match(/^multipart\/form-data; boundary=(.+)$/)
      expect(boundaryMatch).not.toBeNull()
      const boundary = boundaryMatch![1]!
      expect(boundary).toMatch(/^----MiniMaxFormBoundary[0-9a-f]{32}$/)

      const bodyStream = options.body as ReadableStream<Uint8Array>
      expect(typeof bodyStream.getReader).toBe('function')
      const serialized = await drainStream(bodyStream)

      expect(serialized).toContain(`--${boundary}\r\n`)
      expect(serialized).toContain('Content-Disposition: form-data; name="purpose"\r\n\r\nvoice_clone\r\n')
      expect(serialized).toContain('Content-Disposition: form-data; name="file"; filename="voice.wav"\r\n')
      expect(serialized).toContain('Content-Type: audio/wav\r\n\r\n')
      expect(serialized).toContain('hello world')
      expect(serialized).toContain(`\r\n--${boundary}--\r\n`)

      expect(result.file.fileId).toBe(77)
    })

    it('should default stream contentType to application/octet-stream', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          file: {
            file_id: 1,
            bytes: 1,
            created_at: 1,
            filename: 'blob.bin',
            purpose: 'prompt_audio',
          },
        }),
      )

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x00]))
          controller.close()
        },
      })

      const client = createClient()
      await client.uploadFile(stream, 'prompt_audio', { filename: 'blob.bin' })

      const [, options] = mockFetch.mock.calls[0]!
      const serialized = await drainStream(options.body as ReadableStream<Uint8Array>)
      expect(serialized).toContain('Content-Type: application/octet-stream\r\n\r\n')
    })

    it('should require filename when uploading a stream', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })

      const client = createClient()
      await expect(
        // @ts-expect-error — intentionally missing required filename at runtime
        client.uploadFile(stream, 'voice_clone', {}),
      ).rejects.toThrow(MiniMaxClientError)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should reject an invalid purpose', async () => {
      const client = createClient()
      const blob = new Blob(['data'])
      await expect(
        // @ts-expect-error — intentionally passing a value outside the FilePurpose union
        client.uploadFile(blob, 'voice_clone\r\nX-Injected: 1'),
      ).rejects.toThrow(MiniMaxClientError)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should propagate cancel to the upstream stream on abort', async () => {
      let cancelReason: unknown = undefined
      const upstream = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => {})
        },
        cancel(reason) {
          cancelReason = reason
        },
      })

      mockFetch.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        await (init.body as ReadableStream<Uint8Array>).cancel('aborted')
        throw new Error('fetch aborted')
      })

      const client = createClient()
      await expect(
        client.uploadFile(upstream, 'voice_clone', { filename: 'x.bin' }),
      ).rejects.toThrow('fetch aborted')
      expect(cancelReason).toBe('aborted')
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
      expect(url).toBe('https://api.minimax.io/v1/voice_clone')

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

    it('should parse extra_info when present in voice clone response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          demo_audio: 'https://example.com/preview.mp3',
          input_sensitive: { type: 0 },
          extra_info: {
            audio_length: 11124,
            audio_sample_rate: 32000,
            audio_size: 179926,
            bitrate: 128000,
            word_count: 18,
            usage_characters: 18,
          },
        }),
      )

      const client = createClient()
      const result = await client.cloneVoice({
        fileId: 1,
        voiceId: 'v',
        text: 'Preview',
        model: 'speech-2.8-hd',
      })

      expect(result.extraInfo).toBeDefined()
      expect(result.extraInfo!.audioLength).toBe(11124)
      expect(result.extraInfo!.usageCharacters).toBe(18)
    })

    it('should leave extraInfo undefined when not returned', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          demo_audio: '',
          input_sensitive: { type: 0 },
        }),
      )

      const client = createClient()
      const result = await client.cloneVoice({ fileId: 1, voiceId: 'v' })

      expect(result.extraInfo).toBeUndefined()
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

    it('should throw MiniMaxHttpError on HTTP error (postJson path)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }),
      )

      const client = createClient()
      try {
        await client.cloneVoice({ fileId: 1, voiceId: 'test-voice' })
        expect.unreachable('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(MiniMaxHttpError)
        expect((e as MiniMaxHttpError).httpStatus).toBe(502)
        expect((e as MiniMaxHttpError).statusText).toBe('Bad Gateway')
      }
    })

    it('should throw if text is provided without model', async () => {
      const client = createClient()
      await expect(
        client.cloneVoice({ fileId: 1, voiceId: 'my-voice', text: 'Preview' }),
      ).rejects.toThrow(MiniMaxClientError)
      await expect(
        client.cloneVoice({ fileId: 1, voiceId: 'my-voice', text: 'Preview' }),
      ).rejects.toThrow('"model" is required when "text" is provided')
      expect(mockFetch).not.toHaveBeenCalled()
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
      expect(url).toBe('https://api.minimax.io/v1/voice_design')

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
      expect(url).toBe('https://api.minimax.io/v1/get_voice')

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
      expect(url).toBe('https://api.minimax.io/v1/delete_voice')

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

    it('should classify 2042 as MiniMaxAuthError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2042, status_msg: 'No access to voice_id' },
        }),
      )

      const client = createClient()
      await expect(
        client.deleteVoice({ voiceType: 'voice_cloning', voiceId: 'x' }),
      ).rejects.toThrow(MiniMaxAuthError)
    })

    it('should classify 2056 as MiniMaxRateLimitError', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          base_resp: { status_code: 2056, status_msg: 'Usage limit exceeded' },
        }),
      )

      const client = createClient()
      await expect(
        client.designVoice({ prompt: 'test', previewText: 'test' }),
      ).rejects.toThrow(MiniMaxRateLimitError)
    })

    it('should classify 1008/1026/1027/1043/1044 as MiniMaxValidationError', async () => {
      const codes = [1008, 1026, 1027, 1043, 1044]
      const client = createClient()
      for (const code of codes) {
        mockFetch.mockResolvedValueOnce(
          makeJsonResponse({
            base_resp: { status_code: code, status_msg: `code ${code}` },
          }),
        )
        await expect(
          client.cloneVoice({ fileId: 1, voiceId: 'v' }),
        ).rejects.toThrow(MiniMaxValidationError)
      }
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

    describe('required field validation', () => {
      it('should throw if synthesize text is empty string', async () => {
        const client = createClient()
        await expect(client.synthesize({ text: '' })).rejects.toThrow(MiniMaxClientError)
        await expect(client.synthesize({ text: '' })).rejects.toThrow('"text" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if synthesize text is undefined', async () => {
        const client = createClient()
        await expect(
          client.synthesize({ text: undefined } as unknown as Parameters<typeof client.synthesize>[0]),
        ).rejects.toThrow('"text" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if synthesizeStream text is empty string', async () => {
        const client = createClient()
        await expect(client.synthesizeStream({ text: '' })).rejects.toThrow(MiniMaxClientError)
        await expect(client.synthesizeStream({ text: '' })).rejects.toThrow('"text" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if cloneVoice fileId is missing', async () => {
        const client = createClient()
        await expect(
          client.cloneVoice({ voiceId: 'v1' } as unknown as Parameters<typeof client.cloneVoice>[0]),
        ).rejects.toThrow('"fileId" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if cloneVoice voiceId is empty string', async () => {
        const client = createClient()
        await expect(
          client.cloneVoice({ fileId: 1, voiceId: '' }),
        ).rejects.toThrow('"voiceId" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if designVoice prompt is empty string', async () => {
        const client = createClient()
        await expect(
          client.designVoice({ prompt: '', previewText: 'test' }),
        ).rejects.toThrow('"prompt" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if designVoice previewText is empty string', async () => {
        const client = createClient()
        await expect(
          client.designVoice({ prompt: 'test', previewText: '' }),
        ).rejects.toThrow('"previewText" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if designVoice previewText exceeds 500 characters', async () => {
        const client = createClient()
        await expect(
          client.designVoice({ prompt: 'test', previewText: 'a'.repeat(501) }),
        ).rejects.toThrow('"previewText" must be 500 characters or fewer')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if getVoices voiceType is empty string', async () => {
        const client = createClient()
        await expect(
          client.getVoices({ voiceType: '' } as unknown as Parameters<typeof client.getVoices>[0]),
        ).rejects.toThrow('"voiceType" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if deleteVoice voiceType is missing', async () => {
        const client = createClient()
        await expect(
          client.deleteVoice({ voiceId: 'v1' } as unknown as Parameters<typeof client.deleteVoice>[0]),
        ).rejects.toThrow('"voiceType" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })

      it('should throw if deleteVoice voiceId is empty string', async () => {
        const client = createClient()
        await expect(
          client.deleteVoice({ voiceType: 'voice_cloning', voiceId: '' }),
        ).rejects.toThrow('"voiceId" is required')
        expect(mockFetch).not.toHaveBeenCalled()
      })
    })
  })
})

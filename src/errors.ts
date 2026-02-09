export class MiniMaxError extends Error {
  statusCode: number
  statusMsg: string
  traceId?: string

  constructor(statusCode: number, statusMsg: string, traceId?: string) {
    super(`MiniMax API error ${statusCode}: ${statusMsg}`)
    this.name = 'MiniMaxError'
    this.statusCode = statusCode
    this.statusMsg = statusMsg
    this.traceId = traceId
  }
}

export class MiniMaxAuthError extends MiniMaxError {
  constructor(statusCode: number, statusMsg: string, traceId?: string) {
    super(statusCode, statusMsg, traceId)
    this.name = 'MiniMaxAuthError'
  }
}

export class MiniMaxRateLimitError extends MiniMaxError {
  constructor(statusCode: number, statusMsg: string, traceId?: string) {
    super(statusCode, statusMsg, traceId)
    this.name = 'MiniMaxRateLimitError'
  }
}

export class MiniMaxValidationError extends MiniMaxError {
  constructor(statusCode: number, statusMsg: string, traceId?: string) {
    super(statusCode, statusMsg, traceId)
    this.name = 'MiniMaxValidationError'
  }
}

const AUTH_CODES = new Set([1004, 2049])
const RATE_LIMIT_CODES = new Set([1002, 1039, 1041, 2045])
const VALIDATION_CODES = new Set([2013, 1042, 2037, 2039, 2048, 20132])

export function createMiniMaxError(statusCode: number, statusMsg: string, traceId?: string): MiniMaxError {
  if (AUTH_CODES.has(statusCode)) {
    return new MiniMaxAuthError(statusCode, statusMsg, traceId)
  }
  if (RATE_LIMIT_CODES.has(statusCode)) {
    return new MiniMaxRateLimitError(statusCode, statusMsg, traceId)
  }
  if (VALIDATION_CODES.has(statusCode)) {
    return new MiniMaxValidationError(statusCode, statusMsg, traceId)
  }
  return new MiniMaxError(statusCode, statusMsg, traceId)
}

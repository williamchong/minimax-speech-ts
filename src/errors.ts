export class MiniMaxClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MiniMaxClientError'
  }
}

export class MiniMaxHttpError extends Error {
  httpStatus: number
  statusText: string

  constructor(httpStatus: number, statusText: string) {
    super(`HTTP ${httpStatus}: ${statusText}`)
    this.name = 'MiniMaxHttpError'
    this.httpStatus = httpStatus
    this.statusText = statusText
  }
}

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

const AUTH_CODES = new Set([1004, 2042, 2049])
const RATE_LIMIT_CODES = new Set([1002, 1039, 1041, 2045, 2056])
const VALIDATION_CODES = new Set([1008, 1026, 1027, 1042, 1043, 1044, 2013, 2037, 2039, 2048, 20132])

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

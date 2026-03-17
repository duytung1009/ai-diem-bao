// ─── Scraping Errors ──────────────────────────────────────────────────────────

export enum ScrapingErrorCode {
  NOT_XENFORO = 'NOT_XENFORO',
  LOGIN_REQUIRED = 'LOGIN_REQUIRED',
  TIMEOUT = 'TIMEOUT',
  EMPTY_TOPIC = 'EMPTY_TOPIC',
}

const SCRAPING_MESSAGES: Record<ScrapingErrorCode, string> = {
  [ScrapingErrorCode.NOT_XENFORO]: 'Trang này không phải forum XenForo.',
  [ScrapingErrorCode.LOGIN_REQUIRED]: 'Vui lòng đăng nhập vào forum trước.',
  [ScrapingErrorCode.TIMEOUT]: 'Không thể tải trang, vui lòng thử lại.',
  [ScrapingErrorCode.EMPTY_TOPIC]: 'Topic này không có bài viết nào.',
};

export class ScrapingError extends Error {
  constructor(
    public readonly code: ScrapingErrorCode,
    message?: string,
  ) {
    super(message ?? SCRAPING_MESSAGES[code]);
    this.name = 'ScrapingError';
  }
}

// ─── LLM Errors ───────────────────────────────────────────────────────────────

export enum LLMErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVER_ERROR = 'SERVER_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

const LLM_MESSAGES: Record<LLMErrorCode, string> = {
  [LLMErrorCode.AUTH_FAILED]: 'API key không hợp lệ. Vui lòng kiểm tra lại cài đặt.',
  [LLMErrorCode.RATE_LIMITED]: 'Đã vượt giới hạn tốc độ API. Vui lòng thử lại sau ít phút.',
  [LLMErrorCode.SERVER_ERROR]: 'Lỗi máy chủ LLM. Vui lòng thử lại sau.',
  [LLMErrorCode.BAD_REQUEST]: 'Yêu cầu không hợp lệ. Vui lòng kiểm tra cài đặt model.',
  [LLMErrorCode.NETWORK_ERROR]: 'Không thể kết nối đến API. Kiểm tra kết nối mạng của bạn.',
};

export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message?: string,
    public readonly status?: number,
  ) {
    super(message ?? LLM_MESSAGES[code]);
    this.name = 'LLMError';
  }
}

/** True if the status code can be retried (rate limit or server error) */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Map HTTP status to LLMErrorCode */
export function llmErrorFromStatus(status: number, body: string): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError(LLMErrorCode.AUTH_FAILED, undefined, status);
  }
  if (status === 429) {
    return new LLMError(LLMErrorCode.RATE_LIMITED, undefined, status);
  }
  if (status === 400) {
    return new LLMError(LLMErrorCode.BAD_REQUEST, body || undefined, status);
  }
  if (status >= 500) {
    return new LLMError(LLMErrorCode.SERVER_ERROR, undefined, status);
  }
  return new LLMError(LLMErrorCode.NETWORK_ERROR, `HTTP ${status}: ${body}`, status);
}

// ─── Cache Errors ─────────────────────────────────────────────────────────────

export enum CacheErrorCode {
  READ_FAILED = 'READ_FAILED',
  WRITE_FAILED = 'WRITE_FAILED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
}

export class CacheError extends Error {
  constructor(
    public readonly code: CacheErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CacheError';
  }
}

// ─── Network Errors ───────────────────────────────────────────────────────────

export enum NetworkErrorCode {
  OFFLINE = 'OFFLINE',
  TIMEOUT = 'TIMEOUT',
  DNS_FAILED = 'DNS_FAILED',
}

export class NetworkError extends Error {
  constructor(
    public readonly code: NetworkErrorCode = NetworkErrorCode.OFFLINE,
    message = 'Không thể kết nối. Kiểm tra kết nối mạng của bạn.',
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

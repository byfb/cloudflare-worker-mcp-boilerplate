export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  elapsedMs: number;
}

export type RequestLogger = (line: string) => void;

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url.split(/[?#]/, 1)[0] || "/";
  }
}

export function createRequestLog(
  request: Request,
  response: Response,
  startedAtMs: number,
  nowAtMs = Date.now(),
): RequestLogEntry {
  return {
    method: request.method,
    path: requestPath(request),
    status: response.status,
    elapsedMs: Math.max(0, Math.floor(nowAtMs - startedAtMs)),
  };
}

export function formatRequestLog(entry: RequestLogEntry): string {
  return `${entry.method} ${entry.path} ${entry.status} ${entry.elapsedMs}ms`;
}

/** Emit only method, URL path, status, and elapsed milliseconds. */
export function logRequest(
  request: Request,
  response: Response,
  startedAtMs: number,
  logger: RequestLogger = (line) => console.log(line),
  nowAtMs = Date.now(),
): string {
  const line = formatRequestLog(createRequestLog(request, response, startedAtMs, nowAtMs));
  logger(line);
  return line;
}

export const requestLog = logRequest;

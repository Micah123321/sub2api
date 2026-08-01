export class ResponseBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseBodyError';
  }
}

/** Reads one JSON response while enforcing a byte limit before parsing. */
export async function readLimitedJson(
  response: Response,
  controller: AbortController,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    controller.abort();
    throw new ResponseBodyError('主服务响应体过大');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ResponseBodyError('主服务响应体为空');
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      controller.abort();
      throw new ResponseBodyError('主服务响应体过大');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new ResponseBodyError('主服务返回了非 JSON 响应');
  }
}

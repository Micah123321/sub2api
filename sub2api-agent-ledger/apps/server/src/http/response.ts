import { createRequestId } from '../common/ids';

export interface ApiEnvelope<T> {
  code: string;
  message: string;
  data?: T;
  requestId: string;
}

export function ok<T>(data: T, requestId = createRequestId(), message = 'success'): ApiEnvelope<T> {
  return {
    code: 'OK',
    message,
    data,
    requestId,
  };
}

export function fail(
  code: string,
  message: string,
  requestId = createRequestId(),
): ApiEnvelope<undefined> {
  return {
    code,
    message,
    requestId,
  };
}

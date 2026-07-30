import { describe, expect, it } from 'vitest';
import { normalizePage } from './pagination';

describe('normalizePage', () => {
  it('uses the default page size and calculates an offset', () => {
    expect(normalizePage({ page: '3' })).toEqual({ page: 3, pageSize: 25, offset: 50 });
  });

  it('clamps malformed and oversized input to safe bounds', () => {
    expect(normalizePage({ page: '-1', pageSize: '1000' })).toEqual({ page: 1, pageSize: 100, offset: 0 });
    expect(normalizePage({ page: 'x', pageSize: '0' })).toEqual({ page: 1, pageSize: 1, offset: 0 });
  });
});

export interface PageRequest {
  page?: number | string;
  pageSize?: number | string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function normalizePage(input: PageRequest = {}, fallbackPageSize = 25) {
  const parsedPage = Number(input.page);
  const parsedPageSize = Number(input.pageSize);
  const page = Math.max(1, Math.trunc(Number.isFinite(parsedPage) ? parsedPage : 1));
  const requestedPageSize = input.pageSize == null || !Number.isFinite(parsedPageSize)
    ? fallbackPageSize
    : Math.trunc(parsedPageSize);
  const pageSize = Math.min(100, Math.max(1, requestedPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

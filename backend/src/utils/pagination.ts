export function parsePagination(page?: string, pageSize?: string) {
  const parsedPage = Number(page);
  const parsedPageSize = Number(pageSize);
  const safePage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safePageSize = Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? Math.min(parsedPageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize, skip: (safePage - 1) * safePageSize };
}

export function paged<T>(data: T[], total: number, page: number, pageSize: number) {
  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export function parseBoolean(value?: string) {
  if (value === undefined || value === '') return undefined;
  return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

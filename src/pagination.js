export const COMPANY_PAGE_SIZES = Object.freeze([12, 24, 48]);

export function paginateItems(items, requestedPage = 1, requestedSize = 12) {
  const pageSize = COMPANY_PAGE_SIZES.includes(Number(requestedSize)) ? Number(requestedSize) : 12;
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumber = Number(requestedPage);
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(pageNumber) ? pageNumber : 1));
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
    totalPages,
    start: total ? offset + 1 : 0,
    end: Math.min(offset + pageSize, total),
  };
}

export function paginationPages(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (page >= totalPages - 3) return [1, "ellipsis", ...Array.from({ length: 5 }, (_, index) => totalPages - 4 + index)];
  return [1, "ellipsis", page - 1, page, page + 1, "ellipsis", totalPages];
}

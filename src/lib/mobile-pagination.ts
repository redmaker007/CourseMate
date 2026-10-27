export function readMobilePagination(params: URLSearchParams) {
  const limit = params.get("limit") ?? "50";
  const offset = params.get("offset") ?? "0";
  if (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100 || !/^(0|[1-9]\d{0,5})$/.test(offset)) return null;
  return { limit: Number(limit), offset: Number(offset) };
}

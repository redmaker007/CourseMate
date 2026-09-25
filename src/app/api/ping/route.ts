// 不返回任何数据，所以不需要再授权。登录校验由 proxy 完成，
// 而这段耗时正是「服务」读数要测的内容。
export function GET() {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

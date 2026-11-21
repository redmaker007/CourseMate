const SEASONS: Record<string, string> = {
  spring: "春季",
  summer: "夏季",
  fall: "秋季",
  autumn: "秋季",
  winter: "冬季",
};

/**
 * 学期代码转成给学生看的文字：'2026-fall' → '2026 秋季'。
 * 认不出的格式原样返回，不猜。
 */
export function formatTerm(term: string): string {
  const match = term.trim().match(/^(\d{4})-([a-z]+)$/i);
  const season = match ? SEASONS[match[2].toLowerCase()] : undefined;
  return match && season ? `${match[1]} ${season}` : term;
}

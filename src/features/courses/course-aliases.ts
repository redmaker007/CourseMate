/**
 * 课号的常用缩写与全称。
 *
 * 学生习惯说「CS 540」「stats 250」，但各校课号的学科部分不一样：计算机在
 * UW–Madison 是 COMP SCI，在密歇根是 EECS，在密歇根州立是 CSE。这里把常见说法
 * 映射到各校真实的学科代码，搜索时一并查。
 *
 * 学科代码按 2026-11-21 生产库 course_catalog 里实际存在的值核对过；新增学校或
 * 学校改代码时同步改这里。没有列出的学校只按原文搜索，不受影响。
 */

type SubjectAlias = {
  /** 学生可能输入的叫法，比较时忽略大小写、空格和标点。 */
  names: string[];
  /** 学校 id → 该校对应的学科代码（课号里数字前面的部分）。 */
  subjects: Record<string, string[]>;
};

const SUBJECT_ALIASES: SubjectAlias[] = [
  {
    names: ["cs", "compsci", "comp sci", "computer science", "cse", "eecs"],
    subjects: { "uw-madison": ["COMP SCI"], umich: ["EECS"], msu: ["CSE"] },
  },
  {
    names: ["ece", "ee", "electrical engineering", "electrical and computer engineering"],
    subjects: { "uw-madison": ["ECE"], umich: ["EECS", "ECE"], msu: ["ECE"] },
  },
  {
    names: ["math", "maths", "mth", "mathematics"],
    subjects: { "uw-madison": ["MATH"], umich: ["MATH"], msu: ["MTH"] },
  },
  {
    names: ["stat", "stats", "stt", "statistics"],
    subjects: { "uw-madison": ["STAT"], umich: ["STATS"], msu: ["STT"] },
  },
  {
    names: ["econ", "ec", "economics"],
    subjects: { "uw-madison": ["ECON"], umich: ["ECON"], msu: ["EC"] },
  },
  {
    names: ["psych", "psy", "psychology"],
    subjects: { "uw-madison": ["PSYCH"], umich: ["PSYCH"], msu: ["PSY"] },
  },
  {
    names: ["chem", "cem", "chemistry"],
    subjects: { "uw-madison": ["CHEM"], umich: ["CHEM"], msu: ["CEM"] },
  },
  {
    names: ["phys", "phy", "physics"],
    subjects: { "uw-madison": ["PHYSICS"], umich: ["PHYSICS"], msu: ["PHY"] },
  },
  {
    names: ["bio", "biol", "biology"],
    subjects: { "uw-madison": ["BIOLOGY"], umich: ["BIOLOGY"], msu: ["IBIO", "BS"] },
  },
  {
    names: ["me", "mech", "mecheng", "mechanical engineering"],
    subjects: { "uw-madison": ["ME"], umich: ["MECHENG"], msu: ["ME"] },
  },
  {
    names: ["bme", "biomedical engineering"],
    subjects: { "uw-madison": ["BME"], umich: ["BIOMEDE"], msu: ["BME"] },
  },
  {
    names: ["cee", "ce", "civil", "civil engineering"],
    subjects: { "uw-madison": ["CIV ENGR"], umich: ["CEE"], msu: ["CE"] },
  },
  {
    names: ["ie", "ioe", "isye", "industrial engineering"],
    subjects: { "uw-madison": ["ISYE"], umich: ["IOE"] },
  },
  {
    names: ["acct", "acc", "accounting"],
    subjects: { "uw-madison": ["ACCT I S"], umich: ["ACC"], msu: ["ACC"] },
  },
  {
    names: ["fin", "fi", "finance"],
    subjects: { "uw-madison": ["FINANCE"], umich: ["FIN"], msu: ["FI"] },
  },
  {
    names: ["engl", "english"],
    subjects: { "uw-madison": ["ENGL"], umich: ["ENGLISH"], msu: ["ENG"] },
  },
  {
    names: ["hist", "hst", "history"],
    subjects: { "uw-madison": ["HISTORY"], umich: ["HISTORY"], msu: ["HST"] },
  },
  {
    names: ["polisci", "poli sci", "pols", "pls", "political science"],
    subjects: { "uw-madison": ["POLI SCI"], umich: ["POLSCI"], msu: ["PLS"] },
  },
  {
    names: ["phil", "phl", "philos", "philosophy"],
    subjects: { "uw-madison": ["PHILOS"], umich: ["PHIL"], msu: ["PHL"] },
  },
  {
    names: ["ling", "lin", "linguis", "linguistics"],
    subjects: { "uw-madison": ["LINGUIS"], umich: ["LING"], msu: ["LIN"] },
  },
  {
    names: ["soc", "sociology"],
    subjects: { "uw-madison": ["SOC"], umich: ["SOC"], msu: ["SOC"] },
  },
];

/** 与数据库 code_normalized 生成列相同的规则：只留字母数字并转大写。 */
export function normalizeCode(value: string) {
  return value.toLocaleUpperCase().replace(/[^A-Z0-9]/g, "");
}

const aliasKey = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const ALIAS_INDEX = new Map<string, SubjectAlias[]>();
for (const alias of SUBJECT_ALIASES) {
  for (const name of alias.names) {
    const key = aliasKey(name);
    ALIAS_INDEX.set(key, [...(ALIAS_INDEX.get(key) ?? []), alias]);
  }
}

/**
 * 把查询里的学科部分换成该校真实学科代码，返回规范化后的课号前缀。
 *
 * 'cs 540' → ['COMPSCI540']（UW–Madison）；'stats' → ['STATS']（密歇根）。
 * 查询不是「学科 + 可选课号数字」的形式、或学科不在表里时返回空数组。
 */
export function expandSubjectAliases(schoolId: string, query: string): string[] {
  const match = query.trim().match(/^(.*?)\s*(\d[0-9a-z]*)?$/i);
  if (!match) return [];
  const subjectKey = aliasKey(match[1]);
  if (!subjectKey) return [];
  const number = match[2] ?? "";

  const prefixes = new Set<string>();
  for (const alias of ALIAS_INDEX.get(subjectKey) ?? []) {
    for (const subject of alias.subjects[schoolId] ?? []) {
      prefixes.add(normalizeCode(subject + number));
    }
  }
  // 原文本身已经是课号前缀时，不必重复。
  prefixes.delete(normalizeCode(query));
  return [...prefixes];
}

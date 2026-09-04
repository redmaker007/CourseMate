/**
 * Supabase 数据库类型。
 *
 * 这个文件是**生成的**，不要手写。schema 定下来之后跑：
 *
 *   npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/database.ts
 *
 * 在此之前先用一个空壳占位，让 createClient<Database>() 能通过类型检查。
 */
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

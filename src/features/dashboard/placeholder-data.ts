/**
 * 大厅的占位数据。
 *
 * 课程、群组、消息这些表目前还没进数据库（见 docs/handoffs/
 * environment-and-deployment.md 第六节的 schema 冲突），所以这里先用写死的
 * 假数据把界面结构立起来，方便调样式和接后端。
 *
 * 接入真实数据时：删掉这个文件，改由 Server Component 查询后经 props 传给
 * 同一批组件，组件本身不用改。
 */

export type PlaceholderCourse = {
  id: string;
  code: string;
  title: string;
  term: string;
  memberCount: number;
  unreadCount: number;
};

export const PLACEHOLDER_COURSES: PlaceholderCourse[] = [
  {
    id: "placeholder-1",
    code: "EECS 280",
    title: "Programming and Introductory Data Structures",
    term: "2026 秋",
    memberCount: 128,
    unreadCount: 12,
  },
  {
    id: "placeholder-2",
    code: "STATS 250",
    title: "Introduction to Statistics and Data Analysis",
    term: "2026 秋",
    memberCount: 245,
    unreadCount: 0,
  },
  {
    id: "placeholder-3",
    code: "CHEM 130",
    title: "General Chemistry",
    term: "2026 秋",
    memberCount: 89,
    unreadCount: 3,
  },
];

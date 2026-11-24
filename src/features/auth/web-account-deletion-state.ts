/** 网页注销表单状态；单独成文件，避免客户端组件引入只能在服务端运行的注销逻辑。 */
export type WebDeletionState = {
  status: string;
  message: string;
  challengeToken?: string;
  receiptToken?: string;
};

export const initialWebDeletionState: WebDeletionState = { status: "idle", message: "" };

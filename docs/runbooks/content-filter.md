# 维护内容过滤词表

内容过滤采用“发送时拦截 + 数据库词表”（2026-11-22 用户确认，迁移 `202611220002_content_filter.sql`）。命中词表的课程群消息、私聊消息、好友申请附言、显示名和专业，会被数据库直接拒绝，不会保存。网页提示“内容包含不允许的词语，请修改后再发送”；App 收到对应错误码（见下文）。

**迁移本身不带任何词。** 上线前必须由词表负责人按本手册填好，否则过滤不起作用。

## 谁能改

只有能连生产库的数据库负责人（SQL Editor 或 `supabase db query --remote`）。学生端完全读不到也改不了 `content_filter_terms`，也不能直接调用判定函数。不要把词表提交到仓库：仓库是公开的，词表一旦公开，就等于告诉别人怎么绕过。

每次修改要在团队频道记一笔：谁、何时、加了或删了几个词、原因。不要贴出词本身。

## 两种匹配方式

| match_mode | 用于 | 怎么匹配 |
|---|---|---|
| `substring` | 中文 | 先把全角字符转成半角、转小写、去掉零宽字符，再去掉空白和标点，然后找连续子串。“垃 圾-话”也能命中“垃圾话”。中文词要选得准：命中的是子串，所以太短或太常见的词会误伤 |
| `word` | 英文 | 同样规范化后，把非字母数字的字符都换成空格，按整词或整词组匹配。`badword` 不会误伤 `badwordsmith`；词组如 `go away now` 要求这几个词连续出现 |

## 加词

存储形式必须是规范化后的形式（有约束检查），所以一律通过 `content_filter_term_key` 插入：

```sql
insert into public.content_filter_terms (term, match_mode, note)
values
  (public.content_filter_term_key('示例词', 'substring'), 'substring', '辱骂'),
  (public.content_filter_term_key('Example Phrase', 'word'), 'word', 'threat')
on conflict (match_mode, term) do nothing;
```

`note` 只写类别，最多 200 字，不写举报人或案例细节。

## 查看与删词

```sql
select id, match_mode, term, note, created_at from public.content_filter_terms order by created_at desc;
delete from public.content_filter_terms where id = <id>;
```

改动立即生效，不用重新部署。

## 上线后自查

加词后，用测试账号在测试学校发一条包含该词的消息，应该被拒绝；再发一条普通消息，应该能正常发出。不要在真实课程群里测。

## 误伤处理

用户反映正常内容被拦截时（联系渠道公布后通过邮箱）：

1. 确认是哪个词导致的：在 SQL Editor 里以负责人身份执行 `select public.contains_blocked_content('<用户原文>');`，再逐个排查。原文用完即弃，不要存进工单或聊天记录。
2. 中文词太短就换成更长、更具体的词；英文词改用 `word` 模式。
3. 词表变化之前已经存在的旧显示名不会被追溯拦截：只有修改显示名或专业时才检查，改毕业年份不受影响。

## 各端看到的错误

| 入口 | 结果 |
|---|---|
| 网页课程群聊／私聊 | 提示“内容包含不允许的词语，请修改后再发送”，草稿保留 |
| 网页好友申请、资料 | 对应字段下显示同一句提示 |
| App `POST /api/mobile/v1/conversations/{id}/messages` | HTTP 422，`{"status":"content_rejected"}` |
| App 好友申请 | HTTP 400，`status: invalid`，`fieldErrors.message` 为提示文字 |
| App 资料保存 | HTTP 400，`status: invalid`，`fieldErrors.displayName` 或 `fieldErrors.major` |
| 直接调用 RPC／写表 | PostgreSQL 错误 `CM001`，message `content_rejected`，detail 为字段名 |

被拦截的原文不会写入数据库或日志，只回滚这次写入。

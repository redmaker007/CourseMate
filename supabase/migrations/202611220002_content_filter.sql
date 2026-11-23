-- 内容过滤（方案 A：发送时拦截，词表放数据库；2026-11-22 用户确认）。
-- 学生可以绕过网页／App 直接调用 RPC 或写表，所以检查放在触发器里，覆盖所有写入路径：
--   messages（课程群与私聊，INSERT）、friend_requests.message（INSERT）、
--   profiles.display_name／major（INSERT 或修改这两列时）。
-- 命中时抛出 SQLSTATE CM001、message = content_rejected、detail = 字段名；整条写入回滚。
-- 词表 content_filter_terms 对 anon／authenticated 完全关闭，只有数据库负责人／service_role 维护，
-- 操作见 docs/runbooks/content-filter.md。迁移本身不带任何词，上线前由负责人填写。
-- 不记录被拦截的原文。
begin;

-- 规范化：全角 ASCII 与全角空格转半角、转小写、去掉零宽字符。
create or replace function public.content_filter_normalize(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.lower(pg_catalog.translate(coalesce(input, ''), '！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝～　', '!"#$%&''()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~ ')),
    '[​-‍⁠﻿­]', '', 'g'
  );
$$;

-- 子串模式的比较形式：再去掉空白和标点，防止“插空格／加符号”绕过。中文词用这一模式。
create or replace function public.content_filter_compact(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    public.content_filter_normalize(input),
    '[[:space:][:punct:]，。！？、；：“”‘’（）《》【】「」『』…·—～￥]', '', 'g'
  );
$$;

-- 整词模式的比较形式：非字母数字都变成单个空格。英文词用这一模式，避免误伤包含该字母序列的正常单词。
create or replace function public.content_filter_words(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(public.content_filter_normalize(input), '[^a-z0-9]+', ' ', 'g'));
$$;

-- 把负责人输入的原始词转成存储形式；runbook 里插入词时调用它。
create or replace function public.content_filter_term_key(raw_term text, mode text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case mode
    when 'substring' then public.content_filter_compact(raw_term)
    when 'word' then public.content_filter_words(raw_term)
  end;
$$;

create table public.content_filter_terms (
  id bigint generated always as identity primary key,
  term text not null,
  match_mode text not null check (match_mode in ('word', 'substring')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (match_mode, term),
  constraint content_filter_terms_normalized check (
    term <> '' and term = public.content_filter_term_key(term, match_mode)
  )
);

alter table public.content_filter_terms enable row level security;
revoke all on public.content_filter_terms from public, anon, authenticated;

create or replace function public.contains_blocked_content(input text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  compact text;
  words text;
begin
  if input is null or input = '' then
    return false;
  end if;
  compact := public.content_filter_compact(input);
  words := ' ' || public.content_filter_words(input) || ' ';
  return exists (
    select 1 from public.content_filter_terms filter_term
    where (filter_term.match_mode = 'substring' and pg_catalog.strpos(compact, filter_term.term) > 0)
       or (filter_term.match_mode = 'word' and pg_catalog.strpos(words, ' ' || filter_term.term || ' ') > 0)
  );
end;
$$;

create or replace function public.enforce_content_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'messages' then
    -- 系统写入（无发送者）和接受好友申请时复制的附言（发申请时已检查）不再拦截。
    if new.sender_id is not null and new.source_friend_request_id is null
       and public.contains_blocked_content(new.body) then
      raise exception using errcode = 'CM001', message = 'content_rejected', detail = 'body';
    end if;
  elsif tg_table_name = 'friend_requests' then
    if public.contains_blocked_content(new.message) then
      raise exception using errcode = 'CM001', message = 'content_rejected', detail = 'message';
    end if;
  elsif tg_table_name = 'profiles' then
    if (tg_op = 'INSERT' or new.display_name is distinct from old.display_name)
       and public.contains_blocked_content(new.display_name) then
      raise exception using errcode = 'CM001', message = 'content_rejected', detail = 'display_name';
    end if;
    if (tg_op = 'INSERT' or new.major is distinct from old.major)
       and public.contains_blocked_content(new.major) then
      raise exception using errcode = 'CM001', message = 'content_rejected', detail = 'major';
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_content_filter
  before insert on public.messages
  for each row execute function public.enforce_content_filter();

create trigger friend_requests_content_filter
  before insert on public.friend_requests
  for each row execute function public.enforce_content_filter();

create trigger profiles_content_filter
  before insert or update of display_name, major on public.profiles
  for each row execute function public.enforce_content_filter();

-- 判定函数和触发器函数都不对外开放：普通成员不能直接拿它试探词表。
-- 规范化辅助函数只在过滤内部和负责人维护词表时使用，也不开放给 anon／authenticated。
revoke all on function public.content_filter_normalize(text) from public, anon, authenticated;
revoke all on function public.content_filter_compact(text) from public, anon, authenticated;
revoke all on function public.content_filter_words(text) from public, anon, authenticated;
revoke all on function public.content_filter_term_key(text, text) from public, anon, authenticated;
revoke all on function public.contains_blocked_content(text) from public, anon, authenticated;
revoke all on function public.enforce_content_filter() from public, anon, authenticated;

commit;

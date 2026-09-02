-- Marginalia 雲端帳號資料表 + Row Level Security。
--
-- 整份貼到 Supabase 專案後台的 SQL Editor 執行一次即可（Dashboard → SQL Editor →
-- New query → 貼上 → Run）。10 張表（books/categories 之外的 8 張）欄位對照
-- 現有 IndexedDB 記錄的欄位，id 用自動遞增整數（不是 UUID），這樣 bookId／
-- groupId／fromNodeId／toNodeId 這些現有程式碼裡到處比較數字的外鍵邏輯
-- （見 js/cloudDb.js、js/cloudMigration.js）完全不用改寫。
--
-- 每張表都是同一套四條 RLS policy：使用者只能看到、新增、修改、刪除
-- user_id 等於自己的列。這是這個公開多使用者產品唯一的資料隔離防線，
-- 務必整份執行、不要漏掉任何一張表的 policy。

-- ============ books ============
create table books (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  author text,
  publisher text,
  category text,
  format text,
  "retentionStatus" text,
  "libraryBorrowType" text,
  "libraryName" text,
  "lentTo" text,
  "publishDate" text,
  "purchaseDate" text,
  "purchasePrice" numeric,
  "coverImage" text,
  tags jsonb default '[]'::jsonb,
  "createdAt" timestamptz default now()
);

alter table books enable row level security;
create policy "books_select_own" on books for select using (auth.uid() = user_id);
create policy "books_insert_own" on books for insert with check (auth.uid() = user_id);
create policy "books_update_own" on books for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "books_delete_own" on books for delete using (auth.uid() = user_id);
create index books_user_id_idx on books (user_id);

-- ============ categories（自訂分類，對照 js/categories.js） ============
create table categories (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  "group" text,
  "createdAt" timestamptz default now()
);

alter table categories enable row level security;
create policy "categories_select_own" on categories for select using (auth.uid() = user_id);
create policy "categories_insert_own" on categories for insert with check (auth.uid() = user_id);
create policy "categories_update_own" on categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "categories_delete_own" on categories for delete using (auth.uid() = user_id);
create index categories_user_id_idx on categories (user_id);

-- ============ reading_records ============
create table reading_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  status text,
  "startDate" text,
  "endDate" text,
  "currentPage" integer,
  "readCount" integer default 0,
  rating integer default 0,
  "updatedAt" timestamptz,
  "createdAt" timestamptz default now()
);

alter table reading_records enable row level security;
create policy "reading_records_select_own" on reading_records for select using (auth.uid() = user_id);
create policy "reading_records_insert_own" on reading_records for insert with check (auth.uid() = user_id);
create policy "reading_records_update_own" on reading_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reading_records_delete_own" on reading_records for delete using (auth.uid() = user_id);
create index reading_records_user_id_idx on reading_records (user_id);
create index reading_records_book_id_idx on reading_records ("bookId");

-- ============ outputs（閱讀動機／閱讀後輸出心得） ============
create table outputs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  kind text,
  tags jsonb default '[]'::jsonb,
  text text,
  format text,
  date text,
  "createdAt" timestamptz default now()
);

alter table outputs enable row level security;
create policy "outputs_select_own" on outputs for select using (auth.uid() = user_id);
create policy "outputs_insert_own" on outputs for insert with check (auth.uid() = user_id);
create policy "outputs_update_own" on outputs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "outputs_delete_own" on outputs for delete using (auth.uid() = user_id);
create index outputs_user_id_idx on outputs (user_id);
create index outputs_book_id_idx on outputs ("bookId");

-- ============ notes（快速筆記） ============
create table notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  text text,
  "createdAt" timestamptz default now()
);

alter table notes enable row level security;
create policy "notes_select_own" on notes for select using (auth.uid() = user_id);
create policy "notes_insert_own" on notes for insert with check (auth.uid() = user_id);
create policy "notes_update_own" on notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notes_delete_own" on notes for delete using (auth.uid() = user_id);
create index notes_user_id_idx on notes (user_id);
create index notes_book_id_idx on notes ("bookId");

-- ============ groups（人物關係圖譜的群組卡片） ============
create table groups (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  name text,
  subtitle text,
  color text,
  x numeric,
  y numeric,
  "createdAt" timestamptz default now()
);

alter table groups enable row level security;
create policy "groups_select_own" on groups for select using (auth.uid() = user_id);
create policy "groups_insert_own" on groups for insert with check (auth.uid() = user_id);
create policy "groups_update_own" on groups for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "groups_delete_own" on groups for delete using (auth.uid() = user_id);
create index groups_user_id_idx on groups (user_id);
create index groups_book_id_idx on groups ("bookId");

-- ============ nodes（人物關係圖譜的人物卡片） ============
create table nodes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  "groupId" bigint references groups(id) on delete set null,
  label text,
  title text,
  status text,
  description text,
  "order" integer,
  "createdAt" timestamptz default now()
);

alter table nodes enable row level security;
create policy "nodes_select_own" on nodes for select using (auth.uid() = user_id);
create policy "nodes_insert_own" on nodes for insert with check (auth.uid() = user_id);
create policy "nodes_update_own" on nodes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "nodes_delete_own" on nodes for delete using (auth.uid() = user_id);
create index nodes_user_id_idx on nodes (user_id);
create index nodes_book_id_idx on nodes ("bookId");

-- ============ edges（人物關係圖譜的關係線） ============
create table edges (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  "fromNodeId" bigint references nodes(id) on delete cascade,
  "toNodeId" bigint references nodes(id) on delete cascade,
  label text,
  direction text,
  color text,
  "lineStyle" text,
  "createdAt" timestamptz default now()
);

alter table edges enable row level security;
create policy "edges_select_own" on edges for select using (auth.uid() = user_id);
create policy "edges_insert_own" on edges for insert with check (auth.uid() = user_id);
create policy "edges_update_own" on edges for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "edges_delete_own" on edges for delete using (auth.uid() = user_id);
create index edges_user_id_idx on edges (user_id);
create index edges_book_id_idx on edges ("bookId");

-- ============ favorite_authors（喜愛的作者，以名字比對，不綁定單一 bookId） ============
create table favorite_authors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  "createdAt" timestamptz default now()
);

alter table favorite_authors enable row level security;
create policy "favorite_authors_select_own" on favorite_authors for select using (auth.uid() = user_id);
create policy "favorite_authors_insert_own" on favorite_authors for insert with check (auth.uid() = user_id);
create policy "favorite_authors_update_own" on favorite_authors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "favorite_authors_delete_own" on favorite_authors for delete using (auth.uid() = user_id);
create index favorite_authors_user_id_idx on favorite_authors (user_id);

-- ============ quotes（佳句摘錄） ============
create table quotes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  "bookId" bigint references books(id) on delete cascade,
  content text,
  page text,
  "createdAt" timestamptz default now()
);

alter table quotes enable row level security;
create policy "quotes_select_own" on quotes for select using (auth.uid() = user_id);
create policy "quotes_insert_own" on quotes for insert with check (auth.uid() = user_id);
create policy "quotes_update_own" on quotes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quotes_delete_own" on quotes for delete using (auth.uid() = user_id);
create index quotes_user_id_idx on quotes (user_id);
create index quotes_book_id_idx on quotes ("bookId");

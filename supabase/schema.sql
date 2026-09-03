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
--
-- RLS policy 只負責「篩選哪些『列』看得到」，不是資料庫權限的全部——PostgreSQL
-- 角色本身還要先有權限「碰得到」這個 schema／這些表（GRANT），兩層都要有才行。
-- Supabase 用 Table Editor 建表會自動幫你補這層 GRANT，但直接在 SQL Editor 貼
-- create table 不會，沒補的話即使 RLS policy 全部設對，查詢還是會收到
-- 「permission denied for schema public」，不是 RLS 擋下來，是連權限檢查那關都過不了。
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
-- 以後在這個 schema 新增的表也要自動套用同一組權限，不用每加一張表就補跑一次上面兩行。
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;

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

-- ============ wishlist（願望與推薦清單，對照 js/wishlist.js） ============
-- 跟 books 完全獨立、沒有外鍵——「轉為藏書」是把書名/備註複製一份到 books
-- 表新增一筆記錄，不是把這筆 wishlist 資料「搬過去」，兩張表天生不互相參照。
create table wishlist (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  note text,
  "createdAt" timestamptz default now()
);

alter table wishlist enable row level security;
create policy "wishlist_select_own" on wishlist for select using (auth.uid() = user_id);
create policy "wishlist_insert_own" on wishlist for insert with check (auth.uid() = user_id);
create policy "wishlist_update_own" on wishlist for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "wishlist_delete_own" on wishlist for delete using (auth.uid() = user_id);
create index wishlist_user_id_idx on wishlist (user_id);
-- 這張表是在最早那批表格都建立、GRANT 都跑過之後才新增的——檔案最上面那組
-- `alter default privileges` 理論上會讓同一個角色之後新建的表自動套用同一組權限，
-- 但這裡还是明講一次 GRANT，不依賴「理論上」：只跑這個區塊也不會漏掉存取權限。
grant select, insert, update, delete on wishlist to anon, authenticated;
grant usage, select on sequence wishlist_id_seq to anon, authenticated;

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

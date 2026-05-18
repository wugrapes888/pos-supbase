-- ============================================================
-- 食農團購 POS v2 — Supabase Schema
-- ============================================================

-- 啟用 UUID extension
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────
-- 收銀員（員工）
-- ────────────────────────────────────────────────────────────
create table cashiers (
  id        text primary key,          -- 員工 PIN（登入用）
  name      text not null,
  role      text not null default 'staff' check (role in ('boss', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into cashiers (id, name, role) values
  ('316', '老闆', 'boss');

-- ────────────────────────────────────────────────────────────
-- 客戶
-- ────────────────────────────────────────────────────────────
create table customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  line_user_id text unique,             -- LINE LIFF userId
  note         text,
  created_at   timestamptz not null default now()
);

create index customers_name_idx on customers (name);
create index customers_line_user_id_idx on customers (line_user_id);

-- ────────────────────────────────────────────────────────────
-- 商品
-- ────────────────────────────────────────────────────────────
create table products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  price      numeric(10,0) not null default 0,
  category   text not null default '其他',
  barcode    text,
  stock_mode text not null default 'reset' check (stock_mode in ('reset', 'carry')),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 每日庫存（開攤設定）
-- ────────────────────────────────────────────────────────────
create table daily_stocks (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products (id) on delete cascade,
  stock_date  date not null default current_date,
  open_stock  integer not null default 0,
  created_by  text references cashiers (id),
  created_at  timestamptz not null default now(),
  unique (product_id, stock_date)
);

-- ────────────────────────────────────────────────────────────
-- 進貨成本批次
-- ────────────────────────────────────────────────────────────
create table purchase_batches (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid references products (id) on delete set null,
  product_name  text not null,             -- denormalized
  purchase_date date not null,
  qty           integer not null,
  unit          text not null default '個',
  unit_cost     numeric(10,2) not null,
  total_cost    numeric(12,2) generated always as (qty * unit_cost) stored,
  remaining_qty integer not null,
  selling_price numeric(10,0),
  note          text,
  created_at    timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 團購期別
-- ────────────────────────────────────────────────────────────
create table group_buy_sessions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  start_date date,
  end_date   date,
  status     text not null default 'open' check (status in ('open', 'closed', 'delivered')),
  note       text,
  created_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 訂單（預購 + 現場）
-- ────────────────────────────────────────────────────────────
create table orders (
  id                    uuid primary key default gen_random_uuid(),
  order_type            text not null check (order_type in ('preorder', 'walkin')),
  customer_id           uuid references customers (id) on delete set null,
  customer_name         text not null,          -- denormalized
  session_id            uuid references group_buy_sessions (id) on delete set null,
  status                text not null default 'pending'
                          check (status in ('pending', 'paid', 'delivered', 'cancelled')),
  payment_screenshot_url text,                  -- Supabase Storage URL
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index orders_customer_id_idx on orders (customer_id);
create index orders_session_id_idx on orders (session_id);
create index orders_status_idx on orders (status);

-- ────────────────────────────────────────────────────────────
-- 訂單明細
-- ────────────────────────────────────────────────────────────
create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders (id) on delete cascade,
  product_id   uuid references products (id) on delete set null,
  product_name text not null,        -- denormalized
  qty          integer not null check (qty > 0),
  unit_price   numeric(10,0) not null,
  subtotal     numeric(12,0) generated always as (qty * unit_price) stored,
  arrived      boolean not null default false,   -- 貨到了嗎
  created_at   timestamptz not null default now()
);

create index order_items_order_id_idx on order_items (order_id);

-- ────────────────────────────────────────────────────────────
-- POS 結帳紀錄
-- ────────────────────────────────────────────────────────────
create table pos_transactions (
  id              uuid primary key default gen_random_uuid(),
  cashier_id      text references cashiers (id),
  customer_id     uuid references customers (id) on delete set null,
  customer_name   text not null,
  customer_type   text not null check (customer_type in ('preorder', 'walkin')),
  payment_method  text not null check (payment_method in ('cash', 'transfer', 'linepay')),
  total_amount    numeric(12,0) not null,
  note            text,
  created_at      timestamptz not null default now()
);

create index pos_transactions_cashier_id_idx on pos_transactions (cashier_id);
create index pos_transactions_created_at_idx on pos_transactions (created_at);

-- ────────────────────────────────────────────────────────────
-- POS 結帳明細（含核銷預購）
-- ────────────────────────────────────────────────────────────
create table pos_transaction_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references pos_transactions (id) on delete cascade,
  product_id      uuid references products (id) on delete set null,
  product_name    text not null,     -- denormalized
  qty             integer not null check (qty > 0),
  unit_price      numeric(10,0) not null,
  subtotal        numeric(12,0) generated always as (qty * unit_price) stored,
  order_item_id   uuid references order_items (id) on delete set null,  -- 核銷預購
  created_at      timestamptz not null default now()
);

create index pos_transaction_items_transaction_id_idx on pos_transaction_items (transaction_id);
create index pos_transaction_items_order_item_id_idx on pos_transaction_items (order_item_id);

-- ────────────────────────────────────────────────────────────
-- 發貨批次
-- ────────────────────────────────────────────────────────────
create table delivery_batches (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references group_buy_sessions (id) on delete set null,
  delivered_at timestamptz not null default now(),
  note         text,
  created_by   text references cashiers (id),
  created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 發貨明細
-- ────────────────────────────────────────────────────────────
create table delivery_items (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references delivery_batches (id) on delete cascade,
  order_item_id  uuid not null references order_items (id) on delete cascade,
  qty_delivered  integer not null check (qty_delivered > 0),
  created_at     timestamptz not null default now()
);

create index delivery_items_batch_id_idx on delivery_items (batch_id);
create index delivery_items_order_item_id_idx on delivery_items (order_item_id);

-- ────────────────────────────────────────────────────────────
-- Supabase Storage bucket（在 Dashboard 建立）
-- ────────────────────────────────────────────────────────────
-- bucket name: payment-screenshots
-- Public: false（需透過 signed URL 存取）

-- ────────────────────────────────────────────────────────────
-- Row Level Security（RLS）
-- 目前採用 anon key 存取，以 RLS 允許全部操作。
-- 正式上線前請依需求收緊權限。
-- ────────────────────────────────────────────────────────────
alter table cashiers             enable row level security;
alter table customers            enable row level security;
alter table products             enable row level security;
alter table daily_stocks         enable row level security;
alter table purchase_batches     enable row level security;
alter table group_buy_sessions   enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table pos_transactions     enable row level security;
alter table pos_transaction_items enable row level security;
alter table delivery_batches     enable row level security;
alter table delivery_items       enable row level security;

-- 暫時開放全部（anon）—— 上線後請改為更嚴格的策略
create policy "allow_all" on cashiers              for all using (true) with check (true);
create policy "allow_all" on customers             for all using (true) with check (true);
create policy "allow_all" on products              for all using (true) with check (true);
create policy "allow_all" on daily_stocks          for all using (true) with check (true);
create policy "allow_all" on purchase_batches      for all using (true) with check (true);
create policy "allow_all" on group_buy_sessions    for all using (true) with check (true);
create policy "allow_all" on orders                for all using (true) with check (true);
create policy "allow_all" on order_items           for all using (true) with check (true);
create policy "allow_all" on pos_transactions      for all using (true) with check (true);
create policy "allow_all" on pos_transaction_items for all using (true) with check (true);
create policy "allow_all" on delivery_batches      for all using (true) with check (true);
create policy "allow_all" on delivery_items        for all using (true) with check (true);

-- ────────────────────────────────────────────────────────────
-- 便利 View：客戶預購總覽（POS 取貨清單用）
-- ────────────────────────────────────────────────────────────
create or replace view customer_preorder_summary as
select
  c.id           as customer_id,
  c.name         as customer_name,
  c.phone,
  o.id           as order_id,
  o.status       as order_status,
  sum(oi.qty)    as total_qty,
  sum(oi.subtotal) as total_amount,
  count(oi.id)   as item_count,
  bool_and(oi.arrived) as all_arrived
from customers c
join orders o on o.customer_id = c.id and o.order_type = 'preorder'
join order_items oi on oi.order_id = o.id
where o.status = 'pending'
group by c.id, c.name, c.phone, o.id, o.status;

-- ────────────────────────────────────────────────────────────
-- 便利 View：今日銷售摘要
-- ────────────────────────────────────────────────────────────
create or replace view today_sales_summary as
select
  payment_method,
  customer_type,
  count(*)           as tx_count,
  sum(total_amount)  as revenue
from pos_transactions
where created_at::date = current_date
group by payment_method, customer_type;

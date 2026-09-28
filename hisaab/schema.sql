-- =====================================================================
-- Hisaab: household finance tracker for Aum & Saumya
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- BEFORE RUNNING: replace the two email addresses in section 7.
-- =====================================================================

-- 1. Household members (only these emails can see or change any data)
create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  name       text not null,
  color      text not null default '#2F4DA8',
  position   int  not null default 1,
  created_at timestamptz not null default now()
);

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2. Categories (expense + income), with optional monthly budget
create table if not exists public.categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null check (kind in ('expense','income')),
  emoji          text not null default '•',
  color          text not null default '#8C8C8C',
  monthly_budget numeric(12,2),
  is_tithing     boolean not null default false,
  sort           int not null default 100,
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);

-- 3. Every entry: expense, income, or a settlement between the two of you
--    member_id   = who paid (expense), who earned (income), who paid back (settlement)
--    payer_share = % of an expense that belongs to the payer
--                  100 = payer's own, 50 = split equally, 0 = paid for the partner
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('expense','income','settlement')),
  amount         numeric(12,2) not null check (amount > 0),
  txn_date       date not null default current_date,
  category_id    uuid references public.categories(id) on delete set null,
  member_id      uuid not null references public.members(id),
  payer_share    numeric(5,2) not null default 100 check (payer_share between 0 and 100),
  to_member_id   uuid references public.members(id),
  payment_method text,
  note           text,
  recurring_id   uuid,
  recur_month    text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions (txn_date desc);
-- stops the same monthly bill being logged twice (e.g. both of you tap "Log")
create unique index if not exists transactions_recurring_once
  on public.transactions (recurring_id, recur_month) where recurring_id is not null;

-- 4. Recurring bills and income (rent, SIPs, subscriptions, salary)
create table if not exists public.recurring (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null default 'expense' check (kind in ('expense','income')),
  amount         numeric(12,2) not null check (amount > 0),
  category_id    uuid references public.categories(id) on delete set null,
  member_id      uuid not null references public.members(id),
  payer_share    numeric(5,2) not null default 100,
  payment_method text,
  day_of_month   int not null default 1 check (day_of_month between 1 and 31),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- 5. Savings goals (member_id null = household goal) and money put towards them
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  emoji       text not null default '🎯',
  target      numeric(12,2) not null check (target > 0),
  target_date date,
  member_id   uuid references public.members(id),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.goal_contributions (
  id            uuid primary key default gen_random_uuid(),
  goal_id       uuid not null references public.goals(id) on delete cascade,
  member_id     uuid not null references public.members(id),
  amount        numeric(12,2) not null,  -- negative = withdrawal
  contrib_date  date not null default current_date,
  note          text,
  created_at    timestamptz not null default now()
);

-- 6. Household settings (e.g. tithing target %)
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row level security: only household members can read or write anything
-- ---------------------------------------------------------------------
alter table public.members            enable row level security;
alter table public.categories         enable row level security;
alter table public.transactions       enable row level security;
alter table public.recurring          enable row level security;
alter table public.goals              enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.settings           enable row level security;

drop policy if exists "members read" on public.members;
create policy "members read" on public.members for select using (public.is_member());

do $$
declare t text;
begin
  foreach t in array array['categories','transactions','recurring','goals','goal_contributions','settings'] loop
    execute format('drop policy if exists "household access" on public.%I', t);
    execute format('create policy "household access" on public.%I for all using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- Live sync between your two phones
do $$
begin
  begin alter publication supabase_realtime add table public.transactions;       exception when others then null; end;
  begin alter publication supabase_realtime add table public.recurring;          exception when others then null; end;
  begin alter publication supabase_realtime add table public.goals;              exception when others then null; end;
  begin alter publication supabase_realtime add table public.goal_contributions; exception when others then null; end;
  begin alter publication supabase_realtime add table public.categories;         exception when others then null; end;
  begin alter publication supabase_realtime add table public.settings;           exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 7. Seed data. >>> REPLACE THE TWO EMAILS BELOW <<<
--    Use the exact emails you'll sign in with (your Google account emails).
-- ---------------------------------------------------------------------
insert into public.members (email, name, color, position) values
  ('aum@example.com',    'Aum',    '#2F4DA8', 1),
  ('saumya@example.com', 'Saumya', '#7A4BB0', 2)
on conflict (email) do nothing;

insert into public.settings (key, value) values ('tithe_pct', '10'::jsonb)
on conflict (key) do nothing;

insert into public.categories (name, kind, emoji, color, sort, is_tithing)
select * from (values
  ('Groceries',            'expense', '🛒', '#2E8B57',  1, false),
  ('Rent & housing',       'expense', '🏠', '#6D5BA8',  2, false),
  ('Tithing',              'expense', '🪔', '#E3A018',  3, true),
  ('Bills & utilities',    'expense', '💡', '#C98B12',  4, false),
  ('Dining out',           'expense', '🍽️', '#C8553D',  5, false),
  ('Food delivery',        'expense', '🛵', '#E07A3F',  6, false),
  ('Transport & fuel',     'expense', '⛽', '#3A6EA5',  7, false),
  ('Shopping',             'expense', '🛍️', '#B84A8A',  8, false),
  ('Health & medical',     'expense', '💊', '#2A9D8F',  9, false),
  ('Fitness',              'expense', '🏋️', '#4C9A2A', 10, false),
  ('Personal care',        'expense', '💇', '#C27BA0', 11, false),
  ('Entertainment',        'expense', '🎬', '#8E5CC2', 12, false),
  ('Subscriptions',        'expense', '📺', '#5B6CB8', 13, false),
  ('Travel',               'expense', '✈️', '#1F8FB5', 14, false),
  ('Education & books',    'expense', '📚', '#7A6A3A', 15, false),
  ('Gifts',                'expense', '🎁', '#D9534F', 16, false),
  ('Family',               'expense', '👨‍👩‍👧', '#A0663A', 17, false),
  ('Household help',       'expense', '🧹', '#6E8B74', 18, false),
  ('Home & furnishing',    'expense', '🛋️', '#8A7968', 19, false),
  ('Insurance',            'expense', '🛡️', '#4F6D7A', 20, false),
  ('EMIs & loans',         'expense', '🏦', '#7D3C4A', 21, false),
  ('Investments & SIPs',   'expense', '📈', '#2F7F6F', 22, false),
  ('Miscellaneous',        'expense', '📦', '#8C8C8C', 23, false),
  ('Salary',               'income',  '💼', '#1E7A52',  1, false),
  ('Business income',      'income',  '🏢', '#2F6F9F',  2, false),
  ('Freelance & consulting','income', '🧾', '#6D5BA8',  3, false),
  ('Interest & dividends', 'income',  '💰', '#C98B12',  4, false),
  ('Refunds & cashback',   'income',  '↩️', '#2A9D8F',  5, false),
  ('Gifts received',       'income',  '🎁', '#C8553D',  6, false),
  ('Other income',         'income',  '➕', '#8C8C8C',  7, false)
) as v(name, kind, emoji, color, sort, is_tithing)
where not exists (select 1 from public.categories);

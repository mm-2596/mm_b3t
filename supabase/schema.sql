-- ============================================================
-- mm_b3t - Betting Tracker Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- SETTINGS TABLE
-- ============================================================
create table if not exists public.settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  bankroll numeric(10,2) default 1000.00 not null,
  unit_value numeric(10,2) default 10.00 not null,
  unit_percentage numeric(5,2) default 1.00 not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- ============================================================
-- TRANSACTIONS TABLE (deposits & withdrawals)
-- ============================================================
create table if not exists public.transactions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  date date not null default current_date,
  type text not null check (type in ('deposit', 'withdrawal')),
  amount numeric(10,2) not null check (amount > 0),
  bookmaker text,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- BETS TABLE
-- ============================================================
create table if not exists public.bets (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  date date not null default current_date,
  sport text not null,
  competition text not null,
  match text not null,
  pick text not null,
  bookmaker text not null,
  odds numeric(8,2) not null check (odds >= 1),
  units numeric(6,2) not null check (units > 0),
  stake numeric(10,2) not null check (stake > 0),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'void', 'cashout')),
  result_amount numeric(10,2) default null,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.settings enable row level security;
alter table public.transactions enable row level security;
alter table public.bets enable row level security;

-- Settings policies
create policy "Users can view own settings" on public.settings
  for select using (auth.uid() = user_id);
create policy "Users can insert own settings" on public.settings
  for insert with check (auth.uid() = user_id);
create policy "Users can update own settings" on public.settings
  for update using (auth.uid() = user_id);

-- Transactions policies
create policy "Users can view own transactions" on public.transactions
  for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "Users can update own transactions" on public.transactions
  for update using (auth.uid() = user_id);
create policy "Users can delete own transactions" on public.transactions
  for delete using (auth.uid() = user_id);

-- Bets policies
create policy "Users can view own bets" on public.bets
  for select using (auth.uid() = user_id);
create policy "Users can insert own bets" on public.bets
  for insert with check (auth.uid() = user_id);
create policy "Users can update own bets" on public.bets
  for update using (auth.uid() = user_id);
create policy "Users can delete own bets" on public.bets
  for delete using (auth.uid() = user_id);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-update updated_at on settings
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger settings_updated_at
  before update on public.settings
  for each row execute function update_updated_at();

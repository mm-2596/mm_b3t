-- ============================================================
-- mm_b3t — Fix RLS para uso personal (sin autenticación)
-- Ejecuta esto en Supabase SQL Editor
-- ============================================================

-- 1. Eliminar las policies basadas en auth.uid() que bloquean el acceso
drop policy if exists "Users can view own settings" on public.settings;
drop policy if exists "Users can insert own settings" on public.settings;
drop policy if exists "Users can update own settings" on public.settings;

drop policy if exists "Users can view own transactions" on public.transactions;
drop policy if exists "Users can insert own transactions" on public.transactions;
drop policy if exists "Users can update own transactions" on public.transactions;
drop policy if exists "Users can delete own transactions" on public.transactions;

drop policy if exists "Users can view own bets" on public.bets;
drop policy if exists "Users can insert own bets" on public.bets;
drop policy if exists "Users can update own bets" on public.bets;
drop policy if exists "Users can delete own bets" on public.bets;

-- 2. Eliminar el foreign key de user_id (que requiere existir en auth.users)
alter table public.settings drop constraint if exists settings_user_id_fkey;
alter table public.transactions drop constraint if exists transactions_user_id_fkey;
alter table public.bets drop constraint if exists bets_user_id_fkey;

-- 3. Hacer user_id nullable (ya que no usamos auth)
alter table public.settings alter column user_id drop not null;
alter table public.transactions alter column user_id drop not null;
alter table public.bets alter column user_id drop not null;

-- 4. Crear policies permisivas para el role anon (acceso total sin login)
create policy "Anon full access settings" on public.settings
  for all to anon using (true) with check (true);

create policy "Anon full access transactions" on public.transactions
  for all to anon using (true) with check (true);

create policy "Anon full access bets" on public.bets
  for all to anon using (true) with check (true);

-- Verificar que las tablas están OK
select 'settings' as tabla, count(*) from public.settings
union all
select 'bets', count(*) from public.bets
union all
select 'transactions', count(*) from public.transactions;

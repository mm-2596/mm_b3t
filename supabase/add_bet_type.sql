-- Run this in Supabase SQL Editor
alter table bets add column if not exists bet_type text not null default 'pick';

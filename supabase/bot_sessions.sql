-- Run this in Supabase SQL Editor
create table if not exists bot_sessions (
  chat_id bigint primary key,
  step text not null,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);

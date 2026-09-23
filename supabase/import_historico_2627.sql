-- Histórico Temporada 2026/27 — pega esto en Supabase SQL Editor y pulsa Run

WITH uid AS (
  SELECT id FROM auth.users WHERE email = 'miguel.morales2596@gmail.com' LIMIT 1
)
INSERT INTO bets (user_id, date, sport, competition, match, pick, bookmaker, odds, units, stake, status, result_amount, notes)
SELECT uid.id, v.date, v.sport, v.competition, v.match, v.pick, v.bookmaker, v.odds, v.units, v.stake, v.status, v.result_amount, v.notes
FROM uid, (VALUES
  -- Liga EA Sports
  ('2026-08-16'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 1',         'Múltiples', 'Varios', 5.00, 2.0, 20::numeric, 'won',      80::numeric,   'R 80'),
  ('2026-08-23'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 2',         'Múltiples', 'Varios', 1.66, 3.5, 35::numeric, 'won',      23::numeric,   'R 30'),
  ('2026-08-30'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 3',         'Múltiples', 'Varios', 2.57, 3.5, 35::numeric, 'won',      55::numeric,   'No R (70 disponibles)'),
  ('2026-09-13'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 4',         'Múltiples', 'Varios', 4.40, 2.0, 20::numeric, 'won',      68::numeric,   'R 40'),
  -- Champions League J1
  ('2026-09-15'::date, 'Futbol', 'UEFA Champions League', 'CL J1 - Martes',    'Múltiples', 'Varios', 2.36, 4.7, 47::numeric, 'won',      64.03::numeric,'R 80'),
  ('2026-09-16'::date, 'Futbol', 'UEFA Champions League', 'CL J1 - Miercoles', 'Múltiples', 'Varios', 1.78, 5.1, 51::numeric, 'cashout', -11::numeric,   'Cashout 40 / no R'),
  ('2026-09-17'::date, 'Futbol', 'UEFA Champions League', 'CL J1 - Jueves',    'Múltiples', 'Varios', 2.05, 4.0, 40::numeric, 'won',      42::numeric,   'R 40'),
  -- Liga EA Sports (cont.)
  ('2026-09-20'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 5',         'Múltiples', 'Varios', 2.50, 4.0, 40::numeric, 'won',      60::numeric,   'R 80'),
  ('2026-09-27'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 6',         'Múltiples', 'Varios', 3.00, 2.0, 20::numeric, 'won',      40::numeric,   'R 40'),
  ('2026-10-04'::date, 'Fútbol', 'Liga EA Sports',        'Jornada 7',         'Múltiples', 'Varios', 1.60, 5.0, 50::numeric, 'won',      30::numeric,   'R 30')
) AS v(date, sport, competition, match, pick, bookmaker, odds, units, stake, status, result_amount, notes);

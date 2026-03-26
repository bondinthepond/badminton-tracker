create table if not exists public.match_scores (
  match_id text primary key,
  set1_a integer null,
  set1_b integer null,
  set2_a integer null,
  set2_b integer null,
  set3_a integer null,
  set3_b integer null,
  remarks text default '',
  status text default 'upcoming',
  updated_at timestamptz not null default now()
);

alter table public.match_scores enable row level security;

drop policy if exists "public read scores" on public.match_scores;
create policy "public read scores"
on public.match_scores
for select
to anon
using (true);

drop policy if exists "public write scores" on public.match_scores;
create policy "public write scores"
on public.match_scores
for insert
to anon
with check (true);

drop policy if exists "public update scores" on public.match_scores;
create policy "public update scores"
on public.match_scores
for update
to anon
using (true)
with check (true);

alter publication supabase_realtime add table public.match_scores;
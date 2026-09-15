create table if not exists scan_stats (
  id text primary key,
  count integer not null default 0
);

insert into scan_stats (id, count)
values ('global', 0)
on conflict (id) do nothing;

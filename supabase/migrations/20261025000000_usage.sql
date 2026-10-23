-- One row per assistant reply: the sum of its calls to the model (tool rounds, memory, fallbacks).
create table usage (
  id                 bigint generated always as identity primary key,
  client_id          text not null,
  contact_id         text not null,
  model              text not null,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  calls              int not null default 1,
  at                 timestamptz not null default now()
);
create index usage_client_at on usage (client_id, at desc);
-- Only the server writes it, and only platform admins read it (through admin_tokens).
alter table usage enable row level security;

create function admin_tokens(days int)
returns table (
  client_id text,
  model text,
  replies bigint,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select u.client_id, u.model, count(*), sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint,
         sum(u.cache_read_tokens)::bigint, sum(u.cache_write_tokens)::bigint
  from usage u
  where u.contact_id not like 'eval%'
    and u.at >= now() - make_interval(days => days)
    and exists (select 1 from platform_admins p where p.user_id = auth.uid())
  group by u.client_id, u.model
  order by u.client_id, u.model;
$$;
revoke execute on function admin_tokens(int) from public, anon;
grant execute on function admin_tokens(int) to authenticated;

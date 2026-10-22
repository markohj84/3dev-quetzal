-- Platform admins (3dev): the only ones who can read usage across clients.
create table platform_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table platform_admins enable row level security;
create policy "ve si es admin" on platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- One row per client, aggregates only: no message text, no contact data. The
-- function is the single door; the clients' own tables get no new policy.
create function admin_usage(days int)
returns table (
  client_id text,
  people bigint,
  messages bigint,
  leads bigint,
  follow_ups bigint,
  last_message_at timestamptz,
  taken_now bigint
)
language sql
security definer
set search_path = public
as $$
  with since as (select now() - make_interval(days => days) as t),
  clients as (select distinct c.client_id from contacts c where c.contact_id not like 'eval%'),
  msgs as (
    select m.client_id,
           count(distinct m.contact_id) filter (where m.role = 'user' and m.at >= (select t from since)) as people,
           count(*) filter (where m.role = 'user' and m.at >= (select t from since)) as messages,
           max(m.at) as last_message_at
    from messages m where m.contact_id not like 'eval%' group by m.client_id
  ),
  l as (select x.client_id, count(*) as n from leads x where x.contact_id not like 'eval%' and x.at >= (select t from since) group by x.client_id),
  f as (select y.client_id, count(*) as n from follow_ups y where y.reason = 'sent' and y.at >= (select t from since) group by y.client_id),
  h as (select z.client_id, count(*) as n from handoffs z where z.contact_id not like 'eval%' and z.last_human_at > now() - interval '4 hours' group by z.client_id)
  select c.client_id,
         coalesce(msgs.people, 0), coalesce(msgs.messages, 0),
         coalesce(l.n, 0), coalesce(f.n, 0),
         msgs.last_message_at, coalesce(h.n, 0)
  from clients c
  left join msgs using (client_id) left join l using (client_id) left join f using (client_id) left join h using (client_id)
  where exists (select 1 from platform_admins p where p.user_id = auth.uid())
  order by c.client_id;
$$;
revoke execute on function admin_usage(int) from public, anon;
grant execute on function admin_usage(int) to authenticated;

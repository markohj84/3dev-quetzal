-- People who wrote in one calendar month, per client: what a plan's monthly
-- allowance is measured against (admin_usage only knows rolling windows).
-- Months are cut in Mexico City time, the zone the platform bills in.
-- Aggregates only and platform admins only, like admin_usage.
create function admin_people_month(months_ago int)
returns table (client_id text, people bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  with bounds as (
    select
      (date_trunc('month', now() at time zone 'America/Mexico_City') - make_interval(months => months_ago)) at time zone 'America/Mexico_City' as since,
      (date_trunc('month', now() at time zone 'America/Mexico_City') - make_interval(months => months_ago - 1)) at time zone 'America/Mexico_City' as until
  )
  select m.client_id, count(distinct m.contact_id)
  from messages m, bounds b
  where m.role = 'user'
    and m.contact_id not like 'eval%'
    and m.at >= b.since
    and m.at < b.until
    and exists (select 1 from platform_admins p where p.user_id = auth.uid())
  group by m.client_id
  order by m.client_id;
$$;
revoke execute on function admin_people_month(int) from public, anon;
grant execute on function admin_people_month(int) to authenticated;

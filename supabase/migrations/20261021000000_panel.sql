-- Who may read which client's data in the panel. Rows are added by 3dev
-- (scripts/panel-user.mjs, with service_role); nobody grants themselves access.
create table dashboard_users (
  user_id   uuid not null references auth.users on delete cascade,
  client_id text not null,
  primary key (user_id, client_id)
);
alter table dashboard_users enable row level security;
create policy "ve sus accesos" on dashboard_users
  for select to authenticated using (user_id = (select auth.uid()));

-- Read-only, and only the clients listed for this user. The (select auth.uid())
-- form is evaluated once per query instead of once per row.
create policy "panel lee su cliente" on contacts for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on messages for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on leads for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel lee su cliente" on follow_ups for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));

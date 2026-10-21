-- A take is always the caller's own, under their own email, and can't be
-- dated into the future: otherwise a colleague could hold a conversation
-- forever (isTaken never lapses) or silence its alerts.
drop policy "panel maneja sus tomas" on handoffs;

create policy "panel lee y devuelve sus tomas" on handoffs for select to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));
create policy "panel devuelve tomas" on handoffs for delete to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));

create policy "panel toma a su nombre" on handoffs for insert to authenticated
  with check (
    client_id in (select client_id from dashboard_users where user_id = (select auth.uid()))
    and taken_by = (select auth.uid())
    and taken_by_email = (select auth.jwt() ->> 'email')
    and last_human_at <= now() + interval '1 minute'
    and (notified_at is null or notified_at <= now() + interval '1 minute')
  );
create policy "panel actualiza a su nombre" on handoffs for update to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())))
  with check (
    client_id in (select client_id from dashboard_users where user_id = (select auth.uid()))
    and taken_by = (select auth.uid())
    and taken_by_email = (select auth.jwt() ->> 'email')
    and last_human_at <= now() + interval '1 minute'
    and (notified_at is null or notified_at <= now() + interval '1 minute')
  );

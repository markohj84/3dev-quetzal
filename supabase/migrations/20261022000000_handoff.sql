-- 'human': what the owner wrote from the panel, so the transcript says who spoke.
alter table messages drop constraint messages_role_check;
alter table messages add constraint messages_role_check check (role in ('user', 'assistant', 'human'));

-- One row = the owner has this conversation; the assistant stays quiet in it
-- until last_human_at is four hours old (core/handoff.ts).
create table handoffs (
  client_id      text not null,
  contact_id     text not null,
  taken_by       uuid not null references auth.users on delete cascade,
  -- Another panel user's session cannot read auth.users, so the name travels here.
  taken_by_email text not null,
  taken_at       timestamptz not null default now(),
  last_human_at  timestamptz not null default now(),
  notified_at    timestamptz,
  primary key (client_id, contact_id),
  foreign key (client_id, contact_id) references contacts on delete cascade
);
alter table handoffs enable row level security;

create policy "panel maneja sus tomas" on handoffs for all to authenticated
  using (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())))
  with check (client_id in (select client_id from dashboard_users where user_id = (select auth.uid())));

-- The owner may only add their own words: never the person's, never the assistant's.
create policy "panel escribe como humano" on messages for insert to authenticated
  with check (
    role = 'human'
    and client_id in (select client_id from dashboard_users where user_id = (select auth.uid()))
  );

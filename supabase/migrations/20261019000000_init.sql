-- Registros de negocio de todos los clientes; client_id = el id de la config.
create table contacts (
  client_id     text not null,
  contact_id    text not null,
  channel       text not null,
  name          text,
  interest      text,
  left_contact  boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (client_id, contact_id)
);

create table messages (
  id         bigint generated always as identity primary key,
  client_id  text not null,
  contact_id text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  at         timestamptz not null default now(),
  foreign key (client_id, contact_id) references contacts on delete cascade
);
create index messages_client_at on messages (client_id, at desc);
create index messages_contact_at on messages (client_id, contact_id, at);

create table leads (
  id         bigint generated always as identity primary key,
  client_id  text not null,
  contact_id text not null,
  channel    text not null,
  nombre     text not null,
  contacto   text not null,
  necesidad  text,
  at         timestamptz not null default now()
);
create index leads_client_at on leads (client_id, at desc);

create table follow_ups (
  client_id text not null,
  phone     text not null,
  reason    text not null check (reason in ('sent', 'booked')),
  at        timestamptz not null default now(),
  primary key (client_id, phone)
);

-- Sin políticas: solo service_role entra. Las de cada cliente llegan con el dashboard.
alter table contacts   enable row level security;
alter table messages   enable row level security;
alter table leads      enable row level security;
alter table follow_ups enable row level security;

-- Plazos del aviso de privacidad.
create function purge_expired() returns void language sql as $$
  delete from messages where at < now() - interval '12 months';
  update contacts set name = null, interest = null
    where last_seen_at < now() - interval '90 days'
      and (name is not null or interest is not null);
  delete from follow_ups where at < now() - interval '90 days';
$$;
-- Expuesta por RPC: que no la pueda llamar la llave pública.
revoke execute on function purge_expired() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-expired', '0 9 * * *', 'select purge_expired()');

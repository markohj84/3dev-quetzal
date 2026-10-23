-- usage.contact_id is a phone number on WhatsApp: it expires with the conversations (12 months).
create or replace function purge_expired() returns void
language sql
set search_path = public
as $$
  delete from messages where at < now() - interval '12 months';
  delete from usage where at < now() - interval '12 months';
  delete from contacts where last_seen_at < now() - interval '12 months';
  update contacts set name = null, interest = null, left_contact = false
    where last_seen_at < now() - interval '90 days'
      and (name is not null or interest is not null or left_contact);
  delete from follow_ups where at < now() - interval '90 days';
$$;
revoke execute on function purge_expired() from public, anon, authenticated;

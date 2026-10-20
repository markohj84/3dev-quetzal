-- The notice promises to delete or anonymize after the retention period, and a
-- WhatsApp contact_id is a phone number: a contact with no message in 12 months
-- goes too (its messages are already gone). A lapsed profile drops left_contact
-- with name and interest, or the assistant would believe it still has their contact.
create or replace function purge_expired() returns void
language sql
set search_path = public
as $$
  delete from messages where at < now() - interval '12 months';
  delete from contacts where last_seen_at < now() - interval '12 months';
  update contacts set name = null, interest = null, left_contact = false
    where last_seen_at < now() - interval '90 days'
      and (name is not null or interest is not null or left_contact);
  delete from follow_ups where at < now() - interval '90 days';
$$;
revoke execute on function purge_expired() from public, anon, authenticated;

-- Coexistence: the owner also answers from the WhatsApp Business app on the
-- same number, and that takes the conversation too. A take from the phone has
-- no panel user behind it: both columns null. The panel policies still demand
-- the caller's own id and email, so only the webhook (service_role) writes these.
alter table handoffs alter column taken_by drop not null;
alter table handoffs alter column taken_by_email drop not null;

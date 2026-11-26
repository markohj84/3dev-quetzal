import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decide, deskDecision, deskRole, details, markNotification, newOrder, orderReceipts, orderText, trackingTag, wantsOrder, type Order, type OrderStore } from './order-pilot.ts';

if (import.meta.url === `file://${process.argv[1]}`) {
  const digest = (s: string) => createHash('sha256').update(s).digest('hex');
  const pass = 'A'.repeat(43);
  const setup = {business:'Demo', binding:'test', product:'Mesa', quantity:32, itemNames:['mesas'], ventas:digest(pass), logistica:digest('B'.repeat(43))};
  assert.equal(deskRole(setup, 'Bearer ' + pass), 'ventas');
  assert.equal(deskRole(setup, 'Bearer ' + 'C'.repeat(43)), null);
  assert.ok(wantsOrder('Quiero pedir 32 mesas',setup));
  for (const msg of ['No quiero 32 mesas', 'Quiero pedir 33 mesas', 'Quiero pedir 32 mesas y 4 sillas']) assert.ok(!wantsOrder(msg,setup));
  let state: Order | null = null;
  const store: OrderStore = {read:async () => structuredClone(state), save:async (rev,next) => {
    if ((state?.revision ?? 0) !== rev) return false;
    state = structuredClone(next);
    return true;
  }};
  const [a,b] = await Promise.all([newOrder(store,setup,'123456789'),newOrder(store,setup,'123456789')]);
  assert.equal(a.folio,b.folio);
  assert.equal(a.ventas,null);
  assert.equal(a.logistica,null);
  const sales = {area:'ventas' as const,folio:a.folio,unitCents:250000};
  const logistics = {area:'logistica' as const,folio:a.folio,deliveryDate:'2027-01-20',fullOrderConfirmed:true as const};
  assert.ok(!deskDecision.safeParse({...logistics,fullOrderConfirmed:false}).success);
  await assert.rejects(decide(store,logistics,'2027-02-01'));
  const [first, repeat, delivery] = await Promise.all([decide(store,sales,'2027-01-01'),decide(store,sales,'2027-01-01'),decide(store,logistics,'2027-01-01')]);
  assert.ok(first.shouldSend && !repeat.shouldSend && delivery.shouldSend);
  const saved = await store.read();
  assert.equal(saved.folio,a.folio);
  assert.match(details(saved).price,/80,000/);
  assert.match(details(saved).delivery,/20 de enero/);
  assert.doesNotMatch(orderText(saved,setup.business,'ventas'),/Logística/);
  assert.doesNotMatch(orderText(saved,setup.business,'logistica'),/Ventas/);
  await assert.rejects(decide(store,{...sales,unitCents:3},'2027-01-01'));
  await assert.rejects(decide(store,{...sales,folio:'otro'},'2027-01-01'));
  await markNotification(store,a.folio,'ventas',first.attempt,'failed');
  const retry = await decide(store,{...sales,retry:true},'2027-01-01');
  assert.ok(retry.shouldSend);
  await markNotification(store,a.folio,'ventas',first.attempt,'read');
  assert.equal((await store.read()).ventas.status,'sending');
  const callback = {entry:[{changes:[{value:{metadata:{phone_number_id:'123'},statuses:[{status:'delivered',biz_opaque_callback_data:trackingTag(a.folio,'ventas',retry.attempt)}]}}]}]};
  assert.deepEqual(orderReceipts(callback,'456'),[]);
  const [receipt] = orderReceipts(callback,'123');
  await markNotification(store,receipt.folio,receipt.area,receipt.attempt,receipt.status);
  await markNotification(store,a.folio,'ventas',retry.attempt,'accepted');
  assert.equal((await store.read()).ventas.status,'delivered');
  assert.ok(!(await decide(store,{...sales,retry:true},'2027-01-01')).shouldSend);
}

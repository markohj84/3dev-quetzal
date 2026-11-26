import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decide, deskDecision, deskRole, details, markNotification, newOrder, orderReceipts, orderText, trackingTag, requestedQuantity, requestedFolio, orderSummary, type Order, type OrderBook } from './order-pilot.ts';

if (import.meta.url === `file://${process.argv[1]}`) {
  const digest = (s: string) => createHash('sha256').update(s).digest('hex');
  const pass = 'A'.repeat(43);
  const setup = {business:'Demo', binding:'test', product:'Mesa', quantity:32, itemNames:['mesas'], ventas:digest(pass), logistica:digest('B'.repeat(43))};
  assert.equal(deskRole(setup, 'Bearer ' + pass), 'ventas');
  assert.equal(deskRole(setup, 'Bearer ' + 'C'.repeat(43)), null);
  assert.equal(requestedQuantity('Quiero pedir 32 mesas',setup),32);
  assert.equal(requestedQuantity('Quiero pedir 48 mesas',setup),48);
  assert.equal(requestedQuantity('Hola, quiero hacer otro pedido de 16 mesas.',setup),16);
  for (const msg of ['No quiero 32 mesas', 'Quiero pedir 0 mesas', 'Quiero pedir 1.5 mesas', 'Quiero pedir 32 mesas y 4 sillas']) assert.equal(requestedQuantity(msg,setup),null);
  const states = new Map<string,Order>();
  const book: OrderBook = {
    list:async () => Array.from(states.values()),
    forFolio:folio => ({
      read:async () => structuredClone(states.get(folio) ?? null),
      save:async (rev,next) => {
        if ((states.get(folio)?.revision ?? 0) !== rev) return false;
        states.set(folio,structuredClone(next));
        return true;
      },
    }),
  };
  const create = (quantity: number, id: string) => newOrder(book,setup,'123456789',quantity,id);
  const [a,b] = await Promise.all([create(32,'message-1'),create(32,'message-1')]);
  const store = book.forFolio(a.folio);
  assert.equal(a.folio,b.folio);
  assert.equal(requestedFolio('Consultar ' + a.folio.toLowerCase()),a.folio);
  assert.equal(requestedFolio('ms-123456ab-1234'),'MS-123456ab-1234');
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
  const snapshot = await store.read();
  const second = await create(48,'message-2');
  const other = book.forFolio(second.folio);
  assert.notEqual(second.folio,a.folio);
  assert.equal(second.ventas,null);
  assert.equal(second.logistica,null);
  const inputs = {...sales,folio:second.folio,unitCents:1400};
  const [sale2, ship2] = await Promise.all([
    decide(other,inputs,'2027-01-01'),
    decide(other,{...logistics,folio:second.folio,deliveryDate:'2027-02-04'},'2027-01-01'),
  ]);
  assert.equal((await create(48,'message-2')).folio,second.folio);
  for (const r of [sale2,ship2]) assert.ok(r.shouldSend);
  await markNotification(other,second.folio,'ventas',retry.attempt,'read');
  assert.equal((await other.read()).ventas.status,'sending');
  await markNotification(store,a.folio,'logistica',ship2.attempt,'failed');
  assert.deepEqual(await store.read(),snapshot);
  assert.match(details(await other.read()).price,/672.00/);
  assert.match(details(await other.read()).delivery,/4 de febrero/);
  const summary = orderSummary(await book.list(),setup.business);
  for (const o of [a,second]) assert.ok(summary.includes(o.folio));
  assert.notEqual((await create(48,'message-3')).folio,second.folio);

}

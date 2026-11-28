import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decide, deskDecision, deskRole, details, markNotification, newOrder, orderReceipts, orderText, trackingTag, requestedQuantity, selectedQuantity, requestedFolio, asksForNewestOrder, orderMenu, orderSummary, type Order, type OrderBook } from './order-pilot.ts';

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
  assert.equal(selectedQuantity('El de 40',setup),40);
  assert.equal(selectedQuantity('¿El pedido de 56 mesas, por favor?',setup),56);
  assert.equal(requestedQuantity('el de 56',setup),null);
  for (const text of ['el nuevo', 'con el folio nuevo', '¿El nuevo, por favor?']) {
    assert.ok(asksForNewestOrder(text));
    assert.equal(requestedQuantity(text, setup), null);
  }
  for (const text of ['quiero un pedido nuevo', 'el nuevo escritorio', 'el de 40', 'no, con el folio nuevo']) {
    assert.equal(asksForNewestOrder(text), false);
  }
  for (const msg of ['Quiero pedir 40 mesas', 'el de 40 o el de 56', 'el de 40 sillas', 'el de 40.5']) {
    assert.equal(selectedQuantity(msg,setup),null);
  }
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
  const earlier = '2027-01-01T12:00:00.000Z';
  await markNotification(store,a.folio,'ventas',first.attempt,'failed',earlier);
  const retry = await decide(store,{...sales,retry:true},'2027-01-01');
  assert.ok(retry.shouldSend);
  await markNotification(store,a.folio,'ventas',first.attempt,'read',earlier);
  assert.equal((await store.read()).ventas.status,'sending');
  assert.equal((await store.read()).ventas.receiptAt,undefined);
  await markNotification(store,a.folio,'ventas',retry.attempt,'accepted');
  await markNotification(store,a.folio,'ventas',retry.attempt,'accepted',earlier);
  assert.equal((await store.read()).ventas.receiptAt,earlier);
  const stamp = '1798804805';
  const callback = {entry:[{changes:[{value:{metadata:{phone_number_id:'123'},statuses:[{status:'delivered',timestamp:stamp,biz_opaque_callback_data:trackingTag(a.folio,'ventas',retry.attempt)}]}}]}]};
  assert.deepEqual(orderReceipts(callback,'456'),[]);
  const [receipt] = orderReceipts(callback,'123');
  const deliveredAt = new Date(Number(stamp)*1000).toISOString();
  assert.equal(receipt.receiptAt,deliveredAt);
  await markNotification(store,receipt.folio,receipt.area,receipt.attempt,receipt.status,receipt.receiptAt);
  await markNotification(store,a.folio,'ventas',retry.attempt,'accepted',earlier);
  const notified = (await store.read()).ventas;
  assert.equal(notified.status,'delivered');
  assert.equal(notified.receiptAt,deliveredAt);
  assert.equal(notified.at,saved.ventas.at);
  callback.entry[0].changes[0].value.statuses[0].timestamp = 'inválida';
  assert.equal(orderReceipts(callback,'123')[0].receiptAt,undefined);
  await markNotification(store,a.folio,'ventas',retry.attempt,'read');
  assert.equal((await store.read()).ventas.receiptAt,undefined);
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
  const third = await create(48,'message-3');
  assert.notEqual(third.folio,second.folio);

  const otherOrder = await other.read();
  assert.ok(snapshot && otherOrder);
  const forty = {...snapshot, quantity:40};
  const fiftySix = {...otherOrder, quantity:56};
  const choices = [fiftySix, forty];
  assert.match(orderSummary(choices,setup.business), /el de 56/);
  for (const order of choices) {
    assert.equal(orderSummary(choices,setup.business,order.quantity), orderText(order,setup.business));
  }
  const pending = {...forty, ventas:null, logistica:null};
  assert.equal(orderSummary([pending],setup.business,40),orderText(pending,setup.business));
  const ambiguous = orderSummary([forty, {...fiftySix, quantity:40}, third],setup.business,40);
  assert.match(ambiguous, /varios pedidos de 40/);
  for (const order of choices) assert.ok(ambiguous.includes(order.folio));
  assert.ok(!ambiguous.includes(third.folio));
  assert.doesNotMatch(ambiguous, /Total por|confirmó la entrega/);
  assert.match(orderSummary(choices,setup.business,99), /No encontré un pedido de 99/);
  assert.equal(orderSummary([],setup.business),null);

  const olderForty = { ...forty, created: '2026-11-26T12:00:00Z' };
  const newerForty = { ...pending, folio: third.folio, created: '2026-11-26T15:00:00Z' };
  const laterFiftySix = { ...fiftySix, created: '2026-11-26T16:00:00Z' };
  const rows = [laterFiftySix, newerForty, olderForty];
  const menu = orderMenu(rows, setup.business, 40);
  assert.equal(menu.newestFolio, newerForty.folio);
  assert.match(menu.text, /«el nuevo»/);
  assert.ok(menu.text.includes(olderForty.folio) && !menu.text.includes(laterFiftySix.folio));
  assert.equal(orderMenu(rows, setup.business, 56).newestFolio, null);
  assert.equal(orderMenu(rows, setup.business, 99).newestFolio, null);
  assert.equal(orderMenu(rows, setup.business).newestFolio, null);
  const sameTime = orderMenu([newerForty, { ...olderForty, created: newerForty.created }], setup.business, 40);
  assert.equal(sameTime.newestFolio, null);
  assert.doesNotMatch(sameTime.text, /«el nuevo»/);
}

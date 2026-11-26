import { getAssistantOrNull } from '../../../assistant';
import { quotePilotFor } from '../../../../core/channels/quote-pilot';
import { deskRole, deskDecision, DeskConflict, decide, details, markNotification, orderSettings, orderText, trackingTag, type Order } from '../../../../core/channels/order-pilot';
import { orderStore } from '../../../../core/store/order-store';
import { createWhatsAppAdapter, WhatsAppSendError } from '../../../../core/channels/whatsapp';

const json = (data: object, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'private, no-store'}});
function publicOrder(order: Order) {
  const decision = (d: Order['ventas']) => d && {value:d.value, at:d.at, status:d.status};
  return {
    folio:order.folio, created:order.created, product:order.product, quantity:order.quantity,
    ventas:decision(order.ventas), logistica:decision(order.logistica), ...details(order),
  };
}

async function desk(request: Request) {
  const client = await getAssistantOrNull();
  const pilot = client && quotePilotFor(client.config.id);
  const setup = pilot && orderSettings(client.config.id, pilot.digest);
  if (!setup || !client.config.channels.whatsapp.enabled || Date.now() >= pilot.expiresAt * 1000) return json({},404);
  const area = deskRole(setup, request.headers.get('authorization'));
  if (!area) return json({error:'Abre el acceso de tu área.'},401);
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:client.config.scheduling.timeZone, year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const store = orderStore(client.config.id, pilot.digest, pilot.expiresAt);
  if (request.method === 'GET') {
    const order = await store.read();
    return json({area, today, business:setup.business, requests:order ? [publicOrder(order)] : []});
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({},415);
  const parsed = deskDecision.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({error:'Revisa los datos de la decisión.'},400);
  if (parsed.data.area !== area) return json({error:'Esta decisión corresponde a la otra área.'},403);
  try {
    const {order, shouldSend, attempt} = await decide(store, parsed.data, today);
    if (shouldSend) {
      const {phoneNumberId, token} = client.secrets.whatsapp;
      let status: 'accepted' | 'failed' | 'uncertain' = 'accepted';
      try {
        const adapter = createWhatsAppAdapter({phoneNumberId, accessToken:token, callbackTag:trackingTag(order.folio,area,attempt)});
        await adapter.deliver(order.recipient,{text:orderText(order,setup.business,area)});
      } catch (error) {
        status = error instanceof WhatsAppSendError && error.statusCode >= 400 && error.statusCode < 500 ? 'failed' : 'uncertain';
      }
      await markNotification(store,order.folio,area,attempt,status);
    }
    return json({order:publicOrder(await store.read())});
  } catch (error) {
    if (error instanceof DeskConflict) return json({error:error.message},409);
    throw error;
  }
}
export { desk as GET, desk as POST };

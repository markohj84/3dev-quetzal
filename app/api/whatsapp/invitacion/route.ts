import { getAssistantOrNull } from '../../../assistant';
import { acceptsToken, inviteMessage, quotePilotFor } from '../../../../core/channels/quote-pilot';
import { quoteBinding } from '../../../../core/store/session-store';

// Resolve the actual business number without exporting its credentials or redeeming the invitation.
export async function POST(request: Request) {
  const client = await getAssistantOrNull();
  const pilot = client && quotePilotFor(client.config.id);
  const token = /^Bearer ([\w-]{32})$/.exec(request.headers.get('authorization') || '')?.[1];
  const json = (body: object, status: number) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
  if (!client || !pilot || !client.config.channels.whatsapp.enabled || !token || !acceptsToken(pilot,token)) return json({},404);
  const { phoneNumberId, token: accessToken } = client.secrets.whatsapp;
  if (!phoneNumberId || !accessToken) return json({},503);
  if (await quoteBinding(client.config.id, pilot.digest, pilot.expiresAt).owner()) return json({},410);
  const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number`, {
    headers:{Authorization:'Bearer ' + accessToken}, cache:'no-store', signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) return json({},502);
  const phone = await response.json();
  const digits = String(phone.display_phone_number || '').replace(/[\s()+-]/g,'');
  if (phone.id !== phoneNumberId || !/^[1-9]\d{6,14}$/.test(digits)) return json({},502);
  const clickToChat = digits.replace(/^52(\d{10})$/, '521$1');
  return json({url:'https://wa.me/' + clickToChat + '?text=' + encodeURIComponent(inviteMessage(token)), expiresAt:pilot.expiresAt},200);
}

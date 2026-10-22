// Accesos al panel. Corre solo en la máquina de 3dev (usa service_role).
//   node --env-file=.env.local scripts/panel-user.mjs add <correo> <clientId>
//   node --env-file=.env.local scripts/panel-user.mjs remove <correo> <clientId>
//   node --env-file=.env.local scripts/panel-user.mjs list <clientId>
//   node --env-file=.env.local scripts/panel-user.mjs admin add|remove <correo>   (panel de 3dev, /admin)
//   node --env-file=.env.local scripts/panel-user.mjs admin list
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let [cmd, a, b] = process.argv.slice(2);
const platform = cmd === 'admin';
if (platform) [cmd, a, b] = [a, b, undefined];
const must = async (p) => { const { data, error } = await p; if (error) throw error; return data; };

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}
const byEmail = async (email) => (await allUsers()).find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (platform && cmd === 'list') {
  const rows = await must(admin.from('platform_admins').select('user_id'));
  const users = await allUsers();
  console.log(rows.length ? rows.map((r) => users.find((u) => u.id === r.user_id)?.email ?? r.user_id).join('\n') : 'No hay admins de plataforma');
} else if (platform && cmd === 'add' && a) {
  const email = a.trim().toLowerCase();
  const user = (await byEmail(email)) ?? (await must(admin.auth.admin.createUser({ email, email_confirm: true }))).user;
  await must(admin.from('platform_admins').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true }));
  console.log(`${email} es admin de plataforma`);
} else if (platform && cmd === 'remove' && a) {
  const user = await byEmail(a);
  if (!user) console.log(`${a} no existe`);
  else {
    await must(admin.from('platform_admins').delete().eq('user_id', user.id));
    const left = await must(admin.from('dashboard_users').select('client_id').eq('user_id', user.id));
    if (!left.length) await must(admin.auth.admin.deleteUser(user.id));
    console.log(`${a} ya no es admin de plataforma${left.length ? '' : ' (usuario borrado: no le quedaban clientes)'}`);
  }
} else if (cmd === 'add' && a && b) {
  const email = a.trim().toLowerCase();
  let user = await byEmail(email);
  if (!user) {
    // Confirmed up front: the first thing they get is the login code, not a confirmation email.
    user = (await must(admin.auth.admin.createUser({ email, email_confirm: true }))).user;
  }
  await must(admin.from('dashboard_users').upsert({ user_id: user.id, client_id: b }, { onConflict: 'user_id,client_id', ignoreDuplicates: true }));
  console.log(`${email} tiene acceso al panel de ${b}`);
} else if (cmd === 'remove' && a && b) {
  const user = await byEmail(a);
  if (!user) {
    console.log(`${a} no existe`);
  } else {
    await must(admin.from('dashboard_users').delete().eq('user_id', user.id).eq('client_id', b));
    const left = await must(admin.from('dashboard_users').select('client_id').eq('user_id', user.id));
    // Deleting the user would also take away /admin: keep anyone who is still a platform admin.
    const isAdmin = (await must(admin.from('platform_admins').select('user_id').eq('user_id', user.id))).length > 0;
    const gone = !left.length && !isAdmin;
    if (gone) await must(admin.auth.admin.deleteUser(user.id));
    console.log(`${a} ya no tiene acceso a ${b}${gone ? ' (usuario borrado: no le quedaban clientes)' : ''}`);
  }
} else if (cmd === 'list' && a) {
  const rows = await must(admin.from('dashboard_users').select('user_id').eq('client_id', a));
  const users = await allUsers();
  const emails = rows.map((r) => users.find((u) => u.id === r.user_id)?.email ?? r.user_id);
  console.log(emails.length ? emails.join('\n') : `Nadie tiene acceso a ${a}`);
} else {
  console.error('Uso: panel-user.mjs add|remove <correo> <clientId> · list <clientId> · admin add|remove <correo> · admin list');
  process.exit(1);
}

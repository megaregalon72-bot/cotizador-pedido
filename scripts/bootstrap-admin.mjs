import { createClient } from '@supabase/supabase-js';
import { normalizeUsername, technicalEmail } from '../supabase/functions/_shared/identity.ts';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD } = process.env;
let username;
try { username = normalizeUsername(BOOTSTRAP_USERNAME || ''); } catch {}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !username
  || !BOOTSTRAP_PASSWORD || BOOTSTRAP_PASSWORD.length < 12 || BOOTSTRAP_PASSWORD.length > 128) {
  console.error('Configura SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_USERNAME y BOOTSTRAP_PASSWORD (12–128 caracteres) solo en el entorno de este proceso.');
  process.exit(1);
}
const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { count, error: checkError } = await client.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin');
if (checkError || count) {
  console.error(checkError ? 'No se pudo comprobar la base. Ejecuta primero la migración SQL.' : 'Ya existe un administrador. Usa el panel Usuarios.');
  process.exit(1);
}
const { data, error } = await client.auth.admin.createUser({ email: technicalEmail(username),
  password: BOOTSTRAP_PASSWORD, email_confirm: true, user_metadata: { display_name: username } });
if (error || !data.user) { console.error('No se pudo crear el administrador. Revisa el nombre duplicado y las reglas de contraseña.'); process.exit(1); }
const { error: bootstrapError } = await client.rpc('bootstrap_admin', { p_target: data.user.id });
if (bootstrapError) { console.error('La cuenta quedó inactiva. Comprueba la migración y usa bootstrap_admin con su ID desde SQL Editor.'); process.exit(1); }
console.log(`Administrador ${username} creado. Ya puedes iniciar sesión con su usuario y contraseña.`);

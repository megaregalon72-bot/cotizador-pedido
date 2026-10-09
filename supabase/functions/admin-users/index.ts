import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { normalizeUsername, technicalEmail } from '../_shared/identity.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(v => v.trim()).filter(Boolean);
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  const reply = (status: number, message: unknown) => new Response(JSON.stringify(message), { status, headers });
  if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: 'Origen no autorizado. Configura ALLOWED_ORIGINS.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return reply(401, { error: 'Inicia sesión.' });
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return reply(401, { error: 'Sesión inválida o vencida.' });
  const { data: actor, error: actorError } = await service.from('profiles').select('id,role,active').eq('id', auth.user.id).single();
  if (actorError || !actor?.active || actor.role !== 'admin') return reply(403, { error: 'Administrador activo requerido.' });
  try {
    const raw = await request.text();
    if (raw.length > 8192) return reply(413, { error: 'Solicitud demasiado grande.' });
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object') return reply(400, { error: 'Solicitud inválida.' });
    if (input.action === 'create') {
      const username = normalizeUsername(String(input.username || ''));
      const displayName = String(input.display_name || '').trim();
      if (displayName.length < 1 || displayName.length > 100) return reply(400, { error: 'Nombre requerido, máximo 100 caracteres.' });
      if (!['admin', 'seller'].includes(input.role)) return reply(400, { error: 'Rol inválido.' });
      if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return reply(400, { error: 'Contraseña de 12 a 128 caracteres requerida.' });
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email: technicalEmail(username), password: input.password, email_confirm: true,
        user_metadata: { display_name: displayName }
      });
      if (createError || !created.user) return reply(409, { error: 'No se pudo crear la cuenta. Revisa si el usuario ya existe o si la contraseña cumple las reglas de Supabase.' });
      const { data, error } = await service.rpc('admin_set_profile', { p_actor: actor.id, p_target: created.user.id,
        p_role: input.role, p_active: true, p_display_name: displayName, p_action: 'user_created' });
      if (error) return reply(409, { error: 'La cuenta se creó inactiva, pero no pudo activarse. Puedes localizarla en Usuarios y completar su configuración.' });
      return reply(201, { profile: data });
    }
    if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id)) return reply(400, { error: 'Identificador inválido.' });
    const { data: target, error: targetError } = await service.from('profiles').select('id,active,role,display_name').eq('id', input.id).single();
    if (targetError || !target) return reply(404, { error: 'Usuario inexistente.' });
    if (input.action === 'update') {
      if (!['admin', 'seller'].includes(input.role) || typeof input.active !== 'boolean' || typeof input.display_name !== 'string'
        || input.display_name.trim().length < 1 || input.display_name.trim().length > 100) return reply(400, { error: 'Datos de usuario inválidos.' });
      const { data, error } = await service.rpc('admin_set_profile', { p_actor: actor.id, p_target: input.id,
        p_role: input.role, p_active: input.active, p_display_name: input.display_name, p_action: 'user_updated' });
      if (error) return reply(409, { error: error.message });
      return reply(200, { profile: data });
    }
    if (input.action === 'reset-password') {
      if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) return reply(400, { error: 'Contraseña de 12 a 128 caracteres requerida.' });
      // Revalida autorización en PostgreSQL antes de la operación privilegiada.
      const { error: permissionError } = await service.rpc('record_admin_event', { p_actor: actor.id, p_target: input.id, p_action: 'password_reset_requested' });
      if (permissionError) return reply(403, { error: 'Administrador activo requerido.' });
      const { error } = await service.auth.admin.updateUserById(input.id, { password: input.password });
      if (error) return reply(400, { error: 'Supabase no pudo restablecer la contraseña.' });
      const { error: auditError } = await service.rpc('record_admin_event', { p_actor: actor.id, p_target: input.id, p_action: 'password_reset' });
      if (auditError) return reply(409, { error: 'La contraseña se restableció, pero no pudo registrarse su confirmación en auditoría. La solicitud sí quedó registrada.' });
      return reply(200, { ok: true });
    }
    return reply(400, { error: 'Acción no permitida.' });
  } catch (error) {
    if (error instanceof SyntaxError) return reply(400, { error: 'JSON inválido.' });
    if (error instanceof Error && error.message.startsWith('Usa un usuario')) return reply(400, { error: error.message });
    return reply(500, { error: 'No se pudo completar la operación. Intenta nuevamente.' });
  }
});

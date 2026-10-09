import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^import .*;\s*$/gm, '');
function functionFixture(role = 'admin', active = true) {
  let handler; const calls = [];
  const profile = { id: '11111111-1111-4111-8111-111111111111', role, active, display_name: 'Admin' };
  const target = { id: '22222222-2222-4222-8222-222222222222', role: 'seller', active: true, display_name: 'Empleado' };
  const service = {
    auth: {
      getUser: async token => token === 'verified-user-token' ? { data: { user: { id: profile.id } }, error: null } : { data: {}, error: new Error('invalid') },
      admin: {
        createUser: async input => { calls.push(['create', input]); return { data: { user: { id: target.id } }, error: null }; },
        updateUserById: async (id, input) => { calls.push(['password', id, input]); return { error: null }; }
      }
    },
    from: () => ({ select: () => ({ eq: (_column, id) => ({ single: async () => ({ data: id === profile.id ? profile : target, error: null }) }) }) }),
    rpc: async (name, input) => { calls.push([name, input]); return { data: target, error: null }; }
  };
  const context = { Request, Response, Headers, console, createClient: () => service,
    normalizeUsername: username => { const normalized = username.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) throw new Error('Usa un usuario válido'); return normalized; },
    technicalEmail: username => `${username}@usuarios.cotizador.invalid`,
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://unit-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only', ALLOWED_ORIGINS: 'https://shop.example' }[name]) }, serve: fn => { handler = fn; } }
  };
  vm.runInNewContext(compiled, context);
  const request = (body, token = 'verified-user-token', origin = 'https://shop.example') => handler(new Request('https://unit-test.supabase.co/functions/v1/admin-users', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
  return { request, calls, target };
}
test('Función de administración rechaza tokens inválidos, vendedores, cuentas inactivas y otros orígenes', async () => {
  const admin = functionFixture(); assert.equal((await admin.request({ action: 'create' }, 'fake-token')).status, 401);
  assert.equal((await admin.request({ action: 'create' }, undefined, 'https://attacker.example')).status, 403);
  const seller = functionFixture('seller'); assert.equal((await seller.request({ action: 'create', role: 'admin' })).status, 403); assert.equal(seller.calls.length, 0);
  const disabled = functionFixture('admin', false); assert.equal((await disabled.request({ action: 'create' })).status, 403); assert.equal(disabled.calls.length, 0);
});
test('Creación usa correo técnico confirmado y actor autenticado, nunca actor enviado por cliente', async () => {
  const f = functionFixture(); const response = await f.request({ action: 'create', username: 'Empleado', password: 'fixture-password-123', display_name: 'Empleado', role: 'seller', actor: 'fake-id' });
  assert.equal(response.status, 201);
  assert.equal(f.calls[0][1].email, 'empleado@usuarios.cotizador.invalid'); assert.equal(f.calls[0][1].email_confirm, true);
  assert.equal(f.calls[1][1].p_actor, '11111111-1111-4111-8111-111111111111');
  assert.ok(!(await response.text()).includes('fixture-password-123'));
});
test('Restablecimiento registra solicitud y resultado sin guardar contraseñas en auditoría', async () => {
  const f = functionFixture(); const response = await f.request({ action: 'reset-password', id: f.target.id, password: 'fixture-password-123' });
  assert.equal(response.status, 200);
  assert.equal(f.calls[0][1].p_action, 'password_reset_requested'); assert.equal(f.calls[1][0], 'password'); assert.equal(f.calls[2][1].p_action, 'password_reset');
  assert.ok(!JSON.stringify([f.calls[0], f.calls[2]]).includes('fixture-password-123'));
});
test('Contraseñas débiles y roles inválidos no llegan a Auth admin', async () => {
  const f = functionFixture();
  assert.equal((await f.request({ action: 'create', username: 'empleado', display_name: 'Empleado', role: 'seller', password: 'short' })).status, 400);
  assert.equal((await f.request({ action: 'create', username: 'empleado', display_name: 'Empleado', role: 'root', password: 'fixture-password-123' })).status, 400);
  assert.equal(f.calls.length, 0);
});

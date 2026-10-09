import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids = { admin: '11111111-1111-4111-8111-111111111111', seller: '22222222-2222-4222-8222-222222222222', other: '33333333-3333-4333-8333-333333333333' };
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610090001_cotizador.sql', import.meta.url), 'utf8'));
  for (const [username, id] of Object.entries(ids)) await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, `${username}@usuarios.cotizador.invalid`, JSON.stringify({ display_name: username, role: 'admin', active: true })]);
  await asService('select public.bootstrap_admin($1)', [ids.admin]);
  for (const key of ['seller', 'other']) await asService("select public.admin_set_profile($1,$2,'seller',true,$3)", [ids.admin, ids[key], key]);
});
after(async () => { await db.close(); });
function asRole(role, id, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
    return tx.query(sql, params);
  });
}
const asUser = (id, sql, params) => asRole('authenticated', id, sql, params);
const asService = (sql, params) => asRole('service_role', null, sql, params);
function payload(rate = '50000', customer = 'Cliente de prueba', items = [{ description: 'Producto', unit_price_cents: '1000', quantity: 2, tax_exempt: false }], weight = '5000000') {
  return { customer_name: customer, exchange_rate_cents: rate, weight_micros: weight, items };
}
async function save(owner, id, revision, data) {
  return (await asUser(owner, 'select public.save_quote($1,$2,$3) as quote', [id, revision, JSON.stringify(data)])).rows[0].quote;
}
test('Las seis tablas tienen RLS y las cuentas no heredan roles de metadata', async () => {
  const tables = (await db.query("select relname,relrowsecurity from pg_class where relname in ('profiles','clients','quotes','quote_items','quote_revisions','audit_events')")).rows;
  assert.equal(tables.length, 6); assert.ok(tables.every(t => t.relrowsecurity));
  const id = randomUUID(); await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, 'nuevo@usuarios.cotizador.invalid', '{"role":"admin","active":true}']);
  const profile = (await db.query('select role,active from public.profiles where id=$1', [id])).rows[0];
  assert.equal(profile.role, 'seller'); assert.equal(profile.active, false);
});
test('Se conservan los tres cálculos originales; el servidor ignora totales manipulados', async () => {
  const examples = [
    [payload(), '3500', '1750000'],
    [payload('50000', 'Cliente dos', [{ unit_price_cents: '2000', quantity: 2 }, { unit_price_cents: '500', quantity: 3 }], '15000000'), '8500', '4250000'],
    [payload('50000', 'Cliente tres', [{ unit_price_cents: '10000', quantity: 1 }], '25000000'), '14000', '7000000']
  ];
  for (const [input, usd, crc] of examples) {
    input.total_usd_cents = '0'; input.total_crc_cents = '0';
    const q = await save(ids.seller, randomUUID(), 0, input);
    assert.equal(q.snapshot.total_usd_cents, usd); assert.equal(q.snapshot.total_crc_cents, crc);
    assert.equal(q.owner_id, ids.seller); assert.match(q.number, /^COT-/);
  }
});
test('Reintentos del mismo ID no crean duplicados ni revisiones falsas', async () => {
  const id = randomUUID(); const input = payload('60000', 'Idempotente');
  const a = await save(ids.seller, id, 0, input); const b = await save(ids.seller, id, 0, input);
  assert.equal(a.id, b.id); assert.equal(a.revision, b.revision);
  assert.equal((await db.query('select count(*)::int as n from public.quotes where id=$1', [id])).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int as n from public.quote_revisions where quote_id=$1', [id])).rows[0].n, 1);
});
test('Usuarios duplicados, incluso con mayúsculas, se rechazan en la base', async () => {
  await assert.rejects(() => db.query('insert into auth.users(id,email) values($1,$2)', [randomUUID(), 'SELLER@usuarios.cotizador.invalid']), error => error.code === '23505');
});
test('Cliente, exenciones y tipos de cambio históricos conservan versiones anteriores', async () => {
  const id = randomUUID(); await save(ids.seller, id, 0, payload());
  const changed = payload('60000', 'María González'); changed.items[0].tax_exempt = true;
  const updated = await save(ids.seller, id, 1, changed);
  assert.equal(updated.snapshot.total_crc_cents, '2100000'); assert.equal(updated.customer_name, 'María González');
  assert.equal(updated.snapshot.items[0].tax_exempt, true);
  const detail = (await asUser(ids.seller, 'select public.get_quote($1) as quote', [id])).rows[0].quote;
  assert.equal(detail.revisions.length, 2); assert.equal(detail.revisions[0].previous_snapshot.exchange_rate_cents, '50000');
  assert.equal(detail.revisions[0].previous_snapshot.total_crc_cents, '1750000');
  assert.equal(detail.revisions[0].previous_snapshot.customer_name, 'Cliente de prueba');
  await save(ids.seller, randomUUID(), 0, payload('70000'));
  assert.equal((await asUser(ids.seller, 'select public.get_quote($1) as q', [id])).rows[0].q.snapshot.exchange_rate_cents, '60000');
  await assert.rejects(() => save(ids.seller, id, 1, payload('80000')), error => error.code === '40001');
});
test('Vendedores ven solo sus datos; admin ve todos y nadie anónimo cotiza', async () => {
  const other = await save(ids.other, randomUUID(), 0, payload('60000', 'Cliente privado'));
  const own = (await asUser(ids.seller, 'select owner_id from public.quotes')).rows;
  assert.ok(own.length > 0); assert.ok(own.every(q => q.owner_id === ids.seller));
  await assert.rejects(() => asUser(ids.seller, 'select public.get_quote($1)', [other.id]), error => error.code === '42501');
  assert.equal((await asUser(ids.seller, 'select count(*)::int as n from public.audit_events')).rows[0].n, 0);
  assert.ok((await asUser(ids.admin, 'select count(*)::int as n from public.quotes')).rows[0].n > own.length);
  await assert.rejects(() => asRole('anon', null, 'select public.save_quote($1,0,$2)', [randomUUID(), JSON.stringify(payload())]), error => error.code === '42501');
});
test('Roles, auditoría e históricos no admiten escrituras directas de vendedores', async () => {
  await assert.rejects(() => asUser(ids.seller, "update public.profiles set role='admin' where id=$1", [ids.seller]), error => error.code === '42501');
  await assert.rejects(() => asUser(ids.seller, "select public.admin_set_profile($1,$1,'admin',true,'hack')", [ids.seller]), error => error.code === '42501');
  await assert.rejects(() => asUser(ids.seller, "insert into public.audit_events(action) values('falso')"), error => error.code === '42501');
  await assert.rejects(() => asUser(ids.admin, 'delete from public.quote_revisions'), error => error.code === '42501');
  await assert.rejects(() => asUser(ids.admin, 'update public.quotes set snapshot=\'{}\''), error => error.code === '42501');
});
test('Estados y cancelaciones generan revisiones; confirmar requiere administrador', async () => {
  const q = await save(ids.seller, randomUUID(), 0, payload());
  await assert.rejects(() => asUser(ids.seller, "select public.set_quote_status($1,'confirmed',1)", [q.id]), error => error.code === '42501');
  const confirmed = (await asUser(ids.admin, "select public.set_quote_status($1,'confirmed',1) as q", [q.id])).rows[0].q;
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.revision, 2);
  await assert.rejects(() => save(ids.seller, q.id, 2, payload('60000')), /cerrada/);
  const cancelled = await save(ids.seller, randomUUID(), 0, payload());
  await asUser(ids.seller, "select public.set_quote_status($1,'cancelled',1)", [cancelled.id]);
  assert.equal((await asUser(ids.admin, "select action from public.audit_events where resource_id=$1 order by id desc limit 1", [cancelled.id])).rows[0].action, 'quote_cancelled');
});
test('Búsquedas, filtros, paginación y estadísticas usan datos autorizados', async () => {
  const first = await save(ids.seller, randomUUID(), 0, payload('60000', 'Filtro especial'));
  await save(ids.seller, randomUUID(), 0, payload('60000', 'Filtro especial dos'));
  const sql = "select public.search_quotes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as results";
  const result = (await asUser(ids.seller, sql, ['Filtro especial', '', '', null, null, null, 1, 1, 'asc', false])).rows[0].results;
  assert.equal(result.total, 2); assert.equal(result.rows.length, 1);
  const exact = (await asUser(ids.admin, sql, ['', 'seller', first.number, 'draft', null, null, 1, 20, 'desc', false])).rows[0].results;
  assert.equal(exact.total, 1); assert.equal(exact.rows[0].id, first.id);
  const none = (await asUser(ids.admin, sql, ['', '', '', null, '2030-01-01T05:00:00Z', '2030-01-02T05:00:00Z', 1, 20, 'desc', false])).rows[0].results;
  assert.equal(none.total, 0);
  const ownAdmin = (await asUser(ids.admin, sql, ['', '', '', null, null, null, 1, 20, 'desc', true])).rows[0].results;
  assert.equal(ownAdmin.total, 0);
  await assert.rejects(() => asUser(ids.seller, 'select public.quote_statistics()'), error => error.code === '42501');
  const stats = (await asUser(ids.admin, 'select public.quote_statistics() as s')).rows[0].s;
  assert.ok(stats.quotes > 0); assert.equal(typeof stats.total_crc_cents, 'string');
});
test('Precios, cantidades, clientes, cambio y productos inválidos se rechazan en servidor', async () => {
  const invalid = [payload('0'), payload('100000001'), payload('60000', ''), payload('60000', 'x'.repeat(121)),
    payload('60000', 'Cliente', []), payload('60000', 'Cliente', [{ unit_price_cents: '1000', quantity: 0 }]),
    payload('60000', 'Cliente', [{ unit_price_cents: '-100', quantity: 1 }]), payload('60000', 'Cliente', [{ unit_price_cents: '1e3', quantity: 1 }])];
  const missing = payload(); delete missing.items; invalid.push(missing);
  for (const input of invalid) await assert.rejects(() => save(ids.seller, randomUUID(), 0, input));
});
test('Desactivar una cuenta bloquea de inmediato un JWT aún existente', async () => {
  await asService("select public.admin_set_profile($1,$2,'seller',false,'seller')", [ids.admin, ids.seller]);
  assert.equal((await asUser(ids.seller, 'select count(*)::int as n from public.quotes')).rows[0].n, 0);
  await assert.rejects(() => save(ids.seller, randomUUID(), 0, payload()), error => error.code === '42501');
  await assert.rejects(() => asUser(ids.seller, "select public.record_session_event('login')"), error => error.code === '42501');
  await asService("select public.admin_set_profile($1,$2,'seller',true,'seller')", [ids.admin, ids.seller]);
  assert.ok((await asUser(ids.seller, 'select count(*)::int as n from public.quotes')).rows[0].n > 0);
  await assert.rejects(() => asService("select public.admin_set_profile($1,$1,'seller',false,'admin')", [ids.admin]), /administrador activo/);
});

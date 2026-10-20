import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const ids = { seller: '22222222-2222-4222-8222-222222222222', admin: '11111111-1111-4111-8111-111111111111' };
async function fixture(page, role = 'seller') {
  const profile = { id: ids[role], username: role, display_name: role === 'admin' ? 'Administrador' : 'Vendedor', role, active: true };
  const records = []; const calls = []; const errors = []; const deletedIds = new Set(); let failSave = false;
  page.on('pageerror', error => errors.push(error.message));
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: profile.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
  await page.route('https://unit-test.supabase.co/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const body = request.postDataJSON();
    calls.push({ path: url.pathname, body });
    const reply = (json, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers } });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (url.pathname === '/auth/v1/token') {
      if (body.email !== `${role}@usuarios.cotizador.invalid` || body.password !== 'fixture-password-123') return reply({ message: 'Invalid login credentials' }, 400);
      return reply({ access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user: { id: profile.id, email: body.email, aud: 'authenticated', role: 'authenticated', user_metadata: {} } });
    }
    if (url.pathname === '/auth/v1/logout') return reply({});
    if (url.pathname === '/auth/v1/user') return reply({ id: profile.id, email: `${role}@usuarios.cotizador.invalid` });
    if (url.pathname === '/rest/v1/profiles') return reply(url.searchParams.has('id') ? profile : [profile]);
    if (url.pathname === '/rest/v1/rpc/record_session_event') return reply(null);
    if (url.pathname === '/rest/v1/rpc/save_quote') {
      if (deletedIds.has(body.p_id)) return reply({ message: 'La cotización fue eliminada', code: 'P0002' }, 404);
      if (failSave) { failSave = false; return reply({ message: 'Conexión de prueba interrumpida', code: '08006' }, 503); }
      const p = body.p_payload; const subtotal = p.items.reduce((n, i) => n + BigInt(i.unit_price_cents) * BigInt(i.quantity), 0n);
      const packages = (p.packages ?? [{ weight_micros: p.weight_micros }]).map(pack => {
        const weight = BigInt(pack.weight_micros); const cost = weight <= 10000000n ? 1500n : weight <= 20000000n ? 3000n : 4000n;
        return { ...pack, shipping_cents: cost.toString(), shipping_crc_cents: (cost * 500n).toString() };
      });
      const shipping = packages.reduce((sum, pack) => sum + BigInt(pack.shipping_cents), 0n);
      const snapshot = { ...p, packages, package_count: packages.length, items: p.items.map(i => ({ ...i, subtotal_cents: (BigInt(i.unit_price_cents) * BigInt(i.quantity)).toString() })),
        subtotal_cents: subtotal.toString(), shipping_cents: shipping.toString(), total_usd_cents: (subtotal + shipping).toString(),
        subtotal_crc_cents: ((subtotal * BigInt(p.exchange_rate_cents) + 50n) / 100n).toString(), shipping_crc_cents: (shipping * 500n).toString(),
        total_crc_cents: (((subtotal * BigInt(p.exchange_rate_cents) + 50n) / 100n) + shipping * 500n).toString(), product_count: p.items.length,
        shipping_rate_label: '0–10 kg', tax_note: 'Sin tasa definida.' };
      const previous = records.find(q => q.id === body.p_id);
      const q = { id: body.p_id, number: previous?.number || 'COT-' + String(records.length + 1).padStart(8, '0'), revision: (previous?.revision || 0) + 1,
        username: profile.username, owner_id: profile.id, customer_name: p.customer_name, status: 'draft', created_at: '2026-10-09T04:30:00Z', snapshot };
      if (previous) records.splice(records.indexOf(previous), 1, q); else records.push(q);
      return reply(q);
    }
    if (url.pathname === '/rest/v1/rpc/search_quotes') {
      let rows = records.filter(q => !body.p_customer || q.customer_name.toLowerCase().includes(body.p_customer.toLowerCase()));
      const total = rows.length; rows = rows.slice((body.p_page - 1) * body.p_page_size, body.p_page * body.p_page_size);
      return reply({ total, rows });
    }
    if (url.pathname === '/rest/v1/rpc/get_quote') return reply({ ...records.find(q => q.id === body.p_id), revisions: [] });
    if (url.pathname === '/rest/v1/rpc/delete_quote') {
      if (profile.role !== 'admin' || !profile.active) return reply({ message: 'Administrador activo requerido', code: '42501' }, 403);
      const index = records.findIndex(q => q.id === body.p_id);
      if (index < 0 || records[index].revision !== body.p_expected_revision) return reply({ message: 'La cotización cambió', code: '40001' }, 409);
      deletedIds.add(body.p_id); records.splice(index, 1); return reply({ id: body.p_id, deleted: true });
    }
    if (url.pathname === '/rest/v1/rpc/set_quote_status') { const q = records.find(q => q.id === body.p_id); q.status = body.p_status; q.revision++; return reply(q); }
    if (url.pathname === '/rest/v1/rpc/quote_statistics') return reply({ quotes: records.length, active_users: 1, total_usd_cents: '3500', total_crc_cents: '2100000' });
    if (url.pathname === '/rest/v1/rpc/seller_period_report') return reply([{ seller_id: profile.id, username: profile.username, seller_name: profile.display_name,
      period_start: body.p_period === 'week' ? '2026-10-05' : '2026-10-01', period_end: body.p_period === 'week' ? '2026-10-11' : '2026-10-31',
      quote_count: records.length, total_usd_cents: '3500', total_crc_cents: '1950000', quoted_units: 2, confirmed_count: 1, sold_units: 2 }]);
    if (url.pathname === '/rest/v1/audit_events') return reply([{ id: 1, actor_username: profile.username, action: 'quote_created', resource_id: records[0]?.id,
      created_at: '2026-10-09T04:30:00Z', details: { new: records[0]?.snapshot } }], 200, { 'content-range': '0-0/1' });
    if (url.pathname === '/functions/v1/admin-users') {
      if (role !== 'admin') return reply({ error: 'Administrador requerido' }, 403);
      return reply({ ok: true, profile });
    }
    return reply({ message: 'Ruta de prueba no implementada: ' + url.pathname }, 404);
  });
  return { profile, records, calls, errors, deletedIds, failNextSave: () => { failSave = true; } };
}
async function login(page, role = 'seller') {
  await page.goto('/'); await page.locator('#login-username').fill(role); await page.locator('#login-password').fill('fixture-password-123');
  await page.locator('#login-submit').click(); await expect(page.locator('#quote-view')).toBeVisible();
}
async function quote(page, customer = 'María González') {
  await page.locator('#customer-name').fill(customer); await page.locator('.description-input').fill('Camisa');
  await page.locator('.price-input').fill('10'); await page.locator('.quantity-input').fill('2');
  await page.locator('#weight').fill('5'); await page.locator('#exchange-rate').fill('600');
  await expect(page.locator('#total-crc')).toHaveText('₡19,500');
  await expect(page.locator('#shipping-crc')).toHaveText('₡7,500');
  await expect(page.locator('#save-status')).toContainText('guardada', { timeout: 5000 });
}
test('Login por usuario, cálculo existente y guardado automático del cliente', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  expect(f.records).toHaveLength(1); expect(f.records[0].customer_name).toBe('María González');
  expect(f.records[0].snapshot.exchange_rate_cents).toBe('60000');
  await expect(page.locator('#tariff-body tr td:last-child')).toHaveText(['₡7,500', '₡15,000', '₡20,000']);
  await page.locator('#save-quote').click(); expect(f.records).toHaveLength(1);
  await expect(page.locator('#toast')).toHaveText('Información guardada correctamente.');
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.locator('[data-view="users"]')).toBeHidden();
  await expect(page.locator('.app-watermark')).toContainText('Erick Gonzalez'); expect(f.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('cotizador-escritorio.png'), fullPage: true });
});
test('Historial persiste al recargar y sus importes conservan el cambio original', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  await page.reload(); await expect(page.locator('#quote-view')).toBeVisible();
  await page.locator('#exchange-rate').fill('700'); await page.locator('[data-view="history"]').click();
  await expect(page.locator('#quotes-body')).toContainText('María González');
  await expect(page.locator('#quotes-body')).toContainText('₡19,500');
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eliminar cotización', exact: true })).toHaveCount(0);
  await expect(page.locator('#quote-detail-content')).toContainText('₡600');
  await expect(page.locator('#quote-detail-content')).toContainText('23:30:00'); expect(f.errors).toEqual([]);
});
test('Administrador confirma el borrado completo y el editor no vuelve a guardar la cotización eliminada', async ({ page }) => {
  const f = await fixture(page, 'admin'); await login(page, 'admin'); await quote(page);
  await page.locator('[data-view="history"]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Eliminar cotización', exact: true }).click();
  expect(f.records).toHaveLength(1);
  expect(f.calls.filter(c => c.path === '/rest/v1/rpc/delete_quote')).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar cotización', exact: true }).click();
  await expect(page.locator('#quote-detail-dialog')).not.toBeVisible();
  await expect(page.locator('#quotes-body tr')).toHaveCount(0);
  await expect(page.locator('#customer-name')).toHaveValue('');
  await page.waitForTimeout(1100);
  expect(f.records).toHaveLength(0);
  expect(f.calls.filter(c => c.path === '/rest/v1/rpc/save_quote')).toHaveLength(1);
  await expect(page.locator('#toast')).toHaveText('Cotización eliminada.');
});
test('Un conflicto de revisión no elimina datos y permite borrar tras volver a consultar el detalle', async ({ page }) => {
  const f = await fixture(page, 'admin'); await login(page, 'admin'); await quote(page);
  await page.locator('[data-view="history"]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await expect(page.locator('#quote-detail-dialog')).toBeVisible();
  f.records[0].revision++;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar cotización', exact: true }).click();
  await expect(page.locator('#app-message')).toContainText('La cotización cambió');
  expect(f.records).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Eliminar cotización', exact: true })).toBeEnabled();
  await page.locator('#quote-detail-dialog [data-close-dialog]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar cotización', exact: true }).click();
  await expect(page.locator('#quote-detail-dialog')).not.toBeVisible();
  expect(f.records).toHaveLength(0);
});
test('Un vendedor puede comenzar otra cotización si un administrador eliminó la que tenía abierta', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  const id = f.records[0].id; f.deletedIds.add(id); f.records.splice(0, 1);
  await page.locator('.price-input').fill('12');
  await expect(page.locator('#save-status')).toContainText('Esta cotización fue eliminada');
  await page.locator('#clear-quote').click();
  await expect(page.locator('#customer-name')).toHaveValue('');
  await quote(page);
  expect(f.records).toHaveLength(1); expect(f.records[0].id).not.toBe(id);
});
test('Envío fijo por peso en formulario, total móvil, resumen y cotización guardada', async ({ page }) => {
  const f = await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('copia manual'); } } });
    document.execCommand = () => false;
  });
  await login(page); await quote(page);
  for (const [weight, shipping, total] of [['0', '₡7,500', '₡19,500'], ['10', '₡7,500', '₡19,500'], ['10.000001', '₡15,000', '₡27,000'], ['20', '₡15,000', '₡27,000'], ['20.000001', '₡20,000', '₡32,000']]) {
    await page.locator('#weight').fill(weight);
    await expect(page.locator('#shipping-crc')).toHaveText(shipping);
    await expect(page.locator('#summary-shipping-crc')).toHaveText(shipping);
    await expect(page.locator('#total-crc')).toHaveText(total);
    await expect(page.locator('#mobile-crc')).toHaveText(total);
  }
  await page.locator('#weight').fill('5');
  await page.locator('#exchange-rate').fill('700');
  await expect(page.locator('#shipping-crc')).toHaveText('₡7,500');
  await expect(page.locator('#total-crc')).toHaveText('₡21,500');
  await expect(page.locator('#save-status')).toContainText('guardada');
  expect(f.records[0].snapshot.shipping_crc_cents).toBe('750000');
  expect(f.records[0].snapshot.total_crc_cents).toBe('2150000');
  await page.locator('#copy-summary').click();
  await expect(page.locator('#manual-summary')).toHaveValue(/Envío: \$15\.00 \/ ₡7,500/);
  await expect(page.locator('#manual-summary')).toHaveValue(/₡21,500 CRC/);
});
test('Un pedido suma varios bultos, conserva el desglose al editar y recalcula al quitar uno', async ({ page }) => {
  const f = await fixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('copia manual'); } } });
    document.execCommand = () => false;
  });
  await login(page); await quote(page);
  await page.locator('#add-package').click();
  await expect(page.locator('#copy-summary')).toBeDisabled();
  await page.locator('.package-weight').nth(1).fill('15');
  await expect(page.locator('#shipping-usd')).toHaveText('$45.00');
  await expect(page.locator('#shipping-crc')).toHaveText('₡22,500');
  await page.locator('#add-package').click();
  await page.locator('.package-weight').nth(2).fill('25');
  await expect(page.locator('#total-crc')).toHaveText('₡54,500');
  await expect(page.locator('#save-status')).toContainText('guardada');
  expect(f.records).toHaveLength(1); expect(f.records[0].snapshot.packages).toHaveLength(3);
  await page.locator('#copy-summary').click();
  await expect(page.locator('#manual-summary')).toHaveValue(/Bulto 2: 15 kg · \$30\.00 \/ ₡15,000/);
  await page.locator('#close-copy-dialog').click();
  await page.locator('[data-view="history"]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await expect(page.locator('#quote-detail-content')).toContainText('Bulto 3: 25 kg');
  await page.getByRole('button', { name: 'Editar cotización', exact: true }).click();
  await expect(page.locator('.package-weight')).toHaveCount(3);
  await expect(page.locator('.package-weight').nth(1)).toHaveValue('15.000000');
  await page.getByRole('button', { name: 'Quitar bulto 2', exact: true }).click();
  await expect(page.locator('#shipping-crc')).toHaveText('₡27,500');
  await expect(page.locator('#total-crc')).toHaveText('₡39,500');
  await page.locator('#exchange-rate').fill('700');
  await expect(page.locator('#total-crc')).toHaveText('₡41,500');
  await expect(page.locator('#shipping-crc')).toHaveText('₡27,500');
  await expect(page.locator('#save-status')).toContainText('guardada');
  expect(f.records[0].snapshot.packages).toHaveLength(2);
});
test('Una cotización histórica conserva el importe original hasta editarla y guardar las tarifas actuales', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  const historical = f.records[0];
  delete historical.snapshot.shipping_pricing_version;
  delete historical.snapshot.shipping_crc_cents;
  delete historical.snapshot.packages;
  delete historical.snapshot.package_count;
  historical.snapshot.total_crc_cents = '2100000';
  await page.locator('[data-view="history"]').click();
  await expect(page.locator('#quotes-body')).toContainText('₡21,000');
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await expect(page.locator('#quote-detail-content')).toContainText('₡9,000');
  await page.getByRole('button', { name: 'Editar cotización', exact: true }).click();
  await expect(page.locator('#total-crc')).toHaveText('₡19,500');
  await expect(page.locator('#save-status')).toContainText('tarifas actuales');
  expect(f.records[0].revision).toBe(1);
  await page.locator('#save-quote').click();
  await expect(page.locator('#save-status')).toContainText('revisión 2');
  expect(f.records[0].snapshot.total_crc_cents).toBe('1950000');
});
test('Un aviso de formulario incompleto desaparece al guardar y al restaurar una cotización válida', async ({ page }) => {
  const f = await fixture(page); await login(page);
  await page.locator('#save-quote').click();
  await expect(page.locator('#app-message')).toContainText('Completa al menos un producto válido y el peso de cada bulto.');
  await expect(page.locator('#toast')).toBeHidden();
  await quote(page);
  await expect(page.locator('#app-message')).toBeHidden();
  await page.locator('#weight').fill('');
  await page.locator('#save-quote').click();
  await expect(page.locator('#app-message')).toBeVisible();
  await page.locator('#weight').fill('5');
  await expect(page.locator('#app-message')).toBeHidden();
  expect(f.records).toHaveLength(1);
  expect(f.calls.filter(call => call.path === '/rest/v1/rpc/save_quote')).toHaveLength(1);
});
test('Fallo de guardado muestra error, conserva formulario y permite reintentar', async ({ page }) => {
  const f = await fixture(page); f.failNextSave(); await login(page);
  await page.locator('#customer-name').fill('Cliente pendiente'); await page.locator('.price-input').fill('10'); await page.locator('#weight').fill('5');
  await expect(page.locator('#save-status')).toContainText('No se pudo guardar', { timeout: 5000 });
  await expect(page.locator('#app-message')).toBeVisible();
  await expect(page.locator('#customer-name')).toHaveValue('Cliente pendiente');
  await page.locator('#save-quote').click(); await expect(page.locator('#save-status')).toContainText('guardada'); expect(f.records).toHaveLength(1);
  await expect(page.locator('#app-message')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Información guardada correctamente.');
  await expect(page.locator('#toast')).toBeVisible();
});
test('Administrador abre auditoría, usuarios y opera acciones de cuentas', async ({ page }) => {
  const f = await fixture(page, 'admin'); await login(page, 'admin'); await quote(page);
  await page.locator('[data-view="audit"]').click(); await expect(page.locator('#audit-body')).toContainText('Cotización creada');
  await expect(page.locator('#stats-grid')).toContainText('Usuarios activos');
  await expect(page.locator('#seller-report-body')).toContainText('Administrador (admin)');
  await expect(page.locator('#seller-report-body')).toContainText('₡19,500');
  await page.locator('#report-period').selectOption('week');
  await page.getByRole('button', { name: 'Consultar reporte', exact: true }).click();
  await expect(page.locator('#seller-report-body')).toContainText('10/05/2026');
  expect(f.calls.filter(c => c.path === '/rest/v1/rpc/seller_period_report').at(-1).body.p_period).toBe('week');
  await expect(page.locator('#audit-status')).toContainText('1 eventos');
  await page.screenshot({ path: test.info().outputPath('auditoria-escritorio.png'), fullPage: true });
  await page.locator('[data-view="users"]').click(); await expect(page.locator('#users-body')).toContainText('Administrador');
  await page.locator('#user-username').fill('empleado'); await page.locator('#user-display-name').fill('Empleado');
  await page.locator('#user-password').fill('fixture-password-123'); await page.locator('#user-submit').click();
  await expect.poll(() => f.calls.filter(c => c.path === '/functions/v1/admin-users').length).toBe(1);
  expect(f.calls.find(c => c.path === '/functions/v1/admin-users').body.action).toBe('create'); expect(f.errors).toEqual([]);
});
test('Cuenta desactivada pierde el acceso y cierre de sesión borra datos visibles', async ({ page }) => {
  const f = await fixture(page); await page.clock.install(); await login(page); await quote(page);
  f.profile.active = false; await page.clock.fastForward(31000);
  await expect(page.locator('#login-view')).toBeVisible(); await expect(page.locator('#quote-view')).toBeHidden();
  await expect(page.locator('#customer-name')).toHaveValue(''); expect(f.errors).toEqual([]);
});
test('Diseño móvil y contenido del cliente se renderizan como texto seguro', async ({ page }) => {
  const f = await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await quote(page, '<img src=x onerror=alert(1)>'); await page.locator('[data-view="history"]').click();
  await expect(page.locator('#quotes-body')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#quotes-body img').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(f.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('historial-movil.png'), fullPage: true });
});
test('Cerrar sesión oculta módulos y limpia datos del cliente', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  await page.locator('#logout-button').click(); await expect(page.locator('#login-view')).toBeVisible();
  await expect(page.locator('#quote-view')).toBeHidden(); await expect(page.locator('#customer-name')).toHaveValue('');
  expect(f.calls.some(c => c.path === '/rest/v1/rpc/record_session_event' && c.body.p_action === 'logout')).toBe(true);
  expect(f.errors).toEqual([]);
});
test('Editar, cambiar estado, crear copia y exportar CSV usan las operaciones conectadas', async ({ page }) => {
  const f = await fixture(page); await login(page); await quote(page);
  await page.locator('[data-view="history"]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await page.getByRole('button', { name: 'Editar cotización', exact: true }).click();
  await page.locator('#exchange-rate').fill('650');
  await expect(page.locator('#total-crc')).toHaveText('₡20,500');
  await expect(page.locator('#save-status')).toContainText('revisión 2');
  expect(f.records).toHaveLength(1);
  await page.locator('[data-view="history"]').click();
  await page.getByRole('button', { name: 'Ver detalles', exact: true }).click();
  await page.getByRole('combobox', { name: 'Nuevo estado' }).selectOption('sent');
  await page.getByRole('button', { name: 'Cambiar estado', exact: true }).click();
  await expect(page.locator('#quote-detail-content')).toContainText('Enviada');
  await page.getByRole('button', { name: 'Crear copia nueva', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('guardada');
  expect(f.records).toHaveLength(2);
  expect(f.records[0].id).not.toBe(f.records[1].id);
  await page.locator('[data-view="history"]').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#export-quotes').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('cotizaciones.csv');
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv).toContain('María González'); expect(csv).toContain('"₡20,500"');
  expect(csv.split('\r\n')).toHaveLength(3); expect(csv).toContain('COT-00000002');
  expect(f.calls.some(c => c.path === '/rest/v1/rpc/set_quote_status')).toBe(true);
  expect(f.errors).toEqual([]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, dateAndTime, dateRange, csvCell, validateCustomer } from '../src/format.js';

test('Dinero conserva importes grandes sin perder centavos', () => {
  assert.equal(money('99999999999999999999999', '₡', false), '₡999,999,999,999,999,999,999.99');
  assert.equal(money('2100000', '₡', false), '₡21,000');
});
test('Fechas y rangos inclusivos se muestran en Panamá', () => {
  const when = dateAndTime('2026-10-09T04:30:00Z');
  assert.ok(when.date.includes('08')); assert.equal(when.time, '23:30:00');
  assert.deepEqual(dateRange('2026-10-08', '2026-10-08'), { p_from: '2026-10-08T05:00:00.000Z', p_to: '2026-10-09T05:00:00.000Z' });
  assert.throws(() => dateRange('2026-10-09', '2026-10-08'));
});
test('CSV neutraliza fórmulas y escapa comillas', () => {
  assert.equal(csvCell('=HYPERLINK("test")'), '"\'=HYPERLINK(""test"")"');
  assert.equal(csvCell('María, González'), '"María, González"');
});
test('Nombre del cliente exige contenido y admite acentos', () => {
  assert.equal(validateCustomer('  María González  '), 'María González');
  assert.throws(() => validateCustomer(' ')); assert.throws(() => validateCustomer('Cliente\nFalso'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const math = vm.runInNewContext(source.slice(0, source.indexOf('const elements =')) + `\n({parsePrice,parseQuantity,parseWeight,parseExchangeRate,shippingIndex,usd,crc,taxBreakdown,setRate(v){exchangeRateCents=BigInt(v)}})`);
test('Funciones reales del cotizador conservan los resultados comerciales', () => {
  math.setRate('50000');
  assert.equal(math.usd(3500n), '$35.00'); assert.equal(math.crc(3500n), '₡17,500');
  assert.equal(math.crc(8500n), '₡42,500'); assert.equal(math.crc(14000n), '₡70,000');
  math.setRate('60000'); assert.equal(math.crc(3500n), '₡21,000');
  math.setRate('60025'); assert.equal(math.crc(3500n), '₡21,008.75');
});
test('Fronteras de envío y entradas inválidas conservan sus validaciones', () => {
  for (const [weight, rate] of [['0', 0], ['10', 0], ['10.000001', 1], ['20', 1], ['20.000001', 2]]) assert.equal(math.shippingIndex(math.parseWeight(weight).value), rate);
  for (const raw of ['-1', 'abc', '1e3', 'Infinity', '1.001']) assert.ok(math.parsePrice(raw).error);
  for (const raw of ['0', '-1', '1.5', 'abc']) assert.ok(math.parseQuantity(raw).error);
  for (const raw of ['', '0', '-600', '600.123', '1000000.01']) assert.ok(math.parseExchangeRate(raw).error);
  assert.equal(math.parsePrice('0,10').value, 10n); assert.equal(math.parseExchangeRate('600,25').value, 60025n);
  assert.equal(math.taxBreakdown(1500n).grossCents, 1500n); assert.equal(math.taxBreakdown(1500n).ivaCents, null);
});

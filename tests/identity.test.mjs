import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, technicalEmail } from '../supabase/functions/_shared/identity.ts';

test('Usuario se normaliza y genera un identificador técnico sin correo del empleado', () => {
  assert.equal(normalizeUsername('  Erick.Gonzalez  '), 'erick.gonzalez');
  assert.equal(technicalEmail('ERICK'), 'erick@usuarios.cotizador.invalid');
});
test('Nombres ambiguos o incompatibles con el identificador de Auth se rechazan', () => {
  for (const username of ['ab', 'a..b', 'abc.', ' con espacio ', 'ábc', '@admin', 'a'.repeat(33)]) assert.throws(() => normalizeUsername(username));
});

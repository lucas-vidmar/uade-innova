import { test, mock } from 'node:test';
import assert from 'node:assert';

import { logWarn } from './log.js';

// #433: en el host desplegado, llamar a `context.log.warn(...)` deja la
// invocación sin respuesta (o la convierte en 500 cuando la llamada está dentro
// de un try). El logger defensivo no puede depender de ese método.
test('logWarn usa la API v4 (context.warn) cuando existe', () => {
  const warn = mock.fn();
  const log = mock.fn();
  log.warn = mock.fn(() => { throw new Error('context.log.warn no debe usarse'); });

  logWarn({ log, warn }, 'mensaje', { a: 1 });

  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0].arguments, ['mensaje', { a: 1 }]);
  assert.equal(log.mock.callCount(), 0);
});

test('logWarn cae a context.log(...) y nunca llama a context.log.warn', () => {
  const log = mock.fn();
  log.warn = mock.fn(() => { throw new Error('context.log.warn no debe usarse'); });

  logWarn({ log }, 'mensaje');

  assert.equal(log.mock.callCount(), 1);
  assert.equal(log.mock.calls[0].arguments[0], 'mensaje');
  assert.equal(log.warn.mock.callCount(), 0, 'nunca debe tocar context.log.warn (#433)');
});

test('logWarn no lanza cuando el logger del host está roto', () => {
  const log = mock.fn(() => { throw new Error('logger roto'); });
  assert.doesNotThrow(() => logWarn({ log }, 'mensaje'));

  assert.doesNotThrow(() => logWarn({ warn: 'no soy una función', log: undefined }, 'mensaje'));
  assert.doesNotThrow(() => logWarn(undefined, 'mensaje'));
  assert.doesNotThrow(() => logWarn({}, 'mensaje'));
});

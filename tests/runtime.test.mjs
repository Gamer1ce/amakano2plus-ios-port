import test from 'node:test';
import assert from 'node:assert/strict';
import {applySourceBitmapSepia, applyPortMplSepia} from '../runtime/source-bitmap-sepia.js';
import {ownRestoreResource, restoreTransactionFromOptions, restoreTransactionIsActive} from '../runtime/restore-transaction.js';

test('sepia processes pixels while preserving alpha and rejecting incomplete RGBA', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 123, 255, 255, 255, 234]);
  applySourceBitmapSepia(pixels);
  assert.deepEqual([...pixels.slice(0, 4)], [30, 5, 0, 123]);
  assert.equal(pixels[7], 234);
  assert.throws(() => applySourceBitmapSepia(new Uint8Array(3)));
  const port = new Uint8ClampedArray([0, 0, 0, 22]);
  applyPortMplSepia(port);
  assert.deepEqual([...port], [0, 0, 0, 22]);
});

test('restore transaction validates ownership, cancellation and single disposal', () => {
  let active = true, dispose = 0, unregister = 0, cancel;
  const transaction = {
    assertActive() { if (!active) throw new Error('canceled'); },
    resetFromRestore() {},
    registerResource(release) { cancel = release; return () => { unregister++; }; },
  };
  assert.equal(restoreTransactionFromOptions({restoreTransaction: transaction}), transaction);
  ownRestoreResource(transaction, () => { dispose++; });
  cancel(); cancel();
  assert.equal(dispose, 1); assert.equal(unregister, 1);
  active = false;
  assert.equal(restoreTransactionIsActive(transaction), false);
  assert.throws(() => ownRestoreResource(transaction, () => {}));
  assert.throws(() => restoreTransactionFromOptions({restoreTransaction: {}}));
});

import {createNativeStepQuake, sampleNativeStepQuake} from './native-step-quake.js';
import {nativeRoundPosition} from './native-position-motion.js';

const plans = new WeakMap();
const fields = ['version', 'kind', 'stepCount', 'durationFrames', 'steps'];
const fail = message => { throw new TypeError(message); };
const exact = value => value && Object.keys(value).sort().join() === fields.slice().sort().join();
const sourceGroups = new Set(['bg', 'mpl', 'fg', 'pl']);

// The original pure sampler keeps its compiled plan private. The ledger owns
// this frozen, JSON-serializable description and rebuilds that private plan on
// restore. It never serializes or trusts a caller's WeakMap identity.
export function createSerializableNativeStepQuake(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 1000) fail('Explicit bounded quake steps required');
  for (const step of steps) {
    if (!Array.isArray(step) || step.length !== 4) fail('Quake step must contain duration and XYZ');
    for (const value of step) if (typeof value !== 'number' || !Number.isFinite(value)) fail('Invalid quake step value');
  }
  const kernel = createNativeStepQuake(steps);
  const owned = Object.freeze(steps.map(step => Object.freeze(step.map(Math.fround))));
  const plan = Object.freeze({version: 1, kind: 'motQuakeSteps',
    stepCount: kernel.stepCount, durationFrames: kernel.durationFrames, steps: owned});
  plans.set(plan, kernel);
  return plan;
}

export function restoreSerializableNativeStepQuake(saved) {
  if (!exact(saved) || saved.version !== 1 || saved.kind !== 'motQuakeSteps' ||
      !Array.isArray(saved.steps)) fail('Invalid saved native step quake');
  for (const step of saved.steps) {
    if (!Array.isArray(step) || step.length !== 4 ||
        !step.every(value => typeof value === 'number' && Number.isFinite(value) &&
          Math.fround(value) === value)) fail('Non-normalized saved quake step');
  }
  const plan = createSerializableNativeStepQuake(saved.steps);
  if (saved.stepCount !== plan.stepCount || saved.durationFrames !== plan.durationFrames)
    fail('Saved quake duration/count differs from steps');
  return plan;
}

export function sampleSerializableNativeStepQuake(plan, elapsed, options = {}) {
  const kernel = plans.get(plan);
  if (!kernel) fail('Unrecognized serializable native step quake');
  return sampleNativeStepQuake(kernel, elapsed, options);
}

function sourceInteger(token) {
  if (typeof token !== 'string' || !/^[+-]?\d+$/.test(token))
    fail('Quake argument outside source-used signed literal scope');
  const value = Number(token);
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
    fail('Invalid source quake signed integer');
  return value;
}

export function parseSourceStepQuakeParameters(parameters) {
  if (!Array.isArray(parameters) || !parameters.length || parameters.length > 1000)
    fail('Explicit source quake groups required');
  const steps = parameters.map(token => {
    if (typeof token !== 'string') fail('Invalid source quake group');
    const parts = token.split(',');
    if (parts.length !== 3 && parts.length !== 4) fail('Source quake group requires duration, X, Y and optional Z');
    return [...parts.map(sourceInteger), ...(parts.length === 3 ? [0] : [])];
  });
  return createSerializableNativeStepQuake(steps);
}

export const nativeStepQuakeMotionAdapter = Object.freeze({
  kind: 'motQuakeSteps', restore: restoreSerializableNativeStepQuake,
  sample: sampleSerializableNativeStepQuake,
});

// KCS157533 reads and installs bank+124 XYZ for native213, including the
// omitted source Z field. The last native212 write is rounded working Z.
// Literal steps remain fixed displacement; no position subtraction occurs.
export function nativeStepQuakeMotionFactory({layer, operation, parameters, ledger}) {
  if (operation !== 'quake' || !sourceGroups.has(layer?.group))
    fail('Invalid source step quake operation/bank');
  if (!ledger || typeof ledger.working?.z !== 'number') fail('Source quake ledger required');
  const motion = parseSourceStepQuakeParameters(parameters);
  return {motion, tag: 0, calculatorWrite: nativeRoundPosition(ledger.working.z)};
}

// An omitted selector is the original global operation over already-existing
// banks. This hook validates all literal parameters and bank identities before
// R9 appends banks sequentially; it does not provide whole-group rollback.
export function nativeStepQuakeBankSelector({cmd, parts, layers}) {
  if (!['bg', 'mpl', 'fg'].includes(cmd) || !Array.isArray(parts) || parts[0] !== 'quake') return null;
  if (!(layers instanceof Map)) fail('Existing source quake bank map required');
  const parameters = parts.slice(1);
  parseSourceStepQuakeParameters(parameters);
  const bankIds = [];
  for (const [bank, layer] of layers) {
    if (layer?.group !== cmd) continue;
    if (typeof layer.id !== 'string' || !/^\d+$/.test(layer.id) || bank !== `${cmd}:${layer.id}`)
      fail('Invalid existing source quake bank identity');
    bankIds.push(layer.id);
  }
  bankIds.sort((a, b) => Number(a) - Number(b));
  return {operation: 'quake', parameters, bankIds};
}

export const nativeStepQuakeOptions = Object.freeze({
  nativeAdditionalMotionAdapters: Object.freeze([nativeStepQuakeMotionAdapter]),
  nativeAdditionalMotionOperations: Object.freeze(['quake']),
  nativeAdditionalMotionFactory: nativeStepQuakeMotionFactory,
  nativeAdditionalMotionBankSelector: nativeStepQuakeBankSelector,
});

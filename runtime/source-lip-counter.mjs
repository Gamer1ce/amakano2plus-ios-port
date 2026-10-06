// Isolated transcription of cs2.exe SoundTask D8/DC arithmetic and proven writes.
// Caller owns native task gating, physical slot selection, media, and LPB binding.
const UINT32_MAX = 0xffffffff;
const sourceCounters = new WeakSet();

function bits(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${name} must be explicit unsigned 32-bit integer bits`);
  }
  return value;
}

function gates(value) {
  if (!value || typeof value !== 'object') throw new TypeError('source gates are required');
  const result = {};
  for (const key of ['a4', 'a8', 'ac']) result[key] = bits(value[key], key);
  return result;
}

function availability(context, withBase) {
  if (!context || typeof context.backendAvailable !== 'boolean') {
    throw new TypeError('explicit backendAvailable is required');
  }
  if (withBase && typeof context.baseAllowsUpdate !== 'boolean') {
    throw new TypeError('explicit baseAllowsUpdate is required');
  }
}

/** Per physical slot only: aliases and handle-to-slot resolution are external. */
export class SourceLipCounter {
  #d8;
  #dc;
  #gates;

  constructor(sourceSnapshot) {
    if (!sourceSnapshot) throw new TypeError('explicit source field snapshot is required');
    const d8 = bits(sourceSnapshot.d8Bits, 'd8Bits');
    const dc = bits(sourceSnapshot.dcBits, 'dcBits');
    const gateState = gates(sourceSnapshot);
    this.#d8 = d8;
    this.#dc = dc;
    this.#gates = gateState;
    sourceCounters.add(this);
  }

  snapshot() {
    return Object.freeze({ d8Bits: this.#d8, dcBits: this.#dc, ...this.#gates });
  }

  // Successful CE load clears gates and DC; the shown load does not write D8.
  applySuccessfulCeLoad() {
    this.#gates = { a4: 0, a8: 0, ac: 0 };
    this.#dc = 0;
    return this.snapshot();
  }

  // B7 is an actual source play dispatch, not an inferred HTML "playing" event.
  applyMessageB7() {
    this.#gates.a8 = 0;
    this.#gates.ac = 0;
    this.#d8 = UINT32_MAX;
    return this.snapshot();
  }

  // B6 direct/no-fade branch + common tail. No persistent stopped gate is added.
  applyMessageB6Immediate() {
    this.#d8 = 0;
    this.#dc = 0;
    return this.snapshot();
  }

  // B8 retains backend position; B9 resets it. Their immediate counter writes
  // are both empty. This method deliberately does not perform backend control.
  applyImmediateControl(message) {
    if (message !== 0xb8 && message !== 0xb9) {
      throw new RangeError('only proven immediate source messages B8/B9 are supported');
    }
    return this.snapshot();
  }

  // Supply actual native gate state. No fade timer/completion is fabricated.
  applyObservedSourceGates(sourceGates) {
    const next = gates(sourceGates);
    this.#gates = next;
    return this.snapshot();
  }

  advance(shared60Tick, context) {
    const now = bits(shared60Tick, 'shared60Tick');
    availability(context, true);
    if (!context.baseAllowsUpdate || !context.backendAvailable || !this.#eligible()) {
      return Object.freeze({ advanced: false, state: this.snapshot() });
    }
    // Exact x86 low-32-bit SUB/ADD. D8=-1 makes first eligible increment one,
    // even if the root clock is large or several eligible frames were skipped.
    const previous = this.#d8 === UINT32_MAX ? (now - 1) >>> 0 : this.#d8;
    const incrementBits = (now - previous) >>> 0;
    this.#d8 = now;
    this.#dc = (this.#dc + incrementBits) >>> 0;
    return Object.freeze({ advanced: true, incrementBits, state: this.snapshot() });
  }

  readDc(context) {
    availability(context, false);
    // SoundTask Proc's absent backend precheck writes zero before DC dispatch.
    if (!context.backendAvailable) return 0;
    return this.#eligible() ? this.#dc | 0 : -1;
  }

  #eligible() {
    return this.#gates.a4 === 0 && this.#gates.a8 === 0 && this.#gates.ac === 0;
  }
}

/** State immediately after successful CE load followed by actual B7 dispatch. */
export function createLoadedPlayCounter() {
  return new SourceLipCounter({ d8Bits: UINT32_MAX, dcBits: 0, a4: 0, a8: 0, ac: 0 });
}

export function isSourceLipCounter(value) {
  return value !== null && typeof value === 'object' && sourceCounters.has(value);
}

function branded(counter) {
  if (!isSourceLipCounter(counter)) throw new TypeError('an actual branded source lip counter is required');
  return counter;
}

const nativeReadDc = SourceLipCounter.prototype.readDc;
const nativeAdvance = SourceLipCounter.prototype.advance;

export function sourceLipCounterValue(counter, context) {
  return nativeReadDc.call(branded(counter), context);
}

export function sourceLipCounterUpdate(counter, shared60Tick, context) {
  return nativeAdvance.call(branded(counter), shared60Tick, context);
}

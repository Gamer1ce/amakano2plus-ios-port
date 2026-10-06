import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';
import {Renderer as AudioRenderer} from './native-audio.js';

// The original configured prefixes drive registration only after installation.
// The shared commit hook covers both ordinary composite loads and old saves.
export class Renderer extends AudioRenderer {
  constructor(options){super(options);this.cgRegistry=options.cgRegistry}
  async image(layer,...args){const transaction=restoreTransactionFromOptions(args[2]);assertRestoreActive(transaction);await super.image(layer,...args);assertRestoreActive(transaction);this.cgRegistry?.registerImage(layer.asset)}
  commitComposite(layer,prepared){super.commitComposite(layer,prepared);this.cgRegistry?.registerImage(layer.asset)}
}

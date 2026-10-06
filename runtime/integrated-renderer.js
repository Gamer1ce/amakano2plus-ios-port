import {withSourceUsedPlaneRotation} from './source-used-plane-rotation.js';
import {withSourcePlaneImageMasks} from './source-plane-image-masks.js';
import {withSourceCaptureEffects} from './source-capture-effects.js';
import {withSourceBmode} from './source-bmode-renderer.js';
import {withSourceBitmapSepia} from './source-bitmap-sepia.js';
import {withSourcePlaceTask} from './source-place-task.js';
import {withSourceNeutralGlobalControls} from './source-neutral-global-controls.js';
import {withSourceMoviePolicy} from './source-movie-policy.js';
import {withNativePositionMotions} from './native-motion-renderer.js';
import {withPortNativeMotionOwner} from './port-native-motion-owner.js';
import {withPortPlaneZProjection} from './port-plane-z-projection.js';
import {withSourceCharacterPerformance} from './source-character-performance.js';
import {withAutomaticSourceVoicePerformance} from './source-auto-character-performance.js';
import {withSourceBitmapImageAnimations} from './source-bitmap-image-animations.js';
import {withPortMovieLifecycle} from './port-movie-lifecycle.js';
import {restoreTransactionFromOptions,assertRestoreActive} from './restore-transaction.js';
import {Renderer as ExtraRenderer} from './extra-mode-renderer.js';
import {withNativeCharacterTransforms} from './character-transforms.js';
import {withNativeTransitions} from './native-transition-renderer.js';
import {NativeMessageWindow,validateMessageWindowState,messageScenePaintPriority} from './native-message-window.js';
import {withSourceNeutralResets} from './source-neutral-reset.js';
import {awaitSourceRestore} from './source-performance-restore-coordinator.js';

// Preserve the native transform/transition chain and source bank/save priorities.
// Only the exact full-scene OLD bitmap gains the separate message color presentation.
const SceneRenderer=withPortMovieLifecycle(withSourceNeutralResets(withSourceCaptureEffects(withNativeTransitions(withNativeCharacterTransforms(ExtraRenderer)))));
export class InternalIntegratedRenderer extends SceneRenderer {
  constructor(options){super(options);this.messageWindow=new NativeMessageWindow(this,{onSystemState:options.onSystemState});}
  scenePaintPriority(layer){return messageScenePaintPriority(layer);}
  scenePresentationLayers(){return this.messageWindow?.presentationLayers()??[];}
  place(layer){super.place(layer);if(layer.element)layer.element.style.zIndex=String(this.scenePaintPriority(layer));}
  initializeMessageWindow(){return this.messageWindow.initialize();}
  async command(cmd,args,state,commandLocation){
    if(cmd==='initialize_header')this.messageWindow.clearText();
    if(cmd==='view')return this.messageWindow.view(args,state);
    if(cmd==='sysbtn')return this.messageWindow.system(args,state);
    if(cmd==='keyskip')return this.messageWindow.keyskip(args);
    if(cmd==='frameon'||cmd==='frameoff')return this.messageWindow.frame(cmd,args,state);
    return super.command(cmd,args,state,commandLocation);
  }
  reset(){this.messageWindow?.reset();return super.reset();}
  snapshot(){return {...super.snapshot(),messageWindow:this.messageWindow.snapshot()};}
  validateSave(saved){const data=super.validateSave(saved);validateMessageWindowState(data.messageWindow);return data;}
  async restore(saved,...rest){const transaction=restoreTransactionFromOptions(rest[0]);assertRestoreActive(transaction);const data=this.validateSave(saved,...rest),message=validateMessageWindowState(data.messageWindow);await awaitSourceRestore(transaction,()=>this.messageWindow.prepareTheme(message.theme,...rest));assertRestoreActive(transaction);await awaitSourceRestore(transaction,()=>super.restore(data,...rest));assertRestoreActive(transaction);await awaitSourceRestore(transaction,()=>this.messageWindow.restore(message,...rest));assertRestoreActive(transaction);}
}

const PerformanceRenderer=withSourceMoviePolicy(withSourceBitmapImageAnimations(withAutomaticSourceVoicePerformance(withSourceCharacterPerformance(InternalIntegratedRenderer))));
export const Renderer=withSourceUsedPlaneRotation(withSourceBmode(withSourcePlaneImageMasks(withSourcePlaceTask(withSourceBitmapSepia(withSourceNeutralGlobalControls(withPortPlaneZProjection(withPortNativeMotionOwner(withNativePositionMotions(PerformanceRenderer)))))))));

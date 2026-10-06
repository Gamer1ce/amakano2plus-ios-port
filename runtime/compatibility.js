// Portable compatibility decisions inferred from the supplied source files.
// These are not official CatSystem2 command definitions. Match each correction
// to its scene, zero-based source line index, and complete original command
// after trimming outer whitespace. No general typo/asset/bank aliases apply.
const blackTypoReason='The JP/base and Chinese-patch commands match. bgbalck is absent from the full catalog; bgblack.hg3 is present. The transposed spelling correction is inferred.';
export const SOURCE_CORRECTIONS = Object.freeze([
  {scene:'01_yu08',index:1423,source:'mp',replacement:'mpl',
    reason:'The JP/base and Chinese-patch command sequences both contain a lone mp followed by mpl and other layer resets. mpl is an inferred spelling correction.'},
  {scene:'04_sa10',index:1374,source:'wai',replacement:'wait',
    reason:'The JP/base and Chinese-patch command sequences both place a lone wai directly after rdraw 20. wait is an inferred spelling correction.'},
  {scene:'sw_06_sa06_5_007_c',index:104,source:'wait120',replacement:'wait 120',
    reason:'The JP/base and Chinese-patch command bytes match and contain wait120 at index 104, with ordinary wait and wait 90 commands nearby. The missing space is inferred.'},
  ...[['02_ch10',1434],['02_ch10',1651],['03_re25',1914],['sw_01_yu12_001_c',1189],['sw_01_yu12_001_c',2032],['sw_01_yu22_001_c',952]].map(([scene,index])=>
    ({scene,index,source:'bg 0 bgbalck',replacement:'bg 0 bgblack',reason:blackTypoReason})),
  {scene:'04_sa15',index:866,source:'se o end 60',replacement:'se 0 end 60',
    reason:'Both supplied source versions use the lone letter o as a sound bank here. Bank zero is inferred from the numeric bank command syntax; this is not a general letter-to-number conversion.'},
  {scene:'02_ch29',index:133,source:'bg 1 pos o -465',replacement:'bg 1 pos 0 -465',
    reason:'Both supplied source versions use the lone letter o as the x coordinate here. Zero is inferred from the numeric coordinate command syntax.'},
  {scene:'03_re30',index:37,source:'bg 0 black',replacement:'bg 0 bgblack',
    reason:'Both supplied source versions match. black is absent from the full catalog while bgblack.hg3 is present. This is a source-scoped resource-name inference, not an official alias.'},
  {scene:'05_sa01_b',index:23,source:'mpl e stsara02l,$str303,0,0,0,0,$str306,1,k,$str339,$str317,$str311,$str312:0',replacement:'mpl 2 stsara02l,$str303,0,0,0,0,$str306,1,k,$str339,$str317,$str311,$str312:0',
    reason:'Both supplied source versions match. The same scene places Sara in bank 2 at index 75, with other characters in distinct banks. e-to-2 is an inferred same-character bank correction.'},
  {scene:'06_sa06_5',index:1815,source:'mpl g stchit01l,$str303,$str306,1,0,$str307,g,0,0,$str313:0',replacement:'mpl 3 stchit01l,$str303,$str306,1,0,$str307,g,0,0,$str313:0',
    reason:'Both supplied source versions match. Index 1835 reloads stchit01l in bank 3 and index 1844 animates bank 3. g-to-3 is an inferred same-character bank correction.'},
  {scene:'mapselect_main_main',index:47,source:'bg bg_black',replacement:'bg $ff000000',
    reason:'The base scene refers to the mapselect FES CIMAGE object bg_black, defined as 0xff000000 at 1600x900. Reconstruct that exact opaque black color using the portable renderer color operation. No image file or general underscore alias is substituted.'},
]);

export function sourceCorrection(source,location) {
  return SOURCE_CORRECTIONS.find(row=>row.scene===location?.scene&&row.index===location.index&&row.source===source);
}

export const RECONSTRUCTED_FES = Object.freeze({
  mapselect:{evidence:['mapselect/start','mapselect/set_heroine','mapselect/btn_heroin.push_l','mapselect/go_kokuhaku'],
    scope:'The supplied FES enables heroine[0] on map visits 1, 2 and 3, sets #128=0 for that button and #128=10 for confession. A text choice replaces the map UI.'},
  mapselect_kokuhaku:{evidence:['mapselect_kokuhaku/go_yes','mapselect_kokuhaku/go_no'],
    scope:'The supplied FES sets #384=1 for yes and #384=0 for no. A text choice replaces the original confirmation UI.'},
});

function requireLine(helpers,helper,section,line) {
  if(!helpers[helper]?.sections?.[section]?.includes(line))throw new Error(`FES selection evidence changed: ${helper}/${section}`);
}

export function fesChoices(helper,args,state,helpers,scene) {
  if(helper==='mapselect'&&args.length===0) {
    requireLine(helpers,helper,'start','$128 = -1');
    requireLine(helpers,helper,'btn_heroin.push_l','$128 = @');
    requireLine(helpers,helper,'go_kokuhaku','$128 = 10');
    const visits=state.numbers[129]??0,choices=[];
    // set_heroine leaves heroine[1] and heroine[2] at NONE. The school
    // button only switches map view and does not return from the selection.
    for(const [visit,place] of [[1,'ICHIBA'],[2,'TOWN'],[3,'NAKANIWA']]) {
      requireLine(helpers,helper,'set_heroine',`if ($129==${visit})`);
      requireLine(helpers,helper,'set_heroine',`\\l_HEROIN01_POS = ${place}`);
      if(visits===visit)choices.push({id:0,scene,text:'去见咲来',kind:'fes',helper,numbers:{128:0}});
    }
    choices.push({id:10,scene,text:'向咲来告白',kind:'fes',helper,numbers:{128:10}});
    return choices;
  }
  if(helper==='mapselect_kokuhaku'&&args.length===1&&args[0]==='384') {
    requireLine(helpers,helper,'start','$384 = -1');
    requireLine(helpers,helper,'go_yes','$384 = 1');
    requireLine(helpers,helper,'go_no','$384 = 0');
    return [{id:1,scene,text:'是',kind:'fes',helper,numbers:{384:1}},
      {id:0,scene,text:'否',kind:'fes',helper,numbers:{384:0}}];
  }
  throw new Error(`Unsupported FES selection ${helper} ${args.join(' ')}`);
}

// Isolated candidate. The rules below are checked against actual original FES.
const require = (condition, message) => { if (!condition) throw new Error(message); };
const line = (helpers, name, section, value) => require(helpers[name]?.sections?.[section]?.includes(value), `Original extra-mode rule changed: ${name}/${section}: ${value}`);
const flag = (numbers, index) => {
  const value = numbers?.[index] ?? 0;
  require(typeof value === 'number' && Number.isFinite(value), `Invalid extra-mode flag ${index}`);
  return value;
};
export const EXTRA_CHARACTERS = Object.freeze(['结灯', '玲', '千岁', '咲来']);

export function createReplayCatalog(helpers, assets, manifest) {
  const replay = helpers.ex_replaymode;
  require(replay && replay.macros.g_KAISOU === 900 && replay.macros.g_SSCRIPT_BOOT_TYPE === 512 && replay.macros.g_SSCRIPT_START_FILENAME === 200, 'Original replay macro indices changed');
  const counts = ['A', 'B', 'C', 'D'].map(char => replay.macros[`CHAR_${char}_COUNT`]);
  require(JSON.stringify(counts) === '[6,6,7,7]', 'Original replay group counts changed');
  line(helpers, 'title', 'enable_button', 'if ($g_CLEAR_FLG==0&&$g_TRIAL==0)');
  line(helpers, 'title', 'enable_button', 'btn[3] enable 0');
  require(helpers.title.macros.g_CLEAR_FLG === 999 && helpers.title.macros.g_TRIAL === 874, 'Original extra-menu gate indices changed');
  line(helpers, 'ex_replaymode', 'start', '\\14 = 4');
  line(helpers, 'ex_replaymode', 'replaylist_check', 'if ($(901+\\13)!=0)');
  line(helpers, 'ex_replaymode', 'replaylist_check', 'if ($(901+\\13+3)!=0)');
  line(helpers, 'ex_replaymode', 'wait', '$900 = \\15 + \\13 + 1');
  line(helpers, 'ex_replaymode', 'wait', '$g_SCENE_CHAR_NO = \\5');
  line(helpers, 'ex_replaymode', 'wait', '$g_SCENE_PAGE_NO = \\12');
  line(helpers, 'ex_replaymode', 'outer_wait', 'exit 20');
  line(helpers, 'flow2', 'extra_wait', 'if (_EXITCODE_==20)');
  line(helpers, 'flow2', 'extra_wait', '$g_SSCRIPT_BOOT_TYPE = -2');
  const commands = replay.sections.replay_cst_set;
  const entries = [];
  for (let id = 1, group = 0, groupStart = 1; id <= 26; id++) {
    while (id >= groupStart + counts[group]) { groupStart += counts[group++]; }
    const start = commands.indexOf(`if ($900==${id})`);
    const match = /^strvar 200 ([A-Z0-9_]+)$/.exec(commands[start + 1] ?? '');
    require(start >= 0 && match && commands[start + 2] === 'endif', `Original replay dispatch missing: ${id}`);
    const scene = match[1].toLowerCase();
    require(manifest.scenes?.[scene] && typeof manifest.scenes[scene].file === 'string', `Replay scene unavailable: ${scene}`);
    const offset = id - groupStart;
    const frames = assets.ex_replaymode_thumbnail?.frames;
    require(assets.ex_replaymode_thumbnail?.kind === 'image', 'Original replay thumbnail asset unavailable');
    const thumbnail = frames.find(frame => frame.id === id - 1);
    const lockedThumbnail = frames.find(frame => frame.id === 999);
    require(thumbnail && lockedThumbnail, `Original replay thumbnail unavailable: ${id}`);
    entries.push(Object.freeze({id, scene, flag:900 + id, group, character:EXTRA_CHARACTERS[group], ordinal:offset + 1, page:Math.floor(offset / 4), slot:offset % 4, thumbnail, lockedThumbnail}));
  }
  require(commands.filter(command => /^strvar 200 /.test(command)).length === 26, 'Unexpected original replay dispatch count');
  return Object.freeze(entries);
}

// This optional port preference changes access only; source progress stays intact.
export function validateExtraUnlockAll(value) { require(typeof value === 'boolean', 'Invalid extra-mode unlock preference'); return value; }
export function extraMenuEnabled(numbers, {unlockAll = false} = {}) { validateExtraUnlockAll(unlockAll); return !(flag(numbers,999) === 0 && flag(numbers,874) === 0) || unlockAll; }
export function replayPage(catalog, numbers, group, page, {unlockAll = false} = {}) {
  validateExtraUnlockAll(unlockAll);
  require(Number.isInteger(group) && group >= 0 && group < 4 && Number.isInteger(page) && page >= 0 && page <= 1, 'Invalid replay page');
  return catalog.filter(entry => entry.group === group && entry.page === page).map(entry => ({...entry, unlocked:flag(numbers,entry.flag) !== 0 || unlockAll}));
}
export function replayLaunch(catalog, numbers, replayId, strings = {}, {unlockAll = false} = {}) {
  validateExtraUnlockAll(unlockAll);
  require(extraMenuEnabled(numbers,{unlockAll}), 'Original extra menu is locked');
  const entry = catalog.find(value => value.id === replayId);
  require(entry, `Unknown replay ${replayId}`);
  require(flag(numbers,entry.flag) !== 0 || unlockAll, `Replay ${replayId} is locked`);
  // Preserve global choices and remembered source page, select the native boot
  // mode once. Do not call story initializers or set any unlock flag.
  return {id:entry.scene, mode:'replay', initial:{numbers:{...numbers,512:-2,900:entry.id,720:entry.page,721:entry.group}, strings:{...strings,200:entry.scene}}};
}

export function selectCGTable(numbers) {
  return flag(numbers,530) === 1 ? (flag(numbers,532) === 1 ? 'cglist_i.dat' : 'cglist_l.dat') : (flag(numbers,532) === 1 ? 'cglist_n.dat' : 'cglist_o.dat');
}
// The original catalog is useful without making an unsupported unlock claim.
// cgreg_t, cgflag and savegen.dat registration semantics remain a separate gate.
export function galleryCatalog(cgLists, numbers) {
  const filename = selectCGTable(numbers), groups = cgLists[filename]?.groups;
  require(Array.isArray(groups) && groups.length === 98, `Original CG list unavailable: ${filename}`);
  return groups;
}

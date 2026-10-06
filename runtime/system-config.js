// Verified read-only original configuration. No engine variable defaults are guessed.
export const SYSTEM_CONFIG=Object.freeze({
  sysflag:Object.freeze({"boot": 512, "kaisou": 900}),
  sysstr:Object.freeze({"boot": 200}),
});
export const GLOBAL_FLAG_RANGE=Object.freeze({"start": 512, "count": 512});
export const STORY_BOOT_VALUE=-1;
// Current modern replay registration IDs observed in the supplied H_END scripts.
export const REPLAY_UNLOCK_FLAGS=Object.freeze([901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 911, 912, 913, 914, 915, 916, 917, 918, 919, 920, 921, 922, 923, 924, 925, 926]);
export const SYSTEM_CONFIG_PROVENANCE=Object.freeze({
  "adv": {
    "archive": "config.int",
    "entry": "adv.xml",
    "sha256": "efd71a04aa1394cb9c3817e43358a5cc35935b387e284a5ec45ea5211486d058"
  },
  "startup": {
    "file": "config/startup.xml",
    "sha256": "7b9faf7fc82af426c339fbbdb16ec5fdd6527fa9e0a2defa27851431c15b86fb",
    "element": "GAME/flag/global0"
  },
  "storyBoot": {
    "archive": "fes.int",
    "entry": "flow2.fes",
    "sha256": "f51aaf074e7bc374628499244b434e3cf7c4b9ba35b46a6ee1a019c11cb71fb0",
    "sourceLines": [
      643,
      665
    ],
    "command": "$g_SSCRIPT_BOOT_TYPE = -1"
  },
  "replayUnlocks": {
    "source": "Existing compiled Content modern H_END command excerpts",
    "count": 26,
    "flagIds": [
      901,
      902,
      903,
      904,
      905,
      906,
      907,
      908,
      909,
      910,
      911,
      912,
      913,
      914,
      915,
      916,
      917,
      918,
      919,
      920,
      921,
      922,
      923,
      924,
      925,
      926
    ],
    "note": "Exact observed end_of_kaisou n commands; no generic CG or global-variable interpretation."
  },
  "embeddedChineseStartup": {
    "file": "checks/原版复核/chsconfig-extracted/config/startup.xml",
    "bytes": 32524,
    "sha256": "8a00e9105ec8494682856b936026866a147ed53ad4a1cac865192324b170b9d1",
    "element": "GAME/flag/global0",
    "range": {
      "start": 512,
      "count": 512
    },
    "archive": "chsconfig.int",
    "entry": "config/startup.xml",
    "globalRangeMatchesLooseStartup": true
  }
});

export function storyInitialNumbers(globals={}) {
  return {...globals,[SYSTEM_CONFIG.sysflag.boot]:STORY_BOOT_VALUE};
}

// Original flow/start executes before flow2. These fixed coordinates are
// assigned on process startup even when the global progress file exists.
// Source proof: native-original-opening-numeric-evidence.json.
const FLOW_START_NUMBERS=Object.freeze({
  570:800,571:550,572:1050,573:430,574:1170,575:280,576:645,577:955,578:1320,
  580:413,581:280,590:-360,591:-178,592:-288,593:-311,594:-1498,595:-576,
  803:15,874:0
});
const FIRST_LAUNCH_NUMBERS=Object.freeze({
  840:1,841:1,842:1,843:1,844:1,845:1,846:1,847:1,848:1,
  532:1,837:1,838:0,839:1
});
export const NATIVE_STARTUP_PROVENANCE=Object.freeze({
  evidence:'native-original-opening-numeric-evidence.json',
  evidenceSHA256:'4b5ac66b73dc13a1a6758b31b0a2b13769fa0759df049a95e74745d01aea1ad8',
  flowSHA256:'469d2c4986d9edae77fae44406e9bb56e6bb92c4bd74f4c7ca7d030dbb01476c',
  flow2SHA256:'f51aaf074e7bc374628499244b434e3cf7c4b9ba35b46a6ee1a019c11cb71fb0',
  patchedTitleSHA256:'5d1d506c9d55fbff9db47d54b23e00b20828e45e315a4165961878a87862d6ef',
  trialArchiveEntryAbsent:true,
});
export function nativeStartupNumbers(globals={}) {
  if(!globals||typeof globals!=='object'||Array.isArray(globals)||Object.entries(globals).some(([key,value])=>!/^\d+$/.test(key)||typeof value!=='number'||!Number.isFinite(value)))throw new Error('Invalid native startup globals');
  const numbers={...globals,...FLOW_START_NUMBERS};
  // The original first-launch block is guarded by boot-count849 == 0.
  // Existing preferences survive after the original setup has completed.
  if((numbers[849]??0)===0)Object.assign(numbers,FIRST_LAUNCH_NUMBERS);
  numbers[1020]=0;numbers[540]=0;
  // The supplied Chinese title defaults only a zero patch selector to1.
  if((numbers[724]??0)===0)numbers[724]=1;
  // Do not mark setup complete here: the original sets849=1 only after its
  // name/birthday/heroine dialogs have returned. Those dialogs are separate.
  return numbers;
}
export function replayInitialNumbers(globals={}) {
  return {...globals,[SYSTEM_CONFIG.sysflag.boot]:-2};
}

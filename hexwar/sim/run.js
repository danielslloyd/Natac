#!/usr/bin/env node
// hexwar/sim/run.js
// Headless simulation runner — the harness you'd wrap for AI training.
//
//   node hexwar/sim/run.js --variant civ --agents heuristic,random --matches 20
//   node hexwar/sim/run.js --variant hexiso --options rangeMode=los --seed 42
//   node hexwar/sim/run.js --variant all --matches 5
//
// Flags:
//   --variant  stretch|hexiso|civ|rift|surge|all   (default civ)
//   --agents   comma list of agent names per player (default heuristic,heuristic)
//   --matches  N games, seeds seed..seed+N-1        (default 1)
//   --seed     base seed                            (default 1)
//   --options  k=v[,k=v...] merged into game options (numbers auto-parsed)
//   --verbose  print the game log of each match

import { createGame, RULESETS } from '../games/index.js';
import { AGENTS, runMatch } from '../ai/agents.js';

function parseArgs(argv) {
  const args = { variant: 'civ', agents: 'heuristic,heuristic', matches: 1, seed: 1, options: '', verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'verbose') { args.verbose = true; continue; }
    args[key] = argv[++i];
  }
  args.matches = Number(args.matches);
  args.seed = Number(args.seed);
  return args;
}

function parseOptions(str) {
  const out = {};
  if (!str) return out;
  for (const pair of str.split(',')) {
    const [k, v] = pair.split('=');
    out[k] = isNaN(Number(v)) ? v : Number(v);
  }
  return out;
}

const args = parseArgs(process.argv);
const variants = args.variant === 'all' ? Object.keys(RULESETS) : [args.variant];
const agentNames = args.agents.split(',');
const options = parseOptions(args.options);

for (const variant of variants) {
  const wins = {};
  let totalRounds = 0;
  const t0 = Date.now();

  for (let m = 0; m < args.matches; m++) {
    const seed = args.seed + m;
    const game = createGame({ variant, seed, players: agentNames.length, options });
    const agents = agentNames.map((name, i) => {
      const make = AGENTS[name];
      if (!make) throw new Error(`unknown agent "${name}" (have: ${Object.keys(AGENTS).join(', ')})`);
      return make(seed * 10 + i);
    });
    const result = runMatch(game, agents);
    const label = result.winner === 'draw' ? 'draw' : `P${result.winner + 1}:${agentNames[result.winner]}`;
    wins[label] = (wins[label] || 0) + 1;
    totalRounds += result.rounds;

    console.log(
      `[${variant}] seed=${seed} winner=${label} rounds=${result.rounds} ` +
      `scores=${result.scores.join('/')} unitsLeft=${result.unitsLeft.join('/')}`
    );
    if (args.verbose) {
      for (const line of result.log) console.log('   ', line);
    }
  }

  if (args.matches > 1) {
    const ms = Date.now() - t0;
    console.log(`\n[${variant}] summary over ${args.matches} matches ` +
      `(avg ${(totalRounds / args.matches).toFixed(1)} rounds, ${ms}ms total):`);
    for (const [who, n] of Object.entries(wins).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${who}: ${n}`);
    }
    console.log('');
  }
}

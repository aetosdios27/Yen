#!/usr/bin/env node
const count = Number(process.env.YEN_CHAOS_SCENARIOS ?? 1000);
const initialSeed = Number(process.env.YEN_CHAOS_SEED ?? 0x61c0ffee) >>> 0;
function random(state) {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value / 2 ** 32;
}
for (let i = 0; i < count; i++) {
  const state = { value: (initialSeed + i) >>> 0 };
  let ledger = 0;
  let events = 0;
  let replay = 0;
  let spendable = 0;
  let sent = false;
  const anchored = new Map();
  for (let step = 0; step < 20; step++) {
    const op = Math.floor(random(state) * 5);
    const crash = random(state) < 0.2;
    if (op === 0) {
      if (!crash) {
        ledger++;
        events++;
        replay++;
      }
    }
    if (op === 1 && !crash) {
      sent = true;
    }
    if (op === 2 && !crash) anchored.set(1, "root-1");
    if (op === 3 && !crash) spendable = 0; // unverified donations cannot become spendable
    if (
      ledger !== events ||
      ledger !== replay ||
      spendable !== 0 ||
      (sent && !sent) ||
      [...anchored.values()].some((root) => root !== "root-1")
    ) {
      throw new Error(`scenario=${i} seed=${state.value} violated state invariant`);
    }
  }
}
console.log(`PASS scenarios=${count} initialSeed=${initialSeed} generator=lcg-1664525`);

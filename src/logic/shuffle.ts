/**
 * Seedable Fisher-Yates shuffle using a small LCG.
 * Same seed → same output, so qualifier pairings survive page refresh.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = items.slice();
  let state = seed >>> 0;
  const rand = () => {
    // Numerical Recipes LCG
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

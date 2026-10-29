import { beforeEach, describe, expect, it } from 'vitest';
import { SPECS } from '../src/classes';
import { bindable, bindKey, loadLayout, saveLayout, swapSlots } from '../src/game/layout';

const shadowPriest = SPECS.find((s) => s.key === 'shadow-priest')!;

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
});

const all = new Set(shadowPriest.bar.map((b) => b.key));
const SWP = 'spell:10894', MB = 'spell:10947', MF = 'spell:18807';

describe('action bar layout', () => {
  it('gives the class bar its default keys, leaving out spells the character lacks', () => {
    const slots = loadLayout(shadowPriest, new Set([SWP, MB, MF]));
    expect(slots.map((s) => [s.key, s.hotkey])).toEqual([[SWP, '1'], [MB, '2'], [MF, '3']]);
  });

  it('swaps two spells, the keys staying with the places', () => {
    const slots = swapSlots(loadLayout(shadowPriest, all), 0, 2);
    expect(slots[0]).toMatchObject({ key: MF, hotkey: '1' });
    expect(slots[2]).toMatchObject({ key: SWP, hotkey: '3' });
  });

  it('moves a key from another spell instead of binding it twice', () => {
    const slots = bindKey(loadLayout(shadowPriest, all), 0, '2');
    expect(slots[0]).toMatchObject({ key: SWP, hotkey: '2' });
    expect(slots[1]).toMatchObject({ key: MB, hotkey: '1' });
  });

  it('remembers order and keys', () => {
    let slots = swapSlots(loadLayout(shadowPriest, all), 0, 1);
    slots = bindKey(slots, 2, 'x');
    saveLayout(shadowPriest, slots);
    const again = loadLayout(shadowPriest, all);
    expect(again.slice(0, 3).map((s) => [s.key, s.hotkey])).toEqual([[MB, '1'], [SWP, '2'], [MF, 'x']]);
  });

  it('keeps the game\'s own keys free', () => {
    expect(bindable(' ')).toBe(false);
    expect(bindable('Tab')).toBe(false);
    expect(bindable('F2')).toBe(false);
    expect(bindable('x')).toBe(true);
    expect(bindable('F5')).toBe(true);
  });
});

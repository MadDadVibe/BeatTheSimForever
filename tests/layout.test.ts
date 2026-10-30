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
    expect(slots.slice(0, 3).map((s) => [s.key, s.hotkey])).toEqual([[SWP, '1'], [MB, '2'], [MF, '3']]);
    expect(slots.length).toBe(16); // both rows, the other places empty
    expect(slots.slice(3).every((s) => s.key === '')).toBe(true);
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

describe('two-row action bar', () => {
  it('puts 1 to 8 on the bottom row and Q E R F C X Y T on the one above', () => {
    const keys = loadLayout(shadowPriest, all).map((s) => s.hotkey);
    expect(keys.slice(0, 8)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(keys.slice(8)).toEqual(['q', 'e', 'r', 'f', 'c', 'x', 'y', 't']);
  });

  it('moves a spell to an empty place, say from 2 to F, and remembers it', () => {
    const few = new Set([SWP, MB, MF]);
    const slots = swapSlots(loadLayout(shadowPriest, few), 1, 11);
    expect(slots[1].key).toBe('');
    expect(slots[11]).toMatchObject({ key: MB, hotkey: 'f' });
    saveLayout(shadowPriest, slots);
    expect(loadLayout(shadowPriest, few)[11]).toMatchObject({ key: MB, hotkey: 'f' });
    expect(loadLayout(shadowPriest, few)[1].key).toBe('');
  });

  it('keeps the place of a spell this character lacks', () => {
    const slots = swapSlots(loadLayout(shadowPriest, all), 0, 15); // SW:P to T
    saveLayout(shadowPriest, slots);
    const without = loadLayout(shadowPriest, new Set([MB, MF]));
    expect(without[15].key).toBe('');
    saveLayout(shadowPriest, without);
    expect(loadLayout(shadowPriest, all)[15].key).toBe(SWP);
  });

  it('keeps the order of a bar saved before, with the new keys', () => {
    store.set('bar:shadow-priest', JSON.stringify({ order: [MF, SWP], keys: { [MF]: '9', [SWP]: '0' } }));
    const slots = loadLayout(shadowPriest, all);
    expect(slots.slice(0, 2).map((s) => [s.key, s.hotkey])).toEqual([[MF, '1'], [SWP, '2']]);
  });
});

import type { SimProfile } from './types';

/** The setup's switches, which change the profile the same way for you and for the sim. */
export interface SetupOptions {
  potions: boolean;
  /** Demonic Rune, Thistle Tea and the like. */
  conjured: boolean;
  explosives: boolean;
  /** The buffs the rest of the raid gives (Fortitude, Mark of the Wild, blessings, other shamans' totems …). */
  raidBuffs: boolean;
  /** The debuffs the rest of the raid keeps on the bosses (Sunder Armor, Curse of Elements …). */
  raidDebuffs: boolean;
  /** A shaman's weapon imbue (WindfuryImbue …), for a spec that picks one. */
  imbue?: string;
}

/** The profile's consumes each consumable switch stands for. */
export const CONSUMABLES = {
  potions: ['defaultPotion'],
  conjured: ['defaultConjured'],
  explosives: ['fillerExplosive', 'sapperExplosive'],
} as const;

/**
 * The profile with the switches applied: what is switched off is taken out, so neither you nor the sim has it. The
 * Tier 1 set bonuses are always off: the sim's values for them are placeholders.
 */
export function withOptions(base: SimProfile, options: SetupOptions): SimProfile {
  const consumes = { ...(base.player.consumes as Record<string, unknown> | undefined) };
  for (const [name, keys] of Object.entries(CONSUMABLES)) if (!options[name as keyof typeof CONSUMABLES]) keys.forEach((k) => delete consumes[k]);
  const player: SimProfile['player'] = { ...base.player, consumes, foreverTier1Bonuses: false };
  if (!options.raidBuffs) player.buffs = {};
  const enh = base.player.enhancementShaman as { options?: Record<string, unknown> } | undefined;
  if (enh && options.imbue) player.enhancementShaman = { ...enh, options: { ...enh.options, mainHandImbue: options.imbue } };
  return {
    ...base,
    player,
    raidBuffs: options.raidBuffs ? base.raidBuffs : {},
    partyBuffs: options.raidBuffs ? base.partyBuffs : {},
    debuffs: options.raidDebuffs ? base.debuffs : {},
  };
}

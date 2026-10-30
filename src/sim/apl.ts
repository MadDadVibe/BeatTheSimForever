import type { AplRotation } from './types';

// The rotation editor can save named values ("valueVariables") and groups; this sim version does not read them.
// Every {variableRef: {name}} is replaced by the value it names, and hidden entries are dropped, so the rotation
// means exactly what it did in the editor.
export function normalizeApl(rotation: AplRotation): AplRotation {
  const vars = new Map<string, unknown>();
  for (const v of (rotation.valueVariables as Array<{ name: string; value: unknown }> | undefined) ?? []) vars.set(v.name, v.value);

  const resolve = (node: unknown, seen: string[]): unknown => {
    if (Array.isArray(node)) return node.map((n) => resolve(n, seen));
    if (node && typeof node === 'object') {
      const ref = (node as { variableRef?: { name: string } }).variableRef;
      if (ref) {
        if (seen.includes(ref.name)) throw new Error(`Rotation variable "${ref.name}" refers to itself`);
        if (!vars.has(ref.name)) throw new Error(`Rotation uses unknown variable "${ref.name}"`);
        return resolve(vars.get(ref.name), [...seen, ref.name]);
      }
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v, seen)]));
    }
    return node;
  };

  const { valueVariables: _v, groups: _g, ...rest } = rotation;
  const out = resolve(rest, []) as AplRotation;
  out.priorityList = (out.priorityList ?? []).filter((item) => !(item as { hide?: boolean }).hide);
  return out;
}

/** Accepts a whole exported character ({player: {rotation}}) or just its rotation. */
export function rotationFromExport(json: unknown): AplRotation {
  const obj = json as { player?: { rotation?: AplRotation }; rotation?: AplRotation } & AplRotation;
  const rotation = obj.player?.rotation ?? obj.rotation ?? obj;
  if (!rotation || !Array.isArray(rotation.priorityList)) throw new Error('No rotation (priorityList) found in this file');
  return rotation;
}

type Node = Record<string, any>;
const MAX_DOTS = 3;

/**
 * The rotation with its DoTs kept up on every boss. The sim's rotations are written for one boss: they cast a DoT
 * when it is missing (or about to run out) on the boss in front of you, and so never put it on the others. Each
 * such entry ("cast X if X's DoT is not up / runs out within t", plus any other conditions) becomes the sim's
 * multi-DoT action, which casts X on the first boss without it (or with less than t left). With one boss it is the
 * same rotation. Entries that need combo points (a rogue's Rupture) stay as they are: those sit on one boss.
 */
export function withMultidot(rotation: AplRotation): AplRotation {
  const sameSpell = (a: Node | undefined, id: number) => a?.spellId === id;
  // The overlap (a value) a condition term asks for on spell id, or null when the term is no DoT check of it.
  const dotTerm = (term: Node, id: number): Node | null => {
    if (sameSpell(term.not?.val?.dotIsActive?.spellId, id)) return { const: { val: '0s' } };
    const cmp = term.cmp;
    if (cmp && ['OpLe', 'OpLt'].includes(cmp.op) && sameSpell(cmp.lhs?.dotRemainingTime?.spellId, id) && cmp.rhs) return cmp.rhs;
    return null;
  };
  const conjuncts = (c: Node): Node[] => (c.and ? c.and.vals.flatMap(conjuncts) : [c]);
  const priorityList = (rotation.priorityList ?? []).map((item) => {
    const entry = item as Node;
    const { castSpell, condition, ...rest } = entry.action ?? {};
    const id = castSpell?.spellId?.spellId;
    if (!id || !condition || JSON.stringify(condition).includes('ComboPoints')) return item;
    const terms = conjuncts(condition);
    const at = terms.findIndex((t) => dotTerm(t, id) !== null);
    if (at < 0) return item;
    const others = terms.filter((_, i) => i !== at);
    const multidot = { spellId: castSpell.spellId, maxDots: MAX_DOTS, maxOverlap: dotTerm(terms[at], id) };
    const action: Node = { ...rest, multidot };
    if (others.length) action.condition = others.length === 1 ? others[0] : { and: { vals: others } };
    return { ...entry, action };
  });
  return { ...rotation, priorityList };
}

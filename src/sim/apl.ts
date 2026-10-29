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

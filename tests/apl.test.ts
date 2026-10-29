import { describe, expect, it } from 'vitest';
import { normalizeApl, rotationFromExport } from '../src/sim/apl';
import rotationFile from '../src/classes/priest/shadow.rotation.json';

describe('normalizeApl', () => {
  it('replaces variables by their value and drops hidden entries', () => {
    const out = normalizeApl({
      type: 'TypeAPL',
      priorityList: [
        { action: { condition: { variableRef: { name: 'A' } }, castSpell: { spellId: { spellId: 1 } } } },
        { hide: true, action: { castSpell: { spellId: { spellId: 2 } } } },
      ],
      valueVariables: [{ name: 'A', value: { not: { val: { variableRef: { name: 'B' } } } } }, { name: 'B', value: { const: { val: '1' } } }],
      groups: [],
    });
    expect(out.priorityList).toEqual([{ action: { condition: { not: { val: { const: { val: '1' } } } }, castSpell: { spellId: { spellId: 1 } } } }]);
    expect(out).not.toHaveProperty('valueVariables');
    expect(out).not.toHaveProperty('groups');
  });

  it('rejects a variable that refers to itself', () => {
    expect(() => normalizeApl({ priorityList: [{ x: { variableRef: { name: 'A' } } }], valueVariables: [{ name: 'A', value: { variableRef: { name: 'A' } } }] })).toThrow(/itself/);
  });

  it('leaves no variable in the Shadow Priest rotation', () => {
    expect(JSON.stringify(normalizeApl(rotationFromExport(rotationFile)))).not.toContain('variableRef');
  });
});

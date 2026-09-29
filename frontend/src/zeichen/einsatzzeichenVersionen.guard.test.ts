import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

/**
 * Die @einsatzzeichen-Pakete pinnen einander exakt (react@2.0.0 zieht core@2.0.0). Weicht eine
 * Version ab oder trägt ein Bereichszeichen, landet still ein zweites `core` im Bundle — mit
 * eigenem Katalog und doppelter Größe (LFH-835, design.md D7). Deshalb: alle gleich, alle exakt.
 */
function pruefeEinsatzzeichenVersionen(abh: Record<string, string>): string[] {
  const eintraege = Object.entries(abh).filter(([name]) => name.startsWith('@einsatzzeichen/'));
  const fehler: string[] = [];
  for (const [name, version] of eintraege) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) fehler.push(`${name}: „${version}“ ist nicht exakt`);
  }
  const versionen = new Set(eintraege.map(([, v]) => v));
  if (versionen.size > 1) fehler.push(`abweichende Versionen: ${[...versionen].join(', ')}`);
  return fehler;
}

describe('@einsatzzeichen-Versionen', () => {
  it('stehen in package.json alle auf derselben exakten Version', () => {
    const abh: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(abh).filter((n) => n.startsWith('@einsatzzeichen/'))).not.toHaveLength(0);
    expect(pruefeEinsatzzeichenVersionen(abh)).toEqual([]);
  });

  it('meldet ein Bereichszeichen und eine abweichende Version', () => {
    expect(
      pruefeEinsatzzeichenVersionen({
        '@einsatzzeichen/core': '^2.1.0',
        '@einsatzzeichen/react': '2.0.0',
      }),
    ).toEqual([
      '@einsatzzeichen/core: „^2.1.0“ ist nicht exakt',
      'abweichende Versionen: ^2.1.0, 2.0.0',
    ]);
  });
});

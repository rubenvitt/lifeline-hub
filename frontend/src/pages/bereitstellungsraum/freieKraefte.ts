import type { Einheit, EinsatzFahrzeug } from '../../api/types';

export interface KraefteGruppe {
  titel: string;
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
}

const OHNE_TYP = 'Ohne Typ';
const FAHRZEUGE = 'Fahrzeuge ohne Einheit';

/** Gruppierung + Suche der freien Kräfte (LFH-347 · M58), rein und ohne Render prüfbar. */
export function gruppiereFreieKraefte(
  einheiten: Einheit[],
  fahrzeuge: EinsatzFahrzeug[],
  suche: string,
): KraefteGruppe[] {
  const q = suche.trim().toLocaleLowerCase('de');
  const trifft = (...felder: Array<string | null | undefined>) =>
    q === '' || felder.some((s) => s != null && s.toLocaleLowerCase('de').includes(q));

  const nachTyp = new Map<string, Einheit[]>();
  for (const e of einheiten) {
    if (!trifft(e.name, e.typ_label)) continue;
    const t = e.typ_label ?? OHNE_TYP;
    if (!nachTyp.has(t)) nachTyp.set(t, []);
    nachTyp.get(t)!.push(e);
  }
  const typen = [...nachTyp.keys()]
    .filter((t) => t !== OHNE_TYP)
    .sort((a, b) => a.localeCompare(b, 'de'));
  if (nachTyp.has(OHNE_TYP)) typen.push(OHNE_TYP);
  const gruppen: KraefteGruppe[] = typen.map((t) => ({
    titel: t,
    einheiten: nachTyp.get(t)!,
    fahrzeuge: [],
  }));

  const fz = fahrzeuge.filter((f) => trifft(f.funkrufname, f.fahrzeugtyp));
  if (fz.length) gruppen.push({ titel: FAHRZEUGE, einheiten: [], fahrzeuge: fz });
  return gruppen;
}

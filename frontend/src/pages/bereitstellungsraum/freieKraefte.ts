import type { BrEinheitKurz, BrFahrzeugKurz, Einheit, EinsatzFahrzeug } from '../../api/types';
import { abschnittDerEinheit } from '../../kraefte/kraeftebaumKern';

interface KraefteGruppe {
  titel: string;
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
}

const OHNE_TYP = 'Ohne Typ';
const FAHRZEUGE = 'Fahrzeuge ohne Einheit';

/** Gruppierung + Suche der freien Kräfte, rein und ohne Render prüfbar. */
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

/** Freie Kräfte einer Gruppe der Seitenleiste. */
export interface FreieKraefte {
  einheiten: Einheit[];
  fahrzeuge: EinsatzFahrzeug[];
}

export interface FreieKraefteEingabe {
  alleEinheiten: readonly Einheit[];
  alleFahrzeuge: readonly EinsatzFahrzeug[];
  /** Im Raum laut Detail-Cache; fehlen, auch wenn die Listen sie noch frei führen. */
  brEinheiten: readonly Pick<BrEinheitKurz, 'id'>[];
  brFahrzeuge: readonly Pick<BrFahrzeugKurz, 'id'>[];
}

/**
 * Die freien Kräfte der Seitenleiste, ohne Suche (LLH-1075, design.md D14): „Erwartet“ sind
 * Einheiten ohne Abschnitt (auch ohne geerbten, Lesart des Meldebilds) und einheitenlose
 * Fahrzeuge, „Im Einsatz“ Einheiten mit Abschnitt. Exportiert, damit die Seite weiß, welche Zeilen
 * stehen: der Grund einer Kraft, die hier nicht mehr steht, gehört in den Seitenhinweis.
 */
export function freieKraefteOhneBr(e: FreieKraefteEingabe): {
  erwartet: FreieKraefte;
  imEinsatz: FreieKraefte;
} {
  const brEinheitIds = new Set(e.brEinheiten.map((x) => x.id));
  const brFahrzeugIds = new Set(e.brFahrzeuge.map((x) => x.id));
  const abschnittJe = abschnittDerEinheit(e.alleEinheiten);
  const erwartet: FreieKraefte = { einheiten: [], fahrzeuge: [] };
  const imEinsatz: FreieKraefte = { einheiten: [], fahrzeuge: [] };
  for (const x of e.alleEinheiten) {
    if (x.aktueller_br_id != null || brEinheitIds.has(x.id)) continue;
    (abschnittJe.get(x.id) != null ? imEinsatz : erwartet).einheiten.push(x);
  }
  erwartet.fahrzeuge = e.alleFahrzeuge.filter(
    (f) => f.einheit_id == null && f.aktueller_br_id == null && !brFahrzeugIds.has(f.id),
  );
  return { erwartet, imEinsatz };
}

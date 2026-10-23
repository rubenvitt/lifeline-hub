import type { Nachforderung } from '../api/types';

/**
 * Kurzname einer Nachforderung, wie der Server ihn im ETB schreibt: „2× RTW“, ohne Anzahl nur
 * die Art (`src/nachforderung/repo.rs:kurzname`).
 */
export function nachforderungKurzname(n: Pick<Nachforderung, 'anzahl' | 'art'>): string {
  return n.anzahl != null ? `${n.anzahl}× ${n.art}` : n.art;
}

/**
 * Name einer Nachforderung, wo sie in einer Liste oder Auswahl steht (LLH-1089, design.md D10):
 * der Kurzname, mit Details „2× RTW — Transport aus der UHS“. Die Details sind seit LLH-1089
 * optional und nennen deshalb die Nachforderung nicht mehr allein.
 */
export function nachforderungName(
  n: Pick<Nachforderung, 'anzahl' | 'art' | 'bezeichnung'>,
): string {
  const kurz = nachforderungKurzname(n);
  const details = n.bezeichnung?.trim();
  return details ? `${kurz} — ${details}` : kurz;
}

/** Adressat-Kategorie → Anzeigewort (Karte und Überblick, LLH-1145). */
const ADRESSAT_LABEL: Record<string, string> = {
  leitstelle: 'Leitstelle',
  nachbar_ea: 'Nachbar-EA',
  uebergeordnet: 'Übergeordnete Führung',
  andere_bos: 'Andere BOS',
};

/** „Leitstelle“, „Andere BOS (THW OV Musterstadt)“ — an wen die Nachforderung ging. */
export function adressatText(
  n: Pick<Nachforderung, 'adressat_kategorie' | 'adressat_bezeichnung'>,
): string {
  const kategorie = ADRESSAT_LABEL[n.adressat_kategorie] ?? n.adressat_kategorie;
  return n.adressat_bezeichnung ? `${kategorie} (${n.adressat_bezeichnung})` : kategorie;
}

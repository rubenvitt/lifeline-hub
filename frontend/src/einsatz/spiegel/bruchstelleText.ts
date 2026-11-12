// Wörter der Liste „Nicht übernommen“ (LLH-1646). Eigene Datei, damit sie mit der Liste
// nachgeladen werden und nicht im Haupt-Chunk stehen (Precache-Grenze, vite.config.ts).
import type { BruchErfassung } from '../../api/types';
import { antragArtWort } from './spiegelText';

/** Zeilen ohne Antragsart nach Tabelle, sonst nach Bereich (LLH-1646). */
const BRUCH_TABELLE_WORT: Readonly<Record<string, string>> = {
  etb_eintrag: 'ETB-Eintrag',
  meldung: 'Meldung',
  einsatz_person: 'Person',
};

const BRUCH_KATEGORIE_WORT: Readonly<Record<BruchErfassung['kategorie'], string>> = {
  fuehrung: 'Einsatzdaten',
  etb: 'ETB',
  lage: 'Lagekarte',
  kraefte: 'Kräfte',
  personen: 'Personen',
  betreuung: 'Betreuung',
  kommunikation: 'Fernmeldewesen',
  anhaenge: 'Anhang',
};

/** Was die nicht übernommene Erfassung ist, als Wort (LLH-1646). */
export function bruchArtWort(
  e: Pick<BruchErfassung, 'antrag_art' | 'tabelle' | 'kategorie'>,
): string {
  if (e.antrag_art) return antragArtWort(e.antrag_art);
  return BRUCH_TABELLE_WORT[e.tabelle] ?? BRUCH_KATEGORIE_WORT[e.kategorie] ?? e.tabelle;
}

/** Folgezeilen, die mit der Erfassung gingen („+ 1 Zeile“); ohne keine Angabe. */
export function bruchFolgenText(folgen: number): string | null {
  if (folgen <= 0) return null;
  return `+ ${folgen} ${folgen === 1 ? 'Zeile' : 'Zeilen'}`;
}

/**
 * Eine gestellte Person, deren Einträge noch folgen (LLH-1657): „3 Einträge folgen“. Sonst
 * keine Angabe.
 */
export function bruchKetteText(
  e: Pick<BruchErfassung, 'nachgereicht' | 'folgen_offen'>,
): string | null {
  if (!e.nachgereicht || e.folgen_offen <= 0) return null;
  return e.folgen_offen === 1 ? '1 Eintrag folgt' : `${e.folgen_offen} Einträge folgen`;
}

/** Lässt sich als Antrag stellen: Antragsart bekannt, Inhalt sichtbar, nicht schon gestellt (N1). */
export function bruchStellbar(
  e: Pick<BruchErfassung, 'antrag_art' | 'verborgen' | 'nachgereicht'>,
): boolean {
  return e.antrag_art != null && !e.verborgen && !e.nachgereicht;
}

/** Ergebnis von „Alle stellen“, wenn etwas offen blieb: „2 nicht gestellt: Bezug …“. */
export function bruchOffenText(offen: readonly { grund: string }[]): string | null {
  if (offen.length === 0) return null;
  const gruende = [...new Set(offen.map((o) => o.grund))].join(' ');
  return `${offen.length} nicht gestellt: ${gruende}`;
}

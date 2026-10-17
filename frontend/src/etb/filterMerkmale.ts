import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { zeitraumBeschriftung, type Zeitbezug } from '../anzeige/zeitfenster';

interface MerkmalOptionen {
  /** Jetzt, Anzeigezone und letzte Lagebesprechung — für die Zeitraum-Kurzform. */
  bezug: Zeitbezug;
  typWort: (typ: EtbTyp) => string;
  /** Name einer Einheit, falls lesbar. */
  einheitName: (id: number) => string | undefined;
}

/**
 * Die gesetzten Filtermerkmale kurz, für das Filterband (LLH-1071, `Filterhinweis`): „Meldung ·
 * seit 1345 · „Deich“ · Einheit ELW 1 · ohne System“. Dieselbe Folge wie der Druckkopf
 * (`druckAuswahl.ts`, Typ, Zeitraum, Suchbegriff, Einheit, Systemeinträge), aber im Wortlaut der
 * Leiste und taktisch, nicht als Satz. Leer ohne Filter: dann steht kein Band.
 *
 * Wie im Druck erscheint keine Datenbank-Kennung: eine Einheit ohne lesbaren Namen heißt „eine
 * Einheit“.
 */
export function filterMerkmale(
  filter: Pick<EtbFilterWerte, 'q' | 'typ' | 'von' | 'bis' | 'einheit_id' | 'ohne_system'>,
  { bezug, typWort, einheitName }: MerkmalOptionen,
): string[] {
  const merkmale: string[] = [];
  if (filter.typ) merkmale.push(typWort(filter.typ));
  if (filter.von || filter.bis) {
    merkmale.push(zeitraumBeschriftung({ von: filter.von, bis: filter.bis }, bezug));
  }
  if (filter.q) merkmale.push(`„${filter.q}“`);
  if (filter.einheit_id != null) {
    const name = einheitName(filter.einheit_id);
    merkmale.push(name ? `Einheit ${name}` : 'eine Einheit');
  }
  if (filter.ohne_system) merkmale.push('ohne System');
  return merkmale;
}

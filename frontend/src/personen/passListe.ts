import type { PassZeile } from '../api/types';
import type { DruckSpalte } from '../druck/DruckTabelle';

/**
 * PASS-Liste (LLH-1198, Entwurf `docs/superpowers/specs/2026-11-24-sco62ku3-pass-liste-design.md`):
 * der Server liefert je Spalte fertigen Text (`src/person/pass.rs`), hier steht nur, wie er
 * erscheint. Kopfwörter und Reihenfolge wie die CSV-Kopfzeile des Servers.
 */

/** Hinweis auf die Zweckbindung vor dem Abruf und am Bildschirm der Druckansicht. */
export const ZWECK_BILDSCHIRM =
  'Die PASS-Liste enthält Personendaten Betroffener. Nur für die Personenauskunft verwenden und nicht weitergeben. Der Abruf wird protokolliert.';

/** Hinweis auf dem gedruckten Blatt. */
export const ZWECK_BLATT = 'Zweckgebunden: nur für die Personenauskunftsstelle.';

export const PASS_SPALTEN: readonly DruckSpalte<PassZeile>[] = [
  { titel: 'Kennung', wert: (z) => z.id_label, mono: true },
  { titel: 'Name', wert: (z) => z.last_name },
  { titel: 'Vorname', wert: (z) => z.first_name },
  { titel: 'Geburtsdatum', wert: (z) => z.birth_date, mono: true },
  { titel: 'Alter (geschätzt)', wert: (z) => z.age, mono: true },
  { titel: 'Geschlecht', wert: (z) => z.sex },
  { titel: 'Anschrift', wert: (z) => z.address },
  { titel: 'Art der Betroffenheit', wert: (z) => z.affectedness },
  { titel: 'Verbleib', wert: (z) => z.whereabouts },
  { titel: 'Erfasst am', wert: (z) => z.recorded_at, mono: true },
];

/**
 * Reiner Kern des Bereichs „Helfer“ der Geräte-Sektion (Helfer-App, Spec
 * `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Oberfläche“).
 */
import type { HelferAnzeige, HelferStatus, HelferZiel } from '../../api/types';

/** Gültigkeit einer Einladung: Vorgabe 4 h, höchstens 72 h (Spiegel von `einladung::VORGABE_MINUTEN`). */
export const EINLADUNG_VORGABE_MINUTEN = 4 * 60;

/** Wählbare Gültigkeiten der Einladung, in Minuten. */
export const EINLADUNG_DAUER_OPTIONEN: readonly { value: number; label: string }[] = [
  { value: 60, label: '1 Stunde' },
  { value: EINLADUNG_VORGABE_MINUTEN, label: '4 Stunden' },
  { value: 12 * 60, label: '12 Stunden' },
  { value: 24 * 60, label: '24 Stunden' },
  { value: 72 * 60, label: '72 Stunden' },
];

/** Die drei Gruppen der Liste, in dieser Reihenfolge. */
export type HelferGruppe = 'wartet' | 'angemeldet' | 'beendet';

export const HELFER_GRUPPEN: readonly HelferGruppe[] = ['wartet', 'angemeldet', 'beendet'];

/** Kopf je Gruppe. */
export const GRUPPEN_TITEL: Record<HelferGruppe, string> = {
  wartet: 'Wartende Helfer',
  angemeldet: 'Angemeldete Helfer',
  beendet: 'Beendet',
};

/** Zustand in Worten; `unbestaetigt` heißt im Text „wartet“. */
export const HELFER_STATUS_WORT: Record<HelferStatus, string> = {
  unbestaetigt: 'wartet',
  aktiv: 'angemeldet',
  abgelehnt: 'abgelehnt',
  beendet: 'beendet',
};

export function helferGruppe(state: HelferStatus): HelferGruppe {
  if (state === 'unbestaetigt') return 'wartet';
  if (state === 'aktiv') return 'angemeldet';
  return 'beendet';
}

const RANG: Record<HelferGruppe, number> = { wartet: 0, angemeldet: 1, beendet: 2 };

/**
 * „Wartet“ vor „Angemeldet“ vor „Beendet“, je Gruppe nach dem Anmelden (wer am längsten wartet,
 * steht oben). Die Zeitpunkte sind kanonisch (`YYYY-MM-DD HH:MM:SS`), der Textvergleich ordnet
 * sie richtig.
 */
export function sortHelfer(liste: readonly HelferAnzeige[]): HelferAnzeige[] {
  return [...liste].sort(
    (a, b) =>
      RANG[helferGruppe(a.state)] - RANG[helferGruppe(b.state)] ||
      a.created_at.localeCompare(b.created_at) ||
      a.id - b.id,
  );
}

function normalisiere(name: string): string {
  return name.trim().toLocaleLowerCase('de').replace(/\s+/g, ' ');
}

function erstesWort(name: string): string {
  return normalisiere(name)
    .split(' ')[0]
    .replace(/[.,;]+$/, '');
}

/**
 * Vorschlag für die Person eines Helfers aus den Kräften des Einsatzes: erst der gleiche Name,
 * dann das gleiche erste Wort, beides ohne Groß- und Kleinschreibung. Trifft eine Stufe mehr als
 * eine Kraft, gibt es keinen Vorschlag: die Leitung wählt selbst.
 */
export function suggestPerson(
  displayName: string,
  kraefte: readonly { id: number; name: string }[],
): number | null {
  const gesucht = normalisiere(displayName);
  if (!gesucht) return null;
  const gleich = kraefte.filter((k) => normalisiere(k.name) === gesucht);
  if (gleich.length > 0) return gleich.length === 1 ? gleich[0].id : null;
  const wort = erstesWort(displayName);
  const treffer = kraefte.filter((k) => erstesWort(k.name) === wort);
  return treffer.length === 1 ? treffer[0].id : null;
}

/** Ob zwei Ziele dasselbe meinen. */
export function gleichesZiel(a: HelferZiel | null | undefined, b: HelferZiel | null | undefined) {
  return a != null && b != null && a.kind === b.kind && a.id === b.id;
}

/**
 * Das angemeldete Ortungsgerät eines Ziels außer dem Helfer `ohne` — der Halter, den das Bestätigen
 * verdrängen müsste. Ein Ziel hat höchstens eines (Spec „Ein Ortungsgerät je Ziel“).
 */
export function findTracker(
  liste: readonly HelferAnzeige[],
  ziel: HelferZiel | null | undefined,
  ohne: number,
): HelferAnzeige | undefined {
  return liste.find(
    (h) => h.id !== ohne && h.state === 'aktiv' && h.is_tracker && gleichesZiel(h.target, ziel),
  );
}

/** „Fahrzeug Rotkreuz 1/83-1“ bzw. „Einheit Zug 1“. */
export function zielText(ziel: HelferZiel | null | undefined): string {
  if (!ziel) return 'ohne Ziel';
  return `${ziel.kind === 'vehicle' ? 'Fahrzeug' : 'Einheit'} ${ziel.name}`;
}

import type {
  BrListenEintrag,
  Einsatzabschnitt,
  Nachforderung,
  NeueNachforderung,
} from '../api/types';

/**
 * Ziel (Meldeort) einer Nachforderung (LLH-1089, design.md D5) — rein: Optionen für „Wohin“,
 * die Vorgabe und die Auflösung des Texts in ein Ziel. Das Feld trägt den Namen; erst beim
 * Absenden wird daraus ein Bereitstellungsraum, ein Einsatzabschnitt oder Freitext.
 */

/** Ein Raum, wie die Auswahl ihn braucht. */
export type ZielRaum = Pick<BrListenEintrag, 'id' | 'bezeichnung' | 'status'>;
/** Ein Abschnitt, wie die Auswahl ihn braucht. */
export type ZielAbschnitt = Pick<Einsatzabschnitt, 'id' | 'name'>;

export interface ZielOption {
  value: string;
  label: string;
}

export interface ZielGruppe {
  label: string;
  options: ZielOption[];
}

/** Die Felder des Ziels im Body von `POST …/nachforderungen`. */
export type ZielFelder = Pick<NeueNachforderung, 'ziel_br_id' | 'ziel_abschnitt_id' | 'ziel_text'>;

const offen = (r: ZielRaum) => r.status !== 'aufgeloest';

/** Gruppen „Bereitstellungsräume“ (nicht aufgelöste) und „Einsatzabschnitte“; leere fallen weg. */
export function zielOptionen(
  raeume: readonly ZielRaum[],
  abschnitte: readonly ZielAbschnitt[],
): ZielGruppe[] {
  const raumNamen = new Set(raeume.filter(offen).map((r) => r.bezeichnung));
  return [
    {
      label: 'Bereitstellungsräume',
      options: raeume.filter(offen).map((r) => ({ value: r.bezeichnung, label: r.bezeichnung })),
    },
    {
      label: 'Einsatzabschnitte',
      // Ein gleichnamiger Abschnitt stünde mit demselben Wert zweimal da; der Raum gewinnt.
      options: abschnitte
        .filter((a) => !raumNamen.has(a.name))
        .map((a) => ({ value: a.name, label: a.name })),
    },
  ].filter((g) => g.options.length > 0);
}

/** Vorgabe für „Wohin“: der Name des einzigen aktiven Raums, sonst leer. */
export function zielVorgabe(raeume: readonly ZielRaum[]): string {
  const aktiv = raeume.filter((r) => r.status === 'aktiv');
  return aktiv.length === 1 ? aktiv[0].bezeichnung : '';
}

/**
 * Text → Ziel: ein nicht aufgelöster Raum gleichen Namens, sonst ein Abschnitt gleichen Namens,
 * sonst Freitext. Leer heißt ohne Ziel.
 */
export function zielAusText(
  text: string | undefined,
  raeume: readonly ZielRaum[],
  abschnitte: readonly ZielAbschnitt[],
): ZielFelder {
  const t = text?.trim() ?? '';
  if (!t) return {};
  const raum = raeume.find((r) => offen(r) && r.bezeichnung.trim() === t);
  if (raum) return { ziel_br_id: raum.id };
  const abschnitt = abschnitte.find((a) => a.name.trim() === t);
  if (abschnitt) return { ziel_abschnitt_id: abschnitt.id };
  return { ziel_text: t };
}

/**
 * Namen der Ziele je Kennung, wie die Seite sie aus den Listen der Module liest (design.md D10).
 * `null`: Modul nicht freigegeben oder Liste nicht da.
 */
export interface ZielNamen {
  raeume: ReadonlyMap<number, string> | null;
  abschnitte: ReadonlyMap<number, string> | null;
}

/**
 * Die Zielzeile einer Nachforderung: „→ BR Nord“; ohne bekannten Namen „→ Bereitstellungsraum“
 * bzw. „→ Einsatzabschnitt“. Ohne Ziel `null`.
 */
export function zielZeile(
  n: Pick<Nachforderung, 'ziel_br_id' | 'ziel_abschnitt_id' | 'ziel_text'>,
  namen: ZielNamen | null | undefined,
): string | null {
  if (n.ziel_br_id != null) {
    return `→ ${namen?.raeume?.get(n.ziel_br_id) ?? 'Bereitstellungsraum'}`;
  }
  if (n.ziel_abschnitt_id != null) {
    return `→ ${namen?.abschnitte?.get(n.ziel_abschnitt_id) ?? 'Einsatzabschnitt'}`;
  }
  return n.ziel_text ? `→ ${n.ziel_text}` : null;
}

import type { Nebenweg } from '../EinsatzSeite';
import { useDrucken } from './useDrucken';

/** Wortlaut wie am `DruckKnopf`. */
export const DRUCKEN = 'Drucken / als PDF';

/**
 * „Drucken / als PDF“ als Nebenweg des Seitenkopfs (LFH-1079) für Seiten, die sich selbst drucken
 * (`window.print()` über {@link useDrucken}). Dasselbe Verhalten wie `DruckKnopf`, nur als Eintrag
 * für `EinsatzSeite.weitere`: ab `md` ein Knopf, unter `md` ein Menüeintrag.
 *
 * Kann die Organisation nicht geladen werden, steht der Druck GESPERRT da und nennt den Grund im
 * Text (nicht versteckt, LFH-345 · M16); „Organisation erneut laden“ folgt als eigener Eintrag,
 * damit der Weg zurück auch unter `md` erreichbar bleibt.
 */
export function useDruckNebenwege(): Nebenweg[] {
  const { drucken, zustand, wiederholen } = useDrucken();
  if (zustand === 'fehler') {
    return [
      {
        key: 'druck',
        label: `${DRUCKEN} (Organisation nicht geladen)`,
        gesperrt: true,
        onWahl: drucken,
      },
      { key: 'organisation-laden', label: 'Organisation erneut laden', onWahl: wiederholen },
    ];
  }
  return [{ key: 'druck', label: DRUCKEN, onWahl: drucken }];
}

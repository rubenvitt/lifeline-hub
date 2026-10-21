import { useState } from 'react';
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
 *
 * `vorbereiten` (Lageplan, LLH-1051): baut das Druckstück erst auf Wahl, etwa das Bild der Karte.
 * Der Druck folgt, wenn es `true` meldet; bis dahin läuft der Eintrag. Meldet es `false`, hat der
 * Aufrufer den Grund schon an seinen Ort gegeben.
 */
export function useDruckNebenwege({
  vorbereiten,
}: { vorbereiten?: () => Promise<boolean> } = {}): Nebenweg[] {
  const { drucken, zustand, wiederholen } = useDrucken();
  const [bereitetVor, setBereitetVor] = useState(false);
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
  if (!vorbereiten) return [{ key: 'druck', label: DRUCKEN, onWahl: drucken }];
  return [
    {
      key: 'druck',
      label: DRUCKEN,
      laeuft: bereitetVor,
      onWahl: () => {
        if (bereitetVor) return;
        setBereitetVor(true);
        void vorbereiten()
          .then((bereit) => {
            if (bereit) drucken();
          })
          .catch(() => undefined)
          .finally(() => setBereitetVor(false));
      },
    },
  ];
}

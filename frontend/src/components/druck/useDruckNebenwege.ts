import { useState } from 'react';
import type { Nebenweg } from '../EinsatzSeite';
import { useDrucken } from './useDrucken';

/**
 * Wortlaut der Druckeinstiege nach ihrer Wirkung (LLH-1836, `druck/AGENTS.md`, „Wortlaut und
 * Platz“): `DRUCKEN` öffnet sofort den Druckdialog (wie am `DruckKnopf`), `DRUCKANSICHT` öffnet eine
 * eigene Druckseite. Kein Druckeinstieg trägt einen anderen Namen.
 */
export const DRUCKEN = 'Drucken / als PDF';
export const DRUCKANSICHT = 'Druckansicht';

/** Druckseite eines anderen Dokuments als der Seite des Einstiegs: „Einsatzbericht – Druckansicht“. */
export function druckansichtVon(dokument: string): string {
  return `${dokument} – ${DRUCKANSICHT}`;
}

/**
 * Der Einstieg in eine Druckseite als `Nebenweg` (Seitenkopf oder Objektkopf über
 * `NebenwegeImKopf`): ab `md` ein Link in Knopfgestalt, Strg/⌘+Klick öffnet einen Tab.
 */
export function druckansichtNebenweg({
  ziel,
  navigate,
  dokument,
}: {
  ziel: string;
  navigate: (ziel: string) => void;
  /** Nur, wenn die Druckseite ein anderes Dokument druckt als die Seite des Einstiegs. */
  dokument?: string;
}): Nebenweg {
  return {
    key: 'druck',
    label: dokument ? druckansichtVon(dokument) : DRUCKANSICHT,
    ziel,
    onWahl: () => navigate(ziel),
  };
}

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
 *
 * `vorDemDruck` (Meldebild, Funkplan, Organigramm, LLH-1836): läuft synchron im selben Zug vor dem
 * Druck wie `DruckKnopf.vorbereiten`, etwa um alles aufzuklappen; `useDrucken` öffnet den Dialog
 * erst nach dem Commit.
 */
export function useDruckNebenwege({
  vorbereiten,
  vorDemDruck,
}: { vorbereiten?: () => Promise<boolean>; vorDemDruck?: () => void } = {}): Nebenweg[] {
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
  if (!vorbereiten)
    return [
      {
        key: 'druck',
        label: DRUCKEN,
        onWahl: () => {
          vorDemDruck?.();
          drucken();
        },
      },
    ];
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

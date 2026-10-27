import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { RenderTheme } from '@einsatzzeichen/core';
import { useRollen } from '../components/instrument';
import { zeichenTheme } from './zeichenTheme';

/**
 * Steht die Seite im Druck? Ein Zustand für alle Zeichen der Seite, zwischen `beforeprint` und
 * `afterprint`, wie `components/druck/useDruckModus.ts` (dort die Begründung für `flushSync`).
 * Anders als dort gilt er auch für ein Zeichen, das erst im Druck entsteht: das Meldebild baut
 * seine Tabelle für das Druckbild neu auf, und ein frisches `useDruckModus` begänne mit `false`
 * (im e2e „Zeichenkontrast“ trugen die Zeichen dann im Druck das Theme). Dazu nur ein Hörerpaar
 * für die ganze Seite statt eines je Zeichen.
 */
let druckt = false;
const hoerer = new Set<() => void>();
let angemeldet = false;

function abonniere(neu: () => void) {
  if (!angemeldet) {
    angemeldet = true;
    window.addEventListener('beforeprint', () => {
      druckt = true;
      flushSync(() => hoerer.forEach((h) => h()));
    });
    window.addEventListener('afterprint', () => {
      druckt = false;
      hoerer.forEach((h) => h());
    });
  }
  hoerer.add(neu);
  return () => {
    hoerer.delete(neu);
  };
}

/**
 * Das Render-Theme eines Zeichens, das am Schirm auf der Fläche der Seite steht (LLH-1409:
 * Meldebild, Organigramm, Gefahrauswahl): im Nachtbetrieb das Theme `dark`
 * (`zeichen/zeichenTheme.ts`), am Tag und im Druck keins. Mit dem Theme bliebe der Druck nicht
 * unverändert (Kopfmarken weiß auf Papier). Eigene Datei, damit `zeichenTheme.ts` ohne React und
 * antd auskommt.
 */
export function useZeichenTheme(): RenderTheme | undefined {
  const { dunkel } = useRollen();
  const imDruck = useSyncExternalStore(
    abonniere,
    () => druckt,
    () => false,
  );
  return zeichenTheme(dunkel && !imDruck);
}

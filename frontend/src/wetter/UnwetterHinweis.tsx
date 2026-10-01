import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { useUnwetterHinweis } from './useUnwetterHinweis';

/**
 * Montiert die Unwetter-Erkennung (LFH-663) INNERHALB des `EinsatzAnzeigeProvider`: nur dort
 * kennt `useAnzeigeKonventionen` Zeitzone und Zeitformat des Einsatzes. Rendert nichts.
 */
export default function UnwetterHinweis(props: {
  einsatzId: number;
  benutzer: BenutzerAnzeige | null;
  overrides: ModulOverrides | undefined;
}) {
  useUnwetterHinweis(props);
  return null;
}

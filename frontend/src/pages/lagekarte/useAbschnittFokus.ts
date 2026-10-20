import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  baueFokusSicht,
  escZiel,
  fokusRahmen,
  type FokusQuelle,
  type FokusSicht,
} from './abschnittFokus';
import type { GeoJsonPolygon } from './geo';
import type { KartenHandle } from './Kartenflaeche';
import type { KameraStand } from './fokusKamera';
import type { KarteMarker } from './marker';
import { escGehoertOverlay } from './zeichnenEsc';

export interface AbschnittFokusArgs {
  einsatzId: number;
  /** Rohlisten der Karte: Abschnitte, Einheiten, Fahrzeuge (`useLagekarteDaten().rohdaten`). */
  quelle: FokusQuelle;
  /** Alle Abschnittsflächen, unabhängig vom Ebenenschalter. */
  flaechen: readonly { id: number; polygon: GeoJsonPolygon }[];
  /** Alle verorteten Marker, unabhängig vom Ebenenschalter. */
  marker: readonly KarteMarker[];
  kartenRef: RefObject<KartenHandle | null>;
  /** Steht eine Auswahl offen? Dann gehört Esc erst ihr. */
  auswahlOffen: boolean;
  onAuswahlAufheben: () => void;
  /** Läuft ein exklusiver Kartenmodus? Dann gehört Esc dem Modus (Zeichnen, Messen). */
  modusAktiv: boolean;
}

interface FokusZustand {
  einsatzId: number;
  abschnittId: number;
  /** Kamera vor dem ersten Fokus; `null`, solange der Fokus die Karte nicht bewegt hat. */
  vorher: KameraStand | null;
}

/**
 * Fokus auf einen Einsatzabschnitt (LLH-1057, Spec `lagekarte-abschnitt-fokus`): Zustand nur hier,
 * nie in Ansicht, Speicher oder URL. `fokussiere` passt die Karte ein und merkt die Kamera davor,
 * `aufheben` fährt sie zurück. Esc wirkt nur bei aktivem Fokus und erst auf die Auswahl
 * (`escZiel`). Ein Einsatzwechsel oder ein verschwundener Abschnitt hebt ihn abgeleitet auf.
 */
export function useAbschnittFokus({
  einsatzId,
  quelle,
  flaechen,
  marker,
  kartenRef,
  auswahlOffen,
  onAuswahlAufheben,
  modusAktiv,
}: AbschnittFokusArgs) {
  const [zustand, setZustand] = useState<FokusZustand | null>(null);
  const abschnittId = zustand?.einsatzId === einsatzId ? zustand.abschnittId : null;
  const { abschnitte, einheiten, fahrzeuge } = quelle;
  const sicht = useMemo<FokusSicht | null>(
    () =>
      abschnittId == null
        ? null
        : baueFokusSicht(abschnittId, { abschnitte, einheiten, fahrzeuge }),
    [abschnittId, abschnitte, einheiten, fahrzeuge],
  );

  const fokussiere = useCallback(
    (id: number) => {
      const neu = baueFokusSicht(id, { abschnitte, einheiten, fahrzeuge });
      if (!neu) return;
      const rahmen = fokusRahmen(neu, flaechen, marker);
      const vorher = rahmen ? (kartenRef.current?.fokussiere(rahmen) ?? null) : null;
      // Ein Wechsel A → B behält die Kamera vor A: „Fokus aufheben“ führt zurück zur Übersicht.
      setZustand((alt) => ({
        einsatzId,
        abschnittId: id,
        vorher: (alt?.einsatzId === einsatzId ? alt.vorher : null) ?? vorher,
      }));
    },
    [abschnitte, einheiten, fahrzeuge, flaechen, marker, kartenRef, einsatzId],
  );

  const zustandRef = useRef(zustand);
  zustandRef.current = zustand;
  const aufheben = useCallback(() => {
    const alt = zustandRef.current;
    if (alt?.vorher && alt.einsatzId === einsatzId) kartenRef.current?.stelleKameraHer(alt.vorher);
    setZustand(null);
  }, [kartenRef, einsatzId]);

  // Esc (LLH-1023): erst die Auswahl, dann der Fokus. Die Ausführung liegt in einem Ref, der
  // Zuhörer hängt nur daran, ob ein Fokus gilt.
  const escRef = useRef<() => boolean>(() => false);
  escRef.current = () => {
    if (modusAktiv) return false;
    if (escZiel(auswahlOffen) === 'auswahl') onAuswahlAufheben();
    else aufheben();
    return true;
  };
  const aktiv = sicht != null;
  useEffect(() => {
    if (!aktiv) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      const ziel = e.target instanceof Element ? e.target : null;
      if (ziel?.closest('input, textarea, [contenteditable="true"]')) return;
      if (escGehoertOverlay(e)) return;
      if (escRef.current()) e.preventDefault();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [aktiv]);

  return {
    /** Der fokussierte Abschnitt, aufbereitet; `null` = kein Fokus. */
    sicht,
    fokussiere,
    aufheben,
    /** Hebt Esc gerade den Fokus auf (kein Modus, keine Auswahl)? Für die Tastenkappe im Band. */
    escHebtAuf: !modusAktiv && escZiel(auswahlOffen) === 'fokus',
  };
}

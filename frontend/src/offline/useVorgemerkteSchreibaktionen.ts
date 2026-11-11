import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAntraegeAusCache } from '../einsatz/spiegel/useSpiegelAntraege';
import { antraegeAlsSchreibaktionen, type AntragKennung } from './antragAlsVormerkung';
import {
  beobachteQueueAenderungen,
  schreibaktionenLaden,
  type AusstehendeSchreibaktion,
  type OfflineSchreibaktion,
} from './queue';
import { PERSON_EINTRAG_ARTEN, type PersonEintragArt } from './personEintrag';

type Art = OfflineSchreibaktion['art'];

/**
 * Eine auf diesem Gerät vorgemerkte, vom Server noch nicht bestätigte Schreibaktion einer Art.
 * Mit `antrag` ist es ein Antrag am Spiegel (LLH-1492): die Seite zeigt „beantragt“ statt
 * „vorgemerkt“, an derselben Stelle. Er hat keine Queue-Nummer (`id`).
 */
export type VorgemerkteSchreibaktion<A extends Art> = AusstehendeSchreibaktion & {
  aktion: Extract<OfflineSchreibaktion, { art: A }>;
  antrag?: AntragKennung;
};

/** Ein vorgemerktes Eintreffen am Bereitstellungsraum (LLH-1075 Teil III). */
export type VorgemerktesEintreffen = VorgemerkteSchreibaktion<'eintreffen'>;

const LEER: never[] = [];

/**
 * Reaktive Sicht auf die vorgemerkten Schreibaktionen einer oder mehrerer Arten in einem Einsatz
 * (LFH-688, design.md D8; verallgemeinert für LLH-1075 Teil III und LLH-1138). Nur der Store der ausstehenden
 * Schreibaktionen: abgelehnte gehören in den Wiederherstellungsbereich, nicht als „ausstehend“ an
 * die Fachseite. Folgt der Queue auch über Tabs hinweg: flusht ein anderer Tab, entfällt
 * „ausstehend“ hier ebenfalls (`beobachteQueueAenderungen`).
 */
export function useVorgemerkteSchreibaktionen<A extends Art>(
  benutzerId: number | undefined,
  einsatzId: number,
  art: A | readonly A[],
): VorgemerkteSchreibaktion<A>[] {
  // Als Zeichenkette: ein Array-Literal des Aufrufers wäre bei jedem Render neu.
  const arten = typeof art === 'string' ? art : art.join(',');
  const scope = `${benutzerId ?? 'anonym'}:${einsatzId}:${arten}`;
  const [stand, setStand] = useState<{ scope: string; wert: VorgemerkteSchreibaktion<A>[] }>({
    scope,
    wert: LEER,
  });
  const ladeGeneration = useRef(0);
  const laden = useCallback(() => {
    const generation = ++ladeGeneration.current;
    if (benutzerId == null) {
      setStand({ scope, wert: LEER });
      return;
    }
    const gesucht = new Set(arten.split(','));
    void schreibaktionenLaden(benutzerId, einsatzId).then((zeilen) => {
      if (ladeGeneration.current === generation) {
        setStand({
          scope,
          wert: zeilen.filter((z): z is VorgemerkteSchreibaktion<A> => gesucht.has(z.aktion.art)),
        });
      }
    });
  }, [benutzerId, einsatzId, arten, scope]);

  useEffect(() => {
    laden();
    const beenden = beobachteQueueAenderungen(laden);
    return () => {
      beenden();
      ladeGeneration.current += 1;
    };
  }, [laden]);
  // Anträge am Spiegel derselben Art (LLH-1492, design.md D13): hinter den vorgemerkten, nur aus
  // dem Cache (das Hinweisband lädt sie).
  const antraege = useAntraegeAusCache(einsatzId);
  const vorgemerkt = stand.scope === scope ? stand.wert : LEER;
  return useMemo(() => {
    if (benutzerId == null || antraege.length === 0) return vorgemerkt;
    const gesucht = new Set(arten.split(','));
    const beantragt = antraegeAlsSchreibaktionen(antraege, benutzerId, einsatzId).filter(
      (z): z is VorgemerkteSchreibaktion<A> & { antrag: AntragKennung } =>
        gesucht.has(z.aktion.art),
    );
    return beantragt.length === 0 ? vorgemerkt : [...vorgemerkt, ...beantragt];
  }, [vorgemerkt, antraege, benutzerId, einsatzId, arten]);
}

/** Vorgemerkte Eintreffen eines Einsatzes, über alle Räume (LLH-1075 Teil III). */
export function useVorgemerkteEintreffen(
  benutzerId: number | undefined,
  einsatzId: number,
): VorgemerktesEintreffen[] {
  return useVorgemerkteSchreibaktionen(benutzerId, einsatzId, 'eintreffen');
}

/** Ein vorgemerkter Eintrag an einer Person (LLH-1138). */
export type VorgemerkterPersonEintrag = VorgemerkteSchreibaktion<PersonEintragArt>;

/**
 * Vorgemerkte Einträge an Personen eines Einsatzes, alle sechs Arten (LLH-1138, design.md D8):
 * Patientenkopf, Notizzeile und die Zeilen der Betroffenen- bzw. Patientenliste zeigen daraus
 * „Offline vorgemerkt“, getrennt von den Serverdaten (`frontend/src/offline/AGENTS.md`, „Was
 * vorgemerkt ist, kennt der Server noch nicht“). Eine Liste lädt das einmal für alle Zeilen.
 */
export function useVorgemerktePersonEintraege(
  benutzerId: number | undefined,
  einsatzId: number,
): VorgemerkterPersonEintrag[] {
  return useVorgemerkteSchreibaktionen(benutzerId, einsatzId, PERSON_EINTRAG_ARTEN);
}

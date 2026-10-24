import { useLayoutEffect, useRef } from 'react';
import type { GewanderterGrund } from '../../components/GewanderteGruende';
import { useZeilenFehler, type ZeilenFehlerSpeicher } from '../../components/useZeilenFehler';
import type { VisibleBesatzungRows } from './einheitAnsichtKern';

/** Gründe abgelehnter Aktionen im Paneel „Fahrzeuge und Besatzung“, Schlüssel `ep_id` bzw. `ef_id`. */
export interface BesatzungErrors {
  person: ZeilenFehlerSpeicher<number>;
  fahrzeug: ZeilenFehlerSpeicher<number>;
}

export interface BesatzungErrorsState extends BesatzungErrors {
  /** Gründe, deren Zeile das Paneel nicht mehr zeigt: für den Seitenhinweis. */
  orphaned: GewanderterGrund[];
  /** Verwirft genau die Gründe in `orphaned` (der Hinweis wird geschlossen). */
  dismissOrphaned: () => void;
}

/**
 * Die Gründe des Paneels „Fahrzeuge und Besatzung“ (LLH-1269, `frontend/AGENTS.md`, „Rückwege und
 * Fehler“). Die Seite hält sie, nicht das Paneel: lehnt der Server ab und hat ein Live-Ereignis die
 * Zeile inzwischen entfernt, steht der Grund in ihrem Hinweis-Slot statt mit der Zeile zu
 * verschwinden. Ein Grund, dessen Zeile wiederkommt, steht wieder an ihr.
 *
 * `visible` ist `null`, solange die Besatzung lädt: dann hat kein Grund seinen Ort verloren.
 *
 * Die Kennung eines verwaisten Grundes (Name, Funkrufname) steht in keiner Zeile mehr; sie kommt
 * aus den Namen jeder je gezeigten Zeile.
 */
export function useBesatzungErrors(visible: VisibleBesatzungRows | null): BesatzungErrorsState {
  const person = useZeilenFehler<number>();
  const fahrzeug = useZeilenFehler<number>();
  const namen = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (visible == null) return;
    for (const [id, name] of visible.fahrzeuge) namen.current.set(`f${id}`, name);
    for (const [id, name] of visible.personen) namen.current.set(`p${id}`, name);
  }, [visible]);

  // Gründe ohne Zeile; solange die Besatzung lädt, keiner.
  const orphanedIds = (store: ZeilenFehlerSpeicher<number>, rows?: ReadonlyMap<number, string>) =>
    rows == null ? [] : store.gemeldet().filter((id) => !rows.has(id));
  const fahrzeugIds = orphanedIds(fahrzeug, visible?.fahrzeuge);
  const personIds = orphanedIds(person, visible?.personen);
  const entries = (store: ZeilenFehlerSpeicher<number>, ids: number[], prefix: 'f' | 'p') =>
    ids.flatMap((id): GewanderterGrund[] => {
      const grund = store.grund(id);
      const schluessel = `${prefix}${id}`;
      return grund ? [{ schluessel, kennung: namen.current.get(schluessel), grund }] : [];
    });

  return {
    person,
    fahrzeug,
    orphaned: [...entries(fahrzeug, fahrzeugIds, 'f'), ...entries(person, personIds, 'p')],
    dismissOrphaned: () => {
      fahrzeugIds.forEach(fahrzeug.verwirf);
      personIds.forEach(person.verwirf);
    },
  };
}

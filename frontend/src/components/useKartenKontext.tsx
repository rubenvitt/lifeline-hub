/**
 * Kontextmenü eines einzelnen Datensatzes, der sich selbst zeichnet (Karte, Nachricht; LLH-1598,
 * `openspec/changes/archive/2026-11-10-g11xq51l-kontextmenue-karten/design.md` D2).
 *
 * Fasst `useKontextMenue` (Auslöser, geteilte Hörer) und `KontextMenue` (Schale) zusammen. Die
 * Einträge kommen aus den `KartenAktion[]` der Karte, aus denen sie auch Knöpfe und ⋮ zeichnet.
 * Die Handler gehören an das Element des Datensatzes (`{...ausloeser}`), `menue` irgendwo in die
 * Karte (es rendert per Portal).
 */
import { App } from 'antd';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { KontextMenue, type KontextMenueOffen } from './KontextMenue';
import { runKartenWahl, kartenKontextEintraege, type KartenAktion } from './kartenKontext';
import { useKontextMenue, type KontextHandler } from './useKontextMenue';

export interface KartenKontextOptionen<K extends string> {
  /** Alle Handlungen der Karte in Reihenfolge: Knöpfe, dann ⋮. Leer ⇒ Browsermenü. */
  aktionen: readonly KartenAktion<K>[];
  /** Name des Menüs mit Kennung des Datensatzes („Aktionen zu Meldung 7“). */
  zugaenglicherName: string;
}

export function useKartenKontext<K extends string, E extends Element = HTMLElement>({
  aktionen,
  zugaenglicherName,
}: KartenKontextOptionen<K>): { ausloeser: KontextHandler<E>; menue: ReactNode } {
  const { modal } = App.useApp();
  // Der jüngste Stand für die Bestätigung einer Rückfrage (`runKartenWahl`).
  const aktuell = useRef(aktionen);
  useEffect(() => {
    aktuell.current = aktionen;
  });
  // Hängt die Karte aus (Live-Abgleich trägt sie in eine andere Gruppe), gilt keine ihrer Aktionen
  // mehr: eine noch offene Rückfrage bestätigt dann nichts.
  useEffect(
    () => () => {
      aktuell.current = [];
    },
    [],
  );
  const [offen, setOffen] = useState<KontextMenueOffen | null>(null);
  const hatAktionen = aktionen.length > 0;
  // Verliert die Karte alle Aktionen, schließt das Menü (abgeleiteter Zustand wie `Datensicht`).
  if (offen != null && !hatAktionen) setOffen(null);
  const fabrik = useKontextMenue<null>({
    kannOeffnen: () => hatAktionen,
    onOeffnen: (_s, { anker, vorherFokus }) => {
      if (!hatAktionen) return false;
      setOffen({ anker, vorherFokus });
      return true;
    },
  });
  return {
    ausloeser: fabrik<E>(null),
    menue: (
      <KontextMenue<K>
        offen={offen}
        eintraege={kartenKontextEintraege(aktionen)}
        zugaenglicherName={zugaenglicherName}
        onWahl={(key) => runKartenWahl(aktionen, key, modal, () => aktuell.current)}
        onSchliessen={() => setOffen(null)}
      />
    ),
  };
}

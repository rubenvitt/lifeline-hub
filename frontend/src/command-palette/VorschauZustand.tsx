import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';

/**
 * Überschriftenebene, unter der Markdown in der Palettenvorschau steht (`unterEbene` von
 * `components/Markdown.tsx`). Die Palette hat keine eigene Gliederung; 2 heißt: `#` wird `h3`, wie
 * die Abschnittstitel des Lageberichts. EINE Konstante für ETB und Lagebericht.
 */
export const VORSCHAU_UNTER_EBENE = 2;

/** Die Teilmenge eines Query-Ergebnisses, die die Vorschau braucht. */
export interface VorschauAbfrage<T> {
  data: T | undefined;
  /** `status === 'pending'` — noch keine Antwort, ob gerade abgerufen wird oder nicht. */
  isPending: boolean;
  /** `'paused'` = ohne Verbindung angehalten (`networkMode: 'online'`, TanStacks Vorgabe). */
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Laden · ohne Verbindung · Fehler · „nicht mehr vorhanden“ · Inhalt, EINMAL für alle
 * Vorschau-Sorten.
 *
 * Der Grund für die Hülle ist „nicht mehr vorhanden“: die Vorschau liest per `select` aus dem
 * Listenfach der Palette; fehlt der Datensatz dort, ist `data` schlicht `undefined`, und ohne
 * eigenen Zweig sähe das aus wie „lädt noch“. Ein Fehler bei vorhandenem Stand zeigt den Stand mit
 * `SeitenStandVeraltet`.
 *
 * `sorte` ist die Nominalphrase mit Artikel („Die Meldung“); ein Artikel lässt sich nicht
 * ableiten.
 */
export function VorschauZustand<T>({
  abfrage,
  sorte,
  children,
}: {
  abfrage: VorschauAbfrage<T>;
  sorte: string;
  children: (daten: T) => ReactNode;
}) {
  const wiederholen = () => void abfrage.refetch();
  // An `isPending`, NICHT an `isLoading`: eine kalte Abfrage OHNE NETZ steht auf `pending` +
  // `paused`; `isLoading` wäre false und sie fiele in „nicht mehr vorhanden“.
  if (abfrage.isPending) {
    if (abfrage.fetchStatus === 'paused') {
      return (
        <Typography.Paragraph>
          {sorte} ist ohne Verbindung nicht abrufbar. Die Vorschau lädt, sobald das Netz zurück ist.
        </Typography.Paragraph>
      );
    }
    return (
      <div aria-busy="true" aria-label={`${sorte} wird geladen`}>
        <Spin />
      </div>
    );
  }
  if (abfrage.data === undefined) {
    if (abfrage.isError) {
      return (
        <SeitenFehler
          text={`${sorte} konnte nicht geladen werden`}
          ursache={abfrage.error}
          onWiederholen={wiederholen}
        />
      );
    }
    return <Typography.Paragraph>{sorte} ist nicht mehr vorhanden.</Typography.Paragraph>;
  }
  return (
    <>
      {abfrage.isError && <SeitenStandVeraltet onWiederholen={wiederholen} />}
      {children(abfrage.data)}
    </>
  );
}

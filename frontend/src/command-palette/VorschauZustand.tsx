// frontend/src/command-palette/VorschauZustand.tsx
import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';

/**
 * Überschriftenebene, unter der Markdown in der Palettenvorschau steht (LFH-664) — die
 * `unterEbene` von `components/Markdown.tsx`.
 *
 * Die Palette ist ein Dialog ohne eigene Gliederung, ihre Vorschau-Kopfzeile ist ein `<span>`.
 * 2 heisst: `#` im Text wird `h3`; der Lagebericht setzt seine Abschnittstitel als `h3`, sein
 * Text rückt entsprechend nach. EINE Konstante für ETB-Inhalt und Lagebericht, damit die beiden
 * Sorten in derselben Region nicht auf verschiedenen Ebenen beginnen.
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
 * Laden · ohne Verbindung · Fehler · „nicht mehr vorhanden" · Inhalt — EINMAL für alle Vorschau-Sorten
 * (LFH-664), statt elfmal in jedem Bauteil.
 *
 * Der dritte Zustand ist der Grund für diese Hülle. Die Vorschau liest ihren Datensatz per
 * `select` aus dem Listenfach der Palette. Ist er dort nicht mehr (gelöscht, aufgelöst, beim
 * ETB eine fremde `id` hinter der Nummer), ist die Abfrage weder am Laden noch gescheitert —
 * `data` ist schlicht `undefined`, und ohne eigenen Zweig bliebe die Vorschau leer. Das wäre
 * von „lädt noch" nicht zu unterscheiden.
 *
 * Ein Fehler BEI vorhandenem Stand (gescheitertes Nachladen) wirft den Stand nicht weg, sondern
 * zeigt ihn mit `SeitenStandVeraltet` — dieselbe Regel wie auf den Seiten.
 *
 * `sorte` ist die Nominalphrase mit Artikel („Die Meldung", „Der ETB-Eintrag"): sie beginnt
 * jeden der drei Sätze, und ein Artikel lässt sich aus dem Wort nicht ableiten.
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
  // An `isPending`, NICHT an `isLoading` (Review-Befund): eine kalte Abfrage OHNE NETZ steht
  // auf `pending` + `paused`, `isLoading` ist dann false und `data` undefined — sie fiele in
  // den Zweig „nicht mehr vorhanden" und behauptete etwas über einen Datensatz, den es gibt.
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

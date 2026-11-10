/**
 * Offenes Kontextmenü einer Fläche mit Datensätzen (LLH-1599, Spec `datensatz-aktionsmenue`,
 * `openspec/changes/archive/2026-11-09-lor2qhep-kontextmenue-tabellen/design.md` D1), herausgezogen aus der
 * `Datensicht` (LLH-1596 D7).
 *
 * EIN Menü je Fläche: gemerkt wird nur der Schlüssel des Datensatzes; Zeile und Einträge kommen je
 * Render frisch über `finde` und `eintraege`, damit Live-Daten und Rechte gelten. Verschwindet die
 * Zeile oder verliert sie alle Einträge, schließt das Menü im Render (abgeleiteter Zustand wie in
 * `MenueAusloeser`). Ausgelöst wird über `useKontextMenue`; der Aufrufer spreizt
 * `ausloeser(zeile)` auf das Element des Datensatzes und rendert `menue`.
 */
import { useState, type Key, type ReactNode } from 'react';
import { KontextMenue, type KontextMenueOffen } from './KontextMenue';
import type { WeitereAktionen } from './Datensicht';
import { kontextEintraege } from './datensichtKontext';
import type { MenueEintrag } from './MenueAusloeser';
import { useKontextMenue, type KontextHandler } from './useKontextMenue';

export interface DatensatzKontextOptionen<T> {
  /** Zeile zum Schlüssel aus den aktuellen Daten; `undefined` ⇒ weg, das Menü schließt. */
  finde: (k: Key) => T | undefined;
  schluessel: (zeile: T) => Key;
  /** Nach Rechte- und Zustandsprüfung. Leer ⇒ kein Menü, das Browsermenü bleibt. */
  eintraege: (zeile: T) => readonly MenueEintrag[];
  /** Name des Menüs für Hilfstechnik, MIT Kennung des Datensatzes (wie am ⋮). */
  zugaenglicherName: (zeile: T) => string;
  onWahl: (key: string, zeile: T) => void;
}

export interface DatensatzKontext<T> {
  ausloeser: <E extends Element = Element>(zeile: T) => KontextHandler<E>;
  /** Das Menü (oder `null`); einmal je Fläche rendern. */
  menue: ReactNode;
  /** Ein Menü ist offen (hält etwa die Zeilenschleuse der `Datensicht`). */
  offen: boolean;
}

export function useDatensatzKontextMenue<T>(
  optionen: DatensatzKontextOptionen<T>,
): DatensatzKontext<T> {
  const { finde, schluessel, eintraege, zugaenglicherName, onWahl } = optionen;
  const [kontext, setKontext] = useState<{ k: Key; offen: KontextMenueOffen } | null>(null);

  const ausloeser = useKontextMenue<T>({
    kannOeffnen: (zeile) => eintraege(zeile).length > 0,
    onOeffnen: (zeile, { anker, vorherFokus }) => {
      if (eintraege(zeile).length === 0) return false;
      setKontext({ k: schluessel(zeile), offen: { anker, vorherFokus } });
      return true;
    },
  });

  const zeile = kontext == null ? undefined : finde(kontext.k);
  const liste = zeile !== undefined ? eintraege(zeile) : [];
  if (kontext != null && liste.length === 0) setKontext(null);

  const menue =
    zeile !== undefined && kontext != null && liste.length > 0 ? (
      <KontextMenue
        offen={kontext.offen}
        eintraege={liste}
        zugaenglicherName={zugaenglicherName(zeile)}
        onWahl={(key) => onWahl(key, zeile)}
        onSchliessen={() => setKontext(null)}
      />
    ) : null;

  return { ausloeser, menue, offen: kontext != null };
}

/**
 * Kontextmenü aus einer Zeilenbeschreibung (`WeitereAktionen`, dieselbe Form wie `weitere` der
 * `Datensicht` und `KatalogTabelle.zeilenMenue`), für Listen und eigene Zeilen (LLH-1599 D3).
 * Dieselbe Beschreibung speist das ⋮ (`ZeilenMenueAusloeser`). Bei `laeuft` stehen alle Einträge
 * gesperrt; ohne Beschreibung (`undefined`, etwa ohne Schreibrecht) gibt es kein Menü.
 */
export function useZeilenMenueKontext<T>(
  menue: WeitereAktionen<T> | undefined,
  { finde, schluessel }: Pick<DatensatzKontextOptionen<T>, 'finde' | 'schluessel'>,
): DatensatzKontext<T> {
  return useDatensatzKontextMenue<T>({
    finde,
    schluessel,
    eintraege: (zeile) => (menue ? kontextEintraege({ weitere: menue }, zeile) : []),
    zugaenglicherName: (zeile) => menue?.zugaenglicherName(zeile) ?? '',
    onWahl: (key, zeile) => menue?.onWahl(key, zeile),
  });
}

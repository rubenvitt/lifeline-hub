/**
 * Direkteinstieg in „den richtigen" Datensatz eines Moduls (LFH-347 · M56).
 *
 * Verallgemeinert aus `pages/uhs/uhsAuswahl.ts`: dieselbe Aufgabenklasse — mehrere Orte
 * (UHS, BR), einer ist gerade der wichtige — hatte zwei Einstiegsmuster: UHS sprang direkt
 * hinein, BR zeigte eine Tabelle. Priorität: (1) gemerkte Auswahl, falls noch in der Liste,
 * (2) ältester aktiver (kleinste id — Anlage-Reihenfolge ist die id, unabhängig von
 * `erfasst_at`), (3) zuletzt angelegter. `null` bei leerer Liste.
 *
 * **Datei heißt `direkteinstiegKern.ts`, nicht `direkteinstieg.ts`** (Abweichung vom
 * Task-5-Brief, gemessen): der Brief-Dateiname kollidiert case-insensitiv mit
 * `Direkteinstieg.tsx` im selben Verzeichnis. Vites `resolve.extensions` prüft `.ts` vor
 * `.tsx` — auf einem case-insensitiven Dateisystem (macOS-Standard, Windows) traf
 * `import … from './Direkteinstieg'` deshalb still diese Datei statt der Komponente, ohne
 * Fehler: der Default-Export war schlicht `undefined`. Reproduziert per Minimal-Import;
 * `direkteinstieg`/`Direkteinstieg` war das einzige case-only-Basename-Paar im ganzen
 * `src`-Baum (repoweit gegengeprüft). Ein Konsument dieser Datei importiert ab jetzt
 * `'./direkteinstiegKern'` bzw. `'../../components/direkteinstiegKern'`.
 */
export function waehleDefaultEintrag<T extends { id: number }>(
  liste: T[],
  letzteId: number | null,
  istAktiv: (eintrag: T) => boolean,
): number | null {
  if (liste.length === 0) return null;
  if (letzteId != null && liste.some((e) => e.id === letzteId)) return letzteId;
  const aktive = liste.filter(istAktiv);
  if (aktive.length > 0) return Math.min(...aktive.map((e) => e.id));
  return Math.max(...liste.map((e) => e.id));
}

/** Merkt die zuletzt geöffnete Auswahl je Einsatz (überlebt Reload); ohne localStorage stumm. */
export function letzteAuswahlSpeicher(praefix: string) {
  const schluessel = (einsatzId: number) => `${praefix}:letzteAuswahl:${einsatzId}`;
  return {
    merke(einsatzId: number, id: number): void {
      try { localStorage.setItem(schluessel(einsatzId), String(id)); } catch { /* ohne Persistenz weiter */ }
    },
    lies(einsatzId: number): number | null {
      try {
        const wert = localStorage.getItem(schluessel(einsatzId));
        return wert ? Number(wert) : null;
      } catch { return null; }
    },
  };
}

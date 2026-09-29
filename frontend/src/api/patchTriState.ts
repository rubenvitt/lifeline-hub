/**
 * PATCH-Tri-State am Wire: der gemeinsame Unterbau aller Teil-Patch-Routen (LFH-266).
 *
 * DIE DREI ZUSTÄNDE. Ein Teil-Patch kennt pro Feld genau drei Aussagen:
 *
 *   | Absicht                | Wire-Form            | JSON              |
 *   |------------------------|----------------------|-------------------|
 *   | Wert setzen            | `{ notiz: 'Text' }`  | `{"notiz":"Text"}`|
 *   | Feld LEEREN            | `{ notiz: null }`    | `{"notiz":null}`  |
 *   | Feld NICHT ANFASSEN    | Key fehlt            | `{}`              |
 *
 * DIE FALLE: `undefined` ist KEIN vierter Zustand. antds `Select allowClear` liefert beim Leeren
 * `undefined` (gemeint: „leeren“), und `JSON.stringify` entfernt `undefined`-Keys ersatzlos; der
 * Server ließe das Feld unverändert, „Feld löschen“ scheiterte lautlos.
 *
 * Deshalb ZWEI Funktionen statt einer mit Flag, die Wahl ist an der Aufrufstelle zu sehen:
 *   - {@link normalisierePatch}: für Objekte aus EINEM Formular; `undefined` = „geleert“ → `null`.
 *   - {@link nurGesetzteFelder}: für von Hand gebaute Teil-Patches; `undefined` = „nicht
 *     angefasst“ → Key raus.
 * Die falsche Wahl ist Datenverlust, kein Fehler.
 *
 * Beide arbeiten nur über VORHANDENE Keys, nie über eine feste Feldliste: `aktualisiereTier`
 * wird mit einem Partial aus nur den Halter-Feldern aufgerufen, eine Feldliste injizierte dort
 * die übrigen Felder als `null`.
 *
 * Bewusst NICHT global in `apiSend`: für POST-Bodies heißt `null` „nicht gesetzt“, und bei
 * vielen Endpunkten hat `''` eine andere Bedeutung.
 */

/**
 * Wire-Form eines Teil-Patches: jedes Feld optional (fehlender Key = unverändert), kein
 * Feldwert `undefined`. Ohne `exactOptionalPropertyTypes` BENENNT der Typ den Vertrag nur; die
 * Laufzeit-Garantie liefert {@link normalisierePatch}, gepinnt in `patchTriState.test.ts` gegen
 * die SERIALISIERTE Form.
 */
type PatchWire<T> = { [K in keyof T]?: Exclude<T[K], undefined> | null };

/**
 * Feld-Helfer: EIN Formular-String → Wire-Wert. Trimmt, und macht aus einem leeren (auch
 * `undefined`) oder rein aus Leerraum bestehenden Wert ein explizites `null` = LÖSCHEN.
 *
 * Für hand-gebaute Payloads mit einzelnen nullable String-Feldern. Anders als
 * {@link normalisierePatch} TRIMMT er den Inhalt (Vertrag der Stammdaten-Formulare).
 */
export function leerZuNull(w: string | undefined): string | null {
  const t = w?.trim();
  return t ? t : null;
}

/**
 * Formular-Werte → Wire-Patch: `undefined` und rein aus Leerraum bestehende Strings werden zu
 * `null` = LÖSCHEN; alle anderen Werte bleiben unangetastet, Keys werden weder ergänzt noch
 * entfernt. Gesendete Werte werden NICHT getrimmt. Flach: verschachtelte Werte werden
 * durchgereicht.
 */
export function normalisierePatch<T extends object>(daten: T): PatchWire<T> {
  return Object.fromEntries(
    Object.entries(daten).map(([k, v]) => [
      k,
      v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v,
    ]),
  ) as PatchWire<T>;
}

/**
 * Hand-gebauter Teil-Patch → Wire-Patch: entfernt Keys mit `undefined` GANZ, das Feld bleibt
 * UNVERÄNDERT. Zweck ist der Spread, bei dem `undefined` unbeabsichtigt entsteht
 * (`halter_kontakt: kontakt ?? undefined`). Ein explizites `null` bleibt: „löschen“ ist eine
 * Absicht.
 */
export function nurGesetzteFelder<T extends object>(daten: T): PatchWire<T> {
  return Object.fromEntries(
    Object.entries(daten).filter(([, v]) => v !== undefined),
  ) as PatchWire<T>;
}

/**
 * Baut den fertigen PATCH-Body: normalisierte Nutzdaten plus das optionale Steuerfeld
 * `basis_geaendert_at` (optimistisches Lock).
 *
 * Das Steuerfeld wird NACH der Normalisierung angehängt: liefe es durch
 * {@link normalisierePatch}, würde ein leerer Baseline-String zu `null`, und `null` heißt für
 * den Server „kein Lock, bewusstes Overwrite“. Fehlt `basisGeaendertAt`, wird der Key gar nicht
 * gesetzt (ohne Lock schreiben).
 */
export function patchBody<T extends object>(
  daten: T,
  basisGeaendertAt?: string,
): PatchWire<T> & { basis_geaendert_at?: string } {
  const norm = normalisierePatch(daten);
  return basisGeaendertAt ? { ...norm, basis_geaendert_at: basisGeaendertAt } : norm;
}

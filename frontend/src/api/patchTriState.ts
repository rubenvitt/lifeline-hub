/**
 * PATCH-Tri-State am Wire — der gemeinsame Unterbau aller Teil-Patch-Routen
 * (LFH-266/F12, für den 14-Routen-Ausbau aus LFH-306 herausgelöst).
 *
 * Vorher lebte `leereWerteAlsNull` in `einsatzPerson.ts` und wurde von `einsatzTier.ts`
 * quer importiert. Bei 14 Routen wäre `einsatzPerson.ts` zum Import-Hub der halben
 * API-Schicht geworden; die Semantik gehört an ein eigenes Symbol, nicht an ein Modul,
 * das zufällig der erste Nutzer war. Es gibt bewusst KEINEN Re-Export-Shim in
 * `einsatzPerson.ts` — der alte Pfad soll verschwinden, nicht doppelt existieren.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * DIE DREI ZUSTÄNDE. Ein Teil-Patch kennt pro Feld genau drei Aussagen:
 *
 *   | Absicht                | Wire-Form            | JSON              |
 *   |------------------------|----------------------|-------------------|
 *   | Wert setzen            | `{ notiz: 'Text' }`  | `{"notiz":"Text"}`|
 *   | Feld LEEREN            | `{ notiz: null }`    | `{"notiz":null}`  |
 *   | Feld NICHT ANFASSEN    | Key fehlt            | `{}`              |
 *
 * DIE FALLE, die den mittleren Fall still verschluckt: `undefined` ist KEIN vierter
 * Zustand, sondern eine Mehrdeutigkeit der Formular-Schicht. antds `Select allowClear`
 * liefert beim Leeren `undefined` — gemeint ist „leeren" —, und `JSON.stringify` entfernt
 * `undefined`-Keys ersatzlos aus dem Body (`api/client.ts:apiSend`). Das Feld käme also
 * nie beim Server an, der ließe es — korrekterweise — unverändert, und „Feld löschen"
 * scheiterte lautlos: keine Exception, kein Fehler-Toast, nur ein Wert, der bleibt.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * DIE ENTSCHEIDUNG, DIE JEDER AUFRUFER TREFFEN MUSS. `undefined` kann zweierlei heißen,
 * und die beiden Lesarten sind exakt gegenläufig. Deshalb gibt es hier ZWEI Funktionen
 * statt einer mit Flag — die Wahl ist an der Aufrufstelle zu sehen:
 *
 *   - {@link normalisierePatch} — für Objekte, die aus EINEM Formular stammen. Jeder
 *     vorhandene Key wurde vom Formular gerendert, also ist `undefined` = „der Nutzer hat
 *     das Feld geleert" → `null` (LÖSCHEN).
 *   - {@link nurGesetzteFelder} — für von Hand gebaute Teil-Patches. Dort heißt
 *     `undefined` = „habe ich nicht angefasst" → Key raus (UNVERÄNDERT).
 *
 * Wer die falsche wählt, bekommt keinen Fehler, sondern Datenverlust: `normalisierePatch`
 * auf ein hand-gebautes `{ ...basis, notiz: undefined }` LEERT `notiz`.
 *
 * Beide arbeiten ausschließlich über VORHANDENE Keys und nie über eine feste Feldliste.
 * Das ist keine Stilfrage: `aktualisiereTier` wird aus `PersonenDetailPage` mit einem
 * Partial-Patch aus nur den Halter-Feldern aufgerufen. Eine Normalisierung über die
 * Feldliste des Typs würde dort die neun Identitätsfelder als `null` injizieren und beim
 * Halter-Entfernen still den halben Tierdatensatz leeren.
 *
 * BEWUSST NICHT global in `apiSend`: das träfe POST-Bodies und rund zwanzig weitere
 * Endpunkte mit, bei denen `''` eine andere Bedeutung hat. Und für POST gilt die Semantik
 * ohnehin nicht — dort heißt `null` schlicht „nicht gesetzt", nicht „löschen".
 */

/**
 * Wire-Form eines Teil-Patches: jedes Feld ist optional (fehlender Key = unverändert),
 * und kein Feldwert ist `undefined` — geleerte Felder tragen explizit `null`.
 *
 * EHRLICHE GRENZE: Das Projekt fährt ohne `exactOptionalPropertyTypes` (tsconfig.app.json),
 * deshalb erlaubt TypeScript an einer `?`-Property weiterhin `undefined`. Der Typ BENENNT
 * also den Vertrag, er erzwingt ihn nicht; die Laufzeit-Garantie liefert
 * {@link normalisierePatch}, und gepinnt ist sie in `patchTriState.test.ts` gegen die
 * SERIALISIERTE Form — der einzigen Ebene, auf der der Unterschied sichtbar wird.
 */
export type PatchWire<T> = { [K in keyof T]?: Exclude<T[K], undefined> | null };

/**
 * Formular-Werte → Wire-Patch: macht aus geleerten Feldern ein explizites `null`.
 *
 * `undefined` (geleertes `Select allowClear`) und ein rein aus Leerraum bestehender String
 * (geleertes `Input`/`TextArea`) werden zu `null` = LÖSCHEN. Alle anderen Werte bleiben
 * unangetastet, Keys werden weder ergänzt noch entfernt.
 *
 * NICHT enthalten, bewusst: ein getrimmt-gesendeter Wert. `' Muster '` geht ungetrimmt
 * raus — normalisiert wird nur der Sprung nach `null`, nicht der Inhalt. Das ist der
 * Bestandsvertrag; wer daran dreht, ändert 14 Routen gleichzeitig.
 *
 * Flach, mit Absicht: verschachtelte Objekte/Arrays werden als Wert durchgereicht, nicht
 * rekursiv normalisiert. Keine der Patch-Routen trägt heute verschachtelte Felder.
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
 * Hand-gebauter Teil-Patch → Wire-Patch: entfernt Keys mit `undefined` GANZ, statt sie zu
 * `null` zu machen. Das Feld bleibt damit UNVERÄNDERT.
 *
 * Zweck ist der Spread, bei dem `undefined` unbeabsichtigt entsteht:
 * `nurGesetzteFelder({ halter_person_id: id, halter_kontakt: kontakt ?? undefined })`
 * schickt `halter_kontakt` gar nicht erst mit, statt es zu leeren.
 *
 * Ohne diese Funktion wäre der einzige Weg zu „absent", den Key beim Bauen des Objekts
 * wegzulassen — und `{ a: undefined }` sieht im übrigen JS wie `{}` aus, hier aber gerade
 * NICHT (siehe {@link normalisierePatch}). Genau diese Verwechslung fängt sie ab.
 *
 * Ein explizites `null` bleibt erhalten: „löschen" ist eine Absicht, keine Lücke.
 */
export function nurGesetzteFelder<T extends object>(daten: T): PatchWire<T> {
  return Object.fromEntries(
    Object.entries(daten).filter(([, v]) => v !== undefined),
  ) as PatchWire<T>;
}

/**
 * Baut den fertigen PATCH-Body: normalisierte Nutzdaten plus das optionale Steuerfeld
 * `basis_geaendert_at` (optimistisches Lock, LFH-241/LFH-299/F10).
 *
 * Der Anhang passiert NACH der Normalisierung, und das ist der ganze Punkt dieser
 * Funktion: `basis_geaendert_at` ist ein Steuerfeld, kein Spaltenwert. Liefe es durch
 * {@link normalisierePatch}, würde ein leerer Baseline-String zu `null` — und `null`
 * heißt an dieser Stelle nicht „leeren", sondern für den Server „kein Lock, bewusstes
 * Overwrite". Aus einem 409-geschützten Schreibvorgang würde still ein blindes
 * Überschreiben. Bei 14 Routen ist das eine Regel, die niemand 14-mal neu erfinden soll.
 *
 * Fehlt `basisGeaendertAt`, wird der Key gar nicht erst gesetzt (nicht `null`) — genau die
 * Absent-Semantik, die „ohne Lock schreiben" bedeutet.
 */
export function patchBody<T extends object>(
  daten: T,
  basisGeaendertAt?: string,
): PatchWire<T> & { basis_geaendert_at?: string } {
  const norm = normalisierePatch(daten);
  return basisGeaendertAt ? { ...norm, basis_geaendert_at: basisGeaendertAt } : norm;
}

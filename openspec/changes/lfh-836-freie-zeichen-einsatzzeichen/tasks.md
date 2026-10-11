# Tasks

## 1. Abhängigkeiten

- [x] 1.1 Vor dem Upgrade messen und notieren: Größe des Lagekarten-Chunks und Precache-Summe aus `pnpm build`. Die Werte kommen nach `openspec/changes/lfh-836-freie-zeichen-einsatzzeichen/messung.md`.
- [x] 1.2 Alle vier `@einsatzzeichen/*` in `frontend/package.json` auf exakt `5.2.0` heben (`mise exec -- pnpm -C <abs>/frontend install`). Prüfen:
  - Der Guard `zeichen/einsatzzeichenVersionen.guard.test.ts` ist grün.
  - Die Vitest-Dateien unter `zeichen/`, `kraefte/`, `stab/` und `pages/lagekarte/` sind grün; Fachobjekte unverändert.

## 2. Backend: Speicherform und Prüfung (TDD)

- [x] 2.1 Migration anlegen (Nummer nach `git fetch origin alpha` und `scripts/check-migrationen.sh`, heute 0172). Rebuild von `freies_zeichen` nach design.md D2: `zeichen_spec TEXT`, `grundzeichen` nullable, CHECK genau eine Form, Fremdschlüssel, Index und Daten erhalten. Prüfen:
  - DB-Test „Bestandszeile überlebt mit allen Spalten und Fremdschlüsseln“.
  - Der CHECK lehnt beide Formen und auch keine Form ab.
  - `scripts/check-migrationen.sh` ist grün.
- [x] 2.2 Frontend-Skript, das `src/freies_zeichen/zeichen_werte.json` aus `@einsatzzeichen` erzeugt (D3), plus Vitest-Wächter, der die eingecheckte Datei gegen die installierte Bibliothek vergleicht. Prüfen: Der Wächter ist grün und wird rot, wenn ein Wert in der Datei testweise fehlt (Mutationsprobe).
- [x] 2.3 Rust-Prüfer für `zeichen_spec` nach D3 in `src/freies_zeichen/`, mit `include_str!` der Werteliste und `ZEICHEN_SPEC_MAX`. Unit-Tests zuerst rot, dann grün:
  - gültige `SymbolSpec`, gültige `state`/`pictogram`
  - kaputtes JSON, `v: 2`, unbekannte Art, fremdes Feld, unbekannter Wert
  - Dublette in einer Liste, `designation`, `labels`, Überlänge
- [x] 2.4 Repo und Route (`repo.rs`, `routes/freies_zeichen.rs`) nach D4: zwei Bodies, genau einer; PATCH-Tri-State um `zeichen_spec` erweitern; Altspalten beim neuen Body auf NULL, beim alten `zeichen_spec`. DTO `FreiesZeichenAnzeige` um `zeichen_spec` ergänzen. Prüfen mit den Integrationstests in `tests/freies_zeichen.rs`:
  - Spec anlegen und lesen, Altformat anlegen
  - beide Formen → 400, keine Form → 400, ungültige Spec → 400
  - PATCH Altzeile → Spec, PATCH nur Bezeichnung lässt die Form unberührt
  - Die Statuscode-Referenztests sind bewusst umbenannt, und `src/AGENTS.md` ist nachgezogen.
- [x] 2.5 Schwärzungs-Registry: `zeichen_spec` als `retain` eintragen. Der Guard `jede_einsatz_scoped_spalte_ist_klassifiziert` ist grün. Die INSERTs in `src/einsatz/repo.rs` und `purge_scheduler.rs` sind angepasst; deren Tests sind grün.
- [x] 2.6 `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien mitcommitten. `cargo test` für `freies_zeichen`, `lage_snapshot`, `schwaerzung` und `enum_wire_kontrakt` ist grün.

## 3. Leseadapter für freie Zeichen (TDD)

- [x] 3.1 `zeichen/freiesZeichen.test.ts` rot anlegen:
  - **Abbildungstest alt → neu** über alle Bestandskennungen aus dem Abgleich: 36 Grundzeichen, 84 Symbole (frei und im Grundzeichen), Organisationen, Fachaufgaben, Einheiten, Funktionen.
  - Je Zeile die erwartete wirksame Spec. `drawAnySpec` wirft nie; nicht Abbildbares ergibt Kaskade oder Platzhalter mit `vereinfacht: true`.
  - Die Näherungen nach D5 sind gepinnt.
- [x] 3.2 `zeichen/freiesZeichen.ts` umsetzen: `zeichen_spec`-Pfad, Altspalten-Pfad mit den Tabellen aus `fachobjektZeichen.ts` plus der Symboltabelle, Kaskade, Platzhalter `point`, Cache, `schluessel = 'ez|' + serializeAnySpec`. Die Tests aus 3.1 sind grün. Mutationsprobe: eine Kaskadenstufe entfernt → mindestens ein Test rot.
- [x] 3.3 Farbabbildung nach D6 (Alt-Hex → nächstes `TECHNICAL_FILL_TOKENS`-Token, Gleichstand nach Reihenfolge, entfällt ohne erlaubte Füllung). Tests:
  - `#cc0000` an Gefahr → `rot`
  - Farbe an Person → entfällt
  - gleiche Eingabe → gleiches Token
  - Gleichstandsfall gepinnt
- [x] 3.4 Snapshot- und Offline-Pfad: `snapshotDaten.ts` und `useLagekarteDaten.ts` über den Adapter. Tests:
  - Ein eingefrorener Snapshot mit Altfeldern zeichnet nach neuer Darstellung.
  - Ein Offline-Stand mit Altfeldern ebenso.

## 4. Karte und Inspector

- [x] 4.1 `markerIcons.ts` und `marker.ts` nach D8: freie Zeichen liefern den `ez|`-Schlüssel des Adapters; `tzIconKey`, `baueFreiesZeichenTz` und das `tz`-Feld entfallen. Tests in `markerIcons.test.ts`, `marker.test.ts`, `markerLayer.test.ts`, `spiderfy.test.ts` und `kartenLayer.test.ts` umgestellt und grün. Gleiche Spec bei Fachobjekt und freiem Zeichen ergibt denselben Schlüssel.
- [x] 4.2 `kartenbildResolver.ts` und `Kartenflaeche.tsx`: `tz|`-Zweig, `ladeTz` und `erzeugeTaktischesZeichen` entfernen. `kartenbildResolver.test.ts` und `zeichenDichte.test.ts` sind grün.
- [x] 4.3 `FreiesZeichenInspector.tsx`: Kachel über `EinsatzZeichen` mit dem Adapter, Rahmen nach Spec (Palettenfarbe, sonst Textrolle). Hinweis „vereinfacht dargestellt“ mit Alt-Kennung bei `vereinfacht`. Das entprellte Schreiben sendet `zeichen_spec`. In `FreiesZeichenInspector.test.tsx` sind die Szenarien der Spec belegt (Nachtmodus, Füllung, vereinfacht, Altzeile → Spec beim Ändern), und die Entprellungstests bleiben grün.
- [x] 4.4 `Inspector.tsx`: toten Zweig für freie Zeichen in `markerBildUrl` entfernen. `Inspector.test.tsx` ist grün.

## 5. Picker und „zuletzt verwendet“

- [x] 5.1 `FreiesZeichenPicker.tsx` nach D7:
  - Raster Grundzeichen aus `vocabulary(…, 'kind')` plus „Kein Grundzeichen“.
  - Raster Symbol aus `capabilities`/`states` bzw. `freestandingVocabulary` (`state`, `pictogram`, `animal-state`).
  - „Details“: Organisation, Fachaufgabe als `bodyMarks`, Einheit, Palettenfarbe, Bezeichnung. Die Achse „Funktion“ entfällt.
  - Kacheln über `EinsatzZeichen` mit `idPrefix`.

  Prüfen: Die Tests in `FreiesZeichenPicker.test.tsx` sind auf die Spec-Szenarien umgestellt und grün. Dazu gehören „Nur Zeichenbares“, „Piktogramm ohne Grundzeichen“ und „Farbe aus der Palette“; Tastatur, Suche und Enter sind unverändert. Jede angebotene Kombination zeichnet ohne Wurf (Eigenschaftstest über die Optionen).
- [x] 5.2 Kosten des Vokabulars messen: Test oder Benchmark für das Öffnen des Pickers und einen Grundzeichenwechsel. Ergebnis in `messung.md`. Optionen per `useMemo`.
- [x] 5.3 Aufrufer auf `zeichen_spec` umstellen: `Sidebar.tsx`, `ZeichenHierDialog.tsx` (Startentwurf), `useKartenInteraktion.ts` (POST-Body), `LagekartePage.tsx`, `api/types.ts` (Input-DTOs). Die Tests in `Sidebar.test.tsx`, `ZeichenHierDialog.test.tsx` und `useKartenInteraktion.test.tsx` sind umgestellt und grün.
- [x] 5.4 `zuletztVerwendet.ts` nach D10: neuer Schlüssel v2, Übernahme des alten Schlüssels über den Adapter, nicht Übersetzbares entfällt. `offline/geraetRaeumung.ts` räumt beide Schlüssel. Tests in `zuletztVerwendet.test.ts`:
  - Übernahme in Reihenfolge
  - kaputter Alteintrag entfällt
  - kaputter Speicher → leere Leiste
  - Deckel und Wiederverwendung wie bisher

## 6. Altpaket entfernen

- [x] 6.1 `TzProps`-ID-Typen lokal in `taktischesZeichen.ts` (D9), `grundzeichenAkzeptiert` entfernen. `stab/skizze`, `stab/fernmeldenetz.test.ts` und `pages/einsatzabschnitte/fuehrungsorganisation.test.ts` sind angepasst. `pnpm typecheck` ist grün.
- [x] 6.2 `taktische-zeichen-react` aus `package.json` und dem Lockfile entfernen. Prüfen:
  - `grep -rn "taktische-zeichen" frontend/src frontend/e2e frontend/package.json` liefert nichts außer Kommentaren mit Verweis auf die Historie.
  - `pnpm build` ist grün.
- [x] 6.3 Nach dem Umbau messen: Lagekarten-Chunk und Precache. Beide sind nicht größer als in 1.1; Werte in `messung.md`.

## 7. e2e, Sichtprüfung, Doku

- [ ] 7.1 e2e umstellen und grün:
  - `lagekarte-kartengrundlage.spec.ts`: neuer Body, zählt `ez|`.
  - `lagekarte-touch.spec.ts`: Kachel und Body.
  - `fokus-verdeckung.spec.ts` (Modus Taktisches Zeichen).
- [ ] 7.2 `lagekarte-smoke.spec.ts` ergänzen:
  - Ein freies Zeichen ist sofort als `ez|`-Bild da, mit 68 px bei Pixeldichte 2.
  - Nach einem Grundkartenwechsel ist es wieder da.
  - Ein Altzeichen (per API im alten Format angelegt) erscheint.

  `lagekarte-offline-precache.spec.ts` ist grün.
- [ ] 7.3 Sichtprüfung im Browser (Playwright, Tag und Nacht): Picker mit und ohne Grundzeichen, freie Zeichen auf der Karte, Inspector-Kachel, Altzeichen mit Platzhalter. Screenshots im Change-Ordner.
- [ ] 7.4 `pruefliste.md` Einsatztauglichkeit für Picker, freie Zeichen auf der Karte und Inspector, nach dem Muster aus LFH-835. Liegt im Change-Ordner, alle Kriterien belegt.
- [ ] 7.5 Anwenderdoku `docs/anwender/kapitel/lagekarte.md`, Abschnitt „Ein taktisches Zeichen setzen“: Text angepasst (Kein Grundzeichen, Palettenfarbe, keine Funktion), `quellen:` geprüft, Bild neu erzeugt mit `pnpm doku:bilder e2e/doku-bilder/lagekarte.bilder.ts`. Der Doku-Wächter ist grün.
- [x] 7.6 Folgetask auf dem Entwicklungsboard: Übergang beenden (alter Body → 400, Altspalten entfernen). Dazu ein Task für die Fachobjekt-Nachzüge (UHS ohne feste Hilfsorganisation, Fachaufgabe an der Führungskraft). Beide angelegt und in der Abschlussmeldung genannt.

## 8. Abschluss

- [ ] 8.1 `./scripts/check-all.sh` ist grün (ohne `| tail`), Ergebnis je Schritt notiert.

## Workflow follow-up

- `/opsx:archive` im selben Branch vor dem PR, samt Spec-Sync und Verweisen.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv; danach LFH-836 auf `in review`, nach dem Merge `shipped`.

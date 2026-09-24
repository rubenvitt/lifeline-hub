# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Vorlagen für die Berührpunkte eines neuen Moduls sind `abloesung` (LFH-635)
und `betreuung` (LFH-639).

## 1. Backend: Schema und Modul `verpflegung`

- [x] 1.1 Migration `0118_verpflegung.sql` mit den Tabellen `verpflegung_zeitfenster` und `verpflegung_ausgabe` nach design.md D1: CHECKs `>= 0` bzw. `menge > 0`, Teilmengen-CHECK, FK `nachforderung_id` mit `SET NULL`, Indizes. Vorher `ls migrations` und `git fetch` + `scripts/check-migrationen.sh`. Verifiziert durch `cargo test --lib db` (Migrationslauf) und je einen Repo-Test, der an beiden Teilmengen-CHECKs scheitert.
- [x] 1.2 `src/verpflegung/mod.rs`: Anzeige-DTOs `ZeitfensterAnzeige`, `AusgabeAnzeige`, `VerpflegungAnzeige`, Struct `Sonderkost` (fünf Felder), Bedarf/Ausgegeben/Fehlmenge; Eingabe-DTOs mit Validierung. Dazu `src/verpflegung/deckung.rs` als reine Funktion nach D2. Verifiziert durch Unit-Tests zu allen Szenarien von „Deckung und Unterdeckung“ ohne Uhr: Fehlmenge nicht negativ, Fehlmenge je Kostform, zurückgenommene Ausgaben zählen nicht (`cargo test --lib verpflegung`).
- [x] 1.3 `src/verpflegung/repo.rs`: `liste(einsatz)` sowie `zeitfenster_anlegen_tx`, `zeitfenster_aendern_tx` (Prüfung gegen den Effektivzustand, No-op bei Wertgleichheit) und `zeitfenster_loeschen_tx` (422 mit gültiger Ausgabe), jeweils mit `system_audit_tx` nach D5, mit der reinen Funktion `zeitraum_text(von, bis, tz)` (Org-Zeitzone, Vorgabe Europe/Berlin) und Tests beidseits beider Sommerzeitgrenzen gegen absolute Zeitpunkte; `ausgabe_erfassen_tx` (fremde Nachforderung → 404 über `nachforderung::repo::gehoert_zu_einsatz`) und `ausgabe_zuruecknehmen_tx` (422 beim zweiten Mal), beide ohne ETB. Verifiziert durch Repo-Tests zu jedem Spec-Szenario von „Verpflegungszeitfenster“, „Sonderkost als Teilmenge“, „Zeitfenster ändern und löschen“, „Ausgabe erfassen“, „Ausgabe zurücknehmen“ und „Einsatztagebuch“: ETB-Wortlaut mit altem und neuem Bedarf, keine ETB-Zeile bei Ausgabe oder Rücknahme, 422 ändert nichts.

## 2. Backend: Gates, Routen, Live, Schwärzung

- [x] 2.1 `einsatz/modul.rs`: `verpflegung` in `MODUL_KEYS` nach `material` (30 → 31), Marker `Verpflegung`, `PFAD_KEY` `/api/einsaetze/{id}/verpflegung`, Zeile in `marker_key_werte_stimmen`. Verifiziert durch die Unit-Tests in `modul.rs`.
- [x] 2.2 `live/mod.rs`: `LiveEvent::Verpflegung` (`ALLE` 30 → 31, `as_str`, Gate `["verpflegung"]`, Gate-Pin) und in `tests/enum_wire_kontrakt.rs` der Eintrag in `live_event_wire`. Verifiziert durch `cargo test --test enum_wire_kontrakt` und `cargo test --lib live`.
- [x] 2.3 `src/routes/verpflegung.rs` + `routes/mod.rs` + `app.rs`: die sechs Endpunkte aus design.md D4 mit `EinsatzLesezugriff/EinsatzSchreibzugriff<Verpflegung>`, `JsonBody`, `PfadParam` und `write_retry!`, danach zuerst `live.publiziere` (ETB), dann `LiveEvent::Verpflegung`. Verifiziert durch `cargo test --test verpflegung` mit Statuscode-Paaren (400/404/422, 403 Beobachter, 403 Modul aus, 409 bei abgeschlossenem Einsatz) und einem Durchstich Anlegen → Ausgabe → Rücknahme → Löschen, der die ETB-Treffer zählt. Das Ausgabe-DTO trägt nur `nachforderung_id`, und ein Test belegt, dass kein weiteres Nachforderungsfeld im JSON steht.
- [x] 2.4 Guards: `MODUL_GET_PFADE` in `tests/modul_override.rs`. `einsatz_kontext_guard` läuft ohne Ausnahme grün. Verifiziert durch `cargo test --test modul_override --test einsatz_kontext_guard`.
- [x] 2.5 Schwärzung: `TabellenRegel`s für beide Tabellen in `schwaerzung_registry.rs` (`ort` und `bemerkung` → `scrub`, Rest `retain`, `nachforderung_id` als FK). OpenAPI-Schemas in `api_doc.rs`, dann `scripts/check-typ-codegen.sh` laufen lassen und `openapi.json` und `types.generated.ts` mitcommitten. Verifiziert durch `cargo test --lib schwaerzung` (Registry-Mengenvergleich), einen Schwärzungstest zum Spec-Szenario „Einsatz schwärzen“ und das grüne Codegen-Skript.

## 3. Frontend: Unterbau

- [x] 3.1 `api/queryKeys.ts`: `EINSATZ_KEYS.verpflegung` und `EINSATZ_STREAM_EVENTS.verpflegung` (im selben Commit wie 2.2 oder direkt danach, vor dem ersten `tsc`), Factory `einsatzKeys.verpflegung(id)`. Literal-Pin in `queryKeys.test.ts`. Verifiziert durch `queryKeys.guard.test.ts`, `liveEvent.contract.test.ts` und `tsc`.
- [x] 3.2 `api/verpflegung.ts` (Client für die sechs Endpunkte) und die Aliase in `api/types.ts` samt Eingabe-Bodies. Verifiziert durch `api/verpflegung.test.ts` (Pfade, Methoden, Bodies).
- [x] 3.3 `theme/statusFarben.ts`: Vertragskarte `verpflegungDeckung` nach D3; `statusFarben.test.ts`: `ALLE_MAPS` 23 → 24, dazu der Name in der sortierten Namensliste. Verifiziert durch `statusFarben.test.ts` und `statusVertrag.guard.test.ts`.
- [x] 3.4 `verpflegung/deckung.ts`: `deckungEinstufung(zf, jetzt)` mit den Grenzfällen aus D2, Wire-Zeiten nur über `dayjs.utc`. Verifiziert durch `deckung.test.ts` gegen absolute Zeitpunkte: `jetzt == von`, eine Sekunde davor, Fehlmenge nur in einer Kostform, Überdeckung, Fehlmenge vor Beginn.
- [x] 3.5 `verpflegung/useBedarfsvorschlag.ts` nach D8: Queries nur bei bedienbarem Quellmodul (sichtbar und nicht gesperrt), ein 403 gilt als leere Quelle ohne Fehler und ohne Retry, kein Vorschlag statt 0, Hinweise „keine Belegung gemeldet“, „Untergrenze“ und „Stand jetzt“. Verifiziert durch einen Hook-Test je Spec-Szenario von „Bedarfsvorschläge aus Personal und Betreuung“; ist das Modul ausgeblendet oder gesperrt, fragt der Hook nichts an (Aufrufzähler); liefert die Quelle 403, bleibt das Feld leer und es erscheint keine Fehlermeldung.
- [x] 3.6 Registry und Routen: `modulRegistry.ts`-Eintrag zwischen `material` und `abloesung`, `verpflegungPfad` in `routing/deeplinks.ts`, `MODUL_ELEMENTE` in `App.tsx`. Verifiziert durch `sprungmarken.test.ts` (Reihenfolge Kräfte), `deeplinks.test.ts` und einen App-Test „Route rendert Page statt Stub“.

## 4. Frontend: Nachforderung mit Vorbelegung

- [x] 4.1 `routing/deeplinks.ts`: `nachforderungenPfad(eid, { vorbelegung? })` und `parseNachforderungVorbelegung`, der unbrauchbare Werte ganz verwirft. Verifiziert durch `deeplinks.test.ts`: Round-Trip durch `URLSearchParams` mit `&` und `=` im Text; Anzahl `0`, `-3` und `abc` verwerfen alles.
- [x] 4.2 `NachforderungFormular` bekommt die Prop `vorbelegung`; `NachforderungenPage` liest `?neu=1&…` beim Mount, öffnet das Formular vorbelegt und räumt die Parameter (apply-then-clean). Verifiziert durch Page-Tests: Formular offen mit Art, Anzahl, Bezeichnung und Begründung; die URL danach ohne Parameter; ein Neuladen öffnet nichts; eine unbrauchbare Vorbelegung öffnet die Erfassung leer.

## 5. Frontend: Seite

- [x] 5.1 `verpflegung/VerpflegungDialoge.tsx`: „Zeitfenster anlegen/bearbeiten“ und „Ausgabe erfassen“ auf `ErfassungsModal` nach D7, außerdem die Rücknahme-Rückfrage als `Modal` mit rotem Knopf. Verifiziert durch Dialog-Tests:
  - Feldbudget 4 bzw. 3 sichtbar, beim Aufklappen steigt die Zahl
  - kein `.ant-modal-footer`, der Knopf liegt im `<form>`
  - Vorschläge stehen vorbelegt, beim Bearbeiten als Hinweis ohne Überschreiben
  - Sonderkost über der Menge zeigt den 422-Grund am Dialog
  - Rücknahme mit `ant-btn-dangerous`, Abbrechen sendet nichts
- [x] 5.2 `verpflegung/ZeitfensterKarte.tsx`: Kopf, `StatusTag` aus `verpflegungDeckung`, Randfarbe, Kennzahlzeile, Aufgliederung, Sonderkost-Zeilen und Ausgaben als `Zeitachseneintrag`; Aktionen nach LFH-365 gebündelt (Zeilenkennung im zugänglichen Namen), „Nachfordern“ nur bei Fehlmenge und sichtbarem Modul, aufgelöster Nachforderungsname nur bei sichtbarem Modul. Verifiziert durch Karten-Tests:
  - „Unterdeckung“ mit Wort und `data-`-Marke, ohne `animation`
  - „offen“ ohne Alarm
  - Sonderkost-Fehlmenge wird genannt
  - zurückgenommene Ausgabe mit Wort
  - ohne Schreibrecht keine Aktionen
  - ohne Modul Nachforderungen kein „Nachfordern“ und „Nachforderung #n“ statt Name
- [x] 5.3 `pages/VerpflegungPage.tsx`: `EinsatzSeite` mit Kopf-Meta und Primäraktion, `Segmentleiste` „laufend & anstehend“/„vergangen“, Leerzustand, `RechteHinweis`, `zeigeRueckgaengig` nach dem Erfassen und `Sammelbanner` für fremde neue Zeitfenster. Die Uhr läuft über `useJetzt`. Verifiziert durch Page-Tests zu „Anzeige im Modul“, „Rechte und Modulsichtbarkeit“ (Oberflächenteil) und „Live-Verteilung“ (Sammelbanner statt Einschieben). Außerdem: Rückgängig ruft die Rücknahme, und ein Übergang über `von` wechselt die Einstufung.
- [x] 5.4 `stab/sachgebiete.ts`: S4 bekommt `['nachforderungen', 'verpflegung', 'material']`. Verifiziert durch `sachgebiete.test.ts` mit einem Pin auf die S4-Zeile.

## 6. Nachweise und Abschluss

- [x] 6.1 e2e: Verpflegungsroute in `e2e/gate1-ueberlauf.spec.ts` (gesätes Zeitfenster mit langer Bezeichnung und langem Ort) und ein Eintrag in `e2e/gate3-trefflaeche.spec.ts` für die Kartenaktionen (30 / 48 / 72 px). Die Stab-Werkzeugzählung wird geprüft. Verifiziert durch einen grünen `pnpm e2e` auf beiden Specs.
- [x] 6.2 Kontrast: `e2e/verpflegung-kontrast.spec.ts` nach dem Muster von `abloesung-kontrast.spec.ts` mit Messkern `e2e/kontrast-kern.ts`. Gemessen wird jeder Text der Karten und Dialoge in Tag- und Nachtmodus, gegen den Grund, auf dem er wirklich steht (LFH-618, Regel 3). Der kritische Fall ist „Unterdeckung“ auf der Alarmfläche im Tagmodus über `alarmText` (Regel 1). Dazu Karten- und Etikettrand. Verifiziert durch einen grünen Spec-Lauf und eine Mutationsprobe (Alarmfläche auf `alarm` → rot).
- [ ] 6.3 Browser-Sichtprüfung in Tag und Nacht: Anlegen mit Vorschlägen, Ausgabe mit Rückgängig, Unterdeckung, Nachfordern-Sprung, ETB-Einträge. Screenshots gehen in die Prüfliste.
- [ ] 6.4 Prüfliste Einsatztauglichkeit `docs/superpowers/specs/2026-09-24-lfh-634-pruefliste.md` nach dem Muster von LFH-635: alle 15 Kriterien mit Verdikt und Beleg.
- [x] 6.5 CLAUDE.md: Absatz zum Modul Verpflegung (Zeitfenster statt Schicht; Bedarf erfasst, nicht gerechnet; Nachschub nur über Nachforderung; Vertragskarte 24; Modulzähler bewusst keiner). Den Stand „Stand 22.09.2026: 18“ im Vertragskarten-Absatz nachziehen. Verifiziert durch Lesen des Diffs.
- [x] 6.6 Folgeticket „Offline-Fähigkeit der Verpflegungs-Ausgaben“ angelegt: LFH-688, im Proposal und Design nachgetragen.
- [ ] 6.7 Vor dem Merge: `git fetch`, `scripts/check-migrationen.sh` (ggf. `--umnummerieren`), dann `./scripts/check-all.sh` grün. Verifiziert durch das Log des Laufs.

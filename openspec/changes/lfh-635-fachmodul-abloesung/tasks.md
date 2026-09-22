# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst den roten Test,
dann den Code. Referenz für die Berührpunkte eines neuen Moduls ist der Stab-Commit
`ccdb3e76` (LFH-539).

## 1. Backend: Schema und Fristen-Unterbau

- [x] 1.1 Migration `0104_abloesung.sql` (Tabelle `einsatz_abloesung` laut design.md D1 mit CHECKs, partiellem UNIQUE `(einheit_id) WHERE status='laufend'`, Index `(einsatz_id, status, faellig_at)`; Spalte `einsatzabschnitt.abloesung_rhythmus_minuten`); vor dem Anlegen `ls migrations` und offene Branches auf Nummernkollision prüfen; verifiziert durch `cargo test --lib db` (Migrationslauf) und einen Repo-Test, der eine zweite laufende Schicht am UNIQUE scheitern sieht
- [x] 1.2 `erinnerung::repo`: `anlegen_aus_frist_tx` (Pool-Variante delegiert), `setze_auto_frist_tx` (Upsert, setzt `zuletzt_ausgeloest_at = NULL`), `oeffne_letzte_auto_tx`, `loesche_auto_tx`; Konstanten `OBJEKT_ABLOESUNG`/`OBJEKT_ABLOESUNG_VORWARNUNG` in `kommunikation/mod.rs`; verifiziert durch Repo-Tests: Verschieben löst erneut aus, Wiederöffnen löst NICHT erneut aus, Bestandstests von Auftrag/Meldung bleiben grün (`cargo test --lib erinnerung`)

## 2. Backend: Modul `abloesung`

- [x] 2.1 `src/abloesung/mod.rs`: Enums `AbloesungStatus`, `RhythmusQuelle`, `Einstufung` (Wire + `as_str`/`parse`), Anzeige-DTO `AbloesungAnzeige` (inkl. Einheits-/Abschnitts-/Ablöser-Name, `einstufung`), `VorgabeAnzeige`, reine Funktion `einstufung(faellig, jetzt)` mit Grenzfall-Tests (genau fällig, genau 30 min, 30 min + 1 s); verifiziert durch `cargo test --lib abloesung`
- [x] 2.2 `src/abloesung/repo.rs`: `liste(status, jetzt)`, `beginnen_tx` (Vorgabe/eigener Rhythmus, Abschnitt-Snapshot, beide Fristen, Vorwarnung nur wenn in der Zukunft, System-ETB), `aendern_tx` (Fälligkeit + Fristen neu, System-ETB, 422 bei abgelöster Schicht/Selbstablösung); verifiziert durch Repo-Tests zu jedem Spec-Szenario von „Schicht einer Einheit“ und „Schicht bearbeiten“
- [x] 2.3 `repo`: `vorgabe_setzen_tx` (Entscheidungs-ETB mit altem/neuem Wert, Weitergabe an laufende Schichten mit `rhythmus_quelle='abschnitt'` und `abschnitt_id` = Abschnitt samt Fristverschiebung) und `vorgaben(einsatz)`; verifiziert durch Tests „Vorgabe verkürzt“, „Eigener Rhythmus bleibt“, „Vorgabe entfernen“
- [x] 2.4 `repo`: `vollziehen_tx` (Status, Fristen schließen, Meldungs-ETB → `etb_vollzug_id`, Folgeschicht mit erbendem `abschnitt_id`/Rhythmus/Quelle und `vorgaenger_id` samt Fristen, 422 wenn der Ablöser schon läuft oder die Schicht schon abgelöst ist) und `zuruecknehmen_tx` (Folgeschicht + ihre Fristen löschen, Schicht wieder laufend, `oeffne_letzte_auto_tx` für beide Bezugstypen, Berichtigungs-ETB; 422 wenn die Folgeschicht vollzogen oder kein Vollzug vorhanden ist); verifiziert durch Tests zu allen Szenarien von „Vollzug mit Folgeschicht“ und „Rücknahme eines Vollzugs“, einschließlich Atomarität (422 ändert nichts)
- [x] 2.5 `einheit::repo::aufloesen`: in derselben Transaktion `loesche_auto_tx` für alle Schichten der Einheit; verifiziert durch einen Test „Einheit wird aufgelöst → keine offene Ablösungsfrist mehr“

## 3. Backend: Routen, Gates, Live, Scheduler

- [x] 3.1 `einsatz/modul.rs`: `abloesung` in `MODUL_KEYS` (27), Marker `Abloesung`, `PFAD_KEY`-Eintrag `/api/einsaetze/{id}/abloesungen`; verifiziert durch die Unit-Tests in `modul.rs`
- [x] 3.2 `live/mod.rs`: `LiveEvent::Abloesung` (`ALLE` 28, `as_str`, Gate `["abloesung"]`, Gate-Pin) und `tests/enum_wire_kontrakt.rs` (LiveEvent + drei neue Enums); verifiziert durch `cargo test --test enum_wire_kontrakt` und `cargo test --lib live`
- [x] 3.3 `src/routes/abloesung.rs` + `app.rs`: die sieben Endpunkte aus design.md D5 mit `EinsatzLesezugriff/EinsatzSchreibzugriff<Abloesung>`, `JsonBody`, `PfadParam`, `write_retry!`, danach `live.publiziere` (ETB) und `LiveEvent::Abloesung` ohne `art`; `tests/abloesung.rs` mit Statuscode-Paaren (400/404/422/403 Beobachter/403 Modul aus) und einem Durchstich Beginnen → Vollziehen → Zurücknehmen inklusive ETB-Treffern; verifiziert durch `cargo test --test abloesung`
- [x] 3.4 Guards: `MODUL_GET_PFADE` in `tests/modul_override.rs`; `einsatz_kontext_guard` ohne Ausnahme grün; verifiziert durch `cargo test --test modul_override --test einsatz_kontext_guard`
- [x] 3.5 Scheduler: für `bezug_typ` `abloesung*` zusätzlich `LiveEvent::Abloesung` mit `{einsatz_id, abloesung_id, art, titel, faellig_at}`; verifiziert durch einen Scheduler-Test (je ein Ereignis für Vorwarnung und Fälligkeit, beim nächsten Tick keines mehr)
- [x] 3.6 Schwärzung (`schwaerzung_registry.rs`, Tabelle + neue Abschnittsspalte) und OpenAPI (`api_doc.rs`), dann `scripts/check-typ-codegen.sh` und `openapi.json`/`types.generated.ts` mitcommitten; verifiziert durch `cargo test --lib schwaerzung`, `cargo test --test openapi_spec_aktuell` und das grüne Codegen-Skript

## 4. Frontend: Unterbau

- [x] 4.1 `api/abloesungen.ts` (Client, handgepflegte Request-DTOs), `api/types.ts`-Re-Export, `queryKeys.ts` (`EINSATZ_KEYS.abloesungen = 'einsatz-abloesungen'`, `abloesungVorgaben`, Stream-Event `abloesung`, Factories), `routing/deeplinks.ts` (`abloesungPfad`); verifiziert durch `queryKeys.test.ts` (Literal-Pin), `queryKeys.guard.test.ts`, `liveEvent.contract.test.ts`, `deeplinks.test.ts`
- [x] 4.2 `abloesung/einstufung.ts` (reine Einstufung + Zähler + Markengruppierung) mit denselben Grenzfällen wie 2.1; `theme/statusFarben.ts`: Vertragskarte `abloesungEinstufung` (Abdeckungstest 18 → 19, Literal-Liste); verifiziert durch `pnpm vitest run src/abloesung src/theme`
- [x] 4.3 Registry-Eintrag `abloesung` (Kategorie `kraefte`, hinter `bereitstellungsraeume`, `zaehlerQuelle: 'abloesung'`, Status `fertig`), `App.tsx` `MODUL_ELEMENTE`, `useModulZaehler` (Quelle + `berechneAbloesungZaehler`); verifiziert durch `modulRegistry.test.ts`, `useModulZaehler.test.ts` und den Backend-Guard `backend_modul_keys_decken_frontend_registry`

## 5. Frontend: Seite

- [x] 5.1 `pages/AbloesungPage.tsx` + `abloesung/AbloesungKarte.tsx`: `EinsatzSeite`, Segmentleiste laufend/abgelöst, Liste nach Fälligkeit, Karte mit Einstufung (Wort + Rand), Fälligkeit, Abschnitt, Beginn, Rhythmus/Quelle, Ablöser; `RechteHinweis` und gesperrte Primäraktion ohne Schreibrecht; verifiziert durch `AbloesungPage.test.tsx` (Ordnung, überfällige Karte mit Wort und `data-alarm`, Beobachter-Zweig)
- [x] 5.2 Erfassung: „Schicht beginnen“ (`ErfassungsModal`, 3 Felder, Einheiten ohne laufende Schicht), „Ablösung vollziehen“ (Zeit + Ablöser vorbelegt), Aktionen „Ablöser planen“/„Rhythmus ändern“ (Bündelung nach LFH-365, wenn ≥ 3), `zeigeRueckgaengig` nach Vollzug → Rücknahme; verifiziert durch Tests: Enter-Struktur der Masken (Knopf im `<form>`, kein `.ant-modal-footer`), Vollzug ruft POST und bietet Rückgängig an, Rückgängig ruft die Rücknahme
- [x] 5.3 Paneel „Rhythmus je Abschnitt“ mit Ein-Feld-Modal (Stunden, 0,5er-Schritte, leer = Vorgabe entfernen); verifiziert durch einen Test, der PUT mit Minuten und `null` belegt

## 6. Frontend: Alarm und Überblick

- [ ] 6.1 `useEinsatzLiveStream`: `onErinnerung` überspringt `abloesung*`, neuer Listener `abloesung` alarmiert nur mit `art` (faellig → Ton `alarm`, vorwarnung → `dezent`) und feuert `lfh:abloesung-alarm`; `AlarmZentrale`: Ziel `'abloesung'`, Titel, Deeplink, eigener Budget-Scope; verifiziert durch Tests im Muster der bestehenden Erinnerungs-Alarm-Tests (ein Hinweis, kein Doppelalarm, vierter Hinweis wird gebündelt)
- [ ] 6.2 Überblick: `naechsteMarken` mit Quelle `abloesungen` und Gruppierung (Abschnitt + Minute), `markenZiel` → `abloesungPfad`, Query nur bei sichtbarem Modul; verifiziert durch `ueberblickDaten.test.ts` („15:30 Ablösung Deichwache Nord, 2 Einheiten“, Einzelmarke, `MARKEN_MAX` gilt weiter) und `UeberblickPage.test.tsx` (Modul aus → keine Anfrage)

## 7. Abschluss

- [ ] 7.1 e2e: Route `/abloesung` in `gate1-ueberlauf.spec.ts` (kein waagerechter Überlauf bei 390 px) und `gate3-trefflaeche.spec.ts` (Trefffläche der Kartenaktion über zwei Dichtestufen); verifiziert durch `pnpm e2e` auf diese Specs
- [ ] 7.2 Prüfliste Einsatztauglichkeit `docs/superpowers/specs/2026-09-22-lfh-635-pruefliste.md` nach dem Muster LFH-46 (15 Kriterien, jede Zeile mit Verdikt und Beleg); verifiziert durch Lesen: keine Zeile „nicht geprüft“
- [ ] 7.3 Browser-Sichtprüfung im Dev-Stack mit Seeds: Schicht beginnen, Vorgabe verkürzen, Vollzug mit Folgeschicht, Rückgängig, Überblick-Marke, Hell/Dunkel; verifiziert durch Screenshots
- [ ] 7.4 Voller Gate-Lauf `./scripts/check-all.sh` grün; verifiziert durch Exit-Code 0

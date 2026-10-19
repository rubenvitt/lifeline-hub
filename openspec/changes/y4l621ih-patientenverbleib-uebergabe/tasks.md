# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (Test zuerst, rot, dann grün). Pfade im
Frontend relativ zu `frontend/src/`, im Backend relativ zu `src/`.

## 1. Datenmodell und Migration

- [x] 1.1 Test zuerst (`db::tests`, Muster `migration_0112_*`): Rebuild von `person_verbleib` erhält alle Zeilen samt Spalten aus 0121/0165/0217, Indizes (auch den eindeutigen `client_id`-Index) und `sqlite_sequence`; der CHECK nimmt `status = 'uebergeben'`, `transport_durch IN ('fremd','eigen')` und weist anderes ab. Prüfung: Test rot.
- [x] 1.2 Migration mit der nächsten freien Nummer über `origin/alpha` (heute 0222, `scripts/check-migrationen.sh`): Rebuild nach D1, neue Spalten `transport_durch`, `einsatz_fahrzeug_id` (Verweis `einsatz_fahrzeug`), Cache-Spalten `aktueller_transport_durch`, `aktuelles_einsatz_fahrzeug_id` an `einsatz_person` samt Backfill aus dem jüngsten Ereignis. Prüfung: Test aus 1.1 grün, `db::tests::migrationsnummern_sind_eindeutig` grün.
- [x] 1.3 Schwärzung: neue Spalten (Ereignis und Cache) in `einsatz/schwaerzung_registry.rs` einordnen: `transport_durch` wie Art/Status (`G_TRIAGE`), `einsatz_fahrzeug_id` wie `betreuungsstelle_id` (`G_FK`); der Funkrufname fällt mit `transportmittel`. Prüfung: Registry-Wächter grün, neuer Test „geschwärzter Eigentransport bleibt abgeschlossen“ grün.

## 2. Server: Verbleib, Übergabe, Versorgungszustand

- [x] 2.1 Test zuerst: Ableitung `versorgung` nach der Tabelle in D3, als Fall im gemeinsamen Fixture der Lageregeln (Spec `lage-verdichtung`) und als Rust-Test darauf. Prüfung: Test rot.
- [x] 2.2 Wire-Enums `TransportDurch` und `Versorgung`, `VerbleibStatus::Uebergeben`, Feld `versorgung` (und `aktueller_transport_durch`) in `PersonAnzeige`, Felder in `VerbleibAnzeige` (`person/mod.rs`, `person/repo.rs`, `verbleib_repo.rs`). Prüfung: Test aus 2.1 grün, `scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet.
- [x] 2.3 Test zuerst: Handler-Prüfungen aus D2 (422 Fahrer-Angabe bei anderer Art, 422 eigen ohne Fahrzeug, 422 Fahrzeug ohne eigen, 404 fremder Einsatz, 422 zur Erfassungszeit nicht disponiert, Erfolg bei vorgemerkter Erfassung vor der Entlassung, 422 `uebergeben` ohne eigen); Funkrufname als Momentaufnahme in `transportmittel`. Prüfung: Tests rot, dann grün nach 2.4.
- [x] 2.4 Prüfungen und Schreiben im Verbleib-Handler (`routes/einsatz_person.rs`, `verbleib_repo::erfassen_tx` pflegt die neuen Caches). Prüfung: Tests aus 2.3 grün, Replay mit `client_id` unverändert grün.
- [x] 2.5 Test zuerst, dann umsetzen: Kurzform und ETB-Sachverhalt nach D2 („im Eigentransport“, „übergeben“, Kurzformen mit und ohne Ziel). Prüfung: Tests der Spec-Szenarien „Übergabe im ETB und in der Kurzform“ grün.
- [x] 2.6 Test zuerst, dann umsetzen: `GET /api/einsaetze/{id}/personen/transportmittel` nach D4 (Lesezugriff Personen, am UHS-Gerät erlaubt, Gerät ohne Personen 403; aktive Dispositionen; fremde Vorschläge aus dem Einsatz ohne Dubletten, Stamm ohne disponierte; geschwärzte liefern nichts), Route in die Geräte-Freigabe, OpenAPI und Typ-Codegen. Prüfung: Tests grün, `scripts/check-typ-codegen.sh` grün.
- [x] 2.7 Lagemonitor zählt Patienten und Sichtung ohne Abgeschlossene (`routes/lagemonitor.rs`), gegen dasselbe Fixture. Prüfung: Rust-Test des Fixtures und Lagemonitor-Test grün.

## 3. Client: Bilanz, Filter und Verbleib-Maske

- [ ] 3.1 Test zuerst, dann umsetzen: `personen/personenBilanz.ts` liest `versorgung` (Vitest auf dem Fixture aus 2.1), `verbleibZaehlung` mit Posten „Unterwegs“, `transportBilanz` → `versorgungsBilanz`, `sichtungsbild` für die Lage ohne Abgeschlossene; `pages/uhs/uhsLage.ts` `transportiertAus` → `unterwegsAus`. Prüfung: Vitest grün, Szenarien „Verbleib-Zählung“ und „Transportiert / offen“ abgedeckt.
- [ ] 3.2 Test zuerst, dann umsetzen: `PersonenSicht.abgeschlossen` mit `?abgeschlossen=1`, `filterPersonen` blendet aus, Schalter „Abgeschlossene zeigen (n)“ in der Statusleiste von `pages/PersonenPage.tsx`, Sichtungszeile und Seitenleiste zählen ohne Abgeschlossene, Deeplink-Tests nachgezogen (`routing/deeplinks.test.ts`, `einsatz/sprungmarken.test.ts`). Prüfung: Vitest grün.
- [ ] 3.3 Lagekarte: `personen/personenKarte.ts` `personenMarker` ohne Abgeschlossene. Prüfung: Test „Abgeschlossener Patient verschwindet“ grün.
- [ ] 3.4 Lage-Dashboard: Zeile „Unterwegs / offen / abgeschlossen“, Kennzahl „Patienten“ ohne Abgeschlossene mit Notiz „n abgeschlossen“ (`pages/lage-dashboard/lageVerdichtung.ts`, `lagebild.ts`, `LagePaneele.tsx`; Lagebesprechungs-Vorbereitung folgt über `baueLagebild`); Einsatzbericht bleibt vollständig. Prüfung: `LageDashboardPage.test.tsx` und Verdichtungstests grün.
- [ ] 3.5 Test zuerst, dann umsetzen: `personen/verbleibErfassungKern.ts` (Feld „Rettungsmittel“, Body mit `transport_durch`/`einsatz_fahrzeug_id`, `uebergabeBody`), `useVerbleibFelder` mit `AutoComplete` in drei Gruppen, verstecktem Fahrzeugfeld, Marke „Eigentransport“/„fremdes Rettungsmittel“, Pflicht bei Transport; Query `einsatzKeys.personenTransportmittel` live und im Offline-Lagebild (`api/queryKeys.ts`, `offline/lagebildKuerzung.ts`). Prüfung: `VerbleibErfassung.test.tsx` mit den Szenarien „Einsatzfahrzeug wählen“, „Text nach Wahl geändert“, „Transport ohne Rettungsmittel“ grün; Feldbudget ≤ 3 sichtbar belegt.
- [ ] 3.6 „Übergabe quittieren“: Paneel im Patientenkopf (`personen/PatientenkopfPaneele.tsx`), Zeilenmenü der Liste (`personen/personenSpalten.tsx`), Dialog mit Uhrzeit (Textfeld nach Spec `zeiteingabe`) und Ziel, über `useSavePersonEintrag` (`'verbleib'`, offline vormerkbar). Prüfung: Tests „Übergabe am Krankenhaus“ und „Ohne Netz“ grün, `PersonenDetailPage.speicherfehler.test.tsx` grün.

## 4. UHS-Grundriss

- [ ] 4.1 Test zuerst, dann umsetzen: Grundriss nimmt `useVerbleibFelder` statt der eigenen Maske (Vorbelegung Art Transport). Prüfung: `Grundriss.test.tsx` Verbleib-Fälle grün, Betreuungsstelle und „Bestätigt von“ dort erreichbar.
- [ ] 4.2 Test zuerst, dann umsetzen: Zeile der Listen „Noch nicht aufgenommen“ und „Wartebereich“ zweizeilig nach D8 (`PersonenSpalte`, `grundrissLayout.ts`), „Verbleib“ sichtbar als Textknopf in der zweiten Zeile. Prüfung: `grundrissLayout.test.ts`, `Grundriss.test.tsx`, `GrundrissTabs.test.tsx` grün; e2e `trefflaeche-pruefflaechen.spec.ts` in allen drei Stufen grün; Bild bei 240 px Spaltenbreite zeigt den vollen Namen.
- [ ] 4.3 Test zuerst, dann umsetzen: Spalte „Unterwegs“ (`TransportSpalte`) mit Fahrzeug, Ziel, Dauer, Priorität, „Übergabe quittieren“ und Marke „Übergabe offen“ ab 60 min (`useMinutenTakt`); Abgeschlossene fehlen. Prüfung: Tests „Übergabe aus der Spalte“, „Fremdes Rettungsmittel“, „Lange unterwegs“ grün; `UhsLagezeile.test.tsx` grün.

## 5. Sichtungsboard

- [ ] 5.1 Test zuerst, dann umsetzen: `personen/Sichtungsboard.tsx` nach D9 (feste Spalten, Farbkopf mit Wort und Zahl, Karte mit Kennung, PAT-Nummer, Name, „gesichtet vor“, Aufenthalt, Priorität, Kontamination; Folge nach Sichtungszeit; Zuflussschleuse). Prüfung: Vitest für „Leere Kategorie“, „Patient im Eigentransport“, „Folge nach Wartezeit“, „Neue Sichtung unter dem Zeiger“ grün.
- [ ] 5.2 Bedienung: Karte als Link zur Detailseite, Sichtungsmarke mit `ZeilenSichtung`-Popover nur mit Schreibrecht, Bedienziele in Steuerhöhe; Zweig `raster` in `pages/PersonenPage.tsx` nutzt das Board, bestehende Raster-Tests in `PersonenPage.test.tsx` und `personenFilter.test.ts` auf das Board umgestellt. Prüfung: Vitest grün, axe ohne `nested-interactive`.
- [ ] 5.3 Schmaler Schirm: ab `lg` nebeneinander mit eigenem Bildlauf, darunter gestapelt und einklappbar, leere eingeklappt. Prüfung: e2e-Fall bei 390 px und 1440 × 900 ohne seitlichen Bildlauf grün (`e2e/betroffene-handy.spec.ts` erweitert).

## 6. Regeln und Anwenderdoku

- [ ] 6.1 `frontend/src/personen/AGENTS.md`: Abschnitte „Versorgungszustand und Abgeschlossene“ und „Sichtungsboard“; `frontend/AGENTS.md`, Regel „Kein Nutzerschalter Tabelle ↔ Karte“, um das Board als Überblick ergänzt; `src/AGENTS.md`, falls die neue Route eine Geräte-Freigabe braucht. Prüfung: Prettier über `frontend/` grün, Verweise per `grep` geprüft.
- [ ] 6.2 Anwenderdoku nach `docs/anwender/AGENTS.md` (Mitänderungsregel): `betroffene.md` (Abgeschlossene, Board, Übergabe), `unfallhilfsstellen.md` und `geraet-uhs.md` (Zeile, Spalte „Unterwegs“), `lagebild.md` (Patientenzahl). Prüfung: Wächter der Anwenderdoku grün.

## 7. Integration

- [ ] 7.1 e2e: Eigentransport aus dem Wartebereich, Patient in „Unterwegs“, Übergabe quittiert, Patient aus Liste und Board verschwunden, mit „Abgeschlossene zeigen“ wieder da. Prüfung: neuer Spec unter `frontend/e2e/` grün.
- [ ] 7.2 `superpowers:verification-before-completion` und `superpowers:requesting-code-review`; `./scripts/check-all.sh` vollständig grün (kein `| tail`). Prüfung: Gesamtstatus aus dem Lauf, Abweichungen im PR benannt.

## Workflow follow-up

- Freigabe des Entwurfs durch Ruben (Pflicht-Checkpoint), dann Aufgabe auf `in_progress` und `/opsx:apply`.
- Nach dem letzten Kästchen `/opsx:archive` samt Spec-Sync im selben Branch, dann der PR mit Plan, Umsetzung und Archiv.
- Design System „Lifeline Hub“ in Claude Design um den Baustein Sichtungsboard nachziehen (kein Zugriff aus der Cloud-Sitzung).

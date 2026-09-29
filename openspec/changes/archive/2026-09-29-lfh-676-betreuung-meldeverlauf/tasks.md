# Tasks

## 1. Backend: Meldereihen lesen

- [x] 1.1 Anzeige-DTOs `StandVerlaufEintrag` und `BelegungVerlaufEintrag` in `src/betreuung/mod.rs` (Felder nach design.md D1, `Option` mit `skip_serializing_if`), in `src/api_doc.rs` registrieren; verifiziert durch `cargo test` (Build) und `enum_wire_kontrakt` grün
- [x] 1.2 Repo-Funktionen `stand_verlauf` / `belegung_verlauf` in `src/betreuung/repo.rs`: zuerst Objekt im Einsatz prüfen (sonst `NotFound`), dann Reihe inkl. zurückgenommener, Ordnung `zeitpunkt_at DESC, id DESC`, `aktuell` aus dem Zeiger, Namen per Unterabfrage auf `benutzer.anzeigename`; Repo-Tests in `src/betreuung/repo/tests.rs` zuerst rot, dann grün: Szenario „Reihe mit Nachtragung und Rücknahme“ (Folge 480/300/212, nur 480 aktuell, 212 mit Rücknahmeangaben), leere Reihe, stornierter Bezirk liefert, fremder Einsatz 404, „erster nicht zurückgenommener = aktuell“
- [x] 1.3 Routen `GET …/bezirke/{bid}/staende` und `GET …/stellen/{sid}/belegungen` in `src/routes/betreuung.rs` (Gate `EinsatzLesezugriff<Betreuung>`, `PfadParam`) und in `src/app.rs` an die bestehenden Pfade hängen; Integrationstests in `tests/betreuung.rs`: Beobachter liest (200), Modul ausgeblendet 403, fremde Organisation 403/404, nicht numerische Sub-ID 400, Wire-Form (Zeitformat, fehlende Rücknahme-Keys per `contains_key` geprüft, nicht per `Value::Null`)
- [x] 1.4 `scripts/check-typ-codegen.sh` laufen lassen, `openapi.json` und `types.generated.ts` mitcommitten, Re-Export in `frontend/src/api/types.ts`; verifiziert durch grünes Skript

## 2. Frontend: Datenweg

- [x] 2.1 `ladeStandVerlauf` / `ladeBelegungVerlauf` in `api/betreuung.ts`; `einsatzKeys.betreuungVerlauf(einsatzId, art, id)` mit getyptem Token `'bezirk' | 'stelle'` in `api/queryKeys.ts`; verifiziert durch `queryKeys.test.ts`/Guards grün und einen Test, dass der Schlüssel mit dem Präfix `einsatzKeys.betreuung(einsatzId)` beginnt (Live-Invalidierung ohne neuen Event-Eintrag)

## 3. Frontend: `Datensicht` bekommt `aufklappen`

- [x] 3.1 Prop `aufklappen` (design.md D3) mit einem Aufklappzustand für beide Zweige; Kartenzweig: beschrifteter antd-`Button` mit `aria-expanded`/`aria-controls` unter den Sekundärfeldern, Region erst bei offen gerendert; Tabellenzweig: `expandIcon` als derselbe Knopf, kontrollierte `expandedRowKeys`; Tests zuerst rot: zugänglicher Name je Zeile, `aria-expanded` wechselt, Inhalt vor dem Aufklappen nicht im DOM, in beiden Zweigen
- [x] 3.2 DEV-Befund in `pruefeKartenplan`: `aufklappen` schließt `baum` und `aufklappzeile` aus; Test auf die Befundmeldung. Dateikopf-Kommentar von `Datensicht.tsx` (bisher: „`aufklappzeile` läuft nur im Tabellenzweig“) nachführen
- [x] 3.3 Prüfen, dass `datensicht.guard.test.ts`, `dichte.guard.test.ts` und `aktionsabstand.guard.test.ts` grün bleiben, `KARTEN_EIGENBAU` bleibt leer

## 4. Frontend: Verlauf und Rücknahme

- [x] 4.1 Reine Hilfen in `betreuung/verlauf.ts` (Wortlaut „480 evakuiert (gezählt)“ / „89 untergebracht“, Nachtragung über `istNachgetragen`, zugänglicher Name des Auslösers, Rückfragetext „aktueller Stand“ vs. „ändert sich nicht“); Unit-Tests zuerst rot, inkl. 20 s (kein Nachtrag) gegen 60 s (Nachtrag)
- [x] 4.2 Komponente `betreuung/MeldeVerlauf.tsx`: Abfrage beim Mount, Laden/Fehler/leer in Worten mit dem Fehlerwortlaut aus `PaneelZustand` (Fehler vor Altdaten; `PaneelZustand` selbst nicht, siehe design.md D5), Einträge aus `Zeitachseneintrag` nach design.md D5, Zeiten über `ZeitAnzeige format="kurz"`; Tests: Ladefehler zeigt Fehler und nicht „Noch keine Meldung“, aktuelle/nachgetragene/zurückgenommene Meldung je durch Wort erkennbar, Zeit in der Anzeigezone (Wire UTC → Ortszeit)
- [x] 4.3 Rückfrage-Modal nach design.md D6 (eigener State außerhalb der `map`, `danger`, `SpeicherFehler` im Dialog, `reset()` beim Öffnen, Erfolg per Toast), mit eigener Mutation über dieselben API-Funktionen (design.md D6); Tests: Abbrechen sendet nichts, Bestätigen sendet genau einen POST auf die richtige Meldungs-ID, Fehler bleibt im offenen Dialog und nicht in `.ant-message`, kein Auslöser an zurückgenommenen Meldungen, ohne Schreibrecht und an geschlossener Stelle keine Auslöser, an geschlossener Stelle genau eine Hinweiszeile
- [x] 4.4 `EvakuierungBlock` und `StellenBlock` hängen `aufklappen` mit Etikett „Verlauf“ an („Verlauf zu Bezirk …“ / „Verlauf zu Stelle …“), `BetreuungPage` reicht Schreibrecht und Mutationen durch; Seitentests: Auslöser auch ohne Schreibrecht da, Aufklappen ruft genau den Verlaufs-Endpunkt, vorher kein Abruf

## 5. Nachweise im Browser

- [x] 5.1 `e2e/gate3-trefflaeche.spec.ts`, Abschnitt Betreuung: Verlaufsauslöser (Karte und Tabelle) und „Zurücknehmen“ tragen die Staffelhöhe; verifiziert durch grünen Lauf
- [x] 5.2 `e2e/gate1-ueberlauf.spec.ts`, Betreuungsroute: mit aufgeklapptem Verlauf in Karte und Tabelle kein waagerechter Überlauf des Rumpfs; verifiziert durch grünen Lauf
- [x] 5.3 Handprobe im Dev-Stack: Bezirk mit drei Meldungen inkl. Nachtragung, ältere Meldung aus dem Verlauf zurücknehmen, ETB zeigt „bleibt N“; zweiter Browser sieht die Rücknahme im offenen Verlauf ohne Neuladen

## 6. Abschluss

- [x] 6.1 Prüfliste Einsatztauglichkeit (15 Kriterien) für die geänderte Betreuungsseite als `openspec/changes/lfh-676-betreuung-meldeverlauf/pruefliste.md`, jede Zeile mit Verdikt; Kriterium 12 mit der Begründung aus design.md „Risks“
- [x] 6.2 Nachzug auf dem Entwicklungsboard anlegen (Skill `clickup-task-anlegen`): `FahrzeugePage` auf `aufklappen` umstellen und `aufklappzeile` streichen; Ticketnummer im Dateikopf von `Datensicht.tsx` und in design.md D3 nachtragen
- [x] 6.3 CLAUDE.md: Absatz zum Betreuungsverlauf (Lesen über die Reihe, `aktuell` aus dem Zeiger, Nachtragung = ETB-Schwelle, Rückfrage mit Grund im Dialog, `aufklappen` als Aufklappweg der `Datensicht`)
- [ ] 6.4 `./scripts/check-all.sh` vollständig grün

# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests mit `cargo test --test <datei>`, Frontend-Gates aus dem Frontend-Ordner über
`mise exec -- pnpm …` (ohne mise: `pnpm` aus `/opt/node22`). Verschobene Dateien per `git mv`,
Umbenennungen nach LFH-1312 als eigener `refactor`-Commit.

## 1. Backend: Modul-Key und Herauslösen aus dem Stab (D1, D2, D4)

- [ ] 1.1 `lagebesprechung` in `MODUL_KEYS` zwischen `auftraege` und `stab`, Marker `Lagebesprechung`, `PFAD_KEY` für `…/lagebesprechung` und `…/lagebesprechungen`; `marker_key_werte_stimmen`, `tests/einsatz_kontext_guard.rs`, `tests/modul_freigaben.rs` grün (Länge 32)
- [ ] 1.2 Lagebesprechungsteile per `git mv`/Ausschneiden von `src/stab/{mod,repo}.rs` nach `src/lagebesprechung/{mod,repo}.rs` (Typen `LagebesprechungAnzeige`, `LagebesprechungAbschluss`, `render_snapshot`, Abschluss-Transaktion unverändert); `cargo build` grün, `tests/aufbewahrung_e2e.rs` `AUSNAHMEN_SYSTEM_ETB` auf die neue Datei umgestellt und grün
- [ ] 1.3 `src/routes/lagebesprechung.rs`: `GET …/lagebesprechung` (`LagebesprechungStand`), `GET`/`POST …/lagebesprechungen` mit `EinsatzLesezugriff`/`EinsatzSchreibzugriff<Lagebesprechung>`; Routen in `src/app.rs`, `src/routes/mod.rs`, `src/api_doc.rs`; die alten `…/stab/lagebesprechungen`-Routen und die drei Felder aus `StabAnzeige` entfernt; Lagebesprechungs-Tests aus `tests/stab.rs` nach `tests/lagebesprechung.rs` verschoben und auf die neuen Pfade umgestellt, alle grün
- [ ] 1.4 Gate-Tests in `tests/lagebesprechung.rs`: Stab ausgeblendet → Lagebesprechung lesen und abschließen gelingt; Lagebesprechung ausgeblendet → 403 für Lesen und Schreiben; fremde Org → 404; Beobachter liest, schreibt 403; System-Admin ohne Einsatzrolle schreibt 403
- [ ] 1.5 `tests/modul_override.rs`: `lagebesprechung` in `MODUL_GET_PFADE` mit seinem GET-Pfad, Eintrag `stab` in `OHNE_EIGENE_ROUTEN` geprüft und berichtigt; `jeder_ausblendbare_modul_key_ist_guard_abgedeckt` grün. Der Abgleich `backend_modul_keys_decken_frontend_registry` braucht den Registry-Eintrag, deshalb landen 1.1 und 4.1 im selben Commit
- [ ] 1.6 Entschluss-Grenze (D10): `entschluss` länger als `etb::INHALT_MAX` → 400, nichts gespeichert; Test `zu_langer_entschluss_ist_400`

## 2. Backend: Termin-Schreibweg und Kopf-PATCH (D3)

- [ ] 2.1 `PUT …/lagebesprechung/termin` mit Body `{ naechste_at: string | null }` (Schlüssel Pflicht, sonst 400), Schreiben mit `IS NOT ?1`, `fordere_aktiv` (409), Antwort `LagebesprechungStand`; Tests: setzen, leeren, unverändert, abgeschlossener Einsatz 409, Beobachter 403, kein ETB-Eintrag entsteht
- [ ] 2.2 `KopfdatenPatch`: gesetztes `naechste_lagebesprechung_at` (auch `null`) → 400 mit Hinweis auf das Modul, nichts geschrieben; `tests/einsatz.rs` `lagebesprechung_patch_*` durch diesen Fall ersetzt, `lagebesprechung_respektiert_einsatzrechte_und_abschluss` nach `tests/lagebesprechung.rs` auf den neuen Weg umgestellt
- [ ] 2.3 `EinsatzAnzeige` trägt den Termin unverändert für alle Mitglieder; bestehender Test in `tests/modul_override.rs` (`einsatzkopf_erreicht_*`) grün

## 3. Backend: Live-Ereignis und Migration (D5, D6)

- [ ] 3.1 `LiveEvent::Lagebesprechung` (Wire `lagebesprechung`, Gate `["lagebesprechung"]`), Pin-Tabelle in `src/live/mod.rs`, `tests/enum_wire_kontrakt.rs`; Kommentar an `LiveEvent::Stab` auf Besetzung/Checkliste gekürzt
- [ ] 3.2 Abschluss und Termin verteilen `lagebesprechung` (Abschluss zusätzlich `etb`), nie `stab`; `kopf_geaendert` nur bei geändertem Termin; `tests/einsatz_live.rs`: die drei `lagebesprechung_*`-Tests auf `lagebesprechung` statt `stab` umgestellt, neu: Termin per PUT geändert → `einsatz`, unverändert → kein `einsatz`, Leser mit Stab- aber ohne Lagebesprechungs-Recht erhält nichts
- [ ] 3.3 Migration `0182_lagebesprechung_modul.sql` laut design.md D5 (Nummer vorher mit `git fetch origin alpha && scripts/check-migrationen.sh` geprüft); Test `tests/lagebesprechung_migration.rs` (oder bestehendes Migrationsmuster): Stab-Rolle je Einsatz und je Org wird übernommen, Stab-Ausblendung nicht, ohne Stab-Vorgabe keine Zeile
- [ ] 3.4 Typ-Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet

## 4. Frontend: Registry, Route, API, Query-Keys (D1, D2, D6)

- [ ] 4.1 Registry-Eintrag `lagebesprechung` (Führung, zwischen Aufträge und Stab, `beschreibung: 'Termin, Vorbereitung, Entschluss'`, Stab-`beschreibung` auf `'S1–S6'`); `modulRegistry.test.ts` (Reihenfolge-Pin), `sprungmarken.test.ts`, `ModulPanel.test.tsx` und `tests/modul_override.rs::backend_modul_keys_decken_frontend_registry` grün
- [ ] 4.2 Icon nach Rubens Wahl (Open Question) über `icons/index.ts`; bis dahin kein Platzhalter-Commit, Aufgabe blockiert nur 4.2
- [ ] 4.3 `routing/deeplinks.ts`: `lagebesprechungPfad(id, { neu? })` mit Test; `App.tsx` `MODUL_ELEMENTE.lagebesprechung`
- [ ] 4.4 API-Modul `api/lagebesprechung.ts` (Stand, Verlauf, Abschluss, Termin) und Entfernen von `ladeLagebesprechungen`/`schliesseLagebesprechungAb` und der Lagebesprechungsfelder aus `api/stab.ts`; `tsc` grün
- [ ] 4.5 Query-Keys: Prefix `einsatz-lagebesprechung` (`lagebesprechung`, `lagebesprechungen`) live über `lagebesprechung`, `einsatz` invalidiert `lagebesprechung(id)` statt `stab(id)`, `stabLagebesprechungen` entfernt, `LAGEBILD_OFFLINE` unverändert mit Begründung; `queryKeys.test.ts`, `queryKeys.guard.test.ts`, `liveEvent.contract.test.ts`, `lagebildOffline.guard.test.ts` grün

## 5. Frontend: Seite Lagebesprechung (D7)

- [ ] 5.1 Bausteine per `git mv` nach `frontend/src/lagebesprechung/` (`LagebesprechungStand`, `LagebesprechungHistorie`, `LagebesprechungModal`, `lagebesprechungAbschluss`, `lagebesprechungZustand`, `abschlussToast`, `VorbereitungPaneel`, `vorbereitung` samt Tests), Importe nachgezogen; Vitest der verschobenen Tests grün
- [ ] 5.2 `pages/LagebesprechungPage.tsx`: `EinsatzSeite` mit Primäraktion „Lagebesprechung abschließen“ (gesperrt mit `RechteHinweis` ohne Schreibrecht), Leser `?neu=1` (öffnet Modal, wird geräumt); Vitest: Primäraktion, `?neu=1`, Beobachter gesperrt, abgeschlossener Einsatz; `schnellaktionen.guard.test.ts` grün
- [ ] 5.3 Paneel „Termin“: taktische Zeit groß, Zustand („in 25 min“, „kein Termin“, „jetzt fällig“, „seit 5 min überfällig“ im Ton `achtung`) im 30-s-Takt, Schnellwahl +30 min/+1 h/+2 h ab `serverJetzt()`, „kein Termin“, „Termin wählen“ über `ZeitpunktEingabe`; Vitest: jede Schnellwahl sendet den erwarteten UTC-Zeitpunkt, „kein Termin“ sendet `null`, Fehler steht am Paneel, ohne Schreibrecht gesperrt mit Grund
- [ ] 5.4 Paneel „Vorbereitung“ eingehängt; `vorbereitung.ts` führt „Letzte Lagebesprechung“ und „Nächster Termin“ mit Quelle `lagebesprechung`; Vitest: Stab gesperrt → beide Zeilen zeigen Werte, Lagebesprechung-Quelle fehlt → „—“ mit Grund
- [ ] 5.5 Paneel „Verlauf“: alle Besprechungen, neueste zuerst, `Liste` mit `h3`-Titel „Nr. n · Zeit“, Entschluss gekürzt mit Aufklappen, Termin beim Abschluss, ETB-Sprung; leer: „Noch keine Lagebesprechung abgeschlossen“; Vitest für Reihenfolge, Leerzustand, ETB-Ziel, Überschriftenebene
- [ ] 5.6 Modal: Entschluss-Grenze `ETB_INHALT_MAX` mit Zähler; `LagebesprechungModal.test.tsx` grün
- [ ] 5.7 Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` in dieser Change, jede Zeile mit Verdikt; e2e: Dichte-Staffel und Bedienziele in `trefflaeche-pruefflaechen.spec.ts`, Handy 390 px ohne Querlauf (neue `lagebesprechung-schmal.spec.ts` oder bestehendes Muster)

## 6. Frontend: Einstiege und Abnehmer (D8)

- [ ] 6.1 Stab-Seite: Paneele „Lagebesprechung“ und „Vorbereitung“, Kopfaktion, Leser `neu` und `neueZeile` entfernt; Termin-Zeile aus dem Einsatzkopf mit Zustand als Sprung auf `lagebesprechungPfad`, gesperrt mit `KEINE_BERECHTIGUNG` bei `istSprungGesperrt('lagebesprechung')`; `StabPage.test.tsx` und `StabPage.palette.test.tsx` nachgezogen bzw. entfernt, Dateikopf-Kommentar angepasst
- [ ] 6.2 Überblick: Marke „Lagebesprechung“ springt auf `lagebesprechungPfad`, Sperre nach `lagebesprechung`; Vitest zur Marke mit und ohne Freigabe
- [ ] 6.3 Palette: Schnellaktion mit Träger `lagebesprechung`, Ziel `lagebesprechungPfad(id, { neu: true })`, `kennung: 'stab'` mit Kommentar (Id `aktion:stab` bleibt); `befehle.test.ts`, `befehle.modulstatus.test.ts`: Stab ausgeblendet → Zeile da, Lagebesprechung ausgeblendet → Zeile fehlt
- [ ] 6.4 Einsatzdaten: Zeile „Nächste Lagebesprechung“ samt LFH-1251-Kommentar entfernt, `naechste_lagebesprechung_at` aus dem PATCH-Typ des Clients; `EinsatzdatenPage.test.tsx` belegt die Abwesenheit
- [ ] 6.5 Lagebericht-Übernahme (`lageentwicklungUebernahme.ts`) und Einsatzbericht (`druck/einsatzbericht/quellen.ts`, `abruf.ts`, `verdichtung.ts`) lesen über die neuen Endpunkte mit Freigabe `lagebesprechung`; zugehörige Vitest grün
- [ ] 6.6 e2e nachgezogen: `stab-vorbereitung.spec.ts` → Seite Lagebesprechung, `einsatzkopf-live.spec.ts` (Termin per Schnellwahl statt Einsatzdaten), `etb-chronologie.spec.ts` (Termin über die neue Seite oder API), `gate3-trefflaeche.spec.ts` und `fugenraster-leerzelle.spec.ts` (Stab-Region), `einsatzdaten-schmal.spec.ts`, `einsatzbericht-druck.spec.ts`; neue e2e Termin → Vorbereitung → Abschluss → Verlauf

## 7. Regeln (D9)

- [ ] 7.1 Neue `frontend/src/lagebesprechung/AGENTS.md` mit Geltungsbereich, „Vorbereitung der Lagebesprechung“, „Überfälliger Besprechungstermin“ (aus `frontend/src/stab/AGENTS.md` verschoben) und „Ein Termin, ein Schreibweg“; in `frontend/src/stab/AGENTS.md` gelöscht
- [ ] 7.2 Wurzel-`AGENTS.md` Regeltabelle (neue Zeile, Stab-Zeile gekürzt; Datei unter 200 Zeilen) und `frontend/AGENTS.md` (Verweisblock Stab, LFH-463-Zeile, „Der Einsatzkopf ist live“, „Eine Heimat je Zahl“) nachgezogen; `grep -rn "stab/AGENTS.md" frontend src` zeigt keinen Verweis auf die verschobenen Abschnitte mehr; Prettier über `frontend/` grün

## 8. Anwenderdoku (D11)

- [ ] 8.1 Kapitel `docs/anwender/kapitel/lagebesprechung.md` (Kopf mit vier Schlüsseln, `reihenfolge: 470`, `quellen`), Zeile in `README.md`; `stab.md`, `einsatzdaten.md`, `ueberblick.md`, `ohne-netz.md` nachgezogen; `anwenderdoku.guard.test.ts` grün
- [ ] 8.2 Bilder-Spec `frontend/e2e/doku-bilder/lagebesprechung.bilder.ts` (termin, vorbereitung, lagebesprechung, je hell und dunkel), alte Bilder aus `bilder/stab/` und ihre Stellen in `stab.bilder.ts` entfernt, `einsatzdaten.png` neu; erzeugt mit `pnpm doku:bilder --grep "lagebesprechung|stab|einsatzdaten"`, jedes Bild ≤ 300 KB; gelingt der Lauf in der Sitzung nicht, steht das im PR und die Aufgabe bleibt offen

## 9. Integration

- [ ] 9.1 `./scripts/check-all.sh` grün (Bündel laut Skriptkopf), insbesondere Typ-Codegen, Migrationsnummern, Prettier/rustfmt, Vitest, Rust-Tests
- [ ] 9.2 Manuell am laufenden System (Backend `cargo run --features dev-seeds`, Vite): Stab ausblenden → Lagebesprechung voll nutzbar; Termin per Schnellwahl → Überblick und Stab-Zeile folgen auf zweitem Tab; Abschluss → ETB-Eintrag und Verlauf

## Workflow follow-up

- Vor dem PR `/opsx:archive llj8s2rt-lagebesprechung-eigenes-modul` im selben Branch: Spec-Sync, Purpose von `lagebesprechung-vorbereitung` auf „Seite Lagebesprechung“ anpassen, Verweise nachziehen.
- PR gegen `alpha`, Zunder-Aufgabe auf `review` mit `pr_url`, dann `release_task`.
- Vermerk zu LFH-852 (design.md D12) als Notiz an die Zunder-Aufgabe.

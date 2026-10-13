# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests mit `cargo test --test <datei>` bzw. `cargo test --lib <pfad>`,
Frontend-Gates aus dem Frontend-Ordner über `mise exec -- pnpm …` (ohne mise: `pnpm` aus
`/opt/node22`).

## 1. Backend: Speicherung und Migration (D1)

- [x] 1.1 Migration `0185_modul_sichtbarkeit_org.sql` laut design.md D1 (Nummer vorher mit `git fetch origin alpha && scripts/check-migrationen.sh` geprüft): `org_modul_einstellung.sichtbar` neu, Neubau von `einsatz_modul_override` mit nullbarer `sichtbar`, `1 → NULL`, `0` bleibt. Migrationstest in `src/db.rs` nach dem Muster von `0184`: Zeile `sichtbar = 1` mit Rolle → `NULL` mit Rolle, Zeile `sichtbar = 0` → `0`, Org-Zeilen tragen `sichtbar = NULL`. `test_pool_gleicht_einer_frisch_migrierten_db` und `db::tests::migrationsnummern_sind_eindeutig` grün
- [x] 1.2 `modul_override`: `EinsatzModulOverride.sichtbar: Option<bool>`, `setzen` nimmt `Option<bool>`; Repo-Tests auf `Some`/`None` erweitert (Upsert auf `None` setzt `NULL`), grün
- [x] 1.3 `org::modul_einstellung`: `laden_alle` liefert `OrgModulVorgabe { benoetigte_rolle, sichtbar: Option<bool> }`; `setzen` nimmt die Rolle und eine Sichtbarkeit „unverändert / sichtbar / ausgeblendet“ und schreibt nur `0` oder `NULL`. Repo-Tests: Ausblenden, Wieder-Einblenden ergibt `NULL`, „unverändert“ lässt eine Ausblendung beim Rollenwechsel stehen, Org-Isolation; grün

## 2. Backend: Auflösung (D2)

- [x] 2.1 `effektiv_sichtbar(einsatz, org)` in `src/einsatz/effektiv.rs` mit Tests (Einsatz schlägt Org in beide Richtungen, Org ohne Einsatz, beide leer → `true`)
- [x] 2.2 `modul_freigabe` und alle Aufrufer (`fordere_modul_zugriff`, `lade_modul_regeln`, `gesperrt_fuer_geraet`, `modul_freigaben`) auf `OrgModulVorgabe` umgestellt, `sichtbar` über `effektiv_sichtbar`. Unit-Tests in `berechtigung.rs` für die vier Akzeptanzfälle (Org aus + Einsatz leer → aus; Org aus + Einsatz an → an; Org leer + Einsatz aus → aus; Override nur mit Rolle übergeht Org-Ausblendung nicht), Admin sieht `sichtbar: false, zugriff: true`, nicht ausblendbares Modul trotz Org-Vorgabe frei; alle bestehenden Tests grün
- [x] 2.3 Integrationstests in `tests/modul_freigaben.rs`: Org blendet `stab` aus → `GET …/modul-freigaben` liefert `sichtbar: false`, Listen-Endpunkt 403 für ein Mitglied, Modulzähler ohne das Modul (Live-Filter in `tests/modul_override.rs`, `org_ausblendung_wirkt_auch_im_live_feed`); Einsatz-Override `sichtbar: true` überstimmt; laufender Einsatz folgt einer späteren Vorgabe

## 3. Backend: Schreibwege und Wire (D3)

- [x] 3.1 Override-PUT (`src/routes/einsatz.rs`): `sichtbar: Option<bool>`, `null`/fehlend = erbt, `false` auf nicht ausblendbarem Modul → 400; Tests in `tests/modul_override.rs`: nur Rolle mit `sichtbar: null` → gespeichert `null`, Sichtbarkeit folgt der Org; eigenen Wert per `null` zurücknehmen; `einsatzdaten` mit `false` → 400 ohne Zeile; bestehende Tests grün
- [x] 3.2 Org-PUT/-GET (`src/routes/org_einstellungen.rs`): Antwort `{ key: OrgModulEinstellung { benoetigte_rolle, sichtbar: bool } }` mit `ToSchema` und Eintrag in `src/api_doc.rs`; PUT mit optionalem `sichtbar` (fehlt → unverändert, `true` → `NULL`, `false` → `0`), nicht ausblendbar + `false` → 400. Tests in `tests/org_einstellungen.rs`: System-Admin setzt und liest, Führungskraft → 403 ohne Änderung, `sichtbar: "nein"` → 400 ohne Änderung, nur Rolle lässt Ausblendung stehen, bestehende Tests auf die neue Antwortform umgestellt; grün
- [x] 3.3 Typ-Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet; `tsc` zeigt die Abnehmer, die in Gruppe 4 umgestellt werden

## 4. Frontend: API und Verwaltung (D3, D5)

- [x] 4.1 `api/types.ts`: `OrgModulEinstellungen` aus dem generierten Schema (`Record<string, OrgModulEinstellung>`), `ModulOverrideUpdate.sichtbar: boolean | null`; `api/orgEinstellungen.ts` `setzeOrgModulEinstellung(modulKey, { benoetigte_rolle, sichtbar })`; `orgEinstellungen.test.ts` auf den neuen Body umgestellt, grün
- [x] 4.2 `EinsatzDefaults.tsx`: Paneel „Module für alle Einsätze“ mit Sichtbar-Spalte und Hinweis „Wirkt auf alle Einsätze ohne eigene Einstellung, auch auf laufende.“, beide Felder je Speichern, nur Admin bedienbar; `EinsatzDefaults.test.tsx`: Titel, Hinweis, Schalter schickt `{ benoetigte_rolle: <Bestand>, sichtbar: false }`, Rollenwechsel schickt den Sichtbar-Bestand mit, Führungskraft gesperrt; grün

## 5. Frontend: Einsatz-Editor (D4)

- [x] 5.1 `ModulEinstellungsListe`: optionaler Zeilenzusatz in der Modulspalte (Hinweis und Aktion) außerhalb des `<label>`; Tests in `ModulEinstellungsListe.test.tsx`: Zusatz steht unter dem Namen, ein Klick auf die Aktion legt den Schalter nicht um, Abfrage nach Modulname findet die Zeile weiter
- [x] 5.2 `EinsatzModule.tsx`: Schalter = eigener Wert ?? Freigabe ?? Org ?? `true`; Hinweis „Vorgabe der Organisation: ausgeblendet“ (Org-Vorgabe oder hergeleitet aus Freigabe ohne eigenen Wert); „Vorgabe übernehmen“ bei eigenem Wert schickt `sichtbar: null` mit Bestandsrolle; Rollenwechsel schickt den eigenen Wert statt des wirksamen; Invalidierung von Overrides und Freigaben. `EinsatzModule.test.tsx` deckt die Szenarien der Anforderung „Der Editor ‚Module‘ zeigt den wirksamen Wert und seine Herkunft“ ab, dazu den Fall ohne Leserecht auf die Org-Vorgaben (403); grün
- [x] 5.3 e2e `frontend/e2e/modulfreigabe-org-vorgabe.spec.ts`: System-Admin blendet `nachforderungen` im Paneel „Module für alle Einsätze“ aus → Navigation eines laufenden Einsatzes ohne eigenen Wert ohne das Modul; Schalter im Editor einlegen → zurück; „Vorgabe übernehmen“ → wieder weg. Die Org-Vorgabe lebt nur im Browser (`page.route`), weil sie sonst parallele Specs der geteilten e2e-Organisation träfe (`e2e/AGENTS.md`, LFH-820); grün

## 6. Anwenderdoku

- [x] 6.1 `docs/anwender/kapitel/verwaltung.md`: Ablauf „Module für alle Einsätze ausblenden oder auf eine Rolle beschränken“ mit Paneelname, Spalte „Sichtbar“ und Hinweis auf laufende Einsätze; `einsatz-einstellungen.md`: „Woher ein Wert kommt“ und „Was ‚Sichtbar‘ und ‚Benötigte Rolle‘ bewirken“ um die Org-Vorgabe der Sichtbarkeit, den Hinweis und „Vorgabe übernehmen“ ergänzt; `quellen` der Köpfe nachgezogen; `anwenderdoku.guard.test.ts` grün
- [x] 6.2 Bilder: `frontend/e2e/doku-bilder/verwaltung.bilder.ts` auf das Paneel „Module für alle Einsätze“ (Bild umbenannt, mit ausgeblendetem Modul), `einsatz-einstellungen.bilder.ts` mit einer geerbten Ausblendung samt Hinweis; erzeugt mit `pnpm doku:bilder --grep "verwaltung|einsatz-einstellungen"`, hell und dunkel, jedes Bild ≤ 300 KB. Gelingt der Lauf in der Sitzung nicht, steht das im PR, und die Aufgabe bleibt offen

## 7. Integration

- [x] 7.1 `./scripts/check-all.sh` grün (Bündel laut Skriptkopf), insbesondere Migrationsnummern, Typ-Codegen, Prettier/rustfmt, Vitest, Rust-Tests
  - Stand 13.10.2026 in der Cloud-Sitzung: `--nur schnell` grün; Rust-Suite grün (5231 Tests: Bibliothek, Binaries, alle 169 Testdateien und Doku-Tests, wegen des Plattenkontingents in Paketen gefahren), Dev-Seed-Schritt grün; `--nur frontend` grün (879 Dateien, 13 559 Tests). `cargo test -p lifeline-desktop` baut hier nicht (GTK fehlt, `gdk-sys`), `src-tauri/` ist unberührt. e2e (Chromium): alle Specs zu Einstellungen, Navigation, Modulfreigabe, Stab und Lagebesprechung sowie Gate 1 und die Trefflächen grün; rot bleiben 9 Tests in `fokus-verdeckung.spec.ts`, die auf dem Frontend von `origin/alpha` gegen dasselbe Backend genauso scheitern (Chromium-Build 1194 statt des gepinnten 1234). Die volle e2e-Suite fährt die CI des PRs
- [x] 7.2 Manuell oder per e2e am laufenden System belegt: Org blendet Stab aus → neuer und laufender Einsatz ohne Stab; Einsatz überstimmt; Rollenwechsel bei geerbter Ausblendung lässt sie geerbt
  - Belegt am laufenden System mit `e2e/modulfreigabe-org-vorgabe.spec.ts` (Modul `nachforderungen` statt `stab`, wegen paralleler Specs): Vorgabe in der Verwaltung → laufender Einsatz ohne das Modul, Einsatz überstimmt, „Vorgabe übernehmen“. Gegen den echten Server belegt das `tests/modul_freigaben.rs` (Org-Ausblendung wirkt auf einen laufenden Einsatz, Überstimmen, Override nur mit Rolle). Den Rollenwechsel bei geerbter Ausblendung belegt `EinsatzModule.test.tsx`

## Workflow follow-up

- Folgeticket über `zunder-task-anlegen`: Leserecht der Einsatzleitung auf die Org-Vorgaben im Editor „Module“ (design.md, Risiken).
- Vor dem PR `/opsx:archive ivtkmf43-org-modul-sichtbarkeit` im selben Branch: Spec-Sync nach `openspec/specs/modul-freigabe/`, Verweise nachziehen.
- PR gegen `alpha`, Zunder-Aufgabe auf `review` mit `pr_url`, dann `release_task`.

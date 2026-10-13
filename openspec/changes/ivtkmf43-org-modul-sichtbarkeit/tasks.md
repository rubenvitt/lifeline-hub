# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Backend-Tests mit `cargo test --test <datei>` bzw. `cargo test --lib <pfad>`,
Frontend-Gates aus dem Frontend-Ordner über `mise exec -- pnpm …` (ohne mise: `pnpm` aus
`/opt/node22`).

## 1. Backend: Speicherung und Migration (D1)

- [ ] 1.1 Migration `0185_modul_sichtbarkeit_org.sql` laut design.md D1 (Nummer vorher mit `git fetch origin alpha && scripts/check-migrationen.sh` geprüft): `org_modul_einstellung.sichtbar` neu, Neubau von `einsatz_modul_override` mit nullbarer `sichtbar`, `1 → NULL`, `0` bleibt. Migrationstest in `src/db.rs` nach dem Muster von `0184`: Zeile `sichtbar = 1` mit Rolle → `NULL` mit Rolle, Zeile `sichtbar = 0` → `0`, Org-Zeilen tragen `sichtbar = NULL`. `test_pool_gleicht_einer_frisch_migrierten_db` und `db::tests::migrationsnummern_sind_eindeutig` grün
- [ ] 1.2 `modul_override`: `EinsatzModulOverride.sichtbar: Option<bool>`, `setzen` nimmt `Option<bool>`; Repo-Tests auf `Some`/`None` erweitert (Upsert auf `None` setzt `NULL`), grün
- [ ] 1.3 `org::modul_einstellung`: `laden_alle` liefert `OrgModulVorgabe { benoetigte_rolle, sichtbar: Option<bool> }`; `setzen` nimmt die Rolle und eine Sichtbarkeit „unverändert / sichtbar / ausgeblendet“ und schreibt nur `0` oder `NULL`. Repo-Tests: Ausblenden, Wieder-Einblenden ergibt `NULL`, „unverändert“ lässt eine Ausblendung beim Rollenwechsel stehen, Org-Isolation; grün

## 2. Backend: Auflösung (D2)

- [ ] 2.1 `effektiv_sichtbar(einsatz, org)` in `src/einsatz/effektiv.rs` mit Tests (Einsatz schlägt Org in beide Richtungen, Org ohne Einsatz, beide leer → `true`)
- [ ] 2.2 `modul_freigabe` und alle Aufrufer (`fordere_modul_zugriff`, `lade_modul_regeln`, `gesperrt_fuer_geraet`, `modul_freigaben`) auf `OrgModulVorgabe` umgestellt, `sichtbar` über `effektiv_sichtbar`. Unit-Tests in `berechtigung.rs` für die vier Akzeptanzfälle (Org aus + Einsatz leer → aus; Org aus + Einsatz an → an; Org leer + Einsatz aus → aus; Override nur mit Rolle übergeht Org-Ausblendung nicht), Admin sieht `sichtbar: false, zugriff: true`, nicht ausblendbares Modul trotz Org-Vorgabe frei; alle bestehenden Tests grün
- [ ] 2.3 Integrationstests in `tests/modul_freigaben.rs`: Org blendet `stab` aus → `GET …/modul-freigaben` liefert `sichtbar: false`, Listen-Endpunkt 403 für ein Mitglied, Modulzähler und Live-Filter ohne `stab`; Einsatz-Override `sichtbar: true` überstimmt; laufender Einsatz folgt einer späteren Vorgabe

## 3. Backend: Schreibwege und Wire (D3)

- [ ] 3.1 Override-PUT (`src/routes/einsatz.rs`): `sichtbar: Option<bool>`, `null`/fehlend = erbt, `false` auf nicht ausblendbarem Modul → 400; Tests in `tests/modul_override.rs`: nur Rolle mit `sichtbar: null` → gespeichert `null`, Sichtbarkeit folgt der Org; eigenen Wert per `null` zurücknehmen; `einsatzdaten` mit `false` → 400 ohne Zeile; bestehende Tests grün
- [ ] 3.2 Org-PUT/-GET (`src/routes/org_einstellungen.rs`): Antwort `{ key: OrgModulEinstellung { benoetigte_rolle, sichtbar: bool } }` mit `ToSchema` und Eintrag in `src/api_doc.rs`; PUT mit optionalem `sichtbar` (fehlt → unverändert, `true` → `NULL`, `false` → `0`), nicht ausblendbar + `false` → 400. Tests in `tests/org_einstellungen.rs`: System-Admin setzt und liest, Führungskraft → 403 ohne Änderung, `sichtbar: "nein"` → 400 ohne Änderung, nur Rolle lässt Ausblendung stehen, bestehende Tests auf die neue Antwortform umgestellt; grün
- [ ] 3.3 Typ-Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommittet; `tsc` zeigt die Abnehmer, die in Gruppe 4 umgestellt werden

## 4. Frontend: API und Verwaltung (D3, D5)

- [ ] 4.1 `api/types.ts`: `OrgModulEinstellungen` aus dem generierten Schema (`Record<string, OrgModulEinstellung>`), `ModulOverrideUpdate.sichtbar: boolean | null`; `api/orgEinstellungen.ts` `setzeOrgModulEinstellung(modulKey, { benoetigte_rolle, sichtbar })`; `orgEinstellungen.test.ts` auf den neuen Body umgestellt, grün
- [ ] 4.2 `EinsatzDefaults.tsx`: Paneel „Module für alle Einsätze“ mit Sichtbar-Spalte und Hinweis „Wirkt auf alle Einsätze ohne eigene Einstellung, auch auf laufende.“, beide Felder je Speichern, nur Admin bedienbar; `EinsatzDefaults.test.tsx`: Titel, Hinweis, Schalter schickt `{ benoetigte_rolle: <Bestand>, sichtbar: false }`, Rollenwechsel schickt den Sichtbar-Bestand mit, Führungskraft gesperrt; grün

## 5. Frontend: Einsatz-Editor (D4)

- [ ] 5.1 `ModulEinstellungsListe`: optionaler Zeilenzusatz in der Modulspalte (Hinweis und Aktion) außerhalb des `<label>`; Tests in `ModulEinstellungsListe.test.tsx`: Zusatz steht unter dem Namen, ein Klick auf die Aktion legt den Schalter nicht um, Abfrage nach Modulname findet die Zeile weiter
- [ ] 5.2 `EinsatzModule.tsx`: Schalter = eigener Wert ?? Freigabe ?? Org ?? `true`; Hinweis „Vorgabe der Organisation: ausgeblendet“ (Org-Vorgabe oder hergeleitet aus Freigabe ohne eigenen Wert); „Vorgabe übernehmen“ bei eigenem Wert schickt `sichtbar: null` mit Bestandsrolle; Rollenwechsel schickt den eigenen Wert statt des wirksamen; Invalidierung von Overrides und Freigaben. `EinsatzModule.test.tsx` deckt die Szenarien der Anforderung „Der Editor ‚Module‘ zeigt den wirksamen Wert und seine Herkunft“ ab, dazu den Fall ohne Leserecht auf die Org-Vorgaben (403); grün
- [ ] 5.3 e2e `frontend/e2e/modulfreigabe-org-vorgabe.spec.ts`: System-Admin blendet `stab` in der Verwaltung aus → Navigation eines Einsatzes ohne eigenen Wert ohne Stab; Einsatzleitung legt den Schalter ein → Stab zurück; „Vorgabe übernehmen“ → wieder weg; grün

## 6. Anwenderdoku

- [ ] 6.1 `docs/anwender/kapitel/verwaltung.md`: Ablauf „Module für alle Einsätze ausblenden oder auf eine Rolle beschränken“ mit Paneelname, Spalte „Sichtbar“ und Hinweis auf laufende Einsätze; `einsatz-einstellungen.md`: „Woher ein Wert kommt“ und „Was ‚Sichtbar‘ und ‚Benötigte Rolle‘ bewirken“ um die Org-Vorgabe der Sichtbarkeit, den Hinweis und „Vorgabe übernehmen“ ergänzt; `quellen` der Köpfe nachgezogen; `anwenderdoku.guard.test.ts` grün
- [ ] 6.2 Bilder: `frontend/e2e/doku-bilder/verwaltung.bilder.ts` auf das Paneel „Module für alle Einsätze“ (Bild umbenannt, mit ausgeblendetem Modul), `einsatz-einstellungen.bilder.ts` mit einer geerbten Ausblendung samt Hinweis; erzeugt mit `pnpm doku:bilder --grep "verwaltung|einsatz-einstellungen"`, hell und dunkel, jedes Bild ≤ 300 KB. Gelingt der Lauf in der Sitzung nicht, steht das im PR, und die Aufgabe bleibt offen

## 7. Integration

- [ ] 7.1 `./scripts/check-all.sh` grün (Bündel laut Skriptkopf), insbesondere Migrationsnummern, Typ-Codegen, Prettier/rustfmt, Vitest, Rust-Tests
- [ ] 7.2 Manuell oder per e2e am laufenden System belegt: Org blendet Stab aus → neuer und laufender Einsatz ohne Stab; Einsatz überstimmt; Rollenwechsel bei geerbter Ausblendung lässt sie geerbt

## Workflow follow-up

- Folgeticket über `zunder-task-anlegen`: Leserecht der Einsatzleitung auf die Org-Vorgaben im Editor „Module“ (design.md, Risiken).
- Vor dem PR `/opsx:archive ivtkmf43-org-modul-sichtbarkeit` im selben Branch: Spec-Sync nach `openspec/specs/modul-freigabe/`, Verweise nachziehen.
- PR gegen `alpha`, Zunder-Aufgabe auf `review` mit `pr_url`, dann `release_task`.

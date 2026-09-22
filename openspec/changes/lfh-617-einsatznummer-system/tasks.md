# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst roter Test, dann Code).

## 1. Datenbank

- [ ] 1.1 Prüfen, dass `0104` auf `origin/alpha` frei ist, dann `migrations/0104_einsatznummer_system.sql` anlegen (Spalten `einsatz.nummer_jahr`/`nummer_lfd`, Übernahme nur für exakt `JJJJ-NNN`, Unique-Index `(org_id, nummer_jahr, nummer_lfd)`, `org_einstellungen.einsatz_nummer_praefix`). Verifikation: Migrationstest in `src/db.rs` belegt Übernahme von `2026-001`, Nicht-Übernahme von `EN-4711` und `2026-01`, `NULL` bleibt `NULL`, und eine doppelte `(org, jahr, lfd)` wird abgewiesen.
- [ ] 1.2 `src/einsatz/schwaerzung_registry.rs`: `nummer_jahr` und `nummer_lfd` als `retain(…, G_ZAEHLER)` eintragen. Verifikation: der Registry-Guard ist nach der Migration erst rot, dann grün.

## 2. Vergabe (Backend)

- [ ] 2.1 Reine Formatfunktion für `<Präfix><JJJJ>-<NNNN>` mit Unit-Tests (Vorgabe `E-`, Padding `0001`, `10000` ungekürzt, eigenes Präfix). Verifikation: `cargo test` für die Funktion.
- [ ] 2.2 `repo::anlegen` umstellen: in der bestehenden `write_retry!`-Transaktion das Präfix aus `org_einstellungen` lesen, `MAX(nummer_lfd)` je `(org_id, nummer_jahr)`, Text + Jahr + lfd. Nr. schreiben, `substr`-Zählung entfernen. Verifikation: die Repo-Tests `anlegen_vergibt_fortlaufende_einsatznummer` / `anlegen_zaehlt_je_organisation_getrennt` auf `E-JJJJ-000N` umgestellt, dazu neue Tests „Zählung setzt hinter Bestandsnummer `JJJJ-003` mit `0004` fort“ und „Präfixwechsel trifft nur neue Einsätze“.

## 3. Unveränderlichkeit (Backend)

- [ ] 3.1 `einsatznummer_intern` aus `repo::KopfPatch` und dem SQL von `patche_kopf` entfernen. Die Bind-Reihenfolge der Flag/Wert-Paare nachziehen. Verifikation: `patche_kopf_setzt_jede_spalte_an_ihren_platz` bleibt ohne das Feld grün, jede Spalte landet an ihrem Platz.
- [ ] 3.2 `routes/einsatz.rs:aktualisieren`: ist `einsatznummer_intern` im Body (Wert **oder** `null`), gibt es 400 mit der Meldung „Die Einsatznummer vergibt das System“, bevor geschrieben wird. Verifikation: `tests/einsatz.rs` — `patch_doppelte_einsatznummer_ist_409` wird zu zwei Tests (Wert → 400, `null` → 400, Nummer danach unverändert, andere Felder nicht übernommen). `basis_kopf` und `einsatz_mit_vollen_kopfdaten` schicken das Feld nicht mehr, und der Test „`leitstellen_nr` bleibt setzbar/leerbar“ ist grün.
- [ ] 3.3 `tests/einsatz.rs:anlegen_vergibt_einsatznummer_im_format` auf `E-JJJJ-0001`/`-0002` schärfen. Verifikation: der Test prüft den ganzen Text, nicht nur `ends_with`.

## 4. Org-Einstellung (Backend + Codegen)

- [ ] 4.1 `einsatz_nummer_praefix` in `src/org/einstellungen.rs` (Struct, `leer`, `anzeige`, `anzeige_hinweis`, `laden_oder_default`, `speichern`) und in `routes/org_einstellungen.rs` (Update-DTO, `bereinige`, Präfix-Whitelist-Schleife) aufnehmen. Verifikation: Integrationstest PUT mit `WF-` → GET liefert `WF-`, PUT mit 9 Zeichen oder `E#` → 400.
- [ ] 4.2 `scripts/check-typ-codegen.sh` laufen lassen und `openapi.json` + `types.generated.ts` mitcommitten. Verifikation: das Skript endet mit Exit 0 und ohne Drift.

## 5. Frontend

- [ ] 5.1 `pages/EinsatzdatenPage.tsx`: das `Form.Item` „Einsatznummer (intern)“ und den Schlüssel im Payload (`FormWerte`, Vorbelegung, `leerZuNull`) entfernen. Das Etikett im Lesezweig heißt „Einsatznummer“. Verifikation: `EinsatzdatenPage.test.tsx` — kein Eingabefeld „Einsatznummer“, der PATCH-Body enthält kein `einsatznummer_intern` (Schlüssel-Abwesenheit geprüft), „Leitstellen-Nr.“ bleibt editierbar.
- [ ] 5.2 `pages/einstellungen/orgEinstellungenForm.ts` + `EinsatzDefaults.tsx`: Feld „Präfix Einsatznummer“ (Platzhalter `E-`) aufnehmen, in `zuUpdate` **und** im Einsatz-Normalizer. Verifikation: der Form-Test zeigt, dass ein Speichern der **Anzeige**-Sektion den Bestandswert von `einsatz_nummer_praefix` mitschickt, und ein Komponententest, dass das Feld beim Speichern der Einsatz-Defaults im PUT steht.
- [ ] 5.3 Bestehende Frontend-Tests mit `einsatznummer_intern`-Fixtures laufen lassen (Kopfzeile, Kachel, Lagekarte …). Verifikation: die volle Vitest-Suite ist grün.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` komplett grün (fmt, lint, Codegen/tsc, cargo test, Vitest, deps, e2e).
- [ ] 6.2 Nachzug-Ticket für die Jahresgrenze in der Organisations-Zeitzone per `clickup-task-anlegen` erfassen und die Nummer in der Abschlussmeldung nennen.

# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): zuerst der rote
Test, dann der Code. Vor jeder „fertig“-Aussage stehen `verification-before-completion`
und `requesting-code-review`. Die Gruppen 1–5 sind das Backend und lassen sich allein
liefern, weil ein Client ohne `anhang_ids` unverändert weiterläuft. Die Gruppen 6–8 bauen
darauf auf, Gruppe 9 schließt ab.

## 1. Datenbank

- [ ] 1.1 `git fetch`, dann die nächste freie Nummer mit `scripts/check-migrationen.sh` gegen `origin/alpha` ermitteln (heute 0121). Migration `<nr>_etb_eintrag_anhang.sql` nach design.md D1 anlegen: beide FKs `ON DELETE CASCADE`, `anhang_id UNIQUE`, `PRIMARY KEY (eintrag_id, anhang_id)`, Kopfkommentar „dritter Linker auf `anhang`“ mit Begründung für CASCADE. Verifiziert durch `scripts/check-migrationen.sh` grün und `cargo test --lib db` (`migrationsnummern_sind_eindeutig`)
- [ ] 1.2 Schwärzungsregel: roter Guard zuerst (`jede_einsatz_scoped_spalte_ist_klassifiziert` bzw. der CASCADE-Hüllen-Guard wird mit der neuen Tabelle rot), dann `TabellenRegel` für `etb_eintrag_anhang` (`UeberParent { fk: "eintrag_id", parent: "etb_eintrag" }`, `retain` G_FK für beide Spalten, Kommentar nach dem Muster von `chat_nachricht_anhang`). Verifiziert durch den grünen Guard

## 2. Anhang-Unterbau: dritter Linker

- [ ] 2.1 TDD in `src/anhang/repo.rs`: `linker_stand` zählt `etb_gesamt`. Ein ETB-gebundener Anhang liefert `ist_etb()` und `generischer_download_gesperrt()`, ein freier nicht. Die bestehenden `LinkerStand`-Literale (`generischer_download_gesperrt_folgt_dem_chat_tombstone`) bekommen das Feld, dazu ein Fall „ETB + lebender Chat → gesperrt“. Verifiziert durch die Repo-Tests
- [ ] 2.2 TDD: `sweep_verwaiste_haelt_etb_gebundene_anhaenge` (alter ETB-gebundener Anhang bleibt, gleich alter freier geht). Dann das dritte `NOT EXISTS` und die Doku-Zeile „Jeder Linker gehört in dieses NOT EXISTS“ auf drei Linker gebracht. Verifiziert durch den Test, der ohne das `NOT EXISTS` rot ist
- [ ] 2.3 TDD: `loeschen_verweigert_etb_gebundene_anhaenge` (NotFound, Datei und Verknüpfung bleiben, ein freier Anhang desselben Einsatzes wird gelöscht). Dann das zweite `NOT EXISTS` in `repo::loeschen`. Verifiziert durch den Test
- [ ] 2.4 Geteilten Multipart-Helfer aus `routes/anhang.rs::hochladen` nach `src/anhang/` ziehen (Allowlist als Parameter, Verhalten unverändert). Verifiziert dadurch, dass die bestehenden Upload-Tests in `tests/anhang.rs` ohne Änderung grün bleiben

## 3. Backend: Erfassen mit Anhängen

- [ ] 3.1 TDD in `src/etb/repo.rs`: `anlegen_idempotent` nimmt `anhang_ids: &[i64]` und läuft in beiden Zweigen durch `write_retry!` in der Reihenfolge aus design.md D3 (client_id → Anhänge klassifizieren → Eintrag → Verknüpfungen). Rote Tests zuerst: zwei Anhänge werden gebunden; fremder Anhang → `Validation`, kein Eintrag, keine `lfd_nr` verbraucht, der zweite genannte Anhang bleibt frei; Anhang an einem anderen Eintrag / an einer Chat-Nachricht / an einem Dokument → `UnprocessableEntity`; Replay mit gleicher `client_id` → `war_neu = false`, Bestand samt Anhängen, keine Anhangsprüfung; ohne `client_id` weiter immer neu. `anlegen_tx` behält seine Signatur, `EintragDaten` bleibt ohne Anhangsfeld. Verifiziert durch die Repo-Tests und `cargo test --workspace` (alle Kopplungspfade kompilieren und bleiben grün)
- [ ] 3.2 TDD: der bisherige Race-Zweig auf die UNIQUE-Verletzung ist durch die Prüfung in der Transaktion ersetzt. Der bestehende Idempotenztest (Doppel-Flush) bleibt grün, dazu ein Test mit zwei gleichzeitigen `anlegen_idempotent` derselben `client_id` → genau ein Eintrag. Verifiziert durch die Tests
- [ ] 3.3 `EtbEintragAnzeige.anhaenge: Vec<AnhangAnzeige>` mit `#[sqlx(skip)]`. TDD für `anhaenge_nachladen` nach dem Muster von `folgeauftraege_nachladen`: Eintrag ohne Anhang → leer; zwei Anhänge aufsteigend nach id; Cursor-Seite trägt vollständige Listen. Aufruf in `laden` und `abfrage`. Verifiziert durch die Repo-Tests
- [ ] 3.4 `routes/etb.rs::NeuerEintrag.anhang_ids: Vec<i64>` mit `#[serde(default)]`, sortiert und dedupliziert, mehr als 10 → 400 (benannte Konstante). Routentests in `tests/etb.rs`: Erfassen mit zwei Anhängen → 201 und `anhaenge` in der Antwort; Liste trägt den Schlüssel `anhaenge` auch bei `[]` (Presence per `contains_key`); fremder Anhang → 400; gebundener → 422 (Testpaar); leerer Inhalt mit Anhang → 400; 11 Anhänge → 400; Berichtigung mit Anhang → 201, Grundeintrag ohne; Replay nach Commit → 201, gleicher Eintrag samt Anhängen, und der Live-Strom liefert genau ein `etb`-Ereignis. Verifiziert durch die Tests
- [ ] 3.5 Codegen: `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mitcommitten (`anhaenge` als required am `EtbEintragAnzeige`). Verifiziert durch das grüne Skript und `tsc`

## 4. Backend: Upload- und Download-Route

- [ ] 4.1 `POST /api/einsaetze/{id}/etb/anhaenge` in `routes/etb.rs` (Gates wie `erfassen`, Helfer aus 2.4 mit `ERLAUBTE_MIME_DOKUMENT`), in `app.rs` mit `DefaultBodyLimit::max(26 * 1024 * 1024)`. Tests in `tests/etb.rs`: `.heic` → 201 mit `image/heic`; `.exe` → 400; Beobachter → 403; Modul ETB gesperrt → 403; abgeschlossener Einsatz → abgewiesen wie beim Erfassen; eine Datei über 2 MiB geht durch (Beleg für das Body-Limit). Verifiziert durch die Tests
- [ ] 4.2 `GET /api/einsaetze/{id}/etb/{eintrag_id}/anhaenge/{aid}` nach design.md D6 mit `fordere_lese_gates`, Bindungsabfrage und `anhang_antwort`, in `app.rs` mit `ConcurrencyLimitLayer`. Tests: Beobachter lädt Bytes, Dateiname und MIME stimmen; `If-None-Match` → 304; fremder Einsatz → 404; falscher Eintrag desselben Einsatzes → 404; Modul ETB gesperrt → 403; unbekannte IDs → 404. `tests/einsatz_kontext_guard.rs` bleibt grün (etb ist DEFERRED). Verifiziert durch die Tests
- [ ] 4.3 Generische Routen in `tests/anhang.rs` nach dem Vorbild der `dokument_anhang_*`-Tests: `etb_anhang_generischer_download_ist_404`, `etb_anhang_generisches_loeschen_ist_422` (danach Datei und Verknüpfung vorhanden). Dann die Sperren in `routes/anhang.rs` (`ist_etb()` im DELETE mit Wortlaut aus D7, der Download über `generischer_download_gesperrt`). Verifiziert durch die Tests
- [ ] 4.4 Kreuzsperre im Chat: `etb_anhang_nicht_an_chat_verknuepfbar` (400, keine Nachricht). Dann das `NOT EXISTS etb_eintrag_anhang` in `chat::repo::anlegen_mit_anhaengen`. Verifiziert durch den Test, der ohne die Zeile rot ist

## 5. Backend: Schwärzung

- [ ] 5.1 Verhaltenstest neben `schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`: Einsatz mit Eintrag samt Foto schwärzen → `anhang`- und `etb_eintrag_anhang`-Zeile weg, der Eintrag steht mit unverändertem `inhalt` und `lfd_nr`, `repo::abfrage` liefert ihn mit `anhaenge: []`, der Download über die ETB-Route antwortet 404. Verifiziert durch den Test

## 6. Frontend: API und Anzeige

- [ ] 6.1 `api/etb.ts`: `NeuerEintrag.anhang_ids?: number[]`, `ladeEtbAnhangHoch(einsatzId, datei)` (eine Datei, Timeout 120 s), `etbAnhangPfad(einsatzId, eintragId, anhangId)`. `api/dokumente.ts` exportiert die `accept`-Konstante, `DokumentAblegenModal` nimmt sie. Fixtures von `EtbEintragAnzeige` um `anhaenge: []` ergänzen. Verifiziert durch einen Test des Pfad-Builders und `tsc` grün
- [ ] 6.2 TDD `etb/EtbAnhaenge.tsx` nach design.md D11: je Anhang ein Link auf `etbAnhangPfad` mit `download`, sichtbar „Name · Größe“ (`formatGroesse`), zugänglicher Name mit „Anhang zu Nr. <lfd_nr>“; zwei Einträge mit gleichem Dateinamen → verschiedene Namen; ohne Anhang → nichts; kein `role="img"` im Link. Die Mindesthöhe über `verweisStil` wird an der reinen Stilfunktion geprüft (Boden aus `controlHeight`), nicht im Vitest-Layout. Verifiziert durch die Tests
- [ ] 6.3 TDD Zeitachse: Eintrag mit Anhang ohne Kopplung zeigt die Anhänge in der Hinweiszeile (Falle aus LFH-636: nicht an `hatVerknuepfung` hängen); Eintrag ohne Anhang unverändert. Ausstehende Zeile mit `anhang_ids` nennt „2 Anhänge“. `EtbEintragVorschau` zeigt dasselbe Bauteil. Verifiziert durch Tests in `EtbZeitachse.test.tsx` und `EtbEintragVorschau.test.tsx`

## 7. Frontend: Schnellerfassung

- [ ] 7.1 `useOnline` aus `components/Kopfleiste.tsx` nach `offline/useOnline.ts` ziehen, Kopfleiste nutzt ihn weiter. Verifiziert durch die unveränderten Kopfleisten-Tests und einen Hook-Test (online/offline-Ereignis)
- [ ] 7.2 TDD Bedienweg „Anhang“ in `etb/Schnellerfassung.tsx` (design.md D9): Wählen zeigt Name und Größe; Entfernen-Knopf heißt „Anhang <name> entfernen“; Datei über 25 MiB wird mit Begründung abgewiesen; offline ist „Anhang“ gesperrt und der Hinweistext steht sichtbar daneben; Text-Erfassung offline weiter möglich; Hinweiszeile unverändert (kein neuer Tastenvertrag); keine `size`-Angabe (dichte.guard bleibt grün). Verifiziert durch Tests in `Schnellerfassung.test.tsx` und den grünen `dichte.guard.test.ts`
- [ ] 7.3 TDD Absenden mit Dateien: Upload vor `erfassen`, `anhang_ids` in der richtigen Reihenfolge; Fortschritt „Lädt hoch (1/2)“ am Knopf; Upload scheitert → `erfassen` nicht gerufen, Wortlaut und Liste stehen; `erfassen` lehnt fachlich ab → Wortlaut und Liste stehen, nächster Versuch lädt neu hoch; Teilausfall (Datei 1 oben, Datei 2 scheitert) → nächster Versuch lädt nur Datei 2 (WeakMap); `erfassen` löst sich nach dem Einreihen ohne Fehler auf (transienter Fall aus `useEtbErfassung`) → Liste und Wortlaut geleert, `anhang_ids` im übergebenen Eintrag; offline mit Dateien → abgewiesen ohne Leeren; Erfolg → Liste leer, auch mit „Werte behalten“ (Von/An/Meldeweg bleiben); Enter sendet mit Dateien wie ohne. Verifiziert durch die Tests
- [ ] 7.4 TDD `EtbEntwurfsTabs`: Datei in Entwurf A, Wechsel zu B und zurück → Datei wieder in A, nicht in B; Entwurf schließen verwirft seine Dateien; der Entwurfsspeicher (IndexedDB) enthält keine Dateien. Berichtigungsmodus bietet „Anhang“ mit eigener Liste. Verifiziert durch Tests in `EtbEntwurfsTabs.test.tsx` und `EtbPage.test.tsx`
- [ ] 7.5 TDD Queue: `useEtbErfassung` reiht einen transient gescheiterten Eintrag samt `anhang_ids` und `client_id` ein und sendet ihn beim Flush unverändert; eine Queue-Zeile ohne `anhang_ids` (Altbestand) wird weiter gesendet; ein 400 beim Flush landet unter „abgelehnt“ mit dem Server-Wortlaut. Verifiziert durch Tests in `useEtbErfassung.test.ts`

## 8. Ende-zu-Ende

- [ ] 8.1 `e2e/etb-anhang.spec.ts`: Datei wählen → Text tippen → Enter → Eintrag erscheint mit Anhang-Verweis → Klick lädt die Datei (Download-Ereignis, Name stimmt); zweiter Einsatz: der Pfad mit Eintrag- und Anhang-ID aus dem ersten antwortet 404; generischer `/anhaenge/{aid}` antwortet 404; offline (`context.setOffline(true)`) ist „Anhang“ gesperrt und ein Text-Eintrag landet als ausstehend. Bedienbarkeit per Klick belegt, nicht per `toBeVisible()`. Verifiziert durch `pnpm e2e --grep etb-anhang`
- [ ] 8.2 Browser-Sichtprüfung in Tag und Nacht, Fükw (1366 px) und Tablet in Stufe „Handschuh“: Knopf, Dateiliste, Hinweis offline, Upload-Fortschritt mit einer ~20-MiB-Datei, Anhang-Verweise in Zeitachse und Vorschau, iPhone-HEIC. Verifiziert durch Screenshots in der Prüfliste

## 9. Abschluss

- [ ] 9.1 Prüfliste Einsatztauglichkeit (15 Kriterien) für die umgebaute ETB-Seite (Schnellerfassung und Zeitachse) als `docs/superpowers/specs/2026-09-24-lfh-117-pruefliste.md` nach dem Muster von LFH-673. Schwerpunkte: Trefferflächen 30/48/72 von „Anhang“, Entfernen-Knopf und Verweis, Kontrast von Hinweis und Verweis in beiden Modi, Rückmeldung bei langem Upload, Offline-Verhalten. Jede Zeile mit Verdikt, keine „nicht geprüft“. Verifiziert durch die Datei
- [ ] 9.2 CLAUDE.md: kurzer Absatz „ETB-Anhänge (LFH-117)“ (dritter Linker, Kreuzsperren, eigene Routen, Allowlist, append-only, nur der Upload ist online). Verifiziert durch Review
- [ ] 9.3 `./scripts/check-all.sh` grün (Prettier, Lint, Codegen, `cargo test --workspace`, Vitest, e2e, Migrationsnummern). Zusätzlich `cargo test --no-default-features` für den Upload-Pfad, weil 2.4 `src/anhang/` anfasst. Verifiziert durch die Ausgaben ohne `| tail`
- [ ] 9.4 Folgetickets auf dem Board anlegen (Skill `clickup-task-anlegen`), falls nicht vorhanden: `chat::heraufstufen_zu_etb` mit Anhängen; Dokumente mit ETB-Bezug in der Zeitachse; Anhänge in der ETB-Druckansicht (LFH-22); Chat prüft die Allowlist beim Verknüpfen. Verifiziert durch die Ticket-Links in der Abschlussmeldung

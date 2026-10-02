# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote
Test, dann der Code. Gruppe 1 ist Refactoring ohne Verhaltensänderung. Die Gruppen 2–4
bringen das Backend für Tier, UHS und das UHS-Audit, 5–7 das Frontend, 8 die
Gesamtnachweise.

**Testregel für jede Abschottung (D12 aus LFH-117, `src/AGENTS.md`):** Tests, die zeigen,
dass eine Tier- oder UHS-Datei über generische Routen, Chat oder ETB nicht erreichbar ist,
laufen **als die ablegende Person** (`admin`, Hilfen in `tests/common/mod.rs`). Sonst wären
sie auch ohne Registereintrag grün.

## 1. Gemeinsamer Erfassungs-Anhang-Kern, Schaden zieht um (design.md D2, D3)

- [ ] 1.1 Ausgangsstand sichern.
  - `cargo test --test schaden_anhang --test schaden_anhang_scan --test anhang --test etb_anhang --test dokument --test anhang_metadaten` und `cargo test --lib schaden::anhang anhang::` grün laufen lassen.
  - Die Testnamen notieren. Sie sind das Netz für den Umzug.
  - Verifiziert durch die Exit-Codes (ohne `| tail`).
- [ ] 1.2 `src/anhang/erfassung.rs` anlegen.
  - Inhalt: `ErfassungsAblage` (Deskriptor), `ErfassungsAnhangZeile`, `BesitzerKopf`, `Vorgang`, `etb_text(etb_name, mime, vorgang)`, `liste`, `laden`, `anhang_id_fuer_download`, `ablegen_tx`, `entfernen_tx`. Das SQL entsteht aus den Deskriptor-Konstanten über `AssertSqlSafe`.
  - Unit-Tests zuerst:
    - `etb_text` für Bild, PDF und sonstigen Typ in beiden Vorgängen;
    - ein Test, der für den Schaden-Deskriptor jede SQL-Form gegen eine migrierte Test-DB ausführt;
    - Ablage plus Liste, neueste zuerst, ohne entfernte Anhänge;
    - fremder Besitzer → 404;
    - `BesitzerKopf { storniert: true }` → 409 ohne `anhang`-, Linker- und ETB-Zeile;
    - doppeltes Entfernen → 404 ohne zweiten ETB-Eintrag.
  - Verifiziert durch `cargo test --lib anhang::erfassung`.
- [ ] 1.3 `src/schaden/anhang.rs` auf den Kern umstellen.
  - Es bleiben `SCHADEN_ABLAGE` (Deskriptor), `SchadenAnhangAnzeige` (unverändert, `From<ErfassungsAnhangZeile>`) sowie `ablegen` und `entfernen`. Diese laden den Besitzer mit `schaden_repo::laden_tx` und rufen den Kern.
  - Die übrigen Funktionen delegieren. `genau_eine_datei` wandert von `routes/schaden_anhang.rs` nach `routes/support.rs`.
  - Verifiziert durch:
    - unverändert grüne Tests aus 1.1, ohne Änderung an ihren Erwartungen;
    - eine Mutationsprobe: die Storno-Prüfung im Kern auskommentiert → `tests/schaden_anhang.rs` rot. Das Ergebnis steht im Commit-Text.
- [ ] 1.4 `src/AGENTS.md`, Abschnitt Anhänge: den Absatz „Schaden-Anhänge (LFH-21)“ zu „Erfassungs-Anhänge (LFH-21, LFH-758)“ umschreiben.
  - Inhalt: Kern `anhang::erfassung`, Deskriptor je Modul, was ein neues Modul braucht.
  - Verifiziert durch `scripts/check-fmt.sh` und einen `rg -n "schaden/anhang.rs|schaden_anhang" src/AGENTS.md`, der keinen veralteten Pfad mehr findet.

## 2. Backend: Tier-Anhänge

- [ ] 2.1 Migration `0135_einsatz_tier_anhang.sql` nach design.md D1.
  - Vorher `git fetch origin alpha` und `scripts/check-migrationen.sh`.
  - Kopfkommentar wie `0126`.
  - Verifiziert dadurch, dass `anhang::repo::tests::jeder_fremdschluessel_auf_anhang_ist_registriert` rot ist und `db::tests::migrationsnummern_sind_eindeutig` grün.
- [ ] 2.2 Registereintrag `einsatz_tier_anhang` in `MODUL_LINKER` (`ort: "Tier"`).
  - Repo-Tests zuerst, nach dem Muster der Schaden-Gegenstücke: `linker_stand_erkennt_tier_linker`, `sweep_verwaiste_haelt_tier_gebundene_anhaenge` (auch soft-gelöscht und älter als 24 h), `loeschen_verweigert_tier_gebundene_anhaenge`.
  - Den neuen Wortlaut von `gebunden_meldung()` in `tests/etb_anhang.rs` pinnen.
  - Verifiziert durch rot → grün und den grünen Guard aus 2.1.
- [ ] 2.3 Schwärzungsregel `einsatz_tier_anhang` (`Scoping::EinsatzId`, alle Spalten `ZeileLoeschen`, nach `anhang`). Der Kommentar der `anhang`-Regel nennt den Linker.
  - Verhaltenstest `schwaerzung_loescht_tier_anhaenge_und_haelt_den_etb_nachweis` in `src/einsatz/repo.rs`.
  - Verifiziert dadurch, dass `entdeckte_tabellen_gleich_registry_tabellen` und der Verhaltenstest erst rot, dann grün sind.
- [ ] 2.4 `src/tier/anhang.rs` anlegen: `TIER_ABLAGE`, `TierAnhangAnzeige` (`tier_id`), `ablegen`/`entfernen` über `tier::repo::laden_tx` und den Kern. Dazu `pub mod anhang;` in `src/tier/mod.rs`.
  - Repo-Tests zuerst: Einsatzgleichheit von Tier, Linker und Anhang; ETB-Text „Tier T-001: Foto abgelegt“; storniert → 409.
  - Verifiziert durch `cargo test --lib tier::anhang`.
- [ ] 2.5 `src/routes/tier_anhang.rs` anlegen, nach design.md D3.
  - Gates `EinsatzLesezugriff<Tiere>` und `EinsatzSchreibzugriff<Tiere>`.
  - Download mit `FassungParam` und `original_freigeben(…, "Tier T-007")`.
  - `sse_tier` wird `pub(crate)`.
  - Registrierung in `src/routes/mod.rs` und in `src/app.rs` (Body-Limit, `ConcurrencyLimitLayer`).
  - Verifiziert durch grüne `cargo test --test einsatz_kontext_guard --test json_extractor_guard --test path_extractor_guard`.
- [ ] 2.6 `tests/tier_anhang.rs` zuerst schreiben, je Szenario aus `specs/tier-anhaenge/spec.md` ein Test, nach dem Muster `tests/schaden_anhang.rs`:
  - 201 plus Liste; HEIC und PDF angenommen;
  - 400er ohne `anhang`-, Linker- und ETB-Zeile;
  - Beobachter liest, schreibt aber nicht (403);
  - Modul gesperrt → 403; fremde Org → 403; abgeschlossener Einsatz → 409 beim Schreiben;
  - fremder Einsatz und anderes Tier → 404;
  - storniert → 409; vermisstes und abgeschlossenes Tier nehmen an;
  - Entfernen 204/404; ETag und 304;
  - ETB-Leak „Müller_Bello.jpg“; kein ETB-Eintrag bei Abweisung;
  - SSE `tier` und `etb` ohne Dateinamen, kein `tier` ohne Modul.

  Eine Hilfe `tier_anhang(pool, einsatz)` kommt in `tests/common/mod.rs`. Verifiziert durch `cargo test --test tier_anhang`.
- [ ] 2.7 Abschottung als ablegende Person:
  - in `tests/anhang.rs`: generischer Download 404, generisches Löschen 422 mit dem Tier-Wortlaut, Chat 400;
  - in `tests/etb_anhang.rs`: ETB 422;
  - in `tests/dokument.rs`: nicht in der Ablage;
  - in `tests/anhang_metadaten.rs`: bereinigte Fassung und Original mit ETB-Vermerk am Tier.

  Ein eigenes Binary `tests/tier_anhang_scan.rs` prüft fail-closed 503 ohne jede Zeile. Mutationsprobe: der Registereintrag aus 2.2 ist auskommentiert → die Download-, Lösch-, Chat- und ETB-Tests sind rot. Verifiziert durch `cargo test --test anhang --test etb_anhang --test dokument --test anhang_metadaten --test tier_anhang_scan`, `cargo test --no-default-features --test tier_anhang_scan` und das Ergebnis der Probe im Commit-Text.
- [ ] 2.8 Codegen: `TierAnhangAnzeige` in `src/api_doc.rs` aufnehmen, `scripts/check-typ-codegen.sh` laufen lassen und `openapi.json` sowie `types.generated.ts` mitcommitten. Im Barrel `api/types.ts` steht `TierAnhang`. Verifiziert durch das grüne Skript.

## 3. Backend: UHS-Anhänge

- [ ] 3.1 Migration `0136_uhs_anhang.sql` (FK `uhs_id → uhs(id) ON DELETE CASCADE`). Verifiziert wie 2.1.
- [ ] 3.2 Registereintrag `uhs_anhang` (`ort: "Unfallhilfsstelle"`). Die Repo-Tests entsprechen 2.2, der Wortlaut-Pin wird erweitert. Verifiziert wie 2.2.
- [ ] 3.3 Schwärzungsregel `uhs_anhang` samt Verhaltenstest `schwaerzung_loescht_uhs_anhaenge_und_haelt_den_etb_nachweis`. Verifiziert wie 2.3.
- [ ] 3.4 `src/uhs/anhang.rs` anlegen: `UHS_ABLAGE`, `UhsAnhangAnzeige` (`uhs_id`), `ablegen`/`entfernen` über `uhs::repo::laden_tx`. Der `etb_name` ist `UHS {bezeichnung}`.
  - Repo-Tests zuerst: ETB-Text „UHS BHP 50: Foto abgelegt“; storniert → 409; eine aufgelöste UHS nimmt an.
  - Verifiziert durch `cargo test --lib uhs::anhang`.
- [ ] 3.5 `src/routes/uhs_anhang.rs` mit `liste`, `ablegen`, `datei` und `entfernen`, ohne Audit; das kommt in Gruppe 4.
  - Gates `<Unfallhilfsstellen>`, `sse_uhs` wird `pub(crate)`, Registrierung in `mod.rs` und `app.rs`.
  - Verifiziert durch die Struktur-Guards wie in 2.5.
- [ ] 3.6 `tests/uhs_anhang.rs` je Szenario aus `specs/uhs-anhaenge/spec.md`, ohne die Audit-Anforderungen, nach dem Muster aus 2.6. Leak-Test mit `Patient_Mueller_Liege3.jpg`. Hilfe `uhs_anhang` in `tests/common/mod.rs`. Verifiziert durch `cargo test --test uhs_anhang`.
- [ ] 3.7 Abschottung, Metadaten und Scan-Binary `tests/uhs_anhang_scan.rs` wie in 2.7, samt Mutationsprobe am Registereintrag. Verifiziert wie 2.7.
- [ ] 3.8 Codegen für `UhsAnhangAnzeige`, im Barrel als `UhsAnhang`. Verifiziert durch `scripts/check-typ-codegen.sh`.

## 4. Backend: UHS-Lese-Audit (design.md D5)

- [ ] 4.1 Migration `0137_anhang_zugriff_audit.sql` nach D5. Der Kopfkommentar begründet, warum es keinen FK auf `anhang` gibt (Guard und Schwärzung), und dass die Tabelle append-only ist.
  - Schwärzungsregel `anhang_zugriff_audit`: alle Spalten bleiben erhalten, die Klassen werden gegen die Konstanten der Registry abgeglichen.
  - Verifiziert durch:
    - rot → grün von `entdeckte_tabellen_gleich_registry_tabellen`;
    - den grünen Guard `jeder_fremdschluessel_auf_anhang_ist_registriert` (die Tabelle ist kein Linker);
    - einen Verhaltenstest: Nach der Schwärzung stehen die Audit-Zeilen mit `ablage` noch da.
- [ ] 4.2 `src/anhang/audit_repo.rs` mit `Fassung`-Abbildung, `anlegen` und `liste_je_linker` (JOIN über den Deskriptor, einschließlich soft-gelöschter Linker, neueste zuerst), DTO `AnhangZugriffAnzeige`. Es gibt keine Update- und keine Delete-Funktion.
  - Repo-Tests zuerst:
    - Einträge zweier UHS werden getrennt;
    - ein entfernter Anhang bleibt sichtbar;
    - eine fremde `einsatz_id` liefert nichts;
    - die Reihenfolge stimmt.
  - Verifiziert durch `cargo test --lib anhang::audit_repo`.
- [ ] 4.3 Audit in `uhs_anhang::datei` einbauen, Reihenfolge nach D5: Lookup → bei Original `original_freigeben` → `audit_repo::anlegen` → `anhang_antwort`. Das Audit wird auch bei 304 geschrieben.
  - Integrationstests in `tests/uhs_anhang.rs` zuerst:
    - Download → genau ein Eintrag „bereinigt“ mit Person und Anhang;
    - Original durch die Einsatzleitung → ein Eintrag „original“ plus ETB-Vermerk;
    - 304 → ein Eintrag;
    - Liste und Ablegen → kein Eintrag;
    - 403 (Modul gesperrt, Original für Führungspersonal) und 404 (anderer UHS, entfernt, generischer Pfad) → kein Eintrag;
    - fail-closed: `anhang_zugriff_audit` per Trigger `RAISE(ABORT)` in der Test-DB gesperrt → Fehlerantwort ohne Bytes.
  - Verifiziert durch `cargo test --test uhs_anhang`.
- [ ] 4.4 Einsicht `GET /api/einsaetze/{id}/uhs/{uid}/anhaenge/zugriffe` mit `ctx.fordere_einsatzleitung()`, UHS im Einsatz (404). Die Einsicht schreibt selbst keinen Eintrag.
  - Tests zuerst: Einsatzleitung 200 mit Dateiname, Person, Fassung und Zeit; Führungspersonal und Beobachter 403; fremde UHS 404; die Einsicht erzeugt keinen Eintrag.
  - Codegen für `AnhangZugriffAnzeige`, Barrel `AnhangZugriff`.
  - Verifiziert durch `cargo test --test uhs_anhang` und `scripts/check-typ-codegen.sh`.
- [ ] 4.5 `src/AGENTS.md`, Absatz zu den Erfassungs-Anhängen: das UHS-Audit ergänzen (Tabelle, fail-closed, kein FK auf `anhang` mit Grund, Einsicht nur für die Einsatzleitung, kein Audit an Tieren). Verifiziert durch Lesen des Absatzes gegen D5 und `scripts/check-fmt.sh`.

## 5. Frontend: modulneutrale Bausteine (design.md D6)

- [ ] 5.1 API-Funktionen anlegen:
  - in `api/einsatzTier.ts`: `listeTierAnhaenge`, `legeTierAnhangAb` (FormData `datei`, `apiUpload` mit `UPLOAD_TIMEOUT_MS`), `entferneTierAnhang`, `tierAnhangDownloadPfad`;
  - in `api/einsatzUhs.ts`: dasselbe für die UHS, dazu `ladeUhsAnhangZugriffe`.

  Verifiziert durch Unit-Tests auf Pfade, Methode und FormData-Feld, nach dem Muster `api/einsatzSchaden.test.ts`.
- [ ] 5.2 Query-Keys in `api/queryKeys.ts`:
  - `tierAnhaenge` unter `EINSATZ_STREAM_EVENTS.tier`;
  - `uhsAnhaenge` unter `EINSATZ_STREAM_EVENTS.uhs`;
  - `uhsAnhangZugriffe` in `NICHT_LIVE`.

  Verifiziert durch `queryKeys.test.ts` (Byte-Pin), ein grünes `queryKeys.guard.test.ts` und Tests „`tier`- bzw. `uhs`-Ereignis invalidiert die Anhangliste“.
- [ ] 5.3 `components/erfassungsAnhaenge/ErfassungsAnhaenge.tsx` und `ErfassungsAnhangAblegenModal.tsx` aus den Schaden-Komponenten heben, mit den Props nach D6 (`kennung`, `gesperrt`, `api`, `queryKey`, `hinweis`). `SchadenAnhaenge` und `SchadenAnhangAblegenModal` werden dünne Hüllen.
  - Verifiziert durch:
    - unverändert grüne `SchadenAnhaenge.test.tsx`, `SchadenAnhangAblegenModal.test.tsx` und `SchaedenDetailPage.test.tsx`;
    - eigene Tests des Bausteins: `hinweis` steht im Dialog, `kennung` im zugänglichen Namen;
    - grüne `dichte.guard.test.ts` und `aktionsabstand.guard.test.ts`.

## 6. Frontend: Tier-Detailseite

- [ ] 6.1 Paneel „Fotos und Dateien“ in `pages/TiereDetailPage.tsx` nach dem Datenraster, außerhalb jedes Bearbeiten-Formulars. `gesperrt` folgt `storniert_at`, `darfSchreiben` folgt dem Schreibrecht der Seite.
  - Tests zuerst: der Block ist vorhanden, kein `<form>` steckt in einem `<form>`, am stornierten Tier gibt es keine Aktionen, der Anker zeigt auf `/tiere/{tid}/anhaenge/{aid}/datei`.
  - Verifiziert durch Vitest der Datei und `pnpm lint` ohne Warnung.
- [ ] 6.2 e2e `e2e/tier-anhaenge.spec.ts`: Tier anlegen → Detailseite → JPEG ablegen → Zeile sichtbar → Download-Ereignis mit Dateinamen → ETB zeigt „Tier T-001: Foto abgelegt“ → Entfernen mit Bestätigung → Zeile weg. Verifiziert durch `pnpm e2e -- tier-anhaenge`.

## 7. Frontend: UHS-Reiter „Dateien“ und Zugriffe

- [ ] 7.1 Dritter Reiter „Dateien“ in `pages/uhs/UhsDetailPage.tsx`. Die `Segmentleiste` wird „Material, Bewegungen und Dateien“. Der Reiter zeigt `ErfassungsAnhaenge` mit `kennung = bezeichnung` und dem Hinweis „Jeder Abruf einer Datei wird protokolliert.“
  - Tests zuerst: der Reiterwechsel zeigt die Liste; der Hinweis steht im Ablegen-Dialog; an einer stornierten UHS gibt es keine Aktionen; die Tastaturbedienung der Segmentleiste ist unverändert.
  - Verifiziert durch Vitest in `UhsDetailPage.test.tsx` bzw. einer neuen Datei.
- [ ] 7.2 Bereich „Zugriffe“ unter der Liste, nur für `istEinsatzLeitung`. Er lädt erst beim Aufklappen (`enabled`, `retry: false`) und zeigt eine Tabelle mit Zeit, Person, Datei und Fassung.
  - Tests zuerst: Führungspersonal sieht den Bereich nicht und es gibt keinen Abruf; für die Einsatzleitung fällt vor dem Aufklappen kein Abruf, danach eine Tabelle; Leer-, Lade- und Fehlerzustand.
  - Verifiziert durch Vitest.
- [ ] 7.3 e2e `e2e/uhs-anhaenge.spec.ts`: UHS anlegen → Reiter „Dateien“ → PDF ablegen → herunterladen → als Einsatzleitung „Zugriffe“ aufklappen → Eintrag „bereinigt“ sichtbar → Entfernen. Verifiziert durch `pnpm e2e -- uhs-anhaenge`.
- [ ] 7.4 `pruefliste.md` in dieser Change: die Prüfliste Einsatztauglichkeit (15 Kriterien) für das Tier-Paneel, den UHS-Reiter samt Zugriffsliste und den Dialog.
  - Jede Zeile trägt ein Verdikt: erfüllt, offen mit Zielticket oder nicht anwendbar.
  - Gemessen werden die Trefflächen 30/48/72 und die Tabfolge im Dialog.
  - Verifiziert durch die Datei ohne „nicht geprüft“.

## 8. Integration und Abschluss

- [ ] 8.1 Folgeticket „Bild als Hintergrund des UHS-Platz-Layouts“ auf dem Entwicklungsboard anlegen (Skill `clickup-task-anlegen`), soweit es nicht schon besteht. Verifiziert durch den Ticket-Link im PR-Text.
- [ ] 8.2 Gesamt-Gate:
  - `./scripts/check-all.sh` grün;
  - zusätzlich `cargo test --no-default-features`, weil Anhang-Code berührt ist;
  - `scripts/check-migrationen.sh` unmittelbar vor dem PR gegen frisches `origin/alpha`.

  Verifiziert durch die Exit-Codes (ohne `| tail`).

# LFH-135 — Aufbewahrung & Archiv: Frist-Politik, Auto-Befüllung, Purge & Schwärzung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — task-by-task TDD. Steps use `- [ ]`. Dies ist der DATENVERLUST-kritischste Subtask (irreversible Löschung) — defensiv planen, Dry-Run/Logging, „aktiver Einsatz wird nie gelöscht"-Tests.

**Goal:** Aufbewahrung Ende-zu-Ende: (1) eine **Frist-Politik** (Retention-Dauer in Tagen) pro Einsatz konfigurieren, (2) `retention_bis` beim **Einsatz-Abschluss automatisch befüllen** (aus der konfigurierten Dauer, nur wenn noch keine Frist gesetzt ist), (3) `geloescht_at`-Soft-Delete am **Datenzugriff** durchsetzen (`darf_lesen`), und (4) einen idempotenten **Purge-Tick** ergänzen, der nach abgelaufener Frist zuerst soft-löscht (Tombstone setzen = Karenz) und nach Karenz hart purged/schwärzt. Phasen 1–4 shippen unabhängig; die irreversible Phase 5 ist als **PII-Schwärzung** entschieden (Checkpoint): nach Karenz werden Personendaten gescrubbt, das **operative Skelett + ETB bleiben** für gesetzliche/statistische Aufbewahrung erhalten. Kein Voll-DELETE der Einsatz-Akte.

**Architecture:** Die Retention-Foundation ist bereits shipped (LFH-130): `darf_lesen` sperrt abgelaufene `retention_bis` server-/routenseitig vor allen anderen Checks; `ist_fristverkuerzung` + `frist_setzen` (tx + ETB-Audit) erlauben **manuelles** Setzen einer absoluten Frist mit Verkürzungs-Bestätigung. Dieser Subtask baut additiv darauf auf:
- **Frist-Politik = Dauer**, nicht Zeitpunkt: neue Spalte `retention_dauer_tage INTEGER` auf `einsatz_einstellungen` (ADD COLUMN, kein CHECK, Validierung in Rust). Die Politik ist eine *Dauer*, der Zeitpunkt (`retention_bis`) wird erst beim Abschluss daraus berechnet. `NULL` = keine Auto-Frist (sicherer Default, wie heute).
- **Auto-Befüllung** beim Abschluss: `repo::abschliessen` wird zu tx (Muster `frist_setzen`), berechnet `retention_bis = abschluss + dauer_tage` **nur wenn `retention_bis IS NULL`** (überschreibt nie eine manuell gesetzte Frist), schreibt ETB-System-Audit. Umgeht bewusst die `ist_fristverkuerzung`-Bestätigung (None→Some wäre sonst 409).
- **Soft-Delete am Zugriff:** `darf_lesen` honoriert zusätzlich `geloescht_at` (Tombstone gesetzt → hart gesperrt, vor allen anderen Checks, auch für höhere Berechtigung). Greift über `fordere_lesezugriff` automatisch in allen 66 Lese-/Export-/Stream-Routen → Schwärzung/Sperre am Datenzugriff, nicht nur in der UI.
- **Purge-Tick** im Muster des Erinnerungs-Schedulers (`tick_einmal(pool, jetzt) -> usize` + dünner `starte_scheduler`, injiziertes `jetzt`, idempotent über WHERE-Guards): Phase A setzt `geloescht_at` für `status='abgeschlossen' AND retention_bis IS NOT NULL AND jetzt >= retention_bis AND geloescht_at IS NULL` (= Karenz-Start); Phase B (irreversibel) purged/schwärzt nach Ablauf der Karenz (`jetzt >= geloescht_at + KARENZ`). Kein neuer Timer-Mechanismus — neben dem bestehenden Scheduler in `main.rs` gestartet.

**Tech Stack:** Rust (axum + sqlx-sqlite), React/TS (antd, React Query).

## Global Constraints

- Keine DB-CHECK; Validierung in Rust. Skalares Feld per **ADD COLUMN auf `einsatz_einstellungen`** (kein Rebuild).
- Migrationsnummer = **nächste freie** (0064/0065 belegt bzw. von LFH-132 reserviert → die zur Implementierungszeit nächste freie Nummer; NICHT hart festschreiben).
- **Frist greift erst ab Abschluss, NIE auf aktive Einsätze.** Auto-Fill nur im Abschluss-Pfad; Purge-Query hat `status='abgeschlossen'` hart im WHERE.
- **Auto-Fill überschreibt keine manuell gesetzte Frist** (`WHERE ... AND retention_bis IS NULL`).
- **Soft-Delete + Karenz statt hartem DELETE:** zuerst `geloescht_at` kippen (reversibel), Hart-Purge erst nach Karenz.
- **Schwärzung/Sperre am Datenzugriff** (`darf_lesen`/`fordere_lesezugriff`), nicht nur UI — deckt Export, Druck, API, SSE über den gemeinsamen Guard ab.
- **Org-Isolation:** alle Queries strikt per `einsatz_id` / über die `einsatz`-Tabelle; nie über Benutzer-Org ableiten (Memory cross-org-lesezugriff-luecke).
- **Idempotenz/Dry-Run:** Purge-Tick idempotent (WHERE-Guards), mit `tracing`-Logging; Hart-Purge zusätzlich hinter einer Dry-Run-fähigen Funktion (zählt + loggt, ohne zu löschen) gated.
- Fehler-Codes: Validation=400, Conflict=409, Forbidden=403.
- rust-embed: Frontend-Änderung = pnpm build + Backend-Neustart.
- Commit-Referenz: `LFH-135`.

## File Structure

**Backend:**
- Create `migrations/<naechste-freie>_einsatz_retention_politik.sql` — `ALTER TABLE einsatz_einstellungen ADD COLUMN retention_dauer_tage INTEGER;` (kein CHECK, NULL = keine Auto-Frist) **und** `ALTER TABLE einsatz ADD COLUMN geschwaerzt_at TEXT;` (PII-Schwärzungs-Tombstone, NULL = nicht geschwärzt; getrennt von `geloescht_at`-Karenz-Tombstone).
- Modify `src/einsatz/einstellungen.rs` — Feld `retention_dauer_tage: Option<i64>` in `EinsatzEinstellungen` + `EinstellungenAnzeige` + `EinstellungenDaten` + `leer` + `anzeige` + SELECT/UPSERT (`laden_oder_default`, `speichern`); Validator `ist_gueltige_retention_dauer(tage) -> bool` (z. B. `1..=3650`, `0`/negativ unzulässig — kein Instant-Purge). Tests: UPSERT round-trip mit Dauer, Validator-Grenzen.
- Create `src/einsatz/retention.rs` — reine, injiziert-`jetzt`-testbare Aufbewahrungs-Logik:
  - `berechne_retention_bis(abschluss: &str, dauer_tage: i64) -> Option<String>` (kanonisches `%Y-%m-%d %H:%M:%S`).
  - `karenz_abgelaufen(geloescht_at: Option<&str>, jetzt) -> bool` (analog `retention_abgelaufen`), `KARENZ_TAGE` const.
  - Tests: Berechnung, Karenz-Grenzen, unparsebar → defensiv.
- Modify `src/einsatz/berechtigung.rs` — `darf_lesen` um `geloescht_at: Option<&str>`-Parameter erweitern: gesetzter Tombstone → `false` (vor allen anderen Checks, auch höhere Berechtigung). `fordere_lesezugriff` reicht `einsatz.geloescht_at.as_deref()` durch. Unit-Tests: Tombstone sperrt Mitglied + Admit + Admin; ungesetzt = Verhalten wie bisher.
- Modify `src/einsatz/repo.rs`:
  - `abschliessen` → tx (Muster `frist_setzen`): Status setzen, dann Auto-Fill `UPDATE einsatz SET retention_bis = ? WHERE id = ? AND retention_bis IS NULL` (nur wenn Dauer in `einstellungen` gesetzt), ETB-System-Audit (`anlegen_tx`, „Aufbewahrungsfrist automatisch gesetzt auf …"), commit. Auto-Fill nur, wenn Dauer vorhanden; sonst unverändert.
  - Purge-Repo-Funktionen: `faellige_soft_delete(pool, jetzt) -> Vec<i64>` (Query `status='abgeschlossen' AND retention_bis IS NOT NULL AND jetzt >= retention_bis AND geloescht_at IS NULL`), `markiere_geloescht(pool, einsatz_id, jetzt)`, `faellige_purge(pool, jetzt, karenz_tage) -> Vec<i64>` (`geloescht_at IS NOT NULL AND jetzt >= geloescht_at + karenz`), `purge_ausfuehren(pool, einsatz_id)` (Phase 5, hinter Decision; Hart-Löschung ODER PII-Schwärzung — siehe Open Questions). Tests: aktiver Einsatz nie in `faellige_soft_delete`; nur abgelaufene; Karenz-Grenze.
- Create `src/einsatz/purge_scheduler.rs` — `tick_einmal(pool, jetzt) -> usize` (Phase A: soft-delete kippen + ETB-Audit + `tracing::info`; Phase B: purge/dry-run), dünner `starte_purge_scheduler(pool)` (Tokio-`interval`, ruft `tick_einmal`). Muster strikt aus `src/erinnerung/scheduler.rs`. Tests: idempotenter Doppel-Tick (zweiter Tick = 0), aktiver Einsatz nie gelöscht, Soft-Delete vor Karenz nie hart gepurged.
- Modify `src/einsatz/mod.rs` — `mod retention; mod purge_scheduler;` registrieren; `EinsatzAnzeige` optional um `retention_dauer_tage`/`geloescht_at` ergänzen falls FE es braucht (Einstellungen-Page liest Dauer aus `EinstellungenAnzeige`, daher dort genügend — `geloescht_at` nicht in die öffentliche Anzeige leaken).
- Modify `src/routes/einsatz.rs` — `EinstellungenUpdate` + `einstellungen_setzen` um `retention_dauer_tage` (Validierung `ist_gueltige_retention_dauer`, sonst 400) erweitern; an `EinstellungenDaten` durchreichen.
- Modify `src/main.rs` — `starte_purge_scheduler(pool.clone())` neben dem Erinnerungs-Scheduler starten (nur Server-Lauf).
- Modify `tests/einsatz.rs` (+ ggf. `tests/`-Integrations) — Integrationstests: Auto-Fill beim Abschluss (Dauer gesetzt → `retention_bis` berechnet; Dauer NULL → keine Frist; manuell gesetzte Frist bleibt unverändert), Tombstone → 403 auf Detail/Export/Stream, Politik-Setzen über PUT /einstellungen (Feldabdeckung), aktiver Einsatz nie soft-deleted.

**Frontend:**
- Modify `frontend/src/api/types.ts` — `retention_dauer_tage: number | null` in `EinsatzEinstellungen` + `EinstellungenUpdate`.
- Modify `frontend/src/api/einsaetze.ts` — Feld in Lade-/Speicher-Payload mitführen (falls dort explizit gemappt).
- Modify `frontend/src/pages/EinsatzEinstellungenPage.tsx` — **genau eine** zusätzliche additive Sektion „Aufbewahrung & Archiv": `InputNumber` für Retention-Dauer (Tage), Hinweistext, dass die Frist erst beim Abschluss greift und Verkürzung an anderer Stelle (manuelle Frist) bestätigungspflichtig ist. Bestehende Sektionen NICHT umbauen. `disabled={!darfBearbeiten}` wie die anderen Felder. Submit-Test (Feldabdeckung: Dauer wird gelesen + gesendet).

## Tasks (TDD, Commit je Task)

1. **Frist-Politik-Persistenz** — Migration (nächste freie) `retention_dauer_tage` + `einstellungen.rs` (Domain-Feld, UPSERT, `ist_gueltige_retention_dauer`) + Tests.
   - [ ] Test: `ist_gueltige_retention_dauer` (0/negativ/zu groß → false, 1..=3650 → true).
   - [ ] Test: `speichern`/`laden_oder_default` round-trippen `retention_dauer_tage`.
   - [ ] Migration + Domain implementieren, grün.
2. **PUT /einstellungen erweitern** — Route nimmt `retention_dauer_tage` (Validierung 400) + reicht durch.
   - [ ] Integrationstest: PUT mit gültiger Dauer persistiert; ungültige (0) → 400; NULL hebt auf.
3. **Auto-Befüllung beim Abschluss** — `repo::abschliessen` → tx, Auto-Fill nur bei gesetzter Dauer und `retention_bis IS NULL`, ETB-Audit.
   - [ ] Test: Dauer gesetzt → `retention_bis = abschluss + dauer` berechnet; ETB-Audit-Eintrag vorhanden.
   - [ ] Test: Dauer NULL → keine Frist.
   - [ ] Test: bereits manuell gesetzte Frist bleibt beim Abschluss unverändert (kein Overwrite).
   - [ ] `berechne_retention_bis` (retention.rs) + tx-Umbau implementieren, grün.
4. **Soft-Delete am Zugriff** — `darf_lesen` honoriert `geloescht_at`.
   - [ ] Unit-Tests: gesetzter Tombstone sperrt Mitglied/Einsatzleitung/Admin; ungesetzt = unverändert.
   - [ ] `darf_lesen`/`fordere_lesezugriff` erweitern; bestehende darf_lesen-Tests um den neuen Parameter nachziehen.
   - [ ] Integrationstest: Einsatz mit `geloescht_at` → 403 auf Detail, Export, Stream.
5. **Purge-Tick Phase A (Soft-Delete, reversibel)** — Scheduler-Muster, Karenz-Start.
   - [ ] Test: `faellige_soft_delete` enthält NIE aktive Einsätze (harter `status='abgeschlossen'`-Test).
   - [ ] Test: nur abgelaufene `retention_bis`; Tick kippt `geloescht_at`; zweiter Tick = 0 (idempotent).
   - [ ] `purge_scheduler::tick_einmal` (Phase A) + `markiere_geloescht` + `starte_purge_scheduler` in main.rs, grün.
6. **Purge-Tick Phase B (PII-Schwärzung, IRREVERSIBEL — entschieden)** — Scope = **PII-Schwärzung** (kein Voll-DELETE): nach Karenz Personendaten in den personenbezogenen Tabellen (`einsatz_person` und weitere PII-tragende Module — beim Implementieren enumerieren: Name/Geburtsdatum/Adresse/Kontakt/Sichtungs-Freitext etc.) auf einen Platzhalter scrubben/nullen; operatives Skelett (Einsatz, ETB-Einträge, Zähler, aggregierte Lage) bleibt erhalten. `geschwaerzt_at`-Tombstone auf dem Einsatz setzen (idempotent: bereits geschwärzt → kein erneutes Scrubben).
   - [ ] Test: `faellige_purge` greift erst nach Karenz (`geloescht_at + KARENZ_TAGE`), nie davor.
   - [ ] Test: aktiver Einsatz nie in `faellige_purge`.
   - [ ] Test: nach Schwärzung sind PII-Felder geleert/platzhalter, ETB-Einträge + Einsatz-Skelett aber noch vorhanden; zweiter Tick idempotent (kein Doppel-Scrub, `geschwaerzt_at` gesetzt).
   - [ ] **Schwärzung am Datenzugriff:** Export-/Anzeige-Serialisierer der PII-Module liefern für geschwärzte Einsätze keine Klardaten mehr (Scrub ist persistent → automatisch; zusätzlich Test, dass Export eines geschwärzten Einsatzes keine PII enthält).
   - [ ] Implementierung mit `tracing`-Logging + ETB-System-Audit vor Ausführung; scharf (keine Dry-Run-Gate-Blockade mehr). Commit `LFH-135`.
7. **Frontend: Sektion „Aufbewahrung & Archiv"** — Dauer-Feld in `EinsatzEinstellungenPage` + Typen/API.
   - [ ] Test: Page rendert Dauer-Feld, Submit sendet `retention_dauer_tage` (Feldabdeckung), disabled bei abgeschlossenem Einsatz/fehlender Berechtigung.
   - [ ] Typen + additive Sektion implementieren; pnpm build.

## Risiken / Hinweise

- **Task 6 entschieden = PII-Schwärzung** (kein Voll-DELETE): Personendaten in `einsatz_person` etc. scrubben, operatives Skelett + ETB behalten. Beim Implementieren die PII-tragenden Tabellen/Spalten vollständig enumerieren (Memory review-eingabemaske-feldabdeckung: kein PII-Feld übersehen) — Personen, Sichtungs-Freitexte, Kontaktdaten, ggf. Tier-Halter, UHS-Personenbezug. Schwärzung ist persistent (am Datenzugriff automatisch wirksam), zusätzlich Export-Test.
- **Auto-Fill darf nicht durch den Verkürzungs-Gate** (`ist_fristverkuerzung` liefert bei None→Some `true` → 409). Auto-Fill setzt direkt im Abschluss-tx, NICHT über `aufbewahrungsfrist_setzen`. Das manuelle `frist_setzen` / `aufbewahrungsfrist_setzen` bleibt unangetastet (shipped).
- **`darf_lesen`-Signaturänderung** zieht alle bestehenden Aufrufer + ~17 Unit-Tests nach (neuer `geloescht_at`-Parameter). Mechanisch, aber vollständig — `fordere_lesezugriff` ist der einzige Produktions-Aufrufer.
- **Null-Politik = kein Auto-Fill = kein Purge** ist der sichere Default; `dauer=0`/negativ wird abgelehnt (kein Instant-Purge).
- **Karenz-Wert:** globale Konstante `KARENZ_TAGE` (wie `NACHLAUF_STUNDEN`) statt pro-Einsatz-Konfiguration — einfacher und sicherer; bei Bedarf später konfigurierbar.
- **Kein neuer Timer-Mechanismus:** Purge-Tick spiegelt `erinnerung::scheduler` (injiziertes `jetzt`, idempotent, dünner spawn-Wrapper), neben dem bestehenden Scheduler in `main.rs` gestartet (Memory fristen-eskalation-erinnerungs-scheduler).
- **Soft-Delete-Pattern** an `chat.geloescht_at` orientieren (Tombstone, Inhalt wird nicht mehr ausgeliefert) — konsistente Hausregel.
- **`einsatz.geloescht_at` ist heute genuin ungenutzt** (die geloescht_at-Grep-Treffer in chat sind chats eigene Spalte; FE-Typ types.ts:653 ist `ChatNachricht`) — die `darf_lesen`-Erweiterung kollidiert mit nichts.
- **Export/Druck:** es gibt keine separate Voll-Einsatz-Export/PDF-Route; Modul-Exporte (`personen/export`, `tiere/export`, …) und SSE-Streams laufen alle über `fordere_lesezugriff` → die Tombstone-/Retention-Sperre greift dort automatisch. Bei reading „PII-Schwärzung statt Block" (Open Question) müsste Schwärzung zusätzlich in den Export-/Anzeige-Serialisierern erfolgen — dann ist `darf_lesen`-Block NICHT ausreichend; das ist Teil von Task 6 nach der Entscheidung.

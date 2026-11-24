# Personal-Abruf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lifeline Hub ruft Personal mit Qualifikationen aus dem Helfer-Modul der iuk-suite ab und legt den Stand als Schnappschuss einem Admin zur Bestätigung im Stammdaten-Eingang (LLH-1633) vor.

**Architecture:** Teil A (Repo `iuk-suite`, IDA-420): Zugangsschlüssel und ein Bearer-Endpunkt im Helfer-Modul, der den Vertrag „Stammdaten-Abruf“ liefert. Teil B (Repo `lifeline-hub`, LLH-1194): neue Adapterart `stammdaten_abruf` im Adapter-Rahmen (LLH-1632). Sie schreibt einen Schnappschuss, den Routen und das Modal von LLH-1633 vorlegen und übernehmen. Teil B beginnt erst, wenn der Kern von LLH-1633 committet ist (Aufgabe 5 seines Plans).

**Tech Stack:** A: Next.js 16 Route Handler, Drizzle + better-sqlite3, antd 6, Vitest, Playwright. B: Rust/axum/sqlx (SQLite), utoipa, React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-y3xpaeza-personal-abruf-design.md`

## Global Constraints

- Kennung = `helfer.id` der Suite, nie die HiOrg-Kennung. Herkunft in Lifeline = Feld `herkunft` des Adapters.
- Hinaus gehen nur Helfer mit `fuerEinsatzbuch = true` und `herkunft <> 'demo'`, je Person nur `kennung`, `name` („Nachname, Vorname“), `qualifikationen` (Namen, ohne Dopplung, sortiert).
- In Lifeline-Code, Migration, Enum und Oberflächentext kein „iuk“ und kein „HiOrg“ (G4).
- Nie still übernehmen (G1): Ein Abruf schreibt nur einen Schnappschuss.
- Grenzen wie die Stammdaten-Datei: Körper ≤ 2 MiB, ≤ 5000 Einträge je Art.
- Adapterart: Code `stammdaten_abruf`, Felder `adresse` (Url, Pflicht), `herkunft` (Text, Pflicht, ≤ 100), Platz `schluessel` (Pflicht), Intervall Vorschlag 21600 s, frühestens 3600 s.
- Suite: kein ETag/304. Das Modul bleibt `requiresAuth: true`; die Routing-Ausnahme gilt für genau einen Pfad.
- Suite: Commit-Body `Zunder: https://zunder.rubeen.dev/#/aufgabe/lhlj4w0n5vtq1zs5u0lya17q`; Lifeline: `Zunder: https://zunder.rubeen.dev/#/aufgabe/y3xpaezav6owwfdzfwor6u7b`.
- Commit-Präfix `feat` für die Features (Versionsnummer der Suite hängt daran).

## Review Focus

- Widerrufener Schlüssel: Der nächste Abruf bekommt 401, und Lifeline zeigt am Adapter „Zugang abgelehnt“. Eine wiederholte Ablehnung erzeugt höchstens gedrosselte Audit-Zeilen (Test in A3 und B2).
- Helfer ohne Qualifikationen oder mit doppelten Qualifikationsnamen aus zwei Listen: ergibt `[]` bzw. einen einzigen Namen (Test in A2).
- Nachbarpfade des Endpunkts, etwa `/api/stammdaten/x`, `/api/stammdatenx` und `/m/helfer/` ohne Anmeldung, landen weiter beim Login (Test in A3).
- Quelle liefert dieselben Personen in anderer Reihenfolge: kein neuer Schnappschuss (Test in B2).
- Zwischen Vorschau und Übernehmen ersetzt ein Abruf den Schnappschuss: Übernehmen gibt 409 und schreibt nichts (Test in B4).

---

## Teil A — iuk-suite (IDA-420)

Arbeitsverzeichnis `/home/user/iuk-suite`, Branch `claude/nice-hamilton-k6gplq`. Vorher `scripts/cloud-lfs.sh` und `pnpm install`.

### Task A1: Tabelle und Schlüssel

**Files:**
- Modify: `src/app/m/helfer/_db/schema.ts` (Tabelle `lifelineZugang`)
- Create: `src/app/m/helfer/_db/migrations/0003_zugang.sql` (per `pnpm drizzle-kit generate --config src/app/m/helfer/_db/drizzle.config.ts`, dann Audit-Trigger anhängen wie `lagemonitor_zugang` in `lagemonitor/_db/migrations/0000_grundbestand.sql`), Journal/Snapshot aus dem Generator
- Modify: `src/core/audit/catalog.ts` (Eintrag `helfer.helfer_zugang`, `audited`, `unauditedColumns: ["zuletzt_abgeholt_am"]`)
- Create: `src/app/m/helfer/_lib/schluessel.ts`, Test `src/app/m/helfer/_lib/schluessel.test.ts`

**Interfaces:**
- Produces: Tabelle `helfer_zugang` (`id`, `bezeichnung` ≤ 80, `schluessel_hash` UNIQUE, `angelegt_am`, `angelegt_von`, `zuletzt_abgeholt_am` NULL). Funktionen in `_lib/schluessel.ts`, ohne Import aus dem Lagemonitor:
  - `bearerAus(req: Request): string | null`
  - `legeZugangAn(db: HelferDb, bezeichnung: string, von: string, jetzt?: Date): { id: string; schluessel: string }`
  - `widerrufeZugang(db: HelferDb, id: string): boolean`
  - `zugangAusSchluessel(db: HelferDb, schluessel: string | null, jetzt?: Date): string | null` (vermerkt `zuletztAbgeholtAm`)
  - `listeZugaenge(db: HelferDb): ZugangDTO[]`
  - `hatLifelineZugang(db: HelferDb): boolean`

- [ ] **Step 1: Tests schreiben:** `legeZugangAn` liefert einen Schlüssel mit 43 Zeichen, gespeichert ist nur `hashVon(schluessel)`. `zugangAusSchluessel` findet den Zugang und setzt `zuletztAbgeholtAm`. Ein falscher Schlüssel, `null` und ein widerrufener Schlüssel ergeben `null`. `hatLifelineZugang` ist vor dem Anlegen false, danach true. Test-DB wie in den vorhandenen Helfer-Tests (`bereitstellung.test.ts`).
- [ ] **Step 2:** `pnpm vitest run src/app/m/helfer/_lib/schluessel.test.ts` muss FAIL zeigen (Modul fehlt).
- [ ] **Step 3: Schema, Migration (Generator plus Trigger), Katalogeintrag und `_lib/schluessel.ts` bauen.**
- [ ] **Step 4:** `pnpm vitest run src/app/m/helfer src/core/audit src/core/bootstrap.test.ts` muss PASS zeigen (Katalog- und Migrationsprüfungen eingeschlossen).
- [ ] **Step 5: Commit** `feat(helfer): access keys for Lifeline Hub`.

### Task A2: Bereitstellung für Lifeline

**Files:**
- Modify: `src/app/m/helfer/_lib/bereitstellung.ts` (`helferFuerLifeline`, Kopfkommentar um den dritten Empfänger ergänzen)
- Test: `src/app/m/helfer/_lib/bereitstellung.test.ts`

**Interfaces:**
- Produces: `helferFuerLifeline(db?: HelferDb): { personal: { kennung: string; name: string; qualifikationen: string[] }[] }`

- [ ] **Step 1: Tests:**
  - Nur `fuerEinsatzbuch = true` und keine Demo-Helfer.
  - `name === "Albers, Jana"`.
  - Qualifikationen `[{liste:"med",name:"Sanitätshelfer"},{liste:"x",name:"Sanitätshelfer"},{liste:"y",name:"Arzt"}]` ergeben `["Arzt","Sanitätshelfer"]`. Ohne Qualifikationen ergibt es `[]`.
  - Die Schlüssel jedes Eintrags sind genau `["kennung","name","qualifikationen"]`, `kennung === helfer.id` und nie die `quellId`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren. Sortieren mit `localeCompare(…, "de")`.
- [ ] **Step 4:** `pnpm vitest run src/app/m/helfer/_lib/bereitstellung.test.ts` muss PASS zeigen.
- [ ] **Step 5: Commit** `feat(helfer): provide personnel for Lifeline Hub`.

### Task A3: Endpunkt und Routing-Ausnahme

**Files:**
- Create: `src/app/m/helfer/api/stammdaten/route.ts`, Test `src/app/m/helfer/api/stammdaten/route.test.ts`
- Create: `src/app/m/helfer/_lib/ablehnung.ts` (Drossel wie `lagemonitor/_lib/ablehnung.ts`, Modul `helfer`)
- Modify: `src/core/routing.ts` (Ausnahme), `src/core/routing.test.ts`

**Interfaces:**
- Consumes: A1 `bearerAus`, `zugangAusSchluessel`; A2 `helferFuerLifeline`; `istHelferHost` aus `_lib/host.ts`.
- Produces: `GET https://<helfer-host>/api/stammdaten` → 200 `application/json` `{ personal: [...] }`, `Cache-Control: no-store`. Ohne gültigen Schlüssel kommt 401 `{ error: { code: "schluessel_ungueltig", message } }`. Auf einem fremden Host kommt 404.

- [ ] **Step 1: Routing-Tests in `routing.test.ts`:**
  - Auf dem Helfer-Host ergibt `decideRoute({host, pathname:"/api/stammdaten", groups:null})` das Ergebnis `{action:"rewrite", target:"/m/helfer/api/stammdaten", moduleKey:"helfer"}`.
  - `/m/helfer/api/stammdaten` mit `groups:null` ergibt `{action:"next"}`.
  - `/api/stammdaten/x`, `/api/stammdatenx`, `/` und `/m/helfer/einstellungen` mit `groups:null` ergeben weiter `action:"login"`.
  - Auf dem Portal-Host ist `/api/stammdaten` kein Durchlass.
- [ ] **Step 2: Route-Tests** (Request-Objekte direkt, Host-Kopf des Helfer-Hosts):
  - Ohne Bearer kommt 401, mit gültigem Schlüssel 200 samt Körper aus A2.
  - Mit einem widerrufenen Schlüssel kommt 401.
  - Auf einem fremden Host kommt 404.
  - Fünf Ablehnungen in Folge ergeben höchstens 5 Audit-Ablehnungen plus 1 `access_throttled`.
- [ ] **Step 3:** Beide Testdateien müssen FAIL zeigen.
- [ ] **Step 4: Bauen.**
  - Die Ausnahme in `decideRoute` steht vor dem `internal`-Zweig. Sie ist eine benannte Konstante `ABRUF_OHNE_LOGIN = { modul: "helfer", pfad: "/api/stammdaten" }` mit Kommentar (Riegel macht die Route selbst).
  - Sie greift für `/m/helfer/api/stammdaten` und auf dem Helfer-Host für `/api/stammdaten`, jeweils nur bei exakter Gleichheit.
- [ ] **Step 5:** `pnpm vitest run src/core/routing.test.ts src/app/m/helfer` muss PASS zeigen.
- [ ] **Step 6: Commit** `feat(helfer): personnel endpoint for Lifeline Hub`.

### Task A4: Verwaltung, Warnung, Notiz

**Files:**
- Modify: `src/app/m/helfer/_actions/verwaltung.ts` (`zugangAnlegenAction(bezeichnung: unknown): Promise<ActionErgebnis<{ schluessel: string; adresse: string }>>`, `zugangWiderrufenAction(id: unknown): Promise<ActionAusgang>`, beide über `requireHelferVerwaltenAktion`)
- Create: `src/app/m/helfer/_ui/LifelineZugaenge.tsx` (`"use client"`, Vorbild `lagemonitor/_ui/Zugaenge.tsx`)
- Modify: `src/app/m/helfer/(verwaltung)/einstellungen/page.tsx`:
  - Abschnitt „Zugang für Lifeline Hub“ nur für Verwaltende.
  - Datenschutz-Liste um den Punkt „An Lifeline Hub“ ergänzen (nur Freigegebene, Name und Qualifikationen, eigene Kennung).
  - Prop `lifelineZugang: boolean` an `Einstellungen`.
- Modify: `src/app/m/helfer/_ui/Einstellungen.tsx`: Bei `lifelineZugang` steht im Bestätigungsdialog des Quellwechsels zusätzlich: „Lifeline Hub muss die Personen danach einmal neu zuordnen.“
- Create: `src/app/m/portal/_lib/neuigkeiten/notizen/helfer/2026-11-25-zugang-lifeline.ts` und die Zeile in `register.ts`
- Test: Actions-Test zu Rechten (ohne Verwaltungsrecht → Wurf), DOM-Test `LifelineZugaenge` mit dem Harness `src/app/m/qr/_lib/test-dom.tsx` (Schlüssel einmal sichtbar, Widerrufen ruft die Action), e2e `e2e/helfer-lifeline-zugang.spec.ts` (anlegen, Schlüssel sichtbar, Abruf mit `request.get` ergibt 200, widerrufen, Abruf ergibt 401)

**Interfaces:**
- Consumes: A1 `legeZugangAn`, `widerrufeZugang`, `listeZugaenge`, `hatLifelineZugang`.
- Die angezeigte Adresse ist `https://<Helfer-Host>/api/stammdaten`, aus dem Host der Anfrage (`resolveHost`).

- [ ] **Step 1:** Tests schreiben (Actions, DOM, e2e).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Bauen. Regeln aus `CLAUDE.md` beachten: Falle 4 (kein `size`), Falle 6 und 7 (Icons nur über `Icons8Ikone`), Wortliste `docs/design/wortliste.md`, Notiz in Du-Form ohne Datei- oder Ticketnamen.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm vitest run` grün, `pnpm exec playwright test e2e/helfer-lifeline-zugang.spec.ts --trace off` grün.
- [ ] **Step 5: Commit** `feat(helfer): manage Lifeline Hub access in settings`. Danach push, PR gegen `main` im Repo `iuk-suite`, IDA-420 auf `review` mit `pr_url`.

---

## Teil B — Lifeline Hub (LLH-1194)

Arbeitsverzeichnis `/home/user/lifeline-hub`. **Startbedingung:** Die Session von LLH-1633 meldet, dass Aufgabe 5 committet ist. Dann `git merge origin/claude/bold-wright-6s51d4` in den eigenen Branch (nach dessen Merge stattdessen `origin/alpha`). Namen aus dem Kern laut Abstimmung (24.11.2026): Modul `src/stammdaten_eingang/`, `StammdatenPaket { fahrzeuge, personal, qualifikationen }`, `PersonalAngabe { zeile, quelle: Herkunftsangabe { kennung, herkunft }, name, personalnummer, telefon, traegerorganisation, qualifikationen }`, `repo::vorschau(pool, org_id, &paket, meldungen, nicht_uebernommen, herkunft_default, &Entscheidungen) -> StammdatenVorschau`, `repo::uebernehmen(...)`. Weichen die echten Namen ab, gelten die echten. Die Schritte unten werden dann einmal nachgezogen, bevor B1 beginnt.

### Task B1: JSON-Vertrag → Paket

**Files:**
- Create: `src/stammdaten_eingang/json.rs` (oder in der Art, falls LLH-1633 das ablehnt)
- Create: `docs/schnittstellen/stammdaten-abruf.md`, `docs/schnittstellen/beispiele/stammdaten-abruf.json`

**Interfaces:**
- Produces: `pub fn lies_paket(koerper: &[u8]) -> Result<GelesenesPaket, JsonFehler>`. `GelesenesPaket` enthält `paket: StammdatenPaket`, `meldungen` und `nicht_uebernommen` in denselben Typen, die `datei::lies_paket` liefert. `JsonFehler` ist eines von `KeinJson`, `KeinObjekt`, `ZuGross`, `ZuVieleEintraege { art }`.
- `pub fn fingerabdruck(paket: &StammdatenPaket) -> String` (SHA-256 hex über die kanonische Form: je Art nach `kennung`, dann `name`/`funkrufname`/`bezeichnung` sortiert, Qualifikationen je Person sortiert, `zeile` nicht mitgezählt)

- [ ] **Step 1: Tests:**
  - Das Beispiel-JSON ergibt 2 Personen mit `zeile` 1 und 2.
  - Ein Eintrag ohne `name` ist eine Zeile mit Fehler und kein `JsonFehler`.
  - Eine Kennung mit 101 Zeichen ist eine Zeile mit Fehler.
  - Ein unbekanntes Feld `iban` landet in `nicht_uebernommen` (nur der Name).
  - 2 MiB + 1 Byte ergibt `ZuGross`, 5001 Personen `ZuVieleEintraege`, `[]` ergibt `KeinObjekt`, `"x"` ergibt `KeinJson`.
  - Gleicher Inhalt in vertauschter Reihenfolge ergibt denselben Fingerabdruck, eine andere Qualifikation einen anderen.
- [ ] **Step 2:** `cargo test stammdaten_eingang::json` muss FAIL zeigen.
- [ ] **Step 3:** Implementieren, die Doku schreiben.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(stammdaten): JSON contract for master data pull`.

### Task B2: Schnappschuss und Adapterart

**Files:**
- Create: `migrations/NNNN_stammdaten_schnappschuss.sql` (nächste freie Nummer nach LLH-1633, `scripts/check-migrationen.sh`). SQL wie im Entwurf, dazu in derselben Migration die Spalte `adapter.vorlegen_erzwingen INTEGER NOT NULL DEFAULT 0` für „Erneut vorlegen“.
- Create: `src/stammdaten_eingang/schnappschuss.rs` (Repo: `offen_fuer_adapter`, `ersetzen_oder_anlegen`, `liste_offen(org_id)`, `laden(org_id, id)`, `als_uebernommen(conn, id, benutzer)`)
- Create: `src/adapter/arten/mod.rs`, `src/adapter/arten/stammdaten_abruf.rs`; Eintrag in `art::Verzeichnis`
- Modify: `src/db/tests.rs` (`migration_NNNN_stammdaten_schnappschuss`)
- Test: `tests/stammdaten_abruf.rs`

**Interfaces:**
- Consumes: B1 `lies_paket`, `fingerabdruck`; `AdapterArt`, `Uebernahme`, `AbrufKontext` (`src/adapter/art.rs`, `ziel.rs`).
- Produces: `pub struct Schnappschuss { id, org_id, adapter_id, status: SchnappschussStatus, fingerabdruck, inhalt: Option<StammdatenPaket>, anzahl: Anzahl, abgerufen_at, erledigt_at, erledigt_von }`; `wire_enum! SchnappschussStatus { Offen => "offen", Uebernommen => "uebernommen", Ersetzt => "ersetzt" }`.
- `Uebernahme::uebernehmen` gibt 0 zurück, wenn `vorlegen_erzwingen = 0` ist und der Fingerabdruck dem offenen oder dem jüngsten übernommenen gleicht. Sonst wird der offene `ersetzt` (`inhalt = NULL`), ein neuer `offen` angelegt, `vorlegen_erzwingen = 0` gesetzt, und das Ergebnis ist 1.

- [ ] **Step 1: Integrationstests** (Test-Server per `wiremock` bzw. dem Muster der Webhook-Tests, LAN-Ausnahme am Test-Adapter):
  - Erster Lauf legt 1 offenen Schnappschuss an.
  - Zweiter Lauf mit gleichem Körper in anderer Reihenfolge legt keinen neuen an.
  - Geänderter Körper: Der alte ist `ersetzt` mit `inhalt IS NULL`, ein neuer ist `offen`.
  - 401 der Quelle ergibt einen Adapterzustand mit Fehler „Zugang abgelehnt“ und keinen Schnappschuss.
  - Probelauf schreibt nichts.
  - Mit `vorlegen_erzwingen = 1` und gleichem Stand entsteht ein neuer Schnappschuss, danach ist die Markierung 0.
  - Migrationstest: CHECK `(status = 'offen') = (inhalt IS NOT NULL)` greift, und der eindeutige offene Schnappschuss je Adapter greift.
- [ ] **Step 2:** `cargo test --test stammdaten_abruf` muss FAIL zeigen.
- [ ] **Step 3:** Implementieren. Den Bearer über den Geheimnis-Platz `schluessel` des `AbrufKontext` setzen, `Accept: application/json`.
- [ ] **Step 4:** PASS. Dazu `cargo test db::tests` und `scripts/check-migrationen.sh` grün.
- [ ] **Step 5: Commit** `feat(adapter): master data pull adapter with snapshots`.

### Task B3: Aufräumen

**Files:**
- Modify: Aufbewahrungslauf in `src/aufbewahrung/` (erledigte Schnappschüsse älter als 90 Tage löschen, die jüngste `uebernommen`-Zeile je Adapter behalten)
- Test: im vorhandenen Aufbewahrungs-Testmodul

- [ ] **Step 1: Test:** Drei erledigte Zeilen, älter als 90 Tage. Nur die jüngste übernommene bleibt, eine offene bleibt immer.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(stammdaten): prune finished snapshots`.

### Task B4: Routen

**Files:**
- Modify: Routen-Modul von LLH-1633 (`src/routes/…stammdaten…`, Name aus dem Kern): `GET /api/master-data/import/snapshots`, `POST /api/master-data/import/snapshots/{id}/preview`, `POST /api/master-data/import/snapshots/{id}`, dazu `POST /api/admin/adapters/{id}/resubmit` (setzt `vorlegen_erzwingen = 1`, Recht wie die Adapter-Verwaltung)
- Modify: `openapi.json` (utoipa), `frontend` → `pnpm gen:types`
- Test: `tests/stammdaten_abruf.rs`

**Interfaces:**
- Consumes: B2 `schnappschuss::*`; `repo::vorschau` und `repo::uebernehmen` des Kerns.
- Produces: DTO `SchnappschussInfo { id, adapter_id, adapter_name, herkunft, anzahl, abgerufen_at }`. Vorschau und Übernahme nehmen `{ entscheidungen }` (JSON, Typ des Kerns) und liefern `StammdatenVorschau` bzw. `StammdatenErgebnis`.

- [ ] **Step 1: Tests:**
  - Liste ohne Inhalt. Ohne das Recht, Stammdaten zu verwalten: 403.
  - Vorschau schreibt nichts.
  - Übernehmen legt Personen an, setzt den Schnappschuss auf `uebernommen` mit `inhalt IS NULL`.
  - Übernehmen eines `ersetzt`-Schnappschusses ergibt 409 und schreibt keine Person.
  - Eine fremde Org ergibt 404.
  - Ein gekoppelter ELW ergibt 409 wie in LLH-1633.
  - `resubmit` setzt die Markierung.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren. Übernehmen und `als_uebernommen` laufen in einer Transaktion. Protokoll per `tracing` mit Schnappschuss-ID und Zählung.
- [ ] **Step 4:** PASS, dazu `scripts/check-typ-codegen.sh`.
- [ ] **Step 5: Commit** `feat(stammdaten): review and apply pulled snapshots`.

### Task B5: Oberfläche und Doku

**Files:**
- Modify: Modal von LLH-1633 (Quelle als Prop `{ art: "datei" } | { art: "schnappschuss", id }`; beim Schnappschuss ohne den ersten Schritt)
- Create: `frontend/src/stammdaten/SchnappschussHinweis.tsx` (Hinweis „Neue Personaldaten aus ‹Herkunft› vom ‹Zeit› zum Prüfen“ + „Prüfen“), eingebunden über dem Personal-Tab und in der Adapter-Einzelansicht (dort zusätzlich „Erneut vorlegen“)
- Modify: `docs/anwender/kapitel/anbindungen.md` (Abschnitt „Stammdaten abrufen“)
- Test: Vitest für den Hinweis (ohne offene Schnappschüsse nichts sichtbar, ohne Recht wird nichts geholt), e2e `frontend/e2e/stammdaten-abruf.spec.ts` (Seed eines offenen Schnappschusses, Hinweis, Modal, Übernehmen, Hinweis weg)

- [ ] **Step 1:** Tests schreiben.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Bauen. Nur vorhandene Bausteine verwenden (`frontend/AGENTS.md`).
- [ ] **Step 4:** Frontend-Tests und e2e grün, dazu `cargo test` und `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(stammdaten): review pulled personnel in the UI`. Danach `alpha` hineinmergen, push, PR gegen `alpha`, LLH-1194 auf `review`.

# LFH-84 — Gemeinsamer Unterbau & Modul-Grundgerüst (Kommunikation)

**Datum:** 2026-06-11
**Task:** LFH-84 (Entwicklungsboard) · Parent-Initiative LFH-45
**Branch:** `feat/lfh-84-kommunikation-unterbau`
**Status dieses Dokuments:** Entwurf zur Review

## 1. Kontext & Ziel

LFH-45 fordert einen „gemeinsamen Unterbau (Zustellung/SSE, Quittierung)" für alle
Kommunikations-Module. Fachlich ist Kommunikation das Nervensystem des Führungsvorgangs
(DV 100): top-down Befehle, bottom-up Meldungen über denselben technischen Unterbau.

Besonderheit: **Chat (LFH-50) und Erinnerungen (LFH-51) sind bereits gebaut und in `main`
gemerged** — ohne dieses Fundament. Sie haben Zustellung/Live/Berechtigung jeweils per
Copy-Paste gelöst. LFH-84 zieht das Fundament nachträglich ein **und stellt beide
Bestandsmodule darauf um** (Retrofit), damit das Fundament an echten Modulen bewiesen ist.

## 2. Scope

**In Scope**
- Neues Backend-Domänenmodul `src/kommunikation/` (Muster `etb/mod.rs` + `etb/repo.rs`)
- Zwei geteilte Tabellen + Migration: `kommunikation_zustellung`, `kommunikation_status`
- Zwei sauber getrennte Status-Achsen (Quittung vs. Vollzug) als wiederverwendbarer Baustein
- Geteilte Rust-Enums, Repo-Helfer, SSE-Publish-Helfer, Vokabular-Re-Exports
- Geteilter Frontend-API-Client + Live-Anbindung über bestehendes `useEinsatzLiveStream`
- Retrofit **Erinnerung** auf Quittung + Vollzug (inkl. Datenmigration, Scheduler bleibt grün)
- Retrofit **Chat** (dünn): geteilte Vokabulare + SSE-Helfer + optionale Lesebestätigung
- Org-Scope/Isolation (`org_id`) in allen geteilten Queries

**Out of Scope** (bewusst, Folge-Tasks)
- Grundgerüst der noch *geplanten* Module `auftraege` / `meldungen`
  (`modulRegistry.ts` geplant→real). Die entsprechende Task-Zeile zielt auf neue Module,
  nicht auf den Retrofit. Bleibt für separate Tasks; Board/PR spiegeln das wider.
- Chat ohne Quittung/Vollzug — diese Achsen sind für eine Konversation fachlich nicht sinnvoll.

## 3. Architektur (Hybrid)

Geteilter **Code + geteilte Tabellen**, aber die **Inhalts-Tabellen bleiben modul-eigen**
(`chat_nachricht`, `erinnerung`). Das Fundament liefert nur die übergreifenden Mechaniken
(Zustellung, Quittung/Vollzug, Berechtigung, SSE, Vokabular), nicht ein vereinheitlichtes
Nachrichten-Schema. Damit bleibt jede Domäne bei ihrer passenden Datenform und es gibt keine
riskante Daten-Vereinheitlichung.

```
src/kommunikation/
  mod.rs    — Enums (Zustellstatus, VollzugStatus), ObjektTyp, Vokabular-Re-Exports, Typen
  repo.rs   — vermerke_zustellung / markiere_gelesen / quittiere / setze_vollzug /
              lade_status / lade_zustellungen + Cross-Einsatz/Org-Checks
src/routes/kommunikation.rs (optional) — generische Endpunkte, falls Module sie teilen;
              sonst rufen die Modul-Routen die Repo-Helfer direkt auf
```

## 4. Datenmodell

Neue Migration `migrations/0045_kommunikation.sql` (nächste freie Nummer nach 0044).

### 4.1 `kommunikation_zustellung` — Achse 1, **pro Empfänger**
Sparse: eine Zeile entsteht erst, wenn ein Empfänger empfängt/liest (kein Vorab-Fan-out).

| Spalte | Typ | Hinweis |
|---|---|---|
| id | INTEGER PK | |
| org_id | INTEGER NOT NULL | Isolation |
| einsatz_id | INTEGER NOT NULL | |
| objekt_typ | TEXT NOT NULL | z.B. `chat_nachricht` |
| objekt_id | INTEGER NOT NULL | |
| empfaenger_id | INTEGER NOT NULL | User-ID |
| zugestellt_at | TEXT | |
| gelesen_at | TEXT NULL | Lesebestätigung |

- `UNIQUE(objekt_typ, objekt_id, empfaenger_id)`
- `INDEX(einsatz_id, objekt_typ, objekt_id)`
- Nutzer: **Chat** (Lesebestätigung).

### 4.2 `kommunikation_status` — Achse 1 (Quittung) + Achse 2 (Vollzug), **pro Objekt**
Eine Zeile je Objekt. Trägt beide Achsen als getrennte Feldgruppen.

| Spalte | Typ | Achse | Hinweis |
|---|---|---|---|
| id | INTEGER PK | | |
| org_id | INTEGER NOT NULL | | Isolation |
| einsatz_id | INTEGER NOT NULL | | |
| objekt_typ | TEXT NOT NULL | | z.B. `erinnerung` |
| objekt_id | INTEGER NOT NULL | | |
| quittiert_at | TEXT NULL | **Quittung** | „zur Kenntnis genommen" |
| quittiert_von_id | INTEGER NULL | **Quittung** | |
| vollzug_status | TEXT NOT NULL DEFAULT 'offen' | **Vollzug** | `offen`/`in_arbeit`/`vollzogen` |
| vollzogen_at | TEXT NULL | **Vollzug** | |
| vollzogen_von_id | INTEGER NULL | **Vollzug** | |

- `UNIQUE(objekt_typ, objekt_id)`
- `INDEX(einsatz_id, objekt_typ, objekt_id)`
- Nutzer: **Erinnerung** (und künftig Aufträge).
- Task-Begriff „Quittung" = die Quittungs-Spalten; „Vollzug" = die Vollzug-Spalten. Beide
  unabhängig setzbar (ein Objekt kann quittiert *und* offen, oder offen *und* vollzogen sein).

### 4.3 Granularität — die zentrale Entscheidung
- **Zustellung pro Empfänger**, weil Lesebestätigung inhärent „wer hat gelesen" ist (Chat).
- **Quittung + Vollzug pro Objekt**, weil Erinnerung heute genau einen globalen Status hat und
  ihr Empfänger Freitext (`empfaenger_funktion`) statt User ist — eine pro-Empfänger-Quittung
  würde dort nicht passen.

## 5. Berechtigungen & Isolation

Wiederverwendung von `src/einsatz/berechtigung.rs` (keine neuen Mechaniken):
- Lesen: `fordere_lesezugriff(...)`
- Senden / Quittieren / Vollzug setzen: `fordere_schreibrecht(rolle)` → **Beobachter abgelehnt**
- Aktivitäts-Gate wo nötig: `fordere_aktiv(einsatz)`

**Org-/Einsatz-Isolation (Akzeptanzkriterium + bekannte Lücke):**
- Beide geteilten Tabellen tragen `org_id` + `einsatz_id` und filtern in **jeder** Query danach.
- Polymorphe Schlüssel `(objekt_typ, objekt_id)` erlauben keine DB-FKs → der
  Cross-Einsatz-/Cross-Org-Check lebt **im Code** (Erweiterung des `gehoert_zu_einsatz`-Musters
  aus `chat/repo.rs` / `erinnerung/repo.rs`). Adressiert die in der Memory vermerkte
  Cross-Org-Lesezugriff-Lücke direkt.

## 6. Vokabulare (referenzieren, nicht neu erfinden)

- **Meldeweg** — Quelle `src/etb/` bzw. `src/etb_baustein/` (heute schon von chat/uhs/fahrzeug
  genutzt). `kommunikation/mod.rs` re-exportiert die bestehende Definition.
- **Eintragstyp** — Quelle `src/etb/mod.rs`. Re-Export.
- **Funkrufname** — Quelle `src/einheit/` / `src/fahrzeug/`. Re-Export.
- Kein eigenes Vokabular im Kommunikations-Modul; nur gebündelte Re-Exports als zentraler
  Bezugspunkt für künftige Module.

## 7. SSE / Live

- Kein neuer EventSource-Stream. Zustellung läuft über den bestehenden `LiveHub`
  (`publiziere_event(einsatz_id, tag, data)`) und den einen Stream pro Einsatz
  (`useEinsatzLiveStream`).
- Geteilter Publish-Helfer in `kommunikation/` kapselt das Tagging.
- Retrofit nutzt die **bestehenden** Tags `chat` / `erinnerung` weiter (Quittungs-/Vollzugs-
  Änderungen sind Updates am jeweiligen Objekt → bestehende Query-Invalidierung greift). Neue
  Tags nur, falls ein künftiges Modul sie braucht.

## 8. Frontend

- Geteilter API-Client `frontend/src/kommunikation/api.ts`: generische Aufrufe
  `quittiere(objektTyp, id)`, `setzeVollzug(objektTyp, id, status)`,
  `markiereGelesen(objektTyp, id)` über die bestehenden `apiGet`/`apiSend`-Wrapper.
- Live: keine neue EventSource; `useEinsatzLiveStream` invalidiert die bestehenden Query-Keys.
- `modulRegistry.ts`: **keine Änderung** (chat/erinnerungen bereits `fertig`; auftraege/meldungen
  bleiben `geplant`, out of scope).

## 9. Retrofit-Mapping

### 9.1 Erinnerung (Risiko-Locus)
Heute: Einzelspalte `erinnerung.status` ∈ {`offen`, `erledigt`, `quittiert`} (gegenseitig
ausschließend), plus `erledigt_at`, `zuletzt_ausgeloest_at`, Scheduler, Auto-Frist-Dedup.

Migration je Bestandszeile → eine `kommunikation_status`-Zeile (`org_id` aus `einsatz` gejoint):
| Alt-Status | quittiert_at | vollzug_status | vollzogen_at |
|---|---|---|---|
| `offen` | NULL | `offen` | NULL |
| `quittiert` | best-effort (`erstellt_at`/`erledigt_at` fallback) | `offen` | NULL |
| `erledigt` | NULL | `vollzogen` | `erledigt_at` |

- Semantische Erweiterung: neu sind quittiert **und** vollzogen gleichzeitig möglich
  (entspricht DV-100-Realität). Migration bildet nur den alten Einzelstatus ab.
- Repo `liste()`/Anzeige joint `kommunikation_status`; `ist_faellig`-Computed bleibt.
- Endpunkte `quittieren` / `erledigen` setzen künftig die jeweilige Achse statt der Einzelspalte.
- **Höchstes Risiko — explizit zu sichern:**
  1. **Scheduler** (`erinnerung/scheduler.rs`, 30s-Tick, `faellige_zum_ausloesen` /
     `markiere_ausgeloest`) muss grün bleiben. „Fällig & offen" = `vollzug_status='offen'`.
  2. **Auto-Frist-Dedup**: heutiger Partial-Unique-Index
     `UNIQUE(bezug_typ, bezug_id) WHERE quelle='auto_frist' AND status='offen'` referenziert die
     `erinnerung.status`-Spalte. Partial-Indizes können nicht über Tabellen joinen.
     **Resolution-Richtung:** eine minimale Scheduling-Statusspalte auf `erinnerung` behalten
     (Spiegel von „offen vs. vollzogen", nur für Index/Scheduler), während `kommunikation_status`
     die maßgebliche Quittung/Vollzug-Quelle ist. Exakte Mechanik im Plan; Invariante:
     Dedup-Garantie und Scheduler-Verhalten bleiben unverändert.

### 9.2 Chat (dünn)
- Übernimmt geteilten SSE-Publish-Helfer + Vokabular-Re-Exports (Chat referenziert bereits
  `meldeweg` beim Heraufstufen ins ETB).
- **Keine** Quittung, **kein** Vollzug.
- Optional (Stretch innerhalb Phase 3): Lesebestätigung über `kommunikation_zustellung`
  (`gelesen_at`). Capability wird verdrahtet; UI nur falls gewünscht. Kern-Retrofit ist die
  Code-Angleichung; Chat liefert heute schon live über `LiveHub`.

## 10. Phasen (eine Spec, drei unabhängig verifizier- und mergebare Phasen)

1. **Fundament** — `kommunikation/`-Modul, Migration 0045, Enums/Repo/Helfer, Vokabular-
   Re-Exports, Frontend-API-Client. Ohne Modul-Anbindung lauffähig + getestet (Isolation,
   Achsen-Übergänge, Berechtigung).
2. **Erinnerung-Retrofit** — Datenmigration, Achsen-Endpunkte, Scheduler-Greenlight,
   Auto-Frist-Dedup erhalten, Frontend-Buttons → Achsen. Höchstes Regressionsrisiko.
3. **Chat-Retrofit** — dünn: SSE-Helfer + Vokabular; optional Lesebestätigung.

## 11. Teststrategie

- **Fundament:** Unit-Tests Repo (Zustellung sparse anlegen/lesen, Quittung setzen, Vollzug-
  Übergänge offen→in_arbeit→vollzogen), **Isolation negativ** (fremde org_id/einsatz_id wird
  abgelehnt), Berechtigungs-Gates (Beobachter darf nicht quittieren/vollziehen).
- **Erinnerung:** Migrationstest (Alt-Status → Achsen-Mapping), Scheduler löst weiterhin aus,
  Auto-Frist-Dedup verhindert weiterhin Doppelte, `quittieren`/`erledigen` setzen korrekte Achse;
  Frontend `ErinnerungListe`/`ErinnerungFormular` bleiben grün.
- **Chat:** bestehende Chat-Tests bleiben grün; SSE-Helfer erzeugt identisches Event;
  (optional) Lesebestätigungs-Test.
- **Gates:** Frontend-Vitest mit `--no-file-parallelism` (Suite sonst flaky unter Last);
  Pass/Fail über `rtk proxy <cmd>` prüfen (rtk-Hook maskiert sonst Exit-Codes).

## 12. Akzeptanzkriterien-Abgleich

| Akzeptanzkriterium | Erfüllung |
|---|---|
| Live-Zustellung ohne zusätzliche EventSource | bestehender `LiveHub` + `useEinsatzLiveStream`, bestehende Tags (§7) |
| Quittierung & Vollzug als getrennte, wiederverwendbare Zustände | `kommunikation_status`, zwei Achsen (§4.2) |
| Beobachter kann lesen, nicht senden/quittieren | `fordere_schreibrecht` auf Schreib-/Quittungs-/Vollzugs-Endpunkten (§5) |
| Vokabulare nicht neu erfunden, modulübergreifend referenziert | Re-Exports aus etb/einheit (§6) |
| Org-Scope in allen Queries | `org_id` auf beiden Tabellen + Code-Check (§5) |

## 13. Risiken & offene Punkte

- **Erinnerung-Scheduler/Dedup-Index** (§9.1) — höchstes Risiko; Resolution-Richtung benannt,
  exakte Mechanik im Plan zu fixieren.
- **`org_id`-Backfill** der Migration für Bestandszeilen: per Join `einsatz.org_id` ableiten.
- **Best-effort-Zeitstempel** für `quittiert_at` migrierter `quittiert`-Erinnerungen (kein exakter
  historischer Zeitpunkt vorhanden) — als bewusste Näherung dokumentieren.
- Polymorphe Schlüssel ohne DB-FK → Integrität ausschließlich im Code (Test-pflichtig).

# lifeline-hub — Fortschritt & Roadmap

> **Für einen neuen Chat:** Diese Datei + die Spec genügen, um mit minimalem Kontext weiterzuarbeiten. Siehe „So startest du einen neuen Chat" am Ende.

## Was ist lifeline-hub

All-in-One-System für die Einsatzverwaltung weißer Hilfsorganisationen (Katastrophenschutz **und** täglicher Bereitschaftsdienst), vergleichbar mit Command X / Fireboard. Kern ist ein elektronisches Einsatztagebuch (ETB), erweitert um Fahrzeug-, Patienten- und Lageverwaltung. Echtes Einsatzprodukt, **self-hostbar** (lokal im ELW *oder* Cloud), Client verbindet sich zu konfigurierbarer Server-Adresse.

Vollständige Details: `docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md`.

## Tech-Stack (Kurz)

- **Backend:** Rust + Axum + SQLite (WAL, Foreign Keys), **Single-Binary mit statisch gebündeltem SQLite**, liefert Frontend mit aus.
- **Frontend (später):** React + **Ant Design v5** (PWA).
- **Live:** SSE (Server→Client) + POST (Client→Server).
- **Karte (später):** MapLibre GL. **Desktop/Mobile (später):** Tauri / Capacitor.

## Gesamt-Zerlegung (4 Teilprojekte)

```
FUNDAMENT (Server · Auth · Einsatz · Stammdaten · Live)
  └─▶ ① ETB-Kern              ← Teilprojekt 1 (aktuell)
       ├─▶ ② Fahrzeug-/Einsatzmittelverwaltung
       ├─▶ ③ Patienten-/Betroffenenverwaltung (sensible Daten)
       └─▶ ④ Lagekarte (visualisiert ①–③)
```

Jedes Teilprojekt bekommt einen eigenen Zyklus: Spec → Pläne → Umsetzung.

## Teilprojekt 1 — Plan-Sequenz (6 Pläne)

Jeder Plan ergibt für sich lauffähige, testbare Software und baut auf dem vorigen auf.

| # | Plan | Status |
|---|---|---|
| 1 | **Backend-Fundament** — Server-Skelett, Config (CLI/ENV), SQLite-Pool (WAL/FK), Migrationen, Router, `/api/health`, Graceful Shutdown (SIGINT/SIGTERM) | ✅ **DONE** — auf `main`, Commit `9440456` |
| 2 | **Auth & Benutzer/Org** — lokale Konten, Argon2-Hashing, Login/Sessions, Admin-Bootstrap, Benutzerverwaltung; `error`-Modul (`AppError` + `IntoResponse`) | ⬜ als Nächstes |
| 3 | **Einsatz & Rollen** — Einsatz-CRUD, Lebenszyklus (aktiv → abgeschlossen, read-only), Mitgliedschaften, Rollen (Admin/Einsatzleitung/Führungspersonal/Beobachter), Autorisierung | ⬜ |
| 4 | **ETB-Kern + Live + Suche** — append-only Einträge, server-autoritative `lfd_nr`, Berichtigungen, Drei-Zeitstempel-Modell (`ereigniszeit`/`received_at`/`erfasst_lokal_at`), SSE-Live, FTS5-Suche/Filter | ⬜ |
| 5 | **Frontend (React + Ant Design PWA)** — Login, Einsatzauswahl, ETB-Ansicht, Schnellerfassung, SSE-Client, Offline-Queue (IndexedDB) | ⬜ |
| 6 | **Backup/Restore + Packaging** — Hot-Backup (USB) + Restore, Frontend-Embedding, Single-Binary-Build | ⬜ |

**Bewusst später (nicht Teil von T1):** PDF-/Druck-Export (priorisiert für T1.1/T2), OIDC/SSO, MFA, Schnellbausteine, Server-Discovery (QR/mDNS).

## Arbeitsweise / Konventionen

- **Ablauf je Plan:** writing-plans (Bite-Sized-TDD) → subagent-driven-development: pro Task ein Implementer-Subagent, danach Spec-Compliance-Review + Code-Quality-Review (mit Fix-Schleifen), am Ende ein finaler Gesamt-Review.
- **Pläne phasenweise schreiben** — jeweils erst vor der Umsetzung, damit Erkenntnisse einfließen.
- **Umsetzung in isoliertem Worktree** (nicht direkt auf `main`).
- **Commits** enden mit `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Fachsprache:** BOS-/Führungs-Begriffe verwenden (Einsatzleitung, Führungspersonal, Einsatztagebuch, Lage), keine generischen Dev-Namen wie „Schreiber".

## Dateien

- Spec (T1): `docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md`
- Plan 1 (DONE): `docs/superpowers/plans/2026-05-23-backend-fundament.md`
- Diese Roadmap: `docs/superpowers/PROGRESS.md`

## So startest du einen neuen Chat

Minimaler Einstieg, z.B.:

> „Lies `docs/superpowers/PROGRESS.md` und die T1-Spec. Schreibe als Nächstes **Plan 2 (Auth & Benutzer/Org)** im writing-plans-Bite-Sized-TDD-Format und setze ihn anschließend subagent-getrieben um."

Der aktuelle Code-Stand liegt auf `main` (`cargo test` = 7/7 grün). Nach jedem fertigen Plan diese Tabelle hier aktualisieren.

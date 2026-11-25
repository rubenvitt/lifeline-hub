# Veranstaltungen-Abruf (LLH-2097) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lifeline ruft Veranstaltungen über den neutralen Vertrag „Veranstaltungen-Abruf v1“ ab und hält
sie je Adapter in `veranstaltung_extern`; die IUK-Suite bietet den Vertrag mit Abruf-Zugängen an.

**Spec:** `docs/superpowers/specs/2026-11-25-w36lkuqp-veranstaltungen-abruf-design.md` (freigegeben
25.11.2026, alle offenen Punkte wie empfohlen).
**Zunder:** LLH-2097 (`w36lkuqpgnc88lde5wiw0whb`).

## Global Constraints

- Im Lifeline-Code kein Name der Suite (G4); Modul `src/veranstaltung_extern/`, Art `veranstaltungen_abruf`.
- Abruf ohne Datenbank, Übernahme ohne Netz in der Transaktion des Laufs (`adapter::art`).
- Fehler als `AdapterFehler`-Code, nie Text des Ziels. Schlüssel nie im Log, `Debug` oder Audit.
- Wire: Fachbegriffe deutsch, Technik englisch; Zeitpunkte UTC `zeit::FORMAT`.
- Bezeichner, Prosa, Kommentare, Testnamen nach den `AGENTS.md` auf dem Pfad.

## Teil 1 — IUK-Suite (Repo `iuk-suite`, eigener PR)

- [ ] Tabelle `abruf_zugang` (Migration mit Audit-Triggern, `zuletzt_abgeholt_am` ausgenommen), Katalog und Manifest.
- [ ] `_lib/schluessel.ts`: anlegen, prüfen (vermerkt Abholung), widerrufen, Liste; Tests.
- [ ] `_lib/abruf.ts`: Vertrag v1 (Fenster: Ende ≥ jetzt − 7 Tage, abgesagte mit, höchstens 500, UTC); Tests.
- [ ] Route `api/abruf/route.ts` (Host, Schlüssel, 401/404, `no-store`); `ABRUF_OHNE_LOGIN` als Liste mit Tests.
- [ ] Actions + Flyin „Abruf-Zugänge“ (nur Modul-Admins); Test.
- [ ] Runbook, Release Note; typecheck, lint, vitest, build, e2e (Veranstaltungen).

## Teil 2 — Lifeline (Repo `lifeline-hub`, PR gegen `alpha`)

- [x] Migration `veranstaltung_extern` (`0376`, PK `(adapter_id, extern_id)`, FK auf `adapter` mit Cascade, Index `ende_at`).
- [x] `vertrag.rs`: Parser v1 mit Grenzen; Tests (gültig, fehlendes Feld, zu lang, Fassung 2, Ende ≤ Beginn, unbekannte Art → `sonstiges`).
- [x] `repo.rs`: Übernahme (neu / unverändert = 0 / geändert / verschwunden → `entfernt`) und Aufräumen (14 Tage nach Ende); Tests.
- [x] `art.rs`: Art `veranstaltungen_abruf` (Feld `basis_url`, Platz `schluessel`, 60 s / 300 s, Deckel 512 KiB), registriert in `Verzeichnis::produktiv`; Test gegen lokalen Testserver inkl. 401 → `Abgelehnt`.
- [x] Aufräumen in den bestehenden Aufbewahrungslauf hängen; `src/AGENTS.md` Aufbewahrung.
- [x] Doku: `docs/schnittstellen/veranstaltungen-abruf.md`, Anwenderkapitel Anbindungen, Architektur Kap. 5/8.
- [x] Gates nach `scripts/AGENTS.md`.

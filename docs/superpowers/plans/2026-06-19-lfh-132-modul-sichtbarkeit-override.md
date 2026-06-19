# LFH-132 — Modul-Sichtbarkeit & Berechtigungen pro Einsatz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — task-by-task TDD. Steps use `- [ ]`.

**Goal:** Modul-Sichtbarkeit (aktiv/ausgeblendet) und `benoetigteRolle` pro Einsatz überschreibbar machen, **server-/routenseitig per Handler-Guard** durchgesetzt (LFH-129-Entscheidung), mit Frontend-Nav-Reflexion und Settings-UI.

**Architecture:** Child-Tabelle `einsatz_modul_override(einsatz_id, modul_key → sichtbar, benoetigte_rolle)` (Leaf, Validierung in Rust). Backend bekommt eine minimale **Modul-Registry** (Source of Truth für gültige Modul-Keys + nicht-ausblendbare Module) — gespiegelt zur Frontend-`modulRegistry.ts` (heute hat KEIN Modul ein `benoetigteRolle`-Default → Default = frei/sichtbar). Enforcement: **Per-Handler-Guard** `fordere_modul_zugriff(...)` in den Routen jedes Moduls (gewählt über Central-Middleware wegen Pfad→Key-Fragilität). Rollen-Vokabular = System-/Org-Rolle (`admin`/`fuehrungskraft`), wie der Registry-Default (LFH-129: Override desselben Feldes).

**Tech Stack:** Rust (axum + sqlx-sqlite), React/TS (antd, React Query).

## Global Constraints

- Keine DB-CHECK; Validierung in Rust. Leaf-Tabelle.
- **Nicht ausblendbar:** `einsatzdaten` + `einsatz-einstellungen` (Selbst-Aussperren verhindern) — Setz-Route lehnt das ab; Guard ignoriert ein `sichtbar=false` darauf defensiv.
- **Admin-Mindest-Guard:** System-Admin behält immer Zugriff (Guard lässt Admin durch, unabhängig vom Override).
- **Org-Isolation:** Override-Queries strikt per `einsatz_id`; keine Cross-Org-Lecks (vgl. Memory cross-org-lesezugriff-luecke).
- Fehler-Codes: Validation=400, Conflict=409, Forbidden=403 (Hauskonvention).
- rust-embed: Frontend-Änderung = pnpm build + Backend-Neustart.
- Commit-Referenz: `LFH-132`.

## File Structure

**Backend:**
- Create `migrations/0065_einsatz_modul_override.sql`.
- Create `src/einsatz/modul.rs` — `MODUL_KEYS` (Spiegel der FE-Keys), `NICHT_AUSBLENDBAR`, `ist_gueltiger_modul_key`, `ist_ausblendbar`.
- Create `src/einsatz/modul_override.rs` (oder in repo.rs) — `EinsatzModulOverride`, `laden_alle(einsatz_id) -> HashMap<String, Override>`, `setzen`, `anzeige`.
- Modify `src/einsatz/berechtigung.rs` — `fordere_modul_zugriff(overrides: &HashMap<..>, modul_key, benutzer, rolle) -> Result<(), AppError>` (rein, testbar). Logik: Admin → ok; sonst override.sichtbar==false && ausblendbar → 403; benoetigte_rolle (override sonst Registry-Default=None) → prüfen (admin|fuehrungskraft).
- Modify `src/routes/einsatz.rs` — `modul_overrides_laden` (GET) + `modul_override_setzen` (PUT je modul_key); Guard einsatzleitung|admin; non-hideable + Selbst-Aussperr-Schutz.
- Modify `src/app.rs` — Routen registrieren.
- Modify ~25 Modul-Routen-Dateien (`src/routes/etb.rs`, `chat.rs`, `erinnerung.rs`, `auftrag.rs`, `meldung.rs`, `nachforderung.rs`, `einsatz_fahrzeug.rs`, `einsatz_personal.rs`, `einsatz_material.rs`, `einsatz_person.rs`, `einsatz_tier.rs`, `einsatz_schaden.rs`, `einsatz_uhs.rs`, `einsatz_bereitstellungsraum.rs`, `einsatz_einheit.rs`, `einsatzabschnitt.rs`, `lagebericht.rs`, `gefahr.rs`, `lage_zone.rs`, `anhang.rs`, `kraefteuebersicht`/dashboard-Quellen …) — je Handler `fordere_modul_zugriff` mit dem Modul-Key des Handlers. **80+ Call-Sites** → batchweise pro Modul, Commit je Modul-Gruppe.
- Modify `tests/einsatz.rs` (+ ggf. modul-spezifische Test-Dateien) — Guard-Unit-Tests, Override-Setzen, Hide-Enforcement 403, Rollen-Enforcement 403, non-hideable abgelehnt, Selbst-Aussperr abgelehnt, Org-Isolation.

**Frontend:**
- Modify `frontend/src/api/types.ts` — `ModulOverride`, `ModulOverrides = Record<string, ModulOverride>`.
- Modify `frontend/src/api/einsaetze.ts` — `ladeModulOverrides`, `setzeModulOverride`.
- Modify `frontend/src/einsatz/modulRegistry.ts` — `istModulGesperrt(modul, benutzer, overrides?)` um Override-Kontext erweitern (sichtbar + benoetigteRolle); `istModulSichtbar(modul, overrides)`.
- Modify `frontend/src/einsatz/EinsatzLayout.tsx` — Overrides laden (useQuery, gleicher Hot-Path wie Einstellungen) + an IconRail/ModulPanel reichen; ausgeblendete Module nicht rendern (außer nicht-ausblendbare).
- Modify `frontend/src/einsatz/ModulPanel.tsx` + `IconRail.tsx` — Override-Kontext berücksichtigen.
- Modify `frontend/src/pages/EinsatzEinstellungenPage.tsx` — Sektion „Modul-Sichtbarkeit & Berechtigungen": je Modul Sichtbarkeit-Toggle + Rollen-Select (non-hideable disabled).
- Tests: `modulRegistry.test.ts` (istModulGesperrt mit Override), EinsatzLayout/ModulPanel (ausgeblendete Module), Page-Section.

## Tasks (TDD, Commit je Task)

1. **Migration 0065 + Backend-Modul-Registry** (`modul.rs`: Keys, non-hideable, Validatoren) + Unit-Tests.
2. **Override-Domain + Repo** (`EinsatzModulOverride`, `laden_alle`, `setzen`, `anzeige`) + Tests (UPSERT, laden_alle map).
3. **Guard `fordere_modul_zugriff`** (rein, gegen geladene Overrides) + Unit-Tests: Admin-Durchlass, Hide→403, Rolle→403, non-hideable nie versteckt, kein Override→frei.
4. **GET/PUT Override-Routen** + app.rs + Integrationstests: setzen, non-hideable abgelehnt (409/400), Selbst-Aussperr-Schutz, Org-Isolation, Guard einsatzleitung|admin.
5. **Guard in Modul-Handler einstreuen** — batchweise (eine Modul-Gruppe pro Commit): pro Handler `overrides = modul_override::laden_alle(...)` (oder einmal laden + reichen) + `fordere_modul_zugriff(&overrides, MODUL_KEY, &benutzer, rolle)`. Integrationstest je Gruppe: verstecktes/ rollen-gesperrtes Modul → 403 auf dessen Routen. **Reihenfolge:** zuerst ein Modul exemplarisch komplett (z. B. `etb`) inkl. Test, Muster festzurren, dann die übrigen mechanisch.
6. **Frontend-API + Typen** (`ladeModulOverrides`, `setzeModulOverride`).
7. **`istModulGesperrt`/`istModulSichtbar` + Override-Kontext** + Tests.
8. **EinsatzLayout/IconRail/ModulPanel** Overrides laden + Nav reflektieren (ausgeblendet nicht rendern, non-hideable immer) + Tests (MemoryRouter, vgl. Memory dndkit-onclick-koexistenz).
9. **Settings-UI-Sektion** Modul-Sichtbarkeit/Rolle in `EinsatzEinstellungenPage` + Submit-Test (Feldabdeckung).

## Risiken / Hinweise

- **80+ Guard-Call-Sites** sind der Hauptaufwand — mechanisch, aber fehleranfällig: erst ein Modul als Muster + Test, dann strikt gleich replizieren; Integrationstest je Modul-Gruppe verhindert „vergessene" Route.
- **Stream-Routen** (`/etb/stream`, `/personen/stream`, …) ebenfalls gaten (sonst SSE-Bypass eines versteckten Moduls).
- **Source-of-Truth-Drift:** Backend-`MODUL_KEYS` muss mit FE-`modulRegistry` synchron bleiben — ein Test, der die Key-Liste gegen eine erwartete Menge prüft, fängt Drift.
- **Hot-Path:** EinsatzLayout lädt Overrides einmal (gecacht, geteilter queryKey) — wie Einstellungen.
- Org-Isolation defensiv (Memory cross-org-lesezugriff-luecke): Overrides nur über `einsatz_id`, nie über Benutzer-Org ableiten.

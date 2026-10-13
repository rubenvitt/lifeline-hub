# Proposal

## Why

Ein ELW 1 ohne Stab funkt, plant Sprechgruppen und pflegt einen Kommunikationsplan. Heute hängen
Funkplan, Fernmeldeskizze, Sprechgruppen-Darstellung und Kommunikationsplan fail-closed an der
Freigabe des Moduls Stab. Wer den Stab ausblendet, weil er keine Stabsarbeit abbildet, verliert
damit seine S6-Werkzeuge. LLH-1116 hat am 12.10.2026 entschieden, S6 als eigenes Modul
„Fernmeldewesen“ herauszulösen (`openspec/changes/archive/2026-10-12-wgnb0am2-stab-abwaehlbar/design.md`,
D3, D4, D6, D7, Folgeticket F2).

## What Changes

- **Neues Einsatzmodul „Fernmeldewesen“** (Modul-Key `fernmeldewesen`, Kategorie Kommunikation,
  Beschreibung „Funkplan, Skizze, Kommunikationsplan“, weil die Registry höchstens 40 Zeichen
  zulässt) mit eigener Freigabe. Es ist voll nutzbar, auch wenn der Stab ausgeblendet oder gesperrt ist.
- **Eine Modulseite mit vier Reitern:** h1 „Fernmeldewesen“, darunter Funkplan,
  Fernmeldeskizze, Sprechgruppen und Kommunikationsplan. Die Inhalte der Reiter bleiben, wie sie
  sind.
- **Neue Adressen in der Oberfläche:** `/einsaetze/:id/fernmeldewesen` (Funkplan samt
  `?ansicht=skizze|sprechgruppen`) und `/einsaetze/:id/fernmeldewesen/kommunikationsplan`. Die
  alten Routen `…/stab/funkplan` (auch mit `?ansicht=`) und `…/stab/kommunikationsplan` leiten
  dauerhaft um.
- **API-Pfade bleiben** `…/stab/kommunikationsplan…` und `…/stab/fernmeldeskizze…`, gehören aber
  dem neuen Modul: Lesen und Schreiben prüfen die Freigabe `fernmeldewesen` statt `stab`. Ist das
  Fernmeldewesen gesperrt oder ausgeblendet, antwortet der Server nach der Statuscode-Konvention,
  auch wenn der Stab frei ist.
- **Neues Live-Ereignis `fernmeldewesen`** für Kommunikationsplan und Skizze mit dem Gate des
  neuen Moduls. `stab` trägt nur noch Besetzung und Checkliste (sowie Presse und
  Informationstelefon).
- **Freigaben übernehmen nur die Rolle:** Eine Migration kopiert die Rollen-Vorgabe von Stab je
  Einsatz und je Organisation auf `fernmeldewesen`, die Ausblendung nicht. Niemand sieht mehr als
  heute; wer den Stab ausgeblendet hat, bekommt das Fernmeldewesen sichtbar (Versionshinweis).
- **Stab-Daten im Fernmeldewesen haben eine eigene Weiche:** Die Besetzung als Nebentext im
  Kommunikationsplan und die Sachgebiete im Kasten „Einsatzleitung“ der Skizze erscheinen nur
  mit Stab-Freigabe, sonst „—“ mit Grund.
- **Abnehmer folgen dem neuen Modul:** „Fernmeldeskizze anfügen“ an Dokumenten,
  Funkplan-Lücken und Kommunikationsplan in der Lagebericht-Übernahme „Führungsprobleme“, die
  Rechte der Skizze und die Offline-Lesbarkeit des Kommunikationsplans prüfen `fernmeldewesen`.
- **Stab-Seite:** Die S6-Einstiege springen in das Modul Fernmeldewesen und sind gesperrt, wenn
  dessen Freigabe fehlt. Presse, Informationstelefon, Besetzung und Checkliste bleiben am Stab.
- **Sprungmarken und Palette:** Die Marken Fernmeldeskizze und Kommunikationsplan stehen hinter
  „Fernmeldewesen“ statt hinter „Stab“; die Marke Funkplan entfällt, weil das Modul den Funkplan
  selbst öffnet. „Funk“ findet in der Palette das Modul.
- **Regeln:** `frontend/src/stab/AGENTS.md` (Geltungsbereich „Stab und Fernmeldewesen“),
  `frontend/AGENTS.md` („Keine Arbeitsplatzachse“), `frontend/src/offline/AGENTS.md` und die
  Regelkarte der Wurzel-`AGENTS.md` ziehen nach.
- **Anwenderdoku:** `funkplan.md` („Wer was darf“), `stab.md`, `ohne-netz.md`,
  `einsatz-oberflaeche.md` und die Bilder mit dem neuen Ortspfad.

## Capabilities

### New Capabilities

- `fernmeldewesen`: das Modul Fernmeldewesen als Hülle. Es umfasst die eigene Freigabe samt
  Übernahme der Stab-Rolle, die Modulseite mit ihren Reitern und Adressen samt Weiterleitung der
  alten Routen, die Zuordnung der bestehenden API-Pfade, die Live-Verteilung, die Weiche für
  Stab-Daten und die Einstiege von der Stab-Seite.

### Modified Capabilities

- `stab-funkplan`: „Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile“ wird ersetzt durch
  die Adresse im Modul Fernmeldewesen; die Freigabe ist die des Fernmeldewesens.
- `stab-kommunikationsplan`: dieselbe Adress-Anforderung; dazu die Besetzung als Nebentext mit
  eigener Stab-Weiche und die Offline-Lesbarkeit unter dem neuen Modul.
- `stab-fernmeldeskizze`: Die Skizze erbt die Freigabe des Fernmeldewesens; der Kasten
  „Einsatzleitung“ zeigt Sachgebiete nur mit Stab-Freigabe.
- `stab-fernmeldeskizze-bearbeitung`: Das Recht zum Bearbeiten des Skizzeneigenen hängt am
  Fernmeldewesen.
- `modul-freigabe`: Das Szenario „Unterroute eines gesperrten Moduls“ nennt den Funkplan nicht
  mehr als Stab-Unterroute.
- `modul-benennung`: Ein Modul mit Reitern nennt das Modul im h1, den Reiter darunter.
- `modul-sprungmarken`: Die S6-Marken ziehen von „Stab“ zu „Fernmeldewesen“, die Marke Funkplan
  entfällt.
- `sprungpalette`: „Funk“ findet das Modul; die Marken des Fernmeldewesens hängen an dessen
  Freigabe.
- `lagebild-offline-lesen`: Der Kommunikationsplan bleibt offline lesbar, als Teil des
  Fernmeldewesens.

## Impact

- **Backend:**
  - `src/einsatz/modul.rs` (`MODUL_KEYS`, Marker `Fernmeldewesen`, zwei Unterpräfixe in `PFAD_KEY`)
  - `src/routes/stab.rs` (Kommunikationsplan- und Skizzen-Handler auf den neuen Marker und das
    neue Live-Ereignis), `src/live/mod.rs` (`LiveEvent::Fernmeldewesen`)
  - Migration (Rollen-Übernahme), Typ-Codegen
  - Tests: Gate-Tests der Kommunikationsplan- und Skizzen-Endpunkte, `tests/einsatz_live.rs`,
    `tests/modul_override.rs`, `tests/modul_freigaben.rs`, `tests/einsatz_kontext_guard.rs`,
    `tests/enum_wire_kontrakt.rs`, Migrationstest
- **Frontend:**
  - `einsatz/modulRegistry.ts`, `App.tsx` (neue Modulroute, Weiterleitungen),
    `routing/deeplinks.ts`, `api/queryKeys.ts`, `live/`
  - Neue Modulhülle mit Reitern; `pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx`
    ohne eigene Stab-Prüfung
  - `stab/useNetzQuellen.ts`, `stab/SkizzenAufnahme.tsx`, Skizzen-Rechte, `stab/unterseiten.ts`,
    `entwurf/DokumentAnlagen.tsx`, `lageberichte/fuehrungsproblemeUebernahme.ts`
  - Vitest und e2e
- **Regeln und Doku:** `AGENTS.md`, `frontend/AGENTS.md`, `frontend/src/stab/AGENTS.md`,
  `frontend/src/offline/AGENTS.md`, `docs/anwender/` (Kapitel und Bilder)
- **Bezüge:**
  - LLH-1116 (Entscheidung, Change `wgnb0am2-stab-abwaehlbar`).
  - LLH-1111 (Lagebesprechung als Modul) ist gemergt und dient als Muster.
  - LLH-1179 (Org-Sichtbarkeit) ist unabhängig.
  - LLH-1127 (Palette) und LLH-1124 (Stab-Seite) bauen auf dieser Change auf.
  - LLH-722 (Feldbefund Stab): S6 zählt nicht mehr als Stabsnutzung.

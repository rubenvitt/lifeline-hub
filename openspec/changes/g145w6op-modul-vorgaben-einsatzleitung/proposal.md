# Proposal

## Why

Eine Einsatzleitung ohne Org-Rolle bekommt auf `GET /api/org-modul-einstellungen` HTTP 403. Im
Editor „Module“ ihres Einsatzes fehlen ihr deshalb der Rollen-Hinweis „Vorgabe der Organisation:
…“ (seit LFH-944) und, sobald der Einsatz einen eigenen Sichtbarkeitswert trägt, der Hinweis
„Vorgabe der Organisation: ausgeblendet“. Gerade sie verwaltet die Module des Einsatzes, sieht
aber nicht, wovon sie abweicht. Die Lücke ist in LLH-1179 als Risiko benannt
(`openspec/changes/archive/2026-10-13-ivtkmf43-org-modul-sichtbarkeit/design.md`, „Risks /
Trade-offs“) und hier als Folgeticket LLH-1183 aufgenommen.

## What Changes

- **Neuer einsatzbezogener Lesepfad** `GET /api/einsaetze/{id}/modul-vorgaben`: liefert die
  Modul-Vorgaben (Rolle, Sichtbarkeit) der Organisation des Einsatzes, in derselben Form wie
  `GET /api/org-modul-einstellungen`. Lesen darf, wer die Modul-Overrides desselben Einsatzes
  lesen darf. Ein gekoppeltes Gerät erreicht den Pfad nicht.
- **Kein Org-weites Leserecht:** `GET /api/org-modul-einstellungen` und `GET /api/org-einstellungen`
  bleiben bei System-Admin und Führungskraft der Organisation.
- **Editor „Module“:** liest die Vorgaben aus dem neuen Pfad statt aus dem Org-Endpunkt. Damit
  sieht jeder, der den Editor öffnet, Rollen- und Sichtbarkeits-Herkunft wie ein System-Admin.
  Der Rückfall „aus den Freigaben hergeleitet“ bleibt nur noch für einen gescheiterten Abruf.
- **Frische:** Ändert ein System-Admin in der Verwaltung eine Modul-Vorgabe, lädt der Client die
  Vorgaben aller Einsätze nach.
- Unverändert: `GET …/modul-overrides` behält seine Form; Schreibwege, Gates und Auflösung der
  Freigaben bleiben, wie sie sind.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `modul-freigabe`: Neu ist der einsatzbezogene Lesepfad der Org-Vorgaben. Der Editor „Module“
  zeigt die Herkunft jedem, der ihn öffnen darf; die Einschränkung „ohne Leserecht auf die
  Org-Vorgaben nur, solange der Einsatz keinen eigenen Wert trägt“ entfällt.

## Impact

- **Backend:** `src/routes/einsatz.rs` (neuer Handler), `src/app.rs` (Route),
  `src/einsatz/modul.rs` (`PFAD_KEY`, modul-los); Tests in `tests/modul_override.rs` und
  `tests/geraet_kopplung.rs`.
- **Frontend:** `api/einsaetze.ts`, `api/queryKeys.ts` (neuer Einsatz-Key, Liste „nicht live“),
  `pages/einstellungen/EinsatzModule.tsx`, `pages/einstellungen/EinsatzDefaults.tsx`
  (Invalidierung), Tests daneben.
- **Typen:** keine neue Response-Form (`OrgModulEinstellung` existiert); OpenAPI-Pfad neu,
  Codegen-Prüfung läuft mit.
- **Doku:** `docs/anwender/kapitel/einsatz-einstellungen.md` beschreibt die Hinweise schon ohne
  Einschränkung; prüfen, nichts Neues zu erwarten.

# Proposal

## Why

Eine Notunterkunft braucht die registrierten Haushalte auch auf Papier: bei Strom- oder
Netzausfall, bei der Übergabe an die nächste Schicht und an der Essensausgabe nach Kostform.
Die Registrierstelle (LLH-1612) hat den Druck ausdrücklich ausgeklammert; die Registrierliste
steht bisher nur am Bildschirm (Zunder LLH-1616).

## What Changes

- Neue Druckansicht „Registrierliste“ je Betreuungsstelle: Summen je Kostform, darunter je
  Haushalt (H-n, Bezugsperson) die hier registrierten Personen mit Registriernummer, Name,
  Geburtsdatum oder geschätztem Alter, Kostform und einer leeren Spalte zum Abhaken; Personen
  ohne Haushalt als eigener Block.
- Unverträglichkeiten stehen nur auf dem Blatt, wenn sie bewusst gewählt werden
  (Gesundheitsangabe); der Druckkopf sagt dann „mit Gesundheitsangaben“.
- Neuer protokollierter Abruf `GET …/betreuung/stellen/{sid}/registrierungen/druck`: gleiche
  Rechte wie die Liste, schreibt je gedruckter Person einen Eintrag der neuen Art
  `registrierliste` ins Zugriffsprotokoll, bevor Daten den Server verlassen. Unverträglichkeiten liefert er nur auf
  ausdrückliche Anforderung.
- Einstieg „Registrierliste drucken“ im Kopf des Paneels „Registrierung“ — an der Detailseite
  der Stelle (auch ohne Schreibrecht) und am Gerät „Betreuungsstelle“.
- Das Gerät „Betreuungsstelle“ darf die Liste **seiner** Stelle drucken. Das ist eine bewusste
  Ausnahme zum Grundsatz „Personendruck nie am Gerät“ (Personendruckansicht, LLH-1120), die
  für die übrigen Druckansichten bestehen bleibt.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `betreuung-registrierung`: neue Anforderungen „Registrierliste drucken“, „Druck der
  Registrierliste wird je Person protokolliert“, „Auf dem Blatt steht nur, wer protokolliert
  ist“, „Gesundheitsangaben nur auf Wunsch“ und
  „Registrierliste drucken am Gerät“.

## Impact

- **Backend:** `src/routes/betreuung_registrierung.rs` (neuer Handler), `src/betreuung/registrierung.rs`
  (Liste ohne Unverträglichkeiten, Protokoll in der Transaktion), `src/app.rs` (Route),
  `src/geraet/mod.rs` (Routenliste der Betreuungsstelle), Tests `tests/betreuung_registrierung.rs`,
  `tests/geraet_kopplung.rs`. Migration 0311 nimmt die Art `registrierliste` in den CHECK von
  `person_zugriff_audit`; `ZugriffArt` und die generierten Typen ziehen mit.
- **Frontend:** neue Druckseite und Blatt unter `betreuung/registrierung/`, Pfade
  (`routing/deeplinks.ts`, `routing/EinsatzPfade.tsx`), Routen in `App.tsx` (Stab und Gerät),
  Query-Key, API-Funktion, Knopf im `RegistrierungPaneel`, `geraetDarf`.
- **Druck-Gate:** neue Spec `e2e/registrierliste-druck.spec.ts` in `DRUCK_SPECS`.
- **Regeln und Doku:** `frontend/src/druck/AGENTS.md`, `frontend/src/betreuung/AGENTS.md`,
  `frontend/src/geraet/AGENTS.md`; Anwenderkapitel `betreuung.md` und
  `geraet-betreuungsstelle.md`.

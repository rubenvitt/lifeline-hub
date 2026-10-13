# Proposal

## Why

Die Lagebesprechung gehört zum Führungsvorgang (FwDV 100, 3.3.3.2) und findet auch ohne Stab
statt, etwa bei Führungsstufe B/C mit Führungstrupp oder -gruppe. Heute ist sie auf drei Orte
verteilt: Der Termin steht in den Einsatzdaten, Abschluss, Verlauf und Vorbereitung auf der
Stab-Seite. Alles außer dem nackten Terminfeld hängt an der Freigabe des Moduls Stab. Wer Stab
ausblendet, weil er keine Stabsarbeit abbildet, verliert damit Vorbereitung, Abschluss und
Verlauf. Ruben (10.10.2026): „‚Nächste Lagebesprechung‘ gehört nicht in die Einsatzdaten, dafür
braucht es eine eigene Verwaltung.“

## What Changes

- **Neues Einsatzmodul „Lagebesprechung“** (Modul-Key `lagebesprechung`, Kategorie Führung,
  zwischen Aufträge und Stab, Route `/einsaetze/:einsatzId/lagebesprechung`) mit eigener
  Freigabe. Es ist voll nutzbar, auch wenn Stab ausgeblendet oder gesperrt ist.
- **Eine Seite für den Rhythmus:**
  - Kopf mit dem nächsten Termin als taktische Zeit, Zustand („in 25 min“, „jetzt fällig“,
    „seit 5 min überfällig“) und der Primäraktion „Lagebesprechung abschließen“.
  - Termin-Schnellwahl +30 min / +1 h / +2 h / kein Termin und freie Wahl, ohne Abschluss.
  - Paneel „Vorbereitung“ (aus LFH-550, inhaltlich unverändert).
  - Paneel „Verlauf“ mit allen Besprechungen, neueste zuerst.
- **Eigener Schreibweg für den Termin** am Modul, mit dessen Freigabe und Rechten. Er schreibt
  keinen ETB-Eintrag und stößt das Kopf-Ereignis `einsatz` nur an, wenn sich der Termin ändert.
  **BREAKING (intern):** Der Kopf-PATCH der Einsatzdaten nimmt den Termin nicht mehr an. Lesbar
  bleibt der Termin im Einsatzkopf (Überblick-Fristenliste, ETB-Wiedervorlage).
- **Abschluss wie heute** (ETB-Eintrag „Entscheidung“, laufende Nummer und Termin atomar), jetzt
  am Modul Lagebesprechung. Neu ist eine Längengrenze für den Entschluss, wie für jeden Text, der
  ins ETB geht.
- **BREAKING (intern):** Die Endpunkte ziehen von `…/stab/lagebesprechungen` nach
  `…/lagebesprechung` und `…/lagebesprechungen`. Die Stab-Anzeige trägt keine
  Lagebesprechungsfelder mehr. Einziger Abnehmer ist das eigene Frontend; es zieht im selben PR
  mit.
- **Neues Live-Ereignis `lagebesprechung`** mit dem Gate des neuen Moduls. Das Ereignis `stab`
  trägt nur noch die Besetzung.
- **Freigaben übernehmen nur die Rolle:** Eine Migration kopiert die Rollen-Vorgabe von Stab je
  Einsatz und je Organisation auf `lagebesprechung`, die Sichtbarkeit nicht. Niemand sieht mehr
  als heute, und wer Stab ausgeblendet hat, bekommt die Lagebesprechung sichtbar.
- **Einsatzdaten** zeigen keinen Termin mehr.
- **Stab-Seite:** trägt Paneele und Kopfaktion nicht mehr selbst, sondern zeigt eine kompakte
  Zeile mit Termin und Zustand, die auf die Lagebesprechung springt.
- **Überblick und Palette:** Die Überblick-Marke „Lagebesprechung“ und die Schnellaktion
  „Lagebesprechung abschließen“ führen in das neue Modul und prüfen dessen Freigabe.
  Lagebericht-Übernahme und Einsatzbericht lesen die Lagebesprechung über das neue Modul.
- **Regeln:** Neue Bereichsdatei `frontend/src/lagebesprechung/AGENTS.md`. Die Abschnitte
  „Vorbereitung der Lagebesprechung“ und „Überfälliger Besprechungstermin“ ziehen aus
  `frontend/src/stab/AGENTS.md` dorthin, und die Regelkarte der Wurzel-`AGENTS.md` wird
  nachgezogen.
- **Anwenderdoku:** Neues Kapitel `lagebesprechung.md` mit Bildern; `stab.md`,
  `einsatzdaten.md` und `ueberblick.md` werden nachgezogen.
- Kein Modulzähler, keine Offline-Lesbarkeit (wie heute), keine Teilnehmerliste und kein
  Folgeauftrag aus dem Entschluss (eigenes Ticket).

## Capabilities

### New Capabilities

- `lagebesprechung`: das Modul Lagebesprechung. Es umfasst eigene Freigabe und Rechte, die
  Übernahme der Stab-Rollen, den Termin der nächsten Besprechung samt Schnellwahl und
  Schreibweg, den Abschluss mit ETB-Nachweis, den Verlauf, die Live-Verteilung und die Einstiege
  von Stab, Überblick und Palette.

### Modified Capabilities

- `lagebesprechung-vorbereitung`: Die Vorbereitung zieht von der Stab-Seite auf die Seite
  Lagebesprechung. Sie prüft deren Freigabe, und der überfällige Termin wird dort gezeigt.
- `einsatzkopf-live`: Der Termin wird über den neuen Schreibweg gesetzt, nicht mehr per Kopf-PATCH.
  Das Begleitereignis heißt `lagebesprechung` statt `stab`. Neu abgerufen wird die
  Lagebesprechungs-Anzeige statt der Stab-Anzeige.
- `einsatzdaten-bearbeitung`: „Nächste Lagebesprechung“ entfällt als Angabe, im Zonenversatz und
  in der Gliederung.
- `stab-checkliste`: Die Stabseite trägt die Lagebesprechung nicht mehr. Die Klausel
  „Lagebesprechung unverändert“ entfällt.
- `ueberschriften-gliederung`: Das Szenario „Stab und Presse“ nennt den Verlauf auf der Seite
  Lagebesprechung statt der Stab-Seite.

## Impact

- **Backend:**
  - `src/einsatz/modul.rs` (`MODUL_KEYS`, Marker, `PFAD_KEY`)
  - Lagebesprechungsteile aus `src/stab/` und `src/routes/stab.rs` werden in ein neues
    `src/lagebesprechung/` und `src/routes/lagebesprechung.rs` herausgelöst
  - `src/routes/einsatz.rs` (`KopfdatenPatch`), `src/live/mod.rs` (neues `LiveEvent`), `src/app.rs`, `src/api_doc.rs`
  - Migration 0184 (Rollen-Übernahme)
  - Tests: `tests/stab.rs`, `tests/einsatz.rs`, `tests/einsatz_live.rs`, `tests/modul_override.rs`,
    `tests/modul_freigaben.rs`, `tests/enum_wire_kontrakt.rs`, `tests/aufbewahrung_e2e.rs`
  - Typ-Codegen
- **Frontend:**
  - `einsatz/modulRegistry.ts`, `App.tsx`, `routing/deeplinks.ts`, `api/queryKeys.ts`, `live/`
  - Neue `pages/LagebesprechungPage.tsx` und neues Verzeichnis `lagebesprechung/` (Bausteine
    aus `stab/` verschoben)
  - `pages/StabPage.tsx`, `pages/EinsatzdatenPage.tsx`, `pages/fuehrung/UeberblickPage.tsx`,
    `command-palette/befehle.ts`
  - `lageberichte/lageentwicklungUebernahme.ts`, `druck/einsatzbericht/`
  - Vitest und e2e (u. a. `stab-vorbereitung`, `einsatzkopf-live`, `etb-chronologie`, `gate3-trefflaeche`)
- **Regeln und Doku:**
  - `AGENTS.md`, `frontend/AGENTS.md`, `frontend/src/stab/AGENTS.md`, neue
    `frontend/src/lagebesprechung/AGENTS.md`
  - `docs/anwender/` (Kapitel, Bilder, README)
- **Bezüge:**
  - LLH-1116 (Stab abwählbar, Change `wgnb0am2-stab-abwaehlbar`) hat diesen Schnitt entschieden
    (D5, Rollen-Übernahme D7).
  - LLH-1180 (Fernmeldewesen) und LLH-1179 (Org-Sichtbarkeit) laufen parallel.
  - LLH-1124 (Stab-Seite neu) und LLH-1127 (Stab-Sprungmarken) bauen auf dieser Change auf.
  - LLH-722, früher LFH-852 (Feldbefund Stab): siehe design.md, D12.

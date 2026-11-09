# Proposal

## Why

Lifeline Hub ist (noch) nicht für die Stabsarbeit gedacht. Das hat Ruben am 08.11.2026 bei der
Auswertung von LLH-722 bewusst ohne Feldbefund entschieden. Grundlage ist das Rückbaukriterium
aus LFH-46, Entscheidung 17: Es gibt keinen Feldbeleg dafür, dass Besetzung S1–S6, Checkliste
Arbeitsaufnahme oder Presse- und Medienarbeit (S5) im Fükw auf Führungsstufe B/C gebraucht
werden. Seit LLH-1111 (Lagebesprechung) und LLH-1180 (Fernmeldewesen) sind die genutzten Teile
eigene Module. Am Stab hängen nur noch Fläche, Daten und Pflege für etwas, das nicht genutzt
wird. Deshalb wird der Stab aus dem Code entfernt, nicht nur ausgeblendet. Ein späterer
Wiedereinstieg läuft über Git und eine neue Change.

## What Changes

- **BREAKING** Das Einsatzmodul **Stab** entfällt: Stab-Übersicht (Kacheln S1–S6),
  Besetzung S1–S6 mit System-ETB, Checkliste Arbeitsaufnahme, Modul-Key `stab` samt Freigaben,
  Ausblendungen und Vorlagen-Einträgen, Live-Ereignis `stab`, Routen `…/stab`,
  `…/stab/besetzung/…`, `…/stab/checkliste…`.
- **BREAKING** **Presse und Medienarbeit (S5)** entfällt: Presse-Log (Medienkontakte),
  Pressemitteilung (Dokumentart des Vorlagendokuments mit Freigabe und Druck), Live-Ereignis
  `presse`, Knopf „Aus S5 übernehmen“ im Lagevortrag.
- **BREAKING** Die Tabellen `einsatz_stabsfunktion`, `einsatz_stab_checkliste`, `medienkontakt`,
  `pressemitteilung` und die Spalte `etb_eintrag.pressemitteilung_id` werden per neuer Migration
  gelöscht, auch in abgeschlossenen Einsätzen in der Aufbewahrungsfrist. Schwärzungs-Registry,
  Personenbezüge und Löschersuchen werden mitgezogen. Bestehende ETB-Einträge, auch freigegebene
  Pressemitteilungen und Besetzungswechsel, bleiben als Text unverändert.
- **Neues Modul „Informationstelefon“** mit eigenem Modul-Key `infotelefon`, Kategorie
  Kommunikation. Es übernimmt Rolle und Ausblendung des Stabs je Einsatz, je Organisation und in
  Einsatz-Vorlagen. Die UI-Route `/einsaetze/:id/infotelefon` ersetzt `…/stab/infotelefon`
  (Weiterleitung bleibt), die API-Pfade bleiben gleich.
- **Auflösung der Führungsfunktionen S1–S6 auf Personen** liest künftig die Führungsfunktion der
  Mitgliedschaft (`einsatz_mitgliedschaft.fuehrungsfunktion`, gepflegt unter „Mitglieder“) statt
  der Stab-Besetzung. Das betrifft Empfänger von Aufträgen und Erinnerungen, Chat-Erwähnungen,
  Benachrichtigungen, `meine_sachgebiete`/`meine_funktion`, Organigramm (Stabsstelle),
  Fernmeldeskizze (Sachgebietszeichen), Kommunikationsplan (Spalte „Besetzung“), „Eigene Lage“
  und Einsatzbericht.
- Der Abschnitt **Medienlage** im Lagevortrag bleibt als Freitext.
- **Umzug ohne Verhaltensänderung:** Code des Fernmeldewesens von `stab/` nach `fernmeldewesen/`
  (Frontend und Backend), der Lebenszyklus-Riegel `fordere_aktiv_in_tx` in den Einsatz-Kern,
  allgemeine Helfer (`md`, `ZUSTAND_GRUND`, `Quelle`, Zeilenziel-Stil) an neutrale Orte. Die
  API-Pfade `…/stab/kommunikationsplan` und `…/stab/fernmeldeskizze` bleiben.
- Hilfe-Bereich „Stab“ heißt „Führungsorganisation“. Anwenderdoku, Website und Architekturdoku
  werden nachgezogen, dazu eine neue ADR.

## Capabilities

### New Capabilities

Keine. Das Informationstelefon behält seine Spec `stab-infotelefon`. Ihr Name ist ein
gespeicherter Bezeichner, ein Umbenennen würde Verweise ohne Not brechen.

### Modified Capabilities

- `stab-uebersicht`: entfällt vollständig (alle Requirements REMOVED).
- `stab-checkliste`: entfällt vollständig.
- `stab-presse-log`: entfällt vollständig.
- `stab-pressemitteilung`: entfällt vollständig.
- `stab-medienlage`: entfällt vollständig; die Medienlage bleibt Freitext (`lagevortrag-uebernahme`).
- `stab-infotelefon`: eigenes Modul `infotelefon` statt Unterseite des Stabs; Gate, Live-Recht,
  Route, Einstiege.
- `fuehrungsfunktionen`: Auflösung über die Mitgliedschaft statt der Stab-Besetzung, ohne Stab-Recht.
- `benachrichtigungen`: Empfänger je Führungsfunktion aus der Mitgliedschaft.
- `einsatzkopf-live`: `meine_sachgebiete` und `meine_funktion` aus der Mitgliedschaft.
- `fuehrungsorganisation`: Stabsstelle im Organigramm aus der Mitgliedschaft, ohne Stab-Freigabe.
- `fernmeldewesen`, `stab-kommunikationsplan`, `stab-fernmeldeskizze`: Sachgebiete und
  Besetzungsangabe aus der Mitgliedschaft; keine Abhängigkeit vom Modul `stab`.
- `modul-freigabe`, `einsatz-vorlagen`: Modul-Key `stab` entfällt, `infotelefon` kommt hinzu.
- `modul-sprungmarken`, `sprungpalette`: keine Stab-Marken; Informationstelefon als Modul.
- `lagebesprechung`, `lagebesprechung-vorbereitung`: keine Stab-Zeile, Ankündigung an
  Funktionen über die Mitgliedschaft.
- `lagevortrag-uebernahme`: keine Übernahme aus S5 in der Medienlage.
- `einsatzbericht`: Block „Führung“ ohne Stab-Besetzung, Führungsfunktionen aus der Mitgliedschaft.
- `aufbewahrung-loeschersuchen`: keine Personenart Medienkontakt für neue Ersuchen; alte bleiben lesbar.
- `kraefte-entlassung`: Entlassung löst keine Stab-Besetzung mehr.
- `live-abgleich`: Ereignisse `stab` und `presse` entfallen.
- `dokument-entwurf`, `dokument-verteiler`: Pressemitteilung ist keine Dokumentart mehr.
- `stab-versorgung`, `kraefte-verpflegung`: keine S4-Zeile auf einer Stab-Seite.

Alle übrigen Specs, die den Stab nur beispielhaft nennen, werden in Aufgabe 9 (`tasks.md`)
geprüft und bei normativer Wirkung per Delta nachgezogen.

## Impact

- **Backend:** `src/stab/`, `src/presse/`, `src/routes/{stab,presse,infotelefon}.rs`,
  `src/fuehrung/aufloesung.rs`, `src/benachrichtigung/aufloesung.rs`, `src/einsatz/{modul,funktion,
  mod,repo,fuehrungsstelle}.rs`, `src/live/mod.rs`, `src/vorlagendokument/`,
  `src/einsatz/schwaerzung_*`, `src/aufbewahrung/`, `src/personal/disposition_repo.rs`,
  `src/lagebericht/mod.rs`, `src/api_doc.rs`, neue Migration (> 0298), Typ-Codegen.
- **Frontend:** `frontend/src/stab/` (aufgelöst), `frontend/src/presse/` (entfällt),
  `pages/{Stab,Presse,PressemitteilungDetail,Infotelefon}Page.tsx`, `einsatz/modulRegistry.ts`,
  `App.tsx`, `routing/deeplinks.ts`, `einsatz/sprungmarken.ts`, `command-palette/`,
  `api/queryKeys.ts`, `live/zeilenAbgleich.ts`, `fuehrung/`, `chat/`, `lageberichte/`,
  `druck/einsatzbericht/`, `pages/einsatzabschnitte/`, `hilfe/bereiche.ts`.
- **Tests und Gates:** Integrationstests unter `tests/` (Stab, Presse löschen; Setup über
  Besetzung auf Mitgliedschaft), e2e-Specs und Doku-Bilder, Guards (`modul_override`,
  `enum_wire_kontrakt`, Schwärzungs-Registry, `schnellaktionen.guard`, `anwenderdoku.guard`,
  `websiteModule.guard`).
- **Doku:** `docs/anwender/` (Kapitel `stab.md` entfällt, `presse-infotelefon.md` wird
  `infotelefon.md`), `docs/architektur/` (Bausteinsicht, Glossar, neue ADR), `AGENTS.md`-Dateien
  (`frontend/src/stab/AGENTS.md` wird zu `frontend/src/fernmeldewesen/AGENTS.md`), `website/`.
- **Daten:** Alle Stab- und Presse-Daten gehen verloren (Entscheidung 08.11.2026).

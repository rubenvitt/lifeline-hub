# Proposal

## Why

Ruben (10.10.2026): „Die Seite sieht schrecklich aus und muss komplett überarbeitet werden. Die
Funktionen … tauchen in keiner Übersicht auf.“ Die Stab-Seite soll drei Fragen beantworten: Wer
führt welches Sachgebiet? Was ist dort offen? Wie komme ich mit einem Klick in die Arbeit? Heute
ist sie eine lange Liste. Ihre Zeilen bestehen überwiegend aus Aufgabentext und Fundstelle, die
Werkzeuge sind kleine Links ohne Zustand. Höchstens drei Werkzeuge passen in eine Zeile. Deshalb
fehlen Werkzeuge, die zum Sachgebiet gehören:
- S1 ohne Nachforderungen, obwohl S1 Kräfte anfordert.
- S6 mit Einsatzabschnitten und Chat statt der Fernmelde-Werkzeuge.
- Die Fernmeldeskizze ist kein eigener Einstieg, obwohl die Spec `fernmeldewesen` ihn verlangt.

Die Voraussetzungen liegen jetzt vor. LLH-1116 hat entschieden, was am Stab bleibt, LLH-1111 hat
die Lagebesprechung herausgelöst, LLH-1180 das Fernmeldewesen.

## What Changes

- **Raster aus sechs Kacheln S1–S6** statt der Liste „Besetzung S1–S6“: eine Spalte am Handy,
  zwei ab `md`, drei ab `xl`.
  - Jede Kachel ist ein Paneel mit Kennung und wirksamem Mandantenlabel („S4 · Versorgung“).
  - Sie zeigt die Besetzung als Statuschip mit Wort und trägt die Aktion „Besetzung ändern“. Ohne
    Schreibrecht entfällt die Aktion, der Grund steht im Seitenhinweis wie heute.
  - Darunter eine gekürzte Aufgabenzeile mit sichtbarer Fundstelle (FwDV 100 Anl. 2).
  - Darunter die Werkzeuge als gleich große Bedienziele.
- **Zustandszahl je Werkzeug, nur aus einer bestehenden Quelle** (Entscheidung von Ruben am
  13.10.2026):
  - Ein Modul-Werkzeug zeigt dieselbe Zahl und Bedeutung wie sein Badge im Modulmenü
    (Modulzähler).
  - „Pressearbeit“ zeigt die offenen Presseanfragen (Kennzahlen des Presse-Logs).
  - „Funkplan“ zeigt die Zahl der Funkplan-Lücken.
  - Wer keine Quelle hat, zeigt keine Zahl. Das betrifft heute Nachforderungen, Lagemeldungen,
    Verpflegung und Material. Es wird keine neue Zählung eingeführt.
  - Fehlt eine Quelle, steht „—“ mit Grund, nie 0.
- **Werkzeug-Zuordnung überarbeitet**, ohne Grenze von drei Werkzeugen:
  - S1 bekommt zusätzlich Nachforderungen (S4 behält sie).
  - S6 führt Funkplan, Fernmeldeskizze, Sprechgruppen und Kommunikationsplan im Modul
    Fernmeldewesen statt Einsatzabschnitten und Chat.
- **Einheitliche Sperrlogik der Werkzeuge:** Ist das Ziel ausgeblendet, fehlt das Werkzeug. Ist es
  gesperrt, steht das Werkzeug gesperrt mit Grund da, ohne Zahl. Heute verschwindet ein gesperrtes
  Modul-Werkzeug still, während die Unterseiten gesperrt mit Grund stehen.
- **Eine Lückenzahl des Funkplans:** Eine Funktion in `stab/luecken.ts` zählt die Lücken des
  Lücken-Paneels. Die Funkplan-Seite zeigt sie als Meta im Paneel „Lücken“, die S6-Kachel liest
  dieselbe Zahl.
- **Besetzungsstand als Meta im Seitenkopf** („4/6 besetzt“) statt im Paneelkopf.
- **Arbeitsaufnahme klappt ein:** Ist beim Öffnen alles erledigt, steht das Paneel eingeklappt mit
  „7/7 erledigt“ und lässt sich aufklappen. Es bleibt unter dem Raster.
- **Regeln:** Die Drei-Werkzeuge-Regel entfällt (Kopf von `stab/sachgebiete.ts`, Spec
  `kraefte-verpflegung`). `frontend/src/stab/AGENTS.md` bekommt den Abschnitt „Stab-Seite“
  (Kachel, Zahl je Werkzeug, Sperre).
- **Anwenderdoku:** `stab.md` mit neuen Bildern, `funkplan.md` (Lückenzahl).
- Kein neues Datenmodell, keine Migration, kein Typ-Codegen, kein Backend.

## Capabilities

### New Capabilities

- `stab-uebersicht`: die Stab-Seite als Übersicht der Stabsfunktionen. Sie umfasst das Kachelraster,
  die Besetzung je Kachel, die Werkzeuge je Sachgebiet mit Sperrlogik, die Zustandszahl je Werkzeug
  aus bestehenden Quellen und den Besetzungsstand im Kopf.

### Modified Capabilities

- `kraefte-verpflegung`: Das Requirement „Stab-Werkzeug S4“ verliert die Grenze von drei
  Werkzeugen. Fahrzeuge bleiben trotzdem außen vor, weil S4 nur Verpflegung, Nachforderungen und
  Material trägt.
- `stab-checkliste`: „Fläche auf der Stabseite“ wird ergänzt. Das Paneel steht unter dem Raster
  und klappt ein, wenn alles erledigt ist. „Die Besetzung MUST unverändert bleiben“ entfällt.
- `fernmeldewesen`: „Einstiege von der Stab-Seite …“ nennt alle vier Einstiege (Funkplan,
  Fernmeldeskizze, Sprechgruppen, Kommunikationsplan) samt Lückenzahl am Funkplan.
- `stab-funkplan`: neues Requirement. Die Zahl der Lücken steht im Kopf des Lücken-Paneels und
  ist dieselbe, die die Stab-Seite zeigt.
- `stab-medienlage`: „Einstieg aus der S5-Zeile“ wird zur S5-Kachel. Die Pressearbeit zeigt die
  offenen Presseanfragen.
- `ueberschriften-gliederung`: Das Szenario „Stab und Presse“ beschreibt die Kacheln als Paneele
  mit `h2` statt als Listeneinträge mit `h3`.

## Impact

- **Frontend:**
  - `pages/StabPage.tsx` (Neuaufbau)
  - neue Bausteine in `stab/`: Kachel, Werkzeugzelle, Zahl je Werkzeug
  - `stab/sachgebiete.ts`, `stab/werkzeuge.ts`, `stab/unterseiten.ts`, `stab/luecken.ts`,
    `stab/ChecklistePaneel.tsx`, `pages/FunkplanPage.tsx` (Meta im Lücken-Paneel)
  - Vitest: `StabPage.test.tsx`, `sachgebiete.test.ts`, `werkzeuge.test.ts`,
    `ChecklistePaneel.test.tsx`, `luecken.test.ts`
  - e2e: `gate3-trefflaeche` (Stab), `stab-schmal`, `stab-kontrast`, `stab-checkliste`,
    `gate1-ueberlauf`, Bildlauf `doku-bilder/stab.bilder.ts`
  - Palette: `schnellaktionen.guard.test.ts` liest `SACHGEBIETE` und `unterseitenFuer`
- **Regeln und Doku:** `frontend/src/stab/AGENTS.md`, `docs/anwender/kapitel/stab.md` (Bilder),
  `docs/anwender/kapitel/funkplan.md`.
- **Bezüge:**
  - Baut auf LLH-1180 (PR #726, Modul Fernmeldewesen) auf und wird erst nach dessen Merge
    gemergt.
  - LLH-1078 (Nachforderungen als Board mit Zähler) bringt später die Zahl für S1/S4. Die Kachel
    nimmt sie ohne Umbau auf, sobald sie im Modulzähler steht.
  - LLH-722 (Feldbefund Stab): reine Gestaltung, kein Ausbau. Wird dort vermerkt.
  - Design System „Lifeline Hub“: Die Werkzeugzelle ist ein neuer Baustein. Der PR vermerkt, dass
    das Design System nachgezogen werden muss.

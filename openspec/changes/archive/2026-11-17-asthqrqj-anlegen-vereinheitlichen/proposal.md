# Proposal

## Why

LLH-1722 hat das Muster „Anlegen“ festgelegt (`2026-11-16-tfq6f4kb-loesende-aktionen`, design.md
D8): Regel ist der Erfassungsdialog, eine eigene Seite nur bei einem Ablauf oder mehr als ~5
Pflichtfeldern, ein eingeklapptes Formular nur bei Serienerfassung neben einer Liste, kein Drawer.
Drei Stellen weichen davon ab und stehen als Altstellen in `frontend/AGENTS.md`; solange sie
bleiben, öffnet „anlegen“ je Modul eine andere Form, und eine Spec-Anforderung beschriebe Verhalten,
das der Code nicht hat (Zunder LLH-1921).

## What Changes

- **Unfallhilfsstelle und Bereitstellungsraum** legen im Erfassungsdialog an statt in der
  Seitenleiste rechts, an allen Einstiegen (Liste, Leerzustand, Switcher, Sprungpalette über
  `?neu=1`). Der gemeinsame Anlege-Drawer fällt.
- **UHS-Dialog mit drei sichtbaren Feldern:** Bezeichnung, Typ, Standort; die optionale Notiz
  steht unter „Weitere Angaben“, deren Kopf eine eingetragene Notiz nennt.
- **UHS-Liste springt nach dem Anlegen in die neue UHS**, wie Bereitstellungsraum und Switcher
  schon.
- **Lagemeldungen** erfassen im Erfassungsdialog statt im eingeklappten Paneel über der Zeitachse
  (Seitenkopf, Leerzustand, `?neu=1`). Formular, Vorbelegung und Verhalten nach dem Erfassen
  bleiben.
- **Nachforderung, Meldungen und Erinnerungen bleiben eingeklappt:** alle drei erfassen in Serie
  („Speichern und nächste“) neben ihrer Liste; das ist der Ausnahmefall der Regel.
- **Regel:** neue Anforderung „Anlegen“ in `bedien-muster`; die Altstellenliste in
  `frontend/AGENTS.md` verliert die Anlegen-Einträge (die Bearbeiten-Altstelle bleibt für
  LLH-1920).
- **Anwenderdoku:** Kapitel Unfallhilfsstellen, Bereitstellungsräume und Lagemeldungen sprechen
  vom Dialog; ihre Bilder zum Anlegen werden neu erzeugt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `bedien-muster`: neue Anforderung „Einen Datensatz anlegen“ (Form des Anlegens nach Umfang,
  Ausnahme Serienerfassung, kein Drawer).

## Impact

- Frontend: `components/AnlegenDrawer.tsx` (fällt, Ersatz `components/AnlegenModal.tsx`),
  `pages/uhs/UhsAnlegenDrawer.tsx`, `pages/bereitstellungsraum/BrAnlegenDrawer.tsx` (umbenannt
  auf `…Modal`), ihre Aufrufer (`UnfallhilfsstellenPage`, `UnfallhilfsstellenDefault`,
  `UhsSwitcher`, `BereitstellungsraeumePage`, `BereitstellungsraeumeDefault`, `BrSwitcher`),
  `pages/LagemeldungenPage.tsx`, `meldungen/MeldungFormular.tsx`; Tests daneben.
- Regeln: `frontend/AGENTS.md` (Altstellen), `frontend/src/etb/AGENTS.md` (Lagemeldungen öffnen
  ein Paneel), Spec `bedien-muster`.
- Doku: `docs/anwender/kapitel/{unfallhilfsstellen,bereitstellungsraeume,lagemeldungen}.md`,
  Bilder-Specs unter `frontend/e2e/doku-bilder/`, e2e `frontend/e2e/lagemeldungen.spec.ts`.
- Kein Backend, keine API, keine Migration.

# Proposal

## Why

Im Meldebild sieht man zu jeder Einheit Auftrag und Rückmeldung, kann aber nicht danach filtern:
Der Filter kennt nur Abschnitt, Trägerorganisation, Status und Suche. Bei vielen Einheiten muss die
Führungskraft die Spalten Zeile für Zeile durchgehen, um die freien Einheiten ohne Auftrag oder die
Einheiten zu finden, von denen nichts mehr kommt (LLH-1792). Die Einheitenliste hilft dabei nicht,
sie zeigt weder Status noch Auftrag.

## What Changes

- Das Filter-Menü des Meldebilds („Filter (n)“) bekommt neben Trägerorganisation und Status zwei
  Schalter für Einheiten: **„ohne Auftrag“** (die Einheit hat keinen offenen oder laufenden
  Auftrag) und **„Rückmeldung fehlt oder überfällig“** (die letzte Rückmeldung ist überfällig,
  oder es kam nie eine).
- Ein gesetzter Schalter steht wie die übrigen Filter als Marke in der Werkzeugzeile, zählt in
  „Filter (n)“ und fällt mit „Filter zurücksetzen“ weg.
- Mit einem dieser Schalter zeigt das Meldebild nur die zutreffenden Einheiten samt ihren Mitteln.
  Trifft nur eine Untereinheit zu, bleibt ihre Obereinheit als Rahmen stehen, ohne eigene Mittel.
- Tabelle, Auswahlzeile, Statusband (Einheiten, Personal), Lagebericht und Druck folgen der
  Auswahl; der Zulauf entfällt wie bei jedem gesetzten Filter.
- Kann die Seite Aufträge bzw. Rückmeldungen nicht lesen (keine Freigabe, Laden, Fehler), ist der
  jeweilige Schalter deaktiviert und nennt den Grund. Ein schon gesetzter Schalter filtert dann
  nicht und sagt das an seiner Marke, statt die Tabelle zu leeren.
- Die Einheitenliste (Modul Einheiten) bleibt unverändert.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `kraeftebaum`: neue Anforderung „Filter nach Auftrag und Rückmeldung“ im Meldebild.

## Impact

- Frontend: `frontend/src/kraefte/kraeftebild.ts` (`FilterWerte`, `filtereKraefte`),
  `frontend/src/kraefte/meldebildRaster.ts` (Treffer je Einheit),
  `frontend/src/pages/KraefteuebersichtPage.tsx` (Filter-Menü, Marken, Zählung, Statusband).
- Tests: `kraeftebild.test.ts`, `meldebildRaster`-Tests, `KraefteuebersichtPage.test.tsx`.
- Anwenderdoku: `docs/anwender/kapitel/meldebild.md`, Abschnitt zum Filtern.
- Kein Backend, keine Schnittstelle, keine Migration: Aufträge und Rückmeldungen ruft die Seite
  heute schon ab.

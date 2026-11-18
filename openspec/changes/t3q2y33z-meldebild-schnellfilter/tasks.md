# Tasks

Jede Aufgabe entsteht per TDD (erst der rote Test, dann der Code). Zunder:
https://zunder.rubeen.dev/#/aufgabe/t3q2y33zhnvqykd2of5j4oh8

## 1. Treffer je Einheit (rein)

- [x] 1.1 `einheitenTreffer` in `kraefte/meldebildRaster.ts` (D1, D4): `null` ohne wirksamen
  Schalter; „ohne Auftrag“ über `offeneAuftraegeJeEinheit`; „Rückmeldung fehlt oder überfällig“
  über `rueckmeldungZustand` (überfällig und keine); beide gesetzt = Schnitt; nicht lesbare Quelle
  macht ihren Schalter unwirksam. Nachweis: neue Fälle in `meldebildRaster.test.ts` grün
  (je Schalter, beide, Frist kippt mit `jetzt`, Quelle nicht lesbar).

## 2. Filter in `filtereKraefte`

- [x] 2.1 `FilterWerte` um `ohneAuftrag` und `rueckmeldungFehlt` erweitern, `filtereKraefte` nimmt
  die Treffermenge: Treffer mit Mitteln, Obereinheiten als Rahmen ohne eigene Mittel, „Ohne
  Einheit“ fällt weg (D3). Nachweis: Fälle in `kraeftebild.test.ts` grün (Treffer, Rahmen-
  Obereinheit, Mittel ohne Einheit, ohne Treffermenge unverändert).
- [x] 2.2 `rendereMeldebildMarkdown` mit gesetztem Einheiten-Filter: Lagebericht-Text nennt nur
  die Auswahl. Nachweis: Test in `kraeftebild.test.ts` grün.

## 3. Meldebild-Seite

- [ ] 3.1 `LEERER_FILTER`, `aktiveFilterChips` (Marken „ohne Auftrag“, „Rückmeldung fehlt oder
  überfällig“, Zusatz „wirkt gerade nicht“ nach D4), `filterZahl`. Nachweis: Unit-Tests der
  exportierten Funktionen in `KraefteuebersichtPage.test.tsx` grün.
- [ ] 3.2 Zwei Checkboxen im Popover mit deaktiviertem Zustand samt Grund (D6); `gefiltertRoh` mit
  Treffermenge und `jetzt` nur bei wirksamem Rückmeldungs-Filter (D5); Statusband zählt nur Treffer,
  Vermerk entfällt (D7); Auswahlzeile zählt Treffer. Nachweis: Seitentests grün für Szenarien
  „Einheiten ohne Auftrag“, „Untereinheit trifft“, „Aufträge nicht lesbar“, „Rückmeldungen fallen
  aus“.
- [ ] 3.3 Anwenderdoku `docs/anwender/kapitel/meldebild.md`, Abschnitt Filtern: beide Schalter,
  Rahmen-Obereinheit, deaktivierter Zustand. Nachweis: Wächter der Anwenderdoku im Gate grün.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Bilder der Änderung aufgenommen
  (Filter-Menü, gefiltertes Meldebild, deaktivierter Schalter).

## Workflow follow-up

- `/opsx:archive t3q2y33z-meldebild-schnellfilter` im selben Branch vor dem PR.

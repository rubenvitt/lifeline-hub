# Tasks

## 1. „Zuletzt verwendet“ (Speicher)

- [ ] 1.1 `pages/lagekarte/zuletztVerwendet.ts` samt Test aus C9 übernehmen (Deckel 6, jüngstes vorn, Dubletten wandern, lat/lon/label/ansicht_id fallen weg, kaputter/fehlender Speicher → leer, Abonnement); verifizieren: `zuletztVerwendet.test.ts` grün
- [ ] 1.2 `useKartenInteraktion.ts`: im `onSuccess` von `legeZeichenMutation` `merkeZuletztVerwendet(zeichenPlatzieren)` rufen; verifizieren: Test in `useKartenInteraktion.test.tsx`, dass ein erfolgreiches Anlegen merkt und ein gescheitertes nicht

## 2. Zeichen-Picker als Bildraster

- [ ] 2.1 `FreiesZeichenPicker.tsx` auf Raster umbauen (Grundzeichen- und Symbolraster mit Suche, „Kein Symbol“, Radiogruppe mit rollendem Tabstopp und Pfeiltasten, Details eingeklappt mit `forceRender`, `kachelStil` auf Dichte-Staffel, Rollenfarben über `useRollen`, Radius aus Token) und die C9-Tests angepasst übernehmen; verifizieren: `FreiesZeichenPicker.test.tsx` grün, inkl. `kachelStil` über zwei Dichtestufen und Feldbudget-Paar (zu: zwei Suchfelder offen; auf: Details-Felder zählen mit)
- [ ] 2.2 Leiste „Zuletzt verwendet“ im Picker (Name als `aria-label` + Tooltip, Übernahme ohne Bezeichnung, Erneuerung per Abonnement); verifizieren: Tests „keine Leiste ohne Einträge“, „Übernahme lässt Bezeichnung stehen“, „erneuert sich nach Merken“
- [ ] 2.3 Enter-Vertrag nach D4 (`onAbsenden` auf Kachel, Suchfeld mit Erst-Treffer-Wahl, Bezeichnung mit frischem Wortlaut; Blur platziert nicht; ohne `onAbsenden` kein Absenden); verifizieren: Picker-Tests je Weg, darunter „platziert per Enter“
- [ ] 2.4 `Sidebar.tsx` Zeichnen-Paneel: `onAbsenden` wie der Platzieren-Knopf verdrahten; verifizieren: `Sidebar.test.tsx` — Enter im geöffneten Picker ruft `onZeichenPlatzierenStart` mit der Spec und schließt den Picker

## 3. Inspector entprellt mit Eigen-Merker

- [ ] 3.1 `FreiesZeichenInspector.tsx` nach D6 (600 ms Frist, Serverstand-Vergleich, Eigen-Merker, Übernahme fremder Änderung ohne eigene, Nachholen beim Schließen, `autoFokus={false}`); verifizieren: `FreiesZeichenInspector.test.tsx` mit „Öffnen schreibt nichts“, „schnelle Wechsel = ein PATCH“, „Schließen in der Frist holt nach“, „Schließen ohne Änderung schreibt nichts“ und dem Paar „fremde Änderung ohne eigene wird übernommen, nichts geschrieben“ / „mit eigener Änderung wird genau einmal gesendet“

## 4. Objektsuche

- [ ] 4.1 `pages/lagekarte/objektsuche.ts`: `suchbareMarker` (D1), `gruppiereTreffer` und `TYP_REIHENFOLGE` über alle elf `MarkerTyp`, Beschriftung aus `OBJEKTART`; verifizieren: `objektsuche.test.ts` mit dem Paar mit/ohne Betreuungsrecht, dem Paar Personen frei+Ebene an / gesperrt / Ebene aus, Gruppierung, Gleichstand-Reihenfolge und Deckungsgleichheit `TYP_REIHENFOLGE` ↔ `OBJEKTART`
- [ ] 4.2 `MarkerSuche.tsx` aus C9 übernehmen (Suchfeld mit eigenem Namen, Gruppen als `Liste`, `bedienzielStil`, genau ein Leerzustand, Fehlerfall ohne falsche Leere, „—“ statt Zahl); verifizieren: `MarkerSuche.test.tsx` grün, inkl. Render-Paar „ohne Betreuungsrecht erscheint der Name nicht“ über `suchbareMarker`
- [ ] 4.3 `Sidebar.tsx`: Paneel „Verortet“ trägt `MarkerSuche` statt der UHS-/Schaden-Listen; neue Prop für die Suchquelle; `LagekartePage.tsx` reicht `suchbareMarker(...)` aus `alleVerortet`, `personenVerortet`, Zugriffen und `layer.person` durch; verifizieren: `Sidebar.test.tsx` und `LagekartePage`-Tests grün, bisherige „Verortet“-Tests auf die Suche umgestellt, Klick ruft `onMarkerWaehlen`

## 5. Doku und Abschluss

- [ ] 5.1 CLAUDE.md: kurzer Absatz „Objektsuche und Zeichenwahl der Lagekarte (LFH-716)“ mit Suchquelle/Modulsperre (D1), Enter-Vertrag (D4) und Inspector-Riegel (D6); verifizieren: Absatz verweist auf `design.md` dieses Change
- [ ] 5.2 Prüfliste Einsatztauglichkeit (15 Kriterien) als `pruefliste.md` im Change-Verzeichnis, jede Zeile mit Verdikt; verifizieren: keine Zeile „nicht geprüft“
- [ ] 5.3 Integration: `pnpm lint`, `tsc` (über `check-typ-codegen.sh`), volle Vitest-Suite, `prettier --check`; im Browser gegen den Dev-Stack Suche und Picker (inkl. Handschuh-Stufe in der 300-px-Leiste) einmal durchklicken; verifizieren: alle Gates grün, Beobachtung in der Prüfliste vermerkt

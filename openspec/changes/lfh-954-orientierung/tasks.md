## 1. Grundlagen

- [ ] 1.1 `useDokumentTitel` (setzt, verbindet, stellt beim Abbau zurück) mit Vitest
- [ ] 1.2 `einsatz/letzterOrt.ts` (Frist, je Benutzer, fremder Inhalt) über `sichererSpeicher`, mit Vitest
- [ ] 1.3 `einsatzKennung` nach `einsatz/einsatzKennung.ts` ziehen

## 2. Tab-Titel

- [ ] 2.1 `EinsatzRahmen` setzt den Titel aus Registry und Einsatz, merkt den letzten Ort
- [ ] 2.2 `ebene1Seite(pathname)` (rein) und Titel in `AppLayout`, Titel auf der Anmeldung

## 3. Ortspfad und Einsatzstatus

- [ ] 3.1 `EinsatzRahmenKontext`; `EinsatzSeite` zeigt `EinsatzstatusMarke` bei nicht aktivem Einsatz
- [ ] 3.2 `Ortspfad` exportieren, `title` je Eintrag; CSS: „Einsätze“ und Trenner schrumpfen nicht
- [ ] 3.3 Einsatzdaten h1 „Einsatzdaten“ und Pfad; ETB, Meldebild, Einstellungen, Lagekarte mit Pfad
- [ ] 3.4 Status-Etikett aus den zwölf Seitentiteln, ETB-Hinweis entfällt, Lagekarte mit Marke
- [ ] 3.5 Tier-Reiter „Offen“

## 4. Wechsler und Rückweg

- [ ] 4.1 `EinsatzSwitcher`: markiert, eigener Klick ohne Sprung, Nebenzeile, ohne „Stammdaten“
- [ ] 4.2 `Ebene1Ort`-Kontext in `AppLayout`, Ortspfad und Rückweg in `AdminPage`
- [ ] 4.3 `GlobalLink` mit Aktivzustand und `aria-current`

## 5. Nachweis und Abschluss

- [ ] 5.1 e2e `orientierung.spec.ts` (Titel über alle Module, kein Status im h1, 390 ungekürzt, Rückweg als Beobachter) und Mutationsprobe
- [ ] 5.2 Bestehende Vitest und e2e an die neuen Wörter angepasst
- [ ] 5.3 Regel in `frontend/AGENTS.md`, Seitenkopf
- [ ] 5.4 Gates: tsc, Lint, Prettier, Vitest komplett, `check-all.sh --nur schnell`, betroffene e2e

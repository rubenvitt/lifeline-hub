## 1. Grundlagen

- [x] 1.1 `useDokumentTitel` (setzt, verbindet, stellt beim Abbau zurück) mit Vitest
- [x] 1.2 `einsatz/letzterOrt.ts` (Frist, je Benutzer, fremder Inhalt) über `sichererSpeicher`, mit Vitest
- [x] 1.3 `einsatzKennung` nach `einsatz/einsatzKennung.ts` ziehen

## 2. Tab-Titel

- [x] 2.1 `EinsatzRahmen` setzt den Titel aus Registry und Einsatz, merkt den letzten Ort
- [x] 2.2 `ebene1Seite(pathname)` (rein) und Titel in `AppLayout`, Titel auf der Anmeldung

## 3. Ortspfad und Einsatzstatus

- [x] 3.1 `EinsatzRahmenKontext`; `EinsatzSeite` zeigt `EinsatzstatusMarke` bei nicht aktivem Einsatz
- [x] 3.2 `Ortspfad` exportieren, `title` je Eintrag; CSS: „Einsätze“ und Trenner schrumpfen nicht
- [x] 3.3 Einsatzdaten h1 „Einsatzdaten“ und Pfad; ETB, Meldebild, Einstellungen, Lagekarte mit Pfad
- [x] 3.4 Status-Etikett aus den zwölf Seitentiteln, ETB-Hinweis entfällt, Lagekarte mit Marke
- [x] 3.5 Tier-Reiter „Offen“

## 4. Wechsler und Rückweg

- [x] 4.1 `EinsatzSwitcher`: markiert, eigener Klick ohne Sprung, Nebenzeile, ohne „Stammdaten“
- [x] 4.2 `Ebene1Ort`-Kontext in `AppLayout`, Ortspfad und Rückweg in `AdminPage`
- [x] 4.3 `GlobalLink` mit Aktivzustand und `aria-current`

## 5. Nachweis und Abschluss

- [x] 5.1 e2e `orientierung.spec.ts` (Titel über alle Module, kein Status im h1, 390 ungekürzt, Rückweg als Beobachter) und Mutationsprobe
- [x] 5.2 Bestehende Vitest und e2e an die neuen Wörter angepasst
- [x] 5.3 Regel in `frontend/AGENTS.md`, Seitenkopf
- [x] 5.4 Gates: tsc, Lint, Prettier, Vitest komplett, `check-all.sh --nur schnell`, betroffene e2e

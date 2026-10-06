# Tasks

## 1. Benutzermenü (D4)

- [ ] 1.1 `components/BenutzerMenu.test.tsx`: Reihenfolge Kopf · Profil · Abmelden vor den Gruppen; Funktion im Menükopf unter `xl`. Prüfen: rot vor 1.2
- [ ] 1.2 `components/BenutzerMenu.tsx`: Reihenfolge, Funktion im Kopf, Dateikopf. Prüfen: 1.1 grün, `bedien-helligkeit`-Tests grün

## 2. Gemessene Rahmenhöhe (D2)

- [ ] 2.1 Test und Umsetzung `components/rahmenOben.ts` (Store, `useRahmenOben`, Beobachter-Hook, `--lfh-rahmen-oben`, `0px` ohne Element)
- [ ] 2.2 Guard `components/rahmenOben.guard.test.ts`: kein klebendes `top: 0` unter `src/` außerhalb des Rahmens. Prüfen: rot vor 2.3
- [ ] 2.3 Abnehmer: `KatalogTabelle` und Gefahrenmatrix (`offsetHeader`, Fokusfreiraum in `sprache.css`/`gefahrenMatrix.css`), ETB-Bilanz, Sammelbanner in ETB-Zeitachse, Erfassungsanhängen, Infotelefon. Prüfen: 2.2 grün

## 3. Kopf und Betriebszeile kleben (D1)

- [ ] 3.1 `EinsatzLayout`, `AppLayout`: Kopf ab `md` sticky mit `RAHMEN_EBENE`, Beobachter am Kopf; Tests
- [ ] 3.2 `LiveStatusBanner`: unter `md` sticky bei Störung, Beobachter an der Zeile; Test
- [ ] 3.3 `IconRail`: Hauptgruppe sticky unter `--lfh-rahmen-oben`; Test

## 4. Fokusabstand (D3)

- [ ] 4.1 `index.css`: `scroll-padding-block-start` am Dokument mit `:has`-Ausnahme für Fokus im Rahmen (D3)
- [ ] 4.2 `e2e/fokus-verdeckung.spec.ts`: „Kopf verdeckt keinen Fokus“ (Shift+Tab bei 1366 × 520, Vorbedingung Stopps am Kopf) und „Tab durch den Kopf rollt nicht“; Mutationsprobe ohne Abstand dokumentieren

## 5. Modulpanel (D5)

- [ ] 5.1 `einsatz/navPersistenz.test.ts`: dreiwertig (zu, offen, keine Wahl). Prüfen: rot vor 5.2
- [ ] 5.2 `navPersistenz.ts`, `EinsatzLayout`: Vorgabe je Breite, Wahl nur über Griff und Selbstklick; Tests
- [ ] 5.3 `IconRail`: Griff „Menü“ im Fuß mit `aria-expanded`/`aria-controls`, `aria-expanded` an der offenen Kategorie; `ModulPanel` mit `id`; Tests

## 6. Überblick (D6)

- [ ] 6.1 `pages/fuehrung/ueberblick.css` und `AbschnittEintrag`: Raster mit Containerabfrage; Test der Klassen

## 7. Regel und Nachweis

- [ ] 7.1 `frontend/AGENTS.md`, Abschnitt „Rahmen“: Stehenbleiben gestuft, `--lfh-rahmen-oben`, Panel-Vorgabe
- [ ] 7.2 `e2e/rahmen-stehen-bleiben.spec.ts` (vier Breiten, offline, Abmelden in `handschuh`, Stärke bei 1180, Tabellenkopf), Admin und nicht-privilegiert; Mutationsprobe ohne sticky dokumentieren
- [ ] 7.3 Mitlaufen: `kopfzeile-schmal`, `fokus-verdeckung`, `rail-etikett`, `nav-schmal`, `gate1-ueberlauf`, `gate3-trefflaeche`, `leisten-flaeche`
- [ ] 7.4 Vitest, Lint, Typen, `check-all.sh --nur schnell`

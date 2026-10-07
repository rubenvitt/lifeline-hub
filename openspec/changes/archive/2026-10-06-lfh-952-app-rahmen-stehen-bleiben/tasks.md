# Tasks

## 1. Benutzermenü (D4)

- [x] 1.1 `components/BenutzerMenu.test.tsx`: Reihenfolge Kopf · Profil · Abmelden vor den Gruppen; Funktion im Menükopf unter `xl`. Prüfen: rot vor 1.2
- [x] 1.2 `components/BenutzerMenu.tsx`: Reihenfolge, Funktion im Kopf, Dateikopf. Prüfen: 1.1 grün, `bedien-helligkeit`-Tests grün

## 2. Gemessene Rahmenhöhe (D2)

- [x] 2.1 Test und Umsetzung `components/rahmenOben.ts` (Store, `useRahmenOben`, Beobachter-Hook, `--lfh-rahmen-oben`, `0px` ohne Element)
- [x] 2.2 Guard `components/rahmenOben.guard.test.ts`: kein klebendes `top: 0` unter `src/` außerhalb des Rahmens. Prüfen: rot vor 2.3
- [x] 2.3 Abnehmer: `KatalogTabelle` und Gefahrenmatrix (`offsetHeader`, 0 in Drawer und Modal; der Fokusfreiraum addiert sich zum `scroll-padding`, D2), ETB-Bilanz, Sammelbanner in ETB-Zeitachse, Erfassungsanhängen, Infotelefon. Prüfen: 2.2 grün

## 3. Kopf und Betriebszeile kleben (D1)

- [x] 3.1 `EinsatzLayout`, `AppLayout`: Kopf ab `md` sticky mit `RAHMEN_EBENE`, Beobachter am Kopf; Tests
- [x] 3.2 `LiveStatusBanner`: unter `md` sticky bei Störung, Beobachter an der Zeile; Test
- [x] 3.3 `IconRail`: Hauptgruppe sticky unter `--lfh-rahmen-oben`; Test

## 4. Fokusabstand (D3)

- [x] 4.1 `index.css`: `scroll-padding-block-start` am Dokument mit `:has`-Ausnahme für Fokus im Rahmen (D3)
- [x] 4.2 `e2e/fokus-verdeckung.spec.ts`: „Kopf verdeckt keinen Fokus“ (Shift+Tab bei 1366 × 520, Vorbedingung Stopps am Kopf) und „Tab durch den Kopf rollt nicht“; Mutationsprobe ohne Abstand dokumentieren

## 5. Modulpanel (D5)

- [x] 5.1 `einsatz/navPersistenz.test.ts`: dreiwertig (zu, offen, keine Wahl). Prüfen: rot vor 5.2
- [x] 5.2 `navPersistenz.ts`, `EinsatzLayout`: Vorgabe je Breite, Wahl nur über Griff und Selbstklick; Tests
- [x] 5.3 `IconRail`: Griff „Menü“ im Fuß mit `aria-expanded`/`aria-controls`, `aria-expanded` an der offenen Kategorie; `ModulPanel` mit `id`; Tests

## 6. Überblick (D6)

- [x] 6.1 `pages/fuehrung/ueberblick.css` und `AbschnittEintrag`: Raster mit Containerabfrage; Test der Klassen

## 8. Nacharbeit aus dem Review

- [x] 8.1 `IconRail`: eine klebende Spalte statt zweier (Kategorien oben, Fuß unten überlappten bei geringer Höhe); e2e 1366 × 520 in `handschuh`, gerollt, letzte Kategorie klicken
- [x] 8.2 `rahmenOben`: Versatz 0 für Tabellen in Drawer und Modal (`useRahmenObenFuer`); Test
- [x] 8.3 `useRahmenObenQuelle` als Callback-Ref (ein getauschtes Element wird neu beobachtet); Test
- [x] 8.4 Nachziehen: `App.test.tsx`, `rail-etikett`, `nav-schmal`, `trefflaeche-tablet` (Panel über den Griff öffnen); `LiveStatusBanner`-Test „Störung vorbei, Anteil weg“; Rollen-Vorbedingung und Klick in `rahmen-stehen-bleiben`
- [x] 8.5 Kommentare: `EinsatzLayout` (alter Zustandsblock), `UeberblickPage.test`, `geraetRaeumung`, `BenutzerMenu`, Einrückung in ETB-Zeitachse/Infotelefon

## 7. Regel und Nachweis

- [x] 7.1 `frontend/AGENTS.md`, Abschnitt „Rahmen“: Stehenbleiben gestuft, `--lfh-rahmen-oben`, Panel-Vorgabe
- [x] 7.2 `e2e/rahmen-stehen-bleiben.spec.ts` (vier Breiten, offline, Abmelden in `handschuh`, Stärke bei 1180, Tabellenkopf), Admin und nicht-privilegiert; Mutationsprobe ohne sticky dokumentieren
- [x] 7.3 Mitlaufen: `kopfzeile-schmal`, `fokus-verdeckung`, `rail-etikett`, `nav-schmal`, `gate1-ueberlauf`, `gate3-trefflaeche`, `leisten-flaeche`, `trefflaeche-tablet`, `katalogtabelle-schmal`, `lagekarte-*`; Specs, die bei 1024 px das offene Panel erwarten, öffnen es über den Griff
- [x] 7.4 Vitest, Lint, Typen, `check-all.sh --nur schnell`

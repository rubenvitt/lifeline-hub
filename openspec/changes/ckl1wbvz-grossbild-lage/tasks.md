# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, der ohne die Änderung rot
ist. Pfade relativ zu `frontend/src/`, Läufe in `frontend/` über `mise exec -- pnpm …`.

## 1. Entwurf

- [x] 1.1 Großbild für Lagebild und Lagebesprechung mit `/design` (Artifact-Typ „Design“, Design
  System „Lifeline Hub“) entwerfen und unter `docs/design/2026-11-16-grossbild/` ablegen
  (Aufteilung aus design.md D5, Nacht und Tag, 1920 × 1080 und 1280 × 720); ist das Design System
  aus der Sitzung nicht lesbar, Entwurf aus den Bausteinen bauen und das im Ordner-README
  vermerken. Prüfen: Ordner enthält Entwurf und README.

## 2. Großbild-Skala und Bausteine

- [x] 2.1 `components/grossbild/grossMass.ts`: `GROSS_BEZUG` (96/72/32/28 und Abstände) und
  `grossMass(px)` nach D3; Test: `grossMass(28)` ergibt `min(1.4583…vw, 2.5925…vh)`, und
  ausgerechnet bei 1920 × 1080 genau 28, bei 1280 × 720 zwei Drittel.
- [x] 2.2 `components/grossbild/useBildschirmWach.ts` (inhaltsgleich mit dem Lagemonitor, Kopf
  verweist auf die Folgeaufgabe); Test: fordert beim Start und bei Rückkehr in den Vordergrund an,
  gibt beim Abbau frei.
- [x] 2.3 `GrossKennzahl`: Bezeichnung, Zahl, Notiz, Töne über die Statusrollen, Zustände `laden`,
  `fehler`, „—“ mit Grund, kein Link; Test je Zustand und Ton, und dass kein `<a>` und kein Knopf
  entsteht.
- [x] 2.4 `GrossZeile` mit gemeinsamem Raster (Wert direkt neben der Bezeichnung) und optionaler
  Farbmarke mit Wort; Test: Wert in der zweiten Spalte, Marke trägt ein Wort.
- [x] 2.5 `GrossbildFlaeche`: Portal, `role="dialog"`, Element-Vollbild beim Öffnen, Ausstieg über
  „Großbild verlassen“, Esc und `fullscreenchange`, Knopf „Vollbild“ nur ohne Vollbild,
  `overflow: hidden` an `<html>` mit Wiederherstellung, Fokus hin und zurück, Wachhalten,
  Alarmzahl aus `useAlarmZone` („1 Alarm offen“/„2 Alarme offen“ in Alarmrolle, ohne Titel),
  `UebungsMarke` bei Übung; Tests mit gestubbtem `requestFullscreen` je Punkt, Ablehnung des
  Vollbilds lässt die Fläche stehen.
- [x] 2.6 Export über `components/grossbild/index.ts`, Karten für `GrossKennzahl` und `GrossZeile`
  in `PREVIEWS` (`frontend/scripts/design-system/previews.tsx`, Einheit über
  `--lfh-gross-einheit` festgesetzt); `GrossbildFlaeche` bekommt keine Karte, denn sie hängt per
  Portal am Dokument und fordert Vollbild an. `pnpm design-system` laufen lassen und Erzeugtes
  mitnehmen; Prüfen: `designSystem.guard.test.ts` und `gate5.guard.test.ts` grün.

## 3. Lagebild im Großbild

- [ ] 3.1 Abbildung „Kennzahl + Zustand → Anzeige“ (gesperrt → „—“ mit `NICHT_FREIGEGEBEN`, Ton,
  Notiz, Zustand) als reine Funktion neben `pages/lage-dashboard/lagebild.ts` ziehen und in
  `LageDashboardPage` benutzen; Test der Funktion, die bestehenden Tests der Seite bleiben grün.
- [ ] 3.2 `pages/lage-dashboard/LagebildGrossbild.tsx` nach D5 (sechs Kennzahlen, Gefahren je Typ
  begrenzt mit „+ n weitere“ bzw. Verlauf bei „Sanitätsdienst“, Sichtung, Führungsstand 2 × 2,
  Uhrzeit und Datenstand, kein Meldungsstrom); Tests: dieselben Werte wie die Seite bei gleichen
  Daten, Alarmton bei überfälligem Auftrag, „—“ bei gesperrter Quelle, kein Link.
- [ ] 3.3 `LageDashboardPage`: Zustand `istGrossbild`, Knopf „Großbild“ ab `md` im Slot
  `aktionen`, Zweig nach `</EinsatzSeite>`; Test: Knopf öffnet die Fläche, Verlassen zeigt die
  Seite, Wert ändert sich live in beiden.

## 4. Lagebesprechung im Großbild und Vorbereitung

- [ ] 4.1 `lagebesprechung/useVorbereitung.ts` aus `VorbereitungPaneel` ziehen (Zeilen, Stand,
  `laedt`), Paneel darauf umstellen; bestehende Tests von Paneel und `vorbereitung.ts` grün.
- [ ] 4.2 Zeilenraster der Vorbereitung nach D8 (`minmax(0, min(16em, 40%)) minmax(0, 1fr)`,
  linksbündig, Quelle unter der Bezeichnung, Notiz unter dem Wert); Test: Wert-Element ohne
  `text-align: end`, Reihenfolge Bezeichnung, Wert, Quelle, Notiz.
- [ ] 4.3 `lagebesprechung/LagebesprechungGrossbild.tsx` nach D5 (Termin mit Zustand und Ton,
  „Abgeschlossen“, Zeilen zweispaltig ohne Quelle, „Stand HH:MM“); Tests: Wort und Ton bei
  überfälligem Termin, „—“ mit „nicht freigegeben“ bei gesperrten Nachforderungen, keine
  Quellenangabe, keine Knöpfe außer denen der Hülle.
- [ ] 4.4 `LagebesprechungPage`: Knopf „Großbild“ ab `md` links vom Primärknopf, auch ohne
  Schreibrecht; Test: Knopf da ohne Schreibrecht, öffnet und schließt das Großbild.
- [ ] 4.5 `lagebesprechung/AGENTS.md` um den Absatz „Großbild“ ergänzen (Zeilen aus
  `useVorbereitung`, keine Quelle im Großbild, Verweis auf Spec `grossbild-ansicht`).

## 5. Ende zu Ende, Doku, Gates

- [ ] 5.1 e2e-Spec `e2e/grossbild.spec.ts`: Lagebild und Lagebesprechung bei 1920 × 1080 (Zahl
  ≥ 72 px, jeder Text ≥ 28 px per `getComputedStyle`, kein Bildlauf, Esc führt zurück) und bei
  1280 × 720 (kein Bildlauf); `e2e/lagebesprechung-vorbereitung.spec.ts` um den Abstand
  Bezeichnung–Wert ≤ 400 px bei 1920 × 1080 und kein Überlauf bei 390 px ergänzen. Lauf der beiden
  Specs grün.
- [ ] 5.2 Anwenderdoku `docs/anwender/kapitel/lagebild.md` und `lagebesprechung.md` um
  „Großbild“ ergänzen (Einstieg, nur Ansehen, Verlassen, Alarmzahl) und die Bilder der Kapitel
  neu aufnehmen (`pnpm doku:bilder --grep lagebild`, `--grep lagebesprechung`); Wächter der Doku grün.
- [ ] 5.3 `frontend/AGENTS.md`: Bausteine unter `components/grossbild/` in die Liste „Bausteine
  außerhalb von `instrument/`“ aufnehmen, mit Verweis auf die Spec.
- [ ] 5.4 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Ergebnis für den PR festhalten.

## Workflow follow-up

- Review vor dem PR (Phase 4 `dev-zunder-orchestrieren`), dann `/opsx:archive` im selben Branch.
- Folgeaufgaben anlegen: „Lagemonitor auf Großbild-Bausteine“ (nach LLH-1746), „Alarmzeile ‚Was
  brennt‘ im Großbild“ (nach LLH-1743).
- Nach dem Merge Design System neu veröffentlichen.

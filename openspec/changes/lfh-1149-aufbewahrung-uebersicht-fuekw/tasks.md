# Tasks

## 1. Übersicht (im Branch schon umgesetzt, Commit 7ef4bd6)

- [x] 1.1 `AufbewahrungUebersicht.tsx`: Vormerkung, Antrags-Fälligkeit und Schwärzung tragen `abBreite: 'xxl'`, die Bezeichnung fließt, alle übrigen Spalten tragen eine Zahlbreite; nachgeprüft am Diff und am Dateikopf (Verweis auf das Gate)
- [ ] 1.2 e2e „Tabellen am Führungsarbeitsplatz“ in `e2e/gate1-ueberlauf.spec.ts`: Aufbewahrung bei 1440 px ohne Tabellenüberlauf, „Spalten · 3 ausgeblendet“ als Vorbedingung; grün, vorher rot mit 586 px

## 2. Tests auf die Spec ziehen

- [x] 2.1 `AufbewahrungUebersicht.test.tsx`: die Tests zu „Vorgemerkt am“ (Zeile 111) und „Schwärzung auf Antrag ab“ (Zeile 130) rendern bei 1600 px und finden die Spaltenköpfe; Vitest der Datei grün
- [x] 2.2 Neuer Vitest in derselben Datei: bei 1024 px fehlen die drei Spaltenköpfe, der Zähler nennt „Spalten · 3 ausgeblendet“, über den Schalter eingeblendet steht „Vorgemerkt am“ wieder als Spaltenkopf; zuerst rot gegen eine Probe ohne `abBreite` an einer der Spalten, dann grün

## 3. Doku

- [x] 3.1 `docs/anwender/kapitel/aufbewahrung.md`: Schritt zum Einblenden spricht von „Fensterbreite“ statt „Bildbreite“ (ebenso `fahrzeuge.md`); `anwenderdoku.guard.test.ts` grün
- [x] 3.2 Bild `docs/anwender/bilder/aufbewahrung/uebersicht.png` zeigt sieben Spalten ohne Überlauf (per `pnpm doku:bilder e2e/doku-bilder/aufbewahrung.bilder.ts` erzeugt)

## 4. Nachweis

- [ ] 4.1 Gates: tsc, Lint, Prettier, Vitest komplett, `scripts/check-all.sh --nur schnell` (inkl. `check-openspec-archiv.sh`), e2e `gate1-ueberlauf.spec.ts` und `aufbewahrung.spec.ts`

## Workflow follow-up

- `/opsx:archive lfh-1149-aufbewahrung-uebersicht-fuekw` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/aufbewahrung-archiv/spec.md`).
- PR gegen `alpha` mit Fahrzeuge, Dokumente, Aufbewahrung und Archiv zusammen.

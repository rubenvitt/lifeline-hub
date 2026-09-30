# Tasks

## 1. Fixture-Basemap als gemeinsames Hilfsmodul

- [x] 1.1 `frontend/e2e/kartenFixture.ts` anlegen: `vektorKachel(layer)` (Byte-Kommentar aus
  `lagekarte-kachelpfad.spec.ts` mitnehmen, Längenbytes aus dem Namen), Routen für Config,
  Style-JSON und Kacheln; verifiziert durch `vektorKachel('strassen')` = die bisherigen 33 Bytes
  (Assertion in `lagekarte-kachelpfad.spec.ts`, als Hex-Literal gepinnt)
- [x] 1.2 `lagekarte-kachelpfad.spec.ts` auf das Modul umstellen; verifiziert durch
  `pnpm e2e lagekarte-kachelpfad` grün (12 s) und `eslint --max-warnings 0` ohne Befund

## 2. Test 1 — Wechsel zwischen zwei Online-Vektor-Views (D3)

- [x] 2.1 `frontend/e2e/lagekarte-kartengrundlage.spec.ts` mit Saat (Einsatzort, Abschnitt mit
  Fläche, Zone, freies Zeichen, DWD-Fixture sichtbar) und Vorher-Zusicherungen (`fixture-a`
  dekodiert, Quellen befüllt, freies Zeichen gezeichnet); verifiziert durch einen grünen Lauf
- [x] 2.2 Wechsel über die Grundlage-Leiste und Nachher-Zusicherungen (`fixture-a` weg,
  `fixture-b` dekodiert, Quellen wieder befüllt, Zeichen gezeichnet, keine `pageerror`);
  verifiziert durch einen grünen Lauf (15 s)
- [x] 2.3 Mutationsproben aus D5 für Test 1, alle zurückgenommen (`git status` sauber):
  M1 Aufruf `planeReAnlegenNachStyle` entfernt → **rot** (Zonen, Fachebene, Marker, Einsatzort
  leer, Zeichen 0); M2 `tz|`-Zweig früh verlassen → **rot** (`tzBilder`/`zeichen` 0, schon vor dem
  Wechsel); M3 `diff: false` entfernt → **rot** (Lagequellen leer nach dem Wechsel) — der
  Kommentar am `[style]`-Effekt ist damit erstmals im Browser belegt

## 3. Test 2 — Abstufung online → offline (D4)

- [x] 3.1 Test mit Style-404 der Online-View und Offline-Region aus der Fixture (`streets`):
  Offline-Source dekodiert, Online-Source fehlt, Grundlage-Leiste zeigt weiter die Online-View,
  genau eine Abstufungswarnung, keine `pageerror`; verifiziert durch einen grünen Lauf — erst nach
  dem Fix aus design.md D6 (vorher rot: die Karte blieb ganz ohne Style; Unit-Test
  „jeder angewandte Style öffnet ein eigenes Fenster …“ zuerst rot, dann grün)
- [x] 3.2 Mutationsproben, alle zurückgenommen: M4 `onStyleFehler` im `error`-Hörer ab → **rot**
  (Test 2); M5 neues Fenster je Style zurückgenommen (der Befund) → **rot** (Test 2); M6
  Quellenwache der Cluster-Schleife ab → **rot** (Test 1: falsche Abstufung beim gesunden Wechsel)

## 4. Bestehende Abdeckung belegen

- [x] 4.1 Mutationsproben Vitest: M7 Spider-Kreis auf konstanten Versatz → `spiderfy.test.ts`
  **rot** („Kreis bis 9 … kein Overlap“); M8 `donutSegmente` ohne Typsegmente →
  `clusterDonut.test.ts` **rot** (2 Tests)
- [x] 4.2 Mutationsprobe M10 Spider-Öffnen in `Kartenflaeche.tsx` unterdrückt → **rot** in
  `e2e/lagekarte-touch.spec.ts` („Tipps treffen Einzelzeichen, Cluster und aufgefächerte
  Zeichen“ bei 390 und 1024 px) und `e2e/betroffene-karte.spec.ts` (Handschuh-Spider); Grundlauf
  derselben Auswahl mit dem Fix vorher grün (5 Tests)
- [x] 4.3 Mutationsprobe M9 Kantenwahl in `bildHandles.ts` umgangen (alle Kanten scharf) →
  `bildHandles.test.ts` **rot** (6 Tests)

## 5. Doku und Abschluss

- [x] 5.1 `CLAUDE.md`, Lagekarte → Nachweise: `e2e/lagekarte-kartengrundlage.spec.ts` ergänzen
  (Fixture-Basemap `e2e/kartenFixture.ts`, Abstufungsfenster je Style); verifiziert durch
  `grep` auf den Pfad
- [x] 5.2 Verdikt-Tabelle (design.md D1) und Befund D6 als Kommentar an LFH-558 in ClickUp
- [x] 5.3 Fast-Gates grün: `check-fmt.sh`, `pnpm lint`, `tsc`, Vitest `src/pages/lagekarte/`,
  Lagekarten-e2e (Kartengrundlage, Kachelpfad, Smoke, Offline-Zeichnen, Marker-Plaketten,
  Zeichnen-korrigierbar, Touch/Betroffene-Auswahl); vollständiges `check-all.sh` belegt die CI
  des PRs [rubenvitt/lifeline-hub#264](https://github.com/rubenvitt/lifeline-hub/pull/264)

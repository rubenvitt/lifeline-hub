# Tasks

## 1. Fixture-Basemap als gemeinsames Hilfsmodul

- [ ] 1.1 `frontend/e2e/kartenFixture.ts` anlegen: `vektorKachel(layer)` (Byte-Kommentar aus
  `lagekarte-kachelpfad.spec.ts` mitnehmen, Längenbytes aus dem Namen), Routen für Config,
  Style-JSON und Kacheln; verifiziert durch `vektorKachel('strassen')` = die bisherigen 33 Bytes
  (Assertion in `lagekarte-kachelpfad.spec.ts`)
- [ ] 1.2 `lagekarte-kachelpfad.spec.ts` auf das Modul umstellen; verifiziert durch
  `pnpm e2e lagekarte-kachelpfad` grün und `pnpm lint` ohne Warnung

## 2. Test 1 — Wechsel zwischen zwei Online-Vektor-Views (D3)

- [ ] 2.1 `frontend/e2e/lagekarte-kartengrundlage.spec.ts` mit Saat (Einsatzort, Abschnitt mit
  Fläche, Zone, freies Zeichen, DWD-Fixture sichtbar) und Vorher-Zusicherungen (`fixture-a`
  dekodiert, Quellen befüllt, freies Zeichen gezeichnet); verifiziert durch einen grünen Lauf
- [ ] 2.2 Wechsel über die Grundlage-Leiste und Nachher-Zusicherungen (`fixture-a` weg,
  `fixture-b` dekodiert, Quellen wieder befüllt, Zeichen gezeichnet, keine `pageerror`);
  verifiziert durch einen grünen Lauf
- [ ] 2.3 Mutationsproben aus D5 für Test 1 (Re-Anlage entfernt, `tz|`-Zweig verlassen,
  `diff: false` entfernt) — Ergebnis je Probe hier vermerken, alle Proben zurückgenommen
  (`git diff` auf `src/` leer)

## 3. Test 2 — Abstufung online → offline (D4)

- [ ] 3.1 Test mit Style-404 der Online-View und Offline-Region aus der Fixture (`streets`):
  Offline-Source dekodiert, Online-Source fehlt, Grundlage-Leiste zeigt weiter die Online-View,
  genau eine Abstufungswarnung, keine `pageerror`; verifiziert durch einen grünen Lauf
- [ ] 3.2 Mutationsprobe (`onStyleFehler` im `error`-Hörer ab) → rot; Gegenprobe (Wächter schärft
  nicht neu) → grün; Ergebnis hier vermerken, Proben zurückgenommen

## 4. Bestehende Abdeckung belegen

- [ ] 4.1 Mutationsprobe `spiderfy.test.ts`/`clusterDonut.test.ts` (Versatz konstant bzw.
  Segmente leer) → rot; Ergebnis hier vermerken
- [ ] 4.2 Mutationsprobe Spider-Öffnen in `Kartenflaeche.tsx` unterdrückt → Spider-Test in
  `e2e/lagekarte-touch.spec.ts` rot; Ergebnis hier vermerken
- [ ] 4.3 Mutationsprobe Kantenwahl in `bildHandles.ts` umgangen → `bildHandles.test.ts` rot;
  Ergebnis hier vermerken

## 5. Doku und Abschluss

- [ ] 5.1 `CLAUDE.md`, Lagekarte → Nachweise: `e2e/lagekarte-kartengrundlage.spec.ts` ergänzen
  (Fixture-Basemap `e2e/kartenFixture.ts`); verifiziert durch `grep` auf den Pfad
- [ ] 5.2 Verdikt-Tabelle (design.md D1) als Kommentar an LFH-558 in ClickUp
- [ ] 5.3 Fast-Gates grün: `check-fmt.sh`, `pnpm lint`, Vitest der berührten Dateien, die drei
  Lagekarten-e2e-Specs; vollständiges `check-all.sh` belegt die CI des PRs

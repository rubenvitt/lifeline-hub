# Tasks

## 1. Modell: Lagezustand und Zählung (`fuehrungsorganisation.ts`)

- [x] 1.1 Abschnittsknoten tragen `lagezustand` (D1); Test in `fuehrungsorganisation.test.ts`: ein
  kritischer Abschnitt ergibt `lagezustand: 'kritisch'`, ein nicht beurteilter `null`, ein
  Unterabschnitt behält seinen eigenen Zustand
- [x] 1.2 `countOhneLeitung` und `ohneLeitungText` (D4); Tests: Abschnitte und Einheiten getrennt,
  Sammelknoten und unterstellte Einheiten gezählt, Einzahl/Mehrzahl, Teil mit 0 entfällt, alles
  besetzt → `null`, Einheiten fehlen → nur Abschnitte und kein „0“

## 2. Bericht (`renderFuehrungsorganisationMarkdown`)

- [x] 2.1 „Lage <Zustand>“ an der Abschnittszeile und die Sammelzeile unter „Gliederung“ (D6);
  Tests: Szenario „Übernahme mit Lagezustand und Lücken“, nicht beurteilter Abschnitt ohne
  „Lage“, alles besetzt ohne Sammelzeile

## 3. Bildschirm und Druck (`Organigramm.tsx`)

- [x] 3.1 Lagezustandsetikett am Abschnittsknoten (D2); Test in `Organigramm.test.tsx`: „kritisch“
  am Knoten der UHS Turnhalle, kein Etikett an einem nicht beurteilten Abschnitt und an Einheiten
- [x] 3.2 „Leitung nicht besetzt“ gedämpft statt Achtungrolle (D3); Test: das Wort steht da und
  trägt nicht die Achtungfarbe
- [x] 3.3 Sammelzeile fest über dem Organigramm, live, immer gleich hoch, druckbar (D5); Tests:
  Etiketten bei Lücken, leiser Text bei voller Besetzung, nur Abschnitte bei nicht geladenen
  Einheiten, Zahl und Höhe bei gehaltener Schleuse, Container ohne `organigramm-no-print`
- [x] 3.4 Live bei gehaltener Struktur: Test, dass eine Zustandsänderung bei Zeiger über dem
  Organigramm ohne Sammelbanner am Knoten erscheint (Szenario „Zustand ändert sich, während der
  Zeiger über dem Organigramm liegt“)

## 4. Anwenderdoku

- [x] 4.1 Kapitel `docs/anwender/kapitel/einsatzabschnitte.md`, „Das Organigramm“: Lagezustand am
  Knoten und Sammelzeile beschreiben; Wächter `src/hilfe/anwenderdoku.guard.test.ts` grün
- [x] 4.2 Bild `organigramm.png` (hell und dunkel) neu aufnehmen
  (`pnpm doku:bilder e2e/doku-bilder/einsatzabschnitte.bilder.ts` nach `cargo build`) und
  ansehen: Etikett „kritisch“ an UHS Turnhalle und Sammelzeile sichtbar; Druckansicht per
  `emulateMedia print` einmal prüfen (dunkel auf hell)

## 5. Prüfung

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Review vor dem PR (frischer Agent, Prüfliste), Befunde gegengeprüft.
- `/opsx:archive zo7em8le-organigramm-lagezustand` im selben Branch, dann PR gegen `alpha`.

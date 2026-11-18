# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`.

## 0. Ausgangswert

- [ ] 0.1 Wegwerf-Messung auf dem Stand vor der Änderung: Oberkante der ersten Datenzeile auf Betroffene, Meldebild, Fahrzeuge, Personal, Einheiten (1440 × 900 `kompakt`, 1180 × 820 `komfortabel`/`handschuh`) und Fahrzeuge, Betroffene, Betreuung (390 × 844); Werte als Kommentar an LLH-1786 (Nachweis: Kommentar)

## 1. Nebenwege nach Breite und Stufe (D1)

- [ ] 1.1 `components/EinsatzSeite.tsx`: `NebenwegeImKopf` bündelt bei `istSchmal` oder `controlHeight` > `kompakt`; ab `md` steht der Auslöser hinter den Aktionen. Tests in `components/EinsatzSeite.weitere.test.tsx` „komfortabel ab md: ein Auslöser hinter den Aktionen“, „handschuh ab md: kein Nebenweg als Knopf“, „kompakt ab md: Knöpfe wie bisher“ rot→grün
- [ ] 1.2 Seitentests nachziehen, die Nebenwege als Knopf in 48/72 erwarten (`pages/PersonenPage.test.tsx` u. a.); alle grün
- [ ] 1.3 e2e-Helfer „Nebenweg wählen“ (Knopf oder Menü) und betroffene Specs umstellen: `betroffene-handy`, `modul-listen-druck`, `druck-fluss`, `gate1-ueberlauf`, `gate3-trefflaeche`, `trefflaeche-pruefflaechen`, Bildlauf `e2e/doku-bilder/*`; einzeln grün
- [ ] 1.4 `frontend/AGENTS.md`, „Nebenwege im Kopf“: Regel auf Breite und Stufe; Nachweis Prettier grün

## 2. Stärke im Seitenkopf (D2)

- [ ] 2.1 `kraefte/Verdichtungszeile.tsx`: Form `meta` (Mono, ohne eigene Zeile, Sprung „Meldebild“ in Stufenhöhe) und exportierter Platzhaltertext; Unit-Tests „Meta-Form ohne Zeilenabstand“, „Platzhalter in der Form der Zeile“ rot→grün
- [ ] 2.2 `components/Datensicht.tsx`: Prop zum Abschalten des Gruppenzählers (Vorgabe an); Unit-Test rot→grün
- [ ] 2.3 `pages/FahrzeugePage.tsx`, `pages/PersonalPage.tsx`, `pages/EinheitenPage.tsx`: Stärke in `meta` samt `metaPlatzhalter`, keine Zeile über der Liste; Fahrzeuge ohne Gruppenzähler. Seitentests „Stärke im Seitenkopf“, „Aufteilung nur einmal“ rot→grün
- [ ] 2.4 e2e: `kraefte-seitenkopf.spec.ts` (Titel auf gleicher Höhe) und `rahmen-cls-dichte.spec.ts` grün; neu „Fahrzeuge ohne Doppel“ in `kraefte-seitenkopf.spec.ts` grün

## 3. Klappbare Kennzahlen (D3)

- [ ] 3.1 Baustein `components/instrument/KlappBand.tsx` (Klappkopf mit Kurzform, `aria-expanded`, Höhe nach Stufe, Zustand je Seite über `lib/sichererSpeicher`, erst State, dann Speicher); Unit-Tests „Vorgabe offen“, „Wahl überlebt Neuaufbau“, „ohne Speicher wirkt die Wahl“ rot→grün
- [ ] 3.2 Eintrag in `GERAETESPEICHER` und `frontend/src/offline/AGENTS.md`; zugehöriger Guard grün
- [ ] 3.3 Meldebild-Statusband und `UnterbringungKennzahlen` (Betreuung) im `KlappBand` mit Kurzform; Seitentests „eingeklappt eine Zeile mit Zahlen“ rot→grün
- [ ] 3.4 Karte im Design System (Generator `frontend/scripts/design-system/`), Design System neu erzeugen; `designSystem.guard.test.ts` grün
- [ ] 3.5 e2e „Einklappen und neu laden“ und Klappkopf ≥ 72 px in `handschuh` (in `trefflaeche-pruefflaechen.spec.ts` bzw. neuem Spec); grün

## 4. Meldebild-Nebenwege (D4)

- [ ] 4.1 `pages/KraefteuebersichtPage.tsx`: „Drucken“ und „In Lagebericht übernehmen“ als `weitere` („Weitere Aktionen zum Meldebild“), aus der Werkzeugzeile entfernt, Sperrgrund im `label`; Seitentests rot→grün
- [ ] 4.2 e2e `meldebild-druck.spec.ts` und Lagebericht-Übernahme über den Helfer aus 1.3; grün
- [ ] 4.3 `frontend/AGENTS.md`: Ausnahme „Kräfteübersicht … kein Nebenweg“ streichen

## 5. „Filter (n)“ am Handschirm (D5)

- [ ] 5.1 `pages/PersonenPage.tsx`: unter `md` Knopf „Filter (n)“ im Kopf, Ansicht-Segmentleiste und Statusfilter nur offen; Zählung abseits der Vorgabe. Tests „Filter (1) mit Abgeschlossenen“, „ab md ohne Knopf“ rot→grün
- [ ] 5.2 `pages/FahrzeugePage.tsx`: dasselbe für die Ansichtswahl; Tests rot→grün
- [ ] 5.3 e2e `betroffene-handy.spec.ts` (erste Person und Sichtungszeile im Bild, Filter über Knopf) grün

## 6. Gesamtnachweis

- [ ] 6.1 `e2e/seitenkopf-werkzeuganteil.spec.ts` (D6): Matrix der Spec „Die erste Datenzeile steht oben im Fenster“ und Menü statt Knopf in 48/72; grün, Messwerte vorher/nachher im PR
- [ ] 6.2 Anwenderdoku: Kapitel, die Drucken/CSV/Stärkezeile/Filter beschreiben, nach `docs/anwender/AGENTS.md` nachziehen; Wächter grün
- [ ] 6.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- `/opsx:archive z137bgm5-seitenkopf-einzeilig` im selben Branch vor dem PR
- PR gegen `alpha` mit Bildern (vorher/nachher, Handschuh und Handy)

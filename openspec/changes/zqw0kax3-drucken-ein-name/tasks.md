# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der rote Test mit dem neuen
Wortlaut bzw. Platz, dann die Änderung. Pfade relativ zu `frontend/`.

## 1. Wortlaut als Baustein (D1, D2)

- [ ] 1.1 `src/components/druck/useDruckNebenwege.ts`: `DRUCKANSICHT`, `druckansichtVon(dokument)` und `druckansichtNebenweg({ ziel, navigate, dokument? })` ergänzen; belegt durch neue Fälle in `useDruckNebenwege.test.tsx` (Label, `ziel`, `key: 'druck'`).
- [ ] 1.2 `useDruckNebenwege({ vorDemDruck })`: synchron vor `drucken()` im selben Zug, ohne `laeuft`; belegt durch einen Test, der die Reihenfolge Aufklappen → Druckdialog prüft.
- [ ] 1.3 Formtest `src/druck/druckWortlaut.guard.test.ts`: schlägt an bei „Einsatzbericht drucken“, „Registrierliste drucken“ und einem Druckeinstieg „Drucken“ ohne Zusatz außerhalb von Tests; erst rot gegen den Bestand, nach Gruppe 2–4 grün.

## 2. Seiten mit eigener Druckseite heißen „Druckansicht“

- [ ] 2.1 ETB (`src/pages/EtbPage.tsx`, Knopf ab `md` und Menüeintrag): „Druckansicht“; `EtbPage`-Tests und `e2e/etb-druck.spec.ts`, `e2e/etb-druck-kontrast.spec.ts`, `e2e/druck-fluss.spec.ts` auf den neuen Namen.
- [ ] 2.2 Betroffene, Tiere, Schäden (`src/pages/{Personen,Tiere,Schaeden}Page.tsx`) über `druckansichtNebenweg`; Seiten-Tests, `src/components/EinsatzSeite.weitere.test.tsx`, `e2e/modul-listen-druck.spec.ts`, `e2e/betroffene-handy.spec.ts` grün.
- [ ] 2.3 Person (`src/pages/PersonenDetailPage.tsx`) über `druckansichtNebenweg` (Wortlaut bleibt); bestehende Tests grün.
- [ ] 2.4 Einsatzdaten und Sprungpalette: „Einsatzbericht – Druckansicht“ (`src/pages/EinsatzdatenPage.tsx`, `src/command-palette/befehle.ts`, Schlagwort „drucken“ bleibt); `befehle.test.ts`, `e2e/einsatzbericht-druck.spec.ts`, `e2e/einsatzabschluss.spec.ts` grün.

## 3. Seitendruck in den Seitenkopf (D3)

- [ ] 3.1 Meldebild (`src/pages/KraefteuebersichtPage.tsx`): `DruckKnopf` aus der Werkzeugzeile, `weitere` mit `useDruckNebenwege({ vorDemDruck })` (Stufe „alles“); Seitentest prüft Knopf im `seitenkopf-aktionen` und nicht in der Werkzeugzeile; `e2e/meldebild-druck.spec.ts`, `e2e/kraefte-schmal.spec.ts` grün.
- [ ] 3.2 Funkplan (`src/pages/FunkplanPage.tsx`, Aufklappen) und Kommunikationsplan (`src/pages/KommunikationsplanPage.tsx`) ebenso; Tests der Seiten, `e2e/funkplan-druck.spec.ts`, `e2e/funkplan.spec.ts`, `e2e/kommunikationsplan.spec.ts`, `e2e/fernmeldeskizze.spec.ts` (`fernmeldeskizze-kern.ts`) grün.
- [ ] 3.3 Organigramm: Nebenweg im Kopf von `src/pages/EinsatzabschnittePage.tsx`, solange das Organigramm steht; Aufklappen aus `Organigramm.tsx` gehoben; `e2e/fuehrungsorganisation-druck.spec.ts` grün.
- [ ] 3.4 Schichtplan und Planung: `AusgabeKnoepfe` → `useAusgabeNebenwege` („Druckansicht“, „Excel“ mit `laeuft`/Sperrgrund im `label`), in `src/pages/AbloesungPage.tsx` als `weitere` bei Ansicht Schichtplan, in `src/planung/PlanungPage.tsx` als `NebenwegeImKopf` bei Reiter „Plan“; Mappenfehler bleibt an der Ansicht; `SchichtplanAusgabeKnoepfe.test.tsx` umgestellt, `e2e/schichtplan-druck.spec.ts` grün.

## 4. Objektdruck im Kopf des Objekts (D4)

- [ ] 4.1 Auftrag (`src/auftraege/AuftragDetail.tsx`): `NebenwegeImKopf` mit „Druckansicht“ im `aktion` des Paneels, Sprung am Ende entfällt; `AuftragDetail.test.tsx` prüft den Platz, `e2e/auftrag-druck.spec.ts` grün.
- [ ] 4.2 Registrierliste (`src/betreuung/registrierung/RegistrierungPaneel.tsx`): „Registrierliste – Druckansicht“ über `NebenwegeImKopf` im Paneelkopf, eigene Zeile entfällt; `RegistrierungPaneel.test.tsx`, `src/geraet/GeraetBetreuungsstelle.test.tsx`, `e2e/registrierliste-druck.spec.ts`, `e2e/geraet-betreuungsstelle.spec.ts` grün; Gate 1 bei 390 px über `e2e/gate3-trefflaeche.spec.ts`/`e2e/trefflaeche-pruefflaechen.spec.ts`.

## 5. Regel und Hilfe (D5)

- [ ] 5.1 `src/druck/AGENTS.md`: Abschnitt „Wortlaut und Platz“ (zwei Wörter, zwei Plätze, Module ohne eigenen Druck samt Ersatzweg); Einträge zu Auftrag, Registrierliste, Schichtplan, Einsatzbericht nachgezogen; `frontend/AGENTS.md` „Nebenwege im Kopf“ ohne die Ausnahme; Prettier grün.
- [ ] 5.2 Hilfe: `docs/anwender/kapitel/drucken-export.md` (Wortlaut, Platz, Ersatzwege) und die Modulkapitel mit Druckweg (betroffene, tiere, schaeden, auftraege-befehle, abloesung, vorplanung, betreuung, geraet-betreuungsstelle, einsatzabschnitte, funkplan, meldebild, einsatzabschluss) nachgezogen; Bildlauf für geänderte Bilder (`e2e/doku-bilder/drucken-export.bilder.ts` u. a.) und Wächter aus `docs/anwender/AGENTS.md` grün.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; die Druck-Specs aus 2–4 lokal in Chromium grün.

## Workflow follow-up

- `/opsx:archive zqw0kax3-drucken-ein-name` im selben Branch, dann PR gegen `alpha`.

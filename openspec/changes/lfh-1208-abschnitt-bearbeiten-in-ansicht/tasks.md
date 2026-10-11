# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Pfade ohne Präfix sind relativ zu `frontend/src/`.

## 1. Fortschritt verlässt die Oberfläche (D7)

- [x] 1.1 `pages/einsatzabschnitte/AbschnittDaten.tsx` ohne Zeile „Fortschritt“. Der Kommentar
  zur Reihenfolge vor dem Abschnittsauftrag entfällt. Nachweis: Abwesenheitstest in
  `AbschnittVorschau.test.tsx` (Abschnitt mit `fortschritt: 72` zeigt weder „Fortschritt“ noch
  „72 %“). Der bisherige Lesetest LFH-608 in `EinsatzabschnittePage.test.tsx` wird
  entsprechend umgeschrieben.
- [x] 1.2 `pages/fuehrung/ueberblickDaten.ts` ohne Feld `fortschritt` in der Abschnittszeile,
  `pages/fuehrung/UeberblickPage.tsx` ohne Balken und Prozentzahl. Nachweis:
  `ueberblickDaten.test.ts` und `UeberblickPage.test.tsx` belegen die Abwesenheit
  (`[data-lfh="abschnitt-fortschritt"]` fehlt auch bei `fortschritt: 72`). Kürzel, Lagezustand
  und Auftrag bleiben geprüft.
- [x] 1.3 `api/einsatzabschnitte.ts`: `fortschritt` an `AbschnittEingabe` mit dem Vermerk „nur
  Altdaten, die Oberfläche schreibt ihn nicht (LFH-1208)“. Den Kommentar „S2 Abschnittsfortschritt“
  in `components/instrument/Aufgliederung.tsx` ziehen wir nach. Nachweis:
  `grep -rn "fortschritt" frontend/src/pages frontend/src/geraet` trifft nur noch Tests mit
  Abwesenheitsprüfung.

## 2. Bearbeitbares Detail (D1–D5, D8)

- [x] 2.1 `nocase` und die Belegt-Suche aus `EinsatzabschnittePage.tsx` in ein reines Modul
  `pages/einsatzabschnitte/kurzbezeichnung.ts` ziehen, etwa `findKurzbezeichnungKonflikt(abschnitte,
  wert, eigeneId)`. Nachweis: `kurzbezeichnung.test.ts` mit Groß-/Kleinschreibung, Trimmen,
  eigenem Abschnitt (kein Konflikt) und leerem Wert.
- [x] 2.2 `pages/einsatzabschnitte/AbschnittDetail.tsx`: `Datenraster` mit `InlineAngabe` für Name
  (Pflicht), Kurzbezeichnung (Prüfung aus 2.1 in `onSpeichern`), Über-Abschnitt (`TreeSelect`
  ohne eigene Nachfahren), Abschnittsleiter (`Select` disponierte Personen), Abschnittsauftrag
  (`TextArea`, `mehrzeilig`), Sprechgruppen (`SprechgruppenPicker`), Kommunikationsmittel,
  Erreichbarkeit / Nummer und Bemerkung (`mehrzeilig`), dazu die Stärke-Zeilen lesend. Jede Zeile
  ruft `onPatch(etikett, patch)` mit genau einem Feld. Nachweis: Vitest gegen `patcheAbschnitt`
  je Zeile, Gegenprobe „zwei Zeilen nacheinander aus altem Stand“ (Spec-Szenario), unverändert
  heißt keine Anfrage, leerer Name heißt keine Anfrage samt Hinweis, vergebene Kurzbezeichnung
  heißt keine Anfrage samt „Schon vergeben (…)“, Ablehnung bleibt offen mit Grund an der Zeile.
- [x] 2.3 Lagezustand als `Segmentleiste` in `AbschnittDetail` (vier Stufen, Punkt aus
  `abschnittLagezustand`, `nicht_beurteilt` ↔ `null`). Ein Wechsel speichert sofort, mit lokalem
  Wert bis zur Antwort, Rücksprung und `ZeilenFehler` bei Ablehnung und einem Riegel während eines
  laufenden Wechsels. Nachweis: Vitest prüft Klick (genau `{ lagezustand: 'kritisch' }`), Klick
  auf die gewählte Stufe (keine Anfrage), „nicht beurteilt“ (`{ lagezustand: null }`), Pfeiltaste
  (speichert), Ablehnung (vorige Stufe gewählt, Grund an der Zeile) und Doppelklick während
  laufender Anfrage (nur eine Anfrage).
- [x] 2.4 Ohne Schreibrecht: kein Stift, keine Aufforderung, Lagezustand als `StatusTag` bzw.
  „nicht beurteilt“, leere Angaben „—“. Nachweis: Vitest mit `darfSchreiben={false}` zählt
  null Knöpfe im Raster und keine `radiogroup`.
- [x] 2.5 Gleichlauf mit `AbschnittDaten` (D1). Nachweis: ein Test pinnt die Etiketten-Folge des
  Details (das Lesebauteil fasst Funk und Erreichbarkeit in einer Zelle zusammen, eine
  Gleichheit beider Folgen gäbe es also nicht), und beide Bauteile zeigen keinen Fortschritt.
- [x] 2.6 `EinsatzabschnittePage.tsx` nutzt `AbschnittDetail` mit einer Mutation `patch`
  (`mutateAsync`, Invalidierung Abschnitte/Einheiten/ETB, Erfolgs-Toast mit Angabe, kein
  `onError`-Toast). Knopf „Bearbeiten“, Schreibzweig-`Form`, `bearbeiten`-Zustand und
  `aktualisiereAbschnitt` (Seite und `api/einsatzabschnitte.ts`) entfallen. „Auflösen“ bleibt rot
  mit `Popconfirm` „Abschnitt auflösen“ unter dem Raster, mit `DetailFehler` nur für das
  Auflösen. Nachweis: `EinsatzabschnittePage.test.tsx` belegt, dass „Bearbeiten“ fehlt, dass ein
  Leiterwechsel genau `{ leiter_id }` sendet, und dass Auflösen bestätigt bzw. abgelehnt im Detail
  steht. `pnpm lint` und `tsc` sind sauber.

## 3. Anlegen als Erfassung (D6)

- [x] 3.1 `pages/einsatzabschnitte/AbschnittAnlegenModal.tsx` mit `ErfassungsModal`: Name
  (Pflicht), Kurzbezeichnung (Regel aus 2.1) und Über-Abschnitt (`TreeSelect`). `onErfassen` ruft
  `legeAbschnittAn` per `mutateAsync` mit genau diesen Feldern. Nachweis: Vitest prüft das
  Feldbudget (genau drei `.ant-form-item`, als Gegenprobe zur bloßen Obergrenze mit ihren
  Etiketten Name, Kurzbezeichnung, Über-Abschnitt gepinnt; kein Klappteil, also kein
  `forceRender`), Fokus im Namen, Enter im Namen sendet,
  Struktur (Knopf im `<form>`, keine `.ant-modal-footer`), Ablehnung bleibt offen mit Grund und
  Abbrechen sendet nichts.
- [x] 3.2 Seite: Kopfknopf, Leeraktion der Gliederung, Leeraktion des Organigramms und `?neu=1`
  öffnen das Modal (nur mit Schreibrecht, Parameter wird immer geräumt, Ansicht → `gliederung`).
  Nach Erfolg ist der neue Abschnitt gewählt. `entwurf`-Zustand, Baumknoten „Neuer Abschnitt
  (ungespeichert)“ und die Entwurf-Spiegelung in `useQueryParamSelektion` entfallen. Nachweis:
  `EinsatzabschnittePage.test.tsx` deckt `?neu=1` mit und ohne Schreibrecht ab, dazu Anlegen →
  neuer Abschnitt im Detail gewählt; die bestehenden Deeplink-Tests (`?abschnitt=`, `?ansicht=`)
  bleiben grün.

## 4. Regeln und Doku

- [x] 4.1 `frontend/AGENTS.md` fortschreiben. Unter „Farbachsen · Lagezustand“ entfällt
  „Fortschritt manuell (leer ≠ 0 %)“. Dafür kommen: Lagezustand im Abschnittsdetail per
  Segmentleiste, ein Klick speichert, und „Fortschritt“ ist ohne Oberfläche (LFH-1208, Spalte nur
  Altdaten). Unter „Formularseiten“ wird „Abschnitt anlegen ist ein lokaler Entwurf“ ersetzt
  durch: „‚Abschnitt anlegen‘ ist eine Erfassung (drei Felder), der Rest wird im Detail ergänzt;
  das Detail bearbeitet jede Angabe einzeln (`patcheAbschnitt`, ein Feld)“. Nachweis: Prettier
  über `frontend/` ist grün, und `grep -n "lokaler Entwurf" frontend/AGENTS.md` trifft nichts mehr.
- [ ] 4.2 Kapitel `docs/anwender/kapitel/einsatzabschnitte.md` neu schreiben: Anlegen in drei
  Feldern, Angaben am Wert ändern, Lagezustand mit einem Klick, kein Fortschritt. Dabei die Regeln
  aus `docs/anwender/AGENTS.md` einhalten (Kapitelform, Wächter). Nachweis: der Wächter der
  Anwenderdoku in `check-all.sh` ist grün.
- [ ] 4.3 `e2e/doku-bilder/einsatzabschnitte.bilder.ts` anpassen: `gliederung.png` zeigt das
  Detail mit Segmentleiste, `abschnitt-anlegen.png` das Modal mit drei Feldern, dazu der
  Dateikopf mit den neuen Quellen (`AbschnittDetail.tsx`, `AbschnittAnlegenModal.tsx`). Bilder
  neu erzeugen (`pnpm doku:bilder --grep einsatzabschnitte`). Nachweis: die Bilder liegen neu
  unter `docs/anwender/bilder/einsatzabschnitte/`, und die Bildverweise im Kapitel stimmen.

## 5. Einsatztauglichkeit und e2e

- [ ] 5.1 Prüfflächen C12 in `e2e/trefflaeche-pruefflaechen.spec.ts`: „Abschnitt Detailaktionen“
  misst statt `Bearbeiten|Auflösen` die Zeilen-Auslöser des Details, die Segmente des
  Lagezustands und „Auflösen“. Der Beobachterzweig belegt, dass Segmentleiste und Stifte fehlen.
  Nachweis: die Spec läuft grün in `kompakt` und `handschuh`.
- [ ] 5.2 Neue e2e `e2e/einsatzabschnitte-bearbeitung.spec.ts`: Lagezustand ändern (ETB-Eintrag
  erscheint), Leiter setzen, Abschnitt anlegen per Enter. Jeweils in `kompakt` und `handschuh`,
  und der Request-Body des PATCH enthält genau ein Feld. Nachweis: die Spec läuft grün.
- [ ] 5.3 `openspec/changes/lfh-1208-abschnitt-bearbeiten-in-ansicht/pruefliste.md` mit der
  Prüfliste Einsatztauglichkeit (15 Kriterien, jedes mit Verdikt erfüllt / offen → Zielticket /
  nicht anwendbar) für Detail und Anlegen-Modal, inklusive Handy (390 px, Gliederung über dem
  Detail). Nachweis: die Datei ist vollständig, ohne „nicht geprüft“.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` ist grün (lokal, ohne `| tail`). Kästchen, die erst die CI
  des PRs belegt, werden mit Verweis auf diesen Lauf abgehakt.
- [ ] 6.2 `superpowers:requesting-code-review` ist gelaufen, bestätigte Findings sind behoben.

## Workflow follow-up

- `/opsx:archive lfh-1208-abschnitt-bearbeiten-in-ansicht` im selben Branch vor dem PR, inklusive
  Spec-Sync nach `openspec/specs/einsatzabschnitt-bearbeitung/` und Verweisen.
- Hinweis an Ruben: Das Design System „Lifeline Hub“ muss nicht nachgezogen werden, weil keine
  Rollen, Bausteine oder Dichten geändert werden. Der Claude-Design-Prompt aus dem Ticket bleibt
  als Option für eine spätere Feinform.

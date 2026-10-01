# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- e2e: `mise exec -- pnpm -C <abs>/frontend exec playwright test <datei>`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Geteiltes Gerüst aus dem Organigramm (D4, ohne Verhaltensänderung)

- [ ] 1.1 Test zuerst: `components/organigramm/HaengenderBaum.test.tsx` deckt ab:
  - Wurzeln als Spalten (`data-lfh="org-ebene1"` / `org-spalte`), Kinder senkrecht darunter
  - Klappziel mit `aria-expanded` und `aria-controls` nur, wenn offen
  - Platzhalter `org-klappen-platz` bei Blättern
  - Einzug gedeckelt ab Tiefe 4
  - `inhalt` und `kopf` werden gerendert
  - `klappbareSchluessel` generisch

  Nachweis: rot belegt.
- [ ] 1.2 Umsetzung `components/organigramm/HaengenderBaum.tsx`:
  - `SPALTE_MIN_PX`, `Zweig`, `baumZielStil` und `klappbareSchluessel` wandern aus
    `pages/einsatzabschnitte/Organigramm.tsx` bzw. `fuehrungsorganisation.ts` hierher.
  - Die alten Exporte (`organigrammZielStil`, `SPALTE_MIN_PX`, `klappbareSchluessel`) bleiben als
    Weiterexport, bis keine Datei sie mehr braucht.
  - `OrganigrammBild` nutzt das Gerüst.

  Nachweis: 1.1 grün. `pages/einsatzabschnitte/Organigramm.test.tsx`,
  `OrganigrammOhneZeichen.test.tsx`, `fuehrungsorganisation.test.ts` und
  `EinsatzabschnittePage.test.tsx` bleiben grün, ohne geänderte Zusicherung. `pnpm exec tsc -b` ist
  grün.
- [ ] 1.3 Druck-CSS: `components/organigramm/haengenderBaumPrint.css` übernimmt die Regeln aus
  `organigrammPrint.css`, gebunden an `[data-lfh='druckwurzel'] [data-lfh='org-…']`.
  `organigrammPrint.css` behält nur `.organigramm-no-print`. `organigrammPrint.test.ts` wird auf
  die neue Datei umgestellt, mit unveränderten Zusicherungen. Nachweis: Vitest grün,
  `e2e/fuehrungsorganisation.spec.ts` (Druck bei 680 px) grün.
- [ ] 1.4 Weiterexporte abbauen: Importe auf `components/organigramm/` umstellen. Nachweis:
  `grep -rn "organigrammZielStil" frontend/src` ist leer, `tsc -b` und die Lint-Prüfung sind grün.
- [ ] 1.5 Regel nachziehen: Der Organigramm-Eintrag in `frontend/AGENTS.md` nennt das Gerüst
  `components/organigramm/` (Layout und Druckregeln für Organigramm und Fernmeldeskizze) statt
  „LFH-625 setzt seine Kommunikationsebene darauf“. Nachweis: Prettier-Prüfung über `frontend/`
  grün.

## 2. Regel „gemeinsame Sprechgruppe“ und Lücke (D3, Spec `stab-funkplan` „Lücken“)

- [ ] 2.1 Test zuerst, `stab/luecken.test.ts`, `verbindungsurteil(oben, unten)`:
  - gemeinsame TMO und DMO werden getrennt geliefert
  - keine gemeinsame bei zwei nicht leeren Seiten ergibt `keine`
  - eine leere Seite ergibt `ohne-urteil`
  - gleiche Bezeichnung mit verschiedener `id` gilt nicht als gemeinsam

  Nachweis: rot belegt.
- [ ] 2.2 Test zuerst, `verbindungenOhneGemeinsameSprechgruppe(abschnitte, einheiten)`:
  - die drei Paararten (Unterabschnitt → Abschnitt, oberste Einheit → Abschnitt, Untereinheit →
    Einheit)
  - Waise (übergeordnete Stelle unbekannt) ohne Paar
  - Einheit mit unbekannter übergeordneter Einheit gilt als oberste Einheit ihres Abschnitts
  - Stelle ohne Sprechgruppe zählt nicht
  - Einheiten `gesperrt`/`fehler`/`laden` ergeben „—“, keine Zahl
  - Treffer in Reihenfolge der Quelllisten

  Nachweis: rot belegt.
- [ ] 2.3 Umsetzung beider Funktionen in `stab/luecken.ts`. Typ `Kante` und `Verbindung` stehen
  dort, damit `fernmeldeskizze.ts` nur aus `luecken.ts` importiert. Nachweis: 2.1 und 2.2 grün.
- [ ] 2.4 Test zuerst, dann Umsetzung in `stab/funkplan.ts`:
  - `funkplanLuecken` liefert `verbindungenOhneGemeinsameSprechgruppe`.
  - `rendereFunkplanMarkdown` schreibt die Zeile nach „Einheiten ohne Erreichbarkeit“, als
    `n (unten → oben, …)` bzw. „—“ mit Grund, Namen über `md()`.

  Nachweis: `stab/funkplan.test.ts` rot, dann grün.

## 3. Modell der Skizze (D2, Spec „Knotenaufbau“, „Knoteninhalt“, „Kante“, „Lücke“)

- [ ] 3.1 Test zuerst, `stab/fernmeldeskizze.test.ts`:
  - Die `key`-Struktur ist gleich `baueFuehrungsorganisation` für einen Datensatz mit
    Unterabschnitt, Untereinheit, Waise, Zyklus und Sammelknoten.
  - Je `key` sind `rufname`, `tmo`, `dmo` und `kommunikationsmittel` gleich der Zeile aus
    `baueFunkplan`.
  - Wurzeln und Kinder des Sammelknotens tragen `ohne-urteil`.
  - Die Zahl der `keine`-Kanten ist gleich `treffer.length` der Lücke aus 2.2, für denselben
    Datensatz.
  - `einheiten = null` ergibt nur Abschnitte und `einheitenFehlen`.

  Nachweis: rot belegt.
- [ ] 3.2 Umsetzung `stab/fernmeldeskizze.ts` (`baueFernmeldeskizze`, `SkizzenKnoten`) über
  `baueFuehrungsorganisation`, `teileSprechgruppen`, `kommunikationsmittelLabel` und
  `verbindungsurteil`. Dateikopf mit Verweis auf diese Change. Nachweis: 3.1 grün, `tsc -b` grün.

## 4. Darstellung der Skizze (D5, Spec „Knoteninhalt“, „Kante“, „Einsatzleitung“, „Quellen“, „Ein- und Ausklappen“, „Deeplinks“)

- [ ] 4.1 Vor dem Bau messen, im neuen Block „Skizze“ in `e2e/funkplan.spec.ts`:
  - Contentbreite der Funkplan-Seite bei 1366 × 768 mit offenem Panel
  - Laufweite einer langen Sprechgruppen-Bezeichnung (gesät, ≥ 24 Zeichen) und von
    `⇄ TMO … · DMO …` in Mono 12

  Nachweis: Die Werte stehen als Nachtrag in `design.md` D5. Bestätigt sich `SPALTE_MIN_PX = 300`,
  wird das festgehalten, sonst die Abweichung begründet.
- [ ] 4.2 Test zuerst, `stab/Fernmeldeskizze.test.tsx`:
  - Wurzel „Einsatzleitung“ mit „Gegenstelle nicht erfasst“, ohne Stabsstelle
  - Knoten mit Namenslink (Abschnitt → `einsatzabschnittePfad({abschnitt})`, Einheit →
    `einheitDetailPfad`), Rufname bzw. „kein Rufname“, TMO/DMO, Kommunikationsmittel
  - „keine Sprechgruppe“ als Wort
  - keine Leitung, Stärke oder Erreichbarkeit im DOM
  - Kante `gemeinsam` als `⇄ …`, `keine` als Wort „keine gemeinsame Sprechgruppe“ mit verborgenem
    Zeichen, `ohne-urteil` ohne Kantenzeile
  - Zeichen `aria-hidden`
  - Klappen über das Gerüst

  Nachweis: rot belegt.
- [ ] 4.3 Umsetzung `stab/Fernmeldeskizze.tsx` über `HaengenderBaum`. Farben aus `useRollen`,
  Namenslinks mit `baumZielStil`, `data-lfh="skizze"` und `skizze-kante`. Nachweis: 4.2 grün.

## 5. Seite: Umschalter, Druck, Lücke im Paneel (D1, D6, D7, Spec „Zweite Darstellung“, „Druck“, „Übernahme“)

- [ ] 5.1 Test zuerst, dann Umsetzung in `routing/deeplinks.ts`: `funkplanPfad(id, {ansicht})` und
  `parseFunkplanAnsicht` (nur `tabelle`/`skizze`, sonst `undefined`). Nachweis:
  `routing/deeplinks.test.ts` rot, dann grün.
- [ ] 5.2 Test zuerst, `pages/FunkplanPage.test.tsx`:
  - Umschalter „Tabelle | Skizze“, auch ohne Schreibrecht
  - `?ansicht=skizze` öffnet die Skizze und wird geräumt; `?ansicht=quatsch` wird geräumt, die
    Tabelle bleibt
  - bei gesperrtem Stab und `?ansicht=skizze` die Sperranzeige
  - Druckkopf „Fernmeldeskizze“ bzw. „Funkplan“ je Darstellung
  - „Alle aufklappen/zuklappen“ nur in der Skizze, Klappmengen getrennt
  - der Druckknopf klappt die aktive Darstellung auf
  - Übernahme in beiden Darstellungen mit genau einem POST
  - Abschnitte gesperrt: in der Skizze „Keine Skizze darstellbar — Abschnitte: nicht freigegeben“,
    kein Sammelknoten
  - neue Lückenzeile mit Verweis auf die untere Stelle, „—“ mit Grund bei gesperrten Einheiten

  Nachweis: rot belegt.
- [ ] 5.3 Umsetzung in `pages/FunkplanPage.tsx`:
  - `Segmentleiste` in `aktionen`, Sichtvorgabe anwenden und räumen
  - Druckkopf je Darstellung
  - Werkzeugzeile je Darstellung
  - neue `LueckenZeile`
  - Skizze statt `Datensicht`, wenn „Skizze“ gewählt ist

  Nachweis: 5.2 grün, `tsc -b` und Lint grün.

## 6. Nachweise im Browser und Regeln (D8)

- [ ] 6.1 `e2e/funkplan.spec.ts`, Block „Skizze“:
  - acht Abschnitte mit je drei Einheiten mit je zwei Sprechgruppen bei 1366 × 768 mit Panel:
    mehrere Spaltenzeilen, kein Überhang von Seite, Skizze und Knoten
  - dasselbe bei 1024, 768 und 390 px
  - Lücken-Paneel samt neuer Zeile im ersten Bild bei 1366 × 768
  - Druck bei 680 px mit ausgelöstem `beforeprint`: zugeklappter Abschnitt offen, Druckkopf
    „Fernmeldeskizze“, Klappziele und Umschalter aus, kein Knoten über der Druckwurzel
  - Live: Eine per API einer Einheit zugeordnete Sprechgruppe ihres Abschnitts lässt die Kante ohne
    Neuladen von „keine gemeinsame Sprechgruppe“ zu `⇄ …` wechseln

  Nachweis: grün.
- [ ] 6.2 Gate 1 (`e2e/gate1-ueberlauf.spec.ts`) und Gate 3 (`e2e/gate3-trefflaeche.spec.ts`)
  nehmen `stab/funkplan?ansicht=skizze` auf, als Admin und als Beobachter. Nachweis: beide Specs
  grün, und Gate 3 meldet Namenslinks, Klappziele und Umschalter bei 30/48/72 px.
- [ ] 6.3 Mutationsproben, jede einzeln eingesetzt, rot belegt und zurückgenommen:
  1. `verbindungsurteil` vergleicht Bezeichnungen statt `id`
  2. `ohne-urteil` bei leerer Seite entfällt (gilt dann als `keine`)
  3. Druckkopf immer „Funkplan“
  4. Druckknopf ohne Aufklappen der Skizze
  5. gemeinsame Klappmenge
  6. Skizze mit `abschnitte = []` bei gesperrten Abschnitten
  7. Kante ohne Wort, nur Farbe
  8. Sichtvorgabe nicht geräumt

  Nachweis: Liste mit Ergebnis in `pruefliste.md`.
- [ ] 6.4 `stab/AGENTS.md`: Der Funkplan-Eintrag nennt die Darstellung „Skizze“ (Fernmeldeskizze),
  das Modell `stab/fernmeldeskizze.ts` über `baueFuehrungsorganisation`, die Kante nur über
  `verbindungsurteil` aus `stab/luecken.ts` und den Verweis auf diese Change im Archiv. Nachweis:
  Prettier-Prüfung grün, Verweis zeigt nach `/opsx:archive` auf den Archivpfad.
- [ ] 6.5 `pruefliste.md` dieser Change mit den Kriterien der Prüfliste Einsatztauglichkeit
  (Vorbild LFH-626), Schwerpunkt Fükw und Tablet. Nachweis: Datei vollständig, jedes Kriterium mit
  Verdikt und Beleg.
- [ ] 6.6 `./scripts/check-all.sh` grün (lokal bzw. im CI-Lauf des PRs, mit Verweis darauf).

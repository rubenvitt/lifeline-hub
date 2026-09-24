# Tasks

## 1. Vorbereitung

- [ ] 1.1 Abhängigkeiten im Worktree installieren (`mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend install`) und eine Grundlinie ziehen. `Grundriss.test.tsx`, `GrundrissTabs.test.tsx` und `dichte.guard.test.ts` müssen grün sein, bevor die erste Zeile geändert wird. Belegt ist das durch die Vitest-Ausgabe.

## 2. Reine Funktionen (TDD)

- [ ] 2.1 `platzBedienform(token)` in `pages/uhs/Grundriss.tsx` anlegen, zusammen mit der Konstante `AKTIONSZEILE_HOEHE = 24`. `aktionsabstand` wird entfernt und der `describe`-Block von LFH-378 umgebaut. Die Tests entstehen zuerst und laufen über die Tokens aus `antdToken(…, stufe)` für alle drei Stufen: `kompakt` ergibt `zeile` mit `abstand = marginSM` und einer Zeilenbreite ≤ 124, die beiden anderen Stufen ergeben `karte`. Das Ergebnis muss über zwei Stufen ungleich sein, und für alle Stufen muss gelten: Karte ≥ `controlHeight` in beiden Achsen. Die Bodenwerte stehen als Literale im Test. Mutationsprobe: Ein fester Rückgabewert `zeile` und eine gedeckelte Lücke färben je einen Test rot.
- [ ] 2.2 `platzMenueEintraege({ form, belegt, zuweisbar, bearbeitbar, belegungLaeuft, verfuegbarkeit })` als reine Funktion anlegen. Die Zeilenform liefert das heutige „…“-Menü unverändert, die Kartenform die Reihenfolge aus der Spec: Primäraktion oben, dann Person öffnen, Wartebereich, Verfügbarkeiten, Trenner und Gefahrblock. Tests zuerst, je Spec-Szenario ein Fall: unbelegt, belegt, Bearbeiten-Modus, laufende Belegung (gesperrt statt entfernt), Gefahr hinter dem Trenner. Die Zeilenform bleibt per Gleichheit mit dem Bestand gepinnt.

## 3. PlatzKarte umbauen

- [ ] 3.1 Die Zeilenform auf `platzBedienform` und `platzMenueEintraege` umstellen, ohne Änderung an DOM und Verhalten. Belegt ist das, wenn der gesamte Bestand von `Grundriss.test.tsx` unverändert grün bleibt, dort ohne Theme, also in der Zeilenform.
- [ ] 3.2 Die Kartenform bauen: `Dropdown` mit kontrolliertem `open` um den Kartenknoten, Auszeichnung mit `role`/`tabIndex`/`aria-haspopup`/`aria-expanded`/`aria-label` nach dem dnd-kit-Spread, Tastaturweiche für Enter und Leertaste (im Bearbeiten-Modus nur Enter), Riegel über `popupRender`, keine Aktionszeile, `PersonenkarteDrag` ohne `onOeffnen`. Ohne Schreibrecht öffnet der Tipp bei belegtem Platz direkt die Detailansicht, ein unbelegter Platz ist kein Ziel. Tests zuerst, in einem neuen `describe`-Block mit einem `ConfigProvider` mit `antdToken(…, 'komfortabel')`:
  - Tipp auf unbelegt öffnet das Menü und keinen Zuweisungsdialog, „Patient zuweisen“ öffnet danach den Dialog.
  - Tipp auf belegt öffnet das Menü, „Person öffnen“ öffnet den Drawer.
  - Eine Menüwahl löst weder die Zuweisung aus noch öffnet sie das Menü erneut.
  - Enter und Leertaste öffnen das Menü, im Bearbeiten-Modus nur Enter.
  - Ohne Schreibrecht: belegt → Drawer, unbelegt → kein `role`.
  - Keine Knöpfe in der Karte.
  - Laufende Belegung: gesperrte Einträge.

  Zum Riegel gehört eine Mutationsprobe: ohne `popupRender`-Riegel wird der Riegel-Test rot.
- [ ] 3.3 Den Dateikopf von `Grundriss.tsx` fortschreiben. Die Rechnung 100/102/108 bleibt als Herleitung stehen, der Nachtrag LFH-359 kommt dazu: Kartenform in den Berührungsstufen, Zeilenform nur in `kompakt` mit 24 px als Boden, `aktionsabstand` entfallen. Die Kommentare an `Personenkarte` und am Menü, die „an SCHRITT_Y gedeckelt“ als Grund für einen fehlenden Knopf nennen, werden angepasst. Belegt ist das per Lesen im Diff und damit, dass Gate 4 (`dichte.guard.test.ts`) grün bleibt, denn Kommentare dürfen das Prop-Literal nicht ausschreiben.

## 4. Guards und e2e

- [ ] 4.1 Die Begründung des `OFFEN`-Eintrags in `components/dichte.guard.test.ts` neu schreiben (siehe design.md, Entscheidung 4). Der Guard muss grün bleiben.
- [ ] 4.2 `e2e/uhs-grundriss-touch.spec.ts`: Der Mobil-Test tippt auf die Karte, wählt „Patient zuweisen“ im Menü und nimmt den Rückweg über die Karte und dann „Zurück in den Wartebereich“. Der Kommentar zum „Tipp auf den Titel“ entfällt. Neu dazu kommt ein Messtest für `komfortabel` und `handschuh` (Dichte über localStorage `lifeline-hub.dichte`). Er misst per `boundingBox()`, dass die Karte ≥ Stufe ist, öffnet das Menü **per Tipp** und misst jeden `menuitem` ≥ Stufe. Gegenprobe: Die Karte enthält keinen `button`. Beides muss in `pnpm e2e` für diese Datei grün sein.
- [ ] 4.3 `e2e/uhs-grundriss-menue-belegung.spec.ts` und `uhs-grundriss-dnd.spec.ts` laufen in `kompakt`. Beide ohne Änderung laufen lassen und grün belegen.

## 5. Doku-Nachzug

- [ ] 5.1 `CLAUDE.md:506` und `AGENTS.md:196/582` so fassen, dass die Ausnahme der Platzkarte nicht mehr „an `SCHRITT_Y` gebunden“ ist. Sie ist die Zeilenform in `kompakt` (24 px = Boden), die Berührungsstufen tragen die Kartenform (LFH-359). Der Rest des Absatzes bleibt unverändert. Belegt ist das mit einem Grep auf `SCHRITT_Y` danach: Übrig bleiben nur Stellen, die die Kartengröße begründen, keine, die eine Trefffläche begründen.
- [ ] 5.2 `docs/leitlinien/bedien-leitlinie-herleitungen.md:32/257` fortschreiben: Ausnahme, gedeckelter Abstand und das Entfallen von `aktionsabstand`. In `docs/superpowers/specs/2026-07-30-uhs-grundriss-pruefliste.md` (eingefrorenes Archiv) kommt nur ein datierter Nachtrag „eingelöst durch LFH-359/LFH-379“ an die offenen Zeilen, der alte Text bleibt stehen.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` vollständig grün, ohne `| tail`. Mit `prettier --write` bis zum Fixpunkt formatieren.
- [ ] 6.2 Prüfliste Einsatztauglichkeit (15 Kriterien) für den umgebauten Grundriss als Nachtrag an `2026-07-30-uhs-grundriss-pruefliste.md`. Jede Zeile trägt ein Verdikt.
- [ ] 6.3 Im Browser sichtprüfen, in `komfortabel` und `handschuh`: Das Menü steht an der Karte, der Layout-Zug im Bearbeiten-Modus läuft, und das Ziehen einer Person aus der Karte öffnet kein Menü. Belegt ist das per Screenshot.

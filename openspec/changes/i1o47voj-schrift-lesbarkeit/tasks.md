# Tasks

Gegliedert nach Unteraufgabe (`<kurz>` = erste 8 Zeichen der Zunder-ID). Jede Aufgabe entsteht per
TDD: erst der rote Test oder Wächter, dann die Änderung. LLH-1772 (`zrrpki0p`, Schrift-Reset in
`index.css`) ist vorher im selben Branch erledigt und gehört nicht zu dieser Change.

## 1. Skala festlegen — LLH-1775 `t4yjm0uk` und LLH-1773 `uqnkhwzl`

- [x] 1.1 `groessenstufen` (fein 11, klein 12, text 14, titel 16, wert 22, gross 32) in `theme/tokens.ts`; `schriftskala` nennt je Rolle eine Stufe, neue Rollen `uhr`, `warnung`, `etikett`, `meta` in der Textschrift, Augenbraue .08em, Rail-Etikett .04em. Beleg: `tokens.test.ts` pinnt die Werte als Literal (Quelle „umgekehrt 15.11.2026“) und ist vorher rot.
- [x] 1.2 `rollen.css` spiegelt Stufen und Rollen als `--lfh-typo-*`; `rollen.guard.test.ts` hält Partition und Gleichheit beider Seiten. Beleg: Wächter grün, mit einem absichtlich abweichenden Wert rot.
- [x] 1.3 `schriftStil(rolle)` und `zahlStil(stufe, gewicht)` in `rollenwerte.ts` geben `fontSize: var(--lfh-typo-…)` und `tabular-nums` zurück; `schriftPx(stufe, dichte)` liefert die Zahl. Beleg: Unit-Tests der drei Helfer.
- [x] 1.4 Bausteine `Schrift` und `Feldetikett` in `components/instrument/` samt `index.ts`, Dateikopf mit Regel, Karten in `PREVIEWS` (Nacht und Tag). Beleg: Komponententests (Element, Stil, Ton).

## 2. Kopplung an die Dichte und freier Zoom — LLH-1774 `k12gzfsa`

- [x] 2.1 `--lfh-schrift-faktor` 1 / 1,15 / 1,25 in `rollen.css`, die Größen von fein bis titel als `calc(…)`, wert und gross fest; `dichteFaktor` in `tokens.ts`, vom Wächter gleich gehalten. Beleg: `rollen.guard.test.ts`, `dichte.test.ts`.
- [x] 2.2 `antdToken(…, dichte)` setzt `fontSize`, `fontSizeSM/LG/XL` und `fontSizeHeading1–5` aus Stufe mal Faktor; `dichten.*.schriftgroesse` wird abgeleitet; Kommentare zu 13,5/21,5/35,5 und die Kontrastbegründung des Primärknopfs nachgezogen. Beleg: `tokens.test.ts` (14 / 16,1 / 17,5), `bedienKontrast.test.ts` grün.
- [x] 2.3 Viewport in `index.html` ohne `maximum-scale` und `user-scalable=no`; `keinZoom.guard.test.ts` wird `zoomFrei.guard.test.ts`. Beleg: Wächter vorher rot.
- [ ] 2.4 Brotkrume liest die Stufe `klein` (`EinsatzSeite.css`, `ortspfadStil`); e2e `PFAD_SCHRIFT` erwartet 12 / 15 px je Stufe, Seitenkopf in `kompakt` 44 px. Beleg: betroffene e2e-Specs grün.

## 3. Literal-Wächter und Migration des Bestands — LLH-1775 `t4yjm0uk`, LLH-1773 `uqnkhwzl`, LLH-1777 `oec0vmz1`

- [x] 3.1 `theme/schriftLiteral.guard.test.ts` (Regeln aus design.md, Entscheidung 4) und `fernsicht` als benannte Skala im Theme (Lagemonitor). Beleg: Wächter meldet den Bestand mit Datei und Zeile, ohne Ausnahmeliste.
- [x] 3.2 `refactor`-Commit: `monoStil` → `zahlStil` mit Stufe statt Pixelzahl. Beleg: `tsc` grün, kein `monoStil(` mehr.
- [x] 3.3 Migration Kern und Rahmen: `components/` (inkl. `instrument/`, `anzeige/`), `Kopfleiste.tsx` (Uhr Rolle `uhr`, Rail-Etikett), `pages/` außer Lagekarte, `routes`, `hilfe/Hilfe.css`, `Markdown.css`, `LoginPage.css`, `EinsaetzePage.css`, `theme/sprache.css`. Beleg: Wächter für diese Pfade leer, Unit-Tests der Bereiche grün.
- [x] 3.4 Migration Einsatzmodule I: `etb/`, `einsatz/`, `personen/`, `betreuung/`, `verpflegung/`, `kraefte/`, `abloesung/`, `fuehrung/`. Beleg: wie 3.3.
- [x] 3.5 Migration Einsatzmodule II: `fernmeldewesen/`, `infotelefon/`, `lagebesprechung/`, `lage/`, `lageberichte/`, `lagemeldungen/`, `meldungen/`, `nachforderungen/`, `auftraege/`, `befehle/`, `pages/lagekarte/`, `geraet/`, `wetter/`, `pegel/`. Beleg: wie 3.3.
- [x] 3.6 Migration Rest: alle übrigen Verzeichnisse unter `frontend/src` (`admin/`, `stammdaten/`, `alarm/`, `dokumente/`, `entwurf/`, `neuigkeiten/` …). Beleg: Literal-Wächter ganz grün.
- [x] 3.7 Warnhinweise auf die Rolle `warnung` (Warnstufen-Marke, `GefahrenStufe`, `WetterKopfMarke`, `Sammelbanner`, `Filterhinweis`, Alarmhinweise). Beleg: Unit-Test je Baustein auf die Rolle.

## 4. Versalien nur in Köpfen — LLH-1776 `bymbxu4u`

- [x] 4.1 `Datenfeld`, `DatenfeldEingabe` und `FeldLabel` tragen das `Feldetikett`; `'dt'` fällt aus `AugenbraueElement`; Dateikopf der Augenbraue auf Köpfe eingeengt. Beleg: Komponententests, `tsc`.
- [x] 4.2 Die übrigen Augenbrauen sichten: Feld benennende werden `Feldetikett`, Köpfe bleiben; lokale Etikett-Stile (Einsatzdaten `KopfAngabe`, Inspector) mit. Beleg: Liste der Stellen im Commit; e2e der Augenbrauen-Kontrastmessung auf einer verbleibenden Augenbraue grün.

## 5. Mono-Grenze — LLH-1777 `oec0vmz1`

- [x] 5.1 Meta-Slots in der Textschrift (`paneelMetaStil`, `seitenMetaStil`, Datenstand, Zeitachseneintrag, `ListenPaneel`, Schnellerfassung, `Sammelbanner`, `Aufgliederung`); Kennungen und Funkrufnamen in Mono, Funkrufnamen mit `data-schrift="kennung"`. Beleg: Komponententests auf die Familie.
- [ ] 5.2 e2e `schrift-mono-grenze.spec.ts`: auf Überblick, ETB, Einsatzdaten und Betroffenen kein Mono-Textknoten mit einem Wort aus vier oder mehr Kleinbuchstaben außerhalb von `data-schrift="kennung"`. Beleg: Spec grün, vor 5.1 rot.

## 6. Messung und Nachweis über das Epic

- [ ] 6.1 e2e `schrift-skala.spec.ts`: auf fünf Kernseiten in `kompakt` nur Größen aus {11, 12, 14, 16, 22, 32}, nichts unter 11 px, Seitentitel 16 und Lauftext 14; in `handschuh` Chip und Knopf das 1,25-Fache; Anteil unter 12 px je Stufe nicht steigend. Beleg: Spec grün.
- [ ] 6.2 Rail-Etikett in 11 px ohne Überlauf in der 60-px-Rail (`rail-etikett.spec.ts`), Seitenkopf auf 390 px, Trefffläche-Gates (`gate3-trefflaeche`, `trefflaeche-pruefflaechen`) in allen drei Stufen. Beleg: Specs grün.
- [x] 6.3 `frontend/AGENTS.md`: `schriftskala` mit Stufen, Faktor und Literal-Verbot; „Kein Zoom“ ersetzt durch „Zoom frei“; Feldetikett und Augenbraue; Mono-Grenze; je mit Marke „umgekehrt 15.11.2026“ gegenüber dem Neuentwurf. Beleg: Prettier grün, Verweise auf `keinZoom.guard` gegrept und nachgezogen.
- [x] 6.4 Design System neu erzeugen (`mise exec -- pnpm -C frontend design-system`), Erzeugtes im Commit. Beleg: `designSystem.guard.test.ts` grün.
- [ ] 6.5 Folgeaufgabe für den Bildlauf der Anwender-Doku über `zunder-task-anlegen`, falls `docs/anwender/AGENTS.md` ihn nicht im selben PR verlangt. Beleg: Link im PR.
- [ ] 6.6 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, betroffene e2e-Specs lokal grün. Beleg: Ausgabe im PR unter „Geprüft“.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Skelett „Review-find-verify“).
- `/opsx:archive i1o47voj-schrift-lesbarkeit` im selben Branch vor dem PR.
- Nach dem Merge: Design System veröffentlichen (`frontend/AGENTS.md`).

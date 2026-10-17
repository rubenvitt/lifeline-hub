# Tasks

Jede Aufgabe entsteht per TDD (`superpowers:test-driven-development`). Zonentests sind nur
scharf, wenn Browser- und Anzeigezone verschieden sind: `test/prozessZone.ts` stellt die
Prozesszone auf UTC, Anzeigezone Europe/Berlin. „Mutationsprobe“ heißt: die geprüfte Regel im
Code vorübergehend umdrehen, der Test muss rot werden. Node und pnpm über `mise exec -- …`.

## 1. Kern: Sprache, Schreibweise, Parser (`anzeige/`)

- [x] 1.1 `import 'dayjs/locale/de'` in `anzeige/dayjsSprache.ts`, das der Kalender selbst
      importiert (gilt so auch ohne `main.tsx`, in Tests und Druckfenstern); ein Test rendert antds
      `Calendar` unter `ConfigProvider locale={deDE}` und findet „Mo“ als erste Wochentagsspalte.
      Erledigt, wenn der Test grün ist und ohne den Import rot wird.
- [x] 1.2 DTG nach E1 in `anzeige/format.ts` (Tag, Stunde, Minute, Monat klein ohne Umlaut, Jahr
      zweistellig), Fundstelle DV 810.3 im Kommentar (weicht sie ab: Kommentar an LLH-1045, E1
      bleibt). `format.test.ts`: `161430mrz26` für 2026-03-16 13:30 UTC in Europe/Berlin, alle
      zwölf Monatskürzel, Jahreswechsel. Bestehende Formatierer unverändert grün.
- [x] 1.3 `anzeige/zeitParser.ts` mit `deuteZeit` nach D2. `zeitParser.test.ts` deckt jede
      Schreibweise der Spec ab (Uhrzeit, `TTHHMM`, DTG mit 0/2/4 Jahresziffern, Groß/klein,
      `mrz`/`mär`, `TT.MM.[JJ|JJJJ] HHMM`, ISO mit Sekunden, `j`, `jetzt`, `-5`, `-5m`, `-1h`,
      `+90`), die Richtungsregeln (Ereignis kurz nach Mitternacht, Frist am Abend, Monatswechsel
      am 1.11., `keineZukunftstage` ohne `art`), `bezug` (Ende am Tag des Beginns, Folgetag),
      die Sommerzeitgrenzen 29.03. und 25.10.2026 und jeden Grund („Uhrzeit gibt es nicht“ für
      `2460`, „Tag gibt es nicht“ für `311430nov26`, fünf Ziffern unlesbar). Mutationsprobe auf
      die Ereignis-Regel.

## 2. Schnellwahl-Tabelle

- [x] 2.1 `anzeige/zeitSchnellwahl.ts` nach D6 (Ereignis und Frist, `schnellwahlZeit`,
      Auswahl wirft bei unbekannter Minutenzahl); `components/terminSchnellwahl.ts` samt Test
      zieht hierher um, die Aufrufer `etb/WiedervorlageModal.tsx`,
      `lagebesprechung/TerminPaneel.tsx`, `lagebesprechung/LagebesprechungModal.tsx` importieren
      von hier. Erledigt, wenn `zeitSchnellwahl.test.ts` und die Tests der drei Aufrufer grün sind.

## 3. Baustein

- [x] 3.1 Testhelfer `test/zeitEingabe.ts` (`tippeZeit(feld, text)`: leeren, tippen, Enter;
      `zeitFeld(name)`), selbst getestet an einem Minimalformular.
- [x] 3.2 `ZeitpunktEingabe` neu nach D1, D3, D4, D8: Mono-`Input`, Anzeige als DTG,
      Deutung/Grund als Suffix mit `aria-describedby`, Enter/Verlassen/Escape/Leeren,
      `onChange` nur bei anderem Instant, `onOk` bei ausdrücklicher Übernahme, Zonenhinweis wie
      bisher. `ZeitpunktEingabe.test.tsx` neu: jedes Szenario der Spec-Anforderungen „Eingabe
      als Text“, „Unlesbare Eingabe wird nicht übernommen“, „Anzeige im Feld als
      Datum-Zeit-Gruppe“, dazu die bisherigen Szenarien Anzeigezone, unverändertes Speichern und
      Zonenhinweis unter TZ=UTC. Typprüfung: `format` am Baustein ist ein Fehler.
- [x] 3.3 `anzeige/ZeitKalender.tsx` nach D5 mit Popover/Blatt-Weiche (`zeitPanelAmFeldAb`,
      `ZeitpunktEingabe.css` auf den neuen Container umgestellt): Tag wählen, Uhrzeit tippen,
      Enter/„Übernehmen“, Schnellwahl der Feldart, gesperrte Zukunftstage, `onOpenChange`.
      Tests: Szenarien „Wochenbeginn“, „Anderer Tag, andere Uhrzeit“, Blatt unter `md` und in
      `handschuh`, Escape schließt nur den Kalender.
- [x] 3.4 Schnellwahl am Feld (Prop `schnellwahl`) nach D6; Test „Minus fünf Minuten“ mit
      vorgehender Geräteuhr (Serveruhr-Versatz gesetzt).
- [x] 3.5 `ZeitraumEingabe` aus zwei Feldern nach D7 und `nurTag` nach D8. Tests: Szenarien
      „Mittag“ und „Über Mitternacht“, Tupel-Wert im Formular, `nurTag` zeigt `TT.MM.JJJJ`.
- [x] 3.6 Wächter nach D9: `zeitEingabe.guard.test.ts` angepasst, das Kalender-Token in
      `theme/tokens.ts` mit `auswahlKontrast.test.ts`; beide grün, und ein probeweise eingefügter `DatePicker`-Import außerhalb wie
      innerhalb von `anzeige/` macht den Guard rot.

## 4. Aufrufer umstellen (je Gruppe Props streichen, `art` setzen, Tests auf `tippeZeit`)

- [x] 4.1 ETB: `etb/MetaChip.tsx` (Ereignis, `schnellwahl`, `onOk`, `ref`), `etb/EtbFilterleiste.tsx`
      (ohne Art), `etb/WiedervorlageModal.tsx` (Frist). Tests `MetaChip`, `EtbFilterleiste`,
      `WiedervorlageModal` grün; neu: im Chip „1425“ + Enter übernimmt ohne Maus.
- [x] 4.2 Inline-Zeilen: `components/InlineAngabe.tsx` (Vertrag unverändert, Test für Enter
      und doppeltes Escape mit offenem Kalender), `pages/EinsatzdatenPage.tsx`,
      `pages/EinsatzleiterAngabe.tsx`, `stab/skizze/Eigenschaftspaneel.tsx`,
      `pages/EinsaetzePage.tsx`. Die Spec-Szenarien von `einsatzdaten-bearbeitung` („Zeitpunkte
      ohne Zonenversatz“) bleiben grün.
- [x] 4.3 Meldung, Auftrag, Erinnerung, Lagebesprechung: `meldungen/MeldungFormular.tsx`,
      `auftraege/AuftragFormular.tsx` (erteilt: Ereignis, Frist: Frist),
      `erinnerung/ErinnerungFormular.tsx`, `lagebesprechung/LagebesprechungModal.tsx`,
      `lagebesprechung/TerminPaneel.tsx`; deren Tests grün.
- [x] 4.4 Kräfte, Ablösung, Betreuung, Personen, Verpflegung: `kraefte/KraftZeitachse.tsx`,
      `abloesung/AbloesungDialoge.tsx`, `betreuung/BetreuungDialoge.tsx`,
      `personen/LagedatenFelder.tsx`, `verpflegung/VerpflegungDialoge.tsx` (Zeitraum und
      Ausgabe), `verpflegung/TagAusVorlage.tsx` (`nurTag`); Tests inkl.
      `PersonErfassungModal`, `VerpflegungPage` grün; der Verpflegungs-Zeitraum aus dem
      Screenshot (Beginn „1200“, Ende „1330“) als eigener Test.
- [x] 4.5 Lagebericht, Presse, Infotelefon: `pages/LageberichtePage.tsx`,
      `pages/LageberichtDetailPage.tsx`, `pages/PressePage.tsx`,
      `pages/PressemitteilungDetailPage.tsx`, `infotelefon/AnrufErfassung.tsx`; Tests grün.
- [x] 4.6 Einstellungen, Aufbewahrung, Zugangsprotokoll:
      `pages/einstellungen/PegelPrognoseModal.tsx`, `pages/einstellungen/EinsatzGeraete.tsx`,
      `aufbewahrung/WiederherstellenDialog.tsx`, `aufbewahrung/KategorieFristen.tsx`,
      `aufbewahrung/FristPaneel.tsx`, `zugangsprotokoll/ZugangsprotokollPage.tsx`; Tests grün,
      das nicht mehr nötige `customParseFormat` in den Aufbewahrungs-Tests entfernt.
- [x] 4.7 `grep -rn "format=" frontend/src` an Zeitfeldern leer, `mise exec -- pnpm typecheck`
      und `mise exec -- pnpm lint` grün, `mise exec -- pnpm test` vollständig grün.

## 5. e2e

- [x] 5.1 `e2e/einsatzdaten-inline.spec.ts`, `e2e/lagebesprechung.spec.ts`,
      `e2e/betroffene-kontrast.spec.ts` auf `fill('…')` + Enter mit taktischer Eingabe.
- [x] 5.2 `e2e/dialoge-handy.spec.ts` und `e2e/zeitraum-kontrast.spec.ts` auf den neuen
      Kalender (Blatt im Bildschirm, Tag, Uhrzeit, „Übernehmen“), `e2e/gate3-trefflaeche.spec.ts`
      misst Feld, Kalender-Knopf und Schnellwahl (≥ 72 px in `handschuh`). Lauf in der CI;
      lokal, soweit der Dev-Stack in der Sitzung startet.

## 6. Regel und Doku

- [x] 6.1 `frontend/AGENTS.md` „Zeiteingabe in der Anzeigezone“ fortschreiben (Parser als eine
      Deutung, Feldart, Schnellwahl-Tabelle, kein `format`, Kalender nur in `anzeige/`,
      Testhelfer); Prettier über `frontend/` grün.
- [x] 6.2 Anwenderdoku: die Kapitel mit Zeitfeldern (`docs/anwender/kapitel/`: einsatztagebuch,
      lagebesprechung, erinnerungen, auftraege-befehle, verpflegung u. a.) beschreiben Tippen,
      Kurzformen und Schnellwahl einmal zentral und verweisen darauf; Bilder mit Zeitfeldern nach
      `docs/anwender/AGENTS.md` neu erzeugen oder als offen an LLH-1077 melden. Wächter der Doku
      grün.

## 7. Abschluss

- [x] 7.1 `./scripts/check-all.sh` (Bündel `schnell`) grün; Review über Bugs, Zonen,
      Tastaturvertrag und Tests (`superpowers:requesting-code-review`), bestätigte Findings
      behoben.

## Workflow follow-up

- `/opsx:archive` samt Spec-Sync im selben Branch, dann PR gegen `alpha` mit
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/ri685cfizfye4o9g1rj5qgwb`.
- LLH-1077 auf das schneiden, was hier nicht schon erledigt ist (Kommentar), LLH-1053 bleibt
  nächster Schritt; Design System „Lifeline Hub“ um den Baustein nachziehen (LLH-1147).

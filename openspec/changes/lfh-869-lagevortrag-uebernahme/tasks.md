# Tasks

Gegliedert nach Unteraufgabe. Jede Aufgabe per TDD (Test zuerst rot, dann grün). Pfade relativ zu
`frontend/src/`.

## 1. Baustein und Medienlage (LFH-870, Teil 1)

- [ ] 1.1 Tests zuerst in `lageberichte/uebernahme/uebernahmen.test.ts`: `uebernahmeFuer('lagebericht', 'medienlage')` liefert eine Quelle, `uebernahmeFuer('lagebericht', 'auftrag' | 'antraege_vorschlaege' | 'zusammenfassung')` und jeder Abschnitt von `lagebeurteilung` und `freitext` liefern `undefined`; jeder Schlüssel der Tabelle existiert in `VORLAGEN` (Schutz gegen Tippfehler). Verifikation: rot, Datei fehlt.
- [ ] 1.2 `lageberichte/uebernahme/uebernahmen.ts` mit Typ `UebernahmeQuelle` (`knopf`, `herkunft`, `module`, `laden`) und Tabelle nach design.md D1; Medienlage als erster Eintrag (`module: ['stab']`, `laden` aus dem bisherigen `MedienlageUebernahme`). Verifikation: 1.1 grün.
- [ ] 1.3 Tests zuerst in `lageberichte/uebernahme/AbschnittUebernahme.test.tsx` (aus `stab/MedienlageUebernahme.test.tsx` übernommen und erweitert): leer → einsetzen ohne Rückfrage, gefüllt → Modal, Abbrechen lässt Text und Geändert-Merker unverändert; Freigaben laden → Knopf gesperrt; Freigaben gescheitert → Hinweis mit „Erneut versuchen“; kein Modul frei → Hinweis mit Modulnamen, kein Knopf; vor dem Klick kein Listenabruf (msw zählt Anfragen). Verifikation: rot.
- [ ] 1.4 `AbschnittUebernahme.tsx` nach D1/D3; `stab/MedienlageUebernahme.tsx` und sein Test entfallen. Verifikation: 1.3 grün.
- [ ] 1.5 Hilfen für Stand und Freigaben: `uebernahme/stand.ts` (`standAusQuellen(qc, keys)` über `gemeinsamerDatenstand` + `taktischeDtgVoll`) und eine Lade-Hilfe, die gesperrte Module nicht anfragt und `AbrufZustand` je Quelle liefert (`gesperrt` statt 403-Fehler). Tests: Stand ist der älteste `dataUpdatedAt`, gesperrtes Modul ergibt `gesperrt` ohne Anfrage. Verifikation: Unit-Tests grün.
- [ ] 1.6 Medienlage-Text beginnt mit `**Stand:** <DTG>` (Spec `stab-medienlage`): Test in `stab/medienlage.test.ts` bzw. im Quellen-Test erweitern, dann umsetzen. Verifikation: grün; `PressePage` zeigt die Medienlage weiter ohne Stand-Zeile (dortiger Test unverändert grün).
- [ ] 1.7 `LageberichtDetailPage.tsx`: `abschnittsEditor` hängt `AbschnittUebernahme` über `uebernahmeFuer(vorlage, a.schluessel)` ein, Vorlage in den `useCallback`-Abhängigkeiten. Test in `pages/LageberichtDetailPage.test.tsx`: Knopf nur im Schreibzweig, kein Knopf in `lagebeurteilung`, Medienlage ohne Stab-Freigabe zeigt den Hinweis. Verifikation: grün; `e2e/lagebericht-tippen.spec.ts` unverändert.

## 2. Gemeinsame Lagebild-Quellen und Eigene Lage (LFH-870, Teil 2)

- [ ] 2.1 Tests zuerst: aus denselben Rohdaten ergeben Hook-Pfad (`useLagebild`) und Lade-Pfad (`ladeLagebasis`) dieselbe `Lagebasis` und dieselben Zustände je Quelle, auch mit gesperrtem Modul. Verifikation: rot.
- [ ] 2.2 `LAGEBILD_QUELLEN` (Key, Abruf, Modul) aus `pages/lage-dashboard/useLagebild.ts` herausziehen; `useLagebild` baut daraus, `ladeLagebasis(qc, einsatzId, freigaben)` lädt per `fetchQuery` (D2). Verifikation: 2.1 grün, `useLagebild`-, Dashboard- und Vorbereitungs-Tests unverändert grün.
- [ ] 2.3 Tests zuerst in `lageberichte/uebernahme/eigeneLage.test.ts` für `eigeneLageMarkdown`: Gesamtstärke gleich `baueLagebild(...)`-Kennzahl „Kräfte“ (gleiche Rohdaten, gleicher Wert und `staerkeText`), Stärke je oberstem Abschnitt, Fahrzeuge nach Verfügbarkeit, Material nur bei defekt/verbraucht > 0, Gliederung mit Rufname/„kein Rufname“ und „Leitung besetzt“/„Leitung nicht besetzt“, Stab als Kürzel, **kein** Name aus Personal, Leitung oder Stab-Besetzung im Text (Fixture mit Namen, `not.toContain`), gesperrte Quellen „— (nicht freigegeben)“, keine `#`-Zeile. Verifikation: rot.
- [ ] 2.4 `eigeneLageMarkdown` nach D4/D5 über `baueKraeftebild` und `baueFuehrungsorganisation`; Eintrag „Eigene Lage“ in der Tabelle (Module: `einheiten`, `personal`, `fahrzeuge`, `material`, `einsatzabschnitte`, `stab`). Verifikation: 2.3 grün, 1.1 um den Eintrag erweitert grün.

## 3. Besondere (Führungs-)Probleme (LFH-871)

- [ ] 3.1 Die Lücken-Zeilen aus `rendereFunkplanMarkdown` als `funkplanLueckenZeilen(luecken, quellen)` herauslösen; `stab/funkplan.test.tsx` bleibt unverändert grün (Funkplan-Freitext identisch). Dazu `ladeFunkplanQuellen(qc, einsatzId, freigaben)` mit denselben Keys und Modulen wie `FunkplanPage`; Test: gesperrtes Modul → `gesperrt` ohne Anfrage. Verifikation: grün.
- [ ] 3.2 Tests zuerst in `lageberichte/uebernahme/fuehrungsprobleme.test.ts`: Zahl überfällig aus dem Modulzähler, Liste aus `listeAuftraege` mit genau den Aufträgen der Fixture-Regel (`tests/fixtures/verdichtung/regeln.json`), „Nr. · Frist“ ohne Auftragstext und Empfänger; Meldungen mit überfälliger Bestätigung über `istAlarmiert` als „Nr. · Art · Frist“, „noch nicht gesichtet“ aus `ungesehen`; Funkplan-Lücken im Wortlaut der Funkplan-Seite; „keine“ je Teil ohne Befund; gesperrte Teile „— (nicht freigegeben)“; Freitext-Felder der Fixtures kommen nicht vor. Verifikation: rot.
- [ ] 3.3 `fuehrungsproblemeMarkdown` und Eintrag „Besondere (Führungs-)Probleme“ (Module: `auftraege`, `meldungen`, `stab`, `einsatzabschnitte`, `einheiten`) nach D6. Verifikation: 3.2 grün.

## 4. Gefahren-/Schadenlage (LFH-872)

- [ ] 4.1 Die Formatierer der Vorbereitung (`sichtungText`, Warnstufen-Zeile, Vermisste mit Notiz) aus `stab/vorbereitung.ts` exportieren bzw. in eine gemeinsame Datei legen; `stab/vorbereitung.test.ts` unverändert grün. Verifikation: grün.
- [ ] 4.2 Tests zuerst in `lageberichte/uebernahme/schadenlage.test.ts`: Betroffene, Vermisste, Sichtung, Schäden offen und Warnstufe gleich der Vorbereitung aus denselben Rohdaten; Wetterwarnungen geltend/angekündigt über `teileWarnungen`, abgelaufene fehlen; „kein Einsatzort“ und „— (Ausfall)“ je `zustand`; Pegel je Station über `pegelZeile` in Reihenfolge, „keine maßgeblichen Pegel festgelegt“ bei leerer Liste; `wetter-pegel` gesperrt → Wetter „— (nicht freigegeben)“, Pegel trotzdem da. Verifikation: rot.
- [ ] 4.3 `schadenlageMarkdown` und Eintrag „Gefahren-/Schadenlage“ (Module: `personen`, `schaeden`, `gefahrenzonen`, `wetter-pegel`) nach D7, Lagebild über `ladeLagebasis`. Verifikation: 4.2 grün.

## 5. Lageentwicklung (LFH-873, Variante nach D8)

- [ ] 5.1 Tests zuerst in `lageberichte/uebernahme/lageentwicklung.test.ts`: Grenze nach `lfd_nr` des Eintrags der letzten Lagebesprechung (nachgetragener Eintrag mit früherer Ereigniszeit zählt), `system` und `lage` mit `lagebericht_id` ausgenommen, Zahl je Typ, Entscheidungen „Nr. · DTG“ ohne Wortlaut (höchstens 20, „und n weitere“), „seit Einsatzbeginn“ ohne Lagebesprechung, Cursor-Abruf endet an der Grenze (msw zählt Seiten); `inhalt`, `von`, `an`, `erfasser_name` der Fixtures kommen nicht vor. Verifikation: rot.
- [ ] 5.2 `lageentwicklungMarkdown` und Eintrag „Lageentwicklung“ (Module: `etb`, `stab`) nach D8. Verifikation: 5.1 grün.

## 6. Regeln, Durchstich und Abschluss

- [ ] 6.1 `frontend/src/entwurf/AGENTS.md`: Abschnitt „Übernahme in den Lagevortrag“ nach D9; `frontend/src/stab/AGENTS.md` (S5-Absatz) verweist darauf; Code-Kommentare verweisen auf Datei und Abschnitt. Verifikation: `prettier --check` über `frontend/` grün, `grep -rn "MedienlageUebernahme" frontend/src` leer.
- [ ] 6.2 e2e-Durchstich in `e2e/` (bestehende Lagebericht-Spec erweitern): Entwurf „Lagevortrag zur Information“ öffnen, „Eigene Lage“ übernehmen, Text mit Stand steht im Abschnitt, gefüllten Abschnitt erneut übernehmen → Rückfrage. Verifikation: Spec grün unter `frontend/e2e/AGENTS.md`.
- [ ] 6.3 Gesamtlauf `./scripts/check-all.sh` (bzw. die in der Sitzung lauffähigen Bündel: Prettier, ESLint, `tsc -b`, Vitest, Rust-Tests) grün; was nur die CI belegt, mit Verweis auf den Lauf abhaken.

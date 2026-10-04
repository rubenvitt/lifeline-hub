# Tasks

Setzt auf LFH-870 (`lfh-870-eigene-lage-uebernahme`) auf: vor 1.1 `alpha` mit LFH-870 in diesen
Branch mergen (design.md D6). Jede Aufgabe per TDD (Test zuerst rot). Pfade relativ zu
`frontend/src/`.

## 1. Gemeinsame Quellen

- [ ] 1.1 Tests zuerst: aus denselben Rohdaten ergeben `useLagebild` und `ladeLagebasis` dieselbe `Lagebasis` und dieselben Zustände je Quelle, auch mit gesperrtem Modul (das gesperrte Modul wird im Lade-Pfad nicht angefragt, msw zählt). Verifikation: rot.
- [ ] 1.2 `LAGEBILD_QUELLEN` aus `pages/lage-dashboard/useLagebild.ts` herausziehen, `ladeLagebasis(qc, einsatzId, freigaben)` nach design.md D1 (inklusive Stand je Quelle), Listen über `ladeListe` aus LFH-870. Verifikation: 1.1 grün, Tests von `useLagebild`, Dashboard und Vorbereitung unverändert grün.
- [ ] 1.3 `ladeFunkplanQuellen(qc, einsatzId, freigaben)` mit denselben Keys und Modulen wie `FunkplanPage`; `funkplanLueckenZeilen(luecken, quellen)` aus `rendereFunkplanMarkdown` herauslösen. Verifikation: Test „gesperrt ohne Anfrage“ grün, `stab/funkplan.test.tsx` unverändert grün (Funkplan-Freitext wörtlich gleich).
- [ ] 1.4 Formatierer der Vorbereitung (`sichtungText`, Warnstufen-Zeile, Vermisste mit Notiz) exportieren. Verifikation: `stab/vorbereitung.test.ts` unverändert grün.

## 2. Besondere (Führungs-)Probleme (LFH-871)

- [ ] 2.1 Tests zuerst in `lageberichte/uebernahme/fuehrungsprobleme.test.ts`: Zahl überfällig aus dem Modulzähler, Liste genau nach der Fixture-Regel (`tests/fixtures/verdichtung/regeln.json`) als „Nr. · Frist“, älteste Frist zuerst; Meldungen über `istAlarmiert` als „Nr. · Art · Frist“, „noch nicht gesichtet“ aus `ungesehen`; Funkplan-Lücken wörtlich wie `funkplanLueckenZeilen`; „keine“ je Teil ohne Befund; gesperrte Teile „— (nicht freigegeben)“; erste Zeile `**Stand:**`; Freitext der Fixtures (`auftrag_text`, `inhalt`, `absender`, `empfaenger`) kommt nicht vor. Verifikation: rot.
- [ ] 2.2 `fuehrungsproblemeMarkdown` und Quelle „Besondere (Führungs-)Probleme“ in `lageberichte/uebernahmen.ts` nach D2/D3. Verifikation: 2.1 grün; Zuordnungstest von LFH-870 um den Abschnitt erweitert grün.

## 3. Gefahren-/Schadenlage (LFH-872)

- [ ] 3.1 Tests zuerst in `lageberichte/uebernahme/schadenlage.test.ts`: Betroffene, Vermisste, Sichtung, Schäden offen und Warnstufe gleich der Vorbereitung aus denselben Rohdaten; Warnungen geltend/angekündigt über `teileWarnungen`, abgelaufene fehlen; „kein Einsatzort“ bzw. „— (Ausfall)“ je `zustand`; Pegel je Station über `pegelZeile` in Reihenfolge, „keine maßgeblichen Pegel festgelegt“ bei leerer Liste; `wetter-pegel` gesperrt → Wetter „— (nicht freigegeben)“, Pegel trotzdem da; keine Personen- oder Schadensfelder im Text. Verifikation: rot.
- [ ] 3.2 `schadenlageMarkdown` und Quelle „Gefahren-/Schadenlage“ nach D2/D4, Lagebild über `ladeLagebasis`. Verifikation: 3.1 grün.

## 4. Lageentwicklung (LFH-873, Variante nach D5)

- [ ] 4.1 Tests zuerst in `lageberichte/uebernahme/lageentwicklung.test.ts`: Grenze nach `lfd_nr` des Eintrags der letzten Lagebesprechung (nachgetragener Eintrag mit früherer Ereigniszeit zählt), `system` und `lage` mit `lagebericht_id` ausgenommen, Zahl je Typ, Entscheidungen „Nr. · DTG“ ohne Wortlaut (höchstens 20, „und n weitere“), „seit Einsatzbeginn“ ohne Lagebesprechung, Seitenabruf endet an der Grenze (msw zählt Seiten); `inhalt`, `von`, `an`, `veranlassung` der Fixtures kommen nicht vor. Verifikation: rot.
- [ ] 4.2 `lageentwicklungMarkdown` und Quelle „Lageentwicklung“ nach D2/D5. Verifikation: 4.1 grün.

## 5. Regeln und Abschluss

- [ ] 5.1 Abschnitt zum Baustein in `frontend/src/entwurf/AGENTS.md` (von LFH-870) um die drei Quellen, `LAGEBILD_QUELLEN`/`ladeLagebasis` und „kein Freitext aus Auftrag, Meldung, ETB, Personen, Schäden“ ergänzen; Verweis in `pages/lage-dashboard/useLagebild.ts`. Verifikation: `prettier --check` über `frontend/` grün.
- [ ] 5.2 Komponententest in `pages/LageberichtDetailPage.test.tsx`: die drei Abschnitte tragen im Schreibzweig ihren Knopf, „Auftrag“, „Anträge und Vorschläge“ und „Zusammenfassung“ keinen. Verifikation: grün.
- [ ] 5.3 Gesamtlauf `./scripts/check-all.sh` (bzw. die in der Sitzung lauffähigen Bündel: Prettier, ESLint, `tsc -b`, Vitest, Rust-Tests) grün; was nur die CI belegt, mit Verweis auf den Lauf abhaken.

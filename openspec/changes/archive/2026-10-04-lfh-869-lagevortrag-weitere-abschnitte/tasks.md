# Tasks

Setzt auf LFH-870 (`lfh-870-eigene-lage-uebernahme`) auf: vor 1.1 `alpha` mit LFH-870 in diesen
Branch mergen (design.md D6). Jede Aufgabe per TDD (Test zuerst rot). Pfade relativ zu
`frontend/src/`.

## 1. Gemeinsame Quellen

- [x] 1.1 Tests zuerst: aus denselben Rohdaten ergeben `useLagebild` und `ladeLagebasis` dieselbe `Lagebasis` und dieselben Zustände je Quelle, auch mit gesperrtem Modul (das gesperrte Modul wird im Lade-Pfad nicht angefragt, msw zählt). Verifikation: rot.
- [x] 1.2 `LAGEBILD_QUELLEN` aus `pages/lage-dashboard/useLagebild.ts` herausziehen, `ladeLagebasis(qc, einsatzId, freigaben)` nach design.md D1 (inklusive Stand je Quelle), Listen über `ladeListe` aus LFH-870. Verifikation: 1.1 grün, Tests von `useLagebild`, Dashboard und Vorbereitung unverändert grün.
- [x] 1.3 Funkplan-Quellen beim Klick mit denselben Keys und Modulen wie `FunkplanPage` (Stab, dann das Modul der Liste; einziger Nutzer, deshalb in `lageberichte/fuehrungsproblemeUebernahme.ts`); `funkplanLueckenZeilen(luecken, quellen)` aus `rendereFunkplanMarkdown` herauslösen. Verifikation: Test „gesperrt ohne Anfrage“ grün, `stab/funkplan.test.tsx` unverändert grün (Funkplan-Freitext wörtlich gleich).
- [x] 1.4 Formatierer der Vorbereitung (`sichtungText`, Warnstufen-Zeile, Vermisste mit Notiz) exportieren. Verifikation: `stab/vorbereitung.test.ts` unverändert grün.

## 2. Besondere (Führungs-)Probleme (LFH-871)

- [x] 2.1 Tests zuerst in `lageberichte/fuehrungsproblemeUebernahme.test.ts`: Zahl überfällig aus dem Modulzähler, Liste genau nach der Fixture-Regel (`tests/fixtures/verdichtung/regeln.json`) als „Nr. · Frist“, älteste Frist zuerst; Meldungen über `istAlarmiert` als „Nr. · Art · Frist“, „noch nicht gesichtet“ aus `ungesehen`; Funkplan-Lücken wörtlich wie `funkplanLueckenZeilen`; „keine“ je Teil ohne Befund; gesperrte Teile „— (nicht freigegeben)“; erste Zeile `**Stand:**`; Freitext der Fixtures (`auftrag_text`, `inhalt`, `absender`, `empfaenger`) kommt nicht vor. Verifikation: rot.
- [x] 2.2 Quelle `FUEHRUNGSPROBLEME_QUELLE` („Aus dem Führungsstand übernehmen“), angebunden als „Besondere (Führungs-)Probleme“ in `lageberichte/uebernahmen.ts` nach D2/D3. Verifikation: 2.1 grün; Zuordnungstest von LFH-870 um den Abschnitt erweitert grün.

## 3. Gefahren-/Schadenlage (LFH-872)

- [x] 3.1 Tests zuerst in `lageberichte/schadenlageUebernahme.test.ts`: Betroffene, Vermisste, Sichtung, Schäden offen und Warnstufe gleich der Vorbereitung aus denselben Rohdaten; Warnungen geltend/angekündigt über `teileWarnungen`, abgelaufene fehlen; „kein Einsatzort“ bzw. „— (Ausfall)“ je `zustand`; Pegel je Station über `pegelZeile` in Reihenfolge, „keine maßgeblichen Pegel festgelegt“ bei leerer Liste; `wetter-pegel` gesperrt → Wetter „— (nicht freigegeben)“, Pegel trotzdem da; keine Personen- oder Schadensfelder im Text. Verifikation: rot.
- [x] 3.2 Quelle `SCHADENLAGE_QUELLE` („Aus dem Lagebild übernehmen“), angebunden als „Gefahren-/Schadenlage“ nach D2/D4, Lagebild über `ladeLagebasis`. Verifikation: 3.1 grün.

## 4. Lageentwicklung (LFH-873, Variante nach D5)

- [x] 4.1 Tests zuerst in `lageberichte/lageentwicklungUebernahme.test.ts`: Grenze nach `lfd_nr` des Eintrags der letzten Lagebesprechung (nachgetragener Eintrag mit früherer Ereigniszeit zählt), `system` und `lage` mit `lagebericht_id` ausgenommen, Zahl je Typ, Entscheidungen „Nr. · DTG“ ohne Wortlaut (höchstens 20, „und n weitere“), „seit Einsatzbeginn“ ohne Lagebesprechung, Seitenabruf endet an der Grenze (msw zählt Seiten); `inhalt`, `von`, `an`, `veranlassung` der Fixtures kommen nicht vor. Verifikation: rot.
- [x] 4.2 Quelle `LAGEENTWICKLUNG_QUELLE` („Aus dem ETB übernehmen“), angebunden als „Lageentwicklung“ nach D2/D5. Verifikation: 4.1 grün.

## 5. Regeln und Abschluss

- [x] 5.1 Abschnitt zum Baustein in `frontend/src/entwurf/AGENTS.md` (von LFH-870) um die drei Quellen, `LAGEBILD_QUELLEN`/`ladeLagebasis` und „kein Freitext aus Auftrag, Meldung, ETB, Personen, Schäden“ ergänzen; Verweis in `pages/lage-dashboard/useLagebild.ts`. Verifikation: `prettier --check` über `frontend/` grün.
- [x] 5.2 Komponententest in `pages/LageberichtDetailPage.test.tsx`: die drei Abschnitte tragen im Schreibzweig ihren Knopf, „Auftrag“, „Anträge und Vorschläge“ und „Zusammenfassung“ keinen. Verifikation: grün.
- [x] 5.3 Gesamtlauf `./scripts/check-all.sh` (bzw. die in der Sitzung lauffähigen Bündel: Prettier, ESLint, `tsc -b`, Vitest, Rust-Tests) grün; was nur die CI belegt, mit Verweis auf den Lauf abhaken.
  Sitzung (Node 22 statt 26.7, ohne mise): Prettier, ESLint, `tsc -b` grün, Vitest 9475/9476 grün; rot nur `api/kartenbilder.test.ts` (msw `object.stream` unter Node 22, Datei nicht berührt). Rust ohne Änderung; beides belegt die CI des PR.

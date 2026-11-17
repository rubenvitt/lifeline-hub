# Tasks

Zunder: LLH-1815 (https://zunder.rubeen.dev/#/aufgabe/h3in6ppdzv3gcpx1soaickak). Jede Aufgabe
per TDD.

## 1. Kern der Startliste (D1)

- [x] 1.1 `pages/fuehrung/startliste.ts` mit `startliste()` und `startlisteOffen()`; `startliste.test.ts` für jede Regel der Spec (Einsatzort mit/ohne Koordinate, Einsatzleiter, Abschnitt, Kräfte nur Einheit/nur Personal, Lage vs. Entscheidung, gesperrt, unbekannt, alle erledigt) rot, dann grün
- [x] 1.2 Modulschlüssel je Punkt gegen die Modulliste prüfen und Sperrgrund aus der vorhandenen Logik übernehmen; Test „ETB gesperrt, sonst erledigt → `startlisteOffen` falsch“

## 2. Sprungziele (D5)

- [x] 2.1 `routing/deeplinks.ts`: `einsatzdatenPfad` um `paneel: 'einsatzort' | 'fuehrungsstelle'`; Deeplink-Test grün
- [x] 2.2 `EinsatzdatenPage.tsx`: Auftrag `?paneel=einsatzort|fuehrungsstelle` rollt zum Paneel und räumt den Parameter (Muster LLH-1850); `EinsatzdatenPage.test.tsx` mit beiden Aufträgen
- [x] 2.3 Leeraktion „Abschnitt anlegen“ im Überblick mit `neu: true`; Test in `UeberblickPage.test.tsx`

## 3. Paneel im Überblick (D2, D3, D4)

- [x] 3.1 Abfrage der jüngsten Lagefeststellung (`typ: 'lage'`, `limit: 1`, Query-Key nach Regel), nur bei freiem ETB, Schreibrecht und aktivem Einsatz; Test, dass sie sonst nicht feuert
- [x] 3.2 Paneel „Einsatz starten“ als `ListenPaneel` in eigener Reihe unter der Alarmzeile, Zeilen nach Zustand (Haken, offen mit Link, „—“ mit Grund, „nicht geladen“), sichtbar nur bei `darfImEinsatzSchreiben` und aktiv; Vitest: leerer Einsatz fünf offen, alles erledigt kein Paneel, Beobachter kein Paneel, Spiegel kein Paneel, gesperrtes Modul mit Grund
- [x] 3.3 Ladeschranke: Paneelreihen und Startliste erscheinen gemeinsam (`startlisteBereit` neben `gliederungLaedt`); Vitest mit verzögerter ETB-Abfrage
- [x] 3.4 „Ausblenden“ je Browser über `sichererSpeicher`, Schlüssel in `GERAETESPEICHER`; Vitest: ausgeblendet bleibt weg, Speicher wirft → bleibt bis Neuladen weg; Guard `sichererSpeicher.guard.test.ts` und Geräteräumungs-Test grün
- [x] 3.5 Falls `DashboardPaneel` keine Kopf-Aktion hat: als Prop ergänzen samt Test und Design-System-Vorschau (Generator neu laufen lassen, `designSystem.guard.test.ts` grün)
- [x] 3.6 `frontend/AGENTS.md`: Dashboard-Baukasten (Reihe „Einsatz starten“ unter der Alarmzeile) und „Rollen der Übersichten“ (Startliste gehört zum Überblick, Haken statt Zahl); Prettier grün

## 4. e2e, Bilder, Doku

- [x] 4.1 e2e: leerer Einsatz zeigt die Startliste ohne Layoutsprung (Lage der Reihen vor und nach dem Laden gleich), Erfassen des Einsatzleiters über den Sprung setzt den Haken, letzter Punkt lässt das Paneel verschwinden; Lauf grün
- [ ] 4.2 `docs/anwender/kapitel/ueberblick.md`: Abschnitt „Einsatz starten“ (Punkte, wann erledigt, Ausblenden) nach `docs/anwender/AGENTS.md`; Bild per `ueberblick.bilder.ts`; Wächter der Anwenderdoku grün

## 5. Verifikation

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Folgeaufgabe über `zunder-task-anlegen`: Lagekarte nennt einen fehlenden Einsatzort, statt nur „0 verortet“ zu zeigen.
- Review vor dem PR über den ganzen Branch (LLH-1811, Phase 4), dann `/opsx:archive`.

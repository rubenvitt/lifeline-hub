# Tasks

## 1. LLH-1740 (w744ma23): Sofort und Dringend ab Eingang zuoberst

- [x] 1.1 `offeneVorgaenge.ts`: `meldungsStufe(m)` und neue Folge in `vorgangsMeldungen` (alarmiert → sofort → dringend → übrige; Sofort/Dringend neueste zuerst). Zuerst Tests in `offeneVorgaenge.test.ts` (rot): Sofort vor drei älteren neuen, zwei Sofort neueste zuerst, alarmierte Normalmeldung vor Sofort, Dringend vor Normal, Art Sofortmeldung ohne Prio sofort zählt als Sofort; dann grün.
- [x] 1.2 `OffeneVorgaengePaneel.tsx`: Wortplatz der Meldungszeile mit Vorrang „Bestätigung überfällig“ → „SOFORT“ → „DRINGEND“ → Statuswort, Ton über `prioTon`, Alarmkante unverändert nur bei `istAlarmiert`. Seitentest in `UeberblickPage.test.tsx`: nach Neuabruf mit frischer Sofortmeldung steht sie an Stelle 1 mit „SOFORT“ und ohne `data-alarm`.

## 2. LLH-1749 (vy3t2c4k): eine fällige Erinnerung, ein Wort

- [x] 2.1 `erinnerung/erinnerungZustand.ts` mit Test zuerst: fällig per `ist_faellig` oder `faellig_at <= jetzt` → `{ wort: 'fällig', ton: 'achtung' }`, sonst `{ wort: 'bald', ton: null }`.
- [x] 2.2 `markenBewertung` liest die Funktion für `art === 'erinnerung'` bei verstrichener Zeit; `OffeneVorgaengePaneel` nimmt Wort und Ton aus ihr. Tests in `ueberblickDaten.test.ts` (Erinnerung verstrichen → „fällig“/achtung; Auftrag verstrichen → „überfällig“/alarm unverändert).
- [x] 2.3 Folgeaufgabe per `zunder-task-anlegen` (LLH-1911, https://zunder.rubeen.dev/#/aufgabe/wyfk3i0mw59mymnv1kvewg30): Erinnerungskarte im Modul (alarm) mit Überblick angleichen. Betrifft `KommKarte`/`kartenKante` und Spec `deeplink-hervorhebung`. Link im PR.

## 3. Doku

- [x] 3.1 `docs/anwender/kapitel/ueberblick.md`: Offene Vorgänge (Sofort/Dringend oben, Wörter) und Nächste Marken (Erinnerung „fällig“ in Gelb, „überfällig“ nur für Fristen); Bild des Überblicks über den Bildlauf erneuern, falls es eine Meldungsliste zeigt. Doku-Wächter grün; `mise exec -- openspec validate ro4s6p7l-ueberblick-dringlichkeit --strict` grün.

## Workflow follow-up

- Gemeinsamer Review vor dem PR über den ganzen Branch (Welle 1 von LLH-1717).
- `/opsx:archive ro4s6p7l-ueberblick-dringlichkeit` vor dem PR, im selben Branch.

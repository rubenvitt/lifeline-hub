# Tasks

## 1. Android: verweigerte Benachrichtigung sofort (D1)

- [x] 1.1 Test in `alarm/desktopAlarm.test.ts`: Android, `Notification.permission = 'denied'`, ohne steuernden Worker und mit unbeantworteter Nachfrage → `desktopPermission()` ist `denied` (rot vor der Änderung)
- [x] 1.2 `desktopPermission()` prüft `denied` vor dem Zustellweg; bestehende Tests zu `granted`/`unsupported` bleiben grün (`vitest run src/alarm`)
- [x] 1.3 Test in den Tests der Alarmzentrale: Android mit verweigerter Benachrichtigung zeigt „Benachrichtigung blockiert“ im ersten Render, vor `DESKTOP_ZUSTAND_EVENT`; Kommentar in `AlarmZentrale.tsx` am Ereignis nachziehen

## 2. Warteschlange: Merker des Zählers (D2, D3)

- [x] 2.1 Tests in `offline/useOfflineQueueZaehler.test.ts`: Startwert aus dem Merker im ersten Render; fremde `benutzer_id` und kaputter Wert → `LEER`; nach dem Laden steht der gelesene Stand im Merker, auch `LEER`; Einsatz-Scope liest und schreibt keinen Merker (rot vor der Änderung)
- [x] 2.2 Merker umsetzen (Lesen/Schreiben über `lib/sichererSpeicher`), Hook nimmt ihn als Startwert; Tests aus 2.1 grün
- [x] 2.3 `GERAETESPEICHER`-Eintrag (`jeder-ausgang`) und Schritt in `geraetRaeumen`; Test, dass Abmelden und Sitzungsende den Merker entfernen; `geraetRaeumung.guard.test.ts` und `sichererSpeicher.guard.test.ts` grün
- [x] 2.4 Regel in `frontend/src/offline/AGENTS.md`, „Gerätedaten beim Abmelden“ (Satz zum Queue-Zähler) um den Merker ergänzen; Kommentar an `SyncAnzeige` in `components/Kopfleiste.tsx` nachziehen

## 3. Nachweis an der Kante

- [x] 3.1 e2e-Fall in `e2e/rahmen-cls-dichte.spec.ts`: zwei vorgemerkte Einträge, Abgleich zurückgehalten, Kante mit „WARTET 2“ suchen, dort neu laden; Seiten-CLS unter `HAUS_GRENZE` und „WARTET 2“ im Kopf; läuft lokal grün (bzw. ist ohne lauffähigen Stack mit Grund im PR vermerkt)
- [ ] 3.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.

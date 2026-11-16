# Proposal

## Why

Zwei Zustände der Kopfleiste stellen sich nach dem ersten Bild ohne Zutun ein: „WARTET n“ bzw.
„PRÜFEN“, wenn nach Offline-Arbeit noch Einträge vorgemerkt oder abgelehnt sind, und auf Android
„Benachrichtigung blockiert“. Weil ihr Wort erst danach erscheint, wird der Kopf breiter, und an
der Umbruchkante springt er um eine Zeile (52 px in `komfortabel`, 72 px in `handschuh`). Die Spec
`kopfleiste` sichert bisher nur Tonprüfung und Verbindungsaufbau ab (Folgeaufgabe LLH-1910 aus dem
Review von LLH-1726).

## What Changes

- Die SYNC-Anzeige kennt die Zähler der Offline-Warteschlange schon im ersten Bild: Die zuletzt
  gelesenen Zahlen je Benutzer liegen im Browserspeicher; die Warteschlange selbst bestätigt sie
  danach. Abmelden und Sitzungsende räumen den Merker.
- Die Alarmzentrale meldet eine verweigerte Benachrichtigung auf Android sofort als „blockiert“,
  ohne auf die Antwort des Service Workers zu warten. Der Worker entscheidet nur noch, ob eine
  erlaubte oder offene Berechtigung einen Zustellweg hat.
- Die Spec `kopfleiste` fordert für jede Störung, die beim Laden ohne Zutun feststeht, dass sie
  im ersten Bild steht, neben der bestehenden Regel für Tonprüfung und Verbindungsaufbau.

## Capabilities

### New Capabilities

- keine

### Modified Capabilities

- `kopfleiste`: neues Requirement „Eine beim Laden feststehende Störung steht im ersten Bild“.
  Bisher sicherte die Spec den Start nur für Tonprüfung und Verbindungsaufbau ab (Requirement
  „Ruhezustände …“, das unverändert bleibt).

## Impact

- `frontend/src/offline/useOfflineQueueZaehler.ts` (Startwert aus dem Merker, Schreiben nach jeder
  Ladung), neuer Merker über `lib/sichererSpeicher`.
- `frontend/src/offline/geraetRaeumung.ts`: Eintrag in `GERAETESPEICHER` (`jeder-ausgang`) und
  Schritt in `geraetRaeumen`.
- `frontend/src/alarm/desktopAlarm.ts` (`desktopPermission`); wirkt auch auf den Test der
  Benachrichtigung in `pages/BenachrichtigungenPage.tsx`, der bei verweigerter Berechtigung auf
  Android dann „blockiert“ statt „nicht verfügbar“ meldet.
- Tests: Hook, `desktopPermission`, Alarmzentrale, Räumung; e2e `rahmen-cls-dichte.spec.ts`.
- Kein Backend, keine API, keine Migration.

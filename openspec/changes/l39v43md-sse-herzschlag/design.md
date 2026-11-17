# Design

## Context

- `oeffneLiveVerbindung` (`frontend/src/live/liveVerbindung.ts`) baut Einsatz- und Org-Strom auf
  und meldet den Zustand per `lfh:live-status` an `liveStatusStore`. Kopfleiste (`SyncAnzeige`),
  Lagebild-Strom (`LagePaneele`), Großbild und Lagemonitor lesen nur diesen Store.
- Der Zustand wechselt heute nur bei `onopen`/`onerror`. Ein halboffenes TCP löst keins von beiden
  aus, solange das Betriebssystem die Verbindung nicht verwirft (Minuten bis Stunden).
- Der Server sendet beim Aufbau einen Kommentar `verbunden`, ein `retry:`-Ereignis, beim
  Einsatz-Strom das Kontroll-Ereignis `position`, und hält die Leitung mit
  `KeepAlive::default()` (Kommentar nach 15 s Leerlauf). Kommentare erreichen keinen Listener der
  `EventSource`.
- Beide Ströme enden über `take_until` (Sitzung, Kopplung) und `strom::begrenzt` (Lebensdauer,
  Platz).

## Goals / Non-Goals

**Goals:** stumme Leitung binnen 45 s erkennen und selbst neu aufbauen; Anzeigen folgen über den
bestehenden Store.

**Non-Goals:** Nachlieferung über die eigene Neuverbindung hinweg (verworfen, s. D4); Erkennen
toter Verbindungen auf Serverseite (das Schreiben in einen toten Socket endet über TCP selbst);
Änderungen an Anzeige-Komponenten.

## Decisions

### D1 Fester Takt statt Keep-Alive-Ereignis

Der Server mischt einen eigenen Intervall-Strom (`HEARTBEAT_INTERVAL` = 15 s, erster Schlag nach
15 s) in jeden Live-Strom, der unabhängig von Fach-Ereignissen ein `heartbeat` sendet.

- *Verworfen: `KeepAlive::event(...)`* mit eigenem Ereignis. Axum sendet es nur nach Leerlauf. Ein
  Strom, der viele Ereignisse sendet, für die der Client keinen Listener hat, hielte die Wache dann
  nicht wach; der Client müsste jedes Ereignis kennen, das der Server je schicken kann.
- `KeepAlive::default()` bleibt: es kostet nichts (es feuert nach 15 s Leerlauf, das Lebenszeichen
  kommt vorher) und hält Proxys wach, falls der Takt einmal geändert wird.
- `strom::mit_heartbeat(strom, takt)` verschmilzt den Strom mit dem Intervall und endet, sobald
  der innere Strom endet (eine bloße Verschmelzung liefe sonst ewig weiter). Beide Routen mischen
  es nach dem Modul- und Gerätefilter und vor ihrem `take_until` ein.
- Der Takt steht in `StromGrenzen::heartbeat` (Vorgabe `HEARTBEAT_INTERVAL`), damit Tests ihn wie
  die Lebensdauer auf Millisekunden stellen.
- `MissedTickBehavior::Delay`: ein blockierter Takt holt keine Schläge im Bündel nach.

### D2 Wire-Form des Lebenszeichens

`event: heartbeat`, `data: {}`, **ohne** `id:` — die `Last-Event-ID` des Browsers bleibt die
zuletzt gemeldete Position, das Neuverbinden mit Nachlieferung (LFH-922) bleibt unberührt. Der
Name steht neben `POSITION_EREIGNIS` als Konstante in `routes/support.rs`, ist kein `LiveEvent`
und läuft deshalb an Modul- und Gerätefilter vorbei. Englisch nach der Bezeichner-Regel
(LFH-1312): ein Wort, das nur Programmierer benutzen; die Oberfläche zeigt es nie.

### D3 Wache im Client

In `verbinde()` je Quelle eine Wache (`setTimeout`, `HEARTBEAT_TIMEOUT_MS` = 45 000):

- **Start** erst in `onopen`; vor dem ersten `open` keine Wache (Kaltstart bleibt `idle`).
- **Zurücksetzen** bei jedem Ereignis der Quelle: ein Lausch-Handler hängt an `heartbeat`, am
  `positionsEreignis` und an jedem Ereignisnamen aus `listeners`.
- **Ablauf:** `meldeStatus('connecting')` sofort (die Stille ist schon die Schonfrist), Quelle
  trennen, `verbinde()` neu. Die neue Quelle hat keine `Last-Event-ID`; ihr `open` läuft deshalb in
  `beiWiederaufbau` (Vollabgleich), wie es die Spec für einen Neuaufbau durch das Frontend verlangt.
- **Stopp** in `onerror` (der Browser verbindet selbst neu, Schonfrist und Backoff übernehmen; ein
  folgendes `open` startet die Wache neu) und beim Aufräumen. Beim Pausieren für den Druck ist die
  Quelle nicht mehr die aktuelle; die Wache prüft das beim Ablauf und tut dann nichts.
- Drei verpasste Schläge (45 s gegen 15 s) lassen Raum für langsame Mobilfunk-Zustellung und
  gedrosselte Timer verdeckter Tabs.

### D4 Vollabgleich statt Nachlieferung

*Verworfen:* die letzte Ereignis-ID als Query-Parameter an die neue Verbindung geben. Das braucht
einen zweiten Eingang für die Position an der Route und mehr Code, nur um nach einem Funkloch
einmal weniger abzurufen. Abgestimmt mit dem Menschen am 17.11.2026.

### D5 Takt und Schwelle

15 s / 45 s, abgestimmt am 17.11.2026. *Verworfen:* 10/30 (mehr Fehlalarme im Mobilfunk) und
30/90 (totes Lagebild bis 1,5 min als „live“).

## Risks / Trade-offs

- [Mobilgerät setzt die Seite aus, die Wache feuert beim Aufwachen vor den gepufferten
  Ereignissen] → höchstens ein überflüssiger Neuaufbau mit Vollabgleich; die Leitung ist nach dem
  Aussetzen ohnehin meist tot.
- [Älteres Frontend im Cache gegen neuen Server] → ignoriert `heartbeat` (kein Listener).
- [Neues Frontend gegen alten Server] → kommt nicht vor: Frontend und Desktop-Hülle laden die
  Oberfläche vom selben Server.

## Migration Plan

Keine Datenmigration. Server und Frontend gehen gemeinsam aus; Rücknahme durch Revert.

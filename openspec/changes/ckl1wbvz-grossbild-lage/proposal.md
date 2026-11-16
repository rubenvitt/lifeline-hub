# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ckl1wbvzg7p2blvt4ox90pkb (LLH-1747, Unteraufgabe von
LLH-1717 „Lage: ‚Was brennt‘ sichtbar machen“). Lösungsweg abgestimmt mit Ruben am 16.11.2026.

## Why

Lagebild und Lagebesprechung werden im Führungsraum auf Beamer oder Wandbildschirm gezeigt, sind
aber für den Arbeitsplatz gebaut: Bei 1920 × 1080 bleibt die Schrift bei 12–13,5 px, das untere
Drittel des Lagebilds ist leer, und in der Vorbereitung liegen Bezeichnung und Wert rund 1500 px
auseinander. Aus 2–3 m Abstand ist das nicht lesbar. Der Lagemonitor zeigt, dass es geht (Zahlen
72–96 px, Text ab 28 px), ist aber ein gekoppeltes Gerät mit eigener, namenloser Datenquelle und
taugt nicht als Ansicht am Bedienplatz.

## What Changes

- **Großbild-Ansicht für das Lagebild:** Ein Knopf „Großbild“ im Seitenkopf zeigt das Lagebild
  bildschirmfüllend ohne App-Rahmen, in Vollbild, im Maßstab des Lagemonitors: die sechs Kennzahlen,
  Gefahren (bzw. der Verlauf in der Reihe „Sanitätsdienst“), die Sichtung und der Führungsstand.
  Dieselben Zahlen wie auf der normalen Seite, live.
- **Großbild-Ansicht für die Lagebesprechung:** Derselbe Knopf zeigt den Termin der nächsten
  Besprechung mit Zustand und die Zeilen der Vorbereitung, Wert direkt neben der Bezeichnung.
- **Nur Ansehen:** Im Großbild führt nichts in ein Modul und nichts ändert Daten; einzige Bedienung
  ist „Großbild verlassen“ (auch mit Esc oder beim Verlassen des Vollbilds) und „Vollbild“, falls
  der Browser es beim Öffnen abgelehnt hat. Tastenkürzel der App wirken im Großbild nicht.
- **Größen wachsen mit dem Fenster:** Bei 1920 × 1080 gelten die Werte des Lagemonitors, ein Beamer
  mit 1280 × 720 oder ein 4K-Schirm zeigt dieselbe Aufteilung im selben Verhältnis, ohne Bildlauf.
- **Alarme und Verbindung gehen nicht unter:** Liegen Einträge in der Alarmzone, zeigt das Großbild
  ihre Zahl; ist der Live-Kanal getrennt, sagt es das. Bearbeitet wird nach dem Verlassen.
- **Übung bleibt erkennbar:** Bei einer Übung trägt das Großbild die Übungsmarke.
- **Vorbereitung, normale Ansicht:** Der Wert steht direkt neben der Bezeichnung statt am rechten
  Rand der vollen Breite.

Nicht in dieser Change: Umbau des Lagemonitors auf die neuen Großbild-Bausteine (läuft parallel in
LLH-1746, eigene Folgeaufgabe) und die Alarmzeile „Was brennt“ im Großbild (LLH-1743, kommt nach
deren Merge als Folgeaufgabe).

## Capabilities

### New Capabilities

- `grossbild-ansicht`: Präsentationsansicht einer Lageseite am Bedienplatz für Beamer und
  Wandschirm: Ein- und Ausstieg, Vollbild, nur Ansehen, mitwachsende Großbild-Größen, Alarm- und
  Übungskennzeichnung, Inhalt für Lagebild und Lagebesprechung.

### Modified Capabilities

- `lagebesprechung-vorbereitung`: neue Anforderung „Wert neben der Bezeichnung“ (Wert direkt
  neben der Bezeichnung, nicht am Rand der vollen Breite).

## Impact

- Frontend: `pages/lage-dashboard/LageDashboardPage.tsx` (Knopf, Großbild-Zweig),
  `pages/LagebesprechungPage.tsx` (Knopf, Großbild-Zweig), `lagebesprechung/VorbereitungPaneel.tsx`
  (Zeilen aus einer geteilten Quelle, Zeilenraster), neue Bausteine unter
  `components/grossbild/` mit Karte im Design System. `geraet/LagemonitorPage.tsx` bleibt
  unverändert; das Wachhalten des Bildschirms steht als Kopie unter
  `components/grossbild/` (ein Import zöge die Monitorseite samt Karte in jede Seite).
- Backend, API, Migrationen: keine. Die Großbild-Ansicht nutzt die Abfragen der normalen Seite.
- Anwenderdoku: Kapitel `lagebild.md` und `lagebesprechung.md` (Mitänderungsregel).
- Überschneidung mit parallelen Branches: LLH-1743 ändert den Kopf der Lagebild-Seite, LLH-1746 den
  Lagemonitor. Der Großbild-Zweig bleibt am Ende der Seite, damit der Merge klein bleibt.

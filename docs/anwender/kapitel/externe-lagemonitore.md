---
titel: Externe Lagemonitore
gruppen: [fuehrung, administration]
reihenfolge: 780
quellen: [frontend/src/pages/einstellungen/LagemonitorZugaenge.tsx, frontend/src/pages/einstellungen/EinsatzLagemonitore.tsx, src/routes/lagemonitor_zugang.rs, src/routes/lagemonitor_v1.rs, src/lagemonitor_zugang/mod.rs, src/einsatz/repo.rs]
---

## Überblick

Ein **externer Lagemonitor** ist eine eigene Anzeige außerhalb der App, etwa der Monitor im
Führungskraftwagen, der das Lagebild mehrerer Quellen zusammenführt. Er koppelt sich nicht wie
ein Gerät, sondern liest mit einem **Schlüssel** das Lagebild genau eines Einsatzes.

Den Schlüssel legt der System-Admin in der Verwaltung unter „Lagemonitore“ an. Welchen Einsatz
der Monitor zeigt, entscheidet die Einsatzleitung auf der Seite „Geräte“ ihres Einsatzes. Für
den gekoppelten Großbildschirm in der App siehe [Lagemonitor](lagemonitor.md), für Stellen
ohne eigenen Monitor das [Lagebild für Externe](lagebild-extern.md).

## Abläufe

### Zugang anlegen

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Lagemonitore“ wählen.
2. „Zugang anlegen“ wählen, eine „Bezeichnung“ eintragen, etwa „FüKW Monitor“, und „Anlegen“
   wählen.
3. Der Dialog „Schlüssel für …“ zeigt den Schlüssel und darunter die Adresse, die der Monitor
   abfragt. Beides mit dem Kopierknopf übernehmen und in der Konfiguration des Monitors
   eintragen.
4. „Fertig“ wählen. Der Schlüssel ist danach nicht mehr abrufbar.

### Einsatz für einen Monitor freigeben

Für die Einsatzleitung:

1. Im Einsatz „Einstellungen“ und dort „Geräte“ öffnen.
2. Im Paneel „Externe Lagemonitore“ den Schalter des Monitors einschalten. Die Zeile nennt
   „zeigt diesen Einsatz“.
3. Zum Beenden den Schalter wieder ausschalten.

Steht an einer Zeile „zeigt einen anderen Einsatz“, zeigt der Monitor gerade einen anderen
Einsatz der Organisation. Das Einschalten stellt ihn auf diesen Einsatz um.

### Zugang widerrufen

Für den System-Admin:

1. Unter „Einstellungen“, „Lagemonitore“ im Menü der Zeile „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

## Hintergrund

### Wer was darf

Anlegen und widerrufen darf nur der System-Admin; eine Führungskraft sieht die Liste ohne
Aktionen. Einen Einsatz freigeben oder die Freigabe beenden darf nur die Einsatzleitung dieses
Einsatzes, solange er aktiv ist. Auch ein System-Admin ohne Rolle im Einsatz gibt nicht frei.

### Ein Monitor, ein Einsatz

Ein Zugang zeigt höchstens einen Einsatz. Gibt die Einsatzleitung eines zweiten Einsatzes ihn
frei, endet die Freigabe am ersten. Ohne Freigabe erhält der Monitor kein Lagebild. Mit dem
Abschluss des Einsatzes endet jede Freigabe an ihm.

### Was der Monitor erhält

Der Monitor erhält Bezeichnung, Stichwort, Einsatzart und Beginn des Einsatzes, die Zahlen zu
Betroffenen und Kräften, die Belegung der Unfallhilfsstellen und die Zahl der offenen
Sofortmeldungen, also dieselben Zahlen wie der [Lagemonitor](lagemonitor.md); in der Reihe
„Sanitätsdienst“ auch die Hilfeleistungen (Kontakte, letzte Stunde, in Versorgung, Transporte).
Dazu kommt die
„Zusammenfassung“ des zuletzt freigegebenen Lageberichts (siehe
[Lageberichte](lageberichte.md)); ein Entwurf geht nicht hinaus. Die Zusammenfassung geht so
hinaus, wie sie freigegeben ist: Bei einem freigegebenen Einsatz gehören keine Namen hinein.

Die Karte trägt den Einsatzort als Punkt ohne Adresse, die Gefahrenzonen, die Flächen der
Einsatzabschnitte mit ihrer Bezeichnung, die verorteten Unfallhilfsstellen mit Bezeichnung und
Belegung und die taktischen Zeichen der Lagekarte ohne ihre Beschriftung. Zeichen, die nur in
einer eigenen Kartenansicht stehen, fehlen. Namen, Meldungstexte und das Einsatztagebuch erhält
der Monitor nicht. Wer den Einsatz freigibt, gibt damit auch die Lage des Einsatzorts weiter.

### Schlüssel und Widerruf

Der Server speichert den Schlüssel nicht, nur einen Prüfwert. Ist er verloren, den Zugang
widerrufen und einen neuen anlegen. Ein widerrufener Schlüssel gilt sofort nicht mehr; die
Zeile bleibt mit „widerrufen“ stehen. „zuletzt“ nennt den letzten Abruf, auf die Minute genau.

### Was das Einsatztagebuch festhält

Freigabe, Ende der Freigabe, Umstellen auf einen anderen Einsatz und Widerruf stehen als
Systemeintrag im Einsatztagebuch des betroffenen Einsatzes, mit dem Namen der Person. Anlegen und
Widerrufen stehen zusätzlich im [Zugangsprotokoll](zugangsprotokoll.md).

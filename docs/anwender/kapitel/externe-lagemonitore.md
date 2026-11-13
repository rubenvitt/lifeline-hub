---
titel: Externe Lagemonitore
gruppen: [fuehrung, administration]
reihenfolge: 780
quellen: [frontend/src/pages/einstellungen/EinsatzAnbindungen.tsx, frontend/src/pages/einstellungen/Anbindungen.tsx, src/routes/einsatz_anbindungen.rs, src/routes/anbindungen.rs, src/public_api/lage.rs, src/public_api/freigabe.rs, src/routes/lagemonitor.rs, src/routes/leitung_freigabe.rs, src/einsatz/repo.rs]
---

## Überblick

Ein **externer Lagemonitor** ist eine eigene Anzeige außerhalb der App, etwa der Monitor im
Führungskraftwagen, der das Lagebild mehrerer Quellen zusammenführt. Er koppelt sich nicht wie
ein Gerät, sondern liest als **Anbindung** mit dem Recht „Lage lesen“ das Lagebild genau eines
Einsatzes.

Die Anbindung legt der System-Admin in der Verwaltung unter „Anbindungen“ an (siehe
[Anbindungen](anbindungen.md)). Welchen Einsatz der Monitor zeigt, entscheidet die
Einsatzleitung auf der Seite „Geräte“ ihres Einsatzes. Für den gekoppelten Großbildschirm in der
App siehe [Lagemonitor](lagemonitor.md), für Stellen ohne eigenen Monitor das
[Lagebild für Externe](lagebild-extern.md).

## Abläufe

### Monitor anbinden

Für den System-Admin:

1. In der Verwaltung unter „Einstellungen“ „Anbindungen“ wählen.
2. „Anbindung anlegen“ wählen, einen „Name“ eintragen, etwa „FüKW Monitor“, und unter „Rechte“
   „Lage lesen“ ankreuzen.
3. „Anlegen und Code zeigen“ wählen und den Code am Monitor einlösen, wie es der Dialog nennt.
4. „Fertig“ wählen. Sobald der Monitor den Code eingelöst hat, steht die Anbindung auf „aktiv“.
   Solange kein Einsatz freigegeben ist, nennt ihre Zeile „kein Einsatz freigegeben“.

### Einsatz für einen Monitor freigeben

Für die Einsatzleitung:

1. Im Einsatz „Einstellungen“ und dort „Geräte“ öffnen.
2. Im Paneel „Anbindungen“ den Schalter des Monitors einschalten. Die Zeile nennt „liest diesen
   Einsatz“.
3. Zum Beenden den Schalter wieder ausschalten.

Steht an einer Zeile „liest einen anderen Einsatz“, zeigt der Monitor gerade einen anderen
Einsatz der Organisation. Das Einschalten stellt ihn auf diesen Einsatz um.

### Monitor abschalten

Für den System-Admin:

1. Unter „Einstellungen“, „Anbindungen“ im Menü der Zeile „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

## Hintergrund

### Wer was darf

Anbindungen anlegen, ändern und widerrufen darf nur der System-Admin. Einen Einsatz freigeben
oder die Freigabe beenden darf nur die Einsatzleitung dieses Einsatzes, solange er aktiv ist.
Auch ein System-Admin ohne Rolle im Einsatz gibt nicht frei. Das Paneel „Anbindungen“ zeigt nur
Anbindungen mit dem Recht „Lage lesen“ oder „Einsätze lesen“, die weder widerrufen noch
abgelaufen sind; ohne eine solche fehlt es.

Lehnt der Server ein Umschalten ab, weil die Anbindung inzwischen widerrufen oder abgelaufen
ist, verschwindet ihre Zeile. Der Grund bleibt im Paneel stehen, bis er geschlossen wird.

### Ein Monitor, ein Einsatz

Eine Anbindung liest höchstens einen Einsatz. Gibt die Einsatzleitung eines zweiten Einsatzes
sie frei, endet die Freigabe am ersten. Ohne Freigabe erhält der Monitor kein Lagebild. Ein
Einsatz kann für mehrere Monitore freigegeben sein.

Die Freigabe endet

- mit dem Abschluss des Einsatzes,
- wenn der System-Admin die Anbindung widerruft oder ihr „Gültig bis“ verstreicht,
- wenn der System-Admin ihre Rechte „Lage lesen“ oder „Einsätze lesen“ ändert, gleich ob er
  eines nimmt oder dazugibt.

Danach, und auch nach einem verlängerten „Gültig bis“, liest sie erst nach einer neuen Freigabe.

Die Seite „Anbindungen“ nennt an jeder Anbindung mit „Lage lesen“ oder „Einsätze lesen“, die
weder widerrufen noch abgelaufen ist, welchen Einsatz sie gerade liest.

### Was der Monitor erhält

Der Monitor erhält Bezeichnung, Stichwort, Einsatzart und Beginn des Einsatzes, die Zahlen zu
Betroffenen und Kräften, die Belegung der Unfallhilfsstellen und die Zahl der offenen
Sofortmeldungen, also dieselben Zahlen wie der [Lagemonitor](lagemonitor.md); in der Reihe
„Sanitätsdienst“ auch die Hilfeleistungen (Kontakte, letzte Stunde, in Versorgung, Transporte).
Dazu kommt die „Zusammenfassung“ des zuletzt freigegebenen Lageberichts (siehe
[Lageberichte](lageberichte.md)); ein Entwurf geht nicht hinaus. Die Zusammenfassung geht so
hinaus, wie sie freigegeben ist: Bei einem freigegebenen Einsatz gehören keine Namen hinein.

Die Karte trägt den Einsatzort als Punkt ohne Adresse, die Gefahrenzonen, die Flächen der
Einsatzabschnitte mit ihrer Bezeichnung, die verorteten Unfallhilfsstellen mit Bezeichnung und
Belegung und die taktischen Zeichen der Lagekarte ohne ihre Beschriftung. Zeichen, die nur in
einer eigenen Kartenansicht stehen, fehlen. Namen, Meldungstexte und das Einsatztagebuch erhält
der Monitor nicht. Wer den Einsatz freigibt, gibt damit auch die Lage des Einsatzorts weiter.

### Einsatz, den eine andere Instanz führt

Monitore werden am Hub angebunden. Führt ein ELW den Einsatz, liegt er am Hub als Spiegel; die
Einsatzleitung gibt ihn dort genauso frei. Der Monitor erhält dann die Zahlen des Spiegels samt
dem Zeitpunkt des letzten Abgleichs. Ist der Abgleich des Spiegels beendet, lässt sich der
Einsatz nicht mehr neu freigeben; eine bestehende Freigabe lässt sich weiter beenden.

### Instanz, die sich selbst bei einem Hub meldet

Meldet sich die Instanz für die Organisation bei einem Hub, nimmt sie keine Fremdsysteme an
(siehe [Anbindungen](anbindungen.md)). Das Paneel „Anbindungen“ fehlt dort, und die Seite
„Anbindungen“ nennt keinen gelesenen Einsatz.

Las ein Monitor den Einsatz schon vor der Kopplung, ruht seine Freigabe: Er erhält kein
Lagebild, solange die Kopplung besteht, und liest danach wieder. Das Paneel zeigt dann nur
diesen Monitor mit „Freigabe ruht: Instanz meldet sich bei einem Hub“. Die Einsatzleitung kann
die Freigabe dort beenden; neu freigeben lässt sich an dieser Instanz erst wieder nach dem Ende
der Kopplung.

### Stand des Paneels und Verhalten ohne Netz

Das Paneel „Anbindungen“ fragt alle 30 Sekunden nach. Stellt eine andere Einsatzleitung die
Anbindung auf ihren Einsatz um oder widerruft der System-Admin sie, zeigt das Paneel das nach
spätestens dieser Zeit. Ohne Verbindung sind die Schalter gesperrt; daneben steht „Ohne
Verbindung nicht änderbar“. Eine Freigabe wird nie vorgemerkt und später nachgeholt.

### Was das Einsatztagebuch festhält

Freigabe, Ende der Freigabe und Umstellen auf einen anderen Einsatz stehen im Einsatztagebuch
des betroffenen Einsatzes, mit dem Namen der Person. An einem Spiegel geht der Eintrag als
Antrag an die führende Instanz. Beim Umstellen bekommt der frühere Einsatz seinen Eintrag, wenn
die Instanz ihn führt oder die Person auch dort zur Führung gehört.

Widerruft der System-Admin die Anbindung oder ändert er diese Rechte, steht das im
Einsatztagebuch des gelesenen Einsatzes, wenn die Instanz ihn führt, und immer im
[Zugangsprotokoll](zugangsprotokoll.md). Das Ende durch ein verstrichenes „Gültig bis“ trägt das
Einsatztagebuch nach, sobald der System-Admin die Anbindung das nächste Mal ändert, wenn die
Instanz den Einsatz führt und er noch läuft. An einem Spiegel entsteht dafür kein Eintrag.

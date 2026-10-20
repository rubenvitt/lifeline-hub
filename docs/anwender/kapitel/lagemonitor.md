---
titel: Lagemonitor
gruppen: [geraete]
reihenfolge: 770
quellen: [frontend/src/geraet/LagemonitorPage.tsx, frontend/src/geraet/LagemonitorKarte.tsx, frontend/src/geraet/GeraeteLayout.tsx, src/routes/lagemonitor.rs, src/meldung/repo.rs, src/geraet/mod.rs]
---

## Überblick

Der **Lagemonitor** ist ein Großbildschirm im Stabsraum oder Führungsfahrzeug. Er zeigt das
Lagebild des Einsatzes verdichtet in festen Kacheln: Lagekarte, offene Sofortmeldungen,
Betroffene, Kräfte und die Belegung der Unfallhilfsstellen, unten eine Statusleiste. Er zeigt
**keine Namen** und keinen Meldungstext, spielt keinen Ton und wird nicht bedient: Antippen und
Ziehen auf den Kacheln bleiben ohne Wirkung.

Den Monitor koppelt die Einsatzleitung mit der Ansicht „Lagemonitor“ (siehe
[Geräte koppeln](geraete-koppeln.md)). Gekoppelt wird wie bei jedem Gerät (siehe
[Gerät bedienen](geraet-bedienen.md)).

## Abläufe

### Anzeige starten

1. Den Monitor koppeln. Er öffnet das Großbild mit dem Knopf „Anzeige starten“.
2. „Anzeige starten“ wählen. Der Monitor wechselt in den Vollbildmodus und hält den Bildschirm
   wach.

   ![Lagemonitor mit Lagekarte samt Gefahrengebieten und Abschnittsfläche, darunter die Kachel Meldungen mit einer offenen Sofortmeldung, rechts die Kacheln Betroffene, Kräfte und Belegung der Unfallhilfsstellen, unten die Statusleiste](../bilder/lagemonitor/lagemonitor.png)

Kann der Browser den Bildschirm nicht wach halten, steht über der Statusleiste: „Dieser Browser
kann den Bildschirm nicht wach halten: bitte den Bildschirmschoner am Gerät abschalten.“

### Lagebild lesen

1. „Betroffene“ zählt gesamt, Patienten und vermisst, darunter die Sichtungskategorien SK I bis
   SK IV und „ungesichtet“. Patienten und Sichtungskategorien zählen nur, wer noch in Versorgung
   oder unterwegs ist; übergebene, entlassene und abgeschlossene Patienten zählen nur in
   „gesamt“.
2. „Kräfte“ zählt Personal, Einheiten und die Stärke F/UF/M; oben rechts steht, wie viele Kräfte an
   Unfallhilfsstellen arbeiten.
3. „Belegung der Unfallhilfsstellen“ nennt je UHS Belegte und Plätze, die vollsten zuerst, bis zu
   sechs; der Rest steht als „+… weitere“.
4. Die Lagekarte zeigt den Einsatzort, jede verortete UHS mit ihrer Belegung, die Gefahrenzonen
   (Gefahrengebiete, Absperrungen, Sperrgebiete) und die gezeichneten Flächen der
   Einsatzabschnitte mit ihrer Kurzbezeichnung, ohne Kurzbezeichnung mit ihrem Namen.
5. „Meldungen“ unter der Karte zählt die „Sofortmeldungen offen“, die noch niemand bestätigt
   hat.
6. Steigt die Zahl der offenen Sofortmeldungen oder die Zahl in SK I, ist sie eine Minute lang
   farbig hinterlegt, und oben in der Kachel steht „Neue Sofortmeldung“ bzw. „Neu in SK I“.
7. Die Statusleiste nennt Einsatz, Gerät, Verbindung („live“, „verbinde …“, „getrennt“), den
   Stand der Daten mit Alter und die Uhr.

### Gerätemenü öffnen

1. Drei Sekunden lang auf die Statusleiste drücken. Das Gerätemenü öffnet sich.

   ![Gerätemenü des Lagemonitors mit „Vollbild“, „Neu laden“, „Tag“, „Nacht“, „Automatik“, den Helligkeitsstufen und „Schließen“](../bilder/lagemonitor/geraetemenue.png)

2. „Vollbild“ oder „Neu laden“ wählen, die Darstellung („Tag“, „Nacht“, „Automatik“) oder eine
   Helligkeit von 100 % bis 20 % einstellen.
3. „Schließen“ wählen. Ohne Bedienung schließt das Menü nach 30 Sekunden von selbst.

## Hintergrund

### Aktualität

Der Monitor holt das Lagebild alle 30 Sekunden neu. Ist der Stand älter als zwei Minuten, steht
in der Statusleiste hervorgehoben „Veraltet · Stand …“. Dann zuerst die Verbindung prüfen; „Neu
laden“ im Gerätemenü baut die Seite neu auf.

### Offene Sofortmeldungen und neue Dringlichkeit

Als Sofortmeldung zählt eine Meldung der Art „Sofortmeldung“ oder mit der Priorität „Sofort“.
Offen bleibt sie, bis sie bestätigt oder erledigt ist (siehe [Meldungen](meldungen.md)). Der
Monitor erhält nur die Zahl, weder Text noch Absender oder Empfänger.

Ob eine Zahl gestiegen ist, vergleicht der Monitor mit seinem letzten Stand. Weil er alle
30 Sekunden abruft, erscheint eine neue Sofortmeldung spätestens nach einer halben Minute. Der
erste Stand nach dem Start oder nach „Neu laden“ wird nicht hervorgehoben, eine sinkende oder
gleichbleibende Zahl nie. Die Hervorhebung blinkt nicht und klingt nicht; fällt die Zahl auf
null, endet sie vorzeitig.

### Was der Monitor zeigt und was nicht

Der Monitor zeigt nur Zahlen und die Karte, keine Personendaten und keine Namen. Er schreibt
nichts: Er ist ein reiner Beobachter des Einsatzes. Hat der Einsatz keinen verorteten Einsatzort,
keine verortete UHS und keine Fläche, zeigt die Kartenkachel „Kein Einsatzort verortet“.

Auf der Karte fehlen Evakuierungsbezirke und freie Skizzen, außerdem Beschriftung und Notiz der
Gefahrenzonen sowie Leitung und Bemerkung der Abschnitte: Freitexte können Personen nennen.
Gefahrenzonen erscheinen unabhängig von der Kartenansicht, in der sie gezeichnet wurden.

### Ende der Kopplung

Wie jedes gekoppelte Gerät verliert der Monitor seinen Zugriff mit dem Widerruf, dem Ablauf der
Kopplung oder dem Abschluss des Einsatzes und zeigt dann „Kopplung beendet“. Für einen
Dauerbetrieb über 24 Stunden verlängert die Einsatzleitung die Kopplung rechtzeitig (siehe
[Geräte koppeln](geraete-koppeln.md)).

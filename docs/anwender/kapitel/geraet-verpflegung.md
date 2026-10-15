---
titel: Verpflegung am Gerät
gruppen: [geraete]
reihenfolge: 760
quellen: [frontend/src/pages/VerpflegungPage.tsx, frontend/src/verpflegung/ZeitfensterKarte.tsx, frontend/src/verpflegung/AusgabeAnsicht.tsx, frontend/src/verpflegung/ausgabeSammlung.ts, frontend/src/verpflegung/useAusgabeSammlung.ts, frontend/src/verpflegung/useAusgabeNachtragen.ts, frontend/src/verpflegung/VerpflegungDialoge.tsx, frontend/src/geraet/GeraeteLayout.tsx, frontend/src/verpflegung/deckung.ts, frontend/src/verpflegung/verpflegungText.ts, frontend/src/geraet/GeraetMeldungenPage.tsx, frontend/src/geraet/geraetSicht.ts, src/geraet/mod.rs, src/routes/verpflegung.rs]
---

## Überblick

Ein Tablet an der **Essensausgabe** zählt, wie viele Essensportionen (EP) je Zeitfenster
ausgegeben sind, und meldet eine Fehlmenge an die Einsatzleitung. Die Zeitfenster mit ihrem
Bedarf plant die Einsatzleitung; das Tablet arbeitet mit ihnen, plant aber selbst nicht.

Die Verpflegungsansicht ist an keine Stelle gebunden und sieht alle Zeitfenster des Einsatzes
(siehe [Geräte koppeln](geraete-koppeln.md)). Die Navigation unten führt zu „Verpflegung“ und
„Melden“. Die Bedienung des Geräts selbst steht in [Gerät bedienen](geraet-bedienen.md).

## Abläufe

### Zeitfenster im Blick behalten

1. „Verpflegung“ öffnen. Oben wechselt die Leiste zwischen „laufend & anstehend“ und „vergangen“.
2. Jede Karte zeigt Bezeichnung und Zeitraum, „Bedarf“ (Kräfte, Betreute, weitere),
   „Ausgegeben“ und „Fehlt“, darunter Sonderkost und die einzelnen Ausgaben.

   ![Zwei Zeitfenster am Verpflegungstablet: „Mittagessen“ mit Unterdeckung, 80 von 150 EP ausgegeben, und „Abendessen“ offen](../bilder/geraet-verpflegung/zeitfenster.png)

Rechts oben steht die Deckung: „gedeckt“, „offen“ (Fehlmenge, Zeitfenster noch nicht begonnen)
oder „Unterdeckung“ (Fehlmenge, Zeitfenster hat begonnen).

### Portionen zählen

1. Beim laufenden oder anstehenden Zeitfenster „Ausgabe öffnen“ wählen. Oben stehen „Soll“,
   „ausgegeben“ und „fehlt“, unten die Zähltasten; die Navigation zeigt weiter „Verpflegung“.
2. Je ausgegebene Portion „+1“ tippen, für mehrere „+5“, „+10“ oder „Menge …“. Für Sonderkost die
   Taste der Kostform tippen, etwa „vegetarisch“; sie zählt auch in die Sammlung.

   ![Ausgabe „Mittagessen“ am Tablet mit offener Sammlung, einem ausstehenden Eintrag unter „Letzte Buchungen“ und den Zähltasten am unteren Rand](../bilder/geraet-verpflegung/ausgabe-zaehlen.png)

3. Verzählt: „−1“ nimmt die zuletzt gezählte Portion zurück.
4. Nichts weiter tun: nach kurzer Ruhe bucht das Tablet die Sammlung als eine Ausgabe und meldet
   „Gebucht: …“ mit „Rückgängig“. „Buchen“ bucht sofort.

### Ausgabe nachtragen

1. Beim Zeitfenster „Ausgabe nachtragen“ wählen, auch bei einem vergangenen. Der Dialog
   „Ausgabe nachtragen: …“ nennt Bedarf, bisher Ausgegebenes und die Fehlmenge.
2. Unter „Menge (EP)“ die ausgegebenen Portionen eintragen, bei Bedarf „Ort“ und „Zeitpunkt“
   (leer heißt jetzt). Sonderkost und eine Bemerkung stehen unter „Weitere Angaben“.
3. „Nachtragen“ wählen. Die Ausgabe steht danach in der Karte, „Ausgegeben“ und „Fehlt“ rechnen
   sie mit.

### Ausgabe zurücknehmen

1. In der Karte oder unter „Letzte Buchungen“ bei der Ausgabe „Zurücknehmen“ wählen.
2. Die Rückfrage „Ausgabe zurücknehmen?“ mit „Zurücknehmen“ bestätigen.

Die Rücknahme ist endgültig. Eine falsch gezählte Ausgabe wird zurückgenommen und neu gezählt
oder nachgetragen.

### Fehlmenge melden

1. Beim Zeitfenster „Fehlmenge melden“ wählen. Der Knopf steht nur da, solange etwas fehlt.
2. Die Seite „Melden“ öffnet sich mit vorbereitetem Text, etwa „Fehlmenge Verpflegung ‚Mittagessen‘
   …: 70 EP (Bedarf 150, ausgegeben 80).“ samt fehlender Sonderkost.

   ![Seite „Melden“ mit vorbefüllter Fehlmeldung zum Mittagessen und der Priorität normal](../bilder/geraet-verpflegung/fehlmenge.png)

3. Bei Bedarf Text und „Priorität“ anpassen und „Meldung senden“ wählen.

## Hintergrund

### Was das Tablet nicht tut

Zeitfenster anlegen, den Bedarf ändern und Zeitfenster löschen bleiben der Einsatzleitung; am
Tablet fehlen diese Knöpfe. Eine Ausgabe auf eine Nachforderung zu buchen, lehnt der Server für
ein Gerät ab. Statt nachzufordern meldet das Tablet die Fehlmenge an die Einsatzleitung.

### Wie gezählt wird

Gezählte Portionen sammeln sich erst auf dem Tablet und gehen als eine Ausgabe an den Server:
3 Sekunden nach dem letzten Tipp, spätestens 15 Sekunden nach dem ersten, sofort ab 50 Portionen,
mit „Buchen“ oder wenn das Zeitfenster endet. Bei einem vergangenen Zeitfenster sind die
Zähltasten gesperrt („Zeitfenster vorbei“). „Fehlt“ zählt nur Gebuchtes; die Sammlung steht
daneben.

### Länge der Angaben

Der Ort einer Ausgabe darf höchstens 500 Zeichen lang sein, ihre Bemerkung 2 000. Darüber sendet
der Dialog „Ausgabe nachtragen“ nicht, und der Zähler unter dem Feld nennt die Überlänge; gekürzt
wird nichts. Eine zu lange Bemerkung klappt „Weitere Angaben“ beim Nachtragen auf. Zugeklappt
nennt der Kopf, was darin eingetragen ist, etwa „Weitere Angaben · 3 vegan · Bemerkung“.

### Ohne Netz

Ausgaben merkt das Gerät ohne Netz vor und sendet sie nach (siehe
[Arbeiten ohne Netz](ohne-netz.md)). Bis dahin stehen sie in der Karte als „ausstehend“, in der
Ausgabeansicht unter „Letzte Buchungen“ und als „+ … ausstehend“, und zählen noch nicht in
„Ausgegeben“ und „Fehlt“. Wird das Tablet gesperrt, die Ansicht verlassen oder ein anderes
Zeitfenster geöffnet, geht die offene Sammlung ohne Meldung in die Warteschlange; verloren geht
nichts. Startet das Tablet ohne Netz neu, stehen keine Zeitfenster bereit, und es gibt nichts zu
zählen; die Ausgabeansicht zeigt dann „Zeitfenster nicht geladen“.

### Absender der Meldungen

Meldungen tragen „Verpflegung“ und die Gerätebezeichnung als Absender, etwa „Verpflegung ·
Tablet Ausgabe“.

---
titel: Lagebild für Externe
gruppen: [fuehrung]
reihenfolge: 790
quellen: [frontend/src/pages/einstellungen/EinsatzLagebildExtern.tsx, frontend/src/extern/LagebildExternPage.tsx, src/routes/lagebild_extern.rs, src/lagebild_extern/mod.rs, src/routes/lagemonitor_v1.rs]
---

## Überblick

Das **Lagebild für Externe** zeigt Stellen ohne Konto, etwa dem Krisenstab des Kreises, der
Leitstelle oder der Pressestelle, das Lagebild eines Einsatzes im Browser. Die Einsatzleitung gibt
dafür je Empfänger einen **Link** aus. Der Link öffnet eine Seite nur zum Lesen, die sich alle
30 Sekunden selbst aktualisiert.

Jeder Link hat eine **Stufe**: „Lagebild“ zeigt Zahlen, Unfallhilfsstellen, Karte und
Lagemeldung, „Öffentlich“ nur die Gesamtzahlen, den Einsatzort und die Absperrungen. Für einen
eigenen Monitor mit Schnittstelle siehe [Externe Lagemonitore](externe-lagemonitore.md).

## Abläufe

### Link ausgeben

Für die Einsatzleitung:

1. Im Einsatz „Einstellungen“ und dort „Geräte“ öffnen.
2. Im Paneel „Lagebild für Externe“ „Link ausgeben“ wählen.
3. Den „Empfänger“ eintragen, etwa „Krisenstab Kreis“, die „Stufe“ und unter „Gültig“ die Dauer
   wählen. Vorgabe ist „Lagebild“ für „24 Stunden“.
4. „Ausgeben“ wählen. Der Dialog zeigt den Link als QR-Code und als Text mit Kopierknopf.
5. Den Link an den Empfänger weitergeben und „Fertig“ wählen. Der Link ist danach nicht mehr
   abrufbar.

### Lagebild öffnen

Für den Empfänger:

1. Den Link im Browser öffnen oder den QR-Code scannen.
2. Die Seite zeigt Einsatz, Stand und Gültigkeit und aktualisiert sich selbst. Neuladen und
   Lesezeichen behalten den Link.

Steht dort „Dieser Link gilt nicht mehr.“, ist der Link abgelaufen oder widerrufen oder der
Einsatz ist abgeschlossen.

### Link widerrufen

Für die Einsatzleitung:

1. Unter „Einstellungen“, „Geräte“ im Paneel „Lagebild für Externe“ an der Zeile des Empfängers
   „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

## Hintergrund

### Wer was darf

Links ausgeben und widerrufen darf nur die Einsatzleitung dieses Einsatzes, solange er aktiv ist,
auch an einem Spiegel. Eine andere Führungskraft sieht die Liste nicht. Der Empfänger braucht
kein Konto und sieht nur dieses eine Lagebild; der Link öffnet nichts anderes in der App.

### Inhalt je Stufe

Die Stufe „Lagebild“ zeigt Bezeichnung, Stichwort, Einsatzart und Beginn des Einsatzes, die
Betroffenen nach Sichtung, die Kräfte, die Unfallhilfsstellen mit Belegung und die Karte, also
dasselbe wie ein [externer Lagemonitor](externe-lagemonitore.md). Unter „Lagemeldung“ steht die
„Zusammenfassung“ des zuletzt freigegebenen Lageberichts (siehe [Lageberichte](lageberichte.md));
ein Entwurf geht nicht hinaus. Die Zusammenfassung geht so hinaus, wie sie freigegeben ist: Namen
gehören vor der Freigabe nicht hinein. Die Stufe „Öffentlich“ zeigt nur Bezeichnung, Stichwort,
Einsatzart und Beginn des Einsatzes, die Zahl der Betroffenen und der Einsatzkräfte und auf der
Karte den Einsatzort, die Absperrungen und die Sperrgebiete.
Namen der Betroffenen und Kräfte, Meldungstexte und das Einsatztagebuch zeigt keine Stufe.

Ist der Einsatz ein Spiegel, zeigt die Seite den Stand des letzten Abgleichs. Was die führende
Stelle nicht überträgt, steht dort als „nicht übertragen“, etwa „Karte: nicht übertragen“.

### Gültigkeit

Ein Link gilt 2, 12 oder 24 Stunden oder bis zum Einsatzende. Mit dem Abschluss des Einsatzes
endet jeder Link, auch einer mit längerer Dauer. Ein Link gilt nur an der Instanz, die ihn
ausgegeben hat; er wird nicht gespiegelt.

### Schlüssel und Protokoll

Der Link enthält einen Schlüssel. Der Server speichert ihn nicht, nur einen Prüfwert. Ist der
Link verloren, ihn widerrufen und einen neuen ausgeben. Die Zeile eines Links nennt, wie oft er
geöffnet wurde und wann zuletzt; darunter stehen die jüngsten Öffnungen mit Beginn, Ende und Zahl
der Abrufe. Eine Öffnung ist ein Aufruf der Seite bis zum Schließen. IP-Adressen werden nicht
festgehalten.

### Was das Einsatztagebuch festhält

Ausgabe und Widerruf stehen als Eintrag im Einsatztagebuch mit dem Empfänger und dem Namen der
Person. An einem Spiegel geht der Eintrag als Antrag an die führende Stelle. Ist der Abgleich
des Spiegels beendet, gilt ein Widerruf trotzdem, nur ohne Eintrag.

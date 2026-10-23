---
titel: Schäden
gruppen: [alle, fuehrung]
reihenfolge: 550
quellen: [frontend/src/pages/SchaedenPage.tsx, frontend/src/components/Datensicht.tsx, frontend/src/components/listenGedaechtnis.ts, frontend/src/pages/SchaedenDetailPage.tsx, frontend/src/pages/schaeden/SchadenErfassenModal.tsx, frontend/src/pages/schaeden/SchadenDaten.tsx, frontend/src/pages/schaeden/GeschaedigtPicker.tsx, frontend/src/components/VerlassenRueckfrage.tsx, frontend/src/pages/schaeden/schadenHelfer.tsx, frontend/src/pages/schaeden/GefahrAuswahl.tsx, frontend/src/pages/schaeden/gefahrWorte.ts, frontend/src/pages/schaeden/SchaedenDruckTabelle.tsx, frontend/src/zeichen/fachobjektZeichen.ts, frontend/src/pages/lagekarte/leistenDaten.ts, frontend/src/api/queryKeys.ts, src/routes/einsatz_schaden.rs, src/schaden/mod.rs]
---

## Überblick

Das Modul „Schäden“ sammelt, was im Einsatz beschädigt oder im Weg ist und nicht gleich behoben
wird: Sachschäden, Verkehrshindernisse, Schäden an der Infrastruktur, Umweltschäden, Tierkadaver
und Sonstiges. Jeder Schaden bekommt eine Registriernummer (S-001, S-002 …), einen Typ, ein Ausmaß
und einen Ort, bei Bedarf eine Gefahr und einen Schadensgrad. Er ist „offen“, bis er an eine zuständige Stelle „übergeben“ oder
„abgeschlossen“ wird. Verortete Schäden erscheinen als Zeichen auf der Lagekarte.

## Abläufe

### Die Schäden ablesen

1. Im Modulpanel „Schäden“ öffnen. Der Kopf zählt alle und die offenen Schäden.

   ![Liste der Schäden in der Sicht „Alle“ mit offenen, übergebenen und abgeschlossenen Schäden](../bilder/schaeden/liste.png)

2. Die Leiste „Offen“, „Übergeben“, „Abgeschlossen“, „Alle“ wählt die Sicht. Die Suche nach
   S-Nr., Ort und Beschreibung engt die Liste ein, ebenso die Filter im Kopf der Spalten „Typ“,
   „Ausmaß“, „Gefahr“ und „Verortet“: das Trichterzeichen im Spaltenkopf öffnet die Werte zum
   Ankreuzen, „OK“ übernimmt sie. Ein Klick auf den Spaltenkopf sortiert nach dieser Spalte. Ist
   die Liste eingeschränkt, steht darüber „Gefiltert“ mit der Zahl der Treffer und je Wert ein
   Knopf, etwa „Ausmaß: groß“, der genau diesen Filter entfernt; „Filter zurücksetzen“ leert Suche
   und Filter. Auf dem Handy stehen Filter und „Sortieren“ als Auswahlfelder über der Liste.
3. Der Status nennt bei übergebenen Schäden, an wen sie gingen. „Gefahr“ nennt Gefahr und
   Schadensgrad, etwa „Elektrizität · total zerstört“. „Verortet“ zeigt, ob der Schaden auf der
   Karte steht.
4. Ein Klick auf eine Zeile öffnet die Seite des Schadens. Stehen mehr Schäden an, lädt „Ältere
   laden“ den nächsten Teil.

### Einen Schaden erfassen

1. „Schaden erfassen“ wählen. Es öffnet sich der gleichnamige Dialog.
2. „Typ“, „Ausmaß“ („gering“, „mittel“, „groß“, „katastrophal“) und „Ort“ angeben; die drei
   Felder sind Pflicht. Den Ort eintippen und mit Enter oder „Ort suchen“ suchen, dann einen
   Treffer wählen: der Schaden ist damit verortet, der Kartenausschnitt unter dem Feld zeigt die
   Stelle. Ohne Treffer bleibt der Ort freier Text, und der Schaden ist „nicht verortet“. Eine
   bekannte Koordinate lässt sich gleich ins Feld tippen; „Auf Karte wählen“ setzt den Punkt auf
   einer großen Karte. Bei Bedarf die „Gefahr“ wählen, etwa „Elektrizität“ oder „Brand“. Neben
   jeder Gefahr steht das Zeichen, das der Schaden damit auf der Lagekarte bekommt.

   ![Dialog „Schaden erfassen“ mit Typ, Ausmaß, Ort und Gefahr](../bilder/schaeden/erfassen.png)

3. Unter „Weitere Angaben“ bei Bedarf eine „Beschreibung“, den „Schadensgrad“ („angeschlagen“,
   „teilzerstört“, „total zerstört“), „Geschädigt“ (eine betroffene Person, eine Einsatzkraft,
   die eigene Organisation oder ein freier Kontakt) eintragen.
4. „Anlegen“ wählen. Der Schaden steht als „offen“ in der Liste.

Mehrere Schäden am selben Ort: „Speichern und nächste“ hält den Dialog offen, mit „Werte
behalten“ bleibt der Ort samt Koordinate stehen.

### Einen Schaden übergeben

1. Die Seite eines offenen Schadens öffnen und „Schaden übergeben“ wählen.
2. Unter „Übergeben an“ die zuständige Stelle eintragen, etwa Stadtwerke, Bauhof oder Umweltamt.

   ![Dialog „Schaden übergeben“ mit dem Feld „Übergeben an“](../bilder/schaeden/uebergeben.png)

3. „Schaden übergeben“ wählen. Der Schaden steht auf „übergeben“.

Übergeben lässt sich nur ein offener Schaden.

### Einen Schaden abschließen

1. Die Seite des Schadens öffnen. Bei einem übergebenen Schaden „Schaden abschließen“ wählen, bei
   einem offenen im Menü „Weitere Aktionen“ „Ohne Übergabe abschließen“.
2. Den „Abschlussgrund“ wählen: „behoben“, „kein Handlungsbedarf“ oder „abgewiesen“; bei Bedarf
   eine „Notiz (optional)“.
3. „Schaden abschließen“ wählen.

„abgeschlossen“ ist endgültig.

### Einen Schaden stornieren

1. Die Seite des Schadens öffnen und im Menü „Weitere Aktionen“ „Stornieren“ wählen.
2. Die Rückfrage mit „Schaden stornieren“ bestätigen. Die Seite kehrt zur Liste zurück.

### Einen Schaden auf der Karte verorten

1. Die Seite des Schadens öffnen. Unter „Verortung“ steht „nicht verortet“.
2. „Auf Karte verorten“ wählen. Die Lagekarte öffnet sich und nimmt die Stelle des Schadens auf
   ([Lagekarte, Zeichnen und Messen](lagekarte.md)).
3. Nach dem Tipp auf die Karte meldet sie „S-… verortet“. „Zurück zu S-…“ führt auf die Seite
   des Schadens zurück.

Schneller geht es über das Feld „Ort“ beim Erfassen oder unter „Bearbeiten“: ein Treffer der
Ortssuche, eine getippte Koordinate oder „Auf Karte wählen“ verortet den Schaden gleich mit.

## Hintergrund

### Status

Ein Schaden geht von „offen“ nach „übergeben“ oder direkt nach „abgeschlossen“, von „übergeben“
nach „abgeschlossen“. „Bearbeiten“ auf der Seite des Schadens ändert Typ, Ausmaß, Gefahr,
Schadensgrad, Ort, Beschreibung und Geschädigt, auch nach dem Abschluss. „Stornieren“ nimmt eine Fehlerfassung aus
der Liste, in jedem Status; ein stornierter Schaden trägt im Titel „storniert“ und lässt sich
nicht mehr ändern. Fotos und Dateien zum Schaden liegen auf seiner Seite.

### Gefahr und Schadensgrad

Die Gefahr nimmt dieselben Wörter wie die Gefahrengebiete ([Gefahren](gefahren.md)). Auf der
Lagekarte trägt das Gefahrenzeichen des Schadens weiter die Farbe seines Ausmaßes; dazu kommen
der Gefahrenhinweis nach DV 102 und der Schadensgrad als Schraffur. Einen Gefahrenhinweis gibt
es für Atomare Strahlung, Chemische Stoffe, Explosion, Elektrizität und Ertrinken (als
Wassereinbruch); bei den übrigen Gefahren bleibt das Zeichen ohne Hinweis. Die Auswahl auf der
Karte nennt Gefahr und Schadensgrad in Worten.

Wer geschädigt ist, lässt sich auch von der Seite einer betroffenen Person aus zuordnen („Bezug
hinzufügen“ unter „Bezüge“, [Betroffene und Sichtung](betroffene.md)).

### Bearbeiten

„Speichern“ und „Abbrechen“ bleiben am unteren Rand stehen, auch wenn die Seite rollt. Ohne Ort
oder mit einer Beschreibung über 8.000 Zeichen speichert die Seite nicht; der Grund steht unter
dem Feld („Ort ist Pflicht“), und das Feld hat den Fokus. Wer die Seite mit ungespeicherten
Eingaben verlassen will, bekommt die Rückfrage „Ungespeicherte Änderungen“: „Bleiben“ behält die
Eingaben, „Verwerfen“ verlässt die Seite ohne sie.

### Ort und Koordinate

Beim Bearbeiten zeigt das Feld „Ort“ einen verorteten Schaden mit Kartenausschnitt und Nadel.
Eine Korrektur am Text („Hauptstr. 17“ → „Hauptstr. 17a“) behält den Punkt; ein neuer Treffer
ersetzt ihn, die gezogene Nadel berichtigt ihn. Unter dem Ausschnitt stehen Ortsname und Peilung
zum nächsten verorteten Objekt. Wie die Ortssuche arbeitet und was sie an den Geocoder schickt,
steht unter [Einsatzdaten](einsatzdaten.md), „Adresse und Koordinate des Einsatzorts“. Ohne Netz
bleibt „Ort suchen“ gesperrt; Freitext, getippte Koordinate und „Auf Karte wählen“ mit
Offline-Karten gehen weiter.

### Einsatztagebuch

Das Einsatztagebuch vermerkt Anlegen (mit Typ, Ausmaß, Gefahr und Schadensgrad, ohne Ort),
Übergabe (ohne Empfänger), Abschluss (mit Grund) und Stornieren, jeweils mit der
Registriernummer.

### Filter und Sortierung bleiben stehen

Suche, Filter und Sortierung stehen in der Adresse der Seite. Zurück aus einem Schaden, Neuladen
und ein weitergegebener Link zeigen dieselbe Liste. Wer die Schäden später über das Modulpanel
wieder öffnet, findet die Einschränkung vom letzten Mal, bis zur Abmeldung. Welche Spalten
ausgeblendet sind, merkt sich das Gerät.

### Druck und Export

„Drucken / als PDF“ druckt die Liste in der gewählten Sicht, „CSV exportieren“ gibt alle nicht
stornierten Schäden als Tabelle aus, ohne Angaben zu Geschädigten. Beide nennen Gefahr und
Schadensgrad in Worten.

### Rechte

Erfassen, übergeben, abschließen und ändern dürfen Einsatzleitung und Führungspersonal eines
laufenden Einsatzes ([Rechte im Einsatz](rechte-im-einsatz.md)).

### Ohne Netz

Die Liste der Schäden und ihre Zeichen auf der Lagekarte bleiben ohne Netz lesbar. Erfassen und
ändern gehen nur mit Netz ([Arbeiten ohne Netz](ohne-netz.md)).

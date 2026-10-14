---
titel: Material
gruppen: [fuehrung]
reihenfolge: 340
quellen: [frontend/src/pages/MaterialPage.tsx, frontend/src/kraefte/EntlassenBlock.tsx, frontend/src/theme/statusFarben.ts, frontend/src/stammdaten/demoAuswahl.tsx, frontend/src/components/Erfassung.tsx, frontend/src/einsatz/schreibrecht.ts, src/routes/einsatz_material.rs, src/material/disposition_repo.rs, migrations/0019_einsatz_material.sql]
---

## Überblick

Das Modul **Material** führt Geräte und Verbrauchsgüter, die im Einsatz sind: Posten aus dem
Materialstamm der Organisation und Ad-hoc-Material ohne Stammeintrag, etwa Spenden oder Material
einer fremden Organisation. Je Posten stehen Bezeichnung, Kategorie, Menge, Status und Bemerkung.

Die Führung liest hier, was einsatzbereit, im Einsatz, defekt oder verbraucht ist. Disponieren und
ändern dürfen Einsatzleitung und Führungspersonal.

## Abläufe

### Die Materialliste lesen

1. Unter „Kräfte & Mittel“ „Material“ öffnen.
2. Die Liste ist nach Status gruppiert; die Zeile über der Tabelle zählt die Posten je Status. In
   „Bezeichnung, Kategorie“ suchen oder nach „Kategorie“ und „Status“ filtern.

   ![Materialliste mit vier Posten, darunter ein Ad-hoc-Posten „Spende-Decken“ und ein defekter Stromerzeuger mit Bemerkung, je Posten „Aus dem Einsatz nehmen“, darunter der eingeklappte Block „Aus dem Einsatz genommen (1)“](../bilder/material/material.png)

### Material aus dem Stamm disponieren

Für Einsatzleitung und Führungspersonal:

1. „Material disponieren“ wählen.
2. Unter „Material“ einen Posten wählen und die „Menge“ eingeben.

   ![Dialog „Material disponieren“ mit dem Feldbettensatz und Menge 2](../bilder/material/material-disponieren.png)

3. „Disponieren“ wählen, oder „Speichern und nächste“ für den nächsten Posten.

### Ad-hoc-Material erfassen

Für Einsatzleitung und Führungspersonal, wenn ein Posten nicht im Materialstamm steht:

1. „Ad-hoc-Material“ wählen.
2. „Bezeichnung“ und „Menge“ eingeben, bei Bedarf „Kategorie“, „Trägerorganisation“ und unter
   „Weitere Angaben“ die „Bestandsnummer“.

   ![Dialog „Ad-hoc-Material ohne Stammeintrag“ mit Sandsäcken, Menge 200, Kategorie und Trägerorganisation](../bilder/material/adhoc-material.png)

3. „Disponieren“ wählen. Mit „Speichern und nächste“ und „Werte behalten“ bleiben Kategorie und
   Trägerorganisation für den nächsten Posten stehen.

Ad-hoc-Posten tragen in der Liste die Marke „ad-hoc“.

### Menge, Status und Bemerkung ändern

Für Einsatzleitung und Führungspersonal:

1. In der Spalte „Menge“ die neue Menge eintippen und mit Enter bestätigen oder das Feld verlassen.
   Die Menge ist mindestens 1.
2. In der Spalte „Status“ einen Status wählen: einsatzbereit, im Einsatz, defekt, verbraucht oder
   Desinfektion nötig.
3. In der Spalte „Bemerkung“ „Bemerkung hinzufügen“ wählen und den Text eintragen.

### Material aus dem Einsatz nehmen

Für Einsatzleitung und Führungspersonal, wenn ein Posten den Einsatz verlässt:

1. In der Zeile des Postens „Aus dem Einsatz nehmen“ wählen. Eine Rückfrage gibt es nicht.
2. Der Posten verlässt die Liste. Der Hinweis unten bietet einige Sekunden lang „Rückgängig“.
3. Unter der Liste „Aus dem Einsatz genommen“ aufklappen. Dort stehen alle herausgenommenen
   Posten mit Menge und Zeitpunkt.

   ![Aufgeklappter Block „Aus dem Einsatz genommen (1)“ unter der Materialliste mit einem Posten, seiner Menge, dem Zeitpunkt und dem Knopf „Erneut disponieren“](../bilder/material/aus-dem-einsatz.png)

4. Kommt der Posten zurück, „Erneut disponieren“ wählen.

### Eine Fehldisposition stornieren

Für Einsatzleitung und Führungspersonal, wenn ein Posten versehentlich disponiert wurde:

1. In der Zeile des Postens „Weitere Aktionen“ öffnen und „Stornieren“ wählen.
2. Die Rückfrage „… stornieren?“ mit „Stornieren“ bestätigen.
3. Lehnt die App ab, steht der Grund an der Zeile; der Posten lässt sich dann nur aus dem Einsatz
   nehmen.

## Hintergrund

### Mehrere Posten derselben Art

Derselbe Stammposten lässt sich mehrmals disponieren, jeweils als eigene Zeile mit eigener Menge und
eigenem Status. So lässt sich eine Menge auf mehrere Einheiten aufteilen. Die Auswahl bietet den
Materialstamm an, soweit er in Dienst steht; Demo-Posten stehen in einer eigenen Gruppe am Ende.

### Status

Ein disponierter Posten beginnt mit „einsatzbereit“. Die fünf Statuswerte sind fest und gelten für
jede Organisation.

### Einheiten und Meldebild

Einer Einheit wird Material im Modul [Einheiten](einheiten.md) zugeordnet. Im Meldebild steht
Material unter der aufgeklappten Einheit und im übernommenen Lagebericht; die Zahl der Kräfte im
Meldebild zählt nur Personal und Fahrzeuge (Kapitel [Meldebild und Kräfte-Zeitachse](meldebild.md)).

### Aus dem Einsatz nehmen und Stornieren

Aus dem Einsatz nehmen ist der Normalweg: Der Posten verlässt seine Einheit und eine UHS. In
Auswahllisten, im Meldebild und in der UHS zählt er nicht mehr; der Block „Aus dem Einsatz
genommen“ unter der Liste führt ihn weiter. Erneut disponiert, steht er wieder in der Liste, mit
derselben Menge und demselben Status; Einheit und UHS kommen nicht zurück. „Material disponieren“
legt dagegen immer eine neue Zeile an.

Stornieren korrigiert eine Fehldisposition und lässt keine Spur. Es geht nur in den ersten 15
Minuten nach der Disposition und nur, solange der Posten keiner Einheit und keiner UHS zugeordnet
ist. Wer einmal aus dem Einsatz genommen war, lässt sich auch nach dem erneuten Disponieren nicht
mehr stornieren. Ein stornierter Posten erscheint in keiner Liste.

An einem herausgenommenen oder stornierten Posten lässt sich nichts mehr ändern: Menge, Status und
Bemerkung setzen und einer Einheit zuordnen lehnt die App ab.

### Einsatztagebuch

Disponieren, jede Mengen- und Statusänderung, das Herausnehmen, das erneute Disponieren und das
Stornieren stehen im Einsatztagebuch, mit alter und neuer Menge bzw. altem und neuem Status. Eine
Bemerkung ändert es nicht.

### Rechte und ohne Netz

Lesen darf, wer das Modul Material sieht. Disponieren, ändern, aus dem Einsatz nehmen und
stornieren dürfen Einsatzleitung und Führungspersonal, solange der Einsatz läuft (Kapitel [Rechte im Einsatz](rechte-im-einsatz.md)).
Ohne Netz bleibt die Liste mit dem zuletzt geladenen Stand lesbar; ändern lässt sich nichts (Kapitel
[Ohne Netz](ohne-netz.md)).

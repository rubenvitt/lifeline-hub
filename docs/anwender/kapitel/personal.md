---
titel: Personal
gruppen: [fuehrung]
reihenfolge: 320
quellen: [frontend/src/pages/PersonalPage.tsx, frontend/src/kraefte/EinsatzfunktionZelle.tsx, frontend/src/kraefte/einsatzfunktionKern.ts, frontend/src/kraefte/PersonalDisponierenModal.tsx, frontend/src/kraefte/SammelGruende.tsx, frontend/src/kraefte/EntlassenBlock.tsx, frontend/src/kraefte/AdhocPersonModal.tsx, frontend/src/kraefte/statusAchse.ts, frontend/src/kraefte/KraftZeitachse.tsx, frontend/src/components/Erfassung.tsx, frontend/src/einsatz/schreibrecht.ts, src/routes/einsatz_personal.rs, src/personal/repo.rs, src/personal/disposition_repo.rs, src/kraefte_disposition.rs, src/entlassung.rs, src/auth/bootstrap.rs]
---

## Überblick

Das Modul **Personal** führt alle Einsatzkräfte, die im Einsatz disponiert sind: Personen aus dem
Personalstamm der Organisation und Ad-hoc-Kräfte, die nur in diesem Einsatz vorkommen. Je Person
stehen Einsatzfunktion und Qualifikation, Träger, Fahrzeug, Einheit, Stärke-Position, Status,
Einsatzdauer und Ruhezeit.

Die Führung liest hier, wer verfügbar oder gebunden ist und wer wie lange im Einsatz steht.
Disponieren, Status setzen und entlassen dürfen Einsatzleitung und Führungspersonal.

## Abläufe

### Die Personalliste lesen

1. Unter „Kräfte & Mittel“ „Personal“ öffnen. Über der Liste steht die Stärke mit der Verteilung der
   Kräfte, daneben der Sprung ins „Meldebild“.
2. Die Liste ist nach Statuskategorie gruppiert: verfügbar, gebunden, nicht verfügbar, ohne Status.
   In „Name, Funktion“ suchen oder unter „Status“ eine Kategorie wählen.

   ![Personalliste mit Name, Funktion, Position, Status, Einsatzdauer, Ruhe und dem Knopf „Entlassen“ je Person; Anna Probe trägt die Einsatzfunktion „Sprechfunker“ über der Qualifikation „Notarzt“, die anderen „Funktion eintragen“](../bilder/personal/personal.png)

3. Unter „Spalten“ ausgeblendete Spalten wie „Träger“, „Fahrzeug“, „Einheit“ oder „Bemerkung“
   einblenden.

### Personal aus dem Stamm disponieren

Für Einsatzleitung und Führungspersonal, für eine Person oder eine ganze Gruppe:

1. „Personal disponieren“ wählen.
2. Unter „Personen“ eine oder mehrere Personen aus dem Personalstamm wählen. Die Suche findet
   Name, Personalnummer, Träger und Qualifikation.
3. Bei Bedarf unter „In Einheit“ die Einheit und unter „Auf Fahrzeug“ das Fahrzeug wählen. Mit
   gewählter Einheit stehen nur ihre Fahrzeuge zur Wahl.

   ![Dialog „Personal disponieren“ mit zwei gewählten Personen, der Einheit „Rettungsstaffel“, dem Fahrzeug „Musterstadt 83-1 (RTW)“ und den Knöpfen „Speichern und nächste“ und „Disponieren“](../bilder/personal/personal-disponieren.png)

4. „Disponieren“ wählen. Für die nächste Gruppe „Speichern und nächste“ (Strg + Enter) wählen; mit
   „Werte behalten“ bleibt die Einheit stehen, das Fahrzeug nicht.
5. Lässt sich eine Person nicht disponieren, nimmt die App keine der gewählten auf. Unter der
   Auswahl steht je Person der Grund, etwa „außer Dienst“ oder „schon disponiert“. „Abgelehnte
   abwählen“ nimmt diese Personen aus der Auswahl, danach erneut „Disponieren“ wählen.

### Eine Ad-hoc-Person disponieren

Für Einsatzleitung und Führungspersonal, wenn eine Kraft nicht im Personalstamm steht:

1. „Ad-hoc-Person“ wählen.
2. „Name“ eingeben, bei Bedarf „Qualifikation“, „Trägerorganisation“ und „Stärke-Position“.

   ![Dialog „Ad-hoc-Person disponieren“ mit Name, Qualifikation, Trägerorganisation, Stärke-Position und den Knöpfen „Speichern und nächste“ und „Disponieren“](../bilder/personal/adhoc-person.png)

3. „Disponieren“ wählen. Für eine ganze Gruppe „Speichern und nächste“ (Strg + Enter) wählen; mit
   „Werte behalten“ bleiben Trägerorganisation und Stärke-Position für die nächste Person stehen.

Ad-hoc-Kräfte tragen in der Liste die Marke „ad-hoc“.

### Eine Einsatzfunktion vergeben

Für Einsatzleitung und Führungspersonal, wenn eine Person im Einsatz eine Aufgabe übernimmt:

1. In der Spalte „Funktion“ der Person „Funktion eintragen“ wählen, bei einer schon vergebenen
   Einsatzfunktion auf ihren Text klicken.
2. Eine Funktion aus den Vorschlägen wählen oder einen eigenen Text eingeben, etwa „Sprechfunker“.
3. „Speichern“ wählen oder Enter drücken. Die Einsatzfunktion steht über der Qualifikation.
4. Zum Entfernen das Feld leeren und speichern.

### Status, Position und Bemerkung ändern

Für Einsatzleitung und Führungspersonal:

1. In der Spalte „Status“ den Status der Person wählen.
2. In der Spalte „Position“ Führer, Unterführer oder Mannschaft wählen; sie zählt in die Stärke.
3. Eine Bemerkung in der Spalte „Bemerkung“ eintragen (unter „Spalten“ einblenden).

### Einsatzdauer und Ruhezeit einer Person ablesen

1. In der Liste „Einsatzdauer“ und „Ruhe“ lesen.
2. Für die Einzelheiten „Zeitachse“ neben dem Namen aufklappen.

   ![Aufgeklappte Zeitachse von Lena Beispiel mit „Ruhe 40 min · gesamt 4 h 00“, Eintreffen und Entlassung](../bilder/personal/zeitachse-person.png)

3. Fehlt ein Ereignis, mit „Nachtragen“ ergänzen (Kapitel [Meldebild und
   Kräfte-Zeitachse](meldebild.md)).

### Eine Person aus dem Einsatz entlassen

Für Einsatzleitung und Führungspersonal:

1. Ist die Person schon früher gegangen, zuerst in ihrer „Zeitachse“ mit „Nachtragen“ die
   Entlassung mit der richtigen Zeit erfassen. Die App trägt dann keine zweite ein.
2. In der Zeile der Person „Entlassen“ wählen. Eine Rückfrage gibt es nicht.
3. Die Person verlässt die Liste. Der Hinweis unten bietet einige Sekunden lang „Rückgängig“.
4. Unter der Liste „Entlassen“ aufklappen. Dort stehen alle entlassenen Personen mit dem Zeitpunkt.

   ![Aufgeklappter Block „Entlassen (1)“ unter der Personalliste mit einer Person, ihrer Funktion, dem Zeitpunkt und dem Knopf „Erneut disponieren“](../bilder/personal/entlassen.png)

5. Kommt die Person zurück, „Erneut disponieren“ wählen.

### Eine Fehldisposition stornieren

Für Einsatzleitung und Führungspersonal, kurz nachdem eine Person versehentlich disponiert wurde:

1. In der Zeile der Person „Weitere Aktionen“ öffnen und „Stornieren“ wählen.
2. Die Rückfrage „… stornieren?“ mit „Stornieren“ bestätigen.
3. Lehnt die App ab, steht der Grund an der Zeile; die Person lässt sich dann nur entlassen.

## Hintergrund

### Wer zur Auswahl steht

„Personal disponieren“ bietet die Personen des Personalstamms an, die in Dienst stehen und noch
nicht im Einsatz sind. Eine entlassene Person fehlt dort; sie kommt über „Erneut disponieren“ im
Block „Entlassen“ zurück, mit ihrer Zeitachse. Ad-hoc-Kräfte gibt es nur im Einsatz; im
Personalstamm erscheinen sie nicht.

Ein Absenden nimmt höchstens 50 Personen auf und gilt ganz oder gar nicht: Steht eine Person
inzwischen außer Dienst, ist sie schon disponiert oder entlassen, legt die App niemanden an und
nennt den Grund je Person.

### Einsatzfunktion und Qualifikation

Die Einsatzfunktion sagt, was eine Person in diesem Einsatz tut (Sprechfunker, Melder, Fahrer);
die Qualifikation, was sie kann. Die Qualifikation einer Stamm-Person kommt aus dem Personalstamm
und wird dort gepflegt; die einer Ad-hoc-Kraft ist der Text aus dem Dialog. Die Einsatzfunktion
gilt nur im Einsatz und wechselt, so oft es die Lage verlangt.

Vorgeschlagen werden zuerst die im Einsatz schon vergebenen Einsatzfunktionen, dann Funktionen
nach FwDV 3 und FwDV 100 (Einheitsführer, Gruppenführer, Truppführer, Maschinist, Melder,
Sprechfunker, Fahrer), dann die Qualifikationen der Organisation. Ein eigener Text darf bis zu 200
Zeichen lang sein, eine Bemerkung bis zu 2 000.

Wo eine Person mit nur einer Angabe steht, nennt die App die Einsatzfunktion, ohne sie die
Qualifikation: im Meldebild und seiner Übernahme in einen Lagebericht, im Block „Entlassen“, in
der Anlage „Personal je Kopf“ des Einsatzberichts, in den Personenauswahlen von Stab-Besetzung,
Einsatzleitung, Schäden und UHS und im Einsatztagebuch. Die Vorschau in der Sprungpalette zeigt
beide. Entlassen und erneut disponiert, behält die Person ihre Einsatzfunktion.

### Status

Die Statuswerte pflegt die Organisation selbst; jeder gehört zu einer Kategorie (verfügbar,
gebunden, nicht verfügbar). Eine neue Organisation beginnt mit „verfügbar“, „alarmiert“, „auf
Anfahrt“, „im Einsatz“, „Pause“ und „abgemeldet“. „alarmiert“, „im Einsatz“ und „abgemeldet“
schreiben dabei Alarmierung, Eintreffen und Entlassung in die Kräfte-Zeitachse.

### Einheit, Fahrzeug und Position

Beim Disponieren aus dem Stamm lassen sich Einheit und Fahrzeug gleich mitgeben; die Felder „In
Einheit“ und „Auf Fahrzeug“ stehen nur, wenn die Module Einheiten und Fahrzeuge im Einsatz
freigegeben sind. Gehört das Fahrzeug nicht zur gewählten Einheit, lehnt die App ab. Später wird
eine Person im Modul [Einheiten](einheiten.md) einer Einheit zugeordnet, einem Fahrzeug als
Besatzung im Modul [Fahrzeuge und FMS](fahrzeuge.md). Die Stärke-Position bestimmt, ob die Person
als Führer, Unterführer oder Mannschaft zählt; Einheitsführer ist ein eigenes Merkmal der Einheit.

### Entlassen und Stornieren

Entlassen ist der Normalweg: Die Person verlässt Einheit, Fahrzeug, UHS, Stab und Führungsstelle.
War sie Einheitsführer oder Leiter eines Einsatzabschnitts, ist diese Stelle danach leer. Ihre
Zeitachse bleibt, mit offener Periode endet sie mit einer „Entlassung“ (Herkunft „aus dem Einsatz
entlassen“). In Stärke, Statusband, Lagemonitor und Auswahllisten zählt sie nicht mehr. Im Nachweis
bleibt sie: im Block „Entlassen“ unter der Personalliste und im Meldebild, in der Übernahme des
Meldebilds in einen Lagebericht, in „insgesamt eingesetzt“ und in der Anlage „Personal je Kopf“ des
Einsatzberichts. Erneut disponiert, steht sie wieder in der Liste; ihre Zeitachse läuft weiter,
ihre Bindungen kommen nicht zurück.

Stornieren korrigiert eine Fehldisposition und lässt keine Spur. Es geht nur in den ersten 15
Minuten nach der Disposition und nur, solange die Person noch nichts im Einsatz hat: keine Einheit,
kein Fahrzeug, keine Rolle, keine Ereignisse außer denen aus der Disposition. Wer einmal entlassen
war, lässt sich auch nach dem erneuten Disponieren nicht mehr stornieren. Eine stornierte Person
erscheint in keinem Nachweis; ihre Ereignisse sind gestrichen.

An einer entlassenen oder stornierten Person lässt sich nichts mehr ändern: Zuordnen, Status setzen
und Nachtragen lehnt die App ab.

### Einsatztagebuch

Disponieren, jeder Statuswechsel, das Entlassen, das erneute Disponieren und das Stornieren stehen
im Einsatztagebuch. Eine Gruppe aus einem Absenden steht dort als ein Eintrag mit Zahl, Einheit,
Fahrzeug und den Namen. Eine vergebene, geänderte oder entfernte Einsatzfunktion steht dort mit
altem und neuem Wert, etwa „Person «Anna Probe»: Funktion «—» → «Sprechfunker»“. Position und
Bemerkung ändern es nicht.

### Rechte und ohne Netz

Lesen darf, wer das Modul Personal sieht. Disponieren, ändern, entlassen und stornieren dürfen
Einsatzleitung und Führungspersonal, solange der Einsatz läuft (Kapitel [Rechte im
Einsatz](rechte-im-einsatz.md)). Ohne Netz bleibt die Liste mit dem zuletzt geladenen Stand lesbar;
ändern lässt sich nichts (Kapitel [Ohne Netz](ohne-netz.md)).

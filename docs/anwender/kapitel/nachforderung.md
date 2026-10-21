---
titel: Nachforderung
gruppen: [fuehrung]
reihenfolge: 140
quellen: [src/einsatz/fuehrungsstelle.rs, frontend/src/etb/EtbBacklinkBadges.tsx, frontend/src/pages/NachforderungenPage.tsx, frontend/src/nachforderungen/NachforderungFormular.tsx, frontend/src/nachforderungen/NachforderungKarte.tsx, frontend/src/nachforderungen/MaterialUebernahmeModal.tsx, frontend/src/nachforderungen/materialUebernahme.ts, src/routes/einsatz_material.rs, src/material/mod.rs, migrations/0198_material_nachforderung.sql, frontend/src/kommunikation/phase.ts, frontend/src/kommunikation/rueckgaengig.tsx, frontend/src/pages/VerpflegungPage.tsx, frontend/src/pages/uhs/MaterialTab.tsx, frontend/src/routing/deeplinks.ts, frontend/src/betreuung/StelleBedarf.tsx, migrations/0231_nachforderung_betreuungsstelle.sql, src/routes/nachforderung.rs, src/nachforderung/repo.rs, src/nachforderung/mod.rs, frontend/src/stammdaten/externeStellenVorschlaege.ts, src/nachforderung/benachrichtigung.rs, src/benachrichtigung/text.rs]
---

## Überblick

Reichen die eigenen Kräfte und Mittel nicht, fordert die Führung nach: Rettungswagen, eine
Einsatzeinheit, Sandsäcke. Das Modul „Nachforderung“ hält jede Anforderung fest und verfolgt sie
über die Stufen **Angefordert**, **Zugesagt**, **Unterwegs** und **Eingetroffen**. Eine
Anforderung kann auch abgelehnt werden.

Lesen dürfen alle mit Zugang zum Einsatz. Nachfordern und den Stand fortschreiben dürfen
Einsatzleitung und Führungspersonal, solange der Einsatz läuft (siehe
[Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Eine Nachforderung absetzen

Für Einsatzleitung und Führungspersonal:

1. Im Einsatz „Nachforderung“ öffnen und „Nachforderung anlegen“ wählen.
2. Im Formular „Neue Nachforderung“ unter „Art (Kräfte/Mittel)“ angeben, was gebraucht wird, und
   unter „Anzahl“, wie viel.

   ![Formular „Neue Nachforderung“ mit Art „Tauchpumpe“, Anzahl 3, Bezeichnung, Adressat „Leitstelle“, Priorität und Begründung](../bilder/nachforderung/nachforderung-absetzen.png)

3. Unter „Bezeichnung / Bedarf“ den Bedarf genauer beschreiben.
4. Den „Adressat“ wählen: „Leitstelle“ (vorbelegt), „Nachbar-Einsatzabschnitt“, „Übergeordnete
   Führung“ oder „Andere BOS“. Bei Bedarf unter „Adressat-Bezeichnung“ die Stelle genauer nennen;
   beim Tippen schlägt die App die externen Stellen aus den Stammdaten vor.
5. „Priorität“ setzen und unter „Begründung / Lagebezug“ den Grund eintragen.
6. „Nachforderung absetzen“ wählen.

„Speichern und nächste“ (Strg+Enter, am Mac ⌘+Enter) setzt ab und leert das Formular. Mit dem
Häkchen „Werte behalten“ bleiben Adressat, Adressat-Bezeichnung und Priorität stehen.

### Den Stand fortschreiben

Für Einsatzleitung und Führungspersonal:

1. In der Ansicht „Offen“ die Karte der Nachforderung suchen. Sie zeigt Priorität, Stufe, Menge,
   Art, Adressat und die bisherigen Zeitpunkte.

   ![Drei offene Nachforderungen in den Stufen Zugesagt, Angefordert und Unterwegs, je mit dem nächsten Schritt und „Ablehnen“](../bilder/nachforderung/nachforderungen-liste.png)

2. Den nächsten Schritt wählen: „Zusage erfassen“, sobald die Stelle zusagt, „Abfahrt melden“,
   sobald die Kräfte unterwegs sind, „Eintreffen melden“, sobald sie da sind.

Ein Hinweis bietet nach jedem Schritt sechs Sekunden lang „Rückgängig“. Eine eingetroffene
Nachforderung steht in der Ansicht „Abgeschlossen“.

### Eingetroffenes Material übernehmen

Für Einsatzleitung und Führungspersonal, wenn das Modul Material freigegeben ist:

1. In der Ansicht „Abgeschlossen“ an der Karte der eingetroffenen Nachforderung „Als Material
   übernehmen“ wählen.
2. Der Dialog nennt im Titel die Art der Nachforderung, etwa „„Tauchpumpe“ als Material
   übernehmen“, darunter den Bedarf. Unter „Art“ „Gerät“ oder „Verbrauchsgut“ wählen.

   ![Dialog „„Tauchpumpe“ als Material übernehmen“ mit dem Bedarf, Art „Gerät“, Menge 1 gesperrt und der Einheit „Rettungsstaffel“ unter „Ort“](../bilder/nachforderung/nachforderung-material-uebernehmen.png)

3. Unter „Menge“ die Menge prüfen. Bei einem Gerät steht sie fest auf 1.
4. Unter „Ort“ eine Einheit, ein Fahrzeug, eine UHS oder einen Bereitstellungsraum wählen, oder
   „ohne Ort“ stehen lassen.
5. „Übernehmen“ wählen.

Die Karte zeigt danach je übernommenem Posten Bezeichnung, Menge und Ort, bei einer
Nachforderung mit Anzahl etwa „übernommen 1 von 3“, und „Material ↗“ führt in die
[Materialliste](material.md).

### Weiteren Posten übernehmen

Für Einsatzleitung und Führungspersonal, etwa für die zweite von drei Tauchpumpen oder die
nächste Fuhre Sandsäcke:

1. An der Karte „Weiteren Posten übernehmen“ wählen.

   ![Karte einer eingetroffenen Nachforderung „Sandsäcke“ mit dem übernommenen Posten „Sandsäcke · 1200 · Rettungsstaffel“, „übernommen 1200 von 2000“, „Material ↗“ und dem Knopf „Weiteren Posten übernehmen“](../bilder/nachforderung/nachforderung-material-posten.png)

2. Art, Menge und Ort wie beim ersten Posten setzen. Die Menge ist mit dem Rest der Anzahl
   vorbelegt.
3. „Weiteren Posten übernehmen“ wählen.

### Eine Nachforderung ablehnen

Für Einsatzleitung und Führungspersonal:

1. An der Karte „Ablehnen“ wählen.
2. Im Dialog „Nachforderung ablehnen“ bei Bedarf den Grund eintragen.

   ![Dialog „Nachforderung ablehnen“ mit einem Ablehnungsgrund und den Knöpfen „Abbrechen“ und „Ablehnen“](../bilder/nachforderung/nachforderung-ablehnen.png)

3. „Ablehnen“ wählen.

Eine abgelehnte Nachforderung ist abgeschlossen und lässt sich nicht wieder öffnen.

## Hintergrund

### Benachrichtigungen zum Stand

Wechselt eine Nachforderung auf „Zugesagt“, „Unterwegs“, „Eingetroffen“ oder „Abgelehnt“, erhalten
die Person, die sie angelegt hat, und die Personen, die S4 besetzen (laut Stab-Besetzung, sonst
laut Funktion in der Mitgliedschaft), einen Hinweis mit der neuen Stufe, etwa „Nachforderung
eingetroffen“ mit „2× an Leitstelle“. Art, Bezeichnung, Adressat-Bezeichnung und Ablehnungsgrund
stehen nie im Hinweis; er führt in das Modul „Nachforderung“. Auch ein „Rückgängig“ zurück auf
„Zugesagt“ oder „Unterwegs“ meldet die neue Stufe, eines zurück auf „Angefordert“ meldet nichts.
Das Absetzen selbst meldet nichts.

Eigene Aktionen bleiben still: Wer den Stand selbst fortschreibt oder ablehnt, bekommt dazu
nichts. Wer die Nachforderung angelegt hat und zugleich S4 besetzt, erhält den Hinweis einmal.
Wer das Modul „Nachforderung“ nicht sehen darf, bekommt keinen Hinweis.

### Nachforderungen im Einsatztagebuch

Jede abgesetzte Nachforderung schreibt einen ETB-Eintrag vom Typ „Meldung“ mit dem Inhalt
„Nachforderung: … × Art — Bezeichnung“, die Begründung als Veranlassung. Absender ist die eigene
Führungsstelle des Einsatzes mit ihrem Rufnamen, sonst ihrer Bezeichnung; ist keine gepflegt,
die Führungsstelle oder das erste Sachgebiet der Person, die anfordert. Empfänger ist der
Adressat, etwa „Leitstelle (ILS Nord)“.

Auch jede weitere Stufe steht als Systemeintrag im ETB, etwa „Nachforderung 2× RTW: zugesagt“,
„…: unterwegs“, „…: eingetroffen“ oder „…: abgelehnt (keine Reserven)“. Ein „Rückgängig“ löscht
nichts, sondern schreibt einen weiteren Eintrag, etwa „Nachforderung 2× RTW: zurückgesetzt auf
angefordert“. Alle diese Einträge entstehen immer, unabhängig von „Automatische ETB-Einträge“
(siehe [Einsatztagebuch](einsatztagebuch.md)). Jeder trägt den Verweis „Nachforderung ↗“; er
öffnet die Nachforderungen mit der Karte hervorgehoben.

### Zuständige Leitstelle als Vorgabe

Ist in den [Stammdaten](stammdaten.md) eine externe Stelle als „Zuständige Leitstelle“
markiert, steht sie bei „Adressat“ „Leitstelle“ schon in der „Adressat-Bezeichnung“, auch nach
dem Absetzen. Ein selbst eingetragener Wert wird dabei nie überschrieben. Gespeichert wird nur
der Text.

### Aus der Verpflegung und von einer Unfallhilfsstelle nachfordern

Fehlt in einem Zeitfenster der Verpflegung etwas, öffnet „Nachfordern“ an dessen Karte dieses
Formular mit vorbelegten Feldern ([Verpflegung](verpflegung.md)). An einer Unfallhilfsstelle öffnet
„Fehlmenge melden“ im Bereich „Material“ das Formular mit der Art „Material“ und der Stelle in der
Begründung ([Unfallhilfsstellen](unfallhilfsstellen.md)); Bezeichnung und Anzahl bleiben dort leer.
Die Felder bleiben vor dem Absetzen änderbar.

### Nachforderungen für eine Betreuungsstelle

„Bedarf anfordern“ auf der Seite einer Betreuungsstelle öffnet dieses Formular mit
„Für Betreuungsstelle …“ und der Stelle in der Begründung ([Betreuung](betreuung.md)). Die
Nachforderung gehört dann zu dieser Stelle: ihre Karte nennt die Stelle, ein Klick auf den Namen
öffnet sie. Mit „Für Stelle“ über der Liste stehen nur die Nachforderungen einer Stelle da;
„Filter zurücksetzen“ zeigt wieder alle. Ohne Zugriff auf „Betreuung“ steht an der Karte nur
„Für eine Betreuungsstelle“.

Wird die Stelle storniert, bleibt die Nachforderung mit ihrem Stand bestehen und verweist auf
keine Stelle mehr; die Begründung bleibt, wie sie ist.

### Ablauf der Stufen

Die Stufen laufen vorwärts, jeweils um eine: Angefordert, Zugesagt, Unterwegs, Eingetroffen.
„Rückgängig“ nimmt den letzten Schritt um genau eine Stufe zurück, solange der Hinweis steht, auch
die Zusage zurück auf „Angefordert“. Der Zeitpunkt der zurückgenommenen Stufe entfällt; wer sie
erneut meldet, setzt einen neuen.
Ablehnen geht aus jeder Stufe vor „Eingetroffen“; was eingetroffen ist, wird nicht mehr
abgelehnt. Ist aus einer Nachforderung Material übernommen, lässt sich „Eingetroffen“ nicht mehr
zurücknehmen; die App nennt den Grund über der Liste. Wer versehentlich übernommen hat, storniert
zuerst den Posten in der [Materialliste](material.md) und nimmt dann zurück.

### Übernommenes Material

Jede Übernahme legt genau einen Ad-hoc-Posten in der Materialliste an, der auf die Nachforderung
verweist. Seine Bezeichnung ist die Art der Nachforderung, etwa „Tauchpumpe“; Kategorie,
Trägerorganisation und Bestandsnummer bleiben leer und lassen sich an der Materialzeile über
„Angaben ändern …“ nachtragen. Vorbelegt sind als Menge die Anzahl der Nachforderung abzüglich
dessen, was schon übernommen ist (mindestens 1, ohne Anzahl 1), als Art „Verbrauchsgut“ bei einer
Menge über 1, sonst „Gerät“, und als Ort „ohne Ort“; die Nachforderung selbst kennt keinen Ort.

Ein Gerät steht je Stück im Einsatz: Drei Tauchpumpen sind drei Übernahmen. Auch Verbrauchsgut,
das in mehreren Fuhren kommt, wird je Fuhre übernommen. Einen weiteren Posten legt die App nur
ausdrücklich über „Weiteren Posten übernehmen“ an. Hat ein anderer Platz inzwischen übernommen,
lehnt sie „Übernehmen“ ab und nennt den Grund im Dialog; der Dialog bleibt offen und bietet dann
„Weiteren Posten übernehmen“ mit der neu gerechneten Menge an. So steht dieselbe Lieferung nicht
versehentlich zweimal im Bestand.

Ein stornierter Posten zählt nicht als übernommen, ein aus dem Einsatz genommener schon; die
Karte nennt ihn dann mit „aus dem Einsatz genommen“. Wird ein übernommener Posten aufgeteilt,
verweisen beide Teile auf die Nachforderung. Die Nachforderung selbst ändert sich durch die
Übernahme nicht.

Übernehmen dürfen Einsatzleitung und Führungspersonal, wenn das Modul Material für sie
freigegeben ist. Ist es gesperrt, steht der Knopf gesperrt mit „Keine Berechtigung“, und die
Karte zeigt statt der Posten nur ihre Zahl, etwa „2 Posten übernommen“.

Jede Übernahme schreibt einen Eintrag ins Einsatztagebuch, etwa „Material «Tauchpumpe» (×1)
disponiert, Ort Einheit «Rettungsstaffel», aus Nachforderung «3 Tauchpumpen für Keller
Hauptstraße»“, ohne Ort ohne den Ort-Teil. Die Nachforderung schreibt dafür keinen eigenen
Eintrag.

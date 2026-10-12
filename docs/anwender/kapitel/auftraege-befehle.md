---
titel: Aufträge und Befehle
gruppen: [fuehrung]
reihenfolge: 120
quellen: [frontend/src/pages/AuftraegePage.tsx, frontend/src/auftraege/AuftraegeListe.tsx, frontend/src/auftraege/AuftragFormular.tsx, frontend/src/auftraege/AuftragKarte.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/auftraege/AuftragAufhebenDialog.tsx, frontend/src/auftraege/auftragBerichtigungKern.ts, frontend/src/auftraege/BefehlListe.tsx, frontend/src/pages/BefehlDetailPage.tsx, frontend/src/befehle/vorlagen.ts, frontend/src/entwurf/useEntwurfVerlustschutz.ts, frontend/src/entwurf/DokumentAnlagen.tsx, frontend/src/kommunikation/gruppierung.ts, frontend/src/einsatz/AlarmZentrale.tsx, frontend/src/pages/einstellungen/EinsatzVerhalten.tsx, src/routes/auftrag.rs, src/auftrag/repo.rs, src/auftrag/eingabe.rs, src/routes/befehl.rs, src/befehl/mod.rs]
---

## Überblick

Das Modul „Aufträge/Befehle“ hat zwei Reiter:

- **Einzelaufträge** gehen an einen oder mehrere Empfänger. Jeder Empfänger quittiert den
  Empfang; ist die Arbeit getan, wird der Vollzug gemeldet und der Auftrag abgenommen. Ein
  Auftrag lässt sich berichtigen, solange noch niemand quittiert hat, und mit einem Grund
  aufheben, solange er nicht abgenommen ist.
- **Einsatzbefehle** sind Dokumente nach einem Befehlsschema. Sie entstehen als Entwurf, werden
  freigegeben und lassen sich danach nur noch in einer neuen Fassung fortschreiben.

Lesen dürfen alle mit Zugang zum Einsatz. Erteilen, Quittieren, Berichtigen, Aufheben,
Entwerfen und Freigeben dürfen Einsatzleitung und Führungspersonal, solange der Einsatz läuft
(siehe
[Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Einen Auftrag erteilen

Für Einsatzleitung und Führungspersonal:

1. Im Einsatz „Aufträge/Befehle“ öffnen, Reiter „Einzelaufträge“, und „Auftrag erteilen“ wählen.
2. Unter „Auftrag / Was“ den Auftrag formulieren.

   ![Formular „Neuer Auftrag“ mit Auftragstext, Empfänger „Logistiktrupp“, Priorität „Dringend“ und dem leeren Feld „Frist (Quittung/Vollzug)“](../bilder/auftraege-befehle/auftrag-erteilen.png)

3. Unter „Empfänger“ einen Abschnitt, eine Einheit oder eine Funktion (zum Beispiel S3) wählen
   oder eintippen. Ein Komma trennt mehrere Empfänger.
4. „Priorität“ und bei Bedarf „Frist (Quittung/Vollzug)“ setzen.
5. Bei Bedarf „Befehlsschema und Richtung (optional)“ aufklappen: „Richtung“ (Intern oder
   Extern), „Erteilt am (optional)“, bei extern „Externe Stelle“ und „Bezeichnung der Stelle“,
   dazu die Felder „Absicht / Ziel“, „Lage“, „Ort / Wo“, „Zeit / Wann“, „Mittel / Womit“,
   „Verbindung / Meldewege“ und „Sicherheit / Besonderes“.
6. „Auftrag erteilen“ wählen.

„Speichern und nächste“ (Strg+Enter, am Mac ⌘+Enter) erteilt den Auftrag und leert das Formular
für den nächsten. Mit dem Häkchen „Werte behalten“ bleiben Empfänger, Priorität und Richtung
stehen.

### Aufträge verfolgen und quittieren

1. Im Reiter „Einzelaufträge“ die Ansicht „Offen“ oder „Abgeschlossen“ wählen, bei Bedarf eine
   Richtung und „Empfänger filtern“.

   ![Einzelaufträge mit zwei offenen Aufträgen in der Gruppe „Ohne Frist“, je mit „Quittung offen:“, „Quittieren“, „Bearbeitung beginnen“, „Vollzug melden“ und dem Menü der weiteren Aktionen](../bilder/auftraege-befehle/auftraege-liste.png)

2. Neben „Quittung offen:“ steht jeder Empfänger, der noch nicht quittiert hat. „Quittieren“
   wählen und die Rückfrage „Empfang/Kenntnis quittieren?“ mit „Empfang quittieren“ bestätigen.
3. Hat ein Empfänger mit der Arbeit begonnen, „Bearbeitung beginnen“ wählen. Ein Hinweis bietet
   sechs Sekunden lang „Rückgängig“.

Offene Aufträge stehen in den Gruppen „Überfällig“, „Heute fällig“, „Später“ und „Ohne Frist“.
„Auftragsdetails (Schema)“ an der Karte klappt die Felder des Befehlsschemas auf.

### Einen Auftrag berichtigen

Für Einsatzleitung und Führungspersonal, solange der Auftrag offen ist und noch kein Empfänger
quittiert hat:

1. An der Karte das Menü „Aktionen zu Auftrag #…“ öffnen und „Berichtigen“ wählen.
2. Über der Liste öffnet sich „Auftrag #… berichtigen“ mit dem bisherigen Stand. Auftragstext,
   Empfänger, Priorität, Frist und die Felder des Befehlsschemas ändern.
3. „Berichtigung speichern“ wählen.

Nach der ersten Quittung steht im Menü „Berichtigen (schon quittiert)“ gesperrt: Der Empfänger
hat den alten Wortlaut bestätigt. Dann den Auftrag aufheben und neu erteilen. „Richtung“ und
„Erteilt am“ lassen sich nicht berichtigen.

### Den Vollzug melden und den Auftrag abnehmen

Für Einsatzleitung und Führungspersonal:

1. An der Karte „Vollzug melden“ wählen.
2. Im Dialog „Vollzug melden“ die „Rückmeldung zur Erledigung“ eintragen und „Vollzug melden“
   wählen. Der Auftrag wechselt in die Ansicht „Abgeschlossen“.
3. Zur Kontrolle in „Abgeschlossen“ an der Karte „Abnehmen“ wählen und die Rückfrage „Auftrag
   abnehmen?“ mit „Auftrag abnehmen“ bestätigen.

Die Abnahme lässt sich nicht zurücknehmen.

### Einen Auftrag aufheben

Für Einsatzleitung und Führungspersonal, solange der Auftrag nicht abgenommen ist:

1. An der Karte „Auftrag aufheben“ wählen. Bei einem offenen Auftrag steht es rot im Menü
   „Aktionen zu Auftrag #…“, sonst als roter Knopf an der Karte.
2. Im Dialog „Auftrag #… aufheben“ den „Grund“ eintragen.

   ![Dialog „Auftrag #… aufheben“ mit dem Satz zur Folge, dem Feld „Grund“ und dem roten Knopf „Auftrag aufheben“](../bilder/auftraege-befehle/auftrag-aufheben.png)

3. Mit „Auftrag aufheben“ bestätigen.

Der Auftrag steht danach unter „Abgeschlossen“ mit dem Etikett „Aufgehoben“, mit Zeit, Person
und Grund. Quittungen werden nicht mehr erwartet; Quittieren, Vollzug und Abnahme sind nicht
mehr möglich. Das Aufheben lässt sich nicht zurücknehmen.

### Einen Einsatzbefehl entwerfen

Für Einsatzleitung und Führungspersonal:

1. Im Reiter „Einsatzbefehle“ „Befehl entwerfen“ wählen.
2. Im Dialog „Neuer Befehlsentwurf“ ein „Schema“ wählen und einen „Titel“ eintragen, dann
   „Entwurf anlegen“. Die App öffnet den Entwurf.
3. Die Abschnitte des Schemas ausfüllen. Neben jedem Feld zeigt die „Vorschau“ den gesetzten
   Text.

   ![Befehlsentwurf mit Titel und den Abschnitten „Lage“, „Auftrag“ und „Durchführung“ samt Vorschau, darüber „Entwurf speichern“, „Freigeben“ und „Drucken / als PDF“](../bilder/auftraege-befehle/befehl-entwurf.png)

4. „Entwurf speichern“ wählen oder einfach weiterarbeiten: Der Entwurf speichert sich alle 30
   Sekunden und beim Verlassen eines Feldes selbst; neben den Knöpfen steht „zuletzt gespeichert
   …“.
5. Bei Bedarf „Fernmeldeskizze anfügen“ wählen. Die App nimmt die aktuelle Fernmeldeskizze als
   Bild auf und hängt sie unter „Anlagen“ an. Das geht nur mit Verbindung und nur, wenn der Stab
   im Einsatz freigegeben ist ([Funkplan, Fernmeldeskizze und Kommunikationsplan](funkplan.md)).

### Einen Einsatzbefehl freigeben und fortschreiben

Für Einsatzleitung und Führungspersonal:

1. Im Entwurf „Freigeben“ wählen.
2. Die Rückfrage „Befehl freigeben?“ warnt: „Endgültig: geht ins ETB, Korrektur nur per
   Fortschreibung.“ Mit „Freigeben“ bestätigen.
3. Ist später etwas zu ändern, am freigegebenen Befehl „Fortschreiben“ wählen. Es entsteht eine
   neue Fassung als Entwurf, die wieder freigegeben wird.

Ein Befehl ohne jeden Text lässt sich nicht freigeben; die Rückfrage meldet dann „Der Befehl ist
leer und kann nicht freigegeben werden“. Ein freigegebener Befehl führt im Kopf mit
„Zum ETB-Eintrag“ ins Tagebuch; „Drucken / als PDF“ gibt ihn auf Papier aus (siehe
[Drucken und Export](drucken-export.md)).

## Hintergrund

### Fristen und Alarm

Eine Frist am Auftrag gilt für Quittung und Vollzug. Bleibt das Feld leer, setzt die App die
Vorgabe aus den Einstellungen des Einsatzes unter „Verhalten & Automatik“, Feld „Quittierfrist
Aufträge (Minuten)“; ohne Vorgabe hat der Auftrag keine Frist.

Mit einer Frist legt die App die automatische Erinnerung „Auftrag #… Quittierfrist“ an. Läuft
die Frist ab, bevor alle Empfänger quittiert haben, meldet sich der Hinweis „Auftrag überfällig“
mit „Quittierfrist überschritten“ und „Öffnen“; die Karte steht unter „Überfällig“. Quittieren
alle Empfänger, schließt die Erinnerung.

Eine berichtigte Frist verschiebt die Erinnerung; sie meldet sich zur neuen Frist erneut. Eine
entfernte Frist und das Aufheben schließen sie. Eine selbst angelegte Erinnerung zum Auftrag
bleibt stehen.

Ein aufgehobener Auftrag ist nie offen und nie überfällig: Er fehlt in den Zahlen im Überblick,
im Lagedashboard, in der Vorbereitung der Lagebesprechung und im Lagebericht.

### Aufträge im Einsatztagebuch

Ein erteilter Auftrag schreibt eine „Anordnung“ ins ETB, solange „Automatische ETB-Einträge“
nicht ausgeschaltet ist. Der gemeldete Vollzug schreibt immer eine „Meldung“ mit der Rückmeldung.

Berichtigen und Aufheben schreiben immer eine „Anordnung“, auch bei ausgeschalteten
automatischen Einträgen: „Auftrag #4 aufgehoben: Lage hat sich erledigt“ bzw. „Auftrag #4
geändert: …“ mit neuem und vorherigem Wert, etwa „Frist 12.10. 16:00 (vorher 12.10. 15:00)“.
Die Felder des Befehlsschemas erscheinen dort nur mit ihrem Namen. Die ursprüngliche Anordnung
bleibt unverändert stehen.

Aufträge lassen sich auch direkt aus einem ETB-Eintrag oder einer Meldung erteilen (siehe
[Einsatztagebuch](einsatztagebuch.md) und [Meldungen](meldungen.md)). Ein Auftrag aus einem
ETB-Eintrag führt an seiner Karte mit „↗ ETB-Eintrag“ zu diesem Eintrag zurück.

### Befehle im Einsatztagebuch

Mit der Freigabe schreibt der Befehl seinen vollständigen Text als „Anordnung“ ins ETB. Danach
ist die Fassung eingefroren, auch ihre Anlagen. Eine Fortschreibung ist eine neue Fassung mit
eigener Freigabe.

## Grundlagen und Quellen

Die Befehlsschemata der App sind „Befehl LAD (vereinfacht)“ mit Lage, Auftrag und Durchführung,
„Befehl LADEF (erweitert, SKK)“ mit zusätzlich Einsatzunterstützung sowie Führung und
Kommunikation, „Befehl SCHNEE“ mit Schadenlage, Nachbarn, Entschluss / Absicht, Einzelauftrag
und eigenem Standort und „Einzelauftrag (EA/ZMW)“ mit Einheit, Auftrag / Ziel, Mittel und Weg.

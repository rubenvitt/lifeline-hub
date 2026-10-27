---
titel: Aufträge und Befehle
gruppen: [fuehrung]
reihenfolge: 120
quellen: [frontend/src/pages/AuftraegePage.tsx, frontend/src/components/ListeDetail.tsx, frontend/src/auftraege/AuftraegeListe.tsx, frontend/src/auftraege/AuftragErteilenDialog.tsx, frontend/src/auftraege/AuftragFormular.tsx, frontend/src/auftraege/auftragsschemaKern.ts, frontend/src/auftraege/auftragBerichtigungKern.ts, frontend/src/auftraege/AuftragListenKarte.tsx, frontend/src/auftraege/AuftragDetail.tsx, frontend/src/auftraege/AuftragTeile.tsx, frontend/src/auftraege/EmpfaengerQuittung.tsx, frontend/src/auftraege/EmpfaengerFilter.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/auftraege/AuftragAufhebenDialog.tsx, frontend/src/pages/AuftragDruckPage.tsx, frontend/src/auftraege/AuftragDruckBlatt.tsx, frontend/src/auftraege/BefehlListe.tsx, frontend/src/auftraege/BefehlListenKarte.tsx, frontend/src/auftraege/BefehlDetail.tsx, frontend/src/pages/BefehlDetailPage.tsx, frontend/src/entwurf/DokumentEntwurf.tsx, frontend/src/entwurf/VerteilerField.tsx, frontend/src/entwurf/verteilerKern.ts, frontend/src/fuehrung/EmpfaengerWahl.tsx, frontend/src/fuehrung/ExterneEmpfaenger.tsx, frontend/src/befehle/vorlagen.ts, frontend/src/entwurf/useEntwurfVerlustschutz.ts, frontend/src/entwurf/DokumentAnlagen.tsx, frontend/src/kommunikation/gruppierung.ts, frontend/src/einsatz/AlarmZentrale.tsx, frontend/src/pages/einstellungen/EinsatzVerhalten.tsx, src/routes/auftrag.rs, src/auftrag/repo.rs, src/auftrag/eingabe.rs, src/routes/befehl.rs, src/befehl/mod.rs, src/vorlagendokument/verteiler.rs, src/vorlagendokument/repo.rs, src/vorlagendokument/benachrichtigung.rs, src/auftrag/benachrichtigung.rs, src/benachrichtigung/text.rs, src/erinnerung/benachrichtigung.rs]
---

## Überblick

Das Modul „Aufträge/Befehle“ hat zwei Reiter:

- **Einzelaufträge** gehen an einen oder mehrere Empfänger. Jeder Empfänger quittiert den
  Empfang; ist die Arbeit getan, wird der Vollzug gemeldet und der Auftrag abgenommen. Ein
  Auftrag lässt sich berichtigen, solange noch niemand quittiert hat, und mit einem Grund
  aufheben, solange er nicht abgenommen ist.
- **Einsatzbefehle** sind Dokumente nach einem Befehlsschema. Sie entstehen als Entwurf, werden
  freigegeben und lassen sich danach nur noch in einer neuen Fassung fortschreiben. Für jede
  Stelle im Verteiler eines freigegebenen Befehls wird der Empfang quittiert.

Lesen dürfen alle mit Zugang zum Einsatz. Erteilen, Quittieren, Berichtigen, Aufheben,
Entwerfen und Freigeben dürfen Einsatzleitung und Führungspersonal, solange der Einsatz läuft
(siehe
[Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Einen Auftrag erteilen

Für Einsatzleitung und Führungspersonal:

1. Im Einsatz „Aufträge/Befehle“ öffnen, Reiter „Einzelaufträge“, und „Auftrag erteilen“ wählen.
   Der Dialog „Auftrag erteilen“ öffnet sich.
2. Unter „Empfänger“ die Einheit nennen: einen Abschnitt, eine Einheit oder eine Funktion (zum
   Beispiel S3) wählen oder eintippen. Ein Komma trennt mehrere Empfänger.

   ![Dialog „Auftrag erteilen“ mit Empfänger „Logistiktrupp“, Auftragstext, Priorität „Dringend“, dem leeren Feld „Frist (Quittung/Vollzug)“ und den zugeklappten Teilen „Ausführung: Mittel, Ziel, Weg, Zeit“ und „Weitere Angaben“](../bilder/auftraege-befehle/auftrag-erteilen.png)

3. Unter „Auftrag / Was“ den Auftrag formulieren.
4. „Priorität“ und bei Bedarf „Frist (Quittung/Vollzug)“ setzen.
5. Bei Bedarf „Ausführung: Mittel, Ziel, Weg, Zeit“ aufklappen und „Mittel / Womit“, „Ziel / Ort“,
   „Weg“ und „Zeit / Wann“ eintragen. Im „Ziel / Ort“ mit Enter oder „Ort suchen“ suchen und einen
   Treffer wählen: das Ziel ist damit verortet, der Kartenausschnitt unter dem Feld zeigt es. Enter
   erteilt dort den Auftrag nicht. Ohne Treffer bleibt das Ziel freier Text.
6. Bei Bedarf „Weitere Angaben“ aufklappen: „Lage“, „Absicht“, „Verbindung / Meldewege“,
   „Sicherheit / Besonderes“, „Richtung“ (Intern oder Extern) und „Erteilt am (optional)“, bei
   extern dazu „Externe Stelle“ und „Bezeichnung der Stelle“. Steht die Richtung auf extern,
   heißt der Teil auch zugeklappt „Weitere Angaben · Richtung: Extern“.
7. „Auftrag erteilen“ wählen. Der Dialog schließt sich. Ist ein Feld in einem zugeklappten Teil zu lang, klappt der Teil auf
   und nennt den Grund am Feld.

„Speichern und nächste“ (Strg+Enter, am Mac ⌘+Enter) erteilt den Auftrag und leert das Formular
für den nächsten; der Dialog bleibt offen. Mit dem Häkchen „Werte behalten“ bleiben Empfänger,
Priorität und Richtung stehen.

### Aufträge finden und quittieren

1. Im Reiter „Einzelaufträge“ die Ansicht „Offen“ oder „Abgeschlossen“ wählen. Bei Bedarf im
   Suchfeld „Kennung, Text oder Empfänger“ suchen, eine Richtung wählen oder „Empfänger filtern“.

   ![Einzelaufträge mit der Liste der offenen Aufträge links und dem gewählten Auftrag rechts, darin „Bearbeitung beginnen“, „Vollzug melden“, dem Menü der weiteren Aktionen, „Quittung offen:“ mit „Quittieren“ und unten „Druckansicht“](../bilder/auftraege-befehle/auftraege-liste.png)

2. Einen Auftrag in der Liste wählen. Auf breitem Bildschirm steht er rechts neben der Liste, auf
   schmalem klappt er unter seiner Karte auf.
3. Im Auftrag unter „Empfänger“ steht neben „Quittung offen:“ jeder Empfänger, der noch nicht
   quittiert hat. „Quittieren“ wählen und die Rückfrage „Empfang/Kenntnis quittieren?“ mit
   „Empfang quittieren“ bestätigen.
4. Hat ein Empfänger mit der Arbeit begonnen, „Bearbeitung beginnen“ wählen. Ein Hinweis bietet
   sechs Sekunden lang „Rückgängig“.

Offene Aufträge stehen in den Gruppen „Überfällig“, „Heute fällig“, „Später“ und „Ohne Frist“.
Auf breitem Bildschirm ist der oberste Auftrag schon gewählt. Der gewählte Auftrag zeigt den
ganzen Text, alle Empfänger, die Felder des Befehlsschemas unter „Schema“ in derselben Reihenfolge
wie im Formular (leere Felder fehlen), bei verortetem Ziel darunter einen Kartenausschnitt mit
„Auf Lagekarte zeigen“, und unter „Verlauf“ die Zeitpunkte von Erteilung,
Quittungen, Bearbeitung, Vollzug, Abnahme und Aufhebung. Die Suche findet auch ältere
abgeschlossene Aufträge, die noch nicht geladen sind.

### Einen Auftrag berichtigen

Für Einsatzleitung und Führungspersonal, solange der Auftrag offen ist und noch kein Empfänger
quittiert hat:

1. Den Auftrag wählen, im Auftrag das Menü „Aktionen zu Auftrag #…“ öffnen und „Berichtigen“
   wählen.
2. Der Dialog „Auftrag #… berichtigen“ öffnet sich mit dem bisherigen Stand. Auftragstext,
   Empfänger, Priorität, Frist und die Felder des Befehlsschemas ändern.
3. „Berichtigung speichern“ wählen. Der Dialog schließt sich.

Nach der ersten Quittung steht im Menü „Berichtigen (schon quittiert)“ gesperrt: Der Empfänger
hat den alten Wortlaut bestätigt. Dann den Auftrag aufheben und neu erteilen. „Richtung“ und
„Erteilt am“ lassen sich nicht berichtigen.

### Den Vollzug melden und den Auftrag abnehmen

Für Einsatzleitung und Führungspersonal:

1. Den Auftrag wählen und „Vollzug melden“ wählen.
2. Im Dialog „Vollzug melden“ die „Rückmeldung zur Erledigung“ eintragen und „Vollzug melden“
   wählen. Der Auftrag wechselt in die Ansicht „Abgeschlossen“; solange er gewählt bleibt, steht
   er mit dem Hinweis „Nicht mehr in dieser Ansicht“ weiter da.
3. Zur Kontrolle in „Abgeschlossen“ den Auftrag wählen, „Abnehmen“ wählen und die Rückfrage
   „Auftrag abnehmen?“ mit „Auftrag abnehmen“ bestätigen.

Die Abnahme lässt sich nicht zurücknehmen.

### Einen Auftrag aufheben

Für Einsatzleitung und Führungspersonal, solange der Auftrag nicht abgenommen ist:

1. Den Auftrag wählen und im Auftrag „Auftrag aufheben“ wählen. Bei einem offenen Auftrag steht
   es rot im Menü „Aktionen zu Auftrag #…“, sonst als roter Knopf.
2. Im Dialog „Auftrag #… aufheben“ den „Grund“ eintragen.

   ![Dialog „Auftrag #… aufheben“ mit dem Satz zur Folge, dem Feld „Grund“ und dem roten Knopf „Auftrag aufheben“](../bilder/auftraege-befehle/auftrag-aufheben.png)

3. Mit „Auftrag aufheben“ bestätigen.

Der Auftrag steht danach unter „Abgeschlossen“ mit dem Etikett „Aufgehoben“; gewählt zeigt er
Zeit, Person und Grund. Quittungen werden nicht mehr erwartet; Quittieren, Vollzug und Abnahme sind nicht
mehr möglich. Das Aufheben lässt sich nicht zurücknehmen. Kam der Auftrag aus einer Meldung, lässt
sich aus ihr wieder ein Auftrag erteilen (siehe [Meldungen](meldungen.md)).

### Einen Auftrag drucken

1. Den Auftrag wählen und im Auftrag unten „Druckansicht“ wählen. Die Druckansicht zeigt den
   Druckkopf und darunter das Blatt mit den Teilen „Auftrag“, „Quittung“ und „Bearbeitung“.
2. „Drucken / als PDF“ wählen und im Druckdialog des Browsers drucken oder als PDF speichern.
3. „Zurück zu Aufträge/Befehle“ führt zur Liste zurück; der Auftrag ist dann gewählt.

Die Druckansicht ist ein fester Stand: „Neu laden“ holt eine Quittung oder einen Vollzug, der
inzwischen dazugekommen ist (siehe [Drucken und Export](drucken-export.md)).

### Einen Einsatzbefehl entwerfen

Für Einsatzleitung und Führungspersonal:

1. Im Reiter „Einsatzbefehle“ „Befehl entwerfen“ wählen.
2. Im Dialog „Neuer Befehlsentwurf“ ein „Schema“ wählen und einen „Titel“ eintragen, dann
   „Entwurf anlegen“. Die App öffnet den Entwurf.
3. Unter „Verteiler“ wählen, an wen der Befehl geht: Einsatzabschnitte, Einheiten und
   Funktionen stehen zur Auswahl, ein eigener Text gilt mit Enter oder Komma. Externe Stellen
   kommen mit „Externe Stelle hinzufügen“ dazu, je Zeile mit Kategorie und Bezeichnung.
4. Die Abschnitte des Schemas ausfüllen. Sie stehen offen untereinander, unter dem Namen eines
   Abschnitts stehen die Unterpunkte des Schemas. Die „Gliederung“ springt zu einem Abschnitt und
   nennt leere mit „leer“. „Lesefassung“ zeigt den ganzen Befehl gesetzt, so wie er gedruckt
   wird; „Bearbeiten“ führt zurück. Der Entwurf ist derselbe wie beim Lagebericht
   ([Lageberichte](lageberichte.md)).

   ![Befehlsentwurf mit Gliederung, Titel, Verteiler samt externer Stelle und den offenen Abschnitten „Lage“, „Auftrag“ und „Durchführung“, darüber „Entwurf speichern“, „Freigeben“ und „Drucken / als PDF“](../bilder/auftraege-befehle/befehl-entwurf.png)

5. „Entwurf speichern“ wählen oder einfach weiterarbeiten: Der Entwurf speichert sich alle 30
   Sekunden und beim Verlassen eines Feldes selbst; neben den Knöpfen steht „zuletzt gespeichert
   …“.
6. Bei Bedarf „Fernmeldeskizze anfügen“ wählen. Die App nimmt die aktuelle Fernmeldeskizze als
   Bild auf und hängt sie unter „Anlagen“ an. Das geht nur mit Verbindung und nur, wenn das
   Fernmeldewesen im Einsatz freigegeben ist
   ([Fernmeldewesen mit Funkplan, Fernmeldeskizze und Kommunikationsplan](funkplan.md)).

Ein gespeicherter Entwurf öffnet sich wieder über den Reiter „Einsatzbefehle“, Ansicht
„Entwürfe“: Befehl wählen und „Entwurf bearbeiten“.

### Einen Einsatzbefehl lesen

1. Im Reiter „Einsatzbefehle“ die Ansicht „Entwürfe“ oder „Freigegeben“ wählen, bei Bedarf im
   Suchfeld „Titel oder Schema“ suchen oder „Empfänger filtern“, und einen Befehl wählen. Er
   steht mit Schema, Zeitstand, Ersteller, Freigabe, Verteiler und dem ganzen „Befehlstext“ neben
   bzw. unter der Liste. Bei einem freigegebenen Befehl zeigt der Verteiler, wer den Empfang
   schon quittiert hat.

   ![Einsatzbefehle mit der Liste der freigegebenen Befehle links und dem gewählten Befehl rechts, darin „Fortschreiben“, der Verteiler mit „2 Empfänger · 1/2 quittiert“, einer quittierten Stelle mit ✓, „Quittung offen:“ mit „Quittieren“ und der Befehlstext](../bilder/auftraege-befehle/befehl-detail.png)

2. „Vollansicht“ öffnet den Befehl ganzseitig. Dort führt ein freigegebener Befehl im Kopf mit
   „Zum ETB-Eintrag“ ins Tagebuch, und „Drucken / als PDF“ gibt ihn auf Papier aus (siehe
   [Drucken und Export](drucken-export.md)). „Aufträge/Befehle“ oben im Ortspfad führt zurück, der
   Befehl ist dann gewählt.

### Den Empfang eines Einsatzbefehls quittieren

Für Einsatzleitung und Führungspersonal, an der jüngsten freigegebenen Fassung eines Befehls:

1. Im Reiter „Einsatzbefehle“ die Ansicht „Freigegeben“ wählen und den Befehl wählen. Seine Karte
   zählt die Quittungen, etwa „2 Empfänger · 1/2 quittiert“.
2. Im Befehl unter „Verteiler“ steht neben „Quittung offen:“ jede Stelle, deren Empfang noch
   nicht bestätigt ist. Hat sie den Befehl erhalten, bei ihr „Quittieren“ wählen. Eine Rückfrage
   gibt es nicht.
3. Ein Hinweis bietet sechs Sekunden lang „Rückgängig“: Er nimmt die Quittung zurück, die Stelle
   steht wieder unter „Quittung offen:“.

Ein Tablet im Einsatzabschnitt quittiert die Stellen seines Abschnitts selbst (siehe
[Einsatzabschnitt am Gerät](geraet-einsatzabschnitt.md)); die Quittung erscheint dann hier.

Quittierte Stellen stehen mit ✓ im Verteiler. Ein Befehlsentwurf hat noch keine Quittung, und
eine Fassung, nach der schon eine andere Fassung desselben Befehls freigegeben wurde, nimmt keine
Quittung mehr an: Ihre
offenen Stellen stehen ohne „Quittieren“ da, ihre Quittungen bleiben sichtbar.

### Einen Einsatzbefehl freigeben und fortschreiben

Für Einsatzleitung und Führungspersonal:

1. Den Entwurf in der Ansicht „Entwürfe“ wählen und „Freigeben“ wählen. Die Rückfrage „Befehl
   freigeben?“ warnt: „Endgültig: geht ins ETB, Korrektur nur per Fortschreibung.“ Mit
   „Freigeben“ bestätigen.
2. Ist später etwas zu ändern, den Befehl in der Ansicht „Freigegeben“ wählen und „Fortschreiben“
   wählen. Es entsteht eine neue Fassung als Entwurf, die sich zum Bearbeiten öffnet und wieder
   freigegeben wird.

Ein Befehl ohne jeden Text lässt sich nicht freigeben; die Rückfrage meldet dann „Der Befehl ist
leer und kann nicht freigegeben werden“. Die Fassung steht als „v1“, „v2“ … an der Karte; eine
Fortschreibung trägt denselben Titel wie ihr Vorgänger.

## Hintergrund

### Fristen und Alarm

Eine Frist am Auftrag gilt für Quittung und Vollzug. Bleibt das Feld leer, setzt die App die
Vorgabe aus den Einstellungen des Einsatzes unter „Verhalten & Automatik“, Feld „Quittierfrist
Aufträge (Minuten)“; ohne Vorgabe hat der Auftrag keine Frist.

Mit einer Frist legt die App die automatische Erinnerung „Auftrag #… Quittierfrist“ an. Läuft
die Frist ab, bevor alle Empfänger quittiert haben, erscheint der Alarm „Auftrag überfällig“ mit
„Auftrag #…“ und „Öffnen“; die Karte steht unter „Überfällig“. Den Alarm bekommen, wer den
Auftrag erteilt hat, und die Empfänger, die noch nicht quittiert haben: je Funktion die Personen,
die sie besetzen, und benannte Personen mit eigenem Zugang. Quittieren alle Empfänger, schließt
die Erinnerung.

Eine berichtigte Frist verschiebt die Erinnerung; sie meldet sich zur neuen Frist erneut. Eine
entfernte Frist und das Aufheben schließen sie. Eine selbst angelegte Erinnerung zum Auftrag
bleibt stehen.

Ein aufgehobener Auftrag ist nie offen und nie überfällig: Er fehlt in den Zahlen im Überblick,
im Lagedashboard, in der Vorbereitung der Lagebesprechung und im Lagebericht.

### Benachrichtigungen zu Aufträgen

Wer einen Auftrag bekommt oder erteilt hat, erhält einen Hinweis, ohne das Modul offen zu haben:

- **„Neuer Auftrag“** geht beim Erteilen an jede Person, die eine Empfänger-Funktion besetzt
  (laut Stab-Besetzung, sonst laut Funktion in der Mitgliedschaft), und an eine Einsatzkraft als
  Empfänger, wenn ihr Personal mit einem Konto verknüpft ist. Das gilt auch für Aufträge aus
  einem ETB-Eintrag, einer Meldung oder dem Chat. Einheiten, Abschnitte, Fahrzeuge, externe
  Stellen und eine frei eingetippte Funktion erreichen niemanden. Kommt durch eine Berichtigung
  ein Empfänger hinzu, erhält nur er den Hinweis.
- **„Auftrag quittiert“** geht an die Person, die den Auftrag erteilt hat, sobald ein Empfänger
  quittiert, etwa „Auftrag #12 an S2“. Bei einer Einsatzkraft als Empfänger steht nur die
  Nummer da, nie ein Name.
- **„Auftrag erledigt“** geht an die Person, die den Auftrag erteilt hat, wenn der Vollzug
  gemeldet wird.

Eigene Aktionen bleiben still: Wer als S4 einen Auftrag an S4 erteilt, den eigenen Auftrag
quittiert oder den Vollzug selbst meldet, bekommt dazu nichts. Jeder Vorgang meldet sich einmal;
eine wiederholte Quittung oder eine Berichtigung ohne neuen Empfänger bleibt still. Wer das Modul
„Aufträge/Befehle“ nicht sehen darf, bekommt keinen Hinweis.

### Aufträge im Einsatztagebuch

Ein erteilter Auftrag schreibt eine „Anordnung“ ins ETB, solange „Automatische ETB-Einträge“
nicht ausgeschaltet ist. Der gemeldete Vollzug schreibt immer eine „Meldung“ mit der Rückmeldung.

Berichtigen und Aufheben schreiben immer eine „Anordnung“, auch bei ausgeschalteten
automatischen Einträgen: „Auftrag #4 aufgehoben: Lage hat sich erledigt“ bzw. „Auftrag #4
geändert: …“ mit neuem und vorherigem Wert, etwa „Frist 121600okt26 (vorher 121500okt26)“.
Die Felder des Befehlsschemas erscheinen dort nur mit ihrem Namen. Die ursprüngliche Anordnung
bleibt unverändert stehen.

Der Filter nach Einheit im ETB zeigt einen Eintrag zum Auftrag bei den Einheiten, an die er sich
beim Schreiben richtete. Werden die Empfänger berichtigt, bleibt die ursprüngliche Anordnung bei
den bisherigen Einheiten; die Anordnung „Auftrag #4 geändert: Empfänger …“ steht bei den bisherigen
und den neuen.

Aufträge lassen sich auch direkt aus einem ETB-Eintrag oder einer Meldung erteilen (siehe
[Einsatztagebuch](einsatztagebuch.md) und [Meldungen](meldungen.md)). Ein Auftrag aus einem
ETB-Eintrag führt unter „Verlauf“ mit „ETB-Eintrag“ zu diesem Eintrag zurück.

### Das Auftragsblatt

Der Teil „Auftrag“ steht in derselben Reihenfolge wie das Formular: Empfänger, Auftrag,
Priorität, Frist, Mittel, Ziel / Ort, Weg, Zeit, Lage, Absicht, Verbindung / Meldewege,
Sicherheit / Besonderes, Richtung und Erteilt am. Leere Angaben fehlen. Bei einem externen
Auftrag nennt „Richtung“ die externe Stelle mit.

„Quittung“ nennt jeden Empfänger mit dem Zeitpunkt seiner Quittung oder mit „nicht quittiert“.
„Bearbeitung“ nennt die Phase und, soweit vorhanden, „In Bearbeitung seit“, „Vollzogen am“, den
„Vollzugsvermerk“, „Abgenommen am“ und bei einem aufgehobenen Auftrag „Aufgehoben am“, „Aufgehoben
von“ und „Grund“.

Drucken ist Lesen: Die Druckansicht steht allen offen, die Aufträge lesen dürfen, auch ohne
Schreibrecht und in jeder Phase des Auftrags.

### Einzelauftrag oder Einsatzbefehl

Ein Einzelauftrag wird als Auftrag erteilt: nur der Auftrag kennt Vollzug und Abnahme. Am
Einsatzbefehl wird nur der Empfang je Stelle im Verteiler quittiert.
Das Schema „Einzelauftrag (EA/ZMW)“ bietet „Neuer Befehlsentwurf“ deshalb nicht mehr an.
Befehle, die schon mit diesem Schema angelegt sind, lassen sich weiter öffnen, bearbeiten,
freigeben, fortschreiben und drucken.

### Befehle im Einsatztagebuch

Mit der Freigabe schreibt der Befehl seinen vollständigen Text als „Anordnung“ ins ETB. Danach
ist die Fassung eingefroren, auch ihre Anlagen und ihr Verteiler. Eine Fortschreibung ist eine
neue Fassung mit eigener Freigabe.

### Benachrichtigung bei der Freigabe eines Befehls

Mit der Freigabe erhält jede Person, die eine Funktion aus dem Verteiler besetzt (laut
Stab-Besetzung, sonst laut Funktion in der Mitgliedschaft), den Hinweis „Neuer Befehl“ mit der
Fassung, etwa „Version 2“, und dem Sprung zum Befehl. Einsatzabschnitte, Einheiten, externe
Stellen und eine frei eingetippte Funktion im Verteiler erreichen niemanden. Wer das Modul
„Aufträge/Befehle“ nicht sehen darf, bekommt keinen Hinweis.

Die eigene Freigabe bleibt still: Wer freigibt, bekommt nichts, auch wenn die eigene Funktion im
Verteiler steht. Entwurf und Bearbeiten melden nichts. Eine Fortschreibung meldet sich erst mit
ihrer eigenen Freigabe, dann erneut an alle Funktionen in ihrem Verteiler; jede Freigabe meldet
sich genau einmal.

### Verteiler

Der Verteiler nennt, an wen ein Befehl geht. Er ist freiwillig und fasst höchstens 50 Einträge;
doppelte Einträge fasst die App zu einem zusammen. Personen und Fahrzeuge gehören nicht in den
Verteiler. Jeder Eintrag behält den Namen, den er beim Speichern hatte: ein später umbenannter
oder aufgelöster Abschnitt steht weiter unter seinem alten Namen da, und eine Funktion nennt nie
die Person, die sie gerade besetzt.

Bei der Freigabe steht der Verteiler im ETB-Eintrag als Empfänger („An“), bei vielen Einträgen
gekürzt auf „… und N weitere“, und vollständig als Abschnitt „Verteiler“ am Ende des Textes.
Ohne Verteiler bleibt „System“ der Empfänger. Gedruckt steht der Verteiler im Kopf des Blatts,
im Entwurf mit dem Stand im Formular, auch wenn er noch nicht gespeichert ist. Eine
Fortschreibung übernimmt den Verteiler der freigegebenen Fassung, aber keine Quittung: In der
neuen Fassung sind alle Stellen wieder offen.

„Empfänger filtern“ wirkt in beiden Reitern gleich: Es zeigt nur Aufträge bzw. Befehle, die den
gewählten Abschnitt oder die gewählte Einheit nennen, ohne Unterabschnitte.

### Quittung eines Befehls im Einsatztagebuch

Jede Quittung schreibt einen Systemeintrag „Empfang quittiert: Einsatzbefehl v2 (ETB 17)“ mit der
Stelle aus dem Verteiler als Absender („Von“). „ETB 17“ ist die Nummer des Eintrags, mit dem die
Fassung freigegeben wurde. Den Titel nennt der Eintrag nicht. Eine zurückgenommene Quittung
schreibt dazu „Quittung zurückgenommen: Einsatzbefehl v2 (ETB 17)“, der Eintrag der Quittung
bleibt stehen. Quittiert eine Stelle doppelt, entsteht kein zweiter Eintrag.

## Grundlagen und Quellen

Die Befehlsschemata der App sind „Befehl LAD (vereinfacht)“ mit Lage, Auftrag und Durchführung,
„Befehl LADEF (erweitert, SKK)“ mit zusätzlich Einsatzunterstützung sowie Führung und
Kommunikation, „Befehl SCHNEE“ mit Schadenlage, Nachbarn, Entschluss / Absicht, Einzelauftrag
und eigenem Standort sowie, nur noch an bestehenden Befehlen, „Einzelauftrag (EA/ZMW)“ mit
Einheit, Auftrag / Ziel, Mittel und Weg.

Das Auftragsformular folgt dem Einzelauftrag der FwDV 100: Einheit – Auftrag – Mittel – Ziel –
Weg, ergänzt um die Zeit. In dieser Reihenfolge wird ein Auftrag im Funk durchgegeben, und in
dieser Reihenfolge steht er auf dem Auftragsblatt.

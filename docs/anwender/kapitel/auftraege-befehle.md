---
titel: Aufträge und Befehle
gruppen: [fuehrung]
reihenfolge: 120
quellen: [frontend/src/pages/AuftraegePage.tsx, frontend/src/components/ListeDetail.tsx, frontend/src/auftraege/AuftraegeListe.tsx, frontend/src/auftraege/AuftragErteilenDialog.tsx, frontend/src/auftraege/AuftragFormular.tsx, frontend/src/auftraege/AuftragListenKarte.tsx, frontend/src/auftraege/AuftragDetail.tsx, frontend/src/auftraege/AuftragTeile.tsx, frontend/src/auftraege/VollzugMeldenModal.tsx, frontend/src/auftraege/BefehlListe.tsx, frontend/src/auftraege/BefehlListenKarte.tsx, frontend/src/auftraege/BefehlDetail.tsx, frontend/src/pages/BefehlDetailPage.tsx, frontend/src/befehle/vorlagen.ts, frontend/src/entwurf/useEntwurfVerlustschutz.ts, frontend/src/entwurf/DokumentAnlagen.tsx, frontend/src/kommunikation/gruppierung.ts, frontend/src/einsatz/AlarmZentrale.tsx, frontend/src/pages/einstellungen/EinsatzVerhalten.tsx, src/routes/auftrag.rs, src/auftrag/repo.rs, src/auftrag/eingabe.rs, src/routes/befehl.rs, src/befehl/mod.rs]
---

## Überblick

Das Modul „Aufträge/Befehle“ hat zwei Reiter:

- **Einzelaufträge** gehen an einen oder mehrere Empfänger. Jeder Empfänger quittiert den
  Empfang; ist die Arbeit getan, wird der Vollzug gemeldet und der Auftrag abgenommen.
- **Einsatzbefehle** sind Dokumente nach einem Befehlsschema. Sie entstehen als Entwurf, werden
  freigegeben und lassen sich danach nur noch in einer neuen Fassung fortschreiben.

Lesen dürfen alle mit Zugang zum Einsatz. Erteilen, Quittieren, Entwerfen und Freigeben dürfen
Einsatzleitung und Führungspersonal, solange der Einsatz läuft (siehe
[Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Einen Auftrag erteilen

Für Einsatzleitung und Führungspersonal:

1. Im Einsatz „Aufträge/Befehle“ öffnen, Reiter „Einzelaufträge“, und „Auftrag erteilen“ wählen.
   Der Dialog „Auftrag erteilen“ öffnet sich.
2. Unter „Auftrag / Was“ den Auftrag formulieren.

   ![Dialog „Auftrag erteilen“ mit Auftragstext, Empfänger „Logistiktrupp“, Priorität „Dringend“ und dem leeren Feld „Frist (Quittung/Vollzug)“](../bilder/auftraege-befehle/auftrag-erteilen.png)

3. Unter „Empfänger“ einen Abschnitt, eine Einheit oder eine Funktion (zum Beispiel S3) wählen
   oder eintippen. Ein Komma trennt mehrere Empfänger.
4. „Priorität“ und bei Bedarf „Frist (Quittung/Vollzug)“ setzen.
5. Bei Bedarf „Befehlsschema und Richtung (optional)“ aufklappen: „Richtung“ (Intern oder
   Extern), „Erteilt am (optional)“, bei extern „Externe Stelle“ und „Bezeichnung der Stelle“,
   dazu die Felder „Absicht / Ziel“, „Lage“, „Ort / Wo“, „Zeit / Wann“, „Mittel / Womit“,
   „Verbindung / Meldewege“ und „Sicherheit / Besonderes“.
6. „Auftrag erteilen“ wählen. Der Dialog schließt sich.

„Speichern und nächste“ (Strg+Enter, am Mac ⌘+Enter) erteilt den Auftrag und leert das Formular
für den nächsten; der Dialog bleibt offen. Mit dem Häkchen „Werte behalten“ bleiben Empfänger,
Priorität und Richtung stehen.

### Aufträge finden und quittieren

1. Im Reiter „Einzelaufträge“ die Ansicht „Offen“ oder „Abgeschlossen“ wählen. Bei Bedarf im
   Suchfeld „Kennung, Text oder Empfänger“ suchen, eine Richtung wählen oder „Empfänger filtern“.

   ![Einzelaufträge mit der Liste der offenen Aufträge links und dem gewählten Auftrag rechts, darin „Bearbeitung beginnen“, „Vollzug melden“ und „Quittung offen:“ mit „Quittieren“](../bilder/auftraege-befehle/auftraege-liste.png)

2. Einen Auftrag in der Liste wählen. Auf breitem Bildschirm steht er rechts neben der Liste, auf
   schmalem klappt er unter seiner Karte auf.
3. Im Auftrag unter „Empfänger“ steht neben „Quittung offen:“ jeder Empfänger, der noch nicht
   quittiert hat. „Quittieren“ wählen und die Rückfrage „Empfang/Kenntnis quittieren?“ mit
   „Empfang quittieren“ bestätigen.
4. Hat ein Empfänger mit der Arbeit begonnen, „Bearbeitung beginnen“ wählen. Ein Hinweis bietet
   sechs Sekunden lang „Rückgängig“.

Offene Aufträge stehen in den Gruppen „Überfällig“, „Heute fällig“, „Später“ und „Ohne Frist“.
Auf breitem Bildschirm ist der oberste Auftrag schon gewählt. Der gewählte Auftrag zeigt den
ganzen Text, alle Empfänger, die Felder des Befehlsschemas unter „Schema“ und unter „Verlauf“ die
Zeitpunkte von Erteilung, Quittungen, Bearbeitung, Vollzug und Abnahme. Die Suche findet auch
ältere abgeschlossene Aufträge, die noch nicht geladen sind.

### Den Vollzug melden und den Auftrag abnehmen

Für Einsatzleitung und Führungspersonal:

1. Den Auftrag wählen und „Vollzug melden“ wählen.
2. Im Dialog „Vollzug melden“ die „Rückmeldung zur Erledigung“ eintragen und „Vollzug melden“
   wählen. Der Auftrag wechselt in die Ansicht „Abgeschlossen“; solange er gewählt bleibt, steht
   er mit dem Hinweis „Nicht mehr in dieser Ansicht“ weiter da.
3. Zur Kontrolle in „Abgeschlossen“ den Auftrag wählen, „Abnehmen“ wählen und die Rückfrage
   „Auftrag abnehmen?“ mit „Auftrag abnehmen“ bestätigen.

Die Abnahme lässt sich nicht zurücknehmen.

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

Ein gespeicherter Entwurf öffnet sich wieder über den Reiter „Einsatzbefehle“, Ansicht
„Entwürfe“: Befehl wählen und „Entwurf bearbeiten“.

### Einen Einsatzbefehl lesen, freigeben und fortschreiben

1. Im Reiter „Einsatzbefehle“ die Ansicht „Entwürfe“ oder „Freigegeben“ wählen, bei Bedarf im
   Suchfeld „Titel oder Schema“ suchen, und einen Befehl wählen. Er steht mit Schema, Zeitstand,
   Ersteller, Freigabe und dem ganzen „Befehlstext“ neben bzw. unter der Liste.

   ![Einsatzbefehle mit der Liste der Befehle links und dem gewählten Befehl rechts, darin „Entwurf bearbeiten“, „Freigeben“ und der Befehlstext](../bilder/auftraege-befehle/befehl-detail.png)

2. Für Einsatzleitung und Führungspersonal: Am Entwurf „Freigeben“ wählen. Die Rückfrage
   „Befehl freigeben?“ warnt: „Endgültig: geht ins ETB, Korrektur nur per Fortschreibung.“ Mit
   „Freigeben“ bestätigen.
3. Ist später etwas zu ändern, am freigegebenen Befehl „Fortschreiben“ wählen. Es entsteht eine
   neue Fassung als Entwurf, die sich zum Bearbeiten öffnet und wieder freigegeben wird.
4. „Vollansicht“ öffnet den Befehl ganzseitig. Dort führt ein freigegebener Befehl im Kopf mit
   „Zum ETB-Eintrag“ ins Tagebuch, und „Drucken / als PDF“ gibt ihn auf Papier aus (siehe
   [Drucken und Export](drucken-export.md)). „Aufträge/Befehle“ oben im Ortspfad führt zurück, der
   Befehl ist dann gewählt.

Ein Befehl ohne jeden Text lässt sich nicht freigeben; die Rückfrage meldet dann „Der Befehl ist
leer und kann nicht freigegeben werden“. Die Fassung steht als „v1“, „v2“ … an der Karte; eine
Fortschreibung trägt denselben Titel wie ihr Vorgänger.

## Hintergrund

### Fristen und Alarm

Eine Frist am Auftrag gilt für Quittung und Vollzug. Bleibt das Feld leer, setzt die App die
Vorgabe aus den Einstellungen des Einsatzes unter „Verhalten & Automatik“, Feld „Quittierfrist
Aufträge (Minuten)“; ohne Vorgabe hat der Auftrag keine Frist.

Mit einer Frist legt die App die automatische Erinnerung „Auftrag #… Quittierfrist“ an. Läuft
die Frist ab, bevor alle Empfänger quittiert haben, meldet sich der Hinweis „Auftrag überfällig“
mit „Quittierfrist überschritten“ und „Öffnen“; die Karte steht unter „Überfällig“. Quittieren
alle Empfänger, schließt die Erinnerung.

### Aufträge im Einsatztagebuch

Ein erteilter Auftrag schreibt eine „Anordnung“ ins ETB, solange „Automatische ETB-Einträge“
nicht ausgeschaltet ist. Der gemeldete Vollzug schreibt immer eine „Meldung“ mit der Rückmeldung.

Aufträge lassen sich auch direkt aus einem ETB-Eintrag oder einer Meldung erteilen (siehe
[Einsatztagebuch](einsatztagebuch.md) und [Meldungen](meldungen.md)). Ein Auftrag aus einem
ETB-Eintrag führt unter „Verlauf“ mit „ETB-Eintrag“ zu diesem Eintrag zurück.

### Befehle im Einsatztagebuch

Mit der Freigabe schreibt der Befehl seinen vollständigen Text als „Anordnung“ ins ETB. Danach
ist die Fassung eingefroren, auch ihre Anlagen. Eine Fortschreibung ist eine neue Fassung mit
eigener Freigabe.

## Grundlagen und Quellen

Die Befehlsschemata der App sind „Befehl LAD (vereinfacht)“ mit Lage, Auftrag und Durchführung,
„Befehl LADEF (erweitert, SKK)“ mit zusätzlich Einsatzunterstützung sowie Führung und
Kommunikation, „Befehl SCHNEE“ mit Schadenlage, Nachbarn, Entschluss / Absicht, Einzelauftrag
und eigenem Standort und „Einzelauftrag (EA/ZMW)“ mit Einheit, Auftrag / Ziel, Mittel und Weg.

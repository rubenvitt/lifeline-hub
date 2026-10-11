---
titel: Einsatzabschnitte und Führungsorganisation
gruppen: [fuehrung]
reihenfolge: 420
quellen: [frontend/src/pages/EinsatzabschnittePage.tsx, frontend/src/pages/einsatzabschnitte/AbschnittDaten.tsx, frontend/src/pages/einsatzabschnitte/GliederungZug.tsx, frontend/src/pages/einsatzabschnitte/VerschiebenDialog.tsx, frontend/src/pages/einsatzabschnitte/gliederungZug.ts, frontend/src/components/organigramm/useGehaltenerBaum.ts, src/routes/einsatz_einheit.rs, frontend/src/pages/einsatzabschnitte/Organigramm.tsx, frontend/src/pages/einsatzabschnitte/fuehrungsorganisation.ts, frontend/src/einsatz/schreibrecht.ts, frontend/src/fuehrung/, src/routes/einsatzabschnitt.rs, src/einsatzabschnitt/mod.rs, src/fuehrung/]
---

## Überblick

„Einsatzabschnitte“ gliedert den Einsatz räumlich oder nach Aufgaben. Jeder Abschnitt trägt
Leitung, Lage, Auftrag, Funkangaben und die Einheiten, die ihm zugeordnet sind; Abschnitte lassen
sich unterteilen. Die Seite hat zwei Ansichten: die „Gliederung“ zum Pflegen und das
„Organigramm“, das die Führungsorganisation des Einsatzes zeigt, druckt und in einen Lagebericht
übernimmt. Lesen können alle Mitglieder des Einsatzes, pflegen dürfen Einsatzleitung und
Führungspersonal.

## Abläufe

### Einen Abschnitt nachsehen

1. „Einsatzabschnitte“ öffnen. Die „Gliederung“ zeigt den Baum der Abschnitte mit Lage, Stärke,
   Zahl der direkt zugeordneten Einheiten und dem Hinweis „ohne Leiter“.
2. Einen Abschnitt wählen. Rechts stehen seine Angaben und die „Zugeordneten Einheiten“.

   ![Gliederung mit dem gewählten Abschnitt Sanitätsdienst und seinen Angaben](../bilder/einsatzabschnitte/gliederung.png)

3. „Zu den Einheiten ↗“ führt zur Seite der Einheiten.

### Einen Abschnitt anlegen

1. Im Seitenkopf „Abschnitt anlegen“ wählen.
2. „Name“ eintragen, bei Bedarf „Kurzbezeichnung“ und den „Über-Abschnitt“ für einen
   Unterabschnitt.
3. Unter „Lage“ „Lagezustand“, „Abschnittsauftrag“ und „Fortschritt“ eintragen, unter „Funk /
   Kommunikation“ die Sprechgruppen, das Kommunikationsmittel und die „Erreichbarkeit / Nummer“.

   ![Formular „Neuer Abschnitt“ mit Name, Kurzbezeichnung, Lagezustand und Abschnittsauftrag](../bilder/einsatzabschnitte/abschnitt-anlegen.png)

4. „Speichern“ wählen.

Fehlt eine Sprechgruppe in der Liste, legt „neue Sprechgruppe anlegen“ sie für diesen Einsatz an
(„Neue Bezeichnung“, „Neue Betriebsart“, dann „Anlegen“). Sie trägt danach den Zusatz „(lokal)“.

### Einen Abschnitt ändern oder auflösen

1. In der Gliederung den Abschnitt wählen und „Bearbeiten“ wählen.
2. Die Angaben ändern und „Speichern“ wählen.
3. Zum Auflösen neben „Bearbeiten“ das Menü „Weitere Aktionen“ öffnen, „Auflösen“ wählen und
   die Rückfrage „Abschnitt auflösen?“ mit „Abschnitt auflösen“ bestätigen.

### Einen Abschnitt umhängen

1. In der Gliederung den Abschnitt am Griff vor seinem Namen fassen.
2. Auf den künftigen Über-Abschnitt ziehen und loslassen. Gestrichelt umrandet sind die Ziele,
   die den Abschnitt annehmen; seine eigenen Unterabschnitte und sein jetziger Über-Abschnitt
   tragen keinen Rahmen. Unter dem Baum erscheint dabei „Oberste Ebene“: dort losgelassen, steht
   der Abschnitt ohne Über-Abschnitt.
3. Der Hinweis „„…“ unter „…“ verschoben“ bietet einige Sekunden lang „Rückgängig“ an.

Ohne Ziehen, etwa per Tastatur oder mit Handschuh:

1. Den Abschnitt wählen, im Menü „Weitere Aktionen“ „Verschieben unter …“ wählen.
2. Im Dialog das Ziel wählen; „Oberste Ebene“ steht zuerst, der jetzige Ort trägt den Zusatz
   „(jetziger Ort)“ und ist nicht wählbar. Der Abschnitt selbst und seine Unterabschnitte stehen
   nicht in der Liste.

### Eine Einheit einem anderen Abschnitt zuordnen

1. Den Abschnitt wählen, unter dem die Einheit steht.
2. Unter „Zugeordnete Einheiten“ die Einheit am Griff vor ihrem Namen fassen und auf einen
   anderen Abschnitt der Gliederung ziehen.
3. Der Hinweis „„…“ zu „…“ zugeordnet“ bietet einige Sekunden lang „Rückgängig“ an.

Ohne Ziehen ordnet das Feld „Abschnitt“ an der Einheit selbst zu („Zu den Einheiten ↗“); dort
lässt sich die Zuordnung auch aufheben.

### Das Organigramm ansehen, drucken oder übernehmen

1. In der Leiste „Ansicht“ „Organigramm“ wählen.

   ![Organigramm mit Einsatzleitung, Stab und den Abschnitten samt Einheiten](../bilder/einsatzabschnitte/organigramm.png)

2. Mit „Alle aufklappen“ und „Alle zuklappen“ die Tiefe wählen; ein Name führt zu seinem
   Datensatz.
3. „Drucken / als PDF“ druckt das Organigramm. „In Lagebericht übernehmen“ legt einen
   Lagebericht „Führungsorganisation …“ mit dem heutigen Stand an und öffnet ihn.

## Hintergrund

### Wer was darf

Abschnitte anlegen, ändern und auflösen dürfen Einsatzleitung und Führungspersonal, solange der
Einsatz läuft. „In Lagebericht übernehmen“ erscheint nur für sie und nur, wenn das Modul
Lageberichte freigegeben ist. Den Stab zeigt das Organigramm nur, wenn das Modul Stab freigegeben
ist. Einzelheiten stehen in [Rechte im Einsatz](rechte-im-einsatz.md).

### Was ins Einsatztagebuch geht

- Anlegen: „Abschnitt «…» angelegt“, mit Lagezustand, wenn einer gesetzt ist.
- Ein geänderter Lagezustand: „Lage Abschnitt «…»: alt → neu“.
- Eine Einheit in einem anderen Abschnitt: „Einheit «…»: Abschnitt «…» zugeordnet“, auch beim
  Ziehen in der Gliederung und beim „Rückgängig“.
- Auflösen: „Abschnitt «…» aufgelöst“. Ein Gerät, das an den Abschnitt gekoppelt war, verliert
  dabei seinen Zugriff; auch das steht im Einsatztagebuch.
- Andere Korrekturen, das Umhängen eines Abschnitts und die Zuordnung von Sprechgruppen schreiben
  keinen Eintrag.

### Regeln der Gliederung

- Die „Kurzbezeichnung“ ist höchstens 20 Zeichen lang und je Einsatz eindeutig, ohne Rücksicht auf
  Groß- und Kleinschreibung; eine doppelte meldet „Schon vergeben (…)“.
- Beim Auflösen rücken Unterabschnitte eine Ebene hoch, zugeordnete Einheiten stehen danach
  „nicht zugeordnet“.
- Ein Abschnitt kann nie unter sich selbst oder einen seiner Unterabschnitte gehängt werden. Die
  Gliederung bietet solche Ziele gar nicht erst an, und der Server lehnt sie ebenso ab.
- Umgehängt wird nur die Stellung im Baum: Name, Leitung, Lage und Einheiten des Abschnitts
  bleiben, wie sie sind. Die Stärke der Über-Abschnitte rechnet sich neu.
- Die „Stärke“ eines Abschnitts ergibt sich aus seinen Einheiten; „Stärke inkl.
  Unterabschnitte“ nimmt die der Unterabschnitte hinzu.

### Änderungen anderer Arbeitsplätze

Was ein anderer Arbeitsplatz anlegt oder umhängt, erscheint in der Gliederung von selbst. Liegt
der Mauszeiger über der Gliederung oder steht der Fokus darin, hält sie still: über dem Baum steht
„Live pausiert“, und neue oder umgehängte Abschnitte warten in einem Hinweis wie „1 umgehängt“,
bis „anzeigen“ sie übernimmt. Namen, Lage und Stärke aktualisieren sich weiter sofort. Ein
aufgelöster Abschnitt verschwindet gleich. Eigene Änderungen erscheinen immer sofort.

### Das Organigramm

Das Organigramm wird nicht gepflegt, es entsteht aus Abschnitten, Einheiten und der Besetzung des
Stabs. Den Kasten der Einsatzleitung beschriftet es mit „Leitung nicht erfasst“, weil die App die
Person der Einsatzleitung nicht als Angabe führt. An der Wurzel steht keine Stärke; die
Gesamtstärke zeigt das Meldebild.

### Führungsfunktionen

Wo die App eine Führungsfunktion anbietet (etwa als Führungsstelle eines Mitglieds, als Empfänger
eines Auftrags oder im Feld „An“ des Einsatztagebuchs), kommt sie aus einem festen Katalog:
Einsatzleitung, S1 bis S7, Führungshilfspersonal und Fachberater. Die Bezeichnungen und ob es S7
gibt, legt die Organisation fest. Ein Freitext wie „S3“ wird nie als Funktion gedeutet. Gespeichert
wird die Funktion, nicht die Person; wer sie besetzt, zeigt die App erst beim Lesen.

### Ohne Netz

Abschnitte und Einheiten bleiben ohne Netz lesbar (siehe [Arbeiten ohne Netz](ohne-netz.md)).
Anlegen, Ändern und Auflösen brauchen Netz.

## Grundlagen und Quellen

- FwDV 100: Führungsorganisation, dargestellt als Organigramm.

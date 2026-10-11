---
titel: Einsatzabschnitte und Führungsorganisation
gruppen: [fuehrung]
reihenfolge: 420
quellen: [frontend/src/pages/EinsatzabschnittePage.tsx, frontend/src/pages/einsatzabschnitte/AbschnittDetail.tsx, frontend/src/pages/einsatzabschnitte/AbschnittAnlegenModal.tsx, frontend/src/pages/einsatzabschnitte/Organigramm.tsx, frontend/src/pages/einsatzabschnitte/fuehrungsorganisation.ts, frontend/src/einsatz/schreibrecht.ts, frontend/src/fuehrung/, src/routes/einsatzabschnitt.rs, src/einsatzabschnitt/mod.rs, src/fuehrung/]
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
2. Einen Abschnitt wählen. Rechts stehen seine Angaben, der „Lagezustand“ und die „Zugeordneten
   Einheiten“.

   ![Gliederung mit dem gewählten Abschnitt Sanitätsdienst, seinen Angaben und der Stufenleiste des Lagezustands](../bilder/einsatzabschnitte/gliederung.png)

3. „Zu den Einheiten ↗“ führt zur Seite der Einheiten.

### Einen Abschnitt anlegen

Für Einsatzleitung und Führungspersonal:

1. Im Seitenkopf „Abschnitt anlegen“ wählen.
2. „Name“ eintragen, bei Bedarf „Kurzbezeichnung“ und den „Über-Abschnitt“ für einen
   Unterabschnitt.

   ![Dialog „Abschnitt anlegen“ mit Name, Kurzbezeichnung und Über-Abschnitt](../bilder/einsatzabschnitte/abschnitt-anlegen.png)

3. „Anlegen“ wählen. Der neue Abschnitt steht danach gewählt in der Gliederung; Lagezustand,
   Leitung, Auftrag und Funkangaben werden dort ergänzt.

### Die Lage eines Abschnitts setzen

Für Einsatzleitung und Führungspersonal:

1. In der Gliederung den Abschnitt wählen.
2. Unter „Lagezustand“ die Stufe wählen: „nicht beurteilt“, „planmäßig“, „angespannt“ oder
   „kritisch“. Die Wahl gilt sofort.

### Eine Angabe ändern

Für Einsatzleitung und Führungspersonal:

1. In der Gliederung den Abschnitt wählen.
2. Auf den Wert der Angabe tippen, etwa auf den Abschnittsleiter; eine leere Angabe heißt
   „… eintragen“.
3. Den neuen Wert eingeben und „Speichern“ wählen. „Abbrechen“ lässt den alten Wert stehen.

Fehlt eine Sprechgruppe in der Liste, legt „neue Sprechgruppe anlegen“ sie für diesen Einsatz an
(„Neue Bezeichnung“, „Neue Betriebsart“, dann „Anlegen“). Sie trägt danach den Zusatz „(lokal)“.

Einheiten werden nicht hier zugeordnet, sondern an der Einheit selbst im Feld „Abschnitt“.

### Einen Abschnitt auflösen

Für Einsatzleitung und Führungspersonal:

1. In der Gliederung den Abschnitt wählen.
2. Unter den Angaben „Auflösen“ wählen und die Rückfrage „Abschnitt auflösen?“ mit „Abschnitt
   auflösen“ bestätigen.

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
- Auflösen: „Abschnitt «…» aufgelöst“. Ein Gerät, das an den Abschnitt gekoppelt war, verliert
  dabei seinen Zugriff; auch das steht im Einsatztagebuch.
- Andere Korrekturen und die Zuordnung von Sprechgruppen schreiben keinen Eintrag.

### Regeln der Gliederung

- Jede Angabe wird für sich gespeichert. Was ein anderer Arbeitsplatz inzwischen an einer anderen
  Angabe geändert hat, bleibt dabei stehen.
- Die Lage eines Abschnitts trägt der Lagezustand, seinen Arbeitsstand zeigen die offenen
  Aufträge des Abschnitts im Führungsüberblick.
- Jede Wahl in „Lagezustand“ gilt sofort, auch mit den Pfeiltasten, und jeder Wechsel steht im
  Einsatztagebuch. Wer mit den Pfeiltasten über eine Stufe hinweg wandert, erzeugt deshalb auch
  für die Zwischenstufe einen Eintrag; ein Klick auf die Zielstufe erzeugt nur einen.
- Die „Kurzbezeichnung“ ist höchstens 20 Zeichen lang und je Einsatz eindeutig, ohne Rücksicht auf
  Groß- und Kleinschreibung; eine doppelte meldet „Schon vergeben (…)“.
- Beim Auflösen rücken Unterabschnitte eine Ebene hoch, zugeordnete Einheiten stehen danach
  „nicht zugeordnet“.
- Die „Stärke“ eines Abschnitts ergibt sich aus seinen Einheiten; „Stärke inkl.
  Unterabschnitte“ nimmt die der Unterabschnitte hinzu.

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

---
titel: Einsatzabschnitte und Führungsorganisation
gruppen: [fuehrung]
reihenfolge: 420
quellen: [frontend/src/pages/EinsatzabschnittePage.tsx, frontend/src/pages/einsatzabschnitte/AbschnittDetail.tsx, frontend/src/pages/einsatzabschnitte/AbschnittAnlegenModal.tsx, frontend/src/pages/einsatzabschnitte/GliederungDrag.tsx, frontend/src/pages/einsatzabschnitte/VerschiebenDialog.tsx, frontend/src/pages/einsatzabschnitte/useNewGesture.ts, frontend/src/pages/einsatzabschnitte/gliederungDragKern.ts, frontend/src/components/organigramm/useGehaltenerBaum.ts, src/routes/einsatz_einheit.rs, frontend/src/pages/einsatzabschnitte/Organigramm.tsx, frontend/src/pages/einsatzabschnitte/fuehrungsorganisation.ts, frontend/src/einsatz/schreibrecht.ts, frontend/src/fuehrung/, src/routes/einsatzabschnitt.rs, src/einsatzabschnitt/mod.rs, src/fuehrung/, frontend/src/stab/einsatzleiter.ts]
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
4. „Auf Karte zeigen ↗“ oben rechts bei den Angaben öffnet die [Lagekarte](lagekarte.md) mit dem
   Fokus auf diesen Abschnitt: Kräfte anderer Abschnitte erscheinen dort blass.

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

### Einen Abschnitt umhängen

Für Einsatzleitung und Führungspersonal:

1. In der Gliederung den Abschnitt am Griff vor seinem Namen fassen.
2. Auf den künftigen Über-Abschnitt ziehen und loslassen. Gestrichelt umrandet sind die Ziele,
   die den Abschnitt annehmen; seine eigenen Unterabschnitte und sein jetziger Über-Abschnitt
   tragen keinen Rahmen. Unter dem Baum erscheint dabei „Oberste Ebene“: dort losgelassen, steht
   der Abschnitt ohne Über-Abschnitt.
3. Der Hinweis „„…“ unter „…“ verschoben“ (bzw. „„…“ auf die oberste Ebene verschoben“) bietet
   einige Sekunden lang „Rückgängig“ an.

Für Einsatzleitung und Führungspersonal, ohne Ziehen, etwa per Tastatur oder mit Handschuh:

1. Den Abschnitt wählen, im Menü „Weitere Aktionen“ „Verschieben unter …“ wählen.
2. Im Dialog das Ziel wählen; „Oberste Ebene“ steht zuerst, der jetzige Ort trägt den Zusatz
   „(jetziger Ort)“ und ist nicht wählbar. Der Abschnitt selbst und seine Unterabschnitte stehen
   nicht in der Liste.

   ![Dialog „„Sanitätsdienst“ verschieben unter …“ mit den Zielen Oberste Ebene, Betreuung und Logistik](../bilder/einsatzabschnitte/verschieben-unter.png)

### Eine Einheit einem anderen Abschnitt zuordnen

Für Einsatzleitung und Führungspersonal:

1. Den Abschnitt wählen, unter dem die Einheit steht.
2. Unter „Zugeordnete Einheiten“ die Einheit am Griff vor ihrem Namen fassen und auf einen
   anderen Abschnitt der Gliederung ziehen.
3. Der Hinweis „„…“ zu „…“ zugeordnet“ bietet einige Sekunden lang „Rückgängig“ an.

Ohne Ziehen ordnet das Feld „Abschnitt“ an der Einheit selbst zu („Zu den Einheiten ↗“); dort
lässt sich die Zuordnung auch aufheben.

### Einen Abschnitt auflösen

Für Einsatzleitung und Führungspersonal:

1. In der Gliederung den Abschnitt wählen.
2. Unter den Angaben das Menü „Weitere Aktionen“ öffnen, „Auflösen“ wählen und die Rückfrage
   „Abschnitt „…“ auflösen?“ mit „Abschnitt auflösen“ bestätigen.

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
ist. „Auf Karte zeigen ↗“ steht für alle, die den Abschnitt lesen; ohne Zugriff auf die Lagekarte
lautet er „Auf Karte zeigen (Keine Berechtigung)“ und ist gesperrt. Einzelheiten stehen in
[Rechte im Einsatz](rechte-im-einsatz.md).

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
bis „anzeigen“ sie übernimmt. Namen, Lage und Stärke der übrigen Abschnitte aktualisieren sich
weiter sofort; ein fremd umgehängter Abschnitt zeigt bis „anzeigen“ seinen alten Stand an seinem
alten Ort. Ein aufgelöster Abschnitt verschwindet gleich. Eigene Änderungen erscheinen immer
sofort.

### Das Organigramm

Das Organigramm wird nicht gepflegt, es entsteht aus Abschnitten, Einheiten, der eigenen
Führungsstelle und der Besetzung des Stabs. Im Kasten der Einsatzleitung stehen Bezeichnung und
Rufname der eigenen Führungsstelle, sobald sie in den Einsatzdaten erfasst sind, und darunter der
Einsatzleiter mit „seit“, wie er in „Einsatzdaten“ festgelegt ist (siehe
[Einsatzdaten und Führungsstelle](einsatzdaten.md)). Ist keiner festgelegt, steht dort „Leitung
nicht erfasst“; die Rolle Einsatzleitung im „Zugriff“ macht niemanden zum Einsatzleiter. An der
Wurzel steht keine Stärke; die Gesamtstärke zeigt das Meldebild.

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

---
titel: Einsatzdaten und Führungsstelle
gruppen: [fuehrung]
reihenfolge: 410
quellen: [frontend/src/pages/EinsatzdatenPage.tsx, frontend/src/components/InlineAngabe.tsx, frontend/src/anzeige/KoordinatenEingabe.tsx, frontend/src/einsatz/schreibrecht.ts, frontend/src/api/queryKeys.ts, src/routes/einsatz.rs, src/routes/einsatz_fuehrungsstelle.rs, src/einsatz/repo.rs]
---

## Überblick

Die Seite „Einsatzdaten“ hält die Stammangaben des Einsatzes. Im Seitenkopf stehen neben dem
Titel die Einsatznummer und die Leitstellen-Nr., darunter die Kopfleiste mit Stichwort,
Alarmzeit, Einsatzort und Einsatzleitung. Es folgen die Paneele „Einsatz“, „Einsatzort“,
„Erstmeldung“ und „Eigene Führungsstelle“, am breiten Schirm in zwei Spalten. Lesen können alle
Mitglieder des Einsatzes. Ändern dürfen Einsatzleitung und Führungspersonal sowie die
Administration der Organisation, der der Einsatz gehört. Wer in den Einsatz darf, regelt die
Einsatzleitung in den Einstellungen unter „Zugriff“ (siehe [Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Eine Angabe ändern

1. „Einsatzdaten“ öffnen.

   ![Seite „Einsatzdaten“ mit Kennungen im Seitenkopf, Kopfleiste und den Paneelen Einsatz, Einsatzort, Erstmeldung und Eigene Führungsstelle](../bilder/einsatzdaten/einsatzdaten.png)

2. Den Wert der Zeile wählen (Stift daneben) oder, wenn die Zeile leer ist, „… eintragen“.
3. Den neuen Wert eingeben.
4. Mit Enter oder „Speichern“ übernehmen. Escape oder „Abbrechen“ verwirft die Eingabe. Die App
   meldet „… gespeichert“.

So lassen sich Bezeichnung, Einsatzstichwort, Alarmzeit, Einsatzort, Einsatzart, Leitstellen-Nr.,
Nächste Lagebesprechung, Koordinate, Meldende Stelle, Sachverhalt / Meldebild und Anzahl
Betroffene (initial) ändern. Ein eigenes Formular für alle Angaben gibt es nicht.

### Die Koordinate eintragen

1. Im Paneel „Einsatzort“ „Koordinate eintragen“ oder die bisherige Koordinate wählen.
2. Die Koordinate eingeben; daneben unter „Koordinatenformat“ das Format wählen, in dem sie
   vorliegt.
3. „Speichern“ wählen. Ist die Eingabe nicht lesbar, steht unter dem Feld „Ungültige Koordinate
   im Format …“; „Speichern“ übernimmt dann nichts, und die Zeile bleibt offen.

### Die eigene Führungsstelle erfassen

1. In „Einsatzdaten“ zum Paneel „Eigene Führungsstelle“ gehen.

   ![Paneel „Eigene Führungsstelle“ mit Rufname, Sprechgruppen, Kommunikationsmittel, Erreichbarkeit und Fahrzeug](../bilder/einsatzdaten/fuehrungsstelle.png)

2. „Rufname“, „Sprechgruppen“, „Kommunikationsmittel“, „Erreichbarkeit“ und „Fahrzeuge“ Zeile
   für Zeile eintragen und speichern wie jede andere Angabe.

### Zum Zugriff wechseln

Für die Einsatzleitung:

1. Im Seitenkopf „Zugriff verwalten“ wählen (am Handy unter „Weitere“).
2. Es öffnen sich die Einstellungen des Einsatzes im Reiter „Zugriff“; die Abläufe dort stehen in
   [Rechte im Einsatz](rechte-im-einsatz.md).

## Hintergrund

### Wer was darf

- **Angaben und eigene Führungsstelle** ändern Einsatzleitung und Führungspersonal sowie die
  Administration der Organisation des Einsatzes, solange der Einsatz läuft. Wer das nicht darf,
  sieht den Hinweis „nur Einsatzleitung, Führungspersonal oder Org-Admin“.
- **Zugriff** (Mitglieder, Rollen, Führungsstelle je Mitglied) verwaltet nur die
  Einsatzleitung, in den Einstellungen des Einsatzes. Nur sie sieht den Sprung „Zugriff
  verwalten“.
- Was die Rollen im Einzelnen bedeuten, steht in [Rechte im Einsatz](rechte-im-einsatz.md).

### Was eine Änderung bewirkt

- Jede Zeile speichert nur ihren eigenen Wert, die Koordinate als Paar aus Breite und Länge. So
  überschreibt niemand die Angabe, die eine andere Person gerade in einer anderen Zeile
  gespeichert hat. Wer eine Zeile verlässt, ohne zu speichern, behält den alten Wert.
- „Bezeichnung“ und „Alarmzeit“ sind Pflicht: leer gespeichert bleibt der bisherige Wert stehen,
  und die Zeile sagt, dass die Angabe Pflicht ist.
- Änderungen an Angaben und eigener Führungsstelle erscheinen sofort an allen anderen Geräten. Sie
  schreiben keinen Eintrag ins Einsatztagebuch.
- Die „Einsatznummer“ vergibt das System; sie lässt sich nicht ändern. Sie steht im Seitenkopf und
  im Paneel „Einsatz“, ebenso die Leitstellen-Nr., mit der Leitstelle, Rückfragen und
  Einsatzbericht arbeiten.
- Die **eigene Führungsstelle** speist Funkplan, Fernmeldeskizze und Kommunikationsplan (siehe
  [Funkplan, Fernmeldeskizze und Kommunikationsplan](funkplan.md)); dort wird sie nicht
  bearbeitet. „Fahrzeuge“ bietet nur disponierte Fahrzeuge an und nur, wenn das Modul Fahrzeuge
  freigegeben ist.

### Ohne Netz

Die Angaben des Einsatzkopfs bleiben ohne Netz lesbar, die eigene Führungsstelle nicht (siehe
[Arbeiten ohne Netz](ohne-netz.md)).

---
titel: Betroffene und Sichtung
gruppen: [alle, fuehrung]
reihenfolge: 510
quellen: [frontend/src/pages/PersonenPage.tsx, frontend/src/pages/PersonenDetailPage.tsx, frontend/src/pages/lagekarte/verortungsauftrag.ts, frontend/src/personen/PersonErfassungModal.tsx, frontend/src/personen/AufnahmeFelder.tsx, frontend/src/personen/BetroffeneZeile.tsx, frontend/src/personen/personBefehl.ts, frontend/src/personen/BetroffenenSeitenleiste.tsx, frontend/src/personen/personenBilanz.ts, frontend/src/personen/personenSpalten.tsx, frontend/src/personen/ZeilenSichtung.tsx, frontend/src/personen/personenFilter.ts, frontend/src/personen/BetroffeneKarte.tsx, frontend/src/personen/SichtungDialog.tsx, frontend/src/personen/SichtungsWahl.tsx, frontend/src/personen/Patientenkopf.tsx, frontend/src/personen/PersonBezuege.tsx, frontend/src/personen/ZuweisungsDialoge.tsx, frontend/src/personen/VerbleibErfassung.tsx, frontend/src/personen/AbgleichVorschlagModal.tsx, frontend/src/personen/personMeta.ts, frontend/src/offline/lagebildKuerzung.ts, src/routes/einsatz_person.rs, src/person/mod.rs, src/person/abgleich_repo.rs, src/person/audit_repo.rs, src/person/sichtung_repo.rs]
---

## Überblick

Das Modul „Betroffene“ führt jede Person, um die sich der Einsatz kümmert: Verletzte, Unverletzte,
Verstorbene und Vermisste. Jede Person bekommt eine Registriernummer (R-001, R-002 …), eine
Sichtungskategorie und, sobald sie die Einsatzstelle verlässt, einen Verbleib. Pflichtfelder gibt
es nicht; Name und Alter dürfen fehlen.

Die Liste zeigt neben den Personen das Sichtungsbild, den Verbleib und die offenen Felder. Im
Modulpanel führen „Patienten“ direkt ins Sichtungsraster und „Vermisste“ in die Liste der
Vermissten.

## Abläufe

### Die Lage der Betroffenen ablesen

1. Im Modulpanel „Betroffene“ öffnen. Die Liste zeigt je Person Registriernummer, Name, Sichtung,
   Zustand, Status, Fundort, Verbleib und Zeit. Ein Klick auf die Zeile öffnet die Person.

   ![Liste der Betroffenen mit Statusfilter, Suche und der Seitenleiste mit Sichtungsbild, Verbleib und offenen Feldern](../bilder/betroffene/liste.png)

2. Rechts zählt das „Sichtungsbild“ die Personen je Sichtungskategorie, „Verbleib“ zählt sie je
   Verbleib und Unfallhilfsstelle, „Offene Felder“ nennt, wem Verbleib oder Fundort fehlt.
3. Mit „Nur Lücken zeigen“ bleiben nur die Personen mit offenen Feldern in der Liste.
4. Über die Leiste oben wechselt die Ansicht zwischen „Zeilen“, „Sichtungsraster“ (nach
   Kategorien gruppiert, die älteste Sichtung zuerst) und „Karte“ (Fundorte mit Koordinate).
5. Der Statusfilter („Alle“, „Erfasst“, „Vermisst“, „Betroffen“, „Verstorben“) und die Suche
   nach R-Nr., Name oder Fundort engen die Liste ein.

### Eine Person mit der Maske erfassen

1. „Betroffene erfassen“ wählen.
2. Unter „Sichtungskategorie“ die Fläche der Kategorie antippen, dazu „Geschlecht“, „Geschätztes
   Alter (Jahre)“ und „Fundort“, soweit bekannt. Ein zweiter Tipp auf die gewählte Fläche nimmt
   die Wahl zurück; die Person wird dann ohne Sichtung erfasst.

   ![Maske „Betroffene erfassen“ mit gewählter Sichtungskategorie SK II, Geschlecht, Alter und Fundort](../bilder/betroffene/erfassen.png)

3. Name, Vorname, Zustand, Koordinate und Notiz stehen unter „Weitere Angaben“.
4. „Erfassen“ wählen. Die Quittung nennt die neue Registriernummer („Erfasst als R-…“).

Kommen mehrere Personen nacheinander, speichert „Speichern und nächste“ (Strg + Enter) und hält
die Maske offen. Mit „Werte behalten“ bleibt der Fundort für die nächste Person stehen; die
Sichtung wird nie übernommen.

### Eine Person mit der Kurzeingabe erfassen

1. In der Liste in das Feld „Kurzeingabe Person“ (Zeile „/person“) schreiben, etwa
   „Kowalski, Anna w 34 sk3 @Turnhalle“.

   ![Kurzeingabe mit erkanntem Namen, Geschlecht, Alter, Sichtung SK III und Unfallhilfsstelle](../bilder/betroffene/kurzeingabe.png)

2. Unter dem Feld steht, was erkannt wurde („erkannt: …“). Was sich nicht deuten lässt, nennt
   die Zeile unter „Nicht erfasst: …“; dann wird nichts angelegt.
3. Enter speichert. Das Feld leert sich, rechts steht „Zuletzt: …“ mit der Registriernummer.
   Escape leert das Feld, ohne zu speichern.

Die Kürzel: „Nachname, Vorname“; „m“, „w“ oder „d“ mit dem Alter (geschätzt als „~50“); „sk1“
bis „sk4“, „skt“ für tot und „sku“ für unverletzt; „#Breite/Länge“ für die Koordinate des
Fundorts; „@Name“ für die Unfallhilfsstelle, in die die Person aufgenommen wird.

### In der Liste nachsichten und Lücken schließen

1. In der Liste auf die Sichtung der Person tippen; bei einer ungesichteten Person steht dort
   „Sichten“. Die Sichtungswahl öffnet sich über der Zeile.
2. Die Fläche der Kategorie antippen und „Übernehmen“ wählen. Die Zeile zeigt die neue Kategorie,
   die Liste bleibt offen. „Abbrechen“ schließt die Wahl, ohne zu speichern.
3. Fehlt einer Person der Verbleib, steht in ihrer Spalte „Verbleib“ der Knopf „Verbleib
   erfassen“. Ihn wählen, „Art“ und „Ziel“ angeben und „Erfassen“ wählen.
4. Das Menü am Ende der Zeile (am Handy in der Karte der Person) bietet „Sichten“, „Verbleib
   erfassen“ und „Auf Lagekarte verorten“.

Mit „Nur Lücken zeigen“ lässt sich die Liste so Zeile für Zeile abarbeiten: eine Zeile, deren
Lücke gerade geschlossen wurde, bleibt mit dem neuen Wert stehen, bis die Ansicht, der Filter oder
„Nur Lücken zeigen“ wechselt; die Zahl unter „Offene Felder“ sinkt sofort.

### Sichten und den Verbleib erfassen

1. In der Liste die Person öffnen. Oben auf der Seite „Person R-…“ steht der Patientenkopf:
   Sichtung mit Zeit („gesichtet … · vor 42 min“), „Zustand / Verdacht“, Aufenthalt oder
   Verbleib und die letzte Notiz.
2. Auf die Sichtung tippen. Darunter klappt die Sichtungswahl auf: die Fläche der Kategorie
   antippen, bei Bedarf eine „Kurzbegründung (optional)“, und „Übernehmen“ wählen.
3. Verlässt die Person die Einsatzstelle, im Kopf „Verbleib erfassen“ wählen und die „Art“
   wählen: „Transport“, „Notunterkunft“, „Entlassung vor Ort“, „verbleibt vor Ort“ oder
   „Verbleib des Leichnams“. Dazu das „Ziel“ und beim Transport das „Transportmittel (RTW/KTW …)“.

   ![Patientenkopf mit aufgeklapptem Paneel „Verbleib erfassen“: Art Transport, Ziel und Transportmittel](../bilder/betroffene/verbleib.png)

4. „Verbleib erfassen“ im Paneel wählen. Danach zeigt der Kopf den Verbleib.

Bei „Notunterkunft“ bietet das Paneel die Betreuungsstellen des Einsatzes an; die gewählte Stelle
wird zum Ziel. Eine Notiz entsteht über die Zeile „Notiz“ im Kopf mit „Notiz anlegen“.

### Aufenthalt und Bezüge pflegen

1. Steht die Person in keiner Unfallhilfsstelle, im Kopf „In UHS aufnehmen“ wählen und die UHS
   wählen. Steht sie schon in einer, verlegen „Verlegen“ und „Austragen“ sie.
2. Gehört der Person ein Tier oder ist sie bei einem Schaden geschädigt, „Bezüge“ aufklappen und
   „Bezug hinzufügen“ wählen.
3. Im Feld „Tier oder Schaden“ nach Kennung, Art, Name oder Ort suchen, den Treffer wählen und
   „Hinzufügen“ wählen. Die Liste nennt den Bezug dann etwa „Halter von T-003 · Hund „Bello““.
4. „Bezug lösen“ an der Zeile hebt einen Bezug wieder auf.

### Den Fundort auf der Lagekarte verorten

1. Die Person öffnen und bei „Koordinate“ „Auf Lagekarte verorten“ wählen, oder in der Liste im
   Menü der Zeile „Auf Lagekarte verorten“. Die Lagekarte öffnet sich zum Platzieren dieser Person.
2. Auf die Stelle der Karte tippen, an der die Person gefunden wurde. Der Marker erscheint, auch
   wenn die Ebene „Betroffene“ ausgeschaltet ist, und die Karte meldet „R-… verortet“.
3. „Zurück zu R-…“ wählen. Die Seite der Person zeigt die neue Koordinate. „Auf der Karte
   bleiben“ lässt die Karte offen.

Ein erneutes Verorten setzt den Fundort neu und läuft genauso
([Lagekarte, Zeichnen und Messen](lagekarte.md)).

### Eine vermisste Person melden und abgleichen

1. „Vermisst melden“ wählen. Unter „Weitere Angaben“ stehen statt Zustand und Koordinate
   „vermisst seit“ und „Melder / Kontakt“; ohne Angabe gilt „vermisst seit“ ab der Meldung.
2. „Erfassen“ wählen. Die Person steht mit dem Status „vermisst“ in der Liste.
3. Wird jemand gefunden, der die vermisste Person sein könnte: den Statusfilter „Vermisst“
   wählen und in der Spalte „Abgleich vorschlagen“ die gefundene Person wählen.
4. Die Einsatzleitung öffnet die vermisste Person und entscheidet unter „Vermisstenabgleich“ mit
   „Bestätigen“ oder „Verwerfen“.

Nach dem Bestätigen steht die Vermisstmeldung auf „abgemeldet“, und das Einsatztagebuch vermerkt
„Vermisstmeldung R-… aufgeklärt — identisch mit R-…“.

## Hintergrund

### Status und Sichtung

Status und Sichtung sind zwei getrennte Angaben. Der Status sagt, wo die Person im Einsatz steht:

- **erfasst**: angelegt, noch nicht gesichtet,
- **betroffen**: gesichtet; die erste Sichtung hebt „erfasst“ von selbst auf „betroffen“,
- **vermisst**: gemeldet, aber nicht angetroffen,
- **verstorben** und **abgemeldet**.

Den Status ändert das Aktionsmenü der Seite mit „Auf „…“ setzen“; „verstorben“ fragt vorher nach.
Eine Sichtung „tot“ ändert den Status nicht. Die Seite der Person weist dann auf den Widerspruch
hin und bietet „Auf „verstorben“ setzen“ an. Vermisste und abgemeldete Personen lassen sich nicht
sichten.

Die Sichtungskategorien und ihre Farben: SK I akut (rot), SK II schwer (gelb), SK III leicht
(grün), SK IV abwartend (blau), tot (schwarz), unverletzt (ohne Farbe). Bei der Wahl ist jede
Kategorie eine eigene Farbfläche mit Kürzel und Bedeutungswort. Die gewählte trägt ein Häkchen und
einen kräftigen Rahmen, die übrigen treten zurück und zeigen ihre Farbe nur noch als Streifen am
Rand. So ist die Wahl auch ohne Farbe zu erkennen. Jede Fläche ist mindestens 72 px hoch, auch in
der kompakten Darstellung.

Wird eine Person mit SK I erfasst oder auf SK I hochgestuft, auch bei ihrer ersten Sichtung,
bekommen alle im Einsatz, die das Modul „Betroffene“ lesen, den Hinweis „Sichtung I“ mit der
Registriernummer und dem Sprung zur Person; Name und Befund stehen nicht darin. Wer sichtet,
bekommt keinen Hinweis, gekoppelte Geräte ebenso wenig. Eine erneute Sichtung mit SK I, eine
Herabstufung und das Bearbeiten der Angaben bleiben still.

„Stornieren“ nimmt eine Fehlerfassung aus den Arbeitssichten; der Datensatz bleibt erhalten.

### Offene Felder

Als Lücke zählt nur, wer angetroffen wurde (erfasst, betroffen, verstorben). Ohne Verbleib heißt:
weder ein Verbleib noch eine Unfallhilfsstelle. Ohne Fundort heißt: weder eine Ortsangabe noch
eine Koordinate. Solche Zeilen sind in der Liste markiert.

### Arbeiten in der Liste

Solange die Sichtungswahl, das Menü einer Zeile oder ein Dialog aus der Zeile offen ist, rücken
neu eintreffende Personen nicht in die Liste, und die Reihenfolge bleibt; ein Band über der Liste
nennt sie („1 neuer Eintrag — anzeigen“). So springt keine Zeile unter dem Finger weg. Wird eine
Sichtung aus der Liste abgelehnt, steht der Grund an der Zeile; ist die Zeile gerade nicht zu
sehen, über der Liste.

### Unfallhilfsstelle und Verbleib

Wer mit „@…“ oder über „Patient aufnehmen“ einer Unfallhilfsstelle zugeordnet wird, steht dort im
Wartebereich ([Unfallhilfsstellen](unfallhilfsstellen.md)). Ein Verbleib „Transport“,
„Notunterkunft“ oder „Entlassung vor Ort“ beendet den Aufenthalt in der Unfallhilfsstelle, ebenso
der Status „verstorben“ oder „abgemeldet“ und das Stornieren.

Eine Person mit Verbleib „Notunterkunft“ in einer Betreuungsstelle zählt dort unter „davon
namentlich“ ([Betreuung und Evakuierung](betreuung.md)). Zur Wahl unter „Bezug hinzufügen“ stehen
nur freie Tiere (ohne Halter) und Schäden ohne Geschädigte, die nicht abgeschlossen sind; ein
fremder Bezug wird nie still überschrieben.

### Einsatztagebuch und Zugriffsprotokoll

Das Einsatztagebuch führt Betroffene nur mit Registriernummer, ohne Namen: „Person R-… erfasst“,
„Person R-…: Sichtung SK …“, Statuswechsel und Stornierungen. Die Notiz im Patientenkopf ist
nicht änderbar und erscheint nicht im Einsatztagebuch.

Jedes Öffnen der Seite einer Person wird protokolliert, ebenso der CSV-Export und der Druck der
Liste. Die Einsatzleitung sieht das Protokoll unter „Listenzugriffe“ im Kopf der Liste und unter
„Zugriffs-Audit“ auf der Seite der Person.

### Rechte

Erfassen und ändern dürfen Einsatzleitung und Führungspersonal eines laufenden Einsatzes
([Rechte im Einsatz](rechte-im-einsatz.md)). Einen Vermisstenabgleich bestätigen oder verwerfen
darf nur die Einsatzleitung. Wer nicht schreiben darf, sieht über der Liste „Nur Ansicht“ mit dem
Grund („nur Einsatzleitung und Führungspersonal“ bzw. „Einsatz abgeschlossen“); Sichtungswahl,
„Verbleib erfassen“ und das Menü der Zeilen fehlen dann. Am UHS-Gerät lässt sich aus der Liste
sichten, aber nicht verorten ([UHS-Tablet und UHS-Laptop](geraet-uhs.md)).

### Ohne Netz

Personen lassen sich ohne Netz erfassen, über die Maske, die Kurzeingabe und die Aufnahme; bis
zur Verbindung tragen sie „R-…“ statt der Nummer. Lesbar bleiben Sichtung, Verbleib und
Unfallhilfsstelle. Adresse, Melder, Notiz, Zustand und Fundort liegen nicht auf dem Gerät und
erscheinen als „nicht geladen“. Mehr in [Arbeiten ohne Netz](ohne-netz.md).

## Grundlagen und Quellen

Die Sichtungskategorien SK I bis SK IV und ihre Farben folgen der Einteilung des Bundesamts für
Bevölkerungsschutz und Katastrophenhilfe (BBK).

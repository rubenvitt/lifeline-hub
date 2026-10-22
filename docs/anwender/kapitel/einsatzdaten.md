---
titel: Einsatzdaten und Führungsstelle
gruppen: [fuehrung]
reihenfolge: 410
quellen: [frontend/src/pages/EinsatzdatenPage.tsx, frontend/src/components/InlineAngabe.tsx, frontend/src/anzeige/KoordinatenEingabe.tsx, frontend/src/stab/rufnameVorschlaege.tsx, frontend/src/einsatz/schreibrecht.ts, frontend/src/api/queryKeys.ts, src/routes/einsatz.rs, src/routes/einsatz_fuehrungsstelle.rs, src/einsatz/repo.rs, frontend/src/pages/EinsatzleiterAngabe.tsx, frontend/src/stab/einsatzleiter.ts, src/einsatz/fuehrungsstelle.rs, frontend/src/stammdaten/externeStellenVorschlaege.ts, frontend/src/anzeige/Ortsfeld.tsx, frontend/src/anzeige/Kartenausschnitt.tsx, frontend/src/anzeige/KarteWaehlen.tsx, src/routes/ort_suche.rs]
---

## Überblick

Die Seite „Einsatzdaten“ hält die Stammangaben des Einsatzes. Im Seitenkopf stehen neben dem
Titel die Einsatznummer und die Leitstellen-Nr., darunter die Kopfleiste mit Stichwort,
Alarmzeit, Einsatzort und Einsatzleitung. Es folgen die Paneele „Einsatz“, „Einsatzort“ mit
Adresse, Koordinate und Kartenausschnitt, „Erstmeldung“ und „Eigene Führungsstelle“ mit dem
Einsatzleiter, am breiten Schirm in zwei Spalten. Lesen können alle Mitglieder des Einsatzes.
Ändern dürfen Einsatzleitung und Führungspersonal sowie die Administration der Organisation, der
der Einsatz gehört. Wer in den Einsatz darf, regelt die Einsatzleitung in den Einstellungen unter
„Zugriff“ (siehe [Rechte im Einsatz](rechte-im-einsatz.md)).

## Abläufe

### Eine Angabe ändern

1. „Einsatzdaten“ öffnen.

   ![Seite „Einsatzdaten“ mit Kennungen im Seitenkopf, Kopfleiste und den Paneelen Einsatz, Einsatzort, Erstmeldung und Eigene Führungsstelle](../bilder/einsatzdaten/einsatzdaten.png)

2. Den Wert der Zeile wählen (Stift daneben) oder, wenn die Zeile leer ist, „… eintragen“.
3. Den neuen Wert eingeben.
4. Mit Enter oder „Speichern“ übernehmen. Escape oder „Abbrechen“ verwirft die Eingabe. Die App
   meldet „… gespeichert“.

So lassen sich Bezeichnung, Einsatzstichwort, Alarmzeit, Einsatzart, Leitstellen-Nr., Meldende
Stelle, Sachverhalt / Meldebild und Anzahl Betroffene (initial) ändern. Den Termin der nächsten
Lagebesprechung setzt das Kapitel [Lagebesprechung](lagebesprechung.md).
Ein eigenes Formular für alle Angaben gibt es nicht. Den Einsatzort ändert das Paneel „Einsatzort“
(nächster Ablauf); die Kopfleiste zeigt ihn nur an.

### Den Einsatzort suchen und verorten

1. Im Paneel „Einsatzort“ an der Zeile „Adresse“ den Wert wählen oder „Adresse eintragen“.
2. Die Adresse eintippen, etwa „Bahnhofstraße 1, Musterstadt“, und Enter drücken oder „Ort
   suchen“ wählen. Die Suche braucht mindestens drei Zeichen.
3. Aus der Liste „Treffer“ den passenden Ort wählen. Der Text des Treffers steht dann im Feld,
   darunter eine kleine Karte mit einer Nadel und eine Zeile mit Ortsname und Entfernung zum
   nächsten Objekt auf der Lagekarte.

   ![Paneel „Einsatzort“ mit der Adresse im Suchfeld und der Liste der Treffer](../bilder/einsatzdaten/einsatzort.png)

4. Liegt die Nadel nicht genau richtig, sie mit der Maus oder dem Finger an die richtige Stelle
   ziehen; mit der Tastatur verschieben die Pfeiltasten die Nadel, mit Umschalt in großen
   Schritten. Der Text bleibt dabei stehen.
5. „Speichern“ wählen. Adresse und Koordinate werden zusammen gespeichert, der Kartenausschnitt
   zeigt den Ort mit einer Nadel.

Ein Ort ohne Adresse (Waldweg, Autobahn-Kilometer) wird als freier Text eingetragen. Den Punkt
dazu setzt „Auf Karte wählen“: in der großen Karte an die Stelle tippen, die Nadel bei Bedarf
ziehen und „Übernehmen“ wählen. Das geht auch ohne Netz, mit den installierten Offline-Karten.
Wer eine Koordinate kennt, tippt sie gleich ins Adressfeld, in jedem Format, das
„Koordinatenformat“ anbietet; die Zeile „Koordinate“ geht ebenso. „Auf Lagekarte zeigen“ öffnet
die Lagekarte um den Einsatzort.

Bei „Meldende Stelle“ schlägt die App beim Tippen die externen Stellen aus den
[Stammdaten](stammdaten.md) vor, nach Art gruppiert. Ein Vorschlag lässt sich wählen oder ein
anderer Text eintragen.

### Die Koordinate eintragen

1. Im Paneel „Einsatzort“ „Koordinate eintragen“ oder die bisherige Koordinate wählen.
2. Die Koordinate eingeben; daneben unter „Koordinatenformat“ das Format wählen, in dem sie
   vorliegt.
3. „Speichern“ wählen. Ist die Eingabe nicht lesbar, steht unter dem Feld „Ungültige Koordinate
   im Format …“; „Speichern“ übernimmt dann nichts, und die Zeile bleibt offen.

### Die eigene Führungsstelle erfassen

1. In „Einsatzdaten“ zum Paneel „Eigene Führungsstelle“ gehen.

   ![Paneel „Eigene Führungsstelle“ mit Einsatzleiter, Art, Bezeichnung, Standort, Funkangaben und Führungsfahrzeug](../bilder/einsatzdaten/fuehrungsstelle.png)

2. Unter „Art“ „mobil“ oder „ortsfest“ wählen. Die Wahl gilt sofort.
3. „Bezeichnung“ eintragen, etwa „ELW 2 Musterstadt“ oder „TEL Rathaus“.
4. Bei „Standort“ die Adresse und die Koordinate eintragen. „wie Einsatzort“ übernimmt beides
   vom Einsatzort; danach „Speichern“ wählen.
5. „Rufname“, „Sprechgruppen“, „Telefon und weitere Verbindungen“ und „Führungsfahrzeuge“
   Zeile für Zeile eintragen und speichern wie jede andere Angabe. Rufname und Sprechgruppen sind
   der Funk; unter „Telefon und weitere Verbindungen“ fügt „Verbindung hinzufügen“ je Nummer oder
   Adresse eine Zeile mit Mittel und Hinweis an, wie bei Abschnitt und Einheit. Bei
   „ortsfest“ stehen die Führungsfahrzeuge eingeklappt; ein Klick auf die Anzahl öffnet sie.
   Beim „Rufname“ schlägt die Liste die Funkrufnamen der Führungsfahrzeuge vor; Tippen grenzt
   sie ein, ein Eintrag übernimmt den Funkrufnamen unverändert, freier Text bleibt möglich.

### Den Einsatzleiter festlegen oder übergeben

1. Im Paneel „Eigene Führungsstelle“ „Einsatzleiter eintragen“ oder den bisherigen Einsatzleiter
   wählen.
2. Eine Person aus dem disponierten Personal wählen. Für einen Einsatzleiter, der nicht im
   Personal steht, den Namen eintippen und den Vorschlag „… als externen Einsatzleiter
   übernehmen“ wählen.
3. Unter „seit“ die Uhrzeit der Übernahme eintragen. Leer gilt die Zeit des Speicherns.
4. „Speichern“ wählen. „Einsatzleiter leeren“ und dann „Speichern“ nimmt die Angabe zurück.

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
  schreiben keinen Eintrag ins Einsatztagebuch, mit einer Ausnahme: der Einsatzleiter.
- Die „Einsatznummer“ vergibt das System; sie lässt sich nicht ändern. Sie steht im Seitenkopf und
  im Paneel „Einsatz“, ebenso die Leitstellen-Nr., mit der Leitstelle, Rückfragen und
  Einsatzbericht arbeiten.
- Die **eigene Führungsstelle** ist der Ort, an dem die Einsatzleitung arbeitet: mobil in einem
  Führungsfahrzeug oder ortsfest in einem Gebäude. Ihre Bezeichnung erscheint in Funkplan,
  Fernmeldeskizze und Organigramm, ihr Standort auf der Lagekarte und am Punkt „Standort der
  Führungsstelle festgelegt“ der Checkliste Arbeitsaufnahme (siehe
  [Funkplan, Fernmeldeskizze und Kommunikationsplan](funkplan.md)); bearbeitet wird sie nur hier.
  „Führungsfahrzeuge“ bietet nur disponierte Fahrzeuge an und nur, wenn das Modul Fahrzeuge
  freigegeben ist.
- Der **Einsatzleiter** ist die Person, die den Einsatz nach FwDV 100 führt. Die Rolle
  Einsatzleitung im „Zugriff“ ist nur ein Recht und macht niemanden zum Einsatzleiter. Die
  Kopfleiste, die Wurzel des Organigramms, die Zeile der Führungsstelle im Funkplan, die
  Lagebericht-Übernahmen und der Einsatzbericht zeigen alle denselben Einsatzleiter. Ist keiner
  festgelegt, steht dort „nicht erfasst“.
- Jedes Festlegen, Übergeben und Leeren schreibt genau einen Eintrag ins Einsatztagebuch, etwa
  „Übergabe der Einsatzleitung von … an …“, mit der Zeit aus „seit“. Dieselbe Person mit anderer
  Uhrzeit schreibt keinen.
- Eine Person als Einsatzleiter anbieten kann die Zeile nur, wenn das Modul Personal freigegeben
  ist; sonst steht „Personal nicht freigegeben — nur Freitext“. Wird die Person aus dem Einsatz
  entlassen, bleibt ihr Name mit „nicht mehr disponiert“ stehen. Bei der Schwärzung des Einsatzes
  wird der Name gelöscht.
- „wie Einsatzort“ übernimmt Adresse und Koordinate einmal. Wird der Einsatzort danach
  geändert, bleibt der Standort der Führungsstelle, wo er ist.
- Die Adresse gehört ins Feld „Standort“, nicht in die „Bezeichnung“: Beim Löschen der
  personenbezogenen Daten nach Ablauf der Frist werden Adresse und Koordinate der Führungsstelle
  geleert, Art und Bezeichnung bleiben stehen.
- Die Vorschläge für den **Rufname** stehen in Gruppen, in dieser Folge: die Fahrzeuge, die der
  Führungsstelle zugeordnet sind, die übrigen disponierten Führungsfahrzeuge, dann die
  Führungsfahrzeuge der Organisation, die im Dienst und nicht disponiert sind, und zuletzt deren
  Demo-Daten. Als Führungsfahrzeug gilt, was auf der Lagekarte das Zeichen Führung trägt (etwa
  ELW, KdoW). Ohne Freigabe des Moduls Fahrzeuge fehlen die ersten beiden Gruppen, und die
  Organisation nennt dann auch disponierte Fahrzeuge. Enter speichert den getippten Text; einen
  Vorschlag übernimmt Enter erst, wenn er mit den Pfeiltasten angesteuert ist. Trägt die
  Führungsstelle genau ein Fahrzeug, steht dessen Funkrufname grau im leeren Feld; gespeichert
  wird er erst, wenn ihn jemand wählt.

### Adresse und Koordinate des Einsatzorts

- Ein gewählter Treffer speichert Adresse und Koordinate in einem Schritt. Wird danach der Text
  geändert, gilt er als freie Adresse: gespeichert wird nur der Text, die bisherige Koordinate
  bleibt. Unter der Koordinate steht der Ortsname, den die Koordinate ergibt; weicht er von der
  Adresse ab, passen beide nicht zusammen.
- Ein Punkt, der auf der Karte gesetzt wurde (Nadel gezogen, „Auf Karte wählen“), bleibt, auch
  wenn der Text danach geändert wird. Ergibt der Punkt einen anderen Ortsnamen als den Text, bietet
  das Feld „Als Adresse übernehmen“ an; von sich aus überschreibt es den Text nie.
- Eine Koordinate im Adressfeld erkennt die App beim Tippen, ohne Anfrage an den Server. „Ort
  suchen“ bleibt dann gesperrt.
- Die Suche fragt den Geocoder der Organisation (ohne Einstellung den öffentlichen Nominatim)
  und bevorzugt Orte in der Umgebung des bisherigen Einsatzorts. Sie sucht erst auf Enter oder
  „Ort suchen“, nie beim Tippen. Für alle Nutzer zusammen geht höchstens eine Anfrage je Sekunde
  hinaus; ist die Suche gerade belegt, steht „Adresssuche ausgelastet“ am Feld, und „Erneut
  suchen“ versucht es wieder. „Adresssuche nicht erreichbar“ heißt, der Geocoder antwortet
  nicht.
- An den Geocoder gehen nur der Suchtext und ein grober Ausschnitt um den Einsatzort, keine
  weiteren Einsatzdaten.
- Die Suche braucht das Recht, die Einsatzdaten zu ändern, aber kein Recht auf die Lagekarte.
  „Auf Lagekarte zeigen“ steht nur, wenn der Einsatzort eine Koordinate hat und die Lagekarte
  freigegeben ist.
- Der Kartenausschnitt nimmt die Kartengrundlage nach der Vorgabe der Lagekarte: die
  Online-Karte, wenn eine eingerichtet ist (Kacheln kommen über den Kachelspeicher des Servers),
  sonst die installierten Offline-Karten, sonst eine Karte ohne Kacheln mit der Nadel. Ohne
  Koordinate steht dort „Nicht verortet“. Kann der Browser keine Karte zeichnen (Voraussetzung
  wie bei der [Lagekarte](lagekarte.md)), steht dort „Karte auf diesem Gerät nicht darstellbar“;
  Adresse, Koordinate und „Auf Lagekarte zeigen“ bleiben.

### Meldende Stelle und Katalog

Gespeichert wird nur der Text der meldenden Stelle, kein Verweis auf den Katalog. Wird eine
externe Stelle später umbenannt oder deaktiviert, behält der Einsatz den Text von damals. Die
meldende Stelle darf höchstens 200 Zeichen lang sein.

### Ohne Netz

Die Angaben des Einsatzkopfs bleiben ohne Netz lesbar, die eigene Führungsstelle nicht (siehe
[Arbeiten ohne Netz](ohne-netz.md)). Die Adresssuche ist ohne Netz gesperrt („Adresssuche ohne
Netz nicht verfügbar“).

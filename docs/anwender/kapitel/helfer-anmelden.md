---
titel: Helfer anmelden
gruppen: [fuehrung, geraete]
reihenfolge: 765
quellen: [frontend/src/pages/einstellungen/EinsatzHelfer.tsx, frontend/src/pages/einstellungen/helferKern.ts, frontend/src/pages/einstellungen/EinsatzDefaults.tsx, frontend/src/einsatz/HelferWartenBand.tsx, frontend/src/geraet/HelferWeichePage.tsx, frontend/src/pages/lagekarte/GeortetListe.tsx, frontend/src/pages/lagekarte/positionsAlter.ts, frontend/src/auftraege/helferZustellung.ts, src/helfer/, src/ios_push/helfer.rs, src/ortung/, ios/Helfer/, android/helfer/]
---

## Überblick

Mit der App „Lifeline Helfer“ melden Helfende ihre Position an die Einsatzleitung, ohne ein
Konto in Lifeline Hub zu haben, und empfangen Aufträge im laufenden Einsatz. Die Einsatzleitung **lädt ein**, die Helfenden scannen den
QR-Code, wählen Einheit oder Fahrzeug und warten, bis die Einsatzleitung sie **bestätigt**. Danach
steht die Position auf der Lagekarte, mit Quelle und Alter, und Aufträge an ihre Einheit, ihr
Fahrzeug oder ihre Person erreichen die App als Mitteilung.

Das Kapitel richtet sich an die Einsatzleitung (Einladen und Bestätigen) und an die Helfenden
(Installieren und Anmelden). Die Ortung muss die Organisation vorher in der Verwaltung einschalten
(siehe Hintergrund). Die Gerätekopplung für Tablets und Monitore ist ein anderer Weg
([Geräte koppeln](geraete-koppeln.md)).

## Abläufe

### Helfer einladen und Blatt drucken

Für die Einsatzleitung:

1. In den Einstellungen des Einsatzes „Geräte“ öffnen und im Bereich „Helfer“ „Helfer einladen“
   wählen. Ist der Knopf gesperrt, nennt der Bereich den Grund: die Ortung der Organisation ist
   ausgeschaltet.
2. Die „Gültigkeit“ wählen (Vorgabe 4 Stunden, bis zu 72 Stunden) und „Einladen“ wählen. Eine neue
   Einladung ersetzt die alte; bereits angemeldete Helfer bleiben.
3. Der Dialog „Helfer anmelden“ zeigt QR-Code, Code in Gruppen und die Adresse. Mit dem Druckknopf
   entsteht das Blatt „Helfer anmelden“ mit denselben Angaben und drei Schritten für die Helfenden.
4. „Fertig“ wählen. Der Code steht nur in diesem Dialog; danach zeigt der Bereich nur noch
   „Einladung gültig bis …“.

Eine gültige Einladung lässt sich mit „Einladung widerrufen“ zurückziehen. Sie gilt für beliebig
viele Helfende.

### Helfer bestätigen oder ablehnen

Für die Einsatzleitung:

1. Wartende Helfer erscheinen unter „Wartende Helfer“ und als Band „1 Helfer wartet auf
   Bestätigung“ unter der Kopfleiste. Ein Klick auf das Band führt zum Bereich „Helfer“.
2. Beim Helfer „Bestätigen …“ wählen. Das „Ziel“ (Einheit oder Fahrzeug) ist mit der Wahl des
   Helfers vorbelegt und lässt sich ändern.
3. Das Häkchen „Ortungsgerät“ lassen oder abwählen: Nur das Ortungsgerät eines Ziels meldet dessen
   Position. Hat das Ziel schon eines, steht dort „ersetzt das bisherige Ortungsgerät des Ziels“.
4. Hat die Organisation die Personenortung freigegeben, unter „Person“ eine Kraft des Einsatzes
   zuordnen oder „Ohne Person“ lassen. Wünscht der Helfer es, steht dort „Die Kraft möchte als
   Person geortet werden.“
5. „Bestätigen“ wählen. Meldet die Maske, das Ziel habe schon ein Ortungsgerät, „Ersetzen“ oder
   „Nur Person orten“ wählen.
6. Statt zu bestätigen „Ablehnen“ wählen: der Helfer ist abgelehnt und verliert die Anmeldung.

### Helfer ändern, verlängern und entfernen

Für die Einsatzleitung:

1. Beim angemeldeten Helfer das Aktionsmenü öffnen. Es bietet „Ändern …“ (Ziel, Ortungsgerät,
   Person), „Verlängern …“ und „Entfernen …“.
2. „Verlängern …“: unter „Neues Ende“ den Zeitpunkt eintragen und „Verlängern“ wählen.
3. „Entfernen …“: die Rückfrage mit „Entfernen“ bestätigen. Das Gerät meldet sich sofort ab; eine
   geortete Person verliert ihre Position.
4. Sollen alle gehen, „Alle Helfer abmelden …“ wählen und mit „Alle abmelden“ bestätigen. Die
   Einladung bleibt.

Die Liste zeigt je Helfer das Ziel, ob er Ortungsgerät ist, die zugeordnete Person, „pausiert“
oder das Alter der Position („Position vor 3 min“) und das Ende der Anmeldung („bis …“).

### Positionen auf der Lagekarte lesen

1. Die Lagekarte des Einsatzes öffnen.
2. Über der Objektliste steht die Liste „Geortet“: je Ziel mit automatischer Position Name, Quelle
   und Alter, etwa „Helfer-App · vor 6 min“.
3. Ein Klick auf einen Eintrag springt zum Marker. Ist die Position älter als fünf Minuten, steht
   „veraltet“ dabei, und der Marker ist blass gezeichnet.

Handpositionen der Einsatzleitung tragen keine Quelle und stehen nicht in dieser Liste.

### Als Helfer anmelden

Für Helfende:

1. Die App „Lifeline Helfer“ installieren: auf dem iPhone über TestFlight (Einladung der
   Organisation), unter Android als APK von der Releaseseite der Organisation.
2. Den QR-Code der Einsatzleitung mit der Kamera des Geräts scannen; die Seite im Browser bietet
   „In Lifeline Helfer öffnen“ an. Wer scannt, gelangt zum Code; alternativ in der App „Code
   eingeben“ wählen und Server und Code eintragen.
3. Auf dem Bildschirm „Anmelden“ den „Anzeigename“ eingeben und die Einheit oder das Fahrzeug
   wählen. Wo die Organisation es erlaubt, steht „Mich als Person orten“ zur Wahl.
4. Den Satz zur Ortung lesen und „Anmelden und Ortung erlauben“ wählen. Den Standortzugriff
   „Beim Verwenden der App“ erlauben.
5. Warten, bis die Einsatzleitung bestätigt („Wartet auf Bestätigung“). Danach läuft die Ortung,
   auch bei gesperrtem Bildschirm.
6. Mit „Pausieren“ endet das Senden vorübergehend, mit „Fortsetzen“ geht es in der geöffneten App
   weiter. „Abmelden“ beendet die Ortung; für eine neue Anmeldung ist wieder ein Code nötig.

### Aufträge an Helfer geben

Für die Einsatzleitung:

1. Einen Auftrag wie gewohnt erteilen und als Empfänger die Einheit, das Fahrzeug oder die Person
   wählen, an die der Helfer gebunden ist (siehe [Aufträge und Befehle](auftraege-befehle.md)).
2. Im Auftrag steht an der Empfängerzeile „an 2 Helfer-Apps gesendet“: so viele bestätigte Helfer
   haben den Auftrag bekommen.
3. Übernimmt ein Helfer den Auftrag, steht dort „quittiert von Max M. (Helfer-App)“, und die
   Empfängerzeile gilt als quittiert.
4. Bleibt die Quittung aus, über Funk nachfassen.

### Aufträge empfangen und übernehmen

Für Helfende:

1. Ein neuer Auftrag kommt als Mitteilung mit Ton, auch bei gesperrtem Bildschirm. Unter Android
   steht auf dem Sperrbildschirm nur „Neuer Auftrag“.
2. Die Mitteilung antippen. Der Auftrag öffnet sich mit Text, Ort, Priorität, Frist und Empfänger.
3. „Übernommen“ wählen. Danach steht dort „Übernommen um …“. War jemand derselben Einheit
   schneller, steht „Übernommen von …“.
4. Alle Aufträge stehen in der App im Bereich „Aufträge“. Ein aufgehobener Auftrag ist
   durchgestrichen und trägt „aufgehoben“.
5. Scheitert „Übernommen“, steht „Bitte über Funk bestätigen“ da: dann die Übernahme über Funk
   melden.

## Hintergrund

### Wer das darf und was vorher nötig ist

Einladen, Bestätigen, Ändern und Entfernen darf die Einsatzleitung eines laufenden Einsatzes. Der
Bereich „Helfer“ und das Band mit den wartenden Helfern sind nur für sie da; die Liste und das
Ereignis „helfer“ gehen nur an die Einsatzleitung.

Die Organisation schaltet die Ortung in der Verwaltung unter „Einsatz-Vorgaben“, Bereich „Ortung“
ein („Ortung im Einsatz“). Beim Einschalten bestätigt sie, dass eine Einwilligung der Helfenden
bzw. eine Betriebsvereinbarung vorliegt; der Server hält fest, wer es wann bestätigt hat. „Auch
Personen orten“ ist ein zweiter, eigener Schalter. Ohne „Ortung im Einsatz“ ist „Helfer einladen“
gesperrt. Eine Vorlage für die Datenschutz-Folgenabschätzung liegt im Repository unter
`docs/datenschutz/dsfa-vorlage-ortung.md`.

### Fristen

- Eine **Einladung** gilt standardmäßig 4 Stunden, höchstens 72 Stunden.
- Eine Anmeldung, die niemand bestätigt, verfällt nach **2 Stunden**.
- Eine bestätigte Kopplung gilt bis zum Einsatzende, höchstens **72 Stunden** ab der Bestätigung;
  30 Minuten vor dem Ablauf warnt die App.
- Die App sendet höchstens alle 30 Sekunden und nur nach über 25 Metern Bewegung, im Stand alle
  5 Minuten ein Lebenszeichen. Ab 5 Minuten Alter gilt eine Position als „veraltet“.

### Was gespeichert wird

Gespeichert wird nur die **letzte** Position, auf dem Server und im Speicher des Geräts; einen
Verlauf gibt es nicht. Beim Pausieren, Abmelden, Entfernen und mit dem Ende der Kopplung löscht
der Server die Position der Person. Die Position an Einheit oder Fahrzeug bleibt als Lagestand
stehen, bis eine neuere oder eine Handposition sie ersetzt. Anmelden, Bestätigen und Beenden
stehen im Einsatztagebuch.

### Ein Ortungsgerät je Ziel

Je Einheit oder Fahrzeug meldet nur ein Gerät die Position. Ein zweites Gerät am selben Ziel wird
nur Ortungsgerät, wenn die Einsatzleitung das bisherige ersetzt; sonst ortet es höchstens die
Person.

### Ohne Netz und Grenzen

Ohne Netz hält die App nur die letzte Position und sendet sie nach der Rückkehr, wenn sie jünger
als 10 Minuten ist; ältere verwirft sie. Wird die App beendet oder das Gerät neu gestartet, endet
die Ortung und beginnt erst wieder, wenn die Person sie in der App startet. Die Ortung läuft nur,
solange eine Kopplung besteht, und ist für die Person sichtbar: unter iOS durch die
Standortanzeige und die Live-Aktivität, unter Android durch die Benachrichtigung des Dienstes.
Die App ortet nur bei erlaubtem Standort „Beim Verwenden der App“, nie dauerhaft im Hintergrund
ohne diese Anzeige.

### Aufträge an die Helfer-App

- **Wer empfängt:** jeder bestätigte Helfer, dessen Einheit oder Fahrzeug Empfänger ist, und der
  Helfer, dem die Einsatzleitung die Person zugeordnet hat. Ein pausierter Helfer empfängt
  ebenfalls. Vor der Bestätigung, nach dem Ende der Anmeldung und nach dem Einsatzende kommt
  nichts mehr an. Aufträge an Abschnitte, Funktionen und externe Stellen gehen nicht an Helfer.
- **Quittung:** „Übernommen“ ist die Quittung der Empfängerzeile, wie die Quittung in Lifeline
  Hub. Die erste zählt; der Ersteller des Auftrags erfährt sie wie gewohnt.
- **Zustellung:** Unter iOS kommt der Auftrag als Mitteilung über den Apple-Dienst, auch bei
  beendeter App; der Inhalt ist verschlüsselt und nur auf dem Gerät lesbar. Unter Android hält die
  App die Verbindung zum Server, solange die Anmeldung gilt; die Benachrichtigung „empfängt
  Aufträge“ zeigt das. Beendet Android die App, kommt nichts an.
- **Mitteilungen aus:** Wer Mitteilungen ablehnt, sieht in der App „Mitteilungen aus — du bekommst
  Aufträge nur bei offener App“.
- **Ohne Netz:** Es gibt keine Warteschlange. Ein Auftrag, der nicht ankommt, bleibt ohne Quittung;
  die Einsatzleitung sieht das am Auftrag und greift zum Funk.
- Die App legt Aufträge nicht in Dateien ab.

## Grundlagen und Quellen

- Architekturentscheidung zur Ortung der Helfer-App: ADR-0101 (`docs/architektur/entscheidungen/`).
- Architekturentscheidung zu Aufträgen an die Helfer-App: ADR-0106.
- Datenschutz: `docs/datenschutz/dsfa-vorlage-ortung.md`.

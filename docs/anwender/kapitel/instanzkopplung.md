---
titel: Instanzkopplung
gruppen: [alle, administration]
reihenfolge: 690
quellen: [frontend/src/instanz/InstanzkopplungSeite.tsx, frontend/src/einsatz/spiegel/, frontend/src/instanz/instanzText.ts, frontend/src/instanz/herkunft.tsx, frontend/src/api/instanz.ts, src/routes/instanz.rs, src/instanz/mod.rs, src/instanz/melden.rs, src/instanz/repo.rs, src/instanz/stammdaten/, src/instanz/spiegel/, src/error.rs, src/auth/unterschrift/repo.rs, src/routes/auth.rs, frontend/src/instanz/FuehrungPaneel.tsx, frontend/src/instanz/FuehrungHinweisband.tsx, frontend/src/instanz/EinsaetzeBeimGegenueber.tsx, frontend/src/api/fuehrung.ts, src/instanz/fuehrung/, src/routes/fuehrung.rs]
---

## Überblick

Zwei Lifeline-Hub-Installationen lassen sich **koppeln**, etwa der Server im
Einsatzleitwagen und ein öffentlich erreichbarer Server der Organisation. Die Kopplung legt
fest, dass beide einander vertrauen. Über sie kommen die **Stammdaten** der Organisation vom
Hub zum ELW: Konten, Fahrzeuge, Personal, Material, Qualifikationen, Fahrzeug- und
Personal-Status, Einheitstypen, Einheiten-Vorlagen, Führungsfunktionen und Org-Einstellungen.

Auch die **Einsätze** der Organisation gehen über die Kopplung: Ein Einsatz, der an einer
Installation angelegt wurde, erscheint an der anderen als **Spiegel**. Der Spiegel ist lesbar wie
ein eigener Einsatz, mit Seiten, Druck und Suche. Geändert wird er nur dort, wo er angelegt
wurde. Am Spiegel wird nicht geschrieben, sondern **beantragt**. Ist die **Führung je Einsatz**
eingeschaltet, einigen sich beide je Einsatz darauf, welche Installation ihn schreibt.

Die Seite „Instanzkopplung“ in der Verwaltung unter „Einstellungen“ zeigt diese Installation
mit ihrem **Fingerabdruck**, die gekoppelten Installationen und die **Unterschriftsschlüssel**
der Organisation. Bedienen darf sie der System-Admin; wer die Verwaltung sieht, liest mit. Einen
Spiegel liest jedes Mitglied des Einsatzes; Anträge stellt, wer im Einsatz Schreibrecht hat.

## Abläufe

### Unterschriftsschlüssel registrieren

Für den System-Admin. Ohne eigenen Unterschriftsschlüssel lässt sich kein Kopplungscode
ausstellen.

1. Unter „Einstellungen“ „Instanzkopplung“ wählen.
2. Im Paneel „Unterschriftsschlüssel“ „Eigenen registrieren“ wählen, eine „Bezeichnung“
   eintragen, etwa „Sicherheitsschlüssel blau“, und „Registrieren“ wählen.
3. Den Passkey im Browser bestätigen. Der Schlüssel steht danach in der Liste.

Hat die Organisation schon eine Kopplung, steht ein neuer Schlüssel auf „wartet auf
Gegenzeichnung“. Ein Admin mit eigenem gültigem Schlüssel, auch derselbe Admin mit seinem ersten
Schlüssel, wählt im Menü der Zeile „Gegenzeichnen“ und bestätigt mit seinem Passkey.

### Code ausstellen

Für den System-Admin der Installation, bei der sich die andere meldet (etwa der öffentliche
Server):

1. Unter „Einstellungen“, „Instanzkopplung“ „Code ausstellen“ wählen.
2. Der Dialog zeigt den Code in vier Vierergruppen, die Adresse dieser Installation und ihren
   Fingerabdruck. Code und Adresse an den Admin der anderen Installation weitergeben.
3. „Fertig“ wählen. Der Code gilt 15 Minuten und lässt sich genau einmal einlösen.

### Code einlösen

Für den System-Admin der anderen Installation (etwa im Einsatzleitwagen):

1. Unter „Einstellungen“, „Instanzkopplung“ „Code einlösen“ wählen.
2. „Adresse der anderen Instanz“ und „Kopplungscode“ eintragen und „Koppeln“ wählen.
3. Die neue Zeile unter „Gekoppelte Instanzen“ nennt den Fingerabdruck der anderen
   Installation. Er muss mit dem übereinstimmen, den deren Dialog gezeigt hat.

### Nachgelieferten Unterschriftsschlüssel bestätigen

Für den System-Admin der Installation, die sich meldet (etwa im Einsatzleitwagen), wenn an der
Kopplung „neuer Unterschriftsschlüssel wartet auf Bestätigung“ steht:

1. Im Paneel „Unterschriftsschlüssel“ im Menü des wartenden Schlüssels „Bestätigen …“ wählen.
2. Den Inhaber anrufen und nach den letzten vier Zeichen seines Fingerabdrucks fragen. Der
   Inhaber nennt sie, nicht umgekehrt.
3. Die vier Zeichen unter „Letzte vier Zeichen des Fingerabdrucks“ eintragen und „Bestätigen“
   wählen. Passen sie nicht, nennt der Dialog den Grund, und der Schlüssel wartet weiter.

Kennt der Inhaber den Schlüssel nicht, im Menü „Zurückweisen …“ wählen und die Rückfrage
bestätigen.

### Kopplung widerrufen

Für den System-Admin:

1. Unter „Gekoppelte Instanzen“ im Menü der Zeile „Widerrufen …“ wählen.
2. Die Rückfrage mit „Widerrufen“ bestätigen.

### ELW als verloren melden

Für den System-Admin am Hub, wenn ein Einsatzleitwagen gestohlen wurde oder sein Rechner
verloren ist:

1. Unter „Gekoppelte Instanzen“ im Menü der Zeile des ELW „ELW verloren …“ wählen.
2. Die Rückfrage nennt, wie viele Konten betroffen sind. Mit „Als verloren melden“ bestätigen.
3. Die Kopplung ist widerrufen. Die Konten, deren Passwort auf dem ELW lag, haben kein gültiges
   Passwort und keinen zweiten Faktor mehr, ihre Sitzungen sind beendet. Für jede Person in der
   Benutzerverwaltung ein Einmalpasswort vergeben, sofern sie keinen Passkey hat.

Das geht auch, wenn die Kopplung schon vorher widerrufen wurde: Die Passwörter, die dorthin
gingen, liegen dann noch auf dem ELW. Ist der ELW einmal als verloren gemeldet, fehlt der Eintrag
im Menü.

### Stammdaten erneut abgleichen

Für den System-Admin am ELW, nachdem ein Hinweis an der Kopplung gelöst ist (etwa ein lokales
Konto umbenannt wurde, dessen Name der Hub auch vergibt):

1. Unter „Gekoppelte Instanzen“ im Menü der Zeile des Hubs „Stammdaten erneut abgleichen“
   wählen.
2. Die Instanz holt alle Stammdaten neu und gleicht sie ab; die Hinweise beginnen von vorn.

### Am Spiegel erfassen

Am Spiegel lassen sich nur die Erfassungen machen, die auch ohne Netz vormerkbar sind (Liste
unter „Was am Spiegel geht“).

1. Den Spiegel öffnen. Oben steht das Hinweisband „Spiegel von …“ mit dem Namen der anderen
   Installation.
2. Die Erfassung ausfüllen und speichern wie an einem eigenen Einsatz, etwa einen Eintrag im
   Einsatztagebuch.
3. Der Eintrag erscheint an derselben Stelle wie vorgemerkte Einträge, als „beantragt“: ohne
   laufende Nummer und nicht in den Zählern. Das Hinweisband zählt ihn als ausstehenden Antrag.
4. Hat die andere Installation den Antrag übernommen, kommt der Eintrag mit dem nächsten
   Abgleich als gewöhnlicher Eintrag zurück, und der Antrag verschwindet.

### Abgelehnten Antrag neu erfassen oder verwerfen

1. Im Hinweisband „Spiegel von …“ die Anträge aufklappen. Abgelehnte Anträge stehen mit dem
   Grund da.
2. „Neu erfassen“ wählen. Bei einem Eintrag im Einsatztagebuch liegen die erfassten Daten dann
   als Entwurf in der Erfassung; bei den übrigen Erfassungen öffnet sich die Seite, auf der sie
   erfasst werden, und das Hinweisband zeigt die Daten. Berichtigen und erneut speichern: daraus
   wird ein neuer Antrag.
3. Oder „Verwerfen“ wählen. Der abgelehnte Antrag ist dann weg.

### Abgleich der Einsätze prüfen

Für den System-Admin:

1. Unter „Einstellungen“ „Instanzkopplung“ wählen.
2. Unter „Gekoppelte Instanzen“ zeigt der Abschnitt „Einsätze“ je Kopplung die Einsätze, die
   diese Installation liefert, und die, die sie spiegelt, je mit Stand, letztem Abgleich und
   Hinweisen.

### Führung eines Einsatzes übergeben

Nur mit eingeschalteter Führung je Einsatz. Für die Einsatzleitung oder einen Admin der
Organisation, an der Installation, die den Einsatz führt.

1. Am Einsatz „Einsatzdaten“ öffnen; das Paneel „Führung“ steht vor „Einsatzabschluss“.
2. „Führung an … übergeben“ wählen und die Rückfrage mit „Führung übergeben“ bestätigen.

Ohne Verbindung zum Hub gibt die Installation, die sich meldet, die Führung per Code ab:
„Führung per Code abgeben“, Rückfrage mit „Code erzeugen“ bestätigen und den Code, der nur
einmal erscheint, per Funk oder Telefon durchgeben.

### Führung anfragen

Für einen Admin der Organisation, an der Installation, die sich meldet, etwa am ELW bei Ankunft.

1. Unter „Einstellungen“ „Instanzkopplung“ wählen.
2. Im Paneel „Einsätze beim Gegenüber“ am Einsatz „Führung …“ wählen.
3. „Führung anfragen“ wählen. Mit der nächsten Meldung führt diese Installation.

### Notübernahme

Für einen Admin der Organisation, wenn die führende Installation nicht erreichbar ist. Liegt
der Einsatz hier, steht der Knopf im Paneel „Führung“ auf „Einsatzdaten“, sonst unter
„Einsätze beim Gegenüber“.

1. „Notübernahme …“ wählen.
2. Einen „Grund“ eintragen, etwa „ELW ohne Verbindung seit 40 min“.
3. Führt eine Installation, die sich hier meldet (der ELW), unter „Beweis“ „Eigene
   Unterschrift“ wählen und mit dem Unterschriftsschlüssel bestätigen, oder „Code des
   Gegenübers“ wählen und den durchgegebenen Code eintragen.
4. „Führung übernehmen“ wählen.

### Übernahme bestätigen oder widersprechen

Für die Einsatzleitung oder einen Admin der Organisation, an der Installation, die sich meldet.

1. Unter der Kopfleiste des Einsatzes steht „Führung übernommen von …“ mit Zeit, Unterzeichner
   und Grund.
2. „Übernahme bestätigen“ wählen, dann ist der Einsatz hier nur noch zu lesen; oder
   „Widersprechen“ wählen, dann führt diese Installation weiter.

## Hintergrund

### Wer sich bei wem meldet

Die Installation, die den Code eingelöst hat, meldet sich jede Minute bei der anderen; die
Zeile zeigt „diese Instanz meldet sich dort“ bzw. „meldet sich hier“ und wann die andere
zuletzt gesehen wurde. Die angerufene Installation baut nie selbst eine Verbindung auf. Ist die
andere nicht erreichbar, steht der Grund unter „Letzte Meldung“, und die Abstände wachsen bis
zehn Minuten. Eine Kopplung, deren erste Meldung 15 Minuten ausbleibt, verfällt.

### Organisationen

Ein Code koppelt genau die Organisation des ausstellenden Admins mit der des einlösenden.
Weitere Organisationen kommen mit eigenem Code dazu; zwischen zwei Installationen gibt es eine
Kopplung. Jede Organisation sieht und widerruft nur ihre eigene Zuordnung.

### Widerruf

Der Widerruf wirkt hier sofort. Die andere Installation erfährt ihn, sobald eine Meldung
durchgeht, und zeigt „vom Gegenüber widerrufen“. Ein neuer Code koppelt wieder.

Widerruft die Installation, die sich meldet, ohne Netz, steht an der Kopplung „Widerruf noch nicht
beim Gegenüber, wird nachgereicht“. Sie versucht es weiter und schickt dabei nur noch den
Widerruf. Sobald die andere Installation ihn bestätigt hat, verschwindet der Hinweis, und die
Meldungen hören auf. Bleibt die andere Installation dauerhaft unerreichbar, sollte ihr Admin
die Kopplung dort selbst widerrufen.

### Fingerabdruck und Sicherheit

Jede Installation hat ein eigenes Schlüsselpaar; der Fingerabdruck ist eine Kurzform davon. Alle
Nachrichten zwischen gekoppelten Installationen sind damit signiert. Der Code selbst geht nie
über die Leitung; wer sich zwischen beide Installationen schaltet, fällt beim Einlösen auf, und
das Koppeln scheitert.

### Unterschriftsschlüssel

Ein Unterschriftsschlüssel ist ein Passkey nur zum Unterschreiben, nicht zur Anmeldung.
Gekoppelte Installationen bekommen die Schlüssel der Organisation und nehmen einen neuen nur an,
wenn ein ihnen bekannter ihn gegengezeichnet hat; sonst steht an der Kopplung ein Hinweis
„abgelehnt“. Zwei Schlüssel je Organisation, damit einer verloren gehen darf.

Die Schlüssel, die beim Koppeln mitkommen, gelten sofort. Ein Schlüssel, der später nachkommt,
wartet zuerst: an der Kopplung steht „1 neuer Unterschriftsschlüssel wartet auf Bestätigung“,
der Schlüssel selbst „wartet auf Bestätigung“. Bis ein Admin hier ihn bestätigt, zählt seine
Unterschrift nicht. So kann eine kompromittierte andere Installation keinen fremden Schlüssel
unterschieben, ohne dass hier jemand nachfragt. Hat jemand einen neuen Schlüssel mit einem
gegengezeichnet, der hier selbst noch wartet, erscheint der neue erst, wenn der erste bestätigt ist.

Der Dialog zum Bestätigen zeigt Inhaber, Fingerabdruck, wer gegengezeichnet hat und wann. Der
Inhaber liest seinen Fingerabdruck an seinem eigenen Schlüssel ab. Hat er gerade selbst keinen
Schlüssel registriert, ist der wartende nicht seiner. Ein zurückgewiesener Schlüssel wird hier
nie gültig, auch wenn die andere Installation ihn erneut liefert. Einen eigenen
Unterschriftsschlüssel braucht man zum Bestätigen nicht.

Der letzte gültige Schlüssel einer gekoppelten Organisation lässt sich nicht einzeln widerrufen.
Wird ein Admin-Konto deaktiviert oder herabgestuft, sind seine Schlüssel trotzdem widerrufen,
auch der letzte: die Benutzerverwaltung fragt dann vorher nach und nennt die Kopplungen. Danach
steht an der Kopplung „Kein gültiger Unterschriftsschlüssel mehr: Kopplung widerrufen und neu
koppeln“. Der Weg: die Kopplung widerrufen, einen neuen Unterschriftsschlüssel registrieren
(ohne Kopplung gilt er sofort), einen neuen Code ausstellen und an der anderen Installation
einlösen.

### Stammdaten vom Hub

Bezieht die Organisation ihre Stammdaten aus einer Kopplung, trägt jede Zeile in den
Stammdaten (Fahrzeuge, Material, Personal, Qualifikationen, Status-Kataloge, Einheitstypen,
Einheiten- und Einsatz-Vorlagen, Schichtmodelle, Stichworte, Verpflegungsplan, Sprechgruppen,
ETB-Bausteine, Externe Stellen, Führungsfunktionen) und in der Benutzerverwaltung „vom Hub“ oder
„nur hier“. Bei den Unterkunft-Richtwerten gilt das je Richtwert: einen, den der Hub nicht
setzt, kann der ELW für sich setzen. Von den Sprechgruppen kommt nur der Katalog der
Organisation; die Sprechgruppen eines Einsatzes bleiben in ihrem Einsatz. Was vom Hub kommt, ist am ELW nur lesbar und zeigt „Wird am Hub gepflegt“. Ebenso
die Anzeige- und Einsatz-Vorgaben der Organisation. Was am ELW angelegt wird, etwa ein
geliehenes Fahrzeug oder ein Spontanhelfer, gilt sofort, trägt „nur hier“ und erscheint nicht
am Hub. Änderungen am Hub kommen mit der nächsten Meldung, also binnen einer Minute.

Beim ersten Abgleich führt der ELW Gleiches zusammen: ein Fahrzeug mit demselben Funkrufnamen,
Personal mit derselben Personalnummer, Material mit derselben Bestandsnummer, Kataloge und
Vorlagen mit demselben Namen, Sprechgruppen mit derselben Betriebsart und Bezeichnung. Die Daten
des Hubs gelten danach, Einsätze zeigen weiter auf dieselbe Zeile. Gibt der Hub ein Schichtmodell
als Vorgabe vor oder eine Leitstelle als zuständig, gilt das auch am ELW; eine eigene Vorgabe
oder zuständige Leitstelle des ELW verliert diese Markierung und bleibt sonst erhalten. Konten werden nie zusammengeführt: Ist ein Benutzername am ELW schon vergeben,
kommt das Konto vom Hub nicht an, und an der Kopplung steht „Konto „…“ ist hier schon
vergeben.“ Löscht der Hub eine Zeile, die am ELW noch verwendet wird, wird sie dort außer
Dienst genommen oder deaktiviert statt gelöscht. Schichtmodelle, Einsatz-Vorlagen,
Stichwort-Vorschläge und Unterkunft-Richtwerte kennen das nicht: Zeigt eine eigene Einsatz-Vorlage
des ELW auf ein am Hub gelöschtes Schichtmodell, bleibt es stehen, gehört dem ELW und ist dort
bearbeitbar. Was der Hub im selben Zug selbst nicht mehr verwendet, etwa ein Schichtmodell, das er
erst aus seinen Vorlagen nimmt und dann löscht, löscht auch der ELW. Nach dem Widerruf gehören
alle Zeilen dem ELW und sind wieder bearbeitbar.

Eine Organisation bezieht Stammdaten aus genau einer Kopplung; eine weitere zeigt „Stammdaten
dieser Org kommen schon aus einer anderen Kopplung.“

### Anmeldung am ELW ohne Netz

Mit dem Konto kommen Passwort und zweiter Faktor (TOTP) vom Hub: Am ELW gilt dasselbe Passwort,
auch ohne Netz. Muss das Passwort am Hub erst geändert werden, gilt das am ELW genauso. Passkeys
gelten nur an der Installation, an der sie eingerichtet wurden; am ELW richtet man sie dort
ein. Wer sich nur über die Anmeldung der Organisation (SSO) anmeldet, bekommt ohne Netz ein
Einmalpasswort vom Admin am ELW. Ein Einmalpasswort am ELW bleibt, bis das Passwort am Hub
geändert wird.

Passwort und zweiter Faktor gehen nur verschlüsselt und nur an einen ELW, dessen Betreiber die
Verschlüsselung des Datenträgers bestätigt hat (`--datentraeger-verschluesselung-extern`).
Fehlt die Bestätigung, steht am ELW „Geheimnisse nicht verteilt: Datenträgerverschlüsselung
nicht bestätigt“, und Konten vom Hub brauchen dort ein Einmalpasswort.

### Admins am Hub

Ein System-Admin mit Passkey meldet sich am Hub, der die Organisation an einen ELW verteilt, nur
noch per Passkey an; per Passwort erscheint „Admins melden sich hier per Passkey an.“ Am ELW
gilt sein Passwort weiter. Ohne Passkey bleibt ihm am Hub das Passwort, sein Konto kommt dann
aber ohne Passwort am ELW an, und die Benutzerverwaltung zeigt „Für die Anmeldung am ELW zuerst
einen Passkey einrichten“. Das gilt weiter, wenn die Kopplung später widerrufen wird, denn das
Passwort liegt dann noch auf dem ELW.

Verliert ein Admin seinen einzigen Passkey, vergibt ein anderer Admin ein Einmalpasswort. Dabei
fallen seine Passkeys weg, und das Zugangsprotokoll zeigt „1 Passkey entfernt“. Nach der Anmeldung
legt er ein eigenes Passwort fest und richtet einen neuen Passkey ein. Gibt es keinen anderen
Admin, hilft der Betrieb des Servers mit einem Notfallbefehl.

Ein Admin vom Hub ist am ELW Admin, solange der ELW nur seine Organisation trägt. Trägt der ELW
mehrere Organisationen, kommt das Konto dort ohne Admin-Rolle an, und die Kopplung zeigt
„Konto „…“ ist am Hub Admin, hier nicht: diese Instanz trägt mehrere Organisationen.“

### Spiegel

Wer einen Einsatz anlegt, führt ihn: Die Installation, an der er angelegt wurde, liefert ihn an
die gekoppelten Installationen ihrer Organisation. Das gilt in beide Richtungen, für Einsätze des
ELW am Hub wie für Einsätze des Hubs am ELW. Demo-Einsätze werden nicht gespiegelt. Ein
abgeschlossener Einsatz wird noch so lange geliefert, bis die andere Seite den Abschluss hat.

Am Spiegel gelten dieselben Mitgliedschaften und Rollen wie dort, wo er geführt wird. Ein Konto,
das es über die Stammdaten an beiden Installationen gibt, hat am Spiegel dieselbe Rolle. Ein
Konto, das es nur an der anderen Installation gibt, erscheint am Spiegel mit seinem Namen, etwa
als Verfasser im Einsatztagebuch. Anmelden kann sich mit ihm niemand, und es steht in keiner
Benutzerverwaltung. Fahrzeuge oder Personal, die es nur an der anderen Installation gibt, stehen
am Spiegel mit ihrem Namen, aber ohne Verweis auf die eigenen Stammdaten.

Sprechgruppen aus dem Katalog der Organisation stehen am Spiegel mit allen Zuordnungen, im
Funkplan wie in der Fernmeldeskizze. Kennt der eigene Katalog die Sprechgruppe, zeigt der Spiegel
auf sie, ebenso auf eine gleichnamige Sprechgruppe des Spiegels; diese bleibt dabei unverändert.
Sonst legt der Spiegel eine Kopie als Sprechgruppe des Einsatzes an. Nur diese Kopie folgt den
Änderungen dort, wo der Einsatz geführt wird.

Einsatznummern vergibt jede Installation selbst. Ein Spiegel trägt die Nummer der Installation,
die ihn führt; am Hub kann deshalb ein eigener Einsatz dieselbe Nummer tragen wie ein Spiegel.

Benachrichtigungen werden nicht gespiegelt. Jede Installation führt ihre eigenen; „gelesen“ und
das Quittieren gelten nur dort.

### Hinweisband und Abgleich

Jede Seite eines Spiegels zeigt das Hinweisband „Spiegel von …“ mit der Zeit des letzten
Abgleichs und der Zahl der ausstehenden und abgelehnten Anträge. Liegt bei einem laufenden
Einsatz der letzte Abgleich länger als eine Minute zurück, steht dort „keine Verbindung seit …“.

Abgeglichen wird alle fünf Sekunden, solange an der Kopplung ein Einsatz aktiv ist, ein Antrag
offen ist oder ein Anhang geholt wird; sonst im Takt der Meldung. Den kurzen
Takt stellt der Betrieb der Installation ein, die sich meldet (`--instanz-spiegel-sekunden`, 2 bis
600 s). Scheitert ein Abgleich, wachsen die Abstände bis zehn Minuten. Nach einer Pause kommt nur
der letzte Stand jeder Zeile, nicht jede Zwischenfassung. Bringt ein Abgleich etwas Neues, laden
offene Seiten des Spiegels neu.

### Was am Spiegel geht

Jede Bedienung, die etwas ändert, ist am Spiegel gesperrt wie für Beobachter. Ein direkter
Aufruf endet mit „Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die führende
Instanz.“

Ausgenommen sind die 16 Erfassungen, die auch ohne Netz vormerkbar sind. Sie werden zum Antrag:

- Eintrag im Einsatztagebuch und Meldung;
- Person anlegen, Sichtung, Verbleib, Notiz, Transport, Anlass, Maßnahme und Verletzung an einer
  Person;
- Standmeldung eines Bezirks, Belegungsmeldung, Registrierung und Abmeldung an einer
  Betreuungsstelle;
- Eintreffen an einem Bereitstellungsraum und Ausgabe in der Verpflegung.

Anträge darf stellen, wer im Einsatz eine Rolle mit Schreibrecht hat, solange der Einsatz läuft.
Anhänge lassen sich an einem Antrag nicht mitschicken. Eine Maßnahme aufheben geht am Spiegel
nicht, weil das auch ohne Netz nicht vormerkbar ist.

### Anträge

Ein Antrag steht „ausstehend“, bis die Installation, die den Einsatz führt, ihn übernommen oder
abgelehnt hat. Ohne Verbindung wartet er, ohne Frist, und geht mit dem ersten Abgleich danach
hinüber. Dort wird er so ausgeführt, als hätte die Person die Erfassung selbst dort gemacht: mit
ihren Rechten dort und unter ihrem Namen. Kommt ein Antrag doppelt an, wirkt er nur einmal.

Ein abgelehnter Antrag nennt den Grund, etwa:

- „Einsatz ist abgeschlossen und schreibgeschützt“: der Einsatz wurde dort inzwischen
  abgeschlossen;
- „Bezug nicht mehr vorhanden.“: die Person, Stelle oder Meldung, auf die sich der Antrag
  bezieht, gibt es dort nicht mehr;
- „Konto am Führer unbekannt.“: das eigene Konto gibt es dort nicht;
- „Kopplung widerrufen.“: die Kopplung wurde widerrufen, bevor der Antrag übernommen war.

Abgelehnte Anträge verschwinden nach 30 Tagen.

### Anhänge

Anhänge, Fotos und Pläne kommen zuerst nur mit Name, Größe und Prüfsumme. Wer einen Anhang am
Spiegel öffnet, bevor sein Inhalt da ist, sieht „wird geholt“; die Installation holt ihn dann
zuerst und in Stücken, damit Einträge und Anträge auch über eine schmale Leitung durchgehen. Im
Leerlauf holt sie die übrigen Anhänge vorab. Ein Inhalt gilt erst, wenn seine Prüfsumme stimmt.

Ein Anhang über 32 MiB wird nicht geholt; am Spiegel steht dann „zu groß für den Abgleich“, der
Inhalt liegt nur an der Installation, die den Einsatz führt. Ebenso bleibt ein einzelner Eintrag,
der allein (mit allem, was er braucht) größer ist als eine Lieferung, am Spiegel in seiner alten
Fassung; die Einsätze-Übersicht der Kopplung nennt ihn unter den Hinweisen. Der Abgleich der
übrigen Einträge geht weiter, und die nächste Änderung des Eintrags versucht es neu.

### Widerruf und Spiegel

Mit dem Widerruf einer Kopplung endet der Abgleich ihrer Einsätze, an beiden Installationen.
Vorhandene Spiegel bleiben lesbar und gesperrt; das Hinweisband zeigt „Abgleich beendet“. Offene
Anträge an diese Spiegel sind abgelehnt mit „Kopplung widerrufen.“ Gelöscht wird ein Spiegel
dabei nicht.

### Führung je Einsatz

Die Führung je Einsatz schaltet der Betrieb mit `LIFELINE_FUEHRUNG` an beiden Installationen
ein; ohne sie bleibt jeder Einsatz an der Installation, an der er angelegt wurde, und das Paneel
„Führung“ fehlt. Solange Einsatzinhalte nicht zwischen den Installationen fließen, bleibt sie
aus: eine Übergabe übergäbe sonst einen leeren Einsatz.

Jeder Einsatz einer gekoppelten Organisation hat genau eine führende Installation. Nur sie
schreibt den Einsatz; an der anderen ist er „Nur Ansicht · Führung liegt bei …“, und der
Einsatzkopf zeigt „Führung: … · Epoche n“. Jeder Wechsel zählt die **Epoche** hoch. Erklären
zwei Installationen ohne Verbindung dieselbe Epoche, gilt die Erklärung der Installation mit
der größeren Kennung; die andere behandelt sie wie jede Übernahme gegen sich.

Gegen die Installation, die sich meldet (den ELW), braucht eine Notübernahme die Unterschrift
eines Admins oder dessen Code. Der ELW prüft die Unterschrift gegen die Unterschriftsschlüssel,
die bei ihm gelten, und gibt nie still ab: bis jemand bestätigt oder widerspricht, schreibt er
weiter, und die Einsatzleitung bekommt die Benachrichtigung „Führung übernommen“. Widersprechen
heißt, der ELW führt mit der nächsten Epoche weiter; die andere Installation zeigt an der
Kopplung „… hat der Notübernahme widersprochen“. Eine Übernahme ohne gültige Unterschrift oder
mit falschem Code verwirft der ELW: er führt weiter, die Einsatzleitung bekommt den Alarm
„Ungültige Übernahme der Führung“, und die Admin-Spur zeigt „Ungültige Übernahme verworfen“.

Gegen den Hub braucht eine Notübernahme nur den Grund; der Hub nimmt sie mit der nächsten
Meldung an und zeigt sie im Verlauf. Wer per Code abgibt, schreibt ab dem Code nicht mehr; ein
Tippfehler am Hub zeigt sich erst am ELW, als verworfene Übernahme.

Der Verlauf im Paneel nennt je Wechsel Epoche, Art, von wem an wen, wer, Grund und
Unterzeichner. Die **Bruchstelle** ist die letzte Meldung vor einer Übernahme; was danach an
der abgelösten Installation geschrieben wurde, kennt die neue noch nicht. Die Übergabe geht
auch nach dem Einsatzabschluss, etwa zur Verwahrung am Hub.

### Hinweise an einer Kopplung

„Update nötig“ heißt, die Programmstände liegen zu weit auseinander; Melden geht weiter, sonst
nichts. Kennt die andere Installation noch keine Spiegel, werden keine Einsätze abgeglichen. „Uhr weicht ab“ erscheint ab zwei Minuten Abweichung; ab fünf Minuten lehnen die
Installationen einander ab.

---
titel: Instanzkopplung
gruppen: [administration]
reihenfolge: 690
quellen: [frontend/src/instanz/InstanzkopplungSeite.tsx, frontend/src/instanz/instanzText.ts, frontend/src/instanz/herkunft.tsx, frontend/src/api/instanz.ts, src/routes/instanz.rs, src/instanz/mod.rs, src/instanz/melden.rs, src/instanz/repo.rs, src/instanz/stammdaten/, src/auth/unterschrift/repo.rs, src/routes/auth.rs]
---

## Überblick

Zwei Lifeline-Hub-Installationen lassen sich **koppeln**, etwa der Server im
Einsatzleitwagen und ein öffentlich erreichbarer Server der Organisation. Die Kopplung legt
fest, dass beide einander vertrauen. Über sie kommen die **Stammdaten** der Organisation vom
Hub zum ELW: Konten, Fahrzeuge, Personal, Material, Qualifikationen, Fahrzeug- und
Personal-Status, Einheitstypen, Einheiten-Vorlagen, Führungsfunktionen und Org-Einstellungen.
Einsatzdaten fließen nicht darüber.

Die Seite „Instanzkopplung“ in der Verwaltung unter „Einstellungen“ zeigt diese Installation
mit ihrem **Fingerabdruck**, die gekoppelten Installationen und die **Unterschriftsschlüssel**
der Organisation. Bedienen darf sie der System-Admin; wer die Verwaltung sieht, liest mit.

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
vergeben.“ Löscht der Hub eine Zeile, die ein Einsatz am ELW verwendet, wird sie dort außer
Dienst genommen oder deaktiviert statt gelöscht. Nach dem Widerruf gehören alle Zeilen dem ELW
und sind wieder bearbeitbar.

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

### Hinweise an einer Kopplung

„Update nötig“ heißt, die Programmstände liegen zu weit auseinander; Melden geht weiter, sonst
nichts. „Uhr weicht ab“ erscheint ab zwei Minuten Abweichung; ab fünf Minuten lehnen die
Installationen einander ab.

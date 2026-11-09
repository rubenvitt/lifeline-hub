---
titel: Instanzkopplung
gruppen: [administration]
reihenfolge: 690
quellen: [frontend/src/instanz/InstanzkopplungSeite.tsx, frontend/src/instanz/instanzText.ts, frontend/src/api/instanz.ts, src/routes/instanz.rs, src/instanz/mod.rs, src/instanz/melden.rs, src/instanz/repo.rs, src/auth/unterschrift/repo.rs]
---

## Überblick

Zwei Lifeline-Hub-Installationen lassen sich **koppeln**, etwa der Server im
Einsatzleitwagen und ein öffentlich erreichbarer Server der Organisation. Die Kopplung legt
fest, dass beide einander vertrauen; Einsatzdaten fließen darüber noch nicht.

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
unterschieben, ohne dass hier jemand nachfragt.

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

### Hinweise an einer Kopplung

„Update nötig“ heißt, die Programmstände liegen zu weit auseinander; Melden geht weiter, sonst
nichts. „Uhr weicht ab“ erscheint ab zwei Minuten Abweichung; ab fünf Minuten lehnen die
Installationen einander ab.

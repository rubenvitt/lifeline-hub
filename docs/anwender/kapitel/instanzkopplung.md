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
Gegenzeichnung“. Ein anderer Admin mit gültigem Schlüssel wählt im Menü der Zeile
„Gegenzeichnen“ und bestätigt mit seinem Passkey.

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

### Fingerabdruck und Sicherheit

Jede Installation hat ein eigenes Schlüsselpaar; der Fingerabdruck ist eine Kurzform davon. Alle
Nachrichten zwischen gekoppelten Installationen sind damit signiert. Der Code selbst geht nie
über die Leitung; wer sich zwischen beide Installationen schaltet, fällt beim Einlösen auf, und
das Koppeln scheitert.

### Unterschriftsschlüssel

Ein Unterschriftsschlüssel ist ein Passkey nur zum Unterschreiben, nicht zur Anmeldung.
Gekoppelte Installationen bekommen die Schlüssel der Organisation und nehmen einen neuen nur an,
wenn ein ihnen bekannter ihn gegengezeichnet hat; sonst steht an der Kopplung ein Hinweis
„abgelehnt“. Der letzte gültige Schlüssel einer gekoppelten Organisation lässt sich nicht
widerrufen. Wird ein Admin-Konto deaktiviert oder herabgestuft, sind seine Schlüssel widerrufen.
Zwei Schlüssel je Organisation, damit einer verloren gehen darf.

### Hinweise an einer Kopplung

„Update nötig“ heißt, die Programmstände liegen zu weit auseinander; Melden geht weiter, sonst
nichts. „Uhr weicht ab“ erscheint ab zwei Minuten Abweichung; ab fünf Minuten lehnen die
Installationen einander ab.

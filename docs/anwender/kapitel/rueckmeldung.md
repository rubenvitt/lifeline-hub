---
titel: Rückmeldung geben
gruppen: [alle]
reihenfolge: 90
quellen: [frontend/src/rueckmeldung/, frontend/src/components/BenutzerMenu.tsx, .github/ISSUE_TEMPLATE/, scripts/rueckmeldung/, SECURITY.md]
---

## Überblick

Fehler, Wünsche und Fragen zu Lifeline Hub gehen als Rückmeldung an die Entwicklung. Der Weg führt
über ein Formular im öffentlichen Repository von Lifeline Hub auf GitHub; jede Person, die mit der
Anwendung arbeitet, kann es nutzen. Ohne GitHub-Konto geht die Rückmeldung per E-Mail an
rueckmeldung@lifeline-hub.de.

## Abläufe

### Rückmeldung über das Formular

1. Das Benutzermenü öffnen.
2. „Rückmeldung“ wählen. Das Formular öffnet sich in einem neuen Fenster des Browsers, in der
   Desktop-App im Standardbrowser des Rechners.
3. Bei GitHub anmelden, falls noch nicht geschehen. Ein Konto lässt sich dort kostenlos anlegen.
4. „Art“ wählen: Fehler, Wunsch oder Frage.
5. „Version“, „Oberfläche“ und „Bereich der App“ sind schon ausgefüllt. Sie stimmen, solange die
   Rückmeldung den Bereich betrifft, aus dem das Menü geöffnet wurde.
6. Einen Titel eintragen und unter „Was ist passiert, was wünschst du dir?“ beschreiben, worum es
   geht. Bei einem Fehler helfen „Schritte zum Nachstellen“ und „Erwartet“.
7. Bestätigen, dass Text und Bilder keine Namen von Betroffenen oder Patienten und keine
   Einsatzinhalte enthalten.
8. Das Formular absenden.

Ohne Netz bleibt das Formular leer. Die Beobachtung wird dann mit Version und Uhrzeit notiert und
später gemeldet.

### Rückmeldung per E-Mail

1. Eine E-Mail an rueckmeldung@lifeline-hub.de schreiben.
2. Die Version aus dem Benutzermenü (Zeile „Version …“ unter dem Namen), den Bereich der App und
   die Beobachtung nennen.

### Sicherheitslücke melden

1. Eine Sicherheitslücke **nicht** über das öffentliche Formular melden.
2. Im Repository von Lifeline Hub auf GitHub den Reiter „Security“ öffnen und „Report a
   vulnerability“ wählen. Diese Meldung sieht nur die Entwicklung.
3. Ohne GitHub-Konto per E-Mail an rueckmeldung@lifeline-hub.de, Betreff beginnend mit
   „Sicherheit:“.

## Hintergrund

### Öffentlich lesbar

Rückmeldungen über das Formular sind auf GitHub für jede Person lesbar, auch außerhalb der eigenen
Organisation. Namen von Betroffenen, Patienten oder Einsatzkräften, Lagemeldungen,
Einsatztagebuch-Einträge und Bildschirmfotos mit solchen Inhalten gehören deshalb nicht hinein.
Ein Bildschirmfoto mit Demo-Daten ([Demo-Daten](demo-daten.md)) zeigt dasselbe ohne echte Daten.

### Was die Anwendung mitgibt

Der Eintrag „Rückmeldung“ füllt nur drei Felder vor: die Version, die Oberfläche (Browser oder
Desktop-App) und den Bereich der App als Muster, etwa `/einsatz/:id/etb`. Kennungen von Einsatz,
Personen oder Einheiten stehen nicht darin, ebenso wenig Name, Benutzername oder die Adresse des
Servers; auch als Herkunft (Referer) gibt der Aufruf die Adresse nicht weiter. Alles Weitere steht
nur im Formular, wenn es dort eingetragen wird.

### Was danach passiert

Eine Rückmeldung aus dem Formular geht automatisch in die Aufgabenliste der Entwicklung und trägt
danach das Label „aufgenommen“. Das Label „nicht-aufgenommen“ heißt, dass die Übernahme nicht
bestätigt ist. Die Entwicklung bekommt das angezeigt und holt die Übernahme von Hand nach; danach
wechselt das Label auf „aufgenommen“. Steht „nicht-aufgenommen“ nach einem Tag noch da, hilft eine
E-Mail mit der Nummer des Issues an rueckmeldung@lifeline-hub.de. Rückfragen und Antworten stehen
als Kommentar im Issue; GitHub benachrichtigt die meldende Person darüber. Das Issue bleibt der Ort
für Ergänzungen: später hinzugefügter Text erreicht die Entwicklung über das Issue, nicht über eine
neue Rückmeldung.

### Gekoppelte Geräte

Auf gekoppelten Geräten fehlt der Eintrag. Eine Beobachtung dort meldet eine angemeldete Person
über das Benutzermenü auf einem anderen Gerät oder per E-Mail, mit der Oberfläche „gekoppeltes
Gerät“.

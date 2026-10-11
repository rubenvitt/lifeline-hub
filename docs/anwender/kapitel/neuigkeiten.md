---
titel: Neuigkeiten
gruppen: [alle]
reihenfolge: 80
quellen: [src/versionsstand/, src/routes/versionsstand.rs, frontend/src/neuigkeiten/, frontend/scripts/changelog-zerlegen.mjs]
---

## Überblick

Unter **Neuigkeiten** steht, was sich in der Anwendung geändert hat: je Version, getrennt nach
Kanal (Alpha, Beta, Stabil). Nach einer Aktualisierung zeigt die Seite zuerst, was seit der
zuletzt gelaufenen Version dazugekommen ist. Jede angemeldete Person kann sie lesen, eine Rolle
braucht es dafür nicht.

## Abläufe

### Neuigkeiten öffnen

1. Das Benutzermenü öffnen.
2. „Neuigkeiten“ wählen.
3. Oben steht „Seit deiner letzten Version“, wenn es seit dem letzten Start eine neue Version
   gab. Darunter steht das Archiv aller Versionen, neueste zuerst.
4. Mit den Schaltflächen „Alle“, „Alpha“, „Beta“ oder „Stabil“ wird das Archiv auf einen Kanal
   beschränkt.
5. Ein langer stabiler Eintrag zeigt zuerst den Anfang. „Vollständig anzeigen“ blendet den Rest
   ein.

### Hinweis nach einer Aktualisierung

1. Nach dem Anmelden erscheint auf der Einsatzliste oben eine Karte „Neu seit …“, mit der Anzahl
   der neuen Versionen des laufenden Kanals.
2. „Neuigkeiten ansehen“ öffnet die Seite.
3. Das Kreuz an der Karte schließt sie, ohne die Seite zu öffnen.

Im Benutzermenü steht neben „Neuigkeiten“ ein Punkt, solange die laufende Version noch nicht
gelesen ist.

## Hintergrund

**Lesestand gilt für den Server.** Öffnet eine Person die Seite oder schließt sie die Karte, gilt
die laufende Version für alle Personen auf diesem Server als gelesen. Die Karte und der Punkt
verschwinden dann für alle. Arbeiten mehrere Personen auf dem Server, kann das eine Information
übergehen, die eine andere Person noch braucht.

**Kanäle.** Eine Alpha-Version trägt im Namen `-alpha`, eine Beta-Version `-beta`. Alles andere ist
ein stabiles Release. Ein Wechsel in den stabilen Kanal zeigt das stabile Release, das die
Änderungen aller Vorabversionen seit dem letzten stabilen Stand zusammenfasst.

**App noch nicht aktualisiert.** Nach einem Update des Servers läuft im Browser oft noch die
vorige Fassung der App, bis jemand sie über die Meldung zur Aktualisierung neu lädt. Diese Fassung
kennt die neuen Notizen noch nicht. Die Seite sagt das dann oben, und der Lesestand bleibt
unverändert, bis die neue Fassung geladen ist. Der Punkt im Benutzermenü bleibt so lange stehen.

**Beta.** Solange es keine Beta-Versionen gibt, bleibt der Kanal leer, und die Seite sagt das.

**Ohne Netz.** Die Neuigkeiten sind mit der Anwendung ausgeliefert und lesbar, ohne Verbindung zum
Server. Den Lesestand kann der Server nur ändern, wenn er erreichbar ist. Ohne Verbindung erscheint
deshalb keine Karte, weil der Versionsstand nicht geladen werden kann.

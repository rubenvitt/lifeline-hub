# Proposal

## Why

Wer einen Server auf eine neue Alpha- oder Beta-Version aktualisiert, sieht heute nicht, was sich
seit der vorher laufenden Version geändert hat. Die Release Notes liegen auf GitHub, sind aber
dort nur je Release einzeln einsehbar, für Offline-Betrieb nicht verfügbar und bei großen
Releases gekürzt. Eine Übersicht „seit deiner letzten Version“ und ein Archiv aller Neuigkeiten
im Hub selbst schließen diese Lücke. Die Notizen stehen bereits vollständig in `CHANGELOG.md`,
sie müssen nur in die Anwendung gelangen.

## What Changes

- Die Anwendung zeigt eine Neuigkeiten-Seite mit allen Versionen, getrennt nach Kanal (Alpha,
  Beta, Stabil) und mit Filter je Kanal. Die Notizen stammen zur Build-Zeit aus `CHANGELOG.md`
  und sind vollständig offline lesbar.
- Der Server merkt sich die zuletzt gestartete Version und erkennt beim Start einen
  Versionswechsel.
- Nach einem Versionswechsel erscheint auf der Einstiegsseite eine nicht-modale, schließbare
  Hinweiskarte „Neu seit X: n Versionen“. Im Benutzermenü zeigt der Eintrag „Neuigkeiten“ einen
  Punkt, solange ungelesene Versionen vorliegen.
- Die Neuigkeiten-Seite öffnet im Abschnitt „seit deiner letzten Version“: alle Einträge desselben
  Kanals nach der zuletzt gelaufenen Version bis zur aktuellen, neueste zuerst.
- „Gelesen“ gilt, sobald die Neuigkeiten-Seite geöffnet oder die Hinweiskarte geschlossen wird.
- Der Beta-Kanal ist vorbereitet, bleibt aber leer, bis der Branch `beta` existiert.
- Stabile Einträge sind kumulativ, weil semantic-release seit dem letzten stabilen Tag zählt. Der
  erste stabile Eintrag (1.0.0) enthält die gesamte Historie und wird deshalb nur als Vorschau
  mit Aufklappen gezeigt.

Es gibt keine Änderung an der Release-Pipeline und keine Laufzeitabfrage bei GitHub.

## Capabilities

### New Capabilities

- `versionsstand`: Der Server hält die zuletzt gestartete Version und den Lesestand der
  Neuigkeiten pro Instanz fest und erkennt daraus einen Versionswechsel beim Start.
- `neuigkeiten`: Die Neuigkeiten-Seite mit Kanalfilter und dem Abschnitt „seit deiner letzten
  Version“, die Hinweiskarte, der Punkt im Benutzermenü und die Quelle der Einträge aus
  `CHANGELOG.md`.

### Modified Capabilities

Keine. `desktop-auslieferung` (Vorabversionen liefern keine Desktop-Pakete, Update nur im
stabilen Kanal) bleibt unverändert, und die Release-Pipeline bleibt unverändert.

## Impact

- **Datenbank:** eine neue Tabelle mit genau einer Zeile für den Versionsstand der Instanz, per
  Migration angehängt (Nummer nach `scripts/check-migrationen.sh` gegen `origin/alpha`).
- **Backend:** Versionserkennung beim Start, ein lesender Endpunkt für Versionsstand und
  Lesestand, ein schreibender Endpunkt zum Markieren als gelesen.
- **Frontend:** Neuigkeiten-Seite (eigener, nachgeladener Chunk), Hinweiskarte, Punkt im
  Benutzermenü, Build-Schritt, der `CHANGELOG.md` zerlegt.
- **Build:** `CHANGELOG.md` wird zur Build-Zeit eingelesen. Die Datei muss im Repo bleiben.
- **Offen:** Der Lesestand gilt pro Instanz. Liest eine Person die Seite, verschwindet der Punkt
  für alle. Das ist so beschlossen, aber bei mehreren Admins bewusst zu prüfen (siehe `design.md`).

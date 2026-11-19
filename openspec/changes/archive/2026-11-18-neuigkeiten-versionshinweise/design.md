# Design

## Context

Die Anwendung ist ein Rust-Server mit eingebettetem Frontend. Er läuft als Container oder als
Desktop-Hülle und muss ohne Internet funktionieren. Die Version steht als `CARGO_PKG_VERSION` im
Server und wird im Benutzermenü schon angezeigt (`frontend/src/components/BenutzerMenu.tsx`). Die
Release Notes entstehen in `release.config.mjs` über semantic-release und landen vollständig in
`CHANGELOG.md`, mit einer Überschrift je Version (`## [version](link) (datum)`). Die GitHub-Release-
Texte sind dagegen auf 120 000 Zeichen gekürzt und werden nicht gelesen.

Bestehende Specs: `desktop-auslieferung` regelt Vorabversionen und den stabilen Update-Kanal und
bleibt unberührt. Der Versionsstand ist neu; es gibt noch keine Tabelle für Instanz-Einstellungen,
die sich dafür eignet (`org_einstellungen` ist pro Organisation).

## Goals / Non-Goals

**Goals:**
- Neuigkeiten offline aus dem Build, ohne Laufzeitabfrage.
- Versionswechsel auf dem Server erkennen, ohne dass die Oberfläche etwas erraten muss.
- Hinweis und Seite nicht unterbrechend.

**Non-Goals:**
- Keine Änderung an Release-Pipeline, Notizen-Generator oder Kanal-Logik.
- Kein Lesestand pro Person; der Stand gilt pro Instanz, wie besprochen.
- Keine Benachrichtigung per E-Mail oder Push.

## Decisions

**Quelle: `CHANGELOG.md` zur Build-Zeit im Frontend.** Ein Vite-Plugin liest die Datei, zerlegt sie
an den Versionsüberschriften und erzeugt ein Modul mit `{version, datum, kanal, text}`. Die
Seite lädt als eigener Chunk, damit der Rest der App nicht größer wird.
- Alternative: eine JSON-Datei pro Release im Release-Schritt. Verworfen, weil das einen weiteren
  Commit im Release-Pfad bräuchte und die Quelle doppelt führt.
- Alternative: Einbettung im Rust-Build (`rust-embed`). Verworfen, weil die Frontend-Kette
  ohnehin den Text braucht und das Parsen im Frontend testbar bleibt.

**Kanal aus der Versionsnummer.** `-alpha.N` → alpha, `-beta.N` → beta, sonst stabil. Kein
Datenfeld, weil semantic-release den Kanal schon in der Version trägt.

**Versionsstand als Ein-Zeilen-Tabelle `instanz_versionsstand`.** Spalten: `id` (fest 1),
`laufend`, `zuletzt_gestartet` (nullable), `gelesen_bis`. Eine neue Migration hängt am Ende
an; die Nummer ergibt sich aus `scripts/check-migrationen.sh` gegen `origin/alpha` und ist nicht
vorab festgelegt.

**Erkennung beim Start.** Der Server führt den Abgleich einmal beim Start aus, nach dem
Migrationslauf und vor der ersten Anfrage. Weicht `laufend` von `CARGO_PKG_VERSION` ab, wird
`zuletzt_gestartet` auf den alten Wert gesetzt und `laufend` auf den neuen. `gelesen_bis` bleibt
unberührt.

**Zwei Endpunkte.** `GET /api/versionsstand` liefert laufend, zuletzt gestartet und gelesen_bis.
Die Anzahl ungelesener Einträge rechnet die Oberfläche aus den Einträgen des Builds, der Server
kennt die CHANGELOG nicht. `POST /api/versionsstand/gelesen` setzt `gelesen_bis` auf die
laufende Version. Beide verlangen Anmeldung. Die Antwort wird in den Typ-Codegen aufgenommen;
danach `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten.

**Hinweiskarte in eigenem Chunk.** Die Karte trägt die Einträge der CHANGELOG und wird erst geladen,
wenn eine Version ungelesen ist. Die Einsatzliste lädt die Notizen so nicht mit.

**Hinweiskarte und Punkt teilen sich einen Zustand.** Das Schließen der Karte ruft denselben
Endpunkt wie das Öffnen der Seite. Damit gilt eine Version nach einem der beiden als gelesen.

**Abschnitt „seit deiner letzten Version“ rein im Frontend.** Die Filterung nach Kanal und
Versionsgrenze geschieht im Modul aus dem Build. Der Server liefert nur die Versionen, nicht die
Auswahl.

## Risks / Trade-offs

- **Format von `CHANGELOG.md`:** Ändert sich die Überschrift, bricht das Parsen still. →
  Test mit der echten Datei im Repo; ein Eintrag ohne erkannte Version lässt den Build rot werden.
- **Wachsende Datei:** Die Historie wächst mit jedem Release. → Eigener Chunk; die Seite lädt
  Einträge nur bei Bedarf (siehe Spec, Vorschau für stabile Einträge über 20 000 Zeichen).
- **Lesestand pro Instanz:** Eine Person liest, der Punkt verschwindet für alle. → Bewusst so
  beschlossen; bei mehreren Admins sichtbar im Abschnitt „Offen“ des Vorschlags.
- **Startseite:** Die Einstiegsseite nach dem Login muss in der Umsetzung benannt werden; die Spec
  beschreibt sie nur allgemein. → In der ersten Aufgabe festlegen.

## Migration Plan

1. Migration und Versionserkennung ausliefern; Hinweis und Seite sind noch nicht sichtbar.
2. Frontend-Seite und Punkt ausliefern.
3. Rollback: die Tabelle bleibt liegen, die Oberfläche verschwindet mit dem Frontend. Keine
   Daten gehen verloren, weil der Versionsstand nur Metadaten hält.

## Open Questions

Keine offen. Die Lesestand-Frage ist als Entscheidung dokumentiert.

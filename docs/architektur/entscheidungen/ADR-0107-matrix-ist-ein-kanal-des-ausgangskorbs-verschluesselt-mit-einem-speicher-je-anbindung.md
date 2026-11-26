---
id: ADR-0107
titel: Matrix ist ein Kanal des Ausgangskorbs, verschlüsselt über matrix-sdk, mit einem Schlüsselspeicher je Anbindung außerhalb der Sicherung
status: vorgeschlagen
datum: 2026-11-26
gilt_fuer:
  - src/adapter/matrix.rs
  - src/adapter/matrix_art.rs
  - src/ausgang/zusteller.rs
  - src/ausgang/zusteller/**
herleitung:
  - docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md
  - https://zunder.rubeen.dev/#/aufgabe/ntaizaveziu8k9qzqu9tencu
---

# ADR-0107: Matrix ist ein Kanal des Ausgangskorbs, verschlüsselt über matrix-sdk, mit einem Schlüsselspeicher je Anbindung außerhalb der Sicherung

Nachtrag zu ADR-0104 (der Ausgangskorb wird kanalneutral) und Präzisierung von ADR-0105 für eine
Art, deren Anfragen ein fremder Client stellt.

## Regeln

- MUST: Der Lauf gibt jeden Versand über `ausgang::zusteller::Zustellerwahl` dem Zusteller seines
  Kanals; Fehlerzuordnung, Wiederholung, ETB und Abschluss bleiben in `ausgang::lauf`. Je Kanal
  bedient ihn höchstens eine Anbindung je Org (`smtp` für `email`, `matrix` für `matrix`).
- MUST: Den Matrix-Client baut nur `adapter::matrix`, mit dem `reqwest::Client` aus
  `adapter::ziel::client_builder_mit_zielschutz`; die Homeserver-URL besteht vorher `check_url`,
  kein `.well-known`. Die Art `matrix` erklärt kein `http_im_lan` (ADR-0105 gilt mit nur `https`).
- MUST: Je Anbindung höchstens ein offener Client im Prozess, hinter einer Sperre
  (`adapter::matrix::Clients`); Prüflauf und Ausgangskorb teilen ihn, nie öffnen zwei Clients
  denselben Speicher.
- MUST NOT: In einen verschlüsselten Raum geht nie `m.room.message`; kann der Bot nicht
  verschlüsseln, scheitert der Versand mit `verschluesselung`. Raumschlüssel gehen ausdrücklich an
  alle Geräte der Mitglieder (`CollectStrategy::AllDevices`).
- MUST: Jeder Teil trägt die Transaktions-ID `ausgang-{versand_id}-{teil}`, gesendete Teile stehen
  in `ausgang_teil` und gehen bei keinem späteren Versuch noch einmal hinaus. Ein abgebrochener
  Matrix-Versuch ist vorübergehend, nicht `ungewiss`; ein Neustart mitten in der Zustellung
  bleibt `ungewiss` wie bei E-Mail.
- MUST: Der Schlüsselspeicher liegt je Anbindung unter `matrix/<adapter_id>/` neben der
  Datenbank, verschlüsselt mit der internen Passphrase der Anbindung, und gehört nie in eine
  Sicherung. Neues Token, neuer Homeserver und Löschen verwerfen Client und Verzeichnis.
- MUST NOT: Token, Passphrase oder Schlüsselmaterial stehen in Log, Spalte, ETB, Antwort,
  Admin-Spur oder Fehlertext; ein Text des Homeservers steht nie in Spalte, ETB oder Antwort (der
  ETB-Grund nennt höchstens den Matrix-`errcode`).

Die Einzelregeln mit Dateien stehen in `src/AGENTS.md`, „Ausgang an Menschen“ und „Adapter“.

## Prüfung

```sh
verlange 'CollectStrategy::AllDevices' src/adapter/matrix.rs
verlange 'client_builder_mit_zielschutz' src/adapter/matrix.rs
verlange 'ausgang-\{versand_id\}-\{teil\}' src/ausgang/zusteller/matrix.rs
verlange 'KanalArt::Matrix => self\.matrix\.zustellen' src/ausgang/zusteller.rs
verbiete 'matrix_sdk::Client::builder' 'src/**/*.rs' ':(exclude)src/adapter/matrix.rs'
verbiete 'fn http_im_lan' src/adapter/matrix_art.rs
verbiete 'matrix' 'src/backup/**/*.rs'
verbiete 'ohne_zielschutz_fuer_tests' 'src/**/*.rs' ':(exclude)src/adapter/ziel.rs' ':(exclude)src/adapter/matrix.rs'
```

## Kontext

Leitstellen, Stäbe und Behörden-Messenger arbeiten in Matrix-Räumen, die fast immer verschlüsselt
sind; ein Ausgang ohne E2EE erreichte sie nicht. Olm und Megolm baut nur `matrix-sdk-crypto`
verlässlich, und das SDK braucht einen dauerhaften Speicher, sonst wäre das Gerät des Bots nach
jedem Neustart ohne Schlüssel. Anders als SMTP erkennt ein Homeserver eine wiederholte
Transaktions-ID desselben Geräts und liefert die alte Event-ID.

## Konsequenzen

Ein Lagebericht erreicht verschlüsselte Lageräume ohne Klartext und ohne Doppel bei einer
Wiederholung. Der Speicher liegt außerhalb der Hub-Datenbank: nach Restore oder Umzug fehlt er,
die Prüfung meldet `schluessel_passen_nicht`, und der Bot braucht ein neues Token (neues Gerät).
Der Baum wächst um matrix-sdk samt `rusqlite` (ADR-0108).

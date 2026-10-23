# deeplink-quelle Specification

## Purpose
Sichert zu, dass Einsatzpfade im Frontend aus genau einer Quelle entstehen, damit eine geänderte
Route nicht still an einer vergessenen Stelle woanders hinführt.

## Requirements

### Requirement: Einsatzpfade nur aus der Deeplink-Quelle

Quelltext unter `frontend/src/` außer der Deeplink-Quelle `routing/deeplinks.ts` MUST NOT einen
Einsatzpfad als Template-Literal bauen (`` `/einsaetze/${…}` ``). Einsatzpfade MUST über die
Builder der Deeplink-Quelle entstehen. Test-Dateien sind ausgenommen, dort ist das Literal die
ehrlichere Erwartung.

#### Scenario: Neuer Inline-Pfad auf einer Seite
- **WHEN** eine Datei unter `frontend/src/pages/` einen Link mit `` `/einsaetze/${einsatzId}` `` baut
- **THEN** schlägt der Guard fehl und nennt die Datei

#### Scenario: Inline-Pfad in einem Test
- **WHEN** eine Test-Datei einen Einsatzpfad als Template-Literal erwartet
- **THEN** bleibt der Guard grün

#### Scenario: Die Deeplink-Quelle selbst
- **WHEN** `routing/deeplinks.ts` Einsatzpfade als Template-Literal zusammensetzt
- **THEN** bleibt der Guard grün

### Requirement: Gleiches Ziel nach dem Umzug

Ein Link oder Sprung, der vom Inline-Pfad auf einen Builder umgestellt wird, MUST auf dasselbe
Ziel führen wie zuvor.

#### Scenario: Brotkrume zur Einsatzseite
- **WHEN** auf der Detailseite einer Unfallhilfsstelle oder eines Bereitstellungsraums oder auf deren Listenseite die Brotkrume mit dem Einsatznamen angeklickt wird
- **THEN** öffnet sich `/einsaetze/<id>` wie zuvor

#### Scenario: Sprung zu den Lageberichten aus der ETB-Schnellerfassung
- **WHEN** in der ETB-Schnellerfassung der Sprung zu den Lageberichten ausgelöst wird
- **THEN** öffnet sich die Lageberichtsliste des Einsatzes wie zuvor

### Requirement: Listenzustand in der Adresse

Sortierung, Filter und Suche einer Tabelle MUST über `listenZustandParams` in die Adresse
geschrieben und über `parseListenZustand` gelesen werden (Kodierung siehe
`tabellen-sortieren-filtern`). Ein Zustand MUST den Weg durch `URLSearchParams` unverändert
überstehen, auch mit Komma, Leerzeichen und Umlaut im Wert.

#### Scenario: Round-Trip
- **WHEN** ein Zustand mit Sortierung `ort:ab`, Filter `typ=sturm,flut` und Suche „Deich 7“ geschrieben und wieder gelesen wird
- **THEN** kommt derselbe Zustand heraus, und fremde Parameter der Adresse stehen weiter da


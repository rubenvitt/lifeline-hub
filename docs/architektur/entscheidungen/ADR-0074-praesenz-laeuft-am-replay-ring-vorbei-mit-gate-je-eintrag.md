---
id: ADR-0074
titel: Präsenz läuft am Replay-Ring vorbei, mit Gate je Eintrag
status: vorgeschlagen
datum: 2026-11-19
gilt_fuer:
  - src/live/praesenz.rs
  - src/routes/praesenz.rs
  - frontend/src/live/praesenz.ts
herleitung:
  - docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md
---

# ADR-0074: Präsenz läuft am Replay-Ring vorbei, mit Gate je Eintrag

## Regeln

- MUST Präsenz nur im Speicher des `LiveHub` halten, nie in der Datenbank.
- MUST NOT Präsenz über `publiziere_*` oder den Replay-Ring eines Einsatzes verteilen; sie geht als
  eigener Teilstrom ohne `id:` hinaus.
- MUST jeden Eintrag einzeln über das Bezugsereignis seines Objekts filtern
  (`PraesenzObjekt::bezug`), weil `LiveEvent::Praesenz` selbst ungegatet ist.
- MUST NOT Präsenz an Gerätesitzungen oder in den Org-Strom senden.
- MUST bei jedem Verbindungsaufbau den nicht leeren, gefilterten Stand senden; der Client MUST
  seinen Stand bei jedem Öffnen der Verbindung leeren.
- MAY im Eintrag den Anzeigenamen (`von`) tragen: er ist kein sensibler Inhalt im Sinne von
  ADR-0003, denn dieselbe Tür (`EinsatzLesezugriff`) liefert ihn über die Mitgliederliste und den
  Änderungsvermerk; andere Inhalte (Werte der Angabe) MUST NOT in die Nutzlast.
- SHOULD im Frontend den Stand in `live/praesenz.ts` halten, nicht im Query-Cache
  (`frontend/AGENTS.md`, „Präsenz ist kein Cache“).

## Prüfung

```sh
verbiete 'publiziere\w*\([^)]*Praesenz' 'src/**/*.rs'
verlange 'fn bezug' 'src/live/praesenz.rs'
verlange 'sse_praesenz_stream' 'src/routes/live.rs'
verbiete 'sqlx' 'src/live/praesenz.rs'
```

## Kontext

Die Präsenzanzeige „Wird gerade bearbeitet von …“ braucht ein Lebenszeichen je offener Eingabe
alle 15 s. Durch den Replay-Ring (256 je Einsatz) verdrängte das echte Ereignisse und führte zu
Lücken und Vollabgleich. Die Gate-Menge eines `LiveEvent` hängt an der Variante, Präsenz betrifft
aber Objekte mit verschiedenen Gates (Einsatzkopf offen, Einheit hinter `einheiten`).

## Konsequenzen

Präsenz kostet keine Ringplätze und verteilt nur Änderungen, nicht jeden Herzschlag. Nach einem
Neustart ist sie weg und füllt sich binnen 15 s neu. Ein neues Objekt mit Präsenz braucht ein
Bezugsereignis und eine feste Feldliste; ein Zwischenzustand über Instanzen (Spiegel) gibt es
nicht.

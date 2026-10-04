# Design

## Context

`fts_query` (`src/etb/repo.rs`) setzt jedes Wort der Eingabe als FTS5-Phrase in Anführungszeichen
und verwirft Wörter ohne alphanumerisches Zeichen. Die FTS5-Tabelle `etb_eintrag_fts`
(`migrations/0004_etb.sql`, Tokenizer `unicode61` mit Standard-Diakritik-Entfernung) indexiert
Inhalt, Von, An und Veranlassung. Eine Phrase ohne `*` trifft nur ganze Tokens.
`filter_bedingung` ist die eine Quelle für Liste und beide Zählungen (LFH-612/619).

## Goals / Non-Goals

**Goals:**
- Wortanfänge treffen, überall wo die ETB-Volltextsuche greift, ohne Schema- oder API-Änderung.

**Non-Goals:**
- Treffer in der Wortmitte („bruch“ → „Deichbruch“).
- Relevanzsortierung; die Liste bleibt nach laufender Nummer sortiert.
- Fehlertolerante oder unscharfe Suche.

## Decisions

### Präfix-Abfrage je Wort (`"wort"*`)

`fts_query` hängt an jede Phrase ein `*` an. FTS5 wendet das Präfix auf das letzte Token der
Phrase an; Eingaben wie `B-1` (Tokens `b`, `1`) werden so zu „`b`, gefolgt von einem Token, das mit
`1` beginnt“. Escaping (`"` verdoppeln) und das Verwerfen nicht-alphanumerischer Wörter bleiben
unverändert, damit bleibt auch die Sonderzeichen-Sicherheit erhalten. Mit SQLite nachgeprüft:
`"Deich"*` trifft „Deichbruch gemeldet“ und „Deich hält“, `"uberf"*` trifft „Überflutung“.

Verworfene Alternativen:
- **Trigram-Tokenizer**: träfe auch Wortmitten, braucht aber eine Migration mit Neuaufbau des
  Index, findet erst ab drei Zeichen und vergrößert den Index deutlich. Wortmitten sind im
  Ticket nicht verlangt; Wortanfänge decken die Komposita-Fälle („Deich“, „Funk“) ab.
- **`prefix=`-Indexoption**: beschleunigt Präfixabfragen, braucht aber ebenfalls eine Migration.
  Bei der Größe eines Einsatztagebuchs (Tausende Einträge) ist der Präfix-Scan ohne Zusatzindex
  schnell genug.
- **Status quo** (nur ganze Wörter): verfehlt das Akzeptanzkriterium.

### Bezugswahl behält den Fensterfilter

`waehleEtbEintraege` filtert das jüngste Fenster clientseitig per Teilstring. Das bleibt nötig:
es trifft Wortmitten und Teilnummern („41“ → „ETB 412“) und stellt sicher, dass während der
Entprellung kein unpassender Eintrag zur Wahl steht. Nur der Kommentar in
`sucheEtbBezuege`, der „nur GANZE Wörter“ behauptet, wird auf Wortanfänge korrigiert.

## Risks / Trade-offs

- [Kurze Eingaben wie „a“ treffen viele Einträge] → Liste ist gedeckelt, Zählung bleibt korrekt;
  das ist die erwartete Wirkung einer Präfixsuche.
- [Ergebnismengen wachsen gegenüber heute] → gewollt; ganze Wörter treffen weiter alles wie bisher.

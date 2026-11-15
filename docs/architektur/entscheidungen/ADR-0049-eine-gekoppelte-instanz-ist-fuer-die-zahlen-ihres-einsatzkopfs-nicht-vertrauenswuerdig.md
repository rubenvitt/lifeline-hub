---
id: ADR-0049
titel: Eine gekoppelte Instanz ist für die Zahlen ihres Einsatzkopfs nicht vertrauenswürdig
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - src/instanz/spiegel/uebernehmen.rs
  - src/instanz/spiegel/nummer.rs
  - src/einsatz/nummer.rs
  - src/einsatz/repo.rs
herleitung:
  - openspec/changes/archive/2026-11-15-bqz5qimz-spiegel-nummer-grenze/design.md
---

# ADR-0049: Eine gekoppelte Instanz ist für die Zahlen ihres Einsatzkopfs nicht vertrauenswürdig

## Regeln

- MUST: Jahr und laufende Nummer eines gelieferten Spiegelkopfs gehen nur in die Datenbank, wenn
  `einsatz::nummer::check_gelieferte_zahlen` sie gültig nennt (`JAHR_GRENZEN`, `LFD_GRENZEN`);
  sonst werden beide leer übernommen, der Nummerntext bleibt, und am Spiegel steht ein Hinweis.
- MUST NOT: Eine ungültige Einsatznummer der Gegenstelle hält die übrige Lieferung an.
- MUST: Jede Vergabe einer laufenden Nummer rechnet die nächste über
  `einsatz::repo::naechste_lfd` (geprüft, 422 statt Panik oder Umlauf), nie mit `+ 1`.
- MUST: Die freie Nummer beim Übergang vom Spiegel zum eigenen Einsatz bleibt unter
  `LFD_GRENZEN.end()`, solange die eigenen Einsätze es tun (Spec `einsatznummer`, „Die freie
  Nummer bleibt in der Grenze“).

## Prüfung

```sh
verlange 'limit_gelieferte_nummer\(&mut werte\)' src/instanz/spiegel/uebernehmen.rs
verlange 'naechste_lfd\(' src/einsatz/repo.rs src/instanz/spiegel/nummer.rs
verbiete '(lfd|neu_lfd) \+= 1' src/einsatz/repo.rs src/instanz/spiegel/nummer.rs
verbiete 'max_lfd\.unwrap_or\(0\) \+ 1' src/einsatz/repo.rs src/instanz/spiegel/nummer.rs
```

## Kontext

Die Kopplung sichert, wer liefert (Signatur), nicht, dass der Inhalt stimmt. Jahr und laufende
Nummer eines Spiegels fließen in die Nummernvergabe dieser Instanz, die alle eigenen Einsätze des
Jahres trägt. Ein einziger Wert nahe `i64::MAX` einer fehlerhaften Gegenstelle ließ die Anlage im
Debug-Bau abstürzen und im Release in negative Nummern umlaufen (LLH-1859).

## Konsequenzen

Ein Fehler der Gegenstelle bleibt an ihrem Spiegel: leere Zahlen und ein Hinweis, das Lagebild
läuft weiter. Wer künftig eine neue Stelle schreibt, die laufende Nummern vergibt oder Kopfzahlen
übernimmt, muss über diese Bausteine gehen. Bestand außerhalb der Grenzen führt zu 422 statt zu
einer falschen Nummer.

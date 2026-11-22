---
id: ADR-0081
titel: Eine neu vergebene ID ist am Spiegel eine neue Zeile und trägt den Schlüssel der gelöschten
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - src/instanz/spiegel/art.rs
  - src/instanz/spiegel/fuehrung.rs
  - migrations/0362_spiegel_neu_vergeben.sql
herleitung:
  - docs/superpowers/specs/2026-11-22-k13jdo7f-spiegel-herkunft-neu-vergeben-design.md
---

# ADR-0081: Eine neu vergebene ID ist am Spiegel eine neue Zeile und trägt den Schlüssel der gelöschten

## Regeln

- MUST: Legt eine Instanz außerhalb des Merkers `spiegel_uebernahme` eine Zeile einer gespiegelten
  Tabelle mit Ersatzschlüssel `id` an, fällt die Herkunft unter dieser ID; stand die ID im Log
  des Einsatzes, hält `spiegel_neu_vergeben` sie samt dem fremden Schlüssel der alten Zeile fest.
  Das trägt allein der Log-Trigger aus `instanz::spiegel::art::trigger_sql`.
- MUST NOT: Kein Schreibweg in Rust legt Zeilen in `spiegel_neu_vergeben` an.
- MUST: `fuehrung::gegen_hinaus` nennt für eine neu vergebene ID den fremden Schlüssel der
  gelöschten Zeile, solange keine Herkunft ihn einer anderen Zeile zuordnet.
- MUST: Nach einem Wechsel zum Spiegel gilt eine Zeile mit Merker in der Bruchstelle als dem
  Führer unbekannt, und ein `gegen` auf sie wird nicht übernommen.
- MUST: Ein Merker fällt beim Wechsel zum Spiegel erst, wenn der neue Führer den jüngsten Stand
  des Schlüssels im Log kennt.

## Prüfung

```sh
verlange 'INTO spiegel_neu_vergeben' src/instanz/spiegel/art.rs
verbiete 'INTO spiegel_neu_vergeben' 'src/**/*.rs' ':(exclude)src/instanz/spiegel/art.rs'
verlange 'n\.fremder_schluessel' src/instanz/spiegel/fuehrung.rs
verlange 'fn neu_vergeben\(' src/instanz/spiegel/fuehrung.rs
verlange 'fn trigger_passen_zur_beschreibung' src/instanz/spiegel/art.rs
```

## Kontext

Viele gespiegelte Tabellen haben `id INTEGER PRIMARY KEY` ohne `AUTOINCREMENT`; SQLite vergibt
die höchste gelöschte ID neu. Herkunft, Log (ein Eintrag je Schlüssel) und die Herkunft des
Gegenübers kennen Zeilen nur über diesen Schlüssel. Eine neue Zeile erbte so die Identität der
gelöschten und ging nach einem Rückfall still verloren (LLH-1893). Eine eigene Löschung für die
alte Zeile hätte zwei Zeilen mit demselben Schlüssel in einer Lieferung bedeutet.

## Konsequenzen

Die Abbildung der Zeilen bleibt ohne neue Protokollversion richtig: Beim Gegenüber ersetzt die
neue Zeile die gelöschte. Nach einem Rückfall steht eine neu vergebene Zeile, die das Gegenüber
schon hatte, aber nicht quittiert, zusätzlich in der Liste „nicht übernommen“ (Fehlalarm statt
Verlust). Eine ID, die in einem anderen Einsatz neu vergeben wird, deckt das nicht ab (LLH-2029).

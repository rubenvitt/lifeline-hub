---
id: ADR-0031
titel: Das Ende eines Einsatzes meldet eine Instanz nur mit Beleg; für Akten ohne Spiegel trägt ihn der Löschvermerk
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/instanz/fuehrung/loeschvermerk.rs
  - src/instanz/fuehrung/repo.rs
  - src/instanz/spiegel/lebensende.rs
  - src/instanz/spiegel/abgleich.rs
  - src/einsatz/abraeumen.rs
  - src/einsatz/skelett_loeschung.rs
herleitung:
  - openspec/changes/archive/2026-11-12-h7shm5au-loeschsignal-spiegellose-akten/design.md
  - LLH-1699 (Weg mit Ruben am 12.11.2026 abgestimmt)
---

# ADR-0031: Das Ende eines Einsatzes meldet eine Instanz nur mit Beleg; für Akten ohne Spiegel trägt ihn der Löschvermerk

## Regeln

- MUST: Wer einen Einsatz endgültig löscht oder abräumt, schreibt in derselben Transaktion den
  Löschvermerk seiner Kennung (`fuehrung::loeschvermerk::vermerken_einsatz`).
- MUST: Eine Führungsakte ohne lokalen Einsatz löscht nur `fuehrung::repo::delete_ohne_spiegel`;
  es schreibt den Vermerk.
- MUST: `geloescht` für eine genannte Akte meldet eine Instanz nur, wenn ein Löschvermerk oder,
  bei eigenem Präfix, das Löschprotokoll das Ende belegt und sie weder Einsatz noch Akte mit der
  Kennung hält (`lebensende::geloeschte_akten`).
- MUST NOT: Eine unbekannte Kennung gilt als gelöscht.
- MUST: Die erreichte Seite löscht eine Akte ohne Spiegel nur auf Meldung der Instanz, die die
  Akte als Führer nennt, und nennt ihr nur solche Akten.
- MUST NOT: Akten ohne Spiegel reisen als Stand mit Platzhalter in `staende`.

## Prüfung

```sh
verlange 'loeschvermerk::vermerken_einsatz\(' src/einsatz/abraeumen.rs
verlange 'loeschvermerk::vermerken_einsatz\(' src/einsatz/skelett_loeschung.rs
verlange 'fn geloeschte_akten\(' src/instanz/spiegel/lebensende.rs
verlange 'fn geloeschte_akten_uebernehmen\(' src/instanz/spiegel/lebensende.rs
verlange 'fn delete_ohne_spiegel\(' src/instanz/fuehrung/repo.rs
verbiete 'DELETE FROM einsatz_fuehrung ' src/instanz/spiegel/** src/einsatz/** src/routes/**
```

## Kontext

Eine Akte ohne lokalen Einsatz (beim Koppeln schon abgeschlossen, oder nur über den Hub bekannt)
erfuhr nie, dass ihr Einsatz gelöscht ist: `geloescht` galt nur genannten Ständen von Spiegeln,
und belegen ließ es sich nur über die Einsatz-ID im Löschprotokoll, also nur für Kennungen mit
eigenem Präfix. Der Hub konnte das Ende eines verwahrten Einsatzes mit der Kennung eines ELW
niemandem belegen, und eine zweite ELW hing ganz an ihm.

## Konsequenzen

Jede Instanz hält je Kennung fest, dass der Einsatz über sie nicht mehr zu haben ist, und reicht
das an weitere meldende Seiten derselben Org weiter. Eine aus einer Sicherung zurückgekehrte
Instanz löscht beim Gegenüber nichts. Löschungen von vor dem Vermerk mit fremdem Präfix bleiben
unbelegt. Der Weg über die Stände eines Spiegels bleibt, wie er war (LLH-1852).

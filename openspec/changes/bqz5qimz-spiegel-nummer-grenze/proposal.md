# Proposal

## Why

Ein Spiegel übernimmt `nummer_jahr` und `nummer_lfd` unverändert vom Führer, ohne Grenze. Eine
fehlerhafte oder kompromittierte gekoppelte Instanz kann so `nummer_lfd = i64::MAX` einschleusen
(LLH-1859, Zunder `bqz5qimz`, gefunden im Review zu LLH-1703). Die Nummernvergabe rechnet danach
ungeprüft `max + 1`: im Debug-Bau eine Panik (500 bei jeder Anlage), im Release ein Umlauf auf
`i64::MIN` und Nummern wie `E-2026--9223372036854775808`. Schlimmer als beschrieben: Die freie
Nummer beim Eigenwerden zählt über **alle** Einsätze des Jahres, auch fremde Spiegel. Ein einziger
solcher Spiegel reicht, damit jeder spätere Führungswechsel und jede Verwahrung des Jahres scheitert,
nicht erst, wenn genau dieser Spiegel eigen wird.

## What Changes

- **Die Zahlen eines Spiegelkopfs werden an der Übernahme geprüft (abgestimmt am 14.11.2026).**
  Gültig sind ein Jahr von 2000 bis 9999 und eine laufende Nummer von 1 bis 999.999, und nur beide
  zusammen. Liegt eine außerhalb, fehlt eine oder ist sie keine ganze Zahl, übernimmt der Spiegel
  beide Zahlen leer. Der Nummerntext bleibt, wie geliefert, sichtbar, am Spiegel steht ein Hinweis,
  und der Rest der Lieferung wird übernommen. Eine gekoppelte Instanz gilt damit für die Zahlen ihres
  Einsatzkopfs **nicht** als vertrauenswürdig.
- **Die Nummernvergabe läuft nicht mehr über.** Anlage und freie Nummer beim Eigenwerden rechnen
  die nächste laufende Nummer geprüft; ist sie nicht darstellbar, endet der Vorgang mit 422 statt
  mit Panik oder Umlauf. Das ist das Netz für Bestand, der vor dieser Änderung schon übernommen
  wurde.
- Verworfen: die ganze Lieferung ablehnen (friert das Lagebild des Spiegels wegen eines
  Nummernfelds ein) und dem Kopf vertrauen, nur mit geprüfter Addition (sperrt die Vergabe des
  Jahres dauerhaft). Begründung in `design.md`.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einsatznummer`: neue Anforderungen „Die Zahlen eines Spiegels liegen in festen Grenzen“ und
  „Die Vergabe läuft nicht über“.

## Impact

- Backend: `src/instanz/spiegel/uebernehmen.rs` (`kopf_uebernehmen`), `src/einsatz/repo.rs`
  (`anlegen_tx`), `src/instanz/spiegel/nummer.rs` (`ensure_freie_nummer`), die Grenzen in
  `src/einsatz/nummer.rs`.
- Keine Migration, kein Wire-Feld, keine Oberfläche: Der Hinweis erscheint über den bestehenden
  Hinweis am Spiegel.

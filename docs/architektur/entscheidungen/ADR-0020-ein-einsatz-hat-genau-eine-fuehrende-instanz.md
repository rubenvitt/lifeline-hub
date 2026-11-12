---
id: ADR-0020
titel: Ein Einsatz hat genau eine führende Instanz, und nur sie schreibt ihn
status: ersetzt
ersetzt_durch: ADR-0021
datum: 2026-11-09
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/einsatz/berechtigung.rs
  - src/einsatz/repo.rs
  - src/einsatz/kontext.rs
herleitung:
  - openspec/changes/archive/2026-11-09-v6hj7xl2-fuehrung-epoche/design.md
  - docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md
---

# ADR-0020: Ein Einsatz hat genau eine führende Instanz, und nur sie schreibt ihn

## Regeln

- MUST: Jeder Schreibweg an einem Einsatz geht über `berechtigung::fordere_aktiv` oder, in einer
  Transaktion, über `einsatz::repo::fordere_aktiv_in_tx`; beide lehnen mit 409 „Führung liegt bei
  …“ ab, wenn `einsatz.fuehrung_bei` gesetzt ist.
- MUST NOT: `einsatz.fuehrung_bei` schreibt nur `src/instanz/fuehrung/` (abgeleitet aus der Akte,
  beim Start neu ausgerichtet).
- MUST: Die Bedienung der Führung zieht `EinsatzFuehrungszugriff` (ohne `fordere_aktiv`), nie ein
  Schreib-Gate.
- MUST: Die meldende Seite nimmt eine Epoche des Gegenübers, die ihr die Führung nimmt, nur mit
  geprüftem Beweis an (Unterschrift eines gültigen Schlüssels der Org oder Abgabecode) und erst
  nach der Entscheidung eines Menschen; sonst verwirft sie sie und vergibt die nächste Epoche
  selbst.
- MUST: Epochen werden als Paar (Zähler, Instanzkennung) verglichen; das größere gilt.

## Prüfung

```sh
verlange 'fuehrung_bei' src/einsatz/berechtigung.rs
verlange 'SELECT status, fuehrung_bei FROM einsatz' src/einsatz/repo.rs
verbiete 'SET fuehrung_bei' 'src/**' ':(exclude,glob)src/instanz/fuehrung/**'
verlange 'pub struct EinsatzFuehrungszugriff' src/einsatz/kontext.rs
verlange 'pub fn entscheide\(' src/instanz/fuehrung/austausch.rs
verlange 'then_with\(\|\| self\.instanz\.cmp\(&other\.instanz\)\)' src/instanz/fuehrung/mod.rs
```

## Kontext

Gekoppelte Instanzen (ELW und Hub) arbeiten oft ohne Verbindung. Ein Zusammenführen paralleler
Schreibvorgänge gibt es nicht (Konzept, Entscheidung 2); stattdessen wandert die Führung mit
einer Epoche. Ein kompromittierter Hub darf sie einem ELW nicht nehmen können (Entscheidung 9).

## Konsequenzen

Eine Sperre an einer Stelle deckt alle Gates, Replay-Handler und Transaktionen. Wer einen neuen
Schreibweg baut, der nicht über diese Prüfungen geht, öffnet die Sperre still; der Wächter
erkennt das nicht. Inhalte der Einsätze fließen erst mit LLH-1492; bis dahin bleibt der Schalter
`LIFELINE_FUEHRUNG` aus.

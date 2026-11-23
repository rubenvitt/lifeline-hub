---
id: ADR-0093
titel: API-Routen sind englisch nach einem Glossar; Einsatz-Pakete ersetzen Bestandszeilen, bis das Präfix folgt
status: akzeptiert
datum: 2026-11-23
ersetzt: ADR-0085
gilt_fuer:
  - src/app.rs
  - src/public_api/**
  - src/routes/shell.rs
  - src-tauri/src/vertrag.rs
  - android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/LifelineKern.kt
  - scripts/api-routen-woerter.tsv
  - scripts/api-routen-bestand.txt
  - scripts/check-api-routen.sh
herleitung:
  - docs/superpowers/specs/2026-11-22-demuxo3r-api-routen-englisch-design.md
  - https://zunder.rubeen.dev/#/aufgabe/v5879ewmfddee4jl5fvaebhp
---

# ADR-0093: API-Routen sind englisch nach einem Glossar; Einsatz-Pakete ersetzen Bestandszeilen, bis das Präfix folgt

## Regeln

- MUST: Jedes feste Segment einer API-Route steht im Glossar `scripts/api-routen-woerter.tsv`,
  auch für Fachbegriffe; Form der Segmente: Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
- MUST: Ein deutscher Begriff hat im Glossar genau ein englisches Segment und umgekehrt.
- MUST NOT: `scripts/api-routen-bestand.txt` bekommt keine Zeile, die auf `alpha` fehlt. Einzige
  Ausnahme: eine Zeile, deren einziges Segment außerhalb des Glossars `einsaetze` ist, solange
  der Bestand dabei nicht mehr Zeilen hat als auf `alpha`.
- MUST: Bis 1.0.0 wird ein Pfad ohne Alias umbenannt; Backend, Frontend und Hüllen ziehen im
  selben PR um. Pfade unter `/api/v1/` erst, wenn eine ADR die Zusage von ADR-0022 ersetzt.
- MUST: Ab 1.0.0 bleibt ein umbenannter Pfad drei Major-Versionen lang als Alias erreichbar.
- MUST: Bricht eine Umbenennung einen Pfad, den eine Hülle fest aufruft, steigt
  `SHELL_CONTRACT` in `src/routes/shell.rs`, und die Hüllen kennen im selben PR nur noch die neue
  Nummer (iOS und Android `bekannteVertraege`, Desktop `BEKANNTE_VERTRAEGE`).

## Prüfung

```sh
verlange 'check-api-routen\.sh' scripts/check-all.sh
verlange '^api	' scripts/api-routen-woerter.tsv
verlange 'pub const SHELL_CONTRACT' src/routes/shell.rs
verlange 'einsaetze' scripts/check-api-routen.sh
```

## Kontext

ADR-0085 verbot jede neue Bestandszeile. Die Einsatz-Pakete von LLH-1979 übersetzen aber nur die
Segmente nach `/api/einsaetze/{id}/`; das Präfix `einsaetze` stellt erst das letzte Paket um. Ein
umbenannter Pfad wie `/api/einsaetze/{id}/damages` bleibt also deutsch und stünde als neue Zeile
im Bestand. Ruben hat am 23.11.2026 (LLH-2059) entschieden, genau diesen Rest zuzulassen.

## Konsequenzen

Der Wächter in Schritt 14 lässt weiter keine neue deutsche Route zu: ein neues deutsches Wort
unter `einsaetze` bleibt rot, ebenso ein Bestand, der wächst. Der Bestand schrumpft mit jedem
Paket von LLH-1979 bis auf null; nach dem Präfix-Paket greift die Ausnahme nicht mehr. Die
übrigen Folgen von ADR-0085 gelten unverändert.

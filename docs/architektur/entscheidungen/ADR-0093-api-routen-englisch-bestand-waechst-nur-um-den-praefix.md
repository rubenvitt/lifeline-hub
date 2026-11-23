---
id: ADR-0093
titel: API-Routen sind englisch nach einem Glossar; der deutsche Bestand wächst nur um Pfade, die allein noch das Präfix einsaetze tragen
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
  - https://zunder.rubeen.dev/#/aufgabe/zzahmyqlka1a1gwjnjft112e
---

# ADR-0093: API-Routen sind englisch nach einem Glossar; der deutsche Bestand wächst nur um Pfade, die allein noch das Präfix einsaetze tragen

## Regeln

- MUST: Jedes feste Segment einer API-Route steht im Glossar `scripts/api-routen-woerter.tsv`,
  auch für Fachbegriffe; Form der Segmente: Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
- MUST: Ein deutscher Begriff hat im Glossar genau ein englisches Segment und umgekehrt.
- MUST NOT: `scripts/api-routen-bestand.txt` bekommt keine Zeile, die auf `alpha` fehlt, außer
  einem Pfad, dessen einziges Segment außerhalb des Glossars `einsaetze` ist.
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
verlange '\$2 != "einsaetze"' scripts/check-api-routen.sh
```

## Kontext

ADR-0085 verbot jede Bestandszeile, die auf `alpha` fehlt. Die Pakete unter
`/api/einsaetze/{id}/` übersetzen nach dem Design-Doc aber erst die Segmente nach `{id}` und das
Präfix `einsaetze` zuletzt (LLH-2061); ihr umbenannter Pfad ist bis dahin noch deutsch und muss
im Bestand stehen. Ruben hat am 23.11.2026 bei LLH-2057 entschieden, genau diese Pfade
zuzulassen, statt nur die Zeilenzahl zu vergleichen.

## Konsequenzen

Die Pakete 9 bis 14 von LLH-1979 und neue Routen unter `/api/einsaetze/{id}/` kommen durch den
Wächter, solange alles nach dem Präfix englisch ist; jedes andere deutsche Segment bleibt rot.
Das Präfix-Paket leert den Bestand, danach greift die Ausnahme nicht mehr. Die übrigen Regeln
von ADR-0085 gelten unverändert weiter.

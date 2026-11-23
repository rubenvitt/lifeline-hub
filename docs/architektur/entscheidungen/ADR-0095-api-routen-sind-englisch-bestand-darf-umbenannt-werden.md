---
id: ADR-0095
titel: API-Routen sind englisch nach einem Glossar, bis 1.0 ohne Alias umbenannt
status: akzeptiert
ersetzt: ADR-0085
datum: 2026-11-23
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
---

# ADR-0095: API-Routen sind englisch nach einem Glossar, bis 1.0 ohne Alias umbenannt

## Regeln

- MUST: Jedes feste Segment einer API-Route steht im Glossar `scripts/api-routen-woerter.tsv`,
  auch für Fachbegriffe; Form der Segmente: Wurzel-`AGENTS.md`, „Bezeichner-Sprache“.
- MUST: Ein deutscher Begriff hat im Glossar genau ein englisches Segment und umgekehrt.
- MUST NOT: `scripts/api-routen-bestand.txt` hat mehr Zeilen als an der Merge-Base mit `alpha`.
- MUST: Eine Zeile des Bestands, die an der Merge-Base fehlt, übersetzt eine weggefallene: gleich
  viele Segmente, und jedes abweichende Segment steht im Glossar.
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
```

## Kontext

Ruben hat am 18.11.2026 entschieden, dass API-Routen englisch sind; bis dahin waren 567 von 597
Pfaden deutsch, und die Bezeichner-Sprache zählte Routen zu den Grenzwerten. Am 22.11.2026 hat er
festgelegt: auch Fachbegriffe, über ein Glossar; keine Ausnahme für `/api/v1` und die
Instanzkopplung, weil noch nichts veröffentlicht ist; harter Schnitt in der Alpha. Ersetzt ADR-0085,
deren Bestandsregel jede Umbenennung unter `/api/einsaetze/{id}/` vor dem Präfix-Paket verbot
(Ruben, 23.11.2026, LLH-2055; der Wächter prüfte schon so seit LLH-2060); eine Zeile darf jetzt
umbenannt werden, solange der Bestand nicht wächst und sie eine weggefallene übersetzt.

## Konsequenzen

Der Wächter in Schritt 14 lässt keine neue deutsche Route zu, und der Bestand schrumpft mit
jedem Paket von LLH-1979 bis auf null. Code-Bezeichner bleiben bei „Fachbegriffe deutsch“, eine
Route und ihr Handler heißen also verschieden. Offene Tabs mit altem Bundle, ältere Hüllen und
verschieden alte gekoppelte Instanzen sehen bis zum Update 404 oder „Hülle zu alt“. Die
Stabilitätszusage von ADR-0022 für `/api/v1` löst das Paket „Öffentliche API“ auf.

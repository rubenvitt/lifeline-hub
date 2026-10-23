---
id: ADR-0012
titel: Zeitpunkte reisen in UTC, angezeigt und eingegeben werden sie in der Anzeigezone
status: akzeptiert
datum: 2026-10-01
gilt_fuer:
  - src/zeit.rs
  - src/uhrzeit.rs
  - src/**/*.rs
  - frontend/src/anzeige/**
herleitung:
  - openspec/changes/archive/2026-10-01-lfh-692-zeiteingabe-anzeigezone/design.md
  - openspec/changes/archive/2026-10-04-lfh-895-ereigniszeit-serveruhr/design.md
  - openspec/specs/zeitdarstellung/spec.md
---

# ADR-0012: Zeitpunkte reisen in UTC, angezeigt und eingegeben werden sie in der Anzeigezone

## Regeln

- MUST: Ein Zeitpunkt steht in Datenbank und Wire als UTC im Format `zeit::FORMAT`
  (`%Y-%m-%d %H:%M:%S`, `src/zeit.rs`), ohne Zonenkennung.
- MUST NOT: der Server rechnet nicht in der Zone des Rechners (`chrono::Local`); einzige
  Ausnahme ist der Dateiname des Backup-Downloads (`src/routes/backup.rs`).
- MUST: Eine Uhrzeit ohne Datum ist kein Zeitpunkt; sie läuft als `HH:MM` über `src/uhrzeit.rs`
  und wird erst im Client auf einen Tag gelegt.
- MUST: Der Client zeigt und nimmt Zeitpunkte in der Anzeigezone aus den Konventionen von
  Organisation und Einsatz, nicht in der Zone des Browsers; nur `frontend/src/anzeige/` wandelt
  (`.local()`, Formatierung). Einzelregeln: `frontend/AGENTS.md`, „Zeiteingabe in der
  Anzeigezone“ und „Zeitdarstellung“, Specs `zeiteingabe` und `zeitdarstellung`.
- SHOULD: „Jetzt“ beim Erfassen kommt aus der Serveruhr (`frontend/src/offline/AGENTS.md`,
  „Schreiben ohne Netz“).

## Prüfung

```sh
verlange '^pub const FORMAT: &str = "%Y-%m-%d %H:%M:%S";' src/zeit.rs
verbiete 'Local::now|chrono::Local|chrono::\{([^}]*[ ,])?Local[ ,}]|DateTime<Local>' 'src/**/*.rs' ':(exclude)src/routes/backup.rs'
verbiete '\.local\(\)' 'frontend/src/**' ':(exclude,glob)frontend/src/anzeige/**' ':(exclude,glob)frontend/src/test/**' ':(exclude,glob)frontend/src/**/*.test.ts' ':(exclude,glob)frontend/src/**/*.test.tsx'
test -f frontend/src/anzeige/zeitDarstellung.guard.test.ts
test -f frontend/src/anzeige/zeitEingabe.guard.test.ts
```

## Kontext

Die Zeitspalten werden als Text sortiert; das trägt nur, wenn überall dasselbe Format in derselben
Zone steht. Geräte im Einsatz laufen in unterschiedlichen Zonen oder mit falscher Uhr, das
Einsatzgeschehen gehört aber zur Zone der Organisation. LFH-692 legte Anzeige und Eingabe in die
Anzeigezone, LFH-895 die Ereigniszeit auf die Serveruhr; die Schreibweise (DTG) entschied LLH-1045.

## Konsequenzen

Sortierung, Filter und Fristen rechnen im Server zonenfrei. Jede Anzeige braucht die
Konventionen von Organisation oder Einsatz, außerhalb eines Einsatzes über `OrgAnzeigeProvider`.
Die Gerätezeit bleibt nur für Uhr und Datenstand im Kopf; Tests stellen die Prozesszone gezielt
um (`frontend/src/test/prozessZone.ts`).

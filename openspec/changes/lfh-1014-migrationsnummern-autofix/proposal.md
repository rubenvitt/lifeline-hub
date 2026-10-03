# Proposal

## Why

Doppelte Migrationsnummern sind innerhalb von zwei Tagen zweimal auf `alpha` gelandet (0136 am
02.10., 0140 am 03.10.). Jedes Mal war `alpha` rot und mit ihm jeder offene PR, weil die
Rust-Suite auf dem Merge-Stand `migrationsnummern_sind_eindeutig` reißt. Die Ursache ist
gemessen: LFH-658 hat den Status `Migrationsnummern` gebaut, Aufgabe 5.3 (Eintrag als Required
Check ins Ruleset 17017911) ist aber offen geblieben. PR #367 war ab 07:10:40 UTC rot und wurde
um 07:12:15 trotzdem gemergt. Zusätzlich kostet jede Kollision einen Handgriff: jemand muss
`scripts/check-migrationen.sh --umnummerieren` auf dem Branch fahren und pushen.

## What Changes

- **Autofix auf dem PR-Branch:** Wird ein PR gegen `alpha`/`beta`/`main` wegen eines reinen
  Nummernkonflikts rot (keine geänderte, umbenannte oder gelöschte Bestandsmigration), legt
  `migrationen.yml` seine neuen Migrationen mit `--umnummerieren` auf die nächsten freien
  Nummern, committet das als Bot und pusht es auf den PR-Branch. Gepusht wird mit einem
  Token der Release-App, damit die CI auf dem neuen Kopf läuft. Ein Kommentar am PR nennt die
  Umbenennungen und erinnert lokale Sitzungen ans Pullen.
- **Nie auf einen Ziel-Branch:** Der Autofix schreibt ausschließlich auf den Kopf-Branch eines
  PRs aus diesem Repository, nur als Fast-Forward und nie auf `alpha`, `beta` oder `main`.
- **Pflicht-Status wird überwacht:** Der Push-Lauf auf dem Ziel-Branch prüft, ob
  `Migrationsnummern` dort als Required Check eingetragen ist, und meldet das Fehlen laut.
  Der Eintrag selbst wird nachgeholt (offene Aufgabe 5.3 aus LFH-658, nur Ruben kann
  Rulesets ändern).
- **D2 aus LFH-658 wird für den reaktiven Fall revidiert:** Ein Bot-Push auf den PR-Branch
  bleibt als Nummernvergabe beim Merge verworfen, ist aber als Reparatur nach einer
  festgestellten Kollision erlaubt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `migrationsvergabe`: neue Anforderung „Kollidierende PRs werden automatisch umnummeriert“;
  die Anforderung „Die Prüfung läuft gegen den aktuellen Ziel-Branch“ verlangt zusätzlich,
  dass der Status Pflicht ist und sein Fehlen gemeldet wird.

## Impact

- `.github/workflows/migrationen.yml` (beide Jobs), neues Skript
  `scripts/migrationen-autofix.sh` samt Selbsttest, `scripts/check-all.sh` (Selbsttest im
  Bündel `schnell`), `scripts/AGENTS.md` (Reihenfolge der Selbsttests).
- `AGENTS.md`, Abschnitt „Backend — Migrationsvergabe“: Autofix und Pflicht-Status.
- Release-App (`RELEASE_APP_ID`/`RELEASE_APP_PRIVATE_KEY`): bekommt eine zweite Aufgabe,
  braucht keine neuen Berechtigungen (Contents und Issues Read & Write hat sie schon).
- Ruleset 17017911: `Migrationsnummern` als Required Check ohne `integration_id` (Handgriff
  von Ruben).
- Keine Änderung an Migrationen, am Versionsschema oder an `src/`.

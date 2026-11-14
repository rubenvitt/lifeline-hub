# Proposal

## Why

Wird die erreichte Seite einer Kopplung (Hub) aus einer Sicherung zurückgespielt, verliert sie die
Unterschriftsschlüssel und Stammdaten-Zeilen, die sie nach der Sicherung angelegt und schon an die
meldende Seite (ELW) geliefert hatte. Am ELW bleiben sie stehen. Der Hub kennt sie nicht mehr und
schickt nie einen Widerruf oder eine Löschung (LLH-1871, abgetrennt aus LLH-1853):

- Ein verlorener Unterschriftsschlüssel bleibt am ELW gültig, und niemand kann ihn widerrufen. Das
  ist sicherheitsrelevant.
- Ein verlorenes Konto bleibt am ELW anmeldefähig. Eine verlorene Zeile bleibt dort „vom Hub“ und
  ist nur lesbar.

LLH-1853 sorgt dafür, dass **neue** Schlüssel, Widerrufe und Änderungen nach dem Zurückspielen den
ELW erreichen. Diese Change räumt den umgekehrten Rest ab, und zwar nach jedem Weg des
Zurückspielens (Befehl `restore`, Dateikopie, Snapshot) und unabhängig davon, wann der ELW sich
wieder meldet.

## What Changes

- **Bestand der Schlüssel in jeder Antwort.** Die erreichte Seite schickt mit jeder Antwort auf eine
  Meldung je Org die ids ihrer gültigen lokalen Unterschriftsschlüssel. Die meldende Seite widerruft
  jeden Schlüssel dieser Zuordnung, der dort gültig ist oder auf Bestätigung wartet und dessen id in
  der Liste fehlt. Das steht in der Admin-Spur und als Hinweis an der Kopplung.
- **Prüfsumme der Stammdaten in jeder Meldung.** Die meldende Seite meldet je Org, deren
  Stammdaten sie aus dieser Zuordnung bezieht, eine Prüfsumme über die Schlüssel der Zeilen, die sie
  von dort hat. Die erreichte Seite vergleicht sie mit ihrem aktuellen Bestand. Weichen beide ab und
  ist die meldende Seite auf aktuellem Stand, schickt sie die Liste ihrer Schlüssel je Art. Bei
  gleicher Prüfsumme geht die Liste höchstens alle 10 Minuten.
- **Abräumen an der meldenden Seite.** Was in der Liste fehlt, behandelt die meldende Seite wie eine
  gelieferte Löschung: löschen, eine verwendete Zeile stilllegen, ein Konto deaktivieren und seine
  Sitzungen beenden. Dazu kommt ein Hinweis an der Org-Zuordnung.
- Nur additive Felder in `MeldenAnfrage` und `MeldenAntwort`, kein Protokollsprung, keine Migration.
  Eine Gegenstelle älteren Stands schickt die neuen Felder nicht und liest sie nicht. Dann bleibt
  alles wie bisher.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `org-admin-unterschrift`: Neue Anforderung „Ein Schlüssel, den die Quelle nicht mehr führt, gilt
  nicht mehr“.
- `stammdaten-verteilung`: Neue Anforderung „Zeilen, die die Quelle nicht mehr führt, werden
  abgeräumt“.

## Impact

- `src/instanz/melden.rs`: neue Felder in `MeldenOrg` und `MeldenOrgAntwort`, Grenzen in
  `check_antwort`, Bestand und Liste in `handle_meldung`, Prüfsumme und Abräumen in
  `melden_einmal_mit`.
- `src/auth/unterschrift/repo.rs`: Bestand der gültigen lokalen ids und Widerruf der fehlenden.
- `src/instanz/stammdaten/`: Prüfsumme, Bestand je Art an der erreichten Seite, Abräumen über den
  Löschweg von `uebernehmen` und eine Sendebremse für die Liste.
- Tests: `tests/instanz_kopplung.rs`, `tests/instanz_stammdaten.rs`, Unit-Tests in den Modulen.
- Kein Frontend: Die Hinweise erscheinen an den bestehenden Stellen der Seite „Instanzkopplung“.

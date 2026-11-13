---
id: ADR-0039
titel: Stände der Unterschriftsschlüssel und des Stammdaten-Logs folgen der Uhr, ein Rückschritt zeigt sich am gemeldeten Stand
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/auth/unterschrift/repo.rs
  - src/instanz/stammdaten/liefern.rs
  - src/instanz/melden.rs
  - src/main.rs
herleitung:
  - openspec/changes/archive/2026-11-13-cz5332jn-unterschrift-stammdaten-nach-restore/design.md
---

# ADR-0039: Stände der Unterschriftsschlüssel und des Stammdaten-Logs folgen der Uhr, ein Rückschritt zeigt sich am gemeldeten Stand

## Regeln

- MUST: Den Stand eines lokalen Unterschriftsschlüssels vergibt nur `unterschrift::repo::next_stand`,
  und der vergibt `MAX(höchster Stand der Org + 1, Unix-Sekunden)`.
- MUST: Sonst setzt nur `unterschrift::repo::renew_stand_ueber` den Stand lokaler Schlüssel, gerufen
  allein aus `melden::handle_meldung`, wenn der gemeldete Stand einer Org über ihrem höchsten liegt
  und höchstens `STAND_RAISE_MAX` ist.
- MUST: `run_server` hebt nach den Migrationen den Zähler von `stammdaten_aenderung` per
  `liefern::raise_log_stand` auf die Unix-Sekunden.
- MUST: Log-Zeilen einer Org stempelt nur `liefern::renew_log_der_org` neu, gerufen allein aus
  `melden::handle_meldung` unter derselben Bedingung wie bei den Schlüsseln.
- MUST: Kommt unter einer bekannten `(kopplung_org_id, fremde_id)` ein anderer Schlüssel an, wird der
  alte widerrufen (ein abgelehnter bleibt abgelehnt) und gibt die id mit `fremde_id = -id` frei.
- MUST NOT: Einen Rückschritt nicht über einen Merker erkennen, den nur `restore` setzt; eine von Hand
  zurückkopierte Datei muss genauso abgefangen werden.

## Prüfung

```sh
verlange 'MAX\(COALESCE\(MAX\(stand\), 0\) \+ 1, \?\)' src/auth/unterschrift/repo.rs
verbiete 'unterschrift::renew_stand_ueber\(' 'src/**/*.rs' ':(exclude)src/instanz/melden.rs'
verlange 'raise_log_stand\(' src/main.rs
verbiete 'renew_log_der_org\(' 'src/**/*.rs' ':(exclude)src/instanz/stammdaten/liefern.rs' ':(exclude)src/instanz/stammdaten/liefern/tests.rs' ':(exclude)src/instanz/melden.rs'
verlange 'fremde_id = -id' src/auth/unterschrift/repo.rs
```

## Kontext

Nach dem Zurückspielen einer Sicherung am Hub lagen die Stände neuer Schlüssel, Widerrufe und
Stammdaten-Änderungen unter dem, was der ELW schon übernommen hatte. Sie gingen nie hinaus, ein
Widerruf auch nicht (LLH-1853). Dazu vergibt `unterschrift_schluessel` ohne AUTOINCREMENT die id
eines verlorenen Schlüssels neu. Das Muster folgt ADR-0031 der Führungsakten.

## Konsequenzen

Ein Rückschritt des Hubs heilt ohne Eingriff, solange die Uhr stimmt. Geht sie nach, erkennt der Hub
ihn am gemeldeten Stand und liefert Schlüssel bzw. Stammdaten der Org einmal ganz, mit Hinweis an der
Kopplung. Keine Migration, kein Protokollfeld. Was der Hub verlor und der ELW schon hat, bleibt dort
stehen (LLH-1871).

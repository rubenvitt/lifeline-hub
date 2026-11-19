---
id: ADR-0072
titel: Erfassen ohne Schreibrecht hat eigene Gate-Typen, die nur an einer Positivliste stehen
status: akzeptiert
datum: 2026-11-19
gilt_fuer:
  - src/einsatz/kontext.rs
  - src/einsatz/berechtigung.rs
  - tests/einsatz_kontext_guard.rs
herleitung:
  - docs/superpowers/specs/2026-11-19-yd9hmb6c-einsatzrolle-mitarbeit-design.md
---

# ADR-0072: Erfassen ohne Schreibrecht hat eigene Gate-Typen, die nur an einer Positivliste stehen

## Regeln

- MUST: `EinsatzErfassungszugriff` (Org-Floor, Erfassungsrecht, Modul, `fordere_aktiv`) und
  `EinsatzErfassungsfreigabe` (Org-Floor, Erfassungsrecht, Modul, `fordere_lesezugriff`) stehen
  nur an den Handlern der Positivliste im Design-Doc `herleitung`.
- MUST: Jeder andere schreibende Handler bleibt hinter `EinsatzSchreibzugriff` oder
  `EinsatzSchreibfreigabe`.
- MUST: Beide Typen stehen in `SANKTIONIERTE_GATES` (Regeln zu Gate-Typen: ADR-0005).
- MUST NOT: `EinsatzRolle::darf_schreiben` wird für Mitarbeit nicht wahr.

## Prüfung

```sh
verlange 'EinsatzErfassungszugriff' tests/einsatz_kontext_guard.rs
verlange 'EinsatzErfassungsfreigabe' tests/einsatz_kontext_guard.rs
verlange 'FromRequestParts<AppState> for EinsatzErfassungszugriff<M>' src/einsatz/kontext.rs
verlange 'FromRequestParts<AppState> for EinsatzErfassungsfreigabe<M>' src/einsatz/kontext.rs
verlange 'pub fn fordere_erfassungsrecht' src/einsatz/berechtigung.rs
```

## Kontext

Die Einsatzrolle Mitarbeit darf erfassen, aber nichts ändern. Das Schreibrecht
(`fordere_schreibrecht`) wäre zu weit, ein Prüfen im Handlerrumpf widerspräche ADR-0005.

## Konsequenzen

Das Erfassen bekommt eine Prüfung über die Signatur, spiegelbildlich zu den Schreib-Typen. Wer
einen Handler zur Positivliste hinzufügt, ändert das Design-Doc und damit eine bewusste
Entscheidung statt einer Nebenbei-Lockerung.

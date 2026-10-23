---
id: ADR-0005
titel: Einsatz-Autorisierung steckt in typisierten Extractoren, nicht im Handlerrumpf
status: akzeptiert
datum: 2026-07-11
gilt_fuer:
  - src/einsatz/kontext.rs
  - src/einsatz/berechtigung.rs
  - src/einsatz/modul.rs
  - src/routes/**
  - tests/einsatz_kontext_guard.rs
  - frontend/src/einsatz/schreibrecht.ts
herleitung:
  - docs/architektur-review-2026-07-11.html
  - docs/superpowers/specs/2026-07-19-lfh-227-live-kanal-modul-authz-design.md
---

# ADR-0005: Einsatz-Autorisierung steckt in typisierten Extractoren, nicht im Handlerrumpf

## Regeln

- MUST: Jeder Handler einer Route unter `/api/einsaetze/{id}/…` zieht genau einen
  sanktionierten Gate-Typ aus `src/einsatz/kontext.rs` (`EinsatzLesezugriff`,
  `EinsatzSchreibzugriff`, `EinsatzSchreibfreigabe`, `EinsatzLeitungszugriff`,
  `EinsatzVerwaltungszugriff`), mit dem Modul-Marker, der zum Pfad passt. Ausnahmen gibt es nur
  über `DEFERRED_MODULE` und `ORG_FLOOR_AUSNAHME` in `tests/einsatz_kontext_guard.rs`.
- MUST: Die Org-Grenze (`berechtigung::fordere_org_zugehoerigkeit`) prüft der Extractor, vor
  jedem Handlerrumpf.
- MUST NOT: kein neues Modul in `DEFERRED_MODULE` und kein `ORG_FLOOR_AUSNAHME`-Eintrag ohne
  Begründung (`tests/einsatz_kontext_guard.rs`).
- MUST: Ein neuer Gate-Typ kommt in `SANKTIONIERTE_GATES` desselben Wächters.
- SHOULD: Objekt-Zugehörigkeit (gehört das Kind zum Einsatz?) prüft der Handler oder das Repo
  zusätzlich; der Extractor prüft nur Einsatz, Rolle und Modul.
- SHOULD: Die Oberfläche leitet Schreibrechte nur über `frontend/src/einsatz/schreibrecht.ts`
  ab; sie blendet aus, entscheidet aber nichts.

## Prüfung

```sh
verlange 'impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzLesezugriff<M>' src/einsatz/kontext.rs
verlange 'impl<M: ModulMarker> FromRequestParts<AppState> for EinsatzSchreibzugriff<M>' src/einsatz/kontext.rs
verlange 'berechtigung::fordere_org_zugehoerigkeit' src/einsatz/kontext.rs
verlange '^const SANKTIONIERTE_GATES' tests/einsatz_kontext_guard.rs
# Die Liste der noch nicht umgestellten Module darf nur schrumpfen.
verlange '^const DEFERRED_MODULE: &\[&str\] = &\[("(befehl|lagebericht)"(, )?)*\];$' tests/einsatz_kontext_guard.rs
test -f frontend/src/einsatz/schreibrecht.guard.test.ts
```

## Kontext

Der Review vom 11.07.2026 zählte das handkopierte Vorspiel (Einsatz laden, Rolle bestimmen,
Gates prüfen) in rund 150 Handlern; eine vergessene Zeile war ein stiller Autorisierungsfehler
(F04), die Org-Grenze fehlte im Kern (F05). Die Gate-Typen (LFH-121, verschärft in LFH-230)
machen einen Handler ohne Prüfung unformulierbar, der Wächter liest Router und Signaturen.

## Konsequenzen

Ein neuer Endpunkt bekommt seine Prüfung über die Signatur, der Wächter macht ein fehlendes Gate
rot. Weil das Gate vor dem Body-Parse läuft, antwortet ein unberechtigter und zugleich kaputter
Request 403 statt 400. Die Module `befehl` und `lagebericht` prüfen noch im Rumpf
([Risiken](../11-risiken-und-technische-schulden.md)).

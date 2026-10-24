# Design

## Context

Den Ort eines Postens schreibt im Repo eine Funktion: `material::ort::set_ort_tx` (LLH-1224,
design.md D9). Über HTTP erreichen sie zwei Wege:

- die Material-Disposition: `PATCH /api/einsaetze/{id}/material/{em_id}` mit `einheit_id`,
  `einsatz_fahrzeug_id`, `uhs_id` oder `br_id`, dazu Disponieren und Aufteilen mit Ort-Feld.
  Gate `EinsatzSchreibzugriff<Material>`.
- die Einheiten-Routen `PUT`/`DELETE /api/einsaetze/{id}/einheiten/{eid}/material/{em_id}`
  (`material_zuordnen`, `material_freigeben`, gemeinsamer Helfer `set_material_ort` in
  `src/routes/einsatz_einheit.rs`). Gate `EinsatzSchreibzugriff<Einheiten>`. Der Helfer schreibt
  den ETB-Eintrag und die Live-Meldungen ein zweites Mal selbst.

Befund der Prüfung (Auftrag LLH-1253, „brauchen Geräte, API-Nutzer oder Tests sie?“):

- **Client:** kein Aufrufer. `frontend/src/api/einsatzMaterial.ts` hält das fest, drei
  Vitest-Dateien belegen es mit Wächtern.
- **Geräte:** Gekoppelte Geräte laufen in derselben Oberfläche (`frontend/src/geraet/`) und
  rufen die Route nicht. Die Desktop-Hülle hat keinen eigenen API-Code.
- **OpenAPI und Typen:** Die Routen stehen nicht in `src/api_doc.rs`, sie haben weder Body noch
  Antwort-DTO. Typ-Codegen bleibt ohne Diff.
- **Tests:** Fünf Backend-Tests und zwei e2e-Specs nutzen die Route, fast immer nur als
  Vorbereitung („Posten an die Einheit“).
- **Specs:** Die Einheiten-Route verstößt gegen `material-am-ort` („Rechte für Material am Ort“:
  Freigabe Material, nicht das Recht des Ort-Moduls) und mit dem 404 beim Lösen eines fremden
  Orts gegen `material-modell` („Ort setzen und lösen“).

## Goals / Non-Goals

**Goals:**

- Ein HTTP-Weg mit einem Rechte-Modell für den Ort eines Postens.
- Kein doppelter ETB- und Live-Code für denselben Ortswechsel.
- Testabdeckung bleibt erhalten: was ein Test bisher über die Einheiten-Route belegte, belegt er
  danach über den PATCH, sofern kein PATCH-Test es schon tut.

**Non-Goals:**

- Das Lösen am Ende eines Orts (Fahrzeug entlassen, UHS oder Einheit aufgelöst) bleibt, wie es
  ist. Diese Massen-Anweisungen in `fahrzeug/disposition_repo.rs` und den Repos der Orte sind
  Folge des Lebensendes des Orts (Spec `material-modell`, „Ende eines Orts“), kein Schreibweg,
  den jemand aufruft.
- Personal- und Fahrzeug-Routen der Einheit (`…/einheiten/{eid}/personal|fahrzeug/…`) bleiben.
  Sie schreiben keinen Material-Ort.
- Die Vitest-Wächter, die belegen, dass der Client die Route nicht ruft, bleiben stehen. Sie
  kosten nichts und fangen einen Rückfall im Client.

## Decisions

### D1 Entfernen statt umleiten

Die Routen entfallen ersatzlos.

- *Behalten, wie sie sind* (sie laufen ja schon über `set_ort_tx`): verworfen. Die
  Rechte-Abweichung zur Spec bliebe, und ETB-Text und Live-Meldungen müssten an zwei Stellen
  gleich bleiben.
- *Behalten mit dem Gate `EinsatzSchreibzugriff<Material>`*: verworfen. ADR-0005 verlangt den
  Modul-Marker, der zum Pfad passt. Ein Material-Gate unter `/einheiten/…` bräuchte eine
  Ausnahme im Wächter `tests/einsatz_kontext_guard.rs`, und das für eine Route ohne Aufrufer.
- *Auf den PATCH-Handler weiterleiten*: verworfen. Das wäre derselbe Pfad-Marker-Konflikt mit
  mehr Code und ohne Nutzen.

### D2 404 ohne Übergangsphase

Nach dem Entfernen antwortet axum auf den Pfad mit 404 (kein Treffer im Router, Fallback auf die
API-404). Ein 410 oder eine Phase mit Warnkopf gibt es nicht: Server und Oberfläche werden
zusammen ausgeliefert (ADR-0001, Frontend per `rust-embed` im Binary), ein älterer Client mit
Aufrufer existiert nicht, und ein externer API-Nutzer ist nicht bekannt.

### D3 Tests umstellen, nicht nur löschen

- Vorbereitungen („Posten an die Einheit“) gehen über
  `PATCH …/material/{em}` mit `{"einheit_id": eid}`: `tests/einsatz_einheit.rs` (Listenabruf,
  `material_umhaengen_nennt_die_alte_einheit`), `tests/einsatz_material.rs` (Helfer
  `in_einheit`, Live-Event-Test LFH-66, `material_einheit_zuordnen_freigeben_und_aufloesen`,
  dort das Lösen über `{"einheit_id": null}`), beide e2e-Specs.
- `material_umhaengen_nennt_die_alte_einheit` belegt die Spec `material-liste` („Umhängen
  nennt die alte Einheit“) und bleibt als PATCH-Test, weil er den ETB-Wortlaut mit zwei
  Einheiten, die Live-Meldung beider Einheiten und den 409 an einer aufgelösten Zieleinheit
  zusammen prüft.
- In der Schleife „beendeter Posten ist 409“ wird der `PUT`-Eintrag ein `PATCH` mit
  `einheit_id`. Ein reiner Menge-PATCH steht schon davor, der Ort-PATCH prüft den zweiten Fall.
- `fremde_em_id_an_einheit_ist_404` entfällt, wenn ein PATCH-Test die unbekannte `em_id` mit
  404 schon belegt. Sonst wird er ein PATCH-Test.
- Neu: ein Test je Scenario der Delta-Spec, in `tests/einsatz_material.rs`. Die frühere Route
  antwortet 404, ohne zu schreiben. Mit ausgeblendetem Modul Material (`modul-overrides`) kommt
  eine Person auf keinem Weg an den Ort. Der erste Test ist vor dem Entfernen rot (heute 204),
  das ist der TDD-Einstieg.

### D4 Kommentare nachziehen

Der Hinweis in `frontend/src/api/einsatzMaterial.ts` sagt danach, dass es die Einheiten-Routen
nicht mehr gibt (LLH-1253). Weitere Verweise auf `material_zuordnen`/`material_freigeben` gibt
es nur in `docs/superpowers/plans/`, eingefrorenes Archiv, unverändert.

## Risks / Trade-offs

- [Ein unbekannter externer Skript-Nutzer ruft die Route] → Er bekommt 404 und muss auf den
  PATCH umstellen. Der Weg steht im Proposal unter „What Changes“. Bei einem selbst gehosteten
  System ohne öffentliche API-Zusage ist das Risiko klein.
- [Ein Test verliert beim Umstellen still eine Prüfung] → Jede Umstellung behält die Asserts.
  Entfallen darf nur ein Test, dessen Prüfung ein PATCH-Test nachweislich trägt (D3).

---
id: ADR-0031
titel: Ein Maschinenzugang liest einsatzbezogen nur, was die Einsatzleitung für ihn freigegeben hat
status: akzeptiert
datum: 2026-11-12
gilt_fuer:
  - src/public_api/**
  - src/routes/einsatz_anbindungen.rs
  - src/routes/leitung_freigabe.rs
herleitung:
  - openspec/changes/f658d8o6-lage-fuer-maschinenzugaenge/design.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
---

# ADR-0031: Ein Maschinenzugang liest einsatzbezogen nur, was die Einsatzleitung für ihn freigegeben hat

## Regeln

- MUST: Eine Route unter `/api/v1/` mit einem Lese-Scope mit Einsatzbezug
  (`Scope::has_einsatzbezug`) bestimmt ihren Einsatz allein über `public_api::freigabe`, nie aus
  Pfad, Abfrage oder Org des Zugangs.
- MUST: Ein neuer Lese-Scope mit Einsatzbezug steht in `Scope::has_einsatzbezug`, sobald seine
  Route steht.
- MUST: Freigeben und Beenden darf nur die Einsatzleitung des Einsatzes, an einem aktiven
  Einsatz; Admin-Rechte ersetzen die Rolle nicht.
- MUST: Wirksam ist eine Freigabe nur an einem aktiven, nicht gelöschten Einsatz. Sie endet
  außerdem mit Widerruf oder Ablauf des Zugangs und mit dem Entzug seines letzten Lese-Scopes mit
  Einsatzbezug.
- MUST: Die Freigabe gilt an der Instanz, an der der Zugang angelegt ist. Ihre Tabelle steht in
  `instanz::spiegel::art::AUSGENOMMEN`.
- MUST: Die Freigabe geht auch an einem Einsatz, den die Instanz als Spiegel hält; der Eintrag
  im Einsatztagebuch geht dann als Antrag an den Führer (`routes::leitung_freigabe`).
- MUST: Ohne Freigabe antwortet `GET /api/v1/lage` mit 200 und `einsatz: null`.
- MUST NOT: Ein Fremdsystem liest Einsatzdaten über einen Schlüssel im Kopf `Authorization:
  Bearer`; den früheren Weg `llh_lm_` gibt es nicht mehr. Der Lagebild-Link für Menschen
  (`llh_lb_`) ist davon nicht berührt.
- SHOULD: Je Zugang ist höchstens ein Einsatz freigegeben (eindeutiger Index auf `zugang_id`).

## Prüfung

```sh
verlange 'fn has_einsatzbezug' src/public_api/scope.rs
verlange 'freigabe::freigegebener_einsatz' src/public_api/lage.rs
verlange '"maschinenzugang_freigabe"' src/instanz/spiegel/art.rs
verlange 'fordere_freigabe_moeglich' src/routes/einsatz_anbindungen.rs
verbiete 'LagemonitorZugriff' 'src/**/*.rs'
verbiete '/api/lagemonitor/v1' src/app.rs
```

## Kontext

ADR-0022 verlangt für einsatzbezogenes Lesen die Freigabe der Einsatzleitung, ließ ihre Form aber
offen. Bis November 2026 trug sie ein eigener Bearer-Weg für Lagemonitore (LLH-1484), der an
einem Spiegel scheiterte, weil er einen Systemeintrag ins ETB schrieb. Fremdsysteme kommen am Hub
an, und ein vom ELW geführter Einsatz liegt dort als Spiegel. Ruben hat am 12.11.2026 entschieden:
ein Einsatz je Zugang, Freigabe auf der Seite „Geräte“, der Bearer-Weg entfällt ohne Übergang.

## Konsequenzen

Jede weitere Leseroute mit Einsatzbezug (LLH-1655) nutzt dieselbe Tabelle und dieselbe Bedienung;
mehrere Einsätze je Zugang brauchen nur den Wegfall des Index. Ein Widerruf durch den Admin steht
an einem Spiegel nicht im ETB, nur in der Admin-Spur. Am Spiegel sind die Zahlen so alt wie der
letzte Abgleich; die Antwort nennt ihn.

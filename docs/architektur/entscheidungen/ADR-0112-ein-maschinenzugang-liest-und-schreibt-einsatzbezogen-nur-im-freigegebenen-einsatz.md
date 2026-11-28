---
id: ADR-0112
titel: Ein Maschinenzugang liest und schreibt einsatzbezogen nur im Einsatz, den die Einsatzleitung für ihn freigegeben hat
status: akzeptiert
datum: 2026-11-28
gilt_fuer:
  - src/public_api/**
  - src/routes/einsatz_anbindungen.rs
  - src/routes/leitung_freigabe.rs
  - src/routes/meldung_vorschlag.rs
ersetzt: ADR-0035
herleitung:
  - docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md
  - openspec/changes/archive/2026-11-12-f658d8o6-lage-fuer-maschinenzugaenge/design.md
---

# ADR-0112: Ein Maschinenzugang liest und schreibt einsatzbezogen nur im Einsatz, den die Einsatzleitung für ihn freigegeben hat

## Regeln

- MUST: Eine Route unter `/api/v1/` mit einem Scope mit Einsatzbezug (`Scope::has_einsatzbezug`),
  lesend oder schreibend, bestimmt ihren Einsatz allein über `public_api::freigabe`, nie aus Pfad,
  Abfrage, Body oder Org des Zugangs. Ohne wirksame Freigabe lehnt eine Schreibroute ab und legt
  nichts an.
- MUST: Ein neuer Scope mit Einsatzbezug steht in `Scope::has_einsatzbezug`, sobald seine Route
  steht.
- MUST: Freigeben und Beenden darf nur die Einsatzleitung des Einsatzes, an einem aktiven
  Einsatz; Admin-Rechte ersetzen die Rolle nicht.
- MUST: Wirksam ist eine Freigabe nur an einem aktiven, nicht gelöschten Einsatz. Sie endet
  außerdem mit Widerruf oder Ablauf des Zugangs und mit dem Entzug seines letzten Scopes mit
  Einsatzbezug.
- MUST: Die Freigabe gilt an der Instanz, an der der Zugang angelegt ist. Ihre Tabelle steht in
  `instanz::spiegel::art::AUSGENOMMEN`.
- MUST: Die Freigabe eines Zugangs mit Lese-Scope geht auch an einem Einsatz, den die Instanz als
  Spiegel hält; der Eintrag im Einsatztagebuch geht dann als Antrag an den Führer
  (`routes::leitung_freigabe`).
- MUST: Ohne Freigabe antwortet `GET /api/v1/situation` mit 200 und `einsatz: null`.
- MUST: Ein Maschinenzugang legt keine Meldung und keinen ETB-Eintrag an. Was er mit
  `meldungen:write` liefert, ist ein Vorschlag (`meldung_vorschlag`); erst ein Mensch macht daraus
  eine Meldung. Für einen Vorschlag gibt es keinen Sofortalarm und keine Benachrichtigung.
- MUST: Übernehmen und Verwerfen eines Vorschlags stehen hinter `EinsatzSchreibzugriff`; sie
  stehen nicht auf der Positivliste von ADR-0072, die Rolle Mitarbeit darf sie also nicht. Geräte
  sehen keinen Vorschlag.
- MUST: Eine Instanz, die sich für die Org bei einem Hub meldet, legt Maschinenzugänge nur an,
  nimmt ihre Anfragen nur an und gibt sie nur frei, wenn ihre Scopes genau `meldungen:write` sind
  (`scope::is_nur_meldungen`), und nur für einen Einsatz, den sie selbst führt: an einem Spiegel
  antwortet die Schreibroute mit 409 `fuehrung_elsewhere`. Jeder andere Zugang bleibt dort
  abgelehnt (`instanz_gekoppelt`), auch ein früher angelegter.
- MUST NOT: Ein Fremdsystem liest Einsatzdaten über einen Schlüssel im Kopf `Authorization:
  Bearer`; den Weg `llh_lm_` gibt es nicht mehr (der Lagebild-Link `llh_lb_` ist nicht berührt).
- SHOULD: Je Zugang ist höchstens ein Einsatz freigegeben (eindeutiger Index auf `zugang_id`).

## Prüfung

```sh
verlange 'fn has_einsatzbezug' src/public_api/scope.rs
verlange 'Scope::MeldungenWrite' src/public_api/scope.rs
verlange 'freigabe::freigegebener_einsatz' src/public_api/lage.rs
verlange '"maschinenzugang_freigabe"' src/instanz/spiegel/art.rs
verlange '"meldung_vorschlag"' src/instanz/spiegel/art.rs
verlange 'fordere_freigabe_moeglich' src/routes/einsatz_anbindungen.rs
verbiete 'LagemonitorZugriff' 'src/**/*.rs'
verbiete '/api/lagemonitor/v1' src/app.rs
```

## Kontext

ADR-0035 sprach nur von Lese-Scopes und ließ einen Maschinenzugang nichts schreiben. Mesh-Gateways
und andere Funkbrücken liefern unverifizierten Kurztext, der im Meldungseingang landen soll, ohne
dass ein Fremdsystem eine Meldung anlegt (Entscheidung Ruben 28.11.2026, LLH-2112). Das Gateway
steht oft am ELW, der an einen Hub gekoppelt ist und bis dahin keine Fremdsysteme annahm; die
Ausnahme ist deshalb auf den einen Scope und auf selbst geführte Einsätze begrenzt.

## Konsequenzen

Jede weitere Schreibroute mit Einsatzbezug nutzt dieselbe Freigabe und Bedienung; ein zweiter
Schreib-Scope am gekoppelten ELW bräuchte eine neue Entscheidung. Ein Vorschlag kostet die
Besetzung einen Handgriff, hält aber ungeprüften Text aus dem Einsatztagebuch.

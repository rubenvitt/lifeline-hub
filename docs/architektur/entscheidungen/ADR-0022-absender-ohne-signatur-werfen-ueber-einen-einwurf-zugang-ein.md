---
id: ADR-0022
titel: Absender ohne Signatur werfen über einen Einwurf-Zugang ein, der nur schreibt
status: vorgeschlagen
datum: 2026-11-11
gilt_fuer:
  - src/app.rs
  - src/auth/rate_limit.rs
herleitung:
  - docs/konzepte/2026-11-11-oeffentliche-api.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0022: Absender ohne Signatur werfen über einen Einwurf-Zugang ein, der nur schreibt

## Regeln

- MUST: Ein Einwurf-Zugang ist die einzige Ausnahme zu ADR-0014 und ADR-0021; er gilt nur unter
  `/api/v1/einwurf/<schluessel>/…`.
- MUST: Der Schlüssel hat das Präfix `llh_ew_` und 32 Zufallsbytes; gespeichert wird nur sein
  SHA-256.
- MUST: Ein Einwurf schreibt nur in die Ablage seines Zwecks (Alarmmeldung oder Position) und nur
  für seine Org; er legt keinen Einsatz an und ändert keinen.
- MUST NOT: Ein Einwurf liest etwas; die Antwort trägt außer Status und Fehler keine Daten.
- MUST: Der Pfadabschnitt nach `/einwurf/` erscheint in keinem Protokoll; `pfad_fuer_protokoll`
  maskiert ihn.
- MUST: Jeder Einwurf-Zugang ist gedrosselt; ein unbekannter Schlüssel zählt in die IP-Sperre.
- MUST: Anlegen und Widerruf stehen in `admin_audit`; ein Widerruf wirkt sofort.
- SHOULD: Ein Absender, der signieren kann, bekommt einen Maschinenzugang nach ADR-0021 statt
  eines Einwurfs.

## Prüfung

```sh
verlange '/api/v1/einwurf/' src/app.rs
verlange 'llh_ew_' 'src/einwurf/**'
```

## Kontext

BOSWatch 3 ruft nur URLs mit Platzhaltern auf, FE2 „URL öffnen“, der Divera-Webhook und OsmAnd
können nicht signieren. Ruben hat am 10.11.2026 (E1, Schnittstellen-Ausbau) einen Zugang mit
geheimem Schlüssel im Pfad entschieden, der nur in eine Ablage schreibt. Der Schnittstellen-Ausbau
nannte ihn ADR-0015; die Nummer war vergeben.

## Konsequenzen

Wer den Schlüssel kennt, kann Vorschläge einwerfen, aber nichts lesen und nichts anlegen; ein
Mensch entscheidet weiter (G1). Der Schlüssel steht in Konfigurationen beim Kunden und in
Proxy-Protokollen; die Betriebsdoku verlangt Maskierung dort, Widerruf und Wechsel sind der Weg
nach einem Leck.

---
id: ADR-0023
titel: Absender ohne Signatur werfen über einen Einwurf-Zugang ein, der nur schreibt
status: akzeptiert
datum: 2026-11-11
gilt_fuer:
  - src/public_api/einwurf/**
  - src/routes/einwurf_zugaenge.rs
  - src/app.rs
  - src/extract.rs
  - src/auth/rate_limit.rs
herleitung:
  - openspec/changes/archive/2026-11-13-s1i56dpt-einwurf-zugang/design.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0023: Absender ohne Signatur werfen über einen Einwurf-Zugang ein, der nur schreibt

## Regeln

- MUST: Ein Einwurf-Zugang ist die einzige Anmeldung unter `/api/v1/` ohne Schlüsselpaar; er gilt
  nur unter `/api/v1/einwurf/<key>/…`.
- MUST: Der Schlüssel hat das Präfix `llh_ew_` und 32 Zufallsbytes; gespeichert wird nur sein
  SHA-256. Er ist widerrufbar, wechselbar und kann ablaufen; Widerruf und Wechsel wirken sofort.
- MUST: Ein Einwurf schreibt nur in die Ablage seines Scopes (`alarmmeldungen:write` oder
  `positionen:write`) und nur für seine Org; er legt keinen Einsatz an und ändert keinen.
- MUST NOT: Ein Einwurf liest etwas; die Antwort trägt außer Status und Fehler keine Daten.
- MUST: Eine eingeworfene Alarmmeldung wird roh abgelegt. Dieselbe `message_id` zur selben
  `external_id` ist dauerhaft eine Wiederholung, ebenso derselbe Inhalt zur selben `external_id`.
  Ohne Kennung gilt gleicher Inhalt desselben Zugangs höchstens 2 Minuten nach dem letzten
  Empfang als Wiederholung; später ergibt er einen neuen Eintrag mit Verweis auf den früheren.
  Eine Wiederholung wird am bestehenden Eintrag vermerkt. Still verworfen wird keine.
- MUST: Eine eingeworfene Position ersetzt nur die letzte Position ihrer Kennung, ohne Verlauf;
  eine mit älterem Zeitstempel als die gespeicherte wird nicht übernommen.
- MUST: Ein Einwurf wird nur über TLS angenommen (`--tls`, oder jeder Wert von
  `X-Forwarded-Proto` ist `https` und die Gegenstelle steht in `--trusted-proxies`), sonst 403;
  Ausnahme nur per ausdrücklichem Schalter des Betreibers.
- MUST: Antworten auf Einwürfe tragen `Cache-Control: no-store`.
- MUST: Der Pfadabschnitt nach `/einwurf/` erscheint in keinem Protokoll; `pfad_fuer_protokoll`
  maskiert ihn.
- MUST: Jeder Einwurf-Zugang ist gedrosselt, und die Ablage hat Obergrenzen je Zugang; ein
  unbekannter Schlüssel zählt im Zähler für Maschinen je IP, nicht in der Anmeldesperre. Ein
  widerrufener, abgelaufener oder durch einen Wechsel abgelöster Schlüssel zählt nicht.
- MUST: Eine Antwort unterscheidet eine neue Meldung nicht von einer Wiederholung, auch nicht an
  einer Obergrenze. (Mittelbar bleibt es am Zähler der Tagesgrenze ablesbar; siehe Konsequenzen.)
- MUST: Anlegen, Wechsel und Widerruf stehen in `admin_audit`, nie mit Schlüssel oder Hash.
- SHOULD: Ein Absender, der signieren kann, bekommt einen Zugang nach ADR-0022, und einer, der POST
  kann, nimmt POST statt GET.

## Prüfung

```sh
verlange 'einwurf::maskiere_pfad' src/app.rs
verlange 'SCHLUESSEL_PRAEFIX: &str = "llh_ew_"' src/public_api/einwurf/mod.rs
verlange 'is_tls_nachgewiesen' src/public_api/einwurf/routen.rs
verlange 'rate_limit::maschine::fehlversuch' src/public_api/einwurf/routen.rs
verlange 'is_abgeloest' src/public_api/einwurf/routen.rs
# Kein Logfeld trägt Schlüssel, Hash, Pfad, Abfrage oder Inhalt (Einzeiler und umbrochen).
verbiete 'tracing::' src/public_api/einwurf/mod.rs src/public_api/einwurf/ablage.rs
verbiete 'tracing::[a-z]+!\(.*[%?( ](schluessel|hash|pfad|uri|abfrage|query|rohdaten|body|inhalt)[ ,=)]' src/public_api/einwurf/routen.rs
verbiete '^ *[%?]?(schluessel|hash|pfad|uri|abfrage|query|rohdaten|body|inhalt)( =|,$)' src/public_api/einwurf/routen.rs
```

## Kontext

BOSWatch 3 ruft nur URLs mit Platzhaltern auf; FE2 „URL öffnen“, der Divera-Webhook und OsmAnd
können nicht signieren. Ruben hat am 10.11.2026 (E1, Schnittstellen-Ausbau) einen Zugang mit
geheimem Schlüssel im Pfad entschieden, der nur in eine Ablage schreibt. Der Schnittstellen-Ausbau
nannte ihn ADR-0015; die Nummer war vergeben. Angenommen mit der Umsetzung (LLH-1654, 12.11.2026).

## Konsequenzen

Wer den Schlüssel kennt, kann in die Ablage einwerfen, aber nichts lesen und nichts anlegen; ein
Mensch entscheidet weiter (G1). Schlüssel und bei GET auch der Alarmtext stehen in der URL; die
Betriebsdoku verlangt, dass der Reverse-Proxy dort nichts protokolliert. Die Ablage hält
Positionen auch außerhalb eines Einsatzes, aber nur die letzte je Kennung und höchstens 24
Stunden. Wer den Schlüssel hat und die Tagesgrenze ausreizt, erkennt am nächsten Einwurf, ob der
vorige gezählt wurde. ADR-0014 verlangte für jede Maschine ein Schlüsselpaar; ADR-0031 ersetzt sie und nennt
den Einwurf als Ausnahme.

---
id: ADR-0031
titel: Maschinen weisen sich mit eigenem Schlüsselpaar und signierten Anfragen aus, außer beim Einwurf
status: akzeptiert
datum: 2026-11-12
ersetzt: ADR-0014
gilt_fuer:
  - src/instanz/**
  - src/routes/instanz.rs
  - src/auth/unterschrift/**
  - src/public_api/einwurf/**
herleitung:
  - openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md
  - openspec/changes/s1i56dpt-einwurf-zugang/design.md
  - docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md
  - docs/konzepte/2026-11-11-oeffentliche-api.md
---

# ADR-0031: Maschinen weisen sich mit eigenem Schlüsselpaar und signierten Anfragen aus, außer beim Einwurf

## Regeln

- MUST: Eine Maschine (gekoppelte Instanz, Fremdsystem nach ADR-0022) hat ein eigenes
  Ed25519-Schlüsselpaar; der Server speichert vom Gegenüber nur den öffentlichen Schlüssel.
- MUST: Jede Anfrage trägt ein kurzlebiges kompaktes JWS (`alg` EdDSA, höchstens 60 s) mit
  `iss`, `aud`, `jti`, `htm`, `htu` und dem Hash des Bodys `bh`; jede Antwort ist ebenso signiert
  und nennt die `jti` der Anfrage (`src/instanz/signatur.rs`).
- MUST NOT: Ein anderer `alg` als EdDSA wird angenommen, auch nicht `none`.
- MUST: Geprüft wird in einem Extractor vor dem Handler (`src/instanz/extractor.rs`); der
  Wiederholschutz über `jti` liegt in der DB, nicht im Prozessspeicher.
- MUST: Der Einstieg geschieht per Einmal-Code eines Org-Admins, aus dem beide Seiten Prüfwerte
  über ihre öffentlichen Schlüssel ableiten (`src/instanz/code.rs`); der Code selbst geht nie über
  die Leitung.
- MUST NOT: Routen unter `/api/instanz/` nehmen ein geteiltes Geheimnis oder ein Bearer-Token als
  Anmeldung einer Maschine an.
- MUST: Einzige Ausnahme vom Schlüsselpaar ist der Einwurf nach ADR-0023: ein Schlüssel im Pfad,
  nur unter `/api/v1/einwurf/`, nur schreibend und nur über TLS.
- MUST NOT: Ein Einwurf-Schlüssel gilt an einer anderen Route als Anmeldung, und er steht nie in
  einem Kopf.
- SHOULD: Eine weitere Ausnahme bekommt eine eigene ADR, die diese ersetzt, statt eine Route
  still mit einem Geheimnis zu öffnen.

## Prüfung

```sh
verlange 'kopf\.alg != "EdDSA"' src/instanz/signatur.rs
verlange 'LEBENSDAUER_S: i64 = 60' src/instanz/signatur.rs
verlange 'remember_jti' src/instanz/extractor.rs
verlange 'impl FromRequest<AppState> for GekoppelteInstanz' src/instanz/extractor.rs
verbiete '[Bb]earer' 'src/instanz/**' src/routes/instanz.rs
verbiete 'AUTHORIZATION|[Bb]earer' 'src/public_api/einwurf/**'
```

## Kontext

ADR-0014 legte am 08.11.2026 fest, dass jede Maschine ein Schlüsselpaar hat und jede Anfrage
signiert: das Verfahren nach dem Muster DPoP/`private_key_jwt`, das ohne gemeinsames Geheimnis
auskommt, Wiederholungen erkennt und auch dann trägt, wenn TLS unterwandert ist. BOSWatch, FE2 mit
„URL öffnen“, der Divera-Webhook und OsmAnd können aber nicht signieren. Mit ADR-0023 gibt es für
sie den Einwurf; diese ADR übernimmt die Regeln von ADR-0014 unverändert und nennt die Ausnahme.

## Konsequenzen

Jede Maschine braucht weiter einen Schlüssel und eine Uhr, die höchstens fünf Minuten abweicht.
Ein Leck der Datenbank verrät den Instanzschlüssel (R19); Abhilfe ist der Widerruf am Gegenüber.
Der Einwurf ist schwächer als das Verfahren: Sein Schlüssel ist ein geteiltes Geheimnis in einer
URL. Er darf deshalb nur schreiben, braucht TLS und hat enge Grenzen.

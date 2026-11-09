---
id: ADR-0014
titel: Maschinen weisen sich mit eigenem Schlüsselpaar und signierten Anfragen aus
status: akzeptiert
datum: 2026-11-08
gilt_fuer:
  - src/instanz/**
  - src/routes/instanz.rs
  - src/auth/unterschrift/**
herleitung:
  - openspec/changes/archive/2026-11-08-ckq15vzr-instanzkopplung-schluessel/design.md
  - docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md
---

# ADR-0014: Maschinen weisen sich mit eigenem Schlüsselpaar und signierten Anfragen aus

## Regeln

- MUST: Eine Maschine (gekoppelte Instanz, später ein Fremdsystem nach LLH-1148) hat ein eigenes
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
- SHOULD: LLH-1148 übernimmt das Verfahren für Fremdsysteme (etwa als OAuth2 `private_key_jwt`
  mit denselben Claims), statt ein zweites zu erfinden.

## Prüfung

```sh
verlange 'kopf\.alg != "EdDSA"' src/instanz/signatur.rs
verlange 'LEBENSDAUER_S: i64 = 60' src/instanz/signatur.rs
verlange 'remember_jti' src/instanz/extractor.rs
verlange 'impl FromRequest<AppState> for GekoppelteInstanz' src/instanz/extractor.rs
verbiete '[Bb]earer' 'src/instanz/**' src/routes/instanz.rs
```

## Kontext

Ein Server kannte bis November 2026 nur Menschen (Sitzung) und gekoppelte Geräte, keine anderen
Server. Für die Kopplung von ELW und Hub (Epic LLH-1489) und die öffentliche API (LLH-1148) braucht
es eine Anmeldung für Maschinen, die ohne gemeinsames Geheimnis auskommt, Wiederholungen erkennt
und auch dann trägt, wenn TLS unterwandert ist. Gewählt hat Ruben am 08.11.2026 das signierte
Anfrage-JWT nach dem Muster DPoP/`private_key_jwt`, nicht RFC 9421.

## Konsequenzen

Jede Maschine braucht einen Schlüssel und eine Uhr, die höchstens fünf Minuten abweicht; eine
Instanz ohne Netz zeigt die Abweichung an. Ein Leck der Datenbank verrät den Instanzschlüssel (R19);
Abhilfe ist der Widerruf am Gegenüber. Fremdsysteme bekommen kein einfaches API-Token, sondern
dasselbe Verfahren wie Instanzen.

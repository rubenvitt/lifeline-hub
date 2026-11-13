---
id: ADR-0039
titel: Ein privater Archiv-Schlüssel kommt nur für einen Aufruf an den Server und nie an einen Hub
status: akzeptiert
datum: 2026-11-13
gilt_fuer:
  - src/routes/archiv_einspielen.rs
  - src/einsatz/archiv/einspielen.rs
  - src/instanz/repo.rs
herleitung:
  - openspec/changes/archive/2026-11-13-yftpw99d-archiv-einspielen-verwaltung/design.md
  - LLH-1711 (Weg mit Ruben am 13.11.2026 abgestimmt)
---

# ADR-0039: Ein privater Archiv-Schlüssel kommt nur für einen Aufruf an den Server und nie an einen Hub

## Regeln

- MUST: Eine Route, die einen privaten Archiv-Schlüssel annimmt, lehnt an einer erreichten
  Instanz ab (`instanz::repo::wird_erreicht`: eine Kopplung `wird_gemeldet`, angebahnt oder
  aktiv, für irgendeine Org), bevor sie den Body liest.
- MUST NOT: Ein privater Archiv-Schlüssel oder seine Passphrase steht in der Datenbank, in einer
  Datei, im Log oder in der Admin-Spur.
- MUST: Schlüssel und Passphrase liegen nur in Puffern, die beim Fallenlassen genullt werden
  (`age::secrecy`), und nur so lange wie der Aufruf.
- MUST: Befehl und Verwaltung spielen über denselben Kern ein (`einsatz::archiv::einspielen::einspielen`);
  die Verwaltung nur in die Org der Person mit Namensprüfung (`Ziel::EigeneOrg`).
- SHOULD: Was einen Block hält, liegt verschlüsselt in einer `Zwischendatei` neben der
  Datenbank, die beim Fallenlassen geht.

## Prüfung

```sh
verlange 'fordere_keinen_hub\(&state\)\.await\?' src/routes/archiv_einspielen.rs
verlange 'pub async fn wird_erreicht\(' src/instanz/repo.rs
verlange "zustand IN \('angebahnt', 'aktiv'\)" src/instanz/repo.rs
verlange 'Ziel::EigeneOrg\(benutzer\.org_id\)' src/routes/archiv_einspielen.rs
verlange 'SecretBox' src/routes/archiv_einspielen.rs
verbiete 'tracing::[a-z]+!\([^)]*schluessel' src/routes/archiv_einspielen.rs
```

## Kontext

Ein Archivblock ließ sich nur per Shell einspielen (LLH-1494). Die Verwaltung braucht dafür den
privaten Archiv-Schlüssel der Org am Server. An einer öffentlich erreichbaren Installation (dem
Hub, bei dem sich ELW melden) wäre er dem Netz am nächsten; dort sollen Archive gerade nur
verschlüsselt liegen.

## Konsequenzen

Am Hub bleibt nur der Befehl, also der Betrieb, und der Block muss zum Ansehen an eine
Installation ohne gemeldete Kopplung. Ein Hintergrundauftrag mit Fortschritt ist damit
ausgeschlossen: er bräuchte den Schlüssel über den Aufruf hinaus. Pseudo-Kopplungen eines
eingespielten Blocks stehen auf `widerrufen` und sperren nicht.

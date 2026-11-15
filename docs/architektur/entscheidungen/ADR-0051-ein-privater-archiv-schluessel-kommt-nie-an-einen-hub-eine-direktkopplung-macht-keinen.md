---
id: ADR-0051
titel: Ein privater Archiv-Schlüssel kommt nur für einen Aufruf an den Server und nie an einen Hub; eine Direktkopplung vor Ort macht keinen Hub
status: akzeptiert
datum: 2026-11-15
ersetzt: ADR-0045
gilt_fuer:
  - src/routes/archiv_einspielen.rs
  - src/einsatz/archiv/einspielen.rs
  - src/instanz/repo.rs
herleitung:
  - openspec/changes/archive/2026-11-14-yftpw99d-archiv-einspielen-verwaltung/design.md
  - openspec/changes/archive/2026-11-15-r3r7ul21-archiv-direktkopplung-kein-hub/design.md
  - LLH-1711 (Weg mit Ruben am 13.11.2026 abgestimmt), LLH-1888 (am 14.11.2026 abgestimmt)
---

# ADR-0051: Ein privater Archiv-Schlüssel kommt nur für einen Aufruf an den Server und nie an einen Hub; eine Direktkopplung vor Ort macht keinen Hub

## Regeln

- MUST: Eine Route, die einen privaten Archiv-Schlüssel annimmt, lehnt an einer erreichten
  Instanz ab (`instanz::repo::wird_erreicht`: eine Kopplung `wird_gemeldet`, angebahnt oder
  aktiv, für irgendeine Org), bevor sie den Body liest.
- MUST NOT: Eine Kopplung der Art `vor_ort` macht eine Instanz zur erreichten; jede andere Art
  zählt, auch eine künftige.
- MUST NOT: Ein privater Archiv-Schlüssel oder seine Passphrase steht in der Datenbank, in einer
  Datei, im Log oder in der Admin-Spur.
- MUST: Schlüssel und Passphrase liegen im eigenen Code nur in Puffern, die beim Fallenlassen
  genullt werden (`age::secrecy`), nie als gewöhnlicher `String`, und nur so lange wie der Aufruf.
- MUST: Entsperren (scrypt), Hashen und Entschlüsseln laufen auf einem Blocking-Thread, nicht auf
  dem Async-Worker.
- MUST: Befehl und Verwaltung spielen über denselben Kern ein (`einsatz::archiv::einspielen::einspielen`);
  die Verwaltung nur in die Org der Person mit Namensprüfung (`Ziel::EigeneOrg`).
- SHOULD: Was einen Block hält, liegt verschlüsselt in einer `Zwischendatei` neben der
  Datenbank, die beim Fallenlassen geht.

## Prüfung

```sh
verlange 'fordere_keinen_hub\(&state\)\.await\?' src/routes/archiv_einspielen.rs
verlange 'pub async fn wird_erreicht\(' src/instanz/repo.rs
verlange "zustand IN \('angebahnt', 'aktiv'\) AND art <> 'vor_ort'\)" src/instanz/repo.rs
verlange 'Ziel::EigeneOrg\(benutzer\.org_id\)' src/routes/archiv_einspielen.rs
verlange 'SecretBox' src/routes/archiv_einspielen.rs
verbiete 'from_utf8_lossy' src/routes/archiv_einspielen.rs
verlange 'spawn_blocking' src/routes/archiv_einspielen.rs
verlange 'spawn_blocking' src/einsatz/archiv/einspielen.rs
verbiete 'tracing::[a-z]+!\([^)]*schluessel' src/routes/archiv_einspielen.rs
```

## Kontext

ADR-0045 sperrte das Einspielen an jeder Instanz, bei der sich eine andere meldet. Seit der
Direktkopplung vor Ort (LLH-1497, LLH-1678) führt auch ein ELW, der einem zweiten ELW den Code
ausgestellt hat, eine solche Kopplung; er galt damit als Hub, ohne öffentlich erreichbar zu sein.
Eine Direktkopplung trägt weder Stammdaten noch Geheimnisse, Verwahrung oder Führungswechsel nach
der Richtung.

## Konsequenzen

Am Hub bleibt nur der Befehl, also der Betrieb, und der Block muss zum Ansehen an eine
Installation ohne gemeldete Standardkopplung. Ein ELW mit Direktkopplung spielt weiter ein.
Ausgenommen ist nur `vor_ort`: eine neue Art sperrt, bis jemand sie bewusst ausnimmt. Ein
Hintergrundauftrag mit Fortschritt bleibt ausgeschlossen. Pseudo-Kopplungen eines eingespielten
Blocks stehen auf `widerrufen` und sperren nicht.

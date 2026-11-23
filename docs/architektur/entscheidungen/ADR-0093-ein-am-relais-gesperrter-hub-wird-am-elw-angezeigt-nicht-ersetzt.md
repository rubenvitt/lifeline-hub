---
id: ADR-0093
titel: Ein am Push-Relais gesperrter Hub wird am ELW angezeigt, nicht durch eigenen iOS-Push ersetzt
status: akzeptiert
datum: 2026-11-23
gilt_fuer:
  - src/instanz/melden.rs
  - src/instanz/spiegel/hinweis.rs
  - src/einsatz/repo.rs
  - frontend/src/instanz/IosPushHubBand.tsx
herleitung:
  - docs/superpowers/specs/2026-11-23-zk6c4gmb-ios-push-hub-sperre-design.md
  - https://zunder.rubeen.dev/#/aufgabe/zk6c4gmbvmsg8eggqh2xkutb
---

# ADR-0093: Ein am Push-Relais gesperrter Hub wird am ELW angezeigt, nicht durch eigenen iOS-Push ersetzt

## Regeln

- MUST: Ein Hub mit `--ios-push` nennt eine Sperre des Push-Relais in jeder Meldeantwort
  (`MeldenAntwort.ios_push_gesperrt_seit`, additiv; fehlt sie, gilt der Hub als nicht gesperrt).
- MUST: Der ELW speichert die Sperre an der Kopplung nur im kanonischen Format
  ([ADR-0012](ADR-0012-zeit-utc-auf-dem-wire-anzeigezone-im-client.md)); einen anderen Wert nimmt
  er als Sperre ab dem gespeicherten Zeitpunkt oder ab jetzt.
- MUST: Der ELW zeigt die Sperre an jedem Einsatz, dessen Hinweise über den Hub reisen und für
  den der Hub Konten pusht (`EinsatzAnzeige.ios_push_hub_gesperrt`), Einsatzleitung und Admins
  der Einsatz-Org im Band, und an der aktiven Kopplung; Beginn und Ende melden den Einsatzkopf.
- MUST NOT: Der ELW springt bei einer Sperre nicht mit eigenem iOS-Push für Konten vom Hub ein.

## Prüfung

```sh
verlange 'ios_push_gesperrt_seit' 'src/instanz/melden.rs'
verlange 'fn sperrzeit_uebernehmen' 'src/instanz/melden.rs'
verlange 'macro_rules! ios_push_hub_gesperrt_spalte' 'src/einsatz/repo.rs'
verlange 'pub async fn sperre_melden' 'src/instanz/spiegel/hinweis.rs'
```

## Kontext

Bietet ein Hub iOS-Push an, lässt der ELW den eigenen iOS-Push an Konten vom Hub aus. Sperrt das
Push-Relais den Hub, bekommen deren iPhones bis zu einem Tag und länger nichts, auch keine Alarme.
Ein Rückfall auf eigenen Push hilft nicht: die Geräte sind am Hub angemeldet, der ELW lehnt ihre
Anmeldung ab (422) und hat kein Token.

## Konsequenzen

Die Einsatzleitung sieht im Einsatz, dass iOS-Push über den Hub nicht ankommt, und sichert
Wichtiges auf anderem Weg ab. Die Anzeige folgt der Meldung (Takt `--instanz-melden-sekunden`)
und dem Ende der Sperre am Hub, das erst ein gelungener Versand bringt. Eine Eingangsmeldung zur
Sperre gibt es nicht.

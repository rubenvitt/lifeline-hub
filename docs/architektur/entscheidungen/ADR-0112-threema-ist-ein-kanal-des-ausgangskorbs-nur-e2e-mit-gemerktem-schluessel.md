---
id: ADR-0112
titel: Threema ist ein Kanal des Ausgangskorbs, nur Ende-zu-Ende verschlüsselt und mit gemerktem Empfängerschlüssel
status: vorgeschlagen
datum: 2026-11-28
gilt_fuer:
  - src/adapter/threema.rs
  - src/adapter/threema/**
  - src/adapter/threema_art.rs
  - src/ausgang/zusteller/threema.rs
herleitung:
  - docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md
  - https://zunder.rubeen.dev/#/aufgabe/gq6qs7tgguzqhfg3za8nfigo
---

# ADR-0112: Threema ist ein Kanal des Ausgangskorbs, nur Ende-zu-Ende verschlüsselt und mit gemerktem Empfängerschlüssel

Präzisiert ADR-0104 und ADR-0107 (kanalneutraler Zusteller) für das Threema Gateway.

## Regeln

- MUST: Threema-Nachrichten gehen nur über `send_e2e` und nur von `adapter::threema`; der Hub
  verschlüsselt selbst (`adapter::threema::krypto`, `crypto_box`/`crypto_secretbox`).
- MUST NOT: Der Basis-Modus (`send_simple`) wird nicht benutzt; nie geht Klartext an Threema, auch
  nicht als Rückfall.
- MUST: Der Client spricht nur mit dem festen Host `https://msgapi.threema.ch` über den Zielschutz
  (`ausgehend::client_builder(Zweck::Adapter)`, Resolver des Zielschutzes, ohne Weiterleitung).
- MUST NOT: Secret, privater Schlüssel, Inhalt, eine URL mit Query oder ein Antworttext von Threema
  stehen in Log, Fehler, Antwort, ETB oder Admin-Spur.
- MUST: Der öffentliche Schlüssel einer Threema-ID wird beim ersten Versand gemerkt
  (`org_threema_schluessel`) und nie überschrieben; weicht er später ab, scheitert der Versand
  mit `verschluesselung`, bevor etwas gesendet ist.
- MUST: Ein Abbruch nach dem Absenden von `send_e2e` ist `ungewiss` und wird nie selbst
  wiederholt; gesendete Teile stehen in `ausgang_teil`.

## Prüfung

```sh
verbiete 'send_simple' 'src/**/*.rs'
verlange 'pub const API: &str = "https://msgapi.threema.ch";' 'src/adapter/threema.rs'
verlange 'ON CONFLICT \(org_id, threema_id\) DO NOTHING' 'src/ausgang/repo.rs'
```

## Kontext

Behörden und Hilfsorganisationen lesen oft schneller in Threema als im Postfach. Threema Gateway
kennt zwei Modi; im Basis-Modus verschlüsselt Threema und sieht den Inhalt. Der Schlüssel eines
Empfängers kommt aus dem Verzeichnis von Threema, das ihn unbemerkt austauschen könnte.

## Konsequenzen

Lageberichte erreichen Threema-IDs, ohne dass Threema mitliest. Der Hub trägt eigenen
Krypto-Code auf Bibliotheksaufrufen und braucht den privaten Schlüssel der Gateway-ID. Ändert sich
der Schlüssel einer ID doch, sendet der Hub an sie nicht mehr; ein Zurücksetzen gibt es nicht.
Empfangsbestätigungen fehlen bis LLH-2159.

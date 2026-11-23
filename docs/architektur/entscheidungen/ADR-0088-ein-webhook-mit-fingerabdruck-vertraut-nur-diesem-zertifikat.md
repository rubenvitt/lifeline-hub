---
id: ADR-0088
titel: Ein Webhook mit Fingerabdruck vertraut nur diesem Zertifikat
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - src/public_api/webhook/**
  - src/routes/anbindungen_webhook.rs
  - src/instanz/zertifikat.rs
herleitung:
  - docs/superpowers/specs/2026-11-22-wx6bfsmc-webhook-zertifikat-pin-design.md
---

# ADR-0088: Ein Webhook mit Fingerabdruck vertraut nur diesem Zertifikat

## Regeln

- MUST: Trägt ein Webhook einen Fingerabdruck (SHA-256 über das DER-Zertifikat), verbindet sein
  Client nur mit genau diesem Zertifikat; Kette, Name und Vertrauensanker des Systems zählen dann
  nicht. Eine Abweichung ist die Fehlerart `tls`.
- MUST: Der Zielschutz aus ADR-0046 gilt mit und ohne Fingerabdruck unverändert; ein Client mit
  Fingerabdruck entsteht aus demselben `baue_client` und bekommt sein TLS nur über
  `instanz::zertifikat::tls_config`.
- MUST NOT: Das Abrufen des Fingerabdrucks vom Ziel sendet eine HTTP-Anfrage; der `Erfasser`
  bricht den Handshake ab, sobald er das Zertifikat gelesen hat. Gespeichert wird nur, was der
  Admin speichert.
- MUST: Ändert ein Admin den Server eines Webhooks mit Fingerabdruck, sagt er zugleich, was mit
  dem Fingerabdruck geschieht (neu oder entfernen); sonst 400.
- MUST: Setzen, Wechseln, Entfernen und Abrufen stehen in der Admin-Spur.

## Prüfung

```sh
verlange 'tls_backend_preconfigured\(tls\)' src/public_api/webhook/ziel.rs
verlange 'tls_config\(Some' src/public_api/webhook/ziel.rs
verlange 'erfasser_config' src/public_api/webhook/ziel.rs
verlange 'Err\(rustls::Error::General\(ERFASST' src/instanz/zertifikat.rs
verlange 'NEUES_ZIEL_OHNE_PIN' src/routes/anbindungen_webhook.rs
```

## Kontext

Ein Fremdsystem im ELW-Netz zeigt meist ein selbst ausgestelltes Zertifikat; der Webhook-Client
glaubte nur den Vertrauensankern des Systems und scheiterte. Die Direktkopplung löst dasselbe mit
einem beglaubigten Fingerabdruck (ADR-0029). Beim Webhook beglaubigt der Admin ihn, indem er ihn
mit dem Zielgerät vergleicht.

## Konsequenzen

Ein LAN-Ziel mit eigenem Zertifikat bekommt Zustellungen, ohne dass der Server einer fremden
Stelle vertrauen muss. Wechselt das Ziel sein Zertifikat, scheitert die Zustellung, bis der Admin
den Fingerabdruck neu hinterlegt. Der Adapter-Rahmen kann denselben Weg über `tls_config`
übernehmen.

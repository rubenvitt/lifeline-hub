---
id: ADR-0104
titel: Adapter rufen http nur zu einem privaten IP-Literal, nur mit LAN-Ausnahme und nur für Arten, die es erklären
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/adapter/ziel.rs
  - src/adapter/art.rs
herleitung:
  - docs/superpowers/specs/2026-11-25-l13zu34o-drohne-hls-profil-design.md
  - https://zunder.rubeen.dev/#/aufgabe/l13zu34ormzjup8syaxj7ttj
---

# ADR-0104: Adapter rufen http nur zu einem privaten IP-Literal, nur mit LAN-Ausnahme und nur für Arten, die es erklären

Präzisiert ADR-0077 („nur `https`“) für Medienserver im LAN.

## Regeln

- MUST: Jede Adapter-URL geht über `adapter::ziel::check_adapter_url`, beim Speichern der
  Einstellungen und vor jeder Anfrage (`AbrufKontext::request`).
- MUST NOT: `http` für eine Art ohne `AdapterArt::http_im_lan`, für einen Adapter ohne
  LAN-Ausnahme oder zu einem Hostnamen.
- MUST: `http` nur zu einem IP-Literal der Klasse `Privat` (`ausgehend::zieladresse::klasse`:
  RFC 1918, 100.64/10, fc00::/7); Loopback, Link-Local und alle übrigen Regeln von `check_url`
  gelten weiter.
- SHOULD: Die Oberfläche warnt an der LAN-Ausnahme, dass Zugangsdaten über `http` unverschlüsselt
  durchs Netz gehen.

## Prüfung

```sh
verlange 'pub fn check_adapter_url' 'src/adapter/ziel.rs'
verlange 'check_adapter_url\(url, self\.lan_erlaubt, self\.http_im_lan\)' 'src/adapter/ziel.rs'
verlange 'check_adapter_url\(text, lan_erlaubt, art\.http_im_lan\(\)\)' 'src/adapter/art.rs'
verbiete '\.https_only\(false\)' 'src/**/*.rs'
```

## Kontext

Ein MediaMTX des Kunden, in das jede Drohnen-App per RTMP sendet, liefert HLS im LAN fast immer
über `http://…:8888`; ein selbst signiertes Zertifikat besteht den Abruf nicht. Ein Hostname per
`http` könnte auf eine öffentliche Adresse zeigen und unverschlüsselt ins Internet rufen.

## Konsequenzen

Ein Medienserver im LAN ist ohne Reverse-Proxy erreichbar. Zugangsdaten gehen dann im Klartext
durchs LAN; das Formular sagt es. Der Client für `http` ist ein eigener (`client_http_lan`), der
nur nach der Prüfung benutzt wird.

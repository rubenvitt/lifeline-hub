# Betrieb: Umgebungsvariablen

Alle Schalter des Backends laufen über die zentrale clap-`Config` (`src/config.rs`).
Die **vollständige, immer aktuelle Liste** liefert deshalb das Binary selbst:

```bash
lifeline-hub --help
```

Dieses Dokument ergänzt, was `--help` nicht zeigen kann: welche Variablen eine
Vertrauensgrenze verschieben, und warum eine ambient gesetzte Variable hier schon
Schaden angerichtet hat.

## Regel

**Konfiguration wird ausschließlich in `src/config.rs` aus der Umgebung gelesen.**
Kein Modul greift per `std::env::var` direkt zu — das erzwingt
`tests/env_config_guard.rs`.

Der Grund ist nicht Ordnungsliebe. Ein ad-hoc gelesener Schalter taucht weder in
`--help` noch im Startup-Log auf, hat keinen definierten Default und lässt sich
setzen, ohne dass es jemand merkt. Genau so waren die beiden Schalter unten bis
LFH-239/F18 unsichtbar.

Wo der `AppState` nicht erreichbar ist (etwa `'static`-Closures wie
`proxy::ssrf_redirect_policy`), wird der Wert beim Serverstart in einen prozessweiten
`OnceLock` geschoben — Vorbilder: `karte::init_karte_config`, `anhang::init_scan_config`.
Nicht als Ersatz für die `Config`, sondern als Transportweg dahinter.

## Sicherheitsrelevante Schalter

Diese verschieben eine Vertrauensgrenze und werden beim Serverstart mit
`tracing::warn!` protokolliert, wenn sie aktiv sind:

| Variable | Flag | Wirkung |
|---|---|---|
| `LIFELINE_DOWNLOAD_ALLOW_LOOPBACK` | `--download-allow-loopback` | **Schwächt den SSRF-Schutz.** Erlaubt Karten-Downloads zu Loopback-Adressen, auch über http — und zwar auf dem gesamten Download-Pfad einschließlich des öffentlichen Style-/Tile-Proxys. Reiner Dev-Schalter für einen lokalen Object-Store (MinIO). Gehört in keine erreichbare Umgebung. |
| `LIFELINE_OFFLINE_KATALOG_MANIFEST_URL` | `--offline-katalog-manifest-url` | **Verbiegt die Trust-Quelle** des Offline-Karten-Katalogs: bestimmt, welchem Manifest — und damit welchen Kartendaten — das System vertraut. Ohne Angabe gilt der einkompilierte Pin (LFH-199). |

Geheimnisse, die nie ins Log dürfen (im `Debug` maskiert):
`LIFELINE_ADMIN_PASSWORD`, `LIFELINE_KARTEN_SERVICE_TOKEN`,
`LIFELINE_OIDC_CLIENT_SECRET`.

## Der Leak — und warum Gates die Umgebung räumen müssen

`mise.local.toml` lädt per `[env] _.file = ".env"` alle Dev-Variablen in **jeden**
Prozess, der im Repo startet. Beides ist git-ignoriert und damit unsichtbar, und der
Effekt reicht weiter, als man erwartet: **auch ein frischer Worktree ohne eigene `.env`
erbt sie**, weil mise die Elternverzeichnisse mitliest.

Das ist zweimal nachweislich schiefgegangen:

- `LIFELINE_DOWNLOAD_ALLOW_LOOPBACK=1` in der `.env` ließ den SSRF-Test
  `validiere_url_lehnt_unsichere_ziele_ab` fallen — der Test sah aus wie eine
  Regression, war aber die Umgebung.
- `LIFELINE_OIDC_*` ließ `config::tests::oidc_config_defaults_sind_none` fallen und
  färbte damit die gesamte Suite rot, ohne dass am Code etwas falsch war.

Beide Fälle sind inzwischen **an der Wurzel** behoben statt umschifft: die
Karten-Schalter kommen aus dem `OnceLock`, der im Testprozess nie gefüllt wird (also
gilt der sichere Default), und die Config-Default-Tests räumen die Umgebung selbst
(`parse_hermetisch`). Ein `env -u` im Gate hätte nur den Gate-Lauf geheilt — ein
direkter `cargo test` wäre rot geblieben.

Für alles Weitere gilt trotzdem: **Gates fahren mit geräumter Umgebung**
(`scripts/check-all.sh`). Eine handgepflegte `env -u`-Liste ist dafür der falsche
Mechanismus — sie war zuletzt drei Variablen lang, während die `.env` dreizehn setzte,
und genau diese Drift hat den OIDC-Ausfall verursacht.

## Weitere Variablen im Repo

`KS_*` und `AWS_*` konfigurieren **nicht** das Backend, sondern den separaten
`karten-service` und dessen S3-/MinIO-Anbindung (eigene Config im Crate
`karten-service`). Sie stehen in derselben `.env` und leaken deshalb genauso —
für das Backend sind sie ohne Bedeutung.

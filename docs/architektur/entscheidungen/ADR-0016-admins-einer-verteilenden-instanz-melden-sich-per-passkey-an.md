---
id: ADR-0016
titel: Anmeldewege sind schaltbare Provider; Admins einer verteilenden Instanz melden sich per Passkey an
status: akzeptiert
datum: 2026-11-09
ersetzt: ADR-0011
gilt_fuer:
  - src/auth/**
  - src/routes/auth.rs
  - src/instanz/stammdaten/geheimnis.rs
herleitung:
  - docs/superpowers/specs/2026-07-14-auth-provider-system-design.md
  - openspec/changes/archive/2026-11-09-ca8v0psv-stammdaten-verteilung/design.md
---

# ADR-0016: Anmeldewege sind schaltbare Provider; Admins einer verteilenden Instanz melden sich per Passkey an

## Regeln

- MUST: Jeder Anmeldeweg (Passwort, Dev, OIDC, WebAuthn) ist ein Provider mit stabiler ID in
  `src/auth/provider/` und wird über die Registry (`src/auth/provider/registry.rs`)
  serverweit an- oder abgeschaltet. Keine Provider sind die Übergabe an die macOS-Hülle
  (`systembrowser`, `src/auth/huelle/`, setzt eine Browsersitzung voraus) und die Gerätekopplung
  (`geraetecode`, `src/geraet/`).
- MUST: Jeder erfolgreiche Weg endet in `session::anlegen` (Gerätekopplung:
  `session::anlegen_geraet`) in `src/auth/session.rs`; dort allein entsteht eine Sitzung.
- MUST NOT: kein Handler schreibt selbst in die Tabelle `session`.
- MUST: Nur der Passwort-Provider ist admin-tauglich (`ProviderId::ist_admin_tauglich`); der
  letzte admin-taugliche Weg lässt sich nicht abschalten.
- MUST: Ein System-Admin mit Anmelde-Passkey meldet sich an einer Instanz, die die Geheimnisse
  seiner Org verteilt, nicht per Passwort an: `routes::auth::login` ruft nach der
  Passwortprüfung `instanz::stammdaten::geheimnis::check_passkey_pflicht` (403, kein
  Fehlversuch). Ob die Pflicht gilt, sagt allein `geheimnis::is_passkey_pflichtig`; sie bleibt
  nach einem Widerruf, solange ein an einen ELW gelieferter Hash dort gilt (bis „ELW verloren“).
  Ein Admin ohne Passkey behält den
  Passwortweg; seine Geheimnisse gehen dann nicht hinaus (`liefern::load_geheimnis`).
- MUST: Unter der Pflicht entfernt ein Einmalpasswort (`routes::benutzer::einmalpasswort`) die
  Anmelde-Passkeys des Ziels. Für den letzten Admin gibt es den Startbefehl
  `admin-zugang-zuruecksetzen` (`src/auth/notfall.rs`), nie eine HTTP-Route.
- MUST: Lokale Wege funktionieren ohne externen Identitätsanbieter; OIDC ist zusätzlich.
- SHOULD: TOTP ist ein zweiter Faktor am Passwortweg (`src/auth/totp/`), kein eigener Provider.

## Prüfung

```sh
verlange '^pub async fn anlegen\(' src/auth/session.rs
verbiete 'INSERT INTO session' 'src/routes/**'
verlange 'matches!\(self, ProviderId::Passwort\)' src/auth/provider/registry.rs
verlange '^pub const ID_(PASSWORT|OIDC|WEBAUTHN): &str' src/auth/provider/mod.rs
verlange 'check_passkey_pflicht\(&state\.pool, &benutzer\)' src/routes/auth.rs
verlange 'system_rolle == crate::auth::ROLLE_ADMIN && !hat_passkey' src/instanz/stammdaten/liefern.rs
verlange 'is_passkey_pflichtig\(&state\.pool, &ziel\)' src/routes/benutzer.rs
verlange 'DELETE FROM webauthn_credential WHERE benutzer_id' src/auth/notfall.rs
```

## Kontext

ADR-0011 machte den Passwortweg zum garantierten Weg für Admins. Mit der Stammdaten-Verteilung
(LLH-1493) liegen Passwort-Hash und TOTP-Geheimnis auch auf gekoppelten ELW, also auf Rechnern im
Fahrzeug. Ein gestohlener ELW gäbe sonst einen Admin-Zugang zum öffentlich erreichbaren Hub her.
Ruben hat am 09.11.2026 entschieden, dass Admins dort nur noch per Passkey hineinkommen.

## Konsequenzen

Die Regeln aus ADR-0011 gelten weiter. Neu ist die Ausnahme für Admins mit Passkey an einer
verteilenden Instanz, und sie wirkt nur für deren Org. Der Abschaltschutz bleibt unberührt, weil
der Passwort-Provider serverweit an bleibt und kein Admin ohne Passkey ausgesperrt wird. Verliert
ein Admin seinen einzigen Passkey, vergibt ein anderer Admin ein Einmalpasswort, und seine
Passkeys fallen dabei weg. Für den letzten Admin gibt es den Notfallbefehl am Server
(Entscheidung 09.11.2026); er setzt Zugang zur Maschine voraus.

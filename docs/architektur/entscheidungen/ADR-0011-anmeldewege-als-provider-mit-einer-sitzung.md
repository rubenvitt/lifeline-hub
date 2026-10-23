---
id: ADR-0011
titel: Anmeldewege sind schaltbare Provider, die alle in dieselbe Server-Sitzung münden
status: akzeptiert
datum: 2026-07-14
gilt_fuer:
  - src/auth/**
  - src/routes/auth.rs
herleitung:
  - docs/superpowers/specs/2026-07-14-auth-provider-system-design.md
  - docs/superpowers/plans/2026-07-14-auth-provider-increment-1-fundament.md
---

# ADR-0011: Anmeldewege sind schaltbare Provider, die alle in dieselbe Server-Sitzung münden

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
- MUST: Lokale Wege funktionieren ohne externen Identitätsanbieter; OIDC ist zusätzlich.
- SHOULD: TOTP ist ein zweiter Faktor am Passwortweg (`src/auth/totp/`), kein eigener Provider.

## Prüfung

```sh
verlange '^pub async fn anlegen\(' src/auth/session.rs
verbiete 'INSERT INTO session' 'src/routes/**'
verlange 'matches!\(self, ProviderId::Passwort\)' src/auth/provider/registry.rs
verlange '^pub const ID_(PASSWORT|OIDC|WEBAUTHN): &str' src/auth/provider/mod.rs
```

## Kontext

Bis Juli 2026 gab es genau einen Anmeldeweg, Benutzername und Passwort. Gewünscht waren Passkeys,
ein zweiter Faktor und SSO über einen externen Anbieter, bei zwei harten Bedingungen: Im ELW ohne
Uplink darf kein lokaler Weg vom Anbieter abhängen, und WebAuthn braucht HTTPS. Statt einzelner
Silos entstand eine Provider-Architektur mit einer gemeinsamen Sitzung.

## Konsequenzen

Ein neuer Anmeldeweg ist ein Provider plus Route, Sitzung, Audit-Spur und Abmelden bleiben gleich.
Der Passwortweg bleibt für Admins immer offen (Aussperr-Schutz); über OIDC neu angelegte Konten
bekommen nur die kleinste Rolle (`src/auth/oidc/provisioning.rs`). WebAuthn verlangt den TLS-Betrieb des Servers (`docs/betrieb-tls.md`).

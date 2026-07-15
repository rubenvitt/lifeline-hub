# Betrieb: WebAuthn/Passkeys

`lifeline-hub` unterstützt app-eigene Passkeys (WebAuthn) als **zusätzlichen**,
passwortlosen Login-Weg neben dem lokalen Passwort-Login und OIDC (LFH-275,
Increment 4). Ein Passkey wird an ein **bestehendes** Konto gebunden — die
Registrierung erfordert einen bereits eingeloggten Nutzer (Profil-Seite), es
gibt **kein** Self-Signup über WebAuthn. Der lokale Passwort-Login und OIDC
bleiben davon unberührt und funktionieren unverändert weiter.

## Kritische Voraussetzung: `rp_id` muss ein Hostname sein, keine IP

WebAuthn funktioniert grundsätzlich nicht über `https://<IP>` — die
Relying-Party-ID (`rp_id`) muss ein Hostname sein, `WebauthnBuilder` verlangt,
dass `rp_id` eine effektive Domain der `rp_origin` ist (bei einer
IP-Origin gibt es keine Domain, der Bau scheitert). Ein LAN-Deployment
braucht deshalb zwingend:

1. **Einen Hostnamen** für den Server — mDNS (z.B. `elw.local`) oder echtes
   DNS.
2. **Ein TLS-Zertifikat, das diesen Hostnamen abdeckt** — Server mit
   `--tls-hostname <host>` starten (siehe `docs/betrieb-tls.md`). Der
   Zertifikats-Cache ist SAN-aware: ändert sich der Hostname, wird das Cert
   automatisch neu erzeugt statt ein Cert mit fehlendem SAN weiterzuverwenden.
3. **Einen sicheren Browser-Kontext** (vertrauenswürdiges HTTPS) — Browser
   erlauben WebAuthn nur in einem als sicher eingestuften Kontext. Bei einem
   selbst erzeugten Zertifikat (mkcert/rcgen) muss dessen Root-CA auf jedem
   Gerät ausgerollt sein, das Passkeys nutzen soll (siehe
   `docs/betrieb-tls.md`, Abschnitt "LAN-Tablets/weitere Geräte") — sonst
   bekommt der Browser eine Zertifikatswarnung und WebAuthn bleibt gesperrt.

Fehlt eine dieser drei Voraussetzungen, ist der Provider entweder gar nicht
gelistet (siehe unten) oder der Browser verweigert `navigator.credentials`.

## Env-Konfiguration

| Variable | Bedeutung |
|---|---|
| `LIFELINE_WEBAUTHN_RP_ID` | Hostname der Relying Party, z.B. `elw.local`. Muss eine effektive Domain von `LIFELINE_WEBAUTHN_RP_ORIGIN` sein — KEINE IP. |
| `LIFELINE_WEBAUTHN_RP_ORIGIN` | Vollständige Origin-URL, z.B. `https://elw.local:8443`. |

Beide Variablen müssen gesetzt sein. Der Server versucht beim Start eager
`WebauthnBuilder::new(rp_id, &rp_origin)?.build()?` — nur wenn das gelingt,
wird der Passkey-Provider in der Auth-Provider-Registry gelistet und ist
nutzbar. Fehlt eine der beiden Variablen, ist der Bau fehlerhaft (z.B.
IP-basierte `rp_id`, `rp_id`/`rp_origin`-Mismatch, kaputte URL), oder scheitert
er sonst irgendwie, wird das nur als Warnung geloggt — der Server startet
trotzdem, aber **ohne** Passkey-Button (kein Fake-Button, der erst beim Klick
als Fehlkonfiguration auffällt), und der bestehende Passwort-/OIDC-Login
bleibt unverändert nutzbar.

## Flow: Registrieren, dann passwortlos anmelden

1. Mit einem bestehenden Konto einloggen (Passwort oder OIDC — Passkey-
   Registrierung ist kein eigener Login-Weg).
2. Zu "Profil" navigieren und "Passkey registrieren" klicken. Das löst
   `navigator.credentials.create()` aus; der Browser fragt den Authenticator
   ab (Plattform wie Touch ID/Windows Hello oder Roaming wie ein
   Sicherheitsschlüssel).
3. Ausloggen.
4. Auf der Login-Seite den Benutzernamen eingeben und "Mit Passkey anmelden"
   klicken. Das löst `navigator.credentials.get()` aus — ohne Passwort. Nach
   erfolgreicher Authenticator-Bestätigung ist die Session wie gewohnt
   aufgebaut.

Damit dieser Flow auf weiteren Geräten (Tablets im Einsatz-LAN) funktioniert,
muss deren Browser dem Server-Zertifikat vertrauen — den mkcert-Root-CA-Rollout
aus `docs/betrieb-tls.md` durchführen, bevor dort Passkeys registriert/genutzt
werden.

## Build-Hinweis: System-OpenSSL-Abhängigkeit

`webauthn-rs` bringt eine System-OpenSSL-Abhängigkeit mit (Build- **und**
Laufzeit-Voraussetzung) — abweichend vom sonst pure-Rust/rustls-Ansatz des
Projekts. Details (Build-Voraussetzungen, Laufzeit-Linking, Optionen für
musl/Docker) stehen in `docs/betrieb/packaging.md`.

## Manueller Smoke-Test

Der End-to-End-Flow braucht einen laufenden HTTPS-Server unter einem
Hostnamen, einen Browser und einen echten Authenticator und ist daher kein
Teil der automatisierten Test-Suite. Der dokumentierte Ablauf (Registrierung,
Logout, passwortloser Login, Counter/Clone-Check) liegt in
`tests/webauthn_smoke.rs` (`#[ignore]`).

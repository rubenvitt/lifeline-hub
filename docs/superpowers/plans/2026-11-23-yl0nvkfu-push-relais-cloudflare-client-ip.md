# Push-Relais hinter Cloudflare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Relais zählt hinter Cloudflare und Traefik die öffentliche Client-Adresse, über eine Liste vertrauter Proxys wie der Hauptserver.

**Architecture:** Neues Modul `push-relais/src/client_ip.rs` mit `ClientIpSource` (Gegenstelle, ein Proxy, Proxy-Liste) und `client_ip`, das die Kette von rechts liest wie `src/extract.rs::client_ip`. `RelaisConfig` bekommt `trusted_proxies` und baut daraus die Quelle; `RelaisState` trägt sie statt `hinter_proxy`. Doku nennt die Lösung für r-server.

**Tech Stack:** Rust, axum 0.8, clap 4 (env), `ipnet` 2.

**Spec:** `docs/superpowers/specs/2026-11-23-yl0nvkfu-push-relais-cloudflare-client-ip-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/yl0nvkfufmblhseov80bcql0

## Global Constraints

- Neue Variable heißt `PUSH_RELAIS_TRUSTED_PROXIES` (`--trusted-proxies`), Komma-Liste.
- Parse-Regeln wie `LIFELINE_TRUSTED_PROXIES` (`src/config.rs::proxy_netz_parsen`): CIDR oder Einzeladresse, Netz wird `trunc()`t; Hostname, leerer Eintrag, IPv4-gemapptes IPv6-Netz → Fehler.
- `PUSH_RELAIS_HINTER_PROXY` bleibt mit unveränderter Bedeutung; beide gesetzt → Start bricht ab.
- Keine IP ins Log; das Log trägt weiter nur `server_id`, Zähler, Fehlerarten.
- Konfiguration nur in `push-relais/src/config.rs`; die Betriebsdoku nennt jede Variable im selben Commit.
- Neue Bezeichner: Technik englisch, Prosa (Kommentare, Testnamen als Satz, Doku) deutsch.
- Keine Cloudflare-Bereiche im Code.

## Review Focus

1. Gegenstelle außerhalb der Liste mit `X-Forwarded-For` → die Gegenstelle zählt, der Header nie (Test in Task 1).
2. Kette nur aus Vertrautem (Client nutzt selbst eine Cloudflare-Adresse) → linkester Eintrag zählt, keine Panik (Task 1).
3. Unlesbarer Eintrag mitten in der Kette (`<client>, kaputt, <edge>`) → Suche endet bei der letzten bekannten Stufe (`kaputt` ist links von `<edge>`, also zählt `<edge>`) (Task 1).
4. Dual-Stack-Gegenstelle `::ffff:10.0.1.5` mit IPv4-Liste → gilt als vertraut (Task 1).
5. Mehrere `X-Forwarded-For`-Zeilen → als eine Liste in Reihenfolge (Task 1).

---

### Task 1: `ClientIpSource` und `client_ip` im Relais

**Files:**
- Create: `push-relais/src/client_ip.rs`
- Modify: `push-relais/src/lib.rs` (Modul `client_ip` öffentlich), `push-relais/Cargo.toml` (`ipnet = "2"`)

**Interfaces:**
- Produces:
  - `pub enum ClientIpSource { Peer, SingleProxy, TrustedProxies(Vec<ipnet::IpNet>) }` (`Clone, Debug, PartialEq`)
  - `pub fn client_ip(source: &ClientIpSource, headers: &HeaderMap, peer: Option<SocketAddr>) -> IpAddr`
    - fehlt `peer`: `0.0.0.0` wie bisher.
    - `Peer`: Gegenstelle.
    - `SingleProxy`: rechter `x-forwarded-for`-Eintrag (bisheriges Verhalten aus `api.rs`), sonst Gegenstelle.
    - `TrustedProxies(netze)`: Algorithmus von `src/extract.rs::client_ip` (Zeilen 120–151) samt `adresse_lesen` übernehmen; Doc-Kommentar verweist auf ihn.

- [ ] **Step 1: Unit-Tests in `client_ip.rs` schreiben** (`#[cfg(test)] mod tests`), Netze `10.0.1.0/24` (Traefik) und `173.245.48.0/20` (Cloudflare-Beispiel), Gegenstelle `10.0.1.5`:
  - `ohne_proxy_zaehlt_die_gegenstelle`: `Peer`, XFF `198.51.100.1` → `10.0.1.5`.
  - `ein_proxy_zaehlt_den_rechten_eintrag`: `SingleProxy`, XFF `198.51.100.1, 203.0.113.5` → `203.0.113.5`.
  - `hinter_cloudflare_zaehlt_der_client`: Liste, XFF `198.51.100.9, 203.0.113.7, 173.245.48.10` → `203.0.113.7`.
  - `fremde_gegenstelle_zaehlt_selbst`: Liste, Gegenstelle `192.0.2.1`, XFF `203.0.113.7` → `192.0.2.1`.
  - `nur_vertraute_kette_liefert_den_linkesten`: Liste, XFF `173.245.48.20, 173.245.48.10` → `173.245.48.20`.
  - `unlesbarer_eintrag_beendet_die_suche`: Liste, XFF `203.0.113.7, kaputt, 173.245.48.10` → `173.245.48.10`.
  - `gemappte_gegenstelle_gilt_als_ipv4`: Liste, Gegenstelle `[::ffff:10.0.1.5]:4000`, XFF `203.0.113.7` → `203.0.113.7`.
  - `mehrere_headerzeilen_sind_eine_liste`: Liste, Zeilen `203.0.113.7` und `173.245.48.10` → `203.0.113.7`.
  - `eintrag_mit_port_wird_gelesen`: Liste, XFF `203.0.113.7:5555, 173.245.48.10` → `203.0.113.7`.
- [ ] **Step 2:** `mise exec -- cargo test -p push-relais --lib client_ip` → FAIL (Modul fehlt).
- [ ] **Step 3:** `ClientIpSource` und `client_ip` umsetzen, `ipnet` eintragen, `pub mod client_ip;` in `lib.rs`.
- [ ] **Step 4:** `mise exec -- cargo test -p push-relais --lib client_ip` → alle PASS.
- [ ] **Step 5: Commit** `fix(push-relais): Client-Adresse über eine Liste vertrauter Proxys (LLH-2080)`.

### Task 2: Konfiguration und Verdrahtung

**Files:**
- Modify: `push-relais/src/config.rs`, `push-relais/src/api.rs`, `push-relais/src/main.rs`
- Test: `push-relais/tests/registrierung.rs`, `push-relais/tests/senden.rs` (nur Aufrufe von `RelaisState::neu`), Unit-Tests in `config.rs`

**Interfaces:**
- Consumes: `ClientIpSource`, `client_ip` aus Task 1.
- Produces:
  - `RelaisConfig.trusted_proxies: Vec<IpNet>` mit `#[arg(long, env = "PUSH_RELAIS_TRUSTED_PROXIES", value_delimiter = ',', value_parser = proxy_netz_parsen)]`; `fn proxy_netz_parsen(&str) -> Result<IpNet, String>` wie im Hauptpaket.
  - `impl RelaisConfig { pub fn client_ip_source(&self) -> anyhow::Result<ClientIpSource> }`: beide gesetzt → Fehler mit Text, der beide Variablen nennt und sagt, nur `PUSH_RELAIS_TRUSTED_PROXIES` zu nutzen; Liste → `TrustedProxies`; `hinter_proxy` → `SingleProxy`; sonst `Peer`.
  - `RelaisState::neu(pool, registrierungen_stunde, client_ip: ClientIpSource, apns, limit_minute)`; Feld `pub client_ip: ClientIpSource` statt `hinter_proxy`. `api.rs` ruft `client_ip::client_ip(&state.client_ip, …)`, die alte Funktion entfällt.

- [ ] **Step 1: Tests schreiben**
  - `config.rs` (`#[cfg(test)]`, `RelaisConfig::try_parse_from`): `trusted_proxies_als_liste` (`--trusted-proxies 10.0.1.0/24,173.245.48.0/20` → zwei Netze, Quelle `TrustedProxies`); `hostname_in_der_liste_bricht_ab` (`traefik` → Err); `leerer_eintrag_bricht_ab` (`10.0.1.5,` → Err); `gemapptes_netz_bricht_ab` (`::ffff:10.0.0.0/104` → Err); `beide_gesetzt_bricht_ab` (`--hinter-proxy --trusted-proxies 10.0.1.0/24` → `client_ip_source()` Err); `schalter_allein_bleibt_ein_proxy` (→ `SingleProxy`); `ohne_angabe_zaehlt_die_gegenstelle` (→ `Peer`).
  - `tests/registrierung.rs`: `hinter_cloudflare_zaehlt_die_adresse_des_clients` — Grenze 1, Liste `10.0.1.0/24,173.245.48.0/20`, Gegenstelle `10.0.1.5`; `198.51.100.1, 203.0.113.7, 173.245.48.10` → 200; `198.51.100.2, 203.0.113.7, 173.245.48.11` → 429 (gleicher Client, anderer Knoten, anderer gefälschter Eintrag); `203.0.113.8, 173.245.48.10` → 200 (anderer Client, gleicher Knoten); Gegenstelle `192.0.2.1` mit XFF `203.0.113.9` zweimal → zweites 429, dann Gegenstelle `192.0.2.2` mit XFF `203.0.113.9` → 200 (Header zählt dort nicht).
  - Bestehende Aufrufe `RelaisState::neu(…, false, …)` → `ClientIpSource::Peer`, `true` → `ClientIpSource::SingleProxy`.
- [ ] **Step 2:** `mise exec -- cargo test -p push-relais` → FAIL (Kompilierfehler).
- [ ] **Step 3:** Umsetzen; `main.rs` ruft `cfg.client_ip_source()?` vor dem Bind.
- [ ] **Step 4:** `mise exec -- cargo test -p push-relais` → alle PASS; `mise exec -- cargo clippy -p push-relais --all-targets` ohne neue Warnungen.
- [ ] **Step 5: Commit** `fix(push-relais): PUSH_RELAIS_TRUSTED_PROXIES verdrahten (LLH-2080)`.

### Task 3: Doku und Regel

**Files:**
- Modify: `docs/betrieb/push-relais.md`, `push-relais/AGENTS.md`, `docs/betrieb/env-registry.md` (Zeile `LIFELINE_TRUSTED_PROXIES`), `docs/architektur/07-verteilungssicht.md` (Zeile `push-relais`), ggf. `docs/architektur/05-bausteinsicht.md` Abschnitt `push-relais`, falls er `HINTER_PROXY` oder die Client-IP nennt.

- [ ] **Step 1:** `push-relais.md`: Tabellenzeile `PUSH_RELAIS_TRUSTED_PROXIES` (Standard leer); Absatz zu `HINTER_PROXY` sagt „ein Proxy ohne CDN“ und dass beide zusammen den Start abbrechen; neuer Abschnitt „Hinter einem CDN (r-server: Cloudflare)“: Grund (LLH-2080), Traefik-Arg `--entrypoints.<name>.forwardedHeaders.trustedIPs=…`, Relais-Umgebung, `LIFELINE_TRUSTED_PROXIES` des Hauptservers, die Cloudflare-Liste mit Quelle `https://www.cloudflare.com/ips/` und Stand 23.11.2026, Prüfhinweis (Liste gelegentlich abgleichen); Beispiel `docker run` und Abschnitt „Domain und TLS“ angleichen.
- [ ] **Step 2:** `push-relais/AGENTS.md`: Regel „Client-IP hinter dem Proxy …“ ersetzen: Quelle `client_ip::ClientIpSource`; mit Liste von rechts, erster Eintrag außerhalb der Liste; ohne Liste mit Schalter genau ein Proxy; links Liegendes zählt nie.
- [ ] **Step 3:** `env-registry.md`: ein Satz „Steht ein CDN davor (r-server: Cloudflare), dessen Bereiche mit eintragen und dem Proxy ebenso vertrauen lassen; siehe `push-relais.md`, Abschnitt …“. `07-verteilungssicht.md`: `PUSH_RELAIS_TRUSTED_PROXIES` statt nur `PUSH_RELAIS_HINTER_PROXY`.
- [ ] **Step 4:** `mise exec -- pnpm exec prettier --check` ist für `docs/` nicht zuständig; `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 5: Commit** `docs(push-relais): Betrieb hinter Cloudflare (LLH-2080)`.

# LFH-277 Auth-Härtung Kernset (5 Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fünf fail-safe Härtungs-Items aus den Auth-Reviews (Inc 1–3, LFH-57) umsetzen: OIDC-State→Cookie-Binding, Discovery-Refresh, race-freie Provisionierung, Registry-Exhaustiveness, sowie den Split des öffentlichen Provider-Endpoints in enabled-only-public vs. admin-full-state.

**Architektur:** Jedes Item ist ein eigenständiger TDD-Zyklus mit eigenem Commit. Items 1/2/3/7a/7b sind rein Backend (Rust); Item 6 ist backend + frontend + Typ-Codegen. Kein Item verändert das Datenbankschema (Item 3 nutzt den bestehenden partiellen UNIQUE-Index `idx_benutzer_oidc`).

**Tech Stack:** Rust (axum, sqlx/SQLite, openidconnect v4, tokio), React/TypeScript (antd, TanStack Query), utoipa→openapi-typescript-Codegen.

## Global Constraints

- **Bucket bleibt offen:** LFH-277 ist ein Sammel-Bucket. Diese 5 Items sind ein Teil davon; Items „Admin-Linking + Claims→Rollen" (4/5) und „TLS cache_gueltig" (8) bleiben deferred. Nach dem Merge NICHT auf `shipped`/`done` — erledigte Items in der ClickUp-Beschreibung abtragen, Bucket-Status auf `backlog`/offen zurück.
- **Rust-Gate = `cargo test`** (nicht clippy). Fmt muss clean bleiben: nach jedem Rust-Change `cargo fmt --all`, Gate ist `scripts/check-fmt.sh`.
- **Saubere Test-Env (MUST):** Dev-Vars leaken aus der Shell und kippen Security-Tests / machen die Suite flaky. Jeden `cargo test`-Lauf mit diesem Prefix fahren:
  ```
  env -u AWS_REGION -u AWS_ENDPOINT -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_ALLOW_HTTP \
      -u LIFELINE_OIDC_ISSUER -u LIFELINE_OIDC_CLIENT_SECRET -u LIFELINE_OIDC_REDIRECT_URL -u LIFELINE_OIDC_CLIENT_ID \
      -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_KARTEN_SERVICE_URL -u LIFELINE_KARTEN_SERVICE_TOKEN \
      -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL -u KS_BIND -u KS_TOKEN -u KS_STORAGE_BUCKET -u KS_BASE_URL \
      cargo test <args>
  ```
  Exit-Code NIE durch `| tail`/`| head` maskieren — der Pipe-Exit ist der von `tail`, nicht von cargo. Zum Kürzen `cargo test … 2>&1 > out.log; echo $status` oder grep im Log auf `test result: FAILED`.
- **!Send-Disziplin (MUST):** Kein `std::sync`-Mutex/RwLock-Guard über ein `.await`. Sonst wird der axum-Handler `!Send` (current-thread-Tests fangen das NICHT; der Kompilier-Test `oidc::tests::oidc_client_future_ist_send` bricht). Für async-Caching `tokio::sync`-Primitive verwenden.
- **OIDC Detail-Leak-Verbot:** Kein IdP-/Token-/Claims-Detail in HTTP-Antworten. Fehler münden generisch in `Redirect::to("/login?fehler=oidc")` (`oidc_fehler_redirect()`), Detail nur ins Server-Log (`tracing::warn!`).
- **Cookie-Idiom:** `Secure`-Flag über `crate::auth::session::cookie_secure()` (Default false in Tests), `HttpOnly` immer.
- **Frontend über mise:** `mise exec pnpm@<ver> -- pnpm -C <abs-pfad> …`, absolute `-C`-Pfade. Lint läuft mit `--max-warnings 0`.

---

### Task 1: Item 7b — Leere/Whitespace-`anzeigename`-Claims filtern (OIDC-Provisioning)

Heute: `finde_oder_provisioniere` setzt `anzeigename = claims.name.or(preferred_username).unwrap_or(subject)`. Ist `name`/`preferred_username` = `Some("")` oder `Some("   ")`, wird ein leerer/whitespace-Anzeigename gespeichert. `plane_benutzername` trimmt+filtert `preferred_username` bereits — `anzeigename` soll gleichgezogen werden.

**Files:**
- Modify: `src/auth/oidc/provisioning.rs` (Anzeigename-Ableitung in `finde_oder_provisioniere`, ~Z129-133; neue reine Helferfunktion)
- Test: `src/auth/oidc/provisioning.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `fn plane_anzeigename(claims: &OidcClaims) -> String` (pur, kein DB-Zugriff) — Kandidatenreihenfolge `name` → `preferred_username` → `subject`, je getrimmt und leer-gefiltert.

- [ ] **Step 1: Failing test schreiben** — in `mod tests` von `provisioning.rs`:

```rust
    // --- plane_anzeigename (pur, keine DB) ---

    #[test]
    fn anzeigename_ueberspringt_leere_und_whitespace_claims() {
        // name = whitespace, preferred_username = leer → Fallback auf subject.
        let c = claims("https://idp.example", "sub-x", Some(""), Some("   "));
        assert_eq!(plane_anzeigename(&c), "sub-x");
    }

    #[test]
    fn anzeigename_nimmt_name_vor_preferred_username() {
        let c = claims("https://idp.example", "sub-x", Some("maxmuster"), Some("Max Mustermann"));
        assert_eq!(plane_anzeigename(&c), "Max Mustermann");
    }

    #[test]
    fn anzeigename_faellt_auf_preferred_username_wenn_name_leer() {
        let c = claims("https://idp.example", "sub-x", Some("maxmuster"), Some("  "));
        assert_eq!(plane_anzeigename(&c), "maxmuster");
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib auth::oidc::provisioning::tests::anzeigename 2>&1 > /tmp/t1.log; echo EXIT=$status; grep -E "cannot find|test result" /tmp/t1.log`
Expected: FAIL — `cannot find function 'plane_anzeigename'`.

- [ ] **Step 3: `plane_anzeigename` implementieren** — nahe `plane_benutzername` einfügen:

```rust
/// Leitet den Anzeigenamen aus den Claims ab — **pur**, kein DB-Zugriff. Kandidaten in der
/// Reihenfolge `name` → `preferred_username` → `subject`; jeder wird getrimmt und nur genommen,
/// wenn er nach dem Trimmen nicht leer ist (analog zu `plane_benutzername`s `preferred_username`-
/// Behandlung). `subject` ist immer nicht-leer (OIDC-Pflichtclaim), daher terminiert die Kette.
pub fn plane_anzeigename(claims: &OidcClaims) -> String {
    [claims.name.as_deref(), claims.preferred_username.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or_else(|| claims.subject.trim())
        .to_string()
}
```

- [ ] **Step 4: Aufrufstelle umstellen** — in `finde_oder_provisioniere` die Z129-133-Ableitung ersetzen:

```rust
    let anzeigename = plane_anzeigename(claims);
```

- [ ] **Step 5: Tests grün verifizieren**

Run: `<env-prefix> cargo test --lib auth::oidc::provisioning 2>&1 > /tmp/t1.log; echo EXIT=$status; grep "test result" /tmp/t1.log`
Expected: PASS (alle provisioning-Tests, inkl. `unbekannter_issuer_sub_legt_least_privilege_konto_an`).

- [ ] **Step 6: fmt + Commit**

```bash
cargo fmt --all
git add src/auth/oidc/provisioning.rs
git commit -m "fix(lfh-277): leere/whitespace anzeigename-Claims in OIDC-Provisioning filtern"
```

---

### Task 2: Item 7a — Registry `typ()`/`anzeigename()` exhaustiv (Compile-Zwang je Provider)

Heute: `typ(id: &str)` fällt für unbekannte IDs still auf `AuthProviderTyp::Passwort` zurück (latenter Bug: eine unbekannte ID würde als Passwort-Login gerendert), `anzeigename` auf `"Unbekannt"`. Ein neu hinzugefügter Provider-Const zwingt heute NICHT dazu, `typ`/`anzeigename` zu pflegen. Fix: eine private, exhaustiv gematchte `ProviderId`-Enum als interne Wahrheitsquelle; `konfiguriert()` liefert typisierte IDs, der `_ =>`-Fallback verschwindet.

**Files:**
- Modify: `src/auth/provider/registry.rs` (neue `enum ProviderId` + Methoden; `konfiguriert`/`liste`/`ist_admin_tauglich`/`darf_deaktivieren`/`schalten` intern auf `ProviderId` umstellen; String-`typ`/`anzeigename`-Fns entfernen)
- Test: `src/auth/provider/registry.rs` (`mod tests`)

**Interfaces:**
- Consumes: `ID_PASSWORT`/`ID_DEV`/`ID_OIDC`/`ID_WEBAUTHN` (`&'static str`, aus `provider/mod.rs`), `AuthProviderTyp`, `AuthProviderAnzeige`.
- Produces (privat, modul-intern): `enum ProviderId { Passwort, Dev, Oidc, Webauthn }` mit `as_str(self)->&'static str`, `typ(self)->AuthProviderTyp`, `anzeigename(self)->&'static str`, `parse(&str)->Option<ProviderId>`, `const ALLE: [ProviderId; 4]`. Öffentliche Signaturen (`pub async fn liste`, `pub async fn schalten(pool, id: &str, aktiviert)`) bleiben **unverändert**.

- [ ] **Step 1: Failing test schreiben** — in `mod tests` von `registry.rs`:

```rust
    #[test]
    fn provider_id_parse_roundtrip_und_unbekannt_none() {
        for p in ProviderId::ALLE {
            assert_eq!(ProviderId::parse(p.as_str()), Some(p));
        }
        assert_eq!(ProviderId::parse("gibtsnicht"), None);
    }

    #[test]
    fn provider_id_typ_und_anzeigename_stimmen() {
        assert_eq!(ProviderId::Oidc.typ(), AuthProviderTyp::Oidc);
        assert_eq!(ProviderId::Oidc.anzeigename(), "PocketID");
        assert_eq!(ProviderId::Webauthn.anzeigename(), "Passkey");
        // Keine unbekannte ID mehr rendert still als Passwort:
        assert_eq!(ProviderId::parse("gibtsnicht").map(|p| p.typ()), None);
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib auth::provider::registry::tests::provider_id 2>&1 > /tmp/t2.log; echo EXIT=$status; grep -E "cannot find|not found|test result" /tmp/t2.log`
Expected: FAIL — `ProviderId` unbekannt.

- [ ] **Step 3: `ProviderId`-Enum implementieren** — oben in `registry.rs` (nach den `use`-Imports), und die alten String-`typ`/`anzeigename`-Fns (Z87-104) entfernen:

```rust
/// Interne, exhaustiv gematchte Wahrheitsquelle über alle Provider-Arten. Neue Provider zwingen
/// den Compiler, `as_str`/`typ`/`anzeigename` UND `ALLE` zu pflegen — kein stiller Default mehr
/// (früher fiel `typ(&str)` für Unbekanntes auf `Passwort`, was eine unbekannte ID als
/// Passwort-Login gerendert hätte).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderId {
    Passwort,
    Dev,
    Oidc,
    Webauthn,
}

impl ProviderId {
    /// Alle Varianten. Bei einer neuen Variante bricht die Array-Länge den Build → bewusster
    /// Pflege-Anker (zusammen mit den exhaustiven `match`-Armen unten).
    const ALLE: [ProviderId; 4] = [
        ProviderId::Passwort,
        ProviderId::Dev,
        ProviderId::Oidc,
        ProviderId::Webauthn,
    ];

    fn as_str(self) -> &'static str {
        match self {
            ProviderId::Passwort => ID_PASSWORT,
            ProviderId::Dev => ID_DEV,
            ProviderId::Oidc => ID_OIDC,
            ProviderId::Webauthn => ID_WEBAUTHN,
        }
    }

    fn typ(self) -> AuthProviderTyp {
        match self {
            ProviderId::Passwort => AuthProviderTyp::Passwort,
            ProviderId::Dev => AuthProviderTyp::Dev,
            ProviderId::Oidc => AuthProviderTyp::Oidc,
            ProviderId::Webauthn => AuthProviderTyp::Webauthn,
        }
    }

    fn anzeigename(self) -> &'static str {
        match self {
            ProviderId::Passwort => "Passwort",
            ProviderId::Dev => "Dev-Schnellanmeldung",
            ProviderId::Oidc => "PocketID",
            ProviderId::Webauthn => "Passkey",
        }
    }

    fn parse(id: &str) -> Option<ProviderId> {
        ProviderId::ALLE.into_iter().find(|p| p.as_str() == id)
    }

    /// Ob sich ein Admin über diesen Provider verlässlich anmelden kann (Lockout-Schutz-MUST).
    /// MUST (LFH-41/LFH-275): NUR `passwort`. „oidc"/„webauthn" kommen erst mit Admin-Linking +
    /// transaktionalem Guard (LFH-277 deferred), sonst könnte sich ein Admin durch Deaktivieren
    /// von `passwort` aussperren.
    fn ist_admin_tauglich(self) -> bool {
        matches!(self, ProviderId::Passwort)
    }
}
```

- [ ] **Step 4: `konfiguriert()` auf `ProviderId` umstellen** — Rückgabetyp `Vec<ProviderId>`:

```rust
/// Im aktuellen Build konfigurierte Provider (Quelle der Wahrheit).
fn konfiguriert() -> Vec<ProviderId> {
    let mut v = vec![ProviderId::Passwort];
    if dev_verfuegbar() {
        v.push(ProviderId::Dev);
    }
    if oidc_konfiguriert() {
        v.push(ProviderId::Oidc);
    }
    if webauthn_konfiguriert() {
        v.push(ProviderId::Webauthn);
    }
    v
}
```

- [ ] **Step 5: `liste`/`darf_deaktivieren`/`schalten` an den typisierten `konfiguriert()` anpassen**

`liste` (ersetzt Z107-121):

```rust
pub async fn liste(pool: &SqlitePool) -> Result<Vec<AuthProviderAnzeige>, AppError> {
    let rows: Vec<(String, bool)> = sqlx::query_as("SELECT id, aktiviert FROM auth_provider")
        .fetch_all(pool)
        .await?;
    let override_map: HashMap<String, bool> = rows.into_iter().collect();
    Ok(konfiguriert()
        .into_iter()
        .map(|p| AuthProviderAnzeige {
            typ: p.typ(),
            anzeigename: p.anzeigename().to_string(),
            aktiviert: *override_map.get(p.as_str()).unwrap_or(&true),
            id: p.as_str().to_string(),
        })
        .collect())
}
```

`darf_deaktivieren` (Guard nutzt jetzt `ProviderId::parse` + `ist_admin_tauglich`; ersetzt Z128-145):

```rust
async fn darf_deaktivieren(pool: &SqlitePool, id: &str) -> Result<bool, AppError> {
    // Unbekannt/nicht admin-tauglich → immer erlaubt (der NotFound-Fall wird in `schalten`
    // separat gefangen). `parse` liefert für alles außerhalb der bekannten Provider `None`.
    let admin_tauglich = ProviderId::parse(id).is_some_and(ProviderId::ist_admin_tauglich);
    if !admin_tauglich {
        return Ok(true);
    }
    let aktive_admins: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM benutzer WHERE system_rolle = ? AND aktiv = 1")
            .bind(crate::auth::ROLLE_ADMIN)
            .fetch_one(pool)
            .await?;
    if aktive_admins == 0 {
        return Ok(true);
    }
    // Bliebe nach dem Deaktivieren noch ein anderer aktivierter admin-tauglicher Provider?
    let liste = liste(pool).await?;
    Ok(liste.iter().any(|p| {
        p.id != id
            && p.aktiviert
            && ProviderId::parse(&p.id).is_some_and(ProviderId::ist_admin_tauglich)
    }))
}
```

`schalten` — die `konfiguriert().contains(&id)`-Prüfung (Z150) auf `as_str()` umstellen:

```rust
    if !konfiguriert().iter().any(|p| p.as_str() == id) {
        return Err(AppError::NotFound);
    }
```

- [ ] **Step 6: Bestehende Tests an privaten Namen anpassen** — die Tests `admin_tauglich_bleibt_nur_passwort`/`admin_tauglich_ohne_webauthn` (Z239-252) rufen die alte `ist_admin_tauglich(&str)`. Auf die Enum-Methode umstellen:

```rust
    #[test]
    fn admin_tauglich_bleibt_nur_passwort() {
        assert!(ProviderId::Passwort.ist_admin_tauglich());
        assert!(!ProviderId::Oidc.ist_admin_tauglich());
    }

    #[test]
    fn admin_tauglich_ohne_webauthn() {
        assert!(!ProviderId::Webauthn.ist_admin_tauglich());
    }
```

- [ ] **Step 7: Voll-Modul grün verifizieren** (die `liste`/`schalten`-Verhaltenstests dürfen sich NICHT ändern)

Run: `<env-prefix> cargo test --lib auth::provider::registry 2>&1 > /tmp/t2.log; echo EXIT=$status; grep "test result" /tmp/t2.log`
Expected: PASS — alle Registry-Tests inkl. `liste_enthaelt_passwort_default_aktiv`, `passwort_kann_nicht_deaktiviert_werden_mit_admin`, `oidc_gelistet_wenn_konfiguriert`, `webauthn_gelistet_wenn_konfiguriert`.

- [ ] **Step 8: fmt + Commit**

```bash
cargo fmt --all
git add src/auth/provider/registry.rs
git commit -m "refactor(lfh-277): Registry-Provider exhaustiv via ProviderId-Enum (kein stiller Passwort-Default)"
```

---

### Task 3: Item 1 — OIDC-`state` an HttpOnly-Cookie binden (Session-Fixation-Defense)

Heute: `oidc_start` speichert nur im prozessweiten State-Store (Map-Key = `csrf`/`state`), setzt kein Cookie; `oidc_callback` prüft nur `state::entnehme`. Ein Angreifer kann seinen eigenen `state`+Flow ins Opfer-Browser injizieren (Session-Fixation). Fix: `oidc_start` setzt ein kurzlebiges HttpOnly-Cookie mit dem `state`-Wert; `oidc_callback` erzwingt `cookie == query.state` zusätzlich zum State-Store und entfernt das Cookie auf JEDEM Pfad.

**MUST — SameSite=Lax:** Der Callback kommt als top-level Cross-Site-Redirect vom IdP. Bei `SameSite=Strict` würde der Browser das Cookie dort NICHT mitsenden → Binding-Check schlägt immer fehl → OIDC-Login kaputt. Also `Lax`. Nicht blind das Session-Cookie-SameSite übernehmen.

**Files:**
- Modify: `src/routes/auth.rs` (`oidc_start` → `(CookieJar, Redirect)` + Cookie setzen; `oidc_callback` → Cookie-Match + Removal; neue Cookie-Bau-/Removal-Helfer + Konstante)
- Modify: `src/app.rs` — nichts (Route-Signatur bleibt kompatibel: `oidc_start` gibt jetzt `(CookieJar, Redirect)` statt `Redirect`; axum akzeptiert das, aber `oidc_start` braucht dafür den `CookieJar`-Extractor).
- Test: `tests/` — Integrationstest ODER `src/routes/auth.rs`-Unit-Tests. Prüfe zuerst, wo OIDC-Handler heute getestet werden: `grep -rn "oidc_callback\|oidc_start" tests/ src/routes/auth.rs`. Neue Tests am selben Ort ergänzen.

**Interfaces:**
- Consumes: `crate::auth::session::cookie_secure()`, `axum_extra::extract::cookie::{Cookie, CookieJar, SameSite}` (bereits im Crate genutzt — via `grep -n "SameSite\|CookieJar\|cookie::Cookie" src/auth/session.rs src/routes/auth.rs` das exakte Import-/Builder-Idiom übernehmen).
- Produces: Konstante `const OIDC_STATE_COOKIE: &str = "oidc_state";`; `oidc_start` neue Signatur `(State, CookieJar, Query) -> Result<(CookieJar, Redirect), AppError>`.

- [ ] **Step 0: Test-Ort + Cookie-Idiom ermitteln**

Run: `grep -rn "oidc_callback\|oidc_start\|SameSite\|CookieJar\|cookie::Cookie\|\.max_age(\|cookie_secure" src/routes/auth.rs src/auth/session.rs tests/*.rs`
Damit den exakten `Cookie::build`-Stil (Builder vs. `Cookie::new`), `SameSite`-Import und die vorhandene OIDC-Testinfrastruktur (falls vorhanden) übernehmen. Falls es KEINE bestehenden Handler-Level-OIDC-Tests gibt, werden die neuen Tests als reine Unit-Tests der neuen Cookie-Helfer + eine `oidc_callback`-Guard-Prüfung geschrieben (siehe Step 1).

- [ ] **Step 1: Failing test schreiben** — Cookie-Bau/-Removal als pure Helfer testbar machen. In `src/routes/auth.rs` `#[cfg(test)] mod tests` (bzw. dort ergänzen):

```rust
    #[test]
    fn oidc_state_cookie_ist_httponly_lax_und_pfadweit() {
        let c = baue_oidc_state_cookie("abc123".to_string());
        assert_eq!(c.name(), OIDC_STATE_COOKIE);
        assert_eq!(c.value(), "abc123");
        assert_eq!(c.http_only(), Some(true));
        // MUST Lax (nicht Strict): Cross-Site-Redirect vom IdP muss das Cookie mitschicken.
        assert_eq!(c.same_site(), Some(SameSite::Lax));
        assert_eq!(c.path(), Some("/"));
    }

    #[test]
    fn oidc_state_removal_cookie_leert_wert() {
        let c = raeume_oidc_state_cookie();
        assert_eq!(c.name(), OIDC_STATE_COOKIE);
        assert_eq!(c.value(), "");
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib routes::auth::tests::oidc_state 2>&1 > /tmp/t3.log; echo EXIT=$status; grep -E "cannot find|test result" /tmp/t3.log`
Expected: FAIL — Helfer/Konstante fehlen.

- [ ] **Step 3: Konstante + Cookie-Helfer implementieren** — in `src/routes/auth.rs` (Import von `SameSite` an den bestehenden `axum_extra::extract::cookie`-Import angleichen, den Step 0 ermittelt hat):

```rust
/// Name des kurzlebigen Binding-Cookies für den OIDC-`state` (Session-Fixation-Defense, LFH-277).
const OIDC_STATE_COOKIE: &str = "oidc_state";

/// Baut das HttpOnly-Binding-Cookie: Wert = `state`/`csrf`, Lebensdauer analog State-Store-TTL
/// (10 min). **SameSite=Lax (MUST):** der Callback trifft als Cross-Site-Top-Level-Redirect vom
/// IdP ein — bei `Strict` würde das Cookie dort fehlen und der Binding-Check immer scheitern.
/// `Secure` folgt `session::cookie_secure()` (in Prod true).
fn baue_oidc_state_cookie(state: String) -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, state))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(crate::auth::session::cookie_secure())
        .path("/")
        .max_age(time::Duration::minutes(10))
        .build()
}

/// Removal-Cookie (leerer Wert, sofort abgelaufen) — auf JEDEM Callback-Pfad gesetzt, damit das
/// Binding-Cookie nach genau einem Flow verschwindet.
fn raeume_oidc_state_cookie() -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, ""))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(crate::auth::session::cookie_secure())
        .path("/")
        .max_age(time::Duration::seconds(0))
        .build()
}
```

*(Hinweis: `time::Duration` ist die `time`-Crate, wie axum-extra sie für `max_age` erwartet. Falls session.rs ein anderes Removal-Idiom nutzt — z.B. `jar.remove(Cookie::from(name))` — dieses übernehmen und den Removal-Test entsprechend anpassen.)*

- [ ] **Step 4: `oidc_start` Cookie setzen** — Signatur auf `(CookieJar, Redirect)`:

```rust
pub async fn oidc_start(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<OidcStartQuery>,
) -> Result<(CookieJar, Redirect), AppError> {
    // ... unveränderter Registry-Enforcement- + oidc_client- + PKCE/authorize_url-Block ...
    // NACH `state::speichere(...)`:
    let jar = jar.add(baue_oidc_state_cookie(csrf.secret().clone()));
    Ok((jar, Redirect::to(auth_url.as_str())))
}
```

- [ ] **Step 5: `oidc_callback` Binding erzwingen + Cookie räumen** — nach der Registry-Enforcement, VOR/bei der `state`-Verarbeitung. Das Removal-Cookie wird in JEDEN Rückgabepfad eingewoben (Erfolg wie Fehler). Konkret: das Binding prüfen, sobald `state_key` feststeht, und `jar = jar.add(raeume_oidc_state_cookie())` vor jedem `return`:

```rust
    // Binding-Check (Session-Fixation-Defense, LFH-277): der im Browser gesetzte state-Cookie
    // MUSS dem zurückgegebenen `state`-Query entsprechen. Fehlt/mismatcht er → generischer
    // Redirect wie jeder andere Fehler. Cookie in JEDEM Fall räumen.
    let jar = jar.add(raeume_oidc_state_cookie());
    let cookie_state = jar.get(OIDC_STATE_COOKIE).map(|c| c.value().to_string());
    // (jar.get sieht das gerade hinzugefügte Removal-Cookie — daher VOR dem add lesen:)
```

  Umsetzungsdetail: den Wert VOR dem Räumen lesen. Reihenfolge im Handler:
  1. Registry-Enforcement (unverändert).
  2. IdP-Error/fehlende Felder-Guard (Z347-352) → dort `jar` mit Removal ergänzen: `return Ok((jar.add(raeume_oidc_state_cookie()), oidc_fehler_redirect()));`
  3. `let cookie_state = jar.get(OIDC_STATE_COOKIE).map(|c| c.value().to_string());` (vor Removal).
  4. `let jar = jar.add(raeume_oidc_state_cookie());` (ab jetzt trägt jeder Rückgabepfad das Removal).
  5. Binding: `if cookie_state.as_deref() != Some(state_key.as_str()) { return Ok((jar, oidc_fehler_redirect())); }`
  6. Restlicher Flow unverändert; alle bestehenden `return Ok((jar, ...))`/Erfolgspfade tragen das geräumte `jar`.

- [ ] **Step 6: Failing test für den Binding-Guard** — Handler-Level-Test (am in Step 0 gefundenen Ort). Falls die OIDC-Handler bereits per Router-Test (`axum::Router`/`tower::ServiceExt::oneshot`) getestet werden, dort einen Fall ergänzen: Callback mit gültigem `state`-Query ABER ohne/mit falschem `oidc_state`-Cookie → `303`-Redirect auf `/login?fehler=oidc`, keine Session gesetzt. Falls keine solche Infrastruktur existiert, wird der Binding-Vergleich als reine Funktion extrahiert und direkt getestet:

```rust
    #[test]
    fn binding_match_nur_bei_gleichem_state() {
        assert!(oidc_state_binding_ok(Some("s1"), "s1"));
        assert!(!oidc_state_binding_ok(Some("anders"), "s1"));
        assert!(!oidc_state_binding_ok(None, "s1"));
    }
```

  mit Helfer:

```rust
/// True nur, wenn der Binding-Cookie-Wert exakt dem zurückgegebenen `state` entspricht.
fn oidc_state_binding_ok(cookie_state: Option<&str>, state_query: &str) -> bool {
    cookie_state == Some(state_query)
}
```

  und Step 5 nutzt `oidc_state_binding_ok(cookie_state.as_deref(), &state_key)`.

- [ ] **Step 7: Alle Tests grün + `Send`-Kompilier-Test**

Run: `<env-prefix> cargo test --lib routes::auth 2>&1 > /tmp/t3.log; echo EXIT=$status; grep "test result" /tmp/t3.log`
Danach die volle Integrations-Suite für auth (falls `tests/auth*.rs` existiert): `<env-prefix> cargo test --test <authtest> 2>&1 > /tmp/t3b.log; echo EXIT=$status; grep "test result" /tmp/t3b.log`
Expected: PASS. Insbesondere `oidc::tests::oidc_client_future_ist_send` bleibt grün (kein Guard über await).

- [ ] **Step 8: fmt + Commit**

```bash
cargo fmt --all
git add src/routes/auth.rs
git commit -m "fix(lfh-277): OIDC-state an HttpOnly-Lax-Cookie binden (Session-Fixation-Defense)"
```

---

### Task 4: Item 3 — Transaktionale/race-freie OIDC-Provisionierung

Heute: `finde_oder_provisioniere` macht `SELECT` (kein Treffer) → `INSERT` → `last_insert_rowid()` → Re-SELECT. Bei Concurrent-First-Login desselben `(issuer, subject)` schlägt der zweite `INSERT` fehl: auf `idx_benutzer_oidc` (partieller UNIQUE auf `(oidc_issuer, oidc_subject)`) UND potenziell auf `benutzer.benutzername UNIQUE` (beide Racer berechnen denselben Namen). Das propagiert heute als 500.

**MUST (Advisor-Korrektur):**
1. `last_insert_rowid()` ist nach einem geschluckten Konflikt WERTLOS (liefert die rowid eines fremden früheren Inserts der Connection) → immer per `(issuer, subject)` re-SELECTen, nie per rowid.
2. Weil der Race ZWEI Unique-Constraints treffen kann und SQLite die zuerst geprüfte meldet, NICHT auf ein einzelnes `ON CONFLICT`-Target verlassen. Robust: `INSERT` versuchen → bei JEDEM Unique-Fehler den `(issuer, subject)`-SELECT wiederholen → gefundene Zeile zurückgeben, sonst den Fehler propagieren (echte, fremde `benutzername`-Kollision).

**Files:**
- Modify: `src/auth/oidc/provisioning.rs` (`finde_oder_provisioniere` Insert-/Rückgabeblock Z135-161)
- Test: `src/auth/oidc/provisioning.rs` (`mod tests`)

**Interfaces:**
- Consumes: `sqlx::Error` (Unique-Violation-Erkennung), bestehender partieller Index `idx_benutzer_oidc`.
- Produces: unveränderte Signatur `pub async fn finde_oder_provisioniere(pool, claims) -> Result<Benutzer, AppError>`; neue reine Prädikatsfunktion `fn ist_unique_verletzung(err: &sqlx::Error) -> bool`.

- [ ] **Step 1: Failing test — Unique-Verletzungs-Erkennung** (pur, ohne Race):

```rust
    #[tokio::test]
    async fn ist_unique_verletzung_erkennt_doppelten_benutzernamen() {
        let pool = crate::db::test_pool().await;
        seed_org(&pool).await;
        seed_lokalen_benutzer(&pool, "kollision").await;
        // Zweiter Insert desselben benutzernamens → UNIQUE-Fehler.
        let err = sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'X', 'kollision', 'h', 1)",
        )
        .execute(&pool)
        .await
        .unwrap_err();
        assert!(ist_unique_verletzung(&err), "erwartete Unique-Erkennung, fand {err:?}");
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib auth::oidc::provisioning::tests::ist_unique 2>&1 > /tmp/t4.log; echo EXIT=$status; grep -E "cannot find|test result" /tmp/t4.log`
Expected: FAIL — `ist_unique_verletzung` fehlt.

- [ ] **Step 3: `ist_unique_verletzung` + race-festen Insert implementieren** — Z135-161 ersetzen:

```rust
    // Re-SELECT-Helfer für den (issuer, subject)-Schlüssel — nach INSERT (statt last_insert_rowid,
    // das nach einem geschluckten Konflikt eine fremde rowid liefern würde) und im Race-Recover.
    let select_by_oidc = |pool: &SqlitePool, issuer: String, subject: String| async move {
        sqlx::query_as::<_, Benutzer>(
            "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
             FROM benutzer WHERE oidc_issuer = ? AND oidc_subject = ?",
        )
        .bind(issuer)
        .bind(subject)
        .fetch_optional(pool)
        .await
    };

    let insert_ergebnis = sqlx::query(
        "INSERT INTO benutzer \
         (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, oidc_issuer, oidc_subject) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind(&anzeigename)
    .bind(&benutzername)
    .bind(PASSWORT_HASH_SSO_ONLY)
    .bind(ROLLE_KEINER)
    .bind(ORG_ROLLE_KEINE)
    .bind(&claims.issuer)
    .bind(&claims.subject)
    .execute(pool)
    .await;

    match insert_ergebnis {
        // Normalfall: wir haben das Konto angelegt. Re-SELECT per (issuer, subject) — NICHT per
        // last_insert_rowid (siehe oben).
        Ok(_) => select_by_oidc(pool, claims.issuer.clone(), claims.subject.clone())
            .await?
            .ok_or_else(|| AppError::Internal("Angelegtes SSO-Konto nicht wiederauffindbar".into())),
        // Race-Recover: ein paralleler First-Login hat dasselbe (issuer, subject) — oder denselben
        // benutzernamen — zuerst eingefügt. Bei JEDEM Unique-Fehler den (issuer, subject)-SELECT
        // wiederholen: findet er die Zeile des Race-Gewinners, ist der Login gültig; sonst war es
        // eine echte, fremde benutzername-Kollision → Fehler propagieren.
        Err(err) if ist_unique_verletzung(&err) => {
            match select_by_oidc(pool, claims.issuer.clone(), claims.subject.clone()).await? {
                Some(vorhanden) => Ok(vorhanden),
                None => Err(AppError::from(err)),
            }
        }
        Err(err) => Err(AppError::from(err)),
    }
```

  und die Prädikatsfunktion (Modul-Ebene):

```rust
/// True, wenn `err` eine SQLite-UNIQUE-Constraint-Verletzung ist (Race-Recover-Trigger).
fn ist_unique_verletzung(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db) if db.is_unique_violation())
}
```

  *(Verifiziere den `From<sqlx::Error> for AppError`-Pfad: `grep -n "sqlx::Error" src/error.rs` — existiert er, ist `AppError::from(err)` korrekt; sonst den vorhandenen `?`-Konvertierungsweg nutzen.)*

- [ ] **Step 4: Failing test — Race-Recover-Semantik** (sequenziell simuliert: zweiter Aufruf mit identischem (issuer,sub) darf keinen zweiten Insert erzeugen; ein manuell vorab eingefügtes Konto wird gefunden):

```rust
    #[tokio::test]
    async fn zweiter_erstlogin_desselben_subjects_liefert_bestehendes_konto() {
        let pool = crate::db::test_pool().await;
        seed_org(&pool).await;
        let c = claims("https://idp.example", "sub-race", Some("racer"), None);

        // Simuliert den Race-Gewinner: Konto existiert bereits mit (issuer, subject).
        sqlx::query(
            "INSERT INTO benutzer \
             (org_id, anzeigename, benutzername, passwort_hash, oidc_issuer, oidc_subject) \
             VALUES (1, 'Racer', 'racer', ?, 'https://idp.example', 'sub-race')",
        )
        .bind(PASSWORT_HASH_SSO_ONLY)
        .execute(&pool)
        .await
        .unwrap();

        let benutzer = finde_oder_provisioniere(&pool, &c).await.unwrap();
        assert_eq!(benutzer.benutzername, "racer");

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 1, "kein Doppel-Insert im Race-Recover");
    }
```

  *(Dieser Test läuft über den bestehenden `SELECT`-First-Zweig (Z99-109) — er verifiziert, dass ein bereits per (issuer,subject) existierendes Konto ohne zweiten Insert zurückkommt. Der echte parallele Race ist gegen SQLite-`test_pool` (Single-Connection) schwer deterministisch reproduzierbar; die Insert-Fehlerbehandlung ist über `ist_unique_verletzung` (Step 1) + den bestehenden `bekannter_issuer_sub_...`-Test abgedeckt.)*

- [ ] **Step 5: Alle provisioning-Tests grün**

Run: `<env-prefix> cargo test --lib auth::oidc::provisioning 2>&1 > /tmp/t4.log; echo EXIT=$status; grep "test result" /tmp/t4.log`
Expected: PASS — inkl. `unbekannter_issuer_sub_legt_least_privilege_konto_an`, `lokales_konto_mit_gleichem_namen_wird_nicht_verlinkt`, `bekannter_issuer_sub_liefert_denselben_benutzer_ohne_doppel_insert`.

- [ ] **Step 6: fmt + Commit**

```bash
cargo fmt --all
git add src/auth/oidc/provisioning.rs
git commit -m "fix(lfh-277): race-freie OIDC-Provisionierung (Unique-Recover statt 500 bei Concurrent-First-Login)"
```

---

### Task 5: Item 2 — OIDC-Discovery/JWKS-Refresh mit TTL

Heute: `static DISCOVERY: OnceCell<CoreProviderMetadata>` cached prozessweit OHNE Refresh. IdP-Key-Rotation (JWKS) bricht alle OIDC-Logins bis zum Server-Neustart. Fix: TTL-basierter Refresh.

**MUST (Advisor-Korrektur):**
- `OnceCell` ist nicht re-initialisierbar → ersetzen durch `tokio::sync::RwLock<Option<(CoreProviderMetadata, Instant)>>`. **tokio, nicht std** — ein std-Guard über den Discovery-`.await` macht den Handler `!Send` (Modul-Falle; `oidc_client_future_ist_send` bricht dann). Clone-on-read (`CoreProviderMetadata: Clone`), double-checked beim Refetch.
- **TTL (z.B. 1h)**, NICHT refresh-on-verify-failure: TTL bleibt vollständig in `mod.rs` gekapselt; refresh-on-failure müsste den Callback anfassen und gäbe einem Angreifer einen Amplification-Hebel (gefälschte Tokens → JWKS-Refetches gegen den IdP).
- **Fehlschlag friert nichts ein:** scheitert der Refetch, bleibt (wie heute) kein Fehler gecacht — bei abgelaufenem TTL wird beim nächsten Aufruf erneut discovert.

**Files:**
- Modify: `src/auth/oidc/mod.rs` (`DISCOVERY`-Static Z92; `discovery()`-Fn Z186-212)
- Test: `src/auth/oidc/mod.rs` (`mod tests`)

**Interfaces:**
- Consumes: `tokio::sync::RwLock`, `std::time::Instant`, `CoreProviderMetadata` (Clone).
- Produces: unveränderte Signatur `async fn discovery(issuer: &str) -> Result<CoreProviderMetadata, AppError>`; Konstante `const DISCOVERY_TTL: Duration`.

- [ ] **Step 1: Failing test — TTL-Frische-Prädikat** (pur; die eigentliche Netz-Discovery bleibt wie heute über `unerreichbarer_idp_...` getestet):

```rust
    #[test]
    fn cache_frisch_nur_innerhalb_ttl() {
        let jetzt = Instant::now();
        // Eintrag „jetzt" gespeichert → frisch.
        assert!(cache_ist_frisch(jetzt, jetzt));
        // Eintrag vor >TTL → veraltet. (Kein Instant-Subtraktion-Unterlauf: Referenzzeit
        // künstlich in die Zukunft schieben statt gespeicherte Zeit in die Vergangenheit.)
        let spaeter = jetzt + DISCOVERY_TTL + Duration::from_secs(1);
        assert!(!cache_ist_frisch(jetzt, spaeter));
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib auth::oidc::tests::cache_frisch 2>&1 > /tmp/t5.log; echo EXIT=$status; grep -E "cannot find|test result" /tmp/t5.log`
Expected: FAIL — `cache_ist_frisch`/`DISCOVERY_TTL` fehlen.

- [ ] **Step 3: Static + TTL + Frische-Prädikat implementieren** — `DISCOVERY`-Static (Z92) und Import (Z26 `use tokio::sync::OnceCell;`) ersetzen:

```rust
use tokio::sync::RwLock;
use std::time::Instant;

/// Lebensdauer eines Discovery-Cache-Eintrags. Nach Ablauf wird beim nächsten `oidc_client`-Aufruf
/// neu discovert — fängt IdP-JWKS-Key-Rotation ohne Server-Neustart ab (LFH-277). Bewusst TTL statt
/// Refresh-on-verify-failure: kein Angreifer-getriggerter JWKS-Refetch (Amplification), voll in
/// diesem Modul gekapselt.
const DISCOVERY_TTL: Duration = Duration::from_secs(60 * 60);

/// Prozessweiter Discovery-Cache mit TTL. `None` = noch nie / letzter Refetch-Versuch scheiterte
/// (kein Fehler-Einfrieren). `tokio::sync::RwLock` (NICHT std): der Schreib-Guard wird über den
/// Discovery-`.await` gehalten — ein std-Guard machte den Handler `!Send` (Modul-Falle, siehe
/// `oidc_client_future_ist_send`).
static DISCOVERY: RwLock<Option<(CoreProviderMetadata, Instant)>> = RwLock::const_new(None);

/// True, wenn ein Cache-Eintrag von `gespeichert` gegenüber `jetzt` noch innerhalb der TTL liegt.
fn cache_ist_frisch(gespeichert: Instant, jetzt: Instant) -> bool {
    jetzt.duration_since(gespeichert) < DISCOVERY_TTL
}
```

- [ ] **Step 4: `discovery()` auf RwLock+TTL umstellen** (Z186-212) — Read-Fast-Path, dann Write-Path mit Double-Check:

```rust
async fn discovery(issuer: &str) -> Result<CoreProviderMetadata, AppError> {
    let jetzt = Instant::now();

    // Fast-Path: frischen Eintrag unter Read-Lock klonen und Lock SOFORT freigeben (kein Guard
    // über den return hinaus — hier ohnehin kein await danach).
    {
        let read = DISCOVERY.read().await;
        if let Some((metadata, gespeichert)) = read.as_ref() {
            if cache_ist_frisch(*gespeichert, jetzt) {
                return Ok(metadata.clone());
            }
        }
    }

    // Slow-Path: Write-Lock, Double-Check (ein paralleler Refetch könnte zwischenzeitlich befüllt
    // haben), sonst neu discovern. Der Write-Guard wird über den Discovery-`.await` gehalten →
    // MUST tokio::sync (nicht std), sonst wird der Handler !Send.
    let mut write = DISCOVERY.write().await;
    let jetzt = Instant::now();
    if let Some((metadata, gespeichert)) = write.as_ref() {
        if cache_ist_frisch(*gespeichert, jetzt) {
            return Ok(metadata.clone());
        }
    }

    let issuer_url = IssuerUrl::new(issuer.to_string())
        .map_err(|e| AppError::Internal(format!("OIDC-Issuer-URL ungültig: {e}")))?;
    let client = ssrf_http_client()?;
    let http_client = move |request: HttpRequest| {
        let client = client.clone();
        async move { fuehre_http_request_aus(&client, request).await }
    };
    let metadata = CoreProviderMetadata::discover_async(issuer_url, &http_client)
        .await
        .map_err(|e| {
            // Kein `{e}` im AppError (Security): rohes Discovery-/IdP-Detail nur ins Log.
            tracing::warn!(error = %e, "OIDC-Discovery fehlgeschlagen");
            AppError::ServiceUnavailable("OIDC-Discovery fehlgeschlagen".into())
        })?;

    // NUR bei Erfolg cachen (Fehlschlag friert nichts ein — nächster Aufruf discovert erneut).
    *write = Some((metadata.clone(), Instant::now()));
    Ok(metadata)
}
```

  *(Der Modul-Doc-Kommentar über `DISCOVERY` (Z86-92) muss auf „TTL-Refresh statt OnceCell" umgeschrieben werden — inkl. der Zeile „Nur ein Issuer pro Prozess"; die bleibt gültig.)*

- [ ] **Step 5: `Send`-Test + Offline-Isolationstests grün** — die bestehenden `unerreichbarer_idp_liefert_err_statt_panic` und `wiederholter_aufruf_nach_fehlschlag_versucht_discovery_erneut` müssen weiter grün sein (Fehler friert nichts ein), und `oidc_client_future_ist_send` bleibt grün (tokio-Guard ist Send-verträglich):

Run: `<env-prefix> cargo test --lib auth::oidc 2>&1 > /tmp/t5.log; echo EXIT=$status; grep "test result" /tmp/t5.log`
Expected: PASS — inkl. `oidc_client_future_ist_send`, `unerreichbarer_idp_liefert_err_statt_panic`, `wiederholter_aufruf_nach_fehlschlag_versucht_discovery_erneut`, `cache_frisch_nur_innerhalb_ttl`.

- [ ] **Step 6: fmt + Commit**

```bash
cargo fmt --all
git add src/auth/oidc/mod.rs
git commit -m "fix(lfh-277): OIDC-Discovery mit TTL-Refresh (IdP-Key-Rotation ohne Neustart)"
```

---

### Task 6: Item 6 — Public `GET /api/auth/providers` in enabled-only-public vs. admin-full-state splitten

Heute: `GET /api/auth/providers` liefert ÖFFENTLICH die volle Liste inkl. deaktivierter Provider (mit `aktiviert`-Flags). Design sagte „aktivierten, verfügbaren". Fix:
- **Public** `GET /api/auth/providers`: nur `aktiviert == true` (Consumer: `LoginPage`, `ProfilPage`).
- **Admin** neuer `GET /api/auth/providers/admin` hinter `AdminUser`: volle Liste inkl. deaktivierter (Consumer: `GlobalEinstellungenPage`).

**MUST (Advisor-Korrektur, Containment):** DIESELBE `AuthProviderAnzeige`-DTO für beide Endpoints — public filtert nur, admin liefert voll. KEIN schlankes Public-DTO (das berührte nur den Codegen ohne Sicherheitsgewinn). Damit bleibt `openapi.json`/`types.generated.ts` unverändert; nur eine neue Route + FE-Umstellung.

**Files:**
- Modify: `src/routes/auth.rs` (`providers` filtert auf aktiviert; neuer Handler `providers_admin`)
- Modify: `src/app.rs` (neue Route `/api/auth/providers/admin`)
- Modify: `frontend/src/api/auth.ts` (`providerListe` bleibt public; neue `providerListeAdmin`)
- Modify: `frontend/src/pages/GlobalEinstellungenPage.tsx` (auf `providerListeAdmin` umstellen)
- Test (BE): am Ort der übrigen auth-Handler-Tests
- Test (FE): `frontend/src/pages/GlobalEinstellungenPage.test.tsx`, ggf. `LoginPage.test.tsx`-Mocks

**Interfaces:**
- Consumes: `crate::auth::provider::registry::liste`, `crate::auth::session::AdminUser`, `AuthProviderAnzeige`.
- Produces: `pub async fn providers_admin(State, AdminUser) -> Result<Json<Vec<AuthProviderAnzeige>>, AppError>`; FE `export function providerListeAdmin(): Promise<AuthProvider[]>`.

- [ ] **Step 0: Route-Reihenfolge-Falle prüfen** — `/api/auth/providers/admin` darf NICHT von `/api/auth/providers/{id}` (PUT) gefangen werden. Da PUT vs. GET unterschiedliche Methoden sind, kollidieren sie nicht; aber verifiziere in `src/app.rs`, dass `admin` als eigene GET-Route registriert ist. (axum matcht Methode + Pfad; `GET /providers/admin` und `PUT /providers/{id}` koexistieren.)

- [ ] **Step 1: Failing test (BE) — public filtert, admin nicht.** Am Handler-Test-Ort (oder als Router-`oneshot`-Test, falls vorhanden). Kern der Assertion: nach `registry::schalten(pool, ID_PASSWORT?, ...)` — besser: ein deaktivierbarer Nicht-Admin-Provider. Da im Default-Build nur `passwort` konfiguriert ist (dev/oidc/webauthn aus), braucht der Test einen konfigurierten, deaktivierbaren Provider. Nutze `set_oidc_konfiguriert(true)` + `schalten(pool, ID_OIDC, false)`, dann:

```rust
    #[tokio::test]
    async fn public_providers_verbergen_deaktivierte_admin_zeigt_sie() {
        crate::auth::provider::registry::set_oidc_konfiguriert(true);
        let pool = crate::db::test_pool().await;
        crate::auth::provider::registry::schalten(&pool, crate::auth::provider::ID_OIDC, false)
            .await
            .unwrap();

        let public = public_provider_projektion(
            crate::auth::provider::registry::liste(&pool).await.unwrap(),
        );
        assert!(public.iter().all(|p| p.aktiviert), "public: nur aktivierte");
        assert!(
            !public.iter().any(|p| p.id == "oidc"),
            "public: deaktiviertes oidc nicht sichtbar"
        );

        let admin = crate::auth::provider::registry::liste(&pool).await.unwrap();
        assert!(
            admin.iter().any(|p| p.id == "oidc" && !p.aktiviert),
            "admin: deaktiviertes oidc sichtbar"
        );
    }
```

- [ ] **Step 2: Test-Fehlschlag verifizieren**

Run: `<env-prefix> cargo test --lib routes::auth::tests::public_providers 2>&1 > /tmp/t6.log; echo EXIT=$status; grep -E "cannot find|test result" /tmp/t6.log`
Expected: FAIL — `public_provider_projektion` fehlt.

- [ ] **Step 3: Public-Projektion + Handler implementieren** — in `src/routes/auth.rs`:

```rust
/// Öffentliche Projektion der Provider-Liste: nur aktivierte. Deaktivierte Provider werden dem
/// unauthentifizierten Login-UI NICHT offengelegt (LFH-277; Design „aktivierten, verfügbaren").
/// Bewusst dieselbe DTO wie der Admin-Endpoint — public filtert nur.
fn public_provider_projektion(
    liste: Vec<crate::auth::provider::AuthProviderAnzeige>,
) -> Vec<crate::auth::provider::AuthProviderAnzeige> {
    liste.into_iter().filter(|p| p.aktiviert).collect()
}

/// GET /api/auth/providers — öffentlich, NUR aktivierte Provider (Login-UI).
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(public_provider_projektion(liste)))
}

/// GET /api/auth/providers/admin — Admin-only, VOLLE Liste inkl. deaktivierter Provider
/// (Provider-Verwaltung, LFH-280/LFH-277).
pub async fn providers_admin(
    State(state): State<AppState>,
    _admin: crate::auth::session::AdminUser,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}
```

- [ ] **Step 4: Route registrieren** — in `src/app.rs` nach der `providers`-GET-Route:

```rust
        .route(
            "/api/auth/providers/admin",
            get(routes::auth::providers_admin),
        )
```

- [ ] **Step 5: BE-Tests grün**

Run: `<env-prefix> cargo test --lib routes::auth 2>&1 > /tmp/t6.log; echo EXIT=$status; grep "test result" /tmp/t6.log`
Expected: PASS.

- [ ] **Step 6: Codegen-Gate laufen lassen** (Signatur nutzt bestehende DTO → Spec sollte unverändert bleiben; das Gate beweist es):

Run: `bash scripts/check-typ-codegen.sh 2>&1 > /tmp/codegen.log; echo EXIT=$status; tail -5 /tmp/codegen.log`
Expected: EXIT=0, keine ungespeicherten Diffs (der neue Handler nutzt `AuthProviderAnzeige`; kein neues Schema). Falls das Skript den neuen Pfad in die Spec aufnimmt und Diffs erzeugt → die regenerierten `openapi.json`/`types.generated.ts` mitcommitten.

- [ ] **Step 7: FE-API-Funktion ergänzen** — in `frontend/src/api/auth.ts` nach `providerListe`:

```ts
/** Lädt die VOLLE Provider-Liste inkl. deaktivierter (Admin-Provider-Verwaltung, LFH-277/LFH-280).
 *  Serverseitig `AdminUser`-geschützt; `401`/`403` als {@link ApiError}. */
export function providerListeAdmin(): Promise<AuthProvider[]> {
  return apiGet<AuthProvider[]>('/api/auth/providers/admin');
}
```

- [ ] **Step 8: `GlobalEinstellungenPage` umstellen** — Import + Query-Fn von `providerListe` auf `providerListeAdmin`:

```ts
// import { providerListe, providerSchalten } from '../api/auth';
import { providerListeAdmin, providerSchalten } from '../api/auth';
// ... in der useQuery/queryFn: providerListeAdmin() statt providerListe()
```

  *(Exakte Query-Stelle via `grep -n "providerListe" frontend/src/pages/GlobalEinstellungenPage.tsx` — nur den Admin-Listen-Call umstellen, `providerSchalten` bleibt.)*

- [ ] **Step 9: FE-Tests + Mocks anpassen** — `GlobalEinstellungenPage.test.tsx` muss `/api/auth/providers/admin` mocken (statt/zusätzlich zu `/api/auth/providers`). Deaktivierten Provider im Mock einschließen und assert, dass die Admin-UI ihn rendert. `LoginPage`/`ProfilPage`-Mocks bleiben auf `/api/auth/providers` (public) — sie zeigen nur aktivierte, was durch den Server-Filter jetzt garantiert ist; ihre bestehenden Client-Filter (falls vorhanden) bleiben harmlos.

Run (FE-Test, absolute Pfade + saubere Env):
```
mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/fix+lfh-277-auth-haertung-followups/frontend test -- --no-file-parallelism GlobalEinstellungenPage LoginPage ProfilPage
```
Expected: PASS.

- [ ] **Step 10: FE-Lint + Typecheck**

```
mise exec pnpm@<ver> -- pnpm -C <fe-abs> lint
mise exec pnpm@<ver> -- pnpm -C <fe-abs> exec tsc --noEmit
```
Expected: 0 Warnings/Errors (`--max-warnings 0`).

- [ ] **Step 11: fmt + Commit**

```bash
cargo fmt --all
git add src/routes/auth.rs src/app.rs frontend/src/api/auth.ts frontend/src/pages/GlobalEinstellungenPage.tsx frontend/src/pages/GlobalEinstellungenPage.test.tsx
# falls Codegen-Diffs: frontend/src/api/openapi.json frontend/src/api/types.generated.ts mit dazu
git commit -m "feat(lfh-277): Provider-Endpoint splitten — public enabled-only vs. admin-full-state"
```

---

## Abschluss-Gate (nach allen 6 Tasks, vor Merge)

- [ ] **Voll-Suite Rust** (mit sauberer Env, Exit-Code NICHT via Pipe maskieren):
  ```
  <env-prefix> cargo test 2>&1 > /tmp/full.log; echo EXIT=$status; grep -E "test result: FAILED|error\[" /tmp/full.log; grep -c "test result: ok" /tmp/full.log
  ```
  Expected: EXIT=0, keine FAILED-Zeilen.
- [ ] **fmt-Gate:** `bash scripts/check-fmt.sh` → EXIT=0.
- [ ] **Codegen-Gate:** `bash scripts/check-typ-codegen.sh` → EXIT=0 (keine ungespeicherten Diffs).
- [ ] **FE-Voll-Gate:** `pnpm -C <fe-abs> test -- --no-file-parallelism`, `pnpm -C <fe-abs> lint`, `tsc --noEmit` → alle grün.
- [ ] **Code-Review** (superpowers:requesting-code-review) → Board `in review`.
- [ ] **Integration** (superpowers:finishing-a-development-branch): Merge in `main`.
- [ ] **Bucket NICHT schließen (MUST):** LFH-277 NICHT auf `shipped`/`done`. Erledigte 5 Items in der ClickUp-Beschreibung abhaken/entfernen; verbleibende Items (Admin-Linking/Claims→Rollen 4/5, TLS-cache 8) stehen lassen; Status zurück auf `backlog` (offener Bucket).

## Self-Review-Ergebnis (gegen die 5 gescopten Items)

1. Item 1 (state→Cookie) → Task 3 ✓ · Item 2 (Discovery-Refresh) → Task 5 ✓ · Item 3 (race-frei) → Task 4 ✓ · Item 6 (Endpoint-Split) → Task 6 ✓ · Item 7a (enum-exhaustiv) → Task 2 ✓ · Item 7b (leere anzeigename-Claims) → Task 1 ✓.
2. Bewusst NICHT enthalten (deferred, Bucket bleibt offen): Item 4 (Admin-Linking + Claims→Rollen), Item 5 (`ist_admin_tauglich`+transaktionaler `schalten` — erst mit Item 4 nötig, „ungefährlich solange nur passwort admin-tauglich"), Item 8 (TLS `cache_gueltig` — nur referenziert, über LFH-275 getrackt).
3. Typ-Konsistenz: `plane_anzeigename` (T1), `ProviderId`/`ist_admin_tauglich` (T2), `baue_oidc_state_cookie`/`oidc_state_binding_ok` (T3), `ist_unique_verletzung`/`select_by_oidc` (T4), `cache_ist_frisch`/`DISCOVERY_TTL` (T5), `public_provider_projektion`/`providers_admin`/`providerListeAdmin` (T6) — jeweils in ihrem Task definiert und nur dort/downstream referenziert.

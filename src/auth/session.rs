use crate::app::AppState;
use crate::auth::Benutzer;
use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum_extra::extract::cookie::CookieJar;
use sqlx::SqlitePool;
use std::sync::OnceLock;

/// Name des Session-Cookies.
pub const SESSION_COOKIE: &str = "lifeline_sid";

/// Prozessweit erzwungenes `Secure` (`true` bei eigenem TLS oder `--cookie-secure`,
/// `Config::cookies_secure`; ungesetzt `false`). Hinter einem TLS-Proxy entscheidet zusätzlich
/// jede Anfrage selbst, s. [`SichererTransport`].
/// OnceLock statt AppState-Feld, damit die Inline-Test-Konstruktionen unberührt bleiben.
static COOKIE_SECURE: OnceLock<bool> = OnceLock::new();

/// Einmalig beim Serverstart setzen (`Config::cookies_secure`). Doppelsetzen wird ignoriert.
pub fn set_cookie_secure(v: bool) {
    let _ = COOKIE_SECURE.set(v);
}

/// Ob `Secure` prozessweit erzwungen ist (Default false → HTTP-Betrieb). Cookies beziehen
/// `Secure` über [`SichererTransport`], nicht hierüber.
pub fn cookie_secure() -> bool {
    *COOKIE_SECURE.get().unwrap_or(&false)
}

/// Ob ein TLS-terminierender Proxy die Anfrage als https weiterreicht: erster Wert von
/// `X-Forwarded-Proto` ist `https`. Bei einer Proxy-Kette steht der Transport zum Browser vorn.
pub fn weitergeleitet_als_https(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .is_some_and(|proto| proto.trim().eq_ignore_ascii_case("https"))
}

/// Ob die Cookies dieser Antwort `Secure` tragen (LFH-603): prozessweit erzwungen (`--tls`,
/// `--cookie-secure`) oder weil ein TLS-Proxy (Traefik) die Anfrage als https weiterreicht.
/// Ein direkter http-Aufruf (LAN, Dev) bekommt kein `Secure`, sonst legte der Browser das Cookie
/// nicht ab und die Anmeldung schlüge fehl.
///
/// Anders als `X-Forwarded-For` (s. `crate::extract::PeerIp`) darf der Kopf hier ungeprüft
/// gelten: Wer ihn fälscht, ändert nur das Cookie seiner eigenen Antwort. Der Browser eines
/// anderen schickt ihn nicht, und Traefik überschreibt einen mitgeschickten Wert.
#[derive(Debug, Clone, Copy)]
pub struct SichererTransport(pub bool);

impl<S: Send + Sync> FromRequestParts<S> for SichererTransport {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(SichererTransport(
            cookie_secure() || weitergeleitet_als_https(&parts.headers),
        ))
    }
}

/// Erzeugt einen neuen, kryptografisch zufälligen Session-Token (64 Hex-Zeichen).
pub fn neuer_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256-Hex eines Session-Tokens für die At-Rest-Speicherung. In der DB steht nur dieser
/// Hash; ein 256-Bit-Zufallstoken braucht kein Salt/Argon2.
fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Öffentliche Kennung einer Sitzung (LFH-1092): 128 Bit Zufall als Hex, unabhängig vom Token.
/// Sie steht in der Sitzungsliste und adressiert das Beenden; aus ihr folgt nichts über den Token.
fn neue_kennung() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Takt, in dem „zuletzt gesehen“ fortgeschrieben wird (LFH-1092, design.md D2). Eine Anfrage
/// innerhalb des Takts schreibt nichts und öffnet damit keine Schreibtransaktion; die Liste zeigt
/// den Zeitpunkt mit dieser Unschärfe.
pub const ZULETZT_GESEHEN_TAKT_MINUTEN: i64 = 5;

/// Lebensdauer einer Sitzung ab Anmeldung, ohne Verlängerung. Eine Quelle für den Ablauf in
/// der DB und das `Max-Age` des Cookies (LFH-779), damit das Cookie nie länger lebt als die
/// Sitzung dahinter und umgekehrt.
pub const SITZUNG_TAGE: i64 = 7;

/// Legt eine neue Session für den Benutzer an (TTL [`SITZUNG_TAGE`]) und liefert den Token.
/// `geraet` ist die grobe Bezeichnung aus dem User-Agent ([`crate::auth::geraet_bezeichnung`]).
///
/// Ein Gerätekonto (LFH-892) bekommt hier nie eine Sitzung: jeder Anmeldeweg einer Person läuft
/// durch diese Funktion, ein Gerät meldet sich nur über den Kopplungscode an
/// ([`anlegen_geraet`]). Zusätzlich zum Passwort-Sentinel, der den Passwortweg schon sperrt.
pub async fn anlegen(
    pool: &SqlitePool,
    benutzer_id: i64,
    geraet: Option<&str>,
) -> Result<String, AppError> {
    if crate::geraet::repo::ist_geraetekonto(pool, benutzer_id).await? {
        return Err(AppError::Unauthorized);
    }
    let token = neuer_token();
    sqlx::query(
        "INSERT INTO session (token_hash, benutzer_id, expires_at, kennung, zuletzt_gesehen_at, geraet) \
         VALUES (?, ?, datetime('now', ?), ?, datetime('now'), ?)",
    )
    .bind(hash_token(&token))
    .bind(benutzer_id)
    .bind(format!("+{SITZUNG_TAGE} days"))
    .bind(neue_kennung())
    .bind(geraet)
    .execute(pool)
    .await?;
    Ok(token)
}

/// Löscht eine Session anhand ihres Tokens (idempotent) und liefert ihre Kennung, falls es sie
/// gab. Der Aufrufer meldet sie an [`crate::live::LiveHub::melde_sitzung_ende`].
pub async fn loeschen(pool: &SqlitePool, token: &str) -> Result<Option<String>, AppError> {
    let kennung: Option<Option<String>> =
        sqlx::query_scalar("DELETE FROM session WHERE token_hash = ? RETURNING kennung")
            .bind(hash_token(token))
            .fetch_optional(pool)
            .await?;
    Ok(kennung.flatten())
}

/// Löscht alle Sessions eines Benutzers AUSSER der zum übergebenen Token (Passwortwechsel,
/// LFH-471) und liefert ihre Kennungen. Läuft auf dem Executor des Aufrufers, damit der Wechsel
/// mit dem neuen Hash in einer Transaktion steht.
pub async fn andere_loeschen(
    conn: &mut sqlx::SqliteConnection,
    benutzer_id: i64,
    eigener_token: &str,
) -> Result<Vec<String>, AppError> {
    let kennungen: Vec<Option<String>> = sqlx::query_scalar(
        "DELETE FROM session WHERE benutzer_id = ? AND token_hash <> ? RETURNING kennung",
    )
    .bind(benutzer_id)
    .bind(hash_token(eigener_token))
    .fetch_all(conn)
    .await?;
    Ok(kennungen.into_iter().flatten().collect())
}

/// Löscht ALLE Sessions eines Benutzers (Deaktivieren, Zweitfaktor-Reset) und liefert ihre
/// Kennungen für [`crate::live::LiveHub::melde_sitzung_ende`].
pub async fn alle_loeschen(
    conn: &mut sqlx::SqliteConnection,
    benutzer_id: i64,
) -> Result<Vec<String>, AppError> {
    let kennungen: Vec<Option<String>> =
        sqlx::query_scalar("DELETE FROM session WHERE benutzer_id = ? RETURNING kennung")
            .bind(benutzer_id)
            .fetch_all(conn)
            .await?;
    Ok(kennungen.into_iter().flatten().collect())
}

/// Eine Personensitzung in der Sitzungsliste (LFH-1092). Zeitpunkte als UTC-`datetime`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, sqlx::FromRow, utoipa::ToSchema)]
pub struct SitzungAnzeige {
    pub kennung: String,
    pub angemeldet_at: String,
    /// Letzte Anfrage dieser Sitzung, auf [`ZULETZT_GESEHEN_TAKT_MINUTEN`] genau.
    pub zuletzt_gesehen_at: String,
    /// Grobe Bezeichnung wie „Firefox · Windows“; fehlt, wenn unbekannt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geraet: Option<String>,
    /// Die Sitzung, mit der diese Anfrage kommt.
    pub aktuell: bool,
}

/// Die laufenden Personensitzungen eines Benutzers, zuletzt gesehen zuerst. Sitzungen
/// gekoppelter Geräte und abgelaufene erscheinen nicht. `aktuelle_kennung` markiert die eigene.
pub async fn liste(
    pool: &SqlitePool,
    benutzer_id: i64,
    aktuelle_kennung: Option<&str>,
) -> Result<Vec<SitzungAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, SitzungAnzeige>(
        "SELECT kennung, erstellt_at AS angemeldet_at, \
                COALESCE(zuletzt_gesehen_at, erstellt_at) AS zuletzt_gesehen_at, geraet, \
                COALESCE(kennung = ?, 0) AS aktuell \
         FROM session \
         WHERE benutzer_id = ? AND kopplung_id IS NULL AND kennung IS NOT NULL \
           AND expires_at > datetime('now') \
         ORDER BY zuletzt_gesehen_at DESC, erstellt_at DESC, kennung",
    )
    .bind(aktuelle_kennung)
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?)
}

/// Welche Personensitzungen [`beenden`] löscht.
#[derive(Debug, Clone, Copy)]
pub enum Auswahl<'a> {
    /// Genau die Sitzung mit dieser Kennung.
    Eine(&'a str),
    /// Alle, außer der mit dieser Kennung (`None`: alle).
    AlleAusser(Option<&'a str>),
}

/// Eine von [`beenden`] gelöschte Sitzung, für Audit und Strom-Ende.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct BeendeteSitzung {
    pub kennung: String,
    pub angemeldet_at: String,
    pub geraet: Option<String>,
}

/// Beendet Personensitzungen eines Benutzers (LFH-1092, design.md D5): löscht nur die Zeilen,
/// nichts am Konto, und nie eine Sitzung eines gekoppelten Geräts. Liefert die gelöschten.
pub async fn beenden(
    pool: &SqlitePool,
    benutzer_id: i64,
    auswahl: Auswahl<'_>,
) -> Result<Vec<BeendeteSitzung>, AppError> {
    let basis = "DELETE FROM session \
                 WHERE benutzer_id = ? AND kopplung_id IS NULL AND kennung IS NOT NULL";
    let rueckgabe = "RETURNING kennung, erstellt_at AS angemeldet_at, geraet";
    let beendet = match auswahl {
        Auswahl::Eine(kennung) => {
            let sql = format!("{basis} AND kennung = ? {rueckgabe}");
            sqlx::query_as::<_, BeendeteSitzung>(sqlx::AssertSqlSafe(sql))
                .bind(benutzer_id)
                .bind(kennung)
                .fetch_all(pool)
                .await?
        }
        Auswahl::AlleAusser(ausser) => {
            let sql = format!("{basis} AND kennung IS NOT COALESCE(?, '') {rueckgabe}");
            sqlx::query_as::<_, BeendeteSitzung>(sqlx::AssertSqlSafe(sql))
                .bind(benutzer_id)
                .bind(ausser)
                .fetch_all(pool)
                .await?
        }
    };
    Ok(beendet)
}

/// Löscht alle abgelaufenen Sitzungen (Purge-Lauf, Phase C2, LFH-928). Die Bedingung ist das
/// Gegenstück zum Filter in [`sitzung_aus_token`]: was dort nicht mehr authentifiziert, fällt
/// hier. Ohne diesen Lauf bliebe jede Anmeldung eines Geräts, das sich nie abmeldet, als Zeile
/// mit Benutzer und Zeitpunkt für immer stehen. Liefert die Zahl gelöschter Sitzungen.
pub async fn purge_abgelaufene(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let ergebnis = sqlx::query("DELETE FROM session WHERE expires_at <= datetime('now')")
        .execute(pool)
        .await?;
    Ok(ergebnis.rows_affected())
}

/// Benutzer-ID hinter einem Session-Token, ohne Gültigkeitsprüfung. Für die Audit-Spur beim
/// Logout, die den Benutzer VOR dem Löschen der Session bestimmen muss. Eine abgelaufene Sitzung
/// steht nur bis zum nächsten Purge-Lauf (Phase C2); danach bleibt der Logout ohne Benutzer.
pub async fn benutzer_id_zu_token(pool: &SqlitePool, token: &str) -> Option<i64> {
    sqlx::query_scalar("SELECT benutzer_id FROM session WHERE token_hash = ?")
        .bind(hash_token(token))
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Legt die Sitzung eines gekoppelten Geräts an (LFH-892) und liefert den Token. Läuft in der
/// Transaktion der Code-Einlösung; das Ende ist das der Kopplung (eine Verlängerung zieht es
/// nach, `geraet::repo::verlaengern`).
pub async fn anlegen_geraet(
    conn: &mut sqlx::SqliteConnection,
    benutzer_id: i64,
    kopplung_id: i64,
    expires_at: &str,
) -> Result<String, AppError> {
    let token = neuer_token();
    sqlx::query(
        "INSERT INTO session (token_hash, benutzer_id, expires_at, kopplung_id, kennung, zuletzt_gesehen_at) \
         VALUES (?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(hash_token(&token))
    .bind(benutzer_id)
    .bind(expires_at)
    .bind(kopplung_id)
    .bind(neue_kennung())
    .execute(conn)
    .await?;
    Ok(token)
}

/// Löst eine gültige (nicht abgelaufene) Session zu einem aktiven Benutzer auf.
pub(crate) async fn benutzer_aus_token(
    pool: &SqlitePool,
    token: &str,
) -> Result<Benutzer, AppError> {
    sitzung_aus_token(pool, token).await.map(|(b, _, _)| b)
}

/// Die öffentliche Kennung der Sitzung einer Anfrage (LFH-1092). [`CurrentUser`] legt sie in die
/// Extensions; die Live-Ströme lesen sie dort, um mit ihrer Sitzung zu enden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SitzungKennung(pub String);

/// Extractor: die [`SitzungKennung`] der Anfrage, sofern ein vorheriger Extractor
/// ([`CurrentUser`], [`AdminUser`], `EinsatzKontext`) die Sitzung schon aufgelöst hat. Steht in
/// der Argumentliste deshalb NACH ihm; axum löst Extractors in dieser Reihenfolge auf.
#[derive(Debug, Clone)]
pub struct AktuelleSitzung(pub Option<SitzungKennung>);

impl<S: Send + Sync> FromRequestParts<S> for AktuelleSitzung {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(AktuelleSitzung(
            parts.extensions.get::<SitzungKennung>().cloned(),
        ))
    }
}

/// Wie [`benutzer_aus_token`], liefert bei einer Gerätesitzung zusätzlich deren Kontext und die
/// Kennung der Sitzung. Eine Gerätesitzung, deren Kopplung widerrufen, abgelaufen oder deren
/// Einsatz nicht mehr aktiv ist, ist tot (401), bei jeder Anfrage neu geprüft: so wirkt ein
/// Widerruf sofort (design.md D7).
///
/// Schreibt „zuletzt gesehen“ fort, aber nur, wenn der Wert älter als
/// [`ZULETZT_GESEHEN_TAKT_MINUTEN`] ist (LFH-1092, design.md D2). Scheitert das Schreiben, bleibt
/// die Anfrage gültig: die Angabe ist Komfort, keine Prüfung.
pub(crate) async fn sitzung_aus_token(
    pool: &SqlitePool,
    token: &str,
) -> Result<
    (
        Benutzer,
        Option<crate::geraet::GeraetKontext>,
        Option<SitzungKennung>,
    ),
    AppError,
> {
    #[derive(sqlx::FromRow)]
    struct Zeile {
        #[sqlx(flatten)]
        benutzer: Benutzer,
        kopplung_id: Option<i64>,
        kennung: Option<String>,
        gesehen_veraltet: bool,
    }
    let token_hash = hash_token(token);
    let zeile = sqlx::query_as::<_, Zeile>(
        "SELECT b.id, b.org_id, b.anzeigename, b.benutzername, b.passwort_hash, \
                b.system_rolle, b.org_rolle, b.aktiv, b.erstellt_at, s.kopplung_id, s.kennung, \
                COALESCE(s.zuletzt_gesehen_at < datetime('now', ?), 1) AS gesehen_veraltet \
         FROM session s \
         JOIN benutzer b ON b.id = s.benutzer_id \
         WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND b.aktiv = 1",
    )
    .bind(format!("-{ZULETZT_GESEHEN_TAKT_MINUTEN} minutes"))
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    if zeile.gesehen_veraltet {
        if let Err(e) = sqlx::query(
            "UPDATE session SET zuletzt_gesehen_at = datetime('now') WHERE token_hash = ?",
        )
        .bind(&token_hash)
        .execute(pool)
        .await
        {
            tracing::warn!(error = %e, "zuletzt gesehen nicht fortgeschrieben");
        }
    }

    let geraet = match zeile.kopplung_id {
        None => None,
        Some(kopplung_id) => Some(
            crate::geraet::repo::kontext_wenn_gueltig(pool, kopplung_id)
                .await?
                .ok_or(AppError::Unauthorized)?,
        ),
    };
    Ok((zeile.benutzer, geraet, zeile.kennung.map(SitzungKennung)))
}

/// Kopf, mit dem ein Browser-Tab bei schreibenden Anfragen den Benutzer nennt, den er anzeigt
/// (LFH-387). Das Session-Cookie gilt für den ganzen Origin; meldet sich in einem anderen Tab
/// jemand anderes an, liefe jede Schreibaktion des alten Tabs sonst still unter der neuen
/// Sitzung.
pub const ERWARTETER_BENUTZER_ID_HEADER: &str = "x-erwarteter-benutzer-id";

/// Bindet eine schreibende Anfrage an den erwarteten Benutzer.
///
/// Optional, aber strikt — dasselbe Muster wie der Queue-Besitzer aus LFH-334
/// (`routes::support::fordere_offline_queue_benutzer`): ohne Kopf bleibt alles wie bisher
/// (Skripte, Tests, ältere Frontend-Stände), ein ungültiger oder abweichender Wert ist 412.
/// Lesende Methoden sind nicht gebunden. Der Aufrufer prüft die Sitzung VORHER, damit eine tote
/// Sitzung 401 bleibt.
pub fn pruefe_erwarteten_benutzer(
    methode: &axum::http::Method,
    headers: &axum::http::HeaderMap,
    aktueller_benutzer_id: i64,
) -> Result<(), AppError> {
    if methode.is_safe() {
        return Ok(());
    }
    let Some(erwartet) = headers.get(ERWARTETER_BENUTZER_ID_HEADER) else {
        return Ok(());
    };
    let passt = erwartet
        .to_str()
        .ok()
        .and_then(|wert| wert.trim().parse::<i64>().ok())
        .is_some_and(|id| id == aktueller_benutzer_id);
    if passt {
        Ok(())
    } else {
        Err(AppError::SitzungsBenutzerMismatch)
    }
}

/// Extractor: der aktuell angemeldete Benutzer (aus Session-Cookie).
/// Liefert 401, wenn kein gültiger Session-Cookie vorliegt, und 412, wenn eine schreibende
/// Anfrage einen anderen Benutzer erwartet ([`pruefe_erwarteten_benutzer`], LFH-387). Weil
/// `AdminUser` und `EinsatzKontext` hierüber laufen, greift die Bindung an jeder
/// authentifizierten Schreibroute, vor dem Handler und damit vor jedem Idempotenz-Lookup.
pub struct CurrentUser(pub Benutzer);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_request_parts(parts, state)
            .await
            .expect("CookieJar-Extractor ist infallible");
        let token = jar
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or(AppError::Unauthorized)?;

        let (benutzer, geraet, kennung) = sitzung_aus_token(&state.pool, &token).await?;
        if let Some(geraet) = geraet {
            fordere_geraeteroute(parts, state, &geraet).await?;
            parts.extensions.insert(geraet);
        }
        if let Some(kennung) = kennung {
            parts.extensions.insert(kennung);
        }
        pruefe_erwarteten_benutzer(&parts.method, &parts.headers, benutzer.id)?;
        Ok(CurrentUser(benutzer))
    }
}

/// Schranke einer Gerätesitzung (LFH-892, design.md D5): die Route muss in der Routenliste der
/// Ansicht stehen (sonst 403), und eine Einsatzroute muss den gekoppelten Einsatz meinen (sonst
/// 404 wie ein unbekannter Einsatz). Ohne `MatchedPath` (Fallback) ist nichts erlaubt.
async fn fordere_geraeteroute(
    parts: &mut Parts,
    state: &AppState,
    geraet: &crate::geraet::GeraetKontext,
) -> Result<(), AppError> {
    let pfad = parts
        .extensions
        .get::<axum::extract::MatchedPath>()
        .map(|p| p.as_str().to_owned())
        .ok_or(AppError::Forbidden)?;
    if !crate::geraet::darf_route(geraet.ansicht, parts.method.as_str(), &pfad) {
        return Err(AppError::Forbidden);
    }
    if pfad.starts_with("/api/einsaetze/{id}") {
        use axum::extract::Path;
        use std::collections::HashMap;
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::NotFound)?;
        let einsatz_id: Option<i64> = params.get("id").and_then(|s| s.parse().ok());
        if einsatz_id != Some(geraet.einsatz_id) {
            return Err(AppError::NotFound);
        }
    }
    Ok(())
}

/// Extractor: der aktuell angemeldete Benutzer, der zusätzlich Admin sein muss.
/// Liefert 401 ohne Session, 403 bei fehlender Admin-Rolle.
pub struct AdminUser(pub Benutzer);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let CurrentUser(benutzer) = CurrentUser::from_request_parts(parts, state).await?;
        if benutzer.ist_admin() {
            Ok(AdminUser(benutzer))
        } else {
            Err(AppError::Forbidden)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt eine Org + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, aktiv: i64) -> i64 {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', 'hash', ?)",
        )
        .bind(aktiv)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = 'max'")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    fn kopf(wert: &str) -> axum::http::HeaderMap {
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(ERWARTETER_BENUTZER_ID_HEADER, wert.parse().unwrap());
        headers
    }

    #[test]
    fn erwarteter_benutzer_bindet_nur_schreibende_methoden() {
        use axum::http::Method;
        let leer = axum::http::HeaderMap::new();
        for methode in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(pruefe_erwarteten_benutzer(&methode, &kopf("7"), 7).is_ok());
            assert!(pruefe_erwarteten_benutzer(&methode, &kopf(" 7 "), 7).is_ok());
            assert!(
                pruefe_erwarteten_benutzer(&methode, &leer, 7).is_ok(),
                "ohne Kopf bleibt alles wie bisher"
            );
            for falsch in ["8", "", "abc", "7x"] {
                assert!(
                    matches!(
                        pruefe_erwarteten_benutzer(&methode, &kopf(falsch), 7),
                        Err(AppError::SitzungsBenutzerMismatch)
                    ),
                    "{methode} mit Kopf {falsch:?} muss 412 sein"
                );
            }
        }
        for methode in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert!(
                pruefe_erwarteten_benutzer(&methode, &kopf("8"), 7).is_ok(),
                "lesende Anfragen sind nicht gebunden ({methode})"
            );
        }
    }

    #[test]
    fn cookie_secure_default_false() {
        assert!(!cookie_secure());
    }

    /// LFH-603: Nur ein `https` als erster Wert von `X-Forwarded-Proto` zählt. Bei einer
    /// Proxy-Kette steht der Transport zum Browser vorn.
    #[test]
    fn weitergeleitet_als_https_liest_den_ersten_proto_wert() {
        let kopf = |wert: &str| {
            let mut h = axum::http::HeaderMap::new();
            h.insert(
                "x-forwarded-proto",
                axum::http::HeaderValue::from_str(wert).unwrap(),
            );
            h
        };
        for ja in ["https", "HTTPS", " https ", "https, http", "https,http"] {
            assert!(weitergeleitet_als_https(&kopf(ja)), "{ja:?} ist https");
        }
        for nein in ["http", "", "http, https", "wss", "httpsx"] {
            assert!(
                !weitergeleitet_als_https(&kopf(nein)),
                "{nein:?} ist kein https"
            );
        }
        assert!(
            !weitergeleitet_als_https(&axum::http::HeaderMap::new()),
            "ohne Kopf kein https"
        );
    }

    /// Kein Cookie-Bau liest das prozessweite Flag an [`SichererTransport`] vorbei, sonst fiele
    /// die Erkennung hinter dem Proxy für dieses Cookie still weg.
    #[test]
    fn cookies_nehmen_den_transport_der_anfrage() {
        let quelle = include_str!("../routes/auth.rs");
        assert_eq!(
            quelle.matches(concat!("cookie_", "secure()")).count(),
            0,
            "routes/auth.rs: Secure über den Extractor `SichererTransport` beziehen"
        );
    }

    #[test]
    fn neuer_token_ist_64_hex_zeichen() {
        let t = neuer_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(t, neuer_token(), "Tokens müssen sich unterscheiden");
    }

    #[tokio::test]
    async fn anlegen_speichert_nur_hash_nicht_klartext() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id, None).await.unwrap();

        let gespeichert: String = sqlx::query_scalar("SELECT token_hash FROM session")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_ne!(
            gespeichert, token,
            "Der Klartext-Token darf nicht in der DB liegen"
        );
        assert_eq!(
            gespeichert,
            hash_token(&token),
            "In der DB muss der SHA-256-Hash des Tokens stehen"
        );
        // Gegenprobe: der Klartext-Token findet per Gleichheit keine Session.
        let treffer: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session WHERE token_hash = ?")
            .bind(&token)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(treffer, 0, "Klartext-Token darf keine Session matchen");
    }

    #[tokio::test]
    async fn sitzung_laeuft_nach_sitzung_tagen_ab() {
        // LFH-779: das Cookie-`Max-Age` rechnet mit derselben Konstante. Die Cookie-Tests
        // pinnen die 7 Tage bewusst als Literal: eine andere Dauer ist eine Entscheidung.
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        anlegen(&pool, id, None).await.unwrap();

        let tage: f64 =
            sqlx::query_scalar("SELECT julianday(expires_at) - julianday('now') FROM session")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            (tage - SITZUNG_TAGE as f64).abs() < 0.01,
            "Ablauf nach {SITZUNG_TAGE} Tagen erwartet, war {tage}"
        );
    }

    #[tokio::test]
    async fn hash_aus_db_taugt_nicht_als_cookie() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id, None).await.unwrap();
        // Der Klartext-Token (aus dem Cookie) löst weiterhin auf.
        assert!(benutzer_aus_token(&pool, &token).await.is_ok());

        // Der in der DB gespeicherte Wert, als Cookie eingesetzt, löst NICHT auf.
        let gespeichert: String = sqlx::query_scalar("SELECT token_hash FROM session")
            .fetch_one(&pool)
            .await
            .unwrap();
        let err = benutzer_aus_token(&pool, &gespeichert).await.unwrap_err();
        assert!(
            matches!(err, AppError::Unauthorized),
            "Der DB-Hash darf kein gültiger Login-Schlüssel sein"
        );
    }

    #[tokio::test]
    async fn anlegen_und_aufloesen_roundtrip() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;

        let token = anlegen(&pool, id, None).await.unwrap();
        let benutzer = benutzer_aus_token(&pool, &token).await.unwrap();
        assert_eq!(benutzer.id, id);
        assert_eq!(benutzer.benutzername, "max");
    }

    #[tokio::test]
    async fn unbekannter_token_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_anlegen(&pool, 1).await;
        let err = benutzer_aus_token(&pool, "gibtsnicht").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn abgelaufene_session_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        // Session mit Ablauf in der Vergangenheit direkt einfügen (Hash des Tokens "alt",
        // damit der hashende Lookup die Zeile findet und wirklich am Ablauf scheitert).
        sqlx::query(
            "INSERT INTO session (token_hash, benutzer_id, expires_at) \
             VALUES (?, ?, datetime('now', '-1 day'))",
        )
        .bind(hash_token("alt"))
        .bind(id)
        .execute(&pool)
        .await
        .unwrap();
        let err = benutzer_aus_token(&pool, "alt").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn session_eines_inaktiven_benutzers_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 0).await; // inaktiv
        let token = anlegen(&pool, id, None).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn loeschen_invalidiert_session() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let token = anlegen(&pool, id, None).await.unwrap();
        loeschen(&pool, &token).await.unwrap();
        let err = benutzer_aus_token(&pool, &token).await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    // --- LFH-1092: Kennung, Gerät, zuletzt gesehen, Liste, Beenden ---

    async fn kennung_zu(pool: &SqlitePool, token: &str) -> String {
        sqlx::query_scalar("SELECT kennung FROM session WHERE token_hash = ?")
            .bind(hash_token(token))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn anlegen_speichert_kennung_geraet_und_zuletzt_gesehen() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let a = anlegen(&pool, id, Some("Firefox · Windows")).await.unwrap();
        let b = anlegen(&pool, id, None).await.unwrap();

        let (kennung, geraet, frisch): (String, Option<String>, bool) = sqlx::query_as(
            "SELECT kennung, geraet, zuletzt_gesehen_at >= datetime('now', '-1 minute') \
             FROM session WHERE token_hash = ?",
        )
        .bind(hash_token(&a))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kennung.len(), 32);
        assert!(kennung.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(
            !a.contains(&kennung),
            "die Kennung ist kein Teil des Tokens"
        );
        assert_eq!(geraet.as_deref(), Some("Firefox · Windows"));
        assert!(frisch);
        assert_ne!(kennung, kennung_zu(&pool, &b).await);
    }

    #[tokio::test]
    async fn zuletzt_gesehen_wird_nur_nach_dem_takt_geschrieben() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let token = anlegen(&pool, id, None).await.unwrap();
        let setze = |vor: &'static str| {
            let pool = pool.clone();
            let token = token.clone();
            async move {
                sqlx::query(
                    "UPDATE session SET zuletzt_gesehen_at = datetime('now', ?) WHERE token_hash = ?",
                )
                .bind(vor)
                .bind(hash_token(&token))
                .execute(&pool)
                .await
                .unwrap();
            }
        };
        let alter_in_minuten = || async {
            sqlx::query_scalar::<_, f64>(
                "SELECT (julianday('now') - julianday(zuletzt_gesehen_at)) * 1440 FROM session",
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        };

        setze("-2 minutes").await;
        let (_, _, kennung) = sitzung_aus_token(&pool, &token).await.unwrap();
        assert_eq!(
            kennung,
            Some(SitzungKennung(kennung_zu(&pool, &token).await))
        );
        assert!(
            alter_in_minuten().await > 1.5,
            "innerhalb des Takts kein Schreiben"
        );

        setze("-6 minutes").await;
        sitzung_aus_token(&pool, &token).await.unwrap();
        assert!(
            alter_in_minuten().await < 0.5,
            "nach dem Takt fortgeschrieben"
        );
    }

    #[tokio::test]
    async fn liste_markiert_die_aktuelle_und_laesst_abgelaufene_weg() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let a = anlegen(&pool, id, Some("Firefox · Windows")).await.unwrap();
        let b = anlegen(&pool, id, Some("Safari · iPadOS")).await.unwrap();
        let c = anlegen(&pool, id, None).await.unwrap();
        sqlx::query("UPDATE session SET zuletzt_gesehen_at = datetime('now', '-1 hour') WHERE token_hash = ?")
            .bind(hash_token(&b))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE session SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?",
        )
        .bind(hash_token(&c))
        .execute(&pool)
        .await
        .unwrap();
        let ka = kennung_zu(&pool, &a).await;

        let liste = liste(&pool, id, Some(&ka)).await.unwrap();
        let kurz: Vec<(Option<&str>, bool)> = liste
            .iter()
            .map(|s| (s.geraet.as_deref(), s.aktuell))
            .collect();
        assert_eq!(
            kurz,
            vec![
                (Some("Firefox · Windows"), true),
                (Some("Safari · iPadOS"), false)
            ],
            "zuletzt gesehen zuerst, abgelaufene nicht"
        );
    }

    #[tokio::test]
    async fn beenden_loescht_nur_die_auswahl_und_laesst_das_konto() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let a = anlegen(&pool, id, Some("Firefox · Windows")).await.unwrap();
        let b = anlegen(&pool, id, Some("Safari · iPadOS")).await.unwrap();
        let c = anlegen(&pool, id, None).await.unwrap();
        let (ka, kb) = (kennung_zu(&pool, &a).await, kennung_zu(&pool, &b).await);
        let konto = || async {
            sqlx::query_as::<_, (i64, String)>(
                "SELECT aktiv, passwort_hash FROM benutzer WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        let vorher = konto().await;

        let eine = beenden(&pool, id, Auswahl::Eine(&kb)).await.unwrap();
        assert_eq!(eine.len(), 1);
        assert_eq!(eine[0].kennung, kb);
        assert_eq!(eine[0].geraet.as_deref(), Some("Safari · iPadOS"));
        assert!(matches!(
            benutzer_aus_token(&pool, &b).await,
            Err(AppError::Unauthorized)
        ));
        assert!(
            beenden(&pool, id, Auswahl::Eine(&kb))
                .await
                .unwrap()
                .is_empty(),
            "idempotent"
        );

        let andere = beenden(&pool, id, Auswahl::AlleAusser(Some(&ka)))
            .await
            .unwrap();
        assert_eq!(andere.len(), 1, "nur c");
        assert!(
            benutzer_aus_token(&pool, &a).await.is_ok(),
            "die ausgenommene bleibt"
        );
        assert!(benutzer_aus_token(&pool, &c).await.is_err());

        let alle = beenden(&pool, id, Auswahl::AlleAusser(None)).await.unwrap();
        assert_eq!(alle.len(), 1);
        assert!(benutzer_aus_token(&pool, &a).await.is_err());
        assert_eq!(konto().await, vorher, "Konto unverändert");
    }

    #[tokio::test]
    async fn loeschwege_liefern_die_kennungen() {
        let pool = crate::db::test_pool().await;
        let id = benutzer_anlegen(&pool, 1).await;
        let a = anlegen(&pool, id, None).await.unwrap();
        let b = anlegen(&pool, id, None).await.unwrap();
        let c = anlegen(&pool, id, None).await.unwrap();
        let (ka, kb, kc) = (
            kennung_zu(&pool, &a).await,
            kennung_zu(&pool, &b).await,
            kennung_zu(&pool, &c).await,
        );
        assert_eq!(loeschen(&pool, &a).await.unwrap(), Some(ka));
        assert_eq!(loeschen(&pool, &a).await.unwrap(), None);
        let mut conn = pool.acquire().await.unwrap();
        assert_eq!(andere_loeschen(&mut conn, id, &c).await.unwrap(), vec![kb]);
        assert_eq!(alle_loeschen(&mut conn, id).await.unwrap(), vec![kc]);
    }
}

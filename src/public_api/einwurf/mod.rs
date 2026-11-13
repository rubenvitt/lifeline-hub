//! Einwurf-Zugang für Absender ohne Signatur (LLH-1654, ADR-0023, Spec `einwurf-zugang`):
//! BOSWatch, FE2 mit „URL öffnen“, der Divera-Webhook und OsmAnd können nur eine URL aufrufen.
//! Sie bekommen einen Zugang mit geheimem Schlüssel im Pfad, der nur in eine Ablage schreibt und
//! nichts liest.
//!
//! - Dieses Modul: Schlüssel, Repo der Zugänge, Maskierung des Protokollpfads, Transportlage und
//!   Löschlauf.
//! - [`ablage`]: was ein Einwurf speichert (Alarmmeldungen roh mit Doppelerkennung, die letzte
//!   Position je Kennung).
//! - [`routen`]: die vier Routen unter `/api/v1/einwurf/` und die Reihenfolge ihrer Prüfungen.
//!
//! **Der Schlüssel steht in keinem Protokoll.** Kein `tracing`-Aufruf in diesem Modul nennt
//! Pfad, Abfrage, Schlüssel oder Hash; wer etwas protokolliert, nennt die Kennung des Zugangs.
//!
//! Herleitung: `openspec/changes/archive/2026-11-13-s1i56dpt-einwurf-zugang/design.md`.

pub mod ablage;
pub mod routen;

use std::borrow::Cow;

use argon2::password_hash::rand_core::{OsRng, RngCore};
use base64::Engine;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::scope::Scope;
use crate::error::AppError;
use crate::wire_enum::wire_enum;

/// Präfix jedes Einwurf-Schlüssels: in einer Konfigurationsdatei als Lifeline-Schlüssel
/// erkennbar, und [`maskiere_pfad`] findet ihn auch in einem vertippten Pfad.
pub const SCHLUESSEL_PRAEFIX: &str = "llh_ew_";

/// Länge eines Schlüssels: Präfix und 32 Bytes als base64url ohne Auffüllung (43 Zeichen).
pub const SCHLUESSEL_LAENGE: usize = SCHLUESSEL_PRAEFIX.len() + 43;

/// Platzhalter für einen Pfadabschnitt, der ein Geheimnis trägt.
pub const MASKE: &str = "***";

/// Die Zwecke, die ein Einwurf-Zugang haben kann; genau einer je Zugang.
pub const ZWECKE: [Scope; 2] = [Scope::AlarmmeldungenWrite, Scope::PositionenWrite];

/// Alarmmeldungen bleiben 7 Tage in der Ablage (Konzept Schnittstellen-Ausbau, E5).
pub const ALARMMELDUNG_TAGE: i64 = 7;

/// Eine Position verfällt 24 Stunden nach ihrem Empfang.
pub const POSITION_STUNDEN: i64 = 24;

/// Erzeugt einen neuen Schlüssel: 32 Zufallsbytes, base64url ohne Auffüllung.
pub fn neuer_schluessel() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!(
        "{SCHLUESSEL_PRAEFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

/// SHA-256-Hex eines Schlüssels; nur das steht in der Datenbank.
pub fn hash(schluessel: &str) -> String {
    crate::anhang::repo::sha256_hex(schluessel.as_bytes())
}

/// Hat der Text die Form eines Schlüssels? Was sie nicht hat, sucht niemand in der Datenbank.
pub fn has_schluessel_form(text: &str) -> bool {
    text.len() == SCHLUESSEL_LAENGE
        && text.strip_prefix(SCHLUESSEL_PRAEFIX).is_some_and(|rest| {
            rest.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
}

/// Löst `%XX` in einem Pfadabschnitt auf, nur für den Vergleich mit dem Schlüsselpräfix. Was
/// kein ASCII ergibt, wird zu `?`: Der Schlüssel selbst besteht nur aus ASCII.
fn percent_decode_ascii(abschnitt: &str) -> String {
    let bytes = abschnitt.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16).map(|z| z as u8);
    let mut aus = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let dekodiert = match bytes.get(i..i + 3) {
            Some([b'%', a, b]) => hex(*a).zip(hex(*b)).map(|(a, b)| a * 16 + b),
            _ => None,
        };
        let byte = match dekodiert {
            Some(byte) => {
                i += 3;
                byte
            }
            None => {
                i += 1;
                bytes[i - 1]
            }
        };
        aus.push(if byte.is_ascii() { byte as char } else { '?' });
    }
    aus
}

/// Trägt der Pfadabschnitt einen Einwurf-Schlüssel? Das Präfix zählt an jeder Stelle des
/// Abschnitts und auch prozentkodiert: `einwurfllh_ew_…` (Schrägstrich vergessen) und
/// `llh%5Few%5F…` führen zu keiner Route, landeten aber im Protokoll.
fn has_schluessel(abschnitt: &str) -> bool {
    abschnitt.contains(SCHLUESSEL_PRAEFIX)
        || (abschnitt.contains('%') && percent_decode_ascii(abschnitt).contains(SCHLUESSEL_PRAEFIX))
}

/// Ersetzt im Pfad den Abschnitt nach `/api/v1/einwurf/` und jeden Abschnitt, der das
/// Schlüsselpräfix enthält, durch [`MASKE`]. Die zweite Regel fängt vertippte Pfade, die zu
/// keiner Route führen und trotzdem im Protokoll landen.
pub fn maskiere_pfad(pfad: &str) -> Cow<'_, str> {
    let einwurf = pfad
        .strip_prefix(super::PREFIX)
        .and_then(|rest| rest.strip_prefix("/einwurf/"))
        .map(|rest| rest.split('/').next().unwrap_or_default())
        .filter(|abschnitt| !abschnitt.is_empty());
    if einwurf.is_none() && !pfad.split('/').any(has_schluessel) {
        return Cow::Borrowed(pfad);
    }
    // Abschnitt 0 ist leer (führender Schrägstrich), 1–3 sind `api`, `v1`, `einwurf`.
    let maskiert: Vec<&str> = pfad
        .split('/')
        .enumerate()
        .map(|(i, abschnitt)| {
            if (i == 4 && einwurf.is_some()) || has_schluessel(abschnitt) {
                MASKE
            } else {
                abschnitt
            }
        })
        .collect();
    Cow::Owned(maskiert.join("/"))
}

/// Wie die Instanz Anfragen entgegennimmt (`crate::app::RouterOptionen`), als `Extension` am
/// Router. Fehlt die Angabe, gilt die Vorgabe: kein TLS, kein Schalter, also kein Einwurf.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Transport {
    /// Der Server terminiert TLS selbst (`--tls`).
    pub tls: bool,
    /// Der Betreiber nimmt Einwürfe auch ohne TLS an (`--einwurf-allow-http`).
    pub einwurf_allow_http: bool,
}

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for Transport {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(parts
            .extensions
            .get::<Transport>()
            .copied()
            .unwrap_or_default())
    }
}

wire_enum! {
    /// Über welchen Weg Einwürfe diese Instanz erreichen; die Seite „Anbindungen“ warnt bei
    /// `http` und `keiner`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EinwurfTransport {
        /// Der Server terminiert TLS selbst.
        Tls => "tls",
        /// Ein vertrauter Proxy terminiert TLS (`--trusted-proxies` gesetzt).
        Proxy => "proxy",
        /// Der Betreiber nimmt Einwürfe auch unverschlüsselt an.
        Http => "http",
        /// Kein Weg mit TLS und kein Schalter: jeder Einwurf wird abgelehnt.
        Keiner => "keiner",
    }
}

impl Transport {
    /// Die Lage für die Verwaltung. `proxys_gesetzt`: die Liste der vertrauten Proxys ist nicht
    /// leer.
    pub fn lage(self, proxys_gesetzt: bool) -> EinwurfTransport {
        if self.tls {
            EinwurfTransport::Tls
        } else if self.einwurf_allow_http {
            EinwurfTransport::Http
        } else if proxys_gesetzt {
            EinwurfTransport::Proxy
        } else {
            EinwurfTransport::Keiner
        }
    }
}

/// Ein Einwurf-Zugang, wie Routen und Verwaltung ihn lesen. Der Schlüssel steht nie darin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EinwurfZugang {
    pub id: String,
    pub org_id: i64,
    pub name: String,
    pub scope: Scope,
    pub gueltig_bis: Option<String>,
    pub angelegt_at: String,
    pub schluessel_gewechselt_at: Option<String>,
    pub widerrufen_at: Option<String>,
    /// Anzeigename des Admins, der widerrufen hat.
    pub widerrufen_von_name: Option<String>,
    pub zuletzt_genutzt_at: Option<String>,
}

impl EinwurfZugang {
    /// Ist „gültig bis“ verstrichen? `jetzt` in `zeit::FORMAT`.
    pub fn is_abgelaufen(&self, jetzt: &str) -> bool {
        self.gueltig_bis.as_deref().is_some_and(|bis| bis <= jetzt)
    }

    pub fn is_widerrufen(&self) -> bool {
        self.widerrufen_at.is_some()
    }
}

type Zeile = (
    String,
    i64,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Spalten in der Reihenfolge von [`Zeile`]; ein Makro, weil sqlx nur statische Texte nimmt.
macro_rules! spalten {
    () => {
        "id, org_id, name, scope, gueltig_bis, angelegt_at, schluessel_gewechselt_at, \
         widerrufen_at, (SELECT anzeigename FROM benutzer WHERE id = widerrufen_von), \
         zuletzt_genutzt_at"
    };
}

fn aus_zeile(z: Zeile) -> Result<EinwurfZugang, AppError> {
    let scope = Scope::parse(&z.3)
        .filter(|s| ZWECKE.contains(s))
        .ok_or_else(|| AppError::Internal(format!("Einwurf-Zugang {}: Zweck unbekannt", z.0)))?;
    Ok(EinwurfZugang {
        scope,
        id: z.0,
        org_id: z.1,
        name: z.2,
        gueltig_bis: z.4,
        angelegt_at: z.5,
        schluessel_gewechselt_at: z.6,
        widerrufen_at: z.7,
        widerrufen_von_name: z.8,
        zuletzt_genutzt_at: z.9,
    })
}

/// Legt einen Zugang an und liefert seine Kennung (UUID) und den Schlüssel. Der Schlüssel
/// verlässt den Server nur hier und in [`schluessel_wechseln`].
pub async fn anlegen(
    conn: &mut SqliteConnection,
    org_id: i64,
    name: &str,
    scope: Scope,
    gueltig_bis: Option<&str>,
    von: Option<i64>,
    jetzt: &str,
) -> Result<(String, String), AppError> {
    if !ZWECKE.contains(&scope) {
        return Err(AppError::Validation(format!(
            "scope: „{}“ ist kein Zweck eines Einwurf-Zugangs",
            scope.as_str()
        )));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let schluessel = neuer_schluessel();
    sqlx::query(
        "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, gueltig_bis, \
         angelegt_at, angelegt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(org_id)
    .bind(name)
    .bind(scope.as_str())
    .bind(hash(&schluessel))
    .bind(gueltig_bis)
    .bind(jetzt)
    .bind(von)
    .execute(&mut *conn)
    .await?;
    Ok((id, schluessel))
}

/// Die Zugänge einer Org: nicht widerrufene zuerst, dann nach Name.
pub async fn liste(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Vec<EinwurfZugang>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(concat!(
        "SELECT ",
        spalten!(),
        " FROM einwurf_zugang WHERE org_id = ? \
         ORDER BY widerrufen_at IS NOT NULL, name COLLATE NOCASE, id"
    ))
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    zeilen.into_iter().map(aus_zeile).collect()
}

/// Ein Zugang der Org; `None`, wenn er unbekannt ist oder einer anderen Org gehört.
pub async fn load_in_org(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Option<EinwurfZugang>, AppError> {
    let zeile: Option<Zeile> = sqlx::query_as(concat!(
        "SELECT ",
        spalten!(),
        " FROM einwurf_zugang WHERE id = ? AND org_id = ?"
    ))
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    zeile.map(aus_zeile).transpose()
}

/// Sucht den Zugang zu einem Schlüssel über dessen Hash. Liefert auch widerrufene und
/// abgelaufene Zugänge: Der Aufrufer unterscheidet „unbekannt“ (zählt im Maschinenzähler) von
/// „bekannt, aber ungültig“ (zählt nicht).
pub async fn find_by_schluessel(
    conn: &mut SqliteConnection,
    schluessel: &str,
) -> Result<Option<EinwurfZugang>, AppError> {
    if !has_schluessel_form(schluessel) {
        return Ok(None);
    }
    let zeile: Option<Zeile> = sqlx::query_as(concat!(
        "SELECT ",
        spalten!(),
        " FROM einwurf_zugang WHERE schluessel_hash = ?"
    ))
    .bind(hash(schluessel))
    .fetch_optional(&mut *conn)
    .await?;
    zeile.map(aus_zeile).transpose()
}

/// Gibt einem Zugang der Org einen neuen Schlüssel; der alte gilt ab dem Commit nicht mehr.
/// `Ok(None)`: unbekannt oder fremd. Ein widerrufener oder abgelaufener Zugang bekommt keinen
/// (409): Die neue Adresse gälte nicht, und „gültig bis“ lässt sich nicht ändern.
///
/// Der abgelöste Hash bleibt in `einwurf_schluessel_abgeloest` stehen, damit [`is_abgeloest`]
/// den alten Schlüssel als „bekannt, aber ungültig“ erkennt.
pub async fn schluessel_wechseln(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    jetzt: &str,
) -> Result<Option<String>, AppError> {
    let Some(zugang) = load_in_org(conn, org_id, id).await? else {
        return Ok(None);
    };
    if zugang.is_widerrufen() {
        return Err(AppError::Conflict(
            "Ein widerrufener Zugang bekommt keinen neuen Schlüssel.".into(),
        ));
    }
    if zugang.is_abgelaufen(jetzt) {
        return Err(AppError::Conflict(
            "Ein abgelaufener Zugang bekommt keinen neuen Schlüssel.".into(),
        ));
    }
    let schluessel = neuer_schluessel();
    sqlx::query(
        "INSERT OR IGNORE INTO einwurf_schluessel_abgeloest (schluessel_hash, zugang_id, \
         abgeloest_at) SELECT schluessel_hash, id, ?1 FROM einwurf_zugang WHERE id = ?2",
    )
    .bind(jetzt)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einwurf_zugang SET schluessel_hash = ?, schluessel_gewechselt_at = ? \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(hash(&schluessel))
    .bind(jetzt)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(Some(schluessel))
}

/// War der Schlüssel einmal gültig und ist durch einen Wechsel abgelöst? Dann ist er „bekannt,
/// aber ungültig“ wie ein widerrufener: 401, ohne Fehlversuch im Zähler für Maschinen.
pub async fn is_abgeloest(conn: &mut SqliteConnection, schluessel: &str) -> Result<bool, AppError> {
    if !has_schluessel_form(schluessel) {
        return Ok(false);
    }
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einwurf_schluessel_abgeloest WHERE schluessel_hash = ?")
            .bind(hash(schluessel))
            .fetch_optional(&mut *conn)
            .await?;
    Ok(treffer.is_some())
}

/// Widerruft einen Zugang der Org. `Ok(None)`: unbekannt oder fremd; `Ok(Some(false))`: war
/// schon widerrufen (keine Wirkung, kein Eintrag in der Admin-Spur).
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    von: Option<i64>,
    jetzt: &str,
) -> Result<Option<bool>, AppError> {
    if load_in_org(conn, org_id, id).await?.is_none() {
        return Ok(None);
    }
    let n = sqlx::query(
        "UPDATE einwurf_zugang SET widerrufen_at = ?, widerrufen_von = ? \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(jetzt)
    .bind(von)
    .bind(id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(Some(n > 0))
}

/// Schreibt „zuletzt genutzt“ fort, höchstens einmal je Minute.
pub async fn nutzung_vermerken(
    conn: &mut SqliteConnection,
    id: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einwurf_zugang SET zuletzt_genutzt_at = ?1 WHERE id = ?2 \
         AND (zuletzt_genutzt_at IS NULL OR zuletzt_genutzt_at <= datetime(?1, '-1 minute'))",
    )
    .bind(jetzt)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Löschlauf (Purge, Phase C): Alarmmeldungen [`ALARMMELDUNG_TAGE`] Tage nach dem ersten
/// Empfang, Positionen [`POSITION_STUNDEN`] Stunden nach dem Empfang. Ein erneuter Empfang
/// verlängert die Frist einer Alarmmeldung nicht. Zugänge bleiben, auch widerrufene.
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM alarmmeldung WHERE empfangen_at < datetime(?, ?)")
        .bind(jetzt)
        .bind(format!("-{ALARMMELDUNG_TAGE} days"))
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM position_letzte WHERE empfangen_at < datetime(?, ?)")
        .bind(jetzt)
        .bind(format!("-{POSITION_STUNDEN} hours"))
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db;

    pub(crate) const JETZT: &str = "2026-11-12 10:00:00";

    pub(crate) async fn neuer_zugang(pool: &SqlitePool, scope: Scope) -> (EinwurfZugang, String) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        let (id, schluessel) = anlegen(&mut c, 1, "BOSWatch Wache 1", scope, None, None, JETZT)
            .await
            .unwrap();
        let zugang = load_in_org(&mut c, 1, &id).await.unwrap().unwrap();
        (zugang, schluessel)
    }

    #[test]
    fn schluessel_haben_praefix_laenge_und_unterscheiden_sich() {
        let a = neuer_schluessel();
        let b = neuer_schluessel();
        assert_ne!(a, b);
        assert!(a.starts_with("llh_ew_"));
        assert_eq!(a.len(), SCHLUESSEL_LAENGE);
        assert!(has_schluessel_form(&a));
        assert_eq!(hash(&a).len(), 64);
        assert_ne!(hash(&a), hash(&b));
    }

    #[test]
    fn falsche_form_ist_kein_schluessel() {
        let gut = neuer_schluessel();
        for falsch in [
            String::new(),
            "llh_ew_".to_string(),
            gut[..gut.len() - 1].to_string(),
            format!("{gut}x"),
            gut.replacen("llh_ew_", "llh_lm_", 1),
            format!("{}!", &gut[..gut.len() - 1]),
            format!("{}ä", &gut[..gut.len() - 2]),
        ] {
            assert!(!has_schluessel_form(&falsch), "{falsch}");
        }
    }

    #[tokio::test]
    async fn falsche_form_wird_ohne_treffer_abgelehnt() {
        let pool = db::test_pool().await;
        let mut c = pool.acquire().await.unwrap();
        assert!(find_by_schluessel(&mut c, "llh_ew_zu-kurz")
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    fn pfad_wird_nach_einwurf_maskiert() {
        let s = neuer_schluessel();
        assert_eq!(
            maskiere_pfad(&format!("/api/v1/einwurf/{s}/alarmmeldung")),
            "/api/v1/einwurf/***/alarmmeldung"
        );
        // Auch ein Abschnitt, der kein Schlüssel ist: nach `/einwurf/` steht immer ein Geheimnis.
        assert_eq!(
            maskiere_pfad("/api/v1/einwurf/irgendwas/position"),
            "/api/v1/einwurf/***/position"
        );
        assert_eq!(
            maskiere_pfad(&format!("/api/v1/einwurf/{s}")),
            "/api/v1/einwurf/***"
        );
        assert_eq!(maskiere_pfad("/api/v1/einwurf/"), "/api/v1/einwurf/");
    }

    #[test]
    fn schluessel_wird_auch_an_anderer_stelle_maskiert() {
        let s = neuer_schluessel();
        for (pfad, erwartet) in [
            (
                format!("/api/v1/einwurff/{s}/alarmmeldung"),
                "/api/v1/einwurff/***/alarmmeldung",
            ),
            (format!("/einwurf/{s}"), "/einwurf/***"),
            (
                format!("/api/v1/einwurf/x/{s}/alarmmeldung"),
                "/api/v1/einwurf/***/***/alarmmeldung",
            ),
            (format!("/{s}xyz"), "/***"),
        ] {
            let maskiert = maskiere_pfad(&pfad);
            assert_eq!(maskiert, erwartet);
            assert!(!maskiert.contains(&s));
        }
    }

    #[test]
    fn schluessel_mitten_im_abschnitt_und_prozentkodiert_wird_maskiert() {
        let s = neuer_schluessel();
        let kodiert = s.replace('_', "%5F");
        let ganz_kodiert: String = s.bytes().map(|b| format!("%{b:02x}")).collect();
        for pfad in [
            // Schrägstrich zwischen Adresse und Schlüssel vergessen.
            format!("/api/v1/einwurf{s}/alarmmeldung"),
            format!("/api/v1/einwurf={s}/alarmmeldung"),
            format!("/api/v1/einwurff/'{s}'/alarmmeldung"),
            format!("/api/v1/einwurff/{kodiert}/alarmmeldung"),
            format!("/api/v1/einwurff/{ganz_kodiert}/alarmmeldung"),
        ] {
            let maskiert = maskiere_pfad(&pfad);
            assert!(maskiert.contains(MASKE), "{pfad}");
            assert!(!maskiert.contains(&s[7..]), "{pfad} → {maskiert}");
            assert!(!maskiert.contains(&kodiert[9..]), "{pfad} → {maskiert}");
            assert!(
                !maskiert.contains(&ganz_kodiert[21..]),
                "{pfad} → {maskiert}"
            );
        }
        // Ein Prozentzeichen ohne Schlüssel maskiert nichts.
        assert_eq!(
            maskiere_pfad("/api/einsaetze/a%20b"),
            "/api/einsaetze/a%20b"
        );
        assert_eq!(maskiere_pfad("/x/100%/y%zz"), "/x/100%/y%zz");
    }

    #[test]
    fn fremder_pfad_bleibt_unveraendert() {
        for pfad in ["/api/v1/me", "/api/einsaetze/7", "/", "", "/api/v1/einwurf"] {
            assert!(matches!(maskiere_pfad(pfad), Cow::Borrowed(p) if p == pfad));
        }
    }

    #[test]
    fn transportlage() {
        let t = |tls, einwurf_allow_http| Transport {
            tls,
            einwurf_allow_http,
        };
        assert_eq!(t(true, false).lage(false), EinwurfTransport::Tls);
        assert_eq!(t(true, true).lage(true), EinwurfTransport::Tls);
        assert_eq!(t(false, true).lage(true), EinwurfTransport::Http);
        assert_eq!(t(false, true).lage(false), EinwurfTransport::Http);
        assert_eq!(t(false, false).lage(true), EinwurfTransport::Proxy);
        assert_eq!(t(false, false).lage(false), EinwurfTransport::Keiner);
        assert_eq!(Transport::default().lage(false), EinwurfTransport::Keiner);
    }

    #[tokio::test]
    async fn anlegen_laden_und_suche_ueber_den_hash() {
        let pool = db::test_pool().await;
        let (zugang, schluessel) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let mut c = pool.acquire().await.unwrap();
        assert_eq!(zugang.scope, Scope::AlarmmeldungenWrite);
        assert!(!zugang.is_widerrufen());
        assert!(load_in_org(&mut c, 999, &zugang.id)
            .await
            .unwrap()
            .is_none());
        assert_eq!(liste(&mut c, 1).await.unwrap().len(), 1);
        let gefunden = find_by_schluessel(&mut c, &schluessel)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(gefunden.id, zugang.id);
        assert!(find_by_schluessel(&mut c, &neuer_schluessel())
            .await
            .unwrap()
            .is_none());
        // Gespeichert ist nur der Hash.
        let (gespeichert,): (String,) =
            sqlx::query_as("SELECT schluessel_hash FROM einwurf_zugang WHERE id = ?")
                .bind(&zugang.id)
                .fetch_one(&mut *c)
                .await
                .unwrap();
        assert_eq!(gespeichert, hash(&schluessel));
        assert_ne!(gespeichert, schluessel);
    }

    #[tokio::test]
    async fn nur_die_beiden_zwecke_sind_anlegbar() {
        let pool = db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        let fehler = anlegen(&mut c, 1, "x", Scope::LageRead, None, None, JETZT)
            .await
            .unwrap_err();
        assert!(matches!(fehler, AppError::Validation(_)));
        // Der CHECK der Tabelle hält dieselbe Grenze.
        let roh = sqlx::query(
            "INSERT INTO einwurf_zugang (id, org_id, name, scope, schluessel_hash, angelegt_at) \
             VALUES ('x', 1, 'x', 'lage:read', 'h', ?)",
        )
        .bind(JETZT)
        .execute(&mut *c)
        .await;
        assert!(roh.is_err(), "CHECK auf scope");
    }

    #[tokio::test]
    async fn wechsel_macht_den_alten_schluessel_unauffindbar() {
        let pool = db::test_pool().await;
        let (zugang, alt) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let mut c = pool.acquire().await.unwrap();
        let neu = schluessel_wechseln(&mut c, 1, &zugang.id, "2026-11-12 11:00:00")
            .await
            .unwrap()
            .unwrap();
        assert_ne!(alt, neu);
        assert!(find_by_schluessel(&mut c, &alt).await.unwrap().is_none());
        let z = find_by_schluessel(&mut c, &neu).await.unwrap().unwrap();
        assert_eq!(z.id, zugang.id);
        assert_eq!(
            z.schluessel_gewechselt_at.as_deref(),
            Some("2026-11-12 11:00:00")
        );
        assert_eq!(z.name, zugang.name);
        assert!(schluessel_wechseln(&mut c, 999, &zugang.id, JETZT)
            .await
            .unwrap()
            .is_none());
        // Der alte Schlüssel ist „bekannt, aber ungültig“, auch nach einem zweiten Wechsel; ein
        // nie vergebener ist es nicht.
        let dritter = schluessel_wechseln(&mut c, 1, &zugang.id, "2026-11-12 12:00:00")
            .await
            .unwrap()
            .unwrap();
        assert!(is_abgeloest(&mut c, &alt).await.unwrap());
        assert!(is_abgeloest(&mut c, &neu).await.unwrap());
        assert!(!is_abgeloest(&mut c, &dritter).await.unwrap());
        assert!(!is_abgeloest(&mut c, &neuer_schluessel()).await.unwrap());
        assert!(!is_abgeloest(&mut c, "llh_ew_kurz").await.unwrap());
    }

    #[tokio::test]
    async fn abgelaufener_zugang_bekommt_keinen_neuen_schluessel() {
        let pool = db::test_pool().await;
        let (zugang, schluessel) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        sqlx::query("UPDATE einwurf_zugang SET gueltig_bis = '2026-11-12 09:00:00' WHERE id = ?")
            .bind(&zugang.id)
            .execute(&pool)
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        let fehler = schluessel_wechseln(&mut c, 1, &zugang.id, JETZT)
            .await
            .unwrap_err();
        assert!(matches!(fehler, AppError::Conflict(_)));
        // Nichts geändert: der alte Schlüssel bleibt der des Zugangs.
        assert!(find_by_schluessel(&mut c, &schluessel)
            .await
            .unwrap()
            .is_some());
        assert!(!is_abgeloest(&mut c, &schluessel).await.unwrap());
    }

    #[tokio::test]
    async fn widerruf_wirkt_einmal_und_sperrt_den_wechsel() {
        let pool = db::test_pool().await;
        let (zugang, schluessel) = neuer_zugang(&pool, Scope::PositionenWrite).await;
        let mut c = pool.acquire().await.unwrap();
        assert_eq!(
            widerrufen(&mut c, 999, &zugang.id, None, JETZT)
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            widerrufen(&mut c, 1, &zugang.id, None, JETZT)
                .await
                .unwrap(),
            Some(true)
        );
        assert_eq!(
            widerrufen(&mut c, 1, &zugang.id, None, "2026-11-12 12:00:00")
                .await
                .unwrap(),
            Some(false),
            "zweiter Widerruf hat keine Wirkung"
        );
        // Der Schlüssel bleibt auffindbar („bekannt, aber ungültig“), der Zugang ist widerrufen.
        let z = find_by_schluessel(&mut c, &schluessel)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(z.widerrufen_at.as_deref(), Some(JETZT));
        let fehler = schluessel_wechseln(&mut c, 1, &zugang.id, JETZT)
            .await
            .unwrap_err();
        assert!(matches!(fehler, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn zuletzt_genutzt_wird_hoechstens_minuetlich_geschrieben() {
        let pool = db::test_pool().await;
        let (zugang, _) = neuer_zugang(&pool, Scope::AlarmmeldungenWrite).await;
        let mut c = pool.acquire().await.unwrap();
        async fn stand(c: &mut SqliteConnection, id: &str) -> Option<String> {
            load_in_org(c, 1, id)
                .await
                .unwrap()
                .unwrap()
                .zuletzt_genutzt_at
        }
        nutzung_vermerken(&mut c, &zugang.id, "2026-11-12 10:00:00")
            .await
            .unwrap();
        nutzung_vermerken(&mut c, &zugang.id, "2026-11-12 10:00:30")
            .await
            .unwrap();
        assert_eq!(
            stand(&mut c, &zugang.id).await.as_deref(),
            Some("2026-11-12 10:00:00")
        );
        nutzung_vermerken(&mut c, &zugang.id, "2026-11-12 10:01:00")
            .await
            .unwrap();
        assert_eq!(
            stand(&mut c, &zugang.id).await.as_deref(),
            Some("2026-11-12 10:01:00")
        );
    }
}

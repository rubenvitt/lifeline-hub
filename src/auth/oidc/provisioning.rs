//! Claims→Benutzer-Provisioning (LFH-41): least-privilege JIT-Anlage beim ersten OIDC-Login.
//! Matching AUSSCHLIESSLICH über `(oidc_issuer, oidc_subject)` — nie per E-Mail oder
//! Benutzername an ein bestehendes lokales Konto.

use crate::auth::{Benutzer, ORG_ROLLE_KEINE, PASSWORT_HASH_SSO_ONLY, ROLLE_KEINER};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashSet;

/// Aus dem `id_token` extrahierte, für die Provisionierung relevante Claims.
#[derive(Debug, Clone)]
pub struct OidcClaims {
    pub issuer: String,
    pub subject: String,
    pub preferred_username: Option<String>,
    pub name: Option<String>,
}

/// Leitet einen Benutzernamen-Kandidaten aus den Claims ab (pur, ohne DB): `preferred_username`
/// falls nicht leer, sonst `subject`, normalisiert. Solange `kollision` zutrifft, wird
/// deterministisch `-2`, `-3`, … angehängt.
pub fn plane_benutzername(claims: &OidcClaims, kollision: impl Fn(&str) -> bool) -> String {
    let rohname = claims
        .preferred_username
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(claims.subject.as_str());

    let basis = sanitisiere_benutzername(rohname);

    if !kollision(&basis) {
        return basis;
    }

    let mut n: u32 = 2;
    loop {
        let kandidat = format!("{basis}-{n}");
        if !kollision(&kandidat) {
            return kandidat;
        }
        n += 1;
    }
}

/// Normalisiert auf `[a-z0-9._-]`, fasst Mehrfach-Trennzeichen zusammen und entfernt sie am
/// Rand. Ein leeres Ergebnis wird zu `"benutzer"`.
fn sanitisiere_benutzername(roh: &str) -> String {
    let normalisiert: String = roh
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();

    let mut bereinigt = String::with_capacity(normalisiert.len());
    let mut letzter_trenner = false;
    for c in normalisiert.chars() {
        let ist_trenner = matches!(c, '.' | '_' | '-');
        if ist_trenner && letzter_trenner {
            continue;
        }
        bereinigt.push(c);
        letzter_trenner = ist_trenner;
    }
    let bereinigt = bereinigt
        .trim_matches(|c| matches!(c, '.' | '_' | '-'))
        .to_string();

    if bereinigt.is_empty() {
        "benutzer".to_string()
    } else {
        bereinigt
    }
}

/// Leitet den Anzeigenamen ab (pur): `name` → `preferred_username` → `subject`, jeweils der
/// erste nach dem Trimmen nicht leere Wert. `subject` ist OIDC-Pflichtclaim.
pub fn plane_anzeigename(claims: &OidcClaims) -> String {
    [claims.name.as_deref(), claims.preferred_username.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or_else(|| claims.subject.trim())
        .to_string()
}

/// Findet den Benutzer zu `(issuer, subject)` oder legt beim ersten Login ein least-privilege-
/// Konto an (`system_rolle = keiner`, `org_rolle = keine`, Sentinel-Passworthash). Ein lokales
/// Konto gleichen Namens ohne SSO-Bindung wird nie verlinkt; der neue Name bekommt dann ein
/// Suffix.
pub async fn finde_oder_provisioniere(
    pool: &SqlitePool,
    claims: &OidcClaims,
) -> Result<Benutzer, AppError> {
    if let Some(vorhanden) = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE oidc_issuer = ? AND oidc_subject = ?",
    )
    .bind(&claims.issuer)
    .bind(&claims.subject)
    .fetch_optional(pool)
    .await?
    {
        return Ok(vorhanden);
    }

    // Ziel-Organisation (LFH-232). Dieser Pfad legt Konten ohne Admin-Zutun an. Ohne Mapping
    // Issuer → Organisation ist die Zuordnung bei mehreren Organisationen nicht bestimmbar und wird
    // **fail-closed** abgelehnt; sonst landete jeder Erstlogin still in der Org mit der kleinsten
    // Id.
    let organisationen: Vec<i64> = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id")
        .fetch_all(pool)
        .await?;
    let org_id = match organisationen.as_slice() {
        [einzige] => *einzige,
        [] => return Err(AppError::Internal("Keine Organisation vorhanden".into())),
        _ => {
            tracing::error!(
                issuer = %claims.issuer,
                organisationen = organisationen.len(),
                "SSO-JIT-Provisioning abgelehnt: mehrere Organisationen, aber kein \
                 Issuer→Organisation-Mapping — Zuordnung wäre geraten (F05/LFH-232)"
            );
            return Err(AppError::Forbidden);
        }
    };

    // Vergebene Namen einmal laden, damit `plane_benutzername` pur bleibt.
    let vergebene_namen: HashSet<String> =
        sqlx::query_scalar::<_, String>("SELECT benutzername FROM benutzer")
            .fetch_all(pool)
            .await?
            .into_iter()
            .collect();

    let benutzername = plane_benutzername(claims, |kandidat| vergebene_namen.contains(kandidat));

    let anzeigename = plane_anzeigename(claims);

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
        // Re-SELECT per (issuer, subject), nicht per `last_insert_rowid`.
        Ok(_) => select_by_oidc(pool, &claims.issuer, &claims.subject)
            .await?
            .ok_or_else(|| {
                AppError::Internal("Angelegtes SSO-Konto nicht wiederauffindbar".into())
            }),
        // Race-Recover: ein paralleler Erstlogin war schneller. Bei jedem Unique-Fehler den
        // (issuer, subject)-SELECT wiederholen; findet er nichts, war es eine echte fremde
        // Namenskollision.
        Err(err) if ist_unique_verletzung(&err) => {
            match select_by_oidc(pool, &claims.issuer, &claims.subject).await? {
                Some(vorhanden) => Ok(vorhanden),
                None => Err(AppError::from(err)),
            }
        }
        Err(err) => Err(AppError::from(err)),
    }
}

/// Lädt den Benutzer per (issuer, subject). `last_insert_rowid` lieferte nach einem geschluckten
/// Konflikt eine fremde rowid.
async fn select_by_oidc(
    pool: &SqlitePool,
    issuer: &str,
    subject: &str,
) -> Result<Option<Benutzer>, sqlx::Error> {
    sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE oidc_issuer = ? AND oidc_subject = ?",
    )
    .bind(issuer)
    .bind(subject)
    .fetch_optional(pool)
    .await
}

/// True, wenn `err` eine SQLite-UNIQUE-Constraint-Verletzung ist (Race-Recover-Trigger).
fn ist_unique_verletzung(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(db) if db.is_unique_violation())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(
        issuer: &str,
        subject: &str,
        preferred_username: Option<&str>,
        name: Option<&str>,
    ) -> OidcClaims {
        OidcClaims {
            issuer: issuer.to_string(),
            subject: subject.to_string(),
            preferred_username: preferred_username.map(str::to_string),
            name: name.map(str::to_string),
        }
    }

    // --- plane_benutzername (pur, keine DB) ---

    #[test]
    fn benutzername_aus_preferred_username() {
        let c = claims("https://idp.example", "sub-1", Some("Max.Mustermann"), None);
        let name = plane_benutzername(&c, |_| false);
        assert_eq!(name, "max.mustermann");
    }

    #[test]
    fn benutzername_faellt_auf_subject_zurueck_wenn_kein_preferred_username() {
        let c = claims(
            "https://idp.example",
            "abc-123-sub",
            None,
            Some("Max Mustermann"),
        );
        let name = plane_benutzername(&c, |_| false);
        assert_eq!(name, "abc-123-sub");
    }

    #[test]
    fn benutzername_faellt_auf_subject_zurueck_wenn_preferred_username_leer() {
        let c = claims("https://idp.example", "abc-123-sub", Some("   "), None);
        let name = plane_benutzername(&c, |_| false);
        assert_eq!(name, "abc-123-sub");
    }

    #[test]
    fn benutzername_bei_kollision_wird_suffixiert() {
        let c = claims("https://idp.example", "sub-1", Some("max"), None);
        // "max" ist vergeben, "max-2" auch — erst "max-3" ist frei.
        let name = plane_benutzername(&c, |kandidat| kandidat == "max" || kandidat == "max-2");
        assert_eq!(name, "max-3");
    }

    #[test]
    fn benutzername_ohne_kollision_bleibt_unsuffixiert() {
        let c = claims("https://idp.example", "sub-1", Some("max"), None);
        let name = plane_benutzername(&c, |_| false);
        assert_eq!(name, "max");
    }

    // --- plane_anzeigename (pur, keine DB) ---

    #[test]
    fn anzeigename_ueberspringt_leere_und_whitespace_claims() {
        // name = whitespace, preferred_username = leer → Fallback auf subject.
        let c = claims("https://idp.example", "sub-x", Some(""), Some("   "));
        assert_eq!(plane_anzeigename(&c), "sub-x");
    }

    #[test]
    fn anzeigename_nimmt_name_vor_preferred_username() {
        let c = claims(
            "https://idp.example",
            "sub-x",
            Some("maxmuster"),
            Some("Max Mustermann"),
        );
        assert_eq!(plane_anzeigename(&c), "Max Mustermann");
    }

    #[test]
    fn anzeigename_faellt_auf_preferred_username_wenn_name_leer() {
        let c = claims(
            "https://idp.example",
            "sub-x",
            Some("maxmuster"),
            Some("  "),
        );
        assert_eq!(plane_anzeigename(&c), "maxmuster");
    }

    // --- finde_oder_provisioniere (gegen test_pool) ---

    async fn seed_org(pool: &SqlitePool) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn seed_lokalen_benutzer(pool: &SqlitePool, benutzername: &str) {
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Lokal', ?, 'irgendein-hash', 1)",
        )
        .bind(benutzername)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn unbekannter_issuer_sub_legt_least_privilege_konto_an() {
        let pool = crate::db::test_pool().await;
        seed_org(&pool).await;

        let c = claims(
            "https://idp.example",
            "sub-neu",
            Some("neuling"),
            Some("Neu Ling"),
        );
        let benutzer = finde_oder_provisioniere(&pool, &c).await.unwrap();

        assert_eq!(benutzer.benutzername, "neuling");
        assert_eq!(benutzer.anzeigename, "Neu Ling");
        assert_eq!(benutzer.system_rolle, crate::auth::SystemRolle::Keiner);
        assert_eq!(benutzer.org_rolle, crate::auth::OrgRolle::Keine);
        assert_eq!(benutzer.passwort_hash, PASSWORT_HASH_SSO_ONLY);

        let (issuer, subject): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT oidc_issuer, oidc_subject FROM benutzer WHERE id = ?")
                .bind(benutzer.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(issuer.as_deref(), Some("https://idp.example"));
        assert_eq!(subject.as_deref(), Some("sub-neu"));
    }

    #[tokio::test]
    async fn bekannter_issuer_sub_liefert_denselben_benutzer_ohne_doppel_insert() {
        let pool = crate::db::test_pool().await;
        seed_org(&pool).await;

        let c = claims(
            "https://idp.example",
            "sub-wieder",
            Some("wiederkehrer"),
            None,
        );
        let erster = finde_oder_provisioniere(&pool, &c).await.unwrap();
        let zweiter = finde_oder_provisioniere(&pool, &c).await.unwrap();

        assert_eq!(erster.id, zweiter.id);

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 1);
    }

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
        assert!(
            ist_unique_verletzung(&err),
            "erwartete Unique-Erkennung, fand {err:?}"
        );
    }

    #[tokio::test]
    async fn lokales_konto_mit_gleichem_namen_wird_nicht_verlinkt() {
        let pool = crate::db::test_pool().await;
        seed_org(&pool).await;
        seed_lokalen_benutzer(&pool, "max").await;

        let c = claims("https://idp.example", "sub-max-sso", Some("max"), None);
        let sso_benutzer = finde_oder_provisioniere(&pool, &c).await.unwrap();

        // Neues, eigenständiges Konto mit gesuffixtem Namen — kein Link ans lokale "max".
        assert_eq!(sso_benutzer.benutzername, "max-2");
        assert_eq!(sso_benutzer.passwort_hash, PASSWORT_HASH_SSO_ONLY);

        let lokaler_max = sqlx::query_as::<_, Benutzer>(
            "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
             FROM benutzer WHERE benutzername = 'max'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_ne!(lokaler_max.id, sso_benutzer.id);
        assert_eq!(lokaler_max.passwort_hash, "irgendein-hash");

        let (issuer, subject): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT oidc_issuer, oidc_subject FROM benutzer WHERE id = ?")
                .bind(lokaler_max.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(issuer.is_none());
        assert!(subject.is_none());

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 2);
    }

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
}

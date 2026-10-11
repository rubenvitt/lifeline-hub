//! Admin-Spur (LFH-1005): wer hat wann den Zugang verändert.
//!
//! `auth::audit` beantwortet „wer hat sich wann angemeldet“. Hier steht die zweite Hälfte: welcher
//! Admin ein Konto angelegt, deaktiviert, reaktiviert, in der Rolle geändert, ihm den Zweitfaktor
//! genommen oder einen Anmeldeweg geschaltet hat. Für ein Führungssystem im Behördenbetrieb ist
//! das dieselbe Frage.
//!
//! **Eigene Tabelle `admin_audit`, nicht `auth_audit`:** eine Admin-Aktion hat zwei Beteiligte
//! und manchmal gar kein Zielkonto (Anmeldeweg); in `auth_audit` hätten `benutzername` und
//! `provider` eine zweite Bedeutung bekommen, und der Spalten-CHECK hätte einen Rebuild der
//! lebenden Anmeldespur verlangt (Muster 0143).
//!
//! **Personenbezug:** Namen und IP sind personenbezogen, deshalb eine eigene Frist
//! ([`AUFBEWAHRUNG_TAGE`]), durchgesetzt von [`purge_abgelaufene`] im Purge-Scheduler.
//!
//! **Lesen:** `GET /api/zugangsprotokoll/zugangsaenderungen` (System-Admin, LFH-1097,
//! [`liste`]); das Lesen selbst schreibt keinen Eintrag.

use crate::auth::spur::SpurFilter;
use crate::auth::{Benutzer, OrgRolle, SystemRolle};
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::net::IpAddr;
use utoipa::ToSchema;

/// Aufbewahrungsfrist der Admin-Spur in Tagen.
///
/// Länger als die 90 Tage der Anmeldespur: Admin-Aktionen sind selten, und eine missbräuchliche
/// Zugangsänderung fällt oft erst Monate später auf (Jahresprüfung, Personalwechsel). Die Menge
/// personenbezogener Angaben bleibt dabei klein.
pub const AUFBEWAHRUNG_TAGE: i64 = 365;

wire_enum! {
    /// Protokollierte Admin-Aktion. Die Wire-Werte stehen als CHECK in
    /// `migrations/0156_admin_audit.sql`, erweitert in `0170_admin_audit_sitzung_beendet.sql` und
    /// `0174_admin_audit_einmalpasswort.sql` — beide Seiten müssen zusammenpassen (Test `jede_aktion_passiert_den_db_check`). Zugleich
    /// Schema-Anker der Union in [`ZugangsaenderungAnzeige`] (LFH-120).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AdminAktion {
        BenutzerAngelegt => "benutzer_angelegt",
        BenutzerDeaktiviert => "benutzer_deaktiviert",
        BenutzerReaktiviert => "benutzer_reaktiviert",
        /// System- oder Org-Rolle geändert; die Angaben nennen alt → neu.
        RolleGeaendert => "rolle_geaendert",
        ZweitfaktorZurueckgesetzt => "zweitfaktor_zurueckgesetzt",
        AnmeldewegAktiviert => "anmeldeweg_aktiviert",
        AnmeldewegDeaktiviert => "anmeldeweg_deaktiviert",
        /// Eine Sitzung des Zielkontos beendet (LFH-1092), ein Eintrag je Sitzung; die Angaben
        /// nennen Gerät und Anmeldezeit.
        SitzungBeendet => "sitzung_beendet",
        /// Einmalpasswort vergeben (LFH-1121): neues Passwort mit Änderungszwang, alle Sitzungen
        /// beendet. Ohne Detail; das Passwort steht nie in der Spur.
        EinmalpasswortVergeben => "einmalpasswort_vergeben",
    }
}

/// Worauf die Aktion zielt.
#[derive(Debug, Clone, Copy)]
pub enum Ziel<'a> {
    /// Ein Konto, mit seinem Benutzernamen (Login-Identität, nicht änderbar).
    Benutzer { id: i64, benutzername: &'a str },
    /// Ein Anmeldeweg, mit seiner id (`passwort`, `oidc`, …).
    Anmeldeweg(&'a str),
}

/// Was eine Zugangsänderung über Aktion und Ziel hinaus festhält (LFH-1152). Liegt als JSON in
/// `admin_audit.detail` und geht strukturiert an die Verwaltung, die Rollen und Zeit nach ihren
/// Konventionen beschriftet: Server und Frontend führen Rollennamen und Zeitformat so nur einmal.
/// Flach statt je Aktion getaggt; welche Felder stehen, ergibt sich aus der Aktion:
///
/// - `benutzer_angelegt`: `system_rolle`, `org_rolle`.
/// - `rolle_geaendert`: je geänderter Rolle `…_vorher` und die neue.
/// - `sitzung_beendet`: `geraet` (falls bekannt) und `angemeldet_at`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ZugangsAngaben {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_rolle_vorher: Option<SystemRolle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_rolle: Option<SystemRolle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_rolle_vorher: Option<OrgRolle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_rolle: Option<OrgRolle>,
    /// Grobe Gerätebezeichnung der beendeten Sitzung.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geraet: Option<String>,
    /// Anmeldezeit der beendeten Sitzung, UTC im SQLite-Format wie `zeitpunkt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angemeldet_at: Option<String>,
}

impl ZugangsAngaben {
    /// Liest gespeicherte Angaben; ein Text von vor LFH-1152 (oder sonst kein Objekt mit
    /// mindestens einem bekannten Feld) ist keine.
    fn aus_detail(detail: &str) -> Option<ZugangsAngaben> {
        serde_json::from_str::<ZugangsAngaben>(detail)
            .ok()
            .filter(|a| *a != ZugangsAngaben::default())
    }
}

/// Ein Eintrag der Admin-Spur.
#[derive(Debug, Clone)]
pub struct AdminEintrag<'a> {
    pub aktion: AdminAktion,
    pub akteur: &'a Benutzer,
    pub ziel: Ziel<'a>,
    pub angaben: Option<ZugangsAngaben>,
    pub peer_ip: Option<IpAddr>,
}

/// Schreibt einen Eintrag der Admin-Spur, dazu eine `tracing`-Zeile im Request-Span. Aufrufer
/// rufen das NACH dem Commit ihrer Aktion: eine abgewiesene Aktion hinterlässt nichts.
///
/// **Schlägt bewusst nie nach außen durch** (wie `audit::schreibe`): eine Kontosperre im Vorfall
/// darf nicht an einer klemmenden Audit-Tabelle scheitern. Die Lücke bleibt durch den `error!`
/// sichtbar.
pub async fn schreibe(pool: &SqlitePool, eintrag: AdminEintrag<'_>) {
    let (ziel_benutzer_id, ziel) = match eintrag.ziel {
        Ziel::Benutzer { id, benutzername } => (
            Some(id),
            crate::auth::benutzername::fuer_protokoll(benutzername),
        ),
        Ziel::Anmeldeweg(id) => (None, crate::auth::benutzername::fuer_protokoll(id)),
    };
    let akteur_name = crate::auth::benutzername::fuer_protokoll(&eintrag.akteur.benutzername);
    let peer_ip = eintrag.peer_ip.map(|ip| ip.to_string());
    let detail = eintrag
        .angaben
        .as_ref()
        .map(|a| serde_json::to_string(a).expect("ZugangsAngaben sind serialisierbar"));

    tracing::info!(
        aktion = eintrag.aktion.as_str(),
        akteur_id = eintrag.akteur.id,
        akteur = %akteur_name,
        ziel_benutzer_id = ?ziel_benutzer_id,
        ziel = %ziel,
        detail = ?detail,
        peer_ip = ?peer_ip,
        "Zugang durch Admin geändert"
    );

    let ergebnis = sqlx::query(
        "INSERT INTO admin_audit (aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, peer_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(eintrag.aktion.as_str())
    .bind(eintrag.akteur.id)
    .bind(&akteur_name)
    .bind(ziel_benutzer_id)
    .bind(&ziel)
    .bind(detail.as_deref())
    .bind(peer_ip.as_deref())
    .execute(pool)
    .await;

    if let Err(e) = ergebnis {
        tracing::error!(
            aktion = eintrag.aktion.as_str(),
            "Admin-Audit konnte nicht geschrieben werden: {e}"
        );
    }
}

/// Eine Zeile der Admin-Spur, wie die Verwaltung sie liest (LFH-1097).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ZugangsaenderungAnzeige {
    pub id: i64,
    /// UTC im SQLite-Format `YYYY-MM-DD HH:MM:SS`.
    pub zeitpunkt: String,
    #[schema(value_type = AdminAktion)]
    pub aktion: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub akteur_id: Option<i64>,
    /// Benutzername der handelnden Person zum Zeitpunkt der Aktion, gekürzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub akteur_name: Option<String>,
    /// Gesetzt, wenn das Ziel ein Konto ist; fehlt beim Anmeldeweg.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ziel_benutzer_id: Option<i64>,
    /// Benutzername des Zielkontos oder id des Anmeldewegs.
    pub ziel: String,
    /// Freier Text, nur noch bei Einträgen von vor LFH-1152; neuere tragen `angaben`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(skip)]
    pub angaben: Option<ZugangsAngaben>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer_ip: Option<String>,
}

/// Liest die Admin-Spur, neueste zuerst. `konto` trifft die handelnde Person UND das Zielkonto
/// („was hat dieses Konto getan oder erlitten“), nie einen Anmeldeweg gleichen Namens.
pub async fn liste(
    pool: &SqlitePool,
    filter: &SpurFilter,
    aktion: Option<AdminAktion>,
) -> Result<Vec<ZugangsaenderungAnzeige>, sqlx::Error> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT id, zeitpunkt, aktion, akteur_id, akteur_name, ziel_benutzer_id, ziel, detail, \
                peer_ip \
         FROM admin_audit WHERE 1 = 1",
    );
    if let Some(aktion) = aktion {
        qb.push(" AND aktion = ");
        qb.push_bind(aktion.as_str());
    }
    if let Some(konto) = &filter.konto {
        qb.push(" AND (");
        SpurFilter::konto_enthalten(&mut qb, "akteur_name", konto);
        qb.push(" OR (ziel_benutzer_id IS NOT NULL AND ");
        SpurFilter::konto_enthalten(&mut qb, "ziel", konto);
        qb.push("))");
    }
    filter.zeitraum_und_cursor(&mut qb);
    filter.ordnung_und_seite(&mut qb);
    let mut zeilen: Vec<ZugangsaenderungAnzeige> = qb.build_query_as().fetch_all(pool).await?;
    for zeile in &mut zeilen {
        if let Some(angaben) = zeile.detail.as_deref().and_then(ZugangsAngaben::aus_detail) {
            zeile.angaben = Some(angaben);
            zeile.detail = None;
        }
    }
    Ok(zeilen)
}

/// Löscht Einträge, deren Aufbewahrungsfrist abgelaufen ist. Liefert die Anzahl. Idempotent.
pub async fn purge_abgelaufene(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let ergebnis =
        sqlx::query("DELETE FROM admin_audit WHERE zeitpunkt < datetime('now', ? || ' days')")
            .bind(format!("-{AUFBEWAHRUNG_TAGE}"))
            .execute(pool)
            .await?;
    Ok(ergebnis.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    async fn admin(pool: &SqlitePool) -> Benutzer {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'Admin', 'admin', 'h', 'admin')",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_as(
            "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
             FROM benutzer WHERE benutzername = 'admin'",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Jede Variante passiert den DB-CHECK. Ein Tippfehler in `as_str()` oder ein neuer Wert ohne
    /// Migrations-Nachzug fiele sonst erst im Betrieb auf, als stiller Verlust der Spur.
    #[tokio::test]
    async fn jede_aktion_passiert_den_db_check() {
        let pool = db::test_pool().await;
        let akteur = admin(&pool).await;

        for aktion in AdminAktion::ALLE {
            schreibe(
                &pool,
                AdminEintrag {
                    aktion,
                    akteur: &akteur,
                    ziel: Ziel::Anmeldeweg("oidc"),
                    angaben: None,
                    peer_ip: None,
                },
            )
            .await;
        }

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            anzahl,
            AdminAktion::ALLE.len() as i64,
            "jede AdminAktion muss den CHECK aus migrations/0156 passieren"
        );
    }

    #[tokio::test]
    async fn ziel_benutzer_traegt_id_und_gekuerzten_namen() {
        let pool = db::test_pool().await;
        let akteur = admin(&pool).await;
        let lang = "x".repeat(100);

        schreibe(
            &pool,
            AdminEintrag {
                aktion: AdminAktion::ZweitfaktorZurueckgesetzt,
                akteur: &akteur,
                ziel: Ziel::Benutzer {
                    id: akteur.id,
                    benutzername: &lang,
                },
                angaben: None,
                peer_ip: Some("203.0.113.5".parse().unwrap()),
            },
        )
        .await;

        let zeile: (
            Option<i64>,
            Option<String>,
            Option<i64>,
            String,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT akteur_id, akteur_name, ziel_benutzer_id, ziel, peer_ip FROM admin_audit",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeile,
            (
                Some(akteur.id),
                Some("admin".to_string()),
                Some(akteur.id),
                format!("{}…", "x".repeat(64)),
                Some("203.0.113.5".to_string()),
            )
        );
    }

    /// LFH-1152: Angaben gehen als JSON in die Tabelle und kommen strukturiert zurück; ein Text
    /// von vorher bleibt Text, auch einer, der wie JSON aussieht, aber keine Angaben trägt.
    #[tokio::test]
    async fn angaben_kommen_strukturiert_zurueck_alter_text_bleibt() {
        let pool = db::test_pool().await;
        let akteur = admin(&pool).await;
        let angaben = ZugangsAngaben {
            org_rolle_vorher: Some(OrgRolle::Keine),
            org_rolle: Some(OrgRolle::Fuehrungskraft),
            ..ZugangsAngaben::default()
        };
        schreibe(
            &pool,
            AdminEintrag {
                aktion: AdminAktion::RolleGeaendert,
                akteur: &akteur,
                ziel: Ziel::Benutzer {
                    id: akteur.id,
                    benutzername: "admin",
                },
                angaben: Some(angaben.clone()),
                peer_ip: None,
            },
        )
        .await;
        let gespeichert: String = sqlx::query_scalar("SELECT detail FROM admin_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            gespeichert,
            r#"{"org_rolle_vorher":"keine","org_rolle":"fuehrungskraft"}"#
        );
        for alt in [
            "org_rolle: keine → fuehrungskraft",
            "{}",
            r#"{"org_rolle":"chef"}"#,
            "{kaputt",
        ] {
            sqlx::query(
                "INSERT INTO admin_audit (aktion, akteur_name, ziel, detail)                  VALUES ('rolle_geaendert', 'admin', 'admin', ?)",
            )
            .bind(alt)
            .execute(&pool)
            .await
            .unwrap();
        }

        let filter = SpurFilter {
            limit: 10,
            ..SpurFilter::default()
        };
        let zeilen = liste(&pool, &filter, None).await.unwrap();
        let gelesen: Vec<(Option<&str>, Option<&ZugangsAngaben>)> = zeilen
            .iter()
            .map(|z| (z.detail.as_deref(), z.angaben.as_ref()))
            .collect();
        assert_eq!(
            gelesen,
            vec![
                (Some("{kaputt"), None),
                (Some(r#"{"org_rolle":"chef"}"#), None),
                (Some("{}"), None),
                (Some("org_rolle: keine → fuehrungskraft"), None),
                (None, Some(&angaben)),
            ]
        );
    }

    /// Anlage und beendete Sitzung kommen ebenso strukturiert zurück (LFH-1152).
    #[tokio::test]
    async fn angaben_von_anlage_und_sitzung_kommen_zurueck() {
        let pool = db::test_pool().await;
        let akteur = admin(&pool).await;
        let anlage = ZugangsAngaben {
            system_rolle: Some(SystemRolle::Keiner),
            org_rolle: Some(OrgRolle::Keine),
            ..ZugangsAngaben::default()
        };
        let sitzung = ZugangsAngaben {
            geraet: Some("Safari · iPadOS".to_string()),
            angemeldet_at: Some("2026-10-10 12:13:34".to_string()),
            ..ZugangsAngaben::default()
        };
        for (aktion, angaben) in [
            (AdminAktion::BenutzerAngelegt, &anlage),
            (AdminAktion::SitzungBeendet, &sitzung),
        ] {
            schreibe(
                &pool,
                AdminEintrag {
                    aktion,
                    akteur: &akteur,
                    ziel: Ziel::Benutzer {
                        id: akteur.id,
                        benutzername: "admin",
                    },
                    angaben: Some(angaben.clone()),
                    peer_ip: None,
                },
            )
            .await;
        }

        let filter = SpurFilter {
            limit: 10,
            ..SpurFilter::default()
        };
        let zeilen = liste(&pool, &filter, None).await.unwrap();
        let gelesen: Vec<(&str, Option<&str>, Option<&ZugangsAngaben>)> = zeilen
            .iter()
            .map(|z| (z.aktion.as_str(), z.detail.as_deref(), z.angaben.as_ref()))
            .collect();
        assert_eq!(
            gelesen,
            vec![
                ("sitzung_beendet", None, Some(&sitzung)),
                ("benutzer_angelegt", None, Some(&anlage)),
            ]
        );
    }

    #[tokio::test]
    async fn purge_loescht_nur_abgelaufene() {
        let pool = db::test_pool().await;

        // Knapp innerhalb der Frist (bleibt) und knapp darüber (fliegt).
        sqlx::query(
            "INSERT INTO admin_audit (zeitpunkt, aktion, ziel) VALUES
             (datetime('now', '-364 days'), 'anmeldeweg_aktiviert', 'oidc'),
             (datetime('now', '-366 days'), 'anmeldeweg_deaktiviert', 'oidc')",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(purge_abgelaufene(&pool).await.unwrap(), 1);
        let rest: String = sqlx::query_scalar("SELECT aktion FROM admin_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, "anmeldeweg_aktiviert");

        // Idempotenz: ein zweiter Lauf findet nichts mehr.
        assert_eq!(purge_abgelaufene(&pool).await.unwrap(), 0);
    }
}

//! Auth-Audit-Spur (LFH-249/F30): wer sich wann angemeldet hat — und wer es vergeblich
//! versucht hat.
//!
//! Vorher hinterließen Login und Logout keinerlei Spur: ein fehlgeschlagener
//! Anmeldeversuch war nach Abschluss des Requests nicht mehr nachweisbar, Brute-Force
//! gegen das ELW-Login damit unsichtbar. Für ein Führungssystem im Behördenbetrieb ist
//! das eine Frage, die beantwortbar sein muss.
//!
//! **Warum eine Tabelle und nicht nur `tracing`:** nur so ist die Spur revisionssicher,
//! im Backup enthalten und über die API auswertbar — der Unterschied zwischen einer
//! Debugging-Hilfe und einem Zugriffsnachweis. Zusätzlich geht jedes Ereignis in den
//! `tracing`-Log, wo es im Request-Span (Methode, Pfad, Request-ID) landet.
//!
//! **Personenbezug:** Benutzername und IP sind personenbezogene Daten. Anders als die
//! Einsatzdaten hängen sie an keiner Einsatz-Aufbewahrungsfrist, brauchen also eine
//! eigene — [`AUFBEWAHRUNG_TAGE`], durchgesetzt von [`purge_abgelaufene`] im
//! Purge-Scheduler.

use sqlx::SqlitePool;

/// Aufbewahrungsfrist der Audit-Spur in Tagen.
///
/// Abwägung: lang genug, um einen Vorfall rückwirkend zu untersuchen (ein Angriff fällt
/// selten am selben Tag auf), kurz genug, dass keine unbegrenzte Sammlung
/// personenbezogener Anmeldedaten entsteht.
pub const AUFBEWAHRUNG_TAGE: i64 = 90;

/// Protokolliertes Anmelde-Ereignis. Die Wire-Werte stehen als CHECK in
/// `migrations/0091_auth_audit.sql` — beide Seiten müssen zusammenpassen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ereignis {
    LoginOk,
    LoginFehlgeschlagen,
    Logout,
}

impl Ereignis {
    pub fn as_str(&self) -> &'static str {
        match self {
            Ereignis::LoginOk => "login_ok",
            Ereignis::LoginFehlgeschlagen => "login_fehlgeschlagen",
            Ereignis::Logout => "logout",
        }
    }
}

/// Ein Audit-Ereignis. `benutzer_id` ist nur bei Erfolg bekannt; `benutzername` trägt bei
/// einem Fehlschlag den VERSUCHTEN Namen (der womöglich gar nicht existiert — genau das
/// ist die interessante Information einer Brute-Force-Spur).
#[derive(Debug, Clone)]
pub struct AuditEintrag<'a> {
    pub ereignis: Ereignis,
    pub benutzername: Option<&'a str>,
    pub benutzer_id: Option<i64>,
    pub peer_ip: Option<String>,
    pub provider: &'a str,
}

/// Schreibt ein Audit-Ereignis.
///
/// **Schlägt bewusst nie nach außen durch.** Ein Schreibfehler wird laut geloggt, aber
/// nicht propagiert: einen Einsatzkräfte-Login zu verweigern, weil die Audit-Tabelle
/// klemmt, wäre im Feld der schlechtere Ausgang als eine Lücke in der Spur. Die Lücke
/// bleibt durch den `error!` sichtbar.
pub async fn schreibe(pool: &SqlitePool, eintrag: AuditEintrag<'_>) {
    let ergebnis = sqlx::query(
        "INSERT INTO auth_audit (ereignis, benutzername, benutzer_id, peer_ip, provider)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(eintrag.ereignis.as_str())
    .bind(eintrag.benutzername)
    .bind(eintrag.benutzer_id)
    .bind(eintrag.peer_ip.as_deref())
    .bind(eintrag.provider)
    .execute(pool)
    .await;

    if let Err(e) = ergebnis {
        tracing::error!(
            ereignis = eintrag.ereignis.as_str(),
            "Auth-Audit konnte nicht geschrieben werden: {e}"
        );
    }
}

/// Löscht Audit-Einträge, deren Aufbewahrungsfrist abgelaufen ist. Liefert die Anzahl.
/// Idempotent — ein zweiter Lauf ohne neue Fälligkeiten liefert 0.
pub async fn purge_abgelaufene(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let ergebnis =
        sqlx::query("DELETE FROM auth_audit WHERE zeitpunkt < datetime('now', ? || ' days')")
            .bind(format!("-{AUFBEWAHRUNG_TAGE}"))
            .execute(pool)
            .await?;
    Ok(ergebnis.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Beweist, dass jede Enum-Variante den DB-CHECK passiert. Ein Tippfehler in
    /// `as_str()` oder ein neuer Wert ohne Migrations-Nachzug fällt hier auf — sonst erst
    /// im Betrieb, und zwar als stiller Verlust genau der Ereignisse, die man braucht.
    #[tokio::test]
    async fn jede_variante_passiert_den_db_check() {
        let pool = db::test_pool().await;

        for ereignis in [
            Ereignis::LoginOk,
            Ereignis::LoginFehlgeschlagen,
            Ereignis::Logout,
        ] {
            schreibe(
                &pool,
                AuditEintrag {
                    ereignis,
                    benutzername: Some("tester"),
                    benutzer_id: None,
                    peer_ip: Some("127.0.0.1".to_string()),
                    provider: "passwort",
                },
            )
            .await;
        }

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            anzahl, 3,
            "jede Ereignis-Variante muss den CHECK in migrations/0091 passieren"
        );
    }

    #[tokio::test]
    async fn purge_loescht_nur_abgelaufene() {
        let pool = db::test_pool().await;

        // Frisch (bleibt) und deutlich zu alt (fliegt).
        sqlx::query(
            "INSERT INTO auth_audit (zeitpunkt, ereignis, provider) VALUES
             (datetime('now'), 'login_ok', 'passwort'),
             (datetime('now', '-200 days'), 'login_fehlgeschlagen', 'passwort')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let geloescht = purge_abgelaufene(&pool).await.unwrap();
        assert_eq!(
            geloescht, 1,
            "nur der abgelaufene Eintrag darf gelöscht werden"
        );

        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth_audit")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 1);

        // Idempotenz: ein zweiter Lauf findet nichts mehr.
        assert_eq!(purge_abgelaufene(&pool).await.unwrap(), 0);
    }
}

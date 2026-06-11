use super::{ErinnerungAnzeige, STATUS_ERLEDIGT, STATUS_OFFEN, STATUS_QUITTIERT};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Eingabedaten für eine neue (manuelle) Erinnerung — bereits vom Handler validiert.
#[derive(Debug)]
pub struct ErinnerungDaten<'a> {
    pub titel: &'a str,
    pub beschreibung: Option<&'a str>,
    /// 'YYYY-MM-DD HH:MM:SS' (UTC).
    pub faellig_at: &'a str,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<&'a str>,
}

/// SELECT-Projektion inkl. abgeleitetem `ist_faellig`. `jetzt` wird als erster
/// positionaler `?`-Parameter gebunden (steht textuell vor der WHERE-Klausel),
/// danach die WHERE-Parameter — wie im `chat`-Repo durchgehend `?` (keine
/// numbered binds, deren sqlx-SQLite-Verhalten hier unnötig riskant wäre).
const ANZEIGE_SELECT: &str =
    "SELECT id, einsatz_id, titel, beschreibung, faellig_at, intervall_minuten, \
            empfaenger_funktion, bezug_typ, bezug_id, quelle, status, erledigt_at, \
            erstellt_von_id, erstellt_at, \
            (faellig_at <= ?) AS ist_faellig \
     FROM erinnerung";

/// Lädt eine Erinnerung als Anzeige. `NotFound`, wenn sie nicht existiert.
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `id` (WHERE).
pub async fn laden(pool: &SqlitePool, id: i64, jetzt: &str) -> Result<ErinnerungAnzeige, AppError> {
    sqlx::query_as::<_, ErinnerungAnzeige>(&format!("{ANZEIGE_SELECT} WHERE id = ?"))
        .bind(jetzt)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Listet Erinnerungen eines Einsatzes. `nur_offen` filtert auf `status='offen'`.
/// Sortierung: nach Fälligkeit aufsteigend (älteste/überfälligste zuerst).
/// Bind-Reihenfolge: zuerst `jetzt` (computed column), dann `einsatz_id` (WHERE).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    nur_offen: bool,
    jetzt: &str,
) -> Result<Vec<ErinnerungAnzeige>, AppError> {
    let sql = if nur_offen {
        format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? AND status = '{STATUS_OFFEN}' ORDER BY faellig_at, id")
    } else {
        format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? ORDER BY faellig_at, id")
    };
    sqlx::query_as::<_, ErinnerungAnzeige>(&sql)
        .bind(jetzt)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Legt eine manuelle Erinnerung an und liefert sie als Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: ErinnerungDaten<'_>,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO erinnerung \
           (einsatz_id, titel, beschreibung, faellig_at, intervall_minuten, \
            empfaenger_funktion, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.titel)
    .bind(daten.beschreibung)
    .bind(daten.faellig_at)
    .bind(daten.intervall_minuten)
    .bind(daten.empfaenger_funktion)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, id, jetzt).await
}

/// Prüft, ob eine Erinnerung zum Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_zu_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM erinnerung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Setzt den Status (erledigt/quittiert) und `erledigt_at = jetzt`.
/// Nur erlaubte Zielstatus; sonst `Validation`.
pub async fn status_setzen(
    pool: &SqlitePool,
    id: i64,
    neuer_status: &str,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    if neuer_status != STATUS_ERLEDIGT && neuer_status != STATUS_QUITTIERT {
        return Err(AppError::Validation("Ungültiger Zielstatus".into()));
    }
    sqlx::query("UPDATE erinnerung SET status = ?, erledigt_at = ? WHERE id = ?")
        .bind(neuer_status)
        .bind(jetzt)
        .bind(id)
        .execute(pool)
        .await?;
    laden(pool, id, jetzt).await
}

/// Eine fällige, offene Erinnerung, die ein Scheduler-Nudge braucht.
/// `intervall_minuten` entscheidet einmalig vs. wiederkehrend in `tick_einmal`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FaelligeErinnerung {
    pub id: i64,
    pub einsatz_id: i64,
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
}

/// Liefert offene Erinnerungen, die fällig sind (`faellig_at <= jetzt`) und für
/// ihren aktuellen `faellig_at`-Slot noch nicht benachrichtigt wurden
/// (`zuletzt_ausgeloest_at IS NULL OR zuletzt_ausgeloest_at < faellig_at`).
/// Einsatzübergreifend — der Scheduler läuft global.
pub async fn faellige_zum_ausloesen(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<Vec<FaelligeErinnerung>, AppError> {
    sqlx::query_as::<_, FaelligeErinnerung>(
        "SELECT id, einsatz_id, faellig_at, intervall_minuten \
         FROM erinnerung \
         WHERE status = 'offen' AND faellig_at <= ? \
           AND (zuletzt_ausgeloest_at IS NULL OR zuletzt_ausgeloest_at < faellig_at) \
         ORDER BY faellig_at, id",
    )
    .bind(jetzt)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Markiert eine Erinnerung als ausgelöst. Bei wiederkehrenden wird zugleich
/// `faellig_at` auf `neues_faellig_at` (skip-forward) gesetzt; bei einmaligen
/// bleibt `faellig_at` und nur `zuletzt_ausgeloest_at` wird gesetzt.
pub async fn markiere_ausgeloest(
    pool: &SqlitePool,
    id: i64,
    neues_faellig_at: Option<&str>,
    jetzt: &str,
) -> Result<(), AppError> {
    match neues_faellig_at {
        Some(neu) => {
            sqlx::query("UPDATE erinnerung SET faellig_at = ?, zuletzt_ausgeloest_at = ? WHERE id = ?")
                .bind(neu).bind(jetzt).bind(id).execute(pool).await?;
        }
        None => {
            sqlx::query("UPDATE erinnerung SET zuletzt_ausgeloest_at = ? WHERE id = ?")
                .bind(jetzt).bind(id).execute(pool).await?;
        }
    }
    Ok(())
}

/// Generischer Auto-Quelle-Hook: erzeugt eine Erinnerung/Nachfass aus einer
/// überschrittenen Frist eines beliebigen Bezugs (z. B. Auftrag, Meldung).
/// **Idempotent** je offenem Bezug — der partielle UNIQUE-Index verhindert
/// Dubletten; bei bereits vorhandener offener Auto-Erinnerung wird die
/// bestehende zurückgeliefert. Für späteres Wiring durch das Aufträge-Modul
/// (LFH-52); dort wird `bezug_typ='auftrag'` + Auftrags-ID übergeben.
pub async fn anlegen_aus_frist(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    bezug_typ: &str,
    bezug_id: i64,
    titel: &str,
    faellig_at: &str,
    jetzt: &str,
) -> Result<ErinnerungAnzeige, AppError> {
    // Idempotenz: existiert bereits eine offene Auto-Erinnerung für den Bezug?
    let vorhanden: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_typ = ? AND bezug_id = ?",
    )
    .bind(bezug_typ)
    .bind(bezug_id)
    .fetch_optional(pool)
    .await?;
    if let Some(id) = vorhanden {
        return laden(pool, id, jetzt).await;
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO erinnerung \
           (einsatz_id, titel, faellig_at, bezug_typ, bezug_id, quelle, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, 'auto_frist', ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(titel)
    .bind(faellig_at)
    .bind(bezug_typ)
    .bind(bezug_id)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, id, jetzt).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::erinnerung::{QUELLE_MANUELL, STATUS_OFFEN};

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an; liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        ).fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn daten<'a>(titel: &'a str, faellig: &'a str, intervall: Option<i64>) -> ErinnerungDaten<'a> {
        ErinnerungDaten { titel, beschreibung: None, faellig_at: faellig, intervall_minuten: intervall, empfaenger_funktion: None }
    }

    #[tokio::test]
    async fn anlegen_setzt_defaults_und_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;

        let r = anlegen(&pool, e, b, daten("Lagemeldung", "2026-06-11 10:00:00", Some(30)), "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(r.titel, "Lagemeldung");
        assert_eq!(r.status, STATUS_OFFEN);
        assert_eq!(r.quelle, QUELLE_MANUELL);
        assert!(!r.ist_faellig, "9:00 < 10:00 → noch nicht fällig");

        let liste = liste(&pool, e, true, "2026-06-11 09:00:00").await.unwrap();
        assert_eq!(liste.len(), 1);
    }

    #[tokio::test]
    async fn ist_faellig_wird_aus_jetzt_abgeleitet() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();

        let spaeter = laden(&pool, r.id, "2026-06-11 10:30:00").await.unwrap();
        assert!(spaeter.ist_faellig, "10:30 >= 10:00 → fällig");
    }

    #[tokio::test]
    async fn status_setzen_entfernt_aus_offener_liste() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();

        let erledigt = status_setzen(&pool, r.id, STATUS_ERLEDIGT, "2026-06-11 11:00:00").await.unwrap();
        assert_eq!(erledigt.status, STATUS_ERLEDIGT);
        assert!(erledigt.erledigt_at.is_some());

        let offen = liste(&pool, e, true, "2026-06-11 11:00:00").await.unwrap();
        assert!(offen.is_empty(), "erledigte verschwinden aus der offenen Liste");
        let alle = liste(&pool, e, false, "2026-06-11 11:00:00").await.unwrap();
        assert_eq!(alle.len(), 1, "bleibt in der Gesamtliste");
    }

    #[tokio::test]
    async fn status_setzen_lehnt_ungueltigen_status_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();
        assert!(matches!(status_setzen(&pool, r.id, "offen", "2026-06-11 11:00:00").await.unwrap_err(), AppError::Validation(_)));
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let r = anlegen(&pool, e, b, daten("X", "2026-06-11 10:00:00", None), "2026-06-11 09:00:00").await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, r.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, r.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn auto_frist_ist_idempotent_pro_bezug() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;

        // Test-Double: „Auftrag 42 hat Quittungsfrist überschritten".
        let erst = anlegen_aus_frist(&pool, e, b, "auftrag", 42, "Nachfass: Auftrag 42 unquittiert", "2026-06-11 10:00:00", "2026-06-11 10:00:00").await.unwrap();
        assert_eq!(erst.quelle, crate::erinnerung::QUELLE_AUTO_FRIST);
        assert_eq!(erst.bezug_typ.as_deref(), Some("auftrag"));
        assert_eq!(erst.bezug_id, Some(42));

        // Zweiter Aufruf für denselben offenen Bezug → keine Dublette, gleiche ID.
        let zweit = anlegen_aus_frist(&pool, e, b, "auftrag", 42, "Nachfass: Auftrag 42 unquittiert", "2026-06-11 10:05:00", "2026-06-11 10:05:00").await.unwrap();
        assert_eq!(zweit.id, erst.id);

        let alle = liste(&pool, e, false, "2026-06-11 10:05:00").await.unwrap();
        assert_eq!(alle.len(), 1, "nur eine Auto-Erinnerung je Bezug");
    }
}

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// LFH-120: Schema-Anker für die `art`-Union. Wire = DB-CHECK
/// `art IN ('detail','export','druck','anhang')` (migrations/0141_person_zugriff_audit_anhang.sql,
/// zuvor 0132 und 0021).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ZugriffArt {
    Detail,
    Export,
    /// LFH-727: Abruf der Personen-Druckansicht (`GET …/personen/druck`), ohne Person.
    Druck,
    /// LFH-757: Abruf der Datei eines Personen-Anhangs (`GET …/personen/{pid}/anhaenge/{aid}/datei`),
    /// mit Person, ohne Bezug auf die Datei. Auch 304 und Original schreiben eine Zeile.
    Anhang,
}

/// Ein Audit-Eintrag mit aufgelöstem Benutzernamen (für die Audit-Einsicht).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ZugriffAnzeige {
    pub id: i64,
    pub person_id: Option<i64>,
    pub benutzer_id: i64,
    pub benutzer_name: String,
    #[schema(value_type = ZugriffArt)]
    pub art: String,
    pub zugriff_at: String,
}

/// Schreibt einen append-only Audit-Eintrag. `person_id = None` beim Export oder Druck der
/// gesamten Liste. `art` ist 'detail', 'export', 'druck' oder 'anhang'.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: Option<i64>,
    benutzer_id: i64,
    art: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(benutzer_id)
    .bind(art)
    .execute(pool)
    .await?;
    Ok(())
}

/// Audit-Einträge einer Person (neueste zuerst), mit Benutzername — samt den Listenzugriffen
/// (Export, Druck) aus ihrem Erfassungsfenster: nach `erfasst_at`, nicht nach `storniert_at`
/// (LFH-916, design.md D3). Beide Grenzen schließen die gleiche Sekunde ein: eher ein Eintrag
/// zu viel als einer zu wenig. Beide Spalten tragen dasselbe `strftime`-Format wie `zugriff_at`,
/// der Textvergleich ist also ein Zeitvergleich.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<ZugriffAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, ZugriffAnzeige>(
        "SELECT a.id, a.person_id, a.benutzer_id, b.anzeigename AS benutzer_name, \
                a.art, a.zugriff_at \
         FROM person_zugriff_audit a JOIN benutzer b ON b.id = a.benutzer_id \
         WHERE a.einsatz_id = ?1 \
           AND (a.person_id = ?2 \
                OR (a.person_id IS NULL AND EXISTS ( \
                     SELECT 1 FROM einsatz_person p \
                     WHERE p.id = ?2 AND p.einsatz_id = ?1 \
                       AND a.zugriff_at >= p.erfasst_at \
                       AND (p.storniert_at IS NULL OR a.zugriff_at <= p.storniert_at)))) \
         ORDER BY a.zugriff_at DESC, a.id DESC",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_all(pool)
    .await?)
}

/// LFH-916: Zugriffe auf die ganze Personenliste eines Einsatzes (Export, Druck), neueste zuerst.
/// „Listenweit“ heißt `person_id IS NULL` — genau dafür ist die Spalte leer (design.md D1).
pub async fn liste_listenweit(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<ZugriffAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, ZugriffAnzeige>(
        "SELECT a.id, a.person_id, a.benutzer_id, b.anzeigename AS benutzer_name, \
                a.art, a.zugriff_at \
         FROM person_zugriff_audit a JOIN benutzer b ON b.id = a.benutzer_id \
         WHERE a.einsatz_id = ? AND a.person_id IS NULL \
         ORDER BY a.zugriff_at DESC, a.id DESC",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let person_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(benutzer_id)
        .fetch_one(pool)
        .await
        .unwrap();
        (benutzer_id, einsatz_id, person_id)
    }

    #[tokio::test]
    async fn anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        anlegen(&pool, e, Some(p), b, "detail").await.unwrap();
        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(eintraege.len(), 2);
        assert_eq!(eintraege[0].art, "detail");
        assert_eq!(eintraege[0].benutzer_name, "A");
    }

    #[tokio::test]
    async fn export_eintrag_ohne_person() {
        let pool = test_pool().await;
        let (b, e, _p) = setup(&pool).await;
        anlegen(&pool, e, None, b, "export").await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ? AND art = 'export'",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    /// LFH-727: der Personendruck schreibt `druck` ohne Person (wie der Export der Liste).
    #[tokio::test]
    async fn druck_eintrag_ohne_person() {
        let pool = test_pool().await;
        let (b, e, _p) = setup(&pool).await;
        anlegen(&pool, e, None, b, "druck").await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM person_zugriff_audit \
             WHERE einsatz_id = ? AND art = 'druck' AND person_id IS NULL",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    /// Protokollzeile mit festem Zeitpunkt (die Fensterregel vergleicht Sekunden).
    async fn zeile(pool: &SqlitePool, e: i64, p: Option<i64>, b: i64, art: &str, at: &str) {
        sqlx::query(
            "INSERT INTO person_zugriff_audit (einsatz_id, person_id, benutzer_id, art, zugriff_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(e)
        .bind(p)
        .bind(b)
        .bind(art)
        .bind(at)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn setze_person(pool: &SqlitePool, p: i64, erfasst: &str, storniert: Option<&str>) {
        sqlx::query("UPDATE einsatz_person SET erfasst_at = ?, storniert_at = ? WHERE id = ?")
            .bind(erfasst)
            .bind(storniert)
            .bind(p)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn zweiter_einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Andere Lage', 'aktiv', '2026-05-27') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn arten_und_zeiten(eintraege: &[ZugriffAnzeige]) -> Vec<(&str, &str)> {
        eintraege
            .iter()
            .map(|z| (z.art.as_str(), z.zugriff_at.as_str()))
            .collect()
    }

    /// LFH-916 (Spec `personen-zugriffsprotokoll`): nur Zeilen ohne Person dieses Einsatzes, die
    /// neuesten zuerst, mit Benutzername.
    #[tokio::test]
    async fn liste_listenweit_nur_listenzeilen_des_einsatzes() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let anderer = zweiter_einsatz(&pool).await;
        zeile(&pool, e, None, b, "export", "2026-05-27 10:00:00").await;
        zeile(&pool, e, None, b, "druck", "2026-05-27 10:05:00").await;
        zeile(&pool, e, Some(p), b, "detail", "2026-05-27 10:10:00").await;
        zeile(&pool, e, Some(p), b, "anhang", "2026-05-27 10:11:00").await;
        zeile(&pool, anderer, None, b, "export", "2026-05-27 10:20:00").await;

        let eintraege = liste_listenweit(&pool, e).await.unwrap();
        assert_eq!(
            arten_und_zeiten(&eintraege),
            vec![
                ("druck", "2026-05-27 10:05:00"),
                ("export", "2026-05-27 10:00:00")
            ]
        );
        assert!(eintraege.iter().all(|z| z.person_id.is_none()));
        assert_eq!(eintraege[0].benutzer_name, "A");
    }

    /// Gleicher Zeitpunkt: die spätere Zeile (höhere id) zuerst, wie in der Einsicht je Person.
    #[tokio::test]
    async fn liste_listenweit_gleiche_sekunde_nach_id() {
        let pool = test_pool().await;
        let (b, e, _p) = setup(&pool).await;
        zeile(&pool, e, None, b, "export", "2026-05-27 10:00:00").await;
        zeile(&pool, e, None, b, "druck", "2026-05-27 10:00:00").await;
        let eintraege = liste_listenweit(&pool, e).await.unwrap();
        assert_eq!(eintraege[0].art, "druck");
        assert!(eintraege[0].id > eintraege[1].id);
    }

    #[tokio::test]
    async fn liste_listenweit_leer_ohne_export_und_druck() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        zeile(&pool, e, Some(p), b, "detail", "2026-05-27 10:10:00").await;
        assert!(liste_listenweit(&pool, e).await.unwrap().is_empty());
    }

    /// LFH-916 (design.md D3): Die Einsicht je Person zeigt die Listenzugriffe aus ihrem
    /// Erfassungsfenster — nach der Erfassung, nicht nach der Stornierung, gleiche Sekunde drin.
    #[tokio::test]
    async fn liste_je_person_zeigt_listenzugriffe_im_erfassungsfenster() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let anderer = zweiter_einsatz(&pool).await;
        setze_person(&pool, p, "2026-05-27 09:00:00", Some("2026-05-27 11:00:00")).await;
        zeile(&pool, e, None, b, "druck", "2026-05-27 08:00:00").await; // vor der Erfassung
        zeile(&pool, e, None, b, "export", "2026-05-27 09:00:00").await; // gleiche Sekunde
        zeile(&pool, e, Some(p), b, "detail", "2026-05-27 09:30:00").await;
        zeile(&pool, e, None, b, "export", "2026-05-27 10:00:00").await; // im Fenster
        zeile(&pool, anderer, None, b, "export", "2026-05-27 10:00:00").await; // fremd
        zeile(&pool, e, None, b, "druck", "2026-05-27 11:00:00").await; // gleiche Sekunde
        zeile(&pool, e, None, b, "export", "2026-05-27 11:00:01").await; // nach Storno

        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(
            arten_und_zeiten(&eintraege),
            vec![
                ("druck", "2026-05-27 11:00:00"),
                ("export", "2026-05-27 10:00:00"),
                ("detail", "2026-05-27 09:30:00"),
                ("export", "2026-05-27 09:00:00"),
            ]
        );
    }

    /// Ohne Stornierung ist das Fenster nach oben offen.
    #[tokio::test]
    async fn liste_je_person_ohne_storno_bis_heute() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        setze_person(&pool, p, "2026-05-27 09:00:00", None).await;
        zeile(&pool, e, None, b, "export", "2026-09-01 12:00:00").await;
        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(
            arten_und_zeiten(&eintraege),
            vec![("export", "2026-09-01 12:00:00")]
        );
    }

    /// Die Listenzeilen einer Person zeigen nur ihre eigenen Personenzeilen, nicht die einer
    /// anderen Person desselben Einsatzes.
    #[tokio::test]
    async fn liste_je_person_ohne_zeilen_anderer_personen() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let andere: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 2, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(&pool)
        .await
        .unwrap();
        zeile(&pool, e, Some(andere), b, "detail", "2099-01-01 00:00:00").await;
        assert!(liste_je_person(&pool, e, p).await.unwrap().is_empty());
    }

    /// LFH-757: ein Datei-Download schreibt `anhang` MIT Person; die Einsicht je Person zeigt ihn.
    #[tokio::test]
    async fn anhang_eintrag_mit_person() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        anlegen(&pool, e, Some(p), b, "anhang").await.unwrap();
        let eintraege = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(eintraege.len(), 1);
        assert_eq!(eintraege[0].art, "anhang");
        assert_eq!(eintraege[0].person_id, Some(p));
    }
}

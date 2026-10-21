use crate::error::AppError;
use sqlx::SqlitePool;

use super::{adressat_kategorie_gueltig, prioritaet_gueltig, NachforderungAnzeige};

/// Validierte Eingabe für eine neue Nachforderung (Handler hat getrimmt/normalisiert).
#[derive(Debug)]
pub struct NachforderungDaten<'a> {
    pub art: &'a str,
    pub bezeichnung: &'a str,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: &'a str,
    pub adressat_bezeichnung: Option<&'a str>,
    pub begruendung: Option<&'a str>,
    pub prioritaet: &'a str,
    pub angefordert_at: &'a str,
    /// Betreuungsstelle, für die angefordert wird (LLH-1082); Einsatz und Lebenszyklus hat die
    /// Route geprüft.
    pub betreuungsstelle_id: Option<i64>,
}

/// SELECT-Projektion inkl. Ersteller-Name (LEFT JOIN benutzer), abgeleitetem `ist_offen` und den
/// übernommenen Materialposten (LLH-1226: nicht stornierte, also auch aus dem Einsatz genommene,
/// design.md D3). Reihenfolge der Spalten = Struct (FromRow positional). Keine
/// computed-time-Spalte → kein `jetzt`-Bind nötig.
const ANZEIGE_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.art, n.bezeichnung, n.anzahl, n.adressat_kategorie, \
            n.adressat_bezeichnung, n.begruendung, n.prioritaet, n.status, \
            n.zugesagt_at, n.unterwegs_at, n.eingetroffen_at, n.abgelehnt_at, n.abgelehnt_grund, \
            n.angefordert_at, n.etb_nachforderung_id, n.erstellt_von_id, n.erstellt_at, \
            b.anzeigename AS erstellt_von_name, \
            (n.status NOT IN ('eingetroffen', 'abgelehnt')) AS ist_offen, \
            (SELECT json_group_array(em.id ORDER BY em.id) FROM einsatz_material em \
             WHERE em.nachforderung_id = n.id AND em.beendet_als IS NOT 'storniert') \
              AS material_ids, \
            n.betreuungsstelle_id \
     FROM nachforderung n LEFT JOIN benutzer b ON b.id = n.erstellt_von_id";

/// Lädt eine Nachforderung als Anzeige. `NotFound`, wenn unbekannt.
pub async fn load(pool: &SqlitePool, id: i64) -> Result<NachforderungAnzeige, AppError> {
    sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE n.id = ?"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Nachforderung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung':
/// die Nachforderung ist eine ausgehende Anforderung; Pattern B mit beidseitigem Backlink).
/// Liefert die neue id. `daten` ist vom Handler validiert.
pub async fn create_tx(
    tx: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    ersteller_id: i64,
    etb_startwert: i64,
    daten: &NachforderungDaten<'_>,
) -> Result<i64, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    debug_assert!(adressat_kategorie_gueltig(daten.adressat_kategorie));

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO nachforderung \
           (einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, adressat_bezeichnung, \
            begruendung, prioritaet, angefordert_at, erstellt_von_id, betreuungsstelle_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.art)
    .bind(daten.bezeichnung)
    .bind(daten.anzahl)
    .bind(daten.adressat_kategorie)
    .bind(daten.adressat_bezeichnung)
    .bind(daten.begruendung)
    .bind(daten.prioritaet)
    .bind(daten.angefordert_at)
    .bind(ersteller_id)
    .bind(daten.betreuungsstelle_id)
    .fetch_one(&mut *tx)
    .await?;

    // ETB-Meldung (Pattern B): die Anforderung erscheint regulär im ETB.
    let menge = daten.anzahl.map(|a| format!("{a}× ")).unwrap_or_default();
    let inhalt = format!(
        "Nachforderung: {menge}{} — {}",
        daten.art, daten.bezeichnung
    );
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        ersteller_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: &inhalt,
            von: None,
            an: daten.adressat_bezeichnung,
            meldeweg: None,
            veranlassung: daten.begruendung,
            ereigniszeit: Some(daten.angefordert_at),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET nachforderung_id = ? WHERE id = ?")
        .bind(id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE nachforderung SET etb_nachforderung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    Ok(id)
}

/// Legt eine Nachforderung an (eigener Commit) und liefert die Anzeige.
pub async fn create(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: NachforderungDaten<'_>,
) -> Result<NachforderungAnzeige, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    let id = create_tx(&mut tx, einsatz_id, ersteller_id, etb_startwert, &daten).await?;
    tx.commit().await?;
    load(pool, id).await
}

/// Listet Nachforderungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), dann neueste Anforderung zuerst, dann id.
pub async fn list(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
) -> Result<Vec<NachforderungAnzeige>, AppError> {
    let mut q = format!("{ANZEIGE_SELECT} WHERE n.einsatz_id = ?");
    if status_filter.is_some() {
        q.push_str(" AND n.status = ?");
    }
    q.push_str(
        " ORDER BY CASE n.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          n.angefordert_at DESC, n.id DESC",
    );
    let mut query =
        sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(&*q)).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Cross-Einsatz-Schutz: gehört die Nachforderung zum Einsatz?
pub async fn belongs_to_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM nachforderung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Löst den Bezug aller Nachforderungen auf eine stornierte Betreuungsstelle (LLH-1082,
/// design.md D3), in der Transaktion des Stornos. Die Nachforderungen bleiben sonst unverändert.
/// Liefert die Kennungen der gelösten, damit der Aufrufer nach dem Commit das Live-Ereignis
/// sendet.
pub async fn loese_betreuungsstelle_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    betreuungsstelle_id: i64,
) -> Result<Vec<i64>, AppError> {
    sqlx::query_scalar(
        "UPDATE nachforderung SET betreuungsstelle_id = NULL \
         WHERE einsatz_id = ? AND betreuungsstelle_id = ? RETURNING id",
    )
    .bind(einsatz_id)
    .bind(betreuungsstelle_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(Into::into)
}

/// Trägt die Nachforderung mindestens einen übernommenen, nicht stornierten Materialposten
/// (LLH-1226, design.md D3)? Ein aus dem Einsatz genommener Posten war da und zählt.
pub async fn has_material<'e, E: sqlx::SqliteExecutor<'e>>(
    exec: E,
    id: i64,
) -> Result<bool, AppError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_material em \
         WHERE em.nachforderung_id = ? AND em.beendet_als IS NOT 'storniert')",
    )
    .bind(id)
    .fetch_one(exec)
    .await
    .map_err(Into::into)
}

/// Prüft in der Transaktion einer Übernahme (LLH-1226, design.md D2/D3), ob aus der
/// Nachforderung Material übernommen werden darf, und liefert ihre Bezeichnung für den
/// ETB-Text. `NotFound`, wenn sie nicht zum Einsatz gehört; `UnprocessableEntity`, wenn sie nicht
/// eingetroffen ist; `Conflict`, wenn sie schon einen zählenden Posten trägt und die Anfrage
/// nicht ausdrücklich ergänzt (die Bitte beruht dann auf einem veralteten Stand). Die Zeile der
/// Nachforderung bleibt unverändert.
pub async fn check_uebernahme_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    id: i64,
    ergaenzen: bool,
) -> Result<String, AppError> {
    let (status, bezeichnung): (String, String) = sqlx::query_as(
        "SELECT status, bezeichnung FROM nachforderung WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if status != super::STATUS_EINGETROFFEN {
        return Err(AppError::UnprocessableEntity(
            "Material wird erst nach dem Eintreffen übernommen".into(),
        ));
    }
    if !ergaenzen && has_material(&mut *conn, id).await? {
        return Err(AppError::Conflict(
            "Aus dieser Nachforderung ist schon Material übernommen".into(),
        ));
    }
    Ok(bezeichnung)
}

/// Stufe im linearen Bedarfsfluss und die Spalte mit ihrem Zeitpunkt; `angefordert` trägt
/// seinen Zeitpunkt in `angefordert_at` ab dem Anlegen, ohne Stempel beim Übergang.
fn stufe(status: &str) -> Option<(u8, Option<&'static str>)> {
    match status {
        super::STATUS_ANGEFORDERT => Some((0, None)),
        super::STATUS_ZUGESAGT => Some((1, Some("zugesagt_at"))),
        super::STATUS_UNTERWEGS => Some((2, Some("unterwegs_at"))),
        super::STATUS_EINGETROFFEN => Some((3, Some("eingetroffen_at"))),
        _ => None,
    }
}

/// Schaltet den Bedarfs-Status um genau eine Stufe weiter oder nimmt ihn um genau eine zurück
/// (LFH-343 · C8). Vorwärts setzt den Zeitstempel der neuen Stufe (first-write-wins via
/// COALESCE); die Rücknahme leert den der verlassenen Stufe (LLH-1247), damit die nächste
/// Meldung ihren eigenen Zeitpunkt trägt und keine Karte einen zurückgenommenen zeigt.
/// `erwartet` ist der vom Handler geprüfte Bestandsstatus: das UPDATE greift NUR, wenn er
/// unverändert ist (optimistische Sperre gegen TOCTOU). Liefert `true`, wenn eine Zeile geändert
/// wurde; `false` = Status zwischenzeitlich geändert. `abgelehnt` läuft über [`lehne_ab`]. Die
/// Rücknahme aus `eingetroffen` greift zusätzlich nur ohne zählenden Materialposten (LLH-1226,
/// design.md D9), damit eine gleichzeitige Übernahme keine zurückgenommene Nachforderung mit
/// Posten hinterlässt; die verständliche 422 prüft der Handler vorher über [`has_material`].
pub async fn update_status(
    pool: &SqlitePool,
    id: i64,
    neuer_status: &str,
    erwartet: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let ungueltig = || AppError::Validation("Ungültiger Zielstatus".into());
    let (neu_stufe, neu_spalte) = stufe(neuer_status).ok_or_else(ungueltig)?;
    let (alt_stufe, alt_spalte) = stufe(erwartet).ok_or_else(ungueltig)?;
    let (stempel, vorwaerts) = match (neu_stufe, neu_spalte, alt_spalte) {
        (n, Some(spalte), _) if n == alt_stufe + 1 => {
            (format!("{spalte} = COALESCE({spalte}, ?)"), true)
        }
        (n, _, Some(spalte)) if n + 1 == alt_stufe => (format!("{spalte} = NULL"), false),
        _ => return Err(ungueltig()),
    };
    let ohne_posten = if erwartet == super::STATUS_EINGETROFFEN {
        " AND NOT EXISTS (SELECT 1 FROM einsatz_material em \
           WHERE em.nachforderung_id = nachforderung.id AND em.beendet_als IS NOT 'storniert')"
    } else {
        ""
    };
    let sql = format!(
        "UPDATE nachforderung SET status = ?, {stempel} WHERE id = ? AND status = ?{ohne_posten}"
    );
    let query = sqlx::query(sqlx::AssertSqlSafe(&*sql)).bind(neuer_status);
    let query = if vorwaerts { query.bind(jetzt) } else { query };
    let r = query.bind(id).bind(erwartet).execute(pool).await?;
    Ok(r.rows_affected() > 0)
}

/// Lehnt eine Nachforderung ab (Abzweig): setzt status='abgelehnt', Zeitstempel und Grund —
/// nur wenn der Bestandsstatus `erwartet` unverändert ist (optimistische Sperre). Liefert
/// `true` bei erfolgter Änderung.
pub async fn lehne_ab(
    pool: &SqlitePool,
    id: i64,
    grund: Option<&str>,
    erwartet: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let r = sqlx::query(
        "UPDATE nachforderung SET status = ?, abgelehnt_at = COALESCE(abgelehnt_at, ?), \
         abgelehnt_grund = COALESCE(abgelehnt_grund, ?) WHERE id = ? AND status = ?",
    )
    .bind(super::STATUS_ABGELEHNT)
    .bind(jetzt)
    .bind(grund)
    .bind(id)
    .bind(erwartet)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::AdressatKategorie;
    use crate::nachforderung::{
        NachforderungStatus, ADRESSAT_LEITSTELLE, PRIO_NORMAL, STATUS_ANGEFORDERT,
        STATUS_EINGETROFFEN, STATUS_UNTERWEGS, STATUS_ZUGESAGT,
    };

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'Leit','leit','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn daten<'a>(art: &'a str, bez: &'a str) -> NachforderungDaten<'a> {
        NachforderungDaten {
            art,
            bezeichnung: bez,
            anzahl: Some(2),
            adressat_kategorie: ADRESSAT_LEITSTELLE,
            adressat_bezeichnung: Some("Leitstelle Nord"),
            begruendung: None,
            prioritaet: PRIO_NORMAL,
            angefordert_at: "2026-06-12 09:00:00",
            betreuungsstelle_id: None,
        }
    }

    #[tokio::test]
    async fn anlegen_setzt_default_status_und_erzeugt_etb_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "2 RTW zur Verstärkung"))
            .await
            .unwrap();
        assert_eq!(n.status, NachforderungStatus::Angefordert);
        assert!(n.ist_offen);
        assert_eq!(n.anzahl, Some(2));
        assert_eq!(n.adressat_kategorie, AdressatKategorie::Leitstelle);
        assert_eq!(n.erstellt_von_name.as_deref(), Some("Leit"));
        let etb_id = n.etb_nachforderung_id.expect("ETB-Eintrag erzeugt");
        let (typ, backlink): (String, i64) =
            sqlx::query_as("SELECT typ, nachforderung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, n.id);
    }

    #[tokio::test]
    async fn liste_sortiert_nach_prio_und_filtert_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        create(&pool, e, b, daten("RTW", "normal")).await.unwrap();
        let sofort = NachforderungDaten {
            prioritaet: super::super::PRIO_SOFORT,
            ..daten("SEG", "sofort")
        };
        create(&pool, e, b, sofort).await.unwrap();
        let alle = list(&pool, e, None).await.unwrap();
        assert_eq!(alle.len(), 2);
        assert_eq!(alle[0].bezeichnung, "sofort", "sofort vor normal");
        let offen = list(&pool, e, Some("angefordert")).await.unwrap();
        assert_eq!(offen.len(), 2);
        assert!(list(&pool, e, Some("eingetroffen"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn setze_status_schaltet_weiter_und_haelt_zeitstempel() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(update_status(
            &pool,
            n.id,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00"
        )
        .await
        .unwrap());
        assert!(update_status(
            &pool,
            n.id,
            STATUS_UNTERWEGS,
            STATUS_ZUGESAGT,
            "2026-06-12 09:10:00"
        )
        .await
        .unwrap());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Unterwegs);
        assert_eq!(nach.zugesagt_at.as_deref(), Some("2026-06-12 09:05:00"));
        assert_eq!(nach.unterwegs_at.as_deref(), Some("2026-06-12 09:10:00"));
        assert!(nach.ist_offen);
        // eingetroffen → terminal, nicht mehr offen.
        assert!(update_status(
            &pool,
            n.id,
            STATUS_EINGETROFFEN,
            STATUS_UNTERWEGS,
            "2026-06-12 09:30:00"
        )
        .await
        .unwrap());
        assert!(!load(&pool, n.id).await.unwrap().ist_offen);
        // Optimistische Sperre: erneuter Übergang mit veraltetem `erwartet` greift nicht.
        assert!(!update_status(
            &pool,
            n.id,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:40:00"
        )
        .await
        .unwrap());
    }

    /// LLH-1247: Die Rücknahme um eine Stufe (LFH-343 · C8) greift auf jeder Stufe, auch zurück
    /// auf `angefordert`, und leert den Zeitpunkt der verlassenen Stufe. Sonst behielte das
    /// erneute Weiterschalten über das COALESCE den zurückgenommenen Zeitpunkt.
    #[tokio::test]
    async fn ruecknahme_leert_den_zeitpunkt_der_verlassenen_stufe() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        for (neu, alt, jetzt) in [
            (STATUS_ZUGESAGT, STATUS_ANGEFORDERT, "2026-06-12 09:05:00"),
            (STATUS_UNTERWEGS, STATUS_ZUGESAGT, "2026-06-12 09:10:00"),
            (STATUS_EINGETROFFEN, STATUS_UNTERWEGS, "2026-06-12 09:30:00"),
        ] {
            assert!(update_status(&pool, n.id, neu, alt, jetzt).await.unwrap());
        }

        assert!(update_status(
            &pool,
            n.id,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-06-12 09:31:00"
        )
        .await
        .unwrap());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Unterwegs);
        assert_eq!(nach.eingetroffen_at, None);
        assert_eq!(nach.unterwegs_at.as_deref(), Some("2026-06-12 09:10:00"));

        assert!(update_status(
            &pool,
            n.id,
            STATUS_ZUGESAGT,
            STATUS_UNTERWEGS,
            "2026-06-12 09:32:00"
        )
        .await
        .unwrap());
        assert!(update_status(
            &pool,
            n.id,
            STATUS_ANGEFORDERT,
            STATUS_ZUGESAGT,
            "2026-06-12 09:33:00"
        )
        .await
        .unwrap());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Angefordert);
        assert_eq!(nach.zugesagt_at, None);
        assert_eq!(nach.unterwegs_at, None);
        assert!(nach.ist_offen);

        // Die nächste Zusage trägt ihren eigenen Zeitpunkt, nicht den zurückgenommenen.
        assert!(update_status(
            &pool,
            n.id,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 10:00:00"
        )
        .await
        .unwrap());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.zugesagt_at.as_deref(), Some("2026-06-12 10:00:00"));
    }

    /// Sprünge über mehr als eine Stufe nimmt das Repo nicht an, auch wenn der Handler sie
    /// vorher abweist.
    #[tokio::test]
    async fn update_status_lehnt_spruenge_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        for (neu, alt) in [
            (STATUS_UNTERWEGS, STATUS_ANGEFORDERT),
            (STATUS_ANGEFORDERT, STATUS_UNTERWEGS),
            (STATUS_ANGEFORDERT, STATUS_ANGEFORDERT),
        ] {
            assert!(matches!(
                update_status(&pool, n.id, neu, alt, "2026-06-12 09:05:00").await,
                Err(AppError::Validation(_))
            ));
        }
    }

    #[tokio::test]
    async fn lehne_ab_setzt_grund_und_terminal() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(lehne_ab(
            &pool,
            n.id,
            Some("keine Reserven"),
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00"
        )
        .await
        .unwrap());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Abgelehnt);
        assert_eq!(nach.abgelehnt_grund.as_deref(), Some("keine Reserven"));
        assert!(!nach.ist_offen);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(belongs_to_einsatz(&pool, n.id, e).await.unwrap());
        assert!(!belongs_to_einsatz(&pool, n.id, 999).await.unwrap());
    }

    /// Ein Materialposten der Nachforderung `n` (LLH-1226), optional mit Endzustand.
    async fn posten(pool: &SqlitePool, e: i64, n: i64, beendet_als: Option<&str>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, \
                nachforderung_id, beendet_at, beendet_als) \
             VALUES (?, 'Tauchpumpe', 'geraet', 1, ?, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(n)
        .bind(beendet_als.map(|_| "2026-10-15 09:00:00"))
        .bind(beendet_als)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn material_ids_sind_ohne_uebernahme_leer() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        assert_eq!(n.material_ids.0, Vec::<i64>::new());
        let json = serde_json::to_value(&n).unwrap();
        assert_eq!(json["material_ids"], serde_json::json!([]));
    }

    /// LLH-1226, design.md D3/D8: aufsteigend, storniert fehlt, aus dem Einsatz genommen bleibt.
    #[tokio::test]
    async fn material_ids_zaehlen_nicht_stornierte_posten_aufsteigend() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        let andere = create(&pool, e, b, daten("Sandsäcke", "Deich"))
            .await
            .unwrap();
        let p1 = posten(&pool, e, n.id, None).await;
        posten(&pool, e, n.id, Some("storniert")).await;
        let p3 = posten(&pool, e, n.id, Some("entlassen")).await;
        let fremd = posten(&pool, e, andere.id, None).await;

        assert_eq!(
            load(&pool, n.id).await.unwrap().material_ids.0,
            vec![p1, p3]
        );
        let alle = list(&pool, e, None).await.unwrap();
        let aus_liste = |id: i64| {
            alle.iter()
                .find(|x| x.id == id)
                .unwrap()
                .material_ids
                .0
                .clone()
        };
        assert_eq!(aus_liste(n.id), vec![p1, p3]);
        assert_eq!(aus_liste(andere.id), vec![fremd]);
    }

    /// LLH-1226, design.md D9: das UPDATE der Rücknahme greift nicht, solange ein zählender
    /// Posten verknüpft ist (gegen eine gleichzeitige Übernahme); ein stornierter sperrt nicht.
    #[tokio::test]
    async fn update_status_nimmt_eingetroffen_mit_posten_nicht_zurueck() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        for (neu, alt) in [
            (STATUS_ZUGESAGT, STATUS_ANGEFORDERT),
            (STATUS_UNTERWEGS, STATUS_ZUGESAGT),
            (STATUS_EINGETROFFEN, STATUS_UNTERWEGS),
        ] {
            assert!(update_status(&pool, n.id, neu, alt, "2026-10-15 09:00:00")
                .await
                .unwrap());
        }
        let p = posten(&pool, e, n.id, None).await;
        assert!(has_material(&pool, n.id).await.unwrap());
        assert!(!update_status(
            &pool,
            n.id,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-10-15 09:10:00"
        )
        .await
        .unwrap());
        assert_eq!(
            load(&pool, n.id).await.unwrap().status,
            NachforderungStatus::Eingetroffen
        );
        sqlx::query(
            "UPDATE einsatz_material SET beendet_at = '2026-10-15 09:05:00', \
             beendet_als = 'storniert' WHERE id = ?",
        )
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
        assert!(!has_material(&pool, n.id).await.unwrap());
        assert!(update_status(
            &pool,
            n.id,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-10-15 09:10:00"
        )
        .await
        .unwrap());
    }
}

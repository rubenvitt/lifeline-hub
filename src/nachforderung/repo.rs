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
}

/// SELECT-Projektion inkl. Ersteller-Name (LEFT JOIN benutzer) und abgeleitetem `ist_offen`.
/// Reihenfolge der Spalten = Struct (FromRow positional). Keine computed-time-Spalte → kein
/// `jetzt`-Bind nötig.
const ANZEIGE_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.art, n.bezeichnung, n.anzahl, n.adressat_kategorie, \
            n.adressat_bezeichnung, n.begruendung, n.prioritaet, n.status, \
            n.zugesagt_at, n.unterwegs_at, n.eingetroffen_at, n.abgelehnt_at, n.abgelehnt_grund, \
            n.angefordert_at, n.etb_nachforderung_id, n.erstellt_von_id, n.erstellt_at, \
            b.anzeigename AS erstellt_von_name, \
            (n.status NOT IN ('eingetroffen', 'abgelehnt')) AS ist_offen \
     FROM nachforderung n LEFT JOIN benutzer b ON b.id = n.erstellt_von_id";

/// Lädt eine Nachforderung als Anzeige. `NotFound`, wenn unbekannt.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<NachforderungAnzeige, AppError> {
    sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(format!("{ANZEIGE_SELECT} WHERE n.id = ?")))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Legt eine Nachforderung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung':
/// die Nachforderung ist eine ausgehende Anforderung; Pattern B mit beidseitigem Backlink).
/// Liefert die neue id. `daten` ist vom Handler validiert.
pub async fn anlegen_tx(
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
            begruendung, prioritaet, angefordert_at, erstellt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
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
    .fetch_one(&mut *tx)
    .await?;

    // ETB-Meldung (Pattern B): die Anforderung erscheint regulär im ETB.
    let menge = daten.anzahl.map(|a| format!("{a}× ")).unwrap_or_default();
    let inhalt = format!("Nachforderung: {menge}{} — {}", daten.art, daten.bezeichnung);
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
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: NachforderungDaten<'_>,
) -> Result<NachforderungAnzeige, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;
    let id = anlegen_tx(&mut tx, einsatz_id, ersteller_id, etb_startwert, &daten).await?;
    tx.commit().await?;
    laden(pool, id).await
}

/// Listet Nachforderungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), dann neueste Anforderung zuerst, dann id.
pub async fn liste(
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
    let mut query = sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(&*q)).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Cross-Einsatz-Schutz: gehört die Nachforderung zum Einsatz?
pub async fn gehoert_zu_einsatz(pool: &SqlitePool, id: i64, einsatz_id: i64) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM nachforderung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Schaltet den Bedarfs-Status weiter (linear) und setzt den zugehörigen Zeitstempel
/// (first-write-wins via COALESCE). `erwartet` ist der vom Handler geprüfte Bestandsstatus:
/// das UPDATE greift NUR, wenn er unverändert ist (optimistische Sperre gegen TOCTOU —
/// die FSM ist back-edge-frei, daher kann der Guard keinen gültigen Übergang fälschlich
/// abweisen). Liefert `true`, wenn eine Zeile geändert wurde; `false` = Status zwischenzeitlich
/// geändert. `abgelehnt` läuft über [`lehne_ab`].
pub async fn setze_status(pool: &SqlitePool, id: i64, neuer_status: &str, erwartet: &str, jetzt: &str) -> Result<bool, AppError> {
    let stempel_spalte = match neuer_status {
        super::STATUS_ZUGESAGT => "zugesagt_at",
        super::STATUS_UNTERWEGS => "unterwegs_at",
        super::STATUS_EINGETROFFEN => "eingetroffen_at",
        _ => return Err(AppError::Validation("Ungültiger Zielstatus".into())),
    };
    let sql = format!(
        "UPDATE nachforderung SET status = ?, {stempel_spalte} = COALESCE({stempel_spalte}, ?) \
         WHERE id = ? AND status = ?"
    );
    let r = sqlx::query(sqlx::AssertSqlSafe(&*sql)).bind(neuer_status).bind(jetzt).bind(id).bind(erwartet).execute(pool).await?;
    Ok(r.rows_affected() > 0)
}

/// Lehnt eine Nachforderung ab (Abzweig): setzt status='abgelehnt', Zeitstempel und Grund —
/// nur wenn der Bestandsstatus `erwartet` unverändert ist (optimistische Sperre). Liefert
/// `true` bei erfolgter Änderung.
pub async fn lehne_ab(pool: &SqlitePool, id: i64, grund: Option<&str>, erwartet: &str, jetzt: &str) -> Result<bool, AppError> {
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
    use crate::nachforderung::{ADRESSAT_LEITSTELLE, PRIO_NORMAL, STATUS_ANGEFORDERT, STATUS_EINGETROFFEN, STATUS_UNTERWEGS, STATUS_ZUGESAGT};

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool).await.unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'Leit','leit','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
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
        }
    }

    #[tokio::test]
    async fn anlegen_setzt_default_status_und_erzeugt_etb_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = anlegen(&pool, e, b, daten("RTW", "2 RTW zur Verstärkung")).await.unwrap();
        assert_eq!(n.status, "angefordert");
        assert!(n.ist_offen);
        assert_eq!(n.anzahl, Some(2));
        assert_eq!(n.adressat_kategorie, "leitstelle");
        assert_eq!(n.erstellt_von_name.as_deref(), Some("Leit"));
        let etb_id = n.etb_nachforderung_id.expect("ETB-Eintrag erzeugt");
        let (typ, backlink): (String, i64) =
            sqlx::query_as("SELECT typ, nachforderung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id).fetch_one(&pool).await.unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, n.id);
    }

    #[tokio::test]
    async fn liste_sortiert_nach_prio_und_filtert_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, daten("RTW", "normal")).await.unwrap();
        let sofort = NachforderungDaten { prioritaet: super::super::PRIO_SOFORT, ..daten("SEG", "sofort") };
        anlegen(&pool, e, b, sofort).await.unwrap();
        let alle = liste(&pool, e, None).await.unwrap();
        assert_eq!(alle.len(), 2);
        assert_eq!(alle[0].bezeichnung, "sofort", "sofort vor normal");
        let offen = liste(&pool, e, Some("angefordert")).await.unwrap();
        assert_eq!(offen.len(), 2);
        assert!(liste(&pool, e, Some("eingetroffen")).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn setze_status_schaltet_weiter_und_haelt_zeitstempel() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = anlegen(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(setze_status(&pool, n.id, STATUS_ZUGESAGT, STATUS_ANGEFORDERT, "2026-06-12 09:05:00").await.unwrap());
        assert!(setze_status(&pool, n.id, STATUS_UNTERWEGS, STATUS_ZUGESAGT, "2026-06-12 09:10:00").await.unwrap());
        let nach = laden(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, "unterwegs");
        assert_eq!(nach.zugesagt_at.as_deref(), Some("2026-06-12 09:05:00"));
        assert_eq!(nach.unterwegs_at.as_deref(), Some("2026-06-12 09:10:00"));
        assert!(nach.ist_offen);
        // eingetroffen → terminal, nicht mehr offen.
        assert!(setze_status(&pool, n.id, STATUS_EINGETROFFEN, STATUS_UNTERWEGS, "2026-06-12 09:30:00").await.unwrap());
        assert!(!laden(&pool, n.id).await.unwrap().ist_offen);
        // Optimistische Sperre: erneuter Übergang mit veraltetem `erwartet` greift nicht.
        assert!(!setze_status(&pool, n.id, STATUS_ZUGESAGT, STATUS_ANGEFORDERT, "2026-06-12 09:40:00").await.unwrap());
    }

    #[tokio::test]
    async fn lehne_ab_setzt_grund_und_terminal() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = anlegen(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(lehne_ab(&pool, n.id, Some("keine Reserven"), STATUS_ANGEFORDERT, "2026-06-12 09:05:00").await.unwrap());
        let nach = laden(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, "abgelehnt");
        assert_eq!(nach.abgelehnt_grund.as_deref(), Some("keine Reserven"));
        assert!(!nach.ist_offen);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = anlegen(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(gehoert_zu_einsatz(&pool, n.id, e).await.unwrap());
        assert!(!gehoert_zu_einsatz(&pool, n.id, 999).await.unwrap());
    }
}

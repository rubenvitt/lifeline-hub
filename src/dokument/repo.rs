use super::{Bezug, DokumentAnzeige, DokumentKategorie};
use crate::error::AppError;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

/// Rohzeile vor der Enum-Umwandlung (`kategorie` kommt als TEXT).
#[derive(FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    kategorie: String,
    titel: String,
    dateiname: String,
    mime: String,
    groesse: i64,
    bezug_abschnitt_id: Option<i64>,
    bezug_abschnitt_name: Option<String>,
    bezug_einheit_id: Option<i64>,
    bezug_einheit_name: Option<String>,
    bezug_etb_eintrag_id: Option<i64>,
    bezug_etb_lfd_nr: Option<i64>,
    etb_eintrag_id: i64,
    abgelegt_von_id: i64,
    abgelegt_von_name: Option<String>,
    abgelegt_at: String,
}

impl TryFrom<Zeile> for DokumentAnzeige {
    type Error = AppError;
    fn try_from(z: Zeile) -> Result<Self, AppError> {
        let kategorie = DokumentKategorie::parse(&z.kategorie).ok_or_else(|| {
            AppError::Internal(format!("Unbekannte Kategorie in DB: {}", z.kategorie))
        })?;
        Ok(DokumentAnzeige {
            id: z.id,
            einsatz_id: z.einsatz_id,
            kategorie,
            titel: z.titel,
            dateiname: z.dateiname,
            mime: z.mime,
            groesse: z.groesse,
            bezug_abschnitt_id: z.bezug_abschnitt_id,
            bezug_abschnitt_name: z.bezug_abschnitt_name,
            bezug_einheit_id: z.bezug_einheit_id,
            bezug_einheit_name: z.bezug_einheit_name,
            bezug_etb_eintrag_id: z.bezug_etb_eintrag_id,
            bezug_etb_lfd_nr: z.bezug_etb_lfd_nr,
            etb_eintrag_id: z.etb_eintrag_id,
            abgelegt_von_id: z.abgelegt_von_id,
            abgelegt_von_name: z.abgelegt_von_name,
            abgelegt_at: z.abgelegt_at,
        })
    }
}

/// SELECT über die lebenden Dokumente eines Einsatzes samt Anzeige-Joins.
const SELECT: &str = "SELECT d.id, d.einsatz_id, d.kategorie, d.titel, \
        a.dateiname, a.mime, a.groesse, \
        d.bezug_abschnitt_id, ab.name AS bezug_abschnitt_name, \
        d.bezug_einheit_id, eh.name AS bezug_einheit_name, \
        d.bezug_etb_eintrag_id, et.lfd_nr AS bezug_etb_lfd_nr, \
        d.etb_eintrag_id, d.abgelegt_von_id, b.anzeigename AS abgelegt_von_name, d.abgelegt_at \
     FROM einsatz_dokument d \
     JOIN anhang a ON a.id = d.anhang_id \
     LEFT JOIN einsatzabschnitt ab ON ab.id = d.bezug_abschnitt_id \
     LEFT JOIN einsatz_einheit eh ON eh.id = d.bezug_einheit_id \
     LEFT JOIN etb_eintrag et ON et.id = d.bezug_etb_eintrag_id \
     LEFT JOIN benutzer b ON b.id = d.abgelegt_von_id \
     WHERE d.einsatz_id = ? AND d.geloescht_at IS NULL";

pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<DokumentAnzeige>, AppError> {
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "{SELECT} ORDER BY d.abgelegt_at DESC, d.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    zeilen.into_iter().map(DokumentAnzeige::try_from).collect()
}

/// Ein lebendes Dokument dieses Einsatzes; fremd, unbekannt oder gelöscht → `NotFound`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<DokumentAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!("{SELECT} AND d.id = ?")))
        .bind(einsatz_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?
        .try_into()
}

/// `anhang_id` eines lebenden Dokuments dieses Einsatzes (Download); sonst `NotFound`.
pub async fn anhang_id(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT anhang_id FROM einsatz_dokument \
         WHERE id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Eingabe für [`ablegen`] — vom Handler validiert.
pub struct Ablage<'a> {
    pub kategorie: DokumentKategorie,
    pub titel: &'a str,
    pub bezug: Option<Bezug>,
    pub dateiname: &'a str,
    pub mime: &'a str,
    pub daten: &'a [u8],
}

/// Prüft, dass das Bezugsziel zu diesem Einsatz gehört (FK-Ersatz für die Isolation);
/// fremd/unbekannt → 400 wie `chat::bezug_setzen`.
async fn bezug_pruefen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bezug: Bezug,
) -> Result<(), AppError> {
    // Drei literale Queries statt eines interpolierten Tabellennamens: die SQL bleibt
    // `&'static str` (sqlx 0.9 SqlSafeStr) und der Tabellenname steht im Klartext.
    let sql = match bezug {
        Bezug::Abschnitt(_) => "SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
        Bezug::Einheit(_) => "SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        Bezug::EtbEintrag(_) => "SELECT 1 FROM etb_eintrag WHERE id = ? AND einsatz_id = ?",
    };
    let id = match bezug {
        Bezug::Abschnitt(id) | Bezug::Einheit(id) | Bezug::EtbEintrag(id) => id,
    };
    let treffer: Option<i64> = sqlx::query_scalar(sql)
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    if treffer.is_none() {
        return Err(AppError::Validation(
            "Unbekanntes oder fremdes Bezugsziel".into(),
        ));
    }
    Ok(())
}

/// Legt Anhang, Dokument und System-ETB-Eintrag in EINER Transaktion an (Pattern B,
/// kein Orphan-Fenster). Liefert `(dokument_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let inhalt = format!(
        "Dokument abgelegt: {} ({})",
        ablage.titel,
        ablage.kategorie.label()
    );
    crate::write_retry!(pool, |conn| {
        if let Some(b) = ablage.bezug {
            bezug_pruefen(conn, einsatz_id, b).await?;
        }
        let anhang_id = crate::anhang::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            ablage.dateiname,
            ablage.mime,
            ablage.daten,
        )
        .await?;
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt)
                .await?;
        let (ab, eh, et) = match ablage.bezug {
            Some(Bezug::Abschnitt(i)) => (Some(i), None, None),
            Some(Bezug::Einheit(i)) => (None, Some(i), None),
            Some(Bezug::EtbEintrag(i)) => (None, None, Some(i)),
            None => (None, None, None),
        };
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, bezug_abschnitt_id, bezug_einheit_id, \
                bezug_etb_eintrag_id, etb_eintrag_id, abgelegt_von_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(anhang_id)
        .bind(ablage.kategorie.as_str())
        .bind(ablage.titel)
        .bind(ab)
        .bind(eh)
        .bind(et)
        .bind(etb_id)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        Ok((id, etb_id))
    })
}

/// Soft-Delete mit System-ETB-Nachweis. Fremd/unbekannt/schon gelöscht → `NotFound`.
/// Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(pool, |conn| {
        let (titel, kategorie): (String, String) = sqlx::query_as(
            "SELECT titel, kategorie FROM einsatz_dokument \
             WHERE id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let label = DokumentKategorie::parse(&kategorie)
            .map(|k| k.label())
            .unwrap_or("Sonstiges");
        sqlx::query(
            "UPDATE einsatz_dokument SET geloescht_at = datetime('now'), geloescht_von_id = ? \
             WHERE id = ?",
        )
        .bind(benutzer_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        crate::etb::system_audit_tx(
            conn,
            einsatz_id,
            benutzer_id,
            etb_startwert,
            &format!("Dokument entfernt: {titel} ({label})"),
        )
        .await
    })
}

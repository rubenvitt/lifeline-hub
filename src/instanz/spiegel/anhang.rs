//! Inhalte auf Abruf (design.md D8): Ein Anhang kommt am Spiegel zuerst nur mit Größe und
//! Prüfsumme an. Seinen Inhalt holt der Spiegel in Stücken: angeforderte zuerst, dann im Leerlauf
//! die übrigen. Erst bei voller Länge und passender Prüfsumme gilt der Inhalt.

use super::paket::{AnhangAbruf, AnhangTeil, BlobAngabe, ANHAENGE_MAX, TEIL_GROESSE};
use super::schema;
use super::uebernehmen::OffenerInhalt;
use crate::error::AppError;
use base64::Engine;
use sha2::{Digest, Sha256};
use sqlx::{SqliteConnection, SqlitePool};

/// Antwort (409), solange der Inhalt eines Anhangs am Spiegel fehlt. Der Client zeigt dann
/// „wird geholt“.
pub const WIRD_GEHOLT: &str = "Der Anhang wird von der führenden Instanz geholt.";

/// Höchstzahl Abrufe je Paket, die nur vorab laden (ohne Anforderung).
const VORAB_MAX: i64 = 4;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Merkt sich nach einer Übernahme, welche Inhalte fehlen. Eine geänderte Prüfsumme beginnt neu;
/// ein leerer Inhalt ist sofort fertig. Hat die eigene Zeile den Inhalt schon (sie stammt von
/// dieser Instanz, die den Einsatz vorher führte, LLH-1641 E7), fehlt nichts.
pub async fn merke_inhalte(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    inhalte: &[OffenerInhalt],
) -> Result<(), AppError> {
    let schema = schema::schema(conn).await?;
    for i in inhalte {
        if let Some((t, b)) = schema
            .tabelle(&i.art)
            .and_then(|t| t.blob.as_deref().map(|b| (t, b)))
        {
            let lokal: Option<Option<Vec<u8>>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT \"{b}\" FROM {} WHERE {}",
                t.name,
                t.schluessel.gleich(t.name)
            )))
            .bind(&i.lokaler_schluessel)
            .fetch_optional(&mut *conn)
            .await?;
            if let Some(Some(lokal)) = lokal {
                if !lokal.is_empty()
                    && lokal.len() as i64 == i.angabe.groesse
                    && hex(&Sha256::digest(&lokal)) == i.angabe.sha256
                {
                    vergiss(conn, &i.art, &i.lokaler_schluessel).await?;
                    continue;
                }
            }
        }
        let bisher: Option<String> = sqlx::query_scalar(
            "SELECT sha256 FROM spiegel_anhang WHERE art = ? AND lokaler_schluessel = ?",
        )
        .bind(&i.art)
        .bind(&i.lokaler_schluessel)
        .fetch_optional(&mut *conn)
        .await?;
        if bisher.as_deref() == Some(i.angabe.sha256.as_str()) {
            continue;
        }
        sqlx::query("DELETE FROM spiegel_anhang WHERE art = ? AND lokaler_schluessel = ?")
            .bind(&i.art)
            .bind(&i.lokaler_schluessel)
            .execute(&mut *conn)
            .await?;
        let fertig = (i.angabe.groesse == 0).then(crate::zeit::jetzt);
        sqlx::query(
            "INSERT INTO spiegel_anhang (einsatz_id, art, lokaler_schluessel, fremder_schluessel, \
             sha256, groesse, fertig_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(einsatz_id)
        .bind(&i.art)
        .bind(&i.lokaler_schluessel)
        .bind(&i.fremder_schluessel)
        .bind(&i.angabe.sha256)
        .bind(i.angabe.groesse)
        .bind(fertig)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Vergisst einen Inhalt, dessen Zeile am Spiegel gelöscht wurde.
pub async fn vergiss(
    conn: &mut SqliteConnection,
    art: &str,
    lokaler_schluessel: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM spiegel_anhang WHERE art = ? AND lokaler_schluessel = ?")
        .bind(art)
        .bind(lokaler_schluessel)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Größe und Prüfsumme eines Inhalts, den diese Instanz selbst noch holt (LLH-1641, E7): Wer einen
/// Einsatz übernommen hat, liefert die Angabe des alten Führers weiter, nicht die des leeren
/// Platzhalters.
pub async fn offene_angabe(
    conn: &mut SqliteConnection,
    art: &str,
    lokaler_schluessel: &str,
) -> Result<Option<BlobAngabe>, AppError> {
    let zeile: Option<(i64, String)> = sqlx::query_as(
        "SELECT groesse, sha256 FROM spiegel_anhang \
         WHERE art = ? AND lokaler_schluessel = ? AND fertig_at IS NULL",
    )
    .bind(art)
    .bind(lokaler_schluessel)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(zeile.map(|(groesse, sha256)| BlobAngabe { groesse, sha256 }))
}

/// Prüft vor einer Auslieferung, ob der Inhalt am Spiegel schon da ist. Fehlt er, wird er
/// angefordert, der Abgleich geweckt, und die Antwort ist 409 [`WIRD_GEHOLT`].
pub async fn pruefe_vorhanden(
    pool: &SqlitePool,
    art: &str,
    lokaler_schluessel: &str,
) -> Result<(), AppError> {
    let offen: Option<Option<String>> = sqlx::query_scalar(
        "SELECT angefordert_at FROM spiegel_anhang \
         WHERE art = ? AND lokaler_schluessel = ? AND fertig_at IS NULL",
    )
    .bind(art)
    .bind(lokaler_schluessel)
    .fetch_optional(pool)
    .await?;
    let Some(angefordert) = offen else {
        return Ok(());
    };
    if angefordert.is_none() {
        sqlx::query(
            "UPDATE spiegel_anhang SET angefordert_at = ? \
             WHERE art = ? AND lokaler_schluessel = ? AND angefordert_at IS NULL",
        )
        .bind(crate::zeit::jetzt())
        .bind(art)
        .bind(lokaler_schluessel)
        .execute(pool)
        .await?;
        super::takt::wecken();
    }
    Err(AppError::Conflict(WIRD_GEHOLT.into()))
}

/// Was der Spiegel bei einer Kopplung holen will: angeforderte Inhalte zuerst, dann wenige zum
/// Vorabladen. Dazu Inhalte, die ein neuer Führer vom alten noch holt (LLH-1641, E7).
pub async fn offene_abrufe(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<AnhangAbruf>, AppError> {
    let zeilen: Vec<(String, String, String, String, i64, Option<String>)> = sqlx::query_as(
        "SELECT e.kennung, a.art, a.fremder_schluessel, a.sha256, a.empfangen, \
         a.angefordert_at FROM spiegel_anhang a JOIN einsatz e ON e.id = a.einsatz_id \
         WHERE a.fertig_at IS NULL AND e.kennung IS NOT NULL AND ( \
           EXISTS (SELECT 1 FROM einsatz_spiegel s \
                   JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
                   WHERE s.einsatz_id = a.einsatz_id AND o.kopplung_id = ? \
                     AND o.widerrufen_at IS NULL AND s.beendet_at IS NULL) \
           OR (e.spiegel = 0 AND EXISTS (SELECT 1 FROM einsatz_fuehrung f \
                   WHERE f.einsatz_id = a.einsatz_id AND f.herkunft_kopplung_id = ?))) \
         ORDER BY a.angefordert_at IS NULL, a.angefordert_at, a.rowid LIMIT ?",
    )
    .bind(kopplung_id)
    .bind(kopplung_id)
    .bind(ANHAENGE_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    let mut vorab = 0;
    let mut abrufe = Vec::new();
    for (kennung, art, schluessel, sha256, ab, angefordert) in zeilen {
        if angefordert.is_none() {
            vorab += 1;
            if vorab > VORAB_MAX {
                break;
            }
        }
        abrufe.push(AnhangAbruf {
            kennung,
            art,
            schluessel,
            sha256,
            ab,
        });
    }
    Ok(abrufe)
}

/// Liefert Stücke der abgerufenen Inhalte, bis `bytes` erschöpft ist. Ob der Inhalt sich
/// inzwischen geändert hat, prüft der Abrufer am Ende über die Prüfsumme. Liefern kann jede Seite,
/// die den Inhalt vollständig hat: der Führer an seinen Spiegel, und nach einem Wechsel der alte
/// Führer (jetzt Spiegel) an den neuen (LLH-1641, E7).
pub async fn liefere_teile(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    abrufe: &[AnhangAbruf],
    mut bytes: usize,
) -> Result<Vec<AnhangTeil>, AppError> {
    let schema = schema::schema(conn).await?;
    let mut teile = Vec::new();
    for a in abrufe.iter().take(ANHAENGE_MAX) {
        // Base64 braucht vier Zeichen je drei Bytes.
        if bytes < TEIL_GROESSE / 3 * 4 + 1024 {
            break;
        }
        let Some(t) = schema.tabelle(&a.art) else {
            continue;
        };
        let Some(spalte) = &t.blob else { continue };
        // Nur Einsätze, die diese Kopplung bekommt: ein hier geführter, dessen Org ihr aktiv
        // zugeordnet ist, oder ein Spiegel genau dieser Kopplung (alter Führer, E7). Ein Spiegel
        // einer anderen Kopplung derselben Org bleibt außen vor.
        let gefuehrt: Option<i64> = sqlx::query_scalar(
            "SELECT e.id FROM einsatz e WHERE e.kennung = ?1 AND ( \
             (e.spiegel = 0 AND EXISTS (SELECT 1 FROM instanz_kopplung_org o \
               WHERE o.kopplung_id = ?2 AND o.org_id = e.org_id AND o.widerrufen_at IS NULL)) \
             OR EXISTS (SELECT 1 FROM einsatz_spiegel s JOIN instanz_kopplung_org o \
               ON o.id = s.kopplung_org_id WHERE s.einsatz_id = e.id AND o.kopplung_id = ?2 \
               AND o.widerrufen_at IS NULL))",
        )
        .bind(&a.kennung)
        .bind(kopplung_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some(einsatz_id) = gefuehrt else { continue };
        let besitzt: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = ? AND art = ? \
             AND schluessel = ?)",
        )
        .bind(einsatz_id)
        .bind(&a.art)
        .bind(&a.schluessel)
        .fetch_one(&mut *conn)
        .await?;
        if !besitzt || a.ab < 0 || offene_angabe(conn, &a.art, &a.schluessel).await?.is_some() {
            continue;
        }
        let stueck: Option<Vec<u8>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT substr(\"{spalte}\", ?, ?) FROM {} WHERE {}",
            t.name,
            t.schluessel.gleich(t.name)
        )))
        .bind(a.ab + 1)
        .bind(TEIL_GROESSE as i64)
        .bind(&a.schluessel)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
        let Some(stueck) = stueck else { continue };
        let daten = base64::engine::general_purpose::STANDARD.encode(&stueck);
        bytes = bytes.saturating_sub(daten.len() + 256);
        teile.push(AnhangTeil {
            kennung: a.kennung.clone(),
            art: a.art.clone(),
            schluessel: a.schluessel.clone(),
            sha256: a.sha256.clone(),
            ab: a.ab,
            daten,
        });
    }
    Ok(teile)
}

/// Übernimmt Stücke am Spiegel. Ist ein Inhalt vollständig und passt die Prüfsumme, wird er unter
/// dem Merker in seine Zeile geschrieben; sonst beginnt er neu. Liefert die Einsätze, deren
/// Inhalte fertig wurden.
pub async fn uebernehme_teile(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    teile: &[AnhangTeil],
) -> Result<Vec<i64>, AppError> {
    let schema = schema::schema(conn).await?;
    let mut fertig = Vec::new();
    for t in teile.iter().take(ANHAENGE_MAX) {
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&t.daten) else {
            continue;
        };
        let offen: Option<(i64, String, i64, i64)> = sqlx::query_as(
            "SELECT a.einsatz_id, a.lokaler_schluessel, a.groesse, a.empfangen \
             FROM spiegel_anhang a JOIN einsatz e ON e.id = a.einsatz_id \
             WHERE e.kennung = ? AND a.art = ? AND a.fremder_schluessel = ? AND a.sha256 = ? \
             AND a.fertig_at IS NULL AND ( \
               EXISTS (SELECT 1 FROM einsatz_spiegel s \
                       JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
                       WHERE s.einsatz_id = a.einsatz_id AND o.kopplung_id = ?) \
               OR (e.spiegel = 0 AND EXISTS (SELECT 1 FROM einsatz_fuehrung f \
                       WHERE f.einsatz_id = a.einsatz_id AND f.herkunft_kopplung_id = ?)))",
        )
        .bind(&t.kennung)
        .bind(&t.art)
        .bind(&t.schluessel)
        .bind(&t.sha256)
        .bind(kopplung_id)
        .bind(kopplung_id)
        .fetch_optional(&mut *conn)
        .await?;
        let Some((einsatz_id, lokal, groesse, empfangen)) = offen else {
            continue;
        };
        if t.ab != empfangen || bytes.is_empty() || empfangen + bytes.len() as i64 > groesse {
            continue;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO spiegel_anhang_teil (einsatz_id, art, lokaler_schluessel, ab, daten) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(einsatz_id)
        .bind(&t.art)
        .bind(&lokal)
        .bind(t.ab)
        .bind(&bytes)
        .execute(&mut *conn)
        .await?;
        let jetzt_empfangen = empfangen + bytes.len() as i64;
        sqlx::query(
            "UPDATE spiegel_anhang SET empfangen = ? WHERE art = ? AND lokaler_schluessel = ?",
        )
        .bind(jetzt_empfangen)
        .bind(&t.art)
        .bind(&lokal)
        .execute(&mut *conn)
        .await?;
        if jetzt_empfangen < groesse {
            continue;
        }
        let stuecke: Vec<Vec<u8>> = sqlx::query_scalar(
            "SELECT daten FROM spiegel_anhang_teil WHERE art = ? AND lokaler_schluessel = ? \
             ORDER BY ab",
        )
        .bind(&t.art)
        .bind(&lokal)
        .fetch_all(&mut *conn)
        .await?;
        let inhalt: Vec<u8> = stuecke.concat();
        sqlx::query("DELETE FROM spiegel_anhang_teil WHERE art = ? AND lokaler_schluessel = ?")
            .bind(&t.art)
            .bind(&lokal)
            .execute(&mut *conn)
            .await?;
        if hex(&Sha256::digest(&inhalt)) != t.sha256 {
            // Unterwegs geändert oder verfälscht: neu holen.
            sqlx::query(
                "UPDATE spiegel_anhang SET empfangen = 0 WHERE art = ? AND lokaler_schluessel = ?",
            )
            .bind(&t.art)
            .bind(&lokal)
            .execute(&mut *conn)
            .await?;
            continue;
        }
        let Some(tab) = schema.tabelle(&t.art) else {
            continue;
        };
        let Some(spalte) = &tab.blob else { continue };
        sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
            .execute(&mut *conn)
            .await?;
        let geschrieben = sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {} SET \"{spalte}\" = ? WHERE {}",
            tab.name,
            tab.schluessel.gleich(tab.name)
        )))
        .bind(&inhalt)
        .bind(&lokal)
        .execute(&mut *conn)
        .await;
        sqlx::query("DELETE FROM spiegel_uebernahme")
            .execute(&mut *conn)
            .await?;
        geschrieben?;
        sqlx::query(
            "UPDATE spiegel_anhang SET fertig_at = ? WHERE art = ? AND lokaler_schluessel = ?",
        )
        .bind(crate::zeit::jetzt())
        .bind(&t.art)
        .bind(&lokal)
        .execute(&mut *conn)
        .await?;
        fertig.push(einsatz_id);
    }
    Ok(fertig)
}

#[cfg(test)]
mod tests {
    /// Das Frontend erkennt „wird geholt“ am Wortlaut der 409 (`{error}`-Kontrakt ohne Code,
    /// `frontend/src/api/anhangAbruf.ts`); ändert er sich hier, bräche die Anzeige still.
    #[test]
    fn das_frontend_kennt_den_wortlaut_von_wird_geholt() {
        let pfad = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/frontend/src/api/anhangAbruf.ts"
        );
        let ts = std::fs::read_to_string(pfad).expect("anhangAbruf.ts lesbar");
        assert!(
            ts.contains(&format!("'{}'", super::WIRD_GEHOLT)),
            "ANHANG_WIRD_GEHOLT_TEXT weicht von anhang::WIRD_GEHOLT ab"
        );
    }
}

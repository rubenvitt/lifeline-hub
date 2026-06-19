use super::{BezugTyp, ChatKanalAnzeige, ChatNachrichtAnzeige, DEFAULT_KANAL_NAME};
use crate::anhang::AnhangAnzeige;
use crate::error::AppError;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::collections::HashMap;

/// Lädt alle Kanäle eines Einsatzes und stellt sicher, dass mindestens der
/// Default-Kanal existiert (lazy-Anlage mit `default_ersteller_id` als Ersteller).
/// Das deckt Bestands-Einsätze ohne Backfill ab. Das `INSERT … WHERE NOT EXISTS`
/// verhindert ein Duplikat, falls bereits ein Kanal existiert.
pub async fn liste_kanaele(
    pool: &SqlitePool,
    einsatz_id: i64,
    default_ersteller_id: i64,
) -> Result<Vec<ChatKanalAnzeige>, AppError> {
    sqlx::query(
        "INSERT INTO chat_kanal (einsatz_id, name, erstellt_von_id) \
         SELECT ?, ?, ? \
         WHERE NOT EXISTS (SELECT 1 FROM chat_kanal WHERE einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(DEFAULT_KANAL_NAME)
    .bind(default_ersteller_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE einsatz_id = ? ORDER BY erstellt_at, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt einen neuen Kanal an und liefert ihn als Anzeige.
pub async fn kanal_anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    name: &str,
    beschreibung: Option<&str>,
) -> Result<ChatKanalAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(name)
    .bind(beschreibung)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;

    sqlx::query_as::<_, ChatKanalAnzeige>(
        "SELECT id, einsatz_id, name, beschreibung, erstellt_von_id, erstellt_at, archiviert_at \
         FROM chat_kanal WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

/// Prüft, ob ein Kanal zum angegebenen Einsatz gehört (Schutz gegen Cross-Einsatz-Zugriff).
pub async fn gehoert_kanal_zu_einsatz(
    pool: &SqlitePool,
    kanal_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_kanal WHERE id = ? AND einsatz_id = ?")
            .bind(kanal_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Standard-Seitengröße der Nachrichten-Abfrage.
pub const STANDARD_LIMIT: i64 = 100;
/// Maximale Seitengröße.
pub const MAX_LIMIT: i64 = 500;

/// Eingabedaten für eine neue Nachricht (bereits validiert/getrimmt vom Handler).
#[derive(Debug)]
pub struct NachrichtDaten<'a> {
    pub kanal_id: i64,
    pub inhalt: &'a str,
}

/// Filter-/Cursor-Parameter der Nachrichten-Abfrage.
#[derive(Debug)]
pub struct NachrichtFilter {
    pub kanal_id: i64,
    /// Cursor: nur Nachrichten mit `id <` diesem Wert (ältere Seite).
    pub before_id: Option<i64>,
    pub limit: i64,
}

/// SELECT-Projektion einer Nachricht inkl. Autor-Name. `inhalt` wird bei
/// gelöschten Nachrichten als NULL ausgeliefert (Tombstone).
const NACHRICHT_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.kanal_id, n.autor_id, b.anzeigename AS autor_name, \
            CASE WHEN n.geloescht_at IS NULL THEN n.inhalt ELSE NULL END AS inhalt, \
            n.erstellt_at, n.bearbeitet_at, n.geloescht_at, n.etb_eintrag_id, n.auftrag_id, \
            n.bezug_typ, n.bezug_id \
     FROM chat_nachricht n JOIN benutzer b ON b.id = n.autor_id";

/// Zeile der Anhang-Sammelabfrage: ein Anhang samt der Nachricht, an der er hängt.
#[derive(sqlx::FromRow)]
struct AnhangMitNachricht {
    nachricht_id: i64,
    #[sqlx(flatten)]
    anhang: AnhangAnzeige,
}

/// Lädt alle Anhänge für die gegebenen Nachrichten in EINER Abfrage (kein N+1)
/// und gruppiert sie je `nachricht_id`. Leere Eingabe → leere Map.
async fn anhaenge_map(
    pool: &SqlitePool,
    nachricht_ids: &[i64],
) -> Result<HashMap<i64, Vec<AnhangAnzeige>>, AppError> {
    let mut map: HashMap<i64, Vec<AnhangAnzeige>> = HashMap::new();
    if nachricht_ids.is_empty() {
        return Ok(map);
    }
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(
        "SELECT cna.nachricht_id AS nachricht_id, a.id AS id, a.einsatz_id AS einsatz_id, \
                a.dateiname AS dateiname, a.mime AS mime, a.groesse AS groesse, \
                a.hochgeladen_von AS hochgeladen_von, a.erstellt_at AS erstellt_at \
         FROM chat_nachricht_anhang cna JOIN anhang a ON a.id = cna.anhang_id \
         WHERE cna.nachricht_id IN (",
    );
    let mut sep = qb.separated(", ");
    for id in nachricht_ids {
        sep.push_bind(*id);
    }
    qb.push(") ORDER BY a.id");

    let zeilen = qb
        .build_query_as::<AnhangMitNachricht>()
        .fetch_all(pool)
        .await?;
    for z in zeilen {
        map.entry(z.nachricht_id).or_default().push(z.anhang);
    }
    Ok(map)
}

/// Hängt die Anhänge an eine bereits geladene Nachrichtenliste (in-place).
async fn anhaenge_anreichern(
    pool: &SqlitePool,
    nachrichten: &mut [ChatNachrichtAnzeige],
) -> Result<(), AppError> {
    let ids: Vec<i64> = nachrichten.iter().map(|n| n.id).collect();
    let mut map = anhaenge_map(pool, &ids).await?;
    for n in nachrichten.iter_mut() {
        n.anhaenge = map.remove(&n.id).unwrap_or_default();
    }
    Ok(())
}

/// Lädt eine einzelne Nachricht als Anzeige (inkl. Anhänge). `NotFound`, wenn sie
/// nicht existiert.
pub async fn laden(pool: &SqlitePool, id: i64) -> Result<ChatNachrichtAnzeige, AppError> {
    let mut nachricht =
        sqlx::query_as::<_, ChatNachrichtAnzeige>(&format!("{NACHRICHT_SELECT} WHERE n.id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound)?;
    nachricht.anhaenge = anhaenge_map(pool, &[id]).await?.remove(&id).unwrap_or_default();
    Ok(nachricht)
}

/// Legt eine Nachricht an und liefert sie als Anzeige.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    autor_id: i64,
    daten: NachrichtDaten<'_>,
) -> Result<ChatNachrichtAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.kanal_id)
    .bind(autor_id)
    .bind(daten.inhalt)
    .fetch_one(pool)
    .await?;
    laden(pool, id).await
}

/// Legt eine Nachricht an und verknüpft sie mit bereits hochgeladenen Anhängen —
/// alles in EINER Transaktion. Jeder `anhang_id` muss zu `einsatz_id` gehören
/// (Cross-Einsatz-Schutz); andernfalls Rollback und `Validation`, sodass keine
/// Nachricht ohne ihre Anhänge zurückbleibt. `inhalt` darf leer sein, wenn
/// mindestens ein Anhang vorhanden ist (Anhang-only-Nachricht).
pub async fn anlegen_mit_anhaengen(
    pool: &SqlitePool,
    einsatz_id: i64,
    autor_id: i64,
    kanal_id: i64,
    inhalt: &str,
    anhang_ids: &[i64],
) -> Result<ChatNachrichtAnzeige, AppError> {
    let mut tx = pool.begin().await?;

    for &aid in anhang_ids {
        let treffer: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM anhang WHERE id = ? AND einsatz_id = ?")
                .bind(aid)
                .bind(einsatz_id)
                .fetch_optional(&mut *tx)
                .await?;
        if treffer.is_none() {
            return Err(AppError::Validation("Unbekannter oder fremder Anhang".into()));
        }
    }

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(kanal_id)
    .bind(autor_id)
    .bind(inhalt)
    .fetch_one(&mut *tx)
    .await?;

    for &aid in anhang_ids {
        sqlx::query("INSERT INTO chat_nachricht_anhang (nachricht_id, anhang_id) VALUES (?, ?)")
            .bind(id)
            .bind(aid)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    laden(pool, id).await
}

/// Fragt Nachrichten eines Kanals ab (inkl. Anhänge). Sortierung: `id DESC`
/// (neueste zuerst), Cursor über `before_id`.
pub async fn abfrage(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: &NachrichtFilter,
) -> Result<Vec<ChatNachrichtAnzeige>, AppError> {
    let mut qb: QueryBuilder<Sqlite> = QueryBuilder::new(NACHRICHT_SELECT);
    qb.push(" WHERE n.einsatz_id = ");
    qb.push_bind(einsatz_id);
    qb.push(" AND n.kanal_id = ");
    qb.push_bind(filter.kanal_id);
    if let Some(cursor) = filter.before_id {
        qb.push(" AND n.id < ");
        qb.push_bind(cursor);
    }
    qb.push(" ORDER BY n.id DESC LIMIT ");
    qb.push_bind(filter.limit);

    let mut nachrichten = qb
        .build_query_as::<ChatNachrichtAnzeige>()
        .fetch_all(pool)
        .await?;
    anhaenge_anreichern(pool, &mut nachrichten).await?;
    Ok(nachrichten)
}

/// Prüft, ob eine Nachricht zum angegebenen Einsatz gehört (Cross-Einsatz-Schutz).
pub async fn gehoert_nachricht_zu_einsatz(
    pool: &SqlitePool,
    nachricht_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM chat_nachricht WHERE id = ? AND einsatz_id = ?")
            .bind(nachricht_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Liefert die Autor-ID einer Nachricht (`None`, wenn sie nicht existiert).
/// Grundlage für die Autor-Prüfung bei Bearbeiten/Löschen.
pub async fn autor_von(pool: &SqlitePool, nachricht_id: i64) -> Result<Option<i64>, AppError> {
    sqlx::query_scalar("SELECT autor_id FROM chat_nachricht WHERE id = ?")
        .bind(nachricht_id)
        .fetch_optional(pool)
        .await
        .map_err(Into::into)
}

/// Bearbeitet den Inhalt einer Nachricht und setzt `bearbeitet_at` auf jetzt.
pub async fn bearbeiten(
    pool: &SqlitePool,
    nachricht_id: i64,
    neuer_inhalt: &str,
) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query(
        "UPDATE chat_nachricht SET inhalt = ?, bearbeitet_at = datetime('now') \
         WHERE id = ? AND geloescht_at IS NULL",
    )
    .bind(neuer_inhalt)
    .bind(nachricht_id)
    .execute(pool)
    .await?;
    laden(pool, nachricht_id).await
}

/// Soft-löscht eine Nachricht (Tombstone via `geloescht_at`).
pub async fn loeschen(pool: &SqlitePool, nachricht_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE chat_nachricht SET geloescht_at = datetime('now') WHERE id = ?")
        .bind(nachricht_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Prüft, ob das Bezug-Ziel (polymorph, LFH-103) zum Einsatz gehört — FK-Ersatz, da
/// `bezug_id` keinen DB-FK trägt. Dispatch auf den Typ über die bereits vorhandenen,
/// einsatz-gescopten Lese-Funktionen der Module; `NotFound` (fremder/ungültiger
/// Einsatz) wird zu `false`, echte DB-Fehler werden propagiert.
async fn ziel_gehoert_zu_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    typ: BezugTyp,
    ziel_id: i64,
) -> Result<bool, AppError> {
    // Übersetzt ein einsatz-gescoptes `laden` (Ok = vorhanden, NotFound = nicht) in bool.
    fn vorhanden<T>(r: Result<T, AppError>) -> Result<bool, AppError> {
        match r {
            Ok(_) => Ok(true),
            Err(AppError::NotFound) => Ok(false),
            Err(e) => Err(e),
        }
    }
    match typ {
        BezugTyp::Schaden => vorhanden(crate::schaden::repo::laden(pool, einsatz_id, ziel_id).await),
        BezugTyp::Uhs => vorhanden(crate::uhs::repo::laden(pool, einsatz_id, ziel_id).await),
        BezugTyp::Person => vorhanden(crate::person::repo::laden(pool, einsatz_id, ziel_id).await),
        BezugTyp::Lagebericht => {
            vorhanden(crate::lagebericht::repo::laden(pool, einsatz_id, ziel_id).await)
        }
        BezugTyp::Meldung => crate::meldung::repo::gehoert_zu_einsatz(pool, ziel_id, einsatz_id).await,
        BezugTyp::Auftrag => crate::auftrag::repo::gehoert_zu_einsatz(pool, ziel_id, einsatz_id).await,
    }
}

/// Setzt den polymorphen Sachbezug einer Nachricht auf ein bestehendes Objekt
/// (LFH-103). Das Ziel muss zum selben Einsatz gehören (Cross-Einsatz-Guard, Muster
/// `anlegen_mit_anhaengen`) — sonst `Validation`. Eine gelöschte Nachricht → `Conflict`.
/// `bezug_typ` und `bezug_id` werden immer gemeinsam gesetzt (both-or-neither).
pub async fn bezug_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    nachricht_id: i64,
    typ: BezugTyp,
    ziel_id: i64,
) -> Result<ChatNachrichtAnzeige, AppError> {
    // Existenz + nicht gelöscht (analog Heraufstufen-Guard).
    let geloescht: Option<String> =
        sqlx::query_scalar("SELECT geloescht_at FROM chat_nachricht WHERE id = ?")
            .bind(nachricht_id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound)?;
    if geloescht.is_some() {
        return Err(AppError::Conflict(
            "Gelöschte Nachricht kann keinen Bezug erhalten".into(),
        ));
    }

    if !ziel_gehoert_zu_einsatz(pool, einsatz_id, typ, ziel_id).await? {
        return Err(AppError::Validation(
            "Bezug-Ziel existiert nicht in diesem Einsatz".into(),
        ));
    }

    sqlx::query("UPDATE chat_nachricht SET bezug_typ = ?, bezug_id = ? WHERE id = ?")
        .bind(typ.as_str())
        .bind(ziel_id)
        .bind(nachricht_id)
        .execute(pool)
        .await?;
    laden(pool, nachricht_id).await
}

/// Löst den Sachbezug einer Nachricht (LFH-103); setzt `bezug_typ` und `bezug_id`
/// gemeinsam auf NULL (both-or-neither). Idempotent.
pub async fn bezug_loesen(
    pool: &SqlitePool,
    nachricht_id: i64,
) -> Result<ChatNachrichtAnzeige, AppError> {
    sqlx::query("UPDATE chat_nachricht SET bezug_typ = NULL, bezug_id = NULL WHERE id = ?")
        .bind(nachricht_id)
        .execute(pool)
        .await?;
    laden(pool, nachricht_id).await
}

/// Stuft eine Chat-Nachricht zu einem ETB-Eintrag herauf — transaktional nach dem
/// Muster von `lagebericht::freigeben`: legt den ETB-Eintrag an und setzt den
/// Rückverweis `chat_nachricht.etb_eintrag_id` im selben Commit. Der ETB-Eintrag
/// ist ein Snapshot (Text + Ereigniszeit der Nachricht); spätere Bearbeitungen der
/// Nachricht wirken nicht zurück. Doppel-Heraufstufung → `Conflict`.
///
/// `etb_typ`, `inhalt` und `ereigniszeit` sind bereits vom Handler validiert/normalisiert.
/// Liefert die neue ETB-`id`.
pub async fn heraufstufen_zu_etb(
    pool: &SqlitePool,
    einsatz_id: i64,
    nachricht_id: i64,
    heraufstufer_id: i64,
    etb_typ: &str,
    inhalt: &str,
    ereigniszeit: &str,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;

    // Guard: schon heraufgestuft oder gelöscht? (Sperrt Doppel-Heraufstufung.)
    let zustand: Option<(Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT etb_eintrag_id, geloescht_at FROM chat_nachricht WHERE id = ?",
    )
    .bind(nachricht_id)
    .fetch_optional(&mut *tx)
    .await?;
    let (etb_vorhanden, geloescht) = zustand.ok_or(AppError::NotFound)?;
    if etb_vorhanden.is_some() {
        return Err(AppError::Conflict("Nachricht ist bereits heraufgestuft".into()));
    }
    if geloescht.is_some() {
        return Err(AppError::Conflict("Gelöschte Nachricht kann nicht heraufgestuft werden".into()));
    }

    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        heraufstufer_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: etb_typ,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(ereigniszeit),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;

    sqlx::query("UPDATE chat_nachricht SET etb_eintrag_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(nachricht_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(etb_id)
}

/// Stuft eine Chat-Nachricht zu einem Auftrag herauf (LFH-101) — in EINEM Commit:
/// legt den Auftrag inkl. seiner ETB-Anordnung an (`auftrag::repo::anlegen_tx`,
/// Pattern B) und setzt den Rückverweis `chat_nachricht.auftrag_id`. Die Heraufstufung
/// zu Auftrag ist unabhängig von der ETB-Heraufstufung — eine Nachricht darf beides
/// tragen. Erneute Auftrag-Heraufstufung oder eine gelöschte Nachricht → `Conflict`.
/// `daten` ist bereits vom Handler validiert (Auftragstext + >=1 Empfänger,
/// Slots/Zugehörigkeit geprüft). Liefert die neue `auftrag_id`.
pub async fn heraufstufen_zu_auftrag(
    pool: &SqlitePool,
    einsatz_id: i64,
    nachricht_id: i64,
    heraufstufer_id: i64,
    daten: crate::auftrag::repo::AuftragDaten<'_>,
) -> Result<i64, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einst = crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;
    let mut tx = pool.begin().await?;

    // Guard: schon zu einem Auftrag heraufgestuft oder gelöscht? (Sperrt Doppel-Heraufstufung.)
    let zustand: Option<(Option<i64>, Option<String>)> =
        sqlx::query_as("SELECT auftrag_id, geloescht_at FROM chat_nachricht WHERE id = ?")
            .bind(nachricht_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (auftrag_vorhanden, geloescht) = zustand.ok_or(AppError::NotFound)?;
    if auftrag_vorhanden.is_some() {
        return Err(AppError::Conflict("Nachricht ist bereits zu einem Auftrag heraufgestuft".into()));
    }
    if geloescht.is_some() {
        return Err(AppError::Conflict("Gelöschte Nachricht kann nicht heraufgestuft werden".into()));
    }

    let auftrag_id = crate::auftrag::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        heraufstufer_id,
        einst.auftrag_startwert(),
        einst.etb_startwert(),
        crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst),
        &daten,
    )
    .await?;

    sqlx::query("UPDATE chat_nachricht SET auftrag_id = ? WHERE id = ?")
        .bind(auftrag_id)
        .bind(nachricht_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(auftrag_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn kanal(pool: &SqlitePool, einsatz: i64, benutzer: i64) -> i64 {
        kanal_anlegen(pool, einsatz, benutzer, "K", None).await.unwrap().id
    }

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

    #[tokio::test]
    async fn liste_kanaele_legt_default_an() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 1);
        assert_eq!(kanaele[0].name, DEFAULT_KANAL_NAME);

        // Idempotent: ein zweiter Aufruf legt keinen weiteren Default an.
        let nochmal = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(nochmal.len(), 1);
    }

    #[tokio::test]
    async fn kanal_anlegen_erscheint_in_liste() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        liste_kanaele(&pool, einsatz, benutzer).await.unwrap(); // Default sicherstellen

        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "S2/S3", Some("Lagebild")).await.unwrap();
        assert_eq!(kanal.name, "S2/S3");
        assert_eq!(kanal.beschreibung.as_deref(), Some("Lagebild"));

        let kanaele = liste_kanaele(&pool, einsatz, benutzer).await.unwrap();
        assert_eq!(kanaele.len(), 2);
    }

    #[tokio::test]
    async fn gehoert_kanal_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kanal = kanal_anlegen(&pool, einsatz, benutzer, "K", None).await.unwrap();

        assert!(gehoert_kanal_zu_einsatz(&pool, kanal.id, einsatz).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, kanal.id, 999).await.unwrap());
        assert!(!gehoert_kanal_zu_einsatz(&pool, 12345, einsatz).await.unwrap());
    }

    #[tokio::test]
    async fn anlegen_und_abfrage_neueste_zuerst() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;

        let m1 = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Hallo" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Welt" }).await.unwrap();

        assert_eq!(m1.inhalt.as_deref(), Some("Hallo"));
        assert_eq!(m1.autor_name, "Leitung");

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: kid, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].inhalt.as_deref(), Some("Welt"), "neueste zuerst");
    }

    #[tokio::test]
    async fn abfrage_cursor_blaettert_zu_aelteren() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        for i in 1..=3 {
            anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: &format!("m{i}") }).await.unwrap();
        }

        let f = NachrichtFilter { kanal_id: kid, before_id: None, limit: 1 };
        let seite1 = abfrage(&pool, einsatz, &f).await.unwrap();
        assert_eq!(seite1[0].inhalt.as_deref(), Some("m3"));

        let f2 = NachrichtFilter { kanal_id: kid, before_id: Some(seite1[0].id), limit: 1 };
        let seite2 = abfrage(&pool, einsatz, &f2).await.unwrap();
        assert_eq!(seite2[0].inhalt.as_deref(), Some("m2"));
    }

    #[tokio::test]
    async fn abfrage_nur_des_kanals() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let k1 = kanal(&pool, einsatz, benutzer).await;
        let k2 = kanal(&pool, einsatz, benutzer).await;
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k1, inhalt: "in k1" }).await.unwrap();
        anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: k2, inhalt: "in k2" }).await.unwrap();

        let liste = abfrage(&pool, einsatz, &NachrichtFilter { kanal_id: k1, before_id: None, limit: STANDARD_LIMIT }).await.unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].inhalt.as_deref(), Some("in k1"));
    }

    #[tokio::test]
    async fn gehoert_nachricht_zu_einsatz_prueft_zugehoerigkeit() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert!(gehoert_nachricht_zu_einsatz(&pool, m.id, einsatz).await.unwrap());
        assert!(!gehoert_nachricht_zu_einsatz(&pool, m.id, 999).await.unwrap());
    }

    #[tokio::test]
    async fn autor_von_liefert_autor_id() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();

        assert_eq!(autor_von(&pool, m.id).await.unwrap(), Some(benutzer));
        assert_eq!(autor_von(&pool, 999).await.unwrap(), None);
    }

    #[tokio::test]
    async fn bearbeiten_setzt_inhalt_und_bearbeitet_at() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "alt" }).await.unwrap();
        assert_eq!(m.bearbeitet_at, None);

        let bearbeitet = bearbeiten(&pool, m.id, "neu").await.unwrap();
        assert_eq!(bearbeitet.inhalt.as_deref(), Some("neu"));
        assert!(bearbeitet.bearbeitet_at.is_some());
    }

    #[tokio::test]
    async fn loeschen_setzt_tombstone() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "geheim" }).await.unwrap();

        loeschen(&pool, m.id).await.unwrap();
        let nachher = laden(&pool, m.id).await.unwrap();
        assert!(nachher.geloescht_at.is_some());
        assert_eq!(nachher.inhalt, None, "Inhalt gelöschter Nachrichten wird nicht ausgeliefert");
    }

    #[tokio::test]
    async fn heraufstufen_legt_etb_an_und_setzt_rueckverweis() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Deich instabil" }).await.unwrap();

        let etb_id = heraufstufen_zu_etb(
            &pool, einsatz, m.id, benutzer, "meldung", "Deich instabil", &m.erstellt_at,
        ).await.unwrap();

        // ETB-Eintrag existiert mit dem Text und der Ereigniszeit der Nachricht (Snapshot).
        let etb = crate::etb::repo::laden(&pool, etb_id).await.unwrap();
        assert_eq!(etb.typ, "meldung");
        assert_eq!(etb.inhalt, "Deich instabil");
        assert_eq!(etb.ereigniszeit, m.erstellt_at);

        // Rückverweis an der Nachricht ist gesetzt.
        let nachher = laden(&pool, m.id).await.unwrap();
        assert_eq!(nachher.etb_eintrag_id, Some(etb_id));
    }

    #[tokio::test]
    async fn heraufstufen_doppelt_ist_konflikt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();
        heraufstufen_zu_etb(&pool, einsatz, m.id, benutzer, "meldung", "x", &m.erstellt_at).await.unwrap();

        let zweimal = heraufstufen_zu_etb(&pool, einsatz, m.id, benutzer, "meldung", "x", &m.erstellt_at).await;
        assert!(matches!(zweimal.unwrap_err(), AppError::Conflict(_)));
    }

    /// Baut minimale, valide Auftragsdaten (ein Funktions-Empfänger, keine DB-Lookups nötig).
    fn auftrag_daten(text: &str) -> crate::auftrag::repo::AuftragDaten<'_> {
        crate::auftrag::repo::AuftragDaten {
            auftrag_text: text,
            absicht: None,
            lage: None,
            ort: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            prioritaet: "normal",
            richtung: "intern",
            frist_at: None,
            erteilt_at: "2026-06-12 10:00:00",
            empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                empfaenger_typ: "funktion".into(),
                abschnitt_id: None,
                einheit_id: None,
                person_id: None,
                fahrzeug_id: None,
                funktion_text: Some("S4".into()),
                extern_kategorie: None,
                extern_bezeichnung: None,
            }],
        }
    }

    #[tokio::test]
    async fn heraufstufen_zu_auftrag_legt_auftrag_an_und_setzt_rueckverweis() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "Tank fordern" }).await.unwrap();

        let auftrag_id = heraufstufen_zu_auftrag(
            &pool, einsatz, m.id, benutzer, auftrag_daten("Tank fordern"),
        ).await.unwrap();

        // Auftrag landet im Auftrag-Modul, ETB-Anordnung entsteht im selben Commit (Pattern B).
        let detail = crate::auftrag::repo::laden(&pool, auftrag_id, "2026-06-12 10:00:00").await.unwrap();
        assert_eq!(detail.auftrag.auftrag_text, "Tank fordern");
        assert!(detail.auftrag.etb_anordnung_id.is_some(), "ETB-Anordnung im selben Commit erzeugt");
        assert_eq!(detail.empfaenger.len(), 1);

        // Rückverweis an der Nachricht ist gesetzt (Markierung „heraufgestuft zu Auftrag").
        let nachher = laden(&pool, m.id).await.unwrap();
        assert_eq!(nachher.auftrag_id, Some(auftrag_id));
    }

    #[tokio::test]
    async fn heraufstufen_zu_auftrag_doppelt_ist_konflikt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();
        heraufstufen_zu_auftrag(&pool, einsatz, m.id, benutzer, auftrag_daten("x")).await.unwrap();

        let zweimal = heraufstufen_zu_auftrag(&pool, einsatz, m.id, benutzer, auftrag_daten("x")).await;
        assert!(matches!(zweimal.unwrap_err(), AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn heraufstufen_zu_auftrag_geloescht_ist_konflikt() {
        let pool = crate::db::test_pool().await;
        let (benutzer, einsatz) = setup(&pool).await;
        let kid = kanal(&pool, einsatz, benutzer).await;
        let m = anlegen(&pool, einsatz, benutzer, NachrichtDaten { kanal_id: kid, inhalt: "x" }).await.unwrap();
        loeschen(&pool, m.id).await.unwrap();

        let ergebnis = heraufstufen_zu_auftrag(&pool, einsatz, m.id, benutzer, auftrag_daten("x")).await;
        assert!(matches!(ergebnis.unwrap_err(), AppError::Conflict(_)));
    }
}

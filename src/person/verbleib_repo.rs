use crate::error::AppError;
use crate::geraet::bestaetigung::Bestaetigung;
use crate::person::{verbleib_kurzform, TransportDurch, VerbleibArt, VerbleibStatus};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{HashMap, HashSet};
use utoipa::ToSchema;

/// Ein Verbleib-Ereignis (1:1 zu `person_verbleib`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct VerbleibAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub art: VerbleibArt,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<VerbleibStatus>,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
    /// Betreuungsstelle eines Notunterkunft-Verbleibs (LFH-674). Nur die Kennung: den Namen
    /// liest, wer das Modul Betreuung sehen darf, aus dessen Übersicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betreuungsstelle_id: Option<i64>,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Name der bestätigenden Person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bestaetigt_name: Option<String>,
    /// Wann der Eintrag beim Server ankam (LLH-1138); `zeitpunkt_at` ist die Erfassungszeit.
    /// Fehlt bei Einträgen von vor der Migration 0217.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eingegangen_at: Option<String>,
    /// Wer fährt (LLH-1332), nur bei `transport`; fehlt im Bestand (gilt als fremd).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_durch: Option<TransportDurch>,
    /// Disposition des Fahrzeugs eines Eigentransports (LLH-1332).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_fahrzeug_id: Option<i64>,
}

/// Eingabedaten beim Erfassen; Strings bereits getrimmt (Handler). `art`/`status`
/// sind bereits validiert (Handler via `VerbleibArt`).
#[derive(Debug, Default)]
pub struct VerbleibDaten<'a> {
    pub art: &'a str,
    pub transportmittel: Option<&'a str>,
    pub ziel: Option<&'a str>,
    pub status: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// Nur bei `notunterkunft`; Art, Rechte und Einsatzzugehörigkeit prüft der Handler.
    pub betreuungsstelle_id: Option<i64>,
    /// Bereits über [`crate::geraet::bestaetigung::aufloesen`] geprüft (LFH-1046).
    pub bestaetigung: Option<&'a Bestaetigung>,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt; `None` = jetzt.
    pub zeitpunkt_at: Option<&'a str>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    pub client_id: Option<&'a str>,
    /// Wer fährt (LLH-1332); Paarung mit Art und Fahrzeug prüft der Handler.
    pub transport_durch: Option<&'a str>,
    /// Disposition eines Eigentransports, bereits auf Einsatz und Erfassungszeit geprüft.
    pub einsatz_fahrzeug_id: Option<i64>,
}

const SELECT_VERBLEIB: &str = "\
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
           zeitpunkt_at, erfasst_von, betreuungsstelle_id, bestaetigt_name, eingegangen_at, \
           transport_durch, einsatz_fahrzeug_id \
    FROM person_verbleib";

/// „Aktuell“ (Spec `personen-verlauf`, design.md D6): der Verbleib mit dem jüngsten
/// Erfassungszeitpunkt, bei Gleichstand der später gespeicherte. Die einzige Stelle, die das für
/// den Verbleib definiert: Cache und Verlauf lesen dieselbe Ordnung. Sie löst den Kopfkommentar
/// von `migrations/0022_einsatz_person_med_cache.sql` ab (siehe `sichtung_repo::sichtungsfolge!`).
macro_rules! verbleibfolge {
    () => {
        "ORDER BY zeitpunkt_at DESC, id DESC"
    };
}

/// Ergebnis einer Erfassung: die Kennung des Ereignisses und ob es der aktuelle Verbleib ist.
/// Ein nachgereichtes älteres gewinnt nicht; der Auto-Austritt unterbleibt dann.
#[derive(Debug, Clone, Copy)]
pub struct ErfassterVerbleib {
    pub id: i64,
    pub gewinnt: bool,
}

/// Erfasst ein Verbleib-Ereignis append-only und bestimmt in DERSELBEN Transaktion den
/// Verbleib-Cache an der Person neu aus dem jüngsten Ereignis: die Kurzform
/// `aktueller_verbleib`, Art, Ziel, Status und den Verweis auf die Betreuungsstelle. Der Cache
/// spiegelt also genau das, was `liste_je_person` zuoberst liefert.
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    daten: VerbleibDaten<'_>,
    erfasst_von: i64,
) -> Result<VerbleibAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let erfasst = erfassen_tx(&mut tx, einsatz_id, person_id, daten, erfasst_von).await?;
    tx.commit().await?;
    laden(pool, einsatz_id, erfasst.id).await
}

/// [`erfassen`] in einer laufenden Transaktion, etwa bei der Aufnahme an einer Betreuungsstelle
/// (LFH-1041) oder samt Auto-Austritt (LLH-1138).
pub async fn erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    daten: VerbleibDaten<'_>,
    erfasst_von: i64,
) -> Result<ErfassterVerbleib, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verbleib \
            (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, erfasst_von, \
             betreuungsstelle_id, bestaetigt_personal_id, bestaetigt_name, zeitpunkt_at, \
             eingegangen_at, client_id, transport_durch, einsatz_fahrzeug_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \
                 COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now')), \
                 strftime('%Y-%m-%d %H:%M:%S','now'), ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(daten.art)
    .bind(daten.transportmittel)
    .bind(daten.ziel)
    .bind(daten.status)
    .bind(daten.notiz)
    .bind(erfasst_von)
    .bind(daten.betreuungsstelle_id)
    .bind(daten.bestaetigung.map(|b| b.personal_id))
    .bind(daten.bestaetigung.map(|b| b.name.as_str()))
    .bind(daten.zeitpunkt_at)
    .bind(daten.client_id)
    .bind(daten.transport_durch)
    .bind(daten.einsatz_fahrzeug_id)
    .fetch_one(&mut *conn)
    .await?;
    // Der Cache folgt dem jüngsten Ereignis (D6), nicht der Einfügung; die Kurzform wird aus der
    // gewinnenden Zeile berechnet.
    type Juengste = (
        i64,
        VerbleibArt,
        Option<String>,
        Option<VerbleibStatus>,
        Option<i64>,
        Option<TransportDurch>,
        Option<i64>,
        Option<String>,
    );
    let (juengste, art, ziel, status, stelle, durch, fahrzeug, transportmittel): Juengste =
        sqlx::query_as(concat!(
        "SELECT id, art, ziel, status, betreuungsstelle_id, transport_durch, einsatz_fahrzeug_id, \
                transportmittel FROM person_verbleib \
         WHERE einsatz_id = ? AND person_id = ? ",
        verbleibfolge!(),
        " LIMIT 1"
    ))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_one(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE einsatz_person SET aktueller_verbleib = ?1, aktuelle_verbleib_art = ?2, \
            aktuelles_verbleib_ziel = ?3, aktueller_verbleib_status = ?4, \
            aktuelle_verbleib_betreuungsstelle_id = ?5, aktueller_transport_durch = ?8, \
            aktuelles_einsatz_fahrzeug_id = ?9 \
         WHERE id = ?6 AND einsatz_id = ?7",
    )
    .bind(verbleib_kurzform(
        art,
        ziel.as_deref(),
        status,
        durch,
        transportmittel.as_deref(),
    ))
    .bind(art.as_str())
    .bind(ziel.as_deref())
    .bind(status.map(|s| s.as_str()))
    .bind(stelle)
    .bind(person_id)
    .bind(einsatz_id)
    .bind(durch.map(|d| d.as_str()))
    .bind(fahrzeug)
    .execute(&mut *conn)
    .await?;
    Ok(ErfassterVerbleib {
        id,
        gewinnt: juengste == id,
    })
}

/// Das schon gespeicherte Verbleib-Ereignis zu einer `client_id` im Einsatz (Replay).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<VerbleibAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Wie [`laden`], auf einer offenen Verbindung (In-Tx-Reload).
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<VerbleibAnzeige, AppError> {
    sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_VERBLEIB} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Lädt ein Verbleib-Ereignis; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<VerbleibAnzeige, AppError> {
    sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_VERBLEIB} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Ein Fahrzeug aus dem Einsatz für den Eigentransport (LLH-1332, design.md D4). Nur, was die
/// Verbleib-Maske braucht: kein Kennzeichen, keine Besatzung, keine Position.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct EinsatzTransportfahrzeug {
    pub einsatz_fahrzeug_id: i64,
    pub funkrufname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fahrzeugtyp: Option<String>,
}

/// Vorschläge zum Rettungsmittel einer Verbleib-Erfassung (LLH-1332, Spec
/// `patienten-uebergabe`, „Vorschläge für das Rettungsmittel“): Fahrzeuge im Einsatz (Wahl heißt
/// Eigentransport), bisher eingetragene fremde Rettungsmittel des Einsatzes (häufigste zuerst)
/// und Funkrufnamen des Fahrzeugstamms, die gerade nicht im Einsatz stehen.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TransportmittelAuswahl {
    pub im_einsatz: Vec<EinsatzTransportfahrzeug>,
    pub bisher: Vec<String>,
    pub stamm: Vec<String>,
}

/// Liest die [`TransportmittelAuswahl`] eines Einsatzes. Geschwärzte Verbleibe tragen kein
/// `transportmittel` mehr und fallen so von selbst heraus; Dubletten über die Gruppen hinweg
/// nennt nur die erste Gruppe. `sichtbar` ist die Stellenbindung des Geräts
/// (`geraet::stelle::sichtbare_personen`): ein gebundenes Gerät bekommt die Freitexte nur aus den
/// Verbleiben seiner eigenen Personen. Der Fahrzeugstamm nennt nur Fahrzeuge im Dienst.
pub async fn transportmittel_auswahl(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    sichtbar: Option<&HashSet<i64>>,
) -> Result<TransportmittelAuswahl, AppError> {
    let im_einsatz: Vec<EinsatzTransportfahrzeug> = sqlx::query_as(
        "SELECT ef.id AS einsatz_fahrzeug_id, \
                COALESCE(f.funkrufname, ef.snap_funkrufname) AS funkrufname, \
                COALESCE(f.fahrzeugtyp, ef.snap_fahrzeugtyp) AS fahrzeugtyp \
         FROM einsatz_fahrzeug ef LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.einsatz_id = ? AND ef.beendet_at IS NULL \
         ORDER BY 2 COLLATE NOCASE, ef.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let zeilen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT person_id, TRIM(transportmittel) FROM person_verbleib \
         WHERE einsatz_id = ? AND art = 'transport' \
           AND (transport_durch IS NULL OR transport_durch = 'fremd') \
           AND TRIM(COALESCE(transportmittel, '')) <> ''",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    // Häufigste zuerst, bei Gleichstand nach Namen ohne Groß und Klein.
    let mut haeufigkeit: HashMap<String, usize> = HashMap::new();
    for (person_id, text) in zeilen {
        if sichtbar.is_none_or(|s| s.contains(&person_id)) {
            *haeufigkeit.entry(text).or_default() += 1;
        }
    }
    let mut bisher: Vec<(String, usize)> = haeufigkeit.into_iter().collect();
    bisher.sort_by(|(a, na), (b, nb)| {
        nb.cmp(na)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
            .then_with(|| a.cmp(b))
    });
    let bisher: Vec<String> = bisher.into_iter().map(|(t, _)| t).collect();
    let stamm: Vec<String> = sqlx::query_scalar(
        "SELECT f.funkrufname FROM fahrzeug f \
         WHERE f.org_id = ? AND f.dienststatus = 'in_dienst' AND NOT EXISTS ( \
             SELECT 1 FROM einsatz_fahrzeug ef \
             WHERE ef.einsatz_id = ? AND ef.fahrzeug_id = f.id AND ef.beendet_at IS NULL) \
         ORDER BY f.funkrufname COLLATE NOCASE",
    )
    .bind(org_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let schluessel = |t: &str| t.trim().to_lowercase();
    let mut gesehen: HashSet<String> = im_einsatz
        .iter()
        .map(|f| schluessel(&f.funkrufname))
        .collect();
    let bisher: Vec<String> = bisher
        .into_iter()
        .filter(|t| gesehen.insert(schluessel(t)))
        .collect();
    let stamm: Vec<String> = stamm
        .into_iter()
        .filter(|t| gesehen.insert(schluessel(t)))
        .collect();
    Ok(TransportmittelAuswahl {
        im_einsatz,
        bisher,
        stamm,
    })
}

/// Der aktuelle Verbleib einer Person (Ordnung `verbleibfolge!`), `None` ohne Verbleib.
pub async fn aktueller(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Option<VerbleibAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND person_id = ? {} LIMIT 1",
            verbleibfolge!()
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_optional(pool)
        .await?,
    )
}

/// Verbleib-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<VerbleibAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND person_id = ? {}",
            verbleibfolge!()
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
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
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e, p)
    }

    fn daten<'a>(art: &'a str, ziel: Option<&'a str>) -> VerbleibDaten<'a> {
        VerbleibDaten {
            art,
            ziel,
            ..VerbleibDaten::default()
        }
    }

    async fn stelle_anlegen(pool: &SqlitePool, e: i64, b: i64, bezeichnung: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, ?, 'notunterkunft', ?) RETURNING id",
        )
        .bind(e)
        .bind(bezeichnung)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Der Verweis auf die Betreuungsstelle geht ins Ereignis UND in den Cache; ein späterer
    /// Verbleib ohne Verweis leert den Cache, der Verlauf behält ihn.
    #[tokio::test]
    async fn erfassen_pflegt_verweis_auf_betreuungsstelle() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let stelle = stelle_anlegen(&pool, e, b, "NU Turnhalle Nord").await;
        let cache = |pool: SqlitePool| async move {
            sqlx::query_scalar::<_, Option<i64>>(
                "SELECT aktuelle_verbleib_betreuungsstelle_id FROM einsatz_person WHERE id = ?",
            )
            .bind(p)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        let erstes = erfassen(
            &pool,
            e,
            p,
            VerbleibDaten {
                betreuungsstelle_id: Some(stelle),
                bestaetigung: None,
                ..daten("notunterkunft", Some("NU Turnhalle Nord"))
            },
            b,
        )
        .await
        .unwrap();
        assert_eq!(erstes.betreuungsstelle_id, Some(stelle));
        assert_eq!(cache(pool.clone()).await, Some(stelle));

        erfassen(&pool, e, p, daten("entlassung", None), b)
            .await
            .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            None,
            "Verweis bleibt nicht stehen"
        );
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf[0].betreuungsstelle_id, None);
        assert_eq!(
            verlauf[1].betreuungsstelle_id,
            Some(stelle),
            "Verlauf behält den Verweis"
        );
    }

    /// Ohne Verweis fehlt das Feld in der Anzeige, statt `null` zu tragen.
    #[tokio::test]
    async fn anzeige_ohne_verweis_laesst_feld_weg() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let v = erfassen(&pool, e, p, daten("vor_ort", None), b)
            .await
            .unwrap();
        let json = serde_json::to_value(&v).unwrap();
        assert!(!json
            .as_object()
            .unwrap()
            .contains_key("betreuungsstelle_id"));
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengsten() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, daten("vor_ort", None), b)
            .await
            .unwrap();
        erfassen(&pool, e, p, daten("transport", Some("KH Mitte")), b)
            .await
            .unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "append-only");
        assert_eq!(verlauf[0].art, VerbleibArt::Transport, "neueste zuerst");
        let cache: Option<String> =
            sqlx::query_scalar("SELECT aktueller_verbleib FROM einsatz_person WHERE id = ?")
                .bind(p)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cache.as_deref(), Some("Transport → KH Mitte"));
    }

    /// Art, Ziel und Status gehen als eigene Cache-Spalten mit, und ein späteres Ereignis ohne
    /// Ziel/Status leert sie.
    #[tokio::test]
    async fn erfassen_pflegt_art_ziel_und_status_im_cache() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let cache = |pool: SqlitePool| async move {
            sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>)>(
                "SELECT aktuelle_verbleib_art, aktuelles_verbleib_ziel, aktueller_verbleib_status \
                 FROM einsatz_person WHERE id = ?",
            )
            .bind(p)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        erfassen(
            &pool,
            e,
            p,
            VerbleibDaten {
                status: Some("angemeldet"),
                ..daten("transport", Some("KH Mitte"))
            },
            b,
        )
        .await
        .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            (
                Some("transport".into()),
                Some("KH Mitte".into()),
                Some("angemeldet".into())
            )
        );
        erfassen(&pool, e, p, daten("notunterkunft", None), b)
            .await
            .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            (Some("notunterkunft".into()), None, None),
            "Ziel und Status des Vorgängers bleiben nicht stehen"
        );
    }
}

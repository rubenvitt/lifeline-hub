use super::{belegung_repo, darf_uebergehen, BrAnzeige, BrListenEintrag};
use crate::error::AppError;
use crate::routes::support::pruefe_koordinate;
use sqlx::{SqliteConnection, SqlitePool};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, abschnitt_id, bezeichnung, standort, notiz, status, \
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at, lat, lon \
    FROM bereitstellungsraum";

/// Eingabedaten beim Anlegen (Handler hat `bezeichnung` validiert/getrimmt).
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub bezeichnung: &'a str,
    pub abschnitt_id: Option<i64>,
    pub standort: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// Koordinate (LLH-1107): beide oder keine, sonst 422.
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// Patch-Daten (`None` = unverändert, `Some(None)` = auf NULL setzen). Status wird NICHT
/// über diese Funktion geändert — Status hat eine eigene Route.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub bezeichnung: Option<&'a str>,
    pub abschnitt_id: Option<Option<i64>>, // Some(None) = explizit auf NULL setzen
    pub standort: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
    /// Koordinate (LLH-1107); das wirksame Paar prüft [`update_tx`] gegen den Rohstand.
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
}

/// Zeile der Liste: Raum und Name seines Abschnitts (LLH-1095, design.md D4).
#[derive(Debug, sqlx::FromRow)]
pub struct ListenZeile {
    #[sqlx(flatten)]
    pub br: BrAnzeige,
    pub abschnitt_name: Option<String>,
}

/// BR eines Einsatzes (ohne stornierte), optional gefiltert nach Status und/oder Abschnitt, mit
/// dem Namen des Abschnitts.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    abschnitt_id: Option<i64>,
) -> Result<Vec<ListenZeile>, AppError> {
    Ok(sqlx::query_as::<_, ListenZeile>(
        "SELECT b.id, b.einsatz_id, b.abschnitt_id, b.bezeichnung, b.standort, b.notiz, \
                b.status, b.erfasst_at, b.erfasst_von, b.geaendert_at, b.geaendert_von, \
                b.storniert_at, b.lat, b.lon, a.name AS abschnitt_name \
         FROM bereitstellungsraum b \
         LEFT JOIN einsatzabschnitt a ON a.id = b.abschnitt_id \
         WHERE b.einsatz_id = ?1 AND b.storniert_at IS NULL \
           AND (?2 IS NULL OR b.status = ?2) \
           AND (?3 IS NULL OR b.abschnitt_id = ?3) \
         ORDER BY b.bezeichnung",
    )
    .bind(einsatz_id)
    .bind(status)
    .bind(abschnitt_id)
    .fetch_all(pool)
    .await?)
}

/// Filter der Liste: Status und Abschnitt, beide optional.
#[derive(Debug, Default, Clone, Copy)]
pub struct ListenFilter<'a> {
    pub status: Option<&'a str>,
    pub abschnitt_id: Option<i64>,
}

/// Die Räume eines Einsatzes (ohne stornierte) als Listeneinträge: Raum, Abschnittsname,
/// Kennzahlen der Belegung und die Einheiten im Raum (LLH-1095). Eine feste Zahl Abfragen für alle
/// Räume. Die Liste der Route und der Lage-Snapshot lesen sie hier (LLH-1107, design.md D10); die
/// Stellenbindung eines Geräts filtert die Route danach.
pub async fn list_eintraege(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: ListenFilter<'_>,
) -> Result<Vec<BrListenEintrag>, AppError> {
    let zeilen = liste(pool, einsatz_id, filter.status, filter.abschnitt_id).await?;
    let mut kennzahlen = belegung_repo::kennzahlen_je_raum(pool, einsatz_id, None).await?;
    let einheiten: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT aktueller_br_id, id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aktueller_br_id IS NOT NULL AND aufgeloest_at IS NULL \
         ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|z| BrListenEintrag {
            belegung: kennzahlen.remove(&z.br.id).unwrap_or_default(),
            einheit_ids: einheiten
                .iter()
                .filter(|(raum, _)| *raum == z.br.id)
                .map(|(_, id)| *id)
                .collect(),
            abschnitt_name: z.abschnitt_name,
            br: z.br,
        })
        .collect())
}

/// Lädt einen BR (auch stornierte) eines Einsatzes; `NotFound`, falls er nicht
/// zum Einsatz gehört (Org-Isolation via `einsatz_id`-Prädikat).
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<BrAnzeige, AppError> {
    sqlx::query_as::<_, BrAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (für den In-Tx-Reload
/// beim atomaren Status-Wechsel — liefert die frische Anzeige für die Response in
/// derselben Tx). `NotFound`, falls nicht zum Einsatz.
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<BrAnzeige, AppError> {
    sqlx::query_as::<_, BrAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt einen BR im Status `geplant` an. UNIQUE(einsatz_id, bezeichnung) →
/// `Conflict` (409) bei Duplikat.
///
/// Pool-Hülle um [`create_tx`]: wie bisher ohne eigene Transaktion, Insert und Rücklesen
/// laufen im Autocommit einer geliehenen Verbindung.
pub async fn create(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: NeueDaten<'_>,
) -> Result<BrAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    create_tx(&mut conn, einsatz_id, erfasser_id, &daten).await
}

/// Legt einen BR auf einer offenen Verbindung/Transaktion an und lädt ihn dort zurück
/// (LFH-690, Demo-Import in EINER Transaktion). Öffnet und committet selbst nichts.
/// UNIQUE(einsatz_id, bezeichnung) → `Conflict` (409) wie in der Pool-Hülle.
/// Ein Abschnitt eines anderen Einsatzes → `NotFound` (404, LFH-735). Ein halbes
/// Koordinatenpaar oder ein Wert außerhalb des Bereichs → 422 (LLH-1107).
pub async fn create_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    daten: &NeueDaten<'_>,
) -> Result<BrAnzeige, AppError> {
    pruefe_koordinate(daten.lat, daten.lon, "lat", "lon")?;
    if let Some(abschnitt) = daten.abschnitt_id {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, abschnitt).await?;
    }
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO bereitstellungsraum \
            (einsatz_id, abschnitt_id, bezeichnung, standort, notiz, lat, lon, \
             erfasst_von, geaendert_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.abschnitt_id)
    .bind(daten.bezeichnung)
    .bind(daten.standort)
    .bind(daten.notiz)
    .bind(daten.lat)
    .bind(daten.lon)
    .bind(erfasser_id)
    .bind(erfasser_id)
    .fetch_one(&mut *conn)
    .await;
    let id = match ergebnis {
        Ok(id) => id,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict(
                "Ein Bereitstellungsraum mit dieser Bezeichnung existiert bereits in diesem Einsatz"
                    .into(),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    laden_tx(conn, einsatz_id, id).await
}

/// Aktualisiert BR-Stammfelder und Koordinate (NICHT Status) in der offenen Schreibtransaktion
/// des Aufrufers (`write_retry!`). `Some(None)` setzt ein Feld explizit auf NULL (z. B. Standort
/// löschen); `None` lässt unverändert. Fremd oder unbekannt → `NotFound`, storniert → `Conflict`
/// (409), ein Abschnitt eines anderen Einsatzes → `NotFound` (404, LFH-735).
///
/// Koordinate (LLH-1107, design.md D1): das wirksame Paar entsteht aus Eingabe und Rohstand
/// DIESER Transaktion und wird vor dem UPDATE geprüft (halbes Paar oder Bereich → 422); so
/// zerreißen zwei gleichzeitige Teiländerungen (nur `lat`, nur `lon`) das Paar nicht.
pub async fn update_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
    daten: &PatchDaten<'_>,
) -> Result<BrAnzeige, AppError> {
    let roh = laden_tx(conn, einsatz_id, id).await?;
    if roh.storniert_at.is_some() {
        return Err(AppError::Conflict(
            "Stornierter BR kann nicht geändert werden".into(),
        ));
    }
    let lat = daten.lat.unwrap_or(roh.lat);
    let lon = daten.lon.unwrap_or(roh.lon);
    pruefe_koordinate(lat, lon, "lat", "lon")?;
    if let Some(Some(abschnitt)) = daten.abschnitt_id {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, abschnitt).await?;
    }
    let ergebnis = sqlx::query(
        "UPDATE bereitstellungsraum \
         SET bezeichnung = COALESCE(?1, bezeichnung), \
             abschnitt_id = CASE WHEN ?2 IS NULL THEN abschnitt_id ELSE ?3 END, \
             standort = CASE WHEN ?4 IS NULL THEN standort ELSE ?5 END, \
             notiz = CASE WHEN ?6 IS NULL THEN notiz ELSE ?7 END, \
             lat = ?8, lon = ?9, \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
             geaendert_von = ?10 \
         WHERE id = ?11 AND einsatz_id = ?12",
    )
    .bind(daten.bezeichnung)
    .bind(daten.abschnitt_id.map(|_| 1_i64))
    .bind(daten.abschnitt_id.and_then(|v| v))
    .bind(daten.standort.map(|_| 1_i64))
    .bind(daten.standort.and_then(|v| v))
    .bind(daten.notiz.map(|_| 1_i64))
    .bind(daten.notiz.and_then(|v| v))
    .bind(lat)
    .bind(lon)
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await;
    match ergebnis {
        Ok(_) => laden_tx(conn, einsatz_id, id).await,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => Err(AppError::Conflict(
            "Ein Bereitstellungsraum mit dieser Bezeichnung existiert bereits in diesem Einsatz"
                .into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/// Setzt einen neuen Status INNERHALB einer offenen Transaktion (F06/LFH-244 Tier-A:
/// atomar mit dem System-ETB-Eintrag). Prüft Transition via `darf_uebergehen` (422 bei
/// ungültigem Übergang) und die Belegungs-Vorbedingung für `aufgeloest`: blockt mit
/// `Conflict` (409), wenn aktiv belegt (Einheit oder Fahrzeug). Die read-then-write-Kette
/// (Status lesen → prüfen → UPDATE) läuft nun in EINER Tx, statt über mehrere Pool-Griffe.
pub async fn setze_status_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<BrAnzeige, AppError> {
    // Transition validieren (Repo-Ebene, da kein Handler für diesen Task).
    let aktuell: String = sqlx::query_scalar(
        "SELECT status FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;

    if !darf_uebergehen(&aktuell, neuer_status) {
        return Err(AppError::UnprocessableEntity(format!(
            "Status-Übergang '{aktuell}' → '{neuer_status}' ist nicht erlaubt"
        )));
    }

    // Für aufgeloest: aktive Belegung blockt.
    if neuer_status == "aufgeloest" {
        let belegt = aktive_belegungen_tx(conn, id).await?;
        if belegt > 0 {
            return Err(AppError::Conflict(format!(
                "Auflösung nicht möglich — noch {belegt} Einheit(en)/Fahrzeug(e) belegt"
            )));
        }
    }

    sqlx::query(
        "UPDATE bereitstellungsraum SET status = ?, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_status)
    .bind(geaendert_von)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;

    laden_tx(conn, einsatz_id, id).await
}

/// Pool-Wrapper: setzt den Status in einer eigenen Tx (delegiert an [`setze_status_tx`]).
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    neuer_status: &str,
    geaendert_von: i64,
) -> Result<BrAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    setze_status_tx(&mut conn, einsatz_id, id, neuer_status, geaendert_von).await
}

/// Soft-Delete des BR. Blockt mit `Conflict`, wenn aktive Belegung existiert
/// (Einheit oder Fahrzeug). Doppel-Storno → `Conflict`.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    let belegt = aktive_belegungen_tx(&mut conn, id).await?;
    if belegt > 0 {
        return Err(AppError::Conflict(format!(
            "Storno nicht möglich — noch {belegt} Einheit(en)/Fahrzeug(e) belegt"
        )));
    }
    crate::storno::storniere(
        &mut conn,
        "bereitstellungsraum",
        "einsatz_id",
        einsatz_id,
        id,
        crate::storno::Vermerk::Geaendert(geaendert_von),
        Some("BR ist bereits storniert"),
    )
    .await
}

/// Darf Material in diesem Bereitstellungsraum liegen (LLH-1224, design.md D8, gleiche Regel wie
/// `uhs::repo::require_verortbar_tx`)? Fremd, unbekannt oder storniert → `NotFound`, aufgelöst →
/// `UnprocessableEntity` (ein Ort mit Status, 422 wie `belegung_repo`); `geplant` und `aktiv`
/// gehen.
pub async fn require_verortbar_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
) -> Result<(), AppError> {
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM bereitstellungsraum \
         WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(br_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match status.as_deref() {
        None => Err(AppError::NotFound),
        Some("aufgeloest") => Err(AppError::UnprocessableEntity(
            "Bereitstellungsraum ist aufgelöst".into(),
        )),
        Some(_) => Ok(()),
    }
}

/// Anzahl aktiv belegter Einheiten + Fahrzeuge über den denormalisierten Cache,
/// auf einer offenen Connection/Transaktion (damit die `aufgeloest`-Vorbedingung
/// atomar mit dem Status-UPDATE gelesen wird). Prüft sowohl
/// `einsatz_einheit.aktueller_br_id` als auch `einsatz_fahrzeug.aktueller_br_id`
/// (jeweils ein indizierter Scan).
pub async fn aktive_belegungen_tx(
    conn: &mut SqliteConnection,
    br_id: i64,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT \
            (SELECT COUNT(*) FROM einsatz_einheit \
               WHERE aktueller_br_id = ? AND aufgeloest_at IS NULL) + \
            (SELECT COUNT(*) FROM einsatz_fahrzeug \
               WHERE aktueller_br_id = ? AND beendet_at IS NULL)",
    )
    .bind(br_id)
    .bind(br_id)
    .fetch_one(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bereitstellungsraum::BrStatus;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Org(1) + Benutzer + aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn neu<'a>(bez: &'a str) -> NeueDaten<'a> {
        NeueDaten {
            bezeichnung: bez,
            abschnitt_id: None,
            standort: None,
            notiz: None,
            lat: None,
            lon: None,
        }
    }

    // --- Pflicht-Tests aus dem Brief ---

    #[tokio::test]
    async fn anlegen_liefert_geplant() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(
            &pool,
            e,
            b,
            NeueDaten {
                bezeichnung: "BR Nord",
                abschnitt_id: None,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(br.status, BrStatus::Geplant);
    }

    #[tokio::test]
    async fn status_geplant_aktiv_aufgeloest() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(
            &pool,
            e,
            b,
            NeueDaten {
                bezeichnung: "BR 1",
                abschnitt_id: None,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
            },
        )
        .await
        .unwrap();
        let a = setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        assert_eq!(a.status, BrStatus::Aktiv);
    }

    // --- Erweiterte Tests ---

    #[tokio::test]
    async fn anlegen_setzt_zeitstempel_und_benutzer() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Süd")).await.unwrap();
        assert_eq!(br.einsatz_id, e);
        assert_eq!(br.bezeichnung, "BR Süd");
        assert_eq!(br.erfasst_von, b);
        assert_eq!(br.geaendert_von, b);
        assert!(br.storniert_at.is_none());
    }

    #[tokio::test]
    async fn verortbar_nur_geplant_und_aktiv_im_eigenen_einsatz() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let check = |einsatz: i64, br: i64| {
            let pool = pool.clone();
            async move {
                let mut conn = pool.acquire().await.unwrap();
                require_verortbar_tx(&mut conn, einsatz, br).await
            }
        };
        let br = create(&pool, e, b, neu("BR Nord")).await.unwrap();
        check(e, br.id).await.unwrap();
        // Ein geplanter BR eines anderen Einsatzes ist für diesen Einsatz unbekannt.
        assert!(matches!(
            check(e + 1, br.id).await.unwrap_err(),
            AppError::NotFound
        ));
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        check(e, br.id).await.unwrap();
        setze_status(&pool, e, br.id, "aufgeloest", b)
            .await
            .unwrap();
        assert!(matches!(
            check(e, br.id).await.unwrap_err(),
            AppError::UnprocessableEntity(m) if m == "Bereitstellungsraum ist aufgelöst"
        ));
        let s = create(&pool, e, b, neu("Storno")).await.unwrap();
        storniere(&pool, e, s.id, b).await.unwrap();
        assert!(matches!(
            check(e, s.id).await.unwrap_err(),
            AppError::NotFound
        ));
        assert!(matches!(
            check(e, 999_999).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn anlegen_doppelte_bezeichnung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        create(&pool, e, b, neu("BR Ost")).await.unwrap();
        let err = create(&pool, e, b, neu("BR Ost")).await.unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "UNIQUE(einsatz_id, bezeichnung)"
        );
    }

    #[tokio::test]
    async fn laden_fremd_liefert_not_found() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR X")).await.unwrap();
        // Falscher einsatz_id → NotFound (Org-Isolation)
        let err = laden(&pool, e + 999, br.id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn laden_liefert_auch_stornierte() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Storno")).await.unwrap();
        storniere(&pool, e, br.id, b).await.unwrap();
        let geladen = laden(&pool, e, br.id).await.unwrap();
        assert!(geladen.storniert_at.is_some());
    }

    #[tokio::test]
    async fn liste_filtert_stornierte_und_status() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br1 = create(&pool, e, b, neu("BR A")).await.unwrap();
        create(&pool, e, b, neu("BR B")).await.unwrap();
        // Storno: br1 verschwindet aus der Liste:
        storniere(&pool, e, br1.id, b).await.unwrap();
        let alle = liste(&pool, e, None, None).await.unwrap();
        assert_eq!(alle.len(), 1, "stornierte BR fallen aus der Liste");
        // Status-Filter:
        let geplante = liste(&pool, e, Some("geplant"), None).await.unwrap();
        assert_eq!(geplante.len(), 1);
        let aktive = liste(&pool, e, Some("aktiv"), None).await.unwrap();
        assert!(aktive.is_empty());
    }

    #[tokio::test]
    async fn aktualisiere_felder() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Alt")).await.unwrap();
        let nach = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                bezeichnung: Some("BR Neu"),
                standort: Some(Some("Marktplatz")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(nach.bezeichnung, "BR Neu");
        assert_eq!(nach.standort.as_deref(), Some("Marktplatz"));
        assert_eq!(nach.geaendert_von, b);
    }

    #[tokio::test]
    async fn aktualisiere_not_found_bei_falscher_einsatz_id() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Y")).await.unwrap();
        let err = patch(&pool, e + 999, br.id, b, PatchDaten::default())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    /// Änderung in einer eigenen Schreibtransaktion, wie die Route sie öffnet.
    async fn patch(
        pool: &SqlitePool,
        einsatz_id: i64,
        id: i64,
        benutzer_id: i64,
        daten: PatchDaten<'_>,
    ) -> Result<BrAnzeige, AppError> {
        crate::write_retry!(pool, |conn| {
            update_tx(conn, einsatz_id, id, benutzer_id, &daten).await
        })
    }

    fn koordinate(br: &BrAnzeige) -> (Option<f64>, Option<f64>) {
        (br.lat, br.lon)
    }

    /// Raum mit Standort, Notiz, Abschnitt und Koordinate (51,93 / 8,87).
    async fn verorteter_raum(pool: &SqlitePool, e: i64, b: i64) -> BrAnzeige {
        let a: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        create(
            pool,
            e,
            b,
            NeueDaten {
                bezeichnung: "BR Sportplatz",
                abschnitt_id: Some(a),
                standort: Some("Sportplatz Nord"),
                notiz: Some("Zufahrt Süd"),
                lat: Some(51.93),
                lon: Some(8.87),
            },
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn anlegen_mit_koordinate_liefert_sie_zurueck_ohne_fehlen_beide() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = verorteter_raum(&pool, e, b).await;
        assert_eq!(koordinate(&br), (Some(51.93), Some(8.87)));
        assert_eq!(
            koordinate(&laden(&pool, e, br.id).await.unwrap()),
            (Some(51.93), Some(8.87))
        );
        let liste = liste(&pool, e, None, None).await.unwrap();
        assert_eq!(koordinate(&liste[0].br), (Some(51.93), Some(8.87)));

        let ohne = create(&pool, e, b, neu("BR Schule")).await.unwrap();
        assert_eq!(koordinate(&ohne), (None, None));
        let json = serde_json::to_value(&ohne).unwrap();
        assert!(
            json.get("lat").is_none() && json.get("lon").is_none(),
            "{json}"
        );
    }

    #[tokio::test]
    async fn anlegen_mit_halbem_paar_oder_ausserhalb_ist_422_und_legt_nichts_an() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        for (lat, lon) in [
            (Some(51.9), None),
            (None, Some(8.8)),
            (Some(91.0), Some(8.0)),
        ] {
            let err = create(
                &pool,
                e,
                b,
                NeueDaten {
                    lat,
                    lon,
                    ..neu("BR Halb")
                },
            )
            .await
            .unwrap_err();
            assert!(
                matches!(err, AppError::UnprocessableEntity(_)),
                "{lat:?}/{lon:?}: {err:?}"
            );
        }
        assert!(liste(&pool, e, None, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn nur_lat_ohne_bestand_ist_422_und_aendert_nichts() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Schule")).await.unwrap();
        let err = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                lat: Some(Some(51.9)),
                standort: Some(Some("Schulhof")),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
        let nach = laden(&pool, e, br.id).await.unwrap();
        assert_eq!(koordinate(&nach), (None, None));
        assert_eq!(nach.standort, None, "auch der Standort bleibt");
    }

    #[tokio::test]
    async fn nur_lat_bei_vorhandenem_paar_aendert_die_breite() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = verorteter_raum(&pool, e, b).await;
        let nach = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                lat: Some(Some(52.0)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(koordinate(&nach), (Some(52.0), Some(8.87)));
    }

    #[tokio::test]
    async fn breite_91_ist_422() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = verorteter_raum(&pool, e, b).await;
        let err = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                lat: Some(Some(91.0)),
                lon: Some(Some(8.0)),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::UnprocessableEntity(_)), "{err:?}");
        assert_eq!(
            koordinate(&laden(&pool, e, br.id).await.unwrap()),
            (Some(51.93), Some(8.87))
        );
    }

    #[tokio::test]
    async fn beide_null_entfernt_die_koordinate() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = verorteter_raum(&pool, e, b).await;
        let nach = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                lat: Some(None),
                lon: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(koordinate(&nach), (None, None));
    }

    #[tokio::test]
    async fn koordinate_aendern_laesst_standort_notiz_und_abschnitt_stehen() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = verorteter_raum(&pool, e, b).await;
        // Eine andere Person ändert zuvor den Standort; die Verortung überschreibt ihn nicht, und
        // die Textänderung lässt die Koordinate stehen.
        let zwischen = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                standort: Some(Some("Sportplatz Süd")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(koordinate(&zwischen), (Some(51.93), Some(8.87)));
        let nach = patch(
            &pool,
            e,
            br.id,
            b,
            PatchDaten {
                lat: Some(Some(51.5)),
                lon: Some(Some(8.5)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(koordinate(&nach), (Some(51.5), Some(8.5)));
        assert_eq!(nach.standort.as_deref(), Some("Sportplatz Süd"));
        assert_eq!(nach.notiz.as_deref(), Some("Zufahrt Süd"));
        assert_eq!(nach.abschnitt_id, br.abschnitt_id);
        assert_eq!(nach.bezeichnung, "BR Sportplatz");
    }

    #[tokio::test]
    async fn verorten_im_fremden_einsatz_ist_404_am_stornierten_409() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Storno")).await.unwrap();
        let verorten = || PatchDaten {
            lat: Some(Some(51.9)),
            lon: Some(Some(8.8)),
            ..Default::default()
        };
        let err = patch(&pool, e + 999, br.id, b, verorten())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound), "{err:?}");
        storniere(&pool, e, br.id, b).await.unwrap();
        let err = patch(&pool, e, br.id, b, verorten()).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            koordinate(&laden(&pool, e, br.id).await.unwrap()),
            (None, None)
        );
    }

    #[tokio::test]
    async fn ungueltige_status_transition_ist_422() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Z")).await.unwrap();
        // geplant → aufgeloest ist erlaubt, aber aktiv → geplant ist verboten
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        let err = setze_status(&pool, e, br.id, "geplant", b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::UnprocessableEntity(_)),
            "Rückwärts-Transition → 422"
        );
    }

    #[tokio::test]
    async fn setze_status_not_found_bei_falschem_einsatz() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR NotFound")).await.unwrap();
        let err = setze_status(&pool, e + 999, br.id, "aktiv", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_einheit_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Block")).await.unwrap();
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        // Einheit anlegen und BR-Cache setzen (belegung_repo kommt erst in Task 4):
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, aktueller_br_id) \
             VALUES (?, 'Einheit 1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        let err = setze_status(&pool, e, br.id, "aufgeloest", b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Auflösung blockt bei Belegung (409)"
        );
        // Storno blockt identisch:
        let err = storniere(&pool, e, br.id, b).await.unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn aufloesen_blockiert_bei_aktiver_fahrzeug_belegung() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Block Fz")).await.unwrap();
        setze_status(&pool, e, br.id, "aktiv", b).await.unwrap();
        // Fahrzeug anlegen mit BR-Cache:
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, aktueller_br_id) \
             VALUES (?, 'FLF 1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        let err = setze_status(&pool, e, br.id, "aufgeloest", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn storniere_doppelt_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Doppel")).await.unwrap();
        storniere(&pool, e, br.id, b).await.unwrap();
        let err = storniere(&pool, e, br.id, b).await.unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Doppel-Storno → Conflict"
        );
    }

    #[tokio::test]
    async fn aktive_belegungen_zaehlt_einheit_und_fahrzeug() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let br = create(&pool, e, b, neu("BR Zaehlen")).await.unwrap();
        assert_eq!(
            aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br.id)
                .await
                .unwrap(),
            0
        );
        // Eine Einheit + ein Fahrzeug belegen:
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, aktueller_br_id) VALUES (?, 'E1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, aktueller_br_id) VALUES (?, 'FLF1', ?)",
        )
        .bind(e)
        .bind(br.id)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br.id)
                .await
                .unwrap(),
            2
        );
        // Ungebundenes Fahrzeug zählt nicht:
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, 'FLF2')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br.id)
                .await
                .unwrap(),
            2
        );
    }
}

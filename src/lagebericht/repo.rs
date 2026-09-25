use super::{
    leere_abschnitte, render_snapshot, validiere_freigabe, vorlage, Abschnitt, STATUS_ENTWURF,
    STATUS_FREIGEGEBEN,
};
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Öffentliche Anzeige eines Lageberichts (Abschnitte aus JSON geparst, Namen aufgelöst).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct LageberichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[schema(value_type = crate::lagebericht::LageberichtVorlage)]
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    #[schema(value_type = crate::lagebericht::LageberichtStatus)]
    pub status: String,
    pub abschnitte: Vec<Abschnitt>,
    pub version: i64,
    pub vorgaenger_id: Option<i64>,
    pub ersteller_id: i64,
    pub ersteller_name: String,
    pub erstellt_at: String,
    pub aktualisiert_at: String,
    pub freigegeben_von_id: Option<i64>,
    pub freigegeben_von_name: Option<String>,
    pub freigegeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}

/// Editierbare Felder eines Entwurfs-PATCH. `None` = unverändert.
#[derive(Debug, Default)]
pub struct LageberichtPatch<'a> {
    pub titel: Option<&'a str>,
    pub zeitstand: Option<&'a str>,
    pub abschnitte: Option<&'a [Abschnitt]>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    vorlage: String,
    titel: String,
    zeitstand: String,
    status: String,
    abschnitte: String,
    version: i64,
    vorgaenger_id: Option<i64>,
    ersteller_id: i64,
    ersteller_name: String,
    erstellt_at: String,
    aktualisiert_at: String,
    freigegeben_von_id: Option<i64>,
    freigegeben_von_name: Option<String>,
    freigegeben_at: Option<String>,
    etb_eintrag_id: Option<i64>,
}

const SELECT: &str = "\
    SELECT l.id, l.einsatz_id, l.vorlage, l.titel, l.zeitstand, l.status, l.abschnitte, \
           l.version, l.vorgaenger_id, \
           l.ersteller_id, b1.anzeigename AS ersteller_name, \
           l.erstellt_at, l.aktualisiert_at, \
           l.freigegeben_von_id, b2.anzeigename AS freigegeben_von_name, \
           l.freigegeben_at, l.etb_eintrag_id \
    FROM lagebericht l \
    JOIN benutzer b1 ON b1.id = l.ersteller_id \
    LEFT JOIN benutzer b2 ON b2.id = l.freigegeben_von_id";

fn zu_anzeige(row: Row) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte: Vec<Abschnitt> = serde_json::from_str(&row.abschnitte)
        .map_err(|e| AppError::Internal(format!("Abschnitte-JSON defekt: {e}")))?;
    Ok(LageberichtAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        vorlage: row.vorlage,
        titel: row.titel,
        zeitstand: row.zeitstand,
        status: row.status,
        abschnitte,
        version: row.version,
        vorgaenger_id: row.vorgaenger_id,
        ersteller_id: row.ersteller_id,
        ersteller_name: row.ersteller_name,
        erstellt_at: row.erstellt_at,
        aktualisiert_at: row.aktualisiert_at,
        freigegeben_von_id: row.freigegeben_von_id,
        freigegeben_von_name: row.freigegeben_von_name,
        freigegeben_at: row.freigegeben_at,
        etb_eintrag_id: row.etb_eintrag_id,
    })
}

/// Alle Berichte eines Einsatzes, neueste Fortschreibung/Anlage zuerst.
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageberichtAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE l.einsatz_id = ? ORDER BY l.zeitstand DESC, l.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(zu_anzeige).collect()
}

/// Lädt einen Bericht (aufgelöst); `NotFound`, wenn nicht zum Einsatz.
///
/// Executor-generisch (Pool oder offene Verbindung): [`anlegen_tx`] und [`freigeben_tx`]
/// laden auf der Verbindung ihrer Transaktion (LFH-690).
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE l.id = ? AND l.einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?
    .ok_or(AppError::NotFound)?;
    zu_anzeige(row)
}

/// Legt einen Entwurf mit leerem Abschnitts-Skelett der Vorlage an.
/// Erwartet eine bereits validierte `vorlage` und normalisierten `zeitstand`.
///
/// Pool-Hülle um [`anlegen_tx`]: wie bisher ohne eigene Transaktion, Insert und Rücklesen
/// laufen im Autocommit einer geliehenen Verbindung.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    anlegen_tx(
        &mut conn,
        einsatz_id,
        vorlage_key,
        titel,
        zeitstand,
        ersteller_id,
    )
    .await
}

/// Legt einen Entwurf auf einer offenen Verbindung/Transaktion an und lädt ihn dort zurück
/// (LFH-690, Demo-Import in EINER Transaktion). Öffnet und committet selbst nichts.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let v =
        vorlage(vorlage_key).ok_or_else(|| AppError::Validation("Unbekannte Vorlage".into()))?;
    let skelett = serde_json::to_string(&leere_abschnitte(v))
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lagebericht (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vorlage_key)
    .bind(titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(skelett)
    .bind(ersteller_id)
    .fetch_one(&mut *conn)
    .await?;
    laden(&mut *conn, einsatz_id, id).await
}

/// Partielles Update eines Entwurfs (Titel/Zeitstand/Abschnitte). `NotFound`,
/// wenn nicht zum Einsatz. Der Entwurfs-Status wird vom Handler geprüft.
///
/// Pool-Hülle um [`aktualisiere_tx`]: wie bisher ohne eigene Transaktion, UPDATE und
/// Rücklesen laufen im Autocommit einer geliehenen Verbindung.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: LageberichtPatch<'_>,
) -> Result<LageberichtAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    aktualisiere_tx(&mut conn, einsatz_id, id, &patch).await
}

/// Wie [`aktualisiere`], auf einer offenen Verbindung/Transaktion (LFH-690: der Demo-Import
/// befüllt den Entwurf vor der Freigabe in EINER Transaktion). Öffnet und committet nichts.
pub async fn aktualisiere_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    patch: &LageberichtPatch<'_>,
) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte_json = match patch.abschnitte {
        Some(a) => Some(serde_json::to_string(a).map_err(|e| AppError::Internal(e.to_string()))?),
        None => None,
    };
    let betroffen = sqlx::query(
        "UPDATE lagebericht SET \
            titel      = CASE WHEN ? THEN ? ELSE titel END, \
            zeitstand  = CASE WHEN ? THEN ? ELSE zeitstand END, \
            abschnitte = CASE WHEN ? THEN ? ELSE abschnitte END, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? AND status = ?",
    )
    .bind(patch.titel.is_some())
    .bind(patch.titel)
    .bind(patch.zeitstand.is_some())
    .bind(patch.zeitstand)
    .bind(abschnitte_json.is_some())
    .bind(abschnitte_json.as_deref())
    .bind(id)
    .bind(einsatz_id)
    .bind(STATUS_ENTWURF)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(&mut *conn, einsatz_id, id).await
}

/// Gibt einen Entwurf frei: schreibt **in einer Transaktion** den gerenderten
/// Snapshot als etb_eintrag (typ='lage', ereigniszeit=zeitstand), verknüpft beide
/// Seiten und setzt den Bericht auf `freigegeben` (danach immutable). `render` und
/// `zeitstand` bringt der Aufrufer mit; Validierung und Rendering aus dem Datensatz macht
/// [`freigeben_gerendert`] bzw. [`freigeben_tx`]. `zeitstand` ist bereits normalisiert.
/// `UnprocessableEntity`, wenn der Bericht nicht (mehr) im Entwurf ist.
///
/// Pool-Hülle um [`snapshot_freigeben_tx`] in `write_retry!` (`BEGIN IMMEDIATE`): der Rumpf
/// liest zuerst die Einstellungen und schreibt dann. Scheitert die Status-Bedingung, fällt
/// die Transaktion samt eben angelegtem ETB-Eintrag zurück, es bleibt kein verwaister Snapshot.
pub async fn freigeben(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
    render: &str,
    zeitstand: &str,
) -> Result<LageberichtAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        snapshot_freigeben_tx(conn, einsatz_id, id, freigeber_id, render, zeitstand).await?;
        Ok(())
    })?;
    laden(pool, einsatz_id, id).await
}

/// Freigabe aus dem gespeicherten Entwurf, wie der Handler sie braucht: Pool-Hülle um
/// [`freigeben_tx`] in `write_retry!`. Lesen, Prüfen, Rendern und Schreiben laufen damit in
/// EINER Transaktion; die Anzeige kommt aus derselben Transaktion zurück.
pub async fn freigeben_gerendert(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    crate::write_retry!(pool, |conn| {
        freigeben_tx(conn, einsatz_id, id, freigeber_id).await
    })
}

/// Gibt einen Entwurf auf einer offenen Transaktion frei (LFH-690: Handler und Demo-Import
/// teilen diesen Weg). Lädt den Bericht auf der Verbindung, prüft den Entwurfs-Status,
/// validiert die Abschnitte ([`validiere_freigabe`](super::validiere_freigabe)), rendert den
/// Snapshot ([`render_snapshot`](super::render_snapshot)) mit dem gespeicherten `zeitstand`
/// und schreibt ihn über [`snapshot_freigeben_tx`]. Liefert die frische Anzeige.
///
/// Öffnet und committet nichts. Bei `Err` kann die Verbindung schon den ETB-Eintrag tragen:
/// der Aufrufer muss die Transaktion dann zurückrollen (`write_retry!` tut das von selbst).
///
/// `NotFound`, wenn der Bericht nicht zum Einsatz gehört; `UnprocessableEntity`, wenn er
/// schon freigegeben ist oder die Validierung scheitert.
pub async fn freigeben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let bericht = laden(&mut *conn, einsatz_id, id).await?;
    if bericht.status != STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(
            "Bericht ist bereits freigegeben".into(),
        ));
    }
    let v = vorlage(&bericht.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
    validiere_freigabe(v, &bericht.abschnitte)?;
    let render = render_snapshot(v, &bericht.titel, &bericht.zeitstand, &bericht.abschnitte);
    snapshot_freigeben_tx(
        &mut *conn,
        einsatz_id,
        id,
        freigeber_id,
        &render,
        &bericht.zeitstand,
    )
    .await?;
    laden(&mut *conn, einsatz_id, id).await
}

/// Schreibt den fertig gerenderten Snapshot ins ETB, verknüpft beide Seiten und setzt den
/// Bericht auf `freigegeben`, alles auf der übergebenen Verbindung. Der ETB-Startwert kommt
/// aus den Einstellungen, gelesen auf derselben Verbindung (LFH-690: über den Pool sähe ein
/// Import die Einstellungen seines eigenen, noch offenen Einsatzes nicht und fiele still auf
/// den Vorgabewert zurück). Liefert die id des ETB-Eintrags.
async fn snapshot_freigeben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
    render: &str,
    zeitstand: &str,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id)
        .await?
        .etb_startwert();

    // 1. ETB-Snapshot anlegen (server-autoritative lfd_nr, Startwert aus Einstellungen).
    let etb_id = etb_repo::anlegen_tx(
        &mut *conn,
        einsatz_id,
        freigeber_id,
        etb_startwert,
        etb_repo::EintragDaten {
            typ: etb::TYP_LAGE,
            inhalt: render,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: Some(zeitstand),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;

    // 2. Rückverweis vom ETB-Eintrag auf den Lagebericht.
    sqlx::query("UPDATE etb_eintrag SET lagebericht_id = ? WHERE id = ?")
        .bind(id)
        .bind(etb_id)
        .execute(&mut *conn)
        .await?;

    // 3. Lagebericht freigeben — nur wenn noch Entwurf (verhindert Doppel-Freigabe).
    let betroffen = sqlx::query(
        "UPDATE lagebericht SET status = ?, freigegeben_von_id = ?, freigegeben_at = datetime('now'), \
            etb_eintrag_id = ?, aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? AND status = ?",
    )
    .bind(STATUS_FREIGEGEBEN)
    .bind(freigeber_id)
    .bind(etb_id)
    .bind(id)
    .bind(einsatz_id)
    .bind(STATUS_ENTWURF)
    .execute(&mut *conn)
    .await?
    .rows_affected();

    if betroffen == 0 {
        // Der Aufrufer rollt zurück und verwirft damit den eben angelegten ETB-Eintrag.
        return Err(AppError::UnprocessableEntity(
            "Bericht ist nicht (mehr) im Entwurf".into(),
        ));
    }
    Ok(etb_id)
}

/// Legt aus einem **freigegebenen** Bericht eine neue Entwurfs-Version an
/// (version+1, vorgaenger_id, gleiche Vorlage, **Abschnitts-Inhalte des Vorgängers
/// übernommen** als Ausgangspunkt — die Führungskraft bearbeitet nur die Deltas;
/// das ETB trägt jede freigegebene Version als eigenen Snapshot). `UnprocessableEntity`,
/// wenn der Vorgänger nicht freigegeben ist.
pub async fn fortschreiben(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    ersteller_id: i64,
    zeitstand: &str,
) -> Result<LageberichtAnzeige, AppError> {
    let vorher = laden(pool, einsatz_id, id).await?;
    if vorher.status != STATUS_FREIGEGEBEN {
        return Err(AppError::UnprocessableEntity(
            "Nur freigegebene Berichte können fortgeschrieben werden".into(),
        ));
    }
    let abschnitte_json =
        serde_json::to_string(&vorher.abschnitte).map_err(|e| AppError::Internal(e.to_string()))?;
    let neu_id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lagebericht \
            (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, version, vorgaenger_id, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(&vorher.vorlage)
    .bind(&vorher.titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(abschnitte_json)
    .bind(vorher.version + 1)
    .bind(id)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, neu_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lagebericht::{vorlage, STATUS_ENTWURF};

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an;
    /// liefert (einsatz_id, ersteller_id).
    /// Mirrored von src/etb/repo.rs tests::setup.
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h')",
        )
        .execute(pool)
        .await
        .unwrap();
        let ersteller_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(pool)
                .await
                .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz_id, ersteller_id)
    }

    #[tokio::test]
    async fn anlegen_erzeugt_entwurf_mit_skelett() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "lagebericht",
            "Lage 10:00",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        assert_eq!(lb.vorlage, "lagebericht");
        assert_eq!(lb.status, STATUS_ENTWURF);
        assert_eq!(lb.version, 1);
        assert_eq!(
            lb.abschnitte.len(),
            vorlage("lagebericht").unwrap().abschnitte.len()
        );
        assert!(lb.abschnitte.iter().all(|a| a.text.is_empty()));
        let geladen = laden(&pool, einsatz, lb.id).await.unwrap();
        assert_eq!(geladen, lb);
        let alle = liste(&pool, einsatz).await.unwrap();
        assert_eq!(alle.len(), 1);
    }

    #[tokio::test]
    async fn fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "X",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        assert!(matches!(
            laden(&pool, 999, lb.id).await.unwrap_err(),
            crate::error::AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn aktualisiere_setzt_abschnitte() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "X",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        let neu = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Inhalt".into(),
        }];
        let upd = aktualisiere(
            &pool,
            einsatz,
            lb.id,
            LageberichtPatch {
                titel: Some("Neu"),
                zeitstand: None,
                abschnitte: Some(&neu),
            },
        )
        .await
        .unwrap();
        assert_eq!(upd.titel, "Neu");
        assert_eq!(upd.abschnitte, neu);
    }

    #[tokio::test]
    async fn aktualisiere_nach_freigabe_ist_notfound() {
        // DB-Guard (AND status='entwurf'): ein spätes PATCH darf einen bereits
        // freigegebenen Bericht nicht überschreiben (Race-Absicherung).
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "X",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        let gefuellt = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Inhalt".into(),
        }];
        aktualisiere(
            &pool,
            einsatz,
            lb.id,
            LageberichtPatch {
                titel: None,
                zeitstand: None,
                abschnitte: Some(&gefuellt),
            },
        )
        .await
        .unwrap();
        freigeben(
            &pool,
            einsatz,
            lb.id,
            ersteller,
            "render",
            "2026-06-02 10:00:00",
        )
        .await
        .unwrap();

        let nachtrag = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Manipuliert".into(),
        }];
        let err = aktualisiere(
            &pool,
            einsatz,
            lb.id,
            LageberichtPatch {
                titel: Some("Hack"),
                zeitstand: None,
                abschnitte: Some(&nachtrag),
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, crate::error::AppError::NotFound));
    }

    #[tokio::test]
    async fn freigeben_schreibt_etb_und_macht_immutable() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "Lage 10:00",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        let gefuellt = vec![Abschnitt {
            schluessel: "text".into(),
            text: "Hochwasser steigt.".into(),
        }];
        aktualisiere(
            &pool,
            einsatz,
            lb.id,
            LageberichtPatch {
                titel: None,
                zeitstand: None,
                abschnitte: Some(&gefuellt),
            },
        )
        .await
        .unwrap();

        let render =
            "# Lage 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Bericht\nHochwasser steigt.\n";
        let frei = freigeben(
            &pool,
            einsatz,
            lb.id,
            ersteller,
            render,
            "2026-06-02 10:00:00",
        )
        .await
        .unwrap();
        assert_eq!(frei.status, super::STATUS_FREIGEGEBEN);
        assert!(frei.etb_eintrag_id.is_some());
        assert_eq!(frei.freigegeben_von_id, Some(ersteller));

        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'lage' AND lagebericht_id = ?",
        ).bind(einsatz).bind(lb.id).fetch_one(&pool).await.unwrap();
        assert_eq!(anzahl, 1);

        // Nochmals freigeben schlägt fehl (nicht mehr im Entwurf) → kein zweiter Eintrag.
        assert!(freigeben(
            &pool,
            einsatz,
            lb.id,
            ersteller,
            render,
            "2026-06-02 10:00:00"
        )
        .await
        .is_err());
        let anzahl2: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'lage'",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(anzahl2, 1);
    }

    /// LFH-690: Einsatz, Einstellungen (ETB-Startwert 100), Entwurf und Freigabe in EINER
    /// Transaktion. Über den Pool gelesen fänden die Einstellungen den noch nicht committeten
    /// Einsatz nicht, und der Snapshot bekäme still die Vorgabe-Nummer 1.
    #[tokio::test]
    async fn freigeben_tx_liest_startwert_und_entwurf_auf_der_verbindung() {
        let (_dir, pool) = crate::db::test_pool_datei().await;
        let (_, ersteller) = setup(&pool).await;
        let (einsatz, frei, lfd_nr, inhalt) = crate::write_retry!(&pool, |conn| {
            let einsatz: i64 = sqlx::query_scalar(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Import') RETURNING id",
            )
            .fetch_one(&mut *conn)
            .await?;
            sqlx::query(
                "INSERT INTO einsatz_einstellungen (einsatz_id, etb_nummer_start) VALUES (?, 100)",
            )
            .bind(einsatz)
            .execute(&mut *conn)
            .await?;
            let b = anlegen_tx(
                &mut *conn,
                einsatz,
                "freitext",
                "Lage 10:00",
                "2026-06-02 10:00:00",
                ersteller,
            )
            .await?;
            let gefuellt = vec![Abschnitt {
                schluessel: "text".into(),
                text: "Inhalt".into(),
            }];
            sqlx::query("UPDATE lagebericht SET abschnitte = ? WHERE id = ?")
                .bind(serde_json::to_string(&gefuellt).unwrap())
                .bind(b.id)
                .execute(&mut *conn)
                .await?;
            let frei = freigeben_tx(&mut *conn, einsatz, b.id, ersteller).await?;
            let (lfd_nr, inhalt): (i64, String) =
                sqlx::query_as("SELECT lfd_nr, inhalt FROM etb_eintrag WHERE id = ?")
                    .bind(frei.etb_eintrag_id)
                    .fetch_one(&mut *conn)
                    .await?;
            Ok((einsatz, frei, lfd_nr, inhalt))
        })
        .unwrap();
        assert_eq!(frei.status, STATUS_FREIGEGEBEN);
        assert_eq!(frei.freigegeben_von_id, Some(ersteller));
        assert_eq!(
            lfd_nr, 100,
            "Startwert aus den Einstellungen derselben Transaktion"
        );
        assert_eq!(
            inhalt,
            "# Lage 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Bericht\nInhalt\n"
        );
        assert_eq!(laden(&pool, einsatz, frei.id).await.unwrap(), frei);
    }

    /// Zweite Freigabe über `freigeben_tx` scheitert an der Status-Prüfung mit dem Wortlaut
    /// des Handlers, und die Hülle hinterlässt keinen zweiten Snapshot.
    #[tokio::test]
    async fn freigeben_gerendert_zweimal_ist_422_ohne_zweiten_snapshot() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let b = anlegen(
            &pool,
            einsatz,
            "freitext",
            "X",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        let err = freigeben_gerendert(&pool, einsatz, b.id, ersteller)
            .await
            .unwrap_err();
        assert!(
            matches!(&err, AppError::UnprocessableEntity(m) if m == "Der Bericht ist leer und kann nicht freigegeben werden"),
            "{err:?}"
        );
        let gefuellt = vec![Abschnitt {
            schluessel: "text".into(),
            text: "A".into(),
        }];
        aktualisiere(
            &pool,
            einsatz,
            b.id,
            LageberichtPatch {
                titel: None,
                zeitstand: None,
                abschnitte: Some(&gefuellt),
            },
        )
        .await
        .unwrap();
        freigeben_gerendert(&pool, einsatz, b.id, ersteller)
            .await
            .unwrap();
        let err = freigeben_gerendert(&pool, einsatz, b.id, ersteller)
            .await
            .unwrap_err();
        assert!(
            matches!(&err, AppError::UnprocessableEntity(m) if m == "Bericht ist bereits freigegeben"),
            "{err:?}"
        );
        let n: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'lage'",
        )
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn fortschreiben_erzeugt_version_2_mit_vorgaenger() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "Lage 10:00",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        let gefuellt = vec![Abschnitt {
            schluessel: "text".into(),
            text: "A".into(),
        }];
        aktualisiere(
            &pool,
            einsatz,
            lb.id,
            LageberichtPatch {
                titel: None,
                zeitstand: None,
                abschnitte: Some(&gefuellt),
            },
        )
        .await
        .unwrap();
        freigeben(
            &pool,
            einsatz,
            lb.id,
            ersteller,
            "render",
            "2026-06-02 10:00:00",
        )
        .await
        .unwrap();

        let fort = fortschreiben(&pool, einsatz, lb.id, ersteller, "2026-06-02 12:00:00")
            .await
            .unwrap();
        assert_eq!(fort.version, 2);
        assert_eq!(fort.vorgaenger_id, Some(lb.id));
        assert_eq!(fort.status, STATUS_ENTWURF);
        assert_eq!(fort.vorlage, "freitext");
        // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als
        // Ausgangspunkt (nur Deltas bearbeiten); der ETB trägt jede Version separat.
        assert_eq!(fort.abschnitte, gefuellt);
    }

    #[tokio::test]
    async fn fortschreiben_nur_aus_freigegebenem() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(
            &pool,
            einsatz,
            "freitext",
            "X",
            "2026-06-02 10:00:00",
            ersteller,
        )
        .await
        .unwrap();
        assert!(
            fortschreiben(&pool, einsatz, lb.id, ersteller, "2026-06-02 12:00:00")
                .await
                .is_err()
        );
    }
}

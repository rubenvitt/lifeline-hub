//! Persistenz der Vorlagen-Dokumente, gemeinsam für alle [`Dokumentart`]en. Die Tabellen
//! `befehl` und `lagebericht` haben dieselben Spalten; nur ihr Name, der ETB-Typ und die
//! Rückverweis-Spalte am `etb_eintrag` kommen aus der Art.

use super::{
    gefuellte_abschnitte, leere_abschnitte, render_snapshot, validiere_freigabe, vorlage,
    Dokumentart, STATUS_ENTWURF, STATUS_FREIGEGEBEN,
};
use crate::error::AppError;
use crate::etb::repo as etb_repo;
use sqlx::{SqliteConnection, SqlitePool};

/// Ein geladenes Dokument (Abschnitte aus JSON geparst, Namen aufgelöst). Die Wire-Typen
/// `BefehlAnzeige`/`LageberichtAnzeige` tragen dieselben Felder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dokument<A> {
    pub id: i64,
    pub einsatz_id: i64,
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    pub status: String,
    pub abschnitte: Vec<A>,
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
#[derive(Debug)]
pub struct Patch<'a, A> {
    pub titel: Option<&'a str>,
    pub zeitstand: Option<&'a str>,
    pub abschnitte: Option<&'a [A]>,
}

// Von Hand statt per derive: das derive verlangte `A: Default`.
impl<A> Default for Patch<'_, A> {
    fn default() -> Self {
        Self {
            titel: None,
            zeitstand: None,
            abschnitte: None,
        }
    }
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

fn select<T: Dokumentart>() -> String {
    format!(
        "\
    SELECT l.id, l.einsatz_id, l.vorlage, l.titel, l.zeitstand, l.status, l.abschnitte, \
           l.version, l.vorgaenger_id, \
           l.ersteller_id, b1.anzeigename AS ersteller_name, \
           l.erstellt_at, l.aktualisiert_at, \
           l.freigegeben_von_id, b2.anzeigename AS freigegeben_von_name, \
           l.freigegeben_at, l.etb_eintrag_id \
    FROM {} l \
    JOIN benutzer b1 ON b1.id = l.ersteller_id \
    LEFT JOIN benutzer b2 ON b2.id = l.freigegeben_von_id",
        T::TABELLE
    )
}

fn zu_dokument<T: Dokumentart>(row: Row) -> Result<Dokument<T::Abschnitt>, AppError> {
    let abschnitte: Vec<T::Abschnitt> = serde_json::from_str(&row.abschnitte)
        .map_err(|e| AppError::Internal(format!("Abschnitte-JSON defekt: {e}")))?;
    Ok(Dokument {
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

/// Alle Dokumente eines Einsatzes, neueste Fortschreibung/Anlage zuerst.
pub async fn liste<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<Dokument<T::Abschnitt>>, AppError> {
    let rows = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{} WHERE l.einsatz_id = ? ORDER BY l.zeitstand DESC, l.id DESC",
        select::<T>()
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(zu_dokument::<T>).collect()
}

/// Lädt ein Dokument (aufgelöst); `NotFound`, wenn nicht zum Einsatz.
///
/// Executor-generisch (Pool oder offene Verbindung): [`anlegen_tx`] und [`freigeben_tx`]
/// laden auf der Verbindung ihrer Transaktion (LFH-690).
pub async fn laden<T: Dokumentart>(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let row = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{} WHERE l.id = ? AND l.einsatz_id = ?",
        select::<T>()
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(executor)
    .await?
    .ok_or(AppError::NotFound)?;
    zu_dokument::<T>(row)
}

/// Pool-Hülle um [`anlegen_tx`]: ohne eigene Transaktion, Insert und Rücklesen laufen im
/// Autocommit einer geliehenen Verbindung.
pub async fn anlegen<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
    startinhalt: Option<&[T::Abschnitt]>,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let mut conn = pool.acquire().await?;
    anlegen_tx::<T>(
        &mut conn,
        einsatz_id,
        vorlage_key,
        titel,
        zeitstand,
        ersteller_id,
        startinhalt,
    )
    .await
}

/// Legt einen Entwurf mit dem Abschnitts-Skelett der Vorlage auf einer offenen
/// Verbindung/Transaktion an und lädt ihn dort zurück (LFH-690, Demo-Import in EINER
/// Transaktion). Öffnet und committet selbst nichts. Erwartet einen normalisierten
/// `zeitstand`.
///
/// Mit `startinhalt` trägt das Skelett gleich Text (LFH-548, Übernahme aus Meldebild und
/// Funkplan). Es bleibt EIN `INSERT`: der Entwurf entsteht mit Inhalt oder gar nicht, ein leerer
/// Entwurf nach gescheitertem zweiten Schritt ist damit ausgeschlossen. Die Schlüssel sind
/// vorher geprüft (`routes::vorlagendokument::pruefe_abschnitts_schluessel`).
pub async fn anlegen_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
    startinhalt: Option<&[T::Abschnitt]>,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let v = vorlage::<T>(vorlage_key)
        .ok_or_else(|| AppError::Validation("Unbekannte Vorlage".into()))?;
    let abschnitte = match startinhalt {
        Some(inhalt) => gefuellte_abschnitte::<T::Abschnitt>(v, inhalt),
        None => leere_abschnitte::<T::Abschnitt>(v),
    };
    let skelett =
        serde_json::to_string(&abschnitte).map_err(|e| AppError::Internal(e.to_string()))?;
    let id = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {} (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        T::TABELLE
    )))
    .bind(einsatz_id)
    .bind(vorlage_key)
    .bind(titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(skelett)
    .bind(ersteller_id)
    .fetch_one(&mut *conn)
    .await?;
    laden::<T>(&mut *conn, einsatz_id, id).await
}

/// Pool-Hülle um [`aktualisiere_tx`]: ohne eigene Transaktion, UPDATE und Rücklesen laufen
/// im Autocommit einer geliehenen Verbindung.
pub async fn aktualisiere<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: Patch<'_, T::Abschnitt>,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let mut conn = pool.acquire().await?;
    aktualisiere_tx::<T>(&mut conn, einsatz_id, id, &patch).await
}

/// Partielles Update eines Entwurfs (Titel/Zeitstand/Abschnitte) auf einer offenen
/// Verbindung/Transaktion (LFH-690: der Demo-Import befüllt den Entwurf vor der Freigabe in
/// EINER Transaktion). Öffnet und committet nichts. `NotFound`, wenn nicht zum Einsatz oder
/// nicht mehr im Entwurf; den Entwurfs-Status prüft vorher der Handler.
pub async fn aktualisiere_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    patch: &Patch<'_, T::Abschnitt>,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let abschnitte_json = match patch.abschnitte {
        Some(a) => Some(serde_json::to_string(a).map_err(|e| AppError::Internal(e.to_string()))?),
        None => None,
    };
    let betroffen = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {} SET \
            titel      = CASE WHEN ? THEN ? ELSE titel END, \
            zeitstand  = CASE WHEN ? THEN ? ELSE zeitstand END, \
            abschnitte = CASE WHEN ? THEN ? ELSE abschnitte END, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? AND status = ?",
        T::TABELLE
    )))
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
    laden::<T>(&mut *conn, einsatz_id, id).await
}

/// Freigabe aus dem gespeicherten Entwurf, wie der Handler sie braucht: Pool-Hülle um
/// [`freigeben_tx`] in `write_retry!`. Lesen, Prüfen, Rendern und Schreiben laufen damit in
/// EINER Transaktion; die Anzeige kommt aus derselben Transaktion zurück.
pub async fn freigeben_gerendert<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    crate::write_retry!(pool, |conn| {
        freigeben_tx::<T>(conn, einsatz_id, id, freigeber_id).await
    })
}

/// Gibt einen Entwurf auf einer offenen Transaktion frei (LFH-690: Handler und Demo-Import
/// teilen diesen Weg). Lädt das Dokument auf der Verbindung, prüft den Entwurfs-Status,
/// validiert die Abschnitte ([`validiere_freigabe`]), rendert den Snapshot
/// ([`render_snapshot`]) mit dem gespeicherten `zeitstand` und schreibt ihn über
/// [`snapshot_freigeben_tx`]. Liefert die frische Anzeige.
///
/// Öffnet und committet nichts. Bei `Err` kann die Verbindung schon den ETB-Eintrag tragen:
/// der Aufrufer muss die Transaktion dann zurückrollen (`write_retry!` tut das von selbst).
///
/// `NotFound`, wenn das Dokument nicht zum Einsatz gehört; `UnprocessableEntity`, wenn es
/// schon freigegeben ist oder die Validierung scheitert.
pub async fn freigeben_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let dok = laden::<T>(&mut *conn, einsatz_id, id).await?;
    if dok.status != STATUS_ENTWURF {
        return Err(AppError::UnprocessableEntity(format!(
            "{} ist bereits freigegeben",
            T::NOMEN
        )));
    }
    let v = vorlage::<T>(&dok.vorlage).ok_or(AppError::Internal("Vorlage verschwunden".into()))?;
    validiere_freigabe::<T>(v, &dok.abschnitte)?;
    let render = render_snapshot(v, &dok.titel, &dok.zeitstand, &dok.abschnitte);
    snapshot_freigeben_tx::<T>(
        &mut *conn,
        einsatz_id,
        id,
        freigeber_id,
        &render,
        &dok.zeitstand,
    )
    .await?;
    laden::<T>(&mut *conn, einsatz_id, id).await
}

/// Schreibt den fertig gerenderten Snapshot ins ETB, verknüpft beide Seiten und setzt das
/// Dokument auf `freigegeben`, alles auf der übergebenen Verbindung. Der ETB-Startwert kommt
/// aus den Einstellungen, gelesen auf derselben Verbindung (LFH-690: über den Pool sähe ein
/// Import die Einstellungen seines eigenen, noch offenen Einsatzes nicht und fiele still auf
/// den Vorgabewert zurück). Liefert die id des ETB-Eintrags.
async fn snapshot_freigeben_tx<T: Dokumentart>(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
    render: &str,
    zeitstand: &str,
) -> Result<i64, AppError> {
    let etb_startwert =
        crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;

    // 1. ETB-Snapshot anlegen (server-autoritative lfd_nr, Startwert aus Einstellungen).
    let etb_id = etb_repo::anlegen_tx(
        &mut *conn,
        einsatz_id,
        freigeber_id,
        etb_startwert,
        etb_repo::EintragDaten {
            typ: T::ETB_TYP,
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

    // 2. Rückverweis vom ETB-Eintrag auf das Dokument.
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE etb_eintrag SET {} = ? WHERE id = ?",
        T::ETB_VERWEIS
    )))
    .bind(id)
    .bind(etb_id)
    .execute(&mut *conn)
    .await?;

    // 3. Dokument freigeben — nur wenn noch Entwurf (verhindert Doppel-Freigabe).
    let betroffen = sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {} SET status = ?, freigegeben_von_id = ?, freigegeben_at = datetime('now'), \
            etb_eintrag_id = ?, aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? AND status = ?",
        T::TABELLE
    )))
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
        return Err(AppError::UnprocessableEntity(format!(
            "{} ist nicht (mehr) im Entwurf",
            T::NOMEN
        )));
    }
    Ok(etb_id)
}

/// Legt aus einem **freigegebenen** Dokument eine neue Entwurfs-Version an
/// (version+1, vorgaenger_id, gleiche Vorlage, **Abschnitts-Inhalte des Vorgängers
/// übernommen** als Ausgangspunkt — die Führungskraft bearbeitet nur die Deltas;
/// das ETB trägt jede freigegebene Version als eigenen Snapshot). `UnprocessableEntity`,
/// wenn der Vorgänger nicht freigegeben ist.
pub async fn fortschreiben<T: Dokumentart>(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    ersteller_id: i64,
    zeitstand: &str,
) -> Result<Dokument<T::Abschnitt>, AppError> {
    let vorher = laden::<T>(pool, einsatz_id, id).await?;
    if vorher.status != STATUS_FREIGEGEBEN {
        return Err(AppError::UnprocessableEntity(format!(
            "Nur freigegebene {} können fortgeschrieben werden",
            T::NOMEN_PLURAL
        )));
    }
    let abschnitte_json =
        serde_json::to_string(&vorher.abschnitte).map_err(|e| AppError::Internal(e.to_string()))?;
    let neu_id = sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {} \
            (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, version, vorgaenger_id, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        T::TABELLE
    )))
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
    laden::<T>(pool, einsatz_id, neu_id).await
}

/// Die Fälle laufen je Dokumentart einmal. Was die Arten unterscheidet, steht in `Fall` als
/// Literal und wird nicht aus der [`Dokumentart`] gelesen, damit der Test die Belegung prüft.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::befehl::Befehl;
    use crate::etb::{EtbEintragAnzeige, EtbTyp};
    use crate::lagebericht::Lagebericht;
    use crate::vorlagendokument::Abschnittsart;

    struct Fall {
        vorlage: &'static str,
        titel: &'static str,
        tabelle: &'static str,
        etb_typ: &'static str,
        etb_typ_enum: EtbTyp,
        etb_verweis: &'static str,
        verweis_gelesen: fn(&EtbEintragAnzeige) -> Option<i64>,
        /// Snapshot nach Freigabe mit „Inhalt" in jedem Abschnitt der Vorlage.
        snapshot_inhalt: &'static str,
        leer: &'static str,
        abschnitt_fehlt: &'static str,
        bereits_freigegeben: &'static str,
        nicht_mehr_entwurf: &'static str,
        nur_freigegebene: &'static str,
    }

    const BEFEHL: Fall = Fall {
        vorlage: "befehl_lad",
        titel: "Befehl 10:00",
        tabelle: "befehl",
        etb_typ: "anordnung",
        etb_typ_enum: EtbTyp::Anordnung,
        etb_verweis: "befehl_id",
        verweis_gelesen: |e| e.befehl_id,
        snapshot_inhalt: "# Befehl 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Lage\nInhalt\n\n## Auftrag\nInhalt\n\n## Durchführung\nInhalt\n",
        leer: "Der Befehl ist leer und kann nicht freigegeben werden",
        abschnitt_fehlt: "Abschnitt «Auftrag» fehlt im Befehl",
        bereits_freigegeben: "Befehl ist bereits freigegeben",
        nicht_mehr_entwurf: "Befehl ist nicht (mehr) im Entwurf",
        nur_freigegebene: "Nur freigegebene Befehle können fortgeschrieben werden",
    };

    const LAGEBERICHT: Fall = Fall {
        vorlage: "freitext",
        titel: "Lage 10:00",
        tabelle: "lagebericht",
        etb_typ: "lage",
        etb_typ_enum: EtbTyp::Lage,
        etb_verweis: "lagebericht_id",
        verweis_gelesen: |e| e.lagebericht_id,
        snapshot_inhalt: "# Lage 10:00\n\n_Zeitstand: 2026-06-02 10:00:00_\n\n## Bericht\nInhalt\n",
        leer: "Der Bericht ist leer und kann nicht freigegeben werden",
        abschnitt_fehlt: "Abschnitt «Bericht» fehlt im Bericht",
        bereits_freigegeben: "Bericht ist bereits freigegeben",
        nicht_mehr_entwurf: "Bericht ist nicht (mehr) im Entwurf",
        nur_freigegebene: "Nur freigegebene Berichte können fortgeschrieben werden",
    };

    /// Jeder Abschnitt der Vorlage mit demselben Text.
    fn gefuellt<T: Dokumentart>(f: &Fall, text: &str) -> Vec<T::Abschnitt> {
        vorlage::<T>(f.vorlage)
            .unwrap()
            .abschnitte
            .iter()
            .map(|d| T::Abschnitt::neu(d.schluessel.into(), text.into()))
            .collect()
    }

    fn ist_422(err: &AppError, meldung: &str) -> bool {
        matches!(err, AppError::UnprocessableEntity(m) if m == meldung)
    }

    /// Pool-Hülle für die Tests: Freigabe mit vorgegebenem Snapshot in `write_retry!`.
    async fn freigeben<T: Dokumentart>(
        pool: &SqlitePool,
        einsatz_id: i64,
        id: i64,
        freigeber_id: i64,
        render: &str,
    ) -> Result<Dokument<T::Abschnitt>, AppError> {
        crate::write_retry!(pool, |conn| {
            snapshot_freigeben_tx::<T>(
                conn,
                einsatz_id,
                id,
                freigeber_id,
                render,
                "2026-06-02 10:00:00",
            )
            .await?;
            Ok(())
        })?;
        laden::<T>(pool, einsatz_id, id).await
    }

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

    /// Frischer Pool mit Einsatz und einem angelegten Entwurf der Fall-Vorlage;
    /// liefert (pool, einsatz_id, ersteller_id, entwurf).
    async fn mit_entwurf<T: Dokumentart>(
        f: &Fall,
    ) -> (SqlitePool, i64, i64, Dokument<T::Abschnitt>) {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let d = anlegen::<T>(
            &pool,
            einsatz,
            f.vorlage,
            f.titel,
            "2026-06-02 10:00:00",
            ersteller,
            None,
        )
        .await
        .unwrap();
        (pool, einsatz, ersteller, d)
    }

    async fn fuelle<T: Dokumentart>(
        pool: &SqlitePool,
        einsatz: i64,
        id: i64,
        abschnitte: &[T::Abschnitt],
    ) {
        aktualisiere::<T>(
            pool,
            einsatz,
            id,
            Patch {
                abschnitte: Some(abschnitte),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    async fn anlegen_erzeugt_entwurf_mit_skelett_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, _, d) = mit_entwurf::<T>(f).await;
        assert_eq!(d.vorlage, f.vorlage);
        assert_eq!(d.status, STATUS_ENTWURF);
        assert_eq!(d.version, 1);
        assert_eq!(
            d.abschnitte.len(),
            vorlage::<T>(f.vorlage).unwrap().abschnitte.len()
        );
        assert!(d.abschnitte.iter().all(|a| a.text().is_empty()));
        assert_eq!(laden::<T>(&pool, einsatz, d.id).await.unwrap(), d);
        assert_eq!(liste::<T>(&pool, einsatz).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn anlegen_erzeugt_entwurf_mit_skelett() {
        anlegen_erzeugt_entwurf_mit_skelett_fall::<Befehl>(&BEFEHL).await;
        anlegen_erzeugt_entwurf_mit_skelett_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn fremder_einsatz_ist_notfound_fall<T: Dokumentart>(f: &Fall) {
        let (pool, _, _, d) = mit_entwurf::<T>(f).await;
        assert!(matches!(
            laden::<T>(&pool, 999, d.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn fremder_einsatz_ist_notfound() {
        fremder_einsatz_ist_notfound_fall::<Befehl>(&BEFEHL).await;
        fremder_einsatz_ist_notfound_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn aktualisiere_setzt_abschnitte_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, _, d) = mit_entwurf::<T>(f).await;
        let erster = d.abschnitte[0].schluessel().to_string();
        let neu = vec![T::Abschnitt::neu(erster, "Inhalt".into())];
        let upd = aktualisiere::<T>(
            &pool,
            einsatz,
            d.id,
            Patch {
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
    async fn aktualisiere_setzt_abschnitte() {
        aktualisiere_setzt_abschnitte_fall::<Befehl>(&BEFEHL).await;
        aktualisiere_setzt_abschnitte_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn aktualisiere_nach_freigabe_ist_notfound_fall<T: Dokumentart>(f: &Fall) {
        // DB-Guard (AND status='entwurf'): ein spätes PATCH darf ein bereits freigegebenes
        // Dokument nicht überschreiben (Race-Absicherung).
        let (pool, einsatz, ersteller, d) = mit_entwurf::<T>(f).await;
        fuelle::<T>(&pool, einsatz, d.id, &gefuellt::<T>(f, "Inhalt")).await;
        freigeben::<T>(&pool, einsatz, d.id, ersteller, "render")
            .await
            .unwrap();

        let nachtrag = gefuellt::<T>(f, "Manipuliert");
        let err = aktualisiere::<T>(
            &pool,
            einsatz,
            d.id,
            Patch {
                titel: Some("Hack"),
                zeitstand: None,
                abschnitte: Some(&nachtrag),
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }

    #[tokio::test]
    async fn aktualisiere_nach_freigabe_ist_notfound() {
        aktualisiere_nach_freigabe_ist_notfound_fall::<Befehl>(&BEFEHL).await;
        aktualisiere_nach_freigabe_ist_notfound_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn freigeben_schreibt_etb_und_macht_immutable_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, ersteller, d) = mit_entwurf::<T>(f).await;
        fuelle::<T>(
            &pool,
            einsatz,
            d.id,
            &gefuellt::<T>(f, "Hochwasser steigt."),
        )
        .await;

        let render = "# Snapshot\n\nHochwasser steigt.\n";
        let frei = freigeben::<T>(&pool, einsatz, d.id, ersteller, render)
            .await
            .unwrap();
        assert_eq!(frei.status, STATUS_FREIGEGEBEN);
        assert!(frei.etb_eintrag_id.is_some());
        assert_eq!(frei.freigegeben_von_id, Some(ersteller));

        let anzahl: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = ? AND {} = ?",
            f.etb_verweis
        )))
        .bind(einsatz)
        .bind(f.etb_typ)
        .bind(d.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(anzahl, 1);

        // Der Rückverweis ist auch über die ETB-Anzeige gelesen (nicht write-only):
        let etb = crate::etb::repo::laden(&pool, frei.etb_eintrag_id.unwrap())
            .await
            .unwrap();
        assert_eq!((f.verweis_gelesen)(&etb), Some(d.id));
        assert_eq!(etb.typ, f.etb_typ_enum);

        // Nochmals freigeben schlägt fehl (nicht mehr im Entwurf) → kein zweiter Eintrag.
        let err = freigeben::<T>(&pool, einsatz, d.id, ersteller, render)
            .await
            .unwrap_err();
        assert!(ist_422(&err, f.nicht_mehr_entwurf), "{err:?}");
        let anzahl2: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = ?")
                .bind(einsatz)
                .bind(f.etb_typ)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl2, 1);
    }

    #[tokio::test]
    async fn freigeben_schreibt_etb_und_macht_immutable() {
        freigeben_schreibt_etb_und_macht_immutable_fall::<Befehl>(&BEFEHL).await;
        freigeben_schreibt_etb_und_macht_immutable_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    /// LFH-690: Einsatz, Einstellungen (ETB-Startwert 100), Entwurf und Freigabe in EINER
    /// Transaktion. Über den Pool gelesen fänden die Einstellungen den noch nicht committeten
    /// Einsatz nicht, und der Snapshot bekäme still die Vorgabe-Nummer 1.
    async fn freigeben_tx_auf_der_verbindung_fall<T: Dokumentart>(f: &Fall) {
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
            let d = anlegen_tx::<T>(
                &mut *conn,
                einsatz,
                f.vorlage,
                f.titel,
                "2026-06-02 10:00:00",
                ersteller,
                None,
            )
            .await?;
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE {} SET abschnitte = ? WHERE id = ?",
                f.tabelle
            )))
            .bind(serde_json::to_string(&gefuellt::<T>(f, "Inhalt")).unwrap())
            .bind(d.id)
            .execute(&mut *conn)
            .await?;
            let frei = freigeben_tx::<T>(&mut *conn, einsatz, d.id, ersteller).await?;
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
        assert_eq!(inhalt, f.snapshot_inhalt);
        assert_eq!(laden::<T>(&pool, einsatz, frei.id).await.unwrap(), frei);
    }

    #[tokio::test]
    async fn freigeben_tx_liest_startwert_und_entwurf_auf_der_verbindung() {
        freigeben_tx_auf_der_verbindung_fall::<Befehl>(&BEFEHL).await;
        freigeben_tx_auf_der_verbindung_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    /// Die Freigabe prüft Inhalt und Vorlagen-Struktur; eine zweite Freigabe scheitert an der
    /// Status-Prüfung mit dem Wortlaut des Handlers, und die Hülle hinterlässt keinen zweiten
    /// Snapshot.
    async fn freigeben_gerendert_zweimal_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, ersteller, d) = mit_entwurf::<T>(f).await;
        let err = freigeben_gerendert::<T>(&pool, einsatz, d.id, ersteller)
            .await
            .unwrap_err();
        assert!(ist_422(&err, f.leer), "{err:?}");

        // Höchstens der erste Abschnitt, und nie alle: beim Befehl fehlt dann „Auftrag",
        // beim Freitext der einzige.
        let alle = gefuellt::<T>(f, "A");
        let teil = &alle[..(alle.len() - 1).min(1)];
        fuelle::<T>(&pool, einsatz, d.id, teil).await;
        let err = freigeben_gerendert::<T>(&pool, einsatz, d.id, ersteller)
            .await
            .unwrap_err();
        assert!(ist_422(&err, f.abschnitt_fehlt), "{err:?}");

        fuelle::<T>(&pool, einsatz, d.id, &alle).await;
        freigeben_gerendert::<T>(&pool, einsatz, d.id, ersteller)
            .await
            .unwrap();
        let err = freigeben_gerendert::<T>(&pool, einsatz, d.id, ersteller)
            .await
            .unwrap_err();
        assert!(ist_422(&err, f.bereits_freigegeben), "{err:?}");
        let n: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = ?")
                .bind(einsatz)
                .bind(f.etb_typ)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    async fn freigeben_gerendert_zweimal_ist_422_ohne_zweiten_snapshot() {
        freigeben_gerendert_zweimal_fall::<Befehl>(&BEFEHL).await;
        freigeben_gerendert_zweimal_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn fortschreiben_erzeugt_version_2_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, ersteller, d) = mit_entwurf::<T>(f).await;
        let alle = gefuellt::<T>(f, "A");
        fuelle::<T>(&pool, einsatz, d.id, &alle).await;
        freigeben::<T>(&pool, einsatz, d.id, ersteller, "render")
            .await
            .unwrap();

        let fort = fortschreiben::<T>(&pool, einsatz, d.id, ersteller, "2026-06-02 12:00:00")
            .await
            .unwrap();
        assert_eq!(fort.version, 2);
        assert_eq!(fort.vorgaenger_id, Some(d.id));
        assert_eq!(fort.status, STATUS_ENTWURF);
        assert_eq!(fort.vorlage, f.vorlage);
        // Fortschreibung übernimmt die Inhalte des freigegebenen Vorgängers als
        // Ausgangspunkt (nur Deltas bearbeiten); der ETB trägt jede Version separat.
        assert_eq!(fort.abschnitte, alle);
    }

    #[tokio::test]
    async fn fortschreiben_erzeugt_version_2_mit_vorgaenger() {
        fortschreiben_erzeugt_version_2_fall::<Befehl>(&BEFEHL).await;
        fortschreiben_erzeugt_version_2_fall::<Lagebericht>(&LAGEBERICHT).await;
    }

    async fn fortschreiben_nur_aus_freigegebenem_fall<T: Dokumentart>(f: &Fall) {
        let (pool, einsatz, ersteller, d) = mit_entwurf::<T>(f).await;
        let err = fortschreiben::<T>(&pool, einsatz, d.id, ersteller, "2026-06-02 12:00:00")
            .await
            .unwrap_err();
        assert!(ist_422(&err, f.nur_freigegebene), "{err:?}");
    }

    #[tokio::test]
    async fn fortschreiben_nur_aus_freigegebenem() {
        fortschreiben_nur_aus_freigegebenem_fall::<Befehl>(&BEFEHL).await;
        fortschreiben_nur_aus_freigegebenem_fall::<Lagebericht>(&LAGEBERICHT).await;
    }
}

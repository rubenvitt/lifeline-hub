use super::{LageZoneAnzeige, LageZoneTyp};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};

/// Felder zum Anlegen einer Zone (durch den Handler validiert/normalisiert).
#[derive(Debug)]
pub struct ZoneNeu<'a> {
    pub typ: &'a str,
    pub geometrie_typ: &'a str,
    pub geometrie: &'a str,
    pub label: Option<&'a str>,
    pub farbe: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// Ansichts-Zugehörigkeit (LFH-320): `None` = auf allen Ansichten sichtbar.
    pub ansicht_id: Option<i64>,
    /// Zugeordneter Evakuierungsbezirk (LFH-673). Der Handler hat Typ, Einsatz, Lebenszyklus
    /// und Modulrecht geprüft; hier wird nur geschrieben.
    pub evakuierungsbezirk_id: Option<i64>,
    pub erstellt_von: i64,
}

/// `None` = unverändert; `Some(None)` = auf NULL/abspalten; `Some(Some(x))` = setzen.
#[derive(Debug, Default)]
pub struct ZonePatch<'a> {
    pub typ: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
    pub farbe: Option<Option<&'a str>>,
    pub notiz: Option<Option<&'a str>>,
    pub gefahrengebiet_id: Option<Option<i64>>,
    /// Verschieben/Freigeben (LFH-320): `None` = unverändert, `Some(None)` = auf alle
    /// Ansichten (NULL), `Some(Some(x))` = auf Ansicht x.
    pub ansicht_id: Option<Option<i64>>,
    /// Bezirks-Zuordnung (LFH-673): `None` = unverändert, `Some(None)` = lösen,
    /// `Some(Some(x))` = zuordnen. Wechselt die Zone weg vom Typ `evakuierungsbezirk`, fällt
    /// die Zuordnung unabhängig davon (wie beim Gefahrengebiet).
    pub evakuierungsbezirk_id: Option<Option<i64>>,
}

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, \
           gefahrengebiet_id, ansicht_id, evakuierungsbezirk_id, erstellt_von, erstellt_at, \
           geaendert_at \
    FROM lage_zone";

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    #[sqlx(try_from = "String")]
    typ: LageZoneTyp,
    geometrie_typ: String,
    geometrie: String,
    label: Option<String>,
    farbe: Option<String>,
    notiz: Option<String>,
    gefahrengebiet_id: Option<i64>,
    ansicht_id: Option<i64>,
    evakuierungsbezirk_id: Option<i64>,
    erstellt_von: i64,
    erstellt_at: String,
    geaendert_at: String,
}

fn zu_anzeige(r: Row) -> LageZoneAnzeige {
    LageZoneAnzeige {
        id: r.id,
        einsatz_id: r.einsatz_id,
        typ: r.typ,
        geometrie_typ: r.geometrie_typ,
        geometrie: r.geometrie,
        label: r.label,
        farbe: r.farbe,
        notiz: r.notiz,
        gefahrengebiet_id: r.gefahrengebiet_id,
        ansicht_id: r.ansicht_id,
        evakuierungsbezirk_id: r.evakuierungsbezirk_id,
        erstellt_von: r.erstellt_von,
        erstellt_at: r.erstellt_at,
        geaendert_at: r.geaendert_at,
    }
}

/// Alle Zonen eines Einsatzes, älteste zuerst. `ansicht = Some(x)` filtert auf die Zonen der
/// Ansicht x PLUS die ansichtslosen (`ansicht_id IS NULL`); `None` liefert alles (LFH-320).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    ansicht: Option<i64>,
) -> Result<Vec<LageZoneAnzeige>, AppError> {
    let sql = match ansicht {
        Some(_) => format!(
            "{SELECT_ALLE} WHERE einsatz_id = ? AND (ansicht_id IS NULL OR ansicht_id = ?) ORDER BY id"
        ),
        None => format!("{SELECT_ALLE} WHERE einsatz_id = ? ORDER BY id"),
    };
    let mut q = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(sql)).bind(einsatz_id);
    if let Some(a) = ansicht {
        q = q.bind(a);
    }
    let rows = q.fetch_all(pool).await?;
    Ok(rows.into_iter().map(zu_anzeige).collect())
}

/// Lädt eine Zone; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<LageZoneAnzeige, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .map(zu_anzeige)
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (F06/LFH-244 Tier-A):
/// liefert die frische Anzeige samt geparster Felder für ETB-Text UND Response innerhalb
/// derselben `write_retry!`-Tx (analog `tier::repo::laden_tx`). `NotFound`, falls fremd.
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<LageZoneAnzeige, AppError> {
    sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .map(zu_anzeige)
    .ok_or(AppError::NotFound)
}

/// Legt eine Zone an (Felder bereits validiert) INNERHALB einer offenen Transaktion
/// (F06/LFH-244 Tier-A) und liefert die neue `id`. gefahrengebiet-Zonen tragen immer eine
/// Gruppe (Gruppe-von-eins beim Zeichnen); Gruppen-INSERT + Zonen-INSERT laufen im selben
/// `conn`, damit keine Ghost-Gruppe zurückbleibt. Beide sind reine INSERTs (retry-sicher:
/// bei ROLLBACK persistiert nichts).
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    daten: ZoneNeu<'_>,
) -> Result<i64, AppError> {
    let bezirk_id = if daten.typ == "evakuierungsbezirk" {
        daten.evakuierungsbezirk_id
    } else {
        None
    };
    if let Some(b) = bezirk_id {
        bezirk_lebt_tx(&mut *conn, einsatz_id, b).await?;
    }
    let gebiet_id = if daten.typ == "gefahrengebiet" {
        Some(
            crate::gefahr::repo::gebiet_anlegen(
                &mut *conn,
                einsatz_id,
                daten.label,
                daten.erstellt_von,
            )
            .await?,
        )
    } else {
        None
    };
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_zone \
            (einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, gefahrengebiet_id, ansicht_id, \
             evakuierungsbezirk_id, erstellt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.typ).bind(daten.geometrie_typ).bind(daten.geometrie)
    .bind(daten.label).bind(daten.farbe).bind(daten.notiz).bind(gebiet_id)
    // ansicht_id NUR in der Zone (LFH-320) — die Gefahrengebiet-Gruppe oben ist ansichtslos.
    .bind(daten.ansicht_id)
    // Nur an Bezirksflächen (LFH-673); an jedem anderen Typ bleibt die Spalte leer.
    .bind(bezirk_id)
    .bind(daten.erstellt_von)
    .fetch_one(&mut *conn).await?;
    Ok(id)
}

/// In-Tx-Wache der Bezirks-Zuordnung (LFH-673): der Bezirk gehört zum Einsatz und ist nicht
/// storniert — geprüft auf DERSELBEN Verbindung wie der Schreibvorgang. Die Route prüft
/// vorab (für die genauen Codes 403/404/409); diese Wache schließt das Fenster zwischen
/// Vorabprüfung und Schreiben, in dem ein paralleler Storno die Fläche sonst wieder an eine
/// Fehlanlage hängen ließe (Review LFH-673, Befund 2). Verfehlt → 409.
async fn bezirk_lebt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bezirk_id: i64,
) -> Result<(), AppError> {
    let lebt: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM evakuierungsbezirk \
         WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL)",
    )
    .bind(bezirk_id)
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if lebt {
        Ok(())
    } else {
        Err(AppError::Conflict(
            "Evakuierungsbezirk ist nicht mehr zuordenbar (storniert)".into(),
        ))
    }
}

/// Pool-Wrapper: legt an (eigene Tx) und lädt die Anzeige. Delegiert an [`anlegen_tx`].
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: ZoneNeu<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    let id = anlegen_tx(&mut conn, einsatz_id, daten).await?;
    drop(conn);
    laden(pool, einsatz_id, id).await
}

/// Partial-Update gegen den Effektivzustand (nur gesendete Felder ändern), `geaendert_at`
/// stets aktualisiert. Geometrie ist NICHT änderbar (kein Reshape). `NotFound`, falls fremd.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    daten: ZonePatch<'_>,
) -> Result<LageZoneAnzeige, AppError> {
    let vorher = laden(pool, einsatz_id, id).await?;
    let neuer_typ = daten.typ.unwrap_or(vorher.typ.as_str());
    let alt_gebiet = vorher.gefahrengebiet_id;

    // Gruppen-INSERT (Split/Neuanlage) und das anschließende UPDATE laufen atomar,
    // damit nie eine committete Gruppe ohne zugehörige Zone zurückbleibt.
    let mut tx = pool.begin().await?;

    // gefahrengebiet-Zonen tragen IMMER eine Gruppe. `Some(None)` heißt NICHT
    // „Spalte auf NULL", sondern „in NEUE eigene Gruppe abspalten".
    let ziel_gebiet: Option<i64> = if neuer_typ != "gefahrengebiet" {
        None
    } else {
        match daten.gefahrengebiet_id {
            Some(Some(zielid)) => Some(zielid),
            Some(None) => Some(
                crate::gefahr::repo::gebiet_anlegen(
                    &mut *tx,
                    einsatz_id,
                    vorher.label.as_deref(),
                    benutzer_id,
                )
                .await?,
            ),
            None => match alt_gebiet {
                Some(g) => Some(g),
                None => Some(
                    crate::gefahr::repo::gebiet_anlegen(
                        &mut *tx,
                        einsatz_id,
                        vorher.label.as_deref(),
                        benutzer_id,
                    )
                    .await?,
                ),
            },
        }
    };

    // Bezirks-Zuordnung (LFH-673): ein anderer Typ trägt nie einen Bezirk, sonst gewinnt der
    // Patch, sonst bleibt der Bestand — der Bestand aber aus der ZEILE (CASE im UPDATE), nicht
    // aus dem vorab gelesenen `vorher`: ein paralleler Storno hat sie womöglich schon gelöst,
    // und ein reiner Label-PATCH hängte die Fläche sonst wieder an die Fehlanlage (Review
    // LFH-673, Befund 2). Beim Setzen zusätzlich die Wache in derselben Transaktion.
    let bezirk_weg = neuer_typ != "evakuierungsbezirk";
    if !bezirk_weg {
        if let Some(Some(b)) = daten.evakuierungsbezirk_id {
            bezirk_lebt_tx(&mut tx, einsatz_id, b).await?;
        }
    }

    let betroffen = sqlx::query(
        "UPDATE lage_zone SET \
            typ   = CASE WHEN ? THEN ? ELSE typ END, \
            label = CASE WHEN ? THEN ? ELSE label END, \
            farbe = CASE WHEN ? THEN ? ELSE farbe END, \
            notiz = CASE WHEN ? THEN ? ELSE notiz END, \
            gefahrengebiet_id = ?, \
            ansicht_id = CASE WHEN ? THEN ? ELSE ansicht_id END, \
            evakuierungsbezirk_id = CASE WHEN ? THEN NULL WHEN ? THEN ? \
                                         ELSE evakuierungsbezirk_id END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.typ.is_some())
    .bind(daten.typ)
    .bind(daten.label.is_some())
    .bind(daten.label.flatten())
    .bind(daten.farbe.is_some())
    .bind(daten.farbe.flatten())
    .bind(daten.notiz.is_some())
    .bind(daten.notiz.flatten())
    // ziel_gebiet enthält bereits den Effektivwert (None-Arm = unverändert) → kein CASE nötig.
    .bind(ziel_gebiet)
    .bind(daten.ansicht_id.is_some())
    .bind(daten.ansicht_id.flatten())
    .bind(bezirk_weg)
    .bind(daten.evakuierungsbezirk_id.is_some())
    .bind(daten.evakuierungsbezirk_id.flatten())
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;

    // Verlassene Gruppe aufräumen, falls jetzt leer (Matrix cascaded mit weg).
    if alt_gebiet != ziel_gebiet {
        if let Some(g) = alt_gebiet {
            crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
        }
    }
    laden(pool, einsatz_id, id).await
}

/// Hard-Delete INNERHALB einer offenen Transaktion (F06/LFH-244 Tier-A). Liefert
/// [`Aufgeloest`] — u. a. die `gefahrengebiet_id` der gelöschten Zone (für das Aufräumen der ggf. verwaisten Gruppe
/// NACH dem Commit — das läuft auf dem Pool und darf nicht in dieselbe Tx, sonst Deadlock
/// gegen den eigenen Write-Lock). `NotFound`, falls nichts gelöscht wurde (fremd/inexistent).
pub async fn loese_auf_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<Aufgeloest, AppError> {
    let (gefahrengebiet_id, evakuierungsbezirk_id) =
        sqlx::query_as::<_, (Option<i64>, Option<i64>)>(
            "DELETE FROM lage_zone WHERE id = ? AND einsatz_id = ? \
             RETURNING gefahrengebiet_id, evakuierungsbezirk_id",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Aufgeloest {
        gefahrengebiet_id,
        evakuierungsbezirk_id,
    })
}

/// Was an einer gelöschten Zone hing — für die Nacharbeit NACH dem Commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Aufgeloest {
    /// Gefahrengebiet-Gruppe (Aufräumen einer ggf. verwaisten Gruppe).
    pub gefahrengebiet_id: Option<i64>,
    /// Evakuierungsbezirk (LFH-673): dessen Flächenzahl hat sich geändert → Live-Ereignis.
    pub evakuierungsbezirk_id: Option<i64>,
}

/// Pool-Wrapper: Hard-Delete (eigene Tx) + Aufräumen der verwaisten Gruppe. `NotFound`,
/// falls nicht zum Einsatz. Delegiert an [`loese_auf_tx`].
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let mut conn = pool.acquire().await?;
    let gebiet_id = loese_auf_tx(&mut conn, einsatz_id, id)
        .await?
        .gefahrengebiet_id;
    drop(conn);
    if let Some(g) = gebiet_id {
        crate::gefahr::repo::gebiet_aufraeumen_wenn_leer(pool, g).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org + Benutzer + Einsatz; liefert (einsatz_id, benutzer_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, benutzername, passwort_hash, anzeigename) \
             VALUES (1, 'tester', 'x', 'Tester') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, benutzer)
    }

    const POLY: &str =
        r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
    const LINE: &str = r#"{"type":"LineString","coordinates":[[8.6,50.1],[8.7,50.2]]}"#;

    #[tokio::test]
    async fn anlegen_gefahrengebiet_legt_gruppe_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: Some("Chemie Halle 3"),
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(
            z.gefahrengebiet_id.is_some(),
            "gefahrengebiet-Zone muss eine Gruppe tragen"
        );
        let geladen = laden(&pool, einsatz, z.id).await.unwrap();
        assert_eq!(geladen, z);
    }

    #[tokio::test]
    async fn anlegen_nicht_gefahrengebiet_ohne_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "freie_skizze",
                geometrie_typ: "LineString",
                geometrie: LINE,
                label: None,
                farbe: Some("#00ff00"),
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(z.gefahrengebiet_id.is_none());
    }

    #[tokio::test]
    async fn patch_label_merged_und_haelt_notiz() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: Some("A"),
                farbe: None,
                notiz: Some("Notiz bleibt"),
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                label: Some(Some("B")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.label.as_deref(), Some("B"));
        assert_eq!(n.notiz.as_deref(), Some("Notiz bleibt"));
        assert_eq!(
            n.gefahrengebiet_id, z.gefahrengebiet_id,
            "Gruppe bleibt bei reinem Label-PATCH"
        );
    }

    #[tokio::test]
    async fn merge_haengt_um_und_raeumt_leere_quellgruppe_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let a = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let b = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let ziel = b.gefahrengebiet_id.unwrap();
        let quelle = a.gefahrengebiet_id.unwrap();

        let a2 = aktualisiere(
            &pool,
            einsatz,
            a.id,
            von,
            ZonePatch {
                gefahrengebiet_id: Some(Some(ziel)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(a2.gefahrengebiet_id, Some(ziel));
        // Quellgruppe ist leer → aufgeräumt.
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, quelle)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn loeschen_letzter_zone_entfernt_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn typ_wechsel_weg_von_gefahrengebiet_loest_gruppe() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "gefahrengebiet",
                geometrie_typ: "Polygon",
                geometrie: POLY,
                label: None,
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        let gid = z.gefahrengebiet_id.unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                typ: Some("absperrbereich"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(n.gefahrengebiet_id.is_none());
        assert!(crate::gefahr::repo::gebiet_laden(&pool, einsatz, gid)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn loeschen_und_fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let z = anlegen(
            &pool,
            einsatz,
            ZoneNeu {
                typ: "absperrgrenze",
                geometrie_typ: "LineString",
                geometrie: LINE,
                label: None,
                farbe: None,
                notiz: None,
                ansicht_id: None,
                evakuierungsbezirk_id: None,
                erstellt_von: von,
            },
        )
        .await
        .unwrap();
        assert!(matches!(
            laden(&pool, 999, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
        loese_auf(&pool, einsatz, z.id).await.unwrap();
        assert!(matches!(
            laden(&pool, einsatz, z.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    // ── LFH-673: Bezirks-Zuordnung — Wache in der Transaktion, Bestand aus der Zeile ──

    async fn bezirk(pool: &SqlitePool, einsatz: i64, von: i64, storniert: bool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO evakuierungsbezirk \
                (einsatz_id, bezeichnung, plan_personen, plan_erhebung, angelegt_von_id, \
                 storniert_at) \
             VALUES (?, ?, 640, 'geschaetzt', ?, CASE WHEN ? THEN datetime('now') END) \
             RETURNING id",
        )
        .bind(einsatz)
        .bind(if storniert {
            "Fehlanlage"
        } else {
            "Uferstraße"
        })
        .bind(von)
        .bind(storniert)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn bezirksflaeche(von: i64, bezirk: Option<i64>) -> ZoneNeu<'static> {
        ZoneNeu {
            typ: "evakuierungsbezirk",
            geometrie_typ: "Polygon",
            geometrie: POLY,
            label: None,
            farbe: None,
            notiz: None,
            ansicht_id: None,
            evakuierungsbezirk_id: bezirk,
            erstellt_von: von,
        }
    }

    /// Am Vorabcheck der Route vorbei: die Wache in der Transaktion lehnt einen stornierten
    /// Bezirk selbst ab (409) — sonst schlösse ein paralleler Storno das Fenster nicht.
    #[tokio::test]
    async fn stornierter_bezirk_scheitert_an_der_wache_in_der_transaktion() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let tot = bezirk(&pool, einsatz, von, true).await;
        let err = anlegen(&pool, einsatz, bezirksflaeche(von, Some(tot)))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        let z = anlegen(&pool, einsatz, bezirksflaeche(von, None))
            .await
            .unwrap();
        let err = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                evakuierungsbezirk_id: Some(Some(tot)),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            laden(&pool, einsatz, z.id)
                .await
                .unwrap()
                .evakuierungsbezirk_id,
            None
        );
    }

    /// Ein Patch ohne Zuordnung lässt die Spalte, wie sie in der ZEILE steht — nicht wie ein
    /// vorab gelesener Stand sie zeigte.
    #[tokio::test]
    async fn label_patch_laesst_die_zuordnung_der_zeile_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, von) = setup(&pool).await;
        let b = bezirk(&pool, einsatz, von, false).await;
        let z = anlegen(&pool, einsatz, bezirksflaeche(von, Some(b)))
            .await
            .unwrap();
        let n = aktualisiere(
            &pool,
            einsatz,
            z.id,
            von,
            ZonePatch {
                label: Some(Some("Nordufer")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(n.evakuierungsbezirk_id, Some(b));
        assert_eq!(n.label.as_deref(), Some("Nordufer"));
    }

    #[tokio::test]
    async fn verweis_zeigt_auf_evakuierungsbezirk_mit_set_null() {
        let pool = crate::db::test_pool().await;
        let fk: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT \"table\", \"to\", on_delete FROM pragma_foreign_key_list('lage_zone') \
             WHERE \"from\" = 'evakuierungsbezirk_id'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            fk,
            vec![("evakuierungsbezirk".into(), "id".into(), "SET NULL".into())]
        );
    }
}

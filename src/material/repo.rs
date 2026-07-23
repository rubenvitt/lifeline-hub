use super::{Material, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Material` (FromRow).
const SPALTEN: &str = "id, org_id, bezeichnung, kategorie, bestandsnummer, \
     traegerorganisation, standort, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
#[derive(Debug)]
pub struct MaterialDaten<'a> {
    pub bezeichnung: &'a str,
    pub kategorie: Option<&'a str>,
    pub bestandsnummer: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub bemerkung: Option<&'a str>,
}

/// Übersetzt einen Unique-Verstoß auf dem Bestandsnummer-Index in `Conflict`.
fn bestandsnummer_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Bestandsnummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Material der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Material, AppError> {
    sqlx::query_as::<_, Material>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM material WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Material-Stücke der Org, sortiert nach Bezeichnung.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Material>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY bezeichnung")
    } else {
        format!("SELECT {SPALTEN} FROM material WHERE org_id = ? ORDER BY bezeichnung")
    };
    sqlx::query_as::<_, Material>(sqlx::AssertSqlSafe(&*sql))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Abgeleitete Kategorie-Vorschläge (DISTINCT, org-weit, nicht-leer, sortiert) für die
/// AutoComplete. Kein eigener Katalog/keine eigene Tabelle.
pub async fn kategorien(pool: &SqlitePool, org_id: i64) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT kategorie FROM material \
         WHERE org_id = ? AND kategorie IS NOT NULL AND kategorie <> '' \
         ORDER BY kategorie",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Legt ein Material an. Dublette Bestandsnummer (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO material \
            (org_id, bezeichnung, kategorie, bestandsnummer, traegerorganisation, standort, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return bestandsnummer_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Teil-Patch der editierbaren Stammfelder (LFH-306, Tri-State): die äußere `Option` sagt
/// „im Patch enthalten?" — `None` lässt die Spalte unverändert. Bei den nullable Spalten
/// trägt der Wert selbst noch eine `Option`: `Some(None)` setzt sie auf NULL.
#[derive(Debug, Default)]
pub struct MaterialPatch<'a> {
    pub bezeichnung: Option<&'a str>,
    pub kategorie: Option<Option<&'a str>>,
    pub bestandsnummer: Option<Option<&'a str>>,
    pub traegerorganisation: Option<Option<&'a str>>,
    pub standort: Option<Option<&'a str>>,
    pub bemerkung: Option<Option<&'a str>>,
}

/// Teil-Patch der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Bestandsnummer-Dublette — beides unverändert gegenüber dem früheren
/// Vollersatz.
///
/// Flag/Wert-Paare statt COALESCE (LFH-266/F12, Vorlage `personal/status_repo.rs`): erst so
/// lässt sich eine nullable Spalte über die API wieder auf NULL setzen, und ein nicht
/// gesendetes Feld fasst seine Spalte nicht an. Die Parameter sind **nummeriert**, weil
/// eine um eine Position verschobene Bind-Kette die gleichtypigen Nachbarspalten
/// (`standort`↔`bemerkung`) STILL vertauschen würde — abgesichert von
/// `patche_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: MaterialPatch<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE material SET \
            bezeichnung = CASE WHEN ?1 IS NULL THEN bezeichnung ELSE ?2 END, \
            kategorie = CASE WHEN ?3 IS NULL THEN kategorie ELSE ?4 END, \
            bestandsnummer = CASE WHEN ?5 IS NULL THEN bestandsnummer ELSE ?6 END, \
            traegerorganisation = CASE WHEN ?7 IS NULL THEN traegerorganisation ELSE ?8 END, \
            standort = CASE WHEN ?9 IS NULL THEN standort ELSE ?10 END, \
            bemerkung = CASE WHEN ?11 IS NULL THEN bemerkung ELSE ?12 END \
         WHERE id = ?13 AND org_id = ?14",
    )
    .bind(patch.bezeichnung.map(|_| 1_i64))
    .bind(patch.bezeichnung)
    .bind(patch.kategorie.map(|_| 1_i64))
    .bind(patch.kategorie.and_then(|v| v))
    .bind(patch.bestandsnummer.map(|_| 1_i64))
    .bind(patch.bestandsnummer.and_then(|v| v))
    .bind(patch.traegerorganisation.map(|_| 1_i64))
    .bind(patch.traegerorganisation.and_then(|v| v))
    .bind(patch.standort.map(|_| 1_i64))
    .bind(patch.standort.and_then(|v| v))
    .bind(patch.bemerkung.map(|_| 1_i64))
    .bind(patch.bemerkung.and_then(|v| v))
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Bestandsnummer-Dublette.
///
/// **Nicht mehr im Produktivpfad** — die PATCH-Route nutzt seit LFH-306 [`patche`].
/// Bleibt stehen, weil die co-lokierten Tests von `material/disposition_repo.rs` sie als
/// Stamm-Änderungs-Werkzeug (Snapshot-vs-Live) aufrufen.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: MaterialDaten<'_>,
) -> Result<Material, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE material SET \
            bezeichnung = ?, kategorie = ?, bestandsnummer = ?, \
            traegerorganisation = ?, standort = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.kategorie)
    .bind(daten.bestandsnummer)
    .bind(daten.traegerorganisation)
    .bind(daten.standort)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei fremder
/// Org; `Conflict`, wenn beim Reaktivieren die Bestandsnummer inzwischen aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Material, AppError> {
    let neuer = if in_dienst {
        DIENSTSTATUS_IN_DIENST
    } else {
        DIENSTSTATUS_AUSSER_DIENST
    };
    let ergebnis = sqlx::query("UPDATE material SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return bestandsnummer_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn org(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'Orga')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    fn daten(bezeichnung: &str) -> MaterialDaten<'_> {
        MaterialDaten {
            bezeichnung,
            kategorie: Some("Betreuung"),
            bestandsnummer: None,
            traegerorganisation: None,
            standort: None,
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert_eq!(m.bezeichnung, "Wolldecke");
        assert_eq!(m.dienststatus, "in_dienst");
        assert_eq!(laden(&pool, 1, m.id).await.unwrap().id, m.id);
    }

    #[tokio::test]
    async fn bezeichnung_nicht_eindeutig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(
            anlegen(&pool, 1, daten("Wolldecke")).await.is_ok(),
            "zwei 'Wolldecke' erlaubt"
        );
    }

    #[tokio::test]
    async fn bestandsnummer_dublette_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, d).await.unwrap();
        let mut d2 = daten("Stromerzeuger 2");
        d2.bestandsnummer = Some("INV-1");
        assert!(matches!(
            anlegen(&pool, 1, d2).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn bestandsnummer_null_beliebig_oft() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("A")).await.unwrap();
        anlegen(&pool, 1, daten("B")).await.unwrap();
        assert_eq!(liste(&pool, 1, false).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn bestandsnummer_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let mut a = daten("Gerät");
        a.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, a).await.unwrap();
        let mut b = daten("Gerät");
        b.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 2, b).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_gibt_bestandsnummer_frei() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        let m = anlegen(&pool, 1, d).await.unwrap();

        setze_dienststatus(&pool, 1, m.id, false).await.unwrap();
        assert!(
            liste(&pool, 1, true).await.unwrap().is_empty(),
            "nicht in nur_im_dienst"
        );
        assert_eq!(
            liste(&pool, 1, false).await.unwrap().len(),
            1,
            "aber referenzierbar"
        );
        let mut neu = daten("Stromerzeuger neu");
        neu.bestandsnummer = Some("INV-1");
        assert!(anlegen(&pool, 1, neu).await.is_ok());
    }

    #[tokio::test]
    async fn kategorien_distinct_sortiert() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        for (b, k) in [
            ("Decke", "Betreuung"),
            ("Sandsack", "Hochwasser"),
            ("Wolldecke", "Betreuung"),
        ] {
            let mut d = daten(b);
            d.kategorie = Some(k);
            anlegen(&pool, 1, d).await.unwrap();
        }
        assert_eq!(
            kategorien(&pool, 1).await.unwrap(),
            vec!["Betreuung".to_string(), "Hochwasser".to_string()]
        );
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, m.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    /// Migriert aus `aktualisiere_ersetzt_felder` (LFH-306): dieselbe fachliche Zusage —
    /// gesendete Felder kommen an — jetzt über `patche`.
    #[tokio::test]
    async fn patche_ersetzt_gesendete_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        let g = patche(
            &pool,
            1,
            m.id,
            MaterialPatch {
                bezeichnung: Some("Wolldecke gross"),
                kategorie: Some(Some("Sanitaet")),
                standort: Some(Some("Lagerhalle 2")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "Wolldecke gross");
        assert_eq!(g.kategorie.as_deref(), Some("Sanitaet"));
        assert_eq!(g.standort.as_deref(), Some("Lagerhalle 2"));
    }

    /// Migriert aus `aktualisiere_fremde_org_ist_notfound` (LFH-306). Mandantengrenze
    /// (LFH-232): ein Patch mit fremder `org_id` trifft die Zeile nicht und ist `NotFound`,
    /// nicht etwa ein stiller No-Op.
    #[tokio::test]
    async fn patche_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                2,
                m.id,
                MaterialPatch {
                    bezeichnung: Some("X"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(
            laden(&pool, 1, m.id).await.unwrap().bezeichnung,
            "Wolldecke",
            "fremde Org darf nichts geschrieben haben"
        );
    }

    /// Bind-Reihenfolge der Flag/Wert-Kette: alle sechs Spalten in EINEM Patch auf distinkte
    /// Werte setzen und einzeln prüfen. Eine um eine Position verschobene Kette würde
    /// gleichtypige Nachbarspalten (`standort`↔`bemerkung`) still vertauschen — ohne
    /// Compile- und ohne Laufzeitfehler.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        let g = patche(
            &pool,
            1,
            m.id,
            MaterialPatch {
                bezeichnung: Some("B-Wert"),
                kategorie: Some(Some("K-Wert")),
                bestandsnummer: Some(Some("N-Wert")),
                traegerorganisation: Some(Some("T-Wert")),
                standort: Some(Some("S-Wert")),
                bemerkung: Some(Some("M-Wert")),
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "B-Wert");
        assert_eq!(g.kategorie.as_deref(), Some("K-Wert"));
        assert_eq!(g.bestandsnummer.as_deref(), Some("N-Wert"));
        assert_eq!(g.traegerorganisation.as_deref(), Some("T-Wert"));
        assert_eq!(g.standort.as_deref(), Some("S-Wert"));
        assert_eq!(g.bemerkung.as_deref(), Some("M-Wert"));
    }

    /// Der Kern von LFH-306: ein Patch fasst NUR die gesendeten Spalten an. Der
    /// `Default`-Patch (alle Felder absent) darf die Zeile Byte für Byte so lassen.
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let m = anlegen(
            &pool,
            1,
            MaterialDaten {
                bezeichnung: "Wolldecke",
                kategorie: Some("Betreuung"),
                bestandsnummer: Some("INV-1"),
                traegerorganisation: Some("DRK"),
                standort: Some("Halle 1"),
                bemerkung: Some("geprüft"),
            },
        )
        .await
        .unwrap();

        // Nur `bezeichnung` im Patch.
        let g = patche(
            &pool,
            1,
            m.id,
            MaterialPatch {
                bezeichnung: Some("Wolldecke gross"),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bezeichnung, "Wolldecke gross");
        assert_eq!(g.kategorie.as_deref(), Some("Betreuung"), "unberührt");
        assert_eq!(g.bestandsnummer.as_deref(), Some("INV-1"), "unberührt");
        assert_eq!(g.traegerorganisation.as_deref(), Some("DRK"), "unberührt");
        assert_eq!(g.standort.as_deref(), Some("Halle 1"), "unberührt");
        assert_eq!(g.bemerkung.as_deref(), Some("geprüft"), "unberührt");

        // Leerer Patch → alles bleibt, insbesondere kein NotFound.
        let u = patche(&pool, 1, m.id, MaterialPatch::default())
            .await
            .unwrap();
        assert_eq!(u.bezeichnung, "Wolldecke gross");
        assert_eq!(u.standort.as_deref(), Some("Halle 1"));
    }

    /// `Some(None)` ist der Leerwunsch und muss von „absent" unterscheidbar sein —
    /// grenzt gegen `patche_laesst_nicht_gesendete_spalten_stehen` ab.
    #[tokio::test]
    async fn patche_none_loescht_die_spalte() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Wolldecke");
        d.standort = Some("Halle 1");
        let m = anlegen(&pool, 1, d).await.unwrap();
        let g = patche(
            &pool,
            1,
            m.id,
            MaterialPatch {
                standort: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.standort, None);
        assert_eq!(
            g.kategorie.as_deref(),
            Some("Betreuung"),
            "Nachbar unberührt"
        );
        assert_eq!(g.bezeichnung, "Wolldecke", "Nachbar unberührt");
    }

    /// Die Bestandsnummer-Dublette bleibt auch im Teil-Patch ein `Conflict` (Verhalten
    /// aus dem Vollersatz übernommen).
    #[tokio::test]
    async fn patche_auf_vergebene_bestandsnummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut belegt = daten("Stromerzeuger");
        belegt.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, belegt).await.unwrap();
        let m = anlegen(&pool, 1, daten("Wolldecke")).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                1,
                m.id,
                MaterialPatch {
                    bestandsnummer: Some(Some("INV-1")),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebene_bestandsnummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let mut d = daten("Stromerzeuger");
        d.bestandsnummer = Some("INV-1");
        let alt = anlegen(&pool, 1, d).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Nummer inzwischen neu vergeben.
        let mut neu = daten("Stromerzeuger neu");
        neu.bestandsnummer = Some("INV-1");
        anlegen(&pool, 1, neu).await.unwrap();
        // Reaktivieren des alten kollidiert -> Conflict.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }
}

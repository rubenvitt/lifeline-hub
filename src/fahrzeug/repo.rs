use super::{Fahrzeug, FahrzeugVorschlaege, DIENSTSTATUS_AUSSER_DIENST, DIENSTSTATUS_IN_DIENST};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;

/// Spaltenliste für `SELECT` in der Reihenfolge von `Fahrzeug` (FromRow).
const SPALTEN: &str = "id, org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, \
     opta, standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
     staerke_unterfuehrer, staerke_mannschaft, bemerkung, dienststatus, angelegt_at";

/// Editierbare Stammfelder. Optional-Strings sind bereits getrimmt; leer → `None`.
/// `staerke` ist bereits validiert (alle drei oder keiner).
#[derive(Debug)]
pub struct FahrzeugDaten<'a> {
    pub funkrufname: &'a str,
    pub fahrzeugtyp: Option<&'a str>,
    pub traegerorganisation: Option<&'a str>,
    pub kennzeichen: Option<&'a str>,
    pub opta: Option<&'a str>,
    pub standort: Option<&'a str>,
    pub fms_issi: Option<&'a str>,
    pub sondersignal: bool,
    pub tragenkapazitaet: Option<i64>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<&'a str>,
}

/// Zerlegt eine optionale Stärke in drei `Option<i64>` (DB-Spalten).
fn zerlege_staerke(s: Option<Staerke>) -> (Option<i64>, Option<i64>, Option<i64>) {
    match s {
        Some(s) => (
            Some(s.fuehrer as i64),
            Some(s.unterfuehrer as i64),
            Some(s.mannschaft as i64),
        ),
        None => (None, None, None),
    }
}

/// Übersetzt einen Unique-Verstoß auf dem Funkrufname-Index in `Conflict`.
fn funkrufname_conflict<T>(e: sqlx::Error) -> Result<T, AppError> {
    if let sqlx::Error::Database(db) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Funkrufname ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    Err(e.into())
}

/// Lädt ein Fahrzeug der eigenen Org; `NotFound`, falls unbekannt oder fremde Org.
pub async fn laden(pool: &SqlitePool, org_id: i64, id: i64) -> Result<Fahrzeug, AppError> {
    sqlx::query_as::<_, Fahrzeug>(sqlx::AssertSqlSafe(format!(
        "SELECT {SPALTEN} FROM fahrzeug WHERE id = ? AND org_id = ?"
    )))
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Alle Fahrzeuge der Org, sortiert nach Funkrufname.
/// `nur_im_dienst` filtert auf `dienststatus = 'in_dienst'` (Dispositions-Auswahl).
pub async fn liste(
    pool: &SqlitePool,
    org_id: i64,
    nur_im_dienst: bool,
) -> Result<Vec<Fahrzeug>, AppError> {
    let sql = if nur_im_dienst {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? AND dienststatus = 'in_dienst' ORDER BY funkrufname")
    } else {
        format!("SELECT {SPALTEN} FROM fahrzeug WHERE org_id = ? ORDER BY funkrufname")
    };
    sqlx::query_as::<_, Fahrzeug>(sqlx::AssertSqlSafe(&*sql))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// DISTINCT-Werte einer Spalte (org-weit, nicht-leer, sortiert) für die AutoComplete.
/// `spalte` wird in die Query interpoliert und darf daher AUSSCHLIESSLICH mit
/// festen Literalen aufgerufen werden (keine Nutzereingabe).
async fn distinct_werte(
    pool: &SqlitePool,
    org_id: i64,
    spalte: &str,
) -> Result<Vec<String>, AppError> {
    sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(format!(
        "SELECT DISTINCT {spalte} FROM fahrzeug \
         WHERE org_id = ? AND {spalte} IS NOT NULL AND {spalte} <> '' \
         ORDER BY {spalte}"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Abgeleitete AutoComplete-Vorschläge (DISTINCT, org-weit) für die Stamm-Comboboxen:
/// Fahrzeugtyp, Trägerorganisation und Standort — jeweils die bereits verwendeten Werte.
pub async fn vorschlaege(pool: &SqlitePool, org_id: i64) -> Result<FahrzeugVorschlaege, AppError> {
    Ok(FahrzeugVorschlaege {
        fahrzeugtyp: distinct_werte(pool, org_id, "fahrzeugtyp").await?,
        traegerorganisation: distinct_werte(pool, org_id, "traegerorganisation").await?,
        standort: distinct_werte(pool, org_id, "standort").await?,
    })
}

/// Legt ein Fahrzeug an. Dublette Funkrufname (unter aktiven) → `Conflict`.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query_scalar::<_, i64>(
        "INSERT INTO fahrzeug \
            (org_id, funkrufname, fahrzeugtyp, traegerorganisation, kennzeichen, opta, \
             standort, fms_issi, sondersignal, tragenkapazitaet, staerke_fuehrer, \
             staerke_unterfuehrer, staerke_mannschaft, bemerkung) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .fetch_one(pool)
    .await;

    let id = match ergebnis {
        Ok(id) => id,
        Err(e) => return funkrufname_conflict(e),
    };
    laden(pool, org_id, id).await
}

/// Teil-Patch der editierbaren Stammfelder (LFH-306, Tri-State): die äußere `Option` sagt
/// „im Patch enthalten?" — `None` lässt die Spalte unverändert. Bei den nullable Spalten
/// trägt der Wert selbst noch eine `Option`: `Some(None)` setzt sie auf NULL.
///
/// Das Stärke-Trio liegt hier bewusst als **drei einzelne Spalten** (nicht als
/// `Option<Staerke>`): nur so lässt sich eine einzelne Soll-Spalte patchen. Die Invariante
/// „alle drei oder keiner" prüft der Handler gegen den Effektivzustand.
#[derive(Debug, Default)]
pub struct FahrzeugPatch<'a> {
    pub funkrufname: Option<&'a str>,
    pub fahrzeugtyp: Option<Option<&'a str>>,
    pub traegerorganisation: Option<Option<&'a str>>,
    pub kennzeichen: Option<Option<&'a str>>,
    pub opta: Option<Option<&'a str>>,
    pub standort: Option<Option<&'a str>>,
    pub fms_issi: Option<Option<&'a str>>,
    pub sondersignal: Option<bool>,
    pub tragenkapazitaet: Option<Option<i64>>,
    pub staerke_fuehrer: Option<Option<i64>>,
    pub staerke_unterfuehrer: Option<Option<i64>>,
    pub staerke_mannschaft: Option<Option<i64>>,
    pub bemerkung: Option<Option<&'a str>>,
}

/// Rohes Soll-Stärke-Trio eines Fahrzeugs (org-scoped) für die Effektivzustands-Prüfung im
/// PATCH-Handler; `NotFound` bei fremder/unbekannter id. Bewusst NICHT `Option<Staerke>` —
/// die Prüfung braucht die drei Spalten einzeln, `staerke()` würde ein halbes Trio
/// (theoretisch, historisch) zu `None` glätten. Vorlage: `einheit/typ_repo.rs::soll_roh`.
pub async fn staerke_roh(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
) -> Result<(Option<i64>, Option<i64>, Option<i64>), AppError> {
    sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<i64>)>(
        "SELECT staerke_fuehrer, staerke_unterfuehrer, staerke_mannschaft \
         FROM fahrzeug WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Teil-Patch der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Funkrufname-Dublette — beides unverändert gegenüber dem Vollersatz.
///
/// Flag/Wert-Paare statt COALESCE (LFH-266/F12, Vorlage `personal/status_repo.rs`): erst so
/// lässt sich eine nullable Spalte über die API wieder auf NULL setzen, und ein nicht
/// gesendetes Feld fasst seine Spalte nicht an. Die Parameter sind **nummeriert** — das ist
/// hier die längste Flag/Wert-Kette des Bestands (13 Spalten = 26 Parameter), und eine um
/// eine Position verschobene Kette würde gleichtypige Nachbarspalten (`opta`↔`standort`,
/// `staerke_fuehrer`↔`staerke_unterfuehrer`) STILL vertauschen — ohne Compile- und ohne
/// Laufzeitfehler. Abgesichert von `patche_setzt_jede_spalte_an_ihren_platz`.
///
/// Geschrieben wird **nur der Patch**, nie das im Handler gemergte Stärke-Trio — sonst wäre
/// es wieder ein Vollersatz.
pub async fn patche(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: FahrzeugPatch<'_>,
) -> Result<Fahrzeug, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE fahrzeug SET \
            funkrufname = CASE WHEN ?1 IS NULL THEN funkrufname ELSE ?2 END, \
            fahrzeugtyp = CASE WHEN ?3 IS NULL THEN fahrzeugtyp ELSE ?4 END, \
            traegerorganisation = CASE WHEN ?5 IS NULL THEN traegerorganisation ELSE ?6 END, \
            kennzeichen = CASE WHEN ?7 IS NULL THEN kennzeichen ELSE ?8 END, \
            opta = CASE WHEN ?9 IS NULL THEN opta ELSE ?10 END, \
            standort = CASE WHEN ?11 IS NULL THEN standort ELSE ?12 END, \
            fms_issi = CASE WHEN ?13 IS NULL THEN fms_issi ELSE ?14 END, \
            sondersignal = CASE WHEN ?15 IS NULL THEN sondersignal ELSE ?16 END, \
            tragenkapazitaet = CASE WHEN ?17 IS NULL THEN tragenkapazitaet ELSE ?18 END, \
            staerke_fuehrer = CASE WHEN ?19 IS NULL THEN staerke_fuehrer ELSE ?20 END, \
            staerke_unterfuehrer = CASE WHEN ?21 IS NULL THEN staerke_unterfuehrer ELSE ?22 END, \
            staerke_mannschaft = CASE WHEN ?23 IS NULL THEN staerke_mannschaft ELSE ?24 END, \
            bemerkung = CASE WHEN ?25 IS NULL THEN bemerkung ELSE ?26 END \
         WHERE id = ?27 AND org_id = ?28",
    )
    .bind(patch.funkrufname.map(|_| 1_i64))
    .bind(patch.funkrufname)
    .bind(patch.fahrzeugtyp.map(|_| 1_i64))
    .bind(patch.fahrzeugtyp.and_then(|v| v))
    .bind(patch.traegerorganisation.map(|_| 1_i64))
    .bind(patch.traegerorganisation.and_then(|v| v))
    .bind(patch.kennzeichen.map(|_| 1_i64))
    .bind(patch.kennzeichen.and_then(|v| v))
    .bind(patch.opta.map(|_| 1_i64))
    .bind(patch.opta.and_then(|v| v))
    .bind(patch.standort.map(|_| 1_i64))
    .bind(patch.standort.and_then(|v| v))
    .bind(patch.fms_issi.map(|_| 1_i64))
    .bind(patch.fms_issi.and_then(|v| v))
    .bind(patch.sondersignal.map(|_| 1_i64))
    .bind(patch.sondersignal)
    .bind(patch.tragenkapazitaet.map(|_| 1_i64))
    .bind(patch.tragenkapazitaet.and_then(|v| v))
    .bind(patch.staerke_fuehrer.map(|_| 1_i64))
    .bind(patch.staerke_fuehrer.and_then(|v| v))
    .bind(patch.staerke_unterfuehrer.map(|_| 1_i64))
    .bind(patch.staerke_unterfuehrer.and_then(|v| v))
    .bind(patch.staerke_mannschaft.map(|_| 1_i64))
    .bind(patch.staerke_mannschaft.and_then(|v| v))
    .bind(patch.bemerkung.map(|_| 1_i64))
    .bind(patch.bemerkung.and_then(|v| v))
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Vollersatz der editierbaren Felder (org-scoped). `NotFound` bei fremder Org,
/// `Conflict` bei Funkrufname-Dublette.
///
/// **Nicht mehr im Produktivpfad** — die PATCH-Route nutzt seit LFH-306 [`patche`].
/// Bleibt stehen, weil die co-lokierten Tests von `fahrzeug/disposition_repo.rs` sie als
/// Stamm-Änderungs-Werkzeug (Snapshot-vs-Live) aufrufen.
pub async fn aktualisiere(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    daten: FahrzeugDaten<'_>,
) -> Result<Fahrzeug, AppError> {
    let (sf, su, sm) = zerlege_staerke(daten.staerke);
    let ergebnis = sqlx::query(
        "UPDATE fahrzeug SET \
            funkrufname = ?, fahrzeugtyp = ?, traegerorganisation = ?, kennzeichen = ?, \
            opta = ?, standort = ?, fms_issi = ?, sondersignal = ?, tragenkapazitaet = ?, \
            staerke_fuehrer = ?, staerke_unterfuehrer = ?, staerke_mannschaft = ?, bemerkung = ? \
         WHERE id = ? AND org_id = ?",
    )
    .bind(daten.funkrufname)
    .bind(daten.fahrzeugtyp)
    .bind(daten.traegerorganisation)
    .bind(daten.kennzeichen)
    .bind(daten.opta)
    .bind(daten.standort)
    .bind(daten.fms_issi)
    .bind(daten.sondersignal)
    .bind(daten.tragenkapazitaet)
    .bind(sf)
    .bind(su)
    .bind(sm)
    .bind(daten.bemerkung)
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
    };
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, org_id, id).await
}

/// Setzt den Dienststatus (Soft-Delete bzw. Reaktivierung). `NotFound` bei
/// fremder Org; `Conflict`, wenn beim Reaktivieren der Funkrufname inzwischen
/// aktiv vergeben ist.
pub async fn setze_dienststatus(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    in_dienst: bool,
) -> Result<Fahrzeug, AppError> {
    let neuer = if in_dienst {
        DIENSTSTATUS_IN_DIENST
    } else {
        DIENSTSTATUS_AUSSER_DIENST
    };
    let ergebnis = sqlx::query("UPDATE fahrzeug SET dienststatus = ? WHERE id = ? AND org_id = ?")
        .bind(neuer)
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await;

    let resultat = match ergebnis {
        Ok(r) => r,
        Err(e) => return funkrufname_conflict(e),
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

    fn daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname,
            fahrzeugtyp: Some("LF 20"),
            traegerorganisation: None,
            kennzeichen: None,
            opta: None,
            standort: None,
            fms_issi: None,
            sondersignal: false,
            tragenkapazitaet: None,
            staerke: Some(Staerke::neu(0, 1, 8)),
            bemerkung: None,
        }
    }

    #[tokio::test]
    async fn anlegen_und_laden() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert_eq!(f.funkrufname, "Florian 1");
        assert_eq!(f.staerke().unwrap().anzeige(), "0/1/8//9");
        assert_eq!(laden(&pool, 1, f.id).await.unwrap().id, f.id);
    }

    #[tokio::test]
    async fn laden_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            laden(&pool, 2, f.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn dublette_funkrufname_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            anlegen(&pool, 1, daten("Florian 1")).await.unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn funkrufname_je_org_unabhaengig() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(anlegen(&pool, 2, daten("Florian 1")).await.is_ok());
    }

    #[tokio::test]
    async fn soft_delete_versteckt_aus_nur_im_dienst_bleibt_referenzierbar() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();

        setze_dienststatus(&pool, 1, f.id, false).await.unwrap();
        assert!(
            liste(&pool, 1, true).await.unwrap().is_empty(),
            "nicht in nur_im_dienst"
        );
        assert_eq!(
            liste(&pool, 1, false).await.unwrap().len(),
            1,
            "aber weiter referenzierbar"
        );
        assert_eq!(
            laden(&pool, 1, f.id).await.unwrap().dienststatus,
            "ausser_dienst"
        );
    }

    #[tokio::test]
    async fn reaktivieren_auf_vergebenen_namen_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let alt = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        setze_dienststatus(&pool, 1, alt.id, false).await.unwrap();
        // Name inzwischen neu vergeben.
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        // Reaktivieren des alten Fahrzeugs kollidiert → Conflict.
        assert!(matches!(
            setze_dienststatus(&pool, 1, alt.id, true)
                .await
                .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn aktualisiere_ersetzt_felder() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        let mut neu = daten("Florian 1");
        neu.kennzeichen = Some("XX-AB 123");
        neu.staerke = None;
        let g = aktualisiere(&pool, 1, f.id, neu).await.unwrap();
        assert_eq!(g.kennzeichen.as_deref(), Some("XX-AB 123"));
        assert_eq!(g.staerke(), None);
    }

    /// Alle 13 editierbaren Spalten liegen distinkt gefüllt vor — Ausgangspunkt der
    /// Bind-Reihenfolge- und Nicht-Anfassen-Tests.
    fn volle_daten(funkrufname: &str) -> FahrzeugDaten<'_> {
        FahrzeugDaten {
            funkrufname,
            fahrzeugtyp: Some("LF 20"),
            traegerorganisation: Some("Feuerwehr"),
            kennzeichen: Some("XX-AB 123"),
            opta: Some("OPTA-1"),
            standort: Some("Wache Mitte"),
            fms_issi: Some("ISSI-9"),
            sondersignal: true,
            tragenkapazitaet: Some(3),
            staerke: Some(Staerke::neu(1, 2, 5)),
            bemerkung: Some("Bemerkung alt"),
        }
    }

    /// Bind-Reihenfolge der längsten Flag/Wert-Kette im Bestand: alle 13 Spalten in EINEM
    /// Patch auf distinkte Werte setzen und einzeln prüfen. Eine um eine Position
    /// verschobene Kette würde gleichtypige Nachbarspalten (`opta`↔`standort`,
    /// `staerke_fuehrer`↔`staerke_unterfuehrer`) still vertauschen.
    #[tokio::test]
    async fn patche_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        let g = patche(
            &pool,
            1,
            f.id,
            FahrzeugPatch {
                funkrufname: Some("Florian 9"),
                fahrzeugtyp: Some(Some("typ-wert")),
                traegerorganisation: Some(Some("traeger-wert")),
                kennzeichen: Some(Some("kennzeichen-wert")),
                opta: Some(Some("opta-wert")),
                standort: Some(Some("standort-wert")),
                fms_issi: Some(Some("issi-wert")),
                sondersignal: Some(true),
                tragenkapazitaet: Some(Some(7)),
                staerke_fuehrer: Some(Some(11)),
                staerke_unterfuehrer: Some(Some(22)),
                staerke_mannschaft: Some(Some(33)),
                bemerkung: Some(Some("bemerkung-wert")),
            },
        )
        .await
        .unwrap();
        assert_eq!(g.funkrufname, "Florian 9");
        assert_eq!(g.fahrzeugtyp.as_deref(), Some("typ-wert"));
        assert_eq!(g.traegerorganisation.as_deref(), Some("traeger-wert"));
        assert_eq!(g.kennzeichen.as_deref(), Some("kennzeichen-wert"));
        assert_eq!(g.opta.as_deref(), Some("opta-wert"));
        assert_eq!(g.standort.as_deref(), Some("standort-wert"));
        assert_eq!(g.fms_issi.as_deref(), Some("issi-wert"));
        assert!(g.sondersignal);
        assert_eq!(g.tragenkapazitaet, Some(7));
        assert_eq!(g.staerke_fuehrer, Some(11));
        assert_eq!(g.staerke_unterfuehrer, Some(22));
        assert_eq!(g.staerke_mannschaft, Some(33));
        assert_eq!(g.bemerkung.as_deref(), Some("bemerkung-wert"));
    }

    /// Der Kern von LFH-306: ein Patch fasst NUR die gesendeten Spalten an. Der
    /// `Default`-Patch (alle Felder absent) darf die Zeile Byte für Byte so lassen.
    #[tokio::test]
    async fn patche_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, volle_daten("Florian 1")).await.unwrap();

        // Nur `bemerkung` im Patch.
        let g = patche(
            &pool,
            1,
            f.id,
            FahrzeugPatch {
                bemerkung: Some(Some("Bemerkung neu")),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.bemerkung.as_deref(), Some("Bemerkung neu"));
        assert_eq!(g.funkrufname, "Florian 1", "unberührt");
        assert_eq!(g.fahrzeugtyp.as_deref(), Some("LF 20"), "unberührt");
        assert_eq!(
            g.traegerorganisation.as_deref(),
            Some("Feuerwehr"),
            "unberührt"
        );
        assert_eq!(g.kennzeichen.as_deref(), Some("XX-AB 123"), "unberührt");
        assert_eq!(g.opta.as_deref(), Some("OPTA-1"), "unberührt");
        assert_eq!(g.standort.as_deref(), Some("Wache Mitte"), "unberührt");
        assert_eq!(g.fms_issi.as_deref(), Some("ISSI-9"), "unberührt");
        assert!(g.sondersignal, "NOT-NULL-Bool darf nicht auf false fallen");
        assert_eq!(g.tragenkapazitaet, Some(3), "unberührt");
        assert_eq!(g.staerke().unwrap().anzeige(), "1/2/5//8", "unberührt");

        // Leerer Patch → alles bleibt, insbesondere kein NotFound.
        let u = patche(&pool, 1, f.id, FahrzeugPatch::default())
            .await
            .unwrap();
        assert_eq!(u.bemerkung.as_deref(), Some("Bemerkung neu"));
        assert!(u.sondersignal);
        assert_eq!(u.staerke().unwrap().anzeige(), "1/2/5//8");
    }

    /// `Some(None)` ist der Leerwunsch und muss von „absent" unterscheidbar sein;
    /// `Some(false)` ist beim NOT-NULL-Bool der Setz-Wunsch und darf nicht als „absent"
    /// durchrutschen (das Flag ist `?15 IS NULL`, nicht der Wert selbst).
    #[tokio::test]
    async fn patche_none_loescht_und_sondersignal_false_setzt() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        let f = anlegen(&pool, 1, volle_daten("Florian 1")).await.unwrap();

        let g = patche(
            &pool,
            1,
            f.id,
            FahrzeugPatch {
                kennzeichen: Some(None),
                tragenkapazitaet: Some(None),
                sondersignal: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(g.kennzeichen, None);
        assert_eq!(g.tragenkapazitaet, None);
        assert!(!g.sondersignal, "Some(false) muss die Spalte auf 0 setzen");
        assert_eq!(g.opta.as_deref(), Some("OPTA-1"), "Nachbar unberührt");
    }

    #[tokio::test]
    async fn patche_fremde_org_ist_notfound() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let f = anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                2,
                f.id,
                FahrzeugPatch {
                    funkrufname: Some("fremd"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::NotFound
        ));
        assert_eq!(
            laden(&pool, 1, f.id).await.unwrap().funkrufname,
            "Florian 1",
            "fremde Org darf nichts geschrieben haben"
        );
    }

    #[tokio::test]
    async fn patche_auf_vergebenen_funkrufnamen_ist_conflict() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap();
        let zwei = anlegen(&pool, 1, daten("Florian 2")).await.unwrap();
        assert!(matches!(
            patche(
                &pool,
                1,
                zwei.id,
                FahrzeugPatch {
                    funkrufname: Some("Florian 1"),
                    ..Default::default()
                }
            )
            .await
            .unwrap_err(),
            AppError::Conflict(_)
        ));
    }

    #[tokio::test]
    async fn staerke_roh_liefert_spalten_und_notfound_bei_fremder_org() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        org(&pool, 2).await;
        let f = anlegen(&pool, 1, volle_daten("Florian 1")).await.unwrap();
        assert_eq!(
            staerke_roh(&pool, 1, f.id).await.unwrap(),
            (Some(1), Some(2), Some(5))
        );
        assert!(matches!(
            staerke_roh(&pool, 2, f.id).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn vorschlaege_distinct_je_feld() {
        let pool = crate::db::test_pool().await;
        org(&pool, 1).await;
        anlegen(&pool, 1, daten("Florian 1")).await.unwrap(); // LF 20
        let mut rtw = daten("Rettung 1");
        rtw.fahrzeugtyp = Some("RTW");
        rtw.traegerorganisation = Some("DRK");
        rtw.standort = Some("Wache Mitte");
        anlegen(&pool, 1, rtw).await.unwrap();
        let mut lf2 = daten("Florian 2");
        lf2.fahrzeugtyp = Some("LF 20"); // Dublette Typ
        lf2.traegerorganisation = Some("Feuerwehr");
        lf2.standort = Some("Wache Mitte"); // Dublette Standort
        anlegen(&pool, 1, lf2).await.unwrap();

        let v = vorschlaege(&pool, 1).await.unwrap();
        assert_eq!(v.fahrzeugtyp, vec!["LF 20".to_string(), "RTW".to_string()]);
        assert_eq!(
            v.traegerorganisation,
            vec!["DRK".to_string(), "Feuerwehr".to_string()]
        );
        assert_eq!(
            v.standort,
            vec!["Wache Mitte".to_string()],
            "DISTINCT je Feld"
        );
    }
}

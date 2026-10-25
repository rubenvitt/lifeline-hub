//! Der eine Standort eines Material-Postens (LLH-1224, Spec `material-modell`, design.md D6–D9).
//!
//! Ein Posten liegt an höchstens EINEM Ort: einer Einheit, einem Fahrzeug (Beladung), einer UHS,
//! einem Bereitstellungsraum oder keinem („ohne Ort“). Die Datenbank hält das als CHECK über die
//! vier Spalten `einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id`
//! (`migrations/0197_material_modell.sql`). Jeder Schreibweg, der den Ort ändert, geht über
//! [`set_ort_tx`]: Vorwert lesen, nur ein neues Ziel prüfen, alle vier Spalten in einer Anweisung
//! schreiben. Über HTTP ist das allein die Material-Disposition (PATCH, Disponieren, Aufteilen;
//! Spec `material-modell`, „Ein Schreibweg für den Ort“, LLH-1253). Den Wortlaut im ETB
//! liefert [`ort_text_tx`] mit [`super::etb_text_ort_gewechselt`].

use crate::error::AppError;
use sqlx::SqliteConnection;

/// Ein Ort eines Postens; die ID ist die Zeile des Ziels im Einsatz.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterialOrt {
    /// `einsatz_einheit.id`
    Einheit(i64),
    /// `einsatz_fahrzeug.id` (Beladung)
    Fahrzeug(i64),
    /// `uhs.id`
    Uhs(i64),
    /// `bereitstellungsraum.id`
    Bereitstellungsraum(i64),
}

impl MaterialOrt {
    /// Der Ort aus den vier Spalten (`einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`, `br_id`);
    /// `None` = ohne Ort. Die Datenbank lässt höchstens einen zu.
    pub fn aus_spalten(
        einheit_id: Option<i64>,
        einsatz_fahrzeug_id: Option<i64>,
        uhs_id: Option<i64>,
        br_id: Option<i64>,
    ) -> Option<Self> {
        einheit_id
            .map(Self::Einheit)
            .or(einsatz_fahrzeug_id.map(Self::Fahrzeug))
            .or(uhs_id.map(Self::Uhs))
            .or(br_id.map(Self::Bereitstellungsraum))
    }

    /// Die vier Spalten eines Orts in der Folge `einheit_id`, `einsatz_fahrzeug_id`, `uhs_id`,
    /// `br_id`.
    pub fn spalten(ort: Option<Self>) -> [Option<i64>; 4] {
        let mut s = [None; 4];
        match ort {
            Some(Self::Einheit(id)) => s[0] = Some(id),
            Some(Self::Fahrzeug(id)) => s[1] = Some(id),
            Some(Self::Uhs(id)) => s[2] = Some(id),
            Some(Self::Bereitstellungsraum(id)) => s[3] = Some(id),
            None => {}
        }
        s
    }
}

/// Die Ort-Felder einer Anfrage (PATCH und POST, design.md D7), Tri-State wie `uhs_id` vor
/// LLH-1224: fehlt = unverändert, Wert = Posten dorthin, `null` = von DIESEM Ort lösen, wenn der
/// Posten dort ist (sonst ohne Wirkung).
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct OrtPatch {
    pub einheit_id: Option<Option<i64>>,
    pub einsatz_fahrzeug_id: Option<Option<i64>>,
    pub uhs_id: Option<Option<i64>>,
    pub br_id: Option<Option<i64>>,
}

impl OrtPatch {
    fn felder(&self) -> [(Option<Option<i64>>, fn(i64) -> MaterialOrt); 4] {
        [
            (self.einheit_id, MaterialOrt::Einheit),
            (self.einsatz_fahrzeug_id, MaterialOrt::Fahrzeug),
            (self.uhs_id, MaterialOrt::Uhs),
            (self.br_id, MaterialOrt::Bereitstellungsraum),
        ]
    }

    /// Nennt die Anfrage überhaupt ein Ort-Feld?
    pub fn is_empty(&self) -> bool {
        self.felder().iter().all(|(f, _)| f.is_none())
    }

    /// Mehr als ein Ort-Feld mit Wert ist eine Feld-Kombination: 422 (`src/AGENTS.md`,
    /// Statuscode-Konvention), geprüft vor der Transaktion.
    pub fn validate(&self) -> Result<(), AppError> {
        let werte = self
            .felder()
            .iter()
            .filter(|(f, _)| matches!(f, Some(Some(_))))
            .count();
        if werte > 1 {
            return Err(AppError::UnprocessableEntity(
                "Ein Posten hat höchstens einen Ort".into(),
            ));
        }
        Ok(())
    }

    /// Das Ziel gegen den aktuellen Ort: `None` = unverändert, `Some(None)` = ohne Ort,
    /// `Some(Some(o))` = dorthin. Ein `null` an einem Ort, an dem der Posten nicht ist, ändert
    /// nichts.
    pub fn ziel(&self, aktuell: Option<MaterialOrt>) -> Option<Option<MaterialOrt>> {
        for (feld, bau) in self.felder() {
            if let Some(Some(id)) = feld {
                return Some(Some(bau(id)));
            }
        }
        for (feld, bau) in self.felder() {
            if feld == Some(None) {
                if let Some(ort) = aktuell {
                    if std::mem::discriminant(&ort) == std::mem::discriminant(&bau(0)) {
                        return Some(None);
                    }
                }
            }
        }
        None
    }
}

/// Vorher und nachher eines Ortswechsels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrtWechsel {
    pub vorher: Option<MaterialOrt>,
    pub nachher: Option<MaterialOrt>,
}

impl OrtWechsel {
    pub fn is_changed(&self) -> bool {
        self.vorher != self.nachher
    }
}

/// Der gespeicherte Ort eines Postens; `NotFound`, wenn die Zeile nicht zum Einsatz gehört.
pub async fn load_ort_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
) -> Result<Option<MaterialOrt>, AppError> {
    let (einheit, fahrzeug, uhs, br): (Option<i64>, Option<i64>, Option<i64>, Option<i64>) =
        sqlx::query_as(
            "SELECT einheit_id, einsatz_fahrzeug_id, uhs_id, br_id FROM einsatz_material \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(em_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(MaterialOrt::aus_spalten(einheit, fahrzeug, uhs, br))
}

/// Prüft ein neues Ziel, je Ort mit dessen eigener Regel (design.md D8): fremd oder unbekannt
/// 404; aufgelöste Einheit und entlassenes oder storniertes Fahrzeug 409 (Kräfte mit
/// Lebenszyklus, LLH-1079); stornierte UHS oder stornierter Bereitstellungsraum 404, aufgelöste
/// 422 (Orte mit Status).
pub async fn require_ziel_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ziel: MaterialOrt,
) -> Result<(), AppError> {
    match ziel {
        MaterialOrt::Einheit(id) => {
            crate::einheit::repo::require_aktiv_tx(conn, einsatz_id, id).await
        }
        MaterialOrt::Fahrzeug(id) => {
            crate::fahrzeug::disposition_repo::require_aktiv_tx(conn, einsatz_id, id).await
        }
        MaterialOrt::Uhs(id) => crate::uhs::repo::require_verortbar_tx(conn, einsatz_id, id).await,
        MaterialOrt::Bereitstellungsraum(id) => {
            crate::bereitstellungsraum::repo::require_verortbar_tx(conn, einsatz_id, id).await
        }
    }
}

/// Setzt den Ort eines Postens, der einzige Schreibweg dafür (design.md D9): beendetes Material
/// 409, fremde Zeile 404; derselbe Ort schreibt nichts; ein anderes Ziel geht durch
/// [`require_ziel_tx`]; alle vier Spalten in einer Anweisung, der bisherige Ort ist damit gelöst.
/// Lösen (`None`) prüft nichts. Jede Ablehnung schreibt nichts.
pub async fn set_ort_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    em_id: i64,
    ziel: Option<MaterialOrt>,
) -> Result<OrtWechsel, AppError> {
    super::disposition_repo::require_aktiv_tx(conn, einsatz_id, em_id).await?;
    let vorher = load_ort_tx(conn, einsatz_id, em_id).await?;
    let wechsel = OrtWechsel {
        vorher,
        nachher: ziel,
    };
    if !wechsel.is_changed() {
        return Ok(wechsel);
    }
    if let Some(ziel) = ziel {
        require_ziel_tx(conn, einsatz_id, ziel).await?;
    }
    let [einheit, fahrzeug, uhs, br] = MaterialOrt::spalten(ziel);
    sqlx::query(
        "UPDATE einsatz_material \
         SET einheit_id = ?, einsatz_fahrzeug_id = ?, uhs_id = ?, br_id = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit)
    .bind(fahrzeug)
    .bind(uhs)
    .bind(br)
    .bind(em_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(wechsel)
}

/// Wie viele Posten des Einsatzes liegen noch an diesem Ort? Gezählt wird nur Material im Einsatz
/// (`beendet_at IS NULL`). Storno von UHS und Bereitstellungsraum lehnt ab, solange es welche gibt
/// (LLH-1249), sonst zeigte ein Posten auf einen stornierten Ort.
pub async fn count_posten_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ort: MaterialOrt,
) -> Result<i64, AppError> {
    let (spalte, id) = match ort {
        MaterialOrt::Einheit(id) => ("einheit_id", id),
        MaterialOrt::Fahrzeug(id) => ("einsatz_fahrzeug_id", id),
        MaterialOrt::Uhs(id) => ("uhs_id", id),
        MaterialOrt::Bereitstellungsraum(id) => ("br_id", id),
    };
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM einsatz_material \
         WHERE einsatz_id = ? AND {spalte} = ? AND beendet_at IS NULL"
    )))
    .bind(einsatz_id)
    .bind(id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Der Ort im ETB-Wortlaut (design.md D11): „Einheit «Staffel A»“, „Fahrzeug «Florian 1/83-1»“
/// (aufgelöst wie `EinsatzFahrzeugAnzeige.funkrufname`), „UHS «Turnhalle»“,
/// „Bereitstellungsraum «BR Nord»“, ohne Ort „ohne Ort“. Einsatzkräfte und Lagestruktur, keine
/// Scrub-Werte (`src/AGENTS.md`, „Scrub-Werte in System-ETB-Texten“).
pub async fn ort_text_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ort: Option<MaterialOrt>,
) -> Result<String, AppError> {
    let (art, sql, id) = match ort {
        None => return Ok(OHNE_ORT.into()),
        Some(MaterialOrt::Fahrzeug(id)) => {
            let f = crate::fahrzeug::disposition_repo::load_anzeige_tx(conn, einsatz_id, id, true)
                .await?;
            return Ok(format!("Fahrzeug «{}»", f.funkrufname));
        }
        Some(MaterialOrt::Einheit(id)) => (
            "Einheit",
            "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        Some(MaterialOrt::Uhs(id)) => (
            "UHS",
            "SELECT bezeichnung FROM uhs WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        Some(MaterialOrt::Bereitstellungsraum(id)) => (
            "Bereitstellungsraum",
            "SELECT bezeichnung FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
            id,
        ),
    };
    let name: String = sqlx::query_scalar(sql)
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(format!("{art} «{name}»"))
}

/// Wortlaut für einen Posten ohne Ort.
pub const OHNE_ORT: &str = "ohne Ort";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    #[test]
    fn spalten_und_zurueck() {
        for ort in [
            None,
            Some(MaterialOrt::Einheit(1)),
            Some(MaterialOrt::Fahrzeug(2)),
            Some(MaterialOrt::Uhs(3)),
            Some(MaterialOrt::Bereitstellungsraum(4)),
        ] {
            let [a, b, c, d] = MaterialOrt::spalten(ort);
            assert_eq!(MaterialOrt::aus_spalten(a, b, c, d), ort);
            assert!([a, b, c, d].iter().filter(|s| s.is_some()).count() <= 1);
        }
    }

    #[test]
    fn ortpatch_ziel_nach_d7() {
        let uhs = Some(MaterialOrt::Uhs(3));
        let leer = OrtPatch::default();
        assert!(leer.is_empty());
        assert_eq!(leer.ziel(uhs), None, "fehlt = unverändert");
        let dorthin = OrtPatch {
            br_id: Some(Some(9)),
            ..OrtPatch::default()
        };
        assert_eq!(
            dorthin.ziel(uhs),
            Some(Some(MaterialOrt::Bereitstellungsraum(9)))
        );
        let loesen = OrtPatch {
            uhs_id: Some(None),
            ..OrtPatch::default()
        };
        assert_eq!(loesen.ziel(uhs), Some(None), "null am aktuellen Ort löst");
        let fremd = OrtPatch {
            einheit_id: Some(None),
            ..OrtPatch::default()
        };
        assert_eq!(
            fremd.ziel(uhs),
            None,
            "null an einem fremden Ort ändert nichts"
        );
        assert_eq!(fremd.ziel(None), None);
        // Wert und Lösen eines anderen Orts: der Wert gewinnt, der alte Ort geht ohnehin.
        let beides = OrtPatch {
            einheit_id: Some(Some(1)),
            uhs_id: Some(None),
            ..OrtPatch::default()
        };
        assert!(beides.validate().is_ok());
        assert_eq!(beides.ziel(uhs), Some(Some(MaterialOrt::Einheit(1))));
    }

    #[test]
    fn zwei_orte_mit_wert_sind_422() {
        let zwei = OrtPatch {
            einheit_id: Some(Some(1)),
            uhs_id: Some(Some(2)),
            ..OrtPatch::default()
        };
        assert!(matches!(
            zwei.validate().unwrap_err(),
            AppError::UnprocessableEntity(m) if m == "Ein Posten hat höchstens einen Ort"
        ));
    }

    /// Einsatz mit je einem Ort jeder Art; liefert (einsatz, einheit, fahrzeug, uhs, br, em).
    async fn bild(pool: &SqlitePool) -> (i64, i64, i64, i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einheit: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Staffel A') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        let fahrzeug: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
             VALUES (?, 'Florian 1/83-1') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'Turnhalle', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'BR Nord', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        let em: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, menge, art) \
             VALUES (?, 'Wolldecke', 20, 'verbrauchsgut') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        (e, einheit, fahrzeug, uhs, br, em)
    }

    async fn setze(
        pool: &SqlitePool,
        e: i64,
        em: i64,
        ziel: Option<MaterialOrt>,
    ) -> Result<OrtWechsel, AppError> {
        set_ort_tx(&mut pool.acquire().await.unwrap(), e, em, ziel).await
    }

    async fn ort(pool: &SqlitePool, e: i64, em: i64) -> Option<MaterialOrt> {
        load_ort_tx(&mut pool.acquire().await.unwrap(), e, em)
            .await
            .unwrap()
    }

    async fn text(pool: &SqlitePool, e: i64, o: Option<MaterialOrt>) -> String {
        ort_text_tx(&mut pool.acquire().await.unwrap(), e, o)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn set_ort_wechselt_jede_ortsart_und_loest_den_alten() {
        let pool = test_pool().await;
        let (e, einheit, fahrzeug, uhs, br, em) = bild(&pool).await;
        let mut vorher = None;
        for ziel in [
            MaterialOrt::Einheit(einheit),
            MaterialOrt::Fahrzeug(fahrzeug),
            MaterialOrt::Uhs(uhs),
            MaterialOrt::Bereitstellungsraum(br),
        ] {
            let w = setze(&pool, e, em, Some(ziel)).await.unwrap();
            assert_eq!(
                w,
                OrtWechsel {
                    vorher,
                    nachher: Some(ziel)
                }
            );
            assert_eq!(ort(&pool, e, em).await, Some(ziel), "genau ein Ort");
            vorher = Some(ziel);
        }
        let gleich = setze(&pool, e, em, vorher).await.unwrap();
        assert!(!gleich.is_changed(), "derselbe Ort schreibt nichts");
        let los = setze(&pool, e, em, None).await.unwrap();
        assert!(los.is_changed());
        assert_eq!(ort(&pool, e, em).await, None, "ohne Ort");
    }

    #[tokio::test]
    async fn ort_text_nennt_jede_ortsart() {
        let pool = test_pool().await;
        let (e, einheit, fahrzeug, uhs, br, _) = bild(&pool).await;
        assert_eq!(text(&pool, e, None).await, "ohne Ort");
        assert_eq!(
            text(&pool, e, Some(MaterialOrt::Einheit(einheit))).await,
            "Einheit «Staffel A»"
        );
        assert_eq!(
            text(&pool, e, Some(MaterialOrt::Fahrzeug(fahrzeug))).await,
            "Fahrzeug «Florian 1/83-1»"
        );
        assert_eq!(
            text(&pool, e, Some(MaterialOrt::Uhs(uhs))).await,
            "UHS «Turnhalle»"
        );
        assert_eq!(
            text(&pool, e, Some(MaterialOrt::Bereitstellungsraum(br))).await,
            "Bereitstellungsraum «BR Nord»"
        );
    }

    /// Prüfung des Ziels nach D8, je Ort mit seiner Regel; Lösen und ein unveränderter Ort
    /// prüfen nichts.
    #[tokio::test]
    async fn ziel_wird_je_ortsart_geprueft() {
        let pool = test_pool().await;
        let (e, einheit, fahrzeug, uhs, br, em) = bild(&pool).await;
        let code = |r: Result<OrtWechsel, AppError>| match r {
            Ok(_) => 200,
            Err(AppError::NotFound) => 404,
            Err(AppError::Conflict(_)) => 409,
            Err(AppError::UnprocessableEntity(_)) => 422,
            Err(other) => panic!("unerwartet: {other:?}"),
        };
        // Fremd/unbekannt: 404 je Ortsart.
        for ziel in [
            MaterialOrt::Einheit(9999),
            MaterialOrt::Fahrzeug(9999),
            MaterialOrt::Uhs(9999),
            MaterialOrt::Bereitstellungsraum(9999),
        ] {
            assert_eq!(code(setze(&pool, e, em, Some(ziel)).await), 404, "{ziel:?}");
        }
        // Geplanter BR geht (Vorgabe `geplant`), danach steht der Posten dort.
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Bereitstellungsraum(br))).await),
            200
        );
        // Aufgelöster BR: unverändert geht, ein neues Ziel nicht.
        sqlx::query("UPDATE bereitstellungsraum SET status = 'aufgeloest' WHERE id = ?")
            .bind(br)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Bereitstellungsraum(br))).await),
            200,
            "unveränderter Ort wird nicht geprüft"
        );
        assert_eq!(code(setze(&pool, e, em, None).await), 200, "Lösen gelingt");
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Bereitstellungsraum(br))).await),
            422
        );
        sqlx::query("UPDATE uhs SET status = 'aufgeloest' WHERE id = ?")
            .bind(uhs)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Uhs(uhs))).await),
            422
        );
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-10-14 10:00:00' WHERE id = ?",
        )
        .bind(einheit)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Einheit(einheit))).await),
            409
        );
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET beendet_at = '2026-10-14 10:00:00', \
                 beendet_als = 'entlassen' WHERE id = ?",
        )
        .bind(fahrzeug)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            code(setze(&pool, e, em, Some(MaterialOrt::Fahrzeug(fahrzeug))).await),
            409
        );
        assert_eq!(
            ort(&pool, e, em).await,
            None,
            "jede Ablehnung schreibt nichts"
        );
        // Beendetes Material: 409 vor jeder Zielprüfung.
        sqlx::query(
            "UPDATE einsatz_material SET beendet_at = '2026-10-14 10:00:00', \
                 beendet_als = 'entlassen' WHERE id = ?",
        )
        .bind(em)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(code(setze(&pool, e, em, None).await), 409);
    }
}

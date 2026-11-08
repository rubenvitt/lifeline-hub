//! Kopplung des Schichtplans an die Ablösung (LLH-1555, Change `qo0amhd5-wechsel-aus-schichtplan`,
//! design.md D2; Spec `kraefte-abloesung`, „Fälligkeit laut Plan“).
//!
//! **Eine Uhr:** Hat die Einheit einer laufenden Schicht Blöcke im Plan, ist die Schicht zum
//! nächsten Wechselpunkt fällig (Beginn oder Ende eines Blocks der Einheit), gerechnet ab dem
//! **Anker**: Beginn der Schicht plus [`WECHSEL_TOLERANZ_MINUTEN`], bei einem Vollzug aus dem Plan
//! frühestens der Beginn des Blocks, in den gewechselt wurde. Der Plan gilt, wenn der Anker in
//! einem Block liegt oder der Wechselpunkt vor der Fälligkeit nach Rangfolge liegt: Er zieht vor,
//! er schiebt eine Schicht außerhalb des Plans nie hinaus.
//!
//! **Folgeblock** ist der Block der Einheit, der binnen der Toleranz ab dem Wechselpunkt beginnt;
//! fehlt er, endet der Posten. Gelesen werden nur die Blöcke der Einheit, die die Schicht trägt,
//! nicht die ihrer Erben.
//!
//! [`plan_faelligkeit`] ist rein; Laden und Schreiben stehen in `abloesung::repo`
//! (`nachziehen_plan_tx`), damit Fälligkeit und Fristen an einer Stelle entstehen.

use sqlx::SqliteConnection;

use crate::error::AppError;
use crate::zeit;

/// Wer bis zu so viele Minuten vor einem Wechselpunkt beginnt, gehört schon zum Block danach;
/// ebenso beginnt ein Folgeblock höchstens so viele Minuten nach dem Wechselpunkt.
pub const WECHSEL_TOLERANZ_MINUTEN: i64 = 15;

/// SQL-Fragment: der Folgeblock einer Schicht mit dem Alias `a`, wie [`plan_faelligkeit`] ihn
/// wählt (Beginn binnen der Toleranz ab der Fälligkeit, der früheste). `uhs_id IS NULL` lässt
/// `idx_planschicht_posten` bis `von` greifen. Die 15 im Text hält
/// `toleranz_im_sql_wie_die_konstante` gleich [`WECHSEL_TOLERANZ_MINUTEN`].
macro_rules! folgeblock_sql {
    () => {
        "(SELECT f.id FROM einsatz_planschicht f \
          WHERE f.einsatz_id = a.einsatz_id AND f.posten_art = 'einheit' \
            AND f.einheit_id = a.einheit_id AND f.uhs_id IS NULL \
            AND f.von >= a.faellig_at AND f.von <= datetime(a.faellig_at, '+15 minutes') \
          ORDER BY f.von, f.id LIMIT 1)"
    };
}
pub(crate) use folgeblock_sql;

/// SQL-Bedingung (design.md D4): die Schicht `a` ist laut Plan fällig und braucht keine
/// Planung, weil ihr Folgeblock Personen hat oder der Posten endet (kein Folgeblock). Ein
/// Folgeblock ohne Personen braucht sie.
macro_rules! plan_braucht_keine_planung_sql {
    () => {
        concat!(
            "(a.faellig_laut_plan = 1 AND NOT EXISTS (SELECT 1 FROM einsatz_planschicht fb \
              WHERE fb.id = ",
            $crate::abloesung::schichtplan::kopplung::folgeblock_sql!(),
            " AND NOT EXISTS (SELECT 1 FROM einsatz_planschicht_person fp \
                              WHERE fp.planschicht_id = fb.id)))"
        )
    };
}
pub(crate) use plan_braucht_keine_planung_sql;

/// Ein Block einer Einheit, wie die Kopplung ihn braucht. Zeiten kanonisch (`zeit::FORMAT`).
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct BlockZeit {
    pub id: i64,
    pub von: String,
    pub bis: String,
    /// Zahl der eingeteilten Personen.
    pub personen: i64,
}

/// Ergebnis der Kopplung: der Plan gibt die Fälligkeit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanFaelligkeit {
    pub faellig_at: String,
    /// Der Block, in dem der Anker liegt; `None`, wenn die Schicht vor ihrem ersten Block läuft.
    pub block_id: Option<i64>,
    /// Der Block, der am Wechselpunkt beginnt; `None` = der Posten endet.
    pub folgeblock: Option<BlockZeit>,
}

/// Fälligkeit laut Plan (design.md D2), `None` wenn die Rangfolge gilt. `anker_von` ist der
/// Beginn des Blocks, in den ein Vollzug aus dem Plan gewechselt hat; `regulaer` die Fälligkeit
/// nach Rangfolge. Ein unlesbarer Beginn ergibt `None` (die Rangfolge meldet den Fehler selbst).
pub fn plan_faelligkeit(
    beginn_at: &str,
    anker_von: Option<&str>,
    bloecke: &[BlockZeit],
    regulaer: &str,
) -> Option<PlanFaelligkeit> {
    let mut anker = zeit::plus_minuten(beginn_at, WECHSEL_TOLERANZ_MINUTEN)?;
    if let Some(v) = anker_von.filter(|v| *v > anker.as_str()) {
        anker = v.to_string();
    }
    let anker = anker.as_str();
    let laufend = bloecke
        .iter()
        .find(|b| b.von.as_str() <= anker && anker < b.bis.as_str());
    let wechsel = bloecke
        .iter()
        .flat_map(|b| [b.von.as_str(), b.bis.as_str()])
        .filter(|p| *p > anker)
        .min()?;
    if laufend.is_none() && wechsel >= regulaer {
        return None;
    }
    let spaetestens = zeit::plus_minuten(wechsel, WECHSEL_TOLERANZ_MINUTEN)?;
    let folgeblock = bloecke
        .iter()
        .filter(|b| b.von.as_str() >= wechsel && b.von.as_str() <= spaetestens.as_str())
        .min_by(|a, b| a.von.cmp(&b.von))
        .cloned();
    Some(PlanFaelligkeit {
        faellig_at: wechsel.to_string(),
        block_id: laufend.map(|b| b.id),
        folgeblock,
    })
}

/// Die Blöcke einer Einheit, die nach `ab` enden, nach Beginn.
pub(crate) async fn load_bloecke_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    ab: &str,
) -> Result<Vec<BlockZeit>, AppError> {
    Ok(sqlx::query_as(
        "SELECT b.id, b.von, b.bis, \
                (SELECT COUNT(*) FROM einsatz_planschicht_person p \
                 WHERE p.planschicht_id = b.id) AS personen \
         FROM einsatz_planschicht b \
         WHERE b.einsatz_id = ? AND b.posten_art = 'einheit' AND b.einheit_id = ? AND b.bis > ? \
         ORDER BY b.von, b.id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(ab)
    .fetch_all(&mut *conn)
    .await?)
}

/// Beginn eines Blocks der Einheit; `None`, wenn er fehlt oder an einem anderen Posten steht
/// (dann trägt er die Schicht nicht mehr, der Anker entfällt).
pub(crate) async fn load_anker_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
    block_id: Option<i64>,
) -> Result<Option<String>, AppError> {
    let Some(block_id) = block_id else {
        return Ok(None);
    };
    Ok(sqlx::query_scalar(
        "SELECT von FROM einsatz_planschicht \
         WHERE id = ? AND posten_art = 'einheit' AND einheit_id = ?",
    )
    .bind(block_id)
    .bind(einheit_id)
    .fetch_optional(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(id: i64, von: &str, bis: &str, personen: i64) -> BlockZeit {
        BlockZeit {
            id,
            von: format!("2026-11-14 {von}:00"),
            bis: format!("2026-11-14 {bis}:00"),
            personen,
        }
    }

    fn t(hm: &str) -> String {
        format!("2026-11-14 {hm}:00")
    }

    const SPAET: &str = "2026-11-15 23:00:00";

    #[test]
    fn schicht_im_block_ist_zum_blockende_mit_folgeblock_faellig() {
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "16:00", "18:00", 1)];
        let p = plan_faelligkeit(&t("14:00"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("16:00"));
        assert_eq!(p.block_id, Some(1));
        assert_eq!(p.folgeblock.map(|f| f.id), Some(2));
    }

    #[test]
    fn verschobenes_blockende_verschiebt_die_faelligkeit() {
        let bloecke = [b(1, "14:00", "17:00", 2)];
        let p = plan_faelligkeit(&t("14:00"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("17:00"));
        assert_eq!(p.folgeblock, None, "ohne Folgeblock endet der Posten");
    }

    #[test]
    fn beginn_kurz_vor_dem_wechsel_gehoert_zum_naechsten_block() {
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "16:00", "18:00", 1)];
        let p = plan_faelligkeit(&t("15:50"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("18:00"));
        assert_eq!(p.block_id, Some(2));
        // 20 Minuten vorher zählt noch zum laufenden Block.
        let p = plan_faelligkeit(&t("15:40"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("16:00"));
    }

    #[test]
    fn frueher_vollzug_aus_dem_plan_ankert_im_folgeblock() {
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "16:00", "18:00", 1)];
        let p = plan_faelligkeit(&t("15:30"), Some(&t("16:00")), &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("18:00"));
        assert_eq!(p.block_id, Some(2));
    }

    #[test]
    fn plan_zieht_vor_aber_schiebt_nicht_hinaus() {
        let bloecke = [b(1, "14:00", "16:00", 2)];
        let p = plan_faelligkeit(&t("08:00"), None, &bloecke, &t("16:00")).unwrap();
        assert_eq!(p.faellig_at, t("14:00"));
        assert_eq!(p.block_id, None);
        assert_eq!(p.folgeblock.map(|f| f.id), Some(1));
        // Erster Block erst nach der regulären Fälligkeit: die Rangfolge gilt.
        assert_eq!(
            plan_faelligkeit(&t("08:00"), None, &bloecke, &t("12:00")),
            None
        );
    }

    #[test]
    fn luecke_nach_dem_block_heisst_posten_endet() {
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "17:00", "19:00", 1)];
        let p = plan_faelligkeit(&t("14:00"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("16:00"));
        assert_eq!(p.folgeblock, None);
        // Eine Lücke bis zur Toleranz bleibt ein Folgeblock.
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "16:15", "19:00", 1)];
        let p = plan_faelligkeit(&t("14:00"), None, &bloecke, SPAET).unwrap();
        assert_eq!(p.folgeblock.map(|f| f.id), Some(2));
    }

    #[test]
    fn ohne_bloecke_oder_nach_dem_letzten_gilt_die_rangfolge() {
        assert_eq!(plan_faelligkeit(&t("14:00"), None, &[], SPAET), None);
        let bloecke = [b(1, "10:00", "12:00", 2)];
        assert_eq!(plan_faelligkeit(&t("14:00"), None, &bloecke, SPAET), None);
    }

    #[test]
    fn toleranz_im_sql_wie_die_konstante() {
        assert!(folgeblock_sql!().contains(&format!("'+{WECHSEL_TOLERANZ_MINUTEN} minutes'")));
    }

    #[test]
    fn ein_anker_vor_dem_beginn_zaehlt_nicht() {
        let bloecke = [b(1, "14:00", "16:00", 2), b(2, "16:00", "18:00", 1)];
        let p = plan_faelligkeit(&t("16:05"), Some(&t("14:00")), &bloecke, SPAET).unwrap();
        assert_eq!(p.faellig_at, t("18:00"));
    }
}

//! Führung je Einsatz (LLH-1491, Change `v6hj7xl2-fuehrung-epoche`, Spec `instanz-fuehrung`):
//! gekoppelte Instanzen einigen sich je Einsatz auf genau eine führende Instanz. Die Führung
//! wandert per Übergabe, Anfrage oder Notübernahme; jede Änderung vergibt eine neue Epoche.
//!
//! - [`Epoche`]: Paar aus Zähler und Kennung der vergebenden Instanz, das größere gilt (D2).
//! - [`repo`]: Akte je Einsatz und Verlauf (D1, D4); die Akte richtet den Spiegel aus (LLH-1641).
//! - [`erklaerung`]: Erklärung der Notübernahme, Unterschrift und Abgabecode (D6, D8).
//! - [`austausch`]: Akten in der Meldung, Annahmeregel nach Richtung (D3, D7, D10).
//! - [`dienst`]: die Bedienung (Übergabe, Code, Notübernahme, Bestätigen, Widersprechen, D9).
//!
//! Der Schalter `LIFELINE_FUEHRUNG` steht in `instanz_identitaet.fuehrung_an` (beim Start
//! geschrieben). Ohne ihn tauscht die Instanz keine Akten aus, ändert an Führer und Spiegel nichts
//! (der Stand bleibt eingefroren) und antwortet auf die Routen der Führung mit 404.

pub mod austausch;
pub mod dienst;
pub mod erklaerung;
pub mod repo;

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Höchstlänge des Grundes einer Notübernahme (Zeichen).
pub const GRUND_MAX: usize = 500;

wire_enum! {
    /// Wie die geltende Führung zustande kam (Verlauf und Akte).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FuehrungWechselArt {
        /// Akte angelegt, die anlegende Instanz führt.
        Angelegt => "angelegt",
        /// Die führende Instanz hat übergeben.
        Uebergabe => "uebergabe",
        /// Die erreichte Seite hat auf Anfrage der meldenden abgegeben.
        Anfrage => "anfrage",
        /// Notübernahme (mit Unterschrift oder Abgabecode gegen die meldende Seite, sonst mit
        /// Bestätigung eines Menschen an der übernehmenden Seite).
        Notuebernahme => "notuebernahme",
        /// Die meldende Seite hat die Führung per Code abgegeben (D8).
        CodeAbgabe => "code_abgabe",
        /// Die meldende Seite hat eine Notübernahme gegen sich bestätigt.
        Bestaetigt => "bestaetigt",
        /// Die meldende Seite hat einer Notübernahme widersprochen und führt weiter (D10).
        Widerspruch => "widerspruch",
        /// Die meldende Seite hat eine ungültige Übernahme verworfen und führt weiter (D10).
        Verworfen => "verworfen",
        /// Die verwahrende Instanz hat den Einsatz nach der Nachbereitung zur Verwahrung
        /// übernommen und führt ab da (LLH-1647, E1).
        Verwahrung => "verwahrung",
    }
    try_from = |s| format!("Ungültige FuehrungWechselArt: {s}");
}

/// Epoche der Führung (design.md D2): Zähler und Kennung der Instanz, die sie vergeben hat.
/// Geordnet zuerst nach dem Zähler, bei Gleichstand nach der Kennung.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct Epoche {
    pub zaehler: i64,
    pub instanz: String,
}

impl Epoche {
    pub fn neu(zaehler: i64, instanz: &str) -> Self {
        Self {
            zaehler,
            instanz: instanz.to_string(),
        }
    }

    /// Die nächste Epoche, die `instanz` nach allen `bekannte` vergibt: größter Zähler plus eins.
    pub fn naechste<'a>(bekannte: impl IntoIterator<Item = &'a Epoche>, instanz: &str) -> Self {
        let max = bekannte.into_iter().map(|e| e.zaehler).max().unwrap_or(0);
        Self::neu(max + 1, instanz)
    }
}

impl PartialOrd for Epoche {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Epoche {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.zaehler
            .cmp(&other.zaehler)
            .then_with(|| self.instanz.cmp(&other.instanz))
    }
}

/// Die Führung im Einsatzkopf (`EinsatzAnzeige.fuehrung`): fehlt ohne Akte oder ohne Schalter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinsatzFuehrung {
    /// Diese Instanz führt den Einsatz.
    pub fuehrend: bool,
    /// Name der führenden Instanz.
    pub bei: String,
    pub epoche: i64,
    /// Eine Notübernahme gegen diese Instanz wartet auf die Einsatzleitung.
    pub offen: bool,
}

/// Spalten der Führung am geladenen Einsatz (`einsatz::repo`, Makros `fuehrung_spalten!` und
/// `fuehrung_joins!`). Nur Anzeige: Geschützt ist ein Einsatz, den eine andere Instanz führt, als
/// Spiegel (LLH-1641, ADR-0018/0020).
#[derive(Debug, Clone, Default, PartialEq, Eq, sqlx::FromRow)]
pub struct FuehrungSpalten {
    /// Die Akte nennt eine andere Instanz als Führer.
    pub fuehrung_fremd: bool,
    pub fuehrung_epoche: Option<i64>,
    pub fuehrung_fuehrer: Option<String>,
    pub fuehrung_offen: bool,
}

impl FuehrungSpalten {
    pub fn anzeige(&self) -> Option<EinsatzFuehrung> {
        Some(EinsatzFuehrung {
            fuehrend: !self.fuehrung_fremd,
            bei: self.fuehrung_fuehrer.clone()?,
            epoche: self.fuehrung_epoche?,
            offen: self.fuehrung_offen,
        })
    }
}

/// Ob die Führung an dieser Instanz eingeschaltet ist (`LIFELINE_FUEHRUNG`).
pub async fn is_enabled(pool: &SqlitePool) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT fuehrung_an FROM instanz_identitaet")
            .fetch_optional(pool)
            .await?
            .unwrap_or(0)
            == 1,
    )
}

/// 404, wenn die Führung aus ist (Spec „Führung nur mit eingeschaltetem Schalter“).
pub async fn fordere_enabled(pool: &SqlitePool) -> Result<(), AppError> {
    if is_enabled(pool).await? {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

/// Schreibt beim Start den Schalter. An: die Akten entscheiden, Spiegel folgen ihnen. Aus: es
/// bleibt, wie es ist (LLH-1641, E8; ein Spiegel wird nicht wieder beschreibbar, weil der Schalter
/// fällt, sonst schrieben zwei Instanzen).
pub async fn save_schalter(pool: &SqlitePool, an: bool) -> Result<(), AppError> {
    crate::instanz::identitaet::load_or_create(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    sqlx::query("UPDATE instanz_identitaet SET fuehrung_an = ?")
        .bind(an)
        .execute(pool)
        .await?;
    if an {
        crate::write_retry!(pool, |conn| {
            repo::ensure_akten(conn).await?;
            crate::instanz::spiegel::fuehrung::richte_alle_aus(conn).await
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zaehler_entscheidet_vor_der_kennung() {
        assert!(Epoche::neu(3, "b") < Epoche::neu(4, "a"));
        assert!(Epoche::neu(4, "a") > Epoche::neu(3, "z"));
    }

    #[test]
    fn bei_gleichstand_entscheidet_die_kennung() {
        assert!(Epoche::neu(5, "aaa") < Epoche::neu(5, "bbb"));
        assert_eq!(
            [Epoche::neu(5, "bbb"), Epoche::neu(5, "aaa")]
                .into_iter()
                .max()
                .unwrap()
                .instanz,
            "bbb"
        );
    }

    #[test]
    fn naechste_nimmt_den_groessten_zaehler_plus_eins_und_die_eigene_kennung() {
        let bekannt = [Epoche::neu(2, "hub"), Epoche::neu(4, "elw")];
        assert_eq!(Epoche::naechste(&bekannt, "hub"), Epoche::neu(5, "hub"));
        assert_eq!(Epoche::naechste([], "elw"), Epoche::neu(1, "elw"));
    }

    #[tokio::test]
    async fn schalter_steht_in_der_db_und_ist_vorgabe_aus() {
        let pool = crate::db::test_pool().await;
        assert!(!is_enabled(&pool).await.unwrap());
        assert!(matches!(
            fordere_enabled(&pool).await,
            Err(AppError::NotFound)
        ));
        save_schalter(&pool, true).await.unwrap();
        assert!(is_enabled(&pool).await.unwrap());
        save_schalter(&pool, false).await.unwrap();
        assert!(!is_enabled(&pool).await.unwrap());
    }
}

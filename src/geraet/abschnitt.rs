//! Bereich der Abschnittsansicht (LFH-1043, Spec `funktionsansichten`, „Bindung an einen
//! Abschnitt“) und der Einheitenansicht (LLH-1579).
//!
//! Ein Abschnittsgerät ist an einen Abschnitt gebunden; sein Bereich ist der Teilbaum
//! (Abschnitt samt Unterabschnitten) und die Einheiten, die dort arbeiten. Beides berechnet der
//! Server bei jeder Anfrage neu, damit ein umgehängter Unterabschnitt sofort folgt. Fremdes ist
//! beim Lesen 404, ein fremder Absender beim Melden 403.
//!
//! Ein Einheitengerät (LLH-1579, Konzept LLH-1571 S1) hat denselben Bereich mit genau einer
//! Einheit und keinem Abschnitt: Aufträge an den Abschnitt der Einheit sieht es nicht (F4), es
//! meldet immer als seine Einheit. So gelten Auftrags- und Meldungsfilter für beide Ansichten aus
//! einer Hand.

use super::{stelle, Bindungsart, Funktionsansicht, GeraetKontext};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashSet;

/// Woran der Bereich eines Geräts hängt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wurzel {
    /// Abschnittsgerät: der gebundene Abschnitt (Wurzel des Teilbaums).
    Abschnitt(i64),
    /// Einheitengerät (LLH-1579): die gebundene Einheit.
    Einheit(i64),
}

/// Teilbaum und eigene Einheiten eines gebundenen Abschnitts, oder die eine Einheit eines
/// Einheitengeräts (dann ohne Abschnitte).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Abschnittsbereich {
    pub wurzel: Wurzel,
    pub abschnitte: HashSet<i64>,
    pub einheiten: HashSet<i64>,
}

impl Abschnittsbereich {
    /// Lädt den Bereich. Ein Abschnitt außerhalb des Einsatzes ergibt einen leeren Bereich.
    pub async fn laden(
        pool: &SqlitePool,
        einsatz_id: i64,
        abschnitt_id: i64,
    ) -> Result<Self, AppError> {
        let abschnitte =
            crate::einsatzabschnitt::repo::teilbaum(pool, einsatz_id, abschnitt_id).await?;
        let einheiten: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_einheit \
             WHERE einsatz_id = ? AND aufgeloest_at IS NULL \
               AND abschnitt_id IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(json_liste(&abschnitte))
        .fetch_all(pool)
        .await?;
        Ok(Self {
            wurzel: Wurzel::Abschnitt(abschnitt_id),
            abschnitte,
            einheiten: einheiten.into_iter().collect(),
        })
    }

    /// Lädt den Bereich eines Einheitengeräts (LLH-1579): nur die Einheit, solange sie in diesem
    /// Einsatz aktiv ist; aufgelöst oder fremd ergibt einen leeren Bereich (das Gerät sieht
    /// nichts mehr und meldet nicht).
    pub async fn laden_fuer_einheit(
        pool: &SqlitePool,
        einsatz_id: i64,
        einheit_id: i64,
    ) -> Result<Self, AppError> {
        let aktiv: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_einheit \
             WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
        )
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
        Ok(Self {
            wurzel: Wurzel::Einheit(einheit_id),
            abschnitte: HashSet::new(),
            einheiten: aktiv.into_iter().collect(),
        })
    }

    /// Eine Einheit des Bereichs; sonst ist sie für das Gerät nicht vorhanden (404).
    pub fn fordere_einheit(&self, einheit_id: i64) -> Result<(), AppError> {
        self.einheiten
            .contains(&einheit_id)
            .then_some(())
            .ok_or(AppError::NotFound)
    }

    /// Ein Abschnitt des Teilbaums; sonst ist er für das Gerät nicht vorhanden (404).
    pub fn fordere_abschnitt(&self, abschnitt_id: i64) -> Result<(), AppError> {
        self.abschnitte
            .contains(&abschnitt_id)
            .then_some(())
            .ok_or(AppError::NotFound)
    }

    /// Ob ein Auftragsempfänger eigen ist: ein Abschnitt des Teilbaums oder eine eigene Einheit.
    pub fn ist_eigener_empfaenger(
        &self,
        abschnitt_id: Option<i64>,
        einheit_id: Option<i64>,
    ) -> bool {
        abschnitt_id.is_some_and(|a| self.abschnitte.contains(&a))
            || einheit_id.is_some_and(|e| self.einheiten.contains(&e))
    }

    /// Der Absender einer Meldung vom Gerät als `(einheit_id, abschnitt_id)`. Ohne Angabe gilt
    /// der gebundene Abschnitt bzw. die gebundene Einheit; ein Abschnitt oder eine Einheit
    /// außerhalb des Bereichs ist 403. Ein Einheitengerät meldet nur als seine Einheit.
    pub fn meldungs_absender(
        &self,
        einheit_id: Option<i64>,
        abschnitt_id: Option<i64>,
    ) -> Result<(Option<i64>, Option<i64>), AppError> {
        let wurzel = match self.wurzel {
            Wurzel::Abschnitt(a) => a,
            Wurzel::Einheit(eigene) => {
                // Ohne eigene Einheit (aufgelöst) gibt es keinen Absender.
                if !self.einheiten.contains(&eigene) {
                    return Err(AppError::Forbidden);
                }
                return match (einheit_id, abschnitt_id) {
                    (Some(_), Some(_)) => Err(AppError::UnprocessableEntity(
                        "Eine Meldung kommt entweder von einer Einheit oder von einem Abschnitt"
                            .into(),
                    )),
                    (None, None) => Ok((Some(eigene), None)),
                    (Some(e), None) if e == eigene => Ok((Some(eigene), None)),
                    _ => Err(AppError::Forbidden),
                };
            }
        };
        // Ohne eigenen Abschnitt (aufgelöst) gibt es keinen Absender.
        if !self.abschnitte.contains(&wurzel) {
            return Err(AppError::Forbidden);
        }
        match (einheit_id, abschnitt_id) {
            (None, None) => Ok((None, Some(wurzel))),
            (Some(e), None) if self.einheiten.contains(&e) => Ok((Some(e), None)),
            (None, Some(a)) if self.abschnitte.contains(&a) => Ok((None, Some(a))),
            (Some(_), Some(_)) => Err(AppError::UnprocessableEntity(
                "Eine Meldung kommt entweder von einer Einheit oder von einem Abschnitt".into(),
            )),
            _ => Err(AppError::Forbidden),
        }
    }

    /// Teilbaum und Einheiten als JSON-Listen für `json_each(?)` in SQL-Filtern.
    pub fn als_json(&self) -> (String, String) {
        (json_liste(&self.abschnitte), json_liste(&self.einheiten))
    }
}

/// Der Bereich der Sitzung, wenn sie ein Abschnitts- oder Einheitengerät ist; für Personen und
/// andere Geräte `None`. Ist die gebundene Stelle weg, ist der Bereich leer (das Gerät sieht
/// nichts mehr).
pub async fn bereich(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
) -> Result<Option<Abschnittsbereich>, AppError> {
    let Some(g) = geraet else { return Ok(None) };
    let leer = |wurzel| Abschnittsbereich {
        wurzel,
        abschnitte: HashSet::new(),
        einheiten: HashSet::new(),
    };
    match g.ansicht {
        Funktionsansicht::Einsatzabschnitt => {
            match stelle::eigene(Some(g), Bindungsart::Einsatzabschnitt) {
                Some(id) => Ok(Some(
                    Abschnittsbereich::laden(pool, g.einsatz_id, id).await?,
                )),
                None => Ok(Some(leer(Wurzel::Abschnitt(0)))),
            }
        }
        Funktionsansicht::Einheit => match stelle::eigene(Some(g), Bindungsart::Einheit) {
            Some(id) => Ok(Some(
                Abschnittsbereich::laden_fuer_einheit(pool, g.einsatz_id, id).await?,
            )),
            None => Ok(Some(leer(Wurzel::Einheit(0)))),
        },
        _ => Ok(None),
    }
}

/// Sortierte JSON-Liste der ids (stabil für Tests und Abfragepläne).
fn json_liste(ids: &HashSet<i64>) -> String {
    let mut v: Vec<i64> = ids.iter().copied().collect();
    v.sort_unstable();
    serde_json::to_string(&v).expect("Zahlenliste ist serialisierbar")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn einsatz(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn abschnitt(pool: &SqlitePool, einsatz: i64, name: &str, ueber: Option<i64>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name, ueber_abschnitt_id) \
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(name)
        .bind(ueber)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn einheit(pool: &SqlitePool, einsatz: i64, name: &str, abschnitt: Option<i64>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name, abschnitt_id) \
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(name)
        .bind(abschnitt)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Nord ⊃ Nord-Ost, Süd; Einheiten in Nord, Nord-Ost, Süd und ohne Abschnitt.
    struct Lage {
        einsatz: i64,
        nord: i64,
        ost: i64,
        sued: i64,
        zug_nord: i64,
        zug_ost: i64,
        zug_sued: i64,
        frei: i64,
    }

    async fn lage(pool: &SqlitePool) -> Lage {
        let e = einsatz(pool, "Lage").await;
        let nord = abschnitt(pool, e, "Nord", None).await;
        let ost = abschnitt(pool, e, "Nord-Ost", Some(nord)).await;
        let sued = abschnitt(pool, e, "Süd", None).await;
        Lage {
            einsatz: e,
            nord,
            ost,
            sued,
            zug_nord: einheit(pool, e, "1. Zug", Some(nord)).await,
            zug_ost: einheit(pool, e, "2. Zug", Some(ost)).await,
            zug_sued: einheit(pool, e, "3. Zug", Some(sued)).await,
            frei: einheit(pool, e, "Reserve", None).await,
        }
    }

    #[tokio::test]
    async fn bereich_umfasst_teilbaum_und_dessen_einheiten() {
        let pool = crate::db::test_pool().await;
        let l = lage(&pool).await;
        let b = Abschnittsbereich::laden(&pool, l.einsatz, l.nord)
            .await
            .unwrap();
        assert_eq!(b.abschnitte, HashSet::from([l.nord, l.ost]));
        assert_eq!(b.einheiten, HashSet::from([l.zug_nord, l.zug_ost]));
        assert!(!b.einheiten.contains(&l.zug_sued));
        assert!(!b.einheiten.contains(&l.frei));
        assert!(b.fordere_abschnitt(l.ost).is_ok());
        assert!(matches!(
            b.fordere_abschnitt(l.sued),
            Err(AppError::NotFound)
        ));

        // Abschnitt eines anderen Einsatzes: leerer Bereich.
        let anderer = einsatz(&pool, "Andere").await;
        let leer = Abschnittsbereich::laden(&pool, anderer, l.nord)
            .await
            .unwrap();
        assert!(leer.abschnitte.is_empty() && leer.einheiten.is_empty());
    }

    #[tokio::test]
    async fn eigene_empfaenger_sind_teilbaum_oder_eigene_einheit() {
        let pool = crate::db::test_pool().await;
        let l = lage(&pool).await;
        let b = Abschnittsbereich::laden(&pool, l.einsatz, l.nord)
            .await
            .unwrap();
        assert!(b.ist_eigener_empfaenger(Some(l.ost), None));
        assert!(b.ist_eigener_empfaenger(None, Some(l.zug_ost)));
        assert!(!b.ist_eigener_empfaenger(Some(l.sued), None));
        assert!(!b.ist_eigener_empfaenger(None, Some(l.zug_sued)));
        assert!(!b.ist_eigener_empfaenger(None, None));
    }

    #[tokio::test]
    async fn meldungs_absender_ist_eigen_oder_403() {
        let pool = crate::db::test_pool().await;
        let l = lage(&pool).await;
        let b = Abschnittsbereich::laden(&pool, l.einsatz, l.nord)
            .await
            .unwrap();
        assert_eq!(
            b.meldungs_absender(None, None).unwrap(),
            (None, Some(l.nord))
        );
        assert_eq!(
            b.meldungs_absender(None, Some(l.ost)).unwrap(),
            (None, Some(l.ost))
        );
        assert_eq!(
            b.meldungs_absender(Some(l.zug_nord), None).unwrap(),
            (Some(l.zug_nord), None)
        );
        assert!(matches!(
            b.meldungs_absender(None, Some(l.sued)),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(
            b.meldungs_absender(Some(l.zug_sued), None),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(
            b.meldungs_absender(Some(l.zug_nord), Some(l.nord)),
            Err(AppError::UnprocessableEntity(_))
        ));

        // Abschnitt weg: leerer Bereich, kein Absender.
        let leer = Abschnittsbereich::laden(&pool, l.einsatz, 999_999)
            .await
            .unwrap();
        assert!(matches!(
            leer.meldungs_absender(None, None),
            Err(AppError::Forbidden)
        ));
    }

    /// LLH-1579: das Einheitengerät hat nur seine Einheit, keinen Abschnitt; Aufträge an den
    /// Abschnitt der Einheit sind nicht eigen (F4), gemeldet wird nur als die eigene Einheit.
    #[tokio::test]
    async fn einheitenbereich_kennt_nur_die_eigene_einheit() {
        let pool = crate::db::test_pool().await;
        let l = lage(&pool).await;
        let b = Abschnittsbereich::laden_fuer_einheit(&pool, l.einsatz, l.zug_nord)
            .await
            .unwrap();
        assert_eq!(b.wurzel, Wurzel::Einheit(l.zug_nord));
        assert!(b.abschnitte.is_empty());
        assert_eq!(b.einheiten, HashSet::from([l.zug_nord]));
        assert!(b.fordere_einheit(l.zug_nord).is_ok());
        assert!(matches!(
            b.fordere_einheit(l.zug_ost),
            Err(AppError::NotFound)
        ));
        assert!(b.ist_eigener_empfaenger(None, Some(l.zug_nord)));
        assert!(!b.ist_eigener_empfaenger(Some(l.nord), None), "F4");
        assert!(!b.ist_eigener_empfaenger(None, Some(l.zug_ost)));

        assert_eq!(
            b.meldungs_absender(None, None).unwrap(),
            (Some(l.zug_nord), None)
        );
        assert_eq!(
            b.meldungs_absender(Some(l.zug_nord), None).unwrap(),
            (Some(l.zug_nord), None)
        );
        for (e, a) in [(Some(l.zug_ost), None), (None, Some(l.nord))] {
            assert!(matches!(
                b.meldungs_absender(e, a),
                Err(AppError::Forbidden)
            ));
        }
        assert!(matches!(
            b.meldungs_absender(Some(l.zug_nord), Some(l.nord)),
            Err(AppError::UnprocessableEntity(_))
        ));

        // Aufgelöst oder aus einem anderen Einsatz: leerer Bereich, kein Absender.
        sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = datetime('now') WHERE id = ?")
            .bind(l.zug_nord)
            .execute(&pool)
            .await
            .unwrap();
        let weg = Abschnittsbereich::laden_fuer_einheit(&pool, l.einsatz, l.zug_nord)
            .await
            .unwrap();
        assert!(weg.einheiten.is_empty());
        assert!(matches!(
            weg.meldungs_absender(None, None),
            Err(AppError::Forbidden)
        ));
        let anderer = einsatz(&pool, "Andere").await;
        let fremd = Abschnittsbereich::laden_fuer_einheit(&pool, anderer, l.zug_ost)
            .await
            .unwrap();
        assert!(fremd.einheiten.is_empty());
    }

    #[tokio::test]
    async fn als_json_ist_sortiert() {
        let pool = crate::db::test_pool().await;
        let l = lage(&pool).await;
        let b = Abschnittsbereich::laden(&pool, l.einsatz, l.nord)
            .await
            .unwrap();
        let (a, e) = b.als_json();
        assert_eq!(a, format!("[{},{}]", l.nord, l.ost));
        assert_eq!(e, format!("[{},{}]", l.zug_nord, l.zug_ost));
    }
}

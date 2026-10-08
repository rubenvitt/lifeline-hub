//! Stellenbindung der stellengebundenen Ansichten (LFH-892, verallgemeinert in LFH-1040; Spec
//! `funktionsansichten`, „Stellenbindung“).
//!
//! Ein stellengebundenes Gerät sieht und schreibt nur an der Stelle seiner Kopplung: eine UHS,
//! eine Betreuungsstelle, ein Bereitstellungsraum oder ein Einsatzabschnitt. Die Routenschranke in
//! `CurrentUser` lässt die Routen der Ansicht zu; welche Stelle und welche Person dahinter liegt,
//! prüft der Handler über diese Helfer.
//!
//! **Für eine Person wirken sie nicht** (`geraet` ist `None`). **Für jedes Gerät gilt die
//! Bindung streng:** ein Gerät, das nicht an eine Stelle genau dieser Art gebunden ist (eine
//! andere Art, keine Stelle wie der Lagemonitor, oder eine Stelle, die es nicht mehr gibt), kennt
//! keine Stelle dieser Art. So bleibt eine Route, die zwei Ansichten teilen (etwa die Personen),
//! auch dann geschlossen, wenn ihr Handler nur an eine Art gedacht hat.
//!
//! Lesen über eine fremde Stelle oder Person ist 404 (das Gerät erfährt nicht, dass es sie gibt),
//! Schreiben in eine fremde Stelle bei einer sichtbaren Person 403.

use super::{Bindungsart, GeraetKontext};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::HashSet;

/// Welche Stellen einer Art die Sitzung sieht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sicht {
    /// Eine Person: alle, es gelten ihre Rechte.
    Alle,
    /// Ein an eine Stelle dieser Art gebundenes Gerät: nur diese.
    Nur(i64),
    /// Jedes andere Gerät: keine.
    Keine,
}

impl Sicht {
    /// Ob die Stelle `id` sichtbar ist.
    pub fn sieht(self, id: i64) -> bool {
        match self {
            Sicht::Alle => true,
            Sicht::Nur(eigene) => eigene == id,
            Sicht::Keine => false,
        }
    }
}

/// Was die Sitzung von den Stellen der Art `art` sieht.
pub fn sicht(geraet: Option<&GeraetKontext>, art: Bindungsart) -> Sicht {
    match geraet {
        None => Sicht::Alle,
        Some(g) => match g.stelle {
            Some(s) if s.art == art && g.ansicht.stellenart() == Some(art) => Sicht::Nur(s.id),
            _ => Sicht::Keine,
        },
    }
}

/// Die eigene Stelle der Art `art`, wenn die Sitzung ein daran gebundenes Gerät ist.
pub fn eigene(geraet: Option<&GeraetKontext>, art: Bindungsart) -> Option<i64> {
    match sicht(geraet, art) {
        Sicht::Nur(id) => Some(id),
        Sicht::Alle | Sicht::Keine => None,
    }
}

/// Ob die Sitzung ein Gerät ist, das an irgendeine Stelle gebunden ist. Solche Geräte sehen nur
/// ihre Stelle und bekommen deshalb keine einsatzweiten Zähler (`routes/modul_zaehler.rs`).
pub fn ist_gebunden(geraet: Option<&GeraetKontext>) -> bool {
    geraet.is_some_and(|g| g.ansicht.ist_stellengebunden())
}

/// Lesen oder Bearbeiten an einer Stelle: eine fremde ist für das Gerät nicht vorhanden (404).
pub fn fordere_stelle(
    geraet: Option<&GeraetKontext>,
    art: Bindungsart,
    id: i64,
) -> Result<(), AppError> {
    if sicht(geraet, art).sieht(id) {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

/// Etwas in eine Stelle buchen oder aus ihr nehmen: nur in die eigene (403). Ohne Ziel
/// (`None`) ist es für ein Gerät ebenfalls 403.
pub fn fordere_ziel_stelle(
    geraet: Option<&GeraetKontext>,
    art: Bindungsart,
    id: Option<i64>,
) -> Result<(), AppError> {
    match (sicht(geraet, art), id) {
        (Sicht::Alle, _) => Ok(()),
        (Sicht::Nur(eigene), Some(ziel)) if eigene == ziel => Ok(()),
        _ => Err(AppError::Forbidden),
    }
}

/// Die UHS der Kopplung, wenn die Sitzung ein UHS-Gerät ist.
pub fn stelle(geraet: Option<&GeraetKontext>) -> Option<i64> {
    eigene(geraet, Bindungsart::Uhs)
}

/// Lesen oder Bearbeiten an einer UHS: eine fremde ist für das Gerät nicht vorhanden (404).
pub fn fordere_uhs(geraet: Option<&GeraetKontext>, uhs_id: i64) -> Result<(), AppError> {
    fordere_stelle(geraet, Bindungsart::Uhs, uhs_id)
}

/// Eine Person in eine UHS buchen oder aus ihr nehmen: nur die eigene (403).
pub fn fordere_ziel_uhs(
    geraet: Option<&GeraetKontext>,
    uhs_id: Option<i64>,
) -> Result<(), AppError> {
    fordere_ziel_stelle(geraet, Bindungsart::Uhs, uhs_id)
}

/// Personen mit mindestens einer Belegung in der UHS, auch nach ihrem Austritt.
pub async fn personen_der_uhs(pool: &SqlitePool, uhs_id: i64) -> Result<HashSet<i64>, AppError> {
    let ids: Vec<i64> =
        sqlx::query_scalar("SELECT DISTINCT person_id FROM person_uhs_belegung WHERE uhs_id = ?")
            .bind(uhs_id)
            .fetch_all(pool)
            .await?;
    Ok(ids.into_iter().collect())
}

/// Personen mit mindestens einem Verbleib „Notunterkunft“ in der Betreuungsstelle, auch wenn ein
/// späterer Verbleib sie woandershin geführt hat (wie „auch nach dem Austritt“ bei der UHS).
pub async fn personen_der_betreuungsstelle(
    pool: &SqlitePool,
    stelle_id: i64,
) -> Result<HashSet<i64>, AppError> {
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT person_id FROM person_verbleib \
         WHERE art = 'notunterkunft' AND betreuungsstelle_id = ?",
    )
    .bind(stelle_id)
    .fetch_all(pool)
    .await?;
    Ok(ids.into_iter().collect())
}

/// Die Personen, die die Sitzung sieht: `None` für eine Person (alle, es gelten ihre Rechte),
/// sonst die Personen der eigenen Stelle. Eine UHS sieht, wer je in ihr belegt war, eine
/// Betreuungsstelle, wer je in ihr untergebracht war; jedes andere Gerät sieht keine Person.
pub async fn sichtbare_personen(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
) -> Result<Option<HashSet<i64>>, AppError> {
    let Some(g) = geraet else { return Ok(None) };
    let Some(art) = g.ansicht.stellenart() else {
        return Ok(Some(HashSet::new()));
    };
    let ids = match (art, eigene(geraet, art)) {
        (Bindungsart::Uhs, Some(id)) => personen_der_uhs(pool, id).await?,
        (Bindungsart::Betreuungsstelle, Some(id)) => {
            personen_der_betreuungsstelle(pool, id).await?
        }
        _ => HashSet::new(),
    };
    Ok(Some(ids))
}

/// Eine Person ist für das Gerät sichtbar, wenn sie zur eigenen Stelle gehört
/// ([`sichtbare_personen`]); sonst 404.
pub async fn fordere_person(
    pool: &SqlitePool,
    geraet: Option<&GeraetKontext>,
    person_id: i64,
) -> Result<(), AppError> {
    let Some(g) = geraet else { return Ok(()) };
    let eigene_stelle = g.ansicht.stellenart().and_then(|art| eigene(geraet, art));
    let sql = match (g.ansicht.stellenart(), eigene_stelle) {
        (Some(Bindungsart::Uhs), Some(_)) => {
            "SELECT 1 FROM person_uhs_belegung WHERE uhs_id = ? AND person_id = ? LIMIT 1"
        }
        (Some(Bindungsart::Betreuungsstelle), Some(_)) => {
            "SELECT 1 FROM person_verbleib WHERE art = 'notunterkunft' \
             AND betreuungsstelle_id = ? AND person_id = ? LIMIT 1"
        }
        _ => return Err(AppError::NotFound),
    };
    let gefunden: Option<i64> = sqlx::query_scalar(sql)
        .bind(eigene_stelle)
        .bind(person_id)
        .fetch_optional(pool)
        .await?;
    gefunden.map(|_| ()).ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geraet::{Funktionsansicht, Stelle};

    fn geraet(ansicht: Funktionsansicht, stelle: Option<(Bindungsart, i64)>) -> GeraetKontext {
        GeraetKontext {
            kopplung_id: 1,
            einsatz_id: 1,
            ansicht,
            stelle: stelle.map(|(art, id)| Stelle { art, id }),
            bezeichnung: "Tablet 1".into(),
            laeuft_ab_at: "2026-10-05 12:00:00".into(),
        }
    }

    #[test]
    fn person_ist_nicht_gebunden() {
        assert_eq!(stelle(None), None);
        assert_eq!(sicht(None, Bindungsart::Uhs), Sicht::Alle);
        assert!(fordere_uhs(None, 9).is_ok());
        assert!(fordere_ziel_uhs(None, Some(9)).is_ok());
        assert!(fordere_ziel_uhs(None, None).is_ok());
        assert!(!ist_gebunden(None));
    }

    #[test]
    fn geraet_ohne_stelle_sieht_keine_stelle() {
        // Lagemonitor und Verpflegung erreichen keine Stellenroute; täten sie es, sähen sie nichts.
        for a in [Funktionsansicht::Lagemonitor, Funktionsansicht::Verpflegung] {
            let g = geraet(a, None);
            assert_eq!(stelle(Some(&g)), None);
            assert!(!ist_gebunden(Some(&g)));
            for art in Bindungsart::ALLE {
                assert_eq!(sicht(Some(&g), art), Sicht::Keine);
                assert!(matches!(
                    fordere_stelle(Some(&g), art, 9),
                    Err(AppError::NotFound)
                ));
                assert!(matches!(
                    fordere_ziel_stelle(Some(&g), art, Some(9)),
                    Err(AppError::Forbidden)
                ));
            }
        }
    }

    #[test]
    fn fremde_uhs_ist_404_beim_lesen_und_403_beim_buchen() {
        let tablet = geraet(Funktionsansicht::UhsTablet, Some((Bindungsart::Uhs, 2)));
        assert!(ist_gebunden(Some(&tablet)));
        assert!(fordere_uhs(Some(&tablet), 2).is_ok());
        assert!(matches!(
            fordere_uhs(Some(&tablet), 3),
            Err(AppError::NotFound)
        ));
        assert!(fordere_ziel_uhs(Some(&tablet), Some(2)).is_ok());
        assert!(matches!(
            fordere_ziel_uhs(Some(&tablet), Some(3)),
            Err(AppError::Forbidden)
        ));
        assert!(matches!(
            fordere_ziel_uhs(Some(&tablet), None),
            Err(AppError::Forbidden)
        ));
    }

    #[test]
    fn andere_stellenart_sieht_keine_uhs() {
        // Ein Betreuungsstellen-Gerät mit Kennung 2 sieht die UHS 2 nicht: die Kennungen der
        // Arten sind voneinander unabhängig.
        let g = geraet(
            Funktionsansicht::Betreuungsstelle,
            Some((Bindungsart::Betreuungsstelle, 2)),
        );
        assert_eq!(stelle(Some(&g)), None);
        assert!(matches!(fordere_uhs(Some(&g), 2), Err(AppError::NotFound)));
        assert!(matches!(
            fordere_ziel_uhs(Some(&g), Some(2)),
            Err(AppError::Forbidden)
        ));
        assert_eq!(eigene(Some(&g), Bindungsart::Betreuungsstelle), Some(2));
        assert!(fordere_stelle(Some(&g), Bindungsart::Betreuungsstelle, 2).is_ok());
        assert!(matches!(
            fordere_stelle(Some(&g), Bindungsart::Betreuungsstelle, 3),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn verschwundene_stelle_sieht_nichts() {
        // Ein aufgelöster Abschnitt setzt die Bindung auf NULL (ON DELETE SET NULL).
        let g = geraet(Funktionsansicht::Einsatzabschnitt, None);
        assert!(ist_gebunden(Some(&g)));
        assert_eq!(sicht(Some(&g), Bindungsart::Einsatzabschnitt), Sicht::Keine);
        assert!(matches!(
            fordere_stelle(Some(&g), Bindungsart::Einsatzabschnitt, 1),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn stelle_passt_nur_zur_art_der_ansicht() {
        // Eine Kopplung, deren Bindungsart nicht zur Ansicht passt, bindet nicht (Schutz gegen
        // eine Zeile, die die Schreibwege nicht erzeugen).
        let g = geraet(
            Funktionsansicht::UhsTablet,
            Some((Bindungsart::Betreuungsstelle, 2)),
        );
        assert_eq!(sicht(Some(&g), Bindungsart::Betreuungsstelle), Sicht::Keine);
        assert_eq!(sicht(Some(&g), Bindungsart::Uhs), Sicht::Keine);
    }

    #[sqlx::test]
    async fn sichtbare_personen_je_art(pool: SqlitePool) {
        // Ohne Daten: Person sieht alle (None), Geräte ohne Personenregel sehen keine.
        assert_eq!(sichtbare_personen(&pool, None).await.unwrap(), None);
        for g in [
            geraet(Funktionsansicht::Lagemonitor, None),
            geraet(
                Funktionsansicht::Bereitstellungsraum,
                Some((Bindungsart::Bereitstellungsraum, 1)),
            ),
            geraet(
                Funktionsansicht::Einsatzabschnitt,
                Some((Bindungsart::Einsatzabschnitt, 1)),
            ),
        ] {
            assert_eq!(
                sichtbare_personen(&pool, Some(&g)).await.unwrap(),
                Some(HashSet::new())
            );
            assert!(matches!(
                fordere_person(&pool, Some(&g), 1).await,
                Err(AppError::NotFound)
            ));
        }
    }
}

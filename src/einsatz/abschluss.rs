//! Abschluss eines Einsatzes: was vor dem Abschluss noch offen ist (LLH-1814, Spec
//! `einsatz-abschluss`, „Offene Punkte vor dem Abschluss“; Change
//! `sa41jgmj-einsatz-abschluss-absichern`, design.md D1).
//!
//! Die Prüfung warnt nur, sie sperrt den Abschluss nicht. Sie zählt über den ganzen Einsatz,
//! unabhängig von den Modulfreigaben der anfragenden Person. Die Regel „offen“ jedes Moduls kommt
//! aus seinem Repo (dieselben Fragmente bzw. Zählfunktionen wie der Modulzähler in
//! [`super::zaehler`]); hier steht kein zweiter Wortlaut.

use crate::error::AppError;
use crate::person::{
    versorgung_von, PersonStatus, TransportDurch, VerbleibArt, VerbleibStatus, Versorgung,
};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Höchstzahl der Einträge je Gruppe in der Kurzliste; die Anzahl zählt alle.
pub const KURZLISTE_MAX: usize = 5;

wire_enum! {
    /// Art einer nicht entlassenen Kraft in der Kurzliste der Abschlussprüfung.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbschlussKraftArt {
        Einheit => "einheit",
        Fahrzeug => "fahrzeug",
    }
}

/// Ein offener Punkt der Kurzliste: Kennung, laufende Nummer des Moduls (Auftrag, Meldung,
/// Registriernummer einer Person), Bezeichnung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbschlussEintrag {
    pub id: i64,
    /// Laufende Nummer im Modul; fehlt, wo das Modul keine kennt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nummer: Option<i64>,
    pub bezeichnung: String,
}

/// Eine Gruppe offener Punkte: alle gezählt, höchstens [`KURZLISTE_MAX`] genannt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbschlussGruppe {
    pub anzahl: i64,
    pub eintraege: Vec<AbschlussEintrag>,
}

/// Eine nicht entlassene Einheit oder ein nicht entlassenes Fahrzeug mit aktuellem Status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbschlussKraft {
    pub art: AbschlussKraftArt,
    pub id: i64,
    pub bezeichnung: String,
    /// Statustext („3 – Auf Anfahrt“); fehlt ohne Status.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Nicht entlassene Kräfte. `anzahl` zählt alle: die Einheiten und Fahrzeuge der Kurzliste
/// (ein Fahrzeug in einer aktiven Einheit steht nur über seine Einheit) und die Einsatzkräfte,
/// die `personal` noch einmal für sich nennt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbschlussKraefte {
    pub anzahl: i64,
    pub eintraege: Vec<AbschlussKraft>,
    /// Davon nicht entlassene Einsatzkräfte (`einsatz_personal`).
    pub personal: i64,
}

/// Antwort von `GET /api/einsaetze/{id}/abschluss/pruefung`: die offenen Punkte je Gruppe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbschlussPruefung {
    pub kraefte: AbschlussKraefte,
    pub auftraege: AbschlussGruppe,
    pub meldungen: AbschlussGruppe,
    pub nachforderungen: AbschlussGruppe,
    /// Betroffene mit offenem oder unterwegs befindlichem Verbleib, vermisste eingeschlossen.
    pub betroffene: AbschlussGruppe,
}

/// Kürzt eine vollständige Liste auf [`KURZLISTE_MAX`] Einträge und liefert die Anzahl aller.
pub fn kurzliste<T>(mut alle: Vec<T>) -> (i64, Vec<T>) {
    let anzahl = i64::try_from(alle.len()).unwrap_or(i64::MAX);
    alle.truncate(KURZLISTE_MAX);
    (anzahl, alle)
}

/// Ob eine Person beim Abschluss als offen gilt: Versorgung offen oder unterwegs nach
/// [`versorgung_von`]; eine vermisste Person ist dort immer offen.
pub fn is_betroffene_offen(versorgung: Versorgung) -> bool {
    matches!(versorgung, Versorgung::Offen | Versorgung::Unterwegs)
}

/// Bezeichnung einer offenen Person in der Kurzliste. Bewusst ohne Namen: nur Registriernummer
/// und Zustand (die Kurzliste soll nicht zum Personenverzeichnis werden).
fn betroffene_bezeichnung(status: PersonStatus, versorgung: Versorgung) -> String {
    match (status, versorgung) {
        (PersonStatus::Vermisst, _) => "vermisst".into(),
        (_, Versorgung::Unterwegs) => "im Eigentransport unterwegs".into(),
        _ => "Verbleib offen".into(),
    }
}

type PersonZeile = (
    i64,
    i64,
    String,
    Option<VerbleibArt>,
    Option<VerbleibStatus>,
    Option<TransportDurch>,
);

async fn load_betroffene(pool: &SqlitePool, einsatz_id: i64) -> Result<AbschlussGruppe, AppError> {
    // Dasselbe Prädikat wie `person::repo::liste` und der Lagemonitor: stornierte zählen nicht.
    let zeilen: Vec<PersonZeile> = sqlx::query_as(
        "SELECT id, registrier_nr, status, aktuelle_verbleib_art, aktueller_verbleib_status, \
                aktueller_transport_durch \
         FROM einsatz_person WHERE einsatz_id = ? AND storniert_at IS NULL \
         ORDER BY registrier_nr",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut offen = Vec::new();
    for (id, nr, status, art, verbleib_status, durch) in zeilen {
        let status = PersonStatus::try_from(status).map_err(AppError::Internal)?;
        let versorgung = versorgung_von(status, art, verbleib_status, durch);
        if is_betroffene_offen(versorgung) {
            offen.push(AbschlussEintrag {
                id,
                nummer: Some(nr),
                bezeichnung: betroffene_bezeichnung(status, versorgung),
            });
        }
    }
    let (anzahl, eintraege) = kurzliste(offen);
    Ok(AbschlussGruppe { anzahl, eintraege })
}

/// Statustext einer Einheit: der eine Status, bei gemischten Fahrzeugen die Verteilung.
fn einheit_status_text(status: &crate::einheit::EinheitStatus) -> Option<String> {
    if let Some(s) = &status.status {
        return Some(s.label.clone());
    }
    let teile: Vec<String> = status
        .verteilung
        .iter()
        .map(|a| match &a.status {
            Some(s) => format!("{} ×{}", s.label, a.anzahl),
            None => format!("ohne Status ×{}", a.anzahl),
        })
        .collect();
    (!teile.is_empty()).then(|| teile.join(", "))
}

async fn load_kraefte(pool: &SqlitePool, einsatz_id: i64) -> Result<AbschlussKraefte, AppError> {
    // Aktiv heißt: Einheit nicht aufgelöst, Fahrzeug weder entlassen noch storniert (LLH-1079);
    // beides filtern die Listen der Module.
    let einheiten = crate::einheit::repo::liste(pool, einsatz_id).await?;
    let fahrzeuge = crate::fahrzeug::disposition_repo::liste(pool, einsatz_id, true).await?;
    let mut alle: Vec<AbschlussKraft> = einheiten
        .iter()
        .map(|e| AbschlussKraft {
            art: AbschlussKraftArt::Einheit,
            id: e.id,
            bezeichnung: e.name.clone(),
            status: einheit_status_text(&e.status),
        })
        .collect();
    alle.extend(
        fahrzeuge
            .into_iter()
            .filter(|f| {
                f.einheit_id
                    .is_none_or(|eid| !einheiten.iter().any(|e| e.id == eid))
            })
            .map(|f| AbschlussKraft {
                art: AbschlussKraftArt::Fahrzeug,
                id: f.id,
                bezeichnung: f.funkrufname,
                status: f.status_label,
            }),
    );
    let personal: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ? AND beendet_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    let (anzahl, eintraege) = kurzliste(alle);
    Ok(AbschlussKraefte {
        anzahl: anzahl + personal,
        eintraege,
        personal,
    })
}

/// Eine Gruppe aus der Zahl des Modulzählers und der Kurzliste des Moduls.
fn gruppe(anzahl: i64, eintraege: Vec<(i64, Option<i64>, String)>) -> AbschlussGruppe {
    AbschlussGruppe {
        anzahl,
        eintraege: eintraege
            .into_iter()
            .take(KURZLISTE_MAX)
            .map(|(id, nummer, bezeichnung)| AbschlussEintrag {
                id,
                nummer,
                bezeichnung,
            })
            .collect(),
    }
}

/// Die offenen Punkte eines Einsatzes vor dem Abschluss. Prüft keine Rechte: das tut die Route
/// (`EinsatzLeitungszugriff`). `jetzt` im SQLite-Format, wie der Modulzähler es bindet.
pub async fn load_pruefung(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<AbschlussPruefung, AppError> {
    let max = i64::try_from(KURZLISTE_MAX).unwrap_or(5);
    let auftraege = gruppe(
        crate::auftrag::repo::zaehlen(pool, einsatz_id, jetzt)
            .await?
            .offen,
        crate::auftrag::repo::offene_kurzliste(pool, einsatz_id, max).await?,
    );
    let meldungen = gruppe(
        crate::meldung::repo::zaehlen(pool, einsatz_id, jetzt)
            .await?
            .offen,
        crate::meldung::repo::offene_kurzliste(pool, einsatz_id, max).await?,
    );
    let nachforderungen = gruppe(
        crate::nachforderung::repo::zaehlen(pool, einsatz_id, jetzt)
            .await?
            .offen,
        crate::nachforderung::repo::offene_kurzliste(pool, einsatz_id, max).await?,
    );
    Ok(AbschlussPruefung {
        kraefte: load_kraefte(pool, einsatz_id).await?,
        auftraege,
        meldungen,
        nachforderungen,
        betroffene: load_betroffene(pool, einsatz_id).await?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kurzliste_nennt_hoechstens_fuenf_und_zaehlt_alle() {
        assert_eq!(kurzliste(Vec::<i64>::new()), (0, vec![]));
        assert_eq!(kurzliste(vec![1, 2, 3]), (3, vec![1, 2, 3]));
        assert_eq!(kurzliste(vec![1, 2, 3, 4, 5]), (5, vec![1, 2, 3, 4, 5]));
        assert_eq!(
            kurzliste((1..=12).collect::<Vec<i64>>()),
            (12, vec![1, 2, 3, 4, 5])
        );
    }

    #[test]
    fn gruppe_kuerzt_die_liste_und_behaelt_die_zahl_des_zaehlers() {
        let zeilen = (1..=7).map(|i| (i, Some(i), format!("A{i}"))).collect();
        let g = gruppe(7, zeilen);
        assert_eq!(g.anzahl, 7);
        assert_eq!(g.eintraege.len(), KURZLISTE_MAX);
        assert_eq!(g.eintraege[0].bezeichnung, "A1");
    }

    #[test]
    fn offen_sind_versorgung_offen_und_unterwegs_auch_vermisste() {
        assert!(is_betroffene_offen(Versorgung::Offen));
        assert!(is_betroffene_offen(Versorgung::Unterwegs));
        assert!(!is_betroffene_offen(Versorgung::Abgeschlossen));
        // Vermisst ist immer offen, auch mit abgeschlossenem Verbleib.
        let v = versorgung_von(
            PersonStatus::Vermisst,
            Some(VerbleibArt::Entlassung),
            None,
            None,
        );
        assert!(is_betroffene_offen(v));
        assert_eq!(
            betroffene_bezeichnung(PersonStatus::Vermisst, v),
            "vermisst"
        );
        assert_eq!(
            betroffene_bezeichnung(PersonStatus::Betroffen, Versorgung::Unterwegs),
            "im Eigentransport unterwegs"
        );
        assert_eq!(
            betroffene_bezeichnung(PersonStatus::Erfasst, Versorgung::Offen),
            "Verbleib offen"
        );
    }
}

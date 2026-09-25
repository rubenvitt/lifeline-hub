//! Stammdaten-Teil des Demo-Imports (LFH-690, design.md D8).
//!
//! **Konfliktregel.** Abgeglichen wird in der Organisation des Admins und nur gegen
//! `dienststatus = 'in_dienst'`, also dasselbe Prädikat wie die partiellen UNIQUE-Indizes und
//! die Disposition. Kennung ist beim Fahrzeug der Funkrufname, beim Personal die
//! Personalnummer (nie der Name) und beim Material die Bestandsnummer.
//!
//! - **Treffer:** mitbenutzen, unverändert, **ohne** Marke. Das Entfernen lässt die Zeile
//!   damit in Ruhe.
//! - **Kein Treffer:** über die `anlegen_tx` des Fach-Repos anlegen und in `demo_herkunft`
//!   dem Import-Kopf zuordnen. Ein außer Dienst gestellter Namensvetter wird nicht
//!   mitbenutzt (die Disposition verlangt `in_dienst`) und bleibt unverändert.
//!
//! `personal.benutzer_id` setzt der Import nie: `idx_personal_benutzer` ist eindeutig, und
//! der Admin kann schon verknüpft sein. Kataloge werden nur gelesen ([`super::katalog`]).
//!
//! Die Funktion committet nicht; der Aufrufer (`importieren_tx`) fährt sie in `write_retry!`.

use std::collections::BTreeMap;

use sqlx::SqliteConnection;

use super::katalog;
use super::szenario::{self, Katalogeintrag};
use super::{DemoBerichtZeile, DemoStammdatenArt};
use crate::error::AppError;
use crate::fahrzeug::repo::{self as fahrzeug_repo, FahrzeugDaten};
use crate::material::repo::{self as material_repo, MaterialDaten};
use crate::personal::repo::{self as personal_repo, PersonalDaten};
use crate::staerke::Staerke;

/// Ergebnis der Stammdaten-Anlage: die IDs je Szenario-Schlüssel, mit denen das Drehbuch
/// disponiert, und die Berichtszeilen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StammdatenErgebnis {
    /// Fahrzeug-ID je Schlüssel aus [`szenario::FAHRZEUGE`].
    pub fahrzeuge: BTreeMap<&'static str, i64>,
    /// Personal-ID je Schlüssel aus [`szenario::PERSONAL`].
    pub personal: BTreeMap<&'static str, i64>,
    /// Material-ID je Schlüssel aus [`szenario::MATERIAL`].
    pub material: BTreeMap<&'static str, i64>,
    /// Je Art eine Zeile, in Enum-Reihenfolge (Fahrzeug, Personal, Material). Gezählt sind
    /// `angelegt` und `mitbenutzt`; `entfernt` und `behalten` stehen auf 0.
    pub je_art: Vec<DemoBerichtZeile>,
}

impl StammdatenErgebnis {
    /// Fahrzeug-ID zum Schlüssel; ein unbekannter Schlüssel ist ein Tippfehler im Drehbuch
    /// und endet laut als `Internal`.
    pub fn fahrzeug(&self, schluessel: &str) -> Result<i64, AppError> {
        nachschlagen(&self.fahrzeuge, "Fahrzeug", schluessel)
    }

    /// Personal-ID zum Schlüssel, sonst `Internal`.
    pub fn personal(&self, schluessel: &str) -> Result<i64, AppError> {
        nachschlagen(&self.personal, "Personal", schluessel)
    }

    /// Material-ID zum Schlüssel, sonst `Internal`.
    pub fn material(&self, schluessel: &str) -> Result<i64, AppError> {
        nachschlagen(&self.material, "Material", schluessel)
    }
}

fn nachschlagen(
    ids: &BTreeMap<&'static str, i64>,
    art: &str,
    schluessel: &str,
) -> Result<i64, AppError> {
    ids.get(schluessel).copied().ok_or_else(|| {
        AppError::Internal(format!(
            "Demo-Szenario: kein {art} mit Schlüssel {schluessel:?}"
        ))
    })
}

/// Legt die Stammdaten des Szenarios in der Organisation an oder benutzt vorhandene mit
/// (design.md D8) und markiert jede neu angelegte Zeile mit `import_id`.
///
/// `import_id` muss der aktive Kopf von `org_id` sein, sonst `Internal`: eine Marke an einem
/// fremden Kopf ließe das Entfernen dieses Kopfes die Zeilen nie finden.
///
/// Fehlt ein Katalogeintrag, antwortet die Funktion mit 422, **bevor** sie schreibt.
pub async fn stammdaten_importieren_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    import_id: i64,
) -> Result<StammdatenErgebnis, AppError> {
    let kopf_aktiv: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM demo_import WHERE id = ? AND org_id = ? AND entfernt_at IS NULL",
    )
    .bind(import_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    if kopf_aktiv.is_none() {
        return Err(AppError::Internal(format!(
            "Demo-Stammdaten: Kopf {import_id} ist kein aktiver Import der Org {org_id}"
        )));
    }

    // Erst alle Kataloge auflösen, dann schreiben: ein fehlender Eintrag bricht ab, bevor
    // eine Zeile entsteht.
    let kataloge =
        katalog::aufloesen_tx(conn, org_id, &szenario::katalog_bedarf_stammdaten()).await?;

    let mut fahrzeuge = BTreeMap::new();
    let (mut f_angelegt, mut f_mitbenutzt) = (0, 0);
    for vorlage in &szenario::FAHRZEUGE {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM fahrzeug \
             WHERE org_id = ? AND funkrufname = ? AND dienststatus = 'in_dienst'",
        )
        .bind(org_id)
        .bind(vorlage.funkrufname)
        .fetch_optional(&mut *conn)
        .await?;
        let id = match vorhanden {
            Some(id) => {
                f_mitbenutzt += 1;
                id
            }
            None => {
                let daten = FahrzeugDaten {
                    funkrufname: vorlage.funkrufname,
                    fahrzeugtyp: Some(vorlage.fahrzeugtyp),
                    traegerorganisation: None,
                    kennzeichen: None,
                    opta: None,
                    standort: Some(szenario::STANDORT),
                    fms_issi: None,
                    sondersignal: vorlage.sondersignal,
                    tragenkapazitaet: vorlage.tragenkapazitaet,
                    staerke: vorlage.staerke.map(|(f, u, m)| Staerke::neu(f, u, m)),
                    bemerkung: Some(szenario::BEMERKUNG),
                };
                let id = fahrzeug_repo::anlegen_tx(conn, org_id, &daten).await?.id;
                markieren(conn, import_id, DemoStammdatenArt::Fahrzeug, id).await?;
                f_angelegt += 1;
                id
            }
        };
        fahrzeuge.insert(vorlage.schluessel, id);
    }

    let mut personal = BTreeMap::new();
    let (mut p_angelegt, mut p_mitbenutzt) = (0, 0);
    for vorlage in &szenario::PERSONAL {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM personal \
             WHERE org_id = ? AND personalnummer = ? AND dienststatus = 'in_dienst'",
        )
        .bind(org_id)
        .bind(vorlage.personalnummer)
        .fetch_optional(&mut *conn)
        .await?;
        let id = match vorhanden {
            Some(id) => {
                p_mitbenutzt += 1;
                id
            }
            None => {
                let qualifikation_ids = vorlage
                    .qualifikationen
                    .iter()
                    .map(|label| kataloge.id(Katalogeintrag::Qualifikation(label)))
                    .collect::<Result<Vec<i64>, AppError>>()?;
                let daten = PersonalDaten {
                    name: vorlage.name,
                    // Nie eine Zuordnung zum Benutzerkonto (design.md D8).
                    benutzer_id: None,
                    personalnummer: Some(vorlage.personalnummer),
                    traegerorganisation: None,
                    telefon: None,
                    staerke_position: Some(vorlage.staerke_position),
                    bemerkung: Some(szenario::BEMERKUNG),
                };
                let id = personal_repo::anlegen_tx(conn, org_id, &daten, &qualifikation_ids)
                    .await?
                    .id;
                markieren(conn, import_id, DemoStammdatenArt::Personal, id).await?;
                p_angelegt += 1;
                id
            }
        };
        personal.insert(vorlage.schluessel, id);
    }

    let mut material = BTreeMap::new();
    let (mut m_angelegt, mut m_mitbenutzt) = (0, 0);
    for vorlage in &szenario::MATERIAL {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM material \
             WHERE org_id = ? AND bestandsnummer = ? AND dienststatus = 'in_dienst'",
        )
        .bind(org_id)
        .bind(vorlage.bestandsnummer)
        .fetch_optional(&mut *conn)
        .await?;
        let id = match vorhanden {
            Some(id) => {
                m_mitbenutzt += 1;
                id
            }
            None => {
                let daten = MaterialDaten {
                    bezeichnung: vorlage.bezeichnung,
                    kategorie: Some(vorlage.kategorie),
                    bestandsnummer: Some(vorlage.bestandsnummer),
                    traegerorganisation: None,
                    standort: Some(szenario::STANDORT),
                    bemerkung: Some(szenario::BEMERKUNG),
                };
                let id = material_repo::anlegen_tx(conn, org_id, &daten).await?.id;
                markieren(conn, import_id, DemoStammdatenArt::Material, id).await?;
                m_angelegt += 1;
                id
            }
        };
        material.insert(vorlage.schluessel, id);
    }

    let zeile = |art, angelegt, mitbenutzt| DemoBerichtZeile {
        art,
        angelegt,
        mitbenutzt,
        entfernt: 0,
        behalten: 0,
    };
    Ok(StammdatenErgebnis {
        fahrzeuge,
        personal,
        material,
        je_art: vec![
            zeile(DemoStammdatenArt::Fahrzeug, f_angelegt, f_mitbenutzt),
            zeile(DemoStammdatenArt::Personal, p_angelegt, p_mitbenutzt),
            zeile(DemoStammdatenArt::Material, m_angelegt, m_mitbenutzt),
        ],
    })
}

/// Ordnet eine neu angelegte Zeile dem Import-Kopf zu. `tabelle` ist der Wire-Wert der Art,
/// derselbe, den `demo_herkunft.tabelle` per CHECK erlaubt und das Entfernen liest.
async fn markieren(
    conn: &mut SqliteConnection,
    import_id: i64,
    art: DemoStammdatenArt,
    datensatz_id: i64,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) VALUES (?, ?, ?)")
        .bind(import_id)
        .bind(art.as_str())
        .bind(datensatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

//! Stammdaten-Teil des Demo-Imports (LFH-690).
//!
//! **Konfliktregel:** abgeglichen wird in der Org des Admins und nur gegen
//! `dienststatus = 'in_dienst'` (dasselbe Prädikat wie die partiellen UNIQUE-Indizes und die
//! Disposition). Kennung ist beim Fahrzeug der Funkrufname, beim Personal die Personalnummer
//! (nie der Name), beim Material die Bestandsnummer, bei der Einheiten-Vorlage der Name unter den
//! aktiven Vorlagen (LLH-1042).
//!
//! - **Treffer:** mitbenutzen, unverändert, **ohne** Marke — das Entfernen lässt die Zeile in
//!   Ruhe.
//! - **Kein Treffer:** über `anlegen_tx` des Fach-Repos anlegen und in `demo_herkunft` dem
//!   Import-Kopf zuordnen. Ein außer Dienst gestellter Namensvetter bleibt unverändert.
//!
//! `personal.benutzer_id` setzt der Import nie: `idx_personal_benutzer` ist eindeutig, und der
//! Admin kann schon verknüpft sein. Kataloge werden nur gelesen ([`super::katalog`]).
//!
//! Eine Demo-Vorlage hängt nur unter einer Vorlage, die dieser Import selbst angelegt hat; unter
//! einer mitbenutzten stünde sie in einem fremden Baum, und dessen Fahrzeuge kämen ihr in die
//! Quere. Fahrzeuge und Stammbesetzung bekommt nur eine angelegte Vorlage, über dieselben
//! `…_tx`-Wege wie die Verwaltung.
//!
//! Die Funktion committet nicht; `importieren_tx` fährt sie in `write_retry!`.

use std::collections::BTreeMap;

use sqlx::SqliteConnection;

use super::katalog;
use super::szenario::{self, Katalogeintrag};
use super::{DemoBerichtZeile, DemoStammdatenArt};
use crate::einheit_vorlage::repo::{self as vorlage_repo, NewVorlage};
use crate::einheit_vorlage::PersonalEntry;
use crate::error::AppError;
use crate::fahrzeug::repo::{self as fahrzeug_repo, FahrzeugDaten};
use crate::material::repo::{self as material_repo, MaterialDaten};
use crate::personal::repo::{self as personal_repo, PersonalDaten};
use crate::schichtmodell::repo as schichtmodell_repo;
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
    /// Vorlagen-ID je Schlüssel aus [`szenario::EINHEITEN_VORLAGEN`].
    pub einheit_vorlagen: BTreeMap<&'static str, i64>,
    /// ID des Schichtmodells [`szenario::SCHICHTMODELL_BEZEICHNUNG`] (LLH-1122).
    pub schichtmodell: i64,
    /// Je Art eine Zeile, in Enum-Reihenfolge (Fahrzeug, Personal, Material, Einheiten-Vorlage,
    /// Schichtmodell).
    /// Gezählt sind
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

/// Legt die Stammdaten des Szenarios an oder benutzt vorhandene mit und markiert jede neu
/// angelegte Zeile mit `import_id`.
///
/// `import_id` muss der aktive Kopf von `org_id` sein, sonst `Internal`: eine Marke an einem
/// fremden Kopf fände das Entfernen nie. Fehlt ein Katalogeintrag, antwortet die Funktion mit
/// 422, **bevor** sie schreibt.
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
                    // Nie eine Zuordnung zum Benutzerkonto.
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
                    art: vorlage.art,
                };
                let id = material_repo::anlegen_tx(conn, org_id, &daten).await?.id;
                markieren(conn, import_id, DemoStammdatenArt::Material, id).await?;
                m_angelegt += 1;
                id
            }
        };
        material.insert(vorlage.schluessel, id);
    }

    let mut einheit_vorlagen: BTreeMap<&'static str, i64> = BTreeMap::new();
    let mut angelegte_vorlagen: Vec<&'static str> = Vec::new();
    let (mut v_angelegt, mut v_mitbenutzt) = (0, 0);
    for vorlage in &szenario::EINHEITEN_VORLAGEN {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einheit_vorlage WHERE org_id = ? AND name = ? AND aktiv = 1",
        )
        .bind(org_id)
        .bind(vorlage.name)
        .fetch_optional(&mut *conn)
        .await?;
        let id = match vorhanden {
            Some(id) => {
                v_mitbenutzt += 1;
                id
            }
            None => {
                // Nur unter einer selbst angelegten Vorlage (s. Modulkopf).
                let ueber = vorlage
                    .ueber
                    .filter(|u| angelegte_vorlagen.contains(u))
                    .map(|u| nachschlagen(&einheit_vorlagen, "Einheiten-Vorlage", u))
                    .transpose()?;
                let daten = NewVorlage {
                    name: vorlage.name,
                    typ_id: kataloge.id(Katalogeintrag::Einheitstyp(vorlage.typ))?,
                    ueber_vorlage_id: ueber,
                    funkrufname: None,
                    tz_fachaufgabe: vorlage.tz_fachaufgabe,
                    tz_organisation: vorlage.tz_organisation,
                    soll: None,
                    bemerkung: Some(szenario::BEMERKUNG),
                    sortier: vorlage.sortier,
                };
                let id = vorlage_repo::create_tx(conn, org_id, &daten).await?;
                markieren(conn, import_id, DemoStammdatenArt::EinheitVorlage, id).await?;
                let fahrzeug_ids = vorlage
                    .fahrzeuge
                    .iter()
                    .map(|f| nachschlagen(&fahrzeuge, "Fahrzeug", f))
                    .collect::<Result<Vec<i64>, AppError>>()?;
                vorlage_repo::replace_fahrzeuge_tx(conn, org_id, id, &fahrzeug_ids).await?;
                let besetzung = vorlage
                    .personal
                    .iter()
                    .map(|p| {
                        Ok(PersonalEntry {
                            personal_id: nachschlagen(&personal, "Personal", p.personal)?,
                            fahrzeug_id: p
                                .fahrzeug
                                .map(|f| nachschlagen(&fahrzeuge, "Fahrzeug", f))
                                .transpose()?,
                            staerke_position: p.position,
                        })
                    })
                    .collect::<Result<Vec<_>, AppError>>()?;
                vorlage_repo::replace_personal_tx(conn, org_id, id, &besetzung).await?;
                angelegte_vorlagen.push(vorlage.schluessel);
                v_angelegt += 1;
                id
            }
        };
        einheit_vorlagen.insert(vorlage.schluessel, id);
    }

    // Schichtmodell (LLH-1122): Kennung ist die Bezeichnung ohne Groß-/Kleinschreibung, wie der
    // 409 der Stammdaten. Ein angelegtes wird nie die Vorgabe der Organisation: das Demo-Modell
    // soll keinen echten Einsatz prägen; der Demo-Einsatz bekommt es in `importieren_tx`.
    let modelle: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, bezeichnung FROM schichtmodell WHERE org_id = ?")
            .bind(org_id)
            .fetch_all(&mut *conn)
            .await?;
    let gesucht = szenario::SCHICHTMODELL_BEZEICHNUNG.to_lowercase();
    let (schichtmodell, s_angelegt, s_mitbenutzt) = match modelle
        .iter()
        .find(|(_, b)| b.trim().to_lowercase() == gesucht)
    {
        Some((id, _)) => (*id, 0, 1),
        None => {
            let id =
                schichtmodell_repo::insert_tx(conn, org_id, &szenario::schichtmodell()?, false)
                    .await?;
            markieren(conn, import_id, DemoStammdatenArt::Schichtmodell, id).await?;
            (id, 1, 0)
        }
    };

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
        einheit_vorlagen,
        schichtmodell,
        je_art: vec![
            zeile(DemoStammdatenArt::Fahrzeug, f_angelegt, f_mitbenutzt),
            zeile(DemoStammdatenArt::Personal, p_angelegt, p_mitbenutzt),
            zeile(DemoStammdatenArt::Material, m_angelegt, m_mitbenutzt),
            zeile(DemoStammdatenArt::EinheitVorlage, v_angelegt, v_mitbenutzt),
            zeile(DemoStammdatenArt::Schichtmodell, s_angelegt, s_mitbenutzt),
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

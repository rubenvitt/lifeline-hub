//! Übernahme einer Planung in einen Einsatz (LLH-1587, Spec `vorplanung`, „Übernahme in einen
//! Einsatz“). Teil C der Change `vu7jnr2x-vorplanung-ohne-einsatz`.
//!
//! **Ein Kern.** Die Planung wird zu einem [`PlanPaket`] ([`build_paket_tx`]); Abgleich, Vorschau und
//! Schreiben macht der Übernahme-Kern des Schichtplans (`abloesung::schichtplan::uebernahme`),
//! derselbe wie beim Einlesen einer Datei (LLH-1556). Posten werden Einheiten (frei, aus ihrer
//! Einheitenvorlage oder mit ihrem Stamm-Fahrzeug, das nur verglichen, nicht disponiert wird) oder
//! UHS ihres Typs; Stamm-Personal kommt mit festem Bezug, Helfer der Planung als Angabe mit der
//! Herkunft [`HERKUNFT`] und einer Kennung je Helfer (eindeutig über alle Planungen, nie eine
//! Personalnummer). Jeder Block trägt sein Soll fertig (`ohne_vorgabe`): leer bleibt leer.
//! Programmpunkte der Planung werden Programmpunkte des Einsatzes (LLH-1583); einen gleichen
//! Punkt, den der Einsatz schon hat, lässt der Kern aus. Fehlt dem Einsatz der Abschnitt eines
//! neuen Postens, legt der Kern ihn an (LLH-1609, neuer wie laufender Einsatz), sofern das Modul
//! Einsatzabschnitte freigegeben ist; sonst bleibt der Posten ohne Abschnitt mit einem Hinweis.
//!
//! **Zwei Ziele.** Ein **neuer Einsatz** entsteht in derselben Transaktion wie Abgleich und
//! Schreiben (`einsatz::repo::anlegen_tx`): alles oder nichts. Seine Vorschau legt ihn in einer
//! Transaktion probehalber an und rollt sie zurück, damit sie dieselbe Rechnung sieht wie das
//! Übernehmen (Freigabe Ruben 08.11.2026). Ein **laufender Einsatz** der eigenen Organisation
//! verlangt dieselben Rechte wie das Einlesen einer Datei: Schreibrecht, Ablösung und Personal,
//! aktiv; Einheiten und UHS je nach Posten.
//!
//! **Danach schreibgeschützt.** Das Übernehmen vermerkt Einsatz, Einsatznummer und die Kennzahlen
//! dieses Zeitpunkts an der Planung; jeder weitere Schreibweg und eine zweite Übernahme sind 409
//! (`repo::check_schreibbar_tx`). Lesen und Löschen bleiben.

use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{SqliteConnection, SqlitePool};

use crate::abloesung::schichtplan::uebernahme::repo::{
    self as kern, bestand_tx, planen, schreiben_tx, Geschrieben, Rechte,
};
use crate::abloesung::schichtplan::uebernahme::{
    Entscheidungen, ImportVorschau, PaketBlock, PaketGrenzwerte, PaketPerson, PaketPosten,
    PaketPostenArt, PaketQualiSoll, PersonAngabe, PlanPaket, QualiAngabe,
};
use crate::abloesung::schichtplan::SchichtplanGrenzwerte;
use crate::auth::Benutzer;
use crate::einsatz::modul::{
    Abloesung, Einheiten, Einsatzabschnitte, ModulMarker, Personal, Unfallhilfsstellen,
};
use crate::einsatz::{berechtigung, repo as einsatz_repo, EinsatzRolle};
use crate::error::AppError;
use crate::uhs::UhsTyp;
use crate::zeit;

/// Herkunft der Helfer einer Planung im Plan des Einsatzes.
pub const HERKUNFT: &str = "vorplanung";

/// Wohin eine Planung geht.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "art", rename_all = "lowercase", deny_unknown_fields)]
pub enum Ziel {
    /// Ein neuer Einsatz mit Bezeichnung, Einsatzart und Ort der Planung, wahlweise aus einer
    /// Einsatz-Vorlage der Organisation (fremd oder unbekannt 400).
    Neu {
        #[serde(default)]
        vorlage_id: Option<i64>,
    },
    /// Ein laufender Einsatz der eigenen Organisation.
    Einsatz { einsatz_id: i64 },
}

/// Ein [`Ziel`], dessen Rechte außerhalb der Transaktion geprüft sind.
#[derive(Debug, Clone, Copy)]
enum CheckedZiel {
    Neu { vorlage_id: Option<i64> },
    Einsatz { einsatz_id: i64, rechte: Rechte },
}

/// Ergebnis des Übernehmens.
#[derive(Debug)]
pub struct Uebernommen {
    pub einsatz_id: i64,
    /// Der Einsatz ist mit der Übernahme entstanden.
    pub neu: bool,
    pub geschrieben: Geschrieben,
}

// ---------------------------------------------------------------------------------------------
// Planung → Paket
// ---------------------------------------------------------------------------------------------

/// Kopf der Planung, aus dem ein neuer Einsatz entsteht.
#[derive(Debug, Clone, sqlx::FromRow)]
struct Source {
    bezeichnung: String,
    einsatzart: String,
    ort: Option<String>,
    ort_lat: Option<f64>,
    ort_lon: Option<f64>,
    max_dienst_min: Option<i64>,
    min_ruhe_min: Option<i64>,
}

/// Gespeicherte Form eines Qualifikationssolls (`personal::quali_soll`).
#[derive(Deserialize)]
struct QualiPaar {
    q: i64,
    n: i64,
}

/// Bezeichnungen des Katalogs je Kennung, einschließlich deaktivierter Einträge (LLH-1611).
type QualiNamen = HashMap<i64, String>;

fn quali_angabe(id: i64, namen: &QualiNamen) -> QualiAngabe {
    QualiAngabe::Id {
        id,
        name: namen.get(&id).cloned(),
    }
}

fn parse_quali_soll(
    json: Option<&str>,
    namen: &QualiNamen,
) -> Result<Option<Vec<PaketQualiSoll>>, AppError> {
    let Some(j) = json else { return Ok(None) };
    let paare: Vec<QualiPaar> = serde_json::from_str(j)
        .map_err(|e| AppError::Internal(format!("Qualifikationssoll der Planung: {e}")))?;
    Ok(Some(
        paare
            .into_iter()
            .map(|p| PaketQualiSoll {
                qualifikation: quali_angabe(p.q, namen),
                anzahl: p.n,
            })
            .collect(),
    ))
}

fn posten_schluessel(posten_id: Option<i64>) -> String {
    match posten_id {
        Some(id) => format!("posten-{id}"),
        None => "pause".into(),
    }
}

/// Die Kennung eines Helfers der Planung im Plan des Einsatzes: eindeutig über alle Planungen,
/// nie eine Personalnummer.
pub fn helfer_kennung(planung_id: i64, helfer_id: i64) -> String {
    format!("P{planung_id}-H{helfer_id}")
}

type PostenRoh = (
    i64,
    String,
    Option<String>,
    String,
    Option<i64>,
    Option<i64>,
    Option<String>,
    i64,
);
type BlockRoh = (
    i64,
    Option<i64>,
    String,
    String,
    Option<i64>,
    Option<String>,
    Option<String>,
);
type HelferRoh = (i64, String, Option<String>, Option<String>, Option<String>);

/// Liest eine Planung als [`PlanPaket`] auf der offenen Verbindung. Fremd oder unbekannt 404,
/// schon übernommen 409.
async fn build_paket_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
) -> Result<(Source, PlanPaket), AppError> {
    super::repo::check_schreibbar_tx(conn, org_id, planung_id).await?;
    let quelle: Source = sqlx::query_as(
        "SELECT bezeichnung, einsatzart, ort, ort_lat, ort_lon, max_dienst_min, min_ruhe_min \
         FROM planung WHERE id = ?",
    )
    .bind(planung_id)
    .fetch_one(&mut *conn)
    .await?;

    let posten_roh: Vec<PostenRoh> = sqlx::query_as(
        "SELECT id, bezeichnung, abschnitt, art, einheit_vorlage_id, fahrzeug_id, uhs_typ, sortier \
         FROM planung_posten WHERE planung_id = ? ORDER BY sortier, id",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    let bloecke_roh: Vec<BlockRoh> = sqlx::query_as(
        "SELECT id, posten_id, von, bis, soll_anzahl, quali_soll, notiz FROM planung_schicht \
         WHERE planung_id = ? ORDER BY von, id",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    let zuordnung: Vec<(i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT sp.schicht_id, sp.personal_id, sp.helfer_id FROM planung_schicht_person sp \
         JOIN planung_schicht s ON s.id = sp.schicht_id \
         WHERE s.planung_id = ? ORDER BY sp.rowid",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    let helfer_roh: Vec<HelferRoh> = sqlx::query_as(
        "SELECT id, name, telefon, organisation, qualifikationen FROM planung_helfer \
         WHERE planung_id = ? ORDER BY id",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?;
    // Mit deaktivierten: ihr Name benennt den Hinweis, wenn der Abgleich sie auslässt (LLH-1611).
    let quali_namen: QualiNamen =
        sqlx::query_as::<_, (i64, String)>("SELECT id, label FROM qualifikation WHERE org_id = ?")
            .bind(org_id)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();

    let mut posten: Vec<PaketPosten> = posten_roh
        .into_iter()
        .map(
            |(id, bezeichnung, abschnitt, art, vorlage, fahrzeug, uhs_typ, sortier)| {
                let art = match (art.as_str(), fahrzeug) {
                    ("uhs", _) => PaketPostenArt::Uhs,
                    (_, Some(_)) => PaketPostenArt::Fahrzeug,
                    _ => PaketPostenArt::Einheit,
                };
                PaketPosten {
                    schluessel: posten_schluessel(Some(id)),
                    art,
                    name: bezeichnung,
                    abschnitt,
                    einheit_vorlage_id: vorlage,
                    fahrzeug_id: fahrzeug,
                    // „sonstige“ nimmt der Kern als Vorgabe ohne Typ.
                    uhs_typ: uhs_typ
                        .as_deref()
                        .and_then(UhsTyp::parse)
                        .filter(|t| *t != UhsTyp::Sonstige),
                    sortier: Some(sortier),
                    zeilen: Vec::new(),
                    // Jeder Posten der Planung wird eine Einheit oder UHS, auch ohne Block.
                    ohne_block_anlegen: true,
                }
            },
        )
        .collect();
    if bloecke_roh.iter().any(|b| b.1.is_none()) {
        posten.push(PaketPosten {
            schluessel: posten_schluessel(None),
            art: PaketPostenArt::Pause,
            name: String::new(),
            abschnitt: None,
            einheit_vorlage_id: None,
            fahrzeug_id: None,
            uhs_typ: None,
            sortier: None,
            zeilen: Vec::new(),
            ohne_block_anlegen: false,
        });
    }

    let mut stamm: BTreeSet<i64> = BTreeSet::new();
    let mut bloecke = Vec::with_capacity(bloecke_roh.len());
    for (id, posten_id, von, bis, soll, quali, notiz) in bloecke_roh {
        let personen = zuordnung
            .iter()
            .filter(|(s, _, _)| *s == id)
            .filter_map(|(_, personal, helfer)| match (personal, helfer) {
                (Some(p), _) => {
                    stamm.insert(*p);
                    Some(format!("stamm-{p}"))
                }
                (None, Some(h)) => Some(format!("helfer-{h}")),
                (None, None) => None,
            })
            .collect();
        bloecke.push(PaketBlock {
            posten: posten_schluessel(posten_id),
            von,
            bis,
            soll_anzahl: soll,
            quali_soll: parse_quali_soll(quali.as_deref(), &quali_namen)?,
            // Die Planung trägt ihr Soll je Block fertig; leer heißt kein Soll.
            ohne_vorgabe: true,
            notiz,
            personen,
            zeile: None,
        });
    }

    let mut personen: Vec<PaketPerson> = stamm
        .into_iter()
        .map(|personal_id| PaketPerson::Stamm {
            schluessel: format!("stamm-{personal_id}"),
            personal_id,
        })
        .collect();
    for (id, name, telefon, organisation, quals) in helfer_roh {
        let qualifikationen: Vec<i64> = quals
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        personen.push(PaketPerson::Angabe(PersonAngabe {
            schluessel: format!("helfer-{id}"),
            nachname: name,
            vorname: None,
            telefon,
            organisation,
            qualifikationen: qualifikationen
                .into_iter()
                .map(|q| quali_angabe(q, &quali_namen))
                .collect(),
            kennung: Some(helfer_kennung(planung_id, id)),
            herkunft: Some(HERKUNFT.into()),
            zeilen: Vec::new(),
        }));
    }

    let grenzwerte = (quelle.max_dienst_min.is_some() || quelle.min_ruhe_min.is_some()).then_some(
        PaketGrenzwerte {
            max_dienst_min: quelle.max_dienst_min,
            min_ruhe_min: quelle.min_ruhe_min,
        },
    );
    let programmpunkte = super::programm::paket_tx(conn, planung_id).await?;
    Ok((
        quelle,
        PlanPaket {
            grenzwerte,
            posten,
            bloecke,
            personen,
            programmpunkte,
        },
    ))
}

// ---------------------------------------------------------------------------------------------
// Ziel und Rechte
// ---------------------------------------------------------------------------------------------

fn key<M: ModulMarker>() -> &'static str {
    M::KEY.expect("Modul mit Schlüssel")
}

/// Prüft ein Ziel vor der Transaktion. Ein laufender Einsatz: fremd oder unbekannt 404, ohne
/// Schreibrecht, Ablösung oder Personal 403, nicht aktiv 409 (Reihenfolge wie
/// `EinsatzSchreibzugriff<Abloesung>` des Einlesens).
async fn check_ziel(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    ziel: Ziel,
) -> Result<CheckedZiel, AppError> {
    let einsatz_id = match ziel {
        Ziel::Neu { vorlage_id } => return Ok(CheckedZiel::Neu { vorlage_id }),
        Ziel::Einsatz { einsatz_id } => einsatz_id,
    };
    let einsatz = einsatz_repo::laden(pool, einsatz_id).await?;
    if einsatz.org_id != benutzer.org_id {
        return Err(AppError::NotFound);
    }
    let rolle = einsatz_repo::rolle_von(pool, einsatz_id, benutzer.id).await?;
    berechtigung::fordere_schreibrecht(rolle)?;
    let can_use = |k: &'static str| async move {
        match berechtigung::fordere_modul_zugriff_laden(
            pool,
            einsatz_id,
            einsatz.org_id,
            k,
            benutzer,
            rolle,
        )
        .await
        {
            Ok(()) => Ok(true),
            Err(AppError::Forbidden) => Ok(false),
            Err(e) => Err(e),
        }
    };
    if !can_use(key::<Abloesung>()).await? || !can_use(key::<Personal>()).await? {
        return Err(AppError::Forbidden);
    }
    berechtigung::fordere_aktiv(&einsatz)?;
    Ok(CheckedZiel::Einsatz {
        einsatz_id,
        rechte: Rechte {
            einheiten: can_use(key::<Einheiten>()).await?,
            uhs: can_use(key::<Unfallhilfsstellen>()).await?,
            abschnitte: can_use(key::<Einsatzabschnitte>()).await?,
        },
    })
}

/// Rechte im eben angelegten Einsatz: die Einsatzleitung, samt der Module, die eine Vorlage oder
/// die Organisation ausblendet oder einer Rolle vorbehält. Fehlt Ablösung oder Personal, nimmt der
/// Einsatz keinen Plan an (422).
async fn load_rechte_neu_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer: &Benutzer,
) -> Result<Rechte, AppError> {
    let rolle = Some(EinsatzRolle::Einsatzleitung);
    for (k, name) in [
        (key::<Abloesung>(), "Ablösung"),
        (key::<Personal>(), "Personal"),
    ] {
        if !berechtigung::can_use_modul_tx(conn, einsatz_id, benutzer.org_id, k, benutzer, rolle)
            .await?
        {
            return Err(AppError::UnprocessableEntity(format!(
                "Modul {name} im neuen Einsatz nicht freigegeben; der Plan hätte keinen Platz"
            )));
        }
    }
    Ok(Rechte {
        einheiten: berechtigung::can_use_modul_tx(
            conn,
            einsatz_id,
            benutzer.org_id,
            key::<Einheiten>(),
            benutzer,
            rolle,
        )
        .await?,
        uhs: berechtigung::can_use_modul_tx(
            conn,
            einsatz_id,
            benutzer.org_id,
            key::<Unfallhilfsstellen>(),
            benutzer,
            rolle,
        )
        .await?,
        abschnitte: berechtigung::can_use_modul_tx(
            conn,
            einsatz_id,
            benutzer.org_id,
            key::<Einsatzabschnitte>(),
            benutzer,
            rolle,
        )
        .await?,
    })
}

// ---------------------------------------------------------------------------------------------
// Vorschau und Übernehmen
// ---------------------------------------------------------------------------------------------

/// Was Vorschau und Übernehmen in der Transaktion vorbereiten.
struct Prepared {
    einsatz_id: i64,
    quelle: Source,
    planung: kern::Planung,
}

/// Paket lesen, einen neuen Einsatz anlegen (auf der Verbindung des Aufrufers), Bestand lesen und
/// abgleichen. Schreibt nur den neuen Einsatz.
async fn prepare_tx(
    conn: &mut SqliteConnection,
    benutzer: &Benutzer,
    planung_id: i64,
    ziel: CheckedZiel,
    entscheidungen: &Entscheidungen,
    jetzt: DateTime<Utc>,
) -> Result<Prepared, AppError> {
    let (quelle, paket) = build_paket_tx(conn, benutzer.org_id, planung_id).await?;
    let (einsatz_id, rechte) = match ziel {
        CheckedZiel::Einsatz { einsatz_id, rechte } => (einsatz_id, rechte),
        CheckedZiel::Neu { vorlage_id } => {
            let id = einsatz_repo::anlegen_tx(
                conn,
                &einsatz_repo::NeuerEinsatzDaten {
                    bezeichnung: &quelle.bezeichnung,
                    stichwort: None,
                    einsatzart: Some(&quelle.einsatzart),
                    begonnen_at: None,
                    ort: einsatz_repo::NeuerEinsatzort {
                        adresse: quelle.ort.as_deref(),
                        koordinate: quelle.ort_lat.zip(quelle.ort_lon),
                    },
                    vorlage_id,
                },
                benutzer.id,
                jetzt,
            )
            .await?;
            (id, load_rechte_neu_tx(conn, id, benutzer).await?)
        }
    };
    let bestand = bestand_tx(conn, einsatz_id, benutzer.org_id).await?;
    let planung = planen(&bestand, &paket, Vec::new(), entscheidungen, rechte)?;
    Ok(Prepared {
        einsatz_id,
        quelle,
        planung,
    })
}

/// Die Vorschau: gleicht ab und schreibt nichts. Ein neuer Einsatz wird in einer Transaktion
/// probehalber angelegt, die danach zurückrollt.
pub async fn vorschau(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    planung_id: i64,
    ziel: Ziel,
    entscheidungen: &Entscheidungen,
) -> Result<ImportVorschau, AppError> {
    let ziel = check_ziel(pool, benutzer, ziel).await?;
    let jetzt = Utc::now();
    if let CheckedZiel::Einsatz { .. } = ziel {
        let mut conn = pool.acquire().await?;
        return Ok(
            prepare_tx(&mut conn, benutzer, planung_id, ziel, entscheidungen, jetzt)
                .await?
                .planung
                .vorschau,
        );
    }
    let mut versuch: u32 = 0;
    loop {
        versuch += 1;
        // BEGIN IMMEDIATE wie jede schreibende Transaktion (`crate::tx`): die Nummernvergabe
        // des Einsatzes liest, bevor sie schreibt.
        let mut tx = match pool.begin_with("BEGIN IMMEDIATE").await {
            Ok(tx) => tx,
            Err(e) if crate::tx::ist_busy(&e) && versuch < crate::tx::MAX_VERSUCHE => {
                crate::tx::backoff(versuch).await;
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        let ergebnis = prepare_tx(&mut tx, benutzer, planung_id, ziel, entscheidungen, jetzt).await;
        // Der Fehler der Vorschau geht vor: hat SQLite die Transaktion nach ihm schon selbst
        // beendet, scheitert auch der Rollback.
        let zurueck = tx.rollback().await;
        let v = ergebnis?;
        zurueck?;
        return Ok(v.planung.vorschau);
    }
}

/// Übernimmt in EINER Transaktion: neuer Einsatz, Abgleich, Schreiben und der Vermerk an der
/// Planung. Fehler des Abgleichs 422 (Zeilen), fehlende Freigabe eines Moduls 403, schon
/// übernommen 409, in einen laufenden Einsatz ohne jede Änderung 422.
pub async fn uebernehmen(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    planung_id: i64,
    ziel: Ziel,
    entscheidungen: &Entscheidungen,
) -> Result<Uebernommen, AppError> {
    let ziel = check_ziel(pool, benutzer, ziel).await?;
    let jetzt = Utc::now();
    let jetzt_text = zeit::formatiere_utc(jetzt);
    crate::write_retry!(pool, |conn| {
        let v = prepare_tx(conn, benutzer, planung_id, ziel, entscheidungen, jetzt).await?;
        let startwert =
            crate::einsatz::einstellungen::etb_startwert(&mut *conn, v.einsatz_id).await?;
        // Die Bezeichnung (höchstens `planung::BEZEICHNUNG_MAX`) hält die ETB-Grenze.
        let anlass = format!("Planung „{}“ übernommen", v.quelle.bezeichnung);
        let geschrieben = schreiben_tx(
            conn,
            v.einsatz_id,
            benutzer.org_id,
            benutzer.id,
            &v.planung,
            startwert,
            &jetzt_text,
            &anlass,
        )
        .await?;
        // In einen laufenden Einsatz nur mit Wirkung: sonst wäre die Planung gesperrt, ohne dass
        // etwas übernommen ist (der Dialog sperrt „Übernehmen“ dann mit „Keine Änderungen“).
        if matches!(ziel, CheckedZiel::Einsatz { .. }) && geschrieben.zaehlung.aenderungen == 0 {
            return Err(AppError::UnprocessableEntity(
                "Die Planung bringt in diesen Einsatz keine Änderungen".into(),
            ));
        }
        mark_uebernommen_tx(conn, benutzer, planung_id, v.einsatz_id, &jetzt_text).await?;
        Ok(Uebernommen {
            einsatz_id: v.einsatz_id,
            neu: matches!(ziel, CheckedZiel::Neu { .. }),
            geschrieben,
        })
    })
}

/// Vermerkt die Übernahme an der Planung, mit den Kennzahlen dieses Zeitpunkts. Danach ist sie
/// schreibgeschützt.
async fn mark_uebernommen_tx(
    conn: &mut SqliteConnection,
    benutzer: &Benutzer,
    planung_id: i64,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    let (max, ruhe): (Option<i64>, Option<i64>) =
        sqlx::query_as("SELECT max_dienst_min, min_ruhe_min FROM planung WHERE id = ?")
            .bind(planung_id)
            .fetch_one(&mut *conn)
            .await?;
    let kennzahlen = super::repo::kennzahlen_von(
        conn,
        benutzer.org_id,
        planung_id,
        SchichtplanGrenzwerte::aus(max, ruhe),
    )
    .await?;
    let json = serde_json::to_string(&kennzahlen)
        .map_err(|e| AppError::Internal(format!("Kennzahlen der Übernahme: {e}")))?;
    let nummer: Option<String> =
        sqlx::query_scalar("SELECT einsatznummer_intern FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    let geaendert = sqlx::query(
        "UPDATE planung SET uebernommen_at = ?, uebernommen_von = ?, uebernahme_einsatz = ?, \
            uebernahme_einsatznummer = ?, uebernahme_kennzahlen = ?, version = version + 1 \
         WHERE id = ? AND uebernommen_at IS NULL",
    )
    .bind(jetzt)
    .bind(benutzer.id)
    .bind(einsatz_id)
    .bind(nummer)
    .bind(json)
    .bind(planung_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert == 0 {
        return Err(AppError::Conflict(
            "Die Planung ist schon übernommen".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualifikationssoll_aus_der_gespeicherten_form() {
        let namen = QualiNamen::from([(7, "Sanitäter".to_string())]);
        assert_eq!(parse_quali_soll(None, &namen).unwrap(), None);
        assert_eq!(
            parse_quali_soll(Some(r#"[{"q":7,"n":2},{"q":9,"n":1}]"#), &namen).unwrap(),
            Some(vec![
                PaketQualiSoll {
                    qualifikation: QualiAngabe::Id {
                        id: 7,
                        name: Some("Sanitäter".into()),
                    },
                    anzahl: 2,
                },
                PaketQualiSoll {
                    qualifikation: QualiAngabe::Id { id: 9, name: None },
                    anzahl: 1,
                },
            ])
        );
    }

    #[test]
    fn helfer_kennung_ist_keine_personalnummer() {
        assert_eq!(helfer_kennung(3, 12), "P3-H12");
    }

    #[test]
    fn ziel_wire() {
        let neu: Ziel = serde_json::from_str(r#"{"art":"neu"}"#).unwrap();
        assert_eq!(neu, Ziel::Neu { vorlage_id: None });
        let e: Ziel = serde_json::from_str(r#"{"art":"einsatz","einsatz_id":4}"#).unwrap();
        assert_eq!(e, Ziel::Einsatz { einsatz_id: 4 });
        assert!(serde_json::from_str::<Ziel>(r#"{"art":"irgendwo"}"#).is_err());
        assert!(serde_json::from_str::<Ziel>(r#"{"art":"neu","x":1}"#).is_err());
    }
}

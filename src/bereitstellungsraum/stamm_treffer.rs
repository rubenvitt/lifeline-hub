//! Treffer aus den Stammdaten beim Eintreffen am Bereitstellungsraum (LLH-1300, Change
//! `llh-1300-br-stamm-treffer`, design.md D1–D5, Spec `bereitstellungsraum-belegung`).
//!
//! Ein Stamm-Treffer ist eine aktive Einheiten-Vorlage der Organisation (LLH-1042). Das Gerät des
//! Raums darf den Katalog nicht lesen; es sucht über die schmale Projektion [`suchen`] (ab
//! [`SUCHE_MIN`] Zeichen, höchstens [`TREFFER_MAX`] Treffer, nur Namen und Funkrufnamen). Gebucht
//! wird über [`vorlage_tx`] in der Transaktion des Eintreffens: Einheit samt Untereinheiten aus der
//! Vorlage bilden (`einheit::aus_vorlage`, ohne Besatzung und Material), alle Einheiten treten in
//! den Raum ein, genau ein ETB-Eintrag wie beim Eintreffen einer bekannten Kraft, keine Meldung.

use super::eintreffen::{
    aktive_fahrzeuge_tx, check_namen_frei_tx, eintritt_einheit_tx, normalize, vergebene_namen_tx,
    EintreffenZeitachse, GebildetLive, Gebucht, Rahmen,
};
use super::ObjektTyp;
use crate::einheit::aus_vorlage::{self, Lesen, Plan, VorschauZustand, Wahl};
use crate::einheit_vorlage::{repo as vorlage_repo, EinheitVorlage};
use crate::error::AppError;
use crate::kraefte_disposition::Kontext;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Kürzeste Suche (Zeichen nach dem Trimmen); darunter ist die Antwort leer (design.md D2).
pub const SUCHE_MIN: usize = 3;

/// Längste Suche (Zeichen nach dem Trimmen); darüber 400.
pub const SUCHE_MAX: usize = 100;

/// Höchstzahl Treffer je Suche (design.md D2).
pub const TREFFER_MAX: usize = 10;

/// Bei der Planung lesen nur die Fahrzeuge mit (D3): Besatzung und Material kommen nicht mit.
const NUR_FAHRZEUGE: Lesen = Lesen {
    fahrzeuge: true,
    personal: false,
    material: false,
};

/// Ein Stamm-Treffer am Raum (design.md D2): nur, was der Einweiser zum Erkennen braucht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StammTreffer {
    pub vorlage_id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub funkrufname: Option<String>,
    pub typ_label: String,
    /// Zahl der aktiven Untereinheiten, die mit gebildet würden.
    pub untereinheiten: i64,
    /// Funkrufnamen der Stamm-Fahrzeuge, die beim Buchen mitkämen, über den ganzen Baum.
    pub fahrzeuge: Vec<String>,
    /// Trägt die Vorlage eine Demo-Marke (Spec `demo-daten`)?
    pub ist_demo: bool,
}

/// Prüft die Suche: über [`SUCHE_MAX`] Zeichen 400; unter [`SUCHE_MIN`] `None` (leere Antwort,
/// kein Fehler: der Dialog fragt beim Tippen).
pub fn check_suche(suche: Option<&str>) -> Result<Option<String>, AppError> {
    let s = normalize(suche.unwrap_or_default());
    let n = s.chars().count();
    if n > SUCHE_MAX {
        return Err(AppError::Validation(format!(
            "Suche darf höchstens {SUCHE_MAX} Zeichen haben"
        )));
    }
    Ok((n >= SUCHE_MIN).then_some(s))
}

/// Trifft die Suche (Vergleichsform) die Vorlage? Name, Funkrufname, Typ oder der Funkrufname
/// eines ihrer eigenen Fahrzeuge, als Teilwort.
pub fn trifft(v: &EinheitVorlage, suche: &str) -> bool {
    let felder = [
        Some(v.name.as_str()),
        v.funkrufname.as_deref(),
        Some(v.typ_label.as_str()),
    ];
    felder
        .into_iter()
        .flatten()
        .chain(v.fahrzeuge.iter().map(|f| f.funkrufname.as_str()))
        .any(|f| normalize(f).contains(suche))
}

/// Die Stamm-Fahrzeuge des Baums, die beim Buchen mitkommen (D3, Schritt 4): nicht im Einsatz,
/// frei oder entlassen. Gebundene und außer Dienst gestellte bleiben, wo sie sind. In der
/// Reihenfolge der Vorlage, jedes einmal.
pub fn mitkommende_fahrzeuge(plan: &Plan) -> Vec<Wahl> {
    let mut wahl: Vec<Wahl> = Vec::new();
    for f in plan.knoten.iter().flat_map(|k| k.fahrzeuge.iter()) {
        let kommt = plan.fahrzeuge.get(&f.fahrzeug_id).is_some_and(|l| {
            matches!(
                l.zustand,
                VorschauZustand::Neu | VorschauZustand::Frei | VorschauZustand::Entlassen
            )
        });
        if kommt && !wahl.iter().any(|w| w.id == f.fahrzeug_id) {
            wahl.push(Wahl {
                id: f.fahrzeug_id,
                umhaengen: false,
            });
        }
    }
    wahl
}

/// Die Funkrufnamen zu [`mitkommende_fahrzeuge`].
fn funkrufnamen(plan: &Plan, wahl: &[Wahl]) -> Vec<String> {
    wahl.iter()
        .filter_map(|w| {
            plan.knoten
                .iter()
                .flat_map(|k| k.fahrzeuge.iter())
                .find(|f| f.fahrzeug_id == w.id)
                .map(|f| f.funkrufname.clone())
        })
        .collect()
}

/// Sucht Stamm-Treffer für den Raum (design.md D2). `suche` ist schon geprüft ([`check_suche`]).
/// Aktive Vorlagen, die die Suche treffen, nach Name; eine Vorlage, deren Name oder Funkrufname
/// eine aktive Kraft des Einsatzes trägt, oder die sich nicht bilden ließe (zu groß), fehlt.
pub async fn suchen(
    pool: &SqlitePool,
    einsatz_id: i64,
    org_id: i64,
    suche: &str,
) -> Result<Vec<StammTreffer>, AppError> {
    let mut kandidaten: Vec<EinheitVorlage> = vorlage_repo::list(pool, org_id, true)
        .await?
        .into_iter()
        .filter(|v| trifft(v, suche))
        .collect();
    kandidaten.sort_by_cached_key(|v| (v.name.to_lowercase(), v.id));
    let mut conn = pool.acquire().await?;
    let vergeben = vergebene_namen_tx(&mut conn, einsatz_id).await?;
    let mut treffer = Vec::new();
    for v in kandidaten {
        if treffer.len() >= TREFFER_MAX {
            break;
        }
        let im_einsatz = std::iter::once(v.name.as_str())
            .chain(v.funkrufname.as_deref())
            .any(|n| vergeben.contains(&normalize(n)));
        if im_einsatz {
            continue;
        }
        let plan =
            match aus_vorlage::plan_tx(&mut conn, einsatz_id, org_id, v.id, NUR_FAHRZEUGE).await {
                Ok(p) => p,
                // Deaktiviert (Rennen mit der Pflege) oder zu groß: kein Treffer.
                Err(AppError::UnprocessableEntity(_) | AppError::NotFound) => continue,
                Err(e) => return Err(e),
            };
        let wahl = mitkommende_fahrzeuge(&plan);
        treffer.push(StammTreffer {
            vorlage_id: v.id,
            untereinheiten: plan.knoten.len() as i64 - 1,
            fahrzeuge: funkrufnamen(&plan, &wahl),
            name: v.name,
            funkrufname: v.funkrufname,
            typ_label: v.typ_label,
            ist_demo: v.ist_demo,
        });
    }
    Ok(treffer)
}

/// ETB-Wortlaut (design.md D3, Schritt 7): der Satz der bekannten Kraft, dahinter Herkunft,
/// Untereinheiten und Fahrzeuge: „Florian Musterstadt 1 im BR Sportplatz eingetroffen (aus den
/// Stammdaten; mit 1. Gruppe; Fahrzeuge 1-10-1, 1-44-1)“.
pub fn etb_text(
    name: &str,
    br_bezeichnung: &str,
    zeitachse: EintreffenZeitachse,
    untereinheiten: &[String],
    fahrzeuge: &[String],
) -> String {
    let satz = match zeitachse {
        EintreffenZeitachse::Geschrieben => super::etb_text_eingetroffen(name, br_bezeichnung),
        _ => super::etb_text_eintritt(name, br_bezeichnung),
    };
    let mut zusatz = vec!["aus den Stammdaten".to_string()];
    if !untereinheiten.is_empty() {
        zusatz.push(format!("mit {}", untereinheiten.join(", ")));
    }
    if !fahrzeuge.is_empty() {
        zusatz.push(format!("Fahrzeuge {}", fahrzeuge.join(", ")));
    }
    format!("{satz} ({})", zusatz.join("; "))
}

/// Bildet die Einheit aus der Vorlage und bucht ihr Eintreffen in der Transaktion des Aufrufers
/// (design.md D3): Plan (fremd 404, deaktiviert oder zu groß 422), Doppelbuchung über den Namen
/// der Wurzel (422), Bilden mit den mitkommenden Fahrzeugen, Eintritt jeder gebildeten Einheit
/// (die Belegung der Wurzel trägt die `client_id`), genau ein ETB-Systemeintrag. Keine Meldung,
/// kein Kennzeichen „nicht übernommen“ (D4).
pub async fn vorlage_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    br_bezeichnung: &str,
    vorlage_id: i64,
) -> Result<Gebucht, AppError> {
    let plan =
        aus_vorlage::plan_tx(conn, r.einsatz_id, r.org_id, vorlage_id, NUR_FAHRZEUGE).await?;
    let wurzel = &plan.knoten[0];
    let namen: Vec<&str> = std::iter::once(wurzel.name.as_str())
        .chain(wurzel.funkrufname.as_deref())
        .collect();
    check_namen_frei_tx(conn, r.einsatz_id, &namen).await?;
    let wahl = mitkommende_fahrzeuge(&plan);
    let kontext = Kontext {
        einsatz_id: r.einsatz_id,
        org_id: r.org_id,
        benutzer_id: r.benutzer_id,
    };
    let anfrage = aus_vorlage::Anfrage {
        name: None,
        abschnitt_id: None,
        fahrzeuge: &wahl,
        personal: &[],
        material: &[],
    };
    let gebildet = aus_vorlage::bilde_tx(conn, kontext, &plan, &anfrage).await?;
    let (spitze, unter) = gebildet
        .einheiten
        .split_first()
        .ok_or_else(|| AppError::Internal("Bildung ohne Einheit".into()))?;

    let e = eintritt_einheit_tx(conn, r, spitze.id).await?;
    let mut personen = e.personen;
    let mut abloesung = e.abloesung;
    let mut hinweise = e.hinweise;
    // Die Untereinheiten treten mit ein, ohne eigenen Idempotenzschlüssel (der Index ist je
    // Einsatz eindeutig; das Replay findet die Wurzel).
    let ohne_schluessel = Rahmen {
        client_id: None,
        ..*r
    };
    for u in unter {
        let eu = eintritt_einheit_tx(conn, &ohne_schluessel, u.id).await?;
        personen.extend(eu.personen);
        abloesung.extend(eu.abloesung);
        hinweise.extend(eu.hinweise);
    }
    personen.extend(gebildet.personal.iter().map(|p| p.id));
    personen.sort_unstable();
    personen.dedup();

    let unter_namen: Vec<String> = unter.iter().map(|u| u.name.clone()).collect();
    let fahrzeug_namen: Vec<String> = gebildet.fahrzeuge.iter().map(|f| f.name.clone()).collect();
    let etb_id = crate::etb::system_audit_tx(
        &mut *conn,
        r.einsatz_id,
        r.benutzer_id,
        r.etb_startwert,
        &etb_text(
            &spitze.name,
            br_bezeichnung,
            e.zeitachse,
            &unter_namen,
            &fahrzeug_namen,
        ),
    )
    .await?;
    let fahrzeug_ids = aktive_fahrzeuge_tx(conn, r.einsatz_id, spitze.id).await?;
    Ok(Gebucht {
        belegung_id: e.belegung_id,
        objekt_typ: ObjektTyp::Einheit,
        objekt_id: spitze.id,
        einheit_id: Some(spitze.id),
        fahrzeug_ids,
        zeitachse: e.zeitachse,
        meldung_id: None,
        etb_id,
        personen,
        abloesung,
        hinweise,
        nachforderung_id: None,
        als_einheit: false,
        gebildet: GebildetLive {
            untereinheiten: unter.iter().map(|u| u.id).collect(),
            fahrzeuge: gebildet.fahrzeuge.iter().map(|f| f.id).collect(),
            raeume: gebildet.raeume.clone(),
        },
    })
}

#[cfg(test)]
mod tests;

//! Eintreffen am Bereitstellungsraum (LLH-1075, Change i76r8inr, design.md D1–D9, Spec
//! `bereitstellungsraum-belegung`): eine bekannte Kraft oder eine unangemeldete Kraft in EINER
//! Transaktion einbuchen. Der Baustein kennt keine Route, kein Gerät und kein Live; die Route
//! (`routes::einsatz_bereitstellungsraum::eintreffen`) prüft Stelle, Rechte und Replay, legt ihn
//! in `write_retry!` und meldet nach dem Commit. So bleibt er für die Nachforderung (LLH-1097)
//! wiederverwendbar.

use super::belegung_repo::{self, Buchung};
use super::{BrBelegungAnzeige, BrBelegungsArt, FahrzeugAngabe, ObjektTyp, UnangemeldetAngabe};
use crate::error::AppError;
use crate::routes::support::{optional_max, pflicht_max};
use crate::staerke::Staerke;
use crate::wire_enum::wire_enum;
use crate::zeitachse::repo::{self as zeitachse_repo, Kraft, Neu, Schreibergebnis};
use crate::zeitachse::{ZeitachseArt, ZeitachseQuelle};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

// ─── Eingabe ────────────────────────────────────────────────────────────────

/// Körper von `POST …/bereitstellungsraeume/{bid}/eintreffen` (design.md D1). Genau eines von
/// `kraft` und `unangemeldet`.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct EintreffenEingabe {
    /// Eine Einheit oder ein einheitenloses Fahrzeug des Einsatzes.
    #[serde(default)]
    pub kraft: Option<KraftAngabe>,
    /// Eine Kraft, die im Einsatz noch nicht geführt wird.
    #[serde(default)]
    pub unangemeldet: Option<UnangemeldetEingabe>,
    /// Erfassungszeitpunkt nach Serveruhr des Clients (Offline-Warteschlange); höchstens 60 s in
    /// der Zukunft. Ohne Angabe gilt „jetzt“.
    #[serde(default)]
    pub zeitpunkt_at: Option<String>,
    /// Idempotenzschlüssel der Offline-Warteschlange (≤ 64 Zeichen).
    #[serde(default)]
    pub client_id: Option<String>,
    /// Nachforderung, aus der die Kraft erwartet wird (LLH-1387, design.md D4): die Einheit
    /// bekommt den Verweis. Nur mit Ziel = dieser Raum, nicht für ein einheitenloses Fahrzeug.
    #[serde(default)]
    pub nachforderung_id: Option<i64>,
}

/// Bekannte Kraft: `objekt_typ` `einheit` oder `fahrzeug`.
#[derive(Debug, Deserialize, ToSchema)]
pub struct KraftAngabe {
    pub objekt_typ: String,
    pub objekt_id: i64,
}

/// Unangemeldete Kraft (design.md D1/D2).
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct UnangemeldetEingabe {
    /// 1 bis `SAMMEL_MAX` Fahrzeuge; das erste gibt der Einheit ihren Namen.
    #[serde(default)]
    pub fahrzeuge: Vec<FahrzeugEingabe>,
    /// Gemeldete Stärke; steht nur im Text von Meldung und ETB (D6).
    #[serde(default)]
    pub staerke: Option<StaerkeEingabe>,
    /// Freitext an der Einheit; nie in Meldung oder ETB.
    #[serde(default)]
    pub bemerkung: Option<String>,
    /// Neuanlage trotz gleichnamiger Kraft im Einsatz (D9).
    #[serde(default)]
    pub trotzdem_anlegen: bool,
}

/// Ein Fahrzeug der unangemeldeten Kraft (Ad-hoc-Fahrzeug).
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct FahrzeugEingabe {
    #[serde(default)]
    pub funkrufname: String,
    #[serde(default)]
    pub fahrzeugtyp: Option<String>,
    /// Organisation; die Oberfläche fragt sie einmal und setzt sie in jedes Fahrzeug.
    #[serde(default)]
    pub traegerorganisation: Option<String>,
}

/// Stärke F/UF/M: alle drei oder keine.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct StaerkeEingabe {
    #[serde(default)]
    pub fuehrer: Option<i64>,
    #[serde(default)]
    pub unterfuehrer: Option<i64>,
    #[serde(default)]
    pub mannschaft: Option<i64>,
}

/// Geprüftes, getrimmtes Fahrzeug einer unangemeldeten Kraft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeuesFahrzeug {
    pub funkrufname: String,
    pub fahrzeugtyp: Option<String>,
    pub organisation: Option<String>,
}

/// Geprüfte unangemeldete Kraft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unangemeldet {
    /// Entdoppelt (gleicher Funkrufname nach [`normalize`] nur einmal), mindestens eins.
    pub fahrzeuge: Vec<NeuesFahrzeug>,
    pub staerke: Option<Staerke>,
    pub bemerkung: Option<String>,
    pub trotzdem_anlegen: bool,
}

/// Was eingebucht wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Erfassung {
    Bekannt { typ: ObjektTyp, objekt_id: i64 },
    Unangemeldet(Unangemeldet),
}

impl Erfassung {
    pub fn is_unangemeldet(&self) -> bool {
        matches!(self, Erfassung::Unangemeldet(_))
    }
}

/// Feldprüfung vor jedem Schreiben (design.md D2): 400 für jedes Feld für sich, danach 422,
/// wenn `kraft` und `unangemeldet` zugleich kommen oder ein Fahrzeug eine Nachforderung nennt
/// (LLH-1387 D4). Weder noch → 400.
pub fn check(eingabe: &EintreffenEingabe) -> Result<Erfassung, AppError> {
    if eingabe.kraft.is_none() && eingabe.unangemeldet.is_none() {
        return Err(AppError::Validation(
            "Kraft oder unangemeldete Kraft fehlt".into(),
        ));
    }
    let bekannt = eingabe
        .kraft
        .as_ref()
        .map(|k| {
            ObjektTyp::parse(k.objekt_typ.trim())
                .map(|typ| Erfassung::Bekannt {
                    typ,
                    objekt_id: k.objekt_id,
                })
                .ok_or_else(|| {
                    AppError::Validation(format!("Unbekannter objekt_typ: '{}'", k.objekt_typ))
                })
        })
        .transpose()?;
    let unangemeldet = eingabe
        .unangemeldet
        .as_ref()
        .map(check_unangemeldet)
        .transpose()?;
    if eingabe.nachforderung_id.is_some()
        && matches!(
            bekannt,
            Some(Erfassung::Bekannt {
                typ: ObjektTyp::Fahrzeug,
                ..
            })
        )
    {
        return Err(AppError::UnprocessableEntity(
            "Ein Fahrzeug ohne Einheit lässt sich nicht mit einer Nachforderung verknüpfen".into(),
        ));
    }
    match (bekannt, unangemeldet) {
        (Some(_), Some(_)) => Err(AppError::UnprocessableEntity(
            "Entweder eine bekannte oder eine unangemeldete Kraft buchen, nicht beides".into(),
        )),
        (Some(b), None) => Ok(b),
        (None, Some(u)) => Ok(Erfassung::Unangemeldet(u)),
        (None, None) => unreachable!("oben ausgeschlossen"),
    }
}

fn check_unangemeldet(u: &UnangemeldetEingabe) -> Result<Unangemeldet, AppError> {
    use crate::fahrzeug::ADHOC_TEXT_MAX;
    if u.fahrzeuge.is_empty() {
        return Err(AppError::Validation(
            "Funkrufname darf nicht leer sein".into(),
        ));
    }
    // Gezählt vor dem Entdoppeln: die Grenze gilt für die Anfrage, nicht für ihr Ergebnis.
    let max = crate::kraefte_disposition::SAMMEL_MAX;
    if u.fahrzeuge.len() > max {
        return Err(AppError::Validation(format!(
            "Höchstens {max} Fahrzeuge je Erfassung"
        )));
    }
    let mut fahrzeuge: Vec<NeuesFahrzeug> = Vec::with_capacity(u.fahrzeuge.len());
    for f in &u.fahrzeuge {
        let neu = NeuesFahrzeug {
            funkrufname: pflicht_max(&f.funkrufname, "Funkrufname", ADHOC_TEXT_MAX)?,
            fahrzeugtyp: optional_max(f.fahrzeugtyp.clone(), "Fahrzeugtyp", ADHOC_TEXT_MAX)?,
            organisation: optional_max(
                f.traegerorganisation.clone(),
                "Organisation",
                ADHOC_TEXT_MAX,
            )?,
        };
        let schluessel = normalize(&neu.funkrufname);
        if !fahrzeuge
            .iter()
            .any(|g| normalize(&g.funkrufname) == schluessel)
        {
            fahrzeuge.push(neu);
        }
    }
    let staerke = match &u.staerke {
        Some(s) => Staerke::from_options(s.fuehrer, s.unterfuehrer, s.mannschaft)
            .map_err(AppError::Validation)?,
        None => None,
    };
    let bemerkung = optional_max(
        u.bemerkung.clone(),
        "Bemerkung",
        crate::einheit::BEMERKUNG_MAX,
    )?;
    Ok(Unangemeldet {
        fahrzeuge,
        staerke,
        bemerkung,
        trotzdem_anlegen: u.trotzdem_anlegen,
    })
}

/// Vergleichsform eines Funkrufnamens (D9): ohne Rand-Leerzeichen, Leerzeichenfolgen zu einem,
/// ohne Groß/Klein (Unicode, `to_lowercase`; SQL-`lower()` faltet nur ASCII).
pub fn normalize(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

// ─── Ergebnis ───────────────────────────────────────────────────────────────

wire_enum! {
    /// Was das Eintreffen in der Kräfte-Zeitachse bewirkt hat (design.md D1).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EintreffenZeitachse {
        /// Ereignis `eintreffen` mit Quelle `bereitstellungsraum` geschrieben.
        Geschrieben => "geschrieben",
        /// Die offene Periode trug schon ein Eintreffen; nur der Eintritt ist gebucht.
        Ausgelassen => "ausgelassen",
        /// Ein Fahrzeug: Fahrzeuge haben keine Zeitachse.
        Keine => "keine",
    }
    try_from = |s| format!("Ungültige EintreffenZeitachse: {s}");
}

/// Antwort 201 des Eintreffens (design.md D1), beim Replay aus dem Bestand rekonstruiert (D8).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EintreffenErgebnis {
    /// Die Belegungszeile des Eintritts.
    pub belegung: BrBelegungAnzeige,
    /// Die eingebuchte oder neu angelegte Einheit; fehlt bei einem Fahrzeug.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheit_id: Option<i64>,
    /// Aktive Fahrzeuge der Einheit bzw. das Fahrzeug selbst.
    pub fahrzeug_ids: Vec<i64>,
    pub zeitachse: EintreffenZeitachse,
    /// Meldung an die Einsatzleitung (nur unangemeldet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meldung_id: Option<i64>,
    /// Die Buchung hat die Kraft neu angelegt.
    pub unangemeldet: bool,
}

/// Was [`eintreffen_tx`] geschrieben hat, für Antwort und Live nach dem Commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gebucht {
    pub belegung_id: i64,
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    pub einheit_id: Option<i64>,
    pub fahrzeug_ids: Vec<i64>,
    pub zeitachse: EintreffenZeitachse,
    pub meldung_id: Option<i64>,
    /// Der eine ETB-Eintrag der Buchung (Meldungseintrag oder Systemeintrag, D5).
    pub etb_id: i64,
    /// Personen aus dem Fan-out des Eintreffens (für `sse_personal`).
    pub personen: Vec<i64>,
    /// ETB-Einträge der Kopplung an die Ablösung (LLH-1128: Schicht mit dem Eintreffen
    /// begonnen), für `routes::abloesung::publish_kopplung`. Eigene Einträge des Moduls
    /// Ablösung, nicht der Buchung: die Regel „genau ein ETB-Eintrag“ (D5) gilt für die Buchung.
    pub abloesung: Vec<i64>,
    /// Hinweise zur ablösenden Einheit (LLH-1131): eine als ablösende geplante Einheit ist am
    /// Raum eingetroffen. Gemeldet nach dem Commit über `routes::abloesung::publish_kopplung`.
    pub hinweise: Vec<crate::benachrichtigung::Anlass>,
    /// Die Nachforderung, mit der die Einheit verknüpft wurde (LLH-1387), für Live.
    pub nachforderung_id: Option<i64>,
}

/// Rahmen einer Buchung: wer, wo, wann.
#[derive(Debug, Clone, Copy)]
pub struct Rahmen<'a> {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub br_id: i64,
    pub benutzer_id: i64,
    /// Erfassungszeitpunkt (DB-Format, UTC): Belegung, Zeitachse, `ereigniszeit`, Kennzeichen.
    pub zeitpunkt_at: &'a str,
    /// Eingang „jetzt“ (DB-Format, UTC): `eingang_at` und Frist der Meldung.
    pub eingang_at: &'a str,
    pub client_id: Option<&'a str>,
    /// ETB-Startwert des Einsatzes (vor der Transaktion gelesen, Muster `bilden`).
    pub etb_startwert: i64,
}

// ─── Schreiben ──────────────────────────────────────────────────────────────

/// Bucht das Eintreffen in der Transaktion des Aufrufers (design.md D2): Raum prüfen, bekannte
/// Kraft prüfen oder unangemeldete anlegen, Eintritt, Eintreffen (nur Einheit), Meldung (nur
/// unangemeldet) und genau ein ETB-Eintrag. Mit `nachforderung_id` bekommt die Einheit den
/// Verweis auf die Nachforderung, aus der sie erwartet wird (LLH-1387, design.md D4). Ein Fehler
/// in jedem Schritt rollt alles zurück.
pub async fn eintreffen_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    erfassung: &Erfassung,
    nachforderung_id: Option<i64>,
) -> Result<Gebucht, AppError> {
    // 1. Raum in der Transaktion (gegen das Rennen mit „Auflösen“): sonst 404/422.
    let br = belegung_repo::require_belegbar_tx(&mut *conn, r.einsatz_id, r.br_id).await?;
    let herkunft = match nachforderung_id {
        Some(id) => Some(check_herkunft_tx(conn, r, id).await?),
        None => None,
    };
    match erfassung {
        Erfassung::Bekannt { typ, objekt_id } => {
            bekannt_tx(
                conn,
                r,
                &br.bezeichnung,
                *typ,
                *objekt_id,
                herkunft.as_ref(),
            )
            .await
        }
        Erfassung::Unangemeldet(u) => unangemeldet_tx(conn, r, &br, u, herkunft.as_ref()).await,
    }
}

/// Die Nachforderung, aus der eine Kraft am Raum erwartet wird (LLH-1387, design.md D4).
#[derive(Debug, Clone)]
struct Herkunft {
    id: i64,
    anzahl: Option<i64>,
    /// Kurzname im Wortlaut („2× RTW“).
    kurz: String,
}

/// Prüft die Nachforderung in der Transaktion der Buchung: eine des Einsatzes mit Ziel = dieser
/// Raum, sonst 404 (das Gerät erfährt nichts über fremde); zugesagt, unterwegs oder schon
/// eingetroffen (Rennen mit „Eintreffen melden“), sonst 422.
async fn check_herkunft_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    nachforderung_id: i64,
) -> Result<Herkunft, AppError> {
    use crate::nachforderung::{STATUS_EINGETROFFEN, STATUS_UNTERWEGS, STATUS_ZUGESAGT};
    let (status, art, anzahl, ziel_br_id): (String, String, Option<i64>, Option<i64>) =
        sqlx::query_as(
            "SELECT status, art, anzahl, ziel_br_id FROM nachforderung \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(nachforderung_id)
        .bind(r.einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
    if ziel_br_id != Some(r.br_id) {
        return Err(AppError::NotFound);
    }
    if ![STATUS_ZUGESAGT, STATUS_UNTERWEGS, STATUS_EINGETROFFEN].contains(&status.as_str()) {
        return Err(AppError::UnprocessableEntity(
            "Aus dieser Nachforderung wird keine Kraft erwartet".into(),
        ));
    }
    Ok(Herkunft {
        id: nachforderung_id,
        anzahl,
        kurz: crate::nachforderung::repo::kurzname(anzahl, &art),
    })
}

/// Setzt den Verweis der Einheit auf die Nachforderung (D4): schon derselbe → nichts zu tun, ein
/// anderer → 409; mehr Einheiten als die Anzahl → 422.
async fn verknuepfe_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    h: &Herkunft,
    einheit_id: i64,
) -> Result<(), AppError> {
    let (name, verweis): (String, Option<i64>) = sqlx::query_as(
        "SELECT name, nachforderung_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(r.einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    match verweis {
        Some(n) if n == h.id => return Ok(()),
        Some(_) => {
            return Err(AppError::Conflict(format!(
                "«{name}» ist schon aus einer Nachforderung übernommen"
            )))
        }
        None => {}
    }
    if let Some(a) = h.anzahl {
        let verknuepft: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND nachforderung_id = ?",
        )
        .bind(r.einsatz_id)
        .bind(h.id)
        .fetch_one(&mut *conn)
        .await?;
        if verknuepft >= a {
            return Err(AppError::UnprocessableEntity(format!(
                "Die Nachforderung umfasst {a}; verknüpft sind schon {verknuepft}"
            )));
        }
    }
    sqlx::query("UPDATE einsatz_einheit SET nachforderung_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(h.id)
        .bind(einheit_id)
        .bind(r.einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn buchung<'a>(r: &Rahmen<'a>) -> Buchung<'a> {
    Buchung {
        art: BrBelegungsArt::Eintritt,
        notiz: None,
        client_id: r.client_id,
        zeitpunkt_at: Some(r.zeitpunkt_at),
    }
}

/// Eintreffen der Einheit in der Zeitachse (Quelle `bereitstellungsraum`, ohne Notiz).
async fn eintreffen_zeitachse_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    einheit_id: i64,
) -> Result<(EintreffenZeitachse, zeitachse_repo::Beruehrt), AppError> {
    let (ergebnis, beruehrt) = zeitachse_repo::schreibe_tx(
        &mut *conn,
        r.einsatz_id,
        r.benutzer_id,
        Kraft::Einheit(einheit_id),
        Neu {
            art: ZeitachseArt::Eintreffen,
            zeitpunkt_at: r.zeitpunkt_at,
            quelle: ZeitachseQuelle::Bereitstellungsraum,
            notiz: None,
        },
    )
    .await?;
    Ok(match ergebnis {
        Schreibergebnis::Geschrieben(_) => (EintreffenZeitachse::Geschrieben, beruehrt),
        Schreibergebnis::Ausgelassen(_) => (
            EintreffenZeitachse::Ausgelassen,
            zeitachse_repo::Beruehrt::default(),
        ),
    })
}

async fn aktive_fahrzeuge_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM einsatz_fahrzeug \
         WHERE einsatz_id = ? AND einheit_id = ? AND beendet_at IS NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Was [`eintritt_einheit_tx`] für eine Einheit gebucht hat: die Belegungszeile, die Wirkung in
/// der Zeitachse und, was nach dem Commit gemeldet wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Eintritt {
    pub belegung_id: i64,
    pub zeitachse: EintreffenZeitachse,
    /// Personen aus dem Fan-out des Eintreffens (für `sse_personal`).
    pub personen: Vec<i64>,
    /// ETB-Einträge der Kopplung an die Ablösung (LLH-1128), siehe [`Gebucht::abloesung`].
    pub abloesung: Vec<i64>,
    /// Hinweise zur ablösenden Einheit (LLH-1131), siehe [`Gebucht::hinweise`].
    pub hinweise: Vec<crate::benachrichtigung::Anlass>,
}

/// Eintritt einer schon geführten Einheit in den Raum `r.br_id` OHNE ETB-Eintrag (LLH-1383,
/// design.md D5): Belegung (`belege_tx` prüft fremd 404, aufgelöst 409, schon in einem Raum 409),
/// Eintreffen in der Zeitachse (Quelle `bereitstellungsraum`; `Ausgelassen` ist kein Fehler) und
/// die Hinweise zur ablösenden Einheit. Das Eintreffen am Raum ([`eintreffen_tx`]) und die
/// Übernahme aus einer Nachforderung (`einheit::aus_nachforderung`) teilen ihn; jeder Aufrufer
/// schreibt seinen einen ETB-Satz selbst.
pub async fn eintritt_einheit_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    einheit_id: i64,
) -> Result<Eintritt, AppError> {
    let belegung_id = belegung_repo::belege_tx(
        &mut *conn,
        r.einsatz_id,
        r.br_id,
        ObjektTyp::Einheit,
        einheit_id,
        &buchung(r),
        r.benutzer_id,
    )
    .await?
    .ereignis;
    let (zeitachse, beruehrt) = eintreffen_zeitachse_tx(conn, r, einheit_id).await?;
    // Ist die Einheit als ablösende geplant, ist ihr Eintreffen am Raum ein Hinweis (LLH-1131),
    // auch wenn die Zeitachse es auslässt, weil die Einheit schon eingetroffen war.
    let mut hinweise = beruehrt.hinweise;
    hinweise.extend(
        crate::abloesung::hinweis::anlaesse_tx(
            conn,
            r.einsatz_id,
            einheit_id,
            crate::benachrichtigung::BenachrichtigungBezugTyp::AbloeserBrEingetroffen,
            r.benutzer_id,
        )
        .await?,
    );
    Ok(Eintritt {
        belegung_id,
        zeitachse,
        personen: beruehrt.personen,
        abloesung: beruehrt.abloesung,
        hinweise,
    })
}

async fn bekannt_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    br_bezeichnung: &str,
    typ: ObjektTyp,
    objekt_id: i64,
    herkunft: Option<&Herkunft>,
) -> Result<Gebucht, AppError> {
    // 2./3. Kraft prüfen (fremd 404, beendet 409, Fahrzeug einer Einheit 409, schon in einem
    // Raum 409) und Eintritt: `belege_tx` prüft genau das; bei einer Einheit samt Zeitachse (4.)
    // über `eintritt_einheit_tx`.
    let (belegung_id, einheit_id, fahrzeug_ids, zeitachse, personen, abloesung, hinweise, name) =
        match typ {
            ObjektTyp::Einheit => {
                let e = eintritt_einheit_tx(conn, r, objekt_id).await?;
                if let Some(h) = herkunft {
                    verknuepfe_tx(conn, r, h, objekt_id).await?;
                }
                let name: String = sqlx::query_scalar(
                    "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
                )
                .bind(objekt_id)
                .bind(r.einsatz_id)
                .fetch_one(&mut *conn)
                .await?;
                let fahrzeuge = aktive_fahrzeuge_tx(conn, r.einsatz_id, objekt_id).await?;
                (
                    e.belegung_id,
                    Some(objekt_id),
                    fahrzeuge,
                    e.zeitachse,
                    e.personen,
                    e.abloesung,
                    e.hinweise,
                    name,
                )
            }
            ObjektTyp::Fahrzeug => {
                let belegung_id = belegung_repo::belege_tx(
                    &mut *conn,
                    r.einsatz_id,
                    r.br_id,
                    typ,
                    objekt_id,
                    &buchung(r),
                    r.benutzer_id,
                )
                .await?
                .ereignis;
                let name: String = sqlx::query_scalar(
                    "SELECT snap_funkrufname FROM einsatz_fahrzeug \
                     WHERE id = ? AND einsatz_id = ?",
                )
                .bind(objekt_id)
                .bind(r.einsatz_id)
                .fetch_one(&mut *conn)
                .await?;
                (
                    belegung_id,
                    None,
                    vec![objekt_id],
                    EintreffenZeitachse::Keine,
                    Vec::new(),
                    Vec::new(),
                    Vec::new(),
                    name,
                )
            }
        };
    // 6. Genau ein ETB-Eintrag (D5): „eingetroffen“ nur, wenn die Zeitachse es trägt.
    let text = match zeitachse {
        EintreffenZeitachse::Geschrieben => super::etb_text_eingetroffen(&name, br_bezeichnung),
        _ => super::etb_text_eintritt(&name, br_bezeichnung),
    };
    // Mit Nachforderung (LLH-1387 D4) der Satz mit ihrem Kurznamen und Verweis auf sie.
    let etb_id = match herkunft {
        Some(h) => {
            crate::nachforderung::repo::protokollieren_tx(
                conn,
                h.id,
                r.benutzer_id,
                &format!("Nachforderung {}: {text}", h.kurz),
            )
            .await?
        }
        None => {
            crate::etb::system_audit_tx(
                &mut *conn,
                r.einsatz_id,
                r.benutzer_id,
                r.etb_startwert,
                &text,
            )
            .await?
        }
    };
    Ok(Gebucht {
        belegung_id,
        objekt_typ: typ,
        objekt_id,
        einheit_id,
        fahrzeug_ids,
        zeitachse,
        meldung_id: None,
        etb_id,
        personen,
        abloesung,
        hinweise,
        nachforderung_id: herkunft.filter(|_| typ == ObjektTyp::Einheit).map(|h| h.id),
    })
}

/// Doppelbuchung (D9): eine aktive Einheit (Name, Funkrufname) oder ein aktives Fahrzeug des
/// Einsatzes mit demselben Funkrufnamen wie eines der neuen Fahrzeuge → 422 mit Namen.
async fn check_doppelbuchung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    fahrzeuge: &[NeuesFahrzeug],
) -> Result<(), AppError> {
    let namen: Vec<&str> = fahrzeuge.iter().map(|f| f.funkrufname.as_str()).collect();
    check_namen_frei_tx(conn, einsatz_id, &namen).await
}

/// Doppelbuchung über Namen (D9, auch für die Übernahme aus einer Nachforderung, LLH-1383
/// design.md D3): ein Name, der nach [`normalize`] dem Namen oder Funkrufnamen einer aktiven
/// Einheit oder dem Funkrufnamen eines aktiven Fahrzeugs des Einsatzes gleicht → 422 mit Namen.
pub async fn check_namen_frei_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    namen: &[&str],
) -> Result<(), AppError> {
    let bestand: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT 'Einheit', name, funkrufname FROM einsatz_einheit \
         WHERE einsatz_id = ?1 AND aufgeloest_at IS NULL \
         UNION ALL \
         SELECT 'Fahrzeug', coalesce(f.funkrufname, ef.snap_funkrufname, ''), NULL \
         FROM einsatz_fahrzeug ef LEFT JOIN fahrzeug f ON f.id = ef.fahrzeug_id \
         WHERE ef.einsatz_id = ?1 AND ef.beendet_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    for neu in namen {
        let schluessel = normalize(neu);
        for (art, name, funkrufname) in &bestand {
            let trifft = normalize(name) == schluessel
                || funkrufname
                    .as_deref()
                    .is_some_and(|f| normalize(f) == schluessel);
            if trifft {
                return Err(AppError::UnprocessableEntity(format!(
                    "{neu} ist schon im Einsatz ({art} «{name}»)"
                )));
            }
        }
    }
    Ok(())
}

async fn unangemeldet_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    br: &super::BrAnzeige,
    u: &Unangemeldet,
    herkunft: Option<&Herkunft>,
) -> Result<Gebucht, AppError> {
    let erstes = u
        .fahrzeuge
        .first()
        .ok_or_else(|| AppError::Validation("Funkrufname darf nicht leer sein".into()))?;
    // 2. Doppelbuchung, dann Einheit mit Ad-hoc-Fahrzeugen.
    if !u.trotzdem_anlegen {
        check_doppelbuchung_tx(&mut *conn, r.einsatz_id, &u.fahrzeuge).await?;
    }
    let einheit_id = crate::einheit::repo::anlegen_tx(
        &mut *conn,
        r.einsatz_id,
        r.org_id,
        &crate::einheit::repo::EinheitDaten {
            name: &erstes.funkrufname,
            abschnitt_id: None,
            ueber_einheit_id: None,
            typ_id: None,
            // D6: die gemeldete Stärke ist keine Soll-Stärke.
            soll_fuehrer: None,
            soll_unterfuehrer: None,
            soll_mannschaft: None,
            bemerkung: u.bemerkung.as_deref(),
            funkrufname: Some(&erstes.funkrufname),
            sortier: 0,
            tz_fachaufgabe: None,
            tz_organisation: None,
        },
        r.benutzer_id,
    )
    .await?;
    let mut fahrzeug_ids = Vec::with_capacity(u.fahrzeuge.len());
    for f in &u.fahrzeuge {
        fahrzeug_ids.push(
            crate::fahrzeug::disposition_repo::disponiere_adhoc_tx(
                &mut *conn,
                r.einsatz_id,
                r.org_id,
                crate::fahrzeug::disposition_repo::AdhocDaten {
                    funkrufname: &f.funkrufname,
                    fahrzeugtyp: f.fahrzeugtyp.as_deref(),
                    kennzeichen: None,
                    opta: None,
                    traegerorganisation: f.organisation.as_deref(),
                },
                r.benutzer_id,
            )
            .await?,
        );
    }
    crate::einheit::mitglied_repo::zuordnen_fahrzeug_menge_tx(
        &mut *conn,
        r.einsatz_id,
        einheit_id,
        &fahrzeug_ids,
    )
    .await?;
    if let Some(h) = herkunft {
        verknuepfe_tx(conn, r, h, einheit_id).await?;
    }

    // 3. Eintritt, 4. Eintreffen (eine neue Einheit hat keine Personen, also keinen Fan-out).
    let belegung_id = belegung_repo::belege_tx(
        &mut *conn,
        r.einsatz_id,
        r.br_id,
        ObjektTyp::Einheit,
        einheit_id,
        &buchung(r),
        r.benutzer_id,
    )
    .await?
    .ereignis;
    let (zeitachse, beruehrt) = eintreffen_zeitachse_tx(conn, r, einheit_id).await?;

    // 5. Meldung an die Einsatzleitung (D5).
    let abschnitt: Option<String> = match br.abschnitt_id {
        Some(id) => {
            sqlx::query_scalar("SELECT name FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
                .bind(id)
                .bind(r.einsatz_id)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    let angaben: Vec<FahrzeugAngabe<'_>> = u
        .fahrzeuge
        .iter()
        .map(|f| FahrzeugAngabe {
            funkrufname: &f.funkrufname,
            fahrzeugtyp: f.fahrzeugtyp.as_deref(),
            organisation: f.organisation.as_deref(),
        })
        .collect();
    let inhalt = super::meldung_text_unangemeldet(&UnangemeldetAngabe {
        fahrzeuge: &angaben,
        staerke: u.staerke,
        br_bezeichnung: &br.bezeichnung,
        abschnitt: abschnitt.as_deref(),
        nachforderung: herkunft.map(|h| h.kurz.as_str()),
    });
    let absender = super::absender_text(&angaben);
    let einst = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, r.einsatz_id).await?;
    let org_einst = crate::org::einstellungen::laden_oder_default(&mut *conn, r.org_id).await?;
    let frist_min = crate::meldung::meldung_bestaetigung_frist_min_ableiten(
        &einst,
        &org_einst,
        None,
        crate::meldung::BESTAETIGUNG_FRIST_DEFAULT_MIN,
    );
    let frist_at = crate::zeit::plus_minuten(r.eingang_at, frist_min);
    let meldung_id = crate::meldung::repo::anlegen_tx(
        &mut *conn,
        r.einsatz_id,
        r.benutzer_id,
        &crate::meldung::repo::MeldungDaten {
            absender: &absender,
            empfaenger: Some("Einsatzleitung"),
            empfaenger_funktion: Some(crate::fuehrung::Fuehrungsfunktion::El),
            meldeweg: crate::meldung::MeldeWeg::Persoenlich.as_str(),
            inhalt: &inhalt,
            meldungsart: crate::meldung::ART_LAGEMELDUNG,
            prioritaet: crate::meldung::PRIO_NORMAL,
            richtung: crate::meldung::RICHTUNG_INTERN,
            ereigniszeit: r.zeitpunkt_at,
            eingang_at: r.eingang_at,
            bestaetigung_pflicht: true,
            bestaetigung_frist_at: frist_at.as_deref(),
            einheit_id: Some(einheit_id),
            abschnitt_id: None,
            geo: None,
        },
    )
    .await?;
    // Kennzeichen „nicht übernommen“ (D3): seit dem Erfassungszeitpunkt, mit der Meldung.
    sqlx::query(
        "UPDATE einsatz_einheit SET uebernahme_offen_seit = ?, uebernahme_meldung_id = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(r.zeitpunkt_at)
    .bind(meldung_id)
    .bind(einheit_id)
    .bind(r.einsatz_id)
    .execute(&mut *conn)
    .await?;

    // 6. Genau ein ETB-Eintrag (D5): bei Auto-ETB der Eintrag der Meldung (entschieden nach
    // `etb_meldung_id` derselben Transaktion), sonst ein Systemeintrag mit ihrem Inhalt.
    let etb_meldung: Option<i64> =
        sqlx::query_scalar("SELECT etb_meldung_id FROM meldung WHERE id = ?")
            .bind(meldung_id)
            .fetch_one(&mut *conn)
            .await?;
    let etb_id = match etb_meldung {
        Some(id) => id,
        None => {
            crate::etb::system_audit_tx(
                &mut *conn,
                r.einsatz_id,
                r.benutzer_id,
                r.etb_startwert,
                &inhalt,
            )
            .await?
        }
    };
    // Der eine Eintrag verweist auf die Nachforderung (LLH-1387 D4).
    if let Some(h) = herkunft {
        sqlx::query("UPDATE etb_eintrag SET nachforderung_id = ? WHERE id = ?")
            .bind(h.id)
            .bind(etb_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(Gebucht {
        belegung_id,
        objekt_typ: ObjektTyp::Einheit,
        objekt_id: einheit_id,
        einheit_id: Some(einheit_id),
        fahrzeug_ids,
        zeitachse,
        meldung_id: Some(meldung_id),
        etb_id,
        personen: beruehrt.personen,
        abloesung: beruehrt.abloesung,
        hinweise: beruehrt.hinweise,
        nachforderung_id: herkunft.map(|h| h.id),
    })
}

// ─── Lesen ──────────────────────────────────────────────────────────────────

impl Gebucht {
    /// Antwort aus dem eben Geschriebenen.
    pub async fn ergebnis(
        &self,
        pool: &SqlitePool,
        einsatz_id: i64,
        unangemeldet: bool,
    ) -> Result<EintreffenErgebnis, AppError> {
        Ok(EintreffenErgebnis {
            belegung: belegung_repo::laden(pool, einsatz_id, self.belegung_id).await?,
            einheit_id: self.einheit_id,
            fahrzeug_ids: self.fahrzeug_ids.clone(),
            zeitachse: self.zeitachse,
            meldung_id: self.meldung_id,
            unangemeldet,
        })
    }
}

/// Rekonstruiert das Ergebnis einer schon gebuchten Belegungszeile (Replay, D8). `unangemeldet`,
/// wenn die Zeile der erste Eintritt einer unangemeldet erfassten Einheit ist; `zeitachse`
/// `geschrieben`, wenn die Einheit ein nicht gestrichenes Eintreffen mit Quelle
/// `bereitstellungsraum` zum Zeitpunkt der Zeile trägt; `fahrzeug_ids` ist der heutige Stand.
pub async fn reconstruct(
    pool: &SqlitePool,
    belegung: BrBelegungAnzeige,
) -> Result<EintreffenErgebnis, AppError> {
    let einsatz_id = belegung.einsatz_id;
    match belegung.objekt_typ {
        ObjektTyp::Fahrzeug => Ok(EintreffenErgebnis {
            einheit_id: None,
            fahrzeug_ids: vec![belegung.objekt_id],
            zeitachse: EintreffenZeitachse::Keine,
            meldung_id: None,
            unangemeldet: false,
            belegung,
        }),
        ObjektTyp::Einheit => {
            let einheit_id = belegung.objekt_id;
            let (offen_seit, meldung_id, erste_belegung): (Option<String>, Option<i64>, i64) =
                sqlx::query_as(
                    "SELECT e.uebernahme_offen_seit, e.uebernahme_meldung_id, \
                            (SELECT MIN(b.id) FROM br_belegung b \
                             WHERE b.objekt_typ = 'einheit' AND b.objekt_id = e.id \
                               AND b.einsatz_id = e.einsatz_id) \
                     FROM einsatz_einheit e WHERE e.id = ? AND e.einsatz_id = ?",
                )
                .bind(einheit_id)
                .bind(einsatz_id)
                .fetch_one(pool)
                .await?;
            let unangemeldet = offen_seit.is_some() && erste_belegung == belegung.id;
            let geschrieben: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM einsatz_kraft_zeitachse \
                 WHERE einsatz_id = ? AND einheit_id = ? AND art = 'eintreffen' \
                   AND quelle = 'bereitstellungsraum' AND gestrichen_at IS NULL \
                   AND zeitpunkt_at = ?)",
            )
            .bind(einsatz_id)
            .bind(einheit_id)
            .bind(&belegung.zeitpunkt_at)
            .fetch_one(pool)
            .await?;
            let mut conn = pool.acquire().await?;
            let fahrzeug_ids = aktive_fahrzeuge_tx(&mut conn, einsatz_id, einheit_id).await?;
            Ok(EintreffenErgebnis {
                einheit_id: Some(einheit_id),
                fahrzeug_ids,
                zeitachse: if geschrieben {
                    EintreffenZeitachse::Geschrieben
                } else {
                    EintreffenZeitachse::Ausgelassen
                },
                meldung_id: unangemeldet.then_some(meldung_id).flatten(),
                unangemeldet,
                belegung,
            })
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bereitstellungsraum::repo as br_repo;
    use crate::db::test_pool;

    const ZEIT: &str = "2026-05-28 14:30:00";
    const EINGANG: &str = "2026-05-28 14:31:00";

    /// Org(1) + Benutzer + aktiver Einsatz; liefert (benutzer, einsatz).
    async fn basis(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let e = einsatz(pool, "Lage").await;
        (b, e)
    }

    async fn einsatz(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, \
                angelegt_at) \
             VALUES (1, ?, 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
        )
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn abschnitt(pool: &SqlitePool, e: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id",
        )
        .bind(e)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn br(pool: &SqlitePool, e: i64, b: i64, bez: &str, abschnitt_id: Option<i64>) -> i64 {
        let br = br_repo::create(
            pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: bez,
                abschnitt_id,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
            },
        )
        .await
        .unwrap();
        br_repo::setze_status(pool, e, br.id, "aktiv", b)
            .await
            .unwrap();
        br.id
    }

    async fn einheit(pool: &SqlitePool, e: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
        )
        .bind(e)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn fahrzeug(
        pool: &SqlitePool,
        e: i64,
        funkrufname: &str,
        einheit_id: Option<i64>,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(funkrufname)
        .bind(einheit_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn rahmen(e: i64, br_id: i64, b: i64) -> Rahmen<'static> {
        Rahmen {
            einsatz_id: e,
            org_id: 1,
            br_id,
            benutzer_id: b,
            zeitpunkt_at: ZEIT,
            eingang_at: EINGANG,
            client_id: None,
            etb_startwert: 1,
        }
    }

    async fn buche(
        pool: &SqlitePool,
        r: &Rahmen<'_>,
        erfassung: &Erfassung,
    ) -> Result<Gebucht, AppError> {
        let mut tx = pool.begin().await.unwrap();
        let g = eintreffen_tx(&mut tx, r, erfassung, None).await;
        if g.is_ok() {
            tx.commit().await.unwrap();
        }
        g
    }

    fn bekannt(typ: ObjektTyp, objekt_id: i64) -> Erfassung {
        Erfassung::Bekannt { typ, objekt_id }
    }

    fn fz(funkrufname: &str) -> FahrzeugEingabe {
        FahrzeugEingabe {
            funkrufname: funkrufname.into(),
            ..Default::default()
        }
    }

    fn unangemeldet(fahrzeuge: Vec<FahrzeugEingabe>) -> UnangemeldetEingabe {
        UnangemeldetEingabe {
            fahrzeuge,
            ..Default::default()
        }
    }

    fn checked(u: UnangemeldetEingabe) -> Erfassung {
        check(&EintreffenEingabe {
            unangemeldet: Some(u),
            ..Default::default()
        })
        .unwrap()
    }

    /// (Belegungen, Zeitachsen-Ereignisse, ETB-Einträge, Einheiten, Fahrzeuge, Meldungen)
    async fn count_rows(pool: &SqlitePool, e: i64) -> [i64; 6] {
        let mut z = [0; 6];
        for (i, t) in [
            "br_belegung",
            "einsatz_kraft_zeitachse",
            "etb_eintrag",
            "einsatz_einheit",
            "einsatz_fahrzeug",
            "meldung",
        ]
        .iter()
        .enumerate()
        {
            z[i] = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {t} WHERE einsatz_id = ?"
            )))
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap();
        }
        z
    }

    async fn etb_texte(pool: &SqlitePool, e: i64) -> Vec<String> {
        sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
            .bind(e)
            .fetch_all(pool)
            .await
            .unwrap()
    }

    async fn auto_etb_aus(pool: &SqlitePool, e: i64) {
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, auto_etb_eintraege) VALUES (?, 0) \
             ON CONFLICT(einsatz_id) DO UPDATE SET auto_etb_eintraege = 0",
        )
        .bind(e)
        .execute(pool)
        .await
        .unwrap();
    }

    // ─── Prüfung (400/422), schreibt nichts ─────────────────────────────────

    #[test]
    fn check_weder_noch_400_beides_422() {
        let r = check(&EintreffenEingabe::default());
        assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");
        let r = check(&EintreffenEingabe {
            kraft: Some(KraftAngabe {
                objekt_typ: "einheit".into(),
                objekt_id: 1,
            }),
            unangemeldet: Some(unangemeldet(vec![fz("FL 1")])),
            ..Default::default()
        });
        assert!(matches!(r, Err(AppError::UnprocessableEntity(_))), "{r:?}");
        let r = check(&EintreffenEingabe {
            kraft: Some(KraftAngabe {
                objekt_typ: "person".into(),
                objekt_id: 1,
            }),
            ..Default::default()
        });
        assert!(matches!(r, Err(AppError::Validation(_))), "{r:?}");
    }

    #[test]
    fn check_grenzen_400() {
        let lang = "x".repeat(201);
        let faelle: Vec<UnangemeldetEingabe> = vec![
            unangemeldet(vec![]),
            unangemeldet(vec![fz("  ")]),
            unangemeldet(vec![fz(&lang)]),
            unangemeldet(vec![FahrzeugEingabe {
                fahrzeugtyp: Some(lang.clone()),
                ..fz("FL 1")
            }]),
            unangemeldet(vec![FahrzeugEingabe {
                traegerorganisation: Some(lang.clone()),
                ..fz("FL 1")
            }]),
            UnangemeldetEingabe {
                bemerkung: Some("x".repeat(crate::einheit::BEMERKUNG_MAX + 1)),
                ..unangemeldet(vec![fz("FL 1")])
            },
            UnangemeldetEingabe {
                staerke: Some(StaerkeEingabe {
                    fuehrer: Some(1),
                    unterfuehrer: Some(1),
                    mannschaft: None,
                }),
                ..unangemeldet(vec![fz("FL 1")])
            },
            UnangemeldetEingabe {
                staerke: Some(StaerkeEingabe {
                    fuehrer: Some(-1),
                    unterfuehrer: Some(1),
                    mannschaft: Some(1),
                }),
                ..unangemeldet(vec![fz("FL 1")])
            },
            // Vor dem Entdoppeln gezählt: 51 gleiche Fahrzeuge sind zu viele.
            unangemeldet(
                (0..=crate::kraefte_disposition::SAMMEL_MAX)
                    .map(|_| fz("FL 1"))
                    .collect(),
            ),
        ];
        for (i, u) in faelle.into_iter().enumerate() {
            let r = check(&EintreffenEingabe {
                unangemeldet: Some(u),
                ..Default::default()
            });
            assert!(matches!(r, Err(AppError::Validation(_))), "Fall {i}: {r:?}");
        }
        // Genau an der Grenze gelingt es, und gleiche Funkrufnamen werden eins.
        let Erfassung::Unangemeldet(u) = checked(UnangemeldetEingabe {
            bemerkung: Some("x".repeat(crate::einheit::BEMERKUNG_MAX)),
            ..unangemeldet(vec![fz(&"y".repeat(200)), fz("FL 2"), fz(" fl  2 ")])
        }) else {
            unreachable!()
        };
        assert_eq!(u.fahrzeuge.len(), 2);
    }

    #[test]
    fn normalisiert_unicode_und_leerzeichen() {
        assert_eq!(normalize("  Müller  1 "), normalize("MÜLLER 1"));
        assert_ne!(normalize("Müller 1"), normalize("Müller 11"));
    }

    // ─── Bekannte Kraft ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn einheit_eintritt_und_eintreffen() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let ei = einheit(&pool, e, "HLF 20 FF Musterstadt").await;
        let f = fahrzeug(&pool, e, "FL-MUS 1-44-1", Some(ei)).await;

        let g = buche(&pool, &rahmen(e, raum, b), &bekannt(ObjektTyp::Einheit, ei))
            .await
            .unwrap();
        assert_eq!(g.zeitachse, EintreffenZeitachse::Geschrieben);
        assert_eq!(g.einheit_id, Some(ei));
        assert_eq!(g.fahrzeug_ids, vec![f]);
        assert_eq!(g.meldung_id, None);
        let (cache,): (Option<i64>,) =
            sqlx::query_as("SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ?")
                .bind(ei)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cache, Some(raum));
        let (at, quelle): (String, String) = sqlx::query_as(
            "SELECT zeitpunkt_at, quelle FROM einsatz_kraft_zeitachse \
             WHERE einheit_id = ? AND art = 'eintreffen'",
        )
        .bind(ei)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (at.as_str(), quelle.as_str()),
            (ZEIT, "bereitstellungsraum")
        );
        let belegung_at: String =
            sqlx::query_scalar("SELECT zeitpunkt_at FROM br_belegung WHERE id = ?")
                .bind(g.belegung_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(belegung_at, ZEIT);
        assert_eq!(
            etb_texte(&pool, e).await,
            vec!["HLF 20 FF Musterstadt im BR Sportplatz eingetroffen".to_string()]
        );
        let erg = reconstruct(
            &pool,
            belegung_repo::laden(&pool, e, g.belegung_id).await.unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(erg.zeitachse, EintreffenZeitachse::Geschrieben);
        assert!(!erg.unangemeldet);
        assert_eq!(erg.fahrzeug_ids, vec![f]);
    }

    #[tokio::test]
    async fn offene_periode_mit_eintreffen_ausgelassen_eintritt_gelingt() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let ei = einheit(&pool, e, "HLF 20").await;
        let mut tx = pool.begin().await.unwrap();
        zeitachse_repo::schreibe_tx(
            &mut tx,
            e,
            b,
            Kraft::Einheit(ei),
            Neu {
                art: ZeitachseArt::Eintreffen,
                zeitpunkt_at: "2026-05-28 14:00:00",
                quelle: ZeitachseQuelle::Nachtrag,
                notiz: None,
            },
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let vorher = count_rows(&pool, e).await;

        let g = buche(&pool, &rahmen(e, raum, b), &bekannt(ObjektTyp::Einheit, ei))
            .await
            .unwrap();
        assert_eq!(g.zeitachse, EintreffenZeitachse::Ausgelassen);
        let nachher = count_rows(&pool, e).await;
        assert_eq!(nachher[0], vorher[0] + 1, "Eintritt gebucht");
        assert_eq!(nachher[1], vorher[1], "kein zweites Eintreffen");
        assert_eq!(
            etb_texte(&pool, e).await.last().unwrap(),
            "HLF 20 tritt in Bereitstellungsraum Sportplatz ein"
        );
        let erg = reconstruct(
            &pool,
            belegung_repo::laden(&pool, e, g.belegung_id).await.unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(erg.zeitachse, EintreffenZeitachse::Ausgelassen);
    }

    #[tokio::test]
    async fn fahrzeug_ohne_ereignis() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let f = fahrzeug(&pool, e, "Florian 1", None).await;
        let g = buche(&pool, &rahmen(e, raum, b), &bekannt(ObjektTyp::Fahrzeug, f))
            .await
            .unwrap();
        assert_eq!(g.zeitachse, EintreffenZeitachse::Keine);
        assert_eq!(g.einheit_id, None);
        assert_eq!(g.fahrzeug_ids, vec![f]);
        let z = count_rows(&pool, e).await;
        assert_eq!((z[0], z[1], z[2]), (1, 0, 1));
        assert_eq!(
            etb_texte(&pool, e).await,
            vec!["Florian 1 tritt in Bereitstellungsraum Sportplatz ein".to_string()]
        );
    }

    #[tokio::test]
    async fn bekannte_kraft_abgelehnt_schreibt_nichts() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let fremd = einsatz(&pool, "Andere Lage").await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let schule = br(&pool, e, b, "Schule", None).await;
        let ei = einheit(&pool, e, "1. Zug").await;
        let mit_einheit = fahrzeug(&pool, e, "Florian 2", Some(ei)).await;
        let im_br = einheit(&pool, e, "2. Zug").await;
        buche(
            &pool,
            &rahmen(e, schule, b),
            &bekannt(ObjektTyp::Einheit, im_br),
        )
        .await
        .unwrap();
        let aufgeloest = einheit(&pool, e, "3. Zug").await;
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-05-28 10:00:00' WHERE id = ?",
        )
        .bind(aufgeloest)
        .execute(&pool)
        .await
        .unwrap();
        let fremde_einheit = einheit(&pool, fremd, "Fremd").await;
        let vorher = count_rows(&pool, e).await;

        let r = rahmen(e, raum, b);
        for (erfassung, conflict) in [
            (bekannt(ObjektTyp::Fahrzeug, mit_einheit), true),
            (bekannt(ObjektTyp::Einheit, im_br), true),
            (bekannt(ObjektTyp::Einheit, aufgeloest), true),
            (bekannt(ObjektTyp::Einheit, fremde_einheit), false),
        ] {
            let g = buche(&pool, &r, &erfassung).await;
            if conflict {
                assert!(
                    matches!(g, Err(AppError::Conflict(_))),
                    "{erfassung:?}: {g:?}"
                );
            } else {
                assert!(matches!(g, Err(AppError::NotFound)), "{erfassung:?}: {g:?}");
            }
        }
        assert_eq!(count_rows(&pool, e).await, vorher);
    }

    #[tokio::test]
    async fn raum_geplant_oder_storniert_422() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let geplant = br_repo::create(
            &pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: "Geplant",
                abschnitt_id: None,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
            },
        )
        .await
        .unwrap()
        .id;
        let storniert = br(&pool, e, b, "Storniert", None).await;
        br_repo::storniere(&pool, e, storniert, b).await.unwrap();
        let vorher = count_rows(&pool, e).await;
        for raum in [geplant, storniert] {
            let g = buche(
                &pool,
                &rahmen(e, raum, b),
                &checked(unangemeldet(vec![fz("FL 1")])),
            )
            .await;
            assert!(matches!(g, Err(AppError::UnprocessableEntity(_))), "{g:?}");
        }
        assert_eq!(count_rows(&pool, e).await, vorher);
    }

    // ─── Unangemeldet ───────────────────────────────────────────────────────

    #[tokio::test]
    #[allow(clippy::type_complexity)]
    async fn unangemeldet_eine_einheit_ein_fahrzeug_meldung() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let nord = abschnitt(&pool, e, "Nord").await;
        let raum = br(&pool, e, b, "Sportplatz", Some(nord)).await;
        let vorher = count_rows(&pool, e).await;

        let erfassung = checked(UnangemeldetEingabe {
            staerke: Some(StaerkeEingabe {
                fuehrer: Some(1),
                unterfuehrer: Some(1),
                mannschaft: Some(7),
            }),
            bemerkung: Some("Geheime Bemerkung".into()),
            ..unangemeldet(vec![FahrzeugEingabe {
                funkrufname: "FL-MUS 1-44-1".into(),
                fahrzeugtyp: Some("HLF 20".into()),
                traegerorganisation: Some("FF Musterstadt".into()),
            }])
        });
        let g = buche(&pool, &rahmen(e, raum, b), &erfassung).await.unwrap();
        let nachher = count_rows(&pool, e).await;
        // Belegung, Ereignis, ETB, Einheit, Fahrzeug, Meldung: je genau eins (Auto-ETB an).
        let diff: Vec<i64> = nachher.iter().zip(vorher).map(|(n, v)| n - v).collect();
        assert_eq!(diff, vec![1, 1, 1, 1, 1, 1]);
        assert_eq!(g.zeitachse, EintreffenZeitachse::Geschrieben);
        let ei = g.einheit_id.unwrap();
        assert_eq!(g.fahrzeug_ids.len(), 1);

        let (name, funkrufname, sf, su, sm, bemerkung, offen, meldung_ref, abschnitt_id): (
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT name, funkrufname, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, \
                    bemerkung, uebernahme_offen_seit, uebernahme_meldung_id, abschnitt_id \
             FROM einsatz_einheit WHERE id = ?",
        )
        .bind(ei)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(name, "FL-MUS 1-44-1");
        assert_eq!(funkrufname.as_deref(), Some("FL-MUS 1-44-1"));
        assert_eq!(
            (sf, su, sm),
            (None, None, None),
            "Stärke ist keine Soll-Stärke"
        );
        assert_eq!(bemerkung.as_deref(), Some("Geheime Bemerkung"));
        assert_eq!(offen.as_deref(), Some(ZEIT), "Kennzeichen seit Erfassung");
        assert_eq!(meldung_ref, g.meldung_id);
        assert_eq!(abschnitt_id, None);

        let (fz_einheit, fz_typ, fz_org): (Option<i64>, Option<String>, Option<String>) =
            sqlx::query_as(
                "SELECT einheit_id, snap_fahrzeugtyp, snap_traegerorganisation \
                 FROM einsatz_fahrzeug WHERE id = ?",
            )
            .bind(g.fahrzeug_ids[0])
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fz_einheit, Some(ei));
        assert_eq!(fz_typ.as_deref(), Some("HLF 20"));
        assert_eq!(fz_org.as_deref(), Some("FF Musterstadt"));

        let m: (
            String,
            Option<String>,
            String,
            String,
            String,
            i64,
            Option<i64>,
            Option<i64>,
            String,
            String,
            Option<String>,
            Option<i64>,
        ) = sqlx::query_as(
            "SELECT absender, empfaenger_funktion, meldungsart, prioritaet, inhalt, \
                        bestaetigung_pflicht, einheit_id, abschnitt_id, ereigniszeit, eingang_at, \
                        bestaetigung_frist_at, etb_meldung_id \
                 FROM meldung WHERE id = ?",
        )
        .bind(g.meldung_id.unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(m.0, "FL-MUS 1-44-1");
        assert_eq!(m.1.as_deref(), Some("el"));
        assert_eq!(m.2, "lagemeldung");
        assert_eq!(m.3, "normal");
        assert_eq!(
            m.4,
            "FL-MUS 1-44-1 (FF Musterstadt, HLF 20) unangemeldet im BR Sportplatz eingetroffen, \
             Stärke 1/1/7//9. Abschnitt Nord. Übernahme offen."
        );
        assert_eq!(m.5, 1);
        assert_eq!((m.6, m.7), (Some(ei), None));
        assert_eq!((m.8.as_str(), m.9.as_str()), (ZEIT, EINGANG));
        assert_eq!(m.10.as_deref(), Some("2026-05-28 14:36:00"));
        assert_eq!(
            m.11,
            Some(g.etb_id),
            "der eine ETB-Eintrag ist der der Meldung"
        );
        for t in etb_texte(&pool, e).await {
            assert!(!t.contains("Geheime"), "Bemerkung nie im ETB: {t}");
        }
        assert!(!m.4.contains("Geheime"));

        let erg = reconstruct(
            &pool,
            belegung_repo::laden(&pool, e, g.belegung_id).await.unwrap(),
        )
        .await
        .unwrap();
        assert!(erg.unangemeldet);
        assert_eq!(erg.meldung_id, g.meldung_id);
        assert_eq!(erg.einheit_id, Some(ei));
        assert_eq!(erg.fahrzeug_ids, g.fahrzeug_ids);
        assert_eq!(erg.zeitachse, EintreffenZeitachse::Geschrieben);
    }

    #[tokio::test]
    async fn unangemeldet_ohne_auto_etb_ein_systemeintrag() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        auto_etb_aus(&pool, e).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("FL 1")])),
        )
        .await
        .unwrap();
        let texte = etb_texte(&pool, e).await;
        assert_eq!(
            texte,
            vec!["FL 1 unangemeldet im BR Sportplatz eingetroffen. Übernahme offen.".to_string()]
        );
        let etb_meldung: Option<i64> =
            sqlx::query_scalar("SELECT etb_meldung_id FROM meldung WHERE id = ?")
                .bind(g.meldung_id.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(etb_meldung, None);
    }

    #[tokio::test]
    async fn zwei_fahrzeuge_eine_belegung() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("FL-MUS 1-44-1"), fz("FL-MUS 1-19-1")])),
        )
        .await
        .unwrap();
        assert_eq!(g.fahrzeug_ids.len(), 2);
        let z = count_rows(&pool, e).await;
        assert_eq!((z[0], z[3], z[4]), (1, 1, 2));
        let einheiten: Vec<Option<i64>> =
            sqlx::query_scalar("SELECT einheit_id FROM einsatz_fahrzeug WHERE einsatz_id = ?")
                .bind(e)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(einheiten, vec![g.einheit_id, g.einheit_id]);
        let objekt: (String, i64) =
            sqlx::query_as("SELECT objekt_typ, objekt_id FROM br_belegung WHERE einsatz_id = ?")
                .bind(e)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(objekt, ("einheit".to_string(), g.einheit_id.unwrap()));
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE id = ?")
            .bind(g.meldung_id.unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(
            inhalt.starts_with("FL-MUS 1-44-1 mit FL-MUS 1-19-1 unangemeldet"),
            "{inhalt}"
        );
    }

    #[tokio::test]
    async fn doppelbuchung_422_und_trotzdem_angelegt() {
        let pool = test_pool().await;
        let (b, e) = basis(&pool).await;
        let raum = br(&pool, e, b, "Sportplatz", None).await;
        fahrzeug(&pool, e, "FL-MUS 1-44-1", None).await;
        let ei = einheit(&pool, e, "Müller  1").await;
        let vorher = count_rows(&pool, e).await;

        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("fl-mus 1-44-1")])),
        )
        .await;
        match g {
            Err(AppError::UnprocessableEntity(grund)) => {
                assert!(grund.contains("FL-MUS 1-44-1"), "{grund}")
            }
            andere => panic!("{andere:?}"),
        }
        // Unicode-Faltung in Rust: „Müller  1“ trifft „MÜLLER 1“ (SQL-`lower()` fiele durch).
        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("MÜLLER 1")])),
        )
        .await;
        assert!(
            matches!(&g, Err(AppError::UnprocessableEntity(grund)) if grund.contains("Müller  1")),
            "{g:?}"
        );
        // Funkrufname einer Einheit zählt wie ihr Name.
        sqlx::query("UPDATE einsatz_einheit SET funkrufname = 'Florian HM 12/44' WHERE id = ?")
            .bind(ei)
            .execute(&pool)
            .await
            .unwrap();
        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("Neu"), fz("florian hm 12/44")])),
        )
        .await;
        assert!(matches!(g, Err(AppError::UnprocessableEntity(_))), "{g:?}");
        assert_eq!(count_rows(&pool, e).await, vorher);

        let g = buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(UnangemeldetEingabe {
                trotzdem_anlegen: true,
                ..unangemeldet(vec![fz("fl-mus 1-44-1")])
            }),
        )
        .await
        .unwrap();
        assert!(g.einheit_id.is_some());
        // Eine aufgelöste Einheit ist nicht mehr im Einsatz.
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-05-28 10:00:00' WHERE id = ?",
        )
        .bind(ei)
        .execute(&pool)
        .await
        .unwrap();
        buche(
            &pool,
            &rahmen(e, raum, b),
            &checked(unangemeldet(vec![fz("MÜLLER 1")])),
        )
        .await
        .unwrap();
    }
}

//! Registrierstelle an einer Betreuungsstelle (LLH-1612, Change
//! `hitr91ob-registrierstelle-betreuung`).
//!
//! Registrierte sind Betroffene (design.md D1): eine Registrierung legt je Person eine Zeile in
//! `einsatz_person` mit Status `betroffen` und dem Verbleib „Notunterkunft“ an der Stelle an.
//! Personen, die zusammen ankommen, bilden einen **Haushalt** (D3). Abmelden ist der Verbleib
//! „entlassen“ (D6). Beides schreibt EINEN ETB-Eintrag je Vorgang, ohne Namen, und führt danach
//! die Belegung einer namentlich geführten Stelle einmal nach (D5).
//!
//! Haushalte umbauen (LLH-1615, Change `lm62ud0b-haushalt-umbauen`): Bezugsperson wechseln und
//! Personen zwischen Haushalten einer Stelle umhängen, je Vorgang ein ETB-Eintrag ohne Namen; die
//! Bezugsperson rückt nach, wenn sie den Haushalt verlässt oder storniert wird.
//!
//! Die Felder prüft die Route (`routes/betreuung_registrierung.rs`); hier liegen nur die
//! Zusammenhänge (Stelle, Haushalt) und das Schreiben in einer offenen Transaktion.

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use super::{etb_text, BetreuungsstelleStatus};
use crate::error::AppError;
use crate::person::{registrier_anzeige, verbleib_repo, Geschlecht, Kostform, VerbleibArt};
use crate::verpflegung::Sonderkost;

/// Höchstzahl der Personen je Registrierung (Spec `betreuung-registrierung`).
pub const REGISTRIERUNG_PERSONEN_MAX: usize = 30;

/// Höchstzahl der Personen-Kennungen je Abmeldung (`src/AGENTS.md`, „Eingabegrenzen“: Listen von
/// außen haben ein `*_MAX`, gezählt vor dem Entdoppeln). Die Prüfung je Person bleibt dadurch
/// gedeckelt.
pub const ABMELDUNG_PERSONEN_MAX: usize = 50;

/// Höchstlänge des Ziels einer Abmeldung (Spec „Abmelden“), nach dem Trimmen.
pub const ABMELDUNG_ZIEL_MAX: usize = 200;

/// Eine Person in der Registrierung; Freitexte getrimmt und begrenzt, Geburtsdatum geprüft.
#[derive(Debug, Clone)]
pub struct RegistrierPerson {
    pub name: String,
    pub vorname: Option<String>,
    pub geburtsdatum: Option<String>,
    pub geschlecht: Option<Geschlecht>,
    pub herkunft_adresse: Option<String>,
    pub kontakt: Option<String>,
    pub kostform: Kostform,
    pub unvertraeglichkeiten: Option<String>,
    pub notiz: Option<String>,
}

/// Eingabe „Haushalt registrieren“ (D2).
#[derive(Debug, Clone)]
pub struct RegistrierEingabe {
    /// Bestehender Haushalt, dem die Personen angehängt werden; fehlt = neuer Haushalt.
    pub haushalt_id: Option<i64>,
    pub personen: Vec<RegistrierPerson>,
    /// Erfassungszeit, schon gekappt (`support::erfassungszeitpunkt`).
    pub zeitpunkt_at: String,
    /// Idempotenzschlüssel der Offline-Queue; die Personen tragen `<client_id>#<n>`.
    pub client_id: Option<String>,
}

/// Eingabe „Abmelden“ (D6): genau eins von Haushalt und Personen.
#[derive(Debug, Clone)]
pub struct AbmeldeEingabe {
    pub haushalt_id: Option<i64>,
    pub person_ids: Vec<i64>,
    pub ziel: Option<String>,
    pub zeitpunkt_at: String,
    /// Idempotenzschlüssel; die Verbleib-Ereignisse tragen `<client_id>#<person_id>`.
    pub client_id: Option<String>,
}

/// Eine an der Stelle registrierte Person (Registrierliste und Antworten). Personenbezogen: nur
/// mit Zugriff auf das Modul Personen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, sqlx::FromRow, ToSchema)]
pub struct RegistriertePerson {
    pub id: i64,
    pub registrier_nr: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geschlecht: Option<Geschlecht>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geburtsdatum: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alter_geschaetzt: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kostform: Option<Kostform>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unvertraeglichkeiten: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub haushalt_id: Option<i64>,
    /// Erfassungszeit der Person.
    pub erfasst_at: String,
}

/// Ein Haushalt mit den Personen, die an DIESER Stelle registriert sind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct HaushaltAnzeige {
    pub id: i64,
    /// Nummer im Einsatz, angezeigt als „H-n“.
    pub nummer: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezugsperson_id: Option<i64>,
    /// „Nachname, Vorname“ der Bezugsperson, auch wenn sie nicht (mehr) an dieser Stelle ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezugsperson_name: Option<String>,
    pub personen: Vec<RegistriertePerson>,
}

/// Die Registrierliste einer Stelle (`GET …/stellen/{sid}/registrierungen`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct RegistrierListe {
    pub stelle_id: i64,
    /// Haushalte mit mindestens einer hier registrierten Person, nach Nummer.
    pub haushalte: Vec<HaushaltAnzeige>,
    /// Hier registrierte Personen ohne Haushalt (etwa über einen Verbleib aufgenommen).
    pub ohne_haushalt: Vec<RegistriertePerson>,
}

/// Antwort auf „Abmelden“: wer abgemeldet wurde (übersprungene fehlen).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AbmeldungAnzeige {
    pub stelle_id: i64,
    pub person_ids: Vec<i64>,
}

/// Kostformen der Registrierten ohne Personenbezug (D7, `GET …/betreuung/kostformen`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct KostformZaehlung {
    /// Alle jetzt an einer nicht stornierten Stelle registrierten Personen.
    pub registriert: i64,
    /// Davon je Sonderkost-Form.
    pub sonderkost: Sonderkost,
    /// Davon mit Kostform `normal`.
    pub normal: i64,
    /// Davon ohne Kostform.
    pub ohne_angabe: i64,
}

/// Ergebnis eines Schreibvorgangs: der Haushalt (beim Abmelden ohne), die betroffenen Personen
/// und alle ETB-Einträge für die Live-Verteilung.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registriert {
    pub haushalt_id: Option<i64>,
    pub person_ids: Vec<i64>,
    pub etb_ids: Vec<i64>,
    /// `true`, wenn die Belegung einer namentlich geführten Stelle nachgeführt wurde.
    pub belegung_nachgefuehrt: bool,
}

/// Bezeichnung und Zustand einer Stelle für die Prüfkette (404 fremd, 409 storniert).
async fn stelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<(String, BetreuungsstelleStatus), AppError> {
    let (bezeichnung, status, storniert_at): (String, String, Option<String>) = sqlx::query_as(
        "SELECT bezeichnung, status, storniert_at FROM betreuungsstelle \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(stelle_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if storniert_at.is_some() {
        return Err(AppError::Conflict(format!(
            "Betreuungsstelle ‚{bezeichnung}‘ ist storniert"
        )));
    }
    let status = BetreuungsstelleStatus::try_from(status)
        .map_err(|e| AppError::Internal(format!("Ungültiger Wert in der DB: {e}")))?;
    Ok((bezeichnung, status))
}

/// Prüfkette vor den Zusammenhängen (404 fremd/unbekannt, 409 storniert), damit eine Route
/// sie vor ihren 422-Prüfungen auslösen kann (Statuscode-Konvention).
pub async fn stelle_pruefen(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<(), AppError> {
    stelle_tx(&mut *pool.acquire().await?, einsatz_id, stelle_id).await?;
    Ok(())
}

/// Nummer eines Haushalts des Einsatzes; fremd oder unbekannt → 404.
async fn haushalt_nummer_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    haushalt_id: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar("SELECT nummer FROM haushalt WHERE id = ? AND einsatz_id = ?")
        .bind(haushalt_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Schlüssel der n-ten Person einer Registrierung (Replay über `einsatz_person.client_id`).
pub fn person_client_id(client_id: &str, n: usize) -> String {
    format!("{client_id}#{n}")
}

/// Der Haushalt einer schon gespeicherten Registrierung und die Stelle, an der registriert wurde
/// (Replay, D2): die erste Person trägt `<client_id>#0`, ihr erster Verbleib „Notunterkunft“ ist
/// die Registrierung — auch wenn sie inzwischen abgemeldet ist. `None`, wenn es die
/// Registrierung nicht gibt.
pub async fn registrierung_nach_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<(Option<i64>, i64)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT p.haushalt_id, \
                COALESCE((SELECT v.betreuungsstelle_id FROM person_verbleib v \
                          WHERE v.person_id = p.id AND v.art = 'notunterkunft' \
                          ORDER BY v.id LIMIT 1), 0) \
         FROM einsatz_person p WHERE p.einsatz_id = ? AND p.client_id = ?",
    )
    .bind(einsatz_id)
    .bind(person_client_id(client_id, 0))
    .fetch_optional(pool)
    .await?)
}

/// Ob eine Abmeldung mit diesem Schlüssel schon gespeichert ist (Replay, D6).
pub async fn abmeldung_nach_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT person_id FROM person_verbleib \
         WHERE einsatz_id = ? AND client_id LIKE ? ESCAPE '\\' ORDER BY person_id",
    )
    .bind(einsatz_id)
    .bind(format!("{}#%", like_maskiert(client_id)))
    .fetch_all(pool)
    .await?)
}

fn like_maskiert(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Registriert einen Haushalt an einer Stelle (D2). Prüfkette nach dem Replay der Route: 404
/// (Stelle, Haushalt) → 409 (Stelle storniert) → 422 (Stelle geschlossen). Die Felder sind
/// geprüft; leer ist die Personenliste nie (die Route prüft das als 422).
pub async fn registrieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &RegistrierEingabe,
) -> Result<Registriert, AppError> {
    // Replay in der Transaktion (BEGIN IMMEDIATE): zwei gleichzeitige Wiederholungen kommen an der
    // Prüfung der Route vorbei; die zweite findet hier die erste Person und schreibt nichts.
    if let Some(cid) = eingabe.client_id.as_deref() {
        let schon: Option<(i64, Option<i64>)> = sqlx::query_as(
            "SELECT id, haushalt_id FROM einsatz_person WHERE einsatz_id = ? AND client_id = ?",
        )
        .bind(einsatz_id)
        .bind(person_client_id(cid, 0))
        .fetch_optional(&mut *conn)
        .await?;
        if let Some((_, haushalt_id)) = schon {
            return Ok(Registriert {
                haushalt_id,
                person_ids: Vec::new(),
                etb_ids: Vec::new(),
                belegung_nachgefuehrt: false,
            });
        }
    }
    let (bezeichnung, status) = stelle_tx(conn, einsatz_id, stelle_id).await?;
    let bestehend = match eingabe.haushalt_id {
        Some(h) => Some((h, haushalt_nummer_tx(conn, einsatz_id, h).await?)),
        None => None,
    };
    if status == BetreuungsstelleStatus::Geschlossen {
        return Err(AppError::UnprocessableEntity(format!(
            "Betreuungsstelle ‚{bezeichnung}‘ ist geschlossen — erst wieder in Betrieb setzen"
        )));
    }
    let (haushalt_id, nummer) = match bestehend {
        Some(h) => h,
        None => haushalt_anlegen_tx(conn, einsatz_id, benutzer_id, &eingabe.zeitpunkt_at).await?,
    };
    // Ohne gültige Bezugsperson (keine, storniert, weggezogen) wird die erste neue Person sie
    // (LLH-1615, design.md D2); das heilt auch Haushalte von vor dem Nachrücken.
    let bezugsperson_setzen = !bezugsperson_gueltig_tx(conn, haushalt_id).await?;

    let mut person_ids = Vec::new();
    let mut registriernummern = Vec::new();
    for (n, p) in eingabe.personen.iter().enumerate() {
        let client_id = eingabe.client_id.as_deref().map(|c| person_client_id(c, n));
        let (id, reg, _) = crate::person::repo::anlegen_tx_mit_optionen(
            conn,
            einsatz_id,
            benutzer_id,
            crate::person::PersonStatus::Betroffen.as_str(),
            client_id.as_deref(),
            Some(&eingabe.zeitpunkt_at),
            crate::person::repo::NeueDaten {
                name: Some(&p.name),
                vorname: p.vorname.as_deref(),
                geschlecht: p.geschlecht.map(|g| g.as_str()),
                geburtsdatum: p.geburtsdatum.as_deref(),
                alter_geschaetzt: None,
                herkunft_adresse: p.herkunft_adresse.as_deref(),
                antreff_ort: None,
                melder_kontakt: p.kontakt.as_deref(),
                notiz: p.notiz.as_deref(),
                zustand: None,
                antreff_lat: None,
                antreff_lon: None,
                vermisst_seit: None,
                versorgende_einheit_id: None,
                meldung_id: None,
            },
        )
        .await?;
        sqlx::query(
            "UPDATE einsatz_person SET haushalt_id = ?, kostform = ?, unvertraeglichkeiten = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(haushalt_id)
        .bind(p.kostform.as_str())
        .bind(p.unvertraeglichkeiten.as_deref())
        .bind(id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        verbleib_repo::erfassen_tx(
            conn,
            einsatz_id,
            id,
            verbleib_repo::VerbleibDaten {
                art: VerbleibArt::Notunterkunft.as_str(),
                betreuungsstelle_id: Some(stelle_id),
                zeitpunkt_at: Some(&eingabe.zeitpunkt_at),
                ohne_belegung_nachfuehren: true,
                ..Default::default()
            },
            benutzer_id,
        )
        .await?;
        person_ids.push(id);
        registriernummern.push(registrier_anzeige(reg));
    }
    if bezugsperson_setzen {
        sqlx::query("UPDATE haushalt SET bezugsperson_id = ? WHERE id = ?")
            .bind(person_ids.first())
            .bind(haushalt_id)
            .execute(&mut *conn)
            .await?;
    }
    let mut etb_ids = vec![
        crate::etb::system_audit_zu_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &etb_text::registriert(&bezeichnung, nummer, &registriernummern),
            &eingabe.zeitpunkt_at,
        )
        .await?,
    ];
    let nachgefuehrt = super::repo::belegung_nachfuehren_tx(
        conn,
        einsatz_id,
        stelle_id,
        &eingabe.zeitpunkt_at,
        benutzer_id,
    )
    .await?;
    let belegung_nachgefuehrt = !nachgefuehrt.is_empty();
    etb_ids.extend(nachgefuehrt);
    Ok(Registriert {
        haushalt_id: Some(haushalt_id),
        person_ids,
        etb_ids,
        belegung_nachgefuehrt,
    })
}

/// Meldet Personen an einer Stelle ab (D6): je Person, die noch hier registriert ist, der
/// Verbleib „entlassen“ mit Ziel; übrige werden übersprungen. Unbekannte Stelle, unbekannter
/// Haushalt oder eine Person eines anderen Einsatzes → 404; storniert → 409. Ist danach niemand
/// abzumelden, schreibt der Vorgang nichts.
pub async fn abmelden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &AbmeldeEingabe,
) -> Result<Registriert, AppError> {
    let (bezeichnung, _) = stelle_tx(conn, einsatz_id, stelle_id).await?;
    let nummer = match eingabe.haushalt_id {
        Some(h) => Some(haushalt_nummer_tx(conn, einsatz_id, h).await?),
        None => None,
    };
    let mut kandidaten: Vec<(i64, i64)> = Vec::new();
    match eingabe.haushalt_id {
        Some(h) => {
            kandidaten = sqlx::query_as(
                "SELECT id, registrier_nr FROM einsatz_person \
                 WHERE einsatz_id = ? AND haushalt_id = ? AND storniert_at IS NULL \
                   AND aktuelle_verbleib_art = 'notunterkunft' \
                   AND aktuelle_verbleib_betreuungsstelle_id = ? \
                 ORDER BY registrier_nr",
            )
            .bind(einsatz_id)
            .bind(h)
            .bind(stelle_id)
            .fetch_all(&mut *conn)
            .await?;
        }
        None => {
            for pid in &eingabe.person_ids {
                let zeile: Option<(i64, Option<String>, Option<i64>, Option<String>)> =
                    sqlx::query_as(
                        "SELECT registrier_nr, aktuelle_verbleib_art, \
                                aktuelle_verbleib_betreuungsstelle_id, storniert_at \
                         FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
                    )
                    .bind(pid)
                    .bind(einsatz_id)
                    .fetch_optional(&mut *conn)
                    .await?;
                let (reg, art, stelle, storniert_at) = zeile.ok_or(AppError::NotFound)?;
                let hier = storniert_at.is_none()
                    && art.as_deref() == Some(VerbleibArt::Notunterkunft.as_str())
                    && stelle == Some(stelle_id);
                if hier && !kandidaten.iter().any(|(id, _)| id == pid) {
                    kandidaten.push((*pid, reg));
                }
            }
        }
    }
    if kandidaten.is_empty() {
        return Ok(Registriert {
            haushalt_id: eingabe.haushalt_id,
            person_ids: Vec::new(),
            etb_ids: Vec::new(),
            belegung_nachgefuehrt: false,
        });
    }
    let mut registriernummern = Vec::new();
    for (pid, reg) in &kandidaten {
        let client_id = eingabe.client_id.as_deref().map(|c| format!("{c}#{pid}"));
        verbleib_repo::erfassen_tx(
            conn,
            einsatz_id,
            *pid,
            verbleib_repo::VerbleibDaten {
                art: VerbleibArt::Entlassung.as_str(),
                ziel: eingabe.ziel.as_deref(),
                zeitpunkt_at: Some(&eingabe.zeitpunkt_at),
                client_id: client_id.as_deref(),
                ohne_belegung_nachfuehren: true,
                ..Default::default()
            },
            benutzer_id,
        )
        .await?;
        registriernummern.push(registrier_anzeige(*reg));
    }
    let mut etb_ids = vec![
        crate::etb::system_audit_zu_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &etb_text::abgemeldet(&bezeichnung, nummer, &registriernummern),
            &eingabe.zeitpunkt_at,
        )
        .await?,
    ];
    let nachgefuehrt = super::repo::belegung_nachfuehren_tx(
        conn,
        einsatz_id,
        stelle_id,
        &eingabe.zeitpunkt_at,
        benutzer_id,
    )
    .await?;
    let belegung_nachgefuehrt = !nachgefuehrt.is_empty();
    etb_ids.extend(nachgefuehrt);
    Ok(Registriert {
        haushalt_id: eingabe.haushalt_id,
        person_ids: kandidaten.into_iter().map(|(id, _)| id).collect(),
        etb_ids,
        belegung_nachgefuehrt,
    })
}

/// Legt einen Haushalt mit der nächsten Nummer des Einsatzes an (`id`, `nummer`).
async fn haushalt_anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    zeitpunkt_at: &str,
) -> Result<(i64, i64), AppError> {
    Ok(sqlx::query_as(
        "INSERT INTO haushalt (einsatz_id, nummer, angelegt_von_id, angelegt_at) \
         SELECT ?1, COALESCE(MAX(nummer), 0) + 1, ?2, ?3 \
         FROM haushalt WHERE einsatz_id = ?1 \
         RETURNING id, nummer",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(zeitpunkt_at)
    .fetch_one(&mut *conn)
    .await?)
}

/// Ob der Haushalt eine gültige Bezugsperson hat: gesetzt, nicht storniert und noch Mitglied.
async fn bezugsperson_gueltig_tx(
    conn: &mut SqliteConnection,
    haushalt_id: i64,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM haushalt h JOIN einsatz_person p ON p.id = h.bezugsperson_id \
                        WHERE h.id = ?1 AND p.haushalt_id = ?1 AND p.storniert_at IS NULL)",
    )
    .bind(haushalt_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Bezugsperson rückt nach (LLH-1615, design.md D2): die nächste nicht stornierte Person des
/// Haushalts, zuerst in einer Notunterkunft, dann nach Registriernummer; ohne solche bleibt der
/// Haushalt ohne. Liefert die neue Bezugsperson als `(person_id, registrier_nr)`.
pub async fn bezugsperson_nachruecken_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    haushalt_id: i64,
) -> Result<Option<(i64, i64)>, AppError> {
    let neu: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, registrier_nr FROM einsatz_person \
         WHERE einsatz_id = ? AND haushalt_id = ? AND storniert_at IS NULL \
         ORDER BY COALESCE(aktuelle_verbleib_art = 'notunterkunft', 0) DESC, registrier_nr \
         LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(haushalt_id)
    .fetch_optional(&mut *conn)
    .await?;
    sqlx::query("UPDATE haushalt SET bezugsperson_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(neu.map(|(id, _)| id))
        .bind(haushalt_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(neu)
}

/// Rückt in jedem Haushalt nach, dessen Bezugsperson diese Person ist (Storno, design.md D2).
/// Liefert `(haushalt_nummer, neue Bezugsperson)` für den ETB-Satz und die Live-Verteilung.
pub async fn nach_storno_nachruecken_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Option<(i64, Option<(i64, i64)>)>, AppError> {
    let haushalt: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, nummer FROM haushalt WHERE einsatz_id = ? AND bezugsperson_id = ?",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((hid, nummer)) = haushalt else {
        return Ok(None);
    };
    Ok(Some((
        nummer,
        bezugsperson_nachruecken_tx(conn, einsatz_id, hid).await?,
    )))
}

/// Eine Person, die jetzt an der Stelle registriert ist (LLH-1615, design.md D1): fremd oder
/// unbekannt → 404, storniert → 409, nicht hier → 422. Liefert `(registrier_nr, haushalt_id)`.
async fn person_hier_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    person_id: i64,
) -> Result<(i64, Option<i64>), AppError> {
    let (reg, haushalt, art, stelle, storniert_at): (
        i64,
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT registrier_nr, haushalt_id, aktuelle_verbleib_art, \
                aktuelle_verbleib_betreuungsstelle_id, storniert_at \
         FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if storniert_at.is_some() {
        return Err(AppError::Conflict(format!(
            "Person {} ist storniert",
            registrier_anzeige(reg)
        )));
    }
    if art.as_deref() != Some(VerbleibArt::Notunterkunft.as_str()) || stelle != Some(stelle_id) {
        return Err(AppError::UnprocessableEntity(format!(
            "Person {} ist nicht an dieser Betreuungsstelle registriert",
            registrier_anzeige(reg)
        )));
    }
    Ok((reg, haushalt))
}

/// Setzt die Bezugsperson eines Haushalts an einer Stelle (LLH-1615, design.md D1). Prüfkette:
/// 404 (Stelle, Haushalt, Person) → 409 (Stelle, Person storniert) → 422 (Person nicht hier,
/// nicht im Haushalt). Ist sie es schon, schreibt der Vorgang nichts.
#[allow(clippy::too_many_arguments)]
pub async fn bezugsperson_setzen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    startwert: i64,
    haushalt_id: i64,
    person_id: i64,
    zeitpunkt_at: &str,
) -> Result<Registriert, AppError> {
    let (bezeichnung, _) = stelle_tx(conn, einsatz_id, stelle_id).await?;
    let nummer = haushalt_nummer_tx(conn, einsatz_id, haushalt_id).await?;
    let (reg, haushalt) = person_hier_tx(conn, einsatz_id, stelle_id, person_id).await?;
    if haushalt != Some(haushalt_id) {
        return Err(AppError::UnprocessableEntity(format!(
            "Person {} gehört nicht zu Haushalt H-{nummer}",
            registrier_anzeige(reg)
        )));
    }
    let bisher: Option<i64> =
        sqlx::query_scalar("SELECT bezugsperson_id FROM haushalt WHERE id = ?")
            .bind(haushalt_id)
            .fetch_one(&mut *conn)
            .await?;
    let mut ergebnis = Registriert {
        haushalt_id: Some(haushalt_id),
        person_ids: Vec::new(),
        etb_ids: Vec::new(),
        belegung_nachgefuehrt: false,
    };
    if bisher == Some(person_id) {
        return Ok(ergebnis);
    }
    sqlx::query("UPDATE haushalt SET bezugsperson_id = ? WHERE id = ?")
        .bind(person_id)
        .bind(haushalt_id)
        .execute(&mut *conn)
        .await?;
    ergebnis.etb_ids.push(
        crate::etb::system_audit_zu_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            &etb_text::bezugsperson_gewechselt(&bezeichnung, nummer, &registrier_anzeige(reg)),
            zeitpunkt_at,
        )
        .await?,
    );
    ergebnis.person_ids = bisher.into_iter().chain([person_id]).collect();
    Ok(ergebnis)
}

/// Ziel von „Haushalt ändern“ (LLH-1615, design.md D1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HaushaltZiel {
    Bestehend(i64),
    Neu,
}

/// Hängt eine an der Stelle registrierte Person in einen anderen Haushalt um oder in einen neuen
/// (LLH-1615, design.md D1/D2). Ein bestehendes Ziel braucht eine hier registrierte Person (422).
/// Verlässt die Bezugsperson ihren Haushalt, rückt dort jemand nach; ohne gültige Bezugsperson im
/// Ziel wird die Person sie. Ist sie schon im Ziel, schreibt der Vorgang nichts. Prüfkette wie
/// [`bezugsperson_setzen_tx`]; die geschlossene Stelle sperrt nicht.
#[allow(clippy::too_many_arguments)]
pub async fn haushalt_aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    startwert: i64,
    person_id: i64,
    ziel: HaushaltZiel,
    zeitpunkt_at: &str,
) -> Result<Registriert, AppError> {
    let (bezeichnung, _) = stelle_tx(conn, einsatz_id, stelle_id).await?;
    let ziel_nummer = match ziel {
        HaushaltZiel::Bestehend(h) => Some(haushalt_nummer_tx(conn, einsatz_id, h).await?),
        HaushaltZiel::Neu => None,
    };
    let (reg, bisher) = person_hier_tx(conn, einsatz_id, stelle_id, person_id).await?;
    if let HaushaltZiel::Bestehend(h) = ziel {
        if bisher == Some(h) {
            return Ok(Registriert {
                haushalt_id: Some(h),
                person_ids: Vec::new(),
                etb_ids: Vec::new(),
                belegung_nachgefuehrt: false,
            });
        }
        let hier: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz_person WHERE einsatz_id = ? AND haushalt_id = ? \
                AND storniert_at IS NULL AND aktuelle_verbleib_art = 'notunterkunft' \
                AND aktuelle_verbleib_betreuungsstelle_id = ?)",
        )
        .bind(einsatz_id)
        .bind(h)
        .bind(stelle_id)
        .fetch_one(&mut *conn)
        .await?;
        if !hier {
            return Err(AppError::UnprocessableEntity(format!(
                "Haushalt H-{} hat an dieser Betreuungsstelle niemanden registriert",
                ziel_nummer.unwrap_or_default()
            )));
        }
    }
    let (ziel_id, ziel_nummer) = match (ziel, ziel_nummer) {
        (HaushaltZiel::Bestehend(h), Some(n)) => (h, n),
        _ => haushalt_anlegen_tx(conn, einsatz_id, benutzer_id, zeitpunkt_at).await?,
    };
    sqlx::query("UPDATE einsatz_person SET haushalt_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(ziel_id)
        .bind(person_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;

    let mut person_ids = vec![person_id];
    let mut von_nummer = None;
    let mut nachgerueckt = None;
    if let Some(alt) = bisher {
        let (nummer, bezugsperson): (i64, Option<i64>) =
            sqlx::query_as("SELECT nummer, bezugsperson_id FROM haushalt WHERE id = ?")
                .bind(alt)
                .fetch_one(&mut *conn)
                .await?;
        von_nummer = Some(nummer);
        if bezugsperson == Some(person_id) {
            if let Some((pid, r)) = bezugsperson_nachruecken_tx(conn, einsatz_id, alt).await? {
                person_ids.push(pid);
                nachgerueckt = Some(registrier_anzeige(r));
            }
        }
    }
    let wird_bezugsperson = !bezugsperson_gueltig_tx(conn, ziel_id).await?;
    if wird_bezugsperson {
        sqlx::query("UPDATE haushalt SET bezugsperson_id = ? WHERE id = ?")
            .bind(person_id)
            .bind(ziel_id)
            .execute(&mut *conn)
            .await?;
    }
    let etb_id = crate::etb::system_audit_zu_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &etb_text::haushalt_gewechselt(
            &bezeichnung,
            &registrier_anzeige(reg),
            von_nummer,
            ziel_nummer,
            ziel == HaushaltZiel::Neu,
            wird_bezugsperson,
            nachgerueckt.as_deref(),
        ),
        zeitpunkt_at,
    )
    .await?;
    Ok(Registriert {
        haushalt_id: Some(ziel_id),
        person_ids,
        etb_ids: vec![etb_id],
        belegung_nachgefuehrt: false,
    })
}

#[derive(sqlx::FromRow)]
struct ListenZeile {
    #[sqlx(flatten)]
    person: RegistriertePerson,
    haushalt_nummer: Option<i64>,
    bezugsperson_id: Option<i64>,
    bezugsperson_name: Option<String>,
}

/// Die Registrierliste einer Stelle des Einsatzes (fremd oder unbekannt → 404). Enthält jede
/// nicht stornierte Person, deren jüngster Verbleib „Notunterkunft“ an dieser Stelle ist —
/// dieselbe Menge wie „davon namentlich“ und die Belegung einer namentlich geführten Stelle.
///
/// `stellensicht` (Gerät „Betreuungsstelle“): den Namen der Bezugsperson nur, wenn sie je an
/// dieser Stelle war — ein Haushalt kann Mitglieder an mehreren Stellen haben, und das Gerät
/// sieht nur Personen seiner Stelle (`geraet::stelle::sichtbare_personen`).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    stellensicht: bool,
) -> Result<RegistrierListe, AppError> {
    let mut conn = pool.acquire().await?;
    liste_in(&mut conn, einsatz_id, stelle_id, stellensicht).await
}

/// Die Registrierliste für den Druck (LLH-1616, Change `iw8hjb93-registrierliste-drucken`
/// design.md D2/D3): in EINER Schreibtransaktion lesen und je Person einen Eintrag
/// `registrierliste` ins Zugriffsprotokoll schreiben; erst nach dem Commit verlässt die Liste den
/// Server. Scheitert ein Eintrag, bleibt keiner stehen und keine Person geht hinaus.
/// `write_retry!` öffnet mit `BEGIN IMMEDIATE`: ein deferred `BEGIN` mit Lesen vor dem ersten
/// Eintrag scheiterte beim Lock-Upgrade sofort, sobald gleichzeitig registriert wird
/// (`src/tx.rs`). Ohne `has_unvertraeglichkeiten` fehlt die Gesundheitsangabe in der Antwort
/// (Spec „Gesundheitsangaben nur auf Wunsch“).
pub async fn liste_for_druck(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    stellensicht: bool,
    benutzer_id: i64,
    has_unvertraeglichkeiten: bool,
) -> Result<RegistrierListe, AppError> {
    let mut l = crate::write_retry!(pool, |conn| {
        let l = liste_in(conn, einsatz_id, stelle_id, stellensicht).await?;
        let personen = l
            .haushalte
            .iter()
            .flat_map(|h| h.personen.iter())
            .chain(l.ohne_haushalt.iter());
        for p in personen {
            crate::person::audit_repo::create_tx(
                conn,
                einsatz_id,
                Some(p.id),
                benutzer_id,
                "registrierliste",
            )
            .await?;
        }
        Ok(l)
    })?;
    // Nur wer gedruckt (und protokolliert) wird, steht auf dem Blatt: eine Bezugsperson, die nicht
    // (mehr) an der Stelle registriert ist, fällt aus dem Haushaltskopf (Review, 09.11.2026).
    for h in &mut l.haushalte {
        let gelistet = h
            .bezugsperson_id
            .is_some_and(|b| h.personen.iter().any(|p| p.id == b));
        if !gelistet {
            h.bezugsperson_id = None;
            h.bezugsperson_name = None;
        }
    }
    if !has_unvertraeglichkeiten {
        let personen = l
            .haushalte
            .iter_mut()
            .flat_map(|h| h.personen.iter_mut())
            .chain(l.ohne_haushalt.iter_mut());
        for p in personen {
            p.unvertraeglichkeiten = None;
        }
    }
    Ok(l)
}

async fn liste_in(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    stellensicht: bool,
) -> Result<RegistrierListe, AppError> {
    let gibt_es: Option<i64> =
        sqlx::query_scalar("SELECT id FROM betreuungsstelle WHERE id = ? AND einsatz_id = ?")
            .bind(stelle_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    gibt_es.ok_or(AppError::NotFound)?;
    let zeilen: Vec<ListenZeile> = sqlx::query_as(
        "SELECT p.id, p.registrier_nr, p.name, p.vorname, p.geschlecht, p.geburtsdatum, \
                p.alter_geschaetzt, p.kostform, p.unvertraeglichkeiten, p.haushalt_id, \
                p.erfasst_at, h.nummer AS haushalt_nummer, h.bezugsperson_id, \
                (SELECT NULLIF(TRIM(COALESCE(b.name, '') || \
                        CASE WHEN b.vorname IS NOT NULL AND b.vorname <> '' \
                             THEN ', ' || b.vorname ELSE '' END), '') \
                   FROM einsatz_person b \
                  WHERE b.id = h.bezugsperson_id AND b.storniert_at IS NULL \
                    AND (?1 = 0 OR EXISTS (SELECT 1 FROM person_verbleib v \
                         WHERE v.person_id = b.id AND v.betreuungsstelle_id = ?3))) \
                  AS bezugsperson_name \
         FROM einsatz_person p LEFT JOIN haushalt h ON h.id = p.haushalt_id \
         WHERE p.einsatz_id = ?2 AND p.storniert_at IS NULL \
           AND p.aktuelle_verbleib_art = 'notunterkunft' \
           AND p.aktuelle_verbleib_betreuungsstelle_id = ?3 \
         ORDER BY h.nummer IS NULL, h.nummer, p.registrier_nr",
    )
    .bind(stellensicht)
    .bind(einsatz_id)
    .bind(stelle_id)
    .fetch_all(&mut *conn)
    .await?;
    let mut haushalte: Vec<HaushaltAnzeige> = Vec::new();
    let mut ohne_haushalt = Vec::new();
    for z in zeilen {
        match (z.person.haushalt_id, z.haushalt_nummer) {
            (Some(id), Some(nummer)) => match haushalte.last_mut() {
                Some(h) if h.id == id => h.personen.push(z.person),
                _ => haushalte.push(HaushaltAnzeige {
                    id,
                    nummer,
                    bezugsperson_id: z.bezugsperson_id,
                    bezugsperson_name: z.bezugsperson_name,
                    personen: vec![z.person],
                }),
            },
            _ => ohne_haushalt.push(z.person),
        }
    }
    Ok(RegistrierListe {
        stelle_id,
        haushalte,
        ohne_haushalt,
    })
}

/// Ein Haushalt des Einsatzes mit den Personen, die jetzt an der Stelle registriert sind — leer,
/// wenn alle abgemeldet sind (Antwort eines Replays). Fremd oder unbekannt → 404.
pub async fn haushalt(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    haushalt_id: i64,
    stellensicht: bool,
) -> Result<HaushaltAnzeige, AppError> {
    if let Some(h) = liste(pool, einsatz_id, stelle_id, stellensicht)
        .await?
        .haushalte
        .into_iter()
        .find(|h| h.id == haushalt_id)
    {
        return Ok(h);
    }
    let (id, nummer, bezugsperson_id): (i64, i64, Option<i64>) = sqlx::query_as(
        "SELECT id, nummer, bezugsperson_id FROM haushalt WHERE id = ? AND einsatz_id = ?",
    )
    .bind(haushalt_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(HaushaltAnzeige {
        id,
        nummer,
        bezugsperson_id,
        bezugsperson_name: None,
        personen: Vec::new(),
    })
}

/// Kostformen der jetzt Registrierten im Einsatz, ohne Personenbezug (D7).
pub async fn kostformen(pool: &SqlitePool, einsatz_id: i64) -> Result<KostformZaehlung, AppError> {
    let zeilen: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT p.kostform, COUNT(*) FROM einsatz_person p \
         JOIN betreuungsstelle s ON s.id = p.aktuelle_verbleib_betreuungsstelle_id \
              AND s.storniert_at IS NULL \
         WHERE p.einsatz_id = ? AND p.storniert_at IS NULL \
           AND p.aktuelle_verbleib_art = 'notunterkunft' \
         GROUP BY p.kostform",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut z = KostformZaehlung {
        registriert: 0,
        sonderkost: Sonderkost::default(),
        normal: 0,
        ohne_angabe: 0,
    };
    for (kostform, anzahl) in zeilen {
        z.registriert += anzahl;
        match kostform.as_deref().and_then(Kostform::parse) {
            None => z.ohne_angabe += anzahl,
            Some(Kostform::Normal) => z.normal += anzahl,
            Some(Kostform::Vegetarisch) => z.sonderkost.vegetarisch += anzahl,
            Some(Kostform::Vegan) => z.sonderkost.vegan += anzahl,
            Some(Kostform::OhneSchwein) => z.sonderkost.ohne_schwein += anzahl,
            Some(Kostform::DiaetAllergenarm) => z.sonderkost.diaet_allergenarm += anzahl,
            Some(Kostform::SaeuglingKleinkind) => z.sonderkost.saeugling_kleinkind += anzahl,
        }
    }
    Ok(z)
}

#[cfg(test)]
mod tests;

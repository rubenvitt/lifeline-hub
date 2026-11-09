//! Registrierstelle an einer Betreuungsstelle (LLH-1612, Change
//! `hitr91ob-registrierstelle-betreuung`).
//!
//! Registrierte sind Betroffene (design.md D1): eine Registrierung legt je Person eine Zeile in
//! `einsatz_person` mit Status `betroffen` und dem Verbleib „Notunterkunft“ an der Stelle an.
//! Personen, die zusammen ankommen, bilden einen **Haushalt** (D3). Abmelden ist der Verbleib
//! „entlassen“ (D6). Beides schreibt EINEN ETB-Eintrag je Vorgang, ohne Namen, und führt danach
//! die Belegung einer namentlich geführten Stelle einmal nach (D5).
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
        None => {
            let (id, nummer): (i64, i64) = sqlx::query_as(
                "INSERT INTO haushalt (einsatz_id, nummer, angelegt_von_id, angelegt_at) \
                 SELECT ?1, COALESCE(MAX(nummer), 0) + 1, ?2, ?3 \
                 FROM haushalt WHERE einsatz_id = ?1 \
                 RETURNING id, nummer",
            )
            .bind(einsatz_id)
            .bind(benutzer_id)
            .bind(&eingabe.zeitpunkt_at)
            .fetch_one(&mut *conn)
            .await?;
            (id, nummer)
        }
    };

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
    if bestehend.is_none() {
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
/// design.md D2/D3): in EINER Transaktion lesen und je Person einen Eintrag `druck` ins
/// Zugriffsprotokoll schreiben; erst nach dem Commit verlässt die Liste den Server. Scheitert ein
/// Eintrag, bleibt keiner stehen und keine Person geht hinaus. Ohne `mit_unvertraeglichkeiten`
/// fehlt die Gesundheitsangabe in der Antwort (Spec „Gesundheitsangaben nur auf Wunsch“).
pub async fn liste_fuer_druck(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
    stellensicht: bool,
    benutzer_id: i64,
    mit_unvertraeglichkeiten: bool,
) -> Result<RegistrierListe, AppError> {
    let mut tx = pool.begin().await?;
    let mut l = liste_in(&mut tx, einsatz_id, stelle_id, stellensicht).await?;
    let personen = l
        .haushalte
        .iter_mut()
        .flat_map(|h| h.personen.iter_mut())
        .chain(l.ohne_haushalt.iter_mut());
    for p in personen {
        crate::person::audit_repo::create_tx(
            &mut tx,
            einsatz_id,
            Some(p.id),
            benutzer_id,
            "druck",
        )
        .await?;
        if !mit_unvertraeglichkeiten {
            p.unvertraeglichkeiten = None;
        }
    }
    tx.commit().await?;
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

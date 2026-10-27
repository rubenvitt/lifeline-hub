//! Kopplung der Kräfte-Zeitachse an die Ablösung (LLH-1128, Spec `kraefte-abloesung`
//! „Schicht mit dem Eintreffen“, `kraefte-zeitachse` „Kopplung an die Ablösung“).
//!
//! Gerufen nur aus `zeitachse::repo` (einziger Schreibpfad, `frontend/src/kraefte/AGENTS.md`),
//! nachdem an einer **Einheit** ein Ereignis geschrieben oder gestrichen wurde, in derselben
//! Transaktion:
//! - **Eintreffen** der offenen Periode: hat die Einheit keine laufende Schicht, auch keine
//!   geerbte (Knoten-Modell), und gibt es eine Vorgabe des Abschnitts oder des Einsatzes, beginnt
//!   die Schicht zum Eintreffen ([`repo::start_schicht_tx`], Rangfolge wie von Hand). Ohne
//!   Vorgabe entsteht nichts: keine erfundene Zahl. Eine als Ablöser geplante Einheit (Eintrag
//!   der Liste einer laufenden Schicht, auch über einen geplanten Vorfahren, LLH-1132) bekommt
//!   keine: ihre Schicht entsteht mit dem Vollzug als Folgeschicht.
//! - **Entlassung**, die die letzte Periode schließt: die laufende Schicht der Einheit endet als
//!   `beendet` mit Grund `entlassung`, ihre Fristen schließen.
//! - **Streichung dieser Entlassung**: die Schicht läuft wieder, samt Fristen.
//!
//! Dazu die **Hinweise zur ablösenden Einheit** (LLH-1131, [`super::hinweis`]): ist die Einheit
//! als ablösende geplant, wird ihre Alarmierung und ihr Eintreffen (beide nur als Beginn der
//! offenen Periode) je geplanter Schicht ein Anlass; das Eintreffen am Bereitstellungsraum meldet
//! dessen Buchung selbst. Ihre Entlassung ohne offene Periode danach hebt die Planung auf
//! (Hinweis und ETB „Planung der ablösenden Einheit entfallen“). Wird die Alarmierung oder das
//! Eintreffen gestrichen, mit dem ihre offene Periode begann, folgt der Hinweis „… gestrichen“
//! (LLH-1425, [`vor_streichung_tx`]).
//!
//! **Ein Fehler hier bricht nie den Anlass** (gleiche Regel wie ein Perioden-Verstoß beim
//! Statuswechsel): die Kopplung läuft in einem eigenen `SAVEPOINT`, ein Fehler rollt nur sie
//! zurück und wird geloggt. Die Einheit erscheint dann ohne Schicht.

use sqlx::SqliteConnection;

use super::hinweis::{self, Wirkung};
use super::repo::{self, Start};
use super::BeendetGrund;
use crate::benachrichtigung::BenachrichtigungBezugTyp;
use crate::error::AppError;
use crate::zeitachse::{ZeitachseArt, ZeitachseQuelle};

/// Name des Savepoints; eindeutig genug, weil die Kopplung sich nie selbst ruft.
const SAVEPOINT: &str = "abloesung_kopplung";

/// Text, mit dem der Autostart den Beginn im ETB nennt.
pub const WIE_AUTOSTART: &str = "mit dem Eintreffen begonnen";

/// Nach einem geschriebenen Ereignis an einer Einheit. Liefert die ETB-Einträge, die die
/// Kopplung geschrieben hat (für Kurzruf und `LiveEvent::Abloesung` nach dem Commit), und die
/// Anlässe der Hinweise zur ablösenden Einheit; leer ohne Wirkung oder nach einem verschluckten
/// Fehler.
pub async fn nach_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    art: ZeitachseArt,
    quelle: ZeitachseQuelle,
    zeitpunkt_at: &str,
) -> Result<Wirkung, AppError> {
    let schritt = match art {
        ZeitachseArt::Alarmierung => Schritt::Alarmierung,
        ZeitachseArt::Eintreffen => Schritt::Autostart {
            // Das Eintreffen am Bereitstellungsraum meldet dessen Buchung als eigenes Ereignis
            // (`abloeser_br_eingetroffen`), auch wenn die Zeitachse es auslässt.
            hinweis: quelle != ZeitachseQuelle::Bereitstellungsraum,
        },
        ZeitachseArt::Entlassung => Schritt::Ende,
        ZeitachseArt::Abloesung => return Ok(Wirkung::default()),
    };
    isoliert(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        schritt,
        zeitpunkt_at,
    )
    .await
}

/// VOR dem Streichen eines Ereignisses an einer Einheit: war es die Alarmierung oder das
/// Eintreffen, mit dem ihre offene Periode beginnt, also genau das, was der Hinweis „alarmiert“
/// bzw. „eingetroffen“ gemeldet hat ([`alarmierung_tx`], [`eintreffen_tx`]), der Bezugstyp des
/// Hinweises „… gestrichen“ (LLH-1425); sonst `None`. Ein Nachtrag in eine abgeschlossene Periode
/// hat nichts gemeldet und streicht still. Nur lesend; ein Lesefehler lässt den Hinweis aus und
/// bricht nie die Streichung.
pub async fn vor_streichung_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
) -> Option<BenachrichtigungBezugTyp> {
    let (offen, typ) = match art {
        ZeitachseArt::Alarmierung => (
            crate::zeitachse::repo::offene_alarmierung_tx(conn, einheit_id).await,
            BenachrichtigungBezugTyp::AbloeserAlarmierungGestrichen,
        ),
        ZeitachseArt::Eintreffen => (
            crate::zeitachse::repo::offenes_eintreffen_tx(conn, einheit_id).await,
            BenachrichtigungBezugTyp::AbloeserEintreffenGestrichen,
        ),
        ZeitachseArt::Abloesung | ZeitachseArt::Entlassung => return None,
    };
    match offen {
        Ok(offen) => (offen.as_deref() == Some(zeitpunkt_at)).then_some(typ),
        Err(e) => {
            tracing::warn!(einheit_id, "Hinweis zur Streichung ausgelassen: {e}");
            None
        }
    }
}

/// Nach einem gestrichenen Ereignis an einer Einheit. Eine gestrichene Entlassung öffnet die mit
/// ihr beendete Schicht. War es der Beginn der offenen Periode (`hinweis` aus
/// [`vor_streichung_tx`]), geht je Schicht, die die Einheit als ablösende plant, der Hinweis
/// „Alarmierung/Eintreffen der ablösenden Einheit gestrichen“ hinaus (LLH-1425): der frühere
/// Hinweis „alarmiert“ bzw. „eingetroffen“ gilt nicht mehr.
pub async fn nach_streichung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
    hinweis: Option<BenachrichtigungBezugTyp>,
) -> Result<Wirkung, AppError> {
    let schritt = match (art, hinweis) {
        (ZeitachseArt::Entlassung, _) => Schritt::Wiederaufnahme,
        (_, Some(typ)) => Schritt::Gestrichen(typ),
        (_, None) => return Ok(Wirkung::default()),
    };
    isoliert(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        schritt,
        zeitpunkt_at,
    )
    .await
}

/// Was die Kopplung an der Schicht tut.
#[derive(Debug, Clone, Copy)]
enum Schritt {
    /// Nur der Hinweis „alarmiert“, keine Schicht.
    Alarmierung,
    /// `hinweis`: dazu der Hinweis „eingetroffen“.
    Autostart {
        hinweis: bool,
    },
    Ende,
    Wiederaufnahme,
    /// Nur der Hinweis „… gestrichen“ mit diesem Bezugstyp, keine Schicht.
    Gestrichen(BenachrichtigungBezugTyp),
}

/// Führt den Schritt in einem Savepoint aus. Ein Fehler darin rollt nur den Savepoint zurück und
/// wird geloggt (leeres Ergebnis); nur ein Fehler der Savepoint-Anweisungen selbst geht nach
/// oben, denn dann ist die Transaktion nicht mehr sicher.
async fn isoliert(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    schritt: Schritt,
    zeitpunkt_at: &str,
) -> Result<Wirkung, AppError> {
    sqlx::query(sqlx::AssertSqlSafe(format!("SAVEPOINT {SAVEPOINT}")))
        .execute(&mut *conn)
        .await?;
    let r = match schritt {
        Schritt::Alarmierung => {
            alarmierung_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await
        }
        Schritt::Autostart { hinweis } => {
            eintreffen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                einheit_id,
                zeitpunkt_at,
                hinweis,
            )
            .await
        }
        Schritt::Ende => end_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await,
        Schritt::Wiederaufnahme => {
            reopen_tx(conn, einsatz_id, benutzer_id, einheit_id, zeitpunkt_at).await
        }
        Schritt::Gestrichen(typ) => {
            hinweis::anlaesse_tx(conn, einsatz_id, einheit_id, typ, benutzer_id)
                .await
                .map(|anlaesse| Wirkung {
                    etb: Vec::new(),
                    anlaesse,
                })
        }
    };
    match r {
        Ok(wirkung) => {
            sqlx::query(sqlx::AssertSqlSafe(format!("RELEASE {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            Ok(wirkung)
        }
        Err(e) => {
            sqlx::query(sqlx::AssertSqlSafe(format!("ROLLBACK TO {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            sqlx::query(sqlx::AssertSqlSafe(format!("RELEASE {SAVEPOINT}")))
                .execute(&mut *conn)
                .await?;
            tracing::warn!(
                ?schritt,
                einheit_id,
                "Kopplung an die Ablösung ausgelassen: {e}"
            );
            Ok(Wirkung::default())
        }
    }
}

/// Alarmierung als Beginn der offenen Periode: je Schicht, die die Einheit als ablösende plant,
/// ein Hinweis „alarmiert“. Eine nachgetragene Alarmierung in eine abgeschlossene Periode meldet
/// nichts.
async fn alarmierung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    alarmierung_at: &str,
) -> Result<Wirkung, AppError> {
    let offen = crate::zeitachse::repo::offene_alarmierung_tx(conn, einheit_id).await?;
    if offen.as_deref() != Some(alarmierung_at) {
        return Ok(Wirkung::default());
    }
    Ok(Wirkung {
        etb: Vec::new(),
        anlaesse: hinweis::anlaesse_tx(
            conn,
            einsatz_id,
            einheit_id,
            BenachrichtigungBezugTyp::AbloeserAlarmiert,
            benutzer_id,
        )
        .await?,
    })
}

/// Eintreffen: Autostart der Schicht, dazu (mit `hinweis`) je Schicht, die die Einheit als
/// ablösende plant, ein Hinweis „eingetroffen“ — beides nur für das Eintreffen der offenen
/// Periode. Der Hinweis wird vor dem Autostart gebildet; der Autostart lässt eine geplante
/// Einheit ohnehin aus.
async fn eintreffen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    eintreffen_at: &str,
    hinweis: bool,
) -> Result<Wirkung, AppError> {
    let offen = crate::zeitachse::repo::offenes_eintreffen_tx(conn, einheit_id).await?;
    if offen.as_deref() != Some(eintreffen_at) {
        return Ok(Wirkung::default());
    }
    let anlaesse = if hinweis {
        hinweis::anlaesse_tx(
            conn,
            einsatz_id,
            einheit_id,
            BenachrichtigungBezugTyp::AbloeserEingetroffen,
            benutzer_id,
        )
        .await?
    } else {
        Vec::new()
    };
    Ok(Wirkung {
        etb: autostart_tx(conn, einsatz_id, benutzer_id, einheit_id, eintreffen_at).await?,
        anlaesse,
    })
}

/// Aktiv (nicht aufgelöst) und im Einsatz.
async fn is_aktiv_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(r.is_some())
}

/// Ob eine laufende Schicht des Einsatzes die Einheit oder einen ihrer Vorfahren als Ablöser
/// plant ([`hinweis::load_geplante_tx`]: Einzelplanung oder Eintrag der Liste
/// `einsatz_abloesung_abloeser`, LLH-1132). Der Vorfahr zählt mit, weil ein Verband als Knoten
/// ablöst: seine Untereinheiten erben die Folgeschicht, die der Vollzug ihm anlegt (LLH-1118
/// Punkt 1). Die Kette läuft mit Besucht-Menge, ein korrupter Zyklus terminiert.
async fn is_geplanter_abloeser_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
) -> Result<bool, AppError> {
    let mut besucht = std::collections::HashSet::new();
    let mut knoten = Some(einheit_id);
    while let Some(k) = knoten {
        if !besucht.insert(k) {
            break;
        }
        if !super::hinweis::load_geplante_tx(conn, einsatz_id, k)
            .await?
            .is_empty()
        {
            return Ok(true);
        }
        knoten = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(k)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
    }
    Ok(false)
}

async fn autostart_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    eintreffen_at: &str,
) -> Result<Vec<i64>, AppError> {
    // Nur das Eintreffen der offenen Periode (prüft [`eintreffen_tx`]): ein nachgetragenes in
    // eine abgeschlossene Periode beginnt keine Schicht.
    if !is_aktiv_tx(conn, einsatz_id, einheit_id).await? {
        return Ok(Vec::new());
    }
    // Eigene oder geerbte laufende Schicht: nichts anlegen (Knoten-Modell, LLH-1118).
    if repo::load_wirksamen_traeger_tx(conn, einsatz_id, einheit_id)
        .await?
        .is_some()
    {
        return Ok(Vec::new());
    }
    // Als Ablöser geplant (auch als Untereinheit eines geplanten Verbands): ihre Schicht beginnt
    // mit dem Vollzug als Folgeschicht. Ein ungeplant eingetroffener Ablöser bekommt hier seine
    // eigene, die der Vollzug dann übernimmt (LLH-1132).
    if is_geplanter_abloeser_tx(conn, einsatz_id, einheit_id).await? {
        return Ok(Vec::new());
    }
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let jetzt = crate::zeit::jetzt();
    let start = Start {
        einsatz_id,
        benutzer_id,
        startwert,
        einheit_id,
        beginn_at: eintreffen_at,
        rhythmus_minuten: None,
        wie: WIE_AUTOSTART,
    };
    Ok(repo::start_schicht_tx(conn, &start, &jetzt)
        .await?
        .map(|(_, etb_id)| etb_id)
        .into_iter()
        .collect())
}

async fn end_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
) -> Result<Wirkung, AppError> {
    // Nur eine Entlassung, nach der keine Periode mehr offen ist: eine in eine frühere Periode
    // nachgetragene lässt die laufende Schicht der späteren stehen.
    if crate::zeitachse::repo::has_offene_periode_tx(conn, einheit_id).await? {
        return Ok(Wirkung::default());
    }
    let jetzt = crate::zeit::jetzt();
    // Eine entlassene Einheit löst niemanden mehr ab (LLH-1131): ihre Planungen entfallen.
    let mut wirkung = repo::drop_planungen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        repo::Entfallen::Entlassung,
        &jetzt,
    )
    .await?;
    let Some((id, name)) = repo::load_laufende_tx(conn, einheit_id).await? else {
        return Ok(wirkung);
    };
    repo::end_schicht_tx(
        conn,
        id,
        benutzer_id,
        BeendetGrund::Entlassung,
        entlassung_at,
        &jetzt,
    )
    .await?;
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &format!("Ablösung: Schicht von «{name}» mit der Entlassung beendet"),
    )
    .await?;
    wirkung.etb.push(etb_id);
    Ok(wirkung)
}

async fn reopen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    entlassung_at: &str,
) -> Result<Wirkung, AppError> {
    let jetzt = crate::zeit::jetzt();
    let Some((_, name)) = repo::reopen_nach_entlassung_tx(
        conn,
        einsatz_id,
        benutzer_id,
        einheit_id,
        entlassung_at,
        &jetzt,
    )
    .await?
    else {
        return Ok(Wirkung::default());
    };
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, einsatz_id).await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &format!("Ablösung: Schicht von «{name}» läuft wieder, Entlassung gestrichen"),
    )
    .await?;
    Ok(Wirkung {
        etb: vec![etb_id],
        anlaesse: Vec::new(),
    })
}

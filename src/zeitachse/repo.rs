//! Persistenz der Kräfte-Zeitachse (LFH-552).
//!
//! **Append-only:** außer der Streichung (die drei `gestrichen_*`-Spalten plus `streichgrund`,
//! einmalig per `WHERE gestrichen_at IS NULL`) schreibt dieses Repo kein UPDATE und kein
//! DELETE. Der Guard `repo_ist_append_only` liest diese Datei.
//!
//! **Alles läuft auf einer offenen Transaktion** (`…_tx`): Statuswechsel, Nachtrag, Vollzug der
//! Ablösung und Streichung schreiben die Zeitachse im selben Commit wie ihr Anlass. Ein
//! Ereignis an einer Einheit schreibt den Fan-out auf ihre Personen immer mit
//! ([`schreibe_tx`]).

use chrono_tz::Tz;
use sqlx::{SqliteConnection, SqlitePool};

use super::perioden::{self, Ereignis, Verstoss};
use super::{
    EinheitPerioden, PersonPerioden, ZeitachseAnzeige, ZeitachseArt, ZeitachseEreignis,
    ZeitachseMarke, ZeitachseQuelle,
};
use crate::error::AppError;

/// Die Kraft, der ein Ereignis gehört.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kraft {
    /// `einsatz_einheit.id`
    Einheit(i64),
    /// `einsatz_personal.id`
    Person(i64),
}

impl Kraft {
    fn spalte(self) -> &'static str {
        match self {
            Kraft::Einheit(_) => "einheit_id",
            Kraft::Person(_) => "personal_id",
        }
    }

    fn id(self) -> i64 {
        match self {
            Kraft::Einheit(id) | Kraft::Person(id) => id,
        }
    }
}

/// Ergebnis eines Schreibversuchs. `Ausgelassen` trägt den Verstoß: der Statuswechsel
/// verschluckt ihn, der Nachtrag macht daraus eine 422.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Schreibergebnis {
    Geschrieben(i64),
    Ausgelassen(Verstoss),
}

/// Was ein Schreibvorgang außer der Kraft selbst noch berührt hat — für die Live-Events.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Beruehrt {
    pub personen: Vec<i64>,
}

// ── Lesen innerhalb der Transaktion ─────────────────────────────────────────────────────────

/// Nicht gestrichene Ereignisse einer Kraft.
async fn bestand_tx(conn: &mut SqliteConnection, kraft: Kraft) -> Result<Vec<Ereignis>, AppError> {
    let zeilen: Vec<(i64, String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT id, art, zeitpunkt_at FROM einsatz_kraft_zeitachse \
         WHERE {} = ? AND gestrichen_at IS NULL",
        kraft.spalte()
    )))
    .bind(kraft.id())
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(id, art, zeitpunkt_at)| {
            ZeitachseArt::parse(&art).map(|art| Ereignis {
                id,
                art,
                zeitpunkt_at,
            })
        })
        .collect())
}

/// `NotFound`, wenn die Kraft nicht zum Einsatz gehört. Liefert ihren Namen für ETB-Texte.
pub async fn kraft_name_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kraft: Kraft,
) -> Result<String, AppError> {
    let name: Option<String> = match kraft {
        Kraft::Einheit(id) => {
            sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
                .bind(id)
                .bind(einsatz_id)
                .fetch_optional(&mut *conn)
                .await?
        }
        Kraft::Person(id) => {
            sqlx::query_scalar(
                "SELECT COALESCE(p.name, ep.snap_name) FROM einsatz_personal ep \
                 LEFT JOIN personal p ON p.id = ep.personal_id \
                 WHERE ep.id = ? AND ep.einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?
        }
    };
    name.ok_or(AppError::NotFound)
}

// ── Schreiben ───────────────────────────────────────────────────────────────────────────────

/// Eingabe eines Ereignisses.
#[derive(Debug, Clone, Copy)]
pub struct Neu<'a> {
    pub art: ZeitachseArt,
    pub zeitpunkt_at: &'a str,
    pub quelle: ZeitachseQuelle,
    pub notiz: Option<&'a str>,
}

/// Schreibt ein Ereignis, wenn es die Perioden-Regeln der Kraft wahrt. An einer Einheit folgt
/// in derselben Transaktion der Fan-out auf die Personen, die ihr JETZT zugeordnet sind (Quelle
/// `einheit`, `ursprung_id`); für eine Person, deren Regeln es verletzen würde, wird es
/// ausgelassen. Die Kraft muss zum Einsatz gehören (sonst `NotFound`).
pub async fn schreibe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    neu: Neu<'_>,
) -> Result<(Schreibergebnis, Beruehrt), AppError> {
    kraft_name_tx(conn, einsatz_id, kraft).await?;
    let ergebnis = schreibe_einzeln_tx(conn, einsatz_id, benutzer_id, kraft, neu, None).await?;
    let mut beruehrt = Beruehrt::default();
    if let (Kraft::Einheit(einheit_id), Schreibergebnis::Geschrieben(ursprung)) = (kraft, &ergebnis)
    {
        let personen: Vec<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_personal WHERE einsatz_id = ? AND einheit_id = ? ORDER BY id",
        )
        .bind(einsatz_id)
        .bind(einheit_id)
        .fetch_all(&mut *conn)
        .await?;
        for person in personen {
            let kopie = Neu {
                quelle: ZeitachseQuelle::Einheit,
                notiz: None,
                ..neu
            };
            let r = schreibe_einzeln_tx(
                conn,
                einsatz_id,
                benutzer_id,
                Kraft::Person(person),
                kopie,
                Some(*ursprung),
            )
            .await?;
            if matches!(r, Schreibergebnis::Geschrieben(_)) {
                beruehrt.personen.push(person);
            }
        }
    }
    Ok((ergebnis, beruehrt))
}

async fn schreibe_einzeln_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    neu: Neu<'_>,
    ursprung_id: Option<i64>,
) -> Result<Schreibergebnis, AppError> {
    let bestand = bestand_tx(conn, kraft).await?;
    if let Err(v) = perioden::pruefe_einfuegen(&bestand, neu.art, neu.zeitpunkt_at) {
        return Ok(Schreibergebnis::Ausgelassen(v));
    }
    let (einheit_id, personal_id) = match kraft {
        Kraft::Einheit(id) => (Some(id), None),
        Kraft::Person(id) => (None, Some(id)),
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_kraft_zeitachse \
            (einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, ursprung_id, notiz, \
             erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .bind(personal_id)
    .bind(neu.art.as_str())
    .bind(neu.zeitpunkt_at)
    .bind(neu.quelle.as_str())
    .bind(ursprung_id)
    .bind(neu.notiz)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(Schreibergebnis::Geschrieben(id))
}

/// Ein gestrichenes Ereignis samt Fan-out-Kette.
#[derive(Debug, Clone)]
pub struct Gestrichen {
    pub art: ZeitachseArt,
    pub zeitpunkt_at: String,
    pub beruehrt: Beruehrt,
}

/// Streicht ein Ereignis der Kraft samt allen noch nicht gestrichenen Fan-out-Kopien. Prüfung
/// (Spec „Streichung"): fremdes Ereignis → 404; schon gestrichen → 422; Quelle `abloesung` ohne
/// `durch_ruecknahme` → 422; ein Rest, der die Perioden-Regeln der Kraft oder einer betroffenen
/// Person verletzt → 422 (mit Namen der Person).
pub async fn streiche_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    kraft: Kraft,
    id: i64,
    grund: &str,
    durch_ruecknahme: bool,
) -> Result<Gestrichen, AppError> {
    let zeile: Option<(String, String, String, Option<String>)> =
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT art, zeitpunkt_at, quelle, gestrichen_at FROM einsatz_kraft_zeitachse \
             WHERE id = ? AND einsatz_id = ? AND {} = ?",
            kraft.spalte()
        )))
        .bind(id)
        .bind(einsatz_id)
        .bind(kraft.id())
        .fetch_optional(&mut *conn)
        .await?;
    let (art, zeitpunkt_at, quelle, gestrichen_at) = zeile.ok_or(AppError::NotFound)?;
    let art = ZeitachseArt::parse(&art)
        .ok_or_else(|| AppError::Internal(format!("Unbekannte Zeitachsen-Art '{art}'")))?;
    if gestrichen_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Das Ereignis ist bereits gestrichen".into(),
        ));
    }
    if quelle == ZeitachseQuelle::Abloesung.as_str() && !durch_ruecknahme {
        return Err(AppError::UnprocessableEntity(
            "Ein Ereignis aus dem Vollzug einer Ablösung lässt sich nur über die Rücknahme des Vollzugs streichen"
                .into(),
        ));
    }

    let bestand = bestand_tx(conn, kraft).await?;
    perioden::pruefe_streichen(&bestand, &[id])
        .map_err(|v| AppError::UnprocessableEntity(v.to_string()))?;

    // Fan-out-Kopien: je Person einzeln prüfen, bevor irgendetwas geschrieben wird.
    let kopien: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT id, personal_id FROM einsatz_kraft_zeitachse \
         WHERE ursprung_id = ? AND gestrichen_at IS NULL AND personal_id IS NOT NULL",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    for (kopie, person) in &kopien {
        let bestand = bestand_tx(conn, Kraft::Person(*person)).await?;
        if let Err(v) = perioden::pruefe_streichen(&bestand, &[*kopie]) {
            let name = kraft_name_tx(conn, einsatz_id, Kraft::Person(*person)).await?;
            return Err(AppError::UnprocessableEntity(format!(
                "Die Zeitachse von «{name}» verlöre ihre Ordnung: {v}"
            )));
        }
    }

    let mut ids = vec![id];
    ids.extend(kopien.iter().map(|(k, _)| *k));
    for i in &ids {
        sqlx::query(
            "UPDATE einsatz_kraft_zeitachse \
             SET gestrichen_at = datetime('now'), gestrichen_von = ?, streichgrund = ? \
             WHERE id = ? AND gestrichen_at IS NULL",
        )
        .bind(benutzer_id)
        .bind(grund)
        .bind(i)
        .execute(&mut *conn)
        .await?;
    }
    Ok(Gestrichen {
        art,
        zeitpunkt_at,
        beruehrt: Beruehrt {
            personen: kopien.into_iter().map(|(_, p)| p).collect(),
        },
    })
}

// ── Aus Statuswechseln ──────────────────────────────────────────────────────────────────────

async fn marke_tx(
    conn: &mut SqliteConnection,
    tabelle: &str,
    status_id: i64,
) -> Result<Option<ZeitachseMarke>, AppError> {
    let marke: Option<Option<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT zeitachse_marke FROM {tabelle} WHERE id = ?"
    )))
    .bind(status_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(marke.flatten().as_deref().and_then(ZeitachseMarke::parse))
}

/// Eine Person hat auf `status_id` gewechselt (auch bei der Disposition). Trägt der Status eine
/// Marke, entsteht das Ereignis; ein Verstoß wird verschluckt — der Statuswechsel gelingt
/// immer (Spec „Ereignis aus einem Statuswechsel").
pub async fn aus_personalstatus_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    ep_id: i64,
    status_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let Some(marke) = marke_tx(conn, "personal_status", status_id).await? else {
        return Ok(false);
    };
    let (r, _) = schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        Kraft::Person(ep_id),
        Neu {
            art: marke.art(),
            zeitpunkt_at: jetzt,
            quelle: ZeitachseQuelle::Status,
            notiz: None,
        },
    )
    .await?;
    Ok(matches!(r, Schreibergebnis::Geschrieben(_)))
}

/// Ein Fahrzeug hat auf `status_id` gewechselt. Wirkt nur über seine Einheit: Alarmierung und
/// Eintreffen mit dem ersten Fahrzeug (die offene Periode trägt die Art dann schon, das zweite
/// wird ausgelassen), die Entlassung erst, wenn danach ALLE Fahrzeuge der Einheit einen Status
/// mit dieser Marke tragen. Ohne Einheit: nichts. Liefert die berührten Personen, wenn an der
/// Einheit etwas geschrieben wurde.
pub async fn aus_fahrzeugstatus_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    ef_id: i64,
    status_id: i64,
    jetzt: &str,
) -> Result<Option<(i64, Beruehrt)>, AppError> {
    let Some(marke) = marke_tx(conn, "fahrzeug_status", status_id).await? else {
        return Ok(None);
    };
    let einheit_id: Option<i64> = sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    let Some(einheit_id) = einheit_id else {
        return Ok(None);
    };
    if marke == ZeitachseMarke::Entlassung {
        let offen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_fahrzeug f \
             LEFT JOIN fahrzeug_status s ON s.id = f.status_id \
             WHERE f.einheit_id = ? AND s.zeitachse_marke IS NOT 'entlassung'",
        )
        .bind(einheit_id)
        .fetch_one(&mut *conn)
        .await?;
        if offen > 0 {
            return Ok(None);
        }
    }
    einheit_ereignis(conn, einsatz_id, benutzer_id, einheit_id, marke, jetzt).await
}

/// Handstatus einer Einheit ohne Fahrzeug: wirkt wie ein Wechsel an der Einheit selbst.
pub async fn aus_einheit_handstatus_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    status_id: i64,
    jetzt: &str,
) -> Result<Option<(i64, Beruehrt)>, AppError> {
    let Some(marke) = marke_tx(conn, "fahrzeug_status", status_id).await? else {
        return Ok(None);
    };
    einheit_ereignis(conn, einsatz_id, benutzer_id, einheit_id, marke, jetzt).await
}

async fn einheit_ereignis(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    marke: ZeitachseMarke,
    jetzt: &str,
) -> Result<Option<(i64, Beruehrt)>, AppError> {
    let (r, beruehrt) = schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        Kraft::Einheit(einheit_id),
        Neu {
            art: marke.art(),
            zeitpunkt_at: jetzt,
            quelle: ZeitachseQuelle::Status,
            notiz: None,
        },
    )
    .await?;
    Ok(match r {
        Schreibergebnis::Geschrieben(_) => Some((einheit_id, beruehrt)),
        Schreibergebnis::Ausgelassen(_) => None,
    })
}

// ── Kopplung an die Ablösung (LFH-635) ──────────────────────────────────────────────────────

/// Das nicht gestrichene Eintreffen der offenen Periode einer Einheit (Beginn einer neuen
/// Schicht ohne Beginn, MODIFIED `kraefte-abloesung`).
pub async fn offenes_eintreffen_tx(
    conn: &mut SqliteConnection,
    einheit_id: i64,
) -> Result<Option<String>, AppError> {
    let bestand = bestand_tx(conn, Kraft::Einheit(einheit_id)).await?;
    let p = perioden::bilde_nachsichtig(&bestand);
    Ok(perioden::offenes_eintreffen(&p).map(str::to_string))
}

/// Vollzug einer Ablösung: Ereignis `abloesung` an der abgelösten Einheit samt Fan-out. Ohne
/// offene Periode wird es ausgelassen, der Vollzug gelingt trotzdem.
pub async fn abloesung_vollzogen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    vollzogen_at: &str,
) -> Result<(), AppError> {
    schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        Kraft::Einheit(einheit_id),
        Neu {
            art: ZeitachseArt::Abloesung,
            zeitpunkt_at: vollzogen_at,
            quelle: ZeitachseQuelle::Abloesung,
            notiz: None,
        },
    )
    .await?;
    Ok(())
}

/// Grund der Streichung bei der Rücknahme eines Vollzugs.
pub const GRUND_ABLOESUNG_ZURUECK: &str = "Ablösung zurückgenommen";

/// Rücknahme eines Vollzugs: streicht das Ablösungsereignis zum Vollzugszeitpunkt samt
/// Fan-out. Gefunden wird es über Einheit, Quelle und Zeitpunkt — eindeutig, weil je Einheit
/// höchstens eine Schicht läuft (design.md D5). Gibt es keins (Vollzug ohne Periode), passiert
/// nichts.
pub async fn abloesung_zurueckgenommen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    einheit_id: i64,
    vollzogen_at: &str,
) -> Result<(), AppError> {
    let id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM einsatz_kraft_zeitachse \
         WHERE einheit_id = ? AND quelle = 'abloesung' AND art = 'abloesung' \
           AND zeitpunkt_at = ? AND gestrichen_at IS NULL \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einheit_id)
    .bind(vollzogen_at)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(id) = id {
        streiche_tx(
            conn,
            einsatz_id,
            benutzer_id,
            Kraft::Einheit(einheit_id),
            id,
            GRUND_ABLOESUNG_ZURUECK,
            true,
        )
        .await?;
    }
    Ok(())
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    #[sqlx(try_from = "String")]
    art: ZeitachseArt,
    zeitpunkt_at: String,
    #[sqlx(try_from = "String")]
    quelle: ZeitachseQuelle,
    ursprung_id: Option<i64>,
    ursprung_einheit_name: Option<String>,
    notiz: Option<String>,
    erfasst_von: i64,
    erfasst_at: String,
    gestrichen_at: Option<String>,
    gestrichen_von: Option<i64>,
    streichgrund: Option<String>,
}

/// Zeitachse einer Kraft: Ereignisse nach `(zeitpunkt, id)`, gestrichene eingeschlossen, und die
/// Perioden der nicht gestrichenen. `NotFound`, wenn die Kraft nicht zum Einsatz gehört.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    kraft: Kraft,
) -> Result<ZeitachseAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    kraft_name_tx(&mut conn, einsatz_id, kraft).await?;
    let zeilen: Vec<Zeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT z.id, z.art, z.zeitpunkt_at, z.quelle, z.ursprung_id, \
                ue.name AS ursprung_einheit_name, z.notiz, z.erfasst_von, z.erfasst_at, \
                z.gestrichen_at, z.gestrichen_von, z.streichgrund \
         FROM einsatz_kraft_zeitachse z \
         LEFT JOIN einsatz_kraft_zeitachse u ON u.id = z.ursprung_id \
         LEFT JOIN einsatz_einheit ue ON ue.id = u.einheit_id \
         WHERE z.einsatz_id = ? AND z.{} = ? \
         ORDER BY z.zeitpunkt_at, z.id",
        kraft.spalte()
    )))
    .bind(einsatz_id)
    .bind(kraft.id())
    .fetch_all(&mut *conn)
    .await?;
    let gueltig: Vec<Ereignis> = zeilen
        .iter()
        .filter(|z| z.gestrichen_at.is_none())
        .map(|z| Ereignis {
            id: z.id,
            art: z.art,
            zeitpunkt_at: z.zeitpunkt_at.clone(),
        })
        .collect();
    let perioden = perioden::bilde_nachsichtig(&gueltig);
    let ereignisse = zeilen
        .into_iter()
        .map(|z| ZeitachseEreignis {
            id: z.id,
            art: z.art,
            zeitpunkt_at: z.zeitpunkt_at,
            quelle: z.quelle,
            ursprung_id: z.ursprung_id,
            ursprung_einheit_name: z.ursprung_einheit_name,
            notiz: z.notiz,
            erfasst_von: z.erfasst_von,
            erfasst_at: z.erfasst_at,
            gestrichen_at: z.gestrichen_at,
            gestrichen_von: z.gestrichen_von,
            streichgrund: z.streichgrund,
        })
        .collect();
    Ok(ZeitachseAnzeige {
        ereignisse,
        perioden,
    })
}

/// Nicht gestrichene Ereignisse aller Kräfte einer Spalte, gruppiert nach Kraft-ID.
async fn gruppiert(
    pool: &SqlitePool,
    einsatz_id: i64,
    spalte: &str,
) -> Result<Vec<(i64, Vec<Ereignis>)>, AppError> {
    let zeilen: Vec<(i64, i64, String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {spalte}, id, art, zeitpunkt_at FROM einsatz_kraft_zeitachse \
         WHERE einsatz_id = ? AND {spalte} IS NOT NULL AND gestrichen_at IS NULL \
         ORDER BY {spalte}, zeitpunkt_at, id"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut gruppen: Vec<(i64, Vec<Ereignis>)> = Vec::new();
    for (kraft, id, art, zeitpunkt_at) in zeilen {
        let Some(art) = ZeitachseArt::parse(&art) else {
            continue;
        };
        let e = Ereignis {
            id,
            art,
            zeitpunkt_at,
        };
        match gruppen.last_mut() {
            Some((k, v)) if *k == kraft => v.push(e),
            _ => gruppen.push((kraft, vec![e])),
        }
    }
    Ok(gruppen)
}

/// Perioden je Einheit des Einsatzes (nur Einheiten mit Ereignissen) — für das Meldebild.
pub async fn perioden_einheiten(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<EinheitPerioden>, AppError> {
    Ok(gruppiert(pool, einsatz_id, "einheit_id")
        .await?
        .into_iter()
        .map(|(einheit_id, folge)| EinheitPerioden {
            einheit_id,
            perioden: perioden::bilde_nachsichtig(&folge),
        })
        .collect())
}

/// Perioden je Person des Einsatzes (nur Personen mit Ereignissen) — für die Personal-Seite.
pub async fn perioden_personal(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<PersonPerioden>, AppError> {
    Ok(gruppiert(pool, einsatz_id, "personal_id")
        .await?
        .into_iter()
        .map(|(personal_id, folge)| PersonPerioden {
            personal_id,
            perioden: perioden::bilde_nachsichtig(&folge),
        })
        .collect())
}

// ── ETB-Texte ───────────────────────────────────────────────────────────────────────────────

/// Zeitpunkt als ETB-Text in der Org-Zone: „30.09. 06:40". Unparsbares erscheint roh.
pub fn zeit_text(zeitpunkt_at: &str, tz: Tz) -> String {
    match crate::zeit::parse_utc(zeitpunkt_at) {
        Some(t) => t.with_timezone(&tz).format("%d.%m. %H:%M").to_string(),
        None => zeitpunkt_at.to_string(),
    }
}

/// „Einheit «Florian 1» eingetroffen 30.09. 06:40 (nachgetragen)"
pub fn etb_text_nachtrag(
    kraft: Kraft,
    name: &str,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
    tz: Tz,
) -> String {
    format!(
        "Zeitachse: {} «{name}» {} {} (nachgetragen)",
        kraft_wort(kraft),
        art.partizip(),
        zeit_text(zeitpunkt_at, tz)
    )
}

/// „Zeitachse: Einheit «Florian 1» eingetroffen 30.09. 06:40 gestrichen — Grund: …"
pub fn etb_text_streichung(
    kraft: Kraft,
    name: &str,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
    grund: &str,
    tz: Tz,
) -> String {
    format!(
        "Zeitachse: {} «{name}» {} {} gestrichen — Grund: {grund}",
        kraft_wort(kraft),
        art.partizip(),
        zeit_text(zeitpunkt_at, tz)
    )
}

fn kraft_wort(kraft: Kraft) -> &'static str {
    match kraft {
        Kraft::Einheit(_) => "Einheit",
        Kraft::Person(_) => "Person",
    }
}

#[cfg(test)]
mod tests;

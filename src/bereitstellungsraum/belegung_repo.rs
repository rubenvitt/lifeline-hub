use super::{
    repo, BrBelegungAnzeige, BrBelegungKennzahlen, BrBelegungsArt, BrStatus, BrVerlaufArt,
    BrVerlaufEintrag, ObjektTyp,
};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, erfasst_von \
    FROM br_belegung";

/// Eine Belegungsbuchung ohne Objekt und Raum: Art, Notiz und – für das Eintreffen (LLH-1075,
/// design.md D8) – der Idempotenzschlüssel der Offline-Warteschlange und der vorgemerkte
/// Erfassungszeitpunkt. Ohne Zeitpunkt gilt die Spaltenvorgabe „jetzt“.
#[derive(Debug, Clone, Copy)]
pub struct Buchung<'a> {
    pub art: BrBelegungsArt,
    pub notiz: Option<&'a str>,
    pub client_id: Option<&'a str>,
    pub zeitpunkt_at: Option<&'a str>,
}

/// Bucht ein Objekt (Einheit oder Fahrzeug) in einen Bereitstellungsraum ein,
/// aus einem wechselt oder aus einem aus. Pool-Hülle um [`belege_tx`] in EINER
/// Transaktion (`write_retry!`).
///
/// # Regeln (in Reihenfolge)
/// 1. `objekt_typ` unbekannt → `Validation`
/// 2. `art` unbekannt → `Validation`
/// 3. ab hier [`belege_tx`]
#[allow(clippy::too_many_arguments)]
pub async fn belege(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: i64,
    objekt_typ: &str,
    objekt_id: i64,
    art: &str,
    notiz: Option<&str>,
    benutzer_id: i64,
) -> Result<BrBelegungAnzeige, AppError> {
    // 1. Objekt-Typ parsen
    let typ = ObjektTyp::parse(objekt_typ)
        .ok_or_else(|| AppError::Validation(format!("Unbekannter objekt_typ: '{objekt_typ}'")))?;

    // 2. Art parsen
    let belegungs_art = BrBelegungsArt::parse(art)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte art: '{art}'")))?;

    let buchung = Buchung {
        art: belegungs_art,
        notiz,
        client_id: None,
        zeitpunkt_at: None,
    };
    // read-then-write-Atomizität in einer Transaktion (F09: BEGIN IMMEDIATE + Retry)
    let event_id = crate::write_retry!(pool, |conn| {
        belege_tx(
            &mut *conn,
            einsatz_id,
            br_id,
            typ,
            objekt_id,
            &buchung,
            benutzer_id,
        )
        .await
    })?;
    laden(pool, einsatz_id, event_id).await
}

/// Rumpf von [`belege`] in der Transaktion des Aufrufers (LLH-1075, design.md D2 Schritt 3):
/// frei von Zeitachse und ETB, damit Eintreffen (LLH-1075) und Vollzug einer Ablösung
/// (LLH-1132) ihn in ihre eigene Transaktion legen. Liefert die id der Belegungszeile.
///
/// # Regeln (in Reihenfolge)
/// 1. Ziel-BR muss zum Einsatz gehören (`NotFound`), `aktiv` und nicht storniert sein
///    (`UnprocessableEntity`) – in der Transaktion, gegen das Rennen mit „Auflösen“
/// 2. Objekt muss im selben Einsatz existieren und aktiv sein → `NotFound` / `Conflict`
/// 3. `fahrzeug`: `einheit_id` nicht NULL → `Conflict`
/// 4. Art-Vorbedingung: `eintritt` → `aktueller_br_id` muss NULL; `wechsel`/`austritt` → muss
///    gesetzt sein
/// 5. Event-Insert + Cache-Update
pub async fn belege_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    typ: ObjektTyp,
    objekt_id: i64,
    buchung: &Buchung<'_>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    fordere_belegbar_tx(&mut *conn, einsatz_id, br_id).await?;
    match typ {
        ObjektTyp::Einheit => {
            belege_einheit(
                &mut *conn,
                einsatz_id,
                br_id,
                objekt_id,
                buchung,
                benutzer_id,
            )
            .await
        }
        ObjektTyp::Fahrzeug => {
            belege_fahrzeug(
                &mut *conn,
                einsatz_id,
                br_id,
                objekt_id,
                buchung,
                benutzer_id,
            )
            .await
        }
    }
}

/// Lädt den Raum in der Transaktion und verlangt „aktiv, nicht storniert“: fremd → `NotFound`,
/// sonst `UnprocessableEntity` (422). `repo::laden_tx` liefert auch stornierte BRs; ein
/// stornierter BR behält `status='aktiv'` (storniere setzt nur `storniert_at`), daher zusätzlich
/// `storniert_at IS NULL` fordern — analog UHS (`pruefe_uhs_aktiv`).
pub async fn fordere_belegbar_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
) -> Result<super::BrAnzeige, AppError> {
    let br = repo::laden_tx(&mut *conn, einsatz_id, br_id).await?;
    if br.status != BrStatus::Aktiv || br.storniert_at.is_some() {
        return Err(AppError::UnprocessableEntity(format!(
            "Bereitstellungsraum hat Status '{}' — Belegung nur bei aktivem BR möglich",
            br.status.as_str()
        )));
    }
    Ok(br)
}

/// Belegungszeile mit dem Idempotenzschlüssel `client_id` im Einsatz (LLH-1075, design.md D8),
/// für den Replay vor allen Zustandsprüfungen.
pub async fn mit_client_id(
    pool: &SqlitePool,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<BrBelegungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, BrBelegungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_ALLE} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(pool)
        .await?,
    )
}

/// Lädt ein einzelnes Belegungs-Event; `NotFound` außerhalb des Einsatzes.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<BrBelegungAnzeige, AppError> {
    sqlx::query_as::<_, BrBelegungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Auflösen einer Einheit (LLH-1079, design.md D4): steht sie in einem Bereitstellungsraum,
/// schreibt die Auflösung den Austritt (Notiz „Einheit aufgelöst“) und leert den Cache, statt
/// die Belegung still verwaisen zu lassen. Liefert den verlassenen Raum.
pub async fn austritt_bei_aufloesung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
) -> Result<Option<i64>, AppError> {
    let br_id: Option<i64> = sqlx::query_scalar(
        "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    let Some(br_id) = br_id else {
        return Ok(None);
    };
    insert_event(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Einheit,
        einheit_id,
        &BrBelegungsArt::Austritt,
        Some("Einheit aufgelöst"),
        benutzer_id,
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_einheit SET aktueller_br_id = NULL WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(Some(br_id))
}

/// Schreibt beim Entlassen eines Fahrzeugs den Austritt aus seinem Bereitstellungsraum und leert
/// den Cache (LLH-1079, design.md D4), in der Transaktion des Aufrufers. Liefert den Raum, aus
/// dem es ausgetreten ist, oder `None`, wenn es in keinem stand.
pub async fn austritt_fahrzeug_bei_entlassung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
) -> Result<Option<i64>, AppError> {
    let br_id: Option<i64> = sqlx::query_scalar(
        "SELECT aktueller_br_id FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    let Some(br_id) = br_id else {
        return Ok(None);
    };
    insert_event(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Fahrzeug,
        ef_id,
        &BrBelegungsArt::Austritt,
        Some("Fahrzeug entlassen"),
        benutzer_id,
    )
    .await?;
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET aktueller_br_id = NULL WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(Some(br_id))
}

// ─── Lesen: Wartezeit, Kennzahlen, Verlauf (LLH-1095) ───────────────────────

/// Jüngstes Belegungsereignis eines Objekts, das gerade in einem Raum steht (LLH-1095,
/// design.md D3). „Jüngst“ heißt größte `id`, nicht `zeitpunkt_at`: das löst nur Sekunden auf.
/// Baustein auch für LLH-1085 („abgerufen“) und LLH-1107.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LetztesEreignis {
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    /// Raum, in dem das Objekt laut Cache steht (`aktueller_br_id`).
    pub aktueller_br_id: i64,
    /// Raum des jüngsten Ereignisses.
    pub br_id: i64,
    pub art: BrBelegungsArt,
    pub zeitpunkt_at: String,
}

impl LetztesEreignis {
    /// „Seit“ (Spec `bereitstellungsraum-belegung`, „Wartezeit je Kraft im Raum“): nur wenn das
    /// jüngste Ereignis ein Eintritt oder Wechsel in genau den Raum ist, in dem das Objekt steht.
    /// Sonst (Bestand ohne Ereignis, Demo, inkonsistenter Cache) keine Schätzung.
    pub fn seit_at(&self) -> Option<&str> {
        let herein = matches!(self.art, BrBelegungsArt::Eintritt | BrBelegungsArt::Wechsel);
        (herein && self.br_id == self.aktueller_br_id).then_some(self.zeitpunkt_at.as_str())
    }
}

/// Je Objekt, das gerade in einem Raum des Einsatzes steht (`br_id = None`) bzw. in genau diesem
/// Raum (`Some`), sein jüngstes Belegungsereignis. EINE Abfrage, getrieben von den Objekten im
/// Raum, damit `idx_br_belegung_objekt` greift (`br_belegung` hat keinen Index auf
/// `einsatz_id`). Ein Objekt ohne jedes Ereignis fehlt in der Antwort.
pub async fn letztes_je_objekt(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: Option<i64>,
) -> Result<Vec<LetztesEreignis>, AppError> {
    let zeilen: Vec<(String, i64, i64, i64, String, String)> = sqlx::query_as(
        "SELECT 'einheit', e.id, e.aktueller_br_id, b.br_id, b.art, b.zeitpunkt_at \
         FROM einsatz_einheit e \
         JOIN br_belegung b ON b.id = ( \
             SELECT MAX(x.id) FROM br_belegung x \
             WHERE x.objekt_typ = 'einheit' AND x.objekt_id = e.id \
               AND x.einsatz_id = e.einsatz_id) \
         WHERE e.einsatz_id = ?1 AND e.aktueller_br_id IS NOT NULL \
           AND e.aufgeloest_at IS NULL AND (?2 IS NULL OR e.aktueller_br_id = ?2) \
         UNION ALL \
         SELECT 'fahrzeug', f.id, f.aktueller_br_id, b.br_id, b.art, b.zeitpunkt_at \
         FROM einsatz_fahrzeug f \
         JOIN br_belegung b ON b.id = ( \
             SELECT MAX(x.id) FROM br_belegung x \
             WHERE x.objekt_typ = 'fahrzeug' AND x.objekt_id = f.id \
               AND x.einsatz_id = f.einsatz_id) \
         WHERE f.einsatz_id = ?1 AND f.aktueller_br_id IS NOT NULL \
           AND f.beendet_at IS NULL AND (?2 IS NULL OR f.aktueller_br_id = ?2)",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .fetch_all(pool)
    .await?;
    zeilen
        .into_iter()
        .map(
            |(typ, objekt_id, aktueller_br_id, br_id, art, zeitpunkt_at)| {
                Ok(LetztesEreignis {
                    objekt_typ: ObjektTyp::try_from(typ).map_err(AppError::Internal)?,
                    objekt_id,
                    aktueller_br_id,
                    br_id,
                    art: BrBelegungsArt::try_from(art).map_err(AppError::Internal)?,
                    zeitpunkt_at,
                })
            },
        )
        .collect()
}

/// Kennzahlen der Belegung je Raum (LLH-1095, design.md D1/D2): Einheiten, Fahrzeuge (verschieden,
/// einheitenlose und die der Einheiten im Raum) und frühestes „seit“. `br_id = None` für alle Räume
/// des Einsatzes (Liste), `Some` für einen (Detail); je Kennzahlart EINE Abfrage, unabhängig von
/// der Zahl der Räume. Ein Raum ohne Belegung fehlt in der Karte (Kennzahlen `Default`).
pub async fn kennzahlen_je_raum(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: Option<i64>,
) -> Result<HashMap<i64, BrBelegungKennzahlen>, AppError> {
    let letzte = letztes_je_objekt(pool, einsatz_id, br_id).await?;
    kennzahlen_aus(pool, einsatz_id, br_id, &letzte).await
}

/// Wie [`kennzahlen_je_raum`] mit schon geladenem [`letztes_je_objekt`] desselben Zuschnitts
/// (das Detail braucht die Ereignisse ohnehin für „seit“ je Zeile).
pub async fn kennzahlen_aus(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: Option<i64>,
    letzte: &[LetztesEreignis],
) -> Result<HashMap<i64, BrBelegungKennzahlen>, AppError> {
    let mut karte: HashMap<i64, BrBelegungKennzahlen> = HashMap::new();
    let einheiten: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT aktueller_br_id, COUNT(*) FROM einsatz_einheit \
         WHERE einsatz_id = ?1 AND aktueller_br_id IS NOT NULL AND aufgeloest_at IS NULL \
           AND (?2 IS NULL OR aktueller_br_id = ?2) \
         GROUP BY aktueller_br_id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .fetch_all(pool)
    .await?;
    for (raum, zahl) in einheiten {
        karte.entry(raum).or_default().einheiten = zahl;
    }
    // D2: Vereinigung aus (a) einheitenlosen Fahrzeugen im Raum und (b) aktiven Fahrzeugen der
    // Einheiten im Raum; `DISTINCT` hält ein doppelt geführtes Fahrzeug (Scope-Frage 6) einfach.
    let fahrzeuge: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT br_id, COUNT(DISTINCT ef_id) FROM ( \
             SELECT f.aktueller_br_id AS br_id, f.id AS ef_id FROM einsatz_fahrzeug f \
             WHERE f.einsatz_id = ?1 AND f.aktueller_br_id IS NOT NULL \
               AND f.beendet_at IS NULL AND (?2 IS NULL OR f.aktueller_br_id = ?2) \
             UNION ALL \
             SELECT e.aktueller_br_id AS br_id, f.id AS ef_id \
             FROM einsatz_einheit e JOIN einsatz_fahrzeug f ON f.einheit_id = e.id \
             WHERE e.einsatz_id = ?1 AND f.einsatz_id = ?1 AND e.aktueller_br_id IS NOT NULL \
               AND e.aufgeloest_at IS NULL AND f.beendet_at IS NULL \
               AND (?2 IS NULL OR e.aktueller_br_id = ?2)) \
         GROUP BY br_id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .fetch_all(pool)
    .await?;
    for (raum, zahl) in fahrzeuge {
        karte.entry(raum).or_default().fahrzeuge = zahl;
    }
    for ereignis in letzte {
        let Some(seit) = ereignis.seit_at() else {
            continue;
        };
        let k = karte.entry(ereignis.aktueller_br_id).or_default();
        if k.laengste_seit_at
            .as_deref()
            .is_none_or(|bisher| seit < bisher)
        {
            k.laengste_seit_at = Some(seit.to_string());
        }
    }
    Ok(karte)
}

#[derive(sqlx::FromRow)]
struct VerlaufZeile {
    id: i64,
    zeitpunkt_at: String,
    art: String,
    br_id: i64,
    objekt_typ: String,
    objekt_id: i64,
    notiz: Option<String>,
    objekt_name: String,
    vorher_bezeichnung: Option<String>,
    ziel_bezeichnung: Option<String>,
}

/// Verlauf eines Raums (LLH-1095, design.md D5, Spec `bereitstellungsraum-belegung`, „Verlauf
/// eines Raums lesen“): jedes Ereignis mit `br_id = bid` und jeder Wechsel aus `bid` hinaus,
/// ungeblättert, neueste zuerst nach `id`. EINE Abfrage über die ganzen Reihen nur der Objekte,
/// die je in `bid` standen; `LAG` liefert den Raum davor. Der Aufrufer prüft Einsatz und Raum.
pub async fn verlauf(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: i64,
) -> Result<Vec<BrVerlaufEintrag>, AppError> {
    let zeilen: Vec<VerlaufZeile> = sqlx::query_as(
        "WITH objekte AS ( \
             SELECT DISTINCT objekt_typ, objekt_id FROM br_belegung \
             WHERE br_id = ?2 AND einsatz_id = ?1), \
         reihe AS ( \
             SELECT b.id, b.br_id, b.objekt_typ, b.objekt_id, b.art, b.notiz, b.zeitpunkt_at, \
                    LAG(b.br_id) OVER w AS vorher_br_id, LAG(b.art) OVER w AS vorher_art \
             FROM objekte o \
             JOIN br_belegung b ON b.objekt_typ = o.objekt_typ AND b.objekt_id = o.objekt_id \
             WHERE b.einsatz_id = ?1 \
             WINDOW w AS (PARTITION BY b.objekt_typ, b.objekt_id ORDER BY b.id)) \
         SELECT r.id, r.zeitpunkt_at, r.art, r.br_id, r.objekt_typ, r.objekt_id, r.notiz, \
                COALESCE(CASE r.objekt_typ WHEN 'einheit' THEN e.name \
                                           ELSE f.snap_funkrufname END, '') AS objekt_name, \
                CASE WHEN r.vorher_art <> 'austritt' THEN vb.bezeichnung END \
                    AS vorher_bezeichnung, \
                zb.bezeichnung AS ziel_bezeichnung \
         FROM reihe r \
         LEFT JOIN einsatz_einheit e ON r.objekt_typ = 'einheit' AND e.id = r.objekt_id \
         LEFT JOIN einsatz_fahrzeug f ON r.objekt_typ = 'fahrzeug' AND f.id = r.objekt_id \
         LEFT JOIN bereitstellungsraum vb ON vb.id = r.vorher_br_id \
         LEFT JOIN bereitstellungsraum zb ON zb.id = r.br_id \
         WHERE r.br_id = ?2 \
            OR (r.art = 'wechsel' AND r.vorher_br_id = ?2 AND r.vorher_art <> 'austritt') \
         ORDER BY r.id DESC",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .fetch_all(pool)
    .await?;
    zeilen
        .into_iter()
        .map(|z| {
            let (art, herkunft, ziel) = match z.art.as_str() {
                "eintritt" => (BrVerlaufArt::Eintritt, None, None),
                "austritt" => (BrVerlaufArt::Austritt, None, None),
                _ if z.br_id == br_id => (BrVerlaufArt::WechselHerein, z.vorher_bezeichnung, None),
                _ => (BrVerlaufArt::WechselHinaus, None, z.ziel_bezeichnung),
            };
            Ok(BrVerlaufEintrag {
                id: z.id,
                zeitpunkt_at: z.zeitpunkt_at,
                art,
                objekt_typ: ObjektTyp::try_from(z.objekt_typ).map_err(AppError::Internal)?,
                objekt_id: z.objekt_id,
                objekt_name: z.objekt_name,
                notiz: z.notiz,
                herkunft,
                ziel,
            })
        })
        .collect()
}

// ─── Interne Helpers ────────────────────────────────────────────────────────

async fn belege_einheit(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    objekt_id: i64,
    buchung: &Buchung<'_>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    // Eine aufgelöste Einheit belegt keinen Raum mehr (409, LLH-1079); fremd → 404.
    crate::einheit::repo::require_aktiv_tx(&mut *conn, einsatz_id, objekt_id).await?;
    // 4. Objekt-Existenz + aktueller_br_id in derselben Tx lesen
    let cache: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(objekt_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;

    let aktueller_br_id = cache.ok_or(AppError::NotFound)?;

    // 6. Art-Vorbedingung
    pruefe_art_vorbedingung(&buchung.art, aktueller_br_id, br_id)?;

    // 7a. Event-Insert
    let event_id = insert_buchung(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Einheit,
        objekt_id,
        buchung,
        benutzer_id,
    )
    .await?;

    // 7b. Cache aktualisieren
    let neuer_br_id = cache_nach_art(&buchung.art, br_id);
    sqlx::query("UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(neuer_br_id)
        .bind(objekt_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;

    Ok(event_id)
}

async fn belege_fahrzeug(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    objekt_id: i64,
    buchung: &Buchung<'_>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    // Ein entlassenes oder storniertes Fahrzeug belegt keinen Raum mehr (409, LLH-1079);
    // fremd → 404.
    crate::fahrzeug::disposition_repo::require_aktiv_tx(&mut *conn, einsatz_id, objekt_id).await?;
    // 4 + 5. Objekt-Existenz, einheit_id (Einheit-bringt-Fahrzeuge-Regel) + aktueller_br_id
    let row: Option<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT einheit_id, aktueller_br_id FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(objekt_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;

    let (einheit_id, aktueller_br_id) = row.ok_or(AppError::NotFound)?;

    // 5. Einheit-bringt-Fahrzeuge: Fahrzeug mit einheit_id ist blockiert
    if einheit_id.is_some() {
        return Err(AppError::Conflict(
            "Fahrzeug gehört einer Einheit — Belegung nur für einheitenlose Fahrzeuge möglich"
                .into(),
        ));
    }

    // 6. Art-Vorbedingung
    pruefe_art_vorbedingung(&buchung.art, aktueller_br_id, br_id)?;

    // 7a. Event-Insert
    let event_id = insert_buchung(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Fahrzeug,
        objekt_id,
        buchung,
        benutzer_id,
    )
    .await?;

    // 7b. Cache aktualisieren
    let neuer_br_id = cache_nach_art(&buchung.art, br_id);
    sqlx::query("UPDATE einsatz_fahrzeug SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(neuer_br_id)
        .bind(objekt_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;

    Ok(event_id)
}

/// Prüft die Art-Vorbedingung (Annahme 4 der Spec):
/// - eintritt: aktueller_br_id muss NULL sein
/// - wechsel / austritt: aktueller_br_id muss gesetzt sein
/// - austritt zusätzlich: der übergebene `br_id` muss dem `aktueller_br_id` des
///   Objekts entsprechen — sonst trägt das Event eine falsche br_id (ETB-Text
///   „verlässt BR X" wäre falsch). Bei Mismatch `Conflict`.
fn pruefe_art_vorbedingung(
    art: &BrBelegungsArt,
    aktueller_br_id: Option<i64>,
    br_id: i64,
) -> Result<(), AppError> {
    match art {
        BrBelegungsArt::Eintritt if aktueller_br_id.is_some() => Err(AppError::Conflict(
            "Objekt hat bereits einen aktiven Bereitstellungsraum — Wechsel oder Austritt verwenden"
                .into(),
        )),
        BrBelegungsArt::Wechsel if aktueller_br_id.is_none() => Err(AppError::Conflict(
            "Objekt hat keinen aktiven Bereitstellungsraum — Eintritt verwenden".into(),
        )),
        BrBelegungsArt::Austritt if aktueller_br_id.is_none() => Err(AppError::Conflict(
            "Objekt hat keinen aktiven Bereitstellungsraum".into(),
        )),
        BrBelegungsArt::Austritt if aktueller_br_id != Some(br_id) => Err(AppError::Conflict(
            "Objekt ist nicht in diesem Bereitstellungsraum".into(),
        )),
        _ => Ok(()),
    }
}

/// Berechnet den neuen Cache-Wert für `aktueller_br_id` abhängig von der Belegungs-Art:
/// - eintritt/wechsel → br_id setzen
/// - austritt → NULL
fn cache_nach_art(art: &BrBelegungsArt, br_id: i64) -> Option<i64> {
    match art {
        BrBelegungsArt::Eintritt | BrBelegungsArt::Wechsel => Some(br_id),
        BrBelegungsArt::Austritt => None,
    }
}

/// Event-Insert einer [`Buchung`]: mit Zeitpunkt explizit, sonst die Spaltenvorgabe.
async fn insert_buchung(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    objekt_typ: ObjektTyp,
    objekt_id: i64,
    buchung: &Buchung<'_>,
    erfasst_von: i64,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO br_belegung \
            (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, erfasst_von, client_id, \
             zeitpunkt_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, \
                 COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now'))) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(objekt_typ.as_str())
    .bind(objekt_id)
    .bind(buchung.art.as_str())
    .bind(buchung.notiz)
    .bind(erfasst_von)
    .bind(buchung.client_id)
    .bind(buchung.zeitpunkt_at)
    .fetch_one(&mut *conn)
    .await?)
}

async fn insert_event(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    objekt_typ: ObjektTyp,
    objekt_id: i64,
    art: &BrBelegungsArt,
    notiz: Option<&str>,
    erfasst_von: i64,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO br_belegung \
            (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, erfasst_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(objekt_typ.as_str())
    .bind(objekt_id)
    .bind(art.as_str())
    .bind(notiz)
    .bind(erfasst_von)
    .fetch_one(&mut *conn)
    .await?)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bereitstellungsraum::repo::{self as br_repo};
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    /// Legt Org(1) + Benutzer + aktiven Einsatz an.
    /// Liefert (benutzer_id, einsatz_id).
    async fn basis_setup(pool: &SqlitePool) -> (i64, i64) {
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
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    /// Legt einen aktiven BR an.
    async fn aktiven_br(pool: &SqlitePool, einsatz_id: i64, benutzer_id: i64, bez: &str) -> i64 {
        let br = br_repo::anlegen(
            pool,
            einsatz_id,
            benutzer_id,
            br_repo::NeueDaten {
                bezeichnung: bez,
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        br_repo::setze_status(pool, einsatz_id, br.id, "aktiv", benutzer_id)
            .await
            .unwrap();
        br.id
    }

    /// Legt eine einsatz_einheit an und liefert deren id.
    async fn neue_einheit(pool: &SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '1. Zug') RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Legt ein einheitenloses einsatz_fahrzeug an.
    async fn neues_fahrzeug_ohne_einheit(pool: &SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) \
             VALUES (?, 'Florian 1') RETURNING id",
        )
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Legt ein einsatz_fahrzeug MIT einheit_id an.
    async fn neues_fahrzeug_mit_einheit(
        pool: &SqlitePool,
        einsatz_id: i64,
        einheit_id: i64,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
             VALUES (?, 'Florian 2', ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(einheit_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Liest `aktueller_br_id` für eine Einheit.
    async fn cache_einheit(pool: &SqlitePool, einheit_id: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ?")
            .bind(einheit_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Liest `aktueller_br_id` für ein Fahrzeug.
    async fn cache_fahrzeug(pool: &SqlitePool, fahrzeug_id: i64) -> Option<i64> {
        sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_fahrzeug WHERE id = ?")
            .bind(fahrzeug_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    // ─── Einheit-Tests ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn einheit_eintritt_setzt_cache() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Nord").await;
        let einheit = neue_einheit(&pool, e).await;

        let ev = belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        assert_eq!(ev.art, BrBelegungsArt::Eintritt);
        assert_eq!(ev.objekt_typ, ObjektTyp::Einheit);
        assert_eq!(ev.objekt_id, einheit);
        assert_eq!(ev.br_id, br);
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br));
    }

    /// LLH-1079 (Spec `kraefte-entlassung`): eine aufgelöste Einheit tritt in keinen
    /// Bereitstellungsraum mehr ein (409, Lebenszyklus).
    #[tokio::test]
    async fn aufgeloeste_einheit_belegt_keinen_br() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Nord").await;
        let einheit = neue_einheit(&pool, e).await;
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-05-28 10:00:00' WHERE id = ?",
        )
        .bind(einheit)
        .execute(&pool)
        .await
        .unwrap();

        let r = belege(&pool, e, br, "einheit", einheit, "eintritt", None, b).await;
        assert!(matches!(r, Err(AppError::Conflict(_))), "{r:?}");
        assert_eq!(cache_einheit(&pool, einheit).await, None);
    }

    #[tokio::test]
    async fn einheit_wechsel_setzt_cache_auf_neuen_br() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br1 = aktiven_br(&pool, e, b, "BR 1").await;
        let br2 = aktiven_br(&pool, e, b, "BR 2").await;
        let einheit = neue_einheit(&pool, e).await;

        belege(&pool, e, br1, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br1));

        let ev = belege(&pool, e, br2, "einheit", einheit, "wechsel", None, b)
            .await
            .unwrap();
        assert_eq!(ev.art, BrBelegungsArt::Wechsel);
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br2));
    }

    #[tokio::test]
    async fn einheit_austritt_leert_cache_und_br_ist_aufloesbar() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Austritt").await;
        let einheit = neue_einheit(&pool, e).await;

        belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        assert_eq!(
            br_repo::aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br)
                .await
                .unwrap(),
            1
        );

        let ev = belege(&pool, e, br, "einheit", einheit, "austritt", None, b)
            .await
            .unwrap();
        assert_eq!(ev.art, BrBelegungsArt::Austritt);
        assert_eq!(cache_einheit(&pool, einheit).await, None);

        // WICHTIG: nach Austritt muss BR auflösbar sein
        assert_eq!(
            br_repo::aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br)
                .await
                .unwrap(),
            0
        );
        br_repo::setze_status(&pool, e, br, "aufgeloest", b)
            .await
            .unwrap();
    }

    // ─── Finding 1: stornierter BR ──────────────────────────────────────────

    #[tokio::test]
    async fn stornierter_br_akzeptiert_keine_belegung() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Storno").await;
        let einheit = neue_einheit(&pool, e).await;
        // BR stornieren: storniert_at gesetzt, status bleibt 'aktiv'
        br_repo::storniere(&pool, e, br, b).await.unwrap();

        let err = belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::UnprocessableEntity(_)),
            "stornierter BR → UnprocessableEntity (422), auch wenn status='aktiv'"
        );
    }

    // ─── Finding 2: austritt-br_id gegen Cache prüfen ───────────────────────

    #[tokio::test]
    async fn austritt_mit_falschem_br_id_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br1 = aktiven_br(&pool, e, b, "BR Echt").await;
        let br2 = aktiven_br(&pool, e, b, "BR Falsch").await;
        let einheit = neue_einheit(&pool, e).await;
        belege(&pool, e, br1, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();

        // Austritt mit br2 angeben, obwohl Einheit in br1 ist → Conflict
        let err = belege(&pool, e, br2, "einheit", einheit, "austritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Austritt mit falschem br_id → Conflict"
        );
        // Cache bleibt unangetastet
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br1));
    }

    #[tokio::test]
    async fn austritt_mit_korrektem_br_id_traegt_korrekte_br_id() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Korrekt").await;
        let einheit = neue_einheit(&pool, e).await;
        belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();

        let ev = belege(&pool, e, br, "einheit", einheit, "austritt", None, b)
            .await
            .unwrap();
        assert_eq!(ev.br_id, br, "Austritt-Event trägt die korrekte br_id");
        assert_eq!(cache_einheit(&pool, einheit).await, None);
    }

    // ─── Fahrzeug-Tests ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn fahrzeug_ohne_einheit_eintritt_setzt_cache() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Fz").await;
        let fz = neues_fahrzeug_ohne_einheit(&pool, e).await;

        let ev = belege(&pool, e, br, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap();
        assert_eq!(ev.art, BrBelegungsArt::Eintritt);
        assert_eq!(ev.objekt_typ, ObjektTyp::Fahrzeug);
        assert_eq!(cache_fahrzeug(&pool, fz).await, Some(br));
    }

    #[tokio::test]
    async fn fahrzeug_mit_einheit_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Fz Einheit").await;
        let einheit = neue_einheit(&pool, e).await;
        let fz = neues_fahrzeug_mit_einheit(&pool, e, einheit).await;

        let err = belege(&pool, e, br, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Fahrzeug mit einheit_id → Conflict (409)"
        );
    }

    #[tokio::test]
    async fn fahrzeug_austritt_leert_cache() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Fz Austritt").await;
        let fz = neues_fahrzeug_ohne_einheit(&pool, e).await;

        belege(&pool, e, br, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br, "fahrzeug", fz, "austritt", None, b)
            .await
            .unwrap();

        assert_eq!(cache_fahrzeug(&pool, fz).await, None);
        assert_eq!(
            br_repo::aktive_belegungen_tx(&mut *pool.acquire().await.unwrap(), br)
                .await
                .unwrap(),
            0
        );
    }

    // ─── LLH-1095: „seit“, Kennzahlen, Verlauf ─────────────────────────────

    async fn einheit_namens(pool: &SqlitePool, einsatz_id: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn fahrzeug_namens(
        pool: &SqlitePool,
        einsatz_id: i64,
        funkrufname: &str,
        einheit_id: Option<i64>,
    ) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
             VALUES (?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(funkrufname)
        .bind(einheit_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Setzt den Zeitpunkt eines Ereignisses (die Tabelle löst nur Sekunden auf, Tests laufen
    /// schneller).
    async fn zeitpunkt(pool: &SqlitePool, ereignis: i64, at: &str) {
        sqlx::query("UPDATE br_belegung SET zeitpunkt_at = ? WHERE id = ?")
            .bind(at)
            .bind(ereignis)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn kennzahlen(pool: &SqlitePool, e: i64, br: i64) -> BrBelegungKennzahlen {
        kennzahlen_je_raum(pool, e, Some(br))
            .await
            .unwrap()
            .remove(&br)
            .unwrap_or_default()
    }

    async fn seit(pool: &SqlitePool, e: i64, typ: ObjektTyp, id: i64) -> Option<String> {
        letztes_je_objekt(pool, e, None)
            .await
            .unwrap()
            .into_iter()
            .find(|l| l.objekt_typ == typ && l.objekt_id == id)
            .and_then(|l| l.seit_at().map(str::to_string))
    }

    /// Akzeptanzkriterium LLH-1095: zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne
    /// Einheit ergeben „Fahrzeuge 3“ und „Einheiten 2“.
    #[tokio::test]
    async fn fahrzeuge_der_einheiten_zaehlen_mit() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Sportplatz").await;
        for (name, fz) in [("1. Zug", "Florian 1/44-1"), ("2. Zug", "Florian 1/44-2")] {
            let einheit = einheit_namens(&pool, e, name).await;
            fahrzeug_namens(&pool, e, fz, Some(einheit)).await;
            belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
                .await
                .unwrap();
        }
        let einzeln = fahrzeug_namens(&pool, e, "Florian 1/83-1", None).await;
        belege(&pool, e, br, "fahrzeug", einzeln, "eintritt", None, b)
            .await
            .unwrap();

        let k = kennzahlen(&pool, e, br).await;
        assert_eq!((k.einheiten, k.fahrzeuge), (2, 3), "{k:?}");
        // Liste und Detail rechnen über denselben Baustein.
        let alle = kennzahlen_je_raum(&pool, e, None).await.unwrap();
        assert_eq!(alle.get(&br), Some(&k));
    }

    /// Ein BR-Fahrzeug, das danach einer Einheit im Raum zugeordnet wurde, behält
    /// `aktueller_br_id` (Scope-Frage 6) und zählt trotzdem einmal.
    #[tokio::test]
    async fn doppelt_gefuehrtes_fahrzeug_zaehlt_einmal() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Doppel").await;
        let einheit = einheit_namens(&pool, e, "1. Zug").await;
        belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        let fz = fahrzeug_namens(&pool, e, "Florian 1", None).await;
        belege(&pool, e, br, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap();
        sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = ? WHERE id = ?")
            .bind(einheit)
            .bind(fz)
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(kennzahlen(&pool, e, br).await.fahrzeuge, 1);
    }

    /// Fahrzeuge einer Untereinheit zählen nur, wenn die Untereinheit selbst im Raum steht; eine
    /// Untereinheit im Raum zählt als Einheit; ein entlassenes Fahrzeug zählt nicht.
    #[tokio::test]
    async fn untereinheit_und_entlassenes_fahrzeug() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Baum").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        let gruppe_aussen = einheit_namens(&pool, e, "Gruppe 2").await;
        let gruppe_innen = einheit_namens(&pool, e, "Gruppe 1").await;
        for g in [gruppe_aussen, gruppe_innen] {
            sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
                .bind(zug)
                .bind(g)
                .execute(&pool)
                .await
                .unwrap();
        }
        fahrzeug_namens(&pool, e, "Florian Zug", Some(zug)).await;
        fahrzeug_namens(&pool, e, "Florian Aussen", Some(gruppe_aussen)).await;
        fahrzeug_namens(&pool, e, "Florian Innen", Some(gruppe_innen)).await;
        let entlassen = fahrzeug_namens(&pool, e, "Florian Weg", Some(zug)).await;
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET beendet_at = '2026-05-28 10:00:00', \
             beendet_als = 'entlassen' WHERE id = ?",
        )
        .bind(entlassen)
        .execute(&pool)
        .await
        .unwrap();
        for einheit in [zug, gruppe_innen] {
            belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
                .await
                .unwrap();
        }

        let k = kennzahlen(&pool, e, br).await;
        assert_eq!(k.einheiten, 2, "Zug und Gruppe 1 stehen im Raum: {k:?}");
        assert_eq!(
            k.fahrzeuge, 2,
            "Zug und Gruppe 1, nicht Gruppe 2, nicht entlassen: {k:?}"
        );
    }

    /// „Seit“ nach einem Wechsel A → B ist der Wechsel; die längste Wartezeit ist das früheste
    /// „seit“ über Einheiten und einheitenlose Fahrzeuge.
    #[tokio::test]
    async fn seit_nach_wechsel_und_laengste_wartezeit() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br_a = aktiven_br(&pool, e, b, "BR A").await;
        let br_b = aktiven_br(&pool, e, b, "BR B").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        let fz = fahrzeug_namens(&pool, e, "Florian 1", None).await;

        let ein = belege(&pool, e, br_a, "einheit", zug, "eintritt", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, ein.id, "2026-05-28 11:42:00").await;
        let fz_ein = belege(&pool, e, br_b, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, fz_ein.id, "2026-05-28 12:05:00").await;
        let wechsel = belege(&pool, e, br_b, "einheit", zug, "wechsel", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, wechsel.id, "2026-05-28 12:10:00").await;

        assert_eq!(
            seit(&pool, e, ObjektTyp::Einheit, zug).await.as_deref(),
            Some("2026-05-28 12:10:00"),
            "seit in B ist der Wechsel, nicht der Eintritt in A"
        );
        let k = kennzahlen(&pool, e, br_b).await;
        assert_eq!(k.laengste_seit_at.as_deref(), Some("2026-05-28 12:05:00"));
        assert_eq!(
            kennzahlen(&pool, e, br_a).await,
            BrBelegungKennzahlen::default()
        );
    }

    /// Ist das jüngste Ereignis ein Austritt oder eines in einem anderen Raum (inkonsistenter
    /// Cache, Bestand), fehlt „seit“, und ohne „seit“ fehlt die längste Wartezeit.
    #[tokio::test]
    async fn ohne_passendes_ereignis_kein_seit() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br_a = aktiven_br(&pool, e, b, "BR A").await;
        let br_b = aktiven_br(&pool, e, b, "BR B").await;
        let raus = einheit_namens(&pool, e, "Raus").await;
        let anders = einheit_namens(&pool, e, "Anders").await;
        let ohne = einheit_namens(&pool, e, "Ohne").await;
        belege(&pool, e, br_a, "einheit", raus, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br_a, "einheit", raus, "austritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br_b, "einheit", anders, "eintritt", None, b)
            .await
            .unwrap();
        // Cache von Hand auf A: jüngstes Ereignis Austritt bzw. anderer Raum, eine ohne Ereignis.
        for einheit in [raus, anders, ohne] {
            sqlx::query("UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ?")
                .bind(br_a)
                .bind(einheit)
                .execute(&pool)
                .await
                .unwrap();
        }

        for einheit in [raus, anders, ohne] {
            assert_eq!(seit(&pool, e, ObjektTyp::Einheit, einheit).await, None);
        }
        let k = kennzahlen(&pool, e, br_a).await;
        assert_eq!(k.einheiten, 3);
        assert_eq!(k.laengste_seit_at, None);
    }

    /// Ereignisse eines anderen Einsatzes (auch mit derselben Objektkennung) ändern weder
    /// „seit“ noch Kennzahlen.
    #[tokio::test]
    async fn fremder_einsatz_aendert_nichts() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Andere Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let br = aktiven_br(&pool, e, b, "BR Eigen").await;
        let br_fremd = aktiven_br(&pool, fremd, b, "BR Fremd").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        let ein = belege(&pool, e, br, "einheit", zug, "eintritt", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, ein.id, "2026-05-28 11:42:00").await;
        // Ein jüngeres Ereignis eines fremden Einsatzes mit derselben Objektkennung.
        sqlx::query(
            "INSERT INTO br_belegung (einsatz_id, br_id, objekt_typ, objekt_id, art, erfasst_von) \
             VALUES (?, ?, 'einheit', ?, 'austritt', ?)",
        )
        .bind(fremd)
        .bind(br_fremd)
        .bind(zug)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();

        assert_eq!(
            seit(&pool, e, ObjektTyp::Einheit, zug).await.as_deref(),
            Some("2026-05-28 11:42:00")
        );
        let alle = kennzahlen_je_raum(&pool, e, None).await.unwrap();
        assert_eq!(alle.len(), 1, "nur der eigene Raum: {alle:?}");
        assert!(verlauf(&pool, e, br_fremd).await.unwrap().is_empty());
    }

    fn kurz(v: &[BrVerlaufEintrag]) -> Vec<(BrVerlaufArt, &str, Option<&str>, Option<&str>)> {
        v.iter()
            .map(|e| {
                (
                    e.art,
                    e.objekt_name.as_str(),
                    e.herkunft.as_deref().or(e.ziel.as_deref()),
                    e.notiz.as_deref(),
                )
            })
            .collect()
    }

    /// Verlauf: Eintritt, Wechsel A → B (in A hinaus mit Ziel, in B herein mit Herkunft),
    /// Austritt mit Notiz, neueste zuerst; ein leerer Raum ist leer.
    #[tokio::test]
    async fn verlauf_mit_wechsel_und_austritt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let sportplatz = aktiven_br(&pool, e, b, "BR Sportplatz").await;
        let schule = aktiven_br(&pool, e, b, "BR Schule").await;
        let leer = aktiven_br(&pool, e, b, "BR Leer").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        belege(&pool, e, sportplatz, "einheit", zug, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, schule, "einheit", zug, "wechsel", None, b)
            .await
            .unwrap();
        belege(
            &pool,
            e,
            schule,
            "einheit",
            zug,
            "austritt",
            Some("abgerückt"),
            b,
        )
        .await
        .unwrap();

        use BrVerlaufArt::*;
        let a = verlauf(&pool, e, sportplatz).await.unwrap();
        assert_eq!(
            kurz(&a),
            vec![
                (WechselHinaus, "1. Zug", Some("BR Schule"), None),
                (Eintritt, "1. Zug", None, None),
            ]
        );
        let s = verlauf(&pool, e, schule).await.unwrap();
        assert_eq!(
            kurz(&s),
            vec![
                (Austritt, "1. Zug", None, Some("abgerückt")),
                (WechselHerein, "1. Zug", Some("BR Sportplatz"), None),
            ]
        );
        assert!(s[0].id > s[1].id, "neueste zuerst");
        assert_eq!(s[0].objekt_typ, ObjektTyp::Einheit);
        assert_eq!(s[0].objekt_id, zug);
        assert!(verlauf(&pool, e, leer).await.unwrap().is_empty());
    }

    /// Auflösen einer Einheit im Raum steht als Austritt „Einheit aufgelöst“ mit ihrem Namen im
    /// Verlauf, auch nachdem sie aufgelöst ist.
    #[tokio::test]
    async fn verlauf_zeigt_aufloesung_mit_namen() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Sportplatz").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        belege(&pool, e, br, "einheit", zug, "eintritt", None, b)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        austritt_bei_aufloesung_tx(&mut conn, e, zug, b)
            .await
            .unwrap();
        drop(conn);
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-05-28 13:00:00' WHERE id = ?",
        )
        .bind(zug)
        .execute(&pool)
        .await
        .unwrap();

        let v = verlauf(&pool, e, br).await.unwrap();
        assert_eq!(
            kurz(&v)[0],
            (
                BrVerlaufArt::Austritt,
                "1. Zug",
                None,
                Some("Einheit aufgelöst")
            )
        );
    }

    /// Fahrzeug und Einheit mit gleicher Kennung bleiben getrennte Reihen; ein Austritt aus A und
    /// ein späterer Eintritt in B steht in A nicht als Wechsel.
    #[tokio::test]
    async fn verlauf_trennt_objekte_und_erfindet_keinen_wechsel() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br_a = aktiven_br(&pool, e, b, "BR A").await;
        let br_b = aktiven_br(&pool, e, b, "BR B").await;
        sqlx::query(
            "INSERT INTO einsatz_einheit (id, einsatz_id, name) VALUES (500, ?, 'Zug 500')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fahrzeug (id, einsatz_id, snap_funkrufname) \
             VALUES (500, ?, 'Florian 500')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        belege(&pool, e, br_a, "einheit", 500, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br_b, "fahrzeug", 500, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br_a, "einheit", 500, "austritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br_b, "einheit", 500, "eintritt", None, b)
            .await
            .unwrap();

        use BrVerlaufArt::*;
        let a = verlauf(&pool, e, br_a).await.unwrap();
        assert_eq!(
            kurz(&a),
            vec![
                (Austritt, "Zug 500", None, None),
                (Eintritt, "Zug 500", None, None)
            ]
        );
        let bb = verlauf(&pool, e, br_b).await.unwrap();
        assert_eq!(
            kurz(&bb),
            vec![
                (Eintritt, "Zug 500", None, None),
                (Eintritt, "Florian 500", None, None),
            ]
        );
        assert_eq!(bb[1].objekt_typ, ObjektTyp::Fahrzeug);
    }

    // ─── Validierungs-Tests ─────────────────────────────────────────────────

    #[tokio::test]
    async fn unbekannter_objekt_typ_ist_validation() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Val").await;

        let err = belege(&pool, e, br, "person", 1, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "unbekannter objekt_typ → Validation (400)"
        );
    }

    #[tokio::test]
    async fn unbekannte_art_ist_validation() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Art").await;
        let einheit = neue_einheit(&pool, e).await;

        let err = belege(&pool, e, br, "einheit", einheit, "umzug", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Validation(_)),
            "unbekannte art → Validation (400)"
        );
    }

    #[tokio::test]
    async fn geplanter_br_akzeptiert_keine_belegung() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = br_repo::anlegen(
            &pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: "BR Geplant",
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        let einheit = neue_einheit(&pool, e).await;

        let err = belege(&pool, e, br.id, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::UnprocessableEntity(_)),
            "geplanter BR → UnprocessableEntity (422)"
        );
    }

    #[tokio::test]
    async fn objekt_id_aus_fremdem_einsatz_ist_not_found() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR NF").await;

        // objekt_id 9999 existiert nicht im Einsatz
        let err = belege(&pool, e, br, "einheit", 9999, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::NotFound),
            "nicht existierender objekt_id → NotFound (404)"
        );
    }

    #[tokio::test]
    async fn eintritt_waehrend_aktiver_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Doppel").await;
        let einheit = neue_einheit(&pool, e).await;

        belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        let err = belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Eintritt bei aktiver Belegung → Conflict"
        );
    }

    #[tokio::test]
    async fn wechsel_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Wechsel").await;
        let einheit = neue_einheit(&pool, e).await;

        let err = belege(&pool, e, br, "einheit", einheit, "wechsel", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Wechsel ohne aktive Belegung → Conflict"
        );
    }

    #[tokio::test]
    async fn austritt_ohne_aktive_belegung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR AustrittLeer").await;
        let einheit = neue_einheit(&pool, e).await;

        let err = belege(&pool, e, br, "einheit", einheit, "austritt", None, b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Austritt ohne aktive Belegung → Conflict"
        );
    }

    // ─── LLH-1075: belege_tx ────────────────────────────────────────────────

    fn eintritt<'a>() -> Buchung<'a> {
        Buchung {
            art: BrBelegungsArt::Eintritt,
            notiz: None,
            client_id: None,
            zeitpunkt_at: None,
        }
    }

    /// LLH-1075 (design.md D2, Schritt 1): die Prüfung „aktiv, nicht storniert“ liegt in der
    /// Transaktion. Löst dieselbe Transaktion den Raum vorher auf, lehnt `belege_tx` ab (422)
    /// statt in einen aufgelösten Raum zu buchen.
    #[tokio::test]
    async fn belege_tx_br_in_derselben_tx_aufgeloest_422() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Rennen").await;
        let einheit = neue_einheit(&pool, e).await;

        let mut tx = pool.begin().await.unwrap();
        sqlx::query("UPDATE bereitstellungsraum SET status = 'aufgeloest' WHERE id = ?")
            .bind(br)
            .execute(&mut *tx)
            .await
            .unwrap();
        let r = belege_tx(&mut tx, e, br, ObjektTyp::Einheit, einheit, &eintritt(), b).await;
        assert!(matches!(r, Err(AppError::UnprocessableEntity(_))), "{r:?}");
        let r = belege_tx(
            &mut tx,
            e,
            br + 999,
            ObjektTyp::Einheit,
            einheit,
            &eintritt(),
            b,
        )
        .await;
        assert!(matches!(r, Err(AppError::NotFound)), "{r:?}");
        tx.rollback().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        sqlx::query(
            "UPDATE bereitstellungsraum SET storniert_at = '2026-05-28 10:00:00' WHERE id = ?",
        )
        .bind(br)
        .execute(&mut *tx)
        .await
        .unwrap();
        let r = belege_tx(&mut tx, e, br, ObjektTyp::Einheit, einheit, &eintritt(), b).await;
        assert!(matches!(r, Err(AppError::UnprocessableEntity(_))), "{r:?}");
        tx.rollback().await.unwrap();
        assert_eq!(cache_einheit(&pool, einheit).await, None);
    }

    /// `client_id` und vorgemerkter Zeitpunkt landen an der Zeile; ohne Zeitpunkt gilt die
    /// Spaltenvorgabe wie bisher.
    #[tokio::test]
    async fn belege_tx_traegt_client_id_und_zeitpunkt() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Schluessel").await;
        let einheit = neue_einheit(&pool, e).await;
        let fahrzeug = neues_fahrzeug_ohne_einheit(&pool, e).await;

        let mut tx = pool.begin().await.unwrap();
        let buchung = Buchung {
            client_id: Some("c-1"),
            zeitpunkt_at: Some("2026-05-28 09:15:00"),
            notiz: Some("am Tor"),
            ..eintritt()
        };
        let id = belege_tx(&mut tx, e, br, ObjektTyp::Einheit, einheit, &buchung, b)
            .await
            .unwrap();
        let ohne = belege_tx(
            &mut tx,
            e,
            br,
            ObjektTyp::Fahrzeug,
            fahrzeug,
            &eintritt(),
            b,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let (cid, at, notiz): (Option<String>, String, Option<String>) =
            sqlx::query_as("SELECT client_id, zeitpunkt_at, notiz FROM br_belegung WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cid.as_deref(), Some("c-1"));
        assert_eq!(at, "2026-05-28 09:15:00");
        assert_eq!(notiz.as_deref(), Some("am Tor"));
        let (cid, at): (Option<String>, String) =
            sqlx::query_as("SELECT client_id, zeitpunkt_at FROM br_belegung WHERE id = ?")
                .bind(ohne)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cid, None);
        assert!(!at.is_empty());
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br));
        assert_eq!(cache_fahrzeug(&pool, fahrzeug).await, Some(br));
        let gefunden = mit_client_id(&pool, e, "c-1").await.unwrap().unwrap();
        assert_eq!(gefunden.id, id);
        assert!(mit_client_id(&pool, e + 1, "c-1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn notiz_wird_gespeichert() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Notiz").await;
        let einheit = neue_einheit(&pool, e).await;

        let ev = belege(
            &pool,
            e,
            br,
            "einheit",
            einheit,
            "eintritt",
            Some("Verstärkung aus dem Nachbarkreis"),
            b,
        )
        .await
        .unwrap();
        assert_eq!(
            ev.notiz.as_deref(),
            Some("Verstärkung aus dem Nachbarkreis")
        );
    }
}

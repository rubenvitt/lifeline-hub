use super::{
    repo, BrAbrufKurz, BrBelegungAnzeige, BrBelegungKennzahlen, BrBelegungsArt, BrStatus,
    BrVerlaufArt, BrVerlaufEintrag, ObjektTyp,
};
use crate::error::AppError;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, erfasst_von, \
           ziel_abschnitt_id, ziel_anzeige, auftrag_id, mit_abruf_id \
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
/// aus einem wechselt oder aus einem aus. Wie [`belege_mit_folgen`], nur das Ereignis.
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
    Ok(belege_mit_folgen(
        pool,
        einsatz_id,
        br_id,
        objekt_typ,
        objekt_id,
        art,
        notiz,
        benutzer_id,
    )
    .await?
    .ereignis)
}

/// Eine gebuchte Belegung samt dem, was sie über einen vorherigen Abruf weiß (LLH-1085,
/// design.md D10/D12): die Route wählt daraus den ETB-Wortlaut und die Live-Ereignisse.
#[derive(Debug, Clone)]
pub struct Belegt {
    pub ereignis: BrBelegungAnzeige,
    /// Der Abruf, den ein Austritt beendet hat (Ausrücken).
    pub vorher_abruf: Option<OffenerAbruf>,
    /// Untereinheiten, die mit der abgerufenen Einheit ausgetreten sind (id, Name).
    pub mitgenommen: Vec<(i64, String)>,
}

/// Pool-Hülle um [`belege_tx`] in EINER Transaktion (`write_retry!`).
///
/// # Regeln (in Reihenfolge)
/// 1. `objekt_typ` unbekannt → `Validation`
/// 2. `art` unbekannt → `Validation`; `abruf`/`abruf_aufgehoben` → `UnprocessableEntity`, sie
///    haben eigene Routen (LLH-1085, design.md D2)
/// 3. ab hier [`belege_tx`]
#[allow(clippy::too_many_arguments)]
pub async fn belege_mit_folgen(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: i64,
    objekt_typ: &str,
    objekt_id: i64,
    art: &str,
    notiz: Option<&str>,
    benutzer_id: i64,
) -> Result<Belegt, AppError> {
    // 1. Objekt-Typ parsen
    let typ = ObjektTyp::parse(objekt_typ)
        .ok_or_else(|| AppError::Validation(format!("Unbekannter objekt_typ: '{objekt_typ}'")))?;

    // 2. Art parsen
    let belegungs_art = BrBelegungsArt::parse(art)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte art: '{art}'")))?;
    check_belegungs_art(belegungs_art)?;

    let buchung = Buchung {
        art: belegungs_art,
        notiz,
        client_id: None,
        zeitpunkt_at: None,
    };
    // read-then-write-Atomizität in einer Transaktion (F09: BEGIN IMMEDIATE + Retry)
    let ergebnis = crate::write_retry!(pool, |conn| {
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
    Ok(Belegt {
        ereignis: laden(pool, einsatz_id, ergebnis.ereignis).await?,
        vorher_abruf: ergebnis.vorher_abruf,
        mitgenommen: ergebnis.mitgenommen,
    })
}

/// `abruf` und `abruf_aufgehoben` schreibt nur [`super::abruf`] (LLH-1085, design.md D2).
fn check_belegungs_art(art: BrBelegungsArt) -> Result<(), AppError> {
    match art {
        BrBelegungsArt::Abruf | BrBelegungsArt::AbrufAufgehoben => {
            Err(AppError::UnprocessableEntity(
                "Abruf und Rücknahme über …/abruf, nicht über die Belegung".into(),
            ))
        }
        _ => Ok(()),
    }
}

/// Ergebnis von [`belege_tx`]: id der Belegungszeile, bei einem Austritt nach einem Abruf dieser
/// Abruf und die mit ausgetretenen Untereinheiten (LLH-1085, design.md D10/D12).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BelegungsErgebnis {
    pub ereignis: i64,
    pub vorher_abruf: Option<OffenerAbruf>,
    pub mitgenommen: Vec<(i64, String)>,
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
///    gesetzt sein; `abruf`/`abruf_aufgehoben` → `UnprocessableEntity`
/// 5. Ein Wechsel einer abgerufenen Kraft → `UnprocessableEntity` (LLH-1085, design.md D12)
/// 6. Event-Insert + Cache-Update
/// 7. Austritt einer abgerufenen Einheit: genau die mit ihr abgerufenen Untereinheiten treten
///    mit aus (D10). Hier statt in der Route, damit jeder Aufrufer (auch der Vollzug einer
///    Ablösung, LLH-1132) die Regel erbt (`src/AGENTS.md`, „Backend — Bereitstellungsraum“).
pub async fn belege_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    typ: ObjektTyp,
    objekt_id: i64,
    buchung: &Buchung<'_>,
    benutzer_id: i64,
) -> Result<BelegungsErgebnis, AppError> {
    require_belegbar_tx(&mut *conn, einsatz_id, br_id).await?;
    let aktueller_br_id = match typ {
        ObjektTyp::Einheit => {
            // Eine aufgelöste Einheit belegt keinen Raum mehr (409, LLH-1079); fremd → 404.
            crate::einheit::repo::require_aktiv_tx(&mut *conn, einsatz_id, objekt_id).await?;
            let cache: Option<Option<i64>> = sqlx::query_scalar(
                "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            )
            .bind(objekt_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            cache.ok_or(AppError::NotFound)?
        }
        ObjektTyp::Fahrzeug => {
            einheitenloses_fahrzeug_br_tx(&mut *conn, einsatz_id, objekt_id).await?
        }
    };

    check_art_vorbedingung(&buchung.art, aktueller_br_id, br_id)?;
    let vorher_abruf = match aktueller_br_id {
        Some(raum) => offener_abruf_tx(&mut *conn, einsatz_id, typ, objekt_id, raum).await?,
        None => None,
    };
    if buchung.art == BrBelegungsArt::Wechsel && vorher_abruf.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Kraft ist abgerufen; erst den Abruf zurücknehmen".into(),
        ));
    }

    let ereignis = insert_buchung(
        &mut *conn,
        einsatz_id,
        br_id,
        typ,
        objekt_id,
        buchung,
        benutzer_id,
    )
    .await?;
    update_cache_tx(
        &mut *conn,
        einsatz_id,
        typ,
        objekt_id,
        cache_nach_art(&buchung.art, br_id),
    )
    .await?;

    let mut mitgenommen = Vec::new();
    if let (BrBelegungsArt::Austritt, Some(abruf)) = (buchung.art, vorher_abruf.as_ref()) {
        mitgenommen = mitgenommene_tx(&mut *conn, einsatz_id, br_id, abruf.id).await?;
        for (einheit_id, _) in &mitgenommen {
            insert_event(
                &mut *conn,
                einsatz_id,
                br_id,
                ObjektTyp::Einheit,
                *einheit_id,
                &BrBelegungsArt::Austritt,
                None,
                benutzer_id,
            )
            .await?;
            update_cache_tx(
                &mut *conn,
                einsatz_id,
                ObjektTyp::Einheit,
                *einheit_id,
                None,
            )
            .await?;
        }
    }
    Ok(BelegungsErgebnis {
        ereignis,
        vorher_abruf,
        mitgenommen,
    })
}

/// Setzt den Cache `aktueller_br_id` einer Einheit bzw. eines Fahrzeugs.
pub(super) async fn update_cache_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    typ: ObjektTyp,
    objekt_id: i64,
    br_id: Option<i64>,
) -> Result<(), AppError> {
    let sql = match typ {
        ObjektTyp::Einheit => {
            "UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?"
        }
        ObjektTyp::Fahrzeug => {
            "UPDATE einsatz_fahrzeug SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?"
        }
    };
    sqlx::query(sql)
        .bind(br_id)
        .bind(objekt_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ─── Abruf (LLH-1085) ───────────────────────────────────────────────────────

/// Ein Abruf, der gerade gilt: das jüngste Belegungsereignis des Objekts ist ein `abruf` im
/// Raum (design.md D3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffenerAbruf {
    /// id des Abruf-Ereignisses.
    pub id: i64,
    /// Abruf der Einheit, mit der dieses Objekt mitgenommen wurde (D10).
    pub mit_abruf_id: Option<i64>,
    /// Name des Ziels; bei einer mitgenommenen Untereinheit der ihrer Einheit.
    pub ziel_anzeige: Option<String>,
}

/// Der Abruf, der für das Objekt im Raum `br_id` gilt, oder `None`.
pub async fn offener_abruf_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    typ: ObjektTyp,
    objekt_id: i64,
    br_id: i64,
) -> Result<Option<OffenerAbruf>, AppError> {
    let zeile: Option<(i64, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT b.id, b.mit_abruf_id, COALESCE(b.ziel_anzeige, w.ziel_anzeige) \
         FROM br_belegung b LEFT JOIN br_belegung w ON w.id = b.mit_abruf_id \
         WHERE b.id = (SELECT MAX(x.id) FROM br_belegung x \
                       WHERE x.objekt_typ = ?2 AND x.objekt_id = ?3 AND x.einsatz_id = ?1) \
           AND b.art = 'abruf' AND b.br_id = ?4",
    )
    .bind(einsatz_id)
    .bind(typ.as_str())
    .bind(objekt_id)
    .bind(br_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(zeile.map(|(id, mit_abruf_id, ziel_anzeige)| OffenerAbruf {
        id,
        mit_abruf_id,
        ziel_anzeige,
    }))
}

/// Untereinheiten, die mit dem Abruf `abruf_id` mitgenommen wurden und es noch sind: ihr
/// jüngstes Ereignis ist ein Abruf mit `mit_abruf_id = abruf_id` im Raum, in dem sie stehen
/// (design.md D10). Eine eigens abgerufene, zurückgenommene oder ausgerückte fehlt. Nach Name.
pub async fn mitgenommene_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    abruf_id: i64,
) -> Result<Vec<(i64, String)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT e.id, e.name FROM br_belegung b \
         JOIN einsatz_einheit e ON e.id = b.objekt_id AND e.einsatz_id = b.einsatz_id \
         WHERE b.br_id = ?2 AND b.einsatz_id = ?1 AND b.objekt_typ = 'einheit' \
           AND b.art = 'abruf' AND b.mit_abruf_id = ?3 \
           AND e.aktueller_br_id = ?2 AND e.aufgeloest_at IS NULL \
           AND b.id = (SELECT MAX(x.id) FROM br_belegung x \
                       WHERE x.objekt_typ = 'einheit' AND x.objekt_id = e.id \
                         AND x.einsatz_id = e.einsatz_id) \
         ORDER BY e.name, e.id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(abruf_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Ein Belegungsereignis mit den Spalten des Abrufs (LLH-1085, design.md D4).
#[derive(Debug, Clone, Copy)]
pub(super) struct NeuesEreignis<'a> {
    pub art: BrBelegungsArt,
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    pub notiz: Option<&'a str>,
    /// Ziel-Abschnitt und sein Name.
    pub ziel: Option<(i64, &'a str)>,
    pub auftrag_id: Option<i64>,
    pub mit_abruf_id: Option<i64>,
}

/// Schreibt ein [`NeuesEreignis`] mit Zeitpunkt der Serveruhr; liefert seine id.
pub(super) async fn insert_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    e: &NeuesEreignis<'_>,
    erfasst_von: i64,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar::<_, i64>(
        "INSERT INTO br_belegung \
            (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, erfasst_von, \
             ziel_abschnitt_id, ziel_anzeige, auftrag_id, mit_abruf_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(e.objekt_typ.as_str())
    .bind(e.objekt_id)
    .bind(e.art.as_str())
    .bind(e.notiz)
    .bind(erfasst_von)
    .bind(e.ziel.map(|(id, _)| id))
    .bind(e.ziel.map(|(_, name)| name))
    .bind(e.auftrag_id)
    .bind(e.mit_abruf_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Lädt den Raum in der Transaktion und verlangt „aktiv, nicht storniert“: fremd → `NotFound`,
/// sonst `UnprocessableEntity` (422). `repo::laden_tx` liefert auch stornierte BRs; ein
/// stornierter BR behält `status='aktiv'` (storniere setzt nur `storniert_at`), daher zusätzlich
/// `storniert_at IS NULL` fordern — analog UHS (`pruefe_uhs_aktiv`).
pub async fn require_belegbar_tx(
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
    austritt_einheit_tx(
        conn,
        einsatz_id,
        einheit_id,
        benutzer_id,
        "Einheit aufgelöst",
    )
    .await
}

/// Austritt einer Einheit aus ihrem aktuellen Raum mit `notiz`, Cache geleert, in der Transaktion
/// des Aufrufers; `None`, wenn sie in keinem Raum steht. Gemeinsam für Auflösen und den Storno
/// einer Übernahme aus einer Nachforderung (LLH-1388, design.md D3).
pub async fn austritt_einheit_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
    notiz: &str,
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
        Some(notiz),
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
    austritt_fahrzeug_tx(conn, einsatz_id, ef_id, benutzer_id, "Fahrzeug entlassen").await
}

/// Austritt eines Fahrzeugs aus seinem aktuellen Raum mit `notiz`, Cache geleert, in der
/// Transaktion des Aufrufers; `None`, wenn es in keinem steht. Gemeinsam für das Entlassen und die
/// Überführung eines Fahrzeugs in eine Einheit bei der Übernahme aus einer Nachforderung
/// (LLH-1448, Change `o659va5r-nachforderung-herkunft` D5).
pub async fn austritt_fahrzeug_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    benutzer_id: i64,
    notiz: &str,
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
        Some(notiz),
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

/// Notiz des Austritts, wenn ein Fahrzeug aus dem Raum einer Einheit zugeordnet wird (LLH-1288).
pub const NOTIZ_EINHEIT_ZUGEORDNET: &str = "Einheit zugeordnet";

/// Fahrzeuge, die ohne Einheit in einem Raum stehen und einer Einheit zugeordnet werden, treten
/// aus (Notiz [`NOTIZ_EINHEIT_ZUGEORDNET`], Cache geleert, LLH-1288): danach stehen sie nur noch
/// unter ihrer Einheit, statt die Belegung verwaisen zu lassen. In der Transaktion des Aufrufers,
/// mit einer von der Zahl der Fahrzeuge unabhängigen Zahl von Anweisungen (`src/AGENTS.md`,
/// „ID-Listen“). Liefert die verlassenen Räume, je Raum einmal. Ein abgerufenes Fahrzeug →
/// `Conflict`, nichts geschrieben (der Abruf stünde sonst ohne Kraft, wie bei der Übernahme aus
/// einer Nachforderung, LLH-1448).
pub async fn austritt_fahrzeuge_bei_zuordnung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_ids: &[i64],
    benutzer_id: i64,
) -> Result<Vec<i64>, AppError> {
    let ids = crate::kraefte_disposition::ids_json(ef_ids);
    // „Abgerufen“ wie in [`offener_abruf_tx`]: das jüngste Ereignis ist ein Abruf im Raum, in
    // dem das Fahrzeug steht.
    let abgerufen: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_fahrzeug ef \
           WHERE ef.einsatz_id = ?1 AND ef.aktueller_br_id IS NOT NULL \
             AND ef.id IN (SELECT value FROM json_each(?2)) \
             AND EXISTS (SELECT 1 FROM br_belegung b \
                 WHERE b.id = (SELECT MAX(x.id) FROM br_belegung x \
                               WHERE x.einsatz_id = ef.einsatz_id AND x.objekt_typ = ?3 \
                                 AND x.objekt_id = ef.id) \
                   AND b.art = ?4 AND b.br_id = ef.aktueller_br_id))",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .bind(ObjektTyp::Fahrzeug.as_str())
    .bind(BrBelegungsArt::Abruf.as_str())
    .fetch_one(&mut *conn)
    .await?;
    if abgerufen {
        return Err(AppError::Conflict(
            "Das Fahrzeug ist abgerufen; erst nach dem Ausrücken oder dem Zurücknehmen des \
             Abrufs einer Einheit zuordnen"
                .into(),
        ));
    }
    let mut raeume: Vec<i64> = sqlx::query_scalar(
        "INSERT INTO br_belegung \
            (einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, erfasst_von) \
         SELECT einsatz_id, aktueller_br_id, ?3, id, ?4, ?5, ?6 FROM einsatz_fahrzeug \
         WHERE einsatz_id = ?1 AND aktueller_br_id IS NOT NULL \
           AND id IN (SELECT value FROM json_each(?2)) \
         ORDER BY id \
         RETURNING br_id",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .bind(ObjektTyp::Fahrzeug.as_str())
    .bind(BrBelegungsArt::Austritt.as_str())
    .bind(NOTIZ_EINHEIT_ZUGEORDNET)
    .bind(benutzer_id)
    .fetch_all(&mut *conn)
    .await?;
    if raeume.is_empty() {
        return Ok(raeume);
    }
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET aktueller_br_id = NULL \
         WHERE einsatz_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
    )
    .bind(einsatz_id)
    .bind(&ids)
    .execute(&mut *conn)
    .await?;
    raeume.sort_unstable();
    raeume.dedup();
    Ok(raeume)
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
/// Raum (`Some`), sein jüngstes Belegungsereignis der Arten `eintritt`, `wechsel`, `austritt`:
/// Abruf und Rücknahme ändern „seit“ nicht (LLH-1085, design.md D3). EINE Abfrage, getrieben von den Objekten im
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
               AND x.einsatz_id = e.einsatz_id \
               AND x.art IN ('eintritt', 'wechsel', 'austritt')) \
         WHERE e.einsatz_id = ?1 AND e.aktueller_br_id IS NOT NULL \
           AND e.aufgeloest_at IS NULL AND (?2 IS NULL OR e.aktueller_br_id = ?2) \
         UNION ALL \
         SELECT 'fahrzeug', f.id, f.aktueller_br_id, b.br_id, b.art, b.zeitpunkt_at \
         FROM einsatz_fahrzeug f \
         JOIN br_belegung b ON b.id = ( \
             SELECT MAX(x.id) FROM br_belegung x \
             WHERE x.objekt_typ = 'fahrzeug' AND x.objekt_id = f.id \
               AND x.einsatz_id = f.einsatz_id \
               AND x.art IN ('eintritt', 'wechsel', 'austritt')) \
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

/// Je Kraft, die gerade abgerufen im Raum steht (`br_id = None`: in irgendeinem Raum des
/// Einsatzes), ihr Abruf (LLH-1085, design.md D3, Spec `bereitstellungsraum-belegung`, „Detail
/// nennt den Abruf“): das jüngste Ereignis überhaupt ist ein `abruf` in dem Raum, in dem die Kraft
/// laut Cache steht. Eine mitgenommene Untereinheit trägt Ziel und Einheit ihres Verbands, den
/// Auftrag nur die abgerufene Kraft selbst. EINE Abfrage, getrieben von den Objekten im Raum.
pub async fn abruf_je_objekt(
    pool: &SqlitePool,
    einsatz_id: i64,
    br_id: Option<i64>,
) -> Result<HashMap<(ObjektTyp, i64), BrAbrufKurz>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Zeile {
        objekt_typ: String,
        objekt_id: i64,
        seit_at: String,
        ziel_abschnitt_id: Option<i64>,
        ziel_anzeige: Option<String>,
        auftrag_id: Option<i64>,
        auftrag_nr: Option<i64>,
        mit_objekt_id: Option<i64>,
    }
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "WITH kraft(objekt_typ, objekt_id, raum) AS ( \
             SELECT 'einheit', id, aktueller_br_id FROM einsatz_einheit \
             WHERE einsatz_id = ?1 AND aktueller_br_id IS NOT NULL AND aufgeloest_at IS NULL \
               AND (?2 IS NULL OR aktueller_br_id = ?2) \
             UNION ALL \
             SELECT 'fahrzeug', id, aktueller_br_id FROM einsatz_fahrzeug \
             WHERE einsatz_id = ?1 AND aktueller_br_id IS NOT NULL AND beendet_at IS NULL \
               AND (?2 IS NULL OR aktueller_br_id = ?2)) \
         SELECT k.objekt_typ, k.objekt_id, b.zeitpunkt_at AS seit_at, \
                COALESCE(b.ziel_abschnitt_id, w.ziel_abschnitt_id) AS ziel_abschnitt_id, \
                COALESCE(b.ziel_anzeige, w.ziel_anzeige) AS ziel_anzeige, \
                b.auftrag_id, a.lfd_nr AS auftrag_nr, w.objekt_id AS mit_objekt_id \
         FROM kraft k \
         JOIN br_belegung b ON b.id = ( \
             SELECT MAX(x.id) FROM br_belegung x \
             WHERE x.objekt_typ = k.objekt_typ AND x.objekt_id = k.objekt_id \
               AND x.einsatz_id = ?1) \
         LEFT JOIN br_belegung w ON w.id = b.mit_abruf_id \
         LEFT JOIN auftrag a ON a.id = b.auftrag_id \
         WHERE b.art = 'abruf' AND b.br_id = k.raum",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .fetch_all(pool)
    .await?;
    zeilen
        .into_iter()
        .map(|z| {
            let typ = ObjektTyp::try_from(z.objekt_typ).map_err(AppError::Internal)?;
            Ok((
                (typ, z.objekt_id),
                BrAbrufKurz {
                    seit_at: z.seit_at,
                    ziel_abschnitt_id: z.ziel_abschnitt_id,
                    ziel_anzeige: z.ziel_anzeige,
                    auftrag_id: z.auftrag_id,
                    auftrag_nr: z.auftrag_nr,
                    mit_objekt_id: z.mit_objekt_id,
                },
            ))
        })
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
    abruf_ziel: Option<String>,
    auftrag_nr: Option<i64>,
    mit_einheit: Option<String>,
}

/// Verlauf eines Raums (LLH-1095, design.md D5, Spec `bereitstellungsraum-belegung`, „Verlauf
/// eines Raums lesen“): jedes Ereignis mit `br_id = bid` und jeder Wechsel aus `bid` hinaus,
/// ungeblättert, neueste zuerst nach `id`. EINE Abfrage über die ganzen Reihen nur der Objekte,
/// die je in `bid` standen; `LAG` liefert den Raum davor. Ein Abruf nennt sein Ziel (bei einer
/// mitgenommenen Untereinheit das ihres Verbands) und die Auftragsnummer, ein Austritt direkt
/// nach einem Abruf dessen Ziel (LLH-1085, design.md D5/D12). Der Aufrufer prüft Einsatz und Raum.
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
                    b.auftrag_id, v.objekt_id AS mit_objekt_id, \
                    COALESCE(b.ziel_anzeige, v.ziel_anzeige) AS abruf_ziel, \
                    LAG(b.br_id) OVER fenster AS vorher_br_id, \
                    LAG(b.art) OVER fenster AS vorher_art, \
                    LAG(COALESCE(b.ziel_anzeige, v.ziel_anzeige)) OVER fenster AS vorher_ziel \
             FROM objekte o \
             JOIN br_belegung b ON b.objekt_typ = o.objekt_typ AND b.objekt_id = o.objekt_id \
             LEFT JOIN br_belegung v ON v.id = b.mit_abruf_id \
             WHERE b.einsatz_id = ?1 \
             WINDOW fenster AS (PARTITION BY b.objekt_typ, b.objekt_id ORDER BY b.id)) \
         SELECT r.id, r.zeitpunkt_at, r.art, r.br_id, r.objekt_typ, r.objekt_id, r.notiz, \
                COALESCE(CASE r.objekt_typ WHEN 'einheit' THEN e.name \
                                           ELSE f.snap_funkrufname END, '') AS objekt_name, \
                CASE WHEN r.vorher_art <> 'austritt' THEN vb.bezeichnung END \
                    AS vorher_bezeichnung, \
                zb.bezeichnung AS ziel_bezeichnung, \
                CASE r.art WHEN 'abruf' THEN r.abruf_ziel \
                           WHEN 'austritt' THEN CASE WHEN r.vorher_art = 'abruf' \
                                                     THEN r.vorher_ziel END END AS abruf_ziel, \
                a.lfd_nr AS auftrag_nr, me.name AS mit_einheit \
         FROM reihe r \
         LEFT JOIN einsatz_einheit e ON r.objekt_typ = 'einheit' AND e.id = r.objekt_id \
         LEFT JOIN einsatz_fahrzeug f ON r.objekt_typ = 'fahrzeug' AND f.id = r.objekt_id \
         LEFT JOIN bereitstellungsraum vb ON vb.id = r.vorher_br_id \
         LEFT JOIN bereitstellungsraum zb ON zb.id = r.br_id \
         LEFT JOIN auftrag a ON a.id = r.auftrag_id \
         LEFT JOIN einsatz_einheit me ON me.id = r.mit_objekt_id \
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
                "austritt" => (BrVerlaufArt::Austritt, None, z.abruf_ziel),
                "abruf" => (BrVerlaufArt::Abruf, None, z.abruf_ziel),
                "abruf_aufgehoben" => (BrVerlaufArt::AbrufAufgehoben, None, None),
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
                auftrag_nr: z.auftrag_nr,
                mit_einheit: z.mit_einheit,
            })
        })
        .collect()
}

// ─── Interne Helpers ────────────────────────────────────────────────────────

/// Der aktuelle Raum eines einheitenlosen Fahrzeugs, mit den Prüfungen der Belegung: fremd 404,
/// entlassen oder storniert 409 (LLH-1079), einer Einheit zugehörig 409 (Einheit bringt
/// Fahrzeuge). [`belege_tx`] und die Übernahme eines Fahrzeugs als Einheit beim Eintreffen
/// (LLH-1444, `eintreffen::fahrzeug_als_einheit_tx`) teilen sie.
pub(crate) async fn einheitenloses_fahrzeug_br_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<i64>, AppError> {
    crate::fahrzeug::disposition_repo::require_aktiv_tx(&mut *conn, einsatz_id, ef_id).await?;
    let row: Option<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT einheit_id, aktueller_br_id FROM einsatz_fahrzeug \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let (einheit_id, aktueller_br_id) = row.ok_or(AppError::NotFound)?;
    // Einheit-bringt-Fahrzeuge: ein Fahrzeug mit Einheit belegt nicht selbst.
    if einheit_id.is_some() {
        return Err(AppError::Conflict(
            "Fahrzeug gehört einer Einheit — Belegung nur für einheitenlose Fahrzeuge möglich"
                .into(),
        ));
    }
    Ok(aktueller_br_id)
}

/// Prüft die Art-Vorbedingung (Annahme 4 der Spec):
/// - eintritt: aktueller_br_id muss NULL sein
/// - wechsel / austritt: aktueller_br_id muss gesetzt sein
/// - austritt zusätzlich: der übergebene `br_id` muss dem `aktueller_br_id` des
///   Objekts entsprechen — sonst trägt das Event eine falsche br_id (ETB-Text
///   „verlässt BR X" wäre falsch). Bei Mismatch `Conflict`.
pub(super) fn check_art_vorbedingung(
    art: &BrBelegungsArt,
    aktueller_br_id: Option<i64>,
    br_id: i64,
) -> Result<(), AppError> {
    match art {
        // Abruf und Rücknahme haben eigene Routen (LLH-1085, design.md D2).
        BrBelegungsArt::Abruf | BrBelegungsArt::AbrufAufgehoben => {
            Err(AppError::UnprocessableEntity(
                "Abruf und Rücknahme über …/abruf, nicht über die Belegung".into(),
            ))
        }
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
        BrBelegungsArt::Eintritt
        | BrBelegungsArt::Wechsel
        | BrBelegungsArt::Abruf
        | BrBelegungsArt::AbrufAufgehoben => Some(br_id),
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
        let br = br_repo::create(
            pool,
            einsatz_id,
            benutzer_id,
            br_repo::NeueDaten {
                bezeichnung: bez,
                abschnitt_id: None,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
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

    /// Ein BR-Fahrzeug mit Einheit und `aktueller_br_id` (Altbestand aus der Zeit vor LLH-1288:
    /// das Zuordnen beendet die Belegung jetzt) zählt trotzdem einmal (Scope-Frage 6).
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
        let br = br_repo::create(
            &pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: "BR Geplant",
                abschnitt_id: None,
                standort: None,
                notiz: None,
                lat: None,
                lon: None,
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
            .unwrap()
            .ereignis;
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
        .unwrap()
        .ereignis;
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

    // ─── Abruf lesen (LLH-1085, design.md D3, D5, D12) ──────────────────────────

    use crate::bereitstellungsraum::abruf::{self, AbrufDaten, Startwerte};

    fn auftrag_an(einheit_id: i64) -> crate::auftrag::repo::AuftragDaten<'static> {
        crate::auftrag::repo::AuftragDaten {
            auftrag_text: "Sandsackverbau",
            absicht: None,
            lage: None,
            ort: Some("EA Deich"),
            ort_punkt: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            weg: None,
            prioritaet: "normal",
            richtung: "intern",
            frist_at: None,
            erteilt_at: "2026-10-16 14:30:00",
            empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                empfaenger_typ: "einheit".into(),
                abschnitt_id: None,
                einheit_id: Some(einheit_id),
                person_id: None,
                fahrzeug_id: None,
                funktion_text: None,
                funktion: None,
                extern_kategorie: None,
                extern_bezeichnung: None,
            }],
        }
    }

    async fn rufe_ab(
        pool: &SqlitePool,
        (b, e, br): (i64, i64, i64),
        daten: AbrufDaten<'_>,
    ) -> abruf::AbrufErgebnis {
        let mut tx = pool.begin().await.unwrap();
        let startwerte = Startwerte {
            auftrag: 1,
            etb: 1,
            auto_etb: false,
        };
        let r = abruf::abruf_tx(&mut tx, e, br, &daten, startwerte, b)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        r
    }

    async fn hebe_auf(pool: &SqlitePool, (b, e, br): (i64, i64, i64), typ: ObjektTyp, id: i64) {
        let mut tx = pool.begin().await.unwrap();
        abruf::aufheben_tx(&mut tx, e, br, typ, id, b)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    fn abruf_von(typ: ObjektTyp, id: i64) -> AbrufDaten<'static> {
        AbrufDaten {
            objekt_typ: typ,
            objekt_id: id,
            abschnitt: None,
            auftrag: None,
            ausgerueckt: false,
        }
    }

    async fn abschnitt_namens(pool: &SqlitePool, e: i64, name: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id",
        )
        .bind(e)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn juengste_id(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT MAX(id) FROM br_belegung")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// Eintritt 13:42, Abruf 14:30 mit Ziel und Auftrag: „seit“ bleibt 13:42, der Abruf trägt
    /// 14:30, Ziel und Auftragsnummer; nach der Rücknahme kein Abruf, „seit“ weiter 13:42.
    #[tokio::test]
    async fn seit_uebergeht_abruf_und_ruecknahme() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let deich = abschnitt_namens(&pool, e, "EA Deich").await;
        let hlf = einheit_namens(&pool, e, "HLF 20").await;
        let ein = belege(&pool, e, br, "einheit", hlf, "eintritt", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, ein.id, "2026-10-16 13:42:00").await;
        let auftrag = auftrag_an(hlf);
        let r = rufe_ab(
            &pool,
            (b, e, br),
            AbrufDaten {
                abschnitt: Some((deich, "EA Deich")),
                auftrag: Some(&auftrag),
                ..abruf_von(ObjektTyp::Einheit, hlf)
            },
        )
        .await;
        zeitpunkt(&pool, r.abruf_id, "2026-10-16 14:30:00").await;

        let seit_hlf = Some("2026-10-16 13:42:00".to_string());
        assert_eq!(seit(&pool, e, ObjektTyp::Einheit, hlf).await, seit_hlf);
        assert_eq!(kennzahlen(&pool, e, br).await.laengste_seit_at, seit_hlf);
        let abrufe = abruf_je_objekt(&pool, e, Some(br)).await.unwrap();
        assert_eq!(
            abrufe.get(&(ObjektTyp::Einheit, hlf)),
            Some(&BrAbrufKurz {
                seit_at: "2026-10-16 14:30:00".into(),
                ziel_abschnitt_id: Some(deich),
                ziel_anzeige: Some("EA Deich".into()),
                auftrag_id: r.auftrag_id,
                auftrag_nr: Some(1),
                mit_objekt_id: None,
            })
        );

        hebe_auf(&pool, (b, e, br), ObjektTyp::Einheit, hlf).await;
        assert!(abruf_je_objekt(&pool, e, None).await.unwrap().is_empty());
        assert_eq!(seit(&pool, e, ObjektTyp::Einheit, hlf).await, seit_hlf);
    }

    /// Nach Rücknahme und Wechsel in einen anderen Raum gibt es keinen Abruf mehr; einen Wechsel
    /// einer abgerufenen Kraft lehnt `belege_tx` mit 422 ab (D12).
    #[tokio::test]
    async fn wechsel_nur_nach_ruecknahme_und_ohne_abruf() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let schule = aktiven_br(&pool, e, b, "Schule").await;
        let hlf = einheit_namens(&pool, e, "HLF 20").await;
        belege(&pool, e, br, "einheit", hlf, "eintritt", None, b)
            .await
            .unwrap();
        rufe_ab(&pool, (b, e, br), abruf_von(ObjektTyp::Einheit, hlf)).await;
        let vorher = juengste_id(&pool).await;
        let r = belege(&pool, e, schule, "einheit", hlf, "wechsel", None, b).await;
        assert!(matches!(r, Err(AppError::UnprocessableEntity(_))), "{r:?}");
        assert_eq!(juengste_id(&pool).await, vorher, "nichts geschrieben");
        assert_eq!(cache_einheit(&pool, hlf).await, Some(br));

        hebe_auf(&pool, (b, e, br), ObjektTyp::Einheit, hlf).await;
        belege(&pool, e, schule, "einheit", hlf, "wechsel", None, b)
            .await
            .unwrap();
        assert!(abruf_je_objekt(&pool, e, None).await.unwrap().is_empty());
        assert!(seit(&pool, e, ObjektTyp::Einheit, hlf).await.is_some());
    }

    /// Ein einheitenloses Fahrzeug gilt wie eine Einheit als abgerufen; „seit“ bleibt.
    #[tokio::test]
    async fn fahrzeug_ohne_einheit_abgerufen() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let fz = fahrzeug_namens(&pool, e, "Florian 1/83-1", None).await;
        let ein = belege(&pool, e, br, "fahrzeug", fz, "eintritt", None, b)
            .await
            .unwrap();
        zeitpunkt(&pool, ein.id, "2026-10-16 13:42:00").await;
        rufe_ab(&pool, (b, e, br), abruf_von(ObjektTyp::Fahrzeug, fz)).await;
        let abrufe = abruf_je_objekt(&pool, e, Some(br)).await.unwrap();
        let a = abrufe.get(&(ObjektTyp::Fahrzeug, fz)).expect("abgerufen");
        assert_eq!((a.ziel_anzeige.as_deref(), a.auftrag_nr), (None, None));
        assert_eq!(
            seit(&pool, e, ObjektTyp::Fahrzeug, fz).await.as_deref(),
            Some("2026-10-16 13:42:00")
        );
    }

    /// Eine mitgenommene Untereinheit trägt Ziel und Einheit ihres Verbands, keinen Auftrag; wird
    /// der Abschnitt gelöscht, fällt der Bezug weg und der Name bleibt (D5).
    #[tokio::test]
    async fn untereinheit_traegt_verband_und_ziel_bleibt_nach_loeschen() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let deich = abschnitt_namens(&pool, e, "EA Deich").await;
        let zug = einheit_namens(&pool, e, "1. Zug").await;
        let g1 = einheit_namens(&pool, e, "Gruppe 1").await;
        sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
            .bind(zug)
            .bind(g1)
            .execute(&pool)
            .await
            .unwrap();
        for id in [zug, g1] {
            belege(&pool, e, br, "einheit", id, "eintritt", None, b)
                .await
                .unwrap();
        }
        let auftrag = auftrag_an(zug);
        rufe_ab(
            &pool,
            (b, e, br),
            AbrufDaten {
                abschnitt: Some((deich, "EA Deich")),
                auftrag: Some(&auftrag),
                ..abruf_von(ObjektTyp::Einheit, zug)
            },
        )
        .await;
        let abrufe = abruf_je_objekt(&pool, e, Some(br)).await.unwrap();
        let gruppe = abrufe.get(&(ObjektTyp::Einheit, g1)).expect("mitgenommen");
        assert_eq!(gruppe.mit_objekt_id, Some(zug));
        assert_eq!(gruppe.ziel_anzeige.as_deref(), Some("EA Deich"));
        assert_eq!((gruppe.auftrag_id, gruppe.auftrag_nr), (None, None));
        assert_eq!(abrufe[&(ObjektTyp::Einheit, zug)].mit_objekt_id, None);

        sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE abschnitt_id = ?")
            .bind(deich)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM einsatzabschnitt WHERE id = ?")
            .bind(deich)
            .execute(&pool)
            .await
            .unwrap();
        let abrufe = abruf_je_objekt(&pool, e, Some(br)).await.unwrap();
        let wurzel = &abrufe[&(ObjektTyp::Einheit, zug)];
        assert_eq!(wurzel.ziel_abschnitt_id, None);
        assert_eq!(wurzel.ziel_anzeige.as_deref(), Some("EA Deich"));
    }

    /// Verlauf „Abruf und Ausrücken“: der Austritt nennt das Ziel des Abrufs, der Abruf Ziel und
    /// Auftragsnummer, die mitgenommene Untereinheit ihre Einheit (Spec, „Verlauf eines Raums
    /// lesen“).
    #[tokio::test]
    async fn verlauf_abruf_und_ausruecken() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let deich = abschnitt_namens(&pool, e, "EA Deich").await;
        let hlf = einheit_namens(&pool, e, "HLF 20").await;
        let g1 = einheit_namens(&pool, e, "Gruppe 1").await;
        sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
            .bind(hlf)
            .bind(g1)
            .execute(&pool)
            .await
            .unwrap();
        for id in [hlf, g1] {
            belege(&pool, e, br, "einheit", id, "eintritt", None, b)
                .await
                .unwrap();
        }
        let auftrag = auftrag_an(hlf);
        rufe_ab(
            &pool,
            (b, e, br),
            AbrufDaten {
                abschnitt: Some((deich, "EA Deich")),
                auftrag: Some(&auftrag),
                ..abruf_von(ObjektTyp::Einheit, hlf)
            },
        )
        .await;
        let aus = belege_mit_folgen(&pool, e, br, "einheit", hlf, "austritt", None, b)
            .await
            .unwrap();
        assert_eq!(aus.mitgenommen, vec![(g1, "Gruppe 1".to_string())]);
        assert_eq!(
            aus.vorher_abruf.and_then(|a| a.ziel_anzeige).as_deref(),
            Some("EA Deich")
        );

        use BrVerlaufArt::*;
        let v = verlauf(&pool, e, br).await.unwrap();
        assert_eq!(
            kurz(&v),
            vec![
                (Austritt, "Gruppe 1", Some("EA Deich"), None),
                (Austritt, "HLF 20", Some("EA Deich"), None),
                (
                    Abruf,
                    "Gruppe 1",
                    Some("EA Deich"),
                    Some("mit HLF 20 abgerufen")
                ),
                (Abruf, "HLF 20", Some("EA Deich"), None),
                (Eintritt, "Gruppe 1", None, None),
                (Eintritt, "HLF 20", None, None),
            ]
        );
        assert_eq!(v[3].auftrag_nr, Some(1));
        assert_eq!(v[2].auftrag_nr, None);
        assert_eq!(v[2].mit_einheit.as_deref(), Some("HLF 20"));
        assert_eq!(v[3].mit_einheit, None);
    }

    /// Verlauf „Rücknahme“: `abruf_aufgehoben` ohne Ziel, ein späterer Austritt ohne Ziel.
    #[tokio::test]
    async fn verlauf_ruecknahme() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "Sportplatz").await;
        let deich = abschnitt_namens(&pool, e, "EA Deich").await;
        let hlf = einheit_namens(&pool, e, "HLF 20").await;
        belege(&pool, e, br, "einheit", hlf, "eintritt", None, b)
            .await
            .unwrap();
        rufe_ab(
            &pool,
            (b, e, br),
            AbrufDaten {
                abschnitt: Some((deich, "EA Deich")),
                ..abruf_von(ObjektTyp::Einheit, hlf)
            },
        )
        .await;
        hebe_auf(&pool, (b, e, br), ObjektTyp::Einheit, hlf).await;
        let aus = belege_mit_folgen(&pool, e, br, "einheit", hlf, "austritt", None, b)
            .await
            .unwrap();
        assert_eq!(aus.vorher_abruf, None);

        use BrVerlaufArt::*;
        assert_eq!(
            kurz(&verlauf(&pool, e, br).await.unwrap()),
            vec![
                (Austritt, "HLF 20", None, None),
                (AbrufAufgehoben, "HLF 20", None, None),
                (Abruf, "HLF 20", Some("EA Deich"), None),
                (Eintritt, "HLF 20", None, None),
            ]
        );
    }
}

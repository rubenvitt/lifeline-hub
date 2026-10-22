use crate::error::AppError;
use sqlx::SqlitePool;

use super::{adressat_kategorie_gueltig, prioritaet_gueltig, NachforderungAnzeige};
use crate::kommunikation::AdressatKategorie;

/// Kurzname einer Nachforderung im ETB: „2× RTW“, ohne Anzahl nur die Art.
fn kurzname(anzahl: Option<i64>, art: &str) -> String {
    match anzahl {
        Some(a) => format!("{a}× {art}"),
        None => art.to_string(),
    }
}

/// An des ETB-Eintrags einer Nachforderung (LLH-1104 D5): Kategorie und Bezeichnung wie die
/// Karte, „Leitstelle (ILS Nord)“. Nennt die Bezeichnung die Kategorie schon („Leitstelle
/// Nord“), steht sie allein; ohne Bezeichnung steht die Kategorie allein.
pub fn adressat_text(kategorie: AdressatKategorie, bezeichnung: Option<&str>) -> String {
    let label = kategorie.label();
    match bezeichnung.map(str::trim).filter(|b| !b.is_empty()) {
        None => label.to_string(),
        Some(b) if b.to_lowercase().contains(&label.to_lowercase()) => b.to_string(),
        Some(b) => format!("{label} ({b})"),
    }
}

/// Inhalt des Systemeintrags einer Stufe (LLH-1104 D6): „Nachforderung 2× RTW: zugesagt“, eine
/// Rücknahme „…: zurückgesetzt auf angefordert“, eine Ablehnung mit Grund in Klammern.
fn stufen_text(kurz: &str, neu: &str, rueckwaerts: bool, grund: Option<&str>) -> String {
    match (rueckwaerts, grund) {
        (true, _) => format!("Nachforderung {kurz}: zurückgesetzt auf {neu}"),
        (false, Some(g)) => format!("Nachforderung {kurz}: {neu} ({g})"),
        (false, None) => format!("Nachforderung {kurz}: {neu}"),
    }
}

/// Schreibt den Systemeintrag einer vollzogenen Stufe in der laufenden Transaktion und setzt
/// seinen Verweis auf die Nachforderung (LLH-1104 D6). Liefert die Kennung des Eintrags.
async fn stufe_protokollieren_tx(
    conn: &mut sqlx::SqliteConnection,
    id: i64,
    erfasser_id: i64,
    neu: &str,
    rueckwaerts: bool,
    grund: Option<&str>,
) -> Result<i64, AppError> {
    let (einsatz_id, art, anzahl): (i64, String, Option<i64>) =
        sqlx::query_as("SELECT einsatz_id, art, anzahl FROM nachforderung WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id)
        .await?
        .etb_startwert();
    let inhalt = stufen_text(&kurzname(anzahl, &art), neu, rueckwaerts, grund);
    let etb_id =
        crate::etb::system_audit_tx(&mut *conn, einsatz_id, erfasser_id, startwert, &inhalt)
            .await?;
    sqlx::query("UPDATE etb_eintrag SET nachforderung_id = ? WHERE id = ?")
        .bind(id)
        .bind(etb_id)
        .execute(&mut *conn)
        .await?;
    Ok(etb_id)
}

/// Validierte Eingabe für eine neue Nachforderung (Handler hat getrimmt/normalisiert).
/// `Default` nur für Testdaten: leere Priorität und Kategorie sind ungültig.
#[derive(Debug, Default)]
pub struct NachforderungDaten<'a> {
    pub art: &'a str,
    /// Details/Zweck, optional (LLH-1089).
    pub bezeichnung: Option<&'a str>,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: &'a str,
    pub adressat_bezeichnung: Option<&'a str>,
    pub begruendung: Option<&'a str>,
    pub prioritaet: &'a str,
    pub angefordert_at: &'a str,
    /// Betreuungsstelle, für die angefordert wird (LLH-1082); Einsatz und Lebenszyklus hat die
    /// Route geprüft.
    pub betreuungsstelle_id: Option<i64>,
    /// Ziel (LLH-1089 design.md D5): höchstens eines; Einsatz, Lebenszyklus und die Zahl hat die
    /// Route geprüft (der CHECK der Tabelle hält Letztere zusätzlich).
    pub ziel_br_id: Option<i64>,
    pub ziel_abschnitt_id: Option<i64>,
    pub ziel_text: Option<&'a str>,
    /// Bedarfszeit „benötigt bis“, normalisiert (UTC); `None` = sofort.
    pub benoetigt_bis: Option<&'a str>,
}

/// Inhalt des ETB-Eintrags der Anlage (LLH-1089 design.md D9): „Nachforderung: 2× RTW → BR Nord,
/// benötigt bis 21.10. 15:30 — Transport aus der UHS“. Ziel, Bedarfszeit und Details stehen nur,
/// wenn gesetzt. `bis` ist schon in der Anzeigezone formatiert.
pub fn anlage_text(
    kurz: &str,
    ziel: Option<&str>,
    bis: Option<&str>,
    details: Option<&str>,
) -> String {
    let mut text = format!("Nachforderung: {kurz}");
    if let Some(z) = ziel {
        text.push_str(&format!(" → {z}"));
    }
    if let Some(b) = bis {
        text.push_str(&format!(", benötigt bis {b}"));
    }
    if let Some(d) = details {
        text.push_str(&format!(" — {d}"));
    }
    text
}

/// Name des Ziels für den ETB-Wortlaut, in der Transaktion der Anlage aus der Zeile gelesen
/// (Raum: Bezeichnung, Abschnitt: Name, sonst der Freitext). `NotFound`, wenn der Bezug nicht zum
/// Einsatz gehört — die Route hat das geprüft, die Transaktion sieht es ein zweites Mal.
async fn ziel_name_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    daten: &NachforderungDaten<'_>,
) -> Result<Option<String>, AppError> {
    let (sql, id) = match (daten.ziel_br_id, daten.ziel_abschnitt_id) {
        (Some(id), _) => (
            "SELECT bezeichnung FROM bereitstellungsraum WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        (None, Some(id)) => (
            "SELECT name FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
            id,
        ),
        (None, None) => return Ok(daten.ziel_text.map(str::to_string)),
    };
    sqlx::query_scalar::<_, String>(sql)
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .map(Some)
        .ok_or(AppError::NotFound)
}

/// Anzeigezone des Einsatzes für ETB-Texte: Einsatz, sonst Organisation, sonst
/// `einsatz::nummer::ZEITZONE_VORGABE` (dieselbe Folge wie `benachrichtigung::text`).
async fn anzeigezone_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<chrono_tz::Tz, AppError> {
    let zone: Option<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(NULLIF(TRIM(es.zeitzone), ''), oe.zeitzone) \
         FROM einsatz e \
         LEFT JOIN einsatz_einstellungen es ON es.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id \
         WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(crate::einsatz::nummer::zone_oder_vorgabe(
        zone.flatten().as_deref(),
    ))
}

/// SELECT-Projektion inkl. Ersteller-Name (LEFT JOIN benutzer), abgeleitetem `ist_offen` und den
/// übernommenen Materialposten (LLH-1226: nicht stornierte, also auch aus dem Einsatz genommene,
/// design.md D3). Reihenfolge der Spalten = Struct (FromRow positional). Keine
/// computed-time-Spalte → kein `jetzt`-Bind nötig.
const ANZEIGE_SELECT: &str =
    "SELECT n.id, n.einsatz_id, n.art, n.bezeichnung, n.anzahl, n.adressat_kategorie, \
            n.adressat_bezeichnung, n.begruendung, n.prioritaet, n.status, \
            n.zugesagt_at, n.unterwegs_at, n.eingetroffen_at, n.abgelehnt_at, n.abgelehnt_grund, \
            n.angefordert_at, n.etb_nachforderung_id, n.erstellt_von_id, n.erstellt_at, \
            b.anzeigename AS erstellt_von_name, \
            (n.status NOT IN ('eingetroffen', 'abgelehnt')) AS ist_offen, \
            (SELECT json_group_array(em.id ORDER BY em.id) FROM einsatz_material em \
             WHERE em.nachforderung_id = n.id AND em.beendet_als IS NOT 'storniert') \
              AS material_ids, \
            n.betreuungsstelle_id, n.ziel_br_id, n.ziel_abschnitt_id, n.ziel_text, \
            n.benoetigt_bis \
     FROM nachforderung n LEFT JOIN benutzer b ON b.id = n.erstellt_von_id";

/// Lädt eine Nachforderung als Anzeige. `NotFound`, wenn unbekannt.
pub async fn load(pool: &SqlitePool, id: i64) -> Result<NachforderungAnzeige, AppError> {
    sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{ANZEIGE_SELECT} WHERE n.id = ?"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt eine Nachforderung an und erzeugt im selben Commit den ETB-Eintrag (typ='meldung':
/// die Nachforderung ist eine ausgehende Anforderung; Pattern B mit beidseitigem Backlink).
/// Liefert die neue id. `daten` ist vom Handler validiert.
pub async fn create_tx(
    tx: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    ersteller_id: i64,
    etb_startwert: i64,
    daten: &NachforderungDaten<'_>,
) -> Result<i64, AppError> {
    debug_assert!(prioritaet_gueltig(daten.prioritaet));
    debug_assert!(adressat_kategorie_gueltig(daten.adressat_kategorie));

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO nachforderung \
           (einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, adressat_bezeichnung, \
            begruendung, prioritaet, angefordert_at, erstellt_von_id, betreuungsstelle_id, \
            ziel_br_id, ziel_abschnitt_id, ziel_text, benoetigt_bis) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(daten.art)
    .bind(daten.bezeichnung)
    .bind(daten.anzahl)
    .bind(daten.adressat_kategorie)
    .bind(daten.adressat_bezeichnung)
    .bind(daten.begruendung)
    .bind(daten.prioritaet)
    .bind(daten.angefordert_at)
    .bind(ersteller_id)
    .bind(daten.betreuungsstelle_id)
    .bind(daten.ziel_br_id)
    .bind(daten.ziel_abschnitt_id)
    .bind(daten.ziel_text)
    .bind(daten.benoetigt_bis)
    .fetch_one(&mut *tx)
    .await?;

    // ETB-Meldung (Pattern B): die Anforderung erscheint regulär im ETB, immer — unabhängig von
    // „Automatische ETB-Einträge“ (LLH-1104 D4: Führungsvorgang mit Außenwirkung). Von ist die
    // eigene Führungsstelle, An der Adressat (D5).
    let ziel = ziel_name_tx(&mut *tx, einsatz_id, daten).await?;
    let bis = match daten.benoetigt_bis {
        Some(b) => Some(crate::zeitachse::repo::zeit_text(
            b,
            anzeigezone_tx(&mut *tx, einsatz_id).await?,
        )),
        None => None,
    };
    let inhalt = anlage_text(
        &kurzname(daten.anzahl, daten.art),
        ziel.as_deref(),
        bis.as_deref(),
        daten.bezeichnung,
    );
    let von =
        crate::einsatz::fuehrungsstelle::absender_tx(&mut *tx, einsatz_id, ersteller_id).await?;
    let kategorie = AdressatKategorie::parse(daten.adressat_kategorie)
        .ok_or_else(|| AppError::Validation("Ungültige Adressat-Kategorie".into()))?;
    let an = adressat_text(kategorie, daten.adressat_bezeichnung);
    let etb_id = crate::etb::repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        ersteller_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_MELDUNG,
            inhalt: &inhalt,
            von: von.as_deref(),
            an: Some(&an),
            meldeweg: None,
            veranlassung: daten.begruendung,
            ereigniszeit: Some(daten.angefordert_at),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    sqlx::query("UPDATE etb_eintrag SET nachforderung_id = ? WHERE id = ?")
        .bind(id)
        .bind(etb_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE nachforderung SET etb_nachforderung_id = ? WHERE id = ?")
        .bind(etb_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    Ok(id)
}

/// Legt eine Nachforderung an (eigener Commit) und liefert die Anzeige.
pub async fn create(
    pool: &SqlitePool,
    einsatz_id: i64,
    ersteller_id: i64,
    daten: NachforderungDaten<'_>,
) -> Result<NachforderungAnzeige, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    let id = create_tx(&mut tx, einsatz_id, ersteller_id, etb_startwert, &daten).await?;
    tx.commit().await?;
    load(pool, id).await
}

/// Listet Nachforderungen eines Einsatzes (optional Status-Filter). Sortierung:
/// Priorität (sofort→normal), dann neueste Anforderung zuerst, dann id.
pub async fn list(
    pool: &SqlitePool,
    einsatz_id: i64,
    status_filter: Option<&str>,
) -> Result<Vec<NachforderungAnzeige>, AppError> {
    let mut q = format!("{ANZEIGE_SELECT} WHERE n.einsatz_id = ?");
    if status_filter.is_some() {
        q.push_str(" AND n.status = ?");
    }
    q.push_str(
        " ORDER BY CASE n.prioritaet WHEN 'sofort' THEN 0 WHEN 'dringend' THEN 1 ELSE 2 END, \
          n.angefordert_at DESC, n.id DESC",
    );
    let mut query =
        sqlx::query_as::<_, NachforderungAnzeige>(sqlx::AssertSqlSafe(&*q)).bind(einsatz_id);
    if let Some(s) = status_filter {
        query = query.bind(s);
    }
    query.fetch_all(pool).await.map_err(Into::into)
}

/// Zählt die Nachforderungen eines Einsatzes je Status (LLH-1078, Modulzähler): EINE Abfrage ohne
/// Listenspalten (LFH-935), gezählt wird darüber mit [`crate::einsatz::zaehler::zaehle_nachforderungen_gewichtet`].
pub async fn zaehlen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<crate::einsatz::zaehler::NachforderungsZaehler, AppError> {
    let zeilen: Vec<(String, i64)> = sqlx::query_as(
        "SELECT n.status, COUNT(*) FROM nachforderung n WHERE n.einsatz_id = ? GROUP BY n.status",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let gruppen = zeilen
        .into_iter()
        .map(|(status, anzahl)| {
            super::NachforderungStatus::parse(&status)
                .map(|s| (s, anzahl))
                .ok_or_else(|| AppError::Internal(format!("Unbekannter Status: {status}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(crate::einsatz::zaehler::zaehle_nachforderungen_gewichtet(
        gruppen,
    ))
}

/// Cross-Einsatz-Schutz: gehört die Nachforderung zum Einsatz?
pub async fn belongs_to_einsatz(
    pool: &SqlitePool,
    id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let treffer: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM nachforderung WHERE id = ? AND einsatz_id = ?")
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    Ok(treffer.is_some())
}

/// Löst den Bezug aller Nachforderungen auf eine stornierte Betreuungsstelle (LLH-1082,
/// design.md D3), in der Transaktion des Stornos. Die Nachforderungen bleiben sonst unverändert.
/// Liefert die Kennungen der gelösten, damit der Aufrufer nach dem Commit das Live-Ereignis
/// sendet.
pub async fn loese_betreuungsstelle_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    betreuungsstelle_id: i64,
) -> Result<Vec<i64>, AppError> {
    sqlx::query_scalar(
        "UPDATE nachforderung SET betreuungsstelle_id = NULL \
         WHERE einsatz_id = ? AND betreuungsstelle_id = ? RETURNING id",
    )
    .bind(einsatz_id)
    .bind(betreuungsstelle_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(Into::into)
}

/// Trägt die Nachforderung mindestens einen übernommenen, nicht stornierten Materialposten
/// (LLH-1226, design.md D3)? Ein aus dem Einsatz genommener Posten war da und zählt.
pub async fn has_material<'e, E: sqlx::SqliteExecutor<'e>>(
    exec: E,
    id: i64,
) -> Result<bool, AppError> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM einsatz_material em \
         WHERE em.nachforderung_id = ? AND em.beendet_als IS NOT 'storniert')",
    )
    .bind(id)
    .fetch_one(exec)
    .await
    .map_err(Into::into)
}

/// Prüft in der Transaktion einer Übernahme (LLH-1226, design.md D2/D3), ob aus der
/// Nachforderung Material übernommen werden darf, und liefert ihre Bezeichnung für den
/// ETB-Text. `NotFound`, wenn sie nicht zum Einsatz gehört; `UnprocessableEntity`, wenn sie nicht
/// eingetroffen ist; `Conflict`, wenn sie schon einen zählenden Posten trägt und die Anfrage
/// nicht ausdrücklich ergänzt (die Bitte beruht dann auf einem veralteten Stand). Die Zeile der
/// Nachforderung bleibt unverändert.
pub async fn check_uebernahme_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    id: i64,
    ergaenzen: bool,
) -> Result<String, AppError> {
    // Ohne Details (LLH-1089) nennt die Art die Nachforderung.
    let (status, bezeichnung): (String, String) = sqlx::query_as(
        "SELECT status, COALESCE(bezeichnung, art) FROM nachforderung \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if status != super::STATUS_EINGETROFFEN {
        return Err(AppError::UnprocessableEntity(
            "Material wird erst nach dem Eintreffen übernommen".into(),
        ));
    }
    if !ergaenzen && has_material(&mut *conn, id).await? {
        return Err(AppError::Conflict(
            "Aus dieser Nachforderung ist schon Material übernommen".into(),
        ));
    }
    Ok(bezeichnung)
}

/// Stufe im linearen Bedarfsfluss und die Spalte mit ihrem Zeitpunkt; `angefordert` trägt
/// seinen Zeitpunkt in `angefordert_at` ab dem Anlegen, ohne Stempel beim Übergang.
fn stufe(status: &str) -> Option<(u8, Option<&'static str>)> {
    match status {
        super::STATUS_ANGEFORDERT => Some((0, None)),
        super::STATUS_ZUGESAGT => Some((1, Some("zugesagt_at"))),
        super::STATUS_UNTERWEGS => Some((2, Some("unterwegs_at"))),
        super::STATUS_EINGETROFFEN => Some((3, Some("eingetroffen_at"))),
        _ => None,
    }
}

/// Schaltet den Bedarfs-Status um genau eine Stufe weiter oder nimmt ihn um genau eine zurück
/// (LFH-343 · C8). Vorwärts setzt den Zeitstempel der neuen Stufe (first-write-wins via
/// COALESCE); die Rücknahme leert den der verlassenen Stufe (LLH-1247), damit die nächste
/// Meldung ihren eigenen Zeitpunkt trägt und keine Karte einen zurückgenommenen zeigt.
/// `erwartet` ist der vom Handler geprüfte Bestandsstatus: das UPDATE greift NUR, wenn er
/// unverändert ist (optimistische Sperre gegen TOCTOU). `abgelehnt` läuft über [`lehne_ab`]. Die
/// Rücknahme aus `eingetroffen` greift zusätzlich nur ohne zählenden Materialposten (LLH-1226,
/// design.md D9), damit eine gleichzeitige Übernahme keine zurückgenommene Nachforderung mit
/// Posten hinterlässt; die verständliche 422 prüft der Handler vorher über [`has_material`].
///
/// Ein vollzogener Wechsel schreibt in DERSELBEN Transaktion genau einen Systemeintrag ins ETB,
/// auch die Rücknahme (LLH-1104 D6; das ETB löscht nie). Liefert dessen Kennung für das
/// Live-Ereignis; `None` = Status zwischenzeitlich geändert, dann ist nichts geschrieben.
pub async fn update_status(
    pool: &SqlitePool,
    id: i64,
    erfasser_id: i64,
    neuer_status: &str,
    erwartet: &str,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    let ungueltig = || AppError::Validation("Ungültiger Zielstatus".into());
    let (neu_stufe, neu_spalte) = stufe(neuer_status).ok_or_else(ungueltig)?;
    let (alt_stufe, alt_spalte) = stufe(erwartet).ok_or_else(ungueltig)?;
    let (stempel, vorwaerts) = match (neu_stufe, neu_spalte, alt_spalte) {
        (n, Some(spalte), _) if n == alt_stufe + 1 => {
            (format!("{spalte} = COALESCE({spalte}, ?)"), true)
        }
        (n, _, Some(spalte)) if n + 1 == alt_stufe => (format!("{spalte} = NULL"), false),
        _ => return Err(ungueltig()),
    };
    let ohne_posten = if erwartet == super::STATUS_EINGETROFFEN {
        " AND NOT EXISTS (SELECT 1 FROM einsatz_material em \
           WHERE em.nachforderung_id = nachforderung.id AND em.beendet_als IS NOT 'storniert')"
    } else {
        ""
    };
    let sql = format!(
        "UPDATE nachforderung SET status = ?, {stempel} WHERE id = ? AND status = ?{ohne_posten}"
    );
    crate::write_retry!(pool, |conn| {
        let query = sqlx::query(sqlx::AssertSqlSafe(&*sql)).bind(neuer_status);
        let query = if vorwaerts { query.bind(jetzt) } else { query };
        let r = query.bind(id).bind(erwartet).execute(&mut *conn).await?;
        if r.rows_affected() == 0 {
            return Ok(None);
        }
        stufe_protokollieren_tx(conn, id, erfasser_id, neuer_status, !vorwaerts, None)
            .await
            .map(Some)
    })
}

/// Lehnt eine Nachforderung ab (Abzweig): setzt status='abgelehnt', Zeitstempel und Grund —
/// nur wenn der Bestandsstatus `erwartet` unverändert ist (optimistische Sperre). Schreibt in
/// derselben Transaktion den Systemeintrag mit Grund (LLH-1104 D6) und liefert dessen
/// Kennung; `None` = nichts geändert.
pub async fn lehne_ab(
    pool: &SqlitePool,
    id: i64,
    erfasser_id: i64,
    grund: Option<&str>,
    erwartet: &str,
    jetzt: &str,
) -> Result<Option<i64>, AppError> {
    crate::write_retry!(pool, |conn| {
        let r = sqlx::query(
            "UPDATE nachforderung SET status = ?, abgelehnt_at = COALESCE(abgelehnt_at, ?), \
             abgelehnt_grund = COALESCE(abgelehnt_grund, ?) WHERE id = ? AND status = ?",
        )
        .bind(super::STATUS_ABGELEHNT)
        .bind(jetzt)
        .bind(grund)
        .bind(id)
        .bind(erwartet)
        .execute(&mut *conn)
        .await?;
        if r.rows_affected() == 0 {
            return Ok(None);
        }
        stufe_protokollieren_tx(conn, id, erfasser_id, super::STATUS_ABGELEHNT, false, grund)
            .await
            .map(Some)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kommunikation::AdressatKategorie;
    use crate::nachforderung::{
        NachforderungStatus, ADRESSAT_LEITSTELLE, PRIO_NORMAL, STATUS_ANGEFORDERT,
        STATUS_EINGETROFFEN, STATUS_UNTERWEGS, STATUS_ZUGESAGT,
    };

    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'Leit','leit','h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e)
    }

    fn daten<'a>(art: &'a str, bez: &'a str) -> NachforderungDaten<'a> {
        NachforderungDaten {
            art,
            bezeichnung: Some(bez),
            anzahl: Some(2),
            adressat_kategorie: ADRESSAT_LEITSTELLE,
            adressat_bezeichnung: Some("Leitstelle Nord"),
            begruendung: None,
            prioritaet: PRIO_NORMAL,
            angefordert_at: "2026-06-12 09:00:00",
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn anlegen_setzt_default_status_und_erzeugt_etb_mit_backlink() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "2 RTW zur Verstärkung"))
            .await
            .unwrap();
        assert_eq!(n.status, NachforderungStatus::Angefordert);
        assert!(n.ist_offen);
        assert_eq!(n.anzahl, Some(2));
        assert_eq!(n.adressat_kategorie, AdressatKategorie::Leitstelle);
        assert_eq!(n.erstellt_von_name.as_deref(), Some("Leit"));
        let etb_id = n.etb_nachforderung_id.expect("ETB-Eintrag erzeugt");
        let (typ, backlink): (String, i64) =
            sqlx::query_as("SELECT typ, nachforderung_id FROM etb_eintrag WHERE id = ?")
                .bind(etb_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(typ, "meldung");
        assert_eq!(backlink, n.id);
    }

    /// Von und An eines ETB-Eintrags, dazu Typ, Inhalt und der Verweis auf die Nachforderung.
    async fn etb_zeile(
        pool: &SqlitePool,
        id: i64,
    ) -> (String, String, String, String, Option<i64>) {
        sqlx::query_as(
            "SELECT typ, inhalt, von, an, nachforderung_id FROM etb_eintrag WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Alle ETB-Einträge, die auf die Nachforderung `n` zeigen, in Anlagefolge.
    async fn etb_der_nachforderung(pool: &SqlitePool, n: i64) -> Vec<(String, String)> {
        sqlx::query_as(
            "SELECT typ, inhalt FROM etb_eintrag WHERE nachforderung_id = ? ORDER BY lfd_nr",
        )
        .bind(n)
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// LLH-1089 D1/D9: ohne Details ist die Nachforderung gültig; der Eintrag nennt nur den
    /// Kurznamen, die Anzeige hat keine Bezeichnung.
    #[tokio::test]
    async fn anlage_ohne_details_nennt_den_kurznamen() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                bezeichnung: None,
                ..daten("RTW", "")
            },
        )
        .await
        .unwrap();
        assert_eq!(n.bezeichnung, None);
        assert_eq!(
            etb_der_nachforderung(&pool, n.id).await,
            vec![("meldung".to_string(), "Nachforderung: 2× RTW".to_string())]
        );
    }

    /// Ein Raum, ein Abschnitt (für die Ziel-Tests).
    async fn raum_und_abschnitt(pool: &SqlitePool, e: i64, b: i64) -> (i64, i64) {
        let br: i64 = sqlx::query_scalar(
            "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, status, erfasst_von, \
                geaendert_von) VALUES (?, 'BR Nord', 'aktiv', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        let abschnitt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'EA Deich') RETURNING id",
        )
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap();
        (br, abschnitt)
    }

    /// LLH-1089 D9: Ziel und Bedarfszeit stehen im Eintrag der Anlage, die Zeit in der
    /// Anzeigezone (ohne Einstellung Europe/Berlin, im Juni +2 h); die Anzeige trägt beide.
    #[tokio::test]
    async fn anlage_mit_ziel_und_bedarfszeit_schreibt_beides_ins_etb() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let (br, abschnitt) = raum_und_abschnitt(&pool, e, b).await;
        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                ziel_br_id: Some(br),
                benoetigt_bis: Some("2026-06-12 13:30:00"),
                ..daten("RTW", "Transport aus UHS Turnhalle")
            },
        )
        .await
        .unwrap();
        assert_eq!(n.ziel_br_id, Some(br));
        assert_eq!(n.benoetigt_bis.as_deref(), Some("2026-06-12 13:30:00"));
        assert_eq!(
            etb_der_nachforderung(&pool, n.id).await[0].1,
            "Nachforderung: 2× RTW → BR Nord, benötigt bis 12.06. 15:30 — \
             Transport aus UHS Turnhalle"
        );

        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                ziel_abschnitt_id: Some(abschnitt),
                bezeichnung: None,
                ..daten("Sandsäcke", "")
            },
        )
        .await
        .unwrap();
        assert_eq!(n.ziel_abschnitt_id, Some(abschnitt));
        assert_eq!(
            etb_der_nachforderung(&pool, n.id).await[0].1,
            "Nachforderung: 2× Sandsäcke → EA Deich"
        );

        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                ziel_text: Some("Lotsenpunkt Feuerwache"),
                bezeichnung: None,
                anzahl: None,
                ..daten("Tauchpumpe", "")
            },
        )
        .await
        .unwrap();
        assert_eq!(n.ziel_text.as_deref(), Some("Lotsenpunkt Feuerwache"));
        assert_eq!(
            etb_der_nachforderung(&pool, n.id).await[0].1,
            "Nachforderung: Tauchpumpe → Lotsenpunkt Feuerwache"
        );
    }

    /// Die Zeit folgt der Anzeigezone der Organisation, eine des Einsatzes geht vor.
    #[tokio::test]
    async fn bedarfszeit_steht_in_der_anzeigezone_des_einsatzes() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        sqlx::query("INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')")
            .execute(&pool)
            .await
            .unwrap();
        let bis = |pool: SqlitePool| async move {
            let n = create(
                &pool,
                e,
                b,
                NachforderungDaten {
                    benoetigt_bis: Some("2026-06-12 13:30:00"),
                    bezeichnung: None,
                    ..daten("RTW", "")
                },
            )
            .await
            .unwrap();
            etb_der_nachforderung(&pool, n.id).await[0].1.clone()
        };
        assert_eq!(
            bis(pool.clone()).await,
            "Nachforderung: 2× RTW, benötigt bis 12.06. 13:30"
        );
        sqlx::query(
            "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, 'Europe/Berlin')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            bis(pool.clone()).await,
            "Nachforderung: 2× RTW, benötigt bis 12.06. 15:30"
        );
    }

    /// Material aus einer Nachforderung ohne Details nennt die Art (LLH-1089 D9).
    #[tokio::test]
    async fn uebernahme_ohne_details_nennt_die_art() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                bezeichnung: None,
                ..daten("Tauchpumpe", "")
            },
        )
        .await
        .unwrap();
        sqlx::query("UPDATE nachforderung SET status = 'eingetroffen' WHERE id = ?")
            .bind(n.id)
            .execute(&pool)
            .await
            .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        assert_eq!(
            check_uebernahme_tx(&mut conn, e, n.id, false)
                .await
                .unwrap(),
            "Tauchpumpe"
        );
    }

    /// LLH-1104 D5: Absender ist die eigene Führungsstelle des Einsatzes (Rufname vor
    /// Bezeichnung), nicht „System“; Empfänger ist der Adressat mit Kategorie.
    #[tokio::test]
    async fn anlage_traegt_fuehrungsstelle_als_absender_und_adressat_als_empfaenger() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, rufname, bezeichnung) \
             VALUES (?, 'Florian Musterstadt 10/1', 'ELW 2 Musterstadt')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                adressat_bezeichnung: Some("ILS Nord"),
                ..daten("RTW", "2 RTW zur Verstärkung")
            },
        )
        .await
        .unwrap();
        let (typ, inhalt, von, an, verweis) =
            etb_zeile(&pool, n.etb_nachforderung_id.unwrap()).await;
        assert_eq!(typ, "meldung");
        assert_eq!(inhalt, "Nachforderung: 2× RTW — 2 RTW zur Verstärkung");
        assert_eq!(von, "Florian Musterstadt 10/1");
        assert_eq!(an, "Leitstelle (ILS Nord)");
        assert_eq!(verweis, Some(n.id));

        // Ohne Rufname gilt die Bezeichnung der Führungsstelle.
        sqlx::query("UPDATE einsatz_fuehrungsstelle SET rufname = '  ' WHERE einsatz_id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        let (_, _, von, an, _) = etb_zeile(&pool, n.etb_nachforderung_id.unwrap()).await;
        assert_eq!(von, "ELW 2 Musterstadt");
        // Die Bezeichnung nennt die Kategorie schon: kein „Leitstelle (Leitstelle Nord)“.
        assert_eq!(an, "Leitstelle Nord");
    }

    /// LLH-1104 D5: Ohne gepflegte Führungsstelle gilt der ETB-Vorschlag des Erstellers —
    /// seine Führungsstelle aus der Mitgliedschaft, sonst sein erstes Sachgebiet.
    #[tokio::test]
    async fn anlage_ohne_fuehrungsstelle_nimmt_den_etb_vorschlag_des_erstellers() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle, \
             fuehrungsstelle) VALUES (?, ?, 'einsatzleitung', 'TEL Rathaus')",
        )
        .bind(e)
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
        let ohne_bez = NachforderungDaten {
            adressat_kategorie: crate::nachforderung::ADRESSAT_ANDERE_BOS,
            adressat_bezeichnung: None,
            ..daten("SEG", "SEG Betreuung")
        };
        let n = create(&pool, e, b, ohne_bez).await.unwrap();
        let (_, _, von, an, _) = etb_zeile(&pool, n.etb_nachforderung_id.unwrap()).await;
        assert_eq!(von, "TEL Rathaus");
        assert_eq!(an, "Andere BOS");

        // Ganz ohne Angabe bleibt die Systemkennung (LFH-894).
        sqlx::query(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsstelle = NULL WHERE einsatz_id = ?",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        let (_, _, von, _, _) = etb_zeile(&pool, n.etb_nachforderung_id.unwrap()).await;
        assert_eq!(von, crate::etb::SYSTEM_RUFNAME);
    }

    /// LLH-1104 D6: Jede vollzogene Stufe schreibt genau einen Systemeintrag mit Verweis, die
    /// Rücknahme einen weiteren (nichts wird gelöscht); ein veraltetes `erwartet` schreibt nichts.
    #[tokio::test]
    async fn jede_stufe_schreibt_genau_einen_etb_eintrag_mit_verweis() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "2 RTW")).await.unwrap();
        assert_eq!(
            etb_der_nachforderung(&pool, n.id).await.len(),
            1,
            "nur die Anlage"
        );

        let etb = update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00",
        )
        .await
        .unwrap()
        .expect("Stufe vollzogen");
        let (typ, inhalt, _, _, verweis) = etb_zeile(&pool, etb).await;
        assert_eq!(typ, "system");
        assert_eq!(inhalt, "Nachforderung 2× RTW: zugesagt");
        assert_eq!(verweis, Some(n.id));

        // Veraltet: greift nicht, schreibt nichts.
        assert_eq!(
            update_status(
                &pool,
                n.id,
                b,
                STATUS_ZUGESAGT,
                STATUS_ANGEFORDERT,
                "2026-06-12 09:06:00"
            )
            .await
            .unwrap(),
            None
        );
        assert_eq!(etb_der_nachforderung(&pool, n.id).await.len(), 2);

        update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_ZUGESAGT,
            "2026-06-12 09:10:00",
        )
        .await
        .unwrap()
        .unwrap();
        update_status(
            &pool,
            n.id,
            b,
            STATUS_EINGETROFFEN,
            STATUS_UNTERWEGS,
            "2026-06-12 09:30:00",
        )
        .await
        .unwrap()
        .unwrap();
        // Rückgängig: ein weiterer Eintrag, der vorige bleibt.
        update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-06-12 09:31:00",
        )
        .await
        .unwrap()
        .unwrap();
        let inhalte: Vec<String> = etb_der_nachforderung(&pool, n.id)
            .await
            .into_iter()
            .map(|(_, i)| i)
            .collect();
        assert_eq!(
            inhalte,
            [
                "Nachforderung: 2× RTW — 2 RTW",
                "Nachforderung 2× RTW: zugesagt",
                "Nachforderung 2× RTW: unterwegs",
                "Nachforderung 2× RTW: eingetroffen",
                "Nachforderung 2× RTW: zurückgesetzt auf unterwegs",
            ]
        );
    }

    /// LLH-1104 D6: Die Ablehnung protokolliert ihren Grund; ohne Anzahl fehlt die Menge.
    #[tokio::test]
    async fn ablehnung_schreibt_grund_ins_etb() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(
            &pool,
            e,
            b,
            NachforderungDaten {
                anzahl: None,
                ..daten("SEG", "x")
            },
        )
        .await
        .unwrap();
        let etb = lehne_ab(
            &pool,
            n.id,
            b,
            Some("keine Reserven"),
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00",
        )
        .await
        .unwrap()
        .expect("abgelehnt");
        let (typ, inhalt, _, _, verweis) = etb_zeile(&pool, etb).await;
        assert_eq!(typ, "system");
        assert_eq!(inhalt, "Nachforderung SEG: abgelehnt (keine Reserven)");
        assert_eq!(verweis, Some(n.id));
        // Schon abgelehnt: kein zweiter Eintrag.
        assert_eq!(
            lehne_ab(
                &pool,
                n.id,
                b,
                None,
                STATUS_ANGEFORDERT,
                "2026-06-12 09:06:00"
            )
            .await
            .unwrap(),
            None
        );
        assert_eq!(etb_der_nachforderung(&pool, n.id).await.len(), 2);
    }

    /// LLH-1104 D4: Nachforderungen und ihre Stufen gehen immer ins ETB, auch mit
    /// abgeschalteten automatischen ETB-Einträgen.
    #[tokio::test]
    async fn nachforderung_schreibt_auch_ohne_auto_etb() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        crate::einsatz::einstellungen::speichern(
            &pool,
            e,
            b,
            crate::einsatz::einstellungen::EinstellungenDaten {
                auto_etb_eintraege: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(n.etb_nachforderung_id.is_some());
        update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(etb_der_nachforderung(&pool, n.id).await.len(), 2);
    }

    #[tokio::test]
    async fn liste_sortiert_nach_prio_und_filtert_status() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        create(&pool, e, b, daten("RTW", "normal")).await.unwrap();
        let sofort = NachforderungDaten {
            prioritaet: super::super::PRIO_SOFORT,
            ..daten("SEG", "sofort")
        };
        create(&pool, e, b, sofort).await.unwrap();
        let alle = list(&pool, e, None).await.unwrap();
        assert_eq!(alle.len(), 2);
        assert_eq!(
            alle[0].bezeichnung.as_deref(),
            Some("sofort"),
            "sofort vor normal"
        );
        let offen = list(&pool, e, Some("angefordert")).await.unwrap();
        assert_eq!(offen.len(), 2);
        assert!(list(&pool, e, Some("eingetroffen"))
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn setze_status_schaltet_weiter_und_haelt_zeitstempel() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00"
        )
        .await
        .unwrap()
        .is_some());
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_ZUGESAGT,
            "2026-06-12 09:10:00"
        )
        .await
        .unwrap()
        .is_some());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Unterwegs);
        assert_eq!(nach.zugesagt_at.as_deref(), Some("2026-06-12 09:05:00"));
        assert_eq!(nach.unterwegs_at.as_deref(), Some("2026-06-12 09:10:00"));
        assert!(nach.ist_offen);
        // eingetroffen → terminal, nicht mehr offen.
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_EINGETROFFEN,
            STATUS_UNTERWEGS,
            "2026-06-12 09:30:00"
        )
        .await
        .unwrap()
        .is_some());
        assert!(!load(&pool, n.id).await.unwrap().ist_offen);
        // Optimistische Sperre: erneuter Übergang mit veraltetem `erwartet` greift nicht.
        assert!(!update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 09:40:00"
        )
        .await
        .unwrap()
        .is_some());
    }

    /// LLH-1247: Die Rücknahme um eine Stufe (LFH-343 · C8) greift auf jeder Stufe, auch zurück
    /// auf `angefordert`, und leert den Zeitpunkt der verlassenen Stufe. Sonst behielte das
    /// erneute Weiterschalten über das COALESCE den zurückgenommenen Zeitpunkt.
    #[tokio::test]
    async fn ruecknahme_leert_den_zeitpunkt_der_verlassenen_stufe() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        for (neu, alt, jetzt) in [
            (STATUS_ZUGESAGT, STATUS_ANGEFORDERT, "2026-06-12 09:05:00"),
            (STATUS_UNTERWEGS, STATUS_ZUGESAGT, "2026-06-12 09:10:00"),
            (STATUS_EINGETROFFEN, STATUS_UNTERWEGS, "2026-06-12 09:30:00"),
        ] {
            assert!(update_status(&pool, n.id, b, neu, alt, jetzt)
                .await
                .unwrap()
                .is_some());
        }

        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-06-12 09:31:00"
        )
        .await
        .unwrap()
        .is_some());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Unterwegs);
        assert_eq!(nach.eingetroffen_at, None);
        assert_eq!(nach.unterwegs_at.as_deref(), Some("2026-06-12 09:10:00"));

        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_UNTERWEGS,
            "2026-06-12 09:32:00"
        )
        .await
        .unwrap()
        .is_some());
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_ANGEFORDERT,
            STATUS_ZUGESAGT,
            "2026-06-12 09:33:00"
        )
        .await
        .unwrap()
        .is_some());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Angefordert);
        assert_eq!(nach.zugesagt_at, None);
        assert_eq!(nach.unterwegs_at, None);
        assert!(nach.ist_offen);

        // Die nächste Zusage trägt ihren eigenen Zeitpunkt, nicht den zurückgenommenen.
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_ZUGESAGT,
            STATUS_ANGEFORDERT,
            "2026-06-12 10:00:00"
        )
        .await
        .unwrap()
        .is_some());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.zugesagt_at.as_deref(), Some("2026-06-12 10:00:00"));
    }

    /// Sprünge über mehr als eine Stufe nimmt das Repo nicht an, auch wenn der Handler sie
    /// vorher abweist.
    #[tokio::test]
    async fn update_status_lehnt_spruenge_ab() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        for (neu, alt) in [
            (STATUS_UNTERWEGS, STATUS_ANGEFORDERT),
            (STATUS_ANGEFORDERT, STATUS_UNTERWEGS),
            (STATUS_ANGEFORDERT, STATUS_ANGEFORDERT),
        ] {
            assert!(matches!(
                update_status(&pool, n.id, b, neu, alt, "2026-06-12 09:05:00").await,
                Err(AppError::Validation(_))
            ));
        }
    }

    #[tokio::test]
    async fn lehne_ab_setzt_grund_und_terminal() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(lehne_ab(
            &pool,
            n.id,
            b,
            Some("keine Reserven"),
            STATUS_ANGEFORDERT,
            "2026-06-12 09:05:00"
        )
        .await
        .unwrap()
        .is_some());
        let nach = load(&pool, n.id).await.unwrap();
        assert_eq!(nach.status, NachforderungStatus::Abgelehnt);
        assert_eq!(nach.abgelehnt_grund.as_deref(), Some("keine Reserven"));
        assert!(!nach.ist_offen);
    }

    #[tokio::test]
    async fn gehoert_zu_einsatz_schuetzt_cross_einsatz() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("RTW", "x")).await.unwrap();
        assert!(belongs_to_einsatz(&pool, n.id, e).await.unwrap());
        assert!(!belongs_to_einsatz(&pool, n.id, 999).await.unwrap());
    }

    /// Ein Materialposten der Nachforderung `n` (LLH-1226), optional mit Endzustand.
    async fn posten(pool: &SqlitePool, e: i64, n: i64, beendet_als: Option<&str>) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_material (einsatz_id, snap_bezeichnung, art, menge, \
                nachforderung_id, beendet_at, beendet_als) \
             VALUES (?, 'Tauchpumpe', 'geraet', 1, ?, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(n)
        .bind(beendet_als.map(|_| "2026-10-15 09:00:00"))
        .bind(beendet_als)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn material_ids_sind_ohne_uebernahme_leer() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        assert_eq!(n.material_ids.0, Vec::<i64>::new());
        let json = serde_json::to_value(&n).unwrap();
        assert_eq!(json["material_ids"], serde_json::json!([]));
    }

    /// LLH-1226, design.md D3/D8: aufsteigend, storniert fehlt, aus dem Einsatz genommen bleibt.
    #[tokio::test]
    async fn material_ids_zaehlen_nicht_stornierte_posten_aufsteigend() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        let andere = create(&pool, e, b, daten("Sandsäcke", "Deich"))
            .await
            .unwrap();
        let p1 = posten(&pool, e, n.id, None).await;
        posten(&pool, e, n.id, Some("storniert")).await;
        let p3 = posten(&pool, e, n.id, Some("entlassen")).await;
        let fremd = posten(&pool, e, andere.id, None).await;

        assert_eq!(
            load(&pool, n.id).await.unwrap().material_ids.0,
            vec![p1, p3]
        );
        let alle = list(&pool, e, None).await.unwrap();
        let aus_liste = |id: i64| {
            alle.iter()
                .find(|x| x.id == id)
                .unwrap()
                .material_ids
                .0
                .clone()
        };
        assert_eq!(aus_liste(n.id), vec![p1, p3]);
        assert_eq!(aus_liste(andere.id), vec![fremd]);
    }

    /// LLH-1226, design.md D9: das UPDATE der Rücknahme greift nicht, solange ein zählender
    /// Posten verknüpft ist (gegen eine gleichzeitige Übernahme); ein stornierter sperrt nicht.
    #[tokio::test]
    async fn update_status_nimmt_eingetroffen_mit_posten_nicht_zurueck() {
        let pool = crate::db::test_pool().await;
        let (b, e) = setup(&pool).await;
        let n = create(&pool, e, b, daten("Tauchpumpe", "3 Tauchpumpen"))
            .await
            .unwrap();
        for (neu, alt) in [
            (STATUS_ZUGESAGT, STATUS_ANGEFORDERT),
            (STATUS_UNTERWEGS, STATUS_ZUGESAGT),
            (STATUS_EINGETROFFEN, STATUS_UNTERWEGS),
        ] {
            assert!(
                update_status(&pool, n.id, b, neu, alt, "2026-10-15 09:00:00")
                    .await
                    .unwrap()
                    .is_some()
            );
        }
        let p = posten(&pool, e, n.id, None).await;
        assert!(has_material(&pool, n.id).await.unwrap());
        assert!(!update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-10-15 09:10:00"
        )
        .await
        .unwrap()
        .is_some());
        assert_eq!(
            load(&pool, n.id).await.unwrap().status,
            NachforderungStatus::Eingetroffen
        );
        sqlx::query(
            "UPDATE einsatz_material SET beendet_at = '2026-10-15 09:05:00', \
             beendet_als = 'storniert' WHERE id = ?",
        )
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
        assert!(!has_material(&pool, n.id).await.unwrap());
        assert!(update_status(
            &pool,
            n.id,
            b,
            STATUS_UNTERWEGS,
            STATUS_EINGETROFFEN,
            "2026-10-15 09:10:00"
        )
        .await
        .unwrap()
        .is_some());
    }
}

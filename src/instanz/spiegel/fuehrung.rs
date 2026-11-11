//! Führung je Einsatz auf dem Spiegel (LLH-1641, Entwurf E1–E7, mit Ruben am 11.11.2026
//! abgestimmt; ADR-0018, ADR-0021).
//!
//! Die Akte (`einsatz_fuehrung`) entscheidet, wer einen Einsatz führt; die Zeile in
//! `einsatz_spiegel` folgt ihr ([`richte_aus`]), und allein sie sperrt (Trigger und Antragsschicht
//! aus ADR-0018). Ohne Schalter `LIFELINE_FUEHRUNG` gibt es keine Akten, und wer anlegt, führt.
//!
//! - **Führer werden** ([`werde_fuehrer`]): die Zeile in `einsatz_spiegel` fällt, die Akte merkt
//!   sich, von welcher Kopplung die Zeilen stammen (`herkunft_kopplung_id`) und bis zu welchem
//!   Stand des Logs sie der alte Führer kennt (`uebernommen_stand`). Offene Anträge führt der Takt
//!   danach selbst aus (`antrag::fuehre_eigene_aus`, E5).
//! - **Spiegel werden** ([`werde_spiegel`]): eigene Änderungen, die der neue Führer nicht kennen
//!   kann, werden als Bruchstelle gesichert (E6); die Zeile in `einsatz_spiegel` beginnt bei Stand
//!   0, damit der neue Führer alles liefert und seine Abbildung mitschickt (`Zeile.gegen`, E3).
//!
//! Nur dieses Modul legt `einsatz_spiegel` außerhalb der Übernahme an oder entfernt sie
//! (ADR-0018: Schreibwege am Merker `spiegel_uebernahme` liegen in `src/instanz/spiegel/`).

use super::paket::{BruchAntwort, EinsatzStand, BRUCH_MAX, EINSAETZE_MAX};
use super::schema;
use crate::error::AppError;
use crate::instanz::fuehrung::repo::{self as akten, AkteZeile};
use sqlx::SqliteConnection;

/// Richtet den Spiegel eines Einsatzes nach seiner Akte aus. Ohne Schalter oder ohne Akte ändert
/// sich nichts: ein Spiegel bleibt Spiegel, ein eigener Einsatz bleibt eigen.
pub async fn richte_aus(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<(), AppError> {
    if !akten::is_enabled_tx(conn).await? {
        return Ok(());
    }
    let Some(akte) = akten::find_by_einsatz(conn, einsatz_id).await? else {
        return Ok(());
    };
    let ich = akten::ich(conn).await?;
    let spiegel: Option<Option<i64>> =
        sqlx::query_scalar("SELECT kopplung_org_id FROM einsatz_spiegel WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    let fuehre = akte.fuehrer_kennung == ich.kennung;
    match (fuehre, spiegel) {
        (true, Some(ko)) => werde_fuehrer(conn, &akte, ko).await,
        (false, None) => werde_spiegel(conn, &akte).await,
        (false, Some(ko)) => {
            // Ein anderes Gegenüber führt jetzt (mehrere ELW an einem Hub): der Spiegel hängt
            // sich an dessen Kopplung.
            let neu = kopplung_org_des_fuehrers(conn, &akte).await?;
            if neu.is_some() && neu != ko {
                sqlx::query(
                    "UPDATE einsatz_spiegel SET kopplung_org_id = ?, stand = 0, beendet_at = NULL \
                     WHERE einsatz_id = ?",
                )
                .bind(neu)
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
            }
            Ok(())
        }
        (true, None) => Ok(()),
    }
}

/// Richtet alle Einsätze mit Akte aus (Start, Schalter).
pub async fn richte_alle_aus(conn: &mut SqliteConnection) -> Result<(), AppError> {
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT einsatz_id FROM einsatz_fuehrung WHERE einsatz_id IS NOT NULL ORDER BY einsatz_id",
    )
    .fetch_all(&mut *conn)
    .await?;
    for id in ids {
        richte_aus(conn, id).await?;
    }
    Ok(())
}

/// Die Org-Zuordnung, über die der Führer der Akte den Einsatz liefert, wenn er ein Gegenüber ist.
async fn kopplung_org_des_fuehrers(
    conn: &mut SqliteConnection,
    akte: &AkteZeile,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT o.id FROM instanz_kopplung_org o JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE o.org_id = ? AND k.gegenueber_kennung = ? AND o.widerrufen_at IS NULL \
         ORDER BY k.zustand = 'aktiv' DESC, o.id DESC LIMIT 1",
    )
    .bind(akte.org_id)
    .bind(&akte.fuehrer_kennung)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Höchster Stand des Logs eines Einsatzes (0 ohne Zeile).
async fn hoechster_stand(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<i64, AppError> {
    let s: Option<i64> =
        sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    Ok(s.unwrap_or(0))
}

/// Diese Instanz führt jetzt einen Einsatz, den sie bisher spiegelte.
async fn werde_fuehrer(
    conn: &mut SqliteConnection,
    akte: &AkteZeile,
    kopplung_org_id: Option<i64>,
) -> Result<(), AppError> {
    let Some(einsatz_id) = akte.einsatz_id else {
        return Ok(());
    };
    let kopplung_id: Option<i64> = match kopplung_org_id {
        Some(ko) => {
            sqlx::query_scalar("SELECT kopplung_id FROM instanz_kopplung_org WHERE id = ?")
                .bind(ko)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    let stand = hoechster_stand(conn, einsatz_id).await?;
    sqlx::query(
        "UPDATE einsatz_fuehrung SET herkunft_kopplung_id = ?, uebernommen_stand = ? WHERE id = ?",
    )
    .bind(kopplung_id)
    .bind(stand)
    .bind(akte.id)
    .execute(&mut *conn)
    .await?;
    // Der Trigger `einsatz_spiegel_merker_d` setzt `einsatz.spiegel` zurück; der Schutz des
    // Einsatzes sieht die Zeile dann schon nicht mehr.
    sqlx::query("DELETE FROM einsatz_spiegel WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM spiegel_ziel WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    super::takt::wecken();
    Ok(())
}

/// Ein Gegenüber führt jetzt einen Einsatz, den diese Instanz bisher führte.
async fn werde_spiegel(conn: &mut SqliteConnection, akte: &AkteZeile) -> Result<(), AppError> {
    let Some(einsatz_id) = akte.einsatz_id else {
        return Ok(());
    };
    let kopplung_org_id = kopplung_org_des_fuehrers(conn, akte).await?;
    // Was das Gegenüber sicher kennt: den bestätigten Stand seines Spiegels, und alles bis zur
    // eigenen Übernahme (das kam von ihm).
    let bestaetigt: Option<i64> = match kopplung_org_id {
        Some(ko) => {
            sqlx::query_scalar(
                "SELECT stand FROM spiegel_ziel WHERE kopplung_org_id = ? AND einsatz_id = ?",
            )
            .bind(ko)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?
        }
        None => None,
    };
    let uebernommen: Option<i64> =
        sqlx::query_scalar("SELECT uebernommen_stand FROM einsatz_fuehrung WHERE id = ?")
            .bind(akte.id)
            .fetch_one(&mut *conn)
            .await?;
    let bekannt_bis = bestaetigt.unwrap_or(0).max(uebernommen.unwrap_or(0));
    let gesichert = sichere_bruchstelle(conn, einsatz_id, bekannt_bis).await?;
    let merker_vorher: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM spiegel_uebernahme)")
            .fetch_one(&mut *conn)
            .await?;
    // Das Anlegen ändert `einsatz.spiegel` über den Trigger `einsatz_spiegel_merker_i`; der
    // Einsatz ist dann schon geschützt, also unter dem Merker (wie jede Übernahme).
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await?;
    let ergebnis = sqlx::query(
        "INSERT INTO einsatz_spiegel (einsatz_id, kopplung_org_id, fremde_kennung, stand, \
         bruch_offen, beendet_at, hinweis) \
         SELECT e.id, ?, e.kennung, 0, ?, ?, ? FROM einsatz e WHERE e.id = ? AND e.kennung IS NOT NULL",
    )
    .bind(kopplung_org_id)
    .bind(gesichert > 0)
    .bind(kopplung_org_id.is_none().then(crate::zeit::jetzt))
    .bind(
        kopplung_org_id
            .is_none()
            .then_some("Die führende Instanz ist hier nicht gekoppelt."),
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await;
    if !merker_vorher {
        sqlx::query("DELETE FROM spiegel_uebernahme")
            .execute(&mut *conn)
            .await?;
    }
    ergebnis?;
    sqlx::query("DELETE FROM spiegel_ziel WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE einsatz_fuehrung SET uebernommen_stand = NULL, anfrage_von = NULL WHERE id = ?",
    )
    .bind(akte.id)
    .execute(&mut *conn)
    .await?;
    super::takt::wecken();
    Ok(())
}

/// Sichert die Zeilen, die sich nach `bekannt_bis` geändert haben (E6): Inhalt als JSON, eine
/// gelöschte Zeile ohne Inhalt. Der Kopf des Einsatzes kommt ohnehin vom neuen Führer. Liefert
/// die Zahl der gesicherten Zeilen.
async fn sichere_bruchstelle(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bekannt_bis: i64,
) -> Result<usize, AppError> {
    let zeilen: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT art, schluessel, stand FROM einsatz_aenderung \
         WHERE einsatz_id = ? AND stand > ? AND art <> 'einsatz' ORDER BY stand",
    )
    .bind(einsatz_id)
    .bind(bekannt_bis)
    .fetch_all(&mut *conn)
    .await?;
    if zeilen.is_empty() {
        return Ok(0);
    }
    let schema = schema::schema(conn).await?;
    let jetzt = crate::zeit::jetzt();
    for (art, schluessel, stand) in &zeilen {
        let daten = match schema.tabelle(art) {
            Some(t) => super::liefern::load_zeile(conn, t, schluessel)
                .await?
                .map(|(d, _)| serde_json::Value::Object(d).to_string()),
            None => None,
        };
        sqlx::query(
            "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, daten, \
             gesichert_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(einsatz_id)
        .bind(art)
        .bind(schluessel)
        .bind(stand)
        .bind(daten)
        .bind(&jetzt)
        .execute(&mut *conn)
        .await?;
    }
    Ok(zeilen.len())
}

// ── Bruchstelle im Abgleich ──────────────────────────────────────────────────────────────────

/// Die gesicherten, noch nicht geklärten Zeilen eines Spiegels mit offener Bruchstelle: der
/// Spiegel fragt den Führer, welche davon er kennt (`EinsatzStand.bruch`).
pub async fn offene_bruch_fragen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<[String; 2]>, AppError> {
    let zeilen: Vec<(String, String)> = sqlx::query_as(
        "SELECT DISTINCT b.art, b.schluessel FROM einsatz_bruchstelle b \
         JOIN einsatz_spiegel s ON s.einsatz_id = b.einsatz_id AND s.bruch_offen = 1 \
         WHERE b.einsatz_id = ? AND b.entfernt = 0 AND b.geklaert = 0 \
         ORDER BY b.art, b.schluessel LIMIT ?",
    )
    .bind(einsatz_id)
    .bind(BRUCH_MAX as i64)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen.into_iter().map(|(a, s)| [a, s]).collect())
}

/// Beantwortet am Führer die Frage eines Spiegels nach seiner Bruchstelle: welche Zeilen (in den
/// Schlüsseln des Spiegels) dieser Führer nicht kennt. Kennen kann er nur Zeilen, die er selbst
/// als Spiegel dieser Kopplung bekam (`herkunft_kopplung_id`); sonst sagt er `kennt: false`.
pub async fn beantworte_bruch(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kennung: &str,
    kopplung_id: i64,
    fragen: &[[String; 2]],
) -> Result<BruchAntwort, AppError> {
    let herkunft: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT herkunft_kopplung_id FROM einsatz_fuehrung WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    let bis = fragen[..fragen.len().min(BRUCH_MAX)].last().cloned();
    if herkunft.flatten() != Some(kopplung_id) {
        return Ok(BruchAntwort {
            kennung: kennung.to_string(),
            kennt: false,
            unbekannt: Vec::new(),
            bis,
        });
    }
    let mut unbekannt = Vec::new();
    for [art, schluessel] in fragen.iter().take(BRUCH_MAX) {
        let gibt: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM spiegel_herkunft WHERE einsatz_id = ? AND art = ? \
             AND fremder_schluessel = ?)",
        )
        .bind(einsatz_id)
        .bind(art)
        .bind(schluessel)
        .fetch_one(&mut *conn)
        .await?;
        if !gibt {
            unbekannt.push([art.clone(), schluessel.clone()]);
        }
    }
    Ok(BruchAntwort {
        kennung: kennung.to_string(),
        kennt: true,
        unbekannt,
        bis,
    })
}

/// Beantwortet am Führer die Bruchstellen in den Ständen eines Pakets (E6): nur für Einsätze, die
/// diese Instanz führt.
pub async fn beantworte_staende(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    staende: &[EinsatzStand],
) -> Result<Vec<BruchAntwort>, AppError> {
    let mut antworten = Vec::new();
    for s in staende
        .iter()
        .filter(|s| !s.bruch.is_empty())
        .take(EINSAETZE_MAX)
    {
        let gefuehrt: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE kennung = ? AND spiegel = 0")
                .bind(&s.kennung)
                .fetch_optional(&mut *conn)
                .await?;
        if let Some(id) = gefuehrt {
            antworten.push(beantworte_bruch(conn, id, &s.kennung, kopplung_id, &s.bruch).await?);
        }
    }
    Ok(antworten)
}

/// Übernimmt am Spiegel alle Antworten eines Pakets; liefert die betroffenen Einsätze.
pub async fn uebernimm_bruch_antworten(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    antworten: &[BruchAntwort],
) -> Result<Vec<i64>, AppError> {
    let mut einsaetze = Vec::new();
    for a in antworten.iter().take(EINSAETZE_MAX) {
        if let Some(id) = uebernimm_bruch_antwort(conn, kopplung_id, a).await? {
            einsaetze.push(id);
        }
    }
    Ok(einsaetze)
}

/// Übernimmt am Spiegel die Antwort des Führers (E6): Zeilen der Bruchstelle, die er nicht kennt,
/// werden lokal entfernt (ihr Inhalt bleibt in `einsatz_bruchstelle`); bekannte überschreibt seine
/// Lieferung. Läuft vor den Lieferungen desselben Pakets, damit eine neue Zeile des Führers nicht
/// an einer entfernten scheitert (etwa der laufenden Nummer im ETB). Eine Zeile, an der noch ein
/// Verweis hängt, wird zurückgestellt (`geklaert = 2`): Erst laufen alle weiteren Seiten durch,
/// denn der Verweis kann von einer späteren Zeile kommen; danach wird sie erneut gefragt. Die
/// Antwort klärt die Zeilen bis `bis`; geschlossen wird die Bruchstelle erst, wenn weder eine
/// ungeklärte noch eine zurückgestellte Zeile übrig ist. Kennt der Führer den Einsatz nicht als Spiegel dieser Kopplung (`kennt: false`),
/// bleibt sie offen, bis ein Führer antwortet, der es kann.
async fn uebernimm_bruch_antwort(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    a: &BruchAntwort,
) -> Result<Option<i64>, AppError> {
    let spiegel: Option<i64> = sqlx::query_scalar(
        "SELECT s.einsatz_id FROM einsatz_spiegel s JOIN instanz_kopplung_org o \
         ON o.id = s.kopplung_org_id WHERE s.fremde_kennung = ? AND o.kopplung_id = ? \
         AND s.bruch_offen = 1",
    )
    .bind(&a.kennung)
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(einsatz_id) = spiegel else {
        return Ok(None);
    };
    if !a.kennt {
        return Ok(None);
    }
    // Bis wohin die Antwort klärt. Fehlt `bis`, gilt die Seite, die dieser Spiegel jetzt fragen
    // würde, nie mehr: Sonst schlösse eine Antwort ohne `bis` auch ungefragte Seiten.
    let bis = match &a.bis {
        Some(b) => Some(b.clone()),
        None => offene_bruch_fragen(conn, einsatz_id).await?.pop(),
    };
    let schema = schema::schema(conn).await?;
    let mut uebrig: Vec<(String, String)> = Vec::new();
    {
        sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
            .execute(&mut *conn)
            .await?;
        // Kinder vor Eltern: spätere Zeilen zuerst.
        let mut ziele: Vec<(String, String)> = Vec::new();
        for [art, schluessel] in a.unbekannt.iter().take(BRUCH_MAX) {
            let gesichert: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM einsatz_bruchstelle WHERE einsatz_id = ? AND art = ? \
                 AND schluessel = ? AND entfernt = 0)",
            )
            .bind(einsatz_id)
            .bind(art)
            .bind(schluessel)
            .fetch_one(&mut *conn)
            .await?;
            if gesichert {
                ziele.push((art.clone(), schluessel.clone()));
            }
        }
        ziele.reverse();
        loese_verweise_untereinander(conn, &schema, einsatz_id, &ziele).await?;
        let mut fehler = None;
        for (art, schluessel) in &ziele {
            let Some(t) = schema.tabelle(art) else {
                continue;
            };
            sqlx::query("SAVEPOINT bruch_zeile")
                .execute(&mut *conn)
                .await?;
            // Nur die Zeile dieses Einsatzes: SQLite vergibt die Kennung einer gelöschten Zeile
            // neu, und ein Schlüssel aus der Bruchstelle kann inzwischen in einem anderen
            // Einsatz stehen.
            let lauf = sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {} WHERE {} AND {} = ?",
                t.name,
                t.schluessel.gleich(t.name),
                super::art::einsatz_ausdruck(t.scoping, t.name)
            )))
            .bind(schluessel)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await;
            match lauf {
                Ok(geloescht) => {
                    sqlx::query("RELEASE bruch_zeile")
                        .execute(&mut *conn)
                        .await?;
                    if t.blob.is_some() && geloescht.rows_affected() > 0 {
                        sqlx::query(
                            "DELETE FROM spiegel_anhang WHERE einsatz_id = ? AND art = ? \
                             AND lokaler_schluessel = ?",
                        )
                        .bind(einsatz_id)
                        .bind(t.name)
                        .bind(schluessel)
                        .execute(&mut *conn)
                        .await?;
                    }
                    sqlx::query(
                        "UPDATE einsatz_bruchstelle SET entfernt = 1 WHERE einsatz_id = ? \
                         AND art = ? AND schluessel = ?",
                    )
                    .bind(einsatz_id)
                    .bind(art)
                    .bind(schluessel)
                    .execute(&mut *conn)
                    .await?;
                }
                Err(f) => {
                    sqlx::query("ROLLBACK TO bruch_zeile")
                        .execute(&mut *conn)
                        .await?;
                    sqlx::query("RELEASE bruch_zeile")
                        .execute(&mut *conn)
                        .await?;
                    uebrig.push((art.clone(), schluessel.clone()));
                    fehler.get_or_insert(f);
                }
            }
        }
        sqlx::query("DELETE FROM spiegel_uebernahme")
            .execute(&mut *conn)
            .await?;
        if let Some(f) = fehler {
            tracing::warn!(kennung = %a.kennung, fehler = %f, "Bruchstelle: Zeile bleibt vorerst");
        }
    }
    // Geklärt ist alles bis zur letzten gefragten Zeile, außer was eben nicht entfernt werden
    // konnte (zurückgestellt).
    if let Some([art, schluessel]) = &bis {
        sqlx::query(
            "UPDATE einsatz_bruchstelle SET geklaert = 1 WHERE einsatz_id = ? AND geklaert = 0 \
             AND (art, schluessel) <= (?, ?)",
        )
        .bind(einsatz_id)
        .bind(art)
        .bind(schluessel)
        .execute(&mut *conn)
        .await?;
    }
    for (art, schluessel) in &uebrig {
        sqlx::query(
            "UPDATE einsatz_bruchstelle SET geklaert = 2 WHERE einsatz_id = ? AND art = ? \
             AND schluessel = ? AND entfernt = 0",
        )
        .bind(einsatz_id)
        .bind(art)
        .bind(schluessel)
        .execute(&mut *conn)
        .await?;
    }
    let offen: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_bruchstelle WHERE einsatz_id = ? AND entfernt = 0 \
         AND geklaert = 0)",
    )
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?;
    if !offen {
        // Alle Seiten sind durch: Zurückgestellte kommen in die nächste Runde, sonst ist die
        // Bruchstelle geklärt.
        let zurueck = sqlx::query(
            "UPDATE einsatz_bruchstelle SET geklaert = 0 WHERE einsatz_id = ? AND entfernt = 0 \
             AND geklaert = 2",
        )
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
        if zurueck.rows_affected() == 0 {
            sqlx::query("UPDATE einsatz_spiegel SET bruch_offen = 0 WHERE einsatz_id = ?")
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
        }
    }
    // Die entfernten Zeilen je Erfassung ordnen, damit Band und Liste Erfassungen zählen
    // (LLH-1646).
    super::bruchstelle::ordne_folgen(conn, einsatz_id).await?;
    Ok(Some(einsatz_id))
}

/// Löst Verweise zwischen Zeilen, die gemeinsam entfernt werden (LLH-1646): Eine Meldung und ihr
/// ETB-Eintrag zeigen aufeinander (`meldung.etb_meldung_id`, `etb_eintrag.meldung_id`), ohne
/// `ON DELETE`. Keine der beiden ließe sich zuerst löschen, und die Bruchstelle käme nie zu Ende.
/// Der Inhalt ist schon gesichert; geleert wird nur, was keine Pflichtspalte ist. Läuft unter dem
/// Merker der Übernahme.
async fn loese_verweise_untereinander(
    conn: &mut SqliteConnection,
    schema: &schema::Schema,
    einsatz_id: i64,
    ziele: &[(String, String)],
) -> Result<(), AppError> {
    if ziele.len() < 2 {
        return Ok(());
    }
    let arten: std::collections::HashSet<&str> = ziele.iter().map(|(a, _)| a.as_str()).collect();
    for (art, schluessel) in ziele {
        let Some(t) = schema.tabelle(art) else {
            continue;
        };
        for sp in &t.spalten {
            let Some(schema::Ziel::Einsatz(ziel)) = &sp.verweis else {
                continue;
            };
            if sp.pflicht || !arten.contains(ziel) {
                continue;
            }
            let mit: Vec<&str> = ziele
                .iter()
                .filter(|(a, s)| a == ziel && !(a == art && s == schluessel))
                .map(|(_, s)| s.as_str())
                .collect();
            if mit.is_empty() {
                continue;
            }
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "UPDATE {tab} SET {sp} = NULL WHERE {gleich} AND {einsatz} = ? \
                 AND CAST({sp} AS TEXT) IN (SELECT value FROM json_each(?))",
                tab = t.name,
                sp = sp.name,
                gleich = t.schluessel.gleich(t.name),
                einsatz = super::art::einsatz_ausdruck(t.scoping, t.name),
            )))
            .bind(schluessel)
            .bind(einsatz_id)
            .bind(serde_json::to_string(&mit).unwrap_or_else(|_| "[]".into()))
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

// ── Übergabe und Anfrage ─────────────────────────────────────────────────────────────────────

/// Ob das Gegenüber der Kopplung alles hat, was diese Instanz von einem Einsatz kennt (E4): sein
/// bestätigter Stand reicht bis zum höchsten Stand des Logs.
pub async fn ist_abgeglichen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<bool, AppError> {
    let hoechster = hoechster_stand(conn, einsatz_id).await?;
    let ziel: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(z.stand) FROM spiegel_ziel z JOIN instanz_kopplung_org o \
         ON o.id = z.kopplung_org_id WHERE z.einsatz_id = ? AND o.kopplung_id = ?",
    )
    .bind(einsatz_id)
    .bind(kopplung_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(ziel.unwrap_or(0) >= hoechster)
}

/// Zahl der Änderungen, die das Gegenüber noch nicht hat (für die Meldung „Abgleich läuft noch“).
pub async fn offene_aenderungen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<i64, AppError> {
    let ziel: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(z.stand) FROM spiegel_ziel z JOIN instanz_kopplung_org o \
         ON o.id = z.kopplung_org_id WHERE z.einsatz_id = ? AND o.kopplung_id = ?",
    )
    .bind(einsatz_id)
    .bind(kopplung_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = ? AND stand > ?",
    )
    .bind(einsatz_id)
    .bind(ziel.unwrap_or(0))
    .fetch_one(&mut *conn)
    .await?)
}

/// 409 „Abgleich läuft noch“, wenn das Gegenüber nicht alles hat (E4).
pub async fn fordere_abgeglichen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
) -> Result<(), AppError> {
    if ist_abgeglichen(conn, einsatz_id, kopplung_id).await? {
        return Ok(());
    }
    let n = offene_aenderungen(conn, einsatz_id, kopplung_id).await?;
    Err(AppError::Conflict(format!(
        "Abgleich läuft noch ({n} {} offen). Die Übergabe geht, sobald das Gegenüber alles hat.",
        if n == 1 { "Änderung" } else { "Änderungen" }
    )))
}

/// Der Schlüssel einer Zeile beim Empfänger (E3): Kennt diese Instanz die Zeile als Spiegel der
/// Kopplung `kopplung_id` (sie führt den Einsatz jetzt), ist es der Schlüssel, unter dem der alte
/// Führer sie geliefert hat.
pub async fn gegen_hinaus(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kopplung_id: i64,
    art: &str,
    schluessel: &str,
) -> Result<Option<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT h.fremder_schluessel FROM spiegel_herkunft h \
         JOIN einsatz_fuehrung f ON f.einsatz_id = h.einsatz_id \
         WHERE h.einsatz_id = ? AND h.art = ? AND h.lokaler_schluessel = ? \
           AND f.herkunft_kopplung_id = ?",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(schluessel)
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Übernimmt am Spiegel den Schlüssel beim Empfänger (E3): Die Zeile `fremd` des Führers ist die
/// eigene Zeile `gegen`. Nur eine Zeile dieses Einsatzes (sie steht in seinem Log) wird so
/// zugeordnet; eine ältere Zuordnung derselben lokalen Zeile fällt weg.
pub async fn uebernimm_gegen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    art: &str,
    fremd: &str,
    gegen: &str,
) -> Result<bool, AppError> {
    let eigen: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_aenderung WHERE einsatz_id = ? AND art = ? \
         AND schluessel = ?)",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(gegen)
    .fetch_one(&mut *conn)
    .await?;
    if !eigen {
        return Ok(false);
    }
    let bisher = super::abbildung::einsatz_lokal(conn, einsatz_id, art, fremd).await?;
    if bisher.as_deref() == Some(gegen) {
        return Ok(true);
    }
    sqlx::query(
        "DELETE FROM spiegel_herkunft WHERE (einsatz_id = ? AND art = ? AND fremder_schluessel = ?) \
         OR (art = ? AND lokaler_schluessel = ?)",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(fremd)
    .bind(art)
    .bind(gegen)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO spiegel_herkunft (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(art)
    .bind(fremd)
    .bind(gegen)
    .execute(&mut *conn)
    .await?;
    Ok(true)
}

/// Ob eine Lieferung von `absender` für `kennung` gilt, obwohl die Kennung nicht mit dessen
/// Instanzkennung beginnt: Die Akte hier nennt ihn als Führer (Führung gewechselt).
pub async fn fuehrt_laut_akte(
    conn: &mut SqliteConnection,
    kennung: &str,
    absender: &str,
) -> Result<bool, AppError> {
    if !akten::is_enabled_tx(conn).await? {
        return Ok(false);
    }
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_fuehrung WHERE kennung = ? AND fuehrer_kennung = ?)",
    )
    .bind(kennung)
    .bind(absender)
    .fetch_one(&mut *conn)
    .await?)
}

/// Hängt die Akte des Gegenübers an einen neuen Spiegel desselben Einsatzes (E2).
pub async fn verknuepfe_akte(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    kennung: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE einsatz_fuehrung SET einsatz_id = ? WHERE kennung = ? AND einsatz_id IS NULL \
         AND NOT EXISTS (SELECT 1 FROM einsatz_fuehrung f WHERE f.einsatz_id = ?)",
    )
    .bind(einsatz_id)
    .bind(kennung)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

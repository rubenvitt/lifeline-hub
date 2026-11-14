//! Aufbewahrungsfristen je Datenkategorie (LFH-749, Spec `aufbewahrung-kategorien`).
//!
//! Herleitung: `openspec/changes/archive/2026-10-02-lfh-749-fristen-je-datenkategorie/design.md`. Welche Spalten
//! eine Kategorie umfasst, sagt allein die Schwärzungs-Registry (`Zuordnung`); hier liegen
//! Frist, Vormerkung und Schwärzung je Kategorie. Die Zeitrechnung (Karenz, Grenzen) teilt das
//! Modul mit der Einsatz-Aufbewahrung (`retention`).
//!
//! DATENVERLUST-kritisch wie `repo::schwaerze_einsatz`: jede Mutation ist bewacht (die
//! Fälligkeit steht im UPDATE selbst) und schreibt im selben Vorgang einen ETB-Eintrag.

use super::repo::system_audit_tx;
use super::retention::{
    berechne_retention_bis, karenz_abgelaufen, karenz_grenze, AufbewahrungZustand, Datenkategorie,
};
use super::schwaerzung_registry::{scrubbe_aus_registry, Umfang};
use super::STATUS_ABGESCHLOSSEN;
use crate::error::AppError;
use crate::org::aufbewahrung_kategorie::{KategorieVorgabe, RECHTSGRUNDLAGE_MAX};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

impl Datenkategorie {
    /// Bezeichnung für ETB und Oberfläche.
    pub const fn bezeichnung(&self) -> &'static str {
        match self {
            Datenkategorie::Behandlung => "Behandlung",
            Datenkategorie::Personenauskunft => "Personenauskunft",
            Datenkategorie::Anhaenge => "Anhänge",
        }
    }

    /// Was die Schwärzung der Kategorie entfernt — für den ETB-Eintrag (Spalten nach der
    /// Registry, `tests::kategorie_zuordnung_ist_gepinnt`).
    const fn entfernt(&self) -> &'static str {
        match self {
            Datenkategorie::Behandlung => {
                "Zustand, PAT-Nummer, benötigte Fachrichtung und Anlass der Hilfeleistung der \
                 Personen, Lage und Notiz ihrer Verletzungen sowie die Notizen zu Sichtung, \
                 Verlauf und UHS-Belegung"
            }
            Datenkategorie::Personenauskunft => "Herkunftsadresse und Melderkontakt der Personen",
            Datenkategorie::Anhaenge => {
                "alle Datei-Anhänge samt ihrer Ablage als Dokument (an Schäden, Chat und ETB) und \
                 die Bilder der Lagekarte, auch ihre Angaben in den Lage-Ständen"
            }
        }
    }
}

/// Eine Zeile aus `einsatz_aufbewahrung_kategorie`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KategorieZeile {
    pub kategorie: Datenkategorie,
    pub frist_bis: Option<String>,
    pub rechtsgrundlage: String,
    pub vorgemerkt_at: Option<String>,
    pub geschwaerzt_at: Option<String>,
}

type Roh = (
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
);

fn aus_roh(
    (k, frist_bis, rechtsgrundlage, vorgemerkt_at, geschwaerzt_at): Roh,
) -> Option<KategorieZeile> {
    Some(KategorieZeile {
        kategorie: Datenkategorie::parse(&k)?,
        frist_bis,
        rechtsgrundlage,
        vorgemerkt_at,
        geschwaerzt_at,
    })
}

/// Lädt die Kategorie-Zeilen eines Einsatzes, nach Kategorie sortiert. Zeilen mit unbekannter
/// Kategorie werden übergangen.
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
) -> Result<Vec<KategorieZeile>, AppError> {
    let zeilen: Vec<Roh> = sqlx::query_as(
        "SELECT kategorie, frist_bis, rechtsgrundlage, vorgemerkt_at, geschwaerzt_at \
         FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(executor)
    .await?;
    let mut v: Vec<KategorieZeile> = zeilen.into_iter().filter_map(aus_roh).collect();
    v.sort_by_key(|z| z.kategorie);
    Ok(v)
}

/// Schreibt einen System-ETB-Eintrag und liefert seine Kennung (für das `etb`-Ereignis).
async fn etb_eintrag(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    etb_startwert: i64,
    inhalt: &str,
) -> Result<i64, AppError> {
    crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        erfasser_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await
}

/// Legt beim Abschluss je Org-Vorgabe die Kategorie-Frist an (`abgeschlossen_at + dauer`,
/// Rechtsgrundlage als Kopie) und schreibt je Kategorie einen ETB-Eintrag — auf der
/// Abschluss-Transaktion (Spec „Kategorie-Frist beim Abschluss“). Eine schon vorhandene Zeile
/// bleibt unverändert. Liefert die Kennungen der neuen ETB-Einträge, damit die Route sie nach
/// dem Commit live meldet (LFH-858).
pub(super) async fn fristen_beim_abschluss(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    von_benutzer_id: i64,
    etb_startwert: i64,
    stil: crate::zeitdarstellung::Zeitstil,
    abgeschlossen_at: &str,
    vorgaben: &[KategorieVorgabe],
) -> Result<Vec<i64>, AppError> {
    let mut etb_eintrag_ids = Vec::new();
    for v in vorgaben {
        let Some(frist) = berechne_retention_bis(abgeschlossen_at, v.dauer_tage) else {
            continue;
        };
        let res = sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, frist_gesetzt_at) VALUES (?, ?, ?, ?, ?) \
             ON CONFLICT(einsatz_id, kategorie) DO NOTHING",
        )
        .bind(einsatz_id)
        .bind(v.kategorie.as_str())
        .bind(&frist)
        .bind(&v.rechtsgrundlage)
        // Die Frist gilt als beim Abschluss gesetzt (LFH-1049): ihre Karenz beginnt mit ihrem
        // Ablauf, nicht erst mit dem Purge-Lauf, der vormerkt.
        .bind(abgeschlossen_at)
        .execute(&mut *conn)
        .await?;
        if res.rows_affected() == 0 {
            continue;
        }
        let inhalt = format!(
            "Aufbewahrungsfrist der Datenkategorie „{}“ automatisch gesetzt auf {} \
             (Dauer {} Tage ab Abschluss; Rechtsgrundlage: {})",
            v.kategorie.bezeichnung(),
            stil.zeitpunkt_text(&frist),
            v.dauer_tage,
            v.rechtsgrundlage
        );
        etb_eintrag_ids
            .push(etb_eintrag(conn, einsatz_id, von_benutzer_id, etb_startwert, &inhalt).await?);
    }
    Ok(etb_eintrag_ids)
}

/// Ergebnis einer manuellen Kategorie-Frist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FristErgebnis {
    /// Frist unverändert: kein Schreibvorgang, kein ETB-Eintrag.
    Unveraendert,
    Geaendert,
}

/// Eingabe für [`frist_setzen`], vom Handler normalisiert.
#[derive(Debug, Clone, Copy)]
pub struct FristAenderung<'a> {
    pub kategorie: Datenkategorie,
    /// Neue Frist im DB-Format; `None` hebt sie auf (die Kategorie folgt der Einsatz-Frist).
    pub neue_frist: Option<&'a str>,
    /// Rechtsgrundlage, getrimmt; Pflicht, wenn die Kategorie noch keine Frist-Zeile hat.
    pub rechtsgrundlage: Option<&'a str>,
    /// Bestätigung einer Verkürzung.
    pub bestaetigt: bool,
}

/// Setzt, verlängert oder hebt die Frist einer Kategorie an einem abgeschlossenen Einsatz auf
/// (Spec „Kategorie-Frist am Einsatz ändern“, „Kategorie-Vormerkung und Wiederherstellen“). Alle
/// Prüfungen laufen in derselben schreibenden Transaktion wie das Schreiben, damit ein
/// paralleler Purge-Lauf nicht dazwischen vormerkt oder schwärzt:
/// - Einsatz unbekannt 404, aktiv 409, geschwärzt 409, vorgemerkt 422 (`aufbewahrung::frist_sperre`);
/// - Kategorie geschwärzt oder nach ihrer Karenz 409;
/// - in der Karenz: eine künftige Frist oder das Aufheben nimmt die Vormerkung zurück; eine
///   Frist, die nicht in der Zukunft liegt, ist 422;
/// - Verkürzung ohne Bestätigung 409; erste Frist ohne Rechtsgrundlage 422.
pub async fn frist_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    aenderung: FristAenderung<'_>,
    jetzt: DateTime<Utc>,
) -> Result<FristErgebnis, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    // Alte und neue Frist und die Vormerkung im ETB in Zone und Darstellung des Einsatzes
    // (LLH-1540).
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let k = aenderung.kategorie;
    crate::write_retry!(pool, |conn| {
        let einsatz: Option<(String, Option<String>, Option<String>)> =
            sqlx::query_as("SELECT status, geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_optional(&mut *conn)
                .await?;
        let Some((status, geloescht_at, geschwaerzt_at)) = einsatz else {
            return Err(AppError::NotFound);
        };
        if status != STATUS_ABGESCHLOSSEN {
            return Err(AppError::Conflict(
                "Einsatz ist nicht abgeschlossen — die Frist einer Datenkategorie entsteht erst \
                 beim Abschluss"
                    .into(),
            ));
        }
        if let Some(sperre) = crate::aufbewahrung::frist_sperre(
            geloescht_at.as_deref(),
            geschwaerzt_at.as_deref(),
            jetzt,
        ) {
            return Err(sperre);
        }

        let zeile: Option<Roh> = sqlx::query_as(
            "SELECT kategorie, frist_bis, rechtsgrundlage, vorgemerkt_at, geschwaerzt_at \
             FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ? AND kategorie = ?",
        )
        .bind(einsatz_id)
        .bind(k.as_str())
        .fetch_optional(&mut *conn)
        .await?;
        let zeile = zeile.and_then(aus_roh);

        if let Some(z) = &zeile {
            if z.geschwaerzt_at.is_some() {
                return Err(AppError::Conflict(format!(
                    "Die Datenkategorie „{}“ ist geschwärzt — ihre Frist ist nicht mehr änderbar",
                    k.bezeichnung()
                )));
            }
            if karenz_abgelaufen(z.vorgemerkt_at.as_deref(), jetzt) {
                return Err(AppError::Conflict(format!(
                    "Die Karenz der Datenkategorie „{}“ ist abgelaufen — die Schwärzung steht \
                     aus, die Frist ist nicht mehr änderbar",
                    k.bezeichnung()
                )));
            }
        }
        let vorgemerkt_at = zeile.as_ref().and_then(|z| z.vorgemerkt_at.clone());
        let alt = zeile.as_ref().and_then(|z| z.frist_bis.clone());
        let rechtsgrundlage_neu = aenderung.rechtsgrundlage.filter(|r| !r.is_empty());
        if let Some(r) = rechtsgrundlage_neu {
            if r.chars().count() > RECHTSGRUNDLAGE_MAX {
                return Err(AppError::Validation(format!(
                    "Rechtsgrundlage darf höchstens {RECHTSGRUNDLAGE_MAX} Zeichen lang sein"
                )));
            }
        }

        if vorgemerkt_at.is_some() {
            if aenderung
                .neue_frist
                .is_some_and(|neu| neu <= jetzt_s.as_str())
            {
                return Err(AppError::UnprocessableEntity(
                    "Die Datenkategorie ist vorgemerkt — eine neue Frist muss in der Zukunft liegen"
                        .into(),
                ));
            }
        } else {
            // Ohne Frist vorher und nachher gibt es nichts zu ändern — auch eine mitgeschickte
            // Rechtsgrundlage legt keine Zeile an (sie gehört zu einer Frist, Review LFH-749).
            if alt.is_none() && aenderung.neue_frist.is_none() {
                return Ok(FristErgebnis::Unveraendert);
            }
            let rg_unveraendert = rechtsgrundlage_neu
                .is_none_or(|r| zeile.as_ref().is_some_and(|z| z.rechtsgrundlage == r));
            if alt.as_deref() == aenderung.neue_frist && rg_unveraendert {
                return Ok(FristErgebnis::Unveraendert);
            }
            if crate::einsatz::berechtigung::ist_fristverkuerzung(
                alt.as_deref(),
                aenderung.neue_frist,
            ) && !aenderung.bestaetigt
            {
                return Err(AppError::Conflict(
                    "Verkürzung der Aufbewahrungsfrist muss bestätigt werden".into(),
                ));
            }
        }

        let rechtsgrundlage = match (&zeile, rechtsgrundlage_neu) {
            (_, Some(r)) => r.to_string(),
            (Some(z), None) => z.rechtsgrundlage.clone(),
            (None, None) => {
                if aenderung.neue_frist.is_none() {
                    return Ok(FristErgebnis::Unveraendert);
                }
                return Err(AppError::UnprocessableEntity(format!(
                    "Die erste Frist der Datenkategorie „{}“ braucht eine Rechtsgrundlage",
                    k.bezeichnung()
                )));
            }
        };

        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, vorgemerkt_at, frist_gesetzt_at) VALUES (?, ?, ?, ?, NULL, ?) \
             ON CONFLICT(einsatz_id, kategorie) DO UPDATE SET frist_bis = excluded.frist_bis, \
                rechtsgrundlage = excluded.rechtsgrundlage, vorgemerkt_at = NULL, \
                frist_gesetzt_at = excluded.frist_gesetzt_at \
             WHERE geschwaerzt_at IS NULL",
        )
        .bind(einsatz_id)
        .bind(k.as_str())
        .bind(aenderung.neue_frist)
        .bind(&rechtsgrundlage)
        .bind(&jetzt_s)
        .execute(&mut *conn)
        .await?;

        let name = k.bezeichnung();
        let z = |wire: &str| stil.zeitpunkt_text(wire);
        // Alter und neuer Wert stehen im ETB (Spec „Kategorie-Frist am Einsatz ändern“), für die
        // Frist wie für die Rechtsgrundlage.
        let mut audit = match (alt.as_deref(), aenderung.neue_frist) {
            (Some(a), None) => format!(
                "Aufbewahrungsfrist der Datenkategorie „{name}“ aufgehoben (bisher {}; folgt \
                 jetzt der Frist des Einsatzes)",
                z(a)
            ),
            (None, None) => format!("Aufbewahrungsfrist der Datenkategorie „{name}“ unverändert"),
            (None, Some(neu)) => {
                format!(
                    "Aufbewahrungsfrist der Datenkategorie „{name}“ gesetzt auf {}",
                    z(neu)
                )
            }
            (Some(a), Some(neu)) if a == neu => {
                format!(
                    "Aufbewahrungsfrist der Datenkategorie „{name}“ unverändert {}",
                    z(neu)
                )
            }
            (Some(a), Some(neu)) => {
                format!(
                    "Aufbewahrungsfrist der Datenkategorie „{name}“ geändert von {} auf {}",
                    z(a),
                    z(neu)
                )
            }
        };
        if let Some(v) = &vorgemerkt_at {
            audit.push_str(&format!(
                ". Löschvormerkung vom {} aufgehoben (Wiederherstellung während der Karenz)",
                z(v)
            ));
        }
        match zeile.as_ref().map(|z| z.rechtsgrundlage.as_str()) {
            Some(bisher) if bisher != rechtsgrundlage => audit.push_str(&format!(
                ". Rechtsgrundlage geändert von „{bisher}“ auf „{rechtsgrundlage}“"
            )),
            _ => audit.push_str(&format!(". Rechtsgrundlage: {rechtsgrundlage}")),
        }
        etb_eintrag(conn, einsatz_id, erfasser_id, etb_startwert, &audit).await?;
        Ok(FristErgebnis::Geaendert)
    })
}

/// Fällige Kategorien (Phase K1): Frist abgelaufen, nicht vorgemerkt, nicht geschwärzt, an
/// einem abgeschlossenen, nicht geschwärzten Einsatz — auch an einem gesperrten (Spec
/// „Zusammenspiel mit der Einsatz-Frist“).
pub async fn faellige_vormerkung(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<Vec<(i64, Datenkategorie)>, AppError> {
    // Spiegel bleiben aus (LLH-1492, design.md D10): sie enden mit dem Lebensende beim Führer
    // oder nach der Nachbereitung (`einsatz::abraeumen`, LLH-1494).
    let zeilen: Vec<(i64, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT k.einsatz_id, k.kategorie FROM einsatz_aufbewahrung_kategorie k \
         JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE e.status = ? AND e.geschwaerzt_at IS NULL \
           AND k.frist_bis IS NOT NULL AND ? >= k.frist_bis \
           AND k.vorgemerkt_at IS NULL AND k.geschwaerzt_at IS NULL AND {} \
         ORDER BY k.einsatz_id, k.kategorie",
        super::spiegel_filter::nicht_gespiegelt("k.einsatz_id")
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(id, k)| Datenkategorie::parse(&k).map(|k| (id, k)))
        .collect())
}

/// Merkt eine fällige Kategorie vor (Karenz-Start) und schreibt den ETB-Eintrag über die
/// Akteurskette des Purge-Laufs (fail-closed wie `repo::soft_delete_einsatz`). Die Fälligkeit
/// steht im UPDATE selbst: eine zwischenzeitlich verlängerte Frist gewinnt. `false` = nichts
/// zu tun.
///
/// `vorgemerkt_at` ist der Karenz-Beginn (LFH-1049, Spec `aufbewahrung-kategorien`,
/// „Kategorie-Vormerkung und Wiederherstellen“), gerechnet wie in `repo::soft_delete_einsatz`:
/// der späteste von Fristablauf, Setzen der Frist (eine Frist in die Vergangenheit) und
/// Abschluss des Einsatzes (eine Frist, die ablief, während er wieder aktiv war), höchstens
/// `jetzt`; ohne bekannten Setzzeitpunkt `jetzt`. So beginnt die Karenz nach einem Stillstand
/// oder nach dem Rückspielen einer Sicherung von vor der Vormerkung nicht neu. Liegt der Beginn
/// 30 Tage oder mehr zurück, schwärzt Phase K2 im selben Lauf.
pub async fn vormerken(
    pool: &SqlitePool,
    einsatz_id: i64,
    kategorie: Datenkategorie,
    jetzt: &str,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let stil = crate::zeitdarstellung::zeitstil_laden(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    // `MAX`/`MIN` vergleichen Text; alle Zeitpunkte stehen im Format von `zeit::formatiere_utc`.
    // SQLites `MAX` mit mehreren Argumenten liefert bei einem NULL selbst NULL, daher `COALESCE`.
    let karenz_beginn: Option<String> = sqlx::query_scalar(
        "UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = CASE \
             WHEN frist_gesetzt_at IS NULL THEN ? \
             ELSE MIN(?, MAX(frist_bis, frist_gesetzt_at, COALESCE( \
                 (SELECT e.abgeschlossen_at FROM einsatz e WHERE e.id = einsatz_id), ?))) END \
         WHERE einsatz_id = ? AND kategorie = ? AND vorgemerkt_at IS NULL \
           AND geschwaerzt_at IS NULL AND frist_bis IS NOT NULL AND ? >= frist_bis \
           AND EXISTS (SELECT 1 FROM einsatz e WHERE e.id = einsatz_id AND e.status = ? \
                       AND e.geschwaerzt_at IS NULL) \
         RETURNING vorgemerkt_at",
    )
    .bind(jetzt)
    .bind(jetzt)
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .bind(jetzt)
    .bind(STATUS_ABGESCHLOSSEN)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(karenz_beginn) = karenz_beginn else {
        return Ok(false);
    };
    let rechtsgrundlage: String = sqlx::query_scalar(
        "SELECT rechtsgrundlage FROM einsatz_aufbewahrung_kategorie \
         WHERE einsatz_id = ? AND kategorie = ?",
    )
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .fetch_one(&mut *tx)
    .await?;
    // Ein Karenz-Beginn vor dem Lauf steht im ETB (LFH-1049): er erklärt, warum die Schwärzung
    // schon kurz nach der Vormerkung folgt. Er steht in Zone und Darstellung des Einsatzes
    // (LLH-1476).
    let seit = if karenz_beginn.as_str() < jetzt {
        format!(" seit {}", stil.zeitpunkt_text(&karenz_beginn))
    } else {
        String::new()
    };
    let inhalt = format!(
        "Aufbewahrungsfrist der Datenkategorie „{}“ abgelaufen — zur Löschung vorgemerkt. Die \
         Karenz bis zur unwiderruflichen Schwärzung läuft{seit}; die Vormerkung der Kategorie \
         sperrt den Einsatz nicht (Rechtsgrundlage: {rechtsgrundlage})",
        kategorie.bezeichnung()
    );
    system_audit_tx(&mut tx, einsatz_id, etb_startwert, &inhalt).await?;
    tx.commit().await?;
    Ok(true)
}

/// Vorgemerkte, noch nicht geschwärzte Kategorien (Phase-K2-Kandidaten) als
/// `(einsatz_id, kategorie, vorgemerkt_at)`; die Karenz prüft der Aufrufer bzw. das bewachte
/// UPDATE in [`schwaerzen`].
pub async fn faellige_schwaerzung(
    pool: &SqlitePool,
) -> Result<Vec<(i64, Datenkategorie, String)>, AppError> {
    // Spiegel bleiben aus (LLH-1492, design.md D10): sie enden mit dem Lebensende beim Führer
    // oder nach der Nachbereitung (`einsatz::abraeumen`, LLH-1494).
    let zeilen: Vec<(i64, String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT k.einsatz_id, k.kategorie, k.vorgemerkt_at FROM einsatz_aufbewahrung_kategorie k \
         JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE e.status = ? AND e.geschwaerzt_at IS NULL \
           AND k.vorgemerkt_at IS NOT NULL AND k.geschwaerzt_at IS NULL AND {} \
         ORDER BY k.einsatz_id, k.kategorie",
        super::spiegel_filter::nicht_gespiegelt("k.einsatz_id")
    )))
    .bind(STATUS_ABGESCHLOSSEN)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|(id, k, v)| Datenkategorie::parse(&k).map(|k| (id, k, v)))
        .collect())
}

/// IRREVERSIBLE Schwärzung einer Kategorie nach ihrer Karenz (Spec „Kategorie-Schwärzung“):
/// Tombstone, Scrub der Kategorie aus der Registry, Personenstamm-Schritt (design.md D3) und
/// ETB-Eintrag in EINER Transaktion; Anhänge löscht danach der Nachlauf einzeln (LFH-905).
/// Idempotent über den Tombstone-Guard; `false` = nichts zu
/// tun (schon geschwärzt, Karenz läuft noch, Einsatz geschwärzt oder nicht abgeschlossen).
pub async fn schwaerzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    kategorie: Datenkategorie,
    jetzt: DateTime<Utc>,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let mut tx = pool.begin().await?;
    let res = sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET geschwaerzt_at = ? \
         WHERE einsatz_id = ? AND kategorie = ? AND geschwaerzt_at IS NULL \
           AND vorgemerkt_at IS NOT NULL AND vorgemerkt_at <= ? \
           AND EXISTS (SELECT 1 FROM einsatz e WHERE e.id = einsatz_id AND e.status = ? \
                       AND e.geschwaerzt_at IS NULL)",
    )
    .bind(&jetzt_s)
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .bind(karenz_grenze(jetzt))
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }

    scrubbe_aus_registry(&mut tx, einsatz_id, Umfang::Kategorie(kategorie)).await?;
    // Die Bruchstelle (LLH-1641, E6) sichert ganze Zeilen als JSON, gleich welcher Kategorie;
    // ihre Spalten folgen in der Registry dem Einsatz. Damit keine Kopie eine kürzere Frist
    // überlebt, geht sie mit der ersten geschwärzten Kategorie ganz, am Spiegel über die Marke
    // am Kopf (LLH-1649).
    super::repo::nach_schwaerzung_tx(&mut tx, einsatz_id).await?;

    // Personenstamm (design.md D3): erst wenn alle Zwecke der Person geschwärzt sind. Nur die
    // Kategorie dieses Laufs kann daran etwas ändern; der ETB-Eintrag nennt den Stamm deshalb
    // nur, wenn dieser Lauf ihn tatsächlich (weiter) schwärzt (Review LFH-749).
    let geschwaerzt: Vec<String> = sqlx::query_scalar(
        "SELECT kategorie FROM einsatz_aufbewahrung_kategorie \
         WHERE einsatz_id = ? AND geschwaerzt_at IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *tx)
    .await?;
    let ist_weg = |k: Datenkategorie| geschwaerzt.iter().any(|g| g == k.as_str());
    let stamm = match kategorie {
        Datenkategorie::Personenauskunft if ist_weg(Datenkategorie::Behandlung) => {
            Some((false, "aller Personen"))
        }
        Datenkategorie::Personenauskunft => Some((true, "der Personen ohne Behandlungsbezug")),
        Datenkategorie::Behandlung if ist_weg(Datenkategorie::Personenauskunft) => {
            Some((false, "der Personen mit Behandlungsbezug"))
        }
        Datenkategorie::Behandlung | Datenkategorie::Anhaenge => None,
    };
    if let Some((nur_ohne_behandlungsbezug, _)) = stamm {
        scrubbe_aus_registry(
            &mut tx,
            einsatz_id,
            Umfang::Personenstamm {
                nur_ohne_behandlungsbezug,
            },
        )
        .await?;
    }

    let rechtsgrundlage: String = sqlx::query_scalar(
        "SELECT rechtsgrundlage FROM einsatz_aufbewahrung_kategorie \
         WHERE einsatz_id = ? AND kategorie = ?",
    )
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .fetch_one(&mut *tx)
    .await?;
    let mut inhalt = format!(
        "Datenkategorie „{}“ unwiderruflich geschwärzt (Frist und Karenz abgelaufen; \
         Rechtsgrundlage: {rechtsgrundlage}). Entfernt: {}",
        kategorie.bezeichnung(),
        kategorie.entfernt()
    );
    if let Some((_, wessen)) = stamm {
        inhalt.push_str(&format!(
            "; dazu der Personenstamm {wessen} (Name, Vorname, Geschlecht, Geburtsdatum, \
             geschätztes Alter, Fundort, Personennotiz, Verbleib)"
        ));
    }
    inhalt.push_str(
        ". Die Schwärzung der Kategorie sperrt den Einsatz nicht; das ETB im Wortlaut, \
         Registriernummern sowie Sichtungs- und Statuskategorien bleiben erhalten.",
    );
    system_audit_tx(&mut tx, einsatz_id, etb_startwert, &inhalt).await?;
    tx.commit().await?;
    tracing::warn!(
        einsatz_id,
        kategorie = kategorie.as_str(),
        "Purge Phase K2 abgeschlossen: Datenkategorie geschwärzt"
    );
    // Anhänge und Bilder der Lagekarte löscht der Nachlauf einzeln nach dem Commit (LFH-905,
    // LFH-997).
    if kategorie == Datenkategorie::Anhaenge {
        super::schwaerzung_nachlauf::nachlaufen(pool, einsatz_id).await;
    }
    Ok(true)
}

/// Aufbewahrung einer Datenkategorie am Einsatz (Spec „Zustand je Kategorie“, design.md D7).
/// Kein Personenbezug: Zeitpunkte, Zustand und der Org-Text der Rechtsgrundlage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct KategorieAufbewahrungAnzeige {
    pub kategorie: Datenkategorie,
    /// Frist der Kategorie; fehlt = keine eigene Frist (folgt der Einsatz-Frist).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frist_bis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vorgemerkt_at: Option<String>,
    /// Ende der Karenz (`vorgemerkt_at + 30 Tage`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karenz_ende: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geschwaerzt_at: Option<String>,
    /// Rechtsgrundlage der Frist; bei einem aktiven Einsatz die der Org-Vorgabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rechtsgrundlage: Option<String>,
    /// Zustand nach derselben Rangfolge wie der Einsatz; fehlt bei einem aktiven Einsatz.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zustand: Option<AufbewahrungZustand>,
    /// Nur bei einem aktiven Einsatz: die Dauer der Org-Vorgabe, aus der die Frist beim
    /// Abschluss entsteht; fehlt = die Kategorie folgt der Einsatz-Frist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dauer_tage_vorgabe: Option<i64>,
}

/// Zustand einer Kategorie (Spec „Zustand je Kategorie“): `None` für einen nicht
/// abgeschlossenen Einsatz; ein geschwärzter Einsatz macht jede Kategorie `geschwaerzt`; ohne
/// Zeile `ohne_frist`; sonst [`super::retention::zustand`] auf die Kategorie-Werte — dieselbe
/// Zeitrechnung wie für den Einsatz.
pub fn kategorie_zustand(
    status: &str,
    einsatz_geschwaerzt_at: Option<&str>,
    zeile: Option<&KategorieZeile>,
    jetzt: DateTime<Utc>,
) -> Option<AufbewahrungZustand> {
    if status != STATUS_ABGESCHLOSSEN {
        return None;
    }
    if einsatz_geschwaerzt_at.is_some_and(|g| !g.is_empty()) {
        return Some(AufbewahrungZustand::Geschwaerzt);
    }
    let Some(z) = zeile else {
        return Some(AufbewahrungZustand::OhneFrist);
    };
    super::retention::zustand(
        status,
        z.frist_bis.as_deref(),
        z.vorgemerkt_at.as_deref(),
        z.geschwaerzt_at.as_deref(),
        // Ein Löschersuchen (LFH-751) betrifft den Einsatz oder eine Person, keine Kategorie;
        // sein Zustand steht am Einsatz.
        None,
        // Eine Kategorie hat keine eigene endgültige Löschung (LFH-750); die betrifft nur den
        // ganzen Einsatz und steht an dessen Zustand.
        None,
        None,
        jetzt,
    )
}

/// Kopf-Angaben des Einsatzes, die die Anzeige braucht.
#[derive(Debug, Clone, Copy)]
pub struct EinsatzStand<'a> {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub status: &'a str,
    pub geschwaerzt_at: Option<&'a str>,
}

/// Alle drei Kategorien eines Einsatzes in Anzeigeform, in Deklarationsreihenfolge.
pub async fn anzeige(
    pool: &SqlitePool,
    einsatz: EinsatzStand<'_>,
    jetzt: DateTime<Utc>,
) -> Result<Vec<KategorieAufbewahrungAnzeige>, AppError> {
    let zeilen = laden(pool, einsatz.einsatz_id).await?;
    let aktiv = einsatz.status != STATUS_ABGESCHLOSSEN;
    let vorgaben = if aktiv {
        crate::org::aufbewahrung_kategorie::laden(pool, einsatz.org_id).await?
    } else {
        Vec::new()
    };
    let einsatz_geschwaerzt = einsatz.geschwaerzt_at.filter(|g| !g.is_empty());
    Ok(Datenkategorie::ALLE
        .iter()
        .map(|&k| {
            let zeile = zeilen.iter().find(|z| z.kategorie == k);
            let vorgabe = vorgaben.iter().find(|v| v.kategorie == k);
            KategorieAufbewahrungAnzeige {
                kategorie: k,
                frist_bis: zeile.and_then(|z| z.frist_bis.clone()),
                vorgemerkt_at: zeile.and_then(|z| z.vorgemerkt_at.clone()),
                karenz_ende: zeile
                    .and_then(|z| super::retention::karenz_ende(z.vorgemerkt_at.as_deref())),
                geschwaerzt_at: zeile
                    .and_then(|z| z.geschwaerzt_at.clone())
                    .or_else(|| einsatz_geschwaerzt.map(String::from)),
                rechtsgrundlage: zeile
                    .map(|z| z.rechtsgrundlage.clone())
                    .or_else(|| vorgabe.map(|v| v.rechtsgrundlage.clone())),
                zustand: kategorie_zustand(einsatz.status, einsatz.geschwaerzt_at, zeile, jetzt),
                dauer_tage_vorgabe: vorgabe.map(|v| v.dauer_tage),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests;

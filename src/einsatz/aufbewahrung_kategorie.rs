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
                "Zustand der Personen sowie die Notizen zu Sichtung, Verlauf und UHS-Belegung"
            }
            Datenkategorie::Personenauskunft => "Herkunftsadresse und Melderkontakt der Personen",
            Datenkategorie::Anhaenge => {
                "alle Datei-Anhänge samt ihrer Ablage als Dokument (an Schäden, Chat und ETB)"
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

async fn etb_eintrag(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    erfasser_id: i64,
    etb_startwert: i64,
    inhalt: &str,
) -> Result<(), AppError> {
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
    .await?;
    Ok(())
}

/// Legt beim Abschluss je Org-Vorgabe die Kategorie-Frist an (`abgeschlossen_at + dauer`,
/// Rechtsgrundlage als Kopie) und schreibt je Kategorie einen ETB-Eintrag — auf der
/// Abschluss-Transaktion (Spec „Kategorie-Frist beim Abschluss“). Eine schon vorhandene Zeile
/// bleibt unverändert.
pub(super) async fn fristen_beim_abschluss(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    von_benutzer_id: i64,
    etb_startwert: i64,
    abgeschlossen_at: &str,
    vorgaben: &[KategorieVorgabe],
) -> Result<(), AppError> {
    for v in vorgaben {
        let Some(frist) = berechne_retention_bis(abgeschlossen_at, v.dauer_tage) else {
            continue;
        };
        let res = sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage) VALUES (?, ?, ?, ?) \
             ON CONFLICT(einsatz_id, kategorie) DO NOTHING",
        )
        .bind(einsatz_id)
        .bind(v.kategorie.as_str())
        .bind(&frist)
        .bind(&v.rechtsgrundlage)
        .execute(&mut *conn)
        .await?;
        if res.rows_affected() == 0 {
            continue;
        }
        let inhalt = format!(
            "Aufbewahrungsfrist der Datenkategorie „{}“ automatisch gesetzt auf {frist} \
             (Dauer {} Tage ab Abschluss; Rechtsgrundlage: {})",
            v.kategorie.bezeichnung(),
            v.dauer_tage,
            v.rechtsgrundlage
        );
        etb_eintrag(conn, einsatz_id, von_benutzer_id, etb_startwert, &inhalt).await?;
    }
    Ok(())
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
                rechtsgrundlage, vorgemerkt_at) VALUES (?, ?, ?, ?, NULL) \
             ON CONFLICT(einsatz_id, kategorie) DO UPDATE SET frist_bis = excluded.frist_bis, \
                rechtsgrundlage = excluded.rechtsgrundlage, vorgemerkt_at = NULL \
             WHERE geschwaerzt_at IS NULL",
        )
        .bind(einsatz_id)
        .bind(k.as_str())
        .bind(aenderung.neue_frist)
        .bind(&rechtsgrundlage)
        .execute(&mut *conn)
        .await?;

        let name = k.bezeichnung();
        // Alter und neuer Wert stehen im ETB (Spec „Kategorie-Frist am Einsatz ändern“), für die
        // Frist wie für die Rechtsgrundlage.
        let mut audit = match (alt.as_deref(), aenderung.neue_frist) {
            (Some(a), None) => format!(
                "Aufbewahrungsfrist der Datenkategorie „{name}“ aufgehoben (bisher {a}; folgt \
                 jetzt der Frist des Einsatzes)"
            ),
            (None, None) => format!("Aufbewahrungsfrist der Datenkategorie „{name}“ unverändert"),
            (None, Some(neu)) => {
                format!("Aufbewahrungsfrist der Datenkategorie „{name}“ gesetzt auf {neu}")
            }
            (Some(a), Some(neu)) if a == neu => {
                format!("Aufbewahrungsfrist der Datenkategorie „{name}“ unverändert {neu}")
            }
            (Some(a), Some(neu)) => {
                format!("Aufbewahrungsfrist der Datenkategorie „{name}“ geändert von {a} auf {neu}")
            }
        };
        if let Some(v) = &vorgemerkt_at {
            audit.push_str(&format!(
                ". Löschvormerkung vom {v} aufgehoben (Wiederherstellung während der Karenz)"
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
    let zeilen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT k.einsatz_id, k.kategorie FROM einsatz_aufbewahrung_kategorie k \
         JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE e.status = ? AND e.geschwaerzt_at IS NULL \
           AND k.frist_bis IS NOT NULL AND ? >= k.frist_bis \
           AND k.vorgemerkt_at IS NULL AND k.geschwaerzt_at IS NULL \
         ORDER BY k.einsatz_id, k.kategorie",
    )
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
pub async fn vormerken(
    pool: &SqlitePool,
    einsatz_id: i64,
    kategorie: Datenkategorie,
    jetzt: &str,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::etb_startwert(pool, einsatz_id).await?;
    let mut tx = pool.begin().await?;
    let res = sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET vorgemerkt_at = ? \
         WHERE einsatz_id = ? AND kategorie = ? AND vorgemerkt_at IS NULL \
           AND geschwaerzt_at IS NULL AND frist_bis IS NOT NULL AND ? >= frist_bis \
           AND EXISTS (SELECT 1 FROM einsatz e WHERE e.id = einsatz_id AND e.status = ? \
                       AND e.geschwaerzt_at IS NULL)",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .bind(jetzt)
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }
    let rechtsgrundlage: String = sqlx::query_scalar(
        "SELECT rechtsgrundlage FROM einsatz_aufbewahrung_kategorie \
         WHERE einsatz_id = ? AND kategorie = ?",
    )
    .bind(einsatz_id)
    .bind(kategorie.as_str())
    .fetch_one(&mut *tx)
    .await?;
    let inhalt = format!(
        "Aufbewahrungsfrist der Datenkategorie „{}“ abgelaufen — zur Löschung vorgemerkt. Die \
         Karenz bis zur unwiderruflichen Schwärzung läuft; die Vormerkung der Kategorie sperrt \
         den Einsatz nicht (Rechtsgrundlage: {rechtsgrundlage})",
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
    let zeilen: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT k.einsatz_id, k.kategorie, k.vorgemerkt_at FROM einsatz_aufbewahrung_kategorie k \
         JOIN einsatz e ON e.id = k.einsatz_id \
         WHERE e.status = ? AND e.geschwaerzt_at IS NULL \
           AND k.vorgemerkt_at IS NOT NULL AND k.geschwaerzt_at IS NULL \
         ORDER BY k.einsatz_id, k.kategorie",
    )
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
/// ETB-Eintrag in EINER Transaktion. Idempotent über den Tombstone-Guard; `false` = nichts zu
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
             geschätztes Alter, Antreffort, Personennotiz, Verbleib)"
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
mod tests {
    use super::super::repo::{anlegen, NeuerEinsatzDaten};
    use super::*;

    /// Org 1, ein Benutzer und ein aktiver Einsatz; liefert `(einsatz_id, benutzer_id)`.
    pub(super) async fn einsatz_mit_leitung(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let leit: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz = anlegen(
            pool,
            NeuerEinsatzDaten {
                bezeichnung: "Lage",
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
            },
            leit,
        )
        .await
        .unwrap();
        (einsatz.id, leit)
    }

    /// Eine Person mit jedem personenbezogenen Feld gesetzt; liefert ihre id.
    pub(super) async fn volle_person(pool: &SqlitePool, einsatz: i64, nr: i64, von: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
                geschlecht, geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
                melder_kontakt, notiz, aktueller_verbleib, zustand, antreff_lat, antreff_lon, \
                aktuelles_verbleib_ziel, erfasst_von, geaendert_von) \
             VALUES (?, ?, 'betroffen', 'Mustermann', 'Erika', 'weiblich', '1970-01-01', 55, \
                'Hauptstr. 5', 'Marktplatz', '0170 123', 'Notiz', 'Transport → KH', NULL, \
                52.1, 9.1, 'KH Mitte', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(nr)
        .bind(von)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    type PersonFelder = (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );

    /// `(name, geburtsdatum, herkunft_adresse, melder_kontakt, antreff_ort, aktuelles_verbleib_ziel)`.
    pub(super) async fn person_felder(pool: &SqlitePool, id: i64) -> PersonFelder {
        sqlx::query_as(
            "SELECT name, geburtsdatum, herkunft_adresse, melder_kontakt, antreff_ort, \
                aktuelles_verbleib_ziel FROM einsatz_person WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Org-Vorgabe direkt in der DB (die Route deckt `tests/org_einstellungen.rs` ab).
    pub(super) async fn org_vorgabe(pool: &SqlitePool, k: Datenkategorie, tage: i64, rg: &str) {
        sqlx::query(
            "INSERT INTO org_aufbewahrung_kategorie (org_id, kategorie, dauer_tage, \
                rechtsgrundlage, geaendert_at) VALUES (1, ?, ?, ?, datetime('now')) \
             ON CONFLICT(org_id, kategorie) DO UPDATE SET dauer_tage = excluded.dauer_tage, \
                rechtsgrundlage = excluded.rechtsgrundlage",
        )
        .bind(k.as_str())
        .bind(tage)
        .bind(rg)
        .execute(pool)
        .await
        .unwrap();
    }

    pub(super) async fn etb_texte(pool: &SqlitePool, einsatz: i64) -> Vec<String> {
        sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
            .bind(einsatz)
            .fetch_all(pool)
            .await
            .unwrap()
    }

    // ---------- Kategorie-Frist beim Abschluss ----------

    #[tokio::test]
    async fn abschluss_legt_kategorie_frist_mit_etb_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
        org_vorgabe(
            &pool,
            Datenkategorie::Personenauskunft,
            0,
            "§ 46 Abs. 5 BHKG NRW",
        )
        .await;
        org_vorgabe(&pool, Datenkategorie::Anhaenge, 30, "§ 32b Abs. 3 NKatSG").await;

        let e = super::super::repo::abschliessen(&pool, einsatz, leit)
            .await
            .unwrap();
        let abgeschlossen_at = e.abgeschlossen_at.unwrap();

        let zeilen = laden(&pool, einsatz).await.unwrap();
        assert_eq!(zeilen.len(), 2);
        let finde = |k: Datenkategorie| zeilen.iter().find(|z| z.kategorie == k).unwrap();
        let auskunft = finde(Datenkategorie::Personenauskunft);
        assert_eq!(
            auskunft.frist_bis.as_deref(),
            Some(abgeschlossen_at.as_str())
        );
        assert_eq!(auskunft.rechtsgrundlage, "§ 46 Abs. 5 BHKG NRW");
        assert_eq!(auskunft.vorgemerkt_at, None);
        assert_eq!(
            finde(Datenkategorie::Anhaenge).frist_bis,
            berechne_retention_bis(&abgeschlossen_at, 30)
        );

        let etb = etb_texte(&pool, einsatz).await;
        let eintrag = etb
            .iter()
            .find(|t| t.contains("„Personenauskunft“"))
            .expect("ETB-Eintrag zur Kategorie-Frist");
        assert!(eintrag.contains(&abgeschlossen_at));
        assert!(eintrag.contains("§ 46 Abs. 5 BHKG NRW"));
        assert!(etb.iter().any(|t| t.contains("„Anhänge“")));
    }

    #[tokio::test]
    async fn abschluss_ohne_vorgabe_legt_nichts_an() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
        let vorher = etb_texte(&pool, einsatz).await.len();
        super::super::repo::abschliessen(&pool, einsatz, leit)
            .await
            .unwrap();
        assert!(laden(&pool, einsatz).await.unwrap().is_empty());
        assert!(etb_texte(&pool, einsatz)
            .await
            .iter()
            .skip(vorher)
            .all(|t| !t.contains("Datenkategorie")));
    }

    #[tokio::test]
    async fn spaetere_org_aenderung_und_zweiter_abschluss_lassen_frist_stehen() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
        org_vorgabe(
            &pool,
            Datenkategorie::Behandlung,
            3650,
            "§ 630f BGB entsprechend",
        )
        .await;
        super::super::repo::abschliessen(&pool, einsatz, leit)
            .await
            .unwrap();
        let vorher = laden(&pool, einsatz).await.unwrap();

        org_vorgabe(&pool, Datenkategorie::Behandlung, 10, "neu").await;
        // Zweiter Abschluss ist ein No-Op (Einsatz schon abgeschlossen).
        super::super::repo::abschliessen(&pool, einsatz, leit)
            .await
            .unwrap();
        assert_eq!(laden(&pool, einsatz).await.unwrap(), vorher);
        let anzahl = etb_texte(&pool, einsatz)
            .await
            .iter()
            .filter(|t| t.contains("„Behandlung“"))
            .count();
        assert_eq!(anzahl, 1, "kein zweiter Eintrag");
    }

    // ---------- Kategorie-Frist am Einsatz (frist_setzen) ----------

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    const JETZT: &str = "2026-06-30 12:00:00";

    /// Abgeschlossener Einsatz mit Org-Vorgabe `personenauskunft` (Frist ab Abschluss + 30 T).
    async fn abgeschlossen_mit_kategorie(pool: &SqlitePool) -> (i64, i64) {
        let (einsatz, leit) = einsatz_mit_leitung(pool).await;
        org_vorgabe(pool, Datenkategorie::Personenauskunft, 30, "RG").await;
        super::super::repo::abschliessen(pool, einsatz, leit)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-07-30 12:00:00' \
             WHERE einsatz_id = ?",
        )
        .bind(einsatz)
        .execute(pool)
        .await
        .unwrap();
        (einsatz, leit)
    }

    fn aend(
        k: Datenkategorie,
        neu: Option<&'static str>,
        rg: Option<&'static str>,
        bestaetigt: bool,
    ) -> FristAenderung<'static> {
        FristAenderung {
            kategorie: k,
            neue_frist: neu,
            rechtsgrundlage: rg,
            bestaetigt,
        }
    }

    async fn zeile(pool: &SqlitePool, einsatz: i64, k: Datenkategorie) -> Option<KategorieZeile> {
        laden(pool, einsatz)
            .await
            .unwrap()
            .into_iter()
            .find(|z| z.kategorie == k)
    }

    #[tokio::test]
    async fn frist_setzen_verlaengern_verkuerzen_aufheben() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
        let auskunft = Datenkategorie::Personenauskunft;
        let n_etb = || async { etb_texte(&pool, einsatz).await.len() };

        // Unverändert: kein Schreibvorgang, kein ETB-Eintrag.
        let vorher = n_etb().await;
        let r = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-07-30 12:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(r, FristErgebnis::Unveraendert);
        assert_eq!(n_etb().await, vorher);

        // Verlängern ohne Bestätigung.
        let r = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-12-01 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(r, FristErgebnis::Geaendert);
        let etb = etb_texte(&pool, einsatz).await;
        let letzter = etb.last().unwrap();
        assert!(letzter.contains("„Personenauskunft“"), "{letzter}");
        assert!(letzter.contains("2026-07-30 12:00:00") && letzter.contains("2026-12-01 00:00:00"));

        // Verkürzen ohne Bestätigung → 409, nichts geändert.
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-08-01 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
        assert_eq!(
            zeile(&pool, einsatz, auskunft)
                .await
                .unwrap()
                .frist_bis
                .as_deref(),
            Some("2026-12-01 00:00:00")
        );
        // Mit Bestätigung → gilt.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-08-01 00:00:00"), None, true),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(
            zeile(&pool, einsatz, auskunft)
                .await
                .unwrap()
                .frist_bis
                .as_deref(),
            Some("2026-08-01 00:00:00")
        );

        // Gleiche Frist, neue Rechtsgrundlage: Änderung mit altem und neuem Wert im ETB.
        let r = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(
                auskunft,
                Some("2026-08-01 00:00:00"),
                Some("§ 152 StPO"),
                false,
            ),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(r, FristErgebnis::Geaendert);
        let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
        assert!(
            letzter.contains("„RG“") && letzter.contains("„§ 152 StPO“"),
            "{letzter}"
        );

        // Aufheben: folgt der Einsatz-Frist; das ETB nennt den alten Wert.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, None, None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(
            zeile(&pool, einsatz, auskunft).await.unwrap().frist_bis,
            None
        );
        let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
        assert!(
            letzter.contains("aufgehoben (bisher 2026-08-01 00:00:00"),
            "{letzter}"
        );

        // Ohne Frist vorher und nachher: eine Rechtsgrundlage allein schreibt nichts.
        let vorher = n_etb().await;
        let r = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(Datenkategorie::Anhaenge, None, Some("X"), false),
            t(JETZT),
        )
        .await
        .unwrap();
        assert_eq!(r, FristErgebnis::Unveraendert);
        assert_eq!(n_etb().await, vorher);
        assert_eq!(zeile(&pool, einsatz, Datenkategorie::Anhaenge).await, None);
    }

    #[tokio::test]
    async fn erste_frist_braucht_rechtsgrundlage() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
        let anhaenge = Datenkategorie::Anhaenge;
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(anhaenge, Some("2027-01-01 00:00:00"), None, true),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(zeile(&pool, einsatz, anhaenge).await, None);

        // Erstmaliges Setzen ist eine Verkürzung (wie bei der Einsatz-Frist): ohne Bestätigung 409.
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(
                anhaenge,
                Some("2027-01-01 00:00:00"),
                Some("§ 152 StPO"),
                false,
            ),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);

        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(
                anhaenge,
                Some("2027-01-01 00:00:00"),
                Some("§ 152 StPO"),
                true,
            ),
            t(JETZT),
        )
        .await
        .unwrap();
        let z = zeile(&pool, einsatz, anhaenge).await.unwrap();
        assert_eq!(z.rechtsgrundlage, "§ 152 StPO");
        assert!(etb_texte(&pool, einsatz)
            .await
            .last()
            .unwrap()
            .contains("§ 152 StPO"));
    }

    #[tokio::test]
    async fn karenz_wiederherstellen_und_sperren() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
        let auskunft = Datenkategorie::Personenauskunft;
        let setze_vormerkung = |v: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-06-20 00:00:00', \
                        vorgemerkt_at = ? WHERE einsatz_id = ? AND kategorie = 'personenauskunft'",
                )
                .bind(v)
                .bind(einsatz)
                .execute(&pool)
                .await
                .unwrap();
            }
        };

        // 5 Tage vorgemerkt: Frist in der Vergangenheit → 422.
        setze_vormerkung("2026-06-25 12:00:00").await;
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-06-29 00:00:00"), None, true),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
        // Künftige Frist → Vormerkung zurückgenommen.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-08-29 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        let z = zeile(&pool, einsatz, auskunft).await.unwrap();
        assert_eq!(z.vorgemerkt_at, None);
        assert_eq!(z.frist_bis.as_deref(), Some("2026-08-29 00:00:00"));
        assert!(etb_texte(&pool, einsatz)
            .await
            .last()
            .unwrap()
            .contains("Löschvormerkung"));

        // 31 Tage vorgemerkt: Karenz abgelaufen → 409, nichts geändert.
        setze_vormerkung("2026-05-30 12:00:00").await;
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-09-01 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
        assert_eq!(
            zeile(&pool, einsatz, auskunft)
                .await
                .unwrap()
                .vorgemerkt_at
                .as_deref(),
            Some("2026-05-30 12:00:00")
        );

        // Geschwärzte Kategorie → 409.
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET geschwaerzt_at = '2026-06-29 00:00:00' \
             WHERE einsatz_id = ?",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-09-01 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn einsatz_zustand_sperrt() {
        let pool = crate::db::test_pool().await;
        let (aktiv, leit) = einsatz_mit_leitung(&pool).await;
        let a = aend(
            Datenkategorie::Anhaenge,
            Some("2027-01-01 00:00:00"),
            Some("x"),
            true,
        );
        let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
            .await
            .unwrap_err();
        assert_eq!(
            err.status(),
            axum::http::StatusCode::CONFLICT,
            "aktiv → 409"
        );

        super::super::repo::abschliessen(&pool, aktiv, leit)
            .await
            .unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = '2026-06-25 12:00:00' WHERE id = ?")
            .bind(aktiv)
            .execute(&pool)
            .await
            .unwrap();
        let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
            .await
            .unwrap_err();
        assert_eq!(
            err.status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "vorgemerkt → 422"
        );

        sqlx::query("UPDATE einsatz SET geschwaerzt_at = '2026-06-29 12:00:00' WHERE id = ?")
            .bind(aktiv)
            .execute(&pool)
            .await
            .unwrap();
        let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
            .await
            .unwrap_err();
        assert_eq!(
            err.status(),
            axum::http::StatusCode::CONFLICT,
            "geschwärzt → 409"
        );
        assert_eq!(zeile(&pool, aktiv, Datenkategorie::Anhaenge).await, None);
    }

    // ---------- Vormerkung (K1) und Schwärzung (K2) ----------

    /// Setzt Frist und optional Vormerkung einer Kategorie direkt (Zeile muss nicht existieren).
    async fn kategorie_stand(
        pool: &SqlitePool,
        einsatz: i64,
        k: Datenkategorie,
        frist: &str,
        vorgemerkt: Option<&str>,
    ) {
        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, vorgemerkt_at) VALUES (?, ?, ?, 'RG ' || ?, ?) \
             ON CONFLICT(einsatz_id, kategorie) DO UPDATE SET frist_bis = excluded.frist_bis, \
                vorgemerkt_at = excluded.vorgemerkt_at",
        )
        .bind(einsatz)
        .bind(k.as_str())
        .bind(frist)
        .bind(k.as_str())
        .bind(vorgemerkt)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn abgeschlossen(pool: &SqlitePool) -> (i64, i64) {
        let (einsatz, leit) = einsatz_mit_leitung(pool).await;
        // Personen vor dem Abschluss (danach ist der Einsatz schreibgeschützt).
        (einsatz, leit)
    }

    async fn schliessen(pool: &SqlitePool, einsatz: i64, leit: i64) {
        super::super::repo::abschliessen(pool, einsatz, leit)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn vormerken_ist_idempotent_und_laesst_einsatz_lesbar() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen(&pool).await;
        schliessen(&pool, einsatz, leit).await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Personenauskunft,
            "2026-06-01 00:00:00",
            None,
        )
        .await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-12-01 00:00:00",
            None,
        )
        .await;

        let faellig = faellige_vormerkung(&pool, JETZT).await.unwrap();
        assert_eq!(faellig, vec![(einsatz, Datenkategorie::Personenauskunft)]);
        assert!(
            vormerken(&pool, einsatz, Datenkategorie::Personenauskunft, JETZT)
                .await
                .unwrap()
        );
        let z = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
            .await
            .unwrap();
        assert_eq!(z.vorgemerkt_at.as_deref(), Some(JETZT));
        let etb = etb_texte(&pool, einsatz).await;
        assert!(etb
            .last()
            .unwrap()
            .contains("„Personenauskunft“ abgelaufen"));
        // Der Einsatz selbst bleibt unberührt (lesbar).
        let (geloescht, _) = crate::aufbewahrung::repo::tombstones(&pool, einsatz)
            .await
            .unwrap();
        assert_eq!(geloescht, None);

        // Zweiter Lauf: nichts.
        let n = etb.len();
        assert!(faellige_vormerkung(&pool, JETZT).await.unwrap().is_empty());
        assert!(
            !vormerken(&pool, einsatz, Datenkategorie::Personenauskunft, JETZT)
                .await
                .unwrap()
        );
        assert_eq!(etb_texte(&pool, einsatz).await.len(), n);
    }

    #[tokio::test]
    async fn aktiver_einsatz_wird_nie_vorgemerkt() {
        let pool = crate::db::test_pool().await;
        let (einsatz, _) = einsatz_mit_leitung(&pool).await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-01-01 00:00:00",
            None,
        )
        .await;
        assert!(faellige_vormerkung(&pool, JETZT).await.unwrap().is_empty());
        assert!(!vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn vormerken_ohne_akteur_unterbleibt_und_holt_es_mit_admin_nach() {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at) \
             VALUES (1, 'Lage', 'abgeschlossen', '2026-01-01 00:00:00') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-06-01 00:00:00",
            None,
        )
        .await;
        assert!(vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
            .await
            .is_err());
        assert_eq!(
            zeile(&pool, einsatz, Datenkategorie::Anhaenge)
                .await
                .unwrap()
                .vorgemerkt_at,
            None
        );
        assert!(etb_texte(&pool, einsatz).await.is_empty());

        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'a', 'a', 'h', 'admin')",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
            .await
            .unwrap());
    }

    async fn sichtung(pool: &SqlitePool, einsatz: i64, person: i64, von: i64) {
        sqlx::query(
            "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, gesichtet_von) \
             VALUES (?, ?, 'sk2', 'Sichtungsnotiz', ?)",
        )
        .bind(einsatz)
        .bind(person)
        .bind(von)
        .execute(pool)
        .await
        .unwrap();
    }

    type Behandlungsfelder = (Option<String>, Option<String>);

    /// `(zustand, sichtungsnotiz)` einer Person.
    async fn behandlungsfelder(pool: &SqlitePool, person: i64) -> Behandlungsfelder {
        let zustand: Option<String> =
            sqlx::query_scalar("SELECT zustand FROM einsatz_person WHERE id = ?")
                .bind(person)
                .fetch_one(pool)
                .await
                .unwrap();
        let notiz: Option<String> =
            sqlx::query_scalar("SELECT notiz FROM person_sichtung WHERE person_id = ? LIMIT 1")
                .bind(person)
                .fetch_optional(pool)
                .await
                .unwrap()
                .flatten();
        (zustand, notiz)
    }

    /// Spec „Nur registriert“, „Behandelt, Auskunft abgelaufen“, „Beide Zwecke abgelaufen“.
    #[tokio::test]
    async fn personenstamm_folgt_den_zwecken() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen(&pool).await;
        let registriert = volle_person(&pool, einsatz, 1, leit).await;
        let behandelt = volle_person(&pool, einsatz, 2, leit).await;
        sqlx::query("UPDATE einsatz_person SET zustand = 'unterkühlt' WHERE id = ?")
            .bind(behandelt)
            .execute(&pool)
            .await
            .unwrap();
        sichtung(&pool, einsatz, behandelt, leit).await;
        sqlx::query(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, transportmittel, \
                status, erfasst_von) VALUES (?, ?, 'transport', 'KH Mitte', 'RTW', 'angemeldet', ?)",
        )
        .bind(einsatz)
        .bind(registriert)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        schliessen(&pool, einsatz, leit).await;
        let vor_31 = "2026-05-30 12:00:00";
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Personenauskunft,
            "2026-05-01 00:00:00",
            Some(vor_31),
        )
        .await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Behandlung,
            "2026-12-01 00:00:00",
            None,
        )
        .await;

        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
                .await
                .unwrap()
        );

        // Nur registriert: Stamm und Auskunft weg, Verbleib weg.
        let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, registriert).await;
        assert_eq!(
            (name, geb, adresse, kontakt, ort, ziel),
            (None, None, None, None, None, None)
        );
        let verbleib: (Option<String>, Option<String>) =
            sqlx::query_as("SELECT ziel, transportmittel FROM person_verbleib WHERE person_id = ?")
                .bind(registriert)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(verbleib, (None, None));

        // Behandelt: nur Adresse und Kontakt weg.
        let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, behandelt).await;
        assert_eq!((adresse, kontakt), (None, None));
        assert_eq!(name.as_deref(), Some("Mustermann"));
        assert_eq!(geb.as_deref(), Some("1970-01-01"));
        assert_eq!(ort.as_deref(), Some("Marktplatz"));
        assert_eq!(ziel.as_deref(), Some("KH Mitte"));
        assert_eq!(
            behandlungsfelder(&pool, behandelt).await,
            (Some("unterkühlt".into()), Some("Sichtungsnotiz".into()))
        );
        let etb = etb_texte(&pool, einsatz).await;
        let eintrag = etb.last().unwrap();
        assert!(
            eintrag.contains("„Personenauskunft“ unwiderruflich geschwärzt"),
            "{eintrag}"
        );
        assert!(eintrag.contains("RG personenauskunft"));
        assert!(eintrag.contains("ohne Behandlungsbezug"));

        // Beide Zwecke abgelaufen: auch der Stamm der behandelten Person.
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Behandlung,
            "2026-05-01 00:00:00",
            Some(vor_31),
        )
        .await;
        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
                .await
                .unwrap()
        );
        let (name, geb, _, _, ort, ziel) = person_felder(&pool, behandelt).await;
        assert_eq!((name, geb, ort, ziel), (None, None, None, None));
        assert_eq!(behandlungsfelder(&pool, behandelt).await, (None, None));
        assert!(etb_texte(&pool, einsatz)
            .await
            .last()
            .unwrap()
            .contains("der Personen mit Behandlungsbezug"));

        // Eine spätere Kategorie, die den Stamm nicht betrifft, nennt ihn nicht (Review LFH-749):
        // das ETB hielte sonst eine zweite Stamm-Schwärzung unter fremder Rechtsgrundlage fest.
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-05-01 00:00:00",
            Some(vor_31),
        )
        .await;
        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
                .await
                .unwrap()
        );
        let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
        assert!(letzter.contains("„Anhänge“"), "{letzter}");
        assert!(!letzter.contains("Personenstamm"), "{letzter}");

        // Sichtungskategorie und Registriernummer bleiben.
        let (kat, nr): (String, i64) = sqlx::query_as(
            "SELECT s.kategorie, p.registrier_nr FROM person_sichtung s \
             JOIN einsatz_person p ON p.id = s.person_id WHERE p.id = ?",
        )
        .bind(behandelt)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((kat.as_str(), nr), ("sk2", 2));

        let verstoesse: Vec<(String,)> =
            sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(verstoesse.is_empty(), "{verstoesse:?}");
    }

    /// Jede Bezugsart hält den Stamm, wenn nur die Personenauskunft geschwärzt wird —
    /// auch an einer stornierten Person (design.md, Risiko „Prädikat erfasst einen Bezug nicht“).
    #[tokio::test]
    async fn jede_bezugsart_haelt_den_stamm() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen(&pool).await;
        let mit_sichtung = volle_person(&pool, einsatz, 1, leit).await;
        sichtung(&pool, einsatz, mit_sichtung, leit).await;
        let mit_verlauf = volle_person(&pool, einsatz, 2, leit).await;
        sqlx::query(
            "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
             VALUES (?, ?, 'RR 120/80', ?)",
        )
        .bind(einsatz)
        .bind(mit_verlauf)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        let mit_uhs = volle_person(&pool, einsatz, 3, leit).await;
        let uhs: i64 = sqlx::query_scalar(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'PA 1', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(leit)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO person_uhs_belegung (einsatz_id, person_id, uhs_id, art, erfasst_von) \
             VALUES (?, ?, ?, 'eintritt', ?)",
        )
        .bind(einsatz)
        .bind(mit_uhs)
        .bind(uhs)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        let mit_zustand = volle_person(&pool, einsatz, 4, leit).await;
        sqlx::query("UPDATE einsatz_person SET zustand = 'gehfähig' WHERE id = ?")
            .bind(mit_zustand)
            .execute(&pool)
            .await
            .unwrap();
        let storniert = volle_person(&pool, einsatz, 5, leit).await;
        sichtung(&pool, einsatz, storniert, leit).await;
        sqlx::query("UPDATE einsatz_person SET storniert_at = '2026-01-01 00:00:00' WHERE id = ?")
            .bind(storniert)
            .execute(&pool)
            .await
            .unwrap();
        schliessen(&pool, einsatz, leit).await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Personenauskunft,
            "2026-05-01 00:00:00",
            Some("2026-05-30 12:00:00"),
        )
        .await;

        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
                .await
                .unwrap()
        );
        for p in [mit_sichtung, mit_verlauf, mit_uhs, mit_zustand, storniert] {
            let (name, _, adresse, _, _, _) = person_felder(&pool, p).await;
            assert_eq!(
                name.as_deref(),
                Some("Mustermann"),
                "Person {p} behält ihren Stamm"
            );
            assert_eq!(adresse, None, "Person {p}: Adresse weg");
        }
    }

    #[tokio::test]
    async fn anhaenge_schwaerzung_laesst_anderes_stehen_und_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen(&pool).await;
        let person = volle_person(&pool, einsatz, 1, leit).await;
        let anhang = |name: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                        hochgeladen_von) VALUES (?, ?, 'image/jpeg', 3, 'x', X'010203', ?) \
                     RETURNING id",
                )
                .bind(einsatz)
                .bind(name)
                .bind(leit)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        // Dokumentablage samt ETB-Nachweis, Schaden mit Anhang, Meldung.
        let dok_anhang = anhang("lageplan.png").await;
        let etb: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 900, 'system', 'Dokument abgelegt', ?, '2026-01-01 09:00:00') RETURNING id",
        )
        .bind(einsatz)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_dokument (einsatz_id, anhang_id, kategorie, titel, \
                etb_eintrag_id, abgelegt_von_id) VALUES (?, ?, 'lagekarte_plan', 'Plan', ?, ?)",
        )
        .bind(einsatz)
        .bind(dok_anhang)
        .bind(etb)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        let schaden: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, typ, ausmass, ort, \
                erfasst_von, geaendert_von) VALUES (?, 1, 'sachschaden', 'gering', \
                'Hauptstr. 1', ?, ?) RETURNING id",
        )
        .bind(einsatz)
        .bind(leit)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        let schaden_anhang = anhang("dach.jpg").await;
        sqlx::query(
            "INSERT INTO einsatz_schaden_anhang (einsatz_id, schaden_id, anhang_id, \
                abgelegt_von_id) VALUES (?, ?, ?, ?)",
        )
        .bind(einsatz)
        .bind(schaden)
        .bind(schaden_anhang)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, \
                ereigniszeit, eingang_at, erfasst_von_id) VALUES (?, 1, 'Nord 1', 'funk', \
                'Dach abgedeckt', '2026-01-01 09:00:00', '2026-01-01 09:00:00', ?)",
        )
        .bind(einsatz)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        anhang("foto.jpg").await;
        schliessen(&pool, einsatz, leit).await;

        // Karenz läuft noch (29 Tage): nichts.
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-05-01 00:00:00",
            Some("2026-06-01 12:00:00"),
        )
        .await;
        assert!(
            !schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
                .await
                .unwrap()
        );

        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Anhaenge,
            "2026-05-01 00:00:00",
            Some("2026-05-31 12:00:00"),
        )
        .await;
        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
                .await
                .unwrap()
        );
        let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anhaenge, 0);
        for tabelle in ["einsatz_dokument", "einsatz_schaden_anhang"] {
            let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM {tabelle} WHERE einsatz_id = ?"
            )))
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(n, 0, "{tabelle}: Dokumentablage weg");
        }
        // Personen, Schäden, Meldungen und ETB tragen ihre Angaben unverändert.
        let (name, _, adresse, _, _, _) = person_felder(&pool, person).await;
        assert_eq!(name.as_deref(), Some("Mustermann"));
        assert_eq!(adresse.as_deref(), Some("Hauptstr. 5"));
        let ort: String = sqlx::query_scalar("SELECT ort FROM einsatz_schaden WHERE id = ?")
            .bind(schaden)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(ort, "Hauptstr. 1");
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(inhalt, "Dach abgedeckt");
        assert!(etb_texte(&pool, einsatz)
            .await
            .contains(&"Dokument abgelegt".to_string()));
        let verstoesse: Vec<(String,)> =
            sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(verstoesse.is_empty(), "{verstoesse:?}");
        let n = etb_texte(&pool, einsatz).await.len();
        let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
        assert!(letzter.contains("„Anhänge“"), "{letzter}");
        assert!(letzter.contains("RG anhaenge"), "{letzter}");
        assert!(
            !letzter.contains("Personenstamm"),
            "Anhänge ändern den Stamm nicht: {letzter}"
        );

        // Zweiter Lauf: nichts, kein Eintrag.
        assert!(
            !schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
                .await
                .unwrap()
        );
        assert_eq!(etb_texte(&pool, einsatz).await.len(), n);
    }

    /// Spec „Zusammenspiel mit der Einsatz-Frist“: das Wiederherstellen des Einsatzes bringt
    /// eine geschwärzte Kategorie nicht zurück.
    #[tokio::test]
    async fn wiederherstellen_des_einsatzes_laesst_geschwaerzte_kategorie_geschwaerzt() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = abgeschlossen(&pool).await;
        schliessen(&pool, einsatz, leit).await;
        kategorie_stand(
            &pool,
            einsatz,
            Datenkategorie::Personenauskunft,
            "2026-05-01 00:00:00",
            Some("2026-05-30 12:00:00"),
        )
        .await;
        assert!(
            schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
                .await
                .unwrap()
        );
        let vorher = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
            .await
            .unwrap();

        let jetzt = Utc::now();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind(crate::zeit::formatiere_utc(
                jetzt - chrono::Duration::days(1),
            ))
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        super::super::repo::wiederherstellen(&pool, einsatz, leit, 1, None, jetzt)
            .await
            .unwrap();

        let nachher = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
            .await
            .unwrap();
        assert_eq!(nachher, vorher);
        assert_eq!(
            kategorie_zustand(STATUS_ABGESCHLOSSEN, None, Some(&nachher), jetzt),
            Some(AufbewahrungZustand::Geschwaerzt)
        );
        let err = frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(
                Datenkategorie::Personenauskunft,
                Some("2099-01-01 00:00:00"),
                None,
                false,
            ),
            jetzt,
        )
        .await
        .unwrap_err();
        assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
    }

    // ---------- Zustand je Kategorie ----------

    #[test]
    fn kategorie_zustand_je_wert() {
        use AufbewahrungZustand::*;
        let jetzt = t(JETZT);
        let z = |frist: Option<&str>, vorgemerkt: Option<&str>, geschwaerzt: Option<&str>| {
            KategorieZeile {
                kategorie: Datenkategorie::Behandlung,
                frist_bis: frist.map(String::from),
                rechtsgrundlage: "x".into(),
                vorgemerkt_at: vorgemerkt.map(String::from),
                geschwaerzt_at: geschwaerzt.map(String::from),
            }
        };
        let ab = STATUS_ABGESCHLOSSEN;
        assert_eq!(kategorie_zustand("aktiv", None, None, jetzt), None);
        assert_eq!(kategorie_zustand(ab, None, None, jetzt), Some(OhneFrist));
        assert_eq!(
            kategorie_zustand(ab, None, Some(&z(None, None, None)), jetzt),
            Some(OhneFrist)
        );
        assert_eq!(
            kategorie_zustand(
                ab,
                None,
                Some(&z(Some("2026-07-01 00:00:00"), None, None)),
                jetzt
            ),
            Some(FristLaeuft)
        );
        assert_eq!(
            kategorie_zustand(ab, None, Some(&z(Some(JETZT), None, None)), jetzt),
            Some(Faellig)
        );
        assert_eq!(
            kategorie_zustand(
                ab,
                None,
                Some(&z(
                    Some("2026-06-01 00:00:00"),
                    Some("2026-06-27 12:00:00"),
                    None
                )),
                jetzt
            ),
            Some(Vorgemerkt)
        );
        assert_eq!(
            kategorie_zustand(
                ab,
                None,
                Some(&z(
                    Some("2026-05-01 00:00:00"),
                    Some("2026-05-31 12:00:00"),
                    None
                )),
                jetzt
            ),
            Some(SchwaerzungAusstehend)
        );
        assert_eq!(
            kategorie_zustand(
                ab,
                None,
                Some(&z(
                    None,
                    Some("2026-05-01 00:00:00"),
                    Some("2026-06-01 00:00:00")
                )),
                jetzt
            ),
            Some(Geschwaerzt)
        );
        // Einsatz geschwärzt: jede Kategorie geschwärzt, auch ohne Zeile.
        assert_eq!(
            kategorie_zustand(ab, Some("2026-06-01 00:00:00"), None, jetzt),
            Some(Geschwaerzt)
        );
        assert_eq!(
            kategorie_zustand(
                ab,
                Some("2026-06-01 00:00:00"),
                Some(&z(Some("2027-01-01 00:00:00"), None, None)),
                jetzt
            ),
            Some(Geschwaerzt)
        );
    }

    #[tokio::test]
    async fn umfang_kategorie_personenauskunft_leert_genau_adresse_und_kontakt() {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
        let person = volle_person(&pool, einsatz, 1, leit).await;

        let mut tx = pool.begin().await.unwrap();
        scrubbe_aus_registry(
            &mut tx,
            einsatz,
            Umfang::Kategorie(Datenkategorie::Personenauskunft),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, person).await;
        assert_eq!(adresse, None);
        assert_eq!(kontakt, None);
        assert_eq!(name.as_deref(), Some("Mustermann"));
        assert_eq!(geb.as_deref(), Some("1970-01-01"));
        assert_eq!(ort.as_deref(), Some("Marktplatz"));
        assert_eq!(ziel.as_deref(), Some("KH Mitte"));
    }
}

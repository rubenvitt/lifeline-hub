//! Speicher der Instanzkopplung (design.md D2, D3, D6, D9; `migrations/0300_instanz_kopplung.sql`).

use super::basis32::{b64, fingerabdruck, parse_b64};
use super::code::Ableitung;
use super::{InstanzKopplungRichtung, InstanzKopplungZustand};
use crate::error::AppError;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Eine Kopplung, wie sie in der DB steht.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct KopplungZeile {
    pub id: i64,
    pub gegenueber_kennung: String,
    pub gegenueber_schluessel: String,
    pub gegenueber_name: String,
    pub richtung: String,
    pub gegenueber_adresse: Option<String>,
    pub zustand: String,
    pub zuletzt_gesehen_at: Option<String>,
    pub gegenueber_softwarestand: Option<String>,
    pub gegenueber_protokoll: Option<i64>,
    pub letzter_fehler: Option<String>,
    pub hinweis: Option<String>,
    pub uhr_abweichung_s: Option<i64>,
    pub fehlversuche: i64,
    pub naechste_meldung_at: Option<String>,
    pub angebahnt_at: Option<String>,
    pub erstellt_at: String,
    /// Erreichte Seite: age-Empfänger des Gegenübers aus seiner letzten Meldung (LLH-1493, D6).
    pub gegenueber_age_empfaenger: Option<String>,
    /// Erreichte Seite: das Gegenüber hat die Datenträgerverschlüsselung bestätigt.
    pub gegenueber_datentraeger_verschluesselt: bool,
}

impl KopplungZeile {
    pub fn zustand(&self) -> Option<InstanzKopplungZustand> {
        InstanzKopplungZustand::parse(&self.zustand)
    }
    pub fn richtung(&self) -> Option<InstanzKopplungRichtung> {
        InstanzKopplungRichtung::parse(&self.richtung)
    }
}

const KOPPLUNG_SPALTEN: &str = "id, gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
     richtung, gegenueber_adresse, zustand, zuletzt_gesehen_at, gegenueber_softwarestand, \
     gegenueber_protokoll, letzter_fehler, hinweis, uhr_abweichung_s, fehlversuche, \
     naechste_meldung_at, angebahnt_at, erstellt_at, gegenueber_age_empfaenger, \
     gegenueber_datentraeger_verschluesselt";

/// Eine Org-Zuordnung einer Kopplung.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OrgZeile {
    pub id: i64,
    pub kopplung_id: i64,
    pub org_id: i64,
    pub fremde_org_kennung: String,
    pub fremde_org_name: String,
    pub angelegt_at: String,
    pub widerrufen_at: Option<String>,
    pub widerruf_gemeldet_at: Option<String>,
    pub unterschrift_stand: i64,
    /// Meldende Seite: übernommener Stand der Stammdaten (LLH-1493, D2).
    pub stammdaten_stand: i64,
    /// Meldende Seite: was diese Instanz beim letzten Melden empfangen konnte
    /// (`stammdaten::empfangs_kennzeichen`).
    pub stammdaten_arten: Option<String>,
    /// Meldende Seite: Hinweise aus der Übernahme, zeilenweise.
    pub stammdaten_hinweis: Option<String>,
}

const ORG_SPALTEN: &str = "id, kopplung_id, org_id, fremde_org_kennung, fremde_org_name, \
     angelegt_at, widerrufen_at, widerruf_gemeldet_at, unterschrift_stand, stammdaten_stand, \
     stammdaten_arten, stammdaten_hinweis";

// ── Kopplungscodes ───────────────────────────────────────────────────────────────────────────

/// Stellt einen Code aus: speichert nur die Ableitungen (design.md D2).
pub async fn code_ausstellen(
    pool: &SqlitePool,
    org_id: i64,
    ableitung: &Ableitung,
    von: i64,
    laeuft_ab_at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO instanz_kopplungscode (suche, org_id, k_einloeser, k_aussteller, \
         ausgestellt_von, laeuft_ab_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&ableitung.suche)
    .bind(org_id)
    .bind(b64(&ableitung.k_einloeser))
    .bind(b64(&ableitung.k_aussteller))
    .bind(von)
    .bind(laeuft_ab_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Ein offener Code, wie das Einlösen ihn braucht.
#[derive(Debug, Clone)]
pub struct OffenerCode {
    pub org_id: i64,
    pub k_einloeser: [u8; 32],
    pub k_aussteller: [u8; 32],
    pub ausgestellt_von: Option<i64>,
}

/// Liest einen noch nicht eingelösten, nicht abgelaufenen Code.
pub async fn find_offener_code(
    conn: &mut SqliteConnection,
    suche: &str,
    jetzt: &str,
) -> Result<Option<OffenerCode>, AppError> {
    let zeile: Option<(i64, String, String, Option<i64>)> = sqlx::query_as(
        "SELECT org_id, k_einloeser, k_aussteller, ausgestellt_von FROM instanz_kopplungscode \
         WHERE suche = ? AND eingeloest_at IS NULL AND laeuft_ab_at > ?",
    )
    .bind(suche)
    .bind(jetzt)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((org_id, ke, ka, von)) = zeile else {
        return Ok(None);
    };
    let lesen = |t: &str| -> Result<[u8; 32], AppError> {
        parse_b64(t)
            .and_then(|b| b.try_into().ok())
            .ok_or_else(|| AppError::Internal("Kopplungscode beschädigt".into()))
    };
    Ok(Some(OffenerCode {
        org_id,
        k_einloeser: lesen(&ke)?,
        k_aussteller: lesen(&ka)?,
        ausgestellt_von: von,
    }))
}

/// Verbraucht einen Code genau einmal; `false`, wenn ein anderer schneller war.
pub async fn consume_code(
    conn: &mut SqliteConnection,
    suche: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE instanz_kopplungscode SET eingeloest_at = ? \
         WHERE suche = ? AND eingeloest_at IS NULL AND laeuft_ab_at > ?",
    )
    .bind(jetzt)
    .bind(suche)
    .bind(jetzt)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    Ok(n == 1)
}

// ── Kopplungen ───────────────────────────────────────────────────────────────────────────────

pub async fn find_kopplung(
    conn: &mut SqliteConnection,
    kennung: &str,
) -> Result<Option<KopplungZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {KOPPLUNG_SPALTEN} FROM instanz_kopplung WHERE gegenueber_kennung = ?"
    )))
    .bind(kennung)
    .fetch_optional(&mut *conn)
    .await?)
}

pub async fn load_kopplung(pool: &SqlitePool, id: i64) -> Result<KopplungZeile, AppError> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {KOPPLUNG_SPALTEN} FROM instanz_kopplung WHERE id = ?"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Was beim Koppeln über das Gegenüber feststeht.
#[derive(Debug, Clone)]
pub struct Gegenueber<'a> {
    pub kennung: &'a str,
    pub schluessel_b64: &'a str,
    pub name: &'a str,
    pub softwarestand: &'a str,
    pub protokoll: u32,
}

/// Legt die Kopplung an oder erneuert eine bestehende (neuer Code derselben Gegenstelle). Eine
/// bestehende Kopplung in der anderen Richtung ist ein Konflikt: Orgs, die schon gekoppelt sind,
/// verlören sonst ihre Richtung. `zustand_neu` gilt nur, wenn die Kopplung neu ist oder nicht
/// mehr aktiv war.
pub async fn create_or_renew_kopplung(
    conn: &mut SqliteConnection,
    g: &Gegenueber<'_>,
    richtung: InstanzKopplungRichtung,
    adresse: Option<&str>,
    zustand_neu: InstanzKopplungZustand,
    jetzt: &str,
) -> Result<i64, AppError> {
    let angebahnt = (zustand_neu == InstanzKopplungZustand::Angebahnt).then_some(jetzt);
    if let Some(alt) = find_kopplung(conn, g.kennung).await? {
        if alt.richtung() != Some(richtung) {
            return Err(AppError::Conflict(
                "Mit dieser Instanz besteht schon eine Kopplung in der anderen Richtung.".into(),
            ));
        }
        // Ein anderer Schlüssel unter bekannter Kennung: solange eine Org-Zuordnung gilt, nie.
        // Die Kennung ist nicht geheim, sonst übernähme ein Code einer anderen Org die Kopplung.
        if alt.gegenueber_schluessel != g.schluessel_b64
            && !list_orgs_aktiv(conn, alt.id).await?.is_empty()
        {
            return Err(AppError::Conflict(
                "Unter dieser Kennung ist schon eine Instanz mit einem anderen Schlüssel gekoppelt."
                    .into(),
            ));
        }
        let aktiv = alt.zustand() == Some(InstanzKopplungZustand::Aktiv);
        sqlx::query(
            "UPDATE instanz_kopplung SET gegenueber_schluessel = ?, gegenueber_name = ?, \
             gegenueber_adresse = ?, gegenueber_softwarestand = ?, gegenueber_protokoll = ?, \
             zustand = CASE WHEN ? THEN zustand ELSE ? END, \
             angebahnt_at = CASE WHEN ? THEN angebahnt_at ELSE ? END, \
             letzter_fehler = NULL, hinweis = NULL, fehlversuche = 0, naechste_meldung_at = NULL \
             WHERE id = ?",
        )
        .bind(g.schluessel_b64)
        .bind(g.name)
        .bind(adresse)
        .bind(g.softwarestand)
        .bind(i64::from(g.protokoll))
        .bind(aktiv)
        .bind(zustand_neu.as_str())
        .bind(aktiv)
        .bind(angebahnt)
        .bind(alt.id)
        .execute(&mut *conn)
        .await?;
        return Ok(alt.id);
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand, gegenueber_softwarestand, gegenueber_protokoll, \
         angebahnt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(g.kennung)
    .bind(g.schluessel_b64)
    .bind(g.name)
    .bind(richtung.as_str())
    .bind(adresse)
    .bind(zustand_neu.as_str())
    .bind(g.softwarestand)
    .bind(i64::from(g.protokoll))
    .bind(angebahnt)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Bindet eine Org dieser Instanz an eine Org des Gegenübers. Ist eine der beiden in dieser
/// Kopplung schon aktiv gebunden, ist das ein Konflikt.
pub async fn create_org_zuordnung(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    org_id: i64,
    fremde_org_kennung: &str,
    fremde_org_name: &str,
    von: Option<i64>,
    bestaetigt: bool,
) -> Result<i64, AppError> {
    let schon: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM instanz_kopplung_org WHERE kopplung_id = ? AND widerrufen_at IS NULL \
         AND (org_id = ? OR fremde_org_kennung = ?)",
    )
    .bind(kopplung_id)
    .bind(org_id)
    .bind(fremde_org_kennung)
    .fetch_optional(&mut *conn)
    .await?;
    if schon.is_some() {
        return Err(AppError::Conflict(
            "Diese Organisation ist mit dieser Instanz schon gekoppelt.".into(),
        ));
    }
    // Ein älterer, nie gemeldeter Widerruf derselben Zuordnung ist mit der neuen erledigt; er
    // ginge sonst mit der nächsten Meldung hinaus und träfe die neue.
    sqlx::query(
        "UPDATE instanz_kopplung_org SET widerruf_gemeldet_at = datetime('now') \
         WHERE kopplung_id = ? AND widerrufen_at IS NOT NULL AND widerruf_gemeldet_at IS NULL \
         AND (org_id = ? OR fremde_org_kennung = ?)",
    )
    .bind(kopplung_id)
    .bind(org_id)
    .bind(fremde_org_kennung)
    .execute(&mut *conn)
    .await?;
    Ok(sqlx::query_scalar(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
         fremde_org_name, angelegt_von, bestaetigt_at) \
         VALUES (?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END) RETURNING id",
    )
    .bind(kopplung_id)
    .bind(org_id)
    .bind(fremde_org_kennung)
    .bind(fremde_org_name)
    .bind(von)
    .bind(bestaetigt)
    .fetch_one(&mut *conn)
    .await?)
}

/// Erreichte Seite: das Gegenüber hat die Zuordnung gemeldet.
pub async fn confirm_org(conn: &mut SqliteConnection, org_zeile_id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung_org SET bestaetigt_at = datetime('now') \
         WHERE id = ? AND bestaetigt_at IS NULL",
    )
    .bind(org_zeile_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Alle Org-Zuordnungen einer Kopplung, die noch gelten.
pub async fn list_orgs_aktiv(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<OrgZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {ORG_SPALTEN} FROM instanz_kopplung_org \
         WHERE kopplung_id = ? AND widerrufen_at IS NULL ORDER BY id"
    )))
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Org-Zuordnungen, die hier widerrufen wurden und deren Widerruf das Gegenüber noch nicht
/// signiert erhalten hat.
pub async fn list_orgs_widerruf_offen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<OrgZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {ORG_SPALTEN} FROM instanz_kopplung_org WHERE kopplung_id = ? \
         AND widerrufen_at IS NOT NULL AND widerruf_gemeldet_at IS NULL ORDER BY id"
    )))
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Setzt den Zustand einer Kopplung danach, ob noch eine Org-Zuordnung gilt: ohne gültige wird
/// eine angebahnte oder aktive Kopplung `ohne` (`widerrufen` oder `vom_gegenueber_widerrufen`).
/// Ein schon gesetzter Widerruf bleibt, wie er ist: wer zuerst widerrufen hat, steht fest.
pub async fn update_zustand_nach_orgs(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    ohne: InstanzKopplungZustand,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET zustand = ? WHERE id = ? \
         AND zustand IN ('angebahnt', 'aktiv') AND NOT EXISTS \
         (SELECT 1 FROM instanz_kopplung_org WHERE kopplung_id = ? AND widerrufen_at IS NULL)",
    )
    .bind(ohne.as_str())
    .bind(kopplung_id)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Widerruft eine Org-Zuordnung (`von = None`: durch das Gegenüber). `false`, wenn sie schon
/// widerrufen war.
pub async fn org_widerrufen(
    conn: &mut SqliteConnection,
    org_zeile_id: i64,
    von: Option<i64>,
    jetzt: &str,
    gemeldet: bool,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE instanz_kopplung_org SET widerrufen_at = ?, widerrufen_von = ?, \
         widerruf_gemeldet_at = CASE WHEN ? THEN ? ELSE NULL END \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(jetzt)
    .bind(von)
    .bind(gemeldet)
    .bind(jetzt)
    .bind(org_zeile_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if n == 1 {
        crate::auth::unterschrift::repo::fremde_der_zuordnung_widerrufen(conn, org_zeile_id, jetzt)
            .await?;
        // Übernommene Stammdaten gehören danach der Instanz (LLH-1493, design.md D3).
        crate::instanz::stammdaten::herkunft::delete_fuer_zuordnung(conn, org_zeile_id).await?;
    }
    Ok(n == 1)
}

pub async fn mark_widerruf_gemeldet(
    conn: &mut SqliteConnection,
    org_zeile_ids: &[i64],
    jetzt: &str,
) -> Result<(), AppError> {
    for id in org_zeile_ids {
        sqlx::query("UPDATE instanz_kopplung_org SET widerruf_gemeldet_at = ? WHERE id = ?")
            .bind(jetzt)
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Hält fest, was eine Meldung des Gegenübers (erreichte Seite) oder eine Antwort darauf
/// (meldende Seite) über es verrät, und macht eine angebahnte Kopplung aktiv.
pub async fn mark_gesehen(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    softwarestand: &str,
    protokoll: u32,
    uhr_abweichung_s: Option<i64>,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET zuletzt_gesehen_at = ?, gegenueber_softwarestand = ?, \
         gegenueber_protokoll = ?, uhr_abweichung_s = COALESCE(?, uhr_abweichung_s), \
         zustand = CASE WHEN zustand = 'angebahnt' THEN 'aktiv' ELSE zustand END, \
         angebahnt_at = NULL WHERE id = ?",
    )
    .bind(jetzt)
    .bind(softwarestand)
    .bind(i64::from(protokoll))
    .bind(uhr_abweichung_s)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Meldende Seite: Ergebnis eines Meldeversuchs. Bei Erfolg (`fehler = None`) beginnt der Abstand
/// wieder von vorn, sonst verdoppelt er sich bis zur Obergrenze (design.md D4).
pub async fn save_meldeversuch(
    pool: &SqlitePool,
    kopplung_id: i64,
    fehler: Option<&str>,
    naechste_meldung_at: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET letzter_fehler = ?, \
         fehlversuche = CASE WHEN ? IS NULL THEN 0 ELSE fehlversuche + 1 END, \
         naechste_meldung_at = ? WHERE id = ?",
    )
    .bind(fehler)
    .bind(fehler)
    .bind(naechste_meldung_at)
    .bind(kopplung_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Meldende Seite: die Kopplungen, die sich jetzt melden sollen. Das sind die aktiven und die,
/// deren eigener Widerruf noch nicht zugestellt ist (design.md D9): Ihre Meldung trägt nur noch
/// den Widerruf und wird nachgestellt, bis die Gegenseite sie signiert quittiert.
pub async fn list_faellige_meldungen(
    pool: &SqlitePool,
    jetzt: &str,
) -> Result<Vec<KopplungZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {KOPPLUNG_SPALTEN} FROM instanz_kopplung k \
         WHERE richtung = 'meldet_sich' \
         AND (zustand = 'aktiv' OR (zustand <> 'angebahnt' AND EXISTS ( \
             SELECT 1 FROM instanz_kopplung_org o WHERE o.kopplung_id = k.id \
             AND o.widerrufen_at IS NOT NULL AND o.widerruf_gemeldet_at IS NULL))) \
         AND (naechste_meldung_at IS NULL OR naechste_meldung_at <= ?) ORDER BY id"
    )))
    .bind(jetzt)
    .fetch_all(pool)
    .await?)
}

// ── Stammdaten (LLH-1493) ────────────────────────────────────────────────────────────────────

/// Meldende Seite: was diese Instanz empfangen kann, hat sich geändert (Update,
/// Plattenbestätigung) — die Nachlieferung beginnt bei 0 (design.md D2).
pub async fn save_stammdaten_kennzeichen(
    conn: &mut SqliteConnection,
    org_zeile_id: i64,
    kennzeichen: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung_org SET stammdaten_arten = ?, stammdaten_stand = 0 \
         WHERE id = ? AND stammdaten_arten IS NOT ?",
    )
    .bind(kennzeichen)
    .bind(org_zeile_id)
    .bind(kennzeichen)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Meldende Seite: übernommener Stand, nur vorwärts.
pub async fn save_stammdaten_stand(
    conn: &mut SqliteConnection,
    org_zeile_id: i64,
    bis: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung_org SET stammdaten_stand = MAX(stammdaten_stand, ?) WHERE id = ?",
    )
    .bind(bis)
    .bind(org_zeile_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Höchstzahl gemerkter Hinweise je Org-Zuordnung (die jüngsten bleiben).
pub const STAMMDATEN_HINWEISE_MAX: usize = 20;

/// Meldende Seite: hängt Hinweise an (ohne Doppel). Sie bleiben, bis „Erneut abgleichen“ sie
/// leert, weil die betroffene Zeile erst dann wieder kommt.
pub async fn add_stammdaten_hinweise(
    conn: &mut SqliteConnection,
    org_zeile_id: i64,
    hinweise: &[String],
) -> Result<(), AppError> {
    if hinweise.is_empty() {
        return Ok(());
    }
    let alt: Option<String> =
        sqlx::query_scalar("SELECT stammdaten_hinweis FROM instanz_kopplung_org WHERE id = ?")
            .bind(org_zeile_id)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    let mut zeilen: Vec<String> = alt
        .as_deref()
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect();
    for h in hinweise {
        if !zeilen.contains(h) {
            zeilen.push(h.clone());
        }
    }
    let ueberzaehlig = zeilen.len().saturating_sub(STAMMDATEN_HINWEISE_MAX);
    zeilen.drain(..ueberzaehlig);
    sqlx::query("UPDATE instanz_kopplung_org SET stammdaten_hinweis = ? WHERE id = ?")
        .bind(zeilen.join("\n"))
        .bind(org_zeile_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Meldende Seite, „Erneut abgleichen“: Stand auf 0, Hinweise leer.
pub async fn reset_stammdaten(pool: &SqlitePool, org_zeile_id: i64) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung_org SET stammdaten_stand = 0, stammdaten_hinweis = NULL \
         WHERE id = ?",
    )
    .bind(org_zeile_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Erreichte Seite: age-Empfänger und Plattenbestätigung aus der letzten Meldung (D6).
pub async fn save_gegenueber_empfang(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    age: Option<&str>,
    datentraeger_verschluesselt: bool,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET gegenueber_age_empfaenger = ?, \
         gegenueber_datentraeger_verschluesselt = ? WHERE id = ?",
    )
    .bind(age)
    .bind(datentraeger_verschluesselt)
    .bind(kopplung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ausstellende Seite: Kopplungen, die länger als `minuten` auf ihre erste Meldung warten, werden
/// verworfen (design.md D2). Ihre Org-Zuordnungen gelten danach als widerrufen.
pub async fn discard_angebahnte(pool: &SqlitePool, grenze: &str) -> Result<u64, AppError> {
    let mut tx = pool.begin().await?;
    let ids: Vec<i64> = sqlx::query_scalar(
        "SELECT id FROM instanz_kopplung WHERE zustand = 'angebahnt' AND angebahnt_at <= ?",
    )
    .bind(grenze)
    .fetch_all(&mut *tx)
    .await?;
    for id in &ids {
        sqlx::query(
            "UPDATE instanz_kopplung_org SET widerrufen_at = ?, widerruf_gemeldet_at = ? \
             WHERE kopplung_id = ? AND widerrufen_at IS NULL",
        )
        .bind(grenze)
        .bind(grenze)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE instanz_kopplung SET zustand = 'widerrufen', angebahnt_at = NULL WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    // Org-Zuordnungen, die das Gegenüber nie gemeldet hat (etwa eine zweite Org, deren Antwort
    // beim Einlösen verworfen wurde), verfallen ebenso.
    let verwaist: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT id, kopplung_id FROM instanz_kopplung_org \
         WHERE widerrufen_at IS NULL AND bestaetigt_at IS NULL AND angelegt_at <= ?",
    )
    .bind(grenze)
    .fetch_all(&mut *tx)
    .await?;
    for (org_id, kopplung_id) in &verwaist {
        org_widerrufen(&mut *tx, *org_id, None, grenze, true).await?;
        update_zustand_nach_orgs(&mut *tx, *kopplung_id, InstanzKopplungZustand::Widerrufen)
            .await?;
    }
    tx.commit().await?;
    Ok((ids.len() + verwaist.len()) as u64)
}

/// Setzt einen bleibenden Hinweis an der Kopplung.
pub async fn set_hinweis(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    hinweis: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE instanz_kopplung SET hinweis = ? WHERE id = ?")
        .bind(hinweis)
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Alle Org-Zuordnungen einer Kopplung, auch widerrufene, jüngste zuletzt.
pub async fn list_orgs(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<OrgZeile>, AppError> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {ORG_SPALTEN} FROM instanz_kopplung_org WHERE kopplung_id = ? ORDER BY id"
    )))
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?)
}

// ── Wiederholschutz ──────────────────────────────────────────────────────────────────────────

/// Merkt sich eine `jti`; `false`, wenn sie von diesem Absender schon kam.
pub async fn remember_jti(
    pool: &SqlitePool,
    absender: &str,
    jti: &str,
    bis: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query("INSERT OR IGNORE INTO instanz_jti (absender, jti, bis) VALUES (?, ?, ?)")
        .bind(absender)
        .bind(jti)
        .bind(bis)
        .execute(pool)
        .await?
        .rows_affected();
    Ok(n == 1)
}

/// Räumt abgelaufene `jti` und Codes (Purge-Lauf).
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM instanz_jti WHERE bis < ?")
        .bind(jetzt)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM instanz_kopplungscode WHERE laeuft_ab_at < ?")
        .bind(jetzt)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Anzeige ──────────────────────────────────────────────────────────────────────────────────

crate::wire_enum::wire_enum! {
    /// Wie weit die Protokollversionen auseinanderliegen, für die Anzeige (design.md D5).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum InstanzProtokoll {
        /// Noch keine Meldung oder Abstand höchstens eins.
        Passt => "passt",
        /// Diese Instanz ist zu alt.
        UpdateHier => "update_hier",
        /// Das Gegenüber ist zu alt.
        UpdateGegenueber => "update_gegenueber",
    }
}

/// Eine Kopplung, wie die Admin-Seite sie zeigt: aus Sicht einer Org.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct InstanzKopplungAnzeige {
    pub id: i64,
    pub gegenueber_name: String,
    pub gegenueber_kennung: String,
    pub gegenueber_fingerabdruck: String,
    pub richtung: InstanzKopplungRichtung,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gegenueber_adresse: Option<String>,
    pub zustand: InstanzKopplungZustand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_gesehen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gegenueber_softwarestand: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gegenueber_protokoll: Option<i64>,
    pub protokoll: InstanzProtokoll,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_fehler: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hinweis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uhr_abweichung_s: Option<i64>,
    /// Die Org-Zuordnung der eigenen Org (die jüngste).
    pub org: InstanzOrgZuordnung,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct InstanzOrgZuordnung {
    pub id: i64,
    pub fremde_org_name: String,
    pub fremde_org_kennung: String,
    pub angelegt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widerrufen_at: Option<String>,
    /// Stammdaten (LLH-1493). Meldende Seite: übernommener Stand und Hinweise aus der
    /// Übernahme. Erreichte Seite: ob Kontogeheimnisse hinausgehen und an wie viele Konten sie
    /// gingen.
    pub stammdaten: InstanzStammdatenStand,
}

/// Stand der Stammdaten-Verteilung an einer Org-Zuordnung (design.md D9).
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct InstanzStammdatenStand {
    pub stand: i64,
    pub hinweise: Vec<String>,
    /// Nur erreichte Seite: Geheimnisse gehen hinaus (Empfänger bekannt, Platte bestätigt).
    pub geheimnisse_verteilt: bool,
    /// Nur erreichte Seite: Konten, deren Geheimnisse an diese Zuordnung gingen.
    pub konten_mit_geheimnis: i64,
}

/// Die Kopplungen, an denen `org_id` beteiligt ist oder war, jüngste Zuordnung je Kopplung.
pub async fn list_fuer_org(
    pool: &SqlitePool,
    org_id: i64,
) -> Result<Vec<InstanzKopplungAnzeige>, AppError> {
    let orgs: Vec<OrgZeile> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {ORG_SPALTEN} FROM instanz_kopplung_org o WHERE org_id = ? AND id = \
         (SELECT MAX(id) FROM instanz_kopplung_org WHERE kopplung_id = o.kopplung_id AND org_id = o.org_id) \
         ORDER BY kopplung_id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    let mut aus = Vec::with_capacity(orgs.len());
    for o in orgs {
        let k = load_kopplung(pool, o.kopplung_id).await?;
        let konten: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM instanz_geheimnis_lieferung WHERE kopplung_org_id = ?",
        )
        .bind(o.id)
        .fetch_one(pool)
        .await?;
        aus.push(to_anzeige(k, o, konten));
    }
    Ok(aus)
}

/// Eine Kopplung aus Sicht von `org_id`; 404, wenn die Org nie beteiligt war.
pub async fn load_anzeige_fuer_org(
    pool: &SqlitePool,
    kopplung_id: i64,
    org_id: i64,
) -> Result<InstanzKopplungAnzeige, AppError> {
    list_fuer_org(pool, org_id)
        .await?
        .into_iter()
        .find(|k| k.id == kopplung_id)
        .ok_or(AppError::NotFound)
}

fn to_anzeige(k: KopplungZeile, o: OrgZeile, konten_mit_geheimnis: i64) -> InstanzKopplungAnzeige {
    let geheimnisse_verteilt = k.richtung() == Some(InstanzKopplungRichtung::WirdGemeldet)
        && k.gegenueber_age_empfaenger.is_some()
        && k.gegenueber_datentraeger_verschluesselt;
    let protokoll = match k.gegenueber_protokoll.and_then(|p| u32::try_from(p).ok()) {
        Some(fremd) => match super::protokollfenster(super::PROTOKOLL, fremd) {
            super::Protokollfenster::Voll => InstanzProtokoll::Passt,
            super::Protokollfenster::NurMelden {
                veraltet: super::Seite::Eigen,
            } => InstanzProtokoll::UpdateHier,
            super::Protokollfenster::NurMelden {
                veraltet: super::Seite::Gegenueber,
            } => InstanzProtokoll::UpdateGegenueber,
        },
        None => InstanzProtokoll::Passt,
    };
    let fingerabdruck = parse_b64(&k.gegenueber_schluessel)
        .map(|b| fingerabdruck(&b))
        .unwrap_or_default();
    InstanzKopplungAnzeige {
        id: k.id,
        richtung: k
            .richtung()
            .unwrap_or(InstanzKopplungRichtung::WirdGemeldet),
        zustand: k.zustand().unwrap_or(InstanzKopplungZustand::Widerrufen),
        gegenueber_fingerabdruck: fingerabdruck,
        gegenueber_name: k.gegenueber_name,
        gegenueber_kennung: k.gegenueber_kennung,
        gegenueber_adresse: k.gegenueber_adresse,
        zuletzt_gesehen_at: k.zuletzt_gesehen_at,
        gegenueber_softwarestand: k.gegenueber_softwarestand,
        gegenueber_protokoll: k.gegenueber_protokoll,
        protokoll,
        letzter_fehler: k.letzter_fehler,
        hinweis: k.hinweis,
        uhr_abweichung_s: k.uhr_abweichung_s,
        org: InstanzOrgZuordnung {
            id: o.id,
            fremde_org_name: o.fremde_org_name,
            fremde_org_kennung: o.fremde_org_kennung,
            angelegt_at: o.angelegt_at,
            widerrufen_at: o.widerrufen_at,
            stammdaten: InstanzStammdatenStand {
                stand: o.stammdaten_stand,
                hinweise: o
                    .stammdaten_hinweis
                    .as_deref()
                    .unwrap_or_default()
                    .lines()
                    .map(str::to_string)
                    .collect(),
                geheimnisse_verteilt,
                konten_mit_geheimnis,
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn wiederholung_wird_erkannt_und_abgelaufenes_geraeumt() {
        let pool = crate::db::test_pool().await;
        assert!(remember_jti(&pool, "elw", "j1", "2026-11-08 12:01:00")
            .await
            .unwrap());
        assert!(!remember_jti(&pool, "elw", "j1", "2026-11-08 12:01:00")
            .await
            .unwrap());
        assert!(remember_jti(&pool, "elw2", "j1", "2026-11-08 12:01:00")
            .await
            .unwrap());
        purge(&pool, "2026-11-08 12:00:00").await.unwrap();
        assert!(
            !remember_jti(&pool, "elw", "j1", "2026-11-08 12:01:00")
                .await
                .unwrap(),
            "noch nicht abgelaufen"
        );
        purge(&pool, "2026-11-08 12:02:00").await.unwrap();
        assert!(
            remember_jti(&pool, "elw", "j1", "2026-11-08 12:03:00")
                .await
                .unwrap(),
            "geräumt"
        );
    }
}

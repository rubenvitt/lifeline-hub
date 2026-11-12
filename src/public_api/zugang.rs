//! Repo des Maschinenzugangs (Spec `maschinenzugang`, design.md D2, D6, D7): Zugänge je Org,
//! Einmal-Codes, Schlüsselbindung und -wechsel, Wiederholschutz, Abrufprotokoll und der letzte
//! Ablehnungsgrund. Zeitpunkte als Text in `zeit::FORMAT` (UTC, ADR-0012).

use super::scope::{AblehnungGrund, Scope, ZugangZustand};
use crate::error::AppError;
use crate::instanz::basis32::{b64, parse_b64};
use crate::instanz::code::Ableitung;
use sqlx::{SqliteConnection, SqlitePool};

/// Ein Maschinenzugang, wie Extractor und Verwaltung ihn lesen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Zugang {
    pub id: String,
    pub org_id: i64,
    pub name: String,
    pub scopes: Vec<Scope>,
    pub gueltig_bis: Option<String>,
    pub zustand: ZugangZustand,
    pub schluessel: Option<String>,
    pub schluessel_neu: Option<String>,
    pub angelegt_at: String,
    pub widerrufen_at: Option<String>,
    pub zuletzt_genutzt_at: Option<String>,
    pub letzte_ablehnung_at: Option<String>,
    pub letzte_ablehnung_grund: Option<AblehnungGrund>,
    pub letzte_ablehnung_abweichung_s: Option<i64>,
}

impl Zugang {
    /// Ist „gültig bis“ verstrichen? `jetzt` in `zeit::FORMAT`.
    pub fn is_abgelaufen(&self, jetzt: &str) -> bool {
        self.gueltig_bis.as_deref().is_some_and(|bis| bis <= jetzt)
    }

    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }
}

type Zeile = (
    String,
    i64,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<i64>,
);

/// Spalten in der Reihenfolge von [`Zeile`]; ein Makro, weil sqlx nur statische Texte nimmt.
macro_rules! spalten {
    () => {
        "id, org_id, name, scopes, gueltig_bis, zustand, schluessel, schluessel_neu, \
         angelegt_at, widerrufen_at, zuletzt_genutzt_at, letzte_ablehnung_at, \
         letzte_ablehnung_grund, letzte_ablehnung_abweichung_s"
    };
}

fn aus_zeile(z: Zeile) -> Result<Zugang, AppError> {
    let kaputt = |was: &str| AppError::Internal(format!("Maschinenzugang {}: {was}", z.0));
    let scopes: Vec<String> = serde_json::from_str(&z.3).map_err(|_| kaputt("Scopes unlesbar"))?;
    let scopes = super::scope::parse_scopes(scopes.iter().map(String::as_str))
        .map_err(|_| kaputt("unbekannter Scope"))?;
    Ok(Zugang {
        scopes,
        zustand: ZugangZustand::parse(&z.5).ok_or_else(|| kaputt("Zustand unbekannt"))?,
        letzte_ablehnung_grund: z.12.as_deref().and_then(AblehnungGrund::parse),
        id: z.0,
        org_id: z.1,
        name: z.2,
        gueltig_bis: z.4,
        schluessel: z.6,
        schluessel_neu: z.7,
        angelegt_at: z.8,
        widerrufen_at: z.9,
        zuletzt_genutzt_at: z.10,
        letzte_ablehnung_at: z.11,
        letzte_ablehnung_abweichung_s: z.13,
    })
}

fn scopes_json(scopes: &[Scope]) -> String {
    serde_json::to_string(&scopes.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .expect("Liste von Texten ist serialisierbar")
}

/// Legt einen Zugang im Zustand `wartet` an und liefert seine Kennung (UUID).
pub async fn anlegen(
    conn: &mut SqliteConnection,
    org_id: i64,
    name: &str,
    scopes: &[Scope],
    gueltig_bis: Option<&str>,
    von: Option<i64>,
    jetzt: &str,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO maschinenzugang (id, org_id, name, scopes, gueltig_bis, angelegt_at, \
         angelegt_von) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(org_id)
    .bind(name)
    .bind(scopes_json(scopes))
    .bind(gueltig_bis)
    .bind(jetzt)
    .bind(von)
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

/// Lädt einen Zugang über seine Kennung, ohne Org-Prüfung (Extractor: die Org folgt aus dem
/// Zugang).
pub async fn laden(conn: &mut SqliteConnection, id: &str) -> Result<Option<Zugang>, AppError> {
    let z: Option<Zeile> = sqlx::query_as(concat!(
        "SELECT ",
        spalten!(),
        " FROM maschinenzugang WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?;
    z.map(aus_zeile).transpose()
}

/// Lädt einen Zugang der Org; ein fremder ist `None` (404).
pub async fn laden_in_org(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Option<Zugang>, AppError> {
    Ok(laden(conn, id).await?.filter(|z| z.org_id == org_id))
}

/// Alle Zugänge der Org, neueste zuerst, widerrufene eingeschlossen.
pub async fn liste(conn: &mut SqliteConnection, org_id: i64) -> Result<Vec<Zugang>, AppError> {
    let zeilen: Vec<Zeile> = sqlx::query_as(concat!(
        "SELECT ",
        spalten!(),
        " FROM maschinenzugang WHERE org_id = ? ORDER BY angelegt_at DESC, rowid DESC"
    ))
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    zeilen.into_iter().map(aus_zeile).collect()
}

/// Ändert Name, Scopes und „gültig bis“ eines nicht widerrufenen Zugangs der Org. `Ok(None)`:
/// unbekannt oder fremd (404); `Err(Conflict)`: widerrufen (409).
pub async fn aendern(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    name: &str,
    scopes: &[Scope],
    gueltig_bis: Option<&str>,
) -> Result<Option<(Zugang, Zugang)>, AppError> {
    let Some(vorher) = laden_in_org(conn, org_id, id).await? else {
        return Ok(None);
    };
    if vorher.zustand == ZugangZustand::Widerrufen {
        return Err(AppError::Conflict(
            "Ein widerrufener Zugang lässt sich nicht mehr ändern.".into(),
        ));
    }
    sqlx::query(
        "UPDATE maschinenzugang SET name = ?, scopes = ?, gueltig_bis = ? \
         WHERE id = ? AND zustand <> 'widerrufen'",
    )
    .bind(name)
    .bind(scopes_json(scopes))
    .bind(gueltig_bis)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let nachher = laden(conn, id)
        .await?
        .ok_or_else(|| AppError::Internal("Maschinenzugang verschwunden".into()))?;
    Ok(Some((vorher, nachher)))
}

/// Widerruft einen Zugang der Org und verwirft seine offenen Codes. `Ok(None)`: unbekannt oder
/// fremd; `Ok(Some(false))`: war schon widerrufen (keine Wirkung, kein Audit).
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
    von: Option<i64>,
    jetzt: &str,
) -> Result<Option<bool>, AppError> {
    if laden_in_org(conn, org_id, id).await?.is_none() {
        return Ok(None);
    }
    let n = sqlx::query(
        "UPDATE maschinenzugang SET zustand = 'widerrufen', widerrufen_at = ?, \
         widerrufen_von = ? WHERE id = ? AND zustand <> 'widerrufen'",
    )
    .bind(jetzt)
    .bind(von)
    .bind(id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    sqlx::query("DELETE FROM maschinenzugang_code WHERE zugang_id = ? AND eingeloest_at IS NULL")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    Ok(Some(n == 1))
}

/// Speichert einen neuen Code für den Zugang (nur Ableitungen) und verwirft dessen offene Codes:
/// Es gilt immer nur der jüngste.
pub async fn code_ausstellen(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    ableitung: &Ableitung,
    von: Option<i64>,
    laeuft_ab_at: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM maschinenzugang_code WHERE zugang_id = ? AND eingeloest_at IS NULL")
        .bind(zugang_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO maschinenzugang_code (suche, zugang_id, k_einloeser, k_aussteller, \
         laeuft_ab_at, ausgestellt_von) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&ableitung.suche)
    .bind(zugang_id)
    .bind(b64(&ableitung.k_einloeser))
    .bind(b64(&ableitung.k_aussteller))
    .bind(laeuft_ab_at)
    .bind(von)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ein offener Code, wie das Einlösen ihn braucht.
#[derive(Debug, Clone)]
pub struct OffenerCode {
    pub zugang_id: String,
    pub k_einloeser: [u8; 32],
    pub k_aussteller: [u8; 32],
}

/// Liest einen nicht eingelösten, nicht abgelaufenen Code eines nicht widerrufenen Zugangs.
pub async fn find_offener_code(
    conn: &mut SqliteConnection,
    suche: &str,
    jetzt: &str,
) -> Result<Option<OffenerCode>, AppError> {
    let zeile: Option<(String, String, String)> = sqlx::query_as(
        "SELECT c.zugang_id, c.k_einloeser, c.k_aussteller FROM maschinenzugang_code c \
         JOIN maschinenzugang z ON z.id = c.zugang_id \
         WHERE c.suche = ? AND c.eingeloest_at IS NULL AND c.laeuft_ab_at > ? \
           AND z.zustand <> 'widerrufen'",
    )
    .bind(suche)
    .bind(jetzt)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((zugang_id, ke, ka)) = zeile else {
        return Ok(None);
    };
    let lesen = |t: &str| -> Result<[u8; 32], AppError> {
        parse_b64(t)
            .and_then(|b| b.try_into().ok())
            .ok_or_else(|| AppError::Internal("Code eines Maschinenzugangs beschädigt".into()))
    };
    Ok(Some(OffenerCode {
        zugang_id,
        k_einloeser: lesen(&ke)?,
        k_aussteller: lesen(&ka)?,
    }))
}

/// Verbraucht einen Code genau einmal; `false`, wenn ein anderer schneller war.
pub async fn consume_code(
    conn: &mut SqliteConnection,
    suche: &str,
    jetzt: &str,
) -> Result<bool, AppError> {
    let n = sqlx::query(
        "UPDATE maschinenzugang_code SET eingeloest_at = ? \
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

/// Bindet den Schlüssel eines Fremdsystems (design.md D7). Ohne bisherigen Schlüssel gilt er
/// sofort, und der Zugang wird `aktiv`. Mit bisherigem steht er als `schluessel_neu` bereit, bis er
/// zum ersten Mal signiert. Liefert den bisherigen Schlüssel.
pub async fn schluessel_binden(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    schluessel_b64: &str,
) -> Result<Option<String>, AppError> {
    let vorher: Option<Option<String>> =
        sqlx::query_scalar("SELECT schluessel FROM maschinenzugang WHERE id = ?")
            .bind(zugang_id)
            .fetch_optional(&mut *conn)
            .await?;
    let vorher = vorher.ok_or_else(|| AppError::Internal("Maschinenzugang fehlt".into()))?;
    if vorher.is_none() {
        sqlx::query(
            "UPDATE maschinenzugang SET schluessel = ?, schluessel_neu = NULL, zustand = 'aktiv' \
             WHERE id = ? AND zustand = 'wartet'",
        )
        .bind(schluessel_b64)
        .bind(zugang_id)
        .execute(&mut *conn)
        .await?;
    } else {
        sqlx::query("UPDATE maschinenzugang SET schluessel_neu = ? WHERE id = ?")
            .bind(schluessel_b64)
            .bind(zugang_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(vorher)
}

/// Der neue Schlüssel hat zum ersten Mal gültig signiert: Er löst den alten ab. Nur wenn er noch
/// der bereitstehende ist (ein zweiter Wechsel dazwischen gewinnt).
pub async fn schluessel_neu_uebernehmen(
    pool: &SqlitePool,
    zugang_id: &str,
    neu: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE maschinenzugang SET schluessel = schluessel_neu, schluessel_neu = NULL \
         WHERE id = ? AND schluessel_neu = ?",
    )
    .bind(zugang_id)
    .bind(neu)
    .execute(pool)
    .await?;
    Ok(())
}

/// Merkt eine `jti` des Zugangs bis `bis`; `false`, wenn sie schon da ist (Wiederholung).
pub async fn remember_jti(
    pool: &SqlitePool,
    zugang_id: &str,
    jti: &str,
    bis: &str,
) -> Result<bool, AppError> {
    let n =
        sqlx::query("INSERT OR IGNORE INTO maschine_jti (zugang_id, jti, bis) VALUES (?, ?, ?)")
            .bind(zugang_id)
            .bind(jti)
            .bind(bis)
            .execute(pool)
            .await?
            .rows_affected();
    Ok(n == 1)
}

/// Zählt eine angenommene Anfrage je Zugang, Route (Vorlage) und Tag und schreibt „zuletzt
/// genutzt“ höchstens einmal je Minute fort.
pub async fn abruf_zaehlen(
    pool: &SqlitePool,
    zugang_id: &str,
    route: &str,
    jetzt: &str,
) -> Result<(), AppError> {
    let tag = jetzt.get(..10).unwrap_or(jetzt);
    sqlx::query(
        "INSERT INTO maschine_abruf (zugang_id, route, tag, anzahl, erster_at, letzter_at) \
         VALUES (?, ?, ?, 1, ?, ?) \
         ON CONFLICT (zugang_id, route, tag) DO UPDATE SET anzahl = anzahl + 1, \
         letzter_at = excluded.letzter_at",
    )
    .bind(zugang_id)
    .bind(route)
    .bind(tag)
    .bind(jetzt)
    .bind(jetzt)
    .execute(pool)
    .await?;
    sqlx::query(
        "UPDATE maschinenzugang SET zuletzt_genutzt_at = ?1 WHERE id = ?2 \
         AND (zuletzt_genutzt_at IS NULL OR zuletzt_genutzt_at <= datetime(?1, '-60 seconds'))",
    )
    .bind(jetzt)
    .bind(zugang_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Hält den Grund einer Ablehnung am Zugang fest. Geschrieben wird nur, wenn der Grund wechselt
/// oder der letzte Eintrag mindestens 60 s alt ist; eine Flut falscher Anfragen erzeugt so keine
/// Schreiblast (design.md D6).
pub async fn ablehnung_festhalten(
    pool: &SqlitePool,
    zugang_id: &str,
    grund: AblehnungGrund,
    abweichung_s: Option<i64>,
    jetzt: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE maschinenzugang SET letzte_ablehnung_at = ?1, letzte_ablehnung_grund = ?2, \
         letzte_ablehnung_abweichung_s = ?3 WHERE id = ?4 \
         AND (letzte_ablehnung_grund IS NOT ?2 OR letzte_ablehnung_at IS NULL \
              OR letzte_ablehnung_at <= datetime(?1, '-60 seconds'))",
    )
    .bind(jetzt)
    .bind(grund.as_str())
    .bind(abweichung_s)
    .bind(zugang_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Meldet sich diese Instanz für die Org bei einem Hub (aktive Kopplung, meldende Seite, Org
/// zugeordnet)? Dann nimmt sie für die Org keine Fremdsysteme an (Konzept D8, design.md D10).
/// Liefert Name und Adresse des Hubs.
pub async fn hub_fuer_org(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<Option<(String, Option<String>)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT k.gegenueber_name, k.gegenueber_adresse FROM instanz_kopplung k \
         JOIN instanz_kopplung_org o ON o.kopplung_id = k.id \
         WHERE k.richtung = 'meldet_sich' AND k.zustand = 'aktiv' \
           AND o.org_id = ? AND o.widerrufen_at IS NULL \
         ORDER BY k.id LIMIT 1",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Räumt abgelaufene `jti`, Codes einen Tag nach Ablauf und Abrufe nach 365 Tagen (Purge-Lauf,
/// Phase C). Zugänge bleiben, auch widerrufene.
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM maschine_jti WHERE bis < ?")
        .bind(jetzt)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM maschinenzugang_code WHERE laeuft_ab_at < datetime(?, '-1 day')")
        .bind(jetzt)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM maschine_abruf WHERE tag < date(?, '-365 days')")
        .bind(jetzt)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::instanz::code::{derive_mit_salz, SALZ_MACHINE};

    const JETZT: &str = "2026-11-12 10:00:00";

    async fn neuer_zugang(pool: &SqlitePool) -> (String, i64) {
        let org = 1;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        let id = anlegen(
            &mut c,
            org,
            "Alarm-Adapter",
            &[Scope::AlarmmeldungenWrite],
            None,
            None,
            JETZT,
        )
        .await
        .unwrap();
        (id, org)
    }

    #[tokio::test]
    async fn anlegen_und_laden_mit_org_pruefung() {
        let pool = db::test_pool().await;
        let (id, org) = neuer_zugang(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        let z = laden_in_org(&mut c, org, &id).await.unwrap().unwrap();
        assert_eq!(z.zustand, ZugangZustand::Wartet);
        assert_eq!(z.scopes, vec![Scope::AlarmmeldungenWrite]);
        assert!(laden_in_org(&mut c, org + 999, &id)
            .await
            .unwrap()
            .is_none());
        assert_eq!(liste(&mut c, org).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn code_genau_einmal_und_nur_der_juengste() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        let a = derive_mit_salz("ABCDEFGHJKMNPQRS", SALZ_MACHINE);
        let b = derive_mit_salz("ABCDEFGHJKMNPQRT", SALZ_MACHINE);
        code_ausstellen(&mut c, &id, &a, None, "2026-11-12 10:15:00")
            .await
            .unwrap();
        code_ausstellen(&mut c, &id, &b, None, "2026-11-12 10:15:00")
            .await
            .unwrap();
        assert!(find_offener_code(&mut c, &a.suche, JETZT)
            .await
            .unwrap()
            .is_none());
        assert!(find_offener_code(&mut c, &b.suche, JETZT)
            .await
            .unwrap()
            .is_some());
        assert!(consume_code(&mut c, &b.suche, JETZT).await.unwrap());
        assert!(
            !consume_code(&mut c, &b.suche, JETZT).await.unwrap(),
            "zweites Einlösen"
        );
        // Abgelaufen
        let d = derive_mit_salz("ABCDEFGHJKMNPQRV", SALZ_MACHINE);
        code_ausstellen(&mut c, &id, &d, None, "2026-11-12 10:15:00")
            .await
            .unwrap();
        assert!(find_offener_code(&mut c, &d.suche, "2026-11-12 10:16:00")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn schluesselwechsel_haelt_den_alten_bis_zur_ersten_signatur() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        assert_eq!(schluessel_binden(&mut c, &id, "ALT").await.unwrap(), None);
        let z = laden(&mut c, &id).await.unwrap().unwrap();
        assert_eq!(
            (z.zustand, z.schluessel.as_deref()),
            (ZugangZustand::Aktiv, Some("ALT"))
        );
        assert_eq!(
            schluessel_binden(&mut c, &id, "NEU")
                .await
                .unwrap()
                .as_deref(),
            Some("ALT")
        );
        let z = laden(&mut c, &id).await.unwrap().unwrap();
        assert_eq!(
            (z.schluessel.as_deref(), z.schluessel_neu.as_deref()),
            (Some("ALT"), Some("NEU"))
        );
        drop(c);
        schluessel_neu_uebernehmen(&pool, &id, "NEU").await.unwrap();
        let mut c = pool.acquire().await.unwrap();
        let z = laden(&mut c, &id).await.unwrap().unwrap();
        assert_eq!(
            (z.schluessel.as_deref(), z.schluessel_neu),
            (Some("NEU"), None)
        );
    }

    #[tokio::test]
    async fn widerruf_verwirft_offene_codes_und_sperrt_aendern() {
        let pool = db::test_pool().await;
        let (id, org) = neuer_zugang(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        let a = derive_mit_salz("ABCDEFGHJKMNPQRS", SALZ_MACHINE);
        code_ausstellen(&mut c, &id, &a, None, "2026-11-12 10:15:00")
            .await
            .unwrap();
        assert_eq!(
            widerrufen(&mut c, org, &id, None, JETZT).await.unwrap(),
            Some(true)
        );
        assert_eq!(
            widerrufen(&mut c, org, &id, None, JETZT).await.unwrap(),
            Some(false)
        );
        assert!(find_offener_code(&mut c, &a.suche, JETZT)
            .await
            .unwrap()
            .is_none());
        assert!(matches!(
            aendern(&mut c, org, &id, "x", &[Scope::LageRead], None).await,
            Err(AppError::Conflict(_))
        ));
        assert_eq!(
            widerrufen(&mut c, org + 999, &id, None, JETZT)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn jti_genau_einmal() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        assert!(remember_jti(&pool, &id, "j", "2026-11-12 10:06:00")
            .await
            .unwrap());
        assert!(!remember_jti(&pool, &id, "j", "2026-11-12 10:06:00")
            .await
            .unwrap());
        assert!(remember_jti(&pool, "anderer", "j", "2026-11-12 10:06:00")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn ablehnung_wird_hoechstens_einmal_je_minute_geschrieben() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        let laden_neu = |pool: SqlitePool, id: String| async move {
            let mut c = pool.acquire().await.unwrap();
            laden(&mut c, &id).await.unwrap().unwrap()
        };
        ablehnung_festhalten(&pool, &id, AblehnungGrund::Uhr, Some(-420), JETZT)
            .await
            .unwrap();
        ablehnung_festhalten(
            &pool,
            &id,
            AblehnungGrund::Uhr,
            Some(-421),
            "2026-11-12 10:00:30",
        )
        .await
        .unwrap();
        let z = laden_neu(pool.clone(), id.clone()).await;
        assert_eq!(
            z.letzte_ablehnung_abweichung_s,
            Some(-420),
            "innerhalb der Minute nicht neu"
        );
        ablehnung_festhalten(
            &pool,
            &id,
            AblehnungGrund::Body,
            None,
            "2026-11-12 10:00:31",
        )
        .await
        .unwrap();
        let z = laden_neu(pool.clone(), id.clone()).await;
        assert_eq!(
            z.letzte_ablehnung_grund,
            Some(AblehnungGrund::Body),
            "neuer Grund sofort"
        );
        ablehnung_festhalten(
            &pool,
            &id,
            AblehnungGrund::Body,
            None,
            "2026-11-12 10:01:31",
        )
        .await
        .unwrap();
        let z = laden_neu(pool.clone(), id.clone()).await;
        assert_eq!(
            z.letzte_ablehnung_at.as_deref(),
            Some("2026-11-12 10:01:31")
        );
    }

    #[tokio::test]
    async fn abrufe_zaehlen_je_tag_und_route() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        for t in [
            "2026-11-12 10:00:00",
            "2026-11-12 10:00:20",
            "2026-11-12 11:00:00",
        ] {
            abruf_zaehlen(&pool, &id, "/api/v1/me", t).await.unwrap();
        }
        let (anzahl, erster, letzter): (i64, String, String) = sqlx::query_as(
            "SELECT anzahl, erster_at, letzter_at FROM maschine_abruf WHERE zugang_id = ?",
        )
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (anzahl, erster.as_str(), letzter.as_str()),
            (3, "2026-11-12 10:00:00", "2026-11-12 11:00:00")
        );
        let mut c = pool.acquire().await.unwrap();
        let z = laden(&mut c, &id).await.unwrap().unwrap();
        assert_eq!(z.zuletzt_genutzt_at.as_deref(), Some("2026-11-12 11:00:00"));
    }

    #[tokio::test]
    async fn purge_raeumt_alte_zeilen() {
        let pool = db::test_pool().await;
        let (id, _) = neuer_zugang(&pool).await;
        remember_jti(&pool, &id, "alt", "2026-11-12 09:00:00")
            .await
            .unwrap();
        remember_jti(&pool, &id, "neu", "2026-11-12 11:00:00")
            .await
            .unwrap();
        abruf_zaehlen(&pool, &id, "/api/v1/me", "2025-11-01 10:00:00")
            .await
            .unwrap();
        abruf_zaehlen(&pool, &id, "/api/v1/me", "2026-11-01 10:00:00")
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        let a = derive_mit_salz("ABCDEFGHJKMNPQRS", SALZ_MACHINE);
        code_ausstellen(&mut c, &id, &a, None, "2026-11-10 10:00:00")
            .await
            .unwrap();
        drop(c);
        purge(&pool, JETZT).await.unwrap();
        let jti: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschine_jti")
            .fetch_one(&pool)
            .await
            .unwrap();
        let abruf: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschine_abruf")
            .fetch_one(&pool)
            .await
            .unwrap();
        let code: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschinenzugang_code")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((jti, abruf, code), (1, 1, 0));
    }
}

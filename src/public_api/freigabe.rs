//! Freigabe eines Einsatzes für einen Maschinenzugang (LLH-1638, ADR-0035, Spec
//! `maschinenzugang`, „Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung“).
//!
//! Ein Lese-Scope mit Einsatzbezug ([`Scope::has_einsatzbezug`]) sieht nur den Einsatz, den die
//! Einsatzleitung für den Zugang freigegeben hat. Je Zugang ist das höchstens einer
//! (`maschinenzugang_freigabe`, eindeutiger Index auf `zugang_id`). **Wirksam** ist eine Freigabe
//! nur an einem aktiven, nicht gelöschten Einsatz: so endet sie auch dort, wo kein Schreibweg sie
//! löscht, etwa an einem Spiegel, dessen Abschluss über die Übernahme ankommt.
//!
//! Die Tabelle gilt an der Instanz, an der der Zugang angelegt ist, und wird nicht gespiegelt
//! (`instanz::spiegel::art::AUSGENOMMEN`). Herleitung:
//! `openspec/changes/archive/2026-11-12-f658d8o6-lage-fuer-maschinenzugaenge/design.md` (D2, D3).

use super::scope::{Scope, ZugangZustand};
use super::zugang::{self, Zugang};
use crate::error::AppError;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Wirksame Freigaben: nur an aktiven, nicht gelöschten Einsätzen.
const FREIGABE_WIRKSAM: &str = "SELECT f.zugang_id, f.einsatz_id FROM maschinenzugang_freigabe f \
     JOIN einsatz e ON e.id = f.einsatz_id \
     WHERE e.status = 'aktiv' AND e.geloescht_at IS NULL";

/// Ein Maschinenzugang aus Sicht eines Einsatzes (Paneel „Anbindungen“ der Seite „Geräte“).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AnbindungFreigabe {
    pub zugang_id: String,
    pub name: String,
    pub scopes: Vec<Scope>,
    /// `wartet`, solange das Fremdsystem seinen Code noch nicht eingelöst hat.
    pub zustand: ZugangZustand,
    /// Der Zugang liest diesen Einsatz.
    pub freigegeben: bool,
    /// Der Zugang liest gerade einen anderen aktiven Einsatz; Einschalten stellt ihn um.
    pub anderer_einsatz: bool,
    /// Die Instanz meldet sich für die Org bei einem Hub und nimmt den Zugang deshalb nicht an:
    /// die Freigabe ruht, bis die Kopplung endet, und lässt sich hier nur beenden.
    pub ruht: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_genutzt_at: Option<String>,
}

/// Lässt sich für diesen Zugang ein Einsatz freigeben? Nicht widerrufen, nicht abgelaufen und
/// mit einem Lese-Scope mit Einsatzbezug. Ein Zugang, der noch auf seinen Schlüssel wartet,
/// zählt: die Einsatzleitung kann vorab freigeben.
pub fn is_freigebbar(zugang: &Zugang, jetzt: &str) -> bool {
    zugang.zustand != ZugangZustand::Widerrufen
        && !zugang.is_abgelaufen(jetzt)
        && zugang.has_einsatzbezug()
}

/// Meldet sich diese Instanz für die Org bei einem Hub? Dann lehnt der Extractor jeden Zugang
/// der Org ab (Spec `maschinenzugang`, „Ein gekoppelter ELW nimmt keine Fremdsysteme an“): eine
/// neue Freigabe hätte dort keine Wirkung, das Paneel zeigte Schalter ohne Folge. Die Zugänge
/// selbst bleiben und gelten wieder, sobald die Kopplung endet; eine bestehende Freigabe ruht
/// solange.
pub async fn is_org_am_hub(conn: &mut SqliteConnection, org_id: i64) -> Result<bool, AppError> {
    Ok(zugang::hub_fuer_org(conn, org_id).await?.is_some())
}

/// Die freigebbaren Zugänge der Org aus Sicht eines Einsatzes, nach Namen. An einer Instanz, die
/// sich für die Org bei einem Hub meldet, nur die, die diesen Einsatz schon lesen (`ruht`): die
/// Einsatzleitung sieht die Freigabe, die nach dem Ende der Kopplung wieder gilt, und kann sie
/// beenden.
pub async fn list_fuer_einsatz(
    conn: &mut SqliteConnection,
    org_id: i64,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<Vec<AnbindungFreigabe>, AppError> {
    let ruht = is_org_am_hub(conn, org_id).await?;
    let wirksam: Vec<(String, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(FREIGABE_WIRKSAM))
        .fetch_all(&mut *conn)
        .await?;
    let mut liste: Vec<AnbindungFreigabe> = zugang::liste(conn, org_id)
        .await?
        .into_iter()
        .filter(|z| is_freigebbar(z, jetzt))
        .map(|z| {
            let liest = wirksam
                .iter()
                .find(|(zugang_id, _)| *zugang_id == z.id)
                .map(|(_, e)| *e);
            AnbindungFreigabe {
                freigegeben: liest == Some(einsatz_id),
                anderer_einsatz: liest.is_some_and(|e| e != einsatz_id),
                ruht,
                zugang_id: z.id,
                name: z.name,
                scopes: z.scopes,
                zustand: z.zustand,
                zuletzt_genutzt_at: z.zuletzt_genutzt_at,
            }
        })
        .filter(|f| !f.ruht || f.freigegeben)
        .collect();
    liste.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.zugang_id.cmp(&b.zugang_id))
    });
    Ok(liste)
}

/// Ein freigebbarer Zugang der Org; 404 sonst (fremd, widerrufen, abgelaufen, ohne Lese-Scope mit
/// Einsatzbezug, oder die Instanz meldet sich für die Org bei einem Hub).
pub async fn load_freigebbar(
    conn: &mut SqliteConnection,
    org_id: i64,
    zugang_id: &str,
    jetzt: &str,
) -> Result<Zugang, AppError> {
    if is_org_am_hub(conn, org_id).await? {
        return Err(AppError::NotFound);
    }
    zugang::laden_in_org(conn, org_id, zugang_id)
        .await?
        .filter(|z| is_freigebbar(z, jetzt))
        .ok_or(AppError::NotFound)
}

/// Was eine Freigabe bewirkt hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreigabeWirkung {
    /// Der Zugang las diesen Einsatz schon.
    Keine,
    /// Neu freigegeben; vorher las der Zugang keinen aktiven Einsatz.
    Neu,
    /// Neu freigegeben; vorher las er diesen anderen Einsatz.
    Abgeloest { vorher: i64 },
}

/// Der aktive Einsatz, den der Zugang liest.
pub async fn freigegebener_einsatz_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Option<i64>, AppError> {
    let sql = format!("SELECT einsatz_id FROM ({FREIGABE_WIRKSAM}) WHERE zugang_id = ?");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(zugang_id)
        .fetch_optional(&mut *conn)
        .await?)
}

/// Wie [`freigegebener_einsatz_tx`], auf dem Pool (Abruf der Lage).
pub async fn freigegebener_einsatz(
    pool: &SqlitePool,
    zugang_id: &str,
) -> Result<Option<i64>, AppError> {
    let mut conn = pool.acquire().await?;
    freigegebener_einsatz_tx(&mut conn, zugang_id).await
}

/// Die aktiven Einsätze, die der Zugang liest. Heute höchstens einer (eindeutiger Index auf
/// `zugang_id`); die Leserouten für Einsätze (LLH-1655) liefern trotzdem eine Liste, damit ihr
/// Vertrag bleibt, wenn diese Grenze fällt.
pub async fn freigegebene_einsaetze(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Vec<i64>, AppError> {
    let sql = format!(
        "SELECT einsatz_id FROM ({FREIGABE_WIRKSAM}) WHERE zugang_id = ? ORDER BY einsatz_id"
    );
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(zugang_id)
        .fetch_all(&mut *conn)
        .await?)
}

/// Darf der Zugang diesen Einsatz lesen? Genau dann, wenn er wirksam für ihn freigegeben ist und
/// zur Org des Zugangs gehört. Für Routen, deren Anfrage einen Einsatz nennt (`einsatz_id` der
/// Rechner-API, LLH-1856): die Kennung wählt nur unter den freigegebenen aus, sie öffnet nichts
/// (ADR-0035). Die Org wird mitgeprüft, denn ein fremder Einsatz wäre ein Datenabfluss.
pub async fn is_lesbar(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    org_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    if !freigegebene_einsaetze(conn, zugang_id)
        .await?
        .contains(&einsatz_id)
    {
        return Ok(false);
    }
    let einsatz_org: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?;
    if einsatz_org != Some(org_id) {
        tracing::error!(
            zugang_id,
            einsatz_id,
            "Freigabe zeigt auf einen Einsatz einer anderen Organisation"
        );
        return Ok(false);
    }
    Ok(true)
}

/// Der gelesene Einsatz mit Bezeichnung, für die Seite „Anbindungen“.
pub async fn gelesener_einsatz(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Option<(i64, String)>, AppError> {
    let sql = format!(
        "SELECT e.id, e.bezeichnung FROM ({FREIGABE_WIRKSAM}) f \
         JOIN einsatz e ON e.id = f.einsatz_id WHERE f.zugang_id = ?"
    );
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(zugang_id)
        .fetch_optional(&mut *conn)
        .await?)
}

/// Gibt den Einsatz für den Zugang frei und ersetzt eine frühere Freigabe. Prüft weder Zugang
/// noch Einsatz: das tut der Aufrufer in derselben Transaktion.
pub async fn freigeben_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    einsatz_id: i64,
    von: i64,
) -> Result<FreigabeWirkung, AppError> {
    let vorher = freigegebener_einsatz_tx(conn, zugang_id).await?;
    if vorher == Some(einsatz_id) {
        return Ok(FreigabeWirkung::Keine);
    }
    // Löschen und einfügen statt Upsert: eine unwirksame Zeile (abgeschlossener Einsatz) kann
    // den eindeutigen Index auf `zugang_id` ebenso treffen wie den Primärschlüssel.
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ?")
        .bind(zugang_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO maschinenzugang_freigabe (zugang_id, einsatz_id, freigegeben_von) \
         VALUES (?, ?, ?)",
    )
    .bind(zugang_id)
    .bind(einsatz_id)
    .bind(von)
    .execute(&mut *conn)
    .await?;
    Ok(match vorher {
        Some(vorher) => FreigabeWirkung::Abgeloest { vorher },
        None => FreigabeWirkung::Neu,
    })
}

/// Beendet die Freigabe des Einsatzes an diesem Zugang. `true`, wenn sie bestand.
pub async fn beenden_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    Ok(
        sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ? AND einsatz_id = ?")
            .bind(zugang_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?
            .rows_affected()
            == 1,
    )
}

/// Löscht alle Freigaben eines Einsatzes (beim Abschluss, in dessen Transaktion).
pub async fn delete_fuer_einsatz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Löscht die Freigabe eines Zugangs (Widerruf, Entzug des Rechts) und nennt den aktiven
/// Einsatz, den er bis dahin las.
pub async fn delete_fuer_zugang_tx(
    conn: &mut SqliteConnection,
    zugang_id: &str,
) -> Result<Option<i64>, AppError> {
    let vorher = freigegebener_einsatz_tx(conn, zugang_id).await?;
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ?")
        .bind(zugang_id)
        .execute(&mut *conn)
        .await?;
    Ok(vorher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const JETZT: &str = "2026-11-12 10:00:00";

    async fn neuer_zugang(pool: &SqlitePool, name: &str, scopes: &[Scope]) -> String {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let mut c = pool.acquire().await.unwrap();
        zugang::anlegen(&mut c, 1, name, scopes, None, None, JETZT)
            .await
            .unwrap()
    }

    async fn neuer_einsatz(pool: &SqlitePool, bezeichnung: &str) -> i64 {
        sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
            .bind(bezeichnung)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn benutzer(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leitung', 'x') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn freigeben_ist_neu_dann_keine_dann_abgeloest() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "FüKW Monitor", &[Scope::LageRead]).await;
        let a = neuer_einsatz(&pool, "A").await;
        let b = neuer_einsatz(&pool, "B").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();

        assert_eq!(
            freigeben_tx(&mut c, &z, a, von).await.unwrap(),
            FreigabeWirkung::Neu
        );
        assert_eq!(
            freigeben_tx(&mut c, &z, a, von).await.unwrap(),
            FreigabeWirkung::Keine
        );
        assert_eq!(
            freigeben_tx(&mut c, &z, b, von).await.unwrap(),
            FreigabeWirkung::Abgeloest { vorher: a }
        );
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z).await.unwrap(), Some(b));
        assert_eq!(
            gelesener_einsatz(&mut c, &z).await.unwrap(),
            Some((b, "B".to_string()))
        );
        // Beenden nur am richtigen Einsatz.
        assert!(!beenden_tx(&mut c, &z, a).await.unwrap());
        assert!(beenden_tx(&mut c, &z, b).await.unwrap());
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z).await.unwrap(), None);
    }

    #[tokio::test]
    async fn ein_einsatz_kann_fuer_zwei_zugaenge_freigegeben_sein() {
        let pool = db::test_pool().await;
        let z1 = neuer_zugang(&pool, "Monitor 1", &[Scope::LageRead]).await;
        let z2 = neuer_zugang(&pool, "Monitor 2", &[Scope::LageRead]).await;
        let e = neuer_einsatz(&pool, "A").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        freigeben_tx(&mut c, &z1, e, von).await.unwrap();
        freigeben_tx(&mut c, &z2, e, von).await.unwrap();
        assert_eq!(
            freigegebener_einsatz_tx(&mut c, &z1).await.unwrap(),
            Some(e)
        );
        assert_eq!(
            freigegebener_einsatz_tx(&mut c, &z2).await.unwrap(),
            Some(e)
        );
        delete_fuer_einsatz_tx(&mut c, e).await.unwrap();
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z1).await.unwrap(), None);
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z2).await.unwrap(), None);
    }

    #[tokio::test]
    async fn wirksam_nur_am_aktiven_und_nicht_geloeschten_einsatz() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "Monitor", &[Scope::LageRead]).await;
        let a = neuer_einsatz(&pool, "A").await;
        let b = neuer_einsatz(&pool, "B").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        freigeben_tx(&mut c, &z, a, von).await.unwrap();

        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(a)
            .execute(&mut *c)
            .await
            .unwrap();
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z).await.unwrap(), None);
        // Die unwirksame Zeile steht noch; eine neue Freigabe ist „Neu“, nicht „Abgelöst“, und
        // scheitert nicht am eindeutigen Index.
        assert_eq!(
            freigeben_tx(&mut c, &z, b, von).await.unwrap(),
            FreigabeWirkung::Neu
        );

        sqlx::query("UPDATE einsatz SET geloescht_at = datetime('now') WHERE id = ?")
            .bind(b)
            .execute(&mut *c)
            .await
            .unwrap();
        assert_eq!(freigegebener_einsatz_tx(&mut c, &z).await.unwrap(), None);
        assert_eq!(delete_fuer_zugang_tx(&mut c, &z).await.unwrap(), None);
    }

    #[tokio::test]
    async fn loeschen_fuer_den_zugang_nennt_den_gelesenen_einsatz() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "Monitor", &[Scope::LageRead]).await;
        let e = neuer_einsatz(&pool, "A").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        freigeben_tx(&mut c, &z, e, von).await.unwrap();
        assert_eq!(delete_fuer_zugang_tx(&mut c, &z).await.unwrap(), Some(e));
        assert_eq!(delete_fuer_zugang_tx(&mut c, &z).await.unwrap(), None);
    }

    /// LLH-1856: lesbar ist genau der wirksam freigegebene Einsatz der eigenen Org.
    #[tokio::test]
    async fn lesbar_ist_nur_der_freigegebene_einsatz_der_eigenen_org() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "Planung", &[Scope::EinsaetzeRead, Scope::RechnerUse]).await;
        let a = neuer_einsatz(&pool, "A").await;
        let b = neuer_einsatz(&pool, "B").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();

        assert!(!is_lesbar(&mut c, &z, 1, a).await.unwrap(), "ohne Freigabe");
        freigeben_tx(&mut c, &z, a, von).await.unwrap();
        assert!(is_lesbar(&mut c, &z, 1, a).await.unwrap(), "freigegeben");
        assert!(
            !is_lesbar(&mut c, &z, 1, b).await.unwrap(),
            "anderer Einsatz"
        );
        assert!(!is_lesbar(&mut c, &z, 1, 999).await.unwrap(), "unbekannt");
        assert!(!is_lesbar(&mut c, &z, 2, a).await.unwrap(), "andere Org");
        assert!(
            !is_lesbar(&mut c, "fremd", 1, a).await.unwrap(),
            "anderer Zugang"
        );

        sqlx::query("UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?")
            .bind(a)
            .execute(&mut *c)
            .await
            .unwrap();
        assert!(!is_lesbar(&mut c, &z, 1, a).await.unwrap(), "abgeschlossen");

        freigeben_tx(&mut c, &z, b, von).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = datetime('now') WHERE id = ?")
            .bind(b)
            .execute(&mut *c)
            .await
            .unwrap();
        assert!(!is_lesbar(&mut c, &z, 1, b).await.unwrap(), "gelöscht");
    }

    /// Eine Freigabe, die auf einen Einsatz einer anderen Org zeigt, öffnet ihn nicht: kein
    /// Schreibweg legt sie an, aber ein fremder Einsatz wäre ein Datenabfluss.
    #[tokio::test]
    async fn freigabe_auf_einen_fremden_einsatz_ist_nicht_lesbar() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "Planung", &[Scope::EinsaetzeRead]).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')")
            .execute(&pool)
            .await
            .unwrap();
        let fremd: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (2, 'Fremd') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        freigeben_tx(&mut c, &z, fremd, von).await.unwrap();
        assert!(!is_lesbar(&mut c, &z, 1, fremd).await.unwrap());
    }

    async fn org_an_hub_koppeln(c: &mut SqliteConnection) -> i64 {
        let kopplung: i64 = sqlx::query_scalar(
            "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
             gegenueber_name, richtung, gegenueber_adresse, zustand) \
             VALUES ('hub-1', 'X', 'Hub Kreis', 'meldet_sich', 'https://hub.example', 'aktiv') \
             RETURNING id",
        )
        .fetch_one(&mut *c)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
             fremde_org_name) VALUES (?, 1, 'hub-1/1', 'Kreis')",
        )
        .bind(kopplung)
        .execute(&mut *c)
        .await
        .unwrap();
        kopplung
    }

    /// Meldet sich die Instanz für die Org bei einem Hub, lehnt der Extractor ihre Zugänge ab:
    /// dann gibt es auch nichts freizugeben.
    #[tokio::test]
    async fn am_gekoppelten_elw_ist_kein_zugang_freigebbar() {
        let pool = db::test_pool().await;
        let z = neuer_zugang(&pool, "Monitor", &[Scope::LageRead]).await;
        let e = neuer_einsatz(&pool, "A").await;
        let mut c = pool.acquire().await.unwrap();
        let vorher = list_fuer_einsatz(&mut c, 1, e, JETZT).await.unwrap();
        assert_eq!(vorher.len(), 1);
        assert!(!vorher[0].ruht);

        org_an_hub_koppeln(&mut c).await;

        assert!(list_fuer_einsatz(&mut c, 1, e, JETZT)
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            load_freigebbar(&mut c, 1, &z, JETZT).await,
            Err(AppError::NotFound)
        ));
    }

    /// Eine Freigabe von vor der Kopplung ruht: die Einsatzleitung sieht sie und kann sie
    /// beenden. Sonst gälte sie nach dem Ende der Kopplung wieder, ohne dass sie in der
    /// Zwischenzeit jemand gesehen hätte.
    #[tokio::test]
    async fn freigabe_ruht_am_gekoppelten_elw_und_gilt_nach_der_kopplung_wieder() {
        let pool = db::test_pool().await;
        let liest = neuer_zugang(&pool, "Monitor", &[Scope::LageRead]).await;
        let woanders = neuer_zugang(&pool, "Monitor B", &[Scope::LageRead]).await;
        neuer_zugang(&pool, "Monitor C", &[Scope::LageRead]).await;
        let e = neuer_einsatz(&pool, "A").await;
        let anderer = neuer_einsatz(&pool, "B").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        freigeben_tx(&mut c, &liest, e, von).await.unwrap();
        freigeben_tx(&mut c, &woanders, anderer, von).await.unwrap();

        let kopplung = org_an_hub_koppeln(&mut c).await;

        // Nur die Freigabe dieses Einsatzes steht da: umstellen und neu freigeben geht hier nicht.
        let liste = list_fuer_einsatz(&mut c, 1, e, JETZT).await.unwrap();
        assert_eq!(liste.len(), 1, "{liste:?}");
        assert_eq!(liste[0].zugang_id, liest);
        assert!(liste[0].freigegeben && liste[0].ruht);

        // Endet die Kopplung, gilt die Freigabe wieder, und alle Zugänge stehen im Paneel.
        sqlx::query(
            "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-11-12 09:00:00' \
             WHERE kopplung_id = ?",
        )
        .bind(kopplung)
        .execute(&mut *c)
        .await
        .unwrap();
        let liste = list_fuer_einsatz(&mut c, 1, e, JETZT).await.unwrap();
        assert_eq!(liste.len(), 3, "{liste:?}");
        assert!(liste.iter().all(|f| !f.ruht));
        assert_eq!(
            freigegebener_einsatz_tx(&mut c, &liest).await.unwrap(),
            Some(e)
        );
    }

    #[tokio::test]
    async fn liste_zeigt_nur_freigebbare_zugaenge_der_org() {
        let pool = db::test_pool().await;
        let monitor = neuer_zugang(&pool, "b Monitor", &[Scope::LageRead]).await;
        let zweiter = neuer_zugang(&pool, "A Monitor", &[Scope::LageRead, Scope::RechnerUse]).await;
        let adapter = neuer_zugang(&pool, "Adapter", &[Scope::AlarmmeldungenWrite]).await;
        let widerrufen = neuer_zugang(&pool, "Alt", &[Scope::LageRead]).await;
        let abgelaufen = neuer_zugang(&pool, "Abgelaufen", &[Scope::LageRead]).await;
        let a = neuer_einsatz(&pool, "A").await;
        let b = neuer_einsatz(&pool, "B").await;
        let von = benutzer(&pool).await;
        let mut c = pool.acquire().await.unwrap();
        zugang::widerrufen(&mut c, 1, &widerrufen, None, JETZT)
            .await
            .unwrap();
        sqlx::query("UPDATE maschinenzugang SET gueltig_bis = '2026-11-12 09:00:00' WHERE id = ?")
            .bind(&abgelaufen)
            .execute(&mut *c)
            .await
            .unwrap();
        freigeben_tx(&mut c, &monitor, a, von).await.unwrap();
        freigeben_tx(&mut c, &zweiter, b, von).await.unwrap();

        let liste = list_fuer_einsatz(&mut c, 1, a, JETZT).await.unwrap();
        let namen: Vec<&str> = liste.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            namen,
            ["A Monitor", "b Monitor"],
            "nach Namen, ohne Groß/Klein"
        );
        assert!(liste[1].freigegeben && !liste[1].anderer_einsatz);
        assert!(!liste[0].freigegeben && liste[0].anderer_einsatz);
        assert_eq!(liste[1].zustand, ZugangZustand::Wartet);
        assert!(liste.iter().all(|f| f.zugang_id != adapter));

        // Eine andere Org sieht nichts.
        assert!(list_fuer_einsatz(&mut c, 999, a, JETZT)
            .await
            .unwrap()
            .is_empty());

        // 404 für alles, was nicht freigebbar ist.
        assert!(load_freigebbar(&mut c, 1, &monitor, JETZT).await.is_ok());
        for id in [&adapter, &widerrufen, &abgelaufen] {
            assert!(matches!(
                load_freigebbar(&mut c, 1, id, JETZT).await,
                Err(AppError::NotFound)
            ));
        }
        assert!(matches!(
            load_freigebbar(&mut c, 999, &monitor, JETZT).await,
            Err(AppError::NotFound)
        ));
    }
}

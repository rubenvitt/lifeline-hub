//! Endgültige Löschung des pseudonymen Skeletts geschwärzter Einsätze (LFH-750, Spec
//! `aufbewahrung`, Herleitung `openspec/changes/archive/2026-10-02-lfh-750-skelett-endgueltig-loeschen/design.md`).
//!
//! Phase D des Purge-Laufs ([`super::purge_scheduler`]): Ein geschwärzter Einsatz, dessen
//! Skelett-Frist abgelaufen ist (`retention::skelett_loeschung_faellig`), wird samt allen
//! abhängigen Zeilen gelöscht — die Kaskade auf `einsatz(id)` nimmt ETB, Register und Anhänge
//! mit. Seine einzige Spur ist danach eine Zeile in `aufbewahrung_loeschprotokoll`: Nummer,
//! Zeitpunkte, angewandte Frist und Akteur, keine Bezeichnung, kein Ortsbezug, kein ETB-Text.
//!
//! **Fail-closed wie der übrige Purge-Audit:** ohne Akteur (abschließende Person →
//! Einsatzleitung → System-Admin der Org) keine Löschung; der nächste Lauf versucht es erneut.
//! Die Protokollzeile sperrt zugleich ID und Einsatznummer gegen die Wiedervergabe
//! (`repo::anlegen_tx`).

use super::retention::skelett_loeschung_faellig;
use super::STATUS_ABGESCHLOSSEN;
use crate::error::AppError;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;

/// Ein geschwärzter Einsatz samt Skelett-Frist seiner Org.
#[derive(Debug, sqlx::FromRow)]
struct Kandidat {
    id: i64,
    abgeschlossen_at: Option<String>,
    geschwaerzt_at: Option<String>,
    skelett_dauer_tage: Option<i64>,
}

impl Kandidat {
    fn faellig(&self, jetzt: DateTime<Utc>) -> bool {
        skelett_loeschung_faellig(
            self.abgeschlossen_at.as_deref(),
            self.geschwaerzt_at.as_deref(),
            self.skelett_dauer_tage,
            jetzt,
        )
    }
}

/// Ein geschwärzter, abgeschlossener Einsatz mit der Skelett-Frist seiner Org. Die Fälligkeit
/// prüft [`Kandidat::faellig`] in Rust gegen das injizierte `jetzt` (wie die Karenz in
/// Phase B); `status` und `geschwaerzt_at` stehen hart im WHERE — aktive und ungeschwärzte
/// Einsätze sind nie dabei. Ein Einsatz, an dem noch ein Anhang steht, wartet auf den Nachlauf
/// der Schwärzung (LFH-905): die Kaskade beim Löschen nähme die Reste sonst in einer
/// Transaktion mit, und die hielte die Schreibsperre so lange, wie das Nullen dauert.
const KANDIDAT_SELECT: &str = "SELECT e.id, e.abgeschlossen_at, e.geschwaerzt_at, \
            o.skelett_dauer_tage \
     FROM einsatz e JOIN org_einstellungen o ON o.org_id = e.org_id \
     WHERE e.status = ? AND e.geschwaerzt_at IS NOT NULL AND o.skelett_dauer_tage IS NOT NULL \
       AND NOT EXISTS (SELECT 1 FROM anhang a WHERE a.einsatz_id = e.id)";

/// Phase-D-Kandidaten: IDs abgeschlossener, geschwärzter Einsätze, deren Org eine
/// Skelett-Frist hat und deren Frist zu `jetzt` abgelaufen ist.
pub async fn faellige(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<Vec<i64>, AppError> {
    let sql = format!("{KANDIDAT_SELECT} ORDER BY e.id");
    let kandidaten = sqlx::query_as::<_, Kandidat>(sqlx::AssertSqlSafe(sql))
        .bind(STATUS_ABGESCHLOSSEN)
        .fetch_all(pool)
        .await?;
    Ok(kandidaten
        .into_iter()
        .filter(|k| k.faellig(jetzt))
        .map(|k| k.id)
        .collect())
}

/// Löscht einen fälligen Einsatz endgültig (UNUMKEHRBAR) und schreibt die Protokollzeile —
/// beides in EINER `BEGIN IMMEDIATE`-Transaktion. Die Fälligkeit wird darin erneut geprüft:
/// eine zwischen Kandidatenliste und Aufruf geleerte oder verlängerte Org-Frist gewinnt
/// (`Ok(false)`), ebenso ein schon gelöschter Einsatz.
///
/// Fail-closed: ohne Akteur ([`super::repo::ermittle_system_akteur`]) ein Fehler, und nichts
/// ist gelöscht. Scheitert die Protokollzeile, rollt die Löschung mit zurück.
pub async fn loeschen(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<bool, AppError> {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    crate::write_retry!(pool, |conn| {
        let sql = format!("{KANDIDAT_SELECT} AND e.id = ?");
        let kandidat = sqlx::query_as::<_, Kandidat>(sqlx::AssertSqlSafe(sql))
            .bind(STATUS_ABGESCHLOSSEN)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
        let Some(kandidat) = kandidat.filter(|k| k.faellig(jetzt)) else {
            return Ok(false);
        };

        let Some(akteur) = super::repo::ermittle_system_akteur(&mut *conn, einsatz_id).await?
        else {
            // Sichtbar nur im Log — die Meldung nennt Einsatz UND Org (wie `system_audit_tx`).
            let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
                .bind(einsatz_id)
                .fetch_one(&mut *conn)
                .await?;
            return Err(AppError::Internal(format!(
                "Purge: kein Benutzer als Akteur für die endgültige Löschung von Einsatz \
                 {einsatz_id} (Org {org_id}) auffindbar (weder abschließende Person noch \
                 Einsatzleitung noch System-Admin der Org) — Löschung abgebrochen, nächster \
                 Lauf versucht es erneut"
            )));
        };

        // Die Protokollzeile übernimmt nur Retain-Spalten des Kopfes — keine Bezeichnung, kein
        // Stichwort, kein Ort (Spec `aufbewahrung`, „Löschprotokoll“).
        sqlx::query(
            "INSERT INTO aufbewahrung_loeschprotokoll (org_id, einsatz_id, einsatznummer_intern, \
                nummer_jahr, nummer_lfd, abgeschlossen_at, geschwaerzt_at, geloescht_at, \
                skelett_dauer_tage, akteur_id) \
             SELECT org_id, id, einsatznummer_intern, nummer_jahr, nummer_lfd, abgeschlossen_at, \
                geschwaerzt_at, ?, ?, ? \
             FROM einsatz WHERE id = ?",
        )
        .bind(&jetzt_s)
        .bind(kandidat.skelett_dauer_tage)
        .bind(akteur)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;

        // Die Kaskade auf `einsatz(id)` trägt die Löschung; ohne sofortige FK-Prüfung bliebe
        // jede abhängige Zeile verwaist stehen.
        crate::db::fk_pruefung_sicherstellen(&mut *conn, "Endgültige Löschung").await?;
        let geloescht = sqlx::query(
            "DELETE FROM einsatz WHERE id = ? AND status = ? AND geschwaerzt_at IS NOT NULL",
        )
        .bind(einsatz_id)
        .bind(STATUS_ABGESCHLOSSEN)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if geloescht != 1 {
            return Err(AppError::Internal(format!(
                "Endgültige Löschung von Einsatz {einsatz_id}: {geloescht} Zeilen statt 1"
            )));
        }
        Ok(true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    const JETZT: &str = "2026-06-30 12:00:00";

    async fn org(pool: &SqlitePool, org_id: i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, ?)")
            .bind(org_id)
            .bind(format!("Org {org_id}"))
            .execute(pool)
            .await
            .unwrap();
    }

    async fn org_frist(pool: &SqlitePool, org_id: i64, tage: Option<i64>) {
        org(pool, org_id).await;
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, skelett_dauer_tage) VALUES (?, ?) \
             ON CONFLICT(org_id) DO UPDATE SET skelett_dauer_tage = excluded.skelett_dauer_tage",
        )
        .bind(org_id)
        .bind(tage)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn benutzer(pool: &SqlitePool, org_id: i64, name: &str, rolle: &str) -> i64 {
        org(pool, org_id).await;
        sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (?, ?, ?, 'h', ?) RETURNING id",
        )
        .bind(org_id)
        .bind(name)
        .bind(name)
        .bind(rolle)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Geschwärzter Einsatz der Org `org_id` mit ETB-Eintrag samt Berichtigung, Person, Tier,
    /// Schaden mit Geschädigten-Bezug auf die Person und Anhang. `akteur`:
    /// abschließende Person (oder keine). Einsatznummer `E-<jahr>-<lfd>` aus `abgeschlossen_at`.
    async fn geschwaerzt(
        pool: &SqlitePool,
        org_id: i64,
        abgeschlossen_at: &str,
        geschwaerzt_at: &str,
        akteur: Option<i64>,
        lfd: i64,
    ) -> i64 {
        org(pool, org_id).await;
        let erfasser = match akteur {
            Some(a) => a,
            None => benutzer(pool, org_id, &format!("helfer{org_id}-{lfd}"), "keiner").await,
        };
        let jahr: i64 = abgeschlossen_at[..4].parse().unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, stichwort, status, abgeschlossen_at, \
                abgeschlossen_von, retention_bis, geloescht_at, geschwaerzt_at, \
                einsatznummer_intern, nummer_jahr, nummer_lfd) \
             VALUES (?, 'VU Müller', 'TH1', 'abgeschlossen', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(abgeschlossen_at)
        .bind(akteur)
        .bind(abgeschlossen_at)
        .bind(abgeschlossen_at)
        .bind(geschwaerzt_at)
        .bind(format!("E-{jahr}-{lfd:04}"))
        .bind(jahr)
        .bind(lfd)
        .fetch_one(pool)
        .await
        .unwrap();
        let etb: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'meldung', 'ETB-Wortlaut', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(erfasser)
        .bind(abgeschlossen_at)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
                berichtigt_eintrag_id) VALUES (?, 2, 'berichtigung', 'Berichtigt', ?, ?, ?)",
        )
        .bind(e)
        .bind(erfasser)
        .bind(abgeschlossen_at)
        .bind(etb)
        .execute(pool)
        .await
        .unwrap();
        let person: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, \
                geaendert_von) VALUES (?, 1, 'betroffen', ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(erfasser)
        .bind(erfasser)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, erfasst_von, \
                geaendert_von) VALUES (?, 1, 'hund', ?, ?)",
        )
        .bind(e)
        .bind(erfasser)
        .bind(erfasser)
        .execute(pool)
        .await
        .unwrap();
        // Kategorie-Frist (LFH-749): geht per Kaskade mit dem Einsatz.
        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, geschwaerzt_at) VALUES (?, 'anhaenge', ?, 'x', ?)",
        )
        .bind(e)
        .bind(geschwaerzt_at)
        .bind(geschwaerzt_at)
        .execute(pool)
        .await
        .unwrap();
        // `geschaedigt_person_id` zeigt OHNE ON DELETE auf die Person: die Kaskade muss beide
        // Zeilen im selben Statement entfernen, sonst scheitert die Löschung.
        sqlx::query(
            "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, status, typ, ausmass, ort, \
                geschaedigt_person_id, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'offen', 'sachschaden', 'gering', 'Hauptstr', ?, ?, ?)",
        )
        .bind(e)
        .bind(person)
        .bind(erfasser)
        .bind(erfasser)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                hochgeladen_von) VALUES (?, 'x.jpg', 'image/jpeg', 1, 'x', x'00', ?)",
        )
        .bind(e)
        .bind(erfasser)
        .execute(pool)
        .await
        .unwrap();
        e
    }

    /// Zeilen mit `einsatz_id = e` in jeder Tabelle, die die Spalte trägt — außer den beiden
    /// Tabellen, die eine gelöschte ID bewusst behalten (Löschprotokoll, Demo-Kopf).
    async fn reste(pool: &SqlitePool, e: i64) -> Vec<(String, i64)> {
        let tabellen: Vec<String> = sqlx::query_scalar(
            "SELECT m.name FROM sqlite_master m, pragma_table_info(m.name) c \
             WHERE m.type = 'table' AND c.name = 'einsatz_id' \
               AND m.name NOT IN ('aufbewahrung_loeschprotokoll', 'demo_import') \
             ORDER BY m.name",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let mut reste = Vec::new();
        for tabelle in tabellen {
            let sql = format!("SELECT COUNT(*) FROM \"{tabelle}\" WHERE einsatz_id = ?");
            let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .bind(e)
                .fetch_one(pool)
                .await
                .unwrap();
            if n > 0 {
                reste.push((tabelle, n));
            }
        }
        let kopf: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap();
        if kopf > 0 {
            reste.push(("einsatz".into(), kopf));
        }
        reste
    }

    async fn protokoll_zeilen(pool: &SqlitePool, e: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn faellige_nur_geschwaerzt_abgeschlossen_mit_abgelaufener_org_frist() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let faellig = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            1,
        )
        .await;
        let _jung = geschwaerzt(
            &pool,
            1,
            "2026-01-01 00:00:00",
            "2026-03-01 00:00:00",
            Some(a),
            2,
        )
        .await;
        let ungeschwaerzt = geschwaerzt(&pool, 1, "2016-01-02 00:00:00", "x", Some(a), 3).await;
        sqlx::query("UPDATE einsatz SET geschwaerzt_at = NULL WHERE id = ?")
            .bind(ungeschwaerzt)
            .execute(&pool)
            .await
            .unwrap();
        let aktiv = geschwaerzt(
            &pool,
            1,
            "2016-01-03 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            4,
        )
        .await;
        sqlx::query("UPDATE einsatz SET status = 'aktiv' WHERE id = ?")
            .bind(aktiv)
            .execute(&pool)
            .await
            .unwrap();
        // Org 2 ohne Skelett-Frist: ihr gleich alter Einsatz bleibt.
        let b = benutzer(&pool, 2, "leit2", "keiner").await;
        let _fremd = geschwaerzt(
            &pool,
            2,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(b),
            1,
        )
        .await;
        // Die Fixture hängt an jeden geschwärzten Einsatz einen Anhang; Phase D wartet auf den
        // Nachlauf, der ihn löscht (LFH-905, `phase_d_wartet_auf_den_nachlauf`).
        crate::anhang::repo::entferne_vorgesehene(&pool, None)
            .await
            .unwrap();

        assert_eq!(faellige(&pool, t(JETZT)).await.unwrap(), vec![faellig]);
    }

    #[tokio::test]
    async fn loeschen_entfernt_jede_zeile_und_schreibt_genau_eine_protokollzeile() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            7,
        )
        .await;
        assert!(!reste(&pool, e).await.is_empty(), "Fixture trägt Zeilen");

        assert!(loeschen(&pool, e, t(JETZT)).await.unwrap());

        assert_eq!(
            reste(&pool, e).await,
            vec![],
            "keine Zeile des Einsatzes bleibt"
        );
        let verstoesse: Vec<(String,)> = sqlx::query_as("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(verstoesse.is_empty(), "{verstoesse:?}");
        let zeile: (
            i64,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<String>,
            String,
            String,
            i64,
            i64,
        ) = sqlx::query_as(
            "SELECT org_id, einsatznummer_intern, nummer_jahr, nummer_lfd, abgeschlossen_at, \
                    geschwaerzt_at, geloescht_at, skelett_dauer_tage, akteur_id \
                 FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeile,
            (
                1,
                Some("E-2016-0007".into()),
                Some(2016),
                Some(7),
                Some("2016-01-01 00:00:00".into()),
                "2016-03-01 00:00:00".into(),
                JETZT.into(),
                3650,
                a
            )
        );
        assert_eq!(protokoll_zeilen(&pool, e).await, 1);

        // Zweiter Aufruf: nichts mehr zu tun, keine zweite Zeile.
        assert!(!loeschen(&pool, e, t(JETZT)).await.unwrap());
        assert_eq!(protokoll_zeilen(&pool, e).await, 1);
    }

    #[tokio::test]
    async fn loeschen_ohne_akteur_unterbleibt_und_gelingt_mit_admin() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let e = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            None,
            1,
        )
        .await;

        let fehler = loeschen(&pool, e, t(JETZT)).await.unwrap_err().to_string();
        assert!(fehler.contains(&format!("Einsatz {e} (Org 1)")), "{fehler}");
        assert!(!reste(&pool, e).await.is_empty(), "Einsatz bleibt");
        assert_eq!(protokoll_zeilen(&pool, e).await, 0);

        let admin = benutzer(&pool, 1, "orgadmin", "admin").await;
        assert!(loeschen(&pool, e, t(JETZT)).await.unwrap());
        let akteur: i64 = sqlx::query_scalar(
            "SELECT akteur_id FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?",
        )
        .bind(e)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(akteur, admin);
    }

    #[tokio::test]
    async fn scheitert_die_protokollzeile_bleibt_der_einsatz() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            1,
        )
        .await;
        // Eine schon vorhandene Zeile derselben ID verletzt UNIQUE(einsatz_id).
        sqlx::query(
            "INSERT INTO aufbewahrung_loeschprotokoll (org_id, einsatz_id, geschwaerzt_at, \
                geloescht_at, skelett_dauer_tage, akteur_id) VALUES (1, ?, 'x', 'x', 1, ?)",
        )
        .bind(e)
        .bind(a)
        .execute(&pool)
        .await
        .unwrap();

        assert!(loeschen(&pool, e, t(JETZT)).await.is_err());
        assert!(!reste(&pool, e).await.is_empty(), "Einsatz bleibt");
    }

    #[tokio::test]
    async fn geleerte_org_frist_zwischen_kandidat_und_loeschen_gewinnt() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            1,
        )
        .await;
        crate::anhang::repo::entferne_vorgesehene(&pool, None)
            .await
            .unwrap();
        assert_eq!(faellige(&pool, t(JETZT)).await.unwrap(), vec![e]);

        org_frist(&pool, 1, None).await;
        assert!(!loeschen(&pool, e, t(JETZT)).await.unwrap());
        assert!(!reste(&pool, e).await.is_empty(), "Einsatz bleibt");
        assert_eq!(protokoll_zeilen(&pool, e).await, 0);
    }

    /// Spec `aufbewahrung`, „Keine Wiedervergabe“: ID und laufende Nummer eines endgültig
    /// gelöschten Einsatzes kommen nicht wieder — sonst schrieben offene Tabs und
    /// Offline-Queues still in einen fremden Einsatz.
    #[tokio::test]
    async fn geloeschte_id_und_nummer_werden_nicht_wieder_vergeben() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(1)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2026-01-01 00:00:00",
            "2026-03-01 00:00:00",
            Some(a),
            5,
        )
        .await;
        assert!(loeschen(&pool, e, t(JETZT)).await.unwrap());

        let neu = super::super::repo::anlegen_zum(
            &pool,
            super::super::repo::NeuerEinsatzDaten {
                bezeichnung: "Neu",
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
            },
            a,
            t("2026-07-01 08:00:00"),
        )
        .await
        .unwrap();
        assert!(
            neu.id > e,
            "ID {} des gelöschten Einsatzes kam wieder",
            neu.id
        );
        let (jahr, lfd): (i64, i64) =
            sqlx::query_as("SELECT nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?")
                .bind(neu.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (jahr, lfd),
            (2026, 6),
            "Nummer 5 des gelöschten Einsatzes kam wieder"
        );
    }

    /// Spec `aufbewahrung`, „Scheitern der Löschung“, Gegenrichtung: scheitert das DELETE NACH
    /// der Protokollzeile, rollt auch die Protokollzeile zurück — keine Spur einer Löschung, die
    /// nicht stattfand.
    #[tokio::test]
    async fn scheitert_das_delete_rollt_die_protokollzeile_mit_zurueck() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(3650)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2016-01-01 00:00:00",
            "2016-03-01 00:00:00",
            Some(a),
            1,
        )
        .await;
        sqlx::query(
            "CREATE TRIGGER test_delete_scheitert BEFORE DELETE ON einsatz \
             BEGIN SELECT RAISE(ABORT, 'test'); END",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(loeschen(&pool, e, t(JETZT)).await.is_err());
        assert_eq!(
            protokoll_zeilen(&pool, e).await,
            0,
            "Protokollzeile rollt mit zurück"
        );
        assert!(!reste(&pool, e).await.is_empty(), "Einsatz bleibt");
    }

    /// Nummernsperre über den TEXT: ein Altbestand ohne Zahlenspalten trägt nur
    /// `einsatznummer_intern`. Nach seiner Löschung darf der Text nicht wieder vergeben werden.
    #[tokio::test]
    async fn geloeschter_nummerntext_ohne_zahlenspalten_wird_nicht_wieder_vergeben() {
        let pool = crate::db::test_pool().await;
        org_frist(&pool, 1, Some(1)).await;
        let a = benutzer(&pool, 1, "leit", "keiner").await;
        let e = geschwaerzt(
            &pool,
            1,
            "2026-01-01 00:00:00",
            "2026-03-01 00:00:00",
            Some(a),
            1,
        )
        .await;
        sqlx::query(
            "UPDATE einsatz SET einsatznummer_intern = 'E-2026-0001', nummer_jahr = NULL, \
                nummer_lfd = NULL WHERE id = ?",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        assert!(loeschen(&pool, e, t(JETZT)).await.unwrap());

        let neu = super::super::repo::anlegen_zum(
            &pool,
            super::super::repo::NeuerEinsatzDaten {
                bezeichnung: "Neu",
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
            },
            a,
            t("2026-07-01 08:00:00"),
        )
        .await
        .unwrap();
        let nummer: String =
            sqlx::query_scalar("SELECT einsatznummer_intern FROM einsatz WHERE id = ?")
                .bind(neu.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(nummer, "E-2026-0002");
    }
}

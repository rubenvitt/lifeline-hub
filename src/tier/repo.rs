use super::TierAnzeige;
use crate::error::AppError;
use sqlx::SqlitePool;

/// Basis-SELECT inkl. LEFT JOIN auf `einsatz_person` für die read-only
/// Halter-Auflösung (`halter_registrier_nr`, `halter_storniert_at`).
const SELECT_ALLE: &str = "\
    SELECT t.id, t.einsatz_id, t.registrier_nr, t.status, t.spezies, \
           t.rasse_beschreibung, t.rufname, t.geschlecht, t.alter_geschaetzt, \
           t.farbe_beschreibung, t.kennzeichnung, t.groesse_gewicht, \
           t.halter_person_id, t.halter_kontakt, t.antreff_ort, t.notiz, \
           t.abschluss_grund, t.abschluss_ziel, t.erfasst_at, t.erfasst_von, \
           t.geaendert_at, t.geaendert_von, t.storniert_at, \
           hp.registrier_nr AS halter_registrier_nr, \
           hp.storniert_at  AS halter_storniert_at \
    FROM einsatz_tier t \
    LEFT JOIN einsatz_person hp ON hp.id = t.halter_person_id \
                               AND hp.einsatz_id = t.einsatz_id";

/// Eingabedaten beim Anlegen. Strings bereits getrimmt (Handler-Aufgabe); leere
/// Werte als `None`. `spezies` ist Pflicht. `status` wird separat übergeben.
#[derive(Debug)]
pub struct NeueDaten<'a> {
    pub spezies: &'a str,
    pub rasse_beschreibung: Option<&'a str>,
    pub rufname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<&'a str>,
    pub kennzeichnung: Option<&'a str>,
    pub groesse_gewicht: Option<&'a str>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub notiz: Option<&'a str>,
}

/// Patch-Daten. Identitäts-/Kontextfelder folgen COALESCE-Semantik (gesetzt =
/// übernehmen, `None` = unverändert). Die Halter-Felder nutzen die explizite
/// `Some(None)`-Semantik (= auf NULL setzen) wie in `uhs::repo::PatchDaten`,
/// damit der FK↔Freitext-Toggle ein Feld leeren kann.
#[derive(Debug, Default)]
pub struct PatchDaten<'a> {
    pub rasse_beschreibung: Option<&'a str>,
    pub rufname: Option<&'a str>,
    pub geschlecht: Option<&'a str>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<&'a str>,
    pub kennzeichnung: Option<&'a str>,
    pub groesse_gewicht: Option<&'a str>,
    pub antreff_ort: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// `Some(Some(id))` = setzen, `Some(None)` = auf NULL, `None` = unverändert.
    pub halter_person_id: Option<Option<i64>>,
    pub halter_kontakt: Option<Option<&'a str>>,
}

/// Tiere eines Einsatzes (ohne stornierte), optional gefiltert. Sortierung:
/// registrier_nr absteigend (neueste oben — Spec).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: Option<&str>,
    spezies: Option<&str>,
    halter_person_id: Option<i64>,
) -> Result<Vec<TierAnzeige>, AppError> {
    let sql = format!(
        "{SELECT_ALLE} WHERE t.einsatz_id = ?1 AND t.storniert_at IS NULL \
         AND (?2 IS NULL OR t.status = ?2) \
         AND (?3 IS NULL OR t.spezies = ?3) \
         AND (?4 IS NULL OR t.halter_person_id = ?4) \
         ORDER BY t.registrier_nr DESC"
    );
    Ok(sqlx::query_as::<_, TierAnzeige>(sqlx::AssertSqlSafe(&*sql))
        .bind(einsatz_id)
        .bind(status)
        .bind(spezies)
        .bind(halter_person_id)
        .fetch_all(pool)
        .await?)
}

/// Lädt ein Tier (auch storniertes) eines Einsatzes; `NotFound`, falls es nicht
/// zu diesem Einsatz gehört (Org-Isolation).
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
) -> Result<TierAnzeige, AppError> {
    sqlx::query_as::<_, TierAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE t.id = ? AND t.einsatz_id = ?"
    )))
    .bind(tier_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Legt ein Tier an, vergibt `registrier_nr` atomar als
/// `COALESCE(MAX(registrier_nr),0)+1` je Einsatz (zählt stornierte mit — keine
/// Nummern-Wiederverwendung). `status` ∈ {`aktiv`, `vermisst`} (Route-validiert).
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    status: &str,
    daten: NeueDaten<'_>,
) -> Result<TierAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_tier \
            (einsatz_id, registrier_nr, status, spezies, rasse_beschreibung, rufname, \
             geschlecht, alter_geschaetzt, farbe_beschreibung, kennzeichnung, \
             groesse_gewicht, halter_person_id, halter_kontakt, antreff_ort, notiz, \
             erfasst_von, geaendert_von) \
         SELECT ?1, COALESCE(MAX(registrier_nr), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, \
                ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15 \
         FROM einsatz_tier WHERE einsatz_id = ?1 \
         RETURNING id",
    )
    .bind(einsatz_id)
    .bind(status)
    .bind(daten.spezies)
    .bind(daten.rasse_beschreibung)
    .bind(daten.rufname)
    .bind(daten.geschlecht)
    .bind(daten.alter_geschaetzt)
    .bind(daten.farbe_beschreibung)
    .bind(daten.kennzeichnung)
    .bind(daten.groesse_gewicht)
    .bind(daten.halter_person_id)
    .bind(daten.halter_kontakt)
    .bind(daten.antreff_ort)
    .bind(daten.notiz)
    .bind(erfasser_id)
    .fetch_one(pool)
    .await?;

    laden(pool, einsatz_id, id).await
}

/// Aktualisiert Stammfelder. Identitätsfelder via COALESCE (nur gesetzte);
/// Halter-Felder mit expliziter NULL-Semantik (für den FK↔Freitext-Toggle).
/// Setzt `geaendert_at`/`geaendert_von`. `NotFound`, falls nicht zum Einsatz.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    geaendert_von: i64,
    daten: PatchDaten<'_>,
) -> Result<TierAnzeige, AppError> {
    // Nur anonyme `?`-Platzhalter (Codebase-Idiom, wie person/uhs). Reihenfolge der
    // `.bind()`-Aufrufe = Reihenfolge der `?` im SQL. Die Halter-Felder nutzen ein
    // Flag (`is_some`) + Wert (`flatten`)-Paar, damit `Some(None)` → NULL setzt.
    let betroffen = sqlx::query(
        "UPDATE einsatz_tier SET \
            rasse_beschreibung = COALESCE(?, rasse_beschreibung), \
            rufname = COALESCE(?, rufname), \
            geschlecht = COALESCE(?, geschlecht), \
            alter_geschaetzt = COALESCE(?, alter_geschaetzt), \
            farbe_beschreibung = COALESCE(?, farbe_beschreibung), \
            kennzeichnung = COALESCE(?, kennzeichnung), \
            groesse_gewicht = COALESCE(?, groesse_gewicht), \
            antreff_ort = COALESCE(?, antreff_ort), \
            notiz = COALESCE(?, notiz), \
            halter_person_id = CASE WHEN ? THEN ? ELSE halter_person_id END, \
            halter_kontakt   = CASE WHEN ? THEN ? ELSE halter_kontakt END, \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.rasse_beschreibung)
    .bind(daten.rufname)
    .bind(daten.geschlecht)
    .bind(daten.alter_geschaetzt)
    .bind(daten.farbe_beschreibung)
    .bind(daten.kennzeichnung)
    .bind(daten.groesse_gewicht)
    .bind(daten.antreff_ort)
    .bind(daten.notiz)
    .bind(daten.halter_person_id.is_some())  // Flag: Halter-FK im Patch enthalten?
    .bind(daten.halter_person_id.flatten())  // Wert (oder NULL bei Some(None))
    .bind(daten.halter_kontakt.is_some())    // Flag: Halter-Kontakt im Patch enthalten?
    .bind(daten.halter_kontakt.flatten())    // Wert (oder NULL bei Some(None))
    .bind(geaendert_von)
    .bind(tier_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, tier_id).await
}

/// Setzt den Status (Übergangsvalidierung ist Handler-Aufgabe via
/// `darf_uebergehen`). **Beim Übergang `→ abgeschlossen` werden `abschluss_grund`
/// (Pflicht, Route-validiert) und `abschluss_ziel` (optional) im selben UPDATE
/// geschrieben — sonst verletzt der DB-CHECK.** Bei jedem anderen Zielzustand
/// bleiben die Abschluss-Felder unverändert (Audit-Spur des letzten Abschlusses).
/// `NotFound`, falls nicht zum Einsatz.
pub async fn setze_status(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    neuer_status: &str,
    abschluss_grund: Option<&str>,
    abschluss_ziel: Option<&str>,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = if neuer_status == "abgeschlossen" {
        sqlx::query(
            "UPDATE einsatz_tier SET status = ?, abschluss_grund = ?, abschluss_ziel = ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(neuer_status)
        .bind(abschluss_grund)
        .bind(abschluss_ziel)
        .bind(geaendert_von)
        .bind(tier_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
    } else {
        sqlx::query(
            "UPDATE einsatz_tier SET status = ?, \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(neuer_status)
        .bind(geaendert_von)
        .bind(tier_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
    };
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Soft-Delete (Fehleingabe): setzt `storniert_at`. Bleibt referenzierbar.
/// `NotFound`, falls nicht zum Einsatz.
pub async fn storniere(
    pool: &SqlitePool,
    einsatz_id: i64,
    tier_id: i64,
    geaendert_von: i64,
) -> Result<(), AppError> {
    let betroffen = sqlx::query(
        "UPDATE einsatz_tier SET storniert_at = strftime('%Y-%m-%d %H:%M:%S','now'), \
            geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(geaendert_von)
    .bind(tier_id)
    .bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use crate::tier::{AbschlussGrund, Spezies, TierStatus};
    use sqlx::SqlitePool;

    /// Minimal-Setup: eine Org, ein Benutzer, ein aktiver Einsatz. Liefert (benutzer_id, einsatz_id).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool).await.unwrap();
        let benutzer_id: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-29') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (benutzer_id, einsatz_id)
    }

    fn hund<'a>() -> NeueDaten<'a> {
        NeueDaten {
            spezies: "hund", rasse_beschreibung: None, rufname: None, geschlecht: None,
            alter_geschaetzt: None, farbe_beschreibung: None, kennzeichnung: None,
            groesse_gewicht: None, halter_person_id: None, halter_kontakt: None,
            antreff_ort: None, notiz: None,
        }
    }

    /// Legt eine Person an (Halter-FK-Ziel) und liefert ihre id.
    async fn person_anlegen(pool: &SqlitePool, einsatz_id: i64) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, (SELECT COALESCE(MAX(registrier_nr),0)+1 FROM einsatz_person WHERE einsatz_id = ?), 1, 1) \
             RETURNING id")
            .bind(einsatz_id).bind(einsatz_id).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn registrier_nr_ist_fortlaufend_und_zaehlt_stornierte_mit() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t1 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        assert_eq!(t1.registrier_nr, 1);
        assert_eq!(t1.status, TierStatus::Aktiv);
        storniere(&pool, e, t1.id, b).await.unwrap();
        let t2 = anlegen(&pool, e, b, "vermisst", hund()).await.unwrap();
        assert_eq!(t2.registrier_nr, 2, "Soft-Delete recycelt keine Nummern");
        assert_eq!(t2.status, TierStatus::Vermisst);
    }

    #[tokio::test]
    async fn liste_blendet_stornierte_aus_detail_zeigt_sie() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t1 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        storniere(&pool, e, t1.id, b).await.unwrap();
        let liste = liste(&pool, e, None, None, None).await.unwrap();
        assert!(liste.is_empty(), "storniertes Tier nicht in der Liste");
        let detail = laden(&pool, e, t1.id).await.unwrap();
        assert!(detail.storniert_at.is_some(), "Detail liefert storniertes Tier");
    }

    #[tokio::test]
    async fn liste_filtert_nach_status_und_spezies() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        anlegen(&pool, e, b, "aktiv", NeueDaten { spezies: "katze", ..hund() }).await.unwrap();
        let t3 = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        setze_status(&pool, e, t3.id, "vermisst", None, None, b).await.unwrap();

        let vermisste = liste(&pool, e, Some("vermisst"), None, None).await.unwrap();
        assert_eq!(vermisste.len(), 1);
        let katzen = liste(&pool, e, None, Some("katze"), None).await.unwrap();
        assert_eq!(katzen.len(), 1);
        assert_eq!(katzen[0].spezies, Spezies::Katze);
    }

    #[tokio::test]
    async fn liste_sortiert_neueste_oben() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap(); // nr 1
        anlegen(&pool, e, b, "aktiv", hund()).await.unwrap(); // nr 2
        let liste = liste(&pool, e, None, None, None).await.unwrap();
        assert_eq!(liste[0].registrier_nr, 2, "neueste oben (DESC)");
        assert_eq!(liste[1].registrier_nr, 1);
    }

    #[tokio::test]
    async fn halter_fk_wird_aufgeloest_und_join_felder_gesetzt() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let halter = person_anlegen(&pool, e).await;
        let t = anlegen(&pool, e, b, "aktiv", NeueDaten { halter_person_id: Some(halter), ..hund() }).await.unwrap();
        assert_eq!(t.halter_person_id, Some(halter));
        assert_eq!(t.halter_registrier_nr, Some(1), "Join löst R-Nr des Halters auf");
        assert!(t.halter_storniert_at.is_none());

        // Halter-Person soft-löschen → FK bleibt zulässig, Join löst weiterhin auf.
        sqlx::query("UPDATE einsatz_person SET storniert_at = '2026-05-29 10:00:00' WHERE id = ?")
            .bind(halter).execute(&pool).await.unwrap();
        let nachher = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(nachher.halter_person_id, Some(halter), "Tier-Datensatz unverändert");
        assert!(nachher.halter_storniert_at.is_some(), "Join zeigt storniert");
    }

    #[tokio::test]
    async fn patch_toggle_fk_zu_freitext() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let halter = person_anlegen(&pool, e).await;
        let t = anlegen(&pool, e, b, "aktiv", NeueDaten { halter_person_id: Some(halter), ..hund() }).await.unwrap();
        // FK → Freitext: FK auf NULL, Kontakt setzen.
        let nachher = aktualisiere(&pool, e, t.id, b, PatchDaten {
            halter_person_id: Some(None),
            halter_kontakt: Some(Some("Frau Müller, 0170-123")),
            ..PatchDaten::default()
        }).await.unwrap();
        assert!(nachher.halter_person_id.is_none());
        assert_eq!(nachher.halter_kontakt.as_deref(), Some("Frau Müller, 0170-123"));
        assert!(nachher.halter_registrier_nr.is_none(), "kein FK → kein Join-Ergebnis");
    }

    #[tokio::test]
    async fn abschluss_schreibt_grund_im_selben_update() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        // Ohne abschluss_grund würde der DB-CHECK verletzt → wir übergeben ihn.
        setze_status(&pool, e, t.id, "abgeschlossen", Some("uebergabe_tierarzt"), Some("Tierarzt Müller"), b).await.unwrap();
        let nachher = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(nachher.status, TierStatus::Abgeschlossen);
        assert_eq!(nachher.abschluss_grund, Some(AbschlussGrund::UebergabeTierarzt));
        assert_eq!(nachher.abschluss_ziel.as_deref(), Some("Tierarzt Müller"));

        // Korrektur zurück → Status ändert sich, Abschluss-Felder bleiben.
        setze_status(&pool, e, t.id, "aktiv", None, None, b).await.unwrap();
        let korrigiert = laden(&pool, e, t.id).await.unwrap();
        assert_eq!(korrigiert.status, TierStatus::Aktiv);
        assert_eq!(korrigiert.abschluss_grund, Some(AbschlussGrund::UebergabeTierarzt),
            "Abschluss-Grund bleibt als Audit-Spur erhalten");
    }

    #[tokio::test]
    async fn laden_fremder_einsatz_ist_notfound() {
        let pool = test_pool().await;
        let (b, e) = setup(&pool).await;
        let t = anlegen(&pool, e, b, "aktiv", hund()).await.unwrap();
        let err = laden(&pool, 999, t.id).await.unwrap_err();
        assert!(matches!(err, AppError::NotFound));
    }
}

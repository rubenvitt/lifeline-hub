use super::{repo, BrBelegungAnzeige, BrBelegungsArt, ObjektTyp};
use crate::error::AppError;
use sqlx::{Sqlite, SqlitePool, Transaction};

const SELECT_ALLE: &str = "\
    SELECT id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, erfasst_von \
    FROM br_belegung";

/// Bucht ein Objekt (Einheit oder Fahrzeug) in einen Bereitstellungsraum ein,
/// aus einem wechselt oder aus einem aus. Alle Vorab-Checks, Event-Insert und
/// Cache-Update laufen in EINER Transaktion.
///
/// # Regeln (in Reihenfolge)
/// 1. `objekt_typ` unbekannt → `Validation`
/// 2. `art` unbekannt → `Validation`
/// 3. Ziel-BR muss `aktiv` sein (via `repo::laden`) → `NotFound` oder `UnprocessableEntity`
/// 4. Objekt muss im selben Einsatz existieren → `NotFound`
/// 5. `fahrzeug`: `einheit_id` nicht NULL → `Conflict`
/// 6. Art-Vorbedingung: `eintritt` → `aktueller_br_id` muss NULL; `wechsel`/`austritt` → muss gesetzt sein
/// 7. Event-Insert + Cache-Update in Tx
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
    // 1. Objekt-Typ parsen
    let typ = ObjektTyp::parse(objekt_typ)
        .ok_or_else(|| AppError::Validation(format!("Unbekannter objekt_typ: '{objekt_typ}'")))?;

    // 2. Art parsen
    let belegungs_art = BrBelegungsArt::parse(art)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte art: '{art}'")))?;

    // 3. Ziel-BR laden und auf aktiv prüfen (nutzt pool direkt, vor Tx).
    // `repo::laden` liefert auch stornierte BRs; ein stornierter BR behält
    // `status='aktiv'` (storniere setzt nur storniert_at), daher zusätzlich
    // `storniert_at IS NULL` fordern — analog UHS (`pruefe_uhs_aktiv`).
    let br = repo::laden(pool, einsatz_id, br_id).await?;
    if br.status != "aktiv" || br.storniert_at.is_some() {
        return Err(AppError::UnprocessableEntity(format!(
            "Bereitstellungsraum hat Status '{}' — Belegung nur bei aktivem BR möglich",
            br.status
        )));
    }

    // 4-7: read-then-write-Atomizität in einer Transaktion
    let mut tx = pool.begin().await?;

    let event_id = match typ {
        ObjektTyp::Einheit => {
            belege_einheit(
                &mut tx,
                einsatz_id,
                br_id,
                objekt_id,
                belegungs_art,
                notiz,
                benutzer_id,
            )
            .await?
        }
        ObjektTyp::Fahrzeug => {
            belege_fahrzeug(
                &mut tx,
                einsatz_id,
                br_id,
                objekt_id,
                belegungs_art,
                notiz,
                benutzer_id,
            )
            .await?
        }
    };

    tx.commit().await?;
    laden(pool, einsatz_id, event_id).await
}

/// Belegungs-Verlauf eines BR (neueste zuerst).
pub async fn liste_je_br(
    pool: &SqlitePool,
    br_id: i64,
) -> Result<Vec<BrBelegungAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, BrBelegungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ALLE} WHERE br_id = ? ORDER BY zeitpunkt_at DESC, id DESC"
    )))
    .bind(br_id)
    .fetch_all(pool)
    .await?)
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

// ─── Interne Helpers ────────────────────────────────────────────────────────

async fn belege_einheit(
    tx: &mut Transaction<'_, Sqlite>,
    einsatz_id: i64,
    br_id: i64,
    objekt_id: i64,
    art: BrBelegungsArt,
    notiz: Option<&str>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    // 4. Objekt-Existenz + aktueller_br_id in derselben Tx lesen
    let cache: Option<Option<i64>> = sqlx::query_scalar(
        "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(objekt_id)
    .bind(einsatz_id)
    .fetch_optional(&mut **tx)
    .await?;

    let aktueller_br_id = cache.ok_or(AppError::NotFound)?;

    // 6. Art-Vorbedingung
    pruefe_art_vorbedingung(&art, aktueller_br_id, br_id)?;

    // 7a. Event-Insert
    let event_id = insert_event(
        tx,
        einsatz_id,
        br_id,
        ObjektTyp::Einheit,
        objekt_id,
        &art,
        notiz,
        benutzer_id,
    )
    .await?;

    // 7b. Cache aktualisieren
    let neuer_br_id = cache_nach_art(&art, br_id);
    sqlx::query(
        "UPDATE einsatz_einheit SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_br_id)
    .bind(objekt_id)
    .bind(einsatz_id)
    .execute(&mut **tx)
    .await?;

    Ok(event_id)
}

async fn belege_fahrzeug(
    tx: &mut Transaction<'_, Sqlite>,
    einsatz_id: i64,
    br_id: i64,
    objekt_id: i64,
    art: BrBelegungsArt,
    notiz: Option<&str>,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    // 4 + 5. Objekt-Existenz, einheit_id (Einheit-bringt-Fahrzeuge-Regel) + aktueller_br_id
    let row: Option<(Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT einheit_id, aktueller_br_id FROM einsatz_fahrzeug WHERE id = ? AND einsatz_id = ?",
    )
    .bind(objekt_id)
    .bind(einsatz_id)
    .fetch_optional(&mut **tx)
    .await?;

    let (einheit_id, aktueller_br_id) = row.ok_or(AppError::NotFound)?;

    // 5. Einheit-bringt-Fahrzeuge: Fahrzeug mit einheit_id ist blockiert
    if einheit_id.is_some() {
        return Err(AppError::Conflict(
            "Fahrzeug gehört einer Einheit — Belegung nur für einheitenlose Fahrzeuge möglich"
                .into(),
        ));
    }

    // 6. Art-Vorbedingung
    pruefe_art_vorbedingung(&art, aktueller_br_id, br_id)?;

    // 7a. Event-Insert
    let event_id = insert_event(
        tx,
        einsatz_id,
        br_id,
        ObjektTyp::Fahrzeug,
        objekt_id,
        &art,
        notiz,
        benutzer_id,
    )
    .await?;

    // 7b. Cache aktualisieren
    let neuer_br_id = cache_nach_art(&art, br_id);
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET aktueller_br_id = ? WHERE id = ? AND einsatz_id = ?",
    )
    .bind(neuer_br_id)
    .bind(objekt_id)
    .bind(einsatz_id)
    .execute(&mut **tx)
    .await?;

    Ok(event_id)
}

/// Prüft die Art-Vorbedingung (Annahme 4 der Spec):
/// - eintritt: aktueller_br_id muss NULL sein
/// - wechsel / austritt: aktueller_br_id muss gesetzt sein
/// - austritt zusätzlich: der übergebene `br_id` muss dem `aktueller_br_id` des
///   Objekts entsprechen — sonst trägt das Event eine falsche br_id (ETB-Text
///   „verlässt BR X" wäre falsch). Bei Mismatch `Conflict`.
fn pruefe_art_vorbedingung(
    art: &BrBelegungsArt,
    aktueller_br_id: Option<i64>,
    br_id: i64,
) -> Result<(), AppError> {
    match art {
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
        BrBelegungsArt::Eintritt | BrBelegungsArt::Wechsel => Some(br_id),
        BrBelegungsArt::Austritt => None,
    }
}

async fn insert_event(
    tx: &mut Transaction<'_, Sqlite>,
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
    .fetch_one(&mut **tx)
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
        let br = br_repo::anlegen(
            pool,
            einsatz_id,
            benutzer_id,
            br_repo::NeueDaten {
                bezeichnung: bez,
                abschnitt_id: None,
                standort: None,
                notiz: None,
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
        assert_eq!(ev.art, "eintritt");
        assert_eq!(ev.objekt_typ, "einheit");
        assert_eq!(ev.objekt_id, einheit);
        assert_eq!(ev.br_id, br);
        assert_eq!(cache_einheit(&pool, einheit).await, Some(br));
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
        assert_eq!(ev.art, "wechsel");
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
        assert_eq!(br_repo::aktive_belegungen(&pool, br).await.unwrap(), 1);

        let ev = belege(&pool, e, br, "einheit", einheit, "austritt", None, b)
            .await
            .unwrap();
        assert_eq!(ev.art, "austritt");
        assert_eq!(cache_einheit(&pool, einheit).await, None);

        // WICHTIG: nach Austritt muss BR auflösbar sein
        assert_eq!(br_repo::aktive_belegungen(&pool, br).await.unwrap(), 0);
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
        assert_eq!(ev.art, "eintritt");
        assert_eq!(ev.objekt_typ, "fahrzeug");
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
        assert_eq!(br_repo::aktive_belegungen(&pool, br).await.unwrap(), 0);
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
        let br = br_repo::anlegen(
            &pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: "BR Geplant",
                abschnitt_id: None,
                standort: None,
                notiz: None,
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

    #[tokio::test]
    async fn liste_je_br_gibt_neueste_zuerst() {
        let pool = test_pool().await;
        let (b, e) = basis_setup(&pool).await;
        let br = aktiven_br(&pool, e, b, "BR Liste").await;
        let br2 = aktiven_br(&pool, e, b, "BR 2").await;
        let einheit = neue_einheit(&pool, e).await;

        belege(&pool, e, br, "einheit", einheit, "eintritt", None, b)
            .await
            .unwrap();
        belege(&pool, e, br2, "einheit", einheit, "wechsel", None, b)
            .await
            .unwrap();

        let liste = liste_je_br(&pool, br).await.unwrap();
        assert_eq!(liste.len(), 1, "nur Events für br, nicht br2");
        assert_eq!(liste[0].art, "eintritt");

        let liste2 = liste_je_br(&pool, br2).await.unwrap();
        assert_eq!(liste2.len(), 1);
        assert_eq!(liste2[0].art, "wechsel");
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
}

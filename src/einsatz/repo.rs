use super::berechtigung::darf_lesen;
use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, EinsatzStatus, Einsatzart, MitgliedAnzeige,
    EINSATZ_ROLLE_LEITUNG, STATUS_ABGESCHLOSSEN,
};
use crate::auth::Benutzer;
use crate::error::AppError;
use chrono::Utc;
use sqlx::SqlitePool;

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    // Single-Org in T1: alle Einsätze gehören zur (einzigen) Organisation.
    let org_id: i64 = sqlx::query_scalar("SELECT id FROM organisation ORDER BY id LIMIT 1")
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Internal("Keine Organisation vorhanden".into()))?;

    let mut tx = pool.begin().await?;

    // Einsatznummer JJJJ-NNN: NNN je Organisation + Jahr fortlaufend, 3-stellig.
    // 'JJJJ-' ist 5 Zeichen lang → substr(..., 6) liefert den NNN-Teil.
    // Race-frei: WAL serialisiert Writer; der Unique-Index sichert zusätzlich ab.
    let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
        .fetch_one(&mut *tx)
        .await?;
    let praefix = format!("{jahr}-");
    let max_nr: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(CAST(substr(einsatznummer_intern, 6) AS INTEGER)) \
         FROM einsatz WHERE org_id = ? AND einsatznummer_intern LIKE ?",
    )
    .bind(org_id)
    .bind(format!("{praefix}%"))
    .fetch_one(&mut *tx)
    .await?;
    let einsatznummer = format!("{praefix}{:03}", max_nr.unwrap_or(0) + 1);

    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, stichwort, einsatznummer_intern, angelegt_at) \
         VALUES (?, ?, ?, ?, datetime('now')) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(stichwort)
    .bind(&einsatznummer)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    laden(pool, einsatz_id).await
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    sqlx::query_as::<_, Einsatz>(
        "SELECT e.id, e.org_id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.geloescht_at, \
                o.name AS org_name \
         FROM einsatz e \
         LEFT JOIN organisation o ON o.id = e.org_id \
         WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Liefert die Einsatz-Rolle eines Benutzers in einem Einsatz (`None` = kein Mitglied).
pub async fn rolle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<EinsatzRolle>, AppError> {
    let rolle: Option<String> = sqlx::query_scalar(
        "SELECT einsatz_rolle FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(rolle.and_then(|s| EinsatzRolle::parse(&s)))
}

/// Alle für den Benutzer lesbaren Einsätze, annotiert mit dessen Rolle
/// (`meine_rolle`). Die DSGVO-Lese-Policy (`darf_lesen`) filtert Einsätze,
/// die der Benutzer nicht sehen darf, vor der Rückgabe heraus.
pub async fn liste_fuer(
    pool: &SqlitePool,
    benutzer: &Benutzer,
) -> Result<Vec<EinsatzAnzeige>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Row {
        id: i64,
        org_id: i64,
        org_name: String,
        bezeichnung: String,
        stichwort: Option<String>,
        #[sqlx(try_from = "String")]
        status: EinsatzStatus,
        begonnen_at: String,
        abgeschlossen_at: Option<String>,
        abgeschlossen_von: Option<i64>,
        #[sqlx(try_from = "String")]
        einsatzart: Einsatzart,
        einsatznummer_intern: Option<String>,
        angelegt_at: String,
        leitstellen_nr: Option<String>,
        einsatzort: Option<String>,
        einsatzort_lat: Option<f64>,
        einsatzort_lon: Option<f64>,
        meldende_stelle: Option<String>,
        sachverhalt: Option<String>,
        anzahl_betroffene_initial: Option<i64>,
        retention_bis: Option<String>,
        geloescht_at: Option<String>,
        meine_rolle: Option<String>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.org_id, o.name AS org_name, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.geloescht_at, \
                m.einsatz_rolle AS meine_rolle \
         FROM einsatz e \
         LEFT JOIN organisation o ON o.id = e.org_id \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer.id)
    .fetch_all(pool)
    .await?;

    let jetzt = Utc::now();
    Ok(rows
        .into_iter()
        .filter(|r| {
            darf_lesen(
                benutzer,
                r.org_id,
                r.status.as_str(),
                r.abgeschlossen_at.as_deref(),
                r.retention_bis.as_deref(),
                r.geloescht_at.as_deref(),
                r.meine_rolle.as_deref().and_then(EinsatzRolle::parse),
                jetzt,
            )
        })
        .map(|r| EinsatzAnzeige {
            id: r.id,
            org_id: r.org_id,
            org_name: r.org_name,
            bezeichnung: r.bezeichnung,
            stichwort: r.stichwort,
            status: r.status,
            begonnen_at: r.begonnen_at,
            abgeschlossen_at: r.abgeschlossen_at,
            abgeschlossen_von: r.abgeschlossen_von,
            einsatzart: r.einsatzart,
            einsatznummer_intern: r.einsatznummer_intern,
            angelegt_at: r.angelegt_at,
            leitstellen_nr: r.leitstellen_nr,
            einsatzort: r.einsatzort,
            einsatzort_lat: r.einsatzort_lat,
            einsatzort_lon: r.einsatzort_lon,
            meldende_stelle: r.meldende_stelle,
            sachverhalt: r.sachverhalt,
            anzahl_betroffene_initial: r.anzahl_betroffene_initial,
            retention_bis: r.retention_bis,
            meine_rolle: r.meine_rolle,
        })
        .collect())
}

/// Schließt einen Einsatz ab (nur wenn aktuell `aktiv`) und lädt ihn neu.
/// Das `status = 'aktiv'`-Prädikat im WHERE schützt gegen Races; die fachliche
/// 409-Prüfung erfolgt zusätzlich im Handler.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    von_benutzer_id: i64,
) -> Result<Einsatz, AppError> {
    // Dauer-Politik vor der tx laden (eigener Pool-Borrow); steuert die Auto-Befüllung.
    let einstellungen = super::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_id: Option<i64> = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let org_einstellungen =
        crate::org::einstellungen::laden_oder_default(pool, org_id.unwrap_or(0)).await?;

    let mut tx = pool.begin().await?;
    let ergebnis = sqlx::query(
        "UPDATE einsatz \
         SET status = ?, abgeschlossen_at = datetime('now'), abgeschlossen_von = ? \
         WHERE id = ? AND status = 'aktiv'",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(von_benutzer_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    // Auto-Befüllung der Aufbewahrungsfrist NUR, wenn dieser Aufruf den Einsatz
    // tatsächlich abgeschlossen hat (rows_affected == 1, nicht ein Re-Close-No-Op),
    // eine Dauer-Politik gesetzt ist UND noch keine Frist existiert. Letzteres
    // schützt eine manuell gesetzte Frist (überschreibt nie). Setzt direkt im
    // Abschluss-tx, NICHT über frist_setzen — der Verkürzungs-Gate (None→Some)
    // würde das sonst als bestätigungspflichtige Verkürzung werten (LFH-135).
    if ergebnis.rows_affected() == 1 {
        if let Some(dauer) =
            super::effektiv::effektive_retention_dauer_tage(&einstellungen, &org_einstellungen)
        {
            let (abgeschlossen_at, retention_bis): (Option<String>, Option<String>) =
                sqlx::query_as("SELECT abgeschlossen_at, retention_bis FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if retention_bis.is_none() {
                if let Some(neue_frist) = abgeschlossen_at
                    .as_deref()
                    .and_then(|a| super::retention::berechne_retention_bis(a, dauer))
                {
                    sqlx::query(
                        "UPDATE einsatz SET retention_bis = ? WHERE id = ? AND retention_bis IS NULL",
                    )
                    .bind(&neue_frist)
                    .bind(einsatz_id)
                    .execute(&mut *tx)
                    .await?;
                    let audit = format!(
                        "Aufbewahrungsfrist automatisch gesetzt auf {neue_frist} \
                         (Aufbewahrungs-Dauer {dauer} Tage ab Abschluss)"
                    );
                    crate::etb::repo::anlegen_tx(
                        &mut tx,
                        einsatz_id,
                        von_benutzer_id,
                        einstellungen.etb_startwert(),
                        crate::etb::repo::EintragDaten {
                            typ: crate::etb::TYP_SYSTEM,
                            inhalt: &audit,
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
                }
            }
        }
    }
    tx.commit().await?;
    laden(pool, einsatz_id).await
}

/// Setzt die Aufbewahrungsfrist (`retention_bis`) eines Einsatzes und schreibt in
/// derselben Transaktion einen ETB-System-Eintrag als Audit (LFH-130, ETB-Kopplung
/// Pattern B). `neue_frist = None` hebt die Frist auf (unbegrenzt). Der Audit-Text
/// wird vom Aufrufer gebildet (er kennt alten/neuen Wert). Die Verkürzungs-
/// Bestätigung ist Sache des Handlers.
pub async fn frist_setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    erfasser_id: i64,
    neue_frist: Option<&str>,
    audit_inhalt: &str,
) -> Result<Einsatz, AppError> {
    let etb_startwert = super::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz SET retention_bis = ? WHERE id = ?")
        .bind(neue_frist)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;
    crate::etb::repo::anlegen_tx(
        &mut tx,
        einsatz_id,
        erfasser_id,
        etb_startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt: audit_inhalt,
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
    tx.commit().await?;
    laden(pool, einsatz_id).await
}

// ---------- Aufbewahrung / Purge (LFH-135) ----------

/// Ermittelt einen gültigen Benutzer als Akteur für System-ETB-Einträge des
/// Purge-Schedulers (`erfasser_id` ist NOT NULL FK). Bevorzugt, wer den Einsatz
/// abgeschlossen hat; ersatzweise eine Einsatzleitung. `None`, wenn keiner
/// auffindbar ist (dann wird der ETB-Audit übersprungen, die Mutation läuft
/// trotzdem). Läuft auf der übergebenen tx-Verbindung.
async fn ermittle_system_akteur(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<i64>, AppError> {
    let von: Option<i64> = sqlx::query_scalar(
        "SELECT abgeschlossen_von FROM einsatz WHERE id = ? AND abgeschlossen_von IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    if von.is_some() {
        return Ok(von);
    }
    let leit: Option<i64> = sqlx::query_scalar(
        "SELECT benutzer_id FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ? ORDER BY benutzer_id LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(leit)
}

/// Schreibt einen System-ETB-Audit auf der tx-Verbindung, sofern ein Akteur
/// auffindbar ist (best effort — fehlt jeder Benutzer, wird nur geloggt). Der
/// Startwert kommt aus den Einstellungen (Nummernkreis), `inhalt` ist der Audit-Text.
async fn system_audit_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    etb_startwert: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    let Some(akteur) = ermittle_system_akteur(conn, einsatz_id).await? else {
        tracing::warn!(
            einsatz_id,
            "Purge: kein Benutzer als ETB-Akteur auffindbar — System-Audit übersprungen"
        );
        return Ok(());
    };
    crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        akteur,
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

/// IDs ABGESCHLOSSENER Einsätze, deren Aufbewahrungsfrist abgelaufen ist und die
/// noch nicht soft-gelöscht sind (Phase-A-Kandidaten). `status='abgeschlossen'`
/// ist hart im WHERE — aktive Einsätze sind NIE fällig. Lexikografischer
/// Zeitvergleich (kanonisches Format). Org-isoliert über die `einsatz`-Tabelle.
pub async fn faellige_soft_delete(pool: &SqlitePool, jetzt: &str) -> Result<Vec<i64>, AppError> {
    let ids = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM einsatz \
         WHERE status = ? AND retention_bis IS NOT NULL \
           AND ? >= retention_bis AND geloescht_at IS NULL \
         ORDER BY id",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// Setzt den Soft-Delete-Tombstone (`geloescht_at`) eines fälligen Einsatzes und
/// schreibt einen System-ETB-Audit in derselben Transaktion. Idempotent über den
/// `geloescht_at IS NULL`-Guard: ein bereits soft-gelöschter Einsatz liefert
/// `false` (kein Doppel-Audit). Reversibel (Karenz vor der Schwärzung).
pub async fn soft_delete_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;
    let res = sqlx::query(
        "UPDATE einsatz SET geloescht_at = ? \
         WHERE id = ? AND status = ? AND geloescht_at IS NULL",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        // Nichts zu tun (schon soft-gelöscht oder nicht abgeschlossen) — kein Audit.
        return Ok(false);
    }
    system_audit_tx(
        &mut tx,
        einsatz_id,
        etb_startwert,
        "Aufbewahrungsfrist abgelaufen — Einsatz zur Löschung vorgemerkt (Soft-Delete). \
         Die Karenz bis zur unwiderruflichen PII-Schwärzung läuft.",
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

/// Platzhalter für gescrubbte PII-Felder, die wegen NOT-NULL- bzw. CHECK-Constraints
/// nicht auf NULL gesetzt werden dürfen (verlaufsnotiz.text, einsatz_personal.snap_name,
/// einsatz_schaden.uebergeben_an bei status='uebergeben').
pub const SCHWAERZUNG_PLATZHALTER: &str = "[geschwärzt]";

/// Phase-B-Kandidaten: ABGESCHLOSSENE, soft-gelöschte, noch nicht geschwärzte
/// Einsätze, als `(id, geloescht_at)`. Die Karenz-Grenze (`geloescht_at + KARENZ_TAGE`)
/// prüft der Aufrufer in Rust (`retention::karenz_abgelaufen`) gegen das injizierte
/// `jetzt`. `status='abgeschlossen'` ist hart im WHERE — aktive Einsätze sind nie dabei.
pub async fn faellige_purge(
    pool: &SqlitePool,
    _karenz_tage: i64,
) -> Result<Vec<(i64, String)>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, geloescht_at FROM einsatz \
         WHERE status = ? AND geloescht_at IS NOT NULL AND geschwaerzt_at IS NULL \
         ORDER BY id",
    )
    .bind(STATUS_ABGESCHLOSSEN)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// IRREVERSIBLE PII-Schwärzung eines Einsatzes (Phase B, LFH-135). Scrubbt die
/// Personendaten in allen einsatz-scoped PII-Tabellen (strikt per `einsatz_id`,
/// OHNE `storniert_at`-Filter — auch stornierte Zeilen tragen reale PII), setzt den
/// `geschwaerzt_at`-Tombstone und schreibt einen System-ETB-Audit — alles in EINER
/// Transaktion (partieller Scrub rollt zurück). Das operative Skelett (Einsatz, ETB,
/// Zähler/registrier_nr, aggregierte Lage) bleibt erhalten.
///
/// Idempotent: der `geschwaerzt_at IS NULL`-Guard liefert `false`, wenn der Einsatz
/// schon geschwärzt (oder nicht soft-gelöscht/abgeschlossen) ist — kein Doppel-Scrub.
///
/// Gescrubbte Tabellen/Spalten (siehe Commit-Message für die vollständige Begründung):
/// - einsatz_person: name, vorname, geschlecht, geburtsdatum, alter_geschaetzt,
///   herkunft_adresse, antreff_ort, melder_kontakt, notiz
/// - person_sichtung: notiz · person_verlaufsnotiz: text (→ Platzhalter, NOT NULL)
/// - person_verbleib: ziel, notiz · person_uhs_belegung: notiz
/// - einsatz_tier: halter_kontakt, antreff_ort, abschluss_ziel, notiz
/// - einsatz_schaden: geschaedigt_kontakt, uebergeben_an (→ Platzhalter wenn gesetzt,
///   wegen CHECK status='uebergeben' ⇒ uebergeben_an NOT NULL)
/// - einsatz_personal (NUR Ad-hoc-extern, personal_id IS NULL): snap_name (→ Platzhalter),
///   snap_funktion, snap_traegerorganisation, bemerkung
pub async fn schwaerze_einsatz(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
) -> Result<bool, AppError> {
    let etb_startwert = super::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let mut tx = pool.begin().await?;

    // Idempotenz-/Sicherheits-Guard: nur abgeschlossene, soft-gelöschte, noch nicht
    // geschwärzte Einsätze. Setzt zugleich den Tombstone. rows_affected==0 → fertig.
    let res = sqlx::query(
        "UPDATE einsatz SET geschwaerzt_at = ? \
         WHERE id = ? AND status = ? AND geloescht_at IS NOT NULL AND geschwaerzt_at IS NULL",
    )
    .bind(jetzt)
    .bind(einsatz_id)
    .bind(STATUS_ABGESCHLOSSEN)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }

    // --- PII-Scrub (strikt per einsatz_id, KEIN storniert_at-Filter) ---
    // aktueller_verbleib (denormalisierter Cache, Migration 0022) trägt für
    // Transporte den Klartext "Transport → {ziel}" (Klinikname). Muss mit
    // gescrubbt werden, sonst überlebt der Verbringungsort die irreversible
    // Schwärzung, obwohl person_verbleib.ziel genullt wird (Review LFH-135).
    sqlx::query(
        "UPDATE einsatz_person SET \
            name = NULL, vorname = NULL, geschlecht = NULL, geburtsdatum = NULL, \
            alter_geschaetzt = NULL, herkunft_adresse = NULL, antreff_ort = NULL, \
            melder_kontakt = NULL, notiz = NULL, aktueller_verbleib = NULL \
         WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE person_sichtung SET notiz = NULL WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;

    // text ist NOT NULL → Platzhalter statt NULL.
    sqlx::query("UPDATE person_verlaufsnotiz SET text = ? WHERE einsatz_id = ?")
        .bind(SCHWAERZUNG_PLATZHALTER)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE person_verbleib SET ziel = NULL, notiz = NULL WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE person_uhs_belegung SET notiz = NULL WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;

    // kennzeichnung (Chip-Nr./Tätowierung) ist ein im Haustierregister auf den
    // Halter registrierter, eindeutiger Identifikator → personenverknüpfend, muss
    // mit gescrubbt werden (Review LFH-135). rufname/rasse/farbe/groesse bleiben
    // (reine Tierbeschreibung).
    sqlx::query(
        "UPDATE einsatz_tier SET \
            halter_kontakt = NULL, antreff_ort = NULL, abschluss_ziel = NULL, \
            notiz = NULL, kennzeichnung = NULL \
         WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    // uebergeben_an: NULL bleibt NULL, ein gesetzter Wert → Platzhalter (CHECK
    // status='uebergeben' ⇒ uebergeben_an IS NOT NULL würde sonst brechen).
    sqlx::query(
        "UPDATE einsatz_schaden SET \
            geschaedigt_kontakt = NULL, \
            uebergeben_an = CASE WHEN uebergeben_an IS NULL THEN NULL ELSE ? END \
         WHERE einsatz_id = ?",
    )
    .bind(SCHWAERZUNG_PLATZHALTER)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    // einsatz_personal: NUR Ad-hoc-externe (personal_id IS NULL) sind einsatz-scoped PII.
    // Dispositionen echter Stamm-Kräfte (personal_id gesetzt) sind Stammdaten → unberührt.
    // snap_name ist NOT NULL → Platzhalter.
    sqlx::query(
        "UPDATE einsatz_personal SET \
            snap_name = ?, snap_funktion = NULL, snap_traegerorganisation = NULL, bemerkung = NULL \
         WHERE einsatz_id = ? AND personal_id IS NULL",
    )
    .bind(SCHWAERZUNG_PLATZHALTER)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;

    // Bild-Hintergründe (LFH-35): Dateiname kann PII tragen → Platzhalter; BLOB bleibt (Kartografie).
    sqlx::query("UPDATE karte_hintergrundbild SET name = ? WHERE einsatz_id = ?")
        .bind(SCHWAERZUNG_PLATZHALTER)
        .bind(einsatz_id)
        .execute(&mut *tx)
        .await?;

    system_audit_tx(
        &mut tx,
        einsatz_id,
        etb_startwert,
        "PII-Schwärzung durchgeführt (Aufbewahrungsfrist + Karenz abgelaufen). \
         Personenbezogene Daten wurden unwiderruflich entfernt; das operative Skelett \
         (Einsatz, ETB-Einträge, Zähler) bleibt für die gesetzliche/statistische \
         Aufbewahrung erhalten.",
    )
    .await?;

    tx.commit().await?;
    tracing::warn!(
        einsatz_id,
        "Purge Phase B abgeschlossen: PII geschwärzt (geschwaerzt_at gesetzt)"
    );
    Ok(true)
}

/// Editierbare Kopffelder für `aktualisiere_kopf`. Optional-Strings sind bereits
/// vom Handler getrimmt; leere Werte werden als `None` übergeben (→ NULL).
#[derive(Debug)]
pub struct KopfDaten<'a> {
    pub bezeichnung: &'a str,
    pub stichwort: Option<&'a str>,
    pub einsatzart: &'a str,
    pub einsatznummer_intern: Option<&'a str>,
    pub leitstellen_nr: Option<&'a str>,
    pub einsatzort: Option<&'a str>,
    pub einsatzort_lat: Option<f64>,
    pub einsatzort_lon: Option<f64>,
    pub meldende_stelle: Option<&'a str>,
    pub sachverhalt: Option<&'a str>,
    pub anzahl_betroffene_initial: Option<i64>,
    /// Bereits ins DB-Format normalisierte Alarmzeit.
    pub begonnen_at: &'a str,
}

/// Vollersatz der editierbaren Kopf-Spalten (ein atomares Speichern).
/// Nicht-editierbare Spalten (status, abgeschlossen_*, angelegt_at, org_id, id)
/// bleiben unberührt. Ein Verstoß gegen den Einsatznummer-Unique-Index ergibt
/// `Conflict` (409).
pub async fn aktualisiere_kopf(
    pool: &SqlitePool,
    einsatz_id: i64,
    daten: KopfDaten<'_>,
) -> Result<Einsatz, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einsatz SET \
            bezeichnung = ?, stichwort = ?, einsatzart = ?, einsatznummer_intern = ?, \
            leitstellen_nr = ?, einsatzort = ?, einsatzort_lat = ?, einsatzort_lon = ?, \
            meldende_stelle = ?, sachverhalt = ?, anzahl_betroffene_initial = ?, begonnen_at = ? \
         WHERE id = ?",
    )
    .bind(daten.bezeichnung)
    .bind(daten.stichwort)
    .bind(daten.einsatzart)
    .bind(daten.einsatznummer_intern)
    .bind(daten.leitstellen_nr)
    .bind(daten.einsatzort)
    .bind(daten.einsatzort_lat)
    .bind(daten.einsatzort_lon)
    .bind(daten.meldende_stelle)
    .bind(daten.sachverhalt)
    .bind(daten.anzahl_betroffene_initial)
    .bind(daten.begonnen_at)
    .bind(einsatz_id)
    .execute(pool)
    .await;

    if let Err(sqlx::Error::Database(db_err)) = &ergebnis {
        if db_err.is_unique_violation() {
            return Err(AppError::Conflict(
                "Einsatznummer ist in dieser Organisation bereits vergeben".into(),
            ));
        }
    }
    ergebnis?;

    laden(pool, einsatz_id).await
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at \
         FROM einsatz_mitgliedschaft m \
         JOIN benutzer b ON b.id = m.benutzer_id \
         WHERE m.einsatz_id = ? \
         ORDER BY m.zugewiesen_at, m.benutzer_id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

/// Setzt (oder aktualisiert) die Einsatz-Rolle eines Benutzers in einem Einsatz.
pub async fn setze_rolle(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?) \
         ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET einsatz_rolle = excluded.einsatz_rolle",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Entfernt eine Mitgliedschaft (idempotent).
pub async fn entferne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?")
        .bind(einsatz_id)
        .bind(benutzer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Anzahl der Einsatzleitungen in einem Einsatz (für den „letzte Leitung"-Schutz).
pub async fn zaehle_einsatzleitung(pool: &SqlitePool, einsatz_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_mitgliedschaft \
         WHERE einsatz_id = ? AND einsatz_rolle = ?",
    )
    .bind(einsatz_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .fetch_one(pool)
    .await
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legt Org (id=1) + einen Benutzer an und liefert dessen id.
    async fn benutzer_anlegen(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h')",
        )
        .bind(name)
        .bind(name)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = ?")
            .bind(name)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn anlegen_macht_ersteller_zur_einsatzleitung() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let einsatz = anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
            .await
            .unwrap();
        assert_eq!(einsatz.bezeichnung, "Hochwasser");
        assert_eq!(einsatz.stichwort.as_deref(), Some("Deichbruch"));
        assert!(einsatz.ist_aktiv());

        let rolle = rolle_von(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
    }

    #[tokio::test]
    async fn rolle_von_fuer_nicht_mitglied_ist_none() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
    }

    #[tokio::test]
    async fn abschliessen_setzt_status_und_von() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.status, EinsatzStatus::Abgeschlossen);
        assert!(abgeschlossen.abgeschlossen_at.is_some());
        assert_eq!(abgeschlossen.abgeschlossen_von, Some(leit));
        assert!(!abgeschlossen.ist_aktiv());
    }

    /// Setzt die Dauer-Politik direkt in der DB (umgeht die Route, reiner Repo-Test).
    async fn setze_dauer(pool: &SqlitePool, einsatz_id: i64, bid: i64, tage: i64) {
        super::super::einstellungen::speichern(
            pool,
            einsatz_id,
            bid,
            super::super::einstellungen::EinstellungenDaten {
                retention_dauer_tage: Some(tage),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    /// Setzt die Org-Retention-Dauer direkt in der DB (reiner Repo-Test).
    async fn setze_org_dauer(pool: &SqlitePool, org_id: i64, bid: i64, tage: i64) {
        crate::org::einstellungen::speichern(
            pool,
            org_id,
            bid,
            crate::org::einstellungen::OrgEinstellungenDaten {
                retention_dauer_tage: Some(tage),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn abschliessen_befuellt_retention_bis_aus_dauer_und_schreibt_audit() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_dauer(&pool, einsatz.id, leit, 30).await;

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        // retention_bis = abgeschlossen_at + 30 Tage (gleiche Uhrzeit, kanonisches Format).
        let erwartet = super::super::retention::berechne_retention_bis(
            abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
            30,
        )
        .unwrap();
        assert_eq!(
            abgeschlossen.retention_bis.as_deref(),
            Some(erwartet.as_str())
        );

        // Ein ETB-System-Audit über die Auto-Frist entstanden.
        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
             AND inhalt LIKE 'Aufbewahrungsfrist automatisch gesetzt%'",
        )
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(anzahl, 1);
    }

    #[tokio::test]
    async fn abschliessen_ohne_dauer_setzt_keine_frist() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.retention_bis, None);
    }

    /// Einsatz-Override NULL, Org-Default=30 → Effektivwert 30 → retention_bis gesetzt.
    #[tokio::test]
    async fn abschliessen_org_default_befuellt_retention_bis() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        // Kein Einsatz-Override; Org-Default=30.
        setze_org_dauer(&pool, einsatz.org_id, leit, 30).await;

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        let erwartet = super::super::retention::berechne_retention_bis(
            abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
            30,
        )
        .unwrap();
        assert_eq!(
            abgeschlossen.retention_bis.as_deref(),
            Some(erwartet.as_str()),
            "Org-Default (30) soll greifen wenn kein Einsatz-Override gesetzt"
        );
    }

    /// Einsatz-Override=60 schlägt Org-Default=30 → Effektivwert 60.
    #[tokio::test]
    async fn abschliessen_einsatz_dauer_schlaegt_org_default() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_dauer(&pool, einsatz.id, leit, 60).await;
        setze_org_dauer(&pool, einsatz.org_id, leit, 30).await;

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        let erwartet = super::super::retention::berechne_retention_bis(
            abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
            60,
        )
        .unwrap();
        assert_eq!(
            abgeschlossen.retention_bis.as_deref(),
            Some(erwartet.as_str()),
            "Einsatz-Override (60) soll Org-Default (30) schlagen"
        );
    }

    #[tokio::test]
    async fn abschliessen_ueberschreibt_manuelle_frist_nicht() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_dauer(&pool, einsatz.id, leit, 30).await;
        // Manuell gesetzte Frist VOR Abschluss.
        frist_setzen(
            &pool,
            einsatz.id,
            leit,
            Some("2099-01-01 00:00:00"),
            "manuell",
        )
        .await
        .unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        // Auto-Fill darf die manuelle Frist nicht überschreiben.
        assert_eq!(
            abgeschlossen.retention_bis.as_deref(),
            Some("2099-01-01 00:00:00")
        );
    }

    #[tokio::test]
    async fn frist_setzen_speichert_und_schreibt_etb_audit() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(einsatz.retention_bis, None);

        let aktualisiert = frist_setzen(
            &pool,
            einsatz.id,
            leit,
            Some("2030-01-01 00:00:00"),
            "Aufbewahrungsfrist gesetzt auf 2030-01-01 00:00:00",
        )
        .await
        .unwrap();
        assert_eq!(
            aktualisiert.retention_bis.as_deref(),
            Some("2030-01-01 00:00:00")
        );

        // Genau ein ETB-System-Eintrag als Audit entstanden.
        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system'",
        )
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(anzahl, 1);
    }

    #[tokio::test]
    async fn faellige_soft_delete_nur_abgeschlossen_abgelaufen_offen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        // (1) abgeschlossen + Frist abgelaufen + nicht gelöscht → fällig.
        let faellig: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis) \
             VALUES (1,'Faellig','abgeschlossen', ?, '2026-01-01 00:00:00') RETURNING id",
        )
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        // (2) AKTIV mit abgelaufener Frist → NIE fällig (harter status-Guard).
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, status, retention_bis) \
             VALUES (1,'Aktiv','aktiv','2026-01-01 00:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        // (3) abgeschlossen, Frist NICHT abgelaufen → nicht fällig.
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis) \
             VALUES (1,'Zukunft','abgeschlossen', ?, '2099-01-01 00:00:00')",
        )
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        // (4) abgeschlossen, keine Frist → nicht fällig.
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von) \
             VALUES (1,'OhneFrist','abgeschlossen', ?)",
        )
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        // (5) abgeschlossen, abgelaufen, ABER schon soft-gelöscht → nicht erneut fällig.
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis, geloescht_at) \
             VALUES (1,'Schon','abgeschlossen', ?, '2026-01-01 00:00:00','2026-02-01 00:00:00')",
        )
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

        let ids = faellige_soft_delete(&pool, "2026-06-01 00:00:00")
            .await
            .unwrap();
        assert_eq!(
            ids,
            vec![faellig],
            "nur der abgeschlossene, abgelaufene, offene Einsatz"
        );

        // soft_delete_einsatz kippt den Tombstone + ist idempotent (zweiter Aufruf false).
        assert!(soft_delete_einsatz(&pool, faellig, "2026-06-01 00:00:00")
            .await
            .unwrap());
        assert!(!soft_delete_einsatz(&pool, faellig, "2026-06-02 00:00:00")
            .await
            .unwrap());
        let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
            .bind(faellig)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(g.as_deref(), Some("2026-06-01 00:00:00"));
    }

    #[tokio::test]
    async fn frist_setzen_none_hebt_frist_auf() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        frist_setzen(&pool, einsatz.id, leit, Some("2030-01-01 00:00:00"), "set")
            .await
            .unwrap();

        let aufgehoben = frist_setzen(&pool, einsatz.id, leit, None, "aufgehoben")
            .await
            .unwrap();
        assert_eq!(aufgehoben.retention_bis, None);
    }

    #[tokio::test]
    async fn setze_rolle_legt_an_und_aktualisiert() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Beobachter)
        );

        // Upsert: dieselbe (einsatz, benutzer)-Kombination aktualisiert die Rolle.
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Fuehrungspersonal)
            .await
            .unwrap();
        assert_eq!(
            rolle_von(&pool, einsatz.id, erika).await.unwrap(),
            Some(EinsatzRolle::Fuehrungspersonal)
        );
    }

    #[tokio::test]
    async fn entferne_loescht_mitgliedschaft() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        entferne(&pool, einsatz.id, erika).await.unwrap();
        assert_eq!(rolle_von(&pool, einsatz.id, erika).await.unwrap(), None);
    }

    #[tokio::test]
    async fn zaehle_einsatzleitung_zaehlt_nur_leitungen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let erika = benutzer_anlegen(&pool, "erika").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
            .await
            .unwrap();

        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 1);

        setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Einsatzleitung)
            .await
            .unwrap();
        assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 2);
    }

    /// Lädt den vollständigen `Benutzer`-Datensatz per id (für die Lese-Policy).
    async fn benutzer_laden(pool: &SqlitePool, id: i64) -> Benutzer {
        sqlx::query_as::<_, Benutzer>("SELECT * FROM benutzer WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn liste_fuer_annotiert_meine_rolle() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let fremd = benutzer_anlegen(&pool, "fremd").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Ersteller sieht sich als Einsatzleitung.
        let leit_benutzer = benutzer_laden(&pool, leit).await;
        let fuer_leit = liste_fuer(&pool, &leit_benutzer).await.unwrap();
        assert_eq!(fuer_leit.len(), 1);
        assert_eq!(fuer_leit[0].id, einsatz.id);
        assert_eq!(
            fuer_leit[0].meine_rolle.as_deref(),
            Some(EINSATZ_ROLLE_LEITUNG)
        );

        // Nicht-Mitglied ohne höhere Berechtigung sieht den Einsatz NICHT (DSGVO-Filter).
        let fremd_benutzer = benutzer_laden(&pool, fremd).await;
        let fuer_fremd = liste_fuer(&pool, &fremd_benutzer).await.unwrap();
        assert!(fuer_fremd.is_empty());
    }

    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_einsatznummer() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        let a = anlegen(&pool, "Lage A", None, leit).await.unwrap();
        let b = anlegen(&pool, "Lage B", None, leit).await.unwrap();
        assert_eq!(
            a.einsatznummer_intern.as_deref(),
            Some(format!("{jahr}-001").as_str())
        );
        assert_eq!(
            b.einsatznummer_intern.as_deref(),
            Some(format!("{jahr}-002").as_str())
        );

        // angelegt_at wurde gesetzt (nicht der '' Default).
        assert!(!a.angelegt_at.is_empty());
    }

    #[tokio::test]
    async fn anlegen_zaehlt_je_organisation_getrennt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await; // legt Org id=1 an

        let jahr: String = sqlx::query_scalar("SELECT strftime('%Y','now')")
            .fetch_one(&pool)
            .await
            .unwrap();

        // Zweite Organisation mit bereits hoher Nummer — darf Org 1 nicht beeinflussen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Orga 2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (2, 'Fremd', ?)")
            .bind(format!("{jahr}-009"))
            .execute(&pool)
            .await
            .unwrap();

        // anlegen nutzt Org 1 (ORDER BY id LIMIT 1) → beginnt bei 001.
        let a = anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(
            a.einsatznummer_intern.as_deref(),
            Some(format!("{jahr}-001").as_str())
        );
    }

    #[tokio::test]
    async fn aktualisiere_kopf_setzt_felder_und_leere_optionals_null() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = anlegen(&pool, "Alt", None, leit).await.unwrap();

        let aktualisiert = aktualisiere_kopf(
            &pool,
            einsatz.id,
            KopfDaten {
                bezeichnung: "Neu",
                stichwort: Some("H1"),
                einsatzart: crate::einsatz::EINSATZART_UEBUNG,
                einsatznummer_intern: einsatz.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: Some("Hauptstraße 1"),
                einsatzort_lat: Some(52.5),
                einsatzort_lon: Some(13.4),
                meldende_stelle: None,
                sachverhalt: Some("Mehrzeiliges\nMeldebild"),
                anzahl_betroffene_initial: Some(3),
                begonnen_at: "2026-05-25 08:00:00",
            },
        )
        .await
        .unwrap();

        assert_eq!(aktualisiert.bezeichnung, "Neu");
        assert_eq!(aktualisiert.einsatzart, Einsatzart::Uebung);
        assert_eq!(aktualisiert.einsatzort.as_deref(), Some("Hauptstraße 1"));
        assert_eq!(aktualisiert.einsatzort_lat, Some(52.5));
        assert_eq!(aktualisiert.anzahl_betroffene_initial, Some(3));
        assert_eq!(aktualisiert.leitstellen_nr, None);
        assert_eq!(aktualisiert.begonnen_at, "2026-05-25 08:00:00");
        // angelegt_at bleibt unverändert (Audit-Spur).
        assert_eq!(aktualisiert.angelegt_at, einsatz.angelegt_at);
    }

    #[tokio::test]
    async fn aktualisiere_kopf_doppelte_nummer_ist_conflict() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let a = anlegen(&pool, "A", None, leit).await.unwrap();
        let b = anlegen(&pool, "B", None, leit).await.unwrap();

        // b auf a's Nummer setzen → Unique-Verstoß → Conflict.
        let err = aktualisiere_kopf(
            &pool,
            b.id,
            KopfDaten {
                bezeichnung: "B",
                stichwort: None,
                einsatzart: crate::einsatz::EINSATZART_REALEINSATZ,
                einsatznummer_intern: a.einsatznummer_intern.as_deref(),
                leitstellen_nr: None,
                einsatzort: None,
                einsatzort_lat: None,
                einsatzort_lon: None,
                meldende_stelle: None,
                sachverhalt: None,
                anzahl_betroffene_initial: None,
                begonnen_at: &b.begonnen_at,
            },
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)));
    }

    #[tokio::test]
    async fn liste_fuer_zeigt_admin_nicht_mitglied_fremden_einsatz() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let admin = benutzer_anlegen(&pool, "admin").await;
        let einsatz = anlegen(&pool, "Lage", None, leit).await.unwrap();

        // Admin zur höheren Berechtigung machen.
        sqlx::query("UPDATE benutzer SET system_rolle = ? WHERE id = ?")
            .bind(crate::auth::ROLLE_ADMIN)
            .bind(admin)
            .execute(&pool)
            .await
            .unwrap();

        // Admin ist KEIN Mitglied, sieht den Einsatz aber trotzdem (ohne Rolle).
        let admin_benutzer = benutzer_laden(&pool, admin).await;
        let fuer_admin = liste_fuer(&pool, &admin_benutzer).await.unwrap();
        assert_eq!(fuer_admin.len(), 1);
        assert_eq!(fuer_admin[0].id, einsatz.id);
        assert_eq!(fuer_admin[0].meine_rolle, None);
    }
}

use super::berechtigung::darf_lesen;
use super::{
    Einsatz, EinsatzAnzeige, EinsatzRolle, EinsatzStatus, Einsatzart, MitgliedAnzeige,
    EINSATZ_ROLLE_LEITUNG, STATUS_ABGESCHLOSSEN,
};
use crate::auth::Benutzer;
use crate::error::AppError;
use chrono::Utc;
use sqlx::{SqliteConnection, SqlitePool};

/// Die Felder, die beim Anlegen gesetzt werden dürfen (LFH-332 · B4).
///
/// **Warum ein Struct und nicht fünf Parameter:** `einsatzart` und `begonnen_at`
/// kamen erst mit dem erweiterten Anlegedialog dazu. Beide sind `Option` und beide
/// sind Strings — als Stellungsparameter wären sie ohne Blick auf die Signatur
/// vertauschbar. Dasselbe Muster trägt `KopfPatch` weiter unten.
pub struct NeuerEinsatzDaten<'a> {
    pub bezeichnung: &'a str,
    pub stichwort: Option<&'a str>,
    /// `None` → DB-Default `'realeinsatz'`. Der Aufrufer hat den Wert bereits
    /// gegen `Einsatzart::parse` geprüft.
    pub einsatzart: Option<&'a str>,
    /// Alarmzeit. `None` → DB-Default `datetime('now')`. Der Aufrufer hat den Wert
    /// bereits durch `etb::normalisiere_zeit` geschickt.
    pub begonnen_at: Option<&'a str>,
}

/// Legt einen Einsatz an und macht den Ersteller in derselben Transaktion zur Einsatzleitung.
pub async fn anlegen(
    pool: &SqlitePool,
    daten: NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    anlegen_zum(pool, daten, ersteller_id, chrono::Utc::now()).await
}

/// [`anlegen`] mit hineingereichtem Zeitpunkt für das Jahr der Einsatznummer — nur damit
/// die Neujahrsgrenze ohne Uhr-Mock prüfbar ist. `angelegt_at`/`begonnen_at` bleiben
/// `datetime('now')` der Datenbank.
///
/// Dünne Hülle über [`anlegen_tx`] (LFH-690, design.md D5): eigene `BEGIN IMMEDIATE`-
/// Transaktion über `write_retry!`, danach das Laden über den Pool.
pub(crate) async fn anlegen_zum(
    pool: &SqlitePool,
    daten: NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<Einsatz, AppError> {
    let einsatz_id = crate::write_retry!(pool, |conn| {
        anlegen_tx(conn, &daten, ersteller_id, jetzt).await
    })?;

    laden(pool, einsatz_id).await
}

/// Legt einen Einsatz auf der Verbindung des Aufrufers an: Einsatznummer aus dem Kreis der
/// Organisation und Mitgliedschaft des Erstellers als Einsatzleitung. Liefert die neue ID.
///
/// Der Aufrufer hält die Transaktion (`BEGIN IMMEDIATE`, sonst ist die Nummernvergabe nicht
/// rennfrei). So kann der Demo-Import (LFH-690) den Einsatz in seiner eigenen Transaktion
/// anlegen und sieht dabei dieselbe Vergabe wie der Betrieb.
pub(crate) async fn anlegen_tx(
    conn: &mut SqliteConnection,
    daten: &NeuerEinsatzDaten<'_>,
    ersteller_id: i64,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Result<i64, AppError> {
    // Ein Einsatz gehört zur Organisation SEINES ERSTELLERS (F05/LFH-232). Vorher stand
    // hier `SELECT id FROM organisation ORDER BY id LIMIT 1` („Single-Org in T1") — sobald
    // eine zweite Organisation existiert, wäre jeder ihrer Einsätze in Org 1 gelandet und
    // der Ersteller sofort ein org-fremdes Mitglied (die Mitgliedschaft unten umgeht
    // `darf_fremdeinsatz_lesen`, weil `darf_lesen` bei vorhandener Rolle nicht mehr
    // org-prüft). Der Wert ist damit auch bei genau einer Org identisch — nur eben aus
    // der richtigen Quelle.
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE id = ?")
        .bind(ersteller_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| AppError::Internal("Ersteller nicht gefunden".into()))?;

    // Einsatznummer <Präfix><JJJJ>-<NNNN> (LFH-617): NNNN je Organisation + Jahr
    // fortlaufend über die Zahlenspalten, nicht über die Zerlegung des Textes. Präfix
    // und Zeitzone kommen aus den Org-Einstellungen; das Präfix wird in den Text
    // eingefroren, das Jahr zählt in der Org-Zeitzone (sonst Europe/Berlin).
    // BEGIN IMMEDIATE (F09) schließt die read-then-write-Lücke zwischen MAX-Read und
    // Insert; der Unique-Index (org_id, nummer_jahr, nummer_lfd) sichert zusätzlich ab.
    let (praefix, zeitzone): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT einsatz_nummer_praefix, zeitzone FROM org_einstellungen WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or((None, None));
    let jahr = super::nummer::jahr_in_zone(jetzt, zeitzone.as_deref());
    let max_lfd: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(nummer_lfd) FROM einsatz WHERE org_id = ? AND nummer_jahr = ?",
    )
    .bind(org_id)
    .bind(jahr)
    .fetch_one(&mut *conn)
    .await?;
    // Belegte TEXTE überspringen: ein früher von Hand gesetzter Wert im neuen Muster
    // (z. B. `E-2026-0005`) trägt keine Zahlen und zählt im MAX nicht mit. Ohne das
    // Ausweichen schlüge der Text-Index aus 0005 an — bei jedem weiteren Versuch
    // wieder, denn MAX(nummer_lfd) wüchse nie darüber hinaus. Die Schleife endet, weil
    // eine Org nur endlich viele Texte hat.
    let mut lfd = max_lfd.unwrap_or(0) + 1;
    let einsatznummer = loop {
        let kandidat = super::nummer::formatiere(praefix.as_deref(), jahr, lfd);
        let belegt: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM einsatz \
             WHERE org_id = ? AND einsatznummer_intern = ?)",
        )
        .bind(org_id)
        .bind(&kandidat)
        .fetch_one(&mut *conn)
        .await?;
        if !belegt {
            break kandidat;
        }
        lfd += 1;
    };

    // COALESCE statt eines zweiten INSERT-Zweigs: `einsatzart` und `begonnen_at`
    // sind NOT NULL mit DB-Default. Ein explizit gebundenes NULL überschriebe den
    // Default und verletzte die Bedingung — COALESCE lässt den Default greifen.
    //
    // Die ID wird ausdrücklich vergeben (LFH-690, design.md D6): über allen bestehenden
    // Einsätzen UND über jeder ID, die ein Demo-Import je getragen hat. `demo_import`
    // behält die ID nach dem Entfernen als Sperre; ohne sie bekäme der nächste echte
    // Einsatz die ID des gelöschten Demo-Einsatzes, und Offline-Queues oder offene Tabs
    // schrieben still in ihn. Das gilt für JEDE Anlage, instanzweit (IDs sind nicht je Org).
    // Ohne Demo-Historie ist das Ergebnis `MAX(id)+1` — dieselbe Vergabe wie SQLites eigene
    // für `INTEGER PRIMARY KEY` ohne AUTOINCREMENT. Rennfrei unter BEGIN IMMEDIATE.
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (id, org_id, bezeichnung, stichwort, einsatzart, begonnen_at, \
                              einsatznummer_intern, nummer_jahr, nummer_lfd, angelegt_at) \
         VALUES ((SELECT MAX(COALESCE((SELECT MAX(id) FROM einsatz), 0), \
                             COALESCE((SELECT MAX(einsatz_id) FROM demo_import), 0)) + 1), \
                 ?, ?, ?, COALESCE(?, 'realeinsatz'), COALESCE(?, datetime('now')), ?, \
                 ?, ?, datetime('now')) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.bezeichnung)
    .bind(daten.stichwort)
    .bind(daten.einsatzart)
    .bind(daten.begonnen_at)
    .bind(&einsatznummer)
    .bind(jahr)
    .bind(lfd)
    .fetch_one(&mut *conn)
    .await?;

    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(ersteller_id)
    .bind(EINSATZ_ROLLE_LEITUNG)
    .execute(&mut *conn)
    .await?;
    Ok(einsatz_id)
}

/// Lädt einen Einsatz; `AppError::NotFound`, wenn er nicht existiert.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Einsatz, AppError> {
    // Die beiden EXISTS-Spalten sind die Auslöser der Lagekennzahlen (LFH-640/LFH-607); sie
    // stehen wortgleich auch in `liste_fuer`, das Bezirksprädikat wie `istAktiverBezirk` im
    // Frontend — siehe `lagekennzahl::ableiten`.
    sqlx::query_as::<_, Einsatz>(
        "SELECT e.id, e.org_id, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.geloescht_at, e.naechste_lagebesprechung_at, \
                o.name AS org_name, \
                EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id) AS pegel_festgelegt, \
                EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = e.id \
                        AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben') \
                    AS evakuierung_angeordnet \
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

/// Eigene Führungsstelle, ausdrücklich auf Benutzer UND Einsatz begrenzt.
pub async fn fuehrungsstelle_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<String>, AppError> {
    let stelle: Option<Option<String>> = sqlx::query_scalar(
        "SELECT fuehrungsstelle FROM einsatz_mitgliedschaft WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    Ok(stelle.flatten())
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
        naechste_lagebesprechung_at: Option<String>,
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
        meine_fuehrungsstelle: Option<String>,
        pegel_festgelegt: bool,
        evakuierung_angeordnet: bool,
    }

    // EXISTS-Spalten wortgleich zu `laden` (Auslöser der Lagekennzahlen, `lagekennzahl::ableiten`).
    let rows = sqlx::query_as::<_, Row>(
        "SELECT e.id, e.org_id, o.name AS org_name, e.bezeichnung, e.stichwort, e.status, e.begonnen_at, \
                e.abgeschlossen_at, e.abgeschlossen_von, e.einsatzart, e.einsatznummer_intern, \
                e.angelegt_at, e.leitstellen_nr, e.einsatzort, e.einsatzort_lat, e.einsatzort_lon, \
                e.meldende_stelle, e.sachverhalt, e.anzahl_betroffene_initial, \
                e.retention_bis, e.geloescht_at, e.naechste_lagebesprechung_at, \
                m.einsatz_rolle AS meine_rolle, m.fuehrungsstelle AS meine_fuehrungsstelle, \
                EXISTS (SELECT 1 FROM einsatz_pegel p WHERE p.einsatz_id = e.id) AS pegel_festgelegt, \
                EXISTS (SELECT 1 FROM evakuierungsbezirk b WHERE b.einsatz_id = e.id \
                        AND b.storniert_at IS NULL AND b.raeumung <> 'aufgehoben') \
                    AS evakuierung_angeordnet \
         FROM einsatz e \
         LEFT JOIN organisation o ON o.id = e.org_id \
         LEFT JOIN einsatz_mitgliedschaft m \
                ON m.einsatz_id = e.id AND m.benutzer_id = ? \
         ORDER BY e.begonnen_at DESC, e.id DESC",
    )
    .bind(benutzer.id)
    .fetch_all(pool)
    .await?;

    // ZWEITE, ebenfalls EINMALIGE Abfrage (LFH-46): die Sachgebiete des Benutzers über ALLE
    // Einsätze. Die Detail-Abfrage (`stab::repo::sachgebiete_von`) je Zeile zu rufen wäre N+1
    // auf `GET /api/einsaetze` — der Route hinter der Einsatzauswahl. Zwei Statements bleiben
    // O(1) in der Zahl der Einsätze; genau das sichert `liste_fuer` zu.
    let mut sachgebiete = crate::stab::repo::sachgebiete_je_einsatz(pool, benutzer.id).await?;

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
        .map(|r| {
            let meine_sachgebiete = sachgebiete.remove(&r.id).unwrap_or_default();
            // Dieselbe reine Ableitung wie `Einsatz::anzeige` — aus Werten, die diese
            // Funktion ohnehin schon geladen hat, also ohne dritte Abfrage.
            let meine_funktion = super::funktion::ableiten(
                &meine_sachgebiete,
                r.meine_rolle.as_deref().and_then(EinsatzRolle::parse),
            )
            .map(|f| f.bezeichnung);
            EinsatzAnzeige {
                id: r.id,
                org_id: r.org_id,
                org_name: r.org_name,
                bezeichnung: r.bezeichnung,
                stichwort: r.stichwort,
                status: r.status,
                begonnen_at: r.begonnen_at,
                naechste_lagebesprechung_at: r.naechste_lagebesprechung_at,
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
                meine_fuehrungsstelle: r.meine_fuehrungsstelle,
                // `remove` statt `get` (oben): jede Einsatz-id kommt genau einmal vor, der
                // Eintrag wird also nicht mehr gebraucht — das spart das Klonen des Vec.
                meine_sachgebiete,
                meine_funktion,
                lagekennzahlen: super::lagekennzahl::ableiten(
                    r.pegel_festgelegt,
                    r.evakuierung_angeordnet,
                ),
            }
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
/// Personendaten in allen einsatz-scoped PII-Tabellen (strikt einsatz-scoped, OHNE
/// `storniert_at`-Filter — auch stornierte Zeilen tragen reale PII), setzt den
/// `geschwaerzt_at`-Tombstone und schreibt einen System-ETB-Audit — alles in EINER
/// Transaktion (partieller Scrub rollt zurück). Das operative Skelett (Einsatz-Struktur,
/// ETB, Zähler/registrier_nr, Führungs-Doku, anonymisierte Triage) bleibt erhalten.
/// Chat- und Erinnerungs-Freitexte werden seit LFH-290 mitgeschwärzt; ins ETB oder in
/// einen Auftrag heraufgestufte Chat-Nachrichten bleiben als Kopie in der Führungs-Doku
/// stehen (ETB-Politik, `etb_eintrag.inhalt`/`auftrag.auftrag_text` sind Retain).
///
/// Idempotent: der `geschwaerzt_at IS NULL`-Guard liefert `false`, wenn der Einsatz
/// schon geschwärzt (oder nicht soft-gelöscht/abgeschlossen) ist — kein Doppel-Scrub.
///
/// **Welche Spalte gescrubbt oder erhalten wird, entscheidet die zentrale Registry
/// `super::schwaerzung_registry`** (F02/LFH-229): sie taggt JEDE Spalte JEDER einsatz-
/// scoped Tabelle, ein Guard-Test erzwingt Vollständigkeit (neue PII-Spalte ⇒ ROT), und
/// [`super::schwaerzung_registry::scrubbe_aus_registry`] treibt den Scrub data-driven aus
/// denselben Konstanten (kein Guard↔Scrub-Drift). Der eigentliche Scrub steht dort, nicht
/// mehr hier als handgepflegte UPDATE-Liste.
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

    // --- PII-Scrub: data-driven aus der zentralen Klassifikations-Registry (F02/LFH-229) ---
    // Kein storniert_at-Filter (auch stornierte Zeilen tragen reale PII). Jede einsatz-
    // scoped Spalte ist in `schwaerzung_registry::TABELLEN` als Scrub|Retain getaggt; ein
    // Guard-Test bricht ROT, sobald eine neue Spalte/Tabelle unklassifiziert bleibt. Die
    // UPDATE/DELETE-Statements entstehen aus denselben Registry-Konstanten → kein Drift
    // zwischen Guard und tatsächlichem Scrub (siehe schwaerzung_registry). Die LFH-108-
    // Funk-Erreichbarkeit (einsatz_einheit/einsatzabschnitt.erreichbarkeit) ist dort als
    // Scrub klassifiziert; die handgepflegten UPDATEs von LFH-108 sind damit obsolet.
    super::schwaerzung_registry::scrubbe_aus_registry(&mut tx, einsatz_id).await?;

    system_audit_tx(
        &mut tx,
        einsatz_id,
        etb_startwert,
        "PII-Schwärzung durchgeführt (Aufbewahrungsfrist + Karenz abgelaufen). \
         Direkte Personenidentifikatoren (Namen, Kontakt, Adresse, Meldebild/Einsatzort, \
         Foto-/Datei-Anhänge, personenbezogene Notizen, Schadens-/Lage-/Gefahren-Freitexte \
         sowie die Freitexte von Chat-Kanälen, Chat-Nachrichten und Erinnerungen) wurden \
         unwiderruflich entfernt. Erhalten bleiben das operative Skelett (Einsatz-Struktur, \
         Zähler/registrier_nr, operative Objekte, die Struktur von Chat und Erinnerungen mit \
         Zeitpunkten, Verfassern und Status), die Führungs-Dokumentation (ETB, Meldungen, Aufträge, \
         Lage-/Befehlsberichte — im ETB rechtsverbindlich gesnapshottet; ins ETB oder in einen \
         Auftrag heraufgestufte Chat-Nachrichten stehen dort weiter im Wortlaut) und \
         anonymisierte Triage-/Statuskategorien (ohne Personenbezug) für die gesetzliche/ \
         statistische Aufbewahrung.",
    )
    .await?;

    tx.commit().await?;
    tracing::warn!(
        einsatz_id,
        "Purge Phase B abgeschlossen: PII geschwärzt (geschwaerzt_at gesetzt)"
    );
    Ok(true)
}

/// Teil-Patch der editierbaren Kopf-Spalten (LFH-306, Tri-State): äußere `Option` = „im
/// Patch enthalten?", innere = Wert (`Some(None)` setzt die Spalte auf NULL). Die drei
/// NOT-NULL-Spalten (`bezeichnung`, `einsatzart`, `begonnen_at`) tragen nur die äußere
/// `Option` — sie lassen sich nicht leeren, nur setzen oder unberührt lassen.
#[derive(Debug, Default)]
pub struct KopfPatch<'a> {
    pub bezeichnung: Option<&'a str>,
    pub stichwort: Option<Option<&'a str>>,
    pub einsatzart: Option<&'a str>,
    // Keine `einsatznummer_intern`: die Einsatznummer vergibt das System beim Anlegen und
    // sie ist danach unveränderlich (LFH-617). Der Handler weist das Feld mit 400 ab.
    pub leitstellen_nr: Option<Option<&'a str>>,
    pub einsatzort: Option<Option<&'a str>>,
    pub einsatzort_lat: Option<Option<f64>>,
    pub einsatzort_lon: Option<Option<f64>>,
    pub meldende_stelle: Option<Option<&'a str>>,
    pub sachverhalt: Option<Option<&'a str>>,
    pub anzahl_betroffene_initial: Option<Option<i64>>,
    /// Bereits ins DB-Format normalisierte Alarmzeit.
    pub begonnen_at: Option<&'a str>,
    /// Expliziter UTC-Termin; absent erhält, innere None löscht.
    pub naechste_lagebesprechung_at: Option<Option<&'a str>>,
}

/// Teil-Patch der editierbaren Kopf-Spalten. Nicht-editierbare Spalten (status,
/// abgeschlossen_*, angelegt_at, org_id, id) bleiben unberührt — ebenso die Einsatznummer
/// (`einsatznummer_intern`, `nummer_jahr`, `nummer_lfd`), die nur `anlegen` schreibt (LFH-617).
///
/// Flag/Wert-Paare mit **nummerierten** Parametern (LFH-266/F12, Vorlage `person/repo.rs`).
/// Bei zwölf gleichtypigen Paaren ist die Nummerierung die eigentliche Absicherung: eine um
/// eine Position verschobene Bind-Kette vertauschte Nachbarspalten
/// (`meldende_stelle`↔`sachverhalt`, `einsatzort_lat`↔`einsatzort_lon`) STILL — ohne
/// Compile- und ohne Laufzeitfehler. Abgesichert von
/// `patche_kopf_setzt_jede_spalte_an_ihren_platz`.
pub async fn patche_kopf(
    pool: &SqlitePool,
    einsatz_id: i64,
    patch: KopfPatch<'_>,
) -> Result<Einsatz, AppError> {
    let ergebnis = sqlx::query(
        "UPDATE einsatz SET \
            bezeichnung = CASE WHEN ?1 IS NULL THEN bezeichnung ELSE ?2 END, \
            stichwort = CASE WHEN ?3 IS NULL THEN stichwort ELSE ?4 END, \
            einsatzart = CASE WHEN ?5 IS NULL THEN einsatzart ELSE ?6 END, \
            leitstellen_nr = CASE WHEN ?7 IS NULL THEN leitstellen_nr ELSE ?8 END, \
            einsatzort = CASE WHEN ?9 IS NULL THEN einsatzort ELSE ?10 END, \
            einsatzort_lat = CASE WHEN ?11 IS NULL THEN einsatzort_lat ELSE ?12 END, \
            einsatzort_lon = CASE WHEN ?13 IS NULL THEN einsatzort_lon ELSE ?14 END, \
            meldende_stelle = CASE WHEN ?15 IS NULL THEN meldende_stelle ELSE ?16 END, \
            sachverhalt = CASE WHEN ?17 IS NULL THEN sachverhalt ELSE ?18 END, \
            anzahl_betroffene_initial = \
                CASE WHEN ?19 IS NULL THEN anzahl_betroffene_initial ELSE ?20 END, \
            begonnen_at = CASE WHEN ?21 IS NULL THEN begonnen_at ELSE ?22 END, \
            naechste_lagebesprechung_at = \
                CASE WHEN ?23 IS NULL THEN naechste_lagebesprechung_at ELSE ?24 END \
         WHERE id = ?25",
    )
    .bind(patch.bezeichnung.map(|_| 1_i64))
    .bind(patch.bezeichnung)
    .bind(patch.stichwort.map(|_| 1_i64))
    .bind(patch.stichwort.and_then(|v| v))
    .bind(patch.einsatzart.map(|_| 1_i64))
    .bind(patch.einsatzart)
    .bind(patch.leitstellen_nr.map(|_| 1_i64))
    .bind(patch.leitstellen_nr.and_then(|v| v))
    .bind(patch.einsatzort.map(|_| 1_i64))
    .bind(patch.einsatzort.and_then(|v| v))
    .bind(patch.einsatzort_lat.map(|_| 1_i64))
    .bind(patch.einsatzort_lat.and_then(|v| v))
    .bind(patch.einsatzort_lon.map(|_| 1_i64))
    .bind(patch.einsatzort_lon.and_then(|v| v))
    .bind(patch.meldende_stelle.map(|_| 1_i64))
    .bind(patch.meldende_stelle.and_then(|v| v))
    .bind(patch.sachverhalt.map(|_| 1_i64))
    .bind(patch.sachverhalt.and_then(|v| v))
    .bind(patch.anzahl_betroffene_initial.map(|_| 1_i64))
    .bind(patch.anzahl_betroffene_initial.and_then(|v| v))
    .bind(patch.begonnen_at.map(|_| 1_i64))
    .bind(patch.begonnen_at)
    .bind(patch.naechste_lagebesprechung_at.map(|_| 1_i64))
    .bind(patch.naechste_lagebesprechung_at.flatten())
    .bind(einsatz_id)
    .execute(pool)
    .await;

    ergebnis?;

    laden(pool, einsatz_id).await
}

/// Alle Mitglieder eines Einsatzes (mit Benutzer-Klartext), sortiert nach Zuweisung.
pub async fn mitglieder(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<MitgliedAnzeige>, AppError> {
    sqlx::query_as::<_, MitgliedAnzeige>(
        "SELECT m.benutzer_id, b.anzeigename, b.benutzername, m.einsatz_rolle, m.zugewiesen_at, m.fuehrungsstelle \
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
    setze_mitgliedschaft(pool, einsatz_id, benutzer_id, rolle, None).await
}

/// Rolle und optional die Führungsstelle in EINEM Statement aktualisieren.
/// Fehlendes Feld erhält den Bestand; explizites null löscht die Stelle.
pub async fn setze_mitgliedschaft(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    rolle: EinsatzRolle,
    fuehrungsstelle: Option<Option<&str>>,
) -> Result<(), AppError> {
    // Org-Guard IM SQL (F05/LFH-232), nicht im Handler: dies ist einer von nur zwei
    // produktiven INSERTs in `einsatz_mitgliedschaft` und damit ein Chokepoint der
    // Mandanten-Grenze. Eine org-fremde Mitgliedschaft würde die Isolation aus LFH-115
    // vollständig aushebeln — `darf_lesen` prüft bei vorhandener Rolle die Org nicht mehr.
    // Als `WHERE EXISTS` kann kein künftiger Aufrufer den Check vergessen.
    let betroffen = sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle, fuehrungsstelle) \
         SELECT ?1, ?2, ?3, ?4 \
         WHERE EXISTS (SELECT 1 FROM benutzer b JOIN einsatz e ON e.id = ?1 \
                       WHERE b.id = ?2 AND b.org_id = e.org_id) \
         ON CONFLICT(einsatz_id, benutzer_id) DO UPDATE SET einsatz_rolle = excluded.einsatz_rolle, \
         fuehrungsstelle = CASE WHEN ?5 THEN excluded.fuehrungsstelle ELSE einsatz_mitgliedschaft.fuehrungsstelle END",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(rolle.as_str())
    .bind(fuehrungsstelle.flatten())
    .bind(fuehrungsstelle.is_some())
    .execute(pool)
    .await?
    .rows_affected();

    if betroffen == 0 {
        // `NotFound` statt `Forbidden`: aus Sicht dieses Einsatzes gibt es den Benutzer
        // nicht — die Existenz org-fremder Konten bleibt so unbeobachtbar (konsistent mit
        // dem bestehenden „Ziel-Benutzer unbekannt"-Pfad in `mitglied_setzen`).
        return Err(AppError::NotFound);
    }
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

    /// Kurzform für die Testfälle dieser Datei: legt einen Einsatz mit den beiden
    /// Pflichtangaben an. Einsatzart und Alarmzeit spielen hier nirgends eine Rolle —
    /// die deckt `tests/einsatz.rs` über die Route ab, wo sie auch validiert werden.
    async fn test_anlegen(
        pool: &SqlitePool,
        bezeichnung: &str,
        stichwort: Option<&str>,
        ersteller_id: i64,
    ) -> Result<Einsatz, AppError> {
        anlegen(
            pool,
            NeuerEinsatzDaten {
                bezeichnung,
                stichwort,
                einsatzart: None,
                begonnen_at: None,
            },
            ersteller_id,
        )
        .await
    }

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

        let einsatz = test_anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

        assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
    }

    #[tokio::test]
    async fn abschliessen_setzt_status_und_von() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

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

    #[tokio::test]
    async fn schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis() {
        // LFH-632, Entscheidung E9: `einsatz_dokument.anhang_id … ON DELETE CASCADE`. Die
        // Registry löscht `anhang` VOR `einsatz_dokument` (Reihenfolge in `TABELLEN`); mit
        // RESTRICT/NO ACTION scheiterte der DELETE auf `anhang` am FK und die ganze
        // Schwärzung rollte zurück. Der ETB-Nachweis bleibt — samt Titel im Wortlaut (G_ETB).
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();
        let anhang_id: i64 = sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'familie.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(b"ABC".as_slice())
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        let inhalt = "Dokument abgelegt: Foto Familie Müller (Foto)";
        let etb_id: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'system', ?, ?, datetime('now')) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(inhalt)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, etb_eintrag_id, abgelegt_von_id) \
             VALUES (?, ?, 'foto', 'Foto Familie Müller', ?, ?)",
        )
        .bind(einsatz.id)
        .bind(anhang_id)
        .bind(etb_id)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let zaehle = |sql: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(sql)
                    .bind(einsatz.id)
                    .fetch_one(&pool)
                    .await
                    .unwrap()
            }
        };
        assert_eq!(
            zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
            0,
            "Datei weg"
        );
        assert_eq!(
            zaehle("SELECT COUNT(*) FROM einsatz_dokument WHERE einsatz_id = ?").await,
            0,
            "Dokument-Zeile weg"
        );
        let etb_inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            etb_inhalt, inhalt,
            "ETB-Nachweis bleibt im Wortlaut (G_ETB), auch der Titel darin"
        );
    }

    /// LFH-22 (design.md D8): das Logo ist keine Einsatzunterlage. Schwärzen eines
    /// Einsatzes lässt die Logo-Bytes der Organisation unverändert.
    #[tokio::test]
    async fn schwaerzung_laesst_das_logo_der_organisation_unveraendert() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nLogo-Bytes".to_vec();
        crate::org::logo::setzen(&pool, 1, "image/png", &bytes, leit)
            .await
            .unwrap();
        let vorher = crate::org::logo::meta(&pool, 1).await.unwrap().unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        assert_eq!(
            crate::org::logo::inhalt(&pool, 1)
                .await
                .unwrap()
                .map(|i| i.daten),
            Some(bytes),
            "Logo-Bytes bleiben"
        );
        assert_eq!(
            crate::org::logo::meta(&pool, 1).await.unwrap(),
            Some(vorher),
            "Metadaten bleiben"
        );
    }

    #[tokio::test]
    async fn schwaerzung_loescht_etb_anhang_und_haelt_den_eintrag() {
        // LFH-117, design.md D8: die Datei geht (anhang ist ZeileLoeschen), die Verknüpfung
        // per CASCADE mit, der Eintrag bleibt mit Inhalt und Nummer (G_ETB) und trägt danach
        // `anhaenge: []`. Die Bindungsabfrage des ETB-Downloads trifft nichts mehr → 404.
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        let foto = crate::anhang::repo::anlegen(
            &pool,
            einsatz.id,
            leit,
            "Familie Müller.jpg",
            "image/jpeg",
            b"JPEG",
        )
        .await
        .unwrap();
        let inhalt = "Foto der Schadenstelle";
        let (eintrag, _) = crate::etb::repo::anlegen_idempotent(
            &pool,
            einsatz.id,
            leit,
            None,
            &[foto.id],
            crate::etb::repo::EintragDaten {
                typ: "meldung",
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
        .unwrap();
        assert_eq!(
            eintrag.anhaenge.len(),
            1,
            "Vorbedingung: Foto hängt am Eintrag"
        );
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let (dateien, links): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM anhang WHERE id = ?1), \
                    (SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?1)",
        )
        .bind(foto.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((dateien, links), (0, 0), "Datei und Verknüpfung weg");

        let liste = crate::etb::repo::abfrage(
            &pool,
            einsatz.id,
            &crate::etb::repo::EtbFilter {
                limit: 100,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let danach = liste
            .iter()
            .find(|e| e.id == eintrag.id)
            .expect("der Eintrag bleibt");
        assert_eq!(danach.inhalt, inhalt, "Inhalt unverändert (G_ETB)");
        assert_eq!(danach.lfd_nr, eintrag.lfd_nr, "Nummer unverändert");
        assert!(danach.anhaenge.is_empty(), "anhaenge: []");
        assert!(
            !crate::etb::repo::anhang_am_eintrag(&pool, einsatz.id, eintrag.id, foto.id)
                .await
                .unwrap(),
            "der frühere Download-Pfad findet nichts mehr (Route antwortet 404)"
        );
    }

    #[tokio::test]
    async fn schwaerzung_nullt_freies_zeichen_label_pii() {
        // LFH-170/Review: freies_zeichen.label ist Freitext (kann PII tragen, z. B. „ELW Fam.
        // Müller"). Es MUSS von schwaerze_einsatz genullt werden (wie karte_hintergrundbild.name);
        // die operative Position (lat/lon) bleibt wie das übrige Skelett erhalten.
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        // Retention-Guard erfüllen: soft-gelöscht.
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO freies_zeichen (einsatz_id, lat, lon, grundzeichen, label, erstellt_von) \
             VALUES (?, ?, ?, 'stelle', 'ELW Fam. Müller', ?)",
        )
        .bind(einsatz.id)
        .bind(50.1)
        .bind(8.6)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let (label, lat): (Option<String>, f64) =
            sqlx::query_as("SELECT label, lat FROM freies_zeichen WHERE einsatz_id = ?")
                .bind(einsatz.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            label, None,
            "Freitext-Label (PII) muss nach Schwärzung NULL sein"
        );
        assert_eq!(lat, 50.1, "operative Position bleibt erhalten (Skelett)");
    }

    #[tokio::test]
    async fn schwaerzung_nullt_lagedaten_der_person_und_behaelt_die_kategorien() {
        // LFH-613, Spec-Szenario „Geschwärzter Einsatz": Zustand (Gesundheitsdatum),
        // Fundort-Koordinate und Verbleib-Ziel tragen Personenbezug und werden leer; Art und
        // Status des Verbleibs sowie „vermisst seit" sind Kategorien bzw. Zeitstempel und
        // bleiben für die statistische Aufbewahrung stehen.
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, zustand, \
                antreff_lat, antreff_lon, vermisst_seit, aktuelle_verbleib_art, \
                aktuelles_verbleib_ziel, aktueller_verbleib_status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'vermisst', 'gehfähig, unterkühlt', 52.2691, 9.1342, \
                '2026-01-01 06:00:00', 'transport', 'KH Mitte', 'angemeldet', ?, ?)",
        )
        .bind(einsatz.id)
        .bind(leit)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        // LFH-674: eine zweite Person mit Notunterkunft an einer Stelle — der Verweis ist eine
        // Kennung und bleibt, das Ziel (Stellenname als Freitext) wird leer.
        let stelle: i64 = sqlx::query_scalar(
            "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, 'NU Turnhalle Nord', 'notunterkunft', ?) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        let person2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, aktuelle_verbleib_art, \
                aktuelles_verbleib_ziel, aktuelle_verbleib_betreuungsstelle_id, erfasst_von, \
                geaendert_von) \
             VALUES (?, 2, 'betroffen', 'notunterkunft', 'NU Turnhalle Nord', ?, ?, ?) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(stelle)
        .bind(leit)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, betreuungsstelle_id, \
                erfasst_von) VALUES (?, ?, 'notunterkunft', 'NU Turnhalle Nord', ?, ?)",
        )
        .bind(einsatz.id)
        .bind(person2)
        .bind(stelle)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        #[allow(clippy::type_complexity)]
        let zeile: (
            Option<String>,
            Option<f64>,
            Option<f64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT zustand, antreff_lat, antreff_lon, aktuelles_verbleib_ziel, \
                    aktuelle_verbleib_art, aktueller_verbleib_status, vermisst_seit \
             FROM einsatz_person WHERE einsatz_id = ? AND registrier_nr = 1",
        )
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeile,
            (
                None,
                None,
                None,
                None,
                Some("transport".into()),
                Some("angemeldet".into()),
                Some("2026-01-01 06:00:00".into()),
            ),
            "Zustand, Koordinate und Ziel leer; Art, Status und vermisst_seit erhalten"
        );

        let cache: (Option<String>, Option<i64>) = sqlx::query_as(
            "SELECT aktuelles_verbleib_ziel, aktuelle_verbleib_betreuungsstelle_id \
             FROM einsatz_person WHERE id = ?",
        )
        .bind(person2)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            cache,
            (None, Some(stelle)),
            "Cache: Ziel leer, Verweis bleibt"
        );
        let ereignis: (Option<String>, Option<i64>) = sqlx::query_as(
            "SELECT ziel, betreuungsstelle_id FROM person_verbleib WHERE person_id = ?",
        )
        .bind(person2)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            ereignis,
            (None, Some(stelle)),
            "Ereignis: Ziel leer, Verweis bleibt"
        );
    }

    #[tokio::test]
    async fn schwaerzung_nullt_funk_erreichbarkeit_an_einheit_und_abschnitt() {
        // LFH-108: erreichbarkeit (mögliche Rufnummer der Führung) ist PII und MUSS an Einheit
        // UND Abschnitt genullt werden (Abschnitt-Lücke seit LFH-86 symmetrisch geschlossen).
        // kommunikationsmittel (Schlüssel digitalfunk/mobil/…) ist kein PII und bleibt.
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        abschliessen(&pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_einheit (einsatz_id, name, kommunikationsmittel, erreichbarkeit) \
             VALUES (?, 'Zug 1', 'digitalfunk', '0151 23456')",
        )
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatzabschnitt (einsatz_id, name, kommunikationsmittel, erreichbarkeit) \
             VALUES (?, 'Nord', 'mobil', '0170 98765')",
        )
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let (eh_err, eh_komm): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT erreichbarkeit, kommunikationsmittel FROM einsatz_einheit WHERE einsatz_id = ?",
        )
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(eh_err, None, "Einheit-Erreichbarkeit (PII) muss NULL sein");
        assert_eq!(
            eh_komm.as_deref(),
            Some("digitalfunk"),
            "Kommunikationsmittel (kein PII) bleibt erhalten"
        );

        let ab_err: Option<String> =
            sqlx::query_scalar("SELECT erreichbarkeit FROM einsatzabschnitt WHERE einsatz_id = ?")
                .bind(einsatz.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            ab_err, None,
            "Abschnitt-Erreichbarkeit (PII) muss NULL sein — bestehende Lücke geschlossen"
        );
    }

    /// Bereitet einen schwärzbaren Einsatz vor (abgeschlossen + soft-gelöscht).
    async fn schwaerzbarer_einsatz(pool: &SqlitePool) -> (i64, i64) {
        let leit = benutzer_anlegen(pool, "leit").await;
        let einsatz = test_anlegen(pool, "Lage", None, leit).await.unwrap();
        abschliessen(pool, einsatz.id, leit).await.unwrap();
        sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
            .bind("2026-01-01 00:00:00")
            .bind(einsatz.id)
            .execute(pool)
            .await
            .unwrap();
        (einsatz.id, leit)
    }

    #[tokio::test]
    async fn schwaerzung_entfernt_chat_und_erinnerungs_freitexte() {
        // LFH-290: Chat- und Erinnerungs-Freitexte tragen Personenbezug („Fam. Müller,
        // Tel. 0170 …“) und standen bis dahin als RETAIN v1 in der Registry. Sie werden
        // jetzt entfernt — auch in soft-gelöschten Nachrichten, deren Inhalt stehen blieb.
        // Die Struktur (ids, kanal_id, faellig_at, status) bleibt; ein Chat-Anhang geht
        // mit seiner Verknüpfung vollständig weg.
        let pool = crate::db::test_pool().await;
        let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
        let kanal_id: i64 = sqlx::query_scalar(
            "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
             VALUES (?, 'Absprache Fam. Müller', 'Kontakt Tochter 0170 111', ?) RETURNING id",
        )
        .bind(eid)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut nachricht_ids = Vec::new();
        for (inhalt, geloescht) in [
            ("Herr Schmidt, Hauptstr. 5, sitzt fest", None),
            (
                "Frau Meyer, Tel. 0151 222 — versehentlich gepostet",
                Some("2026-01-01 01:00:00"),
            ),
            ("Foto Familie Weber anbei", None),
        ] {
            let id: i64 = sqlx::query_scalar(
                "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt, geloescht_at) \
                 VALUES (?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(eid)
            .bind(kanal_id)
            .bind(leit)
            .bind(inhalt)
            .bind(geloescht)
            .fetch_one(&pool)
            .await
            .unwrap();
            nachricht_ids.push(id);
        }
        let anhang_id: i64 = sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'weber.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
        )
        .bind(eid)
        .bind(b"ABC".as_slice())
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO chat_nachricht_anhang (nachricht_id, anhang_id) VALUES (?, ?)")
            .bind(nachricht_ids[2])
            .bind(anhang_id)
            .execute(&pool)
            .await
            .unwrap();
        let erinnerung_id: i64 = sqlx::query_scalar(
            "INSERT INTO erinnerung (einsatz_id, titel, beschreibung, faellig_at, \
                empfaenger_funktion, status, erstellt_von_id) \
             VALUES (?, 'Rückruf Frau Meyer', 'Tel. 0151 222, Tochter vermisst', \
                '2026-01-01 12:00:00', 'Herr Müller (S2)', 'offen', ?) RETURNING id",
        )
        .bind(eid)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let kanal: (i64, i64, String, Option<String>) = sqlx::query_as(
            "SELECT id, einsatz_id, name, beschreibung FROM chat_kanal WHERE id = ?",
        )
        .bind(kanal_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            kanal,
            (kanal_id, eid, SCHWAERZUNG_PLATZHALTER.to_string(), None),
            "Kanal: Name Platzhalter, Beschreibung NULL, Struktur bleibt"
        );

        let nachrichten: Vec<(i64, i64, String, Option<String>)> = sqlx::query_as(
            "SELECT id, kanal_id, inhalt, geloescht_at FROM chat_nachricht \
             WHERE einsatz_id = ? ORDER BY id",
        )
        .bind(eid)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            nachrichten,
            vec![
                (
                    nachricht_ids[0],
                    kanal_id,
                    SCHWAERZUNG_PLATZHALTER.to_string(),
                    None
                ),
                (
                    nachricht_ids[1],
                    kanal_id,
                    SCHWAERZUNG_PLATZHALTER.to_string(),
                    Some("2026-01-01 01:00:00".to_string())
                ),
                (
                    nachricht_ids[2],
                    kanal_id,
                    SCHWAERZUNG_PLATZHALTER.to_string(),
                    None
                ),
            ],
            "jede Nachricht (auch die soft-gelöschte) trägt den Platzhalter"
        );

        let erinnerung: (i64, String, Option<String>, Option<String>, String, String) =
            sqlx::query_as(
                "SELECT id, titel, beschreibung, empfaenger_funktion, faellig_at, status \
                 FROM erinnerung WHERE id = ?",
            )
            .bind(erinnerung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            erinnerung,
            (
                erinnerung_id,
                SCHWAERZUNG_PLATZHALTER.to_string(),
                None,
                None,
                "2026-01-01 12:00:00".to_string(),
                "offen".to_string()
            ),
            "Erinnerung: Titel Platzhalter, Beschreibung und Empfänger NULL, Termin/Status bleiben"
        );

        let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
            .bind(eid)
            .fetch_one(&pool)
            .await
            .unwrap();
        let verknuepfungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_nachricht_anhang")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            (anhaenge, verknuepfungen),
            (0, 0),
            "Chat-Anhang samt Verknüpfung weg"
        );

        // Der Audit ist ein bleibender, rechtsverbindlicher ETB-Eintrag: er darf nur
        // behaupten, was die Registry tut — die FREITEXTE gehen, die Datensätze bleiben.
        let audit: String = sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag \
             WHERE einsatz_id = ? AND inhalt LIKE 'PII-Schwärzung durchgeführt%'",
        )
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            audit.contains("Freitexte von Chat-Kanälen, Chat-Nachrichten und Erinnerungen"),
            "Audit nennt die Chat-/Erinnerungs-Freitexte als entfernt: {audit}"
        );
        assert!(
            audit.contains("die Struktur von Chat und Erinnerungen"),
            "Audit nennt die erhaltene Struktur: {audit}"
        );
        assert!(
            !audit.contains("sowie Chat-Kanäle, Chat-Nachrichten und Erinnerungen)"),
            "kein Overclaim, die Datensätze seien entfernt: {audit}"
        );
    }

    #[tokio::test]
    async fn schwaerzung_nullt_sprechgruppen_hinweis_nur_einsatz_lokal() {
        // LFH-140: `sprechgruppe.hinweis` ist ein Freitext-Zettel („Ansprechpartner Herr
        // Müller …“) und wird genullt — aber NUR an einsatz-lokalen Sprechgruppen. Der
        // org-weite Katalog (einsatz_id NULL) gehört keinem Einsatz und bleibt unberührt;
        // `bezeichnung` ist Funkgruppen-Label (G_OP_LABEL) und bleibt überall.
        let pool = crate::db::test_pool().await;
        let (eid, _) = schwaerzbarer_einsatz(&pool).await;
        let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
            .bind(eid)
            .fetch_one(&pool)
            .await
            .unwrap();
        let lokal: i64 = sqlx::query_scalar(
            "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart, hinweis) \
             VALUES (?, ?, 'TMO_EINSATZ_1', 'TMO', 'Ansprechpartner Herr Müller 0170 111') \
             RETURNING id",
        )
        .bind(org_id)
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
        let katalog: i64 = sqlx::query_scalar(
            "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart, hinweis) \
             VALUES (?, NULL, 'TMO_KATALOG', 'TMO', 'Nur für Großlagen') RETURNING id",
        )
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let lies = |id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (String, Option<String>)>(
                    "SELECT bezeichnung, hinweis FROM sprechgruppe WHERE id = ?",
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
            }
        };
        assert_eq!(
            lies(lokal).await,
            ("TMO_EINSATZ_1".to_string(), None),
            "einsatz-lokal: Hinweis NULL, Bezeichnung bleibt"
        );
        assert_eq!(
            lies(katalog).await,
            (
                "TMO_KATALOG".to_string(),
                Some("Nur für Großlagen".to_string())
            ),
            "Gegenprobe org-weiter Katalog: Hinweis bleibt"
        );
    }

    #[tokio::test]
    async fn schwaerzung_nullt_alle_abschnitts_freitexte_und_haelt_die_labels() {
        // LFH-140, AK „kein Freitext überlebt“: bemerkung, erreichbarkeit und (LFH-608)
        // abschnittsauftrag werden NULL. Retain bleiben name, kurzbezeichnung, der
        // Kommunikationsmittel-Schlüssel und die eingefrorenen Alt-Spalten
        // sprechgruppe_tmo/_dmo — Letzteres ist die Entscheidung des Auftraggebers
        // (Funkgruppen-Label, konsistent mit `sprechgruppe.bezeichnung`).
        let pool = crate::db::test_pool().await;
        let (eid, _) = schwaerzbarer_einsatz(&pool).await;
        let aid: i64 = sqlx::query_scalar(
            "INSERT INTO einsatzabschnitt (einsatz_id, name, kurzbezeichnung, bemerkung, \
                kommunikationsmittel, erreichbarkeit, abschnittsauftrag, \
                sprechgruppe_tmo, sprechgruppe_dmo) \
             VALUES (?, 'Nord', 'EA-N', 'Fam. Weber evakuiert', 'festnetz', '0170 98765', \
                'Evakuierung Uferstraße 3, Familie Schulz', 'TMO_NORD', 'DMO_NORD') \
             RETURNING id",
        )
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
            .await
            .unwrap());

        #[allow(clippy::type_complexity)]
        let zeile: (
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT bemerkung, erreichbarkeit, abschnittsauftrag, \
                    name, kurzbezeichnung, kommunikationsmittel, sprechgruppe_tmo, sprechgruppe_dmo \
             FROM einsatzabschnitt WHERE id = ?",
        )
        .bind(aid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            zeile,
            (
                None,
                None,
                None,
                "Nord".to_string(),
                Some("EA-N".to_string()),
                Some("festnetz".to_string()),
                Some("TMO_NORD".to_string()),
                Some("DMO_NORD".to_string()),
            ),
            "Freitexte NULL; Name, Kürzel, Kommunikationsmittel und TMO/DMO bleiben"
        );
    }

    #[tokio::test]
    async fn schwaerzung_ersetzt_den_namen_der_kartenansicht() {
        // LFH-283: der Ansichts-Name kann PII tragen („Lage Fam. Müller“) → Platzhalter
        // (NOT NULL); die Konfiguration (Zentrum, Zoom) bleibt.
        let pool = crate::db::test_pool().await;
        let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
        let ansicht: i64 = sqlx::query_scalar(
            "INSERT INTO karten_ansicht (einsatz_id, name, zentrum_lat, zoom, erstellt_von) \
             VALUES (?, 'Lage Fam. Müller', 52.1, 14.0, ?) RETURNING id",
        )
        .bind(eid)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let (name, lat, zoom): (String, Option<f64>, Option<f64>) =
            sqlx::query_as("SELECT name, zentrum_lat, zoom FROM karten_ansicht WHERE id = ?")
                .bind(ansicht)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (name.as_str(), lat, zoom),
            (SCHWAERZUNG_PLATZHALTER, Some(52.1), Some(14.0))
        );
    }

    #[tokio::test]
    async fn schwaerzung_loescht_den_lage_snapshot() {
        // LFH-283: ein Lage-Snapshot friert das volle Lagebild samt PII ein (`daten`) und
        // hat keine ETB-Kopplung → die ganze Zeile geht weg.
        let pool = crate::db::test_pool().await;
        let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
        sqlx::query(
            "INSERT INTO lage_snapshot (einsatz_id, bezeichnung, notiz, stand_at, daten, erstellt_von) \
             VALUES (?, 'Stand 14 Uhr', 'Fam. Müller noch im Haus', '2026-01-01 14:00:00', \
                '{\"personen\":[\"Müller\"]}', ?)",
        )
        .bind(eid)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

        assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
            .await
            .unwrap());

        let anzahl: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM lage_snapshot WHERE einsatz_id = ?")
                .bind(eid)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(anzahl, 0, "Snapshot-Zeile samt Lagebild weg");
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

        let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap();
        assert_eq!(abgeschlossen.retention_bis, None);
    }

    /// Einsatz-Override NULL, Org-Default=30 → Effektivwert 30 → retention_bis gesetzt.
    #[tokio::test]
    async fn abschliessen_org_default_befuellt_retention_bis() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
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
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

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

    /// Legt einen Einsatz mit fester ID per SQL an — die ID-Vergabe von [`anlegen_tx`]
    /// soll hier gegen einen bekannten Höchstwert laufen, nicht gegen die eigene.
    async fn einsatz_mit_id(pool: &SqlitePool, id: i64) {
        sqlx::query("INSERT INTO einsatz (id, org_id, bezeichnung) VALUES (?, 1, 'Bestand')")
            .bind(id)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Kopf eines (entfernten) Demo-Imports per SQL — `einsatz_id` ohne FK, wie in der
    /// Historie nach dem Entfernen (LFH-690 D6).
    async fn demo_historie(pool: &SqlitePool, einsatz_id: i64) {
        sqlx::query(
            "INSERT INTO demo_import (org_id, einsatz_id, entfernt_at, bericht) \
             VALUES (1, ?, datetime('now'), '{}')",
        )
        .bind(einsatz_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// LFH-690 D6: Die ID eines entfernten Demo-Einsatzes wird nie wiedervergeben. Höchste
    /// Einsatz-ID 5, Demo-Historie mit ID 7 → der neue Einsatz bekommt 8, nicht 6. Die Sperre
    /// hebt nur an: liegt die Historie darunter, gilt wieder der Höchstwert der Einsätze.
    #[tokio::test]
    async fn anlegen_ueberspringt_die_id_eines_entfernten_demo_einsatzes() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        einsatz_mit_id(&pool, 5).await;
        demo_historie(&pool, 7).await;

        let neu = test_anlegen(&pool, "Echter Einsatz", None, leit)
            .await
            .unwrap();
        assert_eq!(
            neu.id, 8,
            "über der gesperrten Demo-ID 7, nicht MAX(id)+1 = 6"
        );

        let danach = test_anlegen(&pool, "Nächster", None, leit).await.unwrap();
        assert_eq!(
            danach.id, 9,
            "Historie unter dem Höchstwert erzeugt keine Lücke"
        );
    }

    /// LFH-690 D6: Ohne Demo-Historie ist die Vergabe dieselbe wie SQLites eigene
    /// (`MAX(rowid)+1`) — für Bestandsinstanzen ändert sich nichts. Läuft direkt über
    /// [`anlegen_tx`] auf einer Transaktion des Aufrufers.
    #[tokio::test]
    async fn anlegen_tx_ohne_demo_historie_vergibt_ohne_luecke() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        einsatz_mit_id(&pool, 5).await;

        let mut tx = pool.begin().await.unwrap();
        let id = anlegen_tx(
            &mut tx,
            &NeuerEinsatzDaten {
                bezeichnung: "Echter Einsatz",
                stichwort: None,
                einsatzart: None,
                begonnen_at: None,
            },
            leit,
            Utc::now(),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        assert_eq!(id, 6);
        let rolle = rolle_von(&pool, id, leit).await.unwrap();
        assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
    }

    #[tokio::test]
    async fn anlegen_vergibt_fortlaufende_einsatznummer() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;

        let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

        let a = test_anlegen(&pool, "Lage A", None, leit).await.unwrap();
        let b = test_anlegen(&pool, "Lage B", None, leit).await.unwrap();
        assert_eq!(
            a.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0001").as_str())
        );
        assert_eq!(
            b.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0002").as_str())
        );

        // angelegt_at wurde gesetzt (nicht der '' Default).
        assert!(!a.angelegt_at.is_empty());
    }

    #[tokio::test]
    async fn anlegen_zaehlt_je_organisation_getrennt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await; // legt Org id=1 an

        let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

        // Zweite Organisation mit bereits hoher Nummer — darf Org 1 nicht beeinflussen.
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Orga 2')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, nummer_lfd) \
             VALUES (2, 'Fremd', ?, ?, 9)",
        )
        .bind(format!("E-{jahr}-0009"))
        .bind(jahr)
        .execute(&pool)
        .await
        .unwrap();

        // anlegen nutzt die Org des Erstellers (Org 1) → beginnt bei 0001.
        let a = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        assert_eq!(
            a.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0001").as_str())
        );
    }

    /// LFH-617: Bestandsnummern `JJJJ-NNN` (von 0115 in die Zahlenspalten übernommen) zählen
    /// mit — die Zählung setzt dahinter fort, ihr Text bleibt wörtlich. Ein Vorjahr zählt nicht.
    #[tokio::test]
    async fn anlegen_setzt_hinter_bestandsnummern_fort() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

        for (text, j, lfd) in [
            (format!("{jahr}-001"), jahr, 1),
            (format!("{jahr}-003"), jahr, 3),
            (format!("{}-042", jahr - 1), jahr - 1, 42),
        ] {
            sqlx::query(
                "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, nummer_lfd) \
                 VALUES (1, 'Bestand', ?, ?, ?)",
            )
            .bind(&text)
            .bind(j)
            .bind(lfd)
            .execute(&pool)
            .await
            .unwrap();
        }

        let neu = test_anlegen(&pool, "Neu", None, leit).await.unwrap();
        assert_eq!(
            neu.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0004").as_str())
        );
        let bestand: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE einsatznummer_intern IN (?, ?)")
                .bind(format!("{jahr}-001"))
                .bind(format!("{jahr}-003"))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(bestand, 2, "Bestandstext bleibt wörtlich");
    }

    /// LFH-617 (Review): ein früher VON HAND gesetzter Text, der zufällig dem neuen Muster
    /// entspricht, trägt keine Zahlen (0115 übernimmt nur `JJJJ-NNN`) und zählt nicht mit.
    /// Ohne Ausweichen entstünde derselbe Text erneut, der Text-Index aus 0005 schlüge an —
    /// und weil MAX(nummer_lfd) dann nie wächst, bei JEDEM weiteren Versuch: die Org könnte
    /// in diesem Jahr keinen Einsatz mehr anlegen. Die Vergabe überspringt belegte Texte.
    #[tokio::test]
    async fn anlegen_ueberspringt_handbelegten_nummerntext() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);
        for text in [format!("E-{jahr}-0001"), format!("E-{jahr}-0002")] {
            sqlx::query("INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (1, 'Hand', ?)")
                .bind(text)
                .execute(&pool)
                .await
                .unwrap();
        }

        let a = test_anlegen(&pool, "A", None, leit).await.unwrap();
        assert_eq!(
            a.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0003").as_str())
        );
        let b = test_anlegen(&pool, "B", None, leit).await.unwrap();
        assert_eq!(
            b.einsatznummer_intern.as_deref(),
            Some(format!("E-{jahr}-0004").as_str())
        );
    }

    /// LFH-617: das Org-Präfix wird beim Anlegen eingefroren — ein späterer Wechsel trifft
    /// nur neue Einsätze, die Zählung läuft über den Wechsel hinweg weiter.
    #[tokio::test]
    async fn praefixwechsel_trifft_nur_neue_einsaetze() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

        let alt = test_anlegen(&pool, "Alt", None, leit).await.unwrap();
        sqlx::query(
            "INSERT INTO org_einstellungen (org_id, einsatz_nummer_praefix) VALUES (1, 'WF-')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let neu = test_anlegen(&pool, "Neu", None, leit).await.unwrap();

        assert_eq!(
            laden(&pool, alt.id)
                .await
                .unwrap()
                .einsatznummer_intern
                .as_deref(),
            Some(format!("E-{jahr}-0001").as_str()),
            "bestehende Nummer ändert sich nicht"
        );
        assert_eq!(
            neu.einsatznummer_intern.as_deref(),
            Some(format!("WF-{jahr}-0002").as_str())
        );
    }

    /// LFH-617: das Jahr folgt der Org-Zeitzone, nicht UTC. Fester Zeitpunkt in der
    /// Neujahrsnacht (23:30 UTC = 00:30 MEZ): Berlin zählt schon 2027, eine Org mit
    /// Zeitzone `UTC` noch 2026. Mit der früheren `strftime`-Vergabe wären beide 2026.
    #[tokio::test]
    async fn anlegen_zaehlt_das_jahr_in_der_org_zeitzone() {
        use chrono::TimeZone;
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let silvester = chrono::Utc
            .with_ymd_and_hms(2026, 12, 31, 23, 30, 0)
            .unwrap();
        let daten = || NeuerEinsatzDaten {
            bezeichnung: "Neujahr",
            stichwort: None,
            einsatzart: None,
            begonnen_at: None,
        };

        // Ohne Einstellung: Europe/Berlin.
        let berlin = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
        assert_eq!(berlin.einsatznummer_intern.as_deref(), Some("E-2027-0001"));

        // Org stellt UTC ein → dieselbe Sekunde gehört noch zu 2026.
        sqlx::query("INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')")
            .execute(&pool)
            .await
            .unwrap();
        let utc = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
        assert_eq!(utc.einsatznummer_intern.as_deref(), Some("E-2026-0001"));

        // Unbekannte Zeitzone (die Einstellung prüft nur „nicht leer“): das Anlegen
        // gelingt und zählt wie Europe/Berlin.
        sqlx::query("UPDATE org_einstellungen SET zeitzone = 'Quatsch/Zone' WHERE org_id = 1")
            .execute(&pool)
            .await
            .unwrap();
        let quatsch = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
        assert_eq!(quatsch.einsatznummer_intern.as_deref(), Some("E-2027-0002"));
    }

    /// Migriert aus `aktualisiere_kopf_setzt_felder_und_leere_optionals_null` (LFH-306):
    /// ein VOLLSTÄNDIGER Patch verhält sich weiterhin wie der frühere Vollersatz, und der
    /// explizite Leerwunsch (`Some(None)`) schreibt weiterhin NULL. Zugleich der
    /// Bind-Reihenfolge-Test der zwölf Flag/Wert-Paare: jede Spalte trägt einen anderen
    /// Wert und wird einzeln geprüft — eine verschobene Kette vertauschte
    /// `meldende_stelle`↔`sachverhalt` bzw. `einsatzort_lat`↔`einsatzort_lon` still.
    #[tokio::test]
    async fn patche_kopf_setzt_jede_spalte_an_ihren_platz() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Alt", None, leit).await.unwrap();

        let aktualisiert = patche_kopf(
            &pool,
            einsatz.id,
            KopfPatch {
                bezeichnung: Some("Neu"),
                stichwort: Some(Some("H1")),
                einsatzart: Some(crate::einsatz::EINSATZART_UEBUNG),
                leitstellen_nr: Some(None),
                einsatzort: Some(Some("Hauptstraße 1")),
                einsatzort_lat: Some(Some(52.5)),
                einsatzort_lon: Some(Some(13.4)),
                meldende_stelle: Some(None),
                sachverhalt: Some(Some("Mehrzeiliges\nMeldebild")),
                anzahl_betroffene_initial: Some(Some(3)),
                begonnen_at: Some("2026-05-25 08:00:00"),
                naechste_lagebesprechung_at: Some(Some("2026-05-25 10:17:43")),
            },
        )
        .await
        .unwrap();

        assert_eq!(aktualisiert.bezeichnung, "Neu");
        assert_eq!(aktualisiert.stichwort.as_deref(), Some("H1"));
        assert_eq!(aktualisiert.einsatzart, Einsatzart::Uebung);
        assert_eq!(aktualisiert.einsatzort.as_deref(), Some("Hauptstraße 1"));
        assert_eq!(aktualisiert.einsatzort_lat, Some(52.5));
        assert_eq!(aktualisiert.einsatzort_lon, Some(13.4));
        assert_eq!(
            aktualisiert.sachverhalt.as_deref(),
            Some("Mehrzeiliges\nMeldebild")
        );
        assert_eq!(aktualisiert.anzahl_betroffene_initial, Some(3));
        assert_eq!(aktualisiert.leitstellen_nr, None, "Some(None) leert");
        assert_eq!(aktualisiert.meldende_stelle, None, "Some(None) leert");
        assert_eq!(aktualisiert.begonnen_at, "2026-05-25 08:00:00");
        assert_eq!(
            aktualisiert.naechste_lagebesprechung_at.as_deref(),
            Some("2026-05-25 10:17:43")
        );
        // angelegt_at bleibt unverändert (Audit-Spur).
        assert_eq!(aktualisiert.angelegt_at, einsatz.angelegt_at);
        // Die Einsatznummer schreibt nur `anlegen` (LFH-617).
        assert_eq!(
            aktualisiert.einsatznummer_intern,
            einsatz.einsatznummer_intern
        );
    }

    /// Der Kern von LFH-306: ein Patch fasst nur die gesendeten Spalten an. Der
    /// `Default`-Patch (alle Felder absent) lässt die Zeile vollständig in Ruhe —
    /// insbesondere springt `begonnen_at` nicht auf `now`.
    #[tokio::test]
    async fn patche_kopf_laesst_nicht_gesendete_spalten_stehen() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let einsatz = test_anlegen(&pool, "Alt", None, leit).await.unwrap();
        let voll = patche_kopf(
            &pool,
            einsatz.id,
            KopfPatch {
                stichwort: Some(Some("H1")),
                einsatzort: Some(Some("Hauptstraße 1")),
                meldende_stelle: Some(Some("Leitstelle")),
                sachverhalt: Some(Some("Meldebild")),
                anzahl_betroffene_initial: Some(Some(3)),
                begonnen_at: Some("2026-05-25 08:00:00"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let nachher = patche_kopf(
            &pool,
            einsatz.id,
            KopfPatch {
                einsatzort_lat: Some(Some(52.5)),
                einsatzort_lon: Some(Some(13.4)),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(nachher.einsatzort_lat, Some(52.5));
        assert_eq!(nachher.bezeichnung, voll.bezeichnung);
        assert_eq!(nachher.stichwort, voll.stichwort);
        assert_eq!(nachher.einsatzort, voll.einsatzort);
        assert_eq!(nachher.meldende_stelle, voll.meldende_stelle);
        assert_eq!(nachher.sachverhalt, voll.sachverhalt);
        assert_eq!(
            nachher.anzahl_betroffene_initial,
            voll.anzahl_betroffene_initial
        );
        assert_eq!(nachher.einsatznummer_intern, voll.einsatznummer_intern);
        assert_eq!(
            nachher.begonnen_at, "2026-05-25 08:00:00",
            "Alarmzeit darf nicht auf 'now' springen"
        );

        // Leerer Patch → die Zeile bleibt vollständig, kein Fehler.
        let unveraendert = patche_kopf(&pool, einsatz.id, KopfPatch::default())
            .await
            .unwrap();
        assert_eq!(unveraendert.stichwort, voll.stichwort);
        assert_eq!(unveraendert.begonnen_at, "2026-05-25 08:00:00");
    }

    /// Ersetzt `patche_kopf_doppelte_nummer_ist_conflict`: bis LFH-617 war die Nummer per
    /// Patch setzbar und ein Duplikat ergab 409. Jetzt kennt `KopfPatch` das Feld nicht
    /// mehr, und ein Patch anderer Kopffelder lässt Text UND Zahlenspalten stehen.
    #[tokio::test]
    async fn patche_kopf_laesst_die_einsatznummer_unberuehrt() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let a = test_anlegen(&pool, "A", None, leit).await.unwrap();
        let vorher: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
        )
        .bind(a.id)
        .fetch_one(&pool)
        .await
        .unwrap();

        patche_kopf(
            &pool,
            a.id,
            KopfPatch {
                bezeichnung: Some("A2"),
                leitstellen_nr: Some(Some("LS-1")),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let nachher: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
        )
        .bind(a.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(nachher, vorher);
        assert!(vorher.0.is_some() && vorher.1.is_some() && vorher.2 == Some(1));
    }

    #[tokio::test]
    async fn liste_fuer_zeigt_admin_nicht_mitglied_fremden_einsatz() {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let admin = benutzer_anlegen(&pool, "admin").await;
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

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

//! Persistenz der Lagebesprechung (LLH-1111, aus `stab/repo.rs` herausgelöst).
//!
//! Der Abschluss schreibt ETB-Eintrag, Zeile und Termin in **einer** Transaktion (LFH-46,
//! Entscheidung 9). Der Termin ohne Abschluss schreibt nur die Spalte am Einsatz und keinen
//! ETB-Eintrag (Entscheidung Ruben, 12.10.2026, design.md D3): er ist eine Wiedervorlage, keine
//! Entscheidung.

use sqlx::SqlitePool;

use super::{LagebesprechungAnzeige, LagebesprechungStand};
use crate::error::AppError;
use crate::write_retry;

// Die Spaltenliste steht in beiden Abfragen AUSGESCHRIEBEN statt als zusammengesetzter String:
// `sqlx` lehnt dynamisch gebaute SQL-Strings ab (Injection-Audit), ein `format!` wäre hier also
// nicht bloss unnötig, sondern ein Compile-Fehler.
const SELECT_LETZTE_BESPRECHUNG: &str =
    "SELECT id, einsatz_id, lfd_nr, abgehalten_at, entschluss, naechste_at, \
            etb_eintrag_id, erfasst_von_id, erfasst_at \
     FROM einsatz_lagebesprechung WHERE einsatz_id = ? ORDER BY lfd_nr DESC LIMIT 1";

const SELECT_BESPRECHUNGEN: &str =
    "SELECT id, einsatz_id, lfd_nr, abgehalten_at, entschluss, naechste_at, \
            etb_eintrag_id, erfasst_von_id, erfasst_at \
     FROM einsatz_lagebesprechung WHERE einsatz_id = ? ORDER BY lfd_nr DESC";

/// Lädt den Stand: nächster Termin, Zahl und letzte Besprechung.
///
/// ALLE drei Abfragen in EINER Lesetransaktion. Einzeln gegen den Pool gefahren könnten sie
/// einen sich selbst widersprechenden Stand liefern: schliesst nebenher jemand eine
/// Lagebesprechung ab, stünde `letzte_lagebesprechung` noch bei Nr. 1, während
/// `anzahl_lagebesprechungen` schon 2 zeigt und der Termin aus Nr. 2 stammt. Dieselbe Antwort ist
/// auch die QUITTUNG der Schreibrouten — und die darf keinen Zustand tragen, den es nie gab
/// (LFH-340/C5). SQLite hält unter WAL ab dem ersten Lesen einen konsistenten Snapshot bis zum
/// Commit.
pub async fn load_stand(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<LagebesprechungStand, AppError> {
    let mut tx = pool.begin().await?;

    let letzte = sqlx::query_as::<_, LagebesprechungAnzeige>(SELECT_LETZTE_BESPRECHUNG)
        .bind(einsatz_id)
        .fetch_optional(&mut *tx)
        .await?;

    let anzahl: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(&mut *tx)
            .await?;

    let termin: Option<String> =
        sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *tx)
            .await?
            .flatten();

    tx.commit().await?;

    Ok(LagebesprechungStand {
        naechste_lagebesprechung_at: termin,
        anzahl_lagebesprechungen: anzahl,
        letzte_lagebesprechung: letzte,
    })
}

/// Alle Lagebesprechungen absteigend nach `lfd_nr`.
///
/// Kein Cursor in v1: im Fükw entstehen Dutzende, nicht Tausende `[abgeleitet]`;
/// Paginierung ist Stufe-D-Bedarf.
pub async fn list(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LagebesprechungAnzeige>, AppError> {
    sqlx::query_as::<_, LagebesprechungAnzeige>(SELECT_BESPRECHUNGEN)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// Setzt den Termin der nächsten Lagebesprechung ohne Abschluss (`None` = kein Termin).
///
/// Liefert, ob sich der Termin TATSÄCHLICH geändert hat: nur dann meldet die Route den
/// Einsatzkopf live (LFH-555). Das `IS NOT`-Prädikat ist die Änderungserkennung, ein gleicher
/// Wert (auch NULL auf NULL) trifft keine Zeile. Der Aktiv-Riegel in der Transaktion schliesst
/// das Fenster zu einem konkurrierenden „Einsatz abschliessen“ (wie beim Abschluss).
pub async fn set_termin(
    pool: &SqlitePool,
    einsatz_id: i64,
    termin: Option<&str>,
) -> Result<bool, AppError> {
    write_retry!(pool, |conn| {
        crate::stab::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let geaendert = sqlx::query(
            "UPDATE einsatz SET naechste_lagebesprechung_at = ?1 \
             WHERE id = ?2 AND naechste_lagebesprechung_at IS NOT ?1",
        )
        .bind(termin)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected()
            == 1;
        Ok(geaendert)
    })
}

/// Validierte Eingabe für den Abschluss einer Lagebesprechung.
///
/// `naechste_at` ist **Tri-State**: `None` = Termin unverändert, `Some(None)` = Termin löschen,
/// `Some(Some(t))` = Termin setzen. Die Zeiten sind bereits normalisiert (Route).
#[derive(Debug, Clone)]
pub struct AbschlussEingabe {
    pub entschluss: String,
    pub abgehalten_at: String,
    pub naechste_at: Option<Option<String>>,
}

/// Ergebnis eines Abschlusses: Nummer und ETB-Eintrag für Quittung und ETB-Kurzruf, dazu, ob
/// der Termin am Einsatz sich TATSÄCHLICH geändert hat. Nur dann meldet die Route den
/// Einsatzkopf live (LFH-555, design.md D3): ein Abschluss ohne neuen Termin verrät einem
/// Kopf-Leser ohne Lagebesprechungs-Recht sonst, DASS eine Besprechung stattfand (Entscheidung 11).
#[derive(Debug, Clone, Copy)]
pub struct AbschlussErgebnis {
    pub lfd_nr: i64,
    pub etb_eintrag_id: i64,
    pub termin_geaendert: bool,
}

/// Schliesst eine Lagebesprechung ab: ETB-Eintrag (`typ='entscheidung'`), Zeile mit
/// Rückverweis und — bei gesetztem Schlüssel — der Einsatztermin, alles in **EINER**
/// Transaktion (Entscheidung 9; FwDV 100 Abschn. 3.3.3.2, S. 42: „bei oder unmittelbar nach
/// Erteilung dokumentieren").
///
/// Liefert [`AbschlussErgebnis`] für die Quittung, den ETB-Kurzruf und das Kopf-Ereignis.
///
/// **Der Aktiv-Riegel nach den beiden Inserts ist der Rollback-Zweig dieser Transaktion** und
/// damit der Träger der Atomaritäts-Zusicherung: schlägt er an, verwirft der Rollback
/// ETB-Eintrag UND Zeile (Muster `lagebericht/repo.rs::freigeben`).
///
/// Das ist **keine** Redundanz zu `fordere_aktiv` auf der Route, und der Zweig ist **sehr
/// wohl über die Route erreichbar** — eine frühere Fassung dieses Kommentars behauptete das
/// Gegenteil und lag falsch: `fordere_aktiv` liest im Extractor einen Stand von VOR der
/// Transaktion, und `write_retry!` (`src/tx.rs`) wartet bei BUSY am `BEGIN IMMEDIATE` mit
/// Backoff. Hält ein konkurrierendes „Einsatz abschliessen" gerade den Schreib-Lock, wartet
/// dieser Aufruf also absichtlich, bis jenes committet hat — der Retry-Pfad VERBREITERT das
/// Fenster, statt es zu schliessen. Genau deshalb ist der Riegel unbedingt und nicht an den
/// Termin-Schlüssel gehängt.
///
/// Der Test ruft die Funktion trotzdem direkt: über die Route ist der Zweig zwar erreichbar,
/// aber nur in einem Rennen, das ein Test nicht verlässlich herstellt.
pub async fn abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &AbschlussEingabe,
) -> Result<AbschlussErgebnis, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;

    write_retry!(pool, |conn| {
        // 1. Server-autoritative, lückenlose Nummer je Einsatz.
        let lfd_nr: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(lfd_nr) + 1, 1) FROM einsatz_lagebesprechung WHERE einsatz_id = ?",
        )
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;

        // 2. Der Termin-Snapshot: bei `None` (unverändert) der AKTUELLE Wert aus `einsatz` —
        //    der Beleg muss tragen, welcher Termin nach der Besprechung galt, nicht „nichts".
        let snapshot: Option<String> = match &eingabe.naechste_at {
            Some(wert) => wert.clone(),
            None => {
                sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
                    .bind(einsatz_id)
                    .fetch_optional(&mut *conn)
                    .await?
                    .flatten()
            }
        };

        // 3. ETB-Eintrag vom Typ `entscheidung` — ein FACHLICHER Eintrag (kein `system`): er
        //    dokumentiert die Entscheidung der Einsatzleitung, nicht eine Systemhandlung.
        let inhalt = super::render_snapshot(
            lfd_nr,
            &eingabe.abgehalten_at,
            &eingabe.entschluss,
            snapshot.as_deref(),
        );
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            etb_startwert,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_ENTSCHEIDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: Some("Lagebesprechung"),
                ereigniszeit: Some(&eingabe.abgehalten_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;

        // 4. Die Zeile mit Rückverweis auf den Beleg.
        sqlx::query(
            "INSERT INTO einsatz_lagebesprechung \
                (einsatz_id, lfd_nr, abgehalten_at, entschluss, naechste_at, etb_eintrag_id, \
                 erfasst_von_id, erfasst_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(einsatz_id)
        .bind(lfd_nr)
        .bind(&eingabe.abgehalten_at)
        .bind(eingabe.entschluss.trim())
        .bind(snapshot.as_deref())
        .bind(etb_id)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;

        // 5. Der Einsatz muss noch aktiv sein — UNBEDINGT, nicht nur wenn ein Termin mitkommt.
        //
        // Die Prüfung steht ABSICHTLICH hier, nach den beiden Inserts: sie ist damit der
        // Träger der Atomaritäts-Zusicherung (Rollback verwirft ETB-Eintrag UND Zeile → kein
        // verwaister Beleg). Vorgezogen wäre sie billiger, aber dann schriebe die Transaktion
        // im Fehlerfall gar nichts, und die Mutationsprobe in `tests/lagebesprechung.rs` („eine
        // Transaktion durch drei Einzelaufrufe ersetzt ⇒ Test rot") verlöre ihren Gegenstand.
        //
        // Unbedingt statt am Termin-Schlüssel hängend (Codex-Review zu PR #60, P2): sonst
        // liefe der Abschluss OHNE `naechste_at` durch die Transaktion, ohne den Zustand des
        // Einsatzes je zu prüfen. `fordere_aktiv` im Extractor liest einen Stand von VOR der
        // Transaktion; ein ETB-Eintrag vom Typ `entscheidung` ist append-only und gehört nicht
        // in einen abgeschlossenen Einsatz. Der Riegel schliesst das Fenster ganz, weil
        // `write_retry!` mit `BEGIN IMMEDIATE` den Schreib-Lock schon am BEGIN hält: ein
        // konkurrierender Abschluss committet entweder vor unserem BEGIN (dann sieht dieses
        // SELECT ihn) oder erst nach unserem COMMIT.
        crate::stab::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;

        // 6. Der Einsatztermin — nur bei gesetztem Schlüssel (Tri-State). Ohne
        //    `status`-Prädikat: Schritt 5 hat es in derselben Transaktion bereits belegt, ein
        //    zweites hier wäre ein Zweig, den kein Test mehr erreichen kann. Das `IS NOT`-
        //    Prädikat ist kein Riegel, sondern die Änderungserkennung für das Kopf-Ereignis
        //    (LFH-555): ein gleicher Wert (auch NULL auf NULL) trifft keine Zeile. Die Route hat
        //    die Zeit normalisiert, andere Schreibweisen desselben Zeitpunkts sind hier gleich.
        let termin_geaendert = match &eingabe.naechste_at {
            Some(wert) => {
                sqlx::query(
                    "UPDATE einsatz SET naechste_lagebesprechung_at = ?1 \
                     WHERE id = ?2 AND naechste_lagebesprechung_at IS NOT ?1",
                )
                .bind(wert.as_deref())
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?
                .rows_affected()
                    == 1
            }
            None => false,
        };

        Ok(AbschlussErgebnis {
            lfd_nr,
            etb_eintrag_id: etb_id,
            termin_geaendert,
        })
    })
}

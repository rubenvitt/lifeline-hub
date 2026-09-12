//! Persistenz der Führungsorganisation (LFH-46).
//!
//! **Keine Besetzungshistorie** (Entscheidung 7): ein Wechsel überschreibt die Zeile und
//! schreibt einen System-ETB-Eintrag (Tier A, atomar mit dem Domänen-Write) mit
//! Vorher/Nachher. Das ETB ist der Nachweis der Tätigkeit der Einsatzleitung
//! (FwDV 100 Anlage 5, S. 64); der Verlauf ist damit beweissicher rekonstruierbar, ohne
//! abfragbar sein zu müssen.

use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

use super::{BesetzungArt, LagebesprechungAnzeige, Sachgebiet, StabAnzeige, StabsfunktionAnzeige};
use crate::error::AppError;
use crate::write_retry;

/// Validierte Eingabe für das Setzen einer Sachgebietszeile.
///
/// Die Invarianten (`personal` ⇒ `personal_id`, `extern`/`rueckwaertig` ⇒ `bezeichnung`,
/// `einsatzleitung` ⇒ beides leer) prüft die Route, nicht die DB — wie bei
/// `auftrag_empfaenger` gibt es bewusst keinen Mehrspalten-CHECK.
#[derive(Debug, Clone)]
pub struct BesetzungEingabe {
    pub besetzung_art: BesetzungArt,
    pub personal_id: Option<i64>,
    pub bezeichnung: Option<String>,
}

/// Eine Zeile wie sie in der DB steht.
#[derive(sqlx::FromRow)]
struct Zeile {
    #[sqlx(try_from = "String")]
    sachgebiet: Sachgebiet,
    #[sqlx(try_from = "String")]
    besetzung_art: BesetzungArt,
    personal_id: Option<i64>,
    snap_name: Option<String>,
    bezeichnung: Option<String>,
    gesetzt_von_id: i64,
    gesetzt_at: String,
    /// 1, wenn die referenzierte Disposition noch existiert.
    noch_disponiert: i64,
}

impl Zeile {
    fn zu_anzeige(self) -> StabsfunktionAnzeige {
        // `name` ist je Art aus verschiedenen Spalten gespeist; bei `einsatzleitung` trägt
        // die Zeile bewusst keinen Namen (die Aufgabe liegt bei der EL, nicht bei einer Person).
        let name = match self.besetzung_art {
            BesetzungArt::Personal => self.snap_name,
            BesetzungArt::Extern | BesetzungArt::Rueckwaertig => self.bezeichnung,
            BesetzungArt::Einsatzleitung => None,
        };
        StabsfunktionAnzeige {
            sachgebiet: self.sachgebiet,
            besetzung_art: self.besetzung_art,
            personal_id: self.personal_id,
            name,
            // Nur für `personal` aussagekräftig; sonst trivial `true` (es gibt keine
            // Disposition, die verschwinden könnte).
            personal_noch_disponiert: match self.besetzung_art {
                BesetzungArt::Personal => self.noch_disponiert == 1,
                _ => true,
            },
            gesetzt_von_id: self.gesetzt_von_id,
            gesetzt_at: self.gesetzt_at,
        }
    }
}

const SELECT_ZEILEN: &str = "SELECT s.sachgebiet, s.besetzung_art, s.personal_id, s.snap_name, \
            s.bezeichnung, s.gesetzt_von_id, s.gesetzt_at, \
            CASE WHEN s.personal_id IS NOT NULL THEN 1 ELSE 0 END AS noch_disponiert \
     FROM einsatz_stabsfunktion s \
     WHERE s.einsatz_id = ? \
     ORDER BY s.sachgebiet";

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

/// Lädt die Führungsorganisation eines Einsatzes (nur belegte Zeilen, `s1..s6`).
///
/// Der Termin kommt aus `einsatz` — eine Spalte, kein eigenes Cache-Fach (Entscheidung 11).
pub async fn laden(pool: &SqlitePool, einsatz_id: i64) -> Result<StabAnzeige, AppError> {
    // ALLE vier Abfragen in EINER Lesetransaktion. Einzeln gegen den Pool gefahren könnten sie
    // einen sich selbst widersprechenden Stand liefern: schliesst nebenher jemand eine
    // Lagebesprechung ab, stünde `letzte_lagebesprechung` noch bei Nr. 1, während
    // `anzahl_lagebesprechungen` schon 2 zeigt und der Termin aus Nr. 2 stammt. Dieselbe
    // Antwort ist auch die QUITTUNG der beiden Schreibrouten — und die darf keinen Zustand
    // tragen, den es nie gab (LFH-340/C5). SQLite hält unter WAL ab dem ersten Lesen einen
    // konsistenten Snapshot bis zum Commit.
    let mut tx = pool.begin().await?;

    let zeilen = sqlx::query_as::<_, Zeile>(SELECT_ZEILEN)
        .bind(einsatz_id)
        .fetch_all(&mut *tx)
        .await?;

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

    Ok(StabAnzeige {
        besetzung: zeilen.into_iter().map(Zeile::zu_anzeige).collect(),
        letzte_lagebesprechung: letzte,
        anzahl_lagebesprechungen: anzahl,
        naechste_lagebesprechung_at: termin,
    })
}

/// Alle Lagebesprechungen absteigend nach `lfd_nr`.
///
/// Kein Cursor in v1: im Fükw entstehen Dutzende, nicht Tausende `[abgeleitet]`;
/// Paginierung ist Stufe-D-Bedarf.
pub async fn lagebesprechungen(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LagebesprechungAnzeige>, AppError> {
    sqlx::query_as::<_, LagebesprechungAnzeige>(SELECT_BESPRECHUNGEN)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
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

/// Schliesst eine Lagebesprechung ab: ETB-Eintrag (`typ='entscheidung'`), Zeile mit
/// Rückverweis und — bei gesetztem Schlüssel — der Einsatztermin, alles in **EINER**
/// Transaktion (Entscheidung 9; FwDV 100 Abschn. 3.3.3.2, S. 42: „bei oder unmittelbar nach
/// Erteilung dokumentieren").
///
/// Liefert `(lfd_nr, etb_eintrag_id)` für die Quittung und den ETB-Kurzruf.
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
pub async fn lagebesprechung_abschliessen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &AbschlussEingabe,
) -> Result<(i64, i64), AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();

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
        // im Fehlerfall gar nichts, und die Mutationsprobe in `tests/stab.rs` („eine
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
        fordere_aktiv_in_tx(conn, einsatz_id).await?;

        // 6. Der Einsatztermin — nur bei gesetztem Schlüssel (Tri-State). Ohne
        //    `status`-Prädikat: Schritt 5 hat es in derselben Transaktion bereits belegt, ein
        //    zweites hier wäre ein Zweig, den kein Test mehr erreichen kann.
        if let Some(wert) = &eingabe.naechste_at {
            sqlx::query("UPDATE einsatz SET naechste_lagebesprechung_at = ? WHERE id = ?")
                .bind(wert.as_deref())
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
        }

        Ok((lfd_nr, etb_id))
    })
}

/// Prüft, dass `personal_id` eine Disposition **dieses** Einsatzes ist, und liefert deren
/// `snap_name` für den Führungsnachweis.
///
/// Die Prüfung geht gegen `einsatz_personal.einsatz_id`, **nie** nur gegen die Org: eine
/// Person aus einem anderen Einsatz derselben Organisation ist hier nicht zuordenbar
/// (referenzielle Zuordenbarkeit, Muster `sprechgruppe/repo.rs::pruefe_zuordenbar` → 422).
async fn snap_name_von(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    personal_id: i64,
) -> Result<String, AppError> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT snap_name FROM einsatz_personal WHERE id = ? AND einsatz_id = ?",
    )
    .bind(personal_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    name.ok_or_else(|| {
        AppError::UnprocessableEntity(format!(
            "Person {personal_id} ist in diesem Einsatz nicht disponiert"
        ))
    })
}

/// Menschenlesbarer Besetzungszustand für den ETB-Text.
fn zustand_text(art: Option<BesetzungArt>, name: Option<&str>) -> String {
    match art {
        None => "nicht vergeben".to_string(),
        Some(BesetzungArt::Einsatzleitung) => "Einsatzleitung".to_string(),
        Some(BesetzungArt::Personal) => name.unwrap_or("unbekannt").to_string(),
        Some(BesetzungArt::Extern) => name.unwrap_or("unbekannt").to_string(),
        Some(BesetzungArt::Rueckwaertig) => {
            format!("{} (rückwärtig)", name.unwrap_or("unbekannt"))
        }
    }
}

/// Der Vorherstand einer Zeile, als Text für den ETB-Eintrag.
/// Riegel gegen den Lebenszyklus INNERHALB einer Schreibtransaktion.
///
/// `fordere_aktiv` läuft im Extractor und liest einen Stand von VOR der Transaktion.
/// `write_retry!` wartet bei BUSY am `BEGIN IMMEDIATE` mit Backoff — hält ein
/// konkurrierendes „Einsatz abschliessen" gerade den Schreib-Lock, wartet der Aufruf also
/// absichtlich, bis jenes committet hat, und schriebe danach in einen geschlossenen Einsatz.
/// Der Retry-Pfad VERBREITERT das Fenster, statt es zu schliessen.
///
/// 409 wie `fordere_aktiv` am Route-Gate (Lebenszyklus, CLAUDE.md) — zwei Codes für dieselbe
/// Tatsache, unterschieden nur durch Timing, könnte ein Client nicht auseinanderhalten.
async fn fordere_aktiv_in_tx(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<(), AppError> {
    let aktiv: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM einsatz WHERE id = ? AND status = 'aktiv'")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    if aktiv.is_none() {
        return Err(AppError::Conflict(
            "Einsatz ist abgeschlossen und schreibgeschützt".into(),
        ));
    }
    Ok(())
}

/// Der fachliche Stand einer Zeile: `None` = nicht vergeben.
type Stand = Option<(BesetzungArt, Option<i64>, Option<String>)>;

/// Liest den Vorherstand ROH — für den ETB-Text **und** für den Gleichheitsvergleich.
/// Beides aus einer Abfrage, damit die Frage „hat sich etwas geändert?" nicht an einem
/// gerenderten Text hängt (ein Textvergleich würde `extern`/`rueckwaertig` mit gleichem
/// Namen verwechseln, sobald sich die Formatierung einmal ändert).
async fn vorher_stand(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
) -> Result<Stand, AppError> {
    let row: Option<(String, Option<i64>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT besetzung_art, personal_id, snap_name, bezeichnung FROM einsatz_stabsfunktion \
         WHERE einsatz_id = ? AND sachgebiet = ?",
    )
    .bind(einsatz_id)
    .bind(sachgebiet.as_str())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.and_then(|(art, pid, snap, bez)| {
        let art = BesetzungArt::parse(&art)?;
        let name = match art {
            BesetzungArt::Personal => snap,
            BesetzungArt::Extern | BesetzungArt::Rueckwaertig => bez,
            BesetzungArt::Einsatzleitung => None,
        };
        Some((art, pid, name))
    }))
}

/// Der Vorherstand als Text für den ETB-Eintrag.
fn stand_text(stand: &Stand) -> String {
    match stand {
        None => zustand_text(None, None),
        Some((art, _, name)) => zustand_text(Some(*art), name.as_deref()),
    }
}

/// Setzt (Upsert) die Besetzung eines Sachgebiets und schreibt den System-ETB-Eintrag in
/// **derselben** Transaktion (Tier A).
/// Liefert `(StabAnzeige, etb_eintrag_id)`. Die id trägt den ETB-Kurzruf des Aufrufers:
/// **ohne ihn bliebe die ETB-Chronologie anderer Betrachter still veraltet**, denn
/// `EINSATZ_STREAM_EVENTS.stab` invalidiert nur den Stab-Prefix, den ETB-Cache invalidiert
/// ausschliesslich das `etb`-Ereignis (Muster: `auftrag`, `befehl`, `chat`, `lagebericht`).
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
    benutzer_id: i64,
    eingabe: &BesetzungEingabe,
) -> Result<(StabAnzeige, Option<i64>), AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();

    let etb_id = write_retry!(pool, |conn| {
        // 0. Lebenszyklus-Riegel. Anders als bei der Lagebesprechung steht er hier GANZ VORN:
        //    dort trägt er zusätzlich die Atomaritäts-Zusicherung und muss deshalb hinter den
        //    Inserts stehen; hier gibt es keinen solchen Grund, und in einen abgeschlossenen
        //    Einsatz soll gar nichts erst geschrieben werden.
        fordere_aktiv_in_tx(conn, einsatz_id).await?;

        // 1. Vorherstand lesen — er geht in den ETB-Text ein, entscheidet über den
        //    Gleichheitsfall und ist nach dem Upsert weg.
        let vorher_stand = vorher_stand(conn, einsatz_id, sachgebiet).await?;
        let vorher = stand_text(&vorher_stand);

        // 2. Person-Zugehörigkeit prüfen und `snap_name` einfrieren.
        let snap_name = match eingabe.besetzung_art {
            BesetzungArt::Personal => {
                let pid = eingabe
                    .personal_id
                    .ok_or_else(|| AppError::UnprocessableEntity("personal_id fehlt".into()))?;
                Some(snap_name_von(conn, einsatz_id, pid).await?)
            }
            _ => None,
        };
        let (personal_id, bezeichnung) = match eingabe.besetzung_art {
            BesetzungArt::Personal => (eingabe.personal_id, None),
            BesetzungArt::Extern | BesetzungArt::Rueckwaertig => {
                (None, eingabe.bezeichnung.clone())
            }
            BesetzungArt::Einsatzleitung => (None, None),
        };

        // 3. Zeile schreiben.
        sqlx::query(
            "INSERT INTO einsatz_stabsfunktion \
                (einsatz_id, sachgebiet, besetzung_art, personal_id, snap_name, bezeichnung, \
                 gesetzt_von_id, gesetzt_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) \
             ON CONFLICT(einsatz_id, sachgebiet) DO UPDATE SET \
                besetzung_art = excluded.besetzung_art, \
                personal_id   = excluded.personal_id, \
                snap_name     = excluded.snap_name, \
                bezeichnung   = excluded.bezeichnung, \
                gesetzt_von_id = excluded.gesetzt_von_id, \
                gesetzt_at    = excluded.gesetzt_at",
        )
        .bind(einsatz_id)
        .bind(sachgebiet.as_str())
        .bind(eingabe.besetzung_art.as_str())
        .bind(personal_id)
        .bind(snap_name.as_deref())
        .bind(bezeichnung.as_deref())
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;

        // 4. System-ETB-Eintrag (Tier A) — atomar mit dem Write.
        let nachher = zustand_text(
            Some(eingabe.besetzung_art),
            match eingabe.besetzung_art {
                BesetzungArt::Personal => snap_name.as_deref(),
                _ => bezeichnung.as_deref(),
            },
        );
        // Der Eintrag ist BEDINGT: nur bei fachlicher Änderung. Ohne den Riegel schriebe ein
        // Doppelklick im Modal oder ein Retry nach verlorener Antwort „S2 Lage: Besetzung →
        // Müller (vorher: Müller)" ins Tagebuch — und weil Entscheidung 7 bewusst KEINE
        // Besetzungshistorie führt, ist das ETB der einzige Nachweis des Verlaufs; eine
        // Dublette dort ist von einem echten Wechsel nicht zu unterscheiden.
        //
        // Zeilen-Write und SSE bleiben unbedingt — `gesetzt_at`/`gesetzt_von_id` sollen den
        // Klick festhalten, und eine doppelte Invalidierung ist harmlos. Genau diese
        // Aufteilung fahren die vier Bestandsstellen mit bedingtem System-ETB:
        // `einsatz_fahrzeug.rs`, `einsatz_personal.rs`, `einsatz_material.rs`,
        // `einsatz_einheit.rs`.
        //
        // Verglichen wird der FACHLICHE Stand, nicht der gerenderte Text: sonst hinge die
        // Zusicherung an der Formatierung des ETB-Satzes.
        let nachher_stand: Stand = Some((
            eingabe.besetzung_art,
            personal_id,
            match eingabe.besetzung_art {
                BesetzungArt::Personal => snap_name.clone(),
                _ => bezeichnung.clone(),
            },
        ));
        if nachher_stand == vorher_stand {
            return Ok(None);
        }

        let inhalt = format!(
            "{}: Besetzung → {} (vorher: {})",
            sachgebiet.kurz_mit_label(),
            nachher,
            vorher
        );
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt)
            .await
            .map(Some)
    })?;

    Ok((laden(pool, einsatz_id).await?, etb_id))
}

/// Entfernt die Besetzung eines Sachgebiets („nicht vergeben").
///
/// **Idempotent, und das ist eine Setzung gegen die Bestandskonvention** (Spec 9.2): rund
/// dreissig DELETE-Repos im Bestand liefern bei `rows_affected() == 0` einen 404, weil der
/// Pfad dort eine gelistete Entität adressiert, deren Fehlen ein Irrtum ist. Hier nicht —
/// das Sachgebiet ist eine der **sechs festen** Zeilen, der Pfad existiert immer, und
/// „keine Zeile" ist der dokumentierte Normalzustand. Ohne Zeile also: kein ETB-Eintrag,
/// kein Live-Ereignis (ein Eintrag „→ nicht vergeben (vorher: nicht vergeben)" wäre
/// ETB-Rauschen).
///
/// `None` = es war nichts zu tun; `Some(etb_eintrag_id)` = Zeile entfernt und Beleg
/// geschrieben. Die id trägt den ETB-Kurzruf des Aufrufers (siehe [`setzen`]).
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
    benutzer_id: i64,
) -> Result<Option<i64>, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();

    write_retry!(pool, |conn| {
        // Vor dem DELETE, damit auch der No-op-Pfad 409 antwortet statt eines irreführenden
        // 204 „schon nicht vergeben" auf einem abgeschlossenen Einsatz.
        fordere_aktiv_in_tx(conn, einsatz_id).await?;
        let vorher = stand_text(&vorher_stand(conn, einsatz_id, sachgebiet).await?);
        let betroffen = sqlx::query(
            "DELETE FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = ?",
        )
        .bind(einsatz_id)
        .bind(sachgebiet.as_str())
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if betroffen == 0 {
            return Ok(None);
        }
        let inhalt = format!(
            "{}: Besetzung → nicht vergeben (vorher: {})",
            sachgebiet.kurz_mit_label(),
            vorher
        );
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt)
                .await?;
        Ok(Some(etb_id))
    })
}

/// Die Sachgebiete, die der mit `benutzer_id` verknüpfte Personaldatensatz in **diesem**
/// Einsatz besetzt (Detail-Pfad von `EinsatzAnzeige`).
///
/// Die Kopplung ist **transitiv** über `personal.benutzer_id` (Entscheidung 5) — Ad-hoc-Personal
/// (`einsatz_personal.personal_id IS NULL`) hat kein Konto und fällt korrekt heraus.
pub async fn sachgebiete_von(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Vec<Sachgebiet>, AppError> {
    let werte: Vec<String> = sqlx::query_scalar(
        "SELECT s.sachgebiet FROM einsatz_stabsfunktion s \
         JOIN einsatz_personal ep ON s.personal_id = ep.id \
         JOIN personal p ON ep.personal_id = p.id \
         WHERE s.einsatz_id = ? AND p.benutzer_id = ? \
         ORDER BY s.sachgebiet",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?;
    Ok(werte.iter().filter_map(|s| Sachgebiet::parse(s)).collect())
}

/// Wie [`sachgebiete_von`], aber über **alle** Einsätze in EINER Abfrage — für den
/// Listen-Pfad (`einsatz::repo::liste_fuer`).
///
/// **Die Detail-Abfrage je Zeile zu rufen ist verboten**: das wäre N+1 auf
/// `GET /api/einsaetze`, der Route hinter der Einsatzauswahl. Bewusst auch **kein**
/// `GROUP_CONCAT` im bestehenden Join der Liste — das erzwänge ein `GROUP BY` über alle
/// selektierten Spalten, und ein clientseitig gesplitteter String umginge den
/// Enum-Wire-Kontrakt. Zwei Abfragen bleiben O(1) in der Zahl der Einsätze; das ist die
/// Zusicherung, die `liste_fuer` testet.
pub async fn sachgebiete_je_einsatz(
    pool: &SqlitePool,
    benutzer_id: i64,
) -> Result<HashMap<i64, Vec<Sachgebiet>>, AppError> {
    let zeilen: Vec<(i64, String)> = sqlx::query_as(
        "SELECT s.einsatz_id, s.sachgebiet FROM einsatz_stabsfunktion s \
         JOIN einsatz_personal ep ON s.personal_id = ep.id \
         JOIN personal p ON ep.personal_id = p.id \
         WHERE p.benutzer_id = ? \
         ORDER BY s.einsatz_id, s.sachgebiet",
    )
    .bind(benutzer_id)
    .fetch_all(pool)
    .await?;
    let mut map: HashMap<i64, Vec<Sachgebiet>> = HashMap::new();
    for (einsatz_id, wert) in zeilen {
        if let Some(sg) = Sachgebiet::parse(&wert) {
            map.entry(einsatz_id).or_default().push(sg);
        }
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zustand_text_benennt_jeden_zustand() {
        assert_eq!(zustand_text(None, None), "nicht vergeben");
        assert_eq!(
            zustand_text(Some(BesetzungArt::Einsatzleitung), None),
            "Einsatzleitung"
        );
        assert_eq!(
            zustand_text(Some(BesetzungArt::Personal), Some("Müller")),
            "Müller"
        );
        assert_eq!(
            zustand_text(Some(BesetzungArt::Extern), Some("Dr. Weiss")),
            "Dr. Weiss"
        );
        assert_eq!(
            zustand_text(Some(BesetzungArt::Rueckwaertig), Some("Leitstelle")),
            "Leitstelle (rückwärtig)"
        );
    }

    /// „nicht vergeben" und „bei der Einsatzleitung" sind VERSCHIEDENE Aussagen
    /// (Entscheidung 3: der Unterschied ist die Anregungsfunktion). Ein Text, der beide
    /// gleich benennt, nähme dem ETB-Nachweis genau diese Unterscheidung.
    #[test]
    fn nicht_vergeben_ist_nicht_einsatzleitung() {
        assert_ne!(
            zustand_text(None, None),
            zustand_text(Some(BesetzungArt::Einsatzleitung), None)
        );
    }
}

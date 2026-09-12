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
    let zeilen = sqlx::query_as::<_, Zeile>(SELECT_ZEILEN)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await?;

    let letzte = sqlx::query_as::<_, LagebesprechungAnzeige>(SELECT_LETZTE_BESPRECHUNG)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;

    let anzahl: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?;

    let termin: Option<String> =
        sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?
            .flatten();

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
/// **Der Termin-Schritt ist der einzige anfahrbare Rollback-Zweig dieser Transaktion** und
/// damit der Träger der Atomaritäts-Zusicherung: er läuft als
/// `UPDATE … WHERE id = ? AND status = 'aktiv'` und rollt bei `rows_affected == 0`
/// ausdrücklich zurück (Muster `lagebericht/repo.rs::freigeben`). Das ist **keine** Redundanz
/// zu `fordere_aktiv` auf der Route — über die Route ist der Zweig gar nicht erreichbar,
/// weshalb der Test die Funktion direkt ruft.
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

        // 5. Der Einsatztermin — nur bei gesetztem Schlüssel (Tri-State).
        if let Some(wert) = &eingabe.naechste_at {
            let betroffen = sqlx::query(
                "UPDATE einsatz SET naechste_lagebesprechung_at = ? WHERE id = ? AND status = 'aktiv'",
            )
            .bind(wert.as_deref())
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if betroffen == 0 {
                // Rollback verwirft ETB-Eintrag UND Zeile → kein verwaister Beleg.
                return Err(AppError::UnprocessableEntity(
                    "Einsatz ist nicht (mehr) aktiv".into(),
                ));
            }
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
async fn vorher_text(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
) -> Result<String, AppError> {
    let row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT besetzung_art, snap_name, bezeichnung FROM einsatz_stabsfunktion \
         WHERE einsatz_id = ? AND sachgebiet = ?",
    )
    .bind(einsatz_id)
    .bind(sachgebiet.as_str())
    .fetch_optional(&mut *conn)
    .await?;
    Ok(match row {
        None => zustand_text(None, None),
        Some((art, snap, bez)) => {
            let art = BesetzungArt::parse(&art);
            let name = match art {
                Some(BesetzungArt::Personal) => snap,
                Some(BesetzungArt::Extern) | Some(BesetzungArt::Rueckwaertig) => bez,
                _ => None,
            };
            zustand_text(art, name.as_deref())
        }
    })
}

/// Setzt (Upsert) die Besetzung eines Sachgebiets und schreibt den System-ETB-Eintrag in
/// **derselben** Transaktion (Tier A).
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
    benutzer_id: i64,
    eingabe: &BesetzungEingabe,
) -> Result<StabAnzeige, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();

    write_retry!(pool, |conn| {
        // 1. Vorherstand lesen — er geht in den ETB-Text ein und ist nach dem Upsert weg.
        let vorher = vorher_text(conn, einsatz_id, sachgebiet).await?;

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
        let inhalt = format!(
            "{}: Besetzung → {} (vorher: {})",
            sachgebiet.kurz_mit_label(),
            nachher,
            vorher
        );
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt).await?;
        Ok(())
    })?;

    laden(pool, einsatz_id).await
}

/// Entfernt die Besetzung eines Sachgebiets („nicht vergeben").
///
/// **Idempotent, und das ist eine Setzung gegen die Bestandskonvention** (Spec 9.2): rund
/// dreissig DELETE-Repos im Bestand liefern bei `rows_affected() == 0` einen 404, weil der
/// Pfad dort eine gelistete Entität adressiert, deren Fehlen ein Irrtum ist. Hier nicht —
/// das Sachgebiet ist eine der **sechs festen** Zeilen, der Pfad existiert immer, und
/// „keine Zeile" ist der dokumentierte Normalzustand. Ohne Zeile also: kein ETB-Eintrag,
/// kein Live-Ereignis (ein Eintrag „→ nicht vergeben (vorher: nicht vergeben)" wäre
/// ETB-Rauschen). `false` = es war nichts zu tun.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    sachgebiet: Sachgebiet,
    benutzer_id: i64,
) -> Result<bool, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();

    write_retry!(pool, |conn| {
        let vorher = vorher_text(conn, einsatz_id, sachgebiet).await?;
        let betroffen = sqlx::query(
            "DELETE FROM einsatz_stabsfunktion WHERE einsatz_id = ? AND sachgebiet = ?",
        )
        .bind(einsatz_id)
        .bind(sachgebiet.as_str())
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if betroffen == 0 {
            return Ok(false);
        }
        let inhalt = format!(
            "{}: Besetzung → nicht vergeben (vorher: {})",
            sachgebiet.kurz_mit_label(),
            vorher
        );
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt).await?;
        Ok(true)
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

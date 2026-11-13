//! Lebensende eines Einsatzes im Abgleich (LLH-1494, Change `tkky2noy-archiv-nachbereitung`,
//! design.md D3, D4).
//!
//! - **`geloescht`**: Der Führer hat den Einsatz nicht mehr; wer spiegelt, räumt ab
//!   ([`crate::einsatz::abraeumen`]). Gemeldet nur für Kennungen, die das Gegenüber nennt und die
//!   im eigenen Löschprotokoll stehen: eine aus einer Sicherung zurückgekehrte Instanz meldet nichts.
//!   - Pull (die erreichte Seite führt): die meldende Seite nennt ihre Stände in der Anfrage.
//!   - Push (die meldende Seite führt): die erreichte Seite nennt die Stände ihrer Spiegel in der
//!     Antwort, die meldende meldet `geloescht` in der nächsten Anfrage.
//!   - Akten ohne Spiegel (LLH-1699, Change `h7shm5au-loeschsignal-spiegellose-akten`): Wer eine
//!     Führungsakte ohne lokalen Einsatz hält, nennt ihre Kennung in `akten`. Belegt wird ihr Ende
//!     mit dem Löschvermerk ([`geloeschte_akten`]), auch für Kennungen mit fremdem Präfix; der
//!     Empfänger löscht die Akte ([`geloeschte_akten_uebernehmen`]).
//! - **`verwahrt`** (nur meldende → erreichte Seite): Nach der Nachbereitung übergibt die meldende
//!   Seite einen eigenen Einsatz. Die erreichte macht aus ihrem vollständigen Spiegel einen eigenen
//!   Einsatz und quittiert `angenommen`; erst dann räumt die meldende Seite ab.

use super::paket::{
    EinsatzStand, KategorieFrist, Lebensende, LebensendeQuittung, EINSAETZE_MAX, KATEGORIEN_MAX,
    LEBENSENDE_GELOESCHT, LEBENSENDE_VERWAHRT, VERWAHRUNG_ANGENOMMEN, VERWAHRUNG_WARTET,
};
use crate::einsatz::abraeumen::{self, AbraeumArt};
use crate::einsatz::retention::Datenkategorie;
use crate::error::AppError;
use crate::instanz::repo::{KopplungZeile, OrgZeile};
use sqlx::SqliteConnection;
use std::collections::HashSet;

/// Ob diese Instanz den Einsatz mit der Kennung geführt und gelöscht hat: eigenes Präfix, kein
/// Einsatz mit der Kennung mehr, die ID im Löschprotokoll.
async fn ist_geloescht(
    conn: &mut SqliteConnection,
    eigene_kennung: &str,
    kennung: &str,
) -> Result<bool, AppError> {
    let Some(id) = kennung
        .strip_prefix(eigene_kennung)
        .and_then(|r| r.strip_prefix('/'))
        // `<id>` oder `<id>-<zufall>` (LLH-1641, E2).
        .and_then(|r| r.split('-').next())
        .and_then(|r| r.parse::<i64>().ok())
    else {
        return Ok(false);
    };
    Ok(sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM einsatz WHERE kennung = ?1 OR id = ?2) \
            AND EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?2)",
    )
    .bind(kennung)
    .bind(id)
    .fetch_one(&mut *conn)
    .await?)
}

/// `geloescht` für jede genannte Kennung, deren Einsatz diese Instanz gelöscht hat.
pub async fn geloeschte(
    conn: &mut SqliteConnection,
    eigene_kennung: &str,
    staende: &[EinsatzStand],
) -> Result<Vec<Lebensende>, AppError> {
    let mut gesehen = HashSet::new();
    let mut ergebnis = Vec::new();
    for s in staende {
        if ergebnis.len() >= EINSAETZE_MAX {
            break;
        }
        if gesehen.insert(s.kennung.as_str())
            && ist_geloescht(conn, eigene_kennung, &s.kennung).await?
        {
            ergebnis.push(Lebensende {
                kennung: s.kennung.clone(),
                art: LEBENSENDE_GELOESCHT.into(),
                stand: 0,
                kategorien: Vec::new(),
            });
        }
    }
    Ok(ergebnis)
}

/// `geloescht` für jede genannte Akte ohne Spiegel, deren Ende diese Instanz belegt (LLH-1699,
/// D4): mit einem Löschvermerk, oder für Löschungen von vor dem Vermerk mit eigenem Präfix und
/// Löschprotokoll ([`is_altbestand_geloescht`]). In beiden Fällen nur, wenn hier weder
/// Einsatz noch Akte mit der Kennung steht. Eine unbekannte Kennung wird übergangen: Eine aus
/// einer Sicherung zurückgekehrte Instanz meldet nichts.
pub async fn geloeschte_akten(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    eigene_kennung: &str,
    akten: &[String],
) -> Result<Vec<Lebensende>, AppError> {
    let mut gesehen = HashSet::new();
    let kennungen: Vec<String> = akten
        .iter()
        .filter(|k| gesehen.insert(k.as_str()))
        .take(EINSAETZE_MAX)
        .cloned()
        .collect();
    let mut belegt: HashSet<String> =
        crate::instanz::fuehrung::loeschvermerk::belegte(conn, kopplung_id, &kennungen)
            .await?
            .into_iter()
            .collect();
    for k in &kennungen {
        if !belegt.contains(k)
            && is_altbestand_geloescht(conn, kopplung_id, eigene_kennung, k).await?
        {
            belegt.insert(k.clone());
        }
    }
    Ok(kennungen
        .into_iter()
        .filter(|k| belegt.contains(k))
        .map(|kennung| Lebensende {
            kennung,
            art: LEBENSENDE_GELOESCHT.into(),
            stand: 0,
            kategorien: Vec::new(),
        })
        .collect())
}

/// Beleg für Löschungen von vor dem Löschvermerk: eigenes Präfix, die ID im Löschprotokoll einer
/// Org, die dieser Kopplung aktiv zugeordnet ist, und hier weder Einsatz noch Akte mit der
/// Kennung. Die Art `spiegel` zählt nicht: Sie steht auch für einen Spiegel, den diese Instanz
/// nach der Nachbereitung abgeräumt hat, während der Einsatz beim Führer weiterlebt.
async fn is_altbestand_geloescht(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    eigene_kennung: &str,
    kennung: &str,
) -> Result<bool, AppError> {
    let Some(id) = kennung
        .strip_prefix(eigene_kennung)
        .and_then(|r| r.strip_prefix('/'))
        .and_then(|r| r.split('-').next())
        .and_then(|r| r.parse::<i64>().ok())
    else {
        return Ok(false);
    };
    Ok(sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM einsatz WHERE kennung = ?1 OR id = ?2) \
            AND NOT EXISTS (SELECT 1 FROM einsatz_fuehrung WHERE kennung = ?1) \
            AND EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll p \
                        JOIN instanz_kopplung_org o ON o.org_id = p.org_id \
                        WHERE p.einsatz_id = ?2 AND p.art <> ?3 \
                          AND o.kopplung_id = ?4 AND o.widerrufen_at IS NULL)",
    )
    .bind(kennung)
    .bind(id)
    .bind(AbraeumArt::Spiegel.as_str())
    .bind(kopplung_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Löscht die Akten ohne Spiegel, deren Einsatz das Gegenüber als `geloescht` meldet (LLH-1699,
/// D3), und vermerkt ihr Ende. Nur bei eingeschalteter Führung, nur Akten ohne lokalen Einsatz
/// einer Org, die dieser Kopplung aktiv zugeordnet ist, und nur, wenn das Gegenüber über diese
/// Akte entscheidet (`fuehrung::repo::is_gegenueber_zustaendig`, dieselbe Regel wie beim Nennen):
/// Eine ELW löscht am Hub keine Akte einer anderen. Ein Spiegel endet nicht hier, sondern über
/// [`geloescht_uebernehmen`]. Liefert die Zahl gelöschter Akten.
pub async fn geloeschte_akten_uebernehmen(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    liste: &[Lebensende],
) -> Result<usize, AppError> {
    use crate::instanz::fuehrung::repo as akten;
    let Some(richtung) = kopplung.richtung() else {
        return Ok(0);
    };
    if !liste.iter().any(|l| l.art == LEBENSENDE_GELOESCHT) || !akten::is_enabled_tx(conn).await? {
        return Ok(0);
    }
    let orgs: Vec<i64> = akten::list_orgs_der_kopplung(conn, kopplung.id, richtung)
        .await?
        .into_iter()
        .map(|(org_id, _)| org_id)
        .collect();
    let mut geloescht = 0;
    for l in liste.iter().filter(|l| l.art == LEBENSENDE_GELOESCHT) {
        let Some(a) = akten::find_by_kennung(conn, &l.kennung).await? else {
            continue;
        };
        if a.einsatz_id.is_some() || !orgs.contains(&a.org_id) {
            continue;
        }
        let gegenueber_der_org = akten::list_gegenueber(conn, a.org_id).await?;
        if !akten::is_gegenueber_zustaendig(
            richtung,
            &a.fuehrer_kennung,
            &kopplung.gegenueber_kennung,
            &gegenueber_der_org,
        ) {
            continue;
        }
        if akten::delete_ohne_spiegel(conn, &a).await? {
            geloescht += 1;
        }
    }
    Ok(geloescht)
}

/// Der Spiegel dieser Kopplung mit der Kennung, samt Stand.
async fn spiegel_der_kopplung(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
    kennung: &str,
) -> Result<Option<(i64, i64)>, AppError> {
    Ok(sqlx::query_as(
        "SELECT s.einsatz_id, s.stand FROM einsatz_spiegel s \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         WHERE s.fremde_kennung = ? AND o.kopplung_id = ?",
    )
    .bind(kennung)
    .bind(kopplung_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Merkt die Spiegel dieser Kopplung zum Abräumen vor, deren Führer `geloescht` meldet. Liefert
/// die vorgemerkten Einsätze; abgeräumt wird nach dem Commit.
pub async fn geloescht_uebernehmen(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    liste: &[Lebensende],
) -> Result<Vec<i64>, AppError> {
    let praefix = format!("{}/", kopplung.gegenueber_kennung);
    let mut ids = Vec::new();
    for l in liste {
        if l.art != LEBENSENDE_GELOESCHT || !l.kennung.starts_with(&praefix) {
            continue;
        }
        if let Some((id, _)) = spiegel_der_kopplung(conn, kopplung.id, &l.kennung).await? {
            abraeumen::vormerken(
                conn,
                id,
                AbraeumArt::Spiegel,
                Some(&kopplung.gegenueber_name),
            )
            .await?;
            // Der Führer hat den Einsatz gelöscht: das Ende hier festhalten, damit weitere
            // meldende Seiten ihre Akte verlieren (LLH-1699, D4). Das Abräumen selbst vermerkt
            // einen Spiegel nicht, denn nach der Nachbereitung lebt der Einsatz beim Führer weiter.
            crate::instanz::fuehrung::loeschvermerk::vermerken_einsatz(conn, id).await?;
            ids.push(id);
        }
    }
    Ok(ids)
}

/// Meldende Seite: eigene Einsätze der Orgs dieser Kopplung, die zur Verwahrung fällig sind (D4):
/// abgeschlossen, Nachbereitung bis `jetzt` abgelaufen, weder vorgemerkt noch geschwärzt noch
/// schon beim Abräumen, kein Löschersuchen offen, kein Demo-Einsatz. Setzt die Kennung, falls der
/// Einsatz noch nie geliefert wurde.
pub async fn faellige_verwahrungen(
    conn: &mut SqliteConnection,
    eigene_kennung: &str,
    orgs: &[OrgZeile],
    jetzt: &str,
) -> Result<Vec<Lebensende>, AppError> {
    let mut ergebnis = Vec::new();
    for o in orgs {
        let rest = EINSAETZE_MAX.saturating_sub(ergebnis.len());
        if rest == 0 {
            break;
        }
        let faellig: Vec<super::liefern::Gefuehrt> = sqlx::query_as(
            "SELECT e.id, e.kennung, e.freigabestufe, e.status, e.org_id FROM einsatz e \
             WHERE e.org_id = ?1 AND e.spiegel = 0 AND e.status = ?2 \
               AND e.geloescht_at IS NULL AND e.geschwaerzt_at IS NULL \
               AND e.nachbereitung_bis GLOB \
                   '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]' \
               AND ?3 >= e.nachbereitung_bis \
               AND NOT EXISTS (SELECT 1 FROM demo_import d WHERE d.einsatz_id = e.id) \
               AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = e.id) \
               AND NOT EXISTS (SELECT 1 FROM schwaerzung_antrag a WHERE a.einsatz_id = e.id \
                               AND a.zurueckgenommen_at IS NULL AND a.vollzogen_at IS NULL) \
             ORDER BY e.id LIMIT ?4",
        )
        .bind(o.org_id)
        .bind(crate::einsatz::STATUS_ABGESCHLOSSEN)
        .bind(jetzt)
        .bind(rest as i64)
        .fetch_all(&mut *conn)
        .await?;
        for e in faellig {
            let kennung = super::liefern::ensure_kennung(conn, eigene_kennung, &e).await?;
            let stand: Option<i64> =
                sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
                    .bind(e.id)
                    .fetch_one(&mut *conn)
                    .await?;
            let kategorien: Vec<KategorieFrist> = sqlx::query_as(
                "SELECT kategorie, frist_bis, rechtsgrundlage, vorgemerkt_at, geschwaerzt_at, \
                    frist_gesetzt_at \
                 FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ? \
                 ORDER BY kategorie LIMIT ?",
            )
            .bind(e.id)
            .bind(KATEGORIEN_MAX as i64)
            .fetch_all(&mut *conn)
            .await?;
            ergebnis.push(Lebensende {
                kennung,
                art: LEBENSENDE_VERWAHRT.into(),
                stand: stand.unwrap_or(0),
                kategorien,
            });
        }
    }
    Ok(ergebnis)
}

fn wartet(kennung: &str, grund: String) -> LebensendeQuittung {
    LebensendeQuittung {
        kennung: kennung.to_string(),
        ergebnis: VERWAHRUNG_WARTET.into(),
        grund: Some(grund),
        epoche: None,
    }
}

/// `angenommen` mit der Epoche, mit der diese Instanz den Einsatz `id` nun führt (LLH-1647).
async fn angenommen(
    conn: &mut SqliteConnection,
    kennung: &str,
    id: i64,
) -> Result<LebensendeQuittung, AppError> {
    let epoche = crate::instanz::fuehrung::repo::find_by_einsatz(conn, id)
        .await?
        .map(|a| a.epoche());
    Ok(LebensendeQuittung {
        kennung: kennung.to_string(),
        ergebnis: VERWAHRUNG_ANGENOMMEN.into(),
        grund: None,
        epoche,
    })
}

/// Erreichte Seite: nimmt einen zur Verwahrung übergebenen Einsatz an (D4) oder sagt, worauf er
/// wartet. Fehlende Anhänge werden dabei angefordert. Liefert die Quittung und, bei einer Annahme
/// in diesem Aufruf, den umgewandelten Einsatz. `None` für eine Meldung, die nicht zu dieser
/// Kopplung gehört.
pub async fn verwahrung_annehmen(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    l: &Lebensende,
    jetzt: &str,
) -> Result<Option<(LebensendeQuittung, Option<i64>)>, AppError> {
    if l.art != LEBENSENDE_VERWAHRT
        || !l
            .kennung
            .starts_with(&format!("{}/", kopplung.gegenueber_kennung))
    {
        return Ok(None);
    }
    // Schon angenommen (die Quittung ging verloren): wieder `angenommen`, aber nur zum selben
    // Stand. Hat sich der Einsatz drüben nach der Übergabe geändert, behält die meldende Seite
    // ihn; ein zweites `angenommen` ließe sie die Änderung abräumen.
    let eigen: Option<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT e.id, v.stand FROM einsatz e \
         LEFT JOIN verwahrung_angenommen v ON v.einsatz_id = e.id \
         WHERE e.kennung = ? AND e.spiegel = 0",
    )
    .bind(&l.kennung)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((eigen_id, stand)) = eigen {
        return Ok(Some(match stand {
            Some(s) if s != l.stand => (
                wartet(
                    &l.kennung,
                    format!("Nach der Übergabe geändert (Stand {s} von {})", l.stand),
                ),
                None,
            ),
            _ => (angenommen(conn, &l.kennung, eigen_id).await?, None),
        }));
    }
    let Some((id, stand)) = spiegel_der_kopplung(conn, kopplung.id, &l.kennung).await? else {
        return Ok(Some((
            wartet(&l.kennung, "Noch nicht gespiegelt".into()),
            None,
        )));
    };
    if stand != l.stand {
        return Ok(Some((
            wartet(&l.kennung, format!("Stand {stand} von {}", l.stand)),
            None,
        )));
    }
    let fehlend: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM spiegel_anhang WHERE einsatz_id = ? AND fertig_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if fehlend > 0 {
        // Vor dem Vorabladen abrufen (`anhang::offene_abrufe` nimmt angeforderte zuerst).
        sqlx::query(
            "UPDATE spiegel_anhang SET angefordert_at = ? \
             WHERE einsatz_id = ? AND fertig_at IS NULL AND angefordert_at IS NULL",
        )
        .bind(jetzt)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let grund = if fehlend == 1 {
            "1 Anhang fehlt".to_string()
        } else {
            format!("{fehlend} Anhänge fehlen")
        };
        return Ok(Some((wartet(&l.kennung, grund), None)));
    }
    // Ein offener Antrag soll seine Antwort noch bekommen; der Führer quittiert ihn im nächsten
    // Abgleich (am abgeschlossenen Einsatz meist als Ablehnung).
    let offen: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM spiegel_antrag WHERE einsatz_id = ? \
         AND zustand IN ('ausstehend', 'zugestellt')",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if offen > 0 {
        let grund = if offen == 1 {
            "1 Antrag offen".to_string()
        } else {
            format!("{offen} Anträge offen")
        };
        return Ok(Some((wartet(&l.kennung, grund), None)));
    }
    let Some(akteur) = crate::einsatz::repo::ermittle_system_akteur(conn, id).await? else {
        return Ok(Some((
            wartet(&l.kennung, "Niemand für den ETB-Eintrag".into()),
            None,
        )));
    };
    umwandeln(conn, kopplung, l, id, akteur).await?;
    Ok(Some((angenommen(conn, &l.kennung, id).await?, Some(id))))
}

/// Macht aus dem Spiegel einen eigenen, abgeschlossenen Einsatz dieser Instanz (D4).
async fn umwandeln(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    l: &Lebensende,
    id: i64,
    akteur: i64,
) -> Result<(), AppError> {
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await?;
    for k in &l.kategorien {
        if Datenkategorie::parse(&k.kategorie).is_none() {
            continue;
        }
        sqlx::query(
            "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, vorgemerkt_at, geschwaerzt_at, frist_gesetzt_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (einsatz_id, kategorie) DO UPDATE SET frist_bis = excluded.frist_bis, \
                rechtsgrundlage = excluded.rechtsgrundlage, \
                vorgemerkt_at = excluded.vorgemerkt_at, geschwaerzt_at = excluded.geschwaerzt_at, \
                frist_gesetzt_at = excluded.frist_gesetzt_at",
        )
        .bind(id)
        .bind(&k.kategorie)
        .bind(&k.frist_bis)
        .bind(&k.rechtsgrundlage)
        .bind(&k.vorgemerkt_at)
        .bind(&k.geschwaerzt_at)
        .bind(&k.frist_gesetzt_at)
        .execute(&mut *conn)
        .await?;
    }
    // Die Nummer vergeben ELW und Hub unabhängig; ein Spiegel ist von ihrer Eindeutigkeit
    // ausgenommen. Ist sie hier belegt, bekommt der Einsatz eine Nummer dieser Instanz. Vor dem
    // Wechsel der Akte: Der beendet den Spiegel, und ab da gilt die Eindeutigkeit (LLH-1647).
    let umnummeriert = super::nummer::ensure_freie_nummer(conn, id).await?;
    // Führungsakte (LLH-1647, E1): Mit eingeschalteter Führung führt diese Instanz ab jetzt, mit
    // der nächsten Epoche und der Art `verwahrung`. Das richtet den Spiegel aus wie jeder Wechsel
    // (`fuehrung::werde_fuehrer`): Die Herkunft der Zeilen bleibt, damit ein Rückfall zum Spiegel
    // keine Zeile doppelt anlegt, wenn die Gegenstelle die Verwahrung ablehnt (E3).
    let gewechselt = crate::instanz::fuehrung::repo::verwahren(conn, id).await?;
    if !gewechselt {
        for tabelle in ["spiegel_herkunft", "spiegel_anhang", "spiegel_katalog"] {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "DELETE FROM {tabelle} WHERE einsatz_id = ?"
            )))
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
    }
    // Abgelehnte Anträge bleiben mit ihren Daten für die erfassende Person, bis der Purge-Lauf
    // sie nach `antrag::ABGELEHNT_TAGE` räumt; offene gibt es hier nicht mehr (oben).
    sqlx::query("DELETE FROM spiegel_antrag WHERE einsatz_id = ? AND zustand <> 'abgelehnt'")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    // Die Kennung trägt der Spiegel schon (Übernahme); sie macht eine zweite Meldung erkennbar.
    sqlx::query("UPDATE einsatz SET kennung = ? WHERE id = ? AND kennung IS NULL")
        .bind(&l.kennung)
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM einsatz_spiegel WHERE einsatz_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    // Nach einem Rückfall zum Spiegel (LLH-1647, E3) steht die Zeile schon: die neue Annahme gilt.
    sqlx::query(
        "INSERT INTO verwahrung_angenommen (einsatz_id, stand, angenommen_at) \
         VALUES (?, ?, datetime('now')) ON CONFLICT (einsatz_id) DO UPDATE SET \
         stand = excluded.stand, angenommen_at = excluded.angenommen_at",
    )
    .bind(id)
    .bind(l.stand)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *conn)
        .await?;
    let mut inhalt = format!("Zur Verwahrung übernommen von {}", kopplung.gegenueber_name);
    if let Some((alt, neu)) = umnummeriert {
        inhalt.push_str(&format!(" (Einsatznummer {neu}, dort {alt})"));
    }
    let startwert = crate::einsatz::einstellungen::etb_startwert(&mut *conn, id).await?;
    crate::etb::repo::anlegen_tx(
        conn,
        id,
        akteur,
        startwert,
        crate::etb::repo::EintragDaten {
            typ: crate::etb::TYP_SYSTEM,
            inhalt: &inhalt,
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

/// Meldende Seite: übernimmt die Quittungen der erreichten Seite (D4). `angenommen` merkt den
/// Einsatz zum Abräumen vor (Art `verwahrt`), `wartet` hält den Grund für die Anzeige fest.
/// Liefert die vorgemerkten Einsätze.
pub async fn quittungen_uebernehmen(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
    eigene_kennung: &str,
    gesendet: &[Lebensende],
    quittungen: &[LebensendeQuittung],
    jetzt: &str,
) -> Result<Vec<i64>, AppError> {
    let mut ids = Vec::new();
    for q in quittungen {
        // Nur Antworten auf eigene, in dieser Anfrage übergebene Einsätze.
        if !gesendet
            .iter()
            .any(|l| l.art == LEBENSENDE_VERWAHRT && l.kennung == q.kennung)
            || !q.kennung.starts_with(&format!("{eigene_kennung}/"))
        {
            continue;
        }
        let Some(id): Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE kennung = ? AND spiegel = 0")
                .bind(&q.kennung)
                .fetch_optional(&mut *conn)
                .await?
        else {
            continue;
        };
        // Die Quittung gilt dem gesendeten Stand. Hat sich der Einsatz seitdem geändert oder ist
        // er nicht mehr fällig (Nachbereitung verlängert, Löschung vorgemerkt), bleibt er hier.
        let gesendeter_stand = gesendet
            .iter()
            .find(|l| l.art == LEBENSENDE_VERWAHRT && l.kennung == q.kennung)
            .map(|l| l.stand);
        let noch_so = q.ergebnis != VERWAHRUNG_ANGENOMMEN
            || noch_wie_gesendet(conn, id, gesendeter_stand, jetzt).await?;
        if q.ergebnis == VERWAHRUNG_ANGENOMMEN && verwahrung_abgelehnt(conn, id, q).await? {
            // Die Akte kam vor der Quittung, und diese Instanz hat die Verwahrung abgelehnt
            // (LLH-1647, E3). Die Gegenstelle wird wieder Spiegel; abräumen hieße, dass niemand
            // den Einsatz mehr hat. Das nächste Angebot läuft mit einer neuen Epoche.
            verwahrung_merken(
                conn,
                id,
                &kopplung.gegenueber_name,
                Some(GRUND_ABGELEHNT),
                jetzt,
            )
            .await?;
        } else if !noch_so {
            verwahrung_merken(
                conn,
                id,
                &kopplung.gegenueber_name,
                Some(GRUND_GEAENDERT),
                jetzt,
            )
            .await?;
        } else if q.ergebnis == VERWAHRUNG_ANGENOMMEN {
            abraeumen::vormerken(
                conn,
                id,
                AbraeumArt::Verwahrt,
                Some(&kopplung.gegenueber_name),
            )
            .await?;
            ids.push(id);
        } else if q.ergebnis == VERWAHRUNG_WARTET {
            verwahrung_merken(
                conn,
                id,
                &kopplung.gegenueber_name,
                q.grund.as_deref(),
                jetzt,
            )
            .await?;
        }
    }
    Ok(ids)
}

/// Meldende Seite (LLH-1647): Ob die eigene Akte über die Epoche der Quittung hinaus ist, diese
/// Instanz die Verwahrung also schon abgelehnt hat. Ohne Epoche (Führung je Einsatz aus) nie.
async fn verwahrung_abgelehnt(
    conn: &mut SqliteConnection,
    id: i64,
    q: &LebensendeQuittung,
) -> Result<bool, AppError> {
    let Some(epoche) = &q.epoche else {
        return Ok(false);
    };
    Ok(crate::instanz::fuehrung::repo::find_by_einsatz(conn, id)
        .await?
        .is_some_and(|a| a.epoche() > *epoche))
}

/// Ob der Einsatz noch so ist, wie er zur Verwahrung gesendet wurde: gleicher Stand und weiter
/// fällig (dieselbe Bedingung wie [`faellige_verwahrungen`], ohne die Grenze je Anfrage).
async fn noch_wie_gesendet(
    conn: &mut SqliteConnection,
    id: i64,
    gesendeter_stand: Option<i64>,
    jetzt: &str,
) -> Result<bool, AppError> {
    let Some(gesendet) = gesendeter_stand else {
        return Ok(false);
    };
    let stand: Option<i64> =
        sqlx::query_scalar("SELECT MAX(stand) FROM einsatz_aenderung WHERE einsatz_id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    if stand.unwrap_or(0) != gesendet {
        return Ok(false);
    }
    let faellig: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz e WHERE e.id = ?1 AND e.spiegel = 0 \
           AND e.status = ?2 AND e.geloescht_at IS NULL AND e.geschwaerzt_at IS NULL \
           AND e.nachbereitung_bis GLOB \
               '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]' \
           AND ?3 >= e.nachbereitung_bis \
           AND NOT EXISTS (SELECT 1 FROM schwaerzung_antrag a WHERE a.einsatz_id = e.id \
                           AND a.zurueckgenommen_at IS NULL AND a.vollzogen_at IS NULL))",
    )
    .bind(id)
    .bind(crate::einsatz::STATUS_ABGESCHLOSSEN)
    .bind(jetzt)
    .fetch_one(&mut *conn)
    .await?;
    Ok(faellig)
}

/// Hält die letzte Quittung „wartet“ samt Grund für die Anzeige fest.
async fn verwahrung_merken(
    conn: &mut SqliteConnection,
    id: i64,
    gegenstelle: &str,
    grund: Option<&str>,
    jetzt: &str,
) -> Result<(), AppError> {
    let grund: Option<String> = grund.map(|g| g.chars().take(200).collect());
    sqlx::query(
        "INSERT INTO einsatz_verwahrung (einsatz_id, gegenstelle, grund, quittiert_at) \
         VALUES (?, ?, ?, ?) ON CONFLICT (einsatz_id) DO UPDATE SET \
         gegenstelle = excluded.gegenstelle, grund = excluded.grund, \
         quittiert_at = excluded.quittiert_at",
    )
    .bind(id)
    .bind(gegenstelle)
    .bind(grund)
    .bind(jetzt)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Ob diese Instanz den Einsatz verwahrt: zur Verwahrung angenommen und kein Spiegel mehr
/// (LLH-1647, E4). Nach einem Rückfall zum Spiegel (E3) nicht.
pub async fn ist_verwahrt(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM verwahrung_angenommen v JOIN einsatz e ON e.id = v.einsatz_id \
         WHERE v.einsatz_id = ? AND e.spiegel = 0)",
    )
    .bind(einsatz_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Meldende Seite (LLH-1647, E2): Die Gegenstelle hat die Übergabe des eigenen Einsatzes
/// `einsatz_id` mit `angenommen` quittiert; er wird gleich abgeräumt.
pub async fn ist_verwahrung_quittiert(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_abraeumen WHERE einsatz_id = ? AND art = ?)",
    )
    .bind(einsatz_id)
    .bind(AbraeumArt::Verwahrt.as_str())
    .fetch_one(&mut *conn)
    .await?)
}

/// Meldende Seite (LLH-1647, E3): Warum die Verwahrung des Einsatzes nicht gilt, für den Verlauf.
pub async fn grund_gegen_verwahrung(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<&'static str, AppError> {
    let grund: Option<Option<String>> =
        sqlx::query_scalar("SELECT grund FROM einsatz_verwahrung WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    Ok(match grund.flatten().as_deref() {
        Some(GRUND_GEAENDERT) => "nach der Übergabe geändert",
        _ => "Übergabe hier nicht bestätigt",
    })
}

/// Grund der Quittung, wenn sich der Einsatz nach der Übergabe geändert hat.
const GRUND_GEAENDERT: &str = "Nach der Übergabe geändert";
/// Grund, wenn diese Instanz die Verwahrung abgelehnt hatte, bevor die Quittung kam (LLH-1647).
const GRUND_ABGELEHNT: &str = "Verwahrung hier abgelehnt";

/// Räumt nach dem Commit ab, was ein Abgleich vorgemerkt hat; Fehler holt Phase R nach.
pub async fn abraeumen_nach_commit(
    pool: &sqlx::SqlitePool,
    live: Option<&crate::live::LiveHub>,
    ids: &[i64],
) {
    for id in ids {
        if let Err(e) = abraeumen::ausfuehren(pool, live, *id).await {
            tracing::warn!(
                einsatz_id = id,
                "Abgleich: Abräumen gescheitert, Phase R holt nach: {e}"
            );
        }
    }
}

#[cfg(test)]
mod tests;

//! Abgleich der Einsätze über `POST /api/instanz/spiegel` (design.md D6, D7, D12).
//!
//! Die meldende Seite ruft, die erreichte antwortet; beide schicken dasselbe [`SpiegelPaket`].
//! Führt die meldende Seite einen Einsatz, liefert sie ihn in der Anfrage und merkt sich den Stand
//! aus der Antwort (`spiegel_ziel`, Push). Führt die erreichte Seite, nennt die meldende ihren
//! Stand und bekommt die Lieferung in der Antwort (Pull). Den Stand nennt immer, wer spiegelt.

use super::liefern::{self, Absender, Budget};
use super::paket::{EinsatzStand, SpiegelPaket, EINSAETZE_MAX, RESERVE, SPIEGEL_MAX};
use super::uebernehmen::{self, Empfaenger, Ergebnis};
use crate::error::AppError;
use crate::instanz::extractor::SPIEGEL_PFAD;
use crate::instanz::identitaet::{self, Identitaet};
use crate::instanz::melden::{self, SendError};
use crate::instanz::repo::{self, KopplungZeile, OrgZeile};
use crate::instanz::{org_kennung, InstanzKopplungRichtung, PROTOKOLL_SPIEGEL};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;
use std::sync::Mutex;

/// Was ein Abgleich an der eigenen Seite übernommen hat; nach dem Commit gemeldet.
#[derive(Debug, Default)]
pub struct Uebernommen {
    /// Lokale Einsätze, deren Spiegel sich geändert hat.
    pub einsaetze: Vec<i64>,
    /// Davon neu angelegte Spiegel (Einsatzliste der Org).
    pub neu: Vec<i64>,
}

/// Die Org-Kennung, unter der eine Lieferung reist: immer die Kennung der erreichten Seite, wie in
/// Melden (`MeldenOrg::org`).
fn org_wire(eigen: &Identitaet, kopplung: &KopplungZeile, o: &OrgZeile) -> String {
    if kopplung.richtung() == Some(InstanzKopplungRichtung::WirdGemeldet) {
        org_kennung(&eigen.kennung, o.org_id)
    } else {
        o.fremde_org_kennung.clone()
    }
}

/// Zähler je Kopplung, getrennt für die Auswahl der eigenen Stände und für die Lieferung; er
/// verschiebt den Anfang der Reihe um eins je Abgleich (LLH-1630). Ein gemeinsamer Zähler rückte
/// je Pfad in Zweierschritten vor und träfe bei einer geraden Zahl übriger Plätze nie alle.
static RUNDE_STAENDE: Mutex<Option<HashMap<i64, usize>>> = Mutex::new(None);
static RUNDE_LIEFERN: Mutex<Option<HashMap<i64, usize>>> = Mutex::new(None);

/// Die nächste Runde dieser Kopplung auf diesem Zähler: 0, 1, 2, …
fn naechste_runde(zaehler: &Mutex<Option<HashMap<i64, usize>>>, kopplung_id: i64) -> usize {
    let mut z = zaehler.lock().unwrap_or_else(|e| e.into_inner());
    let n = z
        .get_or_insert_with(HashMap::new)
        .entry(kopplung_id)
        .or_insert(0);
    let runde = *n;
    *n = n.wrapping_add(1);
    runde
}

/// Die Liste ab einer Stelle, die mit jedem Abgleich weiterrückt: Was am Ende der Reihe steht,
/// kommt so auch dran, wenn Budget oder [`EINSAETZE_MAX`] vorher ausgehen (LLH-1630).
fn reihum<T>(mut liste: Vec<T>, runde: usize) -> Vec<T> {
    if !liste.is_empty() {
        let n = liste.len();
        liste.rotate_left(runde % n);
    }
    liste
}

/// Stände der Spiegel dieser Instanz für eine Kopplung.
async fn eigene_staende(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<EinsatzStand>, AppError> {
    // Höchstens so viele, wie ein Paket trägt: die laufenden zuerst, dann reihum die übrigen. Ein
    // abgeschlossener Spiegel, der hier fehlt, bekommt in diesem Abgleich nichts (der Führer
    // liefert nur laufende Einsätze ungenannt). Spiegel enden erst mit dem Widerruf, über Jahre
    // werden es also mehr als ein Paket trägt; eine feste Auswahl schnitte immer dieselben ab, und
    // deren Nachträge kämen nie an (LLH-1630).
    let zeilen: Vec<(String, i64, bool)> = sqlx::query_as(
        "SELECT s.fremde_kennung, s.stand, e.status <> 'abgeschlossen' FROM einsatz_spiegel s \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         JOIN einsatz e ON e.id = s.einsatz_id \
         WHERE o.kopplung_id = ? AND o.widerrufen_at IS NULL AND s.beendet_at IS NULL \
         ORDER BY s.einsatz_id DESC",
    )
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(auswahl_staende(
        zeilen,
        naechste_runde(&RUNDE_STAENDE, kopplung_id),
    ))
}

/// Die laufenden zuerst, dann die übrigen, je Gruppe reihum, zusammen höchstens
/// [`EINSAETZE_MAX`].
fn auswahl_staende(zeilen: Vec<(String, i64, bool)>, runde: usize) -> Vec<EinsatzStand> {
    let (laufend, uebrig): (Vec<_>, Vec<_>) = zeilen.into_iter().partition(|z| z.2);
    let mut auswahl = if laufend.len() > EINSAETZE_MAX {
        reihum(laufend, runde)
    } else {
        laufend
    };
    auswahl.truncate(EINSAETZE_MAX);
    let frei = EINSAETZE_MAX - auswahl.len();
    if uebrig.len() > frei {
        auswahl.extend(reihum(uebrig, runde).into_iter().take(frei));
    } else {
        auswahl.extend(uebrig);
    }
    auswahl
        .into_iter()
        .map(|(kennung, stand, _)| EinsatzStand { kennung, stand })
        .collect()
}

/// Liefert die geführten Einsätze aller aktiven Orgs ab den genannten Ständen.
async fn liefere_alle(
    conn: &mut SqliteConnection,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    orgs: &[OrgZeile],
    staende: &HashMap<String, i64>,
    budget: &mut Budget,
) -> Result<Vec<super::paket::EinsatzLieferung>, AppError> {
    let meldend = kopplung.richtung() == Some(InstanzKopplungRichtung::MeldetSich);
    let mut lieferungen = Vec::new();
    let mut alle = Vec::new();
    for o in orgs {
        for e in liefern::list_gefuehrt(conn, o.org_id, staende).await? {
            alle.push((o, e));
        }
    }
    // Reihum (LLH-1630): nach der ID allein bekämen bei knappem Budget oder mehr als
    // `EINSAETZE_MAX` wartenden Einsätzen immer dieselben den Vortritt.
    for (o, e) in reihum(alle, naechste_runde(&RUNDE_LIEFERN, kopplung.id)) {
        if lieferungen.len() >= EINSAETZE_MAX {
            break;
        }
        let a = Absender {
            kennung: &eigen.kennung,
            kopplung_id: kopplung.id,
            kopplung_org_id: o.id,
            meldend,
        };
        let wire = org_wire(eigen, kopplung, o);
        let kennung = liefern::ensure_kennung(conn, &eigen.kennung, &e).await?;
        let seit = staende.get(&kennung).copied().unwrap_or(0);
        if let Some(l) =
            liefern::liefere_einsatz(conn, &a, &e, &kennung, &wire, seit, budget).await?
        {
            lieferungen.push(l);
        }
    }
    Ok(lieferungen)
}

/// Übernimmt die Lieferungen eines Pakets; liefert die neuen Stände und was sich geändert hat.
async fn uebernehme_alle(
    conn: &mut SqliteConnection,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    orgs: &[OrgZeile],
    paket: &SpiegelPaket,
    uebernommen: &mut Uebernommen,
) -> Result<Vec<EinsatzStand>, AppError> {
    let meldend = kopplung.richtung() == Some(InstanzKopplungRichtung::MeldetSich);
    let mut staende = Vec::new();
    // Ein Gegenüber liefert nur Einsätze, die es selbst führt: ihre Kennung beginnt mit seiner.
    let praefix = format!("{}/", kopplung.gegenueber_kennung);
    for l in &paket.lieferungen {
        let Some(o) = orgs.iter().find(|o| org_wire(eigen, kopplung, o) == l.org) else {
            continue;
        };
        if !l.kennung.starts_with(&praefix) {
            tracing::warn!(kennung = %l.kennung, "Spiegel: Lieferung eines fremden Einsatzes verworfen");
            continue;
        }
        let e = Empfaenger {
            kopplung_id: kopplung.id,
            kopplung_org_id: o.id,
            org_id: o.org_id,
            meldend,
        };
        let vorher: Option<i64> =
            sqlx::query_scalar("SELECT einsatz_id FROM einsatz_spiegel WHERE fremde_kennung = ?")
                .bind(&l.kennung)
                .fetch_optional(&mut *conn)
                .await?;
        // Ein Einsatz, der nicht übernommen werden kann, hält die anderen nicht an: sein
        // Savepoint ist zurückgerollt, sein Stand bleibt, der Grund steht am Spiegel.
        let erg: Ergebnis = match uebernehmen::uebernehmen(conn, &e, l).await {
            Ok(erg) => erg,
            Err(f) => {
                tracing::warn!(kennung = %l.kennung, fehler = %f, "Spiegel: Lieferung nicht übernommen");
                let stand: Option<i64> = sqlx::query_scalar(
                    "SELECT stand FROM einsatz_spiegel WHERE fremde_kennung = ?",
                )
                .bind(&l.kennung)
                .fetch_optional(&mut *conn)
                .await?;
                Ergebnis {
                    einsatz_id: vorher,
                    stand: stand.unwrap_or(0),
                    hinweise: vec![format!("Lieferung nicht übernommen: {f}")],
                    ..Default::default()
                }
            }
        };
        if !erg.hinweise.is_empty() {
            tracing::warn!(kennung = %l.kennung, hinweise = ?erg.hinweise, "Spiegel: Hinweise beim Übernehmen");
        }
        if let Some(id) = erg.einsatz_id {
            save_hinweis(conn, id, &erg.hinweise, l).await?;
        }
        if let Some(id) = erg.einsatz_id {
            if !erg.kategorien.is_empty() {
                uebernommen.einsaetze.push(id);
                if vorher.is_none() {
                    uebernommen.neu.push(id);
                }
            }
        }
        staende.push(EinsatzStand {
            kennung: l.kennung.clone(),
            stand: erg.stand,
        });
    }
    Ok(staende)
}

async fn save_hinweis(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    hinweise: &[String],
    l: &super::paket::EinsatzLieferung,
) -> Result<(), AppError> {
    let alt: Option<String> =
        sqlx::query_scalar("SELECT hinweis FROM einsatz_spiegel WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    let geliefert: Vec<String> = l
        .zeilen
        .iter()
        .filter(|z| !z.zu_gross)
        .map(|z| uebernehmen::zu_gross_anfang(&z.art, &z.schluessel))
        .collect();
    let neu = hinweise_fortschreiben(alt.as_deref(), hinweise, &geliefert);
    if neu != alt {
        sqlx::query("UPDATE einsatz_spiegel SET hinweis = ? WHERE einsatz_id = ?")
            .bind(neu)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Der Hinweis am Spiegel nach einer Lieferung. Neue Hinweise ersetzen die alten, nur „zu groß“
/// bleibt je Zeile stehen, bis dieselbe Zeile mit Daten kommt: ihr Stand wird nicht neu geliefert,
/// der Hinweis ginge sonst mit der nächsten Runde verloren (LLH-1630). Ohne neue Hinweise bleiben
/// die alten bis auf die erledigten „zu groß“.
fn hinweise_fortschreiben(
    alt: Option<&str>,
    neu: &[String],
    geliefert: &[String],
) -> Option<String> {
    let erledigt = |zeile: &str| geliefert.iter().any(|g| zeile.starts_with(g.as_str()));
    let ist_zu_gross = |zeile: &str| zeile.starts_with("Zeile ") && zeile.contains(" ist zu groß");
    let alte = alt.unwrap_or("").lines().filter(|z| !z.is_empty());
    let mut zeilen: Vec<String> = if neu.is_empty() {
        alte.filter(|z| !(ist_zu_gross(z) && erledigt(z)))
            .map(str::to_owned)
            .collect()
    } else {
        alte.filter(|z| ist_zu_gross(z) && !erledigt(z) && !neu.iter().any(|n| n == z))
            .map(str::to_owned)
            .chain(neu.iter().cloned())
            .collect()
    };
    zeilen.truncate(20);
    (!zeilen.is_empty()).then(|| zeilen.join("\n"))
}

/// Meldet nach dem Commit, was sich geändert hat: `lagged` an die Clients des Einsatzes (ein
/// Vollabgleich, ohne Module zu verraten, design.md D7, Nachtrag) und die Einsatzliste der Org für
/// neue Spiegel.
pub async fn melde_live(pool: &SqlitePool, u: &Uebernommen) {
    let Some(live) = crate::instanz::stammdaten::live() else {
        return;
    };
    let mut gemeldet = std::collections::BTreeSet::new();
    for id in u.einsaetze.iter().filter(|id| gemeldet.insert(**id)) {
        live.publiziere_event(
            *id,
            crate::live::LiveEvent::Lagged,
            format!(r#"{{"einsatz_id":{id}}}"#),
        );
    }
    for id in &u.neu {
        crate::live::org::einsatzliste_melden(pool, live, *id, &[]).await;
    }
}

// ── Erreichte Seite ──────────────────────────────────────────────────────────────────────────

/// Beantwortet einen Abgleich (Handler `POST /api/instanz/spiegel`).
pub async fn handle_abgleich(
    pool: &SqlitePool,
    router: Option<&axum::Router>,
    eigen: &Identitaet,
    kopplung: &KopplungZeile,
    anfrage: &SpiegelPaket,
) -> Result<SpiegelPaket, AppError> {
    if kopplung.richtung() != Some(InstanzKopplungRichtung::WirdGemeldet) {
        return Err(AppError::Forbidden);
    }
    anfrage.check().map_err(AppError::Validation)?;
    // Anträge an Einsätze, die hier geführt werden: außerhalb der Transaktion ausführen, denn
    // jeder läuft durch seine Route mit eigener Schreibtransaktion (D11).
    let mut quittungen = Vec::new();
    if let Some(router) = router {
        for a in &anfrage.antraege {
            if let Some(q) = super::antrag::ausfuehren(pool, router, kopplung, false, a).await? {
                quittungen.push(q);
            }
        }
    }
    let mut uebernommen = Uebernommen::default();
    let antwort = crate::write_retry!(pool, |conn| {
        uebernommen = Uebernommen::default();
        let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
        let staende_antwort =
            uebernehme_alle(conn, eigen, kopplung, &orgs, anfrage, &mut uebernommen).await?;
        let staende: HashMap<String, i64> = anfrage
            .staende
            .iter()
            .map(|s| (s.kennung.clone(), s.stand))
            .collect();
        // Pull: den Stand, den die spiegelnde Seite nennt, für die Seite „Instanzkopplung“ merken
        // (wie im Push aus der Antwort). Nur eigene Einsätze der Org der Zuordnung.
        for s in &anfrage.staende {
            for o in &orgs {
                sqlx::query(
                    "INSERT INTO spiegel_ziel (kopplung_org_id, einsatz_id, stand) \
                     SELECT ?, id, ? FROM einsatz WHERE kennung = ? AND org_id = ? AND spiegel = 0 \
                     ON CONFLICT (kopplung_org_id, einsatz_id) DO UPDATE SET stand = excluded.stand",
                )
                .bind(o.id)
                .bind(s.stand)
                .bind(&s.kennung)
                .bind(o.org_id)
                .execute(&mut *conn)
                .await?;
            }
        }
        let fertig =
            super::anhang::uebernehme_teile(conn, kopplung.id, &anfrage.anhang_teile).await?;
        uebernommen.einsaetze.extend(fertig);
        let quittiert =
            super::antrag::quittungen_uebernehmen(conn, kopplung.id, &anfrage.quittungen).await?;
        uebernommen.einsaetze.extend(quittiert);
        // Anträge stehen vorn (D8) und zählen ins Budget.
        let (antraege, antrag_bytes) =
            super::antrag::offene_antraege(conn, kopplung.id, false).await?;
        let mut budget = Budget::neu(SPIEGEL_MAX - RESERVE - antrag_bytes);
        let lieferungen = liefere_alle(conn, eigen, kopplung, &orgs, &staende, &mut budget).await?;
        let anhang_teile =
            super::anhang::liefere_teile(conn, kopplung.id, &anfrage.abrufe, budget.bytes).await?;
        let abrufe = super::anhang::offene_abrufe(conn, kopplung.id).await?;
        let ids: Vec<i64> = antraege.iter().map(|a| a.id).collect();
        super::antrag::markiere_zugestellt(conn, &ids).await?;
        Ok(SpiegelPaket {
            staende: staende_antwort,
            lieferungen,
            abrufe,
            anhang_teile,
            antraege,
            quittungen: quittungen.clone(),
        })
    })?;
    melde_live(pool, &uebernommen).await;
    Ok(antwort)
}

// ── Meldende Seite ───────────────────────────────────────────────────────────────────────────

/// Ob das Gegenüber den Abgleich kennt (Spec `einsatz-spiegel`, Protokoll).
pub fn kann_spiegeln(kopplung: &KopplungZeile) -> bool {
    kopplung
        .gegenueber_protokoll
        .is_some_and(|p| p >= i64::from(PROTOKOLL_SPIEGEL))
}

/// Höchstzahl Runden eines Abgleichs, wenn das Gegenüber Inhalte abruft (D8, Push).
const RUNDEN_MAX: usize = 4;

/// Gleicht einmal mit einer Kopplung ab, in der diese Instanz sich meldet. Ruft die erreichte
/// Seite Inhalte ab, folgen ihre Stücke in weiteren Runden desselben Abgleichs.
pub async fn abgleich_einmal(
    pool: &SqlitePool,
    router: Option<&axum::Router>,
    kopplung: &KopplungZeile,
) -> Result<(), SendError> {
    let fehler = |e: AppError| SendError::Netz(e.to_string());
    let eigen = identitaet::load_or_create(pool)
        .await
        .map_err(|e| SendError::Netz(e.to_string()))?;
    let mut abgerufen: Vec<super::paket::AnhangAbruf> = Vec::new();
    for runde in 0..RUNDEN_MAX {
        let anfrage = crate::write_retry!(pool, |conn| {
            let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
            let staende = eigene_staende(conn, kopplung.id).await?;
            let ziele: Vec<(String, i64)> = sqlx::query_as(
                "SELECT e.kennung, z.stand FROM spiegel_ziel z JOIN einsatz e ON e.id = z.einsatz_id \
                 JOIN instanz_kopplung_org o ON o.id = z.kopplung_org_id \
                 WHERE o.kopplung_id = ? AND e.kennung IS NOT NULL",
            )
            .bind(kopplung.id)
            .fetch_all(&mut *conn)
            .await?;
            let ziele: HashMap<String, i64> = ziele.into_iter().collect();
            // Anträge stehen vorn (D8) und zählen ins Budget.
            let (antraege, antrag_bytes) =
                super::antrag::offene_antraege(conn, kopplung.id, true).await?;
            let mut budget = Budget::neu(SPIEGEL_MAX - RESERVE - antrag_bytes);
            let lieferungen =
                liefere_alle(conn, &eigen, kopplung, &orgs, &ziele, &mut budget).await?;
            let anhang_teile =
                super::anhang::liefere_teile(conn, kopplung.id, &abgerufen, budget.bytes).await?;
            let abrufe = super::anhang::offene_abrufe(conn, kopplung.id).await?;
            let quittungen = super::antrag::offene_quittungen(conn, kopplung.id).await?;
            Ok(SpiegelPaket {
                staende,
                lieferungen,
                abrufe,
                anhang_teile,
                antraege,
                quittungen,
            })
        })
        .map_err(fehler)?;
        let antwort = melden::send_signed_bis::<_, SpiegelPaket>(
            &eigen,
            kopplung,
            SPIEGEL_PFAD,
            &anfrage,
            SPIEGEL_MAX,
        )
        .await?
        .wert;
        antwort.check().map_err(SendError::AntwortUngueltig)?;
        let mut uebernommen = Uebernommen::default();
        crate::write_retry!(pool, |conn| {
            uebernommen = Uebernommen::default();
            let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
            // Push: was die erreichte Seite übernommen hat. Ein niedrigerer Stand
            // (Wiederherstellung, verlorener Spiegel) setzt zurück.
            for s in &antwort.staende {
                let Some(l) = anfrage.lieferungen.iter().find(|l| l.kennung == s.kennung) else {
                    continue;
                };
                let Some(o) = orgs.iter().find(|o| o.fremde_org_kennung == l.org) else {
                    continue;
                };
                sqlx::query(
                    "INSERT INTO spiegel_ziel (kopplung_org_id, einsatz_id, stand) \
                     SELECT ?, id, ? FROM einsatz WHERE kennung = ? \
                     ON CONFLICT (kopplung_org_id, einsatz_id) DO UPDATE SET stand = excluded.stand",
                )
                .bind(o.id)
                .bind(s.stand)
                .bind(&s.kennung)
                .execute(&mut *conn)
                .await?;
            }
            uebernehme_alle(conn, &eigen, kopplung, &orgs, &antwort, &mut uebernommen).await?;
            let fertig =
                super::anhang::uebernehme_teile(conn, kopplung.id, &antwort.anhang_teile).await?;
            uebernommen.einsaetze.extend(fertig);
            let gesendet: Vec<i64> = anfrage.antraege.iter().map(|a| a.id).collect();
            super::antrag::markiere_zugestellt(conn, &gesendet).await?;
            let quittiert =
                super::antrag::quittungen_uebernehmen(conn, kopplung.id, &antwort.quittungen)
                    .await?;
            uebernommen.einsaetze.extend(quittiert);
            let quittiert: Vec<i64> = anfrage.quittungen.iter().map(|q| q.id).collect();
            let offen: Vec<i64> = antwort.antraege.iter().map(|a| a.id).collect();
            super::antrag::markiere_gemeldet(conn, kopplung.id, &quittiert, &offen).await?;
            Ok(())
        })
        .map_err(fehler)?;
        melde_live(pool, &uebernommen).await;
        // Anträge an Einsätze, die hier geführt werden; die Quittungen gehen mit der nächsten
        // Anfrage hinaus.
        let mut ausgefuehrt = false;
        if let Some(router) = router {
            for a in &antwort.antraege {
                if super::antrag::ausfuehren(pool, router, kopplung, true, a)
                    .await
                    .map_err(fehler)?
                    .is_some()
                {
                    ausgefuehrt = true;
                }
            }
        }
        abgerufen = antwort.abrufe;
        let weiter = !abgerufen.is_empty() || !antwort.anhang_teile.is_empty() || ausgefuehrt;
        if !weiter || runde + 1 == RUNDEN_MAX {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod reihum_tests {
    use super::*;
    use std::collections::BTreeSet;

    fn spiegel(laufend: usize, abgeschlossen: usize) -> Vec<(String, i64, bool)> {
        (0..laufend)
            .map(|i| (format!("l{i}"), 0, true))
            .chain((0..abgeschlossen).map(|i| (format!("a{i}"), 0, false)))
            .collect()
    }

    #[test]
    fn mehr_spiegel_als_ein_paket_traegt_kommen_reihum_alle_dran() {
        let mut alle = BTreeSet::new();
        for runde in 0..400 {
            let auswahl = auswahl_staende(spiegel(10, 400), runde);
            assert_eq!(auswahl.len(), EINSAETZE_MAX);
            let kennungen: BTreeSet<_> = auswahl.iter().map(|s| s.kennung.clone()).collect();
            assert!(
                (0..10).all(|i| kennungen.contains(&format!("l{i}"))),
                "laufende sind immer dabei"
            );
            alle.extend(kennungen);
        }
        assert_eq!(alle.len(), 410, "jeder Spiegel kommt irgendwann dran");
    }

    /// Der Aufrufpfad: Stände und Lieferung zählen je Kopplung getrennt, jede Runde rückt um eins.
    /// Mit 255 laufenden und zwei abgeschlossenen Spiegeln bleibt ein Platz; beide kommen dran.
    #[test]
    fn ein_freier_platz_wechselt_zwischen_zwei_abgeschlossenen() {
        let kopplung = -1630;
        let mut gesehen = BTreeSet::new();
        for _ in 0..4 {
            // Die Lieferung derselben Kopplung zählt dazwischen, darf die Auswahl aber nicht
            // verschieben.
            naechste_runde(&RUNDE_LIEFERN, kopplung);
            let runde = naechste_runde(&RUNDE_STAENDE, kopplung);
            let auswahl = auswahl_staende(spiegel(EINSAETZE_MAX - 1, 2), runde);
            gesehen.extend(
                auswahl
                    .into_iter()
                    .map(|s| s.kennung)
                    .filter(|k| k.starts_with('a')),
            );
        }
        assert_eq!(
            gesehen,
            BTreeSet::from(["a0".to_string(), "a1".to_string()])
        );
        assert_eq!(
            naechste_runde(&RUNDE_STAENDE, kopplung - 1),
            0,
            "je Kopplung"
        );
    }

    #[test]
    fn ein_hinweis_zu_gross_bleibt_bis_die_zeile_kommt() {
        let a = uebernehmen::zu_gross_hinweis("etb_eintrag", "1");
        let b = uebernehmen::zu_gross_hinweis("etb_eintrag", "2");
        // Runde 1: Zeile 1 zu groß.
        let h = hinweise_fortschreiben(None, std::slice::from_ref(&a), &[]);
        assert_eq!(h.as_deref(), Some(a.as_str()));
        // Runde 2: Zeile 2 zu groß, Zeile 1 kommt nicht neu: beide stehen.
        let h = hinweise_fortschreiben(h.as_deref(), std::slice::from_ref(&b), &[]);
        assert_eq!(h, Some(format!("{a}\n{b}")));
        // Runde 3: Zeile 1 kommt mit Daten, keine neuen Hinweise: nur Zeile 2 bleibt.
        let geliefert = [uebernehmen::zu_gross_anfang("etb_eintrag", "1")];
        let h = hinweise_fortschreiben(h.as_deref(), &[], &geliefert);
        assert_eq!(h.as_deref(), Some(b.as_str()));
        // Zeile 10 ist nicht Zeile 1.
        let c = uebernehmen::zu_gross_hinweis("etb_eintrag", "10");
        assert_eq!(
            hinweise_fortschreiben(Some(&c), &[], &geliefert).as_deref(),
            Some(c.as_str())
        );
        // Andere Hinweise ersetzt ein neuer wie bisher.
        let h = hinweise_fortschreiben(
            Some("Lieferung nicht übernommen: x"),
            &["Lieferung nicht übernommen: y".into()],
            &[],
        );
        assert_eq!(h.as_deref(), Some("Lieferung nicht übernommen: y"));
    }

    #[test]
    fn bis_zur_grenze_bleibt_alles_wie_es_ist() {
        let auswahl = auswahl_staende(spiegel(3, 5), 7);
        let kennungen: Vec<_> = auswahl.iter().map(|s| s.kennung.as_str()).collect();
        assert_eq!(kennungen, ["l0", "l1", "l2", "a0", "a1", "a2", "a3", "a4"]);
    }
}

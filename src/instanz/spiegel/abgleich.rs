//! Abgleich der Einsätze über `POST /api/instanz/spiegel` (design.md D6, D7, D12).
//!
//! Die meldende Seite ruft, die erreichte antwortet; beide schicken dasselbe [`SpiegelPaket`].
//! Führt die meldende Seite einen Einsatz, liefert sie ihn in der Anfrage und merkt sich den Stand
//! aus der Antwort (`spiegel_ziel`, Push). Führt die erreichte Seite, nennt die meldende ihren
//! Stand und bekommt die Lieferung in der Antwort (Pull). Den Stand nennt immer, wer spiegelt.
//! Ebenso nennt, wer eine Führungsakte ohne Spiegel hält, ihre Kennung (`akten`, LLH-1699), und
//! erfährt in `lebensende`, ob der Einsatz beim Gegenüber endgültig weg ist.

use super::lebensende;
use super::liefern::{self, Absender, Budget};
use super::paket::{
    EinsatzStand, Lebensende, SpiegelPaket, EINSAETZE_MAX, LEBENSENDE_GELOESCHT, RESERVE,
    SPIEGEL_MAX,
};
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
/// Zähler je Kopplung für die Auswahl der genannten Akten ohne Spiegel (LLH-1699).
static RUNDE_AKTEN: Mutex<Option<HashMap<i64, usize>>> = Mutex::new(None);

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

/// Stände der Spiegel dieser Instanz für eine Kopplung; ohne Spiegel, die gerade abgeräumt werden.
async fn eigene_staende(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<Vec<EinsatzStand>, AppError> {
    // Höchstens so viele, wie ein Paket trägt: die laufenden zuerst, dann reihum die übrigen. Ein
    // abgeschlossener Spiegel, der hier fehlt, bekommt in diesem Abgleich nichts (der Führer
    // liefert nur laufende Einsätze ungenannt). Spiegel enden erst mit dem Widerruf, über Jahre
    // werden es also mehr als ein Paket trägt; eine feste Auswahl schnitte immer dieselben ab, und
    // deren Nachträge kämen nie an (LLH-1630).
    let zeilen: Vec<(String, i64, bool, i64)> = sqlx::query_as(
        "SELECT s.fremde_kennung, s.stand, e.status <> 'abgeschlossen', s.einsatz_id \
         FROM einsatz_spiegel s \
         JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         JOIN einsatz e ON e.id = s.einsatz_id \
         WHERE o.kopplung_id = ? AND o.widerrufen_at IS NULL AND s.beendet_at IS NULL \
         AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = s.einsatz_id) \
         ORDER BY s.einsatz_id DESC",
    )
    .bind(kopplung_id)
    .fetch_all(&mut *conn)
    .await?;
    let einsaetze: HashMap<String, i64> = zeilen
        .iter()
        .map(|(kennung, _, _, id)| (kennung.clone(), *id))
        .collect();
    let mut staende = auswahl_staende(
        zeilen
            .into_iter()
            .map(|(kennung, stand, laufend, _)| (kennung, stand, laufend))
            .collect(),
        naechste_runde(&RUNDE_STAENDE, kopplung_id),
    );
    // Dazu die offenen Fragen der Bruchstelle (LLH-1641, E6).
    for s in &mut staende {
        if let Some(&einsatz_id) = einsaetze.get(&s.kennung) {
            s.bruch = super::fuehrung::offene_bruch_fragen(conn, einsatz_id).await?;
        }
    }
    Ok(staende)
}

/// Die laufenden zuerst, dann die übrigen, je Gruppe reihum, zusammen höchstens
/// [`EINSAETZE_MAX`]; mindestens ein Platz bleibt den übrigen.
fn auswahl_staende(zeilen: Vec<(String, i64, bool)>, runde: usize) -> Vec<EinsatzStand> {
    let (laufend, uebrig): (Vec<_>, Vec<_>) = zeilen.into_iter().partition(|z| z.2);
    // Ein Platz bleibt den übrigen, auch wenn die laufenden allein das Paket füllten: sonst kämen
    // Nachträge abgeschlossener Spiegel nie an.
    let fuer_laufende = if uebrig.is_empty() {
        EINSAETZE_MAX
    } else {
        EINSAETZE_MAX - 1
    };
    let mut auswahl = if laufend.len() > fuer_laufende {
        reihum(laufend, runde)
    } else {
        laufend
    };
    auswahl.truncate(fuer_laufende);
    let frei = EINSAETZE_MAX - auswahl.len();
    if uebrig.len() > frei {
        auswahl.extend(reihum(uebrig, runde).into_iter().take(frei));
    } else {
        auswahl.extend(uebrig);
    }
    auswahl
        .into_iter()
        .map(|(kennung, stand, _)| EinsatzStand {
            kennung,
            stand,
            bruch: Vec::new(),
        })
        .collect()
}

/// Kennungen der Akten ohne Spiegel, nach denen diese Instanz das Gegenüber fragt (LLH-1699,
/// Change `h7shm5au-loeschsignal-spiegellose-akten`, D1, D2); welche das sind, sagt
/// `fuehrung::repo::list_ohne_spiegel`.
async fn eigene_akten(
    conn: &mut SqliteConnection,
    kopplung: &KopplungZeile,
) -> Result<Vec<String>, AppError> {
    let Some(richtung) = kopplung.richtung() else {
        return Ok(Vec::new());
    };
    let alle = crate::instanz::fuehrung::repo::list_ohne_spiegel(
        conn,
        kopplung.id,
        richtung,
        &kopplung.gegenueber_kennung,
    )
    .await?;
    if alle.len() <= EINSAETZE_MAX {
        return Ok(alle);
    }
    Ok(auswahl_akten(
        alle,
        naechste_runde(&RUNDE_AKTEN, kopplung.id),
    ))
}

/// Budget der Zeilen eines Pakets: was neben der Reserve, den Anträgen und den genannten Akten
/// bleibt. Die Akten belegen im JSON je Kennung ihre Länge plus Anführungszeichen und Komma
/// (`paket::is_kennung_nennbar` lässt nichts zu, das JSON maskiert), zusammen höchstens
/// `paket::AKTEN_BYTES_MAX`; damit bleibt das Budget nie unter `paket::ZEILE_MAX`.
fn budget_fuer_zeilen(antrag_bytes: usize, akten: &[String]) -> Budget {
    let akten_bytes: usize = akten.iter().map(|k| k.len() + 3).sum();
    Budget::neu(SPIEGEL_MAX - RESERVE - antrag_bytes - akten_bytes)
}

/// Höchstens [`EINSAETZE_MAX`] Akten je Paket. Sind es mehr, rückt die Auswahl je Abgleich um ein
/// ganzes Paket weiter: Über alle Runden kommt jede Akte dran, auch wenn keine je endet.
fn auswahl_akten(mut alle: Vec<String>, runde: usize) -> Vec<String> {
    let n = alle.len();
    if n > EINSAETZE_MAX {
        alle.rotate_left(runde.wrapping_mul(EINSAETZE_MAX) % n);
        alle.truncate(EINSAETZE_MAX);
    }
    alle
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
    let meldend = uebersetzt(kopplung);
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

/// Ob diese Seite Stammdaten über die Herkunft der Kopplung übersetzt (D5): nur die meldende
/// Seite einer Standardkopplung hält sie; über eine Direktkopplung fließen keine Stammdaten, dort
/// zählt die Ursprungskennung (LLH-1497).
pub fn uebersetzt(kopplung: &KopplungZeile) -> bool {
    kopplung.richtung() == Some(InstanzKopplungRichtung::MeldetSich)
        && kopplung.art() == crate::instanz::InstanzKopplungArt::Standard
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
    let meldend = uebersetzt(kopplung);
    let mut staende = Vec::new();
    // Ein Gegenüber liefert nur Einsätze, die es selbst führt: ihre Kennung beginnt mit seiner.
    let praefix = format!("{}/", kopplung.gegenueber_kennung);
    for l in &paket.lieferungen {
        let Some(o) = orgs.iter().find(|o| org_wire(eigen, kopplung, o) == l.org) else {
            continue;
        };
        // Nach einem Führungswechsel liefert der neue Führer auch Einsätze mit fremder Kennung;
        // dann nennt ihn die Akte hier (LLH-1641, E3).
        if !l.kennung.starts_with(&praefix)
            && !super::fuehrung::fuehrt_laut_akte(conn, &l.kennung, &kopplung.gegenueber_kennung)
                .await?
        {
            tracing::warn!(kennung = %l.kennung, "Spiegel: Lieferung eines fremden Einsatzes verworfen");
            continue;
        }
        let e = Empfaenger {
            kopplung_id: kopplung.id,
            kopplung_org_id: o.id,
            org_id: o.org_id,
            meldend,
            vor_ort: kopplung.art() == crate::instanz::InstanzKopplungArt::VorOrt,
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
            save_hinweis(conn, id, &erg.hinweise, &erg.erledigt).await?;
        }
        if let Some(id) = erg.einsatz_id {
            if !erg.kategorien.is_empty() {
                uebernommen.einsaetze.push(id);
                if vorher.is_none() {
                    uebernommen.neu.push(id);
                }
            }
        }
        let bruch = match erg.einsatz_id {
            Some(id) => super::fuehrung::offene_bruch_fragen(conn, id).await?,
            None => Vec::new(),
        };
        staende.push(EinsatzStand {
            kennung: l.kennung.clone(),
            stand: erg.stand,
            bruch,
        });
    }
    Ok(staende)
}

async fn save_hinweis(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    hinweise: &[String],
    erledigt: &[(String, String)],
) -> Result<(), AppError> {
    let alt: Option<String> =
        sqlx::query_scalar("SELECT hinweis FROM einsatz_spiegel WHERE einsatz_id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?
            .flatten();
    let geliefert: Vec<String> = erledigt
        .iter()
        .map(|(art, schluessel)| uebernehmen::zu_gross_anfang(art, schluessel))
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

/// Der Hinweis am Spiegel nach einer Übernahme. „Zu groß“ steht je Zeile, bis dieselbe Zeile
/// übernommen oder gelöscht ist (`Ergebnis::erledigt`): ihr Stand wird nicht neu geliefert, der
/// Hinweis ginge sonst mit der nächsten Runde verloren, und er zählt nicht zur Grenze von 20
/// (LLH-1630). Andere Hinweise gelten nur für die letzte Übernahme, höchstens 20.
fn hinweise_fortschreiben(
    alt: Option<&str>,
    neu: &[String],
    erledigt: &[String],
) -> Option<String> {
    let ist_erledigt = |zeile: &str| erledigt.iter().any(|g| zeile.starts_with(g.as_str()));
    let ist_zu_gross = |zeile: &str| zeile.starts_with("Zeile ") && zeile.contains(" ist zu groß");
    let alte: Vec<&str> = alt
        .unwrap_or("")
        .lines()
        .filter(|z| !z.is_empty())
        .collect();
    let mut zeilen: Vec<String> = Vec::new();
    for z in alte
        .iter()
        .copied()
        .chain(neu.iter().map(String::as_str))
        .filter(|z| ist_zu_gross(z) && !ist_erledigt(z))
    {
        if !zeilen.iter().any(|v| v == z) {
            zeilen.push(z.to_owned());
        }
    }
    let neue_andere: Vec<&str> = neu
        .iter()
        .map(String::as_str)
        .filter(|z| !ist_zu_gross(z))
        .collect();
    zeilen.extend(neue_andere.into_iter().take(20).map(str::to_owned));
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
    live: &crate::live::LiveHub,
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
    let mut abzuraeumen = Vec::new();
    let mut hinweis_folgen = Vec::new();
    let jetzt = crate::zeit::jetzt();
    let antwort = crate::write_retry!(pool, |conn| {
        uebernommen = Uebernommen::default();
        let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
        // Bruchstellen vor den Lieferungen klären (LLH-1641, E6).
        let geklaert =
            super::fuehrung::uebernimm_bruch_antworten(conn, kopplung.id, &anfrage.bruch_antworten)
                .await?;
        uebernommen.einsaetze.extend(geklaert);
        let mut staende_antwort =
            uebernehme_alle(conn, eigen, kopplung, &orgs, anfrage, &mut uebernommen).await?;
        // Hinweise nach den Zeilen, damit ihre Bezüge schon im Spiegel stehen (LLH-1495, D2).
        let (hinweis_quittungen, folgen) =
            super::hinweis::annehmen(conn, kopplung, &anfrage.hinweise, chrono::Utc::now()).await?;
        hinweis_folgen = folgen;
        let bruch_antworten =
            super::fuehrung::beantworte_staende(conn, kopplung.id, &anfrage.staende).await?;
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
        // Lebensende (LLH-1494, D3, D4): Spiegel, deren Führer sie gelöscht hat, abräumen;
        // übergebene Einsätze annehmen oder sagen, worauf sie warten (fehlende Anhänge werden
        // angefordert und gehen unten mit den Abrufen hinaus).
        abzuraeumen =
            lebensende::geloescht_uebernehmen(conn, kopplung, &anfrage.lebensende).await?;
        // Push (LLH-1699): Akten ohne Spiegel, deren Einsatz die meldende Seite gelöscht hat.
        lebensende::geloeschte_akten_uebernehmen(conn, kopplung, &anfrage.lebensende).await?;
        let mut lebensende_quittungen = Vec::new();
        // Verwahrung nur über eine Kopplung, die sie trägt (LLH-1497): vor Ort wird kein
        // übergebener Einsatz angenommen.
        let verwahrung = kopplung.art().traegt(crate::instanz::Fluss::Verwahrung);
        for l in anfrage.lebensende.iter().filter(|_| verwahrung) {
            if let Some((q, umgewandelt)) =
                lebensende::verwahrung_annehmen(conn, kopplung, l, &jetzt).await?
            {
                lebensende_quittungen.push(q);
                uebernommen.einsaetze.extend(umgewandelt);
            }
        }
        // Pull: genannte Einsätze, die hier gelöscht sind; dazu genannte Akten ohne Spiegel,
        // deren Ende diese Instanz belegt (LLH-1699).
        let mut geloescht = lebensende::geloeschte(conn, &eigen.kennung, &anfrage.staende).await?;
        let platz = EINSAETZE_MAX.saturating_sub(geloescht.len());
        geloescht.extend(
            lebensende::geloeschte_akten(conn, kopplung.id, &eigen.kennung, &anfrage.akten)
                .await?
                .into_iter()
                .take(platz),
        );
        // Push: die eigenen Akten ohne Spiegel, die die meldende Seite führt (nach dem Löschen
        // oben, damit eine eben gelöschte nicht noch einmal genannt wird).
        let akten = eigene_akten(conn, kopplung).await?;
        // Push: die Stände aller Spiegel dieser Kopplung, damit die meldende Seite gelöschte
        // Einsätze erkennt (ein älterer Stand überliest Kennungen ohne Lieferung).
        for s in eigene_staende(conn, kopplung.id).await? {
            if staende_antwort.len() >= EINSAETZE_MAX {
                break;
            }
            if !staende_antwort.iter().any(|a| a.kennung == s.kennung) {
                staende_antwort.push(s);
            }
        }
        // Anträge stehen vorn (D8) und zählen ins Budget.
        let (antraege, antrag_bytes) =
            super::antrag::offene_antraege(conn, kopplung.id, false).await?;
        let mut budget = budget_fuer_zeilen(antrag_bytes, &akten);
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
            lebensende: geloescht,
            lebensende_quittungen,
            bruch_antworten,
            hinweise: Vec::new(),
            hinweis_quittungen,
            akten,
        })
    })?;
    melde_live(pool, &uebernommen).await;
    lebensende::abraeumen_nach_commit(pool, Some(live), &abzuraeumen).await;
    super::hinweis::ausfuehren(pool, live, hinweis_folgen).await;
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
    // Gelöschte Einsätze, die das Gegenüber noch spiegelt (aus seiner letzten Antwort).
    let mut geloescht_offen: Vec<Lebensende> = Vec::new();
    // Antworten auf Bruchstellen, nach denen die erreichte Seite in ihrer Antwort fragte; sie gehen
    // mit der nächsten Runde hinaus (LLH-1641, E6).
    let mut bruch_antworten: Vec<super::paket::BruchAntwort> = Vec::new();
    let mut hinweise_mehr = false;
    for runde in 0..RUNDEN_MAX {
        let jetzt = crate::zeit::jetzt();
        let anfrage = crate::write_retry!(pool, |conn| {
            let orgs = repo::list_orgs_aktiv(conn, kopplung.id).await?;
            let staende = eigene_staende(conn, kopplung.id).await?;
            let akten = eigene_akten(conn, kopplung).await?;
            let ziele: Vec<(String, i64)> = sqlx::query_as(
                "SELECT e.kennung, z.stand FROM spiegel_ziel z JOIN einsatz e ON e.id = z.einsatz_id \
                 JOIN instanz_kopplung_org o ON o.id = z.kopplung_org_id \
                 WHERE o.kopplung_id = ? AND e.kennung IS NOT NULL",
            )
            .bind(kopplung.id)
            .fetch_all(&mut *conn)
            .await?;
            let mut ziele: HashMap<String, i64> = ziele.into_iter().collect();
            // Zur Verwahrung fällige Einsätze (LLH-1494, D4) gehen auch hinaus, wenn das Gegenüber
            // sie noch nicht kennt (etwa ohne Netz angelegt und abgeschlossen).
            let mut lebensende = if kopplung.art().traegt(crate::instanz::Fluss::Verwahrung) {
                lebensende::faellige_verwahrungen(conn, &eigen.kennung, &orgs, &jetzt).await?
            } else {
                Vec::new()
            };
            for l in &lebensende {
                ziele.entry(l.kennung.clone()).or_insert(0);
            }
            let platz = EINSAETZE_MAX.saturating_sub(lebensende.len());
            lebensende.extend(geloescht_offen.iter().take(platz).cloned());
            // Anträge stehen vorn (D8) und zählen ins Budget.
            let (antraege, antrag_bytes) =
                super::antrag::offene_antraege(conn, kopplung.id, uebersetzt(kopplung)).await?;
            let mut budget = budget_fuer_zeilen(antrag_bytes, &akten);
            let lieferungen =
                liefere_alle(conn, &eigen, kopplung, &orgs, &ziele, &mut budget).await?;
            let anhang_teile =
                super::anhang::liefere_teile(conn, kopplung.id, &abgerufen, budget.bytes).await?;
            let abrufe = super::anhang::offene_abrufe(conn, kopplung.id).await?;
            let quittungen = super::antrag::offene_quittungen(conn, kopplung.id).await?;
            // Hinweise nach den Lieferungen: erst das Liefern gibt einem neuen Einsatz seine
            // Kennung (LLH-1495, D2); ihr Platz kommt aus der Reserve.
            let (hinweise, mehr) =
                super::hinweis::offene(conn, kopplung.id, chrono::Utc::now()).await?;
            hinweise_mehr = mehr;
            Ok(SpiegelPaket {
                staende,
                lieferungen,
                abrufe,
                anhang_teile,
                antraege,
                quittungen,
                lebensende,
                lebensende_quittungen: Vec::new(),
                bruch_antworten: bruch_antworten.clone(),
                hinweise,
                hinweis_quittungen: Vec::new(),
                akten,
            })
        })
        .map_err(fehler)?;
        let antwort = melden::send_signed_bis::<_, SpiegelPaket>(
            pool,
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
        let mut abzuraeumen = Vec::new();
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
            // Bruchstellen vor den Lieferungen klären (LLH-1641, E6).
            let geklaert = super::fuehrung::uebernimm_bruch_antworten(
                conn,
                kopplung.id,
                &antwort.bruch_antworten,
            )
            .await?;
            uebernommen.einsaetze.extend(geklaert);
            uebernehme_alle(conn, &eigen, kopplung, &orgs, &antwort, &mut uebernommen).await?;
            bruch_antworten =
                super::fuehrung::beantworte_staende(conn, kopplung.id, &antwort.staende).await?;
            let fertig =
                super::anhang::uebernehme_teile(conn, kopplung.id, &antwort.anhang_teile).await?;
            uebernommen.einsaetze.extend(fertig);
            let gesendet: Vec<i64> = anfrage.antraege.iter().map(|a| a.id).collect();
            super::antrag::markiere_zugestellt(conn, &gesendet).await?;
            let quittiert =
                super::antrag::quittungen_uebernehmen(conn, kopplung.id, &antwort.quittungen)
                    .await?;
            uebernommen.einsaetze.extend(quittiert);
            super::hinweis::quittiert(conn, kopplung.id, &antwort.hinweis_quittungen).await?;
            let quittiert: Vec<i64> = anfrage.quittungen.iter().map(|q| q.id).collect();
            let offen: Vec<i64> = antwort.antraege.iter().map(|a| a.id).collect();
            super::antrag::markiere_gemeldet(conn, kopplung.id, &quittiert, &offen).await?;
            // Lebensende (LLH-1494): Spiegel, deren Führer sie gelöscht hat, und angenommene
            // Verwahrungen abräumen; gelöschte eigene Einsätze, die das Gegenüber noch spiegelt,
            // in der nächsten Anfrage melden.
            abzuraeumen =
                lebensende::geloescht_uebernehmen(conn, kopplung, &antwort.lebensende).await?;
            // Pull (LLH-1699): Akten ohne Spiegel, deren Einsatz die erreichte Seite nicht mehr hat.
            lebensende::geloeschte_akten_uebernehmen(conn, kopplung, &antwort.lebensende).await?;
            abzuraeumen.extend(
                lebensende::quittungen_uebernehmen(
                    conn,
                    kopplung,
                    &eigen.kennung,
                    &anfrage.lebensende,
                    &antwort.lebensende_quittungen,
                    &jetzt,
                )
                .await?,
            );
            let gesendet: Vec<&str> = anfrage
                .lebensende
                .iter()
                .filter(|l| l.art == LEBENSENDE_GELOESCHT)
                .map(|l| l.kennung.as_str())
                .collect();
            // Push (LLH-1699): Akten ohne Spiegel, die die erreichte Seite nennt und deren Ende
            // diese Instanz belegt, gehen wie die gelöschten Spiegel mit der nächsten Runde hinaus.
            let akten_geloescht =
                lebensende::geloeschte_akten(conn, kopplung.id, &eigen.kennung, &antwort.akten)
                    .await?;
            geloescht_offen = lebensende::geloeschte(conn, &eigen.kennung, &antwort.staende)
                .await?
                .into_iter()
                .chain(akten_geloescht)
                .filter(|l| !gesendet.contains(&l.kennung.as_str()))
                .collect();
            Ok(())
        })
        .map_err(fehler)?;
        melde_live(pool, &uebernommen).await;
        lebensende::abraeumen_nach_commit(pool, crate::instanz::stammdaten::live(), &abzuraeumen)
            .await;
        // Anträge an Einsätze, die hier geführt werden; die Quittungen gehen mit der nächsten
        // Anfrage hinaus.
        let mut ausgefuehrt = false;
        if let Some(router) = router {
            for a in &antwort.antraege {
                if super::antrag::ausfuehren(pool, router, kopplung, uebersetzt(kopplung), a)
                    .await
                    .map_err(fehler)?
                    .is_some()
                {
                    ausgefuehrt = true;
                }
            }
        }
        abgerufen = antwort.abrufe;
        let weiter = !abgerufen.is_empty()
            || !antwort.anhang_teile.is_empty()
            || ausgefuehrt
            || !geloescht_offen.is_empty()
            || !bruch_antworten.is_empty()
            || hinweise_mehr;
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

    /// LLH-1699: Mehr Akten ohne Spiegel, als ein Paket trägt, kommen über die Runden alle dran,
    /// jede Runde ein ganzes Paket weiter; passen sie hinein, bleibt die Liste, wie sie ist.
    #[test]
    fn mehr_akten_als_ein_paket_traegt_kommen_paketweise_alle_dran() {
        let alle: Vec<String> = (0..700).map(|i| format!("a{i}")).collect();
        let mut gesehen = BTreeSet::new();
        for runde in 0..3 {
            let auswahl = auswahl_akten(alle.clone(), runde);
            assert_eq!(auswahl.len(), EINSAETZE_MAX);
            gesehen.extend(auswahl);
        }
        assert_eq!(gesehen.len(), 700, "nach drei Runden war jede Akte dabei");
        let wenige: Vec<String> = (0..3).map(|i| format!("a{i}")).collect();
        assert_eq!(auswahl_akten(wenige.clone(), 5), wenige);
    }

    /// LLH-1699: Die genannten Akten gehen vom Budget der Zeilen ab, und auch mit vollen Anträgen
    /// und vollen Akten bleibt dem ersten Einsatz eine Zeile bis `ZEILE_MAX`.
    #[test]
    fn genannte_akten_gehen_vom_budget_ab_und_lassen_platz_fuer_die_groesste_zeile() {
        use super::super::paket::{
            AKTEN_BYTES_MAX, ANTRAEGE_BYTES_MAX, KENNUNG_BYTES_MAX, ZEILE_MAX,
        };
        let ohne = budget_fuer_zeilen(0, &[]).bytes;
        assert_eq!(ohne, SPIEGEL_MAX - RESERVE);
        let akten = vec!["hub/7-ab12cd34".to_string(), "hub/8-ef".to_string()];
        let belegt = serde_json::to_vec(&akten).unwrap().len();
        let mit = budget_fuer_zeilen(1000, &akten).bytes;
        assert_eq!(mit, ohne - 1000 - (14 + 3) - (8 + 3));
        assert!(
            ohne - 1000 - mit + 2 >= belegt,
            "abgezogen wird, was das JSON belegt"
        );
        let voll = vec!["!".repeat(KENNUNG_BYTES_MAX); EINSAETZE_MAX];
        assert_eq!(
            budget_fuer_zeilen(ANTRAEGE_BYTES_MAX, &voll).bytes,
            ZEILE_MAX,
            "volle Anträge und volle Akten lassen genau ZEILE_MAX"
        );
        assert_eq!(voll.len() * (KENNUNG_BYTES_MAX + 3), AKTEN_BYTES_MAX);
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

    /// Füllen die laufenden allein das Paket, bleibt ein Platz für die übrigen, reihum.
    #[test]
    fn auch_bei_vollem_paket_kommen_abgeschlossene_dran() {
        let mut gesehen = BTreeSet::new();
        for runde in 0..4 {
            let auswahl = auswahl_staende(spiegel(EINSAETZE_MAX + 44, 2), runde);
            assert_eq!(auswahl.len(), EINSAETZE_MAX);
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
        // Ohne übrige bekommen die laufenden alle Plätze.
        assert_eq!(
            auswahl_staende(spiegel(EINSAETZE_MAX + 44, 0), 0).len(),
            EINSAETZE_MAX
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
        // Über 20 „zu groß“ geht keiner verloren; andere Hinweise bleiben bei 20.
        let viele: Vec<String> = (0..25)
            .map(|i| uebernehmen::zu_gross_hinweis("anhang", &i.to_string()))
            .chain((0..25).map(|i| format!("Lieferung nicht übernommen: {i}")))
            .collect();
        let h = hinweise_fortschreiben(None, &viele, &[]).unwrap();
        assert_eq!(h.lines().filter(|z| z.contains("zu groß")).count(), 25);
        assert_eq!(
            h.lines().filter(|z| z.contains("nicht übernommen")).count(),
            20
        );
        // Eine Übernahme ohne Hinweise räumt alte andere Hinweise, „zu groß“ bleibt.
        let h = hinweise_fortschreiben(
            Some(&format!("{c}\nLieferung nicht übernommen: x")),
            &[],
            &[],
        );
        assert_eq!(h.as_deref(), Some(c.as_str()));
        // Andere Hinweise ersetzt ein neuer.
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

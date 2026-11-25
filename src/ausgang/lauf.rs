//! Der Lauf des Ausgangskorbs (LLH-2093, Spec Abschnitte 2, 3 und 6; Muster `adapter::lauf`).
//!
//! Je [`TAKT`] oder beim Wecken ein Durchgang: die fälligen Versände laden, bis zu [`PARALLEL`]
//! gleichzeitig zustellen, keinen doppelt. Je Versand, in dieser Reihenfolge: Spiegel? Quelle
//! überholt? SMTP-Zugang der Org; Beginn merken (`mark_begonnen`); Anhänge laden; Mail bauen;
//! zustellen, **ohne** eine Datenbankverbindung zu halten; Ergebnis und ETB-Eintrag in einer
//! Transaktion (`write_retry!`); nach dem Commit `publiziere` und das Ereignis der Versandliste.
//!
//! Ein Versand ist nie halb: entweder übergeben **und** im ETB, oder sichtbar fehlgeschlagen
//! (am Spiegel ohne ETB, das dort gesperrt ist). Kein Geheimnis und kein Text des Mailservers
//! gelangt in Log, ETB oder Spalte; der ETB-Text nennt nur einen festen Grund.

use std::collections::HashSet;
use std::panic::AssertUnwindSafe;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use futures::FutureExt;
use sqlx::SqlitePool;
use tokio::sync::{Notify, Semaphore};
use tokio::task::JoinHandle;

use super::nachricht::{self, AnhangFehler, Schnappschuss};
use super::repo::{self, Abfrage, Ergebnis};
use super::zustand::{naechste_abfrage, naechster_versuch};
pub use super::zusteller::{SmtpZusteller, Versandzugang, Zusteller, Zustellwege};
use super::{AusgangFehler, QuelleArt, VersandZeile};
use crate::adapter::sipgate::FaxStatus;
use crate::adapter::sipgate::{FaxAuftrag, SipgateFehler};
use crate::adapter::smtp::SmtpFehler;
use crate::adapter::Rahmen;
use crate::error::AppError;
use crate::etb::nachlauf::{self, Luecke};
use crate::externe_stelle::KanalArt;
use crate::live::{LiveEvent, LiveHub};
use crate::zeit;

/// Abstand der Durchgänge; dazwischen weckt das Anlegen eines Versands den Lauf.
pub const TAKT: Duration = Duration::from_secs(2);

/// Höchstzahl gleichzeitiger Zustellungen.
pub const PARALLEL: usize = 4;

/// Höchstzahl der Versände, die ein Durchgang lädt.
const JE_DURCHGANG: i64 = 50;

/// Versände, die gerade zugestellt werden; ein Durchgang lässt sie aus (gegen Doppelzustellung).
type Laufend = Arc<Mutex<HashSet<String>>>;

/// Startet den Lauf: beim Start [`beim_start`], danach je [`TAKT`] oder beim Wecken ein
/// Durchgang. Lücken des ETB-Wächters stehen im Log, der Lauf läuft weiter.
pub fn start(
    pool: SqlitePool,
    rahmen: Rahmen,
    live: LiveHub,
    zusteller: Zustellwege,
    wecker: Arc<Notify>,
) -> JoinHandle<()> {
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    tokio::spawn(async move {
        match beim_start(&pool, &live).await {
            Ok(0) => {}
            Ok(n) => tracing::warn!(
                anzahl = n,
                "Ausgang: unterbrochene Zustellungen als ungewiss abgeschlossen"
            ),
            Err(e) => {
                tracing::error!("Ausgang: unterbrochene Zustellungen nicht abgeschlossen: {e}")
            }
        }
        let mut ticker = tokio::time::interval(TAKT);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut laufende: Vec<JoinHandle<Vec<Luecke>>> = Vec::new();
        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = wecker.notified() => {}
            }
            let mut offen = Vec::new();
            for h in laufende.drain(..) {
                if h.is_finished() {
                    if let Ok(luecken) = h.await {
                        melde_luecken(&luecken);
                    }
                } else {
                    offen.push(h);
                }
            }
            laufende = offen;
            match takt(
                &pool,
                &rahmen,
                &live,
                &zusteller,
                Utc::now(),
                &laufend,
                &plaetze,
            )
            .await
            {
                Ok(neu) => laufende.extend(neu),
                Err(e) => tracing::error!("Ausgang-Durchgang fehlgeschlagen: {e}"),
            }
        }
    })
}

fn melde_luecken(luecken: &[Luecke]) {
    if !luecken.is_empty() {
        tracing::error!("{}", nachlauf::melde(luecken));
    }
}

/// Beim Start: Versände, die beim Absturz mitten in der Zustellung waren, sind `ungewiss` (ob
/// die Mail hinaus ist, weiß niemand) und werden nicht wiederholt; je einer mit ETB-Eintrag wie
/// jedes Ergebnis. Liefert die Anzahl.
pub async fn beim_start(pool: &SqlitePool, live: &LiveHub) -> Result<u64, AppError> {
    let zeilen = repo::load_unterbrochene(pool).await?;
    let mut n = 0;
    for zeile in zeilen {
        if schliesse_unterbrochen(pool, live, &zeile).await {
            n += 1;
        }
    }
    // Was danach noch offen ist (etwa ein gescheiterter Abschluss), bleibt nicht `wartet`.
    n += repo::recover_unterbrochene(pool).await?;
    Ok(n)
}

/// Ab wann ein begonnener Versuch als hängengeblieben gilt: länger als jede Sitzung dauern
/// kann (Dialog und Datenphase des SMTP-Clients) und zwei Minuten Rand.
pub const HAENGT_NACH: Duration = Duration::from_secs(
    crate::adapter::smtp::SITZUNG_ZEITLIMIT.as_secs()
        + crate::adapter::smtp::DATEN_ZEITLIMIT.as_secs()
        + 120,
);

/// Im laufenden Betrieb: ein Versand, dessen Merker seit [`HAENGT_NACH`] steht und den kein
/// Versuch dieses Laufs mehr hält (der Abschluss scheiterte zweimal, die Zustellung stürzte
/// ab), wird wie nach einem Neustart `ungewiss` abgeschlossen, samt ETB-Eintrag. Sonst stünde
/// er bis zum nächsten Neustart auf „wartet“.
async fn raeume_haengende(
    pool: &SqlitePool,
    live: &LiveHub,
    jetzt: DateTime<Utc>,
    laufend: &Laufend,
) -> Result<(), AppError> {
    let grenze = jetzt - chrono::Duration::from_std(HAENGT_NACH).unwrap_or_default();
    for zeile in repo::load_haengende(pool, grenze).await? {
        if laufend
            .lock()
            .expect("Merker nicht vergiftet")
            .contains(&zeile.id)
        {
            continue;
        }
        if schliesse_unterbrochen(pool, live, &zeile).await {
            tracing::warn!(versand = %zeile.id, "Ausgang: hängengebliebene Zustellung als ungewiss abgeschlossen");
        }
    }
    Ok(())
}

/// Schließt einen unterbrochenen Versuch als `ungewiss` ab (am Spiegel als `spiegel` ohne ETB),
/// mit dem Merker der Zeile als Marke. Liefert, ob das gelang; ein Fehler steht im Log.
async fn schliesse_unterbrochen(pool: &SqlitePool, live: &LiveHub, zeile: &VersandZeile) -> bool {
    let begonnen = zeile.versuch_begonnen_at.as_deref();
    let lauf = async {
        let ergebnis = Ergebnis::Fehlgeschlagen {
            fehler: AusgangFehler::Ungewiss,
            status: None,
        };
        if is_spiegel(pool, zeile.einsatz_id).await? {
            let spiegel = Ergebnis::Fehlgeschlagen {
                fehler: AusgangFehler::Spiegel,
                status: None,
            };
            return abschliessen(pool, live, zeile, begonnen, spiegel, None).await;
        }
        let text = etb_text(zeile, AusgangFehler::Ungewiss, None);
        abschliessen(pool, live, zeile, begonnen, ergebnis, Some(text)).await
    };
    let (ergebnis, luecken) = nachlauf::klammer(pool, lauf).await;
    melde_luecken(&luecken);
    match ergebnis {
        Ok(()) => true,
        Err(e) => {
            tracing::error!(versand = %zeile.id, "Ausgang: unterbrochene Zustellung nicht abgeschlossen: {e}");
            false
        }
    }
}

/// Ein Durchgang zum Zeitpunkt `jetzt`, der auf jede gestartete Zustellung wartet (für Tests).
/// Eine Lücke des ETB-Wächters ist ein Panic.
pub async fn durchgang(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    live: &LiveHub,
    zusteller: &Zustellwege,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let laufend: Laufend = Arc::default();
    let plaetze = Arc::new(Semaphore::new(PARALLEL));
    let mut luecken = Vec::new();
    for handle in takt(pool, rahmen, live, zusteller, jetzt, &laufend, &plaetze).await? {
        if let Ok(l) = handle.await {
            luecken.extend(l);
        }
    }
    if !luecken.is_empty() {
        panic!("{}", nachlauf::melde(&luecken));
    }
    Ok(())
}

/// Stellt genau diese Zeile zu, wie ein Durchgang es täte, aber ohne den Merker der laufenden
/// Versände (für Tests: eine veraltete Kopie, die ein zweiter Durchgang noch in der Hand hat).
/// Eine Lücke des ETB-Wächters ist ein Panic.
pub async fn zustellen_zeile(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    live: &LiveHub,
    zusteller: &Zustellwege,
    zeile: VersandZeile,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let lauf = run_one(pool, rahmen, live, zusteller, zeile, jetzt);
    let (ergebnis, luecken) = nachlauf::klammer(pool, lauf).await;
    if !luecken.is_empty() {
        panic!("{}", nachlauf::melde(&luecken));
    }
    ergebnis
}

async fn takt(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    live: &LiveHub,
    zusteller: &Zustellwege,
    jetzt: DateTime<Utc>,
    laufend: &Laufend,
    plaetze: &Arc<Semaphore>,
) -> Result<Vec<JoinHandle<Vec<Luecke>>>, AppError> {
    if let Err(e) = raeume_haengende(pool, live, jetzt, laufend).await {
        tracing::error!("Ausgang: hängengebliebene Zustellungen nicht geprüft: {e}");
    }
    let faellige = repo::load_faellige(pool, jetzt, JE_DURCHGANG).await?;
    let abzufragen = repo::load_abzufragende(pool, jetzt, JE_DURCHGANG).await?;
    let auftraege = faellige
        .into_iter()
        .map(|z| (z, false))
        .chain(abzufragen.into_iter().map(|z| (z, true)));
    let mut handles = Vec::new();
    for (zeile, abfrage) in auftraege {
        if !laufend
            .lock()
            .expect("Merker nicht vergiftet")
            .insert(zeile.id.clone())
        {
            continue;
        }
        let (pool, rahmen, live) = (pool.clone(), rahmen.clone(), live.clone());
        let (zusteller, laufend, plaetze) = (zusteller.clone(), laufend.clone(), plaetze.clone());
        let gestartet = Instant::now();
        handles.push(tokio::spawn(async move {
            let id = zeile.id.clone();
            let mut luecken = Vec::new();
            if let Ok(_platz) = plaetze.acquire_owned().await {
                let beginn =
                    jetzt + chrono::Duration::from_std(gestartet.elapsed()).unwrap_or_default();
                let lauf = async {
                    if abfrage {
                        abfragen_one(&pool, &rahmen, &live, &zusteller, zeile, beginn).await
                    } else {
                        run_one(&pool, &rahmen, &live, &zusteller, zeile, beginn).await
                    }
                };
                let (ergebnis, l) =
                    nachlauf::klammer(&pool, AssertUnwindSafe(lauf).catch_unwind()).await;
                luecken = l;
                match ergebnis {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => tracing::error!(versand = %id, "Zustellung fehlgeschlagen: {e}"),
                    Err(_) => tracing::error!(versand = %id, "Zustellung abgestürzt"),
                }
            }
            laufend.lock().expect("Merker nicht vergiftet").remove(&id);
            luecken
        }));
    }
    Ok(handles)
}

/// Ob der Einsatz inzwischen von einer anderen Instanz geführt wird (ADR-0018).
pub(crate) async fn is_spiegel(pool: &SqlitePool, einsatz_id: i64) -> Result<bool, AppError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM einsatz_spiegel WHERE einsatz_id = ?)")
            .bind(einsatz_id)
            .fetch_one(pool)
            .await?,
    )
}

/// Ob die Quelle noch gesendet werden darf (Spec Abschnitt 3, „Quelle im richtigen Zustand“):
/// Lagebericht und Befehl als jüngste Freigabe ihrer Kette, die Nachforderung weder
/// zurückgezogen noch abgelehnt. Eine verschwundene Quelle ist überholt.
pub(crate) async fn is_quelle_aktuell(
    pool: &SqlitePool,
    zeile: &VersandZeile,
) -> Result<bool, AppError> {
    use crate::vorlagendokument::repo::is_juengste_freigabe;
    let mut conn = pool.acquire().await?;
    let aktuell = match zeile.quelle_art {
        QuelleArt::Lagebericht => {
            is_juengste_freigabe::<crate::lagebericht::Lagebericht>(
                &mut conn,
                zeile.einsatz_id,
                zeile.quelle_id,
            )
            .await
        }
        QuelleArt::Befehl => {
            is_juengste_freigabe::<crate::befehl::Befehl>(
                &mut conn,
                zeile.einsatz_id,
                zeile.quelle_id,
            )
            .await
        }
        QuelleArt::Nachforderung => {
            use crate::nachforderung::NachforderungStatus;
            crate::nachforderung::repo::load(&mut *conn, zeile.quelle_id)
                .await
                .map(|n| {
                    n.einsatz_id == zeile.einsatz_id
                        && !matches!(
                            n.status,
                            NachforderungStatus::Zurueckgezogen | NachforderungStatus::Abgelehnt
                        )
                })
        }
    };
    match aktuell {
        Ok(a) => Ok(a),
        Err(AppError::NotFound) => Ok(false),
        Err(e) => Err(e),
    }
}

async fn load_anhaenge(
    pool: &SqlitePool,
    zeile: &VersandZeile,
) -> Result<Vec<(String, Vec<u8>)>, AnhangFehler> {
    nachricht::load_anhaenge_quelle(pool, zeile.quelle_art, zeile.einsatz_id, zeile.quelle_id).await
}

/// Die Domain der Absenderadresse für die Message-ID (Spec Abschnitt 4). Ohne konfigurierten
/// öffentlichen Hostnamen der Instanz ist sie der Name, unter dem die Mail ohnehin hinausgeht.
fn message_id(zeile: &VersandZeile, von: &str) -> String {
    let host = von
        .rsplit_once('@')
        .map(|(_, d)| d)
        .filter(|d| !d.is_empty())
        .unwrap_or(crate::adapter::smtp::EHLO_VORGABE);
    format!("<ausgang-{}@{host}>", zeile.id)
}

/// Stellt einen Versand zu und schreibt sein Ergebnis.
async fn run_one(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    live: &LiveHub,
    zusteller: &Zustellwege,
    zeile: VersandZeile,
    beginn: DateTime<Utc>,
) -> Result<(), AppError> {
    let gestartet = Instant::now();
    let jetzt = || beginn + chrono::Duration::from_std(gestartet.elapsed()).unwrap_or_default();
    let fehlgeschlagen = |fehler| Ergebnis::Fehlgeschlagen {
        fehler,
        status: None,
    };

    // Ein Spiegel nimmt kein ETB an: sichtbar fehlgeschlagen, ohne Eintrag.
    if is_spiegel(pool, zeile.einsatz_id).await? {
        let e = fehlgeschlagen(AusgangFehler::Spiegel);
        return abschliessen(pool, live, &zeile, None, e, None).await;
    }
    // Im Wiederholungsfenster geht keine überholte Fassung hinaus.
    if !is_quelle_aktuell(pool, &zeile).await? {
        let text = etb_text(&zeile, AusgangFehler::Ueberholt, None);
        let e = fehlgeschlagen(AusgangFehler::Ueberholt);
        return abschliessen(pool, live, &zeile, None, e, Some(text)).await;
    }
    let zugang =
        match crate::adapter::lauf::zugang_fuer_versand(pool, rahmen, zeile.org_id, zeile.kanal)
            .await?
        {
            Ok(z) => z,
            Err(f) => {
                let text = etb_text(&zeile, f, None);
                return abschliessen(pool, live, &zeile, None, fehlgeschlagen(f), Some(text)).await;
            }
        };
    let fax = zeile.kanal == KanalArt::Fax;
    // Eine Mail braucht eine gültige Absenderadresse, ein Fax eine Faxline. Gespeichert ist die
    // Adresse nur getrimmt (Task 5); hinaus geht sie normalisiert.
    let von = if fax {
        String::new()
    } else {
        match zugang
            .absender()
            .and_then(|a| crate::externe_stelle::kanal::normalize_email(a).ok())
        {
            Some(v) => v,
            None => {
                let f = AusgangFehler::AnbindungFehler;
                let text = etb_text(&zeile, f, None);
                return abschliessen(pool, live, &zeile, None, fehlgeschlagen(f), Some(text)).await;
            }
        }
    };
    let faxline = zugang
        .einstellung("faxline_id")
        .map(str::to_string)
        .filter(|f| crate::adapter::sipgate_fax_art::is_faxline_id(f));
    if fax && faxline.is_none() {
        let f = AusgangFehler::AnbindungFehler;
        let text = etb_text(&zeile, f, None);
        return abschliessen(pool, live, &zeile, None, fehlgeschlagen(f), Some(text)).await;
    }

    let begonnen = jetzt();
    // Beanspruchen: eine veraltete Kopie (zweiter Durchgang, schon abgeschlossen) endet hier,
    // ohne zuzustellen und ohne zweiten ETB-Eintrag.
    if !repo::mark_begonnen(pool, &zeile.id, begonnen).await? {
        tracing::warn!(versand = %zeile.id, "Ausgang: Versand schon in Arbeit oder abgeschlossen");
        return Ok(());
    }
    let marke = zeit::formatiere_utc(begonnen);
    let versuche = zeile.versuche + 1;
    let erster = zeile
        .erster_versuch_at
        .as_deref()
        .and_then(zeit::parse_utc)
        .unwrap_or(begonnen);
    // Ab hier ist der Merker gesetzt: jeder Ausgang schreibt ein Ergebnis, das ihn leert.
    let vorher_gescheitert = |t: DateTime<Utc>| match naechster_versuch(erster, versuche, t) {
        Some(naechster) => (
            Ergebnis::Wiederholen {
                naechster,
                fehler: AusgangFehler::Voruebergehend,
                status: None,
            },
            None,
        ),
        None => (
            fehlgeschlagen(AusgangFehler::Voruebergehend),
            Some(etb_text(&zeile, AusgangFehler::Voruebergehend, None)),
        ),
    };

    let anhaenge = match load_anhaenge(pool, &zeile).await {
        Ok(a) => a,
        Err(AnhangFehler::ZuGross) => {
            let f = AusgangFehler::ZuGross;
            let text = etb_text(&zeile, f, None);
            return abschliessen(
                pool,
                live,
                &zeile,
                Some(&marke),
                fehlgeschlagen(f),
                Some(text),
            )
            .await;
        }
        Err(AnhangFehler::App(e)) => {
            tracing::error!(versand = %zeile.id, "Ausgang: Anhänge nicht lesbar: {e}");
            let (e, text) = vorher_gescheitert(jetzt());
            return abschliessen(pool, live, &zeile, Some(&marke), e, text).await;
        }
    };
    // Das PDF (Spec Abschnitt 6): für das Fax Pflicht, für die Mail ein Anhang, wenn es entsteht.
    let kennung = if fax {
        zugang.einstellung("absender_kennung")
    } else {
        None
    };
    let kopf = match nachricht::pdf_kopf_laden(
        pool,
        zeile.einsatz_id,
        zeile.quelle_art,
        zeile.quelle_id,
        kennung,
    )
    .await
    {
        Ok(k) => Some(k),
        Err(e) => {
            tracing::error!(versand = %zeile.id, "Ausgang: Kopf des PDFs nicht lesbar: {e}");
            if fax {
                let (e, text) = vorher_gescheitert(jetzt());
                return abschliessen(pool, live, &zeile, Some(&marke), e, text).await;
            }
            None
        }
    };
    let an = nachricht::an_text(zeile.kanal, &zeile.stelle_bezeichnung, &zeile.adresse);
    let pdf = kopf.as_ref().and_then(|k| {
        nachricht::baue_pdf_fuer(k, &an, &zeile.betreff, &zeile.inhalt, &anhaenge, jetzt())
            .map_err(|e| tracing::warn!(versand = %zeile.id, "Ausgang: PDF nicht erzeugbar: {e:?}"))
            .ok()
    });
    let dateiname = super::pdf::dateiname(zeile.quelle_art, kopf.as_ref().and_then(|k| k.version));

    if let Some(faxline) = faxline.filter(|_| fax) {
        let Some(pdf) = pdf.filter(super::pdf::passt_fuer_fax) else {
            let f = AusgangFehler::ZuGross;
            let text = etb_text(&zeile, f, None);
            return abschliessen(
                pool,
                live,
                &zeile,
                Some(&marke),
                fehlgeschlagen(f),
                Some(text),
            )
            .await;
        };
        drop(anhaenge);
        let auftrag = FaxAuftrag {
            faxline_id: &faxline,
            empfaenger: &zeile.adresse,
            dateiname: &dateiname,
            pdf: &pdf.bytes,
        };
        // Das Netz, ohne Datenbankverbindung.
        let antwort = zusteller.fax.senden(&zugang, &auftrag).await;
        let t = jetzt();
        // Das ETB bekommt ein Fax erst beim Endstand (zugestellt oder nicht), Spec Abschnitt 5.
        let (ergebnis, text) = match &antwort {
            Ok(session) => (
                Ergebnis::Uebergeben {
                    at: t,
                    anbieter_ref: Some(session.clone()),
                    ohne_pdf: false,
                },
                None,
            ),
            Err(e) => nach_fax_fehler(&zeile, *e, erster, versuche, t),
        };
        abschliessen(pool, live, &zeile, Some(&marke), ergebnis, text).await?;
        if let Err(SipgateFehler::Status(401 | 403)) = antwort {
            pruefung_vorziehen(pool, &zugang.adapter_id, t).await;
        }
        return Ok(());
    }

    // Die Mail: das PDF als erster Anhang, solange alle Anhänge zusammen in die Grenze passen.
    let png_summe: usize = anhaenge.iter().map(|(_, b)| b.len()).sum();
    let pdf = pdf.filter(|p| png_summe + p.bytes.len() <= nachricht::ANHANG_MAX_BYTES);
    let ohne_pdf = pdf.is_none();
    if ohne_pdf {
        tracing::warn!(versand = %zeile.id, "Ausgang: Mail geht ohne PDF hinaus");
    }
    let schnappschuss = Schnappschuss {
        betreff: zeile.betreff.clone(),
        inhalt: zeile.inhalt.clone(),
    };
    let mail = match nachricht::baue_mail(
        &von,
        zugang.absender_name(),
        &zeile.adresse,
        &message_id(&zeile, &von),
        &schnappschuss,
        pdf.as_ref()
            .map(|p| (dateiname.as_str(), p.bytes.as_slice())),
        &anhaenge,
    ) {
        Ok(m) => m,
        Err(f) => {
            let text = etb_text(&zeile, f, None);
            return abschliessen(
                pool,
                live,
                &zeile,
                Some(&marke),
                fehlgeschlagen(f),
                Some(text),
            )
            .await;
        }
    };
    drop(anhaenge);
    drop(pdf);

    // Das Netz, ohne Datenbankverbindung.
    let antwort = zusteller
        .mail
        .zustellen(&zugang, &von, &zeile.adresse, &mail)
        .await;
    let t = jetzt();
    let (ergebnis, text) = match antwort {
        Ok(()) => (
            Ergebnis::Uebergeben {
                at: t,
                anbieter_ref: None,
                ohne_pdf,
            },
            Some(etb_text_uebergeben(&zeile)),
        ),
        Err(e) => nach_fehler(&zeile, e, erster, versuche, t),
    };
    abschliessen(pool, live, &zeile, Some(&marke), ergebnis, text).await?;
    // Anmeldung oder TLS brauchen einen Eingriff: der Lauf der Anbindung soll es gleich selbst
    // feststellen und melden (ADR-0086); der Versand ändert ihren Zustand nie.
    if let Err(SmtpFehler::Anmeldung | SmtpFehler::Tls) = antwort {
        pruefung_vorziehen(pool, &zugang.adapter_id, t).await;
    }
    Ok(())
}

/// Fragt den Stand eines übergebenen Faxes beim Anbieter ab (Spec Abschnitt 5): `SENT` →
/// `zugestellt`, `FAILED` → `fehlgeschlagen` mit `nicht_zugestellt`, sonst später wieder, bis
/// zur Frist von 2 h nach der Übergabe (dann `ungewiss`). Ein Endstand steht im ETB. Kein
/// Netz mit gehaltener Datenbankverbindung.
async fn abfragen_one(
    pool: &SqlitePool,
    rahmen: &Rahmen,
    live: &LiveHub,
    zusteller: &Zustellwege,
    zeile: VersandZeile,
    jetzt: DateTime<Utc>,
) -> Result<(), AppError> {
    let Some(session) = zeile.anbieter_ref.clone() else {
        return Ok(());
    };
    let uebergeben = zeile
        .uebergeben_at
        .as_deref()
        .and_then(zeit::parse_utc)
        .unwrap_or(jetzt);
    let antwort =
        match crate::adapter::lauf::zugang_fuer_versand(pool, rahmen, zeile.org_id, KanalArt::Fax)
            .await?
        {
            Ok(zugang) => {
                let a = zusteller.fax.status(&zugang, &session).await;
                if let Err(SipgateFehler::Status(401 | 403)) = a {
                    pruefung_vorziehen(pool, &zugang.adapter_id, jetzt).await;
                }
                a.ok()
            }
            // Ohne nutzbaren Zugang wird weiter gewartet; die Frist entscheidet.
            Err(_) => None,
        };
    let ziel = ziel_text(&zeile);
    let (abfrage, etb) = match antwort {
        Some(FaxStatus::Gesendet) => (
            Abfrage::Zugestellt { at: jetzt },
            Some(format!("{ziel} zugestellt")),
        ),
        Some(FaxStatus::Gescheitert) => (
            Abfrage::NichtZugestellt,
            Some(etb_text_fax(&zeile, AusgangFehler::NichtZugestellt, None)),
        ),
        Some(FaxStatus::Laeuft) | None => match naechste_abfrage(uebergeben, jetzt) {
            Some(naechste) => (Abfrage::Weiter { naechste }, None),
            None => (
                Abfrage::Ungewiss,
                Some(format!("{ziel}: Zustellung nicht bestätigt")),
            ),
        },
    };
    abschliessen_mit(pool, live, &zeile, Abschluss::Abfrage(abfrage), etb).await
}

/// Zieht die nächste Prüfung einer Anbindung auf jetzt vor (ADR-0086).
async fn pruefung_vorziehen(pool: &SqlitePool, adapter_id: &str, t: DateTime<Utc>) {
    if let Err(e) = crate::adapter::repo::postpone(pool, adapter_id, &zeit::formatiere_utc(t)).await
    {
        tracing::error!(adapter = %adapter_id, "Prüfung der Anbindung nicht vorgezogen: {e}");
    }
}

/// Ordnet einen Fehler beim Übergeben eines Faxes zu (Spec Abschnitt 4): vorübergehend wird im
/// Fenster wiederholt (ohne ETB), alles andere ist endgültig und steht im ETB. Ein Abbruch nach
/// dem Senden (`Ungewiss`) wird nie selbst wiederholt.
fn nach_fax_fehler(
    zeile: &VersandZeile,
    e: SipgateFehler,
    erster: DateTime<Utc>,
    versuche: i64,
    jetzt: DateTime<Utc>,
) -> (Ergebnis, Option<String>) {
    let status = e.status();
    let endgueltig = |fehler| {
        (
            Ergebnis::Fehlgeschlagen { fehler, status },
            Some(etb_text_fax(zeile, fehler, Some(e))),
        )
    };
    let voruebergehend = || match naechster_versuch(erster, versuche, jetzt) {
        Some(naechster) => (
            Ergebnis::Wiederholen {
                naechster,
                fehler: AusgangFehler::Voruebergehend,
                status,
            },
            None,
        ),
        None => endgueltig(AusgangFehler::Voruebergehend),
    };
    match e {
        SipgateFehler::Status(401 | 402 | 403) => endgueltig(AusgangFehler::AnbindungFehler),
        SipgateFehler::Status(429 | 500..=599) | SipgateFehler::Verbindung | SipgateFehler::Dns => {
            voruebergehend()
        }
        SipgateFehler::Status(_) => endgueltig(AusgangFehler::Abgelehnt),
        SipgateFehler::Ungewiss => endgueltig(AusgangFehler::Ungewiss),
        SipgateFehler::Tls
        | SipgateFehler::ZielIntern
        | SipgateFehler::Antwort
        | SipgateFehler::FaxlineUnbekannt => endgueltig(AusgangFehler::AnbindungFehler),
    }
}

/// Ordnet einen Fehler der Zustellung zu: vorübergehend wird im Fenster wiederholt (ohne ETB),
/// alles andere ist endgültig und steht im ETB.
fn nach_fehler(
    zeile: &VersandZeile,
    e: SmtpFehler,
    erster: DateTime<Utc>,
    versuche: i64,
    jetzt: DateTime<Utc>,
) -> (Ergebnis, Option<String>) {
    let status = e.status();
    let endgueltig = |fehler| {
        (
            Ergebnis::Fehlgeschlagen { fehler, status },
            Some(etb_text(zeile, fehler, Some(e))),
        )
    };
    match e {
        SmtpFehler::Voruebergehend(_)
        | SmtpFehler::Verbindung
        | SmtpFehler::Zeitueberschreitung
        | SmtpFehler::Dns => match naechster_versuch(erster, versuche, jetzt) {
            Some(naechster) => (
                Ergebnis::Wiederholen {
                    naechster,
                    fehler: AusgangFehler::Voruebergehend,
                    status,
                },
                None,
            ),
            None => endgueltig(AusgangFehler::Voruebergehend),
        },
        SmtpFehler::Abgelehnt(_) => endgueltig(AusgangFehler::Abgelehnt),
        SmtpFehler::Ungewiss => endgueltig(AusgangFehler::Ungewiss),
        SmtpFehler::Anmeldung | SmtpFehler::Tls | SmtpFehler::ZielIntern | SmtpFehler::Antwort => {
            endgueltig(AusgangFehler::AnbindungFehler)
        }
    }
}

/// Kurzname der Quelle für das ETB, aus dem Betreff des Schnappschusses („Lagebericht Nr. 3“,
/// „Einsatzbefehl Nr. 2“, „Nachforderung 2× RTW“).
fn quelle_text(zeile: &VersandZeile) -> String {
    let kopf = zeile
        .betreff
        .split_once(" – ")
        .map_or(zeile.betreff.as_str(), |(k, _)| k);
    match kopf.strip_prefix("Nachforderung: ") {
        Some(rest) => format!("Nachforderung {rest}"),
        None => kopf.to_string(),
    }
}

fn ziel_text(zeile: &VersandZeile) -> String {
    let weg = match zeile.kanal {
        KanalArt::Fax => "Fax",
        _ => "E-Mail",
    };
    format!(
        "{} per {weg} an {} ({})",
        quelle_text(zeile),
        zeile.stelle_bezeichnung,
        zeile.adresse
    )
}

fn etb_text_uebergeben(zeile: &VersandZeile) -> String {
    format!("{} übergeben", ziel_text(zeile))
}

/// Der ETB-Text eines endgültigen Fehlschlags (Spec Abschnitt 6). Der Grund ist ein fester,
/// kurzer deutscher Text; nie ein Text des Mailservers.
fn etb_text(zeile: &VersandZeile, fehler: AusgangFehler, smtp: Option<SmtpFehler>) -> String {
    let grund = match zeile.kanal {
        KanalArt::Fax => grund_fax(fehler, None),
        _ => grund(fehler, smtp),
    };
    etb_text_mit(zeile, fehler, &grund)
}

/// Der ETB-Text eines endgültigen Fehlschlags eines Faxes, mit dem Fehler von sipgate.
fn etb_text_fax(zeile: &VersandZeile, fehler: AusgangFehler, fax: Option<SipgateFehler>) -> String {
    etb_text_mit(zeile, fehler, &grund_fax(fehler, fax))
}

fn etb_text_mit(zeile: &VersandZeile, fehler: AusgangFehler, grund: &str) -> String {
    let ziel = ziel_text(zeile);
    match fehler {
        AusgangFehler::Ueberholt => {
            let grund = match zeile.quelle_art {
                QuelleArt::Nachforderung => "zurückgezogen oder abgelehnt",
                QuelleArt::Lagebericht | QuelleArt::Befehl => "neuere Fassung freigegeben",
            };
            format!("{ziel} nicht gesendet: {grund}")
        }
        AusgangFehler::ZuGross if zeile.kanal == KanalArt::Fax => format!(
            "{ziel} nicht gesendet: Fax zu lang oder nicht erzeugbar (höchstens {} Seiten)",
            super::pdf::FAX_SEITEN_MAX
        ),
        AusgangFehler::ZuGross => format!("{ziel} nicht gesendet: Anhänge zu groß"),
        AusgangFehler::Ungewiss => {
            format!("{ziel}: Zustellung unklar, Verbindung nach dem Senden abgebrochen")
        }
        _ => format!("{ziel} nicht zugestellt: {grund}"),
    }
}

/// Der Grund eines Fehlschlags beim Fax: fester, kurzer deutscher Text, nie ein Text von sipgate.
fn grund_fax(fehler: AusgangFehler, fax: Option<SipgateFehler>) -> String {
    match (fehler, fax) {
        (AusgangFehler::Voruebergehend, Some(SipgateFehler::Status(c))) => {
            format!("sipgate nimmt vorübergehend nicht an (HTTP {c})")
        }
        (AusgangFehler::Voruebergehend, Some(SipgateFehler::Dns)) => {
            "sipgate nicht gefunden".into()
        }
        (AusgangFehler::Voruebergehend, _) => "sipgate nicht erreichbar".into(),
        (AusgangFehler::Abgelehnt, Some(SipgateFehler::Status(407))) => {
            "Faxnummer von sipgate abgelehnt".into()
        }
        (AusgangFehler::Abgelehnt, Some(SipgateFehler::Status(c))) => {
            format!("von sipgate abgelehnt (HTTP {c})")
        }
        (AusgangFehler::Abgelehnt, _) => "von sipgate abgelehnt".into(),
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::Status(402))) => {
            "Guthaben bei sipgate aufgebraucht".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::Status(401 | 403))) => {
            "Anmeldung bei sipgate abgelehnt".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::Tls)) => {
            "verschlüsselte Verbindung zu sipgate gescheitert".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::ZielIntern)) => {
            "Adresse von sipgate nicht erlaubt".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::Antwort)) => {
            "Antwort von sipgate unlesbar".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SipgateFehler::FaxlineUnbekannt)) => {
            "Faxline bei sipgate unbekannt".into()
        }
        (AusgangFehler::AnbindungFehler, _) => "Faxzugang nicht nutzbar".into(),
        (AusgangFehler::AnbindungFehlt, _) => "kein Faxzugang eingerichtet".into(),
        (AusgangFehler::AnbindungAngehalten, _) => "Faxzugang angehalten".into(),
        (AusgangFehler::NichtZugestellt, _) => "Gegenstelle nicht erreicht".into(),
        (AusgangFehler::Ungewiss, _) => "Zustellung nicht bestätigt".into(),
        (fehler, _) => grund(fehler, None),
    }
}

fn grund(fehler: AusgangFehler, smtp: Option<SmtpFehler>) -> String {
    match (fehler, smtp) {
        (AusgangFehler::Voruebergehend, Some(SmtpFehler::Voruebergehend(c))) => {
            format!("Mailserver nimmt vorübergehend nicht an (SMTP {c})")
        }
        (AusgangFehler::Voruebergehend, Some(SmtpFehler::Dns)) => {
            "Mailserver nicht gefunden".into()
        }
        (AusgangFehler::Voruebergehend, Some(SmtpFehler::Zeitueberschreitung)) => {
            "Mailserver antwortet nicht".into()
        }
        (AusgangFehler::Voruebergehend, _) => "Mailserver nicht erreichbar".into(),
        (AusgangFehler::Abgelehnt, Some(SmtpFehler::Abgelehnt(c))) => {
            format!("vom Mailserver abgelehnt (SMTP {c})")
        }
        (AusgangFehler::Abgelehnt, _) => "vom Mailserver abgelehnt".into(),
        (AusgangFehler::AnbindungFehler, Some(SmtpFehler::Anmeldung)) => {
            "Anmeldung am Mailserver abgelehnt".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SmtpFehler::Tls)) => {
            "verschlüsselte Verbindung zum Mailserver gescheitert".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SmtpFehler::ZielIntern)) => {
            "Adresse des Mailservers nicht erlaubt".into()
        }
        (AusgangFehler::AnbindungFehler, Some(SmtpFehler::Antwort)) => {
            "Antwort des Mailservers unlesbar".into()
        }
        (AusgangFehler::AnbindungFehler, _) => "Anbindung des Mailservers nicht nutzbar".into(),
        (AusgangFehler::AnbindungFehlt, _) => "kein Mailserver eingerichtet".into(),
        (AusgangFehler::AnbindungAngehalten, _) => "Mailserver angehalten".into(),
        (AusgangFehler::Ungewiss, _) => "Zustellung unklar".into(),
        (AusgangFehler::Ueberholt, _) => "Quelle überholt".into(),
        (AusgangFehler::ZuGross, _) => "Anhänge zu groß".into(),
        (AusgangFehler::Spiegel, _) => "Einsatz wird von einer anderen Instanz geführt".into(),
        (AusgangFehler::NichtZugestellt, _) => "Fax nicht zugestellt".into(),
    }
}

/// Von des ETB-Eintrags: die Funktion der absendenden Person, sonst ihr Name.
async fn von_fuer(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<Option<String>, AppError> {
    if let Some(f) =
        crate::einsatz::funktion::kurz_fuer(&mut *conn, einsatz_id, benutzer_id).await?
    {
        return Ok(Some(f));
    }
    Ok(
        sqlx::query_scalar("SELECT anzeigename FROM benutzer WHERE id = ?")
            .bind(benutzer_id)
            .fetch_optional(&mut *conn)
            .await?,
    )
}

/// Schreibt das Ergebnis und, falls `etb` gesetzt, den ETB-Eintrag in einer Transaktion; nach
/// dem Commit `publiziere` und das Ereignis der Versandliste. `begonnen` ist der Merker, den der
/// Aufrufer hält (`repo::save_ergebnis_tx`): hat ein anderer Lauf den Versand schon
/// abgeschlossen, ändert sich nichts und es entsteht kein ETB-Eintrag. Scheitert die
/// Transaktion mit ETB (etwa weil der Einsatz eben zum Spiegel wurde), steht wenigstens der
/// Zustand: ein Versand bleibt nicht `wartet` mit gesetztem Merker.
async fn abschliessen(
    pool: &SqlitePool,
    live: &LiveHub,
    zeile: &VersandZeile,
    begonnen: Option<&str>,
    ergebnis: Ergebnis,
    etb: Option<String>,
) -> Result<(), AppError> {
    abschliessen_mit(
        pool,
        live,
        zeile,
        Abschluss::Versuch { begonnen, ergebnis },
        etb,
    )
    .await
}

/// Was [`abschliessen_mit`] schreibt: das Ergebnis eines Zustellversuchs oder einer Abfrage.
#[derive(Clone)]
enum Abschluss<'a> {
    Versuch {
        begonnen: Option<&'a str>,
        ergebnis: Ergebnis,
    },
    Abfrage(Abfrage),
}

async fn schreibe_abschluss(
    conn: &mut sqlx::SqliteConnection,
    id: &str,
    a: &Abschluss<'_>,
) -> Result<bool, AppError> {
    match a {
        Abschluss::Versuch { begonnen, ergebnis } => {
            repo::save_ergebnis_tx(conn, id, *begonnen, ergebnis.clone()).await
        }
        Abschluss::Abfrage(abfrage) => repo::save_abfrage_tx(conn, id, *abfrage).await,
    }
}

async fn abschliessen_mit(
    pool: &SqlitePool,
    live: &LiveHub,
    zeile: &VersandZeile,
    abschluss: Abschluss<'_>,
    etb: Option<String>,
) -> Result<(), AppError> {
    // `None`: nichts geändert; `Some(etb_id)`: Ergebnis geschrieben, mit oder ohne ETB.
    let mit_etb = crate::write_retry!(pool, |conn| {
        if !schreibe_abschluss(&mut *conn, &zeile.id, &abschluss).await? {
            return Ok(None);
        }
        let Some(text) = etb.as_deref() else {
            return Ok(Some(None));
        };
        let startwert =
            crate::einsatz::einstellungen::laden_oder_default(&mut *conn, zeile.einsatz_id)
                .await?
                .etb_startwert();
        let von = von_fuer(&mut *conn, zeile.einsatz_id, zeile.erstellt_von_id).await?;
        let etb_id = crate::etb::repo::anlegen_tx(
            &mut *conn,
            zeile.einsatz_id,
            zeile.erstellt_von_id,
            startwert,
            crate::etb::repo::EintragDaten {
                typ: crate::etb::TYP_SYSTEM,
                inhalt: text,
                von: von.as_deref(),
                an: Some(&zeile.stelle_bezeichnung),
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: None,
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        repo::save_etb_eintrag_tx(&mut *conn, &zeile.id, etb_id).await?;
        Ok(Some(Some(etb_id)))
    });
    let etb_id = match mit_etb {
        Ok(Some(id)) => id,
        Ok(None) => {
            tracing::warn!(versand = %zeile.id, "Ausgang: Versand schon abgeschlossen, Ergebnis verworfen");
            return Ok(());
        }
        Err(e) if etb.is_some() => {
            tracing::error!(versand = %zeile.id, "Ausgang: ETB-Eintrag nicht geschrieben: {e}");
            let geaendert = crate::write_retry!(pool, |conn| {
                schreibe_abschluss(&mut *conn, &zeile.id, &abschluss).await
            })?;
            if !geaendert {
                return Ok(());
            }
            None
        }
        Err(e) => return Err(e),
    };
    if let Some(id) = etb_id {
        live.publiziere(zeile.einsatz_id, id);
    }
    live.publiziere_einsatz(zeile.einsatz_id, LiveEvent::Ausgang);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zeile(quelle: QuelleArt, betreff: &str) -> VersandZeile {
        VersandZeile {
            id: "v1".into(),
            org_id: 1,
            einsatz_id: 1,
            client_id: "c".into(),
            quelle_art: quelle,
            quelle_id: 1,
            kanal: crate::externe_stelle::KanalArt::Email,
            externe_stelle_id: None,
            stelle_bezeichnung: "Leitstelle Nord".into(),
            adresse: "lagedienst@ils.example".into(),
            betreff: betreff.into(),
            inhalt: String::new(),
            zustand: super::super::VersandZustand::Wartet,
            versuche: 0,
            naechster_versuch_at: None,
            erster_versuch_at: None,
            versuch_begonnen_at: None,
            fehler_art: None,
            fehler_status: None,
            erstellt_von_id: 1,
            erstellt_at: String::new(),
            uebergeben_at: None,
            etb_eintrag_id: None,
            anbieter_ref: None,
            zugestellt_at: None,
            naechste_abfrage_at: None,
            ohne_pdf: false,
        }
    }

    #[test]
    fn etb_text_nennt_quelle_stelle_und_adresse() {
        let z = zeile(
            QuelleArt::Lagebericht,
            "Lagebericht Nr. 3 – Hochwasser – Stand 021000jun26",
        );
        assert_eq!(
            etb_text_uebergeben(&z),
            "Lagebericht Nr. 3 per E-Mail an Leitstelle Nord (lagedienst@ils.example) übergeben"
        );
        assert_eq!(
            etb_text(
                &z,
                AusgangFehler::AnbindungFehler,
                Some(SmtpFehler::Anmeldung)
            ),
            "Lagebericht Nr. 3 per E-Mail an Leitstelle Nord (lagedienst@ils.example) nicht \
             zugestellt: Anmeldung am Mailserver abgelehnt"
        );
        let n = zeile(
            QuelleArt::Nachforderung,
            "Nachforderung: 2× RTW – Hochwasser",
        );
        assert!(etb_text(&n, AusgangFehler::Ueberholt, None)
            .starts_with("Nachforderung 2× RTW per E-Mail an Leitstelle Nord"));
    }

    #[test]
    fn fehlerzuordnung_folgt_der_spec() {
        let z = zeile(QuelleArt::Befehl, "Einsatzbefehl Nr. 1 – X");
        let t0 = Utc::now();
        for e in [
            SmtpFehler::Voruebergehend(450),
            SmtpFehler::Verbindung,
            SmtpFehler::Zeitueberschreitung,
            SmtpFehler::Dns,
        ] {
            let (ergebnis, text) = nach_fehler(&z, e, t0, 1, t0);
            assert!(matches!(ergebnis, Ergebnis::Wiederholen { .. }), "{e:?}");
            assert!(text.is_none());
            let spaet = t0 + chrono::Duration::minutes(31);
            let (ergebnis, text) = nach_fehler(&z, e, t0, 2, spaet);
            assert!(
                matches!(
                    ergebnis,
                    Ergebnis::Fehlgeschlagen {
                        fehler: AusgangFehler::Voruebergehend,
                        ..
                    }
                ),
                "{e:?}"
            );
            assert!(text.is_some());
        }
        let fall = |e| match nach_fehler(&z, e, t0, 1, t0).0 {
            Ergebnis::Fehlgeschlagen { fehler, .. } => fehler,
            other => panic!("{other:?}"),
        };
        assert_eq!(fall(SmtpFehler::Abgelehnt(550)), AusgangFehler::Abgelehnt);
        assert_eq!(fall(SmtpFehler::Ungewiss), AusgangFehler::Ungewiss);
        for e in [
            SmtpFehler::Anmeldung,
            SmtpFehler::Tls,
            SmtpFehler::ZielIntern,
            SmtpFehler::Antwort,
        ] {
            assert_eq!(fall(e), AusgangFehler::AnbindungFehler, "{e:?}");
        }
    }

    #[test]
    fn versandzugang_debug_nennt_kein_geheimnis() {
        let mut geheimnisse = std::collections::HashMap::new();
        geheimnisse.insert(
            "passwort".to_string(),
            age::secrecy::SecretString::from("streng-geheim".to_string()),
        );
        let z = Versandzugang {
            einstellungen: serde_json::Map::new(),
            geheimnisse,
            lan_erlaubt: false,
            adapter_id: "a1".into(),
        };
        let text = format!("{z:?}");
        assert!(!text.contains("streng-geheim"), "{text}");
        assert!(text.contains("passwort"), "{text}");
    }
}

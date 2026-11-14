//! Aufbewahrungs-Purge-Scheduler (LFH-135) — gespiegeltes Muster von
//! `erinnerung::scheduler`: ein dünner Tokio-`interval`-Task ruft periodisch
//! `tick_einmal`; die Logik selbst ist mit injiziertem `jetzt` deterministisch
//! testbar. Idempotent über WHERE-Guards in den Repo-Queries.
//!
//! Phasen in dieser Reihenfolge:
//! - **Phase N** (IRREVERSIBEL für den Klartext, LLH-1494): am Ende der Nachbereitung legt die
//!   verwahrende Instanz einen Einsatz als age-verschlüsselte Blöcke ab und schwärzt ihn ohne
//!   Karenz (`archiv::archivieren`), wenn die Org geprüfte Archiv-Schlüssel hat. Blöcke, deren
//!   Frist abgelaufen ist, löscht dieselbe Phase (`archiv::abgelaufene_bloecke_loeschen`).
//! - **Phase A** (reversibel): Einsätze mit abgelaufener Aufbewahrungsfrist werden
//!   soft-gelöscht (`geloescht_at` = Karenz-Start: Fristablauf bzw. Setzen einer Frist in die
//!   Vergangenheit, höchstens jetzt; LFH-906). Ab da am Datenzugriff
//!   gesperrt (`darf_lesen`).
//! - **Phase A2** (IRREVERSIBEL, LFH-751): fällige Schwärzungsanträge (Löschersuchen nach
//!   Art. 17) werden vollzogen (`aufbewahrung::antrag::vollziehe_faellige`).
//! - **Phasen K1/K2** (LFH-749): dasselbe je Datenkategorie — Vormerkung nach Ablauf der
//!   Kategorie-Frist (`vorgemerkt_at` = Karenz-Start wie in Phase A, LFH-1049), Schwärzung nur
//!   ihrer Daten nach der Karenz. Der Einsatz bleibt lesbar.
//! - **Phase B** (IRREVERSIBEL): nach Ablauf der Karenz (`KARENZ_TAGE`) werden die
//!   Personendaten gescrubbt (`repo::schwaerze_einsatz`), das operative Skelett
//!   (Einsatz, ETB, Zähler) bleibt erhalten. `geschwaerzt_at`-Tombstone = Idempotenz.
//! - **Nachlauf** (LFH-905, LFH-997): Anhänge und Bilder der Lagekarte geschwärzter Einsätze und
//!   Kategorien löscht jede Schwärzung nach ihrem Commit einzeln, je Zeile eine Transaktion
//!   (`schwaerzung_nachlauf::entferne_vorgesehene`); der Tick holt Reste nach.
//! - **Phase C**: abgelaufene Einträge des Auth-Audits und der Admin-Spur (LFH-1005), je mit
//!   eigener Frist, an keinem Einsatz. Ebenso die Ausgangsereignisse für Fremdsysteme nach sieben
//!   Tagen (`public_api::events::purge`, LLH-1655).
//! - **Phase C2** (LFH-928): abgelaufene Sitzungen (`auth::session::purge_abgelaufene`), aus
//!   demselben Grund wie Phase C.
//! - **Phase C3** (LLH-1585): Planungen 90 Tage nach dem Ende ihres Zeitraums
//!   (`planung::repo::purge_abgelaufene`), samt Posten, Blöcken und Helfern.
//! - **Phase D** (UNUMKEHRBAR, LFH-750): ein geschwärzter Einsatz, dessen Skelett-Frist der Org
//!   abgelaufen ist, wird samt ETB endgültig gelöscht (`skelett_loeschung::loeschen`); seine
//!   einzige Spur ist das Löschprotokoll der Org, bei einem Einsatz mit Kennung dazu ihr
//!   Löschvermerk (LLH-1699). Ohne Org-Frist bleibt das Skelett.
//! - **Phase R** (UNUMKEHRBAR, LLH-1494): Abräumen nach Verwahrung und Lebensende
//!   (`abraeumen::phase_r`): vorgemerkte Einsätze und Spiegel der meldenden Seite nach der
//!   Nachbereitung, und eingespielte Archive nach 7 Tagen (`archiv::einspielen`, samt ihren
//!   Platzhalter-Konten); Spur im Löschprotokoll (Art `verwahrt` bzw. `spiegel`).
//! - **Phase E** (LFH-250, LFH-928): verwaiste Anhänge jenseits ihrer Karenz, einzeln je
//!   Transaktion (`anhang::repo::sweep_verwaiste`). Hängt an keiner Aufbewahrungsfrist.
//!
//! DATENVERLUST-kritisch: jede Mutation wird zuvor mit `tracing` protokolliert. Phase A und B
//! begleitet ein ETB-System-Audit; Phase D schreibt ihren Audit in derselben Transaktion ins
//! `aufbewahrung_loeschprotokoll` (das ETB geht mit); Phasen C und C2 betreffen keinen Einsatz,
//! Phase E nur Uploads, die nie an etwas gebunden wurden. Aktive Einsätze sind durch
//! `status='abgeschlossen'` in jeder Einsatz-Purge-Query hart ausgeschlossen.

use super::aufbewahrung_kategorie as kategorie;
use super::repo;
use super::retention::{karenz_abgelaufen, KARENZ_TAGE};
use super::skelett_loeschung;
use crate::live::{LiveEvent, LiveHub};
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::time::Duration;

/// Pollintervall des Purge-Schedulers (10 Minuten — Aufbewahrung ist tagesgenau,
/// kein Sekunden-Druck wie bei Erinnerungen).
const TICK_SEKUNDEN: u64 = 600;

/// Ein Purge-Durchlauf für den Zeitpunkt `jetzt`. Führt die Phasen aus dem Modulkopf aus, von
/// Phase A (Soft-Delete) bis Phase E (verwaiste Anhänge), und liefert die Gesamtzahl der
/// Mutationen.
/// Async + injiziertes `jetzt` = deterministisch testbar. Idempotent: ein zweiter
/// Tick ohne neue Fälligkeiten liefert 0.
///
/// Ohne Gedächtnis für einen ausstehenden WAL-Rückschrieb; der laufende Scheduler nimmt
/// [`tick_mit_rueckschrieb`].
///
/// Ein Soft-Delete meldet Kopf und Liste (LFH-734, LFH-996): er verschwindet aus der Liste seiner
/// Leser, und offene Tabs räumen am 404. Die Schwärzung (Phase B) trifft nur schon gesperrte
/// Einsätze und meldet nichts.
pub async fn tick_einmal(pool: &SqlitePool, live: &LiveHub, jetzt: DateTime<Utc>) -> usize {
    tick_mit_rueckschrieb(pool, live, jetzt, &mut false).await
}

/// Wie [`tick_einmal`], schreibt nach einer Schwärzung, einer endgültigen Löschung (LFH-750)
/// oder einem Sweep mit Löschungen (LFH-928) aber den WAL zurück (LFH-725, Spec
/// `aufbewahrung`, „Physische Entfernung geschwärzter Werte“): erst damit sind die genullten
/// Seiten in der Hauptdatei und der Vorzustand aus dem WAL getilgt. Blockiert eine andere
/// Verbindung den Rückschrieb, bleibt `rueckschrieb_ausstehend` gesetzt, und jeder folgende Tick
/// versucht es erneut, bis es gelingt.
pub async fn tick_mit_rueckschrieb(
    pool: &SqlitePool,
    live: &LiveHub,
    jetzt: DateTime<Utc>,
    rueckschrieb_ausstehend: &mut bool,
) -> usize {
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let mut anzahl = 0;
    let mut geschwaerzt = 0;
    let mut geloescht = 0;

    // --- Phase N: Archiv am Ende der Nachbereitung (LLH-1494, IRREVERSIBEL für den Klartext) ---
    // Vor Phase A: ein archivierter Einsatz ist danach vorgemerkt und geschwärzt, Phase A und B
    // übergehen ihn. Zählt für den WAL-Rückschrieb wie Phase B.
    match super::archiv::faellige(pool, &jetzt_s).await {
        Ok(ids) => {
            for id in ids {
                match super::archiv::archivieren(pool, id, jetzt).await {
                    Ok(true) => {
                        anzahl += 1;
                        geschwaerzt += 1;
                        // Gesperrt und geschwärzt: offene Tabs und Geräte erfahren es über den
                        // Kopf wie nach Phase A (src/AGENTS.md).
                        crate::live::org::kopf_melden(pool, live, id, &[]).await;
                    }
                    Ok(false) => {}
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase N fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase N: Abfrage fehlgeschlagen: {e}"),
    }
    match super::archiv::abgelaufene_bloecke_loeschen(pool, &jetzt_s).await {
        Ok(0) => {}
        Ok(n) => {
            anzahl += n;
            geloescht += n;
        }
        Err(e) => {
            tracing::warn!("Purge Phase N: Löschen abgelaufener Blöcke fehlgeschlagen: {e}");
            // Jeder Block löscht in eigener Transaktion: frühere können schon weg sein.
            *rueckschrieb_ausstehend = true;
        }
    }

    // --- Phase A: Soft-Delete fälliger Einsätze (reversibel, Karenz-Start ab Fristablauf) ---
    match repo::faellige_soft_delete(pool, &jetzt_s).await {
        Ok(ids) => {
            for id in ids {
                // Gemeldet wird erst der Erfolg (LFH-756): ein fail-closed gescheiterter Versuch
                // stünde sonst bei jeder Blockade alle 10 min als Erfolg neben dem `error!`.
                match repo::soft_delete_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => {
                        tracing::info!(
                            einsatz_id = id,
                            "Purge Phase A: Soft-Delete (Aufbewahrungsfrist abgelaufen)"
                        );
                        anzahl += 1;
                        // Kopf und Liste (LFH-996): ein offener Tab ruft den Kopf ab und räumt am
                        // 404, ein Gerät auf der Einsatzauswahl sieht ihn verschwinden.
                        crate::live::org::kopf_melden(pool, live, id, &[]).await;
                    }
                    Ok(false) => {} // Race: bereits soft-gelöscht.
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase A fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase A: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase A2: fällige Schwärzungsanträge (Art. 17, LFH-751, IRREVERSIBEL) ---
    // Vor Phase B, damit ein Einsatz-Antrag mit seinem Aktenzeichen im Audit schwärzt, wenn
    // im selben Lauf auch die Karenz abliefe. Ein Vollzug zählt für den WAL-Rückschrieb.
    let vollzogen = crate::aufbewahrung::antrag::vollziehe_faellige(pool, live, jetzt).await;
    anzahl += vollzogen;
    geschwaerzt += vollzogen;

    // --- Phase K1: Vormerkung fälliger Datenkategorien (LFH-749, reversibel, Karenz-Start ab
    // Fristablauf wie Phase A, LFH-1049) ---
    // Auch an einem gesperrten Einsatz: eine Kategorie bleibt nicht liegen, nur weil der Einsatz
    // vorgemerkt wurde (Spec `aufbewahrung-kategorien`, „Zusammenspiel mit der Einsatz-Frist“).
    match kategorie::faellige_vormerkung(pool, &jetzt_s).await {
        Ok(faellig) => {
            for (id, k) in faellig {
                tracing::info!(
                    einsatz_id = id,
                    kategorie = k.as_str(),
                    "Purge Phase K1: Datenkategorie vorgemerkt (Frist abgelaufen)"
                );
                match kategorie::vormerken(pool, id, k, &jetzt_s).await {
                    Ok(true) => {
                        anzahl += 1;
                        live.publiziere_einsatz(id, LiveEvent::Etb);
                    }
                    Ok(false) => {}
                    Err(e) => tracing::error!(
                        einsatz_id = id,
                        kategorie = k.as_str(),
                        "Purge Phase K1 fehlgeschlagen: {e}"
                    ),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase K1: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase K2: Schwärzung einer Datenkategorie nach ihrer Karenz (IRREVERSIBEL) ---
    match kategorie::faellige_schwaerzung(pool).await {
        Ok(kandidaten) => {
            for (id, k, vorgemerkt_at) in kandidaten {
                if !karenz_abgelaufen(Some(&vorgemerkt_at), jetzt) {
                    continue;
                }
                tracing::warn!(
                    einsatz_id = id,
                    kategorie = k.as_str(),
                    "Purge Phase K2: Schwärzung einer Datenkategorie (irreversibel)"
                );
                match kategorie::schwaerzen(pool, id, k, jetzt).await {
                    Ok(true) => {
                        anzahl += 1;
                        geschwaerzt += 1;
                        // Offene Clients laden neu und tragen keinen Altstand weiter (design.md D5).
                        for event in [
                            LiveEvent::Person,
                            LiveEvent::Dokument,
                            LiveEvent::Schaden,
                            LiveEvent::Chat,
                            LiveEvent::Etb,
                        ] {
                            live.publiziere_einsatz(id, event);
                        }
                        // `teilschwaerzungen` steigt: Geräte verwerfen ihre älteren Stände (LFH-996).
                        crate::live::org::kopf_melden(pool, live, id, &[]).await;
                    }
                    Ok(false) => {}
                    Err(e) => tracing::error!(
                        einsatz_id = id,
                        kategorie = k.as_str(),
                        "Purge Phase K2 fehlgeschlagen: {e}"
                    ),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase K2: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase B: PII-Schwärzung nach Ablauf der Karenz (IRREVERSIBEL) ---
    match repo::faellige_purge(pool, KARENZ_TAGE).await {
        Ok(kandidaten) => {
            for (id, geloescht_at) in kandidaten {
                // Karenz-Grenze in Rust prüfen (injiziertes jetzt; defensiv gegen
                // unparsebare Tombstones → kein Scrub).
                if !karenz_abgelaufen(Some(&geloescht_at), jetzt) {
                    continue;
                }
                // Wie Phase A: erst nach dem Erfolg melden (LFH-756).
                match repo::schwaerze_einsatz(pool, id, &jetzt_s).await {
                    Ok(true) => {
                        tracing::warn!(
                            einsatz_id = id,
                            "Purge Phase B: PII-SCHWÄRZUNG (irreversibel) — Karenz abgelaufen"
                        );
                        anzahl += 1;
                        geschwaerzt += 1;
                    }
                    Ok(false) => {} // Bereits geschwärzt (Idempotenz).
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase B fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase B: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Nachlauf: Anhänge und Bilder geschwärzter Einsätze und Kategorien einzeln (LFH-905) ---
    // Die Wege oben laufen ihren Einsatz schon selbst nach; hier fallen nur Reste an (Absturz
    // oder Fehler zwischen atomarer Schwärzung und Nachlauf) und einmalig die Bilder der
    // Lagekarte, die vor LFH-997 geschwärzte Einsätze noch tragen. Vor Phase D, deren Kaskade die
    // Reste sonst in einer Transaktion löschte, und vor dem Rückschrieb.
    let mut nachgelaufen = 0;
    match crate::einsatz::schwaerzung_nachlauf::entferne_vorgesehene(pool, None).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::warn!(
                anzahl = n,
                "Purge Nachlauf: verbliebene Anhänge und Bilder geschwärzter Einsätze einzeln gelöscht"
            );
            nachgelaufen = n;
        }
        Err(e) => tracing::warn!("Purge Nachlauf fehlgeschlagen, nächster Tick versucht es: {e}"),
    }

    // --- Phase C: abgelaufene Auth-Audit-Einträge (LFH-249/F30) ---
    // Die Audit-Spur trägt personenbezogene Daten (Benutzername, Quell-IP), hängt aber an
    // keinem Einsatz und damit an keiner Einsatz-Aufbewahrungsfrist. Ohne eigene Frist
    // entstünde eine unbegrenzt wachsende Sammlung von Anmeldedaten — deshalb hier mit,
    // wo der Aufbewahrungs-Purge ohnehin läuft.
    match crate::auth::audit::purge_abgelaufene(pool).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!(
                anzahl = n,
                tage = crate::auth::audit::AUFBEWAHRUNG_TAGE,
                "Purge Phase C: abgelaufene Auth-Audit-Einträge gelöscht"
            );
            anzahl += n as usize;
        }
        Err(e) => tracing::warn!("Purge Phase C: Auth-Audit-Purge fehlgeschlagen: {e}"),
    }

    // Instanzkopplung (LLH-1490): abgelaufene `jti` des Wiederholschutzes und Kopplungscodes.
    if let Err(e) = crate::instanz::repo::purge(pool, &crate::zeit::jetzt()).await {
        tracing::error!("Purge Instanzkopplung fehlgeschlagen: {e}");
    }

    // Maschinenzugang (LLH-1652): abgelaufene `jti`, verfallene Codes, Abrufe nach 365 Tagen.
    if let Err(e) = crate::public_api::zugang::purge(pool, &crate::zeit::jetzt()).await {
        tracing::error!("Purge Maschinenzugang fehlgeschlagen: {e}");
    }

    // Ausgangsereignisse für Fremdsysteme (LLH-1655): sieben Tage, mit Löschgrenze für den
    // Cursor des Abrufs.
    match crate::public_api::events::purge(pool, &jetzt_s).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!("Purge Phase C: {n} Ausgangsereignis(se) für Fremdsysteme entfernt")
        }
        Err(e) => tracing::error!("Purge Ausgangsereignisse fehlgeschlagen: {e}"),
    }

    // Einwurf (LLH-1654): Alarmmeldungen der Ablage nach 7 Tagen, letzte Positionen nach 24
    // Stunden.
    if let Err(e) = crate::public_api::einwurf::purge(pool, &crate::zeit::jetzt()).await {
        tracing::error!("Purge Einwurf-Ablage fehlgeschlagen: {e}");
    }

    // Admin-Spur (LFH-1005): dieselbe Lage wie das Auth-Audit, eigene, längere Frist.
    match crate::auth::admin_audit::purge_abgelaufene(pool).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!(
                anzahl = n,
                tage = crate::auth::admin_audit::AUFBEWAHRUNG_TAGE,
                "Purge Phase C: abgelaufene Einträge der Admin-Spur gelöscht"
            );
            anzahl += n as usize;
        }
        Err(e) => tracing::warn!("Purge Phase C: Admin-Spur-Purge fehlgeschlagen: {e}"),
    }

    // --- Phase C2: abgelaufene Sitzungen (LFH-928) ---
    // Geräte im Feld melden sich nie ab; jede Anmeldung bliebe sonst als Zeile mit Benutzer und
    // Zeitpunkt stehen — dieselbe unbegrenzte Sammlung von Anmeldedaten wie in Phase C.
    match crate::auth::session::purge_abgelaufene(pool).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!(anzahl = n, "Purge Phase C2: abgelaufene Sitzungen gelöscht");
            anzahl += n as usize;
        }
        Err(e) => tracing::warn!("Purge Phase C2: Sitzungs-Purge fehlgeschlagen: {e}"),
    }

    // --- Phase C3: abgelaufene Planungen (LLH-1585, Spec `vorplanung`) ---
    // Eine Planung trägt Namen und Telefonnummern von Helfern, ist aber kein Einsatz: sie geht
    // 90 Tage nach ihrem Ende, übernommen oder nicht. Die Planer der Organisation sehen das live.
    match crate::planung::repo::purge_abgelaufene(pool, jetzt).await {
        Ok(weg) if weg.is_empty() => {}
        Ok(weg) => {
            tracing::warn!(
                anzahl = weg.len(),
                "Purge Phase C3: abgelaufene Planungen gelöscht (Aufbewahrung 90 Tage)"
            );
            for (org_id, id) in &weg {
                live.publiziere_planung(*org_id, *id);
            }
            anzahl += weg.len();
            geloescht += weg.len();
        }
        Err(e) => tracing::warn!("Purge Phase C3: Planungs-Purge fehlgeschlagen: {e}"),
    }

    // --- Phase R: Abräumen nach Verwahrung und Lebensende (UNUMKEHRBAR, LLH-1494) ---
    // Holt Merker nach, deren Abräumen nach dem Abgleich scheiterte, und räumt Spiegel der
    // meldenden Seite nach der Nachbereitung ab (design.md D5, D6). Schreibt den WAL selbst
    // zurück und meldet Einsatz und Liste wie Phase A (LLH-1713).
    // Eingespielte Archive gehen nach ihrer Zeit denselben Weg (D10), ihre Platzhalter-Konten
    // danach.
    super::archiv::einspielen::faellige_vormerken(pool, &jetzt_s).await;
    anzahl += super::abraeumen::phase_r(pool, live, &jetzt_s).await;
    super::archiv::einspielen::konten_aufraeumen(pool).await;

    // --- Phase D: endgültige Löschung geschwärzter Skelette (UNUMKEHRBAR, LFH-750) ---
    // Läuft nach Phase B: fallen Karenz-Ende und Skelett-Frist in denselben Lauf, löscht er
    // direkt nach der Schwärzung. Wie Phase B meldet sie nichts live — der Einsatz ist seit der
    // Vormerkung gesperrt und steht in keiner Einsatzliste.
    match skelett_loeschung::faellige(pool, jetzt).await {
        Ok(ids) => {
            for id in ids {
                tracing::warn!(
                    einsatz_id = id,
                    "Purge Phase D: ENDGÜLTIGE LÖSCHUNG des Skeletts (unumkehrbar) — \
                     Skelett-Frist abgelaufen"
                );
                match skelett_loeschung::loeschen(pool, id, jetzt).await {
                    Ok(true) => {
                        anzahl += 1;
                        geloescht += 1;
                    }
                    Ok(false) => {} // Race: Frist geleert/verlängert oder schon gelöscht.
                    Err(e) => tracing::error!(einsatz_id = id, "Purge Phase D fehlgeschlagen: {e}"),
                }
            }
        }
        Err(e) => tracing::warn!("Purge Phase D: Abfrage fehlgeschlagen: {e}"),
    }

    // --- Phase E: verwaiste Anhänge (LFH-250), einzeln je Transaktion (LFH-928) ---
    // Hochgeladen, aber nie gebunden; gegen monotones BLOB-Wachstum. Im Tick statt im Ticker,
    // damit er mit injiziertem `jetzt` testbar ist und seine Löschungen zurückgeschrieben werden.
    let mut verwaist = 0;
    match crate::anhang::repo::sweep_verwaiste(pool, jetzt).await {
        Ok(0) => {}
        Ok(n) => {
            tracing::info!(anzahl = n, "Purge Phase E: verwaiste Anhänge gelöscht");
            anzahl += n as usize;
            verwaist = n;
        }
        Err(e) => {
            // Bis zum Fehler kann er schon gelöscht haben: dann trotzdem zurückschreiben.
            tracing::warn!("Purge Phase E: Verwaisten-Sweep fehlgeschlagen: {e}");
            *rueckschrieb_ausstehend = true;
        }
    }

    // --- Rückschrieb nach Schwärzung, Löschung oder Sweep (LFH-725, LFH-750, LFH-928) ---
    // Nicht in jedem Tick: TRUNCATE hält beim Warten auf Lesende die Schreibsperre. Nach dem
    // Sweep kürzt er den WAL, den die genullten Seiten der BLOBs aufgebläht haben.
    if geschwaerzt > 0
        || geloescht > 0
        || nachgelaufen > 0
        || verwaist > 0
        || *rueckschrieb_ausstehend
    {
        match crate::db::wal_zurueckschreiben(pool).await {
            Ok(true) => {
                if *rueckschrieb_ausstehend {
                    tracing::info!("Purge: ausstehender WAL-Rückschrieb nachgeholt");
                }
                *rueckschrieb_ausstehend = false;
            }
            Ok(false) => {
                tracing::warn!(
                    "Purge: WAL-Rückschrieb von anderen Verbindungen blockiert, nächster Tick \
                     versucht es erneut"
                );
                *rueckschrieb_ausstehend = true;
            }
            Err(e) => {
                tracing::warn!(
                    "Purge: WAL-Rückschrieb fehlgeschlagen, nächster Tick versucht es erneut: {e}"
                );
                *rueckschrieb_ausstehend = true;
            }
        }
    }

    anzahl
}

/// Startet den Hintergrund-Purge-Scheduler (nur im Produktivlauf aus `main.rs`).
/// Dünner Wrapper um `tick_einmal`; die Logik selbst ist oben testbar.
pub fn starte_purge_scheduler(pool: SqlitePool, live: LiveHub) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(TICK_SEKUNDEN));
        // `true`: der erste Tick (sofort) holt einen beim Start blockierten Rückschrieb nach,
        // etwa nach einem Absturz zwischen Schwärzung und Rückschrieb.
        let mut rueckschrieb_ausstehend = true;
        loop {
            ticker.tick().await;
            // Klartext-Zwischendateien eines abgebrochenen Archivbaus (LLH-1494): außer diesem
            // Task baut niemand Archive, also gehört zwischen zwei Läufen jede vorhandene zu
            // einem toten Bau; die eines Einspielens erst nach einigen Stunden.
            super::archiv::zwischendateien_aufraeumen(&pool).await;
            tick_mit_rueckschrieb(&pool, &live, Utc::now(), &mut rueckschrieb_ausstehend).await;
        }
    });
}

#[cfg(test)]
mod tests;

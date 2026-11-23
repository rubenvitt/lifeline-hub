//! Klartext der Nutzlast an ein iOS-Gerät (LLH-2040, Entwurf „Kanal im Server“, Versand 1.).
//!
//! Anders als bei Web Push holt die Notification Service Extension nichts nach: Titel, Detail und
//! Pfad stehen verschlüsselt in der Nutzlast. Sie kommen aus derselben Stelle wie
//! `GET /api/notifications/{id}` (`routes::benachrichtigung::anzeige`). Absender und
//! Wortlaut kommen nur mit der Wahl „Mit Absender und Wortlaut“, nur für die Arten und Bezüge, zu
//! denen der Service Worker sie holt (`pushInhalt` in `frontend/public/alarm-sw.js`), und nur,
//! wenn der Empfänger die Meldung über `GET /api/einsaetze/{e}/meldungen/{mid}` lesen dürfte:
//! dieselbe Prüfung wie der Extractor `EinsatzLesezugriff<Meldungen>` samt Filter in
//! `meldung::repo::laden_im_einsatz`, je Empfänger auf dem Server wiederholt. Wo die Route
//! 404/403 gäbe, fehlen beide Felder.

use crate::auth::Benutzer;
use crate::benachrichtigung::aufloesung::Leserecht;
use crate::benachrichtigung::{
    BenachrichtigungArt, BenachrichtigungBezugTyp, BenachrichtigungEreignis, BenachrichtigungStufe,
};
use crate::einsatz::kontext::EinsatzKontext;
use crate::einsatz::modul::{Meldungen, ModulMarker};
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Version des Klartexts.
pub const VERSION: u8 = 1;
/// Auslassungszeichen am Ende eines gekürzten Feldes.
const AUSLASSUNG: char = '…';
/// Länge des GCM-Tags, das die Verschlüsselung anhängt.
const TAG: usize = 16;

/// Der Klartext, wie die Extension ihn nach dem Entschlüsseln liest. Feldnamen kurz, weil die
/// ganze Nutzlast in die 4 KB von APNs passen muss.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Klartext {
    pub v: u8,
    /// Anzeigename dieser Instanz; die App nennt ihn, wenn sie mehrere Server kennt.
    pub s: String,
    /// Einsatz.
    pub e: i64,
    /// Benachrichtigung.
    pub b: i64,
    pub stufe: BenachrichtigungStufe,
    pub titel: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub pfad: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wortlaut: Option<String>,
}

/// Baut den Klartext einer Benachrichtigung für `benutzer`. `mit_inhalt` ist die Wahl „Mit
/// Absender und Wortlaut“ der Anmeldung. Ein Fehler beim Lesen der Meldung lässt nur Absender und
/// Wortlaut weg (wie im Service Worker); nur ein Fehler beim Bilden des Texts ist ein Fehler.
pub async fn klartext(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    ereignis: &BenachrichtigungEreignis,
    mit_inhalt: bool,
) -> Result<Klartext, AppError> {
    // Ohne Einsatz (Störung einer Anbindung, LLH-2026) gibt es keinen Klartext: `e` ist Pflicht
    // auf dem Wire. `benachrichtigung::ausliefern` reicht solche Ereignisse gar nicht erst her.
    let einsatz_id = ereignis.einsatz_id.ok_or_else(|| {
        AppError::Internal("iOS-Push ohne Einsatz hat keinen Klartext".to_owned())
    })?;
    let (titel, detail, pfad) = match anzeige(pool, benutzer, ereignis).await? {
        Some(a) => (a.titel, a.detail, a.pfad),
        // Wie der Service Worker ohne Antwort: Titel der Stufe, Sprung in den Einsatz.
        None => (
            rueckfall_titel(ereignis.stufe).to_owned(),
            None,
            format!("/einsaetze/{einsatz_id}"),
        ),
    };
    let (absender, wortlaut) = if mit_inhalt && hat_inhalt(ereignis.art, ereignis.bezug_typ) {
        meldung_inhalt(pool, benutzer, einsatz_id, ereignis.bezug_id)
            .await
            .unwrap_or_default()
    } else {
        (None, None)
    };
    Ok(Klartext {
        v: VERSION,
        s: crate::instanz::name().to_owned(),
        e: einsatz_id,
        b: ereignis.benachrichtigung_id,
        stufe: ereignis.stufe,
        titel,
        detail,
        pfad,
        absender,
        wortlaut,
    })
}

/// Titel, wenn es keinen Text gibt; dieselben wie im Service Worker und im Relais.
pub fn rueckfall_titel(stufe: BenachrichtigungStufe) -> &'static str {
    match stufe {
        BenachrichtigungStufe::Alarm => "Alarm",
        _ => "Neue Benachrichtigung",
    }
}

/// Die Anzeige wie `GET /api/notifications/{id}`; `None`, wo die Route 404 gäbe.
async fn anzeige(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    ereignis: &BenachrichtigungEreignis,
) -> Result<Option<crate::benachrichtigung::BenachrichtigungAnzeige>, AppError> {
    let Some(zeile) = crate::benachrichtigung::repo::laden_eigene(
        pool,
        ereignis.benachrichtigung_id,
        benutzer.id,
    )
    .await?
    else {
        return Ok(None);
    };
    let Some(einsatz_id) = zeile.einsatz_id else {
        return Ok(None);
    };
    let recht = match Leserecht::laden(pool, einsatz_id).await {
        Ok(r) => r,
        Err(AppError::NotFound) => return Ok(None),
        Err(e) => return Err(e),
    };
    crate::routes::benachrichtigung::anzeige(pool, &recht, benutzer, einsatz_id, zeile).await
}

/// Ob der Service Worker zu dieser Art und diesem Bezug die Meldung holt (`inhaltTitelWort` in
/// `alarm-sw.js`): Sofortmeldung, ihre Eskalation und „Neue Meldung“, je zu einer Meldung oder
/// ihrer Übernahme in die Lage.
pub fn hat_inhalt(art: BenachrichtigungArt, bezug: BenachrichtigungBezugTyp) -> bool {
    matches!(
        art,
        BenachrichtigungArt::Sofortmeldung
            | BenachrichtigungArt::SofortmeldungEskaliert
            | BenachrichtigungArt::Meldung
    ) && matches!(
        bezug,
        BenachrichtigungBezugTyp::Meldung | BenachrichtigungBezugTyp::LageUebernahme
    )
}

/// Absender und Wortlaut der Meldung `meldung_id`, wenn `benutzer` sie über
/// `GET /api/einsaetze/{e}/meldungen/{mid}` lesen dürfte; jede Ablehnung der Route ist hier ein
/// Fehler, und der Aufrufer lässt beide Felder weg. Leere Felder fehlen.
async fn meldung_inhalt(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    einsatz_id: i64,
    meldung_id: i64,
) -> Result<(Option<String>, Option<String>), AppError> {
    // Wie `EinsatzLesezugriff<Meldungen>`: Org-Floor im Kontext, dann Lese- und Modul-Gate.
    // Eine Person, kein Gerät: Anmeldungen gibt es nur für Personen.
    let ctx = EinsatzKontext::load(pool, einsatz_id, benutzer.clone(), None).await?;
    ctx.fordere_lesezugriff()?;
    let modul = Meldungen::KEY.expect("Meldungen ist ein Modul");
    ctx.fordere_modul_zugriff(pool, modul).await?;
    // Wie `routes::meldung::detail`: ein Gerät sähe nur die eigenen.
    let m = crate::meldung::repo::laden_im_einsatz(
        pool,
        ctx.einsatz.id,
        meldung_id,
        ctx.geraet.is_some().then_some(ctx.benutzer.id),
        &crate::zeit::jetzt(),
    )
    .await?;
    let nicht_leer = |s: &str| {
        let t = s.trim();
        (!t.is_empty()).then(|| t.to_owned())
    };
    Ok((nicht_leer(&m.absender), nicht_leer(&m.inhalt)))
}

/// Größe des Chiffrats zu `k`: kompaktes JSON plus GCM-Tag.
fn groesse(k: &Klartext) -> usize {
    serde_json::to_vec(k).map_or(usize::MAX, |v| v.len()) + TAG
}

/// Kürzt `k`, bis das Chiffrat höchstens `max_bytes` groß ist: zuerst den Wortlaut, dann das
/// Detail, dann den Absender, je an einer Zeichengrenze mit „…“ am Ende; passt nicht einmal ein
/// Zeichen, fällt das Feld weg. Titel und Pfad bleiben.
pub fn kuerzen(k: &mut Klartext, max_bytes: usize) {
    for feld in [Feld::Wortlaut, Feld::Detail, Feld::Absender] {
        if groesse(k) <= max_bytes {
            return;
        }
        feld_kuerzen(k, feld, max_bytes);
    }
}

#[derive(Clone, Copy)]
enum Feld {
    Wortlaut,
    Detail,
    Absender,
}

impl Feld {
    fn von(self, k: &mut Klartext) -> &mut Option<String> {
        match self {
            Feld::Wortlaut => &mut k.wortlaut,
            Feld::Detail => &mut k.detail,
            Feld::Absender => &mut k.absender,
        }
    }
}

/// Behält vom Feld die längste Folge ganzer Zeichen, mit der `k` passt (binäre Suche über die
/// Zahl der Zeichen; JSON-Maskierung zählt mit, weil gemessen wird).
fn feld_kuerzen(k: &mut Klartext, feld: Feld, max_bytes: usize) {
    let Some(text) = feld.von(k).take() else {
        return;
    };
    let grenzen: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    let mit = |k: &mut Klartext, n: usize| {
        let mut t = String::with_capacity(grenzen.get(n).copied().unwrap_or(text.len()) + 3);
        t.push_str(&text[..grenzen.get(n).copied().unwrap_or(text.len())]);
        t.push(AUSLASSUNG);
        *feld.von(k) = Some(t);
    };
    // Höchstens alle Zeichen bis auf eines: gekürzt heißt mit Auslassung.
    let (mut passt, mut zu_viel) = (0usize, grenzen.len());
    while zu_viel - passt > 1 {
        let mitte = passt + (zu_viel - passt) / 2;
        mit(k, mitte);
        if groesse(k) <= max_bytes {
            passt = mitte;
        } else {
            zu_viel = mitte;
        }
    }
    if passt == 0 {
        *feld.von(k) = None;
    } else {
        mit(k, passt);
    }
}

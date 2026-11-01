//! Persistenz des Fachmoduls Verpflegung (LFH-634).
//!
//! **Die Schreibpfade laufen auf einer offenen Transaktion** (`_tx`, `&mut SqliteConnection`).
//! Der Aufrufer (Route) öffnet sie mit `write_retry!` (BEGIN IMMEDIATE), lädt ETB-`startwert`
//! und Zeitstil des Einsatzes (`zeitdarstellung::zeitstil_laden`) vorher und publiziert nach dem Commit — die Rückgabe trägt dafür die
//! Kennungen und die ETB-Einträge. Zeitfenster und ETB-Eintrag entstehen damit in EINER
//! Transaktion; ein Fehler mitten im Ablauf lässt nichts zurück.
//!
//! **Statuscodes (design.md D4, `src/error.rs`):** 400 für das Feld allein (leere Bezeichnung,
//! negativer Bedarfsteil, negative Kostform, Menge ≤ 0, unlesbarer Zeitpunkt); 422 für den
//! Zusammenhang (Ende nicht nach Beginn, Sonderkost über Gesamtbedarf bzw. Menge — beim Ändern
//! gegen den EFFEKTIVZUSTAND aus Bestand und Änderung —, Löschen mit gültiger Ausgabe, zweite
//! Rücknahme); 404 für fremde Zeitfenster und Ausgaben. Die 400-Prüfungen laufen vor den
//! 422-Prüfungen: die DB-CHECKs kämen über LFH-245 als 422 heraus, nur die 400 belegt den
//! Precheck.
//!
//! **ETB (design.md D5):** Anlegen, Ändern und Löschen eines Zeitfensters schreiben je einen
//! System-Eintrag mit Zeitraum in Org-Zeit; Ausgabe und Rücknahme schreiben keinen. Ein
//! Ändern ohne neuen Wert schreibt nichts (Leerlauf-Riegel, leere `etb_ids`).
//!
//! **Verpflegungsstellen (LLH-1040, design.md D2):** Anlegen, Ändern und Stornieren schreiben
//! kein ETB; Inbetriebnahme und Auflösung je einen System-Eintrag in derselben Transaktion.
//! 404 für eine fremde Stelle im Pfad, 409 für eine stornierte, 422 für einen unzulässigen
//! Übergang, für ein Storno einer nicht geplanten Stelle oder einer Stelle mit Ausgabe und für
//! einen Verweis im Body auf eine fremde, unbekannte oder stornierte Stelle. Eine Ausgabe an
//! einer aufgelösten Stelle ist 409, außer ihr Zeitpunkt liegt vor der Auflösung (D3).

use std::collections::HashMap;

use crate::zeitdarstellung::Zeitstil;
use sqlx::{SqliteConnection, SqlitePool};

use super::stelle::{
    darf_uebergehen, VerpflegungsstelleAnzeige, VerpflegungsstelleArt, VerpflegungsstelleStatus,
};
use super::{
    deckung, dedupe_stelle_ids, draht_lesen, etb_text, zeitraum_text, AusgabeAnzeige, Bedarf,
    EmpfaengerAbschnitt, EmpfaengerBetreuungsstelle, EmpfaengerEinheit, Sonderkost,
    SonderkostEingabe, VerpflegungAnzeige, VerpflegungEmpfaenger, Verpflegungsart,
    ZeitfensterAnzeige,
};
use crate::error::AppError;
use crate::routes::support::{
    optional_max, optional_max_tri, pflicht_max, pflicht_max_tri, pruefe_koordinate,
};

/// Eingabe „Zeitfenster anlegen“. Die Route hat JSON gelesen und die Zeitpunkte normalisiert
/// (UTC, `YYYY-MM-DD HH:MM:SS`); Bezeichnung, Bedarf, Sonderkost und Zeitregel prüft das Repo.
#[derive(Debug, Clone)]
pub struct ZeitfensterEingabe {
    pub bezeichnung: String,
    pub von_at: String,
    pub bis_at: String,
    pub bedarf_kraefte: i64,
    pub bedarf_betreute: i64,
    pub bedarf_weitere: i64,
    /// Fehlende Kostformen sind 0.
    pub sonderkost: SonderkostEingabe,
    /// Fehlt = ohne Angabe (LLH-1040 D8).
    pub verpflegungsart: Option<Verpflegungsart>,
    /// Zugeordnete Stellen; leer = einsatzweit (D5). Entdoppelt und begrenzt wird im Repo.
    pub stelle_ids: Vec<i64>,
}

/// Eingabe „Zeitfenster ändern“ — jedes Feld fehlt = unverändert, auch je Kostform.
#[derive(Debug, Clone, Default)]
pub struct ZeitfensterAenderung {
    pub bezeichnung: Option<String>,
    pub von_at: Option<String>,
    pub bis_at: Option<String>,
    pub bedarf_kraefte: Option<i64>,
    pub bedarf_betreute: Option<i64>,
    pub bedarf_weitere: Option<i64>,
    pub sonderkost: SonderkostEingabe,
    /// Tri-State: fehlt = unverändert, `Some(None)` = leeren.
    pub verpflegungsart: Option<Option<Verpflegungsart>>,
    /// Fehlt = unverändert; eine Liste ersetzt die Menge, `[]` leert sie (D5).
    pub stelle_ids: Option<Vec<i64>>,
    /// Stand beim Öffnen (LLH-1414); `None` schreibt ohne Vergleich.
    pub basis_geaendert_at: Option<String>,
}

/// Eingabe „Ausgabe erfassen“. `zeitpunkt_at` hat die Route normalisiert (fehlt = jetzt), die
/// Einsatzzugehörigkeit der Nachforderung hat sie vorab geprüft (404).
#[derive(Debug, Clone)]
pub struct AusgabeEingabe {
    pub zeitpunkt_at: String,
    pub menge: i64,
    pub ort: Option<String>,
    pub bemerkung: Option<String>,
    /// Fehlende Kostformen sind 0.
    pub sonderkost: SonderkostEingabe,
    pub nachforderung_id: Option<i64>,
    /// Verpflegungsstelle desselben Einsatzes (LLH-1040 D3); geprüft in der Transaktion.
    pub verpflegungsstelle_id: Option<i64>,
    /// Empfänger-Einheit desselben Einsatzes (LLH-1055 D2); geprüft in der Transaktion.
    pub einheit_id: Option<i64>,
    /// Empfänger-Abschnitt desselben Einsatzes (LLH-1055 D2).
    pub abschnitt_id: Option<i64>,
    /// Empfänger-Betreuungsstelle desselben Einsatzes (LLH-1295 D2); von Einheit, Abschnitt und
    /// Betreuungsstelle höchstens eines.
    pub betreuungsstelle_id: Option<i64>,
    /// Idempotenzschlüssel der Offline-Queue (LFH-688), von der Route normalisiert.
    pub client_id: Option<String>,
}

/// Eingabe „Verpflegungsstelle anlegen“ (LLH-1040). Die Art hat die Route gelesen (400).
#[derive(Debug, Clone)]
pub struct StelleEingabe {
    pub bezeichnung: String,
    pub art: VerpflegungsstelleArt,
    pub standort: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub abschnitt_id: Option<i64>,
}

/// Eingabe „Verpflegungsstelle ändern“ — jedes Feld fehlt = unverändert; die optionalen Felder
/// sind Tri-State (`Some(None)` = leeren).
#[derive(Debug, Clone, Default)]
pub struct StelleAenderung {
    pub bezeichnung: Option<String>,
    pub art: Option<VerpflegungsstelleArt>,
    pub standort: Option<Option<String>>,
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
    pub abschnitt_id: Option<Option<i64>>,
}

/// Ergebnis eines Schreibvorgangs an einer Stelle: ob etwas geschrieben wurde (für Live) und
/// die ETB-Einträge (nur beim Statuswechsel).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StelleGeschrieben {
    pub id: i64,
    pub geaendert: bool,
    pub etb_ids: Vec<i64>,
}

/// Ergebnis eines Schreibvorgangs an einem Zeitfenster: seine Kennung und die geschriebenen
/// ETB-Einträge (leer beim Leerlauf eines Änderns).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Geschrieben {
    pub id: i64,
    pub etb_ids: Vec<i64>,
}

/// Ergebnis von Ausgabe und Rücknahme (ohne ETB): die Ausgabe und ihr Zeitfenster.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AusgabeGeschrieben {
    pub ausgabe_id: i64,
    pub zeitfenster_id: i64,
    /// `false` nur beim Replay einer Erfassung über ihre `client_id` (LFH-688): nichts
    /// geschrieben, also auch nichts zu publizieren.
    pub neu: bool,
}

// ── Zeilen ──────────────────────────────────────────────────────────────────────────────────

macro_rules! zeitfenster_select {
    () => {
        "SELECT id, einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
                bedarf_weitere, sk_vegetarisch, sk_vegan, sk_ohne_schwein, \
                sk_diaet_allergenarm, sk_saeugling_kleinkind, angelegt_at, geaendert_at, \
                verpflegungsart \
         FROM verpflegung_zeitfenster "
    };
}

macro_rules! ausgabe_select {
    () => {
        "SELECT id, zeitfenster_id, zeitpunkt_at, menge, ort, bemerkung, sk_vegetarisch, \
                sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, sk_saeugling_kleinkind, \
                nachforderung_id, zurueckgenommen_at, erfasst_at, verpflegungsstelle_id, \
                einheit_id, abschnitt_id, betreuungsstelle_id \
         FROM verpflegung_ausgabe "
    };
}

/// Zuordnung Zeitfenster–Stelle als `(zeitfenster_id, stelle_id)`, geordnet über die Stelle.
macro_rules! zuordnung_select {
    () => {
        "SELECT zs.zeitfenster_id, zs.stelle_id FROM verpflegung_zeitfenster_stelle zs \
         JOIN verpflegungsstelle s ON s.id = zs.stelle_id "
    };
}

macro_rules! stelle_select {
    () => {
        "SELECT id, bezeichnung, art, standort, lat, lon, abschnitt_id, status, \
                aufgeloest_at, storniert_at, angelegt_at, \
                EXISTS (SELECT 1 FROM geraet_kopplung k \
                         WHERE k.verpflegungsstelle_id = verpflegungsstelle.id \
                           AND k.widerrufen_at IS NULL \
                           AND k.laeuft_ab_at > datetime('now')) AS geraet_gekoppelt \
         FROM verpflegungsstelle "
    };
}

#[derive(sqlx::FromRow, Clone)]
struct StelleZeile {
    id: i64,
    bezeichnung: String,
    #[sqlx(try_from = "String")]
    art: VerpflegungsstelleArt,
    standort: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    abschnitt_id: Option<i64>,
    #[sqlx(try_from = "String")]
    status: VerpflegungsstelleStatus,
    aufgeloest_at: Option<String>,
    storniert_at: Option<String>,
    angelegt_at: String,
    /// Eine laufende Kopplung (wartend oder aktiv) hängt an der Stelle (LLH-1048 Teil II).
    geraet_gekoppelt: bool,
}

impl StelleZeile {
    fn anzeige(self) -> VerpflegungsstelleAnzeige {
        VerpflegungsstelleAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung,
            art: self.art,
            standort: self.standort,
            lat: self.lat,
            lon: self.lon,
            abschnitt_id: self.abschnitt_id,
            status: self.status,
            aufgeloest_at: self.aufgeloest_at,
            angelegt_at: self.angelegt_at,
            geraet_gekoppelt: self.geraet_gekoppelt,
        }
    }
}

#[derive(sqlx::FromRow, Clone)]
struct ZeitfensterZeile {
    id: i64,
    einsatz_id: i64,
    bezeichnung: String,
    von_at: String,
    bis_at: String,
    bedarf_kraefte: i64,
    bedarf_betreute: i64,
    bedarf_weitere: i64,
    sk_vegetarisch: i64,
    sk_vegan: i64,
    sk_ohne_schwein: i64,
    sk_diaet_allergenarm: i64,
    sk_saeugling_kleinkind: i64,
    angelegt_at: String,
    geaendert_at: Option<String>,
    verpflegungsart: Option<String>,
}

impl ZeitfensterZeile {
    /// Die gespeicherte Art; der CHECK lässt nur bekannte Wörter zu.
    fn art(&self) -> Option<Verpflegungsart> {
        self.verpflegungsart
            .as_deref()
            .and_then(Verpflegungsart::parse)
    }

    fn sonderkost(&self) -> Sonderkost {
        Sonderkost {
            vegetarisch: self.sk_vegetarisch,
            vegan: self.sk_vegan,
            ohne_schwein: self.sk_ohne_schwein,
            diaet_allergenarm: self.sk_diaet_allergenarm,
            saeugling_kleinkind: self.sk_saeugling_kleinkind,
        }
    }

    fn bedarf(&self) -> Bedarf {
        bedarf(
            self.bedarf_kraefte,
            self.bedarf_betreute,
            self.bedarf_weitere,
            self.sonderkost(),
        )
    }

    /// `stelle_ids`: die Zuordnung nach Bezeichnung der Stellen.
    fn anzeige(self, ausgaben: Vec<AusgabeAnzeige>, stelle_ids: Vec<i64>) -> ZeitfensterAnzeige {
        let bedarf = self.bedarf();
        let verpflegungsart = self.art();
        let d = deckung::rechne(&bedarf, &ausgaben, &stelle_ids);
        ZeitfensterAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            bezeichnung: self.bezeichnung,
            von_at: self.von_at,
            bis_at: self.bis_at,
            verpflegungsart,
            bedarf,
            ausgegeben: d.ausgegeben,
            fehlmenge: d.fehlmenge,
            stelle_ids,
            je_stelle: d.je_stelle,
            verpflegt_anderswo: Vec::new(),
            ausgaben,
            angelegt_at: self.angelegt_at,
            geaendert_at: self.geaendert_at,
        }
    }
}

#[derive(sqlx::FromRow)]
struct AusgabeZeile {
    id: i64,
    zeitfenster_id: i64,
    zeitpunkt_at: String,
    menge: i64,
    ort: Option<String>,
    bemerkung: Option<String>,
    sk_vegetarisch: i64,
    sk_vegan: i64,
    sk_ohne_schwein: i64,
    sk_diaet_allergenarm: i64,
    sk_saeugling_kleinkind: i64,
    nachforderung_id: Option<i64>,
    zurueckgenommen_at: Option<String>,
    erfasst_at: String,
    verpflegungsstelle_id: Option<i64>,
    einheit_id: Option<i64>,
    abschnitt_id: Option<i64>,
    betreuungsstelle_id: Option<i64>,
}

impl From<AusgabeZeile> for AusgabeAnzeige {
    fn from(z: AusgabeZeile) -> Self {
        AusgabeAnzeige {
            id: z.id,
            zeitfenster_id: z.zeitfenster_id,
            zeitpunkt_at: z.zeitpunkt_at,
            menge: z.menge,
            ort: z.ort,
            bemerkung: z.bemerkung,
            sonderkost: Sonderkost {
                vegetarisch: z.sk_vegetarisch,
                vegan: z.sk_vegan,
                ohne_schwein: z.sk_ohne_schwein,
                diaet_allergenarm: z.sk_diaet_allergenarm,
                saeugling_kleinkind: z.sk_saeugling_kleinkind,
            },
            nachforderung_id: z.nachforderung_id,
            verpflegungsstelle_id: z.verpflegungsstelle_id,
            einheit_id: z.einheit_id,
            abschnitt_id: z.abschnitt_id,
            betreuungsstelle_id: z.betreuungsstelle_id,
            zurueckgenommen_at: z.zurueckgenommen_at,
            erfasst_at: z.erfasst_at,
        }
    }
}

fn bedarf(kraefte: i64, betreute: i64, weitere: i64, sonderkost: Sonderkost) -> Bedarf {
    Bedarf {
        kraefte,
        betreute,
        weitere,
        gesamt: kraefte + betreute + weitere,
        sonderkost,
    }
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// Alle Zeitfenster des Einsatzes nach Beginn, je mit Deckung und allen Ausgaben nach
/// Zeitpunkt (zurückgenommene eingeschlossen).
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<VerpflegungAnzeige, AppError> {
    let zeilen = sqlx::query_as::<_, ZeitfensterZeile>(concat!(
        zeitfenster_select!(),
        "WHERE einsatz_id = ? ORDER BY von_at, id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut je_fenster: HashMap<i64, Vec<AusgabeAnzeige>> = HashMap::new();
    for a in sqlx::query_as::<_, AusgabeZeile>(concat!(
        ausgabe_select!(),
        "WHERE einsatz_id = ? ORDER BY zeitpunkt_at, id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    {
        je_fenster
            .entry(a.zeitfenster_id)
            .or_default()
            .push(a.into());
    }
    let mut zuordnung: HashMap<i64, Vec<i64>> = HashMap::new();
    for (zid, sid) in sqlx::query_as::<_, (i64, i64)>(concat!(
        zuordnung_select!(),
        "WHERE zs.einsatz_id = ? ORDER BY s.bezeichnung, s.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    {
        zuordnung.entry(zid).or_default().push(sid);
    }
    let stellen = sqlx::query_as::<_, StelleZeile>(concat!(
        stelle_select!(),
        "WHERE einsatz_id = ? AND storniert_at IS NULL ORDER BY bezeichnung, id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(StelleZeile::anzeige)
    .collect();
    let empfaenger = load_empfaenger(pool, einsatz_id).await?;
    Ok(VerpflegungAnzeige {
        zeitfenster: zeilen
            .into_iter()
            .map(|z| {
                let ausgaben = je_fenster.remove(&z.id).unwrap_or_default();
                let stelle_ids = zuordnung.remove(&z.id).unwrap_or_default();
                z.anzeige(ausgaben, stelle_ids)
            })
            .collect(),
        stellen,
        empfaenger,
    })
}

/// Eine Einheit der Empfängerliste, wie gelesen.
#[derive(sqlx::FromRow)]
struct EmpfaengerEinheitZeile {
    id: i64,
    name: String,
    funkrufname: Option<String>,
    ueber_einheit_id: Option<i64>,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    aufgeloest_at: Option<String>,
}

/// Die Empfängerliste (LLH-1055, design.md D3) in konstant vielen Abfragen: die nicht
/// aufgelösten Einheiten und die aufgelösten, auf die eine Ausgabe verweist, in der Folge des
/// Kräftebaums (`sortier`, `id`); alle Abschnitte; die nicht stornierten Betreuungsstellen nach
/// Bezeichnung (LLH-1295). Stärken aus
/// [`crate::einheit::repo::load_staerken_je_einheit`] (dieselbe Rechnung wie `GET …/einheiten`),
/// Eintreffen aus der juengsten Einsatzperiode der Zeitachse. Liest bewusst keine Spalte mit
/// Personenbezug (Führer, Erreichbarkeit, Kommunikationsmittel, Bemerkung, Mitglieder).
pub async fn load_empfaenger(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<VerpflegungEmpfaenger, AppError> {
    let zeilen = sqlx::query_as::<_, EmpfaengerEinheitZeile>(
        "SELECT e.id, e.name, e.funkrufname, e.ueber_einheit_id, e.abschnitt_id, \
                ab.name AS abschnitt_name, e.aufgeloest_at \
         FROM einsatz_einheit e \
         LEFT JOIN einsatzabschnitt ab ON ab.id = e.abschnitt_id \
         WHERE e.einsatz_id = ? \
           AND (e.aufgeloest_at IS NULL \
                OR EXISTS (SELECT 1 FROM verpflegung_ausgabe a WHERE a.einheit_id = e.id)) \
         ORDER BY e.sortier, e.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let abschnitte = sqlx::query_as::<_, (i64, String, Option<i64>)>(
        "SELECT id, name, ueber_abschnitt_id FROM einsatzabschnitt \
         WHERE einsatz_id = ? ORDER BY sortier, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, name, ueber_abschnitt_id)| EmpfaengerAbschnitt {
        id,
        name,
        ueber_abschnitt_id,
    })
    .collect();
    // LLH-1295 (design.md D3): nur Kennung, Bezeichnung und Status; Leitung, Kontakt, Notiz,
    // Standort, Kapazität und Belegung liest die Abfrage bewusst nicht.
    let betreuungsstellen = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT id, bezeichnung, status FROM betreuungsstelle \
         WHERE einsatz_id = ? AND storniert_at IS NULL ORDER BY bezeichnung, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, bezeichnung, status)| EmpfaengerBetreuungsstelle {
        id,
        bezeichnung,
        geschlossen: status == "geschlossen",
    })
    .collect();
    if zeilen.is_empty() {
        return Ok(VerpflegungEmpfaenger {
            einheiten: Vec::new(),
            abschnitte,
            betreuungsstellen,
        });
    }
    let staerken = crate::einheit::repo::load_staerken_je_einheit(pool, einsatz_id).await?;
    let eintreffen: HashMap<i64, String> =
        crate::zeitachse::repo::perioden_einheiten(pool, einsatz_id)
            .await?
            .into_iter()
            .filter_map(|p| {
                let juengste = p.perioden.into_iter().last()?;
                Some((p.einheit_id, juengste.eintreffen_at?))
            })
            .collect();
    let einheiten = zeilen
        .into_iter()
        .map(|z| EmpfaengerEinheit {
            ist: staerken.eigene(z.id),
            ist_kumuliert: staerken.kumuliert(z.id),
            eintreffen_at: eintreffen.get(&z.id).cloned(),
            id: z.id,
            name: z.name,
            funkrufname: z.funkrufname,
            ueber_einheit_id: z.ueber_einheit_id,
            abschnitt_id: z.abschnitt_id,
            abschnitt_name: z.abschnitt_name,
            aufgeloest_at: z.aufgeloest_at,
        })
        .collect();
    Ok(VerpflegungEmpfaenger {
        einheiten,
        abschnitte,
        betreuungsstellen,
    })
}

/// Lädt ein Zeitfenster mit Deckung und Ausgaben. `NotFound`, wenn es nicht zum Einsatz gehört.
pub async fn zeitfenster_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<ZeitfensterAnzeige, AppError> {
    let zeile = sqlx::query_as::<_, ZeitfensterZeile>(concat!(
        zeitfenster_select!(),
        "WHERE einsatz_id = ? AND id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;
    let ausgaben = sqlx::query_as::<_, AusgabeZeile>(concat!(
        ausgabe_select!(),
        "WHERE zeitfenster_id = ? ORDER BY zeitpunkt_at, id"
    ))
    .bind(id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(AusgabeAnzeige::from)
    .collect();
    let stelle_ids = sqlx::query_as::<_, (i64, i64)>(concat!(
        zuordnung_select!(),
        "WHERE zs.zeitfenster_id = ? ORDER BY s.bezeichnung, s.id"
    ))
    .bind(id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(_, sid)| sid)
    .collect();
    Ok(zeile.anzeige(ausgaben, stelle_ids))
}

// ── Feldprüfungen (400) ─────────────────────────────────────────────────────────────────────

/// Optionaler Freitext: getrimmt, leer = nicht gesetzt.
fn text_opt(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

fn anzahl_pruefen(feld: &str, n: i64) -> Result<(), AppError> {
    if n < 0 {
        return Err(AppError::Validation(format!(
            "{feld} darf nicht negativ sein, war {n}"
        )));
    }
    if n > super::MAX_EP {
        return Err(AppError::Validation(format!(
            "{feld} darf höchstens {} sein, war {n}",
            super::MAX_EP
        )));
    }
    Ok(())
}

// ── Zusammenhangsprüfungen (422) ────────────────────────────────────────────────────────────

fn zeitregel(von: &str, bis: &str) -> Result<(), AppError> {
    // Verglichen werden die GEPARSTEN Zeitpunkte, nicht die Texte.
    let (v, b) = (draht_lesen("von_at", von)?, draht_lesen("bis_at", bis)?);
    if b <= v {
        return Err(AppError::UnprocessableEntity(format!(
            "Das Ende ({bis}) muss nach dem Beginn ({von}) liegen"
        )));
    }
    Ok(())
}

fn teilmenge(sonderkost: &Sonderkost, gesamt: i64, wovon: &str) -> Result<(), AppError> {
    let summe = sonderkost.summe();
    if summe > gesamt {
        return Err(AppError::UnprocessableEntity(format!(
            "Sonderkost ({summe}) übersteigt {wovon} ({gesamt}); Sonderkost ist eine Teilmenge"
        )));
    }
    Ok(())
}

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

async fn zeitfenster_roh_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<ZeitfensterZeile, AppError> {
    sqlx::query_as::<_, ZeitfensterZeile>(concat!(
        zeitfenster_select!(),
        "WHERE einsatz_id = ? AND id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Zeitraum eines Zeitfensters als ETB-Text (Zone und Darstellung des Einsatzes). Die
/// Zeitpunkte liegen geprüft im Drahtformat vor.
fn zeitraum(von: &str, bis: &str, stil: Zeitstil) -> Result<String, AppError> {
    Ok(zeitraum_text(
        draht_lesen("von_at", von)?,
        draht_lesen("bis_at", bis)?,
        stil,
    ))
}

// ── Zuordnung Zeitfenster–Stelle (D5) ───────────────────────────────────────────────────────

/// Eine Stelle für Prüfung und ETB-Text einer Zuordnung.
#[derive(sqlx::FromRow)]
struct StelleKurz {
    id: i64,
    bezeichnung: String,
    #[sqlx(try_from = "String")]
    status: VerpflegungsstelleStatus,
    storniert: bool,
}

/// IDs als JSON-Array für `json_each(?)`.
fn ids_json(ids: &[i64]) -> Result<String, AppError> {
    serde_json::to_string(ids)
        .map_err(|e| AppError::Internal(format!("Stellen-Kennungen serialisieren: {e}")))
}

/// Die Stellen des Einsatzes unter `ids`, nach Bezeichnung — EINE Anweisung für die ganze Liste
/// (`src/AGENTS.md`, „Eingabegrenzen“: ID-Listen mit einer von N unabhängigen Zahl von
/// Anweisungen). Fremde und unbekannte Kennungen fehlen im Ergebnis.
async fn stellen_kurz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ids: &[i64],
) -> Result<Vec<StelleKurz>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(sqlx::query_as::<_, StelleKurz>(
        "SELECT id, bezeichnung, status, storniert_at IS NOT NULL AS storniert \
         FROM verpflegungsstelle \
         WHERE einsatz_id = ? AND id IN (SELECT value FROM json_each(?)) \
         ORDER BY bezeichnung, id",
    )
    .bind(einsatz_id)
    .bind(ids_json(ids)?)
    .fetch_all(&mut *conn)
    .await?)
}

/// Die bisherige Zuordnung eines Zeitfensters.
async fn zuordnung_tx(
    conn: &mut SqliteConnection,
    zeitfenster_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT stelle_id FROM verpflegung_zeitfenster_stelle WHERE zeitfenster_id = ?",
    )
    .bind(zeitfenster_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// 422 (D5): jede neue Kennung muss eine nicht stornierte Stelle des Einsatzes sein; eine
/// aufgelöste Stelle nur, wenn sie schon zugeordnet war (Geschichte). Entfernen geht immer.
fn check_zuordnung(neu: &[i64], vorher: &[i64], stellen: &[StelleKurz]) -> Result<(), AppError> {
    for id in neu {
        match stellen.iter().find(|s| s.id == *id) {
            None => {
                return Err(AppError::UnprocessableEntity(format!(
                    "Verpflegungsstelle {id} gibt es in diesem Einsatz nicht"
                )))
            }
            Some(s) if s.storniert => {
                return Err(AppError::UnprocessableEntity(format!(
                    "Verpflegungsstelle ‚{}‘ ist storniert",
                    s.bezeichnung
                )))
            }
            Some(s) if s.status == VerpflegungsstelleStatus::Aufgeloest && !vorher.contains(id) => {
                return Err(AppError::UnprocessableEntity(format!(
                    "Verpflegungsstelle ‚{}‘ ist aufgelöst und lässt sich nicht neu zuordnen",
                    s.bezeichnung
                )))
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// Die Bezeichnungen der Stellen unter `ids`, nach Bezeichnung (Reihenfolge von `stellen`).
fn namen_von(stellen: &[StelleKurz], ids: &[i64]) -> Vec<String> {
    stellen
        .iter()
        .filter(|s| ids.contains(&s.id))
        .map(|s| s.bezeichnung.clone())
        .collect()
}

/// Ersetzt die Zuordnung durch `ids` (geprüft, entdoppelt) — zwei Anweisungen, gleich wie viele
/// Stellen (Muster `sprechgruppe::repo::ersetzen_tx`). Das INSERT ist bewusst kein
/// `OR IGNORE`: eine doppelte Kennung, die am Entdoppeln vorbeikäme, scheiterte am Schlüssel.
async fn replace_zuordnung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    zeitfenster_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    let ids = ids_json(ids)?;
    sqlx::query(
        "DELETE FROM verpflegung_zeitfenster_stelle \
         WHERE zeitfenster_id = ? AND stelle_id NOT IN (SELECT value FROM json_each(?))",
    )
    .bind(zeitfenster_id)
    .bind(&ids)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO verpflegung_zeitfenster_stelle (einsatz_id, zeitfenster_id, stelle_id) \
         SELECT ?, ?, value FROM json_each(?) \
         WHERE value NOT IN \
             (SELECT stelle_id FROM verpflegung_zeitfenster_stelle WHERE zeitfenster_id = ?)",
    )
    .bind(einsatz_id)
    .bind(zeitfenster_id)
    .bind(&ids)
    .bind(zeitfenster_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ── Zeitfenster ─────────────────────────────────────────────────────────────────────────────

/// Ein Zeitfenster nach den Feldprüfungen (400) von [`check_zeitfenster_felder`].
#[derive(Debug, Clone)]
pub struct ZeitfensterFelder {
    /// Getrimmt, nicht leer, höchstens `ZEITFENSTER_BEZEICHNUNG_MAX`.
    pub bezeichnung: String,
    /// Entdoppelt.
    pub stelle_ids: Vec<i64>,
    pub sonderkost: Sonderkost,
    pub bedarf: Bedarf,
}

/// Die Feldprüfungen (400) eines neuen Zeitfensters, jedes Feld für sich und ohne Abfrage:
/// Stellenliste, Bezeichnung, Zeitpunkte, Bedarfsteile, Kostformen. Das Einzelanlegen ruft sie
/// zuerst; die Sammelanlage (LLH-1058, design.md D3) ruft sie für ALLE Fenster, bevor das erste
/// 422 geprüft wird.
pub fn check_zeitfenster_felder(
    eingabe: &ZeitfensterEingabe,
) -> Result<ZeitfensterFelder, AppError> {
    // Die Stellenliste (D5), gezählt vor dem Entdoppeln.
    let stelle_ids = dedupe_stelle_ids(&eingabe.stelle_ids)?;
    let bezeichnung = pflicht_max(
        &eingabe.bezeichnung,
        "bezeichnung",
        super::ZEITFENSTER_BEZEICHNUNG_MAX,
    )?;
    draht_lesen("von_at", &eingabe.von_at)?;
    draht_lesen("bis_at", &eingabe.bis_at)?;
    anzahl_pruefen("bedarf_kraefte", eingabe.bedarf_kraefte)?;
    anzahl_pruefen("bedarf_betreute", eingabe.bedarf_betreute)?;
    anzahl_pruefen("bedarf_weitere", eingabe.bedarf_weitere)?;
    let sonderkost = eingabe.sonderkost.ueber(&Sonderkost::default());
    sonderkost.pruefen()?;
    let bedarf = bedarf(
        eingabe.bedarf_kraefte,
        eingabe.bedarf_betreute,
        eingabe.bedarf_weitere,
        sonderkost,
    );
    Ok(ZeitfensterFelder {
        bezeichnung,
        stelle_ids,
        sonderkost,
        bedarf,
    })
}

/// Der Zusammenhang (422) eines neuen Zeitfensters ohne Abfrage: Ende nach Beginn, Sonderkost
/// als Teilmenge.
fn check_zeitfenster_zusammenhang(
    eingabe: &ZeitfensterEingabe,
    f: &ZeitfensterFelder,
) -> Result<(), AppError> {
    zeitregel(&eingabe.von_at, &eingabe.bis_at)?;
    teilmenge(&f.sonderkost, f.bedarf.gesamt, "den Gesamtbedarf")
}

/// Legt ein Zeitfenster an. ETB: System-Eintrag mit Bezeichnung, Zeitraum und Bedarf.
pub async fn create_zeitfenster_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    startwert: i64,
    stil: Zeitstil,
    eingabe: &ZeitfensterEingabe,
) -> Result<Geschrieben, AppError> {
    // 400 — jedes Feld für sich, vor jeder Abfrage
    let felder = check_zeitfenster_felder(eingabe)?;
    // 422 — der Zusammenhang
    check_zeitfenster_zusammenhang(eingabe, &felder)?;
    let ZeitfensterFelder {
        bezeichnung,
        stelle_ids,
        sonderkost,
        bedarf: b,
    } = felder;
    let stellen = stellen_kurz_tx(conn, einsatz_id, &stelle_ids).await?;
    check_zuordnung(&stelle_ids, &[], &stellen)?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegung_zeitfenster \
            (einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
             bedarf_weitere, sk_vegetarisch, sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, \
             sk_saeugling_kleinkind, angelegt_von_id, verpflegungsart) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(&bezeichnung)
    .bind(&eingabe.von_at)
    .bind(&eingabe.bis_at)
    .bind(b.kraefte)
    .bind(b.betreute)
    .bind(b.weitere)
    .bind(sonderkost.vegetarisch)
    .bind(sonderkost.vegan)
    .bind(sonderkost.ohne_schwein)
    .bind(sonderkost.diaet_allergenarm)
    .bind(sonderkost.saeugling_kleinkind)
    .bind(benutzer_id)
    .bind(eingabe.verpflegungsart.map(|a| a.as_str()))
    .fetch_one(&mut *conn)
    .await?;
    if !stelle_ids.is_empty() {
        replace_zuordnung_tx(conn, einsatz_id, id, &stelle_ids).await?;
    }
    let inhalt = etb_text::angelegt(
        &bezeichnung,
        &zeitraum(&eingabe.von_at, &eingabe.bis_at, stil)?,
        &b,
        eingabe.verpflegungsart,
        &namen_von(&stellen, &stelle_ids),
    );
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
    })
}

/// Ergebnis „Tag aus der Vorlage anlegen“ (LLH-1058): die angelegten Zeitfenster in der
/// Reihenfolge der Anfrage, die übersprungenen Bezeichnungen (wie übergeben, getrimmt) und die
/// ETB-Einträge, je angelegtem Zeitfenster genau einer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagGeschrieben {
    pub angelegt: Vec<i64>,
    pub uebersprungen: Vec<String>,
    pub etb_ids: Vec<i64>,
}

/// Stellt einer Ablehnung das Zeitfenster voran, um das es geht: „„Abendessen“: …“, ohne
/// Bezeichnung „Zeitfenster 3: …“ (design.md D3). Der Statuscode bleibt.
pub fn label_error(nr: usize, bezeichnung: &str, e: AppError) -> AppError {
    let wer = match bezeichnung.trim() {
        "" => format!("Zeitfenster {}", nr + 1),
        b => format!("„{b}“"),
    };
    match e {
        AppError::Validation(m) => AppError::Validation(format!("{wer}: {m}")),
        AppError::UnprocessableEntity(m) => AppError::UnprocessableEntity(format!("{wer}: {m}")),
        AppError::Conflict(m) => AppError::Conflict(format!("{wer}: {m}")),
        andere => andere,
    }
}

/// Schlüssel für den Namensvergleich: getrimmt, ohne Groß- und Kleinschreibung. `to_lowercase`
/// faltet auch Umlaute; SQLites `lower()` nur ASCII (design.md D5).
fn name_key(bezeichnung: &str) -> String {
    bezeichnung.trim().to_lowercase()
}

/// Kürzester und längster Kalendertag in Stunden (Tage der Zeitumstellung).
const TAG_STUNDEN: std::ops::RangeInclusive<i64> = 23..=25;

/// Legt die Zeitfenster eines Tages aus der Vorlage an (LLH-1058, design.md D3, D5), alles oder
/// nichts in der offenen Transaktion. Die Zeiten hat der Client in der Anzeigezone gerechnet
/// (D4); der Server nimmt Zeitpunkte wie beim Einzelanlegen.
///
/// Prüfreihenfolge: erst die Feldfehler (400) ALLER Fenster und der Tagesgrenzen, dann der
/// Zusammenhang (422, vor jedem Schreiben): Tagesgrenzen 23 bis 25 Stunden auseinander, jeder
/// Beginn im Tag (`tag_von_at` ≤ `von_at` < `tag_bis_at`), jede Bezeichnung höchstens einmal,
/// je Fenster Zeitregel und Teilmenge. Danach wird ein Fenster übersprungen, dessen Bezeichnung
/// im Einsatz schon ein Zeitfenster trägt, das an diesem Tag beginnt; die übrigen entstehen über
/// [`create_zeitfenster_tx`], also mit denselben Prüfungen und demselben ETB-Eintrag wie
/// einzeln. Eine Ablehnung nennt das Fenster ([`label_error`]).
#[allow(clippy::too_many_arguments)]
pub async fn zeitfenster_aus_vorlage_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    startwert: i64,
    stil: Zeitstil,
    tag_von_at: &str,
    tag_bis_at: &str,
    fenster: &[ZeitfensterEingabe],
) -> Result<TagGeschrieben, AppError> {
    // 400 — die Anfrage und jedes Feld für sich, für alle Fenster vor dem ersten 422
    let tag_von = draht_lesen("tag_von_at", tag_von_at)?;
    let tag_bis = draht_lesen("tag_bis_at", tag_bis_at)?;
    if fenster.is_empty() {
        return Err(AppError::Validation(
            "zeitfenster darf nicht leer sein".into(),
        ));
    }
    if fenster.len() > super::AUS_VORLAGE_MAX {
        return Err(AppError::Validation(format!(
            "zeitfenster darf höchstens {} Einträge haben, waren {}",
            super::AUS_VORLAGE_MAX,
            fenster.len()
        )));
    }
    let felder = fenster
        .iter()
        .enumerate()
        .map(|(i, e)| check_zeitfenster_felder(e).map_err(|f| label_error(i, &e.bezeichnung, f)))
        .collect::<Result<Vec<_>, _>>()?;

    // 422 — der Zusammenhang, vor jedem Schreiben
    let minuten = (tag_bis - tag_von).num_minutes();
    if !(TAG_STUNDEN.start() * 60..=TAG_STUNDEN.end() * 60).contains(&minuten) {
        return Err(AppError::UnprocessableEntity(format!(
            "Ein Tag dauert 23 bis 25 Stunden; von {tag_von_at} bis {tag_bis_at} passt nicht"
        )));
    }
    let mut gesehen = std::collections::HashSet::new();
    for (i, (e, f)) in fenster.iter().zip(&felder).enumerate() {
        let beginn = draht_lesen("von_at", &e.von_at)?;
        let mut check = || {
            if beginn < tag_von || beginn >= tag_bis {
                return Err(AppError::UnprocessableEntity(format!(
                    "Der Beginn ({}) liegt nicht im Tag ({tag_von_at} bis {tag_bis_at})",
                    e.von_at
                )));
            }
            if !gesehen.insert(name_key(&f.bezeichnung)) {
                return Err(AppError::UnprocessableEntity(
                    "Die Bezeichnung kommt in der Anfrage mehrfach vor".into(),
                ));
            }
            check_zeitfenster_zusammenhang(e, f)
        };
        check().map_err(|m| label_error(i, &e.bezeichnung, m))?;
    }

    // Überspringen (D5): Bezeichnungen der Zeitfenster, die an diesem Tag beginnen. Die
    // Zeitpunkte liegen im Drahtformat vor, als Text sortiert das richtig.
    let vorhanden: std::collections::HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT bezeichnung FROM verpflegung_zeitfenster \
         WHERE einsatz_id = ? AND von_at >= ? AND von_at < ?",
    )
    .bind(einsatz_id)
    .bind(crate::zeit::formatiere_utc(tag_von))
    .bind(crate::zeit::formatiere_utc(tag_bis))
    .fetch_all(&mut *conn)
    .await?
    .iter()
    .map(|b| name_key(b))
    .collect();

    let mut g = TagGeschrieben {
        angelegt: Vec::new(),
        uebersprungen: Vec::new(),
        etb_ids: Vec::new(),
    };
    for (i, (e, f)) in fenster.iter().zip(&felder).enumerate() {
        if vorhanden.contains(&name_key(&f.bezeichnung)) {
            g.uebersprungen.push(f.bezeichnung.clone());
            continue;
        }
        let neu = create_zeitfenster_tx(conn, einsatz_id, benutzer_id, startwert, stil, e)
            .await
            .map_err(|m| label_error(i, &e.bezeichnung, m))?;
        g.angelegt.push(neu.id);
        g.etb_ids.extend(neu.etb_ids);
    }
    Ok(g)
}

/// Ändert ein Zeitfenster. Geprüft wird gegen den **Effektivzustand** aus Bestand und
/// Änderung — sonst unterliefe eine Teiländerung (nur der Bedarf, nur das Ende) die
/// Teilmengen- bzw. Zeitregel. Ändert sich kein Wert, läuft weder UPDATE noch ETB
/// (Leerlauf-Riegel) und `etb_ids` bleibt leer.
///
/// Optimistisches Lock (LLH-1414, Muster `tier::repo::aktualisiere`): trägt die Änderung
/// `basis_geaendert_at`, muss er dem Stand der Zeile gleichen (`geaendert_at`, ohne Änderung
/// `angelegt_at`), sonst 409 nach den 400ern und vor jedem 422 — die Regeln des Zusammenhangs
/// prüfen gegen einen Stand, den der Aufrufer nicht gesehen hat. Gelesen und geschrieben wird in
/// derselben Schreibtransaktion.
pub async fn update_zeitfenster_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    stil: Zeitstil,
    a: &ZeitfensterAenderung,
) -> Result<Geschrieben, AppError> {
    // 400 vor jeder Abfrage: die Stellenliste (D5), gezählt vor dem Entdoppeln.
    let stelle_ids = a.stelle_ids.as_deref().map(dedupe_stelle_ids).transpose()?;
    let roh = zeitfenster_roh_tx(conn, einsatz_id, id).await?;

    // 400 — jedes übergebene Feld für sich
    let bezeichnung = match &a.bezeichnung {
        Some(b) => pflicht_max(b, "bezeichnung", super::ZEITFENSTER_BEZEICHNUNG_MAX)?,
        None => roh.bezeichnung.clone(),
    };
    let von_at = a.von_at.clone().unwrap_or_else(|| roh.von_at.clone());
    let bis_at = a.bis_at.clone().unwrap_or_else(|| roh.bis_at.clone());
    draht_lesen("von_at", &von_at)?;
    draht_lesen("bis_at", &bis_at)?;
    let kraefte = a.bedarf_kraefte.unwrap_or(roh.bedarf_kraefte);
    let betreute = a.bedarf_betreute.unwrap_or(roh.bedarf_betreute);
    let weitere = a.bedarf_weitere.unwrap_or(roh.bedarf_weitere);
    anzahl_pruefen("bedarf_kraefte", kraefte)?;
    anzahl_pruefen("bedarf_betreute", betreute)?;
    anzahl_pruefen("bedarf_weitere", weitere)?;
    let vorher = roh.bedarf();
    let sonderkost = a.sonderkost.ueber(&vorher.sonderkost);
    sonderkost.pruefen()?;
    let neu = bedarf(kraefte, betreute, weitere, sonderkost);

    // 409 — veralteter Stand (LLH-1414)
    if let Some(basis) = &a.basis_geaendert_at {
        let stand = roh.geaendert_at.as_deref().unwrap_or(&roh.angelegt_at);
        if basis != stand {
            return Err(AppError::Conflict(
                "Das Zeitfenster wurde zwischenzeitlich geändert. Bitte neu laden.".into(),
            ));
        }
    }

    // 422 — der Zusammenhang im Effektivzustand
    zeitregel(&von_at, &bis_at)?;
    teilmenge(&sonderkost, neu.gesamt, "den Gesamtbedarf")?;
    // Stellen (D5): feste Zahl von Anweisungen, gleich wie viele — die bisherige Zuordnung, die
    // Stellen von jetzt und vorher in EINER Abfrage, später Löschen und Einfügen.
    let zuordnung = match &stelle_ids {
        Some(neu_ids) => {
            let vorher_ids = zuordnung_tx(conn, id).await?;
            let mut alle = neu_ids.clone();
            alle.extend(vorher_ids.iter().filter(|v| !neu_ids.contains(v)));
            let stellen = stellen_kurz_tx(conn, einsatz_id, &alle).await?;
            check_zuordnung(neu_ids, &vorher_ids, &stellen)?;
            Some((neu_ids, vorher_ids, stellen))
        }
        None => None,
    };
    let art_alt = roh.art();
    let art_neu = a.verpflegungsart.unwrap_or(art_alt);

    let zeitraum_neu = zeitraum(&von_at, &bis_at, stil)?;
    let zeitraum_alt = zeitraum(&roh.von_at, &roh.bis_at, stil)?;
    let zeitraum_geaendert = von_at != roh.von_at || bis_at != roh.bis_at;
    let aenderungen = etb_text::Aenderungen {
        bezeichnung_vorher: (bezeichnung != roh.bezeichnung).then_some(roh.bezeichnung.as_str()),
        // Auch wenn der Text gleich bliebe (Sekunden), ist es eine Änderung der Zeitpunkte.
        zeitraum_vorher: zeitraum_geaendert.then_some(zeitraum_alt.as_str()),
        gesamt_vorher: (neu.gesamt != vorher.gesamt).then_some(vorher.gesamt),
        aufteilung: neu.gesamt == vorher.gesamt
            && (neu.kraefte, neu.betreute, neu.weitere)
                != (vorher.kraefte, vorher.betreute, vorher.weitere),
        sonderkost_vorher: (neu.sonderkost != vorher.sonderkost)
            .then_some(vorher.sonderkost.summe()),
        art: (art_neu != art_alt).then_some((art_neu, art_alt)),
        stellen: None,
    };
    // Gleiche Menge in anderer Reihenfolge ist keine Änderung (Leerlauf-Riegel).
    let stellen_namen = zuordnung
        .as_ref()
        .and_then(|(neu_ids, vorher_ids, stellen)| {
            let mut n = neu_ids.to_vec();
            let mut v = vorher_ids.clone();
            n.sort_unstable();
            v.sort_unstable();
            (n != v).then(|| (namen_von(stellen, neu_ids), namen_von(stellen, vorher_ids)))
        });
    let aenderungen = etb_text::Aenderungen {
        stellen: stellen_namen
            .as_ref()
            .map(|(jetzt, vorher)| (jetzt.as_slice(), vorher.as_slice())),
        ..aenderungen
    };
    if aenderungen.leer() {
        return Ok(Geschrieben {
            id,
            etb_ids: Vec::new(),
        });
    }

    sqlx::query(
        "UPDATE verpflegung_zeitfenster SET bezeichnung = ?, von_at = ?, bis_at = ?, \
            bedarf_kraefte = ?, bedarf_betreute = ?, bedarf_weitere = ?, sk_vegetarisch = ?, \
            sk_vegan = ?, sk_ohne_schwein = ?, sk_diaet_allergenarm = ?, \
            sk_saeugling_kleinkind = ?, verpflegungsart = ?, geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(&bezeichnung)
    .bind(&von_at)
    .bind(&bis_at)
    .bind(neu.kraefte)
    .bind(neu.betreute)
    .bind(neu.weitere)
    .bind(sonderkost.vegetarisch)
    .bind(sonderkost.vegan)
    .bind(sonderkost.ohne_schwein)
    .bind(sonderkost.diaet_allergenarm)
    .bind(sonderkost.saeugling_kleinkind)
    .bind(art_neu.map(|a| a.as_str()))
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    if aenderungen.stellen.is_some() {
        if let Some((neu_ids, _, _)) = &zuordnung {
            replace_zuordnung_tx(conn, einsatz_id, id, neu_ids).await?;
        }
    }
    let inhalt = etb_text::geaendert(&bezeichnung, &zeitraum_neu, &neu, &aenderungen);
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
    })
}

/// Löscht ein Zeitfenster samt zurückgenommener Ausgaben (CASCADE). Solange eine gültige
/// Ausgabe daran hängt, ist das 422: sie wäre sonst still aus der Bilanz verschwunden.
pub async fn delete_zeitfenster_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    stil: Zeitstil,
) -> Result<Geschrieben, AppError> {
    let roh = zeitfenster_roh_tx(conn, einsatz_id, id).await?;
    let gueltig: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM verpflegung_ausgabe \
         WHERE zeitfenster_id = ? AND zurueckgenommen_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if gueltig > 0 {
        return Err(AppError::UnprocessableEntity(format!(
            "Verpflegung ‚{}‘ hat {gueltig} gültige Ausgabe(n) — erst zurücknehmen, dann löschen",
            roh.bezeichnung
        )));
    }
    let inhalt = etb_text::geloescht(
        &roh.bezeichnung,
        &zeitraum(&roh.von_at, &roh.bis_at, stil)?,
        &roh.bedarf(),
    );
    sqlx::query("DELETE FROM verpflegung_zeitfenster WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
    })
}

// ── Ausgaben ────────────────────────────────────────────────────────────────────────────────

/// Erfasst eine Ausgabe gegen ein Zeitfenster. Kein ETB-Eintrag (design.md D5). Der Zeitpunkt
/// darf außerhalb des Zeitfensters liegen (Anlieferung vor Beginn).
pub async fn ausgabe_erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    zeitfenster_id: i64,
    benutzer_id: i64,
    eingabe: &AusgabeEingabe,
) -> Result<AusgabeGeschrieben, AppError> {
    // Replay vor jeder Prüfung (LFH-688, design.md D2): unter `BEGIN IMMEDIATE` ist der Lookup
    // gegen das INSERT unten nicht verschränkbar — zwei gleichzeitige Flushes desselben
    // Schlüssels ergeben eine Zeile.
    if let Some(cid) = eingabe.client_id.as_deref() {
        if let Some(replay) = laden_nach_client_id(&mut *conn, einsatz_id, cid).await? {
            return replay_am_zeitfenster(replay, zeitfenster_id);
        }
    }
    zeitfenster_roh_tx(conn, einsatz_id, zeitfenster_id).await?;
    // 400 — jedes Feld für sich
    draht_lesen("zeitpunkt_at", &eingabe.zeitpunkt_at)?;
    if eingabe.menge <= 0 {
        return Err(AppError::Validation(format!(
            "menge muss größer als 0 sein, war {}",
            eingabe.menge
        )));
    }
    anzahl_pruefen("menge", eingabe.menge)?;
    let sonderkost = eingabe.sonderkost.ueber(&Sonderkost::default());
    sonderkost.pruefen()?;
    // 422 — der Zusammenhang
    teilmenge(&sonderkost, eingabe.menge, "die Menge")?;
    let empfaenger = [
        eingabe.einheit_id,
        eingabe.abschnitt_id,
        eingabe.betreuungsstelle_id,
    ];
    if empfaenger.iter().flatten().count() > 1 {
        return Err(AppError::UnprocessableEntity(
            "Eine Ausgabe hat höchstens einen Empfänger".into(),
        ));
    }
    // Die Stelle (D3), nach Replay, Zeitfenster, den 400ern und den 422ern; dahinter der
    // Empfänger (LLH-1055 D2).
    if let Some(sid) = eingabe.verpflegungsstelle_id {
        check_stelle_fuer_ausgabe_tx(conn, einsatz_id, sid, &eingabe.zeitpunkt_at).await?;
    }
    if let Some(eid) = eingabe.einheit_id {
        check_einheit_fuer_ausgabe_tx(conn, einsatz_id, eid, &eingabe.zeitpunkt_at).await?;
    }
    if let Some(aid) = eingabe.abschnitt_id {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, aid).await?;
    }
    if let Some(bid) = eingabe.betreuungsstelle_id {
        check_betreuungsstelle_fuer_ausgabe_tx(conn, einsatz_id, bid).await?;
    }

    let ausgabe_id: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegung_ausgabe \
            (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, ort, bemerkung, sk_vegetarisch, \
             sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, sk_saeugling_kleinkind, \
             nachforderung_id, erfasst_von_id, client_id, verpflegungsstelle_id, einheit_id, \
             abschnitt_id, betreuungsstelle_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(zeitfenster_id)
    .bind(&eingabe.zeitpunkt_at)
    .bind(eingabe.menge)
    .bind(text_opt(eingabe.ort.as_deref()))
    .bind(text_opt(eingabe.bemerkung.as_deref()))
    .bind(sonderkost.vegetarisch)
    .bind(sonderkost.vegan)
    .bind(sonderkost.ohne_schwein)
    .bind(sonderkost.diaet_allergenarm)
    .bind(sonderkost.saeugling_kleinkind)
    .bind(eingabe.nachforderung_id)
    .bind(benutzer_id)
    .bind(eingabe.client_id.as_deref())
    .bind(eingabe.verpflegungsstelle_id)
    .bind(eingabe.einheit_id)
    .bind(eingabe.abschnitt_id)
    .bind(eingabe.betreuungsstelle_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(AusgabeGeschrieben {
        ausgabe_id,
        zeitfenster_id,
        neu: true,
    })
}

/// Prüft die Stelle einer neuen Ausgabe (D3) — in der Transaktion, gegen ein gleichzeitiges
/// Auflösen. Fremd, unbekannt oder storniert: 422 (ein nicht zuordenbarer Verweis im Body; die
/// stornierte Stelle zählt als nicht vorhanden). Aufgelöst: 409, außer der Zeitpunkt der Ausgabe
/// liegt vor der Auflösung — eine offline vorgemerkte oder nachgetragene Zählung vom Tresen kommt
/// so noch an. Verglichen werden die GEPARSTEN Zeitpunkte, nicht die Texte. `geplant` nimmt an
/// (ein vergessener Klick blockiert den Tresen nicht), ebenso eine dem Zeitfenster nicht
/// zugeordnete Stelle (die Zuordnung ist Planung, die Ausgabe eine Tatsache).
async fn check_stelle_fuer_ausgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    zeitpunkt_at: &str,
) -> Result<(), AppError> {
    let stelle = sqlx::query_as::<_, StelleZeile>(concat!(
        stelle_select!(),
        "WHERE einsatz_id = ? AND id = ?"
    ))
    .bind(einsatz_id)
    .bind(stelle_id)
    .fetch_optional(&mut *conn)
    .await?
    .filter(|s| s.storniert_at.is_none())
    .ok_or_else(|| {
        AppError::UnprocessableEntity(format!(
            "Verpflegungsstelle {stelle_id} gibt es in diesem Einsatz nicht"
        ))
    })?;
    if let Some(aufgeloest_at) = stelle.aufgeloest_at.as_deref() {
        let aufgeloest = draht_lesen("aufgeloest_at", aufgeloest_at)?;
        if draht_lesen("zeitpunkt_at", zeitpunkt_at)? >= aufgeloest {
            return Err(AppError::Conflict(format!(
                "Verpflegungsstelle ‚{}‘ ist aufgelöst",
                stelle.bezeichnung
            )));
        }
    }
    Ok(())
}

/// Prüft die Empfänger-Einheit einer neuen Ausgabe (LLH-1055, design.md D2) — in der
/// Transaktion, gegen ein gleichzeitiges Auflösen. Fremd oder unbekannt (auch gelöscht): 404, wie
/// die fremde Nachforderung im selben Handler; beide Fälle sind ununterscheidbar. Aufgelöst: 409
/// (Lebenszyklus), außer der Zeitpunkt der Ausgabe liegt vor der Auflösung — eine offline gezählte
/// oder nachgetragene Abholung scheitert so nicht am späteren Auflösen. Verglichen werden die
/// GEPARSTEN Zeitpunkte. Deshalb nicht `einheit::repo::require_aktiv_tx`, das jede aufgelöste
/// Einheit ablehnt. Stärke 0 und fehlendes Eintreffen nehmen an.
async fn check_einheit_fuer_ausgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    zeitpunkt_at: &str,
) -> Result<(), AppError> {
    let (name, aufgeloest_at): (String, Option<String>) = sqlx::query_as(
        "SELECT name, aufgeloest_at FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if let Some(aufgeloest_at) = aufgeloest_at.as_deref() {
        let aufgeloest = draht_lesen("aufgeloest_at", aufgeloest_at)?;
        if draht_lesen("zeitpunkt_at", zeitpunkt_at)? >= aufgeloest {
            return Err(AppError::Conflict(format!(
                "Die Einheit ‚{name}‘ ist aufgelöst"
            )));
        }
    }
    Ok(())
}

/// Prüft die Empfänger-Betreuungsstelle einer neuen Ausgabe (LLH-1295, design.md D2) — in der
/// Transaktion, gegen einen gleichzeitigen Storno. Fremd, unbekannt oder storniert: 404, wie
/// Einheit und Abschnitt im selben Handler; die stornierte Stelle steht in keiner Liste und gilt
/// als nicht vorhanden. Jeder andere Status nimmt an, auch geschlossen: es gibt keinen
/// Schließ-Zeitpunkt zum Vergleich, und ein Nachtrag oder eine offline gezählte Ausgabe darf nicht
/// am Schließen scheitern.
async fn check_betreuungsstelle_fuer_ausgabe_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<(), AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT id FROM betreuungsstelle \
         WHERE id = ? AND einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(stelle_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(())
}

/// Löst beim Storno einer Betreuungsstelle den Bezug ihrer Ausgaben (LLH-1295, design.md D5), im
/// Vorgang des Stornos (`betreuung::repo::stelle_stornieren_tx`). Die Ausgaben bleiben mit Menge
/// und Zeitpunkt stehen und zählen weiter, nur ohne Empfänger. Liefert die Kennungen der
/// betroffenen Ausgaben.
pub async fn loese_betreuungsstelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    betreuungsstelle_id: i64,
) -> Result<Vec<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "UPDATE verpflegung_ausgabe SET betreuungsstelle_id = NULL \
         WHERE einsatz_id = ? AND betreuungsstelle_id = ? RETURNING id",
    )
    .bind(einsatz_id)
    .bind(betreuungsstelle_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Die gespeicherte Ausgabe mit dieser `client_id` im Einsatz, als Replay (`neu: false`).
/// Einsatzgebunden: dieselbe `client_id` in einem anderen Einsatz findet nichts und legt dort
/// nichts offen. Läuft auf dem Pool (Vorab-Lookup der Route) wie in der Transaktion.
pub async fn laden_nach_client_id<'e, E: sqlx::SqliteExecutor<'e>>(
    ex: E,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<AusgabeGeschrieben>, AppError> {
    let treffer: Option<(i64, i64)> = sqlx::query_as(
        "SELECT id, zeitfenster_id FROM verpflegung_ausgabe \
         WHERE einsatz_id = ? AND client_id = ?",
    )
    .bind(einsatz_id)
    .bind(client_id)
    .fetch_optional(ex)
    .await?;
    Ok(
        treffer.map(|(ausgabe_id, zeitfenster_id)| AusgabeGeschrieben {
            ausgabe_id,
            zeitfenster_id,
            neu: false,
        }),
    )
}

/// Ein Replay gilt nur für das Zeitfenster, an dem die Ausgabe gespeichert ist. Ein Schlüssel
/// an einem anderen Zeitfenster ist 422 (design.md D3): jedes Feld ist für sich gültig, erst der
/// gespeicherte Zusammenhang verbietet die Aktion. Die fremde Ausgabe zurückzugeben behauptete
/// die Deckung eines Zeitfensters, das der Client nicht adressiert hat.
pub fn replay_am_zeitfenster(
    replay: AusgabeGeschrieben,
    zeitfenster_id: i64,
) -> Result<AusgabeGeschrieben, AppError> {
    if replay.zeitfenster_id == zeitfenster_id {
        Ok(replay)
    } else {
        Err(AppError::UnprocessableEntity(
            "client_id gehört zu einer Ausgabe an einem anderen Zeitfenster".into(),
        ))
    }
}

/// Für ein an die Stelle `stelle_id` gebundenes Gerät (LLH-1048): das Zeitfenster gibt es nur,
/// wenn es der Stelle zugeordnet oder einsatzweit (ohne Zuordnung) ist; sonst, und für ein
/// fremdes oder unbekanntes Zeitfenster, 404. In der Transaktion, nach dem Replay.
pub async fn check_zeitfenster_an_stelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    zeitfenster_id: i64,
    stelle_id: i64,
) -> Result<(), AppError> {
    let gilt: Option<bool> = sqlx::query_scalar(
        "SELECT NOT EXISTS (SELECT 1 FROM verpflegung_zeitfenster_stelle zs \
                            WHERE zs.zeitfenster_id = z.id) \
             OR EXISTS (SELECT 1 FROM verpflegung_zeitfenster_stelle zs \
                        WHERE zs.zeitfenster_id = z.id AND zs.stelle_id = ?) \
         FROM verpflegung_zeitfenster z WHERE z.id = ? AND z.einsatz_id = ?",
    )
    .bind(stelle_id)
    .bind(zeitfenster_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    match gilt {
        Some(true) => Ok(()),
        _ => Err(AppError::NotFound),
    }
}

/// Für ein an die Stelle `stelle_id` gebundenes Gerät (LLH-1048): eine Ausgabe gibt es nur, wenn
/// sie an dieser Stelle gebucht ist; sonst, und für eine fremde oder unbekannte, 404.
pub async fn check_ausgabe_an_stelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ausgabe_id: i64,
    stelle_id: i64,
) -> Result<(), AppError> {
    let da: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM verpflegung_ausgabe \
         WHERE id = ? AND einsatz_id = ? AND verpflegungsstelle_id = ?",
    )
    .bind(ausgabe_id)
    .bind(einsatz_id)
    .bind(stelle_id)
    .fetch_optional(&mut *conn)
    .await?;
    da.map(|_| ()).ok_or(AppError::NotFound)
}

/// Nimmt eine Ausgabe zurück. Die Zeile bleibt stehen (append-only) und zählt nicht mehr in die
/// Deckung. Eine zweite Rücknahme ist 422. Kein ETB-Eintrag (design.md D5).
pub async fn ausgabe_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ausgabe_id: i64,
    benutzer_id: i64,
) -> Result<AusgabeGeschrieben, AppError> {
    let (zeitfenster_id, zurueckgenommen_at): (i64, Option<String>) = sqlx::query_as(
        "SELECT zeitfenster_id, zurueckgenommen_at FROM verpflegung_ausgabe \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(ausgabe_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if zurueckgenommen_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Die Ausgabe ist bereits zurückgenommen".into(),
        ));
    }
    sqlx::query(
        "UPDATE verpflegung_ausgabe SET zurueckgenommen_at = datetime('now'), \
            zurueckgenommen_von_id = ? WHERE id = ?",
    )
    .bind(benutzer_id)
    .bind(ausgabe_id)
    .execute(&mut *conn)
    .await?;
    Ok(AusgabeGeschrieben {
        ausgabe_id,
        zeitfenster_id,
        neu: true,
    })
}

// ── Verpflegungsstellen (LLH-1040, design.md D1, D2) ────────────────────────────────────────

/// Lädt eine Stelle des Einsatzes, auch eine stornierte. Fremd oder unbekannt → 404.
async fn stelle_roh_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<StelleZeile, AppError> {
    sqlx::query_as::<_, StelleZeile>(concat!(stelle_select!(), "WHERE einsatz_id = ? AND id = ?"))
        .bind(einsatz_id)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
}

/// Eine stornierte Stelle ist für Ändern, Statuswechsel und Storno 409 (Lebenszyklus, wie der
/// BR in `routes/einsatz_bereitstellungsraum.rs`). Eine aufgelöste bleibt änderbar (D2).
fn check_stelle_nicht_storniert(roh: &StelleZeile) -> Result<(), AppError> {
    match roh.storniert_at {
        Some(_) => Err(AppError::Conflict(format!(
            "Verpflegungsstelle ‚{}‘ ist storniert",
            roh.bezeichnung
        ))),
        None => Ok(()),
    }
}

/// Die getrimmte Bezeichnung ist unter den nicht stornierten Stellen des Einsatzes eindeutig
/// (409 vor dem Netz des partiellen UNIQUE-Index, Muster `betreuung::repo`). `ausser_id` ist die
/// Stelle selbst beim Umbenennen.
async fn check_stelle_bezeichnung_frei_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bezeichnung: &str,
    ausser_id: Option<i64>,
) -> Result<(), AppError> {
    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM verpflegungsstelle WHERE einsatz_id = ? AND bezeichnung = ? \
         AND storniert_at IS NULL AND id IS NOT ?",
    )
    .bind(einsatz_id)
    .bind(bezeichnung)
    .bind(ausser_id)
    .fetch_optional(&mut *conn)
    .await?;
    match belegt {
        None => Ok(()),
        Some(_) => Err(AppError::Conflict(format!(
            "Eine Verpflegungsstelle ‚{bezeichnung}‘ gibt es in diesem Einsatz bereits"
        ))),
    }
}

/// Was die Gerätekopplung von einer Stelle braucht (LLH-1048): Bezeichnung für den Anzeigenamen
/// des Geräts, Status und ob sie storniert ist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StelleZustand {
    pub bezeichnung: String,
    pub status: VerpflegungsstelleStatus,
    pub storniert: bool,
}

/// Lädt den Zustand einer Stelle des Einsatzes, auch einer stornierten. Fremd oder unbekannt →
/// 404.
pub async fn load_stelle_zustand(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<StelleZustand, AppError> {
    let mut conn = pool.acquire().await?;
    let roh = stelle_roh_tx(&mut conn, einsatz_id, id).await?;
    Ok(StelleZustand {
        storniert: roh.storniert_at.is_some(),
        bezeichnung: roh.bezeichnung,
        status: roh.status,
    })
}

/// Die Stelle als Anzeige (Antwort der Schreibrouten). Fremd oder unbekannt → 404.
pub async fn load_stelle(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<VerpflegungsstelleAnzeige, AppError> {
    let mut conn = pool.acquire().await?;
    Ok(stelle_roh_tx(&mut conn, einsatz_id, id).await?.anzeige())
}

/// Legt eine Stelle im Status `geplant` an. Kein ETB-Eintrag (D2: erst die Inbetriebnahme ist
/// lagerelevant). Reihenfolge: 400 (Felder) → 422 (Koordinate) → 404 (Abschnitt) → 409
/// (Bezeichnung vergeben).
pub async fn create_stelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    eingabe: &StelleEingabe,
) -> Result<StelleGeschrieben, AppError> {
    let bezeichnung = pflicht_max(
        &eingabe.bezeichnung,
        "bezeichnung",
        super::STELLE_BEZEICHNUNG_MAX,
    )?;
    let standort = optional_max(eingabe.standort.clone(), "standort", super::STANDORT_MAX)?;
    pruefe_koordinate(eingabe.lat, eingabe.lon, "lat", "lon")?;
    if let Some(abschnitt_id) = eingabe.abschnitt_id {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, abschnitt_id)
            .await?;
    }
    check_stelle_bezeichnung_frei_tx(conn, einsatz_id, &bezeichnung, None).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegungsstelle \
            (einsatz_id, bezeichnung, art, standort, lat, lon, abschnitt_id, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(&bezeichnung)
    .bind(eingabe.art.as_str())
    .bind(&standort)
    .bind(eingabe.lat)
    .bind(eingabe.lon)
    .bind(eingabe.abschnitt_id)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(StelleGeschrieben {
        id,
        geaendert: true,
        etb_ids: Vec::new(),
    })
}

/// Ändert eine Stelle, auch eine aufgelöste (Bezeichnung und Standort korrigieren,
/// `entscheidungen.md`, Entscheider-Agent 15.10.). Kein ETB-Eintrag. Die Koordinate wird im
/// Effektivzustand dieser Transaktion geprüft (Paar, 422). Ohne neuen Wert läuft kein UPDATE
/// (`geaendert: false`, kein Live-Ereignis).
pub async fn update_stelle_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    a: &StelleAenderung,
) -> Result<StelleGeschrieben, AppError> {
    let roh = stelle_roh_tx(conn, einsatz_id, id).await?;
    check_stelle_nicht_storniert(&roh)?;
    // 400 — jedes übergebene Feld für sich
    let bezeichnung = pflicht_max_tri(
        a.bezeichnung.as_deref(),
        "bezeichnung",
        super::STELLE_BEZEICHNUNG_MAX,
    )?
    .unwrap_or_else(|| roh.bezeichnung.clone());
    let standort = optional_max_tri(a.standort.clone(), "standort", super::STANDORT_MAX)?
        .unwrap_or_else(|| roh.standort.clone());
    let art = a.art.unwrap_or(roh.art);
    let lat = a.lat.unwrap_or(roh.lat);
    let lon = a.lon.unwrap_or(roh.lon);
    let abschnitt_id = a.abschnitt_id.unwrap_or(roh.abschnitt_id);
    // 422 — die Koordinate als Paar im Effektivzustand
    pruefe_koordinate(lat, lon, "lat", "lon")?;
    let bezeichnung_neu = bezeichnung != roh.bezeichnung;
    let abschnitt_neu = abschnitt_id != roh.abschnitt_id;
    if !bezeichnung_neu
        && !abschnitt_neu
        && art == roh.art
        && standort == roh.standort
        && lat == roh.lat
        && lon == roh.lon
    {
        return Ok(StelleGeschrieben {
            id,
            geaendert: false,
            etb_ids: Vec::new(),
        });
    }
    if let (true, Some(abschnitt)) = (abschnitt_neu, abschnitt_id) {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, abschnitt).await?;
    }
    if bezeichnung_neu {
        check_stelle_bezeichnung_frei_tx(conn, einsatz_id, &bezeichnung, Some(id)).await?;
    }
    sqlx::query(
        "UPDATE verpflegungsstelle SET bezeichnung = ?, art = ?, standort = ?, lat = ?, \
            lon = ?, abschnitt_id = ?, geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(&bezeichnung)
    .bind(art.as_str())
    .bind(&standort)
    .bind(lat)
    .bind(lon)
    .bind(abschnitt_id)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(StelleGeschrieben {
        id,
        geaendert: true,
        etb_ids: Vec::new(),
    })
}

/// Statuswechsel einer Stelle (D2): stornierte Stelle 409, unzulässiger Übergang 422.
/// `→ aufgeloest` setzt `aufgeloest_at` auf die Serveruhr. `→ aktiv` und `→ aufgeloest` schreiben
/// je einen System-Eintrag im ETB in derselben Transaktion.
pub async fn update_stelle_status_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    nach: VerpflegungsstelleStatus,
) -> Result<StelleGeschrieben, AppError> {
    let roh = stelle_roh_tx(conn, einsatz_id, id).await?;
    check_stelle_nicht_storniert(&roh)?;
    if !darf_uebergehen(roh.status, nach) {
        return Err(AppError::UnprocessableEntity(format!(
            "Verpflegungsstelle ‚{}‘: Übergang {} → {} ist nicht zulässig",
            roh.bezeichnung,
            roh.status.as_str(),
            nach.as_str()
        )));
    }
    sqlx::query(
        "UPDATE verpflegungsstelle SET status = ?, \
            aufgeloest_at = CASE WHEN ? = 'aufgeloest' THEN datetime('now') ELSE aufgeloest_at END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(nach.as_str())
    .bind(nach.as_str())
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    let mut etb_ids = Vec::new();
    if let Some(inhalt) = etb_text::stelle_status(&roh.bezeichnung, roh.art, nach) {
        etb_ids.push(
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?,
        );
    }
    Ok(StelleGeschrieben {
        id,
        geaendert: true,
        etb_ids,
    })
}

/// Storniert eine Stelle (Fehlanlage, D2): nur `geplant` und nur, solange keine Ausgabe — auch
/// keine zurückgenommene — auf sie verweist, sonst 422. Hängt eine laufende Gerätekopplung an ihr
/// (LLH-1048 Teil II, wartend oder aktiv), ist das Storno 409 „Gerät gekoppelt“: das Gerät sähe
/// danach nur die einsatzweiten Zeitfenster, und jede Buchung wäre 422. Die Kopplung ist ein
/// Zustand der Stelle wie die stornierte (409), kein Fehler im Body; erst widerrufen oder ablaufen
/// lassen. Entfernt die Zuordnungen in derselben Transaktion und schreibt kein ETB. So zeigt nie eine Ausgabe auf eine stornierte Stelle, und
/// kein „in Betrieb genommen“ bleibt ohne Gegenstück.
pub async fn stelle_stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
) -> Result<StelleGeschrieben, AppError> {
    let roh = stelle_roh_tx(conn, einsatz_id, id).await?;
    check_stelle_nicht_storniert(&roh)?;
    match roh.status {
        VerpflegungsstelleStatus::Geplant => {}
        VerpflegungsstelleStatus::Aktiv => {
            return Err(AppError::UnprocessableEntity(
                "In Betrieb genommene Stelle auflösen statt stornieren".into(),
            ))
        }
        VerpflegungsstelleStatus::Aufgeloest => {
            return Err(AppError::UnprocessableEntity(
                "Eine aufgelöste Stelle lässt sich nicht stornieren".into(),
            ))
        }
    }
    let ausgaben: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM verpflegung_ausgabe WHERE verpflegungsstelle_id = ?",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await?;
    if ausgaben > 0 {
        return Err(AppError::UnprocessableEntity(format!(
            "An der Stelle hängen Ausgaben ({ausgaben}) — auflösen statt stornieren"
        )));
    }
    if roh.geraet_gekoppelt {
        return Err(AppError::Conflict(
            "Gerät gekoppelt — erst die Kopplung widerrufen".into(),
        ));
    }
    sqlx::query("DELETE FROM verpflegung_zeitfenster_stelle WHERE stelle_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "UPDATE verpflegungsstelle SET storniert_at = datetime('now'), storniert_von_id = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(benutzer_id)
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(StelleGeschrieben {
        id,
        geaendert: true,
        etb_ids: Vec::new(),
    })
}

#[cfg(test)]
mod tests;

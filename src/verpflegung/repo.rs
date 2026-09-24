//! Persistenz des Fachmoduls Verpflegung (LFH-634).
//!
//! **Die Schreibpfade laufen auf einer offenen Transaktion** (`_tx`, `&mut SqliteConnection`).
//! Der Aufrufer (Route) öffnet sie mit `write_retry!` (BEGIN IMMEDIATE), lädt ETB-`startwert`
//! und Org-Zeitzone vorher und publiziert nach dem Commit — die Rückgabe trägt dafür die
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

use std::collections::HashMap;

use chrono_tz::Tz;
use sqlx::{SqliteConnection, SqlitePool};

use super::{
    deckung, draht_lesen, etb_text, zeitraum_text, AusgabeAnzeige, Bedarf, Sonderkost,
    SonderkostEingabe, VerpflegungAnzeige, ZeitfensterAnzeige,
};
use crate::error::AppError;

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
}

// ── Zeilen ──────────────────────────────────────────────────────────────────────────────────

macro_rules! zeitfenster_select {
    () => {
        "SELECT id, einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
                bedarf_weitere, sk_vegetarisch, sk_vegan, sk_ohne_schwein, \
                sk_diaet_allergenarm, sk_saeugling_kleinkind, angelegt_at, geaendert_at \
         FROM verpflegung_zeitfenster "
    };
}

macro_rules! ausgabe_select {
    () => {
        "SELECT id, zeitfenster_id, zeitpunkt_at, menge, ort, bemerkung, sk_vegetarisch, \
                sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, sk_saeugling_kleinkind, \
                nachforderung_id, zurueckgenommen_at, erfasst_at \
         FROM verpflegung_ausgabe "
    };
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
}

impl ZeitfensterZeile {
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

    fn anzeige(self, ausgaben: Vec<AusgabeAnzeige>) -> ZeitfensterAnzeige {
        let bedarf = self.bedarf();
        let d = deckung::rechne(&bedarf, &ausgaben);
        ZeitfensterAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            bezeichnung: self.bezeichnung,
            von_at: self.von_at,
            bis_at: self.bis_at,
            bedarf,
            ausgegeben: d.ausgegeben,
            fehlmenge: d.fehlmenge,
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
    Ok(VerpflegungAnzeige {
        zeitfenster: zeilen
            .into_iter()
            .map(|z| {
                let ausgaben = je_fenster.remove(&z.id).unwrap_or_default();
                z.anzeige(ausgaben)
            })
            .collect(),
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
    Ok(zeile.anzeige(ausgaben))
}

/// Die Zeitzone der Organisation des Einsatzes für die ETB-Texte (design.md D5). Fehlt die
/// Einstellung oder ist sie ungültig, gilt `einsatz::nummer::ZEITZONE_VORGABE`. Vor der
/// Transaktion zu laden, wie der ETB-`startwert`.
pub async fn zeitzone(pool: &SqlitePool, einsatz_id: i64) -> Result<Tz, AppError> {
    let name: Option<Option<String>> = sqlx::query_scalar(
        "SELECT oe.zeitzone FROM einsatz e \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id WHERE e.id = ?",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(crate::einsatz::nummer::zone_oder_vorgabe(
        name.flatten().as_deref(),
    ))
}

// ── Feldprüfungen (400) ─────────────────────────────────────────────────────────────────────

fn bezeichnung_pruefen(s: &str) -> Result<String, AppError> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::Validation(
            "bezeichnung darf nicht leer sein".into(),
        ));
    }
    Ok(t.to_string())
}

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

/// Zeitraum eines Zeitfensters als ETB-Text in der Org-Zone. Die Zeitpunkte liegen geprüft im
/// Drahtformat vor.
fn zeitraum(von: &str, bis: &str, tz: Tz) -> Result<String, AppError> {
    Ok(zeitraum_text(
        draht_lesen("von_at", von)?,
        draht_lesen("bis_at", bis)?,
        tz,
    ))
}

// ── Zeitfenster ─────────────────────────────────────────────────────────────────────────────

/// Legt ein Zeitfenster an. ETB: System-Eintrag mit Bezeichnung, Zeitraum und Bedarf.
pub async fn zeitfenster_anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    startwert: i64,
    tz: Tz,
    eingabe: &ZeitfensterEingabe,
) -> Result<Geschrieben, AppError> {
    // 400 — jedes Feld für sich
    let bezeichnung = bezeichnung_pruefen(&eingabe.bezeichnung)?;
    draht_lesen("von_at", &eingabe.von_at)?;
    draht_lesen("bis_at", &eingabe.bis_at)?;
    anzahl_pruefen("bedarf_kraefte", eingabe.bedarf_kraefte)?;
    anzahl_pruefen("bedarf_betreute", eingabe.bedarf_betreute)?;
    anzahl_pruefen("bedarf_weitere", eingabe.bedarf_weitere)?;
    let sonderkost = eingabe.sonderkost.ueber(&Sonderkost::default());
    sonderkost.pruefen()?;
    let b = bedarf(
        eingabe.bedarf_kraefte,
        eingabe.bedarf_betreute,
        eingabe.bedarf_weitere,
        sonderkost,
    );
    // 422 — der Zusammenhang
    zeitregel(&eingabe.von_at, &eingabe.bis_at)?;
    teilmenge(&sonderkost, b.gesamt, "den Gesamtbedarf")?;

    let id: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegung_zeitfenster \
            (einsatz_id, bezeichnung, von_at, bis_at, bedarf_kraefte, bedarf_betreute, \
             bedarf_weitere, sk_vegetarisch, sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, \
             sk_saeugling_kleinkind, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
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
    .fetch_one(&mut *conn)
    .await?;
    let inhalt = etb_text::angelegt(
        &bezeichnung,
        &zeitraum(&eingabe.von_at, &eingabe.bis_at, tz)?,
        &b,
    );
    let etb_id =
        crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &inhalt).await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
    })
}

/// Ändert ein Zeitfenster. Geprüft wird gegen den **Effektivzustand** aus Bestand und
/// Änderung — sonst unterliefe eine Teiländerung (nur der Bedarf, nur das Ende) die
/// Teilmengen- bzw. Zeitregel. Ändert sich kein Wert, läuft weder UPDATE noch ETB
/// (Leerlauf-Riegel) und `etb_ids` bleibt leer.
pub async fn zeitfenster_aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    tz: Tz,
    a: &ZeitfensterAenderung,
) -> Result<Geschrieben, AppError> {
    let roh = zeitfenster_roh_tx(conn, einsatz_id, id).await?;

    // 400 — jedes übergebene Feld für sich
    let bezeichnung = match &a.bezeichnung {
        Some(b) => bezeichnung_pruefen(b)?,
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

    // 422 — der Zusammenhang im Effektivzustand
    zeitregel(&von_at, &bis_at)?;
    teilmenge(&sonderkost, neu.gesamt, "den Gesamtbedarf")?;

    let zeitraum_neu = zeitraum(&von_at, &bis_at, tz)?;
    let zeitraum_alt = zeitraum(&roh.von_at, &roh.bis_at, tz)?;
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
            sk_saeugling_kleinkind = ?, geaendert_at = datetime('now') \
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
    .bind(id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
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
pub async fn zeitfenster_loeschen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    tz: Tz,
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
        &zeitraum(&roh.von_at, &roh.bis_at, tz)?,
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
    zeitfenster_roh_tx(conn, einsatz_id, zeitfenster_id).await?;
    // 400 — jedes Feld für sich
    draht_lesen("zeitpunkt_at", &eingabe.zeitpunkt_at)?;
    if eingabe.menge <= 0 {
        return Err(AppError::Validation(format!(
            "menge muss größer als 0 sein, war {}",
            eingabe.menge
        )));
    }
    let sonderkost = eingabe.sonderkost.ueber(&Sonderkost::default());
    sonderkost.pruefen()?;
    // 422 — der Zusammenhang
    teilmenge(&sonderkost, eingabe.menge, "die Menge")?;

    let ausgabe_id: i64 = sqlx::query_scalar(
        "INSERT INTO verpflegung_ausgabe \
            (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, ort, bemerkung, sk_vegetarisch, \
             sk_vegan, sk_ohne_schwein, sk_diaet_allergenarm, sk_saeugling_kleinkind, \
             nachforderung_id, erfasst_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
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
    .fetch_one(&mut *conn)
    .await?;
    Ok(AusgabeGeschrieben {
        ausgabe_id,
        zeitfenster_id,
    })
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
    })
}

#[cfg(test)]
mod tests;

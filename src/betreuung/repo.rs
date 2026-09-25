//! Persistenz des Fachmoduls Betreuung (LFH-639).
//!
//! **Die Schreibpfade laufen auf einer offenen Transaktion** (`_tx`, `&mut SqliteConnection`).
//! Der Aufrufer (Route) öffnet sie mit `write_retry!` (BEGIN IMMEDIATE), lädt den
//! ETB-`startwert` vorher und publiziert nach dem Commit — die Rückgabe trägt dafür die
//! Objekt-ID und die ETB-Einträge. Objekt, Meldung, Zeiger und ETB-Eintrag entstehen damit
//! in EINER Transaktion; ein Fehler mitten im Ablauf lässt nichts zurück.
//!
//! **Statuscodes (design.md D3, `src/error.rs`):** 400 für das Feld allein (leere
//! Bezeichnung, Plangröße/Kapazität < 1, Anzahl < 0, unlesbarer Zeitpunkt); 404 für fremde
//! Objekte und Abschnitte; 409 nur aus dem Lebenszyklus (storniert) und für die doppelte
//! Bezeichnung; 422 für umkehrbare Zustände (belegte Stelle schließen, geschlossene Stelle
//! belegen, Belegungsmeldung an einer geschlossenen Stelle zurücknehmen, doppelte Rücknahme).
//! Es gibt kein CAS und damit keinen Überschreiben-Dialog.

use sqlx::{SqliteConnection, SqlitePool};

use super::{
    etb_text, BelegungKopfzahl, BelegungKopfzahlStelle, BelegungsmeldungAnzeige,
    BetreuungUebersicht, BetreuungsstelleAnzeige, BetreuungsstelleArt, BetreuungsstelleStatus,
    Erhebung, EvakuierungsbezirkAnzeige, EvakuierungsstandAnzeige, Raeumungszustand,
};
use crate::error::AppError;
use crate::etb::repo::EintragDaten;
use crate::etb::{TYP_BERICHTIGUNG, TYP_ENTSCHEIDUNG, TYP_MELDUNG, TYP_SYSTEM};

/// Eingabe „Bezirk anlegen“. Die Route hat JSON und Enums gelesen; Bezeichnung, Plangröße
/// und Freitexte prüft und normalisiert das Repo.
#[derive(Debug, Clone)]
pub struct BezirkEingabe {
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
    pub plan_personen: i64,
    pub plan_erhebung: Erhebung,
    pub sammelstelle: Option<String>,
    pub notiz: Option<String>,
}

/// Eingabe „Bezirk ändern“ — jedes Feld tri-state: `None` = unverändert, `Some(None)` = leeren.
#[derive(Debug, Clone, Default)]
pub struct BezirkAenderung {
    pub bezeichnung: Option<String>,
    pub abschnitt_id: Option<Option<i64>>,
    pub plan_personen: Option<i64>,
    pub plan_erhebung: Option<Erhebung>,
    pub raeumung: Option<Raeumungszustand>,
    pub sammelstelle: Option<Option<String>>,
    pub notiz: Option<Option<String>>,
}

/// Eingabe „Stelle anlegen“.
#[derive(Debug, Clone)]
pub struct StelleEingabe {
    pub bezeichnung: String,
    pub art: BetreuungsstelleArt,
    pub abschnitt_id: Option<i64>,
    pub kapazitaet_personen: Option<i64>,
    pub standort: Option<String>,
    pub notiz: Option<String>,
}

/// Eingabe „Stelle ändern“ — tri-state wie [`BezirkAenderung`].
#[derive(Debug, Clone, Default)]
pub struct StelleAenderung {
    pub bezeichnung: Option<String>,
    pub art: Option<BetreuungsstelleArt>,
    pub abschnitt_id: Option<Option<i64>>,
    pub kapazitaet_personen: Option<Option<i64>>,
    pub status: Option<BetreuungsstelleStatus>,
    pub standort: Option<Option<String>>,
    pub notiz: Option<Option<String>>,
    /// Koordinate (LFH-673), tri-state je Wert; gegen den Bestand als Paar geprüft.
    pub lat: Option<Option<f64>>,
    pub lon: Option<Option<f64>>,
}

/// Eingabe „Stand melden“. `zeitpunkt_at` hat die Route normalisiert (UTC,
/// `YYYY-MM-DD HH:MM:SS`) und gegen die Zukunft geprüft.
#[derive(Debug, Clone)]
pub struct StandEingabe {
    pub evakuiert: i64,
    pub erhebung: Erhebung,
    pub zeitpunkt_at: String,
    /// Idempotenzschlüssel der Offline-Queue (LFH-675), getrimmt, nie leer.
    pub client_id: Option<String>,
}

/// Eingabe „Belegung melden“ (Zeitpunkt wie bei [`StandEingabe`]).
#[derive(Debug, Clone)]
pub struct BelegungEingabe {
    pub belegt: i64,
    pub zeitpunkt_at: String,
    /// Idempotenzschlüssel wie bei [`StandEingabe`].
    pub client_id: Option<String>,
}

/// Ergebnis eines Schreibvorgangs an Bezirk oder Stelle: die Objekt-ID und die dabei
/// geschriebenen ETB-Einträge (leer beim Leerlauf eines PATCH).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Geschrieben {
    pub id: i64,
    pub etb_ids: Vec<i64>,
    /// Die Verortung einer Stelle hat sich geändert (LFH-673, design.md D3) — wirksam, auch
    /// wo kein ETB-Eintrag davon zeugt (die Koordinate steht nie im ETB). Die Route verteilt
    /// dann trotzdem live; ohne diese Marke sähe keine zweite Karte den Marker wandern.
    pub still_geaendert: bool,
}

/// Ergebnis einer Meldung oder Rücknahme: die Meldezeile, ihr Objekt (Bezirk bzw. Stelle —
/// die Rücknahme-Route kennt es nur so) und der ETB-Eintrag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Gemeldet {
    pub meldung_id: i64,
    pub objekt_id: i64,
    pub etb_id: i64,
    /// `false` beim Replay einer Meldung mit bekannter `client_id` (LFH-675): es wurde nichts
    /// geschrieben, die Route verteilt deshalb auch nichts live.
    pub neu: bool,
}

// ── SQL: die eine Definition von „aktuell“ ──────────────────────────────────────────────────

/// „Aktuell“ (design.md D2): nicht zurückgenommen, jüngster Zeitpunkt, bei Gleichstand die
/// größere `id` — die später erfasste Meldung. **Die einzige Stelle, die das definiert**: der
/// Zeiger (`stand_id`/`belegung_id`) und die Kopfzahl zu einem Stichtag hängen beide daran.
/// Als Makro, damit `concat!` daraus ein `&'static str` baut (sqlx 0.9).
macro_rules! juengste_meldung {
    () => {
        concat!(
            "zurueckgenommen_at IS NULL ",
            meldereihenfolge!(),
            " LIMIT 1"
        )
    };
}

/// Die Ordnung, in der „aktuell“ bestimmt wird: jüngster Zeitpunkt zuerst, bei Gleichstand die
/// später erfasste. Der Verlauf (LFH-676) liest die Reihe in genau dieser Ordnung — der erste
/// nicht zurückgenommene Eintrag ist damit immer der aktuelle.
macro_rules! meldereihenfolge {
    () => {
        "ORDER BY zeitpunkt_at DESC, id DESC"
    };
}

macro_rules! bezirk_select {
    () => {
        "SELECT b.id, b.einsatz_id, b.abschnitt_id, a.name AS abschnitt_name, b.bezeichnung, \
                b.plan_personen, b.plan_erhebung, b.raeumung, b.sammelstelle, b.notiz, \
                (SELECT COUNT(*) FROM lage_zone z WHERE z.evakuierungsbezirk_id = b.id) \
                    AS flaechen, \
                st.id AS stand_id, st.evakuiert AS stand_evakuiert, \
                st.erhebung AS stand_erhebung, st.zeitpunkt_at AS stand_zeitpunkt_at, \
                b.storniert_at, b.angelegt_at, b.geaendert_at \
         FROM evakuierungsbezirk b \
         LEFT JOIN einsatzabschnitt a ON a.id = b.abschnitt_id \
         LEFT JOIN evakuierung_stand st ON st.id = b.stand_id "
    };
}

macro_rules! stelle_select {
    () => {
        "SELECT s.id, s.einsatz_id, s.abschnitt_id, a.name AS abschnitt_name, s.bezeichnung, \
                s.art, s.kapazitaet_personen, s.status, s.standort, s.notiz, s.lat, s.lon, \
                m.id AS belegung_id, m.belegt AS belegung_belegt, \
                m.zeitpunkt_at AS belegung_zeitpunkt_at, \
                s.storniert_at, s.angelegt_at, s.geaendert_at \
         FROM betreuungsstelle s \
         LEFT JOIN einsatzabschnitt a ON a.id = s.abschnitt_id \
         LEFT JOIN betreuungsstelle_belegung m ON m.id = s.belegung_id "
    };
}

fn aus_db<T: TryFrom<String, Error = String>>(s: String) -> Result<T, AppError> {
    T::try_from(s).map_err(|e| AppError::Internal(format!("Ungültiger Wert in der DB: {e}")))
}

#[derive(sqlx::FromRow)]
struct BezirkZeile {
    id: i64,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    bezeichnung: String,
    plan_personen: i64,
    plan_erhebung: String,
    raeumung: String,
    sammelstelle: Option<String>,
    notiz: Option<String>,
    flaechen: i64,
    stand_id: Option<i64>,
    stand_evakuiert: Option<i64>,
    stand_erhebung: Option<String>,
    stand_zeitpunkt_at: Option<String>,
    storniert_at: Option<String>,
    angelegt_at: String,
    geaendert_at: Option<String>,
}

impl TryFrom<BezirkZeile> for EvakuierungsbezirkAnzeige {
    type Error = AppError;

    fn try_from(z: BezirkZeile) -> Result<Self, AppError> {
        let stand = match (
            z.stand_id,
            z.stand_evakuiert,
            z.stand_erhebung,
            z.stand_zeitpunkt_at,
        ) {
            (Some(id), Some(evakuiert), Some(erhebung), Some(zeitpunkt_at)) => {
                Some(EvakuierungsstandAnzeige {
                    id,
                    evakuiert,
                    erhebung: aus_db(erhebung)?,
                    zeitpunkt_at,
                })
            }
            _ => None,
        };
        Ok(EvakuierungsbezirkAnzeige {
            id: z.id,
            einsatz_id: z.einsatz_id,
            abschnitt_id: z.abschnitt_id,
            abschnitt_name: z.abschnitt_name,
            bezeichnung: z.bezeichnung,
            plan_personen: z.plan_personen,
            plan_erhebung: aus_db(z.plan_erhebung)?,
            raeumung: aus_db(z.raeumung)?,
            sammelstelle: z.sammelstelle,
            notiz: z.notiz,
            flaechen: z.flaechen,
            stand,
            storniert_at: z.storniert_at,
            angelegt_at: z.angelegt_at,
            geaendert_at: z.geaendert_at,
        })
    }
}

#[derive(sqlx::FromRow)]
struct StelleZeile {
    id: i64,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    bezeichnung: String,
    art: String,
    kapazitaet_personen: Option<i64>,
    status: String,
    standort: Option<String>,
    notiz: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    belegung_id: Option<i64>,
    belegung_belegt: Option<i64>,
    belegung_zeitpunkt_at: Option<String>,
    storniert_at: Option<String>,
    angelegt_at: String,
    geaendert_at: Option<String>,
}

impl TryFrom<StelleZeile> for BetreuungsstelleAnzeige {
    type Error = AppError;

    fn try_from(z: StelleZeile) -> Result<Self, AppError> {
        let belegung = match (z.belegung_id, z.belegung_belegt, z.belegung_zeitpunkt_at) {
            (Some(id), Some(belegt), Some(zeitpunkt_at)) => Some(BelegungsmeldungAnzeige {
                id,
                belegt,
                zeitpunkt_at,
            }),
            _ => None,
        };
        Ok(BetreuungsstelleAnzeige {
            id: z.id,
            einsatz_id: z.einsatz_id,
            abschnitt_id: z.abschnitt_id,
            abschnitt_name: z.abschnitt_name,
            bezeichnung: z.bezeichnung,
            art: aus_db(z.art)?,
            kapazitaet_personen: z.kapazitaet_personen,
            status: aus_db(z.status)?,
            standort: z.standort,
            notiz: z.notiz,
            lat: z.lat,
            lon: z.lon,
            belegung,
            storniert_at: z.storniert_at,
            angelegt_at: z.angelegt_at,
            geaendert_at: z.geaendert_at,
        })
    }
}

// ── Lesen ───────────────────────────────────────────────────────────────────────────────────

/// Alle nicht stornierten Bezirke und Stellen des Einsatzes in Anlagereihenfolge, je mit
/// aktueller Meldung (über den Zeiger gejoint) und Abschnittsname.
pub async fn uebersicht(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<BetreuungUebersicht, AppError> {
    let bezirke = sqlx::query_as::<_, BezirkZeile>(concat!(
        bezirk_select!(),
        "WHERE b.einsatz_id = ? AND b.storniert_at IS NULL ORDER BY b.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(EvakuierungsbezirkAnzeige::try_from)
    .collect::<Result<Vec<_>, _>>()?;
    let stellen = sqlx::query_as::<_, StelleZeile>(concat!(
        stelle_select!(),
        "WHERE s.einsatz_id = ? AND s.storniert_at IS NULL ORDER BY s.id"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(BetreuungsstelleAnzeige::try_from)
    .collect::<Result<Vec<_>, _>>()?;
    Ok(BetreuungUebersicht {
        bezirke,
        stellen,
        // Personenbezogene Zahl: setzt nur die Route, nach Prüfung des Personenrechts.
        namentlich: None,
    })
}

/// Lädt einen Bezirk, auch einen stornierten (`storniert_at` gesetzt). `NotFound`, wenn er
/// nicht zum Einsatz gehört.
pub async fn bezirk_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<EvakuierungsbezirkAnzeige, AppError> {
    sqlx::query_as::<_, BezirkZeile>(concat!(
        bezirk_select!(),
        "WHERE b.einsatz_id = ? AND b.id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?
    .try_into()
}

/// Lädt eine Stelle, auch eine stornierte. `NotFound`, wenn sie nicht zum Einsatz gehört.
pub async fn stelle_laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<BetreuungsstelleAnzeige, AppError> {
    sqlx::query_as::<_, StelleZeile>(concat!(
        stelle_select!(),
        "WHERE s.einsatz_id = ? AND s.id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?
    .try_into()
}

/// Kopfzahl „in Betreuung“ zum Stichtag `zeitpunkt_at` (UTC, `YYYY-MM-DD HH:MM:SS`): je nicht
/// stornierter Stelle die aktuelle Meldung mit Zeitpunkt ≤ Stichtag. Stellen ohne solche
/// Meldung stehen ohne Anzahl in der Liste und gehen nicht in die Summe ein. Ein unlesbarer
/// Stichtag ist 400.
///
/// **Welche Stelle „ohne Meldung“ ist** (LFH-679): nur eine, die zum Stichtag betrieben sein
/// konnte. Weg fallen Stellen, die erst nach dem Stichtag angelegt wurden, und Stellen, die
/// jetzt `geschlossen` oder `vorbereitet` sind und nie eine (nicht zurückgenommene) Meldung
/// hatten — dort war nach allem, was bekannt ist, nie jemand. Eine Statushistorie gibt es
/// nicht, der Status ist der HEUTIGE: dieselbe Abfrage für ein vergangenes t kann deshalb
/// später anders ausfallen. Zwei Unschärfen folgen daraus, bewusst in verschiedene Richtungen:
/// Eine jetzt geschlossene Stelle MIT späterer Meldung bleibt „ohne Meldung“, denn sie kann zum
/// Stichtag schon betrieben worden sein (Hinweis „Untergrenze“ eher zu oft). Eine Stelle, die
/// zu t in Betrieb war, nie gemeldet hat und später geschlossen wurde, fällt dagegen weg (der
/// Hinweis fehlt dann) — der Preis dafür, nie belegte Stellen nicht mitzuzählen, ohne dass es
/// eine Migration gibt.
/// Eine Stelle MIT Meldung ≤ Stichtag zählt immer, auch vor ihrem `angelegt_at` — eine
/// Meldung darf nachgetragen früher liegen als die Erfassung der Stelle, und ihre Zahl ist
/// eine Tatsache. Die Summe hängt deshalb nicht an dieser Eingrenzung.
pub async fn kopfzahl(
    pool: &SqlitePool,
    einsatz_id: i64,
    zeitpunkt_at: &str,
) -> Result<BelegungKopfzahl, AppError> {
    zeitpunkt_pruefen(zeitpunkt_at)?;
    let zeilen: Vec<(i64, String, Option<i64>, Option<String>)> = sqlx::query_as(concat!(
        "SELECT s.id, s.bezeichnung, m.belegt, m.zeitpunkt_at \
         FROM betreuungsstelle s \
         LEFT JOIN betreuungsstelle_belegung m ON m.id = ( \
             SELECT id FROM betreuungsstelle_belegung \
             WHERE stelle_id = s.id AND zeitpunkt_at <= ? AND ",
        juengste_meldung!(),
        ") WHERE s.einsatz_id = ? AND s.storniert_at IS NULL \
           AND (m.id IS NOT NULL \
                OR (s.angelegt_at <= ? \
                    AND NOT (s.status IN (?, ?) AND s.belegung_id IS NULL))) \
         ORDER BY s.id"
    ))
    .bind(zeitpunkt_at)
    .bind(einsatz_id)
    .bind(zeitpunkt_at)
    .bind(BetreuungsstelleStatus::Geschlossen.as_str())
    .bind(BetreuungsstelleStatus::Vorbereitet.as_str())
    .fetch_all(pool)
    .await?;
    let stellen: Vec<BelegungKopfzahlStelle> = zeilen
        .into_iter()
        .map(
            |(stelle_id, bezeichnung, belegt, zeitpunkt_at)| BelegungKopfzahlStelle {
                stelle_id,
                bezeichnung,
                belegt,
                zeitpunkt_at,
            },
        )
        .collect();
    Ok(BelegungKopfzahl {
        zeitpunkt_at: zeitpunkt_at.to_string(),
        summe: stellen.iter().filter_map(|s| s.belegt).sum(),
        stellen_ohne_meldung: stellen.iter().filter(|s| s.belegt.is_none()).count() as i64,
        stellen,
    })
}

// ── Verlauf (LFH-676) ───────────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct StandVerlaufZeile {
    id: i64,
    evakuiert: i64,
    erhebung: String,
    zeitpunkt_at: String,
    erfasst_at: String,
    erfasst_von: String,
    aktuell: bool,
    zurueckgenommen_at: Option<String>,
    zurueckgenommen_von: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BelegungVerlaufZeile {
    id: i64,
    belegt: i64,
    zeitpunkt_at: String,
    erfasst_at: String,
    erfasst_von: String,
    aktuell: bool,
    zurueckgenommen_at: Option<String>,
    zurueckgenommen_von: Option<String>,
}

/// Die ganze Standreihe eines Bezirks, zurückgenommene eingeschlossen, in der Ordnung von
/// [`meldereihenfolge!`]. `aktuell` ist der Vergleich mit dem Zeiger `stand_id` — nicht eine
/// zweite Rechnung. Auch ein stornierter Bezirk liefert seine Reihe (Lesen ist keine
/// Lebenszyklus-Aktion); ein Bezirk außerhalb des Einsatzes ist `NotFound`, damit „fremd“ nicht
/// wie „ohne Meldung“ aussieht.
///
/// Die Namen kommen über Unterabfragen statt über einen Join: so bleibt `evakuierung_stand` die
/// einzige Tabelle im `FROM`, und `meldereihenfolge!` trifft ohne Tabellenpräfix eindeutig.
pub async fn stand_verlauf(
    pool: &SqlitePool,
    einsatz_id: i64,
    bezirk_id: i64,
) -> Result<Vec<super::StandVerlaufEintrag>, AppError> {
    let zeiger: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT stand_id FROM evakuierungsbezirk WHERE id = ? AND einsatz_id = ?")
            .bind(bezirk_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    let (stand_id,) = zeiger.ok_or(AppError::NotFound)?;
    sqlx::query_as::<_, StandVerlaufZeile>(concat!(
        "SELECT id, evakuiert, erhebung, zeitpunkt_at, erfasst_at, \
                (SELECT anzeigename FROM benutzer WHERE benutzer.id = erfasst_von_id) \
                    AS erfasst_von, \
                id IS ? AS aktuell, zurueckgenommen_at, \
                (SELECT anzeigename FROM benutzer WHERE benutzer.id = zurueckgenommen_von_id) \
                    AS zurueckgenommen_von \
         FROM evakuierung_stand WHERE bezirk_id = ? AND einsatz_id = ? ",
        meldereihenfolge!()
    ))
    .bind(stand_id)
    .bind(bezirk_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|z| {
        Ok(super::StandVerlaufEintrag {
            id: z.id,
            evakuiert: z.evakuiert,
            erhebung: aus_db(z.erhebung)?,
            zeitpunkt_at: z.zeitpunkt_at,
            erfasst_at: z.erfasst_at,
            erfasst_von: z.erfasst_von,
            aktuell: z.aktuell,
            zurueckgenommen_at: z.zurueckgenommen_at,
            zurueckgenommen_von: z.zurueckgenommen_von,
        })
    })
    .collect()
}

/// Die ganze Belegungsreihe einer Stelle, gebaut wie [`stand_verlauf`]. Auch eine geschlossene
/// oder stornierte Stelle liefert ihre Reihe.
pub async fn belegung_verlauf(
    pool: &SqlitePool,
    einsatz_id: i64,
    stelle_id: i64,
) -> Result<Vec<super::BelegungVerlaufEintrag>, AppError> {
    let zeiger: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT belegung_id FROM betreuungsstelle WHERE id = ? AND einsatz_id = ?")
            .bind(stelle_id)
            .bind(einsatz_id)
            .fetch_optional(pool)
            .await?;
    let (belegung_id,) = zeiger.ok_or(AppError::NotFound)?;
    Ok(sqlx::query_as::<_, BelegungVerlaufZeile>(concat!(
        "SELECT id, belegt, zeitpunkt_at, erfasst_at, \
                (SELECT anzeigename FROM benutzer WHERE benutzer.id = erfasst_von_id) \
                    AS erfasst_von, \
                id IS ? AS aktuell, zurueckgenommen_at, \
                (SELECT anzeigename FROM benutzer WHERE benutzer.id = zurueckgenommen_von_id) \
                    AS zurueckgenommen_von \
         FROM betreuungsstelle_belegung WHERE stelle_id = ? AND einsatz_id = ? ",
        meldereihenfolge!()
    ))
    .bind(belegung_id)
    .bind(stelle_id)
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|z| super::BelegungVerlaufEintrag {
        id: z.id,
        belegt: z.belegt,
        zeitpunkt_at: z.zeitpunkt_at,
        erfasst_at: z.erfasst_at,
        erfasst_von: z.erfasst_von,
        aktuell: z.aktuell,
        zurueckgenommen_at: z.zurueckgenommen_at,
        zurueckgenommen_von: z.zurueckgenommen_von,
    })
    .collect())
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

fn plan_pruefen(plan: i64) -> Result<(), AppError> {
    if plan < 1 {
        return Err(AppError::Validation(format!(
            "plan_personen muss mindestens 1 sein, war {plan}"
        )));
    }
    hoechstens("plan_personen", plan)
}

/// Obergrenze aller Personenzahlen ([`super::MAX_PERSONEN`], LFH-680).
fn hoechstens(feld: &str, n: i64) -> Result<(), AppError> {
    if n > super::MAX_PERSONEN {
        return Err(AppError::Validation(format!(
            "{feld} darf höchstens {} sein, war {n}",
            super::MAX_PERSONEN
        )));
    }
    Ok(())
}

/// Koordinate als Paar: beide gesetzt oder beide leer, Breite −90…90, Länge −180…180.
/// Wortlaut wie an der UHS (`routes/einsatz_uhs.rs`), damit alle Verortungswege gleich
/// antworten.
fn koordinate_pruefen(lat: Option<f64>, lon: Option<f64>) -> Result<(), AppError> {
    if lat.is_some() != lon.is_some() {
        return Err(AppError::UnprocessableEntity(
            "lat und lon müssen gemeinsam gesetzt oder gemeinsam leer sein".into(),
        ));
    }
    if lat.is_some_and(|la| !(-90.0..=90.0).contains(&la)) {
        return Err(AppError::UnprocessableEntity(
            "lat muss zwischen -90 und 90 liegen".into(),
        ));
    }
    if lon.is_some_and(|lo| !(-180.0..=180.0).contains(&lo)) {
        return Err(AppError::UnprocessableEntity(
            "lon muss zwischen -180 und 180 liegen".into(),
        ));
    }
    Ok(())
}

fn kapazitaet_pruefen(kapazitaet: Option<i64>) -> Result<(), AppError> {
    match kapazitaet {
        Some(k) if k < 1 => Err(AppError::Validation(format!(
            "kapazitaet_personen muss mindestens 1 sein, war {k}"
        ))),
        Some(k) => hoechstens("kapazitaet_personen", k),
        None => Ok(()),
    }
}

fn anzahl_pruefen(feld: &str, n: i64) -> Result<(), AppError> {
    if n < 0 {
        return Err(AppError::Validation(format!(
            "{feld} darf nicht negativ sein, war {n}"
        )));
    }
    hoechstens(feld, n)
}

/// Der Zeitpunkt muss im Drahtformat vorliegen; die Route hat ihn normalisiert und gegen die
/// Zukunft geprüft. Das Repo sichert nur das Format, damit der Textvergleich in der
/// „aktuell“-Abfrage trägt. Als Rundreise, weil chrono beim Parsen ungepolsterte Felder
/// annimmt: `2026-9-3 1:02:03` wäre lesbar, sortierte als Text aber hinter `2026-09-23 …`.
fn zeitpunkt_pruefen(s: &str) -> Result<(), AppError> {
    const FORMAT: &str = "%Y-%m-%d %H:%M:%S";
    match chrono::NaiveDateTime::parse_from_str(s, FORMAT) {
        Ok(t) if t.format(FORMAT).to_string() == s => Ok(()),
        _ => Err(AppError::Validation(format!(
            "Ungültiger Zeitpunkt '{s}' (erwartet: YYYY-MM-DD HH:MM:SS, UTC)"
        ))),
    }
}

// ── Hilfen innerhalb der Transaktion ────────────────────────────────────────────────────────

fn daten<'a>(
    typ: &'a str,
    inhalt: &'a str,
    ereigniszeit: Option<&'a str>,
    berichtigt_eintrag_id: Option<i64>,
) -> EintragDaten<'a> {
    EintragDaten {
        typ,
        inhalt,
        von: None,
        an: None,
        meldeweg: None,
        veranlassung: None,
        ereigniszeit,
        erfasst_lokal_at: None,
        berichtigt_eintrag_id,
    }
}

/// Der Abschnitt muss zum Einsatz gehören, sonst 404 (der FK sichert das nicht).
async fn abschnitt_pruefen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
) -> Result<(), AppError> {
    let Some(a) = abschnitt_id else {
        return Ok(());
    };
    sqlx::query_scalar::<_, i64>("SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
        .bind(a)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .map(|_| ())
        .ok_or(AppError::NotFound)
}

#[derive(Clone, Copy)]
enum Objekt {
    Bezirk,
    Stelle,
}

/// Vorabprüfung der Eindeutigkeit mit präziser Meldung. Vergleicht wie der partielle
/// UNIQUE-Index (BINARY, getrimmte Bezeichnung, nur nicht stornierte); der Index bleibt das
/// Sicherheitsnetz (→ 409 über `AppError::status`).
async fn bezeichnung_frei_tx(
    conn: &mut SqliteConnection,
    objekt: Objekt,
    einsatz_id: i64,
    bezeichnung: &str,
    ausser_id: Option<i64>,
) -> Result<(), AppError> {
    let sql = match objekt {
        Objekt::Bezirk => {
            "SELECT 1 FROM evakuierungsbezirk WHERE einsatz_id = ? AND bezeichnung = ? \
             AND storniert_at IS NULL AND id IS NOT ?"
        }
        Objekt::Stelle => {
            "SELECT 1 FROM betreuungsstelle WHERE einsatz_id = ? AND bezeichnung = ? \
             AND storniert_at IS NULL AND id IS NOT ?"
        }
    };
    let belegt: Option<i64> = sqlx::query_scalar(sql)
        .bind(einsatz_id)
        .bind(bezeichnung)
        .bind(ausser_id)
        .fetch_optional(&mut *conn)
        .await?;
    match (belegt, objekt) {
        (None, _) => Ok(()),
        (Some(_), Objekt::Bezirk) => Err(AppError::Conflict(format!(
            "Ein Evakuierungsbezirk ‚{bezeichnung}‘ gibt es in diesem Einsatz bereits"
        ))),
        (Some(_), Objekt::Stelle) => Err(AppError::Conflict(format!(
            "Eine Betreuungsstelle ‚{bezeichnung}‘ gibt es in diesem Einsatz bereits"
        ))),
    }
}

/// Rohdaten eines Bezirks für die Schreibpfade, samt aktueller Anzahl über den Zeiger.
#[derive(sqlx::FromRow)]
struct BezirkRoh {
    bezeichnung: String,
    abschnitt_id: Option<i64>,
    plan_personen: i64,
    #[sqlx(try_from = "String")]
    plan_erhebung: Erhebung,
    #[sqlx(try_from = "String")]
    raeumung: Raeumungszustand,
    sammelstelle: Option<String>,
    notiz: Option<String>,
    /// Der Zeiger auf die aktuelle Meldung und deren Anzahl und Zeitpunkt. Der Zeitpunkt
    /// trennt Fortschreibung von Nachtragung, BEVOR das ETB geschrieben wird (D5).
    stand_id: Option<i64>,
    stand_evakuiert: Option<i64>,
    stand_zeitpunkt_at: Option<String>,
    storniert_at: Option<String>,
}

async fn bezirk_roh_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<BezirkRoh, AppError> {
    sqlx::query_as(
        "SELECT b.bezeichnung, b.abschnitt_id, b.plan_personen, b.plan_erhebung, b.raeumung, \
                b.sammelstelle, b.notiz, b.stand_id, st.evakuiert AS stand_evakuiert, \
                st.zeitpunkt_at AS stand_zeitpunkt_at, b.storniert_at \
         FROM evakuierungsbezirk b LEFT JOIN evakuierung_stand st ON st.id = b.stand_id \
         WHERE b.id = ? AND b.einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Lebenszyklus: an einem stornierten Bezirk ist nichts mehr zu tun → 409 (D3).
fn bezirk_lebt(roh: &BezirkRoh) -> Result<(), AppError> {
    match roh.storniert_at {
        Some(_) => Err(AppError::Conflict(format!(
            "Evakuierungsbezirk ‚{}‘ ist storniert",
            roh.bezeichnung
        ))),
        None => Ok(()),
    }
}

/// Rohdaten einer Stelle für die Schreibpfade, samt aktueller Belegung über den Zeiger.
#[derive(sqlx::FromRow)]
struct StelleRoh {
    bezeichnung: String,
    #[sqlx(try_from = "String")]
    art: BetreuungsstelleArt,
    abschnitt_id: Option<i64>,
    kapazitaet_personen: Option<i64>,
    #[sqlx(try_from = "String")]
    status: BetreuungsstelleStatus,
    standort: Option<String>,
    notiz: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    /// Zeiger, Anzahl und Zeitpunkt der aktuellen Belegungsmeldung, wie bei [`BezirkRoh`].
    belegung_id: Option<i64>,
    belegung_belegt: Option<i64>,
    belegung_zeitpunkt_at: Option<String>,
    storniert_at: Option<String>,
}

async fn stelle_roh_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<StelleRoh, AppError> {
    sqlx::query_as(
        "SELECT s.bezeichnung, s.art, s.abschnitt_id, s.kapazitaet_personen, s.status, \
                s.standort, s.notiz, s.lat, s.lon, s.belegung_id, m.belegt AS belegung_belegt, \
                m.zeitpunkt_at AS belegung_zeitpunkt_at, s.storniert_at \
         FROM betreuungsstelle s LEFT JOIN betreuungsstelle_belegung m ON m.id = s.belegung_id \
         WHERE s.id = ? AND s.einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

fn stelle_lebt(roh: &StelleRoh) -> Result<(), AppError> {
    match roh.storniert_at {
        Some(_) => Err(AppError::Conflict(format!(
            "Betreuungsstelle ‚{}‘ ist storniert",
            roh.bezeichnung
        ))),
        None => Ok(()),
    }
}

/// Der aktuelle Wert, wenn die neue Meldung eine NACHTRAGUNG ist: ihr Zeitpunkt liegt STRIKT
/// vor dem der aktuellen Meldung. Bei gleichem Zeitpunkt gewinnt die größere id (D2), die neue
/// Meldung wird also aktuell und ist keine Nachtragung. Der Textvergleich trägt, weil
/// `zeitpunkt_pruefen` die Drahtform erzwingt (gepolstert, UTC ohne Zonenkennung).
fn nachtrag_gegen(
    neu_zeitpunkt: &str,
    aktuell: Option<i64>,
    aktuell_zeitpunkt: Option<&str>,
) -> Option<i64> {
    match (aktuell, aktuell_zeitpunkt) {
        (Some(n), Some(z)) if neu_zeitpunkt < z => Some(n),
        _ => None,
    }
}

/// Setzt den Zeiger `stand_id` neu (über `juengste_meldung!`) und liefert die nun aktuelle
/// Anzahl.
async fn stand_zeiger_neu_tx(
    conn: &mut SqliteConnection,
    bezirk_id: i64,
) -> Result<Option<i64>, AppError> {
    let aktuell: Option<(i64, i64)> = sqlx::query_as(concat!(
        "SELECT id, evakuiert FROM evakuierung_stand WHERE bezirk_id = ? AND ",
        juengste_meldung!()
    ))
    .bind(bezirk_id)
    .fetch_optional(&mut *conn)
    .await?;
    sqlx::query("UPDATE evakuierungsbezirk SET stand_id = ? WHERE id = ?")
        .bind(aktuell.map(|(id, _)| id))
        .bind(bezirk_id)
        .execute(&mut *conn)
        .await?;
    Ok(aktuell.map(|(_, n)| n))
}

/// Setzt den Zeiger `belegung_id` neu und liefert die nun aktuelle Belegung.
async fn belegung_zeiger_neu_tx(
    conn: &mut SqliteConnection,
    stelle_id: i64,
) -> Result<Option<i64>, AppError> {
    let aktuell: Option<(i64, i64)> = sqlx::query_as(concat!(
        "SELECT id, belegt FROM betreuungsstelle_belegung WHERE stelle_id = ? AND ",
        juengste_meldung!()
    ))
    .bind(stelle_id)
    .fetch_optional(&mut *conn)
    .await?;
    sqlx::query("UPDATE betreuungsstelle SET belegung_id = ? WHERE id = ?")
        .bind(aktuell.map(|(id, _)| id))
        .bind(stelle_id)
        .execute(&mut *conn)
        .await?;
    Ok(aktuell.map(|(_, n)| n))
}

// ── Bezirke ─────────────────────────────────────────────────────────────────────────────────

/// Legt einen Bezirk im Zustand `angeordnet` an. ETB: Entscheidung mit Bezeichnung und
/// Plangröße.
pub async fn bezirk_anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &BezirkEingabe,
) -> Result<Geschrieben, AppError> {
    let bezeichnung = bezeichnung_pruefen(&eingabe.bezeichnung)?;
    plan_pruefen(eingabe.plan_personen)?;
    abschnitt_pruefen_tx(conn, einsatz_id, eingabe.abschnitt_id).await?;
    bezeichnung_frei_tx(conn, Objekt::Bezirk, einsatz_id, &bezeichnung, None).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO evakuierungsbezirk \
            (einsatz_id, abschnitt_id, bezeichnung, plan_personen, plan_erhebung, \
             sammelstelle, notiz, angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(eingabe.abschnitt_id)
    .bind(&bezeichnung)
    .bind(eingabe.plan_personen)
    .bind(eingabe.plan_erhebung.as_str())
    .bind(text_opt(eingabe.sammelstelle.as_deref()))
    .bind(text_opt(eingabe.notiz.as_deref()))
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    let inhalt =
        etb_text::bezirk_angelegt(&bezeichnung, eingabe.plan_personen, eingabe.plan_erhebung);
    let etb_id = crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        daten(TYP_ENTSCHEIDUNG, &inhalt, None, None),
    )
    .await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
        still_geaendert: false,
    })
}

/// Schreibt einen Bezirk fort. Je Achse ein ETB-Eintrag (D5): Stammdaten → System,
/// Plangröße/Erhebung → Entscheidung, Räumung → Entscheidung bzw. Meldung. Ändert sich kein
/// Wert, läuft weder UPDATE noch ETB (Leerlauf-Riegel) und `etb_ids` bleibt leer.
pub async fn bezirk_aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &BezirkAenderung,
) -> Result<Geschrieben, AppError> {
    let roh = bezirk_roh_tx(conn, einsatz_id, id).await?;
    bezirk_lebt(&roh)?;

    let bezeichnung = match &eingabe.bezeichnung {
        Some(b) => bezeichnung_pruefen(b)?,
        None => roh.bezeichnung.clone(),
    };
    let abschnitt_id = eingabe.abschnitt_id.unwrap_or(roh.abschnitt_id);
    let plan = eingabe.plan_personen.unwrap_or(roh.plan_personen);
    plan_pruefen(plan)?;
    let erhebung = eingabe.plan_erhebung.unwrap_or(roh.plan_erhebung);
    let raeumung = eingabe.raeumung.unwrap_or(roh.raeumung);
    let sammelstelle = match &eingabe.sammelstelle {
        Some(v) => text_opt(v.as_deref()),
        None => roh.sammelstelle.clone(),
    };
    let notiz = match &eingabe.notiz {
        Some(v) => text_opt(v.as_deref()),
        None => roh.notiz.clone(),
    };

    let stammdaten = etb_text::BezirkStammdaten {
        bezeichnung_vorher: (bezeichnung != roh.bezeichnung).then_some(roh.bezeichnung.as_str()),
        abschnitt: abschnitt_id != roh.abschnitt_id,
        weitere_angaben: sammelstelle != roh.sammelstelle || notiz != roh.notiz,
    };
    let plan_neu = plan != roh.plan_personen || erhebung != roh.plan_erhebung;
    let raeumung_neu = raeumung != roh.raeumung;
    if stammdaten.leer() && !plan_neu && !raeumung_neu {
        return Ok(Geschrieben {
            id,
            etb_ids: Vec::new(),
            still_geaendert: false,
        });
    }
    if stammdaten.bezeichnung_vorher.is_some() {
        bezeichnung_frei_tx(conn, Objekt::Bezirk, einsatz_id, &bezeichnung, Some(id)).await?;
    }
    if stammdaten.abschnitt {
        abschnitt_pruefen_tx(conn, einsatz_id, abschnitt_id).await?;
    }

    sqlx::query(
        "UPDATE evakuierungsbezirk SET bezeichnung = ?, abschnitt_id = ?, plan_personen = ?, \
            plan_erhebung = ?, raeumung = ?, sammelstelle = ?, notiz = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&bezeichnung)
    .bind(abschnitt_id)
    .bind(plan)
    .bind(erhebung.as_str())
    .bind(raeumung.as_str())
    .bind(&sammelstelle)
    .bind(&notiz)
    .bind(id)
    .execute(&mut *conn)
    .await?;

    let mut eintraege: Vec<(&'static str, String)> = Vec::new();
    if !stammdaten.leer() {
        eintraege.push((
            TYP_SYSTEM,
            etb_text::bezirk_geaendert(&bezeichnung, stammdaten),
        ));
    }
    if plan_neu {
        eintraege.push((
            TYP_ENTSCHEIDUNG,
            etb_text::plan_geaendert(
                &bezeichnung,
                plan,
                erhebung,
                roh.plan_personen,
                roh.plan_erhebung,
            ),
        ));
    }
    if raeumung_neu {
        eintraege.push((
            raeumung.etb_typ(),
            etb_text::raeumung_gewechselt(&bezeichnung, raeumung),
        ));
    }
    let mut etb_ids = Vec::with_capacity(eintraege.len());
    for (typ, inhalt) in &eintraege {
        etb_ids.push(
            crate::etb::repo::anlegen_tx(
                conn,
                einsatz_id,
                benutzer_id,
                startwert,
                daten(typ, inhalt, None, None),
            )
            .await?,
        );
    }
    Ok(Geschrieben {
        id,
        etb_ids,
        still_geaendert: false,
    })
}

/// Storniert einen Bezirk (Fehlanlage). Die Bezeichnung wird wieder frei; der Bezirk nimmt
/// keine Meldung mehr an. Bereits storniert → 409.
pub async fn bezirk_stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
) -> Result<(Geschrieben, Vec<i64>), AppError> {
    let roh = bezirk_roh_tx(conn, einsatz_id, id).await?;
    bezirk_lebt(&roh)?;
    sqlx::query(
        "UPDATE evakuierungsbezirk SET storniert_at = datetime('now'), storniert_von_id = ? \
         WHERE id = ?",
    )
    .bind(benutzer_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // LFH-673 (design.md D6): die Flächen verlieren ihren Verweis im SELBEN Vorgang und
    // bleiben als nicht zugeordnete Bezirksflächen stehen. Stehenlassen und beim Lesen filtern
    // hätte jede lesende Stelle (Karte, Snapshot, `flaechen`) mit einem Filter belastet — ein
    // vergessener zeigte eine Fehlanlage als lebende Fläche. Kein eigener ETB-Eintrag: der
    // Storno ist der Vorgang. Die ids gehen an die Route, die je Zone `lage_zone` verteilt.
    let geloest: Vec<i64> = sqlx::query_scalar(
        "UPDATE lage_zone SET evakuierungsbezirk_id = NULL, geaendert_at = datetime('now') \
         WHERE einsatz_id = ? AND evakuierungsbezirk_id = ? RETURNING id",
    )
    .bind(einsatz_id)
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &etb_text::bezirk_storniert(&roh.bezeichnung),
    )
    .await?;
    Ok((
        Geschrieben {
            id,
            etb_ids: vec![etb_id],
            still_geaendert: false,
        },
        geloest,
    ))
}

// ── Idempotenz der Offline-Erfassung (LFH-675) ─────────────────────────────────────────────

/// Die gespeicherte Standmeldung mit dieser `client_id` im Einsatz, als Replay (`neu: false`).
/// Einsatzgebunden: dieselbe `client_id` in einem anderen Einsatz findet nichts und legt dort
/// nichts offen. Läuft auf dem Pool (Vorab-Lookup der Route) wie in der Transaktion.
pub async fn stand_nach_client_id<'e, E: sqlx::SqliteExecutor<'e>>(
    ex: E,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<Gemeldet>, AppError> {
    let treffer: Option<(i64, i64, i64)> = sqlx::query_as(
        "SELECT id, bezirk_id, etb_eintrag_id FROM evakuierung_stand \
         WHERE einsatz_id = ? AND client_id = ?",
    )
    .bind(einsatz_id)
    .bind(client_id)
    .fetch_optional(ex)
    .await?;
    Ok(treffer.map(als_replay))
}

/// Wie [`stand_nach_client_id`] für Belegungsmeldungen.
pub async fn belegung_nach_client_id<'e, E: sqlx::SqliteExecutor<'e>>(
    ex: E,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<Gemeldet>, AppError> {
    let treffer: Option<(i64, i64, i64)> = sqlx::query_as(
        "SELECT id, stelle_id, etb_eintrag_id FROM betreuungsstelle_belegung \
         WHERE einsatz_id = ? AND client_id = ?",
    )
    .bind(einsatz_id)
    .bind(client_id)
    .fetch_optional(ex)
    .await?;
    Ok(treffer.map(als_replay))
}

fn als_replay((meldung_id, objekt_id, etb_id): (i64, i64, i64)) -> Gemeldet {
    Gemeldet {
        meldung_id,
        objekt_id,
        etb_id,
        neu: false,
    }
}

/// Ein Replay gilt nur für das Objekt, an dem die Meldung gespeichert ist. Ein Schlüssel, der
/// an einem anderen Bezirk bzw. einer anderen Stelle hängt, ist 422 (design.md D3): jedes Feld
/// ist für sich gültig, erst der gespeicherte Zusammenhang verbietet die Aktion. Die fremde
/// Meldung zurückzugeben behauptete den Stand eines Objekts, das der Client nicht adressiert hat.
pub fn replay_am_objekt(
    replay: Gemeldet,
    objekt_id: i64,
    // mit Artikel („einem anderen Evakuierungsbezirk“) — das Genus unterscheidet sich
    objekt: &str,
) -> Result<Gemeldet, AppError> {
    if replay.objekt_id == objekt_id {
        Ok(replay)
    } else {
        Err(AppError::UnprocessableEntity(format!(
            "client_id gehört zu einer Meldung an {objekt}"
        )))
    }
}

/// Meldet einen Stand „evakuiert“. ETB-Meldung mit Vorwert, Erhebung und Plangröße, deren
/// Ereigniszeit der Meldezeitpunkt ist; danach wird der Zeiger über die „aktuell“-Abfrage
/// bestimmt — eine nachgetragene ältere Meldung lässt ihn stehen. Dieselbe Zahl wie der
/// Vorwert ist keine Leermeldung und wird geschrieben.
pub async fn stand_melden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bezirk_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &StandEingabe,
) -> Result<Gemeldet, AppError> {
    // Replay VOR jeder Zustandsprüfung (design.md D2): eine schon gespeicherte Meldung kommt
    // auch am inzwischen stornierten Bezirk zurück. Unter `BEGIN IMMEDIATE` ist dieser Lookup
    // gegen das INSERT unten nicht verschränkbar — zwei gleichzeitige Flushes desselben
    // Schlüssels ergeben eine Zeile.
    if let Some(cid) = eingabe.client_id.as_deref() {
        if let Some(replay) = stand_nach_client_id(&mut *conn, einsatz_id, cid).await? {
            return replay_am_objekt(replay, bezirk_id, "einem anderen Evakuierungsbezirk");
        }
    }
    anzahl_pruefen("evakuiert", eingabe.evakuiert)?;
    zeitpunkt_pruefen(&eingabe.zeitpunkt_at)?;
    let roh = bezirk_roh_tx(conn, einsatz_id, bezirk_id).await?;
    bezirk_lebt(&roh)?;
    let nachtrag = nachtrag_gegen(
        &eingabe.zeitpunkt_at,
        roh.stand_evakuiert,
        roh.stand_zeitpunkt_at.as_deref(),
    );
    let inhalt = match nachtrag {
        Some(aktuell) => etb_text::stand_nachgetragen(
            &roh.bezeichnung,
            eingabe.evakuiert,
            eingabe.erhebung,
            aktuell,
            roh.plan_personen,
        ),
        None => etb_text::stand_gemeldet(
            &roh.bezeichnung,
            eingabe.evakuiert,
            eingabe.erhebung,
            roh.stand_evakuiert,
            roh.plan_personen,
        ),
    };
    let etb_id = crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        daten(TYP_MELDUNG, &inhalt, Some(&eingabe.zeitpunkt_at), None),
    )
    .await?;
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO evakuierung_stand \
            (bezirk_id, einsatz_id, evakuiert, erhebung, zeitpunkt_at, erfasst_von_id, \
             etb_eintrag_id, client_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(bezirk_id)
    .bind(einsatz_id)
    .bind(eingabe.evakuiert)
    .bind(eingabe.erhebung.as_str())
    .bind(&eingabe.zeitpunkt_at)
    .bind(benutzer_id)
    .bind(etb_id)
    .bind(eingabe.client_id.as_deref())
    .fetch_one(&mut *conn)
    .await?;
    stand_zeiger_neu_tx(conn, bezirk_id).await?;
    Ok(Gemeldet {
        meldung_id,
        objekt_id: bezirk_id,
        etb_id,
        neu: true,
    })
}

/// Nimmt eine Standmeldung zurück: Zeile bleibt, gekennzeichnet; Zeiger neu; ETB-Berichtigung
/// mit Verweis auf den Eintrag der Meldung. Bereits zurückgenommen → 422, Bezirk storniert
/// → 409.
pub async fn stand_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stand_id: i64,
    benutzer_id: i64,
    startwert: i64,
) -> Result<Gemeldet, AppError> {
    let (bezirk_id, meldung_etb, zurueckgenommen_at): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT bezirk_id, etb_eintrag_id, zurueckgenommen_at FROM evakuierung_stand \
             WHERE id = ? AND einsatz_id = ?",
    )
    .bind(stand_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let roh = bezirk_roh_tx(conn, einsatz_id, bezirk_id).await?;
    bezirk_lebt(&roh)?;
    if zurueckgenommen_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Die Standmeldung ist bereits zurückgenommen".into(),
        ));
    }
    sqlx::query(
        "UPDATE evakuierung_stand SET zurueckgenommen_at = datetime('now'), \
            zurueckgenommen_von_id = ? WHERE id = ?",
    )
    .bind(benutzer_id)
    .bind(stand_id)
    .execute(&mut *conn)
    .await?;
    // VOR dem UPDATE gelesen (`roh`): war die zurückgenommene Meldung nicht die aktuelle,
    // bleibt der Stand stehen, und der Text sagt „bleibt“ statt „wieder“.
    let war_aktuell = roh.stand_id == Some(stand_id);
    let jetzt = stand_zeiger_neu_tx(conn, bezirk_id).await?;
    let inhalt = etb_text::stand_zurueckgenommen(&roh.bezeichnung, jetzt, war_aktuell);
    let etb_id = crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        daten(TYP_BERICHTIGUNG, &inhalt, None, Some(meldung_etb)),
    )
    .await?;
    Ok(Gemeldet {
        meldung_id: stand_id,
        objekt_id: bezirk_id,
        etb_id,
        neu: true,
    })
}

// ── Stellen ─────────────────────────────────────────────────────────────────────────────────

/// Legt eine Stelle im Status `vorbereitet` an. ETB: System.
pub async fn stelle_anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &StelleEingabe,
) -> Result<Geschrieben, AppError> {
    let bezeichnung = bezeichnung_pruefen(&eingabe.bezeichnung)?;
    kapazitaet_pruefen(eingabe.kapazitaet_personen)?;
    abschnitt_pruefen_tx(conn, einsatz_id, eingabe.abschnitt_id).await?;
    bezeichnung_frei_tx(conn, Objekt::Stelle, einsatz_id, &bezeichnung, None).await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO betreuungsstelle \
            (einsatz_id, abschnitt_id, bezeichnung, art, kapazitaet_personen, standort, notiz, \
             angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(eingabe.abschnitt_id)
    .bind(&bezeichnung)
    .bind(eingabe.art.as_str())
    .bind(eingabe.kapazitaet_personen)
    .bind(text_opt(eingabe.standort.as_deref()))
    .bind(text_opt(eingabe.notiz.as_deref()))
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &etb_text::stelle_angelegt(&bezeichnung, eingabe.art, eingabe.kapazitaet_personen),
    )
    .await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
        still_geaendert: false,
    })
}

/// Ändert eine Stelle. Stammdaten und Status bekommen je einen System-Eintrag; ohne
/// tatsächliche Änderung läuft nichts (Leerlauf-Riegel). `geschlossen` nur bei aktueller
/// Belegung 0 oder ohne Meldung, sonst 422 (D4); Wiederöffnen ist erlaubt.
pub async fn stelle_aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &StelleAenderung,
) -> Result<Geschrieben, AppError> {
    let roh = stelle_roh_tx(conn, einsatz_id, id).await?;
    stelle_lebt(&roh)?;

    let bezeichnung = match &eingabe.bezeichnung {
        Some(b) => bezeichnung_pruefen(b)?,
        None => roh.bezeichnung.clone(),
    };
    let art = eingabe.art.unwrap_or(roh.art);
    let abschnitt_id = eingabe.abschnitt_id.unwrap_or(roh.abschnitt_id);
    let kapazitaet = eingabe
        .kapazitaet_personen
        .unwrap_or(roh.kapazitaet_personen);
    kapazitaet_pruefen(kapazitaet)?;
    let status = eingabe.status.unwrap_or(roh.status);
    let standort = match &eingabe.standort {
        Some(v) => text_opt(v.as_deref()),
        None => roh.standort.clone(),
    };
    let notiz = match &eingabe.notiz {
        Some(v) => text_opt(v.as_deref()),
        None => roh.notiz.clone(),
    };
    // Koordinate (LFH-673): Effektivzustand gegen den Rohstand DIESER Transaktion — ein im
    // Handler vorab gelesener Stand könnte zwischen Prüfung und UPDATE veralten und das Paar
    // zerreißen. 422 wie bei der UHS (Zusammenhang zweier Felder; design.md D4 begründet die
    // Abweichung von der 400-Linie des Moduls).
    let lat = eingabe.lat.unwrap_or(roh.lat);
    let lon = eingabe.lon.unwrap_or(roh.lon);
    koordinate_pruefen(lat, lon)?;

    let stammdaten = etb_text::StelleStammdaten {
        bezeichnung_vorher: (bezeichnung != roh.bezeichnung).then_some(roh.bezeichnung.as_str()),
        art: (art != roh.art).then_some((roh.art, art)),
        kapazitaet: (kapazitaet != roh.kapazitaet_personen)
            .then_some((roh.kapazitaet_personen, kapazitaet)),
        abschnitt: abschnitt_id != roh.abschnitt_id,
        weitere_angaben: standort != roh.standort || notiz != roh.notiz,
    };
    let status_neu = status != roh.status;
    // Die Verortung ist eine EIGENE Achse, nicht Teil von `StelleStammdaten`: die erzeugt den
    // ETB-Text, und der nennt nie einen Standort (LFH-639 D5). Hinge die Koordinate nur am
    // UPDATE, schnitte der Leerlauf-Riegel einen reinen Karten-PATCH still ab (200, nichts
    // gespeichert).
    let verortung_neu = lat != roh.lat || lon != roh.lon;
    if stammdaten.leer() && !status_neu && !verortung_neu {
        return Ok(Geschrieben {
            id,
            etb_ids: Vec::new(),
            still_geaendert: false,
        });
    }
    if status_neu && status == BetreuungsstelleStatus::Geschlossen {
        if let Some(belegt) = roh.belegung_belegt.filter(|n| *n > 0) {
            return Err(AppError::UnprocessableEntity(format!(
                "Betreuungsstelle ‚{}‘ ist mit {belegt} Personen belegt — erst Belegung 0 \
                 melden, dann schließen",
                roh.bezeichnung
            )));
        }
    }
    if stammdaten.bezeichnung_vorher.is_some() {
        bezeichnung_frei_tx(conn, Objekt::Stelle, einsatz_id, &bezeichnung, Some(id)).await?;
    }
    if stammdaten.abschnitt {
        abschnitt_pruefen_tx(conn, einsatz_id, abschnitt_id).await?;
    }

    sqlx::query(
        "UPDATE betreuungsstelle SET bezeichnung = ?, art = ?, abschnitt_id = ?, \
            kapazitaet_personen = ?, status = ?, standort = ?, notiz = ?, lat = ?, lon = ?, \
            geaendert_at = datetime('now') \
         WHERE id = ?",
    )
    .bind(&bezeichnung)
    .bind(art.as_str())
    .bind(abschnitt_id)
    .bind(kapazitaet)
    .bind(status.as_str())
    .bind(&standort)
    .bind(&notiz)
    .bind(lat)
    .bind(lon)
    .bind(id)
    .execute(&mut *conn)
    .await?;

    let mut inhalte: Vec<String> = Vec::new();
    if !stammdaten.leer() {
        inhalte.push(etb_text::stelle_geaendert(&bezeichnung, stammdaten));
    }
    if status_neu {
        inhalte.push(etb_text::stelle_status(&bezeichnung, status, roh.status));
    }
    let mut etb_ids = Vec::with_capacity(inhalte.len());
    for inhalt in &inhalte {
        etb_ids.push(
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, inhalt).await?,
        );
    }
    Ok(Geschrieben {
        id,
        etb_ids,
        still_geaendert: verortung_neu,
    })
}

/// Storniert eine Stelle (Fehlanlage). Bereits storniert → 409.
pub async fn stelle_stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    startwert: i64,
) -> Result<Geschrieben, AppError> {
    let roh = stelle_roh_tx(conn, einsatz_id, id).await?;
    stelle_lebt(&roh)?;
    sqlx::query(
        "UPDATE betreuungsstelle SET storniert_at = datetime('now'), storniert_von_id = ? \
         WHERE id = ?",
    )
    .bind(benutzer_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let etb_id = crate::etb::system_audit_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        &etb_text::stelle_storniert(&roh.bezeichnung),
    )
    .await?;
    Ok(Geschrieben {
        id,
        etb_ids: vec![etb_id],
        still_geaendert: false,
    })
}

/// Meldet eine Belegung. Geschlossene Stelle → 422, stornierte → 409. Die Anzahl darf die
/// Kapazität übersteigen.
pub async fn belegung_melden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    stelle_id: i64,
    benutzer_id: i64,
    startwert: i64,
    eingabe: &BelegungEingabe,
) -> Result<Gemeldet, AppError> {
    // Replay vor jeder Zustandsprüfung, wie bei `stand_melden_tx`: eine gespeicherte Meldung
    // kommt auch an der inzwischen geschlossenen oder stornierten Stelle zurück.
    if let Some(cid) = eingabe.client_id.as_deref() {
        if let Some(replay) = belegung_nach_client_id(&mut *conn, einsatz_id, cid).await? {
            return replay_am_objekt(replay, stelle_id, "einer anderen Betreuungsstelle");
        }
    }
    anzahl_pruefen("belegt", eingabe.belegt)?;
    zeitpunkt_pruefen(&eingabe.zeitpunkt_at)?;
    let roh = stelle_roh_tx(conn, einsatz_id, stelle_id).await?;
    stelle_lebt(&roh)?;
    if roh.status == BetreuungsstelleStatus::Geschlossen {
        return Err(AppError::UnprocessableEntity(format!(
            "Betreuungsstelle ‚{}‘ ist geschlossen — erst wieder in Betrieb setzen",
            roh.bezeichnung
        )));
    }
    let nachtrag = nachtrag_gegen(
        &eingabe.zeitpunkt_at,
        roh.belegung_belegt,
        roh.belegung_zeitpunkt_at.as_deref(),
    );
    let inhalt = match nachtrag {
        Some(aktuell) => etb_text::belegung_nachgetragen(
            &roh.bezeichnung,
            eingabe.belegt,
            aktuell,
            roh.kapazitaet_personen,
        ),
        None => etb_text::belegung_gemeldet(
            &roh.bezeichnung,
            eingabe.belegt,
            roh.belegung_belegt,
            roh.kapazitaet_personen,
        ),
    };
    let etb_id = crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        daten(TYP_MELDUNG, &inhalt, Some(&eingabe.zeitpunkt_at), None),
    )
    .await?;
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO betreuungsstelle_belegung \
            (stelle_id, einsatz_id, belegt, zeitpunkt_at, erfasst_von_id, etb_eintrag_id, \
             client_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(stelle_id)
    .bind(einsatz_id)
    .bind(eingabe.belegt)
    .bind(&eingabe.zeitpunkt_at)
    .bind(benutzer_id)
    .bind(etb_id)
    .bind(eingabe.client_id.as_deref())
    .fetch_one(&mut *conn)
    .await?;
    belegung_zeiger_neu_tx(conn, stelle_id).await?;
    Ok(Gemeldet {
        meldung_id,
        objekt_id: stelle_id,
        etb_id,
        neu: true,
    })
}

/// Nimmt eine Belegungsmeldung zurück, im Ablauf wie eine Standmeldung. Zusätzlich gilt D4: an
/// einer geschlossenen Stelle ist die Rücknahme 422, sonst stünde sie nach Rücknahme der
/// Leermeldung „geschlossen und belegt“ da. Reihenfolge: storniert 409 → geschlossen 422 →
/// bereits zurückgenommen 422.
pub async fn belegung_zuruecknehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    belegung_id: i64,
    benutzer_id: i64,
    startwert: i64,
) -> Result<Gemeldet, AppError> {
    let (stelle_id, meldung_etb, zurueckgenommen_at): (i64, i64, Option<String>) = sqlx::query_as(
        "SELECT stelle_id, etb_eintrag_id, zurueckgenommen_at FROM betreuungsstelle_belegung \
             WHERE id = ? AND einsatz_id = ?",
    )
    .bind(belegung_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    let roh = stelle_roh_tx(conn, einsatz_id, stelle_id).await?;
    stelle_lebt(&roh)?;
    if roh.status == BetreuungsstelleStatus::Geschlossen {
        return Err(AppError::UnprocessableEntity(format!(
            "Betreuungsstelle ‚{}‘ ist geschlossen — erst wieder in Betrieb setzen, dann die \
             Meldung zurücknehmen",
            roh.bezeichnung
        )));
    }
    if zurueckgenommen_at.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Die Belegungsmeldung ist bereits zurückgenommen".into(),
        ));
    }
    sqlx::query(
        "UPDATE betreuungsstelle_belegung SET zurueckgenommen_at = datetime('now'), \
            zurueckgenommen_von_id = ? WHERE id = ?",
    )
    .bind(benutzer_id)
    .bind(belegung_id)
    .execute(&mut *conn)
    .await?;
    let war_aktuell = roh.belegung_id == Some(belegung_id);
    let jetzt = belegung_zeiger_neu_tx(conn, stelle_id).await?;
    let inhalt = etb_text::belegung_zurueckgenommen(&roh.bezeichnung, jetzt, war_aktuell);
    let etb_id = crate::etb::repo::anlegen_tx(
        conn,
        einsatz_id,
        benutzer_id,
        startwert,
        daten(TYP_BERICHTIGUNG, &inhalt, None, Some(meldung_etb)),
    )
    .await?;
    Ok(Gemeldet {
        meldung_id: belegung_id,
        objekt_id: stelle_id,
        etb_id,
        neu: true,
    })
}

#[cfg(test)]
mod tests;

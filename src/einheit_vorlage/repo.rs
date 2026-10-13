//! Lesen und Schreiben der Einheiten-Vorlagen (LLH-1042). Alles ist auf die Organisation
//! begrenzt; jede Schreibfunktion gibt es als `…_tx` auf der Verbindung des Aufrufers (Demo-Import,
//! LLH-1049) und als Pool-Fassung in `write_retry!`.
//!
//! Lesen kostet unabhängig von der Zahl der Vorlagen vier Abfragen (Köpfe, Fahrzeuge,
//! Stammbesetzung, Kanten des Baums). `auch_in` leitet sich dabei aus allen Zuordnungen der
//! Organisation ab, nie aus einem gespeicherten Flag (Spec `openspec/specs/einheit-vorlagen`,
//! „Fahrzeuge und Stammbesetzung der Vorlage“).

use super::{EinheitVorlage, EinheitVorlageFahrzeug, EinheitVorlagePersonal, PersonalEintrag};
use crate::error::AppError;
use crate::katalog::DIENSTSTATUS_IN_DIENST;
use crate::staerke::{Staerke, StaerkePosition};
use crate::write_retry;
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Felder einer neuen Vorlage, schon getrimmt und geprüft (Grenzen, Soll vollständig).
#[derive(Debug, Clone, Copy)]
pub struct NeueVorlage<'a> {
    pub name: &'a str,
    pub typ_id: i64,
    pub ueber_vorlage_id: Option<i64>,
    pub funkrufname: Option<&'a str>,
    pub tz_fachaufgabe: Option<&'a str>,
    pub tz_organisation: Option<&'a str>,
    pub soll: Option<Staerke>,
    pub bemerkung: Option<&'a str>,
    pub sortier: i64,
}

/// Teil-Patch (Tri-State): äußere `Option` = „im Patch?“, `Some(None)` leert. Das Soll-Trio
/// prüft [`update_tx`] gegen den Effektivzustand (Patch gewinnt, sonst Bestand).
#[derive(Debug, Default, Clone, Copy)]
pub struct VorlagePatch<'a> {
    pub name: Option<&'a str>,
    pub typ_id: Option<i64>,
    pub ueber_vorlage_id: Option<Option<i64>>,
    pub funkrufname: Option<Option<&'a str>>,
    pub tz_fachaufgabe: Option<Option<&'a str>>,
    pub tz_organisation: Option<Option<&'a str>>,
    pub soll_fuehrer: Option<Option<i64>>,
    pub soll_unterfuehrer: Option<Option<i64>>,
    pub soll_mannschaft: Option<Option<i64>>,
    pub bemerkung: Option<Option<&'a str>>,
    pub sortier: Option<i64>,
    pub aktiv: Option<bool>,
}

const UNBEKANNTER_TYP: &str = "Unbekannter Einheitstyp";
const UNBEKANNTE_UEBER: &str = "Unbekannte übergeordnete Vorlage";
const ZYKLUS: &str =
    "Eine Vorlage kann nicht unter sich selbst oder eine ihrer Untereinheiten gestellt werden";

fn map_name_conflict<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() && db.message().contains("einheit_vorlage.name") {
            return Err(AppError::Conflict(
                "Eine aktive Einheiten-Vorlage mit diesem Namen gibt es schon".into(),
            ));
        }
    }
    Err(e)
}

/// IDs als JSON-Array für `json_each(?)`.
fn json_ids(ids: impl IntoIterator<Item = i64>) -> Result<String, AppError> {
    serde_json::to_string(&ids.into_iter().collect::<Vec<i64>>())
        .map_err(|e| AppError::Internal(format!("Vorlagen-ids serialisieren: {e}")))
}

// ── Baum ─────────────────────────────────────────────────────────────────────────────────────

/// Die Kanten aller Vorlagen einer Organisation, im Speicher. Jede Wanderung führt ein
/// Visited-Set, damit auch eine korrupte Schleife in der Datenbank terminiert (wie
/// `einheit::repo::kumuliere`).
#[derive(Debug, Default)]
struct Kanten {
    eltern: HashMap<i64, Option<i64>>,
    kinder: BTreeMap<i64, Vec<i64>>,
}

impl Kanten {
    async fn load(conn: &mut SqliteConnection, org_id: i64) -> Result<Self, AppError> {
        let zeilen: Vec<(i64, Option<i64>)> = sqlx::query_as(
            "SELECT id, ueber_vorlage_id FROM einheit_vorlage WHERE org_id = ? ORDER BY sortier, id",
        )
        .bind(org_id)
        .fetch_all(&mut *conn)
        .await?;
        let mut kanten = Kanten::default();
        for (id, ueber) in zeilen {
            kanten.eltern.insert(id, ueber);
            if let Some(u) = ueber {
                kanten.kinder.entry(u).or_default().push(id);
            }
        }
        Ok(kanten)
    }

    /// Die Wurzel des Baums von `id`. In einer korrupten Schleife gilt der Knoten als Wurzel, an
    /// dem die Wanderung sich selbst wieder trifft.
    fn wurzel(&self, id: i64) -> i64 {
        let mut besucht = HashSet::new();
        let mut aktuell = id;
        while besucht.insert(aktuell) {
            match self.eltern.get(&aktuell).copied().flatten() {
                Some(u) if self.eltern.contains_key(&u) => aktuell = u,
                _ => return aktuell,
            }
        }
        aktuell
    }

    /// `id` und alle Nachfahren, Eltern vor Kindern (Tiefensuche in Sortierfolge).
    fn nachfahren(&self, id: i64) -> Vec<i64> {
        let mut aus = Vec::new();
        let mut besucht = HashSet::new();
        let mut stapel = vec![id];
        while let Some(knoten) = stapel.pop() {
            if !besucht.insert(knoten) {
                continue;
            }
            aus.push(knoten);
            if let Some(kinder) = self.kinder.get(&knoten) {
                stapel.extend(kinder.iter().rev().copied());
            }
        }
        aus
    }

    /// Alle Vorlagen im selben Baum wie `id`, samt `id`.
    fn baum(&self, id: i64) -> Vec<i64> {
        self.nachfahren(self.wurzel(id))
    }

    /// Ob `start` unter `kandidat` zu stehen einen Zyklus bildete: `kandidat` ist `start` selbst
    /// oder einer seiner Nachfahren. Läuft von `kandidat` nach oben; eine korrupte Schleife
    /// unterwegs zählt als Zyklus.
    fn waere_zyklus(&self, start: i64, kandidat: i64) -> bool {
        let mut besucht = HashSet::new();
        let mut aktuell = Some(kandidat);
        while let Some(id) = aktuell {
            if id == start || !besucht.insert(id) {
                return true;
            }
            aktuell = self.eltern.get(&id).copied().flatten();
        }
        false
    }
}

// ── Lesen ────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
struct KopfZeile {
    id: i64,
    name: String,
    typ_id: i64,
    typ_label: String,
    ueber_vorlage_id: Option<i64>,
    funkrufname: Option<String>,
    tz_fachaufgabe: Option<String>,
    tz_organisation: Option<String>,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    typ_soll_fuehrer: Option<i64>,
    typ_soll_unterfuehrer: Option<i64>,
    typ_soll_mannschaft: Option<i64>,
    bemerkung: Option<String>,
    sortier: i64,
    aktiv: bool,
    ist_demo: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct FahrzeugZeile {
    vorlage_id: i64,
    vorlage_aktiv: bool,
    fahrzeug_id: i64,
    funkrufname: String,
    fahrzeugtyp: Option<String>,
    dienststatus: String,
    ist_demo: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct PersonalZeile {
    vorlage_id: i64,
    vorlage_aktiv: bool,
    personal_id: i64,
    name: String,
    staerke_position: Option<String>,
    fahrzeug_id: Option<i64>,
    dienststatus: String,
    ist_demo: bool,
}

/// Soll aus drei Spalten; nur ein vollständiges Trio gilt.
fn trio(f: Option<i64>, u: Option<i64>, m: Option<i64>) -> Option<Staerke> {
    Staerke::aus_optionen(f, u, m).ok().flatten()
}

/// Welche Köpfe [`load_where`] liefert.
enum Auswahl<'a> {
    /// Alle der Organisation, mit `true` nur die aktiven.
    Alle(bool),
    /// Genau diese, in der Reihenfolge der Liste.
    Ids(&'a [i64]),
}

/// Andere aktive Vorlagen je Zuordnung: `(eintrag_id) → [vorlage_id]`.
fn auch_in_index<'a>(paare: impl Iterator<Item = (i64, i64, bool)> + 'a) -> HashMap<i64, Vec<i64>> {
    let mut index: HashMap<i64, Vec<i64>> = HashMap::new();
    for (eintrag, vorlage, aktiv) in paare {
        if aktiv {
            index.entry(eintrag).or_default().push(vorlage);
        }
    }
    for v in index.values_mut() {
        v.sort_unstable();
    }
    index
}

fn ohne(liste: Option<&Vec<i64>>, selbst: i64) -> Vec<i64> {
    liste
        .map(|l| l.iter().copied().filter(|v| *v != selbst).collect())
        .unwrap_or_default()
}

async fn load_where(
    conn: &mut SqliteConnection,
    org_id: i64,
    auswahl: Auswahl<'_>,
) -> Result<Vec<EinheitVorlage>, AppError> {
    let (nur_aktive, ids) = match &auswahl {
        Auswahl::Alle(nur_aktive) => (*nur_aktive, None),
        Auswahl::Ids(ids) => (false, Some(json_ids(ids.iter().copied())?)),
    };
    let koepfe: Vec<KopfZeile> = sqlx::query_as(
        "SELECT v.id, v.name, v.typ_id, t.label AS typ_label, v.ueber_vorlage_id, \
                v.funkrufname, v.tz_fachaufgabe, v.tz_organisation, \
                v.soll_fuehrer, v.soll_unterfuehrer, v.soll_mannschaft, \
                t.soll_fuehrer AS typ_soll_fuehrer, t.soll_unterfuehrer AS typ_soll_unterfuehrer, \
                t.soll_mannschaft AS typ_soll_mannschaft, \
                v.bemerkung, v.sortier, v.aktiv, \
                EXISTS(SELECT 1 FROM demo_herkunft dh \
                       WHERE dh.tabelle = 'einheit_vorlage' AND dh.datensatz_id = v.id) AS ist_demo \
         FROM einheit_vorlage v JOIN einheit_typ t ON t.id = v.typ_id \
         WHERE v.org_id = ?1 AND (?2 = 0 OR v.aktiv = 1) \
           AND (?3 IS NULL OR v.id IN (SELECT value FROM json_each(?3))) \
         ORDER BY v.sortier, v.name COLLATE NOCASE, v.id",
    )
    .bind(org_id)
    .bind(nur_aktive)
    .bind(ids.as_deref())
    .fetch_all(&mut *conn)
    .await?;
    if koepfe.is_empty() {
        return Ok(Vec::new());
    }

    // Alle Zuordnungen der Organisation: `auch_in` braucht auch die der nicht gewählten Köpfe.
    let fahrzeuge: Vec<FahrzeugZeile> = sqlx::query_as(
        "SELECT x.vorlage_id, v.aktiv AS vorlage_aktiv, x.fahrzeug_id, f.funkrufname, \
                f.fahrzeugtyp, f.dienststatus, \
                EXISTS(SELECT 1 FROM demo_herkunft dh \
                       WHERE dh.tabelle = 'fahrzeug' AND dh.datensatz_id = f.id) AS ist_demo \
         FROM einheit_vorlage_fahrzeug x \
         JOIN einheit_vorlage v ON v.id = x.vorlage_id \
         JOIN fahrzeug f ON f.id = x.fahrzeug_id \
         WHERE v.org_id = ? \
         ORDER BY x.vorlage_id, x.sortier, f.funkrufname COLLATE NOCASE, f.id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    let personal: Vec<PersonalZeile> = sqlx::query_as(
        "SELECT x.vorlage_id, v.aktiv AS vorlage_aktiv, x.personal_id, p.name, \
                x.staerke_position, x.fahrzeug_id, p.dienststatus, \
                EXISTS(SELECT 1 FROM demo_herkunft dh \
                       WHERE dh.tabelle = 'personal' AND dh.datensatz_id = p.id) AS ist_demo \
         FROM einheit_vorlage_personal x \
         JOIN einheit_vorlage v ON v.id = x.vorlage_id \
         JOIN personal p ON p.id = x.personal_id \
         WHERE v.org_id = ? \
         ORDER BY x.vorlage_id, \
                  CASE COALESCE(x.staerke_position, p.staerke_position) \
                      WHEN 'fuehrer' THEN 0 WHEN 'unterfuehrer' THEN 1 \
                      WHEN 'mannschaft' THEN 2 ELSE 3 END, \
                  p.name COLLATE NOCASE, p.id",
    )
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;

    let fahrzeug_in = auch_in_index(
        fahrzeuge
            .iter()
            .map(|z| (z.fahrzeug_id, z.vorlage_id, z.vorlage_aktiv)),
    );
    let personal_in = auch_in_index(
        personal
            .iter()
            .map(|z| (z.personal_id, z.vorlage_id, z.vorlage_aktiv)),
    );
    let mut fahrzeuge_je: HashMap<i64, Vec<EinheitVorlageFahrzeug>> = HashMap::new();
    for z in fahrzeuge {
        fahrzeuge_je
            .entry(z.vorlage_id)
            .or_default()
            .push(EinheitVorlageFahrzeug {
                auch_in: ohne(fahrzeug_in.get(&z.fahrzeug_id), z.vorlage_id),
                fahrzeug_id: z.fahrzeug_id,
                funkrufname: z.funkrufname,
                fahrzeugtyp: z.fahrzeugtyp,
                dienststatus: z.dienststatus,
                ist_demo: z.ist_demo,
            });
    }
    let mut personal_je: HashMap<i64, Vec<EinheitVorlagePersonal>> = HashMap::new();
    for z in personal {
        personal_je
            .entry(z.vorlage_id)
            .or_default()
            .push(EinheitVorlagePersonal {
                auch_in: ohne(personal_in.get(&z.personal_id), z.vorlage_id),
                personal_id: z.personal_id,
                name: z.name,
                staerke_position: z
                    .staerke_position
                    .as_deref()
                    .and_then(StaerkePosition::parse),
                fahrzeug_id: z.fahrzeug_id,
                dienststatus: z.dienststatus,
                ist_demo: z.ist_demo,
            });
    }

    let mut vorlagen: Vec<EinheitVorlage> = koepfe
        .into_iter()
        .map(|k| {
            let eigen = trio(k.soll_fuehrer, k.soll_unterfuehrer, k.soll_mannschaft);
            EinheitVorlage {
                fahrzeuge: fahrzeuge_je.remove(&k.id).unwrap_or_default(),
                personal: personal_je.remove(&k.id).unwrap_or_default(),
                soll_eigen: eigen.is_some(),
                soll: eigen.or_else(|| {
                    trio(
                        k.typ_soll_fuehrer,
                        k.typ_soll_unterfuehrer,
                        k.typ_soll_mannschaft,
                    )
                }),
                id: k.id,
                name: k.name,
                typ_id: k.typ_id,
                typ_label: k.typ_label,
                ueber_vorlage_id: k.ueber_vorlage_id,
                funkrufname: k.funkrufname,
                tz_fachaufgabe: k.tz_fachaufgabe,
                tz_organisation: k.tz_organisation,
                bemerkung: k.bemerkung,
                sortier: k.sortier,
                aktiv: k.aktiv,
                ist_demo: k.ist_demo,
            }
        })
        .collect();
    if let Auswahl::Ids(ids) = auswahl {
        let rang: HashMap<i64, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        vorlagen.sort_by_key(|v| rang.get(&v.id).copied().unwrap_or(usize::MAX));
    }
    Ok(vorlagen)
}

/// Alle Vorlagen der Organisation, mit `nur_aktive` ohne die deaktivierten; sortiert nach
/// `sortier`, Name.
pub async fn list(
    pool: &SqlitePool,
    org_id: i64,
    nur_aktive: bool,
) -> Result<Vec<EinheitVorlage>, AppError> {
    let mut conn = pool.acquire().await?;
    load_where(&mut conn, org_id, Auswahl::Alle(nur_aktive)).await
}

/// Eine Vorlage der Organisation, auch deaktiviert; `NotFound` bei fremder oder unbekannter id.
pub async fn load_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
) -> Result<EinheitVorlage, AppError> {
    load_where(conn, org_id, Auswahl::Ids(&[id]))
        .await?
        .pop()
        .ok_or(AppError::NotFound)
}

/// Eine Vorlage samt allen aktiven Untereinheiten, für das Bilden im Einsatz (LLH-1049) in
/// dessen Transaktion. Die Wurzel steht vorn, Eltern vor ihren Kindern; unter einer deaktivierten
/// Untereinheit wird nicht weiter gesucht. Eine korrupte Schleife terminiert (Visited-Set).
/// `NotFound` bei fremder oder unbekannter Wurzel.
pub async fn load_tree_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    wurzel_id: i64,
) -> Result<Vec<EinheitVorlage>, AppError> {
    let wurzel = load_tx(conn, org_id, wurzel_id).await?;
    let kanten = Kanten::load(conn, org_id).await?;
    let aktiv: HashSet<i64> =
        sqlx::query_scalar("SELECT id FROM einheit_vorlage WHERE org_id = ? AND aktiv = 1")
            .bind(org_id)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();
    let mut ids = vec![wurzel.id];
    let mut besucht: HashSet<i64> = HashSet::from([wurzel.id]);
    let mut stapel: Vec<i64> = kanten
        .kinder
        .get(&wurzel.id)
        .map(|k| k.iter().rev().copied().collect())
        .unwrap_or_default();
    while let Some(id) = stapel.pop() {
        if !aktiv.contains(&id) || !besucht.insert(id) {
            continue;
        }
        ids.push(id);
        if let Some(kinder) = kanten.kinder.get(&id) {
            stapel.extend(kinder.iter().rev().copied());
        }
    }
    let mut vorlagen = load_where(conn, org_id, Auswahl::Ids(&ids[1..])).await?;
    vorlagen.insert(0, wurzel);
    Ok(vorlagen)
}

// ── Kopf schreiben ───────────────────────────────────────────────────────────────────────────

async fn check_typ(conn: &mut SqliteConnection, org_id: i64, typ_id: i64) -> Result<(), AppError> {
    if crate::einheit::typ_repo::ist_in_org(&mut *conn, org_id, typ_id).await? {
        Ok(())
    } else {
        Err(AppError::UnprocessableEntity(UNBEKANNTER_TYP.into()))
    }
}

/// Legt eine Vorlage an (aktiv) und liefert ihre id. Typ und übergeordnete Vorlage müssen zur
/// Organisation gehören (422); eine neue Vorlage kann keinen Zyklus bilden.
pub async fn create_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    daten: &NeueVorlage<'_>,
) -> Result<i64, AppError> {
    check_typ(conn, org_id, daten.typ_id).await?;
    if let Some(ueber) = daten.ueber_vorlage_id {
        let kanten = Kanten::load(conn, org_id).await?;
        if !kanten.eltern.contains_key(&ueber) {
            return Err(AppError::UnprocessableEntity(UNBEKANNTE_UEBER.into()));
        }
    }
    let (f, u, m) = match daten.soll {
        Some(s) => (
            Some(i64::from(s.fuehrer)),
            Some(i64::from(s.unterfuehrer)),
            Some(i64::from(s.mannschaft)),
        ),
        None => (None, None, None),
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_vorlage (org_id, name, typ_id, ueber_vorlage_id, funkrufname, \
             tz_fachaufgabe, tz_organisation, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, \
             bemerkung, sortier) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(daten.name)
    .bind(daten.typ_id)
    .bind(daten.ueber_vorlage_id)
    .bind(daten.funkrufname)
    .bind(daten.tz_fachaufgabe)
    .bind(daten.tz_organisation)
    .bind(f)
    .bind(u)
    .bind(m)
    .bind(daten.bemerkung)
    .bind(daten.sortier)
    .fetch_one(&mut *conn)
    .await
    .map_err(AppError::from)
    .or_else(map_name_conflict)?;
    Ok(id)
}

/// [`create_tx`] in einer eigenen Transaktion; Name doppelt unter den aktiven → `Conflict`.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    daten: NeueVorlage<'_>,
) -> Result<EinheitVorlage, AppError> {
    write_retry!(pool, |conn| {
        let id = create_tx(conn, org_id, &daten).await?;
        load_tx(conn, org_id, id).await
    })
}

/// Erste Kennung (Funkrufname bzw. Name), die in beiden Vorlagen-Mengen zugleich steht. Die
/// Mengen sind JSON-Arrays von Vorlagen-ids.
async fn first_overlap(
    conn: &mut SqliteConnection,
    links: &str,
    rechts: &str,
) -> Result<Option<String>, AppError> {
    let fahrzeug: Option<String> = sqlx::query_scalar(
        "SELECT 'Fahrzeug «' || f.funkrufname || '»' \
         FROM einheit_vorlage_fahrzeug a JOIN fahrzeug f ON f.id = a.fahrzeug_id \
         WHERE a.vorlage_id IN (SELECT value FROM json_each(?1)) \
           AND a.fahrzeug_id IN (SELECT b.fahrzeug_id FROM einheit_vorlage_fahrzeug b \
                                 WHERE b.vorlage_id IN (SELECT value FROM json_each(?2))) \
         ORDER BY f.funkrufname LIMIT 1",
    )
    .bind(links)
    .bind(rechts)
    .fetch_optional(&mut *conn)
    .await?;
    if fahrzeug.is_some() {
        return Ok(fahrzeug);
    }
    sqlx::query_scalar(
        "SELECT '«' || p.name || '»' \
         FROM einheit_vorlage_personal a JOIN personal p ON p.id = a.personal_id \
         WHERE a.vorlage_id IN (SELECT value FROM json_each(?1)) \
           AND a.personal_id IN (SELECT b.personal_id FROM einheit_vorlage_personal b \
                                 WHERE b.vorlage_id IN (SELECT value FROM json_each(?2))) \
         ORDER BY p.name LIMIT 1",
    )
    .bind(links)
    .bind(rechts)
    .fetch_optional(&mut *conn)
    .await
    .map_err(Into::into)
}

/// Teil-Patch einer Vorlage auf der Verbindung des Aufrufers. `NotFound` bei fremder oder
/// unbekannter id; Soll nach dem Patch unvollständig → 400; fremder Typ, fremde oder zyklische
/// Unterstellung → 422; eine Unterstellung, nach der ein Fahrzeug oder eine Person zweimal im
/// selben Baum stünde → 422; Name doppelt unter den aktiven → `Conflict`.
pub async fn update_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: i64,
    patch: &VorlagePatch<'_>,
) -> Result<(), AppError> {
    let bestand: (Option<i64>, Option<i64>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT soll_fuehrer, soll_unterfuehrer, soll_mannschaft, ueber_vorlage_id \
         FROM einheit_vorlage WHERE id = ? AND org_id = ?",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;

    // Soll gegen den Effektivzustand (Muster `routes::einheit_typ::normalisiere_patch`):
    // geschrieben wird nur der Patch.
    let effektiv =
        |patch: Option<Option<i64>>, gespeichert: Option<i64>| patch.unwrap_or(gespeichert);
    Staerke::aus_optionen(
        effektiv(patch.soll_fuehrer, bestand.0),
        effektiv(patch.soll_unterfuehrer, bestand.1),
        effektiv(patch.soll_mannschaft, bestand.2),
    )
    .map_err(AppError::Validation)?;

    if let Some(typ_id) = patch.typ_id {
        check_typ(conn, org_id, typ_id).await?;
    }
    if let Some(Some(ueber)) = patch.ueber_vorlage_id {
        if bestand.3 != Some(ueber) {
            let kanten = Kanten::load(conn, org_id).await?;
            if !kanten.eltern.contains_key(&ueber) {
                return Err(AppError::UnprocessableEntity(UNBEKANNTE_UEBER.into()));
            }
            if kanten.waere_zyklus(id, ueber) {
                return Err(AppError::UnprocessableEntity(ZYKLUS.into()));
            }
            let teilbaum = kanten.nachfahren(id);
            let innen: HashSet<i64> = teilbaum.iter().copied().collect();
            let ziel = kanten
                .baum(ueber)
                .into_iter()
                .filter(|v| !innen.contains(v));
            if let Some(doppelt) =
                first_overlap(conn, &json_ids(teilbaum)?, &json_ids(ziel)?).await?
            {
                return Err(AppError::UnprocessableEntity(format!(
                    "{doppelt} steht schon im Baum der übergeordneten Vorlage"
                )));
            }
        }
    }

    // Flag/Wert-Paare wie in `externe_stelle::repo::update`: ein nicht gesendetes Feld bleibt,
    // `Some(None)` leert. Nummerierte Parameter gegen still vertauschte Nachbarn.
    sqlx::query(
        "UPDATE einheit_vorlage SET \
            name = CASE WHEN ?1 IS NULL THEN name ELSE ?2 END, \
            typ_id = CASE WHEN ?3 IS NULL THEN typ_id ELSE ?4 END, \
            ueber_vorlage_id = CASE WHEN ?5 IS NULL THEN ueber_vorlage_id ELSE ?6 END, \
            funkrufname = CASE WHEN ?7 IS NULL THEN funkrufname ELSE ?8 END, \
            tz_fachaufgabe = CASE WHEN ?9 IS NULL THEN tz_fachaufgabe ELSE ?10 END, \
            tz_organisation = CASE WHEN ?11 IS NULL THEN tz_organisation ELSE ?12 END, \
            soll_fuehrer = CASE WHEN ?13 IS NULL THEN soll_fuehrer ELSE ?14 END, \
            soll_unterfuehrer = CASE WHEN ?15 IS NULL THEN soll_unterfuehrer ELSE ?16 END, \
            soll_mannschaft = CASE WHEN ?17 IS NULL THEN soll_mannschaft ELSE ?18 END, \
            bemerkung = CASE WHEN ?19 IS NULL THEN bemerkung ELSE ?20 END, \
            sortier = CASE WHEN ?21 IS NULL THEN sortier ELSE ?22 END, \
            aktiv = CASE WHEN ?23 IS NULL THEN aktiv ELSE ?24 END \
         WHERE id = ?25 AND org_id = ?26",
    )
    .bind(patch.name.map(|_| 1_i64))
    .bind(patch.name)
    .bind(patch.typ_id.map(|_| 1_i64))
    .bind(patch.typ_id)
    .bind(patch.ueber_vorlage_id.map(|_| 1_i64))
    .bind(patch.ueber_vorlage_id.flatten())
    .bind(patch.funkrufname.map(|_| 1_i64))
    .bind(patch.funkrufname.flatten())
    .bind(patch.tz_fachaufgabe.map(|_| 1_i64))
    .bind(patch.tz_fachaufgabe.flatten())
    .bind(patch.tz_organisation.map(|_| 1_i64))
    .bind(patch.tz_organisation.flatten())
    .bind(patch.soll_fuehrer.map(|_| 1_i64))
    .bind(patch.soll_fuehrer.flatten())
    .bind(patch.soll_unterfuehrer.map(|_| 1_i64))
    .bind(patch.soll_unterfuehrer.flatten())
    .bind(patch.soll_mannschaft.map(|_| 1_i64))
    .bind(patch.soll_mannschaft.flatten())
    .bind(patch.bemerkung.map(|_| 1_i64))
    .bind(patch.bemerkung.flatten())
    .bind(patch.sortier.map(|_| 1_i64))
    .bind(patch.sortier)
    .bind(patch.aktiv.map(|_| 1_i64))
    .bind(patch.aktiv)
    .bind(id)
    .bind(org_id)
    .execute(&mut *conn)
    .await
    .map_err(AppError::from)
    .or_else(map_name_conflict)?;
    Ok(())
}

/// [`update_tx`] in einer eigenen Transaktion; liefert die Vorlage nach dem Patch.
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    id: i64,
    patch: VorlagePatch<'_>,
) -> Result<EinheitVorlage, AppError> {
    write_retry!(pool, |conn| {
        update_tx(conn, org_id, id, &patch).await?;
        load_tx(conn, org_id, id).await
    })
}

// ── Zuordnungen ──────────────────────────────────────────────────────────────────────────────

/// Prüft, dass die Vorlage zur Organisation gehört, und liefert die übrigen Vorlagen ihres Baums.
async fn other_tree_members(
    conn: &mut SqliteConnection,
    org_id: i64,
    vorlage_id: i64,
) -> Result<Vec<i64>, AppError> {
    let kanten = Kanten::load(conn, org_id).await?;
    if !kanten.eltern.contains_key(&vorlage_id) {
        return Err(AppError::NotFound);
    }
    Ok(kanten
        .baum(vorlage_id)
        .into_iter()
        .filter(|v| *v != vorlage_id)
        .collect())
}

/// Bewertet einen Verweis auf eine Stammzeile: fremd oder unbekannt → 422, neu und außer Dienst
/// → 422. `bekannt` sind die Zeilen `(id, dienststatus, schon_zugeordnet)` der eigenen Org.
fn check_zuordenbar(
    ids: impl Iterator<Item = i64>,
    bekannt: &[(i64, String, bool)],
    art: &str,
) -> Result<(), AppError> {
    let index: HashMap<i64, (&str, bool)> = bekannt
        .iter()
        .map(|(id, status, schon)| (*id, (status.as_str(), *schon)))
        .collect();
    for id in ids {
        match index.get(&id) {
            None => {
                return Err(AppError::UnprocessableEntity(format!(
                    "{art} {id} gehört nicht zur Organisation"
                )))
            }
            Some((status, false)) if *status != DIENSTSTATUS_IN_DIENST => {
                return Err(AppError::UnprocessableEntity(format!(
                    "{art} {id} ist außer Dienst und kann nicht neu zugeordnet werden"
                )))
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// Ersetzt die Stamm-Fahrzeuge der Vorlage durch genau `ids` (schon entdoppelt und gedeckelt,
/// [`super::normalize_fahrzeug_ids`]); die Reihenfolge ist die Anzeigereihenfolge.
///
/// Fremd oder unbekannt → 422; neu und außer Dienst → 422 (ein schon zugeordnetes darf bleiben);
/// schon in einer anderen Vorlage desselben Baums → 422. Personen auf einem entfernten Fahrzeug
/// verlieren ihre Bindung in derselben Transaktion. Prüfen und Schreiben brauchen unabhängig von
/// der Länge der Liste gleich viele Anweisungen (`json_each`).
pub async fn replace_fahrzeuge_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    vorlage_id: i64,
    ids: &[i64],
) -> Result<(), AppError> {
    let baum = other_tree_members(conn, org_id, vorlage_id).await?;
    let ids_json = json_ids(ids.iter().copied())?;
    let bekannt: Vec<(i64, String, bool)> = sqlx::query_as(
        "SELECT f.id, f.dienststatus, \
                EXISTS(SELECT 1 FROM einheit_vorlage_fahrzeug x \
                       WHERE x.vorlage_id = ?1 AND x.fahrzeug_id = f.id) \
         FROM fahrzeug f \
         WHERE f.id IN (SELECT value FROM json_each(?2)) AND f.org_id = ?3",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    check_zuordenbar(ids.iter().copied(), &bekannt, "Fahrzeug")?;

    let doppelt: Option<(String, String)> = sqlx::query_as(
        "SELECT f.funkrufname, v.name \
         FROM einheit_vorlage_fahrzeug x \
         JOIN fahrzeug f ON f.id = x.fahrzeug_id \
         JOIN einheit_vorlage v ON v.id = x.vorlage_id \
         WHERE x.vorlage_id IN (SELECT value FROM json_each(?1)) \
           AND x.fahrzeug_id IN (SELECT value FROM json_each(?2)) \
         ORDER BY f.funkrufname LIMIT 1",
    )
    .bind(json_ids(baum)?)
    .bind(&ids_json)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((funkrufname, vorlage)) = doppelt {
        return Err(AppError::UnprocessableEntity(format!(
            "Fahrzeug «{funkrufname}» steht schon in «{vorlage}» im selben Vorlagen-Baum"
        )));
    }

    sqlx::query(
        "DELETE FROM einheit_vorlage_fahrzeug \
         WHERE vorlage_id = ?1 AND fahrzeug_id NOT IN (SELECT value FROM json_each(?2))",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO einheit_vorlage_fahrzeug (vorlage_id, fahrzeug_id, sortier) \
         SELECT ?1, value, key FROM json_each(?2) WHERE true \
         ON CONFLICT (vorlage_id, fahrzeug_id) DO UPDATE SET sortier = excluded.sortier",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einheit_vorlage_personal SET fahrzeug_id = NULL \
         WHERE vorlage_id = ?1 AND fahrzeug_id IS NOT NULL \
           AND fahrzeug_id NOT IN (SELECT value FROM json_each(?2))",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// [`replace_fahrzeuge_tx`] in einer eigenen Transaktion; liefert die Vorlage danach.
pub async fn replace_fahrzeuge(
    pool: &SqlitePool,
    org_id: i64,
    vorlage_id: i64,
    ids: &[i64],
) -> Result<EinheitVorlage, AppError> {
    write_retry!(pool, |conn| {
        replace_fahrzeuge_tx(conn, org_id, vorlage_id, ids).await?;
        load_tx(conn, org_id, vorlage_id).await
    })
}

/// Ersetzt die Stammbesetzung der Vorlage durch genau `eintraege` (schon entdoppelt und
/// gedeckelt, [`super::normalize_personal`]).
///
/// Fremd oder unbekannt → 422; neu und außer Dienst → 422; ein Fahrzeug, das nicht zur Vorlage
/// gehört → 422; schon in einer anderen Vorlage desselben Baums → 422.
pub async fn replace_personal_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    vorlage_id: i64,
    eintraege: &[PersonalEintrag],
) -> Result<(), AppError> {
    let baum = other_tree_members(conn, org_id, vorlage_id).await?;
    let ids_json = json_ids(eintraege.iter().map(|e| e.personal_id))?;
    let bekannt: Vec<(i64, String, bool)> = sqlx::query_as(
        "SELECT p.id, p.dienststatus, \
                EXISTS(SELECT 1 FROM einheit_vorlage_personal x \
                       WHERE x.vorlage_id = ?1 AND x.personal_id = p.id) \
         FROM personal p \
         WHERE p.id IN (SELECT value FROM json_each(?2)) AND p.org_id = ?3",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .bind(org_id)
    .fetch_all(&mut *conn)
    .await?;
    check_zuordenbar(eintraege.iter().map(|e| e.personal_id), &bekannt, "Person")?;

    let fahrzeuge: HashSet<i64> =
        sqlx::query_scalar("SELECT fahrzeug_id FROM einheit_vorlage_fahrzeug WHERE vorlage_id = ?")
            .bind(vorlage_id)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .collect();
    if let Some(fremd) = eintraege
        .iter()
        .filter_map(|e| e.fahrzeug_id)
        .find(|f| !fahrzeuge.contains(f))
    {
        return Err(AppError::UnprocessableEntity(format!(
            "Fahrzeug {fremd} gehört nicht zu dieser Vorlage"
        )));
    }

    let doppelt: Option<(String, String)> = sqlx::query_as(
        "SELECT p.name, v.name \
         FROM einheit_vorlage_personal x \
         JOIN personal p ON p.id = x.personal_id \
         JOIN einheit_vorlage v ON v.id = x.vorlage_id \
         WHERE x.vorlage_id IN (SELECT value FROM json_each(?1)) \
           AND x.personal_id IN (SELECT value FROM json_each(?2)) \
         ORDER BY p.name LIMIT 1",
    )
    .bind(json_ids(baum)?)
    .bind(&ids_json)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((person, vorlage)) = doppelt {
        return Err(AppError::UnprocessableEntity(format!(
            "«{person}» steht schon in «{vorlage}» im selben Vorlagen-Baum"
        )));
    }

    let zeilen = serde_json::to_string(
        &eintraege
            .iter()
            .map(|e| {
                serde_json::json!({
                    "p": e.personal_id,
                    "f": e.fahrzeug_id,
                    "s": e.staerke_position.map(|s| s.as_str()),
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(format!("Stammbesetzung serialisieren: {e}")))?;
    sqlx::query(
        "DELETE FROM einheit_vorlage_personal \
         WHERE vorlage_id = ?1 AND personal_id NOT IN (SELECT value FROM json_each(?2))",
    )
    .bind(vorlage_id)
    .bind(&ids_json)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO einheit_vorlage_personal \
            (vorlage_id, personal_id, fahrzeug_id, staerke_position) \
         SELECT ?1, json_extract(value, '$.p'), json_extract(value, '$.f'), \
                json_extract(value, '$.s') \
         FROM json_each(?2) WHERE true \
         ON CONFLICT (vorlage_id, personal_id) DO UPDATE SET \
            fahrzeug_id = excluded.fahrzeug_id, staerke_position = excluded.staerke_position",
    )
    .bind(vorlage_id)
    .bind(&zeilen)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// [`replace_personal_tx`] in einer eigenen Transaktion; liefert die Vorlage danach.
pub async fn replace_personal(
    pool: &SqlitePool,
    org_id: i64,
    vorlage_id: i64,
    eintraege: &[PersonalEintrag],
) -> Result<EinheitVorlage, AppError> {
    write_retry!(pool, |conn| {
        replace_personal_tx(conn, org_id, vorlage_id, eintraege).await?;
        load_tx(conn, org_id, vorlage_id).await
    })
}

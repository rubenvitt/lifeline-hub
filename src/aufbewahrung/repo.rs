//! Lesende Abfragen der Aufbewahrung (LFH-23). Jedes SELECT entsteht aus den Konstanten in
//! [`super::projektion`] — eine Spalte, die dort nicht steht, liest dieses Modul nicht.

use super::projektion::{ANTRAG, ETB, ETB_ERFASSER_JOIN, KOPF, PERSON, SCHADEN, TIER};
use super::{
    ArchivAkteAnzeige, ArchivEtbEintragAnzeige, ArchivKopfAnzeige, ArchivPersonAnzeige,
    ArchivSchadenAnzeige, ArchivTierAnzeige, AufbewahrungEintragAnzeige,
};
use crate::einsatz::retention::{karenz_ende, skelett_loeschung_am, zustand, AufbewahrungZustand};
use crate::einsatz::{Einsatzart, STATUS_ABGESCHLOSSEN};
use crate::error::AppError;
use crate::etb::{EtbTyp, MeldeWeg};
use crate::person::{PersonStatus, Sichtungskategorie, VerbleibArt, VerbleibStatus};
use chrono::{DateTime, Utc};
use sqlx::{AssertSqlSafe, SqlitePool};

/// Zeile aus [`KOPF`]. Feldnamen = Spaltennamen (FromRow).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct KopfZeile {
    pub id: i64,
    pub org_id: i64,
    pub bezeichnung: String,
    pub stichwort: Option<String>,
    pub status: String,
    #[sqlx(try_from = "String")]
    pub einsatzart: Einsatzart,
    pub einsatznummer_intern: Option<String>,
    pub leitstellen_nr: Option<String>,
    pub begonnen_at: String,
    pub abgeschlossen_at: Option<String>,
    pub anzahl_betroffene_initial: Option<i64>,
    pub retention_bis: Option<String>,
    pub geloescht_at: Option<String>,
    pub geschwaerzt_at: Option<String>,
    /// Fälligkeit eines offenen Einsatz-Antrags (LFH-751), aus [`super::projektion::ANTRAG`].
    pub antrag_faellig_at: Option<String>,
}

impl KopfZeile {
    /// Aufbewahrungszustand zu `jetzt` unter der Skelett-Frist der Org (LFH-750); `None` für
    /// aktive Einsätze.
    pub fn zustand(
        &self,
        skelett_dauer_tage: Option<i64>,
        jetzt: DateTime<Utc>,
    ) -> Option<AufbewahrungZustand> {
        zustand(
            &self.status,
            self.retention_bis.as_deref(),
            self.geloescht_at.as_deref(),
            self.geschwaerzt_at.as_deref(),
            self.antrag_faellig_at.as_deref(),
            self.abgeschlossen_at.as_deref(),
            skelett_dauer_tage,
            jetzt,
        )
    }

    fn anzeige(&self) -> ArchivKopfAnzeige {
        ArchivKopfAnzeige {
            id: self.id,
            bezeichnung: self.bezeichnung.clone(),
            stichwort: self.stichwort.clone(),
            einsatzart: self.einsatzart,
            einsatznummer_intern: self.einsatznummer_intern.clone(),
            leitstellen_nr: self.leitstellen_nr.clone(),
            begonnen_at: self.begonnen_at.clone(),
            abgeschlossen_at: self.abgeschlossen_at.clone(),
            anzahl_betroffene_initial: self.anzahl_betroffene_initial,
            retention_bis: self.retention_bis.clone(),
            geloescht_at: self.geloescht_at.clone(),
            geschwaerzt_at: self.geschwaerzt_at.clone(),
        }
    }
}

#[derive(sqlx::FromRow)]
struct PersonZeile {
    id: i64,
    registrier_nr: i64,
    #[sqlx(try_from = "String")]
    status: PersonStatus,
    aktuelle_sichtung: Option<Sichtungskategorie>,
    aktuelle_verbleib_art: Option<VerbleibArt>,
    aktueller_verbleib_status: Option<VerbleibStatus>,
    erfasst_at: String,
    storniert_at: Option<String>,
}

#[derive(sqlx::FromRow)]
struct TierZeile {
    registrier_nr: i64,
    spezies: crate::tier::Spezies,
    status: crate::tier::TierStatus,
    abschluss_grund: Option<crate::tier::AbschlussGrund>,
    erfasst_at: String,
    storniert_at: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SchadenZeile {
    registrier_nr: i64,
    typ: crate::schaden::SchadenTyp,
    ausmass: crate::schaden::Ausmass,
    status: crate::schaden::SchadenStatus,
    abschluss_grund: Option<crate::schaden::AbschlussGrund>,
    erfasst_at: String,
    storniert_at: Option<String>,
}

#[derive(sqlx::FromRow)]
struct EtbZeile {
    id: i64,
    lfd_nr: i64,
    typ: EtbTyp,
    inhalt: String,
    von: Option<String>,
    an: Option<String>,
    meldeweg: Option<MeldeWeg>,
    veranlassung: Option<String>,
    erfasser_id: i64,
    erfasser_name: String,
    erfasser_funktion: Option<String>,
    ereigniszeit: String,
    received_at: String,
    berichtigt_eintrag_id: Option<i64>,
}

/// `SELECT <KOPF>, <offener Einsatz-Antrag> FROM einsatz k` — Basis für Übersicht und Akte.
/// Die Fälligkeit des offenen Einsatz-Antrags (LFH-751) kommt als Unterabfrage über Spalten
/// aus [`ANTRAG`] (alle Retain).
fn kopf_select() -> String {
    format!(
        "SELECT {}, (SELECT a.faellig_at FROM {} a WHERE a.einsatz_id = k.id \
           AND a.ziel_art = 'einsatz' AND a.zurueckgenommen_at IS NULL \
           AND a.vollzogen_at IS NULL) AS antrag_faellig_at \
         FROM {} k",
        KOPF.select_liste("k"),
        ANTRAG.tabelle,
        KOPF.tabelle
    )
}

/// Lädt den Kopf eines Einsatzes; `None`, wenn es ihn nicht gibt (→ 404).
pub async fn kopf_laden(pool: &SqlitePool, einsatz_id: i64) -> Result<Option<KopfZeile>, AppError> {
    let sql = format!("{} WHERE k.id = ?", kopf_select());
    Ok(sqlx::query_as::<_, KopfZeile>(AssertSqlSafe(sql))
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?)
}

/// Übersicht: alle ABGESCHLOSSENEN Einsätze der Organisation `org_id`, neueste Abschlüsse
/// zuerst. Aktive und fremde Einsätze fehlen. Liest nur, schreibt nichts.
pub async fn uebersicht(
    pool: &SqlitePool,
    org_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<Vec<AufbewahrungEintragAnzeige>, AppError> {
    let skelett_dauer_tage = skelett_dauer_tage(pool, org_id).await?;
    let sql = format!(
        "{} WHERE k.org_id = ? AND k.status = ? ORDER BY k.abgeschlossen_at DESC, k.id DESC",
        kopf_select()
    );
    let zeilen = sqlx::query_as::<_, KopfZeile>(AssertSqlSafe(sql))
        .bind(org_id)
        .bind(STATUS_ABGESCHLOSSEN)
        .fetch_all(pool)
        .await?;
    let mut liste: Vec<AufbewahrungEintragAnzeige> = zeilen
        .into_iter()
        .filter_map(|k| {
            let zustand = k.zustand(skelett_dauer_tage, jetzt)?;
            Some(AufbewahrungEintragAnzeige {
                einsatz_id: k.id,
                einsatznummer_intern: k.einsatznummer_intern,
                bezeichnung: Some(k.bezeichnung),
                karenz_ende: karenz_ende(k.geloescht_at.as_deref()),
                loeschung_am: skelett_loeschung_am(
                    k.abgeschlossen_at.as_deref(),
                    k.geschwaerzt_at.as_deref(),
                    skelett_dauer_tage,
                ),
                abgeschlossen_at: k.abgeschlossen_at,
                retention_bis: k.retention_bis,
                geloescht_at: k.geloescht_at,
                geschwaerzt_at: k.geschwaerzt_at,
                antrag_faellig_at: k.antrag_faellig_at,
                endgueltig_geloescht_at: None,
                zustand,
            })
        })
        .collect();

    // Endgültig gelöschte Einsätze (LFH-750): nur das Löschprotokoll der eigenen Org, ohne
    // Bezeichnung.
    let geloescht = sqlx::query_as::<_, ProtokollZeile>(
        "SELECT einsatz_id, einsatznummer_intern, abgeschlossen_at, geschwaerzt_at, geloescht_at \
         FROM aufbewahrung_loeschprotokoll WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    liste.extend(geloescht.into_iter().map(|p| AufbewahrungEintragAnzeige {
        einsatz_id: p.einsatz_id,
        einsatznummer_intern: p.einsatznummer_intern,
        bezeichnung: None,
        abgeschlossen_at: p.abgeschlossen_at,
        retention_bis: None,
        geloescht_at: None,
        karenz_ende: None,
        geschwaerzt_at: Some(p.geschwaerzt_at),
        loeschung_am: None,
        endgueltig_geloescht_at: Some(p.geloescht_at),
        // Ein gelöschter Einsatz hat keine Anträge mehr (CASCADE mit dem Einsatz, LFH-750).
        antrag_faellig_at: None,
        zustand: AufbewahrungZustand::EndgueltigGeloescht,
    }));
    // Neuester Abschluss zuerst über beide Mengen (kanonisches Format sortiert lexikografisch).
    liste.sort_by(|a, b| {
        b.abgeschlossen_at
            .cmp(&a.abgeschlossen_at)
            .then(b.einsatz_id.cmp(&a.einsatz_id))
    });
    Ok(liste)
}

/// Zeile des Löschprotokolls für die Übersicht (LFH-750).
#[derive(Debug, sqlx::FromRow)]
struct ProtokollZeile {
    einsatz_id: i64,
    einsatznummer_intern: Option<String>,
    abgeschlossen_at: Option<String>,
    geschwaerzt_at: String,
    geloescht_at: String,
}

/// Register-SELECT einer Quelle, stornierte eingeschlossen, nach Registriernummer.
fn register_sql(p: &super::projektion::Projektion) -> String {
    format!(
        "SELECT {} FROM {} r WHERE r.einsatz_id = ? ORDER BY r.registrier_nr",
        p.select_liste("r"),
        p.tabelle
    )
}

/// Skelett-Frist der Org in Tagen ab Abschluss (LFH-750); `None` = das Skelett bleibt.
async fn skelett_dauer_tage(pool: &SqlitePool, org_id: i64) -> Result<Option<i64>, AppError> {
    Ok(crate::org::einstellungen::laden_oder_default(pool, org_id)
        .await?
        .skelett_dauer_tage)
}

/// Baut die Archivakte zu einem bereits geladenen, zugriffsgeprüften Kopf.
/// Fehler, wenn der Einsatz aktiv ist (kein Aufbewahrungszustand).
pub async fn akte(
    pool: &SqlitePool,
    kopf: &KopfZeile,
    jetzt: DateTime<Utc>,
) -> Result<ArchivAkteAnzeige, AppError> {
    let skelett_dauer_tage = skelett_dauer_tage(pool, kopf.org_id).await?;
    let zustand = kopf
        .zustand(skelett_dauer_tage, jetzt)
        .ok_or_else(|| AppError::Conflict("Einsatz ist nicht abgeschlossen".into()))?;
    // Auf Antrag geschwärzte Betroffene (LFH-751): Personen-ID → Zeitpunkt des Vollzugs.
    let auf_antrag: std::collections::HashMap<i64, String> =
        sqlx::query_as::<_, (i64, String)>(AssertSqlSafe(format!(
            "SELECT a.ziel_id, a.vollzogen_at FROM {} a WHERE a.einsatz_id = ? \
               AND a.ziel_art = 'betroffene' AND a.vollzogen_at IS NOT NULL",
            ANTRAG.tabelle
        )))
        .bind(kopf.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .collect();
    let personen = sqlx::query_as::<_, PersonZeile>(AssertSqlSafe(register_sql(&PERSON)))
        .bind(kopf.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|p| ArchivPersonAnzeige {
            auf_antrag_geschwaerzt_at: auf_antrag.get(&p.id).cloned(),
            registrier_anzeige: crate::person::registrier_anzeige(p.registrier_nr),
            registrier_nr: p.registrier_nr,
            status: p.status,
            aktuelle_sichtung: p.aktuelle_sichtung,
            aktuelle_verbleib_art: p.aktuelle_verbleib_art,
            aktueller_verbleib_status: p.aktueller_verbleib_status,
            erfasst_at: p.erfasst_at,
            storniert_at: p.storniert_at,
        })
        .collect();
    let tiere = sqlx::query_as::<_, TierZeile>(AssertSqlSafe(register_sql(&TIER)))
        .bind(kopf.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|t| ArchivTierAnzeige {
            registrier_anzeige: crate::tier::registrier_anzeige(t.registrier_nr),
            registrier_nr: t.registrier_nr,
            spezies: t.spezies,
            status: t.status,
            abschluss_grund: t.abschluss_grund,
            erfasst_at: t.erfasst_at,
            storniert_at: t.storniert_at,
        })
        .collect();
    let schaeden = sqlx::query_as::<_, SchadenZeile>(AssertSqlSafe(register_sql(&SCHADEN)))
        .bind(kopf.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|s| ArchivSchadenAnzeige {
            registrier_anzeige: crate::schaden::registrier_anzeige(s.registrier_nr),
            registrier_nr: s.registrier_nr,
            typ: s.typ,
            ausmass: s.ausmass,
            status: s.status,
            abschluss_grund: s.abschluss_grund,
            erfasst_at: s.erfasst_at,
            storniert_at: s.storniert_at,
        })
        .collect();
    let kategorien = crate::einsatz::aufbewahrung_kategorie::anzeige(
        pool,
        crate::einsatz::aufbewahrung_kategorie::EinsatzStand {
            einsatz_id: kopf.id,
            org_id: kopf.org_id,
            status: &kopf.status,
            geschwaerzt_at: kopf.geschwaerzt_at.as_deref(),
        },
        jetzt,
    )
    .await?;
    Ok(ArchivAkteAnzeige {
        kopf: kopf.anzeige(),
        zustand,
        karenz_ende: karenz_ende(kopf.geloescht_at.as_deref()),
        antrag_faellig_at: kopf.antrag_faellig_at.clone(),
        kategorien,
        personen,
        tiere,
        schaeden,
    })
}

/// Filter des Archiv-ETB: Typ, Cursor über die laufende Nummer, Seitengröße (vom Handler
/// auf `[1, etb::repo::MAX_LIMIT]` geklemmt).
#[derive(Debug, Clone, Copy)]
pub struct ArchivEtbFilter {
    pub typ: Option<EtbTyp>,
    pub before_lfd_nr: Option<i64>,
    pub limit: i64,
}

/// Archiv-ETB im Wortlaut, neueste zuerst. Eine eigene, schmale Abfrage statt
/// `etb::repo::abfrage`, dessen Rückgabetyp mit neuen Modulen wächst.
pub async fn etb(
    pool: &SqlitePool,
    einsatz_id: i64,
    filter: ArchivEtbFilter,
) -> Result<Vec<ArchivEtbEintragAnzeige>, AppError> {
    let (join_tabelle, join_spalte, join_alias) = ETB_ERFASSER_JOIN;
    let sql = format!(
        "SELECT {}, j.{join_spalte} AS {join_alias} FROM {} e \
         JOIN {join_tabelle} j ON j.id = e.erfasser_id \
         WHERE e.einsatz_id = ?1 \
           AND (?2 IS NULL OR e.typ = ?2) \
           AND (?3 IS NULL OR e.lfd_nr < ?3) \
         ORDER BY e.lfd_nr DESC LIMIT ?4",
        ETB.select_liste("e"),
        ETB.tabelle,
    );
    let zeilen = sqlx::query_as::<_, EtbZeile>(AssertSqlSafe(sql))
        .bind(einsatz_id)
        .bind(filter.typ.map(|t| t.as_str()))
        .bind(filter.before_lfd_nr)
        .bind(filter.limit)
        .fetch_all(pool)
        .await?;
    Ok(zeilen
        .into_iter()
        .map(|z| ArchivEtbEintragAnzeige {
            id: z.id,
            lfd_nr: z.lfd_nr,
            typ: z.typ,
            inhalt: z.inhalt,
            von: z.von,
            an: z.an,
            meldeweg: z.meldeweg,
            veranlassung: z.veranlassung,
            erfasser_id: z.erfasser_id,
            erfasser_name: z.erfasser_name,
            erfasser_funktion: z.erfasser_funktion,
            ereigniszeit: z.ereigniszeit,
            received_at: z.received_at,
            berichtigt_eintrag_id: z.berichtigt_eintrag_id,
        })
        .collect())
}

/// `(geloescht_at, geschwaerzt_at)` eines Einsatzes — ein schmaler Abruf, damit
/// `einsatz::Einsatz` kein neues Feld braucht. Unbekannter Einsatz → 404.
pub async fn tombstones(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<(Option<String>, Option<String>), AppError> {
    sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

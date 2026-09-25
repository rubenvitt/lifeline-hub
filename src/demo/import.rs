//! Import des Demo-Szenarios (LFH-690, design.md D5, D6, D8, D9).
//!
//! [`importieren_tx`] legt in **einer** Transaktion des Aufrufers an: Einsatz, Kopf,
//! Stammdaten und das [`szenario::DREHBUCH`] in Zeitfolge. Jeder Vorgang läuft über die
//! `_tx`-Funktion des Fach-Repos und schreibt den System-ETB-Eintrag, den der Handler im
//! Betrieb schreibt, mit derselben Textfunktion über [`crate::etb::system_audit_tx`]
//! (D5). Degradiert wird nichts: scheitert ein Eintrag, scheitert der Import, und der
//! Aufrufer rollt alles zurück.
//!
//! **Szenariouhr (D9).** Nach jedem Schritt stellt [`uhr_stellen`] die neuen ETB-Zeilen des
//! Demo-Einsatzes auf die Schrittzeit: System-Einträge bekommen sie als `ereigniszeit`
//! (fachliche Einträge tragen sie schon beim Anlegen), danach alle neuen `received_at =
//! ereigniszeit`. Die FTS-Spalten (`inhalt`/`von`/`an`/`veranlassung`) fasst das UPDATE nie
//! an; es gibt keinen `AFTER UPDATE`-Trigger, der External-Content-Index bleibt synchron.
//! `status_seit`, `disponiert_at` & Co. setzen die Repos mit `datetime('now')`; sie bleiben
//! auf der Importzeit (D9, hingenommen).
//!
//! **Fachliche Zeitfelder (Block 4.3).** Meldung, Auftrag, Vollzug, Befehl, Lagebericht,
//! Stand- und Belegungsmeldung schreiben ihren ETB-Eintrag im Repo mit einer eigenen
//! Ereigniszeit (`ereigniszeit`, `erteilt_at`, `zeitstand`, `zeitpunkt_at` …). Der Import setzt
//! diese Felder auf die Schrittzeit, die Uhr fasst die Einträge dann nur noch bei `received_at`
//! an. Die eine Ausnahme ist das Anlegen eines Evakuierungsbezirks: sein Entscheidungs-Eintrag
//! entsteht ohne fachliches Zeitfeld mit `datetime('now')`, also mit derselben „jetzt“-Semantik
//! wie ein System-Eintrag. Der Zweig stellt genau diese Einträge (`Geschrieben::etb_ids`) auf die
//! Schrittzeit ([`Ablauf::auf_schrittzeit`]); Nachtrag zu D9 in design.md.

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::SqliteConnection;

use super::katalog::{self, KatalogIds};
use super::stammdaten::{stammdaten_importieren_tx, StammdatenErgebnis};
use super::szenario::{self, DokumentVorlage, Katalogeintrag, Punkt, Schritt, Vorgang};
use super::{DemoBericht, DemoVorgang};
use crate::error::AppError;
use crate::katalog::StatusKategorie;

/// Zeitformat der Datenbank: UTC ohne Zonenkennung, wie `datetime('now')` es schreibt.
const ZEITFORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// Ergebnis eines gelungenen Imports; die Route (Block 5) baut daraus den Status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportErgebnis {
    /// ID des neuen, aktiven Kopfes in `demo_import`.
    pub import_id: i64,
    /// ID des Demo-Einsatzes.
    pub einsatz_id: i64,
    /// Bericht des Vorgangs `importiert`, wortgleich mit `demo_import.bericht`.
    pub bericht: DemoBericht,
}

fn zeit(t: NaiveDateTime) -> String {
    t.format(ZEITFORMAT).to_string()
}

fn schrittzeit(jetzt: NaiveDateTime, vor_min: i64) -> String {
    zeit(jetzt - chrono::Duration::minutes(vor_min))
}

/// Spielt das Demo-Szenario für `org_id` ein. `admin_id` wird Einsatzleitung und steht als
/// Erfasser an jedem ETB-Eintrag; `jetzt` ist der Importzeitpunkt (UTC), von dem aus alle
/// Schrittzeiten rückwärts gerechnet werden. Die Funktion committet nicht.
///
/// `jetzt` wird im Format von `datetime('now')` geschrieben (`YYYY-MM-DD HH:MM:SS`): Bruchteile
/// von Sekunden fallen weg. `importiert_at` und `bericht.zeitpunkt` sind gleich, liegen aber bis
/// zu einer Sekunde vor dem übergebenen Wert; alle Schrittzeiten rechnen vom gekürzten Wert.
///
/// Fehler, jeweils **bevor** etwas geschrieben ist:
/// - `admin_id` gehört nicht zu `org_id` → `Internal`: der Einsatz fiele sonst in die Org
///   des Admins, Kopf und Stammdaten in `org_id`.
/// - aktiver Import der Org → `Conflict` (409, D3).
/// - fehlender oder deaktivierter Katalogeintrag → `UnprocessableEntity` (422) mit Namen.
pub async fn importieren_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    admin_id: i64,
    jetzt: NaiveDateTime,
) -> Result<ImportErgebnis, AppError> {
    let admin_org: Option<i64> = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE id = ?")
        .bind(admin_id)
        .fetch_optional(&mut *conn)
        .await?;
    if admin_org != Some(org_id) {
        return Err(AppError::Internal(format!(
            "Demo-Import: Benutzer {admin_id} gehört nicht zur Org {org_id}"
        )));
    }

    // 1. Ein aktiver Import je Org. Der partielle UNIQUE-Index hält das Rennen, diese
    //    Prüfung liefert die Meldung.
    let aktiv: Option<i64> =
        sqlx::query_scalar("SELECT id FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL")
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
    if aktiv.is_some() {
        return Err(AppError::Conflict(
            "Für diese Organisation sind bereits Demo-Daten importiert.".into(),
        ));
    }

    // 2. Den ganzen Katalogbedarf auflösen, bevor geschrieben wird.
    let kataloge = katalog::aufloesen_tx(conn, org_id, &szenario::katalog_bedarf()).await?;

    // 3. Der Einsatz über den Betriebsweg: Einsatznummer, ID-Sperre (D6), Admin als
    //    Einsatzleitung.
    let begonnen_at = schrittzeit(jetzt, szenario::BEGINN_VOR_MIN);
    let einsatz_id = crate::einsatz::repo::anlegen_tx(
        conn,
        &crate::einsatz::repo::NeuerEinsatzDaten {
            bezeichnung: szenario::EINSATZ_BEZEICHNUNG,
            stichwort: Some(szenario::EINSATZ_STICHWORT),
            einsatzart: Some(crate::einsatz::EINSATZART_UEBUNG),
            begonnen_at: Some(&begonnen_at),
        },
        admin_id,
        jetzt.and_utc(),
    )
    .await?;

    // 4. Der Kopf braucht die Einsatz-ID. Der Bericht ist vorläufig und wird am Ende ersetzt;
    //    die Transaktion macht ihn nie sichtbar.
    let importiert_at = zeit(jetzt);
    let vorlaeufig = DemoBericht {
        vorgang: DemoVorgang::Importiert,
        zeitpunkt: importiert_at.clone(),
        je_art: Vec::new(),
    };
    let import_id: i64 = sqlx::query_scalar(
        "INSERT INTO demo_import (org_id, einsatz_id, importiert_von, importiert_at, bericht) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(einsatz_id)
    .bind(admin_id)
    .bind(&importiert_at)
    .bind(bericht_json(&vorlaeufig)?)
    .fetch_one(&mut *conn)
    .await?;

    // 5. Stammdaten (D8).
    let stamm = stammdaten_importieren_tx(conn, org_id, import_id).await?;

    // 6. Das Drehbuch in Zeitfolge. Die Einstellungen von Einsatz und Org werden einmal auf
    //    der Verbindung gelesen; über den Pool fielen sie still auf Org 0 zurück (Block 3a).
    let einst = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id).await?;
    let org_einst = crate::org::einstellungen::laden_oder_default(&mut *conn, org_id).await?;
    // Frist einer Sofortmeldung wie im Handler (`routes/meldung.rs`): Einsatz ?? Org ?? Vorgabe.
    let meldung_frist_min =
        crate::einsatz::effektiv::effektive_meldung_frist_min(&einst, &org_einst)
            .unwrap_or(crate::meldung::BESTAETIGUNG_FRIST_DEFAULT_MIN);
    let mut ablauf = Ablauf {
        einsatz_id,
        org_id,
        admin_id,
        jetzt,
        startwert: einst.etb_startwert(),
        auftrag_startwert: einst.auftrag_startwert(),
        auto_etb: crate::einsatz::effektiv::effektiv_auto_etb_aktiv(&einst, &org_einst),
        meldung_frist_min,
        kataloge: &kataloge,
        stamm: &stamm,
        abschnitte: BTreeMap::new(),
        einheiten: BTreeMap::new(),
        fahrzeuge: BTreeMap::new(),
        personal: BTreeMap::new(),
        uhs: BTreeMap::new(),
        bezirke: BTreeMap::new(),
        stellen: BTreeMap::new(),
        auftraege: BTreeMap::new(),
        erinnerungen: BTreeMap::new(),
    };
    let mut letzte_etb_id = 0;
    for schritt in szenario::DREHBUCH {
        let zeit = schrittzeit(jetzt, schritt.vor_min);
        ablauf.schritt(conn, schritt, &zeit).await?;
        letzte_etb_id = uhr_stellen(conn, einsatz_id, letzte_etb_id, &zeit).await?;
    }

    // 7. Bericht in den Kopf.
    let bericht = DemoBericht {
        vorgang: DemoVorgang::Importiert,
        zeitpunkt: importiert_at,
        je_art: stamm.je_art.clone(),
    };
    let geaendert = sqlx::query(
        "UPDATE demo_import SET bericht = ? WHERE id = ? AND org_id = ? AND entfernt_at IS NULL",
    )
    .bind(bericht_json(&bericht)?)
    .bind(import_id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert != 1 {
        return Err(AppError::Internal(format!(
            "Demo-Import: Kopf {import_id} nicht fortgeschrieben ({geaendert} Zeilen)"
        )));
    }

    Ok(ImportErgebnis {
        import_id,
        einsatz_id,
        bericht,
    })
}

fn bericht_json(bericht: &DemoBericht) -> Result<String, AppError> {
    serde_json::to_string(bericht)
        .map_err(|e| AppError::Internal(format!("Demo-Bericht nicht serialisierbar: {e}")))
}

/// Stellt die ETB-Zeilen des Demo-Einsatzes mit `id > seit_id` auf die Schrittzeit und
/// liefert die höchste ID des Einsatzes als neuen Merker.
///
/// Beide UPDATEs sind an `einsatz_id` gebunden, sonst träfen sie die Einträge anderer
/// Einsätze (Spec: „MUST NOT ETB-Einträge anderer Einsätze berühren“). Der Merker startet
/// bei 0 und nicht bei der instanzweit höchsten ID: die Bindung an den Einsatz trägt die
/// Abgrenzung, nicht die Nummer.
async fn uhr_stellen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    seit_id: i64,
    zeit: &str,
) -> Result<i64, AppError> {
    sqlx::query(
        "UPDATE etb_eintrag SET ereigniszeit = ? WHERE einsatz_id = ? AND id > ? AND typ = ?",
    )
    .bind(zeit)
    .bind(einsatz_id)
    .bind(seit_id)
    .bind(crate::etb::TYP_SYSTEM)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE etb_eintrag SET received_at = ereigniszeit WHERE einsatz_id = ? AND id > ?",
    )
    .bind(einsatz_id)
    .bind(seit_id)
    .execute(&mut *conn)
    .await?;
    let hoechste: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(id), ?) FROM etb_eintrag WHERE einsatz_id = ?")
            .bind(seit_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    Ok(hoechste)
}

/// Laufzustand des Drehbuchs: die IDs, die frühere Schritte angelegt haben, je Schlüssel.
struct Ablauf<'a> {
    einsatz_id: i64,
    org_id: i64,
    admin_id: i64,
    /// Importzeitpunkt; Fälligkeiten und Fristen rechnen wie die Schrittzeiten davon.
    jetzt: NaiveDateTime,
    /// ETB-Startwert aus den Einsatz-Einstellungen.
    startwert: i64,
    /// Startwert der Auftragsnummer aus den Einsatz-Einstellungen.
    auftrag_startwert: i64,
    /// Effektiver Auto-ETB-Schalter (Einsatz ?? Org), wie `auftrag::repo::anlegen` ihn liest.
    auto_etb: bool,
    /// Effektive Bestätigungsfrist einer Sofortmeldung in Minuten.
    meldung_frist_min: i64,
    kataloge: &'a KatalogIds,
    stamm: &'a StammdatenErgebnis,
    /// Abschnitt-ID je Schlüssel.
    abschnitte: BTreeMap<&'static str, i64>,
    /// Einheit-ID und Name je Schlüssel (der Name steht im ETB-Text der Zuordnung).
    einheiten: BTreeMap<&'static str, (i64, &'static str)>,
    /// `einsatz_fahrzeug.id` je Fahrzeug-Schlüssel.
    fahrzeuge: BTreeMap<&'static str, i64>,
    /// `einsatz_personal.id` je Personal-Schlüssel.
    personal: BTreeMap<&'static str, i64>,
    /// UHS-ID je Schlüssel.
    uhs: BTreeMap<&'static str, i64>,
    /// Evakuierungsbezirk-ID je Schlüssel.
    bezirke: BTreeMap<&'static str, i64>,
    /// Betreuungsstellen-ID je Schlüssel.
    stellen: BTreeMap<&'static str, i64>,
    /// Auftrags-ID je Schlüssel.
    auftraege: BTreeMap<&'static str, i64>,
    /// Erinnerungs-ID je Schlüssel.
    erinnerungen: BTreeMap<&'static str, i64>,
}

/// GeoJSON-Polygon aus einem offenen Außenring `(Länge, Breite)`; der Ring wird geschlossen.
fn polygon_geojson(ring: &[Punkt]) -> String {
    let mut punkte: Vec<[f64; 2]> = ring.iter().map(|(lon, lat)| [*lon, *lat]).collect();
    if let Some(erster) = punkte.first().copied() {
        punkte.push(erster);
    }
    serde_json::json!({ "type": "Polygon", "coordinates": [punkte] }).to_string()
}

/// Die Abschnitte eines Dokuments: das Skelett der Vorlage (in ihrer Reihenfolge), befüllt aus
/// den Szenario-Texten. Ein Schlüssel, den die Vorlage nicht kennt, ist ein Szenariofehler.
fn dokument_abschnitte(
    skelett: impl Iterator<Item = String>,
    d: &DokumentVorlage,
) -> Result<Vec<(String, String)>, AppError> {
    let skelett: Vec<String> = skelett.collect();
    for (k, _) in d.abschnitte {
        if !skelett.iter().any(|s| s == k) {
            return Err(AppError::Internal(format!(
                "Demo-Drehbuch: Abschnitt {k:?} fehlt in der Vorlage {:?}",
                d.vorlage
            )));
        }
    }
    Ok(skelett
        .into_iter()
        .map(|k| {
            let text = d
                .abschnitte
                .iter()
                .find(|(s, _)| *s == k)
                .map(|(_, t)| t.to_string())
                .unwrap_or_default();
            (k, text)
        })
        .collect())
}

/// Wert zu einem Schlüssel, den ein früherer Schritt angelegt haben muss. Fehlt er, ist das
/// Drehbuch falsch sortiert; das endet laut als `Internal`.
fn frueher<T: Copy>(
    werte: &BTreeMap<&'static str, T>,
    was: &str,
    schluessel: &str,
) -> Result<T, AppError> {
    werte.get(schluessel).copied().ok_or_else(|| {
        AppError::Internal(format!(
            "Demo-Drehbuch: {was} {schluessel:?} ist noch nicht angelegt"
        ))
    })
}

impl Ablauf<'_> {
    async fn system_etb(&self, conn: &mut SqliteConnection, inhalt: &str) -> Result<(), AppError> {
        crate::etb::system_audit_tx(conn, self.einsatz_id, self.admin_id, self.startwert, inhalt)
            .await?;
        Ok(())
    }

    /// Stellt die `ereigniszeit` genau der genannten Einträge des Demo-Einsatzes auf die
    /// Schrittzeit. Nur für Einträge, die ein Repo ohne fachliches Zeitfeld mit
    /// `datetime('now')` schreibt (heute: Evakuierungsbezirk angeordnet), also dieselbe
    /// „jetzt“-Semantik, die D9 für System-Einträge begründet. `received_at` setzt danach die Uhr.
    async fn auf_schrittzeit(
        &self,
        conn: &mut SqliteConnection,
        etb_ids: &[i64],
        zeit: &str,
    ) -> Result<(), AppError> {
        for id in etb_ids {
            let n = sqlx::query(
                "UPDATE etb_eintrag SET ereigniszeit = ? WHERE id = ? AND einsatz_id = ?",
            )
            .bind(zeit)
            .bind(id)
            .bind(self.einsatz_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if n != 1 {
                return Err(AppError::Internal(format!(
                    "Demo-Import: ETB-Eintrag {id} nicht im Demo-Einsatz"
                )));
            }
        }
        Ok(())
    }

    /// Ein Schritt: der Vorgang wie im Handler, samt seinem System-ETB-Eintrag. Ein neuer
    /// [`Vorgang`] bekommt hier seinen Zweig.
    async fn schritt(
        &mut self,
        conn: &mut SqliteConnection,
        schritt: &Schritt,
        zeit: &str,
    ) -> Result<(), AppError> {
        let vor_min = schritt.vor_min;
        match schritt.vorgang {
            Vorgang::Abschnitt(v) => {
                let ueber = match v.ueber {
                    Some(s) => Some(frueher(&self.abschnitte, "Abschnitt", s)?),
                    None => None,
                };
                let id = crate::einsatzabschnitt::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    &crate::einsatzabschnitt::repo::AbschnittDaten {
                        name: v.name,
                        ueber_abschnitt_id: ueber,
                        leiter_id: None,
                        bemerkung: None,
                        kommunikationsmittel: None,
                        erreichbarkeit: None,
                        sortier: v.sortier,
                        kurzbezeichnung: Some(v.kurzbezeichnung),
                        lagezustand: v.lagezustand,
                        abschnittsauftrag: Some(v.abschnittsauftrag),
                        fortschritt: v.fortschritt,
                    },
                )
                .await?;
                self.abschnitte.insert(v.schluessel, id);
                self.system_etb(
                    conn,
                    &crate::einsatzabschnitt::etb_text_angelegt(v.name, v.lagezustand),
                )
                .await
            }
            Vorgang::Einheit(v) => {
                let abschnitt = frueher(&self.abschnitte, "Abschnitt", v.abschnitt)?;
                let typ_id = self.kataloge.id(Katalogeintrag::Einheitstyp(v.typ))?;
                let id = crate::einheit::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.org_id,
                    &crate::einheit::repo::EinheitDaten {
                        name: v.name,
                        abschnitt_id: Some(abschnitt),
                        ueber_einheit_id: None,
                        typ_id: Some(typ_id),
                        soll_fuehrer: None,
                        soll_unterfuehrer: None,
                        soll_mannschaft: None,
                        bemerkung: None,
                        funkrufname: None,
                        kommunikationsmittel: None,
                        erreichbarkeit: None,
                        sortier: v.sortier,
                    },
                    self.admin_id,
                )
                .await?;
                self.einheiten.insert(v.schluessel, (id, v.name));
                self.system_etb(conn, &crate::einheit::etb_text_gebildet(v.name))
                    .await
            }
            Vorgang::FahrzeugDisponieren { fahrzeug } => {
                // Die 422 für einen fehlenden `gebunden`-Status kommt schon aus `aufloesen_tx`
                // (Schritt 2, vor dem ersten Schreiben). Dieser Lookup schützt nur gegen Drift
                // zwischen Bedarf und Drehbuch und endet dann als `Internal`: sonst setzte die
                // Disposition, die den Status selbst nachschlägt, still `NULL`.
                self.kataloge.id(Katalogeintrag::FahrzeugstatusKategorie(
                    StatusKategorie::Gebunden,
                ))?;
                let fahrzeug_id = self.stamm.fahrzeug(fahrzeug)?;
                let ef_id = crate::fahrzeug::disposition_repo::disponiere_stamm_tx(
                    conn,
                    self.einsatz_id,
                    self.org_id,
                    fahrzeug_id,
                    self.admin_id,
                )
                .await?;
                self.fahrzeuge.insert(fahrzeug, ef_id);
                let anzeige = crate::fahrzeug::disposition_repo::laden_anzeige_tx(
                    conn,
                    self.einsatz_id,
                    ef_id,
                    true,
                )
                .await?;
                self.system_etb(
                    conn,
                    &crate::fahrzeug::etb_text_disponiert(&anzeige.funkrufname),
                )
                .await
            }
            Vorgang::FahrzeugZuEinheit { fahrzeug, einheit } => {
                let ef_id = frueher(&self.fahrzeuge, "Fahrzeug", fahrzeug)?;
                let (einheit_id, einheit_name) = frueher(&self.einheiten, "Einheit", einheit)?;
                let funkrufname = crate::einheit::mitglied_repo::ordne_fahrzeug_zu_tx(
                    conn,
                    self.einsatz_id,
                    einheit_id,
                    ef_id,
                )
                .await?;
                self.system_etb(
                    conn,
                    &crate::einheit::etb_text_fahrzeug_zugeordnet(einheit_name, &funkrufname),
                )
                .await
            }
            Vorgang::FmsStatus { fahrzeug, fms } => {
                let ef_id = frueher(&self.fahrzeuge, "Fahrzeug", fahrzeug)?;
                let status_id = self.kataloge.id(Katalogeintrag::FahrzeugstatusFms(fms))?;
                // Wie der Handler: Vorzustand lesen, setzen, frisch lesen, ETB nur bei einem
                // echten Wechsel.
                let vorher = crate::fahrzeug::disposition_repo::laden_anzeige_tx(
                    conn,
                    self.einsatz_id,
                    ef_id,
                    true,
                )
                .await?;
                crate::fahrzeug::disposition_repo::aktualisiere_tx(
                    conn,
                    self.einsatz_id,
                    ef_id,
                    Some(status_id),
                    None,
                )
                .await?;
                let nachher = crate::fahrzeug::disposition_repo::laden_anzeige_tx(
                    conn,
                    self.einsatz_id,
                    ef_id,
                    true,
                )
                .await?;
                if vorher.status_id != nachher.status_id {
                    self.system_etb(
                        conn,
                        &crate::fahrzeug::etb_text_status_wechsel(
                            &nachher.funkrufname,
                            vorher.status_label.as_deref(),
                            nachher.status_label.as_deref(),
                        ),
                    )
                    .await?;
                }
                Ok(())
            }
            Vorgang::PersonalDisponieren { personal } => {
                // Wie beim Fahrzeug: die 422 kommt aus `aufloesen_tx`, hier nur der Drift-Schutz.
                self.kataloge.id(Katalogeintrag::PersonalstatusKategorie(
                    StatusKategorie::Gebunden,
                ))?;
                let personal_id = self.stamm.personal(personal)?;
                let ep_id = crate::personal::disposition_repo::disponiere_stamm_tx(
                    conn,
                    self.einsatz_id,
                    self.org_id,
                    personal_id,
                    None,
                    self.admin_id,
                )
                .await?;
                self.personal.insert(personal, ep_id);
                let anzeige = crate::personal::disposition_repo::laden_anzeige_tx(
                    conn,
                    self.einsatz_id,
                    ep_id,
                    true,
                )
                .await?;
                self.system_etb(
                    conn,
                    &crate::personal::etb_text_disponiert(
                        &anzeige.name,
                        anzeige.funktion.as_deref(),
                    ),
                )
                .await
            }
            Vorgang::PersonalZuEinheit { personal, einheit } => {
                let ep_id = frueher(&self.personal, "Personal", personal)?;
                let (einheit_id, einheit_name) = frueher(&self.einheiten, "Einheit", einheit)?;
                let person = crate::einheit::mitglied_repo::ordne_personal_zu_tx(
                    conn,
                    self.einsatz_id,
                    einheit_id,
                    ep_id,
                )
                .await?;
                self.system_etb(
                    conn,
                    &crate::einheit::etb_text_personal_zugeordnet(einheit_name, &person),
                )
                .await
            }
            Vorgang::Gefahrengebiet(v) => {
                // Wie `routes/lage_zone.rs::anlegen`: Prüfung, Zone samt Gefahrengebiet-Gruppe,
                // ETB „eingerichtet“ aus der frisch geladenen Zone.
                let geometrie = polygon_geojson(v.ring);
                crate::lage_zone::validiere_neu("gefahrengebiet", "Polygon", &geometrie)?;
                let zone_id = crate::lage_zone::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    crate::lage_zone::repo::ZoneNeu {
                        typ: "gefahrengebiet",
                        geometrie_typ: "Polygon",
                        geometrie: &geometrie,
                        label: Some(v.label),
                        farbe: None,
                        notiz: None,
                        ansicht_id: None,
                        evakuierungsbezirk_id: None,
                        erstellt_von: self.admin_id,
                    },
                )
                .await?;
                let zone = crate::lage_zone::repo::laden_tx(conn, self.einsatz_id, zone_id).await?;
                self.system_etb(
                    conn,
                    &crate::lage_zone::etb_text(
                        zone.typ.as_str(),
                        zone.label.as_deref(),
                        "eingerichtet",
                    ),
                )
                .await?;
                let gebiet_id = zone.gefahrengebiet_id.ok_or_else(|| {
                    AppError::Internal("Demo-Import: Gefahrengebiet ohne Gruppe".into())
                })?;
                // Wie `routes/gefahr.rs::bewerten`: Kombination prüfen, Vorwert lesen, UPSERT,
                // ETB nur bei geänderter Warnstufe. Das Label des Gebiets ist das der Zone
                // (`gebiet_anlegen` übernimmt es).
                if !crate::gefahr::kombination_gueltig(v.gefahrentyp, v.schutzobjekt) {
                    return Err(AppError::UnprocessableEntity(format!(
                        "Kombination {} × {} ist nicht zulässig",
                        v.gefahrentyp, v.schutzobjekt
                    )));
                }
                let alt = crate::gefahr::repo::aktuelle_warnstufe(
                    &mut *conn,
                    gebiet_id,
                    v.gefahrentyp,
                    v.schutzobjekt,
                )
                .await?
                .unwrap_or_else(|| "keine".to_string());
                let bewertung = crate::gefahr::repo::upsert_bewertung_tx(
                    conn,
                    gebiet_id,
                    crate::gefahr::repo::BewertungDaten {
                        gefahrentyp: v.gefahrentyp,
                        schutzobjekt: v.schutzobjekt,
                        warnstufe: v.warnstufe.as_str(),
                        beschreibung: Some(v.beschreibung),
                        gemeldet_von: None,
                        aktualisiert_von: self.admin_id,
                    },
                )
                .await?;
                if bewertung.warnstufe.as_str() != alt {
                    self.system_etb(
                        conn,
                        &crate::gefahr::etb_text_bewertung(
                            bewertung.gefahrentyp.as_str(),
                            bewertung.schutzobjekt.as_str(),
                            zone.label.as_deref(),
                            gebiet_id,
                            bewertung.warnstufe,
                        ),
                    )
                    .await?;
                }
                Ok(())
            }
            Vorgang::Uhs(v) => {
                let abschnitt = frueher(&self.abschnitte, "Abschnitt", v.abschnitt)?;
                // Anlegen schreibt im Betrieb kein ETB, Plätze auch nicht (interne Logistik).
                let uhs = crate::uhs::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    &crate::uhs::repo::NeueDaten {
                        typ: v.typ.as_str(),
                        bezeichnung: v.bezeichnung,
                        abschnitt_id: Some(abschnitt),
                        standort: Some(v.standort),
                        notiz: None,
                    },
                )
                .await?;
                for platz in v.plaetze {
                    crate::uhs::platz_repo::anlegen_tx(
                        conn,
                        uhs.id,
                        &crate::uhs::platz_repo::NeuerPlatz {
                            typ: platz.typ.as_str(),
                            bezeichnung: platz.bezeichnung,
                            pos_x: Some(platz.pos.0),
                            pos_y: Some(platz.pos.1),
                        },
                    )
                    .await?;
                }
                // Wie `routes/einsatz_uhs.rs::status_wechsel`: Übergang prüfen, setzen, ETB.
                if !crate::uhs::darf_uebergehen(uhs.status.as_str(), "aktiv") {
                    return Err(AppError::Internal(format!(
                        "Demo-Import: UHS-Übergang {} → aktiv nicht erlaubt",
                        uhs.status.as_str()
                    )));
                }
                crate::uhs::repo::setze_status_tx(
                    conn,
                    self.einsatz_id,
                    uhs.id,
                    "aktiv",
                    self.admin_id,
                )
                .await?;
                if let Some(text) = crate::uhs::etb_text_status(&uhs.bezeichnung, uhs.typ, "aktiv")
                {
                    self.system_etb(conn, &text).await?;
                }
                self.uhs.insert(v.schluessel, uhs.id);
                Ok(())
            }
            Vorgang::Bereitstellungsraum(v) => {
                let abschnitt = frueher(&self.abschnitte, "Abschnitt", v.abschnitt)?;
                let br = crate::bereitstellungsraum::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    &crate::bereitstellungsraum::repo::NeueDaten {
                        bezeichnung: v.bezeichnung,
                        abschnitt_id: Some(abschnitt),
                        standort: Some(v.standort),
                        notiz: None,
                    },
                )
                .await?;
                // `setze_status_tx` prüft den Übergang selbst.
                crate::bereitstellungsraum::repo::setze_status_tx(
                    conn,
                    self.einsatz_id,
                    br.id,
                    "aktiv",
                    self.admin_id,
                )
                .await?;
                if let Some(text) =
                    crate::bereitstellungsraum::etb_text_status(&br.bezeichnung, "aktiv")
                {
                    self.system_etb(conn, &text).await?;
                }
                Ok(())
            }
            Vorgang::Person(v) => {
                // Wie `routes/einsatz_person.rs::anlegen` mit Status `erfasst`: Anlage,
                // Erst-Sichtung (hebt auf `betroffen`) und UHS-Eintritt in die Inbox, je mit
                // System-ETB.
                let uhs_id = match v.uhs {
                    Some(k) => Some(frueher(&self.uhs, "UHS", k)?),
                    None => None,
                };
                let (person_id, reg, war_neu) = crate::person::repo::anlegen_tx_mit_optionen(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    crate::person::PersonStatus::Erfasst.as_str(),
                    None,
                    crate::person::repo::NeueDaten {
                        name: Some(v.name),
                        vorname: Some(v.vorname),
                        geschlecht: Some(v.geschlecht),
                        geburtsdatum: None,
                        alter_geschaetzt: Some(v.alter_geschaetzt),
                        herkunft_adresse: None,
                        antreff_ort: Some(v.antreff_ort),
                        melder_kontakt: None,
                        notiz: None,
                        zustand: v.zustand,
                        antreff_lat: v.antreff.map(|(_, lat)| lat),
                        antreff_lon: v.antreff.map(|(lon, _)| lon),
                        vermisst_seit: None,
                    },
                )
                .await?;
                if !war_neu {
                    return Err(AppError::Internal(
                        "Demo-Import: Person ohne client_id nicht neu angelegt".into(),
                    ));
                }
                self.system_etb(conn, &crate::person::etb_text_erfasst(reg))
                    .await?;
                if let Some(kategorie) = v.sichtung {
                    crate::person::sichtung_repo::erfassen_tx(
                        conn,
                        self.einsatz_id,
                        person_id,
                        kategorie.as_str(),
                        None,
                        self.admin_id,
                        true,
                    )
                    .await?;
                    self.system_etb(conn, &crate::person::etb_text_sichtung(reg, kategorie))
                        .await?;
                }
                if let Some(uhs_id) = uhs_id {
                    crate::uhs::belegung_repo::eintritt_tx(
                        conn,
                        self.einsatz_id,
                        person_id,
                        uhs_id,
                        None,
                        None,
                        self.admin_id,
                    )
                    .await?;
                    let uhs = crate::uhs::repo::laden_tx(conn, self.einsatz_id, uhs_id).await?;
                    self.system_etb(
                        conn,
                        &crate::person::etb_text_uhs_aufnahme(reg, &uhs.bezeichnung),
                    )
                    .await?;
                }
                Ok(())
            }
            Vorgang::Bezirk(v) => {
                let abschnitt = frueher(&self.abschnitte, "Abschnitt", v.abschnitt)?;
                let geschrieben = crate::betreuung::repo::bezirk_anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    self.startwert,
                    &crate::betreuung::repo::BezirkEingabe {
                        bezeichnung: v.bezeichnung.to_string(),
                        abschnitt_id: Some(abschnitt),
                        plan_personen: v.plan_personen,
                        plan_erhebung: v.plan_erhebung,
                        sammelstelle: Some(v.sammelstelle.to_string()),
                        notiz: None,
                    },
                )
                .await?;
                // Die Entscheidung „Evakuierung angeordnet“ trägt kein fachliches Zeitfeld und
                // stünde sonst auf `datetime('now')` (Nachtrag D9).
                self.auf_schrittzeit(conn, &geschrieben.etb_ids, zeit)
                    .await?;
                self.bezirke.insert(v.schluessel, geschrieben.id);
                Ok(())
            }
            Vorgang::Stand {
                bezirk,
                evakuiert,
                erhebung,
            } => {
                let bezirk_id = frueher(&self.bezirke, "Bezirk", bezirk)?;
                crate::betreuung::repo::stand_melden_tx(
                    conn,
                    self.einsatz_id,
                    bezirk_id,
                    self.admin_id,
                    self.startwert,
                    &crate::betreuung::repo::StandEingabe {
                        evakuiert,
                        erhebung,
                        zeitpunkt_at: zeit.to_string(),
                    },
                )
                .await?;
                Ok(())
            }
            Vorgang::Stelle(v) => {
                let abschnitt = frueher(&self.abschnitte, "Abschnitt", v.abschnitt)?;
                let geschrieben = crate::betreuung::repo::stelle_anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    self.startwert,
                    &crate::betreuung::repo::StelleEingabe {
                        bezeichnung: v.bezeichnung.to_string(),
                        art: v.art,
                        abschnitt_id: Some(abschnitt),
                        kapazitaet_personen: Some(v.kapazitaet),
                        standort: Some(v.standort.to_string()),
                        notiz: None,
                    },
                )
                .await?;
                self.stellen.insert(v.schluessel, geschrieben.id);
                Ok(())
            }
            Vorgang::StelleInBetrieb { stelle, lage } => {
                let stelle_id = frueher(&self.stellen, "Betreuungsstelle", stelle)?;
                crate::betreuung::repo::stelle_aendern_tx(
                    conn,
                    self.einsatz_id,
                    stelle_id,
                    self.admin_id,
                    self.startwert,
                    &crate::betreuung::repo::StelleAenderung {
                        status: Some(crate::betreuung::BetreuungsstelleStatus::InBetrieb),
                        lat: lage.map(|(_, lat)| Some(lat)),
                        lon: lage.map(|(lon, _)| Some(lon)),
                        ..Default::default()
                    },
                )
                .await?;
                Ok(())
            }
            Vorgang::Belegung { stelle, belegt } => {
                let stelle_id = frueher(&self.stellen, "Betreuungsstelle", stelle)?;
                crate::betreuung::repo::belegung_melden_tx(
                    conn,
                    self.einsatz_id,
                    stelle_id,
                    self.admin_id,
                    self.startwert,
                    &crate::betreuung::repo::BelegungEingabe {
                        belegt,
                        zeitpunkt_at: zeit.to_string(),
                    },
                )
                .await?;
                Ok(())
            }
            Vorgang::Meldung(v) => {
                let einheit_id = match v.einheit {
                    Some(k) => Some(frueher(&self.einheiten, "Einheit", k)?.0),
                    None => None,
                };
                // Wie der Handler: Sofort impliziert die Bestätigungspflicht, Frist = Eingang +
                // effektive Frist. Die Sofortmeldung des Szenarios wird im selben Schritt
                // bestätigt (D5, D10); eine unbestätigte wäre ein Alarm auf Vorrat.
                let pflicht = v.meldungsart == crate::meldung::ART_SOFORTMELDUNG
                    || v.prioritaet == crate::meldung::PRIO_SOFORT;
                if pflicht && !v.bestaetigt {
                    return Err(AppError::Internal(
                        "Demo-Drehbuch: unbestätigte Sofortmeldung verletzt D10".into(),
                    ));
                }
                if pflicht && self.meldung_frist_min <= 0 {
                    return Err(AppError::Validation(
                        "Bestätigungsfrist muss positiv sein".into(),
                    ));
                }
                let frist_at =
                    pflicht.then(|| schrittzeit(self.jetzt, vor_min - self.meldung_frist_min));
                let meldung_id = crate::meldung::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    &crate::meldung::repo::MeldungDaten {
                        absender: v.absender,
                        empfaenger: v.empfaenger,
                        meldeweg: v.meldeweg,
                        inhalt: v.inhalt,
                        meldungsart: v.meldungsart,
                        prioritaet: v.prioritaet,
                        richtung: v.richtung,
                        ereigniszeit: zeit,
                        eingang_at: zeit,
                        bestaetigung_pflicht: pflicht,
                        bestaetigung_frist_at: frist_at.as_deref(),
                        einheit_id,
                        abschnitt_id: None,
                    },
                )
                .await?;
                if v.bestaetigt {
                    let frisch = crate::meldung::repo::bestaetige_tx(
                        conn,
                        self.org_id,
                        self.einsatz_id,
                        meldung_id,
                        self.admin_id,
                        zeit,
                    )
                    .await?;
                    if !frisch {
                        return Err(AppError::Internal(
                            "Demo-Import: Meldung war schon bestätigt".into(),
                        ));
                    }
                }
                Ok(())
            }
            Vorgang::Auftrag(v) => {
                let (einheit_id, _) = frueher(&self.einheiten, "Einheit", v.einheit)?;
                // Ohne Frist, also auch ohne die Auto-Frist-Erinnerung des Handlers (D5, D10).
                let auftrag_id = crate::auftrag::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    self.auftrag_startwert,
                    self.startwert,
                    self.auto_etb,
                    &crate::auftrag::repo::AuftragDaten {
                        auftrag_text: v.text,
                        absicht: None,
                        lage: None,
                        ort: v.ort,
                        zeit: None,
                        mittel: None,
                        verbindung: None,
                        sicherheit: None,
                        prioritaet: crate::auftrag::PRIO_NORMAL,
                        richtung: crate::auftrag::RICHTUNG_INTERN,
                        frist_at: None,
                        erteilt_at: zeit,
                        empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                            empfaenger_typ: crate::auftrag::EMPF_EINHEIT.to_string(),
                            abschnitt_id: None,
                            einheit_id: Some(einheit_id),
                            person_id: None,
                            fahrzeug_id: None,
                            funktion_text: None,
                            extern_kategorie: None,
                            extern_bezeichnung: None,
                        }],
                    },
                )
                .await?;
                self.auftraege.insert(v.schluessel, auftrag_id);
                Ok(())
            }
            Vorgang::AuftragVollzug { auftrag, meldung } => {
                let auftrag_id = frueher(&self.auftraege, "Auftrag", auftrag)?;
                crate::auftrag::repo::melde_vollzug_tx(
                    conn,
                    self.org_id,
                    self.einsatz_id,
                    auftrag_id,
                    self.admin_id,
                    meldung,
                    zeit,
                )
                .await?;
                Ok(())
            }
            Vorgang::Befehl(d) => {
                // Anlegen mit `zeitstand` = Schrittzeit, befüllen, freigeben. Die Freigabe
                // schreibt den Snapshot mit `ereigniszeit = zeitstand`.
                let entwurf = crate::befehl::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    d.vorlage,
                    d.titel,
                    zeit,
                    self.admin_id,
                )
                .await?;
                let abschnitte: Vec<crate::befehl::Abschnitt> = dokument_abschnitte(
                    entwurf.abschnitte.iter().map(|a| a.schluessel.clone()),
                    &d,
                )?
                .into_iter()
                .map(|(schluessel, text)| crate::befehl::Abschnitt { schluessel, text })
                .collect();
                crate::befehl::repo::aktualisiere_tx(
                    conn,
                    self.einsatz_id,
                    entwurf.id,
                    &crate::befehl::repo::BefehlPatch {
                        abschnitte: Some(&abschnitte),
                        ..Default::default()
                    },
                )
                .await?;
                crate::befehl::repo::freigeben_tx(conn, self.einsatz_id, entwurf.id, self.admin_id)
                    .await?;
                Ok(())
            }
            Vorgang::Lagebericht(d) => {
                let entwurf = crate::lagebericht::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    d.vorlage,
                    d.titel,
                    zeit,
                    self.admin_id,
                )
                .await?;
                let abschnitte: Vec<crate::lagebericht::Abschnitt> = dokument_abschnitte(
                    entwurf.abschnitte.iter().map(|a| a.schluessel.clone()),
                    &d,
                )?
                .into_iter()
                .map(|(schluessel, text)| crate::lagebericht::Abschnitt { schluessel, text })
                .collect();
                crate::lagebericht::repo::aktualisiere_tx(
                    conn,
                    self.einsatz_id,
                    entwurf.id,
                    &crate::lagebericht::repo::LageberichtPatch {
                        abschnitte: Some(&abschnitte),
                        ..Default::default()
                    },
                )
                .await?;
                crate::lagebericht::repo::freigeben_tx(
                    conn,
                    self.einsatz_id,
                    entwurf.id,
                    self.admin_id,
                )
                .await?;
                Ok(())
            }
            Vorgang::Erinnerung(v) => {
                let faellig_at = schrittzeit(self.jetzt, v.faellig_vor_min);
                let erinnerung = crate::erinnerung::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    &crate::erinnerung::repo::ErinnerungDaten {
                        titel: v.titel,
                        beschreibung: Some(v.beschreibung),
                        faellig_at: &faellig_at,
                        intervall_minuten: None,
                        empfaenger_funktion: None,
                        bezug_typ: None,
                        bezug_id: None,
                    },
                    zeit,
                )
                .await?;
                self.erinnerungen.insert(v.schluessel, erinnerung.id);
                Ok(())
            }
            Vorgang::ErinnerungErledigt { erinnerung } => {
                // Wie `routes/erinnerung.rs::erledigen`: Status und Vollzug-Achse, kein ETB.
                let erinnerung_id = frueher(&self.erinnerungen, "Erinnerung", erinnerung)?;
                crate::erinnerung::repo::status_setzen_tx(
                    conn,
                    erinnerung_id,
                    crate::erinnerung::STATUS_ERLEDIGT,
                    zeit,
                )
                .await?;
                crate::kommunikation::repo::setze_vollzug_tx(
                    conn,
                    self.org_id,
                    self.einsatz_id,
                    crate::kommunikation::OBJEKT_ERINNERUNG,
                    erinnerung_id,
                    crate::kommunikation::VOLLZUG_VOLLZOGEN,
                    self.admin_id,
                    zeit,
                )
                .await?;
                Ok(())
            }
            Vorgang::Etb { art, inhalt, von } => {
                crate::etb::repo::anlegen_tx(
                    conn,
                    self.einsatz_id,
                    self.admin_id,
                    self.startwert,
                    crate::etb::repo::EintragDaten {
                        typ: art.typ(),
                        inhalt,
                        von,
                        an: None,
                        meldeweg: None,
                        veranlassung: None,
                        ereigniszeit: Some(zeit),
                        erfasst_lokal_at: None,
                        berichtigt_eintrag_id: None,
                    },
                )
                .await?;
                Ok(())
            }
        }
    }
}

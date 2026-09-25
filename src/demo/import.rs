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

use std::collections::BTreeMap;

use chrono::NaiveDateTime;
use sqlx::SqliteConnection;

use super::katalog::{self, KatalogIds};
use super::stammdaten::{stammdaten_importieren_tx, StammdatenErgebnis};
use super::szenario::{self, Katalogeintrag, Schritt, Vorgang};
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

    // 6. Das Drehbuch in Zeitfolge.
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id)
        .await?
        .etb_startwert();
    let mut ablauf = Ablauf {
        einsatz_id,
        org_id,
        admin_id,
        startwert,
        kataloge: &kataloge,
        stamm: &stamm,
        abschnitte: BTreeMap::new(),
        einheiten: BTreeMap::new(),
        fahrzeuge: BTreeMap::new(),
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
    startwert: i64,
    kataloge: &'a KatalogIds,
    stamm: &'a StammdatenErgebnis,
    /// Abschnitt-ID je Schlüssel.
    abschnitte: BTreeMap<&'static str, i64>,
    /// Einheit-ID und Name je Schlüssel (der Name steht im ETB-Text der Zuordnung).
    einheiten: BTreeMap<&'static str, (i64, &'static str)>,
    /// `einsatz_fahrzeug.id` je Fahrzeug-Schlüssel.
    fahrzeuge: BTreeMap<&'static str, i64>,
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

    /// Ein Schritt: der Vorgang wie im Handler, samt seinem System-ETB-Eintrag. Ein neuer
    /// [`Vorgang`] bekommt hier seinen Zweig.
    async fn schritt(
        &mut self,
        conn: &mut SqliteConnection,
        schritt: &Schritt,
        zeit: &str,
    ) -> Result<(), AppError> {
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
                // Vorab aufgelöst, damit ein fehlender `gebunden`-Status 422 ist und nicht
                // still `NULL` (die Disposition schlägt ihn selbst nach).
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

//! Was Liefern und Übernehmen über eine gespiegelte Tabelle wissen (design.md D3, D5): Spalten,
//! Schlüssel, die Spalte mit Inhalt auf Abruf und wohin jede Verweisspalte zeigt.
//!
//! Gelesen wird das aus dem Schema (`pragma_table_info`, `pragma_foreign_key_list`), einmal je
//! Prozess. Verweise ohne Fremdschlüssel stehen in [`VERWEISE_OHNE_FK`]; der Test
//! `jede_id_spalte_ist_eingeordnet` findet jede Spalte, die wie ein Verweis heißt und weder das
//! eine noch das andere hat.

use super::art::{self, Schluessel};
use super::SpiegelKategorie;
use crate::einsatz::schwaerzung_registry::Scoping;
use crate::instanz::stammdaten::{art as stammdaten_art, StammdatenArt};
use sqlx::SqliteConnection;
use std::collections::HashMap;

/// Spalten, die nur an dieser Instanz gelten und nie geliefert werden.
/// `fuehrung_bei` ist die Schreibsperre aus der Führungsakte dieser Instanz (LLH-1491).
pub const LOKALE_SPALTEN: &[(&str, &str)] = &[("einsatz", "spiegel"), ("einsatz", "fuehrung_bei")];

/// Wohin ein Verweis zeigt und wie die Gegenseite ihn abbildet (D5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ziel {
    /// Eine Zeile einer gespiegelten Tabelle; abgebildet über `spiegel_herkunft`.
    Einsatz(&'static str),
    /// Ein Konto; ohne Gegenstück ein Stellvertreter (D5, Nachtrag 10.11.2026).
    Konto,
    /// Eine verteilte Stammdatenart; ohne Gegenstück `NULL`.
    Stammdaten(StammdatenArt),
    /// Die Org; abgebildet über die Org-Zuordnung der Kopplung.
    Org,
    /// Je Zeile über eine Typspalte: `(Wert der Typspalte, Ziel)`; ein Wert, der nicht in der
    /// Liste steht, wird unverändert übernommen (kein Zeilenverweis, etwa ein Zeitpunkt).
    Polymorph {
        typ_spalte: &'static str,
        ziele: &'static [(&'static str, &'static str)],
    },
    /// Eine Liste von Qualifikationen im Format `[{"q": id, "n": anzahl}]`.
    QualiSoll,
    /// Eine Liste von Qualifikations-IDs (`[id, …]`).
    QualiListe,
    /// Ein Element der Fernmeldeskizze (`<präfix><id>`, [`SKIZZE_ELEMENTE`]).
    SkizzenElement,
    /// Ein eingefrorener Lagestand; nur `bilder[].id` (Kartenbild) wird live gelesen.
    SnapshotBilder,
}

/// Ein Verweis ohne Fremdschlüssel (D3).
#[derive(Debug, Clone, Copy)]
pub struct VerweisOhneFk {
    pub tabelle: &'static str,
    pub spalte: &'static str,
    pub ziel: ZielOhneFk,
}

/// Ziel eines Verweises ohne Fremdschlüssel.
#[derive(Debug, Clone, Copy)]
pub enum ZielOhneFk {
    Tabelle(&'static str),
    Polymorph {
        typ_spalte: &'static str,
        ziele: &'static [(&'static str, &'static str)],
    },
    QualiSoll,
    QualiListe,
    SkizzenElement,
    SnapshotBilder,
    /// Kein Zeilenverweis, auch wenn der Name danach klingt (mit Grund).
    Kein(&'static str),
}

/// Verweise ohne Fremdschlüssel in gespiegelten Tabellen (D3). Ergänzt aus der Aufnahme vom
/// 10.11.2026; der Test `jede_id_spalte_ist_eingeordnet` hält die Liste vollständig.
pub const VERWEISE_OHNE_FK: &[VerweisOhneFk] = &[
    v(
        "erinnerung",
        "bezug_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "bezug_typ",
            ziele: &[
                ("etb", "etb_eintrag"),
                ("meldung", "meldung"),
                ("auftrag", "auftrag"),
                ("abloesung", "einsatz_abloesung"),
                ("abloesung_vorwarnung", "einsatz_abloesung"),
                ("abloesung_planung", "einsatz_abloesung"),
            ],
        },
    ),
    v(
        "chat_nachricht",
        "bezug_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "bezug_typ",
            ziele: &[
                ("schaden", "einsatz_schaden"),
                ("uhs", "uhs"),
                ("person", "einsatz_person"),
                ("lagebericht", "lagebericht"),
                ("meldung", "meldung"),
                ("auftrag", "auftrag"),
            ],
        },
    ),
    v(
        "kommunikation_status",
        "objekt_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "objekt_typ",
            ziele: &[
                ("erinnerung", "erinnerung"),
                ("auftrag", "auftrag"),
                ("meldung", "meldung"),
                ("chat_nachricht", "chat_nachricht"),
            ],
        },
    ),
    v(
        "kommunikation_zustellung",
        "objekt_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "objekt_typ",
            ziele: &[
                ("chat_nachricht", "chat_nachricht"),
                ("erinnerung", "erinnerung"),
                ("auftrag", "auftrag"),
                ("meldung", "meldung"),
            ],
        },
    ),
    v(
        "br_belegung",
        "objekt_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "objekt_typ",
            ziele: &[
                ("einheit", "einsatz_einheit"),
                ("fahrzeug", "einsatz_fahrzeug"),
            ],
        },
    ),
    v(
        "br_belegung",
        "mit_abruf_id",
        ZielOhneFk::Tabelle("br_belegung"),
    ),
    v(
        "einsatz_einheit",
        "rueckmeldung_ueberfaellig_meldung_id",
        ZielOhneFk::Tabelle("meldung"),
    ),
    v(
        "fernmeldeskizze_verbindung",
        "von_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "von_art",
            ziele: SKIZZE_ZIELE,
        },
    ),
    v(
        "fernmeldeskizze_verbindung",
        "nach_id",
        ZielOhneFk::Polymorph {
            typ_spalte: "nach_art",
            ziele: SKIZZE_ZIELE,
        },
    ),
    v(
        "fernmeldeskizze_lage",
        "element",
        ZielOhneFk::SkizzenElement,
    ),
    v("einsatz_einheit", "quali_soll", ZielOhneFk::QualiSoll),
    v("uhs", "quali_soll", ZielOhneFk::QualiSoll),
    v("einsatz_planschicht", "quali_soll", ZielOhneFk::QualiSoll),
    v(
        "einsatz_plan_helfer",
        "qualifikationen",
        ZielOhneFk::QualiListe,
    ),
    v("lage_snapshot", "daten", ZielOhneFk::SnapshotBilder),
];

const fn v(tabelle: &'static str, spalte: &'static str, ziel: ZielOhneFk) -> VerweisOhneFk {
    VerweisOhneFk {
        tabelle,
        spalte,
        ziel,
    }
}

/// Bezüge einer Verbindung der Fernmeldeskizze (`SkizzenBezugArt`); `fuehrungsstelle` hat keine
/// Kennung.
const SKIZZE_ZIELE: &[(&str, &str)] = &[
    ("abschnitt", "einsatzabschnitt"),
    ("einheit", "einsatz_einheit"),
    ("stelle", "einsatz_kommunikation_stelle"),
    ("komponente", "fernmeldeskizze_komponente"),
];

/// Präfixe eines Elements der Fernmeldeskizze (`fernmeldeskizze_lage.element`, etwa `eh-12`);
/// `fs` trägt keine Kennung.
pub const SKIZZE_ELEMENTE: &[(&str, &str)] = &[
    ("ab-", "einsatzabschnitt"),
    ("eh-", "einsatz_einheit"),
    ("ks-", "einsatz_kommunikation_stelle"),
    ("ko-", "fernmeldeskizze_komponente"),
    ("sg-", "sprechgruppe"),
];

/// Eine Spalte einer gespiegelten Tabelle.
#[derive(Debug, Clone)]
pub struct Spalte {
    pub name: String,
    /// `NOT NULL` ohne Vorgabewert: ohne Wert lässt sich die Zeile nicht anlegen.
    pub pflicht: bool,
    pub verweis: Option<Ziel>,
}

/// Eine gespiegelte Tabelle, wie Liefern und Übernehmen sie brauchen.
#[derive(Debug, Clone)]
pub struct Tabelle {
    pub name: &'static str,
    pub kategorie: SpiegelKategorie,
    pub scoping: Scoping,
    pub schluessel: Schluessel,
    /// Gelieferte Spalten: alle außer [`LOKALE_SPALTEN`] und der Spalte auf Abruf.
    pub spalten: Vec<Spalte>,
    /// BLOB-Spalte, deren Inhalt auf Abruf kommt (D8).
    pub blob: Option<String>,
}

impl Tabelle {
    pub fn spalte(&self, name: &str) -> Option<&Spalte> {
        self.spalten.iter().find(|s| s.name == name)
    }
}

/// Die Beschreibung aller gespiegelten Tabellen.
#[derive(Debug)]
pub struct Schema {
    pub tabellen: HashMap<&'static str, Tabelle>,
}

impl Schema {
    pub fn tabelle(&self, name: &str) -> Option<&Tabelle> {
        self.tabellen.get(name)
    }
}

static SCHEMA: tokio::sync::OnceCell<Schema> = tokio::sync::OnceCell::const_new();

/// Die Beschreibung, beim ersten Aufruf aus dem Schema gelesen. Alle Datenbanken eines Prozesses
/// haben dasselbe Schema (dieselben Migrationen).
pub async fn schema(conn: &mut SqliteConnection) -> Result<&'static Schema, sqlx::Error> {
    if let Some(s) = SCHEMA.get() {
        return Ok(s);
    }
    let s = lies_schema(conn).await?;
    Ok(SCHEMA.get_or_init(|| async { s }).await)
}

/// Ordnet einen Fremdschlüssel auf `ziel_tabelle` ein; `None` = unbekannt (Wächter).
pub fn ziel_fuer_fk(ziel_tabelle: &str) -> Option<Ziel> {
    if let Some(g) = art::GESPIEGELT.iter().find(|g| g.tabelle == ziel_tabelle) {
        return Some(Ziel::Einsatz(g.tabelle));
    }
    match ziel_tabelle {
        "benutzer" => return Some(Ziel::Konto),
        "organisation" => return Some(Ziel::Org),
        _ => {}
    }
    stammdaten_art::BESCHREIBUNGEN
        .iter()
        .find(|b| b.tabelle == ziel_tabelle && b.art != StammdatenArt::Konto)
        .map(|b| Ziel::Stammdaten(b.art))
}

fn ziel_ohne_fk(z: ZielOhneFk) -> Option<Ziel> {
    match z {
        ZielOhneFk::Tabelle(t) => ziel_fuer_fk(t),
        ZielOhneFk::Polymorph { typ_spalte, ziele } => Some(Ziel::Polymorph { typ_spalte, ziele }),
        ZielOhneFk::QualiSoll => Some(Ziel::QualiSoll),
        ZielOhneFk::QualiListe => Some(Ziel::QualiListe),
        ZielOhneFk::SkizzenElement => Some(Ziel::SkizzenElement),
        ZielOhneFk::SnapshotBilder => Some(Ziel::SnapshotBilder),
        ZielOhneFk::Kein(_) => None,
    }
}

async fn lies_schema(conn: &mut SqliteConnection) -> Result<Schema, sqlx::Error> {
    let mut tabellen = HashMap::new();
    for g in art::GESPIEGELT {
        let t = g.tabelle;
        let info: Vec<(String, String, i64, Option<String>)> = sqlx::query_as(
            sqlx::AssertSqlSafe(format!(
                "SELECT name, type, \"notnull\", dflt_value FROM pragma_table_info('{t}') ORDER BY cid"
            )),
        )
        .fetch_all(&mut *conn)
        .await?;
        let fks: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT \"from\", \"table\" FROM pragma_foreign_key_list('{t}')"
        )))
        .fetch_all(&mut *conn)
        .await?;
        let mut spalten = Vec::new();
        let mut blob = None;
        for (name, typ, notnull, vorgabe) in info {
            if LOKALE_SPALTEN.contains(&(t, name.as_str())) {
                continue;
            }
            if typ.eq_ignore_ascii_case("BLOB") {
                blob = Some(name);
                continue;
            }
            let verweis = match fks.iter().find(|(von, _)| *von == name) {
                Some((_, ziel)) => ziel_fuer_fk(ziel),
                None => VERWEISE_OHNE_FK
                    .iter()
                    .find(|v| v.tabelle == t && v.spalte == name)
                    .and_then(|v| ziel_ohne_fk(v.ziel)),
            };
            spalten.push(Spalte {
                pflicht: notnull != 0 && vorgabe.is_none(),
                name,
                verweis,
            });
        }
        tabellen.insert(
            t,
            Tabelle {
                name: t,
                kategorie: g.kategorie,
                scoping: art::scoping(t),
                schluessel: art::schluessel(conn, t).await?,
                spalten,
                blob,
            },
        );
    }
    Ok(Schema { tabellen })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Jeder Fremdschlüssel einer gespiegelten Tabelle zeigt auf ein Ziel, das die Abbildung kennt
    /// (D5); sonst zeigte der Spiegel still auf eine falsche Zeile.
    #[tokio::test]
    async fn jeder_fremdschluessel_ist_eingeordnet() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let mut fehlend = Vec::new();
        for g in art::GESPIEGELT {
            let fks: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT \"from\", \"table\" FROM pragma_foreign_key_list('{}')",
                g.tabelle
            )))
            .fetch_all(&mut *conn)
            .await
            .unwrap();
            for (von, ziel) in fks {
                if ziel_fuer_fk(&ziel).is_none() {
                    fehlend.push(format!("{}.{von} → {ziel}", g.tabelle));
                }
            }
        }
        assert!(
            fehlend.is_empty(),
            "Unbekannte Verweisziele:\n  {}",
            fehlend.join("\n  ")
        );
    }

    /// Jede Spalte, die wie ein Verweis heißt (`*_id`) und keinen Fremdschlüssel hat, steht in
    /// [`VERWEISE_OHNE_FK`] (D3).
    #[tokio::test]
    async fn jede_id_spalte_ist_eingeordnet() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let mut fehlend = Vec::new();
        for g in art::GESPIEGELT {
            let t = g.tabelle;
            let spalten: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT name FROM pragma_table_info('{t}') WHERE name LIKE '%\\_id' ESCAPE '\\' \
                 AND name NOT IN (SELECT \"from\" FROM pragma_foreign_key_list('{t}'))"
            )))
            .fetch_all(&mut *conn)
            .await
            .unwrap();
            for s in spalten {
                if s == "client_id" {
                    continue; // Idempotenzschlüssel des Clients, kein Verweis
                }
                if !VERWEISE_OHNE_FK
                    .iter()
                    .any(|v| v.tabelle == t && v.spalte == s)
                {
                    fehlend.push(format!("{t}.{s}"));
                }
            }
        }
        assert!(
            fehlend.is_empty(),
            "Spalten wie Verweise ohne Fremdschlüssel, nicht in VERWEISE_OHNE_FK:\n  {}",
            fehlend.join("\n  ")
        );
        for v in VERWEISE_OHNE_FK {
            if let ZielOhneFk::Tabelle(z) = v.ziel {
                assert!(
                    ziel_fuer_fk(z).is_some(),
                    "{}.{} → {z}",
                    v.tabelle,
                    v.spalte
                );
            }
        }
    }

    #[tokio::test]
    async fn schema_kennt_jede_gespiegelte_tabelle_und_die_spalten_auf_abruf() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let s = schema(&mut conn).await.unwrap();
        assert_eq!(s.tabellen.len(), art::GESPIEGELT.len());
        assert_eq!(s.tabelle("anhang").unwrap().blob.as_deref(), Some("daten"));
        assert!(s.tabelle("einsatz").unwrap().spalte("spiegel").is_none());
        assert_eq!(
            s.tabelle("etb_eintrag")
                .unwrap()
                .spalte("erfasser_id")
                .unwrap()
                .verweis,
            Some(Ziel::Konto)
        );
        assert_eq!(
            s.tabelle("uhs_platz")
                .unwrap()
                .spalte("uhs_id")
                .unwrap()
                .verweis,
            Some(Ziel::Einsatz("uhs"))
        );
    }
}

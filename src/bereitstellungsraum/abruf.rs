//! Abruf aus dem Bereitstellungsraum (LLH-1085, Change `lwxpacsf-br-kraefte-abrufen-uebergeben`,
//! design.md D1, D6, D10, D11, D13; Spec `bereitstellungsraum-belegung`).
//!
//! Die Führung ruft eine Kraft ab: sie bleibt im Raum und gilt dort als abgerufen, bis ein
//! Austritt über die Belegung das Ausrücken bucht. [`abruf_tx`] und [`aufheben_tx`] laufen in
//! der Transaktion des Aufrufers und schreiben **kein ETB**: der Aufrufer schreibt genau einen
//! Satz in derselben Transaktion (die Route den Abruf-Satz, der Vollzug einer Ablösung, LLH-1132,
//! seinen eigenen; `src/AGENTS.md`, „Backend — Bereitstellungsraum“).

use super::belegung_repo::{self, NeuesEreignis};
use super::{etb_text_abruf, etb_text_abruf_aufgehoben, AbrufText, BrBelegungsArt, ObjektTyp};
use crate::error::AppError;
use sqlx::SqliteConnection;

/// Was abgerufen wird und wohin (D6).
#[derive(Debug)]
pub struct AbrufDaten<'a> {
    pub objekt_typ: ObjektTyp,
    pub objekt_id: i64,
    /// Ziel-Abschnitt und sein Name; nur für Einheiten (D11).
    pub abschnitt: Option<(i64, &'a str)>,
    /// Der geprüfte Auftrag an die Kraft (D9); `None` heißt „kein Auftrag“.
    pub auftrag: Option<&'a crate::auftrag::repo::AuftragDaten<'a>>,
    /// Abruf und Austritt in einem Schritt.
    pub ausgerueckt: bool,
}

/// Startwerte für den Auftrag und seine Anordnung (`auftrag::repo::anlegen_tx`).
#[derive(Debug, Clone, Copy)]
pub struct Startwerte {
    pub auftrag: i64,
    pub etb: i64,
    pub auto_etb: bool,
}

/// Was [`abruf_tx`] geschrieben hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AbrufErgebnis {
    /// id des Abruf-Ereignisses der abgerufenen Kraft.
    pub abruf_id: i64,
    pub objekt_name: String,
    pub br_bezeichnung: String,
    /// Mitgenommene Untereinheiten (id, Name), nach Name.
    pub mitgenommen: Vec<(i64, String)>,
    pub ziel_anzeige: Option<String>,
    pub auftrag_id: Option<i64>,
    pub auftrag_nr: Option<i64>,
    /// Ob der Abruf auch den Austritt geschrieben hat.
    pub ausgetreten: bool,
}

impl AbrufErgebnis {
    /// Der eine ETB-Satz zum Abruf (D8).
    pub fn etb_text(&self) -> String {
        let namen: Vec<String> = self.mitgenommen.iter().map(|(_, n)| n.clone()).collect();
        etb_text_abruf(&AbrufText {
            name: &self.objekt_name,
            mitgenommen: &namen,
            br_bezeichnung: &self.br_bezeichnung,
            ziel: self.ziel_anzeige.as_deref(),
            auftrag_nr: self.auftrag_nr,
            ausgerueckt: self.ausgetreten,
        })
    }
}

/// Ruft eine Kraft aus dem Raum `br_id` ab, in der Transaktion des Aufrufers (D6).
///
/// # Regeln (in Reihenfolge)
/// 1. Raum fremd → `NotFound`; nicht aktiv oder storniert → `UnprocessableEntity`
/// 2. Kraft fremd oder unbekannt → `NotFound`, aufgelöst bzw. entlassen → `Conflict`
/// 3. Fahrzeug einer Einheit, Fahrzeug mit Abschnitt → `UnprocessableEntity` (D11)
/// 4. Abschnitt außerhalb des Einsatzes → `NotFound`
/// 5. Kraft nicht in diesem Raum oder schon abgerufen → `UnprocessableEntity`
/// 6. Untereinheiten im Raum bestimmen (D10), Auftrag anlegen (D9), Abruf je Objekt (Ziel und
///    Auftrag nur an der Wurzel), Unterstellung der Wurzel, mit `ausgerueckt` der Austritt je
///    Objekt
pub async fn abruf_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    daten: &AbrufDaten<'_>,
    startwerte: Startwerte,
    benutzer_id: i64,
) -> Result<AbrufErgebnis, AppError> {
    let br = belegung_repo::require_belegbar_tx(&mut *conn, einsatz_id, br_id).await?;
    let typ = daten.objekt_typ;
    let id = daten.objekt_id;
    let (objekt_name, aktueller_br_id) = load_kraft_tx(&mut *conn, einsatz_id, typ, id).await?;
    if typ == ObjektTyp::Fahrzeug && daten.abschnitt.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Ein Fahrzeug ohne Einheit hat keine Unterstellung; Abruf ohne Abschnitt".into(),
        ));
    }
    if let Some((abschnitt_id, _)) = daten.abschnitt {
        crate::einsatzabschnitt::repo::check_im_einsatz(&mut *conn, einsatz_id, abschnitt_id)
            .await?;
    }
    if aktueller_br_id != Some(br_id) {
        return Err(AppError::UnprocessableEntity(
            "Kraft steht nicht in diesem Bereitstellungsraum".into(),
        ));
    }
    if belegung_repo::offener_abruf_tx(&mut *conn, einsatz_id, typ, id, br_id)
        .await?
        .is_some()
    {
        return Err(AppError::UnprocessableEntity(
            "Kraft ist schon abgerufen".into(),
        ));
    }

    let mitgenommen = match typ {
        ObjektTyp::Einheit => load_verband_tx(&mut *conn, einsatz_id, br_id, id).await?,
        ObjektTyp::Fahrzeug => Vec::new(),
    };
    let auftrag_id = match daten.auftrag {
        Some(a) => Some(
            crate::auftrag::repo::anlegen_tx(
                &mut *conn,
                einsatz_id,
                benutzer_id,
                startwerte.auftrag,
                startwerte.etb,
                startwerte.auto_etb,
                a,
            )
            .await?,
        ),
        None => None,
    };
    let auftrag_nr: Option<i64> = match auftrag_id {
        Some(a) => {
            sqlx::query_scalar("SELECT lfd_nr FROM auftrag WHERE id = ?")
                .bind(a)
                .fetch_one(&mut *conn)
                .await?
        }
        None => None,
    };

    let abruf_id = belegung_repo::insert_ereignis_tx(
        &mut *conn,
        einsatz_id,
        br_id,
        &NeuesEreignis {
            art: BrBelegungsArt::Abruf,
            objekt_typ: typ,
            objekt_id: id,
            notiz: None,
            ziel: daten.abschnitt,
            auftrag_id,
            mit_abruf_id: None,
        },
        benutzer_id,
    )
    .await?;
    let notiz = format!("mit {objekt_name} abgerufen");
    for (einheit_id, _) in &mitgenommen {
        belegung_repo::insert_ereignis_tx(
            &mut *conn,
            einsatz_id,
            br_id,
            &NeuesEreignis {
                art: BrBelegungsArt::Abruf,
                objekt_typ: ObjektTyp::Einheit,
                objekt_id: *einheit_id,
                notiz: Some(&notiz),
                ziel: None,
                auftrag_id: None,
                mit_abruf_id: Some(abruf_id),
            },
            benutzer_id,
        )
        .await?;
    }
    // Unterstellung nur an der Wurzel: die Stärke zählt über die oberste Einheit (Spec
    // `lage-verdichtung`, D10).
    if let Some((abschnitt_id, _)) = daten.abschnitt {
        sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ? AND einsatz_id = ?")
            .bind(abschnitt_id)
            .bind(id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    if daten.ausgerueckt {
        let objekte = std::iter::once((typ, id))
            .chain(mitgenommen.iter().map(|(e, _)| (ObjektTyp::Einheit, *e)));
        for (t, o) in objekte {
            belegung_repo::insert_ereignis_tx(
                &mut *conn,
                einsatz_id,
                br_id,
                &NeuesEreignis {
                    art: BrBelegungsArt::Austritt,
                    objekt_typ: t,
                    objekt_id: o,
                    notiz: None,
                    ziel: None,
                    auftrag_id: None,
                    mit_abruf_id: None,
                },
                benutzer_id,
            )
            .await?;
            belegung_repo::update_cache_tx(&mut *conn, einsatz_id, t, o, None).await?;
        }
    }
    Ok(AbrufErgebnis {
        abruf_id,
        objekt_name,
        br_bezeichnung: br.bezeichnung,
        mitgenommen,
        ziel_anzeige: daten.abschnitt.map(|(_, name)| name.to_string()),
        auftrag_id,
        auftrag_nr,
        ausgetreten: daten.ausgerueckt,
    })
}

/// Was [`aufheben_tx`] geschrieben hat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AufhebenErgebnis {
    /// id des Ereignisses `abruf_aufgehoben` der Kraft.
    pub ereignis_id: i64,
    pub objekt_name: String,
    pub br_bezeichnung: String,
    /// Mit zurückgenommene Untereinheiten (id, Name).
    pub mitgenommen: Vec<(i64, String)>,
}

impl AufhebenErgebnis {
    /// Der eine ETB-Satz zur Rücknahme (D8).
    pub fn etb_text(&self) -> String {
        let namen: Vec<String> = self.mitgenommen.iter().map(|(_, n)| n.clone()).collect();
        etb_text_abruf_aufgehoben(&self.objekt_name, &namen, &self.br_bezeichnung)
    }
}

/// Nimmt den Abruf einer Kraft im Raum `br_id` zurück (D13), samt der mit ihr abgerufenen
/// Untereinheiten. Unterstellung und Auftrag bleiben. Raum wie bei [`abruf_tx`]; Kraft fremd
/// → `NotFound`; nicht abgerufen → `UnprocessableEntity`.
pub async fn aufheben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    typ: ObjektTyp,
    objekt_id: i64,
    benutzer_id: i64,
) -> Result<AufhebenErgebnis, AppError> {
    let br = belegung_repo::require_belegbar_tx(&mut *conn, einsatz_id, br_id).await?;
    let (objekt_name, aktueller_br_id) =
        load_kraft_tx(&mut *conn, einsatz_id, typ, objekt_id).await?;
    let abruf = match aktueller_br_id {
        Some(raum) if raum == br_id => {
            belegung_repo::offener_abruf_tx(&mut *conn, einsatz_id, typ, objekt_id, br_id).await?
        }
        _ => None,
    }
    .ok_or_else(|| AppError::UnprocessableEntity("Kraft ist nicht abgerufen".into()))?;
    let mitgenommen = match typ {
        ObjektTyp::Einheit => {
            belegung_repo::mitgenommene_tx(&mut *conn, einsatz_id, br_id, abruf.id).await?
        }
        ObjektTyp::Fahrzeug => Vec::new(),
    };
    let objekte = std::iter::once((typ, objekt_id))
        .chain(mitgenommen.iter().map(|(e, _)| (ObjektTyp::Einheit, *e)));
    let mut ereignis_id = None;
    for (t, o) in objekte {
        let id = belegung_repo::insert_ereignis_tx(
            &mut *conn,
            einsatz_id,
            br_id,
            &NeuesEreignis {
                art: BrBelegungsArt::AbrufAufgehoben,
                objekt_typ: t,
                objekt_id: o,
                notiz: None,
                ziel: None,
                auftrag_id: None,
                mit_abruf_id: None,
            },
            benutzer_id,
        )
        .await?;
        ereignis_id.get_or_insert(id);
    }
    Ok(AufhebenErgebnis {
        ereignis_id: ereignis_id.expect("die Kraft selbst bekommt immer ein Ereignis"),
        objekt_name,
        br_bezeichnung: br.bezeichnung,
        mitgenommen,
    })
}

/// Name und Raum einer aktiven Kraft. Fremd oder unbekannt → `NotFound`, aufgelöst bzw.
/// entlassen → `Conflict`, Fahrzeug einer Einheit → `UnprocessableEntity` (es geht mit seiner
/// Einheit, D6; anders als der historische 409 der Belegung ein Zusammenhang).
async fn load_kraft_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    typ: ObjektTyp,
    id: i64,
) -> Result<(String, Option<i64>), AppError> {
    match typ {
        ObjektTyp::Einheit => {
            crate::einheit::repo::require_aktiv_tx(&mut *conn, einsatz_id, id).await?;
            Ok(sqlx::query_as(
                "SELECT name, aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?)
        }
        ObjektTyp::Fahrzeug => {
            crate::fahrzeug::disposition_repo::require_aktiv_tx(&mut *conn, einsatz_id, id).await?;
            let (name, einheit_id, raum): (String, Option<i64>, Option<i64>) = sqlx::query_as(
                "SELECT snap_funkrufname, einheit_id, aktueller_br_id FROM einsatz_fahrzeug \
                 WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
            if einheit_id.is_some() {
                return Err(AppError::UnprocessableEntity(
                    "Fahrzeug gehört einer Einheit und wird mit ihr abgerufen".into(),
                ));
            }
            Ok((name, raum))
        }
    }
}

/// Untereinheiten über alle Ebenen (`ueber_einheit_id`), die im Raum stehen, aktiv sind und
/// nicht schon abgerufen (D10). `UNION` beendet einen Zyklus im Bestand; die Wurzel selbst fehlt.
/// Aufgelöste Einheiten stehen nie im Baum: Auflösen hängt ihre Kinder an die übergeordnete
/// Einheit um (`einheit::repo`), der Filter im Baum ändert also nichts und hält den
/// Zustandswächter (`entlassung::tests`) zufrieden.
async fn load_verband_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    wurzel: i64,
) -> Result<Vec<(i64, String)>, AppError> {
    Ok(sqlx::query_as(
        "WITH RECURSIVE baum(id) AS ( \
             SELECT id FROM einsatz_einheit \
             WHERE ueber_einheit_id = ?3 AND einsatz_id = ?1 AND aufgeloest_at IS NULL \
             UNION \
             SELECT e.id FROM einsatz_einheit e JOIN baum ON e.ueber_einheit_id = baum.id \
             WHERE e.einsatz_id = ?1 AND e.aufgeloest_at IS NULL) \
         SELECT e.id, e.name FROM baum JOIN einsatz_einheit e ON e.id = baum.id \
         WHERE e.id <> ?3 AND e.aktueller_br_id = ?2 AND e.aufgeloest_at IS NULL \
           AND COALESCE((SELECT x.art FROM br_belegung x \
                         WHERE x.objekt_typ = 'einheit' AND x.objekt_id = e.id \
                           AND x.einsatz_id = ?1 \
                         ORDER BY x.id DESC LIMIT 1), '') <> 'abruf' \
         ORDER BY e.name, e.id",
    )
    .bind(einsatz_id)
    .bind(br_id)
    .bind(wurzel)
    .fetch_all(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bereitstellungsraum::repo as br_repo;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    struct Lage {
        pool: SqlitePool,
        b: i64,
        e: i64,
        br: i64,
    }

    async fn lage() -> Lage {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
                system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, \
                angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-10-16', 'realeinsatz', '2026-10-16') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let br = raum(&pool, e, b, "Sportplatz").await;
        Lage { pool, b, e, br }
    }

    async fn raum(pool: &SqlitePool, e: i64, b: i64, bez: &str) -> i64 {
        let br = br_repo::create(
            pool,
            e,
            b,
            br_repo::NeueDaten {
                bezeichnung: bez,
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap();
        br_repo::setze_status(pool, e, br.id, "aktiv", b)
            .await
            .unwrap();
        br.id
    }

    impl Lage {
        async fn einheit(&self, name: &str, ueber: Option<i64>) -> i64 {
            sqlx::query_scalar(
                "INSERT INTO einsatz_einheit (einsatz_id, name, ueber_einheit_id) \
                 VALUES (?, ?, ?) RETURNING id",
            )
            .bind(self.e)
            .bind(name)
            .bind(ueber)
            .fetch_one(&self.pool)
            .await
            .unwrap()
        }

        async fn fahrzeug(&self, name: &str, einheit: Option<i64>) -> i64 {
            sqlx::query_scalar(
                "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
                 VALUES (?, ?, ?) RETURNING id",
            )
            .bind(self.e)
            .bind(name)
            .bind(einheit)
            .fetch_one(&self.pool)
            .await
            .unwrap()
        }

        async fn abschnitt(&self, name: &str) -> i64 {
            sqlx::query_scalar(
                "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id",
            )
            .bind(self.e)
            .bind(name)
            .fetch_one(&self.pool)
            .await
            .unwrap()
        }

        async fn belege(&self, br: i64, typ: &str, id: i64, art: &str) {
            belegung_repo::belege(&self.pool, self.e, br, typ, id, art, None, self.b)
                .await
                .unwrap();
        }

        async fn abruf(&self, daten: AbrufDaten<'_>) -> Result<AbrufErgebnis, AppError> {
            self.abruf_in(self.br, daten).await
        }

        async fn abruf_in(
            &self,
            br: i64,
            daten: AbrufDaten<'_>,
        ) -> Result<AbrufErgebnis, AppError> {
            let mut tx = self.pool.begin().await.unwrap();
            let r = abruf_tx(
                &mut tx,
                self.e,
                br,
                &daten,
                Startwerte {
                    auftrag: 1,
                    etb: 1,
                    auto_etb: true,
                },
                self.b,
            )
            .await;
            if r.is_ok() {
                tx.commit().await.unwrap();
            }
            r
        }

        async fn aufheben(&self, typ: ObjektTyp, id: i64) -> Result<AufhebenErgebnis, AppError> {
            let mut tx = self.pool.begin().await.unwrap();
            let r = aufheben_tx(&mut tx, self.e, self.br, typ, id, self.b).await;
            if r.is_ok() {
                tx.commit().await.unwrap();
            }
            r
        }

        async fn einheit_zeile(&self, id: i64) -> (Option<i64>, Option<i64>) {
            sqlx::query_as("SELECT aktueller_br_id, abschnitt_id FROM einsatz_einheit WHERE id = ?")
                .bind(id)
                .fetch_one(&self.pool)
                .await
                .unwrap()
        }

        /// (Art, mit_abruf_id) des jüngsten Ereignisses einer Einheit.
        async fn juengstes(&self, typ: &str, id: i64) -> (String, Option<i64>) {
            sqlx::query_as(
                "SELECT art, mit_abruf_id FROM br_belegung \
                 WHERE objekt_typ = ? AND objekt_id = ? ORDER BY id DESC LIMIT 1",
            )
            .bind(typ)
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
        }

        async fn anzahl(&self) -> (i64, i64) {
            sqlx::query_as(
                "SELECT (SELECT COUNT(*) FROM br_belegung), (SELECT COUNT(*) FROM auftrag)",
            )
            .fetch_one(&self.pool)
            .await
            .unwrap()
        }
    }

    fn einheit(id: i64) -> AbrufDaten<'static> {
        AbrufDaten {
            objekt_typ: ObjektTyp::Einheit,
            objekt_id: id,
            abschnitt: None,
            auftrag: None,
            ausgerueckt: false,
        }
    }

    fn ist_422(r: &Result<impl std::fmt::Debug, AppError>) -> bool {
        matches!(r, Err(AppError::UnprocessableEntity(_)))
    }

    /// Ohne Ziel bleiben Cache und Unterstellung; der Abruf ist das jüngste Ereignis.
    #[tokio::test]
    async fn abruf_ohne_ziel_laesst_cache_und_unterstellung() {
        let l = lage().await;
        let alt = l.abschnitt("EA Alt").await;
        let hlf = l.einheit("HLF 20", None).await;
        sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ?")
            .bind(alt)
            .bind(hlf)
            .execute(&l.pool)
            .await
            .unwrap();
        l.belege(l.br, "einheit", hlf, "eintritt").await;

        let r = l.abruf(einheit(hlf)).await.unwrap();
        assert_eq!(r.objekt_name, "HLF 20");
        assert_eq!(r.br_bezeichnung, "Sportplatz");
        assert!(r.mitgenommen.is_empty());
        assert_eq!(r.ziel_anzeige, None);
        assert!(!r.ausgetreten);
        assert_eq!(
            r.etb_text(),
            "HLF 20 aus Bereitstellungsraum Sportplatz abgerufen"
        );
        assert_eq!(l.einheit_zeile(hlf).await, (Some(l.br), Some(alt)));
        assert_eq!(l.juengstes("einheit", hlf).await, ("abruf".into(), None));
    }

    /// Mit Abschnitt wird nur die Wurzel unterstellt; der Verband nimmt Kinder und Enkel im Raum
    /// mit, nicht die im anderen Raum und keine schon eigens abgerufene.
    #[tokio::test]
    async fn abruf_mit_abschnitt_und_verband() {
        let l = lage().await;
        let schule = raum(&l.pool, l.e, l.b, "Schule").await;
        let deich = l.abschnitt("EA Deich").await;
        let nord = l.abschnitt("EA Nord").await;
        let zug = l.einheit("1. Zug", None).await;
        let g1 = l.einheit("Gruppe 1", Some(zug)).await;
        let g2 = l.einheit("Gruppe 2", Some(zug)).await;
        let g3 = l.einheit("Gruppe 3", Some(zug)).await;
        let trupp = l.einheit("Trupp 1", Some(g1)).await;
        let trupp_g3 = l.einheit("Trupp 3", Some(g3)).await;
        for id in [zug, g1, g2, trupp, trupp_g3] {
            l.belege(l.br, "einheit", id, "eintritt").await;
        }
        l.belege(schule, "einheit", g3, "eintritt").await;
        // Gruppe 2 vorher eigens nach EA Nord abgerufen.
        let eigen = l
            .abruf(AbrufDaten {
                abschnitt: Some((nord, "EA Nord")),
                ..einheit(g2)
            })
            .await
            .unwrap();

        let r = l
            .abruf(AbrufDaten {
                abschnitt: Some((deich, "EA Deich")),
                ..einheit(zug)
            })
            .await
            .unwrap();
        let namen: Vec<&str> = r.mitgenommen.iter().map(|(_, n)| n.as_str()).collect();
        assert_eq!(namen, ["Gruppe 1", "Trupp 1", "Trupp 3"]);
        assert_eq!(
            r.etb_text(),
            "1. Zug mit Gruppe 1, Trupp 1, Trupp 3 aus Bereitstellungsraum Sportplatz abgerufen \
             nach EA Deich"
        );
        assert_eq!(l.einheit_zeile(zug).await, (Some(l.br), Some(deich)));
        for kind in [g1, trupp, trupp_g3] {
            assert_eq!(
                l.juengstes("einheit", kind).await,
                ("abruf".into(), Some(r.abruf_id))
            );
            assert_eq!(
                l.einheit_zeile(kind).await,
                (Some(l.br), None),
                "nur die Wurzel"
            );
        }
        assert_eq!(
            l.juengstes("einheit", g2).await,
            ("abruf".into(), None),
            "eigens abgerufen bleibt"
        );
        assert_eq!(l.einheit_zeile(g2).await, (Some(l.br), Some(nord)));
        assert_eq!(eigen.mitgenommen, vec![]);
        assert_eq!(l.juengstes("einheit", g3).await, ("eintritt".into(), None));
    }

    /// Ein Zyklus über `ueber_einheit_id` im Bestand beendet die Suche.
    #[tokio::test]
    async fn zyklus_im_bestand_endet() {
        let l = lage().await;
        let a = l.einheit("A", None).await;
        let b = l.einheit("B", Some(a)).await;
        sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE id = ?")
            .bind(b)
            .bind(a)
            .execute(&l.pool)
            .await
            .unwrap();
        for id in [a, b] {
            l.belege(l.br, "einheit", id, "eintritt").await;
        }
        let r = l.abruf(einheit(a)).await.unwrap();
        assert_eq!(r.mitgenommen, vec![(b, "B".to_string())]);
    }

    /// Vorbedingungen (422, 409, 404); jede Ablehnung schreibt nichts.
    #[tokio::test]
    async fn vorbedingungen_schreiben_nichts() {
        let l = lage().await;
        let schule = raum(&l.pool, l.e, l.b, "Schule").await;
        let deich = l.abschnitt("EA Deich").await;
        let zug = l.einheit("1. Zug", None).await;
        let fz_zug = l.fahrzeug("Florian 1/44-1", Some(zug)).await;
        let fz = l.fahrzeug("Florian 1/83-1", None).await;
        let draussen = l.einheit("Draußen", None).await;
        let weg = l.einheit("Weg", None).await;
        let fremd_raum = l.einheit("Schulzug", None).await;
        l.belege(l.br, "einheit", zug, "eintritt").await;
        l.belege(l.br, "fahrzeug", fz, "eintritt").await;
        l.belege(l.br, "einheit", weg, "eintritt").await;
        l.belege(schule, "einheit", fremd_raum, "eintritt").await;
        sqlx::query(
            "UPDATE einsatz_einheit SET aufgeloest_at = '2026-10-16 10:00:00' WHERE id = ?",
        )
        .bind(weg)
        .execute(&l.pool)
        .await
        .unwrap();
        let vorher = l.anzahl().await;

        let fz_mit_abschnitt = AbrufDaten {
            objekt_typ: ObjektTyp::Fahrzeug,
            objekt_id: fz,
            abschnitt: Some((deich, "EA Deich")),
            ..einheit(0)
        };
        assert!(
            ist_422(&l.abruf(fz_mit_abschnitt).await),
            "Fahrzeug mit Abschnitt"
        );
        let fz_der_einheit = AbrufDaten {
            objekt_typ: ObjektTyp::Fahrzeug,
            objekt_id: fz_zug,
            ..einheit(0)
        };
        assert!(
            ist_422(&l.abruf(fz_der_einheit).await),
            "Fahrzeug einer Einheit"
        );
        assert!(ist_422(&l.abruf(einheit(draussen)).await), "in keinem Raum");
        assert!(
            ist_422(&l.abruf(einheit(fremd_raum)).await),
            "im anderen Raum"
        );
        assert!(matches!(
            l.abruf(einheit(weg)).await,
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            l.abruf(einheit(99_999)).await,
            Err(AppError::NotFound)
        ));
        assert_eq!(l.anzahl().await, vorher);

        l.abruf(einheit(zug)).await.unwrap();
        let vorher = l.anzahl().await;
        assert!(ist_422(&l.abruf(einheit(zug)).await), "zweiter Abruf");
        assert_eq!(l.anzahl().await, vorher);

        // Ein stornierter Raum ist leer (Storno verlangt das); die Raumprüfung kommt zuerst.
        let halle = raum(&l.pool, l.e, l.b, "Halle").await;
        br_repo::storniere(&l.pool, l.e, halle, l.b).await.unwrap();
        assert!(
            ist_422(&l.abruf_in(halle, einheit(fremd_raum)).await),
            "BR storniert"
        );
        assert_eq!(l.anzahl().await, vorher);
    }

    /// Ein einheitenloses Fahrzeug lässt sich ohne Abschnitt abrufen; `ausgerueckt` leert den
    /// Cache.
    #[tokio::test]
    async fn fahrzeug_ohne_einheit_und_ausgerueckt() {
        let l = lage().await;
        let fz = l.fahrzeug("Florian 1/83-1", None).await;
        l.belege(l.br, "fahrzeug", fz, "eintritt").await;
        let r = l
            .abruf(AbrufDaten {
                objekt_typ: ObjektTyp::Fahrzeug,
                objekt_id: fz,
                ausgerueckt: true,
                ..einheit(0)
            })
            .await
            .unwrap();
        assert!(r.ausgetreten);
        assert_eq!(
            r.etb_text(),
            "Florian 1/83-1 aus Bereitstellungsraum Sportplatz abgerufen und ausgerückt"
        );
        let cache: Option<i64> =
            sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_fahrzeug WHERE id = ?")
                .bind(fz)
                .fetch_one(&l.pool)
                .await
                .unwrap();
        assert_eq!(cache, None);
        assert_eq!(l.juengstes("fahrzeug", fz).await, ("austritt".into(), None));
    }

    /// `ausgerueckt` trägt die Wurzel und jede mitgenommene Untereinheit aus.
    #[tokio::test]
    async fn ausgerueckt_leert_den_cache_aller_abgerufenen() {
        let l = lage().await;
        let zug = l.einheit("1. Zug", None).await;
        let g1 = l.einheit("Gruppe 1", Some(zug)).await;
        for id in [zug, g1] {
            l.belege(l.br, "einheit", id, "eintritt").await;
        }
        l.abruf(AbrufDaten {
            ausgerueckt: true,
            ..einheit(zug)
        })
        .await
        .unwrap();
        for id in [zug, g1] {
            assert_eq!(l.einheit_zeile(id).await.0, None);
            assert_eq!(l.juengstes("einheit", id).await.0, "austritt");
        }
    }

    /// Ein Abruf mit Auftrag legt ihn in derselben Transaktion an und nennt seine Nummer.
    #[tokio::test]
    async fn abruf_mit_auftrag() {
        let l = lage().await;
        let hlf = l.einheit("HLF 20", None).await;
        l.belege(l.br, "einheit", hlf, "eintritt").await;
        let daten = crate::auftrag::repo::AuftragDaten {
            auftrag_text: "Sandsackverbau",
            absicht: None,
            lage: None,
            ort: None,
            zeit: None,
            mittel: None,
            verbindung: None,
            sicherheit: None,
            weg: None,
            prioritaet: "normal",
            richtung: "intern",
            frist_at: None,
            erteilt_at: "2026-10-16 14:30:00",
            empfaenger: vec![crate::auftrag::repo::EmpfaengerEingabe {
                empfaenger_typ: "einheit".into(),
                abschnitt_id: None,
                einheit_id: Some(hlf),
                person_id: None,
                fahrzeug_id: None,
                funktion_text: None,
                funktion: None,
                extern_kategorie: None,
                extern_bezeichnung: None,
            }],
        };
        let r = l
            .abruf(AbrufDaten {
                auftrag: Some(&daten),
                ..einheit(hlf)
            })
            .await
            .unwrap();
        let (id, nr): (i64, Option<i64>) =
            sqlx::query_as("SELECT id, lfd_nr FROM auftrag WHERE auftrag_text = 'Sandsackverbau'")
                .fetch_one(&l.pool)
                .await
                .unwrap();
        assert_eq!((r.auftrag_id, r.auftrag_nr), (Some(id), nr));
        let am_ereignis: Option<i64> =
            sqlx::query_scalar("SELECT auftrag_id FROM br_belegung WHERE id = ?")
                .bind(r.abruf_id)
                .fetch_one(&l.pool)
                .await
                .unwrap();
        assert_eq!(am_ereignis, Some(id));
        assert!(
            r.etb_text().ends_with("(Auftrag Nr. 1)"),
            "{}",
            r.etb_text()
        );
    }

    /// Rücknahme: ohne Abruf 422; mit Abruf nimmt sie genau die mitgenommenen Kinder mit, nicht
    /// eine eigens abgerufene; Unterstellung bleibt.
    #[tokio::test]
    async fn ruecknahme() {
        let l = lage().await;
        let deich = l.abschnitt("EA Deich").await;
        let zug = l.einheit("1. Zug", None).await;
        let g1 = l.einheit("Gruppe 1", Some(zug)).await;
        let g2 = l.einheit("Gruppe 2", Some(zug)).await;
        for id in [zug, g1, g2] {
            l.belege(l.br, "einheit", id, "eintritt").await;
        }
        assert!(ist_422(&l.aufheben(ObjektTyp::Einheit, zug).await));
        assert!(matches!(
            l.aufheben(ObjektTyp::Einheit, 99_999).await,
            Err(AppError::NotFound)
        ));
        l.abruf(einheit(g2)).await.unwrap();
        l.abruf(AbrufDaten {
            abschnitt: Some((deich, "EA Deich")),
            ..einheit(zug)
        })
        .await
        .unwrap();

        let r = l.aufheben(ObjektTyp::Einheit, zug).await.unwrap();
        assert_eq!(r.mitgenommen, vec![(g1, "Gruppe 1".to_string())]);
        assert_eq!(
            r.etb_text(),
            "Abruf von 1. Zug mit Gruppe 1 aus Bereitstellungsraum Sportplatz zurückgenommen"
        );
        for id in [zug, g1] {
            assert_eq!(l.juengstes("einheit", id).await.0, "abruf_aufgehoben");
        }
        assert_eq!(
            l.juengstes("einheit", g2).await.0,
            "abruf",
            "eigens abgerufen"
        );
        assert_eq!(l.einheit_zeile(zug).await, (Some(l.br), Some(deich)));
        assert!(
            ist_422(&l.aufheben(ObjektTyp::Einheit, zug).await),
            "zweimal"
        );
    }
}

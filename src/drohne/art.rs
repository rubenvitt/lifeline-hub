//! Adapterart „suchlage“ (LLH-2105): ruft die Schnittstelle `lagemonitor/v1` von Suchlage im
//! Takt des Adapterrahmens ab und legt die übersetzte Drohnenlage in den [`Store`]. Nichts davon
//! kommt in die Datenbank; die Art ist flüchtig.

use std::sync::Arc;

use age::secrecy::ExposeSecret;
use futures::future::BoxFuture;
use sqlx::SqliteConnection;

use super::repo;
use super::store::{Stand, Store};
use super::suchlage::{parse_lage, parse_photos, ParseError, Upstream};
use crate::adapter::art::{
    AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme,
};
use crate::adapter::repo::Adapter;
use crate::adapter::ziel::AbrufKontext;
use crate::adapter::zustand::AdapterFehler;
use crate::error::AppError;

/// Deckel der Antwort auf `/lage` (mit Karte).
pub const LAGE_DECKEL: usize = 4 * 1024 * 1024;
/// Deckel der Antwort auf `/photos`.
pub const FOTOS_DECKEL: usize = 2 * 1024 * 1024;

const PFAD_LAGE: &str = "/api/lagemonitor/v1/lage";
const PFAD_FOTOS: &str = "/api/lagemonitor/v1/photos";

const PLAETZE: &[Platz] = &[Platz {
    name: "token",
    bezeichnung: "Großbild-Zugang",
    pflicht: true,
}];

const FELDER: &[Feld] = &[Feld {
    name: "basis_url",
    bezeichnung: "Adresse von Suchlage",
    typ: FeldTyp::Url,
    pflicht: true,
    max: 512,
}];

/// Die Art „suchlage“. Der Store ist der Speicher, in den sie schreibt.
pub struct SuchlageArt {
    store: Arc<Store>,
}

impl SuchlageArt {
    pub fn new(store: Arc<Store>) -> Self {
        SuchlageArt { store }
    }
}

fn basis_ohne_schraegstrich(basis: &str) -> &str {
    basis.trim_end_matches('/')
}

/// Adresse von `/lage`, mit `?karte=<etag>`, wenn die Karte schon bekannt ist.
pub fn lage_url(basis: &str, etag: Option<&str>) -> String {
    let url = format!("{}{PFAD_LAGE}", basis_ohne_schraegstrich(basis));
    match etag {
        Some(e) => format!(
            "{url}?karte={}",
            percent_encoding::utf8_percent_encode(e, percent_encoding::NON_ALPHANUMERIC)
        ),
        None => url,
    }
}

/// Adresse von `/photos`.
pub fn fotos_url(basis: &str) -> String {
    format!("{}{PFAD_FOTOS}", basis_ohne_schraegstrich(basis))
}

fn von_parse(f: ParseError) -> Fehlschlag {
    Fehlschlag::new(match f {
        ParseError::VersionUnbekannt(_) => AdapterFehler::VersionUnbekannt,
        ParseError::Ungueltig => AdapterFehler::AntwortUngueltig,
    })
}

/// Ob sich zwei Stände inhaltlich unterscheiden (die Abrufzeiten zählen nicht).
fn ist_geaendert(vorher: Option<&Stand>, neu: &Stand) -> bool {
    let Some(v) = vorher else { return true };
    let mut a = v.lage.clone();
    let mut b = neu.lage.clone();
    a.stand_ms = 0;
    b.stand_ms = 0;
    a.quelle_stand_ms = 0;
    b.quelle_stand_ms = 0;
    a != b
}

/// Was ein Abruf in den Store schreibt.
struct SuchlageUebernahme {
    store: Arc<Store>,
    stand: Stand,
    geaendert: bool,
}

impl Uebernahme for SuchlageUebernahme {
    fn anzahl(&self) -> i64 {
        self.stand.lage.fluggeraete.len() as i64
    }

    fn uebernehmen<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            // Maßgeblich ist die Datenbank: sie sagt, ob ein laufender Einsatz die Quelle hält.
            let aktiv = repo::is_active(conn, &adapter.id).await?;
            self.store.set_zugeschaltet(&adapter.id, aktiv);
            if !aktiv {
                return Ok(0);
            }
            self.store.put(&adapter.id, self.stand.clone());
            Ok(i64::from(self.geaendert))
        })
    }
}

impl AdapterArt for SuchlageArt {
    fn code(&self) -> &'static str {
        "suchlage"
    }
    fn bezeichnung(&self) -> &'static str {
        "Suchlage (Drohne)"
    }
    fn plaetze(&self) -> &'static [Platz] {
        PLAETZE
    }
    fn felder(&self) -> &'static [Feld] {
        FELDER
    }
    fn intervall_min_s(&self) -> i64 {
        5
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        5
    }
    fn fluechtig(&self) -> bool {
        true
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let probe = kontext.is_probe;
            if !probe && !self.store.is_zugeschaltet(kontext.adapter_id) {
                return Ok(Box::new(OhneUebernahme(0)) as Box<dyn Uebernahme>);
            }
            let basis = kontext
                .einstellung_text("basis_url")
                .ok_or(Fehlschlag::new(AdapterFehler::ZielUngueltig))?;
            let token = kontext
                .geheimnis("token")
                .ok_or(Fehlschlag::new(AdapterFehler::Abgelehnt))?;
            // Ein Probelauf schaut nur auf die Fassung und berührt den Store nicht.
            let vorher = if probe {
                None
            } else {
                self.store.get(kontext.adapter_id)
            };
            let etag = vorher.as_ref().and_then(|s| s.map_etag.as_deref());

            let anfrage = kontext
                .get(&lage_url(basis, etag))?
                .bearer_auth(token.expose_secret());
            let antwort = kontext.send(anfrage).await?;
            let text = kontext.read_text(antwort, LAGE_DECKEL).await?;
            let vorige_karte = vorher
                .as_ref()
                .and_then(|s| Some((s.map_etag.as_deref()?, s.lage.karte.as_ref()?)));
            let jetzt_ms = chrono::Utc::now().timestamp_millis();
            let (mut lage, map_etag, photos_latest_ms, mut upstream) =
                parse_lage(kontext.adapter_id, text.as_bytes(), vorige_karte, jetzt_ms)
                    .map_err(von_parse)?;

            if probe {
                return Ok(
                    Box::new(OhneUebernahme(lage.fluggeraete.len() as i64)) as Box<dyn Uebernahme>
                );
            }

            let mut gemerkt_ms = photos_latest_ms;
            let fotos_geaendert = vorher
                .as_ref()
                .is_none_or(|s| s.photos_latest_ms != photos_latest_ms);
            if fotos_geaendert && photos_latest_ms.is_some() {
                match self
                    .fotos_holen(kontext, basis, token.expose_secret())
                    .await
                {
                    Ok((fotos, thumbs)) => {
                        lage.fotos = fotos;
                        upstream.fotos = thumbs;
                    }
                    Err(f) => {
                        // Die Lage bleibt brauchbar; die Fotos kommen beim nächsten Takt neu.
                        tracing::warn!(art = ?f.art, "Fotos der Drohnenquelle nicht abgerufen");
                        gemerkt_ms = vorher.as_ref().and_then(|s| s.photos_latest_ms);
                        if let Some(v) = &vorher {
                            lage.fotos = v.lage.fotos.clone();
                            upstream.fotos = v.upstream.fotos.clone();
                        }
                    }
                }
            } else if let Some(v) = &vorher {
                lage.fotos = v.lage.fotos.clone();
                upstream.fotos = v.upstream.fotos.clone();
            }

            let stand = Stand {
                lage,
                map_etag,
                photos_latest_ms: gemerkt_ms,
                upstream: Upstream {
                    videos: upstream.videos,
                    fotos: upstream.fotos,
                },
            };
            let geaendert = ist_geaendert(vorher.as_ref(), &stand);
            Ok(Box::new(SuchlageUebernahme {
                store: self.store.clone(),
                stand,
                geaendert,
            }) as Box<dyn Uebernahme>)
        })
    }
}

type FotosErgebnis = (
    Vec<super::vertrag::DrohnenFoto>,
    std::collections::HashMap<String, String>,
);

impl SuchlageArt {
    async fn fotos_holen(
        &self,
        kontext: &AbrufKontext<'_>,
        basis: &str,
        token: &str,
    ) -> Result<FotosErgebnis, Fehlschlag> {
        let anfrage = kontext.get(&fotos_url(basis))?.bearer_auth(token);
        let antwort = kontext.send(anfrage).await?;
        let text = kontext.read_text(antwort, FOTOS_DECKEL).await?;
        parse_photos(kontext.adapter_id, text.as_bytes()).map_err(von_parse)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::art::Verzeichnis;
    use serde_json::Map;
    use std::collections::HashMap;

    #[test]
    fn url_der_lage_haengt_den_etag_an() {
        assert_eq!(
            lage_url("https://s.example", None),
            "https://s.example/api/lagemonitor/v1/lage"
        );
        assert_eq!(
            lage_url("https://s.example/", Some("ab12")),
            "https://s.example/api/lagemonitor/v1/lage?karte=ab12"
        );
        assert_eq!(
            lage_url("https://s.example", Some("a b&c")),
            "https://s.example/api/lagemonitor/v1/lage?karte=a%20b%26c"
        );
        assert_eq!(
            fotos_url("https://s.example/"),
            "https://s.example/api/lagemonitor/v1/photos"
        );
    }

    #[tokio::test]
    async fn nicht_zugeschaltet_ruft_nicht_ab() {
        let art = SuchlageArt::new(Arc::new(Store::new()));
        // Weder Einstellungen noch Geheimnis: ein Abruf scheiterte schon vor dem Netz.
        let leer = Map::new();
        let geheimnisse = HashMap::new();
        let k = AbrufKontext::new("a", 1, &leer, &geheimnisse, false, false);
        let u = art.abrufen(&k).await.expect("kein Fehlschlag");
        assert_eq!(u.anzahl(), 0);
    }

    #[test]
    fn kenndaten_der_art() {
        let art = SuchlageArt::new(Arc::new(Store::new()));
        assert_eq!(art.code(), "suchlage");
        assert_eq!(art.bezeichnung(), "Suchlage (Drohne)");
        assert!(art.fluechtig());
        assert_eq!((art.intervall_min_s(), art.intervall_vorschlag_s()), (5, 5));
        assert_eq!(art.plaetze()[0].name, "token");
        assert_eq!(art.felder()[0].max, 512);
    }

    #[test]
    fn verzeichnis_enthaelt_suchlage() {
        let v = Verzeichnis::produktiv(Arc::new(Store::new()));
        assert!(v.find("suchlage").is_some());
    }
}

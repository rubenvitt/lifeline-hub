//! Adapterart „veranstaltungen_abruf“ (LLH-2097): ruft geplante Veranstaltungen über den Vertrag
//! „Veranstaltungen-Abruf v1“ ab (`docs/schnittstellen/veranstaltungen-abruf.md`) und legt sie in
//! `veranstaltung_extern` ab. Die Art kennt nur den Vertrag, keine liefernde Anwendung beim Namen.

use age::secrecy::ExposeSecret;
use futures::future::BoxFuture;
use sqlx::SqliteConnection;

use super::repo;
use super::vertrag::{self, Veranstaltung};
use crate::adapter::art::{
    AdapterArt, Fehlschlag, Feld, FeldTyp, OhneUebernahme, Platz, Uebernahme,
};
use crate::adapter::repo::Adapter;
use crate::adapter::ziel::{fehler_aus_status, AbrufKontext};
use crate::adapter::zustand::AdapterFehler;
use crate::error::AppError;

/// Code der Art, wie er in `adapter.art` steht.
pub const ART: &str = "veranstaltungen_abruf";

/// Deckel der Antwort: 500 Veranstaltungen bleiben darunter.
pub const DECKEL: usize = 512 * 1024;

const PFAD: &str = "/api/abruf";

const PLAETZE: &[Platz] = &[Platz {
    name: "schluessel",
    bezeichnung: "Abruf-Schlüssel",
    pflicht: true,
    intern: false,
}];

const FELDER: &[Feld] = &[Feld {
    name: "basis_url",
    bezeichnung: "Adresse der Schnittstelle",
    typ: FeldTyp::Url,
    pflicht: true,
    max: 512,
}];

/// Adresse des Abrufs unter der eingetragenen Basis.
pub fn abruf_url(basis: &str) -> String {
    format!("{}{PFAD}", basis.trim_end_matches('/'))
}

/// Setzt Anmeldung und erwartetes Format an eine Anfrage.
fn mit_schluessel(anfrage: reqwest::RequestBuilder, schluessel: &str) -> reqwest::RequestBuilder {
    anfrage
        .bearer_auth(schluessel)
        .header(reqwest::header::ACCEPT, "application/json")
}

/// Wertet eine Antwort aus: Status, Deckel, Vertrag. `AbrufKontext::send` ordnet den Status
/// schon ein; hier steht es noch einmal, damit eine Antwort auch ohne `send` (Tests) nur als 2xx
/// gelesen wird.
async fn auswerten(
    kontext: &AbrufKontext<'_>,
    antwort: reqwest::Response,
) -> Result<Vec<Veranstaltung>, Fehlschlag> {
    let status = antwort.status().as_u16();
    if let Some(art) = fehler_aus_status(status) {
        return Err(Fehlschlag {
            art,
            status: Some(status),
        });
    }
    let rumpf = kontext.read_bytes(antwort, DECKEL).await?;
    vertrag::parse(&rumpf).map_err(Fehlschlag::new)
}

/// Was ein Abruf in `veranstaltung_extern` schreibt.
struct VeranstaltungenUebernahme {
    liste: Vec<Veranstaltung>,
}

impl Uebernahme for VeranstaltungenUebernahme {
    fn anzahl(&self) -> i64 {
        self.liste.len() as i64
    }

    fn uebernehmen<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            repo::uebernehmen(
                conn,
                adapter.org_id,
                &adapter.id,
                &self.liste,
                &crate::zeit::jetzt(),
            )
            .await
        })
    }
}

/// Die Art „veranstaltungen_abruf“. Ohne Zustand: was sie liefert, steht in der Datenbank.
#[derive(Debug, Default)]
pub struct VeranstaltungenAbrufArt;

impl AdapterArt for VeranstaltungenAbrufArt {
    fn code(&self) -> &'static str {
        ART
    }
    fn bezeichnung(&self) -> &'static str {
        "Veranstaltungen (Schnittstelle v1)"
    }
    fn plaetze(&self) -> &'static [Platz] {
        PLAETZE
    }
    fn felder(&self) -> &'static [Feld] {
        FELDER
    }
    fn intervall_min_s(&self) -> i64 {
        60
    }
    fn intervall_vorschlag_s(&self) -> i64 {
        300
    }

    fn abrufen<'a>(
        &'a self,
        kontext: &'a AbrufKontext<'a>,
    ) -> BoxFuture<'a, Result<Box<dyn Uebernahme>, Fehlschlag>> {
        Box::pin(async move {
            let basis = kontext
                .einstellung_text("basis_url")
                .ok_or(Fehlschlag::new(AdapterFehler::ZielUngueltig))?;
            let schluessel = kontext
                .geheimnis("schluessel")
                .ok_or(Fehlschlag::new(AdapterFehler::GeheimnisFehlt))?;
            let anfrage =
                mit_schluessel(kontext.get(&abruf_url(basis))?, schluessel.expose_secret());
            let antwort = kontext.send(anfrage).await?;
            let liste = auswerten(kontext, antwort).await?;
            if kontext.is_probe {
                return Ok(Box::new(OhneUebernahme(liste.len() as i64)) as Box<dyn Uebernahme>);
            }
            Ok(Box::new(VeranstaltungenUebernahme { liste }) as Box<dyn Uebernahme>)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::art::Verzeichnis;
    use crate::http_begrenzt::fixture::{aufgeblaehtes_json, bediene};
    use age::secrecy::SecretString;
    use axum::http::{HeaderMap, StatusCode};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use serde_json::{json, Map, Value};
    use std::collections::HashMap;

    const SCHLUESSEL: &str = "abruf-schluessel-fuer-tests";

    fn antwort_v1() -> Value {
        json!({
            "fassung": 1,
            "stand": "2026-11-25T08:00:00Z",
            "veranstaltungen": [{
                "id": "v1",
                "name": "Stadtfest",
                "art": "sanitaetsdienst",
                "status": "zugesagt",
                "ort": "Marktplatz",
                "veranstalter": "Stadtmarketing",
                "beginn": "2026-11-28T07:00:00Z",
                "ende": "2026-11-28T21:00:00Z",
                "bemerkung": "",
                "geaendert": "2026-11-24T19:12:00Z"
            }]
        })
    }

    /// Ein Testserver nach dem Vertrag: prüft den Schlüssel wie die liefernde Seite (401 mit
    /// `schluessel_ungueltig`) und liefert unter `/fassung2` und `/gross` Abweichungen.
    async fn testserver() -> String {
        async fn abruf(kopf: HeaderMap) -> axum::response::Response {
            let erwartet = format!("Bearer {SCHLUESSEL}");
            if kopf.get("authorization").and_then(|w| w.to_str().ok()) != Some(&erwartet) {
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(json!({ "error": { "code": "schluessel_ungueltig" } })),
                )
                    .into_response();
            }
            axum::Json(antwort_v1()).into_response()
        }
        let app = axum::Router::new()
            .route("/api/abruf", get(abruf))
            .route(
                "/fassung2/api/abruf",
                get(|| async {
                    let mut v = antwort_v1();
                    v["fassung"] = json!(2);
                    axum::Json(v)
                }),
            )
            .route(
                "/gross/api/abruf",
                get(|| async { aufgeblaehtes_json(r#"{"fassung":1,"x":""#, DECKEL, r#""}"#) }),
            );
        bediene(app).await
    }

    /// Ruft am Testserver ab wie die Art: dieselbe Adresse, dieselbe Anmeldung, dieselbe
    /// Auswertung. Der Weg über `AbrufKontext::send` geht nur über https an ein öffentliches Ziel
    /// (Zielschutz); den prüft `adapter::ziel`.
    async fn abruf_am_testserver(
        basis: &str,
        schluessel: &str,
    ) -> Result<Vec<Veranstaltung>, Fehlschlag> {
        let leer = Map::new();
        let geheimnisse = HashMap::new();
        let k = AbrufKontext::new("a", 1, &leer, &geheimnisse, false, false);
        let anfrage = mit_schluessel(reqwest::Client::new().get(abruf_url(basis)), schluessel);
        auswerten(&k, anfrage.send().await.unwrap()).await
    }

    #[tokio::test]
    async fn abruf_am_testserver_liefert_die_veranstaltungen() {
        let basis = testserver().await;
        let liste = abruf_am_testserver(&format!("{basis}/"), SCHLUESSEL)
            .await
            .unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].name, "Stadtfest");
        assert_eq!(liste[0].beginn_at, "2026-11-28 07:00:00");
    }

    #[tokio::test]
    async fn falscher_schluessel_ist_abgelehnt() {
        let basis = testserver().await;
        let f = abruf_am_testserver(&basis, "falsch").await.unwrap_err();
        assert_eq!(f.art, AdapterFehler::Abgelehnt);
        assert_eq!(f.status, Some(401));
    }

    #[tokio::test]
    async fn andere_fassung_und_zu_grosse_antwort_werden_eingeordnet() {
        let basis = testserver().await;
        let f = abruf_am_testserver(&format!("{basis}/fassung2"), SCHLUESSEL)
            .await
            .unwrap_err();
        assert_eq!(f.art, AdapterFehler::VersionUnbekannt);
        let f = abruf_am_testserver(&format!("{basis}/gross"), SCHLUESSEL)
            .await
            .unwrap_err();
        assert_eq!(f.art, AdapterFehler::ZuGross);
    }

    #[tokio::test]
    async fn abruf_geht_durch_den_zielschutz() {
        let art = VeranstaltungenAbrufArt;
        let mut einstellungen = Map::new();
        einstellungen.insert("basis_url".into(), json!("https://127.0.0.1"));
        let mut geheimnisse = HashMap::new();
        geheimnisse.insert("schluessel".to_string(), SecretString::from(SCHLUESSEL));
        let k = AbrufKontext::new("a", 1, &einstellungen, &geheimnisse, true, false);
        let f = art.abrufen(&k).await.err().expect("Loopback ist gesperrt");
        assert_eq!(f.art, AdapterFehler::ZielIntern);

        // Ohne Schlüssel geht keine Anfrage hinaus.
        let ohne = HashMap::new();
        let k = AbrufKontext::new("a", 1, &einstellungen, &ohne, true, false);
        let f = art.abrufen(&k).await.err().expect("kein Schlüssel");
        assert_eq!(f.art, AdapterFehler::GeheimnisFehlt);
    }

    #[test]
    fn adresse_des_abrufs() {
        assert_eq!(
            abruf_url("https://v.example"),
            "https://v.example/api/abruf"
        );
        assert_eq!(
            abruf_url("https://v.example/m/veranstaltungen/"),
            "https://v.example/m/veranstaltungen/api/abruf"
        );
    }

    #[test]
    fn kenndaten_der_art() {
        let art = VeranstaltungenAbrufArt;
        assert_eq!(art.code(), "veranstaltungen_abruf");
        assert_eq!(art.bezeichnung(), "Veranstaltungen (Schnittstelle v1)");
        assert!(!art.fluechtig());
        assert_eq!(
            (art.intervall_min_s(), art.intervall_vorschlag_s()),
            (60, 300)
        );
        assert_eq!(art.plaetze()[0].name, "schluessel");
        assert!(art.plaetze()[0].pflicht);
        assert_eq!(art.felder()[0].name, "basis_url");
        assert_eq!(art.felder()[0].typ, FeldTyp::Url);
        assert_eq!(art.felder()[0].max, 512);
    }

    #[test]
    fn verzeichnis_enthaelt_die_art() {
        let v = Verzeichnis::produktiv(
            std::sync::Arc::new(crate::drohne::Store::new()),
            Default::default(),
        );
        assert!(v.find(ART).is_some());
    }
}

//! Zustellung an Threema-IDs über das Threema Gateway (LLH-2096, Spec
//! `docs/superpowers/specs/2026-11-28-gq6qs7tg-ausgang-threema-design.md`, Abschnitt 6).
//!
//! Je Versand: den öffentlichen Schlüssel des Empfängers abfragen und mit dem gemerkten
//! vergleichen ([`Versandauftrag::threema_schluessel`]); weicht er ab, geht nichts hinaus. Dann
//! die feste Folge der Teile ([`threema_teile`]: zuerst der Text, bei Bedarf geteilt, dann je
//! PNG-Anlage eine Dateinachricht), gemerkte Teile ausgelassen. Jede Nachricht ist Ende-zu-Ende
//! verschlüsselt (`adapter::threema::krypto`). Threema kennt keine Transaktions-ID: bricht die
//! Verbindung nach dem Absenden ab, ist der Versand `ungewiss` und wird nie selbst wiederholt.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use age::secrecy::ExposeSecret;
use futures::future::BoxFuture;

use super::{kanal_nicht_bedient, Fehlschlag, Versandauftrag, Zusteller, Zustellfehler, Zustellt};
use crate::adapter::threema::krypto::{
    self, parse_oeffentlich_hex, parse_privater_schluessel, verschluessele_blob, verschluesseln,
    Inhalt, TEXT_MAX,
};
use crate::adapter::threema::{self, ThreemaFehler, ThreemaZugang, Ziel};
use crate::adapter::threema_art::{PLATZ_PRIVAT, PLATZ_SECRET};
use crate::externe_stelle::KanalArt;

/// Frist einer ganzen Threema-Zustellung samt aller Uploads. Kürzer als `lauf::HAENGT_NACH`.
pub const THREEMA_ZUSTELL_ZEITLIMIT: Duration = Duration::from_secs(10 * 60);

/// Ein Teil eines Threema-Versands; die Nummer ist seine Position in [`threema_teile`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Teil {
    Text(String),
    /// Index in `Versandauftrag::anhaenge`.
    Anlage(usize),
}

/// Die feste Folge der Teile: zuerst der Text (`*Betreff*`, Leerzeile, Inhalt samt Fuß), geteilt
/// nach [`teile_text`], dann je Anlage ein Teil. Weil der Schnappschuss unveränderlich ist, ergibt
/// jeder Versuch dieselbe Folge.
pub fn threema_teile(betreff: &str, inhalt: &str, anhaenge: usize) -> Vec<Teil> {
    let text = format!("*{betreff}*\n\n{inhalt}");
    teile_text(&text, TEXT_MAX)
        .into_iter()
        .map(Teil::Text)
        .chain((0..anhaenge).map(Teil::Anlage))
        .collect()
}

/// Teilt einen Text in Stücke von höchstens `max` Bytes: an Absätzen, notfalls an Zeilen, zuletzt
/// an Zeichengrenzen. Passt er ganz, bleibt er ein Teil ohne Präfix; sonst beginnt jeder Teil
/// mit „(i/k) “, dessen Länge mitzählt. Die Trenner an den Teilgrenzen entfallen.
pub fn teile_text(text: &str, max: usize) -> Vec<String> {
    if text.len() <= max {
        return vec![text.to_string()];
    }
    let stellen = |n: usize| n.to_string().len();
    // Annahme für die Stellenzahl von k; wächst, bis die Präfixe passen.
    let mut k = 9;
    loop {
        let praefix = 2 * stellen(k) + 4; // "(" i "/" k ") "
        let stuecke = packe(text, max.saturating_sub(praefix).max(1), 0);
        let n = stuecke.len();
        if stellen(n) <= stellen(k) {
            return stuecke
                .into_iter()
                .enumerate()
                .map(|(i, s)| format!("({}/{n}) {s}", i + 1))
                .collect();
        }
        k = n;
    }
}

/// Packt `s` gierig in Stücke von höchstens `budget` Bytes; Ebene 0 trennt an Absätzen, 1 an
/// Zeilen, danach hart an Zeichengrenzen.
fn packe(s: &str, budget: usize, ebene: usize) -> Vec<String> {
    if s.len() <= budget {
        return vec![s.to_string()];
    }
    let trenner = match ebene {
        0 => "\n\n",
        1 => "\n",
        _ => return hart(s, budget),
    };
    let mut aus = Vec::new();
    let mut jetzt = String::new();
    for stueck in s.split(trenner) {
        let laenge = if jetzt.is_empty() {
            stueck.len()
        } else {
            jetzt.len() + trenner.len() + stueck.len()
        };
        if laenge <= budget {
            if !jetzt.is_empty() {
                jetzt.push_str(trenner);
            }
            jetzt.push_str(stueck);
            continue;
        }
        if !jetzt.is_empty() {
            aus.push(std::mem::take(&mut jetzt));
        }
        if stueck.len() <= budget {
            jetzt = stueck.to_string();
        } else {
            let mut tiefer = packe(stueck, budget, ebene + 1);
            jetzt = tiefer.pop().unwrap_or_default();
            aus.extend(tiefer);
        }
    }
    if !jetzt.is_empty() || aus.is_empty() {
        aus.push(jetzt);
    }
    aus
}

/// Teilt an Zeichengrenzen, nie mitten in einem UTF-8-Zeichen.
fn hart(s: &str, budget: usize) -> Vec<String> {
    let mut aus = Vec::new();
    let mut rest = s;
    while !rest.is_empty() {
        let mut ende = budget.min(rest.len());
        while !rest.is_char_boundary(ende) {
            ende -= 1;
        }
        if ende == 0 {
            // Ein Zeichen größer als das Budget (nur bei winzigem Budget): ganz nehmen.
            ende = rest.chars().next().map_or(rest.len(), char::len_utf8);
        }
        aus.push(rest[..ende].to_string());
        rest = &rest[ende..];
    }
    aus
}

/// Woher der Zusteller sein [`Ziel`] nimmt (`lan_erlaubt` der Anbindung).
pub type ZielWahl = Arc<dyn Fn(bool) -> Ziel + Send + Sync>;

/// Stellt Versände an Threema-IDs zu.
pub struct ThreemaZusteller {
    ziel: ZielWahl,
}

impl ThreemaZusteller {
    /// Der feste Host des Gateways über den Zielschutz.
    pub fn produktiv() -> Self {
        ThreemaZusteller::new(Arc::new(Ziel::produktiv))
    }

    /// Mit einem anderen Ziel (Tests: ein lokales Doppel des Gateways).
    pub fn new(ziel: ZielWahl) -> Self {
        ThreemaZusteller { ziel }
    }
}

fn fehlschlag(
    fehler: Zustellfehler,
    grund: &str,
    teile: Vec<(i64, String)>,
    neuer_schluessel: Option<String>,
) -> Fehlschlag {
    Fehlschlag {
        fehler,
        grund: grund.into(),
        smtp_status: None,
        teile,
        neuer_schluessel,
    }
}

/// Ordnet einen Fehler des Gateways ein (Spec Abschnitt 6, „Fehlerzuordnung“).
fn einordnen(e: ThreemaFehler) -> (Zustellfehler, &'static str) {
    let voruebergehend = Zustellfehler::Voruebergehend { nicht_vor: None };
    let anbindung = Zustellfehler::Anbindung {
        pruefung_vorziehen: true,
    };
    match e {
        ThreemaFehler::Status(401) => (anbindung, "Threema lehnt die Anmeldung ab"),
        ThreemaFehler::Status(402) => (anbindung, "Kein Guthaben im Threema-Gateway"),
        ThreemaFehler::Status(400 | 404) => (Zustellfehler::Abgelehnt, "Threema-ID unbekannt"),
        ThreemaFehler::Status(413) => (Zustellfehler::ZuGross, "Für Threema zu groß"),
        ThreemaFehler::Status(429) => (voruebergehend, "Zu viele Anfragen an Threema"),
        ThreemaFehler::Ungewiss => (
            Zustellfehler::Ungewiss,
            "Ob Threema die Nachricht angenommen hat, ist unklar",
        ),
        ThreemaFehler::SchluesselPassenNicht | ThreemaFehler::Antwort => {
            (anbindung, "Threema-Gateway nicht nutzbar")
        }
        ThreemaFehler::Status(_)
        | ThreemaFehler::Verbindung
        | ThreemaFehler::Dns
        | ThreemaFehler::Tls
        | ThreemaFehler::ZielIntern => (voruebergehend, "Threema nicht erreichbar"),
    }
}

/// Ein Upload sendet keine Nachricht: nur Anmeldung, Guthaben und Größe zählen wie beim Senden,
/// alles andere ist vorübergehend (eine ID gibt es beim Upload nicht).
fn einordnen_upload(e: ThreemaFehler) -> (Zustellfehler, &'static str) {
    match e {
        ThreemaFehler::Status(401 | 402 | 413) => einordnen(e),
        _ => (
            Zustellfehler::Voruebergehend { nicht_vor: None },
            "Threema nicht erreichbar",
        ),
    }
}

const SCHLUESSEL_GEAENDERT: &str = "Der Schlüssel der Threema-ID hat sich geändert";
const NICHT_VERSCHLUESSELBAR: &str = "Verschlüsseln nicht möglich";

impl Zusteller for ThreemaZusteller {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            if auftrag.kanal != KanalArt::Threema {
                return Err(kanal_nicht_bedient());
            }
            let z = auftrag.zugang;
            let anbindung = Zustellfehler::Anbindung {
                pruefung_vorziehen: true,
            };
            let (Some(gateway_id), Some(secret)) =
                (z.einstellung("gateway_id"), z.geheimnisse.get(PLATZ_SECRET))
            else {
                return Err(fehlschlag(
                    anbindung,
                    "Threema-Gateway nicht nutzbar",
                    Vec::new(),
                    None,
                ));
            };
            let Some(Ok(privat)) = z
                .geheimnisse
                .get(PLATZ_PRIVAT)
                .map(|p| parse_privater_schluessel(p.expose_secret()))
            else {
                return Err(fehlschlag(
                    Zustellfehler::Verschluesselung,
                    NICHT_VERSCHLUESSELBAR,
                    Vec::new(),
                    None,
                ));
            };
            let zugang = ThreemaZugang {
                gateway_id,
                secret,
                privat: &privat,
            };
            let ziel = (self.ziel)(z.lan_erlaubt);
            let teile: Arc<Mutex<Vec<(i64, String)>>> = Arc::default();
            let neu: Arc<Mutex<Option<String>>> = Arc::default();
            let im_senden = AtomicBool::new(false);
            let lauf = senden(auftrag, &ziel, &zugang, &teile, &neu, &im_senden);
            let ergebnis = tokio::time::timeout(THREEMA_ZUSTELL_ZEITLIMIT, lauf).await;
            let teile = std::mem::take(&mut *teile.lock().unwrap());
            let neuer_schluessel = neu.lock().unwrap().take();
            match ergebnis {
                Ok(Ok(())) => Ok(Zustellt {
                    teile,
                    neuer_schluessel,
                }),
                Ok(Err((fehler, grund))) => Err(fehlschlag(fehler, grund, teile, neuer_schluessel)),
                Err(_) => {
                    let (fehler, grund) = if im_senden.load(Ordering::SeqCst) {
                        einordnen(ThreemaFehler::Ungewiss)
                    } else {
                        (
                            Zustellfehler::Voruebergehend { nicht_vor: None },
                            "Threema antwortet nicht",
                        )
                    };
                    Err(fehlschlag(fehler, grund, teile, neuer_schluessel))
                }
            }
        })
    }
}

/// Der eigentliche Ablauf; gesendete Teile und ein neu abgefragter Schlüssel landen sofort in
/// `teile` bzw. `neu`, damit eine abgelaufene Frist sie nicht verliert.
async fn senden(
    auftrag: &Versandauftrag<'_>,
    ziel: &Ziel,
    zugang: &ThreemaZugang<'_>,
    teile: &Mutex<Vec<(i64, String)>>,
    neu: &Mutex<Option<String>>,
    im_senden: &AtomicBool,
) -> Result<(), (Zustellfehler, &'static str)> {
    let an = auftrag.adresse;
    let schluessel = threema::pubkey(ziel, zugang, an).await.map_err(einordnen)?;
    match auftrag.threema_schluessel {
        Some(gemerkt) => {
            if parse_oeffentlich_hex(gemerkt) != Some(schluessel) {
                return Err((Zustellfehler::Verschluesselung, SCHLUESSEL_GEAENDERT));
            }
        }
        None => *neu.lock().unwrap() = Some(krypto::hex_encode(&schluessel)),
    }
    let kein_krypto = |_| (Zustellfehler::Verschluesselung, NICHT_VERSCHLUESSELBAR);
    for (nr, teil) in threema_teile(auftrag.betreff, auftrag.inhalt, auftrag.anhaenge.len())
        .into_iter()
        .enumerate()
    {
        let nr = nr as i64;
        if auftrag.gesendet.contains(&nr) {
            continue;
        }
        let nachricht = match teil {
            Teil::Text(t) => verschluesseln(&Inhalt::Text(&t), zugang.privat, &schluessel)
                .map_err(kein_krypto)?,
            Teil::Anlage(i) => {
                let (name, bytes) = &auftrag.anhaenge[i];
                let (blob_schluessel, chiffrat) =
                    verschluessele_blob(bytes).map_err(kein_krypto)?;
                let blob_id = threema::upload_blob(ziel, zugang, &chiffrat)
                    .await
                    .map_err(einordnen_upload)?;
                let inhalt = Inhalt::Datei {
                    blob_id: &blob_id,
                    schluessel: &blob_schluessel,
                    mime: "image/png",
                    name,
                    groesse: bytes.len(),
                };
                verschluesseln(&inhalt, zugang.privat, &schluessel).map_err(kein_krypto)?
            }
        };
        im_senden.store(true, Ordering::SeqCst);
        let id = threema::send_e2e(ziel, zugang, an, &nachricht)
            .await
            .map_err(einordnen)?;
        im_senden.store(false, Ordering::SeqCst);
        teile.lock().unwrap().push((nr, id));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::lauf::Versandzugang;
    use crate::adapter::threema::krypto::{oeffentlicher_schluessel, PrivaterSchluessel};
    use crate::http_begrenzt::fixture::bediene;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use axum::routing::{get, post};
    use axum::Router;
    use proptest::prelude::*;

    #[test]
    fn kurzer_text_ist_ein_teil_ohne_praefix() {
        assert_eq!(teile_text("Hallo", 3500), vec!["Hallo".to_string()]);
    }

    #[test]
    fn langer_text_teilt_an_absaetzen_mit_praefix() {
        let absatz = "a".repeat(1500);
        let text = format!("{absatz}\n\n{absatz}\n\n{absatz}");
        let t = teile_text(&text, 3500);
        assert_eq!(t.len(), 2, "{t:?}");
        assert!(t[0].starts_with("(1/2) "));
        assert!(t[1].starts_with("(2/2) "));
        assert_eq!(t[0], format!("(1/2) {absatz}\n\n{absatz}"));
    }

    #[test]
    fn fuss_steht_im_letzten_teil() {
        let inhalt = format!(
            "{}\n\n{}\n-- \nGesendet mit Lifeline Hub",
            "x".repeat(3000),
            "y".repeat(3000)
        );
        let t = threema_teile("Lage", &inhalt, 0);
        let texte: Vec<_> = t
            .iter()
            .map(|t| match t {
                Teil::Text(s) => s.clone(),
                Teil::Anlage(_) => unreachable!(),
            })
            .collect();
        assert!(texte.len() >= 2);
        assert!(texte.last().unwrap().contains("Gesendet mit"));
        assert!(texte[..texte.len() - 1]
            .iter()
            .all(|s| !s.contains("Gesendet mit")));
        assert!(texte[0].contains("*Lage*"));
    }

    #[test]
    fn threema_teile_text_zuerst_dann_anlagen() {
        let t = threema_teile("B", "I", 2);
        assert_eq!(
            t,
            vec![
                Teil::Text("*B*\n\nI".into()),
                Teil::Anlage(0),
                Teil::Anlage(1)
            ]
        );
    }

    fn ohne_praefix(s: &str) -> &str {
        if s.starts_with('(') {
            s.split_once(") ").map_or(s, |(_, r)| r)
        } else {
            s
        }
    }

    proptest! {
        #[test]
        fn kein_teil_ist_laenger_als_max_auch_mit_umlauten(
            text in "[aä\n]{0,20000}",
            max in prop::sample::select(vec![40usize, 200, 3500]),
        ) {
            let teile = teile_text(&text, max);
            for t in &teile {
                prop_assert!(t.len() <= max, "{} > {}", t.len(), max);
            }
            let zusammen: String = teile.iter().map(|t| ohne_praefix(t)).collect::<String>();
            prop_assert_eq!(zusammen.replace('\n', ""), text.replace('\n', ""));
        }
    }

    // --- Zusteller gegen ein Doppel des Gateways ---

    const ID: &str = "ECHOECHO";

    struct Doppel {
        aufrufe: Arc<Mutex<Vec<String>>>,
    }

    /// Ein Gateway mit gegebenem Empfängerschlüssel; `send_status` je Aufruf von `send_e2e`
    /// (danach 200), `upload_status` für jeden Upload.
    async fn gateway(
        empfaenger: [u8; 32],
        send_status: Vec<u16>,
        upload_status: u16,
    ) -> (ZielWahl, Doppel) {
        let aufrufe: Arc<Mutex<Vec<String>>> = Arc::default();
        let send = Arc::new(Mutex::new(std::collections::VecDeque::from(send_status)));
        let (a1, a2, a3) = (aufrufe.clone(), aufrufe.clone(), aufrufe.clone());
        let zaehler = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/pubkeys/{id}",
                get(move || {
                    a1.lock().unwrap().push("pubkeys".into());
                    async move { krypto::hex_encode(&empfaenger) }
                }),
            )
            .route(
                "/upload_blob",
                post(move || {
                    a2.lock().unwrap().push("upload".into());
                    async move {
                        if upload_status == 200 {
                            "00112233445566778899aabbccddeeff".into_response()
                        } else {
                            StatusCode::from_u16(upload_status).unwrap().into_response()
                        }
                    }
                }),
            )
            .route(
                "/send_e2e",
                post(move || {
                    a3.lock().unwrap().push("send".into());
                    let code = send.lock().unwrap().pop_front().unwrap_or(200);
                    let n = zaehler.fetch_add(1, Ordering::SeqCst);
                    async move {
                        if code == 200 {
                            format!("id{n:014}").into_response()
                        } else {
                            StatusCode::from_u16(code).unwrap().into_response()
                        }
                    }
                }),
            );
        let basis = bediene(app).await;
        let wahl: ZielWahl =
            Arc::new(move |_| Ziel::mit_client(basis.clone(), reqwest::Client::new()));
        (wahl, Doppel { aufrufe })
    }

    fn zugang() -> Versandzugang {
        let mut einstellungen = serde_json::Map::new();
        einstellungen.insert("gateway_id".into(), "*TESTGW1".into());
        let mut geheimnisse = std::collections::HashMap::new();
        geheimnisse.insert(PLATZ_SECRET.to_string(), "geheim".to_string().into());
        geheimnisse.insert(PLATZ_PRIVAT.to_string(), "05".repeat(32).into());
        Versandzugang {
            einstellungen,
            geheimnisse,
            lan_erlaubt: false,
            adapter_id: "a".into(),
        }
    }

    fn empfaenger() -> [u8; 32] {
        oeffentlicher_schluessel(&PrivaterSchluessel::from_bytes([7; 32]))
    }

    async fn zustellen(
        wahl: ZielWahl,
        gesendet: &[i64],
        gemerkt: Option<&str>,
    ) -> Result<Zustellt, Fehlschlag> {
        let zugang = zugang();
        let anhaenge = vec![("anlage-1.png".to_string(), vec![1u8, 2, 3])];
        let auftrag = Versandauftrag {
            versand_id: "v1",
            kanal: KanalArt::Threema,
            zugang: &zugang,
            adresse: ID,
            betreff: "Lage",
            inhalt: "Alles ruhig",
            anhaenge: &anhaenge,
            pdf: None,
            gesendet,
            threema_schluessel: gemerkt,
        };
        ThreemaZusteller::new(wahl).zustellen(&auftrag).await
    }

    #[tokio::test]
    async fn sendet_text_und_bild_und_meldet_nachrichten_ids() {
        let (wahl, d) = gateway(empfaenger(), vec![], 200).await;
        let z = zustellen(wahl, &[], None).await.unwrap();
        assert_eq!(
            z.teile,
            vec![
                (0, "id00000000000000".into()),
                (1, "id00000000000001".into())
            ]
        );
        assert_eq!(z.neuer_schluessel, Some(krypto::hex_encode(&empfaenger())));
        assert_eq!(
            *d.aufrufe.lock().unwrap(),
            ["pubkeys", "send", "upload", "send"]
        );
    }

    #[tokio::test]
    async fn laesst_gemerkte_teile_aus() {
        let (wahl, d) = gateway(empfaenger(), vec![], 200).await;
        let hex = krypto::hex_encode(&empfaenger());
        let z = zustellen(wahl, &[0], Some(&hex)).await.unwrap();
        assert_eq!(z.teile.len(), 1);
        assert_eq!(z.teile[0].0, 1);
        assert_eq!(z.neuer_schluessel, None, "schon gemerkt");
        assert_eq!(*d.aufrufe.lock().unwrap(), ["pubkeys", "upload", "send"]);
    }

    #[tokio::test]
    async fn abweichender_schluessel_sendet_nichts() {
        let (wahl, d) = gateway(empfaenger(), vec![], 200).await;
        let f = zustellen(wahl, &[], Some(&"ee".repeat(32)))
            .await
            .unwrap_err();
        assert_eq!(f.fehler, Zustellfehler::Verschluesselung);
        assert_eq!(f.grund, SCHLUESSEL_GEAENDERT);
        assert_eq!(f.neuer_schluessel, None);
        assert_eq!(*d.aufrufe.lock().unwrap(), ["pubkeys"]);
    }

    #[tokio::test]
    async fn fehlerzuordnung() {
        let fall = [
            (
                401,
                Zustellfehler::Anbindung {
                    pruefung_vorziehen: true,
                },
            ),
            (
                402,
                Zustellfehler::Anbindung {
                    pruefung_vorziehen: true,
                },
            ),
            (400, Zustellfehler::Abgelehnt),
            (404, Zustellfehler::Abgelehnt),
            (413, Zustellfehler::ZuGross),
            (429, Zustellfehler::Voruebergehend { nicht_vor: None }),
            (500, Zustellfehler::Voruebergehend { nicht_vor: None }),
            (503, Zustellfehler::Voruebergehend { nicht_vor: None }),
        ];
        for (code, erwartet) in fall {
            let (wahl, _) = gateway(empfaenger(), vec![code], 200).await;
            let f = zustellen(wahl, &[], None).await.unwrap_err();
            assert_eq!(f.fehler, erwartet, "{code}");
            assert!(f.teile.is_empty(), "{code}");
            assert!(
                f.neuer_schluessel.is_some(),
                "{code}: Schlüssel trotzdem merken"
            );
        }
    }

    #[tokio::test]
    async fn upload_400_ist_voruebergehend_nicht_id_unbekannt() {
        let (wahl, _) = gateway(empfaenger(), vec![], 400).await;
        let f = zustellen(wahl, &[], None).await.unwrap_err();
        assert_eq!(f.fehler, Zustellfehler::Voruebergehend { nicht_vor: None });
        assert_eq!(f.grund, "Threema nicht erreichbar");
        assert_eq!(f.teile, vec![(0, "id00000000000000".into())]);
    }

    #[tokio::test]
    async fn upload_402_bleibt_fehler_der_anbindung() {
        let (wahl, _) = gateway(empfaenger(), vec![], 402).await;
        let f = zustellen(wahl, &[], None).await.unwrap_err();
        assert_eq!(
            f.fehler,
            Zustellfehler::Anbindung {
                pruefung_vorziehen: true
            }
        );
    }

    #[tokio::test]
    async fn upload_5xx_ist_voruebergehend_mit_gesendetem_text() {
        let (wahl, _) = gateway(empfaenger(), vec![], 502).await;
        let f = zustellen(wahl, &[], None).await.unwrap_err();
        assert_eq!(f.fehler, Zustellfehler::Voruebergehend { nicht_vor: None });
        assert_eq!(f.teile, vec![(0, "id00000000000000".into())]);
    }

    #[tokio::test]
    async fn abbruch_nach_dem_absenden_ist_ungewiss_und_teile_davor_bleiben() {
        // Ein Gateway, das pubkeys und den ersten send beantwortet und beim zweiten die
        // Verbindung ohne Antwort schließt.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let schluessel = krypto::hex_encode(&empfaenger());
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut sends = 0;
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut puffer = vec![0u8; 65536];
                let n = sock.read(&mut puffer).await.unwrap_or(0);
                let anfrage = String::from_utf8_lossy(&puffer[..n]).to_string();
                let rumpf = if anfrage.starts_with("GET /pubkeys") {
                    schluessel.clone()
                } else if anfrage.starts_with("POST /upload_blob") {
                    "00112233445566778899aabbccddeeff".to_string()
                } else {
                    sends += 1;
                    if sends == 2 {
                        drop(sock);
                        continue;
                    }
                    "id00000000000000".to_string()
                };
                let antwort = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{rumpf}",
                    rumpf.len()
                );
                let _ = sock.write_all(antwort.as_bytes()).await;
            }
        });
        let basis = format!("http://{addr}");
        let wahl: ZielWahl =
            Arc::new(move |_| Ziel::mit_client(basis.clone(), reqwest::Client::new()));
        let f = zustellen(wahl, &[], None).await.unwrap_err();
        assert_eq!(f.fehler, Zustellfehler::Ungewiss);
        assert_eq!(f.teile, vec![(0, "id00000000000000".into())]);
    }

    #[tokio::test]
    async fn anderer_kanal_wird_nicht_bedient() {
        let zugang = zugang();
        let auftrag = Versandauftrag {
            versand_id: "v1",
            kanal: KanalArt::Email,
            zugang: &zugang,
            adresse: ID,
            betreff: "",
            inhalt: "",
            anhaenge: &[],
            pdf: None,
            gesendet: &[],
            threema_schluessel: None,
        };
        assert!(ThreemaZusteller::produktiv()
            .zustellen(&auftrag)
            .await
            .is_err());
    }
}

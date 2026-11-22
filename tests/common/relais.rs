//! Ein Doppel des Push-Relais (LLH-2040) auf Loopback: nimmt `POST /v1/server` und
//! `POST /v1/senden` an, meldet jeden Versand und antwortet je Nachricht mit einem einstellbaren
//! Ergebnis. Geteilt von `tests/ios_push.rs` und `tests/instanz_hinweise.rs`.

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use lifeline_hub::ios_push::krypto::{entschluesseln, umschlag_lesen};
use lifeline_hub::ios_push::IosPush;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

pub struct RelaisDoppel {
    /// Basis-URL, `http://127.0.0.1:<port>`.
    pub basis: String,
    /// Je `POST /v1/senden` der Rumpf (`{ nachrichten: [...] }`).
    pub sendungen: mpsc::UnboundedReceiver<Value>,
    /// Ergebnis je Nachricht (`zugestellt`, `token_ungueltig`, …).
    pub ergebnis: Arc<Mutex<&'static str>>,
}

pub async fn relais_doppel() -> RelaisDoppel {
    let (tx, rx) = mpsc::unbounded_channel();
    let ergebnis: Arc<Mutex<&'static str>> = Arc::new(Mutex::new("zugestellt"));
    let e = ergebnis.clone();
    let app = axum::Router::new().fallback(move |req: Request<Body>| {
        let tx = tx.clone();
        let e = e.clone();
        async move {
            let pfad = req.uri().path().to_owned();
            let rumpf = to_bytes(req.into_body(), usize::MAX).await.unwrap();
            let rumpf: Value = serde_json::from_slice(&rumpf).unwrap_or(Value::Null);
            if pfad == "/v1/server" {
                return axum::Json(json!({ "server_id": "s1", "geheimnis": "g1" })).into_response();
            }
            let n = rumpf["nachrichten"].as_array().map_or(0, Vec::len);
            let wert = *e.lock().unwrap();
            let _ = tx.send(rumpf);
            (
                StatusCode::OK,
                axum::Json(json!({ "ergebnisse": vec![wert; n] })),
            )
                .into_response()
        }
    });
    let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = lauscher.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(lauscher, app).await.unwrap() });
    RelaisDoppel {
        basis: format!("http://{adresse}"),
        sendungen: rx,
        ergebnis,
    }
}

impl RelaisDoppel {
    pub fn ios_push(&self, pool: &sqlx::SqlitePool) -> IosPush {
        IosPush::einrichten_fuer_test(pool.clone(), self.basis.parse().unwrap()).unwrap()
    }

    /// Der nächste Aufruf von `/v1/senden`.
    pub async fn naechste(&mut self) -> Value {
        tokio::time::timeout(Duration::from_secs(10), self.sendungen.recv())
            .await
            .expect("Versand an das Relais innerhalb von 10 s")
            .unwrap()
    }

    /// Kein Aufruf von `/v1/senden` innerhalb einer halben Sekunde.
    pub async fn keine(&mut self) {
        let r = tokio::time::timeout(Duration::from_millis(500), self.sendungen.recv()).await;
        assert!(r.is_err(), "unerwarteter Versand: {r:?}");
    }
}

/// Entschlüsselt die Nutzlast einer Nachricht an das Relais mit dem Schlüssel des Geräts, wie die
/// Extension es tut; liefert die Kennung aus dem Umschlag und den Klartext als JSON.
pub fn oeffnen(nutzlast: &str, schluessel: &[u8; 32]) -> (String, Value) {
    let (kennung, nonce, chiffrat) = umschlag_lesen(nutzlast).expect("Umschlag lesbar");
    let klar = entschluesseln(schluessel, &kennung, &nonce, &chiffrat).expect("entschlüsselbar");
    let text = String::from_utf8(klar).expect("Klartext ist UTF-8");
    (
        kennung,
        serde_json::from_str(&text).expect("Klartext ist JSON"),
    )
}

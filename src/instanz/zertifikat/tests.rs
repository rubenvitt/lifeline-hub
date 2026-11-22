//! Der Verifier der Direktkopplung gegen eine echte TLS-Gegenstelle mit rcgen-Zertifikat
//! (design.md D3): passt, passt nicht, Erfassung, Plattform-Verifier lehnt ab.

use super::*;
use crate::instanz::identitaet::{tls_fingerabdruck, tls_fingerabdruck_pem};

/// Startet einen HTTPS-Server auf Loopback mit einem frischen rcgen-Zertifikat; liefert Adresse
/// und Fingerabdruck.
async fn gegenstelle() -> (String, String) {
    let (cert, key) = crate::tls::rcgen_pem(&["localhost".into(), "127.0.0.1".into()]).unwrap();
    let fp = tls_fingerabdruck_pem(cert.as_bytes()).unwrap();
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await
            .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
    tokio::spawn(async move {
        axum_server::from_tcp_rustls(listener, config)
            .unwrap()
            .serve(app.into_make_service())
            .await
            .unwrap();
    });
    (format!("https://{addr}"), fp)
}

#[tokio::test]
async fn beglaubigtes_zertifikat_verbindet() {
    let (adresse, fp) = gegenstelle().await;
    let resp = build_client(Some(fp.clone()))
        .unwrap()
        .get(format!("{adresse}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(gesehen(&resp).as_deref(), Some(fp.as_str()));
    assert_eq!(resp.text().await.unwrap(), "ok");
}

#[tokio::test]
async fn anderes_zertifikat_scheitert_vor_dem_senden() {
    let (adresse, _) = gegenstelle().await;
    let fremd = tls_fingerabdruck(b"ein anderes Zertifikat");
    let e = build_client(Some(fremd))
        .unwrap()
        .post(format!("{adresse}/"))
        .body("Nutzdaten")
        .send()
        .await
        .unwrap_err();
    assert!(is_passt_nicht(&e), "{e:?}");
}

#[tokio::test]
async fn erfassung_merkt_den_fingerabdruck() {
    let (adresse, fp) = gegenstelle().await;
    let resp = build_client(None)
        .unwrap()
        .get(format!("{adresse}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(gesehen(&resp), Some(fp));
}

#[tokio::test]
async fn plattform_verifier_lehnt_selbstsigniert_ab() {
    let (adresse, _) = gegenstelle().await;
    let e = crate::ausgehend::client_builder(crate::ausgehend::Zweck::Instanzkopplung)
        .build()
        .unwrap()
        .get(format!("{adresse}/"))
        .send()
        .await
        .unwrap_err();
    assert!(is_zertifikat_fehler(&e), "{e:?}");
    assert!(!is_passt_nicht(&e), "{e:?}");
}

#[test]
fn fingerabdruck_ist_sha256_hex() {
    assert_eq!(
        tls_fingerabdruck(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

/// Wie [`gegenstelle`], zählt aber jede HTTP-Anfrage, die ankommt (LLH-1872: der Erfasser darf
/// keine auslösen).
pub(crate) async fn gegenstelle_mit_zaehler() -> (
    String,
    String,
    std::sync::Arc<std::sync::atomic::AtomicUsize>,
) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let (cert, key) = crate::tls::rcgen_pem(&["localhost".into(), "127.0.0.1".into()]).unwrap();
    let fp = tls_fingerabdruck_pem(cert.as_bytes()).unwrap();
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await
            .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    let zaehler = Arc::new(AtomicUsize::new(0));
    let z = zaehler.clone();
    let app = axum::Router::new().fallback(move || {
        let z = z.clone();
        async move {
            z.fetch_add(1, Ordering::SeqCst);
            "ok"
        }
    });
    tokio::spawn(async move {
        axum_server::from_tcp_rustls(listener, config)
            .unwrap()
            .serve(app.into_make_service())
            .await
            .unwrap();
    });
    (format!("https://{addr}"), fp, zaehler)
}

fn client_mit(config: rustls::ClientConfig) -> reqwest::Client {
    reqwest::Client::builder()
        .tls_backend_preconfigured(config)
        .build()
        .unwrap()
}

#[tokio::test]
async fn tls_config_mit_passendem_fingerabdruck_verbindet() {
    let (adresse, fp, zaehler) = gegenstelle_mit_zaehler().await;
    let resp = client_mit(tls_config(Some(fp)).unwrap())
        .get(format!("{adresse}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.text().await.unwrap(), "ok");
    assert_eq!(zaehler.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn erfasser_liest_den_fingerabdruck_ohne_anfrage() {
    let (adresse, fp, zaehler) = gegenstelle_mit_zaehler().await;
    let erfasser = Arc::new(Erfasser::new());
    let e = client_mit(erfasser_config(erfasser.clone()).unwrap())
        .post(format!("{adresse}/"))
        .body("Nutzdaten")
        .send()
        .await
        .unwrap_err();
    assert!(format!("{e:?}").contains(ERFASST), "{e:?}");
    assert_eq!(erfasser.gesehen(), Some(fp));
    assert_eq!(zaehler.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn erfasser_ohne_tls_liefert_nichts() {
    let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = lauscher.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((sock, _)) = lauscher.accept().await {
            drop(sock);
        }
    });
    let erfasser = Arc::new(Erfasser::new());
    let e = client_mit(erfasser_config(erfasser.clone()).unwrap())
        .post(format!("https://{addr}/"))
        .send()
        .await;
    assert!(e.is_err());
    assert_eq!(erfasser.gesehen(), None);
}

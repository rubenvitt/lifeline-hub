//! HTTP-Aufrufe (Feature `http`): Einlösen und Prüfroute.

use super::*;

fn http_fehler(e: impl std::fmt::Display) -> Error {
    Error::Http(e.to_string())
}

/// Löst einen Code an `base_url` ein: erzeugt einen neuen Schlüssel, ruft
/// `POST /api/v1/zugang/redeem` und prüft die Antwort.
pub async fn redeem(
    client: &reqwest::Client,
    base_url: &str,
    code: &str,
) -> Result<Credentials, Error> {
    let key = generate_key();
    let (d, anfrage) = prepare_redeem(code, &key)?;
    let url = format!("{}/api/v1/zugang/redeem", base_url.trim_end_matches('/'));
    let antwort = client
        .post(url)
        .json(&anfrage)
        .send()
        .await
        .map_err(http_fehler)?;
    let status = antwort.status();
    if !status.is_success() {
        return Err(Error::Http(format!(
            "Einlösen abgelehnt ({status}): Code falsch, abgelaufen oder schon eingelöst"
        )));
    }
    let antwort: RedeemResponse = antwort.json().await.map_err(http_fehler)?;
    finish_redeem(&d, &key, base_url, &antwort)
}

/// Ruft `GET /api/v1/me` signiert auf, prüft die Antwortsignatur und liefert den Body.
pub async fn me(
    client: &reqwest::Client,
    cred: &Credentials,
    now: i64,
) -> Result<serde_json::Value, Error> {
    let pfad = "/api/v1/me";
    let jti = new_jti();
    let auth = cred.sign_request("GET", pfad, b"", now, &jti)?;
    let antwort = client
        .get(format!("{}{pfad}", cred.base_url))
        .header("Authorization", auth)
        .send()
        .await
        .map_err(http_fehler)?;
    let status = antwort.status().as_u16();
    let signatur = antwort
        .headers()
        .get(RESPONSE_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = antwort.bytes().await.map_err(http_fehler)?;
    if status != 200 {
        return Err(Error::Http(format!(
            "{pfad} antwortete {status}: {}",
            String::from_utf8_lossy(&body)
        )));
    }
    let signatur = signatur.ok_or(Error::InvalidResponse("Signatur fehlt"))?;
    cred.verify_response(&signatur, &jti, status, &body, now)?;
    serde_json::from_slice(&body).map_err(http_fehler)
}

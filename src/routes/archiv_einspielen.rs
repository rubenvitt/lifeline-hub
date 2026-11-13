//! Archivblock in der Verwaltung einspielen (LLH-1711, Change
//! `yftpw99d-archiv-einspielen-verwaltung`, design.md D1–D7).
//!
//! | Methode | Pfad | Zweck |
//! |---|---|---|
//! | GET  | `/api/admin/archiv/einspielen` | Steht das Einspielen hier zur Verfügung? |
//! | POST | `/api/admin/archiv/einspielen` | Schlüssel und Block hochladen, einspielen |
//!
//! Beide nur für den System-Admin; eingespielt wird immer in seine Org, und deren Name muss im
//! Archiv derselbe sein. Nicht im Archiv-Namensraum `/api/aufbewahrung`: der bleibt lesend (Spec
//! `aufbewahrung-archiv`), und das Einspielen ändert keinen archivierten Einsatz, es legt einen
//! neuen Spiegel an.
//!
//! **Der Schlüssel bleibt nur für den Aufruf:** Er und die Passphrase liegen in Puffern, die
//! beim Fallenlassen genullt werden, und gehen weder in die Datenbank noch auf die Platte noch
//! ins Log. Den verschlüsselten Block schreibt der Handler Stück für Stück in eine Datei neben
//! der Datenbank, die mit dem Aufruf wieder geht, auch wenn der Browser abbricht.

use crate::app::AppState;
use crate::auth::session::AdminUser;
use crate::backup::verschluesselung::Schluessel;
use crate::einsatz::archiv::einspielen::{self, Akteur, Ziel};
use crate::error::AppError;
use crate::extract::PeerIp;
use crate::transfer::ARCHIV_BLOCK_MAX;
use age::secrecy::{ExposeSecret, SecretBox, SecretString};
use axum::extract::multipart::{Field, MultipartError};
use axum::extract::{Multipart, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use utoipa::ToSchema;

/// Eine Identitätsdatei ist wenige hundert Bytes groß (Spiegel `ARCHIV_PRIVATSCHLUESSEL_MAX`).
pub const PRIVATSCHLUESSEL_MAX: usize = 64 * 1024;

/// Spiegel `ARCHIV_PASSPHRASE_MAX`.
pub const PASSPHRASE_MAX: usize = 1024;

/// Meldung, wenn der Block über [`ARCHIV_BLOCK_MAX`] liegt.
const ZU_GROSS: &str = "Der Archivblock ist größer als 256 MiB. Einen so großen Block spielt der \
                        Betrieb mit dem Befehl `lifeline-hub archiv einspielen` ein.";

/// Antwort von `GET /api/admin/archiv/einspielen`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArchivEinspielenVerfuegbarkeit {
    /// `false` an einer Instanz, bei der sich eine andere meldet (Hub): dort gehört kein privater
    /// Archiv-Schlüssel hin.
    pub verfuegbar: bool,
}

/// Was eingespielt wurde (`POST /api/admin/archiv/einspielen`).
#[derive(Debug, Serialize, ToSchema)]
pub struct ArchivEingespieltAnzeige {
    pub einsatz_id: i64,
    pub bezeichnung: String,
    pub einsatznummer: Option<String>,
    pub org_name: String,
    /// Bis wann der Einsatz hier bleibt (UTC); danach räumt der Purge-Lauf ihn ab.
    pub loeschen_at: String,
    /// Anhänge und Pläne, die mitkamen.
    pub inhalte: i64,
    /// Was nicht oder anders übernommen wurde, als Sätze wie beim Befehl.
    pub hinweise: Vec<String>,
    /// Endet eine Frist des Blocks vor den 7 Tagen: wann (UTC). Die Oberfläche zeigt ihn in der
    /// Anzeigezone; derselbe Zeitpunkt steht als Satz auch in `hinweise`.
    pub frist_endet_at: Option<String>,
}

/// Lehnt an einer erreichten Instanz ab (design.md D3), bevor ein Byte des Bodys gelesen ist.
async fn fordere_keinen_hub(state: &AppState) -> Result<(), AppError> {
    if crate::instanz::repo::wird_erreicht(&state.pool).await? {
        return Err(AppError::UnprocessableEntity(
            "An dieser Installation meldet sich eine andere Instanz: ein privater \
             Archiv-Schlüssel gehört nicht hierher. Den Block an einer Installation ohne solche \
             Kopplung einspielen."
                .into(),
        ));
    }
    Ok(())
}

/// GET /api/admin/archiv/einspielen — ob die Verwaltung hier einspielen kann.
pub async fn verfuegbarkeit(
    State(state): State<AppState>,
    AdminUser(_): AdminUser,
) -> Result<Json<ArchivEinspielenVerfuegbarkeit>, AppError> {
    Ok(Json(ArchivEinspielenVerfuegbarkeit {
        verfuegbar: !crate::instanz::repo::wird_erreicht(&state.pool).await?,
    }))
}

fn multipart_fehler(e: MultipartError) -> AppError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::PayloadTooLarge(ZU_GROSS.into())
    } else {
        AppError::Validation(format!("Upload nicht lesbar: {e}"))
    }
}

/// Liest ein kleines geheimes Feld in einen Puffer, der beim Fallenlassen genullt wird. Der
/// Puffer ist von Anfang an so groß wie erlaubt, damit kein Umzug eine ungenullte Kopie
/// zurücklässt.
async fn geheim_lesen(
    mut feld: Field<'_>,
    max: usize,
    was: &str,
) -> Result<SecretBox<Vec<u8>>, AppError> {
    let mut puffer = SecretBox::new(Box::new(Vec::with_capacity(max)));
    while let Some(stueck) = feld.chunk().await.map_err(multipart_fehler)? {
        if puffer.expose_secret().len() + stueck.len() > max {
            return Err(AppError::Validation(format!("{was} ist zu lang.")));
        }
        age::secrecy::ExposeSecretMut::expose_secret_mut(&mut puffer).extend_from_slice(&stueck);
    }
    Ok(puffer)
}

/// Die Passphrase als Geheimnis, ohne Zeilenende. Der Text geht genau einmal in einen Puffer
/// passender Größe, den `SecretString` übernimmt und beim Fallenlassen nullt; kein Umzug lässt
/// eine Kopie zurück.
fn passphrase_aus(roh: &SecretBox<Vec<u8>>) -> Result<SecretString, AppError> {
    let text = std::str::from_utf8(roh.expose_secret())
        .map_err(|_| AppError::Validation("Die Passphrase ist kein gültiger Text.".into()))?
        .trim_end_matches(['\r', '\n']);
    let mut genau = String::with_capacity(text.len());
    genau.push_str(text);
    Ok(SecretString::from(genau))
}

/// POST /api/admin/archiv/einspielen — Multipart mit `schluessel` (Text) oder `schluessel_datei`
/// (Datei), optional `passphrase`, und zuletzt `block` (design.md D4). Der Schlüssel kommt vor
/// dem Block, damit ein unbrauchbarer Aufruf endet, bevor 256 MiB auf die Platte gehen.
pub async fn einspielen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PeerIp(peer_ip): PeerIp,
    mut multipart: Multipart,
) -> Result<Json<ArchivEingespieltAnzeige>, AppError> {
    fordere_keinen_hub(&state).await?;

    let mut schluessel: Option<SecretBox<Vec<u8>>> = None;
    let mut passphrase: Option<SecretBox<Vec<u8>>> = None;
    let mut ablage = None;
    while let Some(mut feld) = multipart.next_field().await.map_err(multipart_fehler)? {
        if ablage.is_some() {
            return Err(AppError::Validation(
                "Nach dem Archivblock kommt kein Feld mehr.".into(),
            ));
        }
        let name = feld.name().unwrap_or_default().to_owned();
        match name.as_str() {
            "schluessel" | "schluessel_datei" => {
                if schluessel.is_some() {
                    return Err(AppError::Validation(
                        "Den Schlüssel als Datei oder als Text angeben, nicht beides.".into(),
                    ));
                }
                schluessel = Some(geheim_lesen(feld, PRIVATSCHLUESSEL_MAX, "Der Schlüssel").await?);
            }
            "passphrase" => {
                if passphrase.is_some() {
                    return Err(AppError::Validation(
                        "Genau eine Passphrase angeben.".into(),
                    ));
                }
                passphrase = Some(geheim_lesen(feld, PASSPHRASE_MAX, "Die Passphrase").await?);
            }
            "block" => {
                if schluessel.is_none() {
                    return Err(AppError::Validation(
                        "Erst den Schlüssel, dann den Archivblock senden.".into(),
                    ));
                }
                let (datei, handle) = einspielen::ablage(&state.pool).await?;
                let mut ziel = tokio::fs::File::from_std(handle);
                let mut groesse = 0usize;
                while let Some(stueck) = feld.chunk().await.map_err(multipart_fehler)? {
                    groesse += stueck.len();
                    if groesse > ARCHIV_BLOCK_MAX {
                        return Err(AppError::PayloadTooLarge(ZU_GROSS.into()));
                    }
                    ziel.write_all(&stueck)
                        .await
                        .map_err(|e| AppError::Internal(format!("Archivblock ablegen: {e}")))?;
                }
                ziel.flush()
                    .await
                    .map_err(|e| AppError::Internal(format!("Archivblock ablegen: {e}")))?;
                if groesse == 0 {
                    return Err(AppError::Validation("Der Archivblock ist leer.".into()));
                }
                ablage = Some(datei);
            }
            anderes => {
                return Err(AppError::Validation(format!(
                    "Unbekanntes Feld „{anderes}“; erwartet sind schluessel oder \
                     schluessel_datei, passphrase und block."
                )));
            }
        }
    }
    let schluessel = schluessel.ok_or_else(|| {
        AppError::Validation("Den Schlüssel als Datei oder als Text angeben.".into())
    })?;
    let ablage = ablage.ok_or_else(|| AppError::Validation("Den Archivblock angeben.".into()))?;

    let passphrase = passphrase.as_ref().map(passphrase_aus).transpose()?;
    // scrypt einer geschützten Schlüsseldatei kostet Sekunden: nicht auf dem Async-Worker.
    let schluessel = tokio::task::spawn_blocking(move || {
        Schluessel::laden_geschuetzt(schluessel.expose_secret(), passphrase)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Archiv-Schlüssel laden: {e}")))??;

    let e = einspielen::einspielen(
        &state.pool,
        ablage.pfad(),
        schluessel,
        Ziel::EigeneOrg(benutzer.org_id),
        Akteur::Person {
            benutzer: &benutzer,
            peer_ip,
        },
        chrono::Utc::now(),
    )
    .await?;
    drop(ablage);
    // Offene Einsatzlisten der Org zeigen den neuen Einsatz ohne Neuladen (Org-Ereignis
    // `einsatzliste`, LFH-734); der Befehl läuft als eigener Prozess und kann das nicht.
    crate::live::org::einsatzliste_melden(&state.pool, &state.live, e.einsatz_id, &[]).await;
    // Die Spur steht in der Transaktion; die Log-Zeile kommt nach dem Commit (admin_audit).
    tracing::info!(
        aktion = "archiv_eingespielt",
        akteur_id = benutzer.id,
        einsatz_id = e.einsatz_id,
        "Archivblock über die Verwaltung eingespielt"
    );
    Ok(Json(ArchivEingespieltAnzeige {
        einsatz_id: e.einsatz_id,
        bezeichnung: e.bezeichnung,
        einsatznummer: e.einsatznummer,
        org_name: e.org_name,
        loeschen_at: e.loeschen_at,
        inhalte: i64::try_from(e.inhalte).unwrap_or(i64::MAX),
        hinweise: e.hinweise,
        frist_endet_at: e.frist_endet_at,
    }))
}

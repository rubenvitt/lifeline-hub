use crate::dev::seed::SEED_BENUTZER;
use axum::Json;
use serde::Serialize;

/// Öffentliche Dev-Benutzer-Darstellung für den Login-Picker. Bewusst NUR
/// Anzeige-Felder plus das bekannte Klartext-Dev-Passwort — `system_rolle`/
/// `org_rolle` bleiben intern und werden NICHT serialisiert.
#[derive(Debug, Serialize)]
pub struct DevBenutzerResponse {
    pub benutzername: &'static str,
    pub passwort: &'static str,
    pub anzeigename: &'static str,
    /// Menschenlesbares Rollen-Label (z.B. "Admin").
    pub rolle: &'static str,
}

/// GET /api/dev/users — nur mit Feature `dev-seeds` registriert.
/// Liefert die **aktiven** Seed-Benutzer mit Klartext-Dev-Passwort. Quelle ist
/// dieselbe Konstante wie beim Seeding (`SEED_BENUTZER`), kein zweiter Pflegeort.
/// Keine Authentifizierung (existiert nur im Dev-Build).
pub async fn users() -> Json<Vec<DevBenutzerResponse>> {
    let liste = SEED_BENUTZER
        .iter()
        .filter(|b| b.aktiv)
        .map(|b| DevBenutzerResponse {
            benutzername: b.benutzername,
            passwort: b.passwort,
            anzeigename: b.anzeigename,
            rolle: b.rolle_anzeige,
        })
        .collect();
    Json(liste)
}

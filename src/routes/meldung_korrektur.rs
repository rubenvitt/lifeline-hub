//! `PATCH /api/einsaetze/{id}/meldungen/{mid}` — eine Meldung nachträglich korrigieren (LLH-1066,
//! Spec `meldungseingang`). Eigene Datei neben `routes/meldung.rs`: die Prüfung der Felder steht
//! hier, das Schreiben in [`crate::meldung::korrektur`].
use crate::app::AppState;
use crate::einsatz::kontext::EinsatzSchreibzugriff;
use crate::einsatz::modul::Meldungen;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::kommunikation::{Prioritaet, Richtung};
use crate::meldung::korrektur::{self, Aenderung};
use crate::meldung::{repo, MeldungAnzeige, Meldungsart};
use crate::routes::support::{deserialize_optional_field, optional_max_tri, parse_enum};
use crate::zeit::jetzt;
use axum::extract::State;
use axum::Json;
use serde::Deserialize;

/// Body der Korrektur: jedes Feld optional, ein fehlendes bleibt. Ein unbekanntes Feld ist 400
/// (`deny_unknown_fields`). Die Felder des Eingangs sind bekannt, damit ihr Änderungsversuch als
/// Zusammenhang (422) und nicht als Tippfehler (400) antwortet.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeldungAenderung {
    pub meldungsart: Option<String>,
    pub prioritaet: Option<String>,
    pub richtung: Option<String>,
    /// Von-Bezug: steht eines der beiden Felder, ersetzt das Paar den Bezug (das fehlende zählt
    /// als `null`); `null` löst ihn.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub einheit_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub abschnitt_id: Option<Option<i64>>,
    /// Empfänger als Freitext; `null` oder leer leert.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub empfaenger: Option<Option<String>>,
    /// `true` übernimmt in die Lage, `false` nimmt aus der Lage.
    pub lagerelevant: Option<bool>,
    /// Lage-Text; `null`, leer oder gleich dem Wortlaut: der Wortlaut gilt.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lage_text: Option<Option<String>>,
    /// Verortung, nur gemeinsam; beide `null` entfernt sie.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub lon: Option<Option<f64>>,
    // Der Eingang bleibt, wie die Meldung einging (D2): jeder Wert, auch `null`, ist 422.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub inhalt: Option<Option<serde_json::Value>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub absender: Option<Option<serde_json::Value>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub meldeweg: Option<Option<serde_json::Value>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub ereigniszeit: Option<Option<serde_json::Value>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub eingang_at: Option<Option<serde_json::Value>>,
}

impl MeldungAenderung {
    /// Die Felder für sich (400), dann der Eingang (422). Der Zusammenhang mit dem Stand der
    /// Meldung (Lage, Sofort, Bezug im Einsatz) folgt in der Transaktion.
    fn pruefen(self) -> Result<Aenderung, AppError> {
        let meldungsart = self
            .meldungsart
            .as_deref()
            .map(|a| parse_enum(Meldungsart::parse, a.trim(), "Ungültige Meldungsart"))
            .transpose()?;
        let prioritaet = self
            .prioritaet
            .as_deref()
            .map(|p| parse_enum(Prioritaet::parse, p.trim(), "Ungültige Priorität"))
            .transpose()?;
        let richtung = self
            .richtung
            .as_deref()
            .map(|r| parse_enum(Richtung::parse, r.trim(), "Ungültige Richtung"))
            .transpose()?;
        // Empfänger landet wie beim Erfassen im ETB-Eintrag der Meldung: dessen Grenze.
        let empfaenger = optional_max_tri(self.empfaenger, "Empfänger", crate::etb::PARTEI_MAX)?;
        let lage_text = optional_max_tri(self.lage_text, "Lage-Text", crate::etb::INHALT_MAX)?;

        let eingang = [
            (self.inhalt.is_some(), "Der Wortlaut"),
            (self.absender.is_some(), "Der Absender"),
            (self.meldeweg.is_some(), "Der Meldeweg"),
            (self.ereigniszeit.is_some(), "Die Ereigniszeit"),
            (self.eingang_at.is_some(), "Der Eingang"),
        ];
        if let Some((_, feld)) = eingang.iter().find(|(gesetzt, _)| *gesetzt) {
            return Err(AppError::UnprocessableEntity(format!(
                "{feld} bleibt, wie die Meldung einging"
            )));
        }

        let geo = match (self.lat, self.lon) {
            (None, None) => None,
            (lat, lon) => {
                let (lat, lon) = (lat.flatten(), lon.flatten());
                crate::routes::support::pruefe_koordinate(lat, lon, "lat", "lon")?;
                Some(lat.zip(lon))
            }
        };
        let bezug = (self.einheit_id.is_some() || self.abschnitt_id.is_some())
            .then(|| (self.einheit_id.flatten(), self.abschnitt_id.flatten()));
        Ok(Aenderung {
            meldungsart,
            prioritaet,
            richtung,
            bezug,
            empfaenger,
            lagerelevant: self.lagerelevant,
            lage_text,
            geo,
        })
    }
}

/// PATCH /api/einsaetze/{id}/meldungen/{mid} — Art, Priorität, Richtung, Von-Bezug, Empfänger
/// und Lage-Angaben korrigieren (Schreibrecht, Freigabe Meldungen, aktiver Einsatz). Fremde
/// Meldung 404. Gekoppelte Geräte erreichen die Route nicht (keine Routenliste, D10). Antwortet
/// mit dem Stand; ohne wirksame Änderung ohne ETB-Eintrag und ohne Live-Ereignis.
pub async fn korrigieren(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Meldungen>,
    PfadParam((einsatz_id, meldung_id)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<MeldungAenderung>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    let aenderung = req.pruefen()?;
    let jetzt = jetzt();
    let vorher =
        repo::laden_im_einsatz(&state.pool, ctx.einsatz.id, meldung_id, None, &jetzt).await?;
    let ergebnis = korrektur::korrigieren(
        &state.pool,
        ctx.einsatz.id,
        meldung_id,
        ctx.benutzer.id,
        &jetzt,
        &aenderung,
    )
    .await?;
    let m = repo::laden(&state.pool, meldung_id, &jetzt).await?;
    if let Some(etb_id) = ergebnis.etb_id {
        state.live.publiziere(einsatz_id, etb_id);
        crate::meldung::sse(&state, einsatz_id);
    }
    // Kommt die Meldung neu in die Lage, meldet das S2 und der Einsatzleitung wie die Übergabe
    // (LLH-1062); verlässt sie die Lage, ist ihr Übernahme-Hinweis erledigt.
    if m.lagerelevant && !vorher.lagerelevant {
        crate::meldung::benachrichtigung::uebernommen(
            &state.pool,
            &state.live,
            &vorher,
            ctx.benutzer.id,
        )
        .await;
    } else if vorher.lagerelevant && !m.lagerelevant {
        crate::meldung::benachrichtigung::aus_der_lage(&state.pool, &state.live, &m).await;
    }
    Ok(Json(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(json: serde_json::Value) -> Result<Aenderung, AppError> {
        serde_json::from_value::<MeldungAenderung>(json)
            .expect("gültiger Body")
            .pruefen()
    }

    #[test]
    fn eingang_ist_422_auch_als_null() {
        for feld in [
            "inhalt",
            "absender",
            "meldeweg",
            "ereigniszeit",
            "eingang_at",
        ] {
            let r = body(serde_json::json!({ feld: null }));
            assert!(
                matches!(r, Err(AppError::UnprocessableEntity(_))),
                "{feld}: {r:?}"
            );
        }
    }

    #[test]
    fn unbekanntes_feld_wird_nicht_gelesen() {
        assert!(serde_json::from_value::<MeldungAenderung>(serde_json::json!({ "x": 1 })).is_err());
    }

    #[test]
    fn bezug_und_verortung_als_paar() {
        let a = body(serde_json::json!({ "einheit_id": 3 })).unwrap();
        assert_eq!(a.bezug, Some((Some(3), None)));
        let a = body(serde_json::json!({ "abschnitt_id": null })).unwrap();
        assert_eq!(a.bezug, Some((None, None)));
        assert_eq!(body(serde_json::json!({})).unwrap().bezug, None);
        let a = body(serde_json::json!({ "lat": null, "lon": null })).unwrap();
        assert_eq!(a.geo, Some(None));
        assert!(matches!(
            body(serde_json::json!({ "lat": 52.0 })),
            Err(AppError::UnprocessableEntity(_))
        ));
    }

    #[test]
    fn leere_texte_leeren() {
        let a = body(serde_json::json!({ "empfaenger": "  ", "lage_text": null })).unwrap();
        assert_eq!(a.empfaenger, Some(None));
        assert_eq!(a.lage_text, Some(None));
    }
}

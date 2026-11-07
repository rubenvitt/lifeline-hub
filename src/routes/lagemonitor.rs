//! Lagebild des Lagemonitors (LFH-892, Subtask LFH-1026; Spec `lagemonitor`, design.md D6).
//!
//! Verdichtete Zahlen statt der Listen des Lage-Dashboards: Kopfzahlen der Betroffenen, Belegung
//! je UHS als Zahl, Kräftesummen und der Datenstand. **Keine Namen, keine Personenkennungen** —
//! auch nicht in der Antwort; gepinnt von `lagemonitor_antwort_traegt_keine_personen` in
//! `tests/geraet_kopplung.rs`. Personen-Ereignisse erreichen den Monitor im Live-Kanal nicht
//! (`LiveEvent::Person` gehört nur `personen`); der Client holt die Zahlen deshalb zusätzlich in
//! festem Takt (`geraet/LagemonitorPage.tsx`).
//!
//! Für die Kachel „Lagekarte“ liefert die Antwort auch die Gefahrenzonen und die Flächen der
//! Einsatzabschnitte (LLH-1153), damit der Monitor bei diesem einen Abruf bleibt: `/zonen` trägt
//! Notizen und Bezirke, `/abschnitte` den Leiternamen. Zonen kommen nur als Typ und Geometrie,
//! Abschnitte nur mit Bezeichnung und Fläche.
//!
//! Die offenen Sofortmeldungen kommen nur als Zahl (Change `kcjecn9e-benachrichtigungskonzept`,
//! D12): kein Text, kein Absender, kein Empfänger; gepinnt von
//! `lagemonitor_zaehlt_offene_sofortmeldungen_ohne_meldungsfelder`. Den Anstieg erkennt der
//! Client selbst.

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::zaehler::{count_kraefte, KraefteZaehler, KraftMerkmale};
use crate::error::AppError;
use crate::geraet::Funktionsansicht;
use crate::lage_zone::LageZoneTyp;
use crate::person::{
    versorgung_von, zaehle_lage_sichtung, PersonStatus, Sichtungskategorie, TransportDurch,
    VerbleibArt, VerbleibStatus,
};
use crate::staerke::{Staerke, StaerkePosition};
use crate::uhs::{UhsStatus, UhsTyp};
use axum::extract::State;
use axum::Json;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Betroffene in Zahlen, wie die Kopfzahl des Lage-Dashboards (`lageVerdichtung.ts`).
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct LagemonitorBetroffene {
    pub gesamt: i64,
    /// SK I bis SK IV.
    pub patienten: i64,
    pub sk1: i64,
    pub sk2: i64,
    pub sk3: i64,
    pub sk4: i64,
    pub tot: i64,
    pub unverletzt: i64,
    /// Noch nicht gesichtet.
    pub ohne: i64,
    pub vermisst: i64,
    /// Abgeschlossene Patienten (LLH-1332): in `gesamt` enthalten, in keiner Sichtungszahl.
    pub abgeschlossen: i64,
}

/// Kräfte in Zahlen: Einheiten, disponiertes Personal und seine Stärke.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorKraefte {
    pub einheiten: i64,
    pub personal: i64,
    pub staerke: Staerke,
}

/// Eine nicht aufgelöste UHS mit ihrer Belegung als Zahl.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorUhs {
    pub id: i64,
    pub bezeichnung: String,
    pub typ: UhsTyp,
    pub status: UhsStatus,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Personen, die gerade in dieser UHS liegen.
    pub belegt: i64,
    /// Plätze ohne Wartebereich.
    pub plaetze: i64,
    /// Gesamtstärke der zugeordneten Kräfte (LFH-1045), nur als Zahl; wie die Stärke der UHS
    /// zählt jede aktive Kraft, auch ohne Position (LLH-1234).
    pub kraefte: i64,
}

/// Eine Gefahrenzone für die Monitorkarte (Gefahrengebiet, Absperrung, Sperrgebiet), einsatzweit
/// und gleich welcher Kartenansicht. Ohne Beschriftung und Notiz: beides ist Freitext.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorZone {
    pub id: i64,
    pub typ: LageZoneTyp,
    /// GeoJSON-Geometrie als String, wie in der Zonenliste.
    pub geometrie: String,
}

/// Die Fläche eines Einsatzabschnitts für die Monitorkarte, ohne Leiter und Freitexte.
#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorAbschnitt {
    pub id: i64,
    pub bezeichnung: String,
    /// Kurzbezeichnung im Einsatz (z. B. „EA-N“), falls gesetzt.
    pub kurzbezeichnung: Option<String>,
    /// GeoJSON-Polygon als String.
    pub flaeche_geojson: String,
}

/// Hilfeleistungen in Zahlen für die Reihe „Sanitätsdienst“ (LLH-1574, design.md D6): dieselben
/// Regeln wie die Kennzahlen des Lagebilds (`pages/lage-dashboard/lagebild.ts`). Nur Zahlen.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct LagemonitorSanitaetsdienst {
    /// Kontakte: alle Personen außer Vermissten, Abgeschlossene eingeschlossen
    /// (`anlassbild().gesamt` im Client).
    pub kontakte: i64,
    /// Kontakte, die in den letzten 60 Minuten erfasst wurden.
    pub kontakte_letzte_stunde: i64,
    /// Angetroffene, die noch nicht abgeschlossen sind (offen oder unterwegs).
    pub in_versorgung: i64,
    /// Transporte wie im Einsatzbericht (`transportBilanz().transportiert`): Verbleib Transport,
    /// nicht nur angemeldet.
    pub transporte: i64,
}

/// Eine Person für [`zaehle_sanitaetsdienst`]: Status, Verbleib-Art und -Status, Versorgung und
/// ob sie in der letzten Stunde erfasst wurde.
pub struct SanitaetsdienstZeile {
    pub status: PersonStatus,
    pub art: Option<VerbleibArt>,
    pub verbleib_status: Option<VerbleibStatus>,
    pub versorgung: crate::person::Versorgung,
    pub letzte_stunde: bool,
}

/// Die Zählung der Reihe „Sanitätsdienst“ (LLH-1574). Rein; stornierte Personen hat der Aufrufer
/// schon weggelassen.
pub fn zaehle_sanitaetsdienst(
    zeilen: impl IntoIterator<Item = SanitaetsdienstZeile>,
) -> LagemonitorSanitaetsdienst {
    let mut z = LagemonitorSanitaetsdienst::default();
    for p in zeilen {
        if p.status == PersonStatus::Vermisst {
            continue;
        }
        z.kontakte += 1;
        if p.letzte_stunde {
            z.kontakte_letzte_stunde += 1;
        }
        let angetroffen = matches!(
            p.status,
            PersonStatus::Erfasst | PersonStatus::Betroffen | PersonStatus::Verstorben
        );
        if !angetroffen {
            continue;
        }
        if p.versorgung != crate::person::Versorgung::Abgeschlossen {
            z.in_versorgung += 1;
        }
        if p.art == Some(VerbleibArt::Transport)
            && p.verbleib_status != Some(VerbleibStatus::Angemeldet)
        {
            z.transporte += 1;
        }
    }
    z
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LagemonitorAnzeige {
    /// Zeitpunkt der Berechnung (UTC, SQLite-Format).
    pub stand_at: String,
    pub betroffene: LagemonitorBetroffene,
    pub kraefte: LagemonitorKraefte,
    pub uhs: Vec<LagemonitorUhs>,
    /// Gefahrenzonen; Evakuierungsbezirke und freie Skizzen fehlen.
    pub zonen: Vec<LagemonitorZone>,
    /// Einsatzabschnitte mit gezeichneter Fläche.
    pub abschnitte: Vec<LagemonitorAbschnitt>,
    /// Sofortmeldungen, die noch unbestätigt und nicht erledigt sind; nur die Zahl.
    pub sofortmeldungen_offen: i64,
    /// Die nächsten anstehenden Programmpunkte der Veranstaltung (LLH-1570, höchstens
    /// [`crate::programmpunkt::MONITOR_ANZAHL`]), aufsteigend; verstrichene fehlen.
    pub programm: Vec<crate::programmpunkt::Programmpunkt>,
    /// Hilfeleistungen in Zahlen, nur wenn am Einsatz die Reihe „Sanitätsdienst“ gewählt ist
    /// (LLH-1574); dann zeigt der Monitor sie statt der Sichtungszeile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sanitaetsdienst: Option<LagemonitorSanitaetsdienst>,
}

/// GET /api/einsaetze/{id}/lagemonitor — nur für einen gekoppelten Lagemonitor; eine Person und
/// jede andere Ansicht bekommen 403 (die Zahlen umgingen sonst das Modul `personen`).
pub async fn lagebild(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<LagemonitorAnzeige>, AppError> {
    if ctx.geraet.as_ref().map(|g| g.ansicht) != Some(Funktionsansicht::Lagemonitor) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(verdichte(&state.pool, ctx.einsatz.id).await?))
}

/// Die Verdichtung des Lagebilds. Sie trägt den gekoppelten Lagemonitor und die Schnittstelle für
/// externe Anzeigen (`routes::lagemonitor_v1`, LLH-1484), damit beide dieselben Zahlen zeigen.
/// Prüft keine Rechte: das tun die Aufrufer.
pub async fn verdichte(pool: &SqlitePool, einsatz_id: i64) -> Result<LagemonitorAnzeige, AppError> {
    let mut betroffene = LagemonitorBetroffene::default();
    // Sichtung und Versorgungszustand je Person; die Zählung ist die gemeinsame Regel
    // (`person::zaehle_lage_sichtung`, Fixture `regeln.json` Abschnitt `versorgung`).
    // Die letzte Stunde zählt gegen die Uhr der Datenbank, wie `erfasst_at` geschrieben wird.
    type Zeile = (
        String,
        Option<Sichtungskategorie>,
        Option<VerbleibArt>,
        Option<VerbleibStatus>,
        Option<TransportDurch>,
        bool,
    );
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT status, aktuelle_sichtung, aktuelle_verbleib_art, aktueller_verbleib_status, \
                aktueller_transport_durch, erfasst_at >= datetime('now', '-1 hour') \
         FROM einsatz_person WHERE einsatz_id = ? AND storniert_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    betroffene.gesamt = zeilen.len() as i64;
    let mut lage_zeilen = Vec::with_capacity(zeilen.len());
    let mut san_zeilen = Vec::with_capacity(zeilen.len());
    for (person, sk, art, status, durch, letzte_stunde) in zeilen {
        let person = PersonStatus::try_from(person).map_err(AppError::Internal)?;
        let versorgung = versorgung_von(person, art, status, durch);
        lage_zeilen.push((sk, versorgung));
        san_zeilen.push(SanitaetsdienstZeile {
            status: person,
            art,
            verbleib_status: status,
            versorgung,
            letzte_stunde,
        });
    }
    let sanitaetsdienst_gewaehlt: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz_lagekennzahl_wahl \
                        WHERE einsatz_id = ? AND kennzahl = 'sanitaetsdienst')",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    let sanitaetsdienst = sanitaetsdienst_gewaehlt.then(|| zaehle_sanitaetsdienst(san_zeilen));
    let lage = zaehle_lage_sichtung(lage_zeilen);
    betroffene.sk1 = lage.sk1;
    betroffene.sk2 = lage.sk2;
    betroffene.sk3 = lage.sk3;
    betroffene.sk4 = lage.sk4;
    betroffene.tot = lage.tot;
    betroffene.unverletzt = lage.unverletzt;
    betroffene.ohne = lage.ohne;
    betroffene.abgeschlossen = lage.abgeschlossen;
    betroffene.patienten = lage.patienten();
    betroffene.vermisst = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_person \
         WHERE einsatz_id = ? AND storniert_at IS NULL AND status = 'vermisst'",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;

    let einheiten: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;
    // Wie die Verdichtung der Kräfte-Seiten (`kraefte/kraeftebild.ts`, `verdichte`): jedes
    // aktive Personal, auch ohne Einheit; entlassene und stornierte zählen nicht (LLH-1079,
    // Regel `count_kraefte`, Fixture `regeln.json` Abschnitt `kraefte`).
    let zeilen: Vec<(Option<String>, bool)> = sqlx::query_as(
        "SELECT COALESCE(ep.staerke_position, p.staerke_position), ep.beendet_at IS NOT NULL \
         FROM einsatz_personal ep LEFT JOIN personal p ON p.id = ep.personal_id \
         WHERE ep.einsatz_id = ? AND ep.beendet_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let merkmale: Vec<KraftMerkmale> = zeilen
        .into_iter()
        .map(|(position, beendet)| KraftMerkmale {
            staerke_position: position.as_deref().and_then(StaerkePosition::parse),
            beendet,
        })
        .collect();
    let KraefteZaehler { personal, staerke } = count_kraefte(&merkmale);

    let zeilen: Vec<(
        i64,
        String,
        String,
        String,
        Option<f64>,
        Option<f64>,
        i64,
        i64,
        i64,
    )> = sqlx::query_as(
        "SELECT u.id, u.bezeichnung, u.typ, u.status, u.lat, u.lon, \
               (SELECT COUNT(*) FROM einsatz_person p \
                 WHERE p.aktuelle_uhs_id = u.id AND p.storniert_at IS NULL), \
               (SELECT COUNT(*) FROM uhs_platz pl \
                 WHERE pl.uhs_id = u.id AND pl.storniert_at IS NULL \
                   AND pl.typ <> 'wartebereich'), \
               (SELECT COUNT(*) FROM einsatz_personal ep \
                 WHERE ep.uhs_id = u.id AND ep.beendet_at IS NULL) \
             FROM uhs u \
             WHERE u.einsatz_id = ? AND u.storniert_at IS NULL AND u.status <> 'aufgeloest' \
             ORDER BY u.bezeichnung COLLATE NOCASE, u.id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut uhs = Vec::with_capacity(zeilen.len());
    for (id, bezeichnung, typ, status, lat, lon, belegt, plaetze, kraefte) in zeilen {
        uhs.push(LagemonitorUhs {
            id,
            bezeichnung,
            typ: UhsTyp::parse(&typ).ok_or_else(|| AppError::Internal(format!("UHS-Typ {typ}")))?,
            status: UhsStatus::parse(&status)
                .ok_or_else(|| AppError::Internal(format!("UHS-Status {status}")))?,
            lat,
            lon,
            belegt,
            plaetze,
            kraefte,
        });
    }

    // Gefahrenzonen wie beim Abschnittsgerät (`routes/lage_zone.rs`, `liste`): einsatzweit, ohne
    // Bezirke und Skizzen.
    let zonen_roh: Vec<(i64, String, String)> =
        sqlx::query_as("SELECT id, typ, geometrie FROM lage_zone WHERE einsatz_id = ? ORDER BY id")
            .bind(einsatz_id)
            .fetch_all(pool)
            .await?;
    let mut zonen = Vec::new();
    for (id, typ, geometrie) in zonen_roh {
        let typ = LageZoneTyp::parse(&typ)
            .ok_or_else(|| AppError::Internal(format!("Zonentyp {typ}")))?;
        if typ.ist_gefahrenzone() {
            zonen.push(LagemonitorZone { id, typ, geometrie });
        }
    }

    let abschnitte = sqlx::query_as::<_, (i64, String, Option<String>, String)>(
        "SELECT id, name, kurzbezeichnung, flaeche_geojson FROM einsatzabschnitt \
         WHERE einsatz_id = ? AND flaeche_geojson IS NOT NULL ORDER BY sortier, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(
        |(id, bezeichnung, kurzbezeichnung, flaeche_geojson)| LagemonitorAbschnitt {
            id,
            bezeichnung,
            kurzbezeichnung,
            flaeche_geojson,
        },
    )
    .collect();

    let sofortmeldungen_offen = crate::meldung::repo::count_sofort_offen(pool, einsatz_id).await?;

    let stand_at = crate::zeit::jetzt();
    let programm = crate::programmpunkt::repo::anstehende(
        pool,
        einsatz_id,
        &stand_at,
        crate::programmpunkt::MONITOR_ANZAHL,
    )
    .await?;

    Ok(LagemonitorAnzeige {
        stand_at,
        betroffene,
        kraefte: LagemonitorKraefte {
            einheiten,
            personal,
            staerke,
        },
        uhs,
        zonen,
        abschnitte,
        sofortmeldungen_offen,
        programm,
        sanitaetsdienst,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::person::Versorgung;

    fn zeile(
        status: PersonStatus,
        art: Option<VerbleibArt>,
        verbleib_status: Option<VerbleibStatus>,
        letzte_stunde: bool,
    ) -> SanitaetsdienstZeile {
        SanitaetsdienstZeile {
            status,
            art,
            verbleib_status,
            versorgung: versorgung_von(status, art, verbleib_status, None),
            letzte_stunde,
        }
    }

    #[test]
    fn sanitaetsdienst_zaehlt_wie_das_lagebild() {
        use PersonStatus::*;
        let z = zaehle_sanitaetsdienst([
            // offen, frisch
            zeile(Betroffen, None, None, true),
            // entlassen: Kontakt, aber nicht mehr in Versorgung
            zeile(Erfasst, Some(VerbleibArt::Entlassung), None, false),
            // Transport übergeben: Transport, abgeschlossen
            zeile(
                Betroffen,
                Some(VerbleibArt::Transport),
                Some(VerbleibStatus::Uebergeben),
                true,
            ),
            // nur angemeldet: kein Transport, noch in Versorgung
            zeile(
                Betroffen,
                Some(VerbleibArt::Transport),
                Some(VerbleibStatus::Angemeldet),
                false,
            ),
            // vermisst: kein Kontakt
            zeile(Vermisst, None, None, true),
            // abgemeldet: Kontakt, nicht angetroffen
            zeile(Abgemeldet, None, None, false),
        ]);
        assert_eq!(
            z,
            LagemonitorSanitaetsdienst {
                kontakte: 5,
                kontakte_letzte_stunde: 2,
                in_versorgung: 2,
                transporte: 1,
            }
        );
        assert_eq!(
            zeile(Betroffen, None, None, false).versorgung,
            Versorgung::Offen
        );
    }
}

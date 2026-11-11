//! Bedienung der Führung (design.md D5, D6, D8, D9, D10): Übergabe, Abgabecode, Anfrage,
//! Notübernahme, Bestätigen und Widersprechen. Die Routen (`routes::fuehrung`) prüfen Rolle und
//! Schalter; hier liegen Regeln und Transaktion. Jede Änderung stößt die nächste Meldung an.

use super::austausch::AkteMeldung;
use super::erklaerung::{self, FuehrungBeweis, NotuebernahmeErklaerung, TYP_NOTUEBERNAHME};
use super::repo::{self, AkteZeile, FuehrungGegenueber, FuehrungVerlaufEintrag, Ich, VerlaufNeu};
use super::{Epoche, FuehrungWechselArt, GRUND_MAX};
use crate::error::AppError;
use crate::instanz::{code, InstanzKopplungRichtung};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Stößt die nächste Meldung jeder meldenden Kopplung an (der Hintergrund-Task nimmt sie beim
/// nächsten Takt). Die erreichte Seite wartet auf die Meldung des Gegenübers.
pub async fn anstossen(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE instanz_kopplung SET naechste_meldung_at = NULL \
         WHERE richtung = 'meldet_sich' AND zustand = 'aktiv'",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Prüft und kürzt den Grund (Pflicht, höchstens [`GRUND_MAX`] Zeichen).
pub fn check_grund(grund: &str) -> Result<String, AppError> {
    let g = grund.trim();
    if g.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "Ein Grund ist Pflicht.".into(),
        ));
    }
    if g.chars().count() > GRUND_MAX {
        return Err(AppError::Validation(format!(
            "Der Grund darf höchstens {GRUND_MAX} Zeichen haben."
        )));
    }
    Ok(g.to_string())
}

/// Das Gegenüber, bei dem die Akte gerade liegt (der Führer ist ein Gegenüber), oder 409.
async fn gegenueber_des_fuehrers(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
) -> Result<FuehrungGegenueber, AppError> {
    repo::list_gegenueber(conn, a.org_id)
        .await?
        .into_iter()
        .find(|g| g.kennung == a.fuehrer_kennung)
        .ok_or_else(|| AppError::Conflict("Die führende Instanz ist nicht mehr gekoppelt.".into()))
}

/// Das Gegenüber `kennung` der Org der Akte, oder 422.
async fn gegenueber(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
    kennung: &str,
) -> Result<FuehrungGegenueber, AppError> {
    repo::list_gegenueber(conn, a.org_id)
        .await?
        .into_iter()
        .find(|g| g.kennung == kennung)
        .ok_or_else(|| {
            AppError::UnprocessableEntity("Kein gekoppeltes Gegenüber dieser Org.".into())
        })
}

fn fordere_fuehrend(a: &AkteZeile, ich: &Ich) -> Result<(), AppError> {
    if a.fuehrer_kennung != ich.kennung {
        return Err(AppError::Conflict(format!(
            "Führung liegt bei „{}“.",
            a.fuehrer_name
        )));
    }
    if a.offen.is_some() {
        return Err(AppError::Conflict(
            "Eine Übernahme wartet auf die Entscheidung.".into(),
        ));
    }
    Ok(())
}

fn fordere_nicht_fuehrend(a: &AkteZeile, ich: &Ich) -> Result<(), AppError> {
    if a.fuehrer_kennung == ich.kennung {
        return Err(AppError::Conflict("Diese Instanz führt bereits.".into()));
    }
    Ok(())
}

/// Eine Notübernahme braucht den Einsatz hier als Spiegel (LLH-1641, E4): Ohne ihn hätte diese
/// Instanz nichts, womit sie weiterführen könnte.
fn fordere_spiegel_hier(a: &AkteZeile) -> Result<(), AppError> {
    if a.einsatz_id.is_none() {
        return Err(AppError::Conflict(
            "Der Einsatz liegt hier noch nicht vor. Übernehmen geht erst, wenn er gespiegelt ist."
                .into(),
        ));
    }
    Ok(())
}

/// Reguläre Übergabe an das Gegenüber `an` (Spec „Reguläre Übergabe durch die führende Instanz“).
pub async fn uebergeben(
    pool: &SqlitePool,
    akte_id: i64,
    an: &str,
    wer: &str,
) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_fuehrend(&a, &ich)?;
        let g = gegenueber(conn, &a, an).await?;
        // Übergeben wird nur, was das Gegenüber vollständig hat (LLH-1641, E4); sonst entstünde
        // ohne Not eine Bruchstelle.
        if let Some(einsatz_id) = a.einsatz_id {
            crate::instanz::spiegel::fuehrung::fordere_abgeglichen(conn, einsatz_id, g.kopplung_id)
                .await?;
        }
        a.set_epoche(&Epoche::naechste([&a.epoche()], &ich.kennung));
        a.fuehrer_kennung = g.kennung.clone();
        a.fuehrer_name = g.name.clone();
        a.set_art(FuehrungWechselArt::Uebergabe);
        a.anfrage_at = None;
        a.erklaerung = None;
        a.beweis = None;
        a.abgabe_schluessel = None;
        a.bruch_at = Some(crate::zeit::jetzt());
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&ich.name),
                nach_name: &g.name,
                wer: Some(wer),
                bruch_at: a.bruch_at.as_deref(),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })?;
    anstossen(pool).await
}

/// Abgabe per Code (D8): nur die meldende, führende Seite; der Code gilt für das Gegenüber `an`,
/// das die erreichte Seite ist. Liefert den Code in Normalform, genau einmal.
pub async fn code_abgeben(
    pool: &SqlitePool,
    akte_id: i64,
    an: &str,
    wer: &str,
) -> Result<String, AppError> {
    let c = code::generate();
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_fuehrend(&a, &ich)?;
        let g = gegenueber(conn, &a, an).await?;
        if g.richtung != InstanzKopplungRichtung::MeldetSich {
            return Err(AppError::UnprocessableEntity(
                "Per Code gibt nur die Seite ab, die sich meldet.".into(),
            ));
        }
        let epoche = Epoche::naechste([&a.epoche()], &ich.kennung);
        let schluessel = erklaerung::abgabe_schluessel(&c, &a.kennung, &epoche);
        a.set_epoche(&epoche);
        a.fuehrer_kennung = g.kennung.clone();
        a.fuehrer_name = g.name.clone();
        a.set_art(FuehrungWechselArt::CodeAbgabe);
        a.anfrage_at = None;
        a.erklaerung = None;
        a.beweis = None;
        a.abgabe_schluessel = Some(erklaerung::schluessel_text(&schluessel));
        a.bruch_at = Some(crate::zeit::jetzt());
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&ich.name),
                nach_name: &g.name,
                wer: Some(wer),
                bruch_at: a.bruch_at.as_deref(),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })?;
    anstossen(pool).await?;
    Ok(c)
}

/// Anfrage der meldenden Seite an eine Akte, die das Gegenüber führt (D9).
pub async fn anfragen(pool: &SqlitePool, akte_id: i64) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_nicht_fuehrend(&a, &ich)?;
        let g = gegenueber_des_fuehrers(conn, &a).await?;
        if g.richtung != InstanzKopplungRichtung::MeldetSich {
            return Err(AppError::UnprocessableEntity(
                "Anfragen kann nur die Seite, die sich meldet.".into(),
            ));
        }
        a.anfrage_at = Some(crate::zeit::jetzt());
        repo::save(conn, &mut a, true).await?;
        Ok(())
    })?;
    anstossen(pool).await
}

/// Notübernahme gegen die erreichte Seite (Spec „Übernahme gegen die erreichte Seite bestätigt
/// ein Mensch der übernehmenden Seite“): ohne Beweis, mit Grund.
pub async fn notuebernahme_gegen_erreichte(
    pool: &SqlitePool,
    akte_id: i64,
    grund: &str,
    wer: &str,
) -> Result<(), AppError> {
    let grund = check_grund(grund)?;
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_nicht_fuehrend(&a, &ich)?;
        fordere_spiegel_hier(&a)?;
        let g = gegenueber_des_fuehrers(conn, &a).await?;
        if g.richtung != InstanzKopplungRichtung::MeldetSich {
            return Err(AppError::UnprocessableEntity(
                "Gegen eine Seite, die sich meldet, braucht die Notübernahme eine Unterschrift \
                 oder einen Code."
                    .into(),
            ));
        }
        let von = a.fuehrer_name.clone();
        let alt = a.epoche();
        let neu = Epoche::naechste([&alt], &ich.kennung);
        let e = NotuebernahmeErklaerung {
            typ: TYP_NOTUEBERNAHME.into(),
            einsatz: a.kennung.clone(),
            org: g.org_schluessel.clone(),
            epoche_alt: alt,
            epoche_neu: neu.clone(),
            fuehrer_alt: a.fuehrer_kennung.clone(),
            fuehrer_neu: ich.kennung.clone(),
            grund: grund.clone(),
            zeitpunkt: crate::zeit::jetzt(),
            unterzeichner: wer.to_string(),
        };
        a.set_epoche(&neu);
        a.fuehrer_kennung = ich.kennung.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(FuehrungWechselArt::Notuebernahme);
        a.erklaerung = Some(e.to_text());
        a.beweis = None;
        a.anfrage_at = None;
        a.bruch_at = None;
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&von),
                nach_name: &ich.name,
                wer: Some(wer),
                grund: Some(&grund),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })?;
    anstossen(pool).await
}

/// Die Erklärung einer Notübernahme gegen die meldende Seite (D6), noch ohne Beweis. 409, wenn
/// die Akte nicht von einer Seite geführt wird, die sich hier meldet.
pub async fn build_erklaerung_gegen_meldende(
    pool: &SqlitePool,
    akte_id: i64,
    grund: &str,
    unterzeichner: &str,
) -> Result<NotuebernahmeErklaerung, AppError> {
    let grund = check_grund(grund)?;
    let mut conn = pool.acquire().await?;
    let ich = repo::ich(&mut conn).await?;
    let a = repo::load(&mut conn, akte_id).await?;
    fordere_nicht_fuehrend(&a, &ich)?;
    fordere_spiegel_hier(&a)?;
    let g = gegenueber_des_fuehrers(&mut conn, &a).await?;
    if g.richtung != InstanzKopplungRichtung::WirdGemeldet {
        return Err(AppError::UnprocessableEntity(
            "Gegen die erreichte Seite braucht die Notübernahme keine Unterschrift.".into(),
        ));
    }
    let alt = a.epoche();
    Ok(NotuebernahmeErklaerung {
        typ: TYP_NOTUEBERNAHME.into(),
        einsatz: a.kennung.clone(),
        org: g.org_schluessel,
        epoche_neu: Epoche::naechste([&alt], &ich.kennung),
        epoche_alt: alt,
        fuehrer_alt: a.fuehrer_kennung.clone(),
        fuehrer_neu: ich.kennung,
        grund,
        zeitpunkt: crate::zeit::jetzt(),
        unterzeichner: unterzeichner.to_string(),
    })
}

/// Vollzieht eine Notübernahme gegen die meldende Seite mit geprüftem Beweis. Die Erklärung muss
/// noch zur Akte passen (sonst 409: inzwischen hat sich die Führung geändert).
pub async fn notuebernahme_gegen_meldende(
    pool: &SqlitePool,
    akte_id: i64,
    e: &NotuebernahmeErklaerung,
    beweis: &FuehrungBeweis,
    wer: &str,
) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        if a.epoche() != e.epoche_alt || a.fuehrer_kennung != e.fuehrer_alt {
            return Err(AppError::Conflict(
                "Die Führung hat sich inzwischen geändert.".into(),
            ));
        }
        fordere_spiegel_hier(&a)?;
        let von = a.fuehrer_name.clone();
        a.set_epoche(&e.epoche_neu);
        a.fuehrer_kennung = e.fuehrer_neu.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(match beweis {
            FuehrungBeweis::Unterschrift { .. } => FuehrungWechselArt::Notuebernahme,
            FuehrungBeweis::Code { .. } => FuehrungWechselArt::CodeAbgabe,
        });
        a.erklaerung = Some(e.to_text());
        a.beweis = Some(serde_json::to_string(beweis).expect("serialisierbar"));
        a.bruch_at = None;
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                art: Some(FuehrungWechselArt::Notuebernahme),
                von_name: Some(&von),
                nach_name: &ich.name,
                wer: Some(wer),
                grund: Some(&e.grund),
                unterzeichner: Some(&e.unterzeichner),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })
}

/// Notübernahme mit dem Abgabecode der meldenden Seite (D8): die Epoche hat die meldende Seite
/// beim Erzeugen reserviert (nächste nach der bekannten, mit ihrer Kennung). Ob der Code passt,
/// prüft erst die meldende Seite.
pub async fn notuebernahme_mit_code(
    pool: &SqlitePool,
    akte_id: i64,
    grund: &str,
    code_eingabe: &str,
    wer: &str,
) -> Result<(), AppError> {
    let c = code::normalize(code_eingabe).ok_or_else(|| {
        AppError::UnprocessableEntity("Der Code hat 16 Zeichen aus Ziffern und Buchstaben.".into())
    })?;
    let mut e = build_erklaerung_gegen_meldende(pool, akte_id, grund, wer).await?;
    // Die meldende Seite hat die Epoche beim Erzeugen des Codes mit ihrer Kennung reserviert.
    e.epoche_neu = Epoche::naechste([&e.epoche_alt], &e.fuehrer_alt);
    let schluessel = erklaerung::abgabe_schluessel(&c, &e.einsatz, &e.epoche_neu);
    let text = e.to_text();
    let beweis = FuehrungBeweis::Code {
        pruefwert: erklaerung::code_pruefwert(&schluessel, &text),
    };
    notuebernahme_gegen_meldende(pool, akte_id, &e, &beweis, wer).await
}

/// Bestätigt eine offene Übernahme gegen diese Instanz (meldende Seite): sie gilt, die Bruchstelle
/// wird festgehalten (D7, D11).
pub async fn bestaetigen(pool: &SqlitePool, akte_id: i64, wer: &str) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        let m: AkteMeldung = a
            .offen
            .as_deref()
            .and_then(|o| serde_json::from_str(o).ok())
            .ok_or_else(|| AppError::Conflict("Keine Übernahme wartet.".into()))?;
        let e = m
            .erklaerung
            .as_deref()
            .and_then(NotuebernahmeErklaerung::parse);
        // Die Übernahme muss noch dem Stand gelten, gegen den sie erklärt wurde.
        if m.epoche <= a.epoche() || e.as_ref().is_some_and(|e| e.epoche_alt != a.epoche()) {
            return Err(AppError::Conflict(
                "Die Führung hat sich inzwischen geändert.".into(),
            ));
        }
        if !repo::list_gegenueber(conn, a.org_id)
            .await?
            .iter()
            .any(|g| g.kennung == m.fuehrer)
        {
            return Err(AppError::Conflict(
                "Die übernehmende Instanz ist nicht mehr gekoppelt.".into(),
            ));
        }
        let bruch = a.offen_bruch_at.clone();
        a.set_epoche(&m.epoche);
        a.fuehrer_kennung = m.fuehrer.clone();
        a.fuehrer_name = m.fuehrer_name.clone();
        a.set_art(FuehrungWechselArt::Bestaetigt);
        a.erklaerung = m.erklaerung.clone();
        a.beweis = m
            .beweis
            .as_ref()
            .map(|b| serde_json::to_string(b).expect("serialisierbar"));
        a.offen = None;
        a.offen_bruch_at = None;
        a.bruch_at = bruch.clone();
        a.abgabe_schluessel = None;
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&ich.name),
                nach_name: &m.fuehrer_name,
                wer: Some(wer),
                grund: e.as_ref().map(|e| e.grund.as_str()),
                unterzeichner: e.as_ref().map(|e| e.unterzeichner.as_str()),
                bruch_at: bruch.as_deref(),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })?;
    anstossen(pool).await
}

/// Widerspricht einer offenen Übernahme: diese Instanz führt mit der nächsten Epoche weiter (D10).
pub async fn widersprechen(pool: &SqlitePool, akte_id: i64, wer: &str) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        let m: AkteMeldung = a
            .offen
            .as_deref()
            .and_then(|o| serde_json::from_str(o).ok())
            .ok_or_else(|| AppError::Conflict("Keine Übernahme wartet.".into()))?;
        let neu = Epoche::naechste([&a.epoche(), &m.epoche], &ich.kennung);
        a.set_epoche(&neu);
        a.fuehrer_kennung = ich.kennung.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(FuehrungWechselArt::Widerspruch);
        a.anfrage_at = None;
        a.erklaerung = None;
        a.beweis = None;
        a.offen = None;
        a.offen_bruch_at = None;
        repo::save(conn, &mut a, true).await?;
        let grund = format!("Notübernahme durch {} widersprochen", m.fuehrer_name);
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                von_name: Some(&m.fuehrer_name),
                nach_name: &ich.name,
                wer: Some(wer),
                grund: Some(&grund),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(())
    })?;
    anstossen(pool).await
}

// ── Anzeige ──────────────────────────────────────────────────────────────────────────────────

/// Eine offene Übernahme gegen diese Instanz, wie die Oberfläche sie zeigt.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungOffen {
    pub von: String,
    pub epoche: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unterzeichner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeitpunkt: Option<String>,
    pub bruch_at: String,
}

/// Die Führung einer Akte samt Verlauf (Paneel „Führung“, Seite „Instanzkopplung“).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungAnzeige {
    pub id: i64,
    pub kennung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nummer: Option<String>,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub status: String,
    pub epoche: i64,
    pub fuehrer_name: String,
    pub fuehrer_kennung: String,
    /// Diese Instanz führt.
    pub fuehrend: bool,
    pub art: FuehrungWechselArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bruch_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offen: Option<FuehrungOffen>,
    /// Diese Instanz hat die Führung beim Gegenüber erbeten.
    pub anfrage_offen: bool,
    /// Die Gegenüber der Org, an die die Führung gehen kann.
    pub gegenueber: Vec<FuehrungGegenueber>,
    /// Richtung der Kopplung zur führenden Instanz, wenn ein Gegenüber führt: sie entscheidet,
    /// wie eine Notübernahme geht (`wird_gemeldet` = mit Unterschrift oder Code).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fuehrer_richtung: Option<InstanzKopplungRichtung>,
    pub verlauf: Vec<FuehrungVerlaufEintrag>,
}

pub async fn anzeige(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
) -> Result<FuehrungAnzeige, AppError> {
    let ich = repo::ich(conn).await?;
    let gegenueber = repo::list_gegenueber(conn, a.org_id).await?;
    let offen = a
        .offen
        .as_deref()
        .and_then(|o| serde_json::from_str::<AkteMeldung>(o).ok())
        .map(|m| {
            let e = m
                .erklaerung
                .as_deref()
                .and_then(NotuebernahmeErklaerung::parse);
            FuehrungOffen {
                von: m.fuehrer_name.clone(),
                epoche: m.epoche.zaehler,
                grund: e.as_ref().map(|e| e.grund.clone()),
                unterzeichner: e.as_ref().map(|e| e.unterzeichner.clone()),
                zeitpunkt: e.map(|e| e.zeitpunkt),
                bruch_at: a.offen_bruch_at.clone().unwrap_or_default(),
            }
        });
    Ok(FuehrungAnzeige {
        id: a.id,
        kennung: a.kennung.clone(),
        einsatz_id: a.einsatz_id,
        nummer: a.nummer.clone(),
        bezeichnung: a.bezeichnung.clone(),
        stichwort: a.stichwort.clone(),
        status: a.status.clone(),
        epoche: a.epoche_zaehler,
        fuehrer_name: a.fuehrer_name.clone(),
        fuehrer_kennung: a.fuehrer_kennung.clone(),
        fuehrend: a.fuehrer_kennung == ich.kennung,
        art: a.art(),
        bruch_at: a.bruch_at.clone(),
        offen,
        anfrage_offen: a.anfrage_at.is_some(),
        fuehrer_richtung: gegenueber
            .iter()
            .find(|g| g.kennung == a.fuehrer_kennung)
            .map(|g| g.richtung),
        gegenueber,
        verlauf: repo::list_verlauf(conn, a.id).await?,
    })
}

/// Lädt die Akte eines lokalen Einsatzes (vorher [`repo::ensure_akten`]); 404 ohne Akte.
pub async fn load_fuer_einsatz(pool: &SqlitePool, einsatz_id: i64) -> Result<AkteZeile, AppError> {
    crate::write_retry!(pool, |conn| { repo::ensure_akten(conn).await })?;
    let mut conn = pool.acquire().await?;
    repo::find_by_einsatz(&mut conn, einsatz_id)
        .await?
        .ok_or(AppError::NotFound)
}

/// Lädt eine Akte der Org `org_id` für die Seite „Instanzkopplung“; sonst 404. Gelistet werden
/// dort die Akten des Gegenübers ([`repo::list_fremde_der_org`]); eine Akte, die inzwischen hier
/// führt, antwortet weiter (409 aus den Regeln statt 404, LLH-1641).
pub async fn load_fremde(
    pool: &SqlitePool,
    org_id: i64,
    akte_id: i64,
) -> Result<AkteZeile, AppError> {
    let mut conn = pool.acquire().await?;
    let a = repo::load(&mut conn, akte_id).await?;
    if a.org_id != org_id {
        return Err(AppError::NotFound);
    }
    Ok(a)
}

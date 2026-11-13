//! Bedienung der Führung (design.md D5, D6, D8, D9, D10): Übergabe, Abgabecode, Anfrage,
//! Notübernahme, Bestätigen und Widersprechen. Die Routen (`routes::fuehrung`) prüfen Rolle und
//! Schalter; hier liegen Regeln und Transaktion. Jede Änderung stößt die nächste Meldung an.

use super::austausch::{self, AkteMeldung};
use super::erklaerung::{self, FuehrungBeweis, NotuebernahmeErklaerung, TYP_NOTUEBERNAHME};
use super::repo::{self, AkteZeile, FuehrungGegenueber, FuehrungVerlaufEintrag, Ich, VerlaufNeu};
use super::{Epoche, FuehrungWechselArt, GRUND_MAX};
use crate::error::AppError;
use crate::instanz::{code, InstanzKopplungRichtung, Wechselregel};
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Stößt die nächste Meldung jeder meldenden Kopplung an (der Hintergrund-Task nimmt sie beim
/// nächsten Takt). Die erreichte Seite wartet auf die Meldung des Gegenübers.
///
/// Läuft nach dem Commit des Wechsels und schlägt deshalb nicht durch (LLH-1674): Admin-Spur und
/// Live-Ereignis des Wechsels dürfen nicht daran scheitern; ohne Anstoß meldet sich die Kopplung
/// mit ihrem nächsten regulären Takt.
pub async fn anstossen(pool: &SqlitePool) {
    if let Err(e) = sqlx::query(
        "UPDATE instanz_kopplung SET naechste_meldung_at = NULL \
         WHERE richtung = 'meldet_sich' AND zustand = 'aktiv'",
    )
    .execute(pool)
    .await
    {
        tracing::warn!(error = %e, "Führung: nächste Meldung nicht angestoßen");
    }
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

/// Der Text einer Erklärung, wie er in die Akte und unter die Unterschrift geht, oder 422, wenn
/// er größer ist, als das Gegenüber an einer Akte annimmt ([`austausch::ERKLAERUNG_MAX`] Byte,
/// dasselbe Maß wie `AkteMeldung::is_in_grenzen_bis`). Jede Erklärung geht vor dem Speichern
/// hier durch (LLH-1702, ADR-0037): Eine zu große Akte schickt der Ausgang nicht, die
/// Notübernahme gälte dann nur lokal, und beide Seiten hielten sich für die führende Instanz.
///
/// Der Unterzeichner ist beim Bauen schon gekürzt ([`crate::auth::truncate_anzeigename`]); was
/// dann noch zu groß ist, liegt am Grund (Steuerzeichen kosten in JSON sechs Byte je Zeichen).
pub fn erklaerung_text(e: &NotuebernahmeErklaerung) -> Result<String, AppError> {
    let text = NotuebernahmeErklaerung::to_text(e);
    if text.len() > austausch::ERKLAERUNG_MAX {
        return Err(AppError::UnprocessableEntity(
            "Die Erklärung der Notübernahme ist zu groß für die Übertragung. Bitte den Grund \
             kürzen."
                .into(),
        ));
    }
    Ok(text)
}

/// 409, wenn über die Kopplung zu `g` keine Führung wechselt: Direktkopplung mit einer
/// Gegenstelle, die Protokoll 4 noch nicht spricht (LLH-1678, design.md D1; Spec
/// `instanz-fuehrung`, „Über eine Direktkopplung wechselt die Führung gleichrangig“).
pub fn fordere_wechsel(g: &FuehrungGegenueber) -> Result<(), AppError> {
    match g.wechsel {
        Wechselregel::NachRichtung | Wechselregel::Gleichrangig => Ok(()),
        Wechselregel::Gesperrt => Err(AppError::Conflict(crate::instanz::update_hinweis(&g.name))),
    }
}

/// Ob die Seite gegenüber `g` die Rolle der meldenden Seite hat: bei einer Standardkopplung, wenn
/// sie sich meldet; über eine Direktkopplung immer (gleichrangig, design.md D1).
fn wie_meldend(g: &FuehrungGegenueber) -> bool {
    g.wechsel == Wechselregel::Gleichrangig || g.richtung == InstanzKopplungRichtung::MeldetSich
}

/// Ob das Gegenüber `g` die Rolle der meldenden Seite hat (Gegenstück zu [`wie_meldend`]).
fn gegenueber_wie_meldend(g: &FuehrungGegenueber) -> bool {
    g.wechsel == Wechselregel::Gleichrangig || g.richtung == InstanzKopplungRichtung::WirdGemeldet
}

/// Das Gegenüber, bei dem die Akte gerade liegt (der Führer ist ein Gegenüber), oder 409; auch
/// 409, wenn es nur vor Ort gekoppelt ist.
async fn gegenueber_des_fuehrers(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
) -> Result<FuehrungGegenueber, AppError> {
    let g = repo::list_gegenueber(conn, a.org_id)
        .await?
        .into_iter()
        .find(|g| g.kennung == a.fuehrer_kennung)
        .ok_or_else(|| {
            AppError::Conflict("Die führende Instanz ist nicht mehr gekoppelt.".into())
        })?;
    fordere_wechsel(&g)?;
    Ok(g)
}

/// Das Gegenüber `kennung` der Org der Akte, oder 422.
async fn gegenueber(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
    kennung: &str,
) -> Result<FuehrungGegenueber, AppError> {
    let g = repo::list_gegenueber(conn, a.org_id)
        .await?
        .into_iter()
        .find(|g| g.kennung == kennung)
        .ok_or_else(|| {
            AppError::UnprocessableEntity("Kein gekoppeltes Gegenüber dieser Org.".into())
        })?;
    fordere_wechsel(&g)?;
    Ok(g)
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

/// Ob diese Instanz den Einsatz der Akte verwahrt (LLH-1647, E4).
async fn ist_verwahrt(conn: &mut SqliteConnection, a: &AkteZeile) -> Result<bool, AppError> {
    match a.einsatz_id {
        Some(id) => crate::instanz::spiegel::lebensende::ist_verwahrt(conn, id).await,
        None => Ok(false),
    }
}

/// Einen verwahrten Einsatz führt nur noch diese Instanz (LLH-1647, E4): Sonst ginge die Führung
/// an eine Instanz, die den Einsatz nach der Nachbereitung gelöscht hat.
async fn fordere_nicht_verwahrt(
    conn: &mut SqliteConnection,
    a: &AkteZeile,
) -> Result<(), AppError> {
    if ist_verwahrt(conn, a).await? {
        return Err(AppError::Conflict("Einsatz ist verwahrt.".into()));
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
) -> Result<AkteZeile, AppError> {
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_fuehrend(&a, &ich)?;
        fordere_nicht_verwahrt(conn, &a).await?;
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
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok(a)
}

/// Abgabe per Code (D8): nur die meldende, führende Seite; der Code gilt für das Gegenüber `an`,
/// das die erreichte Seite ist. Liefert den Code in Normalform, genau einmal.
pub async fn code_abgeben(
    pool: &SqlitePool,
    akte_id: i64,
    an: &str,
    wer: &str,
) -> Result<(String, AkteZeile), AppError> {
    let c = code::generate();
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_fuehrend(&a, &ich)?;
        fordere_nicht_verwahrt(conn, &a).await?;
        let g = gegenueber(conn, &a, an).await?;
        if !wie_meldend(&g) {
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
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok((c, a))
}

/// Anfrage der meldenden Seite an eine Akte, die das Gegenüber führt (D9).
pub async fn anfragen(pool: &SqlitePool, akte_id: i64) -> Result<AkteZeile, AppError> {
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_nicht_fuehrend(&a, &ich)?;
        let g = gegenueber_des_fuehrers(conn, &a).await?;
        if !wie_meldend(&g) {
            return Err(AppError::UnprocessableEntity(
                "Anfragen kann nur die Seite, die sich meldet.".into(),
            ));
        }
        // Mit Mikrosekunden: Der Zeitpunkt ist zugleich die Kennung der Anfrage vor Ort
        // (`AkteMeldung::anfrage_seit`, LLH-1678), und eine neue Anfrage in derselben Sekunde wie
        // eine abgelehnte muss sich von ihr unterscheiden.
        a.anfrage_at = Some(
            chrono::Utc::now()
                .format("%Y-%m-%d %H:%M:%S%.6f")
                .to_string(),
        );
        a.anfrage_abgelehnt = None;
        repo::save(conn, &mut a, true).await?;
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok(a)
}

/// Notübernahme gegen die erreichte Seite (Spec „Übernahme gegen die erreichte Seite bestätigt
/// ein Mensch der übernehmenden Seite“): ohne Beweis, mit Grund.
pub async fn notuebernahme_gegen_erreichte(
    pool: &SqlitePool,
    akte_id: i64,
    grund: &str,
    wer: &str,
) -> Result<AkteZeile, AppError> {
    let grund = check_grund(grund)?;
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_nicht_fuehrend(&a, &ich)?;
        fordere_spiegel_hier(&a)?;
        let g = gegenueber_des_fuehrers(conn, &a).await?;
        if g.wechsel == Wechselregel::Gleichrangig {
            return Err(AppError::UnprocessableEntity(
                "Über eine Direktkopplung braucht die Notübernahme eine Unterschrift oder einen \
                 Code."
                    .into(),
            ));
        }
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
            unterzeichner: crate::auth::truncate_anzeigename(wer),
        };
        // Vor jeder Änderung an der Akte: ein 422 lässt die Führung, wo sie war.
        let text = erklaerung_text(&e)?;
        a.set_epoche(&neu);
        a.fuehrer_kennung = ich.kennung.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(FuehrungWechselArt::Notuebernahme);
        a.erklaerung = Some(text);
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
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok(a)
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
    if !gegenueber_wie_meldend(&g) {
        return Err(AppError::UnprocessableEntity(
            "Gegen die erreichte Seite braucht die Notübernahme keine Unterschrift.".into(),
        ));
    }
    let alt = a.epoche();
    let e = NotuebernahmeErklaerung {
        typ: TYP_NOTUEBERNAHME.into(),
        einsatz: a.kennung.clone(),
        org: g.org_schluessel,
        epoche_neu: Epoche::naechste([&alt], &ich.kennung),
        epoche_alt: alt,
        fuehrer_alt: a.fuehrer_kennung.clone(),
        fuehrer_neu: ich.kennung,
        grund,
        zeitpunkt: crate::zeit::jetzt(),
        unterzeichner: crate::auth::truncate_anzeigename(unterzeichner),
    };
    // Schon hier, damit eine zu große Erklärung gar nicht erst zur Unterschrift vorliegt; der
    // Vollzug prüft den endgültigen Text noch einmal (der Weg mit Code ändert die Epoche).
    erklaerung_text(&e)?;
    Ok(e)
}

/// Vollzieht eine Notübernahme gegen die meldende Seite mit geprüftem Beweis. Die Erklärung muss
/// noch zur Akte passen (sonst 409: inzwischen hat sich die Führung geändert).
pub async fn notuebernahme_gegen_meldende(
    pool: &SqlitePool,
    akte_id: i64,
    e: &NotuebernahmeErklaerung,
    beweis: &FuehrungBeweis,
    wer: &str,
) -> Result<AkteZeile, AppError> {
    crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        if a.epoche() != e.epoche_alt || a.fuehrer_kennung != e.fuehrer_alt {
            return Err(AppError::Conflict(
                "Die Führung hat sich inzwischen geändert.".into(),
            ));
        }
        fordere_spiegel_hier(&a)?;
        let text = erklaerung_text(e)?;
        let von = a.fuehrer_name.clone();
        a.set_epoche(&e.epoche_neu);
        a.fuehrer_kennung = e.fuehrer_neu.clone();
        a.fuehrer_name = ich.name.clone();
        a.set_art(match beweis {
            FuehrungBeweis::Unterschrift { .. } => FuehrungWechselArt::Notuebernahme,
            FuehrungBeweis::Code { .. } => FuehrungWechselArt::CodeAbgabe,
        });
        a.erklaerung = Some(text);
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
        Ok(a)
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
) -> Result<AkteZeile, AppError> {
    let c = code::normalize(code_eingabe).ok_or_else(|| {
        AppError::UnprocessableEntity("Der Code hat 16 Zeichen aus Ziffern und Buchstaben.".into())
    })?;
    let mut e = build_erklaerung_gegen_meldende(pool, akte_id, grund, wer).await?;
    // Die meldende Seite hat die Epoche beim Erzeugen des Codes mit ihrer Kennung reserviert.
    e.epoche_neu = Epoche::naechste([&e.epoche_alt], &e.fuehrer_alt);
    let schluessel = erklaerung::abgabe_schluessel(&c, &e.einsatz, &e.epoche_neu);
    // Der endgültige Text, nach dem Tausch der Epoche: über ihn rechnet der Prüfwert.
    let text = erklaerung_text(&e)?;
    let beweis = FuehrungBeweis::Code {
        pruefwert: erklaerung::code_pruefwert(&schluessel, &text),
    };
    notuebernahme_gegen_meldende(pool, akte_id, &e, &beweis, wer).await
}

/// Bestätigt eine offene Übernahme gegen diese Instanz (meldende Seite): sie gilt, die Bruchstelle
/// wird festgehalten (D7, D11).
///
/// Ergebnis: die gespeicherte Akte und ob es ein Konflikt war (die erreichte Seite nannte einen
/// Dritten, D4 der Change `faq7l7m4-zwei-elw-unterlegene-seite`); die Admin-Spur beschreibt ihn
/// anders.
pub async fn bestaetigen(
    pool: &SqlitePool,
    akte_id: i64,
    wer: &str,
) -> Result<(AkteZeile, bool), AppError> {
    let (a, konflikt) = crate::write_retry!(pool, |conn| {
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
        let hubs = repo::list_hubs(conn, a.org_id).await?;
        let hubs: Vec<&str> = hubs.iter().map(String::as_str).collect();
        let konflikt = austausch::ist_konflikt(&m, &hubs);
        // Eine Erklärung zählt hier nur, wenn sie gegen diese Instanz gerichtet ist; die Akte des
        // Hubs kann die Erklärung einer anderen ELW tragen (D7).
        let gegen_mich = e
            .as_ref()
            .filter(|e| austausch::is_gegen_mich(e, &ich.kennung));
        if konflikt {
            // Der Hub nennt einen Dritten (D4): Es gilt sein Stand, auch mit kleinerer Epoche;
            // gekoppelt ist der Dritte nicht.
            if a.fuehrer_kennung != ich.kennung {
                return Err(AppError::Conflict(
                    "Die Führung hat sich inzwischen geändert.".into(),
                ));
            }
        } else {
            // Die Übernahme muss noch dem Stand gelten, gegen den sie erklärt wurde.
            if m.epoche <= a.epoche() || gegen_mich.is_some_and(|e| e.epoche_alt != a.epoche()) {
                return Err(AppError::Conflict(
                    "Die Führung hat sich inzwischen geändert.".into(),
                ));
            }
        }
        let eigene_notuebernahme = a.art() == FuehrungWechselArt::Notuebernahme;
        // Die Unterschrift muss auch beim Bestätigen noch tragen: Ein inzwischen widerrufener
        // Schlüssel gibt die Führung nicht ab (LLH-1671). Ohne Erklärung gegen diese Instanz
        // (Konflikt, D7 der Change `faq7l7m4-zwei-elw-unterlegene-seite`) gibt es keine.
        if !konflikt && gegen_mich.is_some() {
            let alt = a.epoche();
            if let Err(grund) =
                super::austausch::check_unterschrift(conn, &ich.kennung, a.org_id, &m, &alt).await
            {
                return Err(AppError::Conflict(format!(
                    "Die Unterschrift der Übernahme gilt hier nicht mehr ({grund})."
                )));
            }
        }
        let bruch = a.offen_bruch_at.clone();
        a.set_epoche(&m.epoche);
        a.fuehrer_kennung = m.fuehrer.clone();
        a.fuehrer_name = m.fuehrer_name.clone();
        // Im Konflikt bleibt die Art des Hubs: Er hat nichts zu bestätigen, und gleiche Epoche mit
        // gleicher Art lässt den Takt ruhig.
        if konflikt {
            a.art = m.art.clone();
        } else {
            a.set_art(FuehrungWechselArt::Bestaetigt);
        }
        a.erklaerung = m.erklaerung.clone();
        a.beweis = m
            .beweis
            .as_ref()
            .map(|b| serde_json::to_string(b).expect("serialisierbar"));
        a.offen = None;
        a.offen_bruch_at = None;
        a.bruch_at = bruch.clone();
        a.abgabe_schluessel = None;
        let grund = if konflikt {
            Some(konflikt_text(eigene_notuebernahme, &m.fuehrer_name))
        } else {
            gegen_mich.map(|e| e.grund.clone())
        };
        repo::save(conn, &mut a, true).await?;
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                art: Some(FuehrungWechselArt::Bestaetigt),
                von_name: Some(&ich.name),
                nach_name: &m.fuehrer_name,
                wer: Some(wer),
                grund: grund.as_deref(),
                unterzeichner: gegen_mich.map(|e| e.unterzeichner.as_str()),
                bruch_at: bruch.as_deref(),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok((a, konflikt))
    })?;
    anstossen(pool).await;
    Ok((a, konflikt))
}

/// Grund im Verlauf und in der Admin-Spur, wenn die eigene Führung am Hub nicht gegriffen hat.
pub fn konflikt_text(eigene_notuebernahme: bool, fuehrer: &str) -> String {
    if eigene_notuebernahme {
        format!("Notübernahme hat am Hub nicht gegriffen, Führung bei {fuehrer}")
    } else {
        format!("Führung hat am Hub nicht gegriffen, sie liegt bei {fuehrer}")
    }
}

/// Widerspricht einer offenen Übernahme: diese Instanz führt mit der nächsten Epoche weiter (D10).
pub async fn widersprechen(
    pool: &SqlitePool,
    akte_id: i64,
    wer: &str,
) -> Result<AkteZeile, AppError> {
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        let m: AkteMeldung = a
            .offen
            .as_deref()
            .and_then(|o| serde_json::from_str(o).ok())
            .ok_or_else(|| AppError::Conflict("Keine Übernahme wartet.".into()))?;
        let hubs = repo::list_hubs(conn, a.org_id).await?;
        let hubs: Vec<&str> = hubs.iter().map(String::as_str).collect();
        if austausch::ist_konflikt(&m, &hubs) {
            // D5: Der Hub nimmt keinen Widerspruch an, solange ein Dritter führt.
            return Err(AppError::UnprocessableEntity(format!(
                "Die Führung liegt bei „{}“; ein Widerspruch würde am Hub nicht greifen.",
                m.fuehrer_name
            )));
        }
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
        // „Notübernahme“ nur, wenn eine Erklärung gegen diese Instanz vorliegt (D7: der Hub kann mit
        // der Epoche eines Dritten führen, ohne etwas gegen sie erklärt zu haben).
        let gegen_mich = m
            .erklaerung
            .as_deref()
            .and_then(NotuebernahmeErklaerung::parse)
            .is_some_and(|e| austausch::is_gegen_mich(&e, &ich.kennung));
        let was = if gegen_mich {
            "Notübernahme"
        } else {
            "Übernahme"
        };
        let grund = format!("{was} durch {} widersprochen", m.fuehrer_name);
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
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok(a)
}

/// Lehnt die wartende Anfrage der Gegenstelle einer Direktkopplung ab (LLH-1678, design.md D4;
/// Spec `instanz-fuehrung`, „Eine Anfrage vor Ort entscheidet die Einsatzleitung der führenden
/// Seite“). Die Akte trägt die Ablehnung ab jetzt auf der Leitung; die Führung bleibt hier.
pub async fn anfrage_ablehnen(
    pool: &SqlitePool,
    akte_id: i64,
    wer: &str,
) -> Result<AkteZeile, AppError> {
    let a = crate::write_retry!(pool, |conn| {
        let ich = repo::ich(conn).await?;
        let mut a = repo::load(conn, akte_id).await?;
        fordere_fuehrend(&a, &ich)?;
        let gegenueber_liste = repo::list_gegenueber(conn, a.org_id).await?;
        let (von, seit) = repo::load_anfrage_von(conn, a.id).await?;
        // Nur eine Anfrage vor Ort entscheidet ein Mensch; die wartende Anfrage einer
        // Standardkopplung erfüllt der Hub selbst, sobald der ELW alles hat (Review vor dem PR).
        let g = von
            .as_deref()
            .and_then(|v| {
                gegenueber_liste
                    .iter()
                    .find(|g| g.kennung == v && g.wechsel == Wechselregel::Gleichrangig)
            })
            .ok_or_else(|| AppError::Conflict("Keine Anfrage vor Ort wartet.".into()))?;
        let name = g.name.clone();
        let von = g.kennung.clone();
        repo::save_anfrage_von(conn, a.id, None, None).await?;
        a.anfrage_abgelehnt = Some(von);
        a.anfrage_abgelehnt_seit = seit;
        repo::save(conn, &mut a, true).await?;
        let grund = format!("Anfrage von {name} abgelehnt");
        repo::add_verlauf(
            conn,
            &a,
            VerlaufNeu {
                art: Some(FuehrungWechselArt::Anfrage),
                von_name: Some(&ich.name),
                nach_name: &ich.name,
                wer: Some(wer),
                grund: Some(&grund),
                ..VerlaufNeu::default()
            },
        )
        .await?;
        Ok(a)
    })?;
    anstossen(pool).await;
    Ok(a)
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
    /// Die erreichte Seite nennt einen Dritten als Führer: nur Bestätigen, kein Widerspruch
    /// (Change `faq7l7m4-zwei-elw-unterlegene-seite`, D3).
    pub konflikt: bool,
}

/// Eine Gegenstelle vor Ort, die um die Führung bittet (LLH-1678, design.md D4).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungAnfrageEingang {
    pub kennung: String,
    pub name: String,
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
    /// Die führende Gegenstelle vor Ort hat die Anfrage dieser Instanz abgelehnt (LLH-1678).
    pub anfrage_abgelehnt: bool,
    /// Diese Instanz führt, und eine Gegenstelle vor Ort bittet um die Führung (LLH-1678).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anfrage_eingang: Option<FuehrungAnfrageEingang>,
    /// Diese Instanz verwahrt den Einsatz (LLH-1647, E4): keine Übergabe mehr.
    pub verwahrt: bool,
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
            // Angaben einer Erklärung nur, wenn sie gegen diese Instanz gerichtet ist; sonst
            // gehören Grund und Unterzeichner einer anderen ELW (Konflikt, D3 und D7).
            let e = m
                .erklaerung
                .as_deref()
                .and_then(NotuebernahmeErklaerung::parse)
                .filter(|e| austausch::is_gegen_mich(e, &ich.kennung));
            let hubs: Vec<&str> = gegenueber
                .iter()
                .filter(|g| g.is_hub())
                .map(|g| g.kennung.as_str())
                .collect();
            FuehrungOffen {
                von: m.fuehrer_name.clone(),
                epoche: m.epoche.zaehler,
                grund: e.as_ref().map(|e| e.grund.clone()),
                unterzeichner: e.as_ref().map(|e| e.unterzeichner.clone()),
                zeitpunkt: e.map(|e| e.zeitpunkt),
                bruch_at: a.offen_bruch_at.clone().unwrap_or_default(),
                konflikt: austausch::ist_konflikt(&m, &hubs),
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
        anfrage_abgelehnt: a.anfrage_abgelehnt.as_deref() == Some(ich.kennung.as_str()),
        anfrage_eingang: match repo::load_anfrage_von(conn, a.id).await?.0 {
            Some(von) if a.fuehrer_kennung == ich.kennung => gegenueber
                .iter()
                .find(|g| g.kennung == von && g.wechsel == Wechselregel::Gleichrangig)
                .map(|g| FuehrungAnfrageEingang {
                    kennung: g.kennung.clone(),
                    name: g.name.clone(),
                }),
            _ => None,
        },
        verwahrt: ist_verwahrt(conn, a).await?,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn erklaerung_mit_grund(grund: String) -> NotuebernahmeErklaerung {
        NotuebernahmeErklaerung {
            typ: TYP_NOTUEBERNAHME.into(),
            einsatz: "elw/1".into(),
            org: "org".into(),
            epoche_alt: Epoche::neu(1, "hub"),
            epoche_neu: Epoche::neu(2, "elw"),
            fuehrer_alt: "hub".into(),
            fuehrer_neu: "elw".into(),
            grund,
            zeitpunkt: "2026-11-12 20:00:00".into(),
            unterzeichner: "Erika Beispiel".into(),
        }
    }

    /// Die Grenze ist die des Empfängers, in Byte des Texts: genau `ERKLAERUNG_MAX` geht durch,
    /// ein Byte mehr ist 422 und nennt, was zu kürzen ist (LLH-1702).
    #[test]
    fn erklaerung_genau_an_der_grenze_geht_durch_und_ein_byte_mehr_ist_422() {
        let leer = erklaerung_mit_grund(String::new()).to_text().len();
        let genau = erklaerung_mit_grund("g".repeat(austausch::ERKLAERUNG_MAX - leer));
        let text = erklaerung_text(&genau).expect("an der Grenze");
        assert_eq!(text.len(), austausch::ERKLAERUNG_MAX);
        assert_eq!(text, genau.to_text());

        let drueber = erklaerung_mit_grund("g".repeat(austausch::ERKLAERUNG_MAX - leer + 1));
        match erklaerung_text(&drueber) {
            Err(AppError::UnprocessableEntity(m)) => assert_eq!(
                m,
                "Die Erklärung der Notübernahme ist zu groß für die Übertragung. Bitte den \
                 Grund kürzen."
            ),
            anderes => panic!("erwartet 422, war {anderes:?}"),
        }
    }

    /// Gezählt wird, was auf die Leitung geht: ein Steuerzeichen kostet in JSON sechs Byte.
    #[test]
    fn steuerzeichen_zaehlen_mit_ihrer_laenge_in_json() {
        let leer = erklaerung_mit_grund(String::new()).to_text().len();
        let zeichen = (austausch::ERKLAERUNG_MAX - leer) / 6 + 1;
        assert!(erklaerung_text(&erklaerung_mit_grund("\u{1}".repeat(zeichen))).is_err());
        assert!(erklaerung_text(&erklaerung_mit_grund("g".repeat(zeichen))).is_ok());
    }
}

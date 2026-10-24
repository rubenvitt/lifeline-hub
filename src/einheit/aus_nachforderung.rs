//! Eine eingetroffene Nachforderung als Einheit übernehmen (LLH-1383, Teil b zu LLH-1097,
//! design.md D2–D7, Spec `nachforderung-einheit`): je Zeile eine neue Einheit oder eine schon
//! geführte verknüpfen, auf Wunsch in den Bereitstellungsraum des Ziels buchen, genau ein
//! ETB-Eintrag mit Verweis auf die Nachforderung. Alles in der Transaktion des Aufrufers
//! (`routes::einsatz_einheit::aus_nachforderung`, `write_retry!`); Live meldet die Route nach dem
//! Commit.
//!
//! Der Storno einer Fehlübernahme ([`stornieren_tx`], LLH-1388, design.md D1–D6) nimmt genau das
//! zurück, was die Übernahme an einer Einheit getan hat: dafür hält sie fest, ob sie die Einheit
//! angelegt und welchen Eintritt sie gebucht hat (`nachforderung_angelegt`,
//! `nachforderung_belegung_id`, Migration 0246).

use crate::bereitstellungsraum::eintreffen::{self, normalize, Eintritt};
use crate::error::AppError;
use crate::nachforderung::{repo as nachforderung_repo, STATUS_EINGETROFFEN};
use crate::routes::support::pflicht_max;
use serde::Deserialize;
use sqlx::SqliteConnection;

/// Eine Zeile des Bodies: genau eines von `name` (neue Einheit) und `einheit_id` (verknüpfen).
#[derive(Debug, Default, Deserialize)]
pub struct ZeileEingabe {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub einheit_id: Option<i64>,
}

/// Geprüfte Zeile (design.md D3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Zeile {
    /// Neue Einheit; der Name ist zugleich ihr Funkrufname.
    Neu(String),
    /// Eine schon geführte Einheit des Einsatzes bekommt den Verweis.
    Bestehend(i64),
}

/// Feldprüfung vor jedem Lesen (400, design.md D2): mindestens eine, höchstens
/// [`crate::nachforderung::UEBERNAHME_EINHEITEN_MAX`] Zeilen (gezählt vor dem Entdoppeln), je Zeile
/// genau eines der beiden Felder, ein Name getrimmt und höchstens [`super::NAME_MAX`] Zeichen.
/// Entdoppelt in Eingabefolge: Namen nach [`normalize`], Kennungen gleich.
pub fn check_zeilen(roh: &[ZeileEingabe]) -> Result<Vec<Zeile>, AppError> {
    let max = crate::nachforderung::UEBERNAHME_EINHEITEN_MAX;
    if roh.is_empty() {
        return Err(AppError::Validation(
            "Mindestens eine Einheit angeben".into(),
        ));
    }
    if roh.len() > max {
        return Err(AppError::Validation(format!(
            "Höchstens {max} Einheiten je Übernahme"
        )));
    }
    let mut zeilen: Vec<Zeile> = Vec::with_capacity(roh.len());
    for z in roh {
        let zeile = match (&z.name, z.einheit_id) {
            (Some(name), None) => Zeile::Neu(pflicht_max(name, "Name", super::NAME_MAX)?),
            (None, Some(id)) => Zeile::Bestehend(id),
            _ => {
                return Err(AppError::Validation(
                    "Je Einheit entweder einen Namen oder eine bestehende Einheit angeben".into(),
                ))
            }
        };
        let doppelt = zeilen.iter().any(|g| match (g, &zeile) {
            (Zeile::Neu(a), Zeile::Neu(b)) => normalize(a) == normalize(b),
            (Zeile::Bestehend(a), Zeile::Bestehend(b)) => a == b,
            _ => false,
        });
        if !doppelt {
            zeilen.push(zeile);
        }
    }
    Ok(zeilen)
}

/// Rahmen einer Übernahme: wer, woraus, wohin.
#[derive(Debug, Clone, Copy)]
pub struct Rahmen<'a> {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub benutzer_id: i64,
    pub nachforderung_id: i64,
    /// Einheitstyp der neuen Einheiten; `anlegen_tx` prüft ihn.
    pub typ_id: Option<i64>,
    /// In den Bereitstellungsraum des Ziels buchen (D5).
    pub in_bereitstellungsraum: bool,
    /// „Jetzt“ (DB-Format, UTC), Eingang der Buchung.
    pub jetzt: &'a str,
    /// ETB-Startwert des Einsatzes (vor der Transaktion gelesen).
    pub etb_startwert: i64,
}

/// Was die Übernahme geschrieben hat, für Antwort und Live nach dem Commit (D12).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Uebernommen {
    /// Die übernommenen Einheiten in Zeilenfolge.
    pub einheit_ids: Vec<i64>,
    /// Die Räume, in die gebucht wurde: der des Ziels und die, in denen ein überführtes Fahrzeug
    /// stand (LLH-1448); leer ohne Buchung.
    pub br_ids: Vec<i64>,
    /// Die Fahrzeuge, die dabei zur Einheit wurden (LLH-1448).
    pub fahrzeug_ids: Vec<i64>,
    /// Der eine ETB-Eintrag (D6).
    pub etb_id: i64,
    pub personen: Vec<i64>,
    pub abloesung: Vec<i64>,
    pub hinweise: Vec<crate::benachrichtigung::Anlass>,
}

/// ETB-Wortlaut (D6): „Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord
/// eingetroffen“; ist nur ein Teil gebucht, „…, im BR Nord eingetroffen: 83-1“; ohne Buchung ohne
/// Zusatz. `raum` ist die Bezeichnung des Raums und die gebuchten Namen. Ein überführtes Fahrzeug
/// steht in `namen` als „RTW 2 aus Fahrzeug“, seine mitgekommene Besatzung am Ende
/// („…, Besatzung: Anna“, LLH-1448, Change `o659va5r-nachforderung-herkunft` D6).
pub fn etb_text(
    kurz: &str,
    namen: &[String],
    raum: Option<(&str, &[String])>,
    besatzung: &[String],
) -> String {
    let wort = if namen.len() == 1 {
        "als Einheit übernommen"
    } else {
        "als Einheiten übernommen"
    };
    let mut text = format!("Nachforderung {kurz}: {wort} ({})", namen.join(", "));
    if let Some((bezeichnung, gebucht)) = raum {
        if gebucht.len() == namen.len() {
            text.push_str(&format!(", im BR {bezeichnung} eingetroffen"));
        } else if !gebucht.is_empty() {
            text.push_str(&format!(
                ", im BR {bezeichnung} eingetroffen: {}",
                gebucht.join(", ")
            ));
        }
    }
    if !besatzung.is_empty() {
        text.push_str(&format!(", Besatzung: {}", besatzung.join(", ")));
    }
    text
}

/// Die Übernahme in der Transaktion des Aufrufers (D2 Schritt 4). Fehlerfolge: Nachforderung
/// fremd 404, nicht eingetroffen 422, mehr Einheiten als die Anzahl 422, Raum gewünscht ohne Ziel
/// Raum 422, Raum nicht belegbar 404/422, Name schon im Einsatz 422 (außer als genau ein Fahrzeug
/// ohne Einheit: das wird zur Einheit, LLH-1448), bestehende Einheit fremd 404, aufgelöst oder
/// schon übernommen 409. Ein Fehler rollt alles zurück.
pub async fn uebernehmen_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    zeilen: &[Zeile],
) -> Result<Uebernommen, AppError> {
    // 1. Die Nachforderung in der Transaktion: Status und Anzahl kippen sonst zwischen Prüfung
    // und Schreiben (Muster `check_uebernahme_tx`, LLH-1226 D2).
    let (status, art, anzahl, ziel_br_id, eingetroffen_at): (
        String,
        String,
        Option<i64>,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT status, art, anzahl, ziel_br_id, eingetroffen_at FROM nachforderung \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(r.nachforderung_id)
    .bind(r.einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if status != STATUS_EINGETROFFEN {
        return Err(AppError::UnprocessableEntity(
            "Einheiten werden erst nach dem Eintreffen übernommen".into(),
        ));
    }
    // 2. Menge (D4): bestehende Verknüpfungen und neue zusammen höchstens die Anzahl.
    if let Some(a) = anzahl {
        let bestehend: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND nachforderung_id = ?",
        )
        .bind(r.einsatz_id)
        .bind(r.nachforderung_id)
        .fetch_one(&mut *conn)
        .await?;
        let neu = i64::try_from(zeilen.len()).unwrap_or(i64::MAX);
        if bestehend.saturating_add(neu) > a {
            let rest = (a - bestehend).max(0);
            return Err(AppError::UnprocessableEntity(format!(
                "Die Nachforderung umfasst {a}; übernommen sind {bestehend}, höchstens {rest} weitere"
            )));
        }
    }
    // 3. Raum (D5): nur mit Ziel Raum, belegbar in derselben Transaktion.
    let raum = match (r.in_bereitstellungsraum, ziel_br_id) {
        (false, _) => None,
        (true, None) => {
            return Err(AppError::UnprocessableEntity(
                "Die Nachforderung hat keinen Bereitstellungsraum als Ziel".into(),
            ))
        }
        (true, Some(br_id)) => Some(
            crate::bereitstellungsraum::belegung_repo::require_belegbar_tx(
                &mut *conn,
                r.einsatz_id,
                br_id,
            )
            .await?,
        ),
    };
    // 4. Neue Namen gibt es nicht zweimal im Einsatz (D3); ein gleichnamiges Fahrzeug ohne
    // Einheit wird zur Einheit (LLH-1448, D4).
    let neue: Vec<&str> = zeilen
        .iter()
        .filter_map(|z| match z {
            Zeile::Neu(n) => Some(n.as_str()),
            Zeile::Bestehend(_) => None,
        })
        .collect();
    let mut fahrzeuge = eintreffen::check_namen_uebernahme_tx(&mut *conn, r.einsatz_id, &neue)
        .await?
        .into_iter();

    // 5. Anlegen bzw. verknüpfen, in Zeilenfolge.
    let mut ergebnis = Uebernommen::default();
    let mut einheiten: Vec<Uebernahme> = Vec::with_capacity(zeilen.len());
    let mut besatzung: Vec<String> = Vec::new();
    for zeile in zeilen {
        let angelegt = matches!(zeile, Zeile::Neu(_));
        let mut u = match zeile {
            Zeile::Neu(name) => match fahrzeuge.next().flatten() {
                Some(ef_id) => {
                    let (u, mit) = ueberfuehren_tx(&mut *conn, r, ef_id, &mut ergebnis).await?;
                    besatzung.extend(mit);
                    u
                }
                None => {
                    let id = super::repo::anlegen_tx(
                        &mut *conn,
                        r.einsatz_id,
                        r.org_id,
                        &super::repo::EinheitDaten {
                            name,
                            abschnitt_id: None,
                            ueber_einheit_id: None,
                            typ_id: r.typ_id,
                            soll_fuehrer: None,
                            soll_unterfuehrer: None,
                            soll_mannschaft: None,
                            bemerkung: None,
                            funkrufname: Some(name),
                            sortier: 0,
                            tz_fachaufgabe: None,
                            tz_organisation: None,
                        },
                        r.benutzer_id,
                    )
                    .await?;
                    Uebernahme::neu(id, name.clone())
                }
            },
            Zeile::Bestehend(id) => {
                super::repo::require_aktiv_tx(&mut *conn, r.einsatz_id, *id).await?;
                let (name, verweis, aktueller_br): (String, Option<i64>, Option<i64>) =
                    sqlx::query_as(
                        "SELECT name, nachforderung_id, aktueller_br_id FROM einsatz_einheit \
                         WHERE id = ? AND einsatz_id = ?",
                    )
                    .bind(id)
                    .bind(r.einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
                if verweis.is_some() {
                    return Err(AppError::Conflict(format!(
                        "«{name}» ist schon aus einer Nachforderung übernommen"
                    )));
                }
                Uebernahme {
                    aktueller_br,
                    ..Uebernahme::neu(*id, name)
                }
            }
        };
        // Mit der Herkunft ihrer Wirkung (LLH-1388 D2): angelegt oder verknüpft.
        sqlx::query(
            "UPDATE einsatz_einheit SET nachforderung_id = ?, nachforderung_angelegt = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(r.nachforderung_id)
        .bind(angelegt)
        .bind(u.id)
        .bind(r.einsatz_id)
        .execute(&mut *conn)
        .await?;
        // Ein überführtes Fahrzeug, das in einem Raum stand: die Einheit tritt dort ein (D5).
        if let Some(platz) = u.platz.take() {
            eintritt_tx(
                &mut *conn,
                r,
                u.id,
                platz.br_id,
                &platz.zeitpunkt,
                &mut ergebnis,
            )
            .await?;
            u.aktueller_br = Some(platz.br_id);
        }
        einheiten.push(u);
    }

    // 6. Buchen (D5): wer schon in einem Raum steht, bleibt dort.
    ergebnis.einheit_ids = einheiten.iter().map(|u| u.id).collect();
    let mut gebucht: Vec<String> = Vec::new();
    if let Some(br) = &raum {
        let zeitpunkt = eingetroffen_at.as_deref().unwrap_or(r.jetzt);
        for u in &einheiten {
            if u.aktueller_br.is_some() {
                continue;
            }
            eintritt_tx(&mut *conn, r, u.id, br.id, zeitpunkt, &mut ergebnis).await?;
            gebucht.push(u.name.clone());
        }
        if !ergebnis.br_ids.contains(&br.id) {
            ergebnis.br_ids.push(br.id);
        }
    }

    // 7. Genau ein ETB-Eintrag mit Verweis auf die Nachforderung (D6).
    let namen: Vec<String> = einheiten
        .iter()
        .map(|u| {
            if u.aus_fahrzeug {
                format!("{} aus Fahrzeug", u.name)
            } else {
                u.name.clone()
            }
        })
        .collect();
    let text = etb_text(
        &nachforderung_repo::kurzname(anzahl, &art),
        &namen,
        raum.as_ref()
            .map(|b| (b.bezeichnung.as_str(), gebucht.as_slice())),
        &besatzung,
    );
    ergebnis.etb_id =
        nachforderung_repo::protokollieren_tx(conn, r.nachforderung_id, r.benutzer_id, &text)
            .await?;
    ergebnis.personen.sort_unstable();
    ergebnis.personen.dedup();
    Ok(ergebnis)
}

/// Eine Einheit der Übernahme auf dem Weg durch die Schritte 5–7.
struct Uebernahme {
    id: i64,
    name: String,
    /// Der Raum, in dem sie schon steht; wer dort steht, bleibt (D5).
    aktueller_br: Option<i64>,
    /// Aus einem gleichnamigen Fahrzeug ohne Einheit entstanden (LLH-1448).
    aus_fahrzeug: bool,
    /// Der Raum des überführten Fahrzeugs und sein Eintrittszeitpunkt, bis die Einheit dort
    /// eintritt.
    platz: Option<Platz>,
}

struct Platz {
    br_id: i64,
    zeitpunkt: String,
}

impl Uebernahme {
    fn neu(id: i64, name: String) -> Self {
        Self {
            id,
            name,
            aktueller_br: None,
            aus_fahrzeug: false,
            platz: None,
        }
    }
}

/// Macht ein gleichnamiges Fahrzeug ohne Einheit zur Einheit (LLH-1448, Change
/// `o659va5r-nachforderung-herkunft` D5): Prüfung des Fahrzeugs (fremd 404, beendet oder einer
/// Einheit zugehörig 409), steht es in einem Raum, sein Austritt „Als Einheit übernommen“ mit dem
/// Zeitpunkt seines jüngsten Belegungsereignisses für den Eintritt der Einheit, dann die Überführung
/// mit dem Typ der Übernahme. Liefert die Einheit und die Namen der mitgekommenen Besatzung.
async fn ueberfuehren_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    ef_id: i64,
    ergebnis: &mut Uebernommen,
) -> Result<(Uebernahme, Vec<String>), AppError> {
    use crate::bereitstellungsraum::belegung_repo;
    let platz = match belegung_repo::einheitenloses_fahrzeug_br_tx(&mut *conn, r.einsatz_id, ef_id)
        .await?
    {
        Some(br_id) => {
            let zeitpunkt: String = sqlx::query_scalar(
                "SELECT zeitpunkt_at FROM br_belegung \
                 WHERE einsatz_id = ? AND objekt_typ = 'fahrzeug' AND objekt_id = ? \
                 ORDER BY id DESC LIMIT 1",
            )
            .bind(r.einsatz_id)
            .bind(ef_id)
            .fetch_one(&mut *conn)
            .await?;
            belegung_repo::austritt_fahrzeug_tx(
                &mut *conn,
                r.einsatz_id,
                ef_id,
                r.benutzer_id,
                "Als Einheit übernommen",
            )
            .await?;
            Some(Platz { br_id, zeitpunkt })
        }
        None => None,
    };
    let (id, name, besatzung) = eintreffen::fahrzeug_zur_einheit_tx(
        conn,
        r.einsatz_id,
        r.org_id,
        r.benutzer_id,
        ef_id,
        r.typ_id,
    )
    .await?;
    ergebnis.fahrzeug_ids.push(ef_id);
    ergebnis
        .personen
        .extend(besatzung.iter().map(|(id, _)| *id));
    Ok((
        Uebernahme {
            aus_fahrzeug: true,
            platz,
            ..Uebernahme::neu(id, name)
        },
        besatzung.into_iter().map(|(_, n)| n).collect(),
    ))
}

/// Eintritt einer übernommenen Einheit in den Raum `br_id` zum Zeitpunkt `zeitpunkt` (D5): der
/// Storno bucht genau diesen Eintritt wieder aus (LLH-1388 D3); was gemeldet wird, sammelt
/// `ergebnis`.
async fn eintritt_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    einheit_id: i64,
    br_id: i64,
    zeitpunkt: &str,
    ergebnis: &mut Uebernommen,
) -> Result<(), AppError> {
    let rahmen = eintreffen::Rahmen {
        einsatz_id: r.einsatz_id,
        org_id: r.org_id,
        br_id,
        benutzer_id: r.benutzer_id,
        zeitpunkt_at: zeitpunkt,
        eingang_at: r.jetzt,
        client_id: None,
        etb_startwert: r.etb_startwert,
    };
    let Eintritt {
        belegung_id,
        personen,
        abloesung,
        hinweise,
        ..
    } = eintreffen::eintritt_einheit_tx(&mut *conn, &rahmen, einheit_id).await?;
    sqlx::query(
        "UPDATE einsatz_einheit SET nachforderung_belegung_id = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(belegung_id)
    .bind(einheit_id)
    .bind(r.einsatz_id)
    .execute(&mut *conn)
    .await?;
    if !ergebnis.br_ids.contains(&br_id) {
        ergebnis.br_ids.push(br_id);
    }
    ergebnis.personen.extend(personen);
    ergebnis.abloesung.extend(abloesung);
    ergebnis.hinweise.extend(hinweise);
    Ok(())
}

/// ETB-Wortlaut des Stornos (LLH-1388 D3): „Nachforderung 2× RTW: Übernahme von 83-1 storniert,
/// aus BR Nord ausgetreten, Einheit aufgelöst“; ohne Austritt ohne den Mittelteil, bei einer
/// verknüpften Einheit „Verknüpfung gelöst“ statt „Einheit aufgelöst“.
pub fn etb_text_storniert(kurz: &str, name: &str, raum: Option<&str>, aufgeloest: bool) -> String {
    let mut text = format!("Nachforderung {kurz}: Übernahme von {name} storniert");
    if let Some(bezeichnung) = raum {
        text.push_str(&format!(", aus BR {bezeichnung} ausgetreten"));
    }
    text.push_str(if aufgeloest {
        ", Einheit aufgelöst"
    } else {
        ", Verknüpfung gelöst"
    });
    text
}

/// Was der Storno geschrieben hat, für Antwort und Live nach dem Commit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Storniert {
    pub nachforderung_id: i64,
    pub etb_id: i64,
    /// Der Raum, aus dem die Einheit ausgetreten ist.
    pub br_id: Option<i64>,
    /// Die angelegte Einheit wurde aufgelöst (bzw. ohne Spur gelöscht); `None` bei einer
    /// verknüpften, die aktiv bleibt.
    pub aufgeloest: Option<super::repo::Aufgeloest>,
}

/// Storno einer Fehlübernahme in der Transaktion des Aufrufers (LLH-1388, design.md D3): fremd
/// 404, aufgelöst 409, ohne Herkunft 422, gleichzeitig storniert 409. Verweis und Herkunft weg
/// (auch die Herkunft „am Raum“, LLH-1445);
/// eine angelegte Einheit wird aufgelöst wie im Normalweg (Austritt, Mitglieder frei, ohne Spur
/// gelöscht), eine verknüpfte verlässt nur den Raum, den die Übernahme gebucht hat, und nur, wenn
/// dieser Eintritt noch ihr jüngstes Belegungsereignis ist. Genau ein ETB-Eintrag mit Verweis auf
/// die Nachforderung.
pub async fn stornieren_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Storniert, AppError> {
    super::repo::require_aktiv_tx(&mut *conn, einsatz_id, einheit_id).await?;
    let (name, nachforderung_id, angelegt, belegung_id): (String, Option<i64>, bool, Option<i64>) =
        sqlx::query_as(
            "SELECT name, nachforderung_id, nachforderung_angelegt, nachforderung_belegung_id \
             FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(einheit_id)
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    let Some(nachforderung_id) = nachforderung_id else {
        return Err(AppError::UnprocessableEntity(
            "Die Einheit stammt aus keiner Nachforderung".into(),
        ));
    };
    let (art, anzahl): (String, Option<i64>) =
        sqlx::query_as("SELECT art, anzahl FROM nachforderung WHERE id = ? AND einsatz_id = ?")
            .bind(nachforderung_id)
            .bind(einsatz_id)
            .fetch_one(&mut *conn)
            .await?;
    let geloest = sqlx::query(
        "UPDATE einsatz_einheit SET nachforderung_id = NULL, nachforderung_angelegt = 0, \
             nachforderung_belegung_id = NULL, nachforderung_am_raum = 0 \
         WHERE id = ? AND einsatz_id = ? AND nachforderung_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .bind(nachforderung_id)
    .execute(&mut *conn)
    .await?;
    if geloest.rows_affected() == 0 {
        return Err(AppError::Conflict(
            "Die Übernahme ist schon storniert".into(),
        ));
    }

    let (br_id, aufgeloest) = if angelegt {
        let a = super::repo::aufloesen_tx(
            &mut *conn,
            einsatz_id,
            einheit_id,
            benutzer_id,
            jetzt,
            super::repo::Aufloesung::Aufloesen,
        )
        .await?;
        (a.br, Some(a))
    } else {
        (
            austritt_gebucht_tx(&mut *conn, einsatz_id, einheit_id, benutzer_id, belegung_id)
                .await?,
            None,
        )
    };
    let raum: Option<String> = match br_id {
        Some(br) => Some(
            sqlx::query_scalar("SELECT bezeichnung FROM bereitstellungsraum WHERE id = ?")
                .bind(br)
                .fetch_one(&mut *conn)
                .await?,
        ),
        None => None,
    };
    let text = etb_text_storniert(
        &nachforderung_repo::kurzname(anzahl, &art),
        &name,
        raum.as_deref(),
        angelegt,
    );
    let etb_id =
        nachforderung_repo::protokollieren_tx(conn, nachforderung_id, benutzer_id, &text).await?;
    Ok(Storniert {
        nachforderung_id,
        etb_id,
        br_id,
        aufgeloest,
    })
}

/// Bucht eine verknüpfte Einheit aus dem Raum aus, in den die Übernahme sie gebucht hat — nur,
/// wenn dieser Eintritt noch ihr jüngstes Belegungsereignis ist (seitdem gewechselt, abgerufen
/// oder ausgetreten: ihr Ort bleibt, design.md D3 Schritt 4).
async fn austritt_gebucht_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: i64,
    benutzer_id: i64,
    belegung_id: Option<i64>,
) -> Result<Option<i64>, AppError> {
    let Some(belegung_id) = belegung_id else {
        return Ok(None);
    };
    let juengstes: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(id) FROM br_belegung \
         WHERE einsatz_id = ? AND objekt_typ = 'einheit' AND objekt_id = ?",
    )
    .bind(einsatz_id)
    .bind(einheit_id)
    .fetch_one(&mut *conn)
    .await?;
    if juengstes != Some(belegung_id) {
        return Ok(None);
    }
    crate::bereitstellungsraum::belegung_repo::austritt_einheit_tx(
        conn,
        einsatz_id,
        einheit_id,
        benutzer_id,
        "Übernahme storniert",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn neu(name: &str) -> ZeileEingabe {
        ZeileEingabe {
            name: Some(name.into()),
            einheit_id: None,
        }
    }

    #[test]
    fn zeilen_werden_getrimmt_und_entdoppelt() {
        let zeilen = check_zeilen(&[
            neu(" 83-1 "),
            neu("83-1"),
            neu("Florian  83-2"),
            neu("florian 83-2"),
            ZeileEingabe {
                name: None,
                einheit_id: Some(7),
            },
            ZeileEingabe {
                name: None,
                einheit_id: Some(7),
            },
        ])
        .unwrap();
        assert_eq!(
            zeilen,
            vec![
                Zeile::Neu("83-1".into()),
                Zeile::Neu("Florian  83-2".into()),
                Zeile::Bestehend(7)
            ]
        );
    }

    #[test]
    fn zeilen_pruefen_jedes_feld_fuer_sich() {
        for roh in [
            vec![],
            vec![neu("   ")],
            vec![ZeileEingabe::default()],
            vec![ZeileEingabe {
                name: Some("83-1".into()),
                einheit_id: Some(3),
            }],
            vec![neu(&"x".repeat(super::super::NAME_MAX + 1))],
            (0..=crate::nachforderung::UEBERNAHME_EINHEITEN_MAX)
                .map(|_| neu("83-1"))
                .collect(),
        ] {
            assert!(
                matches!(check_zeilen(&roh), Err(AppError::Validation(_))),
                "{roh:?}"
            );
        }
    }

    #[test]
    fn etb_text_nennt_einheiten_und_raum() {
        let namen = vec!["83-1".to_string(), "83-2".to_string()];
        assert_eq!(
            etb_text("2× RTW", &namen, None, &[]),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2)"
        );
        assert_eq!(
            etb_text("2× RTW", &namen, Some(("Nord", namen.as_slice())), &[]),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord eingetroffen"
        );
        assert_eq!(
            etb_text("2× RTW", &namen, Some(("Nord", &namen[..1])), &[]),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord \
             eingetroffen: 83-1"
        );
        assert_eq!(
            etb_text("RTW", &namen[..1], Some(("Nord", &[])), &[]),
            "Nachforderung RTW: als Einheit übernommen (83-1)"
        );
        // LLH-1448 D6: ein überführtes Fahrzeug und seine Besatzung.
        let ueberfuehrt = vec!["RTW 2 aus Fahrzeug".to_string()];
        assert_eq!(
            etb_text(
                "2× RTW",
                &ueberfuehrt,
                Some(("Nord", &[])),
                &["Anna".to_string(), "Berta".to_string()]
            ),
            "Nachforderung 2× RTW: als Einheit übernommen (RTW 2 aus Fahrzeug), Besatzung: Anna, \
             Berta"
        );
    }

    #[test]
    fn etb_text_des_stornos_nennt_raum_und_folge() {
        assert_eq!(
            etb_text_storniert("2× RTW", "83-1", Some("Nord"), true),
            "Nachforderung 2× RTW: Übernahme von 83-1 storniert, aus BR Nord ausgetreten, \
             Einheit aufgelöst"
        );
        assert_eq!(
            etb_text_storniert("2× RTW", "83-1", None, true),
            "Nachforderung 2× RTW: Übernahme von 83-1 storniert, Einheit aufgelöst"
        );
        assert_eq!(
            etb_text_storniert("RTW", "83-2", None, false),
            "Nachforderung RTW: Übernahme von 83-2 storniert, Verknüpfung gelöst"
        );
    }
}

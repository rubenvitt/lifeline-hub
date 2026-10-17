//! Text einer Benachrichtigung, beim Lesen gebildet (design.md D1: keine Textspalte).
//!
//! Je Art ein Titel (Wortlaut der Spec), je Bezug eine Detailzeile und ein Sprungpfad. Die
//! Detailzeile liest **nur Retain-Spalten** der Schwärzungs-Registry (Nummern, Enums,
//! operative Labels), nie einen Scrub-Wert (`src/AGENTS.md`, Aufbewahrung, Scrub-Werte): Guard
//! `detail_liest_nur_retain_spalten`. Spätere Teilaufgaben verfeinern hier die Texte ihrer Art.

use super::{BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::kommunikation::AdressatKategorie;
use crate::nachforderung::NachforderungStatus;
use sqlx::SqlitePool;

/// Der Text, den der Toast zeigt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Text {
    pub titel: String,
    pub detail: Option<String>,
    pub pfad: String,
}

/// Überschrift je Art (Spec `benachrichtigungen`, Wortlaut der Szenarien).
pub const fn titel(art: BenachrichtigungArt) -> &'static str {
    match art {
        BenachrichtigungArt::Sofortmeldung => "Sofortmeldung eingegangen",
        BenachrichtigungArt::SofortmeldungEskaliert => "Bestätigung ausstehend",
        BenachrichtigungArt::AuftragUeberfaellig => "Auftrag überfällig",
        BenachrichtigungArt::AbloesungFaellig => "Ablösung fällig",
        BenachrichtigungArt::ErinnerungFaellig => "Erinnerung fällig",
        BenachrichtigungArt::AbloesungVorwarnung => "Ablösung steht an",
        BenachrichtigungArt::AbloesungPlanung => "Keine ablösende Einheit geplant",
        // Der Titel einer einzelnen Benachrichtigung kommt aus ihrem Bezug
        // ([`abloeser_titel`]); dieser steht für die Art als Ganzes.
        BenachrichtigungArt::AbloesungAbloeser => "Ablösende Einheit",
        BenachrichtigungArt::AuftragErteilt => "Neuer Auftrag",
        BenachrichtigungArt::AuftragQuittiert => "Auftrag quittiert",
        BenachrichtigungArt::AuftragErledigt => "Auftrag erledigt",
        BenachrichtigungArt::Befehl => "Neuer Befehl",
        BenachrichtigungArt::Lagebericht => "Neuer Lagebericht",
        BenachrichtigungArt::Meldung => "Neue Meldung",
        BenachrichtigungArt::LagebesprechungVorher => "Lagebesprechung in 10 Minuten",
        BenachrichtigungArt::LagebesprechungFaellig => "Lagebesprechung jetzt fällig",
        BenachrichtigungArt::NachforderungStatus => "Status einer Nachforderung",
        BenachrichtigungArt::Gefahr => "Neue Gefahr",
        BenachrichtigungArt::SichtungEins => "Sichtung I",
        BenachrichtigungArt::WiederVerfuegbar => "Wieder verfügbar",
        BenachrichtigungArt::ChatErwaehnung => "Erwähnt im Chat",
        BenachrichtigungArt::EinsatzAufnahme => "Aufgenommen in einen Einsatz",
        BenachrichtigungArt::EinsatzNeu => "Neuer Einsatz",
        BenachrichtigungArt::Unwetter => "Unwetterwarnung",
    }
}

/// Woher die Detailzeile eines Bezugs kommt: Tabelle und eine Retain-Spalte. Die Zeile wird nur
/// gelesen, wenn sie zum Einsatz der Benachrichtigung gehört.
pub const fn detail_quelle(typ: BenachrichtigungBezugTyp) -> Option<(&'static str, &'static str)> {
    match typ {
        BenachrichtigungBezugTyp::Einsatz => Some(("einsatz", "bezeichnung")),
        BenachrichtigungBezugTyp::Meldung => Some(("meldung", "lfd_nr")),
        BenachrichtigungBezugTyp::Auftrag => Some(("auftrag", "lfd_nr")),
        BenachrichtigungBezugTyp::Nachforderung => Some(("nachforderung", "status")),
        BenachrichtigungBezugTyp::Person => Some(("einsatz_person", "registrier_nr")),
        BenachrichtigungBezugTyp::Einheit => Some(("einsatz_einheit", "name")),
        BenachrichtigungBezugTyp::Fahrzeug => Some(("einsatz_fahrzeug", "snap_funkrufname")),
        // Die Schicht hat keine eigene Bezeichnung: Einheit und Uhrzeit liest
        // `detail_abloesung` über [`DETAIL_ABLOESUNG_SPALTEN`].
        BenachrichtigungBezugTyp::Abloesung => None,
        // Beide Einheiten der Schicht: eigener Weg über `DETAIL_ABLOESER_SPALTEN`.
        BenachrichtigungBezugTyp::AbloeserAlarmiert
        | BenachrichtigungBezugTyp::AbloeserEingetroffen
        | BenachrichtigungBezugTyp::AbloeserBrEingetroffen
        | BenachrichtigungBezugTyp::AbloeserAbgerufen
        | BenachrichtigungBezugTyp::AbloeserEntfallen => None,
        // Der Dokumenttitel ist ein Scrub-Wert; die Version unterscheidet die Fortschreibungen.
        BenachrichtigungBezugTyp::Befehl => Some(("befehl", "version")),
        BenachrichtigungBezugTyp::Lagebericht => Some(("lagebericht", "version")),
        // Mehr als eine Spalte: eigener Weg über `AUFTRAG_EMPFAENGER_SPALTEN`.
        BenachrichtigungBezugTyp::AuftragEmpfaenger => None,
        // Mehr als eine Spalte: eigener Weg über `NACHFORDERUNG_SPALTEN`.
        BenachrichtigungBezugTyp::NachforderungZugesagt
        | BenachrichtigungBezugTyp::NachforderungUnterwegs
        | BenachrichtigungBezugTyp::NachforderungEingetroffen
        | BenachrichtigungBezugTyp::NachforderungAbgelehnt => None,
        // Titel und Freitexte dieser Objekte sind Scrub-Werte; ihr Titel genügt.
        BenachrichtigungBezugTyp::Erinnerung
        | BenachrichtigungBezugTyp::Lagebesprechung
        | BenachrichtigungBezugTyp::Gefahrengebiet
        | BenachrichtigungBezugTyp::ChatNachricht => None,
    }
}

/// Die Spalten der Detailzeile einer Ablösung, „Florian 1, 15:30“ (Spec `kraefte-abloesung`,
/// „Hinweis in der AlarmZentrale“): Name der Einheit und Fälligkeit der Schicht, beide Retain
/// (Guard `detail_liest_nur_retain_spalten`).
pub const DETAIL_ABLOESUNG_SPALTEN: [(&str, &str); 2] = [
    ("einsatz_einheit", "name"),
    ("einsatz_abloesung", "faellig_at"),
];

/// Detailzeile einer Ablösungsschicht: Einheit und Uhrzeit der Fälligkeit (auch bei der
/// Vorwarnung) in der Anzeigezone des Einsatzes, wie die Oberfläche sie zeigt (Einsatz, sonst
/// Organisation, sonst `einsatz::nummer::ZEITZONE_VORGABE`).
async fn detail_abloesung(
    pool: &SqlitePool,
    einsatz_id: i64,
    abloesung_id: i64,
) -> Result<Option<String>, AppError> {
    let zeile = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT ee.name, a.faellig_at, \
                COALESCE(NULLIF(TRIM(es.zeitzone), ''), oe.zeitzone) \
         FROM einsatz_abloesung a \
         JOIN einsatz_einheit ee ON ee.id = a.einheit_id \
         JOIN einsatz e ON e.id = a.einsatz_id \
         LEFT JOIN einsatz_einstellungen es ON es.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id \
         WHERE a.id = ? AND a.einsatz_id = ?",
    )
    .bind(abloesung_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(|(einheit, faellig_at, zone)| {
        let zone = crate::einsatz::nummer::zone_oder_vorgabe(zone.as_deref());
        match crate::zeit::parse_utc(&faellig_at) {
            Some(t) => format!("{einheit}, {}", t.with_timezone(&zone).format("%H:%M")),
            None => einheit,
        }
    }))
}

/// Titel eines Hinweises zur ablösenden Einheit (LLH-1131) aus seinem Bezug; `None` für jeden
/// anderen Bezug.
pub const fn abloeser_titel(typ: BenachrichtigungBezugTyp) -> Option<&'static str> {
    match typ {
        BenachrichtigungBezugTyp::AbloeserAlarmiert => Some("Ablösende Einheit alarmiert"),
        BenachrichtigungBezugTyp::AbloeserEingetroffen => Some("Ablösende Einheit eingetroffen"),
        BenachrichtigungBezugTyp::AbloeserBrEingetroffen => {
            Some("Ablösende Einheit im Bereitstellungsraum eingetroffen")
        }
        BenachrichtigungBezugTyp::AbloeserAbgerufen => Some("Ablösende Einheit abgerufen"),
        BenachrichtigungBezugTyp::AbloeserEntfallen => {
            Some("Planung der ablösenden Einheit entfallen")
        }
        _ => None,
    }
}

/// Die Spalten der Detailzeile eines Hinweises zur ablösenden Einheit, „Ablösung für
/// Rettungsstaffel: 2. Rettungsstaffel“: die Namen der abzulösenden und der geplanten Einheit
/// über die Verweise der Schicht, alle Retain (Guard `detail_liest_nur_retain_spalten`).
pub const DETAIL_ABLOESER_SPALTEN: [(&str, &str); 4] = [
    ("einsatz_einheit", "name"),
    ("einsatz_abloesung", "einheit_id"),
    ("einsatz_abloesung", "abloesende_einheit_id"),
    ("einsatz_abloesung", "einsatz_id"),
];

/// Die Abfrage der Detailzeile; liest nur [`DETAIL_ABLOESER_SPALTEN`].
pub const DETAIL_ABLOESER_SQL: &str = "SELECT e.name, ae.name FROM einsatz_abloesung a \
     JOIN einsatz_einheit e ON e.id = a.einheit_id \
     LEFT JOIN einsatz_einheit ae ON ae.id = a.abloesende_einheit_id \
     WHERE a.id = ? AND a.einsatz_id = ?";

/// Text eines Hinweises zur ablösenden Einheit: Titel aus dem Bezug, Detail „Ablösung für
/// Rettungsstaffel: 2. Rettungsstaffel“. Die geplante Einheit liest die Schicht beim Lesen (die
/// Zeile trägt keinen Text); ist die Planung inzwischen entfallen, nennt das Detail nur die
/// abzulösende Einheit.
async fn abloeser_text(
    pool: &SqlitePool,
    einsatz_id: i64,
    titel: &str,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let zeile: Option<(String, Option<String>)> = sqlx::query_as(DETAIL_ABLOESER_SQL)
        .bind(bezug.id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let detail = zeile.map(|(einheit, abloesende)| match abloesende {
        Some(a) if !a.trim().is_empty() => format!("Ablösung für {einheit}: {a}"),
        _ => format!("Ablösung für {einheit}"),
    });
    Ok(Text {
        titel: titel.to_string(),
        detail,
        pfad: pfad(einsatz_id, bezug),
    })
}

/// Formt den gelesenen Wert zur Detailzeile.
fn detail_formen(typ: BenachrichtigungBezugTyp, wert: String) -> String {
    match typ {
        BenachrichtigungBezugTyp::Meldung => format!("Meldung #{wert}"),
        BenachrichtigungBezugTyp::Auftrag => format!("Auftrag #{wert}"),
        BenachrichtigungBezugTyp::Befehl | BenachrichtigungBezugTyp::Lagebericht => {
            format!("Version {wert}")
        }
        BenachrichtigungBezugTyp::Nachforderung => format!("Status: {}", wert.replace('_', " ")),
        BenachrichtigungBezugTyp::Person => match wert.parse::<i64>() {
            Ok(nr) => format!("Person {}", crate::person::registrier_anzeige(nr)),
            Err(_) => format!("Person {wert}"),
        },
        _ => wert,
    }
}

/// Sprungziel im Frontend, gebaut wie die gleichnamigen Funktionen in
/// `frontend/src/routing/deeplinks.ts`.
pub fn pfad(einsatz_id: i64, bezug: Bezug) -> String {
    let basis = format!("/einsaetze/{einsatz_id}");
    let id = bezug.id;
    match bezug.typ {
        BenachrichtigungBezugTyp::Einsatz => basis,
        BenachrichtigungBezugTyp::Meldung => format!("{basis}/meldungen?meldung={id}"),
        BenachrichtigungBezugTyp::Auftrag => format!("{basis}/auftraege?auftrag={id}"),
        // Die Kennung ist die Empfänger-Zeile; den Auftrag setzt `bilden` ein, sobald es die
        // Zeile gelesen hat. Ohne Zeile bleibt die Liste.
        BenachrichtigungBezugTyp::AuftragEmpfaenger => format!("{basis}/auftraege"),
        BenachrichtigungBezugTyp::Befehl => format!("{basis}/auftraege/befehle/{id}"),
        BenachrichtigungBezugTyp::Lagebericht => format!("{basis}/lageberichte/{id}"),
        BenachrichtigungBezugTyp::Erinnerung => format!("{basis}/erinnerungen"),
        // Der Bezug ist immer die Schicht; die Seite springt zu ihr (LLH-1131 Teil II,
        // `abloesungPfad` in `frontend/src/routing/deeplinks.ts`).
        BenachrichtigungBezugTyp::Abloesung
        | BenachrichtigungBezugTyp::AbloeserAlarmiert
        | BenachrichtigungBezugTyp::AbloeserEingetroffen
        | BenachrichtigungBezugTyp::AbloeserBrEingetroffen
        | BenachrichtigungBezugTyp::AbloeserAbgerufen
        | BenachrichtigungBezugTyp::AbloeserEntfallen => format!("{basis}/abloesung?schicht={id}"),
        BenachrichtigungBezugTyp::Lagebesprechung => format!("{basis}/lagebesprechung"),
        BenachrichtigungBezugTyp::Nachforderung
        | BenachrichtigungBezugTyp::NachforderungZugesagt
        | BenachrichtigungBezugTyp::NachforderungUnterwegs
        | BenachrichtigungBezugTyp::NachforderungEingetroffen
        | BenachrichtigungBezugTyp::NachforderungAbgelehnt => format!("{basis}/nachforderungen"),
        BenachrichtigungBezugTyp::Gefahrengebiet => {
            format!("{basis}/lagekarte?gefahrengebiet={id}")
        }
        BenachrichtigungBezugTyp::Person => format!("{basis}/personen/{id}"),
        BenachrichtigungBezugTyp::Einheit => format!("{basis}/einheiten/{id}"),
        BenachrichtigungBezugTyp::Fahrzeug => format!("{basis}/fahrzeuge?fahrzeug={id}"),
        // Ohne gelesene Zeile der Chat; `bilden` setzt den Kanal der Nachricht ein.
        BenachrichtigungBezugTyp::ChatNachricht => format!("{basis}/chat"),
    }
}

/// Was der Sprung zu einer Chat-Nachricht liest (Erwähnung, LLH-1220): nur den Kanal, kein
/// Inhalt und kein Kanalname (Scrub-Werte). Guard
/// `sprung_zur_chat_nachricht_liest_nur_retain_spalten`.
pub const CHAT_NACHRICHT_SPALTEN: &[(&str, &str)] = &[
    ("chat_nachricht", "kanal_id"),
    ("chat_nachricht", "einsatz_id"),
];

/// Die Abfrage des Sprungs; liest nur [`CHAT_NACHRICHT_SPALTEN`].
pub const CHAT_NACHRICHT_SQL: &str =
    "SELECT kanal_id FROM chat_nachricht WHERE id = ? AND einsatz_id = ?";

/// Text zu einer Chat-Nachricht: ohne Detailzeile (Inhalt und Kanalname sind Scrub-Werte), der
/// Sprung öffnet den Kanal der Nachricht (`chatPfad` in `frontend/src/routing/deeplinks.ts`).
async fn chat_nachricht_text(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let kanal: Option<i64> = sqlx::query_scalar(CHAT_NACHRICHT_SQL)
        .bind(bezug.id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    Ok(Text {
        titel: titel(art).to_string(),
        detail: None,
        pfad: match kanal {
            Some(k) => format!("/einsaetze/{einsatz_id}/chat?kanal={k}"),
            None => pfad(einsatz_id, bezug),
        },
    })
}

/// Was die Detailzeile einer Empfänger-Zeile liest (Quittung, LLH-1212), als `(Tabelle,
/// Spalte)`: Nummer des Auftrags und der Empfänger über Katalogcode oder den operativen Namen von
/// Einheit, Abschnitt und Fahrzeug. Nie `snap_anzeige`, `funktion_text` oder
/// `extern_bezeichnung`: die sind Scrub-Werte und tragen bei einer Person ihren Namen. Der Guard
/// `detail_liest_nur_retain_spalten` prüft jede Spalte dieser Liste; die Abfrage in
/// [`auftrag_empfaenger_text`] liest keine andere.
pub const AUFTRAG_EMPFAENGER_SPALTEN: &[(&str, &str)] = &[
    ("auftrag_empfaenger", "auftrag_id"),
    ("auftrag_empfaenger", "empfaenger_typ"),
    ("auftrag_empfaenger", "funktion"),
    ("auftrag_empfaenger", "einheit_id"),
    ("auftrag_empfaenger", "abschnitt_id"),
    ("auftrag_empfaenger", "fahrzeug_id"),
    ("auftrag", "einsatz_id"),
    ("auftrag", "lfd_nr"),
    ("einsatz_einheit", "name"),
    ("einsatzabschnitt", "name"),
    ("einsatz_fahrzeug", "snap_funkrufname"),
];

/// Die Abfrage der Detailzeile einer Empfänger-Zeile; liest nur [`AUFTRAG_EMPFAENGER_SPALTEN`].
pub const AUFTRAG_EMPFAENGER_SQL: &str =
    "SELECT ae.auftrag_id, a.lfd_nr, ae.empfaenger_typ, ae.funktion, ee.name, ea.name, \
            ef.snap_funkrufname \
     FROM auftrag_empfaenger ae JOIN auftrag a ON a.id = ae.auftrag_id \
     LEFT JOIN einsatz_einheit ee ON ee.id = ae.einheit_id \
     LEFT JOIN einsatzabschnitt ea ON ea.id = ae.abschnitt_id \
     LEFT JOIN einsatz_fahrzeug ef ON ef.id = ae.fahrzeug_id \
     WHERE ae.id = ? AND a.einsatz_id = ?";

type EmpfaengerZeile = (
    i64,
    Option<i64>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Text zu einer Empfänger-Zeile: „Auftrag #12 an S2“, bei einer Person ohne Namen nur
/// „Auftrag #12“. Der Sprung führt zum Auftrag.
async fn auftrag_empfaenger_text(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let zeile: Option<EmpfaengerZeile> = sqlx::query_as(AUFTRAG_EMPFAENGER_SQL)
        .bind(bezug.id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let Some((auftrag_id, lfd_nr, typ, funktion, einheit, abschnitt, fahrzeug)) = zeile else {
        return Ok(Text {
            titel: titel(art).to_string(),
            detail: None,
            pfad: pfad(einsatz_id, bezug),
        });
    };
    let empfaenger = match (
        typ.as_str(),
        funktion.as_deref().and_then(Fuehrungsfunktion::parse),
    ) {
        ("funktion", Some(f)) => match f.kuerzel() {
            Some(k) => Some(k.to_string()),
            // Führungshilfspersonal und Fachberater: das wirksame Label, ohne die Bezeichnung
            // (`funktion_text` ist ein Scrub-Wert).
            None => {
                let mut conn = pool.acquire().await?;
                let karte =
                    crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut conn, einsatz_id).await?;
                Some(karte.label(f).to_string())
            }
        },
        ("einheit", _) => einheit,
        ("abschnitt", _) => abschnitt,
        ("fahrzeug", _) => fahrzeug,
        _ => None,
    }
    .filter(|n| !n.trim().is_empty());
    let auftrag = match lfd_nr {
        Some(nr) => format!("Auftrag #{nr}"),
        None => "Auftrag".to_string(),
    };
    Ok(Text {
        titel: titel(art).to_string(),
        detail: Some(match empfaenger {
            Some(e) => format!("{auftrag} an {e}"),
            None => auftrag,
        }),
        pfad: pfad(
            einsatz_id,
            Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id),
        ),
    })
}

/// Der Status, den ein Nachforderungs-Bezug trägt (LLH-1216); `None` für jeden anderen Bezug.
/// Gegenstück: `nachforderung::benachrichtigung::bezug_typ`.
pub const fn nachforderung_status(typ: BenachrichtigungBezugTyp) -> Option<NachforderungStatus> {
    match typ {
        BenachrichtigungBezugTyp::NachforderungZugesagt => Some(NachforderungStatus::Zugesagt),
        BenachrichtigungBezugTyp::NachforderungUnterwegs => Some(NachforderungStatus::Unterwegs),
        BenachrichtigungBezugTyp::NachforderungEingetroffen => {
            Some(NachforderungStatus::Eingetroffen)
        }
        BenachrichtigungBezugTyp::NachforderungAbgelehnt => Some(NachforderungStatus::Abgelehnt),
        _ => None,
    }
}

/// Was die Detailzeile eines Nachforderungs-Status liest, als `(Tabelle, Spalte)`: Anzahl und
/// Adressat-Kategorie. Nie `art`, `bezeichnung`, `adressat_bezeichnung`, `begruendung` oder
/// `abgelehnt_grund`: das sind Scrub-Werte (Führungs-Freitexte). Deshalb steht „2 RTW“ aus der
/// Spec hier als „2× an Leitstelle“. Der Guard
/// `detail_der_nachforderung_liest_nur_retain_spalten` prüft jede Spalte dieser Liste; die
/// Abfrage [`NACHFORDERUNG_SQL`] liest keine andere.
pub const NACHFORDERUNG_SPALTEN: &[(&str, &str)] = &[
    ("nachforderung", "anzahl"),
    ("nachforderung", "adressat_kategorie"),
];

/// Die Abfrage der Detailzeile eines Nachforderungs-Status; liest nur [`NACHFORDERUNG_SPALTEN`].
pub const NACHFORDERUNG_SQL: &str =
    "SELECT anzahl, adressat_kategorie FROM nachforderung WHERE id = ? AND einsatz_id = ?";

/// Anzeigelabel der Adressat-Kategorie, wie die Karte der Nachforderung es zeigt
/// (`ADRESSAT_LABEL` in `frontend/src/nachforderungen/NachforderungKarte.tsx`).
const fn adressat_label(k: AdressatKategorie) -> &'static str {
    match k {
        AdressatKategorie::Leitstelle => "Leitstelle",
        AdressatKategorie::NachbarEa => "Nachbar-EA",
        AdressatKategorie::Uebergeordnet => "Übergeordnete Führung",
        AdressatKategorie::AndereBos => "Andere BOS",
    }
}

/// Text zu einem Nachforderungs-Status: Titel „Nachforderung eingetroffen“ mit dem Status aus
/// dem Bezug, Detail „2× an Leitstelle“. Eine gelöschte Nachforderung lässt das Detail weg.
async fn nachforderung_text(
    pool: &SqlitePool,
    einsatz_id: i64,
    status: NachforderungStatus,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let zeile: Option<(Option<i64>, String)> = sqlx::query_as(NACHFORDERUNG_SQL)
        .bind(bezug.id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let detail = zeile.map(|(anzahl, kategorie)| {
        let an = match AdressatKategorie::parse(&kategorie) {
            Some(k) => adressat_label(k).to_string(),
            None => kategorie,
        };
        match anzahl {
            Some(n) => format!("{n}× an {an}"),
            None => format!("an {an}"),
        }
    });
    Ok(Text {
        titel: format!("Nachforderung {}", status.as_str()),
        detail,
        pfad: pfad(einsatz_id, bezug),
    })
}

/// Bildet den Text einer Benachrichtigung. Ein gelöschter Bezug lässt nur die Detailzeile weg.
pub async fn bilden(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    if bezug.typ == BenachrichtigungBezugTyp::AuftragEmpfaenger {
        return auftrag_empfaenger_text(pool, einsatz_id, art, bezug).await;
    }
    if let Some(status) = nachforderung_status(bezug.typ) {
        return nachforderung_text(pool, einsatz_id, status, bezug).await;
    }
    if bezug.typ == BenachrichtigungBezugTyp::ChatNachricht {
        return chat_nachricht_text(pool, einsatz_id, art, bezug).await;
    }
    if let Some(titel) = abloeser_titel(bezug.typ) {
        return abloeser_text(pool, einsatz_id, titel, bezug).await;
    }
    let detail = match detail_quelle(bezug.typ) {
        None if bezug.typ == BenachrichtigungBezugTyp::Abloesung => {
            detail_abloesung(pool, einsatz_id, bezug.id).await?
        }
        None => None,
        Some((tabelle, spalte)) => {
            // Tabelle und Spalte sind Konstanten aus `detail_quelle`, nie Eingaben.
            let sql = if tabelle == "einsatz" {
                format!("SELECT CAST({spalte} AS TEXT) FROM einsatz WHERE id = ? AND id = ?")
            } else {
                format!(
                    "SELECT CAST({spalte} AS TEXT) FROM {tabelle} WHERE id = ? AND einsatz_id = ?"
                )
            };
            let wert: Option<Option<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .bind(bezug.id)
                .bind(einsatz_id)
                .fetch_optional(pool)
                .await?;
            wert.flatten()
                .filter(|w| !w.trim().is_empty())
                .map(|w| detail_formen(bezug.typ, w))
        }
    };
    // Die Aufnahme nennt den Einsatz im Titel („Aufgenommen in Hochwasser“, Spec „Aufnahme in
    // einen Einsatz“); die Detailzeile wiederholte ihn nur. Ohne Bezeichnung bleibt der Titel
    // der Art.
    if art == BenachrichtigungArt::EinsatzAufnahme && bezug.typ == BenachrichtigungBezugTyp::Einsatz
    {
        if let Some(name) = detail {
            return Ok(Text {
                titel: format!("Aufgenommen in {name}"),
                detail: None,
                pfad: pfad(einsatz_id, bezug),
            });
        }
    }
    Ok(Text {
        titel: titel(art).to_string(),
        detail,
        pfad: pfad(einsatz_id, bezug),
    })
}

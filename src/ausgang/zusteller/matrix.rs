//! Zustellung in Matrix-Räume (LLH-2094, Spec
//! `docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`, Abschnitte 6 und 7).
//!
//! Je Versand, unter der Sperre des Clients der Anbindung (`adapter::matrix::Clients`): Raum
//! auflösen (Alias → Raum-ID), beitreten, falls der Bot noch nicht Mitglied ist, ein `sync_once`
//! nur für diesen Raum mit vollem Zustand (die Verbindungsprüfung synct ohne Räume und rückt den
//! gemeinsamen Sync-Stand vor; ein inkrementeller Sync brächte den Zustand des Raums nicht), die
//! Mitgliederliste laden (Geräte aller Mitglieder), dann der Text (`ausgang-{id}-0`) und jede
//! PNG-Anlage als `m.image` (`ausgang-{id}-{n}`). Schon gemerkte Teile ([`Versandauftrag::gesendet`])
//! gehen nicht noch einmal hinaus; die feste Transaktions-ID deckt die Lücke zwischen Senden und
//! Merken. Ist der Raum verschlüsselt, verschlüsselt das SDK für alle Geräte der Mitglieder
//! (`CollectStrategy::AllDevices` am Client); scheitert das, scheitert der Versand, nie geht
//! Klartext hinaus. Ein Abbruch mitten im Senden ist vorübergehend, nie `ungewiss`.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use matrix_sdk::attachment::{AttachmentConfig, AttachmentInfo, BaseImageInfo};
use matrix_sdk::config::SyncSettings;
use matrix_sdk::ruma::api::client::filter::{
    Filter, FilterDefinition, RoomEventFilter, RoomFilter,
};
use matrix_sdk::ruma::api::client::sync::sync_events::v3::Filter as SyncFilter;
use matrix_sdk::ruma::events::room::message::{FormattedBody, RoomMessageEventContent};
use matrix_sdk::ruma::{
    OwnedEventId, OwnedRoomId, OwnedRoomOrAliasId, OwnedServerName, OwnedTransactionId, RoomId,
    RoomOrAliasId, UInt,
};
use matrix_sdk::RoomState;

use super::{kanal_nicht_bedient, Fehlschlag, Versandauftrag, Zusteller, Zustellfehler, Zustellt};
use crate::adapter::matrix::{http_fehler, sdk_fehler, Clients, MatrixFehler};
use crate::adapter::matrix_art::matrix_ziel;
use crate::externe_stelle::KanalArt;
use futures::future::BoxFuture;

/// Frist einer ganzen Matrix-Zustellung, samt Warten auf den Client (eine laufende Prüfung) und
/// allen Uploads. Kürzer als `lauf::HAENGT_NACH`.
pub const MATRIX_ZUSTELL_ZEITLIMIT: Duration = Duration::from_secs(10 * 60);

/// Stellt Versände in Matrix-Räume zu, über den Client der Anbindung.
pub struct MatrixZusteller {
    clients: Arc<Clients>,
}

impl MatrixZusteller {
    /// Mit den Clients des Prozesses (dieselben wie in `Rahmen::matrix`).
    pub fn new(clients: Arc<Clients>) -> Self {
        MatrixZusteller { clients }
    }
}

/// Die bis jetzt gesendeten Teile; außerhalb der Zukunft, damit eine abgelaufene Frist sie nicht
/// verliert.
type Teile = Arc<Mutex<Vec<(i64, String)>>>;

/// Was in den Raum geht, als eigene Kopie (der Zugriff borgt nur den Client).
struct Plan {
    versand_id: String,
    adresse: OwnedRoomOrAliasId,
    /// Der Text (Klartext, HTML), wenn er noch nicht gesendet ist.
    text: Option<(String, String)>,
    /// Die noch nicht gesendeten Anlagen als `(teil, Dateiname, Bytes)`.
    anlagen: Vec<(i64, String, Vec<u8>)>,
}

impl Zusteller for MatrixZusteller {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            if auftrag.kanal != KanalArt::Matrix {
                return Err(kanal_nicht_bedient());
            }
            let z = auftrag.zugang;
            // Nach `check_einstellungen` und `prepare` scheitert das nur bei Altdaten.
            let ziel = matrix_ziel(
                &z.adapter_id,
                &z.einstellungen,
                &z.geheimnisse,
                z.lan_erlaubt,
            )
            .map_err(|_| {
                fehlschlag(
                    Zustellfehler::Anbindung {
                        pruefung_vorziehen: false,
                    },
                    "Matrix-Konto nicht nutzbar",
                    Vec::new(),
                )
            })?;
            // Die Adresse ist beim Eintragen geprüft; eine ungültige erreicht keinen Raum.
            let adresse = OwnedRoomOrAliasId::try_from(auftrag.adresse.trim()).map_err(|_| {
                fehlschlag(
                    Zustellfehler::KeinZutritt,
                    "Raumadresse ungültig",
                    Vec::new(),
                )
            })?;
            let offen = |teil: i64| !auftrag.gesendet.contains(&teil);
            let plan = Plan {
                versand_id: auftrag.versand_id.to_string(),
                adresse,
                text: offen(0).then(|| matrix_text(auftrag.betreff, auftrag.inhalt)),
                anlagen: auftrag
                    .anhaenge
                    .iter()
                    .zip(1_i64..)
                    .filter(|(_, teil)| offen(*teil))
                    .map(|((name, daten), teil)| (teil, name.clone(), daten.clone()))
                    .collect(),
            };
            // Alles schon im Raum (etwa nach „Erneut senden“ eines `ungewiss` abgeschlossenen
            // Versands): nichts mehr zu tun.
            if plan.text.is_none() && plan.anlagen.is_empty() {
                return Ok(Zustellt::default());
            }

            let teile: Teile = Arc::default();
            let gemerkt = teile.clone();
            let zugriff = self.clients.mit_client(&ziel, move |client| {
                Box::pin(async move { sende(client, plan, &gemerkt).await })
            });
            let ergebnis = match tokio::time::timeout(MATRIX_ZUSTELL_ZEITLIMIT, zugriff).await {
                Ok(Ok(Ok(()))) => Ok(()),
                Ok(Ok(Err(f)) | Err(f)) => Err(f),
                Err(_) => Err(MatrixFehler::Zeit),
            };
            let teile = std::mem::take(&mut *teile.lock().expect("Teile nicht vergiftet"));
            match ergebnis {
                Ok(()) => Ok(Zustellt { teile }),
                Err(f) => Err(matrix_fehlschlag(f, teile)),
            }
        })
    }
}

/// Die Schritte im Raum (Spec Abschnitt 6, „Ablauf je Matrix-Versand“).
async fn sende(client: &matrix_sdk::Client, plan: Plan, teile: &Teile) -> Result<(), MatrixFehler> {
    let sdk = |e: matrix_sdk::Error| sdk_fehler(&e);
    // Raum auflösen.
    let (raum_id, server): (OwnedRoomId, Vec<OwnedServerName>) =
        match <&RoomId>::try_from(&*plan.adresse) {
            Ok(id) => (id.to_owned(), Vec::new()),
            Err(alias) => {
                let a = client
                    .resolve_room_alias(alias)
                    .await
                    .map_err(|e| http_fehler(&e))?;
                (a.room_id, a.servers)
            }
        };
    // Beitreten, wenn der Bot noch nicht Mitglied ist (eingeladen oder öffentlich); verweigert
    // der Homeserver (403, unbekannt), ist es `kein_zutritt`.
    let ist_mitglied = client
        .get_room(&raum_id)
        .is_some_and(|r| r.state() == RoomState::Joined);
    if !ist_mitglied {
        client
            .join_room_by_id_or_alias(<&RoomOrAliasId>::from(&*raum_id), &server)
            .await
            .map_err(sdk)?;
    }
    // Zustand dieses einen Raums (Verschlüsselung, Mitglieder), voll, nicht inkrementell.
    client
        .sync_once(
            SyncSettings::default()
                .filter(SyncFilter::FilterDefinition(nur_raum(&raum_id)))
                .full_state(true)
                .timeout(Duration::ZERO),
        )
        .await
        .map_err(sdk)?;
    let raum = client
        .get_room(&raum_id)
        .filter(|r| r.state() == RoomState::Joined)
        .ok_or(MatrixFehler::Verboten)?;
    // Die Mitgliederliste vom Homeserver, damit das SDK die Geräte aller Mitglieder kennt.
    raum.sync_members().await.map_err(sdk)?;

    // Eine Anlage über der Grenze des Homeservers: abbrechen, bevor der Text hinausgeht. Die
    // Grenze hat die Prüfung schon gelesen (der Client merkt sie sich); sonst wird sie hier gelesen.
    if !plan.anlagen.is_empty() {
        let max = u64::from(client.load_or_fetch_max_upload_size().await.map_err(sdk)?);
        if plan.anlagen.iter().any(|(_, _, d)| d.len() as u64 > max) {
            return Err(MatrixFehler::ZuGross);
        }
    }

    if let Some((klartext, html)) = plan.text {
        let antwort = raum
            .send(RoomMessageEventContent::text_html(klartext, html))
            .with_transaction_id(txn(&plan.versand_id, 0))
            .await
            .map_err(sdk)?;
        merke(teile, 0, antwort.response.event_id);
    }
    let png: mime_guess::Mime = "image/png".parse().map_err(|_| MatrixFehler::Antwort)?;
    for (teil, name, daten) in plan.anlagen {
        let mut info = BaseImageInfo {
            size: UInt::new(daten.len() as u64),
            ..Default::default()
        };
        if let Some((breite, hoehe)) = png_masse(&daten) {
            info.width = Some(UInt::from(breite));
            info.height = Some(UInt::from(hoehe));
        }
        let config = AttachmentConfig::new()
            .txn_id(txn(&plan.versand_id, teil))
            .info(AttachmentInfo::Image(info));
        let antwort = raum
            .send_attachment(name, &png, daten, config)
            .await
            .map_err(sdk)?;
        merke(teile, teil, antwort.event_id);
    }
    Ok(())
}

fn merke(teile: &Teile, teil: i64, event_id: OwnedEventId) {
    teile
        .lock()
        .expect("Teile nicht vergiftet")
        .push((teil, event_id.to_string()));
}

/// Die feste Transaktions-ID eines Teils (Spec Abschnitt 6).
fn txn(versand_id: &str, teil: i64) -> OwnedTransactionId {
    OwnedTransactionId::from(format!("ausgang-{versand_id}-{teil}"))
}

/// Ein Sync-Filter nur für `raum`: keine anderen Räume, keine Präsenz, keine Kontodaten, eine
/// kurze Zeitleiste (der Zustand kommt mit `full_state`).
fn nur_raum(raum: &RoomId) -> FilterDefinition {
    let mut nichts = RoomEventFilter::empty();
    nichts.types = Some(Vec::new());
    let mut zeitleiste = RoomEventFilter::empty();
    zeitleiste.limit = Some(UInt::from(1_u32));
    let mut raeume = RoomFilter::empty();
    raeume.rooms = Some(vec![raum.to_owned()]);
    raeume.timeline = zeitleiste;
    raeume.ephemeral = nichts.clone();
    raeume.account_data = nichts;
    let mut ohne = Filter::empty();
    ohne.types = Some(Vec::new());
    let mut filter = FilterDefinition::empty();
    filter.room = raeume;
    filter.presence = ohne.clone();
    filter.account_data = ohne;
    filter
}

/// Der Text (Spec Abschnitt 7) als `(body, formatted_body)`: der Betreff fett, dann der Inhalt
/// des Schnappschusses samt Fuß. `body` ist der Klartext mit Markdown für den Betreff; das HTML
/// entsteht aus eigenem Markdown, in dem jedes Satzzeichen des Inhalts maskiert ist: kein HTML,
/// kein Link und kein Bild aus dem Inhalt (das SDK maskiert Roh-HTML nicht). Zeilen bleiben
/// Zeilen (harter Umbruch), Leerzeilen trennen Absätze.
fn matrix_text(betreff: &str, inhalt: &str) -> (String, String) {
    let betreff = betreff.trim();
    let inhalt = inhalt.trim_end();
    let klartext = format!("**{betreff}**\n\n{inhalt}");
    let mut quelle = format!("**{}**\n\n", maskiere(betreff));
    let zeilen: Vec<&str> = inhalt.lines().collect();
    for (i, zeile) in zeilen.iter().enumerate() {
        quelle.push_str(&einzug_fest(&maskiere(zeile.trim_end())));
        if let Some(naechste) = zeilen.get(i + 1) {
            if !zeile.trim().is_empty() && !naechste.trim().is_empty() {
                quelle.push_str("  ");
            }
            quelle.push('\n');
        }
    }
    let rueckfall = format!("{betreff}\n\n{inhalt}");
    let html = html_aus(&quelle, &rueckfall);
    (klartext, html)
}

/// Das HTML aus der maskierten Markdown-Quelle. Erkennt das SDK darin keine Auszeichnung, ist
/// das HTML der `rueckfall` als maskierter Klartext (Zeilen als `<br>`), nie die Quelle selbst:
/// sie ist Markdown, ihre Escapes wären sichtbar.
fn html_aus(quelle: &str, rueckfall: &str) -> String {
    FormattedBody::markdown(quelle).map_or_else(
        || {
            rueckfall
                .lines()
                .map(html_maskiert)
                .collect::<Vec<_>>()
                .join("<br>")
        },
        |f| f.body,
    )
}

/// Maskiert die Zeichen mit Bedeutung in HTML.
fn html_maskiert(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// Ersetzt den führenden Leerraum einer Zeile durch geschützte Leerzeichen (ein Tab zählt vier):
/// CommonMark macht aus vier Leerzeichen Einzug sonst einen Codeblock, in dem die Escapes von
/// [`maskiere`] sichtbar würden. Der Einzug bleibt so sichtbar.
fn einzug_fest(zeile: &str) -> String {
    let rest = zeile.trim_start_matches([' ', '\t']);
    let mut out = String::with_capacity(zeile.len() + 8);
    for c in zeile[..zeile.len() - rest.len()].chars() {
        let breite = if c == '\t' { 4 } else { 1 };
        out.extend(std::iter::repeat_n('\u{a0}', breite));
    }
    out.push_str(rest);
    out
}

/// Maskiert jedes ASCII-Satzzeichen mit Bedeutung in Markdown (CommonMark-Backslash-Escape).
fn maskiere(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Breite und Höhe aus dem `IHDR` einer PNG-Datei.
fn png_masse(daten: &[u8]) -> Option<(u32, u32)> {
    if daten.len() < 24 || &daten[..8] != b"\x89PNG\r\n\x1a\n" || &daten[12..16] != b"IHDR" {
        return None;
    }
    let zahl = |b: &[u8]| b.try_into().ok().map(u32::from_be_bytes);
    Some((zahl(&daten[16..20])?, zahl(&daten[20..24])?))
}

fn fehlschlag(fehler: Zustellfehler, grund: &str, teile: Vec<(i64, String)>) -> Fehlschlag {
    Fehlschlag {
        fehler,
        grund: grund.into(),
        smtp_status: None,
        teile,
    }
}

/// Ordnet einen Fehler des Homeservers oder des SDK zu (Spec Abschnitt 6, „Fehlerzuordnung
/// Matrix“), mit festem Grund für das ETB (samt Matrix-Code, nie Text des Servers). Nichts ist
/// `ungewiss`: dieselbe Transaktions-ID macht eine Wiederholung unschädlich.
fn matrix_fehlschlag(f: MatrixFehler, teile: Vec<(i64, String)>) -> Fehlschlag {
    let voruebergehend = |nicht_vor| Zustellfehler::Voruebergehend { nicht_vor };
    let anbindung = |pruefung_vorziehen| Zustellfehler::Anbindung { pruefung_vorziehen };
    let (fehler, grund) =
        match f {
            MatrixFehler::Netz => (voruebergehend(None), "Homeserver nicht erreichbar"),
            MatrixFehler::Zeit => (voruebergehend(None), "Homeserver antwortet nicht"),
            MatrixFehler::Dns => (voruebergehend(None), "Homeserver nicht gefunden"),
            MatrixFehler::Speicher => (
                voruebergehend(None),
                "Matrix-Speicher vorübergehend nicht nutzbar",
            ),
            MatrixFehler::RateLimit(warte) => (
                voruebergehend(warte.and_then(|w| {
                    Utc::now().checked_add_signed(chrono::Duration::from_std(w).ok()?)
                })),
                "Homeserver bremst (M_LIMIT_EXCEEDED)",
            ),
            MatrixFehler::Token => (anbindung(true), "Access-Token abgelehnt (M_UNKNOWN_TOKEN)"),
            MatrixFehler::SchluesselPassenNicht => (
                anbindung(true),
                "Schlüsselspeicher passt nicht zum Gerät des Tokens",
            ),
            MatrixFehler::ZielIntern => (anbindung(false), "Adresse des Homeservers nicht erlaubt"),
            MatrixFehler::Verboten => (
                Zustellfehler::KeinZutritt,
                "kein Zutritt zum Raum (M_FORBIDDEN)",
            ),
            MatrixFehler::NichtGefunden => (
                Zustellfehler::KeinZutritt,
                "kein Zutritt zum Raum, Raum unbekannt (M_NOT_FOUND)",
            ),
            MatrixFehler::ZuGross => (
                Zustellfehler::ZuGross,
                "Anlage zu groß für den Homeserver (M_TOO_LARGE)",
            ),
            MatrixFehler::Verschluesselung => (
                Zustellfehler::Verschluesselung,
                "Verschlüsseln nicht möglich",
            ),
            MatrixFehler::KeineUploadGrenze => (
                Zustellfehler::Abgelehnt,
                "Homeserver nennt keine Grenze für Anlagen",
            ),
            MatrixFehler::Antwort => (
                Zustellfehler::Abgelehnt,
                "vom Homeserver abgelehnt (Antwort nicht verwertbar)",
            ),
        };
    fehlschlag(fehler, grund, teile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_ist_betreff_fett_und_inhalt_mit_zeilen() {
        let (klar, html) = matrix_text(
            "Lagebericht Nr. 1",
            "Pegel steigt\nDamm hält\n\n-- \nHochwasser Süd\nErika Muster (S3)\n",
        );
        assert_eq!(
            klar,
            "**Lagebericht Nr. 1**\n\nPegel steigt\nDamm hält\n\n-- \nHochwasser Süd\nErika Muster (S3)"
        );
        assert!(
            html.contains("<strong>Lagebericht Nr. 1</strong>"),
            "{html}"
        );
        assert!(html.contains("Pegel steigt<br"), "{html}");
        assert!(html.contains("Hochwasser Süd<br"), "{html}");
        assert!(html.contains("Erika Muster (S3)"), "{html}");
        assert!(html.contains("<p>--<br"), "{html}");
    }

    #[test]
    fn html_links_und_bilder_im_inhalt_werden_maskiert() {
        let (_, html) = matrix_text(
            "Lage <b>",
            "<img src=x onerror=alert(1)> und <b>fett</b>\n[Klick](https://example.org) ![x](mxc://a/b)\n* keine Liste & #kein Kopf",
        );
        assert!(!html.contains("<img"), "{html}");
        assert!(!html.contains("<b>"), "{html}");
        assert!(!html.contains("<a"), "{html}");
        assert!(!html.contains("<li"), "{html}");
        assert!(!html.contains("<h1"), "{html}");
        assert!(
            html.contains("&lt;img src=x onerror=alert(1)&gt;"),
            "{html}"
        );
        assert!(html.contains("&amp;"), "{html}");
    }

    #[test]
    fn eingerueckte_zeilen_werden_kein_codeblock() {
        let (klar, html) = matrix_text(
            "Lage",
            "Absatz\n\n    eingerückt: 1. Zug\n\tmit Tab (S3)\n  zwei Leerzeichen",
        );
        assert!(!html.contains("<pre"), "{html}");
        assert!(!html.contains("<code"), "{html}");
        assert!(!html.contains('\\'), "{html}");
        assert!(html.contains("eingerückt: 1. Zug"), "{html}");
        assert!(html.contains("mit Tab (S3)"), "{html}");
        assert!(html.contains("zwei Leerzeichen"), "{html}");
        // Der Klartext bleibt, wie er war.
        assert!(
            klar.contains("\n    eingerückt: 1. Zug\n\tmit Tab"),
            "{klar}"
        );
    }

    #[test]
    fn ohne_markdown_ist_das_html_maskierter_klartext() {
        // Eine Quelle ohne Auszeichnung: `FormattedBody::markdown` liefert nichts, der Rückfall
        // greift. Er ist maskierter Klartext, nie die Markdown-Quelle mit ihren Escapes.
        let html = html_aus("nur Text", "Lage <b> & \"S3\"\nZeile 2");
        assert_eq!(html, "Lage &lt;b&gt; &amp; &quot;S3&quot;<br>Zeile 2");
        let html = html_aus("**fett**", "egal");
        assert_eq!(html, "<strong>fett</strong>");
    }

    #[test]
    fn png_masse_aus_dem_kopf() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&32_u32.to_be_bytes());
        png.extend_from_slice(&24_u32.to_be_bytes());
        assert_eq!(png_masse(&png), Some((32, 24)));
        assert_eq!(png_masse(b"kein png"), None);
    }

    #[test]
    fn fehler_werden_zugeordnet_und_nie_ungewiss() {
        use MatrixFehler as M;
        let alle = [
            M::Token,
            M::Netz,
            M::Zeit,
            M::Dns,
            M::ZielIntern,
            M::RateLimit(None),
            M::RateLimit(Some(Duration::from_secs(600))),
            M::Verboten,
            M::NichtGefunden,
            M::ZuGross,
            M::Verschluesselung,
            M::Speicher,
            M::SchluesselPassenNicht,
            M::KeineUploadGrenze,
            M::Antwort,
        ];
        for f in alle {
            let s = matrix_fehlschlag(f, Vec::new());
            assert_ne!(s.fehler, Zustellfehler::Ungewiss, "{f:?}");
            assert_eq!(s.smtp_status, None);
        }
        let art = |f| matrix_fehlschlag(f, Vec::new()).fehler;
        let v = Zustellfehler::Voruebergehend { nicht_vor: None };
        assert_eq!(art(M::Netz), v);
        assert_eq!(art(M::Zeit), v);
        assert_eq!(art(M::Dns), v);
        assert_eq!(art(M::RateLimit(None)), v);
        assert_eq!(
            art(M::Token),
            Zustellfehler::Anbindung {
                pruefung_vorziehen: true
            }
        );
        assert_eq!(art(M::Verboten), Zustellfehler::KeinZutritt);
        assert_eq!(art(M::NichtGefunden), Zustellfehler::KeinZutritt);
        assert_eq!(art(M::ZuGross), Zustellfehler::ZuGross);
        assert_eq!(art(M::Verschluesselung), Zustellfehler::Verschluesselung);
        // Datei-IO, Schließen und Löschen des Speichers sind Probleme des Hubs, nicht der
        // Verschlüsselung: im Wiederholungsfenster bleiben, mit eigenem Grund.
        assert_eq!(art(M::Speicher), v);
        assert_eq!(
            matrix_fehlschlag(M::Speicher, Vec::new()).grund,
            "Matrix-Speicher vorübergehend nicht nutzbar"
        );
        assert_eq!(art(M::KeineUploadGrenze), Zustellfehler::Abgelehnt);
        let jetzt = Utc::now();
        match art(M::RateLimit(Some(Duration::from_secs(600)))) {
            Zustellfehler::Voruebergehend { nicht_vor: Some(n) } => {
                assert!(n >= jetzt + chrono::Duration::minutes(10))
            }
            other => panic!("{other:?}"),
        }
        let teile = vec![(0, "$text".to_string())];
        assert_eq!(matrix_fehlschlag(M::Netz, teile.clone()).teile, teile);
    }
}

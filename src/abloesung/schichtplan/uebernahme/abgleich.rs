//! Abgleich eines Pakets mit dem Einsatz, rein (design.md D4, D5). Die Bestandslisten lädt
//! [`super::repo`]; hier stehen nur die Regeln.
//!
//! **Posten:** Einheit nach Name (oder Funkrufname bei `fahrzeug`), bevorzugt im genannten
//! Abschnitt; UHS nach Bezeichnung; Pause ist immer die Pause. Ein Treffer ist sicher, wenn er
//! eindeutig ist; mehrere sind unsicher; keiner heißt neu.
//!
//! **Personen**, erster Treffer gilt: (0) ein eigener Bezug aus einer Mappe von Lifeline Hub
//! ([`eigener_treffer`], LLH-1557); (1) Kennung und Herkunft gleich einem Helfer des Plans;
//! (2) Kennung gleich der Personalnummer einer Stamm-Person im Dienst, sicher nur mit passendem
//! Namen; (3) Name und Telefon; (4) Name allein, unsicher; (5) sonst neu.

use super::{PaketPostenArt, PersonAngabe, PersonZiel, PostenZiel, Treffer, TrefferGrund};

/// Text zum Vergleichen: getrimmt, Leerraum zusammengezogen, klein.
pub fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Telefonnummer zum Vergleichen: nur Ziffern, `+49`/`0049` wie die führende `0`.
pub fn telefon_norm(s: &str) -> String {
    let t = s.trim();
    let plus = t.starts_with('+');
    let ziffern: String = t.chars().filter(char::is_ascii_digit).collect();
    if plus {
        if let Some(rest) = ziffern.strip_prefix("49") {
            return format!("0{rest}");
        }
        return format!("+{ziffern}");
    }
    if let Some(rest) = ziffern.strip_prefix("0049") {
        return format!("0{rest}");
    }
    ziffern
}

/// Die Schreibweisen eines Namens aus Nach- und Vorname, normalisiert.
pub fn namensformen(nachname: &str, vorname: Option<&str>) -> Vec<String> {
    let n = norm(nachname);
    match vorname.map(norm).filter(|v| !v.is_empty()) {
        None => vec![n],
        Some(v) => vec![
            format!("{v} {n}"),
            format!("{n}, {v}"),
            format!("{n},{v}"),
            format!("{n} {v}"),
        ],
    }
}

/// Ob ein gespeicherter Name zu Nach- und Vorname passt.
pub fn name_passt(gespeichert: &str, formen: &[String]) -> bool {
    let g = norm(gespeichert);
    formen.contains(&g)
}

// ---------------------------------------------------------------------------------------------
// Posten
// ---------------------------------------------------------------------------------------------

/// Eine aktive Einheit des Einsatzes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandEinheit {
    pub id: i64,
    pub name: String,
    pub funkrufname: Option<String>,
    pub abschnitt_id: Option<i64>,
}

/// Eine UHS des Einsatzes, nicht aufgelöst und nicht storniert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandUhs {
    pub id: i64,
    pub bezeichnung: String,
    pub abschnitt_id: Option<i64>,
}

/// Ein Einsatzabschnitt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandAbschnitt {
    pub id: i64,
    pub name: String,
    pub kurzbezeichnung: Option<String>,
}

/// Wie ein Abschnittstext auf die Abschnitte des Einsatzes trifft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbschnittTreffer {
    /// Genau ein Abschnitt trägt den Text als Name oder Kurzbezeichnung.
    Eindeutig(i64),
    /// Mehrere Abschnitte passen (etwa der Name des einen ist die Kurzbezeichnung des anderen).
    Mehrdeutig,
    /// Kein Abschnitt passt (oder der Text ist leer).
    Keiner,
}

/// Sucht den Abschnitt zu einem Namen oder einer Kurzbezeichnung, ohne Groß-/Kleinschreibung.
pub fn abschnitt_treffer(abschnitte: &[BestandAbschnitt], text: &str) -> AbschnittTreffer {
    let t = norm(text);
    if t.is_empty() {
        return AbschnittTreffer::Keiner;
    }
    let treffer: Vec<i64> = abschnitte
        .iter()
        .filter(|a| {
            norm(&a.name) == t || a.kurzbezeichnung.as_deref().is_some_and(|k| norm(k) == t)
        })
        .map(|a| a.id)
        .collect();
    match treffer.as_slice() {
        [] => AbschnittTreffer::Keiner,
        [id] => AbschnittTreffer::Eindeutig(*id),
        _ => AbschnittTreffer::Mehrdeutig,
    }
}

/// Der Abschnitt zu einem Namen oder einer Kurzbezeichnung; mehrdeutig oder unbekannt `None`.
pub fn finde_abschnitt(abschnitte: &[BestandAbschnitt], text: &str) -> Option<i64> {
    match abschnitt_treffer(abschnitte, text) {
        AbschnittTreffer::Eindeutig(id) => Some(id),
        AbschnittTreffer::Mehrdeutig | AbschnittTreffer::Keiner => None,
    }
}

/// Vorschlag für einen Posten: das Ziel, wie sicher, und die übrigen Kandidaten.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostenVorschlag {
    pub ziel: PostenZiel,
    pub treffer: Treffer,
    pub kandidaten: Vec<PostenZiel>,
}

fn einheit_ziel(e: &BestandEinheit) -> PostenZiel {
    PostenZiel::Einheit {
        einheit_id: e.id,
        bezeichnung: e.name.clone(),
    }
}

fn uhs_ziel(u: &BestandUhs) -> PostenZiel {
    PostenZiel::Uhs {
        uhs_id: u.id,
        bezeichnung: u.bezeichnung.clone(),
    }
}

/// Aus Kandidaten den Vorschlag: genau einer sicher, mehrere unsicher (der erste vorgewählt),
/// keiner neu.
fn vorschlag_aus(kandidaten: Vec<PostenZiel>, vorlage: Option<i64>) -> PostenVorschlag {
    match kandidaten.len() {
        0 => PostenVorschlag {
            ziel: PostenZiel::Neu {
                einheit_vorlage_id: vorlage,
            },
            treffer: Treffer::Neu,
            kandidaten: Vec::new(),
        },
        1 => PostenVorschlag {
            ziel: kandidaten[0].clone(),
            treffer: Treffer::Sicher,
            kandidaten: Vec::new(),
        },
        _ => PostenVorschlag {
            ziel: kandidaten[0].clone(),
            treffer: Treffer::Unsicher,
            kandidaten,
        },
    }
}

/// Vorschlag für einen Posten (design.md D4).
pub fn posten_vorschlag(
    art: PaketPostenArt,
    name: &str,
    abschnitt_id: Option<i64>,
    vorlage: Option<i64>,
    einheiten: &[BestandEinheit],
    uhs: &[BestandUhs],
) -> PostenVorschlag {
    let n = norm(name);
    match art {
        PaketPostenArt::Pause => PostenVorschlag {
            ziel: PostenZiel::Pause,
            treffer: Treffer::Sicher,
            kandidaten: Vec::new(),
        },
        PaketPostenArt::Einheit | PaketPostenArt::Fahrzeug => {
            let passt = |e: &&BestandEinheit| {
                norm(&e.name) == n
                    || (art == PaketPostenArt::Fahrzeug
                        && e.funkrufname.as_deref().is_some_and(|f| norm(f) == n))
            };
            let alle: Vec<&BestandEinheit> = einheiten.iter().filter(passt).collect();
            // Im genannten Abschnitt zuerst; trifft dort keine, gelten alle.
            let im_abschnitt: Vec<&BestandEinheit> = match abschnitt_id {
                Some(a) => alle
                    .iter()
                    .copied()
                    .filter(|e| e.abschnitt_id == Some(a))
                    .collect(),
                None => Vec::new(),
            };
            let wahl = if im_abschnitt.is_empty() {
                alle
            } else {
                im_abschnitt
            };
            vorschlag_aus(wahl.into_iter().map(einheit_ziel).collect(), vorlage)
        }
        PaketPostenArt::Uhs => vorschlag_aus(
            uhs.iter()
                .filter(|u| norm(&u.bezeichnung) == n)
                .map(uhs_ziel)
                .collect(),
            None,
        ),
    }
}

// ---------------------------------------------------------------------------------------------
// Personen
// ---------------------------------------------------------------------------------------------

/// Eine Stamm-Person der Organisation im Dienst.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandStamm {
    pub id: i64,
    pub name: String,
    pub personalnummer: Option<String>,
    pub telefon: Option<String>,
}

/// Ein Helfer des Plans dieses Einsatzes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandHelfer {
    pub id: i64,
    pub name: String,
    pub telefon: Option<String>,
    pub kennung: Option<String>,
    pub herkunft: Option<String>,
}

/// Vorschlag für eine Person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonVorschlag {
    pub ziel: PersonZiel,
    pub treffer: Treffer,
    pub grund: Option<TrefferGrund>,
    pub kandidaten: Vec<PersonZiel>,
}

fn stamm_ziel(s: &BestandStamm) -> PersonZiel {
    PersonZiel::Stamm {
        personal_id: s.id,
        name: s.name.clone(),
    }
}

fn helfer_ziel(h: &BestandHelfer) -> PersonZiel {
    PersonZiel::Helfer {
        helfer_id: h.id,
        name: h.name.clone(),
    }
}

/// Herkunft zum Vergleichen: fehlend wie leer.
pub fn herkunft_norm(h: Option<&str>) -> String {
    h.map(norm).unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------
// Eigene Bezüge (LLH-1557, design.md D6)
// ---------------------------------------------------------------------------------------------

/// Herkunft der eigenen Bezüge, die die Excel-Mappe in den Austausch schreibt.
pub const EIGENE_HERKUNFT: &str = "Lifeline Hub";

/// Herkunft eines Helfers der Vorplanung; seine Kennung ist die Kennung des Helfers der Planung
/// (vereinbart in LLH-1556/LLH-1561 für die Übernahme einer Planung, LLH-1587).
pub const VORPLANUNG_HERKUNFT: &str = "vorplanung";

/// Ein eigener Bezug: auf wen eine Kennung mit Herkunft [`EIGENE_HERKUNFT`] zeigt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EigenerBezug {
    /// Stamm-Personal der Organisation (`personal-<id>`).
    Personal(i64),
    /// Eine Ad-hoc-Kraft des Einsatzes (`einsatzkraft-<id>`).
    Einsatzkraft(i64),
    /// Ein Helfer des Plans ohne eigene Kennung (`helfer-<id>`).
    Helfer(i64),
}

impl EigenerBezug {
    /// Die Kennung im Austausch, etwa `personal-12`.
    pub fn kennung(self) -> String {
        match self {
            EigenerBezug::Personal(id) => format!("personal-{id}"),
            EigenerBezug::Einsatzkraft(id) => format!("einsatzkraft-{id}"),
            EigenerBezug::Helfer(id) => format!("helfer-{id}"),
        }
    }

    /// Umkehr von [`Self::kennung`]; eine andere Form ist kein eigener Bezug.
    pub fn from_kennung(kennung: &str) -> Option<Self> {
        let k = kennung.trim();
        let (art, id) = k.rsplit_once('-')?;
        if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let id: i64 = id.parse().ok()?;
        match art {
            "personal" => Some(EigenerBezug::Personal(id)),
            "einsatzkraft" => Some(EigenerBezug::Einsatzkraft(id)),
            "helfer" => Some(EigenerBezug::Helfer(id)),
            _ => None,
        }
    }
}

/// Eine Ad-hoc-Kraft dieses Einsatzes (ohne Stammdatenbezug).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BestandEinsatzkraft {
    pub id: i64,
    pub name: String,
}

/// Regel 0 (design.md D6 von LLH-1557): Kennung mit Herkunft [`EIGENE_HERKUNFT`] zeigt auf
/// Stamm-Personal (`stamm`), eine Ad-hoc-Kraft oder einen Helfer **dieses** Einsatzes, und der
/// Name passt: dann ist es diese Person, sicher. Sonst `None`, und die Regeln 1 bis 5 gelten wie
/// für jede Zeile (anderer Einsatz, andere Organisation, anderer Name).
///
/// Trägt schon ein Helfer dieses Plans genau diese Kennung und Herkunft (ein früheres Einlesen
/// fand den Bezug nicht und legte ihn an), bleibt es bei ihm (Regel 1): sonst käme dieselbe
/// Person ein zweites Mal in den Block, sobald der Bezug später trifft.
pub fn eigener_treffer(
    angabe: &PersonAngabe,
    stamm: &[BestandStamm],
    einsatzkraefte: &[BestandEinsatzkraft],
    helfer: &[BestandHelfer],
) -> Option<PersonVorschlag> {
    if herkunft_norm(angabe.herkunft.as_deref()) != norm(EIGENE_HERKUNFT) {
        return None;
    }
    let kennung = angabe.kennung.as_deref()?.trim();
    if helfer.iter().any(|h| {
        h.kennung.as_deref().map(str::trim) == Some(kennung)
            && herkunft_norm(h.herkunft.as_deref()) == norm(EIGENE_HERKUNFT)
    }) {
        return None;
    }
    let bezug = EigenerBezug::from_kennung(kennung)?;
    let formen = namensformen(&angabe.nachname, angabe.vorname.as_deref());
    let ziel = match bezug {
        EigenerBezug::Personal(id) => stamm
            .iter()
            .find(|s| s.id == id && name_passt(&s.name, &formen))
            .map(stamm_ziel),
        EigenerBezug::Einsatzkraft(id) => einsatzkraefte
            .iter()
            .find(|k| k.id == id && name_passt(&k.name, &formen))
            .map(|k| PersonZiel::Einsatz {
                einsatz_personal_id: k.id,
                name: k.name.clone(),
            }),
        EigenerBezug::Helfer(id) => helfer
            .iter()
            .find(|h| h.id == id && name_passt(&h.name, &formen))
            .map(helfer_ziel),
    }?;
    Some(PersonVorschlag {
        ziel,
        treffer: Treffer::Sicher,
        grund: Some(TrefferGrund::Bezug),
        kandidaten: Vec::new(),
    })
}

/// Vorschlag für eine Person (design.md D5).
pub fn person_vorschlag(
    angabe: &PersonAngabe,
    stamm: &[BestandStamm],
    helfer: &[BestandHelfer],
) -> PersonVorschlag {
    let formen = namensformen(&angabe.nachname, angabe.vorname.as_deref());
    let kennung = angabe
        .kennung
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty());

    if let Some(k) = kennung {
        // (1) Kennung und Herkunft eines Helfers.
        let herkunft = herkunft_norm(angabe.herkunft.as_deref());
        if let Some(h) = helfer.iter().find(|h| {
            h.kennung.as_deref().map(str::trim) == Some(k)
                && herkunft_norm(h.herkunft.as_deref()) == herkunft
        }) {
            return PersonVorschlag {
                ziel: helfer_ziel(h),
                treffer: Treffer::Sicher,
                grund: Some(TrefferGrund::Kennung),
                kandidaten: Vec::new(),
            };
        }
        // (2) Kennung gleich der Personalnummer.
        if let Some(s) = stamm.iter().find(|s| {
            s.personalnummer
                .as_deref()
                .is_some_and(|p| p.trim().eq_ignore_ascii_case(k))
        }) {
            let passt = name_passt(&s.name, &formen);
            return PersonVorschlag {
                ziel: stamm_ziel(s),
                treffer: if passt {
                    Treffer::Sicher
                } else {
                    Treffer::Unsicher
                },
                grund: Some(if passt {
                    TrefferGrund::KennungName
                } else {
                    TrefferGrund::KennungOhneName
                }),
                kandidaten: if passt {
                    Vec::new()
                } else {
                    vec![stamm_ziel(s)]
                },
            };
        }
    }

    // Kandidaten nach Name, Stamm vor Helfern.
    let mut nach_name: Vec<(PersonZiel, Option<&str>)> = stamm
        .iter()
        .filter(|s| name_passt(&s.name, &formen))
        .map(|s| (stamm_ziel(s), s.telefon.as_deref()))
        .collect();
    nach_name.extend(
        helfer
            .iter()
            .filter(|h| name_passt(&h.name, &formen))
            // Ein Helfer mit anderer Kennung ist eine andere Person.
            .filter(|h| match (kennung, h.kennung.as_deref()) {
                (Some(k), Some(hk)) => hk.trim() == k,
                _ => true,
            })
            .map(|h| (helfer_ziel(h), h.telefon.as_deref())),
    );

    // (3) Name und Telefon.
    if let Some(t) = angabe
        .telefon
        .as_deref()
        .map(telefon_norm)
        .filter(|t| !t.is_empty())
    {
        let mit_telefon: Vec<&PersonZiel> = nach_name
            .iter()
            .filter(|(_, tel)| tel.map(telefon_norm).as_deref() == Some(t.as_str()))
            .map(|(z, _)| z)
            .collect();
        if mit_telefon.len() == 1 {
            return PersonVorschlag {
                ziel: mit_telefon[0].clone(),
                treffer: Treffer::Sicher,
                grund: Some(TrefferGrund::NameTelefon),
                kandidaten: Vec::new(),
            };
        }
    }

    // (4) Name allein: unsicher; ein Kandidat ist vorgewählt, mehrere nicht.
    let kandidaten: Vec<PersonZiel> = nach_name.into_iter().map(|(z, _)| z).collect();
    match kandidaten.len() {
        0 => PersonVorschlag {
            ziel: PersonZiel::Neu,
            treffer: Treffer::Neu,
            grund: None,
            kandidaten,
        },
        1 => PersonVorschlag {
            ziel: kandidaten[0].clone(),
            treffer: Treffer::Unsicher,
            grund: Some(TrefferGrund::Name),
            kandidaten,
        },
        _ => PersonVorschlag {
            ziel: PersonZiel::Neu,
            treffer: Treffer::Unsicher,
            grund: Some(TrefferGrund::Name),
            kandidaten,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn angabe(nach: &str, vor: Option<&str>) -> PersonAngabe {
        PersonAngabe {
            schluessel: "m1".into(),
            nachname: nach.into(),
            vorname: vor.map(Into::into),
            ..Default::default()
        }
    }

    fn stamm(id: i64, name: &str, nr: Option<&str>, tel: Option<&str>) -> BestandStamm {
        BestandStamm {
            id,
            name: name.into(),
            personalnummer: nr.map(Into::into),
            telefon: tel.map(Into::into),
        }
    }

    fn helfer(id: i64, name: &str, kennung: Option<&str>, herkunft: Option<&str>) -> BestandHelfer {
        BestandHelfer {
            id,
            name: name.into(),
            telefon: None,
            kennung: kennung.map(Into::into),
            herkunft: herkunft.map(Into::into),
        }
    }

    #[test]
    fn telefonnummern_gleichen_sich_in_jeder_schreibweise() {
        assert_eq!(telefon_norm("0170 123 45-6"), "0170123456");
        assert_eq!(telefon_norm("+49 170 123456"), "0170123456");
        assert_eq!(telefon_norm("0049 (170) 123456"), "0170123456");
        assert_eq!(telefon_norm("+43 1 234"), "+431234");
    }

    #[test]
    fn name_passt_in_beiden_reihenfolgen() {
        let f = namensformen("Vorlage", Some("Sophie"));
        assert!(name_passt("Sophie  Vorlage", &f));
        assert!(name_passt("vorlage, sophie", &f));
        assert!(!name_passt("Sophie Vorlagen", &f));
        assert!(name_passt(
            "Sophie Vorlage",
            &namensformen("Sophie Vorlage", None)
        ));
    }

    #[test]
    fn kennung_und_herkunft_treffen_den_helfer() {
        let mut a = angabe("Neu", Some("Nina"));
        a.kennung = Some("4711".into());
        a.herkunft = Some("helferplanung".into());
        let h = [
            helfer(1, "Nina Neu", Some("4711"), Some("vorplanung")),
            helfer(2, "Nina Neu", Some("4711"), Some("Helferplanung")),
        ];
        let v = person_vorschlag(&a, &[], &h);
        assert_eq!(
            v.ziel,
            PersonZiel::Helfer {
                helfer_id: 2,
                name: "Nina Neu".into()
            }
        );
        assert_eq!(
            (v.treffer, v.grund),
            (Treffer::Sicher, Some(TrefferGrund::Kennung))
        );
    }

    #[test]
    fn personalnummer_mit_name_ist_sicher_ohne_name_unsicher() {
        let s = [stamm(7, "Sophie Vorlage", Some("DEMO-P-006"), None)];
        let mut a = angabe("Vorlage", Some("Sophie"));
        a.kennung = Some("demo-p-006".into());
        let v = person_vorschlag(&a, &s, &[]);
        assert_eq!(
            (v.treffer, v.grund),
            (Treffer::Sicher, Some(TrefferGrund::KennungName))
        );
        let mut b = angabe("Anders", Some("Anna"));
        b.kennung = Some("DEMO-P-006".into());
        let v = person_vorschlag(&b, &s, &[]);
        assert_eq!(
            (v.treffer, v.grund),
            (Treffer::Unsicher, Some(TrefferGrund::KennungOhneName))
        );
        assert!(matches!(v.ziel, PersonZiel::Stamm { personal_id: 7, .. }));
    }

    #[test]
    fn name_und_telefon_sind_sicher_name_allein_unsicher() {
        let s = [
            stamm(1, "Mia Muster", None, Some("0170 1")),
            stamm(2, "Mia Muster", None, Some("0170 2")),
        ];
        let mut a = angabe("Muster", Some("Mia"));
        a.telefon = Some("+49 170 2".into());
        let v = person_vorschlag(&a, &s, &[]);
        assert!(matches!(v.ziel, PersonZiel::Stamm { personal_id: 2, .. }));
        assert_eq!(v.treffer, Treffer::Sicher);

        // Zwei gleichnamige ohne Telefon: unsicher, nichts vorgewählt.
        let v = person_vorschlag(&angabe("Muster", Some("Mia")), &s, &[]);
        assert_eq!(v.ziel, PersonZiel::Neu);
        assert_eq!(v.treffer, Treffer::Unsicher);
        assert_eq!(v.kandidaten.len(), 2);

        // Einer: unsicher, aber vorgewählt.
        let v = person_vorschlag(&angabe("Muster", Some("Mia")), &s[..1], &[]);
        assert!(matches!(v.ziel, PersonZiel::Stamm { personal_id: 1, .. }));
        assert_eq!(v.treffer, Treffer::Unsicher);
    }

    #[test]
    fn unbekannt_ist_neu_und_andere_kennung_ist_andere_person() {
        let h = [helfer(3, "Nina Neu", Some("1"), Some("Helferplanung"))];
        let mut a = angabe("Neu", Some("Nina"));
        a.kennung = Some("2".into());
        a.herkunft = Some("Helferplanung".into());
        let v = person_vorschlag(&a, &[], &h);
        assert_eq!((v.ziel, v.treffer), (PersonZiel::Neu, Treffer::Neu));
    }

    fn eigen(nach: &str, kennung: &str) -> PersonAngabe {
        PersonAngabe {
            kennung: Some(kennung.into()),
            herkunft: Some(EIGENE_HERKUNFT.into()),
            ..angabe(nach, None)
        }
    }

    #[test]
    fn eigene_kennung_hin_und_zurueck() {
        for b in [
            EigenerBezug::Personal(12),
            EigenerBezug::Einsatzkraft(3),
            EigenerBezug::Helfer(70),
        ] {
            assert_eq!(EigenerBezug::from_kennung(&b.kennung()), Some(b));
        }
        for fremd in [
            "personal-",
            "personal-1x",
            "planungshelfer-4",
            "4711",
            "helfer--1",
        ] {
            assert_eq!(EigenerBezug::from_kennung(fremd), None, "{fremd}");
        }
    }

    #[test]
    fn regel_0_trifft_eigene_personen_mit_passendem_namen() {
        let s = [stamm(7, "Sophie Vorlage", None, None)];
        let k = [BestandEinsatzkraft {
            id: 3,
            name: "Ali Adhoc".into(),
        }];
        let h = [helfer(9, "Nina Neu", None, None)];
        let v = eigener_treffer(&eigen("Sophie  Vorlage", "personal-7"), &s, &k, &h).unwrap();
        assert!(matches!(v.ziel, PersonZiel::Stamm { personal_id: 7, .. }));
        assert_eq!(
            (v.treffer, v.grund),
            (Treffer::Sicher, Some(TrefferGrund::Bezug))
        );
        let v = eigener_treffer(&eigen("ali adhoc", "einsatzkraft-3"), &s, &k, &h).unwrap();
        assert_eq!(
            v.ziel,
            PersonZiel::Einsatz {
                einsatz_personal_id: 3,
                name: "Ali Adhoc".into()
            }
        );
        let v = eigener_treffer(&eigen("Nina Neu", "helfer-9"), &s, &k, &h).unwrap();
        assert!(matches!(v.ziel, PersonZiel::Helfer { helfer_id: 9, .. }));
    }

    #[test]
    fn regel_0_greift_nicht_bei_anderem_namen_anderer_herkunft_oder_fremder_id() {
        let s = [stamm(7, "Sophie Vorlage", None, None)];
        let h = [helfer(9, "Nina Neu", None, None)];
        assert!(eigener_treffer(&eigen("Anna Anders", "personal-7"), &s, &[], &h).is_none());
        assert!(eigener_treffer(&eigen("Nina Neu", "helfer-10"), &s, &[], &h).is_none());
        assert!(eigener_treffer(&eigen("Nina Neu", "einsatzkraft-9"), &s, &[], &h).is_none());
        let mut fremd = eigen("Sophie Vorlage", "personal-7");
        fremd.herkunft = Some("Helferplanung".into());
        assert!(eigener_treffer(&fremd, &s, &[], &h).is_none());
        // Herkunft ohne Rücksicht auf Groß/klein und Leerraum.
        fremd.herkunft = Some("  lifeline   HUB ".into());
        assert!(eigener_treffer(&fremd, &s, &[], &h).is_some());
    }

    #[test]
    fn ein_helfer_mit_derselben_kennung_geht_dem_bezug_vor() {
        let s = [stamm(7, "Sophie Vorlage", None, None)];
        let h = [helfer(
            12,
            "Sophie Vorlage",
            Some("personal-7"),
            Some("Lifeline Hub"),
        )];
        let angabe = eigen("Sophie Vorlage", "personal-7");
        assert!(eigener_treffer(&angabe, &s, &[], &h).is_none());
        let v = person_vorschlag(&angabe, &s, &h);
        assert_eq!(v.treffer, Treffer::Sicher);
        assert!(matches!(v.ziel, PersonZiel::Helfer { helfer_id: 12, .. }));
    }

    #[test]
    fn einheit_im_abschnitt_geht_vor() {
        let e = [
            BestandEinheit {
                id: 1,
                name: "Streife 1".into(),
                funkrufname: None,
                abschnitt_id: Some(10),
            },
            BestandEinheit {
                id: 2,
                name: "streife 1".into(),
                funkrufname: None,
                abschnitt_id: Some(20),
            },
        ];
        let v = posten_vorschlag(
            PaketPostenArt::Einheit,
            "Streife  1",
            Some(20),
            None,
            &e,
            &[],
        );
        assert_eq!(v.treffer, Treffer::Sicher);
        assert!(matches!(v.ziel, PostenZiel::Einheit { einheit_id: 2, .. }));
        let v = posten_vorschlag(PaketPostenArt::Einheit, "Streife 1", None, None, &e, &[]);
        assert_eq!(v.treffer, Treffer::Unsicher);
        assert_eq!(v.kandidaten.len(), 2);
        let v = posten_vorschlag(PaketPostenArt::Einheit, "Wache", None, Some(5), &e, &[]);
        assert_eq!(
            (v.ziel, v.treffer),
            (
                PostenZiel::Neu {
                    einheit_vorlage_id: Some(5)
                },
                Treffer::Neu
            )
        );
    }

    #[test]
    fn fahrzeug_trifft_auch_den_funkrufnamen() {
        let e = [BestandEinheit {
            id: 4,
            name: "KTW-Besatzung".into(),
            funkrufname: Some("Rotkreuz Musterstadt 87-85".into()),
            abschnitt_id: None,
        }];
        let v = posten_vorschlag(
            PaketPostenArt::Fahrzeug,
            "Rotkreuz Musterstadt 87-85",
            None,
            None,
            &e,
            &[],
        );
        assert_eq!(v.treffer, Treffer::Sicher);
        let v = posten_vorschlag(
            PaketPostenArt::Einheit,
            "Rotkreuz Musterstadt 87-85",
            None,
            None,
            &e,
            &[],
        );
        assert_eq!(v.treffer, Treffer::Neu);
    }

    #[test]
    fn abschnitt_ueber_name_oder_kurzbezeichnung() {
        let a = [
            BestandAbschnitt {
                id: 1,
                name: "Bühne".into(),
                kurzbezeichnung: Some("EA 1".into()),
            },
            BestandAbschnitt {
                id: 2,
                name: "Eingang".into(),
                kurzbezeichnung: Some("EA 2".into()),
            },
        ];
        assert_eq!(finde_abschnitt(&a, "bühne"), Some(1));
        assert_eq!(finde_abschnitt(&a, "ea 2"), Some(2));
        assert_eq!(finde_abschnitt(&a, "Festmeile"), None);
    }

    #[test]
    fn abschnitt_mehrdeutig_ist_kein_treffer() {
        // Der Name des einen ist die Kurzbezeichnung des anderen (LLH-1609).
        let a = [
            BestandAbschnitt {
                id: 1,
                name: "Nord".into(),
                kurzbezeichnung: None,
            },
            BestandAbschnitt {
                id: 2,
                name: "Abschnitt Nord".into(),
                kurzbezeichnung: Some("nord".into()),
            },
        ];
        assert_eq!(abschnitt_treffer(&a, "Nord"), AbschnittTreffer::Mehrdeutig);
        assert_eq!(finde_abschnitt(&a, "Nord"), None);
        assert_eq!(abschnitt_treffer(&a, "Süd"), AbschnittTreffer::Keiner);
        assert_eq!(abschnitt_treffer(&a, "  "), AbschnittTreffer::Keiner);
        assert_eq!(
            abschnitt_treffer(&a, "abschnitt nord"),
            AbschnittTreffer::Eindeutig(2)
        );
    }
}

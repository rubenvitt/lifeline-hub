//! Das Paket des Abgleichs (design.md D6): dieselbe Form in Anfrage und Antwort von
//! `POST /api/instanz/spiegel`. Jede Liste hat eine Obergrenze, das Ganze [`SPIEGEL_MAX`]; ein
//! neues Feld kommt mit `serde(default)` hinzu, damit eine ältere Gegenseite es überliest.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Größte Anfrage und größte Antwort des Abgleichs.
pub const SPIEGEL_MAX: usize = 2 * 1024 * 1024;
/// Platz für Hülle, Stände, Anträge und Quittungen neben den Zeilen; die Zeilen bekommen den Rest.
pub const RESERVE: usize = 256 * 1024;
/// Höchstzahl Einsätze je Paket (Lieferungen und Stände je für sich).
pub const EINSAETZE_MAX: usize = 256;
/// Höchstzahl Zeilen je Paket über alle Lieferungen, ohne mitgelieferte Abhängigkeiten.
pub const ZEILEN_MAX: usize = 2000;
/// Höchstzahl mitgelieferter Abhängigkeiten je Paket.
pub const ABHAENGIGE_MAX: usize = 2000;
/// Höchstzahl Konten je Lieferung.
pub const KONTEN_MAX: usize = 1000;
/// Höchstzahl Anträge und Quittungen je Paket.
pub const ANTRAEGE_MAX: usize = 200;
/// Größte erfasste Daten eines Antrags; größere lehnt der Spiegel beim Beantragen ab, damit ein
/// Antrag das Paket nicht sprengt.
pub const ANTRAG_DATEN_MAX: usize = 64 * 1024;
/// Höchstens so viele Bytes Anträge je Paket; sie gehen vor den Lieferungen vom Budget ab.
pub const ANTRAEGE_BYTES_MAX: usize = 512 * 1024;
/// Höchstzahl Anhang-Abrufe und -Stücke je Paket.
pub const ANHAENGE_MAX: usize = 64;
/// Größe eines Anhang-Stücks (D8).
pub const TEIL_GROESSE: usize = 256 * 1024;

/// Anfrage und Antwort des Abgleichs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SpiegelPaket {
    /// Ergebnisse von Anträgen, die das Gegenüber gestellt hat (D11).
    #[serde(default)]
    pub quittungen: Vec<AntragQuittung>,
    /// Anträge an Einsätze, die das Gegenüber führt (D9).
    #[serde(default)]
    pub antraege: Vec<Antrag>,
    /// Bis wohin ich die Einsätze des Gegenübers übernommen habe.
    #[serde(default)]
    pub staende: Vec<EinsatzStand>,
    /// Zeilen der Einsätze, die ich führe.
    #[serde(default)]
    pub lieferungen: Vec<EinsatzLieferung>,
    /// Anhänge, deren Inhalt ich brauche (D8).
    #[serde(default)]
    pub abrufe: Vec<AnhangAbruf>,
    /// Stücke von Anhängen, die das Gegenüber angefordert hat.
    #[serde(default)]
    pub anhang_teile: Vec<AnhangTeil>,
    /// Lebensende von Einsätzen, die ich führe (LLH-1494, design.md D3): gelöscht oder zur
    /// Verwahrung übergeben.
    #[serde(default)]
    pub lebensende: Vec<Lebensende>,
    /// Antworten auf übergebene Einsätze (D4).
    #[serde(default)]
    pub lebensende_quittungen: Vec<LebensendeQuittung>,
}

/// Wie ein Einsatz beim Führer endet (D3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lebensende {
    pub kennung: String,
    /// `geloescht`: der Führer hat den Einsatz nicht mehr, der Spiegel räumt ab. `verwahrt`: die
    /// meldende Seite übergibt ihn der erreichten (D4). Text, damit eine ältere Seite eine neue Art
    /// überliest statt am Lesen zu scheitern.
    pub art: String,
    /// Bei `verwahrt` der höchste Stand im Änderungslog des Führers; sonst 0.
    #[serde(default)]
    pub stand: i64,
    /// Bei `verwahrt` die Fristen je Datenkategorie, die am Führer gelten.
    #[serde(default)]
    pub kategorien: Vec<KategorieFrist>,
}

/// Frist einer Datenkategorie, wie sie in `einsatz_aufbewahrung_kategorie` steht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
pub struct KategorieFrist {
    pub kategorie: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frist_bis: Option<String>,
    pub rechtsgrundlage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vorgemerkt_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geschwaerzt_at: Option<String>,
}

/// Antwort der erreichten Seite auf `verwahrt` (D4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LebensendeQuittung {
    pub kennung: String,
    /// `angenommen` oder `wartet`.
    pub ergebnis: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
}

/// Art eines Lebensendes: gelöscht.
pub const LEBENSENDE_GELOESCHT: &str = "geloescht";
/// Art eines Lebensendes: zur Verwahrung übergeben.
pub const LEBENSENDE_VERWAHRT: &str = "verwahrt";
/// Ergebnis einer Verwahrung: angenommen.
pub const VERWAHRUNG_ANGENOMMEN: &str = "angenommen";
/// Ergebnis einer Verwahrung: wartet (Grund dabei).
pub const VERWAHRUNG_WARTET: &str = "wartet";
/// Höchstzahl Kategorie-Fristen je Lebensende.
pub const KATEGORIEN_MAX: usize = 16;

/// Stand eines gespiegelten Einsatzes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EinsatzStand {
    pub kennung: String,
    pub stand: i64,
}

/// Zeilen eines Einsatzes seit einem Stand (D6).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EinsatzLieferung {
    pub kennung: String,
    /// Kennung der Org an der erreichten Seite (`<instanzkennung>/<org_id>`), wie in Melden.
    pub org: String,
    /// Org-ID des Einsatzes beim Absender; Org-Verweise mit diesem Wert zeigen auf die Org der
    /// Zuordnung.
    pub org_id: i64,
    /// Wire-Wert von [`super::Freigabestufe`]; Text, damit eine ältere Seite eine neue Stufe
    /// erkennt, statt am Lesen zu scheitern.
    pub freigabestufe: String,
    pub seit: i64,
    /// Höchster vollständig gelieferter Stand; so weit darf der Spiegel vorrücken.
    pub bis: i64,
    #[serde(default)]
    pub zeilen: Vec<Zeile>,
    /// Die Konten, auf die die Zeilen verweisen (D5).
    #[serde(default)]
    pub konten: Vec<KontoAngabe>,
    /// Der Absender liefert genutzte Katalog-Sprechgruppen mit (LLH-1629); ein älterer nicht
    /// (siehe [`super::katalog::OHNE_KATALOG`]).
    #[serde(default)]
    pub katalog: bool,
}

/// Eine gelieferte Zeile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Zeile {
    /// Tabelle.
    pub art: String,
    /// Schlüssel beim Absender, wie im Änderungslog.
    pub schluessel: String,
    pub stand: i64,
    /// Wire-Wert von [`super::SpiegelKategorie`].
    pub kategorie: String,
    #[serde(default)]
    pub geloescht: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daten: Option<Value>,
    /// Inhalt auf Abruf (D8): nur Größe und Prüfsumme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<BlobAngabe>,
    /// Schlüssel beim Empfänger, wenn der Absender ihn kennt: eine Katalogzeile mit Herkunft der
    /// Stammdaten (LLH-1629, [`super::katalog`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gegen: Option<String>,
}

/// Größe und SHA-256 (hex) eines Inhalts auf Abruf.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlobAngabe {
    pub groesse: i64,
    pub sha256: String,
}

/// Ein Konto, auf das gelieferte Zeilen verweisen (D5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KontoAngabe {
    /// Kennung beim Absender.
    pub id: i64,
    pub anzeigename: String,
    /// Kennung beim Empfänger, wenn der Absender sie kennt (Herkunft der Stammdaten).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gegen_id: Option<i64>,
}

/// Ein Antrag an den Führer (D9, D11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Antrag {
    /// Kennung des Antrags beim Antragsteller.
    pub id: i64,
    /// Einsatz beim Führer.
    pub kennung: String,
    pub art: String,
    pub methode: String,
    pub pfad_vorlage: String,
    /// Pfadparameter mit den Kennungen des Führers.
    #[serde(default)]
    pub pfad_parameter: serde_json::Map<String, Value>,
    pub daten: Value,
    pub konto: KontoAngabe,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    pub erfasst_at: String,
}

/// Ergebnis eines Antrags (D11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AntragQuittung {
    pub id: i64,
    /// `uebernommen` oder `abgelehnt`.
    pub ergebnis: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grund: Option<String>,
    /// Art und Schlüssel der entstandenen Zeile beim Führer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ergebnis_art: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ergebnis_schluessel: Option<String>,
}

/// Anforderung des Inhalts eines Anhangs ab `ab` (D8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnhangAbruf {
    pub kennung: String,
    pub art: String,
    /// Schlüssel beim Führer.
    pub schluessel: String,
    pub sha256: String,
    pub ab: i64,
}

/// Ein Stück eines Anhangs (D8).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnhangTeil {
    pub kennung: String,
    pub art: String,
    pub schluessel: String,
    pub sha256: String,
    pub ab: i64,
    /// Base64 (Standard, mit Auffüllung).
    pub daten: String,
}

impl SpiegelPaket {
    /// Prüft die Listen gegen ihre Grenzen (`src/AGENTS.md`, Listen von außen).
    pub fn check(&self) -> Result<(), String> {
        if self.lieferungen.len() > EINSAETZE_MAX
            || self.staende.len() > EINSAETZE_MAX
            || self.lebensende.len() > EINSAETZE_MAX
            || self.lebensende_quittungen.len() > EINSAETZE_MAX
        {
            return Err(format!("mehr als {EINSAETZE_MAX} Einsätze im Paket"));
        }
        let zeilen: usize = self.lieferungen.iter().map(|l| l.zeilen.len()).sum();
        if zeilen > ZEILEN_MAX + ABHAENGIGE_MAX {
            return Err("zu viele Zeilen im Paket".into());
        }
        if self.lieferungen.iter().any(|l| l.konten.len() > KONTEN_MAX) {
            return Err("zu viele Konten in einer Lieferung".into());
        }
        if self.antraege.len() > ANTRAEGE_MAX || self.quittungen.len() > ANTRAEGE_MAX {
            return Err(format!("mehr als {ANTRAEGE_MAX} Anträge oder Quittungen"));
        }
        if self.abrufe.len() > ANHAENGE_MAX || self.anhang_teile.len() > ANHAENGE_MAX {
            return Err(format!("mehr als {ANHAENGE_MAX} Anhänge im Paket"));
        }
        // `seit > bis` ließe `clamp` in der Übernahme in Panik geraten (und damit den Takt für alle
        // Kopplungen enden).
        if self.lieferungen.iter().any(|l| l.seit > l.bis) {
            return Err("Lieferung mit Stand vor ihrem Beginn".into());
        }
        if self
            .lebensende
            .iter()
            .any(|l| l.kategorien.len() > KATEGORIEN_MAX)
        {
            return Err("zu viele Kategorie-Fristen an einem Lebensende".into());
        }
        let mut gesehen = std::collections::HashSet::new();
        if !self.lieferungen.iter().all(|l| gesehen.insert(&l.kennung)) {
            return Err("ein Einsatz doppelt im Paket".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leeres_paket_und_paket_ohne_neue_felder_sind_lesbar() {
        let p: SpiegelPaket = serde_json::from_str("{}").unwrap();
        assert!(p.check().is_ok());
        assert!(p.lebensende.is_empty() && p.lebensende_quittungen.is_empty());
        let l: Lebensende = serde_json::from_str(r#"{"kennung":"a/1","art":"geloescht"}"#).unwrap();
        assert_eq!((l.stand, l.kategorien.len()), (0, 0));
        let l: EinsatzLieferung = serde_json::from_str(
            r#"{"kennung":"a/1","org":"h/1","org_id":1,"freigabestufe":"alles","seit":0,"bis":3}"#,
        )
        .unwrap();
        assert!(l.zeilen.is_empty() && l.konten.is_empty());
    }

    #[test]
    fn listen_ueber_der_grenze_und_doppelte_einsaetze_sind_ungueltig() {
        let l = EinsatzLieferung {
            kennung: "a/1".into(),
            ..Default::default()
        };
        let mut p = SpiegelPaket {
            lieferungen: vec![l.clone(), l],
            ..Default::default()
        };
        assert!(p.check().is_err(), "doppelt");
        p.lieferungen.pop();
        assert!(p.check().is_ok());
        p.staende = vec![
            EinsatzStand {
                kennung: "x".into(),
                stand: 0
            };
            EINSAETZE_MAX + 1
        ];
        assert!(p.check().is_err());
        p.staende.clear();
        let ende = Lebensende {
            kennung: "x".into(),
            art: LEBENSENDE_GELOESCHT.into(),
            stand: 0,
            kategorien: Vec::new(),
        };
        p.lebensende = vec![ende.clone(); EINSAETZE_MAX + 1];
        assert!(p.check().is_err(), "zu viele Lebensenden");
        p.lebensende = vec![Lebensende {
            kategorien: vec![
                KategorieFrist {
                    kategorie: "anhaenge".into(),
                    frist_bis: None,
                    rechtsgrundlage: "RG".into(),
                    vorgemerkt_at: None,
                    geschwaerzt_at: None,
                };
                KATEGORIEN_MAX + 1
            ],
            ..ende
        }];
        assert!(p.check().is_err(), "zu viele Kategorien");
        p.lebensende.clear();
        p.lebensende_quittungen = vec![
            LebensendeQuittung {
                kennung: "x".into(),
                ergebnis: VERWAHRUNG_WARTET.into(),
                grund: None,
            };
            EINSAETZE_MAX + 1
        ];
        assert!(p.check().is_err(), "zu viele Quittungen");
    }

    #[test]
    fn lieferung_mit_stand_vor_dem_beginn_ist_ungueltig() {
        let mut p = SpiegelPaket {
            lieferungen: vec![EinsatzLieferung {
                kennung: "a/1".into(),
                seit: 5,
                bis: 5,
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(p.check().is_ok());
        p.lieferungen[0].seit = 6;
        assert!(p.check().is_err());
    }
}

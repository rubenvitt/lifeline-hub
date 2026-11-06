//! Einsatzperioden aus einer Ereignisfolge — rein, ohne DB (Muster `einheit::repo::leite_status_ab`).
//!
//! Dieselbe Funktion prüft beim Einfügen, beim Streichen, beim Ersetzen (LLH-1455) und bildet
//! beim Lesen die Perioden (design.md D3). Die Regeln (Spec „Einsatzperioden"):
//! - eine Periode beginnt mit Alarmierung oder Eintreffen, wenn keine offen ist;
//! - sie endet mit Ablösung oder Entlassung;
//! - in einer offenen Periode höchstens eine Alarmierung und ein Eintreffen, und die
//!   Alarmierung liegt nicht nach dem Eintreffen;
//! - kein Ende ohne offene Periode.
//!
//! Geordnet wird nach `(zeitpunkt, id)`: bei gleicher Sekunde gilt die Reihenfolge der
//! Erfassung, ein Kandidat beim Einfügen steht also hinter dem Bestand.

use super::{Einsatzperiode, ZeitachseArt};
use crate::zeitdarstellung::Zeitstil;

/// Ein nicht gestrichenes Ereignis als Eingabe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ereignis {
    pub id: i64,
    pub art: ZeitachseArt,
    pub zeitpunkt_at: String,
}

/// Verstoß gegen die Perioden-Regeln; [`Verstoss::text`] ist der Text der 422.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verstoss {
    DoppelteAlarmierung {
        zeitpunkt_at: String,
    },
    AlarmierungNachEintreffen {
        zeitpunkt_at: String,
    },
    DoppeltesEintreffen {
        zeitpunkt_at: String,
    },
    EndeOhnePeriode {
        zeitpunkt_at: String,
    },
    /// Eine nachgetragene Periode (LLH-1538) bildet im Ergebnis keine eigene: ein bestehendes
    /// Ereignis liegt in ihr, oder ihr Ende schlösse eine andere Periode.
    PeriodeUeberschneidet {
        beginn_at: String,
    },
}

impl Verstoss {
    /// Text der 422. Der Zeitpunkt steht in Zone und Darstellung des Einsatzes, Rolle
    /// „Zeitpunkt“ (LLH-1541, Spec `zeitdarstellung`), nie im UTC-Drahtformat.
    pub fn text(&self, stil: &Zeitstil) -> String {
        match self {
            Self::DoppelteAlarmierung { zeitpunkt_at } => format!(
                "Die Einsatzperiode trägt schon eine Alarmierung ({})",
                stil.zeitpunkt_text(zeitpunkt_at)
            ),
            Self::AlarmierungNachEintreffen { zeitpunkt_at } => format!(
                "Eine Alarmierung ({}) darf nicht nach dem Eintreffen derselben Periode liegen",
                stil.zeitpunkt_text(zeitpunkt_at)
            ),
            Self::DoppeltesEintreffen { zeitpunkt_at } => format!(
                "Die Einsatzperiode trägt schon ein Eintreffen ({})",
                stil.zeitpunkt_text(zeitpunkt_at)
            ),
            Self::EndeOhnePeriode { zeitpunkt_at } => format!(
                "Zum Ende ({}) gibt es keine offene Einsatzperiode",
                stil.zeitpunkt_text(zeitpunkt_at)
            ),
            Self::PeriodeUeberschneidet { beginn_at } => format!(
                "Die Periode ab {} überschneidet eine bestehende Einsatzperiode",
                stil.zeitpunkt_text(beginn_at)
            ),
        }
    }
}

/// Bildet die Perioden streng: der erste Verstoß bricht ab.
pub fn bilde(folge: &[Ereignis]) -> Result<Vec<Einsatzperiode>, Verstoss> {
    gehe(folge, true)
}

/// Bildet die Perioden zum Lesen: ein Ereignis, das die Regeln verletzt, wird übergangen statt
/// die Anzeige zu brechen. Schreibpfade prüfen streng, der Bestand ist also regelkonform; das
/// hier ist nur das Netz.
pub fn bilde_nachsichtig(folge: &[Ereignis]) -> Vec<Einsatzperiode> {
    gehe(folge, false).unwrap_or_default()
}

/// Prüft, ob `kandidat` zum Bestand passt (Einfügen an seiner Zeitstelle, nicht nur am Ende).
pub fn pruefe_einfuegen(
    bestand: &[Ereignis],
    art: ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<(), Verstoss> {
    let mut folge = bestand.to_vec();
    folge.push(Ereignis {
        id: i64::MAX,
        art,
        zeitpunkt_at: zeitpunkt_at.to_string(),
    });
    bilde(&folge).map(|_| ())
}

/// Prüft, ob der Bestand ohne die Ereignisse `ids` regelkonform bleibt.
pub fn pruefe_streichen(bestand: &[Ereignis], ids: &[i64]) -> Result<(), Verstoss> {
    let folge: Vec<Ereignis> = bestand
        .iter()
        .filter(|e| !ids.contains(&e.id))
        .cloned()
        .collect();
    bilde(&folge).map(|_| ())
}

/// Bildet die Perioden, die entstehen, wenn das Ereignis `id` durch eines der Art `art` zum
/// Zeitpunkt `zeitpunkt_at` ersetzt wird (LLH-1455, „Zeitpunkt berichtigen“). Geprüft wird nur
/// das Ergebnis, nie der Zwischenstand ohne das alte Ereignis: so lässt sich auch der Anker einer
/// Periode oder die Entlassung, die sie schließt, verschieben. Der Kandidat steht bei gleicher
/// Sekunde hinter dem Bestand, wie beim Einfügen.
pub fn ersetze(
    bestand: &[Ereignis],
    id: i64,
    art: ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<Vec<Einsatzperiode>, Verstoss> {
    let mut folge: Vec<Ereignis> = bestand.iter().filter(|e| e.id != id).cloned().collect();
    folge.push(Ereignis {
        id: i64::MAX,
        art,
        zeitpunkt_at: zeitpunkt_at.to_string(),
    });
    bilde(&folge)
}

/// Eine abgeschlossene Periode zum Nachtragen (LLH-1538): Beginn mit Alarmierung und/oder
/// Eintreffen, Ende mit der Entlassung. Die Reihenfolge der Zeitpunkte prüft der Aufrufer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NeuePeriode {
    pub alarmierung_at: Option<String>,
    pub eintreffen_at: Option<String>,
    pub entlassung_at: String,
}

impl NeuePeriode {
    /// Die Ereignisse in Zeitfolge: Alarmierung, Eintreffen, Entlassung (die vorhandenen).
    pub fn ereignisse(&self) -> Vec<(ZeitachseArt, &str)> {
        let mut v = Vec::with_capacity(3);
        if let Some(a) = &self.alarmierung_at {
            v.push((ZeitachseArt::Alarmierung, a.as_str()));
        }
        if let Some(e) = &self.eintreffen_at {
            v.push((ZeitachseArt::Eintreffen, e.as_str()));
        }
        v.push((ZeitachseArt::Entlassung, self.entlassung_at.as_str()));
        v
    }

    /// Zeitpunkt und Art des Ankers: die Alarmierung, ohne sie das Eintreffen.
    fn anker(&self) -> Option<(ZeitachseArt, &str)> {
        match (&self.alarmierung_at, &self.eintreffen_at) {
            (Some(a), _) => Some((ZeitachseArt::Alarmierung, a.as_str())),
            (None, Some(e)) => Some((ZeitachseArt::Eintreffen, e.as_str())),
            (None, None) => None,
        }
    }
}

/// Bildet die Perioden, die entstehen, wenn `neu` zum Bestand kommt (LLH-1538, „Periode
/// nachtragen“). Wie [`ersetze`] wird nur das Ergebnis geprüft, nie ein Zwischenstand: so passt
/// eine Alarmierung auch vor eine spätere Periode, die bis zu ihrem Ende als offen gälte. Die
/// Kandidaten stehen bei gleicher Sekunde hinter dem Bestand, untereinander in Zeitfolge.
///
/// Dazu MUSS das Ergebnis genau die Periode enthalten, die `neu` beschreibt (gleicher Anker,
/// gleiches Eintreffen, Ende mit dieser Entlassung), sonst [`Verstoss::PeriodeUeberschneidet`]:
/// ein bestehendes Eintreffen darin oder eine Entlassung, die eine andere Periode schlösse.
pub fn fuege_periode_ein(
    bestand: &[Ereignis],
    neu: &NeuePeriode,
) -> Result<Vec<Einsatzperiode>, Verstoss> {
    let Some((anker, beginn_at)) = neu.anker() else {
        return Err(Verstoss::EndeOhnePeriode {
            zeitpunkt_at: neu.entlassung_at.clone(),
        });
    };
    let mut folge = bestand.to_vec();
    let kandidaten = neu.ereignisse();
    let basis = i64::MAX - kandidaten.len() as i64;
    for (i, (art, zeitpunkt_at)) in kandidaten.into_iter().enumerate() {
        folge.push(Ereignis {
            id: basis + 1 + i as i64,
            art,
            zeitpunkt_at: zeitpunkt_at.to_string(),
        });
    }
    let perioden = bilde(&folge)?;
    let eigene = Einsatzperiode {
        beginn_at: beginn_at.to_string(),
        anker,
        eintreffen_at: neu.eintreffen_at.clone(),
        ende_at: Some(neu.entlassung_at.clone()),
        ende_art: Some(ZeitachseArt::Entlassung),
    };
    if perioden.contains(&eigene) {
        Ok(perioden)
    } else {
        Err(Verstoss::PeriodeUeberschneidet {
            beginn_at: beginn_at.to_string(),
        })
    }
}

/// Das Eintreffen der offenen Periode, falls es eine gibt und sie eins trägt.
pub fn offenes_eintreffen(perioden: &[Einsatzperiode]) -> Option<&str> {
    perioden
        .last()
        .filter(|p| p.ende_at.is_none())
        .and_then(|p| p.eintreffen_at.as_deref())
}

/// Die Alarmierung, mit der die offene Periode beginnt, falls sie eine hat (LLH-1131).
pub fn offene_alarmierung(perioden: &[Einsatzperiode]) -> Option<&str> {
    perioden
        .last()
        .filter(|p| p.ende_at.is_none() && p.anker == ZeitachseArt::Alarmierung)
        .map(|p| p.beginn_at.as_str())
}

fn gehe(folge: &[Ereignis], streng: bool) -> Result<Vec<Einsatzperiode>, Verstoss> {
    let mut sortiert: Vec<&Ereignis> = folge.iter().collect();
    sortiert.sort_by(|a, b| {
        a.zeitpunkt_at
            .cmp(&b.zeitpunkt_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut perioden: Vec<Einsatzperiode> = Vec::new();
    let mut offen: Option<Einsatzperiode> = None;
    for e in sortiert {
        let z = e.zeitpunkt_at.clone();
        let verstoss = match (e.art, offen.as_mut()) {
            (ZeitachseArt::Alarmierung, None) => {
                offen = Some(Einsatzperiode {
                    beginn_at: z,
                    anker: ZeitachseArt::Alarmierung,
                    eintreffen_at: None,
                    ende_at: None,
                    ende_art: None,
                });
                None
            }
            (ZeitachseArt::Alarmierung, Some(p)) => Some(if p.eintreffen_at.is_some() {
                Verstoss::AlarmierungNachEintreffen { zeitpunkt_at: z }
            } else {
                Verstoss::DoppelteAlarmierung { zeitpunkt_at: z }
            }),
            (ZeitachseArt::Eintreffen, None) => {
                offen = Some(Einsatzperiode {
                    beginn_at: z.clone(),
                    anker: ZeitachseArt::Eintreffen,
                    eintreffen_at: Some(z),
                    ende_at: None,
                    ende_art: None,
                });
                None
            }
            (ZeitachseArt::Eintreffen, Some(p)) => {
                if p.eintreffen_at.is_some() {
                    Some(Verstoss::DoppeltesEintreffen { zeitpunkt_at: z })
                } else {
                    p.eintreffen_at = Some(z);
                    None
                }
            }
            (ende, Some(p)) => {
                debug_assert!(ende.ist_ende());
                p.ende_at = Some(z);
                p.ende_art = Some(ende);
                None
            }
            (_, None) => Some(Verstoss::EndeOhnePeriode { zeitpunkt_at: z }),
        };
        if offen.as_ref().is_some_and(|p| p.ende_at.is_some()) {
            perioden.extend(offen.take());
        }
        if let Some(v) = verstoss {
            if streng {
                return Err(v);
            }
        }
    }
    perioden.extend(offen);
    Ok(perioden)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ZeitachseArt::*;

    fn e(id: i64, art: ZeitachseArt, zeit: &str) -> Ereignis {
        Ereignis {
            id,
            art,
            zeitpunkt_at: format!("2026-09-30 {zeit}:00"),
        }
    }

    fn t(zeit: &str) -> String {
        format!("2026-09-30 {zeit}:00")
    }

    /// Spec „Zwei Perioden".
    #[test]
    fn zwei_perioden() {
        let p = bilde(&[
            e(1, Alarmierung, "06:10"),
            e(2, Eintreffen, "06:40"),
            e(3, Abloesung, "14:40"),
            e(4, Alarmierung, "22:00"),
        ])
        .unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].beginn_at, t("06:10"));
        assert_eq!(p[0].anker, Alarmierung);
        assert_eq!(p[0].eintreffen_at.as_deref(), Some(t("06:40").as_str()));
        assert_eq!(p[0].ende_at.as_deref(), Some(t("14:40").as_str()));
        assert_eq!(p[0].ende_art, Some(Abloesung));
        assert_eq!(p[1].beginn_at, t("22:00"));
        assert_eq!(p[1].ende_at, None, "offen");
    }

    /// Spec „Eintreffen ohne Alarmierung": das Eintreffen ist der Anker.
    #[test]
    fn eintreffen_ohne_alarmierung_ist_anker() {
        let p = bilde(&[e(1, Eintreffen, "07:00")]).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].anker, Eintreffen);
        assert_eq!(p[0].beginn_at, t("07:00"));
    }

    #[test]
    fn leere_folge_hat_keine_periode() {
        assert_eq!(bilde(&[]).unwrap(), vec![]);
    }

    #[test]
    fn ordnet_nach_zeit_nicht_nach_erfassung() {
        // Das Eintreffen wurde zuerst erfasst, die Alarmierung später nachgetragen.
        let p = bilde(&[e(9, Eintreffen, "06:40"), e(10, Alarmierung, "06:10")]).unwrap();
        assert_eq!(p[0].anker, Alarmierung);
        assert_eq!(p[0].beginn_at, t("06:10"));
    }

    #[test]
    fn verstoesse() {
        assert!(matches!(
            bilde(&[e(1, Alarmierung, "06:10"), e(2, Alarmierung, "06:20")]),
            Err(Verstoss::DoppelteAlarmierung { .. })
        ));
        assert!(matches!(
            bilde(&[e(1, Eintreffen, "06:40"), e(2, Alarmierung, "07:00")]),
            Err(Verstoss::AlarmierungNachEintreffen { .. })
        ));
        assert!(matches!(
            bilde(&[e(1, Eintreffen, "06:40"), e(2, Eintreffen, "06:55")]),
            Err(Verstoss::DoppeltesEintreffen { .. })
        ));
        assert!(matches!(
            bilde(&[e(1, Entlassung, "06:40")]),
            Err(Verstoss::EndeOhnePeriode { .. })
        ));
    }

    /// LLH-1541: die vier Texte der 422 nennen den Zeitpunkt in Zone und Darstellung des
    /// Einsatzes. 04:40 UTC ist in Tokio 13:40.
    #[test]
    fn texte_nennen_den_zeitpunkt_im_zeitstil() {
        use crate::zeitdarstellung::Zeitdarstellung;
        let taktisch = Zeitstil::new(chrono_tz::Asia::Tokyo, Zeitdarstellung::Taktisch);
        let datum = Zeitstil::new(chrono_tz::Asia::Tokyo, Zeitdarstellung::DatumUhrzeit);
        let z = || t("04:40");
        let faelle = [
            (
                Verstoss::DoppelteAlarmierung { zeitpunkt_at: z() },
                "Die Einsatzperiode trägt schon eine Alarmierung (301340sep26)",
                "Die Einsatzperiode trägt schon eine Alarmierung (30.09.26 13:40)",
            ),
            (
                Verstoss::AlarmierungNachEintreffen { zeitpunkt_at: z() },
                "Eine Alarmierung (301340sep26) darf nicht nach dem Eintreffen derselben Periode liegen",
                "Eine Alarmierung (30.09.26 13:40) darf nicht nach dem Eintreffen derselben Periode liegen",
            ),
            (
                Verstoss::DoppeltesEintreffen { zeitpunkt_at: z() },
                "Die Einsatzperiode trägt schon ein Eintreffen (301340sep26)",
                "Die Einsatzperiode trägt schon ein Eintreffen (30.09.26 13:40)",
            ),
            (
                Verstoss::EndeOhnePeriode { zeitpunkt_at: z() },
                "Zum Ende (301340sep26) gibt es keine offene Einsatzperiode",
                "Zum Ende (30.09.26 13:40) gibt es keine offene Einsatzperiode",
            ),
        ];
        for (v, erwartet_taktisch, erwartet_datum) in faelle {
            assert_eq!(v.text(&taktisch), erwartet_taktisch);
            assert_eq!(v.text(&datum), erwartet_datum);
        }
    }

    /// Ein Nachtrag in die Vergangenheit wird an seiner Zeitstelle geprüft: ein Eintreffen um
    /// 12:00 zerbräche die Periode 06:40–14:40, die schon ein Eintreffen trägt.
    #[test]
    fn nachtrag_prueft_an_der_zeitstelle() {
        let bestand = [
            e(1, Eintreffen, "06:40"),
            e(2, Entlassung, "14:40"),
            e(3, Alarmierung, "22:00"),
        ];
        assert!(matches!(
            pruefe_einfuegen(&bestand, Eintreffen, &t("12:00")),
            Err(Verstoss::DoppeltesEintreffen { .. })
        ));
        // Vor der ersten Periode passt eine eigene, beendete Periode nicht (Ende fehlt), eine
        // Alarmierung vor dem Eintreffen schon.
        assert!(pruefe_einfuegen(&bestand, Alarmierung, &t("06:10")).is_ok());
        // Eintreffen in der offenen Periode ab 22:00.
        assert!(pruefe_einfuegen(&bestand, Eintreffen, &t("22:30")).is_ok());
        // Ein Ende zwischen den Perioden hat keine offene Periode.
        assert!(matches!(
            pruefe_einfuegen(&bestand, Entlassung, &t("18:00")),
            Err(Verstoss::EndeOhnePeriode { .. })
        ));
    }

    /// Bei gleicher Sekunde steht der Kandidat hinter dem Bestand.
    #[test]
    fn gleiche_sekunde_kandidat_zuletzt() {
        let bestand = [e(1, Alarmierung, "06:10")];
        assert!(pruefe_einfuegen(&bestand, Eintreffen, &t("06:10")).is_ok());
        assert!(pruefe_einfuegen(&bestand, Entlassung, &t("06:10")).is_ok());
    }

    #[test]
    fn streichen_prueft_den_rest() {
        let bestand = [e(1, Eintreffen, "06:40"), e(2, Entlassung, "14:40")];
        assert!(matches!(
            pruefe_streichen(&bestand, &[1]),
            Err(Verstoss::EndeOhnePeriode { .. })
        ));
        assert!(pruefe_streichen(&bestand, &[2]).is_ok());
        assert!(pruefe_streichen(&bestand, &[1, 2]).is_ok());
    }

    /// LLH-1455: Das Eintreffen als Anker lässt sich verschieben, obwohl der Zwischenstand ohne
    /// es die Entlassung ohne Periode ließe.
    #[test]
    fn ersetzen_verschiebt_den_anker() {
        let bestand = [e(1, Eintreffen, "06:40"), e(2, Entlassung, "14:00")];
        assert!(
            pruefe_streichen(&bestand, &[1]).is_err(),
            "Zwischenstand bricht"
        );
        let p = ersetze(&bestand, 1, Eintreffen, &t("06:30")).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].beginn_at, t("06:30"));
        assert_eq!(p[0].ende_at.as_deref(), Some(t("14:00").as_str()));
    }

    /// LLH-1455: Die abschließende Entlassung lässt sich verschieben, ein zweites Ende entsteht
    /// nicht.
    #[test]
    fn ersetzen_verschiebt_das_ende() {
        let bestand = [
            e(1, Alarmierung, "06:10"),
            e(2, Eintreffen, "06:40"),
            e(3, Entlassung, "14:00"),
        ];
        let p = ersetze(&bestand, 3, Entlassung, &t("13:30")).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].ende_at.as_deref(), Some(t("13:30").as_str()));
    }

    #[test]
    fn ersetzen_prueft_das_ergebnis() {
        let bestand = [e(1, Alarmierung, "06:10"), e(2, Eintreffen, "06:40")];
        assert!(matches!(
            ersetze(&bestand, 1, Alarmierung, &t("07:00")),
            Err(Verstoss::AlarmierungNachEintreffen { .. })
        ));
        let zu = [e(1, Eintreffen, "06:40"), e(2, Entlassung, "14:00")];
        assert!(matches!(
            ersetze(&zu, 2, Entlassung, &t("06:00")),
            Err(Verstoss::EndeOhnePeriode { .. })
        ));
        // Eine Entlassung vor das Eintreffen schließt eine Periode früh, das Eintreffen öffnet
        // danach eine neue: regelkonform, aber offen.
        let drei = [
            e(1, Alarmierung, "06:10"),
            e(2, Eintreffen, "06:40"),
            e(3, Entlassung, "14:00"),
        ];
        let p = ersetze(&drei, 3, Entlassung, &t("06:20")).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[1].ende_at, None);
    }

    fn periode(a: Option<&str>, e: Option<&str>, ende: &str) -> NeuePeriode {
        NeuePeriode {
            alarmierung_at: a.map(t),
            eintreffen_at: e.map(t),
            entlassung_at: t(ende),
        }
    }

    /// LLH-1538: Eine Periode vor der laufenden passt, obwohl eine Alarmierung allein dort als
    /// zweite der offenen Periode gälte.
    #[test]
    fn periode_vor_der_laufenden() {
        let bestand = [e(1, Alarmierung, "22:00")];
        assert!(
            pruefe_einfuegen(&bestand, Alarmierung, &t("06:10")).is_err(),
            "einzeln bricht"
        );
        let p =
            fuege_periode_ein(&bestand, &periode(Some("06:10"), Some("06:40"), "14:00")).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].beginn_at, t("06:10"));
        assert_eq!(p[0].eintreffen_at.as_deref(), Some(t("06:40").as_str()));
        assert_eq!(p[0].ende_at.as_deref(), Some(t("14:00").as_str()));
        assert_eq!(p[1].ende_at, None, "die laufende bleibt offen");
    }

    /// LLH-1538: An einer entlassenen Person (alles geschlossen) entsteht eine zweite
    /// abgeschlossene Periode, nur mit dem Eintreffen als Anker.
    #[test]
    fn periode_an_abgeschlossenem_bestand() {
        let bestand = [e(1, Eintreffen, "14:00"), e(2, Entlassung, "18:00")];
        let p = fuege_periode_ein(&bestand, &periode(None, Some("06:40"), "12:00")).unwrap();
        assert_eq!(p.len(), 2);
        assert!(p.iter().all(|p| p.ende_at.is_some()));
        assert_eq!(p[0].anker, Eintreffen);
    }

    #[test]
    fn periode_ueberschneidet() {
        // Eine laufende Periode mit Eintreffen 11:00: Alarmierung 10:00 und Entlassung 12:00
        // ergäben eine regelkonforme Periode, die aber das bestehende Eintreffen schluckt und die
        // laufende schlösse.
        let laufend = [e(1, Eintreffen, "11:00")];
        assert!(matches!(
            fuege_periode_ein(&laufend, &periode(Some("10:00"), None, "12:00")),
            Err(Verstoss::PeriodeUeberschneidet { .. })
        ));
        // In eine abgeschlossene Periode hinein: Regelverstoß schon beim Bilden.
        let zu = [e(1, Eintreffen, "06:40"), e(2, Entlassung, "14:00")];
        assert!(fuege_periode_ein(&zu, &periode(None, Some("08:00"), "09:00")).is_err());
        // Über eine abgeschlossene hinweg: die bestehende Entlassung schlösse die neue.
        assert!(fuege_periode_ein(&zu, &periode(Some("06:00"), None, "15:00")).is_err());
    }

    #[test]
    fn periode_ohne_beginn_ist_ende_ohne_periode() {
        assert!(matches!(
            fuege_periode_ein(&[], &periode(None, None, "12:00")),
            Err(Verstoss::EndeOhnePeriode { .. })
        ));
    }

    /// Gleiche Sekunde: Alarmierung, Eintreffen und Entlassung in dieser Folge, hinter dem
    /// Bestand; eine Periode, die genau mit dem Ende einer anderen beginnt, passt.
    #[test]
    fn periode_gleiche_sekunde() {
        let bestand = [e(1, Eintreffen, "06:00"), e(2, Entlassung, "08:00")];
        let p =
            fuege_periode_ein(&bestand, &periode(Some("08:00"), Some("08:00"), "09:00")).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[1].eintreffen_at.as_deref(), Some(t("08:00").as_str()));
    }

    #[test]
    fn nachsichtig_uebergeht_verstoesse() {
        let p = bilde_nachsichtig(&[
            e(1, Entlassung, "05:00"),
            e(2, Eintreffen, "06:40"),
            e(3, Eintreffen, "06:50"),
        ]);
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].eintreffen_at.as_deref(), Some(t("06:40").as_str()));
    }

    #[test]
    fn offenes_eintreffen_nur_in_offener_periode() {
        let offen = bilde(&[e(1, Alarmierung, "06:10"), e(2, Eintreffen, "06:40")]).unwrap();
        assert_eq!(offenes_eintreffen(&offen), Some(t("06:40").as_str()));
        let zu = bilde(&[e(1, Eintreffen, "06:40"), e(2, Entlassung, "08:00")]).unwrap();
        assert_eq!(offenes_eintreffen(&zu), None);
        let ohne = bilde(&[e(1, Alarmierung, "06:10")]).unwrap();
        assert_eq!(offenes_eintreffen(&ohne), None);
    }
}

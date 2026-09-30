//! Einsatzperioden aus einer Ereignisfolge — rein, ohne DB (Muster `einheit::repo::leite_status_ab`).
//!
//! Dieselbe Funktion prüft beim Einfügen, beim Streichen und bildet beim Lesen die Perioden
//! (design.md D3). Die Regeln (Spec „Einsatzperioden"):
//! - eine Periode beginnt mit Alarmierung oder Eintreffen, wenn keine offen ist;
//! - sie endet mit Ablösung oder Entlassung;
//! - in einer offenen Periode höchstens eine Alarmierung und ein Eintreffen, und die
//!   Alarmierung liegt nicht nach dem Eintreffen;
//! - kein Ende ohne offene Periode.
//!
//! Geordnet wird nach `(zeitpunkt, id)`: bei gleicher Sekunde gilt die Reihenfolge der
//! Erfassung, ein Kandidat beim Einfügen steht also hinter dem Bestand.

use super::{Einsatzperiode, ZeitachseArt};

/// Ein nicht gestrichenes Ereignis als Eingabe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ereignis {
    pub id: i64,
    pub art: ZeitachseArt,
    pub zeitpunkt_at: String,
}

/// Verstoß gegen die Perioden-Regeln; `Display` ist der Text der 422.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verstoss {
    DoppelteAlarmierung { zeitpunkt_at: String },
    AlarmierungNachEintreffen { zeitpunkt_at: String },
    DoppeltesEintreffen { zeitpunkt_at: String },
    EndeOhnePeriode { zeitpunkt_at: String },
}

impl std::fmt::Display for Verstoss {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DoppelteAlarmierung { zeitpunkt_at } => write!(
                f,
                "Die Einsatzperiode trägt schon eine Alarmierung ({zeitpunkt_at})"
            ),
            Self::AlarmierungNachEintreffen { zeitpunkt_at } => write!(
                f,
                "Eine Alarmierung ({zeitpunkt_at}) darf nicht nach dem Eintreffen derselben Periode liegen"
            ),
            Self::DoppeltesEintreffen { zeitpunkt_at } => write!(
                f,
                "Die Einsatzperiode trägt schon ein Eintreffen ({zeitpunkt_at})"
            ),
            Self::EndeOhnePeriode { zeitpunkt_at } => write!(
                f,
                "Zum Ende ({zeitpunkt_at}) gibt es keine offene Einsatzperiode"
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

/// Das Eintreffen der offenen Periode, falls es eine gibt und sie eins trägt.
pub fn offenes_eintreffen(perioden: &[Einsatzperiode]) -> Option<&str> {
    perioden
        .last()
        .filter(|p| p.ende_at.is_none())
        .and_then(|p| p.eintreffen_at.as_deref())
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

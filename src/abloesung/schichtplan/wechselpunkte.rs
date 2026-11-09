//! Wechselpunkte des Schichtplans für die Wechsel-Leiste (LLH-1555 Welle 3, Change
//! `qo0amhd5-wechsel-aus-schichtplan`; Spec `kraefte-schichtplan`, „Wechsel-Leiste“).
//!
//! Ein **Wechselpunkt** ist ein Zeitpunkt, zu dem laut Plan etwas zu tun ist:
//!
//! - an einer **Einheit** das Ende eines Blocks oder der Beginn eines Blocks ohne Vorgänger; ein
//!   Block, der binnen [`WECHSEL_TOLERANZ_MINUTEN`] nach dem Ende eines Blocks derselben Einheit
//!   beginnt, ist sein Folgeblock und gehört zum Wechsel am Ende (wie die Fälligkeit laut Plan,
//!   `kopplung`);
//! - an einer **UHS** der Beginn eines Blocks (Welle 2: Kommen und Gehen am Beginn);
//! - in der **Pause** Beginn und Ende eines Blocks.
//!
//! Den Stand eines Eintrags rechnet [`wechselpunkte`] rein aus dem, was `repo` lädt: offen,
//! vollzogen oder, an einer Einheit, ohne laufende Schicht laut Plan (dann gibt es in der
//! Ablösung nichts zu vollziehen). Der Client zeigt die Liste nur und rechnet nichts nach
//! (`frontend/src/kraefte/AGENTS.md`, Schichtplan).
//!
//! Gezeigt werden die Zeitpunkte der nächsten [`VORSCHAU_STUNDEN`] und die der letzten
//! [`RUECKSCHAU_STUNDEN`], an denen noch etwas offen ist.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use super::kopplung::WECHSEL_TOLERANZ_MINUTEN;
use super::vollzug::WechselArt;
use super::Posten;
use crate::wire_enum::wire_enum;
use crate::zeit;

/// So weit voraus zeigt die Leiste Wechselpunkte.
pub const VORSCHAU_STUNDEN: i64 = 24;
/// So weit zurück zeigt sie Wechselpunkte, an denen noch etwas offen ist.
pub const RUECKSCHAU_STUNDEN: i64 = 12;

wire_enum! {
    /// Was an einem Wechselpunkt zu tun ist. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum PlanWechselEintragArt {
        /// Die Schicht einer Einheit wechselt (Vollzug in der Ablösung).
        Einheit => "einheit",
        /// Kräfte kommen an eine UHS und gehen.
        Uhs => "uhs",
        /// Eine Pause beginnt.
        PauseBeginn => "pause_beginn",
        /// Eine Pause endet.
        PauseEnde => "pause_ende",
    }
    try_from = |s| format!("Ungültige Art eines Wechselpunkts: {s}");
}

wire_enum! {
    /// Was an einer Einheit geschieht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PlanWechselEinheit {
        /// Der Block endet, der Folgeblock beginnt (binnen der Toleranz).
        Wechsel => "wechsel",
        /// Ein Block ohne Vorgänger beginnt: der Posten beginnt.
        Beginn => "beginn",
        /// Der Block endet ohne Folgeblock: der Posten endet.
        Ende => "ende",
    }
    try_from = |s| format!("Ungültiger Wechsel an einer Einheit: {s}");
}

wire_enum! {
    /// Stand eines Eintrags der Wechsel-Leiste. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum PlanWechselStand {
        /// Noch zu vollziehen.
        Offen => "offen",
        /// Vollzogen und nicht zurückgenommen.
        Vollzogen => "vollzogen",
        /// Nur an einer Einheit: keine Schicht, die laut Plan zu diesem Zeitpunkt fällig ist,
        /// und kein Vollzug in den Folgeblock. In der Ablösung gibt es nichts zu tun.
        OhneSchicht => "ohne_schicht",
    }
    try_from = |s| format!("Ungültiger Stand eines Wechselpunkts: {s}");
}

/// Ein Eintrag eines Wechselpunkts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PlanWechselEintrag {
    #[schema(value_type = PlanWechselEintragArt)]
    pub art: PlanWechselEintragArt,
    #[schema(value_type = PlanWechselStand)]
    pub stand: PlanWechselStand,
    /// Der Block, um den es geht: an einer Einheit der Folgeblock, ohne ihn der endende Block.
    pub block_id: i64,
    /// Nur an einer Einheit: Wechsel, Beginn oder Ende des Postens.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<PlanWechselEinheit>)]
    pub einheit: Option<PlanWechselEinheit>,
    /// Nur an einer Einheit mit Stand `offen`: die Schicht, die zu vollziehen ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abloesung_id: Option<i64>,
}

/// Ein Zeitpunkt der Wechsel-Leiste.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PlanWechselpunkt {
    /// Zeitpunkt laut Plan (UTC).
    pub zeitpunkt: String,
    /// Derselbe Zeitpunkt in Minuten seit 1970: Schlüssel des gebündelten Hinweises
    /// (Bezug `schichtplan_wechsel`) und des Sprungs `?wechsel=`.
    pub minute: i64,
    /// Nach Art, dann nach Block.
    pub eintraege: Vec<PlanWechselEintrag>,
}

/// Ein Block, soweit die Leiste ihn braucht.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockGrenzen {
    pub id: i64,
    pub posten: Posten,
    pub von: DateTime<Utc>,
    pub bis: DateTime<Utc>,
}

/// Was die Ablösung und die Wechsel aus dem Plan schon wissen.
#[derive(Debug, Default)]
pub struct Stand {
    /// Laufende Schichten laut Plan: (Einheit, Fälligkeit) → Schicht.
    pub faellig: HashMap<(i64, DateTime<Utc>), i64>,
    /// Blöcke, in die ein Vollzug aus dem Plan gewechselt hat (`einsatz_abloesung.plan_block_id`).
    pub gewechselt_in: HashSet<i64>,
    /// Schichten laut Plan, die nicht mehr laufen (vollzogen, abgezogen): (Einheit, Fälligkeit).
    /// Trägt „vollzogen“ dort, wo kein Folgeblock das Ziel ist (der Posten endet).
    pub abgeschlossen: HashSet<(i64, DateTime<Utc>)>,
    /// Vollzogene, nicht zurückgenommene Wechsel an UHS und Pause: (Block, Art).
    pub vollzogen: HashSet<(i64, WechselArt)>,
}

fn minute(t: DateTime<Utc>) -> i64 {
    t.timestamp().div_euclid(60)
}

/// Die Wechselpunkte im Fenster um `jetzt`, aufsteigend nach Zeitpunkt.
pub fn wechselpunkte(
    bloecke: &[BlockGrenzen],
    stand: &Stand,
    jetzt: DateTime<Utc>,
) -> Vec<PlanWechselpunkt> {
    let mut je_zeitpunkt: BTreeMap<DateTime<Utc>, Vec<PlanWechselEintrag>> = BTreeMap::new();
    let mut eintrag = |t: DateTime<Utc>, art, stand, block_id, einheit, abloesung_id| {
        je_zeitpunkt.entry(t).or_default().push(PlanWechselEintrag {
            art,
            stand,
            block_id,
            einheit,
            abloesung_id,
        });
    };

    // Einheiten: je Einheit die Blöcke nach Beginn.
    let mut je_einheit: BTreeMap<i64, Vec<&BlockGrenzen>> = BTreeMap::new();
    for b in bloecke {
        if let Posten::Einheit(e) = b.posten {
            je_einheit.entry(e).or_default().push(b);
        }
    }
    let toleranz = Duration::minutes(WECHSEL_TOLERANZ_MINUTEN);
    for (einheit, mut liste) in je_einheit {
        liste.sort_by_key(|b| (b.von, b.id));
        let folgeblock = |ende: DateTime<Utc>| {
            liste
                .iter()
                .find(|f| f.von >= ende && f.von <= ende + toleranz)
                .copied()
        };
        let mut ist_folgeblock: HashSet<i64> = HashSet::new();
        for b in &liste {
            if let Some(f) = folgeblock(b.bis) {
                ist_folgeblock.insert(f.id);
            }
        }
        // Die Schicht ist zum Wechselpunkt fällig oder, nach `kopplung`, zum Beginn des
        // Folgeblocks, wenn sie außerhalb des Plans in der Lücke davor begann.
        let einheit_stand = |zeiten: &[DateTime<Utc>], ziel: Option<i64>| {
            if let Some(&schicht) = zeiten
                .iter()
                .find_map(|t| stand.faellig.get(&(einheit, *t)))
            {
                (PlanWechselStand::Offen, Some(schicht))
            } else if ziel.is_some_and(|z| stand.gewechselt_in.contains(&z))
                || zeiten
                    .iter()
                    .any(|t| stand.abgeschlossen.contains(&(einheit, *t)))
            {
                (PlanWechselStand::Vollzogen, None)
            } else {
                (PlanWechselStand::OhneSchicht, None)
            }
        };
        for b in &liste {
            // Beginn eines Postens ohne Vorgänger: die erste Schicht beginnt.
            if !ist_folgeblock.contains(&b.id) {
                let (s, a) = einheit_stand(&[b.von], Some(b.id));
                let art = Some(PlanWechselEinheit::Beginn);
                eintrag(b.von, PlanWechselEintragArt::Einheit, s, b.id, art, a);
            }
            // Ende des Blocks: Wechsel in den Folgeblock oder der Posten endet.
            let f = folgeblock(b.bis);
            let zeiten: Vec<DateTime<Utc>> =
                std::iter::once(b.bis).chain(f.map(|f| f.von)).collect();
            let (s, a) = einheit_stand(&zeiten, f.map(|f| f.id));
            let block = f.map_or(b.id, |f| f.id);
            let art = Some(if f.is_some() {
                PlanWechselEinheit::Wechsel
            } else {
                PlanWechselEinheit::Ende
            });
            eintrag(b.bis, PlanWechselEintragArt::Einheit, s, block, art, a);
        }
    }

    for b in bloecke {
        let stand_von = |art| {
            if stand.vollzogen.contains(&(b.id, art)) {
                PlanWechselStand::Vollzogen
            } else {
                PlanWechselStand::Offen
            }
        };
        match b.posten {
            Posten::Einheit(_) => {}
            Posten::Uhs(_) => eintrag(
                b.von,
                PlanWechselEintragArt::Uhs,
                stand_von(WechselArt::Uhs),
                b.id,
                None,
                None,
            ),
            Posten::Pause => {
                eintrag(
                    b.von,
                    PlanWechselEintragArt::PauseBeginn,
                    stand_von(WechselArt::PauseBeginn),
                    b.id,
                    None,
                    None,
                );
                eintrag(
                    b.bis,
                    PlanWechselEintragArt::PauseEnde,
                    stand_von(WechselArt::PauseEnde),
                    b.id,
                    None,
                    None,
                );
            }
        }
    }

    let vorschau = jetzt + Duration::hours(VORSCHAU_STUNDEN);
    let rueckschau = jetzt - Duration::hours(RUECKSCHAU_STUNDEN);
    je_zeitpunkt
        .into_iter()
        .filter(|(t, liste)| {
            if *t >= jetzt {
                *t <= vorschau
            } else {
                *t >= rueckschau && liste.iter().any(|e| e.stand == PlanWechselStand::Offen)
            }
        })
        .map(|(t, mut eintraege)| {
            eintraege.sort_by_key(|e| (e.art, e.block_id));
            eintraege.dedup();
            PlanWechselpunkt {
                zeitpunkt: zeit::formatiere_utc(t),
                minute: minute(t),
                eintraege,
            }
        })
        .collect()
}

/// Die Einheiten, die laut Plan zum Zeitpunkt `t` wechseln, beginnen oder enden, wie die Leiste
/// sie zählt (ohne Stand): die Detailzeile des gebündelten Hinweises (`benachrichtigung::text`).
pub fn einheiten_am_zeitpunkt(bloecke: &[BlockGrenzen], t: DateTime<Utc>) -> Vec<i64> {
    let einheit_von: HashMap<i64, i64> = bloecke
        .iter()
        .filter_map(|b| b.posten.einheit_id().map(|e| (b.id, e)))
        .collect();
    let mut einheiten: Vec<i64> = wechselpunkte(bloecke, &Stand::default(), t)
        .into_iter()
        .filter(|p| p.minute == minute(t))
        .flat_map(|p| p.eintraege)
        .filter(|e| e.art == PlanWechselEintragArt::Einheit)
        .filter_map(|e| einheit_von.get(&e.block_id).copied())
        .collect();
    einheiten.sort_unstable();
    einheiten.dedup();
    einheiten
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(hm: &str) -> DateTime<Utc> {
        let (h, m) = hm.split_once(':').unwrap();
        Utc.with_ymd_and_hms(2026, 7, 4, h.parse().unwrap(), m.parse().unwrap(), 0)
            .unwrap()
    }

    fn block(id: i64, posten: Posten, von: &str, bis: &str) -> BlockGrenzen {
        BlockGrenzen {
            id,
            posten,
            von: t(von),
            bis: t(bis),
        }
    }

    fn arten(p: &PlanWechselpunkt) -> Vec<(PlanWechselEintragArt, PlanWechselStand, i64)> {
        p.eintraege
            .iter()
            .map(|e| (e.art, e.stand, e.block_id))
            .collect()
    }

    #[test]
    fn einheiten_mit_gleichem_wechsel_stehen_an_einem_zeitpunkt() {
        let bloecke = [
            block(1, Posten::Einheit(10), "08:00", "14:00"),
            block(2, Posten::Einheit(10), "14:00", "20:00"),
            block(3, Posten::Einheit(11), "08:00", "14:00"),
            block(4, Posten::Einheit(11), "14:05", "20:00"),
        ];
        let mut stand = Stand::default();
        stand.faellig.insert((10, t("14:00")), 100);
        stand.faellig.insert((11, t("14:00")), 101);
        let p = wechselpunkte(&bloecke, &stand, t("09:00"));
        let um_14: Vec<_> = p.iter().filter(|p| p.zeitpunkt.contains("14:00")).collect();
        assert_eq!(um_14.len(), 1, "{p:?}");
        assert_eq!(
            arten(um_14[0]),
            vec![
                (PlanWechselEintragArt::Einheit, PlanWechselStand::Offen, 2),
                (PlanWechselEintragArt::Einheit, PlanWechselStand::Offen, 4),
            ],
            "der Folgeblock binnen der Toleranz gehört zum Wechsel am Ende"
        );
        assert_eq!(um_14[0].eintraege[0].abloesung_id, Some(100));
        assert_eq!(um_14[0].minute, t("14:00").timestamp() / 60);
        assert!(
            !p.iter().any(|p| p.zeitpunkt.contains("14:05")),
            "kein eigener Punkt für den Folgeblock"
        );
    }

    #[test]
    fn vollzug_in_den_folgeblock_und_posten_ohne_schicht() {
        let bloecke = [
            block(1, Posten::Einheit(10), "08:00", "14:00"),
            block(2, Posten::Einheit(10), "14:00", "20:00"),
            block(3, Posten::Einheit(11), "10:00", "16:00"),
        ];
        let mut stand = Stand::default();
        stand.gewechselt_in.insert(2);
        let p = wechselpunkte(&bloecke, &stand, t("09:00"));
        let stand_um = |hm: &str| {
            p.iter()
                .find(|p| p.zeitpunkt.contains(hm))
                .map(arten)
                .unwrap_or_default()
        };
        assert_eq!(
            stand_um("14:00"),
            vec![(
                PlanWechselEintragArt::Einheit,
                PlanWechselStand::Vollzogen,
                2
            )]
        );
        assert_eq!(
            stand_um("10:00"),
            vec![(
                PlanWechselEintragArt::Einheit,
                PlanWechselStand::OhneSchicht,
                3
            )],
            "Beginn ohne Vorgänger"
        );
        assert_eq!(
            stand_um("16:00"),
            vec![(
                PlanWechselEintragArt::Einheit,
                PlanWechselStand::OhneSchicht,
                3
            )],
            "Posten endet"
        );
    }

    #[test]
    fn schicht_faellig_zum_folgeblock_in_der_luecke_steht_am_ende() {
        // Die Schicht begann außerhalb des Plans in der Lücke: `kopplung` macht sie zum Beginn
        // des Folgeblocks (14:10) fällig; die Leiste führt sie am Ende des Blocks (14:00).
        let bloecke = [
            block(1, Posten::Einheit(10), "08:00", "14:00"),
            block(2, Posten::Einheit(10), "14:10", "20:00"),
        ];
        let mut stand = Stand::default();
        stand.faellig.insert((10, t("14:10")), 100);
        let p = wechselpunkte(&bloecke, &stand, t("09:00"));
        let um_14 = p.iter().find(|p| p.zeitpunkt.contains("14:00")).unwrap();
        assert_eq!(um_14.eintraege[0].stand, PlanWechselStand::Offen);
        assert_eq!(um_14.eintraege[0].abloesung_id, Some(100));
        assert_eq!(
            um_14.eintraege[0].einheit,
            Some(PlanWechselEinheit::Wechsel)
        );
    }

    #[test]
    fn abgezogener_posten_ist_vollzogen() {
        let bloecke = [block(1, Posten::Einheit(10), "08:00", "14:00")];
        let mut stand = Stand::default();
        stand.abgeschlossen.insert((10, t("14:00")));
        let p = wechselpunkte(&bloecke, &stand, t("09:00"));
        let ende = p.iter().find(|p| p.zeitpunkt.contains("14:00")).unwrap();
        assert_eq!(ende.eintraege[0].stand, PlanWechselStand::Vollzogen);
        assert_eq!(ende.eintraege[0].einheit, Some(PlanWechselEinheit::Ende));
    }

    #[test]
    fn einheiten_am_zeitpunkt_wie_die_leiste() {
        let bloecke = [
            block(1, Posten::Einheit(10), "08:00", "14:00"),
            block(2, Posten::Einheit(10), "14:00", "20:00"),
            // Endet 13:55, Folgeblock um 14:00: wechselt um 13:55, nicht um 14:00.
            block(3, Posten::Einheit(11), "08:00", "13:55"),
            block(4, Posten::Einheit(11), "14:00", "20:00"),
            block(5, Posten::Einheit(12), "14:00", "16:00"),
            block(6, Posten::Uhs(7), "14:00", "16:00"),
        ];
        assert_eq!(einheiten_am_zeitpunkt(&bloecke, t("14:00")), vec![10, 12]);
        assert_eq!(einheiten_am_zeitpunkt(&bloecke, t("13:55")), vec![11]);
    }

    #[test]
    fn uhs_am_beginn_pause_an_beginn_und_ende() {
        let bloecke = [
            block(1, Posten::Uhs(7), "12:00", "18:00"),
            block(2, Posten::Pause, "12:00", "12:30"),
        ];
        let mut stand = Stand::default();
        stand.vollzogen.insert((2, WechselArt::PauseBeginn));
        let p = wechselpunkte(&bloecke, &stand, t("11:00"));
        assert_eq!(p.len(), 2, "{p:?}");
        assert_eq!(
            arten(&p[0]),
            vec![
                (PlanWechselEintragArt::Uhs, PlanWechselStand::Offen, 1),
                (
                    PlanWechselEintragArt::PauseBeginn,
                    PlanWechselStand::Vollzogen,
                    2
                ),
            ]
        );
        assert_eq!(
            arten(&p[1]),
            vec![(PlanWechselEintragArt::PauseEnde, PlanWechselStand::Offen, 2)]
        );
    }

    #[test]
    fn fenster_voraus_und_offenes_zurueck() {
        let bloecke = [
            block(1, Posten::Pause, "01:00", "02:00"),
            block(2, Posten::Uhs(7), "03:00", "04:00"),
        ];
        let mut stand = Stand::default();
        stand.vollzogen.insert((1, WechselArt::PauseBeginn));
        stand.vollzogen.insert((1, WechselArt::PauseEnde));
        // Jetzt 12:00: die vollzogene Pause fällt weg, die offene UHS bleibt stehen.
        let p = wechselpunkte(&bloecke, &stand, t("12:00"));
        assert_eq!(p.len(), 1, "{p:?}");
        assert!(p[0].zeitpunkt.contains("03:00"));
        // Jetzt 16:00: 13 h nach der UHS, sie fällt aus der Rückschau.
        assert!(wechselpunkte(&bloecke, &stand, t("16:00")).is_empty());
        // Voraus nur 24 h.
        let spaet = [block(3, Posten::Uhs(7), "12:00", "13:00")];
        assert!(
            wechselpunkte(&spaet, &Stand::default(), t("12:00") - Duration::hours(25)).is_empty()
        );
    }
}

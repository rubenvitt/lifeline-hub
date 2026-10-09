//! Linux: Liegt ein Pfad auf dm-crypt (LUKS)? Gelesen werden nur `/proc` und `/sys`, ohne
//! `cryptsetup` oder `lsblk` (im distroless-Bild gibt es beides nicht) und ohne Rechte.
//!
//! Weg: Mount des Pfads aus `/proc/self/mountinfo` → Blockgerät → Gerätekette über
//! `/sys/dev/block/MAJ:MIN`. Verschlüsselt ist ein Gerät, dessen `dm/uuid` mit `CRYPT-` beginnt
//! (LUKS1/2, plain, `CRYPT-PLAIN` für Swap mit Zufallsschlüssel), oder eines, dessen Unterbau
//! (`slaves`) durchweg verschlüsselt ist (LVM auf LUKS, RAID über LUKS). Eine Partition gilt
//! wie ihr Elterngerät. Die Logik bekommt mountinfo, swaps und sysfs als Eingabe
//! ([`Blockgeraete`]), damit sie sich mit Beispieldaten prüfen lässt.

// Die reine Logik baut überall mit, damit ihre Tests auf jedem Rechner laufen.
#![cfg_attr(not(target_os = "linux"), allow(dead_code, unused_imports))]

use super::{schlechtester, Befund, Grund, OrtErgebnis};
use std::io;
use std::path::Path;

/// Höchste Tiefe der Gerätekette; tiefer ist eine Schleife oder ein exotischer Aufbau.
const MAX_TIEFE: usize = 16;

/// `dm/uuid`-Präfixe der libcryptsetup-Geräte, die wirklich verschlüsseln. `CRYPT-INTEGRITY-`
/// (dm-integrity) und `CRYPT-VERITY-` tragen dasselbe `CRYPT-`, haben aber keinen Schlüssel;
/// sie zählen wie jedes andere dm-Gerät über ihren Unterbau.
const VERSCHLUESSELNDE_DM: [&str; 7] = [
    "CRYPT-LUKS1-",
    "CRYPT-LUKS2-",
    "CRYPT-PLAIN-",
    "CRYPT-LOOPAES-",
    "CRYPT-TCRYPT-",
    "CRYPT-BITLK-",
    "CRYPT-FVAULT2-",
];

/// Blockgerät als `major:minor`.
pub type Geraet = (u32, u32);

/// Ein Eintrag aus `/proc/self/mountinfo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mount {
    pub geraet: Geraet,
    pub einhaengepunkt: String,
    pub fstyp: String,
    pub quelle: String,
}

/// Löst die Oktal-Escapes von mountinfo und swaps auf (`\040` Leerzeichen, `\011`, `\012`,
/// `\134`).
fn entschluessle(roh: &str) -> String {
    let b = roh.as_bytes();
    let mut aus = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\'
            && i + 3 < b.len()
            && b[i + 1..i + 4].iter().all(|c| (b'0'..=b'7').contains(c))
        {
            let wert = (b[i + 1] - b'0') * 64 + (b[i + 2] - b'0') * 8 + (b[i + 3] - b'0');
            aus.push(wert);
            i += 4;
        } else {
            aus.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&aus).into_owned()
}

/// Liest `/proc/self/mountinfo`. Unlesbare Zeilen fallen weg.
///
/// Aufbau: `id eltern MAJ:MIN wurzel einhaengepunkt optionen [optionale Felder…] - fstyp quelle
/// superoptionen`.
pub fn parse_mountinfo(text: &str) -> Vec<Mount> {
    text.lines()
        .filter_map(|zeile| {
            let (vorn, hinten) = zeile.split_once(" - ")?;
            let vorn: Vec<&str> = vorn.split(' ').collect();
            let (maj, min) = vorn.get(2)?.split_once(':')?;
            let einhaengepunkt = entschluessle(vorn.get(4)?);
            let mut hinten = hinten.split(' ');
            let fstyp = hinten.next()?.to_string();
            let quelle = entschluessle(hinten.next().unwrap_or(""));
            Some(Mount {
                geraet: (maj.parse().ok()?, min.parse().ok()?),
                einhaengepunkt,
                fstyp,
                quelle,
            })
        })
        .collect()
}

/// Der Mount, unter dem `pfad` liegt: längster passender Einhängepunkt (Vergleich je
/// Komponente), bei Übermount der spätere Eintrag.
pub fn finde_mount<'a>(mounts: &'a [Mount], pfad: &Path) -> Option<&'a Mount> {
    let mut treffer: Option<&Mount> = None;
    for m in mounts {
        if pfad.starts_with(&m.einhaengepunkt)
            && treffer.is_none_or(|t| m.einhaengepunkt.len() >= t.einhaengepunkt.len())
        {
            treffer = Some(m);
        }
    }
    treffer
}

/// Dateisysteme, die die Prüfung nicht bis zu einem Blockgerät verfolgen kann.
fn fstyp_ohne_geraet(fstyp: &str) -> Option<Grund> {
    let netz = [
        "nfs",
        "nfs4",
        "cifs",
        "smb3",
        "smbfs",
        "9p",
        "virtiofs",
        "ceph",
        "glusterfs",
        "afs",
    ];
    let virtuell = ["overlay", "aufs", "tmpfs", "ramfs", "zfs", "squashfs"];
    // `fuseblk` (ntfs-3g, exfat-fuse) liegt auf einem echten Blockgerät und wird geprüft.
    if netz.contains(&fstyp) || (fstyp.starts_with("fuse") && fstyp != "fuseblk") {
        Some(Grund::Netzlaufwerk)
    } else if virtuell.contains(&fstyp) {
        Some(Grund::Virtuell)
    } else {
        None
    }
}

/// Sicht auf die Blockgeräte, real über sysfs ([`Sysfs`]), in Tests über Beispieldaten.
pub trait Blockgeraete {
    /// Inhalt von `dm/uuid`, `None` für ein Gerät ohne Device-Mapper.
    fn dm_uuid(&self, g: Geraet) -> io::Result<Option<String>>;
    /// Geräte unter `slaves/`.
    fn slaves(&self, g: Geraet) -> io::Result<Vec<Geraet>>;
    /// Das Elterngerät einer Partition, sonst `None`.
    fn elterngeraet(&self, g: Geraet) -> io::Result<Option<Geraet>>;
    /// Gerätenummer einer Gerätedatei (`stat().st_rdev`), etwa `/dev/mapper/root`.
    fn geraet_von(&self, pfad: &Path) -> io::Result<Geraet>;
    /// Ob `g` ein loop-Gerät ist (`loop/backing_file`).
    fn ist_loop(&self, g: Geraet) -> io::Result<bool>;
    /// Alle Geräte des btrfs-Dateisystems, zu dem `g` gehört (`/sys/fs/btrfs/*/devices`);
    /// leer, wenn `g` dort nicht steht.
    fn btrfs_geraete(&self, g: Geraet) -> io::Result<Vec<Geraet>>;
    /// Ob eine Datei hier existiert (Swapdatei aus `/proc/swaps`, im Container ein Host-Pfad).
    fn existiert(&self, pfad: &Path) -> bool;
}

/// Prüft die Gerätekette ab `g`.
pub fn pruefe_geraet(bg: &dyn Blockgeraete, g: Geraet) -> Befund {
    pruefe_geraet_tief(bg, g, 0)
}

fn pruefe_geraet_tief(bg: &dyn Blockgeraete, g: Geraet, tiefe: usize) -> Befund {
    if tiefe > MAX_TIEFE {
        return Befund::Unbekannt(Grund::AusgabeUnbekannt);
    }
    match bg.dm_uuid(g) {
        Err(_) => return Befund::Unbekannt(Grund::KeinZugriff),
        Ok(Some(uuid))
            if VERSCHLUESSELNDE_DM
                .iter()
                .any(|p| uuid.trim().starts_with(p)) =>
        {
            return Befund::Verschluesselt
        }
        Ok(_) => {}
    }
    let mut unterbau = match bg.slaves(g) {
        Ok(s) => s,
        Err(_) => return Befund::Unbekannt(Grund::KeinZugriff),
    };
    if unterbau.is_empty() {
        match bg.elterngeraet(g) {
            Ok(Some(eltern)) => unterbau.push(eltern),
            Ok(None) => {}
            Err(_) => return Befund::Unbekannt(Grund::KeinZugriff),
        }
    }
    if unterbau.is_empty() {
        // Hinter einem loop-Gerät steht eine Datei, deren Datenträger die Kette nicht zeigt.
        match bg.ist_loop(g) {
            Ok(true) => return Befund::Unbekannt(Grund::Virtuell),
            Ok(false) => {}
            Err(_) => return Befund::Unbekannt(Grund::KeinZugriff),
        }
    }
    schlechtester(
        unterbau
            .into_iter()
            .map(|u| pruefe_geraet_tief(bg, u, tiefe + 1)),
    )
    .unwrap_or(Befund::Unverschluesselt)
}

/// Prüft den Datenträger unter einem (schon kanonischen) Pfad.
pub fn pruefe_pfad(mounts: &[Mount], bg: &dyn Blockgeraete, pfad: &Path) -> Befund {
    let Some(m) = finde_mount(mounts, pfad) else {
        return Befund::Unbekannt(Grund::AusgabeUnbekannt);
    };
    if let Some(grund) = fstyp_ohne_geraet(&m.fstyp) {
        return Befund::Unbekannt(grund);
    }
    let geraet = if m.geraet.0 != 0 {
        m.geraet
    } else if m.quelle.starts_with("/dev/") {
        // btrfs meldet eine anonyme Gerätenummer `0:x`; das Blockgerät steht in der Quelle.
        match bg.geraet_von(Path::new(&m.quelle)) {
            Ok(g) => g,
            Err(_) => return Befund::Unbekannt(Grund::KeinZugriff),
        }
    } else {
        return Befund::Unbekannt(Grund::Virtuell);
    };
    if m.fstyp == "btrfs" {
        // Ein btrfs über mehrere Geräte nennt in mountinfo nur eines; jedes muss verschlüsselt sein.
        return match bg.btrfs_geraete(geraet) {
            Ok(alle) if !alle.is_empty() => {
                schlechtester(alle.into_iter().map(|g| pruefe_geraet(bg, g)))
                    .unwrap_or(Befund::Unverschluesselt)
            }
            Ok(_) => pruefe_geraet(bg, geraet),
            Err(_) => Befund::Unbekannt(Grund::KeinZugriff),
        };
    }
    pruefe_geraet(bg, geraet)
}

/// Ein Eintrag aus `/proc/swaps`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Swap {
    pub pfad: String,
    pub ist_datei: bool,
}

/// Liest `/proc/swaps` (Kopfzeile, dann `Dateiname Typ Größe Belegt Priorität`).
pub fn parse_swaps(text: &str) -> Vec<Swap> {
    text.lines()
        .skip(1)
        .filter_map(|zeile| {
            let mut felder = zeile.split_whitespace();
            let pfad = entschluessle(felder.next()?);
            let typ = felder.next()?;
            Some(Swap {
                pfad,
                ist_datei: typ == "file",
            })
        })
        .collect()
}

/// Prüft die Auslagerung. Zram liegt im Speicher und zählt nicht; ohne Swap auf einem
/// Datenträger `None`.
pub fn pruefe_swaps(
    swaps: &[Swap],
    mounts: &[Mount],
    bg: &dyn Blockgeraete,
) -> Option<(String, Befund)> {
    let auf_platte: Vec<&Swap> = swaps
        .iter()
        .filter(|s| !s.pfad.starts_with("/dev/zram"))
        .collect();
    if auf_platte.is_empty() {
        return None;
    }
    let befund = schlechtester(auf_platte.iter().map(|s| {
        if s.ist_datei {
            // Im Container nennt /proc/swaps Pfade des Hosts; einer, den es hier nicht gibt,
            // träfe sonst einen fremden Mount mit passendem Präfix.
            if bg.existiert(Path::new(&s.pfad)) {
                pruefe_pfad(mounts, bg, Path::new(&s.pfad))
            } else {
                Befund::Unbekannt(Grund::KeinZugriff)
            }
        } else {
            match bg.geraet_von(Path::new(&s.pfad)) {
                Ok(g) => pruefe_geraet(bg, g),
                Err(_) => Befund::Unbekannt(Grund::KeinZugriff),
            }
        }
    }))?;
    let pfade = auf_platte
        .iter()
        .map(|s| s.pfad.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Some((pfade, befund))
}

/// Zerlegt eine Linux-`dev_t` (glibc-Kodierung) in `major:minor`.
pub fn zerlege_dev(dev: u64) -> Geraet {
    let major = ((dev >> 8) & 0xfff) | ((dev >> 32) & !0xfff);
    let minor = (dev & 0xff) | ((dev >> 12) & !0xff);
    (major as u32, minor as u32)
}

/// Die echte Sicht über `/sys/dev/block`.
#[cfg(target_os = "linux")]
pub struct Sysfs;

#[cfg(target_os = "linux")]
impl Sysfs {
    fn dir(g: Geraet) -> std::path::PathBuf {
        std::path::PathBuf::from(format!("/sys/dev/block/{}:{}", g.0, g.1))
    }

    /// `253:0` aus einer `dev`-Datei.
    fn lies_dev(pfad: &Path) -> io::Result<Geraet> {
        let text = std::fs::read_to_string(pfad)?;
        let (maj, min) = text
            .trim()
            .split_once(':')
            .ok_or_else(|| io::Error::other("dev ohne Doppelpunkt"))?;
        Ok((
            maj.parse().map_err(io::Error::other)?,
            min.parse().map_err(io::Error::other)?,
        ))
    }
}

#[cfg(target_os = "linux")]
impl Blockgeraete for Sysfs {
    fn dm_uuid(&self, g: Geraet) -> io::Result<Option<String>> {
        let dir = Self::dir(g);
        if !dir.exists() {
            return Err(io::Error::from(io::ErrorKind::NotFound));
        }
        match std::fs::read_to_string(dir.join("dm/uuid")) {
            Ok(u) => Ok(Some(u)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn slaves(&self, g: Geraet) -> io::Result<Vec<Geraet>> {
        let dir = Self::dir(g).join("slaves");
        let eintraege = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        eintraege
            .map(|e| Self::lies_dev(&e?.path().join("dev")))
            .collect()
    }

    fn elterngeraet(&self, g: Geraet) -> io::Result<Option<Geraet>> {
        let dir = Self::dir(g);
        if !dir.join("partition").exists() {
            return Ok(None);
        }
        // `/sys/dev/block/8:2` zeigt auf `…/block/sda/sda2`; das Elterngerät ist der Ordner darüber.
        let echt = std::fs::canonicalize(&dir)?;
        let eltern = echt
            .parent()
            .ok_or_else(|| io::Error::other("Partition ohne Elterngerät"))?;
        Self::lies_dev(&eltern.join("dev")).map(Some)
    }

    fn geraet_von(&self, pfad: &Path) -> io::Result<Geraet> {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(pfad)?;
        Ok(zerlege_dev(meta.rdev()))
    }

    fn ist_loop(&self, g: Geraet) -> io::Result<bool> {
        Ok(Self::dir(g).join("loop/backing_file").exists())
    }

    fn btrfs_geraete(&self, g: Geraet) -> io::Result<Vec<Geraet>> {
        let wurzel = match std::fs::read_dir("/sys/fs/btrfs") {
            Ok(w) => w,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        for fs in wurzel {
            let devices = fs?.path().join("devices");
            let Ok(eintraege) = std::fs::read_dir(&devices) else {
                continue;
            };
            let geraete = eintraege
                .map(|e| Self::lies_dev(&e?.path().join("dev")))
                .collect::<io::Result<Vec<_>>>()?;
            if geraete.contains(&g) {
                return Ok(geraete);
            }
        }
        Ok(Vec::new())
    }

    fn existiert(&self, pfad: &Path) -> bool {
        pfad.exists()
    }
}

/// Prüft alle Orte auf diesem Rechner.
#[cfg(target_os = "linux")]
pub fn pruefe_system(eingabe: &super::Eingabe) -> Vec<OrtErgebnis> {
    use super::OrtArt;
    let mounts = std::fs::read_to_string("/proc/self/mountinfo")
        .map(|t| parse_mountinfo(&t))
        .unwrap_or_default();
    let mut orte: Vec<OrtErgebnis> = eingabe
        .verzeichnisse()
        .into_iter()
        .map(|(art, pfad)| {
            let befund = if mounts.is_empty() {
                Befund::Unbekannt(Grund::KeinZugriff)
            } else {
                match std::fs::canonicalize(pfad) {
                    Ok(echt) => pruefe_pfad(&mounts, &Sysfs, &echt),
                    Err(_) => Befund::Unbekannt(Grund::KeinZugriff),
                }
            };
            OrtErgebnis {
                art,
                pfad: pfad.display().to_string(),
                befund,
            }
        })
        .collect();
    match std::fs::read_to_string("/proc/swaps") {
        Ok(text) => {
            if let Some((pfad, befund)) = pruefe_swaps(&parse_swaps(&text), &mounts, &Sysfs) {
                orte.push(OrtErgebnis {
                    art: OrtArt::Auslagerung,
                    pfad,
                    befund,
                });
            }
        }
        Err(_) => orte.push(OrtErgebnis {
            art: OrtArt::Auslagerung,
            pfad: "/proc/swaps".into(),
            befund: Befund::Unbekannt(Grund::KeinZugriff),
        }),
    }
    orte
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Beispiel-sysfs: je Gerät `dm/uuid`, `slaves`, Elterngerät; dazu Gerätedateien.
    #[derive(Default)]
    struct Beispiel {
        uuid: HashMap<Geraet, &'static str>,
        slaves: HashMap<Geraet, Vec<Geraet>>,
        eltern: HashMap<Geraet, Geraet>,
        dateien: HashMap<&'static str, Geraet>,
        unlesbar: Vec<Geraet>,
        loops: Vec<Geraet>,
        btrfs: Vec<Vec<Geraet>>,
        fehlende_dateien: Vec<&'static str>,
    }

    impl Blockgeraete for Beispiel {
        fn dm_uuid(&self, g: Geraet) -> io::Result<Option<String>> {
            if self.unlesbar.contains(&g) {
                return Err(io::Error::from(io::ErrorKind::PermissionDenied));
            }
            Ok(self.uuid.get(&g).map(|u| format!("{u}\n")))
        }
        fn slaves(&self, g: Geraet) -> io::Result<Vec<Geraet>> {
            Ok(self.slaves.get(&g).cloned().unwrap_or_default())
        }
        fn elterngeraet(&self, g: Geraet) -> io::Result<Option<Geraet>> {
            Ok(self.eltern.get(&g).copied())
        }
        fn geraet_von(&self, pfad: &Path) -> io::Result<Geraet> {
            self.dateien
                .get(pfad.to_str().unwrap())
                .copied()
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }
        fn ist_loop(&self, g: Geraet) -> io::Result<bool> {
            Ok(self.loops.contains(&g))
        }
        fn btrfs_geraete(&self, g: Geraet) -> io::Result<Vec<Geraet>> {
            Ok(self
                .btrfs
                .iter()
                .find(|fs| fs.contains(&g))
                .cloned()
                .unwrap_or_default())
        }
        fn existiert(&self, pfad: &Path) -> bool {
            !self.fehlende_dateien.contains(&pfad.to_str().unwrap())
        }
    }

    // Geräte: sda (8:0) mit sda1 (8:1, /boot) und sda2 (8:2, LUKS-Container);
    // dm-0 (253:0) = LUKS auf sda2; dm-1 (253:1) = LVM-LV „root“ auf dm-0; sdb1 (8:17) nackt.
    const SDA: Geraet = (8, 0);
    const SDA1: Geraet = (8, 1);
    const SDA2: Geraet = (8, 2);
    const SDB: Geraet = (8, 16);
    const SDB1: Geraet = (8, 17);
    const DM0: Geraet = (253, 0);
    const DM1: Geraet = (253, 1);

    fn lvm_auf_luks() -> Beispiel {
        Beispiel {
            uuid: HashMap::from([
                (
                    DM0,
                    "CRYPT-LUKS2-0f1e2d3c4b5a69788796a5b4c3d2e1f0-luks-0f1e",
                ),
                (
                    DM1,
                    "LVM-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St90Uv12Wx34Yz56Ab78Cd90Ef12",
                ),
            ]),
            slaves: HashMap::from([(DM0, vec![SDA2]), (DM1, vec![DM0])]),
            eltern: HashMap::from([(SDA1, SDA), (SDA2, SDA), (SDB1, SDB)]),
            dateien: HashMap::from([("/dev/mapper/luks-root", DM0), ("/dev/sdb1", SDB1)]),
            ..Default::default()
        }
    }

    const MOUNTINFO: &str = "\
22 1 253:1 / / rw,relatime shared:1 - ext4 /dev/mapper/vg-root rw
23 22 8:1 / /boot rw,relatime shared:2 - ext4 /dev/sda1 rw
24 22 8:17 / /mnt/usb\\040stick rw,relatime shared:3 - vfat /dev/sdb1 rw
25 22 0:45 / /srv/btrfs rw,relatime shared:4 - btrfs /dev/mapper/luks-root rw
26 22 0:46 / /srv/nas rw,relatime shared:5 - nfs4 nas:/export rw
27 22 0:47 / /tmp rw - tmpfs tmpfs rw
28 22 0:48 / /srv/fuse rw - fuse.sshfs host:/x rw
29 22 0:49 / /srv/zfs rw - zfs tank/daten rw
";

    fn pruefe(pfad: &str) -> Befund {
        pruefe_pfad(
            &parse_mountinfo(MOUNTINFO),
            &lvm_auf_luks(),
            Path::new(pfad),
        )
    }

    #[test]
    fn mountinfo_wird_gelesen_samt_escapes_und_optionalen_feldern() {
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(m.len(), 8);
        assert_eq!(
            m[2],
            Mount {
                geraet: SDB1,
                einhaengepunkt: "/mnt/usb stick".into(),
                fstyp: "vfat".into(),
                quelle: "/dev/sdb1".into(),
            }
        );
        // Ohne optionale Felder (Zeile `tmpfs`) und mit kaputter Zeile.
        assert_eq!(m[5].fstyp, "tmpfs");
        assert!(parse_mountinfo("kaputt\n1 2 x / / rw - ext4 /dev/x rw").is_empty());
    }

    #[test]
    fn laengster_einhaengepunkt_je_komponente() {
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(
            finde_mount(&m, Path::new("/boot/efi")).unwrap().geraet,
            SDA1
        );
        assert_eq!(
            finde_mount(&m, Path::new("/bootstrap")).unwrap().geraet,
            DM1
        );
        assert_eq!(
            finde_mount(&m, Path::new("/mnt/usb stick/sich"))
                .unwrap()
                .geraet,
            SDB1
        );
    }

    #[test]
    fn uebermount_nimmt_den_spaeteren_eintrag() {
        let m = parse_mountinfo(
            "1 0 8:1 / /data rw - ext4 /dev/sda1 rw\n2 0 253:0 / /data rw - ext4 /dev/dm-0 rw\n",
        );
        assert_eq!(finde_mount(&m, Path::new("/data/x")).unwrap().geraet, DM0);
    }

    #[test]
    fn lvm_auf_luks_ist_verschluesselt() {
        assert_eq!(pruefe("/var/lib/lifeline"), Befund::Verschluesselt);
    }

    #[test]
    fn luks_direkt_ist_verschluesselt() {
        assert_eq!(pruefe_geraet(&lvm_auf_luks(), DM0), Befund::Verschluesselt);
    }

    #[test]
    fn luks_auf_lvm_ist_verschluesselt() {
        // dm-1 = LUKS, darunter dm-0 = LVM-LV auf sda2.
        let bg = Beispiel {
            uuid: HashMap::from([(DM1, "CRYPT-LUKS2-abc-daten"), (DM0, "LVM-xyz")]),
            slaves: HashMap::from([(DM1, vec![DM0]), (DM0, vec![SDA2])]),
            eltern: HashMap::from([(SDA2, SDA)]),
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, DM1), Befund::Verschluesselt);
    }

    #[test]
    fn nackte_partition_ist_unverschluesselt() {
        assert_eq!(pruefe("/boot"), Befund::Unverschluesselt);
        assert_eq!(pruefe("/mnt/usb stick"), Befund::Unverschluesselt);
    }

    #[test]
    fn lvm_ohne_luks_ist_unverschluesselt() {
        let bg = Beispiel {
            uuid: HashMap::from([(DM0, "LVM-xyz")]),
            slaves: HashMap::from([(DM0, vec![SDA2])]),
            eltern: HashMap::from([(SDA2, SDA)]),
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, DM0), Befund::Unverschluesselt);
    }

    #[test]
    fn ein_nackter_zweig_im_unterbau_macht_unverschluesselt() {
        // LV über zwei PVs: eines auf LUKS, eines nackt.
        let bg = Beispiel {
            uuid: HashMap::from([(DM1, "LVM-xyz"), (DM0, "CRYPT-LUKS2-abc")]),
            slaves: HashMap::from([(DM1, vec![DM0, SDB1]), (DM0, vec![SDA2])]),
            eltern: HashMap::from([(SDA2, SDA), (SDB1, SDB)]),
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, DM1), Befund::Unverschluesselt);
    }

    #[test]
    fn btrfs_folgt_der_quelle() {
        assert_eq!(pruefe("/srv/btrfs/daten"), Befund::Verschluesselt);
    }

    #[test]
    fn netz_und_virtuelle_dateisysteme_sind_unbekannt() {
        assert_eq!(pruefe("/srv/nas"), Befund::Unbekannt(Grund::Netzlaufwerk));
        assert_eq!(pruefe("/srv/fuse"), Befund::Unbekannt(Grund::Netzlaufwerk));
        assert_eq!(pruefe("/tmp/x"), Befund::Unbekannt(Grund::Virtuell));
        assert_eq!(pruefe("/srv/zfs"), Befund::Unbekannt(Grund::Virtuell));
    }

    #[test]
    fn container_wurzel_ist_unbekannt() {
        let m = parse_mountinfo(
            "500 450 0:52 / / rw - overlay overlay rw,lowerdir=/x\n\
             501 500 253:1 /volumes/lh/_data /data rw - ext4 /dev/mapper/vg-root rw\n",
        );
        let bg = lvm_auf_luks();
        assert_eq!(
            pruefe_pfad(&m, &bg, Path::new("/app")),
            Befund::Unbekannt(Grund::Virtuell)
        );
        // Ein Volume auf einem LUKS-Host ist im Container erkennbar.
        assert_eq!(
            pruefe_pfad(&m, &bg, Path::new("/data")),
            Befund::Verschluesselt
        );
    }

    #[test]
    fn unlesbares_sysfs_ist_unbekannt() {
        let mut bg = lvm_auf_luks();
        bg.unlesbar.push(DM1);
        assert_eq!(
            pruefe_pfad(&parse_mountinfo(MOUNTINFO), &bg, Path::new("/")),
            Befund::Unbekannt(Grund::KeinZugriff)
        );
    }

    #[test]
    fn schleife_in_der_kette_endet_unbekannt() {
        let bg = Beispiel {
            slaves: HashMap::from([(DM0, vec![DM1]), (DM1, vec![DM0])]),
            ..Default::default()
        };
        assert_eq!(
            pruefe_geraet(&bg, DM0),
            Befund::Unbekannt(Grund::AusgabeUnbekannt)
        );
    }

    const SWAPS_KOPF: &str = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n";

    fn swaps(zeilen: &str) -> Vec<Swap> {
        parse_swaps(&format!("{SWAPS_KOPF}{zeilen}"))
    }

    #[test]
    fn swaps_werden_gelesen() {
        let s = swaps("/swap\\040datei                               file\t\t1048572\t\t0\t\t-2\n/dev/dm-2 partition 8388604 0 -3\n");
        assert_eq!(
            s,
            vec![
                Swap {
                    pfad: "/swap datei".into(),
                    ist_datei: true
                },
                Swap {
                    pfad: "/dev/dm-2".into(),
                    ist_datei: false
                },
            ]
        );
        assert!(parse_swaps(SWAPS_KOPF).is_empty());
    }

    #[test]
    fn unverschluesselte_swap_partition_wird_gefunden() {
        let mut bg = lvm_auf_luks();
        bg.dateien.insert("/dev/sda3", (8, 3));
        bg.eltern.insert((8, 3), SDA);
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(
            pruefe_swaps(&swaps("/dev/sda3 partition 8388604 0 -2\n"), &m, &bg),
            Some(("/dev/sda3".into(), Befund::Unverschluesselt))
        );
    }

    #[test]
    fn swap_mit_zufallsschluessel_ist_verschluesselt() {
        let mut bg = lvm_auf_luks();
        bg.uuid.insert((253, 2), "CRYPT-PLAIN-swap");
        bg.slaves.insert((253, 2), vec![(8, 3)]);
        bg.dateien.insert("/dev/dm-2", (253, 2));
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(
            pruefe_swaps(&swaps("/dev/dm-2 partition 8388604 0 -2\n"), &m, &bg),
            Some(("/dev/dm-2".into(), Befund::Verschluesselt))
        );
    }

    #[test]
    fn swapdatei_gilt_wie_ihr_dateisystem() {
        let m = parse_mountinfo(MOUNTINFO);
        let bg = lvm_auf_luks();
        assert_eq!(
            pruefe_swaps(&swaps("/swapfile file 1048572 0 -2\n"), &m, &bg),
            Some(("/swapfile".into(), Befund::Verschluesselt))
        );
        assert_eq!(
            pruefe_swaps(&swaps("/boot/swapfile file 1048572 0 -2\n"), &m, &bg),
            Some(("/boot/swapfile".into(), Befund::Unverschluesselt))
        );
    }

    #[test]
    fn zram_und_kein_swap_zaehlen_nicht() {
        let m = parse_mountinfo(MOUNTINFO);
        let bg = lvm_auf_luks();
        assert_eq!(pruefe_swaps(&swaps(""), &m, &bg), None);
        assert_eq!(
            pruefe_swaps(&swaps("/dev/zram0 partition 4194300 0 100\n"), &m, &bg),
            None
        );
    }

    #[test]
    fn swap_des_hosts_im_container_ist_unbekannt() {
        // Der Pfad aus /proc/swaps existiert im Container nicht.
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(
            pruefe_swaps(&swaps("/dev/dm-9 partition 1 0 -2\n"), &m, &lvm_auf_luks()),
            Some(("/dev/dm-9".into(), Befund::Unbekannt(Grund::KeinZugriff)))
        );
    }

    #[test]
    fn mehrere_swaps_nehmen_den_schlechtesten() {
        let mut bg = lvm_auf_luks();
        bg.dateien.insert("/dev/sda3", (8, 3));
        bg.eltern.insert((8, 3), SDA);
        let m = parse_mountinfo(MOUNTINFO);
        assert_eq!(
            pruefe_swaps(
                &swaps("/swapfile file 1 0 -2\n/dev/sda3 partition 1 0 -3\n"),
                &m,
                &bg
            ),
            Some(("/swapfile, /dev/sda3".into(), Befund::Unverschluesselt))
        );
    }

    #[test]
    fn integritaet_ohne_schluessel_ist_nicht_verschluesselt() {
        // md-RAID1 über zwei dm-integrity-Geräte: `CRYPT-INTEGRITY-…` ohne Schlüssel.
        let md: Geraet = (9, 0);
        let (i1, i2): (Geraet, Geraet) = ((253, 5), (253, 6));
        let bg = Beispiel {
            uuid: HashMap::from([(i1, "CRYPT-INTEGRITY-a"), (i2, "CRYPT-INTEGRITY-b")]),
            slaves: HashMap::from([(md, vec![i1, i2]), (i1, vec![SDA2]), (i2, vec![SDB1])]),
            eltern: HashMap::from([(SDA2, SDA), (SDB1, SDB)]),
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, md), Befund::Unverschluesselt);
        let verity = Beispiel {
            uuid: HashMap::from([(DM0, "CRYPT-VERITY-x")]),
            slaves: HashMap::from([(DM0, vec![SDA2])]),
            eltern: HashMap::from([(SDA2, SDA)]),
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&verity, DM0), Befund::Unverschluesselt);
    }

    #[test]
    fn alle_cryptsetup_arten_mit_schluessel_sind_verschluesselt() {
        for uuid in [
            "CRYPT-LUKS1-abc-x",
            "CRYPT-LUKS2-abc-x",
            "CRYPT-PLAIN-swap",
            "CRYPT-BITLK-abc-x",
            "CRYPT-TCRYPT-x",
        ] {
            let bg = Beispiel {
                uuid: HashMap::from([(DM0, uuid)]),
                ..Default::default()
            };
            assert_eq!(pruefe_geraet(&bg, DM0), Befund::Verschluesselt, "{uuid}");
        }
    }

    #[test]
    fn btrfs_ueber_mehrere_geraete_braucht_jedes_verschluesselt() {
        let mut bg = lvm_auf_luks();
        // btrfs-RAID1 aus luks-root (dm-0) und dem nackten sdb1.
        bg.btrfs = vec![vec![DM0, SDB1]];
        assert_eq!(pruefe("/srv/btrfs/daten"), Befund::Verschluesselt);
        assert_eq!(
            pruefe_pfad(
                &parse_mountinfo(MOUNTINFO),
                &bg,
                Path::new("/srv/btrfs/daten")
            ),
            Befund::Unverschluesselt
        );
        bg.btrfs = vec![vec![DM0, (253, 7)]];
        bg.uuid.insert((253, 7), "CRYPT-LUKS2-zweite");
        assert_eq!(
            pruefe_pfad(
                &parse_mountinfo(MOUNTINFO),
                &bg,
                Path::new("/srv/btrfs/daten")
            ),
            Befund::Verschluesselt
        );
    }

    #[test]
    fn loop_geraet_ist_unbekannt() {
        let lo: Geraet = (7, 0);
        let bg = Beispiel {
            loops: vec![lo],
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, lo), Befund::Unbekannt(Grund::Virtuell));
        // LUKS auf einem loop-Gerät ist trotzdem verschlüsselt.
        let bg = Beispiel {
            uuid: HashMap::from([(DM0, "CRYPT-LUKS2-x")]),
            slaves: HashMap::from([(DM0, vec![lo])]),
            loops: vec![lo],
            ..Default::default()
        };
        assert_eq!(pruefe_geraet(&bg, DM0), Befund::Verschluesselt);
    }

    #[test]
    fn fuseblk_wird_als_blockgeraet_geprueft() {
        let m = parse_mountinfo(
            "1 0 8:17 / /mnt/stick rw - fuseblk /dev/sdb1 rw
",
        );
        assert_eq!(
            pruefe_pfad(&m, &lvm_auf_luks(), Path::new("/mnt/stick")),
            Befund::Unverschluesselt
        );
    }

    #[test]
    fn swapdatei_des_hosts_fehlt_im_container() {
        let m = parse_mountinfo(MOUNTINFO);
        let mut bg = lvm_auf_luks();
        bg.fehlende_dateien.push("/boot/swapfile");
        assert_eq!(
            pruefe_swaps(&swaps("/boot/swapfile file 1 0 -2\n"), &m, &bg),
            Some((
                "/boot/swapfile".into(),
                Befund::Unbekannt(Grund::KeinZugriff)
            ))
        );
    }

    #[test]
    fn dev_t_wird_zerlegt() {
        // makedev(253, 1) und makedev(8, 17) in glibc-Kodierung; dazu eine große Minor.
        assert_eq!(zerlege_dev(0xfd01), DM1);
        assert_eq!(zerlege_dev(0x811), SDB1);
        assert_eq!(zerlege_dev((259 << 8) | 0x10_0005), (259, 0x105));
    }

    /// Auf dem Testrechner selbst darf die Prüfung nicht abstürzen, was sie auch liefert.
    #[cfg(target_os = "linux")]
    #[test]
    fn echtes_system_liefert_einen_befund_je_ort() {
        let e = super::super::Eingabe::aus_config("/tmp/lifeline.db", None);
        let orte = pruefe_system(&e);
        assert_eq!(orte[0].art, super::super::OrtArt::Datenbank);
    }
}

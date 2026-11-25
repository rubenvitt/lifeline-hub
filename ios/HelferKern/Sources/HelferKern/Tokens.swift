// Erzeugt aus docs/design/design-system/project/tokens.json von scripts/design/tokens-nativ.mjs — nicht von Hand ändern.

// swiftlint:disable all

/// Ein Farbwert je Thema: `nacht` (dunkel) und `tag` (hell), je als ARGB `0xAARRGGBB`.
public struct Paar: Sendable, Equatable {
    public let nacht: UInt32
    public let tag: UInt32
    public init(nacht: UInt32, tag: UInt32) {
        self.nacht = nacht
        self.tag = tag
    }
}

/// Ein Schriftstil der Skala: Familie, Größe in Punkten, Zeilenhöhe als Faktor, Gewicht (CSS-Wert).
public struct Schriftstil: Sendable, Equatable {
    public let familie: String
    public let groesse: Double
    public let zeilenhoehe: Double
    public let gewicht: Int
    public init(familie: String, groesse: Double, zeilenhoehe: Double, gewicht: Int) {
        self.familie = familie
        self.groesse = groesse
        self.zeilenhoehe = zeilenhoehe
        self.gewicht = gewicht
    }
}

public enum LifelineFarbe {
    public static let rolleGrund = Paar(nacht: 0xFF08090B, tag: 0xFFE6E7E9)
    public static let rolleFlaeche = Paar(nacht: 0xFF151719, tag: 0xFFFFFFFF)
    public static let rolleFlaeche2 = Paar(nacht: 0xFF1F2123, tag: 0xFFF2F3F5)
    public static let rolleLinie = Paar(nacht: 0xFF22262B, tag: 0xFFD4D8DD)
    public static let rolleLinieStark = Paar(nacht: 0xFF2E343A, tag: 0xFFB9BFC6)
    public static let rolleRasterLinie = Paar(nacht: 0x0E4D94D6, tag: 0x121A5FA0)
    public static let rolleText = Paar(nacht: 0xFFE8EBEE, tag: 0xFF111418)
    public static let rolleGedaempft = Paar(nacht: 0xFF9FA7B0, tag: 0xFF323941)
    public static let rolleSchwach = Paar(nacht: 0xFF9199A2, tag: 0xFF3D454E)
    public static let rolleBedien = Paar(nacht: 0xFF4D94D6, tag: 0xFF154E84)
    public static let rolleAlarm = Paar(nacht: 0xFFFF6B6B, tag: 0xFFB02318)
    public static let rolleAchtung = Paar(nacht: 0xFFE8CC3A, tag: 0xFF7A5200)
    public static let rolleNormal = Paar(nacht: 0xFF52C41A, tag: 0xFF1C6640)
    public static let rolleMarke = Paar(nacht: 0xFFA8071A, tag: 0xFFA8071A)
    public static let rolleAlarmFuellung = Paar(nacht: 0x1AFF6B6B, tag: 0x12B02318)
    public static let rolleAlarmFuellungStark = Paar(nacht: 0x3DFF6B6B, tag: 0x33B02318)
    public static let rolleAchtungFuellung = Paar(nacht: 0x1AE8CC3A, tag: 0x147A5200)
    public static let rolleAchtungFuellungStark = Paar(nacht: 0x3DE8CC3A, tag: 0x337A5200)
    public static let rolleNormalFuellung = Paar(nacht: 0x1A52C41A, tag: 0x121C6640)
    public static let rolleKopf = Paar(nacht: 0xFF151719, tag: 0xFFE6E7E9)
    public static let rollePaneel = Paar(nacht: 0xFF08090B, tag: 0xFFF2F3F5)
    public static let rolleFlaeche3 = Paar(nacht: 0xFF27292B, tag: 0xFFDBDCDE)
    public static let rolleText2 = Paar(nacht: 0xFFC6CCD2, tag: 0xFF272D34)
    public static let rolleSteuerRahmen = Paar(nacht: 0xFF6C747D, tag: 0xFF747C85)
    public static let rolleBedienHover = Paar(nacht: 0xFF7DB3E8, tag: 0xFF185895)
    public static let rolleBedienText = Paar(nacht: 0xFF8EC2F0, tag: 0xFF114577)
    public static let rolleAufBedien = Paar(nacht: 0xFF08090B, tag: 0xFFFFFFFF)
    public static let rolleNormalText = Paar(nacht: 0xFF7DDC4A, tag: 0xFF155234)
    public static let rolleAchtungText = Paar(nacht: 0xFFE8CC3A, tag: 0xFF604200)
    public static let rolleAlarmText = Paar(nacht: 0xFFFF6B6B, tag: 0xFF88140D)
    public static let rolleAlarmHover = Paar(nacht: 0xFFE88A87, tag: 0xFF7D1810)
    public static let rolleNormalFlaeche = Paar(nacht: 0xFF0D1A0A, tag: 0xFFE3F1E8)
    public static let rolleAchtungFlaeche = Paar(nacht: 0xFF1C1705, tag: 0xFFF7EFD5)
    public static let rolleAlarmFlaeche = Paar(nacht: 0xFF1C0A0D, tag: 0xFFF9E3E3)
    public static let rolleBedienFlaeche = Paar(nacht: 0xFF0D1620, tag: 0xFFE4EDF7)
    public static let rolleAuswahlFlaeche = Paar(nacht: 0xFF08172B, tag: 0xFFDBE7F5)
    public static let rolleGesperrt = Paar(nacht: 0xFF9CA4AD, tag: 0xFF525A63)
    public static let rolleBannerGrund = Paar(nacht: 0xFF0D1520, tag: 0xFFE6EEF8)
    public static let rolleBannerLinie = Paar(nacht: 0xFF1D3A5C, tag: 0xFF9DBBE0)
    public static let rolleBerichtigungZeile = Paar(nacht: 0xFF160D0F, tag: 0xFFFBEAEA)
    public static let rolleLueckeZeile = Paar(nacht: 0xFF161305, tag: 0xFFFAF3DA)
    public static let rolleProblemZeile = Paar(nacht: 0xFF1E1416, tag: 0xFFF8EDED)
    public static let rolleZeichenPlatte = Paar(nacht: 0xFFC9CED4, tag: 0x00000000)
    public static let rolleUebungFuellung = Paar(nacht: 0xFF6D28D9, tag: 0xFF6D28D9)
    public static let rolleUebungSchraffur = Paar(nacht: 0xFF5B21B6, tag: 0xFF5B21B6)
    public static let rolleUebungText = Paar(nacht: 0xFFFFFFFF, tag: 0xFFFFFFFF)
    public static let rolleUebungKante = Paar(nacht: 0xFFA78BFA, tag: 0xFFA78BFA)
    public static let rahmenGrund = Paar(nacht: 0xFF0C0E11, tag: 0xFF0C0E11)
    public static let rahmenAktiv = Paar(nacht: 0xFF16191D, tag: 0xFF16191D)
    public static let rahmenFeld = Paar(nacht: 0xFF14171B, tag: 0xFF14171B)
    public static let rahmenLinie = Paar(nacht: 0xFF22262B, tag: 0xFF22262B)
    public static let rahmenText = Paar(nacht: 0xFFE8EBEE, tag: 0xFFE8EBEE)
    public static let rahmenGedaempft = Paar(nacht: 0xFFA0A8B1, tag: 0xFFA0A8B1)
    public static let rahmenGesperrt = Paar(nacht: 0xFF838B94, tag: 0xFF838B94)
    public static let rahmenAlarm = Paar(nacht: 0xFFFF7070, tag: 0xFFFF7070)
    public static let rahmenBedien = Paar(nacht: 0xFF4D94D6, tag: 0xFF4D94D6)
    public static let maskeSprungpalette = Paar(nacht: 0xB8050608, tag: 0xB8050608)
    public static let sichtungSk1 = Paar(nacht: 0xFFF5222D, tag: 0xFFF5222D)
    public static let sichtungSk2 = Paar(nacht: 0xFFFADB14, tag: 0xFFFADB14)
    public static let sichtungSk3 = Paar(nacht: 0xFF52C41A, tag: 0xFF52C41A)
    public static let sichtungSk4 = Paar(nacht: 0xFF1677FF, tag: 0xFF1677FF)
    public static let sichtungTot = Paar(nacht: 0xFF000000, tag: 0xFF000000)
    public static let sichtungFlaecheSk1 = Paar(nacht: 0xFFA8071A, tag: 0xFFA8071A)
    public static let sichtungFlaecheSk2 = Paar(nacht: 0xFFFADB14, tag: 0xFFFADB14)
    public static let sichtungFlaecheSk3 = Paar(nacht: 0xFF135200, tag: 0xFF135200)
    public static let sichtungFlaecheSk4 = Paar(nacht: 0xFF003EB3, tag: 0xFF003EB3)
    public static let sichtungFlaecheTot = Paar(nacht: 0xFF000000, tag: 0xFF000000)
    public static let sichtungSchriftSk1 = Paar(nacht: 0xFFFFFFFF, tag: 0xFFFFFFFF)
    public static let sichtungSchriftSk2 = Paar(nacht: 0xFF000000, tag: 0xFF000000)
    public static let sichtungSchriftSk3 = Paar(nacht: 0xFFFFFFFF, tag: 0xFFFFFFFF)
    public static let sichtungSchriftSk4 = Paar(nacht: 0xFFFFFFFF, tag: 0xFFFFFFFF)
    public static let sichtungSchriftTot = Paar(nacht: 0xFFFFFFFF, tag: 0xFFFFFFFF)
    public static let sichtungKante = Paar(nacht: 0xFFE8EBEE, tag: 0xFF111418)
    public static let statusNormalGrund = Paar(nacht: 0xFF0D1A0A, tag: 0xFFE3F1E8)
    public static let statusBedienGrund = Paar(nacht: 0xFF0D1620, tag: 0xFFE4EDF7)
    public static let statusAchtungGrund = Paar(nacht: 0xFF1C1705, tag: 0xFFF7EFD5)
    public static let statusAlarmGrund = Paar(nacht: 0xFF1C0A0D, tag: 0xFFF9E3E3)
    public static let statusNeutralGrund = Paar(nacht: 0xFF27292B, tag: 0xFFDBDCDE)
    public static let statusNormalText = Paar(nacht: 0xFF7DDC4A, tag: 0xFF155234)
    public static let statusBedienText = Paar(nacht: 0xFF8EC2F0, tag: 0xFF114577)
    public static let statusAchtungText = Paar(nacht: 0xFFE8CC3A, tag: 0xFF604200)
    public static let statusAlarmText = Paar(nacht: 0xFFFF6B6B, tag: 0xFF88140D)
    public static let statusNeutralText = Paar(nacht: 0xFFC6CCD2, tag: 0xFF272D34)
    public static let statusNormalKante = Paar(nacht: 0xFF52C41A, tag: 0xFF1C6640)
    public static let statusBedienKante = Paar(nacht: 0xFF4D94D6, tag: 0xFF154E84)
    public static let statusAchtungKante = Paar(nacht: 0xFFE8CC3A, tag: 0xFF7A5200)
    public static let statusAlarmKante = Paar(nacht: 0xFFFF6B6B, tag: 0xFFB02318)
    public static let statusNeutralKante = Paar(nacht: 0xFF9199A2, tag: 0xFF3D454E)
    public static let etbMeldungKante = Paar(nacht: 0xFF1677FF, tag: 0xFF1677FF)
    public static let etbAnordnungKante = Paar(nacht: 0xFFD46B08, tag: 0xFFB35600)
    public static let etbEntscheidungKante = Paar(nacht: 0xFF8F4BE3, tag: 0xFF722ED1)
    public static let etbLageKante = Paar(nacht: 0xFF13C2C2, tag: 0xFF0E8C90)
    public static let etbBerichtigungKante = Paar(nacht: 0xFFD41B25, tag: 0xFFCF1322)
    public static let etbSystemKante = Paar(nacht: 0xFF9199A2, tag: 0xFF3D454E)
    public static let etbMeldungWort = Paar(nacht: 0xFF5C9DFF, tag: 0xFF0A449D)
    public static let etbAnordnungWort = Paar(nacht: 0xFFE8852A, tag: 0xFF7A3700)
    public static let etbEntscheidungWort = Paar(nacht: 0xFFA57FF0, tag: 0xFF5B1FAE)
    public static let etbLageWort = Paar(nacht: 0xFF13C2C2, tag: 0xFF005357)
    public static let etbBerichtigungWort = Paar(nacht: 0xFFFF6B6B, tag: 0xFF88140D)
    public static let etbSystemWort = Paar(nacht: 0xFF9FA7B0, tag: 0xFF323941)
    public static let warnstufeNiedrig = Paar(nacht: 0xFFD4B106, tag: 0xFF9E7F00)
    public static let warnstufeMittel = Paar(nacht: 0xFFD46B08, tag: 0xFFB35600)
    public static let warnstufeHoch = Paar(nacht: 0xFFCF1322, tag: 0xFFCF1322)
    public static let warnstufeAkut = Paar(nacht: 0xFFA8071A, tag: 0xFFA8071A)
    public static let fachebeneNina = Paar(nacht: 0xFFFF4D4F, tag: 0xFFCF1322)
    public static let fachebeneDwd = Paar(nacht: 0xFFFFA940, tag: 0xFFD48806)
    public static let fachebenePegelonline = Paar(nacht: 0xFF4096FF, tag: 0xFF096DD9)
    public static let fachebeneHochwasser = Paar(nacht: 0xFF36CFC9, tag: 0xFF08979C)
    public static let fachebeneLuftqualitaet = Paar(nacht: 0xFF8C9BB3, tag: 0xFF5B6B82)
    public static let fachebeneOdl = Paar(nacht: 0xFFA0D911, tag: 0xFF7CB305)
    public static let fachebeneAutobahn = Paar(nacht: 0xFFF759AB, tag: 0xFFC41D7F)
    public static let fachebeneKritis = Paar(nacht: 0xFF9254DE, tag: 0xFF531DAB)
    public static let fachebeneEnergie = Paar(nacht: 0xFFFADB14, tag: 0xFFD4B106)
    public static let fachebeneCopernicus = Paar(nacht: 0xFFC48A5A, tag: 0xFF873800)
    public static let koerperschemaSilhouette = Paar(nacht: 0xFF27292B, tag: 0xFFDBDCDE)
    public static let koerperschemaKontur = Paar(nacht: 0xFF6C747D, tag: 0xFF747C85)
    public static let koerperschemaStern = Paar(nacht: 0xFFE8EBEE, tag: 0xFF111418)
    public static let koerperschemaBedien = Paar(nacht: 0xFF4D94D6, tag: 0xFF154E84)
}

public enum LifelineAbstand {
    public static let abstandKompaktXxs: Double = 4.0
    public static let abstandKompaktXs: Double = 4.0
    public static let abstandKompaktSm: Double = 8.0
    public static let abstandKompaktMd: Double = 12.0
    public static let abstandKompaktLg: Double = 16.0
    public static let abstandKompaktXl: Double = 24.0
    public static let abstandKomfortabelXxs: Double = 4.0
    public static let abstandKomfortabelXs: Double = 4.0
    public static let abstandKomfortabelSm: Double = 12.0
    public static let abstandKomfortabelMd: Double = 20.0
    public static let abstandKomfortabelLg: Double = 28.0
    public static let abstandKomfortabelXl: Double = 40.0
    public static let abstandHandschuhXxs: Double = 4.0
    public static let abstandHandschuhXs: Double = 8.0
    public static let abstandHandschuhSm: Double = 16.0
    public static let abstandHandschuhMd: Double = 24.0
    public static let abstandHandschuhLg: Double = 44.0
    public static let abstandHandschuhXl: Double = 64.0
    public static let seitenrinneBreit: Double = 24.0
    public static let seitenrinneSchmal: Double = 12.0
}

public enum LifelineGroesse {
    public static let steuerhoeheKompakt: Double = 30.0
    public static let steuerhoeheKleinKompakt: Double = 24.0
    public static let steuerhoeheKomfortabel: Double = 48.0
    public static let steuerhoeheKleinKomfortabel: Double = 48.0
    public static let steuerhoeheHandschuh: Double = 72.0
    public static let steuerhoeheKleinHandschuh: Double = 72.0
    public static let seiteSchmal: Double = 900.0
    public static let zustandOben: Double = 80.0
    public static let kachelMin: Double = 260.0
    public static let kachelMinKlein: Double = 220.0
    public static let navDrawerBreite: Double = 360.0
    public static let navDrawerRand: Double = 48.0
}

public enum LifelineRadius {
    public static let radiusFlaeche: Double = 0.0
    public static let radiusSteuer: Double = 0.0
    public static let radiusMarke: Double = 0.0
}

public enum LifelineSchrift {
    public static let familieText = "LFH Archivo"
    public static let familieDisplay = "LFH Archivo Narrow"
    public static let familieZahl = "LFH JetBrains Mono"

    public static let ueberschrift = Schriftstil(familie: familieText, groesse: 30.0, zeilenhoehe: 1.5926, gewicht: 600)
    public static let seitentitel = Schriftstil(familie: familieText, groesse: 16.0, zeilenhoehe: 1.5926, gewicht: 600)
    public static let kartentitel = Schriftstil(familie: familieText, groesse: 15.0, zeilenhoehe: 1.5926, gewicht: 600)
    public static let text = Schriftstil(familie: familieText, groesse: 14.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let textKlein = Schriftstil(familie: familieText, groesse: 12.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let augenbraue = Schriftstil(familie: familieText, groesse: 11.0, zeilenhoehe: 1.5926, gewicht: 600)
    public static let railEtikett = Schriftstil(familie: familieText, groesse: 11.0, zeilenhoehe: 1.5926, gewicht: 500)
    public static let meta = Schriftstil(familie: familieText, groesse: 11.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let monoFein = Schriftstil(familie: familieZahl, groesse: 11.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let monoKlein = Schriftstil(familie: familieZahl, groesse: 12.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let mono = Schriftstil(familie: familieZahl, groesse: 13.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let monoGross = Schriftstil(familie: familieZahl, groesse: 14.0, zeilenhoehe: 1.5926, gewicht: 400)
    public static let datenwertKlein = Schriftstil(familie: familieZahl, groesse: 22.0, zeilenhoehe: 1.5926, gewicht: 500)
    public static let datenwert = Schriftstil(familie: familieZahl, groesse: 32.0, zeilenhoehe: 1.5926, gewicht: 500)
    public static let datenwertGross = Schriftstil(familie: familieZahl, groesse: 40.0, zeilenhoehe: 1.5926, gewicht: 500)
    public static let grundschriftKompakt = Schriftstil(familie: familieText, groesse: 13.5, zeilenhoehe: 1.5926, gewicht: 400)
    public static let grundschriftKomfortabel = Schriftstil(familie: familieText, groesse: 15.0, zeilenhoehe: 1.5333, gewicht: 400)
    public static let grundschriftHandschuh = Schriftstil(familie: familieText, groesse: 15.0, zeilenhoehe: 1.5333, gewicht: 400)
}

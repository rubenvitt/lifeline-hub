// Erzeugt aus docs/design/design-system/project/tokens.json von scripts/design/tokens-nativ.mjs — nicht von Hand ändern.

package dev.rubeen.lifeline.helferkern

/** Ein Farbwert je Thema: `nacht` (dunkel) und `tag` (hell), je als ARGB `0xAARRGGBB`. */
data class Paar(val nacht: Long, val tag: Long)

/** Ein Schriftstil der Skala: Familie, Größe in sp, Zeilenhöhe als Faktor, Gewicht (CSS-Wert). */
data class Schriftstil(val familie: String, val groesse: Double, val zeilenhoehe: Double, val gewicht: Int)

object LifelineFarbe {
    val rolleGrund = Paar(nacht = 0xFF08090B, tag = 0xFFE6E7E9)
    val rolleFlaeche = Paar(nacht = 0xFF151719, tag = 0xFFFFFFFF)
    val rolleFlaeche2 = Paar(nacht = 0xFF1F2123, tag = 0xFFF2F3F5)
    val rolleLinie = Paar(nacht = 0xFF22262B, tag = 0xFFD4D8DD)
    val rolleLinieStark = Paar(nacht = 0xFF2E343A, tag = 0xFFB9BFC6)
    val rolleRasterLinie = Paar(nacht = 0x0E4D94D6, tag = 0x121A5FA0)
    val rolleText = Paar(nacht = 0xFFE8EBEE, tag = 0xFF111418)
    val rolleGedaempft = Paar(nacht = 0xFF9FA7B0, tag = 0xFF323941)
    val rolleSchwach = Paar(nacht = 0xFF9199A2, tag = 0xFF3D454E)
    val rolleBedien = Paar(nacht = 0xFF4D94D6, tag = 0xFF154E84)
    val rolleAlarm = Paar(nacht = 0xFFFF6B6B, tag = 0xFFB02318)
    val rolleAchtung = Paar(nacht = 0xFFE8CC3A, tag = 0xFF7A5200)
    val rolleNormal = Paar(nacht = 0xFF52C41A, tag = 0xFF1C6640)
    val rolleMarke = Paar(nacht = 0xFFA8071A, tag = 0xFFA8071A)
    val rolleAlarmFuellung = Paar(nacht = 0x1AFF6B6B, tag = 0x12B02318)
    val rolleAlarmFuellungStark = Paar(nacht = 0x3DFF6B6B, tag = 0x33B02318)
    val rolleAchtungFuellung = Paar(nacht = 0x1AE8CC3A, tag = 0x147A5200)
    val rolleAchtungFuellungStark = Paar(nacht = 0x3DE8CC3A, tag = 0x337A5200)
    val rolleNormalFuellung = Paar(nacht = 0x1A52C41A, tag = 0x121C6640)
    val rolleKopf = Paar(nacht = 0xFF151719, tag = 0xFFE6E7E9)
    val rollePaneel = Paar(nacht = 0xFF08090B, tag = 0xFFF2F3F5)
    val rolleFlaeche3 = Paar(nacht = 0xFF27292B, tag = 0xFFDBDCDE)
    val rolleText2 = Paar(nacht = 0xFFC6CCD2, tag = 0xFF272D34)
    val rolleSteuerRahmen = Paar(nacht = 0xFF6C747D, tag = 0xFF747C85)
    val rolleBedienHover = Paar(nacht = 0xFF7DB3E8, tag = 0xFF185895)
    val rolleBedienText = Paar(nacht = 0xFF8EC2F0, tag = 0xFF114577)
    val rolleAufBedien = Paar(nacht = 0xFF08090B, tag = 0xFFFFFFFF)
    val rolleNormalText = Paar(nacht = 0xFF7DDC4A, tag = 0xFF155234)
    val rolleAchtungText = Paar(nacht = 0xFFE8CC3A, tag = 0xFF604200)
    val rolleAlarmText = Paar(nacht = 0xFFFF6B6B, tag = 0xFF88140D)
    val rolleAlarmHover = Paar(nacht = 0xFFE88A87, tag = 0xFF7D1810)
    val rolleNormalFlaeche = Paar(nacht = 0xFF0D1A0A, tag = 0xFFE3F1E8)
    val rolleAchtungFlaeche = Paar(nacht = 0xFF1C1705, tag = 0xFFF7EFD5)
    val rolleAlarmFlaeche = Paar(nacht = 0xFF1C0A0D, tag = 0xFFF9E3E3)
    val rolleBedienFlaeche = Paar(nacht = 0xFF0D1620, tag = 0xFFE4EDF7)
    val rolleAuswahlFlaeche = Paar(nacht = 0xFF08172B, tag = 0xFFDBE7F5)
    val rolleGesperrt = Paar(nacht = 0xFF9CA4AD, tag = 0xFF525A63)
    val rolleBannerGrund = Paar(nacht = 0xFF0D1520, tag = 0xFFE6EEF8)
    val rolleBannerLinie = Paar(nacht = 0xFF1D3A5C, tag = 0xFF9DBBE0)
    val rolleBerichtigungZeile = Paar(nacht = 0xFF160D0F, tag = 0xFFFBEAEA)
    val rolleLueckeZeile = Paar(nacht = 0xFF161305, tag = 0xFFFAF3DA)
    val rolleProblemZeile = Paar(nacht = 0xFF1E1416, tag = 0xFFF8EDED)
    val rolleZeichenPlatte = Paar(nacht = 0xFFC9CED4, tag = 0x00000000)
    val rolleUebungFuellung = Paar(nacht = 0xFF6D28D9, tag = 0xFF6D28D9)
    val rolleUebungSchraffur = Paar(nacht = 0xFF5B21B6, tag = 0xFF5B21B6)
    val rolleUebungText = Paar(nacht = 0xFFFFFFFF, tag = 0xFFFFFFFF)
    val rolleUebungKante = Paar(nacht = 0xFFA78BFA, tag = 0xFFA78BFA)
    val rahmenGrund = Paar(nacht = 0xFF0C0E11, tag = 0xFF0C0E11)
    val rahmenAktiv = Paar(nacht = 0xFF16191D, tag = 0xFF16191D)
    val rahmenFeld = Paar(nacht = 0xFF14171B, tag = 0xFF14171B)
    val rahmenLinie = Paar(nacht = 0xFF22262B, tag = 0xFF22262B)
    val rahmenText = Paar(nacht = 0xFFE8EBEE, tag = 0xFFE8EBEE)
    val rahmenGedaempft = Paar(nacht = 0xFFA0A8B1, tag = 0xFFA0A8B1)
    val rahmenGesperrt = Paar(nacht = 0xFF838B94, tag = 0xFF838B94)
    val rahmenAlarm = Paar(nacht = 0xFFFF7070, tag = 0xFFFF7070)
    val rahmenBedien = Paar(nacht = 0xFF4D94D6, tag = 0xFF4D94D6)
    val maskeSprungpalette = Paar(nacht = 0xB8050608, tag = 0xB8050608)
    val sichtungSk1 = Paar(nacht = 0xFFF5222D, tag = 0xFFF5222D)
    val sichtungSk2 = Paar(nacht = 0xFFFADB14, tag = 0xFFFADB14)
    val sichtungSk3 = Paar(nacht = 0xFF52C41A, tag = 0xFF52C41A)
    val sichtungSk4 = Paar(nacht = 0xFF1677FF, tag = 0xFF1677FF)
    val sichtungTot = Paar(nacht = 0xFF000000, tag = 0xFF000000)
    val sichtungFlaecheSk1 = Paar(nacht = 0xFFA8071A, tag = 0xFFA8071A)
    val sichtungFlaecheSk2 = Paar(nacht = 0xFFFADB14, tag = 0xFFFADB14)
    val sichtungFlaecheSk3 = Paar(nacht = 0xFF135200, tag = 0xFF135200)
    val sichtungFlaecheSk4 = Paar(nacht = 0xFF003EB3, tag = 0xFF003EB3)
    val sichtungFlaecheTot = Paar(nacht = 0xFF000000, tag = 0xFF000000)
    val sichtungSchriftSk1 = Paar(nacht = 0xFFFFFFFF, tag = 0xFFFFFFFF)
    val sichtungSchriftSk2 = Paar(nacht = 0xFF000000, tag = 0xFF000000)
    val sichtungSchriftSk3 = Paar(nacht = 0xFFFFFFFF, tag = 0xFFFFFFFF)
    val sichtungSchriftSk4 = Paar(nacht = 0xFFFFFFFF, tag = 0xFFFFFFFF)
    val sichtungSchriftTot = Paar(nacht = 0xFFFFFFFF, tag = 0xFFFFFFFF)
    val sichtungKante = Paar(nacht = 0xFFE8EBEE, tag = 0xFF111418)
    val statusNormalGrund = Paar(nacht = 0xFF0D1A0A, tag = 0xFFE3F1E8)
    val statusBedienGrund = Paar(nacht = 0xFF0D1620, tag = 0xFFE4EDF7)
    val statusAchtungGrund = Paar(nacht = 0xFF1C1705, tag = 0xFFF7EFD5)
    val statusAlarmGrund = Paar(nacht = 0xFF1C0A0D, tag = 0xFFF9E3E3)
    val statusNeutralGrund = Paar(nacht = 0xFF27292B, tag = 0xFFDBDCDE)
    val statusNormalText = Paar(nacht = 0xFF7DDC4A, tag = 0xFF155234)
    val statusBedienText = Paar(nacht = 0xFF8EC2F0, tag = 0xFF114577)
    val statusAchtungText = Paar(nacht = 0xFFE8CC3A, tag = 0xFF604200)
    val statusAlarmText = Paar(nacht = 0xFFFF6B6B, tag = 0xFF88140D)
    val statusNeutralText = Paar(nacht = 0xFFC6CCD2, tag = 0xFF272D34)
    val statusNormalKante = Paar(nacht = 0xFF52C41A, tag = 0xFF1C6640)
    val statusBedienKante = Paar(nacht = 0xFF4D94D6, tag = 0xFF154E84)
    val statusAchtungKante = Paar(nacht = 0xFFE8CC3A, tag = 0xFF7A5200)
    val statusAlarmKante = Paar(nacht = 0xFFFF6B6B, tag = 0xFFB02318)
    val statusNeutralKante = Paar(nacht = 0xFF9199A2, tag = 0xFF3D454E)
    val etbMeldungKante = Paar(nacht = 0xFF1677FF, tag = 0xFF1677FF)
    val etbAnordnungKante = Paar(nacht = 0xFFD46B08, tag = 0xFFB35600)
    val etbEntscheidungKante = Paar(nacht = 0xFF8F4BE3, tag = 0xFF722ED1)
    val etbLageKante = Paar(nacht = 0xFF13C2C2, tag = 0xFF0E8C90)
    val etbBerichtigungKante = Paar(nacht = 0xFFD41B25, tag = 0xFFCF1322)
    val etbSystemKante = Paar(nacht = 0xFF9199A2, tag = 0xFF3D454E)
    val etbMeldungWort = Paar(nacht = 0xFF5C9DFF, tag = 0xFF0A449D)
    val etbAnordnungWort = Paar(nacht = 0xFFE8852A, tag = 0xFF7A3700)
    val etbEntscheidungWort = Paar(nacht = 0xFFA57FF0, tag = 0xFF5B1FAE)
    val etbLageWort = Paar(nacht = 0xFF13C2C2, tag = 0xFF005357)
    val etbBerichtigungWort = Paar(nacht = 0xFFFF6B6B, tag = 0xFF88140D)
    val etbSystemWort = Paar(nacht = 0xFF9FA7B0, tag = 0xFF323941)
    val warnstufeNiedrig = Paar(nacht = 0xFFD4B106, tag = 0xFF9E7F00)
    val warnstufeMittel = Paar(nacht = 0xFFD46B08, tag = 0xFFB35600)
    val warnstufeHoch = Paar(nacht = 0xFFCF1322, tag = 0xFFCF1322)
    val warnstufeAkut = Paar(nacht = 0xFFA8071A, tag = 0xFFA8071A)
    val fachebeneNina = Paar(nacht = 0xFFFF4D4F, tag = 0xFFCF1322)
    val fachebeneDwd = Paar(nacht = 0xFFFFA940, tag = 0xFFD48806)
    val fachebenePegelonline = Paar(nacht = 0xFF4096FF, tag = 0xFF096DD9)
    val fachebeneHochwasser = Paar(nacht = 0xFF36CFC9, tag = 0xFF08979C)
    val fachebeneLuftqualitaet = Paar(nacht = 0xFF8C9BB3, tag = 0xFF5B6B82)
    val fachebeneOdl = Paar(nacht = 0xFFA0D911, tag = 0xFF7CB305)
    val fachebeneAutobahn = Paar(nacht = 0xFFF759AB, tag = 0xFFC41D7F)
    val fachebeneAutobahnParken = Paar(nacht = 0xFF7FB0CF, tag = 0xFF3F6E8C)
    val fachebeneKritis = Paar(nacht = 0xFF9254DE, tag = 0xFF531DAB)
    val fachebeneEnergie = Paar(nacht = 0xFFFADB14, tag = 0xFFD4B106)
    val fachebeneCopernicus = Paar(nacht = 0xFFC48A5A, tag = 0xFF873800)
    val koerperschemaSilhouette = Paar(nacht = 0xFF27292B, tag = 0xFFDBDCDE)
    val koerperschemaKontur = Paar(nacht = 0xFF6C747D, tag = 0xFF747C85)
    val koerperschemaStern = Paar(nacht = 0xFFE8EBEE, tag = 0xFF111418)
    val koerperschemaBedien = Paar(nacht = 0xFF4D94D6, tag = 0xFF154E84)
}

/** Werte in dp. */
object LifelineAbstand {
    const val abstandKompaktXxs: Double = 4.0
    const val abstandKompaktXs: Double = 4.0
    const val abstandKompaktSm: Double = 8.0
    const val abstandKompaktMd: Double = 12.0
    const val abstandKompaktLg: Double = 16.0
    const val abstandKompaktXl: Double = 24.0
    const val abstandKomfortabelXxs: Double = 4.0
    const val abstandKomfortabelXs: Double = 4.0
    const val abstandKomfortabelSm: Double = 12.0
    const val abstandKomfortabelMd: Double = 20.0
    const val abstandKomfortabelLg: Double = 28.0
    const val abstandKomfortabelXl: Double = 40.0
    const val abstandHandschuhXxs: Double = 4.0
    const val abstandHandschuhXs: Double = 8.0
    const val abstandHandschuhSm: Double = 16.0
    const val abstandHandschuhMd: Double = 24.0
    const val abstandHandschuhLg: Double = 44.0
    const val abstandHandschuhXl: Double = 64.0
    const val seitenrinneBreit: Double = 24.0
    const val seitenrinneSchmal: Double = 12.0
}

/** Werte in dp. */
object LifelineGroesse {
    const val steuerhoeheKompakt: Double = 30.0
    const val steuerhoeheKleinKompakt: Double = 24.0
    const val steuerhoeheKomfortabel: Double = 48.0
    const val steuerhoeheKleinKomfortabel: Double = 48.0
    const val steuerhoeheHandschuh: Double = 72.0
    const val steuerhoeheKleinHandschuh: Double = 72.0
    const val seiteSchmal: Double = 900.0
    const val zustandOben: Double = 80.0
    const val kachelMin: Double = 260.0
    const val kachelMinKlein: Double = 220.0
    const val navDrawerBreite: Double = 360.0
    const val navDrawerRand: Double = 48.0
}

/** Werte in dp. */
object LifelineRadius {
    const val radiusFlaeche: Double = 0.0
    const val radiusSteuer: Double = 0.0
    const val radiusMarke: Double = 0.0
}

object LifelineSchrift {
    const val familieText = "LFH Archivo"
    const val familieDisplay = "LFH Archivo Narrow"
    const val familieZahl = "LFH JetBrains Mono"

    val ueberschrift = Schriftstil(familie = familieText, groesse = 30.0, zeilenhoehe = 1.5926, gewicht = 600)
    val seitentitel = Schriftstil(familie = familieText, groesse = 16.0, zeilenhoehe = 1.5926, gewicht = 600)
    val kartentitel = Schriftstil(familie = familieText, groesse = 15.0, zeilenhoehe = 1.5926, gewicht = 600)
    val text = Schriftstil(familie = familieText, groesse = 14.0, zeilenhoehe = 1.5926, gewicht = 400)
    val textKlein = Schriftstil(familie = familieText, groesse = 12.0, zeilenhoehe = 1.5926, gewicht = 400)
    val augenbraue = Schriftstil(familie = familieText, groesse = 11.0, zeilenhoehe = 1.5926, gewicht = 600)
    val railEtikett = Schriftstil(familie = familieText, groesse = 11.0, zeilenhoehe = 1.5926, gewicht = 500)
    val meta = Schriftstil(familie = familieText, groesse = 11.0, zeilenhoehe = 1.5926, gewicht = 400)
    val monoFein = Schriftstil(familie = familieZahl, groesse = 11.0, zeilenhoehe = 1.5926, gewicht = 400)
    val monoKlein = Schriftstil(familie = familieZahl, groesse = 12.0, zeilenhoehe = 1.5926, gewicht = 400)
    val mono = Schriftstil(familie = familieZahl, groesse = 13.0, zeilenhoehe = 1.5926, gewicht = 400)
    val monoGross = Schriftstil(familie = familieZahl, groesse = 14.0, zeilenhoehe = 1.5926, gewicht = 400)
    val datenwertKlein = Schriftstil(familie = familieZahl, groesse = 22.0, zeilenhoehe = 1.5926, gewicht = 500)
    val datenwert = Schriftstil(familie = familieZahl, groesse = 32.0, zeilenhoehe = 1.5926, gewicht = 500)
    val datenwertGross = Schriftstil(familie = familieZahl, groesse = 40.0, zeilenhoehe = 1.5926, gewicht = 500)
    val grundschriftKompakt = Schriftstil(familie = familieText, groesse = 13.5, zeilenhoehe = 1.5926, gewicht = 400)
    val grundschriftKomfortabel = Schriftstil(familie = familieText, groesse = 15.0, zeilenhoehe = 1.5333, gewicht = 400)
    val grundschriftHandschuh = Schriftstil(familie = familieText, groesse = 15.0, zeilenhoehe = 1.5333, gewicht = 400)
}

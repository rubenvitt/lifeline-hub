package dev.rubeen.lifeline.helfer.ui

import android.graphics.Typeface
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import dev.rubeen.lifeline.helferkern.LifelineFarbe
import dev.rubeen.lifeline.helferkern.LifelineRadius
import dev.rubeen.lifeline.helferkern.LifelineSchrift
import dev.rubeen.lifeline.helferkern.Paar
import dev.rubeen.lifeline.helferkern.Schriftstil

// Thema der Helfer-App aus den erzeugten Tokens (`helferkern/Tokens.kt`, Generator
// scripts/design/tokens-nativ.mjs; nie Werte von Hand). Material 3 mit den Rollenfarben des
// Design Systems statt dynamischer Systemfarben: `nacht` im dunklen, `tag` im hellen Systemmodus.
// Gegenstück zu ios/Helfer/Gemeinsam/Thema.swift.

/** Farbe eines Token-Paars im gewählten Modus (ARGB `0xAARRGGBB`). */
fun Paar.farbe(dunkel: Boolean): Color = Color(if (dunkel) nacht else tag)

/** Die Rollenfarben, die die Helfer-App nutzt. */
@Immutable
data class HelferFarben(
    val grund: Color,
    val flaeche: Color,
    val flaeche2: Color,
    val linie: Color,
    val linieStark: Color,
    val raster: Color,
    val text: Color,
    val text2: Color,
    val gedaempft: Color,
    val bedien: Color,
    val bedienText: Color,
    val aufBedien: Color,
    val bedienFlaeche: Color,
    val normal: Color,
    val normalText: Color,
    val normalFlaeche: Color,
    val achtung: Color,
    val achtungText: Color,
    val achtungFlaeche: Color,
    val alarm: Color,
    val alarmText: Color,
    val alarmFlaeche: Color,
    val marke: Color,
) {
    companion object {
        fun aus(dunkel: Boolean): HelferFarben = with(LifelineFarbe) {
            HelferFarben(
                grund = rolleGrund.farbe(dunkel),
                flaeche = rolleFlaeche.farbe(dunkel),
                flaeche2 = rolleFlaeche2.farbe(dunkel),
                linie = rolleLinie.farbe(dunkel),
                linieStark = rolleLinieStark.farbe(dunkel),
                raster = rolleRasterLinie.farbe(dunkel),
                text = rolleText.farbe(dunkel),
                text2 = rolleText2.farbe(dunkel),
                gedaempft = rolleGedaempft.farbe(dunkel),
                bedien = rolleBedien.farbe(dunkel),
                bedienText = rolleBedienText.farbe(dunkel),
                aufBedien = rolleAufBedien.farbe(dunkel),
                bedienFlaeche = rolleBedienFlaeche.farbe(dunkel),
                normal = rolleNormal.farbe(dunkel),
                normalText = rolleNormalText.farbe(dunkel),
                normalFlaeche = rolleNormalFlaeche.farbe(dunkel),
                achtung = rolleAchtung.farbe(dunkel),
                achtungText = rolleAchtungText.farbe(dunkel),
                achtungFlaeche = rolleAchtungFlaeche.farbe(dunkel),
                alarm = rolleAlarm.farbe(dunkel),
                alarmText = rolleAlarmText.farbe(dunkel),
                alarmFlaeche = rolleAlarmFlaeche.farbe(dunkel),
                marke = rolleMarke.farbe(dunkel),
            )
        }
    }
}

private val LocalFarben = staticCompositionLocalOf { HelferFarben.aus(dunkel = true) }

/** Die Rollenfarben des aktuellen Themas. */
val farbe: HelferFarben
    @Composable
    @ReadOnlyComposable
    get() = LocalFarben.current

private fun schema(f: HelferFarben, dunkel: Boolean) = if (dunkel) {
    darkColorScheme(
        primary = f.bedien, onPrimary = f.aufBedien,
        primaryContainer = f.bedienFlaeche, onPrimaryContainer = f.bedienText,
        secondary = f.normal, onSecondary = f.aufBedien,
        secondaryContainer = f.normalFlaeche, onSecondaryContainer = f.normalText,
        tertiary = f.achtung, onTertiary = f.aufBedien,
        tertiaryContainer = f.achtungFlaeche, onTertiaryContainer = f.achtungText,
        error = f.alarm, onError = f.aufBedien, errorContainer = f.alarmFlaeche, onErrorContainer = f.alarmText,
        background = f.grund, onBackground = f.text,
        surface = f.flaeche, onSurface = f.text,
        surfaceVariant = f.flaeche2, onSurfaceVariant = f.gedaempft,
        surfaceContainerLowest = f.grund, surfaceContainerLow = f.flaeche,
        surfaceContainer = f.flaeche, surfaceContainerHigh = f.flaeche2, surfaceContainerHighest = f.flaeche2,
        outline = f.linieStark, outlineVariant = f.linie,
    )
} else {
    lightColorScheme(
        primary = f.bedien, onPrimary = f.aufBedien,
        primaryContainer = f.bedienFlaeche, onPrimaryContainer = f.bedienText,
        secondary = f.normal, onSecondary = f.aufBedien,
        secondaryContainer = f.normalFlaeche, onSecondaryContainer = f.normalText,
        tertiary = f.achtung, onTertiary = f.aufBedien,
        tertiaryContainer = f.achtungFlaeche, onTertiaryContainer = f.achtungText,
        error = f.alarm, onError = f.aufBedien, errorContainer = f.alarmFlaeche, onErrorContainer = f.alarmText,
        background = f.grund, onBackground = f.text,
        surface = f.flaeche, onSurface = f.text,
        surfaceVariant = f.flaeche2, onSurfaceVariant = f.gedaempft,
        surfaceContainerLowest = f.flaeche, surfaceContainerLow = f.flaeche,
        surfaceContainer = f.flaeche, surfaceContainerHigh = f.flaeche2, surfaceContainerHighest = f.flaeche2,
        outline = f.linieStark, outlineVariant = f.linie,
    )
}

/** Eckige Form der Tokens (`radiusFlaeche`, `radiusSteuer`: 0). */
val eckig = RoundedCornerShape(LifelineRadius.radiusSteuer.dp)

private val formen = Shapes(
    extraSmall = RoundedCornerShape(LifelineRadius.radiusSteuer.dp),
    small = RoundedCornerShape(LifelineRadius.radiusSteuer.dp),
    medium = RoundedCornerShape(LifelineRadius.radiusFlaeche.dp),
    large = RoundedCornerShape(LifelineRadius.radiusFlaeche.dp),
    extraLarge = RoundedCornerShape(LifelineRadius.radiusFlaeche.dp),
)

/**
 * Schriftfamilie eines Tokens. Die Familien der Tokens sind nicht gebündelt; es gilt die
 * Systemschrift mit derselben Gestalt (schmal für Display, gleich breite Ziffern für Werte), wie in
 * der iOS-App.
 */
private fun familie(name: String): FontFamily = when (name) {
    LifelineSchrift.familieDisplay -> FontFamily(Typeface.create("sans-serif-condensed", Typeface.NORMAL))
    LifelineSchrift.familieZahl -> FontFamily.Monospace
    else -> FontFamily.SansSerif
}

private fun stil(s: Schriftstil, groesse: Double, zeilenhoehe: Double): TextStyle = TextStyle(
    fontFamily = familie(s.familie),
    fontWeight = FontWeight(s.gewicht),
    fontSize = groesse.sp,
    lineHeight = (groesse * zeilenhoehe).sp,
)

/**
 * Schriftstile der Helfer-App: Familien und Gewichte der Tokens, Größen für eine App mit einer
 * Aufgabe und großer Schrift (wie `Stil` in der iOS-App). `sp` folgt der Schriftgröße des Systems.
 */
object Stil {
    /** Große Zustandszeile („Ortung an“). */
    val zustand = stil(Schriftstil(LifelineSchrift.familieDisplay, 44.0, 1.05, 600), 44.0, 1.05)

    /** Überschrift einer Seite. */
    val titel = stil(Schriftstil(LifelineSchrift.familieDisplay, 32.0, 1.1, LifelineSchrift.ueberschrift.gewicht), 32.0, 1.1)

    /** Titel einer Karte oder eines Knopfs. */
    val kartentitel = stil(LifelineSchrift.kartentitel, 19.0, 1.3)

    /** Fließtext. */
    val text = stil(LifelineSchrift.text, 17.0, 1.4)

    /** Kleiner Text unter einem Wert. */
    val klein = stil(LifelineSchrift.textKlein, 14.0, 1.4)

    /** Augenbraue: Großbuchstaben über einem Abschnitt. */
    val augenbraue = stil(LifelineSchrift.augenbraue, 13.0, 1.3).copy(letterSpacing = 0.09.em)

    /** Werte (Zeit, Code), Ziffern gleich breit. */
    val wert = stil(LifelineSchrift.datenwert, 17.0, 1.3)
}

private val typografie = Typography(
    displaySmall = Stil.zustand,
    headlineMedium = Stil.titel,
    titleMedium = Stil.kartentitel,
    bodyLarge = Stil.text,
    bodyMedium = Stil.klein,
    labelLarge = Stil.kartentitel,
    labelMedium = Stil.klein,
    labelSmall = Stil.augenbraue,
)

/** Thema der Helfer-App: folgt dem Systemmodus, ohne dynamische Farben. */
@Composable
fun HelferThema(dunkel: Boolean = isSystemInDarkTheme(), inhalt: @Composable () -> Unit) {
    val f = HelferFarben.aus(dunkel)
    CompositionLocalProvider(LocalFarben provides f) {
        MaterialTheme(colorScheme = schema(f, dunkel), shapes = formen, typography = typografie, content = inhalt)
    }
}

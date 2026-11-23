package dev.rubeen.lifeline.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Farben des dauerdunklen Rahmens aus der Gestaltungssprache (`frontend/src/theme/tokens.ts`,
 * `rahmenFarben` und `farbenDunkel`): die nativen Seiten stehen wie Kopf und Rail der Oberfläche
 * auf Kopf-Schwarz, in beiden Systemmodi.
 */
object Farben {
    val kopfSchwarz = Color(0xFF0C0E11)
    val aktiv = Color(0xFF16191D)
    val feld = Color(0xFF14171B)
    val linie = Color(0xFF22262B)
    val text = Color(0xFFE8EBEE)
    val gedaempft = Color(0xFFA0A8B1)
    val bedien = Color(0xFF4D94D6)
    val bedienText = Color(0xFF8EC2F0)
    val marke = Color(0xFFA8071A)
    val steuerRahmen = Color(0xFF6C747D)
}

private val schema = darkColorScheme(
    primary = Farben.bedien,
    onPrimary = Color.White,
    secondary = Farben.bedienText,
    background = Farben.kopfSchwarz,
    onBackground = Farben.text,
    surface = Farben.kopfSchwarz,
    onSurface = Farben.text,
    surfaceVariant = Farben.feld,
    onSurfaceVariant = Farben.gedaempft,
    surfaceContainer = Farben.aktiv,
    outline = Farben.steuerRahmen,
    outlineVariant = Farben.linie,
    error = Color(0xFFFF6B6B),
)

/** Thema der nativen Seiten: dunkel auf Kopf-Schwarz, unabhängig vom Systemmodus. */
@Composable
fun LifelineThema(inhalt: @Composable () -> Unit) {
    MaterialTheme(colorScheme = schema, content = inhalt)
}

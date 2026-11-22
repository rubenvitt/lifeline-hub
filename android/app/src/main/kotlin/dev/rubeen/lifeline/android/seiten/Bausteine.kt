package dev.rubeen.lifeline.android.seiten

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.android.ui.Farben

/** Größte Breite des Inhalts nativer Seiten; auf Tablets steht er mittig (wie `StatusView`). */
val INHALT_MAX = 560.dp

/**
 * Rahmen einer nativen Seite: innerhalb der Systemränder (Leisten, Ausschnitt, Tastatur),
 * Kopfzeile oben, darunter der Inhalt rollbar und auf [INHALT_MAX] begrenzt.
 */
@Composable
fun Seitenrahmen(
    modifier: Modifier = Modifier,
    kopf: (@Composable () -> Unit)? = null,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        kopf?.invoke()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = INHALT_MAX)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                content = inhalt,
            )
        }
    }
}

/**
 * Kopfzeile einer nativen Seite: Titel mittig wie die Navigationsleiste auf iOS, links ein
 * Zurück-Knopf, rechts eigene Knöpfe.
 */
@Composable
fun Kopfzeile(
    titel: String,
    onZurueck: (() -> Unit)? = null,
    zurueckText: String = "Zurück",
    rechts: @Composable RowScope.() -> Unit = {},
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .padding(horizontal = 4.dp),
    ) {
        Text(
            titel,
            modifier = Modifier
                .align(Alignment.Center)
                .padding(horizontal = 96.dp),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
        if (onZurueck != null) {
            IconButton(onClick = onZurueck, modifier = Modifier.align(Alignment.CenterStart)) {
                Icon(painterResource(R.drawable.symbol_zurueck), contentDescription = zurueckText)
            }
        }
        Row(
            modifier = Modifier.align(Alignment.CenterEnd),
            verticalAlignment = Alignment.CenterVertically,
            content = rechts,
        )
    }
}

/**
 * Gruppe wie eine Section im iOS-Formular: Überschrift, Inhalt auf einer abgesetzten Fläche,
 * darunter eine Erläuterung.
 */
@Composable
fun Abschnitt(
    ueberschrift: String? = null,
    fussnote: String? = null,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (ueberschrift != null) {
            Text(
                ueberschrift,
                modifier = Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Farben.aktiv),
            content = inhalt,
        )
        if (fussnote != null) {
            Text(
                fussnote,
                modifier = Modifier.padding(horizontal = 16.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Zweiter Knopf neben dem hervorgehobenen: Rahmen in der Farbe der Steuerelemente, damit er auf
 * Kopf-Schwarz sichtbar bleibt (der Rahmen von Material 3 ist dort zu schwach).
 */
@Composable
fun Zweitknopf(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    inhalt: @Composable RowScope.() -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        border = BorderStroke(
            1.dp,
            if (enabled) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.outlineVariant,
        ),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onBackground),
        content = inhalt,
    )
}

/** Zeile mit Bezeichnung und Wert (wie `LabeledContent`). */
@Composable
fun Wertzeile(bezeichnung: String, wert: String, wertFarbe: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(bezeichnung, modifier = Modifier.weight(1f))
        Text(wert, color = wertFarbe)
    }
}

/** Trennlinie zwischen Zeilen eines [Abschnitt]s, links um [einzug] eingerückt. */
@Composable
fun Trennlinie(einzug: Dp = 16.dp) {
    HorizontalDivider(modifier = Modifier.padding(start = einzug), color = MaterialTheme.colorScheme.outlineVariant)
}

/** Unbestimmter Fortschritt in Textfarbe, mit sichtbarer Spur auf Kopf-Schwarz. */
@Composable
fun Fortschritt(modifier: Modifier = Modifier, strichstaerke: Dp = ProgressIndicatorDefaults.CircularStrokeWidth) {
    CircularProgressIndicator(
        modifier = modifier,
        color = MaterialTheme.colorScheme.onBackground,
        strokeWidth = strichstaerke,
        trackColor = MaterialTheme.colorScheme.outlineVariant,
    )
}

/** Symbol aus den Material Symbols der App (`res/drawable/symbol_*.xml`). */
@Composable
fun Symbol(
    @DrawableRes id: Int,
    beschreibung: String?,
    modifier: Modifier = Modifier.size(24.dp),
    farbe: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Icon(painterResource(id), contentDescription = beschreibung, modifier = modifier, tint = farbe)
}

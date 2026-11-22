package dev.rubeen.lifeline.android.seiten

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.kern.Fehlerklasse
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.Statustext
import dev.rubeen.lifeline.kern.Testzustand

/**
 * Native Status-Seite (Entwurf D2a, D3, D4; wie `StatusView`). Texte aus `Statusseite.text` im
 * Kern; die Seite ordnet nur Symbol und Knöpfe an.
 *
 * @param adresse Adresse des Servers unter dem Text; `null` bei „System-WebView aktualisieren“
 * @param onUpdate „Jetzt aktualisieren“ bei „App aktualisieren“, wenn der Updater einen Kanal hat
 * @param onPlayStore Play-Store-Seite von „Android System WebView“, wenn ein Store da ist
 */
@Composable
fun StatusSeite(
    status: Statusseite,
    text: Statustext,
    adresse: String?,
    onErneut: () -> Unit,
    onServerliste: () -> Unit,
    onUpdate: (() -> Unit)?,
    onPlayStore: (() -> Unit)? = null,
) {
    // „Nicht erreichbar“ prüft von selbst weiter; „WebView veraltet“ hat keinen Server zu prüfen.
    val bietetErneut = status != Statusseite.NichtErreichbar && status != Statusseite.WebviewVeraltet
    Seitenrahmen(modifier = Modifier.testTag("status-${status.kennung}")) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Symbol(status.symbol, beschreibung = null, modifier = Modifier.size(48.dp), farbe = status.farbe)
            Text(text.titel, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
            Text(text.text, style = MaterialTheme.typography.bodyLarge)
            if (adresse != null) {
                Text(
                    adresse,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Schritte(text.schritte)
            if (status == Statusseite.NichtErreichbar) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Fortschritt(modifier = Modifier.size(18.dp), strichstaerke = 2.dp)
                    Text("Prüft weiter …", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(
                modifier = Modifier.padding(top = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Genau ein hervorgehobener Knopf: Aktualisieren, sonst Erneut prüfen, sonst der Store.
                if (onUpdate != null) {
                    Button(onClick = onUpdate, modifier = Modifier.fillMaxWidth()) { Text("Jetzt aktualisieren") }
                }
                if (onPlayStore != null) {
                    Button(onClick = onPlayStore, modifier = Modifier.fillMaxWidth()) { Text("Im Play Store öffnen") }
                }
                if (bietetErneut) {
                    if (onUpdate == null) {
                        Button(onClick = onErneut, modifier = Modifier.fillMaxWidth()) { Text("Erneut prüfen") }
                    } else {
                        Zweitknopf(onClick = onErneut, modifier = Modifier.fillMaxWidth()) { Text("Erneut prüfen") }
                    }
                }
                Zweitknopf(
                    onClick = onServerliste,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("status-serverliste"),
                ) {
                    Text("Serverliste")
                }
            }
        }
    }
}

/** Nummerierte Anleitung („Zertifikat nicht vertrauenswürdig“). */
@Composable
fun Schritte(schritte: List<String>) {
    if (schritte.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        schritte.forEachIndexed { index, schritt ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${index + 1}.", fontWeight = FontWeight.Bold)
                Text(schritt)
            }
        }
    }
}

/** Symbol der Seite (Material Symbols statt der SF Symbols von iOS). */
@get:DrawableRes
val Statusseite.symbol: Int
    get() = when (this) {
        Statusseite.Zertifikat -> R.drawable.symbol_zertifikat
        Statusseite.NichtErreichbar -> R.drawable.symbol_nicht_erreichbar
        is Statusseite.NichtVertraeglich ->
            if (klasse == Fehlerklasse.ZU_NEU) R.drawable.symbol_app_aktualisieren else R.drawable.symbol_server_zu_alt
        Statusseite.WebviewVeraltet -> R.drawable.symbol_webview
    }

/** Orange für „nicht erreichbar“ (geht von selbst vorbei), sonst Rot (wie `StatusView`). */
val Statusseite.farbe: Color
    get() = if (this == Statusseite.NichtErreichbar) Color(0xFFFFA94D) else Color(0xFFFF6B6B)

/** Kennung für Tests, gleich dem Wert des Testzustands. */
val Statusseite.kennung: String
    get() = when (this) {
        Statusseite.Zertifikat -> Testzustand.ZERTIFIKAT.wert
        Statusseite.NichtErreichbar -> Testzustand.NICHT_ERREICHBAR.wert
        is Statusseite.NichtVertraeglich ->
            if (klasse == Fehlerklasse.ZU_NEU) Testzustand.ZU_NEU.wert else Testzustand.ZU_ALT.wert
        Statusseite.WebviewVeraltet -> Testzustand.WEBVIEW_VERALTET.wert
    }

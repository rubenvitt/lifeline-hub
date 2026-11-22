package dev.rubeen.lifeline.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.android.seiten.EinstellungenSeite
import dev.rubeen.lifeline.android.seiten.Fortschritt
import dev.rubeen.lifeline.android.seiten.MitQrScan
import dev.rubeen.lifeline.android.seiten.OnboardingSeite
import dev.rubeen.lifeline.android.seiten.ServerlisteSeite
import dev.rubeen.lifeline.android.seiten.StatusSeite
import dev.rubeen.lifeline.android.seiten.UpdateSeite
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Fehlerklasse
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.text

/**
 * Wurzel der Hülle (wie `RootView`): die Seite, die `Ablauf` festlegt, und darüber die nativen
 * Seiten Serverliste, Onboarding für einen weiteren Server und Einstellungen. Zurück schließt die
 * oberste native Seite (Entwurf D6).
 */
@Composable
fun Wurzel(modell: AppModell) {
    BackHandler(enabled = modell.hatBlatt && !modell.zeigtUpdate) { modell.zurueck() }
    // Die Fläche setzt Grund und Textfarbe des Themas für alles darunter.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when {
            modell.zeigtUpdate -> UpdateSeite()
            modell.zeigtEinstellungen -> EinstellungenSeite(
                haptik = modell.haptik,
                onHaptik = modell::schalteHaptik,
                version = modell.appVersion,
                kanal = modell.kanal,
                stand = modell.updatestand,
                onPruefen = modell::pruefeUpdate,
                onInstallieren = modell::installiereUpdate,
                build = modell.build,
                onZurueck = { modell.zeigtEinstellungen = false },
            )
            modell.zeigtOnboarding -> MitQrScan(onEvent = { modell.send(it) }) { onScan, hinweis ->
                OnboardingSeite(
                    state = modell.onboarding,
                    onEvent = { modell.send(it) },
                    onScan = onScan,
                    alsBlatt = true,
                    onAbbrechen = { modell.zeigtOnboarding = false },
                    appVersion = modell.appVersion,
                    scanHinweis = hinweis,
                )
            }
            modell.zeigtServerliste -> ServerlisteSeite(
                liste = modell.liste,
                seite = modell.seite,
                onWechseln = modell::wechseln,
                onZurOberflaeche = modell::zurOberflaeche,
                onUmbenennen = modell::umbenennen,
                onEntfernen = modell::entfernen,
                onHinzufuegen = modell::zeigeHinzufuegen,
                onEinstellungen = { modell.zeigtEinstellungen = true },
                onFertig = { modell.zeigtServerliste = false },
                inEntfernung = modell.inEntfernung,
                entfernenFehler = modell.entfernenFehler,
                onFehlerGesehen = modell::fehlerGesehen,
            )
            else -> AblaufSeite(modell)
        }
    }
}

@Composable
private fun AblaufSeite(modell: AppModell) {
    when (val seite = modell.seite) {
        Ablauf.Seite.Onboarding -> MitQrScan(onEvent = { modell.send(it) }) { onScan, hinweis ->
            OnboardingSeite(
                state = modell.onboarding,
                onEvent = { modell.send(it) },
                onScan = onScan,
                appVersion = modell.appVersion,
                scanHinweis = hinweis,
            )
        }
        is Ablauf.Seite.Pruefung -> Box(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .testTag("pruefung"),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Fortschritt()
                Text(
                    "Verbinde mit „${modell.aktuell(seite.eintrag).name}“ …",
                    modifier = Modifier.padding(horizontal = 24.dp),
                    textAlign = TextAlign.Center,
                )
            }
        }
        // Den WebView je Server zeigt die App mit dem Vertragsabruf; bis dahin bleibt der Grund.
        is Ablauf.Seite.Web -> Box(modifier = Modifier.fillMaxSize())
        is Ablauf.Seite.Status -> {
            val eintrag = modell.aktuell(seite.eintrag)
            val status = seite.status
            val bietetUpdate = status is Statusseite.NichtVertraeglich && status.klasse == Fehlerklasse.ZU_NEU &&
                modell.kanal != null
            StatusSeite(
                status = status,
                text = status.text(servername = eintrag.name, appVersion = modell.appVersion),
                adresse = eintrag.adresse.text,
                onErneut = modell::pruefeErneut,
                onServerliste = { modell.zeigtServerliste = true },
                onUpdate = if (bietetUpdate) modell::aktualisieren else null,
            )
        }
        Ablauf.Seite.WebviewVeraltet -> {
            val context = LocalContext.current
            val store = remember(context) { webviewImStore(context) }
            StatusSeite(
                status = Statusseite.WebviewVeraltet,
                text = Statusseite.WebviewVeraltet.text(servername = null, appVersion = modell.appVersion),
                adresse = null,
                onErneut = {},
                onServerliste = { modell.zeigtServerliste = true },
                onUpdate = null,
                onPlayStore = store,
            )
        }
    }
}

/** Play-Store-Seite von „Android System WebView“; `null`, wenn kein Store sie öffnen kann (Entwurf D3). */
private fun webviewImStore(context: Context): (() -> Unit)? {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview"))
    if (intent.resolveActivity(context.packageManager) == null) return null
    return { context.startActivity(intent) }
}

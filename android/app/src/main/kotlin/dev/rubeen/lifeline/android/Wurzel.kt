package dev.rubeen.lifeline.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.rubeen.lifeline.android.seiten.EinstellungenSeite
import dev.rubeen.lifeline.android.seiten.Fortschritt
import dev.rubeen.lifeline.android.seiten.Hinweispunkt
import dev.rubeen.lifeline.android.seiten.INHALT_MAX
import dev.rubeen.lifeline.android.seiten.MitQrScan
import dev.rubeen.lifeline.android.seiten.OnboardingSeite
import dev.rubeen.lifeline.android.seiten.ServerlisteSeite
import dev.rubeen.lifeline.android.seiten.StatusSeite
import dev.rubeen.lifeline.android.seiten.Symbol
import dev.rubeen.lifeline.android.seiten.UpdateSeite
import dev.rubeen.lifeline.android.ui.Farben
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.Fehlerklasse
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.text

/**
 * Wurzel der Hülle (wie `RootView`): die Seite, die `Ablauf` festlegt, und darüber die nativen
 * Seiten Serverliste, Onboarding für einen weiteren Server und Einstellungen. Zurück schließt die
 * oberste native Seite (Entwurf D6; `MainActivity` mit `AppModell.zurueckTaste`). Nennt ein
 * Deeplink einen gespeicherten Server, fragt sie vor dem Wechsel.
 */
@Composable
fun Wurzel(modell: AppModell) {
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
                    healthVersion = modell.onboardingHealthVersion,
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
                updateHinweis = modell.updatestand.isHinweis,
            )
            else -> AblaufSeite(modell)
        }
        modell.wechselRueckfrage?.let { eintrag ->
            WechselRueckfrage(
                name = modell.aktuell(eintrag).name,
                adresse = eintrag.adresse.text,
                onWechseln = { modell.wechseln(modell.aktuell(eintrag)) },
                onAbbrechen = { modell.wechselRueckfrage = null },
            )
        }
    }
}

/** Rückfrage vor dem Wechsel per Deeplink (wie `confirmationDialog` in `RootView`). */
@Composable
private fun WechselRueckfrage(name: String, adresse: String, onWechseln: () -> Unit, onAbbrechen: () -> Unit) {
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text("Server wechseln?") },
        text = { Text("Ein Link möchte die App mit $adresse verbinden.") },
        confirmButton = {
            TextButton(onClick = onWechseln, modifier = Modifier.testTag("wechsel-bestaetigen")) {
                Text("Zu „$name“ wechseln")
            }
        },
        dismissButton = {
            TextButton(onClick = onAbbrechen) { Text("Abbrechen") }
        },
    )
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
                healthVersion = modell.onboardingHealthVersion,
                scanHinweis = hinweis,
            )
        }
        is Ablauf.Seite.Pruefung -> Box(modifier = Modifier.fillMaxSize()) {
            Box(
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
            Randknopf(
                onTipp = { modell.zeigtServerliste = true },
                updateHinweis = modell.updatestand.isHinweis,
                modifier = Modifier.align(Alignment.BottomStart),
            )
        }
        is Ablauf.Seite.Web -> Box(modifier = Modifier.fillMaxSize()) {
            modell.webView?.let { WebFlaeche(it) }
            Randknopf(
                onTipp = { modell.zeigtServerliste = true },
                updateHinweis = modell.updatestand.isHinweis,
                modifier = Modifier.align(Alignment.BottomStart),
            )
            AnimatedVisibility(
                visible = modell.zeigtZurOberflaeche,
                modifier = Modifier.align(Alignment.TopCenter),
                enter = fadeIn() + slideInVertically { -it },
                exit = fadeOut() + slideOutVertically { -it },
            ) {
                ZurOberflaecheHinweis(
                    onZurOberflaeche = modell::zurOberflaeche,
                    onSchliessen = modell::verwerfeZurOberflaeche,
                )
            }
        }
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

/**
 * Der WebView des aktiven Servers innerhalb der Systemränder (Leisten, Ausschnitt, Tastatur;
 * Entwurf D6). Der Rahmen ist eine `FrameLayout` in Kopf-Schwarz; ein neuer WebView (Wechsel,
 * Neubau) ersetzt den alten darin.
 */
@Composable
private fun WebFlaeche(webView: WebView) {
    AndroidView(
        factory = { context -> FrameLayout(context).apply { setBackgroundColor(Farben.kopfSchwarz.toArgb()) } },
        update = { rahmen ->
            if (webView.parent !== rahmen) {
                (webView.parent as? ViewGroup)?.removeView(webView)
                rahmen.removeAllViews()
                rahmen.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
        },
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .testTag("webview"),
    )
}

/**
 * Kleiner runder Knopf unten links zur Serverliste (Entwurf D2): innerhalb der Systemränder, weg
 * vom Kopf der Oberfläche, halb durchsichtig, damit er die Seite kaum verdeckt. Wartet ein Update
 * auf die Person, trägt er einen Punkt (Entwurf D9).
 */
@Composable
private fun Randknopf(onTipp: () -> Unit, updateHinweis: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(start = 8.dp, bottom = 8.dp)
            .size(44.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClickLabel = "Serverliste öffnen", onClick = onTipp)
            .testTag("serverliste-knopf"),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(Farben.aktiv.copy(alpha = 0.85f))
                .border(1.dp, Farben.linie, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Symbol(R.drawable.symbol_serverliste, beschreibung = "Serverliste", modifier = Modifier.size(18.dp))
        }
        if (updateHinweis) {
            Hinweispunkt(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 3.dp, end = 3.dp)
                    .semantics { contentDescription = "Update bereit" }
                    .testTag("update-hinweis"),
            )
        }
    }
}

/**
 * Hinweis über dem WebView, wenn er nach der Rückkehr auf einer fremden Seite steht (`Ablauf`,
 * `ShowZurOberflaeche`; wie `ZurOberflaecheHinweis` auf iOS). Kein Zwang: die Seite bleibt, bis
 * die Person „Zur Oberfläche“ wählt oder den Hinweis schließt.
 */
@Composable
private fun ZurOberflaecheHinweis(onZurOberflaeche: () -> Unit, onSchliessen: () -> Unit) {
    Row(
        modifier = Modifier
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .widthIn(max = INHALT_MAX)
            .clip(CircleShape)
            .background(Farben.aktiv.copy(alpha = 0.96f))
            .border(1.dp, Farben.linie, CircleShape)
            .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)
            .testTag("hinweis-fremde-seite"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Symbol(R.drawable.symbol_fremde_seite, beschreibung = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(
            "Fremde Seite",
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(12.dp))
        Button(
            onClick = onZurOberflaeche,
            modifier = Modifier
                .height(36.dp)
                .testTag("hinweis-zur-oberflaeche"),
            contentPadding = ButtonDefaults.SmallContentPadding,
        ) {
            Text("Zur Oberfläche", style = MaterialTheme.typography.labelLarge)
        }
        IconButton(onClick = onSchliessen, modifier = Modifier.testTag("hinweis-schliessen")) {
            Symbol(R.drawable.symbol_schliessen, beschreibung = "Hinweis schließen", modifier = Modifier.size(18.dp))
        }
    }
}

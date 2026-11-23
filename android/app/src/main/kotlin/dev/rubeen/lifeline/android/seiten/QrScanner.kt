package dev.rubeen.lifeline.android.seiten

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.CameraController
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import dev.rubeen.lifeline.kern.Deeplink
import dev.rubeen.lifeline.kern.Onboarding

/**
 * QR-Code im Onboarding (Entwurf D2): die Kameraberechtigung wird erst beim Scannen erfragt;
 * der Inhalt geht über `Deeplink.adresseAusQrCode` als `Onboarding.Event.Vorbelegen` ins Feld,
 * geprüft wird erst nach „Verbinden“. Während des Scans zeigt die Seite den Scanner statt
 * [inhalt]; [inhalt] bekommt den Start des Scans und die Meldung des letzten Versuchs.
 */
@Composable
fun MitQrScan(
    onEvent: (Onboarding.Event) -> Unit,
    inhalt: @Composable (onScan: () -> Unit, hinweis: String?) -> Unit,
) {
    val context = LocalContext.current
    var scannt by rememberSaveable { mutableStateOf(false) }
    var hinweis by rememberSaveable { mutableStateOf<String?>(null) }
    val berechtigung = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { erteilt ->
        if (erteilt) {
            hinweis = null
            scannt = true
        } else {
            hinweis = KAMERA_GESPERRT
        }
    }

    if (scannt) {
        BackHandler { scannt = false }
        QrScanner(
            onGefunden = { text ->
                scannt = false
                val adresse = Deeplink.adresseAusQrCode(text)
                if (adresse != null) {
                    hinweis = null
                    onEvent(Onboarding.Event.Vorbelegen(adresse))
                } else {
                    hinweis = "Der QR-Code enthält keine Adresse eines Einsatzservers."
                }
            },
            onAbbrechen = { scannt = false },
        )
    } else {
        inhalt(
            {
                when {
                    !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) ->
                        hinweis = "Dieses Gerät hat keine Kamera. Bitte die Adresse eingeben."
                    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                        PackageManager.PERMISSION_GRANTED -> {
                        hinweis = null
                        scannt = true
                    }
                    else -> berechtigung.launch(Manifest.permission.CAMERA)
                }
            },
            hinweis,
        )
    }
}

private const val KAMERA_GESPERRT =
    "Die Kamera ist für Lifeline nicht freigegeben (Einstellungen → Apps → Lifeline → Berechtigungen → Kamera)."

/**
 * Vollbild-Scanner mit CameraX und dem Barcode-Leser von ML Kit (Modell in der App, keine
 * Play-Dienste nötig). Meldet den ersten QR-Code mit Text genau einmal.
 */
@Composable
fun QrScanner(onGefunden: (String) -> Unit, onAbbrechen: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val gefunden by rememberUpdatedState(onGefunden)
    val controller = remember { LifecycleCameraController(context) }

    DisposableEffect(lifecycleOwner) {
        val leser = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
        val hauptfaden = ContextCompat.getMainExecutor(context)
        var fertig = false
        controller.setEnabledUseCases(CameraController.IMAGE_ANALYSIS)
        controller.setImageAnalysisAnalyzer(
            hauptfaden,
            MlKitAnalyzer(listOf(leser), ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL, hauptfaden) { ergebnis ->
                if (fertig) return@MlKitAnalyzer
                val text = ergebnis.getValue(leser)?.firstNotNullOfOrNull { it.rawValue } ?: return@MlKitAnalyzer
                fertig = true
                gefunden(text)
            },
        )
        controller.bindToLifecycle(lifecycleOwner)
        onDispose {
            controller.unbind()
            controller.clearImageAnalysisAnalyzer()
            leser.close()
        }
    }

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            factory = { PreviewView(it).apply { this.controller = controller } },
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(240.dp)
                .border(3.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(16.dp)),
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Box(modifier = Modifier.background(Color.Black.copy(alpha = 0.55f))) {
                Kopfzeile(titel = "QR-Code scannen") {
                    TextButton(onClick = onAbbrechen) { Text("Abbrechen") }
                }
            }
            Box(modifier = Modifier.weight(1f))
            Text(
                "Den QR-Code mit der Adresse des Servers in den Rahmen halten.",
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(24.dp)
                    .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

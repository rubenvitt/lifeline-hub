package dev.rubeen.lifeline.helfer.seiten

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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe

/**
 * Scanner über den ganzen Bildschirm (Spec „Scanner“): CameraX mit dem Barcode-Leser von ML Kit
 * (Modell in der App, keine Play-Dienste nötig), wie im Onboarding der Lifeline-App. Die Kamera
 * wird erst hier erfragt. Meldet den ersten QR-Code mit Text genau einmal; ob er eine
 * Helfer-Einladung ist, entscheidet `deuteHelferLink` im Modell.
 */
@Composable
fun ScannerSeite(onGefunden: (String) -> Unit, onAbbrechen: () -> Unit) {
    val context = LocalContext.current
    var stand by remember {
        mutableStateOf(
            when {
                !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) -> Kamerastand.OHNE
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED ->
                    Kamerastand.BEREIT
                else -> Kamerastand.FRAGEN
            },
        )
    }
    val anfrage = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { erteilt ->
        stand = if (erteilt) Kamerastand.BEREIT else Kamerastand.VERWEIGERT
    }
    LaunchedEffect(Unit) {
        if (stand == Kamerastand.FRAGEN) anfrage.launch(Manifest.permission.CAMERA)
    }
    BackHandler(onBack = onAbbrechen)

    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        when (stand) {
            Kamerastand.BEREIT -> Kamera(onGefunden)
            Kamerastand.FRAGEN -> Unit
            Kamerastand.VERWEIGERT, Kamerastand.OHNE -> Column(
                modifier = Modifier.align(Alignment.Center).padding(Abstand.rinne),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Abstand.md),
            ) {
                Icon(painterResource(R.drawable.symbol_kamera), contentDescription = null, tint = farbe.gedaempft, modifier = Modifier.size(40.dp))
                Text(
                    if (stand == Kamerastand.OHNE) "Dieses Gerät hat keine Kamera." else "Die Kamera ist für Lifeline Helfer nicht freigegeben.",
                    style = Stil.kartentitel,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
                Text(
                    "Einstellungen → Apps → Lifeline Helfer → Berechtigungen → Kamera. Oder „Code eingeben“ auf dem Start.",
                    style = Stil.klein,
                    color = farbe.gedaempft,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Column(modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(Abstand.rinne)) {
            Row(modifier = Modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                Box(Modifier.testTag("scanner-schliessen")) { Schliessknopf(onAbbrechen, "Schließen") }
            }
            Spacer(Modifier.weight(1f))
            if (stand == Kamerastand.BEREIT) {
                Text(
                    "QR-Code der Einsatzleitung in den Rahmen halten",
                    modifier = Modifier
                        .align(Alignment.CenterHorizontally)
                        .background(Color.Black.copy(alpha = 0.55f), eckig)
                        .padding(Abstand.sm),
                    style = Stil.text,
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private enum class Kamerastand { FRAGEN, BEREIT, VERWEIGERT, OHNE }

/** Vorschau und Leser; der Rahmen in der Mitte zeigt, wohin der Code gehört. */
@Composable
private fun Kamera(onGefunden: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val gefunden by rememberUpdatedState(onGefunden)
    val controller = remember { LifecycleCameraController(context) }
    val bedien = farbe.bedien

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

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { PreviewView(it).apply { this.controller = controller } },
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(240.dp)
                .border(3.dp, bedien, eckig),
        )
    }
}

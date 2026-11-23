package dev.rubeen.lifeline.android.dienste

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import dev.rubeen.lifeline.android.web.Webzugriffe
import dev.rubeen.lifeline.android.web.dateiwahlErgebnis

/**
 * Dateiwahl und Recht `CAMERA` der Oberfläche über Activity-Ergebnisse (Review W4). Anmelden
 * muss die Activity sie in `onCreate`, vor ihrem Start (wie [Anmeldebrowser]).
 */
class Activityzugriffe(private val activity: ComponentActivity) : Webzugriffe {
    private var dateiFertig: ((Array<Uri>?) -> Unit)? = null
    private val kameraFertig = mutableListOf<(Boolean) -> Unit>()

    private val dateiwahl = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { ergebnis ->
        val fertig = dateiFertig ?: return@registerForActivityResult
        dateiFertig = null
        fertig(dateiwahlErgebnis(ergebnis.resultCode, ergebnis.data))
    }

    private val kameraRecht = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { erlaubt ->
        val wartend = kameraFertig.toList()
        kameraFertig.clear()
        wartend.forEach { it(erlaubt) }
    }

    override fun waehleDateien(intent: Intent, fertig: (Array<Uri>?) -> Unit): Boolean {
        // Eine offene Wahl endet; der WebView öffnet sonst keine neue.
        dateiFertig?.invoke(null)
        dateiFertig = fertig
        return try {
            dateiwahl.launch(intent)
            true
        } catch (e: ActivityNotFoundException) {
            Log.w("Lifeline", "Keine App für die Dateiwahl", e)
            dateiFertig = null
            false
        }
    }

    override fun kamera(fertig: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            fertig(true)
            return
        }
        kameraFertig += fertig
        if (kameraFertig.size == 1) kameraRecht.launch(Manifest.permission.CAMERA)
    }
}

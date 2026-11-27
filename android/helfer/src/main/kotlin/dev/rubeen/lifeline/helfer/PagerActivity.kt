package dev.rubeen.lifeline.helfer

import android.app.KeyguardManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableIntStateOf
import dev.rubeen.lifeline.helfer.dienste.Mitteilungen
import dev.rubeen.lifeline.helfer.seiten.PagerSeite
import dev.rubeen.lifeline.helfer.ui.HelferThema

/**
 * Vollbild des Pagers (LLH-2157): startet über den Full-Screen-Intent der Auftragsmitteilung, auch
 * über dem Sperrbildschirm und mit eingeschaltetem Bildschirm (Manifest: `showWhenLocked`,
 * `turnScreenOn`). Zeigt keinen Inhalt; sichtbar beendet es den Dauerton
 * ([Mitteilungen.stumm]), „Ansehen“ entsperrt und öffnet das Detail in [MainActivity].
 */
class PagerActivity : ComponentActivity() {
    private var auftrag = -1L
    private val erinnerung = mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        uebernimm(intent)
        setContent {
            HelferThema {
                PagerSeite(erinnerung = erinnerung.intValue > 0, onAnsehen = ::ansehen)
            }
        }
    }

    /** Eine Erinnerung, während das Vollbild noch steht (`singleTop`). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        uebernimm(intent)
    }

    private fun uebernimm(intent: Intent?) {
        auftrag = intent?.getLongExtra(Mitteilungen.EXTRA_AUFTRAG, -1L) ?: -1L
        erinnerung.intValue = intent?.getIntExtra(EXTRA_ERINNERUNG, 0) ?: 0
        if (auftrag >= 0) Mitteilungen.stumm(this, auftrag)
    }

    private fun ansehen() {
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (keyguard?.isKeyguardLocked == true) {
            keyguard.requestDismissKeyguard(
                this,
                object : KeyguardManager.KeyguardDismissCallback() {
                    override fun onDismissSucceeded() = oeffneDetail()
                },
            )
        } else {
            oeffneDetail()
        }
    }

    private fun oeffneDetail() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(Mitteilungen.EXTRA_AUFTRAG, auftrag)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    companion object {
        /** Stufe der Erinnerung (0 beim ersten Mal). */
        const val EXTRA_ERINNERUNG = "lifeline.helfer.erinnerung"
    }
}

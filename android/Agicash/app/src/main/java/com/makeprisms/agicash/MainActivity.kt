package com.makeprisms.agicash

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.makeprisms.agicash.ui.AgicashRoot
import com.makeprisms.agicash.ui.theme.AgicashTheme
import com.makeprisms.agicash.wallet.WalletViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: WalletViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AgicashTheme {
                AgicashRoot(viewModel = viewModel)
            }
        }
    }
}

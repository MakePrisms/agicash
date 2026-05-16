package com.makeprisms.agicash.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.makeprisms.agicash.ui.screens.HomeScreen
import com.makeprisms.agicash.ui.screens.LoginScreen
import com.makeprisms.agicash.ui.screens.SettingsScreen
import com.makeprisms.agicash.wallet.WalletViewModel

/**
 * Top-level shell. Mirrors `ContentView.swift` (ios) — reads [WalletViewModel]
 * state and routes to login or the bottom-tab signed-in surface.
 */
@Composable
fun AgicashRoot(viewModel: WalletViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when (val s = state) {
        is WalletViewModel.BootState.Pending -> CenteredSpinner("Starting Agicash...")
        is WalletViewModel.BootState.Failed -> FatalErrorView(s.message)
        is WalletViewModel.BootState.Ready -> AuthGate(viewModel, s.phase)
    }
}

@Composable
private fun AuthGate(viewModel: WalletViewModel, phase: WalletViewModel.Phase) {
    when (phase) {
        is WalletViewModel.Phase.SignedOut -> LoginScreen(viewModel)
        is WalletViewModel.Phase.SignedIn -> SignedInShell(viewModel)
        is WalletViewModel.Phase.Error -> ErrorView(viewModel, phase.message)
    }
}

@Composable
private fun SignedInShell(viewModel: WalletViewModel) {
    var selected by remember { mutableStateOf(Tab.HOME) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selected == Tab.HOME,
                    onClick = { selected = Tab.HOME },
                    icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                    label = { Text("Home") },
                )
                NavigationBarItem(
                    selected = selected == Tab.SETTINGS,
                    onClick = { selected = Tab.SETTINGS },
                    icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                    label = { Text("Settings") },
                )
            }
        },
    ) { inner ->
        Box(Modifier.padding(inner)) {
            when (selected) {
                Tab.HOME -> HomeScreen(viewModel)
                Tab.SETTINGS -> SettingsScreen(viewModel)
            }
        }
    }
}

private enum class Tab { HOME, SETTINGS }

@Composable
private fun CenteredSpinner(label: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircularProgressIndicator()
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun FatalErrorView(message: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Outlined.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
            )
            Text("Failed to start", style = MaterialTheme.typography.titleMedium)
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ErrorView(viewModel: WalletViewModel, message: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Outlined.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
            )
            Text("Something went wrong", style = MaterialTheme.typography.titleMedium)
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            androidx.compose.material3.Button(onClick = { viewModel.signOut() }) {
                Text("Sign out and retry")
            }
        }
    }
}

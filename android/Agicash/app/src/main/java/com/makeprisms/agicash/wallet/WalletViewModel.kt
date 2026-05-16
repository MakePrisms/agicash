package com.makeprisms.agicash.wallet

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import uniffi.agicash_ffi.AccountFfi
import uniffi.agicash_ffi.AgicashWallet
import uniffi.agicash_ffi.FfiException
import uniffi.agicash_ffi.Session
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Mirrors `ios/Agicash/Agicash/WalletViewModel.swift` but in Android idiom:
 * Compose `@State` -> `StateFlow`, swift's `WalletState` boot wrapper is
 * collapsed into [BootState] inside this same class.
 *
 * Phase 1 talks to local OpenSecret + local Supabase (see [Endpoints]).
 * Endpoint overrides arrive in Phase 2+ when the app grows a settings UI.
 *
 * Session persistence is intentionally NOT implemented here for Android v0.
 * The Rust FFI's `keyring` crate has no Android backend (see SPIKE_REPORT.md
 * section Q5), and a JNI-backed `SessionStorage` is its own slice. In v0 the
 * user re-authenticates on every cold start.
 */
class WalletViewModel : ViewModel() {

    /**
     * Hardcoded Phase 1 dev endpoints. On the Android emulator, host
     * loopback is reached via `10.0.2.2`, not `127.0.0.1`. The OpenSecret
     * enclave listens on :3999 and the local Supabase stack on :54321.
     */
    private object Endpoints {
        const val OPENSECRET_URL = "http://10.0.2.2:3999"
        const val OPENSECRET_CLIENT_ID = "ba5a14b5-d915-47b1-b7b1-afda52bc5fc6"
        const val SUPABASE_URL = "https://10.0.2.2:54321"
        // Local supabase publishable anon key (same one used by the JS app +
        // the integration tests; not a secret).
        const val SUPABASE_ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
    }

    sealed interface BootState {
        data object Pending : BootState
        data class Ready(val phase: Phase) : BootState
        data class Failed(val message: String) : BootState
    }

    sealed interface Phase {
        data object SignedOut : Phase
        data class SignedIn(val userId: String) : Phase
        data class Error(val message: String) : Phase
    }

    private val _state = MutableStateFlow<BootState>(BootState.Pending)
    val state: StateFlow<BootState> = _state.asStateFlow()

    private val _accounts = MutableStateFlow<List<AccountFfi>>(emptyList())
    val accounts: StateFlow<List<AccountFfi>> = _accounts.asStateFlow()

    private val _isWorking = MutableStateFlow(false)
    val isWorking: StateFlow<Boolean> = _isWorking.asStateFlow()

    private val _loginErrorMessage = MutableStateFlow<String?>(null)
    val loginErrorMessage: StateFlow<String?> = _loginErrorMessage.asStateFlow()

    private var wallet: AgicashWallet? = null

    init {
        bootstrap()
    }

    private fun bootstrap() {
        try {
            wallet = AgicashWallet(
                opensecretUrl = Endpoints.OPENSECRET_URL,
                opensecretClientIdUuid = Endpoints.OPENSECRET_CLIENT_ID,
                supabaseUrl = Endpoints.SUPABASE_URL,
                supabaseAnonKey = Endpoints.SUPABASE_ANON_KEY,
            )
            _state.value = BootState.Ready(Phase.SignedOut)
        } catch (e: Throwable) {
            _state.value = BootState.Failed("init failed: ${e.message}")
        }
    }

    fun signInAsGuest() {
        runSignIn { it.authGuest() }
    }

    fun signInWithEmail(email: String, password: String) {
        val trimmedEmail = email.trim()
        if (trimmedEmail.isEmpty() || password.isEmpty()) {
            _loginErrorMessage.value = "Email and password are required."
            return
        }
        runSignIn { it.authLogin(trimmedEmail, password) }
    }

    private fun runSignIn(call: suspend (AgicashWallet) -> Session) {
        val w = wallet ?: return
        _isWorking.value = true
        _loginErrorMessage.value = null
        viewModelScope.launch {
            try {
                val session = call(w)
                _state.value = BootState.Ready(Phase.SignedIn(session.userId))
                refreshAccounts()
            } catch (e: FfiException) {
                _loginErrorMessage.value = ffiErrorMessage(e)
            } catch (e: Throwable) {
                _loginErrorMessage.value = "unexpected: ${e.message}"
            } finally {
                _isWorking.value = false
            }
        }
    }

    fun signOut() {
        val w = wallet ?: return
        _isWorking.value = true
        viewModelScope.launch {
            try {
                w.authLogout()
            } catch (_: Throwable) {
                // Best-effort; clear local state regardless.
            }
            _accounts.value = emptyList()
            _loginErrorMessage.value = null
            _state.value = BootState.Ready(Phase.SignedOut)
            _isWorking.value = false
        }
    }

    fun refreshAccounts() {
        val w = wallet ?: return
        viewModelScope.launch {
            try {
                _accounts.value = w.listAccounts()
            } catch (e: FfiException) {
                _state.value = BootState.Ready(Phase.Error("list accounts failed: ${ffiErrorMessage(e)}"))
            } catch (e: Throwable) {
                _state.value = BootState.Ready(Phase.Error("unexpected: ${e.message}"))
            }
        }
    }

    private fun ffiErrorMessage(e: FfiException): String = when (e) {
        is FfiException.Auth -> "auth/${e.code}: ${e.message}"
        is FfiException.Storage -> "storage/${e.code}: ${e.message}"
        is FfiException.Internal -> e.message
    }
}

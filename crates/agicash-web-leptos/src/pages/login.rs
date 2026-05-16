//! `/login` — the public login page.
//!
//! Mirrors the iOS `LoginView` 1:1 (see
//! `ios/Agicash/Agicash/LoginView.swift`): centered card with the title
//! "Login", three buttons (Email / Google / Continue as guest), and a
//! "Don't have an account? Sign up" link. Email + Google are stubbed for
//! Phase 1 partial; only guest auth round-trips through `/api/auth/guest`.

use leptos::prelude::*;

use crate::components::LoginView;

#[component]
pub fn LoginPage() -> impl IntoView {
    view! {
        <LoginView/>
    }
}

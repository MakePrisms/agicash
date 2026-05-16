//! axum SSR server for the Agicash Leptos PWA.
//!
//! Started by `cargo leptos serve`. Mounts:
//!   - `/`              → Leptos SSR (router decides which page renders)
//!   - `/api/auth/*`    → server-side auth proxy (see `auth/mod.rs`)
//!   - `/pkg/*`         → cargo-leptos's built JS + WASM bundle
//!   - `/manifest.json` → PWA manifest (static, from `public/`)
//!   - `/service-worker.js` → PWA service worker (static, from `public/`)
//!   - all other static files in `public/` (icons, favicon, og-images)

#[cfg(feature = "ssr")]
#[tokio::main]
async fn main() {
    use agicash_web_leptos::{auth::AuthState, shell, App};
    use axum::Router;
    use leptos::prelude::*;
    use leptos_axum::{generate_route_list, LeptosRoutes};
    use tower_http::services::ServeDir;

    // Standard cargo-leptos boot. Reads [package.metadata.leptos] from
    // the running binary's environment (cargo-leptos injects them).
    let conf = get_configuration(None).expect("read leptos config");
    let leptos_options = conf.leptos_options;
    let addr = leptos_options.site_addr;
    let routes = generate_route_list(App);

    // Auth state ties the OpenSecret enclave to the axum handlers.
    // Construction is fallible (env-var lookup); if it fails we print a
    // clear hint and exit so the operator knows what to set.
    let auth = AuthState::from_env().unwrap_or_else(|msg| {
        eprintln!("[agicash-web-leptos] {msg}");
        eprintln!("  Set OPENSECRET_BASE_URL and OPENSECRET_CLIENT_ID, then restart.");
        std::process::exit(1);
    });

    // `site_root` is `Arc<str>`. Clone once for the ServeDir.
    let site_root: String = leptos_options.site_root.to_string();

    // Build the Leptos route layer first (it lives on `S = LeptosOptions`),
    // then merge the auth router (already state-erased to `Router<()>` by
    // its own `.with_state` call). The final `.with_state(leptos_options)`
    // collapses the Leptos branch's state too, so the two halves can sit
    // side by side under `axum::serve`.
    let leptos_layer: Router<LeptosOptions> =
        Router::new().leptos_routes(&leptos_options, routes, {
            let opts = leptos_options.clone();
            move || shell(opts.clone())
        });

    let app: Router = Router::new()
        .merge(auth.router())
        .merge(leptos_layer.with_state(leptos_options.clone()))
        // ServeDir at the workspace site root catches /pkg/*, /manifest.json,
        // /icon-*.png, /favicon.ico, /service-worker.js, etc. cargo-leptos
        // copies everything from `public/` into the site root automatically
        // and emits the bundled wasm + JS into `site_root/pkg/`.
        .fallback_service(ServeDir::new(site_root));

    println!("[agicash-web-leptos] listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind site addr");
    axum::serve(listener, app).await.expect("serve");
}

// Hydrate-only / library-only build: `main` is unused (cargo-leptos
// compiles the bin under `bin-features = ["ssr"]`). Keep a stub so
// `cargo check --target wasm32-unknown-unknown` doesn't trip over the
// missing `main`.
#[cfg(not(feature = "ssr"))]
fn main() {}

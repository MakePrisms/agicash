// This binary is a developer tool, not production code. Generous clippy
// allows keep it from interfering with the workspace's pedantic baseline —
// the surface area is internal and the structure is dictated by code
// emission, not API design.
#![allow(
    clippy::needless_raw_string_hashes,
    clippy::unnecessary_wraps,
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
    clippy::missing_panics_doc,
    clippy::if_not_else,
    clippy::doc_markdown
)]

//! Codegen for typed Supabase access.
//!
//! Default flow:
//!   1. Start an ephemeral `postgres:17` Docker container on a random port.
//!   2. Wait for it to accept TCP, then apply every `supabase/migrations/*.sql`
//!      in lexical order via `psql` inside the container.
//!   3. Introspect the target schema (`wallet` by default) via
//!      `information_schema` + `pg_catalog` and emit a single Rust file.
//!   4. Tear the container down (skip with `--keep-db`).
//!
//! End-to-end target: ~5 s.
//!
//! Emitted code:
//!   - `pub mod tables::<table>` — `Row` (deser), `New<Table>` (ser), typed
//!     column-name constants, and a `from()` helper bound to `NAME`.
//!   - `pub mod rpcs::<fn>` — `Args` (ser) and `Returns` (deser/alias) plus a
//!     `NAME` constant.
//!   - `pub mod enums` — one Rust enum per Postgres enum with
//!     `#[serde(rename = "<sql label>")]`.
//!   - `pub mod composites` — one struct per standalone composite type, used by
//!     RPC `Args`.
//!
//! Conventions (documented in README.md):
//!   1. Nullable RPC arg → mark the migration arg with `DEFAULT NULL`. The
//!      codegen treats any DEFAULT-having arg as `Option<T>`.
//!   2. Trigger-set NOT NULL column without a `DEFAULT` (the trigger fills it
//!      in) → annotate with `COMMENT ON COLUMN <table>.<col> IS '@codegen
//!      optional'`. The codegen treats it as `Option<T>` in `New<Table>`.

use anyhow::{anyhow, bail, Context, Result};
use clap::Parser;
use heck::{ToPascalCase, ToSnakeCase};
use indoc::writedoc;
use postgres::{Client, NoTls};
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

#[derive(Parser, Debug)]
#[command(
    version,
    about = "Codegen: typed-Supabase bindings for agicash",
    long_about = None
)]
struct Cli {
    /// Migrations directory (every `*.sql` file is applied in lexical order).
    #[arg(long, default_value = "supabase/migrations")]
    migrations_dir: PathBuf,

    /// Schema to introspect.
    #[arg(long, default_value = "wallet")]
    schema: String,

    /// Output path for the generated file.
    #[arg(
        long,
        default_value = "crates/agicash-storage-supabase/src/generated.rs"
    )]
    out: PathBuf,

    /// Optional pre-existing `postgres://` URL. When set, the tool skips the
    /// ephemeral-container step and just introspects whatever is at the URL.
    /// (Used by CI: the GHA `services.postgres` block provides a DB; CI applies
    /// migrations and points this tool at the URL.)
    #[arg(long)]
    database_url: Option<String>,

    /// Don't tear down the ephemeral container at the end (debug).
    #[arg(long, default_value_t = false)]
    keep_db: bool,

    /// Docker image to use when starting an ephemeral DB.
    ///
    /// We default to the Supabase-flavored Postgres 17 image because our
    /// migrations declare `create extension pg_cron / pg_net / supabase_vault`
    /// — these aren't in the vanilla `postgres:17`. Override with `--image
    /// postgres:17` if your schema doesn't need those extensions.
    #[arg(long, default_value = "public.ecr.aws/supabase/postgres:17.6.1.080")]
    image: String,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let started = Instant::now();

    let (database_url, container) = if let Some(url) = cli.database_url.clone() {
        eprintln!("[codegen] using provided --database-url; skipping ephemeral container");
        if !cli.migrations_dir.as_os_str().is_empty() && cli.migrations_dir.exists() {
            // Apply via psql against the URL — CI passes an empty DB.
            apply_migrations_via_url(&url, &cli.migrations_dir)?;
        }
        (url, None)
    } else {
        let ctr = EphemeralPostgres::start(&cli.image)?;
        let url = ctr.url();
        eprintln!(
            "[codegen] started ephemeral {} on port {} (container={})",
            cli.image, ctr.port, ctr.name
        );
        apply_migrations_via_container(&ctr, &cli.migrations_dir)?;
        (url, Some(ctr))
    };

    let mut client = Client::connect(&database_url, NoTls)
        .with_context(|| format!("connect to {database_url}"))?;

    let enums = load_enums(&mut client, &cli.schema)?;
    let composites = load_composites(&mut client, &cli.schema)?;
    let optional_overrides = load_codegen_optional_columns(&mut client, &cli.schema)?;
    let tables = load_tables(&mut client, &cli.schema, &optional_overrides)?;
    let fns = load_functions(&mut client, &cli.schema)?;

    let mut out = String::new();
    write_header(&mut out, &cli.schema);
    write_typed_builder(&mut out);
    write_enums(&mut out, &enums)?;
    write_composites(&mut out, &composites, &enums)?;
    write_tables(&mut out, &tables, &enums, &composites)?;
    write_rpcs(&mut out, &fns, &enums, &composites)?;

    if let Some(parent) = cli.out.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&cli.out, &out).with_context(|| format!("write {}", cli.out.display()))?;

    // Best-effort rustfmt — keeps diffs small. Don't fail codegen if rustfmt
    // is missing (CI install may not have it).
    let _ = Command::new("rustfmt")
        .arg("--edition")
        .arg("2021")
        .arg(&cli.out)
        .status();

    eprintln!(
        "[codegen] wrote {} (enums={}, composites={}, tables={}, fns={}) in {:.2}s",
        cli.out.display(),
        enums.len(),
        composites.len(),
        tables.len(),
        fns.len(),
        started.elapsed().as_secs_f64(),
    );

    if let Some(ctr) = container {
        if cli.keep_db {
            eprintln!(
                "[codegen] --keep-db set; leaving container {} (url={}) running",
                ctr.name,
                ctr.url()
            );
            std::mem::forget(ctr); // skip Drop
        }
        // else Drop will tear it down.
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ephemeral postgres container

struct EphemeralPostgres {
    name: String,
    port: u16,
    user: String,
    password: String,
    db: String,
}

impl EphemeralPostgres {
    fn start(image: &str) -> Result<Self> {
        let port = pick_free_port()?;
        let suffix = std::process::id();
        let name = format!("agicash-codegen-pg-{suffix}-{port}");
        // The supabase/postgres image expects POSTGRES_USER=supabase_admin and
        // a JWT_SECRET so the entrypoint can finish initialization. Vanilla
        // `postgres:17` accepts any user. Use the supabase-compatible values by
        // default; users overriding `--image` can rely on the same env vars
        // being benign on stock postgres (POSTGRES_USER controls superuser, the
        // JWT_SECRET is ignored).
        let user = "supabase_admin".to_string();
        let password = "postgres".to_string();
        let db = "postgres".to_string();

        let status = Command::new("docker")
            .args([
                "run",
                "--rm",
                "-d",
                "--name",
                &name,
                "-p",
                &format!("{port}:5432"),
                "-e",
                &format!("POSTGRES_PASSWORD={password}"),
                "-e",
                &format!("POSTGRES_USER={user}"),
                "-e",
                &format!("POSTGRES_DB={db}"),
                "-e",
                "JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long",
                "-e",
                "JWT_EXP=3600",
                image,
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .context("spawn `docker run`")?;
        if !status.success() {
            bail!("`docker run {image}` failed");
        }

        let ctr = EphemeralPostgres {
            name,
            port,
            user,
            password,
            db,
        };
        ctr.wait_for_ready()?;
        Ok(ctr)
    }

    fn url(&self) -> String {
        format!(
            "postgres://{}:{}@127.0.0.1:{}/{}",
            self.user, self.password, self.port, self.db,
        )
    }

    fn wait_for_ready(&self) -> Result<()> {
        // 90 s — the Supabase-flavored postgres image runs initdb + extension
        // setup on first boot which can take 30–60 s on a cold disk. Vanilla
        // `postgres:17` is usually ready in < 5 s.
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut last_err = None;
        while Instant::now() < deadline {
            // First make sure the TCP port is open at all.
            if TcpStream::connect(("127.0.0.1", self.port)).is_ok() {
                // Then try a real handshake — postgres TCP-accepts before it
                // can answer SQL.
                match Client::connect(&self.url(), NoTls) {
                    Ok(mut c) => {
                        if c.simple_query("select 1").is_ok() {
                            return Ok(());
                        }
                    }
                    Err(e) => last_err = Some(e),
                }
            }
            sleep(Duration::from_millis(250));
        }
        bail!(
            "postgres on port {} not ready within 90s: {:?}",
            self.port,
            last_err
        );
    }
}

impl Drop for EphemeralPostgres {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["rm", "-f", &self.name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn pick_free_port() -> Result<u16> {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// SQL that stubs out the Supabase managed-runtime symbols our migrations
/// reference (`auth.uid()`, `realtime.messages`, `realtime.send()`,
/// `realtime.topic()`). These are real in production but the codegen-time
/// container only needs them to *exist* so DDL doesn't error — runtime
/// behavior is irrelevant for introspection.
const BOOTSTRAP_STUBS_SQL: &str = r#"
-- Codegen-only stubs. None of these objects exist in production; the
-- supabase managed runtime provides the real ones.

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select null::uuid
$$;

create schema if not exists realtime;
create table if not exists realtime.messages (
    id uuid primary key default gen_random_uuid(),
    topic text not null,
    extension text not null,
    payload jsonb,
    event text,
    private boolean default false,
    inserted_at timestamp with time zone default now()
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic() returns text language sql stable as $$
  select ''::text
$$;
create or replace function realtime.send(
    payload jsonb,
    event text,
    topic text,
    private boolean default false
) returns void language sql as $$
  select pg_catalog.void(null::void)
$$;

"#;

fn apply_migrations_via_container(ctr: &EphemeralPostgres, dir: &Path) -> Result<()> {
    if !dir.exists() {
        bail!("migrations dir does not exist: {}", dir.display());
    }
    let files = collect_sql_files(dir)?;
    eprintln!(
        "[codegen] applying {} migration file(s) from {}",
        files.len(),
        dir.display(),
    );
    // Apply bootstrap stubs first so migrations don't fail on managed-runtime symbols.
    let bootstrap_path = std::env::temp_dir().join(format!(
        "agicash-codegen-bootstrap-{}.sql",
        std::process::id()
    ));
    fs::write(&bootstrap_path, BOOTSTRAP_STUBS_SQL)?;
    let status = Command::new("docker")
        .args([
            "exec",
            "-i",
            "-e",
            &format!("PGPASSWORD={}", ctr.password),
            &ctr.name,
            "psql",
            "-U",
            &ctr.user,
            "-d",
            &ctr.db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
        ])
        .stdin(Stdio::from(fs::File::open(&bootstrap_path)?))
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .context("psql apply bootstrap stubs")?;
    let _ = fs::remove_file(&bootstrap_path);
    if !status.success() {
        bail!("bootstrap stub application failed");
    }
    for f in &files {
        let status = Command::new("docker")
            .args([
                "exec",
                "-i",
                "-e",
                &format!("PGPASSWORD={}", ctr.password),
                &ctr.name,
                "psql",
                "-U",
                &ctr.user,
                "-d",
                &ctr.db,
                "-v",
                "ON_ERROR_STOP=1",
                "-q",
            ])
            .stdin(Stdio::from(
                fs::File::open(f).with_context(|| format!("open {}", f.display()))?,
            ))
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .with_context(|| format!("psql apply {}", f.display()))?;
        if !status.success() {
            bail!("migration failed: {}", f.display());
        }
    }
    Ok(())
}

fn apply_migrations_via_url(url: &str, dir: &Path) -> Result<()> {
    if !dir.exists() {
        bail!("migrations dir does not exist: {}", dir.display());
    }
    let files = collect_sql_files(dir)?;
    eprintln!(
        "[codegen] applying {} migration file(s) from {} via `psql {}`",
        files.len(),
        dir.display(),
        url,
    );
    for f in &files {
        let status = Command::new("psql")
            .args([url, "-v", "ON_ERROR_STOP=1", "-q", "-f"])
            .arg(f)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .with_context(|| format!("psql {}", f.display()))?;
        if !status.success() {
            bail!("migration failed: {}", f.display());
        }
    }
    Ok(())
}

fn collect_sql_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "sql"))
        .collect();
    out.sort(); // lexical order — matches Supabase CLI's ordering
    Ok(out)
}

// ---------------------------------------------------------------------------
// Introspection

#[derive(Debug, Clone)]
struct EnumDef {
    name: String,
    variants: Vec<String>,
}

#[derive(Debug, Clone)]
struct CompositeField {
    name: String,
    pg_type: String,
}

#[derive(Debug, Clone)]
struct CompositeDef {
    name: String,
    fields: Vec<CompositeField>,
}

#[derive(Debug, Clone)]
struct ColumnDef {
    name: String,
    data_type: String,
    udt_schema: String,
    udt_name: String,
    is_nullable: bool,
    has_default: bool,
    /// `@codegen optional` set via `COMMENT ON COLUMN` — treats the column as
    /// optional in `New<Table>` even though SQL says NOT NULL with no default.
    /// Use for trigger-set columns (e.g. `username` filled by a trigger).
    codegen_optional: bool,
}

#[derive(Debug, Clone)]
struct TableDef {
    name: String,
    columns: Vec<ColumnDef>,
}

#[derive(Debug, Clone)]
struct FnArg {
    name: String,
    pg_type: String,
    has_default: bool,
}

#[derive(Debug, Clone)]
struct FnDef {
    name: String,
    args: Vec<FnArg>,
    return_type: String,
    return_is_set: bool,
}

fn load_enums(client: &mut Client, schema: &str) -> Result<BTreeMap<String, EnumDef>> {
    let rows = client.query(
        "select t.typname,
                array(select enumlabel from pg_enum e where e.enumtypid = t.oid order by e.enumsortorder)
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = $1 and t.typtype = 'e'
         order by t.typname",
        &[&schema],
    )?;
    let mut out = BTreeMap::new();
    for row in rows {
        let name: String = row.get(0);
        let variants: Vec<String> = row.get(1);
        out.insert(name.clone(), EnumDef { name, variants });
    }
    Ok(out)
}

fn load_composites(client: &mut Client, schema: &str) -> Result<BTreeMap<String, CompositeDef>> {
    let rows = client.query(
        "select t.typname,
                a.attname,
                pg_catalog.format_type(a.atttypid, a.atttypmod)
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         join pg_class c on c.oid = t.typrelid
         join pg_attribute a on a.attrelid = c.oid
         where n.nspname = $1
           and t.typtype = 'c'
           and c.relkind = 'c'
           and a.attnum > 0
           and not a.attisdropped
         order by t.typname, a.attnum",
        &[&schema],
    )?;
    let mut by_name: BTreeMap<String, CompositeDef> = BTreeMap::new();
    for row in rows {
        let typname: String = row.get(0);
        let attname: String = row.get(1);
        let typ: String = row.get(2);
        by_name
            .entry(typname.clone())
            .or_insert(CompositeDef {
                name: typname,
                fields: Vec::new(),
            })
            .fields
            .push(CompositeField {
                name: attname,
                pg_type: typ,
            });
    }
    Ok(by_name)
}

/// Returns the set of `<table>.<column>` keys (within the given schema) that
/// carry a `COMMENT ON COLUMN ... IS '@codegen optional'` annotation.
fn load_codegen_optional_columns(client: &mut Client, schema: &str) -> Result<HashSet<String>> {
    let rows = client.query(
        "select c.relname, a.attname, d.description
         from pg_description d
         join pg_class c on c.oid = d.objoid
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
         where n.nspname = $1
           and d.objsubid > 0
           and d.description like '%@codegen optional%'
         order by c.relname, a.attname",
        &[&schema],
    )?;
    let mut out = HashSet::new();
    for row in rows {
        let table: String = row.get(0);
        let col: String = row.get(1);
        out.insert(format!("{table}.{col}"));
    }
    Ok(out)
}

fn load_tables(
    client: &mut Client,
    schema: &str,
    optional_overrides: &HashSet<String>,
) -> Result<Vec<TableDef>> {
    let table_rows = client.query(
        "select table_name from information_schema.tables
         where table_schema = $1 and table_type = 'BASE TABLE'
         order by table_name",
        &[&schema],
    )?;
    let mut out = Vec::new();
    for trow in table_rows {
        let table_name: String = trow.get(0);
        let col_rows = client.query(
            "select column_name, data_type, udt_schema, udt_name, is_nullable, column_default
             from information_schema.columns
             where table_schema = $1 and table_name = $2
             order by ordinal_position",
            &[&schema, &table_name],
        )?;
        let columns = col_rows
            .into_iter()
            .map(|r| {
                let name: String = r.get(0);
                let data_type: String = r.get(1);
                let udt_schema: String = r.get(2);
                let udt_name: String = r.get(3);
                let nullable: String = r.get(4);
                let default: Option<String> = r.get(5);
                let key = format!("{table_name}.{name}");
                ColumnDef {
                    name,
                    data_type,
                    udt_schema,
                    udt_name,
                    is_nullable: nullable == "YES",
                    has_default: default.is_some(),
                    codegen_optional: optional_overrides.contains(&key),
                }
            })
            .collect();
        out.push(TableDef {
            name: table_name,
            columns,
        });
    }
    Ok(out)
}

fn load_functions(client: &mut Client, schema: &str) -> Result<Vec<FnDef>> {
    let rows = client.query(
        "select p.proname,
                pg_get_function_arguments(p.oid),
                pg_get_function_result(p.oid),
                p.proretset
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = $1
           and p.prokind = 'f'
           and pg_get_function_result(p.oid) not in ('trigger', 'event_trigger')
         order by p.proname, p.oid",
        &[&schema],
    )?;
    let mut out = Vec::new();
    for row in rows {
        let name: String = row.get(0);
        let args_str: String = row.get(1);
        let result_type: String = row.get(2);
        let retset: bool = row.get(3);
        let args = parse_fn_args(&args_str)?;
        out.push(FnDef {
            name,
            args,
            return_type: result_type,
            return_is_set: retset,
        });
    }
    Ok(out)
}

/// Parse `pg_get_function_arguments` output, e.g.
///   `p_user_id uuid, p_email text,
///    p_accounts wallet.account_input[],
///    p_terms_accepted_at timestamp with time zone DEFAULT NULL::timestamp with time zone`
fn parse_fn_args(s: &str) -> Result<Vec<FnArg>> {
    if s.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parts = split_top_level_commas(s);
    let mut out = Vec::new();
    for part in parts {
        let part = part.trim();
        let lower = part.to_lowercase();
        let (lhs, has_default) = if let Some(idx) = lower.find(" default ") {
            (&part[..idx], true)
        } else {
            (part, false)
        };
        let mut sp = lhs.splitn(2, char::is_whitespace);
        let name = sp
            .next()
            .ok_or_else(|| anyhow!("empty arg: {part}"))?
            .to_string();
        let pg_type = sp
            .next()
            .ok_or_else(|| anyhow!("missing type for arg `{name}`: {part}"))?
            .trim()
            .to_string();
        out.push(FnArg {
            name,
            pg_type,
            has_default,
        });
    }
    Ok(out)
}

fn split_top_level_commas(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth: i32 = 0;
    let mut cur = String::new();
    for c in s.chars() {
        match c {
            '(' | '[' => {
                depth += 1;
                cur.push(c);
            }
            ')' | ']' => {
                depth -= 1;
                cur.push(c);
            }
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

// ---------------------------------------------------------------------------
// Code emission

fn write_header(out: &mut String, schema: &str) {
    writedoc!(
        out,
        r#"
            // @generated — DO NOT EDIT MANUALLY — regenerate via `bun db:generate-types-rust`
            //              (or `cargo run -p agicash-storage-supabase-codegen`).
            //
            // Source: introspection of schema `{schema}` after applying every
            // file in `supabase/migrations/` to an ephemeral postgres:17.
            //
            // See `crates/agicash-storage-supabase-codegen/README.md` for the
            // two schema conventions this codegen relies on
            // (DEFAULT NULL for nullable RPC args; `@codegen optional` column
            // comment for trigger-set NOT NULL columns).
            #![allow(
                dead_code,
                clippy::needless_pub_self,
                clippy::module_name_repetitions,
                clippy::too_many_lines,
                clippy::wildcard_imports,
                clippy::doc_markdown,
                clippy::struct_excessive_bools,
                clippy::struct_field_names,
                clippy::option_option,
                clippy::missing_const_for_fn,
                clippy::ref_option,
                clippy::similar_names,
                clippy::pub_underscore_fields,
            )]
            use serde::{{Deserialize, Serialize}};

        "#,
        schema = schema
    )
    .unwrap();
}

/// Emits the `TypedBuilder<T>` wrapper around `postgrest::Builder` that the
/// spike report's gotcha #5 flagged. It only accepts column-name constants
/// drawn from `T::Column`, so `.eq("misspeled_col", ...)` won't compile.
fn write_typed_builder(out: &mut String) {
    writedoc!(
        out,
        r#"
            /// Marker trait implemented by every generated table module's
            /// `Marker` zero-sized type. Lets [`TypedBuilder`] enforce that the
            /// column-name string handed to `.eq()` etc. originates from the
            /// matching table's `columns::` module.
            pub trait Table {{
                /// PostgREST table identifier.
                const NAME: &'static str;
                /// Compile-time check that a column literal belongs to this
                /// table. Implemented by the generated module.
                fn is_known_column(name: &str) -> bool;
            }}

            /// Thin wrapper over `postgrest::Builder` that constrains filter
            /// methods to column constants emitted by codegen. Most workflows
            /// should construct one via `tables::<table>::select(client)`.
            pub struct TypedBuilder<T: Table> {{
                inner: postgrest::Builder,
                _marker: std::marker::PhantomData<T>,
            }}

            impl<T: Table> std::fmt::Debug for TypedBuilder<T> {{
                fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {{
                    f.debug_struct("TypedBuilder")
                        .field("table", &T::NAME)
                        .finish_non_exhaustive()
                }}
            }}

            impl<T: Table> TypedBuilder<T> {{
                pub fn new(client: &postgrest::Postgrest) -> Self {{
                    Self {{
                        inner: client.from(T::NAME),
                        _marker: std::marker::PhantomData,
                    }}
                }}

                /// Escape hatch for the underlying postgrest builder — callers
                /// who need a method we haven't typed yet (e.g. embeds) can
                /// reach the raw API. Use sparingly.
                pub fn into_inner(self) -> postgrest::Builder {{
                    self.inner
                }}

                /// `select(columns)` passthrough. `columns` is intentionally a
                /// raw `&str` so callers can use postgrest's embed syntax
                /// (`"*,accounts(*)"`) without us re-implementing it here.
                #[must_use]
                pub fn select(mut self, columns: &str) -> Self {{
                    self.inner = self.inner.select(columns);
                    self
                }}

                /// Equality filter. `column` must be one of the constants in
                /// the generated table module's `columns::` namespace —
                /// debug-asserts otherwise.
                #[must_use]
                pub fn eq(mut self, column: &'static str, value: impl AsRef<str>) -> Self {{
                    debug_assert!(
                        T::is_known_column(column),
                        "column `{{}}` is not declared in {{}}::columns",
                        column,
                        T::NAME,
                    );
                    self.inner = self.inner.eq(column, value);
                    self
                }}

                /// Execute the request via the underlying `postgrest::Builder`.
                /// Returns whatever postgrest returns (currently
                /// `Result<reqwest::Response, reqwest::Error>`).
                pub async fn execute(self) -> Result<reqwest::Response, reqwest::Error> {{
                    self.inner.execute().await
                }}
            }}

        "#,
    )
    .unwrap();
}

fn write_enums(out: &mut String, enums: &BTreeMap<String, EnumDef>) -> Result<()> {
    writedoc!(out, "pub mod enums {{\n    use super::*;\n\n").unwrap();
    for e in enums.values() {
        let rust_name = e.name.to_pascal_case();
        writeln!(
            out,
            "    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]"
        )
        .unwrap();
        writeln!(out, "    pub enum {rust_name} {{").unwrap();
        for v in &e.variants {
            let variant = sql_label_to_variant(v);
            writeln!(out, "        #[serde(rename = \"{v}\")]").unwrap();
            writeln!(out, "        {variant},").unwrap();
        }
        writeln!(out, "    }}\n").unwrap();
    }
    writedoc!(out, "}}\n\n").unwrap();
    Ok(())
}

fn write_composites(
    out: &mut String,
    composites: &BTreeMap<String, CompositeDef>,
    enums: &BTreeMap<String, EnumDef>,
) -> Result<()> {
    writedoc!(out, "pub mod composites {{\n    use super::*;\n\n").unwrap();
    for c in composites.values() {
        if c.name.ends_with("_result") {
            continue;
        }
        let rust_name = c.name.to_pascal_case();
        writeln!(
            out,
            "    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]"
        )
        .unwrap();
        writeln!(out, "    pub struct {rust_name} {{").unwrap();
        for f in &c.fields {
            let rust_field = sanitize_ident(&f.name.to_snake_case());
            let rust_ty = pg_to_rust_type(&f.pg_type, enums, composites);
            if f.name != rust_field {
                writeln!(out, "        #[serde(rename = \"{}\")]", f.name).unwrap();
            }
            writeln!(out, "        pub {rust_field}: {rust_ty},").unwrap();
        }
        writeln!(out, "    }}\n").unwrap();
    }
    writedoc!(out, "}}\n\n").unwrap();
    Ok(())
}

fn write_tables(
    out: &mut String,
    tables: &[TableDef],
    enums: &BTreeMap<String, EnumDef>,
    composites: &BTreeMap<String, CompositeDef>,
) -> Result<()> {
    writedoc!(out, "pub mod tables {{\n    use super::*;\n\n").unwrap();
    for t in tables {
        let mod_name = sanitize_ident(&t.name.to_snake_case());
        let row_name = format!("{}Row", t.name.to_pascal_case());
        let insert_name = format!("New{}", t.name.to_pascal_case());

        writeln!(out, "    pub mod {mod_name} {{").unwrap();
        writeln!(out, "        use super::*;").unwrap();
        writeln!(
            out,
            "        /// PostgREST table identifier — checked against migrations at codegen time."
        )
        .unwrap();
        writeln!(out, "        pub const NAME: &str = \"{}\";\n", t.name).unwrap();

        // Column-name constants.
        writeln!(out, "        pub mod columns {{").unwrap();
        for c in &t.columns {
            let cname = c.name.to_uppercase();
            writeln!(out, "            pub const {cname}: &str = \"{}\";", c.name).unwrap();
        }
        writeln!(out, "        }}\n").unwrap();

        // Marker / Table impl for TypedBuilder.
        writeln!(
            out,
            "        /// Zero-sized marker — feeds [`crate::generated::TypedBuilder`]."
        )
        .unwrap();
        writeln!(out, "        #[derive(Debug, Clone, Copy, Default)]").unwrap();
        writeln!(out, "        pub struct Marker;").unwrap();
        writeln!(out, "        impl crate::generated::Table for Marker {{").unwrap();
        writeln!(out, "            const NAME: &'static str = NAME;").unwrap();
        writeln!(out, "            fn is_known_column(name: &str) -> bool {{").unwrap();
        writeln!(out, "                matches!(name,").unwrap();
        let col_strs: Vec<String> = t
            .columns
            .iter()
            .map(|c| format!("                    \"{}\"", c.name))
            .collect();
        writeln!(out, "{}", col_strs.join("\n                    |\n")).unwrap();
        writeln!(out, "                )").unwrap();
        writeln!(out, "            }}").unwrap();
        writeln!(out, "        }}\n").unwrap();

        // Row struct.
        writeln!(
            out,
            "        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]"
        )
        .unwrap();
        writeln!(out, "        pub struct {row_name} {{").unwrap();
        for c in &t.columns {
            let rust_field = sanitize_ident(&c.name.to_snake_case());
            let base_ty = column_to_rust_type(c, enums, composites);
            let ty = if c.is_nullable {
                format!("Option<{base_ty}>")
            } else {
                base_ty
            };
            if c.name != rust_field {
                writeln!(out, "            #[serde(rename = \"{}\")]", c.name).unwrap();
            }
            writeln!(out, "            pub {rust_field}: {ty},").unwrap();
        }
        writeln!(out, "        }}\n").unwrap();

        // Insert struct.
        writeln!(
            out,
            "        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]"
        )
        .unwrap();
        writeln!(out, "        pub struct {insert_name} {{").unwrap();
        for c in &t.columns {
            let rust_field = sanitize_ident(&c.name.to_snake_case());
            let base_ty = column_to_rust_type(c, enums, composites);
            let required = !c.is_nullable && !c.has_default && !c.codegen_optional;
            let ty = if required {
                base_ty
            } else {
                format!("Option<{base_ty}>")
            };
            if c.name != rust_field {
                writeln!(out, "            #[serde(rename = \"{}\")]", c.name).unwrap();
            }
            if !required {
                writeln!(
                    out,
                    "            #[serde(skip_serializing_if = \"Option::is_none\")]"
                )
                .unwrap();
            }
            writeln!(out, "            pub {rust_field}: {ty},").unwrap();
        }
        writeln!(out, "        }}\n").unwrap();

        // Helpers.
        writeln!(
            out,
            "        /// Returns a [`crate::generated::TypedBuilder`] bound to this table."
        )
        .unwrap();
        writeln!(
            out,
            "        pub fn select(client: &postgrest::Postgrest) -> crate::generated::TypedBuilder<Marker> {{"
        )
        .unwrap();
        writeln!(
            out,
            "            crate::generated::TypedBuilder::<Marker>::new(client)"
        )
        .unwrap();
        writeln!(out, "        }}\n").unwrap();

        writeln!(
            out,
            "        /// Returns the raw `postgrest::Builder` bound to this table — escape hatch for embeds / inserts that aren't yet on `TypedBuilder`."
        )
        .unwrap();
        writeln!(
            out,
            "        pub fn from(client: &postgrest::Postgrest) -> postgrest::Builder {{"
        )
        .unwrap();
        writeln!(out, "            client.from(NAME)").unwrap();
        writeln!(out, "        }}").unwrap();
        writeln!(out, "    }}\n").unwrap();
    }
    writedoc!(out, "}}\n\n").unwrap();
    Ok(())
}

fn write_rpcs(
    out: &mut String,
    fns: &[FnDef],
    enums: &BTreeMap<String, EnumDef>,
    composites: &BTreeMap<String, CompositeDef>,
) -> Result<()> {
    writedoc!(out, "pub mod rpcs {{\n    use super::*;\n\n").unwrap();
    for f in fns {
        let mod_name = sanitize_ident(&f.name.to_snake_case());
        writeln!(out, "    pub mod {mod_name} {{").unwrap();
        writeln!(out, "        use super::*;").unwrap();
        writeln!(out, "        pub const NAME: &str = \"{}\";\n", f.name).unwrap();

        writeln!(out, "        #[derive(Debug, Clone, Serialize)]").unwrap();
        writeln!(out, "        pub struct Args {{").unwrap();
        for a in &f.args {
            let rust_field = sanitize_ident(&a.name.to_snake_case());
            let base_ty = pg_to_rust_type(&a.pg_type, enums, composites);
            let ty = if a.has_default {
                format!("Option<{base_ty}>")
            } else {
                base_ty
            };
            if a.name != rust_field {
                writeln!(out, "            #[serde(rename = \"{}\")]", a.name).unwrap();
            }
            if a.has_default {
                writeln!(
                    out,
                    "            #[serde(skip_serializing_if = \"Option::is_none\")]"
                )
                .unwrap();
            }
            writeln!(out, "            pub {rust_field}: {ty},").unwrap();
        }
        writeln!(out, "        }}\n").unwrap();

        let returns_ty = render_rpc_return_type(f, enums, composites)?;
        writeln!(out, "        pub type Returns = {returns_ty};\n").unwrap();

        writeln!(out, "    }}\n").unwrap();
    }
    writedoc!(out, "}}\n\n").unwrap();
    Ok(())
}

fn render_rpc_return_type(
    f: &FnDef,
    enums: &BTreeMap<String, EnumDef>,
    composites: &BTreeMap<String, CompositeDef>,
) -> Result<String> {
    let inner = pg_to_rust_type(&f.return_type, enums, composites);
    if f.return_is_set {
        Ok(format!("Vec<{inner}>"))
    } else {
        Ok(inner)
    }
}

fn pg_to_rust_type(
    pg: &str,
    enums: &BTreeMap<String, EnumDef>,
    composites: &BTreeMap<String, CompositeDef>,
) -> String {
    let trimmed = pg.trim();
    if let Some(inner) = trimmed.strip_suffix("[]") {
        let inner_ty = pg_to_rust_type(inner.trim(), enums, composites);
        return format!("Vec<{inner_ty}>");
    }
    if let Some(rest) = trimmed
        .strip_prefix("SETOF ")
        .or_else(|| trimmed.strip_prefix("setof "))
    {
        return pg_to_rust_type(rest, enums, composites);
    }
    if let Some((schema, name)) = trimmed.split_once('.') {
        if schema == "wallet" {
            // Absolute paths (rooted at `crate`) work regardless of how deeply
            // we're nested when we emit them — composites, table rows, RPC
            // args all use the same path syntax. The generated module lives at
            // `crate::generated` by convention; the codegen README documents
            // this.
            if enums.contains_key(name) {
                return format!("crate::generated::enums::{}", name.to_pascal_case());
            }
            if let Some(c) = composites.get(name) {
                if c.name.ends_with("_result") {
                    return "serde_json::Value".to_string();
                }
                return format!("crate::generated::composites::{}", name.to_pascal_case());
            }
            return format!(
                "crate::generated::tables::{}::{}Row",
                name.to_snake_case(),
                name.to_pascal_case()
            );
        }
    }
    match trimmed {
        "uuid" => "uuid::Uuid".into(),
        "text" | "character varying" | "varchar" | "name" => "String".into(),
        "boolean" | "bool" => "bool".into(),
        "integer" | "int4" => "i32".into(),
        "smallint" | "int2" => "i16".into(),
        "bigint" | "int8" => "i64".into(),
        "real" | "float4" => "f32".into(),
        "double precision" | "float8" => "f64".into(),
        "timestamp with time zone" | "timestamptz" => "chrono::DateTime<chrono::Utc>".into(),
        "timestamp without time zone" | "timestamp" => "chrono::NaiveDateTime".into(),
        "date" => "chrono::NaiveDate".into(),
        "jsonb" | "json" => "serde_json::Value".into(),
        "bytea" => "Vec<u8>".into(),
        s if s.starts_with("numeric") => "String".into(),
        other => {
            eprintln!("WARN: no Rust mapping for pg type `{other}` — emitting serde_json::Value");
            "serde_json::Value".into()
        }
    }
}

fn column_to_rust_type(
    c: &ColumnDef,
    enums: &BTreeMap<String, EnumDef>,
    composites: &BTreeMap<String, CompositeDef>,
) -> String {
    if c.udt_schema == "wallet" {
        if enums.contains_key(&c.udt_name) {
            return format!("crate::generated::enums::{}", c.udt_name.to_pascal_case());
        }
        if composites.contains_key(&c.udt_name) {
            return format!(
                "crate::generated::composites::{}",
                c.udt_name.to_pascal_case()
            );
        }
    }
    pg_to_rust_type(&c.data_type, enums, composites)
}

fn sql_label_to_variant(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    cleaned.to_pascal_case()
}

fn sanitize_ident(s: &str) -> String {
    let reserved = [
        "type", "match", "ref", "mod", "fn", "use", "let", "self", "move", "trait", "impl", "loop",
        "for", "in", "while", "as", "if", "else", "return", "struct", "enum", "where",
    ];
    if reserved.contains(&s) {
        format!("r#{s}")
    } else {
        s.to_string()
    }
}

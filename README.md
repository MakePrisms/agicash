# Agicash

This app is using [React Router](https://reactrouter.com/home) framework mode. It is hosted on Vercel, but in development it is run on a custom [Express](https://expressjs.com/) server.

For identity/auth, key management, and encryption, the app uses the [Open Secret](https://opensecret.cloud) platform. The rest of the data is stored in a Postgres database hosted on Supabase. Any sensitive data is encrypted using keys from the Open Secret platform.

## Getting started

We use [Nix](https://nixos.org/) and [devenv](https://devenv.sh/) to set up the development environment. To start:
1. Install `Nix` (on macOS run `curl -L https://github.com/NixOS/experimental-nix-installer/releases/download/0.27.0/nix-installer.sh | sh -s -- install`)
2. Install `devenv` (on macOS run `nix-env -iA devenv -f https://github.com/NixOS/nixpkgs/tarball/nixpkgs-unstable`)
3. Install `direnv` (for automatic shell activation):
    * on macOS run `brew install direnv`
    * add the direnv hook to your shell as described [here](https://direnv.net/docs/hook.html)
4. Install the packages with `bun i`

## Development

1. Create `.env` file:

```sh
cp .env.example .env
```

If needed, update the `.env` file with alternative values. This file is ignored by git and used only for local development.

2. Start Supabase local stack:

```sh
bun run supabase start
```

3. Run the dev server:

```sh
bun run dev
```

When testing the app on an actual mobile device, you need to connect to the same Wi-Fi as the machine hosting the app 
and access it via local IP or hostname. Unlike localhost or 127.0.0.1, those are not considered a safe context by the
browser, so the browser APIs that require a safe context won't work. To solve this issue, you need to run the app on HTTPS
instead. To run the dev server on HTTPS, execute:

```sh
bun run dev --https
```

A self-signed certificate is used for HTTPS. The certificate is managed by devenv automatically. If you need to
regenerate the certificate (for example, if your local IP has changed), reload devenv by executing `direnv reload`
or run the certificate script directly by executing `generate-ssl-cert`.

**Installing the root certificate on mobile:** Mobile browsers maye require the root CA to be installed and trusted on the
device. On **iOS**:

1. AirDrop or email the `certs/rootCA.pem` file to your device and open it
2. Go to **Settings → General → VPN & Device Management** and install the downloaded profile
3. Go to **Settings → General → About → Certificate Trust Settings** and enable full trust for the root certificate

`master` is the main branch. When working on a feature, branch off `master` and, when ready, make a PR back to `master`.
Try to make feature branches short-lived and concise (avoid implementing multiple features in one PR).

### Updating the development environment

To update devenv CLI on your machine, for macOS run `nix-env --upgrade --attr devenv -f https://github.com/NixOS/nixpkgs/tarball/nixpkgs-unstable`.

To update devenv packages, run `devenv update`. When updating `bun`, make sure to update the `engines` version in
`package.json` and version specified in `.github/actions/setup-environment/action.yml`. When updating `node`, update the
`.nvmrc` file and `engines` version in `package.json`. Note that Vercel does not allow pinning to an exact node version, so
in the `package.json` file, we specify the max patch version, while in the `.nvmrc`, we specify the max version possible
for that range because that is what Vercel will be using when building, too.

## Deployment

First, build your app for production:

```sh
bun run build
```

Then run the app in production mode:

```sh
bun start
```

This starts an Express server that runs the React Router framework app. However, this is not what we are currently using in our
hosted environments. We are using Vercel instead, but this gives us the option to deploy the app to a "full server" if we ever
need to.

Currently, we have `next` and `alpha` environments and temporary preview deployments for individual features. The app is deployed to
Vercel. Every push to GitHub triggers a new Vercel deployment. Pushes to `master` branch are deploying a new next version. Pushes to
`alpha` branch are deploying a new alpha version.

The database and realtime service are hosted on the Supabase platform. Supabase [branching](https://supabase.com/docs/guides/deployment/branching)
is used to manage different environments. We have `next` and `alpha` as Supabase persisted branches/environments. Database migrations
are applied automatically by Supabase whenever a new migration is merged to the corresponding Git branch. Preview deployments (feature
branches) are pointing to the `next` Supabase environment by default. However, if the preview deployment has some database migrations,
Supabase automatically creates an on-demand branch/environment and uses Supabase-Vercel integration to set the corresponding env variables
in Vercel to override the default setting that points the preview deployment to the `next` Supabase environment. The Supabase preview
branch/environment is automatically deleted once the feature branch is merged.

To release a new `alpha` version, make a pull request from `master` to the `alpha` branch.

## Dependencies

A dependency should be added only if the benefits are clear. Avoid adding it for trivial stuff. Any dependency added
should be inspected and pinned to an exact version (`bun add <package_name>@<version> --exact`). For any dependency added
to the client side, be mindful of the bundle size. [Bundlephobia](https://bundlephobia.com/) can be used to check the
total size of the dependency (the actual impact on the app bundle size could be smaller if we are using only some 
elements and the lib supports tree shaking).

## Database

Auth data (user ID, email, etc.) is stored on the Open Secret platform. The rest of the data is stored in a Postgres database
hosted on Supabase. Sensitive data is encrypted with the key from the Open Secret platform, which is accessible only to the
logged-in user. While developing locally, the local Supabase stack is used. To start it, run `bun run supabase start` command.
To stop it, run `bun run supabase stop` command. The start command will start the database and realtime service, plus other
services useful for development, like Supabase Studio. You can use Supabase Studio to inspect the database and run queries.
Supabase is configured in the `supabase/config.toml` file.

### Database migrations

Schema changes to the Postgres database should be done using migrations. Migrations are stored in the `supabase/migrations`
folder. Always try to make the schema changes in a backward compatible way.

Database migrations can be done in two ways:
1. Using Supabase Studio. With this approach you can make db changes directly to your local database in the Studio UI
   and then run `bun supabase db diff --file <MIGRATION_NAME>` to create a migration file for the changes.
2. Using `bun supabase migration new <MIGRATION_NAME>`. This command will create a new empty migration file in the 
   `supabase/migrations` folder where you can then write the SQL commands to make the changes. To apply the migration to
   the local database run `bun supabase db push`.

To keep the db TypeScript types in sync with the database schema run `bun run db:generate-types` command. If you forget
to run this command after making changes to the database, the types will be updated by the pre-commit hook. To skip the
pre-commit hook, use `--no-verify` param with `git commit` command. This can be useful when committing temporary code, but
the CI will check if the types are up to date and, if not, will not allow merging to `master`.

To reset the local database, run `bun supabase db reset`. Note that this will delete any existing local data and run all
migrations on a clean database.

Migrations are applied to hosted envs automatically by the Supabase platform. You can track the migrations applied in the 
Supabase dashboard by going to the branches page and checking the logs for the respective branch. If the migration fails for the
feature branch you can reapply it by just resetting the branch. If it fails for the persisted or production you will need to
resolve the issue and push migrations from your machine by doing:
1. Switch to the persisted/production branch by running `git checkout <branch_name>` (e.g. `git checkout master` for next env) and make sure you have the latest version by running `git pull origin <branch_name>`.
2. Run `bun supabase login` to log in to the Supabase dashboard so the CLI can access it.
3. Run `bun supabase link` to link to the remote project. For this, you will need the database password. Ask other team members for the current db password (the password can also be reset from the dashboard if needed).
4. Run `bun supabase db push` to apply migrations to the remote database.

Steps 2 and 3 can be skipped if you have already logged in and linked the project before.


## Code style & formatting

Type checking is separated from build and is performed using TypeScript compiler. To run type check manually run
`bun run typecheck` command.

[Biome](https://biomejs.dev/) is used for code linting and formatting. Supported commands:
- `bun run lint` - runs linter and performs safe fixes
- `bun run lint:check` - runs lint check only
- `bun run format` - runs formatter and performs fixes
- `bun run format:check` - runs format check only
- `bun run fix:all` - runs type checking, linter and formatter and performs safe fixes
- `bun run fix:staged` - runs type checking, linter and formatter on git staged files only and performs safe fixes
- `bun run check:all` - runs type, lint and format checks only

Types, formatting and code styles are enforced using pre-commit hook. For a nicer development experience, it is recommended
to enable auto linting and formatting on file save in IDE. Instructions for that can be found [here](https://biomejs.dev/guides/editors/first-party-extensions/).
Pre-commit hook is configured using devenv (see the `devenv.nix` file), and it runs `bun run fix:staged` command. To skip the
pre-commit hook use `--no-verify` param with `git commit` command. This can be useful when committing temporary code but
the CI will run the checks again and won't allow any non-conforming code to be committed to `master`.

Lint & formatting configs are defined in the `biome.jsonc` file.

## Testing

The idea is to cover key lower-level reusable pieces with unit tests and main app flows with e2e Playwright tests. We
are not aiming for any specific coverage. Use your best judgment.

Bun is used to run unit tests. To run them use `bun test` or `bun run test`. Colocate the test file next to the piece it
tests and name the file `<name_of_the_unit_tested>.test.ts(x)`.

E2e tests are written in [Playwright](https://playwright.dev/). In these tests we are mocking the Open Secret API so tests
can be run offline, and so we can simulate any desired Open Secret behavior. For some examples on how to use the mocking
see the existing tests. E2e tests can be found in the top-level `e2e` folder. To run them use `bun run test:e2e` (add `--ui`
param to run them in Playwright UI). The tests will also start a local Supabase stack, if it is not already running.
New e2e test suites should be added to the `e2e` folder and named `<name_of_the_suite>.spec.ts`.

## CI

Every pull request created will trigger the GitHub Actions CI pipeline. The pipeline runs three jobs in parallel. One
checks code format, lint, and types. Another runs the unit tests, and a third one runs e2e tests. If any of the jobs fail,
merging to `master` will not be allowed.

## Gift Card Assets

Gift card images should use the **WebP format** for better compression and faster loading.

### Converting PNG to WebP

Use the provided conversion script:

```sh
# Convert a single file
./tools/convert-to-webp.sh app/assets/gift-cards/mycard.png

# Convert all PNGs in the gift-cards directory
./tools/convert-to-webp.sh --dir app/assets/gift-cards

# With custom quality (default is 80)
./tools/convert-to-webp.sh -q 85 --dir app/assets/gift-cards
```

Requires `cwebp` - install with `brew install webp` if not available.
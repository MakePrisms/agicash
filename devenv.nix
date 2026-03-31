{ pkgs, lib, config, inputs, ... }:

let
  # Pin biome to v1.9.4 from nixos-24.11 to match biome.jsonc config
  pkgs-stable = import inputs.nixpkgs-stable { system = pkgs.stdenv.system; };
in
{
  # https://devenv.sh/basics/
  env.GREET = "devenv";

  # https://devenv.sh/packages/
  packages = [
    pkgs.git
    pkgs.jq
    pkgs.bun
    pkgs.fnm
    pkgs.mkcert
    pkgs.nss.tools
    pkgs.gh
    pkgs.nodePackages.typescript-language-server
    pkgs.nodePackages.vercel
    pkgs-stable.biome
    (pkgs.callPackage ./tools/convert-to-webp {})
  ];

  # https://devenv.sh/languages/
  # languages.rust.enable = true;

  # https://devenv.sh/processes/
  # processes.cargo-watch.exec = "cargo-watch";

  # https://devenv.sh/services/
  # services.postgres.enable = true;

  # https://devenv.sh/scripts/
  scripts.hello.exec = ''
    echo Hello from $GREET
  '';
  scripts.agicash.exec = "bun run $DEVENV_ROOT/packages/cli/src/main.ts $@";
  scripts.webstorm.exec = "$DEVENV_ROOT/tools/devenv/webstorm.sh $@";
  scripts.generate-ssl-cert.exec = "$DEVENV_ROOT/tools/devenv/generate-ssl-cert.sh";
  scripts.convert-gift-card-images.exec = ''
    shopt -s nullglob
    pngs=("$DEVENV_ROOT/app/assets/gift-cards/"*.png)
    if [ ''${#pngs[@]} -eq 0 ]; then
      echo "No PNG files found in app/assets/gift-cards/"
      exit 0
    fi
    convert-to-webp "''${pngs[@]}"
  '';

  enterShell = ''
    hello
    git --version
    echo Bun version: $(bun --version)
    generate-ssl-cert

    # Trust mkcert CA in Node.js (Makes node trust local cert and solves the issue with Supabase local MCP failing because of untrusted cert.)
    export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"

    # NixOS fix: bun run prepends node_modules/.bin to PATH, and the
    # npm-installed biome is a dynamically linked binary that NixOS can't
    # execute. Replace it with a symlink to the Nix-provided biome.
    if [ -d "$DEVENV_ROOT/node_modules/.bin" ]; then
      ln -sf "$(command -v biome)" "$DEVENV_ROOT/node_modules/.bin/biome"
    fi
  '';

  # https://devenv.sh/tasks/
  # tasks = {
  #   "myproj:setup".exec = "mytool build";
  #   "devenv:enterShell".after = [ "myproj:setup" ];
  # };

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    git --version | grep --color=auto "${pkgs.git.version}"
  '';

  # https://devenv.sh/pre-commit-hooks/
 git-hooks.hooks.generate-db-types = {
    enable = true;
    name = "Generate database types from local db";
    entry = "bun run db:generate-types";
  };
  
 git-hooks.hooks.typecheck = {
    enable = true;
    entry = "bun run typecheck";
    pass_filenames = false;
  };
  
 git-hooks.hooks.biome = {
    enable = true;
    entry = "bun run fix:staged";
  };

  # See full reference at https://devenv.sh/reference/options/
}

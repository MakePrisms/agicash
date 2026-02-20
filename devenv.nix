{ pkgs, lib, config, inputs, ... }:

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
  scripts.webstorm.exec = "$DEVENV_ROOT/tools/devenv/webstorm.sh $@";
  scripts.generate-ssl-cert.exec = "$DEVENV_ROOT/tools/devenv/generate-ssl-cert.sh";

  enterShell = ''
    hello
    git --version
    echo Bun version: $(bun --version)
    generate-ssl-cert

    # Trust mkcert CA in Node.js (Makes node trust local cert and solves the issue with Supabase local MCP failing because of untrusted cert.)
    export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
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
    pass_filenames = false;
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

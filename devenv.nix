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
    pkgs.nodePackages.vercel
    pkgs.mkcert
    pkgs.nss.tools
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
  pre-commit.hooks.generate-db-types = {
    enable = true;
    name = "Generate database types from local db";
    entry = "bun run db:generate-types";
  };
  
  pre-commit.hooks.typecheck = {
    enable = true;
    entry = "bun run typecheck";
    pass_filenames = false;
  };
  
  pre-commit.hooks.biome = {
    enable = true;
    entry = "bun run fix:staged";
  };

  pre-commit.hooks.unit-tests = {
    enable = true;
    entry = "bash -c 'if bun run test > /dev/null 2>&1; then echo \"✓ Unit tests passed\"; else echo \"✗ Unit tests failed\"; exit 1; fi'";
    pass_filenames = false;
  };

  # See full reference at https://devenv.sh/reference/options/
}

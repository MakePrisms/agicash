{ writeShellApplication, libwebp }:

writeShellApplication {
  name = "convert-to-webp";
  runtimeInputs = [ libwebp ];
  text = builtins.readFile ./convert-to-webp.sh;
}

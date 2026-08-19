# Simple `nix-shell` fallback for environments without flakes.
# Install npm deps first (npm install), then:
#   nix-shell            # for the dev toolchain
#   nix-shell --run npx tsc --noEmit   # typecheck
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_22
    pkgs.typescript
    pkgs.typescript-language-server
  ];

  shellHook = ''
    echo "yt-data-api-mcp shell ready."
  '';
}
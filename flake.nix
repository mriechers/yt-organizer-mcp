{
  description = "yt-data-api-mcp: MCP server for YouTube Data API v3 (Playlists & PlaylistItems)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = import nixpkgs {inherit system;};
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_22
            pkgs.typescript
            pkgs.typescript-language-server
          ];

          shellHook = ''
            echo "yt-data-api-mcp dev shell"
            echo "  node:   $(node --version)"
            echo "  npm:    $(npm --version)"
            echo ""
            echo "Set YOUTUBE_API_KEY and/or YOUTUBE_ACCESS_TOKEN to use the server."
          '';
        };
      }
    );
}
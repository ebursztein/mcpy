#!/usr/bin/env bash
set -euo pipefail

# mcpy installer
# Usage: curl -fsSL https://mcpy.app/install.sh | bash

REPO="ebursztein/mcpy"
INSTALL_DIR="$HOME/.mcpy/bin"
BINARY="$INSTALL_DIR/mcpy"

# --- Output helpers ---

red="\033[0;31m"
green="\033[0;32m"
yellow="\033[0;33m"
cyan="\033[0;36m"
reset="\033[0m"

info()  { printf "${cyan}[info]${reset}  %s\n" "$1"; }
ok()    { printf "${green}[ok]${reset}    %s\n" "$1"; }
warn()  { printf "${yellow}[warn]${reset}  %s\n" "$1"; }
fail()  { printf "${red}[error]${reset} %s\n" "$1"; exit 1; }

# --- Dependency checks ---

command -v curl >/dev/null 2>&1 || fail "curl is required but not found"

# Find a SHA256 hasher
SHA256_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
  SHA256_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA256_CMD="shasum -a 256"
else
  warn "neither sha256sum nor shasum found -- skipping checksum verification"
fi

# --- Platform detection ---

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) fail "Windows is not supported. Use WSL instead." ;;
  *)      fail "unsupported operating system: $OS" ;;
esac

case "$ARCH" in
  x86_64|amd64)   ARCH="x64" ;;
  arm64|aarch64)   ARCH="arm64" ;;
  i386|i686)       fail "32-bit systems are not supported" ;;
  *)               fail "unsupported architecture: $ARCH" ;;
esac

ASSET="mcpy-${PLATFORM}-${ARCH}"

info "installing mcpy for ${PLATFORM}/${ARCH}..."

# --- Fetch latest release ---

info "fetching latest release from GitHub..."

RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null)" \
  || fail "failed to fetch release info from GitHub. check your internet connection."

DOWNLOAD_URL="$(echo "$RELEASE_JSON" | grep "browser_download_url.*${ASSET}\"" | head -1 | cut -d '"' -f 4)"

if [ -z "$DOWNLOAD_URL" ]; then
  fail "no release binary found for ${ASSET}. check https://github.com/${REPO}/releases"
fi

TAG="$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | cut -d '"' -f 4)"
VERSION="${TAG#v}"
info "latest version: ${VERSION}"

# --- Check existing install ---

if [ -f "$BINARY" ]; then
  CURRENT="$("$BINARY" version 2>/dev/null | awk '{print $2}' || echo "")"
  if [ "$CURRENT" = "$VERSION" ]; then
    ok "mcpy ${VERSION} is already installed and up to date"
    # Still run install to ensure registration is current
    "$BINARY" install
    exit 0
  fi
  if [ -n "$CURRENT" ]; then
    info "upgrading mcpy from ${CURRENT} to ${VERSION}"
  fi
fi

# --- Download binary ---

mkdir -p "$INSTALL_DIR"
TMP_FILE="${BINARY}.tmp"

info "downloading ${ASSET}..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE" \
  || fail "download failed. check your internet connection."

ok "download complete"

# --- Verify checksum ---

if [ -n "$SHA256_CMD" ]; then
  SUMS_URL="$(echo "$DOWNLOAD_URL" | sed 's|/[^/]*$|/SHA256SUMS|')"
  SUMS_TEXT="$(curl -fsSL "$SUMS_URL" 2>/dev/null || echo "")"

  if [ -n "$SUMS_TEXT" ]; then
    EXPECTED="$(echo "$SUMS_TEXT" | grep "$ASSET" | awk '{print $1}')"
    if [ -n "$EXPECTED" ]; then
      ACTUAL="$($SHA256_CMD "$TMP_FILE" | awk '{print $1}')"
      if [ "$ACTUAL" != "$EXPECTED" ]; then
        rm -f "$TMP_FILE"
        fail "checksum verification failed (expected ${EXPECTED}, got ${ACTUAL})"
      fi
      ok "checksum verified"
    else
      warn "no checksum found for ${ASSET} in SHA256SUMS"
    fi
  else
    warn "SHA256SUMS not available -- skipping verification"
  fi
fi

# --- Install binary ---

chmod +x "$TMP_FILE"
mv -f "$TMP_FILE" "$BINARY"
ok "binary installed to ${BINARY}"

# --- Register with Claude Desktop and Claude Code ---

"$BINARY" install

echo ""
ok "mcpy ${VERSION} is ready"
echo ""
info "restart Claude Desktop to connect. for Claude Code, start a new session."

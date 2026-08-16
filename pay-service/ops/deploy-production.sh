#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
commit="${1:-}"
host="${MCP_SCOREBOARD_DEPLOY_HOST:-root@77.42.20.140}"
identity="${MCP_SCOREBOARD_DEPLOY_IDENTITY:-/Users/davidmosiah/.ssh/hetzner_openclaw}"
service="mcp-scoreboard-pay"

fail() { printf 'deploy failed: %s\n' "$*" >&2; exit 1; }
[ -n "$commit" ] || fail "usage: $0 <full-commit-sha>"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit must be a full SHA-1"
git -C "$repo_root" cat-file -e "$commit^{commit}" || fail "unknown commit"
[ "$(git -C "$repo_root" rev-parse "$commit")" = "$commit" ] || fail "ambiguous commit"

work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work/release/pay-service"
git -C "$repo_root" archive "$commit" pay-service | tar -xf - -C "$work/release"
cp "$repo_root/pay-service/ops/mcp-scoreboard-pay.service" "$work/"
tar -C "$work/release" -czf "$work/${service}-${commit}.tar.gz" pay-service
(
  cd "$work"
  sha256sum "${service}-${commit}.tar.gz" > "${service}-${commit}.sha256"
)

ssh_args=(-i "$identity" -o BatchMode=yes -o IdentitiesOnly=yes)
scp "${ssh_args[@]}" \
  "$work/${service}-${commit}.tar.gz" \
  "$work/${service}-${commit}.sha256" \
  "$work/mcp-scoreboard-pay.service" \
  "$host:/var/tmp/"

ssh "${ssh_args[@]}" "$host" bash -s -- "$commit" <<'REMOTE'
set -euo pipefail
umask 077
commit="$1"
service="mcp-scoreboard-pay"
archive="/var/tmp/${service}-${commit}.tar.gz"
checksum="/var/tmp/${service}-${commit}.sha256"
release="/opt/${service}/releases/${commit}"
current="/opt/${service}/current"
previous=""

[ -s "$archive" ] && [ -s "$checksum" ] || { echo "missing release artifact" >&2; exit 1; }
(cd /var/tmp && sha256sum -c "$(basename "$checksum")")
[ -s /etc/mcp-scoreboard-pay/pay.env ] || { echo "missing production environment" >&2; exit 1; }
[ -s /etc/mcp-scoreboard-pay/cdp-api-key.pem ] || { echo "missing CDP credential" >&2; exit 1; }
grep -qx -- '-----BEGIN PRIVATE KEY-----' /etc/mcp-scoreboard-pay/cdp-api-key.pem ||
  { echo "CDP credential must be unencrypted PKCS8 PEM" >&2; exit 1; }
openssl pkey -check -noout -in /etc/mcp-scoreboard-pay/cdp-api-key.pem >/dev/null 2>&1 ||
  { echo "invalid CDP credential" >&2; exit 1; }

if ! id -u "$service" >/dev/null 2>&1; then
  useradd --system --home-dir "/var/lib/$service" --shell /usr/sbin/nologin "$service"
fi
install -d -o root -g root -m 0755 "/opt/$service/releases"
install -d -o "$service" -g "$service" -m 0750 "/var/lib/$service"
install -d -o root -g "$service" -m 0750 /etc/mcp-scoreboard-pay
chown root:"$service" /etc/mcp-scoreboard-pay/pay.env
chmod 0640 /etc/mcp-scoreboard-pay/pay.env
chown root:"$service" /etc/mcp-scoreboard-pay/cdp-api-key.pem
chmod 0640 /etc/mcp-scoreboard-pay/cdp-api-key.pem

if [ -L "$current" ]; then
  previous="$(readlink -f "$current")"
fi

[ ! -e "$release" ] || { echo "immutable release already exists: $release" >&2; exit 1; }
install -d -o root -g root -m 0755 "$release"
tar -xzf "$archive" -C "$release"
cd "$release/pay-service"
npm ci --omit=dev --ignore-scripts
npm audit --omit=dev --audit-level=high
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +

install -o root -g root -m 0644 /var/tmp/mcp-scoreboard-pay.service \
  /etc/systemd/system/mcp-scoreboard-pay.service
ln -s "$release" "/opt/$service/.current-${commit}"
mv -Tf "/opt/$service/.current-${commit}" "$current"
systemctl daemon-reload
systemctl enable mcp-scoreboard-pay.service >/dev/null

rollback() {
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -s "$previous" "/opt/$service/.rollback-${commit}"
    mv -Tf "/opt/$service/.rollback-${commit}" "$current"
    systemctl restart mcp-scoreboard-pay.service || true
  else
    systemctl stop mcp-scoreboard-pay.service || true
  fi
}
trap rollback ERR
systemctl restart mcp-scoreboard-pay.service
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8797/readyz >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8797/readyz >/dev/null
systemctl is-active --quiet mcp-scoreboard-pay.service
trap - ERR
rm -f "$archive" "$checksum" /var/tmp/mcp-scoreboard-pay.service
printf 'deployed_commit=%s service=active readyz=ok\n' "$commit"
REMOTE

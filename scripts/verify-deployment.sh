#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://127.0.0.1:3002}"
payload_bytes="${PAYLOAD_BYTES:-12000000}"
payload_file="$(mktemp)"
response_file="$(mktemp)"
trap 'rm -f -- "$payload_file" "$response_file"' EXIT

expect_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label returned $actual; expected $expected" >&2
    if [[ -s "$response_file" ]]; then sed -n '1,20p' "$response_file" >&2; fi
    exit 1
  fi
  echo "OK: $label returned $actual"
}

health_status="$(curl --max-time 10 -sS -o "$response_file" -w '%{http_code}' "$base_url/health/live")"
expect_status 200 "$health_status" "liveness"

registration_status="$(curl --max-time 10 -sS -o "$response_file" -w '%{http_code}' \
  -H 'Content-Type: application/json' -X POST "$base_url/v1/auth/register" \
  --data '{"email":"deployment-probe@example.invalid","password":"never-created-test-password"}')"
expect_status 403 "$registration_status" "public registration"

head -c "$payload_bytes" /dev/zero > "$payload_file"
application_limit_status="$(curl --max-time 20 -sS -o "$response_file" -w '%{http_code}' \
  -H 'Content-Type: application/octet-stream' -H 'Expect:' -X POST \
  "$base_url/v1/receipts/upload" --data-binary "@$payload_file")"
expect_status 413 "$application_limit_status" "application body limit"

if [[ -n "${GATEWAY_URL:-}" ]]; then
  gateway_headers=()
  if [[ -n "${GATEWAY_HOST:-}" ]]; then gateway_headers=(-H "Host: $GATEWAY_HOST"); fi
  gateway_limit_status="$(curl --max-time 20 -sS -o "$response_file" -w '%{http_code}' \
    "${gateway_headers[@]}" -H 'Content-Type: application/json' -H 'Expect:' -X POST \
    "$GATEWAY_URL/v1/auth/login" --data-binary "@$payload_file")"
  expect_status 413 "$gateway_limit_status" "gateway body limit"
fi

echo "verify-deployment: OK"

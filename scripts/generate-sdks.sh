#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATOR_VERSION="${OPENAPI_GENERATOR_VERSION:-7.15.0}"
GENERATOR_IMAGE="${OPENAPI_GENERATOR_IMAGE:-openapitools/openapi-generator-cli@sha256:509f01c3c7eee9d1ad286506a7b6aa4624a95b410be9a238a306d209e900621f}"
SPEC="/local/contracts/openapi/codestra-public.openapi.yaml"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to run the pinned OpenAPI generator." >&2
  exit 1
}

rm -rf "$ROOT/generated/python" "$ROOT/generated/php"
mkdir -p "$ROOT/generated/python" "$ROOT/generated/php"

run_generator() {
  local generator="$1"
  local config="$2"
  local output="$3"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --volume "$ROOT:/local" \
    "$GENERATOR_IMAGE" generate \
    --generator-name "$generator" \
    --input-spec "$SPEC" \
    --config "/local/$config" \
    --output "/local/$output" \
    --global-property apiTests=true,modelTests=true,apiDocs=true,modelDocs=true
}

run_generator python codegen/python.yaml generated/python
run_generator php codegen/php.yaml generated/php

node "$ROOT/scripts/verify-generated-sdks.mjs" "$ROOT/generated"

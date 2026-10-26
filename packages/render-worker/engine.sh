#!/usr/bin/env bash
# Entry point the controlling machine calls over SSH: ssh <host> '~/video-studio/packages/render-worker/engine.sh <args>'
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# shellcheck disable=SC1091
source .engine/env.sh
exec node --import tsx packages/render-worker/src/engine-cli.ts "$@"

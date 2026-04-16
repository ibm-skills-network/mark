#!/bin/bash

set -euxo pipefail

git diff --staged --name-only --diff-filter=ACMR -z \
  | xargs -0 detect-secrets-hook --baseline .secrets.baseline --verbose

#!/bin/bash

set -euxo pipefail

git ls-files -z | xargs -0 detect-secrets-hook --baseline .secrets.baseline --verbose

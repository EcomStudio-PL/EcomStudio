#!/usr/bin/env bash
#
# INSTALL STEP FOR THE VERCEL BUILD.
#
# The Vercel project's Install Command is `bash setup.sh`, and this file did not
# exist — it never has, in the whole history of the repository. Every build from
# git therefore died on its first line:
#
#     Running "install" command: `bash setup.sh`...
#     bash: setup.sh: No such file or directory
#     Error: Command "bash setup.sh" exited with 127
#
# The effect was not a visible outage, which is why it survived: pushes kept
# producing deployments, the deployments kept going red, and production was
# being updated by a completely separate file-payload path that never ran this
# command. So the git pipeline looked connected and delivered nothing.
#
# The file is the smaller half of the fix — the honest repair is a project whose
# Install Command is the default. Until someone clears that setting in the
# dashboard, this satisfies the contract the project already declares, and it
# does exactly what the default would have done anyway.
#
# `npm ci` is preferred because it installs the locked tree and nothing else.
# It refuses to run when package.json and package-lock.json disagree, and a
# build is the wrong place to discover that, so the fallback keeps deployments
# working while that gets fixed separately.

set -euo pipefail

npm ci --no-audit --no-fund || npm install --no-audit --no-fund

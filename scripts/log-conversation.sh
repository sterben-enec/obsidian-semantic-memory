#!/bin/bash
# Wrapper для Stop hook — устанавливает env vars и запускает log-conversation

export VAULT_PATH="/Users/jmassa/Library/Mobile Documents/iCloud~md~obsidian/Documents"
export CONVERSATIONS_DIR="Main/10. Cora/Claude Code/Conversations"
export HOME=/Users/jmassa
export PATH="/usr/local/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin"

exec /usr/local/opt/node@24/bin/node \
  /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/dist/cli.js \
  log-conversation

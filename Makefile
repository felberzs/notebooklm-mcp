# NotebookLM MCP Server — quick Docker commands
#
# Claude Code runs inside the long-lived `oxp-claude-cli` container (see
# ../../../oxp-claude-cli/Makefile), so every `claude ...` invocation below is
# executed with `docker exec` against that container rather than on the host.
#
# Requirements for the `run` / `down` targets:
#   - the `oxp-claude-cli` container is deployed and running
#   - that container has the docker CLI + /var/run/docker.sock mounted, so it
#     can itself run `docker exec -i notebooklm-mcp ...` for the MCP stdio pipe

.PHONY: help build auth run logs down require-claude-cli

IMAGE            := notebooklm-mcp:latest
SERVICE          := oxp-notebooklm-mcp
CONTAINER        := notebooklm-mcp
WEB_NETWORK      := oxp-web-network

# Claude Code CLI container and the exec wrapper used to drive it.
CLAUDE_CONTAINER ?= oxp-claude-cli
CLAUDE           := docker exec -i $(CLAUDE_CONTAINER) claude

help:
	@echo "NotebookLM MCP Server"
	@echo "====================="
	@echo "build  - Build the Docker image ($(IMAGE))"
	@echo "auth   - Trigger browser authentication (open VNC first)"
	@echo "run    - Start the Docker Compose stack (registers MCP in $(CLAUDE_CONTAINER))"
	@echo "logs   - Tail the container logs"
	@echo "down   - Stop the Docker Compose stack (unregisters MCP in $(CLAUDE_CONTAINER))"

build:
	@echo "==> Building Docker image $(IMAGE)..."
	docker compose build --no-cache
	@echo "==> Build complete."

auth:
	@echo "==> Triggering authentication..."
	@echo "==> Open VNC in your browser: https://notebooklm-mcp.173.249.9.46.nip.io/vnc.html"
	@curl -X POST http://localhost:3000/setup-auth \
		-H "Content-Type: application/json" \
		-d '{"show_browser": true}'
	@echo ""
	@echo "==> Auth triggered. Complete the Google login in the VNC window."

require-claude-cli:
	@[ "$$(docker inspect -f '{{.State.Running}}' $(CLAUDE_CONTAINER) 2>/dev/null)" = "true" ] \
		|| { echo "Container '$(CLAUDE_CONTAINER)' is not running. Deploy it first (see ../../../oxp-claude-cli/Makefile: make deploy)."; exit 1; }

run: require-claude-cli
	@echo "==> Starting $(SERVICE)..."
	@docker compose up -d
	@docker network connect $(WEB_NETWORK) $(CONTAINER) 2>/dev/null || true
	@echo "==> Adding MCP server to Claude (in $(CLAUDE_CONTAINER))"
	@$(CLAUDE) mcp add -s user notebooklm -- docker exec -i $(CONTAINER) node dist/index.js
	@$(CLAUDE) -p "/plugin marketplace add roomi-fields/claude-plugins"
	@$(CLAUDE) -p "/plugin install rtfm@roomi-fields"
	@echo "==> Started. API: http://localhost:3000  VNC: http://localhost:6080/vnc.html"
	@echo "==> Install RTFM plugin in Claude if not yet done: "
	@echo "		  /plugin marketplace add roomi-fields/claude-plugins"
	@echo "		  /plugin install rtfm@roomi-fields"

logs:
	@echo "==> Tailing $(SERVICE) logs..."
	docker compose logs -f

down: require-claude-cli
	@echo "==> Stopping $(SERVICE)..."
	@docker compose down
	@echo "==> Removing MCP server and RTFM plugins from Claude (in $(CLAUDE_CONTAINER))"
	@$(CLAUDE) mcp remove -s user notebooklm || true
	@echo "==> Uninstall RTFM plugin from Claude if needed: "
	@echo "		  /plugin uninstall rtfm@roomi-fields"

# NotebookLM MCP Server — quick Docker commands

.PHONY: help build auth run logs down

IMAGE   := notebooklm-mcp:latest
SERVICE := oxp-notebooklm-mcp

help:
	@echo "NotebookLM MCP Server"
	@echo "====================="
	@echo "build  - Build the Docker image ($(IMAGE))"
	@echo "auth   - Trigger browser authentication (open VNC first)"
	@echo "run    - Start the Docker Compose stack"
	@echo "logs   - Tail the container logs"
	@echo "down   - Stop the Docker Compose stack"

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

run:
	@echo "==> Starting $(SERVICE)..."
	@docker compose up -d
	@docker network connect oxp-web-network notebooklm-mcp
	@echo "==> adding MCP server to Claude"
	@claude mcp add notebooklm -- docker exec -i notebooklm-mcp node dist/index.js
	@claude -p "/plugin marketplace add roomi-fields/claude-plugins"
	@claude -p "/plugin install rtfm@roomi-fields"
	@echo "==> Started. API: http://localhost:3000  VNC: http://localhost:6080/vnc.html"
	@echo "==> Install RTFM plugin in Claude if not yet done: "
	@echo "		  /plugin marketplace add roomi-fields/claude-plugins"
	@echo "		  /plugin install rtfm@roomi-fields"

logs:
	@echo "==> Tailing $(SERVICE) logs..."
	docker compose logs -f

down:
	@echo "==> Stopping $(SERVICE)..."
	@docker compose down
	@echo "==> removing MCP server and RTFM plugins from Claude"
	@claude mcp remove notebooklm
	@echo "==> Uninstall RTFM plugin from Claude if needed: "
	@echo "		  /plugin uninstall rtfm@roomi-fields"
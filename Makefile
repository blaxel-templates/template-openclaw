IMAGE_NAME := openclaw-local
CONTAINER_NAME := openclaw-local
PORT := 8888
VOLUME_NAME := openclaw-data

.PHONY: build run stop restart logs clean

build:
	docker build -t $(IMAGE_NAME) .

run: build
	@if docker ps -a --format '{{.Names}}' | grep -q '^$(CONTAINER_NAME)$$'; then \
		echo "Container already exists. Run 'make restart' or 'make clean' first."; \
		exit 1; \
	fi
	docker run -d \
		--name $(CONTAINER_NAME) \
		-p $(PORT):80 \
		-v $(VOLUME_NAME):/root/.openclaw \
		-v $(PWD)/setup-server.js:/setup-server.js \
		-v $(PWD)/blaxel-logo.png:/assets/blaxel-logo.png \
		-v $(PWD)/icon-dark.png:/assets/openclaw-logo.png \
		--env-file .env \
		$(IMAGE_NAME)
	@echo ""
	@echo "OpenClaw is starting at http://localhost:$(PORT)"
	@echo "Waiting for startup..."
	@sleep 12
	@docker logs $(CONTAINER_NAME) 2>&1 | grep -E "(Auth user|Model|listening)" | tail -3
	@echo ""
	@echo "Ready! Open http://localhost:$(PORT) in your browser."

stop:
	docker stop $(CONTAINER_NAME) 2>/dev/null || true

restart: stop
	docker start $(CONTAINER_NAME)
	@echo "Restarted. Open http://localhost:$(PORT)"

logs:
	docker logs -f $(CONTAINER_NAME)

clean: stop
	docker rm $(CONTAINER_NAME) 2>/dev/null || true
	docker volume rm $(VOLUME_NAME) 2>/dev/null || true
	@echo "Container and volume removed."

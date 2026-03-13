# Local Environment

Build and run the OpenClaw Docker image locally for testing.

## Prerequisites

- Docker (or Podman) installed
- A `.env` file at the project root (see `.env.example`)

## Start

1. Run `make run` from the project root. This builds the image and starts the container.
2. Wait for the "Ready!" message.
3. The app is available at: **http://localhost:8888**

If `PROXY_USER` and `PROXY_PASSWORD` are set in `.env`, use those as basic auth credentials.
If not set, a setup wizard will run on first visit.

## Stop / Clean

- `make stop` to stop
- `make restart` to restart
- `make clean` to remove container and volume (full reset)
- `make logs` to tail logs

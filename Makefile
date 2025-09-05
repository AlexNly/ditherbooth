.PHONY: dev format

HOST ?= 127.0.0.1
PORT ?= 8000

dev:
	uvicorn ditherbooth.app:app --reload --host $(HOST) --port $(PORT)

format:
	black .

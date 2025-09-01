.PHONY: dev format

dev:
	uvicorn app:app --reload

format:
	black .

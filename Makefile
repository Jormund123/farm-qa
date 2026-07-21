# Farm GeoJSON QA Dashboard — task runner
# Convention: `make test` must be green before `make build`.

IMAGE := farm-qa
TAR   := farm-qa.tar

.PHONY: install test build run save-tar clean

install:            ## install python deps (frontend deps handled in web/)
	pip install -r requirements.txt

test:               ## run unit + integration + property tests
	pytest

build:              ## build the single-container image (frontend + backend)
	docker build -t $(IMAGE) .

run:                ## run the container -> http://localhost:8000
	docker run --rm -p 8000:8000 -e GEMINI_API_KEY $(IMAGE)

save-tar:           ## export the image as a .tar deliverable
	docker save -o $(TAR) $(IMAGE)

clean:
	rm -f $(TAR)
	find . -type d -name __pycache__ -prune -exec rm -rf {} +

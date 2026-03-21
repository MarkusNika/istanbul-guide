build:
	python scripts/build_data.py

serve:
	python -m http.server 8080

serve-lan:
	python -m http.server 8080 --bind 0.0.0.0

publish:
	python scripts/build_data.py
	git add .
	git commit -m "Update guide" || true
	git push

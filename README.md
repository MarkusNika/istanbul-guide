# Istanbul 2026 – Mobile Travel Guide

Ein mobiler Reiseguide für unseren Istanbul-Trip vom 03.04.2026 bis 10.04.2026.

## Features

- Tagesansicht mit Uhrzeiten
- Google-Maps- / Apple-Maps-Links
- Leaflet-Karte
- Datenbasis aus CSV
- Build zu `guide.json` und GeoJSON
- GitHub Pages Deployment

## Projektstruktur

```text
.
├── data/
│   ├── days.csv
│   ├── places.csv
│   ├── schedule.csv
│   ├── guide.json
│   ├── places.geojson
│   └── days/
├── scripts/
│   └── build_data.py
├── index.html
├── app.js
└── style.css

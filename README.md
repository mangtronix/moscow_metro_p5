# Moscow Metro Map

Interactive Moscow Metro map built with [p5.js](https://p5js.org/) and OpenStreetMap tiles.

**Live demo:** https://mangtronix.github.io/moscow_metro_p5/

## Features

- 241 metro stations plotted on a live OpenStreetMap tile background
- Color-coded by line, with multi-line transfer stations shown as concentric circles
- Hover over a station to see its name (Russian + transliterated English), line numbers, and coordinates
- Scroll to zoom, click and drag to pan
- Line geometries (track paths) loaded from cached data
- **Refetch Data** button pulls fresh station and line data from the Overpass API
- **Save CSV** exports all station data

## How It Was Made

This project was built entirely through a conversation with [Claude Code](https://claude.ai/claude-code), Anthropic's AI coding assistant, without writing any code manually.

### Process

1. **Initial sketch** — Asked Claude Code to create a p5.js visualization of the Moscow Metro using public OpenStreetMap data. It wrote the HTML/JS from scratch, including the Overpass API query, Web Mercator projection math, tile loading, and station rendering.

2. **Data fetching** — Station and line geometry data is queried from [Overpass API](https://overpass-api.de/), which provides access to OpenStreetMap data. The query fetches all subway route relations and stop nodes within Moscow.

3. **Caching** — To avoid depending on the Overpass API for every page load, Claude Code converted the fetched station data into a JavaScript array embedded directly in the HTML (241 stations), and saved the line geometry data to a local JSON file (`moscow_metro_lines_cache.json`). The sketch loads from these static sources instantly on startup.

4. **Bug fixes and polish** — Fixed an inverted vertical drag direction (a sign error in the Mercator Y coordinate math), added graceful API error handling, and labeled the data source in the UI (cached vs. live).

5. **Deployment** — Pushed to GitHub and enabled GitHub Pages via the `gh` CLI, all from within the Claude Code session.

### Stack

- **[p5.js](https://p5js.org/)** — Canvas drawing, event handling
- **[OpenStreetMap](https://www.openstreetmap.org/)** tile servers — Map background
- **[Overpass API](https://overpass-api.de/)** — Source of metro station and track data
- Vanilla HTML/JS, no build step

## Usage

Open `index.html` via a local HTTP server (required for the lines cache file to load):

```bash
python3 -m http.server 8765
# then open http://localhost:8765
```

Or just visit the [live demo](https://mangtronix.github.io/moscow_metro_p5/).

## Data

Station and line data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under [ODbL](https://opendatacommons.org/licenses/odbl/).

### Station JSON

The station dataset is available as a standalone JSON file for use in your own sketches:

```
https://mangtronix.github.io/moscow_metro_p5/moscow_metro_stations.json
```

Each station object has the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Station name in Russian (Cyrillic) |
| `nameEn` | string | Station name transliterated to English |
| `lat` | number | Latitude (WGS84) |
| `lon` | number | Longitude (WGS84) |
| `line` | string | Line number(s), e.g. `"1"`, `"4, 4А"` |
| `color` | string | Primary line color as hex, e.g. `"#E42313"` |
| `lineColors` | array | Hex color for each line (transfer stations have multiple) |

Example entry:

```json
{
  "name": "Комсомольская",
  "nameEn": "Komsomolskaya",
  "lat": 55.7752557,
  "lon": 37.6559741,
  "line": "1",
  "color": "#E42313",
  "lineColors": ["#E42313"]
}
```

### Using in a p5.js sketch

The JSON is served with permissive CORS headers and works from any origin, including the [p5.js Web Editor](https://editor.p5js.org/).

```javascript
let stations = [];

async function setup() {
  createCanvas(800, 600);
  const res = await fetch('https://mangtronix.github.io/moscow_metro_p5/moscow_metro_stations.json');
  stations = await res.json();
}

function draw() {
  background(30);
  for (const s of stations) {
    fill(s.color);
    noStroke();
    const x = map(s.lon, 37.2, 38.0, 0, width);
    const y = map(s.lat, 55.5, 55.95, height, 0);
    circle(x, y, 8);
  }
}
```

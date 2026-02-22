// Cyrillic to Latin transliteration
const TRANSLIT_MAP = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
    'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
    'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
    'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

function transliterate(text) {
    return text.split('').map(c => TRANSLIT_MAP[c] || c).join('');
}

// Data storage
let stations = [];
let lineGeometries = [];
let dataLoaded = false;

// Map tiles
let tileCache = {};
const TILE_SIZE = 256;

// View state
let centerLat = 55.7558;
let centerLon = 37.6173;
let zoomLevel = 11;
let isDragging = false;
let dragStartX, dragStartY;
let dragStartLat, dragStartLon;
let hoveredStation = null;

// Touch state
let pinchStartDist = null;
let pinchStartZoom = null;
let tapStartX, tapStartY, tapStartTime;
let tapCancelled = false;
const TAP_MAX_MOVE = 15;
const TAP_MAX_MS = 300;

// --- Web Mercator projection ---

function lonToTileX(lon, zoom) {
    return (lon + 180) / 360 * Math.pow(2, zoom);
}

function latToTileY(lat, zoom) {
    const latRad = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom);
}

function tileXToLon(x, zoom) {
    return x / Math.pow(2, zoom) * 360 - 180;
}

function tileYToLat(y, zoom) {
    const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function latLonToPixel(lat, lon) {
    const scale = Math.pow(2, zoomLevel) * TILE_SIZE;
    const worldX = (lon + 180) / 360 * scale;
    const latRad = lat * Math.PI / 180;
    const worldY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;

    const centerX = (centerLon + 180) / 360 * scale;
    const centerLatRad = centerLat * Math.PI / 180;
    const centerY = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2 * scale;

    return {
        x: worldX - centerX + width / 2,
        y: worldY - centerY + height / 2
    };
}

function pixelToLatLon(px, py) {
    const scale = Math.pow(2, zoomLevel) * TILE_SIZE;

    const centerX = (centerLon + 180) / 360 * scale;
    const centerLatRad = centerLat * Math.PI / 180;
    const centerY = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2 * scale;

    const worldX = px - width / 2 + centerX;
    const worldY = py - height / 2 + centerY;

    const lon = worldX / scale * 360 - 180;
    const n = Math.PI - 2 * Math.PI * worldY / scale;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return { lat, lon };
}

// --- Tile loading ---

function getTileUrl(x, y, z) {
    const servers = ['a', 'b', 'c'];
    const server = servers[Math.abs(x + y) % servers.length];
    return `https://${server}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function loadTile(x, y, z) {
    const key = `${z}/${x}/${y}`;
    if (tileCache[key]) return tileCache[key];

    const img = loadImage(getTileUrl(x, y, z),
        () => { /* success */ },
        () => { tileCache[key] = null; }
    );
    tileCache[key] = img;
    return img;
}

// --- p5.js lifecycle ---

let canvasEl;

function setup() {
    canvasEl = createCanvas(windowWidth, windowHeight).elt;
    textFont('Arial');
    loadStaticData();
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function draw() {
    background(200);
    drawTiles();

    if (!dataLoaded) return;

    drawLines();
    drawStations();
    updateInfoPanel();
}

// --- Data loading ---

async function loadStaticData() {
    try {
        const response = await fetch('./moscow_metro_stations.json');
        stations = await response.json();
        stations.sort((a, b) => a.name.localeCompare(b.name));
        document.getElementById('station-count').textContent = `Stations: ${stations.length} (cached)`;
        dataLoaded = true;
    } catch (e) {
        console.error('Failed to load station data:', e);
    }
    await loadCachedLines();
}

async function loadCachedLines() {
    try {
        const response = await fetch('./moscow_metro_lines_cache.json');
        const data = await response.json();
        lineGeometries = data.map(line => ({
            color: line.color,
            coords: line.coords.map(([lat, lon]) => ({ lat, lon }))
        }));
    } catch (e) {
        // Lines will load after Refetch Data if cache file unavailable
    }
    document.getElementById('loading').style.display = 'none';
}

async function fetchMetroData() {
    const query = `
        [out:json][timeout:120];
        area["name"="Москва"]["admin_level"="4"]->.moscow;
        relation["route"="subway"](area.moscow)->.routes;
        .routes out body;
        node(r.routes:"stop")->.stops1;
        node(r.routes:"stop_entry_only")->.stops2;
        node(r.routes:"stop_exit_only")->.stops3;
        (.stops1; .stops2; .stops3;)->.allstops;
        .allstops out body;
        way["railway"="subway"](area.moscow);
        out geom;
    `;

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const data = await response.json();
        processData(data);
        document.getElementById('loading').style.display = 'none';
        dataLoaded = true;
        document.getElementById('station-count').textContent = `Stations: ${stations.length} (live)`;
    } catch (error) {
        document.getElementById('loading').textContent = 'API error: ' + error.message + ' — using cached data';
        setTimeout(() => {
            document.getElementById('loading').style.display = 'none';
        }, 4000);
    }
}

function processData(data) {
    const routes = [];
    const nodes = {};
    const ways = [];

    for (const element of data.elements) {
        if (element.type === 'relation') {
            routes.push(element);
        } else if (element.type === 'node') {
            nodes[element.id] = element;
        } else if (element.type === 'way') {
            ways.push(element);
        }
    }

    // Build line info per node
    const lineInfo = {};
    for (const route of routes) {
        const tags = route.tags || {};
        const ref = tags.ref || '?';
        const colour = tags.colour || '#888888';

        for (const member of route.members || []) {
            if (member.type === 'node' && ['stop', 'stop_entry_only', 'stop_exit_only', ''].includes(member.role || '')) {
                const nodeId = member.ref;
                if (!lineInfo[nodeId]) lineInfo[nodeId] = [];
                if (!lineInfo[nodeId].some(l => l.ref === ref)) {
                    lineInfo[nodeId].push({ ref, colour });
                }
            }
        }
    }

    // Build stations
    const seenNames = new Set();
    stations = [];

    for (const [nodeId, node] of Object.entries(nodes)) {
        const tags = node.tags || {};
        const name = tags.name || tags['name:ru'] || '';
        let nameEn = tags['name:en'] || '';
        const lat = node.lat;
        const lon = node.lon;

        if (!name || !lat || !lon || seenNames.has(name)) continue;
        seenNames.add(name);

        if (!nameEn) nameEn = transliterate(name);

        const lines = lineInfo[nodeId] || [];
        lines.sort((a, b) => {
            const aNum = !isNaN(a.ref[0]);
            const bNum = !isNaN(b.ref[0]);
            if (aNum !== bNum) return bNum - aNum;
            return a.ref.localeCompare(b.ref);
        });

        const lineRefs = lines.map(l => l.ref).join(', ');
        const lineColors = lines.map(l => l.colour);
        const colour = lineColors[0] || '#888888';

        stations.push({ name, nameEn, lat, lon, line: lineRefs, color: colour, lineColors });
    }

    stations.sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('station-count').textContent = `Stations: ${stations.length}`;

    // Build line geometries
    lineGeometries = [];
    for (const way of ways) {
        const geometry = way.geometry || [];
        if (geometry.length >= 2) {
            const coords = geometry.map(pt => ({ lat: pt.lat, lon: pt.lon }));
            const colour = (way.tags || {}).colour || '#888888';
            lineGeometries.push({ coords, color: colour });
        }
    }
}

// --- Drawing ---

function drawTiles() {
    const z = Math.floor(zoomLevel);
    const topLeft = pixelToLatLon(0, 0);
    const bottomRight = pixelToLatLon(width, height);

    const minTileX = Math.floor(lonToTileX(topLeft.lon, z));
    const maxTileX = Math.floor(lonToTileX(bottomRight.lon, z));
    const minTileY = Math.floor(latToTileY(topLeft.lat, z));
    const maxTileY = Math.floor(latToTileY(bottomRight.lat, z));

    for (let tileX = minTileX - 1; tileX <= maxTileX + 1; tileX++) {
        for (let tileY = minTileY - 1; tileY <= maxTileY + 1; tileY++) {
            const tile = loadTile(tileX, tileY, z);
            if (tile && tile.width > 0) {
                const pos = latLonToPixel(tileYToLat(tileY, z), tileXToLon(tileX, z));
                const displaySize = TILE_SIZE * Math.pow(2, zoomLevel - z);
                image(tile, pos.x, pos.y, displaySize, displaySize);
            }
        }
    }
}

function drawLines() {
    strokeWeight(Math.max(3, 4 * (zoomLevel / 11)));
    noFill();
    for (const line of lineGeometries) {
        stroke(line.color);
        beginShape();
        for (const coord of line.coords) {
            const { x, y } = latLonToPixel(coord.lat, coord.lon);
            vertex(x, y);
        }
        endShape();
    }
}

function drawStations() {
    // Find hovered station (mouse only — touch uses tap)
    if (touches.length === 0 && !isDragging) {
        hoveredStation = null;
        for (const station of stations) {
            const { x, y } = latLonToPixel(station.lat, station.lon);
            if (dist(mouseX, mouseY, x, y) < 15) {
                hoveredStation = station;
                break;
            }
        }
    }

    const baseRadius = Math.max(5, 8 * (zoomLevel / 11));

    for (const station of stations) {
        const { x, y } = latLonToPixel(station.lat, station.lon);
        const isHovered = station === hoveredStation;
        const isTransfer = station.lineColors.length > 1;

        if (isTransfer) {
            const radius = isHovered ? baseRadius * 1.3 : baseRadius;
            for (let i = station.lineColors.length - 1; i >= 0; i--) {
                const r = radius - (i * 2.5 * (zoomLevel / 11));
                fill(station.lineColors[i]);
                stroke(255);
                strokeWeight(Math.max(1, 1.5 * (zoomLevel / 11)));
                circle(x, y, Math.max(r * 2, 4));
            }
        } else {
            const radius = isHovered ? baseRadius * 1.2 : baseRadius;
            fill(station.color);
            stroke(255);
            strokeWeight(Math.max(1.5, 2 * (zoomLevel / 11)));
            circle(x, y, radius * 2);
        }

        if (isHovered) {
            noStroke();
            fill(0, 0, 0, 220);
            textSize(14);
            textAlign(LEFT, BOTTOM);
            const label = `${station.name} (${station.nameEn})`;
            const labelWidth = textWidth(label) + 10;
            rect(x + 12, y - 35, labelWidth, 28, 4);
            fill(255);
            text(label, x + 17, y - 12);
        }
    }
}

function updateInfoPanel() {
    const infoDiv = document.getElementById('station-info');
    if (hoveredStation) {
        infoDiv.style.display = 'block';
        document.getElementById('station-name').textContent = hoveredStation.name;
        document.getElementById('station-name-en').textContent = hoveredStation.nameEn;
        document.getElementById('station-lines').textContent = `Lines: ${hoveredStation.line}`;
        document.getElementById('station-coords').textContent =
            `${hoveredStation.lat.toFixed(6)}, ${hoveredStation.lon.toFixed(6)}`;
    } else {
        infoDiv.style.display = 'none';
    }
}

// --- Input handling ---

function mousePressed() {
    isDragging = true;
    dragStartX = mouseX;
    dragStartY = mouseY;
    dragStartLat = centerLat;
    dragStartLon = centerLon;
}

function mouseReleased() {
    isDragging = false;
}

function mouseDragged() {
    if (!isDragging) return;

    const scale = Math.pow(2, zoomLevel) * TILE_SIZE;
    const dx = mouseX - dragStartX;
    const dy = mouseY - dragStartY;

    centerLon = dragStartLon - dx / scale * 360;

    const centerLatRad = dragStartLat * Math.PI / 180;
    const startY = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2 * scale;
    const newY = startY - dy;
    const n = Math.PI - 2 * Math.PI * newY / scale;
    centerLat = constrain(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -85, 85);
}

function mouseWheel(event) {
    const mousePos = pixelToLatLon(mouseX, mouseY);

    zoomLevel = constrain(zoomLevel + (event.delta > 0 ? -0.3 : 0.3), 9, 17);

    const newMousePixel = latLonToPixel(mousePos.lat, mousePos.lon);
    const scale = Math.pow(2, zoomLevel) * TILE_SIZE;
    const dx = mouseX - newMousePixel.x;
    const dy = mouseY - newMousePixel.y;

    centerLon -= dx / scale * 360;

    const centerLatRad = centerLat * Math.PI / 180;
    const centerY = (1 - Math.log(Math.tan(centerLatRad) + 1 / Math.cos(centerLatRad)) / Math.PI) / 2 * scale;
    const newCenterY = centerY - dy;
    const n = Math.PI - 2 * Math.PI * newCenterY / scale;
    centerLat = constrain(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -85, 85);

    return false;
}

// --- Touch handlers ---

function touchStarted(event) {
    if (event.target !== canvasEl) return;
    if (touches.length === 1) {
        isDragging = true;
        dragStartX = touches[0].x;
        dragStartY = touches[0].y;
        dragStartLat = centerLat;
        dragStartLon = centerLon;
        tapStartX = touches[0].x;
        tapStartY = touches[0].y;
        tapStartTime = millis();
        tapCancelled = false;
    } else if (touches.length === 2) {
        isDragging = false;
        tapCancelled = true;
        pinchStartDist = dist(touches[0].x, touches[0].y, touches[1].x, touches[1].y);
        pinchStartZoom = zoomLevel;
    }
    return false;
}

function touchMoved(event) {
    if (event.target !== canvasEl) return;
    if (touches.length === 2 && pinchStartDist !== null) {
        const currentDist = dist(touches[0].x, touches[0].y, touches[1].x, touches[1].y);
        const midX = (touches[0].x + touches[1].x) / 2;
        const midY = (touches[0].y + touches[1].y) / 2;

        // Get the geo position of the pinch midpoint before changing zoom
        const midPos = pixelToLatLon(midX, midY);

        zoomLevel = constrain(pinchStartZoom + Math.log2(currentDist / pinchStartDist), 9, 17);

        // Adjust center so the pinch midpoint stays fixed on screen
        const newMidPixel = latLonToPixel(midPos.lat, midPos.lon);
        const scale = Math.pow(2, zoomLevel) * TILE_SIZE;
        const dx = midX - newMidPixel.x;
        const dy = midY - newMidPixel.y;

        centerLon -= dx / scale * 360;
        const clr = centerLat * Math.PI / 180;
        const cy = (1 - Math.log(Math.tan(clr) + 1 / Math.cos(clr)) / Math.PI) / 2 * scale;
        const n = Math.PI - 2 * Math.PI * (cy - dy) / scale;
        centerLat = constrain(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -85, 85);

    } else if (touches.length === 1 && isDragging) {
        const dx = touches[0].x - tapStartX;
        const dy = touches[0].y - tapStartY;
        if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE) tapCancelled = true;

        const scale = Math.pow(2, zoomLevel) * TILE_SIZE;
        const pdx = touches[0].x - dragStartX;
        const pdy = touches[0].y - dragStartY;

        centerLon = dragStartLon - pdx / scale * 360;
        const clr = dragStartLat * Math.PI / 180;
        const startY = (1 - Math.log(Math.tan(clr) + 1 / Math.cos(clr)) / Math.PI) / 2 * scale;
        const n = Math.PI - 2 * Math.PI * (startY - pdy) / scale;
        centerLat = constrain(180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), -85, 85);
    }
    return false;
}

function touchEnded(event) {
    if (event.target !== canvasEl) return;
    if (touches.length === 0) {
        if (!tapCancelled && millis() - tapStartTime < TAP_MAX_MS) {
            handleTap(tapStartX, tapStartY);
        }
        isDragging = false;
        pinchStartDist = null;
    } else if (touches.length === 1) {
        // Lifted one finger during pinch — resume pan from here
        pinchStartDist = null;
        isDragging = true;
        dragStartX = touches[0].x;
        dragStartY = touches[0].y;
        dragStartLat = centerLat;
        dragStartLon = centerLon;
    }
    return false;
}

function handleTap(x, y) {
    for (const station of stations) {
        const { x: sx, y: sy } = latLonToPixel(station.lat, station.lon);
        if (dist(x, y, sx, sy) < 20) {
            hoveredStation = (hoveredStation === station) ? null : station;
            return;
        }
    }
    hoveredStation = null;
}

// --- Button handlers ---

function resetView() {
    centerLat = 55.7558;
    centerLon = 37.6173;
    zoomLevel = 11;
}

function refetchData() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading').textContent = 'Fetching live data from API...';
    fetchMetroData();
}

function saveCSV() {
    if (stations.length === 0) {
        alert('No data to save');
        return;
    }

    let csv = 'Name,Name (English),Latitude,Longitude,Lines,Colors\n';
    for (const s of stations) {
        csv += `"${s.name}","${s.nameEn}",${s.lat},${s.lon},"${s.line}","${s.lineColors.join(';')}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'moscow_metro_stations.csv';
    a.click();
    URL.revokeObjectURL(url);
}

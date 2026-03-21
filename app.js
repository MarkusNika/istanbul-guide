const GUIDE_URL = "./data/guide.json";
const FALLBACK_CENTER = [41.0082, 28.9784];
const FALLBACK_ZOOM = 12;
const CACHE_KEY = "istanbul-guide-cache-v1";

const state = {
  guide: null,
  currentDayId: null,
  currentFilter: "all",
  currentTab: "plan",
  map: null,
  markersLayer: null,
  routeLayer: null,
  usingCache: false
};

const el = {
  tripMeta: document.getElementById("tripMeta"),
  refreshBtn: document.getElementById("refreshBtn"),
  daySelect: document.getElementById("daySelect"),
  prevDayBtn: document.getElementById("prevDayBtn"),
  nextDayBtn: document.getElementById("nextDayBtn"),
  dayTheme: document.getElementById("dayTheme"),
  dayStats: document.getElementById("dayStats"),
  timeline: document.getElementById("timeline"),
  hotelLink: document.getElementById("hotelLink"),
  cacheStatus: document.getElementById("cacheStatus"),
  mapHint: document.getElementById("mapHint"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: {
    plan: document.getElementById("planTab"),
    map: document.getElementById("mapTab"),
    info: document.getElementById("infoTab")
  },
  chips: [...document.querySelectorAll(".chip")]
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadCachedGuide() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCachedGuide(guide) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(guide));
  } catch {
    // ignore quota or private mode issues
  }
}

async function loadGuide({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = loadCachedGuide();
    if (cached) {
      state.guide = cached;
      state.usingCache = true;
      renderAll();
    }
  }

  const response = await fetch(GUIDE_URL, { cache: forceRefresh ? "reload" : "default" });
  if (!response.ok) {
    if (state.guide) return;
    throw new Error(`guide.json konnte nicht geladen werden: ${response.status}`);
  }

  const freshGuide = await response.json();
  state.guide = freshGuide;
  state.usingCache = false;
  saveCachedGuide(freshGuide);

  if (!state.currentDayId) {
    state.currentDayId = pickInitialDayId(freshGuide);
  }

  renderAll();
}

function pickInitialDayId(guide) {
  const urlHashDay = location.hash.replace("#", "").trim();
  if (urlHashDay && guide.days.some(d => d.day_id === urlHashDay)) {
    return urlHashDay;
  }

  const today = new Date().toISOString().slice(0, 10);
  const exact = guide.days.find(d => d.date === today);
  if (exact) return exact.day_id;

  return guide.days[0]?.day_id ?? null;
}

function setHashDay(dayId) {
  history.replaceState(null, "", `#${dayId}`);
}

function currentDay() {
  return state.guide.days.find(d => d.day_id === state.currentDayId);
}

function filterItems(items, filter) {
  switch (filter) {
    case "must":
      return items.filter(i => i.priority === "must");
    case "daughter":
      return items.filter(i => i.with_daughter);
    case "optional":
      return items.filter(i => i.priority === "optional");
    case "all":
    default:
      return items;
  }
}

function priorityBadge(priority) {
  if (priority === "must") return `<span class="badge must">Must</span>`;
  if (priority === "nice") return `<span class="badge nice">Nice</span>`;
  return `<span class="badge optional">Optional</span>`;
}

function transportLabel(code) {
  const labels = {
    walk: "zu Fuß",
    taxi: "Taxi",
    tram: "Tram",
    ferry: "Fähre",
    car: "Auto",
    arrival: "Ankunft",
    departure: "Abreise"
  };
  return labels[code] || code;
}

function placeTypeLabel(type) {
  const labels = {
    hotel: "Hotel",
    sight: "Sehenswürdigkeit",
    walk: "Spaziergang",
    breakfast: "Frühstück",
    lunch: "Lunch",
    dinner: "Dinner",
    coffee: "Kaffee",
    ferry: "Fähre",
    view: "Aussicht",
    hamam: "Hamam",
    transfer: "Transfer"
  };
  return labels[type] || type;
}

function renderAll() {
  if (!state.guide) return;

  if (!state.currentDayId) {
    state.currentDayId = pickInitialDayId(state.guide);
  }

  const trip = state.guide.trip;
  const day = currentDay();
  if (!day) return;

  renderHeader(trip);
  renderDaySelect();
  renderThemeAndStats(day);
  renderTimeline(day);
  renderInfo(trip);
  ensureMap();
  renderMap(day);
  syncActiveControls();
  setHashDay(day.day_id);
}

function renderHeader(trip) {
  el.tripMeta.textContent = `${trip.start_date} bis ${trip.end_date} · ${state.guide.days.length} Tage`;
  const hotel = state.guide.places[trip.hotel_place_id];
  if (hotel) {
    el.hotelLink.textContent = hotel.name;
    el.hotelLink.href = hotel.maps_url;
  }
  el.cacheStatus.textContent = state.usingCache
    ? "Daten aus lokalem Cache geladen"
    : `Live geladen · Stand ${new Date(trip.generated_at).toLocaleString("de-DE")}`;
}

function renderDaySelect() {
  const days = state.guide.days;
  el.daySelect.innerHTML = days
    .map(day => `<option value="${escapeHtml(day.day_id)}">${escapeHtml(day.label)}</option>`)
    .join("");

  el.daySelect.value = state.currentDayId;
}

function renderThemeAndStats(day) {
  el.dayTheme.innerHTML = `
    <div class="day-color-bar" style="background:${escapeHtml(day.color)}"></div>
    ${escapeHtml(day.theme)}
  `;

  const visibleItems = filterItems(day.items, state.currentFilter);
  const daughterCount = visibleItems.filter(i => i.with_daughter).length;
  const mustCount = visibleItems.filter(i => i.priority === "must").length;

  el.dayStats.innerHTML = `
    <span class="stat">${visibleItems.length} Stops</span>
    <span class="stat">${mustCount} Must</span>
    <span class="stat">${daughterCount} mit Tochter</span>
  `;
}

function renderTimeline(day) {
  const items = filterItems(day.items, state.currentFilter);

  if (!items.length) {
    el.timeline.innerHTML = `<div class="empty-state">Für diesen Filter gibt es an diesem Tag keine Einträge.</div>`;
    return;
  }

  el.timeline.innerHTML = items.map(item => {
    const place = item.place;
    const daughterBadge = item.with_daughter
      ? `<span class="badge daughter">mit Tochter</span>`
      : "";

    const noteHtml = item.notes
      ? `<div class="note">${escapeHtml(item.notes)}</div>`
      : "";

    const hasCoords = place.has_coordinates;
    const centerBtn = hasCoords
      ? `<button class="action-btn" data-action="center-map" data-place-id="${escapeHtml(place.place_id)}">Auf Karte</button>`
      : "";

    return `
      <article class="timeline-item ${item.with_daughter ? "daughter" : ""} ${item.priority === "optional" ? "optional" : ""}">
        <div class="time-badge">${escapeHtml(item.time_from)}<br>–<br>${escapeHtml(item.time_to)}</div>

        <div>
          <h3 class="item-title">${escapeHtml(item.activity_title)}</h3>
          <div class="item-subtitle">
            ${escapeHtml(place.name)} · ${escapeHtml(place.area)} · ${escapeHtml(placeTypeLabel(place.type))}
          </div>

          <div class="tags-row">
            ${priorityBadge(item.priority)}
            ${daughterBadge}
            <span class="badge transport">${escapeHtml(transportLabel(item.transport_from_prev))} · ${item.travel_min} min</span>
          </div>

          <div class="meta-row">
            ${(place.tags || []).map(tag => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
          </div>

          ${noteHtml}

          <div class="actions-row">
            <a class="action-btn primary" href="${escapeHtml(place.maps_url)}" target="_blank" rel="noopener">Google Maps</a>
            <a class="action-btn" href="${escapeHtml(place.apple_maps_url)}" target="_blank" rel="noopener">Apple Maps</a>
            ${centerBtn}
          </div>
        </div>
      </article>
    `;
  }).join("");

  [...document.querySelectorAll('[data-action="center-map"]')].forEach(btn => {
    btn.addEventListener("click", () => {
      const placeId = btn.dataset.placeId;
      centerMapOnPlace(placeId);
      switchTab("map");
    });
  });
}

function ensureMap() {
  if (state.map) return;

  state.map = L.map("map", {
    zoomControl: true
  }).setView(FALLBACK_CENTER, FALLBACK_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap-Mitwirkende'
  }).addTo(state.map);

  state.markersLayer = L.layerGroup().addTo(state.map);
  state.routeLayer = L.layerGroup().addTo(state.map);
}

function markerColorForType(type) {
  const colors = {
    hotel: "#455A64",
    sight: "#1565C0",
    walk: "#00838F",
    breakfast: "#EF6C00",
    lunch: "#2E7D32",
    dinner: "#C62828",
    coffee: "#6A1B9A",
    ferry: "#0277BD",
    view: "#AD1457",
    hamam: "#8D6E63",
    transfer: "#546E7A"
  };
  return colors[type] || "#1565C0";
}

function createDivIcon(color, label) {
  return L.divIcon({
    className: "custom-div-icon",
    html: `
      <div style="
        background:${color};
        width:28px;
        height:28px;
        border-radius:50%;
        color:white;
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:700;
        border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,.25);
      ">${label}</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -12]
  });
}

function renderMap(day) {
  state.markersLayer.clearLayers();
  state.routeLayer.clearLayers();

  const mappedItems = day.items.filter(item => item.place.has_coordinates);

  if (!mappedItems.length) {
    state.map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    el.mapHint.textContent = "Noch keine Koordinaten in places.csv gepflegt. Die Liste funktioniert bereits, die Karte wird lebendig, sobald lat/lon gesetzt sind.";
    return;
  }

  const latlngs = [];

  mappedItems.forEach(item => {
    const p = item.place;
    const latlng = [p.lat, p.lon];
    latlngs.push(latlng);

    const marker = L.marker(
      latlng,
      { icon: createDivIcon(markerColorForType(p.type), String(item.seq)) }
    );

    marker.bindPopup(`
      <div class="popup-title">${escapeHtml(item.activity_title)}</div>
      <div class="popup-sub">${escapeHtml(p.name)} · ${escapeHtml(p.area)}</div>
      <div><a href="${escapeHtml(p.maps_url)}" target="_blank" rel="noopener">Google Maps öffnen</a></div>
    `);

    marker.addTo(state.markersLayer);
  });

  if (latlngs.length >= 2) {
    const poly = L.polyline(latlngs, {
      color: day.color,
      weight: 4,
      opacity: 0.75
    });
    poly.addTo(state.routeLayer);
  }

  const bounds = L.latLngBounds(latlngs);
  state.map.fitBounds(bounds.pad(0.2));
  el.mapHint.textContent = `${mappedItems.length} Orte mit Koordinaten auf der Karte.`;
}

function centerMapOnPlace(placeId) {
  const place = state.guide.places[placeId];
  if (!place || !place.has_coordinates || !state.map) return;

  state.map.setView([place.lat, place.lon], 16);
}

function renderInfo(trip) {
  // currently handled in header + info panel
}

function switchTab(tabName) {
  state.currentTab = tabName;

  el.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  Object.entries(el.panels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === tabName);
  });

  if (tabName === "map" && state.map) {
    setTimeout(() => state.map.invalidateSize(), 50);
  }
}

function syncActiveControls() {
  el.chips.forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === state.currentFilter);
  });
}

function goRelativeDay(offset) {
  const days = state.guide.days;
  const idx = days.findIndex(d => d.day_id === state.currentDayId);
  if (idx < 0) return;
  const next = idx + offset;
  if (next < 0 || next >= days.length) return;
  state.currentDayId = days[next].day_id;
  renderAll();
}

function attachEvents() {
  el.daySelect.addEventListener("change", () => {
    state.currentDayId = el.daySelect.value;
    renderAll();
  });

  el.prevDayBtn.addEventListener("click", () => goRelativeDay(-1));
  el.nextDayBtn.addEventListener("click", () => goRelativeDay(1));

  el.tabs.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  el.chips.forEach(chip => {
    chip.addEventListener("click", () => {
      state.currentFilter = chip.dataset.filter;
      renderAll();
    });
  });

  el.refreshBtn.addEventListener("click", async () => {
    try {
      await loadGuide({ forceRefresh: true });
    } catch (err) {
      console.error(err);
      alert("Neu laden fehlgeschlagen.");
    }
  });

  window.addEventListener("hashchange", () => {
    const hashDay = location.hash.replace("#", "").trim();
    if (state.guide && state.guide.days.some(d => d.day_id === hashDay)) {
      state.currentDayId = hashDay;
      renderAll();
    }
  });
}

async function boot() {
  attachEvents();

  try {
    await loadGuide();
    if (!state.currentDayId && state.guide?.days?.length) {
      state.currentDayId = state.guide.days[0].day_id;
      renderAll();
    }
  } catch (err) {
    console.error(err);
    const cached = loadCachedGuide();
    if (cached) {
      state.guide = cached;
      state.usingCache = true;
      state.currentDayId = pickInitialDayId(cached);
      renderAll();
      return;
    }

    el.timeline.innerHTML = `
      <div class="empty-state">
        Daten konnten nicht geladen werden.<br>
        Bitte zuerst <code>python scripts/build_data.py</code> ausführen und dann über einen lokalen Webserver starten.
      </div>
    `;
  }
}

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
      console.log("Service Worker registriert.");
    } catch (err) {
      console.error("Service Worker Registrierung fehlgeschlagen:", err);
    }
  });
}

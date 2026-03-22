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
  hotelLayer: null,
  usingCache: false
};


const el = {
  tripMeta: document.getElementById("tripMeta"),
  refreshBtn: document.getElementById("refreshBtn"),
  daySelect: document.getElementById("daySelect"),
  prevDayBtn: document.getElementById("prevDayBtn"),
  nextDayBtn: document.getElementById("nextDayBtn"),
  todayBtn: document.getElementById("todayBtn"),
  zoomDayBtn: document.getElementById("zoomDayBtn"),
  hotelCenterBtn: document.getElementById("hotelCenterBtn"),
  mapPrevDayBtn: document.getElementById("mapPrevDayBtn"),
  mapNextDayBtn: document.getElementById("mapNextDayBtn"),
  dayTheme: document.getElementById("dayTheme"),
  dayStats: document.getElementById("dayStats"),
  timeline: document.getElementById("timeline"),
  hotelLink: document.getElementById("hotelLink"),
  cacheStatus: document.getElementById("cacheStatus"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: {
    plan: document.getElementById("planTab"),
    map: document.getElementById("mapTab"),
    info: document.getElementById("infoTab")
  },
  chips: [...document.querySelectorAll(".chip")]
};

function setMapHint(text) {
  const node = document.getElementById("mapHint");
  if (node) node.textContent = text;
}

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
    // ignore quota/private mode issues
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

  const response = await fetch(GUIDE_URL, {
    cache: forceRefresh ? "reload" : "default"
  });

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

function parseDateOnly(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function pickTodayOrNearestTripDayId(guide) {
  const sorted = [...guide.days].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const exact = sorted.find(day => day.date === today.toISOString().slice(0, 10));
  if (exact) return exact.day_id;

  const nextFuture = sorted.find(day => parseDateOnly(day.date) >= today);
  if (nextFuture) return nextFuture.day_id;

  return sorted[sorted.length - 1].day_id;
}

function pickInitialDayId(guide) {
  const urlHashDay = location.hash.replace("#", "").trim();
  if (urlHashDay && guide.days.some(d => d.day_id === urlHashDay)) {
    return urlHashDay;
  }

  return pickTodayOrNearestTripDayId(guide);
}

function setHashDay(dayId) {
  history.replaceState(null, "", `#${dayId}`);
}

function currentDay() {
  return state.guide?.days.find(d => d.day_id === state.currentDayId);
}

function getMappedItemsForDay(day) {
  return (day?.items || []).filter(item => item.place.has_coordinates);
}

function fitMapToDay(day) {
  if (!state.map || typeof window.L === "undefined") return;

  if (state.hotelLayer) {
    state.hotelLayer.clearLayers();
  }

  const mappedItems = getMappedItemsForDay(day);
  if (!mappedItems.length) {
    state.map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    setMapHint("Für diesen Tag sind keine Koordinaten vorhanden.");
    return;
  }

  const latlngs = mappedItems.map(item => [item.place.lat, item.place.lon]);
  const bounds = L.latLngBounds(latlngs);

  state.map.fitBounds(bounds.pad(0.2), {
    maxZoom: 15
  });

  setMapHint(`${mappedItems.length} Orte mit Koordinaten auf der Karte.`);
}

function showHotelMarker(hotel) {
  if (!state.map || !state.hotelLayer || !hotel || !hotel.has_coordinates) return;

  state.hotelLayer.clearLayers();

  const latlng = [hotel.lat, hotel.lon];

  const focusRing = L.circleMarker(latlng, {
    radius: 18,
    color: "#1565C0",
    weight: 3,
    fillColor: "#42A5F5",
    fillOpacity: 0.18
  });

  const marker = L.marker(latlng, {
    icon: createDivIcon("hotel", "H")
  });

  marker.bindPopup(`
    <div class="popup-title">${escapeHtml(hotel.name)}</div>
    <div class="popup-sub">${escapeHtml(hotel.area)} · Hotel</div>
    <div><a href="${escapeHtml(hotel.maps_url)}" target="_blank" rel="noopener">Google Maps öffnen</a></div>
  `);

  focusRing.addTo(state.hotelLayer);
  marker.addTo(state.hotelLayer);

  marker.openPopup();
}


function centerMapOnHotel() {
  const hotelPlaceId = state.guide?.trip?.hotel_place_id;
  const hotel = hotelPlaceId ? state.guide.places[hotelPlaceId] : null;

  if (!state.map || !hotel || !hotel.has_coordinates) {
    setMapHint("Hotel-Koordinaten sind nicht verfügbar.");
    return;
  }

  if (!state.hotelLayer && typeof window.L !== "undefined") {
    state.hotelLayer = L.layerGroup().addTo(state.map);
  }

  state.map.setView([hotel.lat, hotel.lon], 16);
  showHotelMarker(hotel);
  setMapHint(`Hotel zentriert: ${hotel.name}`);
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
  syncActiveControls();
  syncMapButtons();
  syncDayNavButtons();
  setHashDay(day.day_id);

  if (state.currentTab === "map") {
    ensureMap();
    renderMap(day);
  }
}

function renderHeader(trip) {
  if (el.tripMeta) {
    el.tripMeta.textContent = `${trip.start_date} bis ${trip.end_date} · ${state.guide.days.length} Tage`;
  }

  const hotel = state.guide.places[trip.hotel_place_id];
  if (hotel && el.hotelLink) {
    el.hotelLink.textContent = hotel.name;
    el.hotelLink.href = hotel.maps_url;
  }

  if (el.cacheStatus) {
    el.cacheStatus.textContent = state.usingCache
      ? "Daten aus lokalem Cache geladen"
      : `Live geladen · Stand ${new Date(trip.generated_at).toLocaleString("de-DE")}`;
  }
}

function renderDaySelect() {
  if (!el.daySelect) return;

  const days = state.guide.days;
  el.daySelect.innerHTML = days
    .map(day => `<option value="${escapeHtml(day.day_id)}">${escapeHtml(day.label)}</option>`)
    .join("");

  el.daySelect.value = state.currentDayId;
}

function renderThemeAndStats(day) {
  if (el.dayTheme) {
    el.dayTheme.innerHTML = `
      <div class="day-color-bar day-${escapeHtml(day.day_id)}"></div>
      ${escapeHtml(day.theme)}
    `;
  }

  const visibleItems = filterItems(day.items, state.currentFilter);
  const daughterCount = visibleItems.filter(i => i.with_daughter).length;
  const mustCount = visibleItems.filter(i => i.priority === "must").length;

  if (el.dayStats) {
    el.dayStats.innerHTML = `
      <span class="stat">${visibleItems.length} Stops</span>
      <span class="stat">${mustCount} Must</span>
      <span class="stat">${daughterCount} mit Tochter</span>
    `;
  }
}

function renderTimeline(day) {
  const items = filterItems(day.items, state.currentFilter);

  if (!el.timeline) return;

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

    const centerBtn = place.has_coordinates
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

  if (typeof window.L === "undefined") {
    console.error("Leaflet wurde nicht geladen. Prüfe /vendor/leaflet/leaflet.js");
    setMapHint("Leaflet JS wurde nicht geladen. Bitte Pfad /vendor/leaflet/leaflet.js prüfen.");
    return;
  }

  state.map = L.map("map", {
    zoomControl: true
  }).setView(FALLBACK_CENTER, FALLBACK_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap-Mitwirkende"
  }).addTo(state.map);

    state.markersLayer = L.layerGroup().addTo(state.map);
    state.routeLayer = L.layerGroup().addTo(state.map);
    state.hotelLayer = L.layerGroup().addTo(state.map);

}

function markerClassForType(type) {
  const classes = {
    hotel: "marker-hotel",
    sight: "marker-sight",
    walk: "marker-walk",
    breakfast: "marker-breakfast",
    lunch: "marker-lunch",
    dinner: "marker-dinner",
    coffee: "marker-coffee",
    ferry: "marker-ferry",
    view: "marker-view",
    hamam: "marker-hamam",
    transfer: "marker-transfer"
  };
  return classes[type] || "marker-sight";
}

function createDivIcon(type, label) {
  return L.divIcon({
    className: "custom-div-icon",
    html: `<div class="marker-bubble ${markerClassForType(type)}">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -12]
  });
}

function renderMap(day) {
  if (!state.map || !state.markersLayer || !state.routeLayer) return;

  state.markersLayer.clearLayers();
  state.routeLayer.clearLayers();
  if (state.hotelLayer) {
    state.hotelLayer.clearLayers();
  }

  const mappedItems = getMappedItemsForDay(day);

  if (!mappedItems.length) {
    state.map.setView(FALLBACK_CENTER, FALLBACK_ZOOM);
    setMapHint("Noch keine Koordinaten in places.csv gepflegt.");
    return;
  }

  mappedItems.forEach(item => {
    const p = item.place;
    const latlng = [p.lat, p.lon];

    const marker = L.marker(
      latlng,
      { icon: createDivIcon(p.type, String(item.seq)) }
    );

    marker.bindPopup(`
      <div class="popup-title">${escapeHtml(item.activity_title)}</div>
      <div class="popup-sub">${escapeHtml(p.name)} · ${escapeHtml(p.area)}</div>
      <div><a href="${escapeHtml(p.maps_url)}" target="_blank" rel="noopener">Google Maps öffnen</a></div>
    `);

    marker.addTo(state.markersLayer);
  });

  const routeLatLngs = mappedItems.map(item => [item.place.lat, item.place.lon]);

  if (routeLatLngs.length >= 2) {
    const poly = L.polyline(routeLatLngs, {
      color: day.color,
      weight: 4,
      opacity: 0.75
    });
    poly.addTo(state.routeLayer);
  }

  fitMapToDay(day);
}

function centerMapOnPlace(placeId) {
  const place = state.guide?.places[placeId];
  if (!place || !place.has_coordinates || !state.map) return;

  state.map.setView([place.lat, place.lon], 16);
}

function renderInfo(_trip) {
  // currently handled by static HTML + renderHeader
}

function switchTab(tabName) {
  state.currentTab = tabName;

  el.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  Object.entries(el.panels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === tabName);
  });

  if (tabName === "map") {
    ensureMap();

    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        const day = currentDay();
        if (day) {
          renderMap(day);
        }
      }
    }, 100);
  }
}

function syncActiveControls() {
  el.chips.forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === state.currentFilter);
  });
}

function syncMapButtons() {
  const day = currentDay();
  const hasDayCoords = !!getMappedItemsForDay(day).length;

  const hotelPlaceId = state.guide?.trip?.hotel_place_id;
  const hotel = hotelPlaceId ? state.guide.places[hotelPlaceId] : null;
  const hasHotelCoords = !!hotel?.has_coordinates;

  if (el.zoomDayBtn) {
    el.zoomDayBtn.disabled = !hasDayCoords;
  }

  if (el.hotelCenterBtn) {
    el.hotelCenterBtn.disabled = !hasHotelCoords;
    el.hotelCenterBtn.title = hasHotelCoords
      ? "Hotel auf der Karte zentrieren"
      : "Hotel-Koordinaten fehlen noch";
  }
}

function syncDayNavButtons() {
  const days = state.guide?.days || [];
  const idx = days.findIndex(d => d.day_id === state.currentDayId);

  const atStart = idx <= 0;
  const atEnd = idx < 0 || idx >= days.length - 1;

  if (el.prevDayBtn) el.prevDayBtn.disabled = atStart;
  if (el.nextDayBtn) el.nextDayBtn.disabled = atEnd;
  if (el.mapPrevDayBtn) el.mapPrevDayBtn.disabled = atStart;
  if (el.mapNextDayBtn) el.mapNextDayBtn.disabled = atEnd;
}

function goRelativeDay(offset) {
  const days = state.guide.days;
  const idx = days.findIndex(d => d.day_id === state.currentDayId);
  if (idx < 0) return;

  const next = idx + offset;
  if (next < 0 || next >= days.length) return;

  state.currentDayId = days[next].day_id;
  renderAll();

  if (state.currentTab === "map") {
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        const day = currentDay();
        if (day) renderMap(day);
      }
    }, 80);
  }
}

function attachEvents() {
  if (el.daySelect) {
    el.daySelect.addEventListener("change", () => {
      state.currentDayId = el.daySelect.value;
      renderAll();
    });
  }

  if (el.prevDayBtn) {
    el.prevDayBtn.addEventListener("click", () => goRelativeDay(-1));
  }

  if (el.nextDayBtn) {
    el.nextDayBtn.addEventListener("click", () => goRelativeDay(1));
  }

  if (el.todayBtn) {
    el.todayBtn.addEventListener("click", () => {
      const targetDayId = pickTodayOrNearestTripDayId(state.guide);
      if (!targetDayId) return;

      state.currentDayId = targetDayId;
      renderAll();
    });
  }

  if (el.zoomDayBtn) {
    el.zoomDayBtn.addEventListener("click", () => {
      ensureMap();
      const day = currentDay();
      if (!day) return;

      switchTab("map");
      setTimeout(() => {
        fitMapToDay(day);
      }, 120);
    });
  }

  if (el.hotelCenterBtn) {
    el.hotelCenterBtn.addEventListener("click", () => {
      ensureMap();
      switchTab("map");
      setTimeout(() => {
        centerMapOnHotel();
      }, 120);
    });
  }

  if (el.mapPrevDayBtn) {
    el.mapPrevDayBtn.addEventListener("click", () => {
      goRelativeDay(-1);
      switchTab("map");
    });
  }

  if (el.mapNextDayBtn) {
    el.mapNextDayBtn.addEventListener("click", () => {
      goRelativeDay(1);
      switchTab("map");
    });
  }

  el.tabs.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  el.chips.forEach(chip => {
    chip.addEventListener("click", () => {
      state.currentFilter = chip.dataset.filter;
      renderAll();
    });
  });

  if (el.refreshBtn) {
    el.refreshBtn.addEventListener("click", async () => {
      try {
        await loadGuide({ forceRefresh: true });
      } catch (err) {
        console.error(err);
        alert("Neu laden fehlgeschlagen.");
      }
    });
  }

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

    if (el.timeline) {
      el.timeline.innerHTML = `
        <div class="empty-state">
          Daten konnten nicht geladen werden.<br>
          Bitte zuerst <code>python scripts/build_data.py</code> ausführen und dann über einen lokalen Webserver starten.
        </div>
      `;
    }
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

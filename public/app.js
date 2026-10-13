/** Map page. Polls /api/snapshot, draws GeoJSON, and calls search and similar-work. */
const status = document.querySelector("#status");
const orderForm = document.querySelector("#order");
const fieldSelect = orderForm.querySelector("[name=fieldId]");
const guidanceSelect = orderForm.querySelector("[name=guidanceId]");
let map;
let snapshot;
let selectedVehicleId;
let fitted = false;
let fleetIconsReady = false;
let fleetIconsLoading = false;
let pendingMapData = null;
const fleetIconIds = new Set();

/** OEM values that have a cab or vehicle icon. Anything else keeps the circle marker. */
const FLEET_ICONS = {
  deere: "/icons/john-deere-8r.png",
  agco: "/icons/agco-rogator.png",
  raven: "/icons/raven-rcm.png",
  trimble: "/icons/trimble-gfx.png",
};

function loadFleetIcons(done) {
  const oems = Object.keys(FLEET_ICONS);
  let remaining = oems.length;
  for (const oem of oems) {
    const image = new Image();
    const finish = () => {
      remaining -= 1;
      if (remaining === 0) done();
    };
    image.onload = () => {
      if (!map.hasImage(oem)) {
        map.addImage(oem, image);
        fleetIconIds.add(oem);
      }
      finish();
    };
    image.onerror = finish;
    image.src = FLEET_ICONS[oem];
  }
}

function setStatus(message) {
  status.textContent = message;
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

function option(select, value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  select.append(node);
}

function fillForm(data) {
  if (fieldSelect.options.length > 0) return;
  for (const field of data.fields) option(fieldSelect, field.id, field.name);
  for (const operation of data.operations) option(orderForm.querySelector("[name=operationType]"), operation.name, operation.name);
  for (const vehicle of data.vehicles) option(orderForm.querySelector("[name=vehicleId]"), vehicle.id, `${vehicle.name} (${vehicle.oem})`);
  const south = data.fields.find((field) => field.name === "South Field");
  if (south) fieldSelect.value = south.id;
  orderForm.querySelector("[name=operationType]").value = "Spray";
  const deere = data.vehicles.find((vehicle) => vehicle.oem === "deere");
  if (deere) orderForm.querySelector("[name=vehicleId]").value = deere.id;
  filterGuidance();
  if (guidanceSelect.options.length > 1) guidanceSelect.selectedIndex = 1;
}

function filterGuidance() {
  const fieldId = fieldSelect.value;
  guidanceSelect.replaceChildren();
  option(guidanceSelect, "", "None");
  for (const line of snapshot.guidance) {
    if (line.fieldId === fieldId) option(guidanceSelect, line.id, line.name);
  }
}

function renderLists(data) {
  document.querySelector("#org").textContent = data.org.name;
  const chips = document.querySelector("#chips");
  chips.replaceChildren();
  for (const [label, value] of [["Search", data.search], ["Vector", data.vector]]) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${label} ${value}`;
    chips.append(chip);
  }

  const inside = document.querySelector("#inside");
  inside.replaceChildren();
  for (const field of data.fields) {
    const line = document.createElement("p");
    line.textContent = `${field.name}: ${field.machinesInside} machine${field.machinesInside === 1 ? "" : "s"} inside the boundary`;
    inside.append(line);
  }

  const fleet = document.querySelector("#fleet");
  fleet.replaceChildren();
  for (const row of data.fleet) {
    const stats = data.telemetry.find((item) => item.vehicleId === row.vehicleId);
    const tr = document.createElement("tr");
    for (const text of [row.name, `${row.speedKph.toFixed(1)} kph`, stats ? `${stats.avgSpeedKph.toFixed(1)} kph` : "—"]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tr.addEventListener("click", () => {
      selectedVehicleId = row.vehicleId;
      drawSpark(data);
    });
    fleet.append(tr);
  }

  const orders = document.querySelector("#orders");
  orders.replaceChildren();
  for (const workOrder of data.workOrders) {
    const block = document.createElement("div");
    const title = document.createElement("p");
    title.textContent = `${workOrder.name} · ${workOrder.status} · ${Math.round(workOrder.coveredFraction * 100)}%`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round(workOrder.coveredFraction * 100)}%`;
    bar.append(fill);
    block.append(title, bar);
    orders.append(block);
  }

  const sync = document.querySelector("#sync");
  sync.replaceChildren();
  for (const job of data.syncJobs.slice(0, 4)) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const vehicle = data.vehicles.find((item) => item.id === job.vehicleId);
    summary.textContent = `${vehicle ? vehicle.name : job.vehicleId}: API ${job.apiStatus}, cab ${job.cabStatus}`;
    const pre = document.createElement("pre");
    pre.textContent = job.isoXml;
    details.append(summary, pre);
    sync.append(details);
  }
  drawSpark(data);
}

function drawSpark(data) {
  const svg = document.querySelector("#spark");
  svg.replaceChildren();
  const vehicleId = selectedVehicleId || data.fleet[0]?.vehicleId;
  const series = data.telemetry.find((item) => item.vehicleId === vehicleId);
  if (!series || series.spark.length < 2) return;
  const speeds = series.spark.map((point) => point.speedKph);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const span = max - min || 1;
  const points = series.spark.map((point, index) => {
    const x = (index / (series.spark.length - 1)) * 200;
    const y = 36 - ((point.speedKph - min) / span) * 32;
    return `${x},${y}`;
  });
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#8fd18a");
  polyline.setAttribute("stroke-width", "2");
  polyline.setAttribute("points", points.join(" "));
  svg.append(polyline);
}

function geojson(features) {
  return { type: "FeatureCollection", features };
}

function renderMap(data) {
  if (!fleetIconsReady) {
    pendingMapData = data;
    if (!fleetIconsLoading) {
      fleetIconsLoading = true;
      loadFleetIcons(() => {
        fleetIconsReady = true;
        const latest = pendingMapData;
        pendingMapData = null;
        if (latest) renderMap(latest);
      });
    }
    return;
  }

  const fields = geojson(data.fields.map((field) => ({
    type: "Feature",
    properties: { name: field.name },
    geometry: field.extent,
  })));
  const zones = geojson(data.prescriptions.flatMap((rx) => rx.rxPolygons.map((zone) => ({
    type: "Feature",
    properties: { rate: zone.rate },
    geometry: zone.geometry,
  }))));
  const lines = geojson(data.guidance.map((line) => ({
    type: "Feature",
    properties: { name: line.name },
    geometry: line.geometry,
  })));
  const machines = geojson(data.fleet.map((row) => ({
    type: "Feature",
    properties: {
      id: row.vehicleId,
      name: row.name,
      color: row.color,
      speed: row.speedKph,
      icon: fleetIconIds.has(row.oem) ? row.oem : "",
    },
    geometry: row.location,
  })));

  if (!map.getSource("fields")) {
    map.addSource("fields", { type: "geojson", data: fields });
    map.addSource("zones", { type: "geojson", data: zones });
    map.addSource("lines", { type: "geojson", data: lines });
    map.addSource("machines", { type: "geojson", data: machines });
    map.addLayer({ id: "fields", type: "fill", source: "fields", paint: { "fill-color": "#245c32", "fill-opacity": 0.35 } });
    map.addLayer({ id: "fields-line", type: "line", source: "fields", paint: { "line-color": "#d5efe0", "line-width": 2 } });
    map.addLayer({ id: "zones", type: "fill", source: "zones", paint: { "fill-color": ["interpolate", ["linear"], ["get", "rate"], 8, "#f5e27a", 12, "#e07a3d"], "fill-opacity": 0.45 } });
    map.addLayer({ id: "lines", type: "line", source: "lines", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1] } });
    map.addLayer({
      id: "machines",
      type: "circle",
      source: "machines",
      filter: ["==", ["get", "icon"], ""],
      paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
    });
    map.addLayer({
      id: "machine-icons",
      type: "symbol",
      source: "machines",
      filter: ["!=", ["get", "icon"], ""],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 72 / 1024,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    const showMachine = (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      selectedVehicleId = feature.properties.id;
      const popup = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = feature.properties.name;
      const speed = document.createElement("div");
      speed.textContent = `${Number(feature.properties.speed).toFixed(1)} kph`;
      popup.append(title, speed);
      new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(popup).addTo(map);
      drawSpark(snapshot);
    };
    for (const layerId of ["machines", "machine-icons"]) {
      map.on("click", layerId, showMachine);
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  } else {
    map.getSource("fields").setData(fields);
    map.getSource("zones").setData(zones);
    map.getSource("lines").setData(lines);
    map.getSource("machines").setData(machines);
  }
  if (!fitted && data.fields.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    for (const field of data.fields) {
      for (const point of field.extent.coordinates[0]) bounds.extend(point);
    }
    map.fitBounds(bounds, { padding: 40 });
    fitted = true;
  }
}

async function refresh() {
  snapshot = await getJson("/api/snapshot");
  fillForm(snapshot);
  renderLists(snapshot);
  if (map?.loaded()) renderMap(snapshot);
}

fieldSelect.addEventListener("change", filterGuidance);
orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = orderForm.querySelector("button");
  button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(orderForm));
    const created = await getJson("/api/workorders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await getJson(`/api/workorders/${created.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vehicleId: payload.vehicleId }),
    });
    setStatus(`Sent ${created.name} to the display.`);
    await refresh();
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#search").addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = new FormData(event.target).get("q");
  try {
    const body = await getJson(`/api/search?q=${encodeURIComponent(q)}`);
    const list = document.querySelector("#search-results");
    list.replaceChildren();
    for (const result of body.results) {
      const item = document.createElement("li");
      item.textContent = `${result.name} (${result.operationType}) ${result.comments || ""}`.trim();
      list.append(item);
    }
    if (body.results.length === 0) setStatus("Search returned no work orders.");
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#similar").addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = new FormData(event.target).get("q");
  try {
    const body = await getJson(`/api/similar?q=${encodeURIComponent(q)}`);
    const list = document.querySelector("#similar-results");
    list.replaceChildren();
    for (const result of body.results) {
      const item = document.createElement("li");
      item.textContent = `${result.text} (${Number(result.score).toFixed(2)})`;
      list.append(item);
    }
    if (body.results.length === 0) setStatus("Vector search returned no notes.");
  } catch (error) {
    setStatus(error.message);
  }
});

map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-93.8075, 42.058],
  zoom: 13,
});
map.addControl(new maplibregl.NavigationControl(), "top-left");
map.on("load", () => {
  if (snapshot) renderMap(snapshot);
});

refresh().catch((error) => setStatus(error.message));
setInterval(() => {
  refresh().catch((error) => setStatus(error.message));
}, 2000);

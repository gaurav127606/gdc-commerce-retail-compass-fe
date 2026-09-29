/**
 * Store Locator block for the Adobe Commerce Boilerplate (EDS) storefront.
 *
 * This is a plain EDS "content block" (no Commerce drop-in involved) — it talks
 * directly to the Retail Compass App Builder actions, not to Adobe Commerce's GraphQL
 * API, since retailer data (address, structured hours, images) lives in Retail Compass,
 * not in Commerce itself.
 *
 * Usage in a Commerce Boilerplate document: add a block named "Store Locator" to a page.
 * It renders as a single "Find a store" trigger; clicking it opens a popup (reusing the
 * shared modal block) with a search/results list on the left and a Leaflet/OpenStreetMap
 * map with pins on the right. No block parameters are required — the actions base URL is
 * read from window.retailCompassConfig.actionsBaseUrl, set once in your storefront's
 * scripts/scripts.js (or a project config block) alongside other environment config.
 *
 * Replaces: Smile_StoreLocator's server-rendered search page + Knockout map widget.
 */

import { loadCSS, loadScript } from '../../scripts/aem.js';

const LEAFLET_VERSION = '1.9.4';
let leafletReady;

// Leaflet is loaded from a CDN on first use (buildless project — no npm dependency to add).
function ensureLeaflet() {
  if (!leafletReady) {
    leafletReady = Promise.all([
      loadCSS(`https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`),
      loadScript(`https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`),
    ]);
  }
  return leafletReady;
}

function getActionsBaseUrl() {
  return (
    (window.retailCompassConfig && window.retailCompassConfig.actionsBaseUrl) ||
    'https://<namespace>.adobeioruntime.net/api/v1/web/retail-compass'
  );
}

// "Currently selected store" persistence: localStorage first (fast, works before a cart
// exists), with the cart-level GraphQL attribute set separately by
// scripts/checkout-store-pickup.js once checkout starts. See docs/ARCHITECTURE.md for
// the full rationale (this mirrors, but modernizes, CustomerData/CurrentStore.php).
const STORAGE_KEY = 'retailCompass.selectedRetailerId';

function setSelectedRetailer(retailer) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: retailer.id, name: retailer.name }));
  document.dispatchEvent(new CustomEvent('retail-compass:store-selected', { detail: retailer }));
}

function getSelectedRetailer() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

async function geocode(address) {
  const res = await fetch(`${getActionsBaseUrl()}/map-geocode?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Geocoding failed');
  return res.json();
}

async function searchStores(lat, lng, radiusKm = 50) {
  const res = await fetch(`${getActionsBaseUrl()}/store-locator-search?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`);
  if (!res.ok) throw new Error((await res.json()).error || 'Store search failed');
  return res.json();
}

function formatTodayHours(retailer) {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const special = (retailer.specialHours || []).find((s) => s.date === iso);
  if (special) return special.closed ? 'Closed today (holiday hours)' : `${special.open}\u2013${special.close} (holiday hours)`;

  const weekly = (retailer.weeklyHours || []).find((w) => w.dayOfWeek === today.getDay());
  if (!weekly) return '';
  return weekly.closed ? 'Closed today' : `Open today ${weekly.open}\u2013${weekly.close}`;
}

function renderResults(container, stores, { onSelect, onHover }) {
  container.innerHTML = '';
  if (!stores.length) {
    container.innerHTML = '<p class="store-locator-empty">No stores found nearby.</p>';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'store-locator-results';

  stores.forEach((store) => {
    const item = document.createElement('li');
    item.className = 'store-locator-result';
    item.dataset.id = store.id;
    item.innerHTML = `
      <h3>${store.name}</h3>
      <p>${store.street}, ${store.city}${store.region ? `, ${store.region}` : ''} ${store.postcode}</p>
      <p class="store-locator-distance">${store.distanceKm} km away</p>
      <p class="store-locator-hours">${formatTodayHours(store)}</p>
      <button type="button" class="store-locator-select" data-id="${store.id}">Select this store</button>
    `;
    item.querySelector('.store-locator-select').addEventListener('click', () => onSelect(store));
    if (onHover) item.addEventListener('mouseenter', () => onHover(store));
    list.appendChild(item);
  });

  container.appendChild(list);
}

// Renders the search panel (form/status/banner/results) shared by the modal popup.
function renderSearchPanel({
  onSearch, onSelect, onHover, onClear,
}) {
  const panel = document.createElement('div');
  panel.className = 'store-locator-panel';

  const form = document.createElement('form');
  form.className = 'store-locator-form';
  form.innerHTML = `
    <input type="text" name="address" placeholder="Enter your address or postcode" required />
    <button type="submit">Find nearby stores</button>
  `;

  const status = document.createElement('p');
  status.className = 'store-locator-status';

  const selectedBanner = document.createElement('div');
  selectedBanner.className = 'store-locator-selected-banner';

  const results = document.createElement('div');
  results.className = 'store-locator-results-container';

  panel.append(form, status, selectedBanner, results);

  function renderSelectedBanner() {
    const selected = getSelectedRetailer();
    selectedBanner.innerHTML = selected
      ? `<p>Your selected store: <strong>${selected.name}</strong> <button type="button" class="store-locator-clear">Change</button></p>`
      : '';
    const clearBtn = selectedBanner.querySelector('.store-locator-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEY);
        renderSelectedBanner();
        if (onClear) onClear();
      });
    }
  }
  renderSelectedBanner();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const address = new FormData(form).get('address');
    status.textContent = 'Searching...';
    results.innerHTML = '';
    try {
      const { geo, retailers } = await onSearch(address);
      status.textContent = `${retailers.length} store(s) found near "${geo.formattedAddress}"`;
      renderResults(results, retailers, {
        onSelect: (store) => {
          setSelectedRetailer(store);
          renderSelectedBanner();
          status.textContent = `${store.name} selected as your store.`;
          onSelect(store);
        },
        onHover,
      });
    } catch (err) {
      status.textContent = err.message;
    }
  });

  return panel;
}

// Opens the store locator as a popup: search/results on the left, a Leaflet/OSM map with
// pins on the right. Map markers and the results list stay in sync via store.id.
async function openStoreLocatorModal() {
  const { default: createModal } = await import('../modal/modal.js');

  const mapPanel = document.createElement('div');
  mapPanel.className = 'store-locator-map-panel';
  const mapEl = document.createElement('div');
  mapEl.className = 'store-locator-map';
  mapPanel.append(mapEl);

  let map;
  let markers = [];

  function clearMarkers() {
    markers.forEach(({ marker }) => map.removeLayer(marker));
    markers = [];
  }

  function plotStores(retailers, center) {
    clearMarkers();
    // eslint-disable-next-line no-undef
    const bounds = L.latLngBounds([]);
    if (center) {
      // eslint-disable-next-line no-undef
      const userMarker = L.marker([center.lat, center.lng], { title: 'Your location' }).addTo(map);
      bounds.extend(userMarker.getLatLng());
    }
    retailers.forEach((store) => {
      // eslint-disable-next-line no-undef
      const marker = L.marker([store.lat, store.lng]).addTo(map)
        .bindPopup(`<strong>${store.name}</strong><br>${store.street}, ${store.city}<br>${store.distanceKm} km away`);
      markers.push({ id: store.id, marker });
      bounds.extend(marker.getLatLng());
    });
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.25));
  }

  function focusStore(store) {
    const found = markers.find((m) => m.id === store.id);
    if (found) {
      map.setView(found.marker.getLatLng(), 15);
      found.marker.openPopup();
    }
  }

  const panel = renderSearchPanel({
    onSearch: async (address) => {
      const geo = await geocode(address);
      const { retailers } = await searchStores(geo.lat, geo.lng, 100);
      plotStores(retailers, geo);
      return { geo, retailers };
    },
    onSelect: (store) => focusStore(store),
    onHover: (store) => focusStore(store),
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'store-locator-modal-content';
  wrapper.append(panel, mapPanel);

  const modal = await createModal([wrapper]);
  modal.block.classList.add('store-locator-modal');
  modal.showModal();

  await ensureLeaflet();
  // eslint-disable-next-line no-undef
  map = L.map(mapEl).setView([39.8283, -98.5795], 4);
  // eslint-disable-next-line no-undef
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
}

export default async function decorate(block) {
  block.innerHTML = '';
  block.classList.add('store-locator-trigger-block');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'store-locator-trigger';
  trigger.innerHTML = '<span class="store-locator-trigger-icon" aria-hidden="true">&#128205;</span> Find a store';
  trigger.addEventListener('click', () => openStoreLocatorModal());

  block.append(trigger);
}

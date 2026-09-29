/**
 * Store Locator block for the Adobe Commerce Boilerplate (EDS) storefront.
 *
 * This is a plain EDS "content block" (no Commerce drop-in involved) — it talks
 * directly to the Retail Compass App Builder actions, not to Adobe Commerce's GraphQL
 * API, since retailer data (address, structured hours, images) lives in Retail Compass,
 * not in Commerce itself.
 *
 * Usage in a Commerce Boilerplate document: add a block named "Store Locator" to a page.
 * No block parameters are required — the actions base URL is read from
 * window.retailCompassConfig.actionsBaseUrl, set once in your storefront's
 * scripts/scripts.js (or a project config block) alongside other environment config.
 *
 * Replaces: Smile_StoreLocator's server-rendered search page + Knockout map widget.
 */

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

function renderResults(container, stores, onSelect) {
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
    item.innerHTML = `
      <h3>${store.name}</h3>
      <p>${store.street}, ${store.city}${store.region ? `, ${store.region}` : ''} ${store.postcode}</p>
      <p class="store-locator-distance">${store.distanceKm} km away</p>
      <p class="store-locator-hours">${formatTodayHours(store)}</p>
      <button type="button" class="store-locator-select" data-id="${store.id}">Select this store</button>
    `;
    item.querySelector('.store-locator-select').addEventListener('click', () => onSelect(store));
    list.appendChild(item);
  });

  container.appendChild(list);
}

export default async function decorate(block) {
  block.innerHTML = '';
  block.classList.add('store-locator-block');

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

  block.append(form, status, selectedBanner, results);

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
      const geo = await geocode(address);
      const { retailers } = await searchStores(geo.lat, geo.lng, 100);
      status.textContent = `${retailers.length} store(s) found near "${geo.formattedAddress}"`;
      renderResults(results, retailers, (store) => {
        setSelectedRetailer(store);
        renderSelectedBanner();
        status.textContent = `${store.name} selected as your store.`;
      });
    } catch (err) {
      status.textContent = err.message;
    }
  });
}

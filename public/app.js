const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const statusEl = $('#status');
const resultsEl = $('#results');

let config = { epicAuthUrl: '#', devexRate: 0.0035, keys: {} };
let current = null; // last successful payload, kept for client-side filtering

/* ---------------- helpers ---------------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const nf = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function setStatus(kind, html) {
  if (!kind) return statusEl.classList.add('hidden');
  statusEl.className = `status ${kind}`;
  statusEl.innerHTML = html;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

/* ---------------- tabs ---------------- */

$$('.game').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.game').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    $$('.panel').forEach((p) =>
      p.classList.toggle('hidden', p.id !== `panel-${btn.dataset.game}`)
    );
    resultsEl.classList.add('hidden');
    setStatus(null);
  });
});

/* ---------------- lookups ---------------- */

async function runLookup(form, endpoint) {
  const submit = $('button[type=submit]', form);
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [k, v] of data.entries()) params.set(k, v);

  submit.disabled = true;
  resultsEl.classList.add('hidden');
  setStatus('loading', '<span class="spinner"></span>Looking that up…');

  try {
    const payload = await api(`${endpoint}?${params}`);
    render(payload);
  } catch (err) {
    setStatus('error', esc(err.message));
  } finally {
    submit.disabled = false;
  }
}

$$('form.lookup[data-endpoint]').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runLookup(form, form.dataset.endpoint);
  });
});

$('#locker-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const submit = $('button[type=submit]', form);
  const code = $('#epic-code').value.trim();

  submit.disabled = true;
  resultsEl.classList.add('hidden');
  setStatus('loading', '<span class="spinner"></span>Signing in with Epic and reading your locker…');

  try {
    const payload = await api('/api/fortnite/locker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    $('#epic-code').value = ''; // single-use — clear it so it can't be resubmitted
    render(payload);
  } catch (err) {
    setStatus('error', esc(err.message));
  } finally {
    submit.disabled = false;
  }
});

/* ---------------- rendering ---------------- */

function render(payload) {
  current = payload;
  setStatus(null);
  resultsEl.classList.remove('hidden');
  resultsEl.innerHTML =
    profileCard(payload) +
    tiles(payload.stats) +
    worthCard(payload.worth) +
    (payload.note ? `<p class="note">${esc(payload.note)}</p>` : '') +
    itemsSection(payload);

  wireFilters();
}

function profileCard(p) {
  const pr = p.profile ?? {};
  const created = pr.created
    ? `Joined ${new Date(pr.created).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })}`
    : '';
  const sub = [pr.username && pr.displayName !== pr.username ? `@${pr.username}` : '', created]
    .filter(Boolean)
    .join(' · ');

  return `
    <div class="profile-card">
      ${pr.avatar ? `<img class="avatar" src="${esc(pr.avatar)}" alt="" />` : ''}
      <div style="flex:1;min-width:200px">
        <h2>${esc(pr.displayName || pr.username || 'Account')}</h2>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        ${pr.banned ? `<div class="sub" style="color:var(--bad)">This account is banned</div>` : ''}
      </div>
      ${pr.link ? `<a class="ghost-btn" href="${esc(pr.link)}" target="_blank" rel="noopener">Open profile ↗</a>` : ''}
    </div>`;
}

function tiles(stats = []) {
  const cells = stats
    .map((s) => {
      const has = s.value !== null && s.value !== undefined && s.value !== '';
      const shown = typeof s.value === 'number' ? nf.format(s.value) : s.value;
      return `<div class="tile">
        <div class="k">${esc(s.label)}</div>
        <div class="v${has ? '' : ' dim'}">${has ? esc(shown) : 'Not public'}</div>
      </div>`;
    })
    .join('');
  return `<div class="tiles">${cells}</div>`;
}

function worthCard(w) {
  if (!w) return '';

  const isRobux = w.robux !== undefined;
  const primary = isRobux ? `R$ ${nf.format(Math.round(w.robux))}` : `${nf.format(w.vbucks)} V-Bucks`;

  const breakdown = (w.breakdown ?? [])
    .map((b) =>
      b.robux !== undefined
        ? `<span class="chip">${esc(b.label)} <b>R$ ${nf.format(Math.round(b.robux))}</b></span>`
        : `<span class="chip">${esc(b.label)} <b>${nf.format(b.count)}</b></span>`
    )
    .join('');

  return `
    <div class="worth">
      <div class="k">Estimated worth</div>
      <div class="big">${esc(primary)}</div>
      <div class="alt">≈ ${usd.format(w.usd)}${
        isRobux ? ` at the DevEx rate of ${usd.format(config.devexRate)} per Robux` : ' at retail'
      }</div>
      ${breakdown ? `<div class="breakdown">${breakdown}</div>` : ''}
      <div class="basis">Based on: ${esc(w.basis)}</div>
      ${w.caveat ? `<div class="caveat">${esc(w.caveat)}</div>` : ''}
    </div>`;
}

function itemsSection(p) {
  const items = p.items ?? [];
  if (!items.length) return '';

  const label = p.itemsLabel ?? 'Items';
  const types = [...new Set(items.map((i) => i.typeLabel).filter(Boolean))].sort();

  return `
    <div class="items-head">
      <h3>${esc(label)} <span class="chip">${nf.format(items.length)}</span></h3>
      <div class="filters">
        <input id="item-search" placeholder="Search ${esc(label.toLowerCase())}…" autocomplete="off" />
        ${
          types.length > 1
            ? `<select id="item-type">
                 <option value="">All types</option>
                 ${types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
               </select>`
            : ''
        }
        <select id="item-sort">
          <option value="value">Most valuable</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>
    </div>
    <div class="grid" id="item-grid">${items.map(itemCard).join('')}</div>`;
}

function itemCard(item) {
  // Roblox items carry `value` in Robux; Fortnite carries `vbucks`; Apex legends carry neither.
  const price =
    item.value !== undefined
      ? `R$ ${nf.format(item.value)}`
      : item.vbucks !== undefined
        ? item.vbucks > 0 ? `${nf.format(item.vbucks)} V-Bucks` : 'Not sold separately'
        : '';
  const zero = item.value === 0 || item.vbucks === 0;

  const flags = [
    item.projected ? '<span class="flag projected">Projected</span>' : '',
    item.rare ? '<span class="flag rare">Rare</span>' : '',
    item.serialNumber ? `<span class="flag serial">#${esc(item.serialNumber)}</span>` : '',
    item.neverInShop ? '<span class="flag rare">Never in shop</span>' : '',
    item.value !== undefined && !item.hasAssignedValue
      ? '<span class="flag norm">RAP only</span>'
      : '',
  ]
    .filter(Boolean)
    .join('');

  const meta = [item.typeLabel, item.rarityLabel, item.season ? `Ch. S${item.season}` : '', item.demand]
    .filter(Boolean)
    .join(' · ');

  const detail = (item.detail ?? []).join(' · ');
  const rarityClass = item.rarity ? ` rarity-${esc(String(item.rarity).toLowerCase())}` : '';
  const inner = `
    ${item.image ? `<img class="thumb" src="${esc(item.image)}" alt="" loading="lazy" />` : ''}
    <div class="body">
      <div class="name">${esc(item.name)}${item.acronym ? ` <span class="meta">(${esc(item.acronym)})</span>` : ''}</div>
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
      ${detail ? `<div class="meta">${esc(detail)}</div>` : ''}
      ${flags ? `<div class="flags">${flags}</div>` : ''}
      ${price ? `<div class="price${zero ? ' zero' : ''}">${esc(price)}</div>` : ''}
    </div>`;

  const attrs = `class="card${rarityClass}" data-name="${esc(String(item.name).toLowerCase())}" data-type="${esc(item.typeLabel ?? '')}"`;
  return item.link
    ? `<a ${attrs} href="${esc(item.link)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${inner}</a>`
    : `<div ${attrs}>${inner}</div>`;
}

function wireFilters() {
  const grid = $('#item-grid');
  if (!grid) return;

  const search = $('#item-search');
  const type = $('#item-type');
  const sort = $('#item-sort');

  const apply = () => {
    const q = (search?.value ?? '').trim().toLowerCase();
    const t = type?.value ?? '';
    let visible = 0;

    $$('.card', grid).forEach((card) => {
      const hit =
        (!q || card.dataset.name.includes(q)) && (!t || card.dataset.type === t);
      card.classList.toggle('hidden', !hit);
      if (hit) visible++;
    });

    let empty = $('.empty', grid.parentElement);
    if (!visible) {
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'empty';
        grid.after(empty);
      }
      empty.textContent = 'Nothing matches that filter.';
    } else if (empty) {
      empty.remove();
    }
  };

  const resort = () => {
    const items = [...current.items];
    if (sort.value === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      items.sort((a, b) => (b.value ?? b.vbucks ?? 0) - (a.value ?? a.vbucks ?? 0));
    }
    grid.innerHTML = items.map(itemCard).join('');
    apply();
  };

  search?.addEventListener('input', apply);
  type?.addEventListener('change', apply);
  sort?.addEventListener('change', resort);
}

/* ---------------- settings ---------------- */

const modal = $('#settings');
$('#settings-open').addEventListener('click', () => modal.classList.remove('hidden'));
$('#settings-close').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') modal.classList.add('hidden');
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#settings-msg');
  const patch = {};
  // Only send fields the user actually typed into — an empty box means
  // "leave whatever is already saved alone", not "clear it".
  for (const [k, v] of new FormData(e.target).entries()) {
    if (String(v).trim()) patch[k] = String(v).trim();
  }

  try {
    config.keys = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    msg.textContent = 'Saved.';
    msg.style.color = 'var(--good)';
    applyKeyState();
    setTimeout(() => modal.classList.add('hidden'), 700);
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = 'var(--bad)';
  }
});

function applyKeyState() {
  if (config.keys.trackerApiKey) $('#tracker-key').placeholder = 'Saved — type to replace';
  if (config.keys.fortniteApiKey) $('#fortnite-key').placeholder = 'Saved — type to replace';
}

/* ---------------- boot ---------------- */

api('/api/config')
  .then((c) => {
    config = c;
    $('#epic-link').href = c.epicAuthUrl;
    applyKeyState();
  })
  .catch(() => setStatus('error', 'Could not reach the VaultCheck server.'));

const RISKS = ['Very-High', 'High', 'Moderately-High', 'Moderate'];
const CHART_LIMIT = 15;

const $ = (sel) => document.querySelector(sel);

const riskEl = $('#risk');
const dateEl = $('#date');
const statsEl = $('#stats');

let catalog = { risks: [], dates: [] };
let stockDetail = [];
let currentCoverage = [];
let currentWeight = [];
let changesData = { fundChanges: [], stockMovers: [] };
let detailStock = null;

const panelState = {
    coverage: { sortKey: 'fundCount', sortDir: 'desc' },
    weight: { sortKey: 'avgWeight', sortDir: 'desc' },
};

const fetchJson = async (path) => {
    const res = await fetch(path);
    if (!res.ok) return null;
    return res.json();
};

const resultPath = (risk, date, file) => `results/${risk}/${file}-${date}.json`;

const formatPct = (n) => `${Number(n).toFixed(2)}%`;

const numVal = (v) => (v == null || v === '' ? 0 : Number(v));

const compareValues = (a, b, key, dir) => {
    let av = a[key];
    let bv = b[key];
    if (key === 'sector' || key === 'name') {
        av = (av || '').toLowerCase();
        bv = (bv || '').toLowerCase();
        const cmp = av.localeCompare(bv);
        return dir === 'asc' ? cmp : -cmp;
    }
    av = Number(av) || 0;
    bv = Number(bv) || 0;
    return dir === 'asc' ? av - bv : bv - av;
};

const sortRows = (rows, key, dir) => [...rows].sort((a, b) => compareValues(a, b, key, dir));

const getSectors = (rows) =>
    [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const populateSectorSelect = (selectId, rows) => {
    const el = $(selectId);
    const current = el.value;
    const sectors = getSectors(rows);
    el.innerHTML =
        '<option value="">All</option>' +
        sectors.map((s) => `<option value="${s}">${s}</option>`).join('');
    if (sectors.includes(current)) el.value = current;
};

const readCoverageFilters = () => ({
    query: $('#search-coverage').value.trim(),
    sector: $('#sector-coverage').value,
    minFunds: numVal($('#min-funds-coverage').value),
    minCoverage: numVal($('#min-coverage').value),
    minAvgWeight: numVal($('#min-weight-coverage').value),
});

const readWeightFilters = () => ({
    query: $('#search-weight').value.trim(),
    sector: $('#sector-weight').value,
    minFunds: numVal($('#min-funds-weight').value),
    minAvgWeight: numVal($('#min-weight-weight').value),
    minMaxWeight: numVal($('#min-max-weight').value),
});

const applyStockFilters = (rows, filters) => {
    return rows.filter((r) => {
        if (filters.sector && r.sector !== filters.sector) return false;
        if (filters.minFunds && r.fundCount < filters.minFunds) return false;
        if (filters.minCoverage && r.coveragePercent < filters.minCoverage) return false;
        if (filters.minAvgWeight && r.avgWeight < filters.minAvgWeight) return false;
        if (filters.minMaxWeight && r.maxWeight < filters.minMaxWeight) return false;
        if (filters.query) {
            const q = filters.query.toLowerCase();
            const match =
                r.name.toLowerCase().includes(q) ||
                (r.sector && r.sector.toLowerCase().includes(q));
            if (!match) return false;
        }
        return true;
    });
};

const updateSortHeaders = (panel) => {
    const { sortKey, sortDir } = panelState[panel];
    document.querySelectorAll(`th.sortable[data-panel="${panel}"]`).forEach((th) => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === sortKey) {
            th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
};

const renderStats = (log) => {
    if (!log) {
        statsEl.innerHTML = '';
        return;
    }
    const items = [
        { label: 'Funds analyzed', value: log.totalFiltered ?? '—' },
        { label: 'Holdings OK', value: log.holdingsFetched ?? '—' },
        { label: 'Fetch failed', value: log.holdingsFailed ?? '—' },
        { label: 'Comparison', value: log.comparisonStatus ?? '—' },
        { label: 'Duration', value: log.durationMs ? `${Math.round(log.durationMs / 1000)}s` : '—' },
    ];
    statsEl.innerHTML = items
        .map(
            (i) => `<div class="stat"><div class="stat-value">${i.value}</div><div class="stat-label">${i.label}</div></div>`
        )
        .join('');
};

const renderChart = (container, rows, valueKey, labelSuffix = '') => {
    if (!rows.length) {
        container.innerHTML = '<p class="empty">No stocks match filters</p>';
        return;
    }
    const top = rows.slice(0, CHART_LIMIT);
    const max = Math.max(...top.map((r) => r[valueKey]), 1);
    container.innerHTML = top
        .map((row) => {
            const val = row[valueKey];
            const display = valueKey === 'avgWeight' ? val.toFixed(2) : val;
            const pct = (val / max) * 100;
            return `<div class="bar-row">
        <span class="bar-label" title="${row.name}">${row.name}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-value">${display}${labelSuffix}</span>
      </div>`;
        })
        .join('');
};

const renderCoverageTable = (rows, total) => {
    $('#count-coverage').textContent = `Showing ${rows.length} of ${total}`;
    const tbody = $('#table-coverage');
    tbody.innerHTML = rows
        .map(
            (r, i) => `<tr data-name="${encodeURIComponent(r.name)}">
      <td class="num">${i + 1}</td>
      <td>${r.name}</td>
      <td>${r.sector || '—'}</td>
      <td class="num">${r.fundCount}</td>
      <td class="num">${formatPct(r.coveragePercent)}</td>
      <td class="num">${formatPct(r.avgWeight)}</td>
    </tr>`
        )
        .join('');
};

const renderWeightTable = (rows, total) => {
    $('#count-weight').textContent = `Showing ${rows.length} of ${total}`;
    const tbody = $('#table-weight');
    tbody.innerHTML = rows
        .map(
            (r, i) => `<tr data-name="${encodeURIComponent(r.name)}">
      <td class="num">${i + 1}</td>
      <td>${r.name}</td>
      <td>${r.sector || '—'}</td>
      <td class="num">${formatPct(r.avgWeight)}</td>
      <td class="num">${r.fundCount}</td>
      <td class="num">${formatPct(r.maxWeight)}</td>
      <td class="num">${formatPct(r.minWeight)}</td>
    </tr>`
        )
        .join('');
};

const applyCoveragePanel = () => {
    const filters = readCoverageFilters();
    const { sortKey, sortDir } = panelState.coverage;
    const filtered = applyStockFilters(currentCoverage, filters);
    const sorted = sortRows(filtered, sortKey, sortDir);
    updateSortHeaders('coverage');
    renderChart($('#chart-coverage'), sorted, 'fundCount', '');
    renderCoverageTable(sorted, currentCoverage.length);
};

const applyWeightPanel = () => {
    const filters = readWeightFilters();
    const { sortKey, sortDir } = panelState.weight;
    const filtered = applyStockFilters(currentWeight, filters);
    const sorted = sortRows(filtered, sortKey, sortDir);
    updateSortHeaders('weight');
    renderChart($('#chart-weight'), sorted, 'avgWeight', '%');
    renderWeightTable(sorted, currentWeight.length);
};

const resetPanelFilters = (panel) => {
    if (panel === 'coverage') {
        $('#search-coverage').value = '';
        $('#sector-coverage').value = '';
        $('#min-funds-coverage').value = '';
        $('#min-coverage').value = '';
        $('#min-weight-coverage').value = '';
        panelState.coverage = { sortKey: 'fundCount', sortDir: 'desc' };
        applyCoveragePanel();
    } else {
        $('#search-weight').value = '';
        $('#sector-weight').value = '';
        $('#min-funds-weight').value = '';
        $('#min-weight-weight').value = '';
        $('#min-max-weight').value = '';
        panelState.weight = { sortKey: 'avgWeight', sortDir: 'desc' };
        applyWeightPanel();
    }
};

const renderDetailFunds = () => {
    if (!detailStock) return;
    const query = $('#search-detail').value.trim().toLowerCase();
    const sortMode = $('#sort-detail').value;
    let funds = [...(detailStock.funds || [])];

    if (query) {
        funds = funds.filter((f) => f.fundName.toLowerCase().includes(query));
    }

    if (sortMode === 'weight-desc') funds.sort((a, b) => b.weight - a.weight);
    else if (sortMode === 'weight-asc') funds.sort((a, b) => a.weight - b.weight);
    else funds.sort((a, b) => a.fundName.localeCompare(b.fundName));

    $('#detail-funds').innerHTML = funds.length
        ? funds
              .map(
                  (f) => `<tr>
      <td>${f.fundName}</td>
      <td class="num">${formatPct(f.weight)}</td>
    </tr>`
              )
              .join('')
        : '<tr><td colspan="2">No funds match filter</td></tr>';
};

const showStockDetail = (name) => {
    const stock = stockDetail.find((s) => s.name === name);
    if (!stock) return;

    detailStock = stock;
    $('#search-detail').value = '';
    $('#sort-detail').value = 'weight-desc';

    $('#detail-title').textContent = stock.name;
    $('#detail-meta').textContent = `${stock.fundCount} funds · ${formatPct(stock.coveragePercent)} coverage · ${formatPct(stock.avgWeight)} avg weight · ${stock.sector || 'Unknown sector'}`;

    renderDetailFunds();
    $('#detail-dialog').showModal();
};

const changeCount = (f) =>
    (f.added?.length || 0) + (f.removed?.length || 0) + (f.weightChanged?.length || 0);

const renderChangesLists = () => {
    const query = $('#search-changes').value.trim().toLowerCase();
    const sortMode = $('#sort-changes').value;

    let fundChanges = [...changesData.fundChanges];
    let stockMovers = [...changesData.stockMovers];

    if (query) {
        fundChanges = fundChanges.filter((f) => f.fundName.toLowerCase().includes(query));
        stockMovers = stockMovers.filter((s) => s.name.toLowerCase().includes(query));
    }

    if (sortMode === 'changes-desc') {
        fundChanges.sort((a, b) => changeCount(b) - changeCount(a));
        stockMovers.sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
    } else if (sortMode === 'name-asc') {
        fundChanges.sort((a, b) => a.fundName.localeCompare(b.fundName));
        stockMovers.sort((a, b) => a.name.localeCompare(b.name));
    } else {
        fundChanges.sort((a, b) => b.fundName.localeCompare(a.fundName));
        stockMovers.sort((a, b) => b.name.localeCompare(a.name));
    }

    $('#count-fund-changes').textContent = fundChanges.length ? `(${fundChanges.length})` : '';
    $('#count-stock-changes').textContent = stockMovers.length ? `(${stockMovers.length})` : '';

    const fundList = $('#fund-changes-list');
    fundList.innerHTML = fundChanges.length
        ? fundChanges
              .map((f) => {
                  const parts = [];
                  if (f.added?.length) parts.push(`<span class="tag tag-new">+${f.added.length}</span>`);
                  if (f.removed?.length) parts.push(`<span class="tag tag-down">-${f.removed.length}</span>`);
                  if (f.weightChanged?.length) parts.push(`<span class="tag">~${f.weightChanged.length}</span>`);
                  return `<li>${parts.join('')} ${f.fundName}</li>`;
              })
              .join('')
        : '<li>No matching fund changes</li>';

    const stockList = $('#stock-changes-list');
    stockList.innerHTML = stockMovers.length
        ? stockMovers
              .map(
                  (s) =>
                      `<li><span class="tag tag-${s.type}">${s.label}</span> ${s.name}</li>`
              )
              .join('')
        : '<li>No matching stock movers</li>';
};

const renderChanges = async (risk, date) => {
    const fundChanges = await fetchJson(resultPath(risk, date, 'fund-changes'));
    const stockChanges = await fetchJson(resultPath(risk, date, 'stock-changes'));

    const empty = $('#changes-empty');
    const content = $('#changes-content');

    if (!fundChanges && !stockChanges) {
        empty.classList.remove('hidden');
        content.classList.add('hidden');
        changesData = { fundChanges: [], stockMovers: [] };
        return;
    }

    empty.classList.add('hidden');
    content.classList.remove('hidden');

    changesData.fundChanges = fundChanges?.fundChanges ?? [];
    changesData.stockMovers = [
        ...(stockChanges?.increasedCoverage ?? []).map((s) => ({
            ...s,
            type: 'up',
            label: `+${s.delta} funds`,
            delta: s.delta,
        })),
        ...(stockChanges?.decreasedCoverage ?? []).map((s) => ({
            ...s,
            type: 'down',
            label: `${s.delta} funds`,
            delta: s.delta,
        })),
        ...(stockChanges?.newStocks ?? []).map((s) => ({
            ...s,
            type: 'new',
            label: 'new',
            delta: 0,
        })),
    ];

    $('#search-changes').value = '';
    $('#sort-changes').value = 'changes-desc';
    renderChangesLists();
};

const loadData = async () => {
    const risk = riskEl.value;
    const date = dateEl.value;
    if (!risk || !date) return;

    const [coverage, weight, detail, log] = await Promise.all([
        fetchJson(resultPath(risk, date, 'stock-summary-by-coverage')),
        fetchJson(resultPath(risk, date, 'stock-summary-by-avg-weight')),
        fetchJson(resultPath(risk, date, 'stock-fund-detail')),
        fetchJson(resultPath(risk, date, 'run-log')),
    ]);

    currentCoverage = coverage || [];
    currentWeight = weight || [];
    stockDetail = detail || [];

    populateSectorSelect('#sector-coverage', currentCoverage);
    populateSectorSelect('#sector-weight', currentWeight);

    renderStats(log);
    applyCoveragePanel();
    applyWeightPanel();
    await renderChanges(risk, date);
};

const initSelectors = () => {
    riskEl.innerHTML = (catalog.risks.length ? catalog.risks : RISKS)
        .map((r) => `<option value="${r}">${r.replace(/-/g, ' ')}</option>`)
        .join('');

    dateEl.innerHTML = catalog.dates
        .map((d) => `<option value="${d}">${d}</option>`)
        .join('');

    if (!catalog.dates.length) {
        dateEl.innerHTML = '<option value="">No data — run npm start first</option>';
    }
};

const initTabs = () => {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            $(`#panel-${tab.dataset.tab}`).classList.add('active');
        });
    });
};

const bindEvents = () => {
    riskEl.addEventListener('change', loadData);
    dateEl.addEventListener('change', loadData);

    ['search-coverage', 'sector-coverage', 'min-funds-coverage', 'min-coverage', 'min-weight-coverage'].forEach(
        (id) => {
            const el = $(`#${id}`);
            el.addEventListener('input', applyCoveragePanel);
            el.addEventListener('change', applyCoveragePanel);
        }
    );

    ['search-weight', 'sector-weight', 'min-funds-weight', 'min-weight-weight', 'min-max-weight'].forEach(
        (id) => {
            const el = $(`#${id}`);
            el.addEventListener('input', applyWeightPanel);
            el.addEventListener('change', applyWeightPanel);
        }
    );

    document.querySelectorAll('.btn-reset').forEach((btn) => {
        btn.addEventListener('click', () => resetPanelFilters(btn.dataset.reset));
    });

    document.querySelectorAll('th.sortable').forEach((th) => {
        th.addEventListener('click', () => {
            const panel = th.dataset.panel;
            const key = th.dataset.sort;
            const state = panelState[panel];
            if (state.sortKey === key) {
                state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortKey = key;
                state.sortDir = key === 'name' || key === 'sector' ? 'asc' : 'desc';
            }
            if (panel === 'coverage') applyCoveragePanel();
            else applyWeightPanel();
        });
    });

    $('#search-changes').addEventListener('input', renderChangesLists);
    $('#sort-changes').addEventListener('change', renderChangesLists);

    $('#search-detail').addEventListener('input', renderDetailFunds);
    $('#sort-detail').addEventListener('change', renderDetailFunds);

    document.addEventListener('click', (e) => {
        const row = e.target.closest('tbody tr[data-name]');
        if (!row) return;
        showStockDetail(decodeURIComponent(row.dataset.name));
    });

    $('#detail-close').addEventListener('click', () => $('#detail-dialog').close());
};

const init = async () => {
    catalog = (await fetchJson('/api/catalog')) || { risks: RISKS, dates: [] };
    initSelectors();
    initTabs();
    bindEvents();
    if (catalog.dates.length) await loadData();
};

init();

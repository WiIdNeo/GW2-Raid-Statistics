// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const SUPABASE_URL = 'https://subabdcpfhusxvwowliw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h9eXb_whCGnkYgcsdV8HwA_oFOl86mp';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const COLORS = [
    '#ddb308','#8b2fc9','#50e090','#e05050',
    '#4ec9e0','#e07f30','#a0e040','#e040b0',
    '#40a0e0','#e0d040','#80e0a0','#c080e0',
    '#e0a0c0','#a0c0e0','#c0e0a0','#e0c0a0',
    '#90e0d0','#d090e0','#e0d090','#90d0e0'
];

let activeCharts = {};
let colorMap     = {};
let cachedData   = null;

// ════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════
async function openModal() {
    document.getElementById('modal').classList.add('open');
    await loadGroups();
}
function closeModal() {
    document.getElementById('modal').classList.remove('open');
}
function handleOverlayClick(e) {
    if (e.target === document.getElementById('modal')) closeModal();
}

// ════════════════════════════════════════════
// SCHRITT 1 — Gruppen laden
// ════════════════════════════════════════════
async function loadGroups() {
    const sel = document.getElementById('sel-group');
    if (sel.dataset.loaded) return;

    const { data, error } = await sb
        .from('logs').select('group_name').order('group_name');
    if (error) { console.error(error); return; }

    const groups = [...new Set(data.map(r => r.group_name))];
    sel.innerHTML = '<option value="">— Gruppe wählen —</option>';
    groups.forEach(g => {
        const o = document.createElement('option');
        o.value = o.textContent = g;
        sel.appendChild(o);
    });
    sel.dataset.loaded = '1';
    sel.addEventListener('change', () => onGroupChange(sel.value));
}

// ════════════════════════════════════════════
// SCHRITT 2 — Gruppe gewählt
// ════════════════════════════════════════════
async function onGroupChange(group) {
    resetEncounter();
    resetPhase();
    resetPlayerList('Wird geladen…');
    if (!group) return;

    const { data: logData } = await sb
        .from('logs').select('id, fight_name')
        .eq('group_name', group).order('fight_name');
    if (!logData) return;

    const selEnc = document.getElementById('sel-encounter');
    const fights = [...new Set(logData.map(r => r.fight_name))];
    selEnc.innerHTML = '<option value="">Alle Encounter</option>';
    fights.forEach(f => {
        const o = document.createElement('option');
        o.value = o.textContent = f;
        selEnc.appendChild(o);
    });
    selEnc.disabled = false;
    selEnc.addEventListener('change', () => onEncounterChange(group, selEnc.value));

    const logIds = logData.map(r => r.id);
    await loadPhases(logIds);
    await loadPlayers(logIds);
}

// ════════════════════════════════════════════
// SCHRITT 2b — Encounter gewählt
// ════════════════════════════════════════════
async function onEncounterChange(group, encounter) {
    resetPlayerList('Wird geladen…');
    resetPhase();

    let query = sb.from('logs').select('id').eq('group_name', group);
    if (encounter) query = query.eq('fight_name', encounter);
    const { data: logData } = await query;
    if (!logData) return;

    const logIds = logData.map(r => r.id);
    await loadPhases(logIds);
    await loadPlayers(logIds);
}

async function loadPhases(logIds) {
    const selPhase = document.getElementById('sel-phase');
    const { data } = await sb
        .from('phases').select('phase_index, name')
        .in('log_id', logIds).order('phase_index');

    selPhase.innerHTML = '';
    if (data && data.length) {
        const seen = {};
        data.forEach(p => { seen[p.phase_index] = p.name; });
        Object.entries(seen).forEach(([idx, name]) => {
            const o = document.createElement('option');
            o.value = idx;
            o.textContent = `Phase ${idx} — ${name}`;
            selPhase.appendChild(o);
        });
    } else {
        selPhase.innerHTML = '<option value="0">Phase 0 (Gesamt)</option>';
    }
    selPhase.disabled = false;
}

// ════════════════════════════════════════════
// Spieler-Checkliste
// ════════════════════════════════════════════
async function loadPlayers(logIds) {
    const { data, error } = await sb
        .from('players').select('account').in('log_id', logIds);
    if (error) { console.error(error); return; }

    const accounts = [...new Set(data.map(r => r.account))].sort();

    let colorIdx = Object.keys(colorMap).length;
    accounts.forEach(acc => {
        if (!colorMap[acc]) {
            colorMap[acc] = COLORS[colorIdx % COLORS.length];
            colorIdx++;
        }
    });

    renderPlayerChecklist(accounts);
}

function renderPlayerChecklist(accounts) {
    const cl = document.getElementById('player-checklist');
    if (!accounts.length) {
        cl.className = 'player-checklist empty';
        cl.innerHTML = 'Keine Spieler gefunden';
        return;
    }
    cl.className = 'player-checklist';
    cl.innerHTML = '';
    accounts.forEach(acc => {
        const label = document.createElement('label');
        label.className = 'player-check-item';
        label.innerHTML = `
            <input type="checkbox" value="${acc}" checked>
            <span class="player-dot" style="background:${colorMap[acc]}"></span>
            <span>${acc}</span>`;
        cl.appendChild(label);
    });
}

function toggleAllPlayers(on) {
    document.querySelectorAll('#player-checklist input[type="checkbox"]')
        .forEach(cb => cb.checked = on);
}

function getSelectedPlayers() {
    return [...document.querySelectorAll('#player-checklist input[type="checkbox"]:checked')]
        .map(cb => cb.value);
}

// ════════════════════════════════════════════
// FILTER ANWENDEN
// ════════════════════════════════════════════
async function applyFilter() {
    const group     = document.getElementById('sel-group').value;
    const encounter = document.getElementById('sel-encounter').value;
    const phase     = parseInt(document.getElementById('sel-phase').value) || 0;
    const selected  = getSelectedPlayers();

    if (!group)           { alert('Bitte eine Gruppe wählen.');              return; }
    if (!selected.length) { alert('Bitte mindestens einen Spieler wählen.'); return; }

    closeModal();
    setStatus('Lade Daten…<span class="spinner"></span>');

    try {
        let logQ = sb.from('logs')
            .select('id, fight_name, time_start, success')
            .eq('group_name', group)
            .order('time_start', { ascending: true });
        if (encounter) logQ = logQ.eq('fight_name', encounter);
        const { data: logs, error: logsErr } = await logQ;
        if (logsErr) throw logsErr;
        if (!logs.length) { setStatus('Keine Logs gefunden.'); return; }

        const logIds = logs.map(l => l.id);
        const labels = logs.map(l => {
            const d = new Date(l.time_start);
            return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
        });

        const { data: players, error: pErr } = await sb
            .from('players')
            .select('id, log_id, player_name, account, profession')
            .in('log_id', logIds);
        if (pErr) throw pErr;

        const playerIds = players.map(p => p.id);

        // ── Bosses für health_percent_burned ──────────────────
        const { data: bossData, error: bossErr } = await sb
            .from('bosses')
            .select('log_id, health_percent_burned')
            .in('log_id', logIds);
        if (bossErr) throw bossErr;

        const [dpsR, statR, supR, defR, mechR] = await Promise.all([
            sb.from('player_dps').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_stats').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_support').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_defenses').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('mechanics').select('*').in('log_id', logIds),
        ]);
        [dpsR, statR, supR, defR].forEach(r => { if (r.error) throw r.error; });

        const enrich = rows => players.map(p => ({
            ...p, stats: (rows || []).find(s => s.player_id === p.id) || {}
        }));

        cachedData = {
            logs, labels,
            withDps:   enrich(dpsR.data),
            withStat:  enrich(statR.data),
            withSup:   enrich(supR.data),
            withDef:   enrich(defR.data),
            allRows:   players,
            mechanics: mechR.data,
            bosses:    bossData || [],
        };

        renderDashboard(selected);
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('dashboard').style.display   = 'block';
        setStatus(`${group}${encounter ? ' · ' + encounter : ''} · Phase ${phase}`);

    } catch (err) {
        console.error(err);
        setStatus('Fehler: ' + err.message);
    }
}

// ════════════════════════════════════════════
// DASHBOARD RENDERN
// ════════════════════════════════════════════
function renderDashboard(sel) {
    if (!cachedData) return;
    const { logs, labels, withDps, withStat, withSup, withDef, allRows, mechanics, bosses } = cachedData;

    const ds = (enriched, fn) => sel.map(account => ({
        label: account,
        data: logs.map(log => {
            const p = enriched.find(p => p.log_id === log.id && p.account === account);
            return p ? fn(p) : null;
        }),
        borderColor:     colorMap[account] || '#aaa',
        backgroundColor: (colorMap[account] || '#aaa') + '33',
        tension: 0.3, spanGaps: true, pointRadius: 4,
    }));

    // ── DPS ───────────────────────────────────────────────────
    line('chart-dps',           labels, ds(withDps, p => p.stats.dps));
    line('chart-power-dps',     labels, ds(withDps, p => p.stats.power_dps));
    line('chart-condi-dps',     labels, ds(withDps, p => p.stats.condi_dps));
    line('chart-breakbar-dmg',  labels, ds(withDps, p => p.stats.breakbar_damage));

    // ── DEFENSES ──────────────────────────────────────────────
    line('chart-dmg-taken',         labels, ds(withDef, p => p.stats.damage_taken));
    line('chart-cc-count',          labels, ds(withDef, p => p.stats.received_crowd_control));
    line('chart-cc-duration',       labels, ds(withDef, p => p.stats.received_crowd_control_duration));
    line('chart-boon-strips-taken', labels, ds(withDef, p => p.stats.boon_strips));

    // ── SUPPORT ───────────────────────────────────────────────
    line('chart-rezzes',            labels, ds(withSup, p => p.stats.resurrects));
    line('chart-rez-time',          labels, ds(withSup, p => p.stats.resurrect_time));
    line('chart-cleanses',          labels, ds(withSup, p => p.stats.condi_cleanse));
    line('chart-boon-strips',       labels, ds(withSup, p => p.stats.boon_strips));

    // ── STATS ─────────────────────────────────────────────────
    line('chart-stack-dist',        labels, ds(withStat, p => p.stats.stack_dist));
    line('chart-comm-dist',         labels, ds(withStat, p => p.stats.dist_to_com));
    line('chart-flanking',          labels, ds(withStat, p => p.stats.flanking_rate));
    line('chart-downs',             labels, ds(withStat, p => p.stats.downed));
    line('chart-deaths',            labels, ds(withStat, p => p.stats.killed));
    line('chart-cast-uptime',       labels, ds(withStat, p => p.stats.skill_cast_uptime));
    line('chart-wasted',            labels, ds(withStat, p => p.stats.wasted));
    line('chart-time-wasted',       labels, ds(withStat, p => p.stats.time_wasted));
    line('chart-saved',             labels, ds(withStat, p => p.stats.saved));
    line('chart-time-saved',        labels, ds(withStat, p => p.stats.time_saved));
    line('chart-avg-boons',         labels, ds(withStat, p => p.stats.avg_active_boons));
    line('chart-avg-conditions',    labels, ds(withStat, p => p.stats.avg_active_conditions));

    // ── BOSS HEALTH ───────────────────────────────────────────
    buildBossHealthChart(bosses, logs, labels);

    // ── WIN / LOSS ────────────────────────────────────────────
    buildWinLossChart(logs);

    buildClassCharts(allRows, sel);
    buildMechanicCharts(mechanics, allRows, logs, labels, sel);
}

// ════════════════════════════════════════════
// BOSS HEALTH CHART
// ════════════════════════════════════════════
function buildBossHealthChart(bosses, logs, labels) {
    const data = logs.map(log => {
        const entries = bosses.filter(b => b.log_id === log.id);
        if (!entries.length) return null;

        const validEntries = entries.filter(b => b.health_percent_burned != null);
        if (!validEntries.length) return null;

        const minBurned = Math.min(...validEntries.map(b => b.health_percent_burned));
        return parseFloat((100 - minBurned).toFixed(2));
    });

    const el = document.getElementById('chart-boss-health');
    if (!el) return;
    if (activeCharts['boss-health']) activeCharts['boss-health'].destroy();
    activeCharts['boss-health'] = new Chart(el, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Verbleibende Boss-HP (%)',
                data,
                borderColor: '#e05050',
                backgroundColor: '#e0505033',
                tension: 0.3, spanGaps: true, pointRadius: 4, fill: true,
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: { ticks: { color: '#7a6a9a', font: { size: 11 } }, grid: { color: '#1a0337' } },
                y: {
                    ticks: { color: '#7a6a9a', callback: v => v + '%' },
                    grid: { color: '#1a0337' },
                    beginAtZero: true, max: 100,
                }
            },
            plugins: { legend: { labels: {
                color: '#e8d5ff', font: { family: 'Exo 2', size: 11 }, boxWidth: 12
            }}}
        }
    });
}

// ════════════════════════════════════════════
// WIN / LOSS DONUT
// ════════════════════════════════════════════
function buildWinLossChart(logs) {
    const wins  = logs.filter(l => l.success).length;
    const fails = logs.length - wins;
    const rate  = logs.length ? Math.round((wins / logs.length) * 100) : 0;

    const el = document.getElementById('chart-winloss');
    if (!el) return;
    if (activeCharts['winloss']) activeCharts['winloss'].destroy();

    const centerTextPlugin = {
        id: 'center-text',
        beforeDraw(chart) {
            const { ctx, chartArea: { top, bottom, left, right } } = chart;
            const cx = (left + right) / 2;
            const cy = (top + bottom) / 2;
            ctx.save();
            ctx.font = 'bold 28px Rajdhani';
            ctx.fillStyle = '#e8d5ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${rate}%`, cx, cy - 10);
            ctx.font = '13px Exo 2';
            ctx.fillStyle = '#7a6a9a';
            ctx.fillText(`${wins} / ${logs.length} Wins`, cx, cy + 18);
            ctx.restore();
        }
    };

    activeCharts['winloss'] = new Chart(el, {
        type: 'doughnut',
        data: {
            labels: ['Wins', 'Fails'],
            datasets: [{
                data: [wins, fails],
                backgroundColor: ['#50e090', '#e05050'],
                borderColor:     ['#0a0212'],
                borderWidth: 2,
            }]
        },
        options: {
            cutout: '70%',
            plugins: {
                legend: { labels: { color: '#e8d5ff', font: { family: 'Exo 2', size: 11 } } },
            }
        },
        plugins: [centerTextPlugin]
    });
}

// ════════════════════════════════════════════
// KLASSEN-PIE
// ════════════════════════════════════════════
function buildClassCharts(players, sel) {
    const grid = document.getElementById('class-charts-grid');
    grid.innerHTML = '';
    sel.forEach((account, i) => {
        const counts = {};
        players.filter(p => p.account === account)
               .forEach(p => { counts[p.profession] = (counts[p.profession] || 0) + 1; });

        const card = document.createElement('div');
        card.className = 'chart-card';
        card.innerHTML = `<h3>${account}</h3><canvas id="cc-${i}"></canvas>`;
        grid.appendChild(card);

        const key = `cls-${account}`;
        if (activeCharts[key]) activeCharts[key].destroy();
        activeCharts[key] = new Chart(document.getElementById(`cc-${i}`), {
            type: 'pie',
            data: {
                labels: Object.keys(counts),
                datasets: [{ data: Object.values(counts),
                    backgroundColor: COLORS, borderColor: '#0a0212', borderWidth: 2 }]
            },
            options: { plugins: { legend: { labels: {
                color: '#e8d5ff', font: { family: 'Exo 2', size: 11 }
            }}}}
        });
    });
}

// ════════════════════════════════════════════
// MECHANIK-BALKEN
// ════════════════════════════════════════════
function buildMechanicCharts(mechanics, players, logs, labels, sel) {
    const grid = document.getElementById('mechanic-charts-grid');
    grid.innerHTML = '';
    if (!mechanics?.length) return;

    const mechNames = [...new Set(mechanics.map(m => m.mechanic_name))];
    mechNames.forEach((mechName, mi) => {
        const datasets = sel.map(account => ({
            label: account,
            data: logs.map(log => {
                const charNames = players
                    .filter(p => p.log_id === log.id && p.account === account)
                    .map(p => p.player_name);
                return mechanics
                    .filter(m => m.log_id === log.id
                              && m.mechanic_name === mechName
                              && charNames.includes(m.actor))
                    .reduce((s, m) => s + m.hits, 0);
            }),
            backgroundColor: (colorMap[account] || '#aaa') + 'aa',
            borderColor:      colorMap[account] || '#aaa',
            borderWidth: 1,
        }));

        const card = document.createElement('div');
        card.className = 'chart-card';
        card.innerHTML = `<h3>${mechName}</h3><canvas id="mc-${mi}"></canvas>`;
        grid.appendChild(card);

        const key = `mech-${mechName}`;
        if (activeCharts[key]) activeCharts[key].destroy();
        activeCharts[key] = new Chart(document.getElementById(`mc-${mi}`), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                scales: {
                    x: { ticks: { color: '#7a6a9a' }, grid: { color: '#1a0337' } },
                    y: { ticks: { color: '#7a6a9a' }, grid: { color: '#1a0337' }, beginAtZero: true }
                },
                plugins: { legend: { labels: {
                    color: '#e8d5ff', font: { family: 'Exo 2', size: 11 }
                }}}
            }
        });
    });
}

// ════════════════════════════════════════════
// HILFSFUNKTIONEN
// ════════════════════════════════════════════
function line(id, labels, datasets) {
    const el = document.getElementById(id);
    if (!el) return;
    if (activeCharts[id]) activeCharts[id].destroy();
    activeCharts[id] = new Chart(el, {
        type: 'line', data: { labels, datasets },
        options: {
            responsive: true,
            scales: {
                x: { ticks: { color: '#7a6a9a', font: { size: 11 } }, grid: { color: '#1a0337' } },
                y: { ticks: { color: '#7a6a9a' }, grid: { color: '#1a0337' }, beginAtZero: true }
            },
            plugins: { legend: { labels: {
                color: '#e8d5ff', font: { family: 'Exo 2', size: 11 }, boxWidth: 12
            }}}
        }
    });
}

function resetEncounter() {
    const s = document.getElementById('sel-encounter');
    s.innerHTML = '<option value="">Alle Encounter</option>';
    s.disabled = true;
}
function resetPhase() {
    const s = document.getElementById('sel-phase');
    s.innerHTML = '<option value="0">Phase 0 (Gesamt)</option>';
    s.disabled = true;
}
function resetPlayerList(msg) {
    const cl = document.getElementById('player-checklist');
    cl.className = 'player-checklist empty';
    cl.innerHTML = msg;
}
function setStatus(html) {
    document.getElementById('status-indicator').innerHTML = html;
}
// ════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════
const SUPABASE_URL = 'https://subabdcpfhusxvwowliw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h9eXb_whCGnkYgcsdV8HwA_oFOl86mp';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let activeCharts = {};
let identityMap  = {};  // account → { display_name, color }
let cachedData   = null;

// ════════════════════════════════════════════
// IDENTITIES (einmalig laden)
// ════════════════════════════════════════════
async function loadIdentities() {
    if (Object.keys(identityMap).length) return;
    const { data, error } = await sb
        .from('player_identities')
        .select('account, display_name, color');
    if (error) { console.error('Identity load error:', error); return; }
    data.forEach(row => {
        identityMap[row.account] = {
            display_name: row.display_name,
            color: row.color || '#aaaaaa'
        };
    });
}

// account → display_name (Fallback: account selbst)
function displayName(account) {
    return identityMap[account]?.display_name ?? account;
}

// 20 distinkte Fallback-Farben
const FALLBACK_COLORS = [
    '#e05c5c', '#e0875c', '#e0b45c', '#d4e05c', '#8fe05c',
    '#5ce07a', '#5ce0b4', '#5cd4e0', '#5c8fe0', '#5c5ce0',
    '#875ce0', '#b45ce0', '#e05cd4', '#e05c8f', '#c0392b',
    '#27ae60', '#2980b9', '#8e44ad', '#f39c12', '#16a085'
];

function fallbackColor(display) {
    let hash = 0;
    for (let i = 0; i < display.length; i++) hash = display.charCodeAt(i) + ((hash << 5) - hash);
    return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// display_name → color (aus erstem bekannten Account)
function colorFor(display) {
    const entry = Object.values(identityMap).find(v => v.display_name === display);
    return entry?.color ?? fallbackColor(display);
}

// ════════════════════════════════════════════
// SUCCESS-FILTER
// ════════════════════════════════════════════
function getSuccessFilter() {
    const wins  = document.getElementById('cb-wins').checked;
    const fails = document.getElementById('cb-fails').checked;
    if (wins && fails) return null;   // beide → kein Filter nötig
    if (wins)          return true;
    if (fails)         return false;
    return null;
}

// ════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════
async function openModal() {
    document.getElementById('modal').classList.add('open');
    await loadIdentities();
    await loadGroups();
}
function closeModal() {
    document.getElementById('modal').classList.remove('open');
}
function handleOverlayClick(e) {
    if (e.target === document.getElementById('modal')) closeModal();
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
});

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
    sel.onchange = () => onGroupChange(sel.value);
}

// ════════════════════════════════════════════
// SCHRITT 2 — Gruppe gewählt
// ════════════════════════════════════════════
async function onGroupChange(group) {
    resetEncounter();
    resetPhase();
    resetPlayerList('Wird geladen…');
    if (!group) return;

    await loadIdentities();

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
    selEnc.onchange = () => onEncounterChange(group, selEnc.value);

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
        const seen = new Map();
        data.forEach(p => {
            if (!seen.has(p.phase_index)) seen.set(p.phase_index, p.name);
        });
        seen.forEach((name, idx) => {
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
// SPIELER — Account-basiert
// ════════════════════════════════════════════
async function loadPlayers(logIds) {
    const { data, error } = await sb
        .from('players').select('account').in('log_id', logIds);
    if (error) { console.error(error); return; }

    const displayNames = [
        ...new Set(data.map(r => displayName(r.account)))
    ].sort();

    renderPlayerChecklist(displayNames);
}

function renderPlayerChecklist(names) {
    const cl = document.getElementById('player-checklist');
    if (!names.length) {
        cl.className = 'player-checklist empty';
        cl.innerHTML = 'Keine Spieler gefunden';
        return;
    }
    cl.className = 'player-checklist';
    cl.innerHTML = '';
    names.forEach(name => {
        const color = colorFor(name);
        const label = document.createElement('label');
        label.className = 'player-check-item';
        label.innerHTML = `
            <input type="checkbox" value="${name}" checked>
            <span class="player-dot" style="background:${color}"></span>
            <span>${name}</span>`;
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
    const group         = document.getElementById('sel-group').value;
    const encounter     = document.getElementById('sel-encounter').value;
    const phase         = parseInt(document.getElementById('sel-phase').value) || 0;
    const selected      = getSelectedPlayers();
    const successFilter = getSuccessFilter();
    const winsChecked   = document.getElementById('cb-wins').checked;
    const failsChecked  = document.getElementById('cb-fails').checked;

    if (!group)                        { alert('Bitte eine Gruppe wählen.');              return; }
    if (!selected.length)              { alert('Bitte mindestens einen Spieler wählen.'); return; }
    if (!winsChecked && !failsChecked) { alert('Bitte Wins und/oder Fails aktivieren.');  return; }

    closeModal();
    setStatus('Lade Daten…<span class="spinner"></span>');

    try {
        await loadIdentities();

        // ── Alle Logs für Win/Loss-Diagramm (immer ohne success-Filter) ──
        let allLogsQ = sb.from('logs')
            .select('id, fight_name, time_start, success')
            .eq('group_name', group)
            .order('time_start', { ascending: true });
        if (encounter) allLogsQ = allLogsQ.eq('fight_name', encounter);
        const { data: allLogs, error: allLogsErr } = await allLogsQ;
        if (allLogsErr) throw allLogsErr;

        // ── Gefilterte Logs für alle anderen Charts ──
        let logQ = sb.from('logs')
            .select('id, fight_name, time_start, success')
            .eq('group_name', group)
            .order('time_start', { ascending: true });
        if (encounter)              logQ = logQ.eq('fight_name', encounter);
        if (successFilter !== null) logQ = logQ.eq('success', successFilter);
        const { data: logs, error: logsErr } = await logQ;
        if (logsErr) throw logsErr;
        if (!logs.length) { setStatus('Keine Logs für diesen Filter gefunden.'); return; }

        const logIds = logs.map(l => l.id);
        const labels = logs.map(l => {
            const d = new Date(l.time_start);
            return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
        });

        const { data: players, error: pErr } = await sb
            .from('players')
            .select('id, log_id, player_name, account, profession, group_nr')
            .in('log_id', logIds);
        if (pErr) throw pErr;

        const playersWithIdentity = players.map(p => ({
            ...p,
            display_name: displayName(p.account)
        }));

        const playerIds = players.map(p => p.id);

        const [dpsR, statR, supR, defR, mechR] = await Promise.all([
            sb.from('player_dps').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_stats').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_support').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('player_defenses').select('*').in('player_id', playerIds).eq('phase_index', phase),
            sb.from('mechanics').select('*').in('log_id', logIds),
        ]);
        [dpsR, statR, supR, defR].forEach(r => { if (r.error) throw r.error; });

        const enrich = rows => playersWithIdentity.map(p => ({
            ...p,
            stats: (rows || []).find(s => s.player_id === p.id) || {}
        }));

        cachedData = {
            logs, labels, allLogs,
            withDps:   enrich(dpsR.data),
            withStat:  enrich(statR.data),
            withSup:   enrich(supR.data),
            withDef:   enrich(defR.data),
            allRows:   playersWithIdentity,
            mechanics: mechR.data,
        };

        renderDashboard(selected);
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('dashboard').style.display   = 'block';

        const filterLabel = successFilter === true  ? ' · Nur Wins'
                          : successFilter === false ? ' · Nur Fails'
                          : '';
        setStatus(`${group}${encounter ? ' · ' + encounter : ''} · Phase ${phase}${filterLabel}`);

    } catch (err) {
        console.error(err);
        setStatus('Fehler: ' + err.message);
    }
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function renderDashboard(sel) {
    if (!cachedData) return;
    const { logs, labels, allLogs, withDps, withStat, withSup, withDef, allRows, mechanics } = cachedData;

    const ds = (enriched, fn) => sel.map(displayNameSel => ({
        label: displayNameSel,
        data: logs.map(log => {
            const entries = enriched.filter(
                p => p.log_id === log.id && p.display_name === displayNameSel
            );
            if (!entries.length) return null;
            const values = entries.map(p => fn(p)).filter(v => v != null);
            return values.length ? values.reduce((a, b) => a + b, 0) : null;
        }),
        borderColor:     colorFor(displayNameSel),
        backgroundColor: colorFor(displayNameSel) + '33',
        tension: 0.3, spanGaps: true, pointRadius: 4,
    }));

    line('chart-dps',         labels, ds(withDps,  p => p.stats.dps));
    line('chart-power-dps',   labels, ds(withDps,  p => p.stats.power_dps));
    line('chart-condi-dps',   labels, ds(withDps,  p => p.stats.condi_dps));
    line('chart-dmg-taken',   labels, ds(withDef,  p => p.stats.damage_taken));
    line('chart-cc-count',    labels, ds(withDef,  p => p.stats.received_crowd_control));
    line('chart-cc-duration', labels, ds(withDef,  p => p.stats.received_crowd_control_duration));
    line('chart-rezzes',      labels, ds(withSup,  p => p.stats.resurrects));
    line('chart-rez-time',    labels, ds(withSup,  p => p.stats.resurrect_time));
    line('chart-cleanses',    labels, ds(withSup,  p => p.stats.condi_cleanse));
    line('chart-boon-strips', labels, ds(withSup,  p => p.stats.boon_strips));
    line('chart-stack-dist',  labels, ds(withStat, p => p.stats.stack_dist));
    line('chart-comm-dist',   labels, ds(withStat, p => p.stats.dist_to_com));
    line('chart-flanking',    labels, ds(withStat, p => p.stats.flanking_rate));
    line('chart-downs',       labels, ds(withStat, p => p.stats.downed));
    line('chart-deaths',      labels, ds(withStat, p => p.stats.killed));
    line('chart-cast-uptime', labels, ds(withStat, p => p.stats.skill_cast_uptime));

    buildWinLossChart(allLogs);
    buildClassCharts(allRows, sel);
    buildMechanicCharts(mechanics, allRows, logs, labels, sel);
}

// ════════════════════════════════════════════
// WIN / LOSS — Doughnut, immer alle Logs
// ════════════════════════════════════════════
function buildWinLossChart(allLogs) {
    const wins  = allLogs.filter(l => l.success === true).length;
    const fails = allLogs.filter(l => l.success === false).length;
    const total = wins + fails;
    const pct   = total > 0 ? Math.round((wins / total) * 100) : 0;

    const el = document.getElementById('chart-winloss');
    if (!el) return;
    if (activeCharts['winloss']) activeCharts['winloss'].destroy();

    const centerTextPlugin = {
        id: 'centerText',
        afterDraw(chart) {
            const { ctx, chartArea: { width, height, left, top } } = chart;
            ctx.save();
            ctx.font = 'bold 28px Rajdhani, sans-serif';
            ctx.fillStyle = '#e8d5ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${pct}%`, left + width / 2, top + height / 2 - 10);
            ctx.font = '13px "Exo 2", sans-serif';
            ctx.fillStyle = '#7a6a9a';
            ctx.fillText('Win Rate', left + width / 2, top + height / 2 + 18);
            ctx.restore();
        }
    };

    activeCharts['winloss'] = new Chart(el, {
        type: 'doughnut',
        plugins: [centerTextPlugin],
        data: {
            labels: [`Wins (${wins})`, `Fails (${fails})`],
            datasets: [{
                data: [wins || 0, fails || 0],
                backgroundColor: ['#27ae6088', '#c0392b88'],
                borderColor:     ['#27ae60',   '#c0392b'],
                borderWidth: 2,
                hoverOffset: 6,
            }]
        },
        options: {
            cutout: '68%',
            plugins: {
                legend: { labels: { color: '#e8d5ff', font: { family: 'Exo 2', size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed;
                            const p   = total > 0 ? Math.round((val / total) * 100) : 0;
                            return ` ${val} Runs (${p}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ════════════════════════════════════════════
// KLASSEN-PIE
// ════════════════════════════════════════════
function buildClassCharts(players, sel) {
    const grid = document.getElementById('class-charts-grid');
    grid.innerHTML = '';
    sel.forEach((displayNameSel, i) => {
        const counts = {};
        players
            .filter(p => p.display_name === displayNameSel)
            .forEach(p => { counts[p.profession] = (counts[p.profession] || 0) + 1; });

        const card = document.createElement('div');
        card.className = 'chart-card';
        card.innerHTML = `<h3>${displayNameSel}</h3><canvas id="cc-${i}"></canvas>`;
        grid.appendChild(card);

        const key = `cls-${displayNameSel}`;
        if (activeCharts[key]) activeCharts[key].destroy();
        activeCharts[key] = new Chart(document.getElementById(`cc-${i}`), {
            type: 'pie',
            data: {
                labels: Object.keys(counts),
                datasets: [{ data: Object.values(counts),
                    backgroundColor: Object.keys(counts).map((_, idx) => {
                        const hue = (idx * 47) % 360;
                        return `hsl(${hue},65%,55%)`;
                    }),
                    borderColor: '#0a0212', borderWidth: 2 }]
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
        const datasets = sel.map(displayNameSel => ({
            label: displayNameSel,
            data: logs.map(log => {
                const accounts = players
                    .filter(p => p.log_id === log.id && p.display_name === displayNameSel)
                    .map(p => p.account);
                return mechanics
                    .filter(m =>
                        m.log_id === log.id &&
                        m.mechanic_name === mechName &&
                        accounts.includes(m.actor)
                    )
                    .reduce((s, m) => s + (m.hits ?? 0), 0);
            }),
            backgroundColor: colorFor(displayNameSel) + 'aa',
            borderColor:      colorFor(displayNameSel),
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
    s.onchange = null;
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
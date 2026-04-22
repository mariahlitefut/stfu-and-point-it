const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, '?'];

// ── State ──────────────────────────────────────────────────────────────────
let db;
let roomId, userId, userName, isHost;
let jiraConfig = null;
let storyPointsField = null;
let selectedTickets = [];
let selectedVote = null;
let selectedFinalPoints = null;
let currentTicket = null;

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  userId = crypto.randomUUID();

  const params = new URLSearchParams(location.search);
  const roomFromUrl = params.get('room');

  if (roomFromUrl) {
    roomId = roomFromUrl.toUpperCase();
    showScreen('screen-join');
  } else {
    showScreen('screen-jira');
  }

  document.getElementById('btn-connect-jira').addEventListener('click', handleConnectJira);
  document.getElementById('btn-search').addEventListener('click', handleSearch);
  document.getElementById('input-search').addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });
  document.getElementById('btn-start-session').addEventListener('click', handleStartSession);
  document.getElementById('btn-join').addEventListener('click', handleJoin);
  document.getElementById('btn-copy-link').addEventListener('click', copyInviteLink);
  document.getElementById('btn-reveal').addEventListener('click', handleReveal);
  document.getElementById('btn-reset').addEventListener('click', handleReset);
  document.getElementById('btn-save-points').addEventListener('click', handleSavePoints);
  document.getElementById('btn-end-session').addEventListener('click', handleEndSession);
  document.getElementById('ticket-select').addEventListener('change', handleTicketChange);

  buildPointCards();
});

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Jira Connect ───────────────────────────────────────────────────────────
async function handleConnectJira() {
  const domain = document.getElementById('input-jira-domain').value.trim().replace(/\/$/, '');
  const email = document.getElementById('input-jira-email').value.trim();
  const token = document.getElementById('input-jira-token').value.trim();
  const errEl = document.getElementById('jira-error');

  if (!domain || !email || !token) {
    errEl.textContent = 'All fields are required.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  const btn = document.getElementById('btn-connect-jira');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  jiraConfig = { domain, email, token };

  try {
    storyPointsField = await discoverStoryPointsField();
    showScreen('screen-tickets');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Connect Jira';
  }
}

// ── Ticket Search ──────────────────────────────────────────────────────────
async function handleSearch() {
  const query = document.getElementById('input-search').value.trim();
  const errEl = document.getElementById('search-error');
  const resultsEl = document.getElementById('search-results');

  if (!query) return;

  errEl.classList.add('hidden');
  resultsEl.innerHTML = '<p class="muted loading">Searching…</p>';

  try {
    const jql = query.match(/^[A-Z]+-\d+$/i)
      ? `key = "${query.toUpperCase()}"`
      : `text ~ "${query}" ORDER BY updated DESC`;

    const issues = await fetchJiraIssues(jql);

    if (!issues.length) {
      resultsEl.innerHTML = '<p class="muted">No results.</p>';
      return;
    }

    resultsEl.innerHTML = issues.map(i => {
      const alreadyAdded = selectedTickets.some(t => t.key === i.key);
      return `
        <div class="result-item ${alreadyAdded ? 'added' : ''}" data-key="${i.key}">
          <div class="result-info">
            <span class="ticket-key">${i.key}</span>
            <span class="result-summary">${escHtml(i.fields.summary)}</span>
          </div>
          <button class="btn-add ${alreadyAdded ? 'btn-added' : ''}" data-key="${i.key}" data-summary="${escHtml(i.fields.summary)}" data-description="${escHtml(adfToText(i.fields.description))}" ${alreadyAdded ? 'disabled' : ''}>
            ${alreadyAdded ? 'Added' : '+ Add'}
          </button>
        </div>
      `;
    }).join('');

    resultsEl.querySelectorAll('.btn-add:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => addTicket(btn.dataset.key, btn.dataset.summary, btn.dataset.description));
    });
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
  }
}

function addTicket(key, summary, description = '') {
  if (selectedTickets.some(t => t.key === key)) return;
  const url = `https://${jiraConfig.domain}/browse/${key}`;
  selectedTickets.push({ key, summary, description, url, points: null });
  renderSelectedTickets();
  updateStartButton();

  // Mark as added in results
  const btn = document.querySelector(`.btn-add[data-key="${key}"]`);
  if (btn) {
    btn.textContent = 'Added';
    btn.disabled = true;
    btn.classList.add('btn-added');
  }
}

function removeTicket(key) {
  selectedTickets = selectedTickets.filter(t => t.key !== key);
  renderSelectedTickets();
  updateStartButton();

  // Re-enable in results if visible
  const btn = document.querySelector(`.btn-add[data-key="${key}"]`);
  if (btn) {
    btn.textContent = '+ Add';
    btn.disabled = false;
    btn.classList.remove('btn-added');
  }
}

function renderSelectedTickets() {
  const el = document.getElementById('selected-tickets');
  document.getElementById('selected-count').textContent = selectedTickets.length;

  if (!selectedTickets.length) {
    el.innerHTML = '<p class="muted">Add tickets from the search.</p>';
    el.classList.add('empty-state');
    return;
  }

  el.classList.remove('empty-state');
  el.innerHTML = selectedTickets.map(t => `
    <div class="result-item">
      <div class="result-info">
        <span class="ticket-key">${t.key}</span>
        <span class="result-summary">${escHtml(t.summary)}</span>
      </div>
      <button class="btn-remove" data-key="${t.key}">✕</button>
    </div>
  `).join('');

  el.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => removeTicket(btn.dataset.key));
  });
}

function updateStartButton() {
  document.getElementById('btn-start-session').disabled = selectedTickets.length === 0;
}

// ── Start Session ──────────────────────────────────────────────────────────
async function handleStartSession() {
  const btn = document.getElementById('btn-start-session');
  btn.disabled = true;
  btn.textContent = 'Creating room…';

  roomId = generateRoomCode();
  isHost = true;

  const { error } = await db.from('rooms').insert({
    id: roomId,
    host_id: userId,
    current_ticket: selectedTickets[0],
    tickets: selectedTickets,
    revealed: false,
  });

  if (error) {
    alert('Could not create room: ' + error.message);
    btn.disabled = false;
    btn.textContent = 'Start Session →';
    return;
  }

  userName = 'Host';
  enterRoom();
}

// ── Join (teammates) ───────────────────────────────────────────────────────
async function handleJoin() {
  userName = document.getElementById('input-name').value.trim();
  if (!userName) return alert('Enter your name first.');

  const { data: room, error } = await db.from('rooms').select('*').eq('id', roomId).single();
  if (error || !room) return alert('Room not found. Ask the host for a new link.');

  isHost = false;
  enterRoom();
  syncRoomState(room);
}

async function enterRoom() {
  document.getElementById('room-code-display').textContent = roomId;
  if (isHost) document.getElementById('host-controls').classList.remove('hidden');
  subscribeToRoom();
  await upsertParticipant(null);
  await refreshVotes();
  updateUrl();
  showScreen('screen-room');

  if (isHost) {
    populateTicketSelect(selectedTickets);
    renderTicket(selectedTickets[0]);
  }
}

// ── Jira helpers ───────────────────────────────────────────────────────────
async function discoverStoryPointsField() {
  const data = await jiraFetch('/rest/api/3/field');
  const field = data.find(f => f.name.toLowerCase() === 'story points');
  if (!field) throw new Error('Could not find a "Story Points" field in your Jira instance.');
  return field.id;
}

async function fetchJiraIssues(jql) {
  const params = new URLSearchParams({ jql, maxResults: 30, fields: `summary,description,${storyPointsField}` });
  const data = await jiraFetch(`/rest/api/3/search/jql?${params}`);
  return data.issues ?? [];
}

function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.content) return node.content.map(adfToText).join('');
  return '';
}

async function jiraFetch(path, options = {}) {
  const { domain, email, token } = jiraConfig;
  const base64 = btoa(`${email}:${token}`);
  const res = await fetch(`${PROXY_URL}/proxy/${domain}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${base64}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Jira error ${res.status}: ${msg}`);
  }
  return res.json();
}

// ── Ticket select (host in room) ───────────────────────────────────────────
function populateTicketSelect(tickets) {
  const sel = document.getElementById('ticket-select');
  sel.innerHTML = tickets.map(t => `<option value="${t.key}">${t.key}</option>`).join('');
}

async function handleTicketChange() {
  const { data: room } = await db.from('rooms').select('tickets').eq('id', roomId).single();
  const key = document.getElementById('ticket-select').value;
  const ticket = room.tickets.find(t => t.key === key);
  await db.from('rooms').update({ current_ticket: ticket, revealed: false }).eq('id', roomId);
  await db.from('votes').update({ vote: null }).eq('room_id', roomId);
}

// ── Voting ─────────────────────────────────────────────────────────────────
function buildPointCards() {
  const container = document.getElementById('point-cards');
  container.innerHTML = FIBONACCI.map(v => `
    <div class="point-card" data-value="${v}">${v}</div>
  `).join('');
  container.querySelectorAll('.point-card').forEach(card => {
    card.addEventListener('click', () => selectCard(card));
  });
}

async function selectCard(card) {
  document.querySelectorAll('.point-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedVote = card.dataset.value;
  await upsertParticipant(selectedVote);
}

async function upsertParticipant(vote) {
  await db.from('votes').upsert({
    room_id: roomId,
    user_id: userId,
    user_name: userName,
    vote,
  }, { onConflict: 'room_id,user_id' });
}

// ── Reveal / Reset ─────────────────────────────────────────────────────────
async function handleReveal() {
  await db.from('rooms').update({ revealed: true }).eq('id', roomId);
}

async function handleReset() {
  await db.from('rooms').update({ revealed: false }).eq('id', roomId);
  await db.from('votes').update({ vote: null }).eq('room_id', roomId);
}

// ── Save to Jira ───────────────────────────────────────────────────────────
async function handleSavePoints() {
  if (!selectedFinalPoints || !currentTicket || !jiraConfig) return;
  const btn = document.getElementById('btn-save-points');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res = await fetch(`${PROXY_URL}/proxy/${jiraConfig.domain}/rest/api/3/issue/${currentTicket.key}`, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${btoa(`${jiraConfig.email}:${jiraConfig.token}`)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fields: { [storyPointsField]: Number(selectedFinalPoints) } }),
    });
    if (!res.ok) throw new Error(`Jira ${res.status}`);
    btn.textContent = '✓ Saved!';
    btn.style.background = 'var(--success)';
    btn.style.color = '#000';
  } catch (e) {
    alert('Failed to save: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Save to Jira';
  }
}

// ── End session ────────────────────────────────────────────────────────────
async function handleEndSession() {
  if (!confirm('End the session? This will delete the room for everyone.')) return;
  await db.from('rooms').delete().eq('id', roomId);
  location.href = location.pathname;
}

// ── Real-time subscription ─────────────────────────────────────────────────
function subscribeToRoom() {
  db
    .channel(`room-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, payload => {
      syncRoomState(payload.new);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: `room_id=eq.${roomId}` }, () => {
      refreshVotes();
    })
    .subscribe();
}

async function syncRoomState(room) {
  if (!room) return;
  currentTicket = room.current_ticket;
  renderTicket(currentTicket);

  if (isHost && room.tickets?.length) {
    populateTicketSelect(room.tickets);
    if (currentTicket) document.getElementById('ticket-select').value = currentTicket.key;
  }

  await refreshVotes(room.revealed);
}

async function refreshVotes(revealed) {
  const { data: votes } = await db.from('votes').select('*').eq('room_id', roomId);
  if (!votes) return;

  let isRevealed = revealed;
  if (isRevealed === undefined) {
    const { data: room } = await db.from('rooms').select('revealed').eq('id', roomId).single();
    isRevealed = room?.revealed ?? false;
  }

  // If our vote was cleared by a reset, clear local card selection
  const myVote = votes.find(v => v.user_id === userId);
  if (myVote && myVote.vote === null && selectedVote !== null) {
    selectedVote = null;
    selectedFinalPoints = null;
    document.querySelectorAll('.point-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('result-area').classList.add('hidden');
    document.getElementById('btn-save-points').classList.add('hidden');
  }

  renderVotes(votes, isRevealed);
  if (isRevealed && isHost) showResultPicker(votes);
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderTicket(ticket) {
  const el = document.getElementById('ticket-display');
  if (!ticket) {
    el.innerHTML = '<p class="muted">Waiting for host to pick a ticket…</p>';
    return;
  }
  const ticketUrl = ticket.url || (jiraConfig ? `https://${jiraConfig.domain}/browse/${ticket.key}` : null);
  el.innerHTML = `
    <div class="ticket-key">
      ${ticketUrl ? `<a href="${ticketUrl}" target="_blank" rel="noopener">${ticket.key}</a>` : ticket.key}
    </div>
    <div class="ticket-summary">${escHtml(ticket.summary)}</div>
    ${ticket.description ? `<div class="ticket-desc">${escHtml(ticket.description)}</div>` : ''}
    ${ticket.points != null ? `<div class="ticket-points">Current points: ${ticket.points}</div>` : ''}
  `;
}

function renderVotes(votes, revealed) {
  const list = document.getElementById('votes-list');
  list.innerHTML = votes.map(v => {
    const hasVoted = v.vote !== null;
    const showValue = revealed && hasVoted;
    return `
      <div class="vote-chip ${hasVoted ? 'voted' : ''}">
        <span class="voter-name">${escHtml(v.user_name)}</span>
        <span class="voter-value ${(!showValue && hasVoted) ? 'hidden-vote' : ''}">
          ${showValue ? v.vote : (hasVoted ? '' : '–')}
        </span>
      </div>
    `;
  }).join('');
}

function showResultPicker(votes) {
  const area = document.getElementById('result-area');
  const picker = document.getElementById('final-points-picker');
  area.classList.remove('hidden');
  document.getElementById('btn-save-points').classList.remove('hidden');

  picker.innerHTML = FIBONACCI.filter(v => v !== '?').map(v => `
    <button class="final-point-btn ${selectedFinalPoints == v ? 'selected' : ''}" data-value="${v}">${v}</button>
  `).join('');

  picker.querySelectorAll('.final-point-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.final-point-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedFinalPoints = btn.dataset.value;
    });
  });

  // Auto-select most common vote
  const numeric = votes.map(v => v.vote).filter(v => v && v !== '?');
  if (numeric.length) {
    const freq = {};
    numeric.forEach(v => freq[v] = (freq[v] || 0) + 1);
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
    selectedFinalPoints = top;
    picker.querySelector(`[data-value="${top}"]`)?.classList.add('selected');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  history.replaceState({}, '', url);
}

function copyInviteLink() {
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  navigator.clipboard.writeText(url.toString());
  const btn = document.getElementById('btn-copy-link');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy invite link', 2000);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

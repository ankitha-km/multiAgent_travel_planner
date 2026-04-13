/* ================================================
   WANDR — app.js
   Phase 4: Claude API connection + all logic

   TABLE OF CONTENTS:
   1.  Your API Key
   2.  Constants & config
   3.  Tab switching
   4.  Agent status helpers
   5.  Thinking bar helpers
   6.  The Claude API caller
   7.  JSON extractor (robust parser)
   8.  Currency formatter
   9.  HTML escape helper
   10. Plan Trip — main function
   11. System prompt for planning
   12. Render Plan results
   13. Render the map
   14. Compare Trips — main function
   15. System prompt for comparing
   16. Render Compare results
   17. Follow-up question helper
================================================ */





/* ------------------------------------------------
   2. CONSTANTS & CONFIG
------------------------------------------------ */

// The AI model we're using

// Colors for map markers — one per day
const DAY_COLORS = [
  '#2563eb', '#16a34a', '#d97706',
  '#9333ea', '#0891b2', '#be123c',
  '#059669', '#7c3aed'
];

// Leaflet map instance — stored so we can remove/recreate it
let mapInstance = null;


/* ------------------------------------------------
   3. TAB SWITCHING
   Shows/hides the Plan or Compare tab panel
------------------------------------------------ */
function switchTab(tab) {
  // Get both panels and both buttons
  const planPanel   = document.getElementById('tab-plan');
  const cmpPanel    = document.getElementById('tab-compare');
  const planBtn     = document.getElementById('tab-plan-btn');
  const cmpBtn      = document.getElementById('tab-cmp-btn');

  if (tab === 'plan') {
    planPanel.classList.remove('hidden');
    cmpPanel.classList.add('hidden');
    planBtn.classList.add('active');
    cmpBtn.classList.remove('active');
  } else {
    cmpPanel.classList.remove('hidden');
    planPanel.classList.add('hidden');
    cmpBtn.classList.add('active');
    planBtn.classList.remove('active');
  }
}


/* ------------------------------------------------
   4. AGENT STATUS HELPERS
   Each agent card can be: '' | 'running' | 'done' | 'error'
------------------------------------------------ */

// Set a single agent's state and status text
function setAgent(index, state, statusText) {
  const card   = document.getElementById('agent-' + index);
  const status = document.getElementById('agent-' + index + '-status');

  if (!card || !status) return;

  // Remove all state classes, then add the new one
  card.classList.remove('running', 'done', 'error');
  if (state) card.classList.add(state);

  status.textContent = statusText;
}

// Reset all 5 agents to their default waiting state
function resetAgents() {
  for (let i = 0; i < 5; i++) {
    setAgent(i, '', 'Waiting');
  }
}

// Mark agents 0-3 as done (sub-agents), leave coordinator
function markSubAgentsDone() {
  for (let i = 0; i < 4; i++) {
    setAgent(i, 'done', 'Done');
  }
}


/* ------------------------------------------------
   5. THINKING BAR HELPERS
   The animated dots shown while AI works
------------------------------------------------ */
function showThinking(elementId, message) {
  const el  = document.getElementById(elementId);
  const msg = document.getElementById(elementId + '-msg');
  if (!el) return;
  el.classList.add('visible');
  el.classList.remove('hidden');
  if (msg) msg.textContent = message;
}

function hideThinking(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.remove('visible');
  el.classList.add('hidden');
}


/* ------------------------------------------------
   6. THE CLAUDE API CALLER
   This is the core function that talks to Claude.

   How it works:
   - Takes a system prompt (Claude's instructions)
   - Takes a user message (the trip details)
   - Sends both to the API
   - Returns Claude's text response
------------------------------------------------ */
async function callClaude(systemPrompt, userMessage, maxTokens) {

  // Build headers based on which provider you're using
  const headers = { 'Content-Type': 'application/json' };

  if (CONFIG.PROVIDER === 'groq') {
    headers['Authorization'] = 'Bearer ' + CONFIG.API_KEY;
  } else {
    headers['x-api-key']         = CONFIG.API_KEY;
    headers['anthropic-version'] = '2023-06-01';
  }

  // Build body based on provider format
  const bodyObj = CONFIG.PROVIDER === 'groq'
    ? {
        model:      CONFIG.MODEL,
        max_tokens: maxTokens || 2500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ]
      }
    : {
        model:      CONFIG.MODEL,
        max_tokens: maxTokens || 2500,
        system:     systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      };

  const response = await fetch(CONFIG.API_URL, {
    method:  'POST',
    headers: headers,
    body:    JSON.stringify(bodyObj)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error('API error ' + response.status + ': ' + err.slice(0, 300));
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'API error');

  // Parse response — format differs by provider
  if (CONFIG.PROVIDER === 'groq') {
    return data.choices && data.choices[0]
      ? data.choices[0].message.content
      : '';
  } else {
    const block = data.content && data.content.find(b => b.type === 'text');
    return block ? block.text : '';
  }
}

  


/* ------------------------------------------------
   7. JSON EXTRACTOR
   Claude wraps JSON in ```json ... ``` fences
   sometimes, or adds explanation text.
   This function finds the JSON object reliably
   by counting { and } braces.
------------------------------------------------ */
function extractJSON(rawText) {
  // Step 1: Strip any markdown code fences
  let cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Step 2: Find the first opening brace
  const startIndex = cleaned.indexOf('{');
  if (startIndex === -1) {
    throw new Error('No JSON object found in response');
  }

  // Step 3: Walk character by character, tracking depth
  // We skip braces inside strings so "{ nested }" doesn't confuse us
  let depth     = 0;
  let inString  = false;
  let escaped   = false;
  let endIndex  = -1;

  for (let i = startIndex; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('Could not find end of JSON object — unmatched braces');
  }

  // Step 4: Parse only the JSON portion
  const jsonString = cleaned.slice(startIndex, endIndex + 1);
  return JSON.parse(jsonString);
}


/* ------------------------------------------------
   8. CURRENCY FORMATTER
   Turns 25000 + 'INR' into '₹25,000'
------------------------------------------------ */
function formatMoney(amount, currency) {
  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    return '—';
  }

  const symbols = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£'
  };

  const symbol = symbols[currency] || currency + ' ';
  return symbol + Math.round(Number(amount)).toLocaleString();
}


/* ------------------------------------------------
   9. HTML ESCAPE HELPER
   Prevents user input from breaking the HTML
   e.g. if someone types <script> in a field
------------------------------------------------ */
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}


/* ------------------------------------------------
   10. PLAN TRIP — MAIN FUNCTION
   Called when user clicks "Plan my trip"
   This orchestrates the whole flow:
   1. Read form values
   2. Validate
   3. Animate agents
   4. Call Claude
   5. Render results
------------------------------------------------ */
async function planTrip() {
  // --- Read all form values ---
  const from       = document.getElementById('from').value.trim();
  const to         = document.getElementById('to').value.trim();
  const days       = document.getElementById('days').value;
  const currency   = document.getElementById('currency').value;
  const budget     = document.getElementById('budget').value;
  const style      = document.getElementById('style').value;
  const travellers = document.getElementById('travellers').value || '1';
  const prefs      = document.getElementById('prefs').value.trim();

  // --- Validate required fields ---
  if (!from || !to || !days || !budget) {
    alert('Please fill in: From, Destination, Days, and Budget.');
    return;
  }

  // --- Disable button so user can't double-click ---
  const btn = document.getElementById('plan-btn');
  btn.disabled = true;
  btn.textContent = 'Planning your trip...';

  // --- Show the agents panel and thinking bar ---
  document.getElementById('agents-panel').classList.add('visible');
  showThinking('thinking', 'Coordinator building your full plan...');
  document.getElementById('plan-result').innerHTML = '';

  // --- Reset all agents to waiting ---
  resetAgents();

  // --- Animate agents turning on one by one ---
  // This gives visual feedback while Claude thinks
  const agentLabels = [
    'Searching routes...',
    'Checking hotels...',
    'Finding restaurants...',
    'Building days...',
    'Synthesizing...'
  ];

  const delays = [0, 400, 800, 1200, 2000];
  delays.forEach((delay, i) => {
    setTimeout(() => setAgent(i, 'running', agentLabels[i]), delay);
  });

  // --- Build the user message ---
  const userMessage = [
    'Plan this trip:',
    'From: ' + from,
    'To: ' + to,
    'Days: ' + days,
    'Travellers: ' + travellers,
    'Budget: ' + currency + ' ' + parseInt(budget).toLocaleString(),
    'Style: ' + style,
    prefs ? 'Special notes: ' + prefs : '',
    '',
    'Use ' + currency + ' for ALL prices.',
    'Output ONLY the JSON object. No other text.'
  ].filter(Boolean).join('\n');

  try {
    // --- Call Claude ---
    const rawResponse = await callClaude(PLAN_SYSTEM_PROMPT, userMessage, 2800);

    // --- Parse the JSON ---
    let plan;
    try {
      plan = extractJSON(rawResponse);
    } catch (parseError) {
      // Show the raw response so user can see what went wrong
      markSubAgentsDone();
      setAgent(4, 'error', 'Parse error');
      hideThinking('thinking');

      document.getElementById('plan-result').innerHTML =
        '<div class="error-box">' +
          '<strong>Parse error</strong> — the AI response could not be read as JSON. ' +
          'Please try again.<br><br>' +
          'Error detail: ' + escapeHTML(parseError.message) +
          '<div class="error-raw">' + escapeHTML(rawResponse.slice(0, 1500)) + '</div>' +
        '</div>';

      btn.disabled = false;
      btn.textContent = '✦ Plan my trip — free & instant';
      return;
    }

    // --- Attach the budget and currency to the plan object ---
    plan.budget   = parseFloat(budget);
    plan.currency = currency;

    // --- Mark all agents as done ---
    for (let i = 0; i < 5; i++) setAgent(i, 'done', 'Done');
    hideThinking('thinking');

    // --- Render the results ---
    renderPlan(plan, from, to, days, travellers, currency);

  } catch (networkError) {
    // Network error or API error
    markSubAgentsDone();
    setAgent(4, 'error', 'Error');
    hideThinking('thinking');

    document.getElementById('plan-result').innerHTML =
      '<div class="error-box">' +
        '<strong>Connection error</strong><br>' +
        escapeHTML(networkError.message) +
        '<br><br>Check your API key is correct and you have internet access.' +
      '</div>';
  }

  // --- Re-enable the button ---
  btn.disabled = false;
  btn.textContent = '✦ Plan my trip — free & instant';
}


/* ------------------------------------------------
   11. SYSTEM PROMPT FOR PLANNING
   This is the full instruction set we give Claude.
   It defines exactly what JSON to return.
------------------------------------------------ */
const PLAN_SYSTEM_PROMPT = `You are a Trip Planning Coordinator Agent running 4 specialist sub-agents.
Return ONLY a single valid JSON object. Zero text outside the JSON. No markdown fences.

JSON schema (every field required):
{
  "status": "ok" | "over_budget" | "options",
  "agents": {
    "travel":    "2-3 sentences: realistic travel options with prices",
    "stay":      "2-3 sentences: accommodation with nightly rates",
    "food":      "2-3 sentences: restaurant names and daily cost",
    "itinerary": "2-3 sentences: places and activity overview"
  },
  "plan": {
    "travel":          "Onward + return: mode, provider/train name, duration, cost breakdown",
    "stay":            "Hotel/hostel name, area, per-night rate, total nights x rate",
    "food":            "Named restaurants per category (breakfast/lunch/dinner) + per-day estimate",
    "itinerary":       "Day 1 - Morning: ...\\nAfternoon: ...\\nEvening: ...\\nDay 2 - ...",
    "local_transport": "Auto/metro/cab estimate, daily cost, total",
    "tips":            "Season and weather, safety advice, visa if international, currency tip if abroad, 2 packing tips"
  },
  "costs": {
    "travel": 0,
    "stay": 0,
    "food": 0,
    "activities": 0,
    "local_transport": 0,
    "total": 0
  },
  "budget": 0,
  "recommendation": "3-4 sentence honest final recommendation with one actionable tip",
  "option_a": null,
  "option_b": null,
  "map_markers": [
    { "day": 1, "place": "Exact attraction name", "lat": 0.0, "lng": 0.0, "note": "Main activity" }
  ]
}

map_markers rules:
- One marker per day of the trip
- lat/lng MUST be accurate real-world GPS coordinates for a real attraction in the destination
- NEVER use 0,0 or made-up coordinates
- Example: {"day":1,"place":"Hadimba Devi Temple","lat":32.2396,"lng":77.1887,"note":"Ancient temple in cedar forest"}

If status is "options": set option_a and option_b to:
{"label":"...","summary":"...","total":0,"trade_offs":"..."}

Rules:
- Output ONLY the JSON object. No other text before or after.
- All monetary values are numbers (not strings) in the requested currency
- Round all costs to whole numbers
- ALWAYS include both onward and return travel cost
- NEVER ignore the budget constraint
- If over budget: optimise first, then show option_a (budget) and option_b (comfortable)`;


/* ------------------------------------------------
   12. RENDER PLAN RESULTS
   Takes the parsed plan object and builds the HTML
   that gets injected into #plan-result
------------------------------------------------ */
function renderPlan(plan, from, to, days, travellers, currency) {
  const costs  = plan.costs || {};
  const total  = Number(costs.total) || 0;
  const budget = Number(plan.budget) || 1;
  const pct    = Math.min(Math.round((total / budget) * 100), 130);
  const isOver = total > budget;
  const barW   = Math.min(pct, 100);

  // Status badge
  const badge = isOver
    ? '<span class="badge badge-warn">⚠ Over budget · ' + pct + '%</span>'
    : '<span class="badge badge-ok">✓ Within budget · ' + pct + '%</span>';

  // Sub-agent findings card
  let agentsHTML = '';
  if (plan.agents) {
    const agentList = [
      { key: 'travel',    icon: '✈',  label: 'Travel agent'    },
      { key: 'stay',      icon: '🏨', label: 'Stay agent'      },
      { key: 'food',      icon: '🍽', label: 'Food agent'      },
      { key: 'itinerary', icon: '🗺', label: 'Itinerary agent' }
    ];

    agentsHTML = '<div class="card"><div class="card-title">🤖 Sub-agent findings</div>';
    agentList.forEach(a => {
      if (plan.agents[a.key]) {
        agentsHTML +=
          '<div class="section">' +
            '<div class="section-title">' + a.icon + ' ' + a.label + '</div>' +
            '<div class="section-body">' + escapeHTML(plan.agents[a.key]) + '</div>' +
          '</div>';
      }
    });
    agentsHTML += '</div>';
  }

  // Map section
  const validMarkers = (plan.map_markers || []).filter(m => {
    const lat = Number(m.lat);
    const lng = Number(m.lng);
    return lat && lng
      && Math.abs(lat) <= 90
      && Math.abs(lng) <= 180
      && !(lat === 0 && lng === 0);
  });

  let mapHTML = '';
  if (validMarkers.length) {
    const legendItems = validMarkers.map((m, i) =>
      '<div class="legend-item">' +
        '<div class="legend-dot" style="background:' + DAY_COLORS[i % DAY_COLORS.length] + '"></div>' +
        'Day ' + (m.day || i + 1) + ': ' + escapeHTML(m.place || '') +
      '</div>'
    ).join('');

    mapHTML =
      '<div class="map-wrap">' +
        '<div class="map-toolbar">' +
          '📍 Itinerary map — click markers for details' +
          '<div class="map-legend">' + legendItems + '</div>' +
        '</div>' +
        '<div id="trip-map"></div>' +
      '</div>';
  }

  // Plan detail sections
  const p = plan.plan || {};
  const sections = [
    { icon: '✈',  label: 'Travel — onward & return', key: 'travel'          },
    { icon: '🏨', label: 'Accommodation',             key: 'stay'            },
    { icon: '🍽', label: 'Food & restaurants',        key: 'food'            },
    { icon: '🗺', label: 'Day-wise itinerary',        key: 'itinerary'       },
    { icon: '🚗', label: 'Local transport',           key: 'local_transport' },
    { icon: '💡', label: 'Tips, visa & packing',      key: 'tips'            }
  ];

  const sectionsHTML = sections
    .filter(s => p[s.key])
    .map(s =>
      '<div class="section">' +
        '<div class="section-title">' + s.icon + ' ' + s.label + '</div>' +
        '<div class="section-body">' + escapeHTML(p[s.key]) + '</div>' +
      '</div>'
    ).join('');

  // Cost breakdown — 5 tiles
  const costKeys = ['travel', 'stay', 'food', 'activities', 'local_transport'];
  const costTiles = costKeys.map(k =>
    '<div class="metric">' +
      '<div class="metric-label">' + k.replace('_', ' ') + '</div>' +
      '<div class="metric-value" style="font-size:14px">' + formatMoney(costs[k], currency) + '</div>' +
    '</div>'
  ).join('');

  // Option A / B cards (when over budget)
  let optionsHTML = '';
  if (plan.option_a || plan.option_b) {
    optionsHTML =
      '<div class="card">' +
        '<div class="card-title">🔀 Your options</div>' +
        '<div class="options-grid">';

    if (plan.option_a) optionsHTML += buildOptionCard(plan.option_a, 'A', 'badge-ok', currency);
    if (plan.option_b) optionsHTML += buildOptionCard(plan.option_b, 'B', 'badge-info', currency);

    optionsHTML += '</div></div>';
  }

  // Follow-up buttons
  const followups =
    '<div class="followups">' +
      '<button class="followup-btn" onclick="askFollowUp(\'What are the must-try local foods in ' + to + '?\')">Local food guide ↗</button>' +
      '<button class="followup-btn" onclick="askFollowUp(\'Best season and weather to visit ' + to + '?\')">Best season ↗</button>' +
      '<button class="followup-btn" onclick="askFollowUp(\'Give me a cheaper version of a trip to ' + to + '\')">Budget plan ↗</button>' +
      '<button class="followup-btn" onclick="askFollowUp(\'Complete packing list for a trip to ' + to + '\')">Packing list ↗</button>' +
      '<button class="followup-btn" onclick="askFollowUp(\'Hidden gems and off-beat places in ' + to + '\')">Hidden gems ↗</button>' +
    '</div>';

  // Build and inject the full results HTML
  document.getElementById('plan-result').innerHTML =
    // Main summary card
    '<div class="card">' +
      '<div class="result-header">' +
        '<span class="result-title">' + escapeHTML(from) + ' → ' + escapeHTML(to) + '</span>' +
        badge +
        '<span class="result-meta">' + days + ' days · ' + travellers + ' traveller' + (travellers > 1 ? 's' : '') + '</span>' +
      '</div>' +

      // 3 metric tiles
      '<div class="metrics">' +
        '<div class="metric"><div class="metric-label">Your budget</div><div class="metric-value">' + formatMoney(budget, currency) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Estimated total</div><div class="metric-value ' + (isOver ? 'over' : 'ok') + '">' + formatMoney(total, currency) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Budget used</div><div class="metric-value ' + (isOver ? 'over' : 'ok') + '">' + pct + '%</div></div>' +
      '</div>' +

      // Budget bar
      '<div class="budget-bar-wrap">' +
        '<div class="budget-bar-fill ' + (isOver ? 'over' : '') + '" style="width:' + barW + '%"></div>' +
      '</div>' +
      '<div class="budget-bar-labels"><span>0</span><span>Budget: ' + formatMoney(budget, currency) + '</span></div>' +

      // Cost breakdown
      '<div class="section">' +
        '<div class="section-title">💰 Cost breakdown</div>' +
        '<div class="costs-grid">' + costTiles + '</div>' +
      '</div>' +

      // Map
      mapHTML +

      // Plan sections
      sectionsHTML +

      // Recommendation
      (plan.recommendation
        ? '<div class="section"><div class="section-title">✓ Final recommendation</div><div class="section-body">' + escapeHTML(plan.recommendation) + '</div></div>'
        : '') +

    '</div>' +   // end main card

    // Agent findings card
    agentsHTML +

    // Options card
    optionsHTML +

    // Follow-up buttons
    followups;

  // Init map after DOM is ready
  if (validMarkers.length) {
    setTimeout(() => renderMap(validMarkers), 250);
  }
}


// Helper: builds one option card (A or B)
function buildOptionCard(opt, letter, badgeClass, currency) {
  const isA = letter === 'A';
  const borderColor = isA ? 'var(--green)' : 'var(--blue)';

  return (
    '<div class="option-card" onclick="selectOption(\'' + letter + '\')" style="cursor:pointer;transition:all 0.2s;border:2px solid transparent" ' +
      'onmouseover="this.style.borderColor=\'' + borderColor + '\';this.style.background=\'var(--bg)\'" ' +
      'onmouseout="this.style.borderColor=\'transparent\';this.style.background=\'var(--bg)\'">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span class="badge ' + badgeClass + '">Option ' + letter + '</span>' +
        '<span class="option-label">' + escapeHTML(opt.label || '') + '</span>' +
        '<span style="margin-left:auto;font-size:11px;color:var(--muted)">Click to select →</span>' +
      '</div>' +
      '<div class="option-summary">' + escapeHTML(opt.summary || '') + '</div>' +
      (opt.total ? '<div class="option-total">' + formatMoney(opt.total, currency) + '</div>' : '') +
      '<div class="option-tradeoffs">' + escapeHTML(opt.trade_offs || '') + '</div>' +
    '</div>'
  );
}


/* ------------------------------------------------
   SELECT OPTION A or B
   When user clicks an option card, rebuild the
   entire results view using that option's data
------------------------------------------------ */
function selectOption(letter) {
  const plan = window._lastPlan;
  if (!plan) return;

  const opt = letter === 'A' ? plan.option_a : plan.option_b;
  if (!opt) return;

  // Build a modified plan using the option's data
  const selectedPlan = {
    status:   'ok',
    agents:   plan.agents,
    budget:   plan.budget,
    currency: plan.currency,
    costs: {
      total:           opt.total || 0,
      travel:          opt.travel_cost  || Math.round((opt.total || 0) * 0.4),
      stay:            opt.stay_cost    || Math.round((opt.total || 0) * 0.35),
      food:            opt.food_cost    || Math.round((opt.total || 0) * 0.15),
      activities:      opt.activity_cost|| Math.round((opt.total || 0) * 0.05),
      local_transport: opt.transport_cost|| Math.round((opt.total || 0) * 0.05),
    },
    plan: {
      travel:          opt.travel_detail    || opt.summary || '',
      stay:            opt.stay_detail      || opt.summary || '',
      food:            plan.plan ? plan.plan.food            : '',
      itinerary:       plan.plan ? plan.plan.itinerary       : '',
      local_transport: plan.plan ? plan.plan.local_transport : '',
      tips:            plan.plan ? plan.plan.tips            : '',
    },
    recommendation: 'You selected ' + (letter === 'A' ? 'the budget' : 'the comfortable') +
                    ' option. ' + (opt.trade_offs || ''),
    map_markers:  plan.map_markers  || [],
    option_a:     null,   // hide options after one is selected
    option_b:     null,
  };

  // Highlight selected card visually before reload
  const cards = document.querySelectorAll('.option-card');
  cards.forEach(c => c.style.opacity = '0.4');
  event.currentTarget.style.opacity = '1';
  event.currentTarget.style.border  = '2px solid ' + (letter === 'A' ? 'var(--green)' : 'var(--blue)');

  // Short delay so user sees the selection, then re-render
  setTimeout(function() {
    // Remove existing action bars
    document.querySelectorAll('.action-bar').forEach(el => el.remove());

    // Re-render with selected option
    const from       = document.getElementById('from').value.trim();
    const to         = document.getElementById('to').value.trim();
    const days       = document.getElementById('days').value;
    const travellers = document.getElementById('travellers').value || '1';

    window._lastPlan = selectedPlan;
    renderPlan(selectedPlan, from, to, days, travellers, plan.currency);

    // Scroll to top of results smoothly
    document.getElementById('plan-result').scrollIntoView({ behavior: 'smooth', block: 'start' });

    showToast('Option ' + letter + ' selected!');
  }, 300);
}


/* ------------------------------------------------
   13. RENDER THE MAP
   Uses Leaflet.js to show day markers + route line
------------------------------------------------ */
function renderMap(markers) {
  // Remove any existing map
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }

  const el = document.getElementById('trip-map');
  if (!el || !markers.length) return;

  // Convert markers to [lat, lng] pairs
  const latLngs = markers.map(m => [Number(m.lat), Number(m.lng)]);

  // Create the Leaflet map
  mapInstance = L.map(el, { scrollWheelZoom: false })
                 .setView(latLngs[0], 12);

  // Add OpenStreetMap tiles (free, no API key needed)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
, {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mapInstance);

  // Draw a dashed blue line connecting all markers in order
  if (latLngs.length > 1) {
    L.polyline(latLngs, {
      color:     '#2563eb',
      weight:    2.5,
      opacity:   0.5,
      dashArray: '6 8'
    }).addTo(mapInstance);
  }

  // Add a numbered circle marker for each day
  markers.forEach((m, i) => {
    const color   = DAY_COLORS[i % DAY_COLORS.length];
    const dayNum  = m.day || (i + 1);

    // Custom HTML icon — a colored circle with the day number
    const icon = L.divIcon({
      className: '',
      html:
        '<div style="' +
          'background:' + color + ';' +
          'color:#fff;' +
          'border-radius:50%;' +
          'width:32px;height:32px;' +
          'display:flex;align-items:center;justify-content:center;' +
          'font-size:13px;font-weight:700;' +
          'border:3px solid #fff;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.3);' +
          'cursor:pointer;' +
          'font-family:-apple-system,sans-serif' +
        '">' + dayNum + '</div>',
      iconSize:    [32, 32],
      iconAnchor:  [16, 16],
      popupAnchor: [0, -20]
    });

    // Popup shown when marker is clicked
    const popup = L.popup({ maxWidth: 220 }).setContent(
      '<div style="font-family:-apple-system,sans-serif;padding:2px">' +
        '<div style="font-size:12px;font-weight:700;color:' + color + ';margin-bottom:3px">Day ' + dayNum + '</div>' +
        '<div style="font-size:13px;font-weight:600;margin-bottom:5px">' + escapeHTML(m.place || '') + '</div>' +
        (m.note ? '<div style="font-size:12px;color:#555;line-height:1.5">' + escapeHTML(m.note) + '</div>' : '') +
      '</div>'
    );

    L.marker([Number(m.lat), Number(m.lng)], { icon })
     .addTo(mapInstance)
     .bindPopup(popup);
  });

  // Fit the map to show all markers
  if (latLngs.length > 1) {
    mapInstance.fitBounds(
      L.latLngBounds(latLngs).pad(0.3)
    );
  }

  // Fix any rendering issues from the div not being visible yet
  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 300);
}


/* ------------------------------------------------
   14. COMPARE TRIPS — MAIN FUNCTION
   Called when user clicks "Compare destinations"
------------------------------------------------ */
async function compareTrips() {
  const from     = document.getElementById('cmp-from').value.trim();
  const days     = document.getElementById('cmp-days').value;
  const currency = document.getElementById('cmp-currency').value;
  const budget   = document.getElementById('cmp-budget').value;
  const style    = document.getElementById('cmp-style').value;

  const dests = [
    document.getElementById('dest-1').value.trim(),
    document.getElementById('dest-2').value.trim(),
    document.getElementById('dest-3').value.trim()
  ].filter(Boolean);   // remove empty strings

  if (!from || !days || !budget || dests.length < 2) {
    alert('Please fill in: From, Days, Budget, and at least 2 destinations.');
    return;
  }

  const btn = document.getElementById('cmp-btn');
  btn.disabled    = true;
  btn.textContent = 'Comparing...';

  showThinking('cmp-thinking', 'Analyzing ' + dests.join(', ') + '...');
  document.getElementById('compare-result').innerHTML = '';

  const userMessage = [
    'Compare these travel destinations:',
    'From: ' + from,
    'Days: ' + days,
    'Budget: ' + currency + ' ' + parseInt(budget).toLocaleString(),
    'Style: ' + style,
    'Destinations: ' + dests.join(' vs '),
    'Use ' + currency + ' for all prices.',
    'Output ONLY the JSON object.'
  ].join('\n');

  try {
    const rawResponse = await callClaude(COMPARE_SYSTEM_PROMPT, userMessage, 2000);

    let result;
    try {
      result = extractJSON(rawResponse);
    } catch (parseError) {
      hideThinking('cmp-thinking');
      document.getElementById('compare-result').innerHTML =
        '<div class="error-box"><strong>Parse error</strong> — try again.<br>' +
        escapeHTML(parseError.message) +
        '<div class="error-raw">' + escapeHTML(rawResponse.slice(0, 800)) + '</div></div>';
      btn.disabled = false;
      btn.textContent = '⚖ Compare destinations';
      return;
    }

    hideThinking('cmp-thinking');
    renderCompare(result, parseFloat(budget), currency, from, days);

  } catch (err) {
    hideThinking('cmp-thinking');
    document.getElementById('compare-result').innerHTML =
      '<div class="error-box"><strong>Error:</strong> ' + escapeHTML(err.message) + '</div>';
  }

  btn.disabled    = false;
  btn.textContent = '⚖ Compare destinations';
}


/* ------------------------------------------------
   15. SYSTEM PROMPT FOR COMPARING
------------------------------------------------ */
const COMPARE_SYSTEM_PROMPT = `You are a travel comparison agent.
Return ONLY a single valid JSON object. No markdown. No text outside the JSON.

Schema:
{
  "comparisons": [
    {
      "destination": "Name",
      "total_cost": 0,
      "score": 8,
      "best_for": "One-line description of the ideal traveller",
      "verdict": "2-sentence honest verdict",
      "highlights": ["highlight 1", "highlight 2", "highlight 3"],
      "costs": { "travel": 0, "stay": 0, "food": 0, "activities": 0 },
      "fits_budget": true,
      "season_note": "Current season and weather in one sentence"
    }
  ],
  "winner": "Destination name",
  "winner_reason": "One sentence — why this wins for this specific traveller"
}

Rules:
- score is 1-10 (value for money + experience quality + fit for traveller)
- All costs are numbers in the requested currency, rounded to whole numbers
- fits_budget must be true only if total_cost is within the stated budget
- Output ONLY the JSON object`;


/* ------------------------------------------------
   16. RENDER COMPARE RESULTS
------------------------------------------------ */
function renderCompare(result, budget, currency, from, days) {
  const comparisons = result.comparisons || [];
  const winner      = result.winner || '';

  // Build each destination card
  const cards = comparisons.map(c => {
    const isOver  = Number(c.total_cost) > budget;
    const isWinner = c.destination === winner;
    const ck       = c.costs || {};

    // Score color: green ≥8, amber ≥6, red below
    const scoreColor = c.score >= 8
      ? 'var(--green)'
      : c.score >= 6 ? 'var(--amber)' : 'var(--red)';

    const costRows = ['travel', 'stay', 'food', 'activities'].map(k =>
      '<div class="compare-row">' +
        '<span class="compare-row-key">' + k + '</span>' +
        '<span class="compare-row-value">' + formatMoney(ck[k], currency) + '</span>' +
      '</div>'
    ).join('');

    const highlights = (c.highlights || []).map(h =>
      '<div class="compare-highlight"><div class="dot"></div><span>' + escapeHTML(h) + '</span></div>'
    ).join('');

    return (
      '<div class="compare-card' + (isWinner ? ' winner' : '') + '">' +
        (isWinner ? '<div style="margin-bottom:8px"><span class="badge badge-ok">✓ Recommended</span></div>' : '') +
        '<div class="compare-dest">' + escapeHTML(c.destination) + '</div>' +
        '<div class="compare-best-for">' + escapeHTML(c.best_for || '') + '</div>' +
        '<div class="compare-score" style="color:' + scoreColor + '">' + (c.score || '?') + '<span>/10</span></div>' +

        '<div class="compare-row">' +
          '<span class="compare-row-key">Total cost</span>' +
          '<span class="compare-row-value" style="' + (isOver ? 'color:var(--red)' : '') + '">' + formatMoney(c.total_cost, currency) + '</span>' +
        '</div>' +
        costRows +
        '<div class="compare-row">' +
          '<span class="compare-row-key">Fits budget</span>' +
          '<span class="compare-row-value" style="color:' + (c.fits_budget ? 'var(--green)' : 'var(--red)') + '">' + (c.fits_budget ? '✓ Yes' : '✗ No') + '</span>' +
        '</div>' +

        (c.season_note
          ? '<div style="font-size:11px;color:var(--muted);margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light)">' + escapeHTML(c.season_note) + '</div>'
          : '') +

        '<div class="compare-highlights">' + highlights + '</div>' +
        '<div class="compare-verdict">' + escapeHTML(c.verdict || '') + '</div>' +

        '<button class="compare-plan-btn" onclick="switchAndPlan(\'' + escapeHTML(from) + '\',\'' + escapeHTML(c.destination) + '\',\'' + days + '\')">' +
          'Plan this trip →' +
        '</button>' +
      '</div>'
    );
  }).join('');

  document.getElementById('compare-result').innerHTML =
    (result.winner_reason
      ? '<div class="winner-banner">★ <strong>' + escapeHTML(winner) + '</strong> — ' + escapeHTML(result.winner_reason) + '</div>'
      : '') +
    '<div class="compare-grid">' + cards + '</div>';
}


/* ------------------------------------------------
   17. FOLLOW-UP & UTILITY FUNCTIONS
------------------------------------------------ */

// Send a follow-up question (works in Claude.ai,
// falls back to copying to clipboard elsewhere)
function askFollowUp(question) {
  if (typeof sendPrompt === 'function') {
    sendPrompt(question);
  } else {
    // Fallback: copy to clipboard
    const textarea = document.createElement('textarea');
    textarea.value = question;
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(textarea);
    alert('Question copied to clipboard:\n\n' + question);
  }
}

// "Plan this trip" button inside a compare card
// Pre-fills the plan form and switches to that tab
function switchAndPlan(from, destination, days) {
  switchTab('plan');
  document.getElementById('from').value  = from;
  document.getElementById('to').value    = destination;
  document.getElementById('days').value  = days;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ================================================
   PHASE 5 — SAVE · EXPORT · SHARE
================================================ */

/* ------------------------------------------------
   SAVE TRIPS TO LOCALSTORAGE
   localStorage is a mini-database built into
   every browser. Data survives page refresh.
   Max ~5MB, perfect for saved trip plans.
------------------------------------------------ */

const STORAGE_KEY = 'wandr_saved_trips';

// Load all saved trips from storage
function loadSavedTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// Write all saved trips back to storage
function writeSavedTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

// Save the current plan with a generated ID
function saveCurrentTrip(plan, from, to, days, currency) {
  const trips = loadSavedTrips();

  const newTrip = {
    id:       Date.now().toString(),        // unique ID = timestamp
    from:     from,
    to:       to,
    days:     days,
    currency: currency,
    total:    plan.costs ? plan.costs.total : 0,
    savedAt:  new Date().toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric'
              }),
    plan:     plan                          // full plan object
  };

  // Add to front of array (newest first)
  trips.unshift(newTrip);

  // Keep only the last 10 trips
  if (trips.length > 10) trips.pop();

  writeSavedTrips(trips);
  renderSavedTrips();
  showToast('Trip saved!');
}

// Delete one saved trip by ID
function deleteSavedTrip(id, event) {
  // Stop the click from also triggering the load
  event.stopPropagation();

  let trips = loadSavedTrips();
  trips = trips.filter(t => t.id !== id);
  writeSavedTrips(trips);
  renderSavedTrips();
}

// Clear all saved trips
function clearAllTrips() {
  if (!confirm('Delete all saved trips?')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderSavedTrips();
}

// Load a saved trip back into the results view
function loadSavedTrip(id) {
  const trips = loadSavedTrips();
  const trip  = trips.find(t => t.id === id);
  if (!trip) return;

  // Pre-fill the form with the saved values
  document.getElementById('from').value   = trip.from;
  document.getElementById('to').value     = trip.to;
  document.getElementById('days').value   = trip.days;
  document.getElementById('currency').value = trip.currency;

  // Render the saved plan results
  renderPlan(trip.plan, trip.from, trip.to, trip.days, 1, trip.currency);

  // Scroll to results
  document.getElementById('plan-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Build and inject the saved trips panel HTML
function renderSavedTrips() {
  const panel = document.getElementById('saved-trips-panel');
  if (!panel) return;

  const trips = loadSavedTrips();

  if (trips.length === 0) {
    panel.innerHTML =
      '<div class="saved-panel">' +
        '<div class="saved-panel-header">' +
          '<span class="saved-panel-title">🗂 Saved trips</span>' +
        '</div>' +
        '<div class="empty-saved">' +
          '<div class="empty-saved-icon">✈</div>' +
          '<div>No saved trips yet.<br>Plan a trip and click Save.</div>' +
        '</div>' +
      '</div>';
    return;
  }

  const tripRows = trips.map(t => {
    const sym   = { INR:'₹', USD:'$', EUR:'€', GBP:'£' }[t.currency] || '';
    const total = sym + Math.round(Number(t.total || 0)).toLocaleString();

    return (
      '<div class="saved-trip" onclick="loadSavedTrip(\'' + t.id + '\')">' +
        '<div class="saved-trip-icon">🗺</div>' +
        '<div class="saved-trip-info">' +
          '<div class="saved-trip-name">' + escapeHTML(t.from) + ' → ' + escapeHTML(t.to) + '</div>' +
          '<div class="saved-trip-meta">' + t.days + ' days · ' + t.savedAt + '</div>' +
        '</div>' +
        '<div class="saved-trip-cost">' + total + '</div>' +
        '<button class="saved-trip-delete" onclick="deleteSavedTrip(\'' + t.id + '\', event)" title="Delete">✕</button>' +
      '</div>'
    );
  }).join('');

  panel.innerHTML =
    '<div class="saved-panel">' +
      '<div class="saved-panel-header">' +
        '<span class="saved-panel-title">🗂 Saved trips (' + trips.length + ')</span>' +
        '<button class="clear-btn" onclick="clearAllTrips()">Clear all</button>' +
      '</div>' +
      tripRows +
    '</div>';
}


/* ------------------------------------------------
   PDF EXPORT
   Uses the browser's built-in print dialog.
   The print CSS we added hides all UI chrome
   so only the trip plan prints cleanly.
------------------------------------------------ */
function exportPDF() {
  // Quick tip before printing
  showToast('In the print dialog — choose "Save as PDF"');
  setTimeout(() => window.print(), 800);
}


/* ------------------------------------------------
   SHARE VIA LINK
   Encodes the key trip details into the URL.
   Anyone with the link can open the app
   with the form pre-filled.
   The full plan itself isn't in the URL —
   they need to click Plan again to regenerate it
   (that would require a backend/database).
------------------------------------------------ */
function shareTrip(from, to, days, currency, budget) {
  const params = new URLSearchParams({
    from:     from,
    to:       to,
    days:     days,
    currency: currency,
    budget:   budget
  });

  // Build the shareable URL
  const shareURL = window.location.origin + window.location.pathname + '?' + params.toString();

  // Try the native Share API first (works on mobile)
  if (navigator.share) {
    navigator.share({
      title: 'Wandr — ' + from + ' to ' + to,
      text:  days + '-day trip plan from ' + from + ' to ' + to,
      url:   shareURL
    }).catch(() => {});
    return;
  }

  // Fallback: copy link to clipboard
  navigator.clipboard.writeText(shareURL)
    .then(() => showToast('Link copied to clipboard!'))
    .catch(() => {
      // Final fallback for older browsers
      prompt('Copy this link:', shareURL);
    });
}

// On page load — check if URL has pre-fill params
// This runs when someone opens a shared link
function checkURLParams() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('from')) document.getElementById('from').value     = params.get('from');
  if (params.get('to'))   document.getElementById('to').value       = params.get('to');
  if (params.get('days')) document.getElementById('days').value     = params.get('days');
  if (params.get('currency')) document.getElementById('currency').value = params.get('currency');
  if (params.get('budget'))   document.getElementById('budget').value   = params.get('budget');
}


/* ------------------------------------------------
   TOAST NOTIFICATION
   Small message that fades in and out
------------------------------------------------ */
function showToast(message) {
  // Find or create the toast element
  let toast = document.getElementById('wandr-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'wandr-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add('show');

  // Auto-hide after 2.5 seconds
  setTimeout(() => toast.classList.remove('show'), 2500);
}


/* ------------------------------------------------
   INJECT ACTION BAR AFTER RESULTS RENDER
   We patch the renderPlan function to add
   Save / Export / Share buttons after the plan
   is shown. We do this by wrapping it.
------------------------------------------------ */

// Store reference to the original renderPlan
const _originalRenderPlan = renderPlan;

// Override renderPlan to add the action bar
renderPlan = function(plan, from, to, days, travellers, currency) {
  // Remove any existing action bar first
    document.querySelectorAll('.action-bar').forEach(el => el.remove());
 // Call the original function first
  _originalRenderPlan(plan, from, to, days, travellers, currency);

  // Then inject the action bar below results
  const actionBar = document.createElement('div');
  actionBar.className = 'action-bar';
  actionBar.innerHTML =
    '<button class="action-btn primary" onclick="saveCurrentTrip(window._lastPlan,\'' +
      escapeHTML(from) + '\',\'' + escapeHTML(to) + '\',\'' + days + '\',\'' + currency + '\')">' +
      '💾 Save trip' +
    '</button>' +
    '<button class="action-btn" onclick="exportPDF()">' +
      '📄 Export PDF' +
    '</button>' +
    '<button class="action-btn" onclick="shareTrip(\'' +
      escapeHTML(from) + '\',\'' + escapeHTML(to) + '\',\'' + days + '\',\'' + currency + '\',\'' +
      (plan.budget || '') + '\')">' +
      '🔗 Share link' +
    '</button>';

  // Store plan globally so save can access it
  window._lastPlan = plan;

  // Insert after the results div
  const results = document.getElementById('plan-result');
  results.parentNode.insertBefore(actionBar, results.nextSibling);
};


/* ------------------------------------------------
   INIT — runs when the page first loads
------------------------------------------------ */
document.addEventListener('DOMContentLoaded', function() {
  // Show saved trips panel
  renderSavedTrips();

  // Pre-fill form if opened from a shared link
  checkURLParams();
});
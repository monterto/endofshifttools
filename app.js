// ============================================
// END OF SHIFT TOOLS
//
// Two tools:
//   - Tip Breakdown: every worker. Time + cash-out numbers in, the values
//     for their spreadsheet row out (in the sheet's left-to-right order).
//   - End of Day: the last worker. Everyone's hours + tip contributions in,
//     each person's share of the pool out.
// ============================================

// ---------- Feature switches ----------
const FEATURES = {
  // "Send to End of Day" button on Tip Breakdown. Hidden because it ended up
  // unused; set to true to bring it back (the code below is kept working).
  sendToEndOfDay: false,
  // Tap the hub pig to preview the "old data" alert (for testing).
  debugOldDataTrigger: false
};

const OLD_DATA_MS = 2 * 60 * 60 * 1000; // "old" = more than 2 hours
const KEYS = {
  endOfDay: 'endOfDayData',
  percents: 'tipCalcPreset',
  tipDraft: 'tipCalcDraft',
  lastApp: 'lastActiveApp'
};

// ---------- Pigs 🐷 ----------
const PIGS = ['🐽', '🐖', '🐷'];
const MONEY = ['💸', '💰', '💵'];
const CLOCKS = ['⏰', '🕐', '⏳'];
const DRINKS = ['🍹', '🍺', '🍸'];
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

// ============================================
// SHARED HELPERS
// ============================================

function $(id) { return document.getElementById(id); }

// Read JSON from localStorage without ever throwing: a corrupted entry used
// to stop the whole hub from wiring up its buttons.
function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Ignoring unreadable saved data for', key, e);
    return null;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/blocked */ }
}

function removeKey(key) {
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

const round2 = n => Math.round(n * 100) / 100;

// "$1,234.50" / "-$59.20"
function fmtMoney(n) {
  const v = round2(n);
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-$' : '$') + abs;
}

// "16:30" -> "4:30 PM" (in the phone's own time format)
function fmtClock(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// 472 -> "7h 52m"
function fmtMinutes(min) {
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

function describeAge(savedAt) {
  const hours = Math.floor((Date.now() - savedAt) / 3600000);
  const days = Math.floor(hours / 24);
  const ago = hours < 1 ? 'earlier today'
    : hours < 24 ? hours + ' hour' + (hours === 1 ? '' : 's') + ' ago'
    : days + ' day' + (days === 1 ? '' : 's') + ' ago';
  const when = new Date(savedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return 'From ' + ago + ' (' + when + ')';
}

// End of Day entries are {value, auto} objects (very old saves stored bare
// numbers). `entry.value || entry` was used before, which broke on $0.00.
function entryValue(entry) {
  if (entry && typeof entry === 'object') return Number(entry.value) || 0;
  return Number(entry) || 0;
}

function sumEntries(entries) {
  return (entries || []).reduce(function(sum, e) { return sum + entryValue(e); }, 0);
}

// Used by the (hidden) Send to End of Day feature.
function appendToEndOfDay(kind, value) {
  const data = readJSON(KEYS.endOfDay) || {};
  if (!data.sessionStartTime) data.sessionStartTime = Date.now();
  if (!Array.isArray(data.hoursEntries)) data.hoursEntries = [];
  if (!Array.isArray(data.tipsEntries)) data.tipsEntries = [];
  (kind === 'hours' ? data.hoursEntries : data.tipsEntries).push({ value: value, auto: true });
  data.totalHours = sumEntries(data.hoursEntries);
  data.totalTips = sumEntries(data.tipsEntries);
  writeJSON(KEYS.endOfDay, data);
}

// Split a pool across people by hours, in whole cents, so the shares always
// add up to the pool exactly. Each share is first rounded DOWN to the cent;
// the leftover cents go to the shares that were rounded down the most
// (ties: more hours first, then earlier row). Returns null per row when
// there's nothing to split.
function splitPoolByHours(pool, hoursList) {
  const totalHours = hoursList.reduce(function(a, h) { return a + h; }, 0);
  if (totalHours <= 0 || !(pool > 0)) return hoursList.map(function() { return null; });
  const poolCents = Math.round(pool * 100);
  const exact = hoursList.map(function(h) { return poolCents * h / totalHours; });
  const cents = exact.map(function(x) { return Math.floor(x + 1e-9); });
  let leftover = poolCents - cents.reduce(function(a, c) { return a + c; }, 0);
  const order = exact
    .map(function(x, i) { return { i: i, frac: x - cents[i], h: hoursList[i] }; })
    .sort(function(a, b) { return (b.frac - a.frac) || (b.h - a.h) || (a.i - b.i); });
  for (let k = 0; leftover > 0 && order.length; k = (k + 1) % order.length, leftover--) {
    cents[order[k].i]++;
  }
  return cents.map(function(c) { return c / 100; });
}

// ---------- Modals: one behavior for every pop-up ----------
function openModal(modal) { modal.classList.add('show'); }
function closeModal(modal) { if (modal) modal.classList.remove('show'); }

// Backdrop tap and any [data-close] button close the modal they're in.
function wireModals(root) {
  root.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(modal); });
  });
  root.querySelectorAll('[data-close]').forEach(function(btn) {
    btn.addEventListener('click', function() { closeModal(btn.closest('.modal')); });
  });
}

// Shared markup for a tool's ⓘ help pop-up.
function helpModalHTML(id, items, formula) {
  return '' +
    '<div class="modal" id="' + id + '" role="dialog" aria-modal="true">' +
    '  <div class="modal-card">' +
    '    <div class="modal-header">' +
    '      <span class="modal-title">Field explanations</span>' +
    '      <button class="icon-btn plain" type="button" data-close aria-label="Close">✕</button>' +
    '    </div>' +
    '    <ul class="help-list">' +
    items.map(function(it) { return '<li><strong>' + it[0] + '</strong>' + it[1] + '</li>'; }).join('') +
    '    </ul>' +
    (formula ? '<div class="help-formula">' + formula + '</div>' : '') +
    '  </div>' +
    '</div>';
}

// Shared markup for an "old data" alert.
function alertHTML(id, title, textId, keepId, clearId) {
  return '' +
    '<div class="alert" id="' + id + '" role="alert">' +
    '  <div class="alert-icon">⚠️</div>' +
    '  <div class="alert-text"><strong>' + title + '</strong><p id="' + textId + '"></p></div>' +
    '  <div class="alert-actions">' +
    '    <button class="btn btn-secondary" id="' + keepId + '" type="button">Keep</button>' +
    '    <button class="btn btn-danger" id="' + clearId + '" type="button">Clear</button>' +
    '  </div>' +
    '</div>';
}

// ============================================
// HUB
// ============================================

function checkForOldData() {
  const data = readJSON(KEYS.endOfDay);
  if (!data || !data.sessionStartTime) return;
  const age = Date.now() - data.sessionStartTime;
  if (age > OLD_DATA_MS) showOldDataAlert(data.sessionStartTime);
}

function showOldDataAlert(savedAt) {
  $('dataAgeText').textContent = describeAge(savedAt) + ' and still saved';
  $('clearDataAlert').classList.add('show');
}

document.addEventListener('DOMContentLoaded', function() {
  checkForOldData();
  wireModals(document.getElementById('hubView'));

  if (FEATURES.debugOldDataTrigger) {
    const pig = $('hubEmoji');
    pig.classList.add('debug-enabled');
    pig.addEventListener('click', function() {
      const data = readJSON(KEYS.endOfDay);
      showOldDataAlert((data && data.sessionStartTime) || Date.now() - 3 * 3600000);
    });
  }

  $('tipCalcCard').addEventListener('click', function() { loadApp('tipcalc'); });
  $('endOfDayCard').addEventListener('click', function() { loadApp('endofday'); });
  $('backBtn').addEventListener('click', backToHub);
  $('infoBtn').addEventListener('click', function() { openModal($('infoModal')); });

  $('keepDataBtn').addEventListener('click', function() { $('clearDataAlert').classList.remove('show'); });
  $('clearDataBtn').addEventListener('click', function() {
    removeKey(KEYS.endOfDay);
    $('clearDataAlert').classList.remove('show');
  });

  // Reopen the tool that was open last ("hourscalc" was merged into Tip Breakdown).
  let lastApp = null;
  try { lastApp = localStorage.getItem(KEYS.lastApp); } catch (e) { /* ignore */ }
  if (lastApp === 'hourscalc') lastApp = 'tipcalc';
  if (lastApp === 'tipcalc' || lastApp === 'endofday') {
    history.pushState({ app: 'hub' }, '', '');
    loadApp(lastApp);
  }
});

// ============================================
// NAVIGATION
// ============================================

function loadApp(appName) {
  $('hubView').style.display = 'none';
  $('appView').classList.add('active');
  try { localStorage.setItem(KEYS.lastApp, appName); } catch (e) { /* ignore */ }
  history.pushState({ app: appName }, '', '');
  window.scrollTo(0, 0);

  const container = $('appContainer');
  if (appName === 'tipcalc') {
    $('currentAppTitle').textContent = 'Tip Breakdown';
    container.innerHTML = getTipCalcHTML();
    initTipCalc();
  } else if (appName === 'endofday') {
    $('currentAppTitle').textContent = 'End of Day';
    container.innerHTML = getEndOfDayHTML();
    initEndOfDay();
  }
  wireModals(container);
}

function showHub() {
  $('appView').classList.remove('active');
  $('hubView').style.display = 'flex';
  $('appContainer').innerHTML = '';
  removeKey(KEYS.lastApp);
}

// The ← button shows the hub right away, then steps browser history back so
// the phone's back button stays in sync. That history step arrives a moment
// later as a "popstate" — if you'd already opened another tool by then, it
// would close it. So the one popstate our own ← causes is ignored.
let ignoreNextPopstate = false;

function backToHub() {
  showHub();
  if (history.state && history.state.app) {
    ignoreNextPopstate = true;
    history.back();
  }
}

// Phone/browser back button returns to the hub.
window.addEventListener('popstate', function() {
  if (ignoreNextPopstate) {
    ignoreNextPopstate = false;
    return;
  }
  if ($('appView').classList.contains('active')) showHub();
});

// ============================================
// TIP BREAKDOWN (time + tips, for every worker)
// ============================================

function getTipCalcHTML() {
  return '' +
    alertHTML('tipDraftAlert', 'Old numbers', 'tipDraftAge', 'tipDraftKeepBtn', 'tipDraftClearBtn') +

    '<section class="card">' +
    '  <span class="card-label">Time</span>' +
    '  <div class="grid-2">' +
    '    <label class="field"><span class="field-label">Start</span><input class="input" id="start" type="time"></label>' +
    '    <label class="field"><span class="field-label">End</span><input class="input" id="end" type="time"></label>' +
    '  </div>' +
    '</section>' +

    '<section class="card">' +
    '  <span class="card-label">From your cash-out</span>' +
    '  <div class="grid-2">' +
    '    <label class="field"><span class="field-label">Owed tips</span><input class="input" id="owed" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00"></label>' +
    '    <label class="field"><span class="field-label">Net sales</span><input class="input" id="sales" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00"></label>' +
    '  </div>' +
    // Cash tips: hidden behind a "+" button because it's usually empty.
    '  <label class="field reveal-field" id="cashField" hidden><span class="field-label">Cash tips</span>' +
    '    <input class="input" id="cash" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00"></label>' +
    '  <div class="chip-row">' +
    '    <button class="chip" id="openPartyModalBtn" type="button">+ Large party</button>' +
    '    <button class="chip" id="addCashBtn" type="button">+ Cash tips</button>' +
    '  </div>' +
    '</section>' +

    '<div class="notice notice-danger" id="warningBox">⚠️ Tip contribution is negative. Check Owed tips and Net sales.</div>' +

    '<section class="card">' +
    '  <div class="card-label-row">' +
    '    <span class="card-label">For your sheet</span>' +
    '    <button class="btn btn-ghost btn-sm" id="openPercentModalBtn" type="button">Edit %</button>' +
    '  </div>' +
    '  <div class="rows">' +
    '    <div class="row"><span class="row-label">Start – End</span><span class="row-value" id="outTimes"></span></div>' +
    '    <div class="row"><span class="row-label">Hours<small id="outHoursDetail"></small></span><span class="row-value" id="outHours"></span></div>' +
    '    <div class="row"><span class="row-label">Net sales</span><span class="row-value" id="outSales"></span></div>' +
    '    <div class="row"><span class="row-label">BoH tips <small id="bohPercentDisplay">5%</small></span><span class="row-value" id="boh"></span></div>' +
    '    <div class="row"><span class="row-label">FoH tips <small id="fohPercentDisplay">3%</small></span><span class="row-value" id="foh"></span></div>' +
    '    <div class="row"><span class="row-label">Large party tip-out</span><span class="row-value" id="outParty"></span></div>' +
    '    <div class="row"><span class="row-label">Cash tips</span><span class="row-value" id="outCash"></span></div>' +
    '    <div class="row row-total" id="tipsOutput"><span class="row-label">Tip contribution</span><span class="row-value" id="tips"></span></div>' +
    '  </div>' +
    '</section>' +

    (FEATURES.sendToEndOfDay
      ? '<button class="btn btn-primary btn-block" id="saveToEndOfDay" type="button">→ Send to End of Day</button>'
      : '') +
    '<button class="btn btn-danger-outline btn-block" id="clearBtn" type="button">🗑️ Clear all</button>' +
    '<div class="pigs" id="pigDisplay" aria-hidden="true"></div>' +

    // Large party pop-up
    '<div class="modal" id="partyModal" role="dialog" aria-modal="true">' +
    '  <div class="modal-card">' +
    '    <div class="modal-header">' +
    '      <span class="modal-title">Large parties</span>' +
    '      <button class="btn btn-primary btn-sm" type="button" data-close>Done</button>' +
    '    </div>' +
    '    <div id="partyContainer"></div>' +
    '    <button class="btn btn-secondary btn-block" id="addPartyBtn" type="button">+ Add party</button>' +
    '  </div>' +
    '</div>' +

    // Percent pop-up
    '<div class="modal" id="percentModal" role="dialog" aria-modal="true">' +
    '  <div class="modal-card">' +
    '    <div class="modal-header">' +
    '      <span class="modal-title">Tip-out percentages</span>' +
    '      <button class="icon-btn plain" type="button" data-close aria-label="Cancel">✕</button>' +
    '    </div>' +
    '    <label class="field"><span class="field-label">Back of House %</span><input class="input" type="number" id="bohPercentEdit" step="0.01" min="0" inputmode="decimal" placeholder="5"></label>' +
    '    <label class="field"><span class="field-label">Front of House support %</span><input class="input" type="number" id="fohPercentEdit" step="0.01" min="0" inputmode="decimal" placeholder="3"></label>' +
    '    <div class="modal-actions">' +
    '      <button class="btn btn-secondary" id="resetPercentsBtn" type="button">Reset to defaults</button>' +
    '      <button class="btn btn-primary" id="savePercentsBtn" type="button">Save</button>' +
    '    </div>' +
    '  </div>' +
    '</div>' +

    helpModalHTML('tipCalcInfoModal', [
      ['Start / End', 'When your shift began and ended. Overnight shifts work.'],
      ['Owed tips', 'Total tips owed, near the top of your cash-out.'],
      ['Net sales', 'Total net sales, further down your cash-out.'],
      ['+ Large party', 'Usually left empty. Headcount × $/head × 1% is taken off your tip contribution.'],
      ['+ Cash tips', 'Usually left empty. Cash tips aren\'t in Toast\'s owed number, so enter them here; they\'re added to your tip contribution like card tips.'],
      ['Edit %', 'Change the BoH and FoH percentages (asks you to confirm).'],
      ['For your sheet', 'Everything you write on the spreadsheet, in its left-to-right order.'],
      ['Hours', 'Time from Start to End, rounded DOWN to the quarter hour.'],
      ['Saved numbers', 'What you type is kept if you leave this screen. If it\'s more than 2 hours old you\'ll see a warning with a Clear button; 🗑️ Clear all wipes it any time.']
    ], 'Tip contribution = Owed tips − BoH − FoH − Large party + Cash tips<br>Hours = End − Start, rounded down to 0.25');
}

function initTipCalc() {
  const DEFAULT_BOH = 5;
  const DEFAULT_FOH = 3;
  const DEFAULT_COST_PER_HEAD = 65;

  const startInput = $('start');
  const endInput = $('end');
  const owed = $('owed');
  const sales = $('sales');
  const cash = $('cash');
  const cashField = $('cashField');
  const addCashBtn = $('addCashBtn');
  const partyContainer = $('partyContainer');
  const partyChip = $('openPartyModalBtn');
  const partyModal = $('partyModal');
  const percentModal = $('percentModal');
  const bohPercentEdit = $('bohPercentEdit');
  const fohPercentEdit = $('fohPercentEdit');
  const draftAlert = $('tipDraftAlert');

  let largeParties = [];
  let bohPercent = DEFAULT_BOH;
  let fohPercent = DEFAULT_FOH;
  let currentTipValue = 0;
  let currentHours = 0;

  $('pigDisplay').textContent = pick(PIGS) + pick(MONEY.concat(CLOCKS));

  // ---------- Hours ----------
  // Plain minute arithmetic, wrapping past midnight. (Building real Date
  // objects made overnight shifts an hour off on daylight-saving nights.)
  function computeHours() {
    if (!startInput.value || !endInput.value) return null;
    const s = startInput.value.split(':').map(Number);
    const e = endInput.value.split(':').map(Number);
    const worked = ((e[0] * 60 + e[1]) - (s[0] * 60 + s[1]) + 1440) % 1440;
    // Company policy: always round DOWN to the quarter hour.
    // (No break field: shifts are short enough that it was never used.)
    return { worked: worked, rounded: Math.floor(worked / 15) / 4 };
  }

  // ---------- Large parties ----------
  function partyDeduction(p) {
    return p.headcount && p.costPerHead ? p.headcount * p.costPerHead * 0.01 : 0;
  }

  function partyTotal() {
    return largeParties.reduce(function(sum, p) { return sum + partyDeduction(p); }, 0);
  }

  function partyCalcText(p) {
    return (p.headcount || 0) + ' × $' + (p.costPerHead || DEFAULT_COST_PER_HEAD) + ' × 1% = ' + fmtMoney(partyDeduction(p));
  }

  // Updates the formula lines and the chip WITHOUT touching the input boxes
  // (rebuilding them on every keystroke used to throw away focus).
  function updatePartyTotals() {
    partyContainer.querySelectorAll('.party-calc').forEach(function(line) {
      const p = largeParties[parseInt(line.getAttribute('data-index'), 10)];
      if (p) line.textContent = partyCalcText(p);
    });
    const total = partyTotal();
    const count = largeParties.filter(function(p) { return p.headcount > 0; }).length;
    partyChip.textContent = total > 0
      ? 'Large party: ' + fmtMoney(total) + (count > 1 ? ' (' + count + ')' : '') + ' · edit'
      : '+ Large party';
    partyChip.classList.toggle('has-value', total > 0);
  }

  // Full rebuild: only when parties are added or removed.
  function renderParties() {
    partyContainer.innerHTML = largeParties.map(function(p, i) {
      return '' +
        '<div class="party-row">' +
        '  <label class="field"><span class="field-label">Headcount</span>' +
        '    <input class="input party-headcount" type="number" min="0" inputmode="numeric" placeholder="0" data-index="' + i + '" value="' + (p.headcount || '') + '"></label>' +
        '  <label class="field"><span class="field-label">$ / head</span>' +
        '    <input class="input party-cost" type="number" step="0.01" min="0" inputmode="decimal" placeholder="' + DEFAULT_COST_PER_HEAD + '" data-index="' + i + '" value="' + (p.costPerHead || DEFAULT_COST_PER_HEAD) + '"></label>' +
        '  <button class="btn btn-danger-outline party-remove" type="button" data-index="' + i + '" aria-label="Remove party">✕</button>' +
        '</div>' +
        '<div class="party-calc" data-index="' + i + '">' + partyCalcText(p) + '</div>';
    }).join('') || '<p class="empty-state">No large parties</p>';

    partyContainer.querySelectorAll('.party-headcount').forEach(function(input) {
      input.addEventListener('input', function() {
        largeParties[parseInt(this.getAttribute('data-index'), 10)].headcount = parseFloat(this.value) || 0;
        onChange();
      });
    });
    partyContainer.querySelectorAll('.party-cost').forEach(function(input) {
      input.addEventListener('input', function() {
        // Blank means the default price — but the box is left alone while you type.
        largeParties[parseInt(this.getAttribute('data-index'), 10)].costPerHead = parseFloat(this.value) || DEFAULT_COST_PER_HEAD;
        onChange();
      });
      input.addEventListener('change', function() {
        if (this.value === '') this.value = DEFAULT_COST_PER_HEAD;
      });
    });
    partyContainer.querySelectorAll('.party-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        largeParties.splice(parseInt(this.getAttribute('data-index'), 10), 1);
        renderParties();
        onChange();
      });
    });
    updatePartyTotals();
  }

  $('addPartyBtn').addEventListener('click', function() {
    largeParties.push({ headcount: 0, costPerHead: DEFAULT_COST_PER_HEAD });
    renderParties();
    const boxes = partyContainer.querySelectorAll('.party-headcount');
    if (boxes.length) boxes[boxes.length - 1].focus();
  });

  partyChip.addEventListener('click', function() {
    if (largeParties.length === 0) {
      largeParties.push({ headcount: 0, costPerHead: DEFAULT_COST_PER_HEAD });
      renderParties();
    }
    openModal(partyModal);
    const firstEmpty = [...partyContainer.querySelectorAll('.party-headcount')].find(function(i) { return !i.value; });
    if (firstEmpty) firstEmpty.focus();
  });

  // ---------- Cash tips ----------
  // Cash tips aren't part of Toast's owed number, so they're entered here and
  // added to the tip contribution just like card tips. The field stays out of
  // the way (behind "+ Cash tips") unless it has a value.
  function showCashField(show) {
    cashField.hidden = !show;
    addCashBtn.hidden = show;
  }

  addCashBtn.addEventListener('click', function() {
    showCashField(true);
    cash.focus();
  });

  cash.addEventListener('blur', function() {
    if (cash.value === '') showCashField(false);
  });

  // ---------- Percentages ----------
  function showPercents() {
    $('bohPercentDisplay').textContent = bohPercent + '%';
    $('fohPercentDisplay').textContent = fohPercent + '%';
  }

  function loadPercents() {
    const preset = readJSON(KEYS.percents);
    if (preset && Number.isFinite(preset.boh) && Number.isFinite(preset.foh)) {
      bohPercent = preset.boh;
      fohPercent = preset.foh;
    } else {
      bohPercent = DEFAULT_BOH;
      fohPercent = DEFAULT_FOH;
    }
    showPercents();
  }

  $('openPercentModalBtn').addEventListener('click', function() {
    bohPercentEdit.value = bohPercent;
    fohPercentEdit.value = fohPercent;
    openModal(percentModal);
  });

  $('savePercentsBtn').addEventListener('click', function() {
    const newBoh = parseFloat(bohPercentEdit.value);
    const newFoh = parseFloat(fohPercentEdit.value);
    if (isNaN(newBoh) || isNaN(newFoh) || newBoh < 0 || newFoh < 0) {
      alert('Enter valid percentages (0 or greater).');
      return;
    }
    if (!confirm('Save Back of House to ' + newBoh + '% and Support to ' + newFoh + '%?')) return;
    bohPercent = newBoh;
    fohPercent = newFoh;
    writeJSON(KEYS.percents, { boh: bohPercent, foh: fohPercent });
    showPercents();
    update();
    closeModal(percentModal);
  });

  $('resetPercentsBtn').addEventListener('click', function() {
    if (!confirm('Reset Back of House to ' + DEFAULT_BOH + '% and Support to ' + DEFAULT_FOH + '%?')) return;
    bohPercent = DEFAULT_BOH;
    fohPercent = DEFAULT_FOH;
    bohPercentEdit.value = bohPercent;
    fohPercentEdit.value = fohPercent;
    writeJSON(KEYS.percents, { boh: bohPercent, foh: fohPercent });
    showPercents();
    update();
  });

  // ---------- Results ("For your sheet") ----------
  function setValue(id, text) {
    const node = $(id);
    node.textContent = text || '–';
    node.classList.toggle('empty', !text);
  }

  function isValidMoney(input) {
    const ok = !(input.value && (isNaN(parseFloat(input.value)) || parseFloat(input.value) < 0));
    input.classList.toggle('error', !ok);
    return ok;
  }

  function update() {
    // Time
    setValue('outTimes', (startInput.value || endInput.value)
      ? (fmtClock(startInput.value) || '?') + ' – ' + (fmtClock(endInput.value) || '?')
      : '');
    const h = computeHours();
    currentHours = h ? h.rounded : 0;
    setValue('outHours', h ? h.rounded.toFixed(2) : '');
    $('outHoursDetail').textContent = h
      ? fmtMinutes(h.worked) + ' worked'
      : '';

    // Money
    const moneyOk = [isValidMoney(owed), isValidMoney(sales), isValidMoney(cash)].every(Boolean);
    const hasMoney = owed.value !== '' || sales.value !== '' || cash.value !== '' || partyTotal() > 0;
    const o = parseFloat(owed.value) || 0;
    const s = parseFloat(sales.value) || 0;
    const c = parseFloat(cash.value) || 0;
    const boh = s * bohPercent / 100;
    const foh = s * fohPercent / 100;
    const party = partyTotal();
    const tips = o - (boh + foh) - party + c;

    if (!moneyOk) {
      // Don't show or send numbers built from an invalid entry.
      currentTipValue = 0;
      ['outSales', 'boh', 'foh', 'outParty', 'outCash', 'tips'].forEach(function(id) { setValue(id, ''); });
      $('warningBox').classList.remove('show');
      $('tipsOutput').classList.remove('negative');
      return;
    }

    setValue('outSales', sales.value !== '' ? fmtMoney(s) : '');
    setValue('boh', sales.value !== '' ? fmtMoney(boh) : '');
    setValue('foh', sales.value !== '' ? fmtMoney(foh) : '');
    setValue('outParty', party > 0 ? fmtMoney(party) : '');
    setValue('outCash', c > 0 ? fmtMoney(c) : '');
    setValue('tips', hasMoney ? fmtMoney(tips) : '');

    currentTipValue = hasMoney ? tips : 0;
    const negative = hasMoney && round2(tips) < 0;
    $('warningBox').classList.toggle('show', negative);
    $('tipsOutput').classList.toggle('negative', negative);
  }

  // ---------- Saved draft ----------
  // What you type is kept, so leaving the tool or a page reload doesn't wipe
  // it mid-shift. Anything older than 2 hours gets the "Old numbers" banner.
  function saveDraft() {
    const parties = largeParties.filter(function(p) { return p.headcount > 0; });
    const anything = startInput.value || endInput.value || owed.value || sales.value || cash.value || parties.length;
    if (!anything) {
      removeKey(KEYS.tipDraft);
      return;
    }
    writeJSON(KEYS.tipDraft, {
      start: startInput.value, end: endInput.value,
      owed: owed.value, sales: sales.value, cash: cash.value, parties: parties,
      savedAt: Date.now()
    });
    // The banner stays up while you type: editing one field shouldn't hide
    // the warning that the OTHER fields are old. Only Keep / Clear dismiss it.
  }

  function restoreDraft() {
    const d = readJSON(KEYS.tipDraft);
    if (!d) return;
    startInput.value = d.start || '';
    endInput.value = d.end || '';
    owed.value = d.owed || '';
    sales.value = d.sales || '';
    cash.value = d.cash || '';
    showCashField(!!cash.value);
    largeParties = Array.isArray(d.parties) ? d.parties.map(function(p) {
      return { headcount: Number(p.headcount) || 0, costPerHead: Number(p.costPerHead) || DEFAULT_COST_PER_HEAD };
    }) : [];
    if (d.savedAt && Date.now() - d.savedAt > OLD_DATA_MS) {
      $('tipDraftAge').textContent = describeAge(d.savedAt);
      draftAlert.classList.add('show');
    }
  }

  // Clears every typed number (and the saved copy). Percentages are a
  // separate setting and stay as they are.
  function clearAll() {
    [startInput, endInput, owed, sales, cash].forEach(function(i) { i.value = ''; i.classList.remove('error'); });
    showCashField(false);
    largeParties = [];
    renderParties();
    removeKey(KEYS.tipDraft);
    draftAlert.classList.remove('show');
    update();
  }

  function onChange() {
    update();
    updatePartyTotals();
    saveDraft();
  }

  [startInput, endInput, owed, sales, cash].forEach(function(input) {
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange); // some phones only fire "change" for time pickers
  });

  $('clearBtn').addEventListener('click', clearAll);
  $('tipDraftClearBtn').addEventListener('click', clearAll);
  $('tipDraftKeepBtn').addEventListener('click', function() {
    saveDraft(); // "these are current" — re-save as of now
    draftAlert.classList.remove('show');
  });

  // ---------- Send to End of Day (hidden unless FEATURES.sendToEndOfDay) ----------
  const sendBtn = $('saveToEndOfDay');
  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      if (sendBtn.disabled) return; // no double entries from a double-tap
      if (currentHours <= 0 && currentTipValue <= 0) {
        sendBtn.textContent = '⚠️ Nothing to send yet';
        setTimeout(function() { sendBtn.textContent = '→ Send to End of Day'; }, 2000);
        return;
      }
      if (currentHours > 0) appendToEndOfDay('hours', currentHours);
      if (currentTipValue > 0) appendToEndOfDay('tips', round2(currentTipValue));
      sendBtn.disabled = true;
      sendBtn.classList.add('done');
      sendBtn.textContent = '✓ Sent to End of Day';
      setTimeout(function() {
        sendBtn.disabled = false;
        sendBtn.classList.remove('done');
        sendBtn.textContent = '→ Send to End of Day';
      }, 2000);
    });
  }

  // ---------- Help ----------
  $('appInfoBtn').onclick = function() { openModal($('tipCalcInfoModal')); };

  // ---------- Start ----------
  restoreDraft();   // before the first calculation
  loadPercents();
  renderParties();
  update();
}

// ============================================
// END OF DAY (tip pool, for the last worker)
// ============================================

function getEndOfDayHTML() {
  return '' +
    '<section class="card">' +
    '  <label class="field"><span class="field-label">Add hours</span>' +
    '    <div class="input-row">' +
    '      <input class="input" type="number" id="hoursInput" placeholder="0.00" step="0.01" min="0" inputmode="decimal">' +
    '      <button class="btn btn-primary" id="addHoursBtn" type="button">Add</button>' +
    '    </div>' +
    '  </label>' +
    '  <label class="field"><span class="field-label">Add tip contribution</span>' +
    '    <div class="input-row">' +
    '      <input class="input" type="number" id="tipsInput" placeholder="0.00" step="0.01" min="0" inputmode="decimal">' +
    '      <button class="btn btn-primary" id="addTipsBtn" type="button">Add</button>' +
    '    </div>' +
    '  </label>' +
    '</section>' +

    '<section class="stats">' +
    '  <div class="stat"><span class="stat-label">Total hours</span><span class="stat-value" id="totalHours">0.00</span></div>' +
    '  <div class="stat"><span class="stat-label">Tip pool</span><span class="stat-value" id="totalTips">$0.00</span></div>' +
    '  <div class="stat accent"><span class="stat-label">Per hour</span><span class="stat-value" id="hourlyRate">$0.00</span></div>' +
    '</section>' +

    '<section class="card">' +
    '  <div class="card-label-row"><span class="card-label">Shares by hours</span><span class="count" id="hoursCount">0 entries</span></div>' +
    '  <div class="rows" id="hoursList"></div>' +
    '  <p class="card-note" id="shareNote"></p>' +
    '</section>' +

    '<section class="card">' +
    '  <div class="card-label-row"><span class="card-label">Tip contributions</span><span class="count" id="tipsCount">0 entries</span></div>' +
    '  <div class="rows" id="tipsList"></div>' +
    '</section>' +

    '<button class="btn btn-secondary btn-block" id="undoBtn" type="button" style="display:none">↶ Undo last delete</button>' +
    '<button class="btn btn-danger-outline btn-block" id="resetBtn" type="button">🗑️ Clear all data</button>' +
    '<div class="pigs" id="pigDisplay" aria-hidden="true"></div>' +

    helpModalHTML('eodInfoModal', [
      ['Add hours', 'Each person\'s hours from the sheet, in row order.'],
      ['Add tip contribution', 'Each person\'s tip contribution from the sheet.'],
      ['Tip pool', 'All tip contributions added together.'],
      ['Per hour', 'Tip pool ÷ total hours.'],
      ['Shares by hours', 'Each hours entry\'s share of the pool, in the same order: write these in the last column. Shares are rounded to the cent and always add up to the pool exactly.'],
      ['Edit / ✕', 'Fix or remove an entry. ↶ Undo brings back the last one removed.'],
      ['Old data', 'If this data is more than 2 hours old, the main screen offers to clear it.']
    ], 'Share = Tip pool × (your hours ÷ total hours)');
}

function initEndOfDay() {
  $('pigDisplay').textContent = pick(PIGS) + pick(DRINKS);

  let hoursEntries = [];
  let tipsEntries = [];
  let lastDeleted = null;

  function normalize(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function(e) {
      return (e && typeof e === 'object') ? { value: Number(e.value) || 0, auto: !!e.auto } : { value: Number(e) || 0, auto: false };
    });
  }

  function load() {
    const data = readJSON(KEYS.endOfDay);
    if (!data) return;
    hoursEntries = normalize(data.hoursEntries);
    tipsEntries = normalize(data.tipsEntries);
  }

  function save() {
    if (hoursEntries.length === 0 && tipsEntries.length === 0) {
      removeKey(KEYS.endOfDay);
      return;
    }
    const existing = readJSON(KEYS.endOfDay);
    writeJSON(KEYS.endOfDay, {
      // Kept from the first entry, so the hub's "old data" check knows its age.
      sessionStartTime: (existing && existing.sessionStartTime) || Date.now(),
      totalHours: sumEntries(hoursEntries),
      totalTips: sumEntries(tipsEntries),
      hoursEntries: hoursEntries,
      tipsEntries: tipsEntries
    });
  }

  function entryRow(i, mainHTML, shareText, kind) {
    return '' +
      '<div class="entry">' +
      '  <span class="entry-num">' + (i + 1) + '</span>' +
      '  <span class="entry-main">' + mainHTML + '</span>' +
      '  <span class="entry-share">' + (shareText || '') + '</span>' +
      '  <span class="entry-actions">' +
      '    <button class="btn btn-secondary" type="button" data-kind="' + kind + '" data-action="edit" data-index="' + i + '">Edit</button>' +
      '    <button class="btn btn-danger-outline" type="button" data-kind="' + kind + '" data-action="delete" data-index="' + i + '" aria-label="Delete entry ' + (i + 1) + '">✕</button>' +
      '  </span>' +
      '</div>';
  }

  function sentBadge(e) {
    return e.auto ? ' <span class="badge">→Sent</span>' : '';
  }

  function render() {
    const totalHours = sumEntries(hoursEntries);
    const pool = sumEntries(tipsEntries);
    const rate = totalHours > 0 ? pool / totalHours : 0;
    const shares = splitPoolByHours(pool, hoursEntries.map(entryValue));

    $('totalHours').textContent = totalHours.toFixed(2);
    $('totalTips').textContent = fmtMoney(pool);
    $('hourlyRate').textContent = fmtMoney(rate);
    $('hoursCount').textContent = hoursEntries.length + (hoursEntries.length === 1 ? ' entry' : ' entries');
    $('tipsCount').textContent = tipsEntries.length + (tipsEntries.length === 1 ? ' entry' : ' entries');

    $('hoursList').innerHTML = hoursEntries.length
      ? hoursEntries.map(function(e, i) {
          return entryRow(i, entryValue(e).toFixed(2) + ' h' + sentBadge(e), shares[i] !== null ? fmtMoney(shares[i]) : '', 'hours');
        }).join('')
      : '<div class="empty-state">No hours added yet</div>';

    $('tipsList').innerHTML = tipsEntries.length
      ? tipsEntries.map(function(e, i) {
          return entryRow(i, fmtMoney(entryValue(e)) + sentBadge(e), '', 'tips');
        }).join('')
      : '<div class="empty-state">No tip contributions added yet</div>';

    $('shareNote').textContent = (hoursEntries.length && pool > 0)
      ? 'Shares add up to ' + fmtMoney(pool) + ' exactly.'
      : (hoursEntries.length ? 'Add tip contributions to see each share.' : '');

    $('undoBtn').style.display = lastDeleted ? '' : 'none';
  }

  function addEntry(inputId, list, allowZero) {
    const input = $(inputId);
    const value = parseFloat(input.value);
    if (input.value === '' || isNaN(value) || value < 0 || (!allowZero && value === 0)) {
      input.classList.add('error');
      return;
    }
    input.classList.remove('error');
    list.push({ value: round2(value), auto: false });
    input.value = '';
    lastDeleted = null;
    save();
    render();
    input.focus();
  }

  $('addHoursBtn').addEventListener('click', function() { addEntry('hoursInput', hoursEntries, false); });
  $('addTipsBtn').addEventListener('click', function() { addEntry('tipsInput', tipsEntries, true); });
  $('hoursInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('addHoursBtn').click(); });
  $('tipsInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('addTipsBtn').click(); });
  ['hoursInput', 'tipsInput'].forEach(function(id) {
    $(id).addEventListener('input', function() { this.classList.remove('error'); });
  });

  // Edit / delete (one listener per list, so re-rendering doesn't pile them up)
  function onListClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const kind = btn.getAttribute('data-kind');
    const index = parseInt(btn.getAttribute('data-index'), 10);
    const list = kind === 'hours' ? hoursEntries : tipsEntries;
    if (!list[index]) return;

    if (btn.getAttribute('data-action') === 'delete') {
      lastDeleted = { kind: kind, index: index, entry: list[index] };
      list.splice(index, 1);
    } else {
      const current = entryValue(list[index]).toFixed(2);
      const label = kind === 'hours' ? 'Edit hours' : 'Edit tip contribution';
      const answer = prompt(label + ' (entry ' + (index + 1) + '):', current);
      if (answer === null) return;
      const value = parseFloat(answer);
      const valid = !isNaN(value) && (kind === 'hours' ? value > 0 : value >= 0);
      if (!valid) return;
      list[index] = { value: round2(value), auto: false };
    }
    save();
    render();
  }
  $('hoursList').addEventListener('click', onListClick);
  $('tipsList').addEventListener('click', onListClick);

  $('undoBtn').addEventListener('click', function() {
    if (!lastDeleted) return;
    const list = lastDeleted.kind === 'hours' ? hoursEntries : tipsEntries;
    list.splice(lastDeleted.index, 0, lastDeleted.entry);
    lastDeleted = null;
    save();
    render();
  });

  $('resetBtn').addEventListener('click', function() {
    if (!confirm('Clear all hours and tips data? This cannot be undone.')) return;
    hoursEntries = [];
    tipsEntries = [];
    lastDeleted = null;
    removeKey(KEYS.endOfDay);
    render();
  });

  $('appInfoBtn').onclick = function() { openModal($('eodInfoModal')); };

  load();
  render();
}

// ============================================
// SERVICE WORKER (offline support)
// ============================================

// Getting updates onto phones: an installed app is often resumed from the
// background rather than reloaded, so it never noticed a new version. Now it
// checks whenever it's opened or brought back to the front, and when a new
// version takes over it reloads once so you're actually running it. That's
// safe here because everything you type is saved as you go.
if ('serviceWorker' in navigator) {
  // Only reload when an existing version is being REPLACED — on the very
  // first visit there's nothing to replace.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', function() {
    navigator.serviceWorker.register('./service-worker.js').then(function(reg) {
      reg.update();
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch(function(err) {
      console.error('Service Worker registration failed:', err);
    });
  });
}

// Stop the page itself from rubber-banding on iOS (lists still scroll).
document.body.addEventListener('touchmove', function(e) {
  if (e.target === document.body) e.preventDefault();
}, { passive: false });

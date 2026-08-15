
/* ---------------------------------------------------------
   API layer — real fetch() calls against the Northstar
   support backend. See backend/README.md for the full
   contract this is written against. No mock data here —
   every lookup is a genuine network round trip.
--------------------------------------------------------- */
const API_BASE_URL = window.NORTHSTAR_API_BASE_URL || 'http://localhost:3001';

class ApiError extends Error {
  constructor(code, message, status, requestId) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function apiRequest(path, { method = 'GET', body, repToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (repToken) headers['Authorization'] = `Bearer ${repToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // fetch() itself throws on network failure (backend down, CORS block,
    // DNS failure) — this never has a JSON body to parse.
    throw new ApiError('NETWORK_ERROR', 'Could not reach the support backend. Check your connection and try again.', 0, null);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `Unexpected response from server (status ${res.status}).`, res.status, res.headers.get('x-request-id'));
  }

  if (!res.ok) {
    const err = payload?.error || {};
    throw new ApiError(err.code || 'UNKNOWN_ERROR', err.message || 'Something went wrong.', res.status, err.requestId);
  }

  return payload.data;
}

const api = {
  getOrder(orderId, { email, repToken } = {}) {
    const qs = email ? `?email=${encodeURIComponent(email)}` : '';
    return apiRequest(`/api/orders/${encodeURIComponent(orderId)}${qs}`, { repToken });
  },
  initiateReturn(orderId, { reason, email, repToken }) {
    return apiRequest(`/api/returns/${encodeURIComponent(orderId)}`, {
      method: 'POST',
      body: { reason, email },
      repToken,
    });
  },
  fileReport(orderId, { message, email, repToken }) {
    return apiRequest(`/api/reports/${encodeURIComponent(orderId)}`, {
      method: 'POST',
      body: { message, email },
      repToken,
    });
  },
};

/* ---------------------------------------------------------
   UI wiring
--------------------------------------------------------- */
const el = {
  form: document.getElementById('lookupForm'),
  orderNumber: document.getElementById('orderNumber'),
  email: document.getElementById('email'),
  emailField: document.getElementById('emailField'),
  actorMode: document.getElementById('actorMode'),
  repTokenField: document.getElementById('repTokenField'),
  repToken: document.getElementById('repToken'),
  btnFind: document.getElementById('btnFind'),
  errorBanner: document.getElementById('errorBanner'),
  orderCard: document.getElementById('orderCard'),
  orderNum: document.getElementById('orderNum'),
  statusBadge: document.getElementById('statusBadge'),
  placedOn: document.getElementById('placedOn'),
  carrierText: document.getElementById('carrierText'),
  etaRow: document.getElementById('etaRow'),
  etaText: document.getElementById('etaText'),
  itemsList: document.getElementById('itemsList'),
  quickActionsWrap: document.getElementById('quickActionsWrap'),
  btnTrack: document.getElementById('btnTrack'),
  btnReturn: document.getElementById('btnReturn'),
  btnReport: document.getElementById('btnReport'),
  trackPanel: document.getElementById('trackPanel'),
  returnsPanel: document.getElementById('returnsPanel'),
  reportPanel: document.getElementById('reportPanel'),
  reportBody: document.getElementById('reportBody'),
  returnsBody: document.getElementById('returnsBody'),
};

let currentOrder = null;   // real API response shape
let currentOrderId = null;
let map, markers = [], routeLine;

const STATUS_LABELS = {
  PENDING: 'Pending', PROCESSING: 'Processing', SHIPPED: 'Shipped',
  PARTIALLY_SHIPPED: 'Partially shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
const ITEM_STATUS_CLASS = { PENDING: '', SHIPPED: 'in-transit', DELIVERED: 'delivered' };
const RETURN_STATUS_LABELS = {
  REQUESTED: 'Return requested', REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded', DENIED: 'Return denied',
};
const RETURN_REASONS = [
  ['wrong_size', 'Wrong size'], ['wrong_item', 'Wrong item'], ['damaged', 'Arrived damaged'],
  ['no_longer_needed', 'No longer needed'], ['quality_issue', 'Quality issue'], ['other', 'Other'],
];

el.actorMode.addEventListener('change', () => {
  const isRep = el.actorMode.value === 'rep';
  el.repTokenField.style.display = isRep ? 'block' : 'none';
  el.emailField.querySelector('label').textContent = isRep ? 'Customer email (optional)' : 'Email';
});

function setLoading(isLoading) {
  el.btnFind.classList.toggle('loading', isLoading);
  el.btnFind.disabled = isLoading;
}

function showError(message) {
  el.orderCard.style.display = 'none';
  el.quickActionsWrap.style.display = 'none';
  closeAllPanels();
  el.errorBanner.style.display = 'block';
  el.errorBanner.textContent = message;
}

// Maps backend error codes to copy a customer/rep actually understands,
// rather than surfacing raw API error strings.
function messageForError(err) {
  switch (err.code) {
    case 'EMAIL_REQUIRED':
      return 'Enter the email used for this order to look it up.';
    case 'EMAIL_MISMATCH':
      return err.message; // backend copy is already user-facing here
    case 'ORDER_NOT_FOUND':
      return `No order found matching "${el.orderNumber.value.trim().toUpperCase()}". Check the order number and try again.`;
    case 'VALIDATION_ERROR':
      return 'That doesn\'t look like a valid order number. Expected format: NS-10492.';
    case 'INVALID_SESSION':
      return 'That rep session token is invalid or has expired.';
    case 'RATE_LIMITED':
      return 'Too many lookups in a short time — please wait a moment and try again.';
    case 'NETWORK_ERROR':
      return err.message;
    default:
      return err.requestId
        ? `Something went wrong on our end. Reference: ${err.requestId}`
        : 'Something went wrong. Please try again.';
  }
}

function pinIcon(state){
  return L.divIcon({
    className: '',
    html: `<div class="pin-icon ${state.toLowerCase()}"></div>`,
    iconSize: [20,20],
    iconAnchor: [10,18],
  });
}

function ensureMap(){
  if (map) return;
  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19
  }).addTo(map);
}

function renderTracking(order){
  if (!order.trackingEvents || order.trackingEvents.length === 0) {
    document.getElementById('trackBody').innerHTML = `<div class="no-tracking-box">No tracking events available for this order yet.</div>`;
    return;
  }
  ensureMap();
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  if (routeLine) map.removeLayer(routeLine);

  const events = order.trackingEvents;
  const latlngs = events.map(e => [e.latitude, e.longitude]);
  routeLine = L.polyline(latlngs, { color: '#6D1B29', weight: 2.5, opacity: .55, dashArray: '1 8' }).addTo(map);
  events.forEach(ev => {
    const marker = L.marker([ev.latitude, ev.longitude], { icon: pinIcon(ev.state) }).addTo(map);
    const time = new Date(ev.occurredAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    marker.bindPopup(`<b>${ev.title}</b><br>${ev.location}<br><span style="font-size:11px;color:#746F55">${time}</span>`);
    markers.push(marker);
  });
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  }, 50);
}

function renderReturns(order){
  const r = order.returns;
  if (r){
    const statusClass = r.status === 'REFUNDED' ? 'refunded' : r.status === 'DENIED' ? 'denied' : 'pending';
    const refundLine = r.refundAmountCents != null
      ? `Refund amount: <b>$${(r.refundAmountCents / 100).toFixed(2)}</b><br>`
      : '';
    const etaLine = r.estimatedRefundAt
      ? `Estimated refund date: <b>${new Date(r.estimatedRefundAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b>`
      : '';
    el.returnsBody.innerHTML = `
      <div class="returns-status-line ${statusClass}"><span class="rs-dot"></span>
        <strong>${RETURN_STATUS_LABELS[r.status] || r.status}</strong>
      </div>
      <div class="returns-detail">
        Return initiated <b>${new Date(r.initiatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</b>
        ${r.reason ? ` · Reason: <b>${RETURN_REASONS.find(([v]) => v === r.reason)?.[1] || r.reason}</b>` : ''}<br>
        ${refundLine}${etaLine}
      </div>`;
    return;
  }

  const reasonOptions = RETURN_REASONS.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  el.returnsBody.innerHTML = `
    <div class="no-return-box">
      <p>No return has been initiated for this order.</p>
      <select class="return-reason-select" id="returnReasonSelect">${reasonOptions}</select>
      <button class="btn-secondary" id="btnRequestReturn">Request a return</button>
      <div class="confirm-note" id="returnConfirm">Return requested — a label has been generated and refund tracking will begin.</div>
      <div class="returns-error-note" id="returnError"></div>
    </div>`;

  document.getElementById('btnRequestReturn').addEventListener('click', async () => {
    const btn = document.getElementById('btnRequestReturn');
    const reason = document.getElementById('returnReasonSelect').value;
    const errorNote = document.getElementById('returnError');
    errorNote.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const isRep = el.actorMode.value === 'rep';
      await api.initiateReturn(currentOrderId, {
        reason,
        email: el.email.value.trim() || undefined,
        repToken: isRep ? el.repToken.value.trim() : undefined,
      });
      document.getElementById('returnConfirm').style.display = 'block';
      btn.style.display = 'none';
      document.getElementById('returnReasonSelect').style.display = 'none';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Request a return';
      errorNote.style.display = 'block';
      errorNote.textContent = err instanceof ApiError ? messageForError(err) : 'Could not submit the return. Please try again.';
    }
  });
}

function renderReportPanel(order, orderId){
  el.reportBody.innerHTML = `
    <p style="margin-bottom: 12px;">Describe the issue and we'll route it to a support rep along with this order's details.</p>
    <textarea class="report-textarea" id="reportMessage" maxlength="2000" placeholder="e.g. The package arrived but one item was missing from the box…"></textarea>
    <div class="report-char-count"><span id="reportCharCount">0</span>/2000</div>
    <button class="btn-secondary" id="btnSubmitReport">Send to support</button>
    <div class="confirm-note" id="reportConfirm">Thanks — this has been sent to support along with your order details.</div>
    <div class="returns-error-note" id="reportError"></div>
  `;

  const textarea = document.getElementById('reportMessage');
  const charCount = document.getElementById('reportCharCount');
  textarea.addEventListener('input', () => { charCount.textContent = textarea.value.length; });

  document.getElementById('btnSubmitReport').addEventListener('click', async () => {
    const btn = document.getElementById('btnSubmitReport');
    const message = textarea.value.trim();
    const errorNote = document.getElementById('reportError');
    errorNote.style.display = 'none';

    if (message.length < 10) {
      errorNote.style.display = 'block';
      errorNote.textContent = 'Please provide a bit more detail (at least 10 characters).';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const isRep = el.actorMode.value === 'rep';
      await api.fileReport(orderId, {
        message,
        email: el.email.value.trim() || undefined,
        repToken: isRep ? el.repToken.value.trim() : undefined,
      });
      document.getElementById('reportConfirm').style.display = 'block';
      btn.style.display = 'none';
      textarea.disabled = true;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Send to support';
      errorNote.style.display = 'block';
      errorNote.textContent = err instanceof ApiError ? messageForError(err) : 'Could not send the report. Please try again.';
    }
  });
}

function closeAllPanels(){
  [el.trackPanel, el.returnsPanel, el.reportPanel].forEach(p => p.style.display = 'none');
  [el.btnTrack, el.btnReturn, el.btnReport].forEach(b => b.classList.remove('active'));
}

function toggle(panel, btn, onOpen){
  const isOpen = panel.style.display === 'block';
  closeAllPanels();
  if (!isOpen){
    panel.style.display = 'block';
    btn.classList.add('active');
    if (onOpen) onOpen();
  }
}

function renderOrder(id, order){
  currentOrder = order;
  currentOrderId = id;
  el.errorBanner.style.display = 'none';
  el.orderCard.style.display = 'block';
  el.quickActionsWrap.style.display = 'block'; // this is what makes Quick Actions visible
  closeAllPanels();

  el.orderNum.textContent = `Order #${id}`;
  el.placedOn.textContent = `Placed on ${new Date(order.placedOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  el.carrierText.textContent = `${order.carrier || 'Carrier'} tracking number: ${order.trackingNumber || '—'}`;

  if (order.status === 'DELIVERED'){
    el.statusBadge.className = 'order-status-badge delivered';
    el.statusBadge.innerHTML = `<i class="fas fa-check-circle"></i> DELIVERED`;
    el.etaRow.style.display = 'none';
  } else {
    el.statusBadge.className = 'order-status-badge in-transit';
    el.statusBadge.innerHTML = `<i class="fas fa-truck"></i> ${(STATUS_LABELS[order.status] || order.status).toUpperCase()}`;
    el.etaRow.style.display = order.eta ? 'flex' : 'none';
    if (order.eta) {
      el.etaText.textContent = new Date(order.eta).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }
  }

  el.itemsList.innerHTML = order.items.map(item => `
    <div class="item-row">
      <span class="item-name"><i class="fas fa-box" style="margin-right: 10px; color: #C05A1F; width: 16px;"></i> ${item.name}</span>
      <span class="item-status ${ITEM_STATUS_CLASS[item.status] || ''}">
        <i class="fas ${item.status === 'DELIVERED' ? 'fa-check-circle' : 'fa-truck'}" style="margin-right: 4px;"></i>
        ${STATUS_LABELS[item.status] || item.status}
      </span>
    </div>`).join('');

  renderReturns(order);
}

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = el.orderNumber.value.trim().toUpperCase();
  const emailVal = el.email.value.trim();
  const isRep = el.actorMode.value === 'rep';
  const repToken = isRep ? el.repToken.value.trim() : undefined;

  if (isRep && !repToken) {
    showError('Enter a rep session token, or switch back to Customer mode.');
    return;
  }

  setLoading(true);
  try {
    const order = await api.getOrder(id, { email: emailVal || undefined, repToken });
    renderOrder(id, order);
  } catch (err) {
    showError(err instanceof ApiError ? messageForError(err) : 'Something went wrong. Please try again.');
  } finally {
    setLoading(false);
  }
});

el.btnTrack.addEventListener('click', () => {
  if (!currentOrder) return;
  toggle(el.trackPanel, el.btnTrack, () => renderTracking(currentOrder));
});
el.btnReturn.addEventListener('click', () => {
  if (!currentOrder) return;
  toggle(el.returnsPanel, el.btnReturn);
});
el.btnReport.addEventListener('click', () => {
  if (!currentOrder) return;
  toggle(el.reportPanel, el.btnReport, () => renderReportPanel(currentOrder, currentOrderId));
});
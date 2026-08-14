/* ---------------------------------------------------------
   Mock "API" data — shaped like real order/returns/tracking
   endpoints would return. Swap for real fetch() calls later.
--------------------------------------------------------- */
const ORDERS = {
  "NS-10492": {
    email: "user@example.com",
    placedOn: "Aug 8, 2026",
    carrier: "FedEx",
    trackingNumber: "48000250030662",
    eta: "Friday, Aug 14",
    status: "in_transit",
    items: [
      { name: "Northstar Classic Hoodie (M / Navy)", icon: "fa-tshirt", status: "delivered" },
      { name: "Trail Running Shoes (10 / Black)", icon: "fa-shoe-prints", status: "in-transit" },
    ],
    returns: null,
    trackingEvents: [
      { title: "Label created", loc: "Northstar Fulfillment — Louisville, KY", lat: 38.2527, lng: -85.7585, time: "Aug 10, 9:02 AM", state: "done" },
      { title: "Picked up by carrier", loc: "Louisville, KY", lat: 38.2000, lng: -85.6500, time: "Aug 10, 4:41 PM", state: "done" },
      { title: "Arrived at sort facility", loc: "Regional Hub — Indianapolis, IN", lat: 39.7684, lng: -86.1581, time: "Aug 11, 2:15 AM", state: "done" },
      { title: "Arrived at local facility", loc: "Local Hub — Columbus, OH", lat: 39.9612, lng: -82.9988, time: "Aug 12, 5:47 AM", state: "current" },
      { title: "Delivered", loc: "Destination address", lat: 40.0150, lng: -83.0300, time: "Pending", state: "pending" },
    ]
  },
  "NS-20871": {
    email: "jordan@example.com",
    placedOn: "Aug 2, 2026",
    carrier: "UPS",
    trackingNumber: "1Z999AA10123456784",
    eta: "Delivered Aug 6",
    status: "delivered",
    items: [
      { name: "Insulated Water Bottle (32oz / Slate)", icon: "fa-flask", status: "delivered" },
    ],
    returns: {
      returnStatus: "refund_pending",
      returnInitiatedAt: "Aug 9, 2026",
      refundAmount: "$24.00",
      estimatedRefundDate: "Aug 16, 2026",
      reason: "Wrong size"
    },
    trackingEvents: [
      { title: "Label created", loc: "Northstar Fulfillment — Reno, NV", lat: 39.5296, lng: -119.8138, time: "Aug 3, 8:00 AM", state: "done" },
      { title: "Out for delivery", loc: "San Francisco, CA", lat: 37.7749, lng: -122.4194, time: "Aug 6, 8:12 AM", state: "done" },
      { title: "Delivered", loc: "Destination address", lat: 37.7849, lng: -122.4294, time: "Aug 6, 1:14 PM", state: "done" },
    ]
  }
};

const el = {
  form: document.getElementById('lookupForm'),
  orderNumber: document.getElementById('orderNumber'),
  email: document.getElementById('email'),
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
  returnsBody: document.getElementById('returnsBody'),
};

let currentOrder = null;
let map, markers = [], routeLine;

function pinIcon(state){
  return L.divIcon({
    className: '',
    html: `<div class="pin-icon ${state}"></div>`,
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
  ensureMap();
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  if (routeLine) map.removeLayer(routeLine);

  const events = order.trackingEvents;
  const latlngs = events.map(e => [e.lat, e.lng]);
  routeLine = L.polyline(latlngs, { color: '#1f5b9e', weight: 2.5, opacity: .5, dashArray: '1 8' }).addTo(map);
  events.forEach(ev => {
    const marker = L.marker([ev.lat, ev.lng], { icon: pinIcon(ev.state) }).addTo(map);
    marker.bindPopup(`<b>${ev.title}</b><br>${ev.loc}<br><span style="font-size:11px;color:#7c8aa0">${ev.time}</span>`);
    markers.push(marker);
  });
  setTimeout(() => {
    map.invalidateSize();
    map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
  }, 50);
}

function renderReturns(order){
  if (order.returns){
    const r = order.returns;
    el.returnsBody.innerHTML = `
      <div class="returns-status-line pending"><span class="rs-dot"></span>
        <strong>Refund pending</strong>
      </div>
      <div class="returns-detail">
        Return initiated <b>${r.returnInitiatedAt}</b> · Reason: <b>${r.reason}</b><br>
        Refund amount: <b>${r.refundAmount}</b><br>
        Estimated refund date: <b>${r.estimatedRefundDate}</b>
      </div>`;
  } else {
    el.returnsBody.innerHTML = `
      <div class="no-return-box">
        <p>No return has been initiated for this order.</p>
        <button class="btn-secondary" id="btnRequestReturn">Request a return</button>
        <div class="confirm-note" id="returnConfirm">Return requested — a label has been generated and refund tracking will begin.</div>
      </div>`;
    document.getElementById('btnRequestReturn').addEventListener('click', () => {
      document.getElementById('returnConfirm').style.display = 'block';
      document.getElementById('btnRequestReturn').disabled = true;
      document.getElementById('btnRequestReturn').style.opacity = '.5';
    });
  }
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
  el.errorBanner.style.display = 'none';
  el.orderCard.style.display = 'block';
  el.quickActionsWrap.style.display = 'block';
  closeAllPanels();

  el.orderNum.textContent = `Order #${id}`;
  el.placedOn.textContent = `Placed on ${order.placedOn}`;
  el.carrierText.textContent = `${order.carrier} tracking number: ${order.trackingNumber}`;

  if (order.status === 'delivered'){
    el.statusBadge.className = 'order-status-badge delivered';
    el.statusBadge.innerHTML = `<i class="fas fa-check-circle"></i> ${order.eta.toUpperCase()}`;
    el.etaRow.style.display = 'none';
  } else {
    el.statusBadge.className = 'order-status-badge in-transit';
    el.statusBadge.innerHTML = `<i class="fas fa-truck"></i> IN TRANSIT`;
    el.etaRow.style.display = 'flex';
    el.etaText.textContent = order.eta;
  }

  el.itemsList.innerHTML = order.items.map(item => `
    <div class="item-row">
      <span class="item-name"><i class="fas ${item.icon}" style="margin-right: 10px; color: #47648b; width: 16px;"></i> ${item.name}</span>
      <span class="item-status ${item.status}">
        <i class="fas ${item.status === 'delivered' ? 'fa-check-circle' : 'fa-truck'}" style="margin-right: 4px;"></i>
        ${item.status === 'delivered' ? 'Delivered' : 'In Transit'}
      </span>
    </div>`).join('');

  renderReturns(order);
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const id = el.orderNumber.value.trim().toUpperCase();
  const emailVal = el.email.value.trim().toLowerCase();
  const order = ORDERS[id];

  if (!order){
    el.orderCard.style.display = 'none';
    el.quickActionsWrap.style.display = 'none';
    closeAllPanels();
    el.errorBanner.style.display = 'block';
    el.errorBanner.textContent = `No order found matching "${id}". Check the order number and try again.`;
    return;
  }
  if (order.email.toLowerCase() !== emailVal){
    el.orderCard.style.display = 'none';
    el.quickActionsWrap.style.display = 'none';
    closeAllPanels();
    el.errorBanner.style.display = 'block';
    el.errorBanner.textContent = `Order ${id} found, but the email doesn't match our records for this order.`;
    return;
  }
  renderOrder(id, order);
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
  toggle(el.reportPanel, el.btnReport);
});

// Load the default demo order on first render
renderOrder('NS-10492', ORDERS['NS-10492']);

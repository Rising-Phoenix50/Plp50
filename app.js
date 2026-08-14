document.addEventListener("DOMContentLoaded", () => {
  // Mock order database
  const ordersDatabase = {
    "NS-10492": {
      orderNumber: "NS-10492",
      email: "user@example.com",
      status: "IN TRANSIT",
      statusClass: "in-transit",
      placedDate: "Aug 8, 2026",
      trackingNumber: "48000250030662",
      carrierUrl: "https://www.fedex.com/fedextrack/?trknbr=48000250030662",
      estimatedDelivery: "Friday, Aug 14",
      items: [
        {
          name: "Northstar Classic Hoodie (M / Navy)",
          icon: "fa-tshirt",
          status: "Delivered",
          statusClass: "delivered",
          statusIcon: "fa-check-circle",
          returnable: true
        },
        {
          name: "Trail Running Shoes (10 / Black)",
          icon: "fa-shoe-prints",
          status: "In Transit",
          statusClass: "in-transit",
          statusIcon: "fa-truck",
          returnable: false
        }
      ]
    }
  };

  // Currently loaded order state
  let currentOrder = ordersDatabase["NS-10492"];

  // DOM Elements
  const orderInput = document.getElementById("orderNumber");
  const emailInput = document.getElementById("email");
  const findBtn = document.querySelector(".btn-find");
  const orderCard = document.querySelector(".order-card");
  const quickActionsContainer = document.querySelector(".quick-actions");

  // Make lookup inputs editable
  if (orderInput && emailInput) {
    orderInput.removeAttribute("readonly");
    emailInput.removeAttribute("readonly");
    orderInput.style.cursor = "text";
    emailInput.style.cursor = "text";

    [orderInput, emailInput].forEach((input) => {
      input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleOrderLookup();
      });
    });
  }

  // Bind Order Lookup Button
  if (findBtn) {
    findBtn.addEventListener("click", handleOrderLookup);
  }

  // Bind Quick Actions via Event Delegation
  if (quickActionsContainer) {
    quickActionsContainer.addEventListener("click", (e) => {
      const actionBtn = e.target.closest(".action-btn");
      if (!actionBtn) return;

      const actionText = actionBtn.textContent.trim().toLowerCase();

      if (actionText.includes("track package")) {
        handleTrackPackage();
      } else if (actionText.includes("start return")) {
        handleStartReturn();
      } else if (actionText.includes("report issue")) {
        handleReportIssue();
      }
    });
  }

  // ==========================================
  // HANDLER 1: Order Lookup
  // ==========================================
  function handleOrderLookup() {
    const orderNum = orderInput.value.trim().toUpperCase();
    const emailVal = emailInput.value.trim().toLowerCase();

    if (!orderNum || !emailVal) {
      alert("Please enter both an Order Number and Email address.");
      return;
    }

    setLookupLoading(true);

    setTimeout(() => {
      const match = ordersDatabase[orderNum];

      if (match && match.email.toLowerCase() === emailVal) {
        currentOrder = match;
        renderOrderDetails(match);
      } else {
        currentOrder = null;
        renderNotFoundMessage(orderNum);
      }

      setLookupLoading(false);
    }, 500);
  }

  // ==========================================
  // HANDLER 2: Track Package
  // ==========================================
  function handleTrackPackage() {
    if (!currentOrder) {
      alert("Please look up a valid order first before tracking.");
      return;
    }

    if (currentOrder.carrierUrl) {
      window.open(currentOrder.carrierUrl, "_blank", "noopener,noreferrer");
    } else {
      alert(`Tracking number ${currentOrder.trackingNumber} for Order #${currentOrder.orderNumber}.`);
    }
  }

  // ==========================================
  // HANDLER 3: Start Return / Refund
  // ==========================================
  function handleStartReturn() {
    if (!currentOrder) {
      alert("Please look up a valid order first.");
      return;
    }

    const returnableItems = currentOrder.items.filter((item) => item.returnable);

    if (returnableItems.length === 0) {
      alert(`Order #${currentOrder.orderNumber} has no delivered items eligible for return at this time.`);
      return;
    }

    const itemNames = returnableItems.map((i) => `• ${i.name}`).join("\n");
    const confirmReturn = confirm(
      `Eligible items for return/refund on Order #${currentOrder.orderNumber}:\n\n${itemNames}\n\nWould you like to initiate a return request for these items?`
    );

    if (confirmReturn) {
      alert(`Return request initialized for Order #${currentOrder.orderNumber}. A return shipping label has been sent to ${currentOrder.email}.`);
    }
  }

  // ==========================================
  // HANDLER 4: Report Issue
  // ==========================================
  function handleReportIssue() {
    if (!currentOrder) {
      alert("Please look up a valid order first.");
      return;
    }

    const issueReason = prompt(
      `Reporting issue for Order #${currentOrder.orderNumber}.\n\nPlease describe the issue (e.g., damaged item, missing package, wrong size):`
    );

    if (issueReason && issueReason.trim() !== "") {
      alert(`Issue reported successfully for Order #${currentOrder.orderNumber}.\nSupport Ticket ID: #TK-${Math.floor(100000 + Math.random() * 900000)}\nOur team will contact ${currentOrder.email} within 24 hours.`);
    }
  }

  // ==========================================
  // Helper Renderers & UI Utilities
  // ==========================================
  function setLookupLoading(isLoading) {
    if (isLoading) {
      findBtn.style.opacity = "0.7";
      findBtn.style.pointerEvents = "none";
      findBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Searching...`;
    } else {
      findBtn.style.opacity = "1";
      findBtn.style.pointerEvents = "auto";
      findBtn.innerHTML = `<i class="fas fa-arrow-right"></i> Find Order`;
    }
  }

  function renderOrderDetails(order) {
    const itemsHTML = order.items
      .map(
        (item) => `
        <div class="item-row">
            <span class="item-name">
                <i class="fas ${item.icon}" style="margin-right: 10px; color: #47648b; width: 16px;"></i> 
                ${item.name}
            </span>
            <span class="item-status ${item.statusClass}">
                <i class="fas ${item.statusIcon}" style="margin-right: 4px;"></i> 
                ${item.status}
            </span>
        </div>
    `
      )
      .join("");

    orderCard.innerHTML = `
        <div class="order-header">
            <span class="order-number">Order #${order.orderNumber}</span>
            <span class="order-status-badge ${order.statusClass}">
                <i class="fas ${order.statusClass === 'delivered' ? 'fa-check-circle' : 'fa-truck'}"></i> ${order.status}
            </span>
        </div>
        <div class="order-meta">
            <span><i class="far fa-calendar-alt"></i> Placed on ${order.placedDate}</span>
            <span class="fedex"><i class="fas fa-shipping-fast"></i> FedEx tracking number: ${order.trackingNumber}</span>
        </div>
        <div class="order-meta" style="margin-top: -4px;">
            <span><i class="far fa-clock"></i> Estimated delivery: <strong>${order.estimatedDelivery}</strong></span>
        </div>
        <div class="items-list">
            ${itemsHTML}
        </div>
    `;
  }

  function renderNotFoundMessage(orderNum) {
    orderCard.innerHTML = `
        <div style="text-align: center; padding: 20px 10px; color: #64748b;">
            <i class="fas fa-exclamation-circle" style="font-size: 32px; color: #e11d48; margin-bottom: 10px;"></i>
            <h3 style="font-size: 16px; font-weight: 600; color: #1e334f; margin-bottom: 4px;">Order Not Found</h3>
            <p style="font-size: 13px;">We couldn't find order <strong>${orderNum}</strong> matching that email address. Please check your details and try again.</p>
        </div>
    `;
  }
});
const basePrice = 159.9;

const formatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const summaryContainer = document.getElementById("upsell-summary");
const totalPriceEl = document.getElementById("total-price");
const emailInput = document.getElementById("email-input");
const phoneInput = document.getElementById("phone-input");
const emailError = document.getElementById("email-error");
const phoneError = document.getElementById("phone-error");
const checkoutFeedback = document.getElementById("checkout-feedback");
const checkoutLoadingOverlay = document.getElementById("checkout-loading-overlay");
const continueButton = document.querySelector(".continue-btn");
const checkoutMainStep = document.getElementById("checkout-main-step");
const cardStep = document.getElementById("card-step");
const backFromCardButton = document.getElementById("card-back-btn");
const pixStep = document.getElementById("pix-step");
const backFromPixButton = document.getElementById("pix-back-btn");
const pixCodeInput = document.getElementById("pix-code-input");
const pixQrImage = document.getElementById("pix-qr-image");
const pixCopyButton = document.getElementById("pix-copy-btn");
const pixConfirmButton = document.querySelector(".pix-confirm-btn");
const pixTimerEl = document.getElementById("pix-timer");
const pixProgressFill = document.getElementById("pix-progress-fill");
const pixSuccessBlock = document.getElementById("pix-success");
const cardNumberInput = document.getElementById("card-number");
const cardExpiryInput = document.getElementById("card-expiry");
const cardCvvInput = document.getElementById("card-cvv");
const cardConfirmButton = document.querySelector(".card-confirm-btn");
const countryButton = document.getElementById("country-btn");
const dddButton = document.getElementById("ddd-btn");
const countryDropdown = document.getElementById("country-dropdown");
const dddDropdown = document.getElementById("ddd-dropdown");
const countryList = document.getElementById("country-list");
const dddList = document.getElementById("ddd-list");
const countrySearchInput = document.getElementById("country-search");
const dddSearchInput = document.getElementById("ddd-search");
let pixTimerInterval = null;
let pixStatusInterval = null;
let selectedDddCode = "";
let checkoutRequestInFlight = false;
let currentPixSession = null;
let hasTrackedInitiateCheckout = false;
let hasTrackedPurchase = false;
let currentPurchaseEventId = null;
const trackedUpsellAddToCart = new Set();

function initializeFacebookPixel() {
  const pixelId = String(window.FACEBOOK_PIXEL_ID || "").trim();
  if (!pixelId) {
    return false;
  }

  if (!window.fbq) {
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod
          ? n.callMethod.apply(n, arguments)
          : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  }

  try {
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
    return true;
  } catch {
    return false;
  }
}

function normalizeAmountValue(value) {
  if (value == null) {
    return null;
  }

  const numericValue = typeof value === "string"
    ? Number(value.replace(/\s+/g, "").replace(".", "").replace(",", ".").replace(/[^\d.-]/g, ""))
    : Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Number(numericValue.toFixed(2));
}

function resolveAmountValueFromResponse(responseData) {
  if (!responseData || typeof responseData !== "object") {
    return null;
  }

  const candidatesInCents = [
    responseData?.amountCents,
    responseData?.amount_cents,
    responseData?.totalAmountCents,
    responseData?.total_amount_cents,
    responseData?.paidAmountCents,
    responseData?.paid_amount_cents,
    responseData?.metadata?.total_amount_cents,
    responseData?.data?.amountCents,
    responseData?.data?.amount_cents,
    responseData?.data?.totalAmountCents,
    responseData?.data?.total_amount_cents,
    responseData?.data?.paidAmountCents,
    responseData?.data?.paid_amount_cents,
  ];

  for (const candidate of candidatesInCents) {
    const normalizedCents = normalizeAmountValue(candidate);
    if (normalizedCents != null) {
      return Number((normalizedCents / 100).toFixed(2));
    }
  }

  const candidatesInCurrency = [
    responseData?.amount,
    responseData?.total,
    responseData?.totalAmount,
    responseData?.total_amount,
    responseData?.paidAmount,
    responseData?.paid_amount,
    responseData?.value,
    responseData?.price,
    responseData?.data?.amount,
    responseData?.data?.total,
    responseData?.data?.totalAmount,
    responseData?.data?.total_amount,
    responseData?.data?.paidAmount,
    responseData?.data?.paid_amount,
    responseData?.data?.value,
    responseData?.data?.price,
  ];

  for (const candidate of candidatesInCurrency) {
    const normalized = normalizeAmountValue(candidate);
    if (normalized != null) {
      return normalized;
    }
  }

  return null;
}

function getCheckoutAnalyticsPayload(purchaseValue = null) {
  const orderItems = getSelectedOrderItems();
  const amountCents = orderItems.reduce(
    (sum, item) => sum + Number(item.unitPriceCents || 0) * Number(item.quantity || 1),
    0
  );
  const fallbackValue = Number((amountCents / 100).toFixed(2));
  const normalizedPurchaseValue = normalizeAmountValue(purchaseValue);

  return {
    currency: "BRL",
    value: normalizedPurchaseValue ?? fallbackValue,
    num_items: orderItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
    content_name: "Combo Salva Universitario - Semestral",
    content_type: "product",
    contents: orderItems.map((item) => ({
      id: String(item.title || "item"),
      quantity: Number(item.quantity || 1),
      item_price: Number(((Number(item.unitPriceCents || 0)) / 100).toFixed(2)),
    })),
  };
}

function buildMetaEventId(prefix = "evt") {
  const base = currentPixSession?.providerOrderId || currentPixSession?.orderId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${String(base).replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function trackFacebookEvent(eventName, payload = {}, options = {}) {
  if (typeof window.fbq !== "function") {
    return;
  }

  try {
    if (options && typeof options === "object" && Object.keys(options).length > 0) {
      window.fbq("track", eventName, payload, options);
      return;
    }

    window.fbq("track", eventName, payload);
  } catch {
    // Evita quebrar checkout caso pixel falhe.
  }
}

function resolveFirstOfferCheckoutEndpoint() {
  const configuredProxyBase = String(window.BABYLON_PROXY_URL || "").trim().replace(/\/$/, "");
  if (configuredProxyBase) {
    return `${configuredProxyBase}/api/public/first-offer/checkout`;
  }

  const isStaticServer = window.location.protocol === "file:"
    || window.location.port === "5500"
    || window.location.port === "5501";

  if (isStaticServer) {
    return "https://api.combosalvauniversitario.site/api/public/first-offer/checkout";
  }

  return "https://api.combosalvauniversitario.site/api/public/first-offer/checkout";
}

const firstOfferCheckoutEndpoint = resolveFirstOfferCheckoutEndpoint();

function resolveFirstOfferCheckoutStatusEndpoint() {
  const configuredProxyBase = String(window.BABYLON_PROXY_URL || "").trim().replace(/\/$/, "");
  if (configuredProxyBase) {
    return `${configuredProxyBase}/api/public/first-offer/checkout-status`;
  }

  const isStaticServer = window.location.protocol === "file:"
    || window.location.port === "5500"
    || window.location.port === "5501";

  if (isStaticServer) {
    return "https://api.combosalvauniversitario.site/api/public/first-offer/checkout-status";
  }

  return "https://api.combosalvauniversitario.site/api/public/first-offer/checkout-status";
}

const firstOfferCheckoutStatusEndpoint = resolveFirstOfferCheckoutStatusEndpoint();

function resolveBabylonTransactionsEndpoint() {
  const configuredProxyBase = String(window.BABYLON_PROXY_URL || "").trim().replace(/\/$/, "");
  if (configuredProxyBase) {
    return `${configuredProxyBase}/api/babylon/transactions`;
  }

  const isStaticServer = window.location.protocol === "file:"
    || window.location.port === "5500"
    || window.location.port === "5501";

  if (isStaticServer) {
    return "https://api.combosalvauniversitario.site/api/babylon/transactions";
  }

  return "https://api.combosalvauniversitario.site/api/babylon/transactions";
}

const babylonTransactionsEndpoint = resolveBabylonTransactionsEndpoint();
initializeFacebookPixel();

const blockedEmailDomains = new Set(["ffevgfr.com"]);

const countries = [
  { name: "Brasil", code: "+55", flag: "https://flagcdn.com/w40/br.png" },
  { name: "Estados Unidos", code: "+1", flag: "https://flagcdn.com/w40/us.png" },
  { name: "Canadá", code: "+1", flag: "https://flagcdn.com/w40/ca.png" },
  { name: "Portugal", code: "+351", flag: "https://flagcdn.com/w40/pt.png" },
  { name: "Espanha", code: "+34", flag: "https://flagcdn.com/w40/es.png" },
  { name: "França", code: "+33", flag: "https://flagcdn.com/w40/fr.png" },
  { name: "Alemanha", code: "+49", flag: "https://flagcdn.com/w40/de.png" },
  { name: "Itália", code: "+39", flag: "https://flagcdn.com/w40/it.png" },
  { name: "Reino Unido", code: "+44", flag: "https://flagcdn.com/w40/gb.png" },
  { name: "Argentina", code: "+54", flag: "https://flagcdn.com/w40/ar.png" },
  { name: "Chile", code: "+56", flag: "https://flagcdn.com/w40/cl.png" },
  { name: "Colômbia", code: "+57", flag: "https://flagcdn.com/w40/co.png" },
  { name: "México", code: "+52", flag: "https://flagcdn.com/w40/mx.png" },
  { name: "Peru", code: "+51", flag: "https://flagcdn.com/w40/pe.png" },
  { name: "Uruguai", code: "+598", flag: "https://flagcdn.com/w40/uy.png" },
  { name: "Equador", code: "+593", flag: "https://flagcdn.com/w40/ec.png" },
  { name: "Angola", code: "+244", flag: "https://flagcdn.com/w40/ao.png" },
  { name: "Moçambique", code: "+258", flag: "https://flagcdn.com/w40/mz.png" },
];

const dddCodes = [
  ["11", "São Paulo (SP)"], ["12", "São José dos Campos (SP)"], ["13", "Santos (SP)"], ["14", "Bauru (SP)"],
  ["15", "Sorocaba (SP)"], ["16", "Ribeirão Preto (SP)"], ["17", "São José do Rio Preto (SP)"], ["18", "Presidente Prudente (SP)"],
  ["19", "Campinas (SP)"], ["21", "Rio de Janeiro (RJ)"], ["22", "Campos dos Goytacazes (RJ)"], ["24", "Volta Redonda (RJ)"],
  ["27", "Vitória (ES)"], ["28", "Cachoeiro de Itapemirim (ES)"], ["31", "Belo Horizonte (MG)"], ["32", "Juiz de Fora (MG)"],
  ["33", "Governador Valadares (MG)"], ["34", "Uberlândia (MG)"], ["35", "Poços de Caldas (MG)"], ["37", "Divinópolis (MG)"],
  ["38", "Montes Claros (MG)"], ["41", "Curitiba (PR)"], ["42", "Ponta Grossa (PR)"], ["43", "Londrina (PR)"],
  ["44", "Maringá (PR)"], ["45", "Cascavel (PR)"], ["46", "Francisco Beltrão (PR)"], ["47", "Joinville (SC)"],
  ["48", "Florianópolis (SC)"], ["49", "Chapecó (SC)"], ["51", "Porto Alegre (RS)"], ["53", "Pelotas (RS)"],
  ["54", "Caxias do Sul (RS)"], ["55", "Santa Maria (RS)"], ["61", "Brasília (DF)"], ["62", "Goiânia (GO)"],
  ["63", "Palmas (TO)"], ["64", "Rio Verde (GO)"], ["65", "Cuiabá (MT)"], ["66", "Rondonópolis (MT)"],
  ["67", "Campo Grande (MS)"], ["68", "Rio Branco (AC)"], ["69", "Porto Velho (RO)"], ["71", "Salvador (BA)"],
  ["73", "Ilhéus (BA)"], ["74", "Juazeiro (BA)"], ["75", "Feira de Santana (BA)"], ["77", "Vitória da Conquista (BA)"],
  ["79", "Aracaju (SE)"], ["81", "Recife (PE)"], ["82", "Maceió (AL)"], ["83", "João Pessoa (PB)"],
  ["84", "Natal (RN)"], ["85", "Fortaleza (CE)"], ["86", "Teresina (PI)"], ["87", "Petrolina (PE)"],
  ["88", "Juazeiro do Norte (CE)"], ["89", "Picos (PI)"], ["91", "Belém (PA)"], ["92", "Manaus (AM)"],
  ["93", "Santarém (PA)"], ["94", "Marabá (PA)"], ["95", "Boa Vista (RR)"], ["96", "Macapá (AP)"],
  ["97", "Coari (AM)"], ["98", "São Luís (MA)"], ["99", "Imperatriz (MA)"]
];

function closePhoneDropdowns() {
  countryDropdown?.classList.remove("open");
  dddDropdown?.classList.remove("open");
  countryButton?.setAttribute("aria-expanded", "false");
  dddButton?.setAttribute("aria-expanded", "false");
}

function toggleDropdown(type) {
  const isCountry = type === "country";
  const targetDropdown = isCountry ? countryDropdown : dddDropdown;
  const targetButton = isCountry ? countryButton : dddButton;
  const otherDropdown = isCountry ? dddDropdown : countryDropdown;
  const otherButton = isCountry ? dddButton : countryButton;

  const willOpen = !targetDropdown?.classList.contains("open");
  otherDropdown?.classList.remove("open");
  otherButton?.setAttribute("aria-expanded", "false");

  if (willOpen) {
    targetDropdown?.classList.add("open");
    targetButton?.setAttribute("aria-expanded", "true");

    if (isCountry && countrySearchInput) {
      countrySearchInput.value = "";
      renderCountryOptions("");
      countrySearchInput.focus();
    }

    if (!isCountry && dddSearchInput) {
      dddSearchInput.value = "";
      renderDddOptions("");
      dddSearchInput.focus();
    }
  } else {
    targetDropdown?.classList.remove("open");
    targetButton?.setAttribute("aria-expanded", "false");
  }
}

function renderCountryOptions(searchTerm = "") {
  if (!countryList) {
    return;
  }

  countryList.innerHTML = "";

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = countries.filter((country) =>
    `${country.name} ${country.code}`.toLowerCase().includes(normalizedSearch)
  );

  filtered.forEach((country) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phone-option";
    button.role = "option";
    button.innerHTML = `<img src="${country.flag}" alt="${country.name}"><span>${country.name}</span><span>${country.code}</span>`;

    button.addEventListener("click", () => {
      if (countryButton) {
        countryButton.innerHTML = `<img src="${country.flag}" alt="${country.name}"><span>${country.code}</span><em>▾</em>`;
      }
      closePhoneDropdowns();
    });

    countryList.appendChild(button);
  });
}

function renderDddOptions(searchTerm = "") {
  if (!dddList) {
    return;
  }

  dddList.innerHTML = "";

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = dddCodes.filter(([code, city]) =>
    `${code} ${city}`.toLowerCase().includes(normalizedSearch)
  );

  filtered.forEach(([code, city]) => {
    const cityMatch = city.match(/^(.*)\s\(([A-Z]{2})\)$/);
    const cityName = cityMatch ? cityMatch[1] : city;
    const stateCode = cityMatch ? cityMatch[2] : "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "phone-option";
    if (selectedDddCode === code) {
      button.classList.add("selected");
      button.setAttribute("aria-selected", "true");
    } else {
      button.setAttribute("aria-selected", "false");
    }
    button.role = "option";
    button.innerHTML = `<span class="phone-option-code">${code}</span><span class="phone-option-text">${cityName}${stateCode ? `<span class="phone-option-state"> (${stateCode})</span>` : ""}</span>`;

    button.addEventListener("click", () => {
      if (dddButton) {
        dddButton.innerHTML = `<span>${code}</span><em>▾</em>`;
        dddButton.classList.add("has-value");
      }
      selectedDddCode = code;
      closePhoneDropdowns();
      renderDddOptions(dddSearchInput?.value || "");
    });

    dddList.appendChild(button);
  });
}

if (countryButton) {
  countryButton.addEventListener("click", () => toggleDropdown("country"));
}

if (dddButton) {
  dddButton.addEventListener("click", () => toggleDropdown("ddd"));
}

if (dddSearchInput) {
  dddSearchInput.addEventListener("input", () => {
    renderDddOptions(dddSearchInput.value);
  });
}

if (countrySearchInput) {
  countrySearchInput.addEventListener("input", () => {
    renderCountryOptions(countrySearchInput.value);
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (!target.closest(".phone-combo")) {
    closePhoneDropdowns();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePhoneDropdowns();
  }
});

renderCountryOptions();
renderDddOptions();

const items = [...document.querySelectorAll(".upsell")]
  .map((element) => {
    const checkbox = element.querySelector(".upsell-check");
    const pickRow = element.querySelector(".upsell-pick");
    const title = element.dataset.title?.trim();
    const price = Number(element.dataset.price);

    if (!checkbox || !pickRow || !title || Number.isNaN(price)) {
      return null;
    }

    return {
      element,
      checkbox,
      pickRow,
      title,
      price,
      selected: false,
    };
  })
  .filter(Boolean);

function renderSummary() {
  if (!summaryContainer || !totalPriceEl) {
    return;
  }

  const selectedItems = items.filter((item) => item.selected);

  summaryContainer.innerHTML = "";

  selectedItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "upsell-line";

    const name = document.createElement("span");
    name.textContent = item.title;

    const value = document.createElement("span");
    value.textContent = `+${formatter.format(item.price)}`;

    row.append(name, value);
    summaryContainer.appendChild(row);
  });

  const total = selectedItems.reduce((sum, item) => sum + item.price, basePrice);
  totalPriceEl.textContent = formatter.format(total);
}

items.forEach((item) => {
  item.selected = item.checkbox.checked;
  item.pickRow.classList.toggle("active", item.selected);

  item.checkbox.addEventListener("change", () => {
    item.selected = item.checkbox.checked;
    item.pickRow.classList.toggle("active", item.selected);

    if (item.selected && !trackedUpsellAddToCart.has(item.title)) {
      trackedUpsellAddToCart.add(item.title);
      trackFacebookEvent("AddToCart", {
        currency: "BRL",
        value: Number(item.price.toFixed(2)),
        content_name: item.title,
        content_type: "product",
        contents: [{
          id: item.title,
          quantity: 1,
          item_price: Number(item.price.toFixed(2)),
        }],
      });
    }

    renderSummary();
  });
});

const paymentButtons = document.querySelectorAll(".pay-method");
paymentButtons.forEach((button) => {
  button.addEventListener("click", () => {
    paymentButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

function openCardStep() {
  checkoutMainStep?.classList.add("is-hidden");
  pixStep?.classList.add("is-hidden");
  cardStep?.classList.remove("is-hidden");
}

function openPixStep() {
  checkoutMainStep?.classList.add("is-hidden");
  cardStep?.classList.add("is-hidden");
  pixStep?.classList.remove("is-hidden");
  if (pixSuccessBlock) {
    pixSuccessBlock.classList.add("is-hidden");
  }
  startPixTimer();
}

function setCheckoutFeedback(message) {
  if (!checkoutFeedback) {
    return;
  }

  checkoutFeedback.textContent = message || "";
}

function setCardPaymentFeedback(message) {
  if (!cardConfirmButton) {
    return;
  }

  let feedbackEl = document.getElementById("card-payment-feedback");
  if (!feedbackEl) {
    feedbackEl = document.createElement("p");
    feedbackEl.id = "card-payment-feedback";
    feedbackEl.className = "field-error";
    feedbackEl.setAttribute("aria-live", "polite");
    cardConfirmButton.insertAdjacentElement("afterend", feedbackEl);
  }

  feedbackEl.textContent = message || "";
}

function setContinueLoading(isLoading) {
  if (!continueButton) {
    return;
  }

  checkoutRequestInFlight = isLoading;
  continueButton.disabled = isLoading;
  continueButton.style.opacity = isLoading ? "0.75" : "1";
  continueButton.style.cursor = isLoading ? "wait" : "pointer";

  if (checkoutLoadingOverlay) {
    checkoutLoadingOverlay.classList.toggle("visible", isLoading);
    checkoutLoadingOverlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
  }

  const label = continueButton.querySelector("span:last-child");
  if (label) {
    label.textContent = isLoading ? "GERANDO PAGAMENTO..." : "CONTINUAR";
  }
}

function getSelectedOrderItems() {
  const selectedItems = items.filter((item) => item.selected);
  const baseItem = {
    title: "Combo Salva Universitario - Semestral",
    unitPriceCents: Math.round(basePrice * 100),
    quantity: 1,
  };

  return [
    baseItem,
    ...selectedItems.map((item) => ({
      title: item.title,
      unitPriceCents: Math.round(item.price * 100),
      quantity: 1,
    })),
  ];
}

function getCustomerPhoneForCheckout() {
  const phoneDigits = phoneInput?.value.replace(/\D/g, "") || "";
  const countryCode = countryButton?.querySelector("span")?.textContent?.replace(/\D/g, "") || "55";
  const ddd = selectedDddCode || "";

  if (countryCode === "55") {
    return `${countryCode}${ddd}${phoneDigits}`;
  }

  return `${countryCode}${phoneDigits}`;
}

function buildQrUrlFromPixCode(pixCode) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pixCode)}`;
}

function collectStringValues(value, bucket = [], depth = 0) {
  if (depth > 6 || value == null) {
    return bucket;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      bucket.push(trimmed);
    }
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, bucket, depth + 1));
    return bucket;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, bucket, depth + 1));
  }

  return bucket;
}

function looksLikePixCode(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.replace(/\s+/g, "").toUpperCase();
  if (normalized.length < 40) {
    return false;
  }

  return normalized.startsWith("000201")
    || normalized.includes("BR.GOV.BCB.PIX")
    || normalized.includes("PIX");
}

function looksLikeQrImage(value) {
  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();
  return text.startsWith("data:image/")
    || /^https?:\/\//i.test(text) && /(qr|qrcode|pix)/i.test(text);
}

function resolveCheckoutArtifacts(responseData) {
  const candidatesPixCode = [
    responseData?.pixCopyPasteCode,
    responseData?.pixCode,
    responseData?.pix_code,
    responseData?.pix?.copyAndPaste,
    responseData?.pix?.copy_paste,
    responseData?.pix?.copyPaste,
    responseData?.pix?.payload,
    responseData?.pix?.emv,
    responseData?.pix?.code,
    responseData?.data?.pix?.copyAndPaste,
    responseData?.data?.pix?.copy_paste,
    responseData?.data?.pix?.copyPaste,
    responseData?.data?.pix?.payload,
    responseData?.data?.pix?.emv,
    responseData?.data?.pix?.code,
    responseData?.pixCopiaECola,
    responseData?.brCode,
    responseData?.br_code,
    responseData?.qrCodeText,
    responseData?.qr_code_text,
  ].filter(Boolean);

  const candidatesQr = [
    responseData?.pixQrUrl,
    responseData?.pix?.qrCodeUrl,
    responseData?.pix?.qr_code_url,
    responseData?.pix?.qrCodeImage,
    responseData?.pix?.qr_code_image,
    responseData?.data?.pix?.qrCodeUrl,
    responseData?.data?.pix?.qr_code_url,
    responseData?.data?.pix?.qrCodeImage,
    responseData?.data?.pix?.qr_code_image,
  ].filter(Boolean);

  const allStrings = collectStringValues(responseData);

  const pixCopyPasteCode = [
    ...candidatesPixCode,
    ...allStrings,
  ].find((value) => looksLikePixCode(String(value)));

  const pixQrUrl = [
    ...candidatesQr,
    ...allStrings,
  ].find((value) => looksLikeQrImage(String(value))) || null;

  return {
    pixCopyPasteCode: pixCopyPasteCode ? String(pixCopyPasteCode).trim() : null,
    pixQrUrl,
  };
}

function applyPixData(pixCopyPasteCode) {
  if (pixCodeInput && pixCopyPasteCode) {
    pixCodeInput.value = pixCopyPasteCode;
  }

  if (!pixQrImage) {
    return;
  }

  if (pixCopyPasteCode) {
    pixQrImage.src = buildQrUrlFromPixCode(pixCopyPasteCode);
    pixQrImage.style.display = "block";
    return;
  }

  pixQrImage.src = "";
  pixQrImage.style.display = "none";
}

function stopPixStatusPolling() {
  if (!pixStatusInterval) {
    return;
  }

  clearInterval(pixStatusInterval);
  pixStatusInterval = null;
}

function applyPixApprovedState() {
  stopPixStatusPolling();
  stopPixTimer();

  if (!hasTrackedPurchase) {
    const amountFromApi = normalizeAmountValue(currentPixSession?.amountValue);
    trackFacebookEvent(
      "Purchase",
      {
        ...getCheckoutAnalyticsPayload(amountFromApi),
        transaction_id: currentPixSession?.providerOrderId || currentPixSession?.orderId || null,
      },
      currentPurchaseEventId ? { eventID: currentPurchaseEventId } : {}
    );
    hasTrackedPurchase = true;
  }

  if (pixConfirmButton) {
    pixConfirmButton.disabled = true;
    pixConfirmButton.style.opacity = "0.75";
    pixConfirmButton.style.cursor = "default";
    pixConfirmButton.textContent = "Pagamento confirmado";
  }

  if (pixSuccessBlock) {
    pixSuccessBlock.classList.remove("is-hidden");
  }
}

async function checkPixPaymentStatus() {
  if (!currentPixSession?.providerOrderId && !currentPixSession?.orderId) {
    return;
  }

  try {
    const params = new URLSearchParams();
    if (currentPixSession.providerOrderId) {
      params.set("providerOrderId", currentPixSession.providerOrderId);
    }
    if (currentPixSession.orderId) {
      params.set("checkoutOrderId", currentPixSession.orderId);
    }
    if (currentPixSession.customerEmail) {
      params.set("payerEmail", currentPixSession.customerEmail);
    }

    const response = await fetch(`${firstOfferCheckoutStatusEndpoint}?${params.toString()}`);
    const payload = await response.json().catch(() => null);
    const status = String(payload?.status || "pending").toLowerCase();
    const amountValueFromStatus = resolveAmountValueFromResponse(payload);
    const approvedStatuses = new Set(["paid", "approved", "succeeded", "completed", "authorized"]);

    if (amountValueFromStatus != null) {
      currentPixSession = {
        ...(currentPixSession || {}),
        amountValue: amountValueFromStatus,
      };
    }

    if (response.ok && approvedStatuses.has(status)) {
      applyPixApprovedState();
    }
  } catch {
    // Silencioso para não poluir UI durante o polling.
  }
}

function startPixStatusPolling(sessionData) {
  stopPixStatusPolling();
  currentPixSession = sessionData || null;
  hasTrackedPurchase = false;
  currentPurchaseEventId = buildMetaEventId("purchase");

  if (pixConfirmButton) {
    pixConfirmButton.disabled = false;
    pixConfirmButton.style.opacity = "1";
    pixConfirmButton.style.cursor = "pointer";
    pixConfirmButton.innerHTML = "<span>✔</span> Confirmar pagamento";
  }

  if (pixSuccessBlock) {
    pixSuccessBlock.classList.add("is-hidden");
  }

  checkPixPaymentStatus();
  pixStatusInterval = setInterval(checkPixPaymentStatus, 4500);
}

async function createFirstOfferCheckout() {
  const customerEmail = emailInput?.value.trim().toLowerCase() || "";
  const customerPhone = getCustomerPhoneForCheckout();
  const orderItems = getSelectedOrderItems();
  const amountCents = orderItems.reduce(
    (sum, item) => sum + Number(item.unitPriceCents || 0) * Number(item.quantity || 1),
    0
  );

  const response = await fetch(firstOfferCheckoutEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      offerName: "Combo semestral",
      amountCents,
      customer: {
        name: customerEmail.split("@")[0] || "Cliente",
        email: customerEmail,
        phone: customerPhone,
      },
      items: [{
        quantity: 1,
        unitPriceCents: amountCents,
      }],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (response.ok && payload?.ok) {
    return payload;
  }

  const shouldFallbackToDirectTransactions = response.status === 404;
  if (!shouldFallbackToDirectTransactions) {
    const endpointHint = `endpoint: ${firstOfferCheckoutEndpoint}`;
    const message = payload?.error
      || payload?.message
      || `Não foi possível iniciar o checkout PIX (HTTP ${response.status}). ${endpointHint}`;
    throw new Error(message);
  }

  const generatedOrderId = (window.crypto && typeof window.crypto.randomUUID === "function")
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  const directPayload = {
    amount: amountCents,
    currency: "BRL",
    payment_method: "PIX",
    paymentMethod: "PIX",
    customer: {
      name: customerEmail.split("@")[0] || "Cliente",
      email: customerEmail,
      phone: customerPhone,
      document: {
        type: "CPF",
        number: "25448606695",
      },
    },
    items: [{
      title: "Combo semestral",
      unitPrice: amountCents,
      quantity: 1,
      externalRef: generatedOrderId,
    }],
    external_id: generatedOrderId,
    externalRef: generatedOrderId,
    metadata: {
      checkout_order_id: generatedOrderId,
      source: "first_offer_public_checkout",
      total_items: orderItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
      total_amount_cents: amountCents,
    },
  };

  const directResponse = await fetch(babylonTransactionsEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(directPayload),
  });

  const directData = await directResponse.json().catch(() => null);
  if (!directResponse.ok || !directData) {
    const endpointHint = `endpoints: ${firstOfferCheckoutEndpoint} e ${babylonTransactionsEndpoint}`;
    const message = directData?.error
      || directData?.message
      || `Não foi possível iniciar o checkout PIX (HTTP ${directResponse.status}). ${endpointHint}`;
    throw new Error(message);
  }

  const artifacts = resolveCheckoutArtifacts(directData);
  return {
    ok: true,
    orderId: generatedOrderId,
    providerOrderId: directData?.id || null,
    gatewayStatus: String(directData?.status || "pending").toLowerCase(),
    pixCopyPasteCode: artifacts.pixCopyPasteCode,
    pixQrUrl: artifacts.pixQrUrl,
    raw: directData,
  };
}

function closeCardStep() {
  checkoutMainStep?.classList.remove("is-hidden");
  cardStep?.classList.add("is-hidden");
  pixStep?.classList.add("is-hidden");
  stopPixStatusPolling();
  stopPixTimer();
}

function startPixTimer() {
  stopPixTimer();

  const totalSeconds = 15 * 60;
  let remainingSeconds = totalSeconds - 13;

  const render = () => {
    const minutes = Math.floor(remainingSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
    if (pixTimerEl) {
      pixTimerEl.textContent = `${minutes}:${seconds}`;
    }

    if (pixProgressFill) {
      const percentage = Math.max(0, (remainingSeconds / totalSeconds) * 100);
      pixProgressFill.style.width = `${percentage}%`;
    }
  };

  render();
  pixTimerInterval = setInterval(() => {
    remainingSeconds = Math.max(0, remainingSeconds - 1);
    render();

    if (remainingSeconds === 0) {
      stopPixTimer();
    }
  }, 1000);
}

function stopPixTimer() {
  if (!pixTimerInterval) {
    return;
  }

  clearInterval(pixTimerInterval);
  pixTimerInterval = null;
}

function setFieldError(input, errorElement, message) {
  if (!input || !errorElement) {
    return;
  }

  errorElement.textContent = message;
  input.classList.toggle("input-invalid", Boolean(message));
}

function formatPhoneValue(value) {
  const digits = value.replace(/\D/g, "").slice(0, 9);

  if (digits.length <= 4) {
    return digits;
  }

  if (digits.length <= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function validatePhone() {
  if (!phoneInput) {
    return true;
  }

  const digits = phoneInput.value.replace(/\D/g, "");
  const isValid = digits.length === 8 || digits.length === 9;

  setFieldError(
    phoneInput,
    phoneError,
    isValid ? "" : "Digite um número válido com 8 ou 9 dígitos"
  );

  return isValid;
}

function validateEmail() {
  if (!emailInput) {
    return true;
  }

  const email = emailInput.value.trim().toLowerCase();
  const basicPattern = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  if (!basicPattern.test(email)) {
    setFieldError(emailInput, emailError, "Digite um e-mail válido");
    return false;
  }

  const domain = email.split("@")[1];
  if (blockedEmailDomains.has(domain)) {
    setFieldError(emailInput, emailError, "Use um e-mail real para continuar");
    return false;
  }

  setFieldError(emailInput, emailError, "");
  return true;
}

if (phoneInput) {
  phoneInput.addEventListener("input", () => {
    phoneInput.value = formatPhoneValue(phoneInput.value);
    if (phoneError?.textContent) {
      validatePhone();
    }
  });

  phoneInput.addEventListener("blur", validatePhone);
}

if (emailInput) {
  emailInput.addEventListener("input", () => {
    if (emailError?.textContent) {
      validateEmail();
    }
  });

  emailInput.addEventListener("blur", validateEmail);
}

if (continueButton) {
  continueButton.addEventListener("click", async () => {
    if (checkoutRequestInFlight) {
      return;
    }

    setCheckoutFeedback("");
    const isEmailValid = validateEmail();
    const isPhoneValid = validatePhone();

    if (!isEmailValid) {
      emailInput?.focus();
      return;
    }

    if (!isPhoneValid) {
      phoneInput?.focus();
      return;
    }

    const activePayment = document.querySelector(".pay-method.active")?.dataset.payment;

    if (!hasTrackedInitiateCheckout) {
      trackFacebookEvent("InitiateCheckout", getCheckoutAnalyticsPayload());
      hasTrackedInitiateCheckout = true;
    }

    if (activePayment === "card") {
      openCardStep();
      return;
    }

    setContinueLoading(true);
    try {
      const checkout = await createFirstOfferCheckout();
      const artifacts = resolveCheckoutArtifacts({
        ...checkout,
        ...(checkout?.raw && typeof checkout.raw === "object" ? checkout.raw : {}),
      });

      if (!artifacts.pixCopyPasteCode) {
        throw new Error("A Babylon não retornou o código PIX desta transação. Tente novamente.");
      }

      applyPixData(artifacts.pixCopyPasteCode);
      const amountValueFromCheckout = resolveAmountValueFromResponse({
        ...checkout,
        ...(checkout?.raw && typeof checkout.raw === "object" ? checkout.raw : {}),
      });
      startPixStatusPolling({
        providerOrderId: checkout?.providerOrderId || checkout?.raw?.provider_order_id || null,
        orderId: checkout?.orderId || null,
        customerEmail: emailInput?.value.trim().toLowerCase() || "",
        amountValue: amountValueFromCheckout,
      });
      openPixStep();
    } catch (error) {
      setCheckoutFeedback(error?.message || "Erro ao gerar pagamento. Tente novamente.");
    } finally {
      setContinueLoading(false);
    }
  });
}

if (backFromCardButton) {
  backFromCardButton.addEventListener("click", () => {
    setCardPaymentFeedback("");
    closeCardStep();
    const cardButton = document.querySelector('.pay-method[data-payment="card"]');
    cardButton?.classList.add("active");
  });
}

if (cardConfirmButton) {
  cardConfirmButton.addEventListener("click", () => {
    setCardPaymentFeedback("Não foi possível processar o pagamento por cartão. Verifique os dados e tente novamente.");
  });
}

if (backFromPixButton) {
  backFromPixButton.addEventListener("click", () => {
    closeCardStep();
    const pixButton = document.querySelector('.pay-method[data-payment="pix"]');
    pixButton?.classList.add("active");
  });
}

if (pixCopyButton && pixCodeInput) {
  pixCopyButton.addEventListener("click", async () => {
    const pixCode = pixCodeInput.value;

    try {
      await navigator.clipboard.writeText(pixCode);
      pixCopyButton.textContent = "Copiado";
      setTimeout(() => {
        pixCopyButton.textContent = "Copiar";
      }, 1500);
    } catch {
      pixCodeInput.select();
      document.execCommand("copy");
      pixCodeInput.setSelectionRange(0, 0);
    }
  });
}

if (pixConfirmButton) {
  pixConfirmButton.addEventListener("click", () => {
    checkPixPaymentStatus();
  });
}

if (cardNumberInput) {
  cardNumberInput.addEventListener("input", () => {
    const digits = cardNumberInput.value.replace(/\D/g, "").slice(0, 16);
    cardNumberInput.value = digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  });
}

if (cardExpiryInput) {
  cardExpiryInput.addEventListener("input", () => {
    const digits = cardExpiryInput.value.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) {
      cardExpiryInput.value = digits;
      return;
    }
    cardExpiryInput.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  });
}

if (cardCvvInput) {
  cardCvvInput.addEventListener("input", () => {
    cardCvvInput.value = cardCvvInput.value.replace(/\D/g, "").slice(0, 4);
  });
}

if (summaryContainer && totalPriceEl) {
  renderSummary();
}

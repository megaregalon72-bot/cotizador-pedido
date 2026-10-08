"use strict";

// CONFIGURACIÓN COMERCIAL. Los precios de envío son precios finales.
const DEFAULT_USD_TO_CRC = 500; // Valor inicial editable; no depende de servicios externos.
const EXCHANGE_RATE_STORAGE_KEY = "cotizador.exchangeRate";
let exchangeRateCents = BigInt(DEFAULT_USD_TO_CRC) * 100n;
const SHIPPING_RATES = Object.freeze([
  { maxKg: 10, priceCents: 1500n, label: "0–10 kg" },
  { maxKg: 20, priceCents: 3000n, label: "Más de 10–20 kg" },
  { maxKg: null, priceCents: 4000n, label: "Más de 20 kg" }
]);
const IVA_CONFIG = Object.freeze({
  rateBasisPoints: null // null = sin tasa definida. Al definirla: porcentaje × 100.
  // El IVA se DESGLOSA del precio de envío final, nunca se suma a las tarifas.
});
const LIMITS = Object.freeze({ priceCents: 999999999n, quantity: 9999n, weightMicros: 1000000000000n, exchangeRateCents: 100000000n });
const WEIGHT_SCALE = 1000000n; // Admite hasta 6 decimales sin redondear los rangos.
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Dinero en centavos enteros BigInt: evita errores como 0.1 + 0.2.
function formatAmount(cents, symbol, alwaysDecimals) {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  const decimals = alwaysDecimals || fraction !== 0n ? "." + fraction.toString().padStart(2, "0") : "";
  return symbol + integerFormatter.format(whole) + decimals;
}
function usd(cents) { return formatAmount(cents, "$", true); }
function crc(cents, rateCents = exchangeRateCents) {
  return rateCents === null ? "—" : formatAmount(roundDivide(cents * rateCents, 100n), "₡", false);
}

// Punto o coma como separador decimal. No se aceptan separadores de miles,
// negativos, notación científica, Infinity, letras ni decimales adicionales.
function parseDecimal(raw, decimals, maxValue, message) {
  const value = raw.trim();
  if (value === "") return { value: null, error: "" };
  const pattern = new RegExp("^(?:\\d+(?:[.,]\\d{0," + decimals + "})?|[.,]\\d{1," + decimals + "})$");
  if (!pattern.test(value)) return { value: null, error: message };
  const parts = value.replace(",", ".").split(".");
  const result = BigInt(parts[0] || "0") * (10n ** BigInt(decimals)) + BigInt((parts[1] || "").padEnd(decimals, "0"));
  if (result > maxValue) return { value: null, error: message };
  return { value: result, error: "" };
}
function parsePrice(raw) {
  return parseDecimal(raw, 2, LIMITS.priceCents, "Usa un precio de 0 a 9,999,999.99, con máximo 2 decimales.");
}
function parseQuantity(raw) {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return { value: null, error: "Usa una cantidad entera de 1 a 9,999." };
  const quantity = BigInt(value);
  if (quantity < 1n || quantity > LIMITS.quantity) return { value: null, error: "Usa una cantidad entera de 1 a 9,999." };
  return { value: quantity, error: "" };
}
function parseWeight(raw) {
  return parseDecimal(raw, 6, LIMITS.weightMicros, "Usa un peso de 0 a 1,000,000 kg, con máximo 6 decimales.");
}
function parseExchangeRate(raw) {
  const message = "Usa un cambio mayor que 0 y hasta 1,000,000, con máximo 2 decimales.";
  const parsed = parseDecimal(raw, 2, LIMITS.exchangeRateCents, message);
  if (parsed.value === null || parsed.value === 0n) return { value: null, error: parsed.error || message };
  return parsed;
}
function shippingIndex(weightMicros) {
  return SHIPPING_RATES.findIndex(rate => rate.maxKg === null || weightMicros <= BigInt(rate.maxKg) * WEIGHT_SCALE);
}
function roundDivide(numerator, denominator) { return (numerator + denominator / 2n) / denominator; }
function taxBreakdown(grossCents) {
  const rate = IVA_CONFIG.rateBasisPoints;
  if (rate === null) return { grossCents, netCents: null, ivaCents: null };
  if (!Number.isSafeInteger(rate) || rate < 0) throw new Error("El IVA debe ser un entero no negativo en puntos básicos.");
  const netCents = roundDivide(grossCents * 10000n, 10000n + BigInt(rate));
  return { grossCents, netCents, ivaCents: grossCents - netCents };
}

const elements = {
  list: document.getElementById("product-list"),
  exchangeRate: document.getElementById("exchange-rate"),
  weight: document.getElementById("weight"),
  copy: document.getElementById("copy-summary"),
  status: document.getElementById("summary-status"),
  dialog: document.getElementById("manual-copy-dialog")
};
let nextId = 0;
let lastQuote = null;
let toastTimer;

function restoreExchangeRate() {
  elements.exchangeRate.value = String(DEFAULT_USD_TO_CRC);
  try {
    const saved = localStorage.getItem(EXCHANGE_RATE_STORAGE_KEY);
    if (saved !== null && !parseExchangeRate(saved).error) elements.exchangeRate.value = saved;
  } catch (_) { /* El cotizador funciona aunque el navegador bloquee el almacenamiento. */ }
}
function changeExchangeRate() {
  updateQuote();
  if (exchangeRateCents === null) return;
  try {
    localStorage.setItem(EXCHANGE_RATE_STORAGE_KEY, elements.exchangeRate.value.trim().replace(",", "."));
  } catch (_) { /* Mantener el cambio durante esta sesión si no se puede guardar. */ }
}

function setText(id, value) { document.getElementById(id).textContent = value; }
function setMoneyPair(prefix, cents, unavailable = false) {
  setText(prefix + "-usd", unavailable ? "—" : usd(cents));
  setText(prefix + "-crc", unavailable ? "—" : crc(cents));
}
function showFieldError(input, message) {
  const error = document.getElementById(input.dataset.error || "weight-error");
  input.setAttribute("aria-invalid", message ? "true" : "false");
  input.setCustomValidity(message);
  error.textContent = message;
  error.hidden = !message;
}
function renumberRows() {
  [...elements.list.children].forEach((row, index) => {
    row.querySelector(".row-name").textContent = "Producto " + (index + 1);
    row.querySelector(".delete-button").setAttribute("aria-label", "Eliminar producto " + (index + 1));
  });
}
function addProduct(focus = true) {
  const id = ++nextId;
  const row = document.createElement("div");
  row.className = "product-row";
  // Sólo se interpola un identificador numérico interno, nunca texto del usuario.
  row.innerHTML = `
    <div class="row-heading"><span class="row-name"></span>
      <button type="button" class="delete-button" title="Eliminar producto"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>
    </div>
    <div class="row-fields">
      <div class="field"><label for="price-${id}">Precio unitario (USD)</label>
        <div class="input-shell"><span class="input-prefix" aria-hidden="true">$</span><input id="price-${id}" class="price-input" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" maxlength="16" aria-describedby="price-error-${id}" data-error="price-error-${id}"></div>
        <p class="field-error" id="price-error-${id}" hidden></p>
      </div>
      <div class="field"><label for="quantity-${id}">Cantidad</label>
        <div class="input-shell"><input id="quantity-${id}" class="quantity-input" type="text" inputmode="numeric" autocomplete="off" value="1" maxlength="8" aria-describedby="quantity-error-${id}" data-error="quantity-error-${id}"></div>
        <p class="field-error" id="quantity-error-${id}" hidden></p>
      </div>
    </div>
    <div class="line-subtotal"><span>Subtotal</span><div class="line-money"><strong class="line-usd">$0.00</strong><span class="line-crc">₡0</span></div></div>`;
  elements.list.append(row);
  renumberRows();
  updateQuote();
  if (focus) row.querySelector(".price-input").focus();
}
function renderTariffs() {
  const body = document.getElementById("tariff-body");
  body.replaceChildren();
  SHIPPING_RATES.forEach((rate, index) => {
    const row = document.createElement("tr");
    row.dataset.rateIndex = String(index);
    [rate.label, usd(rate.priceCents), crc(rate.priceCents)].forEach(value => {
      const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
    });
    body.append(row);
  });
  const rateLabel = exchangeRateCents === null ? "—" : formatAmount(exchangeRateCents, "₡", false);
  setText("exchange-header", "$1 = " + rateLabel);
  setText("exchange-note", exchangeRateCents === null ? "Ingresa un tipo de cambio válido." : "Tipo de cambio: $1 USD = " + rateLabel + " CRC");
}
function renderTax(grossCents, hasWeight) {
  const container = document.getElementById("tax-breakdown");
  container.hidden = IVA_CONFIG.rateBasisPoints === null || !hasWeight;
  if (container.hidden) return;
  const tax = taxBreakdown(grossCents);
  container.replaceChildren();
  const title = document.createElement("p"); title.textContent = "Desglose del envío · IVA " + (IVA_CONFIG.rateBasisPoints / 100) + "%";
  const list = document.createElement("dl");
  [["Sin IVA", tax.netCents], ["IVA", tax.ivaCents], ["Con IVA", tax.grossCents]].forEach(([label, cents]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = usd(cents) + " / " + crc(cents);
    item.append(term, detail); list.append(item);
  });
  container.append(title, list);
}
function updateQuote() {
  const exchangeRate = parseExchangeRate(elements.exchangeRate.value);
  exchangeRateCents = exchangeRate.value;
  showFieldError(elements.exchangeRate, exchangeRate.error);
  renderTariffs();
  let subtotal = 0n;
  let units = 0n;
  let productCount = 0;
  let hasInvalidProduct = false;
  for (const row of elements.list.children) {
    const priceInput = row.querySelector(".price-input");
    const quantityInput = row.querySelector(".quantity-input");
    const price = parsePrice(priceInput.value);
    const quantity = parseQuantity(quantityInput.value);
    // Una línea nueva intacta no modifica ni bloquea la cotización existente.
    const untouched = priceInput.value.trim() === "" && !priceInput.dataset.touched && !quantityInput.dataset.touched;
    const priceError = price.error || (!untouched && price.value === null ? "Ingresa el precio o elimina esta línea." : "");
    showFieldError(priceInput, priceError);
    showFieldError(quantityInput, untouched ? "" : quantity.error);
    const valid = price.value !== null && quantity.value !== null;
    const lineCents = valid ? price.value * quantity.value : 0n;
    row.querySelector(".line-usd").textContent = untouched ? usd(0n) : valid ? usd(lineCents) : "—";
    row.querySelector(".line-crc").textContent = untouched ? crc(0n) : valid ? crc(lineCents) : "Pendiente";
    if (valid) { subtotal += lineCents; units += quantity.value; productCount++; }
    if (!untouched && (!valid || priceError || quantity.error)) hasInvalidProduct = true;
  }
  const weight = parseWeight(elements.weight.value);
  showFieldError(elements.weight, weight.error);
  const hasWeight = weight.value !== null;
  const rateIndex = hasWeight ? shippingIndex(weight.value) : -1;
  const shipping = rateIndex < 0 ? 0n : SHIPPING_RATES[rateIndex].priceCents;
  const hasAmountError = hasInvalidProduct || Boolean(weight.error);
  const hasError = hasAmountError || Boolean(exchangeRate.error);
  const total = subtotal + shipping;
  const ready = productCount > 0 && hasWeight && !hasError;
  lastQuote = { subtotal, shipping, total, units, productCount, ready, exchangeRateCents };

  setMoneyPair("products", subtotal, hasInvalidProduct);
  setMoneyPair("summary-products", subtotal, hasInvalidProduct);
  setMoneyPair("shipping", shipping, Boolean(weight.error));
  setMoneyPair("summary-shipping", shipping, Boolean(weight.error));
  setMoneyPair("total", total, hasAmountError);
  setText("mobile-usd", hasAmountError ? "—" : usd(total) + " USD");
  setText("mobile-crc", hasAmountError ? "—" : crc(total));
  setText("mobile-label", hasError ? "Revisa los datos" : ready ? "Total a pagar" : "Total parcial");
  const unitLabel = integerFormatter.format(units) + (units === 1n ? " unidad" : " unidades");
  setText("unit-count", unitLabel);
  setText("summary-count", productCount ? productCount + (productCount === 1 ? " producto · " : " productos · ") + unitLabel : "Agrega el primer producto");
  document.querySelectorAll("[data-rate-index]").forEach(row => row.classList.toggle("active", Number(row.dataset.rateIndex) === rateIndex));
  setText("weight-hint", hasWeight ? "Tarifa aplicada: " + SHIPPING_RATES[rateIndex].label + "." : "Ingresa el peso para aplicar la tarifa.");
  elements.copy.disabled = !ready;
  elements.status.classList.toggle("error", hasError);
  elements.status.textContent = hasError ? "Corrige los campos marcados para obtener el total." : ready ? "Lista para compartir con el cliente." : productCount === 0 ? "Agrega productos y peso para completar la cotización." : "Total parcial: falta el peso para incluir el envío.";
  renderTax(shipping, hasWeight);
}
function clearQuote() {
  elements.list.replaceChildren();
  elements.weight.value = "";
  elements.dialog.close();
  document.getElementById("manual-summary").value = "";
  addProduct(false);
  showToast("Cotización limpia. Puedes comenzar otra.");
  elements.list.querySelector(".price-input").focus();
}
function summaryText(quote) {
  return [
    "COTIZACIÓN ESTIMADA", "",
    "Productos (" + integerFormatter.format(quote.units) + " unidades): " + usd(quote.subtotal) + " / " + crc(quote.subtotal, quote.exchangeRateCents),
    "Envío: " + usd(quote.shipping) + " / " + crc(quote.shipping, quote.exchangeRateCents), "",
    "TOTAL:", usd(quote.total) + " USD", crc(quote.total, quote.exchangeRateCents) + " CRC", "",
    "Tipo de cambio: $1 USD = " + formatAmount(quote.exchangeRateCents, "₡", false) + " CRC.",
    "Monto estimado. Confirmar el total final al pasar por caja."
  ].join("\n");
}
function showToast(message) {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}
// Compatibilidad al abrir index.html con file:// y al publicar por HTTPS.
function legacyCopy(text) {
  const focused = document.activeElement;
  const scrollX = window.scrollX, scrollY = window.scrollY;
  const area = document.createElement("textarea"); area.value = text; area.readOnly = true;
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;width:1px;height:1px;";
  document.body.append(area); area.select(); area.setSelectionRange(0, text.length);
  let copied = false;
  try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
  area.remove(); if (focused) focused.focus({ preventScroll: true }); window.scrollTo(scrollX, scrollY);
  return copied;
}
async function copySummary() {
  if (!lastQuote || !lastQuote.ready) return;
  const text = summaryText(lastQuote);
  let copied = false;
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); copied = true; } catch (_) { /* Intentar ruta local. */ }
  }
  if (!copied) copied = legacyCopy(text);
  if (copied) { showToast("Resumen copiado. Pégalo en WhatsApp."); return; }
  const area = document.getElementById("manual-summary"); area.value = text;
  elements.dialog.showModal(); area.focus(); area.select();
}

elements.list.addEventListener("input", event => {
  if (!event.target.matches("input")) return;
  event.target.dataset.touched = "true"; updateQuote();
});
elements.list.addEventListener("click", event => {
  const button = event.target.closest(".delete-button");
  if (!button) return;
  const row = button.closest(".product-row");
  const focusTarget = row.nextElementSibling || row.previousElementSibling;
  row.remove(); renumberRows(); updateQuote();
  (focusTarget ? focusTarget.querySelector(".price-input") : document.getElementById("add-product")).focus();
});
elements.weight.addEventListener("input", updateQuote);
elements.exchangeRate.addEventListener("input", changeExchangeRate);
document.getElementById("add-product").addEventListener("click", () => addProduct());
document.getElementById("clear-quote").addEventListener("click", clearQuote);
elements.copy.addEventListener("click", copySummary);
document.getElementById("close-copy-dialog").addEventListener("click", () => elements.dialog.close());
restoreExchangeRate();
addProduct(false);

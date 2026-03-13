/**
 * Centralized Meta Pixel helper — calls fbq only when available.
 * Import from pages/components to fire standard + custom events.
 */

function safeFbq(...args) {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    window.fbq(...args);
  }
}

export function trackPageView() {
  safeFbq('track', 'PageView');
}

export function trackCompleteRegistration({ email } = {}) {
  safeFbq('track', 'CompleteRegistration', {
    content_name: 'Cadastro SPA',
    status: true,
  });
}

export function trackViewContent({ contentName, contentCategory, value, currency = 'BRL' } = {}) {
  const params = {};
  if (contentName) params.content_name = contentName;
  if (contentCategory) params.content_category = contentCategory;
  if (value != null) { params.value = value; params.currency = currency; }
  safeFbq('track', 'ViewContent', params);
}

export function trackAddToCart({ contentName, value, currency = 'BRL', contentType = 'product' } = {}) {
  safeFbq('track', 'AddToCart', {
    content_name: contentName,
    content_type: contentType,
    value,
    currency,
  });
}

export function trackInitiateCheckout({ value, currency = 'BRL', numItems, contentName } = {}) {
  const params = { currency };
  if (value != null) params.value = value;
  if (numItems != null) params.num_items = numItems;
  if (contentName) params.content_name = contentName;
  params.content_type = 'product';
  safeFbq('track', 'InitiateCheckout', params);
}

export function trackPurchase({ value, currency = 'BRL', numItems, contentName, transactionId, eventId } = {}) {
  const params = { currency };
  if (value != null) params.value = value;
  if (numItems != null) params.num_items = numItems;
  if (contentName) params.content_name = contentName;
  if (transactionId) params.transaction_id = transactionId;
  params.content_type = 'product';

  const options = {};
  if (eventId) options.eventID = eventId;

  safeFbq('track', 'Purchase', params, options);
}

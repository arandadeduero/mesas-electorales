// Google Analytics con consentimiento explícito (GDPR): el script de GA no se
// descarga ni envía nada hasta que la persona pulsa «Aceptar» en el aviso.
// Solo se miden visitas a la página: el NIF y el resultado de la consulta nunca se envían a Google
// (el formulario no cambia la URL ni lanza eventos de analítica).
(function () {
  var MEASUREMENT_ID = 'G-BXMC22W46S';
  var CONSENT_KEY = 'mesasElectoralesAranda:analytics-consent';
  var GRANTED = 'granted';
  var DENIED = 'denied';
  var gaLoaded = false;

  function isDoNotTrackEnabled() {
    return (window.navigator && window.navigator.doNotTrack === '1') || window.doNotTrack === '1';
  }

  function getConsent() {
    try {
      var v = window.localStorage.getItem(CONSENT_KEY);
      return v === GRANTED || v === DENIED ? v : '';
    } catch (_) {
      return '';
    }
  }

  function setConsent(v) {
    try {
      window.localStorage.setItem(CONSENT_KEY, v);
    } catch (_) {
      // Sin localStorage el aviso se volverá a mostrar; nunca cargamos GA sin "Aceptar".
    }
  }

  function loadGa() {
    if (gaLoaded) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, { anonymize_ip: true });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  function hideBanner() {
    var b = document.querySelector('[data-analytics-consent]');
    if (b) b.hidden = true;
  }

  function setupBanner() {
    var banner = document.querySelector('[data-analytics-consent]');
    if (!banner) return;
    if (getConsent()) { banner.hidden = true; return; }
    banner.hidden = false;
    var accept = banner.querySelector('[data-analytics-consent-accept]');
    var deny = banner.querySelector('[data-analytics-consent-deny]');
    if (accept) accept.addEventListener('click', function () {
      setConsent(GRANTED);
      loadGa();
      hideBanner();
    }, { once: true });
    if (deny) deny.addEventListener('click', function () {
      setConsent(DENIED);
      hideBanner();
    }, { once: true });
  }

  if (isDoNotTrackEnabled()) return;
  if (getConsent() === GRANTED) loadGa();
  setupBanner();
})();

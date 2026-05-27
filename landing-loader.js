// [VZ] Landing page dynamic content loader.
// Reads admin overrides from /api/config and applies them to the DOM.
// Include with:
//   <script src="/landing-loader.js" data-has-bg-class="true"></script>
// The data-has-bg-class attribute is for the retro landing (body.has-bg-image class).
(function () {
    var thisScript = document.currentScript ||
        (function () {
            var scripts = document.querySelectorAll('script[src*="landing-loader"]');
            return scripts[scripts.length - 1];
        })();
    var hasBgClass = thisScript && thisScript.getAttribute('data-has-bg-class') === 'true';

    function set(id, prop, val) {
        if (val == null || val === '') return;
        var el = document.getElementById(id);
        if (el) el[prop] = val;
    }

    fetch('/api/config')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) {
            if (!cfg) return;

            // Core landing elements
            set('landingLogo',      'src',         cfg.landing_logo_url);
            set('landingTitle',     'textContent', cfg.landing_title);
            set('landingTagline',   'textContent', cfg.landing_tagline);
            set('landingInstagram', 'href',        cfg.landing_instagram);
            set('landingWhatsapp',  'href',        cfg.landing_whatsapp);

            // Background overrides
            var body = document.body;
            if (cfg.landing_bg_color && /^#[0-9a-fA-F]{6}$/.test(cfg.landing_bg_color)) {
                body.style.backgroundColor = cfg.landing_bg_color;
            }
            if (cfg.landing_bg_image_url) {
                var pos = cfg.landing_bg_position;
                body.style.backgroundImage      = 'url(' + cfg.landing_bg_image_url + ')';
                body.style.backgroundSize       = pos === 'contain' ? 'contain' : pos === 'center' ? 'auto' : 'cover';
                body.style.backgroundPosition   = 'center';
                body.style.backgroundAttachment = 'fixed';
                body.style.backgroundRepeat     = 'no-repeat';
                if (hasBgClass) body.classList.add('has-bg-image');
            }

            // ABOUT section
            var aboutSec = document.getElementById('landingAboutSection');
            if (aboutSec && cfg.about_visible !== '0') {
                if (cfg.about_title) set('aboutTitle', 'textContent', cfg.about_title);
                if (cfg.about_text)  set('aboutText',  'textContent', cfg.about_text);
                if (cfg.about_bg_color && /^#[0-9a-fA-F]{6}$/.test(cfg.about_bg_color))
                    aboutSec.style.backgroundColor = cfg.about_bg_color;
                if (cfg.about_bg_image_url) {
                    aboutSec.style.backgroundImage    = 'url(' + cfg.about_bg_image_url + ')';
                    aboutSec.style.backgroundSize     = 'cover';
                    aboutSec.style.backgroundPosition = 'center';
                }
                if (cfg.about_title || cfg.about_text) aboutSec.removeAttribute('hidden');
            }

            // COMO FUNCIONA section
            var howtoSec = document.getElementById('landingHowtoSection');
            if (howtoSec && cfg.howto_visible !== '0') {
                ['1', '2', '3', '4'].forEach(function (n) {
                    if (cfg['howto_step_' + n]) set('howtoStep' + n, 'textContent', cfg['howto_step_' + n]);
                });
                if (cfg.howto_step_1 || cfg.howto_step_2 || cfg.howto_step_3 || cfg.howto_step_4)
                    howtoSec.style.display = 'block';
            }
        })
        .catch(function () { /* silent — static HTML defaults remain */ });
})();

// [VZ] Admin auth + theme bootstrap — shared across all admin pages.
// Placed in <head> to prevent flash of unauthenticated / wrong-theme content.
// Sets data-init="pending" on <html> (CSS hides body), then removes it when ready.
// 
// FIX [2025-05-27]: Added credentials: 'include' to fetch requests so cookies are sent.
// Without this, auth validation fails and user gets stuck in login loop.
document.documentElement.dataset.init = 'pending';
(async () => {
        try {
            const [me, cfg] = await Promise.all([
                fetch('/api/me', { credentials: 'include' }),
                fetch('/api/config')
            ]);
            if (me.status === 401 || me.status === 403) { window.location.replace('/login.html'); return; }
            if (cfg.ok) {
                const data = await cfg.json();
                if (data.tema_admin === 'claro') document.documentElement.classList.add('apply-light');
            }
        } catch (e) {
            console.warn('Init bootstrap:', e.message);
        } finally {
            // Apply theme class to body if needed (body now exists)
            if (document.documentElement.classList.contains('apply-light')) {
                document.body.classList.add('tema-claro');
            }
            document.documentElement.removeAttribute('data-init');
        }
    })();

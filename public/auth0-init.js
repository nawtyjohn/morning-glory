
// === Auth0 SPA Integration (CDN global) ===

let auth0Client;
let accessToken = null;

async function configureAuth0() {
    // Fetch Auth0 config from backend
    const res = await fetch('/auth0-config');
    const config = await res.json();
    console.log('Fetched Auth0 config:', config);

    const { domain, client_id } = config;
    if (!domain || !client_id) {
        console.error('Missing domain or client_id in Auth0 config!');
        return;
    }
    // Use the global createAuth0Client from CDN (auth0.createAuth0Client)
    auth0Client = await auth0.createAuth0Client({
        domain,
        clientId: client_id, // must be camelCase here!
        cacheLocation: 'localstorage',
        useRefreshTokens: true,
        authorizationParams: {
            redirect_uri: window.location.origin // always root of current webpage
            // audience: 'YOUR_API_AUDIENCE' // <-- Set if using API permissions
        }
    });
    console.log('Auth0 client initialized with:', { domain, clientId: client_id });


    // Handle redirect callback only once
    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
        if (!sessionStorage.getItem('auth0_callback_handled')) {
            try {
                await auth0Client.handleRedirectCallback();
                sessionStorage.setItem('auth0_callback_handled', '1');
                // Get id_token and send to /set-session
                const idTokenClaims = await auth0Client.getIdTokenClaims();
                if (idTokenClaims && idTokenClaims.__raw) {
                    const resp = await fetch('/set-session', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: idTokenClaims.__raw }),
                        credentials: 'same-origin'
                    });
                    if (resp.status === 403) {
                        // Not authorized: log out from Auth0 and clear cookies
                        if (auth0Client) {
                            auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
                        }
                        return;
                    }
                    const text = await resp.text();
                    if (text.trim() === 'Session set') {
                        window.location.reload();
                        return;
                    }
                }
                window.history.replaceState({}, document.title, '/');
                // After setting session, check backend session and update UI
                await checkBackendSession();
                return;
            } catch (e) {
                console.error('Auth0 handleRedirectCallback error:', e);
                sessionStorage.removeItem('auth0_callback_handled');
                // If error is Invalid state, force Auth0 logout and cleanup
                if (e && e.message && e.message.match(/invalid state/i)) {
                    if (auth0Client) {
                        auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
                    }
                    return;
                }
            }
        } else {
            // Already handled, clean up and continue
            window.history.replaceState({}, document.title, '/');
            sessionStorage.removeItem('auth0_callback_handled');
        }
    }
    updateAuthUI();
// Check backend session and update UI accordingly
async function checkBackendSession() {
    try {
        const res = await fetch('/session', { credentials: 'same-origin' });
        const data = await res.json();
        const loginBtn = document.getElementById('loginBtn');
        const userInfo = document.getElementById('userInfo');
        const appContainer = document.getElementById('app-container');
        if (data.loggedIn) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (userInfo) userInfo.textContent = `Logged in as: ${data.user.name || data.user.email || 'user'}`;
            if (appContainer) appContainer.style.display = '';
        } else {
            if (loginBtn) loginBtn.style.display = '';
            if (userInfo) userInfo.textContent = '';
            if (appContainer) appContainer.style.display = 'none';
        }
    } catch (e) {
        // fallback to hiding app
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.style.display = 'none';
    }
}
}

async function updateAuthUI() {
    const isAuthenticated = await auth0Client.isAuthenticated();
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const buildInfo = document.getElementById('buildInfo');
    const appContainer = document.getElementById('app-container');
    if (loginBtn) loginBtn.style.display = isAuthenticated ? 'none' : '';
    if (isAuthenticated) {
        const user = await auth0Client.getUser();
        if (userInfo) userInfo.textContent = `Logged in as: ${user.name || user.email}`;
        accessToken = await auth0Client.getTokenSilently();
        if (buildInfo) await loadBuildInfo(buildInfo);
        if (appContainer) appContainer.style.display = '';
    } else {
        if (userInfo) userInfo.textContent = '';
        if (buildInfo) buildInfo.textContent = '';
        accessToken = null;
        if (appContainer) appContainer.style.display = 'none';
    }
}

async function loadBuildInfo(buildInfoEl) {
    try {
        const res = await fetch('/build-info', { credentials: 'same-origin' });
        if (!res.ok) {
            buildInfoEl.textContent = '';
            buildInfoEl.removeAttribute('title');
            return;
        }
        const data = await res.json();
        const rawCommit = typeof data.gitCommit === 'string' ? data.gitCommit : '';
        const shortCommit = rawCommit.length > 12 ? rawCommit.slice(0, 12) : rawCommit;
        const rawBuildTime = typeof data.buildTime === 'string' ? data.buildTime : '';
        const buildTimeText = rawBuildTime || 'unknown';
        const commitText = shortCommit || 'unknown';
        buildInfoEl.textContent = `Build ${buildTimeText} · ${commitText}`;
        if (rawCommit) buildInfoEl.title = rawCommit;
    } catch (e) {
        buildInfoEl.textContent = '';
        buildInfoEl.removeAttribute('title');
    }
}


window.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const loginAltBtn = document.getElementById('login');
    const logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn) {
        loginBtn.onclick = () => auth0Client && auth0Client.loginWithRedirect();
    }
    if (loginAltBtn) {
        loginAltBtn.onclick = () => auth0Client && auth0Client.loginWithRedirect();
    }
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            // Clear backend session cookie
            await fetch('/logout', { credentials: 'same-origin' });
            // Then log out from Auth0
            if (auth0Client) {
                auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
            }
        };
    }
    configureAuth0();
});

// Example: attach accessToken to API requests
async function authFetch(url, options = {}) {
    if (!accessToken) throw new Error('Not authenticated');
    options.headers = options.headers || {};
    options.headers['Authorization'] = `Bearer ${accessToken}`;
    return fetch(url, options);
}

// NOTE: You must bundle this file (e.g. with Vite, Webpack, or Parcel) so the import works in the browser.

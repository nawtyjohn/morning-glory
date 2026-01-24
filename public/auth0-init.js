
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

    // Handle redirect callback
    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, '/');
    }

    updateAuthUI();
}

async function updateAuthUI() {
    const isAuthenticated = await auth0Client.isAuthenticated();
    document.getElementById('loginBtn').style.display = isAuthenticated ? 'none' : '';
    document.getElementById('logoutBtn').style.display = isAuthenticated ? '' : 'none';
    if (isAuthenticated) {
        const user = await auth0Client.getUser();
        document.getElementById('userInfo').textContent = `Logged in as: ${user.name || user.email}`;
        accessToken = await auth0Client.getTokenSilently();
    } else {
        document.getElementById('userInfo').textContent = '';
        accessToken = null;
    }
}


window.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn) {
        loginBtn.onclick = () => auth0Client && auth0Client.loginWithRedirect();
    }
    if (logoutBtn) {
        logoutBtn.onclick = () => auth0Client && auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
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

// Parse JWT and check for Owner role
function hasOwnerRole(idToken) {
    try {
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        const roles = payload['https://jonbreen.uk/roles'];
        return Array.isArray(roles) && roles.includes('owner');
    } catch (e) {
        return false;
    }
}

// Patch updateAuthUI to drop token if not Owner
const origUpdateAuthUI = updateAuthUI;
updateAuthUI = async function() {
    const isAuthenticated = await auth0Client.isAuthenticated();
    const appContainer = document.getElementById('app-container');
    if (isAuthenticated) {
        const idToken = await auth0Client.getIdTokenClaims();
        if (!hasOwnerRole(idToken.__raw)) {
            // Not owner: forcefully clear Auth0 storage and log out
            try {
                // Remove Auth0 SPA SDK cache (localStorage)
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith('@@auth0spajs')) localStorage.removeItem(k);
                });
                // Remove Auth0 SPA SDK cache (sessionStorage)
                Object.keys(sessionStorage).forEach(k => {
                    if (k.startsWith('@@auth0spajs')) sessionStorage.removeItem(k);
                });
            } catch (e) {}
            await auth0Client.logout({ logoutParams: { returnTo: window.location.origin } });
            alert('You do not have permission to access this app. Please sign in with an Owner account.');
            return;
        }
    }
    return origUpdateAuthUI.apply(this, arguments);
};

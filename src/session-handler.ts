// Returns { loggedIn: true, user: { ... } } if session is valid and user is owner, else { loggedIn: false }
import { Hono } from 'hono';
import { jwtVerify } from 'jose';

export default async function sessionHandler(c) {
  const cookieHeader = c.req.header('Cookie') || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(v => {
    const idx = v.indexOf('=');
    if (idx === -1) return [v.trim(), ''];
    return [v.slice(0, idx).trim(), v.slice(idx + 1).trim()];
  }));
  const sessionToken = cookies['session'];
  if (!sessionToken) return c.json({ loggedIn: false });
  try {
    const jwksUri = `https://${c.env.AUTH0_DOMAIN}/.well-known/jwks.json`;
    const { createRemoteJWKSet } = await import('jose');
    const JWKS = createRemoteJWKSet(new URL(jwksUri));
    const { payload } = await jwtVerify(sessionToken, JWKS, {
      issuer: `https://${c.env.AUTH0_DOMAIN}/`,
      audience: c.env.AUTH0_CLIENT_ID,
    });
    const roles = payload['https://jonbreen.uk/roles'];
    if (Array.isArray(roles) && roles.includes('owner')) {
      return c.json({ loggedIn: true, user: payload });
    }
    return c.json({ loggedIn: false });
  } catch (e) {
    return c.json({ loggedIn: false });
  }
}

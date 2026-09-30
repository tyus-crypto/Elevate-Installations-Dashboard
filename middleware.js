// Basic auth gate for the /admin page (admin.html, served at /admin
// thanks to vercel.json's cleanUrls setting).
//
// IMPORTANT: change the username/password below before deploying.
//
// HONESTY NOTE: Vercel's Edge Middleware is built and documented mainly for
// framework projects (Next.js especially). This project has no framework
// and no package.json, so there's no guarantee Vercel runs this on every
// request the way it would in a Next.js app. Treat this as a second layer,
// not your only layer — verify it's actually firing after you deploy by
// visiting /admin in an incognito window and confirming you get a login
// prompt, not the page itself. If it doesn't fire, either add a minimal
// package.json (see README) or use Vercel's paid Password Protection
// instead (Project > Settings > Deployment Protection).

export const config = {
  matcher: '/admin',
};

export default function middleware(request) {
  const auth = request.headers.get('authorization');
  const validAuth = 'Basic ' + btoa('yourusername:yourpassword');

  if (auth !== validAuth) {
    return new Response('Auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin"' },
    });
  }
}

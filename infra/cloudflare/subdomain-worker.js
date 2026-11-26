/**
 * Cloudflare Worker for company subdomains, e.g. ecomalign.hrmsalign.com.
 *
 * Route it on: *.hrmsalign.com/*
 * Each request is forwarded to the main site (hrmsalign.com, hosted on Hostinger), with the address the
 * visitor used in the x-hrms-host header so the app knows which company it is. The browser stays on the
 * subdomain, so each company's sign-in cookies stay on its own address.
 */
const ROOT = 'hrmsalign.com';
// Subdomains that are not companies: let them through untouched.
const PASS_THROUGH = new Set(['www', 'mail', 'webmail', 'autodiscover', 'autoconfig']);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const sub = host.endsWith('.' + ROOT) ? host.slice(0, -(ROOT.length + 1)) : '';
    if (!sub || sub.includes('.') || PASS_THROUGH.has(sub)) return fetch(request);

    const visitorOrigin = url.origin;
    url.hostname = ROOT;
    const upstream = new Request(url.toString(), request);
    upstream.headers.set('x-hrms-host', host);
    const res = await fetch(upstream, { redirect: 'manual' });

    // Keep redirects on the company's own address.
    const main = 'https://' + ROOT;
    const location = res.headers.get('location');
    if (!location || !(location === main || location.startsWith(main + '/'))) return res;
    const out = new Response(res.body, res);
    out.headers.set('location', visitorOrigin + location.slice(main.length));
    return out;
  },
};

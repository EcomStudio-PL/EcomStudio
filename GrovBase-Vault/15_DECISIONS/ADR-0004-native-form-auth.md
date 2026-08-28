# ADR-0004 Native form POST auth
Decision: login/logout are classic form POSTs answered 303 + Set-Cookie
with full attributes (auth-route client records Supabase's cookie writes
WITH options); plus PGRST303 transport retry + warm-up read.
Why: two production login bugs traced to fetch-based flows and attribute
loss; native POST is the one flow every WebView/PWA handles identically.
Consequence: no client router on the auth path — acceptable.

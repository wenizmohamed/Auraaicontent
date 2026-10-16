#!/usr/bin/env bash
# domain-cutover.sh NEWDOMAIN [--dry-run]
# Moves the AURAAI app from radixcontent.com to NEWDOMAIN in one pass:
#   nginx vhosts (NEW canonical, www->apex, old domain 301->NEW), Let's Encrypt
#   cert, prod .env base URLs + CORS, watchdog probe host, code fallbacks,
#   backend rebuild+restart, then live verification.
# Safety: refuses to run live until NEWDOMAIN's A record already points here.
set -euo pipefail
NEW="${1:?usage: domain-cutover.sh NEWDOMAIN [--dry-run]}"; DRY=false; [ "${2:-}" = "--dry-run" ] && DRY=true
OLD="radixcontent.com"; VPS_IP="$(curl -s -m 10 https://api.ipify.org)"; TS="$(date +%s)"
ENV=/opt/radix-v2/server/.env; NG=/etc/nginx/sites-enabled/radix; SENT=/opt/radix-watchdog/sentinel.sh; REPO=/opt/radixcontent
run(){ echo "+ $*"; $DRY || "$@"; }
say(){ echo; echo "== $* =="; }

say "preflight"
echo "new=$NEW old=$OLD vps=$VPS_IP dry=$DRY"
NEW_A="$(dig +short A "$NEW" | tail -1 || true)"; echo "A($NEW)=${NEW_A:-none}"
if ! $DRY && [ "$NEW_A" != "$VPS_IP" ]; then
  echo "ABORT: $NEW does not resolve to this VPS ($VPS_IP). Point its A record here first (and www CNAME -> $NEW)."; exit 2
fi

say "backups"
run cp "$NG" "$NG.bak-$TS"; run cp "$ENV" "$ENV.bak-$TS"; run cp "$SENT" "$SENT.bak-$TS"

say "nginx step 1: add $NEW to the port-80 block so certbot can solve HTTP-01"
run sed -i "s|^\(\s*server_name\) $OLD www\.$OLD |\1 $NEW www.$NEW $OLD www.$OLD |" "$NG"
run nginx -t; run systemctl reload nginx

say "certificate"
run certbot certonly --nginx -d "$NEW" -d "www.$NEW" --non-interactive --agree-tos --keep-until-expiring

say "nginx step 2: NEW canonical, www->apex, $OLD -> 301 NEW (old cert kept so old links keep working)"
NGCONF="$(cat <<EOF
# AURAAI vhosts. App body shared via /etc/nginx/snippets/radix-app.conf.
# $(date -I): canonical domain moved $OLD -> $NEW. $OLD stays as a 301 so
# every old link, bookmark and review-link keeps working. Do not remove it.
server {
    listen 80; listen [::]:80;
    server_name $NEW www.$NEW $OLD www.$OLD srv1494206.hstgr.cloud radix.synapseai-labs.com;
    return 301 https://\$host\$request_uri;
}
# ============ CANONICAL: $NEW ============
server {
    listen 443 ssl http2;
    server_name $NEW;
    ssl_certificate /etc/letsencrypt/live/$NEW/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$NEW/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    include /etc/nginx/snippets/radix-app.conf;
}
server {
    listen 443 ssl http2;
    server_name www.$NEW;
    ssl_certificate /etc/letsencrypt/live/$NEW/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$NEW/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Cache-Control "max-age=300" always;
    return 301 https://$NEW\$request_uri;
}
# ============ Previous canonical: $OLD -> 301 NEW ============
server {
    listen 443 ssl http2;
    server_name $OLD www.$OLD;
    ssl_certificate /etc/letsencrypt/live/$OLD/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$OLD/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Cache-Control "max-age=300" always;
    return 301 https://$NEW\$request_uri;
}
# ============ Failover hostname (keeps serving the app) ============
server {
    listen 443 ssl http2;
    server_name srv1494206.hstgr.cloud;
    ssl_certificate /etc/letsencrypt/live/srv1494206.hstgr.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/srv1494206.hstgr.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    include /etc/nginx/snippets/radix-app.conf;
}
# ============ Legacy branded host ============
server {
    listen 443 ssl http2;
    server_name radix.synapseai-labs.com;
    ssl_certificate /etc/letsencrypt/live/radix.synapseai-labs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/radix.synapseai-labs.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    add_header Cache-Control "max-age=300" always;
    return 301 https://$NEW\$request_uri;
}
server { listen 80 default_server; server_name _; return 301 https://$NEW\$request_uri; }
server {
    listen 443 ssl default_server; server_name _;
    ssl_certificate /etc/letsencrypt/live/$NEW/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$NEW/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    return 301 https://$NEW\$request_uri;
}
EOF
)"
if $DRY; then echo "+ would write $NG ($(echo "$NGCONF" | wc -l) lines, canonical=$NEW)"; else printf '%s\n' "$NGCONF" > "$NG"; fi
run nginx -t; run systemctl reload nginx

say "prod .env: base URLs -> $NEW, CORS lists gain $NEW (old origins kept during transition)"
for k in PREVIEW_URL RADIX_APP_BASE_URL PUBLIC_APP_URL; do run sed -i "s|^$k=.*|$k=https://$NEW|" "$ENV"; done
for k in CORS_ORIGIN HTTP_CORS_ORIGINS SOCKET_IO_CORS_ORIGINS; do run sed -i "s|^$k=|$k=https://$NEW,|" "$ENV"; done

say "watchdog: sentinel probes $NEW instead of $OLD"
run sed -i "s|$OLD|$NEW|g" "$SENT"

say "code fallbacks (5 last-resort defaults in repo) -> $NEW"
for f in server/src/config/env.ts server/src/routes/orgs.ts server/src/routes/auth.ts server/src/routes/gallery-share.ts; do
  run sed -i "s|'https://$OLD'|'https://$NEW'|g" "$REPO/$f"; done
run sed -i "s|(radixcontent.com)|($NEW)|" "$REPO/server/src/routes/review.ts"

say "backend rebuild + restart"
run rsync -a "$REPO/server/src/" /opt/radix-v2/server/src/
run bash -c "cd /opt/radix-v2/server && npm run build >/dev/null"
run pm2 restart radix-api --update-env
run sleep 6

say "verify"
for u in "https://$NEW/" "https://www.$NEW/" "https://$OLD/" "https://$NEW/api/health"; do
  $DRY && { echo "+ curl -sI $u"; continue; }
  printf '%-45s -> %s\n' "$u" "$(curl -sk -m 15 -o /dev/null -w '%{http_code} %{redirect_url}' "$u")"
done
echo; echo "DONE. Remaining manual items (provider consoles, cannot be done from this box):"
echo "  - OAuth redirect URIs (Meta/TikTok/LinkedIn dev consoles): add https://$NEW/api/integrations/oauth/<platform>/callback"
echo "  - Stripe dashboard success/cancel/webhook URLs, if/when Stripe goes live"
echo "  - git: cd $REPO && git add -A server/src && git commit -m 'chore: canonical domain -> $NEW'"

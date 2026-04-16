#!/bin/bash
echo "=== Test 1: EnkiBank forged webhook (no token -> should get 401) ==="
curl -s -w '\nHTTP %{http_code}\n' -X POST https://api.combosalvauniversitario.site/webhooks/enkibank \
  -H 'Content-Type: application/json' \
  -d '{"event":"transaction.paid","transaction":{"id":"fake123","amount":3990,"customer":{"email":"test@test.com"}}}'

echo ""
echo "=== Test 2: SyncPay forged webhook (reverse-verify should reject) ==="
curl -s -w '\nHTTP %{http_code}\n' -X POST https://api.combosalvauniversitario.site/webhooks/syncpay \
  -H 'Content-Type: application/json' \
  -H 'event: cashin.update' \
  -d '{"data":{"id":"fake456","status":"completed","client":{"email":"test@test.com"},"amount":39.90}}'

echo ""
echo "=== Test 3: Health check ==="
curl -s https://api.combosalvauniversitario.site/health
echo ""

echo "=== Test 4: Nginx headers ==="
curl -sI https://api.combosalvauniversitario.site/health | grep -iE 'server:|x-powered-by|x-content-type|x-frame|strict-transport'

echo ""
echo "=== Test 5: .env permissions ==="
stat -c '%a %U %G %n' /var/www/concursaflix/.env

echo ""
echo "=== Test 6: sites-enabled cleanup ==="
ls /etc/nginx/sites-enabled/*.bak* 2>/dev/null && echo "BAK FILES STILL PRESENT!" || echo "No .bak files - CLEAN"

echo ""
echo "=== Recent webhook logs ==="
journalctl -u babylon-proxy --since '5 min ago' --no-pager | grep -E 'TOKEN MISMATCH|Reverse-verif|forged|reject' | tail -10

#!/bin/bash
echo "=== Testing WebSocket connectivity ==="
# Test from host
timeout 5 bash -c 'echo | openssl s_client -connect web.whatsapp.com:443 2>/dev/null | head -3'
echo "---"
# Check UFW
ufw status | head -15
echo "---"
# Check docker network mode
docker inspect evolution-api --format '{{.HostConfig.NetworkMode}}'
echo "---"
# Try with host network
echo "=== Recreating with host network ==="
docker rm -f evolution-api
sleep 2
docker run -d --name evolution-api \
  --restart unless-stopped \
  --network host \
  -e AUTHENTICATION_API_KEY=d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf \
  -e AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true \
  -e DATABASE_PROVIDER=postgresql \
  -e DATABASE_CONNECTION_URI="postgresql://evolution:evo_s3cR3t_2026@127.0.0.1:5432/evolution" \
  -e CACHE_REDIS_ENABLED=false \
  -e CACHE_LOCAL_ENABLED=true \
  -v evolution_data:/evolution/instances \
  atendai/evolution-api:latest

echo "Aguardando startup..."
sleep 15
echo "=== Logs ==="
docker logs evolution-api --tail 20 2>&1

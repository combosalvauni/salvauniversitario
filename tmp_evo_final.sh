#!/bin/bash
API_KEY="d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf"

echo "=== Parando containers ==="
docker rm -f evolution-api evolution-postgres 2>/dev/null
sleep 2

echo "=== Subindo Postgres na porta 5433 (host) ==="
docker run -d --name evolution-postgres \
  --restart unless-stopped \
  --network host \
  -e POSTGRES_USER=evolution \
  -e POSTGRES_PASSWORD=evo_s3cR3t_2026 \
  -e POSTGRES_DB=evolution \
  -e PGPORT=5433 \
  -v evolution_pgdata:/var/lib/postgresql/data \
  postgres:16-alpine

echo "Aguardando Postgres..."
sleep 8

echo "=== Subindo Evolution API (host network) ==="
docker run -d --name evolution-api \
  --restart unless-stopped \
  --network host \
  -e AUTHENTICATION_API_KEY=$API_KEY \
  -e AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true \
  -e DATABASE_PROVIDER=postgresql \
  -e DATABASE_CONNECTION_URI="postgresql://evolution:evo_s3cR3t_2026@127.0.0.1:5433/evolution" \
  -e CACHE_REDIS_ENABLED=false \
  -e CACHE_LOCAL_ENABLED=true \
  -v evolution_data:/evolution/instances \
  atendai/evolution-api:latest

echo "Aguardando Evolution API..."
sleep 15

echo ""
echo "=== Status containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}'
echo ""
echo "=== Evolution API logs ==="
docker logs evolution-api --tail 15 2>&1

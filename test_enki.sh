#!/bin/bash
AUTH=$(echo -n "pk_231Ju29gh57Fgz9lYUKYNToMiRikgG7YGvuQqBZqbms:sk_joK4_v7w5UJvgi_75fy5uX51UNHY0tJ2aG41ljfsyz8" | base64 -w0)
echo "Auth: Basic $AUTH"
echo "---"
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST https://api.enki-bank.com/v1/transactions \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/json" \
  -d '{"amount":100,"paymentMethod":"pix","customer":{"name":"Teste","email":"teste@teste.com","document":"12345678901","document_type":"CPF"}}'
echo ""
echo "--- DONE ---"

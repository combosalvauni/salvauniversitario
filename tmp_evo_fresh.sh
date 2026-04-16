#!/bin/bash
API_KEY="d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf"

echo "=== Logout da instância ==="
curl -s -X DELETE "http://localhost:8080/instance/logout/salva" \
  -H "apikey: $API_KEY"
echo ""

sleep 2

echo "=== Delete da instância ==="
curl -s -X DELETE "http://localhost:8080/instance/delete/salva" \
  -H "apikey: $API_KEY"
echo ""

sleep 3

echo "=== Listando instâncias ==="
curl -s http://localhost:8080/instance/fetchInstances \
  -H "apikey: $API_KEY" | python3 -m json.tool 2>/dev/null
echo ""

echo "=== Criando nova instância (sem qrcode auto) ==="
curl -s -X POST http://localhost:8080/instance/create \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"salva","integration":"WHATSAPP-BAILEYS","qrcode":false}' | python3 -m json.tool 2>/dev/null
echo ""

sleep 5

echo "=== Conectando (pegar QR) ==="
CONNECT=$(curl -s http://localhost:8080/instance/connect/salva \
  -H "apikey: $API_KEY")
echo "$CONNECT" | python3 -c "
import sys, json, base64
try:
    data = json.load(sys.stdin)
    print('Response keys:', list(data.keys()))
    if 'base64' in data:
        b64 = data['base64']
        if ',' in b64:
            b64 = b64.split(',',1)[1]
        imgdata = base64.b64decode(b64)
        with open('/tmp/whatsapp_qr.png', 'wb') as f:
            f.write(imgdata)
        print()
        print('>>> QR CODE SALVO em /tmp/whatsapp_qr.png <<<')
        if 'pairingCode' in data:
            print('Pairing code:', data['pairingCode'])
        if 'code' in data:
            print('QR code text:', data['code'][:200])
    else:
        print(json.dumps(data, indent=2))
except Exception as e:
    print('Parse error:', e)
" 2>&1

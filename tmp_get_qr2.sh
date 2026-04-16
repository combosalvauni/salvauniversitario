#!/bin/bash
API_KEY="d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf"

echo "=== Status da instância ==="
curl -s http://localhost:8080/instance/connectionState/salva \
  -H "apikey: $API_KEY" | python3 -m json.tool

echo ""
echo "=== Tentando connect ==="
RESULT=$(curl -s http://localhost:8080/instance/connect/salva \
  -H "apikey: $API_KEY")

echo "$RESULT" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
print('Keys:', list(data.keys()))
if 'base64' in data:
    b64 = data['base64']
    if ',' in b64:
        b64 = b64.split(',',1)[1]
    imgdata = base64.b64decode(b64)
    with open('/tmp/whatsapp_qr.png', 'wb') as f:
        f.write(imgdata)
    print('QR code salvo em /tmp/whatsapp_qr.png')
    print('Pairingcode:', data.get('pairingCode', 'n/a'))
    print('Code:', data.get('code', 'n/a'))
elif 'code' in data:
    print('QR text code:', data.get('code', ''))
else:
    print(json.dumps(data, indent=2))
" 2>/dev/null || echo "$RESULT"

#!/bin/bash
API_KEY="d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf"

echo "=== Deletando instância anterior ==="
curl -s -X DELETE "http://localhost:8080/instance/delete/salva" \
  -H "apikey: $API_KEY" | python3 -m json.tool 2>/dev/null

echo ""
echo "=== Aguardando 3s ==="
sleep 3

echo "=== Criando nova instância ==="
RESULT=$(curl -s -X POST http://localhost:8080/instance/create \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName":"salva","integration":"WHATSAPP-BAILEYS","qrcode":true,"number":""}')

echo "$RESULT" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
print(json.dumps(data, indent=2, default=str)[:2000])

# Check if QR in nested structure
qr = data.get('qrcode', {})
if isinstance(qr, dict) and 'base64' in qr:
    b64 = qr['base64']
    if ',' in b64:
        b64 = b64.split(',',1)[1]
    imgdata = base64.b64decode(b64)
    with open('/tmp/whatsapp_qr.png', 'wb') as f:
        f.write(imgdata)
    print('\\nQR CODE SALVO em /tmp/whatsapp_qr.png')

if 'base64' in data:
    b64 = data['base64']
    if ',' in b64:
        b64 = b64.split(',',1)[1]
    imgdata = base64.b64decode(b64)
    with open('/tmp/whatsapp_qr.png', 'wb') as f:
        f.write(imgdata)
    print('\\nQR CODE SALVO em /tmp/whatsapp_qr.png')
" 2>&1

echo ""
echo "=== Aguardando 10s para QR gerar ==="
sleep 10

echo "=== Buscando QR via connect ==="
CONNECT=$(curl -s http://localhost:8080/instance/connect/salva \
  -H "apikey: $API_KEY")
echo "$CONNECT" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
print('Connect response keys:', list(data.keys()))
if 'base64' in data:
    b64 = data['base64']
    if ',' in b64:
        b64 = b64.split(',',1)[1]
    imgdata = base64.b64decode(b64)
    with open('/tmp/whatsapp_qr.png', 'wb') as f:
        f.write(imgdata)
    print('QR CODE SALVO em /tmp/whatsapp_qr.png')
    if 'code' in data:
        print('QR text:', data['code'][:200])
    if 'pairingCode' in data:
        print('Pairing code:', data['pairingCode'])
else:
    print(json.dumps(data, indent=2))
" 2>&1

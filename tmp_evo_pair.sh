#!/bin/bash
API_KEY="d9aa7aca3c26e1e25909bc263e1136e0807e5dedefafd59f288c9efd65ce4fcf"
PHONE="${1:-}"

if [ -z "$PHONE" ]; then
  echo "Uso: bash /tmp/evo_pair.sh 5511999990000"
  echo "(seu número com DDI+DDD sem espaços)"
  exit 1
fi

echo "=== Logout instância anterior ==="
curl -s -X DELETE "http://localhost:8080/instance/logout/salva" \
  -H "apikey: $API_KEY" 2>/dev/null
echo ""

echo "=== Delete instância anterior ==="
curl -s -X DELETE "http://localhost:8080/instance/delete/salva" \
  -H "apikey: $API_KEY" 2>/dev/null
echo ""

sleep 3

echo "=== Criando instância com pairing code ==="
RESULT=$(curl -s -X POST http://localhost:8080/instance/create \
  -H "apikey: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"instanceName\":\"salva\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":false,\"number\":\"$PHONE\"}")

echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"

sleep 8

echo ""
echo "=== Conectando (pairing code) ==="
CONNECT=$(curl -s "http://localhost:8080/instance/connect/salva" \
  -H "apikey: $API_KEY")
echo "$CONNECT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'pairingCode' in data:
    code = data['pairingCode']
    print()
    print('========================================')
    print('  PAIRING CODE: ' + code)
    print('========================================')
    print()
    print('No seu WhatsApp:')
    print('  1. Configurações > Aparelhos conectados')
    print('  2. Conectar aparelho')
    print('  3. Escolha \"Conectar com número de telefone\"')
    print('  4. Digite o código acima')
    print()
elif 'base64' in data:
    import base64 as b64mod
    b = data['base64']
    if ',' in b:
        b = b.split(',',1)[1]
    imgdata = b64mod.b64decode(b)
    with open('/tmp/whatsapp_qr.png', 'wb') as f:
        f.write(imgdata)
    print('QR CODE salvo em /tmp/whatsapp_qr.png')
else:
    print(json.dumps(data, indent=2))
" 2>&1

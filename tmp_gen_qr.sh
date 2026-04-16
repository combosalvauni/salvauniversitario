#!/bin/bash
pip3 install qrcode pillow -q 2>/dev/null
python3 << 'PYEOF'
import qrcode
data = open('/tmp/wa_qr.txt').read().strip()
img = qrcode.make(data)
img.save('/tmp/wa_qr.png')
print('QR PNG saved to /tmp/wa_qr.png')

import base64
with open('/tmp/wa_qr.png', 'rb') as f:
    b64 = base64.b64encode(f.read()).decode()
# Also generate terminal QR 
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L)
qr.add_data(data)
qr.print_ascii(invert=True)
PYEOF

#!/bin/bash
python3 << 'PYEOF'
import qrcode
data = open('/tmp/wa_qr.txt').read().strip()
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_L, border=1)
qr.add_data(data)
qr.print_ascii(invert=True)
PYEOF

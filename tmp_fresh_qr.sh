#!/bin/bash
systemctl restart babylon-proxy
sleep 8
python3 -c "
import qrcode
with open('/tmp/wa_qr.txt') as f:
    data = f.read().strip()
qr = qrcode.QRCode(border=1)
qr.add_data(data)
qr.print_ascii(invert=True)
"

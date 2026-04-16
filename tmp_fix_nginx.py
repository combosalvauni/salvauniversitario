#!/usr/bin/env python3
import sys

path = '/etc/nginx/sites-enabled/concursaflix-api'
content = open(path).read()

if '/webhooks/syncpay' in content:
    print('SyncPay block already present, skipping')
    sys.exit(0)

block = """  location = /webhooks/syncpay {
    limit_req zone=webhooks burst=20 nodelay;
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

"""

anchor = '  location = /webhooks/enkibank {'
if anchor not in content:
    print('ERROR: enkibank location block not found')
    sys.exit(1)

content = content.replace(anchor, block + anchor)
open(path, 'w').write(content)
print('OK - SyncPay webhook block added')

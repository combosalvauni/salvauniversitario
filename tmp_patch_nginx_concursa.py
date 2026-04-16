#!/usr/bin/env python3
"""Fix concursaflix nginx: HTTP→HTTPS redirect + rate limiting."""
import sys

path = '/etc/nginx/sites-enabled/concursa'
content = open(path).read()

# Fix port 80 block to redirect to HTTPS instead of proxying
old_80 = """server {
    listen 80;
    listen [::]:80;
    server_name concursaflix.com www.concursaflix.com api.concursaflix.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}"""

new_80 = """server {
    listen 80;
    listen [::]:80;
    server_name concursaflix.com www.concursaflix.com api.concursaflix.com;
    return 301 https://$host$request_uri;
}"""

if old_80 in content:
    content = content.replace(old_80, new_80)
    print('Fixed: HTTP→HTTPS redirect')
else:
    print('WARN: Could not find exact port 80 block to replace')

# Add security headers if not present
if 'X-Content-Type-Options' not in content:
    old_header = '    server_tokens off;'
    new_header = """    server_tokens off;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;"""
    content = content.replace(old_header, new_header, 1)
    print('Added security headers')

# Add rate limiting to the location block
if 'limit_req' not in content:
    old_location = """    location / {
        proxy_pass http://127.0.0.1:8000;"""
    new_location = """    location / {
        limit_req zone=api burst=60 nodelay;
        proxy_pass http://127.0.0.1:8000;"""
    content = content.replace(old_location, new_location, 1)
    print('Added rate limiting')

open(path, 'w').write(content)
print('OK — nginx config patched')

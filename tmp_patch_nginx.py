import sys

path = "/etc/nginx/sites-enabled/concursaflix-api"
with open(path, "r") as f:
    c = f.read()

block = """  location /email-assets/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

"""

if "location /email-assets/" in c:
    print("ALREADY PATCHED")
    sys.exit(0)

c = c.replace("  location /api/babylon {", block + "  location /api/babylon {", 1)

with open(path, "w") as f:
    f.write(c)

print("PATCHED OK")

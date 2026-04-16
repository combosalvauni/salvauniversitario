#!/usr/bin/env python3
"""Patch images.py to add rate limiting."""
import sys

path = '/var/www/concursaflix/concursa/app/routers/images.py'
content = open(path).read()

# Check if proxy_image already has rate limiting
if '@limiter.limit' in content and 'proxy_image' in content:
    # Check if it's on the proxy_image function specifically
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'async def proxy_image' in line:
            # Check line before  
            if i > 0 and '@limiter.limit' in lines[i-1]:
                print('Rate limit already on proxy_image, skipping')
                sys.exit(0)
            if i > 1 and '@limiter.limit' in lines[i-2]:
                print('Rate limit already on proxy_image, skipping')
                sys.exit(0)

# Add rate limiter import if not present
if 'from app.core.rate_limit import limiter' not in content:
    if 'from app.core.rate_limit import' in content:
        pass  # already has some import
    else:
        content = content.replace(
            'from fastapi import',
            'from app.core.rate_limit import limiter\nfrom fastapi import'
        )

old = 'async def proxy_image('
new = '@limiter.limit("60/minute")\nasync def proxy_image('
# Only replace the first occurrence
content = content.replace(old, new, 1)

open(path, 'w').write(content)
print('OK — images.py patched with rate limit on proxy_image')

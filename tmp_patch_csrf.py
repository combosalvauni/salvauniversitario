#!/usr/bin/env python3
"""Patch csrf.py to add SyncPay webhook exemption."""
import sys

path = '/var/www/concursaflix/concursa/app/core/csrf.py'
content = open(path).read()

if 'syncpay-webhook' in content:
    print('SyncPay webhook already in CSRF exempt paths, skipping')
    sys.exit(0)

old = '_EXEMPT_PATHS = frozenset({"/api/v1/payments/webhook", "/api/v1/payments/babylon-webhook"})'
new = '_EXEMPT_PATHS = frozenset({"/api/v1/payments/webhook", "/api/v1/payments/babylon-webhook", "/api/v1/payments/syncpay-webhook"})'
content = content.replace(old, new)

open(path, 'w').write(content)
print('OK — csrf.py patched with SyncPay webhook exemption')

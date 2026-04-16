#!/usr/bin/env python3
"""Patch config.py to add SyncPay settings."""
import sys

path = '/var/www/concursaflix/concursa/app/core/config.py'
content = open(path).read()

if 'syncpay_client_id' in content:
    print('SyncPay settings already in config.py, skipping')
    sys.exit(0)

# Add SyncPay settings after Babylon settings
old = '    babylon_webhook_token: str = Field(default_factory=_dev_secret)  # token in webhook URL path'
new = '''    babylon_webhook_token: str = Field(default_factory=_dev_secret)  # token in webhook URL path

    # Pagamento — SyncPay
    syncpay_client_id: str = ""
    syncpay_client_secret: str = ""
    syncpay_base_url: str = "https://api.syncpayments.com.br"
    syncpay_webhook_token: str = Field(default_factory=_dev_secret)

    # Gateway ativo: "babylon" ou "syncpay"
    payment_gateway: str = "babylon"'''

# Remove the old payment_gateway line since we're adding it in the SyncPay block
content = content.replace('    payment_gateway: str = "babylon"\n    babylon_secret_key', '    babylon_secret_key')
content = content.replace(old, new)

# Add SyncPay validation to validate_production_secrets
old_validate = '        if len(self.babylon_webhook_token) < 32:'
new_validate = '''        if self.payment_gateway == "syncpay":
            if not self.syncpay_client_id or not self.syncpay_client_secret:
                raise RuntimeError("SYNCPAY_CLIENT_ID e SYNCPAY_CLIENT_SECRET são obrigatórios quando payment_gateway=syncpay.")
            if len(self.syncpay_webhook_token) < 24:
                raise RuntimeError("SYNCPAY_WEBHOOK_TOKEN deve ter pelo menos 24 caracteres em produção.")
        if len(self.babylon_webhook_token) < 32:'''

content = content.replace(old_validate, new_validate)

open(path, 'w').write(content)
print('OK — config.py patched with SyncPay settings')

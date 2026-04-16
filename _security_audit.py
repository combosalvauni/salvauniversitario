import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('69.62.90.16', username='root', password=')nPd;,/B2B0?YkZm', timeout=15)

commands = [
    # === VPS HARDENING ===
    ('OPEN_PORTS', 'ss -tlnp | grep LISTEN'),
    ('UFW_STATUS', 'ufw status verbose 2>/dev/null || iptables -L -n 2>/dev/null | head -30'),
    ('SSH_CONFIG', 'grep -E "^(PermitRootLogin|PasswordAuthentication|Port |PubkeyAuthentication|MaxAuthTries|AllowUsers|Protocol)" /etc/ssh/sshd_config 2>/dev/null'),
    ('SSH_KEYS', 'ls -la /root/.ssh/authorized_keys 2>/dev/null; wc -l /root/.ssh/authorized_keys 2>/dev/null'),
    ('FAIL2BAN', 'systemctl is-active fail2ban 2>/dev/null || echo FAIL2BAN_NOT_INSTALLED'),
    ('UNATTENDED_UPGRADES', 'dpkg -l | grep unattended-upgrades 2>/dev/null | head -1 || echo NOT_INSTALLED'),
    ('OS_VERSION', 'cat /etc/os-release | grep -E "^(PRETTY_NAME|VERSION)" | head -2'),
    ('KERNEL', 'uname -r'),
    ('RUNNING_AS_ROOT', 'ps aux | grep -E "node|nginx|python" | grep -v grep | awk "{print \\$1, \\$11}" | sort -u'),

    # === NGINX SECURITY ===
    ('NGINX_HEADERS', 'curl -sI https://api.combosalvauniversitario.site/health 2>&1 | head -25'),
    ('NGINX_SERVER_TOKEN', 'grep -r "server_tokens" /etc/nginx/ 2>/dev/null'),
    ('SSL_GRADE', 'curl -s "https://api.combosalvauniversitario.site/" -o /dev/null -w "SSL_VERIFY: %{ssl_verify_result}\\nHTTP_CODE: %{http_code}\\n" 2>&1'),
    ('SSL_PROTOCOLS', 'grep -rE "ssl_protocols|ssl_ciphers" /etc/nginx/ 2>/dev/null | head -5'),
    ('NGINX_RATE_LIMIT', 'grep -rE "limit_req|limit_conn" /etc/nginx/ 2>/dev/null | head -5'),

    # === FILE PERMISSIONS ===
    ('ENV_PERMISSIONS', 'ls -la /var/www/concursaflix/.env'),
    ('APP_DIR_OWNER', 'ls -la /var/www/concursaflix/ | head -5'),
    ('SENSITIVE_FILES', 'find /var/www/concursaflix -name "*.env*" -o -name "*.key" -o -name "*.pem" 2>/dev/null | head -10'),

    # === EXPOSED SECRETS CHECK ===
    ('GIT_EXPOSED', 'test -d /var/www/concursaflix/.git && echo "GIT_DIR_EXISTS" || echo "NO_GIT_DIR"'),
    ('ENV_IN_WEBROOT', 'curl -s -o /dev/null -w "%{http_code}" https://api.combosalvauniversitario.site/.env'),
    ('GIT_VIA_WEB', 'curl -s -o /dev/null -w "%{http_code}" https://api.combosalvauniversitario.site/.git/config'),

    # === SUPABASE RLS CHECK ===  
    ('ANON_PROFILES', """ANON=$(grep '^VITE_SUPABASE_ANON_KEY=' /var/www/concursaflix/.env | cut -d= -f2) && curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "https://acnqurxexjsdfypelrwg.supabase.co/rest/v1/profiles?select=id,email,role&limit=3" """),
    ('ANON_CHECKOUT_ORDERS', """ANON=$(grep '^VITE_SUPABASE_ANON_KEY=' /var/www/concursaflix/.env | cut -d= -f2) && curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "https://acnqurxexjsdfypelrwg.supabase.co/rest/v1/checkout_orders?select=id,status&limit=3" """),
]

for label, cmd in commands:
    print(f'--- {label} ---')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        print(out)
    if err:
        print('STDERR:', err)
    print()

ssh.close()
print('--- VPS AUDIT DONE ---')

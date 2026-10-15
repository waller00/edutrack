#!/usr/bin/env python3
"""Exercise real Nginx/Alloy with synthetic data, isolated containers and no host ports.
Requires local nginx:1.27-alpine and grafana/alloy:v1.6.1 images. Never accesses production.
"""
import pathlib, re, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
containers = []

def docker(*args, check=True):
    return subprocess.run(['docker', *map(str, args)], capture_output=True, text=True, check=check)

def start(image, directory, *args):
    cid = docker('run', '-d', '--rm', '--network', 'none', '-v', f'{directory}:/test:ro', image, *args).stdout.strip()
    containers.append(cid)
    return cid

try:
    with tempfile.TemporaryDirectory(prefix='edutrack-log-tests-') as directory:
        folder = pathlib.Path(directory)
        # Validate the complete production/local/private configs, not just the test server.
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                        '-subj','/CN=synthetic.test','-keyout',str(folder/'key.pem'),
                        '-out',str(folder/'cert.pem')], check=True, capture_output=True)
        for name in ['nginx/reverse-proxy/nginx.conf', 'nginx/reverse-proxy/local.conf']:
            result = docker('run','--rm','--network','none',
                '--add-host','auth:127.0.0.1','--add-host','web:127.0.0.1',
                '--add-host','keycloak:127.0.0.1','--add-host','moodle:127.0.0.1',
                '-v',f'{ROOT/name}:/etc/nginx/nginx.conf:ro',
                '-v',f'{directory}:/etc/ssl/cloudflare:ro', 'nginx:1.27-alpine','nginx','-t')
        admin = (ROOT/'nginx/keycloak-admin/default.conf.template').read_text().replace('${KEYCLOAK_ADMIN_PRIVATE_HOST}', 'private.test')
        (folder/'admin.conf').write_text(admin)
        (folder/'admin-main.conf').write_text('events {} http { log_format main "$request"; access_log /dev/stdout main; include /test/admin.conf; }')
        admin_id = start('nginx:1.27-alpine', directory, 'nginx','-c','/test/admin-main.conf','-g','daemon off;')
        for _ in range(50):
            result = subprocess.run(['docker','exec','-i',admin_id,'nc','-w','1','127.0.0.1','8080'],
                input='GET /?code=ADMINSECRET HTTP/1.1\r\nHost: private.test\r\nConnection: close\r\n\r\n',text=True,capture_output=True)
            if '302' in result.stdout: break
            time.sleep(.1)
        else: raise AssertionError(docker('logs',admin_id,check=False).stderr)
        admin_logs = docker('logs',admin_id).stdout
        assert 'ADMINSECRET' not in admin_logs and 'GET / HTTP/1.1' in admin_logs
        print('PASS: complete production/local Nginx syntax; private proxy overrides inherited unsafe access format.')
        source = (ROOT / 'nginx/reverse-proxy/nginx.conf').read_text()
        # Reuse the actual HTTP maps and log formats, replacing only upstream servers/TLS.
        prefix = source.split('\n  server {', 1)[0]
        prefix = re.sub(r'^\s*ssl_certificate(?:_key)? .*?;\s*$', '', prefix, flags=re.M)
        config = prefix + '''
  server {
    listen 8080;
    add_header X-Test-Susp $susp_injection always;
    add_header X-Test-Block $block_injection always;
    if ($bad_path) { return 444; }
    if ($block_injection) { return 403; }
    location / { return 204; }
  }
}
'''
        (folder / 'nginx.conf').write_text(config)
        cid = start('nginx:1.27-alpine', directory, 'nginx', '-c', '/test/nginx.conf', '-g', 'daemon off;')
        for _ in range(50):
            if docker('exec', cid, 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/ready', check=False).returncode == 0:
                break
            time.sleep(.1)
        else:
            raise AssertionError(docker('logs',cid,check=False).stdout + docker('logs',cid,check=False).stderr)
        token = 'e30.e30.SIG--QUERYSECRET'
        logout = '/realms/edutrack/protocol/openid-connect/logout'
        cases = [
            (logout+'?id_token_hint='+token, '0', '0'),
            (logout+'?client_id=web&id_token_hint='+token+'&post_logout_redirect_uri=https%3A%2F%2Fapp.test', '0', '0'),
            (logout+'?id_token_hint='+token+'&q=1--', '1', '0'),
            (logout+'?q=1--&id_token_hint='+token, '1', '0'),
            (logout+'?id_token_hint=not-a-jwt--', '1', '0'),
            ('/other?id_token_hint='+token, '1', '0'),
            (logout+'?id_token_hint='+token+'&q=union+select', '0', '1'),
            (logout+'?q=%3Cscript&id_token_hint='+token, '1', '0'),
            (logout+'?id_token_hint='+token+'&q=%2e%2e%2fetc%2fpasswd', '0', '1'),
            (logout+'?id_token_hint='+token+'&id_token_hint='+token, '1', '0'),
            ('/auth/callback?code=CODESECRET&state=STATESECRET', '0', '0'),
        ]
        for i, (path, suspicious, blocked) in enumerate(cases):
            request = f"GET {path} HTTP/1.1\r\nHost: auth.edutrack-uy.com\r\nUser-Agent: log-test-{i}\r\nReferer: https://app.test/?token=REFERERSECRET\r\nConnection: close\r\n\r\n"
            result = subprocess.run(['docker','exec','-i',cid,'nc','-w','2','127.0.0.1','8080'], input=request, text=True, capture_output=True, check=True)
            assert f'X-Test-Susp: {suspicious}' in result.stdout, (i,result.stdout)
            assert f'X-Test-Block: {blocked}' in result.stdout, (i,result.stdout)
        docker('exec',cid,'wget','-O','/dev/null','-U','log-test-drop','http://127.0.0.1:8080/.env?token=DROPSECRET',check=False)
        logs = docker('logs',cid).stdout
        assert 'WAF_SUSPICIOUS' in logs and 'WAF_BLOCKED' in logs and 'WAF_DROPPED' in logs
        for secret in ['QUERYSECRET','CODESECRET','STATESECRET','REFERERSECRET','DROPSECRET','id_token_hint=']:
            assert secret not in logs, secret
        assert 'log-test-0' in logs and 'log-test-10' in logs
        print('PASS: 11 Nginx request cases + blocked path; detection preserved; access/WAF logs contain no query or Referer secrets.')

        # Exercise actual Alloy stage.replace semantics (capture groups, not $1 substitutions).
        alloy = (ROOT / 'monitoring/alloy/config.alloy').read_text()
        process = alloy[alloy.index('loki.process "redact"'):alloy.index('loki.write "local"')]
        process = process.replace('loki.write.local.receiver', 'loki.echo.test.receiver')
        test_config = '''
loki.source.file "test" {
  targets = [{__path__ = "/test/lines.log", job = "synthetic"}]
  forward_to = [loki.process.redact.receiver]
}
loki.echo "test" {}
''' + process
        (folder/'test.alloy').write_text(test_config)
        (folder/'lines.log').write_text('\n'.join([
            'CASE1 GET /auth/callback?code=CODESECRET&state=STATESECRET HTTP/1.1',
            'CASE2 uri="'+logout+'?id_token_hint='+token+'" ua="browser"',
            'CASE3 Authorization: Bearer BEARERSECRET',
            'CASE4 {"refresh_token":"REFRESHSECRET","id_token_hint":"IDSECRET"}',
            'CASE5 cookie: sid=SIDSECRET; other=COOKIESECRET',
            'CASE6 password=PASSWORDSECRET secret=SECRETSECRET api_key=KEYSECRET',
            'CASE7 referer: "https://app.test/?token=REFERERSECRET"',
        ])+'\n')
        # TempDirectory defaults to 0700; Alloy's image runs as root by default.
        aid = start('grafana/alloy:v1.6.1', directory, 'run','--storage.path=/tmp/alloy-test','/test/test.alloy')
        for _ in range(100):
            result = docker('logs',aid,check=False)
            output = result.stdout + result.stderr
            if all(f'CASE{i}' in output for i in range(1,8)): break
            time.sleep(.1)
        else: raise AssertionError(output)
        assert 'SECRET' not in output, output
        assert '[REDACTED]' in output
        print('PASS: 7 lines through real Alloy; URL queries, authorization, cookies, JSON and key/value credentials redacted.')
finally:
    for cid in containers:
        docker('rm','-f',cid,check=False)

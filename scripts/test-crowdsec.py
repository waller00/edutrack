#!/usr/bin/env python3
"""Local integration test: disposable Loki + CrowdSec, synthetic logs, no host ports.
Requires Docker Compose and network access to fetch the official Hub content.
Never connects to production. Cleans only its own generated project and volumes.
"""
import datetime
import json
import pathlib
import re
import subprocess
import tempfile
import time
import urllib.request
import urllib.parse
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
project = 'edutrack-cs-test-' + uuid.uuid4().hex[:8]


def run(*args, check=True):
    return subprocess.run(args, text=True, capture_output=True, check=check)


def wait_for(check, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if check():
            return
        time.sleep(2)
    raise AssertionError('Timed out waiting for test condition')


with tempfile.TemporaryDirectory(prefix=project) as temp:
    override = pathlib.Path(temp) / 'compose.yml'
    override.write_text(f'''networks:
  logs:
    external: false
    name: {project}
services:
  loki:
    image: grafana/loki:3.3.2
    command: ["-config.file=/etc/loki/local-config.yaml"]
    networks: [logs]
''')
    compose = ['docker', 'compose', '-p', project, '-f', str(ROOT / 'docker-compose.crowdsec.yml'), '-f', str(override)]
    try:
        run(*compose, 'up', '-d')
        cid = run(*compose, 'ps', '-q', 'crowdsec').stdout.strip()
        lid = run(*compose, 'ps', '-q', 'loki').stdout.strip()

        def cli(*args, check=True):
            return run('docker', 'exec', cid, 'cscli', *args, check=check)

        wait_for(lambda: 'Starting processing data' in run('docker', 'logs', cid).stdout + run('docker', 'logs', cid).stderr, 300)
        assert cli('lapi', 'status').returncode == 0
        assert 'global simulation: enabled' in cli('simulation', 'status').stdout
        info = json.loads(run('docker', 'inspect', cid).stdout)[0]
        assert not info['HostConfig']['Privileged']
        assert not info['HostConfig']['PortBindings']
        assert all('docker.sock' not in m['Source'] for m in info['Mounts'])
        assert 'DISABLE_ONLINE_API=true' in info['Config']['Env']
        scenarios = json.loads(cli('scenarios', 'list', '-o', 'json').stdout)['scenarios']
        assert [s['name'] for s in scenarios] == ['crowdsecurity/http-probing']
        print('PASS: simulation, local-only decisions, single HTTP scenario, no host ports/socket', flush=True)
        loki_ip = next(iter(json.loads(run('docker', 'inspect', lid).stdout)[0]['NetworkSettings']['Networks'].values()))['IPAddress']
        base = 'http://' + loki_ip + ':3100'
        # Loki's reader starts at now after readiness, so do not push fixtures earlier.
        wait_for(lambda: 'Connecting to http://loki:3100/loki/api/v1/query_range' in (run('docker', 'logs', cid).stdout + run('docker', 'logs', cid).stderr), 90)
        # Obtain an anonymous access line from the actual Nginx JSON-escaped format.
        nginx_source = (ROOT / 'nginx/reverse-proxy/nginx.conf').read_text()
        log_format = re.search(r"  log_format access_safe .*?;", nginx_source).group(0)
        nginx_config = pathlib.Path(temp) / 'nginx.conf'
        nginx_config.write_text('events {} http { map $request_uri $log_path { default $uri; }\n'
                                + log_format + '\naccess_log /dev/stdout access_safe; '
                                + 'server { listen 8080; location / { return 404; } } }')
        nginx_id = run('docker', 'run', '-d', '--network', 'none', '-v',
                       str(nginx_config) + ':/etc/nginx/nginx.conf:ro', 'nginx:1.27-alpine').stdout.strip()
        try:
            def request_fixture():
                return run('docker', 'exec', nginx_id, 'wget', '-q', '-O', '/dev/null',
                           'http://127.0.0.1:8080/fixture', check=False).returncode != 0 and '/fixture' in run('docker', 'logs', nginx_id).stdout
            wait_for(request_fixture, 15)
            sample = next(l for l in run('docker', 'logs', nginx_id).stdout.splitlines() if 'GET /fixture HTTP/' in l)
        finally:
            run('docker', 'rm', '-f', nginx_id)
        assert ' -  [' in sample, sample
        ts = time.time_ns()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%d/%b/%Y:%H:%M:%S +0000')

        def line(ip, path, status=404):
            return re.sub(r'^127\.0\.0\.1', ip, sample).replace('/fixture', path).replace(' 404 ', f' {status} ')

        def legacy_line(ip, path):
            return f'{ip} - - [{stamp}] "GET {path} HTTP/1.1" 404 10 "-" "crowdsec-local-test"'

        public = []
        # Generate enough distinct error paths to overflow http-probing's bucket.
        for i in range(15):
            public.extend([
                line('198.51.100.20', f'/scan-{i}'),
                legacy_line('2001:db8::20', f'/scan-v6-{i}'),
                line('198.51.100.21', f'/normal-{i}', 200),
                line('198.51.100.22', f'/iclock/probe-{i}'),
                line('198.51.100.23', '/cdata'),
                f'WAF_SUSPICIOUS ip=198.51.100.24 uri="/probe-{i}"',
            ])
        other = [line('198.51.100.25', f'/excluded-{i}') for i in range(15)]
        streams = []
        for service, lines in [('reverse-proxy', public), ('keycloak-admin-proxy', other)]:
            streams.append({'stream': {'compose_project': 'edutrack', 'compose_service': service},
                            'values': [[str(ts + i), text] for i, text in enumerate(lines)]})
        req = urllib.request.Request(base + '/loki/api/v1/push', data=json.dumps({'streams': streams}).encode(), headers={'Content-Type': 'application/json'})
        assert urllib.request.urlopen(req, timeout=10).status == 204
        # Execute the deployed LogQL query against real Loki, including negative cases.
        query = run('docker', 'exec', cid, 'yq', '-r', '.query', '/etc/crowdsec/acquis.d/nginx-loki.yaml').stdout.strip()
        params = urllib.parse.urlencode({'query': query, 'start': str(ts), 'end': str(time.time_ns()), 'limit': '1000'})
        data = json.load(urllib.request.urlopen(base + '/loki/api/v1/query_range?' + params, timeout=10))
        selected = [v[1] for stream in data['data']['result'] for v in stream['values']]
        assert len(selected) == 45, len(selected)
        assert all('/scan-' in v or '/scan-v6-' in v or '/normal-' in v for v in selected)
        alerts = []

        def detected():
            global alerts
            alerts = json.loads(cli('alerts', 'list', '-o', 'json').stdout) or []
            return {'198.51.100.20', '2001:db8::20'}.issubset({a['source']['value'] for a in alerts})

        wait_for(detected, 90)
        # Give the same batch's negative cases time to surface if incorrectly processed.
        time.sleep(3)
        alerts = json.loads(cli('alerts', 'list', '-o', 'json').stdout) or []
        assert {a['source']['value'] for a in alerts} == {'198.51.100.20', '2001:db8::20'}, alerts
        assert all(a.get('simulated') is True for a in alerts), alerts
        assert all(a['scenario'] == 'crowdsecurity/http-probing' for a in alerts)
        assert not (json.loads(cli('bouncers', 'list', '-o', 'json').stdout) or [])
        # LAPI must not accept connections via the container's network address.
        ip = next(iter(info['NetworkSettings']['Networks'].values()))['IPAddress']
        # Verify real exported names used by Grafana, not just endpoint availability.
        metrics = urllib.request.urlopen('http://' + ip + ':6060/metrics', timeout=10).read().decode()
        for metric in ('cs_lokisource_hits_total', 'cs_parser_hits_ok_total', 'cs_bucket_overflowed_total'):
            assert metric in metrics, metric
        print('PASS: private-network metrics endpoint and dashboard metric names', flush=True)
        import socket
        with socket.socket() as sock:
            sock.settimeout(2)
            assert sock.connect_ex((ip, 8080)) != 0
        print('PASS: Loki ingestion, IPv4/IPv6 simulated alerts, benign/biometric/WAF/private-source exclusions, private LAPI', flush=True)
    except Exception:
        if 'cid' in locals():
            logs = run('docker', 'logs', '--tail', '30', cid, check=False)
            print(logs.stdout + logs.stderr)
        raise
    finally:
        run(*compose, 'down', '-v', '--remove-orphans', check=False)

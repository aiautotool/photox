from pathlib import Path
p=Path('docs/V4_SAAS_PLAN.md')
s=p.read_text()
s=s.replace('- next: create/default the legacy personal workspace from Desktop startup and control-plane bootstrap.\n- next: scope media metadata and provider connections by workspace.\n', '- legacy personal workspace bootstrap is implemented in Desktop startup, including desktop-device registration and existing-usage reconstruction.\n- media ingest now enforces workspace plan byte quotas before consuming the request body and rolls reservations back on failed ingest.\n- next: scope media metadata and provider connections by workspace.\n', 1)
p.write_text(s)

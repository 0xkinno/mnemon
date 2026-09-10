import json
from scenarios import run
print(json.dumps(run()["race"], indent=2, sort_keys=True))


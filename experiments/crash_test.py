import json
from scenarios import run
print(json.dumps(run()["crash"], indent=2, sort_keys=True))


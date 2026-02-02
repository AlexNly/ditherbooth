import os
import subprocess
import tempfile
from typing import Union


def spool_raw(printer_name: str, payload: Union[bytes, str]) -> None:
    data = payload.encode() if isinstance(payload, str) else payload
    if printer_name.startswith("/dev/"):
        with open(printer_name, "wb") as dev:
            dev.write(data)
    else:
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        try:
            subprocess.run(["lpr", "-P", printer_name, tmp_path], check=True, timeout=30)
        finally:
            os.unlink(tmp_path)

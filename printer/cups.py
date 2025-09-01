import subprocess
import tempfile
from typing import Union


def spool_raw(printer_name: str, payload: Union[bytes, str]) -> None:
    data = payload.encode() if isinstance(payload, str) else payload
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    subprocess.run(["lpr", "-P", printer_name, "-o", "raw", tmp_path], check=True)

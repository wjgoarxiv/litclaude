"""Run a real installer terminal, return its bytes/exit, and reap its owned group."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import time

replies = json.load(sys.stdin)
master, slave = pty.openpty()
child = None
output = bytearray()
sent = 0
timed_out = False
try:
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave,
                             start_new_session=True)
    os.close(slave)
    slave = None
    deadline = time.monotonic() + 30
    while True:
        if time.monotonic() >= deadline:
            timed_out = True
            break
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            output.extend(chunk)
            if sent < len(replies) and replies[sent][0].encode() in output:
                os.write(master, (replies[sent][1] + "\n").encode())
                sent += 1
        elif child.poll() is not None:
            break
finally:
    if slave is not None:
        os.close(slave)
    if child is not None:
        try:
            # PTY EOF can arrive just before the exit status becomes waitable.
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=5)
    os.close(master)

print(json.dumps({"exit": child.returncode, "output": output.decode("utf-8", errors="replace"),
                  "repliesSent": sent, "timedOut": timed_out, "cleanup": "child reaped; PTY closed"}))
